'use client';
/**
 * Compare retirement funds (KiwiSaver, super, 401(k)/IRA, pensions, PERA/MP2)
 * for the visitor's country: pick providers from the list or add your own, and
 * see contributions, fees, tax and returns month by month or year by year.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { COUNTRIES, moneyFor, type CountryCode } from '../lib/countries';
import { useCountry } from './CountryPicker';
import { PROVIDERS, PROVIDERS_REVIEWED, type FundRisk, type ProviderFund } from '../data/retirement-providers';
import {
  COUNTRY_DEFAULTS, compareFunds, optionFromProvider, UK_QUALIFYING_LOWER, UK_QUALIFYING_UPPER,
  type CalcGroup, type FundOptionInput, type FundResult, type ReturnSource, type UsAccount,
} from '../lib/finance/fund-comparison';
import { setComparisonSummary } from '../lib/comparisonShare';
import { parseFundQuery, pickTopFunds } from '../lib/finance/fundQuery';

const COLORS = ['#087e8b', '#d45b43', '#b17b12', '#5b63b7'];
const CUSTOM = '__custom__';
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

type Draft = FundOptionInput & { choice: string };
type Gran = 'monthly' | 'quarterly' | 'yearly';

/** Each calculation note is tagged with the chart (and bar colour) it explains. */
const GROUP_ORDER: CalcGroup[] = ['Paid in', 'Return', 'Tax', 'Admin fees', 'Other fees', 'Withdrawal'];
const GROUP_LABEL: Record<CalcGroup, string> = {
  'Paid in': 'Paid in', Return: 'Return', Tax: 'Drag: tax', 'Admin fees': 'Drag: admin', 'Other fees': 'Drag: other', Withdrawal: 'Later',
};
const GROUP_COLOR: Record<CalcGroup, string> = {
  'Paid in': '#8b85c9', Return: '#087e8b', Tax: '#d45b43', 'Admin fees': '#b17b12', 'Other fees': '#5b63b7', Withdrawal: '#637275',
};

const UNIT: Record<Gran, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const seriesOf = (f: FundResult, g: Gran) => (g === 'monthly' ? f.monthly : g === 'quarterly' ? f.quarterly : f.yearly);
/** Axis ticks at each year end, so long monthly and quarterly series stay readable. */
function axisFor(g: Gran, n: number) {
  const per = g === 'monthly' ? 12 : g === 'quarterly' ? 4 : 1;
  const step = per * Math.max(1, Math.ceil(n / per / 15));
  const ticks: number[] = [];
  for (let p = step; p <= n; p += step) ticks.push(p);
  return {
    ticks,
    interval: 0 as const,
    tickFormatter: (p: number) => (per === 1 ? `${p}` : `Y${p / per}`),
  };
}
const periodLabel = (g: Gran) => (p: unknown) => {
  const n = Number(p);
  if (g === 'monthly') return `Year ${Math.ceil(n / 12)}, month ${((n - 1) % 12) + 1}`;
  if (g === 'quarterly') return `Year ${Math.ceil(n / 4)}, Q${((n - 1) % 4) + 1}`;
  return `Year ${n}`;
};

const QUERY_EXAMPLES = [
  'Compare the top 3 KiwiSaver providers in NZ',
  'Top 3 balanced super funds in Australia',
  'Cheapest 3 pensions in the UK',
  'Top 3 growth funds in the US',
  'Top 3 PERA funds in the Philippines',
];

