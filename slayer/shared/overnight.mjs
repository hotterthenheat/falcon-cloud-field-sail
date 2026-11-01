/*
  THE OVERNIGHT SPX LINE, the reading only (the reader is server/terrainApi.mjs; the parity math is the browser's,
  src/data/overnightLine.ts on core/parity.ts; Terrain's chart draws it). Plain JavaScript so Node runs it without a
  build step.

  SPX and SPXW options trade Cboe's Global Trading Hours (20:15 the evening before → 09:25) while the cash index does not
  print. The night is the session module's own window (shared/marketSession.mjs windowAt, 'indexOption', kind 'gth'):
  the one open now, else the latest that has closed. Its options are the NEAREST SPXW expiry — the session day the
  night leads into. Each 5-minute stamp keeps only the strikes around the money (where the call and put mids are
  closest), the pairs a parity forward is read from.
*/

import { isSessionDay, nextSessionDay, nyInstant, nyWall, windowAt } from './marketSession.mjs';
import { parseCsv } from './optionChain.mjs';

/** The strikes kept a stamp, around the money: the forward is the median of the 3–4 nearest with valid quotes */
export const PAIRS_KEPT = 6;

/** The GTH night at `ms`: the one open now ({ live: true }), else the latest that has closed (within five days) */
export function nightAt(ms) {
  const open = windowAt(ms, 'indexOption');
  if (open && open.kind === 'gth') return { from: open.from, to: open.to, live: true };
  for (let h = 1; h <= 120; h++) {
    const w = windowAt(ms - h * 3_600_000, 'indexOption');
    if (w && w.kind === 'gth') return { from: w.from, to: w.to, live: false };
  }
  return null;
}

/** The nearest SPXW expiry of a night: the session day it leads into */
export function nightExpiry(night) {
  const day = nyWall(night.to).iso;
  return isSessionDay(day) ? day : nextSessionDay(day);
}

/** The night's two calendar dates: the evening it opens and the morning it closes, each with its New York clock span */
export function nightParts(night) {
  const a = nyWall(night.from);
  const b = nyWall(night.to);
  const hhmmss = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
  return [
    { date: a.iso, start: hhmmss(a.min), end: '23:59:59' },
    { date: b.iso, start: '00:00:00', end: hhmmss(b.min) },
  ];
}

/** "2026-10-30T02:05:00.000" → the instant (New York wall time) */
export function wallMs(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(stamp ?? ''));
  return m ? nyInstant(m[1], Number(m[2]) * 60 + Number(m[3])) + Number(m[4]) * 1000 : NaN;
}

const px = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Option quotes (history at an interval, or a snapshot) by stamp: Map ms → Map strike → [callBid, callAsk, putBid, putAsk].
 * `bucketMs` rounds a snapshot's stamps (each contract's own) onto one stamp.
 */
export function readQuoteStamps(text, bucketMs = 0) {
  const out = new Map();
  for (const r of parseCsv(text)) {
    let ms = wallMs(r.timestamp);
    const k = Number(r.strike);
    const right = String(r.right ?? '').toUpperCase()[0];
    if (!Number.isFinite(ms) || !(k > 0) || (right !== 'C' && right !== 'P')) continue;
    if (bucketMs > 0) ms = Math.floor(ms / bucketMs) * bucketMs;
    let at = out.get(ms);
    if (!at) out.set(ms, (at = new Map()));
    let q = at.get(k);
    if (!q) at.set(k, (q = [null, null, null, null]));
    const c = right === 'C' ? 0 : 2;
    q[c] = px(r.bid);
    q[c + 1] = px(r.ask);
  }
  return out;
}

/** One stamp's pairs around the money: the PAIRS_KEPT strikes nearest the one whose call and put mids are closest, as
    [strike, callBid, callAsk, putBid, putAsk], by strike; empty when no strike has all four quotes */
export function pairsAround(byStrike, kept = PAIRS_KEPT) {
  const full = [];
  for (const [k, q] of byStrike) {
    if (q.some((v) => v == null) || q[1] < q[0] || q[3] < q[2]) continue;
    full.push([k, q[0], q[1], q[2], q[3]]);
  }
  if (!full.length) return [];
  let atm = full[0];
  let best = Infinity;
  for (const p of full) {
    const gap = Math.abs((p[1] + p[2]) / 2 - (p[3] + p[4]) / 2);
    if (gap < best) {
      best = gap;
      atm = p;
    }
  }
  return full
    .sort((a, b) => Math.abs(a[0] - atm[0]) - Math.abs(b[0] - atm[0]) || a[0] - b[0])
    .slice(0, kept)
    .sort((a, b) => a[0] - b[0]);
}
