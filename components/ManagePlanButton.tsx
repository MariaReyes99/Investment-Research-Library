'use client';

import { useState } from 'react';

/** Opens Stripe's customer portal to change plan, update the card or cancel. */
export default function ManagePlanButton({ label = 'Manage or cancel your plan' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/billing-portal', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage(data.error ?? 'The billing page could not open. Try again in a moment.');
    } catch {
      setMessage('The billing page could not open. Check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <div className="upgrade-action">
      <button type="button" className="plan-button is-secondary" onClick={go} disabled={busy}>
        {busy ? 'Opening…' : label}
      </button>
      {message && <p className="plan-message" role="status">{message}</p>}
    </div>
  );
}
