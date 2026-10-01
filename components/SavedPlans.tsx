'use client';
/**
 * Saved plans. Stored in this browser only (localStorage), never sent to the
 * server. People can save versions of a plan, compare up to three side by side
 * and print or save the page as a PDF to take to an adviser.
 */
import { useEffect, useMemo, useState } from 'react';
import { projectHousehold, type HouseholdInput, type HouseholdResult } from '../lib/finance/household';
import { moneyFor, profile } from '../lib/countries';
import Link from 'next/link';
import { PLANS } from '../lib/plans';
import ClearDeviceData from './ClearDeviceData';

type SavedPlan = { id: string; name: string; savedAt: string; plan: HouseholdInput };
const KEY = 'irl:saved-plans';
const MAX_PLANS = 20;

function load(): SavedPlan[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.name === 'string' && p.plan) : [];
  } catch {
    return [];
  }
}

function store(plans: SavedPlan[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(plans));
    return true;
  } catch {
    return false;
  }
}

function summary(r: HouseholdResult) {
  const atRet = r.milestones.find((m) => m.age === r.retirementAge);
  return {
    netWorth: r.today.netWorth,
    surplus: r.today.monthlySurplus,
    atRetirement: atRet?.expected ?? r.today.netWorth,
    liquidAtRetirement: atRet?.liquid ?? r.today.liquid,
    runsOut: r.scenarios[1].shortfallAge,
    success: r.monteCarlo.successRate,
    goal: r.goal ? (r.goal.onTrack ? 'Yes' : 'No') : '—',
  };
}

/** Shown to Free and Basic users instead of the saved-plans tools. */
function LockedSavedPlans({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="saved-plans saved-plans-locked no-print" aria-labelledby="saved-title">
      <div className="saved-plans-head">
        <h2 id="saved-title">Save, compare and print your plans</h2>
      </div>
      <ul>
        <li>Save versions of your plan, such as &quot;Retire at 65&quot; and &quot;Retire at 67&quot;</li>
        <li>Compare up to three plans side by side</li>
        <li>Print or save a PDF report to take to an adviser</li>
      </ul>
      <p className="asset-editor-note">
        Included in {PLANS.premium.label} (${PLANS.premium.priceNzd} a month) and {PLANS.pro.label}. Cancel at any time.
        {!signedIn && ' Sign in first if you already have a plan.'}
      </p>
      <Link className="plan-button" href="/pricing">See plans</Link>
    </section>
  );
}

export default function SavedPlans({ plan, onLoad, canSave = true, signedIn = false }: {
  plan: HouseholdInput; onLoad: (p: HouseholdInput) => void; canSave?: boolean; signedIn?: boolean;
}) {
  if (!canSave) return <LockedSavedPlans signedIn={signedIn} />;
  return <SavedPlansTools plan={plan} onLoad={onLoad} />;
}

function SavedPlansTools({ plan, onLoad }: { plan: HouseholdInput; onLoad: (p: HouseholdInput) => void }) {
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSaved(load());
    // Empty the list when data is cleared from this device
    const cleared = () => { setSaved([]); setPicked([]); };
    window.addEventListener('irl:saved-plans-cleared', cleared);
    return () => window.removeEventListener('irl:saved-plans-cleared', cleared);
  }, []);

  const save = () => {
    const label = name.trim() || `Plan ${saved.length + 1}`;
    const next = [{ id: `${Date.now()}`, name: label.slice(0, 60), savedAt: new Date().toISOString(), plan }, ...saved].slice(0, MAX_PLANS);
    if (store(next)) {
      setSaved(next);
      setName('');
      setMessage(`Saved "${label}" on this device.`);
    } else {
      setMessage("This browser won't let the page save. Check that private browsing is off.");
    }
  };
  const remove = (id: string) => {
    const next = saved.filter((p) => p.id !== id);
    store(next);
    setSaved(next);
    setPicked((p) => p.filter((x) => x !== id));
  };

  const compared = useMemo(() => {
    const rows: { name: string; result: HouseholdResult }[] = [];
    try {
      rows.push({ name: 'Current plan', result: projectHousehold(plan) });
      for (const id of picked) {
        const p = saved.find((s) => s.id === id);
        if (p) rows.push({ name: p.name, result: projectHousehold(p.plan) });
      }
    } catch {
      return null;
    }
    return rows.length > 1 ? rows : null;
  }, [picked, saved, plan]);

  return (
    <section className="saved-plans no-print" aria-labelledby="saved-title">
      <div className="saved-plans-head">
        <h2 id="saved-title">Save and compare plans</h2>
      </div>
      <p className="asset-editor-note">Plans are saved in this browser only, without a password. Nothing is sent to us.</p>
      <p className="shared-device-warning" role="note">
        <strong>On a shared or public computer?</strong> Anyone who uses this browser after you can open saved plans.
        Don&apos;t save plans there, or clear them before you leave. <ClearDeviceData label="Clear saved plans and settings" />
      </p>
      <div className="saved-plans-save">
        <div className="calc-input">
          <input aria-label="Plan name" placeholder="Name this version, e.g. Retire at 67" value={name} maxLength={60}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="button" className="asset-add-button" onClick={save}>Save this plan</button>
      </div>
      {message && <p className="asset-editor-note" role="status">{message}</p>}

      {saved.length > 0 && (
        <ul className="saved-plans-list">
          {saved.map((p) => (
            <li key={p.id}>
              <label className="asset-growth-toggle">
                <input type="checkbox" checked={picked.includes(p.id)} disabled={!picked.includes(p.id) && picked.length >= 3}
                  onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
                <span><strong>{p.name}</strong> <small>{new Date(p.savedAt).toLocaleDateString()}</small></span>
              </label>
              <span className="saved-plans-actions">
                <button type="button" className="link-button" onClick={() => onLoad(p.plan)}>Open</button>
                <button type="button" className="link-button is-danger" onClick={() => remove(p.id)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {saved.length > 0 && !compared && <p className="asset-editor-note">Tick up to three saved plans to compare them with the current one.</p>}

      {compared && (
        <div className="table-scroll">
          <table className="milestone-table">
            <caption>Plans side by side (expected case, today&apos;s money)</caption>
            <thead>
              <tr>
                <th scope="col">Plan</th><th scope="col">Country</th><th scope="col">Net worth today</th><th scope="col">Monthly surplus</th>
                <th scope="col">Net worth at retirement</th><th scope="col">Cash and investments at retirement</th>
                <th scope="col">Money runs out</th><th scope="col">Chance savings last</th><th scope="col">Goal met</th>
              </tr>
            </thead>
            <tbody>
              {compared.map(({ name: n, result }) => {
                const s = summary(result);
                const money = moneyFor(result.inputs.country);
                return (
                  <tr key={n}>
                    <th scope="row">{n}</th>
                    <td>{profile(result.inputs.country).code}</td>
                    <td>{money(s.netWorth)}</td>
                    <td>{money(s.surplus)}</td>
                    <td className="is-expected">{money(s.atRetirement)}</td>
                    <td>{money(s.liquidAtRetirement)}</td>
                    <td>{s.runsOut === null ? 'Lasts' : `Age ${s.runsOut}`}</td>
                    <td>{Math.round(s.success * 100)}%</td>
                    <td>{s.goal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
