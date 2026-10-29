/*
  Everything the paper account knows about the market comes through this file, and all of it is live:
    a name's price        the vendor's regular-session price (liveQuote; an index from the vendor book)
    an option's quote     the contract's own NBBO from Unusual Whales' listed contracts (weigherChain)
    what is listed        the vendor's listed expiries for the name
    a name's candles      today's minute bars from the vendor book
  An order fills only on a two-sided live quote during the options session; with no quote it waits. Futures are not
  carried (the keys have no futures feed), so the paper desk does not trade them.
  The one modelled number is a what-if: where the name would have to stand for a contract to bid a price, which is
  Black-Scholes at the IV solved from the contract's live mark. It places lines on the chart; it never fills.
*/

import type { Candle } from '../../types/market';
import type { DeskChain } from '../weigherDesk';
import { isTradingDay } from '../../core/calendar';
import { blackScholesGreeks, blackScholesPrice } from '../../core/greeks';
import { expiriesAt, longLeg, type ContractId, type ListedExpiry, type Quote } from '../review/quotes';
import { bookCandles, ensureBook, peekIv } from '../uwBook';
import { ensureMarks, listedOf, liveSpotOf, peekMark, sheetChain } from '../weigherChain';
import { solveIv } from '../weigherGate';
import { bellOf, dateAt, nyAt, sessionFrom, yearsToExpiry, OPEN_MIN, BELL_MIN } from './clock';
import { paperIndex } from './products';

