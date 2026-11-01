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
export function forkLines(a: Pt, b: Pt, c: Pt, v: ForkVariant, levels: readonly number[] = [0.5, 1]): { level: number; from: Pt; dir: Pt }[] {
  const { o, m } = forkMedian(a, b, c, v);
  const dir: Pt = [m[0] - o[0], m[1] - o[1]];
  const half: Pt = [(c[0] - b[0]) / 2, (c[1] - b[1]) / 2];
  const all = [0, ...levels.flatMap(l => (l > 0 ? [l, -l] : []))].sort((x, y) => x - y);
  return all.map(level => ({ level, from: [m[0] + half[0] * level * 2, m[1] + half[1] * level * 2] as Pt, dir }));
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

/** Pearson's correlation of y on x — the regression trend's R; null when either side does not vary */
export function pearsonR(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
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

// ==== PHASE TWO (2026-11-01): the arithmetic under drawingKindsTv.ts ===================================================

/** The inside pitchfork (TradingView's help: the origin halfway between points 1 and 2, the median along them, point 3
    setting the spread): the median from the midpoint of A and B along A→B; each further line is the median moved by
    `level` of C's vertical offset from it, both sides */
export function insideForkLines(a: Pt, b: Pt, c: Pt, levels: readonly number[] = [0.5, 1]): { level: number; from: Pt; dir: Pt }[] {
  const o: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dir: Pt = [b[0] - a[0], b[1] - a[1]];
  const yAt = (x: number) => (dir[0] === 0 ? o[1] : o[1] + (dir[1] / dir[0]) * (x - o[0]));
  const off = c[1] - yAt(c[0]);
  const all = [0, ...levels.flatMap(l => (l > 0 ? [l, -l] : []))].sort((x, y) => x - y);
  return all.map(level => ({ level, from: [o[0], o[1] + off * level] as Pt, dir }));
}

/** The pitchfan: rays from A through the points `level` of the way from the B–C midpoint toward C (positive) or B
    (negative); ±1 pass through C and B, 0 is the pitchfork's median */
export function pitchfanTargets(b: Pt, c: Pt, levels: readonly number[]): { level: number; to: Pt }[] {
  const m: Pt = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const h: Pt = [(c[0] - b[0]) / 2, (c[1] - b[1]) / 2];
  const all = [0, ...levels.flatMap(l => (l > 0 ? [l, -l] : []))].sort((x, y) => x - y);
  return all.map(level => ({ level, to: [m[0] + h[0] * level, m[1] + h[1] * level] as Pt }));
}

/** Trend-based fib time: from the third point's bar, the first leg's bar span times each ratio (bar indices) */
export const tbFibTimeBars = (i1: number, i2: number, i3: number, levels: readonly number[]): number[] => levels.map(r => i3 + r * Math.abs(i2 - i1));

/** Cyclic lines and time cycles: every whole interval from the first anchor, inside [from, to] (bar indices) */
export function cycleBars(i1: number, i2: number, from: number, to: number, cap = 400): number[] {
  const s = Math.abs(i2 - i1);
  if (s === 0) return [i1];
  const out: number[] = [];
  let k = Math.max(0, Math.ceil((from - i1) / s));
  for (; out.length < cap; k++) {
    const i = i1 + k * s;
    if (i > to) break;
    out.push(i);
  }
  return out;
}

/** The sine line: point 1 a crest (or trough), point 2 the next trough (or crest) — half a period apart, the amplitude
    half their vertical distance. y at any x on the same axes. */
export function sineAt(x: number, a: Pt, b: Pt): number {
  const half = b[0] - a[0];
  const mid = (a[1] + b[1]) / 2;
  const amp = (a[1] - b[1]) / 2;
  if (half === 0) return mid;
  return mid + amp * Math.cos((Math.PI * (x - a[0])) / half);
}

/** Cypher (TradingView's help): B retraces XA (0.382–0.618), C extends XA (1.13–1.414, read |XC| / |XA|), D retraces
    the whole XC leg (0.786, read |CD| / |XC|) */
export function cypherRatios(x: number, a: number, b: number, c: number, d: number): { b: number | null; c: number | null; d: number | null } {
  const xa = Math.abs(a - x);
  const xc = Math.abs(c - x);
  return { b: xa === 0 ? null : Math.abs(b - a) / xa, c: xa === 0 ? null : xc / xa, d: xc === 0 ? null : Math.abs(d - c) / xc };
}

/** A long or short position's size (TradingView's account size, risk and lot size): the cash at risk, the quantity
    that risks it (whole lots), and what the target and the stop are worth at that quantity */
export function positionSize(account: number, riskPct: number, entry: number, stop: number, target: number, lot = 1): { riskCash: number; qty: number; rewardCash: number; lossCash: number } {
  const riskCash = (account * riskPct) / 100;
  const L = Math.max(lot, 1e-9);
  const per = Math.abs(entry - stop) * L;
  const qty = per > 0 ? Math.floor(riskCash / per + 1e-9) : 0;
  return { riskCash, qty, rewardCash: qty * Math.abs(target - entry) * L, lossCash: qty * Math.abs(entry - stop) * L };
}

/** A bar as the volume tools read it */
export interface VolBar {
  open?: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The volume profile (fixed range / anchored): each bar's volume spread evenly over the price rows its high–low covers
    (a bar with no range puts it all in its close's row), split up or down by its own candle (close ≥ open; without an
    open, against the previous close). The point of control is the fullest row; the value area grows from it one row at
    a time toward the fuller neighbour until it holds `vaPct` of the volume. */
export function volumeProfile(bars: VolBar[], rows = 24, vaPct = 70): { lo: number; hi: number; step: number; up: number[]; down: number[]; poc: number; vah: number; val: number; total: number } | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const n = Math.max(1, Math.min(500, Math.round(rows)));
  if (hi === lo) hi = lo + 1e-9;
  const step = (hi - lo) / n;
  const up = new Array<number>(n).fill(0);
  const down = new Array<number>(n).fill(0);
  const rowOf = (p: number) => Math.max(0, Math.min(n - 1, Math.floor((p - lo) / step)));
  bars.forEach((b, i) => {
    const v = b.volume > 0 ? b.volume : 0;
    if (v === 0) return;
    const ref = b.open ?? (i > 0 ? bars[i - 1].close : b.close);
    const into = b.close >= ref ? up : down;
    const span = b.high - b.low;
    if (span <= 0) {
      into[rowOf(b.close)] += v;
      return;
    }
    for (let r = rowOf(b.low); r <= rowOf(b.high); r++) {
      const a = Math.max(b.low, lo + r * step);
      const z = Math.min(b.high, lo + (r + 1) * step);
      if (z > a) into[r] += (v * (z - a)) / span;
    }
  });
  const tot = up.map((u, r) => u + down[r]);
  const total = tot.reduce((s, x) => s + x, 0);
  let poc = 0;
  tot.forEach((x, r) => {
    if (x > tot[poc]) poc = r;
  });
  let a = poc;
  let z = poc;
  let held = tot[poc];
  const want = (total * Math.max(0, Math.min(100, vaPct))) / 100;
  while (held < want - 1e-9 && (a > 0 || z < n - 1)) {
    const below = a > 0 ? tot[a - 1] : -1;
    const above = z < n - 1 ? tot[z + 1] : -1;
    if (above >= below) held += tot[++z];
    else held += tot[--a];
  }
  return { lo, hi, step, up, down, poc, vah: lo + (z + 1) * step, val: lo + a * step, total };
}

/** The anchored VWAP's price source (TradingView's: hlc3 by default) */
export type VwapSource = 'hlc3' | 'hl2' | 'ohlc4' | 'close';
export const vwapPrice = (b: VolBar, src: VwapSource): number =>
  src === 'close' ? b.close : src === 'hl2' ? (b.high + b.low) / 2 : src === 'ohlc4' ? ((b.open ?? b.close) + b.high + b.low + b.close) / 4 : (b.high + b.low + b.close) / 3;

/** The anchored VWAP and its standard deviation, bar by bar from the anchor: Σ(p·v)/Σv, and √(Σ(v·p²)/Σv − vwap²) */
export function vwapWithBands(bars: VolBar[], src: VwapSource = 'hlc3'): { v: number[]; sd: number[] } {
  const v: number[] = [];
  const sd: number[] = [];
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  for (const b of bars) {
    /* a bar with no volume still happened — it counts once, so a quiet tape draws a line */
    const w = b.volume > 0 ? b.volume : 1;
    const p = vwapPrice(b, src);
    pv += p * w;
    pv2 += p * p * w;
    vol += w;
    const m = pv / vol;
    v.push(m);
    sd.push(Math.sqrt(Math.max(0, pv2 / vol - m * m)));
  }
  return { v, sd };
}

/** The ghost feed's candles along a hand-drawn path of (bar index, price) points: one candle a bar; each opens at the
    last one's close and closes on the path; its wicks reach out so its high–low is the average range `avgHL`.
    Deterministic — a projection the reader drew, never invented prices. */
export function ghostCandles(path: Pt[], avgHL: number): { i: number; o: number; h: number; l: number; c: number }[] {
  if (path.length < 2) return [];
  const at = (i: number): number => {
    for (let k = 1; k < path.length; k++) {
      const [x0, y0] = path[k - 1];
      const [x1, y1] = path[k];
      if (i <= x1 || k === path.length - 1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (i - x0)) / (x1 - x0);
    }
    return path[path.length - 1][1];
  };
  const out: { i: number; o: number; h: number; l: number; c: number }[] = [];
  const i0 = Math.round(path[0][0]);
  const i1 = Math.round(path[path.length - 1][0]);
  let prev = path[0][1];
  for (let i = i0 + 1; i <= i1 && out.length < 600; i++) {
    const c = at(i);
    const o = prev;
    const pad = Math.max(0, (avgHL - Math.abs(c - o)) / 2);
    out.push({ i, o, h: Math.max(o, c) + pad, l: Math.min(o, c) - pad, c });
    prev = c;
  }
  return out;
}

/** The chart's own average bar range over its last `n` bars — the ghost feed's default */
export function avgRange(bars: VolBar[], n = 50): number {
  const s = bars.slice(-n);
  if (!s.length) return 0;
  return s.reduce((t, b) => t + (b.high - b.low), 0) / s.length;
}

/** Bars pattern: a copy of the bars between two anchors, set down from a third — its first bar at the third's bar and
    its first close at the third's price; mirrored turns it upside down round that price, flipped runs it backward */
export function barsPatternCopy(src: VolBar[], at: number, price: number, mirrored: boolean, flipped: boolean): { i: number; o: number; h: number; l: number; c: number }[] {
  if (!src.length) return [];
  const seq = flipped ? [...src].reverse() : src;
  /* the copy's first close sits on the third point: flipped, that close is the last bar's open */
  const base = flipped ? seq[0].open ?? seq[0].close : seq[0].close;
  const map = (p: number) => (mirrored ? price - (p - base) : price + (p - base));
  return seq.map((b, k) => {
    const o0 = flipped ? b.close : b.open ?? b.close;
    const c0 = flipped ? b.open ?? b.close : b.close;
    const hi = map(b.high);
    const lo = map(b.low);
    return { i: at + k, o: map(o0), h: Math.max(hi, lo), l: Math.min(hi, lo), c: map(c0) };
  });
}

/** The double curve: an S through both ends — a cubic whose first control is the third point and whose second is that
    point mirrored through the ends' midpoint, so the curve crosses the midpoint */
export function doubleCurve(a: Pt, b: Pt, c: Pt, steps = 40): Pt[] {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c2: Pt = [2 * m[0] - c[0], 2 * m[1] - c[1]];
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * c[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c[1] + 3 * u * t * t * c2[1] + t * t * t * b[1],
    ]);
  }
  return out;
}

/** Volume as the readouts print it */
export function fmtVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
