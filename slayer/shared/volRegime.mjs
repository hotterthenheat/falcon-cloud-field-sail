/*
  THE VOL REGIME AND THE OPEN-INTEREST CHANGE, the arithmetic only (the reader is server/regimeApi.mjs; Terrain's rail
  draws the answers: src/components/gex/VolRegimeView.tsx, OiChangeView.tsx). Plain JavaScript so Node runs it without a
  build step, and the proofs (scripts/vol-regime-proof.mjs, scripts/oi-change-proof.mjs) test it with known numbers.

  The terminal's quirks it absorbs:
  - Index bars carry no volume, and the first bar of a session (09:30) is all zeros: a bar with no positive close is
    not a print, so it is dropped. The same rule drops the zero rows before the VIX's first overnight print (~03:15).
  - Stamps are New York wall time ("2026-10-30T16:15:01.000").
  - Open interest is stamped about 06:30 New York for the PREVIOUS session's close, once a session day.
*/

import { addDays, isSessionDay, nyWall, sessionDayAtOrBefore } from './marketSession.mjs';

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

/* ---- open interest ---------------------------------------------------------------------------------------------- */

/** The index whose weeklies carry its chain on the terminal (SPX's dailies are SPXW) */
export const OI_ROOT = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };
export const oiRootOf = (ticker) => {
  const t = String(ticker ?? '').toUpperCase();
  return OI_ROOT[t] ?? t;
};
/** When the morning's open interest is on file, minutes of New York's day: OPRA stamps it about 06:30; five minutes' grace */
export const OI_READY_MIN = 6 * 60 + 35;

/** The report a reader can expect at `ms`: today's once it is stamped on a session day, else the last session's */
export function oiReportDay(ms) {
  const w = nyWall(ms);
  if (isSessionDay(w.iso) && w.min >= OI_READY_MIN) return w.iso;
  return sessionDayAtOrBefore(addDays(w.iso, -1));
}
/** The report before `day`'s, and the close a report counts (the session before the morning it is stamped) */
export const priorSession = (day) => sessionDayAtOrBefore(addDays(day, -1));

/** /option/history/open_interest?expiration=*: { 'YYYY-MM-DD': [[strike, callOi, putOi], …] }, strikes ascending */
export function readOiReport(json) {
  const by = new Map();
  for (const row of rowsOf(json)) {
    const c = row?.contract;
    const d = Array.isArray(row?.data) ? row.data[row.data.length - 1] : null;
    const right = String(c?.right ?? '').toUpperCase()[0];
    const strike = num(c?.strike);
    const oi = num(d?.open_interest);
    const exp = String(c?.expiration ?? '').slice(0, 10);
    if ((right !== 'C' && right !== 'P') || !(strike > 0) || !(oi >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
    let m = by.get(exp);
    if (!m) by.set(exp, (m = new Map()));
    const cell = m.get(strike) ?? [0, 0];
    cell[right === 'C' ? 0 : 1] += oi;
    m.set(strike, cell);
  }
  const out = {};
  for (const exp of [...by.keys()].sort()) out[exp] = [...by.get(exp).entries()].sort((a, b) => a[0] - b[0]).map(([k, [c, p]]) => [k, c, p]);
  return out;
}

/** How many of the largest builds and unwinds are named */
export const OI_TOP = 5;

/**
 * The day-over-day change per strike for one scope.
 * @param {Record<string, [number, number, number][]>} now    the later report (readOiReport)
 * @param {Record<string, [number, number, number][]>} prior  the earlier report
 * @param {{ expiry: 'book' | string, from: string }} scope    one expiry, or every expiry still live on `from` (the later
 *   report's date: an expiry before it settled at or before the close the later report counts, so it has no later figure)
 */
export function oiChange(now, prior, scope) {
  const exps = scope.expiry === 'book' ? Object.keys(now).filter(e => e >= scope.from).sort() : now[scope.expiry] ? [scope.expiry] : [];
  const by = new Map();
  const add = (rep, i) => {
    for (const e of exps) {
      for (const [k, c, p] of rep[e] ?? []) {
        const cell = by.get(k) ?? [0, 0, 0, 0];
        cell[i] += c;
        cell[i + 2] += p;
        by.set(k, cell);
      }
    }
  };
  add(now, 0);
  add(prior, 1);
  /* [strike, call now, call prior, put now, put prior] */
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, [c, c0, p, p0]]) => [k, c, c0, p, p0]);
  const totals = { call: 0, callPrior: 0, put: 0, putPrior: 0 };
  const moves = [];
  for (const [k, c, c0, p, p0] of rows) {
    totals.call += c;
    totals.callPrior += c0;
    totals.put += p;
    totals.putPrior += p0;
    if (c !== c0) moves.push({ strike: k, right: 'C', d: c - c0, now: c, prior: c0 });
    if (p !== p0) moves.push({ strike: k, right: 'P', d: p - p0, now: p, prior: p0 });
  }
  const order = (a, b) => Math.abs(b.d) - Math.abs(a.d) || a.strike - b.strike || (a.right < b.right ? -1 : 1);
  const builds = moves.filter(m => m.d > 0).sort(order).slice(0, OI_TOP);
  const unwinds = moves.filter(m => m.d < 0).sort(order).slice(0, OI_TOP);
  return { expiries: exps, rows, totals, builds, unwinds };
}
