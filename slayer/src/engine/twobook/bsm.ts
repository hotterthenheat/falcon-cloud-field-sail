/* Generalized Black–Scholes–Merton for the two-book engine (TWO_BOOK_SPEC_V2 §1.3–§1.5), exactly as written there.

   Inputs: S, K, T (calendar years, D = 365), σ (decimal), r (continuously compounded), b (cost of carry, b = r − q).
   Outputs are RAW: per 1.00 vol, per year, per $1 of spot. Every scaling to dollars lives in exposures.ts.
   colorT = +∂Γ/∂T and vetaT = +∂vega/∂T are derivatives with respect to time REMAINING; charm = −∂Δ/∂T is calendar time
   passing (§1.4). Put delta is coded −ec·N(−d1) (no cancellation). N is the full-precision erfc form (normal.ts).

   The formula lines are spelled so scripts/twobook-mutation.mjs can inject each of the spec's Test 6 bugs; keep their
   text when editing. Pure: no clock, no state. */

import { normCdf as N, normPdf as phi } from './normal';

export type Right = 'C' | 'P';
export type ContractStatus = 'OK' | 'EXPIRED' | 'UNAVAILABLE';

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  vanna: number;
  vomma: number;
  charm: number;
  colorT: number;
  speed: number;
  vetaT: number;
  zomma: number;
  d1: number;
  d2: number;
}
export const GREEK_NAMES = ['delta', 'gamma', 'vega', 'vanna', 'vomma', 'charm', 'colorT', 'speed', 'vetaT', 'zomma'] as const;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** §1.5: missing / non-finite S, K or T, or S, K ≤ 0 → UNAVAILABLE; then T ≤ 0 → EXPIRED (never reaches a division);
    then a missing, non-finite or non-positive σ → UNAVAILABLE. T is decided before σ because a contract's σ is only
    known once it is solved, and an expired contract is excluded as EXPIRED whatever its quote (audit reading A15). */
export function contractStatus(S: number, K: number, sigma: number, T: number): ContractStatus {
  if (!fin(S) || !fin(K) || !fin(T) || S <= 0 || K <= 0) return 'UNAVAILABLE';
  if (T <= 0) return 'EXPIRED';
  if (!fin(sigma) || sigma <= 0) return 'UNAVAILABLE';
  return 'OK';
}

/** §1.3 price. Caller guarantees contractStatus(...) === 'OK'. */
export function price(S: number, K: number, T: number, sigma: number, r: number, b: number, right: Right): number {
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const ec = Math.exp((b - r) * T);
  const df = Math.exp(-r * T);
  return right === 'C' ? S * ec * N(d1) - K * df * N(d2) : K * df * N(-d2) - S * ec * N(-d1);
}

/** §1.4, the ten raw Greeks. Caller guarantees contractStatus(...) === 'OK'. */
export function greeks(S: number, K: number, T: number, sigma: number, r: number, b: number, right: Right): Greeks {
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const ec = Math.exp((b - r) * T);
  const p = phi(d1);
  const N1 = N(d1);
  const Nm1 = N(-d1);
  const dd1dT = b / (sigma * sqT) - d2 / (2 * T);
  const delta = right === 'C' ? ec * N1 : -ec * Nm1;
  const gamma = (ec * p) / (S * sigma * sqT);
  const vega = S * ec * p * sqT;
  const vanna = (-ec * p * d2) / sigma;
  const vomma = (vega * d1 * d2) / sigma;
  const charmRaw = right === 'C' ? -ec * (p * dd1dT + (b - r) * N1) : -ec * (p * dd1dT - (b - r) * Nm1);
  const charm = charmRaw;
  const colorT = gamma * ((b - r) + (d1 * d2 - 1) / (2 * T) - (b * d1) / (sigma * sqT));
  const speed = (-gamma / S) * (1 + d1 / (sigma * sqT));
  const vetaT = vega * ((b - r) + (1 + d1 * d2) / (2 * T) - (b * d1) / (sigma * sqT));
  const zomma = (gamma * (d1 * d2 - 1)) / sigma;
  return { delta, gamma, vega, vanna, vomma, charm, colorT, speed, vetaT, zomma, d1, d2 };
}

/** The no-arbitrage bounds of a European premium: [lower, upper] */
export function bounds(S: number, K: number, T: number, r: number, b: number, right: Right): [number, number] {
  const fwd = S * Math.exp((b - r) * T);
  const pvk = K * Math.exp(-r * T);
  return right === 'C' ? [Math.max(0, fwd - pvk), fwd] : [Math.max(0, pvk - fwd), pvk];
}

export const IV_LO = 1e-4;
export const IV_HI = 10;

/** σ ∈ [1e-4, 10] that prices `target`, with |price error| ≤ 1e-10·S (§1.5); null when no root can be bracketed or the
    solver does not converge. Bisection to the last bit (vega collapses in the wings and near expiry, where Newton
    diverges). */
export function impliedVol(target: number, S: number, K: number, T: number, r: number, b: number, right: Right): number | null {
  if (!fin(target) || contractStatus(S, K, 1, T) !== 'OK') return null;
  const f = (s: number) => price(S, K, T, s, r, b, right) - target;
  let lo = IV_LO;
  let hi = IV_HI;
  const flo = f(lo);
  const fhi = f(hi);
  if (!(flo <= 0) || !(fhi >= 0)) return null;
  if (flo === 0) return lo;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid <= lo || mid >= hi) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fm < 0) lo = mid;
    else hi = mid;
  }
  const s = 0.5 * (lo + hi);
  return Math.abs(f(s)) <= 1e-10 * S ? s : null;
}

/** §1.5: the IV of a two-sided quote's mid under (S, K, T, r, b), or null when it is not identifiable — bid = 0,
    bid ≥ ask, mid ≤ lower bound + ½ tick, mid ≥ upper bound, or no root. `tick` is the contract's tick at that price. */
export function ivFromQuote(bid: number, ask: number, S: number, K: number, T: number, r: number, b: number, right: Right, tick: number): number | null {
  if (!fin(bid) || !fin(ask) || !(bid > 0) || bid >= ask) return null;
  if (contractStatus(S, K, 1, T) !== 'OK') return null;
  const mid = 0.5 * (bid + ask);
  const [lb, ub] = bounds(S, K, T, r, b, right);
  if (mid <= lb + tick / 2 || mid >= ub) return null;
  return impliedVol(mid, S, K, T, r, b, right);
}
