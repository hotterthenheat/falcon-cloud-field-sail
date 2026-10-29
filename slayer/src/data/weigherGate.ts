/*
  One read of a Weigher contract. The chain, the case, and the curve ask this.
  A blank greek stays blank. A simulated chain is named, and it is not scored.
*/

import { blackScholesPrice } from '../core/greeks';
import { weekdayDte, SPAN_INDEX, strikeSpan, bookBRange, P1_MIN, BID_MIN, SPREAD_MAX, DRIVE, onScanGrid, inLottery, releaseBlocks, QUOTE_MAX_AGE_MS, SEAT_CAP, LOTTERY_ASK_MAX } from './compassParams';
import { optionScanOpen, scanShutWhy } from './compassSession';
import { econReleases } from './monthCalendar';
import { COMPASS_SET } from './compassUniverse';
import type { OptionRight } from '../types/compass';
import type { DeskChain, DeskContract } from './weigherDesk';

export const WEIGHER_R = 0.042;
export const WEIGHER_Q = 0;
/* Theta is shown per calendar day across the app, the same as the ThetaData feed and Compass. */
export const THETA_DAYS = 365;
/** A calendar-day theta as the decay over one hour of the cash session (6.5 hours, 252 sessions a year). */
export const thetaPerSessionHour = (thetaPerDay: number): number => (thetaPerDay * THETA_DAYS) / (252 * 6.5);

function ncdf(x: number): number {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - d * p : d * p;
}

/** Weekday sessions left, including what is left of today, over 390 × 252, plus 1e−6. */
export function yearFracLeft(expiryYmd: string, now = Date.now()): number {
  const session = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const ahead = weekdayDte(session.replace(/-/g, ''), expiryYmd.replace(/-/g, ''));
  if (!Number.isFinite(ahead) || ahead < 0) return 1e-6;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24;
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const minute = hh * 60 + mm;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  const leftToday = minute < close ? Math.max(0, close - Math.max(minute, open)) : 0;
  const mins = ahead * 390 + leftToday;
  return mins / (390 * 252) + 1e-6;
}

/** 60 bisections on [0.01, 8]. Null when the mark is outside the bracket. */
export function solveIv(mark: number, spot: number, strike: number, t: number, right: OptionRight): number | null {
  if (!(mark > 0) || !(spot > 0) || !(strike > 0) || !(t > 0)) return null;
  let lo = 0.01;
  let hi = 8;
  const at = (v: number) => blackScholesPrice(spot, strike, t, v, right, WEIGHER_R, WEIGHER_Q);
  if (mark < at(lo) - 1e-6 || mark > at(hi) + 1e-4) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < mark) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface BsRead {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  itm: number;
  touch: number;
  profitLong: number;
  profitShort: number;
}

/** Chance the price touches `barrier` before `t`, under the risk-neutral lognormal walk (the reflection-principle formula). */
export function touchProb(spot: number, barrier: number, t: number, vol: number, up: boolean, r = WEIGHER_R, q = WEIGHER_Q): number {
  if (!(spot > 0) || !(barrier > 0) || !(t > 0) || !(vol > 0)) return NaN;
  if (up && spot >= barrier) return 1;
  if (!up && spot <= barrier) return 1;
  const mu = r - q - (vol * vol) / 2;
  const s = vol * Math.sqrt(t);
  const d = (Math.log(spot / barrier) + mu * t) / s;
  const lam = (2 * mu) / (vol * vol);
  const shift = (2 * mu * t) / s;
  const p = up
    ? ncdf(d) + Math.pow(barrier / spot, lam) * ncdf(d - shift)
    : ncdf(-d) + Math.pow(barrier / spot, lam) * ncdf(-d + shift);
  if (!Number.isFinite(p)) return NaN;
  return Math.min(1, Math.max(0, p));
}

function finishProb(spot: number, level: number, t: number, vol: number, above: boolean): number {
  if (!(level > 0) || !(spot > 0) || !(t > 0) || !(vol > 0)) return NaN;
  const mu = WEIGHER_R - WEIGHER_Q - (vol * vol) / 2;
  const d2 = (Math.log(spot / level) + mu * t) / (vol * Math.sqrt(t));
  const p = above ? ncdf(d2) : ncdf(-d2);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : NaN;
}

