/**
 * Household projection engine.
 *
 * Projects a whole household month by month: one person or a couple, cash on
 * hand, investments (including KiwiSaver and other retirement accounts),
 * properties and their mortgages, other assets and debts, every source of
 * income (salary, dividends, rent, pensions) and every expense (living costs,
 * children, parents, pets, anything else), plus one-off events such as an
 * inheritance, a renovation or selling a property.
 *
 * Each month, income minus spending, loan repayments and investment
 * contributions is the household's surplus. A surplus is reinvested; a
 * shortfall is paid from cash, then reinvested savings, then investments that
 * can be accessed. Properties are only sold by an event the user adds.
 *
 * Deterministic Low / Expected / High scenarios are joined by a Monte Carlo
 * run with random yearly investment returns.
 *
 * Pure functions, no I/O: runs in the browser (so numbers stay on the device)
 * and as the chat's projectHousehold tool. Rates are annual percentages
 * (7 = 7%). "Real" figures are in today's money.
 */
import { z } from 'zod';
import { COUNTRIES, COUNTRY_CODES, moneyFor, profile, type CountryCode } from '../countries';

const amount = z.number().min(0).max(1e11);
const monthly = z.number().min(0).max(1e9);
const name = z.string().trim().min(1).max(80);
const owner = z.enum(['you', 'partner', 'joint']).default('you');

export const CURRENCIES = ['NZD', 'AUD', 'USD', 'GBP', 'PHP'] as const;
export type Currency = (typeof CURRENCIES)[number];
const currency = z.enum(CURRENCIES).optional()
  .describe('Currency of this item, if different from the currency of the country you live in');

/** The country an item belongs to, from its currency (a PHP pension follows Philippine rules). */
export function countryOfCurrency(cur: Currency | undefined): CountryCode | undefined {
  return cur ? COUNTRY_CODES.find((c) => COUNTRIES[c].currency === cur) : undefined;
}

export const PersonSchema = z.object({
  currentAge: z.number().int().min(16).max(100),
  retirementAge: z.number().int().min(16).max(100).describe('Age this person stops working. Can be at or below currentAge if already retired.'),
});

export const TAX_TREATMENTS = ['returns_after_tax', 'taxed_yearly', 'taxed_on_withdrawal', 'tax_free'] as const;

export const InvestmentSchema = z.object({
  name,
  kind: z.enum(['kiwisaver', 'retirement_account', 'shares', 'managed_fund', 'term_deposit', 'bonds', 'other']).default('shares')
    .describe('kiwisaver for NZ; retirement_account for super, 401(k)/IRA, workplace pension/SIPP or PERA'),
  owner,
  balance: amount,
  returnPct: z.number().min(-10).max(20).describe('Expected yearly return before fees'),
  feesPct: z.number().min(0).max(5).default(0),
  monthlyContribution: monthly.default(0).describe('Paid from household income, including any employer share'),
  contributionsStopAtRetirement: z.boolean().default(true),
  accessAge: z.number().min(16).max(100).optional().describe("Owner's age when withdrawals are allowed. Retirement accounts default to the country's access age."),
  taxTreatment: z.enum(TAX_TREATMENTS).default('returns_after_tax')
    .describe('returns_after_tax: the return entered is already after tax. taxed_yearly: taxRatePct of each year\'s return is paid in tax. taxed_on_withdrawal: withdrawals are taxed at taxRatePct (e.g. traditional 401(k), SIPP). tax_free: e.g. ISA, Roth.'),
  taxRatePct: z.number().min(0).max(60).default(0),
  currency,
});

export const PropertySchema = z.object({
  name,
  value: amount.describe('Current market value (not the mortgage balance)'),
  growthPct: z.number().min(-10).max(20).default(3),
  mortgageBalance: amount.default(0),
  mortgageRatePct: z.number().min(0).max(25).default(5.5),
  monthlyRepayment: monthly.default(0),
  monthlyNetRent: monthly.default(0).describe('Rent received each month (before the running costs below)'),
  monthlyCosts: monthly.default(0).describe('Running costs you pay each month: rates, insurance, repairs and upkeep. Stop when the property is sold.'),
  currency,
});

export const OtherAssetSchema = z.object({
  name,
  kind: z.enum(['vehicle', 'jewellery', 'collectibles', 'business', 'other']).default('other'),
  value: amount,
  changePct: z.number().min(-50).max(20).optional().describe('Yearly change in value. Vehicles default to -10%, others to 0%.'),
  currency,
});

export const DebtSchema = z.object({
  name,
  balance: amount,
  ratePct: z.number().min(0).max(50).default(8),
  monthlyPayment: monthly.default(0),
  currency,
});

export const IncomeSchema = z.object({
  name,
  kind: z.enum(['salary', 'dividends', 'rental', 'business', 'pension', 'annuity', 'other']).default('other'),
  owner,
  monthlyAmount: monthly.describe("After tax, in today's money"),
  startAge: z.number().int().min(16).max(110).optional().describe("Owner's age it starts. Pensions default to the country's pension age."),
  endAge: z.number().int().min(16).max(110).optional().describe("Owner's age it stops. Salary defaults to the owner's retirement age."),
  risesWithInflation: z.boolean().default(true),
  currency,
});

export const DependantSchema = z.object({
  name,
  kind: z.enum(['child', 'parent', 'pet', 'other']).default('child'),
  monthlyCost: monthly,
  years: z.number().min(0).max(80).describe('How many more years the cost lasts'),
  startInYears: z.number().min(0).max(80).default(0),
  currency,
});

export const ExpenseSchema = z.object({
  name,
  monthlyAmount: monthly,
  years: z.number().min(0).max(80).optional().describe('How many years it lasts. Leave out for ongoing costs.'),
  startInYears: z.number().min(0).max(80).default(0),
  currency,
});

