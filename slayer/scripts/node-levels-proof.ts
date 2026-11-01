/*
  The exposure nodes' default look (src/components/gex/nodeLevels.ts): the book's biggest nodes now, one band each across
  the chart. Known books in, known levels out:
    - the top N by |exposure| (dealer sign kept), largest first, none under the share floor, no strike without a reading;
    - two strikes nearer than the gap on the axis are one band: the weaker is skipped and named on the stronger;
    - no two drawn bands ever touch: each band's swell is held under half the gap to its neighbours;
    - the swell is t^1.6 between the hairline and the cap, and the inks are the identity inks first, else the side's;
    - the bands' names go through the edge's label fit and never overlap.
  Run:  npx tsx scripts/node-levels-proof.ts
*/
import { LEVELS_MIN_GAP_PX, LEVELS_MIN_SHARE, LEVELS_TOP_N, LEVEL_A_MAX, LEVEL_A_MIN, levelHalf, levelInk, levelRoom, levelSideInk, pickLevels, spaceLevels, type LevelRow } from '../src/components/gex/nodeLevels';
import { fitEdgeLabels, labelsOverlap } from '../src/components/gex/edgeLabelFit';
import { CALL_WALL, PUT_WALL, SUPREME } from '../src/components/gex/palette';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

/* ---- the pick ---- */
const book: LevelRow[] = [
  { strike: 745, value: -120e6 },
  { strike: 750, value: -1700e6 },
  { strike: 755, value: -590e6 },
  { strike: 757, value: -540e6 },
  { strike: 760, value: -1040e6 },
  { strike: 765, value: 95e6 },
  { strike: 767, value: -480e6 },
  { strike: 770, value: 410e6 },
  { strike: 772, value: NaN },
  { strike: 775, value: 0 },
];
const top = pickLevels(book);
check('at most LEVELS_TOP_N levels', top.length <= LEVELS_TOP_N, String(top.length));
check('largest first, by |exposure|', top.map(l => l.strike).join(',') === '750,760,755,757,767', top.map(l => l.strike).join(','));
check('the sign is kept (dealer short gamma stays negative)', top[0].value === -1700e6);
check('the largest is full strength; the rest are their share of it', near(top[0].t, 1) && near(top[1].t, 1040 / 1700));
check('none under the share floor', top.every(l => Math.abs(l.value) >= LEVELS_MIN_SHARE * 1700e6));
check('no strike without a reading (NaN, 0) is ever a level', !top.some(l => l.strike === 772 || l.strike === 775));
check('ranks 0..n-1 in size order', top.every((l, i) => l.rank === i));
check('a scale given is the full strength (the key prints it)', near(pickLevels(book, 5, 0.25, 3400e6)[0].t, 0.5));
check('an empty book has no level', pickLevels([]).length === 0 && pickLevels([{ strike: 1, value: NaN }]).length === 0);
check('equal sizes go to the lower strike, whatever the order', pickLevels([{ strike: 11, value: 5 }, { strike: 10, value: -5 }])[0].strike === 10);
check('a smaller N is honoured', pickLevels(book, 3).length === 3);

/* ---- the spacing: 1 point = 20 px, then a squeezed scale where strikes crowd ---- */
const yWide = (p: number) => (780 - p) * 20;
const wide = spaceLevels(top, yWide);
check('a roomy axis keeps every level', wide.length === top.length, wide.map(l => l.strike).join(','));
const ySqueezed = (p: number) => (780 - p) * 4; /* 755 and 757 are 8px apart: one band */
const sq = spaceLevels(top, ySqueezed);
check('two strikes nearer than the gap are one band', sq.length === top.length - 1, sq.map(l => l.strike).join(','));
check('the weaker of the two is the one skipped', sq.some(l => l.strike === 755) && !sq.some(l => l.strike === 757));
check('the kept band names the strike it stands for', (sq.find(l => l.strike === 755)?.merged ?? []).includes(757));
check('ranks renumbered in kept order', sq.every((l, i) => l.rank === i));
let minGap = Infinity;
for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) minGap = Math.min(minGap, Math.abs(sq[i].y - sq[j].y));
check('every kept pair at least the gap apart', minGap >= LEVELS_MIN_GAP_PX, String(minGap));
const offScale = spaceLevels(top, p => (p === 750 ? null : yWide(p)));
check('a level the scale cannot place is dropped', !offScale.some(l => l.strike === 750) && offScale.length === top.length - 1);
/* a crushed axis: every strike within a few px — one band, the largest, standing for the rest */
const crushed = spaceLevels(top, p => (780 - p) * 0.2);
check('a crushed axis draws one band, the largest, naming the rest', crushed.length === 1 && crushed[0].strike === 750 && crushed[0].merged.length === top.length - 1);

