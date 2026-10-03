/**
 * The library's sources register, read from data/corpus/sources.json.
 * Every document carries a source URL, an "as at" date, a country and a review
 * schedule. Used by the /sources page and by `npm run check:sources`.
 */
import manifest from '../data/corpus/sources.json';
import { FUND_FEES, FUND_FEES_AS_OF, FUND_FEES_REVIEW_MONTHS } from './fundFees';

export type SourceRecord = {
  path: string;
  title: string;
  url: string;
  publisher: string;
  licence: string;
  country: string;
  asOf: string;
  reviewEveryMonths: number;
  reviewDue: string;
  status: 'current' | 'due-soon' | 'overdue' | 'undated';
};

type Entry = { title?: string; url?: string; publisher?: string; licence?: string; country?: string; asOf?: string; reviewEveryMonths?: number };

function addMonths(iso: string, months: number): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function sourcesRegister(today = new Date()): SourceRecord[] {
  // Fund fee data counts as a source once it has entries
  const fees: [string, Entry][] = FUND_FEES.length
    ? [['data/fund-fees.json', { title: `Fund fees for the platform comparison (${FUND_FEES.length} funds)`, url: 'https://disclose-register.companiesoffice.govt.nz', publisher: 'Fund updates, Disclose Register', licence: 'own-content', country: 'NZ', asOf: FUND_FEES_AS_OF, reviewEveryMonths: FUND_FEES_REVIEW_MONTHS }]]
    : [];
  return [...Object.entries(manifest as Record<string, Entry>), ...fees]
    .filter(([path, e]) => !path.startsWith('_') && e.licence !== 'personal-study-only')
    .map(([path, e]) => {
      const every = e.reviewEveryMonths ?? 12;
      const due = e.asOf ? addMonths(e.asOf, every) : null;
      const days = due ? (due.getTime() - today.getTime()) / 86_400_000 : null;
      return {
        path,
        title: e.title ?? path,
        url: e.url ?? '',
        publisher: e.publisher ?? '',
        licence: e.licence ?? 'unknown',
        country: e.country ?? 'GLOBAL',
        asOf: e.asOf ?? '',
        reviewEveryMonths: every,
        reviewDue: due ? due.toISOString().slice(0, 10) : '',
        status: days === null ? 'undated' : days < 0 ? 'overdue' : days <= 30 ? 'due-soon' : 'current',
      } satisfies SourceRecord;
    })
    .sort((a, b) => a.reviewDue.localeCompare(b.reviewDue));
}
