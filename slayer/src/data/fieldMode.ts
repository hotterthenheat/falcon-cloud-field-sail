/* Which model the exposure field draws, for the desk: the open-interest book, or the dealer gamma of today's trades by
   side (data/book/exposureLog.ts). Kept in this browser. */
import { useSyncExternalStore } from 'react';
import type { FieldMode } from './book/exposureLog';
import { BOOK_MODE_WORDS } from './bookMode';

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
    name: BOOK_MODE_WORDS.oi.label,
    line: `${BOOK_MODE_WORDS.oi.line}, dollars per 1%. A level stays on its strike until a newer reading replaces it`,
  },
  flow: {
    name: BOOK_MODE_WORDS.flow.label,
    line: `${BOOK_MODE_WORDS.flow.line}, dollars per 1%. A level stays on its strike until a newer reading replaces it — a level, not the change from bar to bar`,
  },
};
