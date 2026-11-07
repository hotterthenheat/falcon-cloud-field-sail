/*
  One engine behind the Map (docs/TWO_BOOK.md §The Map). On recorded SPY and SPX books (scripts/fixtures/twobook, written by
  scripts/twobook-map-record.mjs from a running server), for each book:
    1. the board: Model 1 rebuilt from the recorded listed rows and contracts (model1Board), Model 2 from the recorded
       inventory and quotes (flowBoardOf) — equal to the board the server answered when recorded;
    2. the cells: Σ over every (expiry, strike) cell of each of the ten = the board's total (1e-9 relative);
    3. the chains every page reads (book/engineView.ts through store.ts peekEntry, the board held as the server's answer):
       Σ over the per-date chains and Σ over the whole-book chain, read in the dealer sign the pages print, = the totals;
    4. the Map's matrix (buildExposureSurface on the page's own snapshot, book/levels.ts materialize): every cell it draws
       for every greek is the chain's own figure at that strike and date;
    5. the levels read the same per-strike values: the walls are the largest call and put GEX of the chain's strikes
       (recomputed here from the cells); the flip's legs (flipLevel.ts) add up to the chain's net exactly, and re-priced at
       the board's own price they are the board's GEX — the regime is its sign;
    6. the two books are never added: the flow-book view carries no open interest, and switching the book swaps every chain.
  Run: node --import tsx scripts/twobook-map-proof.ts
*/
import { gunzipSync } from 'node:zlib';
import { nyInstant } from '../shared/marketSession.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPOSURE_NAMES, type ExposureName } from '../src/engine/twobook';
import { model1Board, type Model1Wire } from '../src/data/twobook/model1';
import { flowBoardOf, viewOf, type FlowBoardWire, type FlowInputs } from '../src/data/twobook/flowBook';
import { legsTotal, LEG_AT } from '../src/data/twobook/legs';
import { setBookMode } from '../src/data/bookMode';
import { cache, peekEntry, type Entry } from '../src/data/book/store';
import { materialize } from '../src/data/book/levels';
import { buildExposureSurface, GREEKS, type Greek } from '../src/data/exposureSurface';
import { engineLegsFor, levelFlip, regimeOfNet } from '../src/data/flipLevel';
import { pickLegWalls } from '../src/core/walls';
import { dealerOf } from '../src/core/dealerSign';
import { repricedFlip } from '../src/core/gammaFlip';
import { flowFocus, holdBoard } from '../src/data/twobook/engineBook';
import type { StrikeNode } from '../src/types/market';

/* the clock pinned to when the fixtures were recorded (Saturday 2026-11-07 10:00 ET, Friday's close book), so the dates the
   pages count as live are the recording's, whenever this runs */
const PIN = nyInstant('2026-11-07', 10 * 60);
const RealDate = Date;
class Pinned extends RealDate {
  constructor(...a: ConstructorParameters<typeof Date>) {
    if (a.length === 0) super(PIN);
    else super(...a);
  }
  static now() {
    return PIN;
  }
}
globalThis.Date = Pinned as DateConstructor;

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const close = (a: number, b: number, tol = 1e-9) => a === b || rel(a, b) <= tol;
const read = <T>(name: string): T | null => {
  const p = join(here, 'fixtures', 'twobook', name);
  return existsSync(p) ? (JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as T) : null;
};

/* a node's figure for one of the ten, in the dealer sign the pages print */
const LEG: Record<ExposureName, (n: StrikeNode, right: 'C' | 'P') => number> = {
  GEX: (n, r) => (r === 'C' ? n.callGex : n.putGex),
  DEX: (n, r) => (r === 'C' ? n.callDex : n.putDex),
  VEGA: (n, r) => (r === 'C' ? n.callVex : n.putVex),
  VANNA: (n, r) => (r === 'C' ? n.callVanna : n.putVanna),
  CHARM: (n, r) => (r === 'C' ? n.callCharm : n.putCharm),
  COLOR: (n, r) => n.higher?.color[r === 'C' ? 'call' : 'put'] ?? NaN,
  VOMMA: (n, r) => n.higher?.vomma[r === 'C' ? 'call' : 'put'] ?? NaN,
  SPEED: (n, r) => n.higher?.speed[r === 'C' ? 'call' : 'put'] ?? NaN,
  VETA: (n, r) => n.higher?.veta[r === 'C' ? 'call' : 'put'] ?? NaN,
  ZOMMA: (n, r) => n.higher?.zomma[r === 'C' ? 'call' : 'put'] ?? NaN,
};
const dealer = (n: StrikeNode, name: ExposureName) => dealerOf(LEG[name](n, 'C')) + dealerOf(LEG[name](n, 'P'));
const GREEK_OF: Record<Greek, ExposureName> = { gex: 'GEX', dex: 'DEX', vex: 'VEGA', vanna: 'VANNA', charm: 'CHARM', color: 'COLOR', vomma: 'VOMMA', speed: 'SPEED', veta: 'VETA', zomma: 'ZOMMA' };

