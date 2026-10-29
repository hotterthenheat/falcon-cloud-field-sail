/*
  One pane's exposure, with a status on every number.
  A missing wall is unavailable. It is never the spot.
*/

import { DEALER_CALL, DEALER_PUT } from './spxFacts';

type FigureStatus = 'OBSERVED' | 'CALCULATED' | 'MODELED' | 'STALE' | 'UNAVAILABLE';

export const STALE_MS = 90_000;

interface ScopedFigure {
  value: number | null;
  status: FigureStatus;
  note: string;
}

/** A price that was not found. Never the spot standing in for it. */
export function unavailablePrice(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

export function figureOf(value: number | null | undefined, kind: 'observed' | 'calculated', at: number | null, now: number): ScopedFigure {
  if (value == null || !Number.isFinite(value)) {
    return { value: null, status: 'UNAVAILABLE', note: 'Not on this book. Nothing is filled in.' };
  }
  if (at != null && now - at > STALE_MS) {
    return { value, status: 'STALE', note: 'Last book is older than 90 seconds. Not a live print.' };
  }
  if (kind === 'observed') return { value, status: 'OBSERVED', note: 'The feed printed this.' };
  return { value, status: 'CALCULATED', note: 'Computed from the chain on this scope. Not a quote.' };
}

/** Snapshots strictly at or before the replay bar. A later print is look-ahead. */
export function snapsAsOf<T extends { time: number }>(snaps: readonly T[], cutoff: number): T[] {
  return snaps.filter(s => s.time <= cutoff);
}

/** No open interest, no pin. Zero is not a pin. */
export function pinFromOi(rows: readonly { strike: number; callOI?: number; putOI?: number }[]): number | null {
  let best = 0;
  let strike: number | null = null;
  for (const r of rows) {
    const oi = (r.callOI ?? 0) + (r.putOI ?? 0);
    if (oi > best) {
      best = oi;
      strike = r.strike;
    }
  }
  return best > 0 ? strike : null;
}

export const DEALER_MODEL = {
  status: 'MODELED' as const,
  call: DEALER_CALL,
  put: DEALER_PUT,
  note: 'Dealer inventory is not observed. The live book signs both legs short (−1). The −0.55 call and −0.53 put weights are the old participation model and are not applied to this book.',
};
