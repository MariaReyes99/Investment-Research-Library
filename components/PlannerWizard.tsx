'use client';
/**
 * Guided setup for the wealth projector: one topic per screen, plain words,
 * a short reason for each question, and no example numbers filled in.
 * Everything stays on this device. At the end it shows the results, and
 * "Open in Advanced" opens the same plan in the Advanced view.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CURRENCIES, projectHousehold, usedCurrencies, type Currency, type HouseholdInput } from '../lib/finance/household';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import { projectorLink } from '../lib/finance/householdLink';
import { COUNTRIES, COUNTRY_CODES, localTerms, moneyFor, profile, retirementSavingsLabel, type CountryCode } from '../lib/countries';
import { HINTS, feesHint, growthHint, inflationHint } from '../lib/fieldGuide';
import { BasisLabel, CountrySelect, RetireInSelect, useCountry, useRetireIn } from './CountryPicker';
import { HouseholdAnalysisView, HouseholdChart, HouseholdWarnings } from './HouseholdCharts';
import StatementImport from './StatementImport';
import ClearDeviceData from './ClearDeviceData';
import PlanFileActions from './PlanFileActions';
import TrustedTools from './TrustedTools';
import BufferCheck from './BufferCheck';

type Style = 'careful' | 'balanced' | 'growth';
const STYLE_RETURN: Record<Style, number> = { careful: 4, balanced: 5.5, growth: 7 };
/** Typical yearly fees used when none are entered (check the fund's fact sheet). */
const DEFAULT_FEES: Record<SavingsKind, number> = { retirement: 0.5, index: 0.2, investments: 0.2, managed: 0.9, shares: 0.1, term: 0, other: 0.5 };
const ENGINE_KIND = {
  index: 'index_fund', investments: 'index_fund', managed: 'managed_fund', shares: 'shares', term: 'term_deposit', other: 'other',
} as const;

/** 'investments' is from earlier versions and is read as an index fund. */
type SavingsKind = 'retirement' | 'index' | 'managed' | 'shares' | 'term' | 'other' | 'investments';
type Savings = { name: string; kind: SavingsKind; amount?: number; monthly?: number; style: Style; currency?: Currency; cashOutAge?: number; cashOutPct?: number; growthPct?: number; feesPct?: number };
type Home = {
  name: string; worth?: number; owe?: number; payment?: number; rent?: number; currency?: Currency; sellAge?: number; growthPct?: number; yearlyCosts?: number;
  /** Reverse mortgage: stay in the home and release money from it */
  rmAge?: number; rmLump?: number; rmMonthly?: number; rmRate?: number;
};
type OtherCost = { name: string; monthly?: number; years?: number };
type ForeignPension = { country: CountryCode; monthly?: number; owner: 'you' | 'partner' };
type Family = { kind: 'child' | 'parent' | 'pet'; monthly?: number; years?: number; startIn?: number };

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
  /** Things you own */
  car?: number; carLossPct?: number; valuables?: number; valuablesChangePct?: number;
  otherCosts?: OtherCost[];
  inflationPct?: number;
  /** How savings are used in retirement */
  drawdown?: 'needs' | 'six_percent' | 'inflated_four' | 'fixed_date' | 'guardrails';
  drawdownUntil?: number;
}

const START: Answers = { who: 'me', savings: [], homes: [], family: [], foreignPensions: [] };

/** Answers are kept in this browser until "Start again" or "Clear my data", so leaving the page doesn't lose them. */
const GUIDED_KEY = 'irl:guided';
const FULL_KEY = 'irl:full-plan';
const FULL_AT_KEY = 'irl:full-plan-at';
type Base = { plan: HouseholdInput; answers: Answers };
type SavedGuided = { a: Answers; step: number; base?: Base; at: number };

