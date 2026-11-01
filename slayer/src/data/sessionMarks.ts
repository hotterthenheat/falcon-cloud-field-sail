/* What an intraday chart marks of the sessions, from its own bars (components/gex/sessionsPrimitive.ts draws it):
   - the extended hours as runs of bars: pre-market, after hours, overnight (the stock tape's windows,
     shared/marketSession.mjs: an early close moves the after-hours run to 13:00–17:00);
   - the session breaks: the first bar of each new session day (an overnight belongs to the morning it opens into);
   - the Sessions indicator's boxes: Tokyo, London and New York (worldSessionsBetween), each spanning its bars, from
     the highest high to the lowest low inside its hours.
   Every clock here is the session module's; nothing spells an hour. Pure: the bars are not changed. */

import { nyWall, tradingDayOf, windowAt, worldSessionsBetween, type WorldSessionKey } from '../core/session';
import type { Candle } from '../types/market';

export type ExtKind = 'pre' | 'post' | 'overnight';
/** A run of extended-hours bars: the first and last bar's times (Unix seconds) */
export interface ShadeRun {
  kind: ExtKind;
  from: number;
  to: number;
}
/** A world session over the bars inside its hours */
export interface SessionBox {
  key: WorldSessionKey;
  name: string;
  from: number;
  to: number;
  high: number;
  low: number;
}
export interface SessionMarks {
  shades: ShadeRun[];
  breaks: number[];
  boxes: SessionBox[];
}

const isExt = (k: string | undefined): k is ExtKind => k === 'pre' || k === 'post' || k === 'overnight';

/** The first index whose bar starts at or after `sec` */
function lowerBound(bars: readonly Candle[], sec: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sessionMarks(bars: readonly Candle[], o: { ext: boolean; breaks: boolean; boxes: readonly WorldSessionKey[] }): SessionMarks {
  const out: SessionMarks = { shades: [], breaks: [], boxes: [] };
  if (!bars.length) return out;
  if (o.ext || o.breaks) {
    let run: (ShadeRun & { win: number }) | null = null;
    let prevDay: string | null = null;
    for (const b of bars) {
      const ms = b.time * 1000;
      if (o.ext) {
        const w = windowAt(ms, 'equity');
        if (w && isExt(w.kind)) {
          if (run && run.kind === w.kind && run.win === w.from) run.to = b.time;
          else {
            if (run) out.shades.push({ kind: run.kind, from: run.from, to: run.to });
            run = { kind: w.kind, from: b.time, to: b.time, win: w.from };
          }
        } else if (run) {
          out.shades.push({ kind: run.kind, from: run.from, to: run.to });
          run = null;
        }
      }
      if (o.breaks) {
        const day = tradingDayOf(ms) ?? nyWall(ms).iso;
        if (prevDay !== null && day !== prevDay) out.breaks.push(b.time);
        prevDay = day;
      }
    }
    if (run) out.shades.push({ kind: run.kind, from: run.from, to: run.to });
  }
  if (o.boxes.length) {
    const first = bars[0].time * 1000;
    const last = bars[bars.length - 1].time * 1000 + 1;
    for (const w of worldSessionsBetween(first, last, o.boxes)) {
      const a = lowerBound(bars, Math.ceil(w.from / 1000));
      const z = lowerBound(bars, Math.ceil(w.to / 1000));
      if (z <= a) continue;
      let high = -Infinity;
      let low = Infinity;
      for (let i = a; i < z; i++) {
        if (bars[i].high > high) high = bars[i].high;
        if (bars[i].low < low) low = bars[i].low;
      }
      out.boxes.push({ key: w.key, name: w.name, from: bars[a].time, to: bars[z - 1].time, high, low });
    }
  }
  return out;
}
