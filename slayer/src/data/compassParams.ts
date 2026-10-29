/*
  Compass parameters, in one place. The entry and runner trees ship in public/models;
  scoring stays shut until those files hash to the values below.
*/

export const UNIVERSE_FILE = 'config/universe_458.json';
export const UNIVERSE_SHA = 'eb0ed706ae8dd5d5442a99d012db5077e6f9ba1ad0ef10a551af36b87840ef7e';
export const UNIVERSE_N = 458;

export const ENTRY_FILE = 'models/model_entry_all6months.txt';
export const ENTRY_SHA = '94592d667860d271e85e24dc9f8e82252b71d393c97cb019af871bd3782bdb8d';
export const RUNNER_FILE = 'models/model_runner_all6months.txt';
export const RUNNER_SHA = '8a41876361259eec2c525b1977f703ddb0944bd2c39784fe3484959b1037302c';
export const TREE_N = 300;

export const R = 0.042;
export const Q = 0;
export const SESSION_MIN = 390;
export const YEAR_SESSIONS = 252;
export const T_EPS = 1e-6;

export const IV_LO = 0.01;
export const IV_HI = 8;
export const IV_BISECTS = 60;
export const IV_FEATURE_MIN = 0.011;
export const IV_FALLBACK = 0.3;

export const BID_MIN = 0.15;
export const SPREAD_MAX = 0.08;
export const SPREAD_EPS = 1e-9;

export const P1_MIN = 0.7067;
export const PRUN_MIN = 0.5;

/** First published training minute was t = 15. The live scan is not that window. */
export const BOOK_A_T0 = 15;
export const BOOK_A_T1 = 55;
export const BOOK_A_STEP = 5;
export const BOOK_A_STRIKES = 4;
export const BOOK_A_CAP = 5;
/** Book A and Book B. Weekdays from the session date, 0 through 7. Book C is same-day only. */
export const DTE_MIN = 0;
export const DTE_MAX = 7;

/** Index roots stay 4 strikes from the money. Every other name uses the 6% span. */
export const SPAN_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
export const DRIVE = 0.0035;
export const REVERSAL = 0.004;
export const QUOTE_MAX_AGE_MS = 90_000;
export const SEAT_CAP = 5;
export const BOOK_B_ASK = 1;
export const BOOK_B_HALVE = 0.5;
export const BOOK_B_LOOKBACK = 30;
export const BOOK_B_CAP = 5;

export const STOP_HAIRCUT = 0.5322;
export const STOP_KEEP = 1 - STOP_HAIRCUT;
export const BE_PEAK = 1.25;
export const TP1_BID = 1.5;
export const TP1_STOP = 1.25;
export const TP2_BID = 2;
export const TP2_STOP = 1.5;
export const TP3_BID = 3;
export const TP3_STOP = 2.25;
export const TP4_BID = 4;
export const TP4_TRAIL = 0.75;
export const FLAT_T = 385;

export const LOTTERY_ASK_MAX = 1.65;
export const LOTTERY_CAP = 5;
export const LOTTERY_X3_SEC = 120;
export const LOTTERY_X2_SEC = 30;
export const LOTTERY_X3 = 3;
export const LOTTERY_X2 = 2;

/** Open interest, net gamma, and the two walls. Everyone else is NaN. */
export const GEX_CORE = ['SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF'] as const;

/** No same-day contract. Their dailies are SPXW, NDXP, and RUTW. */
export const NO_SAME_DAY = ['SPX', 'NDX', 'RUT', 'VIX'] as const;
export const DO_NOT_REQUEST: readonly string[] = [];

/** SPXW reads SPX. NDXP reads NDX. RUTW reads RUT. XSP reads XSP. */
export const PRINT_OF: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };

export const CLS_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
/** NVDA is 1. META is 0. The old LLY/BKNG list is not this. */
export const CLS_HIGHBETA = ['AFRM', 'AGQ', 'AMC', 'BITX', 'BOIL', 'CLSK', 'COIN', 'CVNA', 'DJT', 'FAS', 'GME', 'HOOD', 'IREN', 'JNUG', 'KOLD', 'LABU', 'MARA', 'MSTR', 'NUGT', 'NVDA', 'NVDL', 'PLTR', 'RIOT', 'SMCI', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'SPXU', 'SQQQ', 'SVIX', 'SVXY', 'TNA', 'TQQQ', 'TSLA', 'TSLL', 'TZA', 'UPRO', 'UPST', 'UVIX', 'UVXY', 'VXX', 'YINN'] as const;

export const MODEL_1_NAME = 'Model 1';
/* The live inputs were rebuilt (volume curve, prior session) and have not been re-checked against the training rows,
   so every Book A/B call is marked as unvalidated until that check is done. */
export const MODELS_VALIDATED = false;
export const UNVALIDATED_WORD = 'Unvalidated';
export const UNVALIDATED_LINE = 'Unvalidated model: the live inputs have not yet been re-checked against the training data.';
export const MODEL_2_NAME = 'Model 2';
export const PUBLISHED_BOOSTERS = 2;

