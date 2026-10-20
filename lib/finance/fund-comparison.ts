/**
 * Retirement fund comparison: KiwiSaver (NZ), super (AU), 401(k)/IRA (US),
 * workplace/personal pensions (UK) and PERA/MP2 (PH).
 *
 * A month-by-month model of the same person in up to four funds. Each month:
 *   1. Employee, employer (and NZ government) contributions are added, less any
 *      tax on contributions (NZ ESCT, AU 15% contributions tax) and any
 *      contribution charge (e.g. NEST 1.8%).
 *   2. The balance earns the fund's gross return.
 *   3. Fees are taken: investment/fund fee and performance fee (shown as "other fees"),
 *      admin % fee, fixed member fee and platform fee (shown as "admin fees").
 *   4. Tax on earnings is taken where the fund pays it (NZ PIE tax, AU earnings tax,
 *      US taxable account dividends).
 *
 * Every rule below is a simplification of the official rules as at RULES_AS_AT.
 * Figures are scenarios, not forecasts or advice.
 */
import type { CountryCode } from '../countries';
import { LONG_TERM_GROSS_RETURN, type FundRisk, type ProviderFund, type ReturnBasis } from '../../data/retirement-providers';

export const RULES_AS_AT = '2026-10-20';

export type UsAccount = 'traditional' | 'roth' | 'taxable';
export type ReturnSource = 'historic' | 'long-term';

export interface FundOptionInput {
  id: string;
  name: string;
  providerId?: string;
  risk: FundRisk;
  growthSharePct: number;
  grossReturnPct: number;
  investmentFeePct: number;
  adminFeePct: number;
  fixedFeePerYear: number;
  platformFeePct: number;
  platformFeeCapPerYear: number;
  performanceFeePct: number;
  contributionChargePct: number;
}

export interface FundComparisonInput {
  country: CountryCode;
  startBalance: number;
  salary: number;
  salaryGrowthPct: number;
  employeePct: number;
  employerPct: number;
  extraMonthly: number;
  years: number;
  inflationPct: number;
  /** NZ: prescribed investor rate, 10.5 / 17.5 / 28. */
  nzPir: number;
  /** NZ: include the government contribution. */
  nzGovContribution: boolean;
  /** US: which kind of account the money is in. */
  usAccount: UsAccount;
  options: FundOptionInput[];
}

export interface PeriodPoint {
  /** Month number (1..) or year number (1..). */
  period: number;
  label: string;
  balance: number;
  startingCapital: number;
  employee: number;
  /** Running totals after contribution tax (ESCT in NZ, 15% contributions tax in AU). */
  employeeNet: number;
  employerNet: number;
  employer: number;
  government: number;
  /** Cumulative money put in (start + all contributions before tax/charges). */
  totalPaidIn: number;
  growth: number;
  tax: number;
  adminFees: number;
  otherFees: number;
  netReturn: number;
  grossReturnPct: number;
  netReturnPct: number;
}

export interface FundTotals {
  employee: number;
  employer: number;
  government: number;
  contributionTax: number;
  earningsTax: number;
  investmentFees: number;
  performanceFees: number;
  contributionCharges: number;
  adminPctFees: number;
  fixedFees: number;
  platformFees: number;
  growth: number;
}

export interface FundResult {
  id: string;
  name: string;
  endBalance: number;
  endBalanceReal: number;
  totalDrag: number;
  /** Balance the same contributions would reach with no fees and no fund-level tax. */
  noDragBalance: number;
  /** Growth lost to drag, including the growth the drag would have earned. */
  dragImpact: number;
  totals: FundTotals;
  monthly: PeriodPoint[];
  quarterly: PeriodPoint[];
  yearly: PeriodPoint[];
  firstYear: PeriodPoint;
  /** Plain-words explanation of how each part of the drag was calculated. */
  howCalculated: string[];
  /** The same notes, tagged with the chart and bar each one feeds. */
  notes: CalcNote[];
  /** Estimated tax when the money is withdrawn (US traditional, UK pensions), if any. */
  withdrawalTaxNote?: string;
}

