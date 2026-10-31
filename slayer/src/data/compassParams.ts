import { MARKET_HOLIDAYS } from '../core/calendar';

/* Compass parameters, in one place. The entry and runner trees ship in public/models; scoring stays shut until
   those files hash to the values below. */

export const UNIVERSE_SHA = 'eb0ed706ae8dd5d5442a99d012db5077e6f9ba1ad0ef10a551af36b87840ef7e';
export const UNIVERSE_N = 458;

export const ENTRY_SHA = '94592d667860d271e85e24dc9f8e82252b71d393c97cb019af871bd3782bdb8d';
export const RUNNER_SHA = '8a41876361259eec2c525b1977f703ddb0944bd2c39784fe3484959b1037302c';
export const TREE_N = 300;

export const R = 0.042;
export const Q = 0;
export const SESSION_MIN = 390;
export const YEAR_SESSIONS = 252;
const T_EPS = 1e-6;

export const IV_LO = 0.01;
export const IV_HI = 8;
export const IV_BISECTS = 60;
export const IV_FEATURE_MIN = 0.011;
const IV_FALLBACK = 0.3;

export const BID_MIN = 0.15;
export const SPREAD_MAX = 0.08;
const SPREAD_EPS = 1e-9;

export const P1_MIN = 0.7067;
const PRUN_MIN = 0.5;

const BOOK_A_STEP = 5;
/** Book A and Book B. Weekdays from the session date, 0 through 7. Book C is same-day only. */
const DTE_MIN = 0;
const DTE_MAX = 7;

/** Index roots stay 4 strikes from the money. Every other name uses the 6% span. */
export const SPAN_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
export const DRIVE = 0.0035;
const REVERSAL = 0.004;
export const QUOTE_MAX_AGE_MS = 90_000;
export const SEAT_CAP = 5;
const BOOK_B_ASK = 1;
const BOOK_B_HALVE = 0.5;
export const BOOK_B_LOOKBACK = 30;

/* Fees, per contract, an estimate (not a broker's schedule): $0.50 commission and $0.04 exchange, clearing and ORF a
   side, and on the sale the SEC fee (Section 31: $27.80 per million of the sale, the FY2024 rate; was $20.60 here; the
   SEC resets it each fiscal year, so check sec.gov's fee-rate advisory) and FINRA's TAF ($0.00279 a contract sold). */
const COMMISSION = 0.5;
const EXCHANGE = 0.04;
export const SEC_FEE_RATE = 0.0000278;
export const FINRA_TAF = 0.00279;

/** The round trip's fees on one contract sold at `exitPx`, dollars, to the cent. */
export function optionFees(exitPx: number): number {
  const sec = Math.max(0, exitPx) * 100 * SEC_FEE_RATE;
  return Number((COMMISSION * 2 + EXCHANGE * 2 + sec + FINRA_TAF).toFixed(2));
}

/** The bid that sells for no loss after the round trip's fees: the ask paid plus the fees per share. */
export function breakEvenBid(entryAsk: number): number {
  if (!(entryAsk > 0)) return entryAsk;
  /* the fees at the break-even price itself, solved by one pass from the ask (the SEC part moves by under 0.01 cent) */
  return entryAsk + optionFees(entryAsk) / 100;
}

const STOP_HAIRCUT = 0.5322;
export const STOP_KEEP = 1 - STOP_HAIRCUT;
const BE_PEAK = 1.25;
const TP1_BID = 1.5;
export const TP1_STOP = 1.25;
const TP2_BID = 2;
export const TP2_STOP = 1.5;
const TP3_BID = 3;
export const TP3_STOP = 2.25;
const TP4_BID = 4;
export const TP4_TRAIL = 0.75;
export const FLAT_T = 385;

export const LOTTERY_ASK_MAX = 1.65;
export const LOTTERY_CAP = 5;
const LOTTERY_X3_SEC = 120;
const LOTTERY_X2_SEC = 30;
const LOTTERY_X3 = 3;
const LOTTERY_X2 = 2;

/** Open interest, net gamma, and the two walls. Everyone else is NaN. */
export const GEX_CORE = ['SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF'] as const;

