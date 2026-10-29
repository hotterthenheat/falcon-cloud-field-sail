/* The minutes a working order missed. On a page where ThetaData's option quotes may not be read (Trace, Dossier,
   Pinpoint), or while the terminal is away, the live tick cannot judge a resting order. Back on a page that may read
   them, those minutes are replayed from ThetaData's one-minute NBBO history, in order, by the same rules as the live
   tick and the backtest: the first minute that would have filled fills, at that minute's ask or bid, stamped with that
   minute's end. Where the history cannot be had, the order stays working and says which minutes went unjudged. */

import { isTradingDay, isoDate } from '../../core/calendar';
import { blackScholesGreeks, blackScholesPrice, impliedVolFromPrice } from '../../core/greeks';
import { thetaAllowedHere, thetaCall } from '../theta';
import { DAY_MIN, flatRows, legKey, parseBars, parseQuotes, standingAt } from '../review/history';
import { contractKey, longLeg, type ContractId, type Quote } from '../review/quotes';
import { bellOf, dateAt, nyAt, nyInstant, yearsToExpiry, OPEN_MIN } from './clock';
import { gapOf, judgeOrders, type OptOrder, type PaperAccount, type PaperMarket } from './engine';
import { optionRootOf } from './thetaFeed';

/** At most this many sessions back are replayed; an order unjudged for longer says so */
const MAX_DAYS = 5;
const INDEXES = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP']);
const ymd = (iso: string) => iso.replace(/-/g, '');
const cents = (v: number) => Math.round(v * 100) / 100;

/** Can the page in view read the history a replay needs */
export const canCatchUp = (): boolean => thetaAllowedHere('/option/history/quote?symbol=SPY');

/** Sessions from the day of `from` to the day of `to`, both in */
function sessionsOf(from: number, to: number): string[] {
  const out: string[] = [];
  const d = dateAt(nyAt(from).date);
  const last = nyAt(to).date;
  for (let i = 0; i < 40 && isoDate(d) <= last; i++, d.setDate(d.getDate() + 1)) if (isTradingDay(d)) out.push(isoDate(d));
  return out;
}

interface Gap {
  order: OptOrder;
  from: number;
  /** Where its minutes end: now, its day's bell for a day order, its expiry's bell */
  to: number;
  days: string[];
}
/** What a replay needs, fetched: each leg's day of quotes, each name's day of bars — or why it could not be had */
export interface Fetched {
  quotes: Map<string, { bid: number[]; ask: number[] }>;
  bars: Map<string, number[]>;
  /** By order id: why its minutes could not be read, and whether to ask again (the terminal away) or not */
  failed: Map<string, { why: string; again: boolean }>;
}

function gapsOf(a: PaperAccount, now: number): Gap[] {
  const out: Gap[] = [];
  for (const o of a.opt.orders) {
    const from = gapOf(o, now);
    if (from == null) continue;
    let to = Math.min(now, bellOf(o.contract.expiry));
    if (o.tif === 'day') to = Math.min(to, bellOf(nyAt(o.placed.at).date));
    out.push({ order: o, from, to, days: to > from ? sessionsOf(from, to) : [] });
  }
  return out;
}
const legsOf = (c: ContractId): ContractId[] => (c.short != null ? [longLeg(c), { ...longLeg(c), strike: c.short }] : [longLeg(c)]);

/** Fetch what the account's gaps need (nothing is asked where no session minute was missed) */
export async function fetchGaps(a: PaperAccount, now: number): Promise<Fetched> {
  const got: Fetched = { quotes: new Map(), bars: new Map(), failed: new Map() };
  const asked = new Map<string, Promise<string | null>>();
  /* one ask per path, shared by every order that needs it; null when it answered, else why not */
  const once = (key: string, path: string, put: (rows: Record<string, unknown>[]) => void) => {
    if (!asked.has(key))
      asked.set(
        key,
        thetaCall(path, true).then(r => {
          if (r.status === 472) return null;
          if (r.error === 'terminal_down') return 'offline';
          if (r.error) return r.error === 'uw_only' ? 'not here' : 'no history';
          put(flatRows(r.data));
          return null;
        })
      );
    return asked.get(key)!;
  };
  for (const g of gapsOf(a, now)) {
    if (!g.days.length) continue;
    if (g.days.length > MAX_DAYS) {
      got.failed.set(g.order.id, { why: `unjudged for more than ${MAX_DAYS} sessions`, again: false });
      continue;
    }
    const jobs: Promise<string | null>[] = [];
    for (const day of g.days) {
      const t = g.order.contract.ticker.toUpperCase();
      const root = INDEXES.has(t) ? 'index' : 'stock';
      jobs.push(once(`bars|${t}|${day}`, `/${root}/history/ohlc?symbol=${encodeURIComponent(t)}&date=${ymd(day)}&interval=1m&format=json`, rows => {
        const b = parseBars(day, rows);
        if (b) got.bars.set(`${t}|${day}`, b.bars.map(x => x.close));
      }));
      for (const leg of legsOf(g.order.contract)) {
        if (leg.expiry < day) continue;
        const path = `/option/history/quote?symbol=${encodeURIComponent(optionRootOf(leg.ticker))}&expiration=${ymd(leg.expiry)}&strike=${leg.strike.toFixed(2)}&right=${leg.right === 'C' ? 'call' : 'put'}&date=${ymd(day)}&interval=1m&format=json`;
        jobs.push(once(`leg|${legKey(leg)}|${day}`, path, rows => {
          const d = parseQuotes(leg.ticker, rows, leg).get(legKey(leg));
          if (d) got.quotes.set(`${legKey(leg)}|${day}`, d);
        }));
      }
    }
    const answers = await Promise.all(jobs);
    const bad = answers.find(x => x != null);
    if (bad) got.failed.set(g.order.id, bad === 'offline' ? { why: 'ThetaData was offline', again: true } : bad === 'not here' ? { why: 'this page does not read option history', again: true } : { why: 'ThetaData has no history for those minutes', again: false });
  }
  return got;
}

