/* How one answer of the vendor's per-strike exposure rows becomes readings, and how a reading joins a strike's series.
   One rule for the browser's own log (data/book/exposureLog.ts) and the server's recorder (data/exposureRecorder.ts), so
   a series the server recorded and one this browser read are the same numbers and merge without seams.

   Pure: no React, no fetch, no storage. */

import { nyIsoDate, nyWallTime } from '../../core/nyTime';

/** Readings further apart than this are not joined into one segment. The chart still carries the last level across the bars of the same session. */
export const JOIN_MS = 180_000;
/** Strikes kept with their history: within this share of the row's price (every strike keeps its latest values) */
export const WINDOW = 0.05;
/** A day's readings start at 04:00 New York, the start of the day's tape */
export const DAY_START_HOUR = 4;
/** The pseudo-expiry of the vendor's whole-book rows (spot-exposures/strike): the 'every expiry' cut reads them */
export const ALL = 'ALL';

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** 16:00 New York on the expiry, ms — the contracts are gone after it (the whole book never closes) */
export const closeOf = (expiry: string): number => {
  if (expiry === ALL) return Infinity;
  const [y, m, d] = expiry.split('-').map(Number);
  return nyWallTime(y, m, d, 16, 0);
};

/** 04:00 New York on the day of an instant */
export const dayStartOf = (ms: number): number => {
  const [y, m, d] = nyIsoDate(ms).split('-').map(Number);
  return nyWallTime(y, m, d, DAY_START_HOUR, 0);
};

/** One row's two levels, dealer sign, dollars per 1%. Gamma is already dollars. Do not scale it again.
    Each field is the vendor's own figure. keptVendorLeg (dealerSigned) is applied once, later, when the column is
    kept for the painter — summing here and flipping once is the same add, and flipping here too would flip twice.
    Flow is the open-interest gamma plus the ask and the bid. Open interest is the open-interest gamma alone. */
export function rowMeasures(r: Record<string, unknown>): { oi: number; flow: number } {
  const callOi = num(r.call_gamma_oi);
  const putOi = num(r.put_gamma_oi);
  return {
    oi: callOi + putOi,
    flow: callOi + num(r.call_gamma_ask) + num(r.call_gamma_bid) + putOi + num(r.put_gamma_ask) + num(r.put_gamma_bid),
  };
}

/** One row of an answer, as the log reads it */
export interface RowReading {
  /** YYYY-MM-DD, or ALL for a whole-book row */
  expiry: string;
  strike: number;
  /** the vendor's last recalculation of the row, ms */
  rowAt: number;
  oi: number;
  flow: number;
  /** within WINDOW of the row's own price (or no price): the row joins its series */
  near: boolean;
}

/** An answer's rows read: the moment it answers for (its newest row `time`) and every usable row. Null when no row
    carries a time. */
export function readAnswer(rows: unknown, allRows = false): { answeredAt: number; rows: RowReading[] } | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  let answeredAt = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const at = Date.parse(String(r?.time ?? ''));
    if (Number.isFinite(at) && at > answeredAt) answeredAt = at;
  }
  if (!(answeredAt > 0)) return null;
  const out: RowReading[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const expiry = allRows ? ALL : String(r.expiry ?? '').slice(0, 10);
    const strike = num(r.strike);
    if ((!allRows && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) || !(strike > 0)) continue;
    const rowAt = Date.parse(String(r.time ?? ''));
    if (!Number.isFinite(rowAt)) continue;
    const { oi, flow } = rowMeasures(r);
    const px = num(r.price);
    out.push({ expiry, strike, rowAt, oi, flow, near: !(px > 0 && Math.abs(strike - px) > px * WINDOW) });
  }
  return { answeredAt, rows: out };
}

/** Put one reading into a series' flat segments (from, to, oi, flow — in time order, never overlapping): the same
    recalculation read again extends it; one that overlaps a different reading adds nothing. True when it changed. */
export function placeSeg(segs: number[], from: number, to: number, oi: number, flow: number): boolean {
  let lo = 0;
  let hi = segs.length / 4;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (segs[m * 4] <= from) lo = m + 1;
    else hi = m;
  }
  const at = lo * 4; // insertion point; the reading before it starts at or before `from`
  if (at > 0 && segs[at - 4] === from) {
    if (segs[at - 2] !== oi || segs[at - 1] !== flow) return false;
    if (to <= segs[at - 3]) return false;
    if (at < segs.length && to >= segs[at]) return false;
    segs[at - 3] = to;
    return true;
  }
  if (at > 0 && from <= segs[at - 3]) return false;
  if (at < segs.length && to >= segs[at]) return false;
  segs.splice(at, 0, from, to, oi, flow);
  return true;
}

/** The span one row of an answer claims: from its recalculation (never before the day's start) to the answer. Null when
    the answer is older than the row's start. */
export function spanOf(rowAt: number, answeredAt: number): { from: number; to: number } | null {
  const from = Math.max(rowAt, dayStartOf(answeredAt));
  return answeredAt < from ? null : { from, to: answeredAt };
}

/** One series as the log keeps it and the server serves it: [expiry or ALL, strike, flat segments] */
export type KeptSeries = [string, number, number[]];
