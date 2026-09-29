'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { comparePlatforms, type PlatformComparisonInput } from '../lib/finance/platform-comparison';
import { money } from './ProjectionChart';

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
  { id: 'option-1', name: 'Option 1', expectedReturnPct: 6, annualFeePct: 0.25, monthlyAccountFee: 0, transactionFee: 0, oneOffFee: 0 },
  { id: 'option-2', name: 'Option 2', expectedReturnPct: 6, annualFeePct: 0.75, monthlyAccountFee: 4, transactionFee: 2, oneOffFee: 0 },
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

export default function PlatformComparison() {
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
      const input: PlatformComparisonInput = { initialBalance, monthlyContribution, years, inflationPct, options };
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

  const updateOption = (id: string, patch: Partial<OptionDraft>) =>
    setOptions((current) => current.map((option) => option.id === id ? { ...option, ...patch } : option));

  const addOption = () => setOptions((current) => current.length >= 4 ? current : [...current, {
    id: `option-${Date.now()}`,
    name: `Option ${current.length + 1}`,
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
        <p>Replace the sample assumptions with figures from current fund and platform documents. This is a scenario comparison, not a provider ranking.</p>
      </header>

      <div className="comparison-controls">
        <div className="comparison-common">
          <ComparisonInput id="comparison-balance" label="Starting balance" value={initialBalance} step={1000} unit="NZD" onChange={setInitialBalance} />
          <ComparisonInput id="comparison-contribution" label="Monthly contribution" value={monthlyContribution} step={50} unit="NZD" onChange={setMonthlyContribution} />
          <ComparisonInput id="comparison-years" label="Time horizon" value={years} step={1} unit="years" onChange={setYears} />
          <ComparisonInput id="comparison-inflation" label="Inflation" value={inflationPct} step={0.1} unit="% / year" onChange={setInflationPct} />
        </div>

        <div className="comparison-options">
          {options.map((option, index) => (
            <fieldset className="comparison-option" key={option.id} style={{ '--option-color': COLORS[index] } as CSSProperties}>
              <legend><span>{String(index + 1).padStart(2, '0')}</span> Fund or platform</legend>
              <label className="comparison-field" htmlFor={`${option.id}-name`}>
                <span>Option name</span>
                <input id={`${option.id}-name`} value={option.name} maxLength={80}
                  onChange={(event) => updateOption(option.id, { name: event.target.value })} />
              </label>
              <div className="comparison-fees-grid">
                <ComparisonInput id={`${option.id}-return`} label="Gross return" value={option.expectedReturnPct} step={0.25} unit="% / year"
                  onChange={(value) => updateOption(option.id, { expectedReturnPct: value })} />
                <ComparisonInput id={`${option.id}-annual`} label="Annual fund/platform fee" value={option.annualFeePct} step={0.05} unit="% / year"
                  onChange={(value) => updateOption(option.id, { annualFeePct: value })} />
                <ComparisonInput id={`${option.id}-monthly`} label="Account fee" value={option.monthlyAccountFee} step={0.5} unit="NZD / month"
                  onChange={(value) => updateOption(option.id, { monthlyAccountFee: value })} />
                <ComparisonInput id={`${option.id}-transaction`} label="Fee per contribution" value={option.transactionFee} step={0.5} unit="NZD"
                  onChange={(value) => updateOption(option.id, { transactionFee: value })} />
                <ComparisonInput id={`${option.id}-oneoff`} label="One-off fee" value={option.oneOffFee} step={1} unit="NZD"
                  onChange={(value) => updateOption(option.id, { oneOffFee: value })} />
              </div>
              {options.length > 2 && (
                <button type="button" className="comparison-remove" onClick={() => setOptions((current) => current.filter((entry) => entry.id !== option.id))}>
                  Remove option
                </button>
              )}
            </fieldset>
          ))}
          {options.length < 4 && <button type="button" className="comparison-add" onClick={addOption}>+ Add comparison option</button>}
        </div>
      </div>

      {result ? (
        <div className="comparison-results" aria-live="polite">
          <div className="comparison-chart-wrap">
            <div className="comparison-chart-heading"><h3>Projected balance</h3><span>Nominal NZD</span></div>
            <div className="comparison-chart">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 6, left: 4 }}>
                  <CartesianGrid stroke="#d8e1df" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: '#637275', fontSize: 11 }} tickLine={false} />
                  <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-NZ', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value))}
                    tick={{ fill: '#637275', fontSize: 11 }} width={52} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => [money(Number(value)), 'Projected balance']} labelFormatter={(year) => `Year ${year}`} />
                  {result.options.map((option, index) => (
                    <Line key={option.id} dataKey={option.id} name={option.name} stroke={COLORS[index]} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <caption>Outcome after {years} years</caption>
              <thead><tr><th scope="col">Option</th><th scope="col">Balance</th><th scope="col">Today&apos;s dollars</th><th scope="col">Fees paid</th><th scope="col">Fee drag</th></tr></thead>
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