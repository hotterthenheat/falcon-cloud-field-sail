/*
  THE AUTO LEVELS (src/data/tvLevels.ts) against hand-worked figures: the six pivot formulas on one previous bar
  (H 110, L 100, C 105, O 102; the current open 106 for Woodie), the periods on the session module's clock (the
  overnight joins the morning, a week starts Monday, "regular hours only" drops a pre-market spike), the swings, the
  zig zag at three deviations, its live leg and leg volumes, the Fib retracement and extension over its legs, the
  three pitchforks.
  Run: npx tsx scripts/tv-levels-proof.ts
*/
import { nyInstant } from '../shared/marketSession.mjs';
import {
  atrSeries,
  autoFibExtension,
  autoFibRetracement,
  autoPitchfork,
  forkAt,
  periodKey,
  pivotLevels,
  pivotPeriods,
  resolvePivotTf,
  swings,
  zigzag,
  zigzagTail,
  type LevelBar,
} from '../src/data/tvLevels';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
};
const near = (a: number, b: number, msg: string, tol = 1e-9) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const lv = (levels: { name: string; price: number }[]) => Object.fromEntries(levels.map(l => [l.name, l.price]));

/* ---- the six formulas ---- */
const prev = { open: 102, high: 110, low: 100, close: 105 };
const T = lv(pivotLevels('Traditional', prev, 106));
for (const [k, v] of Object.entries({ P: 105, R1: 110, S1: 100, R2: 115, S2: 95, R3: 120, S3: 90, R4: 125, S4: 85, R5: 130, S5: 80 })) near(T[k], v, `Traditional ${k}`);
const F = lv(pivotLevels('Fibonacci', prev, 106));
for (const [k, v] of Object.entries({ P: 105, R1: 108.82, S1: 101.18, R2: 111.18, S2: 98.82, R3: 115, S3: 95 })) near(F[k], v, `Fibonacci ${k}`, 1e-9);
const W = lv(pivotLevels('Woodie', prev, 106));
for (const [k, v] of Object.entries({ P: 105.5, R1: 111, S1: 101, R2: 115.5, S2: 95.5, R3: 121, S3: 91, R4: 131, S4: 81 })) near(W[k], v, `Woodie ${k}`);
const Cl = lv(pivotLevels('Classic', prev, 106));
for (const [k, v] of Object.entries({ P: 105, R1: 110, S1: 100, R2: 115, S2: 95, R3: 125, S3: 85, R4: 135, S4: 75 })) near(Cl[k], v, `Classic ${k}`);
const D = lv(pivotLevels('DM', prev, 106));
for (const [k, v] of Object.entries({ P: 106.25, R1: 112.5, S1: 102.5 })) near(D[k], v, `DM ${k} (close above open: X = 2H + L + C = 425)`);
near(lv(pivotLevels('DM', { ...prev, close: 102 }, 106)).P, (110 + 100 + 204) / 4, 'DM P when close equals open: (H + L + 2C) / 4');
near(lv(pivotLevels('DM', { ...prev, close: 101 }, 106)).P, (200 + 110 + 101) / 4, 'DM P when close below open: (2L + H + C) / 4');
const Ca = lv(pivotLevels('Camarilla', prev, 106));
for (const [k, v] of Object.entries({ P: 105, R1: 105 + 11 / 12, S1: 105 - 11 / 12, R2: 105 + 11 / 6, S2: 105 - 11 / 6, R3: 107.75, S3: 102.25, R4: 110.5, S4: 99.5, R5: 115.5, S5: 94.5 })) near(Ca[k], v, `Camarilla ${k}`, 1e-9);
ok(pivotLevels('Traditional', prev, 0).length === 11 && pivotLevels('Fibonacci', prev, 0).length === 7 && pivotLevels('Woodie', prev, 0).length === 9 && pivotLevels('Classic', prev, 0).length === 9 && pivotLevels('DM', prev, 0).length === 3 && pivotLevels('Camarilla', prev, 0).length === 11, 'level counts 11 / 7 / 9 / 9 / 3 / 11');

