import { sessionStarts } from './indicators';
import type { Candle } from '../types/market';

/* Two distance rulers: Wilder's ATR on completed sessions (true range against the prior close, seeded with the first period's mean;
   the forming session excluded), and σ = spot · iv · √(1/252). Both null when they cannot be measured. */

const ATR_PERIOD = 14;

/** One session's OHLC, folded from base bars. */
interface SessionBar {
  high: number;
  low: number;
  close: number;
}

function foldSessions(bars1m: readonly Candle[]): SessionBar[] {
  if (bars1m.length === 0) return [];
  const starts = sessionStarts(bars1m, 1);
  const out: SessionBar[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : bars1m.length;
    let high = -Infinity;
    let low = Infinity;
    for (let i = from; i < to; i++) {
      if (bars1m[i].high > high) high = bars1m[i].high;
      if (bars1m[i].low < low) low = bars1m[i].low;
    }
    out.push({ high, low, close: bars1m[to - 1].close });
  }
  return out;
}

/** Wilder's ATR over completed sessions, in dollars; needs `period + 1` of them. Null until the tape has them. */
export function sessionAtr(bars1m: readonly Candle[], period = ATR_PERIOD): number | null {
  const sessions = foldSessions(bars1m);
  /* The last session is the one still printing — off the ruler. */
  const done = sessions.slice(0, -1);
  if (period < 1 || done.length < period + 1) return null;

  const tr = (cur: SessionBar, prevClose: number): number =>
    Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));

  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr(done[i], done[i - 1].close);
  atr /= period;
  for (let i = period + 1; i < done.length; i++) {
    atr = (atr * (period - 1) + tr(done[i], done[i - 1].close)) / period;
  }
  return atr;
}

export type DistanceUnit = '$' | '%' | 'ATR' | 'σ';
export const DISTANCE_UNITS: DistanceUnit[] = ['$', '%', 'ATR', 'σ'];

export interface DistanceScales {
  /** Wilder ATR of completed sessions, $ — null under warmup. */
  atr: number | null;
  /** One-day implied 1σ move, $ — null without a quoted vol. */
  sigma: number | null;
}

/** A signed distance in the chosen unit: ATR and σ to two decimals, an em-dash when their ruler is null. */
export function fmtDistance(deltaAbs: number, spot: number, unit: DistanceUnit, scales: DistanceScales): string {
  const sign = deltaAbs < 0 ? '−' : '+';
  const a = Math.abs(deltaAbs);
  if (unit === '$') return `${sign}$${a.toFixed(2)}`;
  if (unit === '%') return spot > 0 ? `${sign}${((a / spot) * 100).toFixed(2)}%` : '—';
  /* No scale, no unit: without a ruler the distance falls back to dollars. */
  if (unit === 'ATR') return scales.atr !== null && scales.atr > 0 ? `${sign}${(a / scales.atr).toFixed(2)} ATR` : `${sign}$${a.toFixed(2)}`;
  return scales.sigma !== null && scales.sigma > 0 ? `${sign}${(a / scales.sigma).toFixed(2)}σ` : `${sign}$${a.toFixed(2)}`;
}
