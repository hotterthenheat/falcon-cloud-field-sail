/* Which model the exposure field draws, for the desk: the open-interest book, or the dealer gamma of today's trades by
   side (data/book/exposureLog.ts). Kept in this browser. */
import { useSyncExternalStore } from 'react';
import type { FieldMode } from './book/exposureLog';

const KEY = 'slayer_field_mode_v1';
const listeners = new Set<() => void>();

const read = (): FieldMode => {
  try {
    return localStorage.getItem(KEY) === 'oi' ? 'oi' : 'flow';
  } catch {
    return 'flow';
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
    line: 'Open-interest gamma only, the same cells as dealer flow. The level stays on the strike until a newer reading replaces it',
  },
  flow: {
    name: 'Dealer flow',
    line: 'Open interest plus the ask and the bid, dollars per 1%. The level stays on the strike until a newer reading replaces it. Not the change from bar to bar',
  },
};
