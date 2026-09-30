'use client';
/**
 * The visitor's country of residence, remembered on this device only
 * (localStorage), and shared between the chat and the projector.
 */
import { useCallback, useEffect, useState } from 'react';
import { COUNTRIES, COUNTRY_CODES, DEFAULT_COUNTRY, isCountry, type CountryCode } from '../lib/countries';

const KEY = 'irl:country';
const EVENT = 'irl:country-change';

function read(): CountryCode {
  try {
    const v = window.localStorage.getItem(KEY);
    return isCountry(v) ? v : DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

export function useCountry(): [CountryCode, (c: CountryCode) => void] {
  const [country, setCountryState] = useState<CountryCode>(DEFAULT_COUNTRY);
  useEffect(() => {
    setCountryState(read());
    const sync = () => setCountryState(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const setCountry = useCallback((c: CountryCode) => {
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      /* private browsing: keep it for this page only */
    }
    setCountryState(c);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [country, setCountry];
}

export function CountrySelect({ value, onChange, id = 'country', label = 'I live in' }: {
  value: CountryCode; onChange: (c: CountryCode) => void; id?: string; label?: string;
}) {
  return (
    <div className="calc-field country-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="planner-select" value={value} onChange={(e) => onChange(e.target.value as CountryCode)}>
        {COUNTRY_CODES.map((c) => (
          <option key={c} value={c}>{COUNTRIES[c].name} ({COUNTRIES[c].currency})</option>
        ))}
      </select>
    </div>
  );
}

/** The "based on" line shown with every calculation. */
export function BasisLabel({ country, inflationPct, retireIn, fx = [] }: {
  country: CountryCode; inflationPct: number; retireIn?: CountryCode; fx?: { currency: string; rate: number; yearlyChangePct: number }[];
}) {
  const c = COUNTRIES[country];
  return (
    <p className="basis-label">
      <strong>Based on {c.name}</strong> settings: {c.currency} in today&apos;s money, {inflationPct}% inflation.
      Pension: {c.pension.name} from {c.pension.age}. {c.retirementAccount.name} withdrawals from {c.retirementAccount.accessAge}.
      {retireIn && retireIn !== country && <> Retiring in {COUNTRIES[retireIn].name}, with retirement costs in {COUNTRIES[retireIn].currency}.</>}
      {fx.length > 0 && <> Exchange rates: {fx.map((f) => `1 ${f.currency} = ${f.rate} ${c.currency}${f.yearlyChangePct ? ` (${f.yearlyChangePct > 0 ? '+' : ''}${f.yearlyChangePct}% a year)` : ''}`).join('; ')}.</>}
      {c.coverage !== 'full' && <> The library&apos;s documents for {c.name} are {c.coverage === 'partial' ? 'still being expanded' : 'not yet added'}.</>}
    </p>
  );
}

const RETIRE_KEY = 'irl:retire-in';
const RETIRE_EVENT = 'irl:retire-in-change';

function readRetire(): CountryCode | null {
  try {
    const v = window.localStorage.getItem(RETIRE_KEY);
    return isCountry(v) ? v : null;
  } catch {
    return null;
  }
}

/** Where the visitor plans to retire (null = the country they live in). Stored on this device only. */
export function useRetireIn(): [CountryCode | null, (c: CountryCode | null) => void] {
  const [value, setValue] = useState<CountryCode | null>(null);
  useEffect(() => {
    setValue(readRetire());
    const sync = () => setValue(readRetire());
    window.addEventListener(RETIRE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(RETIRE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = useCallback((c: CountryCode | null) => {
    try {
      if (c) window.localStorage.setItem(RETIRE_KEY, c);
      else window.localStorage.removeItem(RETIRE_KEY);
    } catch {
      /* ignore */
    }
    setValue(c);
    window.dispatchEvent(new Event(RETIRE_EVENT));
  }, []);
  return [value, set];
}

export function RetireInSelect({ value, livesIn, onChange, id = 'retire-in' }: {
  value: CountryCode | null; livesIn: CountryCode; onChange: (c: CountryCode | null) => void; id?: string;
}) {
  return (
    <div className="calc-field country-field">
      <label htmlFor={id}>I plan to retire in</label>
      <select id={id} className="planner-select" value={value ?? ''} onChange={(e) => onChange(isCountry(e.target.value) ? e.target.value : null)}>
        <option value="">The same country ({COUNTRIES[livesIn].name})</option>
        {COUNTRY_CODES.filter((c) => c !== livesIn).map((c) => (
          <option key={c} value={c}>{COUNTRIES[c].name} ({COUNTRIES[c].currency})</option>
        ))}
      </select>
    </div>
  );
}
