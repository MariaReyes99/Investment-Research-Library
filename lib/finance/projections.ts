/**
 * Wealth projection engine for the Investment Research Library.
 *
 * Pure functions, no I/O: safe to run in the browser (so a user's numbers never
 * leave their device) or on the server as an LLM tool.
 *
 * All rates are annual percentages (7 = 7%). Money is in one currency (e.g. NZD).
 * "Real" values are in today's dollars (deflated by inflationPct).
 */
import { z } from "zod";
import { COUNTRY_CODES } from "../countries";

export const ProjectionAssetSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["kiwisaver", "shares", "property", "cash", "bonds", "vehicle", "jewelry", "business", "other"]),
  provider: z.string().trim().max(80).optional(),
  fundType: z.enum(["defensive", "conservative", "balanced", "growth", "aggressive"]).optional(),
  currentBalance: z.number().min(0).max(1e10),
  monthlyContribution: z.number().min(0).max(1e7).default(0),
  expectedReturnPct: z.number().min(-10).max(20).default(0),
  feesPct: z.number().min(0).max(5).default(0),
  taxDragPct: z.number().min(0).max(5).default(0),
  growthEnabled: z.boolean().default(true),
  incomeEligible: z.boolean().default(true),
});

export type ProjectionAssetInput = z.input<typeof ProjectionAssetSchema>;
type ProjectionAsset = z.output<typeof ProjectionAssetSchema>;

export const ProjectionDebtSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["mortgage", "vehicle", "personal", "student", "credit", "business", "other"]),
  /** Optional asset this liability is secured against, for per-asset equity reporting. */
  assetId: z.string().min(1).max(60).optional(),
  currentBalance: z.number().min(0).max(1e10),
  annualInterestPct: z.number().min(0).max(50).default(0),
  monthlyPayment: z.number().min(0).max(1e7).default(0),
});

export type ProjectionDebtInput = z.input<typeof ProjectionDebtSchema>;
type ProjectionDebt = z.output<typeof ProjectionDebtSchema>;

// ---------------------------------------------------------------------------
// Input schema (use this to validate API bodies and LLM tool arguments)
// ---------------------------------------------------------------------------
export const ProjectionInputSchema = z
  .object({
    /** Country whose currency the amounts are in. Used for labels only. */
    country: z.enum(COUNTRY_CODES).optional(),
    currentAge: z.number().int().min(16).max(100),
    retirementAge: z.number().int().min(17).max(100),
    /** Age the projection runs to (for drawdown). Default 90. */
    endAge: z.number().int().min(18).max(110).default(90),
    currentSavings: z.number().min(0).max(1e10),
    /** Total monthly contribution, including any KiwiSaver employer share. */
    monthlyContribution: z.number().min(0).max(1e7),
    /** Yearly increase in contributions, e.g. wage growth. */
    contributionGrowthPct: z.number().min(0).max(15).default(0),
    /** Expected gross annual return before fees. */
    expectedReturnPct: z.number().min(-10).max(20),
    /** Fund/platform fees per year. */
    feesPct: z.number().min(0).max(5).default(0.5),
    /** Tax drag per year (e.g. PIE/FIF tax), as a % of the balance. */
    taxDragPct: z.number().min(0).max(5).default(0),
    inflationPct: z.number().min(0).max(15).default(2.5),
    /** Annual volatility for Monte Carlo (std dev of returns). */
    volatilityPct: z.number().min(0).max(60).default(15),
    /** Safe withdrawal rate used to turn a balance into income. */
    withdrawalRatePct: z.number().min(1).max(10).default(4),
    /** After-tax monthly household income, for the cash-flow check only. */
    monthlyHouseholdIncome: z.number().min(0).max(1e8).default(0),
    /** Monthly living costs excluding debt payments and investments. */
    monthlyLivingExpenses: z.number().min(0).max(1e8).default(0),
    goal: z
      .object({
        /** Target balance in today's dollars. */
        targetAmount: z.number().min(0).max(1e11).optional(),
        /** Or: desired yearly retirement income in today's dollars. */
        desiredAnnualIncome: z.number().min(0).max(1e9).optional(),
        /** Age by which the goal should be met. Default = retirementAge. */
        targetAge: z.number().int().min(17).max(110).optional(),
      })
      .optional(),
    /** Optional asset buckets; when present, these replace the aggregate balance inputs. */
    assets: z.array(ProjectionAssetSchema).max(20).optional(),
    debts: z.array(ProjectionDebtSchema).max(20).optional(),
  })
  .refine((v) => v.retirementAge > v.currentAge, {
    message: "retirementAge must be greater than currentAge",
    path: ["retirementAge"],
  })
  .refine((v) => v.endAge >= v.retirementAge, {
    message: "endAge must be at or after retirementAge",
    path: ["endAge"],
  });

