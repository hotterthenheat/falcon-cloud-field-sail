/*
  The November 3, 2026 live check. One greek (readGreek) for Weigher, Paper, and the backtest mark.
  Vendor rows keep their own numbers. The dollar gamma bell waits for the dollar book. A dark print under the
  name's sized floor is rotation. The Model Risk peak is the high bid on the path, not max(entry, exit).

  Run: npx tsx scripts/live-check-proof.ts
*/
import { resetCarry, setDayRates } from '../src/core/carry';
import { blackScholesGreeks, blackScholesPrice } from '../src/core/greeks';
import { calendarYearsOpen, greekCaption, parityMedian, readGreek, type ChainPair } from '../src/core/readGreek';
import { nyWallTime } from '../src/core/nyTime';
import { bookToday, isoDate, nextSession } from '../src/core/calendar';
import { quotePlace, darkPrint, darkPosture, darkSizedFloor } from '../src/data/traceDark';
import { noteAdv } from '../src/data/traceRows';
import { peekBellShare } from '../src/data/book/levels';
import { cache, type Entry } from '../src/data/book/store';
import { emptyNode } from '../src/data/book/scale';
import { explainContract, pricerFor, readContract } from '../src/data/weigherGate';
import { putName, putBook } from '../src/data/paper/thetaFeed';
import { optionQuote, optionQuoteAt } from '../src/data/paper/feed';
import { barTime, putBars, putQuotes } from '../src/data/review/history';
import { quoteAt } from '../src/data/review/quotes';
import { importSignals, recordTail, closeTail, signals } from '../src/data/compassLedger';
import { tradeToPrint } from '../src/data/traceRows';
import type { TailTicket } from '../src/data/modelRisk';
import type { Candle } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const near = (what: string, got: number, want: number, tol: number) => {
  check(`${what}: ${Number.isFinite(got) ? got.toFixed(6) : got} ≈ ${want}`, Number.isFinite(got) && Math.abs(got - want) <= tol);
};

/* ---- cents from the mid ---- */
{
  const a = quotePlace(0.1, 100.1);
  const b = quotePlace(10, 5.5);
  check(`quotePlace(0.1, 100.10) is +10¢ (${a.text}, ${a.cents})`, a.text === '+10¢' && Math.abs(a.cents - 10) < 1e-6);
  check(`quotePlace(10, 5.50) is +50¢ (${b.text}, ${b.cents})`, b.text === '+50¢' && b.cents === 50);
}

/* ---- bell share: wait until the dollar book, then a percent of dollar gamma ---- */
{
  const name = 'BELLTEST';
  check('peekBellShare waits before any book', peekBellShare(name).share === null && peekBellShare(name).why === 'wait');
  const today = isoDate(nextSession(bookToday()));
  const later = '2099-06-15';
  const node = (strike: number, callGex: number, putGex: number) => ({ ...emptyNode(strike), callGex, putGex, netGex: callGex + putGex });
  const base = (gammaLive: boolean): Entry => ({
    ticker: name,
    at: 1,
    full: true,
    wantFull: false,
    spot: 100,
    prev: 100,
    changePct: 0,
    iv: 0,
    impliedMove: 0,
    dayMoveFrac: 0,
    all: [node(100, 10_000, 0)],
    byDate: { [today]: [node(100, 40, -10)], [later]: [node(100, 150, 0)] },
    expiries: [{ date: today, dte: 0 }, { date: later, dte: 40 }],
    flow: new Map(),
    candles: [],
    tape: [],
    history: [],
    status: 'live',
    gammaLive,
    /* share gamma, the old fallback. The column does not read it. */
    totals: [{ date: today, gross: 1 }, { date: later, gross: 999 }],
  });
  cache.set(name, base(false));
  const waiting = peekBellShare(name);
  check(`peekBellShare waits while gammaLive is off (${waiting.share === null ? waiting.why : waiting.share})`, waiting.share === null && waiting.why === 'wait');
  cache.set(name, base(true));
  const live = peekBellShare(name);
  /* today |40| + |-10| = 50; the later date 150; 50 / 200 = 25%. The all-row 10,000 and the totals are not this. */
  check(`peekBellShare is 25% of dollar gamma after the dollar book (${live.share === null ? live.why : live.share})`, live.share === 25);
}

