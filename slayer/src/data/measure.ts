import { RTH_MINUTES } from '../core/calendar';

/* What a drag across the tape says: Δ$, Δ%, bars, elapsed and the annualised move, from the two bar times alone.
   Annualised on trading time (bars × interval), never the wall clock; a year is 252 sessions of RTH_MINUTES. */

/** Sessions in a year. The market's own count, not 365 and not 260. */
const TRADING_DAYS = 252;

/** Trading minutes in a year — the denominator the annualization divides by. */
export const YEAR_MINUTES = TRADING_DAYS * RTH_MINUTES;

interface MeasureSpan {
  /** Signed, in price. */
  deltaAbs: number;
  /** Signed, in percent of the FROM price. */
  deltaPct: number;
  /** Bars crossed. A drag inside one bar is 0, not 1. */
  bars: number;
  /** Wall-clock seconds between the two bar times, for the human reading. */
  elapsedSec: number;
  /** Trading minutes — bars × the interval. What the annualization uses. */
  tradingMin: number;
  /** The move at an annual rate in percent, or null on a zero-length span. */
  annualizedPct: number | null;
}

/** The span between two points on a chart of `barMinutes` bars (epoch seconds, either order); the move's sign follows time, not the drag. */
export function measureSpan(
  fromTime: number,
  fromPrice: number,
  toTime: number,
  toPrice: number,
  barMinutes: number
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
  /* `barMinutes` as given, fractions included (0.25 is the 15 s tape); 0 means no bar clock, so elapsed time is used directly. */
  const step = barMinutes > 0 ? barMinutes * 60 : 0;
  /* Floor, not round: completed bar steps only, so a sub-bar drag counts 0 bars. */
  const bars = step > 0 ? Math.floor(elapsedSec / step) : 0;
  const tradingMin = step > 0 ? bars * barMinutes : elapsedSec / 60;

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