export const EventSchema = z.object({
  name,
  kind: z.enum(['money_in', 'money_out', 'sell_property', 'sell_investment'])
    .describe('money_in: inheritance, sale of a business, lump sum. money_out: renovation, car, wedding. sell_property: sell (or downsize) a property. sell_investment: cash out all or part of an investment.'),
  atAge: z.number().int().min(16).max(110).describe('Your age when it happens'),
  amount: amount.default(0).describe("Money in or out, in today's money. Not used for sell_property."),
  propertyName: z.string().max(80).optional().describe('For sell_property: the property to sell'),
  investmentName: z.string().max(80).optional().describe('For sell_investment: the investment to cash out'),
  sharePct: z.number().min(1).max(100).default(100).describe('For sell_investment: how much of it to cash out, as a percentage'),
  replacementValue: amount.default(0).describe("For sell_property: price of a cheaper home bought instead (downsizing), in today's money. 0 = not replaced."),
  sellingCostsPct: z.number().min(0).max(15).default(3),
  currency,
});

export const FxSchema = z.object({
  currency: z.enum(CURRENCIES),
  rate: z.number().positive().max(1e6).describe('What 1 unit of this currency is worth in your home currency today'),
  yearlyChangePct: z.number().min(-20).max(20).default(0).describe('Expected yearly rise (+) or fall (-) of this currency against your home currency'),
});

export const WithdrawalSchema = z.object({
  strategy: z.enum(['needs', 'percent', 'guardrails']).default('needs')
    .describe('needs: spend the retirement living costs entered. percent: spend ratePct of cash and investments each year. guardrails: start from living costs, cut 10% when withdrawals get too high and raise 10% when markets do well.'),
  ratePct: z.number().min(1).max(15).default(4),
});

export const StrategySchema = z.object({
  label: z.string().trim().min(1).max(60),
  investmentReturnPct: z.number().min(-10).max(20).describe('Replaces the return on every investment and on reinvested savings'),
  propertyGrowthPct: z.number().min(-10).max(20).optional(),
});

export const HouseholdInputSchema = z
  .object({
    country: z.enum(COUNTRY_CODES).default('NZ').describe('Country you live in now; its currency is the home currency all results are shown in'),
    retireIn: z.enum(COUNTRY_CODES).optional().describe('Country you plan to retire in, if different. Retirement living costs are then in its currency.'),
    fx: z.array(FxSchema).max(5).default([]).describe('Exchange rates for every other currency used'),
    you: PersonSchema,
    partner: PersonSchema.optional(),
    endAge: z.number().int().min(40).max(110).default(90).describe('Your age the projection runs to'),
    inflationPct: z.number().min(0).max(20).default(2.5),
    cashOnHand: amount.default(0),
    cashInterestPct: z.number().min(0).max(20).default(2.5),
    investments: z.array(InvestmentSchema).max(20).default([]),
    properties: z.array(PropertySchema).max(10).default([]),
    otherAssets: z.array(OtherAssetSchema).max(15).default([]),
    debts: z.array(DebtSchema).max(15).default([]),
    incomes: z.array(IncomeSchema).max(20).default([]),
    livingExpensesMonthly: monthly.default(0).describe('Everyday household costs, excluding loan repayments and investing'),
    retirementLivingExpensesMonthly: monthly.optional().describe('Living costs once everyone has retired. Defaults to the same as now.'),
    dependants: z.array(DependantSchema).max(15).default([]),
    otherExpenses: z.array(ExpenseSchema).max(15).default([]),
    events: z.array(EventSchema).max(15).default([]),
    withdrawal: WithdrawalSchema.default({}),
    contributionsFromOutsideIncome: z.boolean().default(false)
      .describe('True when income and spending are not entered: contributions are then assumed to come from income not shown'),
    surplusReturnPct: z.number().min(-5).max(20).default(5).describe('Yearly return on reinvested surplus cash, after fees'),
    volatilityPct: z.number().min(0).max(40).default(12).describe('Yearly ups and downs of investment returns, for the Monte Carlo run'),
    goal: z
      .object({
        targetNetWorth: amount.optional().describe("Target net worth in today's money"),
        targetAge: z.number().int().min(17).max(110).optional().describe('Your age by which to reach it. Defaults to your retirement age.'),
      })
      .optional(),
    compare: z.array(StrategySchema).max(6).optional().describe('Optional return assumptions to compare side by side'),
  })
  .refine((h) => h.endAge > h.you.currentAge, { message: 'endAge must be after your current age', path: ['endAge'] })
  .superRefine((h, ctx) => {
    const home = COUNTRIES[h.country].currency;
    for (const cur of usedCurrencies(h)) {
      if (cur !== home && !h.fx.some((f) => f.currency === cur)) {
        ctx.addIssue({ code: 'custom', path: ['fx'], message: `Add an exchange rate for ${cur}: what 1 ${cur} is worth in ${home}.` });
      }
    }
  });

type HouseholdShape = {
  country: CountryCode;
  retireIn?: CountryCode;
  investments: { currency?: Currency }[];
  properties: { currency?: Currency }[];
  otherAssets: { currency?: Currency }[];
  debts: { currency?: Currency }[];
  incomes: { currency?: Currency }[];
  dependants: { currency?: Currency }[];
  otherExpenses: { currency?: Currency }[];
  events: { currency?: Currency }[];
};

/** Every currency the plan uses, including the retirement country's. */
export function usedCurrencies(h: HouseholdShape): Currency[] {
  const set = new Set<Currency>();
  for (const list of [h.investments, h.properties, h.otherAssets, h.debts, h.incomes, h.dependants, h.otherExpenses, h.events]) {
    for (const item of list) if (item.currency) set.add(item.currency);
  }
  if (h.retireIn) set.add(COUNTRIES[h.retireIn].currency as Currency);
  return [...set];
}

export type HouseholdInput = z.input<typeof HouseholdInputSchema>;
export type Household = z.output<typeof HouseholdInputSchema>;

