/* Three registers per column, measured over the rows on screen: the bulk in the primary ink, the top quintile loud
   (weight, or direction ink on signed facts), the single largest in magenta. */

export interface InkMarks {
  /** The loud bar — 80th percentile of |value| among nonzero rows on screen */
  bar: number;
  /** The supreme bar — the largest |value| on screen */
  top: number;
}

export function earnMarks<T>(rows: T[], get: (r: T) => number): InkMarks {
  const v = rows
    .map(r => Math.abs(get(r)))
    .filter(x => x > 0)
    .sort((a, b) => a - b);
  if (v.length === 0) return { bar: Infinity, top: Infinity };
  return { bar: v[Math.floor(v.length * 0.8)], top: v[v.length - 1] };
}

/** A magnitude's ink: intensity is weight, never a hue — except the champion. */
export const weightInk = (v: number, m: InkMarks): string =>
  Math.abs(v) >= m.top ? 'text-supreme font-bold' : Math.abs(v) >= m.bar ? 'font-bold text-textPrimary' : 'text-textPrimary';

/** A signed fact's ink: direction colour once loud, magenta for the champion. */
export const directionInk = (v: number, m: InkMarks): string =>
  Math.abs(v) >= m.top
    ? 'text-supreme font-bold'
    : Math.abs(v) >= m.bar
      ? v > 0
        ? 'text-bull dir-up'
        : 'text-bear dir-down'
      : 'text-textPrimary';
