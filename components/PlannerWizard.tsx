'use client';
/**
 * Guided setup for the wealth projector: one topic per screen, plain words,
 * a short reason for each question, and no example numbers filled in.
 * Everything stays on this device. At the end it shows the results, and
 * "See every detail" opens the same plan in the full form.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CURRENCIES, projectHousehold, usedCurrencies, type Currency, type HouseholdInput } from '../lib/finance/household';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import { projectorLink } from '../lib/finance/householdLink';
import { COUNTRIES, COUNTRY_CODES, moneyFor, profile, type CountryCode } from '../lib/countries';
import { BasisLabel, CountrySelect, RetireInSelect, useCountry, useRetireIn } from './CountryPicker';
import { HouseholdAnalysisView, HouseholdChart, HouseholdWarnings } from './HouseholdCharts';
import StatementImport from './StatementImport';
import ClearDeviceData from './ClearDeviceData';
import PlanFileActions from './PlanFileActions';

type Style = 'careful' | 'balanced' | 'growth';
const STYLE_RETURN: Record<Style, number> = { careful: 4, balanced: 5.5, growth: 7 };

type Savings = { name: string; kind: 'retirement' | 'investments' | 'term' | 'other'; amount?: number; monthly?: number; style: Style; currency?: Currency; cashOutAge?: number; cashOutPct?: number };
type Home = { name: string; worth?: number; owe?: number; payment?: number; rent?: number; currency?: Currency; sellAge?: number };
type ForeignPension = { country: CountryCode; monthly?: number; owner: 'you' | 'partner' };
type Family = { kind: 'child' | 'parent' | 'pet'; monthly?: number; years?: number };

export interface Answers {
  who: 'me' | 'couple';
  /** Money, a home or a pension in another country */
  abroad?: boolean;
  foreignPensions?: ForeignPension[];
  age?: number; stopAge?: number; partnerAge?: number; partnerStopAge?: number;
  bank?: number;
  savings: Savings[];
  homes: Home[];
  pay?: number; partnerPay?: number; pension?: number; partnerPension?: number; otherIncome?: number;
  spending?: number; spendingRetired?: number; loanOwe?: number; loanPayment?: number;
  family: Family[];
  sellHomeAge?: number; gift?: number; giftAge?: number; bigSpend?: number; bigSpendAge?: number;
  goal?: number;
}

const START: Answers = { who: 'me', savings: [], homes: [], family: [], foreignPensions: [] };

/** Rough US dollar value of 1 unit, used only until today's rates arrive. */
const ROUGH_USD: Record<Currency, number> = { NZD: 0.58, AUD: 0.65, USD: 1, GBP: 1.33, PHP: 0.0175 };
const CURRENCY_NAMES = Object.fromEntries(CURRENCIES.map((cu) => [cu, `${cu}, ${COUNTRIES[COUNTRY_CODES.find((k) => COUNTRIES[k].currency === cu)!].name}`])) as Record<Currency, string>;
const n = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : 0);

