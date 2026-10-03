'use client';

import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fxFor, retirementCurrency, type HouseholdResult } from '../lib/finance/household';
import type { Finding, HouseholdAnalysis } from '../lib/finance/householdAnalysis';
import { COUNTRIES, moneyFor, type CountryCode } from '../lib/countries';

const compact = (n: number) => new Intl.NumberFormat('en-NZ', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const COLORS = { line: '#53634f', range: '#c9d3c1', liquid: '#087e8b', goal: '#c77957', retire: '#737a70', grid: '#e4e7de', tick: '#737a70' };

/** Net worth band (Low to High), expected net worth, and cash plus investments. */
export function HouseholdChart({ result, height = 300 }: { result: HouseholdResult; height?: number }) {
  const money = moneyFor(result.inputs.country);
  const [low, mid, high] = result.scenarios;
  const data = mid.series.map((p, k) => ({
    age: p.age,
    expected: Math.round(p.netWorth),
    liquid: Math.round(p.liquid),
    range: [Math.round(low.series[k].netWorth), Math.round(high.series[k].netWorth)],
  }));
  return (
    <figure className="projection-figure">
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 18, right: 18, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="age" tick={{ fill: COLORS.tick, fontSize: 11 }} tickLine={false} />
            <YAxis tickFormatter={compact} tick={{ fill: COLORS.tick, fontSize: 11 }} width={52} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(val, label) =>
                Array.isArray(val)
                  ? [`${money(Number(val[0]))} – ${money(Number(val[1]))}`, 'Net worth, low to high']
                  : [money(Number(val ?? 0)), String(label)]
              }
              labelFormatter={(a) => `Age ${a}`}
            />
            <Area dataKey="range" stroke="none" fill={COLORS.range} fillOpacity={0.75} name="Net worth, low to high" isAnimationActive={false} />
            <Line dataKey="expected" stroke={COLORS.line} strokeWidth={2.5} dot={false} name="Net worth (expected)" isAnimationActive={false} />
            <Line dataKey="liquid" stroke={COLORS.liquid} strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Cash and investments" isAnimationActive={false} />
            <ReferenceLine x={result.retirementAge} stroke={COLORS.retire} strokeDasharray="4 4"
              label={{ value: 'Retire', fill: COLORS.retire, fontSize: 11, position: 'top' }} />
            {result.goal && (
              <ReferenceLine y={result.goal.target} stroke={COLORS.goal} strokeWidth={1.5}
                label={{ value: 'Goal', fill: COLORS.goal, fontSize: 11, position: 'insideTopLeft' }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Today&apos;s money. Solid line: expected net worth, with the low-to-high range shaded. Dashed line: cash and
        investments you can spend (property not included).
      </figcaption>
    </figure>
  );
}

export function HouseholdHeadline({ result }: { result: HouseholdResult }) {
  const money = moneyFor(result.inputs.country);
  const mid = result.scenarios[1];
  const atRet = result.milestones.find((m) => m.age === result.retirementAge);
  const goal = result.goal;
  return (
    <div className="projection-summary">
      <p className="projection-headline">
        {atRet ? (
          <>At {result.retirementAge}, expected net worth is about <strong>{money(atRet.expected)}</strong> in today&apos;s money, including <strong>{money(atRet.liquid)}</strong> in cash and investments.</>
        ) : (
          <>Net worth today is <strong>{money(result.today.netWorth)}</strong>.</>
        )}
      </p>
      {atRet && result.inputs.retireIn && result.inputs.retireIn !== result.inputs.country && (() => {
        const cur = retirementCurrency(result.inputs);
        const months = (result.retirementAge - result.inputs.you.currentAge) * 12;
        const rate = fxFor(result.inputs).at(cur, months);
        const there = moneyFor(result.inputs.retireIn);
        return (
          <p className="projection-goal">
            In {COUNTRIES[result.inputs.retireIn].name}, that is about <strong>{there(atRet.expected / rate)}</strong> net worth and{' '}
            <strong>{there(atRet.liquid / rate)}</strong> in cash and investments, at the exchange rate expected then.
          </p>
        );
      })()}
      {goal && (
        <p className="projection-goal">
          {goal.onTrack
            ? `That reaches your ${money(goal.target)} goal by age ${goal.targetAge} in the expected case.`
            : `That is ${money(goal.gap)} short of your ${money(goal.target)} goal at age ${goal.targetAge}. The range is ${money(goal.low)} to ${money(goal.high)}.`}
        </p>
      )}
      {result.monteCarlo.runs > 0 && (
        <p className="projection-goal">
          In {result.monteCarlo.runs} simulated markets with {result.monteCarlo.volatilityPct}% yearly swings, spending was
          covered to age {result.inputs.endAge} in <strong>{Math.round(result.monteCarlo.successRate * 100)}%</strong> of them
          {result.monteCarlo.goalProbability !== null && <>, and the goal was reached in {Math.round(result.monteCarlo.goalProbability * 100)}%</>}.
        </p>
      )}
      <p className="projection-goal">
        {mid.shortfallAge === null
          ? `In the expected case, cash and investments cover spending to age ${result.inputs.endAge}.`
          : `In the expected case, cash and investments run out at about age ${mid.shortfallAge}.`}
      </p>
    </div>
  );
}

export function HouseholdMilestones({ result }: { result: HouseholdResult }) {
  const money = moneyFor(result.inputs.country);
  if (!result.milestones.length) return null;
  const couple = Boolean(result.inputs.partner);
  return (
    <div className="table-scroll">
      <table className="milestone-table">
        <caption>Net worth at each age, in today&apos;s money</caption>
        <thead>
          <tr>
            <th scope="col">{couple ? 'Your age (partner)' : 'Age'}</th>
            <th scope="col">Low</th>
            <th scope="col">Expected</th>
            <th scope="col">High</th>
            <th scope="col">Cash and investments</th>
          </tr>
        </thead>
        <tbody>
          {result.milestones.map((m) => (
            <tr key={m.age}>
              <th scope="row">{m.age}{couple && m.partnerAge !== null ? ` (${Math.round(m.partnerAge)})` : ''}</th>
              <td>{money(m.low)}</td>
              <td className="is-expected">{money(m.expected)}</td>
              <td>{money(m.high)}</td>
              <td>{money(m.liquid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HouseholdComparison({ result }: { result: HouseholdResult }) {
  const money = moneyFor(result.inputs.country);
  if (!result.comparison?.length) return null;
  const hasGoal = Boolean(result.goal);
  return (
    <div className="table-scroll">
      <table className="milestone-table">
        <caption>Return assumptions side by side (expected case, today&apos;s money)</caption>
        <thead>
          <tr>
            <th scope="col">Assumption</th>
            <th scope="col">Return</th>
            <th scope="col">Net worth at {result.retirementAge}</th>
            <th scope="col">Cash and investments at {result.retirementAge}</th>
            <th scope="col">Money runs out</th>
            {hasGoal && <th scope="col">Goal met</th>}
          </tr>
        </thead>
        <tbody>
          {result.comparison.map((c) => (
            <tr key={c.label}>
              <th scope="row">{c.label}</th>
              <td>{c.investmentReturnPct}%</td>
              <td className="is-expected">{money(c.atRetirement)}</td>
              <td>{money(c.liquidAtRetirement)}</td>
              <td>{c.shortfallAge === null ? 'No' : `Age ${c.shortfallAge}`}</td>
              {hasGoal && <td>{c.meetsGoal ? 'Yes' : 'No'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HouseholdWarnings({ result }: { result: HouseholdResult }) {
  if (!result.warnings.length) return null;
  return (
    <ul className="planner-warnings">
      {result.warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}


const MIX_COLORS = ['#53634f', '#c77957', '#4f7fa8', '#b58a1e', '#8a6aa8', '#5f9e8f', '#9a9a8a'];

/** One horizontal bar split into labelled slices. */
function MixBar({ title, slices, money }: { title: string; slices: HouseholdAnalysis['mix']['byAsset']; money: (n: number) => string }) {
  if (!slices.length) return null;
  return (
    <div className="mix-row">
      <p className="mix-title">{title}</p>
      <div className="mix-bar" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(', ')}`}>
        {slices.map((s, i) => <span key={s.label} style={{ width: `${s.share * 100}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} title={`${s.label}: ${money(s.value)}`} />)}
      </div>
      <ul className="mix-legend">
        {slices.map((s, i) => (
          <li key={s.label}><i style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />{s.label} <b>{Math.round(s.share * 100)}%</b> <small>{money(s.value)}</small></li>
        ))}
      </ul>
    </div>
  );
}

/** What the household owns, three ways, from the figures entered. */
export function PortfolioMixView({ mix, country }: { mix: HouseholdAnalysis['mix']; country: CountryCode }) {
  const money = moneyFor(country);
  if (!mix.byAsset.length) return null;
  return (
    <div className="portfolio-mix">
      <h3>Your portfolio mix</h3>
      <MixBar title="What you own" slices={mix.byAsset} money={money} />
      <MixBar title="Your investments by type" slices={mix.byInvestmentType} money={money} />
      <MixBar title="Growth or defensive (estimated)" slices={mix.growthDefensive} money={money} />
      <MixBar title="By currency" slices={mix.byCurrency} money={money} />
      <p className="asset-editor-note">
        {mix.feesPerYear > 0 && <>Your investments cost about <b>{money(mix.feesPerYear)}</b> a year in fees at today&apos;s balances. </>}
        Growth or defensive is estimated from each investment&apos;s type and expected growth. This looks at what you entered;
        it doesn&apos;t look inside each fund at its holdings, sectors or regions (that needs licensed fund data). Your fund&apos;s fact sheet shows its actual mix.
      </p>
    </div>
  );
}

/** Strengths, weaknesses, risks and measured levers. Education, not recommendations. */
export function HouseholdAnalysisView({ analysis, country }: { analysis: HouseholdAnalysis; country: CountryCode }) {
  const money = moneyFor(country);
  const signed = (n: number) => (Math.abs(n) < 1 ? '—' : `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`);
  const groups: [string, string, Finding[]][] = [
    ['Strengths', 'is-strength', analysis.strengths],
    ['Weaknesses', 'is-weakness', analysis.weaknesses],
    ['Risks to watch', 'is-risk', analysis.risks],
  ];
  const b = analysis.baseline;
  return (
    <section className="portfolio-analysis" aria-labelledby="analysis-title">
      <h2 id="analysis-title">Portfolio analysis</h2>
      {analysis.mix && <PortfolioMixView mix={analysis.mix} country={country} />}
      <div className="analysis-groups">
        {groups.map(([title, tone, items]) => items.length ? (
          <div className={`analysis-group ${tone}`} key={title}>
            <h3>{title}</h3>
            <ul>{items.map((f) => <li key={f.title}><strong>{f.title}.</strong> {f.detail}</li>)}</ul>
          </div>
        ) : null)}
      </div>

      {analysis.levers.length > 0 && (
        <div className="analysis-levers">
          <h3>Levers to explore</h3>
          <p className="asset-editor-note">
            Each row re-runs your whole plan with one change, in the expected case and today&apos;s money. These show
            trade-offs, not recommendations. A licensed financial adviser can tell you what suits you.
          </p>
          <div className="table-scroll">
            <table className="milestone-table">
              <thead>
                <tr>
                  <th scope="col">Change</th>
                  <th scope="col">Money runs out</th>
                  <th scope="col">Cash and investments at {b.endAge}</th>
                  <th scope="col">Net worth at {b.endAge}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Your plan as entered</th>
                  <td>{b.runsOutAge === null ? 'Lasts' : `Age ${b.runsOutAge}`}</td>
                  <td>{money(b.liquidAtEnd)}</td>
                  <td>{money(b.netWorthAtEnd)}</td>
                </tr>
                {analysis.levers.map((l) => (
                  <tr key={l.title}>
                    <th scope="row">
                      {l.title}
                      <small className="lever-detail">{l.change}. Trade-off: {l.tradeOff}</small>
                    </th>
                    <td className={l.runsOutAge === null || (b.runsOutAge !== null && l.runsOutAge > b.runsOutAge) ? 'is-expected' : l.runsOutAge !== b.runsOutAge ? 'is-debt' : undefined}>
                      {l.runsOutAge === null ? 'Lasts' : `Age ${l.runsOutAge}`}
                    </td>
                    <td className={l.liquidDelta > 0 ? 'is-expected' : l.liquidDelta < 0 ? 'is-debt' : undefined}>{signed(l.liquidDelta)}</td>
                    <td className={l.netWorthDelta > 0 ? 'is-expected' : l.netWorthDelta < 0 ? 'is-debt' : undefined}>{signed(l.netWorthDelta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