/* the loaded entry a page would hold: its price and bars (none needed here), its chains replaced by the view */
function loadedEntry(ticker: string, spot: number): Entry {
  return { ticker, status: 'live', at: Date.now(), full: true, wantFull: true, spot, prev: spot, changePct: 0, iv: 0.2, impliedMove: 0, dayMoveFrac: 0, all: [], byDate: {}, expiries: [], flow: new Map(), candles: [], tape: [], history: [], termIv: {} };
}

function proveBook(ticker: string, mode: 'oi' | 'flow', wire: Model1Wire | FlowBoardWire, totals: Record<ExposureName, number>) {
  const tag = `${ticker} ${mode === 'oi' ? 'open-interest book' : 'flow book'}`;
  const legs = wire.legs!;
  /* 2. cells */
  const bad = EXPOSURE_NAMES.filter(n => !close(legsTotal(legs, n), totals[n]));
  check(`${tag}: Σ cells = board totals for all ten (${legs.cells.length} cells)${bad.length ? ` — off: ${bad.map(n => `${n} ${legsTotal(legs, n)} vs ${totals[n]}`).join(', ')}` : ''}`, !bad.length);

  /* 3. the chains every page reads */
  setBookMode(mode);
  if (mode === 'flow') flowFocus(ticker);
  holdBoard(ticker, mode, wire);
  const price = wire.model === 1 ? (wire.price as number) : (wire.spot?.S as number);
  cache.set(ticker, loadedEntry(ticker, price));
  const e = peekEntry(ticker)!;
  check(`${tag}: the page's entry is the engine's view of the chosen book (${e.engine?.mode})`, e.engine?.mode === mode && e.engine.wire === wire);
  const dates = Object.keys(e.byDate).sort();
  const perDate = (n: ExposureName) => dates.reduce((a, d) => a + e.byDate[d].reduce((b, x) => b + dealer(x, n), 0), 0);
  const whole = (n: ExposureName) => e.all.reduce((b, x) => b + dealer(x, n), 0);
  const offD = EXPOSURE_NAMES.filter(n => !close(perDate(n), totals[n]));
  const offA = EXPOSURE_NAMES.filter(n => !close(whole(n), totals[n]));
  check(`${tag}: Σ per-date chains (${dates.length} dates) = board totals, all ten${offD.length ? ` — off: ${offD.join(', ')}` : ''}`, !offD.length);
  check(`${tag}: Σ whole-book chain (${e.all.length} strikes) = board totals, all ten${offA.length ? ` — off: ${offA.join(', ')}` : ''}`, !offA.length);
  check(`${tag}: GEX ${totals.GEX.toExponential(6)} · DEX ${totals.DEX.toExponential(6)} · CHARM ${totals.CHARM.toExponential(6)} per ${wire.unit}`, true);

  /* 4. the Map's matrix: the page's snapshot, the surface it draws */
  const snap = materialize(e, 'ALL');
  const surface = buildExposureSurface(snap, 30);
  let cells = 0;
  let wrong = 0;
  surface.expiries.forEach((x, ei) => {
    const chain = x.iso ? e.byDate[x.iso] : null;
    if (!chain) return;
    const by = new Map(chain.map(n => [n.strike, n]));
    surface.strikes.forEach((k, si) => {
      const n = by.get(k);
      for (const g of GREEKS) {
        if (surface.priced[g][ei] === false) continue;
        const want = n ? LEG[GREEK_OF[g]](n, 'C') + LEG[GREEK_OF[g]](n, 'P') : 0;
        const got = surface.net[g][ei][si];
        cells++;
        if (!close(got, want, 1e-12)) wrong++;
      }
    });
  });
  check(`${tag}: the matrix draws the chain's own figure in every cell (${cells} cells over ${surface.expiries.length} dates × ${surface.strikes.length} strikes × ten greeks, ${wrong} off)`, cells > 0 && wrong === 0);
  check(`${tag}: the matrix's time unit is the board's (${surface.timeUnit})`, surface.timeUnit === wire.unit);

  /* 5. walls, flip, regime off the same per-strike values */
  const byStrike = new Map<number, { c: number; p: number }>();
  for (const row of legs.cells) {
    const k = row[LEG_AT.strike] as number;
    const s = byStrike.get(k) ?? { c: 0, p: 0 };
    s.c += row[LEG_AT.call] ?? 0;
    s.p += row[LEG_AT.put] ?? 0;
    byStrike.set(k, s);
  }
  let cw = 0;
  let pw = 0;
  let cwK: number | null = null;
  let pwK: number | null = null;
  for (const [k, s] of [...byStrike.entries()].sort((a, b) => a[0] - b[0])) {
    if (Math.abs(s.c) > cw) [cw, cwK] = [Math.abs(s.c), k];
    if (Math.abs(s.p) > pw) [pw, pwK] = [Math.abs(s.p), k];
  }
  const walls = pickLegWalls(snap.chain, n => n.callGex, n => n.putGex);
  check(`${tag}: walls off the chain = the cells' largest call and put GEX (call ${walls.callWall} / ${cwK}, put ${walls.putWall} / ${pwK})`, walls.callWall === cwK && walls.putWall === pwK);
  const flip = levelFlip(snap, snap.chain);
  const legsSum = snap.chain.reduce((a, n) => a + n.netGex, 0);
  check(`${tag}: the flip reads the engine's legs (complete ${flip.complete}, flip ${flip.flip?.toFixed(2) ?? 'none within ±10%'})`, e.engine?.sixIn === flip.complete);
  /* re-priced at the board's own price, the legs are the board's GEX (house sign is the negative) */
  const atOwn = repricedFlip(enginLegsOf(snap, e), price, e.engine!.r, undefined, 0);
  check(`${tag}: the flip's legs add to the chain's net (${dealerOf(legsSum).toExponential(6)}) and, at the board's price, to the board's GEX (${dealerOf(atOwn.netAtSpot).toExponential(6)})`, close(dealerOf(legsSum), totals.GEX) && close(dealerOf(atOwn.netAtSpot), totals.GEX));
  check(`${tag}: the regime is the sign of that net (${regimeOfNet(flip.netAtSpot)})`, regimeOfNet(flip.netAtSpot) === regimeOfNet(atOwn.netAtSpot));
  return e;
}

