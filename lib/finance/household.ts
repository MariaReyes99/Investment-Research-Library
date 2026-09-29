/**
 * Household projection engine.
 *
 * Projects a whole household month by month: one person or a couple, cash on
 * hand, investments (including KiwiSaver), properties and their mortgages,
 * other assets and debts, every source of income (salary, dividends, rent,
 * pensions such as NZ Super) and every expense (living costs, children,
 * parents, pets, anything else).
 *
 * Each month, income minus spending, loan repayments and investment
 * contributions is the household's surplus. A surplus is reinvested; a
 * shortfall is paid from cash, then reinvested savings, then investments that
 * can be accessed (KiwiSaver only from its access age). Properties are never
 * sold automatically.
 *
 * Pure functions, no I/O: runs in the browser (so numbers stay on the device)
 * and as the chat's projectHousehold tool. Rates are annual percentages
 * (7 = 7%). Amounts are in one currency (NZD). "Real" figures are in today's
 * dollars.
 */
import { z } from 'zod';

const amount = z.number().min(0).max(1e10);
const monthly = z.number().min(0).max(1e8);
const name = z.string().trim().min(1).max(80);
const owner = z.enum(['you', 'partner', 'joint']).default('you');

export const PersonSchema = z.object({
  currentAge: z.number().int().min(16).max(100),
  retirementAge: z.number().int().min(16).max(100).describe('Age this person stops working. Can be at or below currentAge if already retired.'),
});

export const InvestmentSchema = z.object({
  name,
  kind: z.enum(['kiwisaver', 'shares', 'managed_fund', 'term_deposit', 'bonds', 'other']).default('shares'),
  owner,
  balance: amount,
  returnPct: z.number().min(-10).max(20).describe('Expected yearly return before fees'),
  feesPct: z.number().min(0).max(5).default(0),
  monthlyContribution: monthly.default(0).describe('Paid from household income, including any employer share'),
  contributionsStopAtRetirement: z.boolean().default(true),
  accessAge: z.number().int().min(16).max(100).optional().describe("Owner's age when withdrawals are allowed. KiwiSaver defaults to 65."),
});

export const PropertySchema = z.object({
  name,
  value: amount.describe('Current market value (not the mortgage balance)'),
  growthPct: z.number().min(-10).max(20).default(3),
  mortgageBalance: amount.default(0),
  mortgageRatePct: z.number().min(0).max(25).default(5.5),
  monthlyRepayment: monthly.default(0),
  monthlyNetRent: monthly.default(0).describe('Rent received after rates, insurance and upkeep'),
});

export const OtherAssetSchema = z.object({
  name,
  kind: z.enum(['vehicle', 'jewellery', 'collectibles', 'business', 'other']).default('other'),
  value: amount,
  changePct: z.number().min(-50).max(20).optional().describe('Yearly change in value. Vehicles default to -10%, others to 0%.'),
});

export const DebtSchema = z.object({
  name,
  balance: amount,
  ratePct: z.number().min(0).max(50).default(8),
  monthlyPayment: monthly.default(0),
});

export const IncomeSchema = z.object({
  name,
  kind: z.enum(['salary', 'dividends', 'rental', 'business', 'pension', 'annuity', 'other']).default('other'),
  owner,
  monthlyAmount: monthly.describe("After tax, in today's dollars"),
  startAge: z.number().int().min(16).max(110).optional().describe("Owner's age it starts. Pensions default to 65."),
  endAge: z.number().int().min(16).max(110).optional().describe("Owner's age it stops. Salary defaults to the owner's retirement age."),
  risesWithInflation: z.boolean().default(true),
});

export const DependantSchema = z.object({
  name,
  kind: z.enum(['child', 'parent', 'pet', 'other']).default('child'),
  monthlyCost: monthly,
  years: z.number().min(0).max(80).describe('How many more years the cost lasts'),
  startInYears: z.number().min(0).max(80).default(0),
});

export const ExpenseSchema = z.object({
  name,
  monthlyAmount: monthly,
  years: z.number().min(0).max(80).optional().describe('How many years it lasts. Leave out for ongoing costs.'),
  startInYears: z.number().min(0).max(80).default(0),
});

export const StrategySchema = z.object({
  label: z.string().trim().min(1).max(60),
  investmentReturnPct: z.number().min(-10).max(20).describe('Replaces the return on every investment and on reinvested savings'),
  propertyGrowthPct: z.number().min(-10).max(20).optional(),
});

