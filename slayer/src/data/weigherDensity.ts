/* Where the expiry may finish, as the chain prices it: the risk-neutral density of the price at the expiry's close by
   Breeden–Litzenberger — f(K) = e^{rT} ∂²C/∂K², the second strike-derivative of the call price — off the chain the
   Weigher already holds (no new request), and each wall's chance of being touched before then (weigherGate
   touchChance, the chain's own touch column's formula).

   Smoothing, in vol, not in price: a second difference of raw mids is noise (a cent of spread is a spike). Each strike
   gives its out-of-the-money leg's IV (puts below spot, calls at and above; the other leg where one is missing), the
   house's smile filter drops the outliers (core/volClock smoothSmile), every vol goes onto the trading clock the chain
   prices on, and a quadratic in log-moneyness is fitted through them (weighted towards the money). Calls are priced
   off that smooth smile on a fine strike grid five standard moves either side, and the density is their second
   difference. Past the quoted strikes the smile carries on along its tangent (floored at half the at-the-money vol),
   so the tails are an extrapolation and the read says how much of the probability the quoted strikes cover. A
   negative second difference (an arbitrage in the fitted smile) is floored at zero and the floored mass reported. */

import { blackScholesPrice } from '../core/greeks';
import { quotedVolPoint, smoothSmile } from '../core/volClock';
import { tradingMinutes, tradingYears } from '../core/tradingYear';
import { atmIvAt, clockCarry, touchChance } from './weigherGate';
import type { DeskChain } from './weigherDesk';

export interface DensityBin {
  /** The bin's strike range, and the probability the price finishes in it */
  lo: number;
  hi: number;
  p: number;
}

export interface ExpiryDensity {
  spot: number;
  expiryIso: string;
  /** Trading years to the close, the at-the-money vol on that clock, and one standard move in price (S·σ·√T) */
  t: number;
  atmVol: number;
  sd: number;
  /** The binned density over ±3.5 standard moves, probabilities summing to the mass inside that span */
  bins: DensityBin[];
  /** The whole grid's probability (≈ 1), the share floored away (negative second differences), the share inside the
      quoted strikes, and the share inside ±1 standard move */
  mass: number;
  floored: number;
  quotedShare: number;
  bandShare: number;
  /** The density's mean against the forward S·e^{(r−q)T} (they agree when the fit is sound) */
  mean: number;
  forward: number;
  /** The smile it was priced off: vol at a strike, trading clock */
  volAt: (k: number) => number;
  /** The chance the close finishes below `k`: 1 + e^{rT} ∂C/∂K off the same calls */
  cdf: (k: number) => number;
  /** The quoted strike range */
  kLo: number;
  kHi: number;
}

const isoOf = (e: string) => (/^\d{8}$/.test(e) ? `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}` : e);

