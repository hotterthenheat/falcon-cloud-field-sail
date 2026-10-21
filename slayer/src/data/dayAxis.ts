/*
==================================================
  SLAYER TERMINAL - THE DAY'S CLOCK (data/dayAxis.ts)

  Where the day box's two charts — the tape and the book through the
  day — start their clock. The session runs 09:30 to 16:00; a book whose
  first bar came later (the house book opened mid-afternoon, a page that
  had no history to backfill) drew three or four empty hours on the
  left of both charts (the dead-space scan, 2026-10-13: 60% of a
  2,700px chart empty before 13:16). The clock starts on the first bar's own
  minute (a quarter-hour floor still left a fifth of a short session's
  charts empty), so the two charts still share one axis, and on the
  open itself whenever the data reaches it.
==================================================
*/

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

/** The axis' last minute: the close — or the last bar's, when the tape runs past it (the house book after hours; the
    paying-user audit, 2026-10-13: its 16:11–22:40 bars were drawn in the last 9% of a 09:30–16:00 axis).
    LIVE, THE SESSION SO FAR (the owner, 2026-10-14, as a retail user at 10:47: four fifths of both charts were blank
    future): while the session runs the axis ends half an hour past the newest bar, on the next half hour, and never
    under two hours of day — so the morning's charts are full of the morning, and the axis grows with the day to the
    close. A replay and a closed session keep the whole day. */
export function dayAxisTo(lastTime: number | null | undefined, live = false, open: number = OPEN_MIN, close: number = CLOSE_MIN): number {
  if (lastTime == null || !Number.isFinite(lastTime) || lastTime <= 0) return close;
  const last = nyMinutes(lastTime * 1000);
  if (live && last < close) {
    const ahead = Math.max(last + 30, open + Math.min(120, Math.max(30, close - open)));
    return Math.min(close, Math.ceil(ahead / 30) * 30);
  }
  return Math.max(close, last + 1);
}

/** The marks under the axis: its start, the whole hours after it (the even ones on a narrow plot), its end — none
    near enough to the start or the end for their labels to print over each other */
export function dayHours(from: number, narrow: boolean, to: number = CLOSE_MIN): number[] {
  const gap = narrow ? 90 : 20;
  const out = [from];
  for (let t = Math.ceil(from / 60) * 60; t < to; t += 60) {
    if (t - from < gap || to - t < gap) continue;
    if (narrow && (t / 60) % 2 !== 0) continue;
    out.push(t);
  }
  out.push(to);
  return out;
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
