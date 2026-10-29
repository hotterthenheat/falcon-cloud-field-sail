/* A contract's quote in the backtest: the NBBO ThetaData recorded at the end of the minute (data/review/history.ts),
   with the greeks and the IV computed from that quote's mid and the name's price that minute. The expiries and strikes
   are the contracts quoted that day. A minute with no two-sided quote is no market: orders wait. */

import { sessionsBetween } from '../../core/calendar';
import { blackScholesGreeks, blackScholesPrice, impliedVolFromPrice } from '../../core/greeks';
import { CASH_INDEX_ROOTS, DAY_MIN, LAST_MIN, closePrintOf, dateOf, dayWords, lastTwoSidedAt, listingOf, midsUpTo, nbboAt, spotAt, tradesUpTo, underOf } from './history';

export type Right = 'C' | 'P';
export interface ContractId {
  ticker: string;
  strike: number;
  right: Right;
  /** YYYY-MM-DD */
  expiry: string;
  /** A vertical spread: the strike SOLD against `strike` — same right, same expiry */
  short?: number;
}
/** What a spread is worth at the most: the distance between its strikes */
export const spreadWidth = (c: ContractId): number => (c.short != null ? Math.abs(c.short - c.strike) : 0);
/** The bought leg on its own — what the chain's row and its drop-down are */
export const longLeg = (c: ContractId): ContractId => ({ ticker: c.ticker, strike: c.strike, right: c.right, expiry: c.expiry });
/** Legs a contract's fee is charged on */
export const legsOf = (c: ContractId): number => (c.short != null ? 2 : 1);
export interface Quote {
  bid: number;
  ask: number;
  mark: number;
  /** Implied from the mid (0 where the mid cannot be explained by any vol) */
  iv: number;
  delta: number;
  gamma: number;
  /** Dollars a share the contract loses over one session, all else equal (negative) */
  theta: number;
  vega: number;
  rho: number;
  intrinsic: number;
  /** No two-sided quote stood: orders wait */
  dead: boolean;
  /** Where the name stood */
  spot: number;
}

const fmtK = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(2).replace(/0$/, ''));
export const contractKey = (c: ContractId) => `${c.ticker}|${c.expiry}|${c.strike}|${c.right}${c.short != null ? `|${c.short}` : ''}`;
/** "NVDA 121C" — the pill's words; a spread is "NVDA 121/125C", bought strike first */
export const contractWords = (c: ContractId) => `${c.ticker} ${fmtK(c.strike)}${c.short != null ? `/${fmtK(c.short)}` : ''}${c.right}`;
export const strikeWords = fmtK;

/* ---- time left, in years of trading time ---- */
const sessionsMemo = new Map<string, number>();
/** Whole sessions AFTER `iso`, up to and including the expiry */
function sessionsLeft(iso: string, expiry: string): number {
  if (expiry <= iso) return 0;
  const key = `${iso}|${expiry}`;
  let n = sessionsMemo.get(key);
  if (n === undefined) {
    n = sessionsBetween(dateOf(iso), dateOf(expiry));
    if (sessionsMemo.size > 4000) sessionsMemo.clear();
    sessionsMemo.set(key, n);
  }
  return n;
}
/** A cursor on minute m stands at the END of bar m. At the bell of the expiry day nothing is left. */
export function yearsLeft(iso: string, minute: number, expiry: string): number {
  if (expiry < iso) return 0;
  const today = (LAST_MIN - Math.min(LAST_MIN, Math.max(0, minute))) / DAY_MIN;
  return (sessionsLeft(iso, expiry) + today) / 252;
}
/** Calendar days to the expiry — the "DTE" a trader says */
export const dteAt = (iso: string, expiry: string): number => Math.max(0, Math.round((dateOf(expiry).getTime() - dateOf(iso).getTime()) / 86400000));

const cents = (v: number) => Math.round(v * 100) / 100;
const intrinsicOf = (c: ContractId, spot: number) => (spot > 0 ? Math.max(0, c.right === 'C' ? spot - c.strike : c.strike - spot) : 0);
const noQuote = (c: ContractId, spot: number): Quote => ({ bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: cents(intrinsicOf(c, spot)), dead: true, spot });

