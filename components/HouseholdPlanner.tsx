'use client';
/**
 * Household wealth projector. Runs entirely in the browser: the numbers
 * entered here are never sent to the server or stored.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ZodIssue } from 'zod';
import { HouseholdInputSchema, projectHousehold, type Household, type HouseholdResult } from '../lib/finance/household';
import { planFromHash } from '../lib/finance/householdLink';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import { money } from './ProjectionChart';
import { HouseholdAnalysisView, HouseholdChart, HouseholdComparison, HouseholdHeadline, HouseholdMilestones, HouseholdWarnings } from './HouseholdCharts';

type Draft = Omit<Household, 'compare'> & { compare: NonNullable<Household['compare']> };
type ListKey = 'investments' | 'properties' | 'otherAssets' | 'debts' | 'incomes' | 'dependants' | 'otherExpenses' | 'compare';
type Item<K extends ListKey> = Draft[K][number];
type Owner = 'you' | 'partner' | 'joint';

const DEFAULT_PLAN: Draft = {
  you: { currentAge: 50, retirementAge: 65 },
  partner: undefined,
  endAge: 90,
  inflationPct: 2.5,
  cashOnHand: 20_000,
  cashInterestPct: 2.5,
  investments: [
    { name: 'KiwiSaver', kind: 'kiwisaver', owner: 'you', balance: 150_000, returnPct: 6, feesPct: 0.5, monthlyContribution: 600, contributionsStopAtRetirement: true },
  ],
  properties: [
    { name: 'Home', value: 850_000, growthPct: 3, mortgageBalance: 300_000, mortgageRatePct: 5.5, monthlyRepayment: 2_500, monthlyNetRent: 0 },
  ],
  otherAssets: [{ name: 'Car', kind: 'vehicle', value: 25_000 }],
  debts: [],
  incomes: [
    { name: 'Take-home pay', kind: 'salary', owner: 'you', monthlyAmount: 7_500, risesWithInflation: true },
    { name: 'NZ Super', kind: 'pension', owner: 'you', monthlyAmount: 2_000, startAge: 65, risesWithInflation: true },
  ],
  livingExpensesMonthly: 3_500,
  retirementLivingExpensesMonthly: undefined,
  dependants: [],
  otherExpenses: [],
  surplusReturnPct: 5,
  goal: { targetNetWorth: 1_500_000, targetAge: undefined },
  compare: [],
};

const INVESTMENT_KINDS = { kiwisaver: 'KiwiSaver', shares: 'Shares / ETFs', managed_fund: 'Managed fund', term_deposit: 'Term deposit', bonds: 'Bonds', other: 'Other' };
const OTHER_ASSET_KINDS = { vehicle: 'Vehicle', jewellery: 'Jewellery', collectibles: 'Collectibles', business: 'Business', other: 'Other' };
const INCOME_KINDS = { salary: 'Salary / wages', dividends: 'Dividends', rental: 'Rent (not linked to a property)', business: 'Business', pension: 'Pension / NZ Super', annuity: 'Annuity', other: 'Other' };
const DEPENDANT_KINDS = { child: 'Child', parent: 'Parent', pet: 'Pet', other: 'Other' };
const OWNERS: Record<Owner, string> = { you: 'You', partner: 'Partner', joint: 'Joint' };

const NEW_ITEMS: { [K in ListKey]: () => Item<K> } = {
  investments: () => ({ name: 'Investment', kind: 'shares', owner: 'you', balance: 0, returnPct: 6, feesPct: 0.3, monthlyContribution: 0, contributionsStopAtRetirement: true }),
  properties: () => ({ name: 'Property', value: 0, growthPct: 3, mortgageBalance: 0, mortgageRatePct: 5.5, monthlyRepayment: 0, monthlyNetRent: 0 }),
  otherAssets: () => ({ name: 'Asset', kind: 'other', value: 0 }),
  debts: () => ({ name: 'Loan', balance: 0, ratePct: 8, monthlyPayment: 0 }),
  incomes: () => ({ name: 'Dividends', kind: 'dividends', owner: 'you', monthlyAmount: 0, risesWithInflation: true }),
  dependants: () => ({ name: 'Child', kind: 'child', monthlyCost: 800, years: 10, startInYears: 0 }),
  otherExpenses: () => ({ name: 'Expense', monthlyAmount: 0, startInYears: 0 }),
  compare: () => ({ label: 'Assumption', investmentReturnPct: 6 }),
};

const SECTION_NAMES: Record<string, string> = {
  investments: 'investment', properties: 'property', otherAssets: 'asset', debts: 'debt', incomes: 'income',
  dependants: 'dependant', otherExpenses: 'expense', compare: 'comparison',
};
const FIELD_NAMES: Record<string, string> = {
  name: 'Name', label: 'Label', balance: 'Balance', returnPct: 'Return', feesPct: 'Fees', monthlyContribution: 'Monthly contribution',
  accessAge: 'Can withdraw from age', value: 'Value', growthPct: 'Growth', mortgageBalance: 'Mortgage owing',
  mortgageRatePct: 'Interest', monthlyRepayment: 'Repayment', monthlyNetRent: 'Net rent', changePct: 'Change',
  ratePct: 'Interest', monthlyPayment: 'Payment', monthlyAmount: 'Amount', startAge: 'From age', endAge: 'Until age',
  monthlyCost: 'Cost', years: 'Years', startInYears: 'Starting in', investmentReturnPct: 'Return',
  currentAge: 'Age', retirementAge: 'Retirement age', cashOnHand: 'Cash', cashInterestPct: 'Cash interest',
  livingExpensesMonthly: 'Living costs now', retirementLivingExpensesMonthly: 'Living costs in retirement',
  inflationPct: 'Inflation', surplusReturnPct: 'Return on reinvested surplus', targetNetWorth: 'Target net worth', targetAge: 'Goal age',
};
const PERCENT_FIELDS = new Set(['returnPct', 'feesPct', 'growthPct', 'mortgageRatePct', 'changePct', 'ratePct', 'investmentReturnPct', 'cashInterestPct', 'inflationPct', 'surplusReturnPct']);

/** Turns a validation problem into a sentence that says where it is and how to fix it. */
function friendlyError(issue: ZodIssue, plan: Draft): string {
  const path = issue.path;
  if (issue.code === 'custom' && path[0] === 'endAge') return '"Plan to your age" needs to be more than your current age.';
  const field = String(path[path.length - 1]);
  const fieldName = FIELD_NAMES[field] ?? field;
  let where = '';
  if (typeof path[1] === 'number' && SECTION_NAMES[String(path[0])]) {
    const item = (plan[path[0] as ListKey] as { name?: string; label?: string }[])[path[1]];
    const itemName = item?.name || item?.label;
    where = itemName ? `${itemName} (${SECTION_NAMES[String(path[0])]})` : `A ${SECTION_NAMES[String(path[0])]}`;
  } else if (path[0] === 'partner') where = "Your partner's details";
  else if (path[0] === 'you') where = 'Your details';
  const prefix = where ? `${where}: ` : '';
  const isPct = PERCENT_FIELDS.has(field);
  if (issue.code === 'invalid_type') return `${prefix}${fieldName} is empty. Enter a number; 0 is fine.`;
  if (issue.code === 'too_big') {
    return `${prefix}${fieldName} can be at most ${String(issue.maximum)}${isPct ? '%' : ''}.${isPct ? ' Enter a yearly percentage, for example 7 for 7%.' : ''}`;
  }
  if (issue.code === 'too_small') {
    if (field === 'name' || field === 'label') return `${prefix}give it a name.`;
    return `${prefix}${fieldName} must be at least ${String(issue.minimum)}${isPct ? '%' : ''}.`;
  }
  return `${prefix}check ${fieldName}.`;
}

