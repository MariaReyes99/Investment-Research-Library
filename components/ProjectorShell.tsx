'use client';
/**
 * The wealth projector page: a guided, step-by-step setup by default, and an
 * "All details" view with every option. Whatever was entered in the guided
 * setup is carried into "All details", whichever way the person switches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import PlannerWizard from './PlannerWizard';
import HouseholdPlanner from './HouseholdPlanner';
import type { HouseholdInput } from '../lib/finance/household';
import { projectorLink } from '../lib/finance/householdLink';

type View = 'guided' | 'full';

export default function ProjectorShell() {
  const [view, setView] = useState<View>('guided');
  const guidedPlan = useRef<HouseholdInput | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'full' || window.location.hash.startsWith('#plan=')) setView('full');
  }, []);

  const rememberGuided = useCallback((p: HouseholdInput | null) => { guidedPlan.current = p; }, []);

  const choose = (v: View) => {
    if (v === view) return;
    if (v === 'full' && guidedPlan.current) {
      // Hand the guided answers to "All details" (it reads them from the address, on this device only)
      const hash = projectorLink(guidedPlan.current).split('#')[1];
      window.history.replaceState(null, '', `/calculator?view=full#${hash}`);
    } else {
      window.history.replaceState(null, '', v === 'full' ? '/calculator?view=full' : '/calculator');
    }
    setView(v);
  };

  return (
    <>
      <div className="projector-tabs no-print" role="tablist" aria-label="How to fill in the projector">
        <button type="button" role="tab" aria-selected={view === 'guided'} className={view === 'guided' ? 'is-on' : ''} onClick={() => choose('guided')}>
          <span aria-hidden="true">🧭</span> Guided setup <small>Step by step, about 5 minutes</small>
        </button>
        <button type="button" role="tab" aria-selected={view === 'full'} className={view === 'full' ? 'is-on' : ''} onClick={() => choose('full')}>
          <span aria-hidden="true">🛠️</span> All details <small>Every option on one page</small>
        </button>
      </div>
      {view === 'guided' ? <PlannerWizard onPlanChange={rememberGuided} /> : <HouseholdPlanner />}
    </>
  );
}