/** A leg's recorded quote at the end of a minute, with the greeks from its mid — dead where none stood */
function recorded(c: ContractId, day: string, m: number, f: Fetched, at: number): Quote {
  const closes = f.bars.get(`${c.ticker.toUpperCase()}|${day}`);
  const spot = closes?.length ? closes[Math.min(closes.length - 1, m)] : NaN;
  const leg = (k: ContractId): Quote => {
    const d = f.quotes.get(`${legKey(k)}|${day}`);
    const q = d ? standingAt(d, m) : null;
    const intrinsic = spot > 0 ? Math.max(0, k.right === 'C' ? spot - k.strike : k.strike - spot) : 0;
    if (!q || !(q.ask > 0) || !(q.bid > 0)) return { bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic, dead: true, spot };
    const mid = (q.bid + q.ask) / 2;
    const t = Math.max(yearsToExpiry(k.expiry, at), 1 / (252 * 390));
    const iv = spot > 0 ? impliedVolFromPrice(mid, spot, k.strike, t, k.right) : null;
    const g = iv != null ? blackScholesGreeks(spot, k.strike, t, iv) : null;
    return { bid: q.bid, ask: q.ask, mark: cents(mid), iv: iv ?? 0, delta: g ? (k.right === 'C' ? g.deltaCall : g.deltaPut) : 0, gamma: g?.gamma ?? 0, theta: 0, vega: g?.vega ?? 0, rho: 0, intrinsic: cents(intrinsic), dead: false, spot };
  };
  if (c.short == null) return leg(c);
  const b = leg(longLeg(c));
  const s = leg({ ...longLeg(c), strike: c.short });
  if (b.dead || s.dead) return { ...b, bid: 0, ask: 0, mark: NaN, dead: true };
  const width = Math.abs(c.short - c.strike);
  const inside = (v: number) => Math.max(0, Math.min(width, v));
  const bid = cents(inside(b.bid - s.ask));
  const ask = cents(Math.max(bid + 0.01, inside(b.ask - s.bid)));
  return { ...b, bid, ask, mark: cents((bid + ask) / 2), delta: b.delta - s.delta, dead: bid <= 0 };
}

/** Replay the account's gaps on what was fetched, then mark what could not be. Pure: the store applies it to the account
    as it stands when the history lands. */
export function replayGaps(a: PaperAccount, f: Fetched, now: number, life: string): PaperAccount {
  const gaps = gapsOf(a, now);
  if (!gaps.length) return a;
  const ok = gaps.filter(g => !f.failed.has(g.order.id));
  /* every minute end any good gap covers, oldest first, with the contracts it is replayed for */
  const ends = new Map<number, { day: string; m: number; keys: Set<string> }>();
  for (const g of ok)
    for (const day of g.days) {
      const open = nyInstant(day, OPEN_MIN);
      for (let m = 0; m < DAY_MIN; m++) {
        const end = open + (m + 1) * 60_000;
        if (end <= g.from || end > g.to) continue;
        const e = ends.get(end) ?? { day, m, keys: new Set<string>() };
        e.keys.add(contractKey(g.order.contract));
        ends.set(end, e);
      }
    }
  let next = a;
  for (const [end, e] of [...ends.entries()].sort((x, y) => x[0] - y[0])) {
    const quote = (c: ContractId): Quote => (e.keys.has(contractKey(c)) ? recorded(c, e.day, e.m, f, end) : { bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead: true, spot: NaN });
    const market: PaperMarket = {
      now: end,
      life,
      replay: true,
      optQuote: quote,
      optQuoteAt: (c, spot) => {
        const q = quote(c);
        const t = Math.max(yearsToExpiry(c.expiry, end), 1 / (252 * 390));
        const v = q.iv > 0 ? Math.max(0, blackScholesPrice(spot, c.strike, t, q.iv, c.right)) : 0;
        return { ...q, bid: cents(v), ask: cents(v), mark: cents(v), dead: !(v > 0), spot };
      },
      fut: () => NaN,
      bar: () => Math.floor(end / 1000) - 60,
      candles: () => [],
      open: kind => kind === 'option',
    };
    next = judgeOrders(next, market);
  }
  /* what was replayed is judged up to its end; a day order still working past its day's bell ends there; what could not
     be replayed says so (and is let go to the live tick where asking again will not help) */
  return {
    ...next,
    opt: {
      ...next.opt,
      orders: next.opt.orders.map(o => {
        const g = gaps.find(x => x.order.id === o.id);
        if (!g || o.status !== 'working') return o;
        const fail = f.failed.get(o.id);
        if (fail) return { ...o, unjudged: { from: g.from, to: now, why: fail.why }, judgedTo: fail.again ? o.judgedTo : now };
        const dayBell = bellOf(nyAt(o.placed.at).date);
        if (o.tif === 'day' && now >= dayBell) return { ...o, judgedTo: g.to, status: 'cancelled' as const, done: { at: dayBell, day: o.placed.day }, why: 'the day ended' };
        return { ...o, judgedTo: Math.max(o.judgedTo ?? 0, now), unjudged: undefined };
      }),
    },
  };
}

/** Does the account have minutes to replay */
export const hasGaps = (a: PaperAccount, now: number): boolean => a.status === 'open' && a.opt.orders.some(o => gapOf(o, now) != null);
