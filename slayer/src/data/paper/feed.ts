/* Everything the paper account knows about the market, live from ThetaData (thetaFeed.ts): each name's NBBO, the
   expiries listed today, every contract's NBBO. Fills need a two-sided quote read in the last few seconds, in the
   options session; a kept quote from an earlier visit is shown, stamped, and never fills. The greeks and the IV are
   computed from the quote's mid. The chart's candles are the house's live book. Options only: neither key carries
   futures, and they are not in the product. */

import type { Candle } from '../../types/market';
import type { DeskChain, DeskContract } from '../weigherDesk';
import { isTradingDay, expiryFor, sessionCloseMinOn } from '../../core/calendar';
import { blackScholesGreeks, blackScholesPrice, impliedVolFromPrice } from '../../core/greeks';
import { calendarYears, sigmaToExpiry } from '../../core/volClock';
import { longLeg, spreadBook, spreadSizes, thetaPerSession, bookMark, type ContractId, type ListedExpiry, type Quote } from '../review/quotes';
import { bookCandles } from '../book/levels';
import { ensureBook } from '../book/load';
import { dateAt, lastTradeDayOf, nyAt, sessionFrom, tradingEndsAt, yearsToExpiry, OPEN_MIN } from './clock';
import { paperIndex } from './products';
import { bookOf, feedOffline, isFresh, legQuoteOf, listedExpiries, nameQuote } from './thetaFeed';

