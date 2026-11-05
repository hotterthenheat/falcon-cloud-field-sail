/* One greek for Weigher, Paper, and the backtest mark.

   Time is calendar minutes from the quote to 16:00 ET on the expiry (13:00 on an early close), divided by 365 × 1440.
   A non-positive time is refused. It is not floored at five minutes.

   The rate is that day's SOFR. The 4.2% fallback stays in the Compass trees. Until a rate has loaded, the greek is blank.

   When the chain has two-sided quotes, the forward is the median of the strikes nearest the spot (at least the six
   nearest when six are two-sided): F = K + e^{rT}·(call mid − put mid), b = ln(F/S)/T. Both sides are solved under
   (S, K, T, r, b) — each to its own IV, which differ wherever the strike's own parity forward is not the median F —
   and the greek is read at their AVERAGE (both sides two-sided; else the side's own). Without a forward, each side is
   solved through the cash spot with dividend 0 and keeps its own IV.

   Delta and gamma are the Black–Scholes partials. Vega is per 1.00 of volatility. Theta per calendar day is the
   annual theta divided by 365; per session is the annual theta divided by 252 — each over the time that is left when
   less, and never more than the extrinsic value (thetaOver). Charm is per year.
*/

import { impliedVolFromPrice } from './greeks';
import { rateOn } from './carry';
import { sessionCloseMinOn } from './calendar';
import { nyIsoDate, nyMinutes } from './nyTime';
import { normCdf as normalCDF } from './math';

const YEAR_MIN = 365 * 1440;
/** A quote wider than this, as a share of the mid, is not solved. */
const SPREAD_MAX = 0.08;
/** Option and stock stamps further apart than this are not the same minute. */
const STAMP_MS = 60_000;

export interface SideQuote {
  bid: number;
  ask: number;
  /** Epoch ms. */
  at: number;
  /** Present and not 0: the print is rejected. Absent, or 0, is usable. */
  ivError?: number | null;
}

export interface StockQuote {
  bid?: number;
  ask?: number;
  /** An index print, or a last, when the quote is not two-sided. */
  price?: number;
  at: number;
}

export interface ChainPair {
  strike: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
}

export type GreekWhy = 'rate not loaded' | 'timestamps' | 'iv error' | 'spread' | 'expired' | 'quote';

export interface GreekRead {
  ok: true;
  spot: number;
  /** Calendar years to the expiry's close. Not floored. */
  t: number;
  r: number;
  /** Cost of carry, ln(F/S)/T. Equals the rate when the forward is missing. */
  b: number;
  /** Dividend yield, r − b. 0 on the cash-spot solve. */
  q: number;
  forward: number | null;
  carry: 'parity' | 'cash';
  /** Cash-spot solve: the call and the put were solved on their own IVs. */
  separate: boolean;
  /** Words for the card. Empty when the parity forward was used. */
  note: string;
  /** The IV the side was read on, a fraction. */
  iv: number;
  callIv: number | null;
  putIv: number | null;
  delta: number;
  gamma: number;
  /** Per 1.00 of volatility. A column headed "per point" divides by 100. */
  vega: number;
  /** Annual theta / 365 — or, inside the last calendar day, over the time that is left (thetaOver), never more than the
      extrinsic value. */
  thetaDay: number;
  /** Annual theta / 252, capped the same way inside the last 1/252 of a year. A column headed "per session" shows this. */
  thetaSession: number;
  /** Annual theta over one calendar hour (thetaOver): the strike card's "calendar hour" */
  thetaHour: number;
  /** Per year. */
  charm: number;
  /** Annual charm / 252. */
  charmSession: number;
  right: 'C' | 'P';
}

export type GreekResult = GreekRead | { ok: false; why: GreekWhy };

/** Calendar years to the expiry's cash close. Null once that close has passed. Not floored. */
export function calendarYearsOpen(expiry: string, atMs: number): number | null {
  const iso = expiry.slice(0, 10);
  const today = nyIsoDate(atMs);
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const mins = days * 1440 + (sessionCloseMinOn(iso) - nyMinutes(atMs));
  if (!(mins > 0)) return null;
  return mins / YEAR_MIN;
}

function pdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function twoSided(bid: number, ask: number): number {
  if (!(bid >= 0) || !(ask > 0) || ask < bid) return NaN;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return NaN;
  if ((ask - bid) / mid > SPREAD_MAX) return NaN;
  return mid;
}

/** A mid for the forward only: two-sided, not crossed. The 8% gate is the contract's own, not the chain's. */
function looseMid(bid: number, ask: number): number {
  if (!(bid > 0) || !(ask >= bid)) return NaN;
  return (bid + ask) / 2;
}

