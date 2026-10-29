/* Dealer gamma as a function of spot. On a live book each drawn date is re-priced with the flip's own legs (data/flipLevel.ts
   datesNetAt), so the curve's zero over the levels' dates IS the flip; off the live book each cell is scaled by how
   Black-Scholes gamma × spot² moves at its date's time and ATM vol. The zero is the total's crossing nearest spot. */

import { blackScholesGreeks } from '../core/greeks';
import { datesNetAt } from './flipLevel';
import type { ExposureSurface } from './exposureSurface';

interface CurvePoint {
  spot: number;
  /** The whole book's dealer gamma at this spot, the house's sign (positive amplifies, negative absorbs) */
  total: number;
  /** One figure per drawn expiry, in `expiries` order */
  byExpiry: number[];
}

interface ExposureCurve {
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

  /* Each cell as (strike, its figure over gamma·spot²·100·1% at current spot), bounded by its open interest so a far cell's vanishing gamma
     cannot blow the ratio up; a cell with no count is skipped below 1e-6 of the ATM gamma. */
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
      /* No open interest to bound it: skip a cell whose gamma at spot is under 1% of the ATM's (its ratio explodes). */
      else if (base < atm * 1e-2) continue;
      cells.push({ e, k: strikes[s], t, v, eff });
    }
  }

  const points: CurvePoint[] = [];
  let maxAbs = 1;
  const grid = Array.from({ length: steps }, (_, i) => S0 * (1 - span + (2 * span * i) / (steps - 1)));
  /* the live book: every drawn date through the flip's own legs */
  const book = surface.book;
  const isos = drawn.map(e => surface.expiries[e]?.iso);
  if (book?.liveBook && isos.every((d): d is string => !!d)) {
    const paths = datesNetAt(book, isos as string[], [...grid, S0]);
    if (paths.every(p => p != null)) {
      const at = (i: number) => (paths as number[][]).map(p => p[i]);
      for (let i = 0; i < steps; i++) {
        const byExpiry = at(i);
        const total = byExpiry.reduce((a, b) => a + b, 0);
        for (const b of byExpiry) maxAbs = Math.max(maxAbs, Math.abs(b));
        maxAbs = Math.max(maxAbs, Math.abs(total));
        points.push({ spot: grid[i], total, byExpiry });
      }
      const atSpot = at(steps).reduce((a, b) => a + b, 0);
      return { points, spot: S0, expiries: drawn, flip: zeroOf(points, S0, surface.book!, isos as string[]), maxAbs, atSpot };
    }
  }
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

  /* the zero: the total's crossing nearest spot, between its two points */
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

/** The live curve's zero nearest spot: the bracketing grid step re-priced on a fine grid, then read between its points */
function zeroOf(points: readonly CurvePoint[], S0: number, book: NonNullable<ExposureSurface['book']>, isos: string[]): number | null {
  let best: [number, number] | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.sign(a.total) === Math.sign(b.total) || a.total === b.total) continue;
    const mid = (a.spot + b.spot) / 2;
    if (!best || Math.abs(mid - S0) < Math.abs((best[0] + best[1]) / 2 - S0)) best = [a.spot, b.spot];
  }
  if (!best) return null;
  const N = 64;
  const fine = Array.from({ length: N + 1 }, (_, i) => best![0] + ((best![1] - best![0]) * i) / N);
  const paths = datesNetAt(book, isos, fine);
  if (!paths.every(p => p != null)) return null;
  const tot = fine.map((_, i) => (paths as number[][]).reduce((a, p) => a + p[i], 0));
  for (let i = 1; i <= N; i++) {
    if (Math.sign(tot[i - 1]) === Math.sign(tot[i]) || tot[i - 1] === tot[i]) continue;
    return fine[i - 1] + ((0 - tot[i - 1]) * (fine[i] - fine[i - 1])) / (tot[i] - tot[i - 1]);
  }
  return null;
}
