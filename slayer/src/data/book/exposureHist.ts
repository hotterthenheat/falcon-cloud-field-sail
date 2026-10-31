/* A past day's intraday exposure, reconstructed where nothing recorded it. Terrain's field reads the vendor's per-strike
   gamma as the day goes (the recorder, data/exposureRecorder.ts, and this browser's own reads); a past day nobody
   recorded used to be that day's closing book, flat through its cash session. This rebuilds it bar by bar from what
   the terminal keeps for any past day:

     dealer gamma at a strike, bar t = Σ over expiries and both rights of side × OI × Γ(S_t, K, T_t, σ_K,t) × 100 × S_t² × 0.01

   - OI is the day's opening open interest (the terminal's open-interest history, reported before the open). It does not
     change inside the day: no trade is guessed into it.
   - S_t is the close of each cleaned one-minute bar (data/barSanity.ts saneBars), every minute a price exists —
     pre-market, the cash session and after hours — so the field spans the whole chart, not 09:30–16:00.
   - σ_K,t is the strike's implied vol from the mid, read on a coarse grid (every 30 minutes of the cash session, per
     expiry, the strikes in the window): the out-of-the-money side's, else the other's; a strike off the grid takes its
     nearest neighbour's on the same expiry. Linear in time between grid points; before the first point it holds the
     session before's last value (or the day's first), after the last it holds the last.
   - T_t is calendar time to 16:00 on the expiry (the clock the terminal's vols are quoted on), five minutes at the
     least; a leg is gone at its close.
   - side is the one dealer model (core/dealerSign.ts): +1 a call, −1 a put; Γ·100·S²·0.01 is core/gammaFlip.ts
     dollarGammaPerContract. So a cell is the vendor's own figure (call_gamma_oi + put_gamma_oi), dollars per 1%, and
     joins the field's log exactly as a recorded reading does.

   Pure: no fetch, no storage. The server reads the inputs and keeps them (data/exposureHistServer.ts);
   scripts/exposure-hist-proof.ts holds it to a hand example and to the vendor's close. */

import { dollarGammaPerContract } from '../../core/gammaFlip';
import { DEALER_SIDE } from '../../core/dealerSign';
import { saneBars } from '../barSanity';
import { ALL, WINDOW, closeOf, type KeptSeries } from './exposureSegs';

export const HIST_FORMAT = 'exposure-hist/1';
/** The implied-vol grid's step, minutes, and the strikes either side of the money it reads */
export const IV_STEP_MIN = 30;
export const IV_STRIKES = 50;
/** A vol outside this is a bad quote, not a vol */
const IV_MIN = 0.01;
const IV_MAX = 5;
/** A calendar year, ms, and the least time a leg is priced at (five minutes, the app's own floor) */
const YEAR_MS = 365 * 86_400_000;
const MIN_YEARS = 5 / (365 * 24 * 60);

type Right = 'C' | 'P';

/** What one name's day is rebuilt from: kept on disk as it is, so a day is read from the terminal once */
export interface HistInputs {
  format: typeof HIST_FORMAT;
  ticker: string;
  /** YYYY-MM-DD */
  day: string;
  /** [expiry YYYY-MM-DD, strike, right, open interest] — the day's opening open interest, every expiry */
  oi: [string, number, Right, number][];
  /** [expiry, strike, right, grid times (ms), mid vols, the underlying at each] */
  iv: [string, number, Right, number[], number[], number[]][];
  /** cleaned one-minute bars: [bar start ms, close] */
  bars: [number, number][];
}

/** The session before's last vol per expiry and strike ("expiry|strike"), carried into this day's pre-market */
export type CarriedVol = Record<string, number>;

/* ---- reading the terminal's answers ---------------------------------------------------------------------------- */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : NaN;
};
const rightOf = (v: unknown): Right | null => {
  const s = String(v ?? '').toUpperCase();
  return s.startsWith('C') ? 'C' : s.startsWith('P') ? 'P' : null;
};
/** "2026-10-30T09:30:00.000" New York wall time, as ms */
export function nyStampMs(stamp: string, nyWallTime: (y: number, m: number, d: number, h: number, mi: number) => number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(stamp);
  if (!m) return NaN;
  return nyWallTime(+m[1], +m[2], +m[3], +m[4], +m[5]) + (m[6] ? +m[6] * 1000 : 0);
}
const rowsOf = (json: unknown): Record<string, unknown>[] => {
  const r = (json as { response?: unknown })?.response;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
};

