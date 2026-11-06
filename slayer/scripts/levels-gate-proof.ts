/*
  Levels gate proof: every page that prints a call wall, a put wall, the supreme or the flip reads them from ONE source
  (data/levelsFor.ts levelsFor, on the name's own levels scope), through ONE gate (levelsFor.ts drawnLevels). Nothing is
  drawn while the real book is not in.
  - The walls and the supreme wait for the scope's own contracts (`wallsFinal`). "Today" before its date's chain lands
    reads the whole book standing in, and that book's walls are not the day's (SPY: the whole book's 800 against the
    day's 770).
  - The flip waits for its final pricing (`complete`). Until then it is "…", never "none" and never "no flip within reach".
  Pulse's chart, Key levels and clock tiles, Terrain's and Weigher's panes, Pinpoint's Trader's Clock and Compass's name
  desks all read through the gate and agree on every state. Pulse's Targets and Head-to-head tiles wait as Pinpoint's
  Agenda and Compare do, and Head to head reads each name in its own scope.
  scripts/walls-flip-proof.ts proves the math (the walls' rule, the flip's crossing). This proof covers where the pages
  read it and when they hold back.
  Run:  npx tsx scripts/levels-gate-proof.ts
*/
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as levelsFor from '../src/data/levelsFor';
import type { TickerLevels } from '../src/data/levelsFor';
import { paneLevels } from '../src/pages/terrain/paneLevels';
import { keyLevelsFrom } from '../src/pages/workspace/tiles/derive';
import { PHASES, type ClockFacts } from '../src/components/gex/TraderClock';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const SPOT = 100;
const FLIP = 100.11;
/** One reading in each of the three states a book passes through */
const house = (wallsFinal: boolean, complete: boolean): TickerLevels => ({
  ticker: 'HAND', scope: '0DTE', scopeLabel: wallsFinal ? 'Next session · Nov 2' : 'Today · loading', date: wallsFinal ? '2026-11-02' : null, spot: SPOT,
  supreme: 97, callWall: 108, putWall: 97, flip: FLIP, netGex: 0, netAtSpot: 0, regime: 'SHORT', complete, wallsFinal, flipSecond: null, moves: [],
  netAt: () => null, legsAt: () => null,
});
const STATES = [
  { name: 'stand-in (the whole book for "Today")', lv: house(false, false), walls: false, flip: false },
  { name: 'own contracts in, flip still priced', lv: house(true, false), walls: true, flip: false },
  { name: 'final', lv: house(true, true), walls: true, flip: true },
];
const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);

/* 1 — the one gate */
const drawnLevels = (levelsFor as Record<string, unknown>).drawnLevels as ((lv: TickerLevels | null) => levelsFor.DrawnLevels) | undefined;
check('data/levelsFor.ts exports the one gate, drawnLevels', typeof drawnLevels === 'function');
if (drawnLevels) {
  check('no reading: nothing drawn, nothing in', (() => {
    const d = drawnLevels(null);
    return !d.wallsIn && !d.flipIn && [d.callWall, d.putWall, d.supreme, d.flip].every(v => v == null);
  })());
  for (const s of STATES) {
    const d = drawnLevels(s.lv);
    const walls = [d.callWall, d.putWall, d.supreme];
    check(`gate, ${s.name}: walls ${s.walls ? '108 / 97 / supreme 97' : 'none'} · flip ${s.flip ? FLIP : 'none'}`,
      d.wallsIn === s.walls && d.flipIn === s.flip && (s.walls ? d.callWall === 108 && d.putWall === 97 && d.supreme === 97 : walls.every(v => v == null)) && (s.flip ? d.flip === FLIP : d.flip == null));
  }
}

/* 2 — every reader agrees on every state: Terrain's / Weigher's panes and Pulse's chart and Key levels */
for (const s of STATES) {
  const pane = paneLevels(SPOT, s.lv);
  const chart = keyLevelsFrom(SPOT, s.lv);
  const want = { callWall: s.walls ? 108 : null, putWall: s.walls ? 97 : null, supreme: s.walls ? 97 : null, flip: s.flip ? FLIP : null };
  const same = (o: { callWall: number; putWall: number; supreme: number; flip: number }) =>
    num(o.callWall) === want.callWall && num(o.putWall) === want.putWall && num(o.supreme) === want.supreme && num(o.flip) === want.flip;
  check(`${s.name}: Terrain/Weigher pane draws ${JSON.stringify({ cw: num(pane.callWall), pw: num(pane.putWall), sup: num(pane.supreme), flip: num(pane.flip) })}`, same(pane));
  check(`${s.name}: Pulse's chart draws ${JSON.stringify({ cw: num(chart.callWall), pw: num(chart.putWall), sup: num(chart.supreme), flip: num(chart.flip) })}`, same(chart));
}

