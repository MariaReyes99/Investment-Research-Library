'use client';
/**
 * Removes everything this site keeps in the browser: saved plans and the
 * country settings. Nothing is stored on the server, so this deletes it all.
 */
import { useState } from 'react';

const KEYS = ['irl:saved-plans', 'irl:country', 'irl:retire-in'];

export function clearDeviceData(): boolean {
  try {
    for (const k of KEYS) window.localStorage.removeItem(k);
    window.dispatchEvent(new Event('irl:country-change'));
    window.dispatchEvent(new Event('irl:retire-in-change'));
    window.dispatchEvent(new Event('irl:saved-plans-cleared'));
    return true;
  } catch {
    return false;
  }
}

export default function ClearDeviceData({ label = 'Clear my data from this device' }: { label?: string }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <span className="clear-device-data">
      <button
        type="button"
        className="link-button is-danger"
        onClick={() => {
          if (!window.confirm('Delete your saved plans and country settings from this browser? This cannot be undone.')) return;
          setDone(clearDeviceData() ? 'Deleted. Nothing from this site is left in this browser.' : "This browser wouldn't let the page delete its data. Clear site data in your browser settings instead.");
        }}
      >
        {label}
      </button>
      {done && <small role="status"> {done}</small>}
    </span>
  );
}