export const HouseholdInputSchema = z
  .object({
    you: PersonSchema,
    partner: PersonSchema.optional(),
    endAge: z.number().int().min(40).max(110).default(90).describe('Your age the projection runs to'),
    inflationPct: z.number().min(0).max(15).default(2.5),
    cashOnHand: amount.default(0),
    cashInterestPct: z.number().min(0).max(15).default(2.5),
    investments: z.array(InvestmentSchema).max(20).default([]),
    properties: z.array(PropertySchema).max(10).default([]),
    otherAssets: z.array(OtherAssetSchema).max(15).default([]),
    debts: z.array(DebtSchema).max(15).default([]),
    incomes: z.array(IncomeSchema).max(20).default([]),
    livingExpensesMonthly: monthly.default(0).describe('Everyday household costs, excluding loan repayments and investing'),
    retirementLivingExpensesMonthly: monthly.optional().describe('Living costs once everyone has retired. Defaults to the same as now.'),
    dependants: z.array(DependantSchema).max(15).default([]),
    otherExpenses: z.array(ExpenseSchema).max(15).default([]),
    surplusReturnPct: z.number().min(-5).max(20).default(5).describe('Yearly return on reinvested surplus cash, after fees'),
    goal: z
      .object({
        targetNetWorth: amount.optional().describe("Target net worth in today's dollars"),
        targetAge: z.number().int().min(17).max(110).optional().describe('Your age by which to reach it. Defaults to your retirement age.'),
      })
      .optional(),
    compare: z.array(StrategySchema).max(6).optional().describe('Optional return assumptions to compare side by side'),
  })
  .refine((h) => h.endAge > h.you.currentAge, { message: 'endAge must be after your current age', path: ['endAge'] });

export type HouseholdInput = z.input<typeof HouseholdInputSchema>;
export type Household = z.output<typeof HouseholdInputSchema>;

export interface HouseholdPoint {
  age: number;
  partnerAge: number | null;
  /** All values in today's dollars. */
  cash: number;
  investments: number;
  property: number;
  propertyDebt: number;
  otherAssets: number;
  otherDebt: number;
  liquid: number;
  netWorth: number;
  /** Totals for the year just ended, in today's dollars. */
  income: number;
  spending: number;
  loanPayments: number;
  contributions: number;
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
  warnings: string[];
  assumptions: string[];
  disclaimer: string;
}

export const HOUSEHOLD_DISCLAIMER =
  'These projections are illustrations based on the assumptions shown, not predictions or financial advice. Returns are not guaranteed, and actual results will differ.';

const SPREAD = 2; // percentage points for Low/High investment returns
const PROPERTY_SPREAD = 1;

const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nzd = (n: number) => `$${Math.round(n).toLocaleString('en-NZ')}`;

function otherAssetChange(a: Household['otherAssets'][number]) {
  return a.changePct ?? (a.kind === 'vehicle' ? -10 : 0);
}

function investmentAccessAge(inv: Household['investments'][number]) {
  return inv.accessAge ?? (inv.kind === 'kiwisaver' ? 65 : undefined);
}

function incomeWindow(h: Household, inc: Household['incomes'][number]) {
  const person = inc.owner === 'partner' && h.partner ? h.partner : h.you;
  return {
    start: inc.startAge ?? (inc.kind === 'pension' ? 65 : undefined),
    end: inc.endAge ?? (inc.kind === 'salary' ? person.retirementAge : undefined),
  };
}

interface SimOptions {
  investmentShiftPct: number;
  propertyShiftPct: number;
  investmentReturnOverride?: number;
  propertyGrowthOverride?: number;
}

