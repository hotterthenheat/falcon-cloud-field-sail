/*
  What moved off the old path (docs/OLD_PATH_AUDIT.md), proved on the recorded SPY and SPX books (scripts/fixtures/twobook):
    1. the exposure recorder's engine record (item 1): each held open-interest board becomes one line of its own file —
       every strike within the field's window, its GEX = Σ of the board's cells at that strike = the board's own by-strike
       GEX built from the listed rows (an independent sum, 1e-9) — written by a recorder pass with no vendor call, kept
       apart from the listing's series (basis=engine), and the listing's series carries no engine cut;
    2. the Board (item 2): on the Flow switch only the names the Map follows are drawn from the flow book; every other
       name stays on the open-interest book, and the page labels each row (Board.tsx RowBook);
    3. Building (item 4): while a page holds the open-interest book, a focused name on the Flow switch is drawn from
       the open-interest book, and Building values each contract's open-interest change at that book's own dollar gamma per
       contract (|GEX| / OI off the board's cells) — never the flow book's, which has no open interest;
    4. the open-interest board's wire (item 5): encoded once per board, and the bytes decode to the board exactly
       (every one of the cells' figures bit for bit).
  Run: node --import tsx scripts/old-path-proof.ts
*/
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nyInstant } from '../shared/marketSession.mjs';
import { model1Board, type Model1Wire } from '../src/data/twobook/model1';
import { flowBoardOf, viewOf, type FlowInputs } from '../src/data/twobook/flowBook';
import { LEG_AT } from '../src/data/twobook/legs';
import { setBookMode } from '../src/data/bookMode';
import { cache, peekEntry, type Entry } from '../src/data/book/store';
import { materialize } from '../src/data/book/levels';
import { valueOiChange } from '../src/data/building';
import { bookFor, flowFocus, holdBoard, holdOiBook, oiBookHeld } from '../src/data/twobook/engineBook';
import { ENGINE_CUT, engineLineOf, startExposureRecorder } from '../src/data/exposureRecorder';
import { encodedBoard } from '../src/data/twobook/model1Server';
import type { OiChange } from '../src/data/book/oiChange';

/* the recording's clock: Friday 2026-11-06 16:16 ET, a minute after the boards' rows were stamped (16:15) */
const PIN = nyInstant('2026-11-06', 16 * 60 + 16);
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
const read = <T>(name: string): T | null => {
  const p = join(here, 'fixtures', 'twobook', name);
  return existsSync(p) ? (JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as T) : null;
};
const loadedEntry = (ticker: string, spot: number): Entry =>
  ({ ticker, status: 'live', at: Date.now(), full: true, wantFull: true, spot, prev: spot, changePct: 0, iv: 0.2, impliedMove: 0, dayMoveFrac: 0, all: [], byDate: {}, expiries: [], flow: new Map(), candles: [], tape: [], history: [], termIv: {} }) as unknown as Entry;

const boards = new Map<string, Model1Wire>();
for (const t of ['SPY', 'SPX']) {
  const m1 = read<{ inputs: Parameters<typeof model1Board>[0] }>(`${t.toLowerCase()}-model1.json.gz`);
  if (!m1) {
    check(`${t}: open-interest fixture recorded`, false);
    continue;
  }
  boards.set(t, model1Board(m1.inputs));
}

/* ---- 1. the recorder's engine record ---- */
for (const [t, w] of boards) {
  const line = engineLineOf(w, Date.now());
  const byStrike = new Map(w.byStrike.map(([k, gex]) => [k, gex]));
  let worst = 0;
  let missing = 0;
  for (const [k, , gex] of line?.r ?? []) {
    const want = byStrike.get(k);
    if (want == null) missing++;
    else worst = Math.max(worst, rel(gex, want));
  }
  const inWindow = w.byStrike.filter(([k]) => Math.abs(k - (w.price as number)) <= (w.price as number) * 0.05).length;
  check(`${t}: the engine line holds every strike within 5% of ${w.price} (${line?.r.length} of ${inWindow}) at the board's instant`, !!line && line.r.length === inWindow && line.at === w.at && line.c === ENGINE_CUT);
  check(`${t}: each strike's GEX on the engine line = the board's own by-strike GEX from the listed rows (worst ${worst.toExponential(2)}, ${missing} missing)`, !!line && missing === 0 && worst <= 1e-9);
  /* the cells added at a strike are the line's figure exactly (the same sum) */
  const k0 = line!.r[Math.floor(line!.r.length / 2)][0];
  const cellSum = w.legs!.cells.filter(c => c[LEG_AT.strike] === k0).reduce((a, c) => a + (c[LEG_AT.call] ?? 0) + (c[LEG_AT.put] ?? 0), 0);
  check(`${t}: at ${k0} the line is Σ of the board's cells there (${cellSum.toExponential(6)})`, line!.r.find(r => r[0] === k0)![2] === cellSum);
}
{
  const dir = mkdtempSync(join(tmpdir(), 'oldpath-rec-'));
  let calls = 0;
  let recNow = PIN;
  const rec = startExposureRecorder({
    dir,
    uw: async () => {
      calls++;
      return { status: 404, body: '{}', at: Date.now() };
    },
    manual: true,
    now: () => recNow,
    house: ['SPY', 'SPX'],
    front: false,
    engine: t => boards.get(t) ?? null,
  });
  const before = calls;
  const rep = await rec.tick();
  const listingCalls = calls - before;
  check(`a recorder pass writes one engine line a held board (${rep?.engine ?? 0} of ${boards.size}) and asks the vendor for nothing more than the listing's own reads (${listingCalls} asks, ${rep?.asks} counted)`, rep?.engine === boards.size && listingCalls === rep?.asks);
  for (const [t, w] of boards) {
    const eng = rec.day(t, '2026-11-06', 0, 'engine');
    const lst = rec.day(t, '2026-11-06', 0, 'listing');
    const line = engineLineOf(w, PIN)!;
    const got = new Map((eng?.series ?? []).map(([cut, k, segs]) => [`${cut}|${k}`, segs]));
    const same = line.r.every(([k, , gex]) => {
      const segs = got.get(`${ENGINE_CUT}|${k}`);
      return !!segs && segs[2] === gex;
    });
    check(`${t}: /api/exposure/day?basis=engine serves the board's GEX at every strike (${eng?.series.length} series, basis ${eng?.basis})`, eng?.basis === 'engine' && eng.series.length === line.r.length && same);
    check(`${t}: the listing's series (the field's history) carries no engine cut`, (lst?.series ?? []).every(([cut]) => cut !== ENGINE_CUT) && lst?.basis === 'listing');
  }
  /* the next pass (two minutes on, after hours), the same boards: nothing new to write */
  recNow = PIN + 120_000;
  const rep2 = await rec.tick();
  check(`the same board is not written twice (the next pass ran: ${!!rep2}, engine lines ${rep2?.engine ?? 0})`, !!rep2 && (rep2.engine ?? 0) === 0);
  rec.stop();
  rmSync(dir, { recursive: true, force: true });
}