function NumberField({ id, label, value, step, unit, onChange, min = 0 }: {
  id: string; label: string; value: number; step: number; unit?: string; onChange: (v: number) => void; min?: number;
}) {
  return (
    <label className="comparison-field" htmlFor={id}>
      <span>{label}</span>
      <span className="comparison-input-wrap">
        <input id={id} type="number" inputMode="decimal" min={min} step={step} value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

/** Starts with three funds of the same risk from different providers, so the comparison is like for like. */
function startOptions(country: CountryCode, source: ReturnSource): Draft[] {
  const list = PROVIDERS[country];
  const picked: ProviderFund[] = [list[0]];
  for (const sameRisk of [true, false]) {
    for (const f of list) {
      if (picked.length === 3) break;
      if (picked.some((p) => p.provider === f.provider || p.id === f.id)) continue;
      if (sameRisk && f.risk !== list[0].risk) continue;
      picked.push(f);
    }
  }
  return toDrafts(picked, country, source);
}

function toDrafts(funds: ProviderFund[], country: CountryCode, source: ReturnSource): Draft[] {
  return funds.map((f, i) => ({ ...optionFromProvider(f, country, source, `fund-${i + 1}`), choice: f.id }));
}

/** What to weigh before staying or moving, by country. */
const CHECKLIST: Record<CountryCode, string[]> = {
  NZ: [
    'Switching KiwiSaver providers is free and usually takes 1–2 weeks; your money is out of the market for a few days during the move.',
    'Compare like with like: a growth fund against other growth funds. Choosing the right risk level for your time to 65 usually matters more than the provider.',
    'Check your PIR with IRD each year: being on 28% when you should be on 17.5% or 10.5% costs money you only get back by filing.',
    'Contribute at least 3.5% (from April 2026) so you get the full employer contribution, and enough over the year ($1,042.86) for the full government contribution.',
    'If you plan to use KiwiSaver for a first home, check the provider\'s withdrawal process and timing.',
  ],
  AU: [
    'Before rolling over, check what insurance (life, TPD, income protection) you would lose in your current fund, and whether the new fund will cover you.',
    'Use the ATO\'s YourSuper comparison tool: it shows MySuper fees and returns, and whether a product has failed the APRA performance test.',
    'Consolidate duplicate accounts so you are not paying two lots of fixed admin fees (you can do it in myGov).',
    'Tell your employer your new fund\'s details (a choice of fund form), or contributions will keep going to the old one. Once chosen, your fund follows you to new jobs ("stapling").',
  ],
  US: [
    'You usually cannot move a current employer\'s 401(k); you can change the funds inside it. Old 401(k)s can be rolled into an IRA or your new plan: use a direct rollover so no tax is withheld.',
    'Always contribute enough to get the full employer match: it is an instant return no fund can beat.',
    'Check your plan\'s 404(a)(5) fee notice for record-keeping fees, and compare its fund expense ratios with low-cost index options.',
    'Employer contributions may need vesting years before they are yours: check before leaving a job.',
    'Traditional or Roth: Roth suits people who expect a higher tax rate in retirement. The model above shows tax at withdrawal for traditional accounts.',
  ],
  UK: [
    'Before transferring an old pension, check for exit fees, valuable guarantees (guaranteed annuity rates, protected tax-free cash) and loyalty bonuses you would lose.',
    'Transfers out of defined benefit (final salary) schemes worth over £30,000 require regulated financial advice by law.',
    'Keep contributing to your current workplace pension to get the employer contribution; you can transfer old pots without leaving it.',
    'Check the transfer is between FCA-regulated schemes, and beware of pension scams promising high returns or early access before 55 (57 from 2028).',
  ],
  PH: [
    'You can transfer between PERA products or administrators without losing the tax benefits, as long as the money goes directly from one PERA to another.',
    'Withdrawing from PERA before 55, or before 5 years of contributions, means paying back the tax benefits and penalties.',
    'Compare trust or management fees on each fund\'s Key Information and Investment Disclosure Statement (KIIDS).',
    'Pag-IBIG MP2 has no fees and tax-free dividends but locks money for 5 years; PERA equity funds can grow more over decades but go up and down.',
    'Keep SSS contributions going: the SSS pension is a separate base most retirees rely on.',
  ],
};

function FundPanel({ fund, color, granularity, money, cur }: { fund: FundResult; color: string; granularity: Gran; money: (n: number) => string; cur: string }) {
  const data = useMemo(() => {
    let net = 0, drag = 0, growth = 0, tax = 0, admin = 0, other = 0, prevGov = 0;
    return seriesOf(fund, granularity).map((p) => {
      net += p.netReturn; growth += p.growth; tax += p.tax; admin += p.adminFees; other += p.otherFees;
      drag = tax + admin + other;
      const gov = p.government - prevGov;
      prevGov = p.government;
      return {
        ...p, gov, cumNet: net + p.government, cumInvestNet: net, cumDrag: drag, cumGrowth: growth, cumTax: tax, cumAdmin: admin, cumOther: other,
        netPaidIn: p.startingCapital + p.employeeNet + p.employerNet + p.government,
      };
    });
  }, [fund, granularity]);
  const last = data[data.length - 1];
  const unit = UNIT[granularity];
  const axis = axisFor(granularity, data.length);
  const label = periodLabel(granularity);
  const t = fund.totals;
  const hasGov = t.government > 0;
  return (
    <details className="fund-panel" style={{ '--option-color': color } as CSSProperties} open>
      <summary><span className="comparison-swatch" />{fund.name}</summary>

      <div className="fund-charts">
        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h3>1. Projected total net growth</h3><span>after tax and fees{hasGov ? ', plus government contribution' : ''}: {cur} per {unit} (bars), running total (line)</span></div>
          <div className="fund-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="p" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="c" orientation="right" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="p" stackId="net" dataKey="netReturn" name={`Investment growth after tax and fees`} fill={color} fillOpacity={0.55} isAnimationActive={false} />
                {hasGov && <Bar yAxisId="p" stackId="net" dataKey="gov" name="Government contribution" fill="#8b85c9" isAnimationActive={false} />}
                <Line yAxisId="c" type="monotone" dataKey="cumNet" name="Total net growth so far" stroke={color} strokeWidth={2.4} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Total net growth: <strong>{money(last.cumNet)}</strong>{hasGov && <> (investments {money(last.cumInvestNet)} + government {money(last.government)})</>}</p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h3>2. Projected total drag</h3><span>tax and fees: {cur} per {unit} (bars), running total (line)</span></div>
          <div className="fund-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="p" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="c" orientation="right" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="p" stackId="drag" dataKey="tax" name="Tax" fill="#d45b43" isAnimationActive={false} />
                <Bar yAxisId="p" stackId="drag" dataKey="adminFees" name="Admin fees" fill="#b17b12" isAnimationActive={false} />
                <Bar yAxisId="p" stackId="drag" dataKey="otherFees" name="Other fees" fill="#5b63b7" isAnimationActive={false} />
                <Line yAxisId="c" type="monotone" dataKey="cumDrag" name="Total drag so far" stroke="#26322c" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Total drag: <strong>{money(last.cumDrag)}</strong> (tax {money(last.cumTax)}, admin {money(last.cumAdmin)}, other {money(last.cumOther)})</p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h3>3. Projected total return</h3><span>before tax and fees: {cur} per {unit} (bars), running total (line)</span></div>
          <div className="fund-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="p" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="c" orientation="right" tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="p" dataKey="growth" name={`Return per ${unit}`} fill="#7fbfb6" isAnimationActive={false} />
                <Line yAxisId="c" type="monotone" dataKey="cumGrowth" name="Total return so far" stroke="#087e8b" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Total return before tax and fees: <strong>{money(last.cumGrowth)}</strong>. You keep {money(last.cumInvestNet)} of it after tax and fees.</p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h3>4. Projected total net contributions</h3><span>{cur} paid in so far, after contribution tax (stacked), and the balance</span></div>
          <div className="fund-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis tickFormatter={compact} width={46} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" stackId="in" dataKey="startingCapital" name="Starting balance" fill="#c9d6d3" stroke="#9fb3ae" isAnimationActive={false} />
                <Area type="monotone" stackId="in" dataKey="employeeNet" name="Your contributions" fill="#9ccfc9" stroke="#5aa69c" isAnimationActive={false} />
                <Area type="monotone" stackId="in" dataKey="employerNet" name={t.contributionTax > 0 ? 'Employer (after tax)' : 'Employer contributions'} fill="#f0c58f" stroke="#c9934c" isAnimationActive={false} />
                {hasGov && <Area type="monotone" stackId="in" dataKey="government" name="Government contribution" fill="#c7c3ef" stroke="#8b85c9" isAnimationActive={false} />}
                <Line type="monotone" dataKey="balance" name="Balance" stroke={color} strokeWidth={2.4} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Net contributions: <strong>{money(last.netPaidIn)}</strong> (start {money(last.startingCapital)} + you {money(last.employeeNet)} + employer {money(last.employerNet)}{hasGov ? ` + government ${money(last.government)}` : ''}){t.contributionTax > 0 && <>; {money(t.contributionTax)} contribution tax already taken off</>}. Balance {money(last.balance)} = net contributions + net investment growth{t.contributionCharges > 0 ? ' − contribution charges' : ''}.</p>
        </div>
      </div>

      <div className="fund-summary">
        <h4>How each number was calculated</h4>
        <table className="fc-notes">
          <thead><tr><th scope="col">Chart</th><th scope="col">Item</th><th scope="col">How</th><th scope="col">Total</th></tr></thead>
          <tbody>
            {[...fund.notes].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)).map((x) => (
              <tr key={x.group + x.item}>
                <td><span className="fc-tag" style={{ '--tag': GROUP_COLOR[x.group] } as CSSProperties}>{GROUP_LABEL[x.group]}</span></td>
                <th scope="row">{x.item}</th>
                <td>{x.how}</td>
                <td>{x.total !== undefined ? money(x.total) : '—'}</td>
              </tr>
            ))}
            {fund.withdrawalTaxNote && (
              <tr><td><span className="fc-tag" style={{ '--tag': GROUP_COLOR.Withdrawal } as CSSProperties}>{GROUP_LABEL.Withdrawal}</span></td><th scope="row">Tax on withdrawal</th><td>{fund.withdrawalTaxNote}</td><td>—</td></tr>
            )}
          </tbody>
        </table>
        <p className="fund-totals">
          <strong>Bottom line:</strong> tax {money(t.contributionTax + t.earningsTax)} + admin fees {money(t.adminPctFees + t.fixedFees + t.platformFees)} +
          other fees {money(t.investmentFees + t.performanceFees + t.contributionCharges)}. With the growth that money would have earned, the drag costs {money(fund.dragImpact)} off the final balance.
        </p>
      </div>
    </details>
  );
}

