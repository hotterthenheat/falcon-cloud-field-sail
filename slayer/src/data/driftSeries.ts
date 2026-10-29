import type { FlowPrint } from '../types/trace';
import { bucketFlow } from './flowBars';

/* Two running totals of today's call and put premium (summed from bucketFlow, Trace's prints): the gap is the session's lean,
   the slope where money is arriving. The tape starts when the app opens, so a total from 10:41 is from 10:41, not the bell. */

/** One instant on the two running totals. */
interface DriftPoint {
  /** Bar-aligned epoch SECONDS — lightweight-charts' unit. */
  time: number;
  /** Call premium since the first print, dollars. Non-decreasing. */
  calls: number;
  /** Put premium since the first print, dollars. Non-decreasing. */
  puts: number;
}

interface DriftOptions {
  /** Bar width in seconds. Must match the chart's own interval. */
  barSec: number;
  /** Only prints on this symbol. Omit to take every print given. */
  ticker?: string;
  /** Drop prints before this epoch ms — the chart's left edge. */
  fromMs?: number;
}

/* A ceiling on the filled bars: one absurd timestamp must not materialise an unbounded array; above it the sparse buckets are returned as they are. */
const MAX_FILLED_POINTS = 5000;

/** Running call/put premium, one point per bar including quiet ones (held flat), so a line never shows premium arriving through a lunch hour.
    [] when nothing usable is in the tape: an empty pane, not a zero line. */
export function cumulativeDrift(
  prints: readonly (FlowPrint & { at?: number })[],
  options: DriftOptions
): DriftPoint[] {
  const barSec = Math.max(1, Math.floor(options.barSec));
  const bars = bucketFlow(prints, { ...options, barSec });
  if (bars.length === 0) return [];

  const span = (bars[bars.length - 1].time - bars[0].time) / barSec + 1;
  const fill = span <= MAX_FILLED_POINTS;

  const out: DriftPoint[] = [];
  let calls = 0;
  let puts = 0;

  if (!fill) {
    for (const b of bars) {
      calls += b.callPrem;
      puts += b.putPrem;
      out.push({ time: b.time, calls, puts });
    }
    return out;
  }

  let next = 0;
  for (let t = bars[0].time; t <= bars[bars.length - 1].time; t += barSec) {
    /* `while`, not `if`: bars from another clock could put several buckets in one step, and all must be consumed. */
    while (next < bars.length && bars[next].time <= t) {
      calls += bars[next].callPrem;
      puts += bars[next].putPrem;
      next++;
    }
    out.push({ time: t, calls, puts });
  }
  /* Anything left over sat past the last step — only reachable through the
     off-clock case above, and dropping it would lose real premium. */
  if (next < bars.length) {
    for (; next < bars.length; next++) {
      calls += bars[next].callPrem;
      puts += bars[next].putPrem;
    }
    out[out.length - 1] = { time: out[out.length - 1].time, calls, puts };
  }
  return out;
}

/** The larger of the two closing totals — what the pane scales against. */
export function driftPeak(points: readonly DriftPoint[]): number {
  const last = points[points.length - 1];
  if (!last) return 0;
  return Math.max(last.calls, last.puts);
}
