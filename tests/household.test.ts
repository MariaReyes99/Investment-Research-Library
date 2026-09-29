import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectHousehold, summariseHousehold, type HouseholdInput } from '../lib/finance/household';
import { planFromHash, projectorLink } from '../lib/finance/householdLink';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// The example from the chat: one person, 59, retiring at 65, four investments, three properties.
const EXAMPLE: HouseholdInput = {
  you: { currentAge: 59, retirementAge: 65 },
  investments: [
    { name: 'Platform 1', balance: 509_000, returnPct: 9.5 },
    { name: 'Platform 2', balance: 40_000, returnPct: 9 },
    { name: 'KiwiSaver', kind: 'kiwisaver', balance: 90_000, returnPct: 10, monthlyContribution: 500 },
    { name: 'Platform 4', balance: 30_000, returnPct: 3 },
  ],
  properties: [
    { name: 'Property 1', value: 768_000, mortgageBalance: 400_000, monthlyRepayment: 3_500 },
    { name: 'Property 2', value: 695_000, mortgageBalance: 695_000, monthlyRepayment: 1_600 },
    { name: 'Property 3', value: 1_000_000 },
  ],
  otherAssets: [{ name: 'Car', kind: 'vehicle', value: 43_000 }, { name: 'Jewellery', kind: 'jewellery', value: 100_000 }],
  incomes: [{ name: 'Take-home pay', kind: 'salary', monthlyAmount: 14_400 }],
  livingExpensesMonthly: 6_000,
  goal: { targetNetWorth: 5_000_000 },
};

test('household: today uses property value minus mortgage, not the mortgage as the value', () => {
  const r = projectHousehold(EXAMPLE);
  near(r.today.assets, 669_000 + 768_000 + 695_000 + 1_000_000 + 43_000 + 100_000, 1);
  near(r.today.debts, 1_095_000, 1);
  near(r.today.netWorth, 2_180_000, 1);
  near(r.today.monthlySurplus, 14_400 - 6_000 - 5_100 - 500, 0.01);
});

test('household: warns when a mortgage repayment does not cover the interest', () => {
  const r = projectHousehold(EXAMPLE);
  assert.ok(r.warnings.some((w) => w.startsWith('Property 2')));
  assert.ok(!r.warnings.some((w) => w.startsWith('Property 1')));
});

test('household: properties are kept (never drawn down) and jewellery holds its value', () => {
  const r = projectHousehold({ ...EXAMPLE, inflationPct: 0 });
  const end = r.scenarios[1].series.at(-1)!;
  assert.ok(end.property > 2_463_000, 'property value should grow, not be spent');
  // Jewellery 100k at 0%, car falls 10% a year from 43k over 31 years
  near(end.otherAssets, 100_000 + 43_000 * Math.pow(0.9, 31), 50);
});

test('household: surplus is reinvested and shortfalls are drawn from savings', () => {
  const r = projectHousehold({
    you: { currentAge: 40, retirementAge: 41 },
    endAge: 43,
    inflationPct: 0,
    cashOnHand: 0,
    surplusReturnPct: 0,
    incomes: [{ name: 'Pay', kind: 'salary', monthlyAmount: 1_000 }],
    livingExpensesMonthly: 400,
  });
  const s = r.scenarios[1].series;
  near(s[1].liquid, 600 * 12, 0.01); // saved while working
  near(s[2].liquid, 600 * 12 - 400 * 12, 0.01); // spent after salary stops
  assert.equal(r.scenarios[1].shortfallAge, 42);
});

test('household: KiwiSaver cannot be drawn before 65', () => {
  const r = projectHousehold({
    you: { currentAge: 60, retirementAge: 60 },
    endAge: 66,
    inflationPct: 0,
    investments: [{ name: 'KiwiSaver', kind: 'kiwisaver', balance: 100_000, returnPct: 0 }],
    livingExpensesMonthly: 1_000,
  });
  const s = r.scenarios[1].series;
  near(s[4].investments, 100_000, 0.01); // untouched at 64
  assert.equal(r.scenarios[1].shortfallAge, 60);
  assert.ok(s[6].investments < 100_000); // drawn after 65
});

