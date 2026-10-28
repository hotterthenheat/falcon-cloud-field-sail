import { higherGreeksExact, perDay, perVolPoint } from '../core/higherGreeks';
import { carrySource, getCarry } from '../core/carry';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { SESSION_LENGTH_MIN } from '../core/nyTime';
import type { MarketSnapshot, StrikeNode } from '../types/market';

/*
  COLOR, VOMMA, SPEED, VETA, ZOMMA — calculated, not copied off a morning snapshot.

  Each leg is Black–Scholes at that contract's own implied vol, at the book's spot,
  with the trading time left until 16:00 ET on its expiry. The contract count is
  the same one gamma uses: flow inventory inside five sessions (it may be
  negative), open interest after that. A leg with no contract vol is left out.
  A settled expiry is left out — the cell is not a zero. Nothing here is filled
  from greek-exposure, from a flat at-the-money vol, or from the simulator.

  UNITS, matched to the house book:
    color, speed, zomma — dollars of gamma-per-1% (the same GEX unit)
    vomma, veta — dollars of vega per vol point
  Both legs take the house sign (dealers short the option), the same negation
  the live gamma book uses. The rate and yield are the carry seam, and the
  card says when they are still assumed.
*/

/** Trading-year fraction left until the cash close on `expiry`. Null once that close has passed. Same minutes as the flip. */
export function yearsLeft(expiry: string, now = new Date()): number | null {
  const minutes = tradingMinutes(expiry, now.getTime(), false);
  if (minutes == null) return null;
  return minutes / (SESSION_LENGTH_MIN * TRADING_DAYS);
}

export interface HigherRow {
  key: 'color' | 'vomma' | 'speed' | 'veta' | 'zomma';
  label: string;
  unit: string;
  about: string;
  net: number;
  strike: number;
}

export interface HigherRead {
  spot: number;
  expiries: number;
  legs: number;
  leftOut: number;
  carry: string;
  rows: HigherRow[];
}

export const HIGHER_KEYS = ['color', 'vomma', 'speed', 'veta', 'zomma'] as const;
export type HigherKey = (typeof HIGHER_KEYS)[number];

export interface HigherSide {
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

/** Dealer-short dollars for one contract. Null when spot, time, vol or the count cannot be priced.
    `count` is the signed inventory gamma uses. Positive means dealers are short; negative means they are long, and the greek flips with it.
    Both legs take −1 on top of that count. Not the simulator's 0.55 participation. */
export function contractHigher(spot: number, strike: number, years: number, iv: number, count: number): Record<HigherKey, number> | null {
  if (!Number.isFinite(count) || count === 0) return null;
  if (!(iv > 0) || iv > 3) return null;
  const g = higherGreeksExact(spot, strike, years, iv);
  if (!g) return null;
  const gexScale = spot * spot * 0.01;
  const signed = count * 100 * -1;
  return {
    color: perDay(g.color) * gexScale * signed,
    speed: g.speed * gexScale * signed,
    zomma: perVolPoint(g.zomma) * gexScale * signed,
    vomma: perVolPoint(g.vomma) * signed,
    veta: perDay(g.veta) * signed,
  };
}

/** Call and put dollars at one strike. Null when neither leg can be priced. `years` is the trading-year fraction to that expiry.
    The two counts are the same signed inventory gamma uses, not raw open interest. */
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

const META: { key: HigherRow['key']; label: string; unit: string; about: string }[] = [
  { key: 'color', label: 'Color', unit: 'per session · gamma per 1%', about: 'The slope of gamma-per-1% right now, stated per session. Not a forecast of tomorrow’s gamma.' },
  { key: 'vomma', label: 'Vomma', unit: 'per vol point · vega', about: 'How much vega the book gains or loses when vol moves one point, from each contract’s own vol.' },
  { key: 'speed', label: 'Speed', unit: 'per $1 · gamma per 1%', about: 'How much the gamma-per-1% book changes when the underlying moves one dollar.' },
  { key: 'veta', label: 'Veta', unit: 'per session · vega', about: 'The slope of vega right now, stated per session. Not a forecast of tomorrow’s vega.' },
  { key: 'zomma', label: 'Zomma', unit: 'per vol point · gamma per 1%', about: 'How much the gamma-per-1% book changes when vol moves one point.' },
];

/** Net higher greeks for the book in hand. Null until a dated chain has a contract vol. Does not wait on the minute gamma flag. */
export function readHigherBook(snapshot: MarketSnapshot | null | undefined): HigherRead | null {
  if (!snapshot || !(snapshot.spot > 0)) return null;
  const byDate = snapshot.uwByDate ?? {};
  const dates = Object.keys(byDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && (byDate[d]?.length ?? 0) > 0).sort();
  if (!dates.length) return null;
  const spot = snapshot.spot;
  const nets = { color: 0, vomma: 0, speed: 0, veta: 0, zomma: 0 };
  const byStrike: Record<HigherRow['key'], Map<number, number>> = {
    color: new Map(),
    vomma: new Map(),
    speed: new Map(),
    veta: new Map(),
    zomma: new Map(),
  };
  let expiries = 0;
  let legs = 0;
  let leftOut = 0;
  const add = (key: HigherRow['key'], strike: number, v: number) => {
    nets[key] += v;
    const m = byStrike[key];
    m.set(strike, (m.get(strike) ?? 0) + v);
  };
  for (const date of dates) {
    const t = yearsLeft(date);
    if (t == null) continue;
    let used = 0;
    for (const n of byDate[date] as StrikeNode[]) {
      if (!(n.strike > 0)) continue;
      for (const side of ['call', 'put'] as const) {
        const count = side === 'call' ? (n.callBook ?? n.callOI) : (n.putBook ?? n.putOI);
        const iv = side === 'call' ? n.callIv : n.putIv;
        if (!Number.isFinite(count) || count === 0) continue;
        if (!(iv != null && iv > 0 && iv <= 3)) {
          leftOut += 1;
          continue;
        }
        const dollars = contractHigher(spot, n.strike, t, iv, count);
        if (!dollars) {
          leftOut += 1;
          continue;
        }
        used += 1;
        legs += 1;
        for (const key of HIGHER_KEYS) add(key, n.strike, dollars[key]);
      }
    }
    if (used > 0) expiries += 1;
  }
  if (legs === 0) return null;
  const at: Record<HigherRow['key'], number> = { color: 0, vomma: 0, speed: 0, veta: 0, zomma: 0 };
  for (const key of META) {
    let best = 0;
    for (const [strike, v] of byStrike[key.key]) {
      if (Math.abs(v) > Math.abs(best)) {
        best = v;
        at[key.key] = strike;
      }
    }
  }
  const carry = getCarry();
  const src = carrySource();
  return {
    spot,
    expiries,
    legs,
    leftOut,
    carry: src.kind === 'feed' ? src.note : `assumed ${(carry.r * 100).toFixed(1)}% rate and ${(carry.q * 100).toFixed(1)}% yield`,
    rows: META.map(m => ({ ...m, net: nets[m.key], strike: at[m.key] })),
  };
}
