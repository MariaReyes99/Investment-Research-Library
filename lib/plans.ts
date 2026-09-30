/**
 * Plans (NZD per month, GST inclusive). Question allowances are monthly: people
 * tend to ask many questions in one sitting and then none for weeks.
 * The cost model behind these prices is in docs/cost-benefit-analysis.xlsx.
 *
 * The "pro" id is kept for the Adviser plan so existing Stripe settings
 * (STRIPE_PRICE_PRO) keep working; point it at the Adviser price in Stripe.
 */
export type Plan = 'free' | 'basic' | 'premium' | 'pro';
export type PaidPlan = Exclude<Plan, 'free'>;

export interface PlanInfo {
  label: string;
  priceNzd: number;
  monthlyQuestions: number;
  /** Saved plans, side-by-side comparison and PDF reports in the projector. */
  savedPlans: boolean;
  features: string[];
}

export const PLANS: Record<Plan, PlanInfo> = {
  free: {
    label: 'Free', priceNzd: 0, monthlyQuestions: 5, savedPlans: false,
    features: ['5 library questions a month', 'Full wealth projector with portfolio analysis', 'Cited answers'],
  },
  basic: {
    label: 'Basic', priceNzd: 15, monthlyQuestions: 150, savedPlans: false,
    features: ['150 questions a month (about 5 a day)', 'Projections and analysis inside answers', 'Full library'],
  },
  premium: {
    label: 'Premium', priceNzd: 29, monthlyQuestions: 300, savedPlans: true,
    features: ['300 questions a month (about 10 a day)', 'Save plans and compare them side by side', 'PDF reports to take to an adviser', 'Everything in Basic'],
  },
  pro: {
    label: 'Adviser', priceNzd: 150, monthlyQuestions: 1000, savedPlans: true,
    features: ['1,000 questions a month', 'For advisers and planners working with clients', 'Everything in Premium'],
  },
};

export const PAID_PLANS: PaidPlan[] = ['basic', 'premium', 'pro'];

/**
 * Questions a month for visitors who haven't signed in (counted by hashed IP).
 * Kept below the free plan so there's a reason to create a free account.
 * Set to 0 to require sign-in before any question.
 */
export const ANONYMOUS_MONTHLY_QUESTIONS = 2;

export function planFrom(metadata: unknown): Plan {
  const p = (metadata as { plan?: string } | undefined)?.plan;
  return p === 'basic' || p === 'premium' || p === 'pro' ? p : 'free';
}

export function canSavePlans(plan: Plan): boolean {
  return PLANS[plan].savedPlans;
}
