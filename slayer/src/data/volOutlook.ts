/* The vol outlook: three tested reads of a name's own realised volatility, ported line for line from the physics
   study (research/physics/scripts/lib.py load_bars and returns, halflife.py, build_features.py and evaluate.py), so
   each number here is the number the study measured.

   - DAILY REALISED VOL. Regular-session one-minute bars on a 390-minute grid (09:30 = minute 0), a missing minute
     carried from the minute before (lib.py load_bars); a day with fewer than 150 bars is not a day. The day's realised
     vol RV_t = sqrt(sum of squared five-minute log returns), the first from the day's open to minute 4's close, then
     every fifth minute's close (halflife.py daily_logrv; a day with under 200 bars has none). x_t = ln RV_t.
   - TOMORROW: the HAR forecast (Corsi 2009) x̂_{t+1} = a + b_d x_t + b_w mean(x_{t-4..t}) + b_m mean(x_{t-21..t}),
     ordinary least squares on the rows t ≥ 22 of the window whose target x_{t+1} is known before the month of the
     forecast's origin (halflife.py: refit at the start of every month, no look-ahead).
   - THE HALF-LIFE: the AR(1) x̂_{t+1} = a + φ x_t fitted on the same rows; a shock halves in ln 0.5 / ln φ sessions.
   - THE NEXT HOUR: ln RV(next 60 one-minute returns) on twenty-one time-of-day dummies (10:00, 10:15 … 15:00) and the
     log realised vol of the last 15, 60 and 390 one-minute returns (crossing into the day before; the first minute's
     return is the day's own open to close, the overnight gap is never a return), fitted on every row of the days before
     the quarter it predicts (evaluate.py vol_tests, lib.py walk_forward_ols; build_features.py: a row needs 400 earlier
     returns and its minute j-1 traded).

   Annualised on the trading clock: a day's realised vol × √252, an hour's × √(252 × 390 / 60). Both count only the
   regular session's moves; an implied vol prices the overnight gaps as well, so implied minus forecast also carries
   the overnight risk. The forecasts are exp of a forecast of the LOG — the model's central (median) case, as the study
   scored it.

   The study refit on an expanding window from January 2023; the live tile fits on a trailing window of minute bars
   (HISTORY_SESSIONS before the quarter's first session, rolled forward a quarter at a time) — scripts/vol-outlook-proof.ts
   reproduces the study's numbers with the expanding window and scores the trailing one on the same test months. */

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { isTradingDay, isoDate, sessionBefore, sessionCloseMinOn } from '../core/calendar';
import { nyMinutes, nyParts } from '../core/nyTime';
import { keepTheta, keptTheta, noData, thetaGet } from './thetaFeed';
import { THETA_INDEX, flatRows, sessionsBack, spansOf } from './thetaTape';

/* ------------------------------------------------------------------ the study's constants (lib.py, build_features.py) */

/** One-minute bars in a regular session, 09:30 … 15:59 */
export const NBAR = 390;
/** The decision minutes, minutes after 09:30: 10:00, 10:15 … 15:00 */
export const DECISIONS: readonly number[] = Array.from({ length: 21 }, (_, k) => 30 + 15 * k);
/** A day with fewer bars is dropped (lib.py load_bars) */
export const MIN_DAY_BARS = 150;
/** A day with fewer finite minutes has no daily realised vol (halflife.py) */
export const MIN_RV_BARS = 200;
/** Earlier one-minute returns a decision row needs (build_features.py `p < 400`) */
export const MIN_PRIOR_RETURNS = 400;
/** The study's floor inside every log of a realised vol */
export const LOG_EPS = 1e-12;
/** The trading year */
export const ANNUAL_DAYS = 252;
/** Fewest training rows the intraday refit accepts (lib.py walk_forward_ols) */
export const MIN_INTRADAY_ROWS = 200;
/** Sessions of minute bars the live fit reads before the quarter it predicts */
export const HISTORY_SESSIONS = 250;

