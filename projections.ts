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

// ---------------------------------------------------------------------------
// Input schema (use this to validate API bodies and LLM tool arguments)
// ---------------------------------------------------------------------------
export const ProjectionInputSchema = z
  .object({
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
}

function simulate(o: SimOpts): { series: YearPoint[]; depletionAge: number | null } {
  let balance = o.startBalance;
  let contributed = o.startBalance;
  let contribution = o.monthlyContribution;
  let depletionAge: number | null = null;
  const inflM = monthlyRate(o.inflationPct);
  const series: YearPoint[] = [
    { age: o.currentAge, nominal: balance, real: balance, contributed },
  ];
  let month = 0;

  for (let age = o.currentAge; age < o.endAge; age++) {
    const yearIdx = age - o.currentAge;
    const r = monthlyRate(o.netReturnForYear(yearIdx));
    const retired = age >= o.retirementAge;

    for (let m = 0; m < 12; m++) {
      month++;
      if (!retired) {
        balance += contribution;
        contributed += contribution;
      } else if (o.withdrawalReal && balance > 0) {
        // withdraw the inflation-adjusted monthly amount
        balance -= (o.withdrawalReal / 12) * Math.pow(1 + inflM, month);
        if (balance <= 0) {
          balance = 0;
          depletionAge ??= age;
        }
      }
      balance *= 1 + r;
    }
    if (!retired) contribution *= 1 + o.contributionGrowthPct / 100;

    const deflator = Math.pow(1 + inflM, month);
    series.push({ age: age + 1, nominal: balance, real: balance / deflator, contributed });
  }
  return { series, depletionAge };
}

const netReturn = (i: Input, grossPct: number) => grossPct - i.feesPct - i.taxDragPct;

const valueAt = (series: YearPoint[], age: number) =>
  series.find((p) => p.age === age) ?? series[series.length - 1];

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
): number {
  const rand = mulberry32(42);
  const mu = netReturn(i, i.expectedReturnPct) / 100;
  const sigma = i.volatilityPct / 100;
  // Lognormal returns whose arithmetic mean equals mu.
  const logMu = Math.log(1 + mu) - (sigma * sigma) / 2;
  let hits = 0;
  for (let k = 0; k < runs; k++) {
    const yearly: number[] = [];
    const { series } = simulate({
      ...base(i),
      endAge: targetAge,
      netReturnForYear: (y) =>
        (yearly[y] ??= (Math.exp(logMu + sigma * normal(rand)) - 1) * 100),
    });
    if (valueAt(series, targetAge).real >= targetReal) hits++;
  }
  return hits / runs;
}

function base(i: Input) {
  return {
    currentAge: i.currentAge,
    endAge: i.endAge,
    retirementAge: i.retirementAge,
    startBalance: i.currentSavings,
    monthlyContribution: i.monthlyContribution,
    contributionGrowthPct: i.contributionGrowthPct,
    inflationPct: i.inflationPct,
  };
}

/** Monthly contribution needed to reach targetReal by targetAge (Base case). */
export function requiredMonthlyContribution(
  i: Input,
  targetReal: number,
  targetAge: number,
): number | null {
  const reached = (c: number) =>
    valueAt(
      simulate({
        ...base(i),
        monthlyContribution: c,
        endAge: targetAge,
        netReturnForYear: () => netReturn(i, i.expectedReturnPct),
      }).series,
      targetAge,
    ).real >= targetReal;

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
  const i = ProjectionInputSchema.parse(raw);
  const spread = 2; // +/- percentage points for Low/High scenarios

  const scenarios: ScenarioResult[] = (
    [
      ["Low", i.expectedReturnPct - spread],
      ["Base", i.expectedReturnPct],
      ["High", i.expectedReturnPct + spread],
    ] as const
  ).map(([label, gross]) => {
    const net = netReturn(i, gross);
    const acc = simulate({ ...base(i), netReturnForYear: () => net });
    const atRet = valueAt(acc.series, i.retirementAge);
    const income = atRet.real * (i.withdrawalRatePct / 100);
    const draw = simulate({ ...base(i), netReturnForYear: () => net, withdrawalReal: income });
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
    const targetReal =
      i.goal.targetAmount ??
      (i.goal.desiredAnnualIncome as number) / (i.withdrawalRatePct / 100);
    const accBase = simulate({
      ...base(i),
      endAge: Math.max(targetAge, i.currentAge + 1),
      netReturnForYear: () => mid.netReturnPct,
    });
    const projected = valueAt(accBase.series, targetAge).real;
    goal = {
      targetReal,
      targetAge,
      projectedRealBase: projected,
      gapReal: targetReal - projected,
      onTrack: projected >= targetReal,
      requiredMonthlyContribution: requiredMonthlyContribution(i, targetReal, targetAge),
      probabilityOfSuccess: probabilityOfReaching(i, targetReal, targetAge),
    };
  }

  return {
    inputs: i,
    assumptions: [
      `Gross return ${i.expectedReturnPct}% a year, less fees ${i.feesPct}% and tax drag ${i.taxDragPct}%.`,
      `Low/High scenarios use ${spread} percentage points below/above that return.`,
      `Inflation ${i.inflationPct}% a year; "real" figures are in today's dollars.`,
      `Contributions of ${i.monthlyContribution}/month rising ${i.contributionGrowthPct}% a year until age ${i.retirementAge}.`,
      `Retirement income uses a ${i.withdrawalRatePct}% withdrawal rate, raised with inflation.`,
      `Chance of reaching the goal comes from 2,000 simulated markets with ${i.volatilityPct}% volatility.`,
    ],
    scenarios,
    milestones,
    goal,
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

/** JSON schema for OpenAI tool calling (kept in sync with ProjectionInputSchema). */
export const projectWealthTool = {
  type: "function" as const,
  function: {
    name: "project_wealth",
    description:
      "Project future wealth from current savings, contributions, age and goals. Use for ANY numeric projection; never estimate numbers yourself.",
    parameters: {
      type: "object",
      properties: {
        currentAge: { type: "integer" },
        retirementAge: { type: "integer" },
        endAge: { type: "integer" },
        currentSavings: { type: "number" },
        monthlyContribution: { type: "number" },
        contributionGrowthPct: { type: "number" },
        expectedReturnPct: { type: "number" },
        feesPct: { type: "number" },
        taxDragPct: { type: "number" },
        inflationPct: { type: "number" },
        volatilityPct: { type: "number" },
        withdrawalRatePct: { type: "number" },
        goal: {
          type: "object",
          properties: {
            targetAmount: { type: "number" },
            desiredAnnualIncome: { type: "number" },
            targetAge: { type: "integer" },
          },
        },
      },
      required: [
        "currentAge",
        "retirementAge",
        "currentSavings",
        "monthlyContribution",
        "expectedReturnPct",
      ],
    },
  },
};
