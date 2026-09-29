'use client';
/**
 * Wealth projector. Runs entirely in the browser: the numbers entered here are
 * never sent to the server or stored.
 */
import { useMemo, useState } from 'react';
import { projectWealth, type ProjectionAssetInput, type ProjectionDebtInput, type ProjectionInput } from '../lib/finance/projections';
import { MilestoneTable, money, ProjectionChart, ProjectionSummary } from './ProjectionChart';

type Key =
  | 'currentAge' | 'retirementAge' | 'inflationPct' | 'contributionGrowthPct' | 'withdrawalRatePct' | 'volatilityPct'
  | 'monthlyHouseholdIncome' | 'monthlyLivingExpenses';

type AssetKind = NonNullable<ProjectionInput['assets']>[number]['kind'];
type FundType = NonNullable<ProjectionAssetInput['fundType']>;
type AssetDraft = {
  id: string;
  name: string;
  kind: AssetKind;
  provider: string;
  fundType: FundType;
  currentBalance: number;
  monthlyContribution: number;
  expectedReturnPct: number;
  feesPct: number;
  taxDragPct: number;
  growthEnabled: boolean;
  incomeEligible: boolean;
};
type DebtKind = ProjectionDebtInput['kind'];
type DebtDraft = {
  id: string;
  name: string;
  kind: DebtKind;
  assetId?: string;
  currentBalance: number;
  annualInterestPct: number;
  monthlyPayment: number;
};

type Field = { key: Key; label: string; step: number; unit?: string; hint?: string };

const MAIN: Field[] = [
  { key: 'currentAge', label: 'Your age', step: 1 },
  { key: 'retirementAge', label: 'Retire at', step: 1 },
];
const CASHFLOW: Field[] = [
  { key: 'monthlyHouseholdIncome', label: 'After-tax household income', step: 100, unit: 'NZD / month' },
  { key: 'monthlyLivingExpenses', label: 'Living expenses (excluding debt payments)', step: 100, unit: 'NZD / month' },
];
const MORE: Field[] = [
  { key: 'inflationPct', label: 'Inflation', step: 0.1, unit: '% a year' },
  { key: 'contributionGrowthPct', label: 'Contributions rise by', step: 0.5, unit: '% a year', hint: 'For example, pay rises' },
  { key: 'withdrawalRatePct', label: 'Withdrawal rate in retirement', step: 0.25, unit: '%', hint: 'See the note on safe withdrawal rates' },
  { key: 'volatilityPct', label: 'Market volatility', step: 0.5, unit: '% a year', hint: 'Used for the illustrative chance-of-goal estimate' },
];

const ASSET_LABELS: Record<AssetKind, string> = {
  kiwisaver: 'KiwiSaver', shares: 'Shares / ETF', property: 'Property', cash: 'Cash / term deposit', bonds: 'Bonds',
  vehicle: 'Vehicle', jewelry: 'Jewellery', business: 'Business', other: 'Other asset',
};
const ASSET_VALUE_LABELS: Record<AssetKind, string> = {
  kiwisaver: 'Current balance', shares: 'Current market value', property: 'Current market value',
  cash: 'Current balance', bonds: 'Current market value', vehicle: 'Estimated resale value',
  jewelry: 'Estimated resale value', business: 'Estimated market value', other: 'Current estimated value',
};
const ASSET_RETURN_LABELS: Record<AssetKind, string> = {
  kiwisaver: 'Assumed gross return', shares: 'Assumed gross return', property: 'Assumed property value change',
  cash: 'Assumed interest rate', bonds: 'Assumed gross return', vehicle: 'Assumed annual value change',
  jewelry: 'Assumed annual value change', business: 'Assumed annual value change', other: 'Assumed annual value change',
};
const CONTRIBUTION_ASSET_KINDS: AssetKind[] = ['kiwisaver', 'shares', 'cash', 'bonds'];
const DEBT_LABELS: Record<DebtKind, string> = {
  mortgage: 'Mortgage', vehicle: 'Vehicle loan', personal: 'Personal loan', student: 'Student loan',
  credit: 'Credit card / revolving credit', business: 'Business loan', other: 'Other debt',
};
const FUND_LABELS: Record<FundType, string> = {
  defensive: 'Defensive', conservative: 'Conservative', balanced: 'Balanced', growth: 'Growth', aggressive: 'Aggressive',
};
const FUND_RETURNS: Record<FundType, number> = { defensive: 3, conservative: 4, balanced: 5, growth: 6, aggressive: 7 };
const ASSET_RETURNS: Record<Exclude<AssetKind, 'kiwisaver'>, number> = {
  shares: 7, property: 4, cash: 3, bonds: 4, vehicle: -8, jewelry: 0, business: 4, other: 0,
};

