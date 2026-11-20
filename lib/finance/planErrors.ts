/**
 * Turns a plan validation problem into one sentence that says where it is and
 * how to fix it. Shared by the guided setup and the Advanced form.
 */
import type { ZodIssue } from 'zod';
import { COUNTRIES, type CountryCode } from '../countries';

type ListKey = 'investments' | 'properties' | 'otherAssets' | 'debts' | 'incomes' | 'dependants' | 'otherExpenses' | 'events' | 'compare';
/** Only the parts of a plan the message needs. */
export type PlanForErrors = { country: CountryCode; fx?: { currency: string }[] } & Partial<Record<ListKey, { name?: string; label?: string }[]>>;

const SECTION_NAMES: Record<string, string> = {
  investments: 'investment', properties: 'property', otherAssets: 'asset', debts: 'debt', incomes: 'income',
  dependants: 'dependant', otherExpenses: 'expense', events: 'event', compare: 'comparison',
};
const FIELD_NAMES: Record<string, string> = {
  name: 'Name', label: 'Label', balance: 'Balance', returnPct: 'Return', feesPct: 'Fees', monthlyContribution: 'Monthly contribution',
  accessAge: 'Can withdraw from age', value: 'Value', growthPct: 'Growth', mortgageBalance: 'Mortgage owing',
  mortgageRatePct: 'Interest', monthlyRepayment: 'Repayment', monthlyNetRent: 'Net rent', changePct: 'Change',
  ratePct: 'Rate', monthlyPayment: 'Payment', monthlyAmount: 'Amount', startAge: 'From age', endAge: 'Until age',
  monthlyCost: 'Cost', years: 'Years', startInYears: 'Starting in', investmentReturnPct: 'Return',
  currentAge: 'Age', retirementAge: 'Retirement age', cashOnHand: 'Cash', cashInterestPct: 'Cash interest',
  livingExpensesMonthly: 'Living costs now', retirementLivingExpensesMonthly: 'Living costs in retirement',
  inflationPct: 'Inflation', surplusReturnPct: 'Return on reinvested surplus', targetNetWorth: 'Target net worth', targetAge: 'Goal age',
  taxRatePct: 'Tax rate', atAge: 'At your age', amount: 'Amount', replacementValue: 'Replacement home price',
  sellingCostsPct: 'Selling costs', volatilityPct: 'Market ups and downs',
};
/** Percentages that are not yearly rates, with a hint on what to enter. */
const ONE_OFF_PERCENT_HINTS: Record<string, string> = {
  sellingCostsPct: 'Enter the share of the sale price paid in agent and legal fees, usually 2 to 5. The sale price itself comes from the property\'s value.',
  taxRatePct: 'Enter the tax rate as a percentage, for example 20 for 20%.',
};
const PERCENT_FIELDS = new Set(['returnPct', 'feesPct', 'growthPct', 'mortgageRatePct', 'changePct', 'ratePct', 'investmentReturnPct', 'cashInterestPct', 'inflationPct', 'surplusReturnPct', 'taxRatePct', 'sellingCostsPct', 'volatilityPct']);

/** Turns a validation problem into a sentence that says where it is and how to fix it. */
export function friendlyPlanError(issue: ZodIssue, plan: PlanForErrors): string {
  const path = issue.path;
  if (issue.code === 'custom' && path[0] === 'endAge') return '"Plan to your age" needs to be more than your current age.';
  if (issue.code === 'custom' && path[0] === 'fx') return issue.message;
  if (path[0] === 'fx' && typeof path[1] === 'number') {
    const f = plan.fx?.[path[1]];
    return `Exchange rate for ${f?.currency ?? 'a currency'}: enter what 1 ${f?.currency ?? 'unit'} is worth in ${COUNTRIES[plan.country].currency}, above 0.`;
  }
  const field = String(path[path.length - 1]);
  const fieldName = FIELD_NAMES[field] ?? field;
  let where = '';
  if (typeof path[1] === 'number' && SECTION_NAMES[String(path[0])]) {
    const item = plan[path[0] as ListKey]?.[path[1]];
    const itemName = item?.name || item?.label;
    where = itemName ? `${itemName} (${SECTION_NAMES[String(path[0])]})` : `A ${SECTION_NAMES[String(path[0])]}`;
  } else if (path[0] === 'partner') where = "Your partner's details";
  else if (path[0] === 'you') where = 'Your details';
  else if (path[0] === 'withdrawal') where = 'Retirement spending';
  const prefix = where ? `${where}: ` : '';
  const isPct = PERCENT_FIELDS.has(field);
  if (issue.code === 'invalid_type') return `${prefix}${fieldName} is empty. Enter a number; 0 is fine.`;
  if (issue.code === 'too_big') {
    const hint = ONE_OFF_PERCENT_HINTS[field] ?? (isPct ? 'Enter a yearly percentage, for example 7 for 7%.' : '');
    return `${prefix}${fieldName} can be at most ${String(issue.maximum)}${isPct ? '%' : ''}. ${hint}`.trim();
  }
  if (issue.code === 'too_small') {
    if (field === 'name' || field === 'label') return `${prefix}give it a name.`;
    return `${prefix}${fieldName} must be at least ${String(issue.minimum)}${isPct ? '%' : ''}.`;
  }
  return `${prefix}check ${fieldName}.`;
}
