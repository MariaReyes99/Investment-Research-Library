import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareFunds, grossFromHistoric, nzEsctRate, nzGovContribution, optionFromProvider, type FundComparisonInput,
} from '../lib/finance/fund-comparison';
import { PROVIDERS } from '../data/retirement-providers';
import { COUNTRY_CODES } from '../lib/countries';

const base = (country: FundComparisonInput['country']): FundComparisonInput => ({
  country, startBalance: 50_000, salary: 70_000, salaryGrowthPct: 0, employeePct: 3.5, employerPct: 3.5,
  extraMonthly: 0, years: 10, inflationPct: 2, nzPir: 28, nzGovContribution: true, usAccount: 'traditional',
  options: [],
});

test('every country has providers with sources and sensible fees', () => {
  for (const c of COUNTRY_CODES) {
    assert.ok(PROVIDERS[c].length >= 5, `${c} has providers`);
    for (const f of PROVIDERS[c]) {
      assert.ok(f.sourceUrl.startsWith('https://'), `${f.id} source`);
      assert.match(f.asOf, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(f.investmentFeePct >= 0 && f.investmentFeePct < 3, `${f.id} fee`);
    }
  }
});

test('NZ rules: ESCT bands and government contribution cap', () => {
  assert.equal(nzEsctRate(18_000), 0.105);
  assert.equal(nzEsctRate(72_450), 0.30);
  assert.equal(nzGovContribution(2_450, 70_000), 260.72);
  assert.equal(nzGovContribution(400, 70_000), 100);
  assert.equal(nzGovContribution(5_000, 190_000), 0);
});

test('with no fees or tax, a fund grows like the plain compounding formula', () => {
  const input = { ...base('UK'), employeePct: 0, employerPct: 0, extraMonthly: 0 };
  input.options = [{ id: 'a', name: 'A', risk: 'growth', growthSharePct: 80, grossReturnPct: 6, investmentFeePct: 0, adminFeePct: 0, fixedFeePerYear: 0, platformFeePct: 0, platformFeeCapPerYear: 0, performanceFeePct: 0, contributionChargePct: 0 }];
  const r = compareFunds(input).funds[0];
  assert.ok(Math.abs(r.endBalance - 50_000 * Math.pow(1.06, 10)) < 1, String(r.endBalance));
  assert.equal(r.totalDrag, 0);
});

test('drag parts add up, and a cheaper fund ends higher', () => {
  const input = base('NZ');
  input.options = [
    optionFromProvider(PROVIDERS.NZ.find((f) => f.id === 'nz-simplicity-growth')!, 'NZ', 'long-term', 'a'),
    optionFromProvider(PROVIDERS.NZ.find((f) => f.id === 'nz-booster-growth')!, 'NZ', 'long-term', 'b'),
  ];
  const [a, b] = compareFunds(input).funds;
  assert.ok(a.endBalance > b.endBalance);
  const months = a.monthly;
  const tax = months.reduce((s, m) => s + m.tax, 0);
  const admin = months.reduce((s, m) => s + m.adminFees, 0);
  const other = months.reduce((s, m) => s + m.otherFees, 0);
  assert.ok(Math.abs(tax + admin + other - a.totalDrag) < 0.01);
  assert.equal(a.yearly.length, 10);
  assert.ok(a.howCalculated.some((l) => l.includes('PIE tax')));
});

test('NEST contribution charge comes off every contribution', () => {
  const input = { ...base('UK'), salary: 40_000, employeePct: 5, employerPct: 3 };
  input.options = [optionFromProvider(PROVIDERS.UK.find((f) => f.id === 'uk-nest')!, 'UK', 'long-term', 'n')];
  const r = compareFunds(input).funds[0];
  const paid = r.totals.employee + r.totals.employer;
  assert.ok(Math.abs(r.totals.contributionCharges - paid * 0.018) < 1);
});

test('historic after-tax NZ return is converted to a higher gross figure', () => {
  const f = PROVIDERS.NZ.find((x) => x.id === 'nz-simplicity-growth')!;
  const g = grossFromHistoric(f, 'NZ');
  assert.ok(g > f.historicReturnPct! + f.investmentFeePct);
});

test('the fund comparison sent to the chat is plain, limited text', async () => {
  const { fundComparisonContext } = await import('../lib/guardrails/advice');
  assert.equal(fundComparisonContext(undefined), '');
  assert.equal(fundComparisonContext(42), '');
  const note = fundComparisonContext('<script>x</script> fund A' + 'y'.repeat(5000));
  assert.ok(!note.includes('<script>'));
  assert.ok(note.length < 5000);
});

test('a plain-words request picks the country, number, type and ranking', async () => {
  const { parseFundQuery, pickTopFunds } = await import('../lib/finance/fundQuery');
  const q = parseFundQuery('I want to compare the top 3 funds service provider in NZ');
  assert.deepEqual([q.country, q.count, q.rank], ['NZ', 3, 'return']);
  assert.equal(parseFundQuery('cheapest four balanced super funds in Australia').country, 'AU');
  assert.equal(parseFundQuery('cheapest four balanced super funds in Australia').count, 4);
  assert.equal(parseFundQuery('cheapest four balanced super funds in Australia').risk, 'balanced');
  assert.equal(parseFundQuery('cheapest four balanced super funds in Australia').rank, 'fees');
  assert.equal(parseFundQuery('top 3 in the United Kingdom').country, 'UK');
  assert.equal(parseFundQuery('top 3 in the US').country, 'US');
  assert.equal(parseFundQuery('top 3 in USA').country, 'US');
  assert.equal(parseFundQuery('top 3 in the Philippines').country, 'PH');
  assert.equal(parseFundQuery('top 10 funds').capped, true);
  for (const c of ['NZ', 'AU', 'US', 'UK', 'PH'] as const) {
    const pick = pickTopFunds(c, { count: 3, risk: null, rank: 'return', capped: false });
    assert.equal(pick.funds.length, 3, c);
    assert.equal(new Set(pick.funds.map((f) => f.provider)).size, 3, `${c} one fund per provider`);
  }
});

test('quarterly figures add up to the yearly ones', () => {
  const input = base('AU');
  input.options = [optionFromProvider(PROVIDERS.AU[0], 'AU', 'long-term', 'a')];
  const f = compareFunds(input).funds[0];
  assert.equal(f.quarterly.length, 40);
  const q = f.quarterly.slice(0, 4).reduce((s, p) => s + p.netReturn, 0);
  assert.ok(Math.abs(q - f.yearly[0].netReturn) < 0.01);
  assert.equal(f.quarterly[3].balance, f.yearly[0].balance);
});

test('balance = contributions after tax + government + net growth − contribution charges', () => {
  for (const c of ['NZ', 'AU', 'UK'] as const) {
    const input = base(c);
    input.options = [optionFromProvider(PROVIDERS[c][0], c, 'long-term', 'a')];
    const f = compareFunds(input).funds[0];
    const last = f.monthly[f.monthly.length - 1];
    const net = f.monthly.reduce((s, m) => s + m.netReturn, 0);
    const expected = last.startingCapital + last.employeeNet + last.employerNet + last.government + net - f.totals.contributionCharges;
    assert.ok(Math.abs(expected - f.endBalance) < 1, `${c}: ${expected} vs ${f.endBalance}`);
    if (c === 'NZ') assert.ok(last.government > 0 && last.employerNet < last.employer);
  }
});
