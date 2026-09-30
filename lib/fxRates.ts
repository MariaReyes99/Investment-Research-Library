/**
 * Live exchange rates from Frankfurter (European Central Bank reference rates,
 * published each working day around 16:00 CET). Free, no API key.
 * https://frankfurter.dev
 */
import { CURRENCIES, type Currency } from './finance/household';

export type FxQuote = {
  home: Currency;
  date: string;
  /** Value of 1 unit of each currency in the home currency. */
  perUnit: Partial<Record<Currency, number>>;
  source: string;
};

const ENDPOINTS = [
  (home: string, to: string) => `https://api.frankfurter.dev/v1/latest?base=${home}&symbols=${to}`,
  (home: string, to: string) => `https://api.frankfurter.app/latest?from=${home}&to=${to}`,
];

export function isCurrency(x: unknown): x is Currency {
  return typeof x === 'string' && (CURRENCIES as readonly string[]).includes(x);
}

export async function fetchRates(home: Currency, currencies: Currency[]): Promise<FxQuote | null> {
  const wanted = [...new Set(currencies.filter((c) => c !== home))];
  if (!wanted.length) return { home, date: new Date().toISOString().slice(0, 10), perUnit: {}, source: 'Frankfurter (ECB reference rates)' };
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url(home, wanted.join(',')), { next: { revalidate: 6 * 3600 }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
      if (!data.rates) continue;
      const perUnit: FxQuote['perUnit'] = {};
      for (const c of wanted) {
        const r = data.rates[c];
        if (typeof r === 'number' && r > 0) perUnit[c] = Number((1 / r).toPrecision(5));
      }
      return { home, date: data.date ?? '', perUnit, source: 'Frankfurter (European Central Bank reference rates)' };
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}
