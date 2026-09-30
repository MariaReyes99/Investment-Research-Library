/**
 * Country profiles. Each drives the currency, labels and default ages used by
 * the projector and the chat.
 *
 * Ages and names here are DEFAULTS that users can change in the projector.
 * They follow official sources as at the date below; rules change, so review
 * them on the schedule in data/corpus/sources.json and update this file.
 * Disclaimer wording is a DRAFT for legal review (see COMPLIANCE.md).
 */
export const COUNTRY_CODES = ['NZ', 'AU', 'US', 'UK', 'PH'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export interface CountryProfile {
  code: CountryCode;
  name: string;
  currency: string;
  locale: string;
  inflationPct: number;
  pension: { name: string; age: number; note: string };
  retirementAccount: { name: string; accessAge: number; note: string; taxOnWithdrawal: boolean };
  taxFreeAccount?: string;
  regulator: string;
  adviser: string;
  officialSources: { label: string; url: string }[];
  /** How well the library's documents cover this country today. */
  coverage: 'full' | 'partial' | 'general-only';
}

export const PROFILES_AS_AT = '2026-09-30';

export const COUNTRIES: Record<CountryCode, CountryProfile> = {
  NZ: {
    code: 'NZ', name: 'New Zealand', currency: 'NZD', locale: 'en-NZ', inflationPct: 2.5,
    pension: { name: 'NZ Super', age: 65, note: 'Paid from 65, subject to residence rules.' },
    retirementAccount: { name: 'KiwiSaver', accessAge: 65, note: 'Withdrawals generally from 65.', taxOnWithdrawal: false },
    regulator: 'Financial Markets Authority (FMA)',
    adviser: 'a licensed financial adviser',
    officialSources: [
      { label: 'Sorted', url: 'https://sorted.org.nz' },
      { label: 'IRD', url: 'https://www.ird.govt.nz' },
      { label: 'Work and Income (NZ Super)', url: 'https://www.workandincome.govt.nz' },
    ],
    coverage: 'full',
  },
  AU: {
    code: 'AU', name: 'Australia', currency: 'AUD', locale: 'en-AU', inflationPct: 2.5,
    pension: { name: 'Age Pension', age: 67, note: 'Means-tested; eligibility age 67.' },
    retirementAccount: { name: 'Super', accessAge: 60, note: 'Preservation age 60 for most people now working.', taxOnWithdrawal: false },
    regulator: 'Australian Securities and Investments Commission (ASIC)',
    adviser: 'a licensed financial adviser',
    officialSources: [
      { label: 'Moneysmart', url: 'https://moneysmart.gov.au' },
      { label: 'ATO', url: 'https://www.ato.gov.au' },
      { label: 'Services Australia (Age Pension)', url: 'https://www.servicesaustralia.gov.au/age-pension' },
    ],
    coverage: 'partial',
  },
  US: {
    code: 'US', name: 'United States', currency: 'USD', locale: 'en-US', inflationPct: 2.5,
    pension: { name: 'Social Security', age: 67, note: 'Full retirement age is 67 for people born in 1960 or later; claiming earlier reduces benefits.' },
    retirementAccount: { name: '401(k) / IRA', accessAge: 59.5, note: 'Withdrawals before 59½ usually carry a 10% penalty; traditional accounts are taxed on withdrawal.', taxOnWithdrawal: true },
    taxFreeAccount: 'Roth IRA / Roth 401(k)',
    regulator: 'Securities and Exchange Commission (SEC)',
    adviser: 'a registered investment adviser',
    officialSources: [
      { label: 'SSA', url: 'https://www.ssa.gov' },
      { label: 'IRS', url: 'https://www.irs.gov' },
      { label: 'Investor.gov', url: 'https://www.investor.gov' },
    ],
    coverage: 'general-only',
  },
  UK: {
    code: 'UK', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', inflationPct: 2.5,
    pension: { name: 'State Pension', age: 67, note: 'State Pension age is rising from 66 to 67 between 2026 and 2028; check your own age on GOV.UK.' },
    retirementAccount: { name: 'Workplace pension / SIPP', accessAge: 57, note: 'Minimum pension age rises from 55 to 57 in April 2028; withdrawals above the tax-free portion are taxed as income.', taxOnWithdrawal: true },
    taxFreeAccount: 'ISA',
    regulator: 'Financial Conduct Authority (FCA)',
    adviser: 'an FCA-authorised financial adviser',
    officialSources: [
      { label: 'GOV.UK State Pension', url: 'https://www.gov.uk/state-pension' },
      { label: 'MoneyHelper', url: 'https://www.moneyhelper.org.uk' },
      { label: 'HMRC', url: 'https://www.gov.uk/government/organisations/hm-revenue-customs' },
    ],
    coverage: 'general-only',
  },
  PH: {
    code: 'PH', name: 'Philippines', currency: 'PHP', locale: 'en-PH', inflationPct: 3.5,
    pension: { name: 'SSS retirement pension', age: 60, note: 'Optional retirement from 60 and compulsory at 65, with at least 120 monthly contributions.' },
    retirementAccount: { name: 'PERA', accessAge: 55, note: 'Personal Equity and Retirement Account; qualified withdrawals from 55 after at least 5 years of contributions.', taxOnWithdrawal: false },
    regulator: 'Securities and Exchange Commission (SEC Philippines)',
    adviser: 'an SEC-registered investment adviser',
    officialSources: [
      { label: 'SSS', url: 'https://www.sss.gov.ph' },
      { label: 'Pag-IBIG (MP2)', url: 'https://www.pagibigfund.gov.ph' },
      { label: 'SEC Philippines', url: 'https://www.sec.gov.ph' },
    ],
    coverage: 'general-only',
  },
};

export const DEFAULT_COUNTRY: CountryCode = 'NZ';

export function isCountry(x: unknown): x is CountryCode {
  return typeof x === 'string' && (COUNTRY_CODES as readonly string[]).includes(x);
}

export function profile(code: CountryCode | undefined): CountryProfile {
  return COUNTRIES[code ?? DEFAULT_COUNTRY];
}

const formatters = new Map<CountryCode, Intl.NumberFormat>();
/** Whole-unit currency formatter for a country, e.g. NZ$12,345 or ₱12,345. */
export function moneyFor(code: CountryCode | undefined) {
  const c = profile(code);
  let f = formatters.get(c.code);
  if (!f) {
    f = new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency, maximumFractionDigits: 0 });
    formatters.set(c.code, f);
  }
  return (n: number) => f!.format(Math.round(n));
}

