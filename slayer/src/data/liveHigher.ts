import { higherGreeksExact, perDay, perVolPoint } from '../core/higherGreeks';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { SESSION_LENGTH_MIN } from '../core/nyTime';
import type { MarketSnapshot } from '../types/market';

/*
  Color, vomma, speed, veta, zomma: Black–Scholes at each contract's own vol and the book's spot, open interest as the
  count, dealer-short sign. Units sit beside the book's: gamma ones in $GEX (per 1% move) per session, per 1% move or
  per vol point; vega ones in $vega (per vol point) per vol point or per session — so VOMMA and VETA sit beside VEGA $.
*/

/** Trading-year fraction left until the cash close on `expiry`. Null once that close has passed. Same minutes as the flip. */
export function yearsLeft(expiry: string, now = new Date()): number | null {
  const minutes = tradingMinutes(expiry, now.getTime(), false);
  if (minutes == null) return null;
  return minutes / (SESSION_LENGTH_MIN * TRADING_DAYS);
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

/** Dealer-short dollars for one contract position of `count` contracts. Null when it cannot be priced.
    color $GEX/session · speed $GEX per 1% move · zomma $GEX/vol pt · vomma $vega/vol pt · veta $vega/session. */
export function contractHigher(spot: number, strike: number, years: number, iv: number, count: number): Record<HigherKey, number> | null {
  if (!Number.isFinite(count) || count === 0) return null;
  if (!(iv > 0) || iv > 3) return null;
  const g = higherGreeksExact(spot, strike, years, iv);
  if (!g) return null;
  const gexScale = spot * spot * 0.01;
  const signed = count * 100 * -1;
  return {
    color: perDay(g.color) * gexScale * signed,
    /* ∂Γ/∂S per $1, times the dollars a 1% move is */
    speed: g.speed * gexScale * spot * 0.01 * signed,
    zomma: perVolPoint(g.zomma) * gexScale * signed,
    /* raw vomma and veta are of vega per 1.00 of vol: one more ÷100 puts them on vega per vol point */
    vomma: perVolPoint(perVolPoint(g.vomma)) * signed,
    veta: perVolPoint(perDay(g.veta)) * signed,
  };
}

/** Call and put dollars at one strike. Null when neither leg can be priced. `years` is the trading-year fraction to that
    expiry; the counts are the contracts' open interest, the count gamma uses. */
export function strikeHigher(spot: number, strike: number, years: number, callIv: number | undefined, putIv: number | undefined, callCount: number, putCount: number): Record<HigherKey, HigherSide> | null {
  const call = contractHigher(spot, strike, years, callIv ?? 0, callCount);
  const put = contractHigher(spot, strike, years, putIv ?? 0, putCount);
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
  const years = new Map<string, number | null>();
  for (const date of dates) {
    const nodes = byDate[date];
    if (!nodes?.length) continue;
    let t = years.get(date);
    if (t === undefined) {
      t = yearsLeft(date);
      years.set(date, t);
    }
    if (t == null) continue;
    for (const n of nodes) {
      if (!want.has(n.strike)) continue;
      const h = strikeHigher(snapshot.spot, n.strike, t, n.callIv, n.putIv, n.callBook ?? n.callOI, n.putBook ?? n.putOI);
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

