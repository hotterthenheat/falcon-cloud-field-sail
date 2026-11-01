/*
  THE VOL REGIME, the arithmetic only (the reader is server/regimeApi.mjs; Terrain's rail draws the answer:
  src/components/gex/VolRegimeView.tsx). Plain JavaScript so Node runs it without a build step, and the proof
  (scripts/vol-regime-proof.mjs) tests it with known numbers.

  The terminal's quirks it absorbs:
  - Index bars carry no volume, and the first bar of a session (09:30) is all zeros: a bar with no positive close is
    not a print, so it is dropped. The same rule drops the zero rows before the VIX's first overnight print (~03:15).
  - Stamps are New York wall time ("2026-10-30T16:15:01.000").
*/

import { addDays, isSessionDay, sessionDayAtOrBefore } from './marketSession.mjs';

/** The VIX term structure, front to back, with each tenor's days for the curve's axis */
export const TERM = [
  { sym: 'VIX1D', days: 1, label: '1D' },
  { sym: 'VIX9D', days: 9, label: '9D' },
  { sym: 'VIX', days: 30, label: '30D' },
  { sym: 'VIX3M', days: 91, label: '3M' },
  { sym: 'VIX6M', days: 182, label: '6M' },
];
/** The stress gauges read beside the curve */
export const GAUGES = ['VVIX', 'SKEW'];
/** Every index the panel reads, in the one snapshot request */
export const REGIME_SYMBOLS = [...TERM.map(t => t.sym), ...GAUGES];
/** The two ratios, numerator over denominator: the curve's slope at the 30-day point and at the front */
export const RATIOS = [
  { key: 'VIX/VIX3M', num: 'VIX', den: 'VIX3M' },
  { key: 'VIX9D/VIX', num: 'VIX9D', den: 'VIX' },
];
/** Within this of 1, the curve is called flat */
export const FLAT_BAND = 0.005;

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : NaN;
};
const rowsOf = (json) => {
  const r = json && typeof json === 'object' ? json.response : null;
  return Array.isArray(r) ? r : [];
};
/** "2026-10-30T16:15:01.000" → { day: '2026-10-30', min: 975 }, or null */
export function wallOf(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(stamp ?? ''));
  return m ? { day: m[1], min: Number(m[2]) * 60 + Number(m[3]) } : null;
}

/** /index/snapshot/price for several symbols: { SYM: { price, at } }, only the symbols with a positive price */
export function readSnapshot(json) {
  const out = {};
  for (const r of rowsOf(json)) {
    const sym = String(r?.symbol ?? '').toUpperCase();
    const price = num(r?.price);
    const at = String(r?.timestamp ?? '');
    if (!sym || !(price > 0) || !wallOf(at)) continue;
    out[sym] = { price, at: at.slice(0, 19) };
  }
  return out;
}

/** /index/history/ohlc at 1m: [minute of the New York day, close], ascending, the zero bars dropped */
export function readMinuteCloses(json) {
  const out = [];
  for (const b of rowsOf(json)) {
    const w = wallOf(b?.timestamp);
    const c = num(b?.close);
    if (!w || !(c > 0)) continue;
    out.push([w.min, c]);
  }
  out.sort((a, b) => a[0] - b[0]);
  /* one close a minute: the later row wins */
  const dedup = [];
  for (const p of out) {
    if (dedup.length && dedup[dedup.length - 1][0] === p[0]) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

/** /index/history/eod: [session date, close], ascending; a row is dated by its last trade (else its creation). Only
    session days count: the VIX also closes Cboe's holiday sessions (Thanksgiving, MLK …), which the other tenors do not,
    and a year of closes is the cash market's year for every symbol alike. */
export function readDailyCloses(json) {
  const byDay = new Map();
  for (const r of rowsOf(json)) {
    const w = wallOf(r?.last_trade) ?? wallOf(r?.created);
    const c = num(r?.close);
    if (!w || !(c > 0) || !isSessionDay(w.day)) continue;
    byDay.set(w.day, c);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Where `v` sits among `values`, 0–100: the share below it, ties counted half. Null with nothing to rank against. */
export function percentileOf(values, v) {
  if (!Number.isFinite(v)) return null;
  let below = 0;
  let ties = 0;
  let n = 0;
  for (const x of values) {
    if (!Number.isFinite(x)) continue;
    n += 1;
    if (x < v) below += 1;
    else if (x === v) ties += 1;
  }
  return n ? ((below + ties / 2) / n) * 100 : null;
}

/** a ÷ b per key where both have a value: [key, ratio], in a's order */
export function ratioSeries(a, b) {
  const den = new Map(b);
  const out = [];
  for (const [k, x] of a) {
    const y = den.get(k);
    if (y > 0 && x > 0) out.push([k, x / y]);
  }
  return out;
}

/** The curve's shape from VIX ÷ VIX3M: contango under 1, backwardation over, flat within FLAT_BAND */
export function regimeOf(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (Math.abs(ratio - 1) <= FLAT_BAND) return 'flat';
  return ratio < 1 ? 'contango' : 'backwardation';
}

/** The session whose close the year of daily closes ends on, for a regime day `day`: the session before it */
export const yearEnd = (day) => sessionDayAtOrBefore(addDays(day, -1));
/** The year's first date for a year ending `end` */
export const yearStart = (end) => addDays(end, -365);

/**
 * One value's place in its year: the last close, the percentile, the range.
 * @param {[string, number][]} closes  the year's daily closes, ascending
 * @param {number} value
 */
export function yearRead(closes, value) {
  const vals = closes.map(c => c[1]);
  if (!vals.length) return { prev: null, prevDay: null, pct: null, n: 0, lo: null, hi: null };
  return {
    prev: vals[vals.length - 1],
    prevDay: closes[closes.length - 1][0],
    pct: percentileOf(vals, value),
    n: vals.length,
    lo: Math.min(...vals),
    hi: Math.max(...vals),
  };
}
