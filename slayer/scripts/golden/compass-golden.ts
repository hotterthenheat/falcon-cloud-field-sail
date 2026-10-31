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
import { MODEL_1_NAME, MODEL_2_NAME, f32, bookAPass, bookBPass, entryTimeOk, flatTOf, onScanGrid, sessionScanOpen, spreadPass, strikeDistance, strikeSpan, thetaBurns, P1_MIN } from '../../src/data/compassParams';
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
/* the time-of-day gate (was: any mark on the grid, so 15:55, the curb to 16:55 and the overnight could call): t 15 to
   330, and 55 minutes before the flat (t 385 on a full day; 205 on a 13:00 close, so the last entry is t 150, 12:00) */
/* the gate is session by session (owner, 2026-10-31): 15 minutes into the mark's own session and 55 before that
   session's flat. 21:00 is 45 minutes into the overnight index session with 740 to its 09:20 flat: it calls (was not) */
expectEqual('Book A at 09:45, 15:00 and 21:00 overnight; not 09:40, 15:05, 15:55, 16:55', [15, 330, 10, 335, 385, 445, 690].map(t => bookAPass(t, 2, 4, 0, 1.2, 1.24, 0.8)), [true, true, false, false, false, false, true]);
/* overnight (index roots): 20:15 opens, 20:30 the first call, 08:25 the last (55 before 09:20); an equity root has no
   overnight session; its pre-market opens 07:30: 07:45 the first call, 08:25 the last */
const tOf = (h: number, m: number) => h * 60 + m - 570;
expectEqual('overnight gate: 20:25 no, 20:30 yes, 00:30 yes, 08:25 yes, 08:30 no', [tOf(20, 25), tOf(20, 30), tOf(0, 30), tOf(8, 25), tOf(8, 30)].map(t => entryTimeOk(t, 385, true)), [false, true, true, true, false]);
expectEqual('equity pre-market gate: 21:00 no, 07:40 no, 07:45 yes, 08:25 yes, 08:30 no', [tOf(21, 0), tOf(7, 40), tOf(7, 45), tOf(8, 25), tOf(8, 30)].map(t => entryTimeOk(t, 385, false)), [false, false, true, true, false]);
{
  const { minutesToFlat, sessionKindOf, inModelWindow } = await import('../../src/data/compassParams');
  expectEqual('sessions and minutes to the flat: 21:00 overnight 740, 08:00 pre 80, 10:00 regular 355, 16:30 curb 25', [[sessionKindOf(tOf(21, 0)), minutesToFlat(tOf(21, 0))], [sessionKindOf(tOf(8, 0), 385, false), minutesToFlat(tOf(8, 0), 385, false)], [sessionKindOf(30), minutesToFlat(30)], [sessionKindOf(420), minutesToFlat(420)]], [['overnight', 740], ['pre', 80], ['regular', 355], ['curb', 25]]);
  expectEqual('outside trained hours: 21:00 and 08:00 are, 10:00 is not', [inModelWindow(690), inModelWindow(tOf(8, 0)), inModelWindow(30)], [false, false, true]);
}
expectEqual('Book B gated the same: 15:00 yes, 15:05 no', [bookBPass(330, 9, 4, 0, 0.4, 0.42, 0.85, 0.9, 0.8), bookBPass(335, 9, 4, 0, 0.4, 0.42, 0.85, 0.9, 0.8)], [true, false]);
expectEqual('early close 13:00: flat t 205, last entry t 150', [flatTOf(780), flatTOf(null), bookAPass(150, 2, 4, 0, 1.2, 1.24, 0.8, flatTOf(780)), bookAPass(155, 2, 4, 0, 1.2, 1.24, 0.8, flatTOf(780))], [205, 385, true, false]);
expectEqual('entry gate in words', [entryTimeOk(15), entryTimeOk(14), entryTimeOk(330, 385), entryTimeOk(331, 385)], [true, false, true, false]);
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
/* 1-second quotes inside a minute that crossed the stop: minute quotes alone sell at the 10:40 bid 0.40 (the stop
   0.58475 was crossed somewhere in 10:39–10:40); the seconds put the touch at 10:39:20, bid 0.58 */
{
  const { fineWindows } = await import('../../src/data/compassOutcome');
  const sigA = { book: 'A' as const, right: 'C' as const, runner: false, firedAt: fired };
  const mins = [q(10, 31, 1.21, 1.25), q(10, 35, 1.0, 1.04), q(10, 39, 0.9, 0.94), q(10, 40, 0.4, 0.44)];
  expectEqual('fine windows: the stop crossed only in 10:39–10:40', fineWindows(sigA, mins), [[at(10, 39), at(10, 40)]]);
  const fine = [q(10, 39, 0.8, 0.84, 10), q(10, 39, 0.58, 0.62, 20), q(10, 39, 0.5, 0.54, 40)];
  const coarse = settleSignal(sigA, mins, [], after);
  const sharp = settleSignal(sigA, [...mins, ...fine], [], after);
  expectEqual('stop from minute quotes (the old read)', [coarse.exit?.px, coarse.exit?.at], [0.4, at(10, 40)]);
  expectEqual('stop from the seconds (was 0.40 at 10:40)', [sharp.exit?.why, sharp.exit?.px, sharp.exit?.at, sharp.pnl], ['Stop', 0.58, at(10, 39, 20), -68.08]);
  /* a target touched inside a minute: 1.875 crossed in 10:49–10:50; the seconds sell it at 10:49:30 */
  const tpMins = [q(10, 31, 1.21, 1.25), q(10, 49, 1.7, 1.74), q(10, 50, 1.9, 1.94)];
  expectEqual('fine windows: the 1.50× target crossed in 10:49–10:50 (and 1.25× crossed in 10:31–10:49)', fineWindows(sigA, tpMins), [[at(10, 31), at(10, 49)], [at(10, 49), at(10, 50)]]);
  const tp = settleSignal(sigA, [...tpMins, q(10, 49, 1.88, 1.92, 30)], [], after);
  expectEqual('take-profit from the seconds', [tp.exit?.why, tp.exit?.px, tp.exit?.at], ['Take profit 1.50×', 1.88, at(10, 49, 30)]);
}
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
  const { scoreBook, onScoredRow, currentPicks, importModelState } = await import('../../src/data/compassModel');
  const { recordPicks, contractPath, wouldSignals, signals } = await import('../../src/data/compassLedger');
  const { underCloses } = await import('../../src/data/compassModel');
  const mark = nyWallTime(2026, 10, 29, 10, 15);
  /* every seat was taken by live calls, but at 11:00, after this mark: the late mark is judged on the seats as they
     stood at 10:15, all free (was: seats full, nothing would have been called) */
  const later = mark + 45 * 60_000;
  importModelState({ day: '20261029', rootA: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META'], rootAt: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META'].map(t => [t, later] as [string, number]) }, null);
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
  expectEqual('late: no official call, no card, no seat taken (the five later seats stay five)', [signals().length, pick, seatsNow().seats], [0, null, 5]);
  let outcome: ReturnType<typeof settleSignal> | null = null;
  let fineGot: { windows: number; exit: { px: number; why: string; at: number } | null } | null = null;
  if (sig) {
    const quotes = await contractPath(sig, null);
    const under = await underCloses('RUTW', '20261029');
    if (quotes) outcome = settleSignal(sig, quotes, under, Date.now());
    if (quotes) {
      /* the same call with its stop and target minutes read to the second (recorded 1-second quotes) */
      const { withFineExits } = await import('../../src/data/compassLedger');
      const { fineWindows } = await import('../../src/data/compassOutcome');
      const sharp = settleSignal(sig, await withFineExits(sig, quotes), under, Date.now());
      fineGot = { windows: fineWindows(sig, quotes).length, exit: sharp.exit ? { px: sharp.exit.px, why: sharp.exit.why, at: sharp.exit.at } : null };
      if (REPORT || process.env.GOLDEN_RECORD === '1') console.log(`REPORT fine exit ${JSON.stringify(fineGot)}`);
    }
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
    /* read to the second, the break-even stop (16.90 + fees) was touched at 11:45:56, bid 16.30, inside a minute the
       one-a-minute quotes saw above it; the minute read exits at 11:59, bid 15.10 */
    expectEqual('late: the stop judged on 1-second quotes', fineGot, { windows: 9, exit: { px: 16.3, why: 'Stop', at: nyWallTime(2026, 10, 29, 11, 45) + 56_000 } });
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
    /* open: fill 1.25, last bid 1.40: (1.40 - 1.25)·100 - (1.00 + 0.08 + 1.40·100·0.0000278 + 0.00279 TAF = 1.0867
       → 1.09) = 13.91 (was 13.92 with the old SEC rate and no TAF) */
    { outcome: { status: 'open' as const, fill: { at: 0, bid: 1.21, ask: 1.25 }, exit: null, peak: 1.4, stop: 0.58, last: { t: 0, bid: 1.4, ask: 1.44 }, ret: 12, pnl: null, fees: null, heldMin: 5 } },
    { outcome: null },
    { outcome: { status: 'unavailable' as const, fill: null, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, fees: null, heldMin: null } },
  ];
  const d = daySummary(rows);
  expectEqual('day: calls, won, lost, open, filling, unavailable', [d.calls, d.won, d.lost, d.open, d.waiting, d.unavailable], [5, 1, 1, 1, 1, 1]);
  /* net 61.92 - 68.08 = -6.16; open marked 13.92; fees 1.08 + 1.08 + 1.08 */
  expectEqual('day: net per contract after the round trip', d.net, -6.16);
  expectEqual('day: open calls marked at the bid', d.openMark, 13.91);
  expectEqual('day: round-trip fees inside (1.08 + 1.08 + 1.09)', d.fees, 3.25);
  /* the fee schedule: 1.00 commission + 0.08 exchange + SEC 0.0000278 of the sale + TAF 0.00279 */
  const { optionFees: fees, breakEvenBid, stopAfter } = await import('../../src/data/compassParams');
  expectEqual('fees: sale at 10.00 = 1.08 + 0.0278 + 0.0028 = 1.11 (was 1.10)', fees(10), 1.11);
  /* break-even after fees: a 1.25 ask that peaked at 1.5625 (1.25x) stops at 1.25 + fees(1.25)/100, fees =
     1.08 + 0.0035 + 0.0028 = 1.0863 → 1.09, so 1.2609 (was 1.25, a sale that lost the fees) */
  expectNear('break-even stop includes the fees', stopAfter(1.25, 1.5625, false), 1.2609, 1e-9);
  expectNear('break-even bid', breakEvenBid(2), 2 + 1.09 / 100, 1e-12);
  const { weekdayDte: wdte } = await import('../../src/data/compassParams');
  /* sessions to expiry skip market holidays: Wed 11-25 to Fri 11-27 is 1 (was 2, Thanksgiving counted); Fri to Mon is 1 */
  expectEqual('sessions to expiry over Thanksgiving, and over a weekend', [wdte('20261125', '2026-11-27'), wdte('20261030', '2026-11-02'), wdte('20261030', '2026-10-30')], [1, 1, 0]);
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

