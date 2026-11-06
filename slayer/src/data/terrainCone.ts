/* The forward cone: from the last price over the rest of today's session and the next one, 1σ and 2σ either side, off the
   at-the-money implied vols (ThetaData's on Terrain, the vendor's term structure on an Unusual Whales page).

   One σ is the standard deviation of the move to an expiry's close that its at-the-money vol prices: S·σ·√T. The vols are
   quoted on the calendar year; on the trading clock (core/volClock.ts vendorIvOnTradingClock, the same variance) that
   is σ_move = S × IV_trade × √(sessions / 252), and the variance runs only while the market is open. Between today's
   close and the next session's the variance grows linearly in trading time from today's to the next expiry's (the
   forward variance), so the curves are smooth and never shrink.

   Pinpoint's 1σ (data/book/move.ts) is the same S·σ·√T off the date's own row (its vol, else its implied move ÷ the
   vendor's k); the two differ only by which vendor's vol they read. The nodes view's candidate looks draw the cone off
   that one (data/nodeCone.ts), so the cone beside the nodes is the expected move the rest of the book prints. */

import { nyIsoDate, nyParts, nySessionPhase, nyWallTime } from '../core/nyTime';
import { isEarlyClose, isTradingDay } from '../core/calendar';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { vendorIvOnTradingClock } from '../core/volClock';

const SESSION_MIN = 390;
const CASH_OPEN_MIN = 9 * 60 + 30;
const CASH_CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;
const YEAR_MIN = SESSION_MIN * TRADING_DAYS;

/** Cash minutes in the session that day. A half day is 9:30–1:00 (210), not a hardcoded 390. */
export function cashSessionMinutes(iso: string): number {
  return (isEarlyClose(iso) ? EARLY_CLOSE_MIN : CASH_CLOSE_MIN) - CASH_OPEN_MIN;
}

export interface ConeTermRow {
  expiry: string;
  /** At-the-money implied vol, calendar-year fraction (0.16 = 16%) */
  iv: number;
}

export interface ForwardConePoint {
  /** Trading minutes ahead of now */
  minutesAhead: number;
  up1: number;
  dn1: number;
  up2: number;
  dn2: number;
}

export interface ForwardCone {
  spot: number;
  points: ForwardConePoint[];
  /** Trading minutes from now to today's close (0 once it has passed) and to the next session's close */
  todayMin: number;
  nextMin: number;
  /** The next session's date */
  nextDay: string;
  /** 1σ in dollars to today's close (null once it has passed) and to the next session's close */
  sigmaToday: number | null;
  sigmaNext: number;
  /** The vols used, on the trading clock, and the expiries they are */
  ivToday: number | null;
  ivNext: number;
  nextExpiry: string;
  /** Today's expected move: the session's open ± one full session's 1σ at today's vol (null without an open or a vol) */
  move: { anchor: number; sigma: number; high: number; low: number } | null;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The first session after `day` (YYYY-MM-DD) */
export function sessionAfter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  for (let k = 1; k < 10; k++) {
    const next = new Date(y, m - 1, d + k);
    if (isTradingDay(next)) return iso(next);
  }
  return day;
}

/** 1σ in dollars over `minutes` of trading time at a trading-clock vol: S × IV × √(sessions / 252) */
export const sigmaMove = (spot: number, ivTrade: number, minutes: number): number =>
  spot > 0 && ivTrade > 0 && minutes > 0 ? spot * ivTrade * Math.sqrt(minutes / YEAR_MIN) : 0;

/**
 * The cone from `spot` at `now`. `rows`: the at-the-money vols by expiry. `open`: today's opening price, for today's
 * expected move. `step`: trading minutes between points. Null without a vol for the next session.
 */