function loadGuided(): SavedGuided | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(GUIDED_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || !raw.a || typeof raw.a.who !== 'string') return null;
    return { a: { ...START, ...raw.a }, step: Number.isInteger(raw.step) ? raw.step : 0, base: raw.base ?? undefined, at: Number(raw.at) || 0 };
  } catch {
    return null;
  }
}
function saveGuided(a: Answers, step: number, base: Base | null) {
  try {
    if (a === START && step === 0) window.localStorage.removeItem(GUIDED_KEY);
    else window.localStorage.setItem(GUIDED_KEY, JSON.stringify({ a, step, base: base ?? undefined, at: Date.now() }));
  } catch { /* private browsing: answers last for this visit only */ }
}
/** The "Advanced" plan, if it was changed more recently than the guided answers. */
function newerFullPlan(guidedAt: number): HouseholdInput | null {
  try {
    const at = Number(window.localStorage.getItem(FULL_AT_KEY)) || 0;
    if (at <= guidedAt) return null;
    const plan = JSON.parse(window.localStorage.getItem(FULL_KEY) ?? 'null');
    return plan && plan.you ? (plan as HouseholdInput) : null;
  } catch {
    return null;
  }
}
/** Both calculators hold one plan, so starting again clears both. */
function forgetBothPlans() {
  try { [GUIDED_KEY, FULL_KEY, FULL_AT_KEY].forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
}

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
    inflationPct: a.inflationPct ?? c.inflationPct,
    cashOnHand: n(a.bank),
    investments: savings.map((s, i) => ({
      name: saveName(s, i),
      currency: cur(s.currency),
      kind: s.kind === 'retirement' ? (country === 'NZ' ? 'kiwisaver' : 'retirement_account') : ENGINE_KIND[s.kind],
      balance: n(s.amount),
      returnPct: s.growthPct ?? (s.kind === 'term' ? 4 : STYLE_RETURN[s.style]),
      feesPct: s.feesPct ?? DEFAULT_FEES[s.kind],
      monthlyContribution: n(s.monthly),
      contributionsStopAtRetirement: true,
    })),
    properties: homes.map((h, i) => ({
      name: homeName(h, i),
      currency: cur(h.currency),
      value: n(h.worth), growthPct: h.growthPct ?? 3, mortgageBalance: n(h.owe), mortgageRatePct: 5.5,
      monthlyRepayment: n(h.payment), monthlyNetRent: n(h.rent), monthlyCosts: Math.round(n(h.yearlyCosts) / 12),
    })),
    otherAssets: [
      ...(n(a.car) > 0 ? [{ name: 'Car', kind: 'vehicle' as const, value: n(a.car), changePct: -(a.carLossPct ?? 10) }] : []),
      ...(n(a.valuables) > 0 ? [{ name: 'Valuables', kind: 'other' as const, value: n(a.valuables), changePct: a.valuablesChangePct ?? 0 }] : []),
    ],
    otherExpenses: (a.otherCosts ?? []).filter((x) => n(x.monthly) > 0).map((x) => ({
      name: x.name || 'Other cost', monthlyAmount: n(x.monthly), years: x.years && x.years > 0 ? x.years : undefined, startInYears: 0,
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
      monthlyCost: n(f.monthly), years: n(f.years) || 10, startInYears: n(f.startIn),
    })),
    events: [
      ...homes.flatMap((h, i) => (n(h.sellAge) > age ? [{ name: `Sell ${homeName(h, i)}`, kind: 'sell_property' as const, atAge: n(h.sellAge), propertyName: homeName(h, i) }] : [])),
      ...homes.flatMap((h, i) => (n(h.rmAge) > age && (n(h.rmLump) > 0 || n(h.rmMonthly) > 0) ? [{
        name: `Reverse mortgage on ${homeName(h, i)}`, kind: 'reverse_mortgage' as const, atAge: n(h.rmAge), propertyName: homeName(h, i),
        amount: n(h.rmLump), monthlyAmount: n(h.rmMonthly), loanRatePct: h.rmRate ?? 9,
      }] : [])),
      ...savings.flatMap((s, i) => (n(s.cashOutAge) > age ? [{ name: `Cash out ${saveName(s, i)}`, kind: 'sell_investment' as const, atAge: n(s.cashOutAge), investmentName: saveName(s, i), sharePct: Math.min(100, Math.max(1, n(s.cashOutPct) || 100)) }] : [])),
      ...(n(a.gift) > 0 && n(a.giftAge) > age ? [{ name: 'Money you expect to receive', kind: 'money_in' as const, atAge: n(a.giftAge), amount: n(a.gift) }] : []),
      ...(n(a.bigSpend) > 0 && n(a.bigSpendAge) > age ? [{ name: 'Big purchase', kind: 'money_out' as const, atAge: n(a.bigSpendAge), amount: n(a.bigSpend) }] : []),
    ],
    goal: n(a.goal) > 0 ? { targetNetWorth: n(a.goal) } : undefined,
    withdrawal: { strategy: a.drawdown ?? 'needs', ratePct: 4, untilAge: a.drawdown === 'fixed_date' ? Math.max(age + 1, n(a.drawdownUntil) || 85) : undefined },
    // Until pay or spending is entered, assume savings come from income we haven't been told about yet
    contributionsFromOutsideIncome: a.pay === undefined && a.partnerPay === undefined && a.spending === undefined,
  };
  // An exchange rate for every other currency used: today's rate if we have it, otherwise a rough one
  plan.fx = usedCurrencies({ ...plan, investments: plan.investments ?? [], properties: plan.properties ?? [], otherAssets: plan.otherAssets ?? [], debts: [], incomes: plan.incomes ?? [], dependants: [], otherExpenses: [], events: [] } as Parameters<typeof usedCurrencies>[0])
    .filter((x) => x !== home)
    .map((x) => ({ currency: x, rate: rates[x] ?? Number((ROUGH_USD[x] / ROUGH_USD[home]).toPrecision(4)), yearlyChangePct: 0 }));
  return plan;
}