export interface FundComparisonResult {
  inputs: FundComparisonInput;
  funds: FundResult[];
  rules: string[];
}

const mr = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/* ---------------- Country rules ---------------- */

/** NZ ESCT rate on employer contributions, by salary plus gross employer contributions (from 1 April 2025). */
export function nzEsctRate(salaryPlusEmployer: number): number {
  if (salaryPlusEmployer <= 18_720) return 0.105;
  if (salaryPlusEmployer <= 64_200) return 0.175;
  if (salaryPlusEmployer <= 93_720) return 0.30;
  if (salaryPlusEmployer <= 216_000) return 0.33;
  return 0.39;
}
/** NZ government contribution: 25c per $1 of member contributions, up to $260.72 a year; none above $180,000 income (from 1 July 2025). */
export function nzGovContribution(memberContributionsInYear: number, income: number): number {
  if (income > 180_000) return 0;
  return Math.min(0.25 * memberContributionsInYear, 260.72);
}
/** NZ PIE tax: taxable income as a % of balance. Overseas shares use the fair dividend rate (5% of value); the rest is taxed on its income (assumed 4.5%). */
export function nzTaxableIncomeRate(growthSharePct: number): number {
  const g = Math.min(100, Math.max(0, growthSharePct)) / 100;
  return g * 0.05 + (1 - g) * 0.045;
}
/** AU: effective tax on super fund earnings after the capital gains discount and franking credits (assumption). */
export const AU_EARNINGS_TAX = 0.08;
export const AU_CONTRIBUTIONS_TAX = 0.15;
/** US taxable account: assumed dividend yield and tax on it. */
const US_TAXABLE_YIELD = 0.015;
const US_DIVIDEND_TAX = 0.15;
/** UK: band of earnings that auto-enrolment contributions are based on (2026/27). */
export const UK_QUALIFYING_LOWER = 6_240;
export const UK_QUALIFYING_UPPER = 50_270;
/** PH: PERA contribution limit a year. */
export const PH_PERA_CAP = 200_000;

/** Country defaults for the contribution inputs. */
export const COUNTRY_DEFAULTS: Record<CountryCode, { salary: number; employeePct: number; employerPct: number; label: string; employerLabel: string }> = {
  NZ: { salary: 70_000, employeePct: 3.5, employerPct: 3.5, label: 'KiwiSaver', employerLabel: 'Employer contribution (before ESCT)' },
  AU: { salary: 90_000, employeePct: 0, employerPct: 12, label: 'Super', employerLabel: 'Employer Super Guarantee' },
  US: { salary: 80_000, employeePct: 6, employerPct: 3, label: '401(k) / IRA', employerLabel: 'Employer match' },
  UK: { salary: 40_000, employeePct: 5, employerPct: 3, label: 'Pension', employerLabel: 'Employer contribution' },
  PH: { salary: 600_000, employeePct: 5, employerPct: 0, label: 'PERA / MP2', employerLabel: 'Employer contribution (optional)' },
};

/* ---------------- Return assumptions ---------------- */

/** The tax the fund itself pays, as a % of balance a year (approximate), used to turn after-tax returns into gross ones. */
function fundTaxDragPct(country: CountryCode, growthSharePct: number, grossPct: number, nzPir = 28): number {
  if (country === 'NZ') return (nzPir / 100) * nzTaxableIncomeRate(growthSharePct) * 100;
  if (country === 'AU') return AU_EARNINGS_TAX * Math.max(0, grossPct);
  return 0;
}