export interface HouseholdPoint {
  age: number;
  partnerAge: number | null;
  /** All values in today's money. */
  cash: number;
  investments: number;
  property: number;
  propertyDebt: number;
  otherAssets: number;
  otherDebt: number;
  liquid: number;
  netWorth: number;
  /** Totals for the year just ended, in today's money. */
  income: number;
  spending: number;
  loanPayments: number;
  contributions: number;
  tax: number;
  events: number;
  net: number;
  unmet: number;
}

export interface HouseholdScenario {
  label: 'Low' | 'Expected' | 'High';
  investmentShiftPct: number;
  series: HouseholdPoint[];
  shortfallAge: number | null;
}

export interface MonthlyLine { label: string; amount: number }

export interface MonteCarloResult {
  runs: number;
  volatilityPct: number;
  /** Share of simulated markets where spending was always covered. */
  successRate: number;
  goalProbability: number | null;
  medianShortfallAge: number | null;
  byAge: { age: number; liquidP10: number; liquidP50: number; liquidP90: number; netWorthP10: number; netWorthP50: number; netWorthP90: number }[];
}

export interface HouseholdResult {
  inputs: Household;
  today: {
    assets: number;
    debts: number;
    netWorth: number;
    liquid: number;
    income: MonthlyLine[];
    outgoings: MonthlyLine[];
    monthlySurplus: number;
  };
  scenarios: [HouseholdScenario, HouseholdScenario, HouseholdScenario];
  retirementAge: number;
  milestones: { age: number; partnerAge: number | null; low: number; expected: number; high: number; liquid: number }[];
  goal?: { target: number; targetAge: number; low: number; expected: number; high: number; gap: number; onTrack: boolean };
  comparison?: { label: string; investmentReturnPct: number; atRetirement: number; liquidAtRetirement: number; atEnd: number; shortfallAge: number | null; meetsGoal: boolean | null }[];
  monteCarlo: MonteCarloResult;
  warnings: string[];
  assumptions: string[];
  disclaimer: string;
}

export const HOUSEHOLD_DISCLAIMER =
  'These projections are illustrations based on the assumptions shown, not predictions or financial advice. Returns are not guaranteed, and actual results will differ.';

const SPREAD = 2; // percentage points for Low/High investment returns
const PROPERTY_SPREAD = 1;
const MC_RUNS = 300;

const monthlyRate = (annualPct: number) => Math.pow(1 + Math.max(annualPct, -99) / 100, 1 / 12) - 1;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function otherAssetChange(a: Household['otherAssets'][number]) {
  return a.changePct ?? (a.kind === 'vehicle' ? -10 : 0);
}

export function investmentAccessAge(h: Household, inv: Household['investments'][number]) {
  if (inv.accessAge !== undefined) return inv.accessAge;
  if (inv.kind === 'kiwisaver') return 65;
  if (inv.kind === 'retirement_account') return profile(countryOfCurrency(inv.currency) ?? h.country).retirementAccount.accessAge;
  return undefined;
}

/** Home-currency value of 1 unit of `cur` after m months, and its monthly drift. */
export function fxFor(h: Household) {
  const home = COUNTRIES[h.country].currency;
  const byCur = new Map(h.fx.map((f) => [f.currency, f]));
  const at = (cur: Currency | undefined, m: number, rateScale: Partial<Record<Currency, number>> = {}) => {
    if (!cur || cur === home) return 1;
    const f = byCur.get(cur);
    if (!f) return 1;
    return f.rate * (rateScale[cur] ?? 1) * Math.pow(1 + f.yearlyChangePct / 100, m / 12);
  };
  const drift = (cur: Currency | undefined) => (!cur || cur === home ? 0 : monthlyRate(byCur.get(cur)?.yearlyChangePct ?? 0));
  return { home, at, drift };
}

/** Currency retirement living costs are entered in. */
export function retirementCurrency(h: Household): Currency {
  return COUNTRIES[h.retireIn ?? h.country].currency as Currency;
}

function incomeWindow(h: Household, inc: Household['incomes'][number]) {
  const person = inc.owner === 'partner' && h.partner ? h.partner : h.you;
  return {
    start: inc.startAge ?? (inc.kind === 'pension' ? profile(countryOfCurrency(inc.currency) ?? h.country).pension.age : undefined),
    end: inc.endAge ?? (inc.kind === 'salary' ? person.retirementAge : undefined),
  };
}

/** Net yearly return after fees and any yearly tax. */
function netReturn(inv: Household['investments'][number], gross: number) {
  const afterFees = gross - inv.feesPct;
  return inv.taxTreatment === 'taxed_yearly' && afterFees > 0 ? afterFees * (1 - inv.taxRatePct / 100) : afterFees;
}

interface SimOptions {
  investmentShiftPct: number;
  propertyShiftPct: number;
  investmentReturnOverride?: number;
  propertyGrowthOverride?: number;
  /** Extra return (percentage points) for a given year, for Monte Carlo. */
  yearShift?: (yearIndex: number) => number;
  /** Multiplies today's exchange rate for a currency (stress tests). */
  fxScale?: Partial<Record<Currency, number>>;
}

interface SimResult {
  series: HouseholdPoint[];
  shortfallAge: number | null;
}

