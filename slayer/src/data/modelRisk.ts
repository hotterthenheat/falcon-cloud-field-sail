/* Model Risk — tail risk. A fade, not Model 1, 2, 3 or 4. No session window.

   Any minute of the day. The range is the high and low of the last 30 minute-closes strictly
   before the decision minute, whatever hour they printed. A close above that high buys the put.
   A close under that low buys the call. No 0.5322 stop. No five-minute flip. No flat at 16:00.
   If the close has not come back through the line within 30 minutes, the break held and the bid is sold.
   One contract at a time. The next name waits until that one is out.
   Dealer gamma is a label only.

   Books are Compass's own chain: "0" is same-day, "1-7" is one to seven trading days out.
*/

import { normCdf } from '../core/math';
import { R, SESSION_MIN, YEAR_SESSIONS } from './compassParams';
import { ivStates } from './compassFeatures';

export const TAIL_NAME = 'Model Risk';
export const TAIL_BOOK = 'Tail risk';
/** A quote older than this is not a fill. A quote exactly this old still is. */
export const TAIL_QUOTE_MS = 1000;
/** Open tickets the desk used to allow on one book. The live rule is one open ticket, either book. */
export const TAIL_OPEN_MAX = 5;
/** One open contract. The next break waits until this one is out. */
export const TAIL_OPEN_NOW = 1;
/** Minutes the close is given to come back. After that the break held. */
export const TAIL_FADE_MIN = 30;
/** A strike farther than this from the stock is not this fade. */
export const TAIL_MONEY = 0.015;
/** Wider than this is the spread, not the trade. Tighter than the chain's 8%. */
export const TAIL_SPREAD = 0.04;
/** A single name at this ask or higher is refused. An index is not. */
export const TAIL_ASK_CAP = 5;
/** A score inside this band of the leader loses to the strike closer to the stock. */
export const TAIL_SCORE_BAND = 0.05;
export const TAIL_FIRST = 30;
export const TAIL_LAST = 389;

export type TailBook = '0' | '1-7';

export interface TailTicket {
  id: string;
  day: string;
  book: TailBook;
  /** Put fades a close above the opening high. Call fades a close under the opening low. */
  right: 'C' | 'P';
  ticker: string;
  /** The option root the chain was read on */
  root: string;
  contract: string;
  strike: number;
  expiry: string;
  expiryTradingDays: number;
  /** Minute of the New York day the close armed it. 0 is midnight. 570 is 09:30. */
  entryMinute: number;
  entryAsk: number;
  entryBid: number;
  entryAt: number;
  spot: number;
  orHigh: number;
  orLow: number;
  score: number;
  iv: number;
  gamma: number;
  thetaYear: number;
  /** Sum of the vendor's call_gamma_oi + put_gamma_oi. Label only. Null when the page did not answer. */
  gex: number | null;
  exitMinute: number | null;
  exitBid: number | null;
  exitAt: number | null;
  /** 'back' is the first later close back through the line. 'held' is 30 minutes with no cross. 'flat' is an old ticket closed at 15:59. */
  why: 'back' | 'held' | 'flat' | null;
}

export interface TailPublic {
  day: string;
  /** Names whose trailing range is set */
  armed: number;
  /** Names whose bars have been read today */
  read: number;
  open: TailTicket[];
  closed: TailTicket[];
  line: string;
}

export function emptyTail(day = ''): TailPublic {
  return {
    day,
    armed: 0,
    read: 0,
    open: [],
    closed: [],
    line: 'Tail risk. All day. One contract until it is out. The last 30 minute-closes.',
  };
}

/** Minutes after 09:30. 09:30 is 0. 15:59 is 389. 16:00 is 390. */
export function cashMinute(minuteOfDay: number): number {
  return minuteOfDay - 570;
}

/** The scan runs every minute of the New York day. There is no session window. */
export function inTailWindow(minuteOfDay: number): boolean {
  return minuteOfDay >= 0 && minuteOfDay < 24 * 60;
}

/** Cash minute the rank clock uses. Before 09:30 a same-day contract still has the session ahead, so the clock stays
    at the open. At 16:00 and after, same-day time left is 0. */
export function rankMinute(minuteOfDay: number): number {
  const cash = cashMinute(minuteOfDay);
  return cash < 0 ? 0 : cash;
}

/** Opening range from the minute closes on 0..29. A minute with no print is skipped. Not the bar high or the bar low.
    The caller waits until minute 29 is in the past before trusting it. */
export function openingRange(closes: readonly (number | null | undefined)[]): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  let n = 0;
  const end = Math.min(29, closes.length - 1);
  for (let i = 0; i <= end; i++) {
    const c = closes[i];
    if (!(c != null && c > 0)) continue;
    n += 1;
    if (c > high) high = c;
    if (c < low) low = c;
  }
  return n > 0 ? { high, low } : null;
}

/** High and low of the last 30 minute-closes strictly before `minute`. A missing minute is skipped. Fewer than 30 closes is not a range. */
export function trailRange(closes: readonly (number | null | undefined)[], minute: number): { high: number; low: number } | null {
  let high = -Infinity;
  let low = Infinity;
  let n = 0;
  const start = Math.min(minute - 1, closes.length - 1);
  for (let i = start; i >= 0 && n < TAIL_FIRST; i--) {
    const c = closes[i];
    if (!(c != null && c > 0)) continue;
    n += 1;
    if (c > high) high = c;
    if (c < low) low = c;
  }
  return n >= TAIL_FIRST ? { high, low } : null;
}

