'use client';
/**
 * Wealth projector. Runs entirely in the browser: the numbers entered here are
 * never sent to the server or stored.
 */
import { useMemo, useState } from 'react';
import { projectWealth, type ProjectionInput } from '../lib/finance/projections';
import { MilestoneTable, ProjectionChart, ProjectionSummary } from './ProjectionChart';

type Key =
  | 'currentAge' | 'retirementAge' | 'currentSavings' | 'monthlyContribution' | 'expectedReturnPct'
  | 'feesPct' | 'inflationPct' | 'contributionGrowthPct' | 'withdrawalRatePct';

type Field = { key: Key; label: string; step: number; unit?: string; hint?: string };

const MAIN: Field[] = [
  { key: 'currentAge', label: 'Your age', step: 1 },
  { key: 'retirementAge', label: 'Retire at', step: 1 },
  { key: 'currentSavings', label: 'Invested now', step: 1000, unit: 'NZD', hint: 'KiwiSaver plus other investments' },
  { key: 'monthlyContribution', label: 'Added each month', step: 50, unit: 'NZD', hint: 'Include employer KiwiSaver contributions' },
  { key: 'expectedReturnPct', label: 'Expected return', step: 0.5, unit: '% a year', hint: 'Before fees. Try 4–5% conservative, 5–6% balanced, 6–8% growth' },
];
const MORE: Field[] = [
  { key: 'feesPct', label: 'Fees', step: 0.05, unit: '% a year' },
  { key: 'inflationPct', label: 'Inflation', step: 0.1, unit: '% a year' },
  { key: 'contributionGrowthPct', label: 'Contributions rise by', step: 0.5, unit: '% a year', hint: 'For example, pay rises' },
  { key: 'withdrawalRatePct', label: 'Withdrawal rate in retirement', step: 0.25, unit: '%', hint: 'See the note on safe withdrawal rates' },
];

function NumberField({ f, value, onChange }: { f: Field; value: number; onChange: (v: number) => void }) {
  const id = `field-${f.key}`;
  return (
    <div className="calc-field">
      <label htmlFor={id}>{f.label}</label>
      <div className="calc-input">
        <input id={id} type="number" inputMode="decimal" step={f.step} value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {f.unit && <span>{f.unit}</span>}
      </div>
      {f.hint && <small>{f.hint}</small>}
    </div>
  );
}

export default function WealthProjector() {
  const [v, setV] = useState<Record<Key, number>>({
    currentAge: 48, retirementAge: 65, currentSavings: 500_000, monthlyContribution: 1_500, expectedReturnPct: 7,
    feesPct: 0.5, inflationPct: 2.5, contributionGrowthPct: 2, withdrawalRatePct: 4,
  });
  const [goalType, setGoalType] = useState<'income' | 'balance' | 'none'>('income');
  const [goalValue, setGoalValue] = useState(60_000);

  const { result, error } = useMemo(() => {
    if (Object.values(v).some((n) => !Number.isFinite(n))) return { result: null, error: 'Fill in every field to see a projection.' };
    try {
      const input: ProjectionInput = {
        ...v,
        goal: goalType === 'none' ? undefined : goalType === 'balance' ? { targetAmount: goalValue } : { desiredAnnualIncome: goalValue },
      };
      return { result: projectWealth(input), error: null };
    } catch (e) {
      const issue = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues?.[0];
      return { result: null, error: issue ? `${issue.path.join(' ')}: ${issue.message}` : 'Check your numbers.' };
    }
  }, [v, goalType, goalValue]);

  const set = (k: Key) => (n: number) => setV((prev) => ({ ...prev, [k]: n }));

  return (
    <div className="calc-layout">
      <form className="calc-form" onSubmit={(e) => e.preventDefault()} aria-label="Projection inputs">
        {MAIN.map((f) => <NumberField key={f.key} f={f} value={v[f.key]} onChange={set(f.key)} />)}

        <fieldset className="calc-goal">
          <legend>Your goal, in today&apos;s dollars</legend>
          <div className="calc-radios">
            {([['income', 'Yearly income'], ['balance', 'Total balance'], ['none', 'No goal']] as const).map(([val, label]) => (
              <label key={val}>
                <input type="radio" name="goalType" checked={goalType === val} onChange={() => setGoalType(val)} /> {label}
              </label>
            ))}
          </div>
          {goalType !== 'none' && (
            <div className="calc-input">
              <input type="number" step={1000} value={goalValue} aria-label="Goal amount"
                onChange={(e) => setGoalValue(Number(e.target.value))} />
              <span>{goalType === 'income' ? 'NZD a year' : 'NZD'}</span>
            </div>
          )}
        </fieldset>

        <details className="calc-more">
          <summary>Fees, inflation and more</summary>
          {MORE.map((f) => <NumberField key={f.key} f={f} value={v[f.key]} onChange={set(f.key)} />)}
        </details>

        <p className="calc-privacy">Calculated on your device. Nothing you enter here is sent or saved.</p>
      </form>

      <section className="calc-results" aria-live="polite" aria-label="Projection results">
        {error && <p className="error-message">{error}</p>}
        {result && (
          <>
            <ProjectionSummary result={result} />
            <ProjectionChart result={result} height={320} />
            <MilestoneTable result={result} />
            <details className="calc-assumptions">
              <summary>Assumptions</summary>
              <ul>{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </details>
            <p className="disclaimer-note">{result.disclaimer}</p>
          </>
        )}
      </section>
    </div>
  );
}