/** Runs one scenario. Returns yearly points in today's money. */
function simulate(h: Household, o: SimOptions): SimResult {
  const months = (h.endAge - h.you.currentAge) * 12;
  const partnerOffset = h.partner ? h.partner.currentAge - h.you.currentAge : 0;
  const ageOf = (who: 'you' | 'partner' | 'joint', m: number) =>
    (who === 'partner' && h.partner ? h.partner.currentAge : h.you.currentAge) + m / 12;
  const householdRetired = (m: number) =>
    ageOf('you', m) >= h.you.retirementAge && (!h.partner || ageOf('partner', m) >= h.partner.retirementAge);
  const retiredOf = (who: 'you' | 'partner' | 'joint', m: number) => {
    if (who === 'joint') return householdRetired(m);
    const person = who === 'partner' && h.partner ? h.partner : h.you;
    return ageOf(who, m) >= person.retirementAge;
  };
  const infl = (m: number) => Math.pow(1 + h.inflationPct / 100, m / 12);

  // Everything is held in the home currency. Foreign items are converted at
  // today's rate, then drift with their currency each month.
  const fx = fxFor(h);
  const fxAt = (cur: Currency | undefined, m: number) => fx.at(cur, m, o.fxScale);
  let cash = h.cashOnHand;
  let pot = 0; // reinvested surplus
  const inv = h.investments.map((i) => i.balance * fxAt(i.currency, 0));
  const prop = h.properties.map((p) => p.value * fxAt(p.currency, 0));
  const mort = h.properties.map((p) => p.mortgageBalance * fxAt(p.currency, 0));
  const sold = h.properties.map(() => false);
  const other = h.otherAssets.map((a) => a.value * fxAt(a.currency, 0));
  const debt = h.debts.map((d) => d.balance * fxAt(d.currency, 0));
  const invDrift = h.investments.map((i) => fx.drift(i.currency));
  const propDrift = h.properties.map((p) => fx.drift(p.currency));
  const otherDrift = h.otherAssets.map((a) => fx.drift(a.currency));
  const debtDrift = h.debts.map((d) => fx.drift(d.currency));
  const retCur = retirementCurrency(h);

  const invBase = h.investments.map((i) => (o.investmentReturnOverride ?? i.returnPct) + o.investmentShiftPct);
  const potBase = (o.investmentReturnOverride ?? h.surplusReturnPct) + o.investmentShiftPct;
  const cashRate = monthlyRate(h.cashInterestPct);
  const propRates = h.properties.map((p) => monthlyRate((o.propertyGrowthOverride ?? p.growthPct) + o.propertyShiftPct));
  const mortRates = h.properties.map((p) => monthlyRate(p.mortgageRatePct));
  const otherRates = h.otherAssets.map((a) => monthlyRate(otherAssetChange(a)));
  const debtRates = h.debts.map((d) => monthlyRate(d.ratePct));
  const windows = h.incomes.map((i) => incomeWindow(h, i));
  const accessAges = h.investments.map((i) => investmentAccessAge(h, i));
  const eventMonths = h.events.map((e) => (e.atAge - h.you.currentAge) * 12);

  let invRates = invBase.map((b, k) => monthlyRate(netReturn(h.investments[k], b)));
  let potRate = monthlyRate(potBase);

  // Retirement spending under the chosen withdrawal strategy
  let retLiving: number | null = null; // nominal monthly
  let retStart: number | null = null;
  let initialRate = 0;

  const point = (m: number, year: YearTotals): HouseholdPoint => {
    const d = infl(m);
    const investments = sum(inv) + pot;
    const property = sum(prop);
    const propertyDebt = sum(mort);
    const otherAssets = sum(other);
    const otherDebt = sum(debt);
    const liquid = cash + investments;
    return {
      age: h.you.currentAge + m / 12,
      partnerAge: h.partner ? h.you.currentAge + partnerOffset + m / 12 : null,
      cash: cash / d,
      investments: investments / d,
      property: property / d,
      propertyDebt: propertyDebt / d,
      otherAssets: otherAssets / d,
      otherDebt: otherDebt / d,
      liquid: liquid / d,
      netWorth: (liquid + property + otherAssets - propertyDebt - otherDebt) / d,
      income: year.income,
      spending: year.spending,
      loanPayments: year.loan,
      contributions: year.contrib,
      tax: year.tax,
      events: year.events,
      net: year.income - year.spending - year.loan - year.contrib - year.tax + year.events,
      unmet: year.unmet,
    };
  };
  type YearTotals = { income: number; spending: number; loan: number; contrib: number; tax: number; events: number; unmet: number };
  const emptyYear = (): YearTotals => ({ income: 0, spending: 0, loan: 0, contrib: 0, tax: 0, events: 0, unmet: 0 });

  const series: HouseholdPoint[] = [point(0, emptyYear())];
  let shortfallAge: number | null = null;
  let year = emptyYear();

  /** Pays `need` (nominal) from cash, savings, then accessible investments. Returns [unpaid, tax]. */
  const draw = (need: number, m: number): [number, number] => {
    const fromCash = Math.min(cash, need);
    cash -= fromCash;
    need -= fromCash;
    const fromPot = Math.min(pot, need);
    pot -= fromPot;
    need -= fromPot;
    let tax = 0;
    if (need > 0) {
      const accessible = h.investments.map((i, k) => {
        const a = accessAges[k];
        return a === undefined || ageOf(i.owner, m) >= a ? inv[k] : 0;
      });
      const available = sum(accessible);
      if (available > 0) {
        // Average tax on what is withdrawn, weighted by balance
        const avgRate = sum(accessible.map((bal, k) =>
          h.investments[k].taxTreatment === 'taxed_on_withdrawal' ? bal * (h.investments[k].taxRatePct / 100) : 0)) / available;
        const gross = Math.min(available, need / (1 - Math.min(avgRate, 0.95)));
        accessible.forEach((bal, k) => {
          if (bal > 0) inv[k] -= gross * (bal / available);
        });
        const received = gross * (1 - avgRate);
        tax = gross - received;
        need -= received;
      }
    }
    return [Math.max(0, need), tax];
  };

  for (let m = 0; m < months; m++) {
    const f = infl(m);
    const yearsFromNow = m / 12;
    let eventNet = 0;
    let eventTax = 0;

    // Monte Carlo: redraw returns each year
    if (o.yearShift && m % 12 === 0) {
      const extra = o.yearShift(m / 12);
      invRates = invBase.map((b, k) => monthlyRate(netReturn(h.investments[k], b + extra)));
      potRate = monthlyRate(potBase + extra);
    }

    // One-off events
    h.events.forEach((e, k) => {
      if (eventMonths[k] !== m) return;
      if (e.kind === 'money_in') {
        eventNet += e.amount * f * fxAt(e.currency, m);
      } else if (e.kind === 'money_out') {
        eventNet -= e.amount * f * fxAt(e.currency, m);
      } else if (e.kind === 'sell_investment') {
        // Cash out part or all of an investment; the money joins your savings
        const j = h.investments.findIndex((i) => i.name === e.investmentName);
        if (j < 0) return;
        const access = accessAges[j];
        if (access !== undefined && ageOf(h.investments[j].owner, m) < access) return;
        const gross = inv[j] * (e.sharePct / 100);
        const taxRate = h.investments[j].taxTreatment === 'taxed_on_withdrawal' ? h.investments[j].taxRatePct / 100 : 0;
        inv[j] -= gross;
        eventNet += gross * (1 - taxRate);
        eventTax += gross * taxRate;
      } else {
        const j = h.properties.findIndex((p) => p.name === e.propertyName);
        const idx = j >= 0 ? j : h.properties.findIndex((_, q) => !sold[q]);
        if (idx < 0 || sold[idx]) return;
        const proceeds = prop[idx] * (1 - e.sellingCostsPct / 100) - mort[idx];
        const replacement = e.replacementValue * f * fxAt(e.currency ?? h.properties[idx].currency, m);
        eventNet += proceeds - replacement;
        prop[idx] = replacement;
        mort[idx] = 0;
        sold[idx] = true;
      }
    });

    // Income
    let income = 0;
    h.incomes.forEach((inc, k) => {
      const age = ageOf(inc.owner, m);
      const { start, end } = windows[k];
      if ((start === undefined || age >= start) && (end === undefined || age < end)) {
        income += inc.monthlyAmount * (inc.risesWithInflation ? f : 1) * fxAt(inc.currency, m);
      }
    });
    h.properties.forEach((p, k) => {
      if (!sold[k]) income += p.monthlyNetRent * f * fxAt(p.currency, m);
    });

    // Living costs, with the retirement withdrawal strategy
    let living: number;
    if (!householdRetired(m)) {
      living = h.livingExpensesMonthly * f;
    } else {
      // Retirement costs are in the retirement country's currency when one is set
      const needsLiving = h.retirementLivingExpensesMonthly !== undefined
        ? h.retirementLivingExpensesMonthly * f * fxAt(retCur, m)
        : h.livingExpensesMonthly * f;
      if (h.withdrawal.strategy === 'needs') {
        living = needsLiving;
      } else {
        retStart ??= m;
        const anniversary = (m - retStart) % 12 === 0;
        const liquid = cash + pot + sum(inv);
        if (h.withdrawal.strategy === 'percent') {
          if (anniversary) retLiving = Math.max(0, (h.withdrawal.ratePct / 100) * liquid) / 12;
        } else if (anniversary) {
          if (retLiving === null) {
            retLiving = needsLiving;
            initialRate = liquid > 0 ? (retLiving * 12) / liquid : 0;
          } else {
            retLiving *= 1 + h.inflationPct / 100;
            const rate = liquid > 0 ? (retLiving * 12) / liquid : Infinity;
            if (initialRate > 0 && rate > initialRate * 1.2) retLiving *= 0.9;
            else if (initialRate > 0 && rate < initialRate * 0.8) retLiving *= 1.1;
          }
        }
        living = retLiving ?? needsLiving;
      }
    }
    let spending = living;
    h.properties.forEach((p, k) => {
      if (!sold[k] && p.monthlyCosts > 0) spending += p.monthlyCosts * f * fxAt(p.currency, m);
    });
    for (const dep of h.dependants) {
      if (yearsFromNow >= dep.startInYears && yearsFromNow < dep.startInYears + dep.years) spending += dep.monthlyCost * f * fxAt(dep.currency, m);
    }
    for (const ex of h.otherExpenses) {
      if (yearsFromNow >= ex.startInYears && (ex.years === undefined || yearsFromNow < ex.startInYears + ex.years)) {
        spending += ex.monthlyAmount * f * fxAt(ex.currency, m);
      }
    }

    // Contributions
    let contrib = 0;
    h.investments.forEach((i, k) => {
      if (i.monthlyContribution > 0 && !(i.contributionsStopAtRetirement && retiredOf(i.owner, m))) {
        const c = i.monthlyContribution * f * fxAt(i.currency, m);
        inv[k] += c;
        contrib += c;
      }
    });
    const contribOutflow = h.contributionsFromOutsideIncome ? 0 : contrib;

    // Loan repayments (interest accrues on the balance, the payment reduces it)
    let loan = 0;
    h.properties.forEach((p, k) => {
      if (mort[k] <= 0) return;
      const owed = mort[k] * (1 + mortRates[k]) * (1 + propDrift[k]);
      const pay = Math.min(p.monthlyRepayment * fxAt(p.currency, m), owed);
      mort[k] = owed - pay;
      loan += pay;
    });
    h.debts.forEach((dd, k) => {
      if (debt[k] <= 0) return;
      const owed = debt[k] * (1 + debtRates[k]) * (1 + debtDrift[k]);
      const pay = Math.min(dd.monthlyPayment * fxAt(dd.currency, m), owed);
      debt[k] = owed - pay;
      loan += pay;
    });

    // Surplus is reinvested; a shortfall is drawn from savings
    const net = income - spending - contribOutflow - loan + eventNet;
    let unmet = 0;
    let tax = 0;
    if (net >= 0) {
      pot += net;
    } else {
      [unmet, tax] = draw(-net, m);
      if (unmet > 0.01) shortfallAge ??= Math.floor(h.you.currentAge + m / 12);
      else unmet = 0;
    }

    // Growth
    cash *= 1 + cashRate;
    pot *= 1 + potRate;
    for (let k = 0; k < inv.length; k++) inv[k] = Math.max(0, inv[k] * (1 + invRates[k]) * (1 + invDrift[k]));
    for (let k = 0; k < prop.length; k++) prop[k] *= (1 + propRates[k]) * (1 + propDrift[k]);
    for (let k = 0; k < other.length; k++) other[k] = Math.max(0, other[k] * (1 + otherRates[k]) * (1 + otherDrift[k]));

    year = {
      income: year.income + income / f,
      spending: year.spending + spending / f,
      loan: year.loan + loan / f,
      contrib: year.contrib + contribOutflow / f,
      tax: year.tax + (tax + eventTax) / f,
      events: year.events + eventNet / f,
      unmet: year.unmet + unmet / f,
    };
    if ((m + 1) % 12 === 0) {
      series.push(point(m + 1, year));
      year = emptyYear();
    }
  }
  return { series, shortfallAge };
}