export type ProjectionInput = z.input<typeof ProjectionInputSchema>;
type Input = z.output<typeof ProjectionInputSchema>;

export interface YearPoint {
  age: number;
  nominal: number;
  real: number;
  contributed: number; // cumulative money put in (incl. starting savings)
}

export interface ScenarioResult {
  label: "Low" | "Base" | "High";
  netReturnPct: number;
  series: YearPoint[];
  atRetirement: { nominal: number; real: number };
  /** Yearly income in today's dollars at the withdrawal rate. */
  sustainableIncomeReal: number;
  /** Age money runs out if drawing that income from retirement; null = lasts to endAge. */
  depletionAge: number | null;
}

export interface ProjectionResult {
  inputs: Input;
  currentNetWorth: number;
  monthlyCashflow: {
    householdIncome: number;
    livingExpenses: number;
    debtPayments: number;
    investmentContributions: number;
    remaining: number;
  };
  assumptions: string[];
  scenarios: ScenarioResult[];
  milestones: { age: number; low: number; base: number; high: number }[]; // real $
  goal?: {
    targetReal: number;
    targetAge: number;
    projectedRealBase: number;
    gapReal: number; // positive = shortfall
    onTrack: boolean;
    requiredMonthlyContribution: number | null; // to hit goal in Base case
    probabilityOfSuccess: number; // 0..1, Monte Carlo
  };
  assetBreakdown?: {
    id: string;
    name: string;
    kind: ProjectionAsset["kind"];
    provider?: string;
    currentBalance: number;
    monthlyContribution: number;
    growthEnabled: boolean;
    expectedReturnPct: number;
    retirementNominal: number;
    retirementReal: number;
    linkedDebtBalance: number;
    currentEquity: number;
    retirementEquity: number;
  }[];
  debtBreakdown?: {
    id: string;
    name: string;
    kind: ProjectionDebt["kind"];
    assetId?: string;
    assetName?: string;
    currentBalance: number;
    annualInterestPct: number;
    monthlyPayment: number;
    retirementBalance: number;
  }[];
  disclaimer: string;
}

export const PROJECTION_DISCLAIMER =
  "These projections are illustrations based on the assumptions shown, not predictions or financial advice. Returns are not guaranteed, and actual results will differ.";

// ---------------------------------------------------------------------------
// Core simulator (monthly steps)
// ---------------------------------------------------------------------------
const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

interface SimOpts {
  currentAge: number;
  endAge: number;
  retirementAge: number;
  startBalance: number;
  monthlyContribution: number;
  contributionGrowthPct: number;
  /** Net annual return per year index; lets Monte Carlo vary returns. */
  netReturnForYear: (yearIndex: number) => number;
  inflationPct: number;
  /** Real yearly withdrawal from retirement onward (0 = accumulate only). */
  withdrawalReal?: number;
  /** Separate investment buckets with their own returns and contributions. */
  assets?: {
    startingBalance: number;
    monthlyContribution: number;
    incomeEligible: boolean;
    netReturnForYear: (yearIndex: number) => number;
  }[];
  debts?: {
    startingBalance: number;
    annualInterestPct: number;
    monthlyPayment: number;
  }[];
}

