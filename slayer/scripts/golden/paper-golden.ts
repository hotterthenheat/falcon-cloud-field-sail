/*
  Paper: the options engine and the prop-firm rules (data/paper/engine.ts, rules.ts) on ThetaData's recorded quotes for
  XSP's 0DTE chain on Thu 2026-10-29 (the compass-review-2026-10-29 set: every strike's NBBO minute by minute, and the
  index's minute bars), served through the golden fixtures (uwFixtures.ts) exactly as the proxy answered them — and,
  for selling (6–11), SPY's 0DTE chain the same day from 09:30 to 16:15, its options' own late window, with SPY's minute
  bars (the paper-sell-2026-10-29 set, recorded through the dev server: GOLDEN_RECORD=1).

  The market the engine is handed reads the recorded row standing at each minute. Accounts on real firm plans
  (data/paper/propFirms.ts — Vanquish Trader Rapid Express, Options Funding Express and Growth, TradeFundrr Prop) are
  walked through the day; every expected value is worked out a second way, straight from the raw rows by the plain
  arithmetic at the foot of each check (none of the engine's code): the fill prices, the fees, what the account is worth
  each minute, the running high mark, and the first minute a floor or a day's limit is reached.

    Run: npx tsx scripts/golden/paper-golden.ts      (GOLDEN_REPORT=1 prints the figures and the rows they come from)
*/
import { done, expectEqual, expectNear, freezeClock, installUwFixtures } from './uwFixtures';

