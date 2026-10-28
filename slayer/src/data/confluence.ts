import { aggregateCandles, tfMinutes, type Timeframe } from './timeframe';
import { emaSeries, emaWarmup, sessionStarts, vwapSeries } from './indicators';
import type { Candle } from '../types/market';

/*
==================================================
  SLAYER TERMINAL - MULTI-TIMEFRAME CONFLUENCE (data/confluence.ts)

  Whether the timeframes agree, in one line — T-12.
==================================================

  THE RULE IS FIXED, AND IT IS THE WHOLE RULE.

      above its EMA21 AND above its VWAP   → up
      below its EMA21 AND below its VWAP   → down
      one of each                          → flat

  NOT ENOUGH HISTORY IS ITS OWN STATE. `null` renders as a dash, not as a bar.

  THE CURVES COME FROM data/indicators.ts, the same two functions the tape
  draws its EMA21 and VWAP lines from.

  A tick that only moves the forming bar does not walk the series again.
  The fold keeps the EMA and the session VWAP from before that bar, and
  patches the last point. A new bar, or a bucket that rolled, folds from
  scratch. The glyph on the timeframe pill only needs the last comparison.
*/

export type TrendState = 'up' | 'flat' | 'down';

export const CONFLUENCE_TFS: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '1D'];

export interface ConfluenceRow {
  tf: Timeframe;
  /** null when this timeframe has too little history to have an opinion. */
  state: TrendState | null;
  /** How many bars this timeframe actually had — what `null` is explained by. */
  bars: number;
}

/** The period the rule names. Exported so the proof and the tooltip agree. */
export const CONFLUENCE_EMA = 21;

const confMem = new WeakMap<object, ConfMem>();

interface TfMem {
  mins: number;
  bars: number;
  /** EMA before the last aggregated bar. Null when that bar is the series. */
  emaPrev: number | null;
  pvPrev: number;
  volPrev: number;
  /** The last aggregated bar opens a session, so VWAP restarts on it. */
  sessionStart: boolean;
  aggTime: number;
}

interface ConfMem {
  n: number;
  t0: number;
  lastTime: number;
  rows: ConfluenceRow[];
  tfs: TfMem[];
}

const EMA_K = 2 / (CONFLUENCE_EMA + 1);

function stateOf(close: number, ema: number, vwap: number): TrendState {
  return close > ema && close > vwap ? 'up' : close < ema && close < vwap ? 'down' : 'flat';
}

/** The open bucket the last base bar belongs to. High and low are re-read; they are not invertible. */
function lastAggregate(base: readonly Candle[], mins: number): Candle {
  const last = base[base.length - 1]!;
  if (mins <= 1) return last;
  const bucketSec = mins * 60;
  const bucket = Math.floor(last.time / bucketSec) * bucketSec;
  let open = last.open;
  let high = last.high;
  let low = last.low;
  let volume = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    const b = base[i]!;
    if (Math.floor(b.time / bucketSec) * bucketSec !== bucket) break;
    open = b.open;
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volume += b.volume;
  }
  return { time: bucket, open, high, low, close: last.close, volume };
}

function rowFrom(tf: Timeframe, bars: number, close: number, ema: number, vwap: number): ConfluenceRow {
  if (bars < emaWarmup(CONFLUENCE_EMA) || !Number.isFinite(ema) || !Number.isFinite(vwap)) {
    return { tf, state: null, bars };
  }
  return { tf, state: stateOf(close, ema, vwap), bars };
}

function foldAll(base: readonly Candle[]): { rows: ConfluenceRow[]; tfs: TfMem[] } {
  const rows: ConfluenceRow[] = [];
  const tfs: TfMem[] = [];
  for (const tf of CONFLUENCE_TFS) {
    const mins = tfMinutes(tf);
    const bars = aggregateCandles(base as Candle[], mins);
    const n = bars.length;
    const lastBar = bars[n - 1];
    if (n < emaWarmup(CONFLUENCE_EMA) || !lastBar) {
      rows.push({ tf, state: null, bars: n });
      tfs.push({ mins, bars: n, emaPrev: null, pvPrev: 0, volPrev: 0, sessionStart: false, aggTime: lastBar?.time ?? 0 });
      continue;
    }
    const ema = emaSeries(bars, CONFLUENCE_EMA);
    const vwap = vwapSeries(bars, mins);
    const starts = new Set(sessionStarts(bars, mins));
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i > 0 && starts.has(i)) {
        pv = 0;
        vol = 0;
      }
      const b = bars[i]!;
      const typical = (b.high + b.low + b.close) / 3;
      pv += typical * b.volume;
      vol += b.volume;
    }
    rows.push(rowFrom(tf, n, lastBar.close, ema[n - 1]!, vwap[n - 1]!));
    tfs.push({
      mins,
      bars: n,
      emaPrev: n > 1 ? ema[n - 2]! : null,
      pvPrev: pv,
      volPrev: vol,
      sessionStart: n > 1 && starts.has(n - 1),
      aggTime: lastBar.time,
    });
  }
  return { rows, tfs };
}

/**
 * One row per timeframe, from a symbol's 1-minute base bars.
 *
 * `base` is the raw 1m series. The same array the simulator mutates can be
 * passed again: if only the forming bar moved, the last EMA and VWAP are
 * patched and the earlier bars are not walked.
 */
export function buildConfluence(base: readonly Candle[]): ConfluenceRow[] {
  const last = base[base.length - 1];
  const first = base[0];
  if (!last || !first) return [];
  const held = confMem.get(base);
  if (held && held.n === base.length && held.t0 === first.time && held.lastTime === last.time) {
    const rows: ConfluenceRow[] = [];
    for (let i = 0; i < held.tfs.length; i++) {
      const mem = held.tfs[i]!;
      const agg = lastAggregate(base, mem.mins);
      if (agg.time !== mem.aggTime) {
        rows.length = 0;
        break;
      }
      const ema = mem.emaPrev == null ? agg.close : agg.close * EMA_K + mem.emaPrev * (1 - EMA_K);
      let pv = mem.sessionStart ? 0 : mem.pvPrev;
      let vol = mem.sessionStart ? 0 : mem.volPrev;
      const typical = (agg.high + agg.low + agg.close) / 3;
      pv += typical * agg.volume;
      vol += agg.volume;
      const vwap = vol > 0 ? pv / vol : agg.close;
      rows.push(rowFrom(CONFLUENCE_TFS[i]!, mem.bars, agg.close, ema, vwap));
    }
    if (rows.length === held.tfs.length) {
      held.rows = rows;
      return rows;
    }
  }
  const folded = foldAll(base);
  confMem.set(base, { n: base.length, t0: first.time, lastTime: last.time, rows: folded.rows, tfs: folded.tfs });
  return folded.rows;
}

/** ▲ / ▬ / ▼ — and a dash where there is no view. */
export const TREND_GLYPH: Record<TrendState, string> = { up: '▲', flat: '▬', down: '▼' };

/** What a row means, in words, for the hover title and a screen reader. */
export const trendWords = (row: ConfluenceRow): string =>
  row.state === null
    ? `${row.tf}: not enough history — ${row.bars} bar${row.bars === 1 ? '' : 's'}`
    : row.state === 'up'
      ? `${row.tf}: above its EMA${CONFLUENCE_EMA} and its VWAP`
      : row.state === 'down'
        ? `${row.tf}: below its EMA${CONFLUENCE_EMA} and its VWAP`
        : `${row.tf}: between its EMA${CONFLUENCE_EMA} and its VWAP`;
