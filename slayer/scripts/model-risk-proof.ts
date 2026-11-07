/* Hand checks for Model Risk. No terminal, no trees. */
import { weekdayDte, atmStrike, spreadPass } from '../src/data/compassParams';
import { book0Root, book17Root } from '../src/data/modelRiskScan';
import {
  cashMinute,
  inTailWindow,
  openingRange,
  trailRange,
  breakSide,
  rankMinute,
  minutesLeft,
  contractRank,
  putRank,
  exitAt,
  tailReturn,
  tailDollars,
  quoteFresh,
  tailQuoteOk,
  betterRank,
} from '../src/data/modelRisk';

let failed = 0;
const ok = (name: string, cond: boolean) => {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else console.log('ok', name);
};

ok('09:30 is minute 0', cashMinute(9 * 60 + 30) === 0);
ok('15:59 is minute 389', cashMinute(15 * 60 + 59) === 389);
ok('16:00 is minute 390 and is scanned', cashMinute(16 * 60) === 390 && inTailWindow(16 * 60));
ok('every hour is scanned', inTailWindow(0) && inTailWindow(4 * 60) && inTailWindow(9 * 60 + 30) && inTailWindow(15 * 60 + 59) && inTailWindow(20 * 60));
ok('10:00 is cash minute 30', cashMinute(10 * 60) === 30);

const closes = Array<number | null>(390).fill(100);
closes[10] = 101;
closes[20] = 99;
const or = openingRange(closes);
ok('opening range is the closes, high 101 low 99', !!or && or.high === 101 && or.low === 99);

const trail = Array<number | null>(80).fill(null);
for (let i = 0; i < 30; i++) trail[i * 2] = i === 4 ? 101 : i === 9 ? 99 : 100;
const tr = trailRange(trail, 60);
ok('trailing range is the last 30 closes, gaps skipped', !!tr && tr.high === 101 && tr.low === 99);
ok('29 closes is not a range', trailRange(trail, 58) == null);
const flatRange = Array<number | null>(40).fill(null);
for (let i = 0; i < 30; i++) flatRange[i] = 100;
const same = trailRange(flatRange, 30);
ok('a flat range still has a high and a low', !!same && same.high === 100 && same.low === 100);
ok('above a flat range is a put, under it a call, on it nothing', breakSide(100.01, 100, 100) === 'P' && breakSide(99.99, 100, 100) === 'C' && breakSide(100, 100, 100) == null);

ok('before the open the rank clock is the open', rankMinute(4 * 60) === 0 && rankMinute(9 * 60 + 30) === 0);
ok('16:00 has no same-day time left', rankMinute(16 * 60) === 390 && putRank(752, 750, rankMinute(16 * 60), 0, 3) == null);
ok('a weekly still ranks after the close', !!putRank(752, 750, rankMinute(18 * 60), 3, 3));

ok('same-day trading dte is 0', weekdayDte('20261104', '20261104') === 0);
ok('Wednesday to next Monday is 3', weekdayDte('20261104', '20261109') === 3);
ok('minutes left, same-day at the open', minutesLeft(0, 0) === 390);
ok('minutes left, 3 trading days at the open', minutesLeft(0, 3) === 1560);
ok('minutes left at 15:59 is 1', minutesLeft(389, 0) === 1);

ok('ATM tie takes the lower strike', atmStrike([100, 102], 101) === 100);

const bid = 1;
const ask = 1.04 / 0.96;
ok('a width of exactly 8% passes', spreadPass(bid, Number(ask.toFixed(10))));
ok('wider than 8% does not', !spreadPass(1, 1.2));
ok('bid 0.15 does not pass', !spreadPass(0.15, 0.16));
ok('bid just over 0.15 can pass', spreadPass(0.16, 0.17));

ok('a quote 1000 ms old is fresh', quoteFresh(1_000, 2_000));
ok('a quote 1001 ms old is stale', !quoteFresh(1_000, 2_001));

const rank = putRank(752, 750, 60, 0, 3);
ok('an ATM-ish put ranks', !!rank && rank.gamma > 0 && rank.thetaYear < 0 && rank.score > 0);
const call = contractRank(752, 750, 60, 0, 3, true);
ok('an ATM-ish call ranks', !!call && call.gamma > 0 && call.thetaYear < 0 && call.score > 0);
ok('no price, no contract', putRank(752, 750, 60, 0, 0) == null);
ok('no time left, no contract', putRank(752, 750, 390, 0, 3) == null);

const path = Array<number | null>(390).fill(null);
for (let i = 0; i <= 40; i++) path[i] = 100;
path[41] = 101;
path[42] = 100;
const out = exitAt(path, 40, 100.5);
ok('first close back through the high exits the put', !!out && out.minute === 42 && out.why === 'back');
const callPath = Array<number | null>(390).fill(null);
for (let i = 0; i <= 40; i++) callPath[i] = 100;
callPath[41] = 98;
callPath[42] = 99.5;
const callOut = exitAt(callPath, 40, 99, 'C');
ok('first close back through the low exits the call', !!callOut && callOut.minute === 42 && callOut.why === 'back');

const held = Array<number | null>(390).fill(null);
for (let i = 0; i <= 389; i++) held[i] = 110;
const heldOut = exitAt(held, 40, 100);
ok('30 minutes with no cross is the break holding', !!heldOut && heldOut.minute === 70 && heldOut.why === 'held');
const late = Array<number | null>(1000).fill(null);
late[900] = 110;
late[980] = 100;
const lateOut = exitAt(late, 900, 100);
ok('a later cross still exits as the cross when no close printed in between', !!lateOut && lateOut.minute === 980 && lateOut.why === 'back');

ok('a strike 1.6% out is refused', !tailQuoteOk(1.9, 1.94, 101.6, 100));
ok('a strike inside 1.5% with a tight quote is kept', tailQuoteOk(1.9, 1.94, 101, 100));
/* no spread cap and no price cap (2026-11-07): the cost rule chooses (tailPick); only a quote that is not one is refused */
ok('a 5% spread is no longer refused by a cap', tailQuoteOk(1.9, 2.0, 100, 100));
ok('a single name at $5 is no longer refused by a cap', tailQuoteOk(5, 5.1, 100, 100));
ok('an index at $25 is kept', tailQuoteOk(25.4, 25.5, 7595, 7600));
ok('a crossed, locked or zero-bid quote is refused', !tailQuoteOk(2, 1.9, 100, 100) && !tailQuoteOk(2, 2, 100, 100) && !tailQuoteOk(0, 0.05, 100, 100));
ok('inside the band the closer strike wins', betterRank(1.02, 0.01, 1, 0.002) === false && betterRank(1.2, 0.01, 1, 0.002) === true);

ok('return and dollars', tailReturn(2, 1.5) === -0.25 && tailDollars(2, 1.5) === -50);

ok('book 0 uses SPXW and RUTW', book0Root('SPX') === 'SPXW' && book0Root('RUT') === 'RUTW');
ok('book 0 skips NDX and VIX', book0Root('NDX') === null && book0Root('VIX') === null);
ok('a stock book 0 is the stock', book0Root('AAPL') === 'AAPL');
ok('book 1-7 keeps the listed root', book17Root('SPX') === 'SPXW' && book17Root('AAPL') === 'AAPL');

if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('model risk proof passed');