const at = (series: HouseholdPoint[], age: number) =>
  series.find((p) => p.age === age) ?? (age <= series[0].age ? series[0] : series[series.length - 1]);

// Seeded random numbers, so the same plan always gives the same Monte Carlo answer
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

function monteCarlo(h: Household, ages: number[], goal: { target: number; age: number } | null): MonteCarloResult {
  const rand = mulberry32(20260930);
  const years = h.endAge - h.you.currentAge;
  let ok = 0;
  let goalHits = 0;
  const shortfalls: number[] = [];
  const liquidAt = ages.map(() => [] as number[]);
  const worthAt = ages.map(() => [] as number[]);
  for (let run = 0; run < MC_RUNS; run++) {
    const shifts = Array.from({ length: years + 1 }, () => h.volatilityPct * normal(rand));
    const r = simulate(h, { investmentShiftPct: 0, propertyShiftPct: 0, yearShift: (y) => shifts[y] ?? 0 });
    if (r.shortfallAge === null) ok++;
    else shortfalls.push(r.shortfallAge);
    ages.forEach((age, k) => {
      const p = at(r.series, age);
      liquidAt[k].push(p.liquid);
      worthAt[k].push(p.netWorth);
    });
    if (goal && at(r.series, goal.age).netWorth >= goal.target) goalHits++;
  }
  shortfalls.sort((a, b) => a - b);
  return {
    runs: MC_RUNS,
    volatilityPct: h.volatilityPct,
    successRate: ok / MC_RUNS,
    goalProbability: goal ? goalHits / MC_RUNS : null,
    medianShortfallAge: shortfalls.length ? percentile(shortfalls, 0.5) : null,
    byAge: ages.map((age, k) => {
      const l = [...liquidAt[k]].sort((a, b) => a - b);
      const w = [...worthAt[k]].sort((a, b) => a - b);
      return {
        age,
        liquidP10: percentile(l, 0.1), liquidP50: percentile(l, 0.5), liquidP90: percentile(l, 0.9),
        netWorthP10: percentile(w, 0.1), netWorthP50: percentile(w, 0.5), netWorthP90: percentile(w, 0.9),
      };
    }),
  };
}

