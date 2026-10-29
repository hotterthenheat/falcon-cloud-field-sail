/* Geometry for a diverging histogram whose x axis is the strike (no lightweight-charts pane can carry that), kept pure so it can be proved. */

/** One bar, already in SVG user units with y measured DOWN from the top. */
interface BandBar {
  strike: number;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Above the zero rule. A zero value is NOT positive — it is neither. */
  positive: boolean;
}

/* A real value is never drawn as nothing: non-zero values get at least 1 px; a true zero draws nothing. */
const MIN_INK = 1;

/** One bar per row across `width`, diverging from a zero rule at mid height. `maxAbs` is the surface's scale, so two bands
    from one book compare; a non-positive or non-finite scale lays bars flat. */
/* Generic over the row so the accessor sees the caller's row type without a cast; only `strike` is read here. */
export function layoutBand<T extends { strike: number }>(
  rows: readonly T[],
  valueOf: (row: T, index: number) => number,
  maxAbs: number,
  width: number,
  height: number,
  gap = 2
): BandBar[] {
  const n = rows.length;
  if (n === 0 || !(width > 0) || !(height > 0)) return [];

  const slot = width / n;
  const w = Math.max(1, slot - gap);
  const mid = height / 2;
  const scale = Number.isFinite(maxAbs) && maxAbs > 0 ? maxAbs : 0;

  return rows.map((row, i) => {
    const raw = valueOf(row, i);
    const value = Number.isFinite(raw) ? raw : 0;
    let h = 0;
    if (scale > 0 && value !== 0) {
      /* Clamped: a value past the scale is drawn AT the edge rather than over
         it. A bar taller than its half would spill across the zero rule and
         read as belonging to the other side. */
      h = Math.min(mid, (Math.abs(value) / scale) * mid);
      if (h < MIN_INK) h = MIN_INK;
    }
    const positive = value > 0;
    return {
      strike: row.strike,
      value,
      x: i * slot + (slot - w) / 2,
      y: positive ? mid - h : mid,
      w,
      h,
      positive,
    };
  });
}

/** How many rows to skip between printed x labels; `minPx` is the narrowest gap before labels touch. */
export function labelStride(count: number, width: number, minPx: number): number {
  if (count <= 0 || !(width > 0) || !(minPx > 0)) return 1;
  const perLabel = width / count;
  if (perLabel >= minPx) return 1;
  return Math.max(1, Math.ceil(minPx / perLabel));
}

/** Where spot falls along the band: on the boundary between slots (spot is a price between strikes).
    `spotAfterIndex` is the profile's row index after which spot sits (−0.5 above every row); null with no rows. */
export function spotX(spotAfterIndex: number, count: number, width: number): number | null {
  if (count <= 0 || !(width > 0)) return null;
  if (!Number.isFinite(spotAfterIndex)) return null;
  const slot = width / count;
  /* +1 puts the rule on the trailing edge of the row it comes after. */
  const x = (spotAfterIndex + 1) * slot;
  if (x < 0 || x > width) return null;
  return x;
}

/** The gap that leaves each bar `barFraction` of its slot: proportional, so the band keeps its air at any width; at least 1 px. */
export function barGap(width: number, count: number, barFraction = 0.6): number {
  if (count <= 0 || !(width > 0)) return 1;
  const f = Number.isFinite(barFraction) ? Math.min(1, Math.max(0.05, barFraction)) : 0.6;
  return Math.max(1, (width / count) * (1 - f));
}

/** The profile's descending spot index mirrored into the ascending band: the boundary between rows k and k+1 descending
    is between n−2−k and n−1−k ascending. Off by one here silently moves the spot rule a strike. */
export function ascendingSpotIndex(spotAfterIndex: number, count: number): number {
  return count - 2 - spotAfterIndex;
}