/** Put when the close is above the range. Call when it is under. A close on the line is not a break. */
export function breakSide(px: number, high: number, low: number): 'C' | 'P' | null {
  if (!(px > 0) || !(high > 0) || !(low > 0)) return null;
  if (px > high) return 'P';
  if (px < low) return 'C';
  return null;
}

/** Minutes left on the trading-year clock. Same-day at minute 0 is 390. A 3-day put at minute 0 is 1560. */
export function minutesLeft(minute: number, expiryTradingDays: number): number {
  return Math.max(0, SESSION_MIN - minute) + Math.max(0, expiryTradingDays) * SESSION_MIN;
}

export function yearFracOf(minute: number, expiryTradingDays: number): number {
  return minutesLeft(minute, expiryTradingDays) / (SESSION_MIN * YEAR_SESSIONS);
}

/** Gamma and theta-year off the weigher's Black–Scholes (r = 0.042, q = 0). No contract when IV will not solve, theta is not a decay, or gamma is not positive. */
export function contractRank(S: number, K: number, minute: number, expiryTradingDays: number, mid: number, call: boolean): { iv: number; gamma: number; thetaYear: number; score: number } | null {
  const T = yearFracOf(minute, expiryTradingDays);
  if (!(S > 0) || !(K > 0) || !(mid > 0) || !(T > 0)) return null;
  const iv = ivStates(mid, S, K, T, call);
  if (!(iv > 0)) return null;
  const vol = iv * Math.sqrt(T);
  if (!(vol > 0)) return null;
  const d1 = (Math.log(S / K) + (R + 0.5 * iv * iv) * T) / vol;
  const d2 = d1 - vol;
  const df = Math.exp(-R * T);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const gamma = pdf / (S * vol);
  const carry = R * K * df * normCdf(call ? d2 : -d2);
  const thetaYear = -(S * pdf * iv) / (2 * Math.sqrt(T)) + (call ? -carry : carry);
  if (!(thetaYear < 0) || !(gamma > 0)) return null;
  return { iv, gamma, thetaYear, score: gamma / Math.abs(thetaYear) };
}

/** Put gamma and theta-year. No contract when IV will not solve, theta is not a decay, or gamma is not positive. */
export function putRank(S: number, K: number, minute: number, expiryTradingDays: number, mid: number): { iv: number; gamma: number; thetaYear: number; score: number } | null {
  return contractRank(S, K, minute, expiryTradingDays, mid, false);
}

/** The first later close back through the line, or the first close once 30 minutes have passed without one. */
export function exitAt(closes: readonly (number | null | undefined)[], entryMinute: number, line: number, right: 'C' | 'P' = 'P'): { minute: number; why: 'back' | 'held' } | null {
  const deadline = entryMinute + TAIL_FADE_MIN;
  for (let m = entryMinute + 1; m < closes.length; m++) {
    const c = closes[m];
    if (!(c != null && c > 0)) continue;
    if (right === 'C' ? c >= line : c <= line) return { minute: m, why: 'back' };
    if (m >= deadline) return { minute: m, why: 'held' };
  }
  return null;
}

export function tailReturn(entryAsk: number, exitBid: number): number {
  if (!(entryAsk > 0)) return NaN;
  return (exitBid - entryAsk) / entryAsk;
}

export function tailDollars(entryAsk: number, exitBid: number, contracts = 1): number {
  return (exitBid - entryAsk) * 100 * contracts;
}

const INDEX_ROOTS = new Set(['SPX', 'SPY', 'QQQ', 'IWM', 'RUT', 'NDX', 'VIX', 'XSP', 'DJX', 'SPXW', 'RUTW', 'NDXP']);

/** A single name is capped. An index, and the root it lists on, is not. */
export function askCapped(ticker: string, root: string): boolean {
  return !INDEX_ROOTS.has(ticker.toUpperCase()) && !INDEX_ROOTS.has(root.toUpperCase());
}

/** Refuse a wing, a wide quote, or a single name priced at the cap or above. The chain's 8% gate still runs first. */
export function tailQuoteOk(bid: number, ask: number, strike: number, spot: number, ticker: string, root: string): boolean {
  if (!(spot > 0) || !(strike > 0) || !(ask > 0) || !(bid >= 0) || ask < bid) return false;
  if (Math.abs(strike - spot) / spot > TAIL_MONEY + 1e-12) return false;
  const mid = (ask + bid) / 2;
  if (!(mid > 0) || (ask - bid) / mid > TAIL_SPREAD + 1e-12) return false;
  if (askCapped(ticker, root) && ask >= TAIL_ASK_CAP) return false;
  return true;
}

/** Higher score wins. Inside the band, the strike closer to the stock wins, so a tied rank is not a coin flip. */
export function betterRank(score: number, dist: number, bestScore: number, bestDist: number): boolean {
  if (!(bestScore > 0)) return score > 0;
  const rel = score / bestScore;
  if (rel > 1 + TAIL_SCORE_BAND) return true;
  if (rel < 1 - TAIL_SCORE_BAND) return false;
  return dist < bestDist - 1e-12;
}

/** A quote this old still fills. Older than 1000 ms does not. */
export function quoteFresh(quotedAt: number, now: number): boolean {
  return quotedAt > 0 && now >= quotedAt && now - quotedAt <= TAIL_QUOTE_MS;
}