/** Today's monthly cash flow, line by line. */
function todaysCashflow(h: Household) {
  const fx = fxFor(h);
  const cv = (amount: number, cur?: Currency) => amount * fx.at(cur, 0);
  const tag = (label: string, cur?: Currency) => (cur && cur !== fx.home ? `${label} (${cur})` : label);
  const windows = h.incomes.map((i) => incomeWindow(h, i));
  const income: MonthlyLine[] = [];
  h.incomes.forEach((inc, k) => {
    const person = inc.owner === 'partner' && h.partner ? h.partner : h.you;
    const { start, end } = windows[k];
    if ((start === undefined || person.currentAge >= start) && (end === undefined || person.currentAge < end)) {
      income.push({ label: tag(inc.name, inc.currency), amount: cv(inc.monthlyAmount, inc.currency) });
    }
  });
  const rent = sum(h.properties.map((p) => cv(p.monthlyNetRent, p.currency)));
  if (rent > 0) income.push({ label: 'Net rent', amount: rent });

  const retired = h.you.currentAge >= h.you.retirementAge && (!h.partner || h.partner.currentAge >= h.partner.retirementAge);
  const outgoings: MonthlyLine[] = [];
  const living = retired && h.retirementLivingExpensesMonthly !== undefined
    ? cv(h.retirementLivingExpensesMonthly, retirementCurrency(h))
    : h.livingExpensesMonthly;
  if (living > 0) outgoings.push({ label: 'Living costs', amount: living });
  const propertyCosts = sum(h.properties.map((p) => cv(p.monthlyCosts, p.currency)));
  if (propertyCosts > 0) outgoings.push({ label: 'Property costs', amount: propertyCosts });
  const deps = sum(h.dependants.filter((d) => d.startInYears === 0 && d.years > 0).map((d) => cv(d.monthlyCost, d.currency)));
  if (deps > 0) outgoings.push({ label: 'Dependants', amount: deps });
  const other = sum(h.otherExpenses.filter((e) => e.startInYears === 0 && (e.years === undefined || e.years > 0)).map((e) => cv(e.monthlyAmount, e.currency)));
  if (other > 0) outgoings.push({ label: 'Other expenses', amount: other });
  const loans = sum(h.properties.filter((p) => p.mortgageBalance > 0).map((p) => cv(p.monthlyRepayment, p.currency))) +
    sum(h.debts.filter((d) => d.balance > 0).map((d) => cv(d.monthlyPayment, d.currency)));
  if (loans > 0) outgoings.push({ label: 'Loan repayments', amount: loans });
  const contrib = h.contributionsFromOutsideIncome ? 0 : sum(
    h.investments
      .filter((i) => {
        const person = i.owner === 'partner' && h.partner ? h.partner : h.you;
        const isRetired = i.owner === 'joint' ? retired : person.currentAge >= person.retirementAge;
        return !(i.contributionsStopAtRetirement && isRetired);
      })
      .map((i) => cv(i.monthlyContribution, i.currency)),
  );
  if (contrib > 0) outgoings.push({ label: 'Investing', amount: contrib });
  return { income, outgoings, monthlySurplus: sum(income.map((l) => l.amount)) - sum(outgoings.map((l) => l.amount)) };
}