/** A day's realised vol (not annualised) on the trading year */
export const annualiseDay = (rv: number): number => rv * Math.sqrt(ANNUAL_DAYS);
/** An hour's realised vol on the trading year: 6.5 trading hours a session, 252 sessions */
export const annualiseHour = (rv60: number): number => rv60 * Math.sqrt((ANNUAL_DAYS * NBAR) / 60);

/* ------------------------------------------------------------------ one day's grid (lib.py load_bars) */

/** A bar on the session's minute grid: `m` minutes after 09:30 */
export interface MinuteBar {
  m: number;
  open: number;
  close: number;
}

export interface DayGrid {
  /** YYYY-MM-DD */
  day: string;
  /** Opens and closes, minute 0 … 389; NaN after the day's last bar */
  O: Float64Array;
  C: Float64Array;
  /** The last minute with a bar */
  last: number;
}

/** The day's 390-minute grid, exactly as lib.py load_bars builds it: a bar with a zero or missing close is not a bar;
    a later bar at the same minute replaces an earlier one; a day with under 150 bars is dropped (null); a missing
    minute up to the last bar takes the minute before's close; minutes before the first bar take its open. */
export function dayGrid(day: string, bars: readonly MinuteBar[], minBars = MIN_DAY_BARS): DayGrid | null {
  const at = new Map<number, MinuteBar>();
  for (const b of bars) {
    if (!(b.close > 0) || !(b.m >= 0 && b.m < NBAR) || !Number.isInteger(b.m)) continue;
    at.set(b.m, b);
  }
  if (!at.size || at.size < minBars) return null;
  const O = new Float64Array(NBAR).fill(NaN);
  const C = new Float64Array(NBAR).fill(NaN);
  let last = -1;
  let first = NBAR;
  for (const [m, b] of at) {
    O[m] = b.open;
    C[m] = b.close;
    if (m > last) last = m;
    if (m < first) first = m;
  }
  for (let m = 1; m <= last; m++) {
    if (Number.isNaN(C[m])) {
      O[m] = C[m - 1];
      C[m] = C[m - 1];
    }
  }
  if (Number.isNaN(C[0])) {
    for (let m = 0; m < first; m++) {
      O[m] = O[first];
      C[m] = O[first];
    }
  }
  return { day, O, C, last };
}

/** The day's one-minute log returns (lib.py returns): minute 0 is its own open to close, the overnight gap is never a
    return; NaN after the last bar. */
export function dayReturns(g: DayGrid): Float64Array {
  const r = new Float64Array(NBAR).fill(NaN);
  r[0] = Math.log(g.C[0] / g.O[0]);
  for (let m = 1; m < NBAR; m++) r[m] = Math.log(g.C[m] / g.C[m - 1]);
  return r;
}

/** ln of the day's realised vol from five-minute returns (halflife.py daily_logrv): the open, then the close of minutes
    4, 9, 14 …; NaN on a day with under 200 finite minutes. */
export function dailyLogRv(g: DayGrid): number {
  let n = 0;
  for (let m = 0; m < NBAR; m++) if (Number.isFinite(g.C[m])) n++;
  if (n < MIN_RV_BARS) return NaN;
  /* the finite minutes are 0 … last, in a row (dayGrid), so the k-th finite close is minute k */
  let prev = g.O[0];
  let sum = 0;
  for (let m = 4; m < n; m += 5) {
    const r = Math.log(g.C[m] / prev);
    sum += r * r;
    prev = g.C[m];
  }
  return 0.5 * Math.log(sum);
}

/** Candles (epoch seconds) on New York's clock to each session day's minute bars */
export function minuteBarsByDay(bars: readonly Candle[]): Map<string, MinuteBar[]> {
  const out = new Map<string, MinuteBar[]>();
  for (const b of bars) {
    const ms = b.time * 1000;
    const m = nyMinutes(ms) - (9 * 60 + 30);
    if (m < 0 || m >= NBAR) continue;
    const p = nyParts(ms);
    const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const list = out.get(day) ?? [];
    list.push({ m, open: b.open, close: b.close });
    out.set(day, list);
  }
  return out;
}