/* ---- 9. every session's study, pooled ---------------------------------------------------------------------- */
/* Two hand-built labelled sessions (scripts/fixtures/golden/compass-study-pool): 2026-10-27 with its study,
   2026-10-28 without one. Only one real session is labelled so far (.cache/compass/labels), so the pooling is locked
   on these. The trained minutes are t = 585..900 (15 to 330 after 09:30); P1_MIN = 0.7067.
     10-27: .20 F, .25 T, .72 T, .74 F (t 600/700), .80 T at t 580 (outside), .85 F, .45 unsettled
     10-28: .71 F, .73 F, .10 F, .30 T at t 905 (outside), .76 T
   Wilson 95% (z 1.96): 1/3 → .0615–.7923, 1/4 → .0456–.6994, 1/1 → .2065–1, 0/1 → 0–.7935, 2/6 → .0968–.7000.
   The pooled rates are clustered by session (clusterRate): V = C/(C-1)·Σ(k_c - p·n_c)²/n², nEff = p(1-p)/V capped
   at n, Wilson at nEff; one cluster gives 0–1. */
{
  const { poolStudies, wilson, POOL_BAR } = await import('../../src/data/compassStudy');
  const { pooledStudy, compassRoute, startCompassEngine } = await import('../../src/data/compassServer');
  const { cpSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const POOL = join(here, '..', 'fixtures', 'golden', 'compass-study-pool');
  expectEqual('wilson: 1 of 4', wilson(1, 4), { n: 4, k: 1, rate: 0.25, lo95: 0.0456, hi95: 0.6994 });
  expectEqual('wilson: 2 of 6', [wilson(2, 6).lo95, wilson(2, 6).hi95], [0.0968, 0.7]);
  expectEqual('wilson: 1 of 1 stops at 1', [wilson(1, 1).lo95, wilson(1, 1).hi95], [0.2065, 1]);
  expectEqual('wilson: nothing is nothing', wilson(0, 0), { n: 0, k: 0, rate: 0, lo95: 0, hi95: 0 });
  const p = pooledStudy(POOL);
  expectEqual('pool: sessions oldest first; 12 rows, 11 settled; 3 movers (10-28 has no study)', [p.days, p.labels, p.settled, p.movers], [['2026-10-27', '2026-10-28'], 12, 11, 3]);
  expectEqual('pool: a session without a study says so; the sweep carries its multiple-comparisons note', p.notes, ['2026-10-28: labels without a study; its movers are not counted.', 'The threshold sweep tries 7 cuts on the same rows: the best of them is biased up by the choice (multiple comparisons). It is advisory; a new threshold needs sessions it was not chosen on.']);
  const b = (name: string) => p.calibration.find(c => c.bucket === name)!;
  /* 0–30%, in the window: .20 F, .25 T, .10 F → 1 of 3; mean (.20 + .25 + .10)/3 = .1833; gap 33.33 - 18.33 = +15.00 */
  /* clustered: 10-27 (2 rows, 1 won), 10-28 (1, 0): Σ = (1 - 2/3)² + (0 - 1/3)² = 2/9, V = 2·(2/9)/9 = 0.0494,
     nEff = (2/9)/0.0494 = 4.5 → capped at 3: the plain Wilson */
  expectEqual('pool: 0–30% bucket', [b('0–30%').win, b('0–30%').meanP1, b('0–30%').gapPoints, b('0–30%').sessions], [{ n: 3, k: 1, rate: 0.3333, lo95: 0.0615, hi95: 0.7923, by: 'session', clusters: 2, nEff: 3 }, 0.1833, 15, 2]);
  /* 30–40%: only .30 at 15:05, outside the window: none in the window, 1 of 1 over every minute */
  expectEqual('pool: 30–40% bucket, outside the window only', [b('30–40%').win.n, b('30–40%').all.n, b('30–40%').all.k, b('30–40%').meanP1], [0, 1, 1, null]);
  /* the unsettled .45 row is not counted */
  expectEqual('pool: an unsettled row is no row', b('40–50%').all.n, 0);
  /* 70.67–75%: .72 T, .74 F, .71 F, .73 F → 1 of 4; mean 2.90/4 = .725; gap 25 - 72.5 = -47.5; both sessions */
  /* clustered: 10-27 (2, 1), 10-28 (2, 0): Σ = 0.25 + 0.25, V = 2·0.5/16 = 0.0625, nEff = 0.1875/0.0625 = 3; Wilson at
     p .25, n 3: .0368–.7439 (was .0456–.6994, the four rows read as independent) */
  expectEqual('pool: 70.67–75% bucket', [b('70.67–75%').win, b('70.67–75%').meanP1, b('70.67–75%').gapPoints, b('70.67–75%').sessions], [{ n: 4, k: 1, rate: 0.25, lo95: 0.0368, hi95: 0.7439, by: 'session', clusters: 2, nEff: 3 }, 0.725, -47.5, 2]);
  /* 75–80%: .76 T → 1 of 1, gap +24.  80–100%: .85 F in the window (0 of 1, gap -85); .80 T at 09:40 outside;
     every minute 1 of 2, bid hit 1.50× 1 of 2 */
  expectEqual('pool: 75–80% bucket', [b('75–80%').win.k, b('75–80%').win.n, b('75–80%').gapPoints], [1, 1, 24]);
  /* one row in one session: one cluster cannot bound a rate, 0–1 (was 0–.7935) */
  expectEqual('pool: 80–100% bucket', [b('80–100%').win, b('80–100%').gapPoints, b('80–100%').all.n, b('80–100%').all.k, b('80–100%').hit50], [{ n: 1, k: 0, rate: 0, lo95: 0, hi95: 1, by: 'session', clusters: 1, nEff: 1 }, -85, 2, 1, 0.5]);
  expectEqual('pool: every settled row in one bucket', p.calibration.reduce((a, c) => a + c.all.n, 0), 11);
  /* the sweep, in the window: at 60% and at 70.67% the same six rows (.72 .74 .85 | .71 .73 .76), 2 took;
     mean return (50 - 40 - 50 - 35 - 45 + 50)/6 = -11.67; per session -13.33 and -10.00, neither up.
     At 75%: .85 F, .76 T → 1 of 2, mean 0; 10-28 is up (+50). At 85%: .85 only. */
  const t = (cut: number) => p.thresholds.find(x => Math.abs(x.p1 - cut) < 1e-9)!;
  expectEqual('pool: sweep at 70.67%', [t(0.7067).win.n, t(0.7067).win.k, t(0.7067).meanRet, t(0.7067).sessions, t(0.7067).upSessions], [6, 2, -11.67, 2, 0]);
  expectEqual('pool: sweep at 60% equals 70.67% here', t(0.6).win, t(0.7067).win);
  expectEqual('pool: sweep at 75%', [t(0.75).win.n, t(0.75).win.k, t(0.75).meanRet, t(0.75).upSessions], [2, 1, 0, 1]);
  expectEqual('pool: sweep at 85% keeps .85', [t(0.85).win.n, t(0.85).meanRet], [1, -50]);
  /* each session over the bar, in the window: 10-27 .72 T .74 F .85 F (mean .77, -13.33); 10-28 .71 F .73 F .76 T */
  expectEqual('pool: session lines', p.sessions.map(d => [d.day, d.labels, d.settled, d.over.n, d.over.k, d.overMeanP1, d.overMeanRet, d.movers]), [['2026-10-27', 7, 6, 3, 1, 0.77, -13.33, 3], ['2026-10-28', 5, 5, 3, 1, 0.7333, -10, null]]);
  /* miss reasons and held-down inputs come from the studies: 10-27's three movers */
  expectEqual('pool: miss reasons summed', p.missReasons, [{ gate: 'Model 1 under the threshold', n: 2, sessions: 1 }, { gate: 'spread over 8%', n: 1, sessions: 1 }]);
  expectEqual('pool: held down, from the movers', p.heldDownMost.map(h => [h.col, h.n, h.sessions]), [[26, 2, 1], [24, 1, 1]]);
  expectEqual('pool: inputs over time', p.inputsOverTime, { cols: [{ col: 26, name: 'IV / RV' }, { col: 24, name: 'ATM IV' }], rows: [{ day: '2026-10-27', under: 2, n: [2, 1] }] });
  /* the verdict: two sessions, no full bucket; over the bar 2 of 6 (.0968–.7000), mean (.72+.74+.85+.71+.73+.76)/6 = .7517 */
  expectEqual('pool: verdict is not yet, every bar unmet', [p.verdict.ready, p.verdict.needs.map(n => n.met)], [false, [false, false, false, false]]);
  expectEqual('pool: verdict line', p.verdict.line, 'No: the evidence does not support reading Model 1 as a probability yet (4 of 4 bars unmet). Rows scored at or over 70.67% (mean 75.2%) took the 1.50× profit 33.3% of the time (95%: 9.7–70.0%, clustered by session; 6 rows, about 6 effective, 2 sessions).');
  /* a calibrated pool meets the bars: 20 sessions, 25 rows a bucket a session (500 each) at the bucket's middle,
     round(25·mid) of them taking profit (16%, 36%, 44%, 56%, 64%, 68%, 72%, 76%, 92%: every gap within 2 points) */
  const MIDS = [0.15, 0.35, 0.45, 0.55, 0.625, 0.678, 0.728, 0.775, 0.9];
  const synth = (bad: number | null) =>
    Array.from({ length: 20 }, (_, i) => {
      const day = `2026-09-${String(i + 1).padStart(2, '0')}`;
      const labels = MIDS.flatMap((mid, j) => Array.from({ length: 25 }, (_, r) => ({ t: 600, k: `SPY ${j}C`, e: day, p1: mid, p2: 0, fill: 1, exit: 1, why: '', ret: 0, tp1: j === bad ? false : r < Math.round(25 * mid), hit50: false, best: 1 })));
      return { day, labels, study: { missReasons: [], movers: [] } };
    });
  const good = poolStudies(synth(null), 0);
  expectEqual('pool: a calibrated pool meets every bar', [good.verdict.ready, good.verdict.needs.map(n => n.met), good.calibration.map(c => c.win.n)], [true, [true, true, true, true], MIDS.map(() => 500)]);
  expectEqual('pool: meeting the bars never lifts the label', /“Unvalidated” label stays until the owner lifts it/.test(good.verdict.line), true);
  /* the same with the 50–60% bucket never taking profit: its gap (-55) fails, and it reverses against 40–50% */
  const bad = poolStudies(synth(3), 0);
  /* a bucket at 0 of 500 has no within-session variance to read a design effect from: its effective rows are its 20
     sessions, so it is short of the 400 and fails the rows and the gap bars (was: full, failing the gap and order) */
  expectEqual('pool: one bucket off fails the rows and the gap', [bad.verdict.ready, bad.verdict.needs.map(n => n.met), bad.calibration[3].gapPoints, bad.calibration[3].win.nEff], [false, [true, false, false, true], -55, 20]);
  /* the pool of one session clusters by name and session */
  const { clusterRate } = await import('../../src/data/compassStudy');
  /* 3 names × 10 overlapping rows, all-or-nothing per name (1 won, 2 lost): p = 1/3, Σ = (20/3)² + 2·(10/3)² = 66.67,
     V = (3/2)·66.67/900 = 0.1111, nEff = (2/9)/0.1111 = 2 (three paths, less the C/(C-1) correction); plain Wilson
     reads 30 rows: .1923–.5122 */
  const one = clusterRate(['A', 'B', 'C'].flatMap((nm, i) => Array.from({ length: 10 }, () => ({ won: i === 0, cluster: nm }))), 'name-session');
  /* each label by its own book (was: Book A's non-runner rules for every row) */
  const { bookOfRow } = await import('../../src/data/compassStudy');
  const mates = Array.from({ length: 21 }, (_, i) => ({ k: `SPY ${500 + i}C` }));
  expectEqual('label book: 2 out is A; 9 out at 0.50 is B; 9 out at 1.50 and 14 out are neither', [bookOfRow({ k: 'SPY 512C', s: 510, a: 2 }, mates, 'SPY'), bookOfRow({ k: 'SPY 519C', s: 510, a: 0.5 }, mates, 'SPY'), bookOfRow({ k: 'SPY 519C', s: 510, a: 1.5 }, mates, 'SPY'), bookOfRow({ k: 'SPY 520C', s: 506, a: 0.2 }, mates, 'SPY')], ['A', 'B', null, null]);
  expectEqual('clustered: 30 rows that are 3 paths count as 2 effective rows', [one.nEff, one.lo95, one.hi95, wilson(10, 30).lo95, wilson(10, 30).hi95], [2, 0.0453, 0.8406, 0.1923, 0.5122]);
  expectEqual('pool: the bars', [POOL_BAR.sessions, POOL_BAR.rowsPerBucket, POOL_BAR.gapPoints], [20, 400, 5]);
  /* served at /api/compass/study?day=all from the record folder */
  const dir9 = mkdtempSync(join(tmpdir(), 'compass-pool-'));
  cpSync(POOL, dir9, { recursive: true });
  const engine9 = startCompassEngine({ dir: dir9, publicDir: join(here, '..', '..', 'public'), theta: async () => ({ status: 503, body: '', type: '' }), scan: false });
  let body9 = '';
  const res9 = { statusCode: 0, setHeader: () => {}, end: (x?: string | Buffer) => { body9 = String(x ?? ''); } };
  compassRoute(engine9, { url: '/api/compass/study?day=all', method: 'GET', headers: {} }, res9);
  const served = JSON.parse(body9) as typeof p;
  expectEqual('pool: served at study?day=all', [res9.statusCode, served.day, served.days, served.verdict.line], [200, 'all', p.days, p.verdict.line]);
  const empty = mkdtempSync(join(tmpdir(), 'compass-pool-empty-'));
  const engine9b = startCompassEngine({ dir: empty, publicDir: join(here, '..', '..', 'public'), theta: async () => ({ status: 503, body: '', type: '' }), scan: false });
  compassRoute(engine9b, { url: '/api/compass/study?day=all', method: 'GET', headers: {} }, res9);
  expectEqual('pool: nothing labelled is not built', [res9.statusCode, (JSON.parse(body9) as { code: string }).code], [404, 'not_built']);
  engine9.stop();
  engine9b.stop();
}

/* ---- 10. the engine stays up ------------------------------------------------------------------------------- */
{
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: write10 } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const api = (await import('../../server/compassApi.mjs')) as {
    startDelay: (n: number) => number;
    compassMount: (load: () => Promise<unknown>, root?: string) => { start: () => Promise<void>; stop: () => void };
  };
  expectEqual('start backoff: 5 s, 10 s, 20 s, capped at 5 min', [1, 2, 3, 7, 12].map(api.startDelay), [5_000, 10_000, 20_000, 300_000, 300_000]);
  /* a start that failed is not memoised: inside its backoff it waits, after it the next start loads again */
  freezeClock('2026-10-29T15:00:00Z');
  let loads = 0;
  const warn = console.warn;
  console.warn = () => {};
  const mount = api.compassMount(async () => {
    loads += 1;
    throw new Error('the import failed');
  }, tmpdir());
  await mount.start();
  await mount.start();
  const inside = loads;
  freezeClock('2026-10-29T15:00:06Z');
  await mount.start();
  mount.stop();
  console.warn = warn;
  expectEqual('a failed engine start is tried again after its backoff (was: down until restart)', [inside, loads], [1, 2]);
  /* the process logger, in a child: an unhandled rejection is logged and the process keeps running */
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import(process.argv[1]); m.installProcessLogger(l => console.log(l.split('\\n')[0])); Promise.reject(new Error('sentinel')); setTimeout(() => console.log('still up'), 50);", join(here, '..', '..', 'server', 'compassApi.mjs')], { encoding: 'utf8' });
  expectEqual('process logger: the rejection is logged, the process lives', [child.status, child.stdout.trim().split('\n')], [0, ['[process] unhandled rejection: Error: sentinel', 'still up']]);
  /* the model lock's reason reaches the log: a model folder whose universe file is not the locked one */
  const badPublic = mkdtempSync(join(tmpdir(), 'compass-badpublic-'));
  const { mkdirSync: mk10 } = await import('node:fs');
  mk10(join(badPublic, 'config'), { recursive: true });
  write10(join(badPublic, 'config', 'universe_458.json'), '["SPY"]');
  const lockKid = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', [
    "const { startCompassEngine } = await import(process.argv[1] + '/compassServer.ts');",
    "const { scoreBook } = await import(process.argv[1] + '/compassModel.ts');",
    "const e = startCompassEngine({ dir: process.argv[2], publicDir: process.argv[3], theta: async () => ({ status: 503, body: '', type: '' }), scan: false, log: l => { if (l.includes('model lock')) console.log(l); } });",
    'await scoreBook([], Date.now(), true);',
    'e.stop();',
  ].join('\n'), join(here, '..', '..', 'src', 'data'), mkdtempSync(join(tmpdir(), 'compass-lockdir-')), badPublic], { encoding: 'utf8', cwd: join(here, '..', '..') });
  expectEqual('model lock: its reason is logged (was: never logged)', lockKid.stdout.trim(), '[compass] model lock: Universe hash does not match. Scoring is closed.');

  /* the early close: the core calendar stands in until ThetaData's calendar answers */
  const { calendarClose } = await import('../../src/data/compassScan');
  expectEqual('early close from the calendar: 2026-11-27 13:00, 2026-10-30 full', [calendarClose('20261127'), calendarClose('20261030')], [780, null]);
  /* holidays: Thanksgiving 2026-11-26 is no session, and the night before it belongs to it */
  const { sessionDayOpen, sessionYmd: sYmd, optionScanOpen: open10 } = await import('../../src/data/compassSession');
  const ny = (d: number, h: number, m: number) => nyWallTime(2026, 11, d, h, m);
  expectEqual('holiday: Wed 11-25 21:00 and Thu 11-26 10:00 belong to Fri 11-27 (was 11-26)', [sYmd(ny(25, 21, 0)), sYmd(ny(26, 10, 0))], ['20261127', '20261127']);
  expectEqual('holiday: no scan Wed night or Thursday; Thursday night and Friday scan', [sessionDayOpen(ny(25, 21, 0)), sessionDayOpen(ny(26, 10, 0)), sessionDayOpen(ny(26, 21, 0)), sessionDayOpen(ny(27, 10, 0))], [false, false, true, true]);
  expectEqual('holiday: SPXW is off the scan on Thanksgiving (was on)', [open10('SPXW', 1, ny(26, 10, 0)), open10('SPXW', 0, ny(27, 10, 0))], [false, true]);

  /* the engine lock: a reader takes over once the scanner's lock is stale, and a scanner that loses it stops */
  const { startCompassEngine: start10 } = await import('../../src/data/compassServer');
  freezeClock('2026-10-31T15:00:00Z');
  const dir10 = mkdtempSync(join(tmpdir(), 'compass-lock-'));
  const lockFile = join(dir10, 'engine.lock');
  const other = process.ppid;
  write10(lockFile, JSON.stringify({ pid: other, at: Date.now() }));
  const eng = start10({ dir: dir10, publicDir: join(here, '..', '..', 'public'), theta: async () => ({ status: 503, body: '', type: '' }), scan: true, lockRetryMs: 60, log: () => {} });
  const role = () => eng.state()?.engine.readOnly;
  const first = role();
  write10(lockFile, JSON.stringify({ pid: other, at: Date.now() - 200_000 }));
  await new Promise(r => setTimeout(r, 250));
  const took = role();
  write10(lockFile, JSON.stringify({ pid: other, at: Date.now() }));
  await new Promise(r => setTimeout(r, 250));
  const lost = role();
  eng.stop();
  expectEqual('engine lock: reader, takes over a stale lock, gives it up to a live holder (was: reader for life, scanner never stops)', [first, took, lost], [true, false, true]);
}

