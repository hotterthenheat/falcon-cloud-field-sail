/*
==================================================
  SLAYER TERMINAL - PULSE DESKS
  Named, saved layouts for the Pulse desk (Mo,
  2026-08-19: "save a Pulse layout and come back
  to it instead of rebuilding it"). Every desk,
  preset or the reader's own, autosaves its working
  state as you go, and a preset can always be reset
  to its template.

  A NEW STORE (2026-09-30, the desk rebuilt): every
  widget and every preset the old store named is
  gone, so the desks start clean under a new key —
  `slayer_desks_v2`. Nothing is carried from v1: its
  desks pointed at widgets that no longer exist (and
  the terminal is not launched — the only desks in
  it are ours).

  FIVE PRESETS, named for the moment they serve:

    The session   the chart, the book as a matrix,
                  the range to the close, what has
                  alerted — a first visit opens here
    The open      the chart, the book across the
                  calendar, the levels, the wire, who
                  reports
    0DTE          a one-minute chart, today's book,
                  where it closes, the wall in front,
                  the targets
    The close     the chart, where it closes, the
                  range, where the walls are heading
    My book       positions and watchlist, the chain,
                  the setups that fit, the key levels
                  (the paper account and the journal
                  left it on 2026-10-03, at Noah's word)

  An instance carries its own settings (`state`):
  a preset's calendar is the book tile told to open
  on its calendar. (The book has two views, the matrix
  and the calendar; the ladder went at Noah's word,
  2026-09-30.)
==================================================
*/

import type { Layout } from 'react-grid-layout';
import { widgetByKey } from './registry';
import type { TileState } from './tile';

export interface WidgetInstance {
  id: string;
  key: string;
  /** Pinned (UNLINKED) to its own name; undefined = linked to the terminal. */
  ticker?: string;
  /** The tile's own settings, over its widget's defaults */
  state?: TileState;
}

export interface SavedWorkspace {
  instances: WidgetInstance[];
  layout: Layout[];
}

export interface DeskStore {
  active: string;
  desks: Record<string, SavedWorkspace>;
  /** The desk held still — nothing drags, nothing resizes */
  locked?: boolean;
}

export const DESKS_KEY = 'slayer_desks_v2';

/** A preset cell — the size bounds come from the registry so a template can never break a widget's own floor. */
const cell = (key: string, x: number, y: number, w: number, h: number, state?: TileState): { inst: WidgetInstance; l: Layout } => {
  const def = widgetByKey(key);
  const id = `${key}-1`;
  return {
    inst: state ? { id, key, state } : { id, key },
    l: { i: id, x, y, w, h, minW: def?.minW, minH: def?.minH, maxH: def?.maxH },
  };
};

const assemble = (cells: { inst: WidgetInstance; l: Layout }[]): SavedWorkspace => ({
  instances: cells.map(c => c.inst),
  layout: cells.map(c => c.l),
});

/** The house's desks, in the order the bar shows them — built on first use (the registry and this file name each other) */
let presets: Record<string, SavedWorkspace> | null = null;
export const PRESETS = (): Record<string, SavedWorkspace> =>
  (presets ??= {
    /* the range, where it closes and at the wall left the desks on 2026-10-17 with their pages; the three desks that held
       them are refilled with the tiles that stand — where the walls are heading, the targets and the levels */
    'The session': assemble([cell('chart', 0, 0, 7, 5), cell('book', 7, 0, 5, 5, { view: 'matrix' }), cell('heading', 0, 5, 7, 4), cell('levels', 7, 5, 5, 4)]),
    'The open': assemble([cell('chart', 0, 0, 6, 5), cell('book', 6, 0, 6, 5, { view: 'calendar' }), cell('levels', 0, 5, 4, 4), cell('news', 4, 5, 4, 4), cell('earnings', 8, 5, 4, 4)]),
    '0DTE': assemble([cell('chart', 0, 0, 6, 5, { tf: '1m' }), cell('book', 6, 0, 6, 5, { view: 'matrix', expiry: '0DTE' }), cell('targets', 0, 5, 6, 4), cell('levels', 6, 5, 6, 4)]),
    'The close': assemble([cell('chart', 0, 0, 7, 5), cell('heading', 7, 0, 5, 5), cell('targets', 0, 5, 6, 4), cell('levels', 6, 5, 6, 4)]),
    'My book': assemble([cell('positions', 0, 0, 7, 4), cell('setups', 7, 0, 5, 4), cell('chain', 0, 4, 7, 5), cell('levels', 7, 4, 5, 5)]),
  });

/** One line per preset — what the desk is FOR */
export const PRESET_BLURBS: Record<string, string> = {
  'The session': 'The working desk: the chart, the book as a matrix beside it, where the walls are heading and the key levels beneath.',
  'The open': 'Before the bell and the first hour: the chart, the book across the calendar, the levels, the wire and who reports.',
  '0DTE': 'Today’s expiry: a one-minute chart, today’s book, the strikes that matter and the key levels.',
  'The close': 'The last hour: the chart, where the walls are heading by the close, the strikes that matter and the levels.',
  'My book': 'What you hold and watch: positions and watchlist, the chain, the setups that fit the levels and the levels themselves.',
};

