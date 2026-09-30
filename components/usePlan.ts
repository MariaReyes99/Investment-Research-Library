'use client';
/** The signed-in visitor's plan, read from /api/usage. */
import { useEffect, useState } from 'react';
import type { Plan } from '../lib/plans';

export type PlanInfoState = { plan: Plan; signedIn: boolean; loaded: boolean };

export function usePlan(): PlanInfoState {
  const [state, setState] = useState<PlanInfoState>({ plan: 'free', signedIn: false, loaded: false });
  useEffect(() => {
    fetch('/api/usage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plan?: Plan; signedIn?: boolean } | null) =>
        setState({ plan: d?.plan ?? 'free', signedIn: Boolean(d?.signedIn), loaded: true }))
      .catch(() => setState((s) => ({ ...s, loaded: true })));
  }, []);
  return state;
}
