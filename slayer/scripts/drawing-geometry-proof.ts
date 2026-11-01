/*
  The phase-one drawing tools' arithmetic (src/components/gex/drawingGeometry.ts) holds to the textbook:
    - fib retracement levels, fib time zones (the Fibonacci numbers), the golden spiral's growth by φ a quarter turn;
    - each pitchfork's median origin (Andrews, Schiff, modified Schiff), the tines through B and C, all parallel;
    - the Gann fan's angles as price : time against the 1×1, each pair reciprocal;
    - XABCD / ABCD / three drives leg ratios on a textbook Gartley and an AB=CD;
    - the regression trend, the trend angle, the arc's circle, Shift's 45° constrain and the magnet's pick;
    - each pattern's pivot count (the gesture seals on it).
  Run:  npx tsx scripts/drawing-geometry-proof.ts
*/
import {
  FIB_TIME_ZONES,
  GANN_FAN,
  PHI,
  abcdRatios,
  circleThrough,
  fibRetracePrice,
  fibSpiral,
  forkLines,
  forkMedian,
  gannDir,
  intersect,
  legRatio,
  magnetPick,
  regression,
  screenAngle,
  snap45,
  threeDrivesRatios,
  xabcdRatios,
  type Pt,
} from '../src/components/gex/drawingGeometry';
import { PATTERN_POINTS } from '../src/components/gex/drawingKindsMore';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) <= eps;
const nearPt = (a: Pt, b: Pt, eps = 1e-9) => near(a[0], b[0], eps) && near(a[1], b[1], eps);
const cross = (u: Pt, v: Pt) => u[0] * v[1] - u[1] * v[0];

// ---- Fibonacci ----
check('retracement 61.8% of a 100 → 200 move is 138.2', near(fibRetracePrice(100, 200, 0.618), 138.2, 1e-9));
check('retracement 0 is the move\'s end, 1 its start', near(fibRetracePrice(100, 200, 0), 200) && near(fibRetracePrice(100, 200, 1), 100));
const z = FIB_TIME_ZONES as readonly number[];
check('time zones are the Fibonacci numbers', z.slice(3).every((n, i) => n === z[i + 2] + z[i + 1]), z.join(','));
const sp = fibSpiral([0, 0], [10, 0], 24);
const rAt = (i: number) => Math.hypot(sp[i][0], sp[i][1]);
/* 24 steps a quarter turn over seven quarter turns, from four inward: index 96 is θ = 0, where it passes the anchor */
const i0 = 96;
check('the spiral passes through its anchor at θ = 0', nearPt(sp[i0], [10, 0], 1e-6), JSON.stringify(sp[i0]));
check('the spiral grows by φ every quarter turn', near(rAt(120) / rAt(96), PHI, 1e-9) && near(rAt(96) / rAt(72), PHI, 1e-9), String(rAt(120) / rAt(96)));

// ---- pitchforks ----
const A: Pt = [0, 100];
const B: Pt = [10, 60];
const C: Pt = [20, 80];
const M: Pt = [15, 70];
const std = forkMedian(A, B, C, 'standard');
check('Andrews: the median runs from A to the midpoint of B and C', nearPt(std.o, A) && nearPt(std.m, M));
check('Schiff: the median starts at A\'s bar, halfway between A and B in price', nearPt(forkMedian(A, B, C, 'schiff').o, [0, 80]));
check('modified Schiff: the median starts at the midpoint of A and B', nearPt(forkMedian(A, B, C, 'mschiff').o, [5, 80]));
for (const v of ['standard', 'schiff', 'mschiff'] as const) {
  const ls = forkLines(A, B, C, v);
  const lo = ls.find(l => l.level === -0.5)!;
  const hi = ls.find(l => l.level === 0.5)!;
  const med = ls.find(l => l.level === 0)!;
  check(`${v}: tines through B and C`, nearPt(lo.from, B) && nearPt(hi.from, C));
  check(`${v}: every line parallel to the median`, ls.every(l => near(cross(l.dir, med.dir), 0)));
  const outer = ls.find(l => l.level === 1)!;
  check(`${v}: the warning line sits a full B–C spread off the median`, nearPt(outer.from, [M[0] + (C[0] - B[0]), M[1] + (C[1] - B[1])]));
}

