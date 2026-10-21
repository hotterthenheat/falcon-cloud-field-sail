/*
==================================================
  SLAYER TERMINAL - THE EXPOSURE CURVE (exposureCurve.ts)

  Dealer gamma AS A FUNCTION OF SPOT (the competitive
  audit, 2026-10-13: the profile is the category's
  principled way to the flip — the zero crossing of
  the total — where a by-strike bar chart only
  interpolates between two bars). The book's cells
  are re-priced at hypothetical spots: a cell's
  figure stands on gamma × open interest × spot² at
  the spot it was figured at, so at another spot it
  is that figure scaled by how Black-Scholes gamma
  and spot² move — its date's time and at-the-money
  vol, the one thing a cell needs that the surface
  already carries. No open interest is re-read, no
  side re-assumed: the sign is the cell's own.

  Per drawn expiry and in total, over a band of
  spots round the current one; the flip is the
  total's zero crossing nearest spot, interpolated.
==================================================
*/

import { blackScholesGreeks } from '../core/greeks';
import type { ExposureSurface } from './exposureSurface';

export interface CurvePoint {
  spot: number;
  /** The whole book's dealer gamma at this spot, the house's sign (positive amplifies, negative absorbs) */
  total: number;
  /** One figure per drawn expiry, in `expiries` order */
  byExpiry: number[];
}

export interface ExposureCurve {
  points: CurvePoint[];
  /** The spot the book was figured at */
  spot: number;
  /** The expiries drawn, as surface indices */
  expiries: number[];
  /** Where the total crosses zero nearest spot — null when it never does on the band */
  flip: number | null;
  /** The largest |figure| on the curve, the total or a date */
  maxAbs: number;
  /** The total at the current spot */
  atSpot: number;
}

/** Spots each side of the current one, as a fraction, unless the book's strikes reach further */
const SPAN_MIN = 0.04;
const SPAN_MAX = 0.15;
const STEPS = 81;

export function buildExposureCurve(surface: ExposureSurface, expiries: number[], opts: { span?: number; steps?: number } = {}): ExposureCurve {
  const S0 = surface.spot;
  const strikes = surface.strikes;
  const lo = strikes[0] ?? S0;
  const hi = strikes[strikes.length - 1] ?? S0;
  const reach = Math.max(S0 - lo, hi - S0) / Math.max(1e-9, S0);
  const span = opts.span ?? Math.min(SPAN_MAX, Math.max(SPAN_MIN, reach));
  const steps = Math.max(11, opts.steps ?? STEPS);
  const drawn = expiries.filter(e => e >= 0 && e < surface.expiries.length);

  /* each cell as (strike, its figure over gamma·spot²·100·1% at the current spot) — the contracts' net, what scales it
     to another spot. BOUNDED BY THE CELL'S OPEN INTEREST: a modeled far cell (the house's desk legs are anchored to the
     front, not priced one by one) keeps a figure where Black-Scholes gamma has all but vanished, and the ratio ran to
     trillions at the band's edge on the first cut; the net can never be more contracts than are open there. A cell
     with no count to bound it is skipped once its gamma at spot is a millionth of the at-the-money's. */
  const cells: { e: number; k: number; t: number; v: number; eff: number }[] = [];
  for (const e of drawn) {
    const ex = surface.expiries[e];
    const t = Math.max(0.5, ex.sessions) / 252;
    const v = Math.max(0.01, ex.iv);
    const row = surface.net.gex[e] ?? [];
    const oiRow = surface.oi[e] ?? [];
    const atm = blackScholesGreeks(S0, S0, t, v).gamma * S0 * S0 * 100 * 0.01;
    for (let s = 0; s < strikes.length; s++) {
      const fig = row[s] ?? 0;
      if (!fig) continue;
      const g0 = blackScholesGreeks(S0, strikes[s], t, v).gamma;
      const base = g0 * S0 * S0 * 100 * 0.01;
      if (!(base > 0)) continue;
      const oi = oiRow[s];
      let eff = fig / base;
      if (Number.isFinite(oi) && oi > 0) eff = Math.max(-oi, Math.min(oi, eff));
      else if (base < atm * 1e-6) continue;
      cells.push({ e, k: strikes[s], t, v, eff });
    }
  }

  const points: CurvePoint[] = [];
  let maxAbs = 1;
  for (let i = 0; i < steps; i++) {
    const S = S0 * (1 - span + (2 * span * i) / (steps - 1));
    const byExpiry = drawn.map(() => 0);
    for (const c of cells) {
      const g = blackScholesGreeks(S, c.k, c.t, c.v).gamma;
      byExpiry[drawn.indexOf(c.e)] += c.eff * g * S * S * 100 * 0.01;
    }
    const total = byExpiry.reduce((a, b) => a + b, 0);
    for (const b of byExpiry) maxAbs = Math.max(maxAbs, Math.abs(b));
    maxAbs = Math.max(maxAbs, Math.abs(total));
    points.push({ spot: S, total, byExpiry });
  }

  /* the flip: the total's zero crossing nearest spot, between its two points */
  let flip: number | null = null;
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.sign(a.total) === Math.sign(b.total) || a.total === b.total) continue;
    const x = a.spot + ((0 - a.total) * (b.spot - a.spot)) / (b.total - a.total);
    const d = Math.abs(x - S0);
    if (d < best) {
      best = d;
      flip = x;
    }
  }
  /* the total at spot, read off the nearest point */
  const near = points.reduce((p, q) => (Math.abs(q.spot - S0) < Math.abs(p.spot - S0) ? q : p), points[0]);
  return { points, spot: S0, expiries: drawn, flip, maxAbs, atSpot: near?.total ?? 0 };
}