const pos = (x: number | undefined) => (x !== undefined && Number.isFinite(x) && x > 0 ? x : undefined);
const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Turns an "Advanced" plan into guided answers, so the guided setup shows the latest numbers. */
export function planToAnswers(p: HouseholdInput): Answers {
  const home = COUNTRIES[p.country ?? 'NZ'].currency as Currency;
  const events = p.events ?? [];
  const investments = p.investments ?? [];
  const properties = p.properties ?? [];
  const incomes = p.incomes ?? [];
  const debts = p.debts ?? [];
  const others = p.otherAssets ?? [];
  const isHome = (cur?: Currency) => !cur || cur === home;
  const ownerOf = (o?: string) => (o === 'partner' ? 'partner' : 'you');
  const vehicles = others.filter((o) => o.kind === 'vehicle');
  const valuables = others.filter((o) => o.kind !== 'vehicle');
  const moneyIn = events.find((ev) => ev.kind === 'money_in');
  const moneyOut = events.find((ev) => ev.kind === 'money_out');
  return {
    who: p.partner ? 'couple' : 'me',
    age: p.you.currentAge, stopAge: p.you.retirementAge,
    partnerAge: p.partner?.currentAge, partnerStopAge: p.partner?.retirementAge,
    abroad: Boolean(p.retireIn || (p.fx ?? []).length || [...investments, ...properties, ...incomes].some((x) => !isHome(x.currency))),
    bank: pos(p.cashOnHand),
    savings: investments.map((i) => {
      const cash = events.find((ev) => ev.kind === 'sell_investment' && ev.investmentName === i.name);
      const kind: SavingsKind = i.kind === 'kiwisaver' || i.kind === 'retirement_account' ? 'retirement'
        : i.kind === 'term_deposit' ? 'term' : i.kind === 'managed_fund' ? 'managed' : i.kind === 'shares' ? 'shares'
        : i.kind === 'other' || i.kind === 'bonds' ? 'other' : 'index';
      return {
        name: i.name, kind, amount: pos(i.balance), monthly: pos(i.monthlyContribution),
        style: (i.returnPct <= 4.75 ? 'careful' : i.returnPct <= 6.25 ? 'balanced' : 'growth') as Style,
        growthPct: i.returnPct, feesPct: i.feesPct, currency: isHome(i.currency) ? undefined : i.currency,
        cashOutAge: cash?.atAge, cashOutPct: cash && cash.sharePct !== undefined && cash.sharePct < 100 ? cash.sharePct : undefined,
      };
    }),
    homes: properties.map((pr) => {
      const sale = events.find((ev) => ev.kind === 'sell_property' && ev.propertyName === pr.name);
      const rm = events.find((ev) => ev.kind === 'reverse_mortgage' && ev.propertyName === pr.name);
      return {
        name: pr.name, worth: pos(pr.value), owe: pos(pr.mortgageBalance), payment: pos(pr.monthlyRepayment), rent: pos(pr.monthlyNetRent),
        currency: isHome(pr.currency) ? undefined : pr.currency, growthPct: pr.growthPct,
        yearlyCosts: pos((pr.monthlyCosts ?? 0) * 12), sellAge: sale?.atAge,
        rmAge: rm?.atAge, rmLump: pos(rm?.amount), rmMonthly: pos(rm?.monthlyAmount), rmRate: rm?.loanRatePct,
      };
    }),
    pay: pos(sumOf(incomes.filter((i) => i.kind === 'salary' && ownerOf(i.owner) === 'you').map((i) => i.monthlyAmount))),
    partnerPay: pos(sumOf(incomes.filter((i) => i.kind === 'salary' && i.owner === 'partner').map((i) => i.monthlyAmount))),
    pension: pos(sumOf(incomes.filter((i) => i.kind === 'pension' && isHome(i.currency) && ownerOf(i.owner) === 'you').map((i) => i.monthlyAmount))),
    partnerPension: pos(sumOf(incomes.filter((i) => i.kind === 'pension' && isHome(i.currency) && i.owner === 'partner').map((i) => i.monthlyAmount))),
    foreignPensions: incomes.filter((i) => i.kind === 'pension' && !isHome(i.currency)).map((i) => ({
      country: COUNTRY_CODES.find((k) => COUNTRIES[k].currency === i.currency) ?? (p.country ?? 'NZ'),
      monthly: pos(i.monthlyAmount), owner: ownerOf(i.owner) as 'you' | 'partner',
    })),
    otherIncome: pos(sumOf(incomes.filter((i) => i.kind !== 'salary' && i.kind !== 'pension').map((i) => i.monthlyAmount))),
    spending: pos(p.livingExpensesMonthly), spendingRetired: p.retirementLivingExpensesMonthly,
    loanOwe: pos(sumOf(debts.map((d) => d.balance))), loanPayment: pos(sumOf(debts.map((d) => d.monthlyPayment ?? 0))),
    family: (p.dependants ?? []).map((d) => ({ kind: d.kind === 'parent' || d.kind === 'pet' ? d.kind : 'child', monthly: pos(d.monthlyCost), years: d.years, startIn: pos(d.startInYears) })),
    otherCosts: (p.otherExpenses ?? []).map((x) => ({ name: x.name, monthly: pos(x.monthlyAmount), years: x.years })),
    car: pos(sumOf(vehicles.map((v) => v.value))), carLossPct: vehicles[0]?.changePct !== undefined ? -vehicles[0].changePct! : undefined,
    valuables: pos(sumOf(valuables.map((v) => v.value))), valuablesChangePct: valuables[0]?.changePct,
    gift: pos(moneyIn?.amount), giftAge: moneyIn?.atAge, bigSpend: pos(moneyOut?.amount), bigSpendAge: moneyOut?.atAge,
    goal: pos(p.goal?.targetNetWorth), inflationPct: p.inflationPct,
    drawdown: p.withdrawal?.strategy && p.withdrawal.strategy !== 'percent' ? p.withdrawal.strategy : undefined,
    drawdownUntil: p.withdrawal?.untilAge,
  };
}