/* ---- no band touches another ---- */
for (const [name, set] of [['roomy', wide], ['squeezed', sq]] as const) {
  const ys = set.map(l => l.y);
  let touch = false;
  for (let i = 0; i < set.length; i++) {
    const hi = Math.min(levelHalf(set[i].t), levelRoom(set[i].y, ys));
    for (let j = 0; j < set.length; j++) {
      if (i === j) continue;
      const hj = Math.min(levelHalf(set[j].t), levelRoom(set[j].y, ys));
      if (Math.abs(set[i].y - set[j].y) < hi + hj + 1.99) touch = true;
    }
  }
  check(`${name}: no two bands touch (each swell under half the gap, less a pixel)`, !touch);
}

/* ---- the swell and the inks ---- */
check('the swell is the hairline at 0 and the cap at 1', near(levelHalf(0), LEVEL_A_MIN) && near(levelHalf(1), LEVEL_A_MAX));
check('the swell is t^1.6 between them', near(levelHalf(0.5), LEVEL_A_MIN + Math.pow(0.5, 1.6) * (LEVEL_A_MAX - LEVEL_A_MIN)));
check('the swell rises with strength', levelHalf(0.3) < levelHalf(0.6) && levelHalf(0.6) < levelHalf(0.9));
const ids = { supreme: 760, cw: 770, pw: 750 };
const rgb = (c: readonly number[]) => c.join(',');
check('the supreme wears its identity ink over the side', rgb(levelInk({ strike: 760, value: -1, t: 1 }, ids, false)) === rgb(levelInk({ strike: 760, value: 1, t: 0.1 }, ids, false)));
const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)].join(',');
check('the walls wear theirs (the key levels\' inks), whatever their side', rgb(levelInk({ strike: 770, value: -1, t: 0.2 }, ids, false)) === hexRgb(CALL_WALL) && rgb(levelInk({ strike: 750, value: 1, t: 0.2 }, ids, false)) === hexRgb(PUT_WALL) && rgb(levelInk({ strike: 760, value: 1, t: 0.2 }, ids, false)) === hexRgb(SUPREME));
check('a plain node wears its side (glacier long, ember short)', rgb(levelInk({ strike: 755, value: -1, t: 0.5 }, ids, false)) === rgb(levelSideInk(-1, 0.5, false)) && rgb(levelSideInk(1, 0.5, false)) !== rgb(levelSideInk(-1, 0.5, false)));

/* ---- the names never stack ---- */
const placed = fitEdgeLabels(
  sq.slice(0, 3).map(l => ({ id: String(l.strike), y: l.y, prio: 10 - l.rank, keep: l.rank === 0 })).concat([{ id: 'flip', y: ySqueezed(766.7), prio: 9, keep: true }]),
  { h: 14, gap: 2, top: 30, bottom: 220 },
);
let over = false;
for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) if (labelsOverlap(placed[i], placed[j], 16)) over = true;
check('the names and the levels beside them never overlap', !over && placed.length >= 2, placed.map(p => `${p.id}@${p.ty.toFixed(0)}`).join(' '));

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nnode-levels-proof: all ok');