const SET = 'compass-review-2026-10-29';
const DAY = '2026-10-29';
const REPORT = process.env.GOLDEN_REPORT === '1';
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.location = { search: '', pathname: '/practice/paper', href: 'http://127.0.0.1/practice/paper', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

installUwFixtures(SET);
freezeClock('2026-10-29T21:00:00.000Z');

const E = await import('../../src/data/paper/engine');
const R = await import('../../src/data/paper/rules');
const { planById } = await import('../../src/data/paper/propFirms');
const C = await import('../../src/data/paper/clock');
const say = (k: string, v: unknown) => REPORT && console.log(`REPORT ${k} = ${JSON.stringify(v)}`);

/* ---- the recorded answers, as the proxy served them ---- */
const answer = async (path: string): Promise<Record<string, unknown>[]> => {
  const body = (await (await fetch(`/api/theta${path}`)).json()) as { response?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(body) ? body : (body.response ?? []);
};
const barRows = await answer('/index/history/ohlc?symbol=XSP&start_date=20261029&end_date=20261029&interval=1m&format=json');
const chainRows = await answer('/option/history/quote?symbol=XSP&expiration=20261029&start_date=20261029&end_date=20261029&strike_range=16&interval=1m&format=json');
/* "HH:MM" of a row: a bar is stamped at its start; an interval quote at the instant it stood */
const hm = (r: Record<string, unknown>) => String(r.timestamp).slice(11, 16);
const closeAt = new Map(barRows.map(r => [hm(r), Number(r.close)]));
const quoteAt = new Map<string, { bid: number; ask: number }>();
for (const c of chainRows) {
  const k = c.contract as { strike: number; right: string };
  for (const q of c.data as Record<string, unknown>[]) quoteAt.set(`${k.strike}|${k.right.startsWith('C') ? 'C' : 'P'}|${hm(q)}`, { bid: Number(q.bid), ask: Number(q.ask) });
}
expectEqual('the recording holds 32 strikes a side, a row a minute 09:30–16:00', [chainRows.length, (chainRows[0].data as unknown[]).length], [64, 391]);

/* ---- SPY's 0DTE chain, 09:30–16:15, and its bars (the second set) ---- */
installUwFixtures('paper-sell-2026-10-29');
const spyBars = await answer('/stock/history/ohlc?symbol=SPY&start_date=20261029&end_date=20261029&interval=1m&format=json');
const spyChain = await answer('/option/history/quote?symbol=SPY&expiration=20261029&start_date=20261029&end_date=20261029&strike_range=8&interval=1m&start_time=09:30:00&end_time=16:15:00&format=json');
const spyClose = new Map(spyBars.map(r => [hm(r), Number(r.close)]));
const spyQuote = new Map<string, { bid: number; ask: number }>();
for (const c of spyChain) {
  const k = c.contract as { strike: number; right: string };
  for (const q of c.data as Record<string, unknown>[]) spyQuote.set(`${k.strike}|${k.right.startsWith('C') ? 'C' : 'P'}|${hm(q)}`, { bid: Number(q.bid), ask: Number(q.ask) });
}
expectEqual('the SPY recording holds 16 strikes a side, a row a minute 09:30–16:15 (its options trade to 16:15)', [spyChain.length, (spyChain[0].data as unknown[]).length, hm((spyChain[0].data as Record<string, unknown>[])[405])], [32, 406, '16:15']);

/* ---- the market the engine is handed: the row standing at the minute ---- */
type Contract = { ticker: string; strike: number; right: 'C' | 'P'; expiry: string };
const cents = (v: number) => Math.round(v * 100) / 100;
const minuteOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const words = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** A second into the minute: after the row that stands at it */
const at = (hhmm: string) => C.nyInstant(DAY, minuteOf(hhmm)) + 1000;
const row = (c: Contract, hhmm: string) => quoteAt.get(`${c.strike}|${c.right}|${hhmm}`)!;
function market(now: number): import('../../src/data/paper/engine').PaperMarket {
  const t = C.nyAt(now);
  const hhmm = words(t.minutes);
  const spot = closeAt.get(words(t.minutes - 1)) ?? NaN;
  const quote = (c: Contract) => {
    const q = quoteAt.get(`${c.strike}|${c.right}|${hhmm}`);
    const dead = !q || !(q.bid > 0) || !(q.ask > 0);
    return { bid: q?.bid ?? 0, ask: q?.ask ?? 0, mark: dead ? NaN : cents((q!.bid + q!.ask) / 2), iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead, spot };
  };
  return {
    now,
    life: 'golden',
    optQuote: quote,
    optQuoteAt: quote,
    bar: () => Math.floor(now / 1000),
    candles: () => [],
    open: () => t.minutes >= 570 && t.minutes < 960,
    fresh: () => true,
    closeOf: () => closeAt.get('15:59') ?? NaN,
  };
}
const xsp = (strike: number, right: 'C' | 'P' = 'C'): Contract => ({ ticker: 'XSP', strike, right, expiry: DAY });
/* SPY's market: a leg is its row; a spread is its two legs' natural, as the live feed makes it (feed.ts optionQuote):
   the bid is the leg bought's bid less the leg sold's ask, the ask the other way, inside the width */
type Spread = Contract & { short?: number };
const spyRow = (strike: number, right: 'C' | 'P', hhmm: string) => spyQuote.get(`${strike}|${right}|${hhmm}`)!;
function spyMarket(now: number): import('../../src/data/paper/engine').PaperMarket {
  const t = C.nyAt(now);
  const hhmm = words(t.minutes);
  const spot = spyClose.get(words(t.minutes - 1)) ?? spyClose.get('16:00') ?? NaN;
  const leg = (strike: number, right: 'C' | 'P') => {
    const q = spyQuote.get(`${strike}|${right}|${hhmm}`);
    const dead = !q || !(q.bid > 0) || !(q.ask > 0);
    return { bid: q?.bid ?? 0, ask: q?.ask ?? 0, mark: dead ? NaN : cents((q!.bid + q!.ask) / 2), iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead, spot };
  };
  const quote = (c: Spread) => {
    if (c.short == null) return leg(c.strike, c.right);
    const b = leg(c.strike, c.right);
    const s1 = leg(c.short, c.right);
    if (b.dead || s1.dead) return { ...b, bid: 0, ask: 0, mark: NaN, dead: true };
    const w = Math.abs(c.short - c.strike);
    const inside = (v: number) => Math.max(0, Math.min(w, v));
    const bid = cents(inside(b.bid - s1.ask));
    const ask = cents(Math.max(bid + 0.01, inside(b.ask - s1.bid)));
    return { ...b, bid, ask, mark: cents((bid + ask) / 2), dead: bid <= 0 };
  };
  return { now, life: 'golden', optQuote: quote, optQuoteAt: quote, bar: () => Math.floor(now / 1000), candles: () => [], open: () => t.minutes >= 570 && t.minutes < 960, fresh: () => true, closeOf: () => spyClose.get('15:59') ?? NaN };
}
const spy = (strike: number, right: 'C' | 'P', short?: number): Spread => ({ ticker: 'SPY', strike, right, expiry: DAY, ...(short != null ? { short } : {}) });
type Account = import('../../src/data/paper/engine').PaperAccount;
const open = (planId: string, id: string, hhmm: string): Account => E.newAccount({ id, kind: 'evaluation', name: id, startCash: 0, plan: planById(planId)!, now: at(hhmm) });
const buy = (a: Account, c: Contract, qty: number, hhmm: string) => E.optPlace(a, market(at(hhmm)), { contract: c, side: 'buy', qty, kind: 'market' });
const sell = (a: Account, c: Contract, qty: number, hhmm: string) => E.optPlace(a, market(at(hhmm)), { contract: c, side: 'sell', qty, kind: 'market' });
/** The account ticked once a minute, from one minute to another (both in) — or until `stop` holds */
function walk(a: Account, from: string, to: string, stop?: (a: Account) => boolean): { a: Account; minute: string | null } {
  for (let m = minuteOf(from); m <= minuteOf(to); m++) {
    a = E.tick(a, market(at(words(m)))).account;
    if (stop?.(a)) return { a, minute: words(m) };
  }
  return { a, minute: null };
}
const view = (a: Account, hhmm: string) => E.viewOf(a, market(at(hhmm)));

/* ================================================================== */
/* 1. Vanquish Trader · Rapid Express $10K: an intraday trailing floor $300 under the best moment, open trades in   */
/* ================================================================== */
{
  const c = xsp(770);
  let a = open('vq-rapid-express-10k', 'vq', '09:59');
  a = buy(a, c, 5, '10:00');
  const ask = row(c, '10:00').ask;
  expectNear('Vanquish: a market buy fills at the 10:00 row’s ask', a.opt.fills[0].price, ask, 1e-9);
  expectEqual('Vanquish states no commission: none is charged', a.opt.fills[0].fee, 0);
  const w = walk(a, '10:01', '15:58', x => x.status !== 'open');
  /* by hand: cash after the buy, the worth each minute at the row's mid, the high mark, the first minute at or under it less $300 */
  const cash = 10_000 - ask * 500;
  let peak = 10_000;
  let failAt: string | null = null;
  let worthAt = NaN;
  for (let m = minuteOf('10:01'); m <= minuteOf('15:58'); m++) {
    const q = row(c, words(m));
    const worth = cents(cash + cents(cents((q.bid + q.ask) / 2) * 500));
    peak = Math.max(peak, worth);
    if (worth <= peak - 300 + 1e-9) {
      failAt = words(m);
      worthAt = worth;
      break;
    }
  }
  say('vq fail minute / worth / peak', [failAt, worthAt, peak]);
  expectEqual('Vanquish: the account fails on the drawdown at the first minute its worth reaches the trailing floor', [w.a.status, w.a.statusRule, w.minute], ['failed', 'drawdown', failAt]);
  expectNear('…its high mark is the best minute’s worth, open trade in', w.a.peak, peak, 1e-9);
  const out = w.a.opt.fills[1];
  expectNear('…everything is closed by the rules at that minute’s bid', out.price, row(c, failAt!).bid, 1e-9);
  expectNear('…and the account ends on the cash that sale brings', E.viewOf(w.a, market(at(failAt!))).equity, cents(cash + row(c, failAt!).bid * 500), 1e-9);
  expectEqual('…written down at that minute', C.nyAt(w.a.statusAt!).minutes, minuteOf(failAt!));
}

/* ================================================================== */
/* 2. Options Funding · Express $25K: $0.65 a contract each side, worth at the bid, a floor $1,250 under the best   */
/* ================================================================== */
{
  const c = xsp(770);
  const c2 = xsp(772);
  let a = open('of-express-25k', 'of', '09:59');
  a = buy(a, c, 10, '10:00');
  expectNear('Options Funding: $0.65 a contract on the way in (10 contracts)', a.opt.fills[0].fee, 6.5, 1e-9);
  const w = walk(a, '10:01', '15:54', x => x.status !== 'open');
  /* by hand: worth with the contracts at their bid every minute, the high mark, the first minute at or under it less $1,250 */
  const cash = 25_000 - row(c, '10:00').ask * 1000 - 6.5;
  let peak = 25_000;
  let failAt: string | null = null;
  for (let m = minuteOf('10:01'); m <= minuteOf('15:54'); m++) {
    const worth = cents(cash + row(c, words(m)).bid * 1000);
    peak = Math.max(peak, worth);
    if (worth <= peak - 1250 + 1e-9) {
      failAt = words(m);
      break;
    }
  }
  say('of fail minute / peak', [failAt, peak]);
  expectEqual('…fails on the drawdown at the first minute its worth, contracts at their bid, reaches the floor', [w.a.status, w.a.statusRule, w.minute], ['failed', 'drawdown', failAt]);
  expectNear('…its high mark is the best minute’s worth with the contracts at their bid', w.a.peak, cents(peak), 1e-9);
  const t = E.optBookOf(w.a).trades[0];
  expectNear('…closed by the rules at that minute’s bid: (bid − ask) × 1,000 less $13 in commissions', t.pnl, cents((row(c, failAt!).bid - row(c, '10:00').ask) * 1000 - 13), 1e-9);
}

/* ================================================================== */
/* 3. Options Funding · Growth $25K: an expiring contract is closed at 15:55 ET                                     */
/* ================================================================== */
{
  const c = xsp(766);
  let a = open('of-growth-25k', 'ofg', '14:59');
  a = buy(a, c, 3, '15:00');
  const w = walk(a, '15:01', '15:56');
  const t = E.optBookOf(w.a).trades[0];
  expectEqual('Options Funding: the expiring XSP contract is closed by the rules at 15:55 ET', [t?.how, C.nyAt(t?.closed.at ?? 0).minutes], ['rule', minuteOf('15:55')]);
  expectNear('…at the 15:55 row’s bid', t.avgOut, row(c, '15:55').bid, 1e-9);
  expectNear('…for (bid − ask) × 300 less $3.90 in commissions', t.pnl, cents((row(c, '15:55').bid - row(c, '15:00').ask) * 300 - 3.9), 1e-9);
}

/* ================================================================== */
/* 4. TradeFundrr · Prop $25K: flat by 15:55, $0.30 a side, a $1,000 day that pauses, $25,000 of buying power        */
/* ================================================================== */
{
  const c = xsp(768);
  let a = open('tf-prop-25k', 'tf', '14:59');
  a = buy(a, c, 2, '15:00');
  const w = walk(a, '15:01', '15:56');
  const t = E.optBookOf(w.a).trades[0];
  expectEqual('TradeFundrr: everything is closed by the rules at 15:55 ET', [t?.how, C.nyAt(t?.closed.at ?? 0).minutes], ['rule', minuteOf('15:55')]);
  const pnl = cents((row(c, '15:55').bid - row(c, '15:00').ask) * 200 - 0.3 * 2 * 2);
  expectNear('…at the 15:55 bid, $0.30 a contract each side', t.pnl, pnl, 1e-9);
  expectNear('…and that profit counts toward the $1,250 target (held well over 15 seconds)', R.progressOf(w.a, view(w.a, '15:56')).profit, pnl, 1e-9);
  expectEqual('…a day of $250 or more counts toward the five', R.progressOf(w.a, view(w.a, '15:56')).good, pnl >= 250 ? 1 : 0);
  say('tf trade', { ask: row(c, '15:00').ask, bid: row(c, '15:55').bid, pnl });

  let b = open('tf-prop-25k', 'tf2', '11:59');
  const c2 = xsp(770);
  b = buy(b, c2, 20, '12:00');
  const wb = walk(b, '12:01', '15:54', x => !!x.dayOver);
  const cash = 25_000 - row(c2, '12:00').ask * 2000 - 6;
  let pause: string | null = null;
  for (let m = minuteOf('12:01'); m <= minuteOf('15:54'); m++) {
    const q = row(c2, words(m));
    if (cents(cash + cents(cents((q.bid + q.ask) / 2) * 2000)) <= 24_000 + 1e-9) {
      pause = words(m);
      break;
    }
  }
  say('tf pause minute', pause);
  expectEqual('TradeFundrr: down $1,000 on the day is a soft breach — the day is over at that minute, the account is not failed', [wb.minute, wb.a.status, E.optBookOf(wb.a).positions.length], [pause, 'open', 0]);
  expectEqual('…no new position until the next trading day', (E.optRefusal(wb.a, market(at('15:00')), { contract: c2, side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('The day’s loss limit was reached'), true);
  const fresh = open('tf-prop-25k', 'tf3', '09:59');
  expectEqual('…and $25,000 of buying power: 110 contracts at the 10:00 ask is refused by the rule, in words', (E.optRefusal(fresh, market(at('10:00')), { contract: c2, side: 'buy', qty: 110, kind: 'market' }) ?? '').startsWith('No more than $25,000 tied up'), true);
}

/* ================================================================== */
/* 5. What a plan does not allow                                                                                     */
/* ================================================================== */
{
  const spread = { ...xsp(770), short: 775 };
  const basic = open('vq-basic-10k', 'vqb', '10:00');
  const adv = open('vq-advanced-10k', 'vqa', '10:00');
  expectEqual('Vanquish Basic: on XSP single calls and puts only, bought — a spread is refused', (E.optRefusal(basic, market(at('10:00')), { contract: spread, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('only single calls and puts on XSP'), true);
  expectEqual('…and on SPY too: calls and puts only', (E.optRefusal(basic, spyMarket(at('10:00')), { contract: spy(768, 'C', 770), side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('does not allow spreads'), true);
  expectEqual('Vanquish Advanced: spreads, but never on SPX, XSP or VIX', (E.optRefusal(adv, market(at('10:00')), { contract: spread, side: 'buy', qty: 1, kind: 'market' }) ?? '').includes('only single calls and puts on XSP'), true);
  expectEqual('Vanquish: from 15:59 ET no way in', (E.optRefusal(basic, market(at('15:59')), { contract: xsp(770), side: 'buy', qty: 1, kind: 'market' }) ?? '').startsWith('It is past the plan’s close'), true);
}

/* ================================================================== */
/* 6. A practice account sells a put spread on SPY: sold at the legs' natural, held at its width, bought back at the   */
/*    legs' other side                                                                                                */
/* ================================================================== */
type Mk = (now: number) => import('../../src/data/paper/engine').PaperMarket;
function walkOn(mk: Mk, a: Account, from: string, to: string, stop?: (a: Account) => boolean): { a: Account; minute: string | null } {
  for (let m = minuteOf(from); m <= minuteOf(to); m++) {
    a = E.tick(a, mk(at(words(m)))).account;
    if (stop?.(a)) return { a, minute: words(m) };
  }
  return { a, minute: null };
}
const practice = (id: string, cash: number, hhmm: string): Account => E.newAccount({ id, kind: 'practice', name: id, startCash: cash, now: at(hhmm) });
{
  const ps = spy(768, 'P', 766);
  let a = practice('ps', 100_000, '09:59');
  a = E.optPlace(a, spyMarket(at('10:00')), { contract: ps, side: 'sell', qty: 5, kind: 'market' });
  const credit = cents(spyRow(768, 'P', '10:00').bid - spyRow(766, 'P', '10:00').ask);
  say('put spread credit', { bid768: spyRow(768, 'P', '10:00').bid, ask766: spyRow(766, 'P', '10:00').ask, credit });
  expectNear('a put spread sold at 10:00 fills at the 768P’s bid less the 766P’s ask', a.opt.fills[0].price, credit, 1e-9);
  const v = E.viewOf(a, spyMarket(at('10:00')));
  expectNear('…it holds its width: 2 × 100 × 5 = 1,000', v.marginReq, 1000, 1e-9);
  expectNear('…less the credit taken in, its whole loss: 1,000 − credit × 500', v.margin, cents(1000 - credit * 500), 1e-9);
  expectNear('…free is the start, plus the credit, less $0.65 on 10 legs, less the 1,000 held', v.free, cents(100_000 + credit * 500 - 6.5 - 1000), 1e-9);
  const w = walkOn(spyMarket, a, '10:01', '14:59');
  const b = E.optClose(w.a, spyMarket(at('15:00')), ps, 5);
  const back = cents(spyRow(768, 'P', '15:00').ask - spyRow(766, 'P', '15:00').bid);
  const t = E.optBookOf(b).trades[0];
  expectNear('…bought back by hand at 15:00 at the 768P’s ask less the 766P’s bid', t.avgOut, back, 1e-9);
  expectNear('…made (credit − buy-back) × 500 less $13 in fees', t.pnl, cents((credit - back) * 500 - 13), 1e-9);
  expectEqual('…written down as a short, closed by hand', [t.short, t.how], [true, 'closed']);
}

/* ================================================================== */
/* 7. An iron condor as one order, held as one                                                                       */
/* ================================================================== */
{
  const put = spy(766, 'P', 764);
  const call = spy(772, 'C', 775);
  let a = practice('ic', 100_000, '09:59');
  a = E.optPlaceCombo(a, spyMarket(at('10:00')), { name: 'Iron condor', legs: [{ contract: put, side: 'sell' }, { contract: call, side: 'sell' }], qty: 3, kind: 'market' });
  const pc = cents(spyRow(766, 'P', '10:00').bid - spyRow(764, 'P', '10:00').ask);
  const cc = cents(spyRow(772, 'C', '10:00').bid - spyRow(775, 'C', '10:00').ask);
  say('condor credits', { pc, cc });
  expectEqual('an iron condor at the market: both spreads fill at once, at their own natural', [a.opt.fills.length, a.opt.fills[0].price, a.opt.fills[1].price], [2, pc, cc]);
  const v = E.viewOf(a, spyMarket(at('10:00')));
  expectNear('…it holds the wider side once: 3 × 100 × 3 = 900', v.marginReq, 900, 1e-9);
  expectNear('…its whole loss: 900 − (both credits) × 300', v.margin, cents(900 - (pc + cc) * 300), 1e-9);
}

/* ================================================================== */
/* 8. A naked call: Reg T, re-marked every minute                                                                    */
/* ================================================================== */
{
  const c = spy(772, 'C');
  let a = practice('nc', 100_000, '09:59');
  a = E.optPlace(a, spyMarket(at('10:00')), { contract: c, side: 'sell', qty: 2, kind: 'market' });
  expectNear('a naked 772C sold at 10:00 fills at its bid', a.opt.fills[0].price, spyRow(772, 'C', '10:00').bid, 1e-9);
  const w = walkOn(spyMarket, a, '10:01', '12:00');
  /* by hand at 12:00: SPY at the 11:59 bar's close, the 772C at its 12:00 mid */
  const S = spyClose.get('11:59')!;
  const q = spyRow(772, 'C', '12:00');
  const mid = cents((q.bid + q.ask) / 2);
  const each = Math.max(0.2 * S - Math.max(0, 772 - S) + mid, 0.1 * S + mid) * 100;
  say('reg T 12:00', { S, mid, each });
  expectNear('…at 12:00 it holds max(20% × SPY − OTM + mid, 10% × SPY + mid) × 100 × 2', E.viewOf(w.a, spyMarket(at('12:00'))).marginReq, cents(each * 2), 1e-9);
}

/* ================================================================== */
/* 9. A short put in the money at the close: assigned, settled in cash on the 16:00 print                            */
/* ================================================================== */
{
  const c = spy(770, 'P');
  let a = practice('as', 100_000, '15:29');
  a = E.optPlace(a, spyMarket(at('15:30')), { contract: c, side: 'sell', qty: 2, kind: 'market' });
  const sold = spyRow(770, 'P', '15:30').bid;
  const w = walkOn(spyMarket, a, '15:31', '16:01');
  const t = E.optBookOf(w.a).trades[0];
  const close = spyClose.get('15:59')!;
  say('assignment', { sold, close, intrinsic: cents(770 - close) });
  expectNear('the 770P sold at 15:30 settles at what it is in the money at the 16:00 print', t.avgOut, cents(Math.max(0, 770 - close)), 1e-9);
  expectEqual('…assigned, and said to be settled in cash (no stock is held)', [t.how, /assigned/.test(t.note ?? ''), /no stock/.test(t.note ?? '')], ['expired', true, true]);
  expectNear('…made (sold − settled) × 200, less the $1.30 it cost to sell (a settlement has no fee)', t.pnl, cents((sold - Math.max(0, 770 - close)) * 200 - 1.3), 1e-9);
}

/* ================================================================== */
/* 10. Options Funding · Growth $25K: buy only; SPY's expiring options are closed at 16:10 at that minute's bid       */
/* ================================================================== */
{
  const c = spy(766, 'C');
  let a = open('of-growth-25k', 'of1610', '09:59');
  expectEqual('Options Funding: a sale to open is refused, in words', (E.optRefusal(a, spyMarket(at('10:00')), { contract: c, side: 'sell', qty: 1, kind: 'market' }) ?? '').startsWith('This plan buys only'), true);
  a = E.optPlace(a, spyMarket(at('15:30')), { contract: c, side: 'buy', qty: 3, kind: 'market' });
  const paid = spyRow(766, 'C', '15:30').ask;
  expectNear('…buys three 766C at 15:30 at the ask', a.opt.fills[0].price, paid, 1e-9);
  let w = walkOn(spyMarket, a, '15:31', '15:56');
  expectEqual('…not closed at 15:55 with the other names: SPY waits for 16:10', E.optBookOf(w.a).positions.length, 1);
  w = walkOn(spyMarket, w.a, '15:57', '16:05');
  expectEqual('…not settled at the 16:00 bell either', E.optBookOf(w.a).positions.length, 1);
  w = walkOn(spyMarket, w.a, '16:06', '16:15', x => !E.optBookOf(x).positions.length);
  const t = E.optBookOf(w.a).trades[0];
  say('of 16:10', { paid, bid1610: spyRow(766, 'C', '16:10').bid, settle1600: cents(spyClose.get('15:59')! - 766) });
  expectEqual('…closed by the rules at 16:10', [w.minute, t.how], ['16:10', 'rule']);
  expectNear('…at the 16:10 row’s bid — not the 16:00 close’s intrinsic', t.avgOut, spyRow(766, 'C', '16:10').bid, 1e-9);
  expectNear('…for (bid − ask) × 300 less $3.90 in commissions', t.pnl, cents((spyRow(766, 'C', '16:10').bid - paid) * 300 - 3.9), 1e-9);
}

/* ================================================================== */
/* 11. Vanquish Trader · Advanced $50K (Level 4): a call spread sold on SPY, bought back by the rules at 15:59        */
/* ================================================================== */
{
  const cs = spy(770, 'C', 772);
  let a = open('vq-advanced-50k', 'vqa-sell', '09:59');
  expectEqual('Vanquish Advanced: a naked call is refused — Level 4 here has no margin', (E.optRefusal(a, spyMarket(at('10:00')), { contract: spy(772, 'C'), side: 'sell', qty: 1, kind: 'market' }) ?? '').startsWith('Level 4 here is cash only'), true);
  a = E.optPlace(a, spyMarket(at('10:00')), { contract: cs, side: 'sell', qty: 4, kind: 'market' });
  const credit = cents(spyRow(770, 'C', '10:00').bid - spyRow(772, 'C', '10:00').ask);
  expectNear('…a call spread sold is taken, at the 770C’s bid less the 772C’s ask', a.opt.fills[0]?.price ?? NaN, credit, 1e-9);
  expectNear('…it holds its whole loss: 2 × 100 × 4 − the credit × 400', E.viewOf(a, spyMarket(at('10:00'))).margin, cents(800 - credit * 400), 1e-9);
  const w = walkOn(spyMarket, a, '10:01', '15:59', x => !E.optBookOf(x).positions.length);
  const t = E.optBookOf(w.a).trades[0];
  const back = cents(spyRow(770, 'C', '15:59').ask - spyRow(772, 'C', '15:59').bid);
  say('vq spread', { credit, back });
  expectEqual('…flat by 15:59: bought back by the rules then', [w.minute, t?.how], ['15:59', 'rule']);
  expectNear('…at the 770C’s ask less the 772C’s bid at 15:59', t.avgOut, back, 1e-9);
  expectNear('…made (credit − buy-back) × 400 (Vanquish states no commission)', t.pnl, cents((credit - back) * 400), 1e-9);
}

done();
