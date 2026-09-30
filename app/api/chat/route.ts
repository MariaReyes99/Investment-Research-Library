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
 *  3. Quota: monthly question allowance by plan, plus a per-minute burst limit.
 *  4. Answer. The model can call getInformation (library search),
 *     projectWealth (one savings pot) and projectHousehold (a whole household:
 *     several assets, properties, incomes and expenses). The model never does maths.
 *     - Normal questions stream straight to the reader.
 *     - Personal-advice questions ("Should I sell…?") have their answer text
 *       held back, checked, rewritten once if needed, or replaced with a safe
 *       fallback before the reader sees it. Sources and charts still stream.
 */
import { streamText, generateText, tool, embed, jsonSchema, zodSchema } from 'ai';
import { Index } from '@upstash/vector';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createOpenAIProvider } from '../../../lib/openai';
import { COLLECTION_IDS, VECTOR_NAMESPACE } from '../../../lib/collections';
import { redactPII, safeLog, type RedactionResult } from '../../../lib/guardrails/pii';
import {
  SYSTEM_PROMPT,
  PERSONAL_ADVICE_STEER,
  countryContext,
  REWRITE_INSTRUCTION,
  isPersonalAdviceRequest,
  outputRedFlags,
} from '../../../lib/guardrails/advice';
import { adviceGuardTransform } from '../../../lib/guardrails/adviceGuard';
import { projectWealth, summariseProjection, ProjectionInputSchema } from '../../../lib/finance/projections';
import { HouseholdInputSchema, projectHousehold, summariseHousehold } from '../../../lib/finance/household';
import { analyseHousehold, summariseAnalysis } from '../../../lib/finance/householdAnalysis';
import { householdFromSimple } from '../../../lib/finance/fromSimple';
import { projectionNote } from '../../../lib/chatContext';
import { DEFAULT_COUNTRY, currencyCountryIn, isCountry } from '../../../lib/countries';
import { fetchRates, isCurrency } from '../../../lib/fxRates';
import { CURRENCIES } from '../../../lib/finance/household';
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

/**
 * Tool inputs are checked inside the tool, not by the AI SDK. If the model
 * passes something out of range (say a 30% yearly return), the tool tells it
 * what was wrong so it can explain and try again, instead of the whole answer
 * failing with an error.
 */
function checkedLater<T extends z.ZodTypeAny>(schema: T) {
  return jsonSchema<z.input<T>>(zodSchema(schema).jsonSchema);
}

function describeIssues(err: z.ZodError): string {
  return err.issues.slice(0, 5).map((i) => {
    const where = i.path.join('.') || 'input';
    if (i.code === 'too_big') return `${where} must be at most ${String(i.maximum)}`;
    if (i.code === 'too_small') return `${where} must be at least ${String(i.minimum)}`;
    return `${where}: ${i.message}`;
  }).join('; ');
}

const OUT_OF_RANGE_HELP =
  'Fix the inputs and call the tool again. Yearly returns are limited to 20% because no investment strategy reliably earns more over the long run; if the user asked for a higher return, explain that plainly and use realistic returns such as 4% (conservative), 6% (balanced) and 8% (growth).';