/** The terminal's one-minute rows to each day's minute bars by the study's own rule (lib.py load_bars): the stamp's
    New York wall date and minute, every row with a positive close at minutes 0 … 389 — on a half day that keeps the
    13:00 closing print the study kept (the chart's tape ends at 12:59). */
export function minuteBarsOfRows(data: unknown): Map<string, MinuteBar[]> {
  const out = new Map<string, MinuteBar[]>();
  for (const row of flatRows(data)) {
    const ts = String(row.timestamp ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts)) continue;
    const close = Number(row.close);
    if (!(close > 0)) continue;
    const m = (Number(ts.slice(11, 13)) - 9) * 60 + Number(ts.slice(14, 16)) - 30;
    if (m < 0 || m >= NBAR) continue;
    const day = ts.slice(0, 10);
    const list = out.get(day) ?? [];
    list.push({ m, open: Number(row.open), close });
    out.set(day, list);
  }
  return out;
}

/** The request the chart's own minute tape makes for the regular session (thetaTape pullIntraday), so the server's
    cache answers both */
export const minutePath = (ticker: string, from: string, to: string): string =>
  `/${THETA_INDEX.has(ticker) ? 'index' : 'stock'}/history/ohlc?symbol=${encodeURIComponent(ticker)}&start_date=${from}&end_date=${to}&interval=1m&start_time=09:30:00&end_time=15:59:59.999&format=json`;

/* ------------------------------------------------------------------ least squares */

/** Least squares β minimising |Xβ − y|² by Householder QR (numpy lstsq's answer for a full-rank X). Null when X has
    fewer rows than columns or a column is (numerically) dependent on the others. */
export function lstsq(X: readonly (readonly number[])[], y: readonly number[]): number[] | null {
  const n = X.length;
  const k = n ? X[0].length : 0;
  if (!k || n < k) return null;
  const A = new Float64Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) A[j * n + i] = X[i][j];
  const b = Float64Array.from(y);
  let scale = 0;
  for (let i = 0; i < A.length; i++) scale = Math.max(scale, Math.abs(A[i]));
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let i = j; i < n; i++) s += A[j * n + i] ** 2;
    s = Math.sqrt(s);
    if (!(s > 1e-12 * Math.max(1, scale))) return null;
    const alpha = A[j * n + j] > 0 ? -s : s;
    const v = new Float64Array(n - j);
    for (let i = j; i < n; i++) v[i - j] = A[j * n + i];
    v[0] -= alpha;
    let vv = 0;
    for (let i = 0; i < v.length; i++) vv += v[i] * v[i];
    if (vv > 0) {
      for (let c = j; c < k; c++) {
        let d = 0;
        for (let i = j; i < n; i++) d += v[i - j] * A[c * n + i];
        const f = (2 * d) / vv;
        for (let i = j; i < n; i++) A[c * n + i] -= f * v[i - j];
      }
      let d = 0;
      for (let i = j; i < n; i++) d += v[i - j] * b[i];
      const f = (2 * d) / vv;
      for (let i = j; i < n; i++) b[i] -= f * v[i - j];
    }
  }
  const beta = new Array<number>(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    let s = b[j];
    for (let c = j + 1; c < k; c++) s -= A[c * n + j] * beta[c];
    beta[j] = s / A[j * n + j];
  }
  return beta.every(Number.isFinite) ? beta : null;
}

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i], 0);

/* ------------------------------------------------------------------ the daily HAR and the half-life (halflife.py) */

/** numpy nanmean of x[from..to] (NaN when every value is NaN) */
function nanMean(x: readonly number[], from: number, to: number): number {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, from); i <= to; i++) {
    if (Number.isFinite(x[i])) {
      s += x[i];
      c++;
    }
  }
  return c ? s / c : NaN;
}

/** The HAR row at origin t: [1, x_t, mean5, mean22] (halflife.py lagmean, windows cut at the series' start) */
export function harRow(x: readonly number[], t: number): number[] {
  return [1, x[t], nanMean(x, t - 4, t), nanMean(x, t - 21, t)];
}