function simulate(o: SimOpts): {
  series: YearPoint[];
  depletionAge: number | null;
  assetBalancesByAge: { age: number; values: number[] }[];
  debtBalancesByAge: { age: number; values: number[] }[];
} {
  const assets = o.assets?.length
    ? o.assets
    : [{ startingBalance: o.startBalance, monthlyContribution: o.monthlyContribution, incomeEligible: true, netReturnForYear: o.netReturnForYear }];
  const debts = o.debts ?? [];
  const balances = assets.map((asset) => asset.startingBalance);
  const contributions = assets.map((asset) => asset.monthlyContribution);
  const debtBalances = debts.map((debt) => debt.startingBalance);
  const totalAssets = () => balances.reduce((total, amount) => total + amount, 0);
  const totalDebts = () => debtBalances.reduce((total, amount) => total + amount, 0);
  const eligibleBalance = () => balances.reduce((total, amount, index) => total + (assets[index].incomeEligible ? amount : 0), 0);
  let balance = totalAssets() - totalDebts();
  let contributed = totalAssets();
  let depletionAge: number | null = null;
  const inflM = monthlyRate(o.inflationPct);
  const series: YearPoint[] = [
    { age: o.currentAge, nominal: balance, real: balance, contributed },
  ];
  const assetBalancesByAge = [{ age: o.currentAge, values: [...balances] }];
  const debtBalancesByAge = [{ age: o.currentAge, values: [...debtBalances] }];
  let month = 0;

  for (let age = o.currentAge; age < o.endAge; age++) {
    const yearIdx = age - o.currentAge;
    const rates = assets.map((asset) => monthlyRate(asset.netReturnForYear(yearIdx)));
    const debtRates = debts.map((debt) => monthlyRate(debt.annualInterestPct));
    const retired = age >= o.retirementAge;

    for (let m = 0; m < 12; m++) {
      month++;
      if (!retired) {
        for (let i = 0; i < assets.length; i++) {
          balances[i] += contributions[i];
          contributed += contributions[i];
        }
      } else if (o.withdrawalReal) {
        const withdrawal = (o.withdrawalReal / 12) * Math.pow(1 + inflM, month);
        const available = eligibleBalance();
        if (available > 0) {
          const amount = Math.min(withdrawal, available);
          for (let i = 0; i < balances.length; i++) {
            if (assets[i].incomeEligible) balances[i] -= amount * (balances[i] / available);
          }
        }
        if (eligibleBalance() <= 0) depletionAge ??= age;
      }
      for (let i = 0; i < balances.length; i++) balances[i] *= 1 + rates[i];
      for (let i = 0; i < debtBalances.length; i++) {
        debtBalances[i] = Math.max(0, debtBalances[i] * (1 + debtRates[i]) - debts[i].monthlyPayment);
      }
      balance = totalAssets() - totalDebts();
    }
    if (!retired) {
      for (let i = 0; i < contributions.length; i++) contributions[i] *= 1 + o.contributionGrowthPct / 100;
    }

    const deflator = Math.pow(1 + inflM, month);
    series.push({ age: age + 1, nominal: balance, real: balance / deflator, contributed });
    assetBalancesByAge.push({ age: age + 1, values: [...balances] });
    debtBalancesByAge.push({ age: age + 1, values: [...debtBalances] });
  }
  return { series, depletionAge, assetBalancesByAge, debtBalancesByAge };
}

const netReturn = (i: Input, grossPct: number) => grossPct - i.feesPct - i.taxDragPct;

function weightedAssetAverage(assets: ProjectionAsset[], getValue: (asset: ProjectionAsset) => number): number {
  const total = assets.reduce((sum, asset) => sum + asset.currentBalance + asset.monthlyContribution * 12, 0);
  const weight = (asset: ProjectionAsset) => total > 0 ? asset.currentBalance + asset.monthlyContribution * 12 : 1;
  return assets.reduce((sum, asset) => sum + getValue(asset) * weight(asset), 0) / (total || assets.length);
}

