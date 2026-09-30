/**
 * Turns a simple savings projection (projectWealth inputs) into a household
 * plan, so every projection in the chat gets the same analysis: strengths,
 * weaknesses, risks, Monte Carlo and measured levers.
 */
import type { ProjectionInput } from './projections';
import type { HouseholdInput } from './household';
import type { CountryCode } from '../countries';

export function householdFromSimple(p: ProjectionInput, country: CountryCode = 'NZ'): HouseholdInput {
  const assets = p.assets?.length
    ? p.assets.filter((a) => a.kind !== 'property' && a.kind !== 'vehicle' && a.kind !== 'jewelry')
    : [];
  const investments: NonNullable<HouseholdInput['investments']> = assets.length
    ? assets.map((a) => ({
        name: a.name,
        kind: a.kind === 'kiwisaver' ? 'kiwisaver' : a.kind === 'cash' ? 'term_deposit' : a.kind === 'bonds' ? 'bonds' : 'shares',
        balance: a.currentBalance,
        returnPct: a.growthEnabled === false ? 0 : a.expectedReturnPct ?? 0,
        feesPct: a.feesPct ?? 0,
        monthlyContribution: a.monthlyContribution ?? 0,
      }))
    : [{
        name: 'Savings',
        kind: 'shares',
        balance: p.currentSavings,
        returnPct: p.expectedReturnPct,
        feesPct: p.feesPct ?? 0.5,
        monthlyContribution: p.monthlyContribution,
      }];
  const properties = (p.assets ?? []).filter((a) => a.kind === 'property').map((a) => ({
    name: a.name,
    value: a.currentBalance,
    growthPct: a.expectedReturnPct ?? 3,
    mortgageBalance: (p.debts ?? []).filter((d) => d.assetId === a.id).reduce((s, d) => s + d.currentBalance, 0),
    monthlyRepayment: (p.debts ?? []).filter((d) => d.assetId === a.id).reduce((s, d) => s + (d.monthlyPayment ?? 0), 0),
  }));
  const desired = p.goal?.desiredAnnualIncome;
  const hasCashflow = (p.monthlyHouseholdIncome ?? 0) > 0;
  return {
    country,
    you: { currentAge: p.currentAge, retirementAge: p.retirementAge },
    endAge: p.endAge ?? 90,
    inflationPct: p.inflationPct ?? 2.5,
    investments,
    properties,
    incomes: hasCashflow ? [{ name: 'Take-home pay', kind: 'salary', monthlyAmount: p.monthlyHouseholdIncome! }] : [],
    livingExpensesMonthly: hasCashflow ? p.monthlyLivingExpenses ?? 0 : 0,
    retirementLivingExpensesMonthly: desired ? desired / 12 : hasCashflow ? p.monthlyLivingExpenses : undefined,
    contributionsFromOutsideIncome: !hasCashflow,
    volatilityPct: p.volatilityPct ?? 12,
    goal: p.goal?.targetAmount ? { targetNetWorth: p.goal.targetAmount, targetAge: p.goal.targetAge } : undefined,
  };
}
