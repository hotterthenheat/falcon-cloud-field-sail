import { useSyncExternalStore } from 'react';

/*
==================================================
  SLAYER TERMINAL - THE DESK'S DOCK, OPEN OR SHUT (pages/terrain/dockStore.ts)

  Which dock room stands beside Terrain's charts, and how wide (ported from the partner tree's data/terrainDock.ts,
  2026-10-31). Two rooms, the two the desk had no way to see: EARNINGS (the week's reports, the fortnight feed every
  earnings page reads) and EVENTS (the economic calendar, the reports and the name's expiries on one clock). The
  strike rail already carries Building, Prints, Regime and Surface, and the book's matrix and calendar live there too —
  the dock does not repeat them.

  SHUT BY REST: the owner's word on three panes was "crowded", so nothing opens on its own — the door on the desk bar
  opens a room, the × or the door again shuts it. The width is the reader's by the grip, narrow by rest (380, against
  the partner tree's 560). Kept on this machine; storage off is never fatal.
==================================================
*/

export type DockRoom = 'earnings' | 'events';
export const DOCK_ROOMS: readonly DockRoom[] = ['earnings', 'events'];

export const DOCK_W_BY_REST = 380;
export const DOCK_MIN_W = 340;
export const DOCK_MAX_W = 640;

const KEY = 'slayer_terrain_dock_v1';
const W_KEY = 'slayer_terrain_dock_w_v1';

const isRoom = (v: unknown): v is DockRoom => typeof v === 'string' && (DOCK_ROOMS as readonly string[]).includes(v);
export const clampDockW = (px: number): number => (Number.isFinite(px) ? Math.min(DOCK_MAX_W, Math.max(DOCK_MIN_W, Math.round(px))) : DOCK_W_BY_REST);

const read = (): DockRoom | null => {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    return isRoom(got) ? got : null;
  } catch {
    return null;
  }
};
const readW = (): number => {
  try {
    const raw = localStorage.getItem(W_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampDockW(n) : DOCK_W_BY_REST;
  } catch {
    return DOCK_W_BY_REST;
  }
};

let current: DockRoom | null = typeof window === 'undefined' ? null : read();
let width: number = typeof window === 'undefined' ? DOCK_W_BY_REST : readW();
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const dockRoom = (): DockRoom | null => current;
export const dockWidth = (): number => width;

export function setDock(room: DockRoom | null): void {
  if (current === room) return;
  current = room;
  try {
    localStorage.setItem(KEY, JSON.stringify(room));
  } catch {
    /* storage off — the choice lives for the session */
  }
  notify();
}
/** The room's door pressed: open it, or shut the dock when it is the one up */
export const toggleDock = (room: DockRoom): void => setDock(current === room ? null : room);
export const closeDock = (): void => setDock(null);

export function setDockWidth(px: number): void {
  const w = clampDockW(px);
  if (w === width) return;
  width = w;
  try {
    localStorage.setItem(W_KEY, String(w));
  } catch {
    /* storage off */
  }
  notify();
}

export const useDock = (): DockRoom | null => useSyncExternalStore(subscribe, dockRoom, () => null);
export const useDockWidth = (): number => useSyncExternalStore(subscribe, dockWidth, () => DOCK_W_BY_REST);
