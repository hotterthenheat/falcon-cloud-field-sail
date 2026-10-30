/*
  BACKTEST · the engine on recorded ThetaData answers — `npx tsx scripts/golden/backtest-golden.ts`

  Part A replays the recorded set `practice-2026-10-29` (SPY on Wed 2026-10-28: the 1-minute bars, the contracts quoted
  that day, and the NBBO of the Oct 30 771 call and put every minute) through the app's own loaders
  (data/review/history.ts) and plays scripted sessions on it with the engine (data/review/engine.ts). Every expected
  number below was checked by hand against the raw rows (scripts/fixtures/golden/practice-2026-10-29, read with zcat):
  the row a fill must equal, the first row a resting order can fill on, the dollars. Rows quoted in the comments are
  "HH:MM bid ask" of the 771 call (C) or put (P); a quote row stamped HH:MM is the NBBO at the END of the minute before.

  Part B replays `backtest-2026-10-28` (recorded 2026-10-29): a SPY contract that expires that day held to the bell, and an
  SPXW one settled in cash on SPX's close.

  Part C replays `backtest-2026-10-29` (recorded 2026-10-29, after the close): SPY's bars and the Oct 30 771 call and put
  on Thu Oct 29, and the Oct 28 listing asked with no max_dte (every expiry quoted). It checks the roll-over (the clock
  playing past the bell into the next day: positions and GTC orders carry, day orders expire), the report's CSV files
  against the report, the day stop said in dollars, and the later expiries — a NEW request beside the 120-day one, which
  stays byte for byte as recorded. A set not recorded prints what to record and passes. Record (terminal running, dev
  server on :8080): GOLDEN_RECORD=1 npx tsx scripts/golden/backtest-golden.ts
*/
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'practice-2026-10-29';
const SET_B = 'backtest-2026-10-28';
const SET_C = 'backtest-2026-10-29';
const DAY2 = '2026-10-29';
const DAY = '2026-10-28';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');
const RECORD = process.env.GOLDEN_RECORD === '1';

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.addEventListener ??= () => {};
g.location = { search: '', pathname: '/practice/backtest', href: 'http://127.0.0.1/practice/backtest', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

const fxA = installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));

const H = await import('../../src/data/review/history');
const E = await import('../../src/data/review/engine');
const Q = await import('../../src/data/review/quotes');
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();

await H.ensureBars('SPY', DAY);
await H.ensureListing('SPY', DAY);
const call = { ticker: 'SPY', strike: 771, right: 'C' as const, expiry: '2026-10-30' };
const put = { ...call, right: 'P' as const };
await H.ensureLeg(call, DAY);
await H.ensureLeg(put, DAY);

const fresh = (id: string, rules?: Parameters<typeof E.newSession>[0]['rules']) => E.newSession({ id, name: id, ticker: 'SPY', rules, startCash: 25000, startDay: DAY, now: 0 });
const at = (s: ReturnType<typeof fresh>, minute: number) => E.advance(s, { day: DAY, minute }, 0);
const BELL = H.LAST_MIN;

