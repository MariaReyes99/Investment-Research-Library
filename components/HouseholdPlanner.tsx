'use client';
/**
 * Household wealth projector. Runs entirely in the browser: the numbers
 * entered here are never sent to the server. Saved plans stay in this browser.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ZodIssue } from 'zod';
import { CURRENCIES, HouseholdInputSchema, countryOfCurrency, projectHousehold, retirementCurrency, TAX_TREATMENTS, usedCurrencies, type Currency, type Household, type HouseholdResult } from '../lib/finance/household';
import { planFromHash } from '../lib/finance/householdLink';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import { COUNTRIES, COUNTRY_CODES, localTerms, moneyFor, profile, retirementSavingsLabel, type CountryCode } from '../lib/countries';
import { HINTS, feesHint, growthHint, inflationHint, taxRateHint } from '../lib/fieldGuide';
import { HouseholdAnalysisView, HouseholdChart, HouseholdComparison, HouseholdHeadline, HouseholdMilestones, HouseholdWarnings } from './HouseholdCharts';
import { BasisLabel, CountrySelect, RetireInSelect, useCountry, useRetireIn } from './CountryPicker';
import SavedPlans from './SavedPlans';
import PlanFileActions from './PlanFileActions';
import ClearDeviceData from './ClearDeviceData';
import BufferCheck from './BufferCheck';
import { usePlan } from './usePlan';
import { canSavePlans } from '../lib/plans';

type Draft = Omit<Household, 'compare'> & { compare: NonNullable<Household['compare']> };

/** The plan in progress, kept in this browser until "Start again" or "Clear my data". */
const FULL_PLAN_KEY = 'irl:full-plan';
type ListKey = 'investments' | 'properties' | 'otherAssets' | 'debts' | 'incomes' | 'dependants' | 'otherExpenses' | 'events' | 'compare';
type Item<K extends ListKey> = Draft[K][number];
type Owner = 'you' | 'partner' | 'joint';
type TaxTreatment = (typeof TAX_TREATMENTS)[number];

function defaultPlan(country: CountryCode): Draft {
  const c = profile(country);
  // Starts empty: no example numbers that could look like someone else's details
  return {
    country,
    retireIn: undefined,
    fx: [],
    you: { currentAge: 40, retirementAge: c.pension.age },
    partner: undefined,
    endAge: 90,
    inflationPct: c.inflationPct,
    cashOnHand: 0,
    cashInterestPct: 2.5,
    investments: [],
    properties: [],
    otherAssets: [],
    debts: [],
    incomes: [],
    livingExpensesMonthly: 0,
    retirementLivingExpensesMonthly: undefined,
    dependants: [],
    otherExpenses: [],
    events: [],
    withdrawal: { strategy: 'needs', ratePct: 4 },
    contributionsFromOutsideIncome: false,
    surplusReturnPct: 5,
    volatilityPct: 12,
    goal: undefined,
    compare: [],
  };
}

const investmentKinds = (country: CountryCode) => ({
  ...(country === 'NZ' ? { kiwisaver: 'KiwiSaver / Superannuation' } : {}),
  retirement_account: country === 'NZ' ? 'Other retirement fund' : retirementSavingsLabel(country),
  index_fund: 'Index fund / ETF', managed_fund: 'Managed fund', shares: `Individual ${localTerms(country).shares.toLowerCase()}`,
  term_deposit: localTerms(country).termDeposit, bonds: 'Bonds', other: 'Other',
}) as Record<Item<'investments'>['kind'], string>;
const TAX_LABELS: Record<TaxTreatment, string> = {
  returns_after_tax: 'Return entered is after tax',
  taxed_yearly: 'Tax on returns each year',
  taxed_on_withdrawal: 'Tax when withdrawn',
  tax_free: 'Tax-free',
};
const OTHER_ASSET_KINDS = { vehicle: 'Vehicle', jewellery: 'Jewellery', collectibles: 'Collectibles', business: 'Business', other: 'Other' };
const incomeKinds = (country: CountryCode) => ({
  salary: 'Salary / wages', dividends: 'Dividends', rental: 'Rent (not linked to a property)', business: 'Business',
  pension: `Pension / ${profile(country).pension.name}`, annuity: 'Annuity', other: 'Other',
});
const DEPENDANT_KINDS = { child: 'Child', parent: 'Parent', pet: 'Pet', other: 'Other' };
const EVENT_KINDS = { money_in: 'Money in (inheritance, lump sum)', money_out: 'Money out (renovation, car, wedding)', sell_property: 'Sell or downsize a property', sell_investment: 'Cash out an investment', reverse_mortgage: 'Reverse mortgage on a property' };
const WITHDRAWAL_KINDS = {
  needs: 'Spend my retirement living costs',
  six_percent: '6% rule (NZ actuaries)',
  inflated_four: 'Inflated 4% rule (NZ actuaries)',
  fixed_date: 'Fixed date rule (NZ actuaries)',
  guardrails: 'Flexible (guardrails)',
  percent: 'A % of my savings each year',
};
/** Plain explanations of each way to spend savings in retirement. */
const WITHDRAWAL_HELP: Record<keyof typeof WITHDRAWAL_KINDS, string> = {
  needs: 'Spend the retirement living costs you entered, however markets do.',
  six_percent: 'Each year, draw 6% of what your savings were worth when you retired, plus your pensions. Same amount every year (not raised for inflation), so more to spend early on, with some risk of running out.',
  inflated_four: 'Draw 4% of your savings at retirement, raised each year with inflation, plus your pensions. Lower to start, steadier, and more likely to leave something over.',
  fixed_date: "Each year, draw what's left divided by the years until an age you choose, plus your pensions; after that, live on your pension and other income.",
  guardrails: 'Starts at your retirement living costs; cuts spending 10% after bad years and raises it 10% after good ones.',
  percent: 'Spend a share of your savings each year, so spending rises and falls with your savings.',
};
const OWNERS: Record<Owner, string> = { you: 'You', partner: 'Partner', joint: 'Joint' };

const NEW_ITEMS: { [K in ListKey]: (country: CountryCode) => Item<K> } = {
  investments: () => ({ name: 'Index fund', kind: 'index_fund', owner: 'you', balance: 0, returnPct: 6, feesPct: 0.2, monthlyContribution: 0, contributionsStopAtRetirement: true, taxTreatment: 'returns_after_tax', taxRatePct: 0 }),
  properties: () => ({ name: 'Property', value: 0, growthPct: 3, mortgageBalance: 0, mortgageRatePct: 5.5, monthlyRepayment: 0, monthlyNetRent: 0, monthlyCosts: 0 }),
  otherAssets: () => ({ name: 'Asset', kind: 'other', value: 0 }),
  debts: () => ({ name: 'Loan', balance: 0, ratePct: 8, monthlyPayment: 0 }),
  incomes: () => ({ name: 'Dividends', kind: 'dividends', owner: 'you', monthlyAmount: 0, risesWithInflation: true }),
  dependants: () => ({ name: 'Child', kind: 'child', monthlyCost: 800, years: 10, startInYears: 0 }),
  otherExpenses: () => ({ name: 'Expense', monthlyAmount: 0, startInYears: 0 }),
  events: () => ({ name: 'Inheritance', kind: 'money_in', atAge: 70, amount: 0, replacementValue: 0, sellingCostsPct: 3, sharePct: 100, monthlyAmount: 0, loanRatePct: 9 }),
  compare: () => ({ label: 'Assumption', investmentReturnPct: 6 }),
};