/** Turns the plain-language answers into a full household plan. */
export function answersToPlan(a: Answers, country: CountryCode, retireIn: CountryCode | null, rates: Partial<Record<Currency, number>> = {}): HouseholdInput {
  const c = profile(country);
  const age = n(a.age) || 40;
  const stop = n(a.stopAge) || Math.max(age, c.pension.age);
  const couple = a.who === 'couple';
  const pAge = n(a.partnerAge) || age;
  const pStop = n(a.partnerStopAge) || Math.max(pAge, c.pension.age);
  const homes = a.homes.filter((h) => n(h.worth) > 0);
  const home = c.currency as Currency;
  const cur = (x?: Currency) => (a.abroad && x && x !== home ? x : undefined);
  const savings = a.savings.filter((s) => n(s.amount) > 0 || n(s.monthly) > 0);
  const homeName = (h: Home, i: number) => h.name || (i === 0 ? 'Home' : `Property ${i + 1}`);
  const saveName = (s: Savings, i: number) => `${s.name || 'Savings'}${savings.filter((x) => (x.name || 'Savings') === (s.name || 'Savings')).length > 1 ? ` ${i + 1}` : ''}`;
  const foreign = a.abroad ? (a.foreignPensions ?? []).filter((p) => n(p.monthly) > 0) : [];
  const plan: HouseholdInput = {
    country,
    retireIn: retireIn && retireIn !== country ? retireIn : undefined,
    you: { currentAge: age, retirementAge: stop },
    partner: couple ? { currentAge: pAge, retirementAge: pStop } : undefined,
    endAge: Math.max(90, age + 5),
    inflationPct: c.inflationPct,
    cashOnHand: n(a.bank),
    investments: savings.map((s, i) => ({
      name: saveName(s, i),
      currency: cur(s.currency),
      kind: s.kind === 'retirement' ? (country === 'NZ' ? 'kiwisaver' : 'retirement_account') : s.kind === 'term' ? 'term_deposit' : s.kind === 'investments' ? 'shares' : 'other',
      balance: n(s.amount),
      returnPct: s.kind === 'term' ? 4 : STYLE_RETURN[s.style],
      feesPct: s.kind === 'term' ? 0 : 0.5,
      monthlyContribution: n(s.monthly),
      contributionsStopAtRetirement: true,
    })),
    properties: homes.map((h, i) => ({
      name: homeName(h, i),
      currency: cur(h.currency),
      value: n(h.worth), growthPct: 3, mortgageBalance: n(h.owe), mortgageRatePct: 5.5,
      monthlyRepayment: n(h.payment), monthlyNetRent: n(h.rent),
    })),
    debts: n(a.loanOwe) > 0 ? [{ name: 'Other loans', balance: n(a.loanOwe), ratePct: 9, monthlyPayment: n(a.loanPayment) }] : [],
    incomes: [
      ...(n(a.pay) > 0 ? [{ name: 'Your take-home pay', kind: 'salary' as const, owner: 'you' as const, monthlyAmount: n(a.pay) }] : []),
      ...(couple && n(a.partnerPay) > 0 ? [{ name: "Partner's take-home pay", kind: 'salary' as const, owner: 'partner' as const, monthlyAmount: n(a.partnerPay) }] : []),
      ...(n(a.pension) > 0 ? [{ name: `Your ${c.pension.name}`, kind: 'pension' as const, owner: 'you' as const, monthlyAmount: n(a.pension) }] : []),
      ...(couple && n(a.partnerPension) > 0 ? [{ name: `Partner's ${c.pension.name}`, kind: 'pension' as const, owner: 'partner' as const, monthlyAmount: n(a.partnerPension) }] : []),
      ...(n(a.otherIncome) > 0 ? [{ name: 'Other money coming in', kind: 'other' as const, owner: 'you' as const, monthlyAmount: n(a.otherIncome) }] : []),
      ...foreign.map((p) => ({
        name: `${p.owner === 'partner' && couple ? "Partner's " : ''}${COUNTRIES[p.country].pension.name}`, kind: 'pension' as const,
        owner: (p.owner === 'partner' && couple ? 'partner' : 'you') as 'you' | 'partner',
        monthlyAmount: n(p.monthly), currency: cur(COUNTRIES[p.country].currency as Currency),
      })),
    ],
    livingExpensesMonthly: n(a.spending),
    retirementLivingExpensesMonthly: a.spendingRetired !== undefined && Number.isFinite(a.spendingRetired) ? a.spendingRetired : undefined,
    dependants: a.family.filter((f) => n(f.monthly) > 0).map((f) => ({
      name: f.kind === 'child' ? 'Child' : f.kind === 'parent' ? 'Parent' : 'Pet', kind: f.kind,
      monthlyCost: n(f.monthly), years: n(f.years) || 10, startInYears: 0,
    })),
    events: [
      ...homes.flatMap((h, i) => (n(h.sellAge) > age ? [{ name: `Sell ${homeName(h, i)}`, kind: 'sell_property' as const, atAge: n(h.sellAge), propertyName: homeName(h, i) }] : [])),
      ...savings.flatMap((s, i) => (n(s.cashOutAge) > age ? [{ name: `Cash out ${saveName(s, i)}`, kind: 'sell_investment' as const, atAge: n(s.cashOutAge), investmentName: saveName(s, i), sharePct: Math.min(100, Math.max(1, n(s.cashOutPct) || 100)) }] : [])),
      ...(n(a.gift) > 0 && n(a.giftAge) > age ? [{ name: 'Money you expect to receive', kind: 'money_in' as const, atAge: n(a.giftAge), amount: n(a.gift) }] : []),
      ...(n(a.bigSpend) > 0 && n(a.bigSpendAge) > age ? [{ name: 'Big purchase', kind: 'money_out' as const, atAge: n(a.bigSpendAge), amount: n(a.bigSpend) }] : []),
    ],
    goal: n(a.goal) > 0 ? { targetNetWorth: n(a.goal) } : undefined,
    // Until pay or spending is entered, assume savings come from income we haven't been told about yet
    contributionsFromOutsideIncome: a.pay === undefined && a.partnerPay === undefined && a.spending === undefined,
  };
  // An exchange rate for every other currency used: today's rate if we have it, otherwise a rough one
  plan.fx = usedCurrencies({ ...plan, investments: plan.investments ?? [], properties: plan.properties ?? [], otherAssets: [], debts: [], incomes: plan.incomes ?? [], dependants: [], otherExpenses: [], events: [] } as Parameters<typeof usedCurrencies>[0])
    .filter((x) => x !== home)
    .map((x) => ({ currency: x, rate: rates[x] ?? Number((ROUGH_USD[x] / ROUGH_USD[home]).toPrecision(4)), yearlyChangePct: 0 }));
  return plan;
}

