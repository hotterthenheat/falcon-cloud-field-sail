/* The arithmetic under the phase-1 drawing tools (drawingKindsMore.ts): fib levels, pitchfork medians, Gann ratios, the
   harmonic patterns' leg ratios, the regression channel. Pure — no canvas, no chart — so scripts/drawing-geometry-proof.ts
   can hold every number a tool prints to the textbook value. Points are [x, y] in any one linear space (screen pixels
   for what is drawn, or bar-index × price for what is printed). */

export type Pt = [number, number];

// ---- Fibonacci -----------------------------------------------------------------------------------

/** The retracement's levels, top of the move (0) to its start (1) — the house fib tool's own set */
export const FIB_RETRACE = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
/** A retracement level's price: `r` of the way back from the move's end (p2) toward its start (p1) */
export const fibRetracePrice = (p1: number, p2: number, r: number): number => p2 - (p2 - p1) * r;

/** Fib time zones: bars from the first anchor, in units of the anchors' span — the Fibonacci numbers */
export const FIB_TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;

/** The speed resistance fan's and the Gann box's divisions of a side */
export const FIB_FAN = [0.25, 0.382, 0.5, 0.618, 0.75] as const;
export const GANN_BOX = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1] as const;

/** Fib circles' radii, in units of the anchors' distance */
export const FIB_CIRCLES = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618] as const;

/** Fib wedge: arcs at these fractions of the first leg's length */
export const FIB_WEDGE = [0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** The golden ratio — the spiral grows by φ every quarter turn */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** A golden spiral round `c`, through `p` at θ = 0, unwinding outward by φ every quarter turn; inward to 1/φ⁴ of the radius, out to φ³ */
export function fibSpiral(c: Pt, p: Pt, perQuarter = 24): Pt[] {
  const steps = 7 * perQuarter;
  const r0 = Math.hypot(p[0] - c[0], p[1] - c[1]);
  if (r0 === 0) return [c];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  const out: Pt[] = [];
  const t0 = -4 * (Math.PI / 2);
  const t1 = 3 * (Math.PI / 2);
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const r = r0 * Math.pow(PHI, t / (Math.PI / 2));
    out.push([c[0] + r * Math.cos(a0 - t), c[1] + r * Math.sin(a0 - t)]);
  }
  return out;
}

// ---- pitchforks ------------------------------------------------------------------------------------

export type ForkVariant = 'standard' | 'schiff' | 'mschiff';

/** Where a pitchfork's median starts and where it aims, for three pivots A (p1), B (p2), C (p3):
      standard (Andrews)  from A to the midpoint of B and C
      Schiff              from A's time at the price halfway between A and B
      modified Schiff     from the midpoint of A and B, in time and price
    Every variant aims at the midpoint of B and C; the tines run parallel to the median through B and C. */
export function forkMedian(a: Pt, b: Pt, c: Pt, v: ForkVariant): { o: Pt; m: Pt } {
  const m: Pt = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  if (v === 'schiff') return { o: [a[0], (a[1] + b[1]) / 2], m };
  if (v === 'mschiff') return { o: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m };
  return { o: a, m };
}

/** The fork's lines as origin + direction: the median, the two tines (±0.5 of the B–C spread) and the warning lines (±1) */
export function forkLines(a: Pt, b: Pt, c: Pt, v: ForkVariant): { level: number; from: Pt; dir: Pt }[] {
  const { o, m } = forkMedian(a, b, c, v);
  const dir: Pt = [m[0] - o[0], m[1] - o[1]];
  const half: Pt = [(c[0] - b[0]) / 2, (c[1] - b[1]) / 2];
  return [-1, -0.5, 0, 0.5, 1].map(level => ({ level, from: [m[0] + half[0] * level * 2, m[1] + half[1] * level * 2] as Pt, dir }));
}

/** Where a line from `from` along `dir` reaches x = `xe` (the pane's right edge); null for a line with no run */
export function lineAtX(from: Pt, dir: Pt, xe: number): Pt | null {
  if (dir[0] === 0) return null;
  const t = (xe - from[0]) / dir[0];
  return [xe, from[1] + dir[1] * t];
}

// ---- Gann ------------------------------------------------------------------------------------------