/** The feed is live: positions carry from one page load to the next */
export const SIM_FEED = false;
/** This page load's name — a fill carries it so the chart can tell this load's arrows from another's */
export const LIFE = `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
/** The keys carry no futures feed: the paper desk trades options only */
export const FUTURES_LIVE = false;
export const FUTURES_OFF_WORDS = 'Futures are paused: the app has no live futures feed, and it will not price them from a stock.';

const cents = (v: number) => Math.round(v * 100) / 100;

/* ---- a name ---- */
/** Where the name trades now, or NaN until the live price lands */
export const spotOf = (ticker: string): number => liveSpotOf(ticker) ?? NaN;
/** The name's live at-the-money IV (decimal), else 20% — what the chart's reach is drawn with */
export const baseIvOf = (ticker: string): number => peekIv(paperIndex(ticker)?.symbol ?? ticker) ?? 0.2;
const stepGuess = (px: number) => (px < 25 ? 0.5 : px < 200 ? 1 : px < 500 ? 2.5 : 5);
/** The distance between the name's listed strikes near the money */
export const stepOf = (ticker: string): number => {
  const idx = paperIndex(ticker);
  if (idx) return idx.step;
  const px = spotOf(ticker);
  return Number.isFinite(px) ? stepGuess(px) : 1;
};
/** Today's minute bars for the name, oldest first (empty until the vendor book lands) */
export const candlesOf = (ticker: string): Candle[] => {
  ensureBook(ticker);
  return bookCandles(ticker) ?? [];
};
/** The instant (seconds) of the newest bar of what the chart draws — a fill's arrow lands there */
export const barNowOf = (ticker: string): number => {
  const bars = bookCandles(ticker);
  return bars?.length ? bars[bars.length - 1].time : Math.floor(Date.now() / 1000);
};

/** The options session: a trading day, 09:30 to 16:00 New York */
export function optionsOpen(ms: number): boolean {
  const t = nyAt(ms);
  return isTradingDay(dateAt(t.date)) && t.minutes >= OPEN_MIN && t.minutes < BELL_MIN;
}

/* ---- an option ---- */
const deadQuote = (spot: number): Quote => ({ bid: 0, ask: 0, mark: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead: true, spot });

function legQuote(c: ContractId, spot: number): Quote {
  void ensureMarks(c.ticker, c.expiry);
  const m = peekMark(c.ticker, c.expiry, c.strike, c.right);
  const s = Number.isFinite(spot) ? spot : 0;
  const intrinsic = s > 0 ? Math.max(0, c.right === 'C' ? s - c.strike : c.strike - s) : 0;
  if (!m || !(m.ask > 0) || !(m.bid >= 0)) return { ...deadQuote(s), intrinsic: cents(intrinsic), mark: m && m.mark > 0 ? m.mark : 0 };
  return {
    bid: m.bid,
    ask: m.ask,
    mark: cents((m.bid + m.ask) / 2),
    iv: m.iv,
    delta: m.delta,
    gamma: m.gamma,
    theta: m.theta,
    vega: m.vega,
    rho: 0,
    intrinsic: cents(intrinsic),
    dead: m.bid <= 0,
    spot: s,
  };
}

/** The live quote now: the contract's NBBO (a spread from its two legs). Dead — orders wait — without a two-sided quote. */
export const optionQuote = (c: ContractId, _ms: number, spot = spotOf(c.ticker)): Quote => {
  if (c.short == null) return legQuote(c, spot);
  const bought = legQuote(longLeg(c), spot);
  const sold = legQuote({ ...longLeg(c), strike: c.short }, spot);
  if (bought.dead || sold.dead) return { ...deadQuote(bought.spot), mark: bought.mark - sold.mark };
  const width = Math.abs(c.short - c.strike);
  const inside = (v: number) => Math.max(0, Math.min(width, v));
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
    rho: 0,
    intrinsic: cents(inside(bought.intrinsic - sold.intrinsic)),
    dead: bid <= 0,
    spot: bought.spot,
  };
};

/* The what-if: one leg's Black-Scholes value with the name at `spot`, at the IV its live mark implies */
function legWhatIf(c: ContractId, ms: number, spot: number): number {
  const live = legQuote(c, spotOf(c.ticker));
  const here = live.spot;
  const t = Math.max(yearsToExpiry(c.expiry, ms), 1 / (252 * 390));
  const iv = live.mark > 0 && here > 0 ? solveIv(live.mark, here, c.strike, t, c.right) : null;
  if (iv == null) return NaN;
  return blackScholesPrice(spot, c.strike, t, iv, c.right);
}
/** The contract's model bid with the name at `spot` — for drawing a line, never for a fill */
export const optionQuoteAt = (c: ContractId, ms: number, spot: number): Quote => {
  const one = (k: ContractId) => legWhatIf(k, ms, spot);
  const v = c.short == null ? one(c) : one(longLeg(c)) - one({ ...longLeg(c), strike: c.short });
  const px = Number.isFinite(v) ? cents(Math.max(0, v)) : 0;
  const t = Math.max(yearsToExpiry(c.expiry, ms), 1 / (252 * 390));
  const g = blackScholesGreeks(spot, c.strike, t, Math.max(0.01, baseIvOf(c.ticker)));
  return { bid: px, ask: px, mark: px, iv: 0, delta: c.right === 'C' ? g.deltaCall : g.deltaPut, gamma: g.gamma, theta: 0, vega: g.vega, rho: 0, intrinsic: 0, dead: !(px > 0), spot };
};

/** Where the name would have to stand now for the contract to bid `bid` — the nearest such place on the what-if */
export const spotForBidNow = (c: ContractId, ms: number, bid: number): number | null => spotForQuoteNow(c, ms, bid);
/** …and to ask `ask` — where a resting buy limit is drawn */
export const spotForAskNow = (c: ContractId, ms: number, ask: number): number | null => spotForQuoteNow(c, ms, ask);
function spotForQuoteNow(c: ContractId, ms: number, target: number): number | null {
  const here = spotOf(c.ticker);
  if (!(here > 0) || !(target >= 0)) return null;
  const at = (s: number) => optionQuoteAt(c, ms, s).bid;
  const now = at(here);
  if (!(now > 0)) return null;
  if (Math.abs(now - target) < 0.005) return cents(here);
  const up = (target > now) === (c.right === 'C');
  const end = up ? here * 1.8 : here * 0.4;
  const STEPS = 90;
  let a = here;
  let fa = now - target;
  for (let i = 1; i <= STEPS; i++) {
    const b = here + (end - here) * Math.pow(i / STEPS, 2);
    const fb = at(b) - target;
    if (fa === 0 || fa * fb <= 0) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const fm = at(mid) - target;
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

/** The expiries listed now: the vendor's list for the name; today's leaves at 16:00 */
export function listedNow(ticker: string, ms: number): ListedExpiry[] {
  const t = nyAt(ms);
  const from = sessionFrom(t.date);
  const name = ticker.toUpperCase();
  const live = listedOf(name);
  if (live) {
    return live
      .filter(e => e.iso >= from && bellOf(e.iso) > ms)
      .slice(0, 24)
      .map(e => ({ iso: e.iso, label: e.label || e.iso, dte: e.dte, kind: 'weekly' as const }));
  }
  /* until the vendor's list lands, the house calendar's dailies, weeklies and monthlies stand in for the picker */
  return expiriesAt(name, from).filter(e => bellOf(e.iso) > ms);
}

/** The chain the paper account trades, as the Weigher draws it: the vendor's contracts round the money, lowest first */
export function liveDeskChain(ticker: string, expiry: string, _ms: number, each = 20, centre?: number): DeskChain {
  void ensureMarks(ticker, expiry);
  return sheetChain(ticker, expiry, each, undefined, centre);
}

/* ---- futures: not carried ---- */
export { PAPER_FUTURES, PAPER_INDEXES, bigOf, frontOn, futOfFund, futWords, isMicro, isPaperFuture, isPaperIndex, paperFut, paperIndex, type PaperFutProduct } from './products';
/** No live futures price */
export const futNow = (_symbol: string): number => NaN;
/** No live futures candles */
export const futCandles = (_symbol: string): Candle[] => [];
