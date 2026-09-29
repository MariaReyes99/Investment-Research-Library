# Investment Research Library: drop-in modules

Copy these folders into the root of the ACME Widget API Next.js project (App Router, `@/` alias pointing at the root).

| File | What it does |
|---|---|
| `lib/finance/projections.ts` | Wealth projection engine: compound growth, age milestones (55/60/65/70), Low/Base/High scenarios, inflation-adjusted values, goal gap, required monthly contribution, Monte Carlo probability, drawdown. Also exports the OpenAI tool schema. |
| `lib/guardrails/pii.ts` | Redacts emails, phones, NZ IRD numbers (checksum), NZ bank accounts, addresses, DOB, passport/licence, API keys. Card numbers (Luhn), CVV and expiry **block** the request. `safeLog()` replaces `console.log`. |
| `lib/guardrails/advice.ts` | System prompt, personal-advice detection, output check with one rewrite + safe fallback, disclaimer, prompt-injection-safe source wrapping. |
| `lib/entitlements.ts` | Free 5 questions/day; Basic/Premium/Pro limits; burst limit. |
| `lib/rag/retrieve.ts` | Upstash Vector retrieval adapter. Replace the body with your existing search function if you have one. |
| `app/api/research/route.ts` | The guarded Q&A endpoint. |
| `app/api/checkout/route.ts` | Stripe Checkout (hosted page, so card data never touches your server). |
| `app/api/stripe/webhook/route.ts` | Signature-verified webhook; stores only the plan name on the Clerk user. |
| `components/WealthProjector.tsx` | Calculator UI that runs in the browser. Inputs are never sent or stored. |
| `tests/` | `npx tsx --test tests/*.test.ts` (13 tests). |

## Install

```bash
npm i zod openai stripe @clerk/nextjs @upstash/redis @upstash/ratelimit @upstash/vector recharts
npm i -D tsx
```

## Environment variables (Vercel → Settings → Environment Variables)

```
OPENAI_API_KEY=
CHAT_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small      # must match what you ingested with
UPSTASH_VECTOR_REST_URL=
UPSTASH_VECTOR_REST_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_BASIC=
STRIPE_PRICE_PREMIUM=
STRIPE_PRICE_PRO=
NEXT_PUBLIC_SITE_URL=https://your-domain
```

Never prefix secrets with `NEXT_PUBLIC_`; those are shipped to the browser.

## Wiring

1. Add `clerkMiddleware()` in `middleware.ts` and wrap `app/layout.tsx` in `<ClerkProvider>`.
2. Exclude `/api/stripe/webhook` from auth in the middleware matcher (Stripe calls it, not a user).
3. Page for the calculator: `app/calculators/wealth/page.tsx` → `export default function Page(){ return <WealthProjector /> }`.
4. Chat UI: POST `{ question }` to `/api/research`; show `answer`, list `sources`, show `privacyNotice` if present, and if `projection` is returned, render its chart. On 429 with `upgrade: true`, show the pricing page.
5. When ingesting, set vector metadata `{ title, section, text, url, collection, licence }`.
6. Local webhook testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
