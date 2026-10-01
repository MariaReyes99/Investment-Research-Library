'use client';
/**
 * Lets someone fill in pay, spending and bank balance from a bank statement.
 * The file is read in the browser and never uploaded. Suggestions are shown
 * for the person to check and choose before anything is filled in.
 */
import { useState } from 'react';
import { summariseStatement, type StatementSummary } from '../lib/statementImport';

export type StatementAnswers = { pay?: number; spending?: number; bank?: number };

const MAX_BYTES = 5 * 1024 * 1024;

export default function StatementImport({ money, onApply }: { money: (n: number) => string; onApply: (a: StatementAnswers) => void }) {
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [use, setUse] = useState({ pay: true, spending: true, bank: true });

  async function read(file: File) {
    setSummary(null);
    setMessage(null);
    if (file.size > MAX_BYTES) return setMessage('That file is bigger than 5 MB. Try downloading a shorter date range.');
    if (/\.pdf$/i.test(file.name)) {
      return setMessage("PDF statements can't be read yet. In your internet banking, look for Export or Download and choose CSV, then try again.");
    }
    const text = await file.text();
    const s = summariseStatement(text, file.name);
    if (!s) return setMessage("We couldn't find transactions in that file. Download your statement as CSV (or OFX) from your internet banking and try again.");
    setSummary(s);
  }

  function apply() {
    if (!summary) return;
    onApply({
      pay: use.pay ? summary.averageMoneyIn : undefined,
      spending: use.spending ? summary.averageMoneyOut : undefined,
      bank: use.bank && summary.latestBalance !== null ? Math.max(0, summary.latestBalance) : undefined,
    });
    setMessage('Done! We filled in the answers you chose. You can change them at any step.');
    setSummary(null);
  }

  return (
    <div className="statement-import">
      <div className="statement-import-head">
        <span aria-hidden="true">📄</span>
        <div>
          <strong>Short cut: use a bank statement</strong>
          <p>
            Download a statement from your internet banking as a <b>CSV</b> or <b>OFX</b> file (3 to 12 months works best), then
            choose it here. It&apos;s read on this device only and is never uploaded or saved.
          </p>
        </div>
      </div>
      <label className="wizard-button is-quiet statement-pick">
        Choose a statement file
        <input type="file" accept=".csv,.ofx,.qfx,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      </label>

      {summary && (
        <div className="statement-results" role="status">
          <p>
            We read <b>{summary.transactions}</b> transactions over about <b>{summary.months}</b> month{summary.months === 1 ? '' : 's'}
            {summary.firstDate && summary.lastDate && <> ({summary.firstDate} to {summary.lastDate})</>}. Tick what you&apos;d like to use:
          </p>
          <label><input type="checkbox" checked={use.pay} onChange={(e) => setUse({ ...use, pay: e.target.checked })} /> Money coming in each month: <b>{money(summary.averageMoneyIn)}</b></label>
          <label><input type="checkbox" checked={use.spending} onChange={(e) => setUse({ ...use, spending: e.target.checked })} /> Money going out each month: <b>{money(summary.averageMoneyOut)}</b></label>
          {summary.latestBalance !== null && (
            <label><input type="checkbox" checked={use.bank} onChange={(e) => setUse({ ...use, bank: e.target.checked })} /> Money in this account now: <b>{money(summary.latestBalance)}</b></label>
          )}
          {summary.largestIncomeSources.length > 0 && (
            <p className="wizard-help">Biggest payments in: {summary.largestIncomeSources.map((s) => `${s.description} (about ${money(s.monthlyAverage)} a month)`).join('; ')}.</p>
          )}
          <p className="wizard-help">
            Money going out includes everything that left the account, such as rent or mortgage payments and transfers to savings.
            You can adjust the numbers in the next steps.
          </p>
          <button type="button" className="wizard-button" onClick={apply}>Use these numbers</button>
        </div>
      )}
      {message && <p className="wizard-help" role="status">{message}</p>}
    </div>
  );
}