/** The AR(1) row at origin t: [1, x_t] */
export const arRow = (x: readonly number[], t: number): number[] => [1, x[t]];

/** The 20-session realised-vol baseline at origin t (the study's MA20) */
export const ma20At = (x: readonly number[], t: number): number => nanMean(x, t - 19, t);

export interface DailyFit {
  har: number[];
  ar: number[];
  /** φ, and the half-life ln 0.5 / ln φ in sessions (NaN unless 0 < φ < 1) */
  phi: number;
  halfLife: number;
  rows: number;
}

/** Fit the HAR and the AR(1) for forecasts whose origin month starts at index t0 of `x` (the session series, oldest
    first): rows t = 22 … t0 − 2, each with a finite target x_{t+1} and finite regressors (halflife.py
    `tr = arange(22, t0 - 1)`). Null when the fit is not possible. */
export function fitDaily(x: readonly number[], t0: number): DailyFit | null {
  const Xh: number[][] = [];
  const Xa: number[][] = [];
  const yh: number[] = [];
  const ya: number[] = [];
  for (let t = 22; t <= t0 - 2; t++) {
    const y = x[t + 1];
    if (!Number.isFinite(y)) continue;
    const h = harRow(x, t);
    if (h.every(Number.isFinite)) {
      Xh.push(h);
      yh.push(y);
    }
    const a = arRow(x, t);
    if (a.every(Number.isFinite)) {
      Xa.push(a);
      ya.push(y);
    }
  }
  const har = lstsq(Xh, yh);
  const ar = lstsq(Xa, ya);
  if (!har || !ar) return null;
  const phi = ar[1];
  return { har, ar, phi, halfLife: phi > 0 && phi < 1 ? Math.log(0.5) / Math.log(phi) : NaN, rows: Xh.length };
}

/** The forecast of ln RV for the session after origin t */
export const harForecast = (fit: DailyFit, x: readonly number[], t: number): number => dot(fit.har, harRow(x, t));
export const arForecast = (fit: DailyFit, x: readonly number[], t: number): number => dot(fit.ar, arRow(x, t));

/** The index of the first session of `t`'s month (the refit boundary), in a series of YYYY-MM-DD days */
export function monthStart(days: readonly string[], t: number): number {
  const mo = days[t].slice(0, 7);
  let i = t;
  while (i > 0 && days[i - 1].slice(0, 7) === mo) i--;
  return i;
}

/* ------------------------------------------------------------------ the next hour (build_features.py, evaluate.py) */

/** One decision row: the minute j (after 09:30), the log realised vols of the last 15, 60 and 390 returns, and the
    target ln(RV of the next 60 returns + 1e-12), NaN while those 60 minutes are not all in. */
export interface HourRow {
  day: string;
  j: number;
  l15: number;
  l60: number;
  l390: number;
  y: number;
}

const lrv = (flat: readonly number[], p: number, n: number): number => {
  let s = 0;
  for (let i = p - n; i < p; i++) s += flat[i] * flat[i];
  return Math.log(Math.sqrt(s) + LOG_EPS);
};

/** The decision rows of consecutive days. `prior` is the finite one-minute returns before the first day (oldest first;
    the last 390 are enough) and `priorCount` how many returns came before it in all (the 400-return rule). Each day's
    returns are its finite minutes 0 … last (dayReturns). */