/** Runs one scenario. Returns yearly points in today's dollars. */
function simulate(h: Household, o: SimOptions): { series: HouseholdPoint[]; shortfallAge: number | null } {
  const months = (h.endAge - h.you.currentAge) * 12;
  const partnerOffset = h.partner ? h.partner.currentAge - h.you.currentAge : 0;
  const ageOf = (who: 'you' | 'partner' | 'joint', m: number) =>
    (who === 'partner' && h.partner ? h.partner.currentAge : h.you.currentAge) + m / 12;
  const retiredOf = (who: 'you' | 'partner' | 'joint', m: number) => {
    if (who === 'joint') return householdRetired(m);
    const person = who === 'partner' && h.partner ? h.partner : h.you;
    return ageOf(who, m) >= person.retirementAge;
  };
  const householdRetired = (m: number) =>
    ageOf('you', m) >= h.you.retirementAge && (!h.partner || ageOf('partner', m) >= h.partner.retirementAge);
  const infl = (m: number) => Math.pow(1 + h.inflationPct / 100, m / 12);

  let cash = h.cashOnHand;
  let pot = 0; // reinvested surplus
  const inv = h.investments.map((i) => i.balance);
  const prop = h.properties.map((p) => p.value);
  const mort = h.properties.map((p) => p.mortgageBalance);
  const other = h.otherAssets.map((a) => a.value);
  const debt = h.debts.map((d) => d.balance);

  const invRates = h.investments.map((i) =>
    monthlyRate((o.investmentReturnOverride ?? i.returnPct) + o.investmentShiftPct - i.feesPct),
  );
  const potRate = monthlyRate((o.investmentReturnOverride ?? h.surplusReturnPct) + o.investmentShiftPct);
  const cashRate = monthlyRate(h.cashInterestPct);
  const propRates = h.properties.map((p) => monthlyRate((o.propertyGrowthOverride ?? p.growthPct) + o.propertyShiftPct));
  const mortRates = h.properties.map((p) => monthlyRate(p.mortgageRatePct));
  const otherRates = h.otherAssets.map((a) => monthlyRate(otherAssetChange(a)));
  const debtRates = h.debts.map((d) => monthlyRate(d.ratePct));
  const windows = h.incomes.map((i) => incomeWindow(h, i));

  const point = (m: number, year: { income: number; spending: number; loan: number; contrib: number; unmet: number }): HouseholdPoint => {
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
      net: year.income - year.spending - year.loan - year.contrib,
      unmet: year.unmet,
    };
  };

  const series: HouseholdPoint[] = [point(0, { income: 0, spending: 0, loan: 0, contrib: 0, unmet: 0 })];
  let shortfallAge: number | null = null;
  let year = { income: 0, spending: 0, loan: 0, contrib: 0, unmet: 0 };

  for (let m = 0; m < months; m++) {
    const f = infl(m);
    const d = f; // deflator for this month's flows

    // Income
    let income = 0;
    h.incomes.forEach((inc, k) => {
      const age = ageOf(inc.owner, m);
      const { start, end } = windows[k];
      if ((start === undefined || age >= start) && (end === undefined || age < end)) {
        income += inc.monthlyAmount * (inc.risesWithInflation ? f : 1);
      }
    });
    h.properties.forEach((p) => (income += p.monthlyNetRent * f));

    // Spending
    const living = (householdRetired(m) ? h.retirementLivingExpensesMonthly ?? h.livingExpensesMonthly : h.livingExpensesMonthly) * f;
    const yearsFromNow = m / 12;
    let spending = living;
    for (const dep of h.dependants) {
      if (yearsFromNow >= dep.startInYears && yearsFromNow < dep.startInYears + dep.years) spending += dep.monthlyCost * f;
    }
    for (const ex of h.otherExpenses) {
      if (yearsFromNow >= ex.startInYears && (ex.years === undefined || yearsFromNow < ex.startInYears + ex.years)) {
        spending += ex.monthlyAmount * f;
      }
    }

    // Contributions
    let contrib = 0;
    h.investments.forEach((i, k) => {
      if (i.monthlyContribution > 0 && !(i.contributionsStopAtRetirement && retiredOf(i.owner, m))) {
        const c = i.monthlyContribution * f;
        inv[k] += c;
        contrib += c;
      }
    });

    // Loan repayments (interest accrues on the balance, the payment reduces it)
    let loan = 0;
    h.properties.forEach((p, k) => {
      if (mort[k] <= 0) return;
      const owed = mort[k] * (1 + mortRates[k]);
      const pay = Math.min(p.monthlyRepayment, owed);
      mort[k] = owed - pay;
      loan += pay;
    });
    h.debts.forEach((dd, k) => {
      if (debt[k] <= 0) return;
      const owed = debt[k] * (1 + debtRates[k]);
      const pay = Math.min(dd.monthlyPayment, owed);
      debt[k] = owed - pay;
      loan += pay;
    });

    // Surplus is reinvested; a shortfall is drawn from cash, savings, then accessible investments
    const net = income - spending - contrib - loan;
    let unmet = 0;
    if (net >= 0) {
      pot += net;
    } else {
      let need = -net;
      const fromCash = Math.min(cash, need);
      cash -= fromCash;
      need -= fromCash;
      const fromPot = Math.min(pot, need);
      pot -= fromPot;
      need -= fromPot;
      if (need > 0) {
        const accessible = h.investments.map((i, k) => {
          const a = investmentAccessAge(i);
          return a === undefined || ageOf(i.owner, m) >= a ? inv[k] : 0;
        });
        const available = sum(accessible);
        if (available > 0) {
          const take = Math.min(available, need);
          accessible.forEach((bal, k) => {
            if (bal > 0) inv[k] -= take * (bal / available);
          });
          need -= take;
        }
      }
      if (need > 0.01) {
        unmet = need;
        shortfallAge ??= Math.floor(h.you.currentAge + m / 12);
      }
    }

    // Growth
    cash *= 1 + cashRate;
    pot *= 1 + potRate;
    for (let k = 0; k < inv.length; k++) inv[k] = Math.max(0, inv[k] * (1 + invRates[k]));
    for (let k = 0; k < prop.length; k++) prop[k] *= 1 + propRates[k];
    for (let k = 0; k < other.length; k++) other[k] = Math.max(0, other[k] * (1 + otherRates[k]));

    year = {
      income: year.income + income / d,
      spending: year.spending + spending / d,
      loan: year.loan + loan / d,
      contrib: year.contrib + contrib / d,
      unmet: year.unmet + unmet / d,
    };
    if ((m + 1) % 12 === 0) {
      series.push(point(m + 1, year));
      year = { income: 0, spending: 0, loan: 0, contrib: 0, unmet: 0 };
    }
  }
  return { series, shortfallAge };
}