/** Fills defaults so every field has a value the form can show. */
function toDraft(input: unknown): Draft | null {
  const parsed = HouseholdInputSchema.safeParse(input);
  if (!parsed.success) return null;
  return { ...parsed.data, compare: parsed.data.compare ?? [] };
}

function Num({ label, value, onChange, unit, step = 1, hint, optional = false, id }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; unit?: string; step?: number;
  hint?: string; optional?: boolean; id: string;
}) {
  return (
    <div className="calc-field">
      <label htmlFor={id}>{label}</label>
      <div className="calc-input">
        <input id={id} type="number" inputMode="decimal" step={step}
          value={value === undefined || !Number.isFinite(value) ? '' : value}
          placeholder={optional ? 'Default' : undefined}
          onChange={(e) => onChange(e.target.value === '' ? (optional ? undefined : NaN) : Number(e.target.value))} />
        {unit && <span>{unit}</span>}
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Text({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="calc-field">
      <label htmlFor={id}>{label}</label>
      <div className="calc-input"><input id={id} value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

function Pick<T extends string>({ label, value, options, onChange, id }: {
  label: string; value: T; options: Record<T, string>; onChange: (v: T) => void; id: string;
}) {
  return (
    <div className="calc-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="planner-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {(Object.entries(options) as [T, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="asset-growth-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Section({ legend, note, children, tone }: { legend: string; note?: string; children: ReactNode; tone?: 'debt' }) {
  return (
    <fieldset className={tone === 'debt' ? 'debt-editor' : 'asset-editor'}>
      <legend>{legend}</legend>
      {note && <p className="asset-editor-note">{note}</p>}
      {children}
    </fieldset>
  );
}

function Card({ title, onRemove, children, tone }: { title: string; onRemove: () => void; children: ReactNode; tone?: 'debt' }) {
  return (
    <section className={tone === 'debt' ? 'debt-card' : 'asset-card'} aria-label={title}>
      <div className="asset-card-heading">
        <strong className="planner-card-title">{title}</strong>
        <button type="button" className="asset-remove" aria-label={`Remove ${title}`} title="Remove" onClick={onRemove}>×</button>
      </div>
      {children}
    </section>
  );
}

function AddButton({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'debt' }) {
  return <button type="button" className={`asset-add-button${tone === 'debt' ? ' debt-add-button' : ''}`} onClick={onClick}>+ {label}</button>;
}

function YearTable({ result }: { result: HouseholdResult }) {
  const rows = result.scenarios[1].series.slice(1);
  return (
    <details className="calc-assumptions">
      <summary>Year by year (expected case)</summary>
      <div className="table-scroll">
        <table className="milestone-table">
          <thead>
            <tr>
              <th scope="col">Age</th><th scope="col">Income</th><th scope="col">Spending</th><th scope="col">Loan repayments</th>
              <th scope="col">Investing</th><th scope="col">Surplus / gap</th><th scope="col">Cash and investments</th><th scope="col">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.age}>
                <th scope="row">{p.age}</th>
                <td>{money(p.income)}</td>
                <td>{money(p.spending)}</td>
                <td>{money(p.loanPayments)}</td>
                <td>{money(p.contributions)}</td>
                <td className={p.net < 0 ? 'is-debt' : undefined}>{money(p.net)}</td>
                <td>{money(p.liquid)}</td>
                <td className="is-expected">{money(p.netWorth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="asset-editor-note">Yearly totals in today&apos;s dollars.</p>
    </details>
  );
}

export default function HouseholdPlanner() {
  const [plan, setPlan] = useState<Draft>(DEFAULT_PLAN);
  const [loadedFromChat, setLoadedFromChat] = useState(false);

  // A plan sent from a chat answer arrives in the URL fragment, which never reaches the server.
  useEffect(() => {
    const fromChat = planFromHash(window.location.hash);
    const draft = fromChat && toDraft(fromChat);
    if (draft) {
      setPlan(draft);
      setLoadedFromChat(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const couple = Boolean(plan.partner);
  const set = (patch: Partial<Draft>) => setPlan((p) => ({ ...p, ...patch }));
  const setItem = <K extends ListKey>(key: K, index: number, patch: Partial<Item<K>>) =>
    setPlan((p) => ({ ...p, [key]: (p[key] as Item<K>[]).map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const addItem = <K extends ListKey>(key: K) => setPlan((p) => ({ ...p, [key]: [...(p[key] as Item<K>[]), NEW_ITEMS[key]()] }));
  const removeItem = (key: ListKey, index: number) =>
    setPlan((p) => ({ ...p, [key]: (p[key] as unknown[]).filter((_, i) => i !== index) }));

  const lastGood = useRef<HouseholdResult | null>(null);
  const { result, error } = useMemo(() => {
    const parsed = HouseholdInputSchema.safeParse({ ...plan, compare: plan.compare.length ? plan.compare : undefined });
    if (!parsed.success) return { result: null, error: friendlyError(parsed.error.issues[0], plan) };
    try {
      return { result: projectHousehold(parsed.data), error: null };
    } catch {
      return { result: null, error: 'Something in the plan couldn\'t be calculated. Check the last number you changed.' };
    }
  }, [plan]);
  if (result) lastGood.current = result;
  // While a field is being fixed, keep showing the last results instead of a blank page.
  const shown = result ?? lastGood.current;
  const analysis = useMemo(() => (shown ? analyseHousehold(shown) : null), [shown]);

  const ownerPicker = (id: string, value: Owner, onChange: (v: Owner) => void) =>
    couple ? <Pick id={id} label="Belongs to" value={value} options={OWNERS} onChange={onChange} /> : null;

  return (
    <div className="calc-layout is-household">
      <form className="calc-form" onSubmit={(e) => e.preventDefault()} aria-label="Household plan">
        {loadedFromChat && <p className="privacy-notice" role="status">Loaded the numbers from your chat answer. Change anything below.</p>}

        <Section legend="Who's in the plan">
          <div className="calc-radios">
            <label><input type="radio" name="planFor" checked={!couple} onChange={() => set({ partner: undefined })} /> Just me</label>
            <label><input type="radio" name="planFor" checked={couple} onChange={() => set({ partner: plan.partner ?? { currentAge: plan.you.currentAge, retirementAge: plan.you.retirementAge } })} /> A couple</label>
          </div>
          <div className="planner-pair">
            <Num id="you-age" label="Your age" value={plan.you.currentAge} onChange={(v) => set({ you: { ...plan.you, currentAge: v as number } })} />
            <Num id="you-retire" label="You retire at" value={plan.you.retirementAge} onChange={(v) => set({ you: { ...plan.you, retirementAge: v as number } })} />
          </div>
          {plan.partner && (
            <div className="planner-pair">
              <Num id="partner-age" label="Partner's age" value={plan.partner.currentAge} onChange={(v) => set({ partner: { ...plan.partner!, currentAge: v as number } })} />
              <Num id="partner-retire" label="Partner retires at" value={plan.partner.retirementAge} onChange={(v) => set({ partner: { ...plan.partner!, retirementAge: v as number } })} />
            </div>
          )}
          <Num id="end-age" label="Plan to your age" value={plan.endAge} onChange={(v) => set({ endAge: v as number })} />
        </Section>

        <Section legend="Cash on hand" note="Everyday and savings accounts. Spent first if money runs short.">
          <div className="planner-pair">
            <Num id="cash" label="Cash" unit="NZD" step={1000} value={plan.cashOnHand} onChange={(v) => set({ cashOnHand: v as number })} />
            <Num id="cash-rate" label="Interest" unit="%" step={0.25} value={plan.cashInterestPct} onChange={(v) => set({ cashInterestPct: v as number })} />
          </div>
        </Section>

        <Section legend="Investments" note="KiwiSaver, shares, funds and term deposits. Returns are illustrations you can change, not provider performance.">
          <div className="asset-list">
            {plan.investments.map((inv, i) => (
              <Card key={i} title={inv.name || 'Investment'} onRemove={() => removeItem('investments', i)}>
                <Text id={`inv-${i}-name`} label="Name" value={inv.name} onChange={(v) => setItem('investments', i, { name: v })} />
                <Pick id={`inv-${i}-kind`} label="Type" value={inv.kind} options={INVESTMENT_KINDS} onChange={(v) => setItem('investments', i, { kind: v })} />
                {ownerPicker(`inv-${i}-owner`, inv.owner, (v) => setItem('investments', i, { owner: v }))}
                <Num id={`inv-${i}-bal`} label="Balance" unit="NZD" step={1000} value={inv.balance} onChange={(v) => setItem('investments', i, { balance: v as number })} />
                <div className="planner-pair">
                  <Num id={`inv-${i}-ret`} label="Return" unit="%" step={0.25} value={inv.returnPct} onChange={(v) => setItem('investments', i, { returnPct: v as number })} />
                  <Num id={`inv-${i}-fee`} label="Fees" unit="%" step={0.05} value={inv.feesPct} onChange={(v) => setItem('investments', i, { feesPct: v as number })} />
                </div>
                <Num id={`inv-${i}-con`} label="Monthly contribution" unit="NZD" step={50} value={inv.monthlyContribution} onChange={(v) => setItem('investments', i, { monthlyContribution: v as number })} />
                <Check label="Contributions stop at retirement" checked={inv.contributionsStopAtRetirement} onChange={(v) => setItem('investments', i, { contributionsStopAtRetirement: v })} />
                <Num id={`inv-${i}-access`} label="Can withdraw from age" optional value={inv.accessAge} onChange={(v) => setItem('investments', i, { accessAge: v })}
                  hint={inv.kind === 'kiwisaver' ? 'KiwiSaver defaults to 65' : 'Leave blank if you can withdraw any time'} />
              </Card>
            ))}
          </div>
          <AddButton label="Add investment" onClick={() => addItem('investments')} />
        </Section>

        <Section legend="Property" note="Enter the market value and the mortgage separately. Properties are kept, not sold.">
          <div className="asset-list">
            {plan.properties.map((p, i) => (
              <Card key={i} title={p.name || 'Property'} onRemove={() => removeItem('properties', i)}>
                <Text id={`prop-${i}-name`} label="Name" value={p.name} onChange={(v) => setItem('properties', i, { name: v })} />
                <div className="planner-pair">
                  <Num id={`prop-${i}-val`} label="Market value" unit="NZD" step={5000} value={p.value} onChange={(v) => setItem('properties', i, { value: v as number })} />
                  <Num id={`prop-${i}-g`} label="Growth" unit="%" step={0.25} value={p.growthPct} onChange={(v) => setItem('properties', i, { growthPct: v as number })} />
                </div>
                <div className="planner-pair">
                  <Num id={`prop-${i}-mb`} label="Mortgage owing" unit="NZD" step={5000} value={p.mortgageBalance} onChange={(v) => setItem('properties', i, { mortgageBalance: v as number })} />
                  <Num id={`prop-${i}-mr`} label="Interest" unit="%" step={0.1} value={p.mortgageRatePct} onChange={(v) => setItem('properties', i, { mortgageRatePct: v as number })} />
                </div>
                <div className="planner-pair">
                  <Num id={`prop-${i}-rp`} label="Repayment" unit="/mo" step={50} value={p.monthlyRepayment} onChange={(v) => setItem('properties', i, { monthlyRepayment: v as number })} />
                  <Num id={`prop-${i}-rent`} label="Net rent" unit="/mo" step={50} value={p.monthlyNetRent} onChange={(v) => setItem('properties', i, { monthlyNetRent: v as number })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add property" onClick={() => addItem('properties')} />
        </Section>

        <Section legend="Other assets" note="Vehicles lose about 10% a year unless you change it.">
          <div className="asset-list">
            {plan.otherAssets.map((a, i) => (
              <Card key={i} title={a.name || 'Asset'} onRemove={() => removeItem('otherAssets', i)}>
                <Text id={`oa-${i}-name`} label="Name" value={a.name} onChange={(v) => setItem('otherAssets', i, { name: v })} />
                <Pick id={`oa-${i}-kind`} label="Type" value={a.kind} options={OTHER_ASSET_KINDS} onChange={(v) => setItem('otherAssets', i, { kind: v })} />
                <div className="planner-pair">
                  <Num id={`oa-${i}-val`} label="Value" unit="NZD" step={1000} value={a.value} onChange={(v) => setItem('otherAssets', i, { value: v as number })} />
                  <Num id={`oa-${i}-ch`} label="Change" unit="%" step={1} optional value={a.changePct} onChange={(v) => setItem('otherAssets', i, { changePct: v })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add asset" onClick={() => addItem('otherAssets')} />
        </Section>

        <Section legend="Other debts" tone="debt" note="Car loans, personal loans, credit cards. Mortgages go with their property above.">
          <div className="debt-list">
            {plan.debts.map((d, i) => (
              <Card key={i} tone="debt" title={d.name || 'Loan'} onRemove={() => removeItem('debts', i)}>
                <Text id={`debt-${i}-name`} label="Name" value={d.name} onChange={(v) => setItem('debts', i, { name: v })} />
                <div className="planner-pair">
                  <Num id={`debt-${i}-bal`} label="Owing" unit="NZD" step={500} value={d.balance} onChange={(v) => setItem('debts', i, { balance: v as number })} />
                  <Num id={`debt-${i}-rate`} label="Interest" unit="%" step={0.5} value={d.ratePct} onChange={(v) => setItem('debts', i, { ratePct: v as number })} />
                </div>
                <Num id={`debt-${i}-pay`} label="Payment" unit="/mo" step={50} value={d.monthlyPayment} onChange={(v) => setItem('debts', i, { monthlyPayment: v as number })} />
              </Card>
            ))}
          </div>
          <AddButton tone="debt" label="Add debt" onClick={() => addItem('debts')} />
        </Section>

        <Section legend="Income" note="After tax, per month, in today's dollars. Salary stops at retirement; pensions start at 65 unless you set other ages.">
          <div className="asset-list">
            {plan.incomes.map((inc, i) => (
              <Card key={i} title={inc.name || 'Income'} onRemove={() => removeItem('incomes', i)}>
                <Text id={`inc-${i}-name`} label="Name" value={inc.name} onChange={(v) => setItem('incomes', i, { name: v })} />
                <Pick id={`inc-${i}-kind`} label="Type" value={inc.kind} options={INCOME_KINDS} onChange={(v) => setItem('incomes', i, { kind: v })} />
                {ownerPicker(`inc-${i}-owner`, inc.owner, (v) => setItem('incomes', i, { owner: v }))}
                <Num id={`inc-${i}-amt`} label="Amount" unit="/mo" step={100} value={inc.monthlyAmount} onChange={(v) => setItem('incomes', i, { monthlyAmount: v as number })}
                  hint={inc.kind === 'pension' ? 'Check current NZ Super rates with Work and Income.' : undefined} />
                <div className="planner-pair">
                  <Num id={`inc-${i}-start`} label="From age" optional value={inc.startAge} onChange={(v) => setItem('incomes', i, { startAge: v })} />
                  <Num id={`inc-${i}-end`} label="Until age" optional value={inc.endAge} onChange={(v) => setItem('incomes', i, { endAge: v })} />
                </div>
                <Check label="Rises with inflation" checked={inc.risesWithInflation} onChange={(v) => setItem('incomes', i, { risesWithInflation: v })} />
              </Card>
            ))}
          </div>
          <AddButton label="Add income" onClick={() => addItem('incomes')} />
        </Section>

        <Section legend="Spending" note="Everyday household costs. Leave out loan repayments and investing; they're counted above.">
          <div className="planner-pair">
            <Num id="living" label="Living costs now" unit="/mo" step={100} value={plan.livingExpensesMonthly} onChange={(v) => set({ livingExpensesMonthly: v as number })} />
            <Num id="living-ret" label="In retirement" unit="/mo" step={100} optional value={plan.retirementLivingExpensesMonthly} onChange={(v) => set({ retirementLivingExpensesMonthly: v })} />
          </div>
        </Section>

        <Section legend="Dependants" note="Children, parents you support, or pets. Each cost lasts for the number of years you set.">
          <div className="asset-list">
            {plan.dependants.map((d, i) => (
              <Card key={i} title={d.name || 'Dependant'} onRemove={() => removeItem('dependants', i)}>
                <div className="planner-pair">
                  <Text id={`dep-${i}-name`} label="Name" value={d.name} onChange={(v) => setItem('dependants', i, { name: v })} />
                  <Pick id={`dep-${i}-kind`} label="Type" value={d.kind} options={DEPENDANT_KINDS} onChange={(v) => setItem('dependants', i, { kind: v })} />
                </div>
                <Num id={`dep-${i}-cost`} label="Cost" unit="/mo" step={50} value={d.monthlyCost} onChange={(v) => setItem('dependants', i, { monthlyCost: v as number })} />
                <div className="planner-pair">
                  <Num id={`dep-${i}-years`} label="For how many years" step={1} value={d.years} onChange={(v) => setItem('dependants', i, { years: v as number })} />
                  <Num id={`dep-${i}-start`} label="Starting in (years)" step={1} value={d.startInYears} onChange={(v) => setItem('dependants', i, { startInYears: v as number })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add dependant" onClick={() => addItem('dependants')} />
        </Section>

        <Section legend="Other expenses" note="Travel, insurance, school fees, a planned renovation. Leave years blank for ongoing costs.">
          <div className="asset-list">
            {plan.otherExpenses.map((ex, i) => (
              <Card key={i} title={ex.name || 'Expense'} onRemove={() => removeItem('otherExpenses', i)}>
                <Text id={`ex-${i}-name`} label="Name" value={ex.name} onChange={(v) => setItem('otherExpenses', i, { name: v })} />
                <Num id={`ex-${i}-amt`} label="Cost" unit="/mo" step={50} value={ex.monthlyAmount} onChange={(v) => setItem('otherExpenses', i, { monthlyAmount: v as number })} />
                <div className="planner-pair">
                  <Num id={`ex-${i}-years`} label="For years" optional value={ex.years} onChange={(v) => setItem('otherExpenses', i, { years: v })} />
                  <Num id={`ex-${i}-start`} label="Starting in (years)" value={ex.startInYears} onChange={(v) => setItem('otherExpenses', i, { startInYears: v as number })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add expense" onClick={() => addItem('otherExpenses')} />
        </Section>

        <Section legend="Your goal, in today's dollars">
          <div className="planner-pair">
            <Num id="goal" label="Target net worth" unit="NZD" step={50000} optional value={plan.goal?.targetNetWorth}
              onChange={(v) => set({ goal: { ...plan.goal, targetNetWorth: v } })} />
            <Num id="goal-age" label="By your age" optional value={plan.goal?.targetAge}
              onChange={(v) => set({ goal: { ...plan.goal, targetAge: v } })} hint="Blank = retirement" />
          </div>
        </Section>

        <Section legend="Compare return assumptions" note="See the same plan at different investment returns, side by side. Label them however you like.">
          <div className="asset-list">
            {plan.compare.map((c, i) => (
              <div className="planner-compare-row" key={i}>
                <Text id={`cmp-${i}-label`} label="Label" value={c.label} onChange={(v) => setItem('compare', i, { label: v })} />
                <Num id={`cmp-${i}-ret`} label="Return" unit="%" step={0.25} value={c.investmentReturnPct} onChange={(v) => setItem('compare', i, { investmentReturnPct: v as number })} />
                <button type="button" className="asset-remove" aria-label={`Remove ${c.label}`} onClick={() => removeItem('compare', i)}>×</button>
              </div>
            ))}
          </div>
          {plan.compare.length < 6 && <AddButton label="Add assumption" onClick={() => addItem('compare')} />}
        </Section>

        <details className="calc-more">
          <summary>Inflation and reinvested savings</summary>
          <Num id="infl" label="Inflation" unit="% a year" step={0.1} value={plan.inflationPct} onChange={(v) => set({ inflationPct: v as number })} />
          <Num id="surplus" label="Return on reinvested surplus" unit="% a year" step={0.25} value={plan.surplusReturnPct}
            onChange={(v) => set({ surplusReturnPct: v as number })} hint="Money left over each month is invested at this rate" />
        </details>

        <p className="calc-privacy">Calculated on your device. Nothing you enter here is sent or saved.</p>
      </form>

      <section className="calc-results" aria-live="polite" aria-label="Projection results">
        {error && (
          <p className="error-message" role="alert">
            {error}
            {shown && <><br /><small>Showing your last complete results until this is fixed.</small></>}
          </p>
        )}
        {shown && (() => { const result = shown; return (
          <>
            <section className="net-worth-panel" aria-label="Net worth summary">
              <div><span>Net worth today</span><strong>{money(result.today.netWorth)}</strong><small>Everything owned minus everything owed</small></div>
              <div><span>Debts today</span><strong>{money(result.today.debts)}</strong><small>Mortgages and other loans</small></div>
              <div><span>Cash and investments</span><strong>{money(result.today.liquid)}</strong><small>What can be spent without selling property</small></div>
              <div>
                <span>At age {result.retirementAge}</span>
                <strong>{money(result.milestones.find((m) => m.age === result.retirementAge)?.expected ?? result.today.netWorth)}</strong>
                <small>Expected net worth, today&apos;s dollars</small>
              </div>
            </section>

            <section className={`planner-cashflow${result.today.monthlySurplus < 0 ? ' is-shortfall' : ''}`} aria-label="This month's cash flow">
              <div>
                <h2>Coming in each month</h2>
                <ul>{result.today.income.map((l) => <li key={l.label}><span>{l.label}</span><b>{money(l.amount)}</b></li>)}</ul>
              </div>
              <div>
                <h2>Going out each month</h2>
                <ul>{result.today.outgoings.map((l) => <li key={l.label}><span>{l.label}</span><b>{money(l.amount)}</b></li>)}</ul>
              </div>
              <p>
                {result.today.monthlySurplus < 0 ? 'Monthly shortfall' : 'Left over and reinvested'} <strong>{money(Math.abs(result.today.monthlySurplus))}</strong>
              </p>
            </section>

            <HouseholdWarnings result={result} />
            <HouseholdHeadline result={result} />
            <HouseholdChart result={result} height={320} />
            <HouseholdMilestones result={result} />
            <HouseholdComparison result={result} />
            {analysis && <HouseholdAnalysisView analysis={analysis} />}
            <YearTable result={result} />
            <details className="calc-assumptions">
              <summary>Assumptions</summary>
              <ul>{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </details>
            <p className="disclaimer-note">{result.disclaimer}</p>
          </>
        ); })()}
      </section>
    </div>
  );
}