/* the flip's own leg set for the whole book (flipLevel.ts engineLegSet) */
const enginLegsOf = (snap: ReturnType<typeof materialize>, e: Entry) => engineLegsFor(snap, snap.chain, e);

const names = ['SPY', 'SPX'];
let books = 0;
for (const t of names) {
  const m1 = read<{ inputs: Parameters<typeof model1Board>[0]; served: { four: Model1Wire['four']; six: Model1Wire['six']; at: number; price: number } }>(`${t.toLowerCase()}-model1.json.gz`);
  if (!m1) check(`${t}: open-interest fixture recorded`, false);
  else {
    const w = model1Board(m1.inputs);
    const totals = Object.fromEntries([...Object.entries(w.four ?? {}), ...Object.entries(w.six ?? {})].map(([k, v]) => [k, v.value])) as Record<ExposureName, number>;
    const served = Object.fromEntries([...Object.entries(m1.served.four ?? {}), ...Object.entries(m1.served.six ?? {})].map(([k, v]) => [k, v.value])) as Record<ExposureName, number>;
    check(`${t} open-interest book: rebuilt from the recorded rows = the server's answer, all ten (priced at ${w.price}, ${w.legs?.dates.length} dates)`, EXPOSURE_NAMES.every(n => close(totals[n], served[n], 1e-12)) && w.price === m1.served.price);
    proveBook(t, 'oi', w, totals);
    books++;
  }
  const m2 = read<{ inputs: FlowInputs; served: { totals: Record<string, number>; valuedAt: number } }>(`${t.toLowerCase()}-flow.json.gz`);
  if (!m2) check(`${t}: flow fixture recorded`, false);
  else {
    const i = m2.inputs;
    const w = flowBoardOf(viewOf(i.view), i.quotes, i.valuedAt, i.rate, i.quotesAt);
    const totals = w.totals as Record<ExposureName, number>;
    check(`${t} flow book: rebuilt from the recorded inventory and quotes = the server's answer, all ten (${w.flow.prints.toLocaleString()} prints, S* ${w.spot?.S.toFixed(4)})`, EXPOSURE_NAMES.every(n => close(totals[n], m2.served.totals[n], 1e-12)));
    const e = proveBook(t, 'flow', w, totals);
    /* 6. never added: no open interest in the flow book's chains */
    check(`${t} flow book: no open interest on any of its strikes`, e.all.every(n => n.callOI === 0 && n.putOI === 0));
    setBookMode('oi');
    const back = peekEntry(t)!;
    check(`${t}: switching back hands every page the open-interest chains (${back.engine?.mode})`, back.engine?.mode === 'oi' && back.all !== e.all);
    books++;
  }
}
check(`books proved: ${books} of ${names.length * 2}`, books === names.length * 2);
if (fail) {
  console.log(`twobook-map-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log('twobook-map-proof OK: the Map, its walls, flip and regime read the engine’s cells; Σ cells = the board, both books, SPY and SPX');
