'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { comparePlatforms, type PlatformComparisonInput } from '../lib/finance/platform-comparison';
import { moneyFor, COUNTRIES } from '../lib/countries';
import { useCountry } from './CountryPicker';
import { FEE_LOOKUPS, FUND_FEES } from '../lib/fundFees';

type OptionDraft = {
  id: string;
  name: string;
  expectedReturnPct: number;
  annualFeePct: number;
  monthlyAccountFee: number;
  transactionFee: number;
  oneOffFee: number;
};

const COLORS = ['#087e8b', '#d45b43', '#b17b12', '#5b63b7'];
const START_OPTIONS: OptionDraft[] = [
  { id: 'option-1', name: 'Platform A', expectedReturnPct: 6, annualFeePct: 0.25, monthlyAccountFee: 0, transactionFee: 0, oneOffFee: 0 },
  { id: 'option-2', name: 'Platform B', expectedReturnPct: 6, annualFeePct: 0.75, monthlyAccountFee: 4, transactionFee: 2, oneOffFee: 0 },
];

function ComparisonInput({
  id, label, value, step, unit, onChange,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="comparison-field" htmlFor={id}>
      <span>{label}</span>
      <span className="comparison-input-wrap">
        <input id={id} type="number" inputMode="decimal" min="0" step={step} value={Number.isFinite(value) ? value : ''}
          onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))} />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

const LETTERS = ['A', 'B', 'C', 'D'];

/** Writes the platform's name at the end of its line, so the chart reads without the legend. */
function EndLabel({ x, y, index, last, name, color, nudge }: { x?: number; y?: number; index?: number; last: number; name: string; color: string; nudge: number }) {
  if (index !== last || x === undefined || y === undefined) return null;
  const short = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  return <text x={x + 6} y={y + nudge} fill={color} fontSize={11.5} fontWeight={650} dominantBaseline="middle">{short}</text>;
}

const PLOT_HEIGHT_PX = 220; // approximate drawing height of the chart
const LABEL_GAP_PX = 15;

/** Moves end labels apart when lines finish close together. Returns a pixel nudge per option. */
function labelNudges(finals: { id: string; value: number }[]): Record<string, number> {
  const max = Math.max(1, ...finals.map((f) => f.value)) * 1.1;
  const gap = (LABEL_GAP_PX / PLOT_HEIGHT_PX) * max; // the label gap, in money
  const sorted = [...finals].sort((a, b) => b.value - a.value);
  const nudges: Record<string, number> = {};
  let previous = Infinity;
  for (const f of sorted) {
    const placed = Math.min(f.value, previous - gap);
    nudges[f.id] = ((f.value - placed) / max) * PLOT_HEIGHT_PX; // positive = lower on screen
    previous = placed;
  }
  return nudges;
}

