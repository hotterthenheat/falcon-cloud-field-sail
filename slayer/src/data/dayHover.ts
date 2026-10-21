import { useSyncExternalStore } from 'react';

/*
==================================================
  SLAYER TERMINAL - ONE MINUTE UNDER THE POINTER (data/dayHover.ts)

  The day box draws the tape and the book's net gamma on one clock (idea 1,
  2026-10-13). The minute under the pointer on either plot is marked on
  both — this is the one minute, set by whichever plot has the pointer,
  read by the other. It belongs to ONE name: a second ticker on the map
  does not follow it.
==================================================
*/

export type DayHover = { min: number; from: 'tape' | 'through'; ticker: string } | null;

let current: DayHover = null;
const subs = new Set<() => void>();

const same = (a: DayHover, b: DayHover) =>
  (a?.min ?? null) === (b?.min ?? null) && (a?.from ?? null) === (b?.from ?? null) && (a?.ticker ?? null) === (b?.ticker ?? null);

export const setDayHover = (next: DayHover): void => {
  if (same(current, next)) return;
  current = next;
  subs.forEach(f => f());
};

/** Drop the minute only if this plot still owns it — another name's pane must not be cleared. */
export const clearDayHover = (ticker: string, from: 'tape' | 'through'): void => {
  if (current && current.ticker === ticker && current.from === from) setDayHover(null);
};

export const useDayHover = (): DayHover =>
  useSyncExternalStore(
    f => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => current
  );