/* ==== A1 · a market buy fills at the minute's ask, with the fee ==== */
/* C 10:00 4.08 4.10 → minute 29 */
let a = E.place(at(fresh('a1'), 29), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
expectNear('A1 market buy 2 at 10:00 fills at the 10:00 row’s ask', a.fills[0].price, 4.1);
expectNear('A1 …the fee is 0.65 a contract', a.fills[0].fee, 1.3);
/* 25,000 − 4.10 × 100 × 2 − 1.30 */
expectNear('A1 cash 25,000 − 820 − 1.30', E.cashOf(a), 24178.7);
/* marked at the mid 4.09: 818 − 821.30 */
expectNear('A1 open P&L at the mid, behind by half the spread and the fee', E.accountOf(a).openPnl, -3.3);
expectNear('A1 worth now', E.accountOf(a).equity, 24996.7);

/* ==== A2 · a MARKETABLE limit fills now, at the ask — not at its price ==== */
/* C 10:01 3.90 3.91 → minute 30. A limit to buy at 4.00 is over the ask: it is the market, capped at 4.00 */
a = E.place(at(a, 30), { contract: call, side: 'buy', qty: 1, kind: 'limit', price: 4 }, 0);
expectEqual('A2 the limit at 4.00 filled at once, at minute 30', [a.fills[1]?.at.minute, a.fills[1]?.how], [30, 'limit']);
expectNear('A2 …at the ask, 3.91, never at the limit', a.fills[1].price, 3.91);
expectNear('A2 cash 24,178.70 − 391 − 0.65', E.cashOf(a), 23787.05);
const p2 = E.accountOf(a).positions[0];
/* 820 + 1.30 + 391 + 0.65 = 1,212.95 for three: the cost is kept whole — a rounded 4.04 average would say 1,213.95 */
expectNear('A2 three held cost 1,212.95, fees in', p2.cost, 1212.95);
expectNear('A2 marked at the half-cent mid 3.905: 1,171.50 − 1,212.95', p2.pnl, -41.45);
expectEqual('A2 the average paid, said to the cent', p2.avg, 4.04);

/* ==== A3 · a resting limit fills on the first row whose ask comes down to it, at that ask ==== */
/* placed at 10:01 (ask 3.91): the first later row with an ask at or under 3.80 is C 14:09 3.71 3.73 → minute 278 */
let b = E.place(at(fresh('a3'), 30), { contract: call, side: 'buy', qty: 1, kind: 'limit', price: 3.8 }, 0);
expectEqual('A3 a limit under the ask waits', b.fills.length, 0);
b = at(b, BELL);
expectEqual('A3 it fills at 14:09 — minute 278', b.fills[0]?.at.minute, 278);
expectNear('A3 …at that row’s ask, 3.73', b.fills[0]?.price ?? NaN, 3.73);

/* ==== A4 · a BUY STOP buys the first minute the ask comes up to it, at that ask ==== */
let c = at(fresh('a4'), 30);
expectEqual('A4 a buy stop at or under the ask is refused, in words', E.refusal(c, { contract: call, side: 'buy', qty: 1, kind: 'stop', price: 3.9 }), 'A buy stop waits over the ask (3.91) — at or under it, buy at the market or leave a limit');
/* the first row after 10:01 with an ask at or over 4.30: C 10:20 4.29 4.31 → minute 49 */
c = at(E.place(c, { contract: call, side: 'buy', qty: 1, kind: 'stop', price: 4.3 }, 0), BELL);
expectEqual('A4 the buy stop at 4.30 fills at 10:20 — minute 49', c.fills[0]?.at.minute, 49);
expectNear('A4 …at that row’s ask, 4.31', c.fills[0]?.price ?? NaN, 4.31);

/* ==== A5 · a sell stop gapped through fills at the bid, under its price ==== */
let d = E.place(at(fresh('a5'), 29), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
expectEqual('A5 a sell stop at or over the bid is refused (C 10:00 bid 4.08)', E.refusal(d, { contract: call, side: 'sell', qty: 2, kind: 'stop', price: 4.1 }), 'A stop waits under the bid (4.08) — at or over it, sell at the market');
/* first row after 10:00 with a bid at or under 3.70: C 14:16 3.59 3.61 → minute 285 */
d = at(E.place(d, { contract: call, side: 'sell', qty: 2, kind: 'stop', price: 3.7 }, 0), BELL);
const t5 = E.bookOf(d).trades[0];
expectEqual('A5 the stop sells at 14:16 — minute 285', [t5?.closed.minute, t5?.how], [285, 'stopped']);
expectNear('A5 …at that row’s bid, 3.59 — under the stop', t5?.avgOut ?? NaN, 3.59);
/* 2 × 359 − 1.30 − (820 + 1.30) */
expectNear('A5 the trade lost 104.60', t5?.pnl ?? NaN, -104.6);
expectNear('A5 …−0.1274R on 821.30 paid', t5?.r ?? NaN, -104.6 / 821.3, 1e-9);

/* ==== A6 · a partial close: banked and open add up to the account's move ==== */
let e = E.place(at(fresh('a6'), 29), { contract: call, side: 'buy', qty: 3, kind: 'market' }, 0);
e = E.place(at(e, 30), { contract: call, side: 'sell', qty: 1, kind: 'market' }, 0);
const acc6 = E.accountOf(e);
/* sold 1 at C 10:01's bid 3.90: 390 − 0.65 − (1,230 + 1.95) / 3 = −21.30 */
expectNear('A6 one of three sold at the bid 3.90: −21.30 banked', acc6.realized, -21.3);
/* two left, cost 821.30, at the mid 3.905: 781 − 821.30 */
expectNear('A6 the two still held are −40.30 open', acc6.openPnl, -40.3);
expectNear('A6 banked + open = the account’s move', acc6.realized + acc6.openPnl, acc6.equity - 25000, 1e-9);
expectNear('A6 fees paid: 1.95 in, 0.65 out', E.feesOf(e), 2.6);
expectEqual('A6 the trade stays open until it is flat', [acc6.trades.length, acc6.positions[0].qty], [0, 2]);

/* ==== A7 · the reader's rules, enforced ==== */
let r1 = E.place(at(fresh('a7', { maxOpen: 1 }), 29), { contract: call, side: 'buy', qty: 1, kind: 'market' }, 0);
expectEqual('A7 max open 1: a second position is refused', E.refusal(r1, { contract: put, side: 'buy', qty: 1, kind: 'market' }), 'Your session’s rule: no more than 1 position open at once');
expectEqual('A7 …adding to the one held is not a new position', E.refusal(r1, { contract: call, side: 'buy', qty: 1, kind: 'market' }), null);
r1 = E.place(r1, { contract: put, side: 'buy', qty: 1, kind: 'limit', price: 1 }, 0);
expectEqual('A7 …and a resting buy that would open one is refused too', r1.orders[r1.orders.length - 1].status, 'refused');
const r2 = E.place(at(fresh('a7b', { maxRiskPct: 0.02 }), 29), { contract: call, side: 'buy', qty: 1, kind: 'market' }, 0);
/* worth 24,589.35 + 409 = 24,998.35; 2% is 499.97; two calls are 410.65 + 410.65 */
expectEqual('A7 max 2% a trade: a second call would put 821.30 in one trade', E.refusal(r2, { contract: call, side: 'buy', qty: 1, kind: 'market' }), 'Your session’s rule: no more than 2% of the account on one trade — this would be $821.30 of $499.97');
/* the day's stop at −0.5%: ten calls at 4.10 (4,106.50), and a limit to add one at 3.90, good until cancelled */
const stopDay = (rules?: { dailyLossPct: number }) => E.place(E.place(at(fresh('a7c', rules), 29), { contract: call, side: 'buy', qty: 10, kind: 'market' }, 0), { contract: call, side: 'buy', qty: 1, kind: 'limit', price: 3.9 }, 0);
let r3 = at(stopDay({ dailyLossPct: 0.005 }), 30);
/* C 10:01 mid 3.905: 20,893.50 + 3,905 = 24,798.50, −0.806% */
expectNear('A7 at 10:01 the day is −0.806%', E.dayStateOf(r3).pct, (24798.5 - 25000) / 25000, 1e-9);
expectEqual('A7 …past the −0.5% stop: no new position, in words', E.refusal(r3, { contract: put, side: 'buy', qty: 1, kind: 'market' }), 'Your session’s rule: down 0.8% on the day (the stop is 0.5%) — no new positions until the next open');
expectEqual('A7 …a way out is never stopped', E.refusal(r3, { contract: call, side: 'sell', qty: 10, kind: 'market' }), null);
/* the add's limit is first reached at C 10:12 3.85 3.87 (minute 41), when the day is −0.986%: cancelled, not filled */
r3 = at(r3, BELL);
const add = r3.orders.find(o => o.kind === 'limit')!;
expectEqual('A7 the resting buy reached while the day is stopped is cancelled, at 10:12', [add.status, add.done?.minute, add.why], ['cancelled', 41, 'your session’s rule: the day’s stop had been reached']);
const r4 = at(stopDay(), BELL);
expectEqual('A7 …with no stop it fills there, at the ask 3.87', [r4.fills[1]?.at.minute, r4.fills[1]?.price], [41, 3.87]);

/* ==== A8 · the bell ==== */
let f = E.place(at(fresh('a8'), 29), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
f = E.place(f, { contract: call, side: 'sell', qty: 2, kind: 'limit', price: 9, tif: 'day' }, 0);
expectEqual('A8 a market order at the bell is refused', (E.refusal(at(f, BELL), { contract: put, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('The market is shut'), true);
f = at(f, BELL);
expectEqual('A8 a day order unfilled at 16:00 is cancelled', f.orders.find(o => o.kind === 'limit')?.why, 'the day ended');
/* a marketable limit at the bell does not fill now: the market is shut (C 16:00 4.43 4.59) */
const shut = E.place(f, { contract: put, side: 'buy', qty: 1, kind: 'limit', price: 9 }, 0);
expectEqual('A8 a marketable limit at the bell waits for the open', [shut.fills.length, shut.orders[shut.orders.length - 1].status], [1, 'working']);
/* the account at the bell, marked at the 16:00 row's mid (4.43 + 4.59) / 2 = 4.51: 24,178.70 + 902 */
expectEqual('A8 the bell keeps the account as it left it', f.closes?.[DAY], { equity: 25080.7, cash: 24178.7, realized: 0, open: 80.7, held: 1 });
/* a reload: the session is its JSON, and reads the same */
const back = JSON.parse(JSON.stringify(f)) as typeof f;
expectEqual('A8 a session read back from storage is the same account', E.accountOf(back).equity, E.accountOf(f).equity);

/* ==== A9 · expiry settlement on the recorded close ==== */
/* the 16:00:00 bar is the closing print, 772.33; the 15:59 bar closes 772.31 */
expectNear('A9 the close a contract settles on is the 16:00 print', H.closePrintOf('SPY', DAY), 772.33);
expectNear('A9 …not the 15:59 bar’s close', H.spotAt('SPY', DAY, BELL), 772.31);
const z = (k: number, right: 'C' | 'P', short?: number) => ({ ticker: 'SPY', strike: k, right, expiry: DAY, ...(short != null ? { short } : {}) });
expectEqual('A9 SPY Oct 28 771C settles at 1.33, exercised at the close', Q.settlementAt(z(771, 'C'), DAY), { price: 1.33, spot: 772.33, style: 'exercise', index: 'SPY' });
expectEqual('A9 SPY Oct 28 771P settles at nothing', Q.settlementAt(z(771, 'P'), DAY)?.price, 0);
expectEqual('A9 the 771/772 call spread settles at its width, 1.00', Q.settlementAt(z(771, 'C', 772), DAY)?.price, 1);
expectEqual('A9 the 772/775 call spread at 0.33', Q.settlementAt(z(772, 'C', 775), DAY)?.price, 0.33);
expectEqual('A9 the 773/771 put spread at 0.67', Q.settlementAt(z(773, 'P', 771), DAY)?.price, 0.67);
expectEqual('A9 a SPY option is exercised, an SPXW one is cash', [Q.settleStyleOf('SPY'), Q.settleStyleOf('SPXW'), H.underOf('SPXW'), H.underOf('NDXP')], ['exercise', 'cash', 'SPX', 'NDX']);
expectEqual('A9 the listing that day had every expiry it quoted, out to 120 days', Q.expiriesAt('SPY', DAY).length, 21);

/* ==== Part B · held to the bell on recorded quotes (needs its own recording) ==== */
const B_DIR = join(ROOT, SET_B);
if (!RECORD && !existsSync(join(B_DIR, 'clock.txt'))) {
  console.log(`\nPENDING  ${SET_B} is not recorded (it needs the ThetaData terminal). It would hold, to the bell of Oct 28:
  · SPY 771C expiring Oct 28 — /option/history/quote?symbol=SPY&expiration=20261028&strike=771.00&right=call&date=20261028&interval=1m&format=json
  · SPX's bars — /index/history/ohlc?symbol=SPX&start_date=20261028&end_date=20261028&interval=1m&format=json
  · SPXW's listing — /option/list/contracts/quote?symbol=SPXW&date=20261028&max_dte=120&format=json
  · the SPXW Oct 28 call nearest SPX at 15:00 — /option/history/quote?symbol=SPXW&expiration=20261028&strike=<K>&right=call&date=20261028&interval=1m&format=json
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/backtest-golden.ts`);
} else {
  installUwFixtures(SET_B);
  recordedAt(SET_B, new Date().toISOString());
  /* SPY's own 0DTE call bought at 15:00 (minute 329) and held to the bell: it settles at 1.33 with no fee */
  const zc = z(771, 'C');
  await H.ensureLeg(zc, DAY);
  let s = E.place(at(fresh('b1'), 329), { contract: zc, side: 'buy', qty: 1, kind: 'market' }, 0);
  const paid = s.fills[0]?.price ?? NaN;
  /* the raw row: SPY Oct 28 771C, 15:00 1.73 1.74 (the NBBO at the end of 14:59) — a market buy pays the ask */
  expectNear('B1 the 0DTE call bought at 15:00 pays the 15:00 row’s ask, 1.74', paid, 1.74);
  s = at(s, BELL);
  const tb = E.bookOf(s).trades[0];
  expectEqual('B1 the SPY 0DTE call ended at the bell, exercised', [tb?.how, tb?.settle], ['expired', 'exercise']);
  expectNear('B1 …at 1.33 a share, with no fee', s.fills[1]?.price ?? NaN, 1.33);
  /* 133 − 174 − 0.65 fee on the buy */
  expectNear('B1 …and made 133 less what it cost: −41.65', tb?.pnl ?? NaN, -41.65);
  /* SPXW: the name's price is SPX's; a contract settles in cash on SPX's close print */
  await H.ensureBars('SPXW', DAY);
  await H.ensureListing('SPXW', DAY);
  const spx = H.spotAt('SPXW', DAY, 329);
  const ks = H.listingOf('SPXW', DAY)?.strikes[`${DAY}|C`] ?? [];
  const k = ks.reduce((best, x) => (Math.abs(x - spx) < Math.abs(best - spx) ? x : best), ks[0]);
  /* SPX's 14:59 bar closes 7738.27 (the price at 15:00); the nearest listed call is 7740 */
  expectEqual('B2 SPX at 15:00 and the call nearest it', [spx, k], [7738.27, 7740]);
  const xc = { ticker: 'SPXW', strike: k, right: 'C' as const, expiry: DAY };
  await H.ensureLeg(xc, DAY);
  let x = E.newSession({ id: 'b2', name: 'b2', ticker: 'SPXW', startCash: 100000, startDay: DAY, now: 0 });
  x = E.place(E.advance(x, { day: DAY, minute: 329 }, 0), { contract: xc, side: 'buy', qty: 1, kind: 'market' }, 0);
  x = E.advance(x, { day: DAY, minute: BELL }, 0);
  const close = H.closePrintOf('SPX', DAY);
  const tx = E.bookOf(x).trades[0];
  expectEqual('B2 the SPXW call settled in cash', [tx?.how, tx?.settle], ['expired', 'cash']);
  /* the raw rows: SPXW Oct 28 7740C, 15:00 9.6 9.8; SPX's 16:00 bar closes 7744.37, the day's last print */
  expectNear('B2 …bought at the 15:00 row’s ask, 9.80', x.fills[0]?.price ?? NaN, 9.8);
  expectNear('B2 SPX’s close is its 16:00 print, 7744.37', close, 7744.37);
  expectNear('B2 …settled at 7744.37 − 7740 = 4.37', x.fills[1]?.price ?? NaN, 4.37);
}

/* ==== Part C · the next day (Thu 2026-10-29): the roll-over, the report's files, the day stop — and later expiries ==== */
const C_DIR = join(ROOT, SET_C);
if (!RECORD && !existsSync(join(C_DIR, 'clock.txt'))) {
  console.log(`\nPENDING  ${SET_C} is not recorded (it needs the ThetaData terminal). Record: GOLDEN_RECORD=1 npx tsx scripts/golden/backtest-golden.ts`);
} else {
  const fxC = installUwFixtures(SET_C);
  recordedAt(SET_C, new Date().toISOString());
  const R = await import('../../src/data/review/reportCsv');
  const { csvCells } = await import('../../src/data/review/journalManual');
  const OLD_LIST = 'theta:/option/list/contracts/quote?symbol=SPY&date=20261028&max_dte=120&format=json';
  const NEW_LIST = 'theta:/option/list/contracts/quote?symbol=SPY&date=20261028&format=json';

  /* C1 · LATER EXPIRIES: the first listing's request is the one recorded (byte for byte — a changed path would find no
     recording); the second is a new request, made only when asked */
  expectEqual('C1 the day’s listing asked exactly the recorded request, once', fxA.asked.filter(a => a.startsWith('theta:/option/list/')), [OLD_LIST]);
  const before = Q.expiriesAt('SPY', DAY).map(e => e.iso);
  expectEqual('C1 …nothing past 120 days until the reader asks', [before.length, Math.max(...Q.expiriesAt('SPY', DAY).map(e => e.dte))], [21, 114]);
  expectEqual('C1 …and nothing asked for them yet', [H.laterAsked('SPY', DAY), fxC.asked.length], [false, 0]);
  await H.ensureLaterListing('SPY', DAY);
  expectEqual('C1 the later listing is a NEW request beside the first', fxC.asked.filter(a => a.startsWith('theta:/option/list/')), [NEW_LIST]);
  const later = Q.expiriesAt('SPY', DAY);
  /* the raw answer: 12,374 rows over 34 expiries, the last Jan 19, 2029 (zcat the recording) */
  expectEqual('C1 …every expiry quoted that day: 34, out to Jan 19, 2029', [later.length, later[later.length - 1]?.iso], [34, '2029-01-19']);
  expectEqual('C1 …the first 21 are the 120-day listing’s, unchanged', later.slice(0, 21).map(e => e.iso), before);
  expectEqual('C1 …13 past 120 days, the nearest Feb 26, 2027 (121 days)', [later.filter(e => e.dte > H.LISTING_DTE).length, later.find(e => e.dte > H.LISTING_DTE)?.iso, later.find(e => e.dte > H.LISTING_DTE)?.dte], [13, '2027-02-26', 121]);

  /* C2 · THE ROLL-OVER on recorded quotes: two 771 calls bought at 10:00 (4.10, as A1), a GTC target far off, a DAY buy
     and a GTC buy far under the put's ask; the clock played an hour a tick with the roll-over on */
  await H.ensureBars('SPY', DAY2);
  await H.ensureLeg(call, DAY2);
  await H.ensureLeg(put, DAY2);
  let r = E.place(at(fresh('c2'), 29), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
  r = E.place(r, { contract: call, side: 'sell', qty: 2, kind: 'limit', price: 9, tif: 'gtc' }, 0);
  r = E.place(r, { contract: put, side: 'buy', qty: 1, kind: 'limit', price: 0.05, tif: 'day' }, 0);
  r = E.place(r, { contract: put, side: 'buy', qty: 1, kind: 'limit', price: 0.06, tif: 'gtc' }, 0);
  const path: string[] = [];
  let atBell: typeof r | null = null;
  for (let i = 0; i < 12; i++) {
    const to = E.playStep(r.cursor, 60, true, r.cursor.day === DAY ? DAY2 : null);
    if (!to) break;
    r = E.advance(r, to, 0);
    path.push(`${to.day.slice(8)}@${to.minute}`);
    if (to.day === DAY && to.minute === BELL) atBell = r;
    if (to.day === DAY2) break;
  }
  expectEqual('C2 played with the roll-over on, the clock stands on the bell, then opens Oct 29', path, ['28@89', '28@149', '28@209', '28@269', '28@329', '28@389', '29@0']);
  expectEqual('C2 …the two calls carry', E.bookOf(r).positions.map(p => [p.contract.strike, p.contract.right, p.qty]), [[771, 'C', 2]]);
  const gtc = r.orders.filter(o => o.tif === 'gtc').map(o => [o.side, o.price, o.status]);
  expectEqual('C2 …the GTC orders carry, working', gtc, [['sell', 9, 'working'], ['buy', 0.06, 'working']]);
  const dayOrder = r.orders.find(o => o.tif === 'day' && o.kind === 'limit')!;
  expectEqual('C2 …the day order expired at Oct 28’s bell', [dayOrder.status, dayOrder.why, dayOrder.done], ['cancelled', 'the day ended', { day: DAY, minute: BELL }]);
  expectEqual('C2 …the bell kept the account as A8 found it', r.closes?.[DAY], { equity: 25080.7, cash: 24178.7, realized: 0, open: 80.7, held: 1 });
  expectEqual('C2 …the same session “Open the next day” makes from the bell, field for field', JSON.stringify(E.nextOpen(atBell!, 0)) === JSON.stringify(r), true);
  /* the Oct 29 09:31 row of the Oct 30 771C is 1.97 1.99: two marked at the 1.98 mid, 24,178.70 + 396 */
  expectNear('C2 the open walked into is kept: cash + two calls at the 09:31 mid', r.opens?.[DAY2] ?? NaN, 24574.7);

  /* C3 · THE REPORT'S FILES: the calls sold at Oct 29 11:31 (minute 120; the 11:31 row is 2.59 2.60); the files'
     columns and sums are the report's */
  r = E.place(E.advance(r, { day: DAY2, minute: 120 }, 0), { contract: call, side: 'sell', qty: 2, kind: 'market' }, 0);
  r = E.advance(r, { day: DAY2, minute: BELL }, 0);
  const trades = [...E.accountOf(r).trades].sort((a, b) => E.stampOf(a.closed) - E.stampOf(b.closed));
  expectNear('C3 the trade: 2 × 259 − 1.30 − 821.30', trades[0]?.pnl ?? NaN, -304.6);
  const tc = csvCells(R.reportTradesCsv(trades));
  expectEqual('C3 the trades file: its columns, a line a trade', [tc[0], tc.length], [[...R.TRADE_COLUMNS], 2]);
  const col = (n: string) => tc[1][tc[0].indexOf(n)];
  expectEqual('C3 …its line', [col('opened_et'), col('closed_et'), col('contract'), col('side'), col('qty'), col('entry'), col('exit'), col('fees'), col('pnl'), col('ended'), col('settle')], ['2026-10-28 10:00', '2026-10-29 11:31', 'SPY 771C', 'long', '2', '4.10', '2.59', '2.60', '-304.60', 'sold', '']);
  expectEqual('C3 …its fills', col('fills'), '10:00 buy 2 @ 4.10; 2026-10-29 11:31 sell 2 @ 2.59');
  expectNear('C3 …its pnl adds up to the report’s Made or lost', tc.slice(1).reduce((a, l) => a + Number(l[tc[0].indexOf('pnl')]), 0), E.statsOf(trades).net);
  const days = R.dayRowsOf(r, trades);
  const dc = csvCells(R.reportDaysCsv(days, false));
  expectEqual('C3 the days file: By day, a line a bell', dc, [['date', 'closed', 'pnl', 'account_move', 'equity_at_bell', 'held_overnight'], ['2026-10-28', '0', '0.00', '80.70', '25080.70', '1'], ['2026-10-29', '1', '-304.60', '-385.30', '24695.40', '0']]);
  expectNear('C3 …its pnl adds up to the closed trades', dc.slice(1).reduce((a, l) => a + Number(l[2]), 0), E.statsOf(trades).net);
  expectNear('C3 …and its last bell is the account', Number(dc[2][4]), E.cashOf(r));

  /* C4 · THE DAY STOP, plainly: 3% of the account at each open — Oct 28 the start, Oct 29 the carried book's open */
  let d4 = E.place(at(fresh('c4', { dailyLossPct: 0.03 }), 29), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
  expectEqual('C4 Oct 28: −3% of the $25,000 it opened with', E.dayStopOf(d4)?.words, 'Day stop: −3% of the account at 09:30 = −$750');
  d4 = E.nextOpen(E.advance(d4, { day: DAY, minute: BELL }, 0), 0);
  /* 24,574.70 × 3% = 737.241 */
  expectEqual('C4 Oct 29: −3% of what the account was worth at that open', E.dayStopOf(d4)?.words, 'Day stop: −3% of the account at 09:30 = −$737.24');
}

done();