/** Greeks from the mark. IV is 60 bisections on [0.01, 8]. Blank when the bracket fails. The vendor's IV is not used. */
export function bsOnMark(spot: number, strike: number, right: OptionRight, bid: number, ask: number, t: number): BsRead | null {
  const mark = bid >= 0 && ask >= bid && ask > 0 ? (ask + bid) / 2 : NaN;
  if (!(mark > 0) || !(t > 0)) return null;
  const iv = solveIv(mark, spot, strike, t, right);
  if (iv == null) return null;
  const sq = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (WEIGHER_R + (iv * iv) / 2) * t) / (iv * sq);
  const d2 = d1 - iv * sq;
  const df = Math.exp(-WEIGHER_R * t);
  const pdf = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  const nd1 = ncdf(d1);
  const nd2 = ncdf(d2);
  const thetaYear =
    -(spot * pdf * iv) / (2 * sq) -
    (right === 'C' ? WEIGHER_R * strike * df * nd2 : -WEIGHER_R * strike * df * ncdf(-d2));
  const beLong = right === 'C' ? strike + ask : strike - ask;
  const beShort = right === 'C' ? strike + Math.max(0, bid) : strike - Math.max(0, bid);
  const itm = right === 'C' ? nd2 : ncdf(-d2);
  const touch = touchProb(spot, strike, t, iv, right === 'C');
  const profitLong = finishProb(spot, beLong, t, iv, right === 'C');
  const profitShort = finishProb(spot, beShort, t, iv, right === 'P');
  return {
    delta: right === 'C' ? nd1 : nd1 - 1,
    gamma: pdf / (spot * iv * sq),
    theta: thetaYear / THETA_DAYS,
    vega: (spot * sq * pdf) / 100,
    rho: ((right === 'C' ? 1 : -1) * strike * t * df * (right === 'C' ? nd2 : ncdf(-d2))) / 100,
    iv: iv * 100,
    itm: itm * 100,
    touch: touch * 100,
    profitLong: profitLong * 100,
    profitShort: profitShort * 100,
  };
}

export interface GateInput {
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

export interface GateRead {
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

  const session = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const exp = chain.expiryIso || '';
  const dte = exp ? weekdayDte(session.replace(/-/g, ''), exp.replace(/-/g, '')) : NaN;
  if (bookC && dte !== 0) return fail(4, 'Book C is same-day only.');
  if (!bookC && !(dte >= 0 && dte <= 7)) return fail(4, 'DTE is outside 0 to 7 weekday sessions.');
  if (!bookC && !optionScanOpen(chain.ticker, dte, now)) return fail(4, scanShutWhy(chain.ticker, dte, now));
  passed.push(dte === 0 ? 'Same-day contract.' : `${dte} weekday sessions to expiration.`);

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
    if (input.p1 == null || !Number.isFinite(input.p1)) return fail(11, 'Model 1 has not scored this contract. No number was invented.');
    passed.push(`Model 1 ${(input.p1 * 100).toFixed(1)}%.${input.prun != null && Number.isFinite(input.prun) ? ` Model 2 ${(input.prun * 100).toFixed(0)}%.` : ''}`);
    if (input.p1 + 1e-12 < P1_MIN) return fail(11, `Model 1 ${(input.p1 * 100).toFixed(1)}%. Needs 70.67%.`);
  }

  if (!COMPASS_SET.has(chain.ticker)) return fail(12, 'The math passes. Compass does not send this name.');
  passed.push('The name is on the 458.');

  const seats = input.seats ?? 0;
  const sent = input.sentRoots ?? [];
  if (sent.includes(chain.ticker)) return fail(13, 'This root was already sent today.');
  if (seats >= SEAT_CAP) return fail(13, 'Five seats are full.');
  passed.push('A seat is open.');

  return {
    status: bookC ? 'Book C. No model. Entry is this ask.' : inB ? 'Book B. Model 1 cleared. The exit is the runner ratchet.' : 'Book A. Model 1 cleared. Entry is this ask.',
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
