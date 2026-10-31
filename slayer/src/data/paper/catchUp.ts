/* The minutes a working order missed. On a page where ThetaData's option quotes may not be read (Trace, Dossier,
   Pinpoint), or while the terminal is away, the live tick cannot judge a resting order. Back on a page that may read
   them, those minutes are replayed from ThetaData's one-minute NBBO history, in order, by the same rules as the live
   tick and the backtest: the first minute that would have filled fills, at that minute's ask or bid, stamped with that
   minute's end. Where the history cannot be had, the order stays working and says which minutes went unjudged. */

import { isTradingDay, isoDate, sessionCloseMinOn, sessionLengthOn } from '../../core/calendar';
import { blackScholesGreeks, blackScholesPrice, impliedVolFromPrice } from '../../core/greeks';
import { thetaAllowedHere, thetaCall } from '../theta';
import { barTime, flatRows, legKey, parseBars, parseQuotes, rowAt, standingAt } from '../review/history';
import { bookMark, contractKey, longLeg, spreadBook, type ContractId, type Quote } from '../review/quotes';
import { dateAt, nyAt, nyInstant, yearsToExpiry, OPEN_MIN } from './clock';
import { gapOf, judgeOrders, type OptOrder, type PaperAccount, type PaperMarket } from './engine';
import { optionRootOf } from './thetaFeed';

/** At most this many sessions back are replayed; an order unjudged for longer says so */
const MAX_DAYS = 5;
const INDEXES = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP']);
const ymd = (iso: string) => iso.replace(/-/g, '');
const cents = (v: number) => Math.round(v * 100) / 100;

/** Can the page in view read the history a replay needs */
export const canCatchUp = (): boolean => thetaAllowedHere('/option/history/quote?symbol=SPY');

/** A day's last session minute (389; 209 on a 13:00 early close), and its late close's last stamp (+15: 16:15 / 13:15) */
const lastMinOn = (day: string): number => sessionLengthOn(day) - 1;
const lateMinOn = (day: string): number => lastMinOn(day) + 15;
/** The instant a day's late close ends: 16:15, 13:15 on an early close — and its session's close */
const lateEndOn = (day: string): number => nyInstant(day, sessionCloseMinOn(day) + 15);
const closeOn = (day: string): number => nyInstant(day, sessionCloseMinOn(day));

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
  /** Where its minutes end: now, its session's end for a day order (16:15 where that name trades the late close), its expiry's */
  to: number;
  days: string[];
}
/** What a replay needs, fetched: each leg's day of quotes, each name's day of bars — or why it could not be had */
export interface Fetched {
  quotes: Map<string, { bid: number[]; ask: number[] }>;
  /** Real prints only — a missing minute is a gap, not a flat zero-volume candle */
  bars: Map<string, { time: number; close: number }[]>;
  /** By order id: why its minutes could not be read, and whether to ask again (the terminal away) or not */
  failed: Map<string, { why: string; again: boolean }>;
}

