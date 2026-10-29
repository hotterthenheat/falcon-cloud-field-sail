/*
  PAPER — THE ENGINE AGAINST ITS RULES (options only)

  A made-up market handed to the engine one tick at a time: the names' prices are set by hand, the clock is set by hand,
  and every rule is walked and checked — the practice account's (fills, fees, the bell, the page), and the plan rules a
  prop-firm account runs on (data/paper/rules.ts), on test plans whose numbers are this file's own, not any firm's.
  Run: npx tsx scripts/paper-proof.ts (npm run review:proof runs it with the backtest's).
*/

import { addDays, dayBeginsAt, dayEndsAt, nyAt, nyInstant, tradingDayOf, yearsToExpiry } from '../src/data/paper/clock';
import { bankedOf, closeStale, endAccount, flattenAll, futBookOf, newAccount, optBookOf, optClose, optPlace, optRefusal, retireFutures, tick, viewOf, type PaperAccount, type PaperMarket } from '../src/data/paper/engine';
import { NO_RULES, floorOf, readRules, type PaperPlan, type PropRules } from '../src/data/paper/rules';
import { PROP_FIRMS } from '../src/data/paper/propFirms';
import { isPaperIndex } from '../src/data/paper/products';
import { optionRootOf } from '../src/data/paper/thetaFeed';
import type { ContractId } from '../src/data/review/quotes';
import { priceWith } from './paper-test-pricer';
import { replayGaps, type Fetched } from '../src/data/paper/catchUp';
import { legKey } from '../src/data/review/history';
import { gapOf } from '../src/data/paper/engine';
import type { Candle } from '../src/types/market';