export function hourRows(days: readonly { day: string; r: ArrayLike<number> }[], prior: readonly number[] = [], priorCount = prior.length): HourRow[] {
  const out: HourRow[] = [];
  const flat: number[] = prior.slice(-NBAR);
  let before = priorCount;
  for (const d of days) {
    const r = d.r;
    let n = 0;
    while (n < r.length && Number.isFinite(r[n])) n++;
    const base = flat.length;
    for (let m = 0; m < n; m++) flat.push(r[m]);
    for (const j of DECISIONS) {
      /* valid[i, j-1]: the minute before the decision traded (or was carried) */
      if (j - 1 >= n) continue;
      const p = before + j;
      if (p < MIN_PRIOR_RETURNS) continue;
      const q = base + j;
      if (q < NBAR) continue;
      let y = NaN;
      if (j + 60 <= n) {
        let s = 0;
        for (let m = j; m < j + 60; m++) s += r[m] * r[m];
        y = Math.log(Math.sqrt(s) + LOG_EPS);
      }
      out.push({ day: d.day, j, l15: lrv(flat, q, 15), l60: lrv(flat, q, 60), l390: lrv(flat, q, NBAR), y });
    }
    before += n;
    if (flat.length > 4 * NBAR) flat.splice(0, flat.length - NBAR);
  }
  return out;
}

/** The regressors of a row: the 21 time-of-day dummies, then ln RV 60, 390, 15 (evaluate.py vol_tests' column order) */
export function hourX(row: Pick<HourRow, 'j' | 'l15' | 'l60' | 'l390'>): number[] {
  return [...DECISIONS.map(d => (row.j === d ? 1 : 0)), row.l60, row.l390, row.l15];
}

/** Fit the next-hour model on rows with a finite target and regressors; null under 200 rows or a missing dummy */
export function fitHour(rows: readonly HourRow[]): number[] | null {
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    if (!Number.isFinite(r.y)) continue;
    const x = hourX(r);
    if (!x.every(Number.isFinite)) continue;
    X.push(x);
    y.push(r.y);
  }
  if (X.length < MIN_INTRADAY_ROWS) return null;
  return lstsq(X, y);
}

export const hourForecast = (beta: readonly number[], row: Pick<HourRow, 'j' | 'l15' | 'l60' | 'l390'>): number => dot(beta, hourX(row));