function gapsOf(a: PaperAccount, now: number): Gap[] {
  const out: Gap[] = [];
  for (const o of a.opt.orders) {
    const from = gapOf(o, now);
    if (from == null) continue;
    let to = Math.min(now, lateEndOn(o.contract.expiry));
    if (o.tif === 'day') to = Math.min(to, lateEndOn(nyAt(o.placed.at).date));
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
      jobs.push(once(`bars|${t}|${day}`, `/${root}/history/ohlc?symbol=${encodeURIComponent(t)}&start_date=${ymd(day)}&end_date=${ymd(day)}&interval=1m&format=json`, rows => {
        const b = parseBars(day, rows);
        if (b) got.bars.set(`${t}|${day}`, b.bars.filter(x => x.close > 0 && (x.volume > 0 || x.high !== x.low || x.open !== x.close)).map(x => ({ time: x.time, close: x.close })));
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

/** A leg's recorded quote at the end of a minute, with the greeks from its mid — dead where none stood.
    Past the bell, only that minute's own row counts: a quote is not carried into 16:01–16:15, and those minutes are
    not a market without one. */
function recorded(c: ContractId, day: string, m: number, f: Fetched, at: number): Quote {
  const closes = f.bars.get(`${c.ticker.toUpperCase()}|${day}`);
  let spot = NaN;
  if (closes?.length) {
    const target = barTime(day, m);
    for (const row of closes) {
      if (row.time > target) break;
      spot = row.close;
    }
  }
  const leg = (k: ContractId): Quote => {
    const d = f.quotes.get(`${legKey(k)}|${day}`);
    const q = d ? (m > lastMinOn(day) ? rowAt(d, m) : standingAt(d, m)) : null;
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
  const { bid, ask } = spreadBook(b.bid - s.ask, b.ask - s.bid, width);
  return { ...b, bid, ask, mark: bookMark(bid, ask, cents), delta: b.delta - s.delta, dead: bid <= 0 };
}

/** Did this name print a quote after 16:00 that day — so a missing minute in that window is a hole, not a closed session */
function tradesLate(f: Fetched, c: ContractId, day: string): boolean {
  const legs = c.short != null ? [longLeg(c), { ...longLeg(c), strike: c.short }] : [longLeg(c)];
  return legs.some(k => {
    const d = f.quotes.get(`${legKey(k)}|${day}`);
    if (!d) return false;
    for (let m = lastMinOn(day) + 1; m <= lateMinOn(day); m++) if (rowAt(d, m)) return true;
    return false;
  });
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
      for (let m = 0, last = lateMinOn(day); m <= last; m++) {
        const end = open + (m + 1) * 60_000;
        if (end <= g.from || end > g.to) continue;
        const e = ends.get(end) ?? { day, m, keys: new Set<string>() };
        e.keys.add(contractKey(g.order.contract));
        ends.set(end, e);
      }
    }
  let next = a;
  /* How far each order was actually judged. A minute after 16:00 on a name that trades then is judged only on that
     minute's own quote — a missing row is not marked judged while the late close is still open. */
  const progress = new Map<string, { to: number; blocked: boolean }>();
  for (const g of ok) progress.set(g.order.id, { to: g.order.judgedTo ?? g.from, blocked: false });
  for (const [end, e] of [...ends.entries()].sort((x, y) => x[0] - y[0])) {
    const quote = (c: ContractId): Quote => (e.keys.has(contractKey(c)) ? recorded(c, e.day, e.m, f, end) : { bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead: true, spot: NaN });
    for (const g of ok) {
      if (!e.keys.has(contractKey(g.order.contract))) continue;
      if (end <= g.from || end > g.to) continue;
      const st = progress.get(g.order.id);
      if (!st || st.blocked) continue;
      const q = quote(g.order.contract);
      const lateMin = e.m > lastMinOn(e.day);
      const lateOpen = now < lateEndOn(e.day);
      if (lateMin && q.dead && tradesLate(f, g.order.contract, e.day) && lateOpen) {
        st.blocked = true;
        continue;
      }
      st.to = end;
    }
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
      bar: () => Math.floor(end / 1000) - 60,
      candles: () => [],
      open: () => true,
    };
    next = judgeOrders(next, market);
  }
  /* what was replayed is judged up to the last minute that had a quote (a late minute with none is left unjudged while
     that name still trades); a day order still working past its session ends there — 16:15 where it traded the late
     close, else 16:00. What could not be replayed says so. */
  return {
    ...next,
    opt: {
      ...next.opt,
      orders: next.opt.orders.map(o => {
        const g = gaps.find(x => x.order.id === o.id);
        if (!g || o.status !== 'working') return o;
        const fail = f.failed.get(o.id);
        if (fail) return { ...o, unjudged: { from: g.from, to: now, why: fail.why }, judgedTo: fail.again ? o.judgedTo : now };
        const st = progress.get(o.id);
        const placedDay = nyAt(o.placed.at).date;
        const dayEnd = tradesLate(f, o.contract, placedDay) ? lateEndOn(placedDay) : closeOn(placedDay);
        const judgedTo = st?.blocked ? st.to : Math.max(st?.to ?? 0, now);
        if (o.tif === 'day' && now >= dayEnd) return { ...o, judgedTo, status: 'cancelled' as const, done: { at: dayEnd, day: o.placed.day }, why: 'the day ended' };
        return { ...o, judgedTo, unjudged: undefined };
      }),
    },
  };
}

/** Does the account have minutes to replay */
export const hasGaps = (a: PaperAccount, now: number): boolean => a.status === 'open' && a.opt.orders.some(o => gapOf(o, now) != null);
