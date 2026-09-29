# Investment Research Library

A cited investing research assistant and wealth projector for New Zealand and Australian investors. Converted from the Acme Widget API Field Guide (AIM PostGrad AI, Mini Project 14.3); the original Acme version is in git history on `main`.

**Education, not financial advice.** The assistant explains, compares and projects. It does not tell a specific person what to buy or sell, because regulated financial advice to retail clients in NZ needs an FMA Financial Advice Provider licence.

## Features

- **Cited answers** streamed with the Vercel AI SDK. The model searches the library with `getInformation`, filtered by collection, and every answer shows its sources, with links and the date each was captured.
- **Wealth projections.** `projectWealth` projects savings from age, contributions, return, fees and inflation: Low / Expected / High scenarios in today's dollars, balances at 55/60/65/70, retirement income at a chosen withdrawal rate, the monthly contribution needed to reach a goal, and a Monte Carlo chance of success. The model never does maths itself.
- **Private calculator** at `/calculator`. It runs in the browser, so users' numbers are never sent or stored.
- **Freemium plans**: 5 free questions a day, then Basic / Premium / Pro through Stripe Checkout.

## Guardrails

| Risk | Protection | Where |
|---|---|---|
| Card details in chat | Blocked (HTTP 422), never sent to OpenAI or logged | `lib/guardrails/pii.ts`, chat route |
| Personal details | Email, phone, IRD number (checksum), NZ bank account, address, date of birth, passport/licence and API keys removed before OpenAI, search or logs; the user is told | same |
| Card storage | Stripe's hosted checkout; the app stores only the plan name on the Clerk user | `app/api/checkout`, `app/api/stripe/webhook` |
| Faked upgrades | Stripe webhook signature verified | webhook route |
| Personal advice | System prompt limits, advice-style questions steered to education, advice wording logged for review, disclaimer under every answer | `lib/guardrails/advice.ts` |
| Prompt injection from documents | Retrieved text treated as reference, not instructions | system prompt |
| Cost abuse | Question length and history caps, daily quota per plan, burst limit per minute | `lib/entitlements.ts` |
| Copyright | Only files with a publishable licence in `data/corpus/sources.json` are indexed | `lib/seed.ts` |
| Visitor tracking | Anonymous visitors counted by a salted hash of their IP address, never the raw IP | `lib/viewer.ts` |

## Architecture

```
Browser (app/page.tsx, useChat)          /calculator (runs locally)
   │  POST /api/chat                          │
   ▼                                          ▼
Chat route: redact → quota → streamText   lib/finance/projections.ts
   ├─ getInformation → Upstash Vector (namespace: investment-research-library)
   └─ projectWealth  → lib/finance/projections.ts (summary to model; chart redrawn in browser)

/pricing → /api/checkout → Stripe Checkout → /api/stripe/webhook → Clerk user plan
```

## The library

Each collection is a folder under `data/corpus/` (defined in `lib/collections.ts`):

`Library_Notes`, `Books`, `ETF_Factsheets`, `Berkshire_Letters`, `Vanguard_Whitepapers`, `MSCI_Methodologies`, `NZX_Guides`, `KiwiSaver_Guides`, `FIF_Tax_Guides`

It starts with 11 original explainers (`licence: own-content`). Supported formats: `.md` (split at headings), `.txt`, `.html`, `.pdf` (per page) and `.epub` (per chapter).

### Adding a document

1. Put the file in the right collection folder.
2. Add an entry to `data/corpus/sources.json`:
   ```json
   "ETF_Factsheets/cspx-factsheet.pdf": {
     "title": "iShares Core S&P 500 UCITS ETF factsheet",
     "url": "https://www.ishares.com/...",
     "licence": "permission-granted",
     "publisher": "BlackRock",
     "asOf": "2026-09-30"
   }
   ```
   `licence` must be one of `own-content`, `public-domain`, `cc-by`, `permission-granted`, `licensed` or `personal-study-only`. Files marked `personal-study-only`, or missing from the file, are skipped.
3. Run `npm run seed:check`, then `npm run seed`.

Copyrighted books need a licence from the publisher before they go in the public index. For private study, seed them into a separate namespace instead: `npm run seed -- --include-unlicensed --namespace=private`.

## Run locally

```bash
npm install
cp .env.example .env.local     # fill in OpenAI and Upstash Vector at minimum
npm test                       # unit tests
npm run seed:check             # preview chunks, no API calls
npm run seed                   # embed and upload the library
npm run dev                    # http://localhost:3000
```

## Going live (in this order)

1. **Free public launch.** Set the OpenAI, Upstash Vector and Upstash Redis variables in Vercel. Without Clerk keys the site runs free and anonymous, with 5 questions a day per visitor.
2. **Accounts.** Create a Clerk application and add its two keys. Sign-in appears automatically.
3. **Payments.**
   - In Stripe, create three monthly NZD prices and add their IDs.
   - Add a webhook to `https://your-domain/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`.
   - Turn on the customer billing portal so members can change or cancel their plan.
   - Test locally with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. **Hosting plan.** Move Vercel to the Pro plan once you charge money; the Hobby plan is for non-commercial use.
5. **Legal review.** Have a lawyer review `/about` (financial advice boundary and Privacy Act 2020) and replace the placeholder contact details.

## Tests

`npm test` runs 14 tests. They check:
- the projection engine against the closed-form future-value formula;
- real (today's dollar) values, scenarios, goal solving and money running out;
- redaction of cards, NZ identifiers and secrets, while keeping ages and amounts;
- the IRD and Luhn checksums;
- advice detection.
