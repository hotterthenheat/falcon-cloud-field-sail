/*
  The Ribbon look's math (src/components/gex/nodeRibbon.ts), known inputs in, known answers out:
    - the half-height runs t^1.6 from the hairline (A_MIN) to the swell, monotone, clamped, and never past the row's room;
    - the swell follows the bar: 60% of the bar spacing, floored at 3px, capped at 9px;
    - the stride keeps every drawn slot at least RIBBON_MIN_SLOT px wide;
    - the hue bin is floored at 0.2 and stays inside the bins;
    - the pick keeps a column's top N by size, drops cells under the strength floor and rows with no reading, and a
      strided group keeps its peak. Nothing is invented: an all-NaN grid picks nothing.
  Run:  npx tsx scripts/ribbon-proof.ts
*/
import { RIBBON_A_MIN, RIBBON_BINS, RIBBON_MIN_SLOT, ribbonAMax, ribbonAlpha, ribbonBin, ribbonHalf, ribbonPick, ribbonStride } from '../src/components/gex/nodeRibbon';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

/* amplitude */
const aMax = 9;
check('t=0 is the hairline', near(ribbonHalf(0, RIBBON_A_MIN, aMax), RIBBON_A_MIN));
check('t=1 is the swell', near(ribbonHalf(1, RIBBON_A_MIN, aMax), aMax));
check('t=0.5 is t^1.6 of the way', near(ribbonHalf(0.5, RIBBON_A_MIN, aMax), RIBBON_A_MIN + Math.pow(0.5, 1.6) * (aMax - RIBBON_A_MIN)));
check('t past 1 and negative clamp', near(ribbonHalf(3, RIBBON_A_MIN, aMax), aMax) && near(ribbonHalf(-1, RIBBON_A_MIN, aMax), RIBBON_A_MIN));
check('NaN strength is the hairline, not NaN', near(ribbonHalf(NaN, RIBBON_A_MIN, aMax), RIBBON_A_MIN));
let mono = true;
for (let i = 1; i <= 100; i++) if (ribbonHalf(i / 100, RIBBON_A_MIN, aMax) < ribbonHalf((i - 1) / 100, RIBBON_A_MIN, aMax)) mono = false;
check('half-height is monotone in t', mono);
check('a row with less room than the hairline still draws the hairline', near(ribbonHalf(1, RIBBON_A_MIN, 0.1), RIBBON_A_MIN));
check('weak cells stay thin: t=0.2 under a fifth of the swell', ribbonHalf(0.2, RIBBON_A_MIN, aMax) < aMax / 5);

/* swell by bar */
check('swell at 6px bars is 3.6', near(ribbonAMax(6), 3.6));
check('swell floor 3px', near(ribbonAMax(1), 3));
check('swell cap 9px', near(ribbonAMax(40), 9));

/* stride */
let slotOk = true;
for (const bs of [0.3, 0.5, 1, 1.4, 2, 2.9, 3, 6, 20]) {
  const k = ribbonStride(bs);
  if (bs * k < RIBBON_MIN_SLOT - 1e-9 || (k > 1 && bs * (k - 1) >= RIBBON_MIN_SLOT)) slotOk = false;
}
check('stride: the smallest k with a slot of at least 3px', slotOk);
check('stride is 1 on wide bars', ribbonStride(8) === 1);

/* hue bins and alpha */
check('bin floor: t=0 sits at 0.2 of the ramp', ribbonBin(0) === Math.round(0.2 * (RIBBON_BINS - 1)));
check('bin top', ribbonBin(1) === RIBBON_BINS - 1 && ribbonBin(9) === RIBBON_BINS - 1);
const a0 = ribbonAlpha(0);
const a1 = ribbonAlpha(1);
check('alpha translucent at the top (core < 0.7, halo < 0.2)', a1.core < 0.7 && a1.halo < 0.2 && a0.core > 0 && a0.halo > 0);

/* the pick */
const R = 6;
const C = 2;
const vals = new Float64Array(C * R).fill(NaN);
// column 0: rows 0..5
[10, -50, 3, 80, NaN, -20].forEach((v, r) => (vals[0 * R + r] = v));
// column 1: row 2 peaks in the group
[NaN, NaN, 90, NaN, NaN, NaN].forEach((v, r) => (vals[1 * R + r] = v));
const rows = new Int32Array(3);
const got = new Float64Array(3);
const n = ribbonPick(vals, R, 0, 1, 0, R, 100, 3, 0.08, rows, got);
check('top 3 by size, largest first', n === 3 && [...rows].join() === '3,1,5', `${n} ${[...rows].join()}`);
check('signs kept', got[0] === 80 && got[1] === -50 && got[2] === -20);
const n2 = ribbonPick(vals, R, 0, 1, 0, R, 100, 6, 0.08, new Int32Array(6), new Float64Array(6));
check('under the floor (3 < 8) and NaN rows drop', n2 === 4, String(n2));
const r3 = new Int32Array(1);
const v3 = new Float64Array(1);
ribbonPick(vals, R, 0, 2, 0, R, 100, 1, 0.08, r3, v3);
check('a strided group keeps its peak', r3[0] === 2 && v3[0] === 90);
check('rows outside the window are not picked', ribbonPick(vals, R, 0, 1, 4, 6, 100, 3, 0.08, rows, got) === 1 && rows[0] === 5);
check('no scale, no pick', ribbonPick(vals, R, 0, 1, 0, R, 0, 3, 0.08, rows, got) === 0);
check('an empty column picks nothing', ribbonPick(new Float64Array(R).fill(NaN), R, 0, 1, 0, R, 100, 3, 0.08, rows, got) === 0);

if (fail) {
  console.log(`\n${fail} failed`);
  process.exit(1);
}
console.log('\nribbon-proof: all ok');
