# Compliance and trust checklist

Status as at 30 September 2026. Items marked **needs a professional** can't be finished in code.

## 1. Legal review of disclaimers (needs a professional)

The disclaimer wording in `lib/countries.ts` (`disclaimerFor`) and on `/about` and `/methodology` is a **draft**.
Before charging users in a country, have a lawyer there confirm:

| Country | Regulator | Questions for the lawyer |
|---|---|---|
| New Zealand | Financial Markets Authority (FMA) | Does the service stay outside "regulated financial advice" under the Financial Markets Conduct Act 2013? Is a Financial Advice Provider licence needed? Privacy Act 2020 wording. |
| Australia | ASIC | Does it stay within "general advice", and is the general advice warning adequate? Is an AFS licence (or authorised representative arrangement) needed? |
| United Kingdom | FCA | Is anything a "regulated activity" (advising on investments) or a financial promotion that needs approval? UK GDPR wording. |
| United States | SEC (and state regulators) | Could it be treated as an investment adviser? Is the publisher exclusion available? State privacy laws. |
| Philippines | SEC Philippines | Does it require registration as an investment adviser? Data Privacy Act 2012 wording. |

Also review: the personal-advice guardrail (`lib/guardrails/advice.ts`), the "levers to explore" wording
(`lib/finance/householdAnalysis.ts`), refund and cancellation terms, and the privacy policy.

## 2. Sources and review dates (done)

- Every document in `data/corpus/sources.json` has a source URL, licence, country, `asOf` date and `reviewEveryMonths`.
- `/sources` shows every document and when it is due for review.
- `npm run check:sources` fails if any review is overdue. Run it before each deploy.
- After updating a document, change its `asOf` date and run `npm run seed`.
- Country defaults (pension ages, access ages) in `lib/countries.ts` are dated by `PROFILES_AS_AT`; review them every 6 months.

## 3. Quality control (done)

- `npm test`: calculation tests (projection engine, analysis, guardrails, privacy, security).
- `npm run eval`: re-runs `tests/eval/questions.json` against the chat and checks tool use, citations and wording.
  Run it after any change to the prompt, tools or corpus, and add a question whenever you find a bad answer.

## 4. Holdings-level analysis, like Morningstar X-Ray (needs a data licence)

Asset mix, regional split, sector exposure and overlap between funds need each fund's holdings, which fund
managers and data vendors license. Options to price: Morningstar data feeds, FactSet/Refinitiv, or
provider disclosures (NZ fund updates on the Disclose Register, Australian product disclosure statements).
Once licensed, add a `holdings` table keyed by fund code and extend `householdAnalysis.ts`.
A free interim step: let users enter each fund's asset mix and region split by hand.

## 5. Historical backtesting (needs a data licence)

The projector uses random simulated markets (Monte Carlo). Replaying actual past returns needs a licensed
historical return series for each country's shares, bonds and cash. Check the licence allows display in a paid product.

## 6. Tax by country (partly done)

Each investment can be marked after-tax, taxed yearly, taxed on withdrawal or tax-free, at a rate the user enters.
Not modelled: tax brackets, NZ PIE and FIF calculations, Australian super contribution caps, US Roth conversions,
UK ISA and pension allowances, Philippine final withholding taxes. Add these one country at a time, each with
sourced documents and tests.

## 7. Security monitoring and breach response (done in code; follow the plan if something happens)

**Alerts:** set `ALERT_WEBHOOK_URL` (a Slack or Discord incoming webhook) in Vercel. You are messaged, at most once an
hour per kind, when: a Stripe webhook has a bad signature, card details are typed into the chat, checkout attempts hit
the rate limit, usage limits can't be checked, or answers fail with errors. Alerts contain no user content.

**Also switch on the alerts each service already offers:** GitHub secret scanning and Dependabot emails, Stripe email
notifications (disputes, Radar, failed payments), OpenAI usage and budget alerts, Vercel spend notifications.

**If you suspect a breach (unauthorised access to accounts, keys, or users' information):**
1. Contain: rotate every key (OpenAI, Stripe, Clerk, Upstash, IP_HASH_SALT stays unless exposed), change passwords, sign out other sessions, redeploy.
2. Assess: what was accessed, whose information, and whether it could cause serious harm.
3. Notify: under the Privacy Act 2020, a notifiable privacy breach (likely to cause serious harm) must be reported to the
   Privacy Commissioner as soon as practicable (the NotifyUs tool on privacy.org.nz), and the affected people told.
   Users overseas may be covered by their own country's rules as well.
4. Record: what happened, when, what you did, and what you changed so it can't happen again.
