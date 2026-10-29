/*
  Compass's math, locked.

  1. Model inputs: the 56 columns for one contract (SPY 505C at 10:30 ET) on a hand-built session
     (scripts/golden/compassScenario.ts), and Model 1 / Model 2 on that row. Every expected column and both
     probabilities come from scripts/golden/compass-ref.py: an independent Python rebuild of the columns from their
     definitions, scored by LightGBM 4.7's own Booster.predict on public/models/*_all6months.txt. The simple columns
     are also checked by hand in the comment beside them.
  2. The entry gate (compassParams): the session marks (every session, 09:30 on, overnight), scoring at those marks,
     the spread, Book A and Book B, the theta burn, by hand.
  3. A signal's outcome (compassOutcome.settleSignal) on hand-built minute quotes: fill, stop, take-profit, the
     ratchet, the reversal, the flat, Book C, and a missing fill.
  4. The same on recorded ThetaData (set compass-2026-10-29): one SPY contract's one-minute NBBO and SPY's bars, read
     by the app's own loaders. It runs once the set has been recorded against a live terminal
     (GOLDEN_RECORD=1 on a machine whose terminal answers) and its expected values hand-checked into
     scripts/fixtures/golden/compass-2026-10-29/expected.json; until then it says so and is skipped.

  Replay: npx tsx scripts/golden/compass-golden.ts
  Report the computed row: GOLDEN_REPORT=1 npx tsx scripts/golden/compass-golden.ts
*/
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures } from './uwFixtures';
import { CHAIN, CONTRACT, DAY, MINUTE, PRIOR, curveBars, pinBook, sessionBars } from './compassScenario';
import { atmPair, curveFrom, features, yearsLeft } from '../../src/data/compassFeatures';
import { optionScanOpen } from '../../src/data/compassSession';
import { f32, bookAPass, bookBPass, onScanGrid, sessionScanOpen, spreadPass, strikeDistance, strikeSpan, thetaBurns, P1_MIN } from '../../src/data/compassParams';
import { parseBoosters, predict } from '../../src/data/lgbm';
import { settleSignal, type PathQuote } from '../../src/data/compassOutcome';
import { nyWallTime } from '../../src/core/nyTime';
import type { Setup } from '../../src/types/compass';

const here = dirname(fileURLToPath(import.meta.url));
const REPORT = process.env.GOLDEN_REPORT === '1';

/* ---- 1. the 56 inputs and the two models ------------------------------------------------------------------- */

const stub = (strike: number, right: 'C' | 'P', bid: number, ask: number, spot = 0) =>
  ({ id: `SPY-${strike}-${right}`, ticker: 'SPY', contract: `SPY ${strike}${right}`, strike, right, bid, ask, mid: (bid + ask) / 2, spot, sleeve: 'odte', expiryDate: '2026-10-28' }) as unknown as Setup;

const bars = sessionBars();
const S = bars[60].o;
const T = yearsLeft(60);
const pair = atmPair(CHAIN.map(r => stub(r.strike, r.right, r.bid, r.ask)), S, T);
const curve = curveFrom(curveBars());
const raw = features(stub(CONTRACT.strike, CONTRACT.right, CONTRACT.bid, CONTRACT.ask, S), MINUTE, bars, bars, PRIOR, pair.iv, pair.skew, [], curve, pinBook(), { m5: CONTRACT.m5, m15: CONTRACT.m15 });
if (!raw) throw new Error('compass golden: the row did not build');
const x = f32(raw);
if (REPORT) console.log(`REPORT row = ${JSON.stringify(x.map(v => (Number.isNaN(v) ? null : v)))}`);

const ref = JSON.parse(readFileSync(join(here, 'compass-ref.json'), 'utf8')) as { x: (number | null)[]; entry: number; runner: number };
/* Hand checks on the plain columns (S = o60 = 503 + 0.3·sin 60 = 503 - 0.091443 = 502.908557, open o0 = 500): */
expectNear('x0 minutes after 09:30', x[0], 60, 0);
expectNear('x1 S/open - 1 = 502.908557/500 - 1', x[1], 0.0058171, 1e-6);
expectNear('x15 390 - t', x[15], 330, 0);
expectNear('x12 S/prior high - 1 = 502.908557/505 - 1', x[12], -0.0041415, 1e-6);
expectNear('x14 open/prior close - 1 = 500/499 - 1', x[14], 0.0020040, 1e-6);
expectNear('x30 K/S - 1 = 505/502.908557 - 1', x[30], 0.0041587, 1e-6);
expectNear('x32 mid = (1.20 + 1.24)/2', x[32], 1.22, 1e-6);
expectNear('x33 spread/mid = 0.04/1.22', x[33], 0.0327869, 1e-6);
expectNear('x34 mid/mid 5 back - 1 = 1.22/1.10 - 1', x[34], 0.1090909, 1e-6);
expectNear('x35 mid/mid 15 back - 1 = 1.22/1.00 - 1', x[35], 0.22, 1e-6);
/* x43: the 505C open interest, 1000 + 300·7 = 3100; x44: SPY is an index-class root; x45: not high beta */
expectEqual('x43 contract open interest', x[43], 3100);
expectEqual('x44 index class', x[44], 1);
expectEqual('x45 high-beta class', x[45], 0);
/* x22, x23: SPY has no sector ETF */
expectEqual('x22 sector 15-minute return is missing', Number.isNaN(x[22]), true);
/* Every column against the independent rebuild (float32 on both sides) */
let worst = 0;
let worstAt = -1;
for (let i = 0; i < 56; i++) {
  const want = ref.x[i];
  const got = x[i];
  if (want == null) {
    if (!Number.isNaN(got)) { worst = Infinity; worstAt = i; }
    continue;
  }
  const err = Math.abs(got - want) / Math.max(1, Math.abs(want));
  if (err > worst) { worst = err; worstAt = i; }
}
console.log(`${worst <= 1e-6 ? 'PASS' : 'FAIL'}  56 columns against the reference: worst relative error ${worst.toExponential(2)} at x${worstAt}`);
expectNear('56 columns match the reference', worst, 0, 1e-6);