/* ---- 2 and 3. which book a name is drawn from; Building on the open-interest book ---- */
const spy = boards.get('SPY');
const flowFx = read<{ inputs: FlowInputs }>('spy-flow.json.gz');
if (spy && flowFx) {
  const i = flowFx.inputs;
  const flowW = flowBoardOf(viewOf(i.view), i.quotes, i.valuedAt, i.rate, i.quotesAt);
  holdBoard('SPY', 'oi', spy);
  holdBoard('SPY', 'flow', flowW);
  holdBoard('QQQ', 'oi', spy);
  cache.set('SPY', loadedEntry('SPY', spy.price as number));
  setBookMode('flow');
  flowFocus('SPY');
  check('Board: on the Flow switch a name the Map follows is drawn from the flow book', bookFor('SPY') === 'flow' && peekEntry('SPY')?.engine?.mode === 'flow');
  check('Board: a name the Map does not follow stays on the open-interest book (its row says so)', bookFor('QQQ') === 'oi');
  const flowEntry = peekEntry('SPY')!;
  check('the flow book carries no open interest (so it cannot value an open-interest change)', flowEntry.all.every(n => n.callOI === 0 && n.putOI === 0));
  const release = holdOiBook();
  const held = peekEntry('SPY')!;
  check('Building: while it holds the open-interest book, the focused name on the Flow switch is drawn from the open-interest book', oiBookHeld() && bookFor('SPY') === 'oi' && held.engine?.mode === 'oi' && held.engine.wire === spy);
  /* an open-interest change on the ten largest open-interest contracts of the front date, valued as Building values it */
  const snap = materialize(held, 'ALL');
  const date = Object.keys(held.byDate).sort()[0];
  const chain = held.byDate[date];
  const big = [...chain].filter(n => n.callOI > 0 && n.callGex !== 0).sort((a, b) => b.callOI - a.callOI).slice(0, 10);
  const change: OiChange = { rows: big.map(n => ({ expiry: date, strike: n.strike, right: 'C' as const, diff: 100, currDate: '2026-11-06', lastDate: '2026-11-05' })), lastDate: '2026-11-05', currDate: '2026-11-06', depth: 'full', source: 'terminal' };
  const valued = valueOiChange(snap, snap.chain, change, '2026-11-06');
  let worst = 0;
  for (const n of big) {
    const v = valued.get(n.strike);
    /* the call leg is valued −diff × dollar gamma per contract (house sign); the open-interest book's is |GEX| / OI */
    const want = (-100 * Math.abs(n.callGex)) / n.callOI;
    worst = Math.max(worst, v ? rel(v.callAlt ?? NaN, want) : 1);
  }
  check(`Building: each contract's change is valued at the open-interest book's own dollar gamma per contract (${big.length} contracts on ${date}, worst ${worst.toExponential(2)})`, big.length === 10 && worst <= 1e-12);
  release();
  check('released, the focused name follows the Flow switch again', !oiBookHeld() && bookFor('SPY') === 'flow' && peekEntry('SPY')?.engine?.mode === 'flow');
  release();
  check('a second release changes nothing', !oiBookHeld());
  setBookMode('oi');
} else check('SPY open-interest and flow fixtures recorded', false);

/* ---- 4. the wire: encoded once, decoded exactly ---- */
for (const [t, w] of boards) {
  const a = encodedBoard(w);
  const b = encodedBoard(w);
  const back = JSON.parse(gunzipSync(a.gz!).toString('utf8')) as Model1Wire;
  let off = 0;
  w.legs!.cells.forEach((row, r) => row.forEach((v, k) => {
    if (!Object.is(v, back.legs!.cells[r][k])) off++;
  }));
  check(`${t}: the board is encoded once (${(a.gz!.length / 1e6).toFixed(2)} MB gzipped) and its ${w.legs!.cells.length} cells × ${w.legs!.cells[0].length} figures decode bit for bit (${off} off)`, a === b && off === 0 && back.version === w.version);
}

if (fail) {
  console.log(`old-path-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log('old-path-proof OK: the recorder\'s engine record is the board, Building reads the open-interest book, the Board says which book each row is, the wire is exact');