/** The Gann fan's angles, as price units : time units against the 1×1 the anchors set — steepest first */
export const GANN_FAN: { name: string; p: number; t: number }[] = [
  { name: '8/1', p: 8, t: 1 },
  { name: '4/1', p: 4, t: 1 },
  { name: '3/1', p: 3, t: 1 },
  { name: '2/1', p: 2, t: 1 },
  { name: '1/1', p: 1, t: 1 },
  { name: '1/2', p: 1, t: 2 },
  { name: '1/3', p: 1, t: 3 },
  { name: '1/4', p: 1, t: 4 },
  { name: '1/8', p: 1, t: 8 },
];

/** A Gann fan line's direction from the origin: the 1×1 vector (dx, dy) with its rise scaled p/t */
export const gannDir = (dx: number, dy: number, p: number, t: number): Pt => [dx, (dy * p) / t];

// ---- patterns -----------------------------------------------------------------------------------------

/** |b − c| / |a − b| on one axis — how much of the leg a→b the next leg b→c covers (a retracement below 1, an extension above) */
export function legRatio(a: number, b: number, c: number): number | null {
  const leg = b - a;
  if (leg === 0) return null;
  return Math.abs(c - b) / Math.abs(leg);
}

/** XABCD's four printed ratios off the five pivots' prices: B retraces XA, C retraces AB, D extends BC, D retraces XA */
export function xabcdRatios(x: number, a: number, b: number, c: number, d: number): { ab: number | null; bc: number | null; cd: number | null; xd: number | null } {
  return { ab: legRatio(x, a, b), bc: legRatio(a, b, c), cd: legRatio(b, c, d), xd: legRatio(x, a, d) };
}

/** ABCD's two: C retraces AB, D extends BC */
export function abcdRatios(a: number, b: number, c: number, d: number): { bc: number | null; cd: number | null } {
  return { bc: legRatio(a, b, c), cd: legRatio(b, c, d) };
}

/** Three drives off seven pivots (start, drive 1, pullback, drive 2, pullback, drive 3 …): each pullback against its drive, each drive against its pullback */
export function threeDrivesRatios(p: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 2; i < p.length; i++) out.push(legRatio(p[i - 2], p[i - 1], p[i]));
  return out;
}

/** A ratio as the patterns print it */
export const fmtRatio = (r: number | null): string => (r === null || !Number.isFinite(r) ? '—' : r.toFixed(3));

/** Where two lines (a1→a2, b1→b2) cross; null when parallel */
export function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
}

// ---- regression -------------------------------------------------------------------------------------

/** Least squares of y on x, with the residuals' standard deviation — the regression trend's centre and its ±k·σ */
export function regression(xs: number[], ys: number[]): { slope: number; icept: number; sd: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const icept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (icept + slope * xs[i])) ** 2;
  return { slope, icept, sd: Math.sqrt(ss / n) };
}

// ---- angles and arcs ----------------------------------------------------------------------------------

/** The trend angle as the eye reads it: degrees above the horizontal on screen (y grows downward), −180…180 */
export const screenAngle = (a: Pt, b: Pt): number => (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI;

/** The circle through three points — the arc tool's; null when they are in a line */
export function circleThrough(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Shift-constrain: the end of a line from `a` snapped to the nearest 45° (horizontal, vertical, diagonal) */
export function snap45(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return b;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  /* horizontal and vertical keep the pointer's own run; the diagonals keep the longer side */
  if (Math.abs(Math.sin(ang)) < 1e-9) return [b[0], a[1]];
  if (Math.abs(Math.cos(ang)) < 1e-9) return [a[0], b[1]];
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(Math.cos(ang)) * s, a[1] + Math.sign(Math.sin(ang)) * s];
}

/** Magnet: of a bar's open, high, low and close, the one nearest the pointer's y — or null when the weak magnet finds none within `reach` px */
export function magnetPick(ys: number[], y: number, reach: number | null): number | null {
  let best = -1;
  let bd = Infinity;
  ys.forEach((v, i) => {
    const dd = Math.abs(v - y);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  if (best < 0) return null;
  if (reach !== null && bd > reach) return null;
  return best;
}
