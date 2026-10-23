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

import { useEffect, useRef } from 'react';
import type { ExposureExpiry } from '../types/gex';
import { readLevelsScope, useLevelsScope } from './levelsScope';

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
  return [{ key: 'p0', expiry: readLevelsScope() }];
}

/**
 * PANES FOLLOW THE LEVELS CARD (the ship pass, 2026-10-22): a pane on the card's contracts moves with the card, so the
 * Agenda's walls and supreme stay the Board's and the Map's for the same name. A pane the reader put on another expiry
 * keeps it (and wears the "own expiry" mark — `offScope`).
 */
export function usePanesFollowScope(panes: Pane[], setPanes: (next: Pane[]) => void): ExposureExpiry {
  const scope = useLevelsScope();
  const was = useRef(scope);
  useEffect(() => {
    const prev = was.current;
    was.current = scope;
    if (prev === scope) return;
    if (panes.some(p => p.expiry === prev)) setPanes(panes.map(p => (p.expiry === prev ? { ...p, expiry: scope } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  return scope;
}

/** The words for a pane that reads another expiry than the Levels card */
export const OFF_SCOPE_TITLE = 'This pane reads a different expiry from the Levels card at the top of the page, so its walls, flip and supreme can differ from the Board and the Map';

export function writePanes(storageKey: string, panes: Pane[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(panes));
  } catch {
    /* storage off — the panes live for the session */
  }
}

/** A key no pane on this machine has had */
export const newPaneKey = (): string => `p${Date.now().toString(36)}`;