export const PRESET_NAMES = ['The session', 'The open', '0DTE', 'The close', 'My book'];
export const isPreset = (name: string) => PRESET_NAMES.includes(name);

/** Drop tiles whose widget left the registry; ground off-grid coordinates; and re-apply every widget's size bounds, so
    the rule holds on disk as well as on the grid. */
export function sanitize(ws: SavedWorkspace): SavedWorkspace {
  const instances = (ws.instances ?? []).filter(w => w && widgetByKey(w.key));
  return {
    instances,
    layout: (ws.layout ?? [])
      .filter(l => instances.some(w => w.id === l.i))
      .map(l => {
        const def = widgetByKey(instances.find(w => w.id === l.i)?.key ?? '');
        const bounded = def ? { minW: def.minW, minH: def.minH, maxH: def.maxH, w: Math.max(def.minW, l.w), h: Math.min(def.maxH, Math.max(def.minH, l.h)) } : {};
        return { ...l, x: Number.isFinite(l.x) ? l.x : 0, y: Number.isFinite(l.y) ? l.y : 0, ...bounded };
      }),
  };
}

const clone = (ws: SavedWorkspace): SavedWorkspace => JSON.parse(JSON.stringify(ws));

export function loadDesks(): DeskStore {
  let store: DeskStore | null = null;
  try {
    const raw = localStorage.getItem(DESKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DeskStore;
      if (parsed && typeof parsed.active === 'string' && parsed.desks && typeof parsed.desks === 'object') store = parsed;
    }
  } catch {
    store = null;
  }
  if (!store) store = { active: PRESET_NAMES[0], desks: {} };
  // Seed any preset that is missing (a first run, or a preset added later)
  for (const name of PRESET_NAMES) if (!store.desks[name]) store.desks[name] = clone(PRESETS()[name]);
  // Sanitize everything that came off disk
  /* A HOUSE DESK WHOSE TILE LEFT THE REGISTRY IS REBUILT FROM ITS PRESET (2026-10-03, Paper and Journal leaving Pulse): a
     stored My book would otherwise keep two tiles and two holes — the house changed the desk, not the reader */
  for (const name of PRESET_NAMES) {
    const d = store.desks[name];
    if (d && (d.instances ?? []).some(w => w && !widgetByKey(w.key))) store.desks[name] = clone(PRESETS()[name]);
  }
  for (const name of Object.keys(store.desks)) store.desks[name] = sanitize(store.desks[name]);
  if (!store.desks[store.active]) store.active = PRESET_NAMES[0];
  return store;
}

export function saveDesks(store: DeskStore): void {
  try {
    localStorage.setItem(DESKS_KEY, JSON.stringify(store));
  } catch {
    /* quota or private mode — the desk still works for the session */
  }
}

export const presetTemplate = (name: string): SavedWorkspace | null => (isPreset(name) ? clone(PRESETS()[name]) : null);

export const GRID_COLS = 12;

/**
 * Where a new tile lands (Noah, 2026-08-19: "it should fill the closest
 * empty space from the top → down... the nearest empty box that is a
 * reasonable size"). Scans rows top-down and columns left-right; at each
 * cell, the biggest size that fits — the widget's default first, shrinking
 * toward its minimum when the hole is narrower or shorter. The first cell with
 * ANY fit wins, so height (being near the top) beats size. Nothing fits above
 * the occupied band → the bottom, at default size.
 */
export function firstFit(layout: Layout[], def: { w: number; h: number; minW?: number; minH?: number }): { x: number; y: number; w: number; h: number } {
  const occupied = new Set<string>();
  let bottom = 0;
  for (const l of layout) {
    for (let x = l.x; x < l.x + l.w; x++) for (let y = l.y; y < l.y + l.h; y++) occupied.add(`${x},${y}`);
    bottom = Math.max(bottom, l.y + l.h);
  }
  const minW = Math.max(1, def.minW ?? def.w);
  const minH = Math.max(1, def.minH ?? def.h);
  const fits = (x: number, y: number, w: number, h: number) => {
    if (x + w > GRID_COLS) return false;
    for (let cx = x; cx < x + w; cx++) for (let cy = y; cy < y + h; cy++) if (occupied.has(`${cx},${cy}`)) return false;
    return true;
  };
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x <= GRID_COLS - minW; x++) {
      // Largest size at this cell: widest first, then tallest — a tile would rather be its full width and a little short than a sliver.
      for (let w = def.w; w >= minW; w--) {
        for (let h = def.h; h >= minH; h--) {
          if (fits(x, y, w, h)) return { x, y, w, h };
        }
      }
    }
  }
  return { x: 0, y: bottom, w: def.w, h: def.h };
}
