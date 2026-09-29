'use client';

import { useState } from 'react';
import type { PaidPlan } from '../lib/plans';

/** Sends the visitor to Stripe's hosted checkout. No card details are handled here. */
export default function UpgradeButton({ plan, label }: { plan: PaidPlan; label: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage(data.error ?? 'Checkout could not start. Try again in a moment.');
    } catch {
      setMessage('Checkout could not start. Check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <div className="upgrade-action">
      <button type="button" className="plan-button" onClick={go} disabled={busy}>
        {busy ? 'Opening checkout…' : label}
      </button>
      {message && <p className="plan-message" role="status">{message}</p>}
    </div>
  );
}
