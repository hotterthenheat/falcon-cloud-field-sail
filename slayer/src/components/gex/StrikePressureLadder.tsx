/* The strike pressure ladder: a row per strike, put and call gamma as ticks counted out from the centre (one tick a fixed sum),
   with net, distance, OI, volume and role beside. The spine curve leans to each row's dominant side; its dashed ghost is the open's. */

/** A smooth open Catmull-Rom spline (as cubic Béziers), one curve for the whole ladder; control x is clamped to the lane. */
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