export const FEATURES = [
  't', 'ret_open', 'ret_5', 'ret_15', 'ret_60', 'pos_range', 'range_open', 'rv30', 'rv_ratio', 'compress',
  'or_state', 'or_dist', 'pdh_dist', 'pdl_dist', 'gap', 'minutes_left', 'vwap_z', 'rvol', 'rvol5',
  'spy_ret_5', 'spy_ret_15', 'spy_ret_open', 'sec_ret_15', 'sec_ret_open', 'atm_iv', 'iv_skew', 'iv_rv',
  'net_gex_bn', 'call_wall_dist', 'put_wall_dist', 'otm_pct', 'dir', 'mid', 'spread_pct', 'opt_ret_5',
  'opt_ret_15', 'iv', 'delta', 'gamma', 'theta', 'vega', 'gamma_theta', 'theta_pct', 'oi', 'cls_index',
  'cls_highbeta', 'a_ret_open', 'a_ret_5', 'a_ret_15', 'a_ret_60', 'a_vwap_z', 'a_or_dist', 'a_spy_ret_15',
  'a_sec_ret_15', 'a_pdh_dist', 'a_pdl_dist',
] as const;

export function lockReason(): string {
  return 'Model 1 and Model 2 are not loaded. Scoring is closed until the files match their hashes.';
}

export function printOf(root: string): string {
  return PRINT_OF[root] ?? root;
}

/** Every 5 minutes while an option tape is open, plus the last minute before a 0 DTE stop.
 *  09:29 is VIX. 15:59 is a 16:00 stop. 16:14 is a 16:15 stop. The halt sends nothing else. */
export function scanMark(minuteOfDay: number): boolean {
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

/** Weekdays from the session date to the expiration. Same day is 0. A weekday guess is not a listing. */
export function weekdayDte(sessionYmd: string, expiryYmd: string): number {
  const from = Date.parse(`${asIso(sessionYmd)}T00:00:00Z`);
  const to = Date.parse(`${asIso(expiryYmd)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return NaN;
  let n = 0;
  for (let t = from + 86400000; t <= to; t += 86400000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) n += 1;
  }
  return n;
}

/** Published T. The scan minute, a 16:00 expiration. Not the wall clock. Not DTE. */
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

export function bookAPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, p1: number): boolean {
  return onScanGrid(t)
    && dist <= span
    && dte >= DTE_MIN && dte <= DTE_MAX
    && spreadPass(bid, ask)
    && p1 >= P1_MIN;
}

export function bookBPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, priorBid: number, priorAsk: number, p1: number): boolean {
  const band = bookBRange(span);
  return onScanGrid(t)
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
export function hardStop(entryAsk: number): number {
  return entryAsk * STOP_KEEP;
}

export function stopAfter(entryAsk: number, peak: number, runner: boolean): number {
  let stop = hardStop(entryAsk);
  if (peak >= entryAsk * BE_PEAK) stop = Math.max(stop, entryAsk);
  if (!runner) return stop;
  if (peak >= entryAsk * TP1_BID) stop = Math.max(stop, entryAsk * TP1_STOP);
  if (peak >= entryAsk * TP2_BID) stop = Math.max(stop, entryAsk * TP2_STOP);
  if (peak >= entryAsk * TP3_BID) stop = Math.max(stop, entryAsk * TP3_STOP);
  if (peak >= entryAsk * TP4_BID) stop = Math.max(stop, peak * TP4_TRAIL);
  return stop;
}

/**
 * Each minute, in order. Stop first, then a non-runner at 1.50 × the ask.
 * There is no sale because a clock hit 55 minutes.
 */
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

/** 09:30 through 16:00 ET, t = minutes after 09:30. The close itself is outside. */
export function inSession(minuteOfDay: number): boolean {
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60;
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

/**
 * Unchanged spot. Dollar theta is the theta column times 365.
 * Price decay over dt years is |theta year| × dt.
 * Reject when that decay reaches the 0.5322 haircut before the flat.
 */
export function thetaBurns(thetaPerDay: number, gamma: number, ask: number, dtYears: number): boolean {
  if (!(ask > 0) || !(dtYears > 0) || !(gamma > 0) || !Number.isFinite(thetaPerDay)) return false;
  const thetaYear = thetaPerDay * 365;
  return Math.abs(thetaYear) * dtYears >= STOP_HAIRCUT * ask;
}

/** Column 27 is the model sign. House is the opposite. Customer-signed is column 27. Negative passes the live test. */
export function customerGammaNegative(netGexBn: number): boolean {
  return Number.isFinite(netGexBn) && netGexBn < 0;
}

/** Call-ask plus put-ask dollars, and the ask-side lean. +1 call, −1 put, 0 not confident. */
export function flowSign(callAskUsd: number, putAskUsd: number): number {
  if (!(callAskUsd >= 0) || !(putAskUsd >= 0)) return 0;
  const sum = callAskUsd + putAskUsd;
  if (sum < 250_000) return 0;
  const lean = Math.abs(callAskUsd - putAskUsd) / sum;
  if (lean < 0.2) return 0;
  return callAskUsd > putAskUsd ? 1 : -1;
}
