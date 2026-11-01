/*
  Terrain's desk shell (layout door, sessions clock, dock): runs the actual modules — no browser.

  Proves:
  1. Every shape names exactly its count of panes, a..n in order, each pane a rectangle of cells; six is the ceiling
  2. A count's shape by rest is in its own row; the next shape walks the row and comes back
  3. readSync: crosshair on by rest, the rest off; junk reads as the rest
  4. The sessions clock's lanes are the session module's windows: a normal day carries all four (overnight twice),
     Thanksgiving none but its own evening's overnight, the early close's regular session ends 13:00 and its after
     hours 17:00, a Saturday nothing
  5. readLanes / nextTurn agree with the module across a weekend
  6. The dock's report out-mark reads the session module (13:00 on an early close)
  Run: npx tsx scripts/terrain-desk-proof.ts
*/
import { AREA_NAMES, LAYOUT_COUNTS, MAX_PANES, SHAPES, SHAPE_KEYS, countOf, glyphCells, nextShapeOf, readSync, shapeByRest, shapesOf } from '../src/pages/terrain/layoutShapes';
import { aheadNotes, dayWindows, inWords, nextTurn, readLanes } from '../src/pages/terrain/sessionsClock';
import { nyInstant, nyWall } from '../src/core/session';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (ok) pass++;
  else fail++;
};

/* 1 */
check('six is the ceiling', MAX_PANES === 6 && Math.max(...LAYOUT_COUNTS) === 6 && AREA_NAMES.length === 6);
for (const k of SHAPE_KEYS) {
  const sp = SHAPES[k];
  const letters = new Set(sp.areas.join(' ').split(' '));
  const want = AREA_NAMES.slice(0, sp.n);
  const rowsOk = sp.areas.length === sp.rows && sp.areas.every(r => r.split(' ').length === sp.cols);
  const cells = glyphCells(k);
  const area = cells.reduce((a, c) => a + c.w * c.h, 0);
  check(`shape ${k} stands ${sp.n} panes in a ${sp.cols}×${sp.rows} grid`, rowsOk && letters.size === sp.n && want.every(l => letters.has(l)) && cells.length === sp.n && area === sp.cols * sp.rows && countOf(k) === sp.n);
}
/* 2 */
for (const n of LAYOUT_COUNTS) {
  const row = shapesOf(n);
  let s = shapeByRest(n);
  const seen = new Set([s]);
  for (let i = 0; i < row.length; i++) seen.add((s = nextShapeOf(s)));
  check(`count ${n}: by rest ${shapeByRest(n)}, the walk covers its row and returns`, row.includes(shapeByRest(n)) && seen.size === row.length && s === shapeByRest(n));
}
check('three by rest is two on top and one wide below (the desk as it stood)', shapeByRest(3) === '3B');
/* 3 */
const rest = readSync(undefined);
check('sync by rest: crosshair only', rest.crosshair && !rest.symbol && !rest.interval && !rest.time);
const junk = readSync({ symbol: 'yes', interval: 1, crosshair: false, time: true });
check('sync reads booleans only', !junk.symbol && !junk.interval && !junk.crosshair && junk.time);

/* 4 */
const noon = (iso: string) => nyInstant(iso, 12 * 60);
const kinds = (iso: string) => dayWindows(noon(iso)).map(w => w.kind).join(',');
const clock = (ms: number) => {
  const m = nyWall(ms).min;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
check('a Tuesday: overnight, pre, regular, post, overnight', kinds('2026-11-03') === 'overnight,pre,regular,post,overnight', kinds('2026-11-03'));
const tues = dayWindows(noon('2026-11-03'));
const reg = tues.find(w => w.kind === 'regular');
check('the regular window is the module’s 09:30–16:00', !!reg && clock(reg.from) === '09:30' && clock(reg.to) === '16:00');
check('Thanksgiving: only its evening’s overnight into Friday', kinds('2026-11-26') === 'overnight', kinds('2026-11-26'));
check('the evening before Thanksgiving opens no overnight', !dayWindows(noon('2026-11-25')).some(w => w.kind === 'overnight' && nyWall(w.from).iso === '2026-11-25'));
const fri = dayWindows(noon('2026-11-27'));
const fReg = fri.find(w => w.kind === 'regular');
const fPost = fri.find(w => w.kind === 'post');
check('the early close: regular to 13:00, after hours to 17:00', !!fReg && !!fPost && clock(fReg.to) === '13:00' && clock(fPost.to) === '17:00');
check('a Saturday: nothing', kinds('2026-11-07') === '', kinds('2026-11-07'));

/* 5 */
const sat = noon('2026-11-07');
const lanes = readLanes(sat);
check('Saturday: every lane shut', lanes.every(l => !l.open));
const on = lanes.find(l => l.kind === 'overnight');
check('Saturday: overnight opens Sunday 20:00', !!on?.changeAt && nyWall(on.changeAt).iso === '2026-11-08' && clock(on.changeAt) === '20:00');
const t = nextTurn(sat);
check('Saturday: the next turn is the overnight opening', !!t && t.next === 'overnight' && t.opens && t.phase === 'closed');
const mid = nextTurn(nyInstant('2026-11-03', 11 * 60));
check('Tuesday 11:00: regular, closing into after hours at 16:00', !!mid && mid.phase === 'regular' && mid.next === 'post' && clock(mid.at) === '16:00');
check('inWords', inWords(0) === 'in under a minute' && inWords(12 * 60_000) === 'in 12m' && inWords(134 * 60_000) === 'in 2h 14m' && inWords((29 * 60) * 60_000) === 'in 1d 5h');
const notes = aheadNotes(noon('2026-11-01'));
check('ahead: Thanksgiving closed, then the 13:00 Friday', notes.length === 2 && notes[0].iso === '2026-11-26' && notes[0].kind === 'holiday' && notes[1].iso === '2026-11-27' && notes[1].closeMin === 13 * 60, JSON.stringify(notes));

/* 6 — the dock's out-mark (dockParts is a .tsx with icons; the rule is re-read here the same way) */
const { reportOutAt } = await import('../src/pages/terrain/dock/dockParts');
const bmo = reportOutAt('2026-11-03', 'BMO', true);
const amcEarly = reportOutAt('2026-11-27', 'AMC', true);
check('report out-marks: before the open 09:30, after an early close 13:00', bmo != null && clock(bmo) === '09:30' && amcEarly != null && clock(amcEarly) === '13:00');
check('report out-mark: no date, no mark', reportOutAt(undefined, 'AMC') === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
