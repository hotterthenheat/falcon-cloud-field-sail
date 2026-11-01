/* THE SKEW AND THE SURFACE, from one chain snapshot (data/chainFeed.ts) — pure math, no state.

   Each expiry is priced on its own put-call parity forward (core/parity.ts parityForward on the chain's own quotes) at
   the real rate (data/rateFeed.ts, core/carry.ts): the implied yield q = r − ln(F/S)/T puts the model's forward exactly
   on the market's, so moneyness is ln(K/F) and a strike's vol is the one its out-of-the-money mid implies there
   (core/greeks.ts impliedVolFromPrice) — puts below the forward, calls above it. Delta is the call's forward delta N(d1)
   (core/greeks.ts deltaCall · e^{qT}): a 25-delta put is where N(d1) = 0.75, a 25-delta call where it is 0.25.

   - the 25-delta risk reversal: σ(25Δ call) − σ(25Δ put), negative when puts are bid over calls;
   - the 25-delta butterfly: (σ(25Δ call) + σ(25Δ put)) / 2 − σ(ATM), how much the wings carry over the middle;
   - ATM: the vol at the forward itself (k = 0), interpolated in log-moneyness between the strikes around it.

   The same pipeline runs on the prior session's closing quotes (its own close, its own day's rate), so today and
   yesterday are compared like for like. */

import { parityForward, type ParityPair } from '../core/parity';
import { blackScholesGreeks, impliedVolFromPrice } from '../core/greeks';
import { calendarYears } from '../core/volClock';
import { nyInstant, regularCloseMin } from '../core/session';
import type { ChainExpiry, ChainRow, CloseRow } from '../../shared/optionChain.mjs';

/** A quote fit for a vol: two-sided, not crossed, the spread at most this share of the mid */
const MAX_SPREAD_OF_MID = 0.3;
/** An expiry closer than this (calendar years: 30 minutes) is not read — its vols are all noise */
export const MIN_T = 30 / (365 * 1440);
/** The delta buckets the surface is read at, as call forward delta N(d1): put 10/25/40, the forward, call 40/25/10 */
export const BUCKETS = [
  { key: 'p10', label: '10P', nd1: 0.9 },
  { key: 'p25', label: '25P', nd1: 0.75 },
  { key: 'p40', label: '40P', nd1: 0.6 },
  { key: 'atm', label: 'ATM', nd1: null },
  { key: 'c40', label: '40C', nd1: 0.4 },
  { key: 'c25', label: '25C', nd1: 0.25 },
  { key: 'c10', label: '10C', nd1: 0.1 },
] as const;
export type BucketKey = (typeof BUCKETS)[number]['key'];

export interface SkewPoint {
  strike: number;
  /** ln(K/F) */
  k: number;
  iv: number;
  /** Call forward delta N(d1), 1 deep in the money → 0 */
  nd1: number;
  side: 'P' | 'C';
}
export interface ExpirySkew {
  exp: string;
  /** Calendar years to the expiry's close from the quotes' stamp */
  t: number;
  dte: number;
  F: number;
  q: number;
  /** Strikes the forward was taken from, and how far apart their forwards were */
  parityN: number;
  paritySpread: number;
  points: SkewPoint[];
  atm: number | null;
  /** The vol at each bucket */
  at: Record<BucketKey, number | null>;
  rr25: number | null;
  fly25: number | null;
}

const midOf = (bid: number | null, ask: number | null): number | null => {
  if (bid == null || ask == null || !(bid > 0) || !(ask >= bid)) return null;
  const m = (bid + ask) / 2;
  return (ask - bid) / m <= MAX_SPREAD_OF_MID ? m : null;
};

/** The instant of a New York wall stamp "YYYY-MM-DDTHH:MM:SS" */
export function wallMs(stamp: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return NaN;
  return nyInstant(m[1], Number(m[2]) * 60 + Number(m[3])) + Number(m[4]) * 1000;
}

/** Linear interpolation of y at x along points sorted by x (ascending); null outside them */
function interp(xs: number[], ys: number[], x: number): number | null {
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1];
    const b = xs[i];
    if ((x >= a && x <= b) || (x <= a && x >= b)) {
      if (a === b) return (ys[i - 1] + ys[i]) / 2;
      return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - a)) / (b - a);
    }
  }
  return null;
}