const load = (name: string) => {
  const trees = parseBoosters(readFileSync(join(here, '..', '..', 'public', 'models', name), 'utf8'), 300);
  if (!trees) throw new Error(`${name} did not parse`);
  return trees;
};
const refRow = ref.x.map(v => (v == null ? NaN : Math.fround(v)));
const ENTRY = load('model_entry_all6months.txt');
const RUNNER = load('model_runner_all6months.txt');
expectNear('Model 1 on the reference row = LightGBM', predict(ENTRY, refRow), ref.entry, 1e-9);
expectNear('Model 2 on the reference row = LightGBM', predict(RUNNER, refRow), ref.runner, 1e-9);
expectNear('Model 1 on the computed row', predict(ENTRY, x), ref.entry, 1e-6);
expectNear('Model 2 on the computed row', predict(RUNNER, x), ref.runner, 1e-6);

/* ---- 2. the entry gate ------------------------------------------------------------------------------------- */

/* Every session mark scores: 09:30 and 09:35 (t = 0, 5), the 09:29 VIX mark, the 15:59 and 16:14 stops, and the
   overnight index session (21:00 ET is t = 690; Thursday is weekday 4). 09:27 is the halt; Saturday is shut. */
expectEqual('grid 09:30', onScanGrid(0), true);
expectEqual('grid 09:35', onScanGrid(5), true);
expectEqual('grid 09:29 (VIX)', onScanGrid(-1), true);
expectEqual('grid 09:27 halt', onScanGrid(-3), false);
expectEqual('grid 15:59 stop', onScanGrid(389), true);
expectEqual('grid 16:14 stop', onScanGrid(404), true);
expectEqual('grid 21:00 overnight', onScanGrid(690), true);
expectEqual('session open 09:30 Thu', sessionScanOpen(570, 4), true);
expectEqual('session open 21:00 Thu', sessionScanOpen(1260, 4), true);
expectEqual('session shut 12:00 Sat', sessionScanOpen(720, 6), false);
/* pre-market: the index roots trade it as the tail of their overnight session; SPY/QQQ/IWM options open at 08:00 ET.
   A name whose options are shut is never scored on a stock print. Thursday Oct 29, EDT (UTC-4). */
{
  const pm = (h: number, m: number) => Date.parse(`2026-10-29T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:05Z`);
  expectEqual('grid 04:00 pre-market', sessionScanOpen(240, 4), true);
  expectEqual('grid 08:00 pre-market', sessionScanOpen(480, 4), true);
  expectEqual('SPXW scanned at 04:00 ET', optionScanOpen('SPXW', 0, pm(4, 0)), true);
  expectEqual('VIX scanned at 06:00 ET', optionScanOpen('VIX', 0, pm(6, 0)), true);
  expectEqual('SPY not scanned at 06:00 ET (its options are shut)', optionScanOpen('SPY', 0, pm(6, 0)), false);
  expectEqual('SPY scanned at 08:00 ET', optionScanOpen('SPY', 0, pm(8, 0)), true);
  expectEqual('SPXW off in the 09:25 halt', optionScanOpen('SPXW', 0, pm(9, 27)), false);
  /* per-root hours, each checked against real trades by scripts/compass-hours-check.ts (sessions of Oct 26-28) */
  /* Wednesday Oct 28, EDT: Date.UTC rolls 21:00 ET into Thursday 01:00 UTC */
  const pmPrev = (h: number, m: number) => Date.UTC(2026, 9, 28, h + 4, m, 5);
  expectEqual('NDXP has no overnight session (21:00 ET)', optionScanOpen('NDXP', 1, pmPrev(21, 0)), false);
  expectEqual('RUTW trades overnight (21:00 ET)', optionScanOpen('RUTW', 1, pmPrev(21, 0)), true);
  expectEqual('SPXW 1DTE in the curb at 16:30', optionScanOpen('SPXW', 1, pmPrev(16, 30)), true);
  expectEqual('RUTW 1DTE closed at 16:30 (its curb ends 16:15)', optionScanOpen('RUTW', 1, pmPrev(16, 30)), false);
  expectEqual('SLV trades to 16:15 (16:10)', optionScanOpen('SLV', 1, pmPrev(16, 10)), true);
  expectEqual('XLF has no pre-market (08:00)', optionScanOpen('XLF', 1, pm(8, 0)), false);
  expectEqual('XLF trades to 16:15 (16:10)', optionScanOpen('XLF', 1, pmPrev(16, 10)), true);
  expectEqual('KO closes at 16:00 (16:05)', optionScanOpen('KO', 1, pmPrev(16, 5)), false);
}
/* Scored at those marks: the row builds and both models answer, with column 0 as it is (0, 5, 690), not clamped */
for (const [label, minute, t] of [['09:30', 570, 0], ['09:35', 575, 5]] as const) {
  const row = features(stub(CONTRACT.strike, CONTRACT.right, CONTRACT.bid, CONTRACT.ask, S), minute, bars, bars, PRIOR, pair.iv, pair.skew, [], curve, pinBook(), { m5: NaN, m15: NaN });
  expectEqual(`row builds at ${label}`, row != null, true);
  const v = f32(row ?? []);
  expectEqual(`column 0 at ${label}`, v[0], t);
  expectEqual(`Model 1 answers at ${label}`, Number.isFinite(predict(ENTRY, v)), true);
}
{
  /* SPXW 7740C overnight at 21:00 ET: no session bars yet, so the tape stands on the quote's spot (7740) */
  const spxw = { ...stub(7740, 'C', 12.0, 12.4, 7740), id: 'SPXW-7740-C', ticker: 'SPXW', contract: 'SPXW 7740C' } as Setup;
  const row = features(spxw, 21 * 60, [], bars, null, NaN, NaN, [], null, null, { m5: NaN, m15: NaN });
  expectEqual('SPXW row builds at 21:00', row != null, true);
  const v = f32(row ?? []);
  expectEqual('SPXW column 0 at 21:00 is 690', v[0], 690);
  expectEqual('SPXW Model 1 answers at 21:00', Number.isFinite(predict(ENTRY, v)), true);
}
/* The grid: every 5 minutes; 10:32 is not on it */
expectEqual('grid 10:30', onScanGrid(60), true);
expectEqual('grid 10:32', onScanGrid(62), false);
/* Spread: bid over 0.15 and (ask - bid)/mid at most 8%. 1.20 × 1.24 is 3.3%; 1.00 × 1.09 is 8.6%; 0.15 bid fails. */
expectEqual('spread 1.20 × 1.24 passes', spreadPass(1.2, 1.24), true);
expectEqual('spread 1.00 × 1.09 fails (8.6%)', spreadPass(1.0, 1.09), false);
expectEqual('bid 0.15 fails', spreadPass(0.15, 0.16), false);
/* SPY 501–507 at S 502.909: ATM is 503, so 505 is 2 strikes out; SPY is an index-class root, span 4 */
const strikes = [501, 502, 503, 504, 505, 506, 507];
expectEqual('505 is 2 strikes from 503', strikeDistance(strikes, S, 505), 2);
expectEqual('index-class span is 4', strikeSpan(S, strikes, true), 4);
/* A single name with $1 strikes at 100: 6% of 100 is 6 strikes */
expectEqual('single-name span 6% of 100 / $1', strikeSpan(100, Array.from({ length: 21 }, (_, i) => 90 + i), false), 6);
expectEqual('Book A at 70.67%', bookAPass(60, 2, 4, 0, 1.2, 1.24, P1_MIN), true);
expectEqual('Book A at 70.66%', bookAPass(60, 2, 4, 0, 1.2, 1.24, 0.7066), false);
expectEqual('Book A off the grid', bookAPass(62, 2, 4, 0, 1.2, 1.24, 0.8), false);
expectEqual('Book A 5 strikes out', bookAPass(60, 5, 4, 0, 1.2, 1.24, 0.8), false);
/* Book B: 8–12 strikes out (span 4), ask at most $1 and at most half its ask 30 minutes earlier */
expectEqual('Book B 0.40 × 0.42 from 0.90', bookBPass(60, 9, 4, 0, 0.4, 0.42, 0.85, 0.9, 0.8), true);
expectEqual('Book B not half (0.42 vs 0.80)', bookBPass(60, 9, 4, 0, 0.4, 0.42, 0.78, 0.8, 0.8), false);
expectEqual('Book B too near (7 out)', bookBPass(60, 7, 4, 0, 0.4, 0.42, 0.85, 0.9, 0.8), false);
/* Theta burn: |theta/day·365|·dt ≥ 0.5322·ask. -0.50/day over 40 minutes (40/(390·252) y): 182.5·0.000407 = 0.0743 < 0.5322·0.20 = 0.1064 holds; at ask 0.12 it burns (0.0639). */
expectEqual('theta does not burn at ask 0.20', thetaBurns(-0.5, 0.01, 0.2, 40 / (390 * 252)), false);
expectEqual('theta burns at ask 0.12', thetaBurns(-0.5, 0.01, 0.12, 40 / (390 * 252)), true);