/** No same-day contract. Their dailies are SPXW, NDXP, and RUTW. */
export const NO_SAME_DAY = ['SPX', 'NDX', 'RUT', 'VIX'] as const;
export const DO_NOT_REQUEST: readonly string[] = [];

/** SPXW reads SPX. NDXP reads NDX. RUTW reads RUT. XSP reads XSP. */
const PRINT_OF: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };

export const CLS_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
/** NVDA is 1. META is 0. The old LLY/BKNG list is not this. */
export const CLS_HIGHBETA = ['AFRM', 'AGQ', 'AMC', 'BITX', 'BOIL', 'CLSK', 'COIN', 'CVNA', 'DJT', 'FAS', 'GME', 'HOOD', 'IREN', 'JNUG', 'KOLD', 'LABU', 'MARA', 'MSTR', 'NUGT', 'NVDA', 'NVDL', 'PLTR', 'RIOT', 'SMCI', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'SPXU', 'SQQQ', 'SVIX', 'SVXY', 'TNA', 'TQQQ', 'TSLA', 'TSLL', 'TZA', 'UPRO', 'UPST', 'UVIX', 'UVXY', 'VXX', 'YINN'] as const;

/* The names a viewer reads, in one place (rename here): the entry tree, the runner tree and the three books. Never
   show "Model 1", "Model 2" or "Book A/B/C" on a page; the code's own book letters stay A, B and C. */
export const MODEL_1_NAME = 'Hit score';
/* The live inputs were rebuilt (volume curve, prior session) and have not been re-checked against the training rows,
   so every Book A/B call is marked as unvalidated until that check is done. */
export const MODELS_VALIDATED = false;
export const UNVALIDATED_WORD = 'Unvalidated';
export const UNVALIDATED_LINE = 'Unvalidated model: the live inputs have not yet been re-checked against the training data.';
export const MODEL_2_NAME = 'Runner score';
export const BOOK_NAME: Record<'A' | 'B' | 'C', string> = { A: 'Core', B: 'Wing', C: 'Late sweep' };

/** Engine text as a viewer reads it: the tree and book names above in place of "Model 1", "Model 2" and "Book A/B/C",
    and no data vendor named. The browser runs every Compass answer through it (compassFeed, compassReviewFeed), so a
    record, review or study written before a rename (or by older code) reads the same as a new one. */
