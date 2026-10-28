/*
  The biggest moves on the price chart, up to the minute on screen.
  A swing is one run of bars that keep the same direction. The three
  largest, in dollars, are the ones the book keeps sharp.
*/

import { useSyncExternalStore } from 'react';

export interface ChartSwing {
  /** Unix seconds of the bar the run ended on */
  time: number;
  from: number;
  to: number;
  /** Signed dollars, end minus start */
  delta: number;
}

export function biggestSwings(bars: readonly { time: number; close: number }[], n = 3): ChartSwing[] {
  if (bars.length < 2) return [];
  let hi = bars[0].close;
  let lo = bars[0].close;
  for (const b of bars) {
    if (b.close > hi) hi = b.close;
    if (b.close < lo) lo = b.close;
  }
  /* A one-tick reverse is not a new move. A leg ends when price gives back a
     fifth of the path on the chart, so the three marks are the moves you can
     see, not the noise between them. */
  const threshold = Math.max((hi - lo) * 0.2, Math.abs(bars[bars.length - 1].close) * 0.0008, 0.01);
  const pivots: { time: number; price: number }[] = [{ time: bars[0].time, price: bars[0].close }];
  let extreme = bars[0].close;
  let extremeTime = bars[0].time;
  let dir: 1 | -1 | 0 = 0;
  const closeLeg = () => {
    const prev = pivots[pivots.length - 1];
    if (extreme !== prev.price) pivots.push({ time: extremeTime, price: extreme });
  };
  for (let i = 1; i < bars.length; i++) {
    const px = bars[i].close;
    const t = bars[i].time;
    if (dir === 0) {
      if (px >= pivots[0].price + threshold) {
        dir = 1;
        extreme = px;
        extremeTime = t;
      } else if (px <= pivots[0].price - threshold) {
        dir = -1;
        extreme = px;
        extremeTime = t;
      }
      continue;
    }
    if (dir === 1) {
      if (px >= extreme) {
        extreme = px;
        extremeTime = t;
      } else if (extreme - px >= threshold) {
        closeLeg();
        dir = -1;
        extreme = px;
        extremeTime = t;
      }
    } else if (px <= extreme) {
      extreme = px;
      extremeTime = t;
    } else if (px - extreme >= threshold) {
      closeLeg();
      dir = 1;
      extreme = px;
      extremeTime = t;
    }
  }
  if (dir !== 0) closeLeg();
  const legs: ChartSwing[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const a = pivots[i - 1];
    const b = pivots[i];
    if (a.price === b.price) continue;
    legs.push({ time: b.time, from: a.price, to: b.price, delta: b.price - a.price });
  }
  if (!legs.length && bars[0].close !== bars[bars.length - 1].close) {
    const b = bars[bars.length - 1];
    legs.push({ time: b.time, from: bars[0].close, to: b.close, delta: b.close - bars[0].close });
  }
  legs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const used = new Set<number>();
  const out: ChartSwing[] = [];
  for (const s of legs) {
    if (used.has(s.time)) continue;
    used.add(s.time);
    out.push(s);
    if (out.length === n) break;
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The strikes on this book nearest the turns. A turn farther than `maxGap` is off the window and is not forced onto a row. */
export function nearestStrikes(prices: number[], strikes: readonly number[], maxGap = Infinity): number[] {
  const out: number[] = [];
  for (const p of prices) {
    let best: number | null = null;
    for (const s of strikes) {
      if (best == null || Math.abs(s - p) < Math.abs(best - p)) best = s;
    }
    if (best == null || Math.abs(best - p) > maxGap) continue;
    if (!out.includes(best)) out.push(best);
  }
  return out;
}

/** Half a strike, so a turn lights the row it landed on and not the next one. */
export function strikeGap(strikes: readonly number[]): number {
  let step = Infinity;
  for (let i = 1; i < strikes.length; i++) {
    const d = Math.abs(strikes[i] - strikes[i - 1]);
    if (d > 0 && d < step) step = d;
  }
  return Number.isFinite(step) ? step / 2 + 1e-6 : Infinity;
}

const focus = new Set<string>();
const swings = new Map<string, ChartSwing[]>();
let rev = 0;
const subs = new Set<() => void>();
const bump = () => {
  rev += 1;
  subs.forEach(fn => fn());
};
const listen = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

export function setChartFocus(tickers: Iterable<string>): void {
  const next = new Set([...tickers].map(t => t.toUpperCase()).filter(Boolean));
  if (next.size === focus.size && [...next].every(t => focus.has(t))) return;
  focus.clear();
  for (const t of next) focus.add(t);
  bump();
}

export function publishSwings(ticker: string, next: ChartSwing[]): void {
  const t = ticker.toUpperCase();
  if (!t) return;
  const prev = swings.get(t);
  if (prev && prev.length === next.length && prev.every((p, i) => p.time === next[i].time && p.to === next[i].to && p.delta === next[i].delta)) return;
  swings.set(t, next);
  bump();
}

export const swingsFor = (ticker: string): ChartSwing[] => swings.get(ticker.toUpperCase()) ?? [];
export const swingsKnown = (ticker: string): boolean => swings.has(ticker.toUpperCase());
export const chartFocused = (ticker: string): boolean => focus.has(ticker.toUpperCase());

export function useChartMovesRev(): number {
  return useSyncExternalStore(listen, () => rev, () => rev);
}

export function useChartFocus(ticker: string): boolean {
  useChartMovesRev();
  return chartFocused(ticker);
}
