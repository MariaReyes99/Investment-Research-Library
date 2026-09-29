'use client';

import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ProjectionResult } from '../lib/finance/projections';

export const money = (n: number) =>
  new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n);
const compact = (n: number) =>
  new Intl.NumberFormat('en-NZ', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const COLORS = { line: '#53634f', range: '#c9d3c1', goal: '#c77957', retire: '#737a70', grid: '#e4e7de', tick: '#737a70' };

/** Low–high band, expected line, retirement marker and goal line, in today's dollars. */
export function ProjectionChart({ result, height = 280 }: { result: ProjectionResult; height?: number }) {
  const [low, base, high] = result.scenarios;
  const data = base.series.map((p, k) => ({
    age: p.age,
    expected: Math.round(p.real),
    range: [Math.round(low.series[k].real), Math.round(high.series[k].real)],
  }));
  const goal = result.goal;

  return (
    <figure className="projection-figure">
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 18, right: 18, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="age" tick={{ fill: COLORS.tick, fontSize: 11 }} tickLine={false} />
            <YAxis tickFormatter={compact} tick={{ fill: COLORS.tick, fontSize: 11 }} width={52} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(val, name) =>
                Array.isArray(val)
                  ? [`${money(Number(val[0]))} – ${money(Number(val[1]))}`, 'Low to high']
                  : [money(Number(val ?? 0)), String(name)]
              }
              labelFormatter={(a) => `Age ${a}`}
            />
            <Area dataKey="range" stroke="none" fill={COLORS.range} fillOpacity={0.75} name="Low to high" isAnimationActive={false} />
            <Line dataKey="expected" stroke={COLORS.line} strokeWidth={2.5} dot={false} name="Expected" isAnimationActive={false} />
            <ReferenceLine
              x={result.inputs.retirementAge}
              stroke={COLORS.retire}
              strokeDasharray="4 4"
              label={{ value: 'Retire', fill: COLORS.retire, fontSize: 11, position: 'top' }}
            />
            {goal && (
              <ReferenceLine
                y={goal.targetReal}
                stroke={COLORS.goal}
                strokeWidth={1.5}
                label={{ value: 'Goal', fill: COLORS.goal, fontSize: 11, position: 'insideTopLeft' }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Today&apos;s dollars. Shaded band: returns {low.netReturnPct}% to {high.netReturnPct}% a year after fees; line: {base.netReturnPct}%.
      </figcaption>
    </figure>
  );
}

/** Milestone table: balances at ages 55/60/65/70 for each scenario. */
export function MilestoneTable({ result }: { result: ProjectionResult }) {
  if (!result.milestones.length) return null;
  const [low, base, high] = result.scenarios;
  return (
    <div className="table-scroll">
      <table className="milestone-table">
        <caption>Balance at each age, in today&apos;s dollars</caption>
        <thead>
          <tr>
            <th scope="col">Age</th>
            <th scope="col">Low ({low.netReturnPct}%)</th>
            <th scope="col">Expected ({base.netReturnPct}%)</th>
            <th scope="col">High ({high.netReturnPct}%)</th>
          </tr>
        </thead>
        <tbody>
          {result.milestones.map((m) => (
            <tr key={m.age}>
              <th scope="row">{m.age}</th>
              <td>{money(m.low)}</td>
              <td className="is-expected">{money(m.base)}</td>
              <td>{money(m.high)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One-sentence summary of the Expected case and the goal. */
export function ProjectionSummary({ result }: { result: ProjectionResult }) {
  const base = result.scenarios[1];
  const goal = result.goal;
  return (
    <div className="projection-summary">
      <p className="projection-headline">
        At {result.inputs.retirementAge} you could have about <strong>{money(base.atRetirement.real)}</strong> in
        today&apos;s dollars, enough for roughly <strong>{money(base.sustainableIncomeReal)}</strong> a year at a{' '}
        {result.inputs.withdrawalRatePct}% withdrawal rate.
      </p>
      {goal && (
        <p className="projection-goal">
          {goal.onTrack
            ? `On these assumptions you would reach your goal of ${money(goal.targetReal)} by age ${goal.targetAge}. `
            : `That is ${money(goal.gapReal)} short of the ${money(goal.targetReal)} your goal needs by age ${goal.targetAge}. ${
                goal.requiredMonthlyContribution != null
                  ? `Contributing about ${money(goal.requiredMonthlyContribution)} a month would close the gap in the expected case. `
                  : ''
              }`}
          The goal was met in {Math.round(goal.probabilityOfSuccess * 100)}% of 2,000 simulated markets.
        </p>
      )}
      {base.depletionAge !== null && (
        <p className="projection-goal">
          At that income, the expected case runs out of money at age {base.depletionAge}.
        </p>
      )}
    </div>
  );
}
