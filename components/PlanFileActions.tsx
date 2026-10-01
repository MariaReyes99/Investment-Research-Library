'use client';
/**
 * Download a plan to a file, open a plan file again later, or print the
 * results (or save them as a PDF). Files are created and read on this device;
 * nothing is sent to us. Part of the Premium and Adviser plans, like saved plans.
 */
import Link from 'next/link';
import { useState } from 'react';
import { HouseholdInputSchema, type HouseholdInput } from '../lib/finance/household';
import { canSavePlans, PLANS } from '../lib/plans';
import { usePlan } from './usePlan';

const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function downloadPlan(plan: HouseholdInput) {
  const file = new Blob([JSON.stringify({ app: 'investment-research-library', version: 1, savedAt: new Date().toISOString(), plan }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-money-plan-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readPlanFile(file: File): Promise<HouseholdInput | null> {
  if (file.size > 1024 * 1024) return null;
  try {
    const data = JSON.parse(await file.text());
    const parsed = HouseholdInputSchema.safeParse(data?.plan ?? data);
    return parsed.success ? (parsed.data as HouseholdInput) : null;
  } catch {
    return null;
  }
}

export function printResults() {
  document.querySelectorAll<HTMLDetailsElement>('.calc-results details, .wizard-results details').forEach((d) => { d.open = true; });
  window.print();
}

export default function PlanFileActions({ plan, onOpen }: { plan: HouseholdInput | null; onOpen: (p: HouseholdInput) => void }) {
  const account = usePlan();
  const [message, setMessage] = useState<string | null>(null);
  const allowed = !clerkOn || canSavePlans(account.plan);

  if (!account.loaded) return null;
  if (!allowed) {
    return (
      <div className="plan-files is-locked no-print">
        <strong>📁 Download, open and print your plan</strong>
        <p>
          Keep a copy of your plan as a file, open it again any time, or print it to take to an adviser. Included in{' '}
          {PLANS.premium.label} (${PLANS.premium.priceNzd} a month) and {PLANS.pro.label}.
        </p>
        <Link className="wizard-button is-quiet" href="/pricing">See plans</Link>
      </div>
    );
  }

  return (
    <div className="plan-files no-print">
      <strong>📁 Keep your plan</strong>
      <div className="plan-files-buttons">
        <button type="button" className="wizard-button is-quiet" disabled={!plan} onClick={() => { if (plan) { downloadPlan(plan); setMessage('Saved to your Downloads folder. Keep it somewhere private.'); } }}>
          ⬇️ Download my plan
        </button>
        <label className="wizard-button is-quiet statement-pick">
          📂 Open a plan file
          <input type="file" accept=".json,application/json" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const p = await readPlanFile(f);
            if (p) { onOpen(p); setMessage('Plan opened.'); } else setMessage("That file isn't a plan from this projector.");
          }} />
        </label>
        <button type="button" className="wizard-button is-quiet" onClick={printResults}>🖨️ Print or save as PDF</button>
      </div>
      <p className="wizard-help">Files are made and opened on this device; nothing is sent to us. A plan file holds your numbers, so store it privately.</p>
      {message && <p className="wizard-help" role="status">{message}</p>}
    </div>
  );
}
