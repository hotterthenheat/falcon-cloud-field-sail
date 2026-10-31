/*
  Walls and flip proof: one definition of the call wall, the put wall and the flip on every page.
  - The walls are the most call-leg and the most put-leg gamma ANYWHERE on the levels' contracts (core/walls.ts). The
    exposure profile (data/exposure.ts, what levelsFor reads) and "Where the walls are heading" (data/building.ts) pick
    them on the same strikes: a wall outside the rows' window is still the wall. (Pulse once printed SPY's call wall 800
    on Key levels and 770 on the heading tile off one book: the heading picked inside ±30 strikes.)
  - The flip is where the re-priced net crosses zero within ±10% (core/gammaFlip.ts); a hand book pins it.
  - A final read with no flip says what is true of the book — the net keeps one sign across ±10% — never "no put gamma".
  - A provisional read ("Today" before its date's chain lands: the whole book stands in) draws no wall, supreme or flip:
    the heading prints "…", the chart's levels and Terrain's / Weigher's panes are NaN.
  - Pulse, Terrain and Weigher read the name's own levels scope, the one Pinpoint's head sets.
  Run:  npx tsx scripts/walls-flip-proof.ts
*/
import { readFileSync } from 'node:fs';
import { pickLegWalls } from '../src/core/walls';
import { netGammaAt, repricedFlip, type GammaLeg } from '../src/core/gammaFlip';
import { buildExposureProfile } from '../src/data/exposure';
import { buildBuilding, type Building } from '../src/data/building';
import { noFlipWords } from '../src/data/flipLevel';
import { emptyNode } from '../src/data/book/scale';
import { paneLevels } from '../src/pages/terrain/paneLevels';
import type { TickerLevels } from '../src/data/levelsFor';
import type { AheadClock } from '../src/data/ahead';
import type { MarketSnapshot, StrikeNode } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* ---- the hand book: spot 100, strikes 90…110, gamma in the house sign (call legs negative, put legs positive) ---- */
const SPOT = 100;
/** call-leg and put-leg dollar gamma per strike, in $M — 108 holds the most call gamma (far outside a ±3 window), 102
    the most inside it; 97 the most put gamma */
const CALLS: Record<number, number> = { 101: 40, 102: 120, 103: 60, 104: 50, 105: 90, 108: 300 };
const PUTS: Record<number, number> = { 92: 30, 95: 110, 96: 70, 97: 260, 98: 90, 99: 80, 100: 60 };
const node = (k: number, call: number, put: number): StrikeNode => {
  const n = emptyNode(k);
  n.callGex = -call * 1e6;
  n.putGex = put * 1e6;
  n.netGex = n.callGex + n.putGex;
  n.callOI = call > 0 ? 1000 : 0;
  n.putOI = put > 0 ? 1000 : 0;
  return n;
};
const strikes = Array.from({ length: 21 }, (_, i) => 90 + i);
const handChain = strikes.map(k => node(k, CALLS[k] ?? 0, PUTS[k] ?? 0));
/** Every strike put-heavy: dealers short gamma everywhere, net negative (retail sign) across the book */
const negChain = strikes.map(k => node(k, (CALLS[k] ?? 0) * 0.1, (PUTS[k] ?? 0) + 20));

const snapOf = (chain: StrikeNode[], extra: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  ticker: 'HAND',
  spot: SPOT,
  changePercent: 0,
  priceHistory: [],
  chain,
  indicators: {} as MarketSnapshot['indicators'],
  plan: {} as MarketSnapshot['plan'],
  tape: [],
  ...extra,
});
const SHUT: AheadClock = { nowMin: null, inSession: false, minutesLeft: 390, label: 'closed' };
const heading = (b: Building, name: Building['heading'][number]['name']) => b.heading.find(l => l.name === name)!;

