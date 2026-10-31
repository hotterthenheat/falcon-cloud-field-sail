/*
  REVIEW · THE ENGINE'S PROOF — `npx tsx scripts/review-engine-proof.ts`
  The rules page (docs/review-backtest-rules.md), checked against the engine on a hand-made market
  (scripts/review-market-fixture.ts), where every fill can be worked out from its formula. Exits 1 on a miss.
*/
import { accountOf, advance, amend, attach, bankedOf, bookOf, cancel, cashOf, cutsOf, dayStateOf, dayStopOf, equityAtOpen, floorOf, ladderRoom, namesOf, newSession, nextOpen, pendingSettlement, place, playStep, rebase, refusal, setBreakeven, setTrail, spokenFor, stampOf, statsOf, MULT, type Session } from '../src/data/review/engine';
import { TRADE_COLUMNS, dayRowsOf, reportDaysCsv, reportTradesCsv, tradeFees } from '../src/data/review/reportCsv';
import { csvCells } from '../src/data/review/journalManual';
import { splitQty } from '../src/data/review/ladder';
import { chainAt, contractKey, contractWords, expiriesAt, quoteAt, quoteWith, spotForBid, yearsLeft } from '../src/data/review/quotes';
import { LAST_MIN, barTime, closeMinOf, nbboAt, parseBars, parseListing, parseQuotes, putBars, putQuotes, spotAt } from '../src/data/review/history';
import { D1, D2, D3, FAR, NEAR, askOf, bidOf, installTestMarket, spot } from './review-market-fixture';