/* ---- the periods ---- */
const at = (iso: string, h: number, m = 0) => nyInstant(iso, h * 60 + m) / 1000;
ok(resolvePivotTf('Auto', 5) === 'Daily' && resolvePivotTf('Auto', 15) === 'Daily' && resolvePivotTf('Auto', 30) === 'Weekly' && resolvePivotTf('Auto', 240) === 'Weekly' && resolvePivotTf('Auto', 1440) === 'Monthly', 'Auto: day to 15m, week to the day, month from the day');
ok(periodKey(at('2026-10-28', 10), 'Daily') === '2026-10-28', 'a regular-session bar is its own day');
ok(periodKey(at('2026-10-27', 22), 'Daily') === '2026-10-28', 'the overnight joins the morning it opens into');
ok(periodKey(at('2026-10-28', 10), 'Weekly') === '2026-10-26', 'a Wednesday belongs to Monday’s week');
ok(periodKey(at('2026-11-02', 10), 'Weekly') === '2026-11-02', 'a Monday starts its own week');
ok(periodKey(at('2026-10-28', 10), 'Monthly') === '2026-10' && periodKey(at('2026-10-28', 10), 'Quarterly') === '2026-Q4' && periodKey(at('2026-10-28', 10), 'Yearly') === '2026', 'month, quarter, year');

/* two days of 30-minute bars; day one has a pre-market spike to 120 that the regular-hours build must drop */
const bars: LevelBar[] = [];
const push = (t: number, o: number, h: number, l: number, c: number) => bars.push({ time: t, open: o, high: h, low: l, close: c, volume: 1000 });
push(at('2026-10-28', 8), 101, 120, 100.5, 101);
push(at('2026-10-28', 9, 30), 102, 108, 101, 107);
push(at('2026-10-28', 10), 107, 110, 100, 104);
push(at('2026-10-28', 15, 30), 104, 106, 103, 105);
push(at('2026-10-29', 9, 30), 106, 107, 105, 106.5);
push(at('2026-10-29', 10), 106.5, 108, 106, 107);
const reg = pivotPeriods(bars, { kind: 'Traditional', tf: 'Daily', barMinutes: 30, back: 15, regularOnly: true });
ok(reg.length === 1, `one period with a period before it (${reg.length})`);
near(lv(reg[0].levels).P, 105, 'regular hours: day two’s P from day one’s 110 / 100 / 105');
ok(reg[0].from === at('2026-10-29', 9, 30) && reg[0].to === at('2026-10-29', 10) && reg[0].live, 'day two spans its bars and is live');
const all = pivotPeriods(bars, { kind: 'Traditional', tf: 'Daily', barMinutes: 30, back: 15, regularOnly: false });
near(lv(all[0].levels).P, (120 + 100 + 105) / 3, 'every bar: the pre-market spike is the high');
const wood = pivotPeriods(bars, { kind: 'Woodie', tf: 'Daily', barMinutes: 30, back: 15, regularOnly: true });
near(lv(wood[0].levels).P, (110 + 100 + 2 * 106) / 4, 'Woodie reads day two’s open');

/* ---- swings and the zig zag ---- */
const hl: [number, number][] = [[10, 9], [12, 11], [11, 10], [9, 8], [10, 9], [13, 12], [14, 13], [12, 11], [12.5, 11.5], [11.8, 11.2], [15, 14]];
const zb: LevelBar[] = hl.map(([h, l], i) => ({ time: 1000 + i * 60, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 100 }));
ok(JSON.stringify(swings(zb, 1, 1, true).map(s => s.i)) === '[1,6,8]', 'swing highs at 1, 6, 8');
ok(JSON.stringify(swings(zb, 1, 1, false).map(s => s.i)) === '[3,7,9]', 'swing lows at 3, 7, 9');
const z5 = zigzag(zb, 5, 2);
ok(JSON.stringify(z5.map(p => p.i)) === '[1,3,6,7,8,9]', `5%: every swing is a point (${z5.map(p => p.i)})`);
const z20 = zigzag(zb, 20, 2);
ok(JSON.stringify(z20.map(p => p.i)) === '[1,3,6,7]', `20%: 12.5 and 11.2 move under 20% (${z20.map(p => p.i)})`);
const z25 = zigzag(zb, 25, 2);
ok(JSON.stringify(z25.map(p => p.i)) === '[1,3,6]', `25%: the 21% fall to 11 is ignored (${z25.map(p => p.i)})`);
near(z25[1].volume, 200, 'leg volume: bars 2–3');
near(z25[2].volume, 300, 'leg volume: bars 4–6');
near(z25[2].change, 6, 'leg change 8 → 14');
const tail = zigzagTail(zb, z25)!;
ok(tail.i === 7 && tail.price === 11 && !tail.high, 'the live leg runs to the lowest low since: 11 at bar 7');
/* a same-side swing past the last point moves it */
const moved = zigzag(zb.map((b, i) => (i === 8 ? { ...b, high: 14.5 } : b)), 25, 2);
ok(moved[moved.length - 1].i === 8 && moved[moved.length - 1].price === 14.5, 'a higher high replaces the last high');

