/**
 * POST /api/billing-portal
 *
 * Opens Stripe's customer portal, where subscribers can change plan, update
 * their card, download invoices or cancel at any time. Cancellations take
 * effect at the end of the period already paid for (set this in Stripe:
 * Settings → Billing → Customer portal). The Stripe webhook then moves the
 * account back to Free.
 */
import Stripe from 'stripe';
import { clerkEnabled } from '../../../lib/viewer';
import { assertSameOrigin } from '../../../lib/security';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const crossSite = assertSameOrigin(req);
  if (crossSite) return json({ error: crossSite.message }, crossSite.status);
  if (!process.env.STRIPE_SECRET_KEY || !clerkEnabled) return json({ error: 'Billing is not set up yet.' }, 503);

  const { auth, clerkClient } = await import('@clerk/nextjs/server');
  const { userId } = await auth();
  if (!userId) return json({ error: 'Sign in to manage your plan.' }, 401);

  const user = await (await clerkClient()).users.getUser(userId);
  const customer = (user.privateMetadata as { stripeCustomerId?: string }).stripeCustomerId;
  if (!customer) return json({ error: "We couldn't find a subscription for this account." }, 404);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  try {
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/pricing` });
    return json({ url: session.url });
  } catch {
    return json({ error: "The billing page couldn't open. Try again, or contact us to cancel." }, 502);
  }
}
