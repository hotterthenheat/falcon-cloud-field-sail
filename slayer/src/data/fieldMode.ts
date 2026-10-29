/* Which model the exposure field draws, for the desk: the open-interest book, or the dealer gamma of today's trades by
   side (data/book/exposureLog.ts). Kept in this browser. */
import { useSyncExternalStore } from 'react';
import type { FieldMode } from './book/exposureLog';

const KEY = 'slayer_field_mode_v1';
const listeners = new Set<() => void>();

const read = (): FieldMode => {
  try {
    return localStorage.getItem(KEY) === 'flow' ? 'flow' : 'oi';
  } catch {
    return 'oi';
  }
};
let mode: FieldMode = read();

export const fieldMode = (): FieldMode => mode;

export function setFieldMode(next: FieldMode): void {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* the choice still holds for this page */
  }
  listeners.forEach(fn => fn());
}

export function useFieldMode(): FieldMode {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fieldMode,
    fieldMode,
  );
}

/** The models' names, as the legend and the toggle print them */
export const FIELD_MODE_WORDS: Record<FieldMode, { name: string; line: string }> = {
  oi: {
    name: 'Open interest',
    line: "Dealer gamma on this morning's open interest, dealers long the calls and short the puts — each cell the last reading inside the bar",
  },
  flow: {
    name: "Today's flow",
    line: "Dealer gamma from today's trades by side — bought at the ask leaves dealers short, sold at the bid leaves them long. Each cell is the change across the bar. Today's trades only: no position carried from earlier days",
  },
};
