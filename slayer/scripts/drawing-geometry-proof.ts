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
  barsPatternCopy,
  cycleBars,
  cypherRatios,
  doubleCurve,
  fmtVolume,
  ghostCandles,
  insideForkLines,
  pearsonR,
  pitchfanTargets,
  positionSize,
  sineAt,
  tbFibTimeBars,
  volumeProfile,
  vwapPrice,
  vwapWithBands,
  type Pt,
} from '../src/components/gex/drawingGeometry';
import { PATTERN_POINTS } from '../src/components/gex/drawingKindsMore';
import { PATTERN_POINTS_TV, tableCells } from '../src/components/gex/drawingKindsTv';
import { gannName, levelsOf, opt, tfUnit, visibleOn } from '../src/components/gex/drawingLevels';

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

// ==== phase two ======================================================================================================
// ---- the inside pitchfork and the pitchfan ----
{
  const a: Pt = [0, 100];
  const b: Pt = [10, 80];
  const c: Pt = [10, 100];
  const ls = insideForkLines(a, b, c, [0.5, 1]);
  const med = ls.find(l => l.level === 0)!;
  check('inside pitchfork: the median starts halfway between points 1 and 2', nearPt(med.from, [5, 90]));
  check('inside pitchfork: every line runs along points 1 → 2', ls.every(l => near(cross(l.dir, [10, -20]), 0)));
  /* point 3 sits 20 above the median line at its own bar (the median at x = 10 is 80): ±1 is ±20, ±0.5 is ±10 */
  check('inside pitchfork: the lines sit at ±0.5 and ±1 of point 3’s offset', nearPt(ls.find(l => l.level === 1)!.from, [5, 110]) && nearPt(ls.find(l => l.level === -0.5)!.from, [5, 80]));
  const ts = pitchfanTargets([10, 60], [20, 80], [0.382, 1]);
  check('pitchfan: 0 aims at the B–C midpoint, +1 at C, −1 at B', nearPt(ts.find(t => t.level === 0)!.to, [15, 70]) && nearPt(ts.find(t => t.level === 1)!.to, [20, 80]) && nearPt(ts.find(t => t.level === -1)!.to, [10, 60]));
  check('pitchfan: 0.382 aims 38.2% of the way from the midpoint to C', nearPt(ts.find(t => t.level === 0.382)!.to, [15 + 5 * 0.382, 70 + 10 * 0.382], 1e-12));
}
// ---- trend-based fib time, cycles, sine ----
{
  const tb = tbFibTimeBars(0, 10, 20, [0, 0.618, 1, 1.618]);
  check('trend-based fib time: from point 3, the first leg’s 10 bars × each ratio', near(tb[0], 20) && near(tb[1], 26.18, 1e-9) && near(tb[2], 30) && near(tb[3], 36.18, 1e-9), tb.join(','));
  check('…and a leg drawn backward still counts forward', near(tbFibTimeBars(10, 0, 20, [1])[0], 30));
  const cy = cycleBars(5, 8, 0, 20);
  check('cyclic lines: every 3 bars from bar 5', cy.join(',') === '5,8,11,14,17,20', cy.join(','));
  check('cyclic lines: a window starting later skips the earlier cycles', cycleBars(5, 8, 12, 20).join(',') === '14,17,20');
  const A2: Pt = [10, 50];
  const B2: Pt = [30, 90];
  check('sine: passes through both anchors', near(sineAt(10, A2, B2), 50) && near(sineAt(30, A2, B2), 90));
  check('sine: a full period (twice the anchors’ gap) brings it back', near(sineAt(50, A2, B2), 50, 1e-9) && near(sineAt(20, A2, B2), 70, 1e-9));
}
// ---- Cypher ----
{
  const X2 = 100;
  const A3 = 200;
  const B3 = A3 - 0.5 * (A3 - X2);
  const C3 = X2 + 1.272 * (A3 - X2);
  const D3 = C3 - 0.786 * (C3 - X2);
  const r3 = cypherRatios(X2, A3, B3, C3, D3);
  check('Cypher: B retraces 0.5 of XA', near(r3.b, 0.5, 1e-12));
  check('Cypher: C extends XA to 1.272', near(r3.c, 1.272, 1e-12));
  check('Cypher: D retraces 0.786 of XC', near(r3.d, 0.786, 1e-12));
  check('Cypher takes 5 presses; Elliott triangle 6, double combo 4, triple combo 6', PATTERN_POINTS_TV.cypher === 5 && PATTERN_POINTS_TV.elliotttri === 6 && PATTERN_POINTS_TV.elliottwxy === 4 && PATTERN_POINTS_TV.elliottwxyxz === 6);
}
// ---- position size ----
{
  const ps = positionSize(10000, 1, 100, 98, 106);
  check('position: 1% of $10,000 risks $100; a $2 stop buys 50 shares', near(ps.riskCash, 100) && ps.qty === 50);
  check('position: the target is worth $300 and the stop $100 at that size', near(ps.rewardCash, 300) && near(ps.lossCash, 100));
  check('position: lots of 100 shares buy a whole lot or none', positionSize(10000, 1, 100, 98, 106, 100).qty === 0 && positionSize(100000, 1, 100, 98, 106, 100).qty === 5);
  check('position: no stop distance, no size', positionSize(10000, 1, 100, 100, 106).qty === 0);
}
// ---- volume profile ----
{
  const vp = volumeProfile(
    [
      { open: 10.2, high: 11, low: 10, close: 10.8, volume: 100 },
      { open: 11.8, high: 12, low: 11, close: 11.2, volume: 300 },
    ],
    2,
    70
  )!;
  check('profile: two rows of a dollar each from 10 to 12', near(vp.lo, 10) && near(vp.hi, 12) && near(vp.step, 1));
  check('profile: the rising bar’s 100 sits up in the low row, the falling bar’s 300 down in the high row', near(vp.up[0], 100) && near(vp.down[1], 300) && near(vp.up[1], 0) && near(vp.down[0], 0));
  check('profile: the point of control is the high row; 300 of 400 already fills a 70% value area', vp.poc === 1 && near(vp.vah, 12) && near(vp.val, 11));
  const flat = volumeProfile([{ open: 10, high: 12, low: 10, close: 12, volume: 200 }], 4, 70)!;
  check('profile: a bar spreads its volume evenly over the rows it spans', flat.up.every(u => near(u, 50)));
  check('profile: the value area grows to the fuller side until it holds the share', flat.vah - flat.val >= 1.5 - 1e-9);
  check('profile: no bars, no profile', volumeProfile([], 24, 70) === null);
}
// ---- anchored VWAP with bands ----
{
  const w = vwapWithBands([
    { high: 10, low: 10, close: 10, volume: 1 },
    { high: 20, low: 20, close: 20, volume: 3 },
  ]);
  check('VWAP: (10·1 + 20·3) / 4 = 17.5', near(w.v[1], 17.5));
  check('VWAP σ: √((100 + 1200)/4 − 17.5²) = √18.75', near(w.sd[1], Math.sqrt(18.75), 1e-12) && near(w.sd[0], 0));
  check('VWAP source: HL/2 and close read the bar their own way', near(vwapPrice({ high: 12, low: 8, close: 11, volume: 1 }, 'hl2'), 10) && near(vwapPrice({ high: 12, low: 8, close: 11, volume: 1 }, 'close'), 11));
}
// ---- ghost feed, bars pattern, double curve ----
{
  const g2 = ghostCandles([[0, 100], [4, 104]], 2);
  check('ghost feed: a candle a bar along the path', g2.length === 4 && g2.map(k => k.c).join(',') === '101,102,103,104');
  check('ghost feed: each opens on the last close and spans the average range', g2.every((k, i) => near(k.o, 100 + i) && near(k.h - k.l, 2)));
  const src = [
    { open: 10, high: 12, low: 9, close: 11, volume: 1 },
    { open: 11, high: 13, low: 10, close: 12, volume: 1 },
  ];
  const cp = barsPatternCopy(src, 50, 100, false, false);
  check('bars pattern: the copy starts at the third point’s bar and its first close at its price', cp[0].i === 50 && near(cp[0].c, 100) && near(cp[1].c, 101) && near(cp[1].h, 102));
  const mr = barsPatternCopy(src, 50, 100, true, false);
  check('bars pattern mirrored: the move turns upside down round the first close', near(mr[1].c, 99) && near(mr[1].h, 101) && near(mr[1].l, 98));
  const fl = barsPatternCopy(src, 0, 100, false, true);
  check('bars pattern flipped: it runs backward, each bar opening where it closed', near(fl[0].c, 100) && near(fl[0].o, 101) && near(fl[1].c, 99));
  const dc = doubleCurve([0, 0], [10, 0], [2, -8], 40);
  check('double curve: from end to end, through the midpoint', nearPt(dc[0], [0, 0]) && nearPt(dc[40], [10, 0]) && nearPt(dc[20], [5, 0], 1e-9));
  check('double curve: an S — one bend up, the other down', dc[10][1] < 0 && dc[30][1] > 0);
  check('the regression’s R of an exact rising line is 1', near(pearsonR([0, 1, 2], [1, 3, 5]), 1));
  check('volume words', fmtVolume(1234567) === '1.23M' && fmtVolume(45200) === '45.2K' && fmtVolume(812) === '812');
}
// ---- levels, inputs, visibility, the table ----
{
  check('fib retracement levels by default: 0 … 1, the extensions off', levelsOf({ kind: 'fib' }).join(',') === '0,0.236,0.382,0.5,0.618,0.786,1');
  check('a mark’s own levels replace its tool’s', levelsOf({ kind: 'fib', levels: [{ v: 0.5, on: true }, { v: 1.618, on: true }, { v: 0.618, on: false }] }).join(',') === '0.5,1.618');
  check('the Gann fan’s angles by name', levelsOf({ kind: 'gannfan' }).map(gannName).join(' ') === '1/8 1/4 1/3 1/2 1/1 2/1 3/1 4/1 8/1');
  check('a pitchfork draws ±0.5 and ±1 by default', levelsOf({ kind: 'pitchfork' }).join(',') === '0.5,1');
  check('an unset input reads its tool’s default', opt({ kind: 'long' }, 'account') === 10000 && opt({ kind: 'long', opts: { account: 500 } }, 'account') === 500);
  check('timeframes as intervals', JSON.stringify([tfUnit('15s'), tfUnit('45m'), tfUnit('4h'), tfUnit('3D'), tfUnit('1W'), tfUnit('6M'), tfUnit('1Y')]) === JSON.stringify([{ u: 'sec', n: 15 }, { u: 'min', n: 45 }, { u: 'hr', n: 4 }, { u: 'day', n: 3 }, { u: 'wk', n: 1 }, { u: 'mo', n: 6 }, { u: 'mo', n: 12 }]));
  const vis = { min: [1, 15] as [number, number], hr: false as const };
  check('visibility: minutes 1–15 show on 5m and 15m, not on 30m', visibleOn({ vis }, '5m') && visibleOn({ vis }, '15m') && !visibleOn({ vis }, '30m'));
  check('visibility: hours switched off hide it on 1h; days left alone show it', !visibleOn({ vis }, '1h') && visibleOn({ vis }, '1D'));
  check('visibility: the older one-timeframe choice still holds', visibleOn({ tf: '5m' }, '5m') && !visibleOn({ tf: '5m' }, '15m') && visibleOn({}, '15m'));
  check('table: a bar between cells, a semicolon between rows', JSON.stringify(tableCells('Entry | 450; Stop | 445 ;')) === JSON.stringify([['Entry', '450'], ['Stop', '445']]));
}

console.log(fail ? `\n${fail} FAILED` : '\nall drawing geometry holds');
process.exit(fail ? 1 : 0);