/** Used only if today's rates can't be fetched: rough US dollar value of 1 unit. */
const ROUGH_USD_VALUE: Record<Currency, number> = { NZD: 0.58, AUD: 0.65, USD: 1, GBP: 1.33, PHP: 0.0175 };
const CURRENCY_LABELS = Object.fromEntries(CURRENCIES.map((c) => [c, `${c} (${COUNTRIES[countryOfCurrency(c)!].name})`])) as Record<Currency, string>;
const PAID_BY = Object.fromEntries(COUNTRY_CODES.map((c) => [c, COUNTRIES[c].name])) as Record<CountryCode, string>;

type FxStatus = { state: 'idle' | 'loading' | 'live' | 'rough' | 'error'; date?: string; message?: string };

/** Keeps one exchange rate per foreign currency in use; new ones start from a rough value until today's rate arrives. */
function syncFx(p: Draft): Draft {
  const home = COUNTRIES[p.country].currency as Currency;
  const used = usedCurrencies(p).filter((c) => c !== home);
  const kept = p.fx.filter((f) => used.includes(f.currency));
  const added = used.filter((c) => !kept.some((f) => f.currency === c))
    .map((c) => ({ currency: c, rate: Number((ROUGH_USD_VALUE[c] / ROUGH_USD_VALUE[home]).toPrecision(4)), yearlyChangePct: 0 }));
  if (!added.length && kept.length === p.fx.length) return p;
  return { ...p, fx: [...kept, ...added] };
}

/** Tax preset when an investment's type changes. */
function taxPreset(country: CountryCode, kind: Item<'investments'>['kind']): Pick<Item<'investments'>, 'taxTreatment' | 'taxRatePct'> | null {
  if (kind === 'retirement_account' && profile(country).retirementAccount.taxOnWithdrawal) return { taxTreatment: 'taxed_on_withdrawal', taxRatePct: 20 };
  if (kind === 'kiwisaver' || kind === 'retirement_account') return { taxTreatment: 'returns_after_tax', taxRatePct: 0 };
  return null;
}

const SECTION_NAMES: Record<string, string> = {
  investments: 'investment', properties: 'property', otherAssets: 'asset', debts: 'debt', incomes: 'income',
  dependants: 'dependant', otherExpenses: 'expense', events: 'event', compare: 'comparison',
};
const FIELD_NAMES: Record<string, string> = {
  name: 'Name', label: 'Label', balance: 'Balance', returnPct: 'Return', feesPct: 'Fees', monthlyContribution: 'Monthly contribution',
  accessAge: 'Can withdraw from age', value: 'Value', growthPct: 'Growth', mortgageBalance: 'Mortgage owing',
  mortgageRatePct: 'Interest', monthlyRepayment: 'Repayment', monthlyNetRent: 'Net rent', changePct: 'Change',
  ratePct: 'Rate', monthlyPayment: 'Payment', monthlyAmount: 'Amount', startAge: 'From age', endAge: 'Until age',
  monthlyCost: 'Cost', years: 'Years', startInYears: 'Starting in', investmentReturnPct: 'Return',
  currentAge: 'Age', retirementAge: 'Retirement age', cashOnHand: 'Cash', cashInterestPct: 'Cash interest',
  livingExpensesMonthly: 'Living costs now', retirementLivingExpensesMonthly: 'Living costs in retirement',
  inflationPct: 'Inflation', surplusReturnPct: 'Return on reinvested surplus', targetNetWorth: 'Target net worth', targetAge: 'Goal age',
  taxRatePct: 'Tax rate', atAge: 'At your age', amount: 'Amount', replacementValue: 'Replacement home price',
  sellingCostsPct: 'Selling costs', volatilityPct: 'Market ups and downs',
};
/** Percentages that are not yearly rates, with a hint on what to enter. */
const ONE_OFF_PERCENT_HINTS: Record<string, string> = {
  sellingCostsPct: 'Enter the share of the sale price paid in agent and legal fees, usually 2 to 5. The sale price itself comes from the property\'s value.',
  taxRatePct: 'Enter the tax rate as a percentage, for example 20 for 20%.',
};
const PERCENT_FIELDS = new Set(['returnPct', 'feesPct', 'growthPct', 'mortgageRatePct', 'changePct', 'ratePct', 'investmentReturnPct', 'cashInterestPct', 'inflationPct', 'surplusReturnPct', 'taxRatePct', 'sellingCostsPct', 'volatilityPct']);

