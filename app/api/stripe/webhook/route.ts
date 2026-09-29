/**
 * POST /api/stripe/webhook
 *
 * Stripe reports subscription changes here. The signature is verified so
 * nobody can fake an upgrade, then only the plan name is stored on the Clerk
 * user. No card numbers, names or addresses are stored by this app.
 *
 * Stripe dashboard → Developers → Webhooks → add this URL with the events:
 *   checkout.session.completed, customer.subscription.updated,
 *   customer.subscription.deleted
 */
import Stripe from 'stripe';
import { safeLog } from '../../../../lib/guardrails/pii';
import type { Plan } from '../../../../lib/plans';

export const runtime = 'nodejs';

async function setPlan(userId: string, plan: Plan, stripeCustomerId?: string) {
  const { clerkClient } = await import('@clerk/nextjs/server');
  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { plan },
    ...(stripeCustomerId ? { privateMetadata: { stripeCustomerId } } : {}),
  });
}

const isPlan = (p: unknown): p is Plan => p === 'basic' || p === 'premium' || p === 'pro';

/** Plan from the subscription's price, so plan changes in the billing portal are picked up. */
function planFromPrice(priceId: string | undefined): Plan | undefined {
  const map: Record<string, Plan> = {};
  if (process.env.STRIPE_PRICE_BASIC) map[process.env.STRIPE_PRICE_BASIC] = 'basic';
  if (process.env.STRIPE_PRICE_PREMIUM) map[process.env.STRIPE_PRICE_PREMIUM] = 'premium';
  if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = 'pro';
  return priceId ? map[priceId] : undefined;
}

export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Stripe is not configured.', { status: 503 });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  if (Number(req.headers.get('content-length') ?? '0') > 1_000_000) return new Response('Payload too large.', { status: 413 });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature.', { status: 400 });

  let event: Stripe.Event;
  try {
    // The raw body is required for signature verification.
    event = stripe.webhooks.constructEvent(await req.text(), signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('Invalid signature.', { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      const plan = s.metadata?.plan;
      if (s.client_reference_id && isPlan(plan)) {
        await setPlan(s.client_reference_id, plan, typeof s.customer === 'string' ? s.customer : undefined);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const active = event.type === 'customer.subscription.updated' && (sub.status === 'active' || sub.status === 'trialing');
      const plan = planFromPrice(sub.items.data[0]?.price.id) ?? (isPlan(sub.metadata.plan) ? sub.metadata.plan : undefined);
      await setPlan(userId, active && plan ? plan : 'free');
      break;
    }
  }

  safeLog('stripe_event', { type: event.type, id: event.id }); // ids only, never the payload
  return Response.json({ received: true });
}