/** The feed is live: positions carry from one page load to the next */
export const SIM_FEED = false;
/** This page load's name — a fill carries it so the chart can tell this load's arrows from another's */
export const LIFE = `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
export { feedOffline };

const cents = (v: number) => Math.round(v * 100) / 100;

/* ---- a name ---- */
/** Where the name trades now (its NBBO's mid, an index's price), or NaN until ThetaData answers */
export const spotOf = (ticker: string): number => nameQuote(ticker)?.px ?? NaN;
/** The name's quote and whether it may be filled on */
export function spotRead(ticker: string): { px: number; takenAt: number; kept: boolean; fresh: boolean } | null {
  const q = nameQuote(ticker);
  return q ? { px: q.px, takenAt: q.takenAt, kept: !!q.kept, fresh: isFresh(q.takenAt, q.kept) } : null;
}
const stepGuess = (px: number) => (px < 25 ? 0.5 : px < 200 ? 1 : px < 500 ? 2.5 : 5);
/** The distance between the name's listed strikes near the money: the listed strikes' own gap where they are loaded */
export const stepOf = (ticker: string, expiry?: string | null): number => {
  const px = spotOf(ticker);
  const b = expiry ? bookOf(ticker, expiry) : null;
  if (b && b.strikes.length > 2 && px > 0) {
    let at = 0;
    for (let i = 0; i < b.strikes.length; i++) if (Math.abs(b.strikes[i] - px) < Math.abs(b.strikes[at] - px)) at = i;
    const gap = Math.abs((b.strikes[at + 1] ?? b.strikes[at - 1]) - b.strikes[at]);
    if (gap > 0) return gap;
  }
  const idx = paperIndex(ticker);
  if (idx) return idx.step;
  return Number.isFinite(px) ? stepGuess(px) : 1;
};
/** Today's minute bars for the name, oldest first (empty until the live book lands) */
export const candlesOf = (ticker: string): Candle[] => {
  ensureBook(ticker);
  return bookCandles(ticker) ?? [];
};
/** The instant (seconds) of the newest bar of what the chart draws — a fill's arrow lands there */
export const barNowOf = (ticker: string): number => {
  const bars = bookCandles(ticker);
  return bars?.length ? bars[bars.length - 1].time : Math.floor(Date.now() / 1000);
};

/** The options session: a trading day, 09:30 to 16:00 New York — 13:00 on an early close */
export function optionsOpen(ms: number): boolean {
  const t = nyAt(ms);
  return isTradingDay(dateAt(t.date)) && t.minutes >= OPEN_MIN && t.minutes < sessionCloseMinOn(t.date);
}

/* ---- an option ---- */
const deadQuote = (spot: number): Quote => ({ bid: 0, ask: 0, mark: NaN, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: 0, dead: true, spot });

/** A leg's quote: ThetaData's NBBO, the greeks from its mid. Dead (orders wait) without a two-sided quote read just now. */
function legQuote(c: ContractId, spot: number, ms: number): Quote {
  const s = Number.isFinite(spot) ? spot : 0;
  const intrinsic = s > 0 ? Math.max(0, c.right === 'C' ? s - c.strike : c.strike - s) : 0;
  const q = legQuoteOf(c.ticker, c.expiry, c.strike, c.right);
  if (!q || !(q.ask > 0) || !(q.bid >= 0) || q.ask < q.bid) return { ...deadQuote(s), intrinsic: cents(intrinsic) };
  const mid = (q.bid + q.ask) / 2;
  const t = Math.max(yearsToExpiry(lastTradeDayOf(c), ms), 1 / (252 * 390));
  const iv = s > 0 ? impliedVolFromPrice(mid, s, c.strike, t, c.right) : null;
  const g = iv != null ? blackScholesGreeks(s, c.strike, t, iv) : null;
  /* theta a day: what it loses over one trading session on the trading clock (quotes.ts thetaPerSession) */
  const theta = iv != null ? thetaPerSession(s, c.strike, t, iv, c.right) : 0;
  return {
    bid: q.bid,
    ask: q.ask,
    mark: cents(mid),
    iv: iv ?? 0,
    delta: g ? (c.right === 'C' ? g.deltaCall : g.deltaPut) : 0,
    gamma: g ? g.gamma : 0,
    theta,
    vega: g ? g.vega : 0,
    rho: g ? (c.right === 'C' ? g.rhoCall : g.rhoPut) : 0,
    intrinsic: cents(intrinsic),
    dead: q.bid <= 0 || !isFresh(q.takenAt, q.kept, ms, q.at),
    spot: s,
    /* the sizes shown: a fill takes at most this many of one quote (its stamp is which quote it is) */
    ...(Number.isFinite(q.bidSize) ? { bidSize: q.bidSize } : {}),
    ...(Number.isFinite(q.askSize) ? { askSize: q.askSize } : {}),
    ...(q.at > 0 ? { quotedAt: q.at } : {}),
  };
}

/** The live quote now: the contract's NBBO (a spread from its two legs). Dead — orders wait — without a fresh two-sided quote. */
export const optionQuote = (c: ContractId, ms: number, spot = spotOf(c.ticker)): Quote => {
  if (c.short == null) return legQuote(c, spot, ms);
  const bought = legQuote(longLeg(c), spot, ms);
  const sold = legQuote({ ...longLeg(c), strike: c.short }, spot, ms);
  const width = Math.abs(c.short - c.strike);
  if (!(bought.ask > 0) || !(sold.ask > 0)) {
    const raw = bought.mark - sold.mark;
    const mark = Number.isFinite(raw) ? Math.min(width, Math.max(0, cents(raw))) : NaN;
    return { ...deadQuote(bought.spot), mark };
  }
  const { bid, ask } = spreadBook(bought.bid - sold.ask, bought.ask - sold.bid, width);
  return {
    bid,
    ask,
    mark: bookMark(bid, ask, cents),
    iv: bought.iv,
    delta: bought.delta - sold.delta,
    gamma: bought.gamma - sold.gamma,
    theta: bought.theta - sold.theta,
    vega: bought.vega - sold.vega,
    rho: bought.rho - sold.rho,
    intrinsic: cents(Math.max(0, Math.min(width, bought.intrinsic - sold.intrinsic))),
    dead: bid <= 0 || bought.dead || sold.dead,
    spot: bought.spot,
    ...spreadSizes(bought, sold),
  };
};

/** The at-the-money IV of a chain: each strike's IV the average of its call's and its put's (either alone where only one
    is known), taken at the two listed strikes either side of the name and drawn straight between them, by strike. Past
    the strikes loaded, the nearest one's. NaN with none known. The same rule as the Weigher's `atmIvAt`
    (data/weigherChain.ts) — written here until the two can share one helper. */
export function atmIvAt(rows: { strike: number; call: { iv: number }; put: { iv: number } }[], spot: number): number {
  const ivAt = (r: { call: { iv: number }; put: { iv: number } }) => {
    const v = [r.call.iv, r.put.iv].filter(x => Number.isFinite(x) && x > 0);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
  };
  const known = rows.map(r => ({ k: r.strike, iv: ivAt(r) })).filter(r => Number.isFinite(r.iv)).sort((x, y) => x.k - y.k);
  if (!known.length || !(spot > 0)) return NaN;
  if (spot <= known[0].k) return known[0].iv;
  if (spot >= known[known.length - 1].k) return known[known.length - 1].iv;
  let i = 0;
  while (i < known.length - 1 && known[i + 1].k < spot) i++;
  const lo = known[i];
  const hi = known[i + 1];
  if (hi.k === lo.k) return lo.iv;
  return lo.iv + ((hi.iv - lo.iv) * (spot - lo.k)) / (hi.k - lo.k);
}
/** The one-sigma move to the expiry's close as a share of the name, percent — through core/volClock `sigmaToExpiry`, the
    one expected-move formula. The desk's IV is solved on the trading clock (yearsToExpiry), so it is put on the calendar
    year first with the variance kept (σ_cal² · T_cal = σ_trade² · T_trade): S·σ·√T on either clock is the same move. */
export function expectedMovePctOf(spot: number, ivTradePct: number, c: { ticker: string; expiry: string }, ms: number): number {
  if (!(spot > 0) || !(ivTradePct > 0)) return 0;
  const expiry = lastTradeDayOf(c);
  const tTrade = yearsToExpiry(expiry, ms);
  const tCal = calendarYears(expiry, ms);
  if (!(tTrade > 0) || !(tCal > 0)) return 0;
  const sigmaCal = (ivTradePct / 100) * Math.sqrt(tTrade / tCal);
  const move = sigmaToExpiry(spot, sigmaCal, expiry, ms);
  return move != null && move > 0 ? (move / spot) * 100 : 0;
}

/** The name's at-the-money IV now, from the nearest expiry five days out or more that is loaded — 0 until one is: the
    calls' and puts' IVs at the two strikes either side of the name, drawn straight between them (atmIvAt) */
export function ivOf(ticker: string, ms = Date.now()): number {
  const spot = spotOf(ticker);
  if (!(spot > 0)) return 0;
  const exps = listedNow(ticker, ms);
  const exp = (exps.find(e => e.dte >= 5) ?? exps[0])?.iso;
  const b = exp ? bookOf(ticker, exp) : null;
  if (!b || !b.strikes.length) return 0;
  const below = b.strikes.filter(x => x <= spot).slice(-1);
  const above = b.strikes.filter(x => x > spot).slice(0, 1);
  const rows = [...below, ...above].map(k => ({ strike: k, call: { iv: legQuote({ ticker, strike: k, right: 'C', expiry: exp! }, spot, ms).iv }, put: { iv: legQuote({ ticker, strike: k, right: 'P', expiry: exp! }, spot, ms).iv } }));
  const iv = atmIvAt(rows, spot);
  return Number.isFinite(iv) ? iv : 0;
}

/* The what-if: one leg's Black-Scholes value with the name at `spot`, at the IV its live mid implies */
function legWhatIf(c: ContractId, ms: number, spot: number): number {
  const live = legQuote(c, spotOf(c.ticker), ms);
  const t = Math.max(yearsToExpiry(lastTradeDayOf(c), ms), 1 / (252 * 390));
  if (!(live.iv > 0)) return NaN;
  return blackScholesPrice(spot, c.strike, t, live.iv, c.right);
}
/** The contract's model bid with the name at `spot` — for drawing a line, never for a fill */
export const optionQuoteAt = (c: ContractId, ms: number, spot: number): Quote => {
  const one = (k: ContractId) => legWhatIf(k, ms, spot);
  const v = c.short == null ? one(c) : one(longLeg(c)) - one({ ...longLeg(c), strike: c.short });
  const px = Number.isFinite(v) ? cents(Math.max(0, v)) : 0;
  const live = legQuote(longLeg(c), spotOf(c.ticker), ms);
  const t = Math.max(yearsToExpiry(lastTradeDayOf(c), ms), 1 / (252 * 390));
  const g = live.iv > 0 ? blackScholesGreeks(spot, c.strike, t, live.iv) : null;
  return { bid: px, ask: px, mark: px, iv: live.iv, delta: g ? (c.right === 'C' ? g.deltaCall : g.deltaPut) : 0, gamma: g?.gamma ?? 0, theta: 0, vega: g?.vega ?? 0, rho: 0, intrinsic: 0, dead: !(px > 0), spot };
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

/** The expiries listed now: ThetaData's list for the name, from today; today's leaves at 16:00. Empty until it lands. */
export function listedNow(ticker: string, ms: number): ListedExpiry[] {
  const t = nyAt(ms);
  const from = sessionFrom(t.date);
  const list = listedExpiries(ticker);
  if (!list) return [];
  return list
    .filter(e => e >= from && tradingEndsAt({ ticker, expiry: e }) > ms)
    .slice(0, 24)
    .map(e => {
      const d = dateAt(e);
      const dte = Math.max(0, Math.round((d.getTime() - dateAt(t.date).getTime()) / 86400000));
      const monthly = d.getDate() >= 15 && d.getDate() <= 21 && (d.getDay() === 5 || d.getDay() === 4);
      return { iso: e, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`, dte, kind: monthly ? ('monthly' as const) : d.getDay() === 5 ? ('weekly' as const) : ('daily' as const) };
    });
}

