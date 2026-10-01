'use client';
/**
 * The wealth projector page: a guided, step-by-step setup by default, and an
 * "All details" view with every option. "See every detail" at the end of the
 * guided setup opens the same answers in the full view.
 */
import { useEffect, useState } from 'react';
import PlannerWizard from './PlannerWizard';
import HouseholdPlanner from './HouseholdPlanner';

type View = 'guided' | 'full';

export default function ProjectorShell() {
  const [view, setView] = useState<View>('guided');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'full' || window.location.hash.startsWith('#plan=')) setView('full');
  }, []);
  const choose = (v: View) => {
    setView(v);
    const url = v === 'full' ? '/calculator?view=full' : '/calculator';
    window.history.replaceState(null, '', url + (v === 'full' ? window.location.hash : ''));
  };
  return (
    <>
      <div className="projector-tabs" role="tablist" aria-label="How to fill in the projector">
        <button type="button" role="tab" aria-selected={view === 'guided'} className={view === 'guided' ? 'is-on' : ''} onClick={() => choose('guided')}>
          <span aria-hidden="true">🧭</span> Guided setup <small>Step by step, about 5 minutes</small>
        </button>
        <button type="button" role="tab" aria-selected={view === 'full'} className={view === 'full' ? 'is-on' : ''} onClick={() => choose('full')}>
          <span aria-hidden="true">🛠️</span> All details <small>Every option on one page</small>
        </button>
      </div>
      {view === 'guided' ? <PlannerWizard /> : <HouseholdPlanner />}
    </>
  );
}
