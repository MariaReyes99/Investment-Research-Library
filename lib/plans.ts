/** Plans from the business plan's freemium and membership models (NZD, GST inclusive). */
export type Plan = 'free' | 'basic' | 'premium' | 'pro';
export type PaidPlan = Exclude<Plan, 'free'>;

export const PLANS: Record<Plan, { label: string; priceNzd: number; dailyQuestions: number; features: string[] }> = {
  free: { label: 'Free', priceNzd: 0, dailyQuestions: 5, features: ['5 library questions a day', 'Wealth projector', 'Cited answers'] },
  basic: { label: 'Basic', priceNzd: 15, dailyQuestions: 50, features: ['50 questions a day', 'Projections inside answers', 'Full library'] },
  premium: { label: 'Premium', priceNzd: 30, dailyQuestions: 200, features: ['200 questions a day', 'Everything in Basic', 'Priority for new features'] },
  pro: { label: 'Pro', priceNzd: 50, dailyQuestions: 1000, features: ['Unlimited questions (fair use)', 'Everything in Premium'] },
};

export const PAID_PLANS: PaidPlan[] = ['basic', 'premium', 'pro'];

export function planFrom(metadata: unknown): Plan {
  const p = (metadata as { plan?: string } | undefined)?.plan;
  return p === 'basic' || p === 'premium' || p === 'pro' ? p : 'free';
}