const blankContract = (strike: number, right: 'C' | 'P', spot: number): DeskContract => ({
  strike, right, mark: NaN, delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, itmOdds: NaN, rho: NaN, bid: NaN, ask: NaN, high: NaN, low: NaN, prevClose: NaN, last: NaN, volume: NaN, oi: NaN, breakeven: NaN,
  fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN, bidSize: NaN, askSize: NaN, netChange: NaN, netChangePct: NaN, toBreakevenPct: NaN, intrinsic: NaN, extrinsic: NaN, touchOdds: NaN, profitOddsLong: NaN, profitOddsShort: NaN,
});
/** The chain the paper account trades, as the Weigher's grid draws it: ThetaData's NBBO round the money, lowest first.
    Null until the expiry's quotes land. */
export function liveDeskChain(ticker: string, expiry: string, ms: number, each = 20, centre?: number): DeskChain | null {
  const b = bookOf(ticker, expiry);
  const spot = spotOf(ticker);
  if (!b || !b.strikes.length) return null;
  const mid = centre ?? spot;
  let at = Math.floor(b.strikes.length / 2);
  if (mid > 0) {
    at = 0;
    for (let i = 0; i < b.strikes.length; i++) if (Math.abs(b.strikes[i] - mid) < Math.abs(b.strikes[at] - mid)) at = i;
  }
  const strikes = b.strikes.slice(Math.max(0, at - each), at + each + 1);
  const contract = (strike: number, right: 'C' | 'P'): DeskContract => {
    const q = legQuote({ ticker, strike, right, expiry }, spot, ms);
    const raw = legQuoteOf(ticker, expiry, strike, right);
    if (!raw) return blankContract(strike, right, spot);
    const intrinsic = spot > 0 ? Math.max(0, right === 'C' ? spot - strike : strike - spot) : NaN;
    const even = raw.ask > 0 ? (right === 'C' ? strike + raw.ask : strike - raw.ask) : NaN;
    return {
      ...blankContract(strike, right, spot),
      mark: Number.isFinite(q.mark) ? q.mark : NaN,
      bid: raw.bid,
      ask: raw.ask,
      bidSize: raw.bidSize,
      askSize: raw.askSize,
      iv: q.iv > 0 ? Number((q.iv * 100).toFixed(2)) : NaN,
      delta: q.iv > 0 ? Number(q.delta.toFixed(4)) : NaN,
      gamma: q.iv > 0 ? Number(q.gamma.toFixed(4)) : NaN,
      theta: q.iv > 0 ? Number(q.theta.toFixed(4)) : NaN,
      vega: q.iv > 0 ? Number(q.vega.toFixed(4)) : NaN,
      rho: q.iv > 0 ? Number(q.rho.toFixed(4)) : NaN,
      breakeven: Number.isFinite(even) ? cents(even) : NaN,
      toBreakevenPct: spot > 0 && Number.isFinite(even) ? Number((((even - spot) / spot) * 100).toFixed(2)) : NaN,
      intrinsic: Number.isFinite(intrinsic) ? cents(intrinsic) : NaN,
      extrinsic: Number.isFinite(q.mark) && Number.isFinite(intrinsic) ? cents(Math.max(0, q.mark - intrinsic)) : NaN,
      quotedAt: raw.at,
    };
  };
  const rows = strikes.map(strike => ({ strike, call: contract(strike, 'C'), put: contract(strike, 'P') }));
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]).filter(g => g > 1e-9).sort((x, y) => x - y);
  /* the at-the-money IV at the name, between the strikes either side of it — not the middle of an unsorted list */
  const atmIv = atmIvAt(rows, spot);
  const dte = Math.max(0, Math.round((dateAt(expiry).getTime() - dateAt(nyAt(ms).date).getTime()) / 86400000));
  return {
    ticker,
    spot,
    step: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1,
    rows,
    expiry: expiryFor(dte),
    expectedMovePct: Number.isFinite(atmIv) ? expectedMovePctOf(spot, atmIv, { ticker, expiry }, ms) : 0,
    source: 'live',
    quotedAt: Math.max(0, ...rows.flatMap(r => [r.call.quotedAt ?? 0, r.put.quotedAt ?? 0])),
    expiryIso: expiry,
    takenAt: b.takenAt,
    kept: !!b.kept,
    offline: feedOffline() > 0,
  };
}

export { PAPER_INDEXES, isPaperIndex, paperIndex } from './products';

/** Is the contract's quote (each leg of a spread) a fresh live read — what a fill, and a rule's judgment, need */
export function optionFresh(c: ContractId, ms: number): boolean {
  const legs = c.short == null ? [longLeg(c)] : [longLeg(c), { ...longLeg(c), strike: c.short }];
  return legs.every(k => {
    const q = legQuoteOf(k.ticker, k.expiry, k.strike, k.right);
    return !!q && isFresh(q.takenAt, q.kept, ms, q.at);
  });
}
