import { useSyncExternalStore } from 'react';

/*
==================================================
  SLAYER TERMINAL - THE PANELS PINNED TO THE TICKER BAR (data/barPins.ts)

  Ported from the partner tree (2026-11-01, the owner: "the panels and all of that stuff is way better than ours").
  Terrain's ticker bar ends in a PANELS door — every side panel and tool in sections, a pin beside each — and the
  pinned ones stand on the bar as 32px icon buttons between the standing menus and the door (ChartToolbar `panels`,
  the list built by the Terrain pane). Which ids stand on the bar is this store's whole content.

  One set for the whole app, kept on this machine. By rest: Replay, the book's two faces in the dock (Matrix and
  Calendar) and the strike rail. A pinned id with no row draws nothing.
==================================================
*/

const KEY = 'slayer_bar_pins_v1';
export const BAR_PINS_BY_REST: readonly string[] = ['replay', 'ladder', 'heat', 'rail'];

const tidy = (list: readonly string[]): string[] => Array.from(new Set(list.filter(v => typeof v === 'string' && v.length > 0 && v.length < 40)));

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(got) ? tidy(got.map(String)) : [...BAR_PINS_BY_REST];
  } catch {
    return [...BAR_PINS_BY_REST];
  }
};

let current: string[] = typeof window === 'undefined' ? [...BAR_PINS_BY_REST] : read();
const subs = new Set<() => void>();

/** The pinned ids, in the order they were pinned */
export const barPins = (): readonly string[] => current;

export function setBarPins(list: readonly string[]): void {
  current = tidy(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage off — the choice lives for the session */
  }
  subs.forEach(f => f());
}

/** Pin or unpin one — an empty set is allowed; the bar then shows the door alone */
export const toggleBarPin = (id: string): void => setBarPins(current.includes(id) ? current.filter(v => v !== id) : [...current, id]);

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const useBarPins = (): readonly string[] => useSyncExternalStore(subscribe, barPins, barPins);
