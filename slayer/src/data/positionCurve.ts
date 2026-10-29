/*
==================================================
  SLAYER TERMINAL - THE POSITION CURVE
  (data/positionCurve.ts)

  The payoff sketch on a position card (the
  TradingView strategy-builder grammar Noah picked,
  2026-09-05): profit or loss across price for one
  contract, two lines —

    AT EXPIRY  the hard line: intrinsic value minus
               what it cost
    TODAY      the soft line: Black-Scholes value
               at each price with the sessions left,
               on the same smile the chain prices
               with, minus what it cost

  WHAT IT COST is the entry premium if the reader
  typed one; else the contract's mark the moment it
  was added (2026-09-16 — a day of decay must show
  on a position added yesterday); else, for a
  position stored before the mark was pinned,
  today's theoretical value at spot, so the sketch
  reads "if you bought it now". The card says
  which. Dollars are per contract × 100 ×
  contracts, signed by side (sold = the mirror
  image).

  The price range is the Map's window, so the walls
  and the flip the card draws on it land where the
  rail has them.
==================================================
*/

import type { Position } from './positions';

/** Where a position's cost comes from: typed by the reader, or the mark when it was added */
type CostKind = 'entry' | 'added';

/** THE COST THE RETURN IS MEASURED FROM (2026-09-16): what the reader typed, else the contract's
    mark the moment it was added — null only for a position stored before the mark was pinned.
    Every reader of a position's profit goes through here (the curve, the list's rows). */
export function costOf(p: Pick<Position, 'entry' | 'addedMark'>): { value: number; kind: CostKind } | null {
  if (p.entry != null) return { value: p.entry, kind: 'entry' };
  if (p.addedMark != null) return { value: p.addedMark, kind: 'added' };
  return null;
}

/** "+$1.2K" · "−$340" · "$0" */
export function fmtPnl(v: number): string {
  if (Math.abs(v) < 0.5) return '$0';
  const a = Math.abs(v);
  const body = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
  return `${v < 0 ? '−' : '+'}${body}`;
}