export default function PlatformComparison() {
  const [country] = useCountry();
  const money = moneyFor(country);
  const cur = COUNTRIES[country].currency;
  const [initialBalance, setInitialBalance] = useState(50_000);
  const [monthlyContribution, setMonthlyContribution] = useState(500);
  const [years, setYears] = useState(20);
  const [inflationPct, setInflationPct] = useState(2.5);
  const [options, setOptions] = useState<OptionDraft[]>(START_OPTIONS);

  const result = useMemo(() => {
    const numericValues = [initialBalance, monthlyContribution, years, inflationPct, ...options.flatMap((option) => [
      option.expectedReturnPct, option.annualFeePct, option.monthlyAccountFee, option.transactionFee, option.oneOffFee,
    ])];
    if (!numericValues.every(Number.isFinite)) return null;
    try {
      // A blank name falls back to "Platform A", "Platform B" and so on
      const named = options.map((o, i) => ({ ...o, name: o.name.trim() || `Platform ${LETTERS[i]}` }));
      const input: PlatformComparisonInput = { initialBalance, monthlyContribution, years, inflationPct, options: named };
      return comparePlatforms(input);
    } catch {
      return null;
    }
  }, [initialBalance, monthlyContribution, years, inflationPct, options]);

  const chartData = useMemo(() => {
    if (!result?.options.length) return [];
    return result.options[0].series.map((point, index) => {
      const row: Record<string, number> = { year: point.year };
      for (const option of result.options) row[option.id] = option.series[index]?.balance ?? 0;
      return row;
    });
  }, [result]);

  const nudges = useMemo(
    () => labelNudges((result?.options ?? []).map((o) => ({ id: o.id, value: o.series[o.series.length - 1]?.balance ?? 0 }))),
    [result],
  );

  const updateOption = (id: string, patch: Partial<OptionDraft>) =>
    setOptions((current) => current.map((option) => option.id === id ? { ...option, ...patch } : option));

  const addOption = () => setOptions((current) => current.length >= 4 ? current : [...current, {
    id: `option-${Date.now()}`,
    name: `Platform ${LETTERS[current.length]}`,
    expectedReturnPct: 6,
    annualFeePct: 0.5,
    monthlyAccountFee: 0,
    transactionFee: 0,
    oneOffFee: 0,
  }]);

  return (
    <section className="comparison-section" aria-labelledby="comparison-title">
      <header className="comparison-heading">
        <p className="comparison-kicker">SAME STARTING BALANCE · SAME CONTRIBUTIONS</p>
        <h2 id="comparison-title">Compare costs over time</h2>
        <p>Name each platform or fund, then replace the sample figures with its current fees from its website or fund fact sheet. The names appear on the chart. This is a scenario comparison, not a provider ranking.</p>
      </header>

      <div className="comparison-controls">
        <div className="comparison-common">
          <ComparisonInput id="comparison-balance" label="Starting balance" value={initialBalance} step={1000} unit={cur} onChange={setInitialBalance} />
          <ComparisonInput id="comparison-contribution" label="Monthly contribution" value={monthlyContribution} step={50} unit={cur} onChange={setMonthlyContribution} />
          <ComparisonInput id="comparison-years" label="Time horizon" value={years} step={1} unit="years" onChange={setYears} />
          <ComparisonInput id="comparison-inflation" label="Inflation" value={inflationPct} step={0.1} unit="% / year" onChange={setInflationPct} />
        </div>

        <div className="comparison-options">
          {options.map((option, index) => (
            <fieldset className="comparison-option" key={option.id} style={{ '--option-color': COLORS[index] } as CSSProperties}>
              <legend><span>{String(index + 1).padStart(2, '0')}</span> Fund or platform</legend>
              <label className="comparison-field" htmlFor={`${option.id}-name`}>
                <span>Platform or fund name</span>
                <input id={`${option.id}-name`} value={option.name} maxLength={80} placeholder="Name of the platform or fund"
                  onChange={(event) => updateOption(option.id, { name: event.target.value })} />
              </label>
              {FUND_FEES.length > 0 && (
                <label className="comparison-field" htmlFor={`${option.id}-fund`}>
                  <span>Fill in from a fund</span>
                  <select id={`${option.id}-fund`} className="planner-select" defaultValue=""
                    onChange={(event) => {
                      const f = FUND_FEES.find((x) => `${x.provider}|${x.name}` === event.target.value);
                      if (f) updateOption(option.id, { name: `${f.provider} ${f.name}`, annualFeePct: f.annualFeePct, monthlyAccountFee: f.monthlyAccountFee ?? 0 });
                    }}>
                    <option value="" disabled>Choose a fund…</option>
                    {FUND_FEES.map((f) => <option key={`${f.provider}|${f.name}`} value={`${f.provider}|${f.name}`}>{f.provider}: {f.name} ({f.annualFeePct}% a year, as at {f.asOf})</option>)}
                  </select>
                </label>
              )}
              <p className="comparison-lookup">
                Find this fund&apos;s fees:{' '}
                {(FEE_LOOKUPS[country] ?? []).map((l, i) => (
                  <span key={l.url}>{i > 0 && ' · '}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a></span>
                ))}
              </p>
              <div className="comparison-fees-grid">
                <ComparisonInput id={`${option.id}-return`} label="Gross return" value={option.expectedReturnPct} step={0.25} unit="% / year"
                  onChange={(value) => updateOption(option.id, { expectedReturnPct: value })} />
                <ComparisonInput id={`${option.id}-annual`} label="Annual fund/platform fee" value={option.annualFeePct} step={0.05} unit="% / year"
                  onChange={(value) => updateOption(option.id, { annualFeePct: value })} />
                <ComparisonInput id={`${option.id}-monthly`} label="Account fee" value={option.monthlyAccountFee} step={0.5} unit={`${cur} / month`}
                  onChange={(value) => updateOption(option.id, { monthlyAccountFee: value })} />
                <ComparisonInput id={`${option.id}-transaction`} label="Fee per contribution" value={option.transactionFee} step={0.5} unit={cur}
                  onChange={(value) => updateOption(option.id, { transactionFee: value })} />
                <ComparisonInput id={`${option.id}-oneoff`} label="One-off fee" value={option.oneOffFee} step={1} unit={cur}
                  onChange={(value) => updateOption(option.id, { oneOffFee: value })} />
              </div>
              {options.length > 2 && (
                <button type="button" className="comparison-remove" onClick={() => setOptions((current) => current.filter((entry) => entry.id !== option.id))}>
                  Remove this platform
                </button>
              )}
            </fieldset>
          ))}
          {options.length < 4 && <button type="button" className="comparison-add" onClick={addOption}>+ Add another platform</button>}
        </div>
      </div>

      {result ? (
        <div className="comparison-results" aria-live="polite">
          <div className="comparison-chart-wrap">
            <div className="comparison-chart-heading"><h3>Projected balance</h3><span>{cur}, not adjusted for inflation</span></div>
            <div className="comparison-chart">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 12, right: 118, bottom: 6, left: 4 }}>
                  <CartesianGrid stroke="#d8e1df" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: '#637275', fontSize: 11 }} tickLine={false} />
                  <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-NZ', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}
                    tick={{ fill: '#637275', fontSize: 11 }} width={52} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value, name) => [money(Number(value)), String(name)]} labelFormatter={(year) => `Year ${year}`} />
                  <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                  {result.options.map((option, index) => (
                    <Line key={option.id} dataKey={option.id} name={option.name} stroke={COLORS[index]} strokeWidth={2.5} dot={false} isAnimationActive={false}
                      label={<EndLabel last={chartData.length - 1} name={option.name} color={COLORS[index]} nudge={nudges[option.id] ?? 0} />} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <caption>Outcome after {years} years</caption>
              <thead><tr><th scope="col">Platform or fund</th><th scope="col">Balance</th><th scope="col">In today&apos;s money</th><th scope="col">Fees paid</th><th scope="col">Fee drag</th></tr></thead>
              <tbody>{result.options.map((option, index) => (
                <tr key={option.id} style={{ '--option-color': COLORS[index] } as CSSProperties}>
                  <th scope="row"><span className="comparison-swatch" />{option.name}</th>
                  <td>{money(option.endingBalanceNominal)}</td>
                  <td>{money(option.endingBalanceReal)}</td>
                  <td>{money(option.feesPaid)}</td>
                  <td>{money(option.feeImpact)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <details className="comparison-assumptions">
            <summary>Model assumptions and exclusions</summary>
            <ul>{result.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </details>
        </div>
      ) : <p className="comparison-error" role="status">Check the entered balances, returns and fees.</p>}
    </section>
  );
}