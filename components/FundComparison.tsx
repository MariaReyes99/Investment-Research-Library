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
import { clearSavedComparison, COMPARISON_STATE_KEY, setComparisonSummary } from '../lib/comparisonShare';
import { parseFundQuery, pickTopFunds } from '../lib/finance/fundQuery';

const COLORS = ['#087e8b', '#c0472f', '#8a5d00', '#5b63b7'];
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

function NumberField({ id, label, value, step, unit, onChange, min = 0, hint }: {
  id: string; label: string; value: number; step: number; unit?: string; onChange: (v: number) => void; min?: number; hint?: string;
}) {
  const invalid = !Number.isFinite(value);
  return (
    <div className="comparison-field">
      <label htmlFor={id}>{label}</label>
      <span className="comparison-input-wrap">
        <input id={id} type="number" inputMode="decimal" min={min} step={step} value={Number.isFinite(value) ? value : ''}
          aria-describedby={[unit ? `${id}-unit` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {unit && <small id={`${id}-unit`}>{unit}</small>}
      </span>
      {hint && <small className="fc-field-hint" id={`${id}-hint`}>{hint}</small>}
      {invalid && <small className="fc-field-error" role="alert">Enter a number.</small>}
    </div>
  );
}

/** Where to find each number, in the person's country. */
const HINTS: Record<CountryCode, { balance: string; contribution: string; employer: string }> = {
  NZ: {
    balance: 'Your latest KiwiSaver statement, your provider\'s app or website, or myIR.',
    contribution: '3%, 3.5%, 4%, 6%, 8% or 10%: the KiwiSaver deduction on your payslip.',
    employer: 'At least 3.5% from April 2026, before ESCT tax. Check your payslip or contract.',
  },
  AU: {
    balance: 'Your super fund\'s app or statement, or myGov (ATO).',
    contribution: 'Extra before-tax (salary sacrifice) contributions as a % of salary. Enter 0 if none.',
    employer: 'The Super Guarantee is 12% of your ordinary earnings.',
  },
  US: {
    balance: 'Your 401(k) or IRA statement or plan website.',
    contribution: 'Your 401(k) deferral % from your plan website or payslip.',
    employer: 'Your employer match. For example, 50% of up to 6% of salary = 3%.',
  },
  UK: {
    balance: 'Your pension provider\'s app or annual statement. Lost pots: the Pension Tracing Service.',
    contribution: 'The pension % on your payslip (often 5%, including tax relief).',
    employer: 'At least 3% of qualifying earnings. Check your payslip or scheme booklet.',
  },
  PH: {
    balance: 'Your PERA administrator\'s statement, or your Pag-IBIG MP2 records.',
    contribution: 'Your PERA contribution as a % of salary (up to ₱200,000 a year).',
    employer: 'Usually 0, unless your employer pays into your PERA.',
  },
};

const totalFeePct = (o: FundOptionInput) => o.investmentFeePct + o.adminFeePct + o.performanceFeePct + o.platformFeePct;

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

/** Everything the person can set, saved on this device so the comparison (and the library's view of it) survives a reload. */
type Settings = {
  startBalance: number; salary: number; salaryGrowthPct: number; employeePct: number; employerPct: number; extraMonthly: number;
  years: number; inflationPct: number; nzPir: number; nzGov: boolean; usAccount: UsAccount; returnSource: ReturnSource;
  options: Draft[]; ranked: boolean; queryNote: string;
};
type Saved = Settings & { v: 1; country: CountryCode };

function defaultSettings(country: CountryCode): Settings {
  const d = COUNTRY_DEFAULTS[country];
  return {
    startBalance: 50_000, salary: d.salary, salaryGrowthPct: 2.5, employeePct: d.employeePct, employerPct: d.employerPct, extraMonthly: 0,
    years: 25, inflationPct: COUNTRIES[country].inflationPct, nzPir: 28, nzGov: true, usAccount: 'traditional', returnSource: 'historic',
    options: startOptions(country, 'historic'), ranked: false, queryNote: '',
  };
}

function readSaved(country: CountryCode): Saved | null {
  try {
    const s = JSON.parse(window.localStorage.getItem(COMPARISON_STATE_KEY) ?? 'null') as Saved | null;
    return s && s.v === 1 && s.country === country && Array.isArray(s.options) && s.options.length > 0 ? s : null;
  } catch { return null; }
}

/** When and how the money can be taken out, and what it costs: shared with the library so it can explain access and cross-border rules. */
const ACCESS: Record<CountryCode, string> = {
  NZ: 'KiwiSaver is locked in until 65, except a first-home withdrawal (after 3 years), significant financial hardship, serious illness, or moving overseas permanently (not to Australia, where savings can move to an Australian super fund instead). Withdrawals are tax-free; fees and PIE tax keep applying while the money stays invested.',
  AU: 'Super is preserved until preservation age (60) and retiring, or age 65; withdrawals from a taxed fund are generally tax-free from 60. Early release only in limited cases. Temporary residents who leave can claim a departing payment, which is taxed (35%, or 65% for working holiday makers). NZ citizens can move super to KiwiSaver under trans-Tasman portability.',
  US: 'Withdrawals from a 401(k) or traditional IRA before 59½ usually add a 10% penalty on top of income tax; required minimum distributions start at 73 (75 for those born in 1960 or later). Roth withdrawals are tax-free after 59½ once the account is 5 years old. Non-residents usually face 30% withholding unless a tax treaty lowers it.',
  UK: 'Pensions can be accessed from 55 (57 from April 2028). Usually 25% is tax-free (up to the lump sum allowance) and the rest is taxed as income. Transfers to an overseas scheme (QROPS) can face a 25% overseas transfer charge.',
  PH: 'PERA can be withdrawn from 55 after at least 5 years of contributions; earlier withdrawals lose the tax benefits and incur penalties. Pag-IBIG MP2 matures after 5 years; early withdrawal is allowed only in specific cases and can reduce dividends.',
};

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
    let net = 0, growth = 0, tax = 0, admin = 0, other = 0;
    return seriesOf(fund, granularity).map((p) => {
      net += p.netReturn; growth += p.growth; tax += p.tax; admin += p.adminFees; other += p.otherFees;
      const grossPaidIn = p.startingCapital + p.employee + p.employer + p.government;
      const netPaidIn = p.startingCapital + p.employeeNet + p.employerNet + p.governmentNet;
      return {
        ...p, cumGrowth: growth, cumNetReturn: net, cumTax: tax, cumAdmin: admin, cumOther: other, cumDrag: tax + admin + other,
        grossPaidIn, netPaidIn, grossTotal: grossPaidIn + growth,
      };
    });
  }, [fund, granularity]);
  const last = data[data.length - 1];
  const yearRows = useMemo(() => {
    let growth = 0, drag = 0;
    return fund.yearly.map((p) => {
      growth += p.growth; drag += p.tax + p.adminFees + p.otherFees;
      return { period: p.period, paid: p.startingCapital + p.employee + p.employer + p.government, growth, drag, balance: p.balance, net: p.netReturn, pct: p.netReturnPct };
    });
  }, [fund]);
  const unit = UNIT[granularity];
  const axis = axisFor(granularity, data.length);
  const label = periodLabel(granularity);
  const t = fund.totals;
  const hasGov = t.government > 0;
  return (
    <details className="fund-panel" style={{ '--option-color': color } as CSSProperties} open>
      <summary><span className="comparison-swatch" />{fund.name}</summary>

      <p className="fc-flow">
        <span className="fc-flow-box is-gross">A. Gross total {money(last.grossTotal)}</span>{' − '}
        <span className="fc-flow-box is-drag">B. Drag {money(last.cumDrag)}</span>{' = '}
        <span className="fc-flow-box is-net" style={{ '--option-color': color } as CSSProperties}>C. Your balance {money(last.balance)}</span>
      </p>
      <div className="fund-charts">
        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h4>A. Gross: contributions + return, before drag</h4><span>{cur}, running totals (stacked)</span></div>
          <div className="fund-chart" aria-hidden="true">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis tickFormatter={compact} width={50} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" stackId="g" dataKey="startingCapital" name="Starting balance" fill="#c9d6d3" stroke="#9fb3ae" isAnimationActive={false} />
                <Area type="monotone" stackId="g" dataKey="employee" name="Your contributions" fill="#9ccfc9" stroke="#5aa69c" isAnimationActive={false} />
                <Area type="monotone" stackId="g" dataKey="employer" name={t.contributionTax > 0 ? 'Employer (before tax)' : 'Employer contributions'} fill="#f0c58f" stroke="#c9934c" isAnimationActive={false} />
                {hasGov && <Area type="monotone" stackId="g" dataKey="government" name="Government contribution" fill="#c7c3ef" stroke="#8b85c9" isAnimationActive={false} />}
                <Area type="monotone" stackId="g" dataKey="cumGrowth" name="Return before tax and fees" fill="#7fbfb6" stroke="#087e8b" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">
            Paid in {money(last.grossPaidIn)} (start {money(last.startingCapital)} + you {money(last.employee)} + employer {money(last.employer)}{hasGov ? ` + government ${money(last.government)}` : ''})
            {' '}+ return {money(last.cumGrowth)} = <strong>{money(last.grossTotal)}</strong>
          </p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h4>B. Drag: tax and fees taken out</h4><span>{cur}, running totals (stacked)</span></div>
          <div className="fund-chart" aria-hidden="true">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis tickFormatter={compact} width={50} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" stackId="d" dataKey="cumTax" name="Tax" fill="#e9a497" stroke="#d45b43" isAnimationActive={false} />
                <Area type="monotone" stackId="d" dataKey="cumAdmin" name="Admin fees" fill="#e3c78c" stroke="#b17b12" isAnimationActive={false} />
                <Area type="monotone" stackId="d" dataKey="cumOther" name="Other fees" fill="#aeb2e0" stroke="#5b63b7" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Tax {money(last.cumTax)} + admin {money(last.cumAdmin)} + other fees {money(last.cumOther)} = <strong>{money(last.cumDrag)}</strong></p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h4>C. Net: what stays in your account (A − B)</h4><span>{cur}, running totals (stacked) = your balance</span></div>
          <div className="fund-chart" aria-hidden="true">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis tickFormatter={compact} width={50} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" stackId="n" dataKey="startingCapital" name="Starting balance" fill="#c9d6d3" stroke="#9fb3ae" isAnimationActive={false} />
                <Area type="monotone" stackId="n" dataKey="employeeNet" name="Your contributions" fill="#9ccfc9" stroke="#5aa69c" isAnimationActive={false} />
                <Area type="monotone" stackId="n" dataKey="employerNet" name={t.contributionTax > 0 ? 'Employer (after tax)' : 'Employer contributions'} fill="#f0c58f" stroke="#c9934c" isAnimationActive={false} />
                {hasGov && <Area type="monotone" stackId="n" dataKey="governmentNet" name="Government contribution" fill="#c7c3ef" stroke="#8b85c9" isAnimationActive={false} />}
                <Area type="monotone" stackId="n" dataKey="cumNetReturn" name="Return after tax and fees" fill={color} fillOpacity={0.35} stroke={color} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">
            Net paid in {money(last.netPaidIn)}{t.contributionTax + t.contributionCharges > 0 && <> (after {money(t.contributionTax + t.contributionCharges)} {t.contributionCharges > 0 ? 'contribution tax and charges' : 'contribution tax'})</>}
            {' '}+ net return {money(last.cumNetReturn)} = <strong>{money(last.balance)}</strong>
          </p>
        </div>

        <div className="comparison-chart-wrap">
          <div className="comparison-chart-heading"><h4>D. Return each {unit}: before and after drag</h4><span>{cur} per {unit} (bars), % a year (lines)</span></div>
          <div className="fund-chart" aria-hidden="true">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={0}>
                <CartesianGrid stroke="#e1e8e5" vertical={false} />
                <XAxis dataKey="period" {...axis} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="m" tickFormatter={compact} width={50} tick={{ fontSize: 10, fill: '#637275' }} />
                <YAxis yAxisId="p" orientation="right" tickFormatter={(v) => `${Number(v).toFixed(1)}%`} width={40} tick={{ fontSize: 10, fill: '#637275' }} />
                <Tooltip formatter={(v, n) => [String(n).includes('%') ? `${Number(v).toFixed(2)}%` : money(Number(v)), String(n)]} labelFormatter={label} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="m" dataKey="growth" name="Before drag" fill="#7fbfb6" isAnimationActive={false} />
                <Bar yAxisId="m" dataKey="netReturn" name="After drag" fill={color} isAnimationActive={false} />
                <Line yAxisId="p" type="monotone" dataKey="grossReturnPct" name="Before drag %" stroke="#087e8b" strokeDasharray="4 3" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                <Line yAxisId="p" type="monotone" dataKey="netReturnPct" name="After drag %" stroke="#26322c" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="fc-chart-total">Return is earned on the <strong>whole balance</strong> (starting amount + contributions + earlier growth), so it grows as the balance grows. Year 1: {(data.length ? fund.yearly[0].grossReturnPct : 0).toFixed(2)}% before drag, {fund.yearly[0].netReturnPct.toFixed(2)}% after.</p>
        </div>
      </div>

      <details className="fc-table-view">
        <summary>Show these charts as a table (year by year)</summary>
        <div className="table-scroll">
          <table className="comparison-table fc-year-table">
            <caption>{fund.name}: running totals at the end of each year, {cur}</caption>
            <thead>
              <tr><th scope="col">Year</th><th scope="col">A. Paid in</th><th scope="col">A. Return before drag</th><th scope="col">B. Drag</th><th scope="col">C. Balance</th><th scope="col">D. Return after drag that year</th></tr>
            </thead>
            <tbody>
              {yearRows.map((r) => (
                <tr key={r.period}>
                  <th scope="row">{r.period}</th><td>{money(r.paid)}</td><td>{money(r.growth)}</td><td>{money(r.drag)}</td><td>{money(r.balance)}</td><td>{money(r.net)} ({r.pct.toFixed(1)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

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
          <strong>Bottom line:</strong> drag taken out (B) {money(fund.totalDrag)}. That money is no longer invested, so it also stops
          growing: with no tax or fees this fund would reach {money(fund.noDragBalance)}, which is {money(fund.dragImpact)} more than
          your balance of {money(fund.endBalance)}.
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
  const pending = useRef<{ country: CountryCode; funds: ProviderFund[]; note: string } | null>(null);

  const apply = (x: Settings) => {
    setStartBalance(x.startBalance); setSalary(x.salary); setSalaryGrowthPct(x.salaryGrowthPct);
    setEmployeePct(x.employeePct); setEmployerPct(x.employerPct); setExtraMonthly(x.extraMonthly); setYears(x.years);
    setInflationPct(x.inflationPct); setNzPir(x.nzPir); setNzGov(x.nzGov); setUsAccount(x.usAccount);
    setReturnSource(x.returnSource); setOptions(x.options); setRanked(x.ranked); setQueryNote(x.queryNote);
  };

  // New country (or first load): restore this country's saved comparison, or start from its defaults
  useEffect(() => {
    const p = pending.current;
    if (p && p.country === country) {
      apply({ ...defaultSettings(country), options: toDrafts(p.funds, country, 'historic'), ranked: true, queryNote: p.note });
      pending.current = null;
      return;
    }
    apply(readSaved(country) ?? defaultSettings(country));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const settings: Settings = useMemo(() => ({
    startBalance, salary, salaryGrowthPct, employeePct, employerPct, extraMonthly, years, inflationPct, nzPir, nzGov, usAccount,
    returnSource, options, ranked, queryNote,
  }), [startBalance, salary, salaryGrowthPct, employeePct, employerPct, extraMonthly, years, inflationPct, nzPir, nzGov, usAccount, returnSource, options, ranked, queryNote]);
  // Only a comparison the person has changed is saved and shared with the library
  const edited = useMemo(() => JSON.stringify(settings) !== JSON.stringify(defaultSettings(country)), [settings, country]);
  useEffect(() => {
    if (!edited) return;
    try { window.localStorage.setItem(COMPARISON_STATE_KEY, JSON.stringify({ v: 1, country, ...settings } satisfies Saved)); } catch { /* storage unavailable */ }
  }, [edited, settings, country]);

  const startAgain = () => {
    clearSavedComparison();
    pending.current = null;
    setQuery('');
    apply(defaultSettings(country));
  };

  const runQuery = (text: string) => {
    const q = parseFundQuery(text);
    const target = q.country ?? country;
    const pick = pickTopFunds(target, q);
    const where = `${COUNTRIES[target].name} (${COUNTRY_DEFAULTS[target].label})`;
    const note = `${where}: ${pick.explanation}${q.country ? '' : ` No country named, so I used ${COUNTRIES[target].name}.`}`;
    setQueryNote(note);
    setRanked(true);
    if (target !== country) {
      pending.current = { country: target, funds: pick.funds, note };
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

  // Share a summary with the library chat (saved on this device), once the person has set up their own comparison
  useEffect(() => {
    if (!result || !edited) { setComparisonSummary(''); return; }
    const i = result.inputs;
    const first = result.funds[0];
    const lines = [
      `${COUNTRIES[country].name} retirement fund comparison (${d.label}) over ${i.years} years: current balance ${money(i.startBalance)}, salary ${money(i.salary)} (+${i.salaryGrowthPct}%/yr), employee ${i.employeePct}%, employer ${i.employerPct}%, extra ${money(i.extraMonthly)}/month, inflation ${i.inflationPct}%${country === 'NZ' ? `, PIR ${i.nzPir}%, government contribution ${i.nzGovContribution ? 'included' : 'not included'}` : ''}${country === 'US' ? `, ${i.usAccount} account` : ''}. Returns used: ${returnSource === 'historic' ? "each fund's published past return, converted to before fees and tax" : 'the same long-term return for each risk level'}; the model assumes a steady return every year (no market falls).`,
      ranked ? 'Funds were picked from a ranking request, so fund 1 may not be the person\'s current fund.' : `Fund 1 (${first.name}) is the person's current fund.`,
      ...result.funds.map((f, k) => {
        const o = options[k];
        const t = f.totals;
        const gross = i.startBalance + t.employee + t.employer + t.government + t.growth;
        return [
          `- ${f.name} (${o.risk}): return before fees and tax ${o.grossReturnPct}%/yr; fund fee ${o.investmentFeePct}%${o.adminFeePct ? `, admin ${o.adminFeePct}%` : ''}${o.fixedFeePerYear ? `, fixed ${money(o.fixedFeePerYear)}/yr` : ''}${o.performanceFeePct ? `, performance ~${o.performanceFeePct}%` : ''}${o.platformFeePct ? `, platform ${o.platformFeePct}%` : ''}${o.contributionChargePct ? `, ${o.contributionChargePct}% off each contribution` : ''}.`,
          `  A gross ${money(gross)} (paid in ${money(i.startBalance + t.employee + t.employer + t.government)} incl. government ${money(t.government)}, return ${money(t.growth)}) - B drag ${money(f.totalDrag)} (tax ${money(t.contributionTax + t.earningsTax)}, admin ${money(t.adminPctFees + t.fixedFees + t.platformFees)}, other fees ${money(t.investmentFees + t.performanceFees + t.contributionCharges)}) = C balance ${money(f.endBalance)} (${money(f.endBalanceReal)} in today's money). Without any drag it would be ${money(f.noDragBalance)}.`,
          k > 0 ? `  vs fund 1: ${f.endBalance >= first.endBalance ? '+' : '-'}${money(Math.abs(f.endBalance - first.endBalance))}.` : '',
          f.withdrawalTaxNote ? `  When withdrawn: ${f.withdrawalTaxNote}` : '',
        ].filter(Boolean).join('\n');
      }),
      `Access and costs of taking the money out (${COUNTRIES[country].name}): ${ACCESS[country]}`,
    ];
    if (ranked && queryNote) lines.unshift(`Funds chosen from the person's request: ${queryNote}`);
    setComparisonSummary(lines.join('\n'));
  }, [result, edited, options, country, d.label, money, ranked, queryNote, returnSource]);

  const current = result?.funds[0];
  // A short update for screen readers when the results change
  const liveSummary = useMemo(() => (result
    ? `Results updated. After ${years} years: ${result.funds.map((f) => `${f.name} ${money(f.endBalance)}`).join('; ')}.`
    : ''), [result, years, money]);

  return (
    <section className="comparison-section" aria-labelledby="fund-comparison-title">
      <header className="comparison-heading">
        <p className="comparison-kicker">{COUNTRIES[country].name} · {d.label} · same person, different funds</p>
        <div className="fc-title-row">
          <h2 id="fund-comparison-title">Retirement fund comparison: {d.label}</h2>
          <button type="button" className="fc-reset" onClick={startAgain} disabled={!edited && !query}
            aria-describedby="fc-reset-hint">↺ Start again</button>
          <span id="fc-reset-hint" className="sr-only">Clears this comparison and goes back to the starting values.</span>
        </div>
        <ol className="fc-steps" aria-label="How to use the comparison">
          <li><a href="#fc-step-1"><b>1</b> Your details</a></li>
          <li><a href="#fc-step-2"><b>2</b> Choose funds</a></li>
          <li><a href="#fc-step-3"><b>3</b> Read the results</a></li>
        </ol>
        <details className="fc-help">
          <summary>How to use this, and where to find your numbers</summary>
          <ol>
            <li><strong>Your details:</strong> enter your balance, salary and contribution rates. The hint under each box says where to find it. You can leave the optional settings as they are.</li>
            <li><strong>Choose funds:</strong> pick your current fund first, then up to three others, or type a request like &quot;compare the top 3 providers in {COUNTRIES[country].name}&quot;. Fees and past returns fill in automatically from each provider&apos;s latest published figures.</li>
            <li><strong>Read the results:</strong> the table compares final balances. Under each fund, four charts show A: money paid in plus return, B: tax and fees, C: what stays in your account (A minus B), and D: the return each year. Each chart can be shown as a table.</li>
          </ol>
          <p>Only change a fund&apos;s fees if your own statement shows different figures. Your comparison is saved on this device, and the library can answer questions about it.</p>
        </details>
      </header>

      <section className="fc-step" id="fc-step-1" aria-labelledby="fc-step-1-title" tabIndex={-1}>
        <h3 id="fc-step-1-title"><span className="fc-step-num" aria-hidden="true">1</span> Your details</h3>
        <div className="comparison-common fc-essentials">
          <NumberField id="fc-start" label={`Current ${d.label} balance`} value={startBalance} step={1000} unit={cur} onChange={setStartBalance} hint={HINTS[country].balance} />
          <NumberField id="fc-salary" label="Salary before tax" value={salary} step={1000} unit={`${cur} a year`} onChange={setSalary}
            hint={country === 'UK' ? `From your payslip or contract. Contributions use the part between £${UK_QUALIFYING_LOWER.toLocaleString()} and £${UK_QUALIFYING_UPPER.toLocaleString()}.` : 'From your payslip or employment contract.'} />
          <NumberField id="fc-employee" label={country === 'PH' ? 'Your PERA contribution' : 'Your contribution'} value={employeePct} step={0.5} unit="% of salary" onChange={setEmployeePct} hint={HINTS[country].contribution} />
          <NumberField id="fc-employer" label={d.employerLabel} value={employerPct} step={0.5} unit="% of salary" onChange={setEmployerPct} hint={HINTS[country].employer} />
          <NumberField id="fc-years" label="Years to compare" value={years} step={1} unit="years" onChange={setYears} hint="Usually the years until you retire." />
          {country === 'NZ' && (
            <div className="comparison-field">
              <label htmlFor="fc-pir">Your PIR (tax rate on KiwiSaver)</label>
              <select id="fc-pir" className="planner-select" value={nzPir} onChange={(e) => setNzPir(Number(e.target.value))} aria-describedby="fc-pir-hint">
                <option value={10.5}>10.5%</option><option value={17.5}>17.5%</option><option value={28}>28%</option>
              </select>
              <small className="fc-field-hint" id="fc-pir-hint">Shown in myIR. Most people earning over $53,500 are on 28%.</small>
            </div>
          )}
          {country === 'US' && (
            <div className="comparison-field">
              <label htmlFor="fc-us">Account type</label>
              <select id="fc-us" className="planner-select" value={usAccount} onChange={(e) => setUsAccount(e.target.value as UsAccount)} aria-describedby="fc-us-hint">
                <option value="traditional">Traditional 401(k) / IRA (taxed when withdrawn)</option>
                <option value="roth">Roth 401(k) / IRA (tax-free withdrawals)</option>
                <option value="taxable">Taxable brokerage account</option>
              </select>
              <small className="fc-field-hint" id="fc-us-hint">Shown on your plan website or statement.</small>
            </div>
          )}
        </div>
        <details className="fc-more">
          <summary>Optional settings <small>(salary growth, extra contributions, inflation, which returns to use)</small></summary>
          <div className="comparison-common">
            <NumberField id="fc-salary-growth" label="Salary growth" value={salaryGrowthPct} step={0.5} unit="% a year" onChange={setSalaryGrowthPct} hint="Pay rises you expect on average. 2–3% is typical." />
            <NumberField id="fc-extra" label="Extra voluntary contribution" value={extraMonthly} step={50} unit={`${cur} a month`} onChange={setExtraMonthly} hint="Anything you pay in on top of your salary contributions." />
            <NumberField id="fc-inflation" label="Inflation" value={inflationPct} step={0.1} unit="% a year" onChange={setInflationPct} hint="Used only for the “in today’s money” figures." />
            {country === 'NZ' && (
              <div className="comparison-field fc-check-field">
                <label className="fc-check"><input type="checkbox" checked={nzGov} onChange={(e) => setNzGov(e.target.checked)} /> Include the government contribution</label>
                <small className="fc-field-hint">Up to $260.72 a year if you contribute at least $1,042.86 and earn under $180,000.</small>
              </div>
            )}
            <div className="comparison-field">
              <label htmlFor="fc-source">Returns to use</label>
              <select id="fc-source" className="planner-select" value={returnSource} onChange={(e) => switchSource(e.target.value as ReturnSource)} aria-describedby="fc-source-hint">
                <option value="historic">Each fund&apos;s published past return</option>
                <option value="long-term">The same long-term return for each fund type</option>
              </select>
              <small className="fc-field-hint" id="fc-source-hint">Choose the second option to compare fees and tax only, because past returns don&apos;t repeat reliably.</small>
            </div>
          </div>
        </details>
      </section>

      <section className="fc-step" id="fc-step-2" aria-labelledby="fc-step-2-title" tabIndex={-1}>
        <h3 id="fc-step-2-title"><span className="fc-step-num" aria-hidden="true">2</span> Choose funds to compare</h3>
        <form className="fc-query" role="search" aria-label="Pick funds by typing a request" onSubmit={(e) => { e.preventDefault(); if (query.trim()) runQuery(query); }}>
          <label htmlFor="fc-query-input">Quick pick: type what you want to compare</label>
          <div className="fc-query-row">
            <input id="fc-query-input" type="text" value={query} maxLength={160} autoComplete="off" aria-describedby="fc-query-hint"
              placeholder="e.g. compare the top 3 providers in NZ" onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="wizard-button">Compare</button>
          </div>
          <small id="fc-query-hint">Name a country, a number from 2 to 4, &quot;top&quot; (highest past return) or &quot;cheapest&quot; (lowest fees), and optionally a fund type.</small>
          <div className="fc-query-examples" role="group" aria-label="Example requests">
            {QUERY_EXAMPLES.map((x) => <button type="button" key={x} onClick={() => { setQuery(x); runQuery(x); }}>{x}</button>)}
          </div>
          {queryNote && <p className="fc-query-note" role="status">{queryNote}</p>}
        </form>
        <p className="fc-or">Or pick each fund yourself:</p>

        <div className="comparison-options">
          {options.map((o, index) => {
            const f = providers.find((x) => x.id === o.choice);
            const title = ranked ? `Ranked #${index + 1}` : index === 0 ? 'Your current fund' : `Fund ${index + 1} to compare`;
            return (
              <fieldset className="comparison-option" key={o.id} style={{ '--option-color': COLORS[index] } as CSSProperties}>
                <legend><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span> {title}</legend>
                <div className="comparison-field">
                  <label htmlFor={`${o.id}-provider`}>Provider and fund</label>
                  <select id={`${o.id}-provider`} className="planner-select" value={o.choice} onChange={(e) => { choose(o.id, e.target.value); if (index === 0) setRanked(false); }}>
                    {byProvider.map(([provider, funds]) => (
                      <optgroup key={provider} label={provider}>
                        {funds.map((x) => <option key={x.id} value={x.id}>{x.provider}: {x.fund}</option>)}
                      </optgroup>
                    ))}
                    <option value={CUSTOM}>Other: enter my own provider…</option>
                  </select>
                </div>
                {o.choice === CUSTOM && (
                  <div className="comparison-field">
                    <label htmlFor={`${o.id}-name`}>Provider and fund name</label>
                    <input id={`${o.id}-name`} value={o.name} maxLength={80} placeholder="e.g. NZ Funds Growth Strategy"
                      onChange={(e) => update(o.id, { name: e.target.value })} />
                  </div>
                )}
                <p className="fc-fund-summary">
                  <span><b>Fees</b> {totalFeePct(o).toFixed(2)}% a year{o.fixedFeePerYear ? ` + ${money(o.fixedFeePerYear)}` : ''}{o.contributionChargePct ? ` + ${o.contributionChargePct}% of contributions` : ''}</span>
                  <span><b>Return used</b> {Number.isFinite(o.grossReturnPct) ? o.grossReturnPct : '?'}% a year before fees and tax</span>
                  <span><b>Type</b> {o.risk}</span>
                </p>
                {f ? (
                  <p className="fc-source">
                    <span className={`fc-badge is-${f.confidence}`}>{f.confidence === 'sourced' ? 'Published figures' : 'Typical figures: check'}</span>{' '}
                    {f.historicReturnPct !== undefined
                      ? <>Past return {f.historicReturnPct}% a year over {f.historicYears} year{f.historicYears === 1 ? '' : 's'}, after fees{f.returnBasis === 'after-fees-after-tax' ? ' and tax' : ''}. </>
                      : <>No published past return: using a typical long-term return for a {f.risk} fund. </>}
                    Source: <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">{f.sourceLabel}<span className="sr-only"> (opens in a new tab)</span></a>, {f.asOf}.
                  </p>
                ) : (
                  <p className="fc-source">Enter the fees from the fund&apos;s latest fund update, fact sheet or fee disclosure below.</p>
                )}
                <details className="fc-fees" open={o.choice === CUSTOM}>
                  <summary>Check or change this fund&apos;s fees and return</summary>
                  {f && <p className="fc-field-hint">{f.feeHow}{f.note && <> {f.note}</>}</p>}
                  <div className="comparison-fees-grid">
                    <NumberField id={`${o.id}-ret`} label="Return before fees and tax" value={o.grossReturnPct} step={0.25} unit="% a year" min={-10} onChange={(v) => update(o.id, { grossReturnPct: v })}
                      hint="Lower it to test a weaker future. Negative numbers are allowed." />
                    <div className="comparison-field">
                      <label htmlFor={`${o.id}-risk`}>Fund type</label>
                      <select id={`${o.id}-risk`} className="planner-select" value={o.risk} onChange={(e) => update(o.id, { risk: e.target.value as FundRisk })}>
                        <option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="growth">Growth</option><option value="aggressive">Aggressive / high growth</option>
                      </select>
                    </div>
                    <NumberField id={`${o.id}-inv`} label="Fund / investment fee" value={o.investmentFeePct} step={0.05} unit="% a year" onChange={(v) => update(o.id, { investmentFeePct: v })} hint="In the fund update or product disclosure statement." />
                    <NumberField id={`${o.id}-perf`} label="Performance fee (estimate)" value={o.performanceFeePct} step={0.05} unit="% a year" onChange={(v) => update(o.id, { performanceFeePct: v })} />
                    <NumberField id={`${o.id}-admin`} label="Admin fee" value={o.adminFeePct} step={0.05} unit="% a year" onChange={(v) => update(o.id, { adminFeePct: v })} />
                    <NumberField id={`${o.id}-fixed`} label="Fixed member / admin fee" value={o.fixedFeePerYear} step={1} unit={`${cur} a year`} onChange={(v) => update(o.id, { fixedFeePerYear: v })} />
                    {(country === 'UK' || o.platformFeePct > 0) && (
                      <>
                        <NumberField id={`${o.id}-plat`} label="Platform fee" value={o.platformFeePct} step={0.05} unit="% a year" onChange={(v) => update(o.id, { platformFeePct: v })} />
                        <NumberField id={`${o.id}-cap`} label="Platform fee cap (0 = none)" value={o.platformFeeCapPerYear} step={5} unit={`${cur} a year`} onChange={(v) => update(o.id, { platformFeeCapPerYear: v })} />
                      </>
                    )}
                    <NumberField id={`${o.id}-charge`} label="Charge on each contribution" value={o.contributionChargePct} step={0.1} unit="%" onChange={(v) => update(o.id, { contributionChargePct: v })} />
                    {country === 'NZ' && <NumberField id={`${o.id}-growth`} label="Growth assets (for PIE tax)" value={o.growthSharePct} step={5} unit="%" onChange={(v) => update(o.id, { growthSharePct: v })} hint="The share in shares and property, from the fund update." />}
                  </div>
                </details>
                {options.length > 2 && (
                  <button type="button" className="comparison-remove" onClick={() => setOptions((cur) => cur.filter((x) => x.id !== o.id))}>Remove {o.name || title}</button>
                )}
              </fieldset>
            );
          })}
          {options.length < 4 && <button type="button" className="comparison-add" onClick={addOption}>+ Add another fund</button>}
        </div>
      </section>

      <section className="fc-step" id="fc-step-3" aria-labelledby="fc-step-3-title" tabIndex={-1}>
      <h3 id="fc-step-3-title"><span className="fc-step-num" aria-hidden="true">3</span> Results</h3>
      <p className="sr-only" role="status" aria-live="polite">{liveSummary}</p>
      {result ? (
        <div className="comparison-results">
          <div className="fc-granularity" role="group" aria-label="Show charts by">
            {(['monthly', 'quarterly', 'yearly'] as Gran[]).map((g) => (
              <button key={g} type="button" aria-pressed={granularity === g} className={granularity === g ? 'is-on' : ''} onClick={() => setGranularity(g)}>
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
            <h4 id="fc-decision-title">Stay or move? What these numbers say</h4>
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
                      {options[k].risk !== options[0].risk && <> It is {/^[aeiou]/.test(options[k].risk) ? 'an' : 'a'} {options[k].risk} fund and yours is {options[0].risk}: compare funds of the same risk level, or choose the risk that fits your time to retirement first.</>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p><strong>Rules of thumb:</strong> a fee gap of 0.5% a year often costs more than 10% of your final balance over 25+ years; but the
              right risk level for your time frame, and staying invested through downturns, usually matter even more than fees. A fund that
              charges more is only worth it if it consistently earns more after fees for the same risk.</p>
            <h5>Before you decide in {COUNTRIES[country].name}</h5>
            <ul>{CHECKLIST[country].map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="fc-hint">Ask the library below about any of these numbers, for example &quot;Why does my current fund cost more in tax?&quot;.
              General information, not financial advice; for a personal recommendation talk to {COUNTRIES[country].adviser}.</p>
          </section>

          <details className="comparison-assumptions">
            <summary>Model assumptions and data sources (provider figures reviewed {PROVIDERS_REVIEWED})</summary>
            <ul>{result.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        </div>
      ) : <p className="comparison-error" role="alert">Some boxes are empty or not numbers. Check the balance, contribution rates, years (1 to 60), returns and fees.</p>}
      </section>
    </section>
  );
}
