/* One read of a Weigher contract. The chain, the case, and the curve ask this. A blank greek stays blank. A
   simulated chain is named, and it is not scored.

   One clock for every model number in a row: the trading clock (core/tradingYear tradingYears, early closes and holidays
   known). A vendor's IV is quoted on the calendar year; it is moved onto the trading clock with the variance unchanged
   (core/volClock vendorIvOnTradingClock) before anything is priced off it, and the IV column keeps the quoted convention.
   Rate and yield are the name's carry (core/carry carryFor), and they accrue on the calendar: on the trading clock they
   are scaled by T_calendar / T_trading (`clockCarry`), so r·T is the calendar's (a 0DTE otherwise accrues a whole
   session of interest in 4 hours, which moved an ATM delta by 0.007). The model is European (Black–Scholes); an American put in the
   money is flagged, not re-priced. */

import { blackScholesGreeks, blackScholesPrice, decayOver, impliedVolFromPrice, thetaPerSession } from '../core/greeks';
import { carryFor, forwardFor, getCarry, DEFAULT_R } from '../core/carry';
import { nyIsoDate } from '../core/nyTime';
import { tradingMinutes, tradingYears, TRADING_DAYS } from '../core/tradingYear';
import { quotedVolPoint, sigmaMoveOfQuotedIv } from '../core/volClock';
import { SPAN_INDEX, strikeSpan, bookBRange, P1_MIN, BID_MIN, SPREAD_MAX, DRIVE, onScanGrid, inLottery, releaseBlocks, QUOTE_MAX_AGE_MS, SEAT_CAP, LOTTERY_ASK_MAX } from './compassParams';
import { optionScanOpen, scanShutWhy } from './compassSession';
import { econReleases } from './monthCalendar';
import { COMPASS_SET } from './compassUniverse';
import type { OptionRight } from '../types/compass';
import type { DeskChain, DeskContract } from './weigherDesk';
import { normCdf as ncdf } from '../core/math';

interface Carry {
  r: number;
  q: number;
}

/** @deprecated The bill rate the carry seam starts at. Price through `carryFor(ticker)` (or `pricerFor`), which also
    carries the name's dividend yield. */
export const WEIGHER_R = DEFAULT_R;
/** @deprecated Zero; a name's yield comes from `carryFor(ticker)`. */
export const WEIGHER_Q = 0;
/** Trading minutes in a full cash session. */
const SESSION_MIN = 390;
/** One trading minute, in trading years. */
const MINUTE_YEARS = 1 / (SESSION_MIN * 252);

/** Weigher theta is per trading session (core/greeks thetaPerSession). Its hourly rate over a full 6.5-hour session.
    Inside the last session prefer the contract's own `thetaHour`, the decay over the next trading hour. */
export const thetaPerSessionHour = (thetaPerSession: number): number => thetaPerSession / (SESSION_MIN / 60);

/** The instant a quoted vol was solved at, when it is a usable one: in the past, with the expiry still open then. Else `now`.
    A calendar-year vol carries the variance of the calendar span it was solved over; moving it onto the trading clock at
    its own instant keeps a Friday-close vol from shrinking over a weekend with no session traded. */
function volInstant(iso: string, now: number, at?: number | null): number {
  if (at == null || !(at > 0) || at > now) return now;
  return tradingMinutes(iso, at, false) != null ? at : now;
}

const isoOf = (expiry: string): string => {
  const d = expiry.replace(/\D/g, '').slice(0, 8);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : expiry;
};

/** Trading years to the expiry's cash close (13:00 on an early close), holidays and weekends out: core/tradingYear
    tradingYears, floored at five trading minutes. Takes YYYY-MM-DD or YYYYMMDD. */
export function yearFracLeft(expiry: string, now = Date.now()): number {
  return tradingYears(isoOf(expiry), now);
}

/** Implied vol off a mark on the clock `t`: core/greeks bisection on [1e-4, 5]. Null when the mark is outside the bracket. */
export function solveIv(mark: number, spot: number, strike: number, t: number, right: OptionRight, carry: Carry = getCarry()): number | null {
  return impliedVolFromPrice(mark, spot, strike, t, right, carry.r, carry.q);
}