export function forwardCone(
  rows: readonly ConeTermRow[],
  spot: number,
  now: number,
  open: number | null,
  step = 5,
  clock?: { today: number; next: number },
): ForwardCone | null {
  if (!(spot > 0) || !rows.length) return null;
  const today = nyIsoDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const todayIsSession = isTradingDay(new Date(y, m - 1, d));
  const todayMin = clock ? Math.max(0, clock.today) : todayIsSession ? tradingMinutes(today, now, false) ?? 0 : 0;
  /* A clock that stops on today's close names today. Otherwise the coming session is today before the open, else the next. */
  const endsToday = clock != null && todayMin > 0 && clock.next <= todayMin;
  const nextDay = endsToday ? today : todayMin > 0 ? sessionAfter(today) : (() => {
    /* the coming session: today's when it has not opened yet, else the next */
    if (todayIsSession && nySessionPhase(now) === 'before') return today;
    return sessionAfter(today);
  })();
  /* The caller's clock is cash minutes. Do not push the tip a minute past the close. */
  const nextMin = clock ? Math.max(todayMin, Math.max(0, clock.next)) : tradingMinutes(nextDay, now, false) ?? 0;
  if (!(nextMin > 0)) return null;
  const sorted = [...rows].filter(r => r.iv > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const todayRow = todayMin > 0 ? sorted.find(r => r.expiry === today) : undefined;
  let nextRow = sorted.find(r => r.expiry === nextDay) ?? sorted.find(r => r.expiry > (todayMin > 0 ? today : nextDay)) ?? sorted.find(r => r.expiry >= nextDay);
  /* A clock that reaches past this session uses the expiry nearest that tip, not tomorrow's vol stretched for a year. */
  if (clock && sorted.length && nextMin > Math.max(todayMin, cashSessionMinutes(today))) {
    const sessionsOut = Math.max(1, Math.round(nextMin / Math.max(1, cashSessionMinutes(today))));
    let tip = todayMin > 0 ? today : nextDay;
    for (let i = 0; i < (todayMin > 0 ? Math.max(0, sessionsOut - 1) : sessionsOut); i++) tip = sessionAfter(tip);
    nextRow = sorted.find(r => r.expiry >= tip) ?? sorted[sorted.length - 1];
  }
  if (!nextRow) return null;
  const ivNext = vendorIvOnTradingClock(nextRow.iv, nextRow.expiry, now);
  const ivToday = todayRow ? vendorIvOnTradingClock(todayRow.iv, today, now) : null;
  /* variance (as a fraction of price squared) to today's close and to the next close */
  const rateNext = (ivNext * ivNext) / YEAR_MIN;
  const v0 = todayMin > 0 ? (ivToday != null ? (ivToday * ivToday) / YEAR_MIN : rateNext) * todayMin : 0;
  const v1 = Math.max(v0, rateNext * nextMin);
  const varAt = (h: number): number => (h <= todayMin ? (todayMin > 0 ? (v0 * h) / todayMin : 0) : v0 + ((v1 - v0) * (h - todayMin)) / Math.max(1, nextMin - todayMin));
  const points: ForwardConePoint[] = [];
  const s = Math.max(1, step);
  const at = (h: number) => {
    const w = spot * Math.sqrt(Math.max(0, varAt(h)));
    points.push({ minutesAhead: h, up1: spot + w, dn1: spot - w, up2: spot + 2 * w, dn2: spot - 2 * w });
  };
  for (let h = 0; h < nextMin; h += s) at(h);
  if (todayMin > 0 && todayMin !== nextMin && !points.some(p => p.minutesAhead === todayMin)) {
    at(todayMin);
    points.sort((a, b) => a.minutesAhead - b.minutesAhead);
  }
  if (!points.length || points[points.length - 1].minutesAhead !== nextMin) at(nextMin);
  const sigmaToday = todayMin > 0 ? spot * Math.sqrt(v0) : null;
  const sigmaNext = spot * Math.sqrt(v1);
  /* today's expected move from the open, on today's vol (the next session's before today has a vol of its own).
     A half day uses that short session, not 390 cash minutes. */
  const sessionIv = ivToday ?? (todayMin > 0 || nySessionPhase(now) === 'after' ? null : ivNext);
  const anchor = open != null && open > 0 ? open : null;
  const sessionSigma = anchor != null && sessionIv != null ? sigmaMove(anchor, sessionIv, cashSessionMinutes(today)) : 0;
  const move = anchor != null && sessionSigma > 0 ? { anchor, sigma: sessionSigma, high: anchor + sessionSigma, low: anchor - sessionSigma } : null;
  return { spot, points, todayMin, nextMin, nextDay, sigmaToday, sigmaNext, ivToday, ivNext, nextExpiry: nextRow.expiry, move };
}

/**
 * The time axis ahead of the last bar (seconds), `count` slots of `bucketSec` each, inside `walk`.
 * The cone walks the cash session (9:30–4:00, 9:30–1:00 on an early close), so a slot is a cash minute
 * and the fan ends at the cash close. A holiday is skipped. A daylight-saving gap is not filled with a bar.
 */
export function runwaySlots(
  lastTime: number,
  bucketSec: number,
  count: number,
  walk: { from: number; to: number; wraps: boolean; earlyClose?: boolean },
): number[] {
  const out: number[] = [];
  if (!(bucketSec > 0) || count <= 0) return out;
  if (bucketSec >= 86_400) {
    const days = Math.max(1, Math.round(bucketSec / 86_400));
    let t = lastTime;
    for (let guard = 0; out.length < count && guard < count * 4 + 20; guard++) {
      t += 86_400 * (days === 1 ? 1 : days);
      const d = new Date(t * 1000);
      if (days === 1 && !isTradingDay(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) continue;
      out.push(t);
    }
    return out;
  }
  let t = lastTime + bucketSec;
  for (let guard = 0; out.length < count && guard < count * 8 + 400; guard++) {
    const p = nyParts(t * 1000);
    const min = p.hour * 60 + p.minute;
    const iso = nyIsoDate(t * 1000);
    const to = walk.earlyClose && isEarlyClose(iso) ? 13 * 60 : walk.to;
    const inside = walk.wraps ? min >= walk.from || min < to : min >= walk.from && min < to;
    const day = new Date(p.year, p.month - 1, p.day);
    const prev = new Date(p.year, p.month - 1, p.day - 1);
    const morning = min < to;
    const allowed = walk.wraps
      ? (morning ? isTradingDay(prev) || prev.getDay() === 0 : isTradingDay(day) || p.weekday === 0)
      : isTradingDay(day);
    if (inside && allowed) {
      out.push(t);
      t += bucketSec;
      continue;
    }
    let next = 0;
    const startK = walk.wraps ? (min >= to && min < walk.from ? 0 : 1) : min < walk.from ? 0 : 1;
    for (let k = startK; k < 12 && !next; k++) {
      const at = new Date(p.year, p.month - 1, p.day + k);
      if (!walk.wraps && !isTradingDay(at)) continue;
      if (walk.wraps && at.getDay() !== 0 && !isTradingDay(at)) continue;
      const openMin = walk.from;
      next = nyWallTime(at.getFullYear(), at.getMonth() + 1, at.getDate(), Math.floor(openMin / 60), openMin % 60) / 1000;
      if (next <= t) next = 0;
    }
    if (!next) break;
    t = next;
  }
  return out;
}

/** Minutes left in the cash session, and minutes to the next cash close. Not the desk's wall clock. A half day ends at 1:00. */
export function sessionConeClock(now: number, from: number, to: number, wraps: boolean): { today: number; next: number } {
  const p = nyParts(now);
  const min = p.hour * 60 + p.minute;
  const len = wraps ? 24 * 60 - from + to : to - from;
  let today = 0;
  if (wraps) {
    if (min >= from) today = 24 * 60 - min + to;
    else if (min < to) today = to - min;
  } else if (min >= from && min < to) today = to - min;
  return { today, next: today > 0 ? today + len : len };
}

/** Cash minutes for the cone's horizon. Session ends at this cash close. Next adds the session after it.
    Week is five cash sessions (the one underway counts, a half day at its own length). Not five wall-clock sessions. */
export function coneClock(now: number, horizon: 'session' | 'week' | 'next'): { today: number; next: number } {
  const todayIso = nyIsoDate(now);
  const phase = nySessionPhase(now);
  const todayLen = cashSessionMinutes(todayIso);
  const from = CASH_OPEN_MIN;
  let cash = sessionConeClock(now, from, from + todayLen, false);
  if (cash.today > 0) cash = { today: cash.today, next: cash.today + cashSessionMinutes(sessionAfter(todayIso)) };
  else if (phase !== 'before') cash = { today: 0, next: cashSessionMinutes(sessionAfter(todayIso)) };
  if (horizon !== 'week') {
    return horizon === 'next' ? cash : { today: cash.today, next: cash.today > 0 ? cash.today : cash.next };
  }
  const lens: number[] = [];
  const push = (start: string, n: number) => {
    let d = start;
    for (let i = 0; i < n; i++) {
      lens.push(cashSessionMinutes(d));
      d = sessionAfter(d);
    }
  };
  if (cash.today > 0) {
    lens.push(cash.today);
    push(sessionAfter(todayIso), 4);
  } else if (phase === 'before') push(todayIso, 5);
  else push(sessionAfter(todayIso), 5);
  return { today: cash.today, next: lens.reduce((a, b) => a + b, 0) };
}
export function todayOpenOf(bars: readonly { time: number; open: number }[], now: number = Date.now()): number | null {
  const today = nyIsoDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const open = nyWallTime(y, m, d, 9, 30) / 1000;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    if (b.time < open - 86_400) break;
    if (nyIsoDate(b.time * 1000) !== today) continue;
    if (b.time >= open && (i === 0 || bars[i - 1].time < open || nyIsoDate(bars[i - 1].time * 1000) !== today)) return b.open > 0 ? b.open : null;
  }
  return null;
}

/** The cone's marked points: today's close on the 1σ curves (while the session runs), and the next session's close on
    the 1σ and 2σ curves. Their words are the key levels' at the edge (components/gex/levelExtras.ts coneRungs), so
    the marks carry the figures only for the hover and the tests. */
export function coneMarks(fc: ForwardCone, label = 'Next day'): { minutesAhead: number; price: number; text: string; strong?: boolean }[] {
  const out: { minutesAhead: number; price: number; text: string; strong?: boolean }[] = [];
  const end = fc.points[fc.points.length - 1];
  /* The close is its own mark only when the tip is further out than today. */
  if (fc.todayMin > 0 && fc.sigmaToday != null && fc.todayMin !== fc.nextMin) {
    out.push({ minutesAhead: fc.todayMin, price: fc.spot + fc.sigmaToday, text: `Close 1σ ${(fc.spot + fc.sigmaToday).toFixed(2)}`, strong: true });
    out.push({ minutesAhead: fc.todayMin, price: fc.spot - fc.sigmaToday, text: `Close 1σ ${(fc.spot - fc.sigmaToday).toFixed(2)}`, strong: true });
  }
  if (end) {
    out.push({ minutesAhead: end.minutesAhead, price: end.up1, text: `${label} 1σ ${end.up1.toFixed(2)}`, strong: true });
    out.push({ minutesAhead: end.minutesAhead, price: end.dn1, text: `${label} 1σ ${end.dn1.toFixed(2)}`, strong: true });
    out.push({ minutesAhead: end.minutesAhead, price: end.up2, text: `${label} 2σ ${end.up2.toFixed(2)}` });
    out.push({ minutesAhead: end.minutesAhead, price: end.dn2, text: `${label} 2σ ${end.dn2.toFixed(2)}` });
  }
  return out;
}

/** Trading minutes one bar of a timeframe holds. A day is one cash session, not 1,440 wall minutes.
    A week is five sessions. A month, a quarter, a half and a year are that many sessions, so a cone
    drawn in those bars lands on the right bar and not a week short of it. */
export const tradingMinutesPerBar = (mins: number): number => {
  if (mins >= 365 * 1440) return SESSION_MIN * 252;
  if (mins >= 180 * 1440) return SESSION_MIN * 126;
  if (mins >= 90 * 1440) return SESSION_MIN * 63;
  if (mins >= 28 * 1440) return SESSION_MIN * 21;
  if (mins >= 7 * 1440) return SESSION_MIN * 5;
  if (mins >= 3 * 1440) return SESSION_MIN * 3;
  if (mins >= 1440) return SESSION_MIN;
  return mins;
};

/** Cash sessions from now, counting what is left of today as the first when the session is open. */
function minutesOverSessions(now: number, n: number): { today: number; next: number } {
  const todayIso = nyIsoDate(now);
  const todayLen = cashSessionMinutes(todayIso);
  const phase = nySessionPhase(now);
  const cash = sessionConeClock(now, CASH_OPEN_MIN, CASH_OPEN_MIN + todayLen, false);
  let left = Math.max(1, n);
  let next = 0;
  let todayPart = 0;
  if (cash.today > 0) {
    next += cash.today;
    todayPart = cash.today;
    left -= 1;
  }
  let d = phase === 'before' && cash.today === 0 ? todayIso : sessionAfter(todayIso);
  for (let i = 0; i < left; i++) {
    next += cashSessionMinutes(d);
    d = sessionAfter(d);
  }
  return { today: todayPart > 0 && next > todayPart ? todayPart : 0, next };
}

/*
  The cone follows the interval on the chart. A 1-minute chart is not a 1-year
  chart, and the fan does not stay glued to today's close while the bars change.

  Minute bars shorter than a session get that many minutes of variance (30 for
  a 1-minute chart, up to 5 hours for a 10-minute chart), cut off at the cash
  close while the session is still open. 15-minute and 30-minute charts are
  the day. From an hour up, the fan is a named date frame: the next session,
  this week, two weeks, then the day frames themselves — one day, three days,
  a week, a month, a quarter, a half, a year.
*/
export function coneFrame(barMin: number, now: number): { today: number; next: number; label: string } {
  const todayIso = nyIsoDate(now);
  const todayLen = cashSessionMinutes(todayIso);
  const cash = sessionConeClock(now, CASH_OPEN_MIN, CASH_OPEN_MIN + todayLen, false);
  const phase = nySessionPhase(now);
  const row: { kind: 'minutes'; n: number; label: string } | { kind: 'sessions'; n: number; label: string } =
    barMin <= 1 ? { kind: 'minutes', n: 30, label: '30 minutes' }
    : barMin <= 2 ? { kind: 'minutes', n: 60, label: '1 hour' }
    : barMin <= 3 ? { kind: 'minutes', n: 90, label: '90 minutes' }
    : barMin <= 5 ? { kind: 'minutes', n: 150, label: '2 hours 30' }
    : barMin <= 10 ? { kind: 'minutes', n: 300, label: '5 hours' }
    : barMin <= 30 ? { kind: 'sessions', n: 1, label: 'Today' }
    : barMin <= 120 ? { kind: 'sessions', n: 2, label: 'Next session' }
    : barMin <= 360 ? { kind: 'sessions', n: 5, label: 'This week' }
    : barMin < 1440 ? { kind: 'sessions', n: 10, label: 'Two weeks' }
    : barMin <= 1440 ? { kind: 'sessions', n: 1, label: '1 day' }
    : barMin <= 3 * 1440 ? { kind: 'sessions', n: 3, label: '3 days' }
    : barMin <= 7 * 1440 ? { kind: 'sessions', n: 5, label: '1 week' }
    : barMin <= 30 * 1440 ? { kind: 'sessions', n: 21, label: '1 month' }
    : barMin <= 91 * 1440 ? { kind: 'sessions', n: 63, label: '3 months' }
    : barMin <= 182 * 1440 ? { kind: 'sessions', n: 126, label: '6 months' }
    : { kind: 'sessions', n: 252, label: '1 year' };
  if (row.kind === 'minutes') {
    if (cash.today > 0) {
      const next = Math.min(row.n, cash.today);
      return { today: 0, next, label: next < row.n ? 'To the close' : row.label };
    }
    return { today: 0, next: row.n, label: row.label };
  }
  const clock = minutesOverSessions(now, row.n);
  const label = row.label === 'Today' && clock.today === 0 && phase !== 'before' ? 'Next session' : row.label;
  return { today: clock.today, next: clock.next, label };
}