function newAsset(kind: AssetKind, id: string, index: number): AssetDraft {
  const fundType: FundType = 'balanced';
  return {
    id,
    name: kind === 'kiwisaver' ? 'KiwiSaver' : `${ASSET_LABELS[kind]} ${index}`,
    kind,
    provider: '',
    fundType,
    currentBalance: index === 1 ? 500_000 : 0,
    monthlyContribution: index === 1 ? 1_500 : 0,
    expectedReturnPct: kind === 'kiwisaver' ? FUND_RETURNS[fundType] : ASSET_RETURNS[kind],
    feesPct: kind === 'cash' || kind === 'other' ? 0 : 0.5,
    taxDragPct: 0,
    growthEnabled: kind !== 'other' && kind !== 'jewelry',
    incomeEligible: ['kiwisaver', 'shares', 'cash', 'bonds'].includes(kind),
  };
}

function newDebt(kind: DebtKind, id: string, index: number, assetId?: string): DebtDraft {
  return {
    id,
    name: `${DEBT_LABELS[kind]} ${index}`,
    kind,
    assetId,
    currentBalance: 0,
    annualInterestPct: kind === 'mortgage' ? 6 : kind === 'student' ? 0 : 10,
    monthlyPayment: 0,
  };
}

function NumberField({ f, value, onChange, id }: { f: Field; value: number; onChange: (v: number) => void; id?: string }) {
  const inputId = id ?? `field-${f.key}`;
  return (
    <div className="calc-field">
      <label htmlFor={inputId}>{f.label}</label>
      <div className="calc-input">
        <input id={inputId} type="number" inputMode="decimal" step={f.step} value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {f.unit && <span>{f.unit}</span>}
      </div>
      {f.hint && <small>{f.hint}</small>}
    </div>
  );
}