/* ---- 3. a signal's outcome on hand-built minute quotes ------------------------------------------------------ */

const at = (h: number, m: number, s = 0) => nyWallTime(2026, 10, 28, h, m) + s * 1000;
const q = (h: number, m: number, bid: number, ask: number, s = 0): PathQuote => ({ t: at(h, m, s), bid, ask });
const fired = at(10, 30, 12);
const after = at(17, 0);

/* Fill: the first quote stamped 10:31:00 or later; 10:30:40 is inside the call's minute and is not it. */
let o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [q(10, 30, 1.18, 1.22, 40), q(10, 31, 1.21, 1.25), q(10, 32, 1.3, 1.34)], [], at(10, 33));
expectEqual('fill at the 10:31 ask', o.fill?.ask, 1.25);
expectEqual('open after the fill', o.status, 'open');
/* Stop: 0.4678 × 1.25 = 0.58475; the 10:40 bid 0.58 is through it */
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [q(10, 31, 1.21, 1.25), q(10, 35, 0.9, 0.94), q(10, 40, 0.58, 0.62)], [], after);
expectEqual('stop exit', [o.status, o.exit?.why, o.exit?.px], ['closed', 'Stop', 0.58]);
/* return (0.58/1.25 - 1) = -53.6%; pnl (0.58 - 1.25)·100 - fees; fees 1.08 + 58·0.0000206·100… = 1.08 + 0.0012 → 1.08 */
expectEqual('stop return', o.ret, -53.6);
expectNear('stop pnl after fees', o.pnl ?? NaN, -68.08, 1e-9);
/* Take-profit for a non-runner: bid ≥ 1.50 × 1.25 = 1.875 sells at 1.88 (1.875 rounded to the cent) */
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [q(10, 31, 1.21, 1.25), q(10, 50, 1.9, 1.94)], [], after);
expectEqual('take-profit exit', [o.exit?.why, o.exit?.px, o.ret], ['Take profit 1.50×', 1.88, 50.4]);
/* Runner: peak 2.60 (≥ 2× 1.25) lifts the stop to 1.50 × 1.25 = 1.875; the 11:30 bid 1.85 is through it */
o = settleSignal({ book: 'A', right: 'C', runner: true, firedAt: fired }, [q(10, 31, 1.21, 1.25), q(11, 0, 2.6, 2.66), q(11, 30, 1.85, 1.9)], [], after);
expectEqual('runner ratchet stop', [o.exit?.why, o.exit?.px], ['Stop', 1.85]);
/* Reversal: SPY's close at 10:44 (bar 10:44) 500.0 against 10:39's 502.5 is -0.995%; a call with bid 1.20 under the 1.25 fill and within 15% leaves at the 10:45 bid with the small-loss line */
const under = [{ t: at(10, 39), c: 502.5 }, { t: at(10, 44), c: 500 }];
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [q(10, 31, 1.21, 1.25), q(10, 45, 1.2, 1.24)], under, after);
expectEqual('reversal exit', [o.exit?.why, o.exit?.px], ['Get out. Small loss. The stock reversed over the last 5 minutes.', 1.2]);
/* Flat: the first quote at or after 15:55 */
o = settleSignal({ book: 'B', right: 'P', runner: true, firedAt: fired }, [q(10, 31, 0.4, 0.42), q(15, 54, 0.45, 0.47), q(15, 55, 0.44, 0.46)], [], after);
expectEqual('flat at 15:55', [o.exit?.why, o.exit?.px, o.exit?.at], ['15:55 flat', 0.44, at(15, 55)]);
/* Early close (13:00 ET, minute 780): the flat is the first quote at or after 12:55 */
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired, closeMin: 780 }, [q(10, 31, 1.21, 1.25), q(12, 54, 1.3, 1.34), q(12, 55, 1.31, 1.35)], [], after);
expectEqual('early close: flat at 12:55', [o.exit?.why, o.exit?.px, o.exit?.at], ['12:55 flat', 1.31, at(12, 55)]);
/* Book C: 3× the 0.50 fill (1.50) inside 120 seconds sells at 1.50 */
const firedC = at(15, 20, 5);
o = settleSignal({ book: 'C', right: 'C', runner: false, firedAt: firedC }, [q(15, 21, 0.45, 0.5), q(15, 21, 1.2, 1.3, 40), q(15, 22, 1.55, 1.6, 30)], [], after);
expectEqual('Book C 3× within 120 s', [o.exit?.why, o.exit?.px], ['3×', 1.5]);
/* No quote in the three minutes after the call: unavailable once three minutes have passed */
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [q(10, 40, 1.2, 1.24)], [], at(10, 34));
expectEqual('no fill quote: unavailable', o.status, 'unavailable');
o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: fired }, [], [], at(10, 32));
expectEqual('before three minutes: still waiting', o.status, 'waiting');

