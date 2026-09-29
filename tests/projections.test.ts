import { test } from "node:test";
import assert from "node:assert/strict";
import { projectWealth, summariseProjection } from "../lib/finance/projections";
import { comparePlatforms } from "../lib/finance/platform-comparison";

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

test("asset balances use their own growth assumptions", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 0,
    monthlyContribution: 999,
    expectedReturnPct: 5,
    inflationPct: 0,
    assets: [
      {
        id: "kiwisaver",
        name: "KiwiSaver",
        kind: "kiwisaver",
        provider: "Example provider",
        currentBalance: 100_000,
        monthlyContribution: 0,
        expectedReturnPct: 10,
        feesPct: 0,
        taxDragPct: 0,
        growthEnabled: true,
      },
      {
        id: "cash",
        name: "Non-growth asset",
        kind: "other",
        currentBalance: 100_000,
        monthlyContribution: 0,
        expectedReturnPct: 8,
        feesPct: 0,
        taxDragPct: 0,
        growthEnabled: false,
      },
    ],
  });

  assert.equal(p.inputs.currentSavings, 200_000);
  assert.equal(p.inputs.monthlyContribution, 0);
  assert.ok(p.scenarios[1].atRetirement.nominal > 210_000);
  assert.equal(p.assetBreakdown?.find((asset) => asset.id === "cash")?.retirementNominal, 100_000);
});

test("asset goal contribution is the total monthly contribution required", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 0,
    monthlyContribution: 0,
    expectedReturnPct: 0,
    inflationPct: 0,
    goal: { targetAmount: 24_000 },
    assets: [{
      id: "kiwisaver",
      name: "KiwiSaver",
      kind: "kiwisaver",
      currentBalance: 0,
      monthlyContribution: 1_000,
      expectedReturnPct: 0,
      feesPct: 0,
      taxDragPct: 0,
      growthEnabled: true,
    }],
  });

  assert.equal(p.goal?.requiredMonthlyContribution, 2_000);
});

test("net worth includes personal assets and subtracts amortizing debts", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 0,
    monthlyContribution: 0,
    expectedReturnPct: 0,
    inflationPct: 0,
    assets: [
      { id: "home", name: "Home", kind: "property", currentBalance: 500_000, expectedReturnPct: 0, growthEnabled: false, incomeEligible: false },
      { id: "car", name: "Car", kind: "vehicle", currentBalance: 20_000, expectedReturnPct: 0, growthEnabled: false, incomeEligible: false },
      { id: "jewelry", name: "Jewellery", kind: "jewelry", currentBalance: 10_000, expectedReturnPct: 0, growthEnabled: false, incomeEligible: false },
      { id: "business", name: "Business", kind: "business", currentBalance: 0, expectedReturnPct: 0, growthEnabled: false, incomeEligible: false },
    ],
    debts: [
      { id: "mortgage", name: "Mortgage", kind: "mortgage", currentBalance: 400_000, annualInterestPct: 0, monthlyPayment: 5_000 },
      { id: "vehicle-loan", name: "Vehicle loan", kind: "vehicle", currentBalance: 10_000, annualInterestPct: 0, monthlyPayment: 500 },
    ],
  });

  assert.equal(p.currentNetWorth, 120_000);
  assert.equal(p.scenarios[1].atRetirement.nominal, 186_000);
  assert.equal(p.debtBreakdown?.find((debt) => debt.id === "mortgage")?.retirementBalance, 340_000);
  assert.equal(p.scenarios[1].sustainableIncomeReal, 0);
});

test("linked mortgage is subtracted from property equity exactly once", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 768_000,
    monthlyContribution: 0,
    expectedReturnPct: 0,
    inflationPct: 0,
    assets: [{
      id: "home",
      name: "Home",
      kind: "property",
      currentBalance: 768_000,
      monthlyContribution: 0,
      expectedReturnPct: 0,
      growthEnabled: false,
      incomeEligible: false,
    }],
    debts: [{
      id: "mortgage",
      name: "Home mortgage",
      kind: "mortgage",
      assetId: "home",
      currentBalance: 500_000,
      annualInterestPct: 0,
      monthlyPayment: 1_000,
    }],
  });

  const home = p.assetBreakdown?.find((asset) => asset.id === "home");
  assert.equal(p.currentNetWorth, 268_000);
  assert.equal(home?.linkedDebtBalance, 500_000);
  assert.equal(home?.currentEquity, 268_000);
  assert.equal(home?.retirementEquity, 280_000);
  assert.equal(p.scenarios[1].atRetirement.nominal, 280_000);
});

test("income goals do not count a non-income asset as retirement capital", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 500_000,
    monthlyContribution: 0,
    expectedReturnPct: 0,
    inflationPct: 0,
    goal: { desiredAnnualIncome: 20_000 },
    assets: [{
      id: "home",
      name: "Owner-occupied home",
      kind: "property",
      currentBalance: 500_000,
      monthlyContribution: 0,
      expectedReturnPct: 0,
      growthEnabled: false,
      incomeEligible: false,
    }],
  });

  assert.equal(p.goal?.projectedRealBase, 0);
  assert.equal(p.goal?.onTrack, false);
  assert.equal(p.scenarios[1].sustainableIncomeReal, 0);
});

test("monthly cashflow offsets living expenses, debt payments and investing", () => {
  const p = projectWealth({
    currentAge: 40,
    retirementAge: 41,
    currentSavings: 10_000,
    monthlyContribution: 0,
    expectedReturnPct: 5,
    monthlyHouseholdIncome: 8_000,
    monthlyLivingExpenses: 3_000,
    assets: [{
      id: "fund", name: "Investment fund", kind: "shares", currentBalance: 10_000,
      monthlyContribution: 1_000, expectedReturnPct: 5, feesPct: 0, growthEnabled: true,
    }],
    debts: [{ id: "mortgage", name: "Mortgage", kind: "mortgage", currentBalance: 100_000, monthlyPayment: 2_000 }],
  });

  assert.deepEqual(p.monthlyCashflow, {
    householdIncome: 8_000,
    livingExpenses: 3_000,
    debtPayments: 2_000,
    investmentContributions: 1_000,
    remaining: 2_000,
  });
});

test("platform comparison shows cumulative fees and their effect on growth", () => {
  const result = comparePlatforms({
    initialBalance: 100_000,
    monthlyContribution: 1_000,
    years: 10,
    inflationPct: 0,
    options: [
      { id: "low", name: "Low fee", expectedReturnPct: 6, annualFeePct: 0.2 },
      { id: "high", name: "High fee", expectedReturnPct: 6, annualFeePct: 1.2, monthlyAccountFee: 5, transactionFee: 2 },
    ],
  });

  assert.ok(result.options[0].endingBalanceNominal > result.options[1].endingBalanceNominal);
  assert.ok(result.options[1].feesPaid > result.options[0].feesPaid);
  assert.ok(result.options[1].feeImpact > result.options[0].feeImpact);
  assert.equal(result.options[0].series.at(-1)?.year, 10);
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
