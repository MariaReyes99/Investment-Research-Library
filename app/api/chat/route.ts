/**
 * Chat route handler: streaming RAG with two tools and guardrails.
 *
 * Request pipeline, in order:
 *  1. Validate the body (as before: size limit, history cap).
 *  2. Privacy: redact personal details from every user message before the
 *     model, logs or vector search see them. Payment card data blocks the
 *     request entirely (422) and is never processed.
 *  3. Quota: daily question limit by plan (anonymous visitors = free).
 *  4. Stream an answer. The model can call:
 *       getInformation - search the library, optionally by collection
 *       projectWealth  - run the projection engine (the model never does maths)
 *  5. Monitoring: advice-style wording in the finished answer is logged.
 *
 * Privacy and quota information is returned in response headers, which the
 * page reads in useChat's onResponse.
 */
import { streamText, tool, embed, type Message } from 'ai';
import { Index } from '@upstash/vector';
import { z } from 'zod';
import { createOpenAIProvider } from '../../../lib/openai';
import { COLLECTION_IDS, VECTOR_NAMESPACE } from '../../../lib/collections';
import { redactPII, safeLog, type RedactionResult } from '../../../lib/guardrails/pii';
import { SYSTEM_PROMPT, PERSONAL_ADVICE_STEER, isPersonalAdviceRequest, outputRedFlags } from '../../../lib/guardrails/advice';
import { projectWealth, summariseProjection, ProjectionInputSchema } from '../../../lib/finance/projections';
import { checkQuota } from '../../../lib/entitlements';
import { getViewer } from '../../../lib/viewer';

// Allow up to 30 seconds for retrieval plus streaming on Vercel.
export const maxDuration = 30;

const index = new Index().namespace(VECTOR_NAMESPACE);

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 12;
const TOP_K = 6;
const MIN_SCORE = 0.3;

type IncomingMessage = Pick<Message, 'role' | 'content'> & { parts?: Message['parts'] };

/** Redact a user message's text in both `content` and text `parts`. */
function redactMessage(m: IncomingMessage): { message: IncomingMessage; result: RedactionResult } {
  const result = redactPII(typeof m.content === 'string' ? m.content : '');
  const findings = { ...result.findings };
  let blocked = result.blocked;
  let userNotice = result.userNotice;
  const parts = m.parts?.map((p) => {
    if (p.type !== 'text') return p;
    const r = redactPII(p.text);
    for (const [k, n] of Object.entries(r.findings)) {
      const key = k as keyof typeof findings;
      findings[key] = Math.max(findings[key] ?? 0, n ?? 0);
    }
    if (r.blocked) blocked = true;
    if (r.blocked || !userNotice) userNotice = r.userNotice ?? userNotice;
    return { ...p, text: r.clean };
  });
  return {
    message: { ...m, content: result.clean, ...(parts ? { parts } : {}) },
    result: { clean: result.clean, findings, blocked, userNotice },
  };
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function POST(req: Request) {
  // 1. Validate
  let body: { messages?: IncomingMessage[] };
  try {
    body = await req.json();
  } catch {
    return text('Invalid JSON body.', 400);
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return text('Request must include a non-empty messages array.', 400);
  }
  const latest = messages[messages.length - 1];
  if (typeof latest.content === 'string' && latest.content.length > MAX_MESSAGE_CHARS) {
    return text(`Please keep questions under ${MAX_MESSAGE_CHARS} characters.`, 413);
  }

  let recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  recent = firstUser > 0 ? recent.slice(firstUser) : recent;

  // 2. Privacy: redact every user turn; block card data in the latest one
  let latestRedaction: RedactionResult | undefined;
  recent = recent.map((m, i) => {
    if (m.role !== 'user') return m;
    const { message, result } = redactMessage(m);
    if (i === recent.length - 1) latestRedaction = result;
    return message;
  });
  if (latestRedaction?.blocked) {
    safeLog('blocked_payment_data', { findings: latestRedaction.findings });
    return text(latestRedaction.userNotice ?? 'Message blocked.', 422);
  }

  // 3. Quota
  const viewer = await getViewer(req);
  const quota = await checkQuota(viewer.key, viewer.plan, Boolean(viewer.userId));
  if (!quota.allowed) return text(quota.reason ?? 'Daily limit reached.', 429);

  const latestText = recent[recent.length - 1].content ?? '';
  const system = isPersonalAdviceRequest(latestText) ? `${SYSTEM_PROMPT}\n\n${PERSONAL_ADVICE_STEER}` : SYSTEM_PROMPT;

  // 4. Answer
  const openai = createOpenAIProvider();
  const result = streamText({
    model: openai(process.env.CHAT_MODEL ?? 'gpt-4o-mini'),
    temperature: 0.2,
    system,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: recent as any,
    tools: {
      getInformation: tool({
        description:
          'Search the Investment Research Library. Optionally limit to one or more collections; use an empty array to search everything.',
        parameters: z.object({
          query: z.string().describe('the topic, term, or sub-question to search for'),
          collections: z.array(z.enum(COLLECTION_IDS)).describe('collections to search; empty array = all collections'),
        }),
        execute: async ({ query, collections }) => {
          const { embedding } = await embed({
            model: openai.embedding(process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'),
            value: redactPII(query).clean,
          });
          const filter = collections.length ? collections.map((c) => `collection = '${c}'`).join(' OR ') : undefined;
          const hits = await index.query({
            vector: embedding,
            topK: TOP_K,
            includeMetadata: true,
            ...(filter ? { filter } : {}),
          });
          return hits
            .filter((h) => h.score >= MIN_SCORE)
            .map((h) => ({
              text: (h.metadata?.text as string) ?? '',
              source: (h.metadata?.source as string) ?? 'Unknown source',
              document: (h.metadata?.document as string) ?? '',
              section: (h.metadata?.section as string) ?? 'Unlabeled section',
              collection: (h.metadata?.collection as string) ?? '',
              url: (h.metadata?.url as string) ?? '',
              asOf: (h.metadata?.asOf as string) ?? '',
              score: h.score,
            }));
        },
      }),
      projectWealth: tool({
        description:
          "Project future wealth from age, current savings, monthly contributions, expected return, fees and inflation, with an optional goal (a target balance or a yearly retirement income, both in today's dollars). Returns Low/Expected/High scenarios, balances at ages 55/60/65/70, sustainable retirement income, and progress towards the goal.",
        parameters: ProjectionInputSchema,
        execute: async (input) => {
          try {
            // The model gets a compact summary; the browser redraws the full
            // chart from the same inputs, so yearly series never cost tokens.
            return { ok: true as const, ...summariseProjection(projectWealth(input)) };
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid inputs' };
          }
        },
      }),
    },
    maxSteps: 5,
    onFinish: ({ text: answer }) => {
      const flags = outputRedFlags(answer);
      if (flags.length) safeLog('advice_red_flag', { flags, viewer: viewer.key });
    },
  });

  const headers: Record<string, string> = {};
  if (latestRedaction?.userNotice) headers['X-Privacy-Notice'] = encodeURIComponent(latestRedaction.userNotice);
  if (quota.remaining !== null) headers['X-Questions-Remaining'] = String(quota.remaining);

  return result.toDataStreamResponse({
    headers,
    getErrorMessage: (error) => {
      safeLog('chat_error', { message: error instanceof Error ? error.message : String(error) });
      return 'Sorry, something went wrong while answering. Please try again in a moment.';
    },
  });
}