/* 1 — the walls: one rule, every strike of the contracts, whatever window the rows are cut to */
{
  const all = pickLegWalls(handChain, n => n.callGex, n => n.putGex);
  check(`the rule: most call gamma 108 ($300M), most put gamma 97 ($260M) — got ${all.callWall} / ${all.putWall}`, all.callWall === 108 && all.putWall === 97);
  const inWindow = pickLegWalls(handChain.filter(n => Math.abs(n.strike - SPOT) <= 3), n => n.callGex, n => n.putGex);
  check(`inside ±3 strikes alone the same rule names 102 — the strike set, not the rule, made Pulse's 800 against 770 (got ${inWindow.callWall})`, inWindow.callWall === 102);
  for (const half of [3, 10, 30] as const) {
    const p = buildExposureProfile(snapOf(handChain), '0DTE', half);
    const b = buildBuilding(snapOf(handChain), [], [], p, SHUT);
    const cw = heading(b, 'Call wall').now;
    const pw = heading(b, 'Put wall').now;
    check(`±${half} strikes: the profile (levelsFor's) reads ${p.levels.callWall} / ${p.levels.putWall}, the heading ${cw} / ${pw} — both 108 / 97`, p.levels.callWall === 108 && p.levels.putWall === 97 && cw === 108 && pw === 97);
    check(`±${half} strikes: the supreme agrees too (profile ${p.levels.supreme}, heading ${heading(b, 'Supreme').now})`, p.levels.supreme === heading(b, 'Supreme').now);
  }
}

/* 2 — the flip of the hand book, pinned: the re-priced net crosses zero once inside ±10% */
const legsOf = (chain: readonly StrikeNode[]): GammaLeg[] =>
  chain.flatMap(n => [
    ...(n.callGex ? [{ strike: n.strike, g0: n.callGex, iv: 0.2, t: 10 / 252, side: -1 as const }] : []),
    ...(n.putGex ? [{ strike: n.strike, g0: n.putGex, iv: 0.2, t: 10 / 252, side: 1 as const }] : []),
  ]);
const FLIP = 100.11343883640458;
{
  const legs = legsOf(handChain);
  const f = repricedFlip(legs, SPOT, 0, 0.1, 0);
  check(`hand book: the flip is ${f.flip?.toFixed(4)} (pinned ${FLIP.toFixed(4)})`, f.flip != null && Math.abs(f.flip - FLIP) < 1e-6);
  check(`hand book: one crossing inside ±10% (${(f.crossings ?? []).map(x => x.toFixed(2)).join(', ')})`, (f.crossings ?? []).length === 1);
  const below = netGammaAt(legs, SPOT, FLIP - 0.5, 0, 0);
  const above = netGammaAt(legs, SPOT, FLIP + 0.5, 0, 0);
  check(`hand book: the net changes sign through the flip (house ${(below / 1e6).toFixed(1)}M below, ${(above / 1e6).toFixed(1)}M above)`, Math.sign(below) !== Math.sign(above) && below !== 0 && above !== 0);
  /* an independent read: bisect the net itself (netGammaAt) between spot and +2% */
  let lo = SPOT;
  let hi = SPOT * 1.02;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(netGammaAt(legs, SPOT, mid, 0, 0)) === Math.sign(netGammaAt(legs, SPOT, lo, 0, 0))) lo = mid;
    else hi = mid;
  }
  check(`hand book: bisecting the net puts its zero at ${lo.toFixed(4)}, the flip's`, Math.abs(lo - FLIP) < 1e-6);
  check(`hand book: net at spot is house-positive (dealers short gamma below the flip): ${(f.netAtSpot / 1e6).toFixed(1)}M`, f.netAtSpot > 0);
}

