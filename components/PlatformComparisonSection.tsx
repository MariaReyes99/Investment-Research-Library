'use client';
/** Retirement fund and platform comparisons, hidden until someone chooses to explore them. */
import { useEffect, useState } from 'react';
import PlatformComparison from './PlatformComparison';
import FundComparison from './FundComparison';
import { useCountry } from './CountryPicker';
import { COUNTRY_DEFAULTS } from '../lib/finance/fund-comparison';
import { hasSavedComparison } from '../lib/comparisonShare';

export default function PlatformComparisonSection({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [mode, setMode] = useState<'funds' | 'platforms'>('funds');
  const [text, setText] = useState('');
  const [query, setQuery] = useState<{ text: string; n: number } | undefined>();
  const ask = (t: string) => {
    if (!t.trim()) return;
    setQuery((q) => ({ text: t, n: (q?.n ?? 0) + 1 }));
    setMode('funds');
    setOpen(true);
  };
  // Reopen a comparison saved on this device
  useEffect(() => { if (hasSavedComparison()) setOpen(true); }, []);
  const [country] = useCountry();
  const label = COUNTRY_DEFAULTS[country].label;
  return (
    <section className="platform-explorer" aria-labelledby="platform-explorer-title">
      <div className="platform-explorer-intro">
        <span aria-hidden="true">⚖️</span>
        <div>
          <h2 id="platform-explorer-title">Retirement fund comparison</h2>
          <p className="fc-also-known">KiwiSaver · Superannuation · 401(k) and IRA · Workplace and personal pensions · PERA and Pag-IBIG MP2</p>
          <p>
            Staying with your {['Super', 'Pension'].includes(label) ? label.toLowerCase() : label} provider or moving? Compare up to four funds in three simple steps.
            Fees and returns fill in from each provider&apos;s latest published figures. Your comparison is saved on this device and linked to the library.
          </p>
        </div>
      </div>
      {!open && (
        <form className="fc-query fc-query-quick" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <label htmlFor="fc-quick-query">Quick start: say what you want to compare</label>
          <div className="fc-query-row">
            <input id="fc-quick-query" type="text" value={text} maxLength={160} autoComplete="off"
              placeholder="e.g. I want to compare the top 3 fund providers in the UK" onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="wizard-button">Compare</button>
          </div>
        </form>
      )}
      <button type="button" className="wizard-button is-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the retirement fund comparison' : 'Open the retirement fund comparison'}
      </button>
      {open && (
        <>
          <div className="projector-tabs fc-mode" role="group" aria-label="What to compare">
            <button type="button" aria-pressed={mode === 'funds'} className={mode === 'funds' ? 'is-on' : ''} onClick={() => setMode('funds')}>
              <span aria-hidden="true">🏦</span> Retirement funds ({label}) <small>Contributions, fees, tax and returns</small>
            </button>
            <button type="button" aria-pressed={mode === 'platforms'} className={mode === 'platforms' ? 'is-on' : ''} onClick={() => setMode('platforms')}>
              <span aria-hidden="true">📈</span> Investment platforms <small>Brokers, ETFs and managed funds</small>
            </button>
          </div>
          {mode === 'funds' ? <FundComparison initialQuery={query} /> : <PlatformComparison />}
        </>
      )}
    </section>
  );
}
