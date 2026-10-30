/*
  PAPER — THE ENGINE AGAINST ITS RULES (options only)

  A made-up market handed to the engine one tick at a time: the names' prices are set by hand, the clock is set by hand,
  and every rule is walked and checked — the practice account's (fills, fees, the bell, the page), and the plan rules a
  prop-firm account runs on (data/paper/rules.ts), on test plans whose numbers are this file's own, not any firm's.
  Run: npx tsx scripts/paper-proof.ts (npm run review:proof runs it with the backtest's).
*/

import { addDays, dayBeginsAt, dayEndsAt, nyAt, nyInstant, tradingDayOf, yearsToExpiry } from '../src/data/paper/clock';
import { bankedOf, closeStale, comboNatural, comboRefusal, endAccount, flattenAll, futBookOf, newAccount, optBookOf, optCancel, optClose, optPlace, optPlaceCombo, optRefusal, retireFutures, tick, viewOf, type PaperAccount, type PaperMarket } from '../src/data/paper/engine';
import { NO_RULES, floorOf, readRules, ruleRefusal, type PaperPlan, type PropRules } from '../src/data/paper/rules';
import { CUSTOM_DEFAULTS, PROP_FIRMS, customPlan, planById } from '../src/data/paper/propFirms';
import { marginOf } from '../src/data/paper/margin';
import { OPTIONS_FUNDING_WHITELIST } from '../src/data/paper/whitelists';
import { optionsOpen } from '../src/data/paper/feed';
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
  let c = newAccount({ id: 'f3', kind: 'evaluation', name: 'f', startCash: 0, plan: plan({ expiryClose: { at: '15:55', except: ['QQQ'] }, fee: 0 }), now });
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