/** The calendar quarter of a YYYY-MM-DD (lib.py quarter) */
export const quarterOf = (day: string): string => `${day.slice(0, 4)}Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

/** The first calendar day of a day's quarter, YYYY-MM-DD */
export const quarterStartDay = (day: string): string => `${day.slice(0, 4)}-${String(Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

/* ------------------------------------------------------------------ the live read: history, cached per name */

/** One closed session, kept: ln RV, its finite-minute count, and its decision rows */
export interface SessionRec {
  day: string;
  x: number;
  n: number;
  rows: [j: number, l15: number, l60: number, l390: number, y: number][];
}

interface Kept {
  v: number;
  ticker: string;
  days: SessionRec[];
  /** The newest kept day's last 390 returns (the next day's rows reach back into them) and the returns kept before */
  tail: { day: string; r: number[]; count: number } | null;
}

const KEEP_VERSION = 1;
const keepKey = (ticker: string) => `vol-outlook:${ticker}`;

export interface VolOutlook {
  ticker: string;
  state: 'loading' | 'ready' | 'offline' | 'thin';
  /** Months of minute bars read so far, of all to read (the first visit of a name reads about a year) */
  progress: { done: number; of: number };
  /** The last closed session (the forecast's origin) and the session it forecasts, YYYY-MM-DD */
  origin: string;
  target: string;
  /** Annualised, fractions (0.142 = 14.2%) */
  forecast: number;
  /** The last closed session's realised vol and the 22-session average of the log, annualised */
  lastRv: number;
  monthRv: number;
  /** The AR(1) shock half-life, sessions; φ */
  halfLife: number;
  phi: number;
  /** Sessions the daily fit stood on */
  fitRows: number;
  /** Sessions in the window */
  sessions: number;
  /** The last 22 sessions' realised vol, annualised, oldest first */
  recent: { day: string; rv: number }[];
  /** Coefficients, for the curious and the proof */
  har: number[];
  hourBeta: number[] | null;
  hourRows: number;
}

const blank = (ticker: string): VolOutlook => ({
  ticker,
  state: 'loading',
  progress: { done: 0, of: 0 },
  origin: '',
  target: '',
  forecast: NaN,
  lastRv: NaN,
  monthRv: NaN,
  halfLife: NaN,
  phi: NaN,
  fitRows: 0,
  sessions: 0,
  recent: [],
  har: [],
  hourBeta: null,
  hourRows: 0,
});

const two = (n: number) => String(n).padStart(2, '0');
const isoOfYmd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const ymdOfIso = (v: string) => v.replace(/-/g, '');
const dateOfIso = (v: string) => new Date(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));

/** The last session whose regular session has closed by `nowMs` (YYYY-MM-DD): today from its close on, else the
    session before. */
export function lastClosedSession(nowMs = Date.now()): string {
  const p = nyParts(nowMs);
  const today = new Date(p.year, p.month - 1, p.day);
  const iso = `${p.year}-${two(p.month)}-${two(p.day)}`;
  if (isTradingDay(today) && p.hour * 60 + p.minute >= sessionCloseMinOn(iso)) return iso;
  return isoDate(sessionBefore(today));
}

/** The session after a YYYY-MM-DD */
export function sessionAfter(iso: string): string {
  const d = dateOfIso(iso);
  for (let i = 0; i < 20; i++) {
    d.setDate(d.getDate() + 1);
    if (isTradingDay(d)) return isoDate(d);
  }
  return iso;
}

/** Where the window starts: HISTORY_SESSIONS sessions before the first session of the quarter of `liveDay` — fixed for
    the quarter, so the intraday fit and the cache only roll forward a quarter at a time. YYYY-MM-DD. */
export function windowStart(liveDay: string): string {
  const q0 = quarterStartDay(liveDay);
  const firstOfQuarter = sessionAfter(isoDate(sessionBefore(dateOfIso(q0))));
  return isoOfYmd(sessionsBack(ymdOfIso(firstOfQuarter), HISTORY_SESSIONS + 1));
}

/** Turn a run of new days (oldest first) into kept sessions, carrying the returns tail along */
function digest(grids: DayGrid[], tail: Kept['tail']): { recs: SessionRec[]; tail: Kept['tail'] } {
  const recs: SessionRec[] = [];
  const prior = tail ? tail.r : [];
  const priorCount = tail ? tail.count : 0;
  const series = grids.map(g => ({ day: g.day, r: dayReturns(g) }));
  const rows = hourRows(series, prior, priorCount);
  const byDay = new Map<string, SessionRec['rows']>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push([r.j, r.l15, r.l60, r.l390, r.y]);
    byDay.set(r.day, list);
  }
  let flat = prior.slice();
  let count = priorCount;
  for (const s of series) {
    const g = grids.find(x => x.day === s.day)!;
    recs.push({ day: s.day, x: dailyLogRv(g), n: g.last + 1, rows: byDay.get(s.day) ?? [] });
    for (let m = 0; m <= g.last; m++) flat.push(s.r[m]);
    count += g.last + 1;
    if (flat.length > NBAR) flat = flat.slice(-NBAR);
  }
  const lastDay = series.length ? series[series.length - 1].day : tail?.day ?? '';
  return { recs, tail: lastDay ? { day: lastDay, r: flat, count } : tail };
}

/** The fits and the forecast off the kept sessions (oldest first) */
export function outlookOf(ticker: string, recs: readonly SessionRec[], liveDay: string): Omit<VolOutlook, 'state' | 'progress'> | null {
  if (recs.length < 23) return null;
  const days = recs.map(r => r.day);
  const x = recs.map(r => r.x);
  const T = recs.length - 1;
  /* the study refits at the first session of the origin's month on the rows before it; the origin is the last closed
     session, so its month is the boundary */
  const t0 = monthStart(days, T);
  const fit = fitDaily(x, t0);
  if (!fit) return null;
  const xhat = harForecast(fit, x, T);
  const q0 = quarterStartDay(liveDay);
  const train: HourRow[] = [];
  for (const r of recs) {
    if (r.day >= q0) continue;
    for (const [j, l15, l60, l390, y] of r.rows) train.push({ day: r.day, j, l15, l60, l390, y });
  }
  const hourBeta = fitHour(train);
  const row = harRow(x, T);
  return {
    ticker,
    origin: days[T],
    target: sessionAfter(days[T]),
    forecast: annualiseDay(Math.exp(xhat)),
    lastRv: annualiseDay(Math.exp(x[T])),
    monthRv: annualiseDay(Math.exp(row[3])),
    halfLife: fit.halfLife,
    phi: fit.phi,
    fitRows: fit.rows,
    sessions: recs.length,
    recent: recs.slice(-22).map(r => ({ day: r.day, rv: annualiseDay(Math.exp(r.x)) })),
    har: fit.har,
    hourBeta,
    hourRows: train.filter(r => Number.isFinite(r.y)).length,
  };
}