export async function POST(req: Request) {
  // 1. Security
  const crossSite = assertSameOrigin(req);
  if (crossSite) return text(crossSite.message, crossSite.status);

  const body = await readJsonBody(req, CHAT_LIMITS.maxBodyBytes);
  if (!body.ok) return text(body.message, body.status);

  const cleaned = sanitizeChatMessages(body.data, projectionNote);
  const requestedCountry = (body.data as { country?: unknown } | null)?.country;
  const country = isCountry(requestedCountry) ? requestedCountry : DEFAULT_COUNTRY;
  const requestedRetireIn = (body.data as { retireIn?: unknown } | null)?.retireIn;
  const retireIn = isCountry(requestedRetireIn) && requestedRetireIn !== country ? requestedRetireIn : null;
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
  if (!quota.allowed) {
    const status = quota.notConfigured ? 503 : 429;
    return new Response(quota.reason ?? 'Daily limit reached.', {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(quota.limitReached ? { 'X-Limit-Reached': quota.tier ?? 'free', 'X-Questions-Remaining': '0' } : {}),
      },
    });
  }

  const latestText = messages[messages.length - 1].content;
  const holdForCheck = isPersonalAdviceRequest(latestText);
  const amountsIn = currencyCountryIn(latestText);
  const system = [SYSTEM_PROMPT, countryContext(country, amountsIn, retireIn), holdForCheck ? PERSONAL_ADVICE_STEER : ''].filter(Boolean).join('\n\n');

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
          'Search across every collection in the Investment Research Library and return the most relevant source passages.',
        parameters: z.object({
          query: z.string().max(500).describe('the topic, term, or sub-question to search for'),
        }),
        execute: async ({ query }) => {
          // A failed search returns no passages instead of breaking the whole answer.
          let hits: Awaited<ReturnType<typeof index.query>> = [];
          try {
            const { embedding } = await embed({
              model: openai.embedding(process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small', { user: openaiUser }),
              value: redactPII(query).clean,
            });
            // Only this country's documents plus general ones. Chunks seeded before
            // country tags existed have no country and are kept as a fallback.
            try {
              hits = await index.query({
                vector: embedding,
                topK: TOP_K,
                includeMetadata: true,
                filter: `country = '${country}' OR country = 'GLOBAL'`,
              });
            } catch (err) {
              safeLog('search_filter_error', { message: err instanceof Error ? err.message : String(err) });
            }
            if (!hits.length) {
              hits = (await index.query({ vector: embedding, topK: TOP_K, includeMetadata: true }))
                .filter((h) => h.metadata?.country === undefined || h.metadata?.country === country || h.metadata?.country === 'GLOBAL');
            }
          } catch (err) {
            safeLog('search_error', { message: err instanceof Error ? err.message : String(err) });
            return [];
          }
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
              country: (h.metadata?.country as string) ?? '',
              score: h.score,
            }));
        },
      }),
      projectWealth: tool({
        description:
          "Project future wealth from age, current savings, monthly contributions, expected return, fees and inflation, with an optional goal (a target balance or a yearly retirement income, both in today's dollars). Returns Low/Expected/High scenarios, balances at ages 55/60/65/70, sustainable retirement income, and progress towards the goal.",
        parameters: checkedLater(ProjectionInputSchema),
        execute: async (raw) => {
          const checked = ProjectionInputSchema.safeParse(raw);
          if (!checked.success) return { ok: false as const, error: `${describeIssues(checked.error)}. ${OUT_OF_RANGE_HELP}` };
          const input = checked.data;
          try {
            // The model gets a compact summary; the browser redraws the full
            // chart from the same inputs, so yearly series never cost tokens.
            const analysis = summariseAnalysis(analyseHousehold(projectHousehold(householdFromSimple(input, input.country ?? amountsIn ?? country), { monteCarlo: false })));
            return { ok: true as const, ...summariseProjection(projectWealth(input)), country, analysis };
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid inputs' };
          }
        },
      }),
      getExchangeRates: tool({
        description:
          "Today's exchange rates (European Central Bank reference rates via Frankfurter). Call it before projectHousehold whenever the plan uses more than one currency, and put the results in projectHousehold's fx list.",
        parameters: z.object({
          home: z.enum(CURRENCIES).describe('Currency of the country the user lives in'),
          currencies: z.array(z.enum(CURRENCIES)).min(1).max(4).describe('The other currencies in the plan'),
        }),
        execute: async ({ home, currencies }) => {
          const quote = await fetchRates(home, currencies.filter(isCurrency));
          return quote
            ? { ok: true as const, date: quote.date, source: quote.source, valueOfOneUnitIn: { currency: home, ...quote.perUnit } }
            : { ok: false as const, error: "Rates couldn't be fetched. Ask the user for the rate or use a clearly labelled rough rate." };
        },
      }),
      projectHousehold: tool({
        description:
          "Project a whole household in one run: one person or a couple, cash, several investments (KiwiSaver, shares, funds), properties with their mortgages, other assets and debts, incomes (salary, dividends, rent, pensions such as NZ Super) and expenses (living costs, children, parents, pets, other). Monthly surplus is reinvested and shortfalls are drawn from savings. Optionally compares several return assumptions side by side. Returns net worth at each age in today's dollars, when money runs out, goal progress, warnings, and a portfolio analysis (strengths, weaknesses, risks, and measured levers to explore).",
        parameters: checkedLater(HouseholdInputSchema),
        execute: async (raw) => {
          const checked = HouseholdInputSchema.safeParse(raw);
          if (!checked.success) return { ok: false as const, error: `${describeIssues(checked.error)}. ${OUT_OF_RANGE_HELP}` };
          try {
            const projection = projectHousehold(checked.data);
            return { ok: true as const, ...summariseHousehold(projection), analysis: summariseAnalysis(analyseHousehold(projection)) };
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
  if (quota.limit !== undefined) headers['X-Questions-Limit'] = String(quota.limit);
  if (quota.tier) headers['X-Questions-Tier'] = quota.tier;
  if (holdForCheck) headers['X-Answer-Check'] = 'held';

  return result.toDataStreamResponse({
    headers,
    getErrorMessage: (error) => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      safeLog('chat_error', { message: detail });
      // On your own computer, show the real reason to make problems easy to fix.
      const dev = process.env.NODE_ENV !== 'production';
      return `Sorry, something went wrong while answering. Please try again in a moment.${dev ? ` (Details for the developer: ${detail.slice(0, 300)})` : ''}`;
    },
  });
}
