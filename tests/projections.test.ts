import { test } from "node:test";
import assert from "node:assert/strict";
import { projectWealth, summariseProjection } from "../lib/finance/projections";

// Closed-form future value with monthly compounding, contributions at start of month.
function fvClosedForm(pv: number, pmt: number, annualPct: number, years: number) {
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  const n = years * 12;
  return pv * Math.pow(1 + r, n) + pmt * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
}

test("nominal balance matches closed-form FV (doc example: 500k + 2k/mo, 7%, 20y)", () => {
  const p = projectWealth({
    currentAge: 45, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 2_000,
    expectedReturnPct: 7, feesPct: 0, inflationPct: 0, withdrawalRatePct: 4,
  });
  const base = p.scenarios[1];
  const expected = fvClosedForm(500_000, 2_000, 7, 20);
  assert.ok(Math.abs(base.atRetirement.nominal - expected) < 1, `${base.atRetirement.nominal} vs ${expected}`);
  console.log("  20y FV:", Math.round(base.atRetirement.nominal));
});

test("real value is deflated by inflation", () => {
  const p = projectWealth({ currentAge: 40, retirementAge: 50, currentSavings: 100_000, monthlyContribution: 0,
    expectedReturnPct: 5, feesPct: 0, inflationPct: 5 });
  assert.ok(Math.abs(p.scenarios[1].atRetirement.real - 100_000) < 1);
});

test("scenarios are ordered and fees reduce returns", () => {
  const p = projectWealth({ currentAge: 30, retirementAge: 65, currentSavings: 10_000, monthlyContribution: 500,
    expectedReturnPct: 7, feesPct: 1 });
  const [l, b, h] = p.scenarios.map((s) => s.atRetirement.real);
  assert.ok(l < b && b < h);
  assert.equal(p.scenarios[1].netReturnPct, 6);
});

test("required contribution actually hits the goal", () => {
  const p = projectWealth({ currentAge: 48, retirementAge: 65, currentSavings: 200_000, monthlyContribution: 500,
    expectedReturnPct: 7, goal: { targetAmount: 1_500_000 } });
  assert.ok(p.goal && !p.goal.onTrack);
  const req = p.goal!.requiredMonthlyContribution!;
  const again = projectWealth({ currentAge: 48, retirementAge: 65, currentSavings: 200_000, monthlyContribution: req,
    expectedReturnPct: 7, goal: { targetAmount: 1_500_000 } });
  assert.ok(again.goal!.onTrack);
  assert.ok(again.goal!.probabilityOfSuccess > 0.3 && again.goal!.probabilityOfSuccess < 0.8,
    `prob ${again.goal!.probabilityOfSuccess}`);
  console.log("  required/month:", req, "prob at that level:", again.goal!.probabilityOfSuccess);
});

test("income goal converts via withdrawal rate; milestones present", () => {
  const p = projectWealth({ currentAge: 48, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 1_500,
    expectedReturnPct: 7, goal: { desiredAnnualIncome: 60_000 } });
  assert.equal(p.goal!.targetReal, 1_500_000);
  assert.deepEqual(p.milestones.map((m) => m.age), [55, 60, 65, 70]);
});

test("low-return drawdown can deplete", () => {
  const p = projectWealth({ currentAge: 60, retirementAge: 61, endAge: 100, currentSavings: 100_000,
    monthlyContribution: 0, expectedReturnPct: 0, feesPct: 1, withdrawalRatePct: 10 });
  assert.ok(p.scenarios[0].depletionAge !== null);
});

test("rejects retirement before current age", () => {
  assert.throws(() => projectWealth({ currentAge: 60, retirementAge: 55, currentSavings: 0, monthlyContribution: 0, expectedReturnPct: 5 }));
});

test("summary for the model is compact and rounded", () => {
  const p = projectWealth({ currentAge: 48, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 1_500,
    expectedReturnPct: 7, goal: { desiredAnnualIncome: 60_000 } });
  const s = summariseProjection(p);
  const size = JSON.stringify(s).length;
  assert.ok(size < 2500, `summary is ${size} chars`);
  assert.ok(Number.isInteger(s.scenarios[1].atRetirementTodaysDollars));
});