function stockSpot(stock: StockQuote): number {
  const bid = stock.bid ?? NaN;
  const ask = stock.ask ?? NaN;
  if (bid > 0 && ask >= bid) return (bid + ask) / 2;
  return stock.price != null && stock.price > 0 ? stock.price : NaN;
}

/** The parity forward one expiry's greeks share, and what stands behind it: the median of K + e^{rT}(C − P) over the
    strikes nearest the spot (the six nearest when six are two-sided). */
export interface ParityMedianRead {
  F: number;
  /** Strikes behind it, and the lowest and highest of their forwards */
  n: number;
  lo: number;
  hi: number;
  strikes: number[];
}
export function parityMedianRead(pairs: readonly ChainPair[], spot: number, r: number, t: number): ParityMedianRead | null {
  if (!(spot > 0) || !(t > 0) || !Number.isFinite(r)) return null;
  const grow = Math.exp(r * t);
  const usable = pairs
    .map(p => ({ k: p.strike, c: looseMid(p.callBid, p.callAsk), p: looseMid(p.putBid, p.putAsk) }))
    .filter(x => x.k > 0 && Number.isFinite(x.c) && Number.isFinite(x.p))
    .sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot) || a.k - b.k);
  if (!usable.length) return null;
  const picked = usable.length >= 6 ? usable.slice(0, 6) : usable;
  const fs = picked.map(x => x.k + grow * (x.c - x.p)).filter(f => f > 0).sort((a, b) => a - b);
  if (!fs.length) return null;
  const h = fs.length >> 1;
  const F = fs.length % 2 ? fs[h] : (fs[h - 1] + fs[h]) / 2;
  if (!(F > 0) || Math.abs(F / spot - 1) > 0.1) return null;
  return { F, n: fs.length, lo: fs[0], hi: fs[fs.length - 1], strikes: picked.map(x => x.k).sort((a, c) => a - c) };
}

/** Median of the strikes nearest the spot. At least the six nearest when six are two-sided. THE parity forward: the
    Weigher's chain forward (weigherDesk, the carry its rows and its density read) is this same read, shared. */
export function parityMedian(pairs: readonly ChainPair[], spot: number, r: number, t: number): number | null {
  return parityMedianRead(pairs, spot, r, t)?.F ?? null;
}

interface Partials {
  delta: number;
  gamma: number;
  vega: number;
  thetaYear: number;
  charm: number;
  /** The model price at this vol, for the extrinsic value the theta is capped at */
  price: number;
}

/** The annual theta over a span of `span` years when `t` is left: θ_year × min(t, span), and a long's loss never more
    than its extrinsic value (the price minus intrinsic — what the clock can take before the bell). Without the cap a
    0DTE contract two hours out read θ_year / 252: −$424 a contract on a 2.07 mid. */
export function thetaOver(thetaYear: number, t: number, span: number, price: number, intrinsic: number): number {
  const x = thetaYear * Math.min(Math.max(0, t), span);
  return x < 0 ? Math.max(x, -Math.max(0, price - intrinsic)) : x;
}

function partials(S: number, K: number, t: number, v: number, r: number, q: number, right: 'C' | 'P'): Partials | null {
  if (!(S > 0) || !(K > 0) || !(t > 0) || !(v > 0)) return null;
  const sq = Math.sqrt(t);
  const dfQ = Math.exp(-q * t);
  const dfR = Math.exp(-r * t);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * t) / (v * sq);
  const d2 = d1 - v * sq;
  const nd1 = normalCDF(d1);
  const nd2 = normalCDF(d2);
  const n = pdf(d1);
  const delta = right === 'C' ? dfQ * nd1 : dfQ * (nd1 - 1);
  const gamma = (dfQ * n) / (S * v * sq);
  const vega = S * dfQ * sq * n;
  const decay = -(S * dfQ * n * v) / (2 * sq);
  const thetaYear = right === 'C' ? decay - r * K * dfR * nd2 + q * S * dfQ * nd1 : decay + r * K * dfR * normalCDF(-d2) - q * S * dfQ * normalCDF(-d1);
  const shared = (dfQ * n * (2 * (r - q) * t - d2 * v * sq)) / (2 * t * v * sq);
  const charm = right === 'C' ? q * dfQ * nd1 - shared : -q * dfQ * normalCDF(-d1) - shared;
  const price = right === 'C' ? S * dfQ * nd1 - K * dfR * nd2 : K * dfR * normalCDF(-d2) - S * dfQ * normalCDF(-d1);
  if (![delta, gamma, vega, thetaYear, charm, price].every(Number.isFinite)) return null;
  return { delta, gamma, vega, thetaYear, charm, price };
}