/* ================================================================== */
/*  SELLING (2026-10-29): shorts, spreads sold, iron condors, margin, expiry, and what each firm's plan allows           */
/* ================================================================== */
{
  /* A market of fixed quotes, every number typed here, so each figure below is worked by hand */
  const T = '2026-09-22';
  const E2 = '2026-10-02';
  now = nyInstant(T, 10 * 60);
  const spot: Record<string, number> = { SPY: 500, IWM: 220, SPX: 5000 };
  const book: Record<string, [number, number]> = {
    'SPY|500|P': [5.0, 5.2],
    'SPY|495|P': [3.4, 3.5],
    'SPY|490|P': [2.0, 2.1],
    'SPY|485|P': [1.4, 1.5],
    'SPY|480|P': [1.0, 1.1],
    'SPY|505|C': [4.0, 4.2],
    'SPY|510|C': [3.0, 3.1],
    'SPY|515|C': [1.8, 1.9],
    'SPY|520|C': [1.0, 1.1],
    'IWM|210|P': [1.5, 1.6],
    'SPX|5000|C': [80.0, 81.0],
    'SPX|5050|C': [55.0, 56.0],
  };
  const leg = (t: string, k: number, r: 'C' | 'P') => {
    const q = book[`${t}|${k}|${r}`];
    const s0 = spot[t];
    const intrinsic = Math.max(0, r === 'C' ? s0 - k : k - s0);
    if (!q) return { bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic, dead: true, spot: s0 };
    return { bid: q[0], ask: q[1], mark: Math.round(((q[0] + q[1]) / 2) * 100) / 100, iv: 0.2, delta: r === 'C' ? 0.4 : -0.4, gamma: 0, theta: -0.05, vega: 0, rho: 0, intrinsic, dead: !(q[0] > 0), spot: s0 };
  };
  const fixedQuote = (c: ContractId) => {
    if (c.short == null) return leg(c.ticker, c.strike, c.right);
    const b = leg(c.ticker, c.strike, c.right);
    const s1 = leg(c.ticker, c.short, c.right);
    const w = Math.abs(c.short - c.strike);
    const inside = (v: number) => Math.max(0, Math.min(w, v));
    const bid = Math.round(inside(b.bid - s1.ask) * 100) / 100;
    const ask = Math.round(Math.max(bid + 0.01, inside(b.ask - s1.bid)) * 100) / 100;
    return { ...b, bid, ask, mark: Math.round(((bid + ask) / 2) * 100) / 100, dead: b.dead || s1.dead || bid <= 0 };
  };
  const fixed = (): PaperMarket => ({ now, life: 'L1', optQuote: fixedQuote, optQuoteAt: fixedQuote, bar: () => Math.floor(now / 1000), candles: () => [], open: () => optionsOpen(now), fresh: () => true, closeOf: (t: string) => spot[t] });
  const P = (k: number, t = 'SPY'): ContractId => ({ ticker: t, strike: k, right: 'P', expiry: E2 });
  const Cc = (k: number, t = 'SPY'): ContractId => ({ ticker: t, strike: k, right: 'C', expiry: E2 });
  const fresh = (cash = 25_000, id = 's') => newAccount({ id, kind: 'practice', name: id, startCash: cash, now });

  /* ---- a naked put: sold at the bid, bought back at the ask ---- */
  let a = fresh();
  a = optPlace(a, fixed(), { contract: P(490), side: 'sell', qty: 2, kind: 'market' });
  let v = viewOf(a, fixed());
  ok('a sell with nothing held opens a short, at once, at the bid (490P: 2.00)', a.opt.fills.length === 1 && a.opt.fills[0].price === 2 && a.opt.fills[0].opens === true && optBookOf(a).positions[0]?.dir === -1 && optBookOf(a).positions[0]?.qty === 2);
  ok('…the premium comes into cash, less the fee: 25,000 + 2.00 × 100 × 2 − 1.30 = 25,398.70', near(v.cash, 25_398.7));
  ok('…worth counts it at the mark as owed: 25,398.70 − 2.05 × 200 = 24,988.70', near(v.equity, 24_988.7), `${v.equity}`);
  /* Reg T, a put: the greater of 20% × 500 − 10 out of the money + 2.05 = 92.05, or 10% × 490 + 2.05 = 51.05 → 9,205 a contract */
  ok('Reg T on a naked put: (20% × 500 − 10 OTM + 2.05 premium) × 100 = 9,205 a contract — 18,410 held for 2, 18,010 of the reader’s own', near(v.marginReq, 18_410) && near(v.margin, 18_010) && v.marginLines[0]?.kind === 'naked', `${v.marginReq} · ${v.margin}`);
  ok('…and free is cash less all it holds: 25,398.70 − 18,410 = 6,988.70', near(v.free, 6_988.7), `${v.free}`);
  ok('…it is said to be an estimate', /estimate/.test(v.marginLines[0]?.words ?? '') && /broker/.test(v.marginLines[0]?.words ?? ''));
  ok('a short is never bought back past flat: 3 of a short 2 is refused, in words', (optRefusal(a, fixed(), { contract: P(490), side: 'buy', qty: 3, kind: 'market' }) ?? '').startsWith('You hold 2 short'));
  a = optClose(a, fixed(), P(490), 2);
  const shortTrade = optBookOf(a).trades[0];
  ok('a short is bought back at the ask (2.10)', a.opt.fills[1]?.side === 'buy' && a.opt.fills[1].price === 2.1 && optBookOf(a).positions.length === 0);
  ok('…the trade: sold 2.00, bought back 2.10, (2.00 − 2.10) × 200 − 2.60 fees = −22.60, ended “closed”, marked short', shortTrade?.pnl === -22.6 && shortTrade.how === 'closed' && shortTrade.short === true && shortTrade.avgIn === 2 && shortTrade.avgOut === 2.1, `${shortTrade?.pnl}`);
  ok('…its R is on what it held when it opened (the Reg T estimate less the premium)', !!shortTrade && shortTrade.cost > 9_000 && near(shortTrade.r, shortTrade.pnl / shortTrade.cost, 1e-9), `${shortTrade?.cost}`);

  /* ---- a naked call, and the floors of the formula ---- */
  let c1 = optPlace(fresh(), fixed(), { contract: Cc(510), side: 'sell', qty: 1, kind: 'market' });
  ok('Reg T on a naked call: 20% × 500 − 10 OTM + 3.05 = 93.05 → 9,305', near(viewOf(c1, fixed()).marginReq, 9_305), `${viewOf(c1, fixed()).marginReq}`);
  const mq = (bid: number, ask: number, s0: number) => ({ bid, ask, mark: (bid + ask) / 2, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead: false, spot: s0 });
  const farPut = marginOf([{ key: 'k', contract: { ticker: 'SPY', strike: 400, right: 'P', expiry: E2 }, dir: -1, qty: 1, avg: 0.1, quote: mq(0.09, 0.11, 500), spotIn: 500 }]);
  ok('…far out of the money the floor holds: 10% × the 400 strike + 0.10 = 40.10 → 4,010 (20% × 500 − 100 + 0.10 is only 0.10)', near(farPut.req, 4_010), `${farPut.req}`);
  const farCall = marginOf([{ key: 'k', contract: { ticker: 'SPY', strike: 600, right: 'C', expiry: E2 }, dir: -1, qty: 1, avg: 0.1, quote: mq(0.09, 0.11, 500), spotIn: 500 }]);
  ok('…a call’s floor is 10% of the name: 10% × 500 + 0.10 = 50.10 → 5,010', near(farCall.req, 5_010), `${farCall.req}`);
  const spxCall = marginOf([{ key: 'k', contract: { ticker: 'SPX', strike: 5100, right: 'C', expiry: E2 }, dir: -1, qty: 1, avg: 20, quote: mq(20, 20.4, 5000), spotIn: 5000 }]);
  ok('an index (SPX) is 15% / 10%: 15% × 5,000 − 100 OTM + 20.20 = 670.20 → 67,020', near(spxCall.req, 67_020) && /index/.test(spxCall.lines[0].words), `${spxCall.req}`);
  ok('…and SPX’s own floor: 10% × 5,000 + premium, where that is more', near(marginOf([{ key: 'k', contract: { ticker: 'SPX', strike: 6000, right: 'C', expiry: E2 }, dir: -1, qty: 1, avg: 1, quote: mq(0.9, 1.1, 5000), spotIn: 5000 }]).req, 50_100));

  /* ---- a credit spread: sell the 500P, buy the 490P, one order ---- */
  let cs = fresh();
  const bullPut: ContractId = { ...P(500), short: 490 };
  const free0 = viewOf(cs, fixed()).free;
  cs = optPlace(cs, fixed(), { contract: bullPut, side: 'sell', qty: 1, kind: 'market' });
  v = viewOf(cs, fixed());
  ok('a put spread sold fills at its bid: 500P bid 5.00 less 490P ask 2.10 = 2.90 (sell at the bid, buy at the ask)', cs.opt.fills[0]?.price === 2.9 && optBookOf(cs).positions[0]?.dir === -1);
  ok('…it holds its width, 10 × 100 = 1,000 — with the 290 credit in, 710 held: its whole loss', near(v.marginReq, 1_000) && near(v.margin, 710) && v.marginLines[0]?.kind === 'credit', `${v.marginReq} · ${v.margin}`);
  ok('…free falls by exactly the most it can lose, fees in: 1,000 − 290 + 1.30 = 711.30', near(free0 - v.free, 711.3), `${free0 - v.free}`);
  ok('…its R is measured on that 710', near(optBookOf(cs).positions[0].held, 710));

  /* ---- an iron condor: two spreads sold as one order ---- */
  let ic = fresh(25_000, 'ic');
  const putSide: ContractId = { ...P(490), short: 480 };
  const callSide: ContractId = { ...Cc(510), short: 515 };
  ok('its legs at the market now: (2.00 − 1.10) + (3.00 − 1.90) = 2.00 a set', comboNatural(fixed(), [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }]) === 2);
  ic = optPlaceCombo(ic, fixed(), { name: 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: 2, kind: 'market' });
  v = viewOf(ic, fixed());
  ok('an iron condor at the market: every leg fills at once — the put spread at 0.90, the call spread at 1.10', ic.opt.fills.length === 2 && ic.opt.fills[0].price === 0.9 && ic.opt.fills[1].price === 1.1 && ic.opt.fills.every(f => f.combo && f.comboName === 'Iron condor'));
  ok('…it holds the wider side once: max(10, 5) × 100 × 2 = 2,000 — less the 400 credit, 1,600 held: its whole loss', near(v.marginReq, 2_000) && near(v.margin, 1_600) && v.marginLines.length === 1 && v.marginLines[0].kind === 'condor', `${v.marginReq} · ${v.margin}`);
  ok('…cash takes in the credit, less $0.65 on each of 8 legs: 25,000 + 400 − 5.20', near(v.cash, 25_394.8), `${v.cash}`);
  /* a condor that waits for its net */
  let icl = optPlaceCombo(fresh(25_000, 'icl'), fixed(), { name: 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: 1, kind: 'limit', net: 2.2 });
  ok('an iron condor limit at a 2.20 credit waits while the legs bring in 2.00', icl.opt.orders.filter(o => o.status === 'working' && o.combo).length === 2 && icl.opt.fills.length === 0);
  ({ account: icl } = (() => {
    step(1500);
    return tick(icl, fixed());
  })());
  ok('…still waiting a tick on, nothing filled', icl.opt.fills.length === 0);
  book['SPY|490|P'] = [2.2, 2.3];
  step(1500);
  icl = tick(icl, fixed()).account;
  ok('…the 490P bids 2.20: the legs bring in 2.20 — both spreads fill together, at their own bids (1.10 and 1.10)', icl.opt.fills.length === 2 && icl.opt.fills[0].price === 1.1 && icl.opt.fills[1].price === 1.1, icl.opt.fills.map(f => f.price).join(' · '));
  book['SPY|490|P'] = [2.0, 2.1];
  const icCancel = optCancel(optPlaceCombo(fresh(25_000, 'icc'), fixed(), { name: 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: 1, kind: 'limit', net: 3 }), fixed(), 'o2');
  ok('cancelling one leg of an order of several cancels all of it', icCancel.opt.orders.every(o => o.status === 'cancelled'));

  /* ---- a cash-secured put ---- */
  const csp: ContractId = P(210, 'IWM');
  let pu = optPlace(fresh(), fixed(), { contract: csp, side: 'sell', qty: 1, kind: 'market', secured: 'cash' });
  v = viewOf(pu, fixed());
  ok('a cash-secured put holds the strike: 210 × 100 = 21,000 — with the 150 premium in, 20,850, its whole loss', near(v.marginReq, 21_000) && near(v.margin, 20_850) && v.marginLines[0].kind === 'csp' && pu.opt.fills[0].secured === 'cash', `${v.marginReq}`);
  ok('a cash-secured put the account cannot cover is refused, in words: 490 × 100 − 200 + 0.65 = 48,800.65', (optRefusal(fresh(), fixed(), { contract: P(490), side: 'sell', qty: 1, kind: 'market', secured: 'cash' }) ?? '') === 'Not enough buying power — this holds $48,800.65, and $25,000.00 is free');
  ok('…a sold put is added to the way it is held: on margin, onto a cash-secured one, is refused', (optRefusal(pu, fixed(), { contract: csp, side: 'sell', qty: 1, kind: 'market' }) ?? '').startsWith('You hold this put cash-secured'));
  ok('…and covered calls are not offered: the desk holds no stock (a call sold against a long call is a spread)', (() => {
    let h = optPlace(fresh(), fixed(), { contract: Cc(515), side: 'buy', qty: 1, kind: 'market' });
    h = optPlace(h, fixed(), { contract: Cc(510), side: 'sell', qty: 1, kind: 'market' });
    const line = viewOf(h, fixed()).marginLines[0];
    /* sold the 510C under a long 515C: the pair can lose the 5 between them — 500 held, less the 3.00 premium */
    return line?.kind === 'covered' && near(line.req, 500) && near(line.held, 200);
  })());

  /* ---- sells and buy-backs that wait ---- */
  let w = optPlace(fresh(), fixed(), { contract: Cc(505), side: 'sell', qty: 1, kind: 'limit', price: 4.1 });
  ok('a sell to open that waits for 4.10 does not fill while the bid is 4.00', w.opt.fills.length === 0 && w.opt.orders[0].opens === true);
  book['SPY|505|C'] = [4.15, 4.3];
  step(1500);
  w = tick(w, fixed()).account;
  ok('…the bid reaches 4.15: it fills at that bid, never under the limit', w.opt.fills[0]?.price === 4.15 && optBookOf(w).positions[0]?.dir === -1);
  w = optPlace(w, fixed(), { contract: Cc(505), side: 'buy', qty: 1, kind: 'limit', price: 4.0 });
  ok('a buy back that waits at 4.00 is a way out (it opens nothing)', w.opt.orders[1].opens === false && w.opt.orders[1].status === 'working');
  book['SPY|505|C'] = [3.8, 3.95];
  step(1500);
  w = tick(w, fixed()).account;
  ok('…the ask comes down to 3.95: bought back at that ask', w.opt.fills[1]?.price === 3.95 && optBookOf(w).positions.length === 0 && optBookOf(w).trades[0].pnl === Math.round(((4.15 - 3.95) * 100 - 1.3) * 100) / 100);
  book['SPY|505|C'] = [4.0, 4.2];

  /* ---- after the bell the feed's last quotes still read as new: a resting order does not fill on them ---- */
  {
    now = nyInstant(T, 15 * 60 + 30);
    let x = optPlace(fresh(25_000, 'ah'), fixed(), { contract: Cc(505), side: 'sell', qty: 1, kind: 'limit', price: 4.1 });
    book['SPY|505|C'] = [4.3, 4.4];
    now = nyInstant(T, 16 * 60 + 30);
    x = tick(x, fixed()).account;
    ok('16:30: a sell limit the last quote would fill waits — nothing fills outside the session', x.opt.fills.length === 0 && x.opt.orders[0].status === 'working');
    now = nyInstant(addDays(T, 1), 9 * 60 + 31);
    ok('…by the next session it has a gap: its minutes are replayed from the history first (catchUp.ts), the session’s only', gapOf(x.opt.orders[0], now) != null);
    book['SPY|505|C'] = [4.0, 4.2];
    now = nyInstant(T, 10 * 60);
  }

  /* ---- the margin call: equity under what the shorts need blocks new ways in, and nothing is sold off by itself ---- */
  let mc = optPlace(fresh(10_000, 'mc'), fixed(), { contract: P(490), side: 'sell', qty: 1, kind: 'market' });
  ok('a $10,000 account sells one naked 490P: 9,205 held, 994.35 free', near(viewOf(mc, fixed()).free, 994.35) && !viewOf(mc, fixed()).marginCall, `${viewOf(mc, fixed()).free}`);
  spot.SPY = 450;
  book['SPY|490|P'] = [41.0, 41.4];
  v = viewOf(mc, fixed());
  /* now 20% × 450 − 0 (in the money) + 41.20 = 131.20 → 13,120: free 10,199.35 − 13,120 = −2,920.65 */
  ok('SPY falls to 450: the put re-marks to 13,120 held and free is −2,920.65 — a margin call', near(v.marginReq, 13_120) && near(v.free, -2_920.65) && v.marginCall, `${v.marginReq} · ${v.free}`);
  ok('…a new way in is refused with the margin call in words', (optRefusal(mc, fixed(), { contract: Cc(510), side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('Margin call'));
  ok('…a way out is not: the put can be bought back', optRefusal(mc, fixed(), { contract: P(490), side: 'buy', qty: 1, kind: 'market' }) === null);
  step(1500);
  mc = tick(mc, fixed()).account;
  ok('…and nothing is closed by itself on a practice account', optBookOf(mc).positions.length === 1);
  spot.SPY = 500;
  book['SPY|490|P'] = [2.0, 2.1];

  /* ---- what each firm's plan allows (propFirms.ts) ---- */
  const on = (planId: string) => newAccount({ id: planId, kind: 'evaluation', name: planId, startCash: 0, plan: planById(planId)!, now });
  const say = (acct: PaperAccount, d: Partial<Parameters<typeof optRefusal>[2]>) => optRefusal(acct, fixed(), { contract: P(490), side: 'sell', qty: 1, kind: 'market', ...d }) ?? '';
  for (const id of ['of-growth-25k', 'of-express-25k', 'sx-strix-25k', 'sx-express-25k', 'vq-basic-50k', 'vq-rapid-express-50k', 'vq-rapid-elite-50k', 'tf-prop-25k']) ok(`${id}: a sale to open is refused — buy only, in words`, say(on(id), {}).startsWith('This plan buys only'), say(on(id), {}));
  ok('of-growth: the credit spread too', say(on('of-growth-25k'), { contract: bullPut }).startsWith('This plan buys only'));
  ok('Options Funding: a name off its 275-name whitelist is refused (NDX)', (ruleRefusal(on('of-growth-25k'), fixed(), { contract: { ticker: 'NDX', strike: 20000, right: 'C', expiry: E2 }, side: 'buy', qty: 1, kind: 'market' }, viewOf(on('of-growth-25k'), fixed()), 1) ?? '').includes('the 275 names on the firm’s list (as of 2026-10-29) only — NDX is not on it'));
  ok('…the names on it pass, written either way (SPY; BRK.B is its BRKB)', ruleRefusal(on('of-growth-25k'), fixed(), { contract: Cc(510), side: 'buy', qty: 1, kind: 'market' }, viewOf(on('of-growth-25k'), fixed()), 3.1) === null && !(ruleRefusal(on('of-growth-25k'), fixed(), { contract: { ticker: 'BRK.B', strike: 500, right: 'C', expiry: E2 }, side: 'buy', qty: 1, kind: 'market' }, viewOf(on('of-growth-25k'), fixed()), 1) ?? '').includes('not on it'));
  ok('the whitelist is data with its source: 275 names, optionsfunding.co, read 2026-10-29', OPTIONS_FUNDING_WHITELIST.names.length === 275 && new Set(OPTIONS_FUNDING_WHITELIST.names).size === 275 && OPTIONS_FUNDING_WHITELIST.url === 'https://optionsfunding.co/ticker-whitelist' && planById('of-express-50k')!.rules.underlyings === OPTIONS_FUNDING_WHITELIST.names && planById('sx-strix-25k')!.rules.underlyings === null);
  const pro = on('sx-pro-50k');
  ok('Strix Pro: a credit spread is taken (a capped loss)', say(pro, { contract: bullPut }) === '');
  ok('…a call sold on its own is refused — no cap on its loss', say(pro, { contract: Cc(510) }).includes('sells only with a capped loss'));
  ok('…a put sold is cash-secured, whatever the ticket asked', (() => {
    const x = optPlace(on('sx-pro-100k'), fixed(), { contract: P(490), side: 'sell', qty: 1, kind: 'market' });
    return x.opt.fills[0]?.secured === 'cash' && viewOf(x, fixed()).marginLines[0]?.kind === 'csp';
  })());
  ok('…a call sold against a long call held on the same expiry is taken, and the long cannot be sold out from under it', (() => {
    let x = optPlace(pro, fixed(), { contract: Cc(515), side: 'buy', qty: 1, kind: 'market' });
    const sold = optRefusal(x, fixed(), { contract: Cc(510), side: 'sell', qty: 1, kind: 'market' });
    x = optPlace(x, fixed(), { contract: Cc(510), side: 'sell', qty: 1, kind: 'market' });
    return sold === null && (optRefusal(x, fixed(), { contract: Cc(515), side: 'sell', qty: 1, kind: 'market' }) ?? '').startsWith('That long call caps a call you sold');
  })());
  ok('…and an iron condor', comboRefusal(pro, fixed(), { name: 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: 1, kind: 'market' }) === null);
  const adv = on('vq-advanced-50k');
  ok('Vanquish Advanced (Level 4): a credit spread on SPY is taken', say(adv, { contract: bullPut }) === '');
  ok('…an iron condor on SPY is taken', comboRefusal(adv, fixed(), { name: 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: 1, kind: 'market' }) === null);
  ok('…a naked call is refused: Level 4 here has no margin', say(adv, { contract: Cc(510) }).startsWith('Level 4 here is cash only'));
  ok('…on SPX it buys single legs only: a call spread sold is refused', say(adv, { contract: { ...Cc(5000, 'SPX'), short: 5050 } }).startsWith('This plan allows only single calls and puts on SPX, bought'));
  ok('…every Vanquish plan buys SPX, XSP and VIX single legs only — bought, a single call is fine', optRefusal(on('vq-basic-50k'), fixed(), { contract: Cc(5000, 'SPX'), side: 'buy', qty: 1, kind: 'market' }) === null && planById('vq-basic-50k')!.rules.longOnlyOn?.join() === 'SPX,XSP,VIX');
  ok('the plans’ selling, as data: Vanquish Advanced Level 4, Strix Pro defined risk, every other plan buy only', PROP_FIRMS.flatMap(f => f.plans).every(p => p.rules.allowSell === (p.id.startsWith('vq-advanced') ? 'level4' : p.id.startsWith('sx-pro') ? 'definedRisk' : 'none')));
  ok('…and the notes that said they were not checked are gone', PROP_FIRMS.flatMap(f => f.plans).every(p => !(p.notModelled ?? []).some(n => /selling to open|finite-loss|275-name ticker whitelist|16:10/.test(n))));
  ok('practice accounts sell everything (no plan); the reader’s own rules default to everything too', optRefusal(fresh(), fixed(), { contract: Cc(510), side: 'sell', qty: 1, kind: 'market' }) === null && customPlan(CUSTOM_DEFAULTS).rules.allowSell === 'all');

  /* ---- expiry: a short settles at what it is worth in the money, in cash ---- */
  {
    now = nyInstant(T, 15 * 60);
    px.SPY = 500;
    px.SPX = 5000;
    let x = newAccount({ id: 'ex', kind: 'practice', name: 'ex', startCash: 100_000, now });
    const day = (k: number, r: 'C' | 'P', t = 'SPY'): ContractId => ({ ticker: t, strike: k, right: r, expiry: T });
    x = optPlace(x, market(), { contract: day(505, 'P'), side: 'sell', qty: 1, kind: 'market' });
    x = optPlace(x, market(), { contract: day(503, 'C'), side: 'sell', qty: 1, kind: 'market' });
    x = optPlace(x, market(), { contract: day(4990, 'C', 'SPX'), side: 'sell', qty: 1, kind: 'market' });
    x = optPlace(x, market(), { contract: { ...day(500, 'P'), short: 495 }, side: 'sell', qty: 1, kind: 'market' });
    px.SPY = 497;
    px.SPX = 5002;
    now = nyInstant(T, 16 * 60) + 500;
    x = tick(x, market()).account;
    const tr = (k: number) => optBookOf(x).trades.find(t => t.contract.strike === k)!;
    ok('16:00: a short put in the money on a fund is assigned — settled in cash at 8.00 (505 − 497), said so', tr(505)?.how === 'expired' && tr(505).avgOut === 8 && /assigned/.test(tr(505).note ?? '') && /no stock/.test(tr(505).note ?? ''), tr(505)?.note);
    ok('…a short call out of the money expires worthless: bought back at 0', tr(503)?.avgOut === 0 && /worthless/.test(tr(503).note ?? ''), `${tr(503)?.avgOut} · ${tr(503)?.note}`);
    ok('…an index short is cash-settled on the 16:00 print at intrinsic (5002 − 4990 = 12)', tr(4990)?.avgOut === 12 && /cash-settled/.test(tr(4990).note ?? ''));
    ok('…a put spread sold settles inside its width (500 − 497 = 3 of 5), the leg sold assigned', tr(500)?.avgOut === 3 && /assigned/.test(tr(500).note ?? ''));
    ok('…and nothing is left open', optBookOf(x).positions.length === 0);
  }

  /* ---- Options Funding's 16:10 close for SPY, QQQ, IWM and DIA ---- */
  {
    now = nyInstant(T, 15 * 60);
    px.SPY = 500;
    px.IWM = 220;
    const ofp = (id: string) => newAccount({ id, kind: 'evaluation', name: id, startCash: 0, plan: planById('of-growth-50k')!, now });
    let x = ofp('of1610');
    x = optPlace(x, market(), { contract: { ticker: 'SPY', strike: 495, right: 'C', expiry: T }, side: 'buy', qty: 2, kind: 'market' });
    ok('an Options Funding account buys a SPY 0DTE call', optBookOf(x).positions.length === 1);
    px.SPY = 503;
    now = nyInstant(T, 16 * 60 + 5);
    x = tick(x, market()).account;
    ok('16:05: past the bell it is not settled — SPY’s options trade to 16:15 and the firm closes it at 16:10', optBookOf(x).positions.length === 1);
    ok('…it may still be closed by hand in that window (the market is shut for anything else)', optRefusal(x, { ...market(), open: () => false }, { contract: { ticker: 'SPY', strike: 495, right: 'C', expiry: T }, side: 'sell', qty: 1, kind: 'market' }) === null);
    now = nyInstant(T, 16 * 60 + 10);
    const q1610 = market().optQuote({ ticker: 'SPY', strike: 495, right: 'C', expiry: T });
    x = tick(x, { ...market(), open: () => false }).account;
    const t1610 = optBookOf(x).trades[0];
    ok('16:10: closed by the rules at the live bid of that minute', t1610?.how === 'rule' && t1610.avgOut === q1610.bid && nyAt(t1610.closed.at).minutes === 16 * 60 + 10, `${t1610?.how} ${t1610?.avgOut} · ${t1610?.note}`);
    now = nyInstant(T, 15 * 60);
    let y = ofp('of1610b');
    y = optPlace(y, market(), { contract: { ticker: 'SPY', strike: 495, right: 'C', expiry: T }, side: 'buy', qty: 1, kind: 'limit', price: 99 });
    now = nyInstant(T, 15 * 60 + 1);
    y = tick(y, market()).account;
    now = nyInstant(T, 16 * 60 + 11);
    y = tick(y, { ...market(), open: () => false, optQuote: c => ({ ...market().optQuote(c), dead: true, bid: 0, ask: 0 }) }).account;
    ok('…with no quote standing at 16:10, it settles at the 16:00 close instead, and says so', optBookOf(y).trades[0]?.how === 'expired' && /16:10/.test(optBookOf(y).trades[0]?.note ?? ''), `${optBookOf(y).trades[0]?.how} · ${optBookOf(y).trades[0]?.note} · ${optBookOf(y).positions.length}`);
    let z = newAccount({ id: 'pr1610', kind: 'practice', name: 'pr', startCash: 25_000, now: nyInstant(T, 15 * 60) });
    now = nyInstant(T, 15 * 60);
    z = optPlace(z, market(), { contract: { ticker: 'SPY', strike: 495, right: 'C', expiry: T }, side: 'buy', qty: 1, kind: 'market' });
    now = nyInstant(T, 16 * 60) + 500;
    z = tick(z, market()).account;
    ok('a practice account’s SPY 0DTE still settles at the 16:00 close', optBookOf(z).trades[0]?.how === 'expired');
  }
}

console.log(`\n${passed} held · ${failed} missed`);
if (failed) process.exit(1);