test('household: pension starts at 65 and dependants stop after their years', () => {
  const r = projectHousehold({
    you: { currentAge: 63, retirementAge: 63 },
    endAge: 67,
    inflationPct: 0,
    incomes: [{ name: 'NZ Super', kind: 'pension', monthlyAmount: 2_000 }],
    dependants: [{ name: 'Child', kind: 'child', monthlyCost: 500, years: 1 }],
  });
  const s = r.scenarios[1].series;
  near(s[1].income, 0, 0.01);
  near(s[1].spending, 6_000, 0.01);
  near(s[2].spending, 0, 0.01);
  near(s[3].income, 24_000, 0.01);
});

test('household: couples use each person\'s own retirement age for salary', () => {
  const r = projectHousehold({
    you: { currentAge: 60, retirementAge: 62 },
    partner: { currentAge: 55, retirementAge: 60 },
    endAge: 64,
    inflationPct: 0,
    incomes: [
      { name: 'Your pay', kind: 'salary', owner: 'you', monthlyAmount: 1_000 },
      { name: 'Partner pay', kind: 'salary', owner: 'partner', monthlyAmount: 1_000 },
    ],
  });
  const s = r.scenarios[1].series;
  near(s[2].income, 24_000, 0.01); // both working (you 61, partner 56)
  near(s[3].income, 12_000, 0.01); // you retired at 62, partner still working
  assert.equal(s[3].partnerAge, 58);
});

test('household: mortgage is paid off and repayments then become surplus', () => {
  const r = projectHousehold({
    you: { currentAge: 40, retirementAge: 70 },
    endAge: 45,
    inflationPct: 0,
    surplusReturnPct: 0,
    properties: [{ name: 'Home', value: 500_000, growthPct: 0, mortgageBalance: 12_000, mortgageRatePct: 0, monthlyRepayment: 1_000 }],
    incomes: [{ name: 'Pay', kind: 'salary', monthlyAmount: 1_000 }],
  });
  const s = r.scenarios[1].series;
  near(s[1].propertyDebt, 0, 0.01);
  near(s[1].loanPayments, 12_000, 0.01);
  near(s[2].liquid, 12_000, 0.01);
  near(s[2].netWorth, 512_000, 0.01);
});

test('household: comparison rows and goal are reported', () => {
  const r = projectHousehold({ ...EXAMPLE, compare: [{ label: 'Low return', investmentReturnPct: 3 }, { label: 'High return', investmentReturnPct: 9 }] });
  assert.equal(r.comparison?.length, 2);
  assert.ok(r.comparison![1].atRetirement > r.comparison![0].atRetirement);
  assert.equal(r.goal?.targetAge, 65);
  assert.equal(r.goal?.onTrack, false);
  const summary = summariseHousehold(r);
  assert.equal(summary.goal?.target, 5_000_000);
});

test('household: plan link round-trips through the URL fragment', () => {
  const link = projectorLink(EXAMPLE);
  assert.ok(link.startsWith('/calculator#plan='));
  const back = planFromHash(link.slice(link.indexOf('#')));
  assert.equal(back?.investments?.length, 4);
  assert.equal(planFromHash('#plan=not-valid'), null);
});

import { analyseHousehold } from '../lib/finance/householdAnalysis';

test('analysis: flags property concentration, a growing loan and measures levers', () => {
  const a = analyseHousehold(projectHousehold(EXAMPLE));
  assert.ok(a.risks.some((f) => f.title === 'Most wealth is in property'));
  assert.ok(a.weaknesses.some((f) => f.title.startsWith('Property 2')));
  assert.ok(a.strengths.some((f) => f.title === 'Positive monthly cash flow'));
  const later = a.levers.find((l) => l.title === 'Retire 2 years later');
  assert.ok(later && later.liquidDelta > 0, 'retiring later should leave more savings');
  assert.ok(a.levers.some((l) => l.title === 'Repay Property 2 faster'));
});

test('analysis: a debt-free household with a pension shows those strengths', () => {
  const a = analyseHousehold(projectHousehold({
    you: { currentAge: 66, retirementAge: 65 },
    cashOnHand: 40_000,
    investments: [{ name: 'Fund', balance: 600_000, returnPct: 6, feesPct: 0.2 }],
    incomes: [{ name: 'NZ Super', kind: 'pension', monthlyAmount: 2_000 }],
    livingExpensesMonthly: 3_500,
  }));
  assert.ok(a.strengths.some((f) => f.title === 'No debt'));
  assert.ok(a.strengths.some((f) => f.title === 'Low fees'));
  assert.ok(!a.weaknesses.some((f) => f.title === 'No pension included'));
});