/** Weighted least squares of y on [1, x, x²] */
function quad(pts: readonly { x: number; y: number; w: number }[]): [number, number, number] | null {
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (const { x, y, w } of pts) {
    let p = w;
    for (let i = 0; i < 5; i++) {
      S[i] += p;
      if (i < 3) T[i] += p * y;
      p *= x;
    }
  }
  const A = [
    [S[0], S[1], S[2], T[0]],
    [S[1], S[2], S[3], T[1]],
    [S[2], S[3], S[4], T[2]],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

/** The chain's smile on the trading clock, as a smooth function of strike; null with fewer than three usable strikes */
export function smileOf(chain: Pick<DeskChain, 'rows' | 'spot' | 'expiryIso' | 'quotedAt'>, now = Date.now()): { volAt: (k: number) => number; atm: number; kLo: number; kHi: number } | null {
  const S = chain.spot;
  const iso = isoOf(chain.expiryIso);
  if (!(S > 0) || !iso) return null;
  /* the vol was quoted at the chain's stamp: moved onto the trading clock at that instant (weigherGate readContract) */
  const at = chain.quotedAt > 0 && chain.quotedAt <= now && tradingMinutes(iso, chain.quotedAt, false) != null ? chain.quotedAt : now;
  const pt = quotedVolPoint(iso, at);
  const raw = chain.rows
    .map(r => {
      const otm = r.strike < S ? r.put.iv : r.call.iv;
      const other = r.strike < S ? r.call.iv : r.put.iv;
      const iv = otm > 0 ? otm : other > 0 ? other : 0;
      return { strike: r.strike, iv: Number.isFinite(iv) ? iv : 0 };
    })
    .filter(p => p.strike > 0);
  const pts = smoothSmile(raw).filter(p => p.iv > 0);
  if (pts.length < 3) return null;
  const atmQuoted = atmIvAt(chain.rows, S);
  const atm = (atmQuoted > 0 ? atmQuoted : pts.reduce((a, p) => a + p.iv, 0) / pts.length) / 100 * pt;
  const t = tradingYears(iso, now);
  const sdLog = Math.max(atm * Math.sqrt(Math.max(t, 1e-6)), 1e-4);
  /* weight towards the money: a strike two standard moves out counts e^{-2} as much */
  const fitPts = pts.map(p => {
    const x = Math.log(p.strike / S);
    return { x, y: (p.iv / 100) * pt, w: Math.exp(-((x / sdLog) ** 2) / 2) + 0.05 };
  });
  const c = quad(fitPts);
  if (!c) return null;
  const xLo = Math.min(...fitPts.map(p => p.x));
  const xHi = Math.max(...fitPts.map(p => p.x));
  const q = (x: number) => c[0] + c[1] * x + c[2] * x * x;
  const dq = (x: number) => c[1] + 2 * c[2] * x;
  const floor = 0.5 * atm;
  const volAt = (k: number) => {
    const x = Math.log(k / S);
    const v = x < xLo ? q(xLo) + dq(xLo) * (x - xLo) : x > xHi ? q(xHi) + dq(xHi) * (x - xHi) : q(x);
    return Math.max(floor, v);
  };
  return { volAt, atm, kLo: Math.min(...pts.map(p => p.strike)), kHi: Math.max(...pts.map(p => p.strike)) };
}

/** Breeden–Litzenberger on the chain: null without a spot, a clock or a smile */
export function expiryDensity(chain: Pick<DeskChain, 'rows' | 'spot' | 'expiryIso' | 'quotedAt' | 'ticker'>, now = Date.now(), gridN = 601, binN = 35): ExpiryDensity | null {
  const smile = smileOf(chain, now);
  const S = chain.spot;
  const iso = isoOf(chain.expiryIso);
  const t = tradingYears(iso, now);
  if (!smile || !(t > 0)) return null;
  const carry = clockCarry(chain.ticker, iso, now);
  const sdLog = smile.atm * Math.sqrt(t);
  const lo = S * Math.exp(-5.5 * sdLog);
  const hi = S * Math.exp(5.5 * sdLog);
  const h = (hi - lo) / (gridN - 1);
  const call = (k: number) => blackScholesPrice(S, k, t, smile.volAt(k), 'C', carry.r, carry.q);
  const disc = Math.exp(carry.r * t);
  let mass = 0;
  let neg = 0;
  let mean = 0;
  let quoted = 0;
  let band = 0;
  let prev = call(lo - h);
  let cur = call(lo);
  for (let i = 0; i < gridN; i++) {
    const k = lo + i * h;
    const next = call(k + h);
    const d = (disc * (prev - 2 * cur + next)) / (h * h);
    const p = d * h;
    if (d < 0) neg -= p;
    const pp = Math.max(0, p);
    mass += pp;
    mean += pp * k;
    if (k >= smile.kLo && k <= smile.kHi) quoted += pp;
    if (Math.abs(Math.log(k / S)) <= sdLog) band += pp;
    prev = cur;
    cur = next;
  }
  /* the bins: ±3.5 standard moves in log price. A bin's probability is the difference of the distribution function at
     its edges, F(K) = 1 + e^{rT} ∂C/∂K (the first derivative of the same calls), floored at zero */
  const bLo = Math.log(S) - 3.5 * sdLog;
  const bW = (7 * sdLog) / binN;
  const F = (k: number) => {
    const e = k * 1e-4;
    return 1 + (disc * (call(k + e) - call(k - e))) / (2 * e);
  };
  const edges = Array.from({ length: binN + 1 }, (_, i) => Math.exp(bLo + i * bW));
  const Fs = edges.map(F);
  const bins: DensityBin[] = Array.from({ length: binN }, (_, i) => ({ lo: edges[i], hi: edges[i + 1], p: Math.max(0, Fs[i + 1] - Fs[i]) }));
  return {
    spot: S,
    expiryIso: iso,
    t,
    atmVol: smile.atm,
    sd: S * sdLog,
    bins,
    mass,
    floored: neg,
    quotedShare: quoted,
    bandShare: band,
    mean: mass > 0 ? mean / mass : NaN,
    forward: S * Math.exp((carry.r - carry.q) * t),
    volAt: smile.volAt,
    cdf: k => Math.min(1, Math.max(0, F(k))),
    kLo: smile.kLo,
    kHi: smile.kHi,
  };
}

/** The chance a level is touched before the expiry's close: weigherGate touchChance with the smile's vol at that
    strike on the trading clock and the log drift (r − q − σ²/2) off the name's carry — the chain's own touch-odds formula */
export function wallTouch(d: Pick<ExpiryDensity, 'spot' | 't' | 'volAt' | 'expiryIso'>, ticker: string, level: number, now = Date.now()): number {
  if (!(level > 0) || !(d.t > 0)) return NaN;
  const carry = clockCarry(ticker, d.expiryIso, now);
  const v = d.volAt(level);
  /* the log price's drift, (r − q − σ²/2)·T */
  return touchChance(d.spot, level, v * Math.sqrt(d.t), (carry.r - carry.q - (v * v) / 2) * d.t);
}
