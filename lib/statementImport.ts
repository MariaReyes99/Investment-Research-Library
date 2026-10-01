/**
 * Reads a bank statement file (CSV, or OFX/QFX) and suggests answers for the
 * projector: average money in a month, average money out, and the latest
 * balance. Runs in the browser only; the file is never uploaded.
 *
 * Statements differ between banks, so this looks for common column names
 * (Date, Amount, Debit/Credit, Money in/Money out, Balance) and asks the
 * person to check every suggestion before it's used.
 */

export interface StatementSummary {
  transactions: number;
  months: number;
  firstDate: string | null;
  lastDate: string | null;
  averageMoneyIn: number;
  averageMoneyOut: number;
  latestBalance: number | null;
  /** Money in, grouped by description, largest first: helps spot the salary. */
  largestIncomeSources: { description: string; monthlyAverage: number }[];
}

type Txn = { date: Date | null; amount: number; balance: number | null; description: string };

/** Splits CSV text into rows, handling quoted fields with commas and quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** "$1,234.50", "(45.00)", "-12" → number. Blank → null. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) negative = true;
  s = s.replace(/[A-Z$€£₱,\s]|CR|DR/gi, '');
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return negative ? -Math.abs(n) : n;
}

/** Day-first dates (NZ, AU, UK, PH style), ISO dates, and OFX dates. */
export function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX 20260131
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(year, +m[2] - 1, +m[1]));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

const find = (headers: string[], words: RegExp) => headers.findIndex((h) => words.test(h));

function fromCsv(text: string): Txn[] {
  const rows = parseCsv(text);
  // The header is the first row that names an amount or debit/credit column
  const headerIndex = rows.findIndex((r) => r.some((c) => /amount|debit|credit|withdraw|deposit|money (in|out)|paid (in|out)/i.test(c)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((h) => h.trim().toLowerCase());
  const col = {
    date: find(headers, /date/),
    amount: find(headers, /^amount|amount$|transaction amount|value/),
    debit: find(headers, /debit|withdraw|money out|paid out/),
    credit: find(headers, /credit|deposit|money in|paid in/),
    balance: find(headers, /balance/),
    description: find(headers, /desc|details|payee|particulars|narrative|memo|reference|name/),
  };
  const txns: Txn[] = [];
  for (const r of rows.slice(headerIndex + 1)) {
    let amount = col.amount >= 0 ? parseAmount(r[col.amount]) : null;
    if (amount === null && (col.debit >= 0 || col.credit >= 0)) {
      const debit = col.debit >= 0 ? parseAmount(r[col.debit]) : null;
      const credit = col.credit >= 0 ? parseAmount(r[col.credit]) : null;
      if (debit === null && credit === null) continue;
      amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) continue;
    txns.push({
      date: col.date >= 0 ? parseDate(r[col.date]) : null,
      amount,
      balance: col.balance >= 0 ? parseAmount(r[col.balance]) : null,
      description: (col.description >= 0 ? r[col.description] : '').trim().slice(0, 60),
    });
  }
  return txns;
}

function fromOfx(text: string): Txn[] {
  const txns: Txn[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const b of blocks) {
    const tag = (name: string) => new RegExp(`<${name}>([^<\\r\\n]+)`, 'i').exec(b)?.[1]?.trim();
    const amount = parseAmount(tag('TRNAMT'));
    if (amount === null) continue;
    txns.push({ date: parseDate(tag('DTPOSTED')), amount, balance: null, description: (tag('NAME') ?? tag('MEMO') ?? '').slice(0, 60) });
  }
  const bal = parseAmount(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i.exec(text)?.[1]);
  if (bal !== null && txns.length) txns[txns.length - 1].balance = bal;
  return txns;
}

export function summariseStatement(text: string, fileName = ''): StatementSummary | null {
  const isOfx = /\.(ofx|qfx)$/i.test(fileName) || /<OFX>/i.test(text);
  const txns = isOfx ? fromOfx(text) : fromCsv(text);
  if (!txns.length) return null;

  const dated = txns.filter((t) => t.date).sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const first = dated[0]?.date ?? null;
  const last = dated[dated.length - 1]?.date ?? null;
  // Months covered, at least 1, counted from the span of dates
  const days = first && last ? (last.getTime() - first.getTime()) / 86_400_000 + 1 : 30;
  const months = Math.max(1, Math.round((days / 30.44) * 10) / 10);

  const moneyIn = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const moneyOut = txns.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);

  // Latest balance: from the most recent dated row that has one
  const withBalance = (dated.length ? dated : txns).filter((t) => t.balance !== null);
  const latestBalance = withBalance.length ? withBalance[withBalance.length - 1].balance : null;

  const bySource = new Map<string, number>();
  for (const t of txns) if (t.amount > 0) {
    const key = t.description.replace(/\d{3,}/g, '').trim() || 'Money in';
    bySource.set(key, (bySource.get(key) ?? 0) + t.amount);
  }
  const largestIncomeSources = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([description, total]) => ({ description, monthlyAverage: Math.round(total / months) }));

  return {
    transactions: txns.length,
    months,
    firstDate: first ? first.toISOString().slice(0, 10) : null,
    lastDate: last ? last.toISOString().slice(0, 10) : null,
    averageMoneyIn: Math.round(moneyIn / months),
    averageMoneyOut: Math.round(moneyOut / months),
    latestBalance: latestBalance === null ? null : Math.round(latestBalance),
    largestIncomeSources,
  };
}
