import { RTH_MINUTES, isTradingDay, sessionLengthOn } from '../core/calendar';
import { tradingMinutesBetween } from '../core/tradingYear';
import { nyParts } from '../core/nyTime';

/* What a drag across the tape says: Δ$, Δ%, bars, elapsed and the annualised move. Annualised on TRADING time — the
   regular-session minutes between the two instants (core/tradingYear tradingMinutesBetween: nights, weekends and holidays
   are not market time, an early close is 210 minutes) — never the wall clock; a year is 252 sessions of RTH_MINUTES. Friday
   15:00 → Monday 10:00 is 90 trading minutes, not 67 hours. A daily bar is its session's length, not 1440 minutes. */

/** Sessions in a year. The market's own count, not 365 and not 260. */
const TRADING_DAYS = 252;

/** Trading minutes in a year — the denominator the annualization divides by. */
export const YEAR_MINUTES = TRADING_DAYS * RTH_MINUTES;

interface MeasureSpan {
  /** Signed, in price. */
  deltaAbs: number;
  /** Signed, in percent of the FROM price. */
  deltaPct: number;
  /** Bars crossed, by index when the caller passes the bar times. A drag inside one bar is 0, not 1. */
  bars: number;
  /** Wall-clock seconds between the two bar times, for the human reading. */
  elapsedSec: number;
  /** Regular-session minutes between the two instants (a daily bar is its session's length). What the annualization uses. */
  tradingMin: number;
  /** The move at an annual rate in percent, or null on a zero-length span. */
  annualizedPct: number | null;
}

/** Index of the last bar at or before `t` in ascending `times` (−1 when `t` is before the first). */
function barIndexAt(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

/** The sessions whose New York date is after `t0`'s and at or before `t1`'s, and their cash minutes (210 on an early close). */
function sessionsAfter(t0: number, t1: number): { sessions: number; minutes: number } {
  const a = nyParts(t0 * 1000);
  const b = nyParts(t1 * 1000);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  let sessions = 0;
  let minutes = 0;
  for (let t = Date.UTC(a.year, a.month - 1, a.day) + 86_400_000; t <= end; t += 86_400_000) {
    const d = new Date(t);
    if (!isTradingDay(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) continue;
    sessions += 1;
    minutes += sessionLengthOn(d.toISOString().slice(0, 10));
  }
  return { sessions, minutes };
}

/** The span between two points on a chart of `barMinutes` bars (epoch seconds, either order); the move's sign follows time, not
    the drag. `barTimes` (the chart's bar times, ascending) counts the bars by index — the bars actually drawn between the two,
    gaps and closed hours skipped; without it an intraday span counts trading minutes ÷ the interval. */
export function measureSpan(
  fromTime: number,
  fromPrice: number,
  toTime: number,
  toPrice: number,
  barMinutes: number,
  barTimes?: readonly number[]
): MeasureSpan {
  /* Ordered by TIME so the sign is the market's, not the pointer's. */
  const backwards = toTime < fromTime;
  const t0 = backwards ? toTime : fromTime;
  const t1 = backwards ? fromTime : toTime;
  const p0 = backwards ? toPrice : fromPrice;
  const p1 = backwards ? fromPrice : toPrice;

  const deltaAbs = p1 - p0;
  const deltaPct = p0 !== 0 ? (deltaAbs / Math.abs(p0)) * 100 : 0;
  const elapsedSec = Math.max(0, t1 - t0);
  /* `barMinutes` as given, fractions included (0.25 is the 15 s tape); 0 means no bar clock. */
  const step = barMinutes > 0 ? barMinutes * 60 : 0;
  let tradingMin: number;
  let bars: number;
  if (barMinutes >= 1440) {
    /* date bars: each session is its own length; a 1D bar counts one session, a longer one its calendar steps */
    const s = sessionsAfter(t0, t1);
    tradingMin = s.minutes;
    bars = barMinutes === 1440 ? s.sessions : Math.floor(elapsedSec / step);
  } else {
    tradingMin = tradingMinutesBetween(t0 * 1000, t1 * 1000);
    /* Floor, not round: completed bar steps only, so a sub-bar drag counts 0 bars. A span wholly outside the cash session
       (an evening's after-hours) has no trading minutes: its bars are its wall-clock steps. */
    bars = step > 0 ? Math.floor((tradingMin > 0 ? tradingMin * 60 : elapsedSec) / step) : 0;
  }
  if (barTimes && barTimes.length && step > 0) {
    const i0 = barIndexAt(barTimes, t0);
    const i1 = barIndexAt(barTimes, t1);
    if (i0 >= 0 && i1 >= 0) bars = i1 - i0;
  }

  const years = tradingMin / YEAR_MINUTES;
  const annualizedPct = years > 0 && Number.isFinite(deltaPct) ? Math.abs(deltaPct) / Math.sqrt(years) : null;

  return { deltaAbs, deltaPct, bars, elapsedSec, tradingMin, annualizedPct };
}

/** Elapsed for a person (`3h 24m`, `2d 1h`), days counted as sessions to agree with the bar count. */
export function fmtElapsed(tradingMin: number): string {
  if (tradingMin <= 0) return '0m';
  const perDay = RTH_MINUTES;
  const days = Math.floor(tradingMin / perDay);
  const rest = tradingMin - days * perDay;
  const hours = Math.floor(rest / 60);
  const mins = Math.round(rest - hours * 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}