/* ---- 11. what the trees never saw -------------------------------------------------------------------------- */
{
  const { nanUnsafeColumns, trainingRanges } = await import('../../src/data/lgbm');
  const { setCompassHost } = await import('../../src/data/compassHost');
  const { scoreBook, scoreRow, minuteBars } = await import('../../src/data/compassModel');
  const entryText = readFileSync(join(here, '..', '..', 'public', 'models', 'model_entry_all6months.txt'), 'utf8');
  const runnerText = readFileSync(join(here, '..', '..', 'public', 'models', 'model_runner_all6months.txt'), 'utf8');
  /* missing type none on a split, and 0 outside the column's training range: realised vol (min 1.63e-5 / 5.86e-5),
     range compression (runner min 0.0637), gamma/|theta| (runner min 1.58e-6); the rest are never NaN live */
  expectEqual('NaN-unsafe columns, Model 1', nanUnsafeColumns(entryText), [0, 6, 7, 15, 32]);
  expectEqual('NaN-unsafe columns, Model 2', nanUnsafeColumns(runnerText), [0, 6, 7, 9, 15, 32, 38, 40, 41]);
  expectEqual('training range of x5 is [0, 1]', trainingRanges(entryText)[5], [-4.4935507815787104e-14, 1]);
  let reads = 0;
  let lastMinute = 9 * 60 + 30 + 58;
  const day11 = '20261030';
  freezeClock('2026-10-30T14:30:10Z');
  setCompassHost({
    server: true,
    theta: async () => {
      reads += 1;
      const rows = Array.from({ length: lastMinute - 570 + 1 }, (_, i) => {
        const m = 570 + i;
        return { timestamp: `2026-10-30T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000`, open: 100, high: 100.5, low: 99.5, close: 100, volume: 10 };
      });
      return { status: 200, data: rows, error: null };
    },
    asset: async p => {
      const b = readFileSync(join(here, '..', '..', 'public', p.replace(/^\/+/, '')));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    econ: () => [],
  });
  await scoreBook([], Date.now(), true);
  const row = ref.x.map(v => (v == null ? NaN : v));
  const plain = scoreRow(row);
  expectNear('scoreRow on the reference row = both models', plain.p1 ?? NaN, ref.entry, 1e-9);
  expectNear('scoreRow on the reference row, Model 2', plain.prun ?? NaN, ref.runner, 1e-9);
  const noCompress = scoreRow(row.map((v, i) => (i === 9 ? NaN : v)));
  expectEqual('compression undefined: Model 1 scores (NaN is missing to it), Model 2 does not (was: read as 0)', [noCompress.p1 != null, noCompress.prun, new RegExp(`^${MODEL_2_NAME} not scored: range compression \\(input 9\\)`).test(noCompress.why)], [true, null, true]);
  expectEqual('gamma/|theta| undefined: Model 2 not scored', scoreRow(row.map((v, i) => (i === 41 ? NaN : v))).prun, null);
  const noVol = scoreRow(row.map((v, i) => (i === 7 ? NaN : v)));
  expectEqual('realised vol undefined: neither model scores (Model 1 never saw it missing either)', [noVol.p1, noVol.prun, new RegExp(`^${MODEL_1_NAME} not scored: realised vol, 30 min \\(input 7\\)`).test(noVol.why)], [null, null, true]);
  /* x5, place in the day range: the price at the mark above the high of minutes 0..t-1 was 2.0, now 1 (training max) */
  const flat = Array.from({ length: 30 }, (_, k) => ({ d: '20261030', m: 570 + k, o: 100, h: 101, l: 99, c: 100, v: 10 }));
  const x5 = features(stub(100, 'C', 1, 1.04, 103), 600, flat, flat, null, NaN, NaN, [], null, null, { m5: NaN, m15: NaN })?.[5];
  expectEqual('x5 clipped to the training range [0, 1] (was (103 - 99)/(101 - 99) = 2)', x5, 1);
  /* the live bar read: a memo that does not reach minute t-1 is read again (was: up to 60 s stale) */
  reads = 0;
  lastMinute = 628;
  const a = await minuteBars('QQQ', day11, 629);
  const b2 = await minuteBars('QQQ', day11, 629);
  const inside = reads;
  freezeClock('2026-10-30T14:30:13Z');
  lastMinute = 629;
  const c = await minuteBars('QQQ', day11, 629);
  const d = await minuteBars('QQQ', day11, 629);
  expectEqual('stale bars: read, memo inside 2 s, read again once it is older and short of t-1, then memo', [a.at(-1)?.m, b2.at(-1)?.m, inside, c.at(-1)?.m, d.at(-1)?.m, reads], [628, 628, 1, 629, 629, 2]);
  /* one read answers every name of a pass that asks for the same bars at once (SPY, a sector ETF) */
  reads = 0;
  await Promise.all(Array.from({ length: 6 }, () => minuteBars('IWM', day11)));
  expectEqual('shared bar read: six names at once, one request (was six)', reads, 1);
}

/* ---- 12. the weekly read reaches Book B ------------------------------------------------------------------- */
{
  const { WEEKLY_STRIKES, bookBRange } = await import('../../src/data/compassParams');
  const { setCompassHost } = await import('../../src/data/compassHost');
  const { atMark, weeklyExpiry } = await import('../../src/data/compassScan');
  /* Book B sits 8 to 12 strikes out on an index root, up to 13 to 17 on a 12-strike span; the weekly read was 4 */
  expectEqual('Book B bands: index span 4 → 8..12, span 12 → 13..17; weekly read reaches 17', [bookBRange(4), bookBRange(12), WEEKLY_STRIKES], [{ inner: 8, outer: 12 }, { inner: 13, outer: 17 }, 17]);
  const paths: string[] = [];
  setCompassHost({
    server: true,
    theta: async p => {
      paths.push(p);
      if (p.startsWith('/option/list/expirations')) return { status: 200, data: [{ expiration: '2026-10-30' }, { expiration: '2026-11-02' }, { expiration: '2026-11-06' }], error: null };
      return { status: 472, data: null, error: 'no_data' };
    },
    asset: async () => null,
    econ: () => [],
  });
  const m12 = nyWallTime(2026, 10, 30, 10, 30);
  expectEqual('nearest weekly expiry 1 to 7 sessions out', await weeklyExpiry('TLT', m12), '2026-11-02');
  await atMark('TLT', m12, 'weekly');
  expectEqual('the weekly read asks Book B\'s band (strike_range 17, was 4)', paths.filter(p => p.startsWith('/option/at_time/quote')).map(p => /strike_range=(\d+)/.exec(p)?.[1]), ['17']);
}

/* ---- 13. the review of 2026-10-31: each check failed before its fix ---------------------------------------- */
{
  const { setCompassHost } = await import('../../src/data/compassHost');
  const { thetaAnswer } = await import('../../src/data/compassServer');
  const scan = await import('../../src/data/compassScan');
  const model = await import('../../src/data/compassModel');
  const ledger = await import('../../src/data/compassLedger');
  const { settleSignal } = await import('../../src/data/compassOutcome');
  const { optionScanOpen } = await import('../../src/data/compassSession');
  const { BOOK_NAME, userWords } = await import('../../src/data/compassParams');
  const { trackRecord, trackLine, sessionOfSignal } = await import('../../src/data/compassTrack');
  type Answer = { status: number; data: unknown; error: string | null };
  let answer: (p: string) => Answer | Promise<Answer> = () => ({ status: 472, data: null, error: 'no_data' });
  const asked: string[] = [];
  setCompassHost({ server: true, theta: async p => { asked.push(p); return answer(p); }, asset: async () => null, econ: () => [] });

  /* a. the terminal's empty 200 (seen on option/at_time/quote: 0 bytes, then 18 kB a second later) is a fault to ask
        again, not an empty chain; a busy terminal and a 5xx are not "no quotes" either (each used to mark the name
        not scored for good: ok, no rows) */
  expectEqual('empty 200 is a fault (was: no error, no rows)', thetaAnswer(200, '', 'application/json').error, 'empty');
  const mk = nyWallTime(2026, 10, 29, 10, 15);
  const okOf = async (a: Answer) => {
    answer = p => (p.startsWith('/option/at_time/quote') ? a : { status: 472, data: null, error: 'no_data' });
    return (await scan.atMark('SPY', mk, 'odte')).ok;
  };
  expectEqual('at a mark: empty 200, busy and 500 stay pending; 472 and a 400 are answers', [
    await okOf({ status: 200, data: null, error: 'empty' }),
    await okOf({ status: 429, data: null, error: 'busy' }),
    await okOf({ status: 500, data: null, error: 'unavailable 500' }),
    await okOf({ status: 472, data: null, error: 'no_data' }),
    await okOf({ status: 400, data: null, error: 'bad request' }),
  ], [false, false, false, true, true]);
  /* the weekly expiry listing: a failed answer is not an empty listing memoised for an hour (was: every weekly late mark
     of the name read "no quotes" for the hour) */
  let lists = 0;
  answer = p => {
    if (!p.startsWith('/option/list/expirations')) return { status: 472, data: null, error: 'no_data' };
    lists += 1;
    return lists === 1 ? { status: 500, data: null, error: 'unavailable 500' } : { status: 200, data: [{ expiration: '2026-10-30' }, { expiration: '2026-11-02' }], error: null };
  };
  expectEqual('expirations: a 500 then listed, asked again (was: an empty list memoised, null for an hour)', [await scan.weeklyExpiry('ZZQX', mk), await scan.weeklyExpiry('ZZQX', mk)], [null, '2026-10-30']);

  /* b. the late sweep (Book C) calls five at most, like the live one (was: one would-call per root, every root), and
        the five go in the book's order, not the order the terminal answers in (was: whoever answered first) */
  model.importModelState({ day: '20261029' }, null);
  ledger.importWould([]);
  const sweepAt = nyWallTime(2026, 10, 29, 15, 20) + 15_000;
  const names = scan.odteBook(sweepAt).filter(n => optionScanOpen(n, 0, sweepAt));
  answer = async p => {
    const sym = /symbol=([A-Z]+)/.exec(p)?.[1] ?? '';
    if (p.startsWith('/option/list/expirations')) return { status: 200, data: [{ expiration: '2026-10-29' }], error: null };
    if (p.startsWith('/option/at_time/quote')) {
      /* the first names of the book answer last */
      await new Promise(res => setTimeout(res, 5 * (names.length - names.indexOf(sym))));
      const k = sym === 'SPXW' || sym === 'NDXP' || sym === 'RUTW' ? 1000 : 100;
      return { status: 200, data: [{ contract: { symbol: sym, strike: k, right: 'CALL', expiration: '2026-10-29' }, data: [{ bid: 0.5, ask: 0.52, timestamp: '2026-10-29T15:20:05.000', underlying_price: k }] }], error: null };
    }
    if (p.includes('/history/ohlc')) return { status: 200, data: [{ open: 100, high: 100, low: 100, close: 100, volume: 1, timestamp: '2026-10-29T15:20:00.000' }], error: null };
    return { status: 472, data: null, error: 'no_data' };
  };
  await scan.lotterySweep(sweepAt, true);
  const swept = model.exportModelState().wouldRoot?.C ?? [];
  expectEqual(`late sweep: five would-calls of ${names.length} roots, the book's first five`, [swept.length, swept], [5, names.slice(0, 5)]);

  /* c. a would-call holds its seat for the later late marks, and one root takes one book (was: the official seats
        only, so a missed morning listed more than five would-calls, and Book A and Book B on one root) */
  model.importModelState({ day: '20261029', rootA: ['AAPL'], rootAt: [['AAPL', nyWallTime(2026, 10, 29, 10, 0)]] }, null);
  const stubAt = (ticker: string, m: number) => ({ id: `${ticker}-1-C-top-setups-odte`, ticker, contract: `${ticker} 1C`, mark: nyWallTime(2026, 10, 29, 10, m) }) as unknown as Setup;
  model.noteWould(stubAt('MSFT', 0), 'A');
  model.noteWould(stubAt('NVDA', 30), 'A');
  expectEqual('would seats: at 10:15 AAPL (official) and MSFT (would 10:00), not NVDA (would 10:30)', [...model.heldSeatsAt(nyWallTime(2026, 10, 29, 10, 15), true)].sort(), ['AAPL', 'MSFT']);
  expectEqual('one root, one book: MSFT has a Book A would-call, so no Book B one', model.noteWould({ ...stubAt('MSFT', 5), id: 'MSFT-9-P-top-setups-odte' } as Setup, 'B'), false);

  /* d. settlement: a path that does not answer does not stop the other calls' settlement (was: return) */
  const sigOf = (contract: string, strike: number) => ({ key: `2026-10-29|${contract}`, id: contract, day: '2026-10-29', book: 'A' as const, ticker: 'SPY', contract, right: 'C' as const, strike, expiry: '2026-10-29', sleeve: 'odte' as const, firedAt: nyWallTime(2026, 10, 29, 10, 15), quoteAt: nyWallTime(2026, 10, 29, 10, 15), bid: 1, ask: 1.02, spot: 500, p1: 0.8, prun: null, runner: false, outcome: null, pathAt: 0, spark: [], how: 'live' as const, mark: nyWallTime(2026, 10, 29, 10, 15) });
  ledger.importSignals([sigOf('SPY 501C', 501), sigOf('SPY 500C', 500)].map((s, i) => ({ ...s, firedAt: s.firedAt - i })));
  answer = p => {
    if (p.includes('strike=501')) return { status: 500, data: null, error: 'unavailable 500' };
    if (p.includes('strike=500') && p.includes('interval=1m')) return { status: 200, data: [{ bid: 1.0, ask: 1.02, timestamp: '2026-10-29T10:16:00.000' }, { bid: 1.6, ask: 1.62, timestamp: '2026-10-29T10:20:00.000' }], error: null };
    return { status: 472, data: null, error: 'no_data' };
  };
  for (let i = 0; i < 20 && ledger.signals().some(s => s.contract === 'SPY 500C' && !s.outcome); i++) {
    await ledger.settleOpen(Date.now());
    await new Promise(res => setTimeout(res, 20));
  }
  expectEqual('settlement goes on past a failing path: SPY 500C settled behind SPY 501C', ledger.signals().map(s => [s.contract, s.outcome?.status ?? null]), [['SPY 501C', null], ['SPY 500C', 'closed']]);

  /* e. 24/7: the index roots' same-day sleeve trades the overnight session from 20:15 (was: skipped to midnight, the
        calendar day's contract read as done), and the late fill starts at the session's 20:15 (was: 09:30) */
  expectEqual('overnight 0DTE: SPXW and XSP at 21:00 Thursday (Friday\'s contract), not SPY', ['SPXW', 'XSP', 'SPY'].map(n => optionScanOpen(n, 0, nyWallTime(2026, 10, 29, 21, 0))), [true, true, false]);
  expectEqual('overnight 0DTE after midnight still on (it was)', optionScanOpen('SPXW', 0, nyWallTime(2026, 10, 30, 1, 0)), true);
  expectEqual('session opens: Thursday 10-29 at Wednesday 20:15, Monday 11-02 at Sunday 20:15', [scan.sessionOpenAt('2026-10-29'), scan.sessionOpenAt('2026-11-02')], [nyWallTime(2026, 10, 28, 20, 15), nyWallTime(2026, 11, 1, 20, 15)]);

  /* f. an overnight call flats at its session's 09:20, on the next calendar day (was: closed at the first quote after
        midnight as a "15:55 flat"), and its path is read through the flat's date */
  const night = { book: 'A' as const, right: 'C' as const, runner: false, firedAt: nyWallTime(2026, 10, 28, 21, 0) + 5_000, flatAt: nyWallTime(2026, 10, 29, 9, 20) };
  const path = [
    { t: nyWallTime(2026, 10, 28, 21, 1), bid: 1.0, ask: 1.04 },
    { t: nyWallTime(2026, 10, 29, 0, 1), bid: 1.05, ask: 1.09 },
    { t: nyWallTime(2026, 10, 29, 9, 19), bid: 1.1, ask: 1.14 },
    { t: nyWallTime(2026, 10, 29, 9, 20), bid: 1.12, ask: 1.16 },
  ];
  const o = settleSignal(night, path, [], nyWallTime(2026, 10, 29, 12, 0));
  expectEqual('overnight call: filled 21:01, out at the 09:20 flat next morning', [o.fill?.at, o.exit?.at, o.exit?.why, o.exit?.px], [nyWallTime(2026, 10, 28, 21, 1), nyWallTime(2026, 10, 29, 9, 20), '09:20 flat', 1.12]);
  asked.length = 0;
  answer = () => ({ status: 472, data: null, error: 'no_data' });
  await ledger.contractPath({ ticker: 'SPXW', expiry: '2026-10-29', strike: 7700, right: 'C', day: '2026-10-28', book: 'A', flatAt: night.flatAt }, null);
  expectEqual('overnight path read through the flat\'s date', /start_date=20261028&end_date=20261029/.test(asked[0] ?? ''), true);

  /* g. the track record is the sum of its rows: every slice adds up to the whole, to the cent */
  const closedAt = (contract: string, book: 'A' | 'B' | 'C', pnl: number, ret: number, fees: number, extra: Record<string, unknown> = {}) => ({ ...sigOf(contract, 1), book, outcome: { status: 'closed' as const, fill: null, exit: null, peak: 0, stop: 0, last: null, ret, pnl, fees, heldMin: 1 }, ...extra }) as unknown as Signal;
  const rows = [
    closedAt('SPY 500C', 'A', 87.91, 50, 1.09),
    closedAt('TLT 82P', 'A', -0.08, 1.8, 1.08, { outsideTrained: true }),
    closedAt('RUTW 2850P', 'B', -591.1, -53.6, 1.1),
    closedAt('XSP 770C', 'C', 29.92, 44.9, 1.08),
    closedAt('SPXW 7700C', 'A', 12.5, 10, 1.1, { tapeSession: 'overnight', mark: nyWallTime(2026, 10, 28, 21, 0) }),
    { ...sigOf('QQQ 700C', 700), outcome: null } as unknown as Signal,
  ];
  const tr = trackRecord(rows);
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  expectEqual('track: all = rows (calls, won, lost, open, pnl, worst)', [tr.all.calls, tr.all.won, tr.all.lost, tr.all.open, tr.all.pnl, tr.all.worst?.pnl], [6, 3, 2, 1, sum([87.91, -0.08, -591.1, 29.92, 12.5]), -591.1]);
  expectEqual('track: the books add up to all', [sum(Object.values(tr.byBook).map(l => l.pnl)), Object.values(tr.byBook).reduce((a, l) => a + l.calls, 0)], [tr.all.pnl, tr.all.calls]);
  expectEqual('track: the sessions add up to all', [sum(Object.values(tr.bySession).map(l => l.pnl)), Object.values(tr.bySession).reduce((a, l) => a + l.calls, 0), tr.bySession.overnight.calls], [tr.all.pnl, tr.all.calls, 1]);
  expectEqual('track: hit rate and average return of the closed rows', [tr.byBook.A.hitRate, tr.byBook.A.avgRet, tr.all.outsideTrained, trackLine([]).hitRate], [2 / 3, Number(((50 + 1.8 + 10) / 3).toFixed(2)), 1, null]);
  expectEqual('track: a call\'s session from its mark when the field is absent', [sessionOfSignal({ ticker: 'SPY', firedAt: 0, mark: nyWallTime(2026, 10, 29, 8, 0) }), sessionOfSignal({ ticker: 'SPXW', firedAt: 0, mark: nyWallTime(2026, 10, 29, 8, 0) }), sessionOfSignal({ ticker: 'SPY', firedAt: 0, mark: nyWallTime(2026, 10, 29, 10, 0) })], ['pre', 'overnight', 'regular']);

  /* h. the names a viewer reads: no "Model 1/2", no "Book A/B/C", no vendor, in old records and new */
  expectEqual('viewer words', [
    userWords('Model 2 not scored: range compression'),
    userWords('Book A 2. Book B 0. Book C 5.'),
    userWords('Each Book A, B or C call'),
    userWords('Roots Book A and Book B have called'),
    userWords('ThetaData offline — reconnecting.'),
    userWords('the quotes ThetaData recorded at the mark'),
  ], [
    'Runner score not scored: range compression',
    `${BOOK_NAME.A} 2. ${BOOK_NAME.B} 0. ${BOOK_NAME.C} 5.`,
    `Each ${BOOK_NAME.A}, ${BOOK_NAME.B} or ${BOOK_NAME.C} call`,
    `Roots ${BOOK_NAME.A} and ${BOOK_NAME.B} have called`,
    'Live data offline — reconnecting.',
    'the recorded quotes at the mark',
  ]);
}

done();