/* ---- readGreek on the November 3, 4:15 PM ET SPY November 6 753 chain ---- */
const AT = nyWallTime(2026, 11, 3, 16, 15);
const LATE = nyWallTime(2026, 11, 3, 20, 0);
const EXP = '2026-11-06';
const S_BID = 754.33;
const S_ASK = 754.43;
const S = (S_BID + S_ASK) / 2;
const CALL = { bid: 7.37, ask: 7.47, at: AT, ivError: 0 as number | null };
const PUT = { bid: 5.5, ask: 5.61, at: AT, ivError: 0 as number | null };
resetCarry();
/* the fixing published by 11-03 is 11-02's (core/carry rateOn; corrected, audit W9: this once keyed 11-03's own) */
setDayRates([{ day: '2026-11-02', r: 0.0395 }]);
const tCal = calendarYearsOpen(EXP, AT)!;
const grow = Math.exp(0.0395 * tCal);
const callMid = (CALL.bid + CALL.ask) / 2;
const putMid = (PUT.bid + PUT.ask) / 2;
const f753 = 753 + grow * (callMid - putMid);
const chain: ChainPair[] = [];
for (let k = 748; k <= 758; k++) {
  if (k === 753) {
    chain.push({ strike: 753, callBid: CALL.bid, callAsk: CALL.ask, putBid: PUT.bid, putAsk: PUT.ask });
    continue;
  }
  const diff = (f753 - k) / grow;
  const cm = Math.abs(diff) + 3;
  const pm = cm - diff;
  chain.push({ strike: k, callBid: cm - 0.05, callAsk: cm + 0.05, putBid: pm - 0.05, putAsk: pm + 0.05 });
}
const fwd = parityMedian(chain, S, 0.0395, tCal);
near('parity forward from the 748–758 book', fwd ?? NaN, 754.87, 0.01);
near('minutes to the Nov 6 close', tCal * 365 * 1440, 4305, 0.6);