const at = (series: HouseholdPoint[], age: number) =>
  series.find((p) => p.age === age) ?? (age <= series[0].age ? series[0] : series[series.length - 1]);

/** Today's monthly cash flow, line by line. */
function todaysCashflow(h: Household) {
  const windows = h.incomes.map((i) => incomeWindow(h, i));
  const income: MonthlyLine[] = [];
  h.incomes.forEach((inc, k) => {
    const person = inc.owner === 'partner' && h.partner ? h.partner : h.you;
    const { start, end } = windows[k];
    if ((start === undefined || person.currentAge >= start) && (end === undefined || person.currentAge < end)) {
      income.push({ label: inc.name, amount: inc.monthlyAmount });
    }
  });
  const rent = sum(h.properties.map((p) => p.monthlyNetRent));
  if (rent > 0) income.push({ label: 'Net rent', amount: rent });

  const retired = h.you.currentAge >= h.you.retirementAge && (!h.partner || h.partner.currentAge >= h.partner.retirementAge);
  const outgoings: MonthlyLine[] = [];
  const living = retired ? h.retirementLivingExpensesMonthly ?? h.livingExpensesMonthly : h.livingExpensesMonthly;
  if (living > 0) outgoings.push({ label: 'Living costs', amount: living });
  const deps = sum(h.dependants.filter((d) => d.startInYears === 0 && d.years > 0).map((d) => d.monthlyCost));
  if (deps > 0) outgoings.push({ label: 'Dependants', amount: deps });
  const other = sum(h.otherExpenses.filter((e) => e.startInYears === 0 && (e.years === undefined || e.years > 0)).map((e) => e.monthlyAmount));
  if (other > 0) outgoings.push({ label: 'Other expenses', amount: other });
  const loans = sum(h.properties.filter((p) => p.mortgageBalance > 0).map((p) => p.monthlyRepayment)) +
    sum(h.debts.filter((d) => d.balance > 0).map((d) => d.monthlyPayment));
  if (loans > 0) outgoings.push({ label: 'Loan repayments', amount: loans });
  const contrib = sum(
    h.investments
      .filter((i) => {
        const person = i.owner === 'partner' && h.partner ? h.partner : h.you;
        const isRetired = i.owner === 'joint' ? retired : person.currentAge >= person.retirementAge;
        return !(i.contributionsStopAtRetirement && isRetired);
      })
      .map((i) => i.monthlyContribution),
  );
  if (contrib > 0) outgoings.push({ label: 'Investing', amount: contrib });
  return { income, outgoings, monthlySurplus: sum(income.map((l) => l.amount)) - sum(outgoings.map((l) => l.amount)) };
}

