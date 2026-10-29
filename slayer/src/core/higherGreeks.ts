import { getCarry } from './carry';

/*
==================================================
  SLAYER TERMINAL - HIGHER-ORDER GREEKS
  (core/higherGreeks.ts)

  Zomma · Color · Vomma · Speed · Veta —
  P-11 through P-14.
==================================================

  THESE COULD NOT BE BUILT BEFORE P-24A. Every one of them is a third
  derivative of the option price, and a third derivative amplifies error in
  the inputs rather than damping it: priced against a hardcoded r and a
  dividend yield of zero, these five would have been confident numbers about
  nothing. They read the same carry seam `blackScholesGreeks` does.

  ── UNITS, STATED ONCE AND LOUDLY ────────────────────────────────────────

  EVERY FUNCTION HERE RETURNS A RAW PARTIAL — per 1.00 of its variable, per
  one YEAR of time, per $1 of spot. Not per point, not per day.

  That is deliberately DIFFERENT from `vega` and `rho` in greeks.ts, which
  are divided by 100 because "vega" in a trader's mouth means per vol point.
  Mixing the two conventions silently is the P-24D trap one level up: a
  vomma quoted per-1.00 and rendered as if per-point is wrong by 100×, and
  it looks plausible either way. So the raw partial is what crosses this
  boundary, the conversion helpers below are the only sanctioned way to
  rescale, and the proof asserts each function against a finite difference
  of the greek it differentiates — a ground truth no convention can muddle.

  ── WHAT EACH ONE ANSWERS ────────────────────────────────────────────────

  ZOMMA  ∂gamma/∂σ — does the gamma map HOLD? Every GEX product on the
         market presents its levels as fixed. They are a function of vol,
         and zomma is how far the whole structure migrates when vol moves.

  COLOR  ∂gamma/∂t — the clock on GAMMA. Charm is the clock on delta and
         this desk has it; color is the quantitative core of why 0DTE pins
         tighten through the afternoon, which is most of what this product
         is about.

  VOMMA  ∂vega/∂σ — vol convexity. Large negative net vomma is the regime
         where a vol spike feeds on itself.

  SPEED  ∂gamma/∂S — how fast the gamma wall moves toward or away as price
         travels. The mechanism behind an air-pocket move once price punches
         a level, which is why it pairs with P-5.

  VETA   ∂vega/∂t — how much vega dealers shed per day, and therefore their
         appetite to roll vol as expiries approach. The vega-axis complement
         to charm.

  TIME CONVENTION: color and veta are stated per unit of CALENDAR time
  moving forward (∂/∂t = −∂/∂τ), matching charm in greeks.ts, so all three
  clock greeks carry the same sign meaning. `perDay` below divides by the
  trading year rather than 365 — the decay a desk experiences is measured in
  sessions, and TRADING_DAYS is the one place that number lives.
*/

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

  /*
    Color, straight to calendar time — and the same measured correction veta
    needed. The standard form below is already −∂gamma/∂τ, so negating it a
    second time gave a color exactly sign-flipped against a finite
    difference of gamma at all five of the proof's points. Both clock greeks
    are now written without the extra negation and pinned at every point.
  */
  const color =
    ((dfQ * phi) / (2 * S * t * v * sqT)) * (2 * yld * t + 1 + (d1 * (2 * (rate - yld) * t - d2 * v * sqT)) / (v * sqT));

  /*
    Veta, straight to calendar time.

    MEASURED, not assumed: the bracket below times vega is ALREADY −∂vega/∂τ
    — the negation is baked into the standard form — so negating it again
    produced a veta that was exactly sign-flipped against a finite
    difference of vega at every one of the proof's five points. It is
    written without the extra negation, and the proof pins it at all five so
    the sign cannot quietly come back.
  */
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

/*
  ── EXPOSURE AGGREGATION ─────────────────────────────────────────────────

  The same shape every other exposure on this desk uses: per-contract greek
  × open interest × the contract multiplier, dealer-signed. The SIGN is the
  house convention this terminal settled on and every surface reads —
  documented in data/exposure.ts — so the aggregator takes it as a parameter
  rather than re-deciding it here. A fifth surface inventing a sixth
  convention is exactly the failure core/walls.ts was extracted to prevent.
*/