const stock = { bid: S_BID, ask: S_ASK, at: AT };
const call = readGreek({ right: 'C', strike: 753, expiry: EXP, at: AT, option: CALL, other: PUT, stock, chain });
const put = readGreek({ right: 'P', strike: 753, expiry: EXP, at: AT, option: PUT, other: CALL, stock, chain });
check('the call solves', call.ok);
check('the put solves', put.ok);
if (call.ok && put.ok) {
  check('both sides, one IV', call.callIv != null && put.putIv != null && Math.abs((call.callIv ?? 0) - (call.putIv ?? 0)) < 5e-4 && Math.abs(call.iv - put.iv) < 1e-12);
  check('carry is the parity forward, not cash', call.carry === 'parity' && call.note === '' && call.separate === false);
  near('one IV, 23.7%', call.iv * 100, 23.7, 0.15);
  /* Parity partials. Cash spot with dividend 0 is about 0.544 / −0.455; the chain row is 0.537. This is neither. */
  near('call delta', call.delta, 0.5504, 0.008);
  near('put delta', put.delta, -0.4499, 0.008);
  near('carry b, about 7.9%', call.b, 0.0786, 0.004);
  check('vega is per 1.00 of volatility, not per point', call.vega > 5);
  check('theta per calendar day is near −1.16, not the chain’s −1.111', call.thetaDay < -1.13 && call.thetaDay > -1.22);
  const priced = pricerFor(
    { ticker: 'SPY', expiryIso: EXP },
    { strike: 753, right: 'C', iv: call.iv * 100, greekT: call.t, greekR: call.r, greekQ: call.q },
    AT,
  )!(S);
  near('the solved clock prices the call at the mid, not $10.13', priced, callMid, 0.03);
  check(`the $10.13 trading-year paste is not this price (${priced.toFixed(3)})`, Math.abs(priced - 10.13) > 1);
  const row = readContract({
    ticker: 'SPY', spot: S, strike: 753, right: 'C', bid: CALL.bid, ask: CALL.ask, expiryIso: EXP,
    optionAt: AT, stockAt: AT, stockBid: S_BID, stockAsk: S_ASK, ivError: 0,
    otherBid: PUT.bid, otherAsk: PUT.ask, otherAt: AT, chain, now: AT,
  });
  const perPoint = blackScholesGreeks(call.spot, 753, call.t, call.iv, call.r, call.q);
  check('the chain row is the parity solve, not cash spot', row != null && row.note == null && Math.abs(row.delta - call.delta) < 1e-9);
  near('rho is per 1.00 of rate, about 3.34, not the per-point 0.033', row?.rho ?? NaN, perPoint.rhoCall * 100, 0.05);
  check('rho is not left at the per-point figure', (row?.rho ?? 0) > 1);
  near('decay an hour is a calendar hour, theta per day / 24', row?.thetaHour ?? NaN, call.thetaDay / 24, 1e-6);
  check('that hour is not the trading hour', row != null && Math.abs(row.thetaHour - call.thetaSession / 6.5) > 0.1);
  const cash = readGreek({ right: 'C', strike: 753, expiry: EXP, at: AT, option: CALL, stock });
  check('no chain is named cash spot, dividend 0', cash.ok && cash.carry === 'cash' && cash.note === 'cash spot, dividend 0');
  if (cash.ok) near('no chain, the call delta is the cash-spot solve', cash.delta, 0.5436, 0.004);
}

const late = readGreek({
  right: 'C',
  strike: 753,
  expiry: EXP,
  at: AT,
  option: { ...CALL, ivError: 0 },
  other: PUT,
  stock: { bid: 752.07, ask: 752.49, price: 752.28, at: LATE },
  chain,
});
check(`8:00 PM ET underlying is rejected (${late.ok ? 'solved' : late.why})`, !late.ok && late.why === 'timestamps');

const erred = readGreek({ right: 'C', strike: 753, expiry: EXP, option: { ...CALL, ivError: 1 }, stock, chain });
check(`iv_error other than 0 is rejected (${erred.ok ? 'solved' : erred.why})`, !erred.ok && erred.why === 'iv error');

resetCarry();
const unloaded = readGreek({ right: 'C', strike: 753, expiry: EXP, option: CALL, other: PUT, stock, chain });
check(`no rate loaded is blank (${unloaded.ok ? 'solved' : unloaded.why})`, !unloaded.ok && unloaded.why === 'rate not loaded');
/* the fixing published by 11-03 is 11-02's (core/carry rateOn; corrected, audit W9: this once keyed 11-03's own) */
setDayRates([{ day: '2026-11-02', r: 0.0395 }]);