function warningsFor(h: Household, expected: HouseholdScenario, surplus: number): string[] {
  const w: string[] = [];
  for (const p of h.properties) {
    const interest = (p.mortgageBalance * p.mortgageRatePct) / 100 / 12;
    if (p.mortgageBalance > 0 && p.monthlyRepayment === 0) {
      w.push(`${p.name}: no repayment is entered, so the mortgage grows with interest. Add the repayment if you make one.`);
    } else if (p.mortgageBalance > 0 && p.monthlyRepayment < interest) {
      w.push(
        `${p.name}: at ${p.mortgageRatePct}% interest the loan costs about ${nzd(interest)} a month, more than the ${nzd(p.monthlyRepayment)} repayment, so the balance grows. Check the balance, rate and repayment.`,
      );
    }
    if (p.mortgageBalance > p.value) w.push(`${p.name}: the mortgage is larger than the property's value (negative equity).`);
  }
  for (const d of h.debts) {
    if (d.balance > 0 && d.monthlyPayment < (d.balance * d.ratePct) / 100 / 12) {
      w.push(`${d.name}: the payment doesn't cover the interest, so the balance grows.`);
    }
  }
  if (surplus < 0) w.push(`Spending is more than income today by about ${nzd(-surplus)} a month; the gap is drawn from savings.`);
  if (expected.shortfallAge !== null) {
    w.push(
      `In the expected case, cash and accessible investments run out at about age ${expected.shortfallAge}; after that, spending isn't fully covered unless a property is sold or spending changes.`,
    );
  }
  if (!h.incomes.some((i) => i.kind === 'pension')) {
    w.push('No pension is included. If you will receive NZ Super or another pension, add it under income.');
  }
  return w;
}

export function projectHousehold(raw: HouseholdInput): HouseholdResult {
  const h = HouseholdInputSchema.parse(raw);

  const run = (label: HouseholdScenario['label'], shift: number, propShift: number): HouseholdScenario => ({
    label,
    investmentShiftPct: shift,
    ...simulate(h, { investmentShiftPct: shift, propertyShiftPct: propShift }),
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

  const flow = todaysCashflow(h);
  const assets = start.cash + start.investments + start.property + start.otherAssets;
  const debts = start.propertyDebt + start.otherDebt;

  return {
    inputs: h,
    today: { assets, debts, netWorth: start.netWorth, liquid: start.liquid, ...flow },
    scenarios,
    retirementAge,
    milestones,
    goal,
    comparison,
    warnings: warningsFor(h, mid, flow.monthlySurplus),
    assumptions: [
      `Inflation ${h.inflationPct}% a year. Figures are in today's dollars; incomes, costs and contributions rise with inflation unless marked otherwise.`,
      'Incomes are after tax. Investment returns are before the fees entered and after tax.',
      `Low and High move investment returns ${SPREAD} percentage points down and up, and property growth ${PROPERTY_SPREAD} point.`,
      `Any monthly surplus is reinvested at ${h.surplusReturnPct}% a year. A shortfall is paid from cash, then reinvested savings, then investments that can be withdrawn.`,
      'KiwiSaver can be withdrawn from 65 unless another access age is entered. Salary stops at its owner\'s retirement age; pensions start at 65 unless another age is entered.',
      'Properties are kept, not sold. Mortgages accrue interest monthly and fall by the repayment entered; once repaid, that money becomes surplus.',
      h.partner ? 'Planned as a couple. Ages on the chart are yours; the table also shows your partner\'s age.' : 'Planned for one person.',
    ],
    disclaimer: HOUSEHOLD_DISCLAIMER,
  };
}

/** Compact, rounded result for the chat model. The browser redraws the chart from the inputs. */
export function summariseHousehold(r: HouseholdResult) {
  const n = (x: number) => Math.round(x);
  return {
    today: {
      netWorth: n(r.today.netWorth),
      assets: n(r.today.assets),
      debts: n(r.today.debts),
      cashAndInvestments: n(r.today.liquid),
      monthlyIncome: r.today.income.map((l) => ({ ...l, amount: n(l.amount) })),
      monthlyOutgoings: r.today.outgoings.map((l) => ({ ...l, amount: n(l.amount) })),
      monthlySurplus: n(r.today.monthlySurplus),
    },
    netWorthAtAgeTodaysDollars: r.milestones.map((m) => ({
      age: m.age,
      partnerAge: m.partnerAge,
      low: n(m.low),
      expected: n(m.expected),
      high: n(m.high),
      cashAndInvestmentsExpected: n(m.liquid),
    })),
    moneyRunsOutAtAge: Object.fromEntries(r.scenarios.map((s) => [s.label, s.shortfallAge])),
    goal: r.goal && {
      target: n(r.goal.target),
      byAge: r.goal.targetAge,
      expected: n(r.goal.expected),
      low: n(r.goal.low),
      high: n(r.goal.high),
      shortfall: n(Math.max(0, r.goal.gap)),
      onTrack: r.goal.onTrack,
    },
    comparison: r.comparison?.map((c) => ({
      ...c,
      atRetirement: n(c.atRetirement),
      liquidAtRetirement: n(c.liquidAtRetirement),
      atEnd: n(c.atEnd),
    })),
    warnings: r.warnings,
    assumptions: r.assumptions,
  };
}