/** Greeks of a bought leg from its mid, the name's price and the time left */
function greeksOn(c: ContractId, mid: number, spot: number, t: number): Pick<Quote, 'iv' | 'delta' | 'gamma' | 'theta' | 'vega' | 'rho'> {
  const iv = t > 0 && spot > 0 ? impliedVolFromPrice(mid, spot, c.strike, t, c.right) : null;
  if (iv == null) return { iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  const g = blackScholesGreeks(spot, c.strike, t, iv);
  const dayOn = Math.max(0, t - 1 / 252);
  const theta = (dayOn > 0 ? blackScholesPrice(spot, c.strike, dayOn, iv, c.right) : intrinsicOf(c, spot)) - blackScholesPrice(spot, c.strike, t, iv, c.right);
  return { iv, delta: c.right === 'C' ? g.deltaCall : g.deltaPut, gamma: g.gamma, theta, vega: g.vega, rho: c.right === 'C' ? g.rhoCall : g.rhoPut };
}

function legQuote(c: ContractId, iso: string, minute: number): Quote {
  const spot = spotAt(c.ticker, iso, minute);
  const intrinsic = intrinsicOf(c, spot);
  const q = nbboAt(c, iso, minute);
  if (!q || !(q.ask > 0) || !(q.bid > 0)) return { ...noQuote(c, spot), bid: q?.bid ?? 0, ask: q?.ask ?? 0, mark: q ? cents((q.bid + q.ask) / 2) : NaN };
  const mark = cents((q.bid + q.ask) / 2);
  return { bid: q.bid, ask: q.ask, mark, ...greeksOn(c, (q.bid + q.ask) / 2, spot, yearsLeft(iso, minute, c.expiry)), intrinsic: cents(intrinsic), dead: false, spot };
}

/** The quote at the end of a minute, as it was recorded: a spread is its two legs at their natural prices */
export function quoteAt(c: ContractId, iso: string, minute: number): Quote {
  if (c.short == null) return legQuote(c, iso, minute);
  const bought = legQuote(longLeg(c), iso, minute);
  const sold = legQuote({ ...longLeg(c), strike: c.short }, iso, minute);
  const width = spreadWidth(c);
  const inside = (v: number) => Math.max(0, Math.min(width, v));
  const intrinsic = cents(inside(bought.intrinsic - sold.intrinsic));
  if (bought.dead || sold.dead) return { ...noQuote(c, bought.spot), intrinsic };
  const bid = cents(inside(bought.bid - sold.ask));
  const ask = cents(Math.max(bid + 0.01, inside(bought.ask - sold.bid)));
  return {
    bid,
    ask,
    mark: cents((bid + ask) / 2),
    iv: bought.iv,
    delta: bought.delta - sold.delta,
    gamma: bought.gamma - sold.gamma,
    theta: bought.theta - sold.theta,
    vega: bought.vega - sold.vega,
    rho: bought.rho - sold.rho,
    intrinsic,
    dead: bid <= 0,
    spot: bought.spot,
  };
}

/* ---- what an open contract is marked at ---- */
export interface Mark {
  /** Dollars a share: the minute's mid, or — in a minute that is no market — the last two-sided mid that day */
  mark: number;
  /** The mark is an earlier minute's, and which */
  staleFrom?: number;
}
/** The contract's mark at the end of a minute. A minute that is no market keeps the last two-sided mid recorded that day,
    said as such; with none that day, NaN (shown as —). A spread is its legs' marks, inside its width. */
export function markAt(c: ContractId, iso: string, minute: number): Mark {
  const q = quoteAt(c, iso, minute);
  if (Number.isFinite(q.mark)) return { mark: q.mark };
  const one = (k: ContractId): { mid: number; from: number } | null => {
    const now = nbboAt(k, iso, minute);
    if (now && now.ask > 0 && now.bid >= 0) return { mid: (now.bid + now.ask) / 2, from: minute };
    const last = lastTwoSidedAt(k, iso, minute);
    return last ? { mid: (last.bid + last.ask) / 2, from: last.minute } : null;
  };
  const a = one(longLeg(c));
  if (!a) return { mark: NaN };
  if (c.short == null) return { mark: cents(a.mid), staleFrom: a.from };
  const b = one({ ...longLeg(c), strike: c.short });
  if (!b) return { mark: NaN };
  return { mark: cents(Math.max(0, Math.min(spreadWidth(c), a.mid - b.mid))), staleFrom: Math.min(a.from, b.from) };
}

/* ---- the bell of an expiry: how a contract settles ---- */
export type SettleStyle = 'cash' | 'exercise';
/** A contract on a cash index (SPXW, NDXP, RUTW) settles in cash on the index's close; one on a stock or a fund is
    exercised at the close when it is in the money (a long option is only ever cash here: the shares it would deliver
    are taken as sold at the same close, so it lands as what it is worth in the money). */
export const settleStyleOf = (ticker: string): SettleStyle => (CASH_INDEX_ROOTS[ticker.toUpperCase()] ? 'cash' : 'exercise');
/** What a contract settles at on its expiry day: what it is worth in the money on the name's close (the 16:00 closing
    print where recorded, else the last bar) — a spread inside its width — or null while that close is not known */
export function settlementAt(c: ContractId, expiryDay: string): { price: number; spot: number; style: SettleStyle; index: string } | null {
  const spot = closePrintOf(c.ticker, expiryDay);
  if (!(spot > 0)) return null;
  const inMoney = (k: number) => Math.max(0, c.right === 'C' ? spot - k : k - spot);
  const price = c.short == null ? inMoney(c.strike) : Math.max(0, Math.min(spreadWidth(c), inMoney(c.strike) - inMoney(c.short)));
  return { price: cents(price), spot, style: settleStyleOf(c.ticker), index: underOf(c.ticker) };
}

/* ---- the what-if: a contract with the name somewhere else this minute ---- */
/** One leg's model value with the name at `spot`, at the vol its recorded mid implies this minute — NaN without a quote */
function legWhatIf(c: ContractId, iso: string, minute: number, spot: number): number {
  const live = legQuote(c, iso, minute);
  const t = yearsLeft(iso, minute, c.expiry);
  if (t <= 0) return intrinsicOf(c, spot);
  if (live.dead || !(live.iv > 0)) return NaN;
  return blackScholesPrice(spot, c.strike, t, live.iv, c.right);
}
/** "Where would the name have to be, right now, for this contract to be worth X": the chart's target and stop lines are
    drawn from it, never a fill. The bid and the ask keep the minute's recorded spread around the model's value. */
export function quoteWith(c: ContractId, iso: string, minute: number, spot: number): Quote {
  const now = quoteAt(c, iso, minute);
  const one = (k: ContractId) => legWhatIf(k, iso, minute, spot);
  const v = c.short == null ? one(c) : one(longLeg(c)) - one({ ...longLeg(c), strike: c.short });
  if (!Number.isFinite(v)) return { ...noQuote(c, spot) };
  const half = now.dead ? 0 : Math.max(0, (now.ask - now.bid) / 2);
  /* a spread is never worth more than its width, whatever its spread */
  const cap = c.short != null ? spreadWidth(c) : Infinity;
  const mid = Math.min(cap, Math.max(0, v));
  return { ...now, bid: cents(Math.min(cap, Math.max(0, mid - half))), ask: cents(Math.min(cap, mid + half)), mark: cents(mid), spot, intrinsic: cents(intrinsicOf(c, spot)), dead: false };
}

/* ---- what was listed on a day ---- */
export interface ListedExpiry {
  iso: string;
  /** "Mar 14" */
  label: string;
  dte: number;
  kind: 'daily' | 'weekly' | 'monthly';
}
/** The third Friday of a month (or the session before it) is the monthly */
const isMonthly = (iso: string) => {
  const d = dateOf(iso);
  return d.getDate() >= 15 && d.getDate() <= 21 && (d.getDay() === 5 || d.getDay() === 4);
};
/** The expiries quoted on a day, nearest first (empty until the day's listing is loaded) */
export function expiriesAt(ticker: string, iso: string, upTo = Infinity): ListedExpiry[] {
  const l = listingOf(ticker, iso);
  if (!l) return [];
  return l.expiries.slice(0, upTo).map(e => ({ iso: e, label: dayWords(e), dte: dteAt(iso, e), kind: isMonthly(e) ? 'monthly' : dateOf(e).getDay() === 5 ? 'weekly' : 'daily' }));
}

interface ChainRow {
  strike: number;
  call: Quote;
  put: Quote;
}
/** The strikes round the money, `each` a side, highest first — the way a chain is read. `centre` holds the ladder on a
    price that stays put (the day's open) so the rows do not slide under the reader every time the name crosses a strike. */
export function chainAt(ticker: string, iso: string, minute: number, expiry: string, each = 10, centre?: number): { spot: number; rows: ChainRow[] } {
  const spot = spotAt(ticker, iso, minute);
  const l = listingOf(ticker, iso);
  const strikes = [...new Set([...(l?.strikes[`${expiry}|C`] ?? []), ...(l?.strikes[`${expiry}|P`] ?? [])])].sort((a, b) => a - b);
  if (!strikes.length || !(spot > 0)) return { spot, rows: [] };
  const mid = centre ?? spot;
  let at = 0;
  for (let i = 0; i < strikes.length; i++) if (Math.abs(strikes[i] - mid) < Math.abs(strikes[at] - mid)) at = i;
  const pick = strikes.slice(Math.max(0, at - each), at + each + 1).reverse();
  return { spot, rows: pick.map(strike => ({ strike, call: quoteAt({ ticker, strike, right: 'C', expiry }, iso, minute), put: quoteAt({ ticker, strike, right: 'P', expiry }, iso, minute) })) };
}

/** Where the name would have to stand, at this minute, for the contract's BID to be `bid` — the nearest such place to
    where it stands now, on the what-if (quoteWith). Walked outward to the first crossing, then closed in on by bisection. */
export const spotForBid = (c: ContractId, iso: string, minute: number, bid: number): number | null => spotForQuote(c, iso, minute, bid, 'bid');
/** …and for its ASK to be `ask` — where a resting buy limit is drawn on the chart: it fills when the ask comes down to it */
export const spotForAsk = (c: ContractId, iso: string, minute: number, ask: number): number | null => spotForQuote(c, iso, minute, ask, 'ask');
function spotForQuote(c: ContractId, iso: string, minute: number, bid: number, which: 'bid' | 'ask'): number | null {
  const here = spotAt(c.ticker, iso, minute);
  if (!(here > 0)) return null;
  const at = (s: number) => quoteWith(c, iso, minute, s)[which];
  const now = at(here);
  if (!Number.isFinite(now)) return null;
  if (Math.abs(now - bid) < 0.005) return cents(here);
  const up = (bid > now) === (c.right === 'C');
  const end = up ? here * 1.8 : here * 0.4;
  const STEPS = 90;
  let a = here;
  let fa = now - bid;
  for (let i = 1; i <= STEPS; i++) {
    const b = here + (end - here) * Math.pow(i / STEPS, 2);
    const fb = at(b) - bid;
    if (fa === 0 || fa * fb <= 0) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const fm = at(mid) - bid;
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      return cents((lo + hi) / 2);
    }
    a = b;
    fa = fb;
  }
  return null;
}

/* ---- a contract's day so far: what a chain's row opens onto ---- */
export interface ContractDay {
  /** The day's highest and lowest mid so far (NaN with no quote yet) */
  high: number;
  low: number;
  /** The last print by this minute, and the contracts traded (NaN until the day's trades load) */
  last: number;
  volume: number;
  /** The name's price at which the contract pays for itself at expiry */
  breakeven: number;
  /** How far the name has to move to get there, signed percent */
  toBreakevenPct: number;
}
export function contractDay(c: ContractId, iso: string, minute: number): ContractDay {
  const mids = midsUpTo(c, iso, minute);
  const q = quoteAt(c, iso, minute);
  const tr = tradesUpTo(c, iso, minute);
  const even = c.right === 'C' ? c.strike + q.ask : c.strike - q.ask;
  return {
    high: mids.length ? Math.max(...mids) : NaN,
    low: mids.length ? Math.min(...mids) : NaN,
    last: tr ? tr.last : NaN,
    volume: tr ? tr.volume : NaN,
    breakeven: q.ask > 0 ? cents(even) : NaN,
    toBreakevenPct: q.ask > 0 && q.spot > 0 ? ((even - q.spot) / q.spot) * 100 : NaN,
  };
}