/** Country-specific disclaimer. DRAFT: have a lawyer in each country review this wording. */
export function disclaimerFor(code: CountryCode | undefined) {
  const c = profile(code);
  return `General information and education only, not financial advice. It does not take your full circumstances into account. We are not licensed to give personal financial advice in ${c.name}; for a personal recommendation, talk to ${c.adviser}.`;
}

/** One line that says which country, currency and basis a calculation uses. */
export function basisLabel(code: CountryCode | undefined, inflationPct: number) {
  const c = profile(code);
  return `Based on ${c.name} settings: ${c.currency} in today's money, ${inflationPct}% inflation. Pension: ${c.pension.name} from ${c.pension.age}. ${c.retirementAccount.name} from ${c.retirementAccount.accessAge}.`;
}

const CURRENCY_PATTERNS: [CountryCode, RegExp][] = [
  ['NZ', /\bNZD\b|NZ\$/i],
  ['AU', /\bAUD\b|A\$|AU\$/i],
  ['US', /\bUSD\b|US\$/i],
  ['UK', /\bGBP\b|£|\bpounds?\b/i],
  ['PH', /\bPHP\b|₱|\bpesos?\b/i],
];

/** The country whose currency a message's amounts are written in, if exactly one is named. */
export function currencyCountryIn(text: string): CountryCode | null {
  const found = CURRENCY_PATTERNS.filter(([, re]) => re.test(text)).map(([c]) => c);
  return found.length === 1 ? found[0] : null;
}