let failed = 0;
let passed = 0;
const ok = (what: string, pass: boolean, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'ok  ' : 'MISS'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

/* ---- the made-up market ---- */
const TUE = '2026-09-22';
let now = nyInstant(TUE, 10 * 60);
const px: Record<string, number> = { SPY: 500, QQQ: 440, IWM: 220 };
let life = 'L1';
const bars: Record<string, Candle[]> = {};
const market = (): PaperMarket => ({
  now,
  life,
  optQuote: (c: ContractId) => priceWith(c, px[c.ticker], yearsToExpiry(c.expiry, now), 0.15),
  optQuoteAt: (c: ContractId, spot: number) => priceWith(c, spot, yearsToExpiry(c.expiry, now), 0.15),
  bar: () => Math.floor(now / 1000),
  candles: (t: string) => bars[t] ?? [],
  open: () => true,
  /* the name's 16:00 close: where it is set */
  closeOf: (t: string) => px[t],
});
/** A second on, the names where they are set — and a candle for each, so a closed trade has something to be drawn on */
const step = (ms = 1500) => {
  now += ms;
  for (const t of ['SPY', 'QQQ', 'IWM']) {
    const p = px[t];
    (bars[t] ??= []).push({ time: Math.floor(now / 1000), open: p, high: p, low: p, close: p, volume: 1 });
  }
};
const run = (a: PaperAccount, ms = 1500) => {
  step(ms);
  return tick(a, market());
};

/* ================= the clock ================= */
ok('a Tuesday at 10:00 New York is Tuesday’s trading day', tradingDayOf(nyInstant(TUE, 600)) === TUE);
ok('…at 16:59 still Tuesday’s; at 17:00 it is Wednesday’s', tradingDayOf(nyInstant(TUE, 16 * 60 + 59)) === TUE && tradingDayOf(nyInstant(TUE, 17 * 60)) === '2026-09-23');
ok('Friday evening, Saturday and Sunday belong to Monday', tradingDayOf(nyInstant('2026-09-25', 18 * 60)) === '2026-09-28' && tradingDayOf(nyInstant('2026-09-26', 12 * 60)) === '2026-09-28' && tradingDayOf(nyInstant('2026-09-27', 19 * 60)) === '2026-09-28');
ok('a market holiday belongs to the next session (Labor Day → Tuesday)', tradingDayOf(nyInstant('2026-09-07', 11 * 60)) === '2026-09-08');
ok('an instant of New York’s clock reads back as that clock, in summer and in winter', nyAt(nyInstant(TUE, 9 * 60 + 30)).minutes === 570 && nyAt(nyInstant('2026-12-15', 9 * 60 + 30)).minutes === 570);
ok('a same-day contract before the open has the whole day left; at noon, less; at 16:00, none', (() => {
  const pre = yearsToExpiry(TUE, nyInstant(TUE, 8 * 60));
  const noon = yearsToExpiry(TUE, nyInstant(TUE, 12 * 60));
  const bell = yearsToExpiry(TUE, nyInstant(TUE, 16 * 60));
  return near(pre, 1 / 252, 1e-9) && noon < pre && noon > 0 && bell === 0;
})());
ok('a contract two sessions out has more than two sessions left before the open', yearsToExpiry('2026-09-24', nyInstant(TUE, 8 * 60)) * 252 > 2.99);

/* ================= a practice account: options ================= */
let a = newAccount({ id: 'p1', kind: 'practice', name: 'Practice', startCash: 25_000, now });
const EXP = '2026-10-02';
const call: ContractId = { ticker: 'SPY', strike: 505, right: 'C', expiry: EXP };
const q0 = market().optQuote(call);
a = optPlace(a, market(), { contract: call, side: 'buy', qty: 2, kind: 'market' });
ok('a market buy fills at once, at the ask', a.opt.fills.length === 1 && a.opt.fills[0].price === q0.ask);
ok('it pays the premium and the fee out of cash', near(viewOf(a, market()).cash, 25_000 - q0.ask * 100 * 2 - 1.3));
ok('the fill says which page load it happened in and where the chart stood', a.opt.fills[0].life === 'L1' && a.opt.fills[0].bar === Math.floor(now / 1000));
ok('worth is cash plus the contracts at the mark', near(viewOf(a, market()).equity, viewOf(a, market()).cash + q0.mark * 200));
/* a limit placed now does not fill on the tick it was placed on */
const cheap = +(market().optQuote({ ...call, strike: 510 }).ask + 0.5).toFixed(2);
a = optPlace(a, market(), { contract: { ...call, strike: 510 }, side: 'buy', qty: 1, kind: 'limit', price: cheap });
ok('a limit at or over the ask waits for the next tick — never the tick it was placed on', optBookOf(a).positions.length === 1 && a.opt.orders.some(o => o.status === 'working' && o.kind === 'limit'));
({ account: a } = run(a));
ok('…and fills on the next, at the ask, never above the limit', optBookOf(a).positions.length === 2 && a.opt.fills[1].price <= cheap);
/* a target and a stop ride a buy; the stop sells on the bid */
const put: ContractId = { ticker: 'SPY', strike: 495, right: 'P', expiry: EXP };
const qp = market().optQuote(put);
a = optPlace(a, market(), { contract: put, side: 'buy', qty: 2, kind: 'market', bracket: { target: +(qp.ask * 1.5).toFixed(2), stop: +(qp.ask * 0.7).toFixed(2) } });
ok('a target and a stop are working after the buy, as one group', a.opt.orders.filter(o => o.status === 'working' && o.oco && o.contract.strike === 495).length === 2);
px.SPY = 508; // the put falls away
({ account: a } = run(a));
const stopped = optBookOf(a).trades.find(t => t.contract.strike === 495);
ok('the name runs up: the put’s stop sells at the bid, and its target goes', !!stopped && stopped.how === 'stopped' && a.opt.orders.filter(o => o.contract.strike === 495 && o.status === 'working').length === 0, `${stopped?.how} at ${stopped?.avgOut}`);
ok('a closed trade has its candles written down and what it did while held', !!stopped && !!a.paths[stopped.id] && !!a.held[stopped.id] && a.held[stopped.id].pts.length >= 1);
ok('its held record ends on its result, to the cent', !!stopped && a.held[stopped.id].pts[a.held[stopped.id].pts.length - 1][1] === stopped.pnl);
/* a target pinned to the NAME */
const qc = market().optQuote(call);
a = optPlace(a, market(), { contract: call, side: 'sell', qty: 1, kind: 'limit', price: 512, on: 'name' });
ok('a sell that waits on the name is taken while the name is short of it', a.opt.orders.some(o => o.status === 'working' && o.on === 'name'));
px.SPY = 512.5;
({ account: a } = run(a));
ok('the name gets there: it sells at the bid, whatever the bid is', a.opt.fills.some(f => f.side === 'sell' && f.contract.strike === 505 && f.how === 'limit'), `bid then ${market().optQuote(call).bid} · was ${qc.bid}`);
/* RP&L · UP&L (the chart's badges): what is banked and what is open add up to the account, to the cent */
ok('RP&L: the piece sold is banked while the rest is still open — and banked + open is what the account made', (() => {
  const w = viewOf(a, market());
  const open505 = optBookOf(a).positions.find(p => p.contract.strike === 505);
  return !!open505 && open505.qty === 1 && open505.banked !== 0 && near(bankedOf(a, 'SPY') + w.openPnl, w.equity - 25_000, 0.02);
})(), `banked ${bankedOf(a, 'SPY')} · open ${viewOf(a, market()).openPnl} · made ${viewOf(a, market()).equity - 25_000}`);
ok('RP&L is the name’s own, and the day’s: nothing banked on another name, nothing before the day began', bankedOf(a, 'QQQ') === 0 && bankedOf(a, 'SPY', dayBeginsAt(TUE)) === 0);
/* not enough free money */
ok('a buy that needs more than is free is refused, in words', (optRefusal(a, market(), { contract: call, side: 'buy', qty: 400, kind: 'market' }) ?? '').startsWith('Not enough free money'));
/* the bell of an expiry */
const daily: ContractId = { ticker: 'SPY', strike: 510, right: 'C', expiry: TUE };
a = optPlace(a, market(), { contract: daily, side: 'buy', qty: 1, kind: 'market' });
now = nyInstant(TUE, 16 * 60) + 500;
({ account: a } = run(a, 0));
const settled = optBookOf(a).trades.find(t => t.contract.expiry === TUE);
ok('at 16:00 a same-day contract settles at what it is worth in the money', !!settled && settled.how === 'expired' && near(settled.avgOut, Math.max(0, px.SPY - 510)), `${settled?.avgOut}`);
ok('an expired contract can no longer be bought', optRefusal(a, market(), { contract: daily, side: 'buy', qty: 1, kind: 'market' }) === 'That contract has expired');

/* ================= an index's options (2026-09-22) ================= */
ok('SPX, NDX and RUT are the paper account’s indexes', isPaperIndex('spx') && isPaperIndex('NDX') && isPaperIndex('rut') && !isPaperIndex('SPY'));
ok('an index’s options are asked of ThetaData on their own roots (SPXW, NDXP, RUTW); a fund’s on its own', optionRootOf('SPX') === 'SPXW' && optionRootOf('ndx') === 'NDXP' && optionRootOf('RUT') === 'RUTW' && optionRootOf('spy') === 'SPY');
px.SPX = 5000;
let ix = newAccount({ id: 'p9', kind: 'practice', name: 'Index', startCash: 25_000, now });
const spx: ContractId = { ticker: 'SPX', strike: 5000, right: 'C', expiry: EXP };
const qs = market().optQuote(spx);
ix = optPlace(ix, market(), { contract: spx, side: 'buy', qty: 1, kind: 'market' });
ok('an index option is bought like a name’s: at the ask, a hundred to the point, the fee on top', optBookOf(ix).positions.length === 1 && near(viewOf(ix, market()).cash, 25_000 - qs.ask * 100 - 0.65), `ask ${qs.ask}`);
ix = optPlace(ix, market(), { contract: spx, side: 'sell', qty: 1, kind: 'market' });
ok('…and sold at the bid', optBookOf(ix).positions.length === 0 && optBookOf(ix).trades.length === 1 && optBookOf(ix).trades[0].avgOut === market().optQuote(spx).bid);

/* ================= the page closing ================= */
now = nyInstant(TUE, 11 * 60);
px.SPY = 500;
let g = newAccount({ id: 'p3', kind: 'practice', name: 'page', startCash: 25_000, now });
const pageCall: ContractId = { ticker: 'SPY', strike: 500, right: 'C', expiry: EXP };
g = optPlace(g, market(), { contract: pageCall, side: 'buy', qty: 1, kind: 'market' });
g = optPlace(g, market(), { contract: pageCall, side: 'sell', qty: 1, kind: 'limit', price: 99 });
({ account: g } = run(g));
const markSeen = g.marks['SPY|2026-10-02|500|C'] ?? Object.values(g.marks)[0];
life = 'L2'; // a new page load — what the old one left open is closed at what it last saw
px.SPY = 470;
g = closeStale(g, market());
const pageTrade = optBookOf(g).trades[0];
ok('a new page load closes what an old one left open, at the last price that one saw', !!pageTrade && pageTrade.how === 'page' && pageTrade.avgOut === markSeen, `${pageTrade?.avgOut} · mark ${markSeen}`);
ok('…and cancels what it left working', g.opt.orders.every(o => o.status !== 'working'));
g = optPlace(g, market(), { contract: pageCall, side: 'buy', qty: 1, kind: 'market' });
g = flattenAll(g, market(), 'page', 'the page closed');
ok('the page closing flattens at the market, in its own words', optBookOf(g).trades[1]?.how === 'page' && optBookOf(g).trades[1]?.note === 'the page closed');
life = 'L1';

/* ================= an account from before options-only ================= */
{
  const old = newAccount({ id: 'old', kind: 'practice', name: 'old', startCash: 25_000, now });
  const withFut: PaperAccount = { ...old, plan: { id: 'legacy-50K', label: '50K', firm: null, size: 50_000, rules: NO_RULES, source: null, legacy: 'futures' }, kind: 'evaluation', marks: { ES: 5012 }, fut: { orders: [], fills: [{ id: 'f1', orderId: null, at: { at: now - 60_000, day: TUE }, symbol: 'ES', contract: 'ESZ6', side: 'buy', qty: 1, price: 5000, fee: 2, how: 'market', exit: false, bar: 0, life: 'L0' }] } };
  const r = retireFutures(withFut, now);
  const ft = futBookOf(r).trades;
  ok('an old futures position is closed at the last price the account saw, and a futures evaluation is ended with a note', ft.length === 1 && ft[0].avgOut === 5012 && r.status === 'ended' && /futures/i.test(r.statusWhy ?? ''), `${ft[0]?.avgOut} · ${r.status}`);
  ok('…its worth counts the old trade, and nothing new can trade on it', near(viewOf(r, market()).equity, 25_000 - 2 + 12 * 50, 0.01) && (optRefusal(r, market(), { contract: pageCall, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('over'));
}

/* ================= THE PLAN RULES (rules.ts) — on test plans, not any firm's ================= */
const plan = (rules: Partial<PropRules>, size = 50_000): PaperPlan => ({ id: 'test', label: `${size / 1000}K`, firm: 'Test', program: 'Test', size, rules: { ...NO_RULES, ...rules }, source: null });
const WED = addDays(TUE, 1);
const THU = addDays(TUE, 2);
const atm: ContractId = { ticker: 'SPY', strike: 500, right: 'C', expiry: EXP };
const buy = (a: PaperAccount, qty = 1, c: ContractId = atm) => optPlace(a, market(), { contract: c, side: 'buy', qty, kind: 'market' });
const sellAll = (a: PaperAccount, c: ContractId = atm) => optClose(a, market(), c, optBookOf(a).positions.find(p => p.contract.strike === c.strike && p.contract.expiry === c.expiry && p.contract.right === c.right)?.qty ?? 0);
const roll = (a: PaperAccount, day: string) => {
  now = dayEndsAt(day) + 60_000;
  return run(a, 0).account;
};

/* ---- the fee a plan states, and none where it states none ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  const f30 = buy(newAccount({ id: 'fee1', kind: 'evaluation', name: 'fee', startCash: 0, plan: plan({ fee: 0.3 }), now }), 2);
  const f0 = buy(newAccount({ id: 'fee2', kind: 'evaluation', name: 'fee', startCash: 0, plan: plan({ fee: null }), now }), 2);
  ok('a plan’s commission is charged a contract each side ($0.30 × 2); a plan that states none charges none', f30.opt.fills[0].fee === 0.6 && f0.opt.fills[0].fee === 0, `${f30.opt.fills[0].fee} · ${f0.opt.fills[0].fee}`);
  ok('a plan account starts at its size, its phase from the start', f30.startCash === 50_000 && f30.phase === 0 && f30.phaseStart?.equity === 50_000);
}

/* ---- what a buy may not do ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  const spread: ContractId = { ...atm, short: 510 };
  const today: ContractId = { ...atm, expiry: TUE };
  const a = newAccount({ id: 'r1', kind: 'evaluation', name: 'r', startCash: 0, plan: plan({ underlyings: ['SPY', 'QQQ'], spreads: false, zeroDte: false, maxContracts: 5, maxOpenPositions: 2, maxPositionCost: 3_000, buyingPower: 5_000 }), now });
  const ask = market().optQuote(atm).ask;
  const why = (d: Partial<Parameters<typeof optRefusal>[2]>, acct = a) => optRefusal(acct, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market', ...d }) ?? '';
  ok('a name off the plan’s list is refused, in words', why({ contract: { ...atm, ticker: 'IWM', strike: 220 } }).includes('SPY, QQQ only'));
  ok('a spread on a plan without spreads is refused', why({ contract: spread }).includes('does not allow spreads'));
  ok('a contract expiring today on a plan without 0DTE is refused', why({ contract: today }).includes('0DTE'));
  ok('more contracts than the plan’s cap is refused, resting buys counted', why({ qty: 6 }).includes('No more than 5 contracts') && why({ qty: 2 }, optPlace(a, market(), { contract: { ...atm, strike: 505 }, side: 'buy', qty: 4, kind: 'limit', price: 0.05 })).includes('this would be 6'));
  ok('one position past the plan’s $ cap is refused', why({ qty: Math.ceil(3_001 / (ask * 100)) }).includes('One position may cost no more than $3,000'), `ask ${ask}`);
  ok('a third position on a two-position plan is refused', why({ contract: { ...atm, strike: 520 } }, buy(buy(a, 1), 1, { ...atm, strike: 510 })).includes('No more than 2 positions'));
  const noIdx = newAccount({ id: 'r2', kind: 'evaluation', name: 'r', startCash: 0, plan: plan({ noSpreadsOn: ['SPX'] }), now });
  ok('single legs only on a name the plan names (SPX), spreads elsewhere fine', why({ contract: { ticker: 'SPX', strike: 5000, right: 'C', expiry: EXP, short: 5050 } }, noIdx).includes('only single calls and puts on SPX') && why({ contract: spread }, noIdx) === '');
  ok('a sell — a way out — is never refused by a rule', optRefusal(buy(a, 1), market(), { contract: atm, side: 'sell', qty: 1, kind: 'market' }) === null);
}

/* ---- the intraday trailing floor, and where it locks ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'dd1', kind: 'evaluation', name: 'dd', startCash: 0, plan: plan({ drawdown: { amount: 1_000, mode: 'intraday', lockAt: 0, on: 'equity' }, fee: 0 }), now });
  ok('the floor starts the allowance under the start', floorOf(a) === 49_000);
  a = buy(a, 10);
  px.SPY = 503;
  ({ account: a } = run(a));
  const peak = viewOf(a, market()).equity;
  ok('intraday: the high mark follows what the account is worth, open trades in — and the floor with it', a.peak === peak && floorOf(a) === Math.min(peak - 1_000, 50_000), `peak ${a.peak} · floor ${floorOf(a)}`);
  px.SPY = 510;
  ({ account: a } = run(a));
  ok('…until it reaches the start, where it locks', a.peak > 51_000 && floorOf(a) === 50_000 && readRules(a, viewOf(a, market()), market()).find(r => r.id === 'drawdown')!.says.includes('and has'));
  px.SPY = 470;
  let ev;
  ({ account: a, events: ev } = run(a));
  ok('worth at or under the floor: it fails at once, everything is closed by the rules, and the rule and the time are written down', a.status === 'failed' && a.statusRule === 'drawdown' && a.statusAt === now && optBookOf(a).positions.length === 0 && ev.some(e => e.kind === 'failed'), a.statusWhy);
  ok('a failed account takes nothing more', (optRefusal(a, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('failed'));
}

/* ---- the end-of-day floor: it moves only at the close; a breach still counts at once ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'dd2', kind: 'evaluation', name: 'dd', startCash: 0, plan: plan({ drawdown: { amount: 1_000, mode: 'eod', lockAt: null, on: 'equity' }, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 503;
  ({ account: a } = run(a));
  a = sellAll(a);
  ok('a winning day: the end-of-day floor has not moved yet', floorOf(a) === 49_000);
  const close = viewOf(a, market()).equity;
  a = roll(a, TUE);
  ok('at the close it follows the day’s close up (no lock: it keeps trailing)', a.peak === close && floorOf(a) === close - 1_000, `${floorOf(a)}`);
}

/* ---- a static floor ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'dd3', kind: 'evaluation', name: 'dd', startCash: 0, plan: plan({ drawdown: { amount: 1_000, mode: 'static', lockAt: null, on: 'equity' }, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 506;
  ({ account: a } = run(a));
  ok('a static floor never moves', floorOf(a) === 49_000);
}

/* ---- the drawdown on the balance: open trades do not breach it, closing them does ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'dd4', kind: 'evaluation', name: 'dd', startCash: 0, plan: plan({ drawdown: { amount: 500, mode: 'static', lockAt: null, on: 'balance' }, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 495;
  ({ account: a } = run(a));
  ok('on the balance: down on paper is not a breach', a.status === 'open' && viewOf(a, market()).equity < 49_500);
  a = sellAll(a);
  ({ account: a } = run(a));
  ok('…the close that makes it real is', a.status === 'failed' && a.statusRule === 'drawdown');
}

/* ---- the day's loss limit: a pause, and a fail ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'dl1', kind: 'evaluation', name: 'dl', startCash: 0, plan: plan({ dailyLoss: { amount: 500, from: 'balance', breach: 'pause' }, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 497;
  let ev;
  ({ account: a, events: ev } = run(a));
  ok('down past the day’s limit on a pausing plan: everything closed, the day is over — not a fail', a.status === 'open' && !!a.dayOver && optBookOf(a).positions.length === 0 && ev.some(e => e.kind === 'day-over'));
  ok('no way in for the rest of the day', (optRefusal(a, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('The day’s loss limit was reached'));
  a = roll(a, TUE);
  now = nyInstant(WED, 10 * 60);
  ok('the next trading day takes a way in again, measured from its own start', !a.dayOver && optRefusal(a, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market' }) === null && a.ledger[WED].bal === a.ledger[WED].open);
  let b = newAccount({ id: 'dl2', kind: 'evaluation', name: 'dl', startCash: 0, plan: plan({ dailyLoss: { amount: 500, from: 'balance', breach: 'fail' }, fee: 0 }), now });
  b = buy(b, 10);
  px.SPY = px.SPY - 3;
  ({ account: b } = run(b));
  ok('…and on a plan where it is a hard breach, the account fails on the daily rule', b.status === 'failed' && b.statusRule === 'daily');
  const c0 = newAccount({ id: 'dl3', kind: 'evaluation', name: 'dl', startCash: 0, plan: plan({ dailyLoss: { amount: 1, from: 'balance', breach: 'fail' }, fee: 0 }), now });
  ok('a buy whose spread alone would go through the day’s limit is refused before it is placed', (optRefusal(c0, market(), { contract: atm, side: 'buy', qty: 10, kind: 'market' }) ?? '').startsWith('This buy alone would put the day'));
}

/* ---- the target, and what it waits on ---- */
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't1', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 1_000 }], minDays: 2, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 506;
  ({ account: a } = run(a));
  ok('on the balance: an open winner does not pass', a.status === 'open' && viewOf(a, market()).equity - 50_000 > 1_000);
  a = sellAll(a);
  ({ account: a } = run(a));
  ok('closed over the target, one trading day of two: not yet', a.status === 'open' && readRules(a, viewOf(a, market()), market()).find(r => r.id === 'days')!.value === '1 of 2');
  a = roll(a, TUE);
  now = nyInstant(WED, 10 * 60);
  a = buy(a, 1);
  a = sellAll(a);
  ({ account: a } = run(a));
  ok('a fill on a second day: the target and the days both met — passed at once, with the rule and the time', a.status === 'passed' && a.statusRule === 'target' && a.statusAt === now, a.statusWhy);
  ok('a passed account takes nothing more', (optRefusal(a, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('passed'));
}
{
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't2', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 300 }], targetOn: 'flat', fee: 0 }), now });
  a = buy(a, 10);
  a = buy(a, 1, { ...atm, strike: 520 });
  px.SPY = 506;
  ({ account: a } = run(a));
  a = sellAll(a);
  ({ account: a } = run(a));
  ok('a plan that passes only flat: the balance is over the target, but something is still open — not yet', a.status === 'open' && viewOf(a, market()).balance - 50_000 > 300);
  a = sellAll(a, { ...atm, strike: 520 });
  ({ account: a } = run(a));
  ok('…flat, it passes', a.status === 'passed');
}
{
  /* the best day: Tuesday makes most of it — the profit needed rises to the best day ÷ the share */
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't3', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 500 }], consistency: { share: 0.5, of: 'day', strict: false }, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 504;
  ({ account: a } = run(a));
  a = sellAll(a);
  ({ account: a } = run(a));
  const tue = viewOf(a, market()).balance - 50_000;
  const t = readRules(a, viewOf(a, market()), market()).find(r => r.id === 'target')!;
  ok('one day made all of it: not passed — the target in effect is the best day ÷ 50%', a.status === 'open' && t.value.endsWith(`of $${Math.round(tue / 0.5).toLocaleString('en-US')}`), `${t.value} · Tue ${tue}`);
  a = roll(a, TUE);
  now = nyInstant(WED, 10 * 60);
  a = buy(a, 10);
  px.SPY = 508;
  ({ account: a } = run(a));
  a = sellAll(a);
  ({ account: a } = run(a));
  const wed = viewOf(a, market()).balance - 50_000 - tue;
  ok('a second day a little better: now it is the best day, and over half — still not', a.status === 'open' && wed > tue, `Tue ${tue} · Wed ${wed}`);
  a = roll(a, WED);
  now = nyInstant(THU, 10 * 60);
  a = buy(a, 10);
  px.SPY = 510;
  ({ account: a } = run(a));
  a = sellAll(a);
  ({ account: a } = run(a));
  const all = viewOf(a, market()).balance - 50_000;
  ok('a third day: no day over half the profit — passed', wed <= 0.5 * all && a.status === 'passed', `${a.status} · best ${wed} of ${all}`);
}
{
  /* the best trade, strictly under the share */
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't4', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 100 }], consistency: { share: 0.3, of: 'trade', strict: true }, minTrades: 3, fee: 0 }), now });
  for (let i = 0; i < 2; i++) {
    a = buy(a, 2);
    px.SPY += 1;
    ({ account: a } = run(a));
    a = sellAll(a);
  }
  ({ account: a } = run(a));
  ok('two trades of three: not yet, whatever the profit', a.status === 'open' && readRules(a, viewOf(a, market()), market()).find(r => r.id === 'trades')!.value === '2 of 3');
  for (let i = 0; i < 3; i++) {
    a = buy(a, 2);
    px.SPY += 1;
    ({ account: a } = run(a));
    a = sellAll(a);
    ({ account: a } = run(a));
  }
  const best = Math.max(...optBookOf(a).trades.map(t => t.pnl));
  const made = viewOf(a, market()).balance - 50_000;
  ok('five trades, the best under 30% of the profit: passed', a.status === (best < 0.3 * made ? 'passed' : 'open'), `best ${best} of ${made} · ${a.status}`);
}
{
  /* a winner held 15 seconds or less does not count */
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't5', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 200 }], minHoldSec: 15, fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 505;
  ({ account: a } = run(a, 10_000));
  a = sellAll(a);
  ({ account: a } = run(a));
  const quick = optBookOf(a).trades[0];
  ok('a winner held 10 seconds: its profit does not count toward the target', a.status === 'open' && quick.pnl > 200 && readRules(a, viewOf(a, market()), market()).find(r => r.id === 'hold')!.value.includes('not counted'), `${quick.pnl}`);
  a = buy(a, 10);
  px.SPY = 510;
  ({ account: a } = run(a, 20_000));
  a = sellAll(a);
  ({ account: a } = run(a));
  ok('one held 20 seconds counts — passed', a.status === 'passed');
}
{
  /* profitable days of at least $X */
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't6', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 100 }], profitableDays: { count: 2, min: 250 }, fee: 0 }), now });
  const winDay = (day: string, up: number) => {
    now = nyInstant(day, 10 * 60);
    ({ account: a } = run(a, 0));
    a = buy(a, 10);
    px.SPY += up;
    ({ account: a } = run(a));
    a = sellAll(a);
    ({ account: a } = run(a));
  };
  winDay(TUE, 3);
  ok('one day of $250 or more of two: not yet', a.status === 'open');
  a = roll(a, TUE);
  winDay(WED, 3);
  ok('a second: passed', a.status === 'passed');
}
{
  /* two phases: the second starts from the balance the first passed at */
  now = nyInstant(TUE, 10 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 't7', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Step 1', target: 300 }, { name: 'Step 2', target: 300 }], fee: 0 }), now });
  a = buy(a, 10);
  px.SPY = 505;
  ({ account: a } = run(a));
  a = sellAll(a);
  ({ account: a } = run(a));
  const bal = viewOf(a, market()).balance;
  ok('step 1 passed: on to step 2, measured from the balance it passed at', a.status === 'open' && a.phase === 1 && a.phaseStart?.equity === bal, `${a.phase} · ${a.phaseStart?.equity} · ${bal}`);
}
{
  /* the time limit */
  now = nyInstant(TUE, 10 * 60);
  let a = newAccount({ id: 't8', kind: 'evaluation', name: 't', startCash: 0, plan: plan({ phases: [{ name: 'Evaluation', target: 5_000 }], timeLimitDays: 2, fee: 0 }), now });
  a = buy(a, 1);
  a = sellAll(a);
  a = roll(a, TUE);
  a = roll(a, WED);
  ok('two calendar days still within it', a.status === 'open');
  a = roll(a, THU);
  ok('a third without the target: failed on the time limit, at the roll', a.status === 'failed' && a.statusRule === 'time');
}

/* ---- flat by: a flat-by time, nothing past the close, an expiring contract's close ---- */
{
  now = nyInstant(TUE, 15 * 60);
  px.SPY = 500;
  let a = newAccount({ id: 'f1', kind: 'evaluation', name: 'f', startCash: 0, plan: plan({ flatBy: '15:55', overnight: false, fee: 0 }), now });
  a = buy(a, 2);
  a = optPlace(a, market(), { contract: { ...atm, strike: 505 }, side: 'buy', qty: 1, kind: 'limit', price: 0.05 });
  now = nyInstant(TUE, 15 * 60 + 55);
  let ev;
  ({ account: a, events: ev } = run(a, 0));
  const shut = optBookOf(a).trades[0];
  ok('at 15:55 everything open is closed by the rules at the bid, and said', optBookOf(a).positions.length === 0 && shut?.how === 'rule' && ev.some(e => e.kind === 'flat'), shut?.note);
  ok('…and from then no way in until the next session', (optRefusal(a, market(), { contract: atm, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('It is past the plan’s close'));
  ({ account: a } = run(a));
  ok('a resting buy that would fill after it is cancelled with the reason', a.opt.orders.find(o => o.kind === 'limit')!.status === 'working' || /past the plan/.test(a.opt.orders.find(o => o.kind === 'limit')!.why ?? ''));
  const b0 = newAccount({ id: 'f2', kind: 'evaluation', name: 'f', startCash: 0, plan: plan({ overnight: false, fee: 0 }), now: nyInstant(TUE, 15 * 60) });
  now = nyInstant(TUE, 15 * 60);
  let b = buy(b0, 1);
  now = nyInstant(TUE, 15 * 60 + 59);
  ({ account: b } = run(b, 0));
  ok('no overnight, no flat-by time: closed at 15:59, a minute before the bell', optBookOf(b).positions.length === 0 && optBookOf(b).trades[0].how === 'rule');
  now = nyInstant(TUE, 15 * 60);
  let c = newAccount({ id: 'f3', kind: 'evaluation', name: 'f', startCash: 0, plan: plan({ expiryClose: '15:55', fee: 0 }), now });
  c = buy(c, 1, { ...atm, expiry: TUE });
  c = buy(c, 1);
  now = nyInstant(TUE, 15 * 60 + 55);
  ({ account: c } = run(c, 0));
  ok('an expiring contract is closed at the plan’s time on its expiry day — the others stay', optBookOf(c).positions.length === 1 && optBookOf(c).positions[0].contract.expiry === EXP && optBookOf(c).trades[0].contract.expiry === TUE);
  const w = newAccount({ id: 'f4', kind: 'evaluation', name: 'f', startCash: 0, plan: plan({ weekend: false, fee: 0 }), now: nyInstant('2026-09-25', 15 * 60) });
  now = nyInstant('2026-09-25', 15 * 60);
  let x = buy(w, 1);
  now = nyInstant('2026-09-25', 15 * 60 + 59);
  ({ account: x } = run(x, 0));
  ok('no weekend holds: on a Friday everything is closed at 15:59', optBookOf(x).positions.length === 0);
}

/* ---- the firms' plans as data ---- */
{
  const plans = PROP_FIRMS.flatMap(f => f.plans.map(p => ({ f, p })));
  ok('every firm plan names its firm, its source page and the date it was read', plans.every(({ f, p }) => p.firm === f.name && !!p.source?.url.startsWith('https://') && /^2026-\d\d-\d\d$/.test(p.source.asOf) && /^https:\/\//.test(f.url)));
  ok('every firm plan has a target and a floor, in whole dollars of its size', plans.every(({ p }) => p.rules.phases.every(ph => ph.target == null || (ph.target > 0 && ph.target < p.size)) && !!p.rules.drawdown && p.rules.drawdown.amount < p.size));
  ok('no two plans share an id', new Set(plans.map(x => x.p.id)).size === plans.length);
}

/* ================= an expiry settles on its own day's close ================= */
{
  const WED = '2026-09-23';
  now = nyInstant(WED, 15 * 60);
  px.SPY = 505;
  let e = newAccount({ id: 'p7', kind: 'practice', name: 'Expiry', startCash: 25_000, now });
  const c: ContractId = { ticker: 'SPY', strike: 500, right: 'C', expiry: WED };
  e = optPlace(e, market(), { contract: c, side: 'buy', qty: 1, kind: 'market' });
  /* the page is next open the morning after: the name is elsewhere now, and the close is not known yet */
  now = nyInstant('2026-09-24', 9 * 60 + 45);
  px.SPY = 490;
  const blind: PaperMarket = { ...market(), closeOf: () => NaN };
  e = tick(e, blind).account;
  ok('an expired contract waits to settle until its day’s close is known — it never settles on the price of the next morning', optBookOf(e).positions.length === 1 && optBookOf(e).trades.length === 0);
  /* the 16:00 close on the expiry day was 503.40: the 500 call settles at 3.40, with no fee */
  e = tick(e, { ...market(), closeOf: (t, d) => (t === 'SPY' && d === WED ? 503.4 : NaN) }).account;
  const done = optBookOf(e).trades[0];
  ok('…and settles at what it was worth in the money at that close', done?.how === 'expired' && done.avgOut === 3.4 && e.opt.fills[1].fee === 0, `${done?.avgOut}`);
}

/* ================= the minutes a resting order missed, replayed from the minute history ================= */
{
  const DAY = '2026-09-24';
  now = nyInstant(DAY, 10 * 60);
  px.SPY = 500;
  let r = newAccount({ id: 'p8', kind: 'practice', name: 'Away', startCash: 25_000, now });
  const c: ContractId = { ticker: 'SPY', strike: 500, right: 'C', expiry: '2026-10-16' };
  r = optPlace(r, market(), { contract: c, side: 'buy', qty: 1, kind: 'market' });
  const paid = r.opt.fills[0].price;
  /* a target at paid + 1.00, placed at 10:00, then the reader is on a page that reads no option quotes until 11:00 */
  r = optPlace(r, market(), { contract: c, side: 'sell', qty: 1, kind: 'limit', price: +(paid + 1).toFixed(2) });
  const target = r.opt.orders.find(o => o.status === 'working')!;
  now = nyInstant(DAY, 11 * 60);
  ok('an order unjudged for over a minute and a half has a gap, from when it was placed', gapOf(target, now) === target.placed.at);
  /* back: the live tick does not judge it on 11:00's quote — its missed minutes come first */
  px.SPY = 520;
  r = tick(r, market()).account;
  ok('the live tick leaves an order with a gap alone, even where the quote now would fill it', r.opt.orders.find(o => o.id === target.id)!.status === 'working');
  /* the minute history: the bid is paid + 0.40 until 10:20, paid + 1.10 at 10:21 (minute 50), paid + 2.00 after;
     SPY's bars at 505 */
  const bid = new Array(390).fill(NaN);
  const ask = new Array(390).fill(NaN);
  for (let m = 0; m < 390; m++) {
    const b = m < 50 ? paid + 0.4 : m === 50 ? paid + 1.1 : paid + 2;
    bid[m] = +b.toFixed(2);
    ask[m] = +(b + 0.1).toFixed(2);
  }
  const fetched: Fetched = { quotes: new Map([[`${legKey(c)}|${DAY}`, { bid, ask }]]), bars: new Map([[`SPY|${DAY}`, new Array(390).fill(505)]]), failed: new Map() };
  r = replayGaps(r, fetched, now, 'L1');
  const sold = r.opt.fills.find(f => f.side === 'sell');
  /* minute 50 ends at 10:21:00: the first bid at or over the target, sold at that bid */
  ok('replayed: it fills at the first missed minute whose bid reaches it, at that bid', !!sold && sold.price === +(paid + 1.1).toFixed(2) && sold.how === 'limit', `${sold?.price}`);
  ok('…stamped with that minute’s end, 10:21 New York', !!sold && sold.at.at === nyInstant(DAY, 10 * 60 + 21));
  /* the same gap, with the history not to be had: the order stays working and says so */
  let u = newAccount({ id: 'p10', kind: 'practice', name: 'Unread', startCash: 25_000, now: nyInstant(DAY, 10 * 60) });
  now = nyInstant(DAY, 10 * 60);
  u = optPlace(u, market(), { contract: c, side: 'buy', qty: 1, kind: 'market' });
  u = optPlace(u, market(), { contract: c, side: 'sell', qty: 1, kind: 'limit', price: 99 });
  now = nyInstant(DAY, 11 * 60);
  const none: Fetched = { quotes: new Map(), bars: new Map(), failed: new Map([[u.opt.orders.find(o => o.status === 'working')!.id, { why: 'ThetaData has no history for those minutes', again: false }]]) };
  u = replayGaps(u, none, now, 'L1');
  const left = u.opt.orders.find(o => o.kind === 'limit')!;
  ok('without the history it stays working, says which minutes were not judged, and the live tick takes it from now', left.status === 'working' && left.unjudged?.why === 'ThetaData has no history for those minutes' && left.unjudged.from === left.placed.at && gapOf(left, now) == null);
}

console.log(`\n${passed} held · ${failed} missed`);
if (failed) process.exit(1);