/** Converts a fund's historic return to the gross (before fees and tax) return the model needs. */
export function grossFromHistoric(f: ProviderFund, country: CountryCode): number {
  if (f.historicReturnPct === undefined) return LONG_TERM_GROSS_RETURN[f.risk];
  const fees = f.investmentFeePct + (f.adminFeePct ?? 0) + (f.performanceFeePct ?? 0) + (f.platformFeePct ?? 0);
  const r = f.historicReturnPct;
  const basis: ReturnBasis = f.returnBasis ?? 'net-of-fund-fees';
  let gross: number;
  if (basis === 'after-fees-after-tax') gross = r + fees + fundTaxDragPct('NZ', f.growthSharePct, r, 28);
  else if (basis === 'after-fees-before-tax') gross = r + fees;
  else if (basis === 'net-of-fees-and-tax') gross = (r + fees) / (1 - (country === 'AU' ? AU_EARNINGS_TAX : 0));
  else gross = r + fees;
  return Math.round(gross * 100) / 100;
}

export function optionFromProvider(f: ProviderFund, country: CountryCode, source: ReturnSource, id: string): FundOptionInput {
  return {
    id,
    name: `${f.provider} ${f.fund}`,
    providerId: f.id,
    risk: f.risk,
    growthSharePct: f.growthSharePct,
    grossReturnPct: source === 'historic' ? grossFromHistoric(f, country) : LONG_TERM_GROSS_RETURN[f.risk],
    investmentFeePct: f.investmentFeePct,
    adminFeePct: f.adminFeePct ?? 0,
    fixedFeePerYear: f.fixedFeePerYear ?? 0,
    platformFeePct: f.platformFeePct ?? 0,
    platformFeeCapPerYear: f.platformFeeCapPerYear ?? 0,
    performanceFeePct: f.performanceFeePct ?? 0,
    contributionChargePct: f.contributionChargePct ?? 0,
  };
}

/* ---------------- The projection ---------------- */

/** Groups monthly points into quarters or years: flows are summed, balances taken at the end. Return % is a yearly rate. */
export function aggregate(monthly: PeriodPoint[], months: number, startBalance: number, prefix: string): PeriodPoint[] {
  const out: PeriodPoint[] = [];
  let startBal = startBalance;
  for (let i = 0; i + months <= monthly.length; i += months) {
    const chunk = monthly.slice(i, i + months);
    const last = chunk[chunk.length - 1];
    const sum = (k: 'growth' | 'tax' | 'adminFees' | 'otherFees' | 'netReturn') => chunk.reduce((s, p) => s + p[k], 0);
    const avg = (startBal + last.balance) / 2 || 1;
    const perYear = 12 / months;
    const n = out.length + 1;
    const growth = sum('growth');
    const net = sum('netReturn');
    out.push({
      ...last, period: n, label: months === 3 ? `Y${Math.ceil(n / 4)} ${prefix}${((n - 1) % 4) + 1}` : `${prefix}${n}`,
      growth, tax: sum('tax'), adminFees: sum('adminFees'), otherFees: sum('otherFees'), netReturn: net,
      grossReturnPct: (growth / avg) * 100 * perYear,
      netReturnPct: (net / avg) * 100 * perYear,
    });
    startBal = last.balance;
  }
  return out;
}

function emptyTotals(): FundTotals {
  return { employee: 0, employer: 0, government: 0, contributionTax: 0, earningsTax: 0, investmentFees: 0, performanceFees: 0, contributionCharges: 0, adminPctFees: 0, fixedFees: 0, platformFees: 0, growth: 0 };
}

