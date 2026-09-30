/**
 * POST /api/checkout  { plan: "basic" | "premium" | "pro" }
 *
 * Creates a Stripe Checkout Session and returns its URL. Customers type their
 * card details on Stripe's hosted page, so card data never reaches this app
 * (the lightest PCI scope, SAQ A). Never add card fields to this site's forms.
 */
import Stripe from 'stripe';
import { z } from 'zod';
import { clerkEnabled, getViewer } from '../../../lib/viewer';
import { checkCheckoutLimit } from '../../../lib/entitlements';
import { securityAlert } from '../../../lib/alerts';
import { assertSameOrigin, readJsonBody } from '../../../lib/security';

const PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  premium: process.env.STRIPE_PRICE_PREMIUM,
  pro: process.env.STRIPE_PRICE_PRO,
} as const;

const Body = z.object({ plan: z.enum(['basic', 'premium', 'pro']) });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const crossSite = assertSameOrigin(req);
  if (crossSite) return json({ error: crossSite.message }, crossSite.status);
  if (!process.env.STRIPE_SECRET_KEY || !clerkEnabled) {
    return json({ error: 'Paid plans are not open yet.' }, 503);
  }
  const { auth } = await import('@clerk/nextjs/server');
  const { userId } = await auth();
  if (!userId) return json({ error: 'Sign in to choose a plan.' }, 401);

  const viewer = await getViewer(req);
  if (!(await checkCheckoutLimit(viewer.key))) {
    await securityAlert('checkout_rate_limited', '/api/checkout');
    return json({ error: 'Too many checkout attempts. Try again in a few minutes.' }, 429);
  }

  const body = await readJsonBody(req, 1024);
  if (!body.ok) return json({ error: body.message }, body.status);
  const parsed = Body.safeParse(body.data);
  if (!parsed.success) return json({ error: 'Unknown plan.' }, 400);
  const price = PRICE_IDS[parsed.data.plan];
  if (!price) return json({ error: 'This plan is not available yet.' }, 503);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId, // links the payment to the account without sharing personal details
    metadata: { userId, plan: parsed.data.plan },
    subscription_data: { metadata: { userId, plan: parsed.data.plan } },
    allow_promotion_codes: true,
    // GST: turn on once you're GST-registered and Stripe Tax is set up.
    ...(process.env.STRIPE_AUTOMATIC_TAX === 'true' ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${origin}/pricing?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  });

  return json({ url: session.url });
}
