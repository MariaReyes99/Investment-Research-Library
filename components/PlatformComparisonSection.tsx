'use client';
/** Retirement fund and platform comparisons, hidden until someone chooses to explore them. */
import { useState } from 'react';
import PlatformComparison from './PlatformComparison';
import FundComparison from './FundComparison';
import { useCountry } from './CountryPicker';
import { COUNTRY_DEFAULTS } from '../lib/finance/fund-comparison';

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
  const [country] = useCountry();
  const label = COUNTRY_DEFAULTS[country].label;
  return (
    <section className="platform-explorer" aria-labelledby="platform-explorer-title">
      <div className="platform-explorer-intro">
        <span aria-hidden="true">⚖️</span>
        <div>
          <h2 id="platform-explorer-title">Compare {label} providers and investment platforms</h2>
          <p>
            Thinking about staying with your {label} provider or moving? Fees and tax look small but add up over the years. Pick up
            to four providers: their latest published fees and returns fill in automatically, and you can add any provider that
            isn&apos;t listed. See your contributions, every fee and tax, and the return you keep, month by month or year by year.
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
        {open ? 'Hide the comparison' : 'Open the comparison'}
      </button>
      {open && (
        <>
          <div className="projector-tabs fc-mode" role="tablist" aria-label="What to compare">
            <button type="button" role="tab" aria-selected={mode === 'funds'} className={mode === 'funds' ? 'is-on' : ''} onClick={() => setMode('funds')}>
              <span aria-hidden="true">🏦</span> {label} providers <small>Contributions, fees, tax and returns</small>
            </button>
            <button type="button" role="tab" aria-selected={mode === 'platforms'} className={mode === 'platforms' ? 'is-on' : ''} onClick={() => setMode('platforms')}>
              <span aria-hidden="true">📈</span> Investment platforms <small>Brokers, ETFs and managed funds</small>
            </button>
          </div>
          {mode === 'funds' ? <FundComparison initialQuery={query} /> : <PlatformComparison />}
        </>
      )}
    </section>
  );
}
