import { higherGreeksExact, perDay, perVolPoint } from '../core/higherGreeks';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { quotedVolPoint } from '../core/volClock';
import { SESSION_LENGTH_MIN } from '../core/nyTime';
import { keptLeg, type Right } from '../core/dealerSign';
import type { MarketSnapshot } from '../types/market';

/* Colour, vomma, speed, veta, zomma: Black-Scholes at each contract's own vol and the book's spot, OI as the count, kept in
   the house sign of the one dealer model (core/dealerSign.ts: dealers long the calls, short the puts).
   Gamma ones in $GEX (per 1%) per session, per 1% or per vol point; vega ones in $vega per vol point or per session. */

/** Trading-year fraction left until the cash close on `expiry`. Null once that close has passed. Same minutes as the flip. */
export function yearsLeft(expiry: string, now = new Date()): number | null {
  const minutes = tradingMinutes(expiry, now.getTime(), false);
  if (minutes == null) return null;
  return minutes / (SESSION_LENGTH_MIN * TRADING_DAYS);
}

/** One date's clock for its higher greeks: years left and the quoted-vol-point factor, both at the minute the vendor priced
    the date's rows (the clock its vols were solved at), else now. Years are null once that expiry's close has passed. */
export function chainClock(nodes: readonly { gexAt?: number }[], expiry: string): { years: number | null; volPt: number } {
  let at = 0;
  for (const n of nodes) if (n.gexAt != null && n.gexAt > at) at = n.gexAt;
  const when = at > 0 ? at : Date.now();
  return { years: yearsLeft(expiry, new Date(when)), volPt: quotedVolPoint(expiry, when) };
}

export const HIGHER_KEYS = ['color', 'vomma', 'speed', 'veta', 'zomma'] as const;
export type HigherKey = (typeof HIGHER_KEYS)[number];

interface HigherSide {
  call: number;
  put: number;
}

const ZERO_SIDE = (): Record<HigherKey, HigherSide> => ({
  color: { call: 0, put: 0 },
  vomma: { call: 0, put: 0 },
  speed: { call: 0, put: 0 },
  veta: { call: 0, put: 0 },
  zomma: { call: 0, put: 0 },
});

/** Kept dollars (house sign) for `count` contracts of one leg. Null when it cannot be priced.
    color $GEX/session · speed $GEX per 1% move · zomma $GEX/vol pt · vomma $vega/vol pt · veta $vega/session. */
export function contractHigher(spot: number, strike: number, years: number, iv: number, count: number, right: Right = 'C', volPt = 1): Record<HigherKey, number> | null {
  if (!Number.isFinite(count) || count === 0) return null;
  if (!(iv > 0) || iv > 3) return null;
  const g = higherGreeksExact(spot, strike, years, iv);
  if (!g) return null;
  const gexScale = spot * spot * 0.01;
  const kept = (perLong: number) => keptLeg(right, perLong * 100, count);
  return {
    color: kept(perDay(g.color) * gexScale),
    /* ∂Γ/∂S per $1, times the dollars a 1% move is */
    speed: kept(g.speed * gexScale * spot * 0.01),
    /* per point of the quoted vol (volPt, core/volClock.ts quotedVolPoint): once for zomma and veta, twice for vomma */
    zomma: kept(perVolPoint(g.zomma) * gexScale * volPt),
    /* raw vomma and veta are of vega per 1.00 of vol: one more ÷100 puts them on vega per vol point */
    vomma: kept(perVolPoint(perVolPoint(g.vomma)) * volPt * volPt),
    veta: kept(perVolPoint(perDay(g.veta)) * volPt),
  };
}

/** Call and put dollars at one strike. Null when neither leg can be priced. `years` is the trading-year fraction to that
    expiry; the counts are the contracts' open interest, the count gamma uses. */
export function strikeHigher(spot: number, strike: number, years: number, callIv: number | undefined, putIv: number | undefined, callCount: number, putCount: number, volPt = 1): Record<HigherKey, HigherSide> | null {
  const call = contractHigher(spot, strike, years, callIv ?? 0, callCount, 'C', volPt);
  const put = contractHigher(spot, strike, years, putIv ?? 0, putCount, 'P', volPt);
  if (!call && !put) return null;
  const out = ZERO_SIDE();
  for (const k of HIGHER_KEYS) {
    if (call) out[k].call = call[k];
    if (put) out[k].put = put[k];
  }
  return out;
}

const FRESH_SPLIT = (): Record<HigherKey, { put: number; call: number; net: number }> => ({
  color: { put: 0, call: 0, net: 0 },
  vomma: { put: 0, call: 0, net: 0 },
  speed: { put: 0, call: 0, net: 0 },
  veta: { put: 0, call: 0, net: 0 },
  zomma: { put: 0, call: 0, net: 0 },
});

/** Higher-greek dollars for the strikes in a profile window. Empty until that expiry's contract vol is in.
    One date for a single expiry, every dated chain for ALL. Does not touch GEX. */
export function higherForStrikes(
  snapshot: MarketSnapshot,
  expiry: string,
  strikes: readonly number[],
): Map<number, Record<HigherKey, { put: number; call: number; net: number }>> {
  const out = new Map<number, Record<HigherKey, { put: number; call: number; net: number }>>();
  if (!snapshot.liveBook || !(snapshot.spot > 0) || !strikes.length) return out;
  const byDate = snapshot.uwByDate ?? {};
  let dates: string[] = [];
  if (expiry === 'ALL') dates = Object.keys(byDate);
  else {
    const chain = snapshot.uwChains?.[expiry as keyof NonNullable<MarketSnapshot['uwChains']>];
    if (chain) {
      for (const [d, nodes] of Object.entries(byDate)) {
        if (nodes === chain) {
          dates = [d];
          break;
        }
      }
    }
  }
  if (!dates.length) return out;
  let any = false;
  for (const d of dates) {
    const nodes = byDate[d];
    if (nodes?.some(n => (n.callIv ?? 0) > 0 || (n.putIv ?? 0) > 0)) {
      any = true;
      break;
    }
  }
  if (!any) return out;
  const want = new Set(strikes);
  for (const date of dates) {
    const nodes = byDate[date];
    if (!nodes?.length) continue;
    const { years: t, volPt } = chainClock(nodes, date);
    if (t == null) continue;
    for (const n of nodes) {
      if (!want.has(n.strike)) continue;
      const h = strikeHigher(snapshot.spot, n.strike, t, n.callIv, n.putIv, n.callBook ?? n.callOI, n.putBook ?? n.putOI, volPt);
      if (!h) continue;
      let cur = out.get(n.strike);
      if (!cur) {
        cur = FRESH_SPLIT();
        out.set(n.strike, cur);
      }
      for (const k of HIGHER_KEYS) {
        cur[k].put += h[k].put;
        cur[k].call += h[k].call;
        cur[k].net = cur[k].put + cur[k].call;
      }
    }
  }
  return out;
}