/* ---- 4. recorded ThetaData ---------------------------------------------------------------------------------- */

const SET = 'compass-2026-10-29';
const setDir = join(here, '..', 'fixtures', 'golden', SET);
const expectedFile = join(setDir, 'expected.json');
if (process.env.GOLDEN_RECORD === '1' || existsSync(expectedFile)) {
  /* A fixed contract and instant inside the recorded session: SPY 2026-10-28 0DTE 770C, called 10:30:05 ET. */
  const RECORDED = { ticker: 'SPY', expiry: '2026-10-28', strike: 770, right: 'C' as const, day: '2026-10-28', book: 'A' as const, firedAt: nyWallTime(2026, 10, 28, 10, 30) + 5000 };
  installUwFixtures(SET);
  freezeClock('2026-10-29T00:00:00Z');
  const { openFeeds } = await import('../../src/data/feedGate');
  openFeeds();
  const { contractPath } = await import('../../src/data/compassLedger');
  const { underCloses } = await import('../../src/data/compassModel');
  const quotes = await contractPath(RECORDED, null);
  const underRows = await underCloses('SPY', '20261028');
  if (!quotes) throw new Error('recorded path did not load');
  const out = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: RECORDED.firedAt }, quotes, underRows, Date.now());
  if (existsSync(expectedFile)) {
    const want = JSON.parse(readFileSync(expectedFile, 'utf8')) as { fillAsk: number; exitPx: number; exitWhy: string; exitAt: string; quotes: number };
    expectEqual('recorded: minute quotes read', quotes.length, want.quotes);
    expectNear('recorded: fill ask', out.fill?.ask ?? NaN, want.fillAsk, 1e-9);
    expectNear('recorded: exit', out.exit?.px ?? NaN, want.exitPx, 1e-9);
    expectEqual('recorded: why', out.exit?.why, want.exitWhy);
  } else {
    console.log(`RECORDED ${SET}: ${quotes.length} quotes, ${underRows.length} bars; outcome ${JSON.stringify(out)}. Check it against the raw rows, then write ${expectedFile}.`);
  }
} else {
  console.log(`SKIP  ${SET}: not recorded yet (needs a live ThetaData terminal; see the header).`);
}
void DAY;