/* ---- the Fib tools and the fork on the 20% zig zag: … 8 (bar 3), 14 (bar 6), 11 (bar 7) ---- */
const fib = autoFibRetracement(z20, [0, 0.618, 1])!;
near(fib.levels[0].price, 11, 'retracement 0 at the leg’s end');
near(fib.levels[1].price, 11 + 3 * 0.618, 'retracement 0.618');
near(fib.levels[2].price, 14, 'retracement 1 at the leg’s start');
near(autoFibRetracement(z20, [0], true)!.levels[0].price, 14, 'reversed: 0 at the start');
const ext = autoFibExtension(z20, [1, 1.618])!;
near(ext.levels[0].price, 17, 'extension 1: 11 + (14 − 8)');
near(ext.levels[1].price, 11 + 6 * 1.618, 'extension 1.618');
ok(ext.fromI === 7, 'the extension starts at the third point');
const fo = autoPitchfork(z20, 'Original')!;
near(fo.origin.price, 8, 'Original: the median starts at the first point');
near(fo.mid.i, 6.5, 'the median runs through the middle of the other two (bar)');
near(fo.mid.price, 12.5, 'the median runs through the middle of the other two (price)');
near(forkAt(fo, 6, 1), 14, 'the upper tine runs through the second point');
near(forkAt(fo, 7, -1), 11, 'the lower tine runs through the third point');
near(forkAt(fo, 6.5, 0), 12.5, 'the median at the midpoint');
const fs = autoPitchfork(z20, 'Schiff')!;
ok(fs.origin.i === 3, 'Schiff starts on the first point’s bar');
near(fs.origin.price, 11, 'Schiff starts halfway up to the second point');
near(fs.slope, 1.5 / 3.5, 'Schiff slope');
const fm = autoPitchfork(z20, 'Modified Schiff')!;
near(fm.origin.i, 4.5, 'Modified Schiff starts at the middle of the first two (bar)');
near(fm.origin.price, 11, 'Modified Schiff starts at the middle of the first two (price)');
ok(autoPitchfork(z20.slice(0, 2), 'Original') === null && autoFibExtension(z20.slice(0, 2), [1]) === null && autoFibRetracement(z20.slice(0, 1), [1]) === null, 'too few points: nothing drawn');

/* ---- ATR (Wilder), the auto tools' threshold ---- */
const atr = atrSeries(zb, 3);
ok(Number.isNaN(atr[1]), 'ATR blank before its length');
/* true ranges: bar 0 its range 1; bar 1 max(1, |12 − 9.5|, |11 − 9.5|) = 2.5; bar 2 max(1, |11 − 11.5|, |10 − 11.5|) = 1.5;
   bar 3 max(1, |9 − 10.5|, |8 − 10.5|) = 2.5 */
near(atr[2], (1 + 2.5 + 1.5) / 3, 'ATR seeds on the mean true range');
near(atr[3], (((1 + 2.5 + 1.5) / 3) * 2 + 2.5) / 3, 'ATR then smooths the Wilder way');

console.log(fail ? `tv levels: ${fail} FAILED` : 'tv levels: all hold');
process.exit(fail ? 1 : 0);
