/**
 * Typical values for the projector's percentage fields, shown as hints so
 * people know roughly what to enter. These are commonly used long-run
 * assumptions, not forecasts; people should use their own figures where
 * they have them (fund fact sheets, lender, bank).
 */
import { localTerms, type CountryCode } from './countries';

type InvestmentKind = 'kiwisaver' | 'retirement_account' | 'index_fund' | 'managed_fund' | 'shares' | 'term_deposit' | 'bonds' | 'other';

export function growthHint(kind: InvestmentKind): string {
  return {
    kiwisaver: 'Before fees. Depends on the fund: conservative often 3–5%, balanced 5–6%, growth 6–8%.',
    retirement_account: 'Before fees. Depends on the fund: conservative often 3–5%, balanced 5–6%, growth 6–8%.',
    index_fund: 'Before fees. Share index funds are often assumed at 6–8% over the long run; bond index funds 3–5%.',
    managed_fund: 'Before fees. Depends on the mix of shares and bonds: often 4–7%.',
    shares: 'Before costs. 7–9% is a common long-run assumption for a whole share market; single companies vary far more.',
    term_deposit: 'The interest rate on your deposit, from your bank.',
    bonds: 'Often 3–5%.',
    other: 'Your best estimate of yearly growth.',
  }[kind];
}

export function feesHint(kind: InvestmentKind): string {
  return {
    kiwisaver: 'From your fund\'s fact sheet or statement. Often 0.3–1.2% a year.',
    retirement_account: 'From your fund\'s fact sheet or statement. Often 0.3–1.2% a year.',
    index_fund: 'Index funds and ETFs are often 0.05–0.5% a year.',
    managed_fund: 'Managed funds are often 0.6–1.5% a year.',
    shares: 'Mostly brokerage when you buy or sell; often 0–0.2% a year.',
    term_deposit: 'Usually 0%.',
    bonds: 'Often 0.1–0.5% a year.',
    other: 'Any yearly fees, as a percentage.',
  }[kind];
}

export function taxRateHint(country: CountryCode): string {
  return `${localTerms(country).investmentTax} Use the rate that applies to you.`;
}

export const HINTS = {
  propertyGrowth: 'Long-run house price growth is often assumed at 2–4% a year. Use 0 if you expect it to stay flat.',
  mortgageRate: 'Your current interest rate, from your lender or statement.',
  cashInterest: 'The interest rate on your savings account, from your bank.',
  vehicleLoss: 'Cars usually lose 10–20% of their value a year. Valuables are often 0%.',
  surplusReturn: 'What money left over each month earns: a savings account (often 2–4%) or investments (often 5–7%).',
  volatility: 'How much returns swing each year. Conservative funds often 4–6%, balanced 8–10%, growth 12–15%, all shares 15–20%.',
  reverseMortgageRate: 'Usually higher than ordinary mortgage rates. Check current rates with providers.',
  sellingCosts: 'Agent and legal fees as a share of the sale price, usually 2–5%.',
  compareReturn: 'Try a few, such as 4% (cautious), 6% (balanced) and 8% (growth).',
};

export function inflationHint(country: CountryCode): string {
  return `${localTerms(country).inflationTarget} Prices, pay, costs and pensions rise by this much each year in the plan.`;
}