export default function WealthProjector() {
  const [v, setV] = useState<Record<Key, number>>({
    currentAge: 48, retirementAge: 65, inflationPct: 2.5, contributionGrowthPct: 2, withdrawalRatePct: 4, volatilityPct: 15,
    monthlyHouseholdIncome: 0, monthlyLivingExpenses: 0,
  });
  const [assets, setAssets] = useState<AssetDraft[]>([newAsset('kiwisaver', 'asset-1', 1)]);
  const [newAssetKind, setNewAssetKind] = useState<AssetKind>('shares');
  const [debts, setDebts] = useState<DebtDraft[]>([]);
  const [newDebtKind, setNewDebtKind] = useState<DebtKind>('mortgage');
  const [goalType, setGoalType] = useState<'income' | 'balance' | 'none'>('income');
  const [goalValue, setGoalValue] = useState(60_000);

  const { result, error } = useMemo(() => {
    if (Object.values(v).some((n) => !Number.isFinite(n)) || assets.some((asset) =>
      !Number.isFinite(asset.currentBalance) || !Number.isFinite(asset.monthlyContribution) ||
      !Number.isFinite(asset.expectedReturnPct) || !Number.isFinite(asset.feesPct) || !Number.isFinite(asset.taxDragPct)) ||
      debts.some((debt) => !Number.isFinite(debt.currentBalance) || !Number.isFinite(debt.annualInterestPct) || !Number.isFinite(debt.monthlyPayment))) {
      return { result: null, error: 'Fill in every field to see a projection.' };
    }
    try {
      const currentSavings = assets.reduce((sum, asset) => sum + asset.currentBalance, 0);
      const monthlyContribution = assets.reduce((sum, asset) => sum + asset.monthlyContribution, 0);
      const weightTotal = assets.reduce((sum, asset) => sum + asset.currentBalance + asset.monthlyContribution * 12, 0);
      const weightedReturn = weightTotal > 0
        ? assets.reduce((sum, asset) => sum + (asset.currentBalance + asset.monthlyContribution * 12) * asset.expectedReturnPct, 0) / weightTotal
        : 0;
      const projectionAssets: ProjectionAssetInput[] = assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        provider: asset.provider || undefined,
        fundType: asset.kind === 'kiwisaver' ? asset.fundType : undefined,
        currentBalance: asset.currentBalance,
        monthlyContribution: asset.monthlyContribution,
        expectedReturnPct: asset.expectedReturnPct,
        feesPct: asset.feesPct,
        taxDragPct: asset.taxDragPct,
        growthEnabled: asset.growthEnabled,
        incomeEligible: asset.incomeEligible,
      }));
      const projectionDebts: ProjectionDebtInput[] = debts.map((debt) => ({
        id: debt.id,
        name: debt.name,
        kind: debt.kind,
        assetId: debt.assetId,
        currentBalance: debt.currentBalance,
        annualInterestPct: debt.annualInterestPct,
        monthlyPayment: debt.monthlyPayment,
      }));
      const input: ProjectionInput = {
        ...v,
        currentSavings,
        monthlyContribution,
        expectedReturnPct: weightedReturn,
        feesPct: 0,
        assets: projectionAssets,
        debts: projectionDebts,
        goal: goalType === 'none' ? undefined : goalType === 'balance' ? { targetAmount: goalValue } : { desiredAnnualIncome: goalValue },
      };
      return { result: projectWealth(input), error: null };
    } catch (e) {
      const issue = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues?.[0];
      return { result: null, error: issue ? `${issue.path.join(' ')}: ${issue.message}` : 'Check your numbers.' };
    }
  }, [v, assets, debts, goalType, goalValue]);

  const set = (k: Key) => (n: number) => setV((prev) => ({ ...prev, [k]: n }));
  const updateAsset = (id: string, update: Partial<AssetDraft>) =>
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...update } : asset));
  const addAsset = () => setAssets((current) => [...current, newAsset(newAssetKind, `asset-${Date.now()}`, current.length + 1)]);
  const updateDebt = (id: string, update: Partial<DebtDraft>) =>
    setDebts((current) => current.map((debt) => debt.id === id ? { ...debt, ...update } : debt));
  const addDebt = () => {
    const linkedKind: AssetKind | undefined = newDebtKind === 'mortgage'
      ? 'property'
      : newDebtKind === 'vehicle'
        ? 'vehicle'
        : newDebtKind === 'business'
          ? 'business'
          : undefined;
    const linkedAsset = linkedKind ? assets.find((asset) => asset.kind === linkedKind) : undefined;
    setDebts((current) => [...current, newDebt(newDebtKind, `debt-${Date.now()}`, current.length + 1, linkedAsset?.id)]);
  };

  return (
    <div className="calc-layout">
      <form className="calc-form" onSubmit={(e) => e.preventDefault()} aria-label="Projection inputs">
        {MAIN.map((f) => <NumberField key={f.key} f={f} value={v[f.key]} onChange={set(f.key)} />)}

        <fieldset className="cashflow-editor">
          <legend>Monthly household cashflow</legend>
          <p>Enter take-home income and non-debt living costs. Debt payments and investments are counted from their entries below.</p>
          {CASHFLOW.map((f) => <NumberField key={f.key} f={f} value={v[f.key]} onChange={set(f.key)} />)}
        </fieldset>

        <fieldset className="asset-editor">
          <legend>Assets in your projection</legend>
          <p className="asset-editor-note">Returns are editable illustrations, not live provider performance. Each balance stays on this device.</p>
          <div className="asset-list">
            {assets.map((asset) => (
              <section className="asset-card" key={asset.id} aria-label={`${ASSET_LABELS[asset.kind]} asset`}>
                <div className="asset-card-heading">
                  <label className="asset-kind-label">
                    <span>Asset type</span>
                    <select value={asset.kind} onChange={(e) => {
                      const kind = e.target.value as AssetKind;
                      const next = newAsset(kind, asset.id, 1);
                      updateAsset(asset.id, {
                        ...next,
                        name: kind === 'kiwisaver' ? 'KiwiSaver' : ASSET_LABELS[kind],
                        currentBalance: asset.currentBalance,
                        monthlyContribution: CONTRIBUTION_ASSET_KINDS.includes(kind) ? asset.monthlyContribution : 0,
                      });
                    }}>
                      {Object.entries(ASSET_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                    </select>
                  </label>
                  <button type="button" className="asset-remove" aria-label={`Remove ${asset.name}`} title="Remove asset"
                    disabled={assets.length === 1} onClick={() => {
                      setAssets((current) => current.filter((item) => item.id !== asset.id));
                      setDebts((current) => current.map((debt) => debt.assetId === asset.id ? { ...debt, assetId: undefined } : debt));
                    }}>×</button>
                </div>

                <label className="calc-field">
                  <span>Asset name</span>
                  <span className="calc-input"><input value={asset.name} maxLength={80} onChange={(e) => updateAsset(asset.id, { name: e.target.value })} /></span>
                </label>
                {asset.kind === 'kiwisaver' && (
                  <>
                    <label className="calc-field">
                      <span>KiwiSaver provider</span>
                      <span className="calc-input"><input value={asset.provider} placeholder="Enter provider" maxLength={80}
                        onChange={(e) => updateAsset(asset.id, { provider: e.target.value })} /></span>
                    </label>
                    <label className="calc-field">
                      <span>Fund type</span>
                      <select value={asset.fundType} onChange={(e) => {
                        const fundType = e.target.value as FundType;
                        updateAsset(asset.id, { fundType, expectedReturnPct: FUND_RETURNS[fundType] });
                      }}>
                        {Object.entries(FUND_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                      </select>
                    </label>
                  </>
                )}

                <NumberField id={`${asset.id}-balance`} f={{ key: 'currentAge', label: ASSET_VALUE_LABELS[asset.kind], step: 1000, unit: 'NZD' }} value={asset.currentBalance}
                  onChange={(value) => updateAsset(asset.id, { currentBalance: value })} />
                {CONTRIBUTION_ASSET_KINDS.includes(asset.kind) && (
                  <NumberField id={`${asset.id}-contribution`} f={{ key: 'currentAge', label: 'Monthly contribution', step: 50, unit: 'NZD' }} value={asset.monthlyContribution}
                    onChange={(value) => updateAsset(asset.id, { monthlyContribution: value })} />
                )}
                <NumberField id={`${asset.id}-return`} f={{ key: 'currentAge', label: ASSET_RETURN_LABELS[asset.kind], step: 0.25, unit: '% a year' }} value={asset.expectedReturnPct}
                  onChange={(value) => updateAsset(asset.id, { expectedReturnPct: value })} />

                <details className="asset-advanced">
                  <summary>Fees and tax assumptions</summary>
                  <NumberField id={`${asset.id}-fees`} f={{ key: 'currentAge', label: 'Fees', step: 0.05, unit: '% a year' }} value={asset.feesPct}
                    onChange={(value) => updateAsset(asset.id, { feesPct: value })} />
                  <NumberField id={`${asset.id}-tax`} f={{ key: 'currentAge', label: 'Tax drag', step: 0.05, unit: '% a year' }} value={asset.taxDragPct}
                    onChange={(value) => updateAsset(asset.id, { taxDragPct: value })} />
                </details>

                <label className="asset-growth-toggle">
                  <input type="checkbox" checked={asset.growthEnabled} onChange={(e) => updateAsset(asset.id, { growthEnabled: e.target.checked })} />
                  <span>Include future growth</span>
                </label>
                <label className="asset-growth-toggle income-toggle">
                  <input type="checkbox" checked={asset.incomeEligible} onChange={(e) => updateAsset(asset.id, { incomeEligible: e.target.checked })} />
                  <span>Count toward retirement income</span>
                </label>
              </section>
            ))}
          </div>

          <div className="asset-add-row">
            <label className="sr-only" htmlFor="new-asset-kind">New asset type</label>
            <select id="new-asset-kind" value={newAssetKind} onChange={(e) => setNewAssetKind(e.target.value as AssetKind)}>
              {Object.entries(ASSET_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
            <button type="button" className="asset-add-button" onClick={addAsset}>+ Add asset</button>
          </div>
          <p className="asset-total">Assets: {money(assets.reduce((sum, asset) => sum + asset.currentBalance, 0))} now · {money(assets.reduce((sum, asset) => sum + asset.monthlyContribution, 0))} per month</p>
          {assets.some((asset) => asset.kind === 'property') && <p className="asset-editor-note">Mortgage payments belong under Debts and reduce the linked loan balance; don&apos;t also enter them as property contributions.</p>}
        </fieldset>

        <fieldset className="debt-editor">
          <legend>Debts and liabilities</legend>
          <p className="asset-editor-note">Enter the balance, interest rate and payment. Link a secured debt to its asset to show equity; all debts reduce total net worth whether linked or not.</p>
          {debts.length > 0 && (
            <div className="debt-list">
              {debts.map((debt) => (
                <section className="debt-card" key={debt.id} aria-label={`${debt.name} liability`}>
                  <div className="asset-card-heading">
                    <label className="asset-kind-label">
                      <span>Debt type</span>
                      <select value={debt.kind} onChange={(e) => {
                        const kind = e.target.value as DebtKind;
                        updateDebt(debt.id, { kind, name: DEBT_LABELS[kind] });
                      }}>
                        {Object.entries(DEBT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                      </select>
                    </label>
                    <button type="button" className="asset-remove" aria-label={`Remove ${debt.name}`} title="Remove debt"
                      onClick={() => setDebts((current) => current.filter((item) => item.id !== debt.id))}>×</button>
                  </div>
                  <label className="calc-field">
                    <span>Debt name</span>
                    <span className="calc-input"><input value={debt.name} maxLength={80} onChange={(e) => updateDebt(debt.id, { name: e.target.value })} /></span>
                  </label>
                  <label className="calc-field">
                    <span>Linked asset (optional)</span>
                    <select value={debt.assetId ?? ''} onChange={(e) => updateDebt(debt.id, { assetId: e.target.value || undefined })}>
                      <option value="">General / unlinked debt</option>
                      {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    </select>
                  </label>
                  <NumberField id={`${debt.id}-balance`} f={{ key: 'currentAge', label: 'Remaining balance', step: 1000, unit: 'NZD' }} value={debt.currentBalance}
                    onChange={(value) => updateDebt(debt.id, { currentBalance: value })} />
                  <NumberField id={`${debt.id}-interest`} f={{ key: 'currentAge', label: 'Interest rate', step: 0.1, unit: '% a year' }} value={debt.annualInterestPct}
                    onChange={(value) => updateDebt(debt.id, { annualInterestPct: value })} />
                  <NumberField id={`${debt.id}-payment`} f={{ key: 'currentAge', label: 'Monthly payment', step: 50, unit: 'NZD' }} value={debt.monthlyPayment}
                    onChange={(value) => updateDebt(debt.id, { monthlyPayment: value })} />
                </section>
              ))}
            </div>
          )}
          <div className="asset-add-row">
            <label className="sr-only" htmlFor="new-debt-kind">New debt type</label>
            <select id="new-debt-kind" value={newDebtKind} onChange={(e) => setNewDebtKind(e.target.value as DebtKind)}>
              {Object.entries(DEBT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
            <button type="button" className="asset-add-button debt-add-button" onClick={addDebt}>+ Add debt</button>
          </div>
        </fieldset>

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
            <section className="net-worth-panel" aria-label="Household net worth summary">
              <div className="net-worth-current">
                <span>Assets today</span>
                <strong>{money(assets.reduce((sum, asset) => sum + asset.currentBalance, 0))}</strong>
                <small>{assets.some((asset) => asset.kind === 'property') ? 'Property market value included' : 'Add a Property asset below to include its market value'}</small>
              </div>
              <div className="net-worth-debt-current">
                <span>Debts today</span>
                <strong>{money(debts.reduce((sum, debt) => sum + debt.currentBalance, 0))}</strong>
                <small>All entered liabilities</small>
              </div>
              <div className="net-worth-future">
                <span>Net worth today</span>
                <strong>{money(result.currentNetWorth)}</strong>
                <small>Assets minus debts</small>
              </div>
              <div className="net-worth-retirement">
                <span>At age {v.retirementAge}</span>
                <strong>{money(result.scenarios[1].atRetirement.real)}</strong>
                <small>Expected net worth in today&apos;s dollars</small>
              </div>
            </section>
            {v.monthlyHouseholdIncome === 0 && v.monthlyLivingExpenses === 0 ? (
              <p className="cashflow-prompt">Add take-home income and living costs to check the amount left after monthly debt payments and investing.</p>
            ) : (
              <section className={`cashflow-summary${result.monthlyCashflow.remaining < 0 ? ' is-shortfall' : ''}`} aria-label="Monthly cashflow result">
                <div><span>Take-home income</span><strong>{money(result.monthlyCashflow.householdIncome)}</strong></div>
                <div><span>Living costs</span><strong>−{money(result.monthlyCashflow.livingExpenses)}</strong></div>
                <div><span>Debt payments</span><strong>−{money(result.monthlyCashflow.debtPayments)}</strong></div>
                <div><span>Invested</span><strong>−{money(result.monthlyCashflow.investmentContributions)}</strong></div>
                <div className="cashflow-remaining"><span>{result.monthlyCashflow.remaining < 0 ? 'Monthly shortfall' : 'Unallocated monthly cash'}</span><strong>{money(Math.abs(result.monthlyCashflow.remaining))}</strong></div>
              </section>
            )}
            <ProjectionSummary result={result} />
            <ProjectionChart result={result} height={320} />
            {result.assetBreakdown?.length ? (
              <section className="asset-results" aria-labelledby="asset-results-title">
                <h2 id="asset-results-title">Asset values at age {v.retirementAge}</h2>
                <div className="table-scroll">
                  <table className="milestone-table">
                    <thead><tr><th scope="col">Asset</th><th scope="col">Value now</th><th scope="col">Linked debt</th><th scope="col">Equity now</th><th scope="col">Equity at age {v.retirementAge}</th></tr></thead>
                    <tbody>{result.assetBreakdown.map((asset) => (
                      <tr key={asset.id}>
                        <th scope="row">{asset.name}{asset.provider ? ` · ${asset.provider}` : ''}</th>
                        <td>{money(asset.currentBalance)}</td>
                        <td>{money(asset.linkedDebtBalance)}</td>
                        <td className="is-expected">{money(asset.currentEquity)}</td>
                        <td>{money(asset.retirementEquity)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {result.debtBreakdown?.length ? (
              <section className="debt-results" aria-labelledby="debt-results-title">
                <h2 id="debt-results-title">Debt balances at age {v.retirementAge}</h2>
                <div className="table-scroll">
                  <table className="milestone-table">
                    <thead><tr><th scope="col">Debt</th><th scope="col">Linked asset</th><th scope="col">Balance now</th><th scope="col">Projected balance</th><th scope="col">Monthly payment</th></tr></thead>
                    <tbody>{result.debtBreakdown.map((debt) => (
                      <tr key={debt.id}>
                        <th scope="row">{debt.name}</th>
                        <td>{debt.assetName ?? 'Unlinked'}</td>
                        <td>{money(debt.currentBalance)}</td>
                        <td className="is-debt">{money(debt.retirementBalance)}</td>
                        <td>{money(debt.monthlyPayment)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            ) : null}
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
