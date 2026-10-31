/*
  A Compass call's return from its fill (data/compassReturn.ts): (bid − fill) ÷ fill on the live bid, waiting before the
  fill, the last good bid with its time when no fresh quote is heard (never shown as live), and the capture at the exit
  once closed, P&L (exit − fill) × 100 with no fees.
*/
import { HEARD_MS, QUOTE_AGE_MS, pctWord, pnlWord, returnOf, returnWords } from '../src/data/compassReturn';
import type { Outcome } from '../src/data/compassOutcome';

let failed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name);
  } else console.log('ok', name);
};
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;

const T = Date.UTC(2026, 9, 29, 19, 30);
const base: Outcome = { status: 'open', fill: { at: T - 600_000, bid: 1.75, ask: 1.78 }, exit: null, peak: 1.9, stop: 0, last: { t: T - 60_000, bid: 1.8, ask: 1.82 }, ret: null, pnl: null, heldMin: 9 };
const call = (o: Outcome | null) => ({ outcome: o });

const waiting = returnOf(call({ ...base, status: 'waiting', fill: null, last: null }), null, T);
check('before the fill it waits', waiting.state === 'waiting' && waiting.pct == null && returnWords(waiting).main === 'Waiting for fill');
check('no outcome yet waits', returnOf(call(null), null, T).state === 'waiting');
check('unfilled is not a return', returnOf(call({ ...base, status: 'unavailable', fill: null }), null, T).state === 'unavailable');

const live = returnOf(call(base), { bid: 1.87, ask: 1.9, at: T - 1_000, heard: T - 500 }, T);
check('live: (bid − fill) ÷ fill on the bid, not the mid or the ask', live.state === 'live' && near(live.pct, ((1.87 - 1.78) / 1.78) * 100) && near(live.px, 1.87));
check('live P&L per contract, no fees', near(live.pnl, (1.87 - 1.78) * 100));
check('live words', returnWords(live).main === '+5.1%' && returnWords(live).rest === '$1.87 bid' && returnWords(live).ink === 'text-bull');
const down = returnOf(call(base), { bid: 1.72, ask: 1.75, at: T - 1_000, heard: T - 500 }, T);
check('a loss is in loss ink', returnWords(down).main === '−3.4%' && returnWords(down).ink === 'text-bear');

const unheard = returnOf(call(base), { bid: 1.87, ask: 1.9, at: T - 20_000, heard: T - HEARD_MS - 1 }, T);
check('a quote not heard lately is the last good one, as of its time', unheard.state === 'asof' && near(unheard.px, 1.87) && /as of \d\d:\d\d$/.test(returnWords(unheard).rest));
check('as-of is never in live ink', returnWords(unheard).ink === 'text-textSecondary');
const oldStamp = returnOf(call(base), { bid: 1.87, ask: 1.9, at: T - QUOTE_AGE_MS - 1, heard: T - 100 }, T);
check('a heard quote with an old stamp is not live', oldStamp.state === 'asof');
const fromRecord = returnOf(call(base), null, T);
check('no live quote: the server read, as of', fromRecord.state === 'asof' && near(fromRecord.px, 1.8) && fromRecord.at === T - 60_000);
const newerRecord = returnOf(call({ ...base, last: { t: T - 1_000, bid: 1.81, ask: 1.83 } }), { bid: 1.87, ask: 1.9, at: T - 30_000, heard: T - 30_000 }, T);
check('the newer of the two quotes is read', near(newerRecord.px, 1.81));
const crossed = returnOf(call(base), { bid: 1.95, ask: 1.9, at: T - 1_000, heard: T - 500 }, T);
check('a crossed quote is not a valid live quote', crossed.state === 'asof' && near(crossed.px, 1.8));
check('filled, no quote at all', returnOf(call({ ...base, last: null }), null, T).state === 'noquote');

const closed = returnOf(call({ ...base, status: 'closed', exit: { at: T - 120_000, px: 2.33, why: 'TP1' }, ret: 30.9, pnl: 55 }), { bid: 9, ask: 9.1, at: T, heard: T }, T);
check('closed: captured at the exit, the live quote ignored', closed.state === 'captured' && near(closed.px, 2.33) && near(closed.pct, ((2.33 - 1.78) / 1.78) * 100));
check('closed P&L is (exit − fill) × 100, no fees', near(closed.pnl, 55));
check('closed words', returnWords(closed).main === 'Captured +30.9%' && returnWords(closed).rest === '+$55.00');

check('signs and zero', pctWord(0.04) === '0.0%' && pctWord(-3.14) === '−3.1%' && pnlWord(-1234.5) === '−$1,234.50' && pnlWord(0) === '$0.00');

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('compass-return-proof: all passed');
