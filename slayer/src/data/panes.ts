/*
==================================================
  SLAYER TERMINAL - PANES, ONE A NAME (data/panes.ts)

  One to four names side by side, each on its own
  expiry — Building's grammar (Noah, 2026-10-14: "the
  ability to choose different tickers and different
  exps from 1 to 4 tickers"), and Targets' since
  2026-10-15 ("can we add exp and different tickers to
  the targets page as well?"). A pane holds its own
  name, or none — the first pane follows the frame —
  and its expiry. The panes are kept on this machine
  under the page's own key, four at most: a quarter
  of the screen is the least a pane can read in.
==================================================
*/

import type { ExposureExpiry } from '../types/gex';

/** Four names at most — the Map's rule, and a quarter of the screen is the least a pane can read in */
export const MAX_PANES = 4;

/** A pane: its own name, or none — the first pane follows the frame — and its expiry */
export interface Pane {
  key: string;
  ticker?: string;
  expiry: ExposureExpiry;
}

const EXPIRIES = new Set<ExposureExpiry>(['0DTE', '1D', '2D', '5D', '7D', 'OPEX', 'ALL']);

/** The panes side by side at desk width; stacked under it — literal classes, so Tailwind keeps them */
export const PANE_COLS: Record<number, string> = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

/** The panes kept under a page's key — one on the frame's name, on the front expiry, when nothing is kept */
export function readPanes(storageKey: string): Pane[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null') as unknown;
    if (Array.isArray(raw)) {
      const panes = raw
        .filter((p): p is { key?: unknown; ticker?: unknown; expiry?: unknown } => !!p && typeof p === 'object')
        .map((p, i) => ({ key: typeof p.key === 'string' ? p.key : `p${i}`, ticker: typeof p.ticker === 'string' && p.ticker ? p.ticker.toUpperCase() : undefined, expiry: EXPIRIES.has(p.expiry as ExposureExpiry) ? (p.expiry as ExposureExpiry) : '0DTE' }))
        .slice(0, MAX_PANES);
      if (panes.length) return panes;
    }
  } catch {
    /* nothing kept, or storage off */
  }
  return [{ key: 'p0', expiry: '0DTE' }];
}

export function writePanes(storageKey: string, panes: Pane[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(panes));
  } catch {
    /* storage off — the panes live for the session */
  }
}

/** A key no pane on this machine has had */
export const newPaneKey = (): string => `p${Date.now().toString(36)}`;