export interface ReadGreekInput {
  right: 'C' | 'P';
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  option: SideQuote;
  /** The other side of the same strike, when it is in hand. */
  other?: SideQuote | null;
  stock: StockQuote;
  chain?: readonly ChainPair[] | null;
  /** The minute being priced. Defaults to the option stamp. */
  at?: number;
  /** The expiry's parity forward already read off this chain (parityMedian): used as it is, so every contract of the
      chain is priced on one F. Without it the forward is read from `chain`. */
  forward?: number | null;
}

/** The greek on one contract. Blank, with a reason, when the quote, the stamps, or the rate cannot support it. */
export function readGreek(input: ReadGreekInput): GreekResult {
  const opt = input.option;
  const at = input.at ?? opt.at;
  if (!(at > 0) || !(opt.at > 0) || !(input.stock.at > 0)) return { ok: false, why: 'timestamps' };
  if (Math.abs(opt.at - input.stock.at) > STAMP_MS) return { ok: false, why: 'timestamps' };
  if (opt.ivError != null && opt.ivError !== 0) return { ok: false, why: 'iv error' };
  const mid = twoSided(opt.bid, opt.ask);
  if (!Number.isFinite(mid)) {
    if (!(opt.ask > 0) || opt.bid < 0 || opt.ask < opt.bid) return { ok: false, why: 'quote' };
    return { ok: false, why: 'spread' };
  }
  const spot = stockSpot(input.stock);
  if (!(spot > 0) || !(input.strike > 0)) return { ok: false, why: 'quote' };
  const t = calendarYearsOpen(input.expiry, at);
  if (t == null) return { ok: false, why: 'expired' };
  const day = nyIsoDate(at);
  const rate = rateOn(day);
  if (rate.source === 'fixed') return { ok: false, why: 'rate not loaded' };
  const r = rate.r;
  const callQuote = input.right === 'C' ? opt : input.other;
  const putQuote = input.right === 'P' ? opt : input.other;
  const callMid = callQuote ? twoSided(callQuote.bid, callQuote.ask) : NaN;
  const putMid = putQuote ? twoSided(putQuote.bid, putQuote.ask) : NaN;
  const F = input.forward != null && input.forward > 0 && Math.abs(input.forward / spot - 1) <= 0.1 ? input.forward : input.chain?.length ? parityMedian(input.chain, spot, r, t) : null;
  const cash = !(F != null && F > 0);
  const b = cash ? r : Math.log(F / spot) / t;
  const q = cash ? 0 : r - b;
  const callIv = Number.isFinite(callMid) ? impliedVolFromPrice(callMid, spot, input.strike, t, 'C', r, q) : null;
  const putIv = Number.isFinite(putMid) ? impliedVolFromPrice(putMid, spot, input.strike, t, 'P', r, q) : null;
  const own = input.right === 'C' ? callIv : putIv;
  if (!(own != null && own > 0)) return { ok: false, why: 'quote' };
  const separate = cash && callIv != null && putIv != null;
  /* with the forward in and both sides solved, the average of the two IVs (they agree only at a strike whose own parity
     forward is the median F); otherwise the side's own */
  const iv = !cash && callIv != null && putIv != null ? (callIv + putIv) / 2 : own;
  const g = partials(spot, input.strike, t, iv, r, q, input.right);
  if (!g) return { ok: false, why: 'quote' };
  const intrinsic = Math.max(0, input.right === 'C' ? spot - input.strike : input.strike - spot);
  const note = cash ? (separate ? 'cash spot, dividend 0. Solved separately.' : 'cash spot, dividend 0') : '';
  return {
    ok: true,
    spot,
    t,
    r,
    b,
    q,
    forward: cash ? null : F,
    carry: cash ? 'cash' : 'parity',
    separate,
    note,
    iv,
    callIv,
    putIv,
    delta: g.delta,
    gamma: g.gamma,
    vega: g.vega,
    thetaDay: thetaOver(g.thetaYear, t, 1 / 365, g.price, intrinsic),
    thetaSession: thetaOver(g.thetaYear, t, 1 / 252, g.price, intrinsic),
    thetaHour: thetaOver(g.thetaYear, t, 1 / (365 * 24), g.price, intrinsic),
    charm: g.charm,
    charmSession: g.charm / 252,
    right: input.right,
  };
}

/** The line a card draws when a vendor number sits beside this solve. Neither replaces the other. */
export function greekCaption(parts: { source: 'Flow' | 'Chain' | 'Theta' | 'readGreek'; delta: number }[]): string {
  return parts
    .filter(p => Number.isFinite(p.delta))
    .map(p => `${p.source} ${p.delta.toFixed(3)}`)
    .join(' · ');
}