/* 3 — the clock's words: a flip still being priced is "…", never "no flip within reach" */
{
  const morning = PHASES.find(p => p.key === 'morning')!;
  const facts = (flip: number | null, flipPending: boolean): ClockFacts => ({ pin: null, supreme: null, flip, flipPending, charmStrike: null, charmMoves: null, bellShare: null } as ClockFacts);
  const pending = morning.words(facts(null, true));
  check(`clock, flip still priced: "${pending}"`, !/no flip/.test(pending) && /…/.test(pending));
  check('clock, final with none: still says there is no flip', /no flip within reach/.test(morning.words(facts(null, false))));
  check('clock, final: names the flip', morning.words(facts(FLIP, false)).includes('100.11'));
}

/* 4 — one source, one gate, on every page: any page or component that reads levelsFor reads through the gate (or a gate
   this list names), and nothing outside data/ and core/ picks walls or a flip of its own */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const ui = [...walk(join(SRC, 'pages')), ...walk(join(SRC, 'components'))];
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');
/** Pages that hold back by another gate of the same reading: each with the gate it uses */
const OTHER_GATES: Record<string, RegExp> = {
  'pages/terrain/Terrain.tsx': /paneLevels\(/,
  'pages/weigher/WeigherDesk.tsx': /paneLevels\(/,
  'components/gex/BookRead.tsx': /const lvReady = !!lv && lv\.complete/,
  'components/gex/RegimeLine.tsx': /if \(!lv \|\| !lv\.complete/,
  'components/gex/ExposureField.tsx': /complete: room\.complete && lv\.complete/,
};
const readers = ui.filter(p => /\b(useLevelsFor|levelsFor|levelsForDate|houseOf)\(/.test(readFileSync(p, 'utf8')));
check(`the pages that read levelsFor are found (${readers.length})`, readers.length >= 8);
for (const p of readers) {
  const r = rel(p);
  const text = readFileSync(p, 'utf8');
  const gate = OTHER_GATES[r];
  check(`${r} reads levelsFor through ${gate ? `its gate ${gate.source.slice(0, 40)}` : 'drawnLevels'}`, gate ? gate.test(text) : /drawnLevels\(/.test(text));
}
for (const p of ui) {
  const text = readFileSync(p, 'utf8');
  if (/\b(pickLegWalls|repricedFlip|levelFlip)\(/.test(text)) check(`${rel(p)} picks no walls or flip of its own`, false);
}
check('no page or component picks walls or a flip of its own (pickLegWalls / repricedFlip / levelFlip)', ui.every(p => !/\b(pickLegWalls|repricedFlip|levelFlip)\(/.test(readFileSync(p, 'utf8'))));

/* 5 — Pulse's tiles that name the levels wait as Pinpoint's pages do */
{
  const book = src('pages/workspace/tiles/book.tsx');
  const derive = src('pages/workspace/tiles/derive.ts');
  check('Pulse Targets: the agenda waits on the levels (as board.ts deskAgenda)', /if \(levelsWaiting\(s\)\) throw/.test(derive) && /levelsWaiting = \(s: MarketSnapshot\): boolean => !!s\.liveBook && profile15\(s\)\?\.levels\.complete === false/.test(derive));
  check('Pulse Head to head: each side in its own levels scope (as Pinpoint Compare)', /buildCompareSide\(ctx\.snapshot, clock, scopeA\)/.test(book) && /buildCompareSide\(snapB, clock, levelsForName\(b\)\)/.test(book));
  check('Pulse Head to head: a side not final prints "…"', /const waits = \(s: CompareSide\) => s\.levels\.complete === false/.test(book));
  check('Pulse Key levels: through the gate', /const drawn = drawnLevels\(house\)/.test(book));
  check('Pulse clock tile: through the gate, a pending flip said so', /drawnLevels\(houseOf\(ctx\.snapshot\)\)/.test(src('pages/workspace/tiles/you.tsx')) && /flipPending: !!live && !d\.flipIn/.test(src('pages/workspace/tiles/you.tsx')));
  check("Pinpoint Trader's Clock: through the gate, the charm read waits for the walls", /drawnLevels\(levelsFor\(snapshot\.ticker/.test(src('components/gex/TraderClock.tsx')) && /if \(!wallsIn\) throw/.test(src('components/gex/TraderClock.tsx')));
}

console.log(fail ? `\n${fail} FAILED` : '\nall levels-gate checks pass');
process.exit(fail ? 1 : 0);