/**
 * Builds the plan from the guided answers on top of an "Advanced" plan.
 * Sections the person hasn't changed in the guided steps are kept exactly as
 * they were (tax settings, mortgage rates, owners, extra debts and so on);
 * changed sections take the guided answers, keeping hidden details by name.
 */
export function mergeWithBase(base: HouseholdInput, baseAnswers: Answers, a: Answers, fresh: HouseholdInput): HouseholdInput {
  const same = (keys: (keyof Answers)[]) => keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(baseAnswers[k] ?? null));
  const byName = <T extends { name: string }>(items: T[] | undefined, name: string) => (items ?? []).find((x) => x.name === name);
  const bEvents = base.events ?? [];
  const fEvents = fresh.events ?? [];
  const pick = (from: HouseholdInput['events'], kinds: string[]) => (from ?? []).filter((ev) => kinds.includes(ev.kind));
  const keepInv = same(['savings']);
  const keepHomes = same(['homes']);
  const merged: HouseholdInput = {
    ...base,
    country: fresh.country,
    retireIn: fresh.retireIn,
    you: same(['age', 'stopAge']) ? base.you : fresh.you,
    partner: same(['who', 'partnerAge', 'partnerStopAge']) ? base.partner : fresh.partner,
    cashOnHand: same(['bank']) ? base.cashOnHand : fresh.cashOnHand,
    investments: keepInv ? base.investments : (fresh.investments ?? []).map((f) => {
      const b = byName(base.investments, f.name);
      return b ? { ...b, balance: f.balance, monthlyContribution: f.monthlyContribution, returnPct: f.returnPct, feesPct: f.feesPct, currency: f.currency } : f;
    }),
    properties: keepHomes ? base.properties : (fresh.properties ?? []).map((f) => {
      const b = byName(base.properties, f.name);
      return b ? { ...b, value: f.value, mortgageBalance: f.mortgageBalance, monthlyRepayment: f.monthlyRepayment, monthlyNetRent: f.monthlyNetRent, monthlyCosts: f.monthlyCosts, growthPct: f.growthPct, currency: f.currency } : f;
    }),
    incomes: same(['pay', 'partnerPay', 'pension', 'partnerPension', 'otherIncome', 'foreignPensions']) ? base.incomes : fresh.incomes,
    livingExpensesMonthly: same(['spending']) ? base.livingExpensesMonthly : fresh.livingExpensesMonthly,
    retirementLivingExpensesMonthly: same(['spendingRetired']) ? base.retirementLivingExpensesMonthly : fresh.retirementLivingExpensesMonthly,
    debts: same(['loanOwe', 'loanPayment']) ? base.debts : fresh.debts,
    dependants: same(['family']) ? base.dependants : fresh.dependants,
    otherExpenses: same(['otherCosts']) ? base.otherExpenses : fresh.otherExpenses,
    otherAssets: same(['car', 'carLossPct', 'valuables', 'valuablesChangePct']) ? base.otherAssets : fresh.otherAssets,
    events: [
      ...pick(same(['gift', 'giftAge', 'bigSpend', 'bigSpendAge']) ? bEvents : fEvents, ['money_in', 'money_out']),
      ...pick(keepHomes ? bEvents : fEvents, ['sell_property', 'reverse_mortgage']),
      ...pick(keepInv ? bEvents : fEvents, ['sell_investment']),
    ].map((ev) => {
      const b = bEvents.find((x) => x.kind === ev.kind && x.name === ev.name);
      return b ? { ...b, ...ev } : ev; // keep selling costs, replacement home and other hidden settings
    }),
    goal: same(['goal']) ? base.goal : fresh.goal,
    inflationPct: same(['inflationPct']) ? base.inflationPct : fresh.inflationPct,
    withdrawal: same(['drawdown', 'drawdownUntil']) ? base.withdrawal : fresh.withdrawal,
    contributionsFromOutsideIncome: false,
  };
  // An exchange rate for every currency now used
  const home = COUNTRIES[merged.country ?? 'NZ'].currency as Currency;
  const known = new Map([...(base.fx ?? []), ...(fresh.fx ?? [])].map((f) => [f.currency, f]));
  merged.fx = usedCurrencies({ ...merged, investments: merged.investments ?? [], properties: merged.properties ?? [], otherAssets: merged.otherAssets ?? [], debts: merged.debts ?? [], incomes: merged.incomes ?? [], dependants: merged.dependants ?? [], otherExpenses: merged.otherExpenses ?? [], events: merged.events ?? [] } as Parameters<typeof usedCurrencies>[0])
    .filter((c) => c !== home)
    .map((c) => known.get(c) ?? { currency: c, rate: Number((ROUGH_USD[c] / ROUGH_USD[home]).toPrecision(4)), yearlyChangePct: 0 });
  return merged;
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

