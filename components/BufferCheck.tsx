'use client';
/**
 * Emergency fund ("buffer") check: how many months of outgoings the household's
 * cash would cover, against the common rule of thumb of 3 to 6 months.
 */
import type { HouseholdResult } from '../lib/finance/household';
import { moneyFor } from '../lib/countries';

const TARGET_MONTHS = 3;
const STRONG_MONTHS = 6;

export function bufferMonths(r: HouseholdResult): { months: number | null; monthlyOut: number; cash: number } {
  const monthlyOut = r.today.outgoings.filter((l) => l.label !== 'Investing').reduce((s, l) => s + l.amount, 0);
  const cash = r.inputs.cashOnHand;
  return { months: monthlyOut > 0 ? cash / monthlyOut : null, monthlyOut, cash };
}

export default function BufferCheck({ result }: { result: HouseholdResult }) {
  const { months, monthlyOut, cash } = bufferMonths(result);
  if (months === null) return null;
  const money = moneyFor(result.inputs.country);
  const tone = months >= STRONG_MONTHS ? 'is-strong' : months >= TARGET_MONTHS ? 'is-good' : months >= 1 ? 'is-low' : 'is-very-low';
  const headline = months >= STRONG_MONTHS ? 'Strong emergency fund' : months >= TARGET_MONTHS ? 'Good emergency fund' : 'Build your emergency fund';
  const toTarget = Math.max(0, TARGET_MONTHS * monthlyOut - cash);
  const fill = Math.min(100, (months / 8) * 100);
  return (
    <section className={`buffer-check ${tone}`} aria-label="Emergency fund check">
      <div className="buffer-check-head">
        <span aria-hidden="true">{months >= TARGET_MONTHS ? '🛟' : '⚠️'}</span>
        <div>
          <strong>{headline}</strong>
          <p>
            Your cash of {money(cash)} covers about <b>{months < 10 ? months.toFixed(1) : Math.round(months)} months</b> of outgoings ({money(monthlyOut)} a month).
            {' '}A common rule of thumb is 3 to 6 months set aside for surprises such as losing a job or a big repair.
            {toTarget > 0 && <> About <b>{money(toTarget)}</b> more would reach 3 months.</>}
          </p>
        </div>
      </div>
      <div className="buffer-meter" role="img" aria-label={`${months.toFixed(1)} months of outgoings covered; target 3 to 6 months`}>
        <span className="buffer-fill" style={{ width: `${fill}%` }} />
        <span className="buffer-target" style={{ left: `${(TARGET_MONTHS / 8) * 100}%`, width: `${((STRONG_MONTHS - TARGET_MONTHS) / 8) * 100}%` }} />
      </div>
      <div className="buffer-scale" aria-hidden="true"><span>0</span><span>3 months</span><span>6 months</span><span>8+</span></div>
      {result.inputs.country === 'NZ' && months < TARGET_MONTHS && (
        <p className="buffer-tip">
          Tip: Sorted&apos;s free <a href="https://sorted.org.nz/tools" target="_blank" rel="noopener noreferrer">Buffer builder app ↗</a> can set money aside automatically each payday.
        </p>
      )}
    </section>
  );
}