function warningsFor(h: Household, expected: HouseholdScenario, surplus: number): string[] {
  const money = moneyFor(h.country);
  const c = profile(h.country);
  const w: string[] = [];
  for (const p of h.properties) {
    const pm = p.currency && p.currency !== COUNTRIES[h.country].currency ? moneyFor(countryOfCurrency(p.currency)) : money;
    const interest = (p.mortgageBalance * p.mortgageRatePct) / 100 / 12;
    if (p.mortgageBalance > 0 && p.monthlyRepayment === 0) {
      w.push(`${p.name}: no repayment is entered, so the mortgage grows with interest. Add the repayment if you make one.`);
    } else if (p.mortgageBalance > 0 && p.monthlyRepayment < interest) {
      w.push(
        `${p.name}: at ${p.mortgageRatePct}% interest the loan costs about ${pm(interest)} a month, more than the ${pm(p.monthlyRepayment)} repayment, so the balance grows. Check the balance, rate and repayment.`,
      );
    }
    if (p.mortgageBalance > p.value) w.push(`${p.name}: the mortgage is larger than the property's value (negative equity).`);
  }
  for (const d of h.debts) {
    if (d.balance > 0 && d.monthlyPayment < (d.balance * d.ratePct) / 100 / 12) {
      w.push(`${d.name}: the payment doesn't cover the interest, so the balance grows.`);
    }
  }
  for (const e of h.events) {
    if (e.kind === 'sell_property' && e.propertyName && !h.properties.some((p) => p.name === e.propertyName)) {
      w.push(`${e.name}: no property is called "${e.propertyName}", so the first unsold property is used.`);
    }
    if (e.kind === 'sell_investment') {
      const inv = h.investments.find((i) => i.name === e.investmentName);
      if (!inv) w.push(`${e.name}: no investment is called "${e.investmentName ?? ''}", so nothing is cashed out.`);
      else {
        const access = investmentAccessAge(h, inv);
        const person = inv.owner === 'partner' && h.partner ? h.partner : h.you;
        if (access !== undefined && person.currentAge + (e.atAge - h.you.currentAge) < access) {
          w.push(`${e.name}: ${inv.name} can't be withdrawn until age ${access}, so this is skipped. Choose a later age.`);
        }
      }
    }
    if (e.atAge <= h.you.currentAge || e.atAge >= h.endAge) w.push(`${e.name}: age ${e.atAge} is outside the plan, so it is ignored.`);
  }
  if (surplus < 0) w.push(`Spending is more than income today by about ${money(-surplus)} a month; the gap is drawn from savings.`);
  if (expected.shortfallAge !== null) {
    w.push(
      `In the expected case, cash and accessible investments run out at about age ${expected.shortfallAge}; after that, spending isn't fully covered unless a property is sold or spending changes.`,
    );
  }
  if (!h.incomes.some((i) => i.kind === 'pension') && !h.contributionsFromOutsideIncome) {
    w.push(`No pension is included. If you will receive ${c.pension.name} or another pension, add it under income.`);
  }
  return w;
}

