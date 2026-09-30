/**
 * Security alerts to the site owner.
 *
 * Sends a short message to a chat channel you choose when something suspicious
 * happens, so you hear about possible attacks or incidents quickly:
 *  - a forged Stripe webhook (an attempt to unlock a plan without paying)
 *  - card numbers typed into the chat (blocked, never sent anywhere)
 *  - a burst of checkout attempts (possible card testing)
 *  - usage limits that can't be checked (the chat is refusing questions)
 *  - answers failing with errors
 *
 * Set ALERT_WEBHOOK_URL to a Slack or Discord "incoming webhook" URL. Without
 * it, alerts are only written to the server log.
 *
 * Alerts never include what a user typed, their name, or any key: only what
 * happened, where and when. Each kind is sent at most once an hour.
 */
import { Redis } from '@upstash/redis';
import { safeLog } from './guardrails/pii';

export type AlertKind =
  | 'webhook_signature_invalid'
  | 'card_data_blocked'
  | 'checkout_rate_limited'
  | 'usage_limits_unavailable'
  | 'chat_errors';

const DESCRIPTIONS: Record<AlertKind, string> = {
  webhook_signature_invalid: 'A Stripe webhook arrived with an invalid signature. Someone may be trying to fake a payment, or STRIPE_WEBHOOK_SECRET is wrong.',
  card_data_blocked: 'Someone typed card details into the chat. The message was blocked and not sent anywhere.',
  checkout_rate_limited: 'Checkout attempts hit the rate limit. This can mean someone is testing stolen cards; check Stripe for failed payments.',
  usage_limits_unavailable: "Usage limits couldn't be checked, so the chat is refusing questions. Check Upstash Redis.",
  chat_errors: 'Answers are failing with errors. Check the Vercel logs for chat_error.',
};

const THROTTLE_SECONDS = 3600;
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;
const recent = new Map<AlertKind, number>();

async function shouldSend(kind: AlertKind): Promise<boolean> {
  const now = Date.now();
  const last = recent.get(kind);
  if (last && now - last < THROTTLE_SECONDS * 1000) return false;
  recent.set(kind, now);
  if (!redis) return true;
  try {
    // One alert per kind per hour across every server instance
    return (await redis.set(`irl:alert:${kind}`, now, { nx: true, ex: THROTTLE_SECONDS })) === 'OK';
  } catch {
    return true;
  }
}

export async function securityAlert(kind: AlertKind, where: string): Promise<void> {
  safeLog('security_alert', { kind, where });
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !(await shouldSend(kind))) return;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'Investment Research Library';
  const text = `Security alert (${site}): ${DESCRIPTIONS[kind]} Where: ${where}. Time: ${new Date().toISOString()}. Further alerts of this kind are paused for an hour.`;
  try {
    // "text" is read by Slack, "content" by Discord
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* an alert must never break the request */
  }
}