/* ---- 5. a missed mark, scored late from the quotes ThetaData recorded at it ---------------------------------- */
/* RUTW 0DTE at the 10:15 ET mark of 2026-10-29 (the browser scan called RUTW 2845C live there). The engine asks
   option/at_time/quote for 10:15:00.000: every quote it scores must be stamped at or before the mark. */

const LATE_SET = 'compass-late-2026-10-29';
const lateDir = join(here, '..', 'fixtures', 'golden', LATE_SET);
const lateExpected = join(lateDir, 'expected.json');
if (process.env.GOLDEN_RECORD === '1' || existsSync(lateExpected)) {
  installUwFixtures(LATE_SET);
  freezeClock('2026-10-29T18:10:00Z');
  const { openFeeds } = await import('../../src/data/feedGate');
  openFeeds();
  const { thetaCall } = await import('../../src/data/theta');
  const { setCompassHost } = await import('../../src/data/compassHost');
  setCompassHost({
    server: true,
    theta: (p, jump) => thetaCall(p, jump),
    asset: async p => {
      const b = readFileSync(join(here, '..', '..', 'public', p.replace(/^\/+/, '')));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    econ: () => [],
  });
  const { atMark } = await import('../../src/data/compassScan');
  const { scoreBook, onScoredRow, currentPicks } = await import('../../src/data/compassModel');
  const { recordPicks, contractPath, wouldSignals, signals } = await import('../../src/data/compassLedger');
  const { underCloses } = await import('../../src/data/compassModel');
  const mark = nyWallTime(2026, 10, 29, 10, 15);
  const snap = await atMark('RUTW', mark, 'odte');
  const scored: { contract: string; p1: number; bid: number; ask: number; q: number }[] = [];
  const off = onScoredRow(r => scored.push({ contract: r.setup.contract, p1: r.p1, bid: r.setup.bid, ask: r.setup.ask, q: r.setup.quotedAt ?? 0 }));
  await scoreBook(snap.setups, mark, true, true);
  off();
  recordPicks(mark);
  const latest = Math.max(...snap.setups.map(s => s.quotedAt ?? 0));
  /* a late mark calls nothing: no card, no official signal, no seat; it is a "would have called" entry */
  const pick = currentPicks().find(s => s.contract === 'RUTW 2845C') ?? null;
  const row = scored.find(r => r.contract === 'RUTW 2845C') ?? null;
  const sig = wouldSignals().find(r => r.contract === 'RUTW 2845C') ?? null;
  const { seatsNow } = await import('../../src/data/compassModel');
  expectEqual('late: no official call, no card, no seat', [signals().length, pick, seatsNow().seats], [0, null, 0]);
  let outcome: ReturnType<typeof settleSignal> | null = null;
  if (sig) {
    const quotes = await contractPath(sig, null);
    const under = await underCloses('RUTW', '20261029');
    if (quotes) outcome = settleSignal(sig, quotes, under, Date.now());
  }
  const got = {
    rows: snap.rows,
    setups: snap.setups.length,
    latestQuoteAt: latest,
    scored: scored.length,
    bid: row?.bid ?? null,
    ask: row?.ask ?? null,
    quotedAt: row?.q ?? null,
    p1: row ? Number(row.p1.toFixed(6)) : null,
    called: sig?.would ? `would:${sig.book}` : null,
    late: sig?.how ?? null,
    firedAt: sig?.firedAt ?? null,
    fill: outcome?.fill?.ask ?? null,
    fillAt: outcome?.fill?.at ?? null,
    exit: outcome?.exit ? { px: outcome.exit.px, why: outcome.exit.why, at: outcome.exit.at } : null,
  };
  if (existsSync(lateExpected)) {
    const want = JSON.parse(readFileSync(lateExpected, 'utf8')) as typeof got;
    expectEqual('late: ThetaData rows at the mark', got.rows, want.rows);
    expectEqual('late: contracts on the board at the mark', got.setups, want.setups);
    expectEqual('late: no quote stamped after the 10:15:00 mark', got.latestQuoteAt <= mark, true);
    expectEqual('late: RUTW 2845C quote that stood at the mark', [got.bid, got.ask, got.quotedAt], [want.bid, want.ask, want.quotedAt]);
    expectNear('late: RUTW 2845C Model 1', got.p1 ?? NaN, want.p1 ?? NaN, 1e-6);
    expectEqual('late: RUTW 2845C would have called (Book A), marked late, at its mark', [got.called, got.late, got.firedAt], [want.called, want.late, mark]);
    expectEqual('late: fill at the first quote a full minute after the mark', [got.fill, got.fillAt], [want.fill, want.fillAt]);
    expectEqual('late: exit by the same rules from its mark', got.exit, want.exit);
  } else {
    console.log(`RECORDED ${LATE_SET}: ${JSON.stringify(got)}. Check it against the raw rows, then write ${lateExpected}.`);
  }
} else {
  console.log(`SKIP  ${LATE_SET}: not recorded yet.`);
}

/* ---- 6. the day summary ------------------------------------------------------------------------------------ */
{
  const { daySummary } = await import('../../src/data/compassOutcome');
  const closedAt = (px: number, ask: number, pnl: number, fees: number) => ({ status: 'closed' as const, fill: { at: 0, bid: ask - 0.04, ask }, exit: { at: 0, px, why: '' }, peak: 0, stop: 0, last: null, ret: 0, pnl, fees, heldMin: 0 });
  const rows = [
    /* won: 1.88 on a 1.25 fill, (1.88 - 1.25)·100 - 1.08 = 61.92 */
    { outcome: closedAt(1.88, 1.25, 61.92, 1.08) },
    /* lost: the stop test's -68.08 */
    { outcome: closedAt(0.58, 1.25, -68.08, 1.08) },
    /* open: fill 1.25, last bid 1.40: (1.40 - 1.25)·100 - (1.00 + 0.08 + 1.40·100·0.0000206 = 1.0829 → 1.08) = 13.92 */
    { outcome: { status: 'open' as const, fill: { at: 0, bid: 1.21, ask: 1.25 }, exit: null, peak: 1.4, stop: 0.58, last: { t: 0, bid: 1.4, ask: 1.44 }, ret: 12, pnl: null, fees: null, heldMin: 5 } },
    { outcome: null },
    { outcome: { status: 'unavailable' as const, fill: null, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, fees: null, heldMin: null } },
  ];
  const d = daySummary(rows);
  expectEqual('day: calls, won, lost, open, filling, unavailable', [d.calls, d.won, d.lost, d.open, d.waiting, d.unavailable], [5, 1, 1, 1, 1, 1]);
  /* net 61.92 - 68.08 = -6.16; open marked 13.92; fees 1.08 + 1.08 + 1.08 */
  expectEqual('day: net per contract after the round trip', d.net, -6.16);
  expectEqual('day: open calls marked at the bid', d.openMark, 13.92);
  expectEqual('day: round-trip fees inside', d.fees, 3.24);
  /* a stop exactly at the fill still loses its fees: (1.25 - 1.25)·100 - 1.08 is a loss */
  expectEqual('day: breakeven exit counts as lost', daySummary([{ outcome: closedAt(1.25, 1.25, -1.08, 1.08) }]).lost, 1);
}

/* ---- 7. the server record ---------------------------------------------------------------------------------- */
{
  const { mkdtempSync, writeFileSync: write } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { RECORD_FORMAT, compassRoute, startCompassEngine, thetaAnswer } = await import('../../src/data/compassServer');
  /* ThetaData answers in the browser client's shape: an outage is terminal_down, 472 is no data, 429 is busy */
  expectEqual('theta: rows unwrapped from response', thetaAnswer(200, '{"response":[{"a":1}]}', 'application/json'), { status: 200, data: [{ a: 1 }], error: null });
  expectEqual('theta: a lost session is the terminal down', thetaAnswer(503, '{"code":"session_lost"}', 'application/json').error, 'terminal_down');
  expectEqual('theta: 472 is no data', thetaAnswer(472, 'No data', 'text/plain').error, 'no_data');
  expectEqual('theta: 429 is busy, not down', thetaAnswer(429, 'Too many', 'text/plain').error, 'busy');
  expectEqual('theta: csv rows', thetaAnswer(200, 'type,open,close\n"open","09:30:00","16:00:00"', 'text/csv').data, [{ type: 'open', open: '09:30:00', close: '16:00:00' }]);
  const dir = mkdtempSync(join(tmpdir(), 'compass-record-'));
  const call = { key: '2026-10-29|RUTW-2845-C-top-setups-odte', id: 'RUTW-2845-C-top-setups-odte', day: '2026-10-29', book: 'A', ticker: 'RUTW', contract: 'RUTW 2845C', right: 'C', strike: 2845, expiry: '2026-10-29', sleeve: 'odte', firedAt: nyWallTime(2026, 10, 29, 10, 15), quoteAt: nyWallTime(2026, 10, 29, 10, 14) + 59_000, bid: 14.8, ask: 15.9, spot: 2846.9, p1: 0.772379, prun: 0.4, runner: false, outcome: null, pathAt: 0, spark: [], how: 'late', mark: nyWallTime(2026, 10, 29, 10, 15) };
  const mark = { at: nyWallTime(2026, 10, 29, 10, 15), clock: '10:15', sleeve: 'odte', names: { RUTW: 'late', SPY: 'live', XLF: 'none' }, scored: 88, ranAt: 0 };
  write(join(dir, '2026-10-29.json'), JSON.stringify({ format: RECORD_FORMAT, day: '2026-10-29', savedAt: 0, close: null, calls: [call], marks: [mark], lottery: false, state: { day: '20261029' }, meta: { spots: {}, sparks: {}, line: '', theta: 'up', downSince: 0 } }));
  freezeClock('2026-10-29T15:00:00Z');
  const engine = startCompassEngine({ dir, publicDir: join(here, '..', '..', 'public'), theta: async () => ({ status: 503, body: '', type: '' }), scan: false });
  const ask = (url: string) => {
    let body = '';
    const res = { statusCode: 0, setHeader: () => {}, end: (b?: string | Buffer) => { body = String(b ?? ''); } };
    compassRoute(engine, { url, method: 'GET', headers: {} }, res);
    return { status: res.statusCode, body: JSON.parse(body) as Record<string, unknown> };
  };
  const rec = ask('/api/compass/record?day=2026-10-29');
  expectEqual('record: served as written, without the engine state', Object.keys(rec.body).sort(), ['calls', 'close', 'day', 'format', 'lottery', 'marks', 'savedAt', 'would']);
  /* a call written from a late mark (before the live-only rule) reads back as "would have called" */
  expectEqual('record: a late call is not a call', [(rec.body.calls as unknown[]).length, (rec.body.would as { how: string; would: boolean }[])[0].how, (rec.body.would as { would: boolean }[])[0].would], [0, 'late', true]);
  expectEqual('record: its mark', (rec.body.marks as { names: Record<string, string> }[])[0].names, { RUTW: 'late', SPY: 'live', XLF: 'none' });
  const st = ask('/api/compass/state');
  expectEqual('state: format, session, a reader', [st.body.format, st.body.day, (st.body.engine as { readOnly: boolean }).readOnly], [RECORD_FORMAT, '2026-10-29', true]);
  expectEqual('state: no official call; the would-have in its own list', [(st.body.signals as { key: string }[]).map(r => r.key), (st.body.would as { key: string }[]).map(r => r.key)], [[], [call.key]]);
  expectEqual('state: an unchanged rev answers same', ask(`/api/compass/state?rev=${st.body.rev}`).body.same, true);
  expectEqual('days: sessions and calls', ask('/api/compass/days').body.days, [{ day: '2026-10-29', calls: 0 }]);
  expectEqual('record: a bad day is refused', ask('/api/compass/record?day=yesterday').status, 400);
  engine.stop();
}

/* ---- 8. the session review and study, on recorded ThetaData ------------------------------------------------- */
/* XSP 0DTE on 2026-10-29: the 09:45 would-have call XSP 772P reviewed, and the study of XSP's band (its scored rows,
   its marks). The rows and the would-have call were taken from that day's record when the set was recorded. */
{
  const SET8 = 'compass-review-2026-10-29';
  const dir8 = join(here, '..', 'fixtures', 'golden', SET8);
  const want8 = join(dir8, 'expected.json');
  const { gunzipSync, gzipSync } = await import('node:zlib');
  const { mkdirSync, writeFileSync: write8 } = await import('node:fs');
  if (process.env.GOLDEN_RECORD === '1' && !existsSync(join(dir8, 'inputs.json.gz'))) {
    const cache = join(here, '..', '..', '.cache', 'compass');
    const rows = readFileSync(join(cache, 'rows', '2026-10-29.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((r: { k: string; e: string }) => r.k.startsWith('XSP ') && r.e === '2026-10-29');
    const rec = JSON.parse(readFileSync(join(cache, '2026-10-29.json'), 'utf8'));
    const all = [...(rec.calls ?? []), ...(rec.would ?? [])];
    const sig = all.find((c: { contract: string }) => c.contract === 'XSP 772P');
    const marks = (rec.marks as { sleeve: string; names: Record<string, string> }[]).filter(m => m.sleeve === 'odte' && m.names.XSP).map(m => ({ ...m, names: { XSP: m.names.XSP } }));
    mkdirSync(dir8, { recursive: true });
    write8(join(dir8, 'inputs.json.gz'), gzipSync(JSON.stringify({ rows, sig: { ...sig, would: true, how: 'late' }, marks })));
  }
  if (existsSync(join(dir8, 'inputs.json.gz'))) {
    installUwFixtures(SET8);
    freezeClock('2026-10-29T21:00:00Z');
    const { openFeeds } = await import('../../src/data/feedGate');
    openFeeds();
    const { thetaCall } = await import('../../src/data/theta');
    const { setCompassHost } = await import('../../src/data/compassHost');
    setCompassHost({ server: true, theta: (p, j) => thetaCall(p, j), asset: async p => { const b = readFileSync(join(here, '..', '..', 'public', p.replace(/^\/+/, ''))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }, econ: () => [] });
    const { reviewTrade, runStudy } = await import('../../src/data/compassStudy');
    const { parseExplainTrees, explain, sigmoid } = await import('../../src/data/lgbmExplain');
    const inputs = JSON.parse(gunzipSync(readFileSync(join(dir8, 'inputs.json.gz'))).toString('utf8'));
    const entry = parseExplainTrees(readFileSync(join(here, '..', '..', 'public', 'models', 'model_entry_all6months.txt'), 'utf8'));
    const runner = parseExplainTrees(readFileSync(join(here, '..', '..', 'public', 'models', 'model_runner_all6months.txt'), 'utf8'));
    /* tree path attribution: the base plus every credit is the model's own log-odds, so its sigmoid is Model 1 */
    const row0 = inputs.rows.find((r: { k: string; t: number }) => r.k === 'XSP 772P' && r.t === 585);
    const x0 = row0.x.map((v: number | null) => (v == null ? NaN : v));
    const ex = explain(entry ?? [], x0);
    expectNear('attribution: sigmoid(base + credits) = Model 1 at the row', sigmoid(ex.base + ex.credit.reduce((a: number, b: number) => a + b, 0)), predict(ENTRY, x0), 1e-12);
    const chains = new Map();
    const deps = { day: '2026-10-29', rows: inputs.rows, entry, runner, chains };
    const review = await reviewTrade(inputs.sig, deps);
    const study = await runStudy({ ...deps, marks: inputs.marks, calls: [], would: [inputs.sig], reviews: [review] });
    const xspMover = study.movers.find(m => m.contract === 'XSP 772P') ?? null;
    const got8 = {
      fill: [review.after.fill, review.after.fillAt],
      exit: [review.after.exit, review.after.exitAt, review.after.why],
      midFill: review.after.midFill,
      spreadIn: review.after.parts.spreadIn,
      cause: review.verdict.cause,
      targetLater: review.after.targetLater,
      movers: study.sleeves.odte.movers,
      moverMarks: study.sleeves.odte.moverMarks,
      labels: study.labels,
      calibrationRows: study.calibration.reduce((a, c) => a + c.n, 0),
      first: study.movers.slice().sort((a, b) => a.mark.localeCompare(b.mark) || a.contract.localeCompare(b.contract))[0] ?? null,
      xsp772p: xspMover,
    };
    if (existsSync(want8)) {
      const w = JSON.parse(readFileSync(want8, 'utf8')) as typeof got8;
      expectEqual('review: fill at the 09:46 ask', got8.fill, w.fill);
      expectEqual('review: exit, its minute and why', got8.exit, w.exit);
      expectEqual('review: mid at the fill and the spread paid in (dollars)', [got8.midFill, got8.spreadIn], [w.midFill, w.spreadIn]);
      expectEqual('review: cause', got8.cause, w.cause);
      expectEqual('review: the 1.50× target stood after the stop', got8.targetLater, w.targetLater);
      expectEqual('study: XSP 0DTE 50%+ movers and their contract-marks', [got8.movers, got8.moverMarks], [w.movers, w.moverMarks]);
      expectEqual('study: the earliest mover', got8.first, w.first);
      expectEqual('study: every scored row labelled; the calibration covers the labelled ones', [got8.labels, got8.calibrationRows], [w.labels, w.calibrationRows]);
    } else {
      console.log(`RECORDED ${SET8}: ${JSON.stringify(got8)}. Check it against the raw rows, then write ${want8}.`);
    }
  }
}

done();
