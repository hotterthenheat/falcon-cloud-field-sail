/* Where the day box's two charts start their clock: the first bar's own minute, or 09:30 when the data reaches the open,
   so a late-starting book draws no empty hours and both charts share one axis. */

import { nyMinutes } from '../core/nyTime';
import { CLOSE_MIN, OPEN_MIN } from './ahead';
import { sessionMeta, type DeskSession } from './deskSession';

/** The axis' first minute (New York minutes since midnight) for a session whose first bar is at `firstTime` (seconds). `open` is that session's start, 09:30 unless the head is on another window. */
export function dayAxisFrom(firstTime: number | null | undefined, open: number = OPEN_MIN): number {
  if (firstTime == null || !Number.isFinite(firstTime) || firstTime <= 0) return open;
  const first = nyMinutes(firstTime * 1000);
  /* near the session's start, the whole window; otherwise the first bar is where it starts */
  if (first <= open + 30) return open;
  return Math.max(open, first);
}

/** The axis' last minute: the close, or the last bar's when the tape runs past it. Live, it ends half an hour past the newest bar
    (on the half hour, at least two hours of day) and grows to the close; a replay or closed session keeps the whole day. */
export function dayAxisTo(lastTime: number | null | undefined, live = false, open: number = OPEN_MIN, close: number = CLOSE_MIN): number {
  if (lastTime == null || !Number.isFinite(lastTime) || lastTime <= 0) return close;
  const last = nyMinutes(lastTime * 1000);
  if (live && last < close) {
    const ahead = Math.max(last + 30, open + Math.min(120, Math.max(30, close - open)));
    return Math.min(close, Math.ceil(ahead / 30) * 30);
  }
  return Math.max(close, last + 1);
}

/** The clock both day charts share for the session the head is on. Overnight crosses midnight, so that window is measured from the first bar, not from midnight. */
export function axisForSession(bars: readonly { time: number }[], session: DeskSession, live: boolean): { from: number; to: number; dayStart: number } {
  const w = sessionMeta(session);
  if (!bars.length) return { from: w.wraps ? 0 : w.from, to: w.wraps ? 1 : w.to, dayStart: 0 };
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const firstMin = nyMinutes(first * 1000);
  const lastMin = nyMinutes(last * 1000);
  if (w.wraps || lastMin < firstMin) {
    return { from: 0, to: Math.max(1, Math.round((last - first) / 60)), dayStart: first };
  }
  const open = session === 'rth' ? OPEN_MIN : w.from;
  const close = session === 'rth' ? CLOSE_MIN : w.to;
  return { from: dayAxisFrom(first, open), to: dayAxisTo(last, live, open, close), dayStart: first - firstMin * 60 };
}
