/*
  The replay seam: a pinned engine clock moves the calendar with it and is restored afterwards, even on a throw.
  Run: npx tsx scripts/replay-proof.ts
*/
import { now, withEngineClock } from '../src/core/clock';
import { expiryFor, isoDate } from '../src/core/calendar';
import { barsAt, levelsAt, replaySpotAt } from '../src/data/replay';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

/* noon UTC: the engine's day is New York's, and a local midnight is the evening before there on a UTC machine */
const friday = new Date(Date.UTC(2026, 6, 24, 16)); // Fri Jul 24 2026, noon ET
const tuesday = new Date(Date.UTC(2026, 6, 21, 16));
const saturday = new Date(Date.UTC(2026, 6, 25, 16));

const twoOutFromFri = withEngineClock(friday, () => expiryFor(2));
check('Friday pin: "2 days" resolves to Monday', twoOutFromFri.weekday === 'Mon', `${twoOutFromFri.weekday} ${twoOutFromFri.label}`);
const twoOutFromTue = withEngineClock(tuesday, () => expiryFor(2));
check('Tuesday pin: "2 days" resolves to Thursday', twoOutFromTue.weekday === 'Thu', `${twoOutFromTue.weekday} ${twoOutFromTue.label}`);
const sameDaySat = withEngineClock(saturday, () => expiryFor(0));
check('Saturday pin: same-day resolves to the next session', sameDaySat.weekday === 'Mon' && sameDaySat.dte === 2, `${sameDaySat.weekday} dte ${sameDaySat.dte}`);
check('the same pin answers the same expiry twice', withEngineClock(friday, () => isoDate(expiryFor(5).date)) === withEngineClock(friday, () => isoDate(expiryFor(5).date)));

const wall = Date.now();
check('the clock is the wall clock outside a pin', Math.abs(now().getTime() - wall) < 1000);
try {
  withEngineClock(friday, () => {
    throw new Error('inside');
  });
} catch {
  /* expected */
}
check('a throw inside the pin restores the wall clock', Math.abs(now().getTime() - Date.now()) < 1000);
const nested = withEngineClock(friday, () => [withEngineClock(tuesday, () => now().getUTCDate()), now().getUTCDate()]);
check('nested pins unwind in order', nested[0] === 21 && nested[1] === 24, nested.join(','));

/* the replay steps at bar boundaries: no glide toward the next bar's close, no blend toward the next book */
{
  const t0 = 1_790_000_000;
  const bar = (i: number, close: number) => ({ time: t0 + i * 60, open: close, high: close, low: close, close, volume: 1 });
  const lv = (v: number) => [{ strike: 500, value: v }];
  const range = { ticker: 'SPY', bars: [bar(0, 100), bar(1, 102), bar(2, 104)], snaps: new Map([[t0, { time: t0, levels: lv(1) }], [t0 + 120, { time: t0 + 120, levels: lv(9) }]]), length: 120 };
  check('halfway through the first bar the name stands at its close, 100 — not 101 (half way to the next close)', replaySpotAt(range, 30) === 100, String(replaySpotAt(range, 30)));
  check('…the bars drawn are the recorded ones, the last not bent toward the next', barsAt(range, 30).length === 1 && barsAt(range, 30)[0].close === 100);
  check('in the second bar, with no book of its own, the book is the first bar’s — never the third’s', levelsAt(range, 90)[0]?.value === 1, String(levelsAt(range, 90)[0]?.value));
  check('…halfway through the first bar the book is its own, unblended', levelsAt(range, 30)[0]?.value === 1);
  check('…and at the third bar, the third’s', levelsAt(range, 120)[0]?.value === 9 && replaySpotAt(range, 120) === 104);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
