'use client';
/** The platform comparison, hidden until someone chooses to explore it. */
import { useState } from 'react';
import PlatformComparison from './PlatformComparison';

export default function PlatformComparisonSection() {
  const [open, setOpen] = useState(false);
  return (
    <section className="platform-explorer" aria-labelledby="platform-explorer-title">
      <div className="platform-explorer-intro">
        <span aria-hidden="true">⚖️</span>
        <div>
          <h2 id="platform-explorer-title">Compare investment platforms</h2>
          <p>
            Thinking about where to invest? Fees look small but add up over the years. Enter what two to four platforms or
            funds charge, and see side by side how much you could end up with in each, and how much goes on fees. Find the fees
            on each provider&apos;s website or fund fact sheet. Returns you enter are your own assumptions, not promises.
          </p>
        </div>
      </div>
      <button type="button" className="wizard-button is-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the platform comparison' : 'Open the platform comparison'}
      </button>
      {open && <PlatformComparison />}
    </section>
  );
}
