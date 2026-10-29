/* The forward cone: from the last price over the rest of today's session and the next one, 1σ and 2σ either side, off the
   at-the-money implied vols (ThetaData's on Terrain, the vendor's term structure on an Unusual Whales page).

   One σ is the standard deviation of the move to an expiry's close that its at-the-money vol prices: S·σ·√T. The vols are
   quoted on the calendar year; on the trading clock (core/volClock.ts vendorIvOnTradingClock, the same variance) that
   is σ_move = S × IV_trade × √(sessions / 252), and the variance runs only while the market is open. Between today's
   close and the next session's the variance grows linearly in trading time from today's to the next expiry's (the
   forward variance), so the curves are smooth and never shrink.

   Pinpoint's 1σ is the vendor's straddle × √(π/2): an at-the-money straddle prices E|move| = σ·√(2/π), so both are the
   same σ; they differ only by what each vendor quotes (ThetaData's vol against Unusual Whales' straddle price). */

import { nyIsoDate, nySessionPhase, nyWallTime } from '../core/nyTime';
import { isTradingDay } from '../core/calendar';
import { tradingMinutes, TRADING_DAYS } from '../core/tradingYear';
import { vendorIvOnTradingClock } from '../core/volClock';

const SESSION_MIN = 390;
const YEAR_MIN = SESSION_MIN * TRADING_DAYS;

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
export function forwardCone(rows: readonly ConeTermRow[], spot: number, now: number, open: number | null, step = 5): ForwardCone | null {
  if (!(spot > 0) || !rows.length) return null;
  const today = nyIsoDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const todayIsSession = isTradingDay(new Date(y, m - 1, d));
  const todayMin = todayIsSession ? tradingMinutes(today, now, false) ?? 0 : 0;
  const nextDay = todayMin > 0 ? sessionAfter(today) : (() => {
    /* the coming session: today's when it has not opened yet, else the next */
    if (todayIsSession && nySessionPhase(now) === 'before') return today;
    return sessionAfter(today);
  })();
  const nextMin = tradingMinutes(nextDay, now, false) ?? 0;
  if (!(nextMin > 0)) return null;
  const sorted = [...rows].filter(r => r.iv > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const todayRow = todayMin > 0 ? sorted.find(r => r.expiry === today) : undefined;
  const nextRow = sorted.find(r => r.expiry === nextDay) ?? sorted.find(r => r.expiry > (todayMin > 0 ? today : nextDay)) ?? sorted.find(r => r.expiry >= nextDay);
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
  if (todayMin > 0 && !points.some(p => p.minutesAhead === todayMin)) {
    at(todayMin);
    points.sort((a, b) => a.minutesAhead - b.minutesAhead);
  }
  at(nextMin);
  const sigmaToday = todayMin > 0 ? spot * Math.sqrt(v0) : null;
  const sigmaNext = spot * Math.sqrt(v1);
  /* today's expected move from the open, on today's vol (the next session's before today has a vol of its own) */
  const sessionIv = ivToday ?? (todayMin > 0 || nySessionPhase(now) === 'after' ? null : ivNext);
  const anchor = open != null && open > 0 ? open : null;
  const sessionSigma = anchor != null && sessionIv != null ? sigmaMove(anchor, sessionIv, SESSION_MIN) : 0;
  const move = anchor != null && sessionSigma > 0 ? { anchor, sigma: sessionSigma, high: anchor + sessionSigma, low: anchor - sessionSigma } : null;
  return { spot, points, todayMin, nextMin, nextDay, sigmaToday, sigmaNext, ivToday, ivNext, nextExpiry: nextRow.expiry, move };
}

/**
 * The time axis ahead of the last bar (seconds), `count` slots of `bucketSec` each, on the clock the bars are on: a
 * regular-session chart's intraday slots run 9:30–16:00 on sessions only, and a day bar's skip the days with no session,
 * so a slot ahead is trading time — what the cone's variance runs on. Other sessions keep the wall clock.
 */
export function runwaySlots(lastTime: number, bucketSec: number, count: number, regular: boolean): number[] {
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
  if (!regular) {
    for (let i = 1; i <= count; i++) out.push(lastTime + i * bucketSec);
    return out;
  }
  let t = lastTime + bucketSec;
  for (let guard = 0; out.length < count && guard < count * 8 + 200; guard++) {
    const ms = t * 1000;
    const [y, m, d] = nyIsoDate(ms).split('-').map(Number);
    const open = nyWallTime(y, m, d, 9, 30) / 1000;
    const close = nyWallTime(y, m, d, 16, 0) / 1000;
    if (isTradingDay(new Date(y, m - 1, d)) && t >= open && t < close) {
      out.push(t);
      t += bucketSec;
      continue;
    }
    /* outside a session: the next session's open */
    let k = t < open && isTradingDay(new Date(y, m - 1, d)) ? 0 : 1;
    let next = 0;
    for (; k < 10; k++) {
      const day = new Date(y, m - 1, d + k);
      if (!isTradingDay(day)) continue;
      next = nyWallTime(day.getFullYear(), day.getMonth() + 1, day.getDate(), 9, 30) / 1000;
      break;
    }
    if (!next || next <= t) break;
    t = next;
  }
  return out;
}

/** Today's regular-session open off the chart's bars (the first bar of today at or after 9:30), null before it */
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
export function coneMarks(fc: ForwardCone): { minutesAhead: number; price: number; text: string; strong?: boolean }[] {
  const out: { minutesAhead: number; price: number; text: string; strong?: boolean }[] = [];
  const end = fc.points[fc.points.length - 1];
  if (fc.todayMin > 0 && fc.sigmaToday != null) {
    out.push({ minutesAhead: fc.todayMin, price: fc.spot + fc.sigmaToday, text: `Close 1σ ${(fc.spot + fc.sigmaToday).toFixed(2)}`, strong: true });
    out.push({ minutesAhead: fc.todayMin, price: fc.spot - fc.sigmaToday, text: `Close 1σ ${(fc.spot - fc.sigmaToday).toFixed(2)}`, strong: true });
  }
  if (end) {
    out.push({ minutesAhead: end.minutesAhead, price: end.up1, text: `Next day 1σ ${end.up1.toFixed(2)}`, strong: true });
    out.push({ minutesAhead: end.minutesAhead, price: end.dn1, text: `Next day 1σ ${end.dn1.toFixed(2)}`, strong: true });
    out.push({ minutesAhead: end.minutesAhead, price: end.up2, text: `2σ ${end.up2.toFixed(2)}` });
    out.push({ minutesAhead: end.minutesAhead, price: end.dn2, text: `2σ ${end.dn2.toFixed(2)}` });
  }
  return out;
}

/** Trading minutes one bar of a timeframe holds: its minutes intraday, a session a day bar, five a week bar */
export const tradingMinutesPerBar = (mins: number): number => (mins >= 10_080 ? SESSION_MIN * 5 : mins >= 1440 ? SESSION_MIN : mins);
