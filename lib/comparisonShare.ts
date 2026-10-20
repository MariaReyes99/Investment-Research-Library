'use client';
/**
 * A short text summary of the retirement fund comparison, so the library chat
 * can answer questions about it together with the wealth projector plan.
 * Kept on this device only (localStorage, like the projector plan), so it is
 * still linked after a reload or when the comparison is closed. It is sent
 * with a question only while "Include my financial numbers" is on, and "Start again" or
 * "Clear my data" removes it.
 */
import { useSyncExternalStore } from 'react';

export const COMPARISON_STATE_KEY = 'irl:fund-comparison';
export const COMPARISON_SUMMARY_KEY = 'irl:fund-comparison-summary';

let summary = '';
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try { summary = window.localStorage.getItem(COMPARISON_SUMMARY_KEY) ?? ''; } catch { summary = ''; }
}

export function setComparisonSummary(text: string) {
  load();
  const next = text.slice(0, 6000);
  if (next === summary) return;
  summary = next;
  try {
    if (next) window.localStorage.setItem(COMPARISON_SUMMARY_KEY, next);
    else window.localStorage.removeItem(COMPARISON_SUMMARY_KEY);
  } catch { /* storage unavailable: keep it in memory */ }
  listeners.forEach((l) => l());
}

/** Forget the saved comparison and its summary (Start again / Clear my data). */
export function clearSavedComparison() {
  try { window.localStorage.removeItem(COMPARISON_STATE_KEY); } catch { /* ignore */ }
  setComparisonSummary('');
}

export function hasSavedComparison(): boolean {
  try { return !!window.localStorage.getItem(COMPARISON_STATE_KEY); } catch { return false; }
}

export function useComparisonSummary(): string {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => { load(); return summary; },
    () => '',
  );
}