/** One expiry's skew from its strike rows (live or closing: the first five columns are the same), or null when the
    chain cannot give it a forward */
export function expirySkew(exp: string, rows: readonly (ChainRow | CloseRow)[], spot: number, r: number, atMs: number): ExpirySkew | null {
  if (!(spot > 0) || !Number.isFinite(atMs)) return null;
  const t = calendarYears(exp, atMs);
  /* calendarYears floors at five minutes: an expiry whose close has passed is not read */
  const closeMs = nyInstant(exp, regularCloseMin(exp));
  if (closeMs <= atMs || t < MIN_T) return null;
  const pairs: ParityPair[] = rows.map(row => ({ strike: row[0] as number, callBid: row[1] ?? NaN, callAsk: row[2] ?? NaN, putBid: row[3] ?? NaN, putAsk: row[4] ?? NaN }));
  const fwd = parityForward(pairs, spot, r, t);
  if (!fwd) return null;
  const { F, q } = fwd;
  const grow = Math.exp(q * t);
  const points: SkewPoint[] = [];
  for (const row of rows) {
    const K = row[0] as number;
    const side: 'P' | 'C' = K < F ? 'P' : 'C';
    const mid = side === 'P' ? midOf(row[3], row[4]) : midOf(row[1], row[2]);
    if (mid == null) continue;
    const iv = impliedVolFromPrice(mid, spot, K, t, side, r, q);
    if (iv == null || !(iv > 0.005) || iv > 3) continue;
    const nd1 = blackScholesGreeks(spot, K, t, iv, r, q).deltaCall * grow;
    points.push({ strike: K, k: Math.log(K / F), iv, nd1, side });
  }
  /* the wings far out are often a bid of a nickel: keep the run where delta still falls as the strike rises */
  const kept: SkewPoint[] = [];
  for (const p of points) if (!kept.length || p.nd1 < kept[kept.length - 1].nd1) kept.push(p);
  if (kept.length < 3) return null;
  points.length = 0;
  points.push(...kept);
  const ks = points.map(p => p.k);
  const ivs = points.map(p => p.iv);
  const atm = interp(ks, ivs, 0);
  /* along N(d1), which falls as the strike rises */
  const nds = points.map(p => p.nd1);
  const at = {} as Record<BucketKey, number | null>;
  for (const b of BUCKETS) at[b.key] = b.nd1 == null ? atm : interp(nds, ivs, b.nd1);
  const rr25 = at.c25 != null && at.p25 != null ? at.c25 - at.p25 : null;
  const fly25 = at.c25 != null && at.p25 != null && atm != null ? (at.c25 + at.p25) / 2 - atm : null;
  return { exp, t, dte: t * 365, F, q, parityN: fwd.n, paritySpread: fwd.hi - fwd.lo, points, atm, at, rr25, fly25 };
}

/** Every expiry of a chain that gives a skew, in order */
export function chainSkew(expiries: readonly ChainExpiry<ChainRow | CloseRow>[], spot: number, r: number, atMs: number): ExpirySkew[] {
  const out: ExpirySkew[] = [];
  for (const e of expiries) {
    const s = expirySkew(e.exp, e.rows, spot, r, atMs);
    if (s) out.push(s);
  }
  return out;
}

/** The instant a session's closing quotes stand for: its regular close */
export const closeMsOf = (day: string): number => nyInstant(day, regularCloseMin(day));

/** The expiries a surface grid shows: the nearest to each of these days out, once each, in order */
const GRID_DAYS = [0, 1, 2, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180];
export function gridExpiries(skews: readonly ExpirySkew[], most = GRID_DAYS.length): ExpirySkew[] {
  const picked = new Set<ExpirySkew>();
  for (const d of GRID_DAYS) {
    let best: ExpirySkew | null = null;
    for (const s of skews) if (!best || Math.abs(s.dte - d) < Math.abs(best.dte - d)) best = s;
    if (best && Math.abs(best.dte - d) <= Math.max(1.5, d * 0.25)) picked.add(best);
  }
  return [...picked].sort((a, b) => a.t - b.t).slice(0, most);
}
