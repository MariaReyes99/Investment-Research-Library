/**
 * Understands requests like "compare the top 3 KiwiSaver providers in NZ",
 * "cheapest 3 balanced super funds in Australia" or "top 4 pensions UK",
 * and picks the funds to compare. Runs in the browser; nothing is sent anywhere.
 */
import type { CountryCode } from '../countries';
import { PROVIDERS, type FundRisk, type ProviderFund } from '../../data/retirement-providers';

export interface FundQuery {
  country: CountryCode | null;
  count: number;
  risk: FundRisk | null;
  rank: 'return' | 'fees';
  /** True when the person asked for more than four (the most the comparison shows). */
  capped: boolean;
}

const WORD_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function parseFundQuery(text: string): FundQuery {
  const t = text.toLowerCase();
  let country: CountryCode | null = null;
  if (/\bnz\b|new zealand|kiwisaver|\bkiwi/.test(t)) country = 'NZ';
  else if (/\bau\b|\baus\b|australia|aussie|superannuation|\bsuper\b|mysuper/.test(t)) country = 'AU';
  else if (/\buk\b|united kingdom|britain|british|england|scotland|wales|\bsipp\b|\bnest\b/.test(t)) country = 'UK';
  else if (/\bph\b|philippine|pilipinas|\bpinas\b|\bpera\b|\bmp2\b|pag-?ibig/.test(t)) country = 'PH';
  else if (/\bU\.?S\.?A?\b/.test(text) || /united states|america|401\s?\(?k\)?|\bira\b/.test(t)) country = 'US';

  let n = 3;
  const digit = /\b(\d{1,2})\b/.exec(t);
  const word = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\b`).exec(t);
  if (digit) n = Number(digit[1]);
  else if (word) n = WORD_NUMBERS[word[1]];
  const capped = n > 4;
  const count = Math.min(4, Math.max(2, n));

  let risk: FundRisk | null = null;
  if (/high[- ]growth|aggressive/.test(t)) risk = 'aggressive';
  else if (/\bgrowth\b/.test(t)) risk = 'growth';
  else if (/balanced/.test(t)) risk = 'balanced';
  else if (/conservative|defensive|low[- ]risk/.test(t)) risk = 'conservative';

  const rank = /cheap|lowest fee|low[- ]fee|low[- ]cost|lowest cost|least expensive/.test(t) ? 'fees' : 'return';
  return { country, count, risk, rank, capped };
}

const totalFee = (f: ProviderFund) => f.investmentFeePct + (f.adminFeePct ?? 0) + (f.performanceFeePct ?? 0) + (f.platformFeePct ?? 0);

/** The usual fund type in a country's list, used when the request doesn't name one. */
function commonRisk(list: ProviderFund[]): FundRisk {
  const counts = new Map<FundRisk, number>();
  for (const f of list) counts.set(f.risk, (counts.get(f.risk) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export interface FundPick { funds: ProviderFund[]; explanation: string }

/** One fund per provider, ranked by published past return (or lowest fees), within one fund type. */
export function pickTopFunds(country: CountryCode, q: Pick<FundQuery, 'count' | 'risk' | 'rank' | 'capped'>): FundPick {
  const all = PROVIDERS[country];
  const risk = q.risk ?? commonRisk(all);
  let pool = all.filter((f) => f.risk === risk);
  if (pool.length < q.count) pool = all; // not enough of that type: widen
  const withReturn = pool.filter((f) => f.historicReturnPct !== undefined && (f.historicYears ?? 0) >= 5);
  const byFees = [...pool].sort((a, b) => totalFee(a) - totalFee(b) || (a.fixedFeePerYear ?? 0) - (b.fixedFeePerYear ?? 0));

  let ordered: ProviderFund[];
  let basis: string;
  if (q.rank === 'return' && withReturn.length >= 2) {
    ordered = [...withReturn].sort((a, b) => (b.historicReturnPct ?? 0) - (a.historicReturnPct ?? 0));
    ordered.push(...byFees.filter((f) => !ordered.includes(f)));
    basis = 'highest published 5-year return';
  } else {
    ordered = byFees;
    basis = q.rank === 'return' ? 'lowest fees (there are not enough published 5-year returns in this list to rank by return)' : 'lowest fees';
  }

  const seen = new Set<string>();
  const funds: ProviderFund[] = [];
  for (const f of ordered) {
    if (seen.has(f.provider)) continue;
    seen.add(f.provider);
    funds.push(f);
    if (funds.length === q.count) break;
  }
  const mixed = new Set(funds.map((f) => f.risk)).size > 1;
  const explanation = `Showing the top ${funds.length} ${mixed ? '' : `${risk} `}funds by ${basis}, one per provider${q.capped ? ' (the comparison shows up to 4 at a time)' : ''}. `
    + 'Past returns don\'t predict future returns, so also compare fees and how each fund charges tax.';
  return { funds, explanation };
}
