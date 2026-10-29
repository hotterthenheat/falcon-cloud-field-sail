/* Black-Scholes greeks with a continuous dividend yield — pure math, no state, no clock (live and replay price greeks
   with the same code). r and q come from core/carry.ts. vega and rho are PER POINT (÷100 here): a feed that quotes
   per-1.00 vega is divided once on ingest, never again. */

import { getCarry } from './carry';
import type { Greeks } from '../types/market';
import { normCdf as normalCDF } from './math';

function normalPDF(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Black-Scholes greeks with a continuous dividend yield; r and q default to the carry seam (core/carry.ts), not constants. */
export function blackScholesGreeks(S: number, K: number, t: number, v: number, r?: number, q?: number): Greeks {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  if (t <= 0) t = 0.0001; // Avoid division by zero
  if (v <= 0) v = 0.01;

  const sqT = Math.sqrt(t);
  const dfQ = Math.exp(-yld * t);
  const dfR = Math.exp(-rate * t);
  const d1 = (Math.log(S / K) + (rate - yld + (v * v) / 2) * t) / (v * sqT);
  const d2 = d1 - v * sqT;

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Np_d1 = normalPDF(d1);

  // Delta — the yield discount is why an index call is not simply N(d1)
  const deltaCall = dfQ * Nd1;
  const deltaPut = dfQ * (Nd1 - 1);

  // Gamma (same for call/put)
  const gamma = (dfQ * Np_d1) / (S * v * sqT);

  // Vega (same for call/put) — per 1 POINT of vol; see the header
  const vega = (S * dfQ * sqT * Np_d1) / 100;

  // Rho — per 1 POINT of rate, same convention as vega
  const rhoCall = (K * t * dfR * Nd2) / 100;
  const rhoPut = (-K * t * dfR * normalCDF(-d2)) / 100;

  // Vanna — ∂²V/∂S∂σ
  const vanna = (-dfQ * Np_d1 * d2) / v;

  /* Charm = −∂Δ/∂τ, the delta the clock takes per year. The shared term is
     the pure time-decay of the moneyness; the leading q-terms are what make
     the pair consistent with the deltas above (see the header). */
  const shared = (dfQ * Np_d1 * (2 * (rate - yld) * t - d2 * v * sqT)) / (2 * t * v * sqT);
  const charmCall = yld * dfQ * Nd1 - shared;
  const charmPut = -yld * dfQ * normalCDF(-d1) - shared;

  return { deltaCall, deltaPut, gamma, vega, vanna, charmCall, charmPut, rhoCall, rhoPut };
}

/** Black-Scholes price, the inversion below solves against. */
export function blackScholesPrice(
  S: number,
  K: number,
  t: number,
  v: number,
  right: 'C' | 'P',
  r?: number,
  q?: number
): number {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  if (t <= 0) t = 0.0001;
  if (v <= 0) v = 0.0001;
  const sqT = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (rate - yld + (v * v) / 2) * t) / (v * sqT);
  const d2 = d1 - v * sqT;
  const dfQ = Math.exp(-yld * t);
  const dfR = Math.exp(-rate * t);
  return right === 'C'
    ? S * dfQ * normalCDF(d1) - K * dfR * normalCDF(d2)
    : K * dfR * normalCDF(-d2) - S * dfQ * normalCDF(-d1);
}

/** Implied vol from a price, by bisection (vega collapses in the wings and near expiry, where Newton diverges). Null when
    the price is outside what the model can produce at any vol — a quote problem, not a vol. */
export function impliedVolFromPrice(
  price: number,
  S: number,
  K: number,
  t: number,
  right: 'C' | 'P',
  r?: number,
  q?: number
): number | null {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(t > 0)) return null;
  let lo = 0.0001;
  let hi = 5;
  const at = (v: number) => blackScholesPrice(S, K, t, v, right, r, q);
  /* Outside the model's own range at the bracket's ends: no vol explains it. */
  if (price < at(lo) - 1e-9 || price > at(hi) + 1e-9) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < price) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-8) break;
  }
  return (lo + hi) / 2;
}