export function projectHousehold(
  raw: HouseholdInput,
  options: { monteCarlo?: boolean; fxScale?: Partial<Record<Currency, number>> } = {},
): HouseholdResult {
  const h = HouseholdInputSchema.parse(raw);
  const c = profile(h.country);

  const run = (label: HouseholdScenario['label'], shift: number, propShift: number): HouseholdScenario => ({
    label,
    investmentShiftPct: shift,
    ...simulate(h, { investmentShiftPct: shift, propertyShiftPct: propShift, fxScale: options.fxScale }),
  });
  const scenarios: HouseholdResult['scenarios'] = [
    run('Low', -SPREAD, -PROPERTY_SPREAD),
    run('Expected', 0, 0),
    run('High', SPREAD, PROPERTY_SPREAD),
  ];
  const [low, mid, high] = scenarios;
  const start = mid.series[0];
  const retirementAge = Math.max(h.you.retirementAge, h.you.currentAge);

  const milestoneAges = [...new Set([retirementAge, 55, 60, 65, 70, 75, 80, 85, 90, h.endAge])]
    .filter((a) => a > h.you.currentAge && a <= h.endAge)
    .sort((a, b) => a - b);
  const milestones = milestoneAges.map((age) => ({
    age,
    partnerAge: at(mid.series, age).partnerAge,
    low: at(low.series, age).netWorth,
    expected: at(mid.series, age).netWorth,
    high: at(high.series, age).netWorth,
    liquid: at(mid.series, age).liquid,
  }));

  let goal: HouseholdResult['goal'];
  if (h.goal?.targetNetWorth) {
    const targetAge = Math.min(Math.max(h.goal.targetAge ?? retirementAge, h.you.currentAge), h.endAge);
    const expected = at(mid.series, targetAge).netWorth;
    goal = {
      target: h.goal.targetNetWorth,
      targetAge,
      low: at(low.series, targetAge).netWorth,
      expected,
      high: at(high.series, targetAge).netWorth,
      gap: h.goal.targetNetWorth - expected,
      onTrack: expected >= h.goal.targetNetWorth,
    };
  }

  const comparison = h.compare?.map((s) => {
    const r = simulate(h, {
      investmentShiftPct: 0,
      propertyShiftPct: 0,
      investmentReturnOverride: s.investmentReturnPct,
      propertyGrowthOverride: s.propertyGrowthPct,
    });
    const atRet = at(r.series, retirementAge);
    const goalValue = goal ? at(r.series, goal.targetAge).netWorth : null;
    return {
      label: s.label,
      investmentReturnPct: s.investmentReturnPct,
      atRetirement: atRet.netWorth,
      liquidAtRetirement: atRet.liquid,
      atEnd: r.series[r.series.length - 1].netWorth,
      shortfallAge: r.shortfallAge,
      meetsGoal: goal && goalValue !== null ? goalValue >= goal.target : null,
    };
  });

  const mc = options.monteCarlo === false
    ? { runs: 0, volatilityPct: h.volatilityPct, successRate: mid.shortfallAge === null ? 1 : 0, goalProbability: null, medianShortfallAge: null, byAge: [] }
    : monteCarlo(h, milestoneAges, goal ? { target: goal.target, age: goal.targetAge } : null);
  const flow = todaysCashflow(h);
  const assets = start.cash + start.investments + start.property + start.otherAssets;
  const debts = start.propertyDebt + start.otherDebt;
  const strategyText = {
    needs: 'In retirement, the household spends the living costs entered.',
    percent: `In retirement, the household spends ${h.withdrawal.ratePct}% of its cash and investments each year, so spending rises and falls with markets.`,
    guardrails: 'In retirement, spending starts at the living costs entered, is cut 10% when withdrawals climb 20% above their starting rate, and raised 10% when they fall 20% below it.',
  }[h.withdrawal.strategy];

  return {
    inputs: h,
    today: { assets, debts, netWorth: start.netWorth, liquid: start.liquid, ...flow },
    scenarios,
    retirementAge,
    milestones,
    goal,
    comparison,
    monteCarlo: mc,
    warnings: warningsFor(h, mid, flow.monthlySurplus),
    assumptions: [
      `Country: ${c.name}. Amounts in ${c.currency} in today's money, with ${h.inflationPct}% inflation a year; incomes, costs and contributions rise with inflation unless marked otherwise.`,
      'Incomes are after tax. Each investment\'s tax treatment is applied as entered: after-tax returns, tax on returns each year, tax when withdrawn, or tax-free.',
      `Low and High move investment returns ${SPREAD} percentage points down and up, and property growth ${PROPERTY_SPREAD} point.`,
      `The Monte Carlo run draws a random return for every year in ${MC_RUNS} simulated markets, with ${h.volatilityPct}% yearly volatility. Property values are not randomised.`,
      h.contributionsFromOutsideIncome
        ? 'Contributions are assumed to come from income that is not shown.'
        : `Any monthly surplus is reinvested at ${h.surplusReturnPct}% a year. A shortfall is paid from cash, then reinvested savings, then investments that can be withdrawn.`,
      `Retirement accounts can be withdrawn from ${c.retirementAccount.accessAge} (${c.retirementAccount.name}) and KiwiSaver from 65, unless another age is entered. Salary stops at its owner's retirement age; pensions start at ${c.pension.age} (${c.pension.name}) unless another age is entered.`,
      'Properties are kept unless an event sells them. Mortgages accrue interest monthly and fall by the repayment entered; once repaid, that money becomes surplus.',
      strategyText,
      h.partner ? 'Planned as a couple. Ages on the chart are yours; the table also shows your partner\'s age.' : 'Planned for one person.',
      ...(h.fx.length
        ? [`Everything is shown in ${c.currency}. Other currencies are converted each month: ${h.fx.map((f) => `1 ${f.currency} = ${f.rate} ${c.currency}${f.yearlyChangePct ? `, ${f.yearlyChangePct > 0 ? 'rising' : 'falling'} ${Math.abs(f.yearlyChangePct)}% a year` : ''}`).join('; ')}. Exchange rates are not randomised in the simulated markets.`]
        : []),
      ...(h.retireIn && h.retireIn !== h.country
        ? [`Retiring in ${COUNTRIES[h.retireIn].name}: retirement living costs are in ${COUNTRIES[h.retireIn].currency}. Pensions and accounts follow the rules of the country their currency belongs to.`]
        : []),
    ],
    disclaimer: HOUSEHOLD_DISCLAIMER,
  };
}

/** Compact, rounded result for the chat model. The browser redraws the chart from the inputs. */
export function summariseHousehold(r: HouseholdResult) {
  const n = (x: number) => Math.round(x);
  const c = profile(r.inputs.country);
  return {
    basis: {
      country: c.name, currency: c.currency, moneyIs: "today's money", inflationPct: r.inputs.inflationPct,
      retireIn: r.inputs.retireIn ? COUNTRIES[r.inputs.retireIn].name : undefined,
      exchangeRates: r.inputs.fx.map((f) => `1 ${f.currency} = ${f.rate} ${c.currency}`),
    },
    today: {
      netWorth: n(r.today.netWorth),
      assets: n(r.today.assets),
      debts: n(r.today.debts),
      cashAndInvestments: n(r.today.liquid),
      monthlyIncome: r.today.income.map((l) => ({ ...l, amount: n(l.amount) })),
      monthlyOutgoings: r.today.outgoings.map((l) => ({ ...l, amount: n(l.amount) })),
      monthlySurplus: n(r.today.monthlySurplus),
    },
    netWorthAtAge: r.milestones.map((m) => ({
      age: m.age,
      partnerAge: m.partnerAge,
      low: n(m.low),
      expected: n(m.expected),
      high: n(m.high),
      cashAndInvestmentsExpected: n(m.liquid),
    })),
    moneyRunsOutAtAge: Object.fromEntries(r.scenarios.map((s) => [s.label, s.shortfallAge])),
    monteCarlo: {
      simulatedMarkets: r.monteCarlo.runs,
      chanceSpendingIsCoveredToEnd: `${Math.round(r.monteCarlo.successRate * 100)}%`,
      chanceOfReachingGoal: r.monteCarlo.goalProbability === null ? null : `${Math.round(r.monteCarlo.goalProbability * 100)}%`,
      medianAgeMoneyRunsOutWhenItDoes: r.monteCarlo.medianShortfallAge,
    },
    goal: r.goal && {
      target: n(r.goal.target),
      byAge: r.goal.targetAge,
      expected: n(r.goal.expected),
      low: n(r.goal.low),
      high: n(r.goal.high),
      shortfall: n(Math.max(0, r.goal.gap)),
      onTrack: r.goal.onTrack,
    },
    comparison: r.comparison?.map((x) => ({
      ...x,
      atRetirement: n(x.atRetirement),
      liquidAtRetirement: n(x.liquidAtRetirement),
      atEnd: n(x.atEnd),
    })),
    warnings: r.warnings,
    assumptions: r.assumptions,
  };
}