/** Turns a validation problem into a sentence that says where it is and how to fix it. */
function friendlyError(issue: ZodIssue, plan: Draft): string {
  const path = issue.path;
  if (issue.code === 'custom' && path[0] === 'endAge') return '"Plan to your age" needs to be more than your current age.';
  if (issue.code === 'custom' && path[0] === 'fx') return issue.message;
  if (path[0] === 'fx' && typeof path[1] === 'number') {
    const f = plan.fx[path[1]];
    return `Exchange rate for ${f?.currency ?? 'a currency'}: enter what 1 ${f?.currency ?? 'unit'} is worth in ${COUNTRIES[plan.country].currency}, above 0.`;
  }
  const field = String(path[path.length - 1]);
  const fieldName = FIELD_NAMES[field] ?? field;
  let where = '';
  if (typeof path[1] === 'number' && SECTION_NAMES[String(path[0])]) {
    const item = (plan[path[0] as ListKey] as { name?: string; label?: string }[])[path[1]];
    const itemName = item?.name || item?.label;
    where = itemName ? `${itemName} (${SECTION_NAMES[String(path[0])]})` : `A ${SECTION_NAMES[String(path[0])]}`;
  } else if (path[0] === 'partner') where = "Your partner's details";
  else if (path[0] === 'you') where = 'Your details';
  else if (path[0] === 'withdrawal') where = 'Retirement spending';
  const prefix = where ? `${where}: ` : '';
  const isPct = PERCENT_FIELDS.has(field);
  if (issue.code === 'invalid_type') return `${prefix}${fieldName} is empty. Enter a number; 0 is fine.`;
  if (issue.code === 'too_big') {
    const hint = ONE_OFF_PERCENT_HINTS[field] ?? (isPct ? 'Enter a yearly percentage, for example 7 for 7%.' : '');
    return `${prefix}${fieldName} can be at most ${String(issue.maximum)}${isPct ? '%' : ''}. ${hint}`.trim();
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
  const money = moneyFor(result.inputs.country);
  const rows = result.scenarios[1].series.slice(1);
  const anyUnmet = rows.some((p) => p.unmet > 0.5);
  const anyReverse = rows.some((p) => p.reverseMortgage > 0.5);
  return (
    <details className="calc-assumptions">
      <summary>Year by year (expected case)</summary>
      <div className="table-scroll">
        <table className="milestone-table">
          <thead>
            <tr>
              <th scope="col">Age during the year</th><th scope="col">Income</th><th scope="col">Spending</th><th scope="col">Loan repayments</th>
              <th scope="col">Investing</th><th scope="col">Tax on withdrawals</th><th scope="col">One-off events</th><th scope="col">Income minus outgoings</th>{anyUnmet && <th scope="col">Not covered</th>}{anyReverse && <th scope="col">Reverse mortgage owed</th>}<th scope="col">Cash and investments at year end</th><th scope="col">Net worth at year end</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.age}>
                <th scope="row">{p.age - 1}</th>
                <td>{money(p.income)}</td>
                <td>{money(p.spending)}</td>
                <td>{money(p.loanPayments)}</td>
                <td>{money(p.contributions)}</td>
                <td>{money(p.tax)}</td>
                <td>{money(p.events)}</td>
                <td className={p.net < 0 ? 'is-drawn' : undefined}>{money(p.net)}</td>
                {anyUnmet && <td className={p.unmet > 0.5 ? 'is-debt' : undefined}>{p.unmet > 0.5 ? money(p.unmet) : '—'}</td>}
                {anyReverse && <td className={p.reverseMortgage > 0.5 ? 'is-debt' : undefined}>{p.reverseMortgage > 0.5 ? money(p.reverseMortgage) : '—'}</td>}
                <td>{money(p.liquid)}</td>
                <td className="is-expected">{money(p.netWorth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="asset-editor-note">
        Each row is one year of your life: income and spending during that year, and what you own at the end of it, in today&apos;s money.
        A negative &quot;income minus outgoings&quot; is paid from your cash and investments; one-off events such as a sale go into them.
        {anyUnmet ? ' "Not covered" shows spending your savings could no longer pay for.' : ' Your savings cover every year.'}
        {anyReverse && ' "Reverse mortgage owed" includes interest added each year, so it keeps growing even when you stop receiving payments.'}
      </p>
    </details>
  );
}


export default function HouseholdPlanner() {
  const [country, setCountry] = useCountry();
  const [retireIn, setRetireIn] = useRetireIn();
  const account = usePlan();
  // Locally, without sign-in set up, saved plans stay available for testing
  const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const canSave = !clerkOn || canSavePlans(account.plan);
  const [plan, setPlan] = useState<Draft>(() => defaultPlan('NZ'));
  const [showCurrencies, setShowCurrencies] = useState(false);
  const [fxStatus, setFxStatus] = useState<FxStatus>({ state: 'idle' });
  const [resultsInView, setResultsInView] = useState(false);

  // Hide the "See results" button while the results are on screen
  useEffect(() => {
    const el = document.getElementById('projection-results');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setResultsInView(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [loadedFromChat, setLoadedFromChat] = useState(false);
  const touched = useRef(false);

  // A plan from a chat answer or the guided setup arrives in the URL fragment, which never reaches the server.
  // Otherwise, bring back the plan this person was working on, kept on this device until they clear it.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const fromLink = planFromHash(window.location.hash);
    const draft = fromLink && toDraft(fromLink);
    if (draft) {
      setPlan(draft);
      setLoadedFromChat(true);
      touched.current = true;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      try {
        const saved = toDraft(JSON.parse(window.localStorage.getItem(FULL_PLAN_KEY) ?? 'null'));
        if (saved) { setPlan(saved); touched.current = true; }
      } catch { /* nothing saved */ }
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored || !touched.current) return;
    try {
      window.localStorage.setItem(FULL_PLAN_KEY, JSON.stringify(plan));
      // Lets the guided setup know this plan is the newest
      window.localStorage.setItem('irl:full-plan-at', String(Date.now()));
    } catch { /* private browsing */ }
  }, [plan, restored]);

  // Follow the saved country of residence until the person starts editing.
  useEffect(() => {
    if (!touched.current && plan.country !== country) setPlan(defaultPlan(country));
  }, [country, plan.country]);

  // Follow the saved retirement country, and show currency choices once any foreign currency is in play.
  useEffect(() => {
    const target = retireIn && retireIn !== plan.country ? retireIn : undefined;
    if (plan.retireIn !== target && !touched.current) setPlan((p) => syncFx({ ...p, retireIn: target }));
  }, [retireIn, plan.country, plan.retireIn]);
  useEffect(() => {
    if (plan.fx.length || plan.retireIn) setShowCurrencies(true);
  }, [plan.fx.length, plan.retireIn]);

  // Fetch today's rates whenever the set of foreign currencies changes.
  const home = COUNTRIES[plan.country].currency as Currency;
  const fxKey = plan.fx.map((f) => f.currency).sort().join(',');
  const fetchRates = async (currencies: string) => {
    if (!currencies) return;
    setFxStatus({ state: 'loading' });
    try {
      const res = await fetch(`/api/fx?home=${home}&to=${currencies}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan((p) => ({ ...p, fx: p.fx.map((f) => (data.perUnit[f.currency] ? { ...f, rate: data.perUnit[f.currency] } : f)) }));
      setFxStatus({ state: 'live', date: data.date });
    } catch (err) {
      setFxStatus({ state: 'error', message: err instanceof Error && err.message ? err.message : "Today's rates couldn't be fetched. Check the rough rates below and enter today's rate." });
    }
  };
  useEffect(() => {
    void fetchRates(fxKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxKey, home]);

  const couple = Boolean(plan.partner);
  const c = COUNTRIES[plan.country];
  const money = moneyFor(plan.country);
  const edit = (fn: (p: Draft) => Draft) => {
    touched.current = true;
    setPlan((p) => syncFx(fn(p)));
  };
  const set = (patch: Partial<Draft>) => edit((p) => ({ ...p, ...patch }));
  const setItem = <K extends ListKey>(key: K, index: number, patch: Partial<Item<K>>) =>
    edit((p) => ({ ...p, [key]: (p[key] as Item<K>[]).map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const addItem = <K extends ListKey>(key: K) => edit((p) => ({ ...p, [key]: [...(p[key] as Item<K>[]), NEW_ITEMS[key](p.country)] }));
  /** The sale or cash-out event linked to a property or investment, if there is one. */
  const linkedEvent = (kind: 'sell_property' | 'sell_investment', name: string) =>
    plan.events.find((ev) => ev.kind === kind && (kind === 'sell_property' ? ev.propertyName : ev.investmentName) === name);
  /** Adds, updates or removes the linked event. Blank age removes it. */
  const setLinkedEvent = (kind: 'sell_property' | 'sell_investment', name: string, patch: { atAge?: number; sharePct?: number }) =>
    edit((p) => {
      const matches = (ev: Draft['events'][number]) => ev.kind === kind && (kind === 'sell_property' ? ev.propertyName : ev.investmentName) === name;
      const existing = p.events.find(matches);
      if ('atAge' in patch && patch.atAge === undefined) return { ...p, events: p.events.filter((ev) => !matches(ev)) };
      if (existing) return { ...p, events: p.events.map((ev) => (matches(ev) ? { ...ev, ...patch, atAge: patch.atAge ?? ev.atAge, sharePct: patch.sharePct ?? ev.sharePct } : ev)) };
      if (patch.atAge === undefined || !Number.isFinite(patch.atAge)) return p;
      return {
        ...p,
        events: [...p.events, {
          name: kind === 'sell_property' ? `Sell ${name}` : `Cash out ${name}`, kind, atAge: patch.atAge, amount: 0,
          propertyName: kind === 'sell_property' ? name : undefined, investmentName: kind === 'sell_investment' ? name : undefined,
          sharePct: patch.sharePct ?? 100, replacementValue: 0, sellingCostsPct: 3, monthlyAmount: 0, loanRatePct: 9,
        }],
      };
    });
  /** Renaming a property or investment keeps its linked events attached. */
  const renameLinked = (kind: 'sell_property' | 'sell_investment', from: string, to: string) => (ev: Draft['events'][number]) => {
    if (ev.kind !== kind) return ev;
    const linked = kind === 'sell_property' ? ev.propertyName : ev.investmentName;
    if (linked !== from) return ev;
    const prefix = kind === 'sell_property' ? 'Sell' : 'Cash out';
    return { ...ev, [kind === 'sell_property' ? 'propertyName' : 'investmentName']: to, name: ev.name === `${prefix} ${from}` ? `${prefix} ${to}` : ev.name };
  };

  const removeItem = (key: ListKey, index: number) =>
    edit((p) => ({ ...p, [key]: (p[key] as unknown[]).filter((_, i) => i !== index) }));

  const changeRetireIn = (next: CountryCode | null) => {
    setRetireIn(next);
    set({ retireIn: next && next !== plan.country ? next : undefined });
  };
  const currencyPicker = (id: string, value: Currency | undefined, onChange: (v: Currency | undefined) => void) =>
    showCurrencies ? (
      <Pick id={id} label="Currency" value={value ?? home} options={CURRENCY_LABELS} onChange={(v) => onChange(v === home ? undefined : v)} />
    ) : null;
  const unitOf = (cur: Currency | undefined) => cur ?? c.currency;

  const changeCountry = (next: CountryCode) => {
    setCountry(next);
    // Nothing entered yet: show that country's example plan
    if (!touched.current) {
      setPlan(defaultPlan(next));
      return;
    }
    edit((p) => ({
      ...p,
      country: next,
      // Move inflation to the new country's default only if it hadn't been changed
      inflationPct: p.inflationPct === profile(p.country).inflationPct ? profile(next).inflationPct : p.inflationPct,
      // KiwiSaver only exists in New Zealand
      investments: next === 'NZ' ? p.investments : p.investments.map((i) => (i.kind === 'kiwisaver' ? { ...i, kind: 'retirement_account' } : i)),
    }));
  };

  // Typing stays responsive; the projection catches up a moment later.
  const deferred = useDeferredValue(plan);
  const lastGood = useRef<HouseholdResult | null>(null);

  /** Empties every field on the screen and starts a fresh plan. */
  const startAgain = (ask = true) => {
    if (ask && !window.confirm('Clear everything on this screen and start again?')) return;
    // Both calculators hold one plan, so starting again clears both
    try { [FULL_PLAN_KEY, 'irl:full-plan-at', 'irl:guided'].forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
    touched.current = false;
    lastGood.current = null;
    setLoadedFromChat(false);
    setPlan(defaultPlan(country));
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const { result, error } = useMemo(() => {
    const parsed = HouseholdInputSchema.safeParse({ ...deferred, compare: deferred.compare.length ? deferred.compare : undefined });
    if (!parsed.success) return { result: null, error: friendlyError(parsed.error.issues[0], deferred) };
    try {
      return { result: projectHousehold(parsed.data), error: null };
    } catch {
      return { result: null, error: 'Something in the plan couldn\'t be calculated. Check the last number you changed.' };
    }
  }, [deferred]);
  if (result) lastGood.current = result;
  // While a field is being fixed, keep showing the last results instead of a blank page.
  const shown = result ?? lastGood.current;
  const analysis = useMemo(() => (shown ? analyseHousehold(shown) : null), [shown]);

  const ownerPicker = (id: string, value: Owner, onChange: (v: Owner) => void) =>
    couple ? <Pick id={id} label="Belongs to" value={value} options={OWNERS} onChange={onChange} /> : null;
  const propertyNames = plan.properties.map((p) => p.name);

  return (
    <div className="calc-layout is-household">
      <form className="calc-form no-print" onSubmit={(e) => e.preventDefault()} aria-label="Household plan">
        <div className="start-again-row">
          <button type="button" className="start-again" onClick={() => startAgain()}>🧹 Start again</button>
          <span>Clears every field on this screen</span>
        </div>
        {loadedFromChat && <p className="privacy-notice" role="status">Your answers are filled in below. Change anything you like.</p>}

        <Section legend="Who's in the plan">
          <CountrySelect id="plan-country" value={plan.country} onChange={changeCountry} />
          <RetireInSelect id="plan-retire-in" value={plan.retireIn ?? null} livesIn={plan.country} onChange={changeRetireIn} />
          <Check label="Some of my money, income or costs are in another currency" checked={showCurrencies} onChange={setShowCurrencies} />
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

        <Section legend="Money in the bank" note="Everyday and savings accounts. Used first if money runs short.">
          <div className="planner-pair">
            <Num id="cash" label="How much" unit={c.currency} step={1000} value={plan.cashOnHand} onChange={(v) => set({ cashOnHand: v as number })} hint={`Your ${localTerms(plan.country).everydayAccount} and savings accounts added together.`} />
            <Num id="cash-rate" label="Interest" unit="% a year" step={0.25} value={plan.cashInterestPct} onChange={(v) => set({ cashInterestPct: v as number })} hint={HINTS.cashInterest} />
          </div>
        </Section>

        <Section legend="Investments" note={`${retirementSavingsLabel(plan.country)}, index funds and ETFs, managed funds, shares and term deposits. Returns are illustrations you can change, not provider performance.`}>
          <div className="asset-list">
            {plan.investments.map((inv, i) => (
              <Card key={i} title={inv.name || 'Investment'} onRemove={() => removeItem('investments', i)}>
                <Text id={`inv-${i}-name`} label="Name" value={inv.name}
                  onChange={(v) => edit((p) => ({ ...p, investments: p.investments.map((x, j) => (j === i ? { ...x, name: v } : x)), events: p.events.map(renameLinked('sell_investment', inv.name, v)) }))} />
                <Pick id={`inv-${i}-kind`} label="Type" value={inv.kind} options={investmentKinds(plan.country)}
                  onChange={(v) => setItem('investments', i, { kind: v, ...(taxPreset(plan.country, v) ?? {}) })} />
                {ownerPicker(`inv-${i}-owner`, inv.owner, (v) => setItem('investments', i, { owner: v }))}
                {currencyPicker(`inv-${i}-cur`, inv.currency, (v) => setItem('investments', i, { currency: v }))}
                <Num id={`inv-${i}-bal`} label="Balance" unit={unitOf(inv.currency)} step={1000} value={inv.balance} onChange={(v) => setItem('investments', i, { balance: v as number })} />
                <div className="planner-pair">
                  <Num id={`inv-${i}-ret`} label="Yearly growth" unit="% a year" step={0.25} value={inv.returnPct} onChange={(v) => setItem('investments', i, { returnPct: v as number })} hint={growthHint(inv.kind)} />
                  <Num id={`inv-${i}-fee`} label="Yearly fees" unit="% a year" step={0.05} value={inv.feesPct} onChange={(v) => setItem('investments', i, { feesPct: v as number })} hint={feesHint(inv.kind)} />
                </div>
                <Num id={`inv-${i}-con`} label="Monthly contribution" unit={unitOf(inv.currency)} step={50} value={inv.monthlyContribution} onChange={(v) => setItem('investments', i, { monthlyContribution: v as number })} />
                <Check label="Contributions stop at retirement" checked={inv.contributionsStopAtRetirement} onChange={(v) => setItem('investments', i, { contributionsStopAtRetirement: v })} />
                <div className="planner-pair">
                  <Num id={`inv-${i}-sell`} label="Cash out at age" optional value={linkedEvent('sell_investment', inv.name)?.atAge}
                    onChange={(v) => setLinkedEvent('sell_investment', inv.name, { atAge: v })} hint="Optional. Blank = keep it" />
                  <Num id={`inv-${i}-share`} label="How much" unit="%" step={5} optional value={linkedEvent('sell_investment', inv.name)?.sharePct}
                    onChange={(v) => setLinkedEvent('sell_investment', inv.name, { sharePct: v ?? 100 })} hint="Blank = all of it" />
                </div>
                <details className="asset-advanced">
                  <summary>Tax and access</summary>
                  <Pick id={`inv-${i}-tax`} label="Tax treatment" value={inv.taxTreatment} options={TAX_LABELS} onChange={(v) => setItem('investments', i, { taxTreatment: v })} />
                  {(inv.taxTreatment === 'taxed_yearly' || inv.taxTreatment === 'taxed_on_withdrawal') && (
                    <Num id={`inv-${i}-taxrate`} label="Tax rate" unit="%" step={0.5} value={inv.taxRatePct} onChange={(v) => setItem('investments', i, { taxRatePct: v as number })}
                      hint={inv.taxTreatment === 'taxed_yearly' ? `Share of each year's growth paid in tax. ${taxRateHint(plan.country)}` : `Share of each withdrawal paid in tax. ${taxRateHint(plan.country)}`} />
                  )}
                  <Num id={`inv-${i}-access`} label="Can withdraw from age" optional step={0.5} value={inv.accessAge} onChange={(v) => setItem('investments', i, { accessAge: v })}
                    hint={inv.kind === 'kiwisaver' ? 'KiwiSaver defaults to 65' : inv.kind === 'retirement_account' ? (() => { const ac = profile(countryOfCurrency(inv.currency) ?? plan.country).retirementAccount; return `${ac.name} defaults to ${ac.accessAge}. ${ac.note}`; })() : 'Leave blank if you can withdraw any time'} />
                </details>
              </Card>
            ))}
          </div>
          <AddButton label="Add investment" onClick={() => addItem('investments')} />
        </Section>

        <Section legend="Property" note={`Enter what it could sell for and what you still owe separately. Value growth is how much it rises each year. Running costs cover ${localTerms(plan.country).propertyTax}, insurance and repairs.`}>
          <div className="asset-list">
            {plan.properties.map((p, i) => (
              <Card key={i} title={p.name || 'Property'} onRemove={() => removeItem('properties', i)}>
                <Text id={`prop-${i}-name`} label="Name" value={p.name}
                  onChange={(v) => edit((d) => ({ ...d, properties: d.properties.map((x, j) => (j === i ? { ...x, name: v } : x)), events: d.events.map(renameLinked('sell_property', p.name, v)) }))} />
                {currencyPicker(`prop-${i}-cur`, p.currency, (v) => setItem('properties', i, { currency: v }))}
                <div className="planner-pair">
                  <Num id={`prop-${i}-val`} label="Could sell for" unit={unitOf(p.currency)} step={5000} value={p.value} onChange={(v) => setItem('properties', i, { value: v as number })} />
                  <Num id={`prop-${i}-g`} label="Value growth" unit="% a year" step={0.25} value={p.growthPct} onChange={(v) => setItem('properties', i, { growthPct: v as number })} hint={HINTS.propertyGrowth} />
                </div>
                <div className="planner-pair">
                  <Num id={`prop-${i}-mb`} label="Still owed" unit={unitOf(p.currency)} step={5000} value={p.mortgageBalance} onChange={(v) => setItem('properties', i, { mortgageBalance: v as number })} />
                  <Num id={`prop-${i}-mr`} label="Mortgage interest" unit="% a year" step={0.1} value={p.mortgageRatePct} onChange={(v) => setItem('properties', i, { mortgageRatePct: v as number })} hint={HINTS.mortgageRate} />
                </div>
                <div className="planner-pair">
                  <Num id={`prop-${i}-rp`} label="Repayment" unit="/mo" step={50} value={p.monthlyRepayment} onChange={(v) => setItem('properties', i, { monthlyRepayment: v as number })} />
                  <Num id={`prop-${i}-rent`} label="Rent received" unit="/mo" step={50} value={p.monthlyNetRent} onChange={(v) => setItem('properties', i, { monthlyNetRent: v as number })} />
                </div>
                <Num id={`prop-${i}-costs`} label="Running costs" unit="/mo" step={50} value={p.monthlyCosts} onChange={(v) => setItem('properties', i, { monthlyCosts: v as number })}
                  hint={`${localTerms(plan.country).propertyTax.charAt(0).toUpperCase() + localTerms(plan.country).propertyTax.slice(1)}, insurance, repairs and upkeep. Stops if you sell. Don't count these in living costs too.`} />
                <Num id={`prop-${i}-sell`} label="Plan to sell at age" optional value={linkedEvent('sell_property', p.name)?.atAge}
                  onChange={(v) => setLinkedEvent('sell_property', p.name, { atAge: v })}
                  hint="Optional. Leave blank to keep it. To stay in the home and release some of its value instead, add a reverse mortgage under One-off events." />
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
                {currencyPicker(`oa-${i}-cur`, a.currency, (v) => setItem('otherAssets', i, { currency: v }))}
                <div className="planner-pair">
                  <Num id={`oa-${i}-val`} label="Value" unit={unitOf(a.currency)} step={1000} value={a.value} onChange={(v) => setItem('otherAssets', i, { value: v as number })} />
                  <Num id={`oa-${i}-ch`} label="Change in value" unit="% a year" step={1} optional value={a.changePct} onChange={(v) => setItem('otherAssets', i, { changePct: v })} hint={`${HINTS.vehicleLoss} Enter a loss as a minus number, e.g. -15.`} />
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
                {currencyPicker(`debt-${i}-cur`, d.currency, (v) => setItem('debts', i, { currency: v }))}
                <div className="planner-pair">
                  <Num id={`debt-${i}-bal`} label="Still owed" unit={unitOf(d.currency)} step={500} value={d.balance} onChange={(v) => setItem('debts', i, { balance: v as number })} />
                  <Num id={`debt-${i}-rate`} label="Interest" unit="% a year" step={0.5} value={d.ratePct} onChange={(v) => setItem('debts', i, { ratePct: v as number })} hint="From your loan or card statement." />
                </div>
                <Num id={`debt-${i}-pay`} label="Payment" unit="/mo" step={50} value={d.monthlyPayment} onChange={(v) => setItem('debts', i, { monthlyPayment: v as number })} />
              </Card>
            ))}
          </div>
          <AddButton tone="debt" label="Add debt" onClick={() => addItem('debts')} />
        </Section>

        <Section legend="Money coming in" note={`After tax, per month, in today's money. Salary stops at retirement; pensions start at ${c.pension.age} unless you set other ages.`}>
          <div className="asset-list">
            {plan.incomes.map((inc, i) => (
              <Card key={i} title={inc.name || 'Income'} onRemove={() => removeItem('incomes', i)}>
                <Text id={`inc-${i}-name`} label="Name" value={inc.name} onChange={(v) => setItem('incomes', i, { name: v })} />
                <Pick id={`inc-${i}-kind`} label="Type" value={inc.kind} options={incomeKinds(plan.country)} onChange={(v) => setItem('incomes', i, { kind: v })} />
                {ownerPicker(`inc-${i}-owner`, inc.owner, (v) => setItem('incomes', i, { owner: v }))}
                {inc.kind === 'pension' ? (
                  <Pick id={`inc-${i}-paidby`} label="Paid by" value={countryOfCurrency(inc.currency) ?? plan.country} options={PAID_BY}
                    onChange={(v) => {
                      const cur = COUNTRIES[v].currency as Currency;
                      if (cur !== home) setShowCurrencies(true);
                      setItem('incomes', i, { currency: cur === home ? undefined : cur, name: inc.name === profile(countryOfCurrency(inc.currency) ?? plan.country).pension.name ? COUNTRIES[v].pension.name : inc.name });
                    }} />
                ) : currencyPicker(`inc-${i}-cur`, inc.currency, (v) => setItem('incomes', i, { currency: v }))}
                {(() => {
                  const pc = profile(countryOfCurrency(inc.currency) ?? plan.country);
                  return (
                    <Num id={`inc-${i}-amt`} label="Amount" unit={`${unitOf(inc.currency)}/mo`} step={100} value={inc.monthlyAmount} onChange={(v) => setItem('incomes', i, { monthlyAmount: v as number })}
                      hint={inc.kind === 'pension' ? `${pc.pension.name}: ${pc.pension.note} Starts at ${pc.pension.age} unless you set another age. Check your entitlement with ${pc.officialSources[pc.officialSources.length - 1].label}.` : undefined} />
                  );
                })()}
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

        <Section legend="Money going out" note="Everyday household costs. Leave out loan repayments and investing; they're counted above.">
          <div className="planner-pair">
            <Num id="living" label="Everyday spending now" unit="/mo" step={100} value={plan.livingExpensesMonthly} onChange={(v) => set({ livingExpensesMonthly: v as number })} />
            <Num id="living-ret" label="In retirement" unit={`${retirementCurrency(plan)}/mo`} step={100} optional value={plan.retirementLivingExpensesMonthly} onChange={(v) => set({ retirementLivingExpensesMonthly: v })}
              hint={plan.retireIn ? `In ${COUNTRIES[plan.retireIn].name}, in ${retirementCurrency(plan)}. Leave blank to use today's costs.` : undefined} />
          </div>
          <Pick id="withdrawal" label="How retirement spending is set" value={plan.withdrawal.strategy} options={WITHDRAWAL_KINDS}
            onChange={(v) => set({ withdrawal: { ...plan.withdrawal, strategy: v } })} />
          {plan.withdrawal.strategy === 'percent' && (
            <Num id="withdrawal-rate" label="Share of savings spent each year" unit="%" step={0.25} value={plan.withdrawal.ratePct}
              onChange={(v) => set({ withdrawal: { ...plan.withdrawal, ratePct: v as number } })} hint="Spending rises and falls with your savings" />
          )}
          <p className="asset-editor-note">{WITHDRAWAL_HELP[plan.withdrawal.strategy]}</p>
          {plan.withdrawal.strategy === 'fixed_date' && (
            <Num id="withdrawal-until" label="Make savings last until age" value={plan.withdrawal.untilAge ?? 85}
              onChange={(v) => set({ withdrawal: { ...plan.withdrawal, untilAge: v as number } })} />
          )}
          {['six_percent', 'inflated_four', 'fixed_date'].includes(plan.withdrawal.strategy) && (
            <p className="asset-editor-note">
              Rules of thumb from the NZ Society of Actuaries&apos; Retirement Income Interest Group, also used by{' '}
              <a href="https://sorted.org.nz/tools/retirement-navigator" target="_blank" rel="noopener noreferrer">Sorted&apos;s retirement navigator</a>.
              The navigator also offers a life expectancy rule.
            </p>
          )}
        </Section>

        <Section legend="Dependants" note="Children, parents you support, or pets. Each cost lasts for the number of years you set.">
          <div className="asset-list">
            {plan.dependants.map((d, i) => (
              <Card key={i} title={d.name || 'Dependant'} onRemove={() => removeItem('dependants', i)}>
                <div className="planner-pair">
                  <Text id={`dep-${i}-name`} label="Name" value={d.name} onChange={(v) => setItem('dependants', i, { name: v })} />
                  <Pick id={`dep-${i}-kind`} label="Type" value={d.kind} options={DEPENDANT_KINDS} onChange={(v) => setItem('dependants', i, { kind: v })} />
                </div>
                {currencyPicker(`dep-${i}-cur`, d.currency, (v) => setItem('dependants', i, { currency: v }))}
                <Num id={`dep-${i}-cost`} label="Cost" unit={`${unitOf(d.currency)}/mo`} step={50} value={d.monthlyCost} onChange={(v) => setItem('dependants', i, { monthlyCost: v as number })} />
                <div className="planner-pair">
                  <Num id={`dep-${i}-years`} label="For how many years" step={1} value={d.years} onChange={(v) => setItem('dependants', i, { years: v as number })} />
                  <Num id={`dep-${i}-start`} label="Starting in (years)" step={1} value={d.startInYears} onChange={(v) => setItem('dependants', i, { startInYears: v as number })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add dependant" onClick={() => addItem('dependants')} />
        </Section>

        <Section legend="Other expenses" note="Travel, insurance, school fees. Leave years blank for ongoing costs.">
          <div className="asset-list">
            {plan.otherExpenses.map((ex, i) => (
              <Card key={i} title={ex.name || 'Expense'} onRemove={() => removeItem('otherExpenses', i)}>
                <Text id={`ex-${i}-name`} label="Name" value={ex.name} onChange={(v) => setItem('otherExpenses', i, { name: v })} />
                {currencyPicker(`ex-${i}-cur`, ex.currency, (v) => setItem('otherExpenses', i, { currency: v }))}
                <Num id={`ex-${i}-amt`} label="Cost" unit={`${unitOf(ex.currency)}/mo`} step={50} value={ex.monthlyAmount} onChange={(v) => setItem('otherExpenses', i, { monthlyAmount: v as number })} />
                <div className="planner-pair">
                  <Num id={`ex-${i}-years`} label="For years" optional value={ex.years} onChange={(v) => setItem('otherExpenses', i, { years: v })} />
                  <Num id={`ex-${i}-start`} label="Starting in (years)" value={ex.startInYears} onChange={(v) => setItem('otherExpenses', i, { startInYears: v as number })} />
                </div>
              </Card>
            ))}
          </div>
          <AddButton label="Add expense" onClick={() => addItem('otherExpenses')} />
        </Section>

        <Section legend="One-off events" note="An inheritance, a renovation, selling or downsizing a property, or cashing out an investment, each at the age you choose. Add as many as you like.">
          <div className="asset-list">
            {plan.events.map((ev, i) => (
              <Card key={i} title={ev.name || 'Event'} onRemove={() => removeItem('events', i)}>
                <Text id={`ev-${i}-name`} label="Name" value={ev.name} onChange={(v) => setItem('events', i, { name: v })} />
                <Pick id={`ev-${i}-kind`} label="Type" value={ev.kind} options={EVENT_KINDS}
                  onChange={(v) => {
                    const propertyName = v === 'sell_property' || v === 'reverse_mortgage' ? ev.propertyName ?? propertyNames[0] : ev.propertyName;
                    const investmentName = v === 'sell_investment' ? ev.investmentName ?? plan.investments[0]?.name : ev.investmentName;
                    // Rename events that still have a default name
                    const defaults = ['Inheritance', 'Renovation', 'Event', ...propertyNames.map((n) => `Sell ${n}`), ...propertyNames.map((n) => `Reverse mortgage on ${n}`), ...plan.investments.map((x) => `Cash out ${x.name}`)];
                    const name = defaults.includes(ev.name)
                      ? v === 'money_in' ? 'Inheritance' : v === 'money_out' ? 'Renovation' : v === 'sell_investment' ? `Cash out ${investmentName ?? 'investment'}` : v === 'reverse_mortgage' ? `Reverse mortgage on ${propertyName ?? propertyNames[0] ?? 'home'}` : `Sell ${propertyName ?? 'property'}`
                      : ev.name;
                    setItem('events', i, { kind: v, propertyName, investmentName, name });
                  }} />
                <Num id={`ev-${i}-age`} label="At your age" value={ev.atAge} onChange={(v) => setItem('events', i, { atAge: v as number })} />
                {ev.kind === 'reverse_mortgage' ? (
                  <>
                    {propertyNames.length > 0 ? (
                      <Pick id={`ev-${i}-rmprop`} label="Property" value={ev.propertyName ?? propertyNames[0]}
                        options={Object.fromEntries(propertyNames.map((n) => [n, n]))} onChange={(v) => setItem('events', i, { propertyName: v })} />
                    ) : <p className="asset-editor-note">Add a property first.</p>}
                    <div className="planner-pair">
                      <Num id={`ev-${i}-rmlump`} label="Lump sum" unit={c.currency} step={5000} value={ev.amount} onChange={(v) => setItem('events', i, { amount: v as number })} hint="0 if none" />
                      <Num id={`ev-${i}-rmmonth`} label="Regular payment" unit="/mo" step={100} value={ev.monthlyAmount} onChange={(v) => setItem('events', i, { monthlyAmount: v as number })} hint="0 if none" />
                    </div>
                    <Num id={`ev-${i}-rmrate`} label="Interest rate" unit="% a year" step={0.25} value={ev.loanRatePct} onChange={(v) => setItem('events', i, { loanRatePct: v as number })}
                      hint={`Interest compounds because nothing is repaid. ${HINTS.reverseMortgageRate}`} />
                    <p className="asset-editor-note">You keep living in the home. The loan, with its interest, is repaid when the home is sold or at the end of the plan, and can&apos;t grow beyond the home&apos;s value.</p>
                  </>
                ) : ev.kind === 'sell_investment' ? (
                  <>
                    {plan.investments.length > 0 ? (
                      <Pick id={`ev-${i}-inv`} label="Investment" value={ev.investmentName ?? plan.investments[0].name}
                        options={Object.fromEntries(plan.investments.map((x) => [x.name, x.name]))}
                        onChange={(v) => setItem('events', i, { investmentName: v, name: ev.name === `Cash out ${ev.investmentName ?? ''}` ? `Cash out ${v}` : ev.name })} />
                    ) : <p className="asset-editor-note">Add an investment first.</p>}
                    <Num id={`ev-${i}-share`} label="How much to cash out" unit="%" step={5} value={ev.sharePct} onChange={(v) => setItem('events', i, { sharePct: v as number })} hint="100 = all of it. The money joins your savings." />
                  </>
                ) : ev.kind === 'sell_property' ? (
                  <>
                    {propertyNames.length > 0 ? (
                      <Pick id={`ev-${i}-prop`} label="Property" value={ev.propertyName ?? propertyNames[0]}
                        options={Object.fromEntries(propertyNames.map((n) => [n, n]))}
                        onChange={(v) => setItem('events', i, { propertyName: v, name: ev.name === `Sell ${ev.propertyName ?? propertyNames[0]}` ? `Sell ${v}` : ev.name })} />
                    ) : <p className="asset-editor-note">Add a property first.</p>}
                    <div className="planner-pair">
                      <Num id={`ev-${i}-repl`} label="Buy instead" unit={c.currency} step={10000} value={ev.replacementValue} onChange={(v) => setItem('events', i, { replacementValue: v as number })} hint="0 if not replacing it" />
                      <Num id={`ev-${i}-cost`} label="Selling costs" unit="% of price" step={0.5} value={ev.sellingCostsPct} onChange={(v) => setItem('events', i, { sellingCostsPct: v as number })} hint={HINTS.sellingCosts} />
                    </div>
                  </>
                ) : (
                  <>
                    {currencyPicker(`ev-${i}-cur`, ev.currency, (v) => setItem('events', i, { currency: v }))}
                    <Num id={`ev-${i}-amt`} label="Amount" unit={unitOf(ev.currency)} step={1000} value={ev.amount} onChange={(v) => setItem('events', i, { amount: v as number })} hint="In today's money" />
                  </>
                )}
              </Card>
            ))}
          </div>
          <AddButton label="Add event" onClick={() => addItem('events')} />
        </Section>

        {plan.fx.length > 0 && (
          <Section legend="Exchange rates" note={`Everything is added up in ${home}. Rates update automatically from the European Central Bank's daily reference rates; you can change them.`}>
            {plan.fx.map((f, i) => (
              <div className="planner-pair" key={f.currency}>
                <Num id={`fx-${f.currency}`} label={`1 ${f.currency} =`} unit={home} step={0.0001} value={f.rate}
                  onChange={(v) => edit((p) => ({ ...p, fx: p.fx.map((x, j) => (j === i ? { ...x, rate: v as number } : x)) }))} />
                <Num id={`fx-${f.currency}-chg`} label="Yearly change" unit="%" step={0.5} value={f.yearlyChangePct}
                  onChange={(v) => edit((p) => ({ ...p, fx: p.fx.map((x, j) => (j === i ? { ...x, yearlyChangePct: v as number } : x)) }))}
                  hint={`+ if ${f.currency} is expected to strengthen against ${home}`} />
              </div>
            ))}
            <p className={`asset-editor-note fx-status is-${fxStatus.state}`} role="status">
              {fxStatus.state === 'loading' && "Getting today's rates…"}
              {fxStatus.state === 'live' && `Today's rates from the European Central Bank via Frankfurter, as at ${fxStatus.date}.`}
              {fxStatus.state === 'error' && fxStatus.message}
            </p>
            <button type="button" className="asset-add-button" onClick={() => void fetchRates(fxKey)}>Refresh today&apos;s rates</button>
          </Section>
        )}

        <Section legend="Your goal (optional)">
          <div className="planner-pair">
            <Num id="goal" label="Aim to have" unit={c.currency} step={50000} optional value={plan.goal?.targetNetWorth}
              onChange={(v) => set({ goal: { ...plan.goal, targetNetWorth: v } })} />
            <Num id="goal-age" label="By your age" optional value={plan.goal?.targetAge}
              onChange={(v) => set({ goal: { ...plan.goal, targetAge: v } })} hint="Blank = retirement" />
          </div>
        </Section>

        <Section legend="Compare return assumptions" note="See the same plan at different investment returns, side by side.">
          <div className="asset-list">
            {plan.compare.map((cmp, i) => (
              <div className="planner-compare-row" key={i}>
                <Text id={`cmp-${i}-label`} label="Label" value={cmp.label} onChange={(v) => setItem('compare', i, { label: v })} />
                <Num id={`cmp-${i}-ret`} label="Yearly growth" unit="% a year" step={0.25} value={cmp.investmentReturnPct} onChange={(v) => setItem('compare', i, { investmentReturnPct: v as number })} hint={HINTS.compareReturn} />
                <button type="button" className="asset-remove" aria-label={`Remove ${cmp.label}`} onClick={() => removeItem('compare', i)}>×</button>
              </div>
            ))}
          </div>
          {plan.compare.length < 6 && <AddButton label="Add assumption" onClick={() => addItem('compare')} />}
        </Section>

        <details className="calc-more">
          <summary>Inflation, reinvested savings and market swings</summary>
          <Num id="infl" label="Inflation (how fast prices rise)" unit="% a year" step={0.1} value={plan.inflationPct} onChange={(v) => set({ inflationPct: v as number })} hint={inflationHint(plan.country)} />
          <Num id="surplus" label="Return on reinvested surplus" unit="% a year" step={0.25} value={plan.surplusReturnPct}
            onChange={(v) => set({ surplusReturnPct: v as number })} hint={HINTS.surplusReturn} />
          <Num id="vol" label="Market ups and downs" unit="% a year" step={1} value={plan.volatilityPct}
            onChange={(v) => set({ volatilityPct: v as number })} hint={HINTS.volatility} />
        </details>

        <p className="calc-privacy">
          Calculated on your device. Nothing you enter here is sent to us; it&apos;s kept in this browser until you press Start again or Clear. <ClearDeviceData onCleared={() => startAgain(false)} />
        </p>
      </form>

      {/* Phones and tablets show the form first, so offer a quick jump to the results */}
      <a className={`jump-to-results no-print${resultsInView ? ' is-hidden' : ''}`} href="#projection-results" aria-hidden={resultsInView} tabIndex={resultsInView ? -1 : 0}>
        See results{shown ? `: ${money(shown.milestones.find((m) => m.age === shown.retirementAge)?.expected ?? shown.today.netWorth)} at ${shown.retirementAge}` : ''} ↓
      </a>
      <section id="projection-results" className={`calc-results${error && shown ? ' is-stale' : ''}`} aria-live="polite" aria-label="Projection results">
        <a className="jump-to-form no-print" href="#plan-country">↑ Back to your plan</a>
        <div className="print-only print-header">
          <h1>Household plan</h1>
          <p>Printed {new Date().toLocaleDateString()} from the Investment Research Library wealth projector.</p>
        </div>
        {error && (
          <p className="error-message stale-banner no-print" role="alert">
            <strong>These results are out of date.</strong> {error}
            {shown && <><br /><small>The figures below are from before your last change and will update as soon as this is fixed.</small></>}
          </p>
        )}
        {shown && (
          <>
            <BasisLabel country={shown.inputs.country} inflationPct={shown.inputs.inflationPct} retireIn={shown.inputs.retireIn} fx={shown.inputs.fx} />
            <section className="net-worth-panel" aria-label="Net worth summary">
              <div><span>Net worth today</span><strong>{money(shown.today.netWorth)}</strong><small>Everything owned minus everything owed</small></div>
              <div><span>Debts today</span><strong>{money(shown.today.debts)}</strong><small>Mortgages and other loans</small></div>
              <div><span>Cash and investments</span><strong>{money(shown.today.liquid)}</strong><small>What can be spent without selling property</small></div>
              <div>
                <span>At age {shown.retirementAge}</span>
                <strong>{money(shown.milestones.find((m) => m.age === shown.retirementAge)?.expected ?? shown.today.netWorth)}</strong>
                <small>Expected net worth, today&apos;s money</small>
              </div>
            </section>

            <section className={`planner-cashflow${shown.today.monthlySurplus < 0 ? ' is-shortfall' : ''}`} aria-label="This month's cash flow">
              <div>
                <h2>Coming in each month</h2>
                <ul>{shown.today.income.map((l) => <li key={l.label}><span>{l.label}</span><b>{money(l.amount)}</b></li>)}</ul>
              </div>
              <div>
                <h2>Going out each month</h2>
                <ul>{shown.today.outgoings.map((l) => <li key={l.label}><span>{l.label}</span><b>{money(l.amount)}</b></li>)}</ul>
              </div>
              <p>
                {shown.today.monthlySurplus < 0 ? 'Monthly shortfall' : 'Left over and reinvested'} <strong>{money(Math.abs(shown.today.monthlySurplus))}</strong>
              </p>
            </section>

            <BufferCheck result={shown} />
            <HouseholdWarnings result={shown} />
            <HouseholdHeadline result={shown} />
            <HouseholdChart result={shown} height={320} />
            <HouseholdMilestones result={shown} />
            <HouseholdComparison result={shown} />
            {analysis && <HouseholdAnalysisView analysis={analysis} country={shown.inputs.country} />}
            <YearTable result={shown} />
            <details className="calc-assumptions print-open">
              <summary>Assumptions</summary>
              <ul>{shown.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </details>
            <p className="disclaimer-note">{shown.disclaimer}</p>
            <PlanFileActions
              plan={HouseholdInputSchema.safeParse({ ...plan, compare: plan.compare.length ? plan.compare : undefined }).success ? { ...plan, compare: plan.compare.length ? plan.compare : undefined } : null}
              onOpen={(p) => { const d = toDraft(p); if (d) { touched.current = true; setPlan(d); window.scrollTo({ top: 0, behavior: 'smooth' }); } }} />
            {account.loaded && (
              <SavedPlans plan={plan} canSave={canSave} signedIn={account.signedIn}
                onLoad={(p) => { const d = toDraft(p); if (d) { touched.current = true; setPlan(d); } }} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