let misses = 0;
const ok = (what: string, pass: boolean, detail = '') => {
  if (!pass) misses++;
  console.log(`${pass ? 'ok  ' : 'MISS'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

installTestMarket();

/* ---- the recorded answers, read ---- */
{
  /* a v3 interval quote row is the NBBO standing at its stamp: the 09:31:00 row is the end of minute 0 */
  const rows = [
    { contract: { symbol: 'SPY', expiration: '2026-10-30', strike: 500, right: 'CALL' }, data: [{ timestamp: '2026-10-28T09:30:00.000', bid: 1.0, ask: 1.1 }, { timestamp: '2026-10-28T09:31:00.000', bid: 1.2, ask: 1.25 }, { timestamp: '2026-10-28T16:00:00.000', bid: 0.4, ask: 0.45 }] },
    { symbol: 'SPY', expiration: '2026-10-30', strike: 501, right: 'PUT', timestamp: '2026-10-28T10:00:00.000', bid: 2.0, ask: 1.9 },
  ];
  const { flatRows } = await import('../src/data/review/history');
  const got = parseQuotes('SPY', flatRows(rows));
  const call = got.get('SPY|2026-10-30|500|C')!;
  ok('the 09:31:00 row is the quote at the end of minute 0; the 09:30:00 row (the open) is before it', call.bid[0] === 1.2 && call.ask[0] === 1.25);
  ok('the 16:00:00 row is minute 389, the bell', call.bid[389] === 0.4 && call.ask[389] === 0.45);
  ok('a minute with no row has no row of its own', Number.isNaN(call.bid[1]));
  ok('a crossed quote is marked as no market', got.get('SPY|2026-10-30|501|P')!.ask[29] === -2);
  const leg = { ticker: 'QQQ', expiry: '2026-11-20', strike: 400, right: 'C' as const };
  const bids = new Array(390).fill(NaN);
  const asks = new Array(390).fill(NaN);
  bids[5] = 1;
  asks[5] = 1.1;
  bids[9] = -2;
  asks[9] = -2;
  putQuotes(leg, '2026-11-02', bids, asks);
  ok('a quote stands until it changes: minute 7 reads minute 5’s', nbboAt(leg, '2026-11-02', 7)?.ask === 1.1 && nbboAt(leg, '2026-11-02', 4) == null);
  ok('…and a minute that was no market is not carried over by an older quote', nbboAt(leg, '2026-11-02', 9) == null && nbboAt(leg, '2026-11-02', 12) == null);
  /* bars are stamped at their start: 09:30:00 is minute 0 */
  const b = parseBars('2026-10-28', [{ timestamp: '2026-10-28T09:30:00.000', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, { timestamp: '2026-10-28T09:32:00.000', open: 1.6, high: 1.7, low: 1.6, close: 1.7, volume: 5 }])!;
  /* a minute with no trade is a gap (411b43b: no made-up flat candles); every reader looks a minute up by its time */
  ok('a bar is stamped at its start; a minute with no trade is a gap, not a flat candle', b.bars.length === 2 && b.bars[0].time === barTime('2026-10-28', 0) && b.bars[0].close === 1.5 && b.bars[1].time === barTime('2026-10-28', 2) && b.bars[1].close === 1.7 && b.last === 2);
  const l = parseListing('2026-10-28', [{ symbol: 'SPY', expiration: '2026-10-27', strike: 500, right: 'C' }, { symbol: 'SPY', expiration: '2026-10-30', strike: 501, right: 'PUT' }, { symbol: 'SPY', expiration: '2026-10-30', strike: 499, right: 'P' }])!;
  ok('the listing keeps the expiries at or after the day, strikes low to high', l.expiries.join() === '2026-10-30' && l.strikes['2026-10-30|P'].join() === '499,501');
  /* an early close: the name's last bar is 12:59 (minute 209); after it no quote stands */
  const early = '2026-11-27';
  putBars('ZZZ', early, Array.from({ length: 210 }, (_, m) => ({ time: barTime(early, m), open: 10, high: 10, low: 10, close: 10, volume: 1 })));
  putQuotes({ ticker: 'ZZZ', expiry: early, strike: 10, right: 'C' }, early, new Array(390).fill(0.5), new Array(390).fill(0.6));
  ok('an early close ends the day at its last bar: no quote stands after it', closeMinOf('ZZZ', early) === 209 && nbboAt({ ticker: 'ZZZ', expiry: early, strike: 10, right: 'C' }, early, 209) != null && nbboAt({ ticker: 'ZZZ', expiry: early, strike: 10, right: 'C' }, early, 210) == null);
}

/* ---- the market as the engine reads it ---- */
const call500 = { ticker: 'SPY', strike: 500, right: 'C' as const, expiry: NEAR };
/* D1 minute 30: SPY 500.60 → the 500 call is 0.60 in the money + 2.50 = 3.10 mid, 3.05 bid, 3.15 ask */
const q0 = quoteAt(call500, D1, 30);
ok('the quote is the recorded NBBO at the minute', q0.bid === 3.05 && q0.ask === 3.15 && q0.mark === 3.1 && q0.spot === 500.6, `${q0.bid} / ${q0.ask} at ${q0.spot}`);
ok('its IV and greeks come from the mid: an in-the-money call is over half a delta, and loses value a day', q0.iv > 0 && q0.delta > 0.5 && q0.delta < 1 && q0.theta < 0, `iv ${(q0.iv * 100).toFixed(1)}% · delta ${q0.delta.toFixed(2)}`);
ok('the expiries are the ones quoted that day', expiriesAt('SPY', D1).map(e => e.iso).join() === `${NEAR},${FAR}` && expiriesAt('SPY', D3).map(e => e.dte).join() === '0,9');
ok('time runs out: less is left later in the day', yearsLeft(D1, 300, NEAR) < yearsLeft(D1, 30, NEAR));
const chain = chainAt('SPY', D1, 30, NEAR, 3);
ok('the chain is the listed strikes round the money, highest first', chain.rows.map(r => r.strike).join() === '504,503,502,501,500,499,498' && chain.rows[4].call.ask === 3.15);

/* ---- orders and fills ---- */
let s = newSession({ id: 't', name: 'proof', ticker: 'SPY', startCash: 10000, startDay: D1, now: 0 });
ok('a new session is marked as played on the recorded quotes', s.tape === 'theta');
s = advance(s, { day: D1, minute: 30 }, 0);
s = place(s, { contract: call500, side: 'buy', qty: 2, kind: 'market' }, 0);
ok('a market buy fills at the minute’s ask', s.fills.length === 1 && s.fills[0].price === 3.15 && s.fills[0].at.minute === 30);
/* 10,000 − 3.15 × 100 × 2 − 0.65 × 2 = 9,368.70 */
ok('cash pays the premium and the fee', cashOf(s) === 9368.7, cashOf(s).toFixed(2));
/* marked at the 3.10 mid: 620 against 631.30 paid */
ok('the position is marked at the mid, behind by half the spread and the fee', accountOf(s).positions[0].pnl === -11.3, String(accountOf(s).positions[0].pnl));
ok('a buy the cash cannot pay for is refused, in words', refusal(s, { contract: call500, side: 'buy', qty: 500, kind: 'market' }) === 'Not enough cash — this needs $157825.00');
ok('selling what is not held is refused', refusal(s, { contract: { ...call500, right: 'P' }, side: 'sell', qty: 1, kind: 'market' }) === 'You do not hold that contract');
ok('the clock cannot be pulled back past the last fill', (() => { const back = advance(s, { day: D1, minute: 5 }, 0); return back.cursor.minute === floorOf(s).minute && back.fills.length === 1; })());
s = place(s, { contract: call500, side: 'sell', qty: 1, kind: 'limit', price: 15.75, tif: 'day' }, 0);
s = advance(s, { day: D1, minute: LAST_MIN }, 0);
ok('a day order that did not fill is cancelled at 16:00', s.orders.find(o => o.kind === 'limit')?.status === 'cancelled' && s.orders.find(o => o.kind === 'limit')?.why === 'the day ended');
/* the 500 call's bid never goes under 2.45 (an out-of-the-money mid is 2.50): a 1.58 stop never fills; on D3 it expires */
s = place(s, { contract: call500, side: 'sell', qty: 2, kind: 'stop', price: 1.58 }, 0);
s = advance(s, { day: D3, minute: LAST_MIN }, 0);
const { trades, positions } = bookOf(s);
/* D3 closes at 497.11: the 500 call settles at nothing, with no fee: −631.30, −1R */
ok('held to the bell of its expiry, it settles at what it is worth in the money — here nothing, with no fee', positions.length === 0 && trades.length === 1 && trades[0].how === 'expired' && s.fills[s.fills.length - 1].price === 0 && s.fills[s.fills.length - 1].fee === 0);
ok('1R is what was paid', trades[0].pnl === -631.3 && near(trades[0].r, -1, 1e-9), `${trades[0].pnl} · ${trades[0].r}R`);
ok('cash and the record agree', near(cashOf(s), 10000 + trades[0].pnl, 0.001));
ok('nothing is left working on an expired contract', s.orders.every(o => o.status !== 'working'));
ok('a moment orders across days without a window', stampOf({ day: D2, minute: 0 }) > stampOf({ day: D1, minute: LAST_MIN }) && stampOf({ day: '2025-01-02', minute: 5 }) < stampOf({ day: D1, minute: 0 }));

/* a stop the tape reaches: bought at minute 30 (3.15); after minute 100 SPY falls a cent a minute, and the bid is 3.00 at minute 245 (500.55) */
let st0 = place(advance(newSession({ id: 'st', name: 'stop', ticker: 'SPY', startCash: 10000, startDay: D1, now: 0 }), { day: D1, minute: 30 }, 0), { contract: call500, side: 'buy', qty: 1, kind: 'market', bracket: { stop: 3.0 } }, 0);
st0 = advance(st0, { day: D1, minute: LAST_MIN }, 0);
const sf = st0.fills[st0.fills.length - 1];
ok('a stop sells the first minute the bid is at or under it, at that bid', sf.how === 'stop' && sf.at.minute === 245 && sf.price === 3.0, `minute ${sf.at.minute} at ${sf.price}`);

/* ---- a target and a stop ride a buy; one fills, the other goes ---- */
/* D1 minute 10: SPY 500.20, the ask is 2.75. Target 3.16: the bid reaches 3.17 at minute 36 (500.72) */
let t = advance(newSession({ id: 'u', name: 'bracket', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
t = place(t, { contract: call500, side: 'buy', qty: 3, kind: 'market', bracket: { target: 3.16, stop: 2.34 } }, 0);
ok('the pair is working after the buy', t.orders.filter(o => o.status === 'working' && o.oco).length === 2);
ok('the held contracts are spoken for by the pair — for a sell that WAITS; a market sell by hand never is', refusal(t, { contract: call500, side: 'sell', qty: 1, kind: 'limit', price: 5.5 }) === 'All 3 are working in your bracket; none can be sold here' && refusal(t, { contract: call500, side: 'sell', qty: 1, kind: 'market' }) === null);
t = advance(t, { day: D1, minute: LAST_MIN }, 0);
const bt = bookOf(t).trades[0];
ok('the target filled at the first bid over it, and the stop went with it', bt?.how === 'target' && bt.closed.minute === 36 && bt.avgOut === 3.17 && t.orders.some(o => o.kind === 'stop' && o.why === 'its pair filled'), `${bt?.how} at ${bt?.closed.minute} for ${bt?.avgOut}`);
t = cancel(t, 'nope', 0);

/* ---- a target and a stop put on a position that is already open ---- */
let v = place(advance(newSession({ id: 'v', name: 'attach', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 20 }, 0), { contract: call500, side: 'buy', qty: 2, kind: 'market' }, 0);
/* minute 20: bid 2.85 */
v = attach(v, call500, 'target', 3.7, 0);
v = attach(v, call500, 'stop', 2.0, 0);
const pair = v.orders.filter(o => o.status === 'working');
ok('dragged off the position: a target and a stop, one pair, for all that is held', pair.length === 2 && pair[0].oco === pair[1].oco && pair.every(o => o.qty === 2));
v = attach(v, call500, 'target', 4.2, 0);
ok('a second pull ADDS a target, with half the contracts', v.orders.filter(o => o.status === 'working' && o.kind === 'limit').map(o => o.qty).join() === '1,1' && v.orders.filter(o => o.status === 'working').every(o => o.oco === pair[0].oco));
ok('a stop over the bid is not taken', attach(v, call500, 'stop', 3.0, 0) === v);

/* ---- a way out that waits on THE NAME'S price ---- */
/* D1 minute 120: SPY 501.80; the 502 call (out of the money) is 2.45 / 2.55. SPY is at 501.50 first at minute 150. */
const c502 = { ticker: 'SPY', strike: 502, right: 'C' as const, expiry: NEAR };
let w = advance(newSession({ id: 'w', name: 'on the name', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 120 }, 0);
ok('a stop on the name above where it stands is refused, in words', (refusal(w, { contract: c502, side: 'buy', qty: 1, kind: 'market', bracket: { stop: 502.8, on: 'name' } }) ?? '').startsWith('The stop has to be below where SPY stands'));
w = place(w, { contract: c502, side: 'buy', qty: 1, kind: 'market', bracket: { stop: 501.5, on: 'name' } }, 0);
const ns = w.orders.find(o => o.on === 'name')!;
ok('the stop that rides the buy waits on the name', !!ns && ns.kind === 'stop' && ns.price === 501.5 && ns.status === 'working');
ok('its planned risk is kept as a price of the contract, on the model at the minute’s IV', near(w.fills[0].plannedStop ?? -1, quoteWith(c502, D1, 120, 501.5).bid));
w = advance(w, { day: D1, minute: 149 }, 0);
ok('the clock alone does not set it off: it waits while the name is over its level', bookOf(w).positions.length === 1);
w = advance(w, { day: D1, minute: LAST_MIN }, 0);
const wf = w.fills[w.fills.length - 1];
ok('it sells the first minute the name is at or under its level, at that minute’s bid', wf.how === 'stop' && wf.at.minute === 150 && wf.price === 2.45, `minute ${wf.at.minute} · ${wf.price}`);
ok('the record calls it stopped', bookOf(w).trades[0]?.how === 'stopped');

/* the same way out, turned from one into the other without moving its line */
let x = place(advance(newSession({ id: 'x', name: 'rebase', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 20 }, 0), { contract: call500, side: 'buy', qty: 1, kind: 'market' }, 0);
x = attach(x, call500, 'target', 3.7, 0);
const xid = x.orders.find(o => o.status === 'working')!.id;
const xLevel = spotForBid(call500, D1, 20, 3.7)!;
x = rebase(x, xid, 'name', 0);
ok('to the name: the level that gives its price this minute', x.orders.find(o => o.id === xid)!.on === 'name' && x.orders.find(o => o.id === xid)!.price === xLevel && near(quoteWith(call500, D1, 20, xLevel).bid, 3.7, 0.02), `3.70 → SPY ${xLevel}`);
x = rebase(x, xid, 'contract', 0);
ok('and back: what the contract would bid there this minute', x.orders.find(o => o.id === xid)!.on === undefined && near(x.orders.find(o => o.id === xid)!.price!, 3.7, 0.02));

/* ---- a vertical spread, bought for a debit ---- */
/* D1 minute 25: SPY 500.50. The 500 call is 2.95 / 3.05, the 502 call 2.45 / 2.55: the 500/502 spread is 0.40 / 0.60 */
const spread = { ...call500, short: 502 };
const sqd = quoteAt(spread, D1, 25);
ok('a spread is quoted at its natural prices: ask = bought ask − sold bid, bid = bought bid − sold ask', sqd.ask === 0.6 && sqd.bid === 0.4, `${sqd.bid} / ${sqd.ask}`);
ok('it is never worth more than its width, wherever the name goes', quoteWith(spread, D1, 25, 9999).ask <= 2 + 1e-9 && quoteWith(spread, D1, 25, 1).bid === 0);
ok('a price past its width is out of reach', spotForBid(spread, D1, 25, 2.5) === null);
let sp = advance(newSession({ id: 'sp', name: 'spread', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 25 }, 0);
ok('a spread sold for a credit is refused, in words', (refusal(sp, { contract: { ...call500, short: 499 }, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('A spread here is bought for a debit'));
sp = place(sp, { contract: spread, side: 'buy', qty: 2, kind: 'market' }, 0);
ok('it fills at its ask, as one position, with the fee on both legs', sp.fills.length === 1 && sp.fills[0].price === 0.6 && sp.fills[0].fee === 2.6 && bookOf(sp).positions.length === 1 && bookOf(sp).positions[0].key !== contractKey(call500) && contractWords(spread) === 'SPY 500/502C');
sp = advance(sp, { day: D3, minute: LAST_MIN }, 0);
const spt = bookOf(sp).trades[0];
/* D3 closes at 497.11: both legs out of the money, the spread settles at nothing: −(0.60 × 200 + 2.60) */
ok('held to the bell it settles at what it is worth in the money', spt?.how === 'expired' && spt.avgOut === 0 && spt.pnl === -122.6, `${spt?.avgOut} · ${spt?.pnl}`);

/* ---- 16:00 has rung: the market is shut ---- */
const y = advance(newSession({ id: 'y', name: 'the bell', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: LAST_MIN }, 0);
ok('a market order at the bell is refused, in words', (refusal(y, { contract: call500, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('The market is shut'));
ok('a limit left at the bell is taken, and waits for the next open', refusal(y, { contract: call500, side: 'buy', qty: 1, kind: 'limit', price: 0.05 }) === null);

/* ---- two names, one clock, one account — and the reader's own rules, as hard blocks ---- */
let z = newSession({ id: 'z', name: 'two names', ticker: 'SPY', tickers: ['SPY', 'QQQ', 'IWM'], rules: { maxOpen: 2, maxRiskPct: 0.05, dailyLossPct: 0.02 }, startCash: 25000, startDay: D1, now: 0 });
ok('a session holds two names at most', namesOf(z).join('+') === 'SPY+QQQ');
z = advance(z, { day: D1, minute: 15 }, 0);
const q400 = { ticker: 'QQQ', strike: 400, right: 'C' as const, expiry: NEAR };
const q401 = { ...q400, strike: 401 };
ok('a contract of a name the session does not trade is refused', refusal(z, { contract: { ...call500, ticker: 'IWM' }, side: 'buy', qty: 1, kind: 'market' }) === 'This session trades SPY and QQQ');
z = place(z, { contract: call500, side: 'buy', qty: 1, kind: 'market' }, 0);
z = place(z, { contract: q400, side: 'buy', qty: 1, kind: 'market' }, 0);
/* minute 15: SPY 500.30 → ask 2.85; QQQ 400.15 → ask 2.70: 25,000 − 285 − 270 − 1.30 */
ok('both names trade on the one cash, at the one minute', bookOf(z).positions.length === 2 && cashOf(z) === 24443.7, String(cashOf(z)));
ok('a third position is refused by the reader’s own rule, in words', refusal(z, { contract: q401, side: 'buy', qty: 1, kind: 'market' }) === 'Your session’s rule: no more than 2 positions open at once');
ok('adding to a contract already held is not a new position', !(refusal(z, { contract: call500, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('open at once'));
ok('a rule never stops a way out', refusal(z, { contract: q400, side: 'sell', qty: 1, kind: 'market' }) === null);
/* worth 24,443.70 + 280 + 265 = 24,988.70; 5% is 1,249.44; six more 2.85 calls with the one held are 1,999.55 */
ok('a trade that would cost more than the reader’s share of the account is refused', refusal(z, { contract: call500, side: 'buy', qty: 6, kind: 'market' }) === 'Your session’s rule: no more than 5% of the account on one trade — this would be $1,999.55 of $1,249.44');
z = place(z, { contract: q400, side: 'sell', qty: 1, kind: 'market' }, 0);
z = place(z, { contract: q401, side: 'buy', qty: 1, kind: 'limit', price: 0.05 }, 0);
ok('a resting buy counts as the position it would open', refusal(z, { contract: q400, side: 'buy', qty: 1, kind: 'market' }) === 'Your session’s rule: no more than 2 positions open at once');
let dz = advance(newSession({ id: 'dz', name: 'the day’s stop', ticker: 'SPY', rules: { dailyLossPct: 0.0001 }, startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 15 }, 0);
dz = place(dz, { contract: call500, side: 'buy', qty: 5, kind: 'market' }, 0);
/* five at 2.85 marked at 2.80: −25 and 3.25 of fees = −0.113% */
ok('down past the day’s stop (the spread and the fee alone do it here): the day is over', dayStateOf(dz).stopped && near(dayStateOf(dz).pct, -28.25 / 25000, 1e-9), `${(dayStateOf(dz).pct * 100).toFixed(3)}%`);
ok('…no new position, in words — and still a way out', (refusal(dz, { contract: { ...call500, strike: 501 }, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('Your session’s rule: down') && refusal(dz, { contract: call500, side: 'sell', qty: 5, kind: 'market' }) === null);
dz = place(dz, { contract: call500, side: 'sell', qty: 5, kind: 'market' }, 0);
dz = advance(dz, { day: D2, minute: 5 }, 0);
ok('the stop lifts at the next open: the day is measured from what the account was worth then', !dayStateOf(dz).stopped && equityAtOpen(dz) === cashOf(dz));
ok('a report of two names cuts by name', cutsOf(bookOf(z).trades.concat(bookOf(dz).trades)).some(c => c.title === 'By name' && c.rows.length === 2));

/* ---- the lowest a trade marked, kept when it closes, and the drawdown that counts it ---- */
/* the 498 call bought at D1 minute 300 (SPY 500.00: ask 4.55, paid 455.65 with the fee); its bid is lowest at D2's open
   (SPY 499.00: 3.45 → −110.65); sold at D3's open (SPY 501.00: bid 5.45) for +88.70 */
const c498 = { ticker: 'SPY', strike: 498, right: 'C' as const, expiry: FAR };
let lo = place(advance(newSession({ id: 'lo', name: 'low', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 300 }, 0), { contract: c498, side: 'buy', qty: 1, kind: 'market' }, 0);
lo = advance(lo, { day: D3, minute: 0 }, 0);
lo = place(lo, { contract: c498, side: 'sell', qty: 1, kind: 'market' }, 0);
const lt0 = bookOf(lo).trades[0];
ok('the trade made what its fills say', lt0.pnl === 88.7 && lt0.avgIn === 4.55 && lt0.avgOut === 5.45, String(lt0.pnl));
ok('the lowest it marked at the bid, fees in, is kept on the closing fill', lt0.lowOpen === -110.65 && lo.fills[1].lowOpen === -110.65, String(lt0.lowOpen));
ok('held minutes count the sessions between, not the calendar', lt0.heldMin === 2 * 390 - 300, String(lt0.heldMin));
ok('the drawdown counts the open dip of a winner', statsOf([lt0]).maxDrawdown === 110.65, String(statsOf([lt0]).maxDrawdown));

/* ==== A LADDER OF WAYS OUT (docs/review-backtest-rules.md) ==== */
ok('contracts are shared out with the nearer level taking the odd one', splitQty(5, 2).join() === '3,2' && splitQty(4, 3).join() === '2,1,1' && splitQty(1, 3).join() === '1' && splitQty(6, 3).join() === '2,2,2');
{
  /* D1 minute 10: the 500 call's ask is 2.75. T1 = 2.83 is first bid at minute 19 (SPY 500.38 → bid 2.83); the bid is
     2.86 (4% over) first at minute 21 (500.42 → 2.87) */
  const c = { ticker: 'SPY', strike: 500, right: 'C' as const, expiry: FAR };
  const T1 = 2.83;
  const T2 = 8.25;
  const S = 1.65;
  const hit1 = 19;
  const hit = 21;
  ok('the stage: the bid first reaches T1 at minute 19, and 4% over the ask at 21', bidOf(spot('SPY', D1, 19), 500, 'C') === 2.83 && bidOf(spot('SPY', D1, 18), 500, 'C') < 2.83 && bidOf(spot('SPY', D1, 21), 500, 'C') >= 2.86 && bidOf(spot('SPY', D1, 20), 500, 'C') < 2.86 && askOf(spot('SPY', D1, 10), 500, 'C') === 2.75);
  let L = advance(newSession({ id: 'L', name: 'ladder', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  ok('four targets are one too many, in words', refusal(L, { contract: c, side: 'buy', qty: 4, kind: 'market', bracket: { targets: [3, 3.1, 3.2, 3.3].map(price => ({ price, qty: 1 })) } }) === 'No more than three targets');
  ok('the targets cannot speak for more contracts than the order buys', refusal(L, { contract: c, side: 'buy', qty: 2, kind: 'market', bracket: { targets: [{ price: T1, qty: 2 }, { price: T2, qty: 1 }] } }) === 'The targets speak for more contracts than the order has');
  ok('every target has to be above what is paid', refusal(L, { contract: c, side: 'buy', qty: 2, kind: 'market', bracket: { targets: [{ price: T1, qty: 1 }, { price: S, qty: 1 }] } }) === 'Every target has to be above what you pay');
  ok('breakeven needs a target and a stop', refusal(L, { contract: c, side: 'buy', qty: 2, kind: 'market', bracket: { stop: S, breakeven: true } }) === 'Breakeven moves the stop when the first target fills — it needs both');
  L = place(L, { contract: c, side: 'buy', qty: 4, kind: 'market', bracket: { targets: [{ price: T1, qty: 2 }, { price: T2, qty: 2 }], stops: [{ price: S, qty: 4 }], breakeven: true } }, 0);
  const rungs = () => L.orders.filter(o => o.status === 'working' && o.side === 'sell');
  ok('two targets and a stop ride the buy, as ONE group', rungs().length === 3 && new Set(rungs().map(o => o.oco)).size === 1 && rungs().filter(o => o.kind === 'limit').map(o => o.qty).join() === '2,2' && rungs().find(o => o.kind === 'stop')!.qty === 4);
  ok('a sell that WAITS finds every contract spoken for — once, not twice', refusal(L, { contract: c, side: 'sell', qty: 1, kind: 'limit', price: T2 }) === 'All 4 are working in your bracket; none can be sold here');
  ok('a market sell by hand is never spoken for', refusal(L, { contract: c, side: 'sell', qty: 1, kind: 'market' }) === null && refusal(L, { contract: c, side: 'sell', qty: 5, kind: 'market' }) === 'You hold 4');
  const paid = bookOf(L).positions[0].avg;
  L = advance(L, { day: D1, minute: hit }, 0);
  const stop = rungs().find(o => o.kind === 'stop')!;
  ok('the first target fills: two are sold, and the stop gives up those two', bookOf(L).positions[0]?.qty === 2 && stop.qty === 2 && rungs().filter(o => o.kind === 'limit').length === 1);
  ok('BREAKEVEN: the stop moved to what was paid, once, and says when', stop.price === paid && stop.moved?.minute === hit1 && !stop.breakeven, `${S} → ${stop.price} at minute ${stop.moved?.minute}`);
  ok('RP&L: the two sold are banked on the clock’s day, the two left are open — and the two add up to the account', bankedOf(L, 'SPY') > 0 && bankedOf(L, 'SPY', D1) === 0 && near(bankedOf(L, 'SPY') + accountOf(L).openPnl, accountOf(L).equity - 50000, 0.02), `banked ${bankedOf(L, 'SPY')}`);
  L = place(L, { contract: c, side: 'sell', qty: 1, kind: 'market' }, 0);
  ok('one sold by hand: the ladder gives way — the far target and the stop give up one each', rungs().every(o => o.qty === 1) && rungs().length === 2);
  L = place(L, { contract: c, side: 'sell', qty: 1, kind: 'market' }, 0);
  const lt = bookOf(L).trades[0];
  ok('flat: everything that was working on it goes', rungs().length === 0 && L.orders.filter(o => o.why === 'the position was closed').length === 2);
  ok('it ended SCALED OUT, and the record keeps each piece', lt?.how === 'scaled' && lt.legs.filter(l => l.side === 'sell').map(l => `${l.qty}${l.out}`).join() === '2target,1hand,1hand');
  ok('the pieces add up to what the trade made', near(lt.legs.reduce((a, l) => a + (l.side === 'sell' ? 1 : -1) * l.price * MULT * l.qty - l.fee, 0), lt.pnl, 0.02), lt.pnl.toFixed(2));
  ok('closed, RP&L is the whole trade', near(bankedOf(L, 'SPY'), lt.pnl, 0.011));

  /* two stops: a target's fill takes its contracts from the FURTHEST stop first */
  let W = advance(newSession({ id: 'W', name: 'two stops', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  W = place(W, { contract: c, side: 'buy', qty: 4, kind: 'market', bracket: { targets: [{ price: T1, qty: 2 }], stops: [{ price: 1.93, qty: 2 }, { price: S, qty: 2 }] } }, 0);
  W = advance(W, { day: D1, minute: hit }, 0);
  const left = W.orders.filter(o => o.status === 'working' && o.kind === 'stop');
  ok('…the far stop is the one that goes; the near one keeps its two', left.length === 1 && left[0].price === 1.93 && left[0].qty === 2 && W.orders.some(o => o.price === S && o.why === 'its pair filled'));

  /* a TRAILING stop: checked first, then moved; never back. Bought at minute 10 (bid 2.65), stop 2.48 trails by 0.17:
     it follows the bid up to minute 100 (4.45 → 4.28), and is hit as the bid falls back to 4.28 at minute 117 (SPY 501.83) */
  let R = advance(newSession({ id: 'R', name: 'trail', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  R = place(R, { contract: c, side: 'buy', qty: 2, kind: 'market', bracket: { stop: 2.48, trail: true } }, 0);
  const armed = R.orders.find(o => o.kind === 'stop')!;
  ok('armed to trail: it keeps the distance it was set at from the bid', near(armed.trail ?? 0, 0.17) && armed.peak === 2.65);
  R = advance(R, { day: D1, minute: 100 }, 0);
  ok('it followed the best bid up at its distance', R.orders.find(x => x.id === armed.id)!.price === 4.28, String(R.orders.find(x => x.id === armed.id)!.price));
  R = advance(R, { day: D1, minute: LAST_MIN }, 0);
  const rf = R.fills[R.fills.length - 1];
  ok('and sold the first minute the bid came back to it, at that bid — it never moved back', rf.how === 'stop' && rf.at.minute === 117 && rf.price === 4.28, `minute ${rf.at.minute} at ${rf.price}`);
  let sw = attach(advance(place(advance(newSession({ id: 'sw', name: 'switch', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0), { contract: c, side: 'buy', qty: 1, kind: 'market' }, 0), { day: D1, minute: 11 }, 0), c, 'stop', S, 0);
  const swId = sw.orders.find(o => o.kind === 'stop')!.id;
  sw = setTrail(sw, swId, true, 0);
  ok('the switch on a working stop: trailing on, then off', sw.orders.find(o => o.id === swId)!.trail! > 0 && setTrail(sw, swId, false, 0).orders.find(o => o.id === swId)!.trail === undefined);
  ok('breakeven is the ladder’s: armed on every stop of the group', setBreakeven(sw, swId, true, 0).orders.filter(o => o.kind === 'stop' && o.status === 'working').every(o => o.breakeven));

  /* typed counts: a target for two of four, the rest run */
  let Q = advance(newSession({ id: 'Q', name: 'counts', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  ok('a count of nothing is refused in words', refusal(Q, { contract: c, side: 'buy', qty: 4, kind: 'market', bracket: { targets: [{ price: T1, qty: 0 }] } }) === 'Every target needs a whole number of contracts');
  Q = place(Q, { contract: c, side: 'buy', qty: 4, kind: 'market', bracket: { targets: [{ price: T1, qty: 2 }], stops: [{ price: S, qty: 4 }] } }, 0);
  Q = advance(Q, { day: D1, minute: hit }, 0);
  ok('it fills two; two run on, and the stop now speaks for those two', bookOf(Q).positions[0]?.qty === 2 && Q.orders.find(o => o.status === 'working' && o.kind === 'stop')!.qty === 2 && Q.orders.filter(o => o.status === 'working' && o.kind === 'limit').length === 0);

  /* a typed trailing distance: the stop stays at 1.65 until the bid has run 0.30 past it… at minute 12 the bid is 2.69 */
  let Y = advance(newSession({ id: 'Y', name: 'trail by', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  ok('a trailing distance of nothing is refused', refusal(Y, { contract: c, side: 'buy', qty: 1, kind: 'market', bracket: { stop: S, trail: true, trailBy: 0 } }) === 'Trail by a distance above nothing');
  Y = place(Y, { contract: c, side: 'buy', qty: 2, kind: 'market', bracket: { stop: S, trail: true, trailBy: 0.3 } }, 0);
  const ty = Y.orders.find(o => o.kind === 'stop')!;
  ok('the stop trails by the distance TYPED, not the distance it stands at', near(ty.trail ?? 0, 0.3) && ty.price === S && ty.peak === 2.65);
  Y = advance(Y, { day: D1, minute: 12 }, 0);
  ok('…and is drawn in to that distance on the next minutes (2.69 − 0.30)', Y.orders.find(o => o.id === ty.id)!.price === 2.39, String(Y.orders.find(o => o.id === ty.id)!.price));
  const dragged = amend(Y, ty.id, 2.5, 0).orders.find(o => o.id === ty.id)!;
  ok('a trailing stop DRAGGED keeps its new distance (2.69 − 2.50)', near(dragged.trail ?? 0, 0.19), `${dragged.trail}`);
  ok('the switch takes a typed distance too', near(setTrail(Y, ty.id, true, 0, 0.5).orders.find(o => o.id === ty.id)!.trail ?? 0, 0.5));
}
{
  /* on the chart: a further pull adds a level (minute 20: bid 2.85) */
  let A = place(advance(newSession({ id: 'A', name: 'pulls', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 20 }, 0), { contract: call500, side: 'buy', qty: 4, kind: 'market' }, 0);
  const sizes = (kind: 'limit' | 'stop') => A.orders.filter(o => o.status === 'working' && o.kind === kind).sort((x, y) => x.price! - y.price!).map(o => o.qty).join();
  ok('nothing on it yet: a pull of either kind would be the first', ladderRoom(A, call500).target === 'first' && ladderRoom(A, call500).stop === 'first');
  A = attach(A, call500, 'target', 3.7, 0);
  ok('the first target speaks for all four', sizes('limit') === '4' && ladderRoom(A, call500).target === 'more');
  A = attach(A, call500, 'target', 4.3, 0);
  ok('a second pull ADDS a target: half of the first one’s contracts', sizes('limit') === '2,2');
  A = attach(A, call500, 'target', 4.8, 0);
  ok('a third takes half of the biggest — the furthest, where they tie', sizes('limit') === '2,1,1' && ladderRoom(A, call500).target === null);
  ok('a fourth is not taken: three targets is the ladder', attach(A, call500, 'target', 5.4, 0) === A);
  A = attach(A, call500, 'stop', 2.0, 0);
  A = attach(A, call500, 'stop', 1.4, 0);
  ok('two stops, half each — and a third is not taken', sizes('stop') === '2,2' && attach(A, call500, 'stop', 1.1, 0) === A && new Set(A.orders.filter(o => o.status === 'working').map(o => o.oco)).size === 1);
  A = cancel(A, A.orders.find(o => o.status === 'working' && o.kind === 'limit' && o.price === 4.3)!.id, 0);
  A = attach(A, call500, 'target', 4.0, 0);
  ok('a level taken off leaves its contracts uncovered; the next pull takes THOSE', sizes('limit') === '2,1,1' && A.orders.some(o => o.status === 'working' && o.price === 4.0));
  const one = attach(place(advance(newSession({ id: 'one', name: 'one', ticker: 'SPY', startCash: 50000, startDay: D1, now: 0 }), { day: D1, minute: 20 }, 0), { contract: call500, side: 'buy', qty: 1, kind: 'market' }, 0), call500, 'target', 3.7, 0);
  ok('one contract: there is nothing to split', ladderRoom(one, call500).target === null && attach(one, call500, 'target', 4.3, 0) === one);
}

/* ---- a minute with no quote is no market ---- */
{
  const dark = { ticker: 'SPY', strike: 777, right: 'C' as const, expiry: FAR };
  const g = advance(newSession({ id: 'g', name: 'gap', ticker: 'SPY', startCash: 5000, startDay: D1, now: 0 }), { day: D1, minute: 40 }, 0);
  ok('a contract with no recorded quote cannot be bought at the market', quoteAt(dark, D1, 40).dead && refusal(g, { contract: dark, side: 'buy', qty: 1, kind: 'market' }) === 'No market in that contract right now');
  ok('the name’s price is the recorded bar’s close', spotAt('SPY', D2, 100) === 499.5);
}

/* ==== the bell, by product — and a close that is not known (added with the backtest golden) ==== */
{
  /* SPXW is written on SPX: its price is the index's; at the bell it settles in CASH on the closing print */
  const day = D3;
  const spx = Array.from({ length: 390 }, (_, m) => ({ time: barTime(day, m), open: 6000, high: 6000, low: 6000, close: 6000 + m * 0.1, volume: 0 }));
  putBars('SPX', day, spx, 6040.25);
  const xk = { ticker: 'SPXW', strike: 6030, right: 'C' as const, expiry: day };
  putQuotes(xk, day, new Array(390).fill(4.9), new Array(390).fill(5.1));
  ok('SPXW reads SPX’s price', spotAt('SPXW', day, 100) === 6010);
  let ix = newSession({ id: 'ix', name: 'index', ticker: 'SPXW', startCash: 25000, startDay: day, now: 0 });
  ix = place(advance(ix, { day, minute: 300 }, 0), { contract: xk, side: 'buy', qty: 1, kind: 'market' }, 0);
  ix = advance(ix, { day, minute: LAST_MIN }, 0);
  const it = bookOf(ix).trades[0];
  /* 6,040.25 − 6,030 = 10.25 on the print — not the 15:59 bar's 6,038.90 */
  ok('a cash-index contract settles in cash on the closing print, with no fee', it?.how === 'expired' && it.settle === 'cash' && ix.fills[1].price === 10.25 && ix.fills[1].fee === 0 && it.pnl === 1025 - 510 - 0.65, `${ix.fills[1]?.price} · ${it?.pnl}`);
  ok('…and the bell kept the account', ix.closes?.[day]?.equity === cashOf(ix) && ix.closes?.[day]?.held === 0);
  /* a contract whose expiry day has no bars is not settled at a guess: it waits, and says so */
  const ghost = { ticker: 'QQQ', strike: 400, right: 'C' as const, expiry: '2026-10-29' };
  putQuotes(ghost, D3, new Array(390).fill(1), new Array(390).fill(1.1));
  let gh = place(advance(newSession({ id: 'gh', name: 'ghost', ticker: 'QQQ', startCash: 25000, startDay: D3, now: 0 }), { day: D3, minute: 10 }, 0), { contract: ghost, side: 'buy', qty: 1, kind: 'market' }, 0);
  gh = advance(gh, { day: '2026-10-29', minute: LAST_MIN }, 0);
  ok('an expiry whose close is not known is not settled — it is held, pending', bookOf(gh).positions.length === 1 && pendingSettlement(gh).length === 1 && !gh.fills.some(f => f.how === 'expired'));
  /* SPY on the fixture: exercised (a stock or a fund), on the last bar's close where no print was recorded */
  const ex = place(advance(newSession({ id: 'ex', name: 'exercise', ticker: 'SPY', startCash: 25000, startDay: D3, now: 0 }), { day: D3, minute: 0 }, 0), { contract: { ticker: 'SPY', strike: 495, right: 'C', expiry: NEAR }, side: 'buy', qty: 1, kind: 'market' }, 0);
  const exd = advance(ex, { day: D3, minute: LAST_MIN }, 0);
  /* D3 closes at 497.11: the 495 call is worth 2.11 */
  ok('a fund’s contract is exercised at the close: worth what it is in the money', exd.fills[1]?.price === 2.11 && bookOf(exd).trades[0]?.settle === 'exercise', String(exd.fills[1]?.price));

  /* a buy stop and a marketable limit on the fixture: D1 minute 10, SPY 500.20, the 500 call 2.65 / 2.75 */
  let bs = advance(newSession({ id: 'bs', name: 'buy stop', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  bs = place(bs, { contract: call500, side: 'buy', qty: 1, kind: 'stop', price: 3.0 }, 0);
  bs = advance(bs, { day: D1, minute: 60 }, 0);
  /* minute 22: SPY 500.44, ask 2.99; minute 23: SPY 500.46, ask 3.01 — the first at or over 3.00, and a gap past it */
  ok('a buy stop buys the first minute the ask is at or over it, at that ask', bs.fills[0]?.at.minute === 23 && bs.fills[0]?.price === 3.01, `${bs.fills[0]?.at.minute} @ ${bs.fills[0]?.price}`);
  const ml = place(advance(newSession({ id: 'ml', name: 'marketable', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0), { contract: call500, side: 'buy', qty: 1, kind: 'limit', price: 3.5 }, 0);
  ok('a limit over the ask fills at once, at the ask', ml.fills[0]?.at.minute === 10 && ml.fills[0]?.price === 2.75);
  const ms = place(ml, { contract: call500, side: 'sell', qty: 1, kind: 'limit', price: 2.0 }, 0);
  ok('…and a sell limit under the bid at the bid', ms.fills[1]?.price === 2.65 && bookOf(ms).trades[0]?.how === 'sold');
}

/* ==== THE ROLL-OVER: playing past the bell into the next day (engine playStep + nextOpen) ==== */
{
  const cF = { ticker: 'SPY', strike: 500, right: 'C' as const, expiry: FAR };
  let r = advance(newSession({ id: 'ro', name: 'roll', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 30 }, 0);
  r = place(r, { contract: cF, side: 'buy', qty: 2, kind: 'market' }, 0);
  /* a GTC target nowhere near, a DAY buy far under the ask, and a GTC buy far under it too */
  r = place(r, { contract: cF, side: 'sell', qty: 2, kind: 'limit', price: 9, tif: 'gtc' }, 0);
  r = place(r, { contract: { ...cF, strike: 501 }, side: 'buy', qty: 1, kind: 'limit', price: 0.05, tif: 'day' }, 0);
  r = place(r, { contract: { ...cF, strike: 499 }, side: 'buy', qty: 1, kind: 'limit', price: 0.05, tif: 'gtc' }, 0);
  /* the clock playing, an hour a tick, as the desk's interval does: roll off, it stops on the bell */
  const play = (s0: Session, roll: boolean, ticks: number) => {
    let s1 = s0;
    const path: string[] = [];
    for (let i = 0; i < ticks; i++) {
      const to = playStep(s1.cursor, 60, roll, s1.cursor.day === D1 ? D2 : s1.cursor.day === D2 ? D3 : null);
      if (!to) break;
      s1 = advance(s1, to, 0);
      path.push(`${to.day.slice(5)}@${to.minute}`);
    }
    return { s: s1, path };
  };
  const off = play(r, false, 20);
  ok('roll-over off: the playing clock stops on the bell', off.s.cursor.day === D1 && off.s.cursor.minute === LAST_MIN && off.path[off.path.length - 1] === `${D1.slice(5)}@${LAST_MIN}`, off.path.join(' '));
  ok('…and the play button is not offered past it', playStep(off.s.cursor, 60, false, D2) === null && playStep(off.s.cursor, 60, true, null) === null);
  const on = play(r, true, 7);
  ok('roll-over on: the clock stands on the bell first, then opens the next day and keeps playing', on.path.join(' ') === `${D1.slice(5)}@90 ${D1.slice(5)}@150 ${D1.slice(5)}@210 ${D1.slice(5)}@270 ${D1.slice(5)}@330 ${D1.slice(5)}@${LAST_MIN} ${D2.slice(5)}@0`, on.path.join(' '));
  const rs = on.s;
  ok('…the positions carry', bookOf(rs).positions.length === 1 && bookOf(rs).positions[0].qty === 2 && rs.cursor.day === D2);
  const w = (strike: number) => rs.orders.find(o => o.contract.strike === strike && o.side === 'buy');
  ok('…GTC orders carry, still working', rs.orders.find(o => o.side === 'sell')?.status === 'working' && w(499)?.status === 'working');
  ok('…day orders expire at the bell, as now', w(501)?.status === 'cancelled' && w(501)?.why === 'the day ended' && w(501)?.done?.day === D1 && w(501)?.done?.minute === LAST_MIN);
  ok('…the bell kept the account', rs.closes?.[D1]?.held === 1 && Number.isFinite(rs.closes?.[D1]?.equity ?? NaN));
  ok('…exactly what “Open the next day” does from the bell', JSON.stringify({ ...rs, touchedAt: 0 }) === JSON.stringify({ ...nextOpen(off.s, 0), touchedAt: 0 }));
  ok('the open walked into with a book carried is kept — the day stop’s base', rs.opens?.[D2] === equityAtOpen(rs) && Number.isFinite(rs.opens?.[D2] ?? NaN), String(rs.opens?.[D2]));
  ok('…and played on, the next day runs like any other (a third day opens on the next bell)', play(rs, true, 9).s.cursor.day === D3);
}

/* ==== THE DAY STOP, SAID PLAINLY ==== */
{
  const ds = newSession({ id: 'ds', name: 'stop', ticker: 'SPY', rules: { dailyLossPct: 0.03 }, startCash: 25000, startDay: D1, now: 0 });
  ok('the day stop is measured from the account at the open, and said in dollars', dayStopOf(ds)?.words === 'Day stop: −3% of the account at 09:30 = −$750' && dayStopOf(ds)?.loss === 750);
  ok('…none without the rule', dayStopOf(newSession({ id: 'ds2', name: 'x', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 })) === null);
  /* a book carried into D2: the open there is the account marked at D2's first minute, not the start */
  let dc = place(advance(ds, { day: D1, minute: 30 }, 0), { contract: { ticker: 'SPY', strike: 500, right: 'C', expiry: FAR }, side: 'buy', qty: 2, kind: 'market' }, 0);
  dc = advance(dc, { day: D2, minute: 10 }, 0);
  const open2 = equityAtOpen(dc);
  ok('…on a later day, from that day’s open', near(dayStopOf(dc)!.loss, open2 * 0.03, 0.006) && dayStopOf(dc, D1)?.loss === 750, `${dayStopOf(dc)?.words}`);
}

/* ==== SELL @ LMT AND THE BRACKET: what is spoken for, said ==== */
{
  const cF = { ticker: 'SPY', strike: 500, right: 'C' as const, expiry: FAR };
  let b5 = advance(newSession({ id: 'b5', name: 'five', ticker: 'SPY', startCash: 25000, startDay: D1, now: 0 }), { day: D1, minute: 10 }, 0);
  b5 = place(b5, { contract: cF, side: 'buy', qty: 5, kind: 'market', bracket: { targets: [{ price: 9, qty: 3 }], stops: [{ price: 1, qty: 3 }] } }, 0);
  ok('3 of 5 in the bracket: 2 are free', JSON.stringify(spokenFor(b5, cF)) === JSON.stringify({ held: 5, bracket: 3, other: 0, free: 2 }));
  ok('a sell limit for 3 is refused in those words', refusal(b5, { contract: cF, side: 'sell', qty: 3, kind: 'limit', price: 8 }) === '3 of 5 are working in your bracket; 2 can be sold here');
  ok('…for 2 it is taken', refusal(b5, { contract: cF, side: 'sell', qty: 2, kind: 'limit', price: 8 }) === null);
  const freed = b5.orders.filter(o => o.status === 'working' && o.oco).reduce((s1, o) => cancel(s1, o.id, 0), b5);
  ok('the bracket cancelled, all 5 can be sold at a limit', spokenFor(freed, cF).free === 5 && refusal(freed, { contract: cF, side: 'sell', qty: 5, kind: 'limit', price: 8 }) === null);
  const loose = place(freed, { contract: cF, side: 'sell', qty: 4, kind: 'limit', price: 8 }, 0);
  ok('a loose sell is said as another sell', refusal(loose, { contract: cF, side: 'sell', qty: 2, kind: 'limit', price: 8.5 }) === '4 of 5 are working in another sell; 1 can be sold here');
}

/* ==== THE REPORT AS FILES: columns and sums match the report ==== */
{
  const all = [...trades, bt, ...bookOf(lo).trades].sort((a, b2) => stampOf(a.closed) - stampOf(b2.closed));
  const cells = csvCells(reportTradesCsv(all));
  const head = cells[0];
  const col = (name: string) => head.indexOf(name);
  ok('the trades file has the columns it says, in order', head.join() === TRADE_COLUMNS.join() && cells.length === all.length + 1, head.join());
  const st = statsOf(all);
  const sumOf = (rows: string[][], name: string) => rows.reduce((a, r2) => a + Number(r2[col(name)]), 0);
  ok('…its pnl adds up to the report’s Made or lost', near(sumOf(cells.slice(1), 'pnl'), st.net, 0.001), `${sumOf(cells.slice(1), 'pnl').toFixed(2)} vs ${st.net}`);
  ok('…its fees are every fill’s', near(sumOf(cells.slice(1), 'fees'), all.reduce((a, t2) => a + tradeFees(t2), 0), 0.001));
  ok('…line by line, each trade’s own pnl, entry, exit and size', all.every((t2, i) => Number(cells[i + 1][col('pnl')]) === t2.pnl && Number(cells[i + 1][col('entry')]) === t2.avgIn && Number(cells[i + 1][col('exit')]) === t2.avgOut && Number(cells[i + 1][col('qty')]) === t2.qty));
  ok('…and every fill of it, in order', all.every((t2, i) => cells[i + 1][col('fills')].split('; ').length === t2.legs.length), cells[1][col('fills')]);
  ok('…times are ET on the desk’s clock, and a settled trade says how', cells.slice(1).every(r2 => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r2[col('closed_et')])) && cells.slice(1).every((r2, i) => (all[i].how === 'expired') === (r2[col('settle')] !== '')));
  /* By day on a session that rang bells: dz (two days) */
  const dzTrades = [...accountOf(dz).trades].sort((a, b2) => stampOf(a.closed) - stampOf(b2.closed));
  const rows = dayRowsOf(dz, dzTrades);
  const dcells = csvCells(reportDaysCsv(rows, true));
  ok('the days file has the By day columns, with the day stop', dcells[0].join() === 'date,closed,pnl,account_move,equity_at_bell,held_overnight,day_stop' && dcells.length === rows.length + 1);
  ok('…its pnl adds up to the closed trades', near(dcells.slice(1).reduce((a, r2) => a + Number(r2[2]), 0), statsOf(dzTrades).net, 0.001));
  ok('…the account at each bell is the engine’s', rows.every((d, i) => d.equity == null ? dcells[i + 1][4] === '' : Number(dcells[i + 1][4]) === dz.closes?.[d.day]?.equity));
  ok('…the day stop is the account at that open times the rule', rows.every((d, i) => d.stop != null && Number(dcells[i + 1][6]) === -d.stop));
}

const sum = statsOf([...trades, bt]);
ok('the report adds up', sum.n === 2 && near(sum.net, trades[0].pnl + bt.pnl, 0.001), `net ${sum.net.toFixed(2)} · drawdown ${sum.maxDrawdown.toFixed(2)}`);

console.log(misses ? `\n${misses} MISSED` : '\nall rules hold');
process.exit(misses ? 1 : 0);
