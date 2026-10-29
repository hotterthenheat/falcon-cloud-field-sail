import type { Candle } from '../types/market';

/* Two vol lines under the tape: realised, measured from the drawn bars (rolling log-return stdev, annualised), and implied as the feed
   reports it (flat when the feed gives one number). The window and annualisation are gathered in RV_MODEL. */

/** Close-to-close over a rolling window, annualised on trading time (252 sessions of 6.5 h); calendar time would count closed hours and halve it. */
const RV_MODEL = {
  /** Bars in the rolling sample. 30 on a 1m clock is half an hour. */
  window: 30,
  /** Trading sessions per year. */
  sessionsPerYear: 252,
  /** Seconds in a regular US equity session — 09:30 to 16:00. */
  sessionSeconds: 6.5 * 3600,
} as const;

/** One instant on a volatility line. */
interface VolPoint {
  /** Bar-aligned epoch SECONDS — lightweight-charts' unit. */
  time: number;
  /** Volatility as a PERCENT (7.68 means 7.68%), the axis's unit. */
  value: number;
}

/** Sample periods a year at this bar width: an intraday bar is a slice of a session (sessionSeconds / barSec); a daily or weekly bar
    is whole sessions (5/7 of its calendar days), or a daily bar annualises at 68 a year instead of 252. */
function periodsPerYear(barSec: number): number {
  const sec = Math.max(1, barSec);
  if (sec < RV_MODEL.sessionSeconds) {
    return RV_MODEL.sessionsPerYear * (RV_MODEL.sessionSeconds / sec);
  }
  const sessionsPerBar = Math.max(1, (sec / 86_400) * (5 / 7));
  return RV_MODEL.sessionsPerYear / sessionsPerBar;
}

/** Rolling annualised realised vol in percent; the first `window` bars give no points (a one-return stdev is a fake 0%).
    Overnight gaps are dropped from the sample, not counted as returns. */
export function realizedVol(bars: readonly Candle[], barSec: number): VolPoint[] {
  const window = Math.max(2, Math.floor(RV_MODEL.window));
  if (bars.length <= window) return [];

  const scale = Math.sqrt(periodsPerYear(barSec)) * 100;
  /* The overnight test is intraday-only: a gap over 1.5 bars is a session break (as the VWAP anchor tests); at or above a session
     consecutive bars are consecutive sessions. */
  const gapSec = barSec < RV_MODEL.sessionSeconds ? barSec * 1.5 : Infinity;

  /* returns[i] belongs to bars[i + 1]; null where the step crossed a break. */
  const returns: (number | null)[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (cur.time - prev.time > gapSec) {
      returns.push(null);
      continue;
    }
    if (!(prev.close > 0) || !(cur.close > 0)) {
      returns.push(null);
      continue;
    }
    returns.push(Math.log(cur.close / prev.close));
  }

  const out: VolPoint[] = [];
  for (let end = window; end <= returns.length; end++) {
    const sample: number[] = [];
    for (let i = end - window; i < end; i++) {
      const r = returns[i];
      if (r !== null && Number.isFinite(r)) sample.push(r);
    }
    /* A window that lost most of itself to a session break is not reported.
       Two surviving returns would produce a number, and it would be a number
       about two minutes wearing the label of a thirty-minute window. */
    if (sample.length < Math.ceil(window / 2)) continue;

    let mean = 0;
    for (const r of sample) mean += r;
    mean /= sample.length;
    let sq = 0;
    for (const r of sample) sq += (r - mean) * (r - mean);
    /* Sample variance, n-1: the mean was estimated from the same sample, and
       dividing by n understates the spread. */
    const variance = sq / (sample.length - 1);
    const value = Math.sqrt(variance) * scale;
    if (!Number.isFinite(value)) continue;
    out.push({ time: bars[end].time, value });
  }
  return out;
}

/** The implied line as reported: one reading (a fraction in, percent out) held across the realised line's bars; nothing reported draws nothing. */
export function impliedVolLine(iv: number | null | undefined, over: readonly VolPoint[]): VolPoint[] {
  if (typeof iv !== 'number' || !Number.isFinite(iv) || iv <= 0) return [];
  const pct = iv * 100;
  return over.map(p => ({ time: p.time, value: pct }));
}

/** The top of the shared axis, with a little air. Zero when there is nothing. */
export function volCeiling(...series: readonly VolPoint[][]): number {
  let max = 0;
  for (const s of series) for (const p of s) if (p.value > max) max = p.value;
  return max > 0 ? max * 1.1 : 0;
}