/** A labelled number field with a one-line explanation. Blank means "none". */
function Field({ id, label, help, value, onChange, prefix, suffix, placeholder }: {
  id: string; label: string; help?: string; value: number | undefined; onChange: (v: number | undefined) => void;
  prefix?: string; suffix?: string; placeholder?: string;
}) {
  return (
    <div className="wizard-field">
      <label htmlFor={id}>{label}</label>
      {help && <p className="wizard-help" id={`${id}-help`}>{help}</p>}
      <div className="wizard-input">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input id={id} type="number" inputMode="decimal" min={0} aria-describedby={help ? `${id}-help` : undefined}
          placeholder={placeholder ?? '0'} value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))} />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </div>
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange, name }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="wizard-choices" role="radiogroup">
      {options.map(([v, label, hint]) => (
        <label key={v} className={`wizard-choice${value === v ? ' is-on' : ''}`}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          <span>{label}</span>
          {hint && <small>{hint}</small>}
        </label>
      ))}
    </div>
  );
}

function Card({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="wizard-card">
      <div className="wizard-card-head"><strong>{title}</strong><button type="button" className="link-button is-danger" onClick={onRemove}>Remove</button></div>
      {children}
    </div>
  );
}

function CurrencyPick({ id, label, value, home, onChange }: { id: string; label: string; value?: Currency; home: Currency; onChange: (v: Currency | undefined) => void }) {
  return (
    <div className="wizard-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="planner-select wizard-select" value={value ?? home} onChange={(e) => onChange(e.target.value === home ? undefined : (e.target.value as Currency))}>
        {CURRENCIES.map((cu) => <option key={cu} value={cu}>{CURRENCY_NAMES[cu]}</option>)}
      </select>
    </div>
  );
}

/** Opens a plan in the "All details" view. */
export function openInAllDetails(plan: HouseholdInput) {
  window.location.assign(projectorLink(plan).replace('/calculator#', '/calculator?view=full#'));
}

