import { useSyncExternalStore } from 'react';

/*
==================================================
  SLAYER TERMINAL - THE DESK'S DOCK, OPEN OR SHUT (pages/terrain/dockStore.ts)

  Which room stands beside Terrain's charts, and how wide each room stands — the partner tree's data/terrainDock.ts,
  ported whole as a mechanism (2026-11-01, the owner: "the panels and all of that stuff is way better than ours") and
  filled with OUR rooms. openmarket docks its side panels in one column at the desk's right edge, under the ticker bar,
  one room at a time — 316px for its trade rail, ~560 for its Earnings and Events. The Panels door on the ticker bar
  opens a room; the same row, the room's pin on the bar, or the × shuts it. Every room reads the ACTIVE pane's name:

    ladder   · MATRIX   — the strike rail's Matrix view: put · call · net by strike (the book's field, every leg)
    heat     · CALENDAR — the strike rail's Calendar view: the book across its expiries, the heat in the cells
    surface  · SURFACE  — dealer gamma across spot, the skew, the charm/vanna drift (the rail's lenses)
    regime   · REGIME   — the VIX term structure, the gauges and the two ratios
    building · BUILDING — Pinpoint's overnight open-interest ledger
    prints   · PRINTS   — the session's option and stock prints
    flow     · NET FLOW — the partner's room (bfce19c): net calls against net puts through the session, off OUR flow
                          pane's prints and arithmetic (dock/FlowRoom.tsx)
    news     · NEWS     — the wire on the name, and its next report
    earnings · EARNINGS — the week's reports;  events · EVENTS — what lands when

  The strike rail beside each chart stays (R, and its Panels row); the dock is the room for a bigger read.
  Shut by rest. Kept on this machine; storage off is never fatal.
==================================================
*/

export type DockRoom = 'ladder' | 'heat' | 'surface' | 'flow' | 'regime' | 'building' | 'prints' | 'news' | 'earnings' | 'events';
export const DOCK_ROOMS: readonly DockRoom[] = ['ladder', 'heat', 'surface', 'flow', 'regime', 'building', 'prints', 'news', 'earnings', 'events'];

/* ONE HOME FOR STRIKE CONTENT (2026-11-02, the owner: "the panel is messing up because it's bringing up strike things
   but will only do it on the right side"; docs/terrain-panels.md). Six rooms are views of a pane's strike rail. On the
   desk they open IN THE ACTIVE PANE'S RAIL, on that view, beside the chart they read — never as a second copy at the
   desk's right edge. The dock column holds the desk-level rooms alone. The phone has no rails, so its sheet keeps
   every room as a tab. */
export type RailRoomView = 'net' | 'gex' | 'surface' | 'regime' | 'building' | 'prints';
export const RAIL_VIEW_OF_ROOM: Partial<Record<DockRoom, RailRoomView>> = {
  ladder: 'net',
  heat: 'gex',
  surface: 'surface',
  regime: 'regime',
  building: 'building',
  prints: 'prints',
};
export const isRailRoom = (room: DockRoom | null): boolean => !!room && RAIL_VIEW_OF_ROOM[room] != null;
/** The rooms the desk's dock column stands: the ones that are not a view of a pane's rail */
export const DESK_ROOMS: readonly DockRoom[] = DOCK_ROOMS.filter(r => !isRailRoom(r));
/** The narrowest a grid column stands beside the dock: the dock gives way before a chart is crushed */
export const DOCK_COLUMN_FLOOR = 320;
/** How wide the dock may stand in a desk row this wide, with this many grid columns beside it (and the drawing rail's
    width at the row's lead): never under DOCK_MIN_W, never so wide that a column falls under DOCK_COLUMN_FLOOR */
export const dockRoomFor = (rowW: number, cols: number, lead = 0): number =>
  Math.max(DOCK_MIN_W, Math.round(rowW - lead - cols * DOCK_COLUMN_FLOOR - 6 * cols));

/** Measured on openmarket (the partner tree's numbers): the trade rail 316, the Earnings and Events panels ~560. The
    book's matrix and calendar read better a little wider, so they open at 380. */
export const DOCK_WIDTH_BY_REST: Record<DockRoom, number> = {
  ladder: 380,
  heat: 380,
  surface: 380,
  /* the partner's Net flow room opens at his rail's 316 */
  flow: 316,
  regime: 340,
  building: 340,
  prints: 340,
  news: 316,
  earnings: 560,
  events: 560,
};
export const DOCK_MIN_W = 316;
export const DOCK_MAX_W = 820;

const KEY = 'slayer_terrain_dock_v1';
const W_KEY = 'slayer_terrain_dock_widths_v1';

export const isDockRoom = (v: unknown): v is DockRoom => typeof v === 'string' && (DOCK_ROOMS as readonly string[]).includes(v);
export const clampDockW = (px: number): number => (Number.isFinite(px) ? Math.min(DOCK_MAX_W, Math.max(DOCK_MIN_W, Math.round(px))) : DOCK_MIN_W);

const read = (): DockRoom | null => {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    return isDockRoom(got) ? got : null;
  } catch {
    return null;
  }
};
const readWidths = (): Partial<Record<DockRoom, number>> => {
  try {
    const raw = localStorage.getItem(W_KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    if (!got || typeof got !== 'object') return {};
    const out: Partial<Record<DockRoom, number>> = {};
    for (const [k, v] of Object.entries(got as Record<string, unknown>)) if (isDockRoom(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = clampDockW(v);
    return out;
  } catch {
    return {};
  }
};

let current: DockRoom | null = typeof window === 'undefined' ? null : read();
let widths: Partial<Record<DockRoom, number>> = typeof window === 'undefined' ? {} : readWidths();
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const dockRoom = (): DockRoom | null => current;

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
/** The room's row pressed: open it, or shut the dock when it is the one up */
export const toggleDock = (room: DockRoom): void => setDock(current === room ? null : room);
export const closeDock = (): void => setDock(null);

/** How wide the room stands — its own remembered width, else openmarket's for its kind */
export const dockWidth = (room: DockRoom): number => clampDockW(widths[room] ?? DOCK_WIDTH_BY_REST[room]);
export function setDockWidth(room: DockRoom, px: number): void {
  const w = clampDockW(px);
  if (widths[room] === w) return;
  widths = { ...widths, [room]: w };
  try {
    localStorage.setItem(W_KEY, JSON.stringify(widths));
  } catch {
    /* storage off */
  }
  notify();
}

export const useDock = (): DockRoom | null => useSyncExternalStore(subscribe, dockRoom, () => null);
export const useDockWidth = (room: DockRoom): number =>
  useSyncExternalStore(
    subscribe,
    () => dockWidth(room),
    () => DOCK_WIDTH_BY_REST[room]
  );
