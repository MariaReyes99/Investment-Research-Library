/**
 * Real fund fees for the platform comparison, from data/fund-fees.json.
 * Every figure should be copied from the fund's official quarterly fund update
 * (Disclose Register in New Zealand), with its source and date.
 */
import data from '../data/fund-fees.json';

export type FundFee = {
  name: string;
  provider: string;
  type: 'defensive' | 'conservative' | 'balanced' | 'growth' | 'aggressive' | 'index' | 'other';
  annualFeePct: number;
  monthlyAccountFee?: number;
  sourceUrl: string;
  asOf: string;
};

const raw = data as { asOf?: string; reviewEveryMonths?: number; funds?: unknown[] };

/** Only well-formed entries with a source and date are offered. */
export const FUND_FEES: FundFee[] = (raw.funds ?? []).filter((f): f is FundFee => {
  const x = f as Partial<FundFee>;
  return typeof x.name === 'string' && typeof x.provider === 'string' && typeof x.annualFeePct === 'number'
    && x.annualFeePct >= 0 && x.annualFeePct < 5 && typeof x.sourceUrl === 'string' && typeof x.asOf === 'string';
});
export const FUND_FEES_AS_OF = raw.asOf ?? '';
export const FUND_FEES_REVIEW_MONTHS = raw.reviewEveryMonths ?? 3;

/** Where to look fees up, by country. */
export const FEE_LOOKUPS: Record<string, { label: string; url: string }[]> = {
  NZ: [
    { label: "Sorted's KiwiSaver fund finder", url: 'https://sorted.org.nz/tools/kiwisaver-fund-finder' },
    { label: 'Disclose Register (fund updates)', url: 'https://disclose-register.companiesoffice.govt.nz' },
  ],
  AU: [{ label: 'Moneysmart', url: 'https://moneysmart.gov.au' }],
  US: [{ label: 'Investor.gov', url: 'https://www.investor.gov' }],
  UK: [{ label: 'MoneyHelper', url: 'https://www.moneyhelper.org.uk' }],
  PH: [{ label: 'SEC Philippines', url: 'https://www.sec.gov.ph' }],
};
