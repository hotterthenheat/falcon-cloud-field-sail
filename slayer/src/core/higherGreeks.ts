import { getCarry } from './carry';

/* Zomma (∂Γ/∂σ), colour (∂Γ/∂t), vomma (∂vega/∂σ), speed (∂Γ/∂S), veta (∂vega/∂t) on the carry seam. Each returns a raw partial
   (per 1.00, per year, per $1); rescale only through the helpers below. Colour and veta are per calendar time forward, like charm. */

const TRADING_DAYS = 252;

function normalPDF(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

interface HigherGreeks {
  /** ∂gamma/∂σ, per 1.00 of vol. */
  zomma: number;
  /** ∂gamma/∂t, per YEAR of calendar time. */
  color: number;
  /** ∂vega/∂σ, per 1.00 of vol (raw vega, not per-point). */
  vomma: number;
  /** ∂gamma/∂S, per $1 of spot. */
  speed: number;
  /** ∂vega/∂t, per YEAR (raw vega). */
  veta: number;
}

/** Shared d1/d2/gamma/vega core — one place, so five formulas cannot drift. */
function core(S: number, K: number, t: number, v: number, r: number, q: number) {
  const sqT = Math.sqrt(t);
  const dfQ = Math.exp(-q * t);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * t) / (v * sqT);
  const d2 = d1 - v * sqT;
  const phi = normalPDF(d1);
  const gamma = (dfQ * phi) / (S * v * sqT);
  /* RAW vega — per 1.00. greeks.ts divides its own by 100; see the header. */
  const vega = S * dfQ * sqT * phi;
  return { sqT, dfQ, d1, d2, phi, gamma, vega };
}

/** The same partials with no floor. Null when the inputs cannot be priced — a dead expiry, a missing vol, a bad spot.
    The public `higherGreeks` still floors a zero so older callers do not divide by zero. */
export function higherGreeksExact(S: number, K: number, t: number, v: number, r?: number, q?: number): HigherGreeks | null {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  if (!(S > 0) || !(K > 0) || !(t > 1e-6) || !(v > 0) || v > 3) return null;
  return higherRaw(S, K, t, v, rate, yld);
}

function higherRaw(S: number, K: number, t: number, v: number, rate: number, yld: number): HigherGreeks {
  const { sqT, dfQ, d1, d2, phi, gamma, vega } = core(S, K, t, v, rate, yld);

  const zomma = (gamma * (d1 * d2 - 1)) / v;
  const speed = -(gamma / S) * (d1 / (v * sqT) + 1);
  const vomma = (vega * d1 * d2) / v;

  /* Colour in calendar time: the standard form is already −∂Γ/∂τ, so it is not negated again (the proof pins the sign at five points). */
  const color =
    ((dfQ * phi) / (2 * S * t * v * sqT)) * (2 * yld * t + 1 + (d1 * (2 * (rate - yld) * t - d2 * v * sqT)) / (v * sqT));

  /* Veta in calendar time: the bracket times vega is already −∂vega/∂τ, so it is not negated again (pinned by the proof). */
  const veta = vega * (yld + ((rate - yld) * d1) / (v * sqT) - (1 + d1 * d2) / (2 * t));

  return { zomma, color, vomma, speed, veta };
}

/** A per-1.00-of-vol partial, restated per vol POINT — the only sanctioned
    rescale. Never apply it twice; see the header. */
export function perVolPoint(raw: number): number {
  return raw / 100;
}

/** A per-YEAR clock partial, restated per TRADING day. */
export function perDay(raw: number): number {
  return raw / TRADING_DAYS;
}

/* Exposure: per-contract greek × open interest × multiplier, dealer-signed; the sign is passed in (data/exposure.ts owns the convention). */