function run(input: FundComparisonInput, o: FundOptionInput, withDrag: boolean) {
  const c = input.country;
  let balance = Math.max(0, input.startBalance);
  const t = emptyTotals();
  const monthly: PeriodPoint[] = [];
  const rGross = mr(o.grossReturnPct);
  let salary = input.salary;
  let memberInYear = 0;
  let platformInYear = 0;
  let employeeNetSum = 0;
  let employerNetSum = 0;

  for (let m = 1; m <= input.years * 12; m++) {
    const monthSalary = salary / 12;
    // ---- contributions
    let employee = (monthSalary * input.employeePct) / 100 + input.extraMonthly;
    let employerBase = monthSalary;
    if (c === 'UK') employerBase = Math.max(0, Math.min(salary, UK_QUALIFYING_UPPER) - UK_QUALIFYING_LOWER) / 12;
    if (c === 'UK') employee = (employerBase * input.employeePct) / 100 + input.extraMonthly;
    const employer = (employerBase * input.employerPct) / 100;
    if (c === 'PH') employee = Math.min(employee, Math.max(0, PH_PERA_CAP / 12 - employer));
    memberInYear += employee;
    let government = 0;
    if (c === 'NZ' && input.nzGovContribution && m % 12 === 0) government = nzGovContribution(memberInYear, salary);

    let employerTax = 0;
    let employeeTax = 0;
    if (withDrag && c === 'NZ') employerTax = employer * nzEsctRate(salary + (salary * input.employerPct) / 100);
    if (withDrag && c === 'AU') { employerTax = employer * AU_CONTRIBUTIONS_TAX; employeeTax = ((monthSalary * input.employeePct) / 100) * AU_CONTRIBUTIONS_TAX; }
    const contributionTax = employerTax + employeeTax;
    employeeNetSum += employee - employeeTax;
    employerNetSum += employer - employerTax;
    const gross = employee + employer + government;
    const charge = withDrag ? (gross - contributionTax) * (o.contributionChargePct / 100) : 0;
    balance += gross - contributionTax - charge;

    // ---- growth and fees
    const growth = balance * rGross;
    const investmentFee = withDrag ? balance * mr(o.investmentFeePct) : 0;
    const performanceFee = withDrag ? balance * mr(o.performanceFeePct) : 0;
    const adminPctFee = withDrag ? balance * mr(o.adminFeePct) : 0;
    const fixedFee = withDrag ? Math.min(o.fixedFeePerYear / 12, Math.max(0, balance)) : 0;
    let platformFee = withDrag ? balance * mr(o.platformFeePct) : 0;
    if (withDrag && o.platformFeeCapPerYear > 0) {
      platformFee = Math.max(0, Math.min(platformFee, o.platformFeeCapPerYear - platformInYear));
    }
    platformInYear += platformFee;

    // ---- tax on earnings, paid by the fund
    let earningsTax = 0;
    if (withDrag && c === 'NZ') earningsTax = balance * (input.nzPir / 100) * nzTaxableIncomeRate(o.growthSharePct) / 12;
    if (withDrag && c === 'AU') earningsTax = Math.max(0, growth - investmentFee - performanceFee) * AU_EARNINGS_TAX;
    if (withDrag && c === 'US' && input.usAccount === 'taxable') earningsTax = balance * US_TAXABLE_YIELD * US_DIVIDEND_TAX / 12;

    const before = balance;
    balance = Math.max(0, balance + growth - investmentFee - performanceFee - adminPctFee - fixedFee - platformFee - earningsTax);

    t.employee += employee; t.employer += employer; t.government += government;
    t.contributionTax += contributionTax; t.contributionCharges += charge; t.earningsTax += earningsTax;
    t.investmentFees += investmentFee; t.performanceFees += performanceFee; t.adminPctFees += adminPctFee;
    t.fixedFees += fixedFee; t.platformFees += platformFee; t.growth += growth;

    const tax = contributionTax + earningsTax;
    const admin = adminPctFee + fixedFee + platformFee;
    const other = investmentFee + performanceFee + charge;
    const netReturn = growth - investmentFee - performanceFee - adminPctFee - fixedFee - platformFee - earningsTax;
    const paidIn = input.startBalance + t.employee + t.employer + t.government;
    monthly.push({
      period: m, label: `Y${Math.ceil(m / 12)} M${((m - 1) % 12) + 1}`, balance,
      startingCapital: input.startBalance, employee: t.employee, employer: t.employer, government: t.government, totalPaidIn: paidIn,
      employeeNet: employeeNetSum, employerNet: employerNetSum,
      growth, tax, adminFees: admin, otherFees: other, netReturn,
      grossReturnPct: before > 0 ? (Math.pow(1 + rGross, 12) - 1) * 100 : 0,
      netReturnPct: before > 0 ? (Math.pow(1 + netReturn / before, 12) - 1) * 100 : 0,
    });

    if (m % 12 === 0) {
      salary *= 1 + input.salaryGrowthPct / 100;
      memberInYear = 0;
      platformInYear = 0;
    }
  }
  return {
    balance, totals: t, monthly,
    quarterly: aggregate(monthly, 3, input.startBalance, 'Q'),
    yearly: aggregate(monthly, 12, input.startBalance, 'Year '),
  };
}

