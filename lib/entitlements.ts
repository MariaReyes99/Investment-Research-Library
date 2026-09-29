/**
 * Plans, daily question limits and burst limits.
 *
 * Limits are stored in Upstash Redis (a separate database from Upstash Vector).
 * In production, if Redis isn't configured the API refuses questions rather
 * than running without limits, because an unlimited public endpoint can be
 * used to run up large OpenAI bills. Locally (npm run dev) limits are skipped.
 * To deliberately run without limits in production, set ALLOW_NO_RATE_LIMIT=true.
 */
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { PLANS, type Plan } from './plans';

export { PLANS, planFrom, type Plan } from './plans';

const redisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = redisConfigured ? Redis.fromEnv() : null;
const mustLimit = process.env.NODE_ENV === 'production' && process.env.ALLOW_NO_RATE_LIMIT !== 'true';

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
const checkoutLimit = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '10 m'), prefix: 'irl:checkout' }) : null;

export type QuotaResult = { allowed: boolean; remaining: number | null; reason?: string; notConfigured?: boolean };

const NOT_CONFIGURED: QuotaResult = {
  allowed: false,
  notConfigured: true,
  remaining: 0,
  reason: "The library isn't accepting questions yet. (Site owner: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.)",
};

export async function checkQuota(viewerKey: string, plan: Plan, signedIn: boolean): Promise<QuotaResult> {
  if (!mustLimit) return { allowed: true, remaining: null };
  if (!limiters || !burst) return NOT_CONFIGURED;
  try {
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
  } catch {
    return {
      allowed: false,
      notConfigured: true,
      remaining: 0,
      reason: 'The library is temporarily unavailable because usage limits could not be checked. Please try again later.',
    };
  }
}

/** Limit checkout attempts (stops scripted card-testing and checkout spam). */
export async function checkCheckoutLimit(viewerKey: string): Promise<boolean> {
  if (!mustLimit) return true;
  if (!checkoutLimit) return false;
  try {
    return (await checkoutLimit.limit(viewerKey)).success;
  } catch {
    return false;
  }
}
