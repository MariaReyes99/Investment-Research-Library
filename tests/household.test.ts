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

import { householdFromSimple } from '../lib/finance/fromSimple';

test('events: an inheritance adds money and selling a property turns equity into savings', () => {
  const r = projectHousehold({
    you: { currentAge: 60, retirementAge: 70 },
    endAge: 63,
    inflationPct: 0,
    surplusReturnPct: 0,
    properties: [{ name: 'Rental', value: 500_000, growthPct: 0, mortgageBalance: 100_000, mortgageRatePct: 0, monthlyRepayment: 0 }],
    events: [
      { name: 'Inheritance', kind: 'money_in', atAge: 61, amount: 50_000 },
      { name: 'Sell rental', kind: 'sell_property', atAge: 62, propertyName: 'Rental', sellingCostsPct: 2 },
    ],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[1].liquid, 0, 0.01);
  near(s[2].liquid, 50_000, 0.01);
  near(s[3].liquid, 50_000 + 500_000 * 0.98 - 100_000, 0.01);
  near(s[3].property, 0, 0.01);
});

test('tax: withdrawals from a taxed-on-withdrawal account are grossed up', () => {
  const r = projectHousehold({
    country: 'US',
    you: { currentAge: 65, retirementAge: 65 },
    endAge: 66,
    inflationPct: 0,
    investments: [{ name: '401(k)', kind: 'retirement_account', balance: 100_000, returnPct: 0, taxTreatment: 'taxed_on_withdrawal', taxRatePct: 20 }],
    livingExpensesMonthly: 800,
  }, { monteCarlo: false });
  const end = r.scenarios[1].series[1];
  near(end.tax, 800 * 12 * 0.25, 0.5); // 9,600 net needs 12,000 gross at 20%
  near(end.investments, 100_000 - 12_000, 0.5);
});

test('tax: yearly tax reduces growth', () => {
  const r = projectHousehold({
    you: { currentAge: 40, retirementAge: 70 }, endAge: 41, inflationPct: 0,
    investments: [{ name: 'Fund', balance: 100_000, returnPct: 10, taxTreatment: 'taxed_yearly', taxRatePct: 30 }],
  }, { monteCarlo: false });
  near(r.scenarios[1].series[1].investments, 107_000, 1);
});

test('countries: US retirement accounts open at 59.5 and pensions start at 67', () => {
  const r = projectHousehold({
    country: 'US',
    you: { currentAge: 58, retirementAge: 58 },
    endAge: 68,
    inflationPct: 0,
    investments: [{ name: 'IRA', kind: 'retirement_account', balance: 50_000, returnPct: 0 }],
    incomes: [{ name: 'Social Security', kind: 'pension', monthlyAmount: 1_000 }],
    livingExpensesMonthly: 100,
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  assert.equal(r.scenarios[1].shortfallAge, 58); // nothing accessible before 59.5
  near(s[8].income, 0, 0.01); // age 65-66
  near(s[10].income, 12_000, 0.01); // age 67-68
});

test('withdrawal strategies: percent spends a share of savings; guardrails avoids running out', () => {
  const base: HouseholdInput = {
    you: { currentAge: 65, retirementAge: 65 }, endAge: 95, inflationPct: 0,
    investments: [{ name: 'Fund', balance: 500_000, returnPct: 3 }],
    livingExpensesMonthly: 3_000,
  };
  const needs = projectHousehold(base, { monteCarlo: false });
  const pct = projectHousehold({ ...base, withdrawal: { strategy: 'percent', ratePct: 4 } }, { monteCarlo: false });
  const guard = projectHousehold({ ...base, withdrawal: { strategy: 'guardrails' } }, { monteCarlo: false });
  assert.ok(needs.scenarios[1].shortfallAge !== null);
  near(pct.scenarios[1].series[1].spending, 20_000, 1);
  assert.equal(pct.scenarios[1].shortfallAge, null);
  assert.ok(guard.scenarios[1].shortfallAge === null || guard.scenarios[1].shortfallAge > needs.scenarios[1].shortfallAge!);
});

test('monte carlo: is repeatable and reports a success rate', () => {
  const a = projectHousehold(EXAMPLE).monteCarlo;
  const b = projectHousehold(EXAMPLE).monteCarlo;
  assert.equal(a.successRate, b.successRate);
  assert.ok(a.successRate >= 0 && a.successRate <= 1);
  assert.ok(a.byAge.length > 0);
});

test('simple projections convert to a household with contributions paid from outside income', () => {
  const h = householdFromSimple({ currentAge: 52, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 2_000, expectedReturnPct: 5, goal: { desiredAnnualIncome: 60_000 } });
  const r = projectHousehold(h, { monteCarlo: false });
  const s = r.scenarios[1].series;
  assert.ok(s[1].liquid > 500_000, 'contributions should add to savings, not be drawn from them');
  near(r.scenarios[1].series.find((p) => p.age === 66)!.spending, 60_000, 1);
});

test('simple projections always get strengths, weaknesses, risks and levers', () => {
  const a = analyseHousehold(projectHousehold(householdFromSimple(
    { currentAge: 52, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 2_000, expectedReturnPct: 5, feesPct: 0.5, goal: { desiredAnnualIncome: 60_000 } },
    'NZ',
  )));
  assert.ok(a.strengths.length + a.weaknesses.length > 0);
  assert.ok(a.risks.length > 0);
  assert.ok(a.levers.length > 0);
});

import { currencyCountryIn } from '../lib/countries';

test('currency in a question is detected so projections use the right country', () => {
  assert.equal(currencyCountryIn("I'm 52 with NZD 500,000 and add $2,000 a month"), 'NZ');
  assert.equal(currencyCountryIn('I have ₱2,000,000 in PERA'), 'PH');
  assert.equal(currencyCountryIn('£300k in my SIPP'), 'UK');
  assert.equal(currencyCountryIn('I have 500,000 saved'), null);
  assert.equal(currencyCountryIn('NZD 100k and USD 50k'), null);
});

test('currencies: foreign items are converted to the home currency', () => {
  const r = projectHousehold({
    country: 'NZ',
    you: { currentAge: 40, retirementAge: 70 }, endAge: 41, inflationPct: 0, surplusReturnPct: 0,
    fx: [{ currency: 'PHP', rate: 0.03 }],
    properties: [{ name: 'House in Cebu', value: 5_000_000, growthPct: 0, currency: 'PHP' }],
    incomes: [{ name: 'Pay', kind: 'salary', monthlyAmount: 5_000 }],
    dependants: [{ name: 'Parents', kind: 'parent', monthlyCost: 20_000, years: 10, currency: 'PHP' }],
  }, { monteCarlo: false });
  near(r.today.assets, 150_000, 0.01);
  near(r.today.monthlySurplus, 5_000 - 600, 0.01);
  near(r.scenarios[1].series[1].liquid, 4_400 * 12, 0.01);
});

test('currencies: a missing exchange rate is reported clearly', () => {
  assert.throws(
    () => projectHousehold({ you: { currentAge: 40, retirementAge: 65 }, investments: [{ name: 'PH fund', balance: 1, returnPct: 5, currency: 'PHP' }] }),
    /Add an exchange rate for PHP/,
  );
});

test('currencies: a falling foreign currency lowers its home value; retiring abroad uses that currency', () => {
  const r = projectHousehold({
    country: 'NZ', retireIn: 'PH',
    you: { currentAge: 64, retirementAge: 65 }, endAge: 67, inflationPct: 0, surplusReturnPct: 0,
    fx: [{ currency: 'PHP', rate: 0.03, yearlyChangePct: -10 }],
    cashOnHand: 100_000,
    otherAssets: [{ name: 'Land', value: 1_000_000, changePct: 0, currency: 'PHP' }],
    retirementLivingExpensesMonthly: 50_000,
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[1].otherAssets, 30_000 * 0.9, 0.01);
  near(s[2].spending, 50_000 * 12 * 0.03 * Math.pow(0.9, 1.5), 400); // roughly, PHP costs converted each month
});

test('currencies: pensions and accounts follow the country of their currency', () => {
  const r = projectHousehold({
    country: 'NZ',
    you: { currentAge: 58, retirementAge: 58 }, endAge: 62, inflationPct: 0,
    fx: [{ currency: 'PHP', rate: 0.03 }],
    incomes: [{ name: 'SSS pension', kind: 'pension', monthlyAmount: 10_000, currency: 'PHP' }],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[1].income, 0, 0.01); // 58-59
  near(s[3].income, 10_000 * 12 * 0.03, 0.01); // 60-61: SSS starts at 60, NZ Super would be 65
});

import { answersToPlan } from '../components/PlannerWizard';

test('guided answers become a full plan', () => {
  const plan = answersToPlan({
    who: 'couple', age: 45, partnerAge: 43, bank: 10_000,
    savings: [{ name: 'KiwiSaver', kind: 'retirement', amount: 80_000, monthly: 400, style: 'growth' }],
    homes: [{ name: 'Home', worth: 800_000, owe: 300_000, payment: 2_200, sellAge: 70 }],
    pay: 6_000, partnerPay: 4_000, pension: 1_800, spending: 5_000,
    family: [{ kind: 'child', monthly: 600, years: 8 }],
    goal: 1_500_000,
  }, 'NZ', null);
  assert.equal(plan.you.retirementAge, 65);
  assert.equal(plan.partner?.currentAge, 43);
  assert.equal(plan.investments?.[0].kind, 'kiwisaver');
  assert.equal(plan.investments?.[0].returnPct, 7);
  assert.equal(plan.incomes?.length, 3);
  assert.equal(plan.events?.[0].kind, 'sell_property');
  const r = projectHousehold(plan, { monteCarlo: false });
  assert.ok(r.today.netWorth > 0);
});

test('blank guided answers still give a valid plan', () => {
  const r = projectHousehold(answersToPlan({ who: 'me', age: 30, savings: [], homes: [], family: [] }, 'PH', null), { monteCarlo: false });
  assert.equal(r.inputs.country, 'PH');
  assert.equal(r.today.netWorth, 0);
});

test('cashing out part of an investment moves it into savings at the chosen age', () => {
  const r = projectHousehold({
    you: { currentAge: 50, retirementAge: 70 }, endAge: 53, inflationPct: 0, surplusReturnPct: 0,
    investments: [{ name: 'Overseas shares', balance: 100_000, returnPct: 0, currency: 'USD' }],
    fx: [{ currency: 'USD', rate: 1.6 }],
    events: [{ name: 'Cash out half', kind: 'sell_investment', atAge: 52, investmentName: 'Overseas shares', sharePct: 50 }],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[2].investments, 160_000, 0.01); // nothing sold yet (USD 100k at 1.6)
  near(s[3].investments, 160_000, 0.01); // half moved into savings, still counted as investments
  near(s[3].events, 80_000, 0.01);
});

test('cashing out a retirement account before its access age is skipped with a warning', () => {
  const r = projectHousehold({
    you: { currentAge: 50, retirementAge: 70 }, endAge: 53, inflationPct: 0,
    investments: [{ name: 'KiwiSaver', kind: 'kiwisaver', balance: 50_000, returnPct: 0 }],
    events: [{ name: 'Cash out KiwiSaver', kind: 'sell_investment', atAge: 52, investmentName: 'KiwiSaver' }],
  }, { monteCarlo: false });
  near(r.scenarios[1].series[3].events, 0, 0.01);
  assert.ok(r.warnings.some((w) => w.includes("can't be withdrawn until age 65")));
});

test('guided answers handle money in other countries, sales and cash-outs', () => {
  const plan = answersToPlan({
    who: 'me', age: 40, abroad: true,
    savings: [{ name: 'US shares', kind: 'investments', amount: 50_000, style: 'growth', currency: 'USD', cashOutAge: 60, cashOutPct: 50 }],
    homes: [{ name: 'Cebu house', worth: 5_000_000, currency: 'PHP', sellAge: 62 }],
    foreignPensions: [{ country: 'UK', monthly: 600, owner: 'you' }],
    family: [],
  }, 'NZ', 'PH', { USD: 1.7, PHP: 0.03, GBP: 2.2 });
  assert.equal(plan.investments?.[0].currency, 'USD');
  assert.equal(plan.properties?.[0].currency, 'PHP');
  assert.equal(plan.incomes?.[0].currency, 'GBP');
  assert.deepEqual(plan.fx?.map((f) => f.currency).sort(), ['GBP', 'PHP', 'USD']);
  assert.equal(plan.fx?.find((f) => f.currency === 'USD')?.rate, 1.7);
  assert.deepEqual(plan.events?.map((ev) => ev.kind).sort(), ['sell_investment', 'sell_property']);
  const r = projectHousehold(plan, { monteCarlo: false });
  near(r.today.assets, 50_000 * 1.7 + 5_000_000 * 0.03, 1);
});

test('property running costs are paid while owned and stop when sold', () => {
  const r = projectHousehold({
    you: { currentAge: 60, retirementAge: 70 }, endAge: 63, inflationPct: 0, surplusReturnPct: 0,
    incomes: [{ name: 'Pay', kind: 'salary', monthlyAmount: 1_000 }],
    properties: [{ name: 'Bach', value: 300_000, growthPct: 0, monthlyCosts: 400 }],
    events: [{ name: 'Sell Bach', kind: 'sell_property', atAge: 62, propertyName: 'Bach', sellingCostsPct: 0 }],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[1].spending, 4_800, 0.01);
  near(s[3].spending, 0, 0.01);
  assert.ok(r.today.outgoings.some((l) => l.label === 'Property costs' && l.amount === 400));
});

test('guided growth, fees, property costs, car, valuables, other costs and inflation reach the plan', () => {
  const plan = answersToPlan({
    who: 'me', age: 50,
    savings: [{ name: 'ETF', kind: 'investments', amount: 100_000, style: 'balanced', growthPct: 8, feesPct: 0.2 }],
    homes: [{ name: 'Home', worth: 700_000, growthPct: 4, yearlyCosts: 6_000 }],
    car: 30_000, carLossPct: 15, valuables: 20_000,
    family: [{ kind: 'child', monthly: 500, years: 4, startIn: 5 }],
    otherCosts: [{ name: 'Travel', monthly: 300 }],
    inflationPct: 3,
  }, 'NZ', null);
  assert.equal(plan.investments?.[0].returnPct, 8);
  assert.equal(plan.investments?.[0].feesPct, 0.2);
  assert.equal(plan.properties?.[0].growthPct, 4);
  assert.equal(plan.properties?.[0].monthlyCosts, 500);
  assert.deepEqual(plan.otherAssets?.map((x) => [x.name, x.changePct]), [['Car', -15], ['Valuables', 0]]);
  assert.equal(plan.dependants?.[0].startInYears, 5);
  assert.equal(plan.otherExpenses?.[0].monthlyAmount, 300);
  assert.equal(plan.inflationPct, 3);
  const r = projectHousehold(plan, { monteCarlo: false });
  assert.ok(r.today.outgoings.some((l) => l.label === 'Property costs'));
});

test('reverse mortgage: lump sum and monthly payments, compounding interest, repaid on sale', () => {
  const r = projectHousehold({
    you: { currentAge: 64, retirementAge: 64 }, endAge: 70, inflationPct: 0, surplusReturnPct: 0,
    properties: [{ name: 'Home', value: 1_000_000, growthPct: 0 }],
    events: [
      { name: 'Reverse mortgage on Home', kind: 'reverse_mortgage', atAge: 65, propertyName: 'Home', amount: 50_000, monthlyAmount: 1_000, loanRatePct: 0 },
      { name: 'Sell Home', kind: 'sell_property', atAge: 68, propertyName: 'Home', sellingCostsPct: 0 },
    ],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[2].propertyDebt, 50_000 + 12_000, 0.01); // after a year: lump sum plus 12 payments
  near(s[2].income, 12_000, 0.01);
  near(s[4].propertyDebt, 50_000 + 36_000, 0.01); // just before the sale at 68
  near(s[5].propertyDebt, 0, 0.01); // repaid from the sale
  near(s[5].liquid, 1_000_000, 0.01); // borrowed money kept + sale proceeds after repaying = the home's value
});

test('reverse mortgage interest compounds and the loan never exceeds the home value', () => {
  const r = projectHousehold({
    you: { currentAge: 65, retirementAge: 65 }, endAge: 90, inflationPct: 0,
    properties: [{ name: 'Home', value: 200_000, growthPct: 0 }],
    events: [{ name: 'RM', kind: 'reverse_mortgage', atAge: 66, propertyName: 'Home', amount: 100_000, loanRatePct: 10 }],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[2].propertyDebt, 110_000, 300); // a year of 10% interest
  assert.ok(s[s.length - 1].propertyDebt <= 200_000 + 0.01, 'capped at the home value');
  assert.ok(r.warnings.some((w) => w.includes('reaches the value of Home')));
});

import { mergeWithBase, planToAnswers } from '../components/PlannerWizard';

const DETAILED: HouseholdInput = {
  country: 'NZ',
  you: { currentAge: 55, retirementAge: 65 },
  cashOnHand: 20_000,
  investments: [{ name: 'IRA', kind: 'retirement_account', balance: 100_000, returnPct: 6, feesPct: 0.3, taxTreatment: 'taxed_on_withdrawal', taxRatePct: 25, currency: 'USD' }],
  properties: [{ name: 'Home', value: 900_000, mortgageBalance: 200_000, mortgageRatePct: 6.8, monthlyRepayment: 2_000, monthlyCosts: 400 }],
  debts: [{ name: 'Car loan', balance: 10_000, ratePct: 12, monthlyPayment: 300 }, { name: 'Card', balance: 2_000, ratePct: 20, monthlyPayment: 100 }],
  incomes: [{ name: 'Pay', kind: 'salary', monthlyAmount: 8_000 }, { name: 'Dividends', kind: 'dividends', monthlyAmount: 200 }],
  livingExpensesMonthly: 4_000,
  withdrawal: { strategy: 'guardrails', ratePct: 4 },
  fx: [{ currency: 'USD', rate: 1.7 }],
  events: [{ name: 'Reverse mortgage on Home', kind: 'reverse_mortgage', atAge: 72, propertyName: 'Home', amount: 50_000, monthlyAmount: 500, loanRatePct: 8.5 }],
};

test('All details plans become guided answers', () => {
  const a = planToAnswers(DETAILED);
  assert.equal(a.bank, 20_000);
  assert.equal(a.savings[0].kind, 'retirement');
  assert.equal(a.savings[0].currency, 'USD');
  assert.equal(a.homes[0].yearlyCosts, 4_800);
  assert.equal(a.homes[0].rmAge, 72);
  assert.equal(a.loanOwe, 12_000);
  assert.equal(a.otherIncome, 200);
  assert.equal(a.abroad, true);
});

test('editing one guided section keeps every hidden detail elsewhere', () => {
  const baseAnswers = planToAnswers(DETAILED);
  const edited = { ...baseAnswers, bank: 35_000 };
  const fresh = answersToPlan(edited, 'NZ', null, { USD: 1.7 });
  const merged = mergeWithBase(DETAILED, baseAnswers, edited, fresh);
  assert.equal(merged.cashOnHand, 35_000);
  assert.equal(merged.investments?.[0].taxTreatment, 'taxed_on_withdrawal');
  assert.equal(merged.properties?.[0].mortgageRatePct, 6.8);
  assert.equal(merged.debts?.length, 2);
  assert.equal(merged.incomes?.find((i) => i.kind === 'dividends')?.monthlyAmount, 200);
  assert.equal(merged.withdrawal?.strategy, 'guardrails');
  assert.equal(merged.events?.[0].loanRatePct, 8.5);
});

test('changing a home in the guided setup keeps its mortgage rate', () => {
  const baseAnswers = planToAnswers(DETAILED);
  const edited = { ...baseAnswers, homes: [{ ...baseAnswers.homes[0], worth: 950_000 }] };
  const merged = mergeWithBase(DETAILED, baseAnswers, edited, answersToPlan(edited, 'NZ', null, { USD: 1.7 }));
  assert.equal(merged.properties?.[0].value, 950_000);
  assert.equal(merged.properties?.[0].mortgageRatePct, 6.8);
  assert.ok(projectHousehold(merged, { monteCarlo: false }).today.netWorth > 0);
});

test('reverse mortgage debt is shown separately and the analysis flags its growth', () => {
  const r = projectHousehold({
    you: { currentAge: 65, retirementAge: 65 }, endAge: 85, inflationPct: 0,
    properties: [{ name: 'Home', value: 900_000, growthPct: 0 }],
    events: [{ name: 'RM', kind: 'reverse_mortgage', atAge: 66, propertyName: 'Home', amount: 100_000, loanRatePct: 9 }],
  }, { monteCarlo: false });
  const s = r.scenarios[1].series;
  near(s[s.length - 1].reverseMortgage, 100_000 * Math.pow(1.09, 19), 2_000); // 19 years of 9% compounding
  const a = analyseHousehold(r);
  assert.ok(a.risks.some((f) => f.title === 'Reverse mortgage debt grows'));
});