const pct = (n: number, d = 2) => `${n.toFixed(d).replace(/\.?0+$/, '')}%`;

/** One line of "how it was calculated", tagged with the chart and bar it feeds. */
export type CalcGroup = 'Return' | 'Tax' | 'Admin fees' | 'Other fees' | 'Paid in' | 'Withdrawal';
export interface CalcNote { group: CalcGroup; item: string; how: string; total?: number }

function explain(input: FundComparisonInput, o: FundOptionInput, r: ReturnType<typeof run>, money: (n: number) => string): { notes: CalcNote[]; withdrawal?: string } {
  const c = input.country;
  const n: CalcNote[] = [];
  const t = r.totals;
  const add = (group: CalcGroup, item: string, how: string, total?: number) => n.push({ group, item, how, total });
  add('Return', 'Growth', `${pct(o.grossReturnPct)} a year before fees and tax, compounded monthly.`, t.growth);
  if (o.investmentFeePct > 0) add('Other fees', 'Fund fee', `${pct(o.investmentFeePct)} of balance a year, taken monthly.`, t.investmentFees);
  if (o.performanceFeePct > 0) add('Other fees', 'Performance fee', `Estimated ${pct(o.performanceFeePct)} of balance a year; only charged when the fund beats its target.`, t.performanceFees);
  if (o.contributionChargePct > 0) add('Other fees', 'Contribution charge', `${pct(o.contributionChargePct)} off every contribution before it is invested.`, t.contributionCharges);
  if (o.adminFeePct > 0) add('Admin fees', 'Admin fee', `${pct(o.adminFeePct)} of balance a year.`, t.adminPctFees);
  if (o.fixedFeePerYear > 0) add('Admin fees', 'Fixed fee', `${money(o.fixedFeePerYear)} a year whatever the balance (costs more on small balances).`, t.fixedFees);
  if (o.platformFeePct > 0) add('Admin fees', 'Platform fee', `${pct(o.platformFeePct)} of balance a year${o.platformFeeCapPerYear ? `, capped at ${money(o.platformFeeCapPerYear)}` : ''}.`, t.platformFees);

  let withdrawal: string | undefined;
  if (c === 'NZ') {
    const rate = nzTaxableIncomeRate(o.growthSharePct) * 100;
    add('Tax', 'PIE tax', `${input.nzPir}% PIR on ~${rate.toFixed(1)}% of balance (5% FDR on overseas shares + income on the rest), ≈ ${pct((input.nzPir / 100) * rate)} of balance a year, even in falling years.`, t.earningsTax);
    if (t.contributionTax > 0) add('Tax', 'ESCT', `${pct(nzEsctRate(input.salary + (input.salary * input.employerPct) / 100) * 100, 1)} off employer contributions.`, t.contributionTax);
    if (input.nzGovContribution) add('Paid in', 'Government contribution', '25c per $1 you put in, max $260.72 a year (none over $180k income).', t.government);
    add('Withdrawal', 'At 65', 'Tax-free: tax was paid inside the fund.');
  } else if (c === 'AU') {
    add('Tax', 'Contributions tax', '15% off employer and salary-sacrifice contributions.', t.contributionTax);
    add('Tax', 'Earnings tax', `${pct(AU_EARNINGS_TAX * 100, 0)} of the return after fund fees (15% less discounts and franking).`, t.earningsTax);
    add('Withdrawal', 'After 60', 'Generally tax-free.');
  } else if (c === 'US') {
    if (input.usAccount === 'taxable') add('Tax', 'Dividend tax', '15% on ~1.5% dividends (≈0.23% of balance a year); capital gains tax on sale not modelled.', t.earningsTax);
    else add('Tax', 'Tax while growing', input.usAccount === 'traditional' ? 'None: contributions go in before income tax.' : 'None: Roth contributions are made after tax.', 0);
    if (input.usAccount === 'traditional') withdrawal = `Withdrawals are taxed as income: at 15% that is about ${money(r.balance * 0.15)} of the final balance.`;
    else if (input.usAccount === 'roth') add('Withdrawal', 'After 59½', 'Tax-free.');
  } else if (c === 'UK') {
    add('Tax', 'Tax while growing', 'None. Your contribution includes 20% basic-rate tax relief.', 0);
    withdrawal = `25% tax-free; the rest is taxed as income: at 20% about ${money(r.balance * 0.75 * 0.2)} of this balance.`;
  } else if (c === 'PH') {
    add('Tax', 'Tax while growing', 'None: PERA income and MP2 dividends are tax-free; 5% tax credit on PERA contributions up to ₱200,000 a year.', 0);
    add('Withdrawal', 'Early', 'PERA before 55 (or 5 years): tax benefits lost plus penalties.');
  }
  return { notes: n, withdrawal };
}

