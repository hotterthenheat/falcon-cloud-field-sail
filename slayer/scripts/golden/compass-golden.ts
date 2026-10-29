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

done();
