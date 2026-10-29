/* The payoff sketch on a position card: P/L across price for one contract at expiry (intrinsic − cost) and today (Black-Scholes on the chain's smile).
   Cost is the typed entry, else the mark when added, else today's value at spot; dollars × 100 × contracts, signed by side. The range is the Map's window. */

import type { Position } from './positions';

/** Where a position's cost comes from: typed by the reader, or the mark when it was added */
type CostKind = 'entry' | 'added';

/** The cost a return is measured from: the typed entry, else the mark when added; null only for positions stored before the mark was pinned. */
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