// ---- Gann ----
check('the fan has nine angles, 8/1 to 1/8', GANN_FAN.length === 9 && GANN_FAN[0].name === '8/1' && GANN_FAN[8].name === '1/8');
const dx = 10;
const dy = -5;
const one = GANN_FAN.find(g => g.name === '1/1')!;
check('1/1 is the anchors\' own line', nearPt(gannDir(dx, dy, one.p, one.t), [dx, dy]));
const slope = (g: { p: number; t: number }) => {
  const d = gannDir(dx, dy, g.p, g.t);
  return d[1] / d[0];
};
check('2/1 rises twice as fast as 1/1', near(slope({ p: 2, t: 1 }), 2 * slope(one)));
check('each pair is reciprocal: slope(p/t) · slope(t/p) = slope(1/1)²', GANN_FAN.every(g => near(slope(g) * slope({ p: g.t, t: g.p }), slope(one) ** 2)));

// ---- patterns ----
/* a textbook bullish Gartley: AB = 0.618 XA, BC = 0.618 AB, D at 0.786 of XA */
const X = 100;
const Ap = 200;
const Bp = Ap - 0.618 * (Ap - X);
const Cp = Bp + 0.618 * (Ap - Bp);
const Dp = Ap - 0.786 * (Ap - X);
const g = xabcdRatios(X, Ap, Bp, Cp, Dp);
check('Gartley: B retraces 0.618 of XA', near(g.ab, 0.618, 1e-12));
check('Gartley: C retraces 0.618 of AB', near(g.bc, 0.618, 1e-12));
check('Gartley: D sits at 0.786 of XA', near(g.xd, 0.786, 1e-12));
check('Gartley: CD extends BC by |D−C| / |C−B|', near(g.cd, Math.abs(Dp - Cp) / Math.abs(Cp - Bp), 1e-12));
const ab = abcdRatios(100, 150, 125, 175);
check('AB=CD: C retraces half of AB, CD is twice BC', near(ab.bc, 0.5) && near(ab.cd, 2));
const td = threeDrivesRatios([100, 130, 115, 145, 130, 160, 145]);
check('three drives: each pullback 0.5 of its drive, each drive 2× its pullback', near(td[0], 0.5) && near(td[1], 2) && near(td[2], 0.5) && near(td[3], 2) && near(td[4], 0.5), td.join(','));
check('a leg of zero has no ratio', legRatio(5, 5, 7) === null);
check('XABCD takes 5 presses, ABCD 4, head and shoulders 7, three drives 7', PATTERN_POINTS.xabcd === 5 && PATTERN_POINTS.abcd === 4 && PATTERN_POINTS.hs === 7 && PATTERN_POINTS.threedrives === 7);
check('Elliott impulse takes 6 (0–5), correction 4 (0, A, B, C), the triangle 4', PATTERN_POINTS.elliott5 === 6 && PATTERN_POINTS.elliott3 === 4 && PATTERN_POINTS.tripattern === 4);
check('two converging sides meet where they should', nearPt(intersect([0, 0], [10, 10], [0, 10], [10, 0])!, [5, 5]));
check('parallel sides never meet', intersect([0, 0], [10, 10], [0, 1], [10, 11]) === null);

// ---- regression, angle, arc, constrain, magnet ----
const xs = [0, 1, 2, 3, 4, 5];
const r = regression(xs, xs.map(x => 2 * x + 1));
check('regression of an exact line is the line, σ 0', !!r && near(r.slope, 2) && near(r.icept, 1) && near(r.sd, 0));
const r2 = regression([0, 1, 2, 3], [1, 3, 1, 3]);
check('regression σ of an alternating tape is its spread', !!r2 && near(r2.sd, Math.sqrt(0.8), 1e-9), JSON.stringify(r2));
check('the trend angle reads 45° up a rising diagonal', near(screenAngle([0, 0], [10, -10]), 45));
check('…and −45° down a falling one', near(screenAngle([0, 0], [10, 10]), -45));
const k = circleThrough([10, 0], [0, 10], [-10, 0]);
check('the arc\'s circle through three points', !!k && nearPt(k.c, [0, 0], 1e-9) && near(k.r, 10));
check('three points in a line make no arc', circleThrough([0, 0], [1, 1], [2, 2]) === null);
check('Shift holds a shallow line flat', nearPt(snap45([0, 0], [10, 1]), [10, 0]));
check('Shift holds a steep line upright', nearPt(snap45([0, 0], [1, 10]), [0, 10]));
check('Shift holds a near-diagonal at 45°', nearPt(snap45([0, 0], [10, 9]), [10, 10]));
check('the strong magnet takes the nearest of open, high, low, close', magnetPick([50, 20, 80, 60], 25, null) === 1);
check('the weak magnet lets go beyond its reach', magnetPick([50, 20, 80, 60], 35, 10) === null);

console.log(fail ? `\n${fail} FAILED` : '\nall drawing geometry holds');
process.exit(fail ? 1 : 0);