function TextField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="wizard-field">
      <label htmlFor={id}>{label}</label>
      <div className="wizard-input"><input id={id} value={value} maxLength={60} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>
    </div>
  );
}

/** Optional extra questions, tucked away so the main question stays simple. */
function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="wizard-more">
      <summary>{label}</summary>
      <div className="wizard-more-body">{children}</div>
    </details>
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

/** Opens a plan in the "Advanced" view. */
export function openInAllDetails(plan: HouseholdInput) {
  window.location.assign(projectorLink(plan).replace('/calculator#', '/calculator?view=full#'));
}

export default function PlannerWizard({ onPlanChange }: { onPlanChange?: (plan: HouseholdInput | null) => void }) {
  const [country, setCountry] = useCountry();
  const [retireIn, setRetireIn] = useRetireIn();
  const [a, setA] = useState<Answers>(START);
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);
  const [base, setBase] = useState<Base | null>(null);
  const [synced, setSynced] = useState(false);
  // Bring back earlier answers, or the newer "Advanced" plan if it was changed since
  useEffect(() => {
    const saved = loadGuided();
    const full = newerFullPlan(saved?.at ?? 0);
    if (full) {
      const answers = planToAnswers(full);
      setA(answers);
      setBase({ plan: full, answers });
      setStep(saved ? Math.max(1, saved.step) : 1);
      setSynced(true);
    } else if (saved) {
      setA(saved.a);
      setStep(saved.step);
      if (saved.base) setBase(saved.base);
    }
    setRestored(true);
  }, []);
  useEffect(() => { if (restored) saveGuided(a, step, base); }, [a, step, base, restored]);
  const resetAll = () => { forgetBothPlans(); setBase(null); setSynced(false); setA(START); setStep(0); };
  // Answers cleared from another page or tab
  useEffect(() => {
    const cleared = () => { setBase(null); setA(START); setStep(0); };
    window.addEventListener('irl:saved-plans-cleared', cleared);
    return () => window.removeEventListener('irl:saved-plans-cleared', cleared);
  }, []);
  const set = (patch: Partial<Answers>) => setA((p) => ({ ...p, ...patch }));
  const c = COUNTRIES[country];
  const money = moneyFor(country);
  const cur = c.currency;
  const couple = a.who === 'couple';
  const homeCur = cur as Currency;
  const [rates, setRates] = useState<Partial<Record<Currency, number>>>({});
  const livePlan = useMemo(() => {
    const fresh = answersToPlan(a, country, retireIn, rates);
    return base ? mergeWithBase(base.plan, base.answers, a, fresh) : fresh;
  }, [a, country, retireIn, rates, base]);
  const touched = a !== START;

  // Share the plan so switching to "Advanced" keeps every answer
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
          <Field id="wiz-bank" label="How much is in your bank accounts?" help={`Add up your ${localTerms(country).everydayAccount} and savings accounts. Leave out ${retirementSavingsLabel(country)} and investments; they come next.`} value={a.bank} onChange={(v) => set({ bank: v })} prefix={cur} />
          <StatementImport money={money} onApply={(s) => set({
            bank: s.bank ?? a.bank, pay: s.pay ?? a.pay, spending: s.spending ?? a.spending,
          })} />
        </>
      ),
    },
    {
      icon: '🌱', title: 'Savings and investments',
      why: `Money set aside to grow: ${retirementSavingsLabel(country)}, index funds, managed funds, shares or term deposits.`,
      optional: true,
      body: (
        <>
          {a.savings.map((s, i) => {
            const upd = (p: Partial<Savings>) => set({ savings: a.savings.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <Card key={i} title={s.name || 'Savings'} onRemove={() => set({ savings: a.savings.filter((_, j) => j !== i) })}>
                <Choice name={`wiz-kind-${i}`} value={s.kind === 'investments' ? 'index' : s.kind}
                  onChange={(v) => upd({ kind: v, name: { retirement: retirementSavingsLabel(country), index: 'Index fund', managed: 'Managed fund', shares: localTerms(country).shares, term: localTerms(country).termDeposit, other: 'Other savings', investments: 'Index fund' }[v] })}
                  options={[
                    ['retirement', retirementSavingsLabel(country), 'Retirement savings'],
                    ['index', 'Index funds / ETFs', 'Follow a whole market, low fees'],
                    ['managed', 'Managed funds', 'A manager picks investments'],
                    ['shares', `Individual ${localTerms(country).shares.toLowerCase()}`, 'In single companies'],
                    ['term', localTerms(country).termDeposit, 'Fixed interest at a bank'],
                    ['other', 'Something else'],
                  ]} />
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
                <More label="Fine-tune growth and fees (optional)">
                  <div className="wizard-pair">
                    <Field id={`wiz-savg-${i}`} label="How much do you expect it to grow each year?" help={`${growthHint(s.kind === 'retirement' ? 'retirement_account' : s.kind === 'term' ? 'term_deposit' : s.kind === 'managed' ? 'managed_fund' : s.kind === 'shares' ? 'shares' : s.kind === 'other' ? 'other' : 'index_fund')} Leave blank to use the choice above.`}
                      value={s.growthPct} onChange={(v) => upd({ growthPct: v })} suffix="% a year" placeholder={String(s.kind === 'term' ? 4 : STYLE_RETURN[s.style])} />
                    <Field id={`wiz-savf-${i}`} label="Yearly fees and costs" help={`${feesHint(s.kind === 'retirement' ? 'retirement_account' : s.kind === 'term' ? 'term_deposit' : s.kind === 'managed' ? 'managed_fund' : s.kind === 'shares' ? 'shares' : s.kind === 'other' ? 'other' : 'index_fund')} Fees slowly eat into growth.`}
                      value={s.feesPct} onChange={(v) => upd({ feesPct: v })} suffix="% a year" placeholder={String(DEFAULT_FEES[s.kind])} />
                  </div>
                </More>
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ savings: [...a.savings, { name: retirementSavingsLabel(country), kind: 'retirement', style: 'balanced' }] })}>
            + Add savings or investments
          </button>
        </>
      ),
    },
    {
      icon: '🏡', title: 'Your home and other things you own',
      why: 'What your home, any other property, your car and valuables are worth, what you still owe, and what they cost to keep.',
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
                  <Field id={`wiz-hr-${i}`} label="Rent you receive each month" help="Only if you rent it out. Running costs go in the next box." value={h.rent} onChange={(v) => upd({ rent: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                </div>
                <div className="wizard-pair">
                  <Field id={`wiz-hcost-${i}`} label="Running costs each year" help={`${localTerms(country).propertyTax.charAt(0).toUpperCase() + localTerms(country).propertyTax.slice(1)}, insurance, repairs and upkeep. Don't count these in everyday spending too.`}
                    value={h.yearlyCosts} onChange={(v) => upd({ yearlyCosts: v })} prefix={a.abroad && h.currency ? h.currency : cur} />
                  <Field id={`wiz-hg-${i}`} label="How much might its value grow each year?" help={`${HINTS.propertyGrowth} Leave blank for 3%.`}
                    value={h.growthPct} onChange={(v) => upd({ growthPct: v })} suffix="% a year" placeholder="3" />
                </div>
                <More label="Stay in the home and release money from it instead (reverse mortgage)">
                  <p className="wizard-help">
                    A reverse mortgage lets you borrow against your home without making repayments. You keep living there; interest is added to
                    the loan each year, and everything is repaid when the home is sold. Usually available from about age 60.
                  </p>
                  <div className="wizard-pair">
                    <Field id={`wiz-rma-${i}`} label="From what age?" value={h.rmAge} onChange={(v) => upd({ rmAge: v })} suffix="years" placeholder="e.g. 70" />
                    <Field id={`wiz-rmr-${i}`} label="Interest rate" help={HINTS.reverseMortgageRate} value={h.rmRate} onChange={(v) => upd({ rmRate: v === undefined ? undefined : Math.min(25, v) })} suffix="% a year" placeholder="9" />
                  </div>
                  <div className="wizard-pair">
                    <Field id={`wiz-rml-${i}`} label="A lump sum" value={h.rmLump} onChange={(v) => upd({ rmLump: v })} prefix={cur} />
                    <Field id={`wiz-rmm-${i}`} label="And/or a regular payment each month" value={h.rmMonthly} onChange={(v) => upd({ rmMonthly: v })} prefix={cur} />
                  </div>
                </More>
                <Field id={`wiz-hs-${i}`} label="Planning to sell it? At what age?" help="Optional. The money (after the mortgage and selling costs) goes into your savings." value={h.sellAge} onChange={(v) => upd({ sellAge: v })} suffix="years" />
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ homes: [...a.homes, { name: a.homes.length ? `Property ${a.homes.length + 1}` : 'Home' }] })}>
            + Add {a.homes.length ? 'another property' : 'your home'}
          </button>
          {!a.homes.length && <p className="wizard-help">Renting or living with family? Skip the home and just add anything below.</p>}
          <p className="wizard-q">Other things you own</p>
          <div className="wizard-pair">
            <Field id="wiz-car" label="Your car (or cars): what could it sell for?" value={a.car} onChange={(v) => set({ car: v })} prefix={cur} />
            <Field id="wiz-carl" label="How much value does it lose each year?" help="Cars usually lose about 10 to 15% a year." value={a.carLossPct} onChange={(v) => set({ carLossPct: v })} suffix="% a year" placeholder="10" />
          </div>
          <div className="wizard-pair">
            <Field id="wiz-val" label="Jewellery, art or other valuables" value={a.valuables} onChange={(v) => set({ valuables: v })} prefix={cur} />
            <Field id="wiz-valc" label="Change in value each year" help="Leave blank to keep it the same." value={a.valuablesChangePct} onChange={(v) => set({ valuablesChangePct: v })} suffix="% a year" placeholder="0" />
          </div>
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
          <p className="wizard-q">How would you like to use your savings once you stop working?</p>
          <Choice name="wiz-draw" value={a.drawdown ?? 'needs'} onChange={(v) => set({ drawdown: v })}
            options={[
              ['needs', 'Cover my spending', 'Use the spending figure above'],
              ['six_percent', '6% rule', 'More early on, some risk later'],
              ['inflated_four', 'Inflated 4% rule', 'Steady, rises with prices'],
              ['fixed_date', 'Fixed date rule', 'Spread it to an age you pick'],
              ['guardrails', 'Flexible', 'Less after bad years, more after good'],
            ]} />
          {a.drawdown === 'fixed_date' && (
            <Field id="wiz-drawu" label="Make my savings last until what age?" help={`After that, you live on ${c.pension.name} or other pensions.`} value={a.drawdownUntil} onChange={(v) => set({ drawdownUntil: v })} suffix="years" placeholder="85" />
          )}
          {a.drawdown && a.drawdown !== 'needs' && a.drawdown !== 'guardrails' && (
            <p className="wizard-help">
              A rule of thumb from the NZ Society of Actuaries, also used by{' '}
              <a href="https://sorted.org.nz/tools/retirement-navigator" target="_blank" rel="noopener noreferrer">Sorted&apos;s retirement navigator</a>.
              It sets how much you take from your savings each year; your pensions are spent on top.
            </p>
          )}
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
                <Field id={`wiz-fs-${i}`} label="Starting in how many years?" help="Blank if it's already happening. For example university costs that start in 5 years." value={f.startIn} onChange={(v) => upd({ startIn: v })} suffix="years" placeholder="0" />
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ family: [...a.family, { kind: 'child' }] })}>+ Add a child, parent or pet</button>
          <p className="wizard-help">Their costs rise with inflation each year and stop after the years you set.</p>
          <p className="wizard-q">Other regular costs</p>
          <p className="wizard-help">Things not in everyday spending, such as travel, private health insurance, school fees or a gym.</p>
          {(a.otherCosts ?? []).map((x, i) => {
            const upd = (p: Partial<OtherCost>) => set({ otherCosts: (a.otherCosts ?? []).map((y, j) => (j === i ? { ...y, ...p } : y)) });
            return (
              <Card key={i} title={x.name || 'Other cost'} onRemove={() => set({ otherCosts: (a.otherCosts ?? []).filter((_, j) => j !== i) })}>
                <TextField id={`wiz-ocn-${i}`} label="What is it?" value={x.name} onChange={(v) => upd({ name: v })} placeholder="e.g. Travel" />
                <div className="wizard-pair">
                  <Field id={`wiz-ocm-${i}`} label="Costs each month" value={x.monthly} onChange={(v) => upd({ monthly: v })} prefix={cur} />
                  <Field id={`wiz-ocy-${i}`} label="For how many years?" help="Blank if it carries on." value={x.years} onChange={(v) => upd({ years: v })} suffix="years" />
                </div>
              </Card>
            );
          })}
          <button type="button" className="wizard-add" onClick={() => set({ otherCosts: [...(a.otherCosts ?? []), { name: '' }] })}>+ Add another regular cost</button>
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
      icon: '🎯', title: 'Your goal and a few assumptions',
      why: 'Optional. A number to aim for, and how fast prices rise. Leave them blank to use sensible defaults.',
      optional: true,
      body: (
        <>
          <Field id="wiz-goal" label="How much would you like to have by the time you stop working?" help="Everything you own minus what you owe, in today's money. Leave blank to skip." value={a.goal} onChange={(v) => set({ goal: v })} prefix={cur} />
          <Field id="wiz-infl" label="How fast do you expect prices to rise each year (inflation)?"
            help={`${inflationHint(country)} Leave blank for ${c.inflationPct}%. Results are shown in today's money so they're easy to compare.`}
            value={a.inflationPct} onChange={(v) => set({ inflationPct: v === undefined ? undefined : Math.min(20, v) })} suffix="% a year" placeholder={String(c.inflationPct)} />
        </>
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
            <BufferCheck result={r} />
            <BasisLabel country={r.inputs.country} inflationPct={r.inputs.inflationPct} retireIn={r.inputs.retireIn} fx={r.inputs.fx} />
            <HouseholdChart result={r} height={300} />
            <HouseholdWarnings result={r} />
            {result && <HouseholdAnalysisView analysis={result.analysis} country={r.inputs.country} />}
          </>
        )}
        <div className="wizard-nav">
          <button type="button" className="wizard-button is-quiet" onClick={() => go(0)}>← Change my answers</button>
          <button type="button" className="start-again" onClick={() => { if (window.confirm('Clear all your answers and start again?')) { resetAll(); go(0); } }}>🧹 Start again</button>
          {plan && <button type="button" className="wizard-button" onClick={() => openInAllDetails(plan)}>Open in Advanced to fine-tune</button>}
        </div>
        <PlanFileActions plan={plan} onOpen={openInAllDetails} />
        <TrustedTools compact />
        <p className="wizard-privacy">🔒 Worked out on this device. Nothing was sent to us. <ClearDeviceData label="Clear my answers from this device" onCleared={() => { resetAll(); go(0); }} /></p>
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
        <button type="button" className="start-again" onClick={() => { if (window.confirm('Clear all your answers and start again?')) { resetAll(); go(0); } }}>🧹 Start again</button>
      </div>
      <div className="wizard-step-head">
        <span className="wizard-icon" aria-hidden="true">{s.icon}</span>
        <div>
          <h2 id="wiz-title">{s.title}</h2>
          <p>{s.why}</p>
        </div>
      </div>
      {synced && step > 0 && (
        <p className="wizard-synced" role="status">
          ✓ Updated with the changes you made in &quot;Advanced&quot;. Anything the guided steps don&apos;t ask about is kept as you set it there.
          <button type="button" className="link-button" onClick={() => setSynced(false)}>OK</button>
        </p>
      )}
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
      <p className="wizard-privacy">🔒 Your answers stay on this device, kept until you press Start again or Clear. <ClearDeviceData label="Clear my answers" onCleared={() => { resetAll(); go(0); }} /></p>
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
      {!r || !atRet || (r.today.assets === 0 && r.today.income.length === 0) ? (
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
