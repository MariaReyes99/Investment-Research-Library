'use client';
/**
 * Reads the plan this person built in the wealth projector, from this browser.
 * Prefers the "Advanced" plan (more complete); otherwise converts the
 * guided answers. Nothing leaves the device unless the chat's "Include my
 * plan" switch is on.
 */
import { useEffect, useState } from 'react';
import { HouseholdInputSchema, type HouseholdInput } from '../lib/finance/household';
import { isCountry, type CountryCode } from '../lib/countries';
import { answersToPlan, type Answers } from './PlannerWizard';

export type ProjectorPlan = { plan: HouseholdInput; source: 'full' | 'guided' };

function read(country: CountryCode): ProjectorPlan | null {
  try {
    const full = HouseholdInputSchema.safeParse(JSON.parse(window.localStorage.getItem('irl:full-plan') ?? 'null'));
    if (full.success && (full.data.investments.length || full.data.properties.length || full.data.incomes.length || full.data.cashOnHand > 0)) {
      return { plan: full.data as HouseholdInput, source: 'full' };
    }
    const guided = JSON.parse(window.localStorage.getItem('irl:guided') ?? 'null') as { a?: Answers } | null;
    if (guided?.a && typeof guided.a.age === 'number') {
      const retire = window.localStorage.getItem('irl:retire-in');
      const plan = answersToPlan(
        { ...guided.a, savings: guided.a.savings ?? [], homes: guided.a.homes ?? [], family: guided.a.family ?? [], foreignPensions: guided.a.foreignPensions ?? [] },
        country,
        isCountry(retire) ? retire : null,
      );
      if (HouseholdInputSchema.safeParse(plan).success) return { plan, source: 'guided' };
    }
  } catch { /* nothing usable saved */ }
  return null;
}

export function useProjectorPlan(country: CountryCode): ProjectorPlan | null {
  const [value, setValue] = useState<ProjectorPlan | null>(null);
  useEffect(() => {
    const refresh = () => setValue(read(country));
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('irl:saved-plans-cleared', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('irl:saved-plans-cleared', refresh);
    };
  }, [country]);
  return value;
}
