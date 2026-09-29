/**
 * Plans and daily question limits (freemium model from the business plan).
 *
 * Limits are stored in Upstash Redis (a separate database from Upstash Vector).
 * If UPSTASH_REDIS_REST_URL is not set, limits are skipped so local development
 * still works; always set it in production.
 */
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

import { PLANS, type Plan } from './plans';

export { PLANS, planFrom, type Plan } from './plans';

const redisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = redisConfigured ? Redis.fromEnv() : null;

const limiters = redis
  ? (Object.fromEntries(
      (Object.keys(PLANS) as Plan[]).map((plan) => [
        plan,
        new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(PLANS[plan].dailyQuestions, '1 d'), prefix: `irl:q:${plan}` }),
      ]),
    ) as Record<Plan, Ratelimit>)
  : null;

/** Short burst limit for everyone, to stop scripted abuse. */
const burst = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(8, '1 m'), prefix: 'irl:burst' }) : null;

export type QuotaResult = { allowed: boolean; remaining: number | null; reason?: string };

export async function checkQuota(viewerKey: string, plan: Plan, signedIn: boolean): Promise<QuotaResult> {
  if (!limiters || !burst) return { allowed: true, remaining: null };
  const b = await burst.limit(viewerKey);
  if (!b.success) return { allowed: false, remaining: 0, reason: 'Too many questions in a short time. Wait a minute and try again.' };
  const r = await limiters[plan].limit(viewerKey);
  if (r.success) return { allowed: true, remaining: r.remaining };
  return {
    allowed: false,
    remaining: 0,
    reason:
      plan === 'free'
        ? `You've used today's ${PLANS.free.dailyQuestions} free questions. ${signedIn ? 'Upgrade on the Plans page' : 'Sign in and upgrade on the Plans page'} for more, or come back tomorrow.`
        : "You've reached today's fair-use limit. It resets within 24 hours.",
  };
}