/* ---- Weigher, Paper, and a backtest mark on one stored minute ---- */
{
  const iso = '2026-11-03';
  const minute = 200;
  const wall = 9 * 60 + 30 + minute + 1;
  const at = nyWallTime(2026, 11, 3, Math.floor(wall / 60), wall % 60);
  const spot = 100;
  const strike = 100;
  const bid = 2;
  const ask = 2.1;
  const expiry = '2026-11-20';
  const bars: Candle[] = [];
  for (let m = 0; m <= minute; m++) bars.push({ time: barTime(iso, m), open: spot, high: spot, low: spot, close: spot, volume: 1000 });
  putBars('SPY', iso, bars);
  const qb = Array(minute + 1).fill(bid);
  const qa = Array(minute + 1).fill(ask);
  putQuotes({ ticker: 'SPY', expiry, strike, right: 'C' }, iso, qb, qa);
  putName('SPY', { bid: spot, ask: spot, px: spot, takenAt: at, at });
  putBook('SPY', expiry, [{ strike, right: 'C', bid, ask }], at);
  const w = readContract({ ticker: 'SPY', spot, strike, right: 'C', bid, ask, expiryIso: expiry, optionAt: at, stockAt: at, stockBid: spot, stockAsk: spot, now: at });
  const p = optionQuote({ ticker: 'SPY', strike, right: 'C', expiry }, at, spot);
  const bt = quoteAt({ ticker: 'SPY', strike, right: 'C', expiry }, iso, minute);
  const same = w != null && Math.abs(w.delta - p.delta) < 1e-9 && Math.abs(p.delta - bt.delta) < 1e-9 && w.delta > 0.4 && w.delta < 0.7;
  check(`Weigher ${w?.delta.toFixed(5)}, Paper ${p.delta.toFixed(5)}, backtest ${bt.delta.toFixed(5)} are one readGreek delta`, same);
  const direct = readGreek({ right: 'C', strike, expiry, at, option: { bid, ask, at }, stock: { price: spot, at } });
  check('that delta is readGreek on the stored minute', direct.ok && w != null && Math.abs(direct.delta - w.delta) < 1e-9);
  check('a minute with no chain says cash spot on all three', !!w?.note?.includes('cash spot') && p.greekNote === 'cash spot, dividend 0' && bt.greekNote === 'cash spot, dividend 0');
  const moved = optionQuoteAt({ ticker: 'SPY', strike, right: 'C', expiry }, at, spot + 5);
  const atSpot = blackScholesGreeks(spot + 5, strike, p.greekT ?? 0, p.iv, p.greekR ?? 0, p.greekQ ?? 0);
  check(`what-if vega is per 1.00 (${moved.vega.toFixed(3)}), not per point`, p.greekT != null && Math.abs(moved.vega - atSpot.vega * 100) < 1e-6 && moved.vega > 1);
  check(`what-if theta is the session decay (${moved.theta.toFixed(4)}), not zero`, moved.theta < -0.01);
}

/* ---- Model Risk peak is the high bid between entry and exit ---- */
{
  importSignals([]);
  const bids = [
    { minute: 90, bid: 3 },
    { minute: 100, bid: 1 },
    { minute: 110, bid: 2.4 },
    { minute: 120, bid: 1.1 },
    { minute: 130, bid: 5 },
  ];
  const ticket: TailTicket = {
    id: 'live-check',
    day: '2026-11-03',
    book: '1-7',
    right: 'C',
    ticker: 'PEAK',
    root: 'PEAK',
    contract: 'PEAK 100C',
    strike: 100,
    expiry: '2026-11-06',
    expiryTradingDays: 3,
    entryMinute: 100,
    entryAsk: 1.2,
    entryBid: 1,
    entryAt: 1_700_000_000_000,
    spot: 100,
    orHigh: 101,
    orLow: 99,
    score: 1,
    iv: 0.2,
    gamma: 0.01,
    thetaYear: -1,
    gex: null,
    exitMinute: 120,
    exitBid: 1.1,
    exitAt: 1_700_001_200_000,
    why: 'held',
    bids,
  };
  recordTail({ ...ticket, exitMinute: null, exitBid: null, exitAt: null, why: null });
  const open = signals().find(s => s.ticker === 'PEAK');
  check(`an open trade's peak starts at the entry bid and takes the high so far (${open?.outcome?.peak})`, open?.outcome?.status === 'open' && open.outcome.peak === 5);
  closeTail(ticket);
  const closed = signals().find(s => s.ticker === 'PEAK');
  check(`tail peak is the middle bid 2.40, not entry 1.00 or exit 1.10 (${closed?.outcome?.peak})`, closed?.outcome?.status === 'closed' && closed.outcome.peak === 2.4 && closed.outcome.exit?.px === 1.1);
  check('the blotter sentence is earned: the stored high is above the exit', (closed?.outcome?.peak ?? 0) > (closed?.outcome?.exit?.px ?? Infinity));
  /* to the cent, as every book's P&L (was the raw float, (1.1 - 1.2) x 100 = -9.999999999999998) */
  check('P&L stays (exitBid − entryAsk) × 100, to the cent', closed?.outcome?.pnl === -10);
}