/* 3 — the all-negative book: no flip, and the words say why */
{
  const f = repricedFlip(legsOf(negChain), SPOT, 0, 0.1, 0);
  check(`all-negative book: no crossing within ±10% (flip ${f.flip}, ${(f.crossings ?? []).length} crossings)`, f.flip == null && !(f.crossings ?? []).length);
  check(`all-negative book: net at spot house-positive ${(f.netAtSpot / 1e6).toFixed(0)}M`, f.netAtSpot > 0);
  const words = noFlipWords(f.netAtSpot);
  check(`all-negative book: "${words}"`, words === 'none — net gamma stays negative within ±10% (dealers short gamma throughout)');
  check('a long-gamma book with no flip says positive', noFlipWords(-1).includes('stays positive'));
  check('no net in hand: just "no flip within ±10%"', noFlipWords(null) === 'none — no flip within ±10%');
  /* the heading tile's Flip row on that book: the book's own reason, never a put wall's */
  const p = buildExposureProfile(snapOf(negChain), '0DTE', 10);
  const b = buildBuilding(snapOf(negChain), [], [], p, SHUT);
  const flipRow = heading(b, 'Flip');
  check(`heading Flip row on the all-negative book: "${flipRow.words}"`, flipRow.now == null && flipRow.words === words && !/put gamma|call gamma/.test(flipRow.words));
  check(`…and its put wall still stands (${heading(b, 'Put wall').now}): the book has put gamma`, heading(b, 'Put wall').now === 97);
}

/* 4 — a provisional book draws nothing: "Today" before its date's chain lands (the whole book standing in) */
{
  const standIn = snapOf(handChain, { liveBook: true, uwChains: { ALL: handChain } });
  const p = buildExposureProfile(standIn, '0DTE', 30);
  check(`stand-in: the profile knows it is not final (complete ${p.levels.complete})`, p.levels.complete === false);
  const b = buildBuilding(standIn, [], [], p, SHUT);
  check(`stand-in: every heading row is "…" and draws no strike (${b.heading.map(l => `${l.name} ${l.now ?? l.words}`).join(' · ')})`, b.heading.every(l => l.pending && l.now == null && l.words === '…'));
  const house = (wallsFinal: boolean, complete: boolean): TickerLevels => ({
    ticker: 'HAND', scope: '0DTE', scopeLabel: wallsFinal ? 'Next session · Nov 2' : 'Today · loading', date: wallsFinal ? '2026-11-02' : null, spot: SPOT,
    supreme: 97, callWall: 108, putWall: 97, flip: FLIP, netGex: 0, netAtSpot: 0, regime: 'SHORT', complete, wallsFinal, flipSecond: null, moves: [],
    netAt: () => null, legsAt: () => null,
  });
  const pending = paneLevels(SPOT, house(false, false));
  check(`Terrain/Weigher pane on a stand-in: no wall, no supreme (${pending.callWall} / ${pending.putWall} / ${pending.supreme})`, [pending.callWall, pending.putWall, pending.supreme].every(Number.isNaN));
  const final = paneLevels(SPOT, house(true, true));
  check(`Terrain/Weigher pane once final: 108 / 97 / flip ${final.flip.toFixed(2)}`, final.callWall === 108 && final.putWall === 97 && Math.abs(final.flip - FLIP) < 1e-9);
}

/* 5 — one scope per name on every page: Pulse, Terrain and Weigher read the name's levels scope (Pinpoint's head sets it) */
{
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  check('Terrain reads the name\'s levels scope (useNameLevels), not a desk-wide one', /useLevelsFor\(ticker, levelsScope/.test(src('pages/terrain/Terrain.tsx')) && /const levelsScope = useNameLevels\(ticker\)/.test(src('pages/terrain/Terrain.tsx')));
  check('Weigher reads the name\'s levels scope', /useLevelsFor\(ticker, useNameLevels\(ticker\)\)/.test(src('pages/weigher/WeigherDesk.tsx')));
  check('Pulse\'s Key levels read the house (levelsFor), not the desk context\'s profile', /useLevelsFor\(ctx\.ticker, useNameLevels\(ctx\.ticker\)\)/.test(src('pages/workspace/tiles/book.tsx')) && !/ctx\.exposure\.levels;\n\s*const above/.test(src('pages/workspace/tiles/book.tsx')));
  check('Pulse\'s chart levels read the house on a live book', /if \(s\.liveBook\) return keyLevelsFrom\(s\.spot, houseOf\(s\)\)/.test(src('pages/workspace/tiles/derive.ts')));
  check('the heading figure prints the level\'s own words, never "no put gamma on this book"', !/gamma on this book/.test(src('components/gex/WallHeading.tsx')));
}

console.log(fail ? `\n${fail} FAILED` : '\nall walls-flip checks pass');
process.exit(fail ? 1 : 0);
