'use client';
/**
 * A short text summary of the fund comparison on this page, so the library chat
 * can answer questions about it. It lives in memory only (never saved), and is
 * sent with a question only while "Include my numbers" is on.
 */
import { useSyncExternalStore } from 'react';

let summary = '';
const listeners = new Set<() => void>();

export function setComparisonSummary(text: string) {
  const next = text.slice(0, 4000);
  if (next === summary) return;
  summary = next;
  listeners.forEach((l) => l());
}

export function useComparisonSummary(): string {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => summary,
    () => '',
  );
}