/** /option/history/open_interest?expiration=*: one figure per contract, the day's opening open interest */
export function readOi(json: unknown): HistInputs['oi'] {
  const out: HistInputs['oi'] = [];
  for (const row of rowsOf(json)) {
    const c = row.contract as Record<string, unknown> | undefined;
    const d = (row.data as Record<string, unknown>[] | undefined)?.[0];
    const right = rightOf(c?.right);
    const strike = num(c?.strike);
    const oi = num(d?.open_interest);
    const expiry = String(c?.expiration ?? '').slice(0, 10);
    if (!right || !(strike > 0) || !(oi > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    out.push([expiry, strike, right, oi]);
  }
  return out;
}

/** /option/history/greeks/implied_volatility?interval=30m: each contract's mid vol through the cash session */
export function readIv(json: unknown, toMs: (stamp: string) => number): HistInputs['iv'] {
  const out: HistInputs['iv'] = [];
  for (const row of rowsOf(json)) {
    const c = row.contract as Record<string, unknown> | undefined;
    const right = rightOf(c?.right);
    const strike = num(c?.strike);
    const expiry = String(c?.expiration ?? '').slice(0, 10);
    if (!right || !(strike > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    const ts: number[] = [];
    const vs: number[] = [];
    const ss: number[] = [];
    for (const d of (row.data as Record<string, unknown>[] | undefined) ?? []) {
      const iv = num(d.implied_vol);
      const t = toMs(String(d.timestamp ?? ''));
      if (!(iv > IV_MIN && iv < IV_MAX) || !Number.isFinite(t)) continue;
      ts.push(t);
      vs.push(Math.round(iv * 1e5) / 1e5);
      ss.push(num(d.underlying_price));
    }
    if (ts.length) out.push([expiry, strike, right, ts, vs, ss]);
  }
  return out;
}

/** /stock/history/ohlc?interval=1m, 04:00–20:00: the minutes that traded, through the shared bad-print rule */
export function readBars(json: unknown, toMs: (stamp: string) => number): HistInputs['bars'] {
  const raw: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (const b of rowsOf(json)) {
    const t = toMs(String(b.timestamp ?? ''));
    const o = num(b.open);
    const h = num(b.high);
    const l = num(b.low);
    const c = num(b.close);
    if (!Number.isFinite(t) || !(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    raw.push({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c, volume: num(b.volume) || 0 });
  }
  raw.sort((a, b) => a.time - b.time);
  return saneBars(raw).map(b => [b.time * 1000, b.close]);
}

/* ---- the vol surface through the day ---------------------------------------------------------------------------- */

interface VolPath {
  ts: number[];
  vs: number[];
}

/** Each expiry's strikes with a vol path: the out-of-the-money side at each grid time, else the other side */
function volPaths(iv: HistInputs['iv']): Map<string, { strikes: number[]; paths: VolPath[] }> {
  const by = new Map<string, Map<number, { C?: HistInputs['iv'][number]; P?: HistInputs['iv'][number] }>>();
  for (const row of iv) {
    let ex = by.get(row[0]);
    if (!ex) by.set(row[0], (ex = new Map()));
    let k = ex.get(row[1]);
    if (!k) ex.set(row[1], (k = {}));
    k[row[2]] = row;
  }
  const out = new Map<string, { strikes: number[]; paths: VolPath[] }>();
  for (const [expiry, ex] of by) {
    const strikes = [...ex.keys()].sort((a, b) => a - b);
    const paths: VolPath[] = [];
    const keep: number[] = [];
    for (const k of strikes) {
      const { C, P } = ex.get(k)!;
      const times = [...new Set([...(C?.[3] ?? []), ...(P?.[3] ?? [])])].sort((a, b) => a - b);
      const ts: number[] = [];
      const vs: number[] = [];
      for (const t of times) {
        const ci = C ? C[3].indexOf(t) : -1;
        const pi = P ? P[3].indexOf(t) : -1;
        const cv = ci >= 0 ? C![4][ci] : NaN;
        const pv = pi >= 0 ? P![4][pi] : NaN;
        const s = ci >= 0 ? C![5][ci] : pi >= 0 ? P![5][pi] : NaN;
        const otmCall = !(s > 0) || k >= s;
        const v = otmCall ? (cv === cv ? cv : pv) : pv === pv ? pv : cv;
        if (v === v) {
          ts.push(t);
          vs.push(v);
        }
      }
      if (ts.length) {
        keep.push(k);
        paths.push({ ts, vs });
      }
    }
    if (keep.length) out.set(expiry, { strikes: keep, paths });
  }
  return out;
}

/** A path's vol at t: linear between grid points, the carried value (or the first) before them, the last after */
function volAt(p: VolPath, t: number, before: number | undefined): number {
  const { ts, vs } = p;
  if (t <= ts[0]) return before != null && before > 0 && t < ts[0] ? before : vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ts[m] <= t) lo = m;
    else hi = m;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo]);
  return vs[lo] + (vs[hi] - vs[lo]) * f;
}

/** The nearest strike with a vol path on the expiry (flat past the last) */
function nearestIndex(strikes: number[], k: number): number {
  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (strikes[m] < k) lo = m + 1;
    else hi = m;
  }
  if (lo === 0) return 0;
  if (lo >= strikes.length) return strikes.length - 1;
  return k - strikes[lo - 1] <= strikes[lo] - k ? lo - 1 : lo;
}

/** Each expiry and strike's last vol of the day, for the next day's pre-market */
export function lastVols(inp: HistInputs): CarriedVol {
  const out: CarriedVol = {};
  for (const [expiry, { strikes, paths }] of volPaths(inp.iv)) {
    strikes.forEach((k, i) => (out[`${expiry}|${k}`] = paths[i].vs[paths[i].vs.length - 1]));
  }
  return out;
}

/* ---- the rebuild -------------------------------------------------------------------------------------------- */

export interface Rebuilt {
  /** the series, as the field's log keeps them: [expiry or ALL, strike, flat segments from,to,oi,flow] */
  series: KeptSeries[];
  /** strikes in the window, bars rebuilt, legs priced per bar */
  strikes: number;
  bars: number;
  legs: number;
}

/**
 * The day's series for one cut: 'book' sums every expiry into the whole-book pseudo-expiry (ALL), a date keeps that
 * expiry alone. One segment a bar: [bar start, bar start + 59 999 ms, value, value] — the reconstruction has no
 * trades, so the flow model reads the open-interest figure. Values are whole dollars per 1%, the vendor's sign.
 */
export function rebuildDay(inp: HistInputs, cut: 'book' | string, carried: CarriedVol = {}): Rebuilt {
  const bars = inp.bars;
  if (!bars.length || !inp.oi.length) return { series: [], strikes: 0, bars: 0, legs: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, c] of bars) {
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  const kLo = lo * (1 - WINDOW);
  const kHi = hi * (1 + WINDOW);
  /* the legs in the window, grouped by strike: expiry, side × open interest */
  const legsBy = new Map<number, { expiry: string; close: number; side: number; oi: number }[]>();
  for (const [expiry, strike, right, oi] of inp.oi) {
    if (strike < kLo || strike > kHi) continue;
    if (cut !== 'book' && expiry !== cut) continue;
    let l = legsBy.get(strike);
    if (!l) legsBy.set(strike, (l = []));
    l.push({ expiry, close: closeOf(expiry), side: DEALER_SIDE[right], oi });
  }
  const paths = volPaths(inp.iv);
  const strikes = [...legsBy.keys()].sort((a, b) => a - b);
  const series: KeptSeries[] = [];
  let legCount = 0;
  /* each expiry's years to its close, per bar: calendar time, the clock the terminal's vols are quoted on (a vol on one
     clock and time on the other misprices a weekend by √(3/1)) */
  const yearsBy = new Map<string, Float64Array>();
  const yearsOf = (expiry: string): Float64Array => {
    let y = yearsBy.get(expiry);
    if (!y) {
      y = new Float64Array(bars.length);
      const close = closeOf(expiry);
      for (let i = 0; i < bars.length; i++) y[i] = Math.max(MIN_YEARS, (close - (bars[i][0] + 59_999)) / YEAR_MS);
      yearsBy.set(expiry, y);
    }
    return y;
  };
  for (const k of strikes) {
    const legs = legsBy.get(k)!;
    /* each leg's vol path: its own strike's, else the nearest strike's on its expiry; no path at all leaves it out */
    const priced = legs
      .map(l => {
        const ex = paths.get(l.expiry);
        if (!ex) return null;
        const i = nearestIndex(ex.strikes, k);
        return { ...l, path: ex.paths[i], before: carried[`${l.expiry}|${ex.strikes[i]}`], years: yearsOf(l.expiry) };
      })
      .filter((l): l is NonNullable<typeof l> => !!l);
    if (!priced.length) continue;
    const segs: number[] = [];
    for (let i = 0; i < bars.length; i++) {
      const [t, S] = bars[i];
      let v = 0;
      let any = false;
      for (const l of priced) {
        /* a leg is gone from its expiry's close */
        if (t >= l.close) continue;
        const sigma = volAt(l.path, t, l.before);
        v += l.side * l.oi * dollarGammaPerContract(S, k, l.years[i], sigma);
        any = true;
        legCount++;
      }
      if (!any) continue;
      const r = Math.round(v);
      segs.push(t, t + 59_999, r, r);
    }
    if (segs.length) series.push([cut === 'book' ? ALL : cut, k, segs]);
  }
  return { series, strikes: series.length, bars: bars.length, legs: legCount };
}