export function compareFunds(input: FundComparisonInput, money: (n: number) => string = (n) => Math.round(n).toLocaleString()): FundComparisonResult {
  const deflator = Math.pow(1 + mr(input.inflationPct), input.years * 12);
  const funds: FundResult[] = input.options.map((o) => {
    const r = run(input, o, true);
    const free = run(input, o, false);
    const t = r.totals;
    const totalDrag = t.contributionTax + t.earningsTax + t.investmentFees + t.performanceFees + t.contributionCharges + t.adminPctFees + t.fixedFees + t.platformFees;
    const ex = explain(input, o, r, money);
    return {
      id: o.id, name: o.name,
      endBalance: r.balance, endBalanceReal: r.balance / deflator,
      totalDrag, noDragBalance: free.balance, dragImpact: Math.max(0, free.balance - r.balance),
      totals: t, monthly: r.monthly, quarterly: r.quarterly, yearly: r.yearly, firstYear: r.yearly[0],
      notes: ex.notes, howCalculated: ex.notes.map((x) => `${x.item} (${x.group}): ${x.how}${x.total !== undefined ? ` Total ${money(x.total)}.` : ''}`), withdrawalTaxNote: ex.withdrawal,
    };
  });
  return {
    inputs: input,
    funds,
    rules: [
      'Every fund gets the same starting balance, salary, contribution rates and time frame; only the fund\'s fees, tax treatment and return differ.',
      'Returns are steady each year; real returns go up and down. Historic returns are converted to a before-fees-and-tax figure so fees and tax can be shown separately.',
      'Salary rises each year by the rate entered; contributions follow the salary.',
      `Rules as at ${RULES_AS_AT}: NZ ESCT bands, government contribution and PIE tax; AU 12% Super Guarantee and 15% contributions tax; UK qualifying earnings £6,240–£50,270; PH PERA limit ₱200,000 a year.`,
      'Insurance premiums inside super or KiwiSaver, buy/sell spreads, switching costs and inflation of fixed fees are not modelled.',
      'General information, not financial advice. Check each fund\'s current disclosure before deciding.',
    ],
  };
}