/* ---- the store: one read per name, its history kept in this browser ---- */

const store = new Map<string, VolOutlook>();
const running = new Map<string, Promise<void>>();
const tails = new Map<string, Kept['tail']>();
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};
const put = (t: string, v: VolOutlook) => {
  store.set(t, v);
  emit();
};

/** Read the kept sessions, read the missing ones (two months of minute bars at a time, newest window anchored on the
    quarter), and fit. A closed session never changes, so a name's history is read once and kept. */
async function build(ticker: string): Promise<void> {
  const liveDay = isoDate(new Date(nyParts().year, nyParts().month - 1, nyParts().day));
  const last = lastClosedSession();
  const start = windowStart(liveDay);
  const kept = await keptTheta<Kept>(keepKey(ticker));
  let days: SessionRec[] = [];
  let tail: Kept['tail'] = null;
  if (kept && kept.data && kept.data.v === KEEP_VERSION && kept.data.days.length && kept.data.days[0].day <= start) {
    days = kept.data.days.filter(d => d.day >= start);
    tail = kept.data.tail;
  }
  /* the kept run must reach the window's start; else read it all again */
  if (!days.length) tail = null;
  const from = days.length ? sessionAfter(days[days.length - 1].day) : start;
  const cur = store.get(ticker) ?? blank(ticker);
  if (days.length) {
    const o = outlookOf(ticker, days, liveDay);
    if (o) put(ticker, { ...cur, ...o, state: from > last ? 'ready' : 'loading', progress: { done: 0, of: 0 } });
  }
  if (from <= last) {
    const spans = spansOf(ymdOfIso(from), ymdOfIso(last), '1m');
    const got: Map<string, MinuteBar[]>[] = new Array(spans.length);
    let done = 0;
    let offline = false;
    put(ticker, { ...(store.get(ticker) ?? blank(ticker)), progress: { done, of: spans.length } });
    /* two reads at a time, so one name never holds the page's history slots */
    let next = 0;
    const worker = async () => {
      while (next < spans.length && !offline) {
        const k = next++;
        const [a, b] = spans[k];
        const ans = await thetaGet(minutePath(ticker, a, b));
        if (ans.error && !noData(ans)) offline = true;
        got[k] = ans.error ? new Map() : minuteBarsOfRows(ans.data);
        done += 1;
        put(ticker, { ...(store.get(ticker) ?? blank(ticker)), progress: { done, of: spans.length } });
      }
    };
    await Promise.all([worker(), worker()]);
    if (offline) {
      const have = store.get(ticker) ?? blank(ticker);
      put(ticker, { ...have, state: have.origin ? 'ready' : 'offline' });
      return;
    }
    const byDay = new Map<string, MinuteBar[]>();
    for (const part of got) for (const [day, list] of part) byDay.set(day, [...(byDay.get(day) ?? []), ...list]);
    const grids: DayGrid[] = [];
    for (const day of [...byDay.keys()].sort()) {
      if (day < from || day > last) continue;
      const g = dayGrid(day, byDay.get(day)!);
      if (g) grids.push(g);
    }
    const dig = digest(grids, tail);
    days = [...days, ...dig.recs];
    tail = dig.tail;
    keepTheta(keepKey(ticker), { v: KEEP_VERSION, ticker, days, tail } satisfies Kept);
  }
  tails.set(ticker, tail);
  const o = outlookOf(ticker, days, liveDay);
  put(ticker, o ? { ...(store.get(ticker) ?? blank(ticker)), ...o, state: 'ready', progress: { done: 0, of: 0 } } : { ...blank(ticker), state: 'thin' });
}