/**
 * THE touch odds for every page: the chance a lognormal walk with total log-sd `sigmaT` (σ√T) and total log drift
 * `driftT` (μT) touches `barrier` before the horizon — the reflection principle. With `driftT` 0 this is exactly
 * 2·(1 − Φ(|ln(B/S)| / σ√T)); the Weigher passes (r − q)·T, the walk around the forward. A fraction, 0 to 1.
 */
export function touchChance(spot: number, barrier: number, sigmaT: number, driftT = 0): number {
  if (!(spot > 0) || !(barrier > 0) || !(sigmaT > 0) || !Number.isFinite(driftT)) return NaN;
  const up = barrier > spot;
  if (Math.abs(barrier - spot) < 1e-12) return 1;
  const b = Math.abs(Math.log(barrier / spot));
  const m = up ? driftT : -driftT;
  const p = ncdf((m - b) / sigmaT) + Math.exp((2 * m * b) / (sigmaT * sigmaT)) * ncdf((-b - m) / sigmaT);
  if (!Number.isFinite(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

/** Roots whose options are European (cash-settled index). Everything else listed is American. */
const EUROPEAN_ROOTS = new Set(['SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'DJX', 'OEX', 'XEO', 'MRUT']);

/** True when a European price stands in for an American contract that can be worth more: a put in the money on a
    name whose options exercise early. The UI says so beside the model numbers. */
export function europeanApprox(root: string, right: OptionRight, strike: number, spot: number): boolean {
  return right === 'P' && spot > 0 && strike > spot && !EUROPEAN_ROOTS.has(root.trim().toUpperCase());
}

/** The words for that flag. */
export const EUROPEAN_NOTE = 'European model. This put can be exercised early, so it can be worth more than shown.';

export interface BsRead {
  delta: number;
  gamma: number;
  /** Per trading session (core/greeks thetaPerSession). */
  theta: number;
  /** The decay over the next trading hour, or what is left of the session when less. */
  thetaHour: number;
  /** Per vol point of the vol in `iv`. */
  vega: number;
  rho: number;
  /** Percent. bsOnMark: on the clock it was solved on. readContract: the quoted (calendar-year) convention. */
  iv: number;
  itm: number;
  touch: number;
  profitLong: number;
  profitShort: number;
}

function finishProb(spot: number, level: number, t: number, vol: number, above: boolean, carry: Carry): number {
  if (!(level > 0) || !(spot > 0) || !(t > 0) || !(vol > 0)) return NaN;
  const mu = carry.r - carry.q - (vol * vol) / 2;
  const d2 = (Math.log(spot / level) + mu * t) / (vol * Math.sqrt(t));
  const p = above ? ncdf(d2) : ncdf(-d2);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : NaN;
}

/** Every model number of one contract at vol `vol` on the clock `t` (both the trading clock's), carry `carry`.
    `volPt` rescales vega to a point of the quoted vol (core/volClock quotedVolPoint); 1 keeps it per point of `vol`. */
export function modelAt(spot: number, strike: number, right: OptionRight, bid: number, ask: number, t: number, vol: number, carry: Carry = getCarry(), volPt = 1): BsRead | null {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(vol > 0)) return null;
  const g = blackScholesGreeks(spot, strike, t, vol, carry.r, carry.q);
  const sq = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (carry.r - carry.q + (vol * vol) / 2) * t) / (vol * sq);
  const d2 = d1 - vol * sq;
  const beLong = ask > 0 ? (right === 'C' ? strike + ask : strike - ask) : NaN;
  const beShort = bid >= 0 && Number.isFinite(bid) ? (right === 'C' ? strike + bid : strike - bid) : NaN;
  const itm = right === 'C' ? ncdf(d2) : ncdf(-d2);
  /* a call touches upward, a put downward; already past its strike is a touch */
  const past = right === 'C' ? spot >= strike : spot <= strike;
  const touch = past ? 1 : touchChance(spot, strike, vol * sq, (carry.r - carry.q) * t);
  return {
    delta: right === 'C' ? g.deltaCall : g.deltaPut,
    gamma: g.gamma,
    theta: thetaPerSession(spot, strike, t, vol, right, carry.r, carry.q),
    thetaHour: decayOver(spot, strike, t, vol, right, 60 * MINUTE_YEARS, carry.r, carry.q),
    vega: g.vega * volPt,
    rho: right === 'C' ? g.rhoCall : g.rhoPut,
    iv: vol * 100,
    itm: itm * 100,
    touch: touch * 100,
    profitLong: finishProb(spot, beLong, t, vol, right === 'C', carry) * 100,
    profitShort: finishProb(spot, beShort, t, vol, right === 'P', carry) * 100,
  };
}

/** Greeks from the mark: the vol solved off the mid on the clock `t` (core bisection), then `modelAt`. Blank when the
    quote is not two-sided or the bracket fails. */
export function bsOnMark(spot: number, strike: number, right: OptionRight, bid: number, ask: number, t: number, carry: Carry = getCarry()): BsRead | null {
  const mark = bid >= 0 && ask >= bid && ask > 0 ? (ask + bid) / 2 : NaN;
  if (!(mark > 0) || !(t > 0)) return null;
  const iv = solveIv(mark, spot, strike, t, right, carry);
  if (iv == null) return null;
  return modelAt(spot, strike, right, bid, ask, t, iv, carry);
}

export interface ContractRead extends BsRead {
  /** The vol the trading clock prices, percent. */
  ivTrading: number;
  /** Where the vol came from: the vendor's print, or solved off this contract's mid. */
  ivFrom: 'vendor' | 'mark';
  /** A European price for an American put in the money (EUROPEAN_NOTE). */
  europeanApprox: boolean;
}

/**
 * One chain row's model numbers on one clock. The vol is the vendor's quoted (calendar-year) IV moved onto the trading
 * clock, else the vol solved off the mid on that clock; delta, gamma, theta (per session), vega (per quoted vol point),
 * rho, the finish, touch and profit odds are all priced off that one vol, at `now`, with the name's carry. `iv` comes
 * back in the quoted convention, so a solved row reads like a vendor row. Null with no spot, no clock, or no vol.
 */
export function readContract(input: {
  ticker: string;
  root?: string;
  spot: number;
  strike: number;
  right: OptionRight;
  bid: number;
  ask: number;
  expiryIso: string;
  /** The vendor's IV, a fraction on the calendar year. Absent, 0 or NaN: solve off the mid. */
  vendorIv?: number | null;
  /** When the vendor solved that IV (the quote's stamp), epoch ms. Absent: `now`. */
  ivAt?: number | null;
  now?: number;
}): ContractRead | null {
  const now = input.now ?? Date.now();
  const iso = isoOf(input.expiryIso);
  const { spot, strike, right, bid, ask } = input;
  if (!(spot > 0) || !(strike > 0)) return null;
  const t = tradingYears(iso, now);
  const volPt = quotedVolPoint(iso, volInstant(iso, now, input.ivAt));
  const carry = clockCarry(input.ticker, iso, now);
  let vol: number | null = null;
  let from: 'vendor' | 'mark' = 'vendor';
  const vendor = input.vendorIv;
  if (vendor != null && vendor > 0 && vendor < 5) {
    vol = vendor * volPt;
    /* the vendor solves its IV with no yield (q = 0, its forward S·e^{rT}). Priced on the expiry's own implied forward,
       that vol would misprice the contract by the forward's gap (7.9 points of SPX in January), so it is restated: the
       vendor's own model price, solved again on the implied carry. The price, and the theta off it, do not move. */
    if (carry.implied && carry.q !== 0) {
      const own = blackScholesPrice(spot, strike, t, vol, right, carry.r, 0);
      const again = own > 0 ? solveIv(own, spot, strike, t, right, carry) : null;
      if (again != null && again > 0) vol = again;
    }
  } else {
    const mark = bid >= 0 && ask >= bid && ask > 0 ? (ask + bid) / 2 : NaN;
    vol = mark > 0 ? solveIv(mark, spot, strike, t, right, carry) : null;
    from = 'mark';
  }
  if (vol == null || !(vol > 0)) return null;
  const read = modelAt(spot, strike, right, bid, ask, t, vol, carry, volPt);
  if (!read) return null;
  return {
    ...read,
    /* rho per point of the calendar rate: the trading-clock rate moves k times as fast */
    rho: read.rho * carry.k,
    iv: (vol / volPt) * 100,
    ivTrading: vol * 100,
    ivFrom: from,
    europeanApprox: europeanApprox(input.root || input.ticker, right, strike, spot),
  };
}

/** The name's carry restated on the trading clock: rate and yield × T_calendar / T_trading, so r·T_trading is the
    calendar's r·T (interest accrues overnight and on weekends; variance does not). volPt² is that ratio. */
export function clockCarry(ticker: string, expiryIso: string, now = Date.now()): Carry & { k: number; implied: boolean } {
  /* the expiry's implied yield where its parity forward is known today, else the name's own (core/carry carryFor) */
  const iso = isoOf(expiryIso);
  const c = carryFor(ticker, { expiry: iso, now });
  const pt = quotedVolPoint(iso, now);
  const k = pt * pt;
  return { r: c.r * k, q: c.q * k, k, implied: forwardFor(ticker, iso, nyIsoDate(now)) != null };
}

/** A row's price as a function of spot, on the same clock and carry the row was read on (its quoted IV moved onto the
    trading clock). For the payoff curve. Undefined without a usable IV. */
export function pricerFor(chain: Pick<DeskChain, 'ticker' | 'expiryIso'>, contract: Pick<DeskContract, 'strike' | 'right' | 'iv'>, now = Date.now()): ((s: number) => number) | undefined {
  const quoted = contract.iv / 100;
  if (!(quoted > 0 && quoted < 5) || !chain.expiryIso) return undefined;
  const t = tradingYears(chain.expiryIso, now);
  const vol = quoted * quotedVolPoint(chain.expiryIso, now);
  const carry = clockCarry(chain.ticker, chain.expiryIso, now);
  return (s: number) => blackScholesPrice(s, contract.strike, t, vol, contract.right, carry.r, carry.q);
}

/** The IV at spot, in the rows' own units: at each of the two strikes around spot the mean of the call's and the put's IV
    (whichever are there), then linear in strike between them. One side only: that strike's. 0 with none. */
export function atmIvAt(rows: readonly { strike: number; call: { iv: number }; put: { iv: number } }[], spot: number): number {
  if (!(spot > 0)) return 0;
  const pts: { k: number; iv: number }[] = [];
  for (const r of rows) {
    const legs = [r.call?.iv, r.put?.iv].filter((v): v is number => Number.isFinite(v) && (v as number) > 0);
    if (r.strike > 0 && legs.length) pts.push({ k: r.strike, iv: legs.reduce((a, b) => a + b, 0) / legs.length });
  }
  if (!pts.length) return 0;
  pts.sort((a, b) => a.k - b.k);
  let lo: { k: number; iv: number } | null = null;
  let hi: { k: number; iv: number } | null = null;
  for (const p of pts) {
    if (p.k <= spot) lo = p;
    if (p.k >= spot && !hi) hi = p;
  }
  if (lo && hi) return hi.k === lo.k ? lo.iv : lo.iv + ((hi.iv - lo.iv) * (spot - lo.k)) / (hi.k - lo.k);
  return (lo ?? hi)!.iv;
}

/** The move the options price to the expiry's close, ± percent of spot, from an ATM IV quoted in percent on the calendar
    year: core/volClock sigmaToExpiry (S·σ·√T_calendar), the vol taken at `ivAt` (its quote's instant). 0 once the expiry has closed or without a spot or vol. */
export function expectedMovePctOf(spot: number, atmIvPct: number, expiryIso: string, now = Date.now(), ivAt?: number | null): number {
  if (!(spot > 0) || !(atmIvPct > 0)) return 0;
  const iso = isoOf(expiryIso);
  /* core/volClock sigmaToExpiry, with the vol moved onto the trading clock at the instant it was quoted */
  const left = tradingMinutes(iso, now, false);
  const move = left == null ? null : sigmaMoveOfQuotedIv(spot, atmIvPct / 100, iso, left, volInstant(iso, now, ivAt));
  return move != null && move > 0 ? (move / spot) * 100 : 0;
}

interface GateInput {
  chain: DeskChain;
  contract: DeskContract;
  now?: number;
  /** Minutes since midnight ET. */
  minute?: number;
  p1?: number | null;
  prun?: number | null;
  retOpen?: number | null;
  seats?: number;
  sentRoots?: readonly string[];
  gex?: number | null;
}

interface GateRead {
  status: string;
  passed: string[];
  failed: string | null;
  ticket: boolean;
  /** Higher means it failed later. A pass is 99. */
  rank: number;
}

function nyMinute(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24;
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hh * 60 + mm;
}

function releaseNow(minute: number, now: number): string | null {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  for (const ev of econReleases()) {
    const parts = String(ev.time || '').split(':');
    const hh = Number(parts[0]);
    const mm = Number(parts[1] ?? 0);
    if (!Number.isFinite(hh) || !(ev.date instanceof Date)) continue;
    const evDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ev.date);
    if (evDay === today && releaseBlocks(ev.title, hh * 60 + mm, minute)) return ev.title;
  }
  return null;
}

/** The gate's widest expiry, in trading sessions after today's */
const DTE_GATE_MAX = 7;
const nyDate = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
/** Trading time left to the expiry's close, in full sessions of the clock theta decays on (core/tradingYear
    tradingYears × 252): weekends, holidays and the night are not counted; an early close is the part of a session it is */
export function sessionsLeft(expiry: string, now = Date.now()): number {
  return tradingYears(isoOf(expiry), now) * TRADING_DAYS;
}
/** Whole trading sessions after today's to the expiry on that clock: 0 on the expiry's own day (NaN once it has closed) */
export function sessionDte(expiry: string, now = Date.now()): number {
  const iso = isoOf(expiry);
  if (tradingMinutes(iso, now, false) == null) return NaN;
  if (iso === nyDate(now)) return 0;
  return Math.max(1, Math.ceil(sessionsLeft(iso, now) - 1e-9) - 1);
}

/** The first gate that fails. A simulated chain is not scored and is not a ticket. */
export function readGate(input: GateInput): GateRead {
  const { chain, contract: c } = input;
  const now = input.now ?? Date.now();
  if (chain.source !== 'live') {
    return {
      status: 'Not scored. This chain is simulated.',
      passed: [],
      failed: 'Not scored. This chain is simulated.',
      ticket: false,
      rank: 0,
    };
  }
  const passed: string[] = [];
  const fail = (n: number, status: string): GateRead => ({ status, passed, failed: status, ticket: false, rank: n });
  const minute = input.minute ?? nyMinute(now);
  const t = minute - (9 * 60 + 30);
  const quotedAt = c.quotedAt || chain.quotedAt || 0;
  const quoteBad = !(c.bid >= 0) || !(c.ask > 0) || c.ask < c.bid || !quotedAt || quotedAt > now || now - quotedAt > QUOTE_MAX_AGE_MS;
  if (quoteBad) return fail(1, 'Quote missing, crossed, or older than 90 seconds.');
  passed.push(`Quote ${c.bid.toFixed(2)} × ${c.ask.toFixed(2)}, on this contract.`);

  const bookC = inLottery(minute, 0);
  const bookAB = onScanGrid(t);
  if (!bookAB && !bookC) return fail(2, 'Outside the entry clock. Book A and Book B run every 5 minutes while this name’s options are open. Book C runs from 15:20 to 15:49 ET.');
  passed.push(bookC ? 'Inside the Book C clock.' : 'Inside the Book A and Book B clock.');

  const rel = releaseNow(minute, now);
  if (rel) return fail(3, `Inside 15 minutes of a high-impact release (${rel}). No new ticket.`);
  passed.push('No high-impact release inside 15 minutes.');

  const exp = chain.expiryIso || '';
  const left = exp ? sessionsLeft(exp, now) : NaN;
  const dte = exp ? sessionDte(exp, now) : NaN;
  if (bookC && dte !== 0) return fail(4, 'Book C is same-day only.');
  if (!bookC && !(dte >= 0 && left <= DTE_GATE_MAX + 1 + 1e-9)) return fail(4, 'Expiry is outside 0 to 7 trading sessions.');
  if (!bookC && !optionScanOpen(chain.ticker, dte, now)) return fail(4, scanShutWhy(chain.ticker, dte, now));
  passed.push(dte === 0 ? 'Same-day contract.' : `${left.toFixed(1)} trading sessions to expiration.`);

  if (!(c.bid > BID_MIN)) return fail(5, 'Bid is at or under $0.15.');
  passed.push('Bid is above $0.15.');

  const mid = (c.ask + c.bid) / 2;
  const spread = mid > 0 ? (c.ask - c.bid) / mid : Infinity;
  if (!(spread <= SPREAD_MAX + 1e-9)) return fail(6, 'Spread is over 8% of the mid.');
  passed.push(`Spread ${(spread * 100).toFixed(1)}% of the mid.`);

  const strikes = chain.rows.map(r => r.strike);
  const index = (SPAN_INDEX as readonly string[]).includes(chain.ticker);
  const span = strikeSpan(chain.spot, strikes, index);
  const dist = offsetOf(strikes, chain.spot, c.strike);
  const band = bookBRange(span);
  const inA = Number.isFinite(dist) && dist <= span;
  const inB = Number.isFinite(dist) && dist >= band.inner && dist <= band.outer;
  if (!bookC && !inA && !inB) return fail(7, `Outside the span. This name's span is ${span} strikes. Book B is ${band.inner} to ${band.outer}.`);
  if (!bookC) passed.push(inA ? `Inside Book A. Offset ${dist} of ${span}.` : `Inside Book B. Offset ${dist}.`);

  if (!bookC && inB) {
    const prior = c.priorAsk ?? 0;
    if (!(c.ask <= 1)) return fail(8, 'Book B ask is over $1.00.');
    if (!(prior > 0) || !(c.ask <= 0.5 * prior)) return fail(8, 'Book B needs the ask at or under half the ask from 30 minutes ago. That quote is not here.');
    passed.push('Book B ask is at or under $1 and has halved.');
  }

  const ret = input.retOpen;
  if (!bookC) {
    if (ret == null || !Number.isFinite(ret)) return fail(9, 'The 9:30 open is not in hand, so the side is not named.');
    if (Math.abs(ret) >= DRIVE) {
      const want = ret > 0 ? 'C' : 'P';
      if (c.right !== want) return fail(9, ret > 0 ? 'The stock is up 0.35% or more from the open. Only the call is sent.' : 'The stock is down 0.35% or more from the open. Only the put is sent.');
      passed.push(ret > 0 ? 'Call side of the open.' : 'Put side of the open.');
    } else {
      /* Compass's rule: a flat root is sent only when the opposite side does not clear as well. */
      passed.push('Flat root. Sent only if the opposite side does not clear too.');
    }
  } else if (!(c.ask <= LOTTERY_ASK_MAX)) {
    return fail(8, 'Book C ask is over $1.65.');
  }

  if (!bookC) {
    if (input.p1 == null || !Number.isFinite(input.p1)) return fail(11, 'The line has not been read. No number was invented.');
    if (input.p1 + 1e-12 < P1_MIN) return fail(11, 'Short of the line. A call needs 70.67%.');
    passed.push('The line cleared.');
  }

  if (!COMPASS_SET.has(chain.ticker)) return fail(12, 'The math passes. Compass does not send this name.');
  passed.push('The name is on the 458.');

  const seats = input.seats ?? 0;
  const sent = input.sentRoots ?? [];
  if (sent.includes(chain.ticker)) return fail(13, 'This root was already sent today.');
  if (seats >= SEAT_CAP) return fail(13, 'Five seats are full.');
  passed.push('A seat is open.');

  return {
    status: bookC ? 'Book C. No score. Entry is this ask.' : inB ? 'The math passes. The exit rides.' : 'The math passes. Entry is this ask.',
    passed,
    failed: null,
    ticket: true,
    rank: 99,
  };
}

export function offsetOf(strikes: readonly number[], spot: number, strike: number): number {
  const ordered = [...new Set(strikes.filter(k => k > 0))].sort((a, b) => a - b);
  if (!ordered.length || !(spot > 0)) return NaN;
  let atm = ordered[0];
  let best = Math.abs(ordered[0] - spot);
  for (const k of ordered) {
    const d = Math.abs(k - spot);
    if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && k < atm)) {
      best = d;
      atm = k;
    }
  }
  const ai = ordered.findIndex(k => Math.abs(k - atm) < 1e-9);
  const si = ordered.findIndex(k => Math.abs(k - strike) < 1e-9);
  if (ai < 0 || si < 0) return NaN;
  return Math.abs(si - ai);
}

export function spanOf(chain: DeskChain): number {
  return strikeSpan(chain.spot, chain.rows.map(r => r.strike), (SPAN_INDEX as readonly string[]).includes(chain.ticker));
}