export default function PlannerWizard({ onPlanChange }: { onPlanChange?: (plan: HouseholdInput | null) => void }) {
  const [country, setCountry] = useCountry();
  const [retireIn, setRetireIn] = useRetireIn();
  const [a, setA] = useState<Answers>(START);
  const [step, setStep] = useState(0);
  const set = (patch: Partial<Answers>) => setA((p) => ({ ...p, ...patch }));
  const c = COUNTRIES[country];
  const money = moneyFor(country);
  const cur = c.currency;
  const couple = a.who === 'couple';
  const homeCur = cur as Currency;
  const [rates, setRates] = useState<Partial<Record<Currency, number>>>({});
  const livePlan = useMemo(() => answersToPlan(a, country, retireIn, rates), [a, country, retireIn, rates]);
  const touched = a !== START;

  // Share the plan so switching to "All details" keeps every answer
  useEffect(() => { onPlanChange?.(touched ? livePlan : null); }, [livePlan, touched, onPlanChange]);

  // Today's exchange rates for any other currencies in the plan
  const foreignKey = (livePlan.fx ?? []).map((f) => f.currency).sort().join(',');
  useEffect(() => {
    if (!foreignKey) return;
    let cancelled = false;
    fetch(`/api/fx?home=${homeCur}&to=${foreignKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { perUnit?: Partial<Record<Currency, number>> } | null) => { if (!cancelled && d?.perUnit) setRates(d.perUnit); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [foreignKey, homeCur]);

  const ageOk = a.age !== undefined && a.age >= 16 && a.age <= 100 && (!couple || (a.partnerAge !== undefined && a.partnerAge >= 16 && a.partnerAge <= 100));
  const stopOk = (a.stopAge === undefined || (a.stopAge >= 16 && a.stopAge <= 100)) && (a.partnerStopAge === undefined || (a.partnerStopAge >= 16 && a.partnerStopAge <= 100));

  const steps: { icon: string; title: string; why: string; body: ReactNode; canGoOn?: boolean; optional?: boolean }[] = [
    {
      icon: '👋', title: "Hello! Let's picture your money future",
      why: 'A few easy questions, about 5 minutes. Rough numbers are fine, and you can skip anything that doesn\'t apply. Everything stays on this device.',
      body: (
        <>
          <p className="wizard-q">Who is this plan for?</p>
          <Choice name="who" value={a.who}
            onChange={(v) => set(v === 'couple' ? { who: v, partnerStopAge: a.partnerStopAge ?? a.stopAge } : { who: v })}
            options={[['me', 'Just me', 'Your own money'], ['couple', 'Me and my partner', 'Money you share']]} />
          {couple && <p className="wizard-help">Everything you&apos;ve already entered is kept. You&apos;ll just add your partner&apos;s details.</p>}
          <div className="wizard-pair">
            <CountrySelect id="wiz-country" value={country} onChange={setCountry} label="Where do you live?" />
            <RetireInSelect id="wiz-retire" value={retireIn && retireIn !== country ? retireIn : null} livesIn={country} onChange={setRetireIn} />
          </div>
          <p className="wizard-help">This sets your currency ({cur}) and the usual pension age ({c.pension.name} from {c.pension.age}).</p>
          <p className="wizard-q">Do you have money, a home or a pension in another country?</p>
          <Choice name="abroad" value={a.abroad ? 'yes' : 'no'} onChange={(v) => set({ abroad: v === 'yes' })}
            options={[['no', 'No', 'Everything is here'], ['yes', 'Yes', 'Savings, property or a pension overseas']]} />
          {a.abroad && <p className="wizard-help">Great, we&apos;ll ask which currency each one is in and use today&apos;s exchange rates.</p>}
        </>
      ),
    },
    {
      icon: '🎂', title: 'About you',
      why: 'Your age tells us how many years your money has to grow, and how long it needs to last.',
      canGoOn: ageOk && stopOk,
      body: (
        <>
          <div className="wizard-pair">
            <Field id="wiz-age" label="How old are you?" value={a.age} onChange={(v) => set({ age: v })} suffix="years" placeholder="e.g. 45" />
            <Field id="wiz-stop" label="At what age would you like to stop working?" help={`Leave blank for ${c.pension.age}, when ${c.pension.name} usually starts.`} value={a.stopAge} onChange={(v) => set({ stopAge: v })} suffix="years" placeholder={String(c.pension.age)} />
          </div>
          {couple && (
            <div className="wizard-pair">
              <Field id="wiz-page" label="How old is your partner?" value={a.partnerAge} onChange={(v) => set({ partnerAge: v })} suffix="years" placeholder="e.g. 43" />
              <Field id="wiz-pstop" label="When would your partner like to stop working?" value={a.partnerStopAge} onChange={(v) => set({ partnerStopAge: v })} suffix="years" placeholder={String(c.pension.age)} />
            </div>
          )}
          {!ageOk && <p className="wizard-help is-gentle">Pop in {couple ? 'both ages' : 'your age'} (between 16 and 100) to carry on.</p>}
        </>
      ),
    },
    {
      icon: '🏦', title: 'Money in the bank',
      why: 'Everyday and savings accounts: the money you could use for an emergency.',
      body: (
        <>
          <Field id="wiz-bank" label="How much is in your bank accounts?" help="Add up everyday and savings accounts. Leave out KiwiSaver, retirement savings and investments; they come next." value={a.bank} onChange={(v) => set({ bank: v })} prefix={cur} />
          <StatementImport money={money} onApply={(s) => set({
            bank: s.bank ?? a.bank, pay: s.pay ?? a.pay, spending: s.spending ?? a.spending,
          })} />
        </>
      ),
    },
    {
      icon: '🌱', title: 'Savings and investments',
      why: `Money set aside to grow: ${c.retirementAccount.name}, shares or funds, term deposits.`,
      optional: true,
      body: (
        <>
          {a.savings.map((s, i) => {
            const upd = (p: Partial<Savings>) => set({ savings: a.savings.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <Card key={i} title={s.name || 'Savings'} onRemove={() => set({ savings: a.savings.filter((_, j) => j !== i) })}>
                <Choice name={`wiz-kind-${i}`} value={s.kind} onChange={(v) => upd({ kind: v, name: v === 'retirement' ? c.retirementAccount.name : v === 'investments' ? 'Shares or funds' : v === 'term' ? 'Term deposit' : 'Other savings' })}
                  options={[['retirement', c.retirementAccount.name, 'Retirement savings'], ['investments', 'Shares or funds'], ['term', 'Term deposit'], ['other', 'Something else']]} />
                {a.abroad && <CurrencyPick id={`wiz-savc-${i}`} label="Which currency is it in?" value={s.currency} home={homeCur} onChange={(v) => upd({ currency: v })} />}
                <div className="wizard-pair">
                  <Field id={`wiz-sav-${i}`} label="How much is in it now?" value={s.amount} onChange={(v) => upd({ amount: v })} prefix={a.abroad && s.currency ? s.currency : cur} />
                  <Field id={`wiz-savm-${i}`} label="How much goes in each month?" help="Include anything your employer adds." value={s.monthly} onChange={(v) => upd({ monthly: v })} prefix={a.abroad && s.currency ? s.currency : cur} />
                </div>
                <div className="wizard-pair">
                  <Field id={`wiz-savo-${i}`} label="Planning to cash it out? At what age?" help="Optional. The money moves into your savings. Leave blank to keep it." value={s.cashOutAge} onChange={(v) => upd({ cashOutAge: v })} suffix="years" />
                  <Field id={`wiz-savp-${i}`} label="How much of it?" help="Blank means all of it." value={s.cashOutPct} onChange={(v) => upd({ cashOutPct: v === undefined ? undefined : Math.min(100, v) })} suffix="%" placeholder="100" />
                </div>
                {s.kind !== 'term' && (
                  <>
                    <p className="wizard-q">How is it invested?</p>
                    <Choice name={`wiz-style-${i}`} value={s.style} onChange={(v) => upd({ style: v })}
                      options={[['careful', 'Careful', 'Steadier, grows slowly'], ['balanced', 'Balanced', 'A mix of both'], ['growth', 'Growth', 'Bumpier, grows faster']]} />
                    <p className="wizard-help">Not sure? Your provider&apos;s statement or app usually shows the fund name, such as &quot;Balanced&quot; or &quot;Growth&quot;.</p>
                  </>
                )}
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ savings: [...a.savings, { name: c.retirementAccount.name, kind: 'retirement', style: 'balanced' }] })}>
            + Add savings or investments
          </button>
        </>
      ),
    },
    {
      icon: '🏡', title: 'Your home and property',
      why: 'What your home (and any other property) is worth, and what you still owe on it.',
      optional: true,
      body: (
        <>
          {a.homes.map((h, i) => {
            const upd = (p: Partial<Home>) => set({ homes: a.homes.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <Card key={i} title={h.name || (i === 0 ? 'Home' : `Property ${i + 1}`)} onRemove={() => set({ homes: a.homes.filter((_, j) => j !== i) })}>
                {a.abroad && <CurrencyPick id={`wiz-hc-${i}`} label="Which country's money is it in?" value={h.currency} home={homeCur} onChange={(v) => upd({ currency: v })} />}
                <div className="wizard-pair">
                  <Field id={`wiz-hw-${i}`} label="What could it sell for today?" help="A rough guess is fine; a recent valuation is better." value={h.worth} onChange={(v) => upd({ worth: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                  <Field id={`wiz-ho-${i}`} label="How much do you still owe on it?" help="Your mortgage balance. 0 if it's paid off." value={h.owe} onChange={(v) => upd({ owe: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                </div>
                <div className="wizard-pair">
                  <Field id={`wiz-hp-${i}`} label="Mortgage payment each month" value={h.payment} onChange={(v) => upd({ payment: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                  <Field id={`wiz-hr-${i}`} label="Rent you receive each month" help="Only if you rent it out. After costs like rates and repairs." value={h.rent} onChange={(v) => upd({ rent: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                </div>
                <Field id={`wiz-hs-${i}`} label="Planning to sell it? At what age?" help="Optional. The money (after the mortgage and selling costs) goes into your savings." value={h.sellAge} onChange={(v) => upd({ sellAge: v })} suffix="years" />
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ homes: [...a.homes, { name: a.homes.length ? `Property ${a.homes.length + 1}` : 'Home' }] })}>
            + Add {a.homes.length ? 'another property' : 'your home'}
          </button>
          {!a.homes.length && <p className="wizard-help">Renting or living with family? Just press Next.</p>}
        </>
      ),
    },
    {
      icon: '💼', title: 'Money coming in',
      why: 'What lands in your bank account each month, after tax, and what you expect in retirement.',
      body: (
        <>
          <div className="wizard-pair">
            <Field id="wiz-pay" label="Your take-home pay each month" help="After tax. Stops when you stop working." value={a.pay} onChange={(v) => set({ pay: v })} prefix={cur} />
            {couple && <Field id="wiz-ppay" label="Your partner's take-home pay each month" value={a.partnerPay} onChange={(v) => set({ partnerPay: v })} prefix={cur} />}
          </div>
          <div className="wizard-pair">
            <Field id="wiz-pen" label={`${c.pension.name} you expect, each month`} help={`Starts at ${c.pension.age}. Check your expected amount with ${c.officialSources[c.officialSources.length - 1].label}.`} value={a.pension} onChange={(v) => set({ pension: v })} prefix={cur} />
            {couple && <Field id="wiz-ppen" label={`Your partner's ${c.pension.name}, each month`} value={a.partnerPension} onChange={(v) => set({ partnerPension: v })} prefix={cur} />}
          </div>
          <Field id="wiz-oth" label="Any other money coming in each month?" help="For example dividends, a side business, or rent from somewhere not listed." value={a.otherIncome} onChange={(v) => set({ otherIncome: v })} prefix={cur} />
          {a.abroad ? (
            <>
              <p className="wizard-q">Pensions from other countries</p>
              <p className="wizard-help">For example a UK State Pension or a Philippine SSS pension from years you worked there. Each starts at that country&apos;s pension age.</p>
              {(a.foreignPensions ?? []).map((p, i) => {
                const upd = (patch: Partial<ForeignPension>) => set({ foreignPensions: (a.foreignPensions ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <Card key={i} title={COUNTRIES[p.country].pension.name} onRemove={() => set({ foreignPensions: (a.foreignPensions ?? []).filter((_, j) => j !== i) })}>
                    <div className="wizard-pair">
                      <div className="wizard-field">
                        <label htmlFor={`wiz-fpc-${i}`}>Which country pays it?</label>
                        <select id={`wiz-fpc-${i}`} className="planner-select wizard-select" value={p.country} onChange={(e) => upd({ country: e.target.value as CountryCode })}>
                          {COUNTRY_CODES.map((k) => <option key={k} value={k}>{COUNTRIES[k].name}</option>)}
                        </select>
                      </div>
                      <Field id={`wiz-fpm-${i}`} label="About how much each month?" help={`In ${COUNTRIES[p.country].currency}. Starts at ${COUNTRIES[p.country].pension.age}.`} value={p.monthly} onChange={(v) => upd({ monthly: v })} prefix={COUNTRIES[p.country].currency} />
                    </div>
                    {couple && <Choice name={`wiz-fpo-${i}`} value={p.owner} onChange={(v) => upd({ owner: v })} options={[['you', 'Mine'], ['partner', "My partner's"]]} />}
                  </Card>
                );
              })}
              <button type="button" className="wizard-add" onClick={() => set({ foreignPensions: [...(a.foreignPensions ?? []), { country: COUNTRY_CODES.find((k) => k !== country)!, owner: 'you' }] })}>
                + Add a pension from another country
              </button>
            </>
          ) : (
            <p className="wizard-help">Pension from another country too? Choose &quot;Yes&quot; to the overseas question on the first step.</p>
          )}
        </>
      ),
    },
    {
      icon: '🛒', title: 'Money going out',
      why: 'What you spend to live: food, power, phone, petrol, insurance and fun.',
      body: (
        <>
          <Field id="wiz-spend" label="Everyday spending each month" help="Leave out mortgage payments and money you put into savings; we've counted those already. If you used a bank statement, take them off this number." value={a.spending} onChange={(v) => set({ spending: v })} prefix={cur} />
          <Field id="wiz-spendr" label="Spending each month once you've stopped working" help={retireIn && retireIn !== country ? `In ${COUNTRIES[retireIn].currency}, as you'll live in ${COUNTRIES[retireIn].name}. Leave blank to keep the same as now.` : 'Often a bit less (no commuting) or more (travel). Leave blank to keep it the same.'} value={a.spendingRetired} onChange={(v) => set({ spendingRetired: v })} prefix={retireIn && retireIn !== country ? COUNTRIES[retireIn].currency : cur} />
          <div className="wizard-pair">
            <Field id="wiz-loan" label="Other loans you owe" help="Car loans, personal loans, credit cards." value={a.loanOwe} onChange={(v) => set({ loanOwe: v })} prefix={cur} />
            <Field id="wiz-loanp" label="Paying back each month" value={a.loanPayment} onChange={(v) => set({ loanPayment: v })} prefix={cur} />
          </div>
          <p className="wizard-q">Anyone (or any pet) you look after?</p>
          {a.family.map((f, i) => {
            const upd = (p: Partial<Family>) => set({ family: a.family.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <Card key={i} title={f.kind === 'child' ? 'Child' : f.kind === 'parent' ? 'Parent' : 'Pet'} onRemove={() => set({ family: a.family.filter((_, j) => j !== i) })}>
                <Choice name={`wiz-fam-${i}`} value={f.kind} onChange={(v) => upd({ kind: v })} options={[['child', 'Child'], ['parent', 'Parent'], ['pet', 'Pet']]} />
                <div className="wizard-pair">
                  <Field id={`wiz-fm-${i}`} label="Costs each month" value={f.monthly} onChange={(v) => upd({ monthly: v })} prefix={cur} />
                  <Field id={`wiz-fy-${i}`} label="For about how many more years?" value={f.years} onChange={(v) => upd({ years: v })} suffix="years" placeholder="e.g. 10" />
                </div>
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ family: [...a.family, { kind: 'child' }] })}>+ Add a child, parent or pet</button>
        </>
      ),
    },
    {
      icon: '✨', title: 'Big moments ahead',
      why: 'Optional. Things you already know are coming, like an inheritance or a big expense.',
      optional: true,
      body: (
        <>
          <p className="wizard-help">Selling a property or cashing out an investment? Add the age on its card in the earlier steps.</p>
          <div className="wizard-pair">
            <Field id="wiz-gift" label="Money you expect to receive" help="For example an inheritance." value={a.gift} onChange={(v) => set({ gift: v })} prefix={cur} />
            <Field id="wiz-gifta" label="At about what age?" value={a.giftAge} onChange={(v) => set({ giftAge: v })} suffix="years" />
          </div>
          <div className="wizard-pair">
            <Field id="wiz-big" label="A big expense coming up" help="For example a renovation, a car or a wedding." value={a.bigSpend} onChange={(v) => set({ bigSpend: v })} prefix={cur} />
            <Field id="wiz-biga" label="At about what age?" value={a.bigSpendAge} onChange={(v) => set({ bigSpendAge: v })} suffix="years" />
          </div>
        </>
      ),
    },
    {
      icon: '🎯', title: 'Your goal',
      why: 'Optional. A number to aim for, so you can see whether you\'re on track.',
      optional: true,
      body: (
        <Field id="wiz-goal" label="How much would you like to have by the time you stop working?" help="Everything you own minus what you owe, in today's money. Leave blank to skip." value={a.goal} onChange={(v) => set({ goal: v })} prefix={cur} />
      ),
    },
  ];

  const last = steps.length; // the results screen
  const plan = step === last ? livePlan : null;
  const result = useMemo(() => {
    if (!plan) return null;
    try {
      const r = projectHousehold(plan);
      return { r, analysis: analyseHousehold(r) };
    } catch {
      return null;
    }
  }, [plan]);

  const go = (to: number) => {
    setStep(to);
    // Bring the top of the wizard into view, not the top of the page
    requestAnimationFrame(() => document.getElementById('wizard-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if (step === last) {
    const r = result?.r;
    const atRet = r?.milestones.find((m) => m.age === r.retirementAge);
    return (
      <section id="wizard-top" className="wizard wizard-results" aria-labelledby="wiz-results-title">
        <div className="wizard-progress" aria-hidden="true"><span style={{ width: '100%' }} /></div>
        <div className="wizard-step-head">
          <span className="wizard-icon" aria-hidden="true">🎉</span>
          <div>
            <h2 id="wiz-results-title">Here&apos;s your money future</h2>
            <p>Based on your answers, in today&apos;s money. Change any answer and see what happens.</p>
          </div>
        </div>
        {!r || !atRet ? (
          <p className="wizard-help is-gentle">We couldn&apos;t work this out. Go back and check your ages.</p>
        ) : (
          <>
            <div className="wizard-highlights">
              <div><span>What you own today</span><strong>{money(r.today.netWorth)}</strong><small>Minus what you owe</small></div>
              <div><span>By age {r.retirementAge}</span><strong>{money(atRet.expected)}</strong><small>{money(atRet.liquid)} of it is savings you can spend</small></div>
              <div className={r.scenarios[1].shortfallAge === null ? 'is-good' : 'is-watch'}>
                <span>Your savings last</span>
                <strong>{r.scenarios[1].shortfallAge === null ? `Past ${r.inputs.endAge} ✓` : `Until about ${r.scenarios[1].shortfallAge}`}</strong>
                <small>{Math.round(r.monteCarlo.successRate * 100)}% of 300 test markets lasted the distance</small>
              </div>
            </div>
            {r.goal && (
              <p className={`wizard-goal ${r.goal.onTrack ? 'is-good' : 'is-watch'}`}>
                {r.goal.onTrack ? `🎯 You're on track for your ${money(r.goal.target)} goal.` : `🎯 You're about ${money(r.goal.gap)} short of your ${money(r.goal.target)} goal. The ideas below show what could close the gap.`}
              </p>
            )}
            <BasisLabel country={r.inputs.country} inflationPct={r.inputs.inflationPct} retireIn={r.inputs.retireIn} fx={r.inputs.fx} />
            <HouseholdChart result={r} height={300} />
            <HouseholdWarnings result={r} />
            {result && <HouseholdAnalysisView analysis={result.analysis} country={r.inputs.country} />}
          </>
        )}
        <div className="wizard-nav">
          <button type="button" className="wizard-button is-quiet" onClick={() => go(0)}>← Change my answers</button>
          <button type="button" className="start-again" onClick={() => { if (window.confirm('Clear all your answers and start again?')) { setA(START); go(0); } }}>🧹 Start again</button>
          {plan && <button type="button" className="wizard-button" onClick={() => openInAllDetails(plan)}>See every detail and fine-tune</button>}
        </div>
        <PlanFileActions plan={plan} onOpen={openInAllDetails} />
        <p className="wizard-privacy">🔒 Worked out on this device. Nothing was sent to us. <ClearDeviceData label="Clear my answers from this device" onCleared={() => { setA(START); go(0); }} /></p>
        <p className="disclaimer-note">These are illustrations based on your answers, not predictions or financial advice.</p>
      </section>
    );
  }

  const s = steps[step];
  const pct = Math.round((step / last) * 100);
  return (
    <div className="wizard-layout">
    <section id="wizard-top" className="wizard" aria-labelledby="wiz-title">
      <div className="wizard-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress"><span style={{ width: `${Math.max(4, pct)}%` }} /></div>
      <div className="wizard-count-row">
        <p className="wizard-count">Step {step + 1} of {last}</p>
        <button type="button" className="start-again" onClick={() => { if (window.confirm('Clear all your answers and start again?')) { setA(START); go(0); } }}>🧹 Start again</button>
      </div>
      <div className="wizard-step-head">
        <span className="wizard-icon" aria-hidden="true">{s.icon}</span>
        <div>
          <h2 id="wiz-title">{s.title}</h2>
          <p>{s.why}</p>
        </div>
      </div>
      <div className="wizard-body">{s.body}</div>
      <div className="wizard-nav">
        {step > 0 ? <button type="button" className="wizard-button is-quiet" onClick={() => go(step - 1)}>← Back</button> : <span />}
        <div className="wizard-nav-right">
          {s.optional && <button type="button" className="link-button" onClick={() => go(step + 1)}>Skip this step</button>}
          <button type="button" className="wizard-button" disabled={s.canGoOn === false} onClick={() => go(step + 1)}>
            {step === last - 1 ? 'Show my results 🎉' : 'Next →'}
          </button>
        </div>
      </div>
      <p className="wizard-privacy">🔒 Your answers stay on this device. <ClearDeviceData label="Clear my answers" onCleared={() => { setA(START); go(0); }} /></p>
    </section>
    <PlanPreview answers={a} plan={ageOk ? livePlan : null} money={money} onFinish={() => go(last)} cashflowKnown={a.pay !== undefined || a.partnerPay !== undefined || a.spending !== undefined} />
    </div>
  );
}

/** Live "Your plan so far" panel beside the steps on wider screens. */
function PlanPreview({ answers, plan, money, onFinish, cashflowKnown }: { answers: Answers; plan: HouseholdInput | null; money: (n: number) => string; onFinish: () => void; cashflowKnown: boolean }) {
  const r = useMemo(() => {
    if (!plan) return null;
    try { return projectHousehold(plan, { monteCarlo: false }); } catch { return null; }
  }, [plan]);
  const atRet = r?.milestones.find((m) => m.age === r.retirementAge);
  const filled = [answers.bank, answers.pay, answers.spending].filter((x) => x !== undefined).length + answers.savings.length + answers.homes.length;
  return (
    <aside className="wizard-preview no-print" aria-label="Your plan so far">
      <p className="wizard-preview-title">✨ Your plan so far</p>
      {!r || !atRet ? (
        <div className="wizard-preview-empty">
          <p>Your picture builds here as you answer.</p>
          <ol>
            <li>Tell us who the plan is for</li>
            <li>Add your age</li>
            <li>Add what you have, earn and spend</li>
          </ol>
        </div>
      ) : (
        <>
          <div className="wizard-preview-stats">
            <div><span>You own today</span><strong>{money(r.today.netWorth)}</strong></div>
            <div><span>By age {r.retirementAge}</span><strong>{money(atRet.expected)}</strong></div>
            {cashflowKnown ? (
              <>
                <div className={r.scenarios[1].shortfallAge === null ? 'is-good' : 'is-watch'}>
                  <span>Savings last</span>
                  <strong>{r.scenarios[1].shortfallAge === null ? `Past ${r.inputs.endAge}` : `To about ${r.scenarios[1].shortfallAge}`}</strong>
                </div>
                <div><span>Left over each month</span><strong>{money(r.today.monthlySurplus)}</strong></div>
              </>
            ) : (
              <div className="wizard-preview-wait"><span>How long savings last</span><p>Shows once you add what comes in and goes out (step 6 and 7).</p></div>
            )}
          </div>
          <HouseholdChart result={r} height={190} />
          <p className="wizard-help">{filled < 3 ? 'Keep going: the more you add, the clearer this gets.' : 'Looking good. Finish the steps for the full results and ideas to improve your plan.'}</p>
          <button type="button" className="wizard-button is-quiet" onClick={onFinish}>Jump to my results</button>
        </>
      )}
    </aside>
  );
}
