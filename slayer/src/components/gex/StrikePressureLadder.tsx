/*
==================================================
  SLAYER TERMINAL - STRIKE PRESSURE LADDER
  The heatmap's replacement (Mo, 2026-08-19: "I
  don't think we should keep a generic orange/gray
  heatmap just because every other options platform
  has one"). Every strike is a ROW; the put and call
  gamma at it are TICKS counted out from the centre
  line — one tick is a fixed sum, so $1.2B against
  $300M is counted, not estimated. Beside the rows:
  net, distance from spot, open interest, volume,
  and the part the strike plays. Spot and the flip
  run THROUGH the ladder as rules; walls, pin and
  supreme are named on their rows.

  THE SPINE (Noah, 2026-08-22): a contour drawn over
  the bars — at every row it leans toward the side
  that dominates, by that strike's net, and the rows
  join into one curve. It crosses centre at the flip
  and bulges hardest at the walls. A dashed ghost is
  the same curve at the session open; the gap between
  them, row by row, is the strike building or
  bleeding. The bars never move — they are anchored
  at centre so the legs stay comparable down the
  ladder (the first cut grew them from the bent spine
  and every row looked shoved sideways).
==================================================
*/

/** A smooth open spline through points (Catmull-Rom, rendered as cubic
    Béziers). One curve for the whole ladder — the per-row quadratics met at
    corners and doubled back wherever neighbours pulled opposite ways (Noah,
    2026-08-22: "the curve is glitching"). Control x is clamped to the lane. */
export const splinePath = (pts: { x: number; y: number }[], xMin: number, xMax: number): string => {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const cx = (v: number) => Math.max(xMin, Math.min(xMax, v));
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = cx(p1.x + (p2.x - p0.x) / 6);
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = cx(p2.x - (p3.x - p1.x) / 6);
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
};