/** Ask for a name's outlook; re-read when the last closed session moves on */
export function ensureVolOutlook(ticker: string): void {
  const t = ticker.trim().toUpperCase();
  if (!t) return;
  const have = store.get(t);
  const last = lastClosedSession();
  if (have && have.state !== 'offline' && (have.origin === last || have.state === 'loading')) return;
  if (running.has(t)) return;
  if (!have) store.set(t, blank(t));
  const job = build(t)
    .catch(() => {
      const h = store.get(t) ?? blank(t);
      put(t, { ...h, state: h.origin ? 'ready' : 'offline' });
    })
    .finally(() => running.delete(t));
  running.set(t, job);
}

export const peekVolOutlook = (ticker: string): VolOutlook | null => store.get(ticker.trim().toUpperCase()) ?? null;

export function useVolOutlook(ticker: string): VolOutlook {
  const t = ticker.trim().toUpperCase();
  useEffect(() => {
    ensureVolOutlook(t);
    /* a closed session lands at the bell: look again every ten minutes */
    const id = window.setInterval(() => ensureVolOutlook(t), 10 * 60_000);
    return () => window.clearInterval(id);
  }, [t]);
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  return store.get(t) ?? blank(t);
}

/* ---- the next hour, live: today's minutes off the chart's own tape ---- */

export interface HourRead {
  /** The decision minute (after 09:30) the read stands at, and its window's clock words ("10:15–11:15") */
  j: number;
  window: string;
  /** Annualised: the forecast of the next 60 minutes, and the last 60 minutes' realised */
  forecast: number;
  lastHour: number;
}

const clockOf = (j: number) => {
  const t = 9 * 60 + 30 + j;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${h > 12 ? h - 12 : h}:${two(m)}`;
};

/** The next-hour forecast at the latest decision minute today has reached, from today's one-minute bars (oldest
    first, the forming minute left out) and the kept tail of the session before. Null before 10:00, on a day with no
    session, or without a fit. */
export function hourReadNow(ticker: string, today: readonly Candle[], nowMs = Date.now()): HourRead | null {
  const t = ticker.trim().toUpperCase();
  const o = store.get(t);
  const tail = tails.get(t);
  if (!o || !o.hourBeta || !tail) return null;
  const p = nyParts(nowMs);
  const iso = `${p.year}-${two(p.month)}-${two(p.day)}`;
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return null;
  /* the tail must be the session just before today */
  if (tail.day !== isoDate(sessionBefore(new Date(p.year, p.month - 1, p.day)))) return null;
  const closeMin = sessionCloseMinOn(iso) - (9 * 60 + 30);
  /* minutes that have closed: everything before the minute now forming (the whole session once it is over) */
  const closed = Math.min(closeMin, nyMinutes(nowMs) - (9 * 60 + 30));
  const j = [...DECISIONS].reverse().find(d => d <= closed);
  if (j == null) return null;
  const bars = (minuteBarsByDay(today).get(iso) ?? []).filter(b => b.m < closed);
  /* the live day is not a stored day: a morning has under 150 bars and is still today (the rule drops broken history
     days); the grid is carried exactly as dayGrid does */
  const g = dayGrid(iso, bars, 1);
  if (!g) return null;
  const r = dayReturns(g);
  const upto = Array.from(r.slice(0, Math.min(closed, g.last + 1)));
  const rows = hourRows([{ day: iso, r: upto }], tail.r, tail.count);
  const row = rows.find(x => x.j === j);
  if (!row) return null;
  const f = hourForecast(o.hourBeta, row);
  return { j, window: `${clockOf(j)}–${clockOf(j + 60)}`, forecast: annualiseHour(Math.exp(f)), lastHour: annualiseHour(Math.exp(row.l60)) };
}