const valueAt = (series: YearPoint[], age: number) =>
  series.find((p) => p.age === age) ?? series[series.length - 1];

function incomeEligibleRealAt(projection: ReturnType<typeof simulate>, i: Input, age: number): number {
  const point = projection.assetBalancesByAge.find((entry) => entry.age === age);
  if (!point) return 0;
  const eligibility = i.assets?.length ? i.assets.map((asset) => asset.incomeEligible) : [true];
  const nominal = point.values.reduce((total, balance, index) => total + (eligibility[index] ? balance : 0), 0);
  const deflator = Math.pow(1 + monthlyRate(i.inflationPct), (age - i.currentAge) * 12);
  return nominal / deflator;
}

// ---------------------------------------------------------------------------
// Monte Carlo (seeded, so the same inputs give the same answer)
// ---------------------------------------------------------------------------
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
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function probabilityOfReaching(
  i: Input,
  targetReal: number,
  targetAge: number,
  runs = 2000,
  incomeOnly = false,
): number {
  const rand = mulberry32(42);
  const mu = netReturn(i, i.expectedReturnPct) / 100;
  const sigma = i.volatilityPct / 100;
  let hits = 0;
  for (let k = 0; k < runs; k++) {
    const yearly: number[] = [];
    const assetYearly: number[][] = [];
    const assetReturnForYear = (asset: ProjectionAsset, year: number, index: number) => {
      if (!asset.growthEnabled) return 0;
      const rates = assetYearly[index] ?? (assetYearly[index] = []);
      if (rates[year] !== undefined) return rates[year];
      const assetMu = (asset.expectedReturnPct - asset.feesPct - asset.taxDragPct) / 100;
      const logMu = Math.log(1 + assetMu) - (sigma * sigma) / 2;
      return (rates[year] = (Math.exp(logMu + sigma * normal(rand)) - 1) * 100);
    };
    const projection = simulate({
      ...base(i, 0, assetReturnForYear),
      endAge: targetAge,
      netReturnForYear: (y) => {
        const logMu = Math.log(1 + mu) - (sigma * sigma) / 2;
        return (yearly[y] ??= (Math.exp(logMu + sigma * normal(rand)) - 1) * 100);
      },
    });
    const projected = incomeOnly
      ? incomeEligibleRealAt(projection, i, targetAge)
      : valueAt(projection.series, targetAge).real;
    if (projected >= targetReal) hits++;
  }
  return hits / runs;
}

function base(
  i: Input,
  returnShift = 0,
  assetReturnForYear?: (asset: ProjectionAsset, yearIndex: number, assetIndex: number) => number,
) {
  return {
    currentAge: i.currentAge,
    endAge: i.endAge,
    retirementAge: i.retirementAge,
    startBalance: i.currentSavings,
    monthlyContribution: i.monthlyContribution,
    contributionGrowthPct: i.contributionGrowthPct,
    inflationPct: i.inflationPct,
    assets: i.assets?.map((asset, assetIndex) => ({
      startingBalance: asset.currentBalance,
      monthlyContribution: asset.monthlyContribution,
      incomeEligible: asset.incomeEligible,
      netReturnForYear: (yearIndex: number) => {
        if (!asset.growthEnabled) return 0;
        return assetReturnForYear
          ? assetReturnForYear(asset, yearIndex, assetIndex)
          : asset.expectedReturnPct + returnShift - asset.feesPct - asset.taxDragPct;
      },
    })),
    debts: i.debts?.map((debt) => ({
      startingBalance: debt.currentBalance,
      annualInterestPct: debt.annualInterestPct,
      monthlyPayment: debt.monthlyPayment,
    })),
  };
}

