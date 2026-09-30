# New plans, monthly allowances, cancel any time

Unzip into Caps_Invst and choose Replace, then restart `npm run dev`.

## In Stripe (Dashboard)
1. Products: set Basic to NZ$15/month and Premium to NZ$29/month (create new prices if needed).
2. Create an Adviser product at NZ$150/month. Put its price ID in STRIPE_PRICE_PRO
   (in .env.local and on Vercel). The app keeps the id "pro" for this plan.
3. Settings > Billing > Customer portal: turn on "Cancel subscriptions" (at end of billing period)
   and "Switch plans" with Basic, Premium and Adviser. Save.
4. Webhook: add the event customer.subscription.updated and customer.subscription.deleted if not already.

## Plans in the app (lib/plans.ts)
Free 5 questions a month; Basic NZ$15, 150 a month; Premium NZ$29, 300 a month + saved plans and PDF;
Adviser NZ$150, 1,000 a month. Visitors without an account: 2 a month.

## Cost model
docs/cost-benefit-analysis.xlsx
