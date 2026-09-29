/**
 * Chat route handler: streaming RAG with two tools and layered guardrails.
 *
 * Request pipeline, in order:
 *  1. Security: same-origin check (CSRF), JSON-only body with a size cap, and
 *     the conversation rebuilt from an allowlist (no client-supplied system
 *     messages, tool results, attachments or oversized history).
 *  2. Privacy: personal details are removed from every user message before the
 *     model, search or logs see them. Payment card data blocks the request
 *     entirely (422) and is never processed or stored.
 *  3. Quota: daily question limit by plan, plus a per-minute burst limit.
 *  4. Answer. The model can call getInformation (library search) and
 *     projectWealth (projection engine; the model never does maths).
 *     - Normal questions stream straight to the reader.
 *     - Personal-advice questions ("Should I sell…?") have their answer text
 *       held back, checked, rewritten once if needed, or replaced with a safe
 *       fallback before the reader sees it. Sources and charts still stream.
 */
import { streamText, generateText, tool, embed } from 'ai';
import { Index } from '@upstash/vector';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createOpenAIProvider } from '../../../lib/openai';
import { COLLECTION_IDS, VECTOR_NAMESPACE } from '../../../lib/collections';
import { redactPII, safeLog, type RedactionResult } from '../../../lib/guardrails/pii';
import {
  SYSTEM_PROMPT,
  PERSONAL_ADVICE_STEER,
  REWRITE_INSTRUCTION,
  isPersonalAdviceRequest,
  outputRedFlags,
} from '../../../lib/guardrails/advice';
import { adviceGuardTransform } from '../../../lib/guardrails/adviceGuard';
import { projectWealth, summariseProjection, ProjectionInputSchema } from '../../../lib/finance/projections';
import { checkQuota } from '../../../lib/entitlements';
import { getViewer } from '../../../lib/viewer';
import { assertSameOrigin, readJsonBody, sanitizeChatMessages, CHAT_LIMITS } from '../../../lib/security';

// Allow up to 30 seconds for retrieval plus streaming on Vercel.
export const maxDuration = 30;

const index = new Index().namespace(VECTOR_NAMESPACE);

const TOP_K = 6;
const MIN_SCORE = 0.3;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  // 1. Security
  const crossSite = assertSameOrigin(req);
  if (crossSite) return text(crossSite.message, crossSite.status);

  const body = await readJsonBody(req, CHAT_LIMITS.maxBodyBytes);
  if (!body.ok) return text(body.message, body.status);

  const cleaned = sanitizeChatMessages(body.data);
  if (!cleaned.ok) return text(cleaned.message, cleaned.status);

  // 2. Privacy: redact every user turn; card data in the latest one blocks the request
  let latestRedaction: RedactionResult | undefined;
  const messages = cleaned.messages.map((m, i, all) => {
    if (m.role !== 'user') return m;
    const r = redactPII(m.content);
    if (i === all.length - 1) latestRedaction = r;
    return { ...m, content: r.clean };
  });
  if (latestRedaction?.blocked) {
    safeLog('blocked_payment_data', { findings: latestRedaction.findings });
    return text(latestRedaction.userNotice ?? 'Message blocked.', 422);
  }

  // 3. Quota
  const viewer = await getViewer(req);
  const quota = await checkQuota(viewer.key, viewer.plan, Boolean(viewer.userId));
  if (!quota.allowed) return text(quota.reason ?? 'Daily limit reached.', quota.notConfigured ? 503 : 429);

  const latestText = messages[messages.length - 1].content;
  const holdForCheck = isPersonalAdviceRequest(latestText);
  const system = holdForCheck ? `${SYSTEM_PROMPT}\n\n${PERSONAL_ADVICE_STEER}` : SYSTEM_PROMPT;

  // An anonymous, hashed id lets OpenAI trace abuse without any personal details.
  const openaiUser = createHash('sha256').update(`openai:${viewer.key}`).digest('hex').slice(0, 32);
  const openai = createOpenAIProvider();
  const model = openai(process.env.CHAT_MODEL ?? 'gpt-4o-mini', { user: openaiUser });

  // 4. Answer
  const result = streamText({
    model,
    temperature: 0.2,
    system,
    messages,
    tools: {
      getInformation: tool({
        description:
          'Search the Investment Research Library. Optionally limit to one or more collections; use an empty array to search everything.',
        parameters: z.object({
          query: z.string().max(500).describe('the topic, term, or sub-question to search for'),
          collections: z.array(z.enum(COLLECTION_IDS)).max(COLLECTION_IDS.length).describe('collections to search; empty array = all collections'),
        }),
        execute: async ({ query, collections }) => {
          const { embedding } = await embed({
            model: openai.embedding(process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small', { user: openaiUser }),
            value: redactPII(query).clean,
          });
          // collections are validated against a fixed list, so the filter can't be injected
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
    ...(holdForCheck
      ? {
          experimental_transform: adviceGuardTransform({
            rewrite: async (draft) =>
              (
                await generateText({
                  model,
                  temperature: 0,
                  system: SYSTEM_PROMPT,
                  prompt: `QUESTION:\n${latestText}\n\nDRAFT ANSWER:\n${draft}\n\n${REWRITE_INSTRUCTION}`,
                })
              ).text,
            onResult: (event) => {
              if (event.stage !== 'passed') safeLog('advice_guard', { ...event, viewer: viewer.key });
            },
          }),
        }
      : {}),
    onFinish: ({ text: answer }) => {
      // Normal (streamed) answers are monitored after the fact.
      const flags = outputRedFlags(answer);
      if (flags.length && !holdForCheck) safeLog('advice_red_flag', { flags, viewer: viewer.key });
    },
  });

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (latestRedaction?.userNotice) headers['X-Privacy-Notice'] = encodeURIComponent(latestRedaction.userNotice);
  if (quota.remaining !== null) headers['X-Questions-Remaining'] = String(quota.remaining);
  if (holdForCheck) headers['X-Answer-Check'] = 'held';

  return result.toDataStreamResponse({
    headers,
    getErrorMessage: (error) => {
      safeLog('chat_error', { message: error instanceof Error ? error.message : String(error) });
      return 'Sorry, something went wrong while answering. Please try again in a moment.';
    },
  });
}