/* ---- a dark print under the name's floor, over $250,000, is rotation and out of the posture ---- */
{
  noteAdv('NVDA', 36e9);
  const floor = darkSizedFloor(36e9);
  check('NVDA sized floor is about $1.5M and above $250,000', floor > 1_400_000 && floor < 1_700_000 && floor > 250_000);
  const row = (premium: number, price: number) => ({
    ticker: 'NVDA',
    price,
    size: Math.round(premium / price),
    premium,
    nbbo_bid: 99,
    nbbo_ask: 99.5,
    executed_at: '2026-11-03T15:00:00Z',
    tracking_id: `live-check-${premium}`,
  });
  const small = darkPrint(row(400_000, 100), 0);
  const big = darkPrint(row(2_000_000, 100), 1);
  check(`$400k print intent is rotation (${small.intent}), sized ${small.sized}`, small.intent === 'ROTATION' && small.sized === false && small.notional >= 250_000 && small.notional < floor);
  check(`$2M print is sized accumulation (${big.intent})`, big.intent === 'ACCUMULATION' && big.sized === true);
  const posture = darkPosture([small, big], { minPrints: 1 });
  check(`posture dollars are the $2M print only (${posture.notional})`, posture.notional === big.notional && !posture.read.includes(small) && posture.read.includes(big));
}

/* ---- a flow print keeps its delta beside the chain row and readGreek ---- */
{
  const solved = readGreek({ right: 'C', strike: 753, expiry: EXP, at: AT, option: CALL, other: PUT, stock, chain });
  const flow = tradeToPrint({
    ticker: 'SPY',
    underlying_symbol: 'SPY',
    strike: 761,
    expiry: '2026-11-05',
    option_type: 'call',
    price: 1.2,
    nbbo_bid: 1.1,
    nbbo_ask: 1.3,
    size: 10,
    premium: 1200,
    delta: 0.31115,
    gamma: 0.01,
    theta: -1.1678,
    implied_volatility: 0.2309,
    underlying_price: 754.36,
    executed_at: '2026-11-03T21:15:00Z',
  });
  check('the flow print keeps 0.31115', flow.delta === 0.31115);
  const caption = greekCaption([
    ...(solved.ok ? [{ source: 'readGreek' as const, delta: solved.delta }] : []),
    { source: 'Chain', delta: 0.536955 },
    { source: 'Flow', delta: 0.31115 },
  ]);
  check(`caption names each delta (${caption})`, solved.ok && caption.includes(`readGreek ${solved.delta.toFixed(3)}`) && caption.includes('Chain 0.537') && caption.includes('Flow 0.311'));
  check('readGreek, the chain 0.537, and the flow 0.311 are three numbers', solved.ok && Math.abs(solved.delta - 0.536955) > 0.005 && Math.abs(solved.delta - 0.31115) > 0.1 && Math.abs(0.536955 - 0.31115) > 0.1);
  const explained = explainContract({
    ticker: 'SPY',
    spot: S,
    strike: 753,
    right: 'C',
    bid: CALL.bid,
    ask: CALL.ask,
    expiryIso: EXP,
    optionAt: AT,
    stockAt: AT,
    stockBid: S_BID,
    stockAsk: S_ASK,
    ivError: 0,
    otherBid: PUT.bid,
    otherAsk: PUT.ask,
    chain,
    now: AT,
  });
  check('Weigher shows that readGreek delta, not the chain delta', explained.ok && solved.ok && Math.abs(explained.read.delta - solved.delta) < 1e-9 && Math.abs(explained.read.delta - 0.536955) > 0.005);
}

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log('\nlive-check-proof passed');
