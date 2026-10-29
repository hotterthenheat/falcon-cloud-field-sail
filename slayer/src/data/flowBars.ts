import type { FlowPrint } from '../types/trace';

/* Trace's option prints summed into the candles' time buckets, calls up and puts down as two series, so the chart's
   flow pane reads the same prints the tape does. */

/** One bucket of the option tape, aligned to a chart bar. */
export interface FlowBar {
  /** Bar-aligned epoch seconds — the same unit lightweight-charts takes. */
  time: number;
  /** Call premium in the bucket, dollars. Always >= 0. */
  callPrem: number;
  /** Put premium in the bucket, dollars. Always >= 0 — the caller negates it
      to hang the leg below the axis, so this stays a magnitude. */
  putPrem: number;
  /** Prints that landed in the bucket, both sides. */
  count: number;
}

export interface BucketOptions {
  /** Bar width in seconds. Must match the chart's own interval. */
  barSec: number;
  /** Only prints on this symbol. Omit to take every print given. */
  ticker?: string;
  /** Drop prints before this epoch ms — the chart's left edge. */
  fromMs?: number;
}

/** Sum prints into bar-aligned buckets, ascending, only where something traded. `at` is epoch ms; a print with no
    usable `at` is dropped, never parked at zero. */
export function bucketFlow(
  prints: readonly (FlowPrint & { at?: number })[],
  options: BucketOptions
): FlowBar[] {
  const barSec = Math.max(1, Math.floor(options.barSec));
  const wanted = options.ticker?.toUpperCase();
  const fromMs = Number.isFinite(options.fromMs) ? (options.fromMs as number) : -Infinity;

  const byBucket = new Map<number, FlowBar>();

  for (const p of prints) {
    const at = p.at;
    // A print with no usable instant is dropped, never defaulted — see above.
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue;
    if (at < fromMs) continue;
    if (wanted && p.ticker?.toUpperCase() !== wanted) continue;

    const prem = p.premium;
    if (typeof prem !== 'number' || !Number.isFinite(prem) || prem <= 0) continue;

    /* The right is checked before the bucket exists, so a rejected print never leaves an empty bucket claiming a
       quiet minute. */
    const call = p.right === 'C';
    if (!call && p.right !== 'P') continue; // an unknown right counts as neither

    // Floor to the bucket. Flooring, not rounding: rounding would put a print
    // in the bar after the one it happened in for the back half of every bar.
    const sec = Math.floor(at / 1000);
    const time = Math.floor(sec / barSec) * barSec;

    let bar = byBucket.get(time);
    if (!bar) {
      bar = { time, callPrem: 0, putPrem: 0, count: 0 };
      byBucket.set(time, bar);
    }
    if (call) bar.callPrem += prem;
    else bar.putPrem += prem;
    bar.count += 1;
  }

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

/** The heaviest single leg across the buckets, over both legs together so calls and puts stay comparable. */
export function flowMaxLeg(bars: readonly FlowBar[]): number {
  let max = 0;
  for (const b of bars) {
    if (b.callPrem > max) max = b.callPrem;
    if (b.putPrem > max) max = b.putPrem;
  }
  return max;
}
