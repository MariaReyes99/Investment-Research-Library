/**
 * Portfolio analysis for a household projection.
 *
 * Reads the projection and produces plain-English strengths, weaknesses and
 * risks, plus "levers": changes the household could explore, each re-run
 * through the projection engine so its effect is measured, not guessed.
 *
 * This is education, not advice: levers show trade-offs, they are not
 * recommendations, and every lever carries its downside.
 */
import { projectHousehold, retirementCurrency, fxFor, type Currency, type Household, type HouseholdResult } from './household';
import { COUNTRIES } from '../countries';
import { moneyFor, profile } from '../countries';

export interface Finding { title: string; detail: string }

export interface Lever {
  title: string;
  change: string;
  tradeOff: string;
  /** Expected case, today's money. */
  liquidAtEnd: number;
  netWorthAtEnd: number;
  liquidDelta: number;
  netWorthDelta: number;
  runsOutAge: number | null;
}

export interface HouseholdAnalysis {
  metrics: {
    propertyShare: number;
    liquidShare: number;
    largestAsset: { name: string; share: number };
    debtRatio: number;
    cashMonths: number | null;
    weightedReturnPct: number | null;
    weightedFeesPct: number | null;
    feeCostAtRetirement: number;
    retirementGapYearly: number;
    retirementWithdrawalPct: number | null;
    extraInterestPerPointMonthly: number;
    salaries: number;
  };
  strengths: Finding[];
  weaknesses: Finding[];
  risks: Finding[];
  levers: Lever[];
  baseline: { liquidAtEnd: number; netWorthAtEnd: number; runsOutAge: number | null; endAge: number };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function measure(r: HouseholdResult) {
  const mid = r.scenarios[1];
  const end = mid.series[mid.series.length - 1];
  return { liquidAtEnd: end.liquid, netWorthAtEnd: end.netWorth, runsOutAge: mid.shortfallAge };
}

export function analyseHousehold(r: HouseholdResult): HouseholdAnalysis {
  const h = r.inputs;
  const nzd = moneyFor(h.country);
  const country = profile(h.country);
  const [low, mid] = r.scenarios;
  const mc = r.monteCarlo;
  const today = r.today;
  const assets = today.assets || 1;

  // Composition
  const holdings = ([
    { name: 'Cash', value: h.cashOnHand },
    ...h.investments.map((i) => ({ name: i.name, value: i.balance })),
    ...h.properties.map((p) => ({ name: p.name, value: p.value })),
    ...h.otherAssets.map((a) => ({ name: a.name, value: a.value })),
  ]).filter((x) => x.value > 0);
  const largest = holdings.reduce((a, b) => (b.value > a.value ? b : a), { name: '', value: 0 });
  const propertyValue = sum(h.properties.map((p) => p.value));
  const propertyShare = propertyValue / assets;
  const liquidShare = today.liquid / assets;
  const debtRatio = today.debts / assets;

  const invTotal = sum(h.investments.map((i) => i.balance));
  const weightedReturnPct = invTotal > 0 ? sum(h.investments.map((i) => i.balance * i.returnPct)) / invTotal : null;
  const weightedFeesPct = invTotal > 0 ? sum(h.investments.map((i) => i.balance * i.feesPct)) / invTotal : null;

  const monthlyOut = sum(today.outgoings.filter((l) => l.label !== 'Investing').map((l) => l.amount));
  const cashMonths = monthlyOut > 0 ? h.cashOnHand / monthlyOut : null;

  // First full year of retirement
  const retPoint = mid.series.find((p) => p.age === r.retirementAge + 1);
  const retirementGapYearly = retPoint ? Math.max(0, retPoint.spending + retPoint.loanPayments - retPoint.income) : 0;
  const liquidAtRet = r.milestones.find((m) => m.age === r.retirementAge)?.liquid ?? today.liquid;
  const retirementWithdrawalPct = liquidAtRet > 0 && retirementGapYearly > 0 ? (retirementGapYearly / liquidAtRet) * 100 : null;

  const mortgageTotal = sum(h.properties.map((p) => p.mortgageBalance));
  const extraInterestPerPointMonthly = mortgageTotal * 0.01 / 12;
  const salaries = h.incomes.filter((i) => i.kind === 'salary' && i.monthlyAmount > 0).length;

  const baseline = { ...measure(r), endAge: h.endAge };
  // Fee cost measured at retirement, before any drawdown can hide it
  const noFees = projectHousehold({ ...h, compare: undefined, investments: h.investments.map((i) => ({ ...i, feesPct: 0 })) }, { monteCarlo: false });
  const liquidAt = (x: HouseholdResult) => x.milestones.find((m) => m.age === x.retirementAge)?.liquid ?? x.today.liquid;
  const feeCostAtRetirement = Math.max(0, liquidAt(noFees) - liquidAt(r));

  const strengths: Finding[] = [];
  const weaknesses: Finding[] = [];
  const risks: Finding[] = [];

  // Cash flow
  if (today.monthlySurplus > 0) {
    strengths.push({ title: 'Positive monthly cash flow', detail: `About ${nzd(today.monthlySurplus)} a month is left after spending, loans and investing, and is reinvested.` });
  } else if (today.monthlySurplus < 0) {
    weaknesses.push({ title: 'Spending more than comes in', detail: `The household is ${nzd(-today.monthlySurplus)} a month short today, so savings are being drawn down before retirement.` });
  }

  // Longevity
  if (mid.shortfallAge === null && low.shortfallAge === null) {
    strengths.push({ title: 'Savings last in the low case too', detail: `Cash and investments cover spending to age ${h.endAge} even with returns 2 points lower.` });
  } else if (mid.shortfallAge === null) {
    risks.push({ title: 'Lower returns shorten how long savings last', detail: `In the expected case savings last to ${h.endAge}, but in the low case they run out at about ${low.shortfallAge}.` });
  } else {
    weaknesses.push({ title: 'Savings run out before the end of the plan', detail: `In the expected case, cash and investments run out at about age ${mid.shortfallAge}. After that, spending relies on income alone or on selling property.` });
  }

  // Monte Carlo
  const mcPct = Math.round(mc.successRate * 100);
  if (mc.successRate >= 0.85) {
    strengths.push({ title: 'Holds up in most simulated markets', detail: `Spending was covered to age ${h.endAge} in ${mcPct}% of ${mc.runs} simulated markets with ${mc.volatilityPct}% yearly swings in returns.` });
  } else {
    risks.push({
      title: 'Market swings could cut the plan short',
      detail: `Spending was covered to age ${h.endAge} in only ${mcPct}% of ${mc.runs} simulated markets${mc.medianShortfallAge ? `; when money ran out, it was typically around age ${mc.medianShortfallAge}` : ''}. Many planners aim for 80 to 90% or more.`,
    });
  }

  // Concentration
  if (propertyShare >= 0.6) {
    risks.push({
      title: 'Most wealth is in property',
      detail: `${pct(propertyShare)} of assets is property. Property can't be sold a little at a time, so it only pays for retirement through rent or a sale, and a housing downturn would hit most of your net worth at once.`,
    });
  } else if (h.properties.length && propertyShare < 0.6 && liquidShare >= 0.3) {
    strengths.push({ title: 'A mix of property and investments', detail: `Property is ${pct(propertyShare)} of assets and cash plus investments ${pct(liquidShare)}, so not everything depends on one market.` });
  }
  if (largest.value / assets >= 0.35 && holdings.length > 1) {
    risks.push({ title: `A lot rides on ${largest.name}`, detail: `${largest.name} is ${pct(largest.value / assets)} of everything you own.` });
  }
  if (liquidShare < 0.25 && assets > 0) {
    weaknesses.push({ title: 'Little that can be spent easily', detail: `Only ${pct(liquidShare)} of assets is cash or investments that can be withdrawn without selling property.` });
  }

  // Debt
  if (debtRatio === 0) {
    strengths.push({ title: 'No debt', detail: 'Nothing is owed, so interest rate rises don\'t affect the household.' });
  } else if (debtRatio < 0.3) {
    strengths.push({ title: 'Moderate borrowing', detail: `Debts are ${pct(debtRatio)} of assets.` });
  } else {
    weaknesses.push({ title: 'High borrowing', detail: `Debts are ${pct(debtRatio)} of assets, which magnifies both gains and falls in property values.` });
  }
  if (mortgageTotal > 0) {
    risks.push({ title: 'Interest rate risk', detail: `Each 1 percentage point rise in mortgage rates would add about ${nzd(extraInterestPerPointMonthly)} a month in interest across ${nzd(mortgageTotal)} of mortgages.` });
  }
  for (const p of h.properties) {
    if (p.mortgageBalance > 0 && p.monthlyRepayment < (p.mortgageBalance * p.mortgageRatePct) / 1200) {
      weaknesses.push({ title: `${p.name}: the loan is growing`, detail: `The repayment doesn't cover the interest, so the amount owed rises every month. Check the figures with your lender.` });
    }
    if (p.mortgageBalance > 0 && p.mortgageBalance / (p.value || 1) >= 0.8) {
      risks.push({ title: `${p.name}: little equity`, detail: `The loan is ${pct(p.mortgageBalance / (p.value || 1))} of the value, so a fall in price could leave it owing more than it's worth.` });
    }
  }

  // Cash buffer
  if (cashMonths !== null) {
    if (cashMonths >= 6) strengths.push({ title: 'Emergency buffer', detail: `Cash covers about ${Math.floor(cashMonths)} months of outgoings.` });
    else weaknesses.push({ title: 'Small cash buffer', detail: `Cash covers about ${cashMonths.toFixed(1)} months of outgoings. A buffer of 3 to 6 months is a common rule of thumb, so a job loss or repair doesn't force a sale at a bad time.` });
  }

  // Returns and fees
  if (weightedReturnPct !== null && weightedReturnPct > 8) {
    risks.push({ title: 'Optimistic return assumptions', detail: `Investments are assumed to return ${weightedReturnPct.toFixed(1)}% a year on average before fees. Higher expected returns come with bigger swings; check the low case, and try the comparison with lower returns.` });
  }
  if (weightedFeesPct !== null && weightedFeesPct >= 0.5) {
    weaknesses.push({ title: 'Fees add up', detail: `Average fees are ${weightedFeesPct.toFixed(2)}% a year. By age ${r.retirementAge} they cost about ${nzd(feeCostAtRetirement)} in today's money.` });
  } else if (weightedFeesPct !== null && invTotal > 0) {
    strengths.push({ title: 'Low fees', detail: `Average fees are ${weightedFeesPct.toFixed(2)}% a year (about ${nzd(feeCostAtRetirement)} by age ${r.retirementAge}).` });
  }

  // Retirement income
  if (retirementWithdrawalPct !== null) {
    const f = { title: 'How hard savings must work in retirement', detail: `In the first year of retirement, spending and loan repayments are about ${nzd(retirementGapYearly)} more than income, which is ${retirementWithdrawalPct.toFixed(1)}% of cash and investments at that point.` };
    if (retirementWithdrawalPct > 5) risks.push({ ...f, detail: `${f.detail} Withdrawal rates above 4 to 5% a year are generally considered hard to sustain for 30 years.` });
    else strengths.push(f);
  }
  const retiresSoon = r.retirementAge - h.you.currentAge;
  if (retiresSoon > 0 && retiresSoon <= 10 && (weightedReturnPct ?? 0) >= 7) {
    risks.push({ title: 'Sequence risk near retirement', detail: `Retirement is ${retiresSoon} years away. A market fall just before or after retiring does the most damage, because withdrawals then lock in losses.` });
  }
  if (salaries === 1 && h.partner) {
    risks.push({ title: 'One income', detail: 'The plan relies on one salary. Losing it would change the picture quickly.' });
  }
  if (!h.incomes.some((i) => i.kind === 'pension')) {
    weaknesses.push({ title: 'No pension included', detail: `If you will receive ${country.pension.name}, adding it usually changes the retirement picture a lot.` });
  }

  // Currency: how much is held abroad, and what a 20% exchange-rate move would do
  const fx = fxFor(h);
  const home = fx.home;
  const inHome = (value: number, cur?: Currency) => value * fx.at(cur, 0);
  const foreign = [
    ...h.investments.map((i) => ({ cur: i.currency, v: inHome(i.balance, i.currency) })),
    ...h.properties.map((p) => ({ cur: p.currency, v: inHome(p.value, p.currency) })),
    ...h.otherAssets.map((a) => ({ cur: a.currency, v: inHome(a.value, a.currency) })),
  ].filter((x) => x.cur && x.cur !== home);
  const foreignShare = sum(foreign.map((x) => x.v)) / assets;
  const retCur = retirementCurrency(h);
  if (foreignShare > 0) {
    const curs = [...new Set(foreign.map((x) => x.cur))].join(' and ');
    strengths.push({ title: 'Assets in more than one currency', detail: `${pct(foreignShare)} of assets are in ${curs}, which spreads currency risk.` });
  }
  if (retCur !== home) {
    const stressed = measure(projectHousehold({ ...h, compare: undefined }, { monteCarlo: false, fxScale: { [retCur]: 1.2 } }));
    const retShare = sum(foreign.filter((x) => x.cur === retCur).map((x) => x.v)) / assets;
    const effect = stressed.runsOutAge === baseline.runsOutAge
      ? `the plan's outcome to age ${h.endAge} would change by ${nzd(stressed.liquidAtEnd - baseline.liquidAtEnd)} in cash and investments`
      : stressed.runsOutAge === null ? 'savings would still last' : `savings would run out at about ${stressed.runsOutAge} instead of ${baseline.runsOutAge ?? `lasting to ${h.endAge}`}`;
    risks.push({
      title: 'Currency risk in retirement',
      detail: `Retirement costs are in ${retCur}, but only ${pct(retShare)} of assets are held in ${retCur}. If the ${retCur} rose 20% against the ${home}, ${effect}.`,
    });
  } else if (foreignShare >= 0.25) {
    risks.push({ title: 'Currency risk', detail: `${pct(foreignShare)} of assets are in other currencies, so exchange-rate moves change their value in ${home}.` });
  }
  const pensionCountries = [...new Set(h.incomes.filter((i) => i.kind === 'pension').map((i) => COUNTRIES[h.country].currency === (i.currency ?? home) ? h.country : Object.values(COUNTRIES).find((c) => c.currency === i.currency)?.code))];
  if (pensionCountries.length > 1) {
    strengths.push({ title: 'Pensions from more than one country', detail: `Pension income is expected from ${pensionCountries.map((c) => (c ? COUNTRIES[c].name : '')).join(' and ')}. Check each country's rules on paying pensions abroad and whether one reduces the other.` });
  }

  // Levers: each re-runs the whole projection with one change
  const levers: Lever[] = [];
  const tryLever = (title: string, change: string, tradeOff: string, next: Household) => {
    const m = measure(projectHousehold({ ...next, compare: undefined }, { monteCarlo: false }));
    levers.push({
      title, change, tradeOff, ...m,
      liquidDelta: m.liquidAtEnd - baseline.liquidAtEnd,
      netWorthDelta: m.netWorthAtEnd - baseline.netWorthAtEnd,
    });
  };

  if (h.you.retirementAge + 2 < h.endAge && h.you.retirementAge >= h.you.currentAge) {
    tryLever('Retire 2 years later', `Retire at ${h.you.retirementAge + 2}${h.partner ? ' (both of you, 2 years later)' : ''}`, 'Fewer years of retirement to enjoy.', {
      ...h,
      you: { ...h.you, retirementAge: h.you.retirementAge + 2 },
      partner: h.partner && { ...h.partner, retirementAge: h.partner.retirementAge + 2 },
    });
  }
  if (h.livingExpensesMonthly > 0) {
    const cut = Math.round(h.livingExpensesMonthly * 0.1);
    tryLever('Spend 10% less', `Living costs ${nzd(cut)} a month lower, now and in retirement`, 'A tighter budget every month.', {
      ...h,
      livingExpensesMonthly: h.livingExpensesMonthly - cut,
      retirementLivingExpensesMonthly: h.retirementLivingExpensesMonthly !== undefined ? h.retirementLivingExpensesMonthly * 0.9 : undefined,
    });
  }
  if (weightedFeesPct !== null && weightedFeesPct > 0.3) {
    tryLever('Lower fees', 'Every investment at no more than 0.25% a year', 'Switching funds can mean a different mix of investments, and selling may trigger costs.', {
      ...h,
      investments: h.investments.map((i) => ({ ...i, feesPct: Math.min(i.feesPct, 0.25) })),
    });
  }
  h.properties.forEach((p, k) => {
    const interest = (p.mortgageBalance * p.mortgageRatePct) / 1200;
    if (p.mortgageBalance > 0 && p.monthlyRepayment < interest * 1.1) {
      const newPay = Math.ceil((interest * 1.25) / 50) * 50;
      tryLever(`Repay ${p.name} faster`, `Repayment ${nzd(newPay)} a month instead of ${nzd(p.monthlyRepayment)}`, 'Less cash left over each month while working.', {
        ...h,
        properties: h.properties.map((q, j) => (j === k ? { ...q, monthlyRepayment: newPay } : q)),
      });
    }
  });
  const rentable = h.properties
    .map((p, k) => ({ p, k }))
    .filter(({ p, k }) => k > 0 && p.monthlyNetRent === 0 && p.value > 0)
    .sort((a, b) => b.p.value - a.p.value)[0];
  if (rentable) {
    const rent = Math.round((rentable.p.value * 0.03) / 12 / 50) * 50;
    tryLever(`Rent out ${rentable.p.name}`, `If it isn't your home: ${nzd(rent)} a month net rent (a 3% net yield)`, 'Tenancy costs, vacancies and tax on rent; check real rents for the area.', {
      ...h,
      properties: h.properties.map((q, j) => (j === rentable.k ? { ...q, monthlyNetRent: rent } : q)),
    });
  }
  if (cashMonths !== null && cashMonths > 12 && weightedReturnPct !== null && monthlyOut > 0) {
    const keep = monthlyOut * 6;
    const move = h.cashOnHand - keep;
    tryLever('Invest cash above a 6-month buffer', `Keep ${nzd(keep)} in cash; invest ${nzd(move)} at ${weightedReturnPct.toFixed(1)}%`, 'Invested money can fall in value; cash can\'t.', {
      ...h,
      cashOnHand: keep,
      investments: [...h.investments, { name: 'Invested cash', kind: 'shares', owner: 'you', balance: move, returnPct: weightedReturnPct, feesPct: weightedFeesPct ?? 0, monthlyContribution: 0, contributionsStopAtRetirement: true, taxTreatment: 'returns_after_tax', taxRatePct: 0 }],
    });
  }
  if (mid.shortfallAge !== null && h.withdrawal.strategy === 'needs') {
    tryLever('Flexible spending in retirement', 'Guardrails: cut spending 10% after bad years, raise it 10% after good ones', 'Retirement income goes up and down instead of staying steady.', {
      ...h,
      withdrawal: { strategy: 'guardrails', ratePct: h.withdrawal.ratePct },
    });
  }
  if (mid.shortfallAge !== null && h.properties.length > 0 && !h.events.some((e) => e.kind === 'sell_property')) {
    const candidates = h.properties.length > 1 ? h.properties.slice(1) : h.properties;
    const target = [...candidates].sort((a, b) => b.value - a.value)[0];
    const age = Math.min(Math.max(r.retirementAge, h.you.currentAge + 1), h.endAge - 1);
    tryLever(`Sell ${target.name} at ${age}`, `Sell it when you retire and invest the proceeds (after 3% selling costs and its mortgage)`, h.properties.length > 1 ? 'Loses any rent and future growth on that property; selling costs and tax may apply.' : 'You would need somewhere else to live; this is most relevant when downsizing.', {
      ...h,
      events: [...h.events, { name: `Sell ${target.name}`, kind: 'sell_property', atAge: age, amount: 0, propertyName: target.name, replacementValue: 0, sellingCostsPct: 3, sharePct: 100 }],
    });
  }

  return {
    metrics: {
      propertyShare, liquidShare,
      largestAsset: { name: largest.name, share: largest.value / assets },
      debtRatio, cashMonths, weightedReturnPct, weightedFeesPct, feeCostAtRetirement,
      retirementGapYearly, retirementWithdrawalPct, extraInterestPerPointMonthly, salaries,
    },
    strengths, weaknesses, risks, levers, baseline,
  };
}

/** Compact version for the chat model. */
export function summariseAnalysis(a: HouseholdAnalysis) {
  const n = (x: number) => Math.round(x);
  return {
    strengths: a.strengths.map((f) => f.title + ': ' + f.detail),
    weaknesses: a.weaknesses.map((f) => f.title + ': ' + f.detail),
    risks: a.risks.map((f) => f.title + ': ' + f.detail),
    leversToExplore: a.levers.map((l) => ({
      lever: l.title,
      change: l.change,
      tradeOff: l.tradeOff,
      cashAndInvestmentsAtEndChange: n(l.liquidDelta),
      netWorthAtEndChange: n(l.netWorthDelta),
      moneyRunsOutAtAge: l.runsOutAge,
    })),
    baselineMoneyRunsOutAtAge: a.baseline.runsOutAge,
  };
}
