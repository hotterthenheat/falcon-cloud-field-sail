/* How StrikeChart's data pass lays the bars down: every bar again (setData) or the newest alone (update). */

/** May a data pass touch only the newest bar (series.update) instead of setting every bar again? Only when the bars are the
    ones drawn plus, at most, one newer bar at the right edge. A count is not enough: a session's tape landing late (an
    after-hours cleaned after the history filled the window) changed the drawn bars by exactly one, and the old "a jump
    of one is a new bar" rule updated the last bar and left NVDA's whole after-hours undrawn (live, 2026-11-01). In a
    held window (the recent 1000 of a longer store) a new bar slides the window: the same count, the edge one further.
    A rule clock reloads on any count change (it closes a bar and opens the next in one tick). Pure, for
    scripts/bar-pass-proof.ts. */
export function tailOnly(bars: readonly { time: number }[], prevCount: number, prevFirst: number, prevEdge: number, held: boolean, ruleClock: boolean): boolean {
  const n = bars.length;
  if (!n || !prevCount) return false;
  const last = bars[n - 1].time;
  /* the newest bar moved (a print), nothing else */
  if (last === prevEdge) return n === prevCount && bars[0].time === prevFirst;
  if (ruleClock) return false;
  /* one newer bar after the edge that was drawn */
  if (n < 2 || bars[n - 2].time !== prevEdge || last < prevEdge) return false;
  return (n === prevCount + 1 && bars[0].time === prevFirst) || (held && n === prevCount && bars[0].time > prevFirst);
}
