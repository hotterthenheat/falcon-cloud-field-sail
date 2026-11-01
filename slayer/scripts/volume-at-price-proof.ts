/*
  VOLUME AT PRICE (src/data/volumeAtPrice.ts) — the helper behind every volume profile — held to hand-worked figures:
  three bars spread over four rows by overlap, the up / down split, the POC, the value area grown one row at a time
  (the heavier neighbour; a tie to the row nearer the POC, then to the row above), the ticks layout and the segments.
  Run: npx tsx scripts/volume-at-price-proof.ts
*/
import { rowSizeFor, segmentBy, valueAreaOf, volumeAtPrice, type VapBar } from '../src/data/volumeAtPrice';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
};
const near = (a: number, b: number, msg: string, tol = 1e-9) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/* A: 100–102, 200 shares, up. B: a one-price bar at 101, 50 shares, down. C: 100–104, 400 shares, down. */
const bars: VapBar[] = [
  { time: 60, open: 100, high: 102, low: 100, close: 101.5, volume: 200 },
  { time: 120, open: 101, high: 101, low: 101, close: 101, volume: 0 },
  { time: 180, open: 101.2, high: 101, low: 101, close: 101, volume: 50 },
  { time: 240, open: 103, high: 104, low: 100, close: 100.5, volume: 400 },
];
/* the zero-volume bar is skipped; the 101 bar opened above its close (a down bar) */
const p = volumeAtPrice(bars, { layout: 'rows', size: 4, valueArea: 0.7 })!;
ok(!!p, 'a profile');
ok(p.rows.length === 4, `four rows (${p.rows.length})`);
near(p.rowSize, 1, 'row size: (104 − 100) / 4');
/* row 0 [100,101]: A 100 up + C 100 down; row 1 [101,102]: A 100 up + B 50 down + C 100 down; rows 2, 3: C 100 down */
const want = [
  { up: 100, down: 100 },
  { up: 100, down: 150 },
  { up: 0, down: 100 },
  { up: 0, down: 100 },
];
want.forEach((w, i) => {
  near(p.rows[i].up, w.up, `row ${i} up`);
  near(p.rows[i].down, w.down, `row ${i} down`);
});
near(p.total, 650, 'total');
near(p.up, 200, 'up volume');
near(p.down, 450, 'down volume');
ok(p.poc === 1, `POC is row 1 (${p.poc})`);
near(p.pocPrice, 101.5, 'POC price, the row’s middle');
/* VA: 70% of 650 = 455. Row 1 (250); row 0 (200) beats row 2 (100) → 450; then row 2 → 550 */
ok(p.vaLo === 0 && p.vaHi === 2, `value area rows 0–2 (${p.vaLo}–${p.vaHi})`);
near(p.val, 100, 'VAL');
near(p.vah, 103, 'VAH');
ok(p.bars === 3 && p.from === 60 && p.to === 240, 'covers the three bars that traded');

/* the value area's ties */
ok(JSON.stringify(valueAreaOf([10, 30, 50, 30, 10], 2, 0.7)) === '[1,3]', 'equal neighbours at equal distance: the row above first, then the one below');
ok(JSON.stringify(valueAreaOf([30, 30, 100, 30, 30], 2, 0.7)) === '[1,3]', 'equal volume: the row nearer the POC wins over the row above');
ok(JSON.stringify(valueAreaOf([30, 30, 100, 30, 30], 2, 1)) === '[0,4]', 'the whole profile at 100%');
ok(JSON.stringify(valueAreaOf([0, 0, 0], 1, 0.7)) === '[1,1]', 'no volume: the POC alone');

/* the ticks layout: 50 ticks of a cent is a half-point row, on the tick grid */
near(rowSizeFor(100, 104, 'ticks', 50, 0.01), 0.5, 'ticks: 50 × 0.01');
const t = volumeAtPrice(bars, { layout: 'ticks', size: 50, tick: 0.01 })!;
ok(t.rows.length === 9, `ticks layout: 9 half-point rows from 100 to 104.5 (${t.rows.length})`);
near(t.rows.reduce((a, r) => a + r.total, 0), 650, 'ticks layout keeps every share');
const capped = volumeAtPrice(bars, { layout: 'ticks', size: 1, tick: 0.01, maxRows: 40 })!;
ok(capped.rows.length === 40, `a tick row over a wide range is capped (${capped.rows.length})`);
near(capped.rows.reduce((a, r) => a + r.total, 0), 650, 'the capped profile keeps every share');

/* nothing to build from */
ok(volumeAtPrice([]) === null, 'no bars, no profile');
ok(volumeAtPrice([{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 0 }]) === null, 'no volume, no profile');

/* segments */
const segs = segmentBy([{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }], b => (b.time === 3 ? null : b.time < 3 ? 'a' : 'b'));
ok(segs.length === 2 && segs[0].bars.length === 2 && segs[1].bars.length === 1, 'segments split by key and drop a null');

console.log(fail ? `volume at price: ${fail} FAILED` : 'volume at price: all hold');
process.exit(fail ? 1 : 0);