export default function FundComparison({ initialQuery }: { initialQuery?: { text: string; n: number } } = {}) {
  const [country, setCountry] = useCountry();
  const money = moneyFor(country);
  const cur = COUNTRIES[country].currency;
  const d = COUNTRY_DEFAULTS[country];
  const [startBalance, setStartBalance] = useState(50_000);
  const [salary, setSalary] = useState(d.salary);
  const [salaryGrowthPct, setSalaryGrowthPct] = useState(2.5);
  const [employeePct, setEmployeePct] = useState(d.employeePct);
  const [employerPct, setEmployerPct] = useState(d.employerPct);
  const [extraMonthly, setExtraMonthly] = useState(0);
  const [years, setYears] = useState(25);
  const [inflationPct, setInflationPct] = useState(COUNTRIES[country].inflationPct);
  const [nzPir, setNzPir] = useState(28);
  const [nzGov, setNzGov] = useState(true);
  const [usAccount, setUsAccount] = useState<UsAccount>('traditional');
  const [returnSource, setReturnSource] = useState<ReturnSource>('historic');
  const [granularity, setGranularity] = useState<Gran>('yearly');
  const [options, setOptions] = useState<Draft[]>(() => startOptions(country, 'historic'));
  const [query, setQuery] = useState('');
  const [queryNote, setQueryNote] = useState('');
  const [ranked, setRanked] = useState(false);
  // Funds picked by a query for another country, applied once the country has switched
  const pending = useRef<{ country: CountryCode; funds: ProviderFund[] } | null>(null);

  // New country: new providers and contribution defaults
  useEffect(() => {
    const def = COUNTRY_DEFAULTS[country];
    setSalary(def.salary); setEmployeePct(def.employeePct); setEmployerPct(def.employerPct);
    setInflationPct(COUNTRIES[country].inflationPct);
    const p = pending.current;
    if (p && p.country === country) {
      setOptions(toDrafts(p.funds, country, returnSource));
      pending.current = null;
    } else {
      setOptions(startOptions(country, returnSource));
      setRanked(false); setQueryNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const runQuery = (text: string) => {
    const q = parseFundQuery(text);
    const target = q.country ?? country;
    const pick = pickTopFunds(target, q);
    const where = `${COUNTRIES[target].name} (${COUNTRY_DEFAULTS[target].label})`;
    setQueryNote(`${where}: ${pick.explanation}${q.country ? '' : ` No country named, so I used ${COUNTRIES[target].name}.`}`);
    setRanked(true);
    if (target !== country) {
      pending.current = { country: target, funds: pick.funds };
      setCountry(target);
    } else {
      setOptions(toDrafts(pick.funds, target, returnSource));
    }
  };
  // A query typed above the comparison (before it opened) runs here
  useEffect(() => {
    if (initialQuery?.text) runQuery(initialQuery.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery?.n]);

  const providers = PROVIDERS[country];
  const byProvider = useMemo(() => {
    const groups = new Map<string, ProviderFund[]>();
    for (const f of providers) groups.set(f.provider, [...(groups.get(f.provider) ?? []), f]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [providers]);

  const update = (id: string, patch: Partial<Draft>) => setOptions((cur) => cur.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const choose = (id: string, choice: string) => {
    if (choice === CUSTOM) {
      update(id, { choice, providerId: undefined, name: '' });
      return;
    }
    const f = providers.find((x) => x.id === choice);
    if (f) setOptions((cur) => cur.map((o) => (o.id === id ? { ...optionFromProvider(f, country, returnSource, id), choice } : o)));
  };
  const switchSource = (s: ReturnSource) => {
    setReturnSource(s);
    setOptions((cur) => cur.map((o) => {
      const f = providers.find((x) => x.id === o.choice);
      return f ? { ...o, grossReturnPct: optionFromProvider(f, country, s, o.id).grossReturnPct } : o;
    }));
  };
  const addOption = () => setOptions((cur) => {
    if (cur.length >= 4) return cur;
    const next = providers.find((f) => !cur.some((o) => o.choice === f.id)) ?? providers[0];
    const id = `fund-${Date.now()}`;
    return [...cur, { ...optionFromProvider(next, country, returnSource, id), choice: next.id }];
  });

  const result = useMemo(() => {
    const nums = [startBalance, salary, salaryGrowthPct, employeePct, employerPct, extraMonthly, years, inflationPct,
      ...options.flatMap((o) => [o.grossReturnPct, o.investmentFeePct, o.adminFeePct, o.fixedFeePerYear, o.platformFeePct, o.performanceFeePct, o.contributionChargePct, o.growthSharePct])];
    if (!nums.every(Number.isFinite) || years < 1 || years > 60) return null;
    return compareFunds({
      country, startBalance, salary, salaryGrowthPct, employeePct, employerPct, extraMonthly, years, inflationPct,
      nzPir, nzGovContribution: nzGov, usAccount,
      options: options.map((o, i) => ({ ...o, name: o.name.trim() || `Fund ${String.fromCharCode(65 + i)}` })),
    }, money);
  }, [country, startBalance, salary, salaryGrowthPct, employeePct, employerPct, extraMonthly, years, inflationPct, nzPir, nzGov, usAccount, options, money]);

  // Share a short summary with the library chat on this page
  useEffect(() => {
    if (!result) { setComparisonSummary(''); return; }
    const i = result.inputs;
    const lines = [
      `${COUNTRIES[country].name} ${d.label} comparison over ${i.years} years: start ${money(i.startBalance)}, salary ${money(i.salary)} (+${i.salaryGrowthPct}%/yr), employee ${i.employeePct}%, employer ${i.employerPct}%${country === 'NZ' ? `, PIR ${i.nzPir}%` : ''}${country === 'US' ? `, ${i.usAccount} account` : ''}.`,
      ...result.funds.map((f, k) => {
        const o = options[k];
        return `- ${f.name}: gross return ${o.grossReturnPct}%, fund fee ${o.investmentFeePct}%${o.adminFeePct ? `, admin ${o.adminFeePct}%` : ''}${o.fixedFeePerYear ? `, fixed ${money(o.fixedFeePerYear)}/yr` : ''}${o.performanceFeePct ? `, performance ~${o.performanceFeePct}%` : ''}${o.contributionChargePct ? `, contribution charge ${o.contributionChargePct}%` : ''}. End balance ${money(f.endBalance)} (${money(f.endBalanceReal)} today's money). Tax ${money(f.totals.contributionTax + f.totals.earningsTax)}, admin fees ${money(f.totals.adminPctFees + f.totals.fixedFees + f.totals.platformFees)}, other fees ${money(f.totals.investmentFees + f.totals.performanceFees + f.totals.contributionCharges)}; drag cost ${money(f.dragImpact)} in final balance.`;
      }),
    ];
    if (ranked && queryNote) lines.unshift(`Funds chosen from the person's request: ${queryNote}`);
    setComparisonSummary(lines.join('\n'));
  }, [result, options, country, d.label, money, ranked, queryNote]);
  useEffect(() => () => setComparisonSummary(''), []);

  const current = result?.funds[0];

  return (
    <section className="comparison-section" aria-labelledby="fund-comparison-title">
      <header className="comparison-heading">
        <p className="comparison-kicker">{COUNTRIES[country].name.toUpperCase()} · {d.label.toUpperCase()} · SAME PERSON, DIFFERENT FUNDS</p>
        <h2 id="fund-comparison-title">Compare {d.label} providers</h2>
        <p>
          Pick your current fund first, then up to three others. Fees and returns are filled in from each provider&apos;s latest
          published figures (with the source and date); change any number to match your own statement. Choose
          &quot;Other&quot; to add a provider that isn&apos;t listed. Country: change it with &quot;I live in&quot;.
        </p>
      </header>

      <form className="fc-query" onSubmit={(e) => { e.preventDefault(); if (query.trim()) runQuery(query); }}>
        <label htmlFor="fc-query-input">Ask for a comparison</label>
        <div className="fc-query-row">
          <input id="fc-query-input" type="text" value={query} maxLength={160} autoComplete="off"
            placeholder="e.g. I want to compare the top 3 fund providers in NZ" onChange={(e) => setQuery(e.target.value)} />
          <button type="submit" className="wizard-button">Compare</button>
        </div>
        <div className="fc-query-examples" aria-label="Examples">
          {QUERY_EXAMPLES.map((x) => <button type="button" key={x} onClick={() => { setQuery(x); runQuery(x); }}>{x}</button>)}
        </div>
        <small>Works for New Zealand, Australia, the US, the UK and the Philippines. Say &quot;top&quot; (highest published past return),
          &quot;cheapest&quot; (lowest fees), a number from 2 to 4, and optionally a fund type (conservative, balanced, growth, aggressive).</small>
        {queryNote && <p className="fc-query-note" role="status">{queryNote}</p>}
      </form>

      <div className="comparison-controls">
        <div className="comparison-common">
          <NumberField id="fc-start" label="Current balance" value={startBalance} step={1000} unit={cur} onChange={setStartBalance} />
          <NumberField id="fc-salary" label={country === 'UK' ? 'Salary (contributions use £6,240–£50,270 of it)' : 'Salary before tax'} value={salary} step={1000} unit={`${cur} / year`} onChange={setSalary} />
          <NumberField id="fc-salary-growth" label="Salary growth" value={salaryGrowthPct} step={0.5} unit="% / year" onChange={setSalaryGrowthPct} />
          <NumberField id="fc-employee" label={country === 'PH' ? 'Your PERA contribution' : 'Your contribution'} value={employeePct} step={0.5} unit="% of salary" onChange={setEmployeePct} />
          <NumberField id="fc-employer" label={d.employerLabel} value={employerPct} step={0.5} unit="% of salary" onChange={setEmployerPct} />
          <NumberField id="fc-extra" label="Extra voluntary contribution" value={extraMonthly} step={50} unit={`${cur} / month`} onChange={setExtraMonthly} />
          <NumberField id="fc-years" label="Years to compare" value={years} step={1} unit="years" onChange={setYears} />
          <NumberField id="fc-inflation" label="Inflation" value={inflationPct} step={0.1} unit="% / year" onChange={setInflationPct} />
          {country === 'NZ' && (
            <>
              <label className="comparison-field" htmlFor="fc-pir"><span>Your PIR (tax rate)</span>
                <select id="fc-pir" className="planner-select" value={nzPir} onChange={(e) => setNzPir(Number(e.target.value))}>
                  <option value={10.5}>10.5%</option><option value={17.5}>17.5%</option><option value={28}>28%</option>
                </select>
              </label>
              <label className="fc-check"><input type="checkbox" checked={nzGov} onChange={(e) => setNzGov(e.target.checked)} /> Include the government contribution</label>
            </>
          )}
          {country === 'US' && (
            <label className="comparison-field" htmlFor="fc-us"><span>Account type</span>
              <select id="fc-us" className="planner-select" value={usAccount} onChange={(e) => setUsAccount(e.target.value as UsAccount)}>
                <option value="traditional">Traditional 401(k) / IRA (taxed when withdrawn)</option>
                <option value="roth">Roth 401(k) / IRA (tax-free withdrawals)</option>
                <option value="taxable">Taxable brokerage account</option>
              </select>
            </label>
          )}
          <label className="comparison-field" htmlFor="fc-source"><span>Returns to use</span>
            <select id="fc-source" className="planner-select" value={returnSource} onChange={(e) => switchSource(e.target.value as ReturnSource)}>
              <option value="historic">Each fund&apos;s published past return (5-year where available)</option>
              <option value="long-term">The same long-term return for each risk level (compares fees and tax only)</option>
            </select>
          </label>
          {country === 'UK' && <small className="fc-hint">Contributions use qualifying earnings between £{UK_QUALIFYING_LOWER.toLocaleString()} and £{UK_QUALIFYING_UPPER.toLocaleString()}.</small>}
        </div>

        <div className="comparison-options">
          {options.map((o, index) => {
            const f = providers.find((x) => x.id === o.choice);
            return (
              <fieldset className="comparison-option" key={o.id} style={{ '--option-color': COLORS[index] } as CSSProperties}>
                <legend><span>{String(index + 1).padStart(2, '0')}</span> {ranked ? `Ranked #${index + 1}` : index === 0 ? 'Your current fund' : 'Fund to compare'}</legend>
                <label className="comparison-field" htmlFor={`${o.id}-provider`}>
                  <span>Provider and fund</span>
                  <select id={`${o.id}-provider`} className="planner-select" value={o.choice} onChange={(e) => { choose(o.id, e.target.value); if (index === 0) setRanked(false); }}>
                    {byProvider.map(([provider, funds]) => (
                      <optgroup key={provider} label={provider}>
                        {funds.map((x) => <option key={x.id} value={x.id}>{x.provider}: {x.fund}</option>)}
                      </optgroup>
                    ))}
                    <option value={CUSTOM}>Other: enter my own provider…</option>
                  </select>
                </label>
                {o.choice === CUSTOM && (
                  <label className="comparison-field" htmlFor={`${o.id}-name`}>
                    <span>Provider and fund name</span>
                    <input id={`${o.id}-name`} value={o.name} maxLength={80} placeholder="e.g. NZ Funds Growth Strategy"
                      onChange={(e) => update(o.id, { name: e.target.value })} />
                  </label>
                )}
                {f ? (
                  <p className="fc-source">
                    <span className={`fc-badge is-${f.confidence}`}>{f.confidence === 'sourced' ? 'Published figures' : 'Typical figures: check'}</span>{' '}
                    {f.historicReturnPct !== undefined
                      ? <>Past return {f.historicReturnPct}% a year over {f.historicYears} year{f.historicYears === 1 ? '' : 's'} ({f.returnBasis?.replace(/-/g, ' ')}). </>
                      : <>No published past return here: using the long-term {f.risk} assumption. </>}
                    <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">{f.sourceLabel} ↗</a>, as at {f.asOf}.
                    <br /><em>{f.feeHow}</em>{f.note && <> {f.note}</>}
                  </p>
                ) : (
                  <p className="fc-source">Enter the fees from the fund&apos;s latest fund update, fact sheet or fee disclosure.</p>
                )}
                <div className="comparison-fees-grid">
                  <NumberField id={`${o.id}-ret`} label="Return before fees and tax" value={o.grossReturnPct} step={0.25} unit="% / year" min={-10} onChange={(v) => update(o.id, { grossReturnPct: v })} />
                  <label className="comparison-field" htmlFor={`${o.id}-risk`}><span>Fund type</span>
                    <select id={`${o.id}-risk`} className="planner-select" value={o.risk} onChange={(e) => update(o.id, { risk: e.target.value as FundRisk })}>
                      <option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="growth">Growth</option><option value="aggressive">Aggressive / high growth</option>
                    </select>
                  </label>
                  <NumberField id={`${o.id}-inv`} label="Fund / investment fee" value={o.investmentFeePct} step={0.05} unit="% / year" onChange={(v) => update(o.id, { investmentFeePct: v })} />
                  <NumberField id={`${o.id}-perf`} label="Performance fee (estimate)" value={o.performanceFeePct} step={0.05} unit="% / year" onChange={(v) => update(o.id, { performanceFeePct: v })} />
                  <NumberField id={`${o.id}-admin`} label="Admin fee" value={o.adminFeePct} step={0.05} unit="% / year" onChange={(v) => update(o.id, { adminFeePct: v })} />
                  <NumberField id={`${o.id}-fixed`} label="Fixed member / admin fee" value={o.fixedFeePerYear} step={1} unit={`${cur} / year`} onChange={(v) => update(o.id, { fixedFeePerYear: v })} />
                  {(country === 'UK' || o.platformFeePct > 0) && (
                    <>
                      <NumberField id={`${o.id}-plat`} label="Platform fee" value={o.platformFeePct} step={0.05} unit="% / year" onChange={(v) => update(o.id, { platformFeePct: v })} />
                      <NumberField id={`${o.id}-cap`} label="Platform fee cap (0 = none)" value={o.platformFeeCapPerYear} step={5} unit={`${cur} / year`} onChange={(v) => update(o.id, { platformFeeCapPerYear: v })} />
                    </>
                  )}
                  <NumberField id={`${o.id}-charge`} label="Charge on each contribution" value={o.contributionChargePct} step={0.1} unit="%" onChange={(v) => update(o.id, { contributionChargePct: v })} />
                  {country === 'NZ' && <NumberField id={`${o.id}-growth`} label="Growth assets (for PIE tax)" value={o.growthSharePct} step={5} unit="%" onChange={(v) => update(o.id, { growthSharePct: v })} />}
                </div>
                {options.length > 2 && (
                  <button type="button" className="comparison-remove" onClick={() => setOptions((cur) => cur.filter((x) => x.id !== o.id))}>Remove this fund</button>
                )}
              </fieldset>
            );
          })}
          {options.length < 4 && <button type="button" className="comparison-add" onClick={addOption}>+ Add another fund</button>}
        </div>
      </div>

      {result ? (
        <div className="comparison-results" aria-live="polite">
          <div className="fc-granularity" role="radiogroup" aria-label="Show the projection">
            {(['monthly', 'quarterly', 'yearly'] as Gran[]).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={granularity === g} className={granularity === g ? 'is-on' : ''} onClick={() => setGranularity(g)}>
                {g === 'monthly' ? 'Monthly' : g === 'quarterly' ? 'Quarterly' : 'Annual'}
              </button>
            ))}
          </div>

          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <caption>After {years} years</caption>
              <thead><tr><th scope="col">Fund</th><th scope="col">Balance</th><th scope="col">In today&apos;s money</th><th scope="col">Tax</th><th scope="col">Admin fees</th><th scope="col">Other fees</th><th scope="col">Cost of drag</th>{current && <th scope="col">vs current fund</th>}</tr></thead>
              <tbody>{result.funds.map((f, i) => (
                <tr key={f.id} style={{ '--option-color': COLORS[i] } as CSSProperties}>
                  <th scope="row"><span className="comparison-swatch" />{f.name}</th>
                  <td>{money(f.endBalance)}</td>
                  <td>{money(f.endBalanceReal)}</td>
                  <td>{money(f.totals.contributionTax + f.totals.earningsTax)}</td>
                  <td>{money(f.totals.adminPctFees + f.totals.fixedFees + f.totals.platformFees)}</td>
                  <td>{money(f.totals.investmentFees + f.totals.performanceFees + f.totals.contributionCharges)}</td>
                  <td>{money(f.dragImpact)}</td>
                  {current && <td>{i === 0 ? '—' : `${f.endBalance >= current.endBalance ? '+' : '−'}${money(Math.abs(f.endBalance - current.endBalance))}`}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>

          {result.funds.map((f, i) => <FundPanel key={f.id} fund={f} color={COLORS[i]} granularity={granularity} money={money} cur={cur} />)}

          <section className="fc-decision" aria-labelledby="fc-decision-title">
            <h3 id="fc-decision-title">Stay or move? What these numbers say</h3>
            {current && result.funds.length > 1 && (
              <ul>
                {result.funds.slice(1).map((f) => {
                  const diff = f.endBalance - current.endBalance;
                  const k = result.funds.indexOf(f);
                  const sameReturn = Math.abs(options[k].grossReturnPct - options[0].grossReturnPct) < 0.01;
                  const feeDiff = (f.totals.adminPctFees + f.totals.fixedFees + f.totals.platformFees + f.totals.investmentFees + f.totals.performanceFees + f.totals.contributionCharges)
                    - (current.totals.adminPctFees + current.totals.fixedFees + current.totals.platformFees + current.totals.investmentFees + current.totals.performanceFees + current.totals.contributionCharges);
                  return (
                    <li key={f.id}>
                      <strong>{f.name}</strong> would end {diff >= 0 ? 'higher' : 'lower'} by {money(Math.abs(diff))}{' '}
                      ({money(Math.abs(diff) * 0.04)} a year of retirement income using the 4% rule of thumb). Its fees total{' '}
                      {money(Math.abs(feeDiff))} {feeDiff <= 0 ? 'less' : 'more'} than your current fund.
                      {!sameReturn && <> Part of the gap comes from a different return assumption ({options[k].grossReturnPct}% vs {options[0].grossReturnPct}%): past returns don&apos;t repeat reliably, so switch &quot;Returns to use&quot; to the long-term option to see the fee and tax difference on its own.</>}
                      {options[k].risk !== options[0].risk && <> It is a {options[k].risk} fund and yours is {options[0].risk}: compare funds of the same risk level, or choose the risk that fits your time to retirement first.</>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p><strong>Rules of thumb:</strong> a fee gap of 0.5% a year often costs more than 10% of your final balance over 25+ years; but the
              right risk level for your time frame, and staying invested through downturns, usually matter even more than fees. A fund that
              charges more is only worth it if it consistently earns more after fees for the same risk.</p>
            <h4>Before you decide in {COUNTRIES[country].name}</h4>
            <ul>{CHECKLIST[country].map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="fc-hint">Ask the library below about any of these numbers, for example &quot;Why does my current fund cost more in tax?&quot;.
              General information, not financial advice; for a personal recommendation talk to {COUNTRIES[country].adviser}.</p>
          </section>

          <details className="comparison-assumptions">
            <summary>Model assumptions and data sources (provider figures reviewed {PROVIDERS_REVIEWED})</summary>
            <ul>{result.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        </div>
      ) : <p className="comparison-error" role="status">Check the balances, contribution rates, returns and fees.</p>}
    </section>
  );
}
