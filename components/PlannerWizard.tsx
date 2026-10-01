'use client';
/**
 * Guided setup for the wealth projector: one topic per screen, plain words,
 * a short reason for each question, and no example numbers filled in.
 * Everything stays on this device. At the end it shows the results, and
 * "See every detail" opens the same plan in the full form.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { projectHousehold, type HouseholdInput } from '../lib/finance/household';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import { projectorLink } from '../lib/finance/householdLink';
import { COUNTRIES, moneyFor, profile, type CountryCode } from '../lib/countries';
import { BasisLabel, CountrySelect, RetireInSelect, useCountry, useRetireIn } from './CountryPicker';
import { HouseholdAnalysisView, HouseholdChart, HouseholdWarnings } from './HouseholdCharts';
import StatementImport from './StatementImport';
import ClearDeviceData from './ClearDeviceData';

type Style = 'careful' | 'balanced' | 'growth';
const STYLE_RETURN: Record<Style, number> = { careful: 4, balanced: 5.5, growth: 7 };

type Savings = { name: string; kind: 'retirement' | 'investments' | 'term' | 'other'; amount?: number; monthly?: number; style: Style };
type Home = { name: string; worth?: number; owe?: number; payment?: number; rent?: number };
type Family = { kind: 'child' | 'parent' | 'pet'; monthly?: number; years?: number };

export interface Answers {
  who: 'me' | 'couple';
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

const START: Answers = { who: 'me', savings: [], homes: [], family: [] };
const n = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? x : 0);

/** Turns the plain-language answers into a full household plan. */
export function answersToPlan(a: Answers, country: CountryCode, retireIn: CountryCode | null): HouseholdInput {
  const c = profile(country);
  const age = n(a.age) || 40;
  const stop = n(a.stopAge) || Math.max(age, c.pension.age);
  const couple = a.who === 'couple';
  const pAge = n(a.partnerAge) || age;
  const pStop = n(a.partnerStopAge) || Math.max(pAge, c.pension.age);
  const homes = a.homes.filter((h) => n(h.worth) > 0);
  return {
    country,
    retireIn: retireIn && retireIn !== country ? retireIn : undefined,
    you: { currentAge: age, retirementAge: stop },
    partner: couple ? { currentAge: pAge, retirementAge: pStop } : undefined,
    endAge: Math.max(90, age + 5),
    inflationPct: c.inflationPct,
    cashOnHand: n(a.bank),
    investments: a.savings.filter((s) => n(s.amount) > 0 || n(s.monthly) > 0).map((s) => ({
      name: s.name || 'Savings',
      kind: s.kind === 'retirement' ? (country === 'NZ' ? 'kiwisaver' : 'retirement_account') : s.kind === 'term' ? 'term_deposit' : s.kind === 'investments' ? 'shares' : 'other',
      balance: n(s.amount),
      returnPct: s.kind === 'term' ? 4 : STYLE_RETURN[s.style],
      feesPct: s.kind === 'term' ? 0 : 0.5,
      monthlyContribution: n(s.monthly),
      contributionsStopAtRetirement: true,
    })),
    properties: homes.map((h, i) => ({
      name: h.name || (i === 0 ? 'Home' : `Property ${i + 1}`),
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
    ],
    livingExpensesMonthly: n(a.spending),
    retirementLivingExpensesMonthly: a.spendingRetired !== undefined && Number.isFinite(a.spendingRetired) ? a.spendingRetired : undefined,
    dependants: a.family.filter((f) => n(f.monthly) > 0).map((f) => ({
      name: f.kind === 'child' ? 'Child' : f.kind === 'parent' ? 'Parent' : 'Pet', kind: f.kind,
      monthlyCost: n(f.monthly), years: n(f.years) || 10, startInYears: 0,
    })),
    events: [
      ...(n(a.sellHomeAge) > age && homes.length ? [{ name: `Sell ${homes[0].name || 'Home'}`, kind: 'sell_property' as const, atAge: n(a.sellHomeAge), propertyName: homes[0].name || 'Home' }] : []),
      ...(n(a.gift) > 0 && n(a.giftAge) > age ? [{ name: 'Money you expect to receive', kind: 'money_in' as const, atAge: n(a.giftAge), amount: n(a.gift) }] : []),
      ...(n(a.bigSpend) > 0 && n(a.bigSpendAge) > age ? [{ name: 'Big purchase', kind: 'money_out' as const, atAge: n(a.bigSpendAge), amount: n(a.bigSpend) }] : []),
    ],
    goal: n(a.goal) > 0 ? { targetNetWorth: n(a.goal) } : undefined,
  };
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

export default function PlannerWizard() {
  const [country, setCountry] = useCountry();
  const [retireIn, setRetireIn] = useRetireIn();
  const [a, setA] = useState<Answers>(START);
  const [step, setStep] = useState(0);
  const set = (patch: Partial<Answers>) => setA((p) => ({ ...p, ...patch }));
  const c = COUNTRIES[country];
  const money = moneyFor(country);
  const cur = c.currency;
  const couple = a.who === 'couple';

  const ageOk = a.age !== undefined && a.age >= 16 && a.age <= 100 && (!couple || (a.partnerAge !== undefined && a.partnerAge >= 16 && a.partnerAge <= 100));
  const stopOk = (a.stopAge === undefined || (a.stopAge >= 16 && a.stopAge <= 100)) && (a.partnerStopAge === undefined || (a.partnerStopAge >= 16 && a.partnerStopAge <= 100));

  const steps: { icon: string; title: string; why: string; body: ReactNode; canGoOn?: boolean; optional?: boolean }[] = [
    {
      icon: '👋', title: "Hello! Let's picture your money future",
      why: 'A few easy questions, about 5 minutes. Rough numbers are fine, and you can skip anything that doesn\'t apply. Everything stays on this device.',
      body: (
        <>
          <p className="wizard-q">Who is this plan for?</p>
          <Choice name="who" value={a.who} onChange={(v) => set({ who: v })}
            options={[['me', 'Just me', 'Your own money'], ['couple', 'Me and my partner', 'Money you share']]} />
          <div className="wizard-pair">
            <CountrySelect id="wiz-country" value={country} onChange={setCountry} label="Where do you live?" />
            <RetireInSelect id="wiz-retire" value={retireIn && retireIn !== country ? retireIn : null} livesIn={country} onChange={setRetireIn} />
          </div>
          <p className="wizard-help">This sets your currency ({cur}) and the usual pension age ({c.pension.name} from {c.pension.age}).</p>
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
                <div className="wizard-pair">
                  <Field id={`wiz-sav-${i}`} label="How much is in it now?" value={s.amount} onChange={(v) => upd({ amount: v })} prefix={cur} />
                  <Field id={`wiz-savm-${i}`} label="How much goes in each month?" help="Include anything your employer adds." value={s.monthly} onChange={(v) => upd({ monthly: v })} prefix={cur} />
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
                <div className="wizard-pair">
                  <Field id={`wiz-hw-${i}`} label="What could it sell for today?" help="A rough guess is fine; a recent valuation is better." value={h.worth} onChange={(v) => upd({ worth: v })} prefix={cur} />
                  <Field id={`wiz-ho-${i}`} label="How much do you still owe on it?" help="Your mortgage balance. 0 if it's paid off." value={h.owe} onChange={(v) => upd({ owe: v })} prefix={cur} />
                </div>
                <div className="wizard-pair">
                  <Field id={`wiz-hp-${i}`} label="Mortgage payment each month" value={h.payment} onChange={(v) => upd({ payment: v })} prefix={cur} />
                  <Field id={`wiz-hr-${i}`} label="Rent you receive each month" help="Only if you rent it out. After costs like rates and repairs." value={h.rent} onChange={(v) => upd({ rent: v })} prefix={cur} />
                </div>
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
          <p className="wizard-help">Pension from another country too? You can add it in &quot;See every detail&quot; at the end.</p>
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
      why: 'Optional. Things you already know are coming, like selling a house or receiving an inheritance.',
      optional: true,
      body: (
        <>
          {a.homes.length > 0 && (
            <Field id="wiz-sell" label={`Planning to sell your ${a.homes[0].name || 'home'}? At what age?`} help="The money (after the mortgage and selling costs) goes into your savings. Leave blank if not." value={a.sellHomeAge} onChange={(v) => set({ sellHomeAge: v })} suffix="years" />
          )}
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
  const plan = useMemo(() => (step === last ? answersToPlan(a, country, retireIn) : null), [step, last, a, country, retireIn]);
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
          {plan && <a className="wizard-button" href={projectorLink(plan).replace('/calculator#', '/calculator?view=full#')}>See every detail and fine-tune</a>}
        </div>
        <p className="wizard-privacy">🔒 Worked out on this device. Nothing was sent to us. <ClearDeviceData label="Clear my answers from this device" onCleared={() => { setA(START); go(0); }} /></p>
        <p className="disclaimer-note">These are illustrations based on your answers, not predictions or financial advice.</p>
      </section>
    );
  }

  const s = steps[step];
  const pct = Math.round((step / last) * 100);
  return (
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
  );
}