export function userWords(text: string): string {
  const b = (k: string) => BOOK_NAME[k as 'A' | 'B' | 'C'] ?? k;
  return text
    .replace(/\bModel 1\b/g, MODEL_1_NAME)
    .replace(/\bModel 2\b/g, MODEL_2_NAME)
    .replace(/\bBooks? A, B,? (and|or) C\b/g, (_, w) => `${b('A')}, ${b('B')} ${w} ${b('C')}`)
    .replace(/\bBooks? A,? (and|or) (?:Book )?B\b/g, (_, w) => `${b('A')} ${w} ${b('B')}`)
    .replace(/\bBook A\/B\b/g, `${b('A')}/${b('B')}`)
    .replace(/\bBook ([ABC])\b/g, (_, k) => b(k))
    .replace(/\bquotes ThetaData recorded\b/g, 'recorded quotes')
    .replace(/\b[Tt]he quotes ThetaData has\b/g, 'the recorded quotes')
    .replace(/ThetaData(?:'s|’s|&apos;s) recorded/g, 'the recorded')
    .replace(/\bfrom ThetaData\b/g, 'from the live data')
    .replace(/ThetaData/g, 'Live data');
}

export function printOf(root: string): string {
  return PRINT_OF[root] ?? root;
}

/** The minutes after 09:30 the trees were trained on: column 0 spans 15 to 330 in both models. The scan scores every
    session mark regardless; outside these minutes the row goes into the trees as it is, and the board says so. */
export const MODEL_T_MIN = 15;
export const MODEL_T_MAX = 330;

export function inModelWindow(t: number): boolean {
  return Number.isFinite(t) && t >= MODEL_T_MIN && t <= MODEL_T_MAX;
}

/** A Book A or B entry needs this many minutes between the mark and its session's flat, and ENTRY_MIN_SINCE since its
    session's open. Every session flats five minutes before it ends, so no call is made near any flat. */
export const ENTRY_MIN_LEFT = 55;
export const ENTRY_MIN_SINCE = 15;

/** The flat of a session as minutes after 09:30: 385 (15:55) on a full day, five minutes before an early close
    (12:55 is 205 on a 13:00 close). `closeMin` is the close as a minute of the day, or null on a full day. */
export function flatTOf(closeMin: number | null | undefined): number {
  const close = closeMin != null && closeMin < 16 * 60 ? closeMin : 16 * 60;
  return close - 5 - (9 * 60 + 30);
}

/** The option tape sessions a call can be made in. */
export type TapeSession = 'overnight' | 'pre' | 'regular' | 'curb';
export const SESSION_WORD: Record<TapeSession, string> = { overnight: 'Overnight', pre: 'Pre-market', regular: 'Regular', curb: 'Curb' };

const OVERNIGHT_OPEN = 20 * 60 + 15;
const PRE_OPEN = 7 * 60 + 30;
const HALT_AT = 9 * 60 + 25;
const REGULAR_OPEN = 9 * 60 + 30;
const CURB_CLOSE = 17 * 60;

/** The session a New York minute of the day is in, for a root with the overnight index session (SPX, XSP, VIX, RUT:
    20:15 to 09:25) or without it (the equity options' pre-market from 07:30), with the minutes since that session
    opened and the minutes left to its flat (five minutes before it ends: 09:20 before the 09:25 halt, 15:55 or five
    before an early close, 16:55 in the curb). Null in the halt, after the curb and outside a root's tape.
    `closeMin` is the regular close (minute of the day), 16:00 when null. */
export function tapeSession(minuteOfDay: number, overnightRoot: boolean, closeMin: number | null = null): { kind: TapeSession; since: number; left: number } | null {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const close = closeMin != null && closeMin < 16 * 60 ? closeMin : 16 * 60;
  const preFlat = HALT_AT - 5;
  if (m >= OVERNIGHT_OPEN || m < HALT_AT) {
    if (overnightRoot) {
      const since = m >= OVERNIGHT_OPEN ? m - OVERNIGHT_OPEN : m + 1440 - OVERNIGHT_OPEN;
      return { kind: 'overnight', since, left: m >= OVERNIGHT_OPEN ? 1440 - m + preFlat : preFlat - m };
    }
    if (m >= PRE_OPEN && m < HALT_AT) return { kind: 'pre', since: m - PRE_OPEN, left: preFlat - m };
    return null;
  }
  if (m < REGULAR_OPEN) return null;
  if (m < close) return { kind: 'regular', since: m - REGULAR_OPEN, left: close - 5 - m };
  /* an early close has no curb: nothing trades after it until the overnight session */
  if (close === 16 * 60 && m < CURB_CLOSE) return { kind: 'curb', since: m - close, left: CURB_CLOSE - 5 - m };
  return null;
}

/** The minute of the day a t (minutes after 09:30, negative before it) stands for. */
const minuteOfT = (t: number) => t + 9 * 60 + 30;

/** The time-of-day gate on a Book A or B entry, session by session: at least 15 minutes since the open of the session
    the mark is in and at least 55 minutes before that session's flat. Regular session: 09:45 to 15:00 (12:00 on a
    13:00 close). Overnight (the index roots): 20:30 to 08:25. Pre-market (the equity options): 07:45 to 08:25. The curb
    never has 55 minutes left after its 15th. A mark outside the trees' trained minutes (t 15 to 330) may call; the
    call is marked "outside trained hours" (inModelWindow). `flatT` is the regular flat as t (flatTOf). */
export function entryTimeOk(t: number, flatT = FLAT_T, overnightRoot = true): boolean {
  if (!Number.isFinite(t)) return false;
  const w = tapeSession(minuteOfT(t), overnightRoot, flatT + 5 + 9 * 60 + 30);
  return !!w && w.since >= ENTRY_MIN_SINCE && w.left >= ENTRY_MIN_LEFT;
}

/** Minutes from the mark to its session's flat (NaN outside a session): the theta burn and the call's own flat. */
export function minutesToFlat(t: number, flatT = FLAT_T, overnightRoot = true): number {
  const w = tapeSession(minuteOfT(t), overnightRoot, flatT + 5 + 9 * 60 + 30);
  return w ? w.left : NaN;
}

/** The session a mark belongs to, for the record and the track record. */
export function sessionKindOf(t: number, flatT = FLAT_T, overnightRoot = true): TapeSession | null {
  return tapeSession(minuteOfT(t), overnightRoot, flatT + 5 + 9 * 60 + 30)?.kind ?? null;
}

/** The roots with the overnight index session. */
export const OVERNIGHT_ROOTS: readonly string[] = ['SPX', 'SPXW', 'XSP', 'VIX', 'RUT', 'RUTW'];
export const OUTSIDE_TRAINED_WORD = 'Outside trained hours';

/** Every 5 minutes while an option tape is open, plus the last minute before a 0 DTE stop.
 *  09:29 is VIX. 15:59 is a 16:00 stop. 16:14 is a 16:15 stop. The halt sends nothing else. */
function scanMark(minuteOfDay: number): boolean {
  if (minuteOfDay === 9 * 60 + 29) return true;
  if (minuteOfDay === 15 * 60 + 59) return true;
  if (minuteOfDay === 16 * 60 + 14) return true;
  return minuteOfDay % BOOK_A_STEP === 0;
}

/** Some root can take a new ticket at this New York minute. Sunday night is overnight. Saturday is shut. */
export function sessionScanOpen(minuteOfDay: number, weekday: number): boolean {
  if (weekday === 6) return false;
  if (weekday === 0 && minuteOfDay < 20 * 60 + 15) return false;
  if (weekday === 5 && minuteOfDay >= 17 * 60) return false;
  if (minuteOfDay >= 9 * 60 + 25 && minuteOfDay < 9 * 60 + 30) return minuteOfDay === 9 * 60 + 29;
  if (!scanMark(minuteOfDay)) return false;
  if (minuteOfDay >= 20 * 60 + 15 || minuteOfDay < 9 * 60 + 25) return true;
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 17 * 60;
}

/** t is minutes after 09:30, and it is negative before the cash open. The morning window is not this. */
export function onScanGrid(t: number): boolean {
  if (!Number.isFinite(t)) return false;
  const minute = Math.round(t + 9 * 60 + 30);
  if (minute < 0 || minute >= 24 * 60) return false;
  if (minute >= 9 * 60 + 25 && minute < 9 * 60 + 30) return minute === 9 * 60 + 29;
  if (!scanMark(minute)) return false;
  if (minute >= 20 * 60 + 15 || minute < 9 * 60 + 25) return true;
  return minute >= 9 * 60 + 30 && minute < 17 * 60;
}

function asIso(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  return ymd;
}

/** Trading sessions from the session date to the expiration: weekdays that are not market holidays
    (core/calendar MARKET_HOLIDAYS). Same day is 0. A weekday guess is not a listing. Wednesday 2026-11-25 to Friday
    11-27 is 1 (Thanksgiving is not a session); it was 2 when holidays were counted. */
export function weekdayDte(sessionYmd: string, expiryYmd: string): number {
  const from = Date.parse(`${asIso(sessionYmd)}T00:00:00Z`);
  const to = Date.parse(`${asIso(expiryYmd)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return NaN;
  let n = 0;
  for (let t = from + 86400000; t <= to; t += 86400000) {
    const d = new Date(t);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (MARKET_HOLIDAYS.has(d.toISOString().slice(0, 10))) continue;
    n += 1;
  }
  return n;
}

/** Published T. The scan minute, a 16:00 expiration. Not the wall clock. Not DTE.
    Retrain item: for a 1 to 7 DTE contract this is still only today's minutes left (the training rows were built the
    same way, so the live input matches the trees and must not change until they are retrained); the true time to a
    Friday expiry from Monday is about five sessions, not hours. The greeks, IV and theta columns inherit it. */
export function yearFrac(t: number): number {
  const mins = Math.max(0, SESSION_MIN - t);
  return mins / (SESSION_MIN * YEAR_SESSIONS) + T_EPS;
}

/** The feature column. Always 390 - t, even when DTE is 1 to 7. */
export function minutesLeftCol(t: number): number {
  return SESSION_MIN - t;
}

export function quoteValid(bid: number, ask: number): boolean {
  return bid >= 0 && ask > 0 && ask >= bid;
}

export function spreadPass(bid: number, ask: number): boolean {
  if (!(bid > BID_MIN) || !quoteValid(bid, ask)) return false;
  const mid = (ask + bid) / 2;
  if (!(mid > 0)) return false;
  return (ask - bid) / mid <= SPREAD_MAX + SPREAD_EPS;
}

export function ivFeature(iv: number): number {
  return iv > IV_FEATURE_MIN ? iv : NaN;
}

/** Contract IV, else ATM IV, else 0.30. */
export function greekVol(contractIv: number, atmIv: number): number {
  if (contractIv > IV_FEATURE_MIN) return contractIv;
  if (atmIv > IV_FEATURE_MIN) return atmIv;
  return IV_FALLBACK;
}

export function f32(x: readonly number[]): number[] {
  return x.map(v => (v == null || Number.isNaN(v) ? NaN : Math.fround(v)));
}

/** Nearest strike. An exact tie takes the lower strike. */
export function atmStrike(strikes: readonly number[], spot: number): number {
  let best = NaN;
  let dist = Infinity;
  for (const k of strikes) {
    const d = Math.abs(k - spot);
    if (d < dist - 1e-9 || (Math.abs(d - dist) <= 1e-9 && (Number.isNaN(best) || k < best))) {
      dist = d;
      best = k;
    }
  }
  return best;
}

export function strikeDistance(strikes: readonly number[], spot: number, strike: number): number {
  const atm = atmStrike(strikes, spot);
  const ordered = [...new Set(strikes)].sort((a, b) => a - b);
  const ai = ordered.findIndex(k => Math.abs(k - atm) < 1e-9);
  const si = ordered.findIndex(k => Math.abs(k - strike) < 1e-9);
  if (ai < 0 || si < 0) return NaN;
  return Math.abs(si - ai);
}

export function strikeSpan(spot: number, strikes: readonly number[], index: boolean): number {
  if (index) return 4;
  const ordered = [...new Set(strikes.filter(k => k > 0))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const g = ordered[i] - ordered[i - 1];
    if (g > 1e-9) gaps.push(g);
  }
  if (!gaps.length || !(spot > 0)) return 4;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const step = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  if (!(step > 0)) return 4;
  return Math.min(12, Math.max(4, Math.ceil((0.06 * spot) / step)));
}

export function bookBRange(span: number): { inner: number; outer: number } {
  const inner = Math.max(8, span + 1);
  return { inner, outer: inner + 4 };
}

/** How far from the money the weekly read reaches: Book B's outer strike at the widest span (12 → 13 to 17). */
export const WEEKLY_STRIKES = bookBRange(12).outer;

export function bookAPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, p1: number, flatT = FLAT_T, overnightRoot = true): boolean {
  return onScanGrid(t)
    && entryTimeOk(t, flatT, overnightRoot)
    && dist <= span
    && dte >= DTE_MIN && dte <= DTE_MAX
    && spreadPass(bid, ask)
    && p1 >= P1_MIN;
}

export function bookBPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, priorBid: number, priorAsk: number, p1: number, flatT = FLAT_T, overnightRoot = true): boolean {
  const band = bookBRange(span);
  return onScanGrid(t)
    && entryTimeOk(t, flatT, overnightRoot)
    && dte >= DTE_MIN && dte <= DTE_MAX
    && dist >= band.inner && dist <= band.outer
    && ask <= BOOK_B_ASK
    && spreadPass(bid, ask)
    && quoteValid(priorBid, priorAsk)
    && priorAsk > 0
    && ask <= BOOK_B_HALVE * priorAsk
    && p1 >= P1_MIN;
}

export function runnerFlag(prun: number): boolean {
  return prun >= PRUN_MIN;
}

/** Hard stop. Later ratchets only move it up. */
function hardStop(entryAsk: number): number {
  return entryAsk * STOP_KEEP;
}

export function stopAfter(entryAsk: number, peak: number, runner: boolean): number {
  let stop = hardStop(entryAsk);
  /* break-even means no loss after fees: at 1.25x the stop moves to the ask plus the round trip (was the bare ask) */
  if (peak >= entryAsk * BE_PEAK) stop = Math.max(stop, breakEvenBid(entryAsk));
  if (!runner) return stop;
  if (peak >= entryAsk * TP1_BID) stop = Math.max(stop, entryAsk * TP1_STOP);
  if (peak >= entryAsk * TP2_BID) stop = Math.max(stop, entryAsk * TP2_STOP);
  if (peak >= entryAsk * TP3_BID) stop = Math.max(stop, entryAsk * TP3_STOP);
  if (peak >= entryAsk * TP4_BID) stop = Math.max(stop, peak * TP4_TRAIL);
  return stop;
}

/** Each minute, in order. Stop first, then a non-runner at 1.50 × the ask. There is no sale because a clock hit 55
    minutes. */
export function treeExit(entryAsk: number, bid: number, peak: number, runner: boolean): { why: string; px: number } | null {
  if (!(entryAsk > 0) || !(bid >= 0) || !Number.isFinite(bid)) return null;
  const stop = stopAfter(entryAsk, peak, runner);
  if (bid <= stop) return { why: 'stop', px: bid };
  if (!runner && bid >= entryAsk * TP1_BID) return { why: 'tp1', px: Number((entryAsk * TP1_BID).toFixed(2)) };
  return null;
}

/** After the entry. The stock's last 5 minutes reversed against the side by 0.40% or more. */
export function reversalLine(entryAsk: number, bid: number, side: 'C' | 'P', ret5: number): string | null {
  if (!(entryAsk > 0) || !(bid >= 0) || !Number.isFinite(ret5)) return null;
  const against = side === 'C' ? ret5 <= -REVERSAL : ret5 >= REVERSAL;
  if (!against) return null;
  if (bid >= entryAsk) return 'Get out early. The stock reversed over the last 5 minutes.';
  if ((entryAsk - bid) / entryAsk <= 0.15) return 'Get out. Small loss. The stock reversed over the last 5 minutes.';
  return 'Get out. The stock reversed over the last 5 minutes.';
}

/** One-second lottery. No stop. A bid of 0 is held. 3× inside 120s is checked before 2× inside 30s. The caller flats at 15:50, including a bid of 0. */
export function lotteryExit(entryAsk: number, bid: number, seconds: number): { why: string; px: number } | null {
  if (!(entryAsk > 0) || !Number.isFinite(bid)) return null;
  if (seconds >= 0 && seconds <= LOTTERY_X3_SEC && bid >= LOTTERY_X3 * entryAsk) return { why: '3×', px: Number((LOTTERY_X3 * entryAsk).toFixed(2)) };
  if (seconds >= 0 && seconds <= LOTTERY_X2_SEC && bid >= LOTTERY_X2 * entryAsk) return { why: '2×', px: Number((LOTTERY_X2 * entryAsk).toFixed(2)) };
  return null;
}

export function lotteryEntry(bid: number, ask: number): boolean {
  return bid > BID_MIN && ask > 0 && ask <= LOTTERY_ASK_MAX && ask >= bid && spreadPass(bid, ask);
}

/** Book C. 15:20:00 through 15:49:59 ET. */
export function inLottery(minuteOfDay: number, second: number): boolean {
  const s = minuteOfDay * 60 + second;
  return s >= (15 * 60 + 20) * 60 && s < (15 * 60 + 50) * 60;
}

const HIGH_IMPACT = /\b(interest rate|fomc|cpi|pce|employment|unemployment|payroll|nonfarm|consumer price)\b/i;

/** Live only. Fifteen minutes before a named release until fifteen minutes after. */
export function releaseBlocks(title: string, releaseMin: number, nowMin: number): boolean {
  if (!HIGH_IMPACT.test(title) || !Number.isFinite(releaseMin)) return false;
  return nowMin >= releaseMin - 15 && nowMin <= releaseMin + 15;
}

/** Unchanged spot. Dollar theta is the theta column times 365. Price decay over dt years is |theta year| × dt.
    Reject when that decay reaches the 0.5322 haircut before the flat. */
export function thetaBurns(thetaPerDay: number, gamma: number, ask: number, dtYears: number): boolean {
  if (!(ask > 0) || !(dtYears > 0) || !(gamma > 0) || !Number.isFinite(thetaPerDay)) return false;
  const thetaYear = thetaPerDay * 365;
  return Math.abs(thetaYear) * dtYears >= STOP_HAIRCUT * ask;
}
