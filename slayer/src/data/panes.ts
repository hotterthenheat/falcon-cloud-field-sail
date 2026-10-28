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
import { useTicker } from '../context/MarketDataContext';
import { useNameLevels } from './levelsScope';

/** Four names at most — the Map's rule, and a quarter of the screen is the least a pane can read in */
export const MAX_PANES = 4;

/** A pane: its own name, or none — the first pane follows the frame — and its expiry.
    strikes / order / show are this pane's list, not the row's. Absent: the page default. */
export interface Pane {
  key: string;
  ticker?: string;
  expiry: ExposureExpiry;
  strikes?: number;
  order?: string;
  show?: string;
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
        .filter((p): p is { key?: unknown; ticker?: unknown; expiry?: unknown; strikes?: unknown; order?: unknown; show?: unknown } => !!p && typeof p === 'object')
        .map((p, i) => ({
          key: typeof p.key === 'string' ? p.key : `p${i}`,
          ticker: typeof p.ticker === 'string' && p.ticker ? p.ticker.toUpperCase() : undefined,
          expiry: EXPIRIES.has(p.expiry as ExposureExpiry) ? (p.expiry as ExposureExpiry) : '0DTE',
          ...(typeof p.strikes === 'number' ? { strikes: p.strikes } : null),
          ...(typeof p.order === 'string' ? { order: p.order } : null),
          ...(typeof p.show === 'string' ? { show: p.show } : null),
        }))
        .slice(0, MAX_PANES);
      if (panes.length) return panes;
    }
  } catch {
    /* nothing kept, or storage off */
  }
  return [{ key: 'p0', expiry: '0DTE' }];
}

/**
 * A pane that is still on its name's levels moves when that name's levels change.
 * A pane the reader put on another expiry keeps it (`offScope`).
 */
export function usePanesFollowScope(panes: Pane[], setPanes: (next: Pane[]) => void): ExposureExpiry {
  const { activeTicker } = useTicker();
  const scope = useNameLevels(activeTicker);
  const was = useRef<{ ticker: string; scope: ExposureExpiry }>({ ticker: activeTicker, scope });
  useEffect(() => {
    const prev = was.current;
    was.current = { ticker: activeTicker, scope };
    if (prev.ticker !== activeTicker || prev.scope === scope) return;
    const follows = (p: Pane) => (p.ticker ?? activeTicker) === activeTicker && p.expiry === prev.scope;
    if (panes.some(follows)) setPanes(panes.map(p => (follows(p) ? { ...p, expiry: scope } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeTicker]);
  return scope;
}

/** A pane that reads another expiry than this name's levels */
export const OFF_SCOPE_TITLE = "This pane reads a different expiry from this name's levels, so its walls, flip and supreme can differ from the Board and the Map";

export function writePanes(storageKey: string, panes: Pane[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(panes));
  } catch {
    /* storage off — the panes live for the session */
  }
}

/** A key no pane on this machine has had */
export const newPaneKey = (): string => `p${Date.now().toString(36)}`;
