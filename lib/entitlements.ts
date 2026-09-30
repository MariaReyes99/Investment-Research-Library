/**
 * Plans, monthly question allowances (30-day windows) and burst limits.
 *
 * Tiers, from the bottom up:
 *  - anonymous visitors (not signed in): ANONYMOUS_MONTHLY_QUESTIONS a month, by hashed IP
 *  - free accounts: PLANS.free.monthlyQuestions a month
 *  - paid plans: their own monthly allowance
 * When someone runs out, the chat shows a sign-in or upgrade panel.
 *
 * Counts are stored in Upstash Redis (a separate database from Upstash Vector).
 * In production, if Redis isn't configured the API refuses questions rather
 * than running without limits, because an unlimited public endpoint can be
 * used to run up large OpenAI bills.
 *
 * Locally (npm run dev) limits are skipped, so you can test freely. To try the
 * limit and upgrade flow on your own computer, set ENFORCE_LIMITS=true in
 * .env.local (Redis must be configured). To deliberately run without limits in
 * production, set ALLOW_NO_RATE_LIMIT=true.
 */
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { ANONYMOUS_MONTHLY_QUESTIONS, PLANS, type Plan } from './plans';
import { clerkEnabled } from './viewer';

export { PLANS, planFrom, type Plan } from './plans';

/** Who the limit applies to. Anonymous visitors only exist as a tier when sign-in is available. */
export type Tier = Plan | 'anonymous';

const redisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = redisConfigured ? Redis.fromEnv() : null;
export const limitsActive =
  (process.env.NODE_ENV === 'production' && process.env.ALLOW_NO_RATE_LIMIT !== 'true') ||
  process.env.ENFORCE_LIMITS === 'true';

export function tierFor(plan: Plan, signedIn: boolean): Tier {
  return !signedIn && clerkEnabled ? 'anonymous' : plan;
}

export function monthlyLimit(tier: Tier): number {
  return tier === 'anonymous' ? ANONYMOUS_MONTHLY_QUESTIONS : PLANS[tier].monthlyQuestions;
}

const TIERS: Tier[] = ['anonymous', ...(Object.keys(PLANS) as Plan[])];
const limiters = redis
  ? (Object.fromEntries(
      TIERS.filter((t) => monthlyLimit(t) > 0).map((t) => [
        t,
        new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(monthlyLimit(t), '30 d'), prefix: `irl:m:${t}` }),
      ]),
    ) as Partial<Record<Tier, Ratelimit>>)
  : null;

/** Short burst limit for everyone, to stop scripted abuse. */
const burst = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(8, '1 m'), prefix: 'irl:burst' }) : null;
const checkoutLimit = redis ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '10 m'), prefix: 'irl:checkout' }) : null;

export type QuotaResult = {
  allowed: boolean;
  remaining: number | null;
  limit?: number;
  reason?: string;
  notConfigured?: boolean;
  /** The monthly allowance is used up (as opposed to the burst limit or an outage). */
  limitReached?: boolean;
  tier?: Tier;
  /** When the allowance resets (ms since epoch). */
  reset?: number;
};

const NOT_CONFIGURED: QuotaResult = {
  allowed: false,
  notConfigured: true,
  remaining: 0,
  reason: "The library isn't accepting questions yet. (Site owner: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.)",
};

const resetText = (reset?: number) =>
  reset ? ` It resets on ${new Date(reset).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })}.` : '';

function limitMessage(tier: Tier, reset?: number): string {
  if (tier === 'anonymous') {
    return `You've used the ${ANONYMOUS_MONTHLY_QUESTIONS} questions for visitors this month. Sign in for ${PLANS.free.monthlyQuestions} free questions a month, or choose a plan for more.`;
  }
  if (tier === 'free') {
    return `You've used this month's ${PLANS.free.monthlyQuestions} free questions. Choose a plan to keep asking.${resetText(reset)}`;
  }
  return `You've used this month's ${PLANS[tier].monthlyQuestions} questions on the ${PLANS[tier].label} plan.${resetText(reset)}`;
}

export async function checkQuota(viewerKey: string, plan: Plan, signedIn: boolean): Promise<QuotaResult> {
  const tier = tierFor(plan, signedIn);
  const limit = monthlyLimit(tier);
  if (!limitsActive) return { allowed: true, remaining: null, tier, limit };
  if (!limiters || !burst) return NOT_CONFIGURED;
  const limiter = limiters[tier];
  if (!limiter) return { allowed: false, remaining: 0, limit, tier, limitReached: true, reason: limitMessage(tier) };
  try {
    const b = await burst.limit(viewerKey);
    if (!b.success) return { allowed: false, remaining: null, tier, reason: 'Too many questions in a short time. Wait a minute and try again.' };
    const r = await limiter.limit(viewerKey);
    if (r.success) return { allowed: true, remaining: r.remaining, limit, tier, reset: r.reset };
    return { allowed: false, remaining: 0, limit, tier, limitReached: true, reset: r.reset, reason: limitMessage(tier, r.reset) };
  } catch {
    return {
      allowed: false,
      notConfigured: true,
      remaining: 0,
      reason: 'The library is temporarily unavailable because usage limits could not be checked. Please try again later.',
    };
  }
}

export type Usage = { tier: Tier; limit: number; remaining: number | null; limitsActive: boolean; reset?: number };

/** How many questions are left this month, without using one up. */
export async function getUsage(viewerKey: string, plan: Plan, signedIn: boolean): Promise<Usage> {
  const tier = tierFor(plan, signedIn);
  const limit = monthlyLimit(tier);
  if (!limitsActive || !limiters) return { tier, limit, remaining: null, limitsActive };
  const limiter = limiters[tier];
  if (!limiter) return { tier, limit, remaining: 0, limitsActive };
  try {
    const r = await limiter.getRemaining(viewerKey);
    return { tier, limit, remaining: Math.max(0, r.remaining), limitsActive, reset: r.reset };
  } catch {
    return { tier, limit, remaining: null, limitsActive };
  }
}

/** Limit checkout attempts (stops scripted card-testing and checkout spam). */
export async function checkCheckoutLimit(viewerKey: string): Promise<boolean> {
  if (!limitsActive) return true;
  if (!checkoutLimit) return false;
  try {
    return (await checkoutLimit.limit(viewerKey)).success;
  } catch {
    return false;
  }
}