/** Monthly contribution needed to reach targetReal by targetAge (Base case). */
export function requiredMonthlyContribution(
  i: Input,
  targetReal: number,
  targetAge: number,
  incomeOnly = false,
): number | null {
  const withContribution = (amount: number): Input => {
    if (!i.assets?.length) return { ...i, monthlyContribution: amount };
    const targetAssets = i.assets.filter((asset) => !incomeOnly || asset.incomeEligible);
    const contributionTotal = targetAssets.reduce((sum, asset) => sum + asset.monthlyContribution, 0);
    const balanceTotal = targetAssets.reduce((sum, asset) => sum + asset.currentBalance, 0);
    const weights = i.assets.map((asset) =>
      incomeOnly && !asset.incomeEligible ? 0 :
      contributionTotal > 0
        ? asset.monthlyContribution / contributionTotal
        : balanceTotal > 0
          ? asset.currentBalance / balanceTotal
          : 1 / targetAssets.length,
    );
    return {
      ...i,
      monthlyContribution: amount,
      assets: i.assets.map((asset, index) => ({
        ...asset,
        monthlyContribution: incomeOnly && !asset.incomeEligible ? asset.monthlyContribution : amount * weights[index],
      })),
    };
  };
  if (incomeOnly && i.assets?.length && !i.assets.some((asset) => asset.incomeEligible)) return null;
  const reached = (amount: number) => {
    const input = withContribution(amount);
    const projection = simulate({
      ...base(input),
      endAge: targetAge,
      netReturnForYear: () => netReturn(i, i.expectedReturnPct),
    });
    const projected = incomeOnly
      ? incomeEligibleRealAt(projection, input, targetAge)
      : valueAt(projection.series, targetAge).real;
    return projected >= targetReal;
  };

  if (reached(0)) return 0;
  let lo = 0;
  let hi = 1_000;
  while (!reached(hi)) {
    hi *= 2;
    if (hi > 1e8) return null; // not achievable with sane contributions
  }
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    reached(mid) ? (hi = mid) : (lo = mid);
  }
  return Math.ceil(hi);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export function projectWealth(raw: ProjectionInput): ProjectionResult {
  const parsed = ProjectionInputSchema.parse(raw);
  const i: Input = parsed.assets?.length
    ? {
        ...parsed,
        currentSavings: parsed.assets.reduce((sum, asset) => sum + asset.currentBalance, 0),
        monthlyContribution: parsed.assets.reduce((sum, asset) => sum + asset.monthlyContribution, 0),
        expectedReturnPct: weightedAssetAverage(parsed.assets, (asset) => asset.growthEnabled ? asset.expectedReturnPct : 0),
      }
    : parsed;
  const spread = 2; // +/- percentage points for Low/High scenarios

  const scenarios: ScenarioResult[] = (
    [
      ["Low", i.expectedReturnPct - spread],
      ["Base", i.expectedReturnPct],
      ["High", i.expectedReturnPct + spread],
    ] as const
  ).map(([label, gross]) => {
    const returnShift = gross - i.expectedReturnPct;
    const scenarioBase = base(i, returnShift);
    const net = i.assets?.length
      ? weightedAssetAverage(i.assets, (asset) => asset.growthEnabled ? asset.expectedReturnPct + returnShift - asset.feesPct - asset.taxDragPct : 0)
      : netReturn(i, gross);
    const acc = simulate({ ...scenarioBase, netReturnForYear: () => net });
    const atRet = valueAt(acc.series, i.retirementAge);
    const income = incomeEligibleRealAt(acc, i, i.retirementAge) * (i.withdrawalRatePct / 100);
    const draw = simulate({ ...scenarioBase, netReturnForYear: () => net, withdrawalReal: income });
    return {
      label,
      netReturnPct: +net.toFixed(2),
      series: draw.series,
      atRetirement: { nominal: atRet.nominal, real: atRet.real },
      sustainableIncomeReal: income,
      depletionAge: draw.depletionAge,
    };
  });

  const [low, mid, high] = scenarios;
  const retirementProjection = simulate({
    ...base(i),
    endAge: i.retirementAge,
    netReturnForYear: () => netReturn(i, i.expectedReturnPct),
  });
  const assetBalances = retirementProjection.assetBalancesByAge.find((point) => point.age === i.retirementAge)?.values;
  const debtBalances = retirementProjection.debtBalancesByAge.find((point) => point.age === i.retirementAge)?.values;
  const deflator = Math.pow(1 + monthlyRate(i.inflationPct), (i.retirementAge - i.currentAge) * 12);
  const currentNetWorth = i.currentSavings - (i.debts ?? []).reduce((sum, debt) => sum + debt.currentBalance, 0);
  const debtPayments = (i.debts ?? []).reduce((sum, debt) => sum + debt.monthlyPayment, 0);
  const monthlyCashflow = {
    householdIncome: i.monthlyHouseholdIncome,
    livingExpenses: i.monthlyLivingExpenses,
    debtPayments,
    investmentContributions: i.monthlyContribution,
    remaining: i.monthlyHouseholdIncome - i.monthlyLivingExpenses - debtPayments - i.monthlyContribution,
  };
  const assetBreakdown = i.assets?.map((asset, index) => {
    const retirementNominal = assetBalances?.[index] ?? asset.currentBalance;
    const linkedDebtBalance = (i.debts ?? []).reduce(
      (sum, debt) => sum + (debt.assetId === asset.id ? debt.currentBalance : 0),
      0,
    );
    const retirementLinkedDebt = (i.debts ?? []).reduce(
      (sum, debt, debtIndex) => sum + (debt.assetId === asset.id ? debtBalances?.[debtIndex] ?? debt.currentBalance : 0),
      0,
    );
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      provider: asset.provider,
      currentBalance: asset.currentBalance,
      monthlyContribution: asset.monthlyContribution,
      growthEnabled: asset.growthEnabled,
      incomeEligible: asset.incomeEligible,
      expectedReturnPct: asset.expectedReturnPct,
      retirementNominal,
      retirementReal: retirementNominal / deflator,
      linkedDebtBalance,
      currentEquity: asset.currentBalance - linkedDebtBalance,
      retirementEquity: retirementNominal - retirementLinkedDebt,
    };
  });
  const debtBreakdown = i.debts?.map((debt, index) => ({
    id: debt.id,
    name: debt.name,
    kind: debt.kind,
    assetId: debt.assetId,
    assetName: i.assets?.find((asset) => asset.id === debt.assetId)?.name,
    currentBalance: debt.currentBalance,
    annualInterestPct: debt.annualInterestPct,
    monthlyPayment: debt.monthlyPayment,
    retirementBalance: debtBalances?.[index] ?? debt.currentBalance,
  }));
  const milestones = [55, 60, 65, 70]
    .filter((a) => a > i.currentAge && a <= i.endAge)
    .map((age) => ({
      age,
      low: valueAt(low.series, age).real,
      base: valueAt(mid.series, age).real,
      high: valueAt(high.series, age).real,
    }));

  let goal: ProjectionResult["goal"];
  if (i.goal && (i.goal.targetAmount || i.goal.desiredAnnualIncome)) {
    const targetAge = i.goal.targetAge ?? i.retirementAge;
    const incomeOnly = i.goal.targetAmount == null && i.goal.desiredAnnualIncome != null;
    const targetReal =
      i.goal.targetAmount ??
      (i.goal.desiredAnnualIncome as number) / (i.withdrawalRatePct / 100);
    const accBase = simulate({
      ...base(i),
      endAge: Math.max(targetAge, i.currentAge + 1),
      netReturnForYear: () => mid.netReturnPct,
    });
    const projected = incomeOnly
      ? incomeEligibleRealAt(accBase, i, targetAge)
      : valueAt(accBase.series, targetAge).real;
    goal = {
      targetReal,
      targetAge,
      projectedRealBase: projected,
      gapReal: targetReal - projected,
      onTrack: projected >= targetReal,
      requiredMonthlyContribution: requiredMonthlyContribution(i, targetReal, targetAge, incomeOnly),
      probabilityOfSuccess: probabilityOfReaching(i, targetReal, targetAge, 2000, incomeOnly),
    };
  }

  return {
    inputs: i,
    currentNetWorth,
    monthlyCashflow,
    assumptions: [
      ...(i.assets?.length
        ? [`${i.assets.length} assets are projected separately using their own return, fee and growth assumptions.`]
        : [`Gross return ${i.expectedReturnPct}% a year, less fees ${i.feesPct}% and tax drag ${i.taxDragPct}%.`]),
      `Low/High scenarios use ${spread} percentage points below/above each growth-enabled asset's return.`,
      `Inflation ${i.inflationPct}% a year; "real" figures are in today's dollars.`,
      `Contributions of ${i.monthlyContribution}/month rising ${i.contributionGrowthPct}% a year until age ${i.retirementAge}.`,
      `Retirement income uses a ${i.withdrawalRatePct}% withdrawal rate, raised with inflation.`,
      `Chance of reaching the goal comes from 2,000 simulated markets with ${i.volatilityPct}% volatility.`,
      ...(i.assets?.length
        ? [`The goal simulation applies the same volatility assumption to each growth-enabled asset; asset correlations are not modeled.`]
        : []),
      ...(i.assets?.some((asset) => !asset.growthEnabled)
        ? [`Assets marked no-growth hold their nominal balance flat until contributions or withdrawals.`]
        : []),
      ...(i.debts?.length
        ? [`Net worth subtracts all listed debts. Debt balances accrue the entered interest monthly and reduce by the entered payment; debt payments are separate from investment contributions.`]
        : []),
    ],
    scenarios,
    milestones,
    goal,
    assetBreakdown,
    debtBreakdown,
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

/** Compact, rounded version of a projection for an LLM tool result. */
export function summariseProjection(p: ProjectionResult) {
  const r = (n: number) => Math.round(n);
  return {
    currentNetWorth: r(p.currentNetWorth),
    monthlyCashflow: {
      householdIncome: r(p.monthlyCashflow.householdIncome),
      livingExpenses: r(p.monthlyCashflow.livingExpenses),
      debtPayments: r(p.monthlyCashflow.debtPayments),
      investmentContributions: r(p.monthlyCashflow.investmentContributions),
      remaining: r(p.monthlyCashflow.remaining),
    },
    assumptions: p.assumptions,
    scenarios: p.scenarios.map((s) => ({
      label: s.label,
      netReturnPct: s.netReturnPct,
      atRetirementTodaysDollars: r(s.atRetirement.real),
      atRetirementFutureDollars: r(s.atRetirement.nominal),
      yearlyIncomeTodaysDollars: r(s.sustainableIncomeReal),
      moneyRunsOutAtAge: s.depletionAge,
    })),
    balancesAtAgeTodaysDollars: p.milestones.map((m) => ({ age: m.age, low: r(m.low), expected: r(m.base), high: r(m.high) })),
    assets: p.assetBreakdown?.map((asset) => ({
      name: asset.name,
      kind: asset.kind,
      currentBalance: r(asset.currentBalance),
      linkedDebtBalance: r(asset.linkedDebtBalance),
      currentEquity: r(asset.currentEquity),
      retirementNetValue: r(asset.retirementNominal),
      retirementEquity: r(asset.retirementEquity),
    })),
    debts: p.debtBreakdown?.map((debt) => ({
      name: debt.name,
      kind: debt.kind,
      linkedAsset: debt.assetName,
      currentBalance: r(debt.currentBalance),
      projectedBalance: r(debt.retirementBalance),
    })),
    goal: p.goal && {
      targetTodaysDollars: r(p.goal.targetReal),
      targetAge: p.goal.targetAge,
      expectedTodaysDollars: r(p.goal.projectedRealBase),
      shortfall: r(Math.max(0, p.goal.gapReal)),
      onTrack: p.goal.onTrack,
      monthlyContributionNeeded: p.goal.requiredMonthlyContribution,
      chanceOfReachingGoal: `${Math.round(p.goal.probabilityOfSuccess * 100)}%`,
    },
    disclaimer: p.disclaimer,
  };
}
