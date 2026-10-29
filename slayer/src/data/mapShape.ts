/* What the Map says about the book, pure: rows (a strike, the drawn greek's net), a shape word per row (wall, cliff, shelf, void),
   folds (3+ voids, never across price), the cut (90th percentile of |net|, every bar reads against it) and one paragraph read. Words, not our digits. */

import { type Greek } from './exposureSurface';

export type Shape = 'wall' | 'cliff' | 'shelf' | 'void';
export type Role = 'call wall' | 'put wall' | 'supreme' | null;

export interface Legs {
  put: number;
  call: number;
  net: number;
}

export interface MapRow {
  strike: number;
  /** Per greek, the legs summed over the expiries drawn — signed dollars, the house sign */
  legs: Record<Greek, Legs>;
  /** The drawn greek's net */
  net: number;
  shape: Shape | null;
  role: Role;
  /** Above price (strikes at or over spot) */
  above: boolean;
}

export const SHAPE_WORD: Record<Shape, string> = { wall: 'Wall', cliff: 'Cliff', shelf: 'Shelf', void: 'Void' };
export const SHAPE_SAYS: Record<Shape, string> = {
  wall: 'The heaviest hedging around — a move tends to slow or turn here',
  cliff: 'Right past a wall, on the far side from price, the hedging drops away — a break through the wall meets little here',
  shelf: 'A run of strikes with steady, middling hedging — support in layers rather than one line',
  void: 'Next to nothing here — a move through these strikes meets no hedging',
};

/* the shape's thresholds, as shares of the heaviest |net| among the rows shown */
const WALL_AT = 0.5;
const CLIFF_DROP = 0.35;
const SHELF_LO = 0.2;
const SHELF_HI = 0.55;
const VOID_AT = 0.06;

/** The shape words, from the drawn greek's |net| against the rows shown (see the head) */
export function shapesOf(rows: MapRow[]): MapRow[] {
  const abs = rows.map(r => Math.abs(r.net));
  const max = Math.max(1e-9, ...abs);
  const share = abs.map(a => a / max);
  const shape: (Shape | null)[] = rows.map(() => null);
  /* walls: the book's named walls, and any local peak that carries half the heaviest */
  for (let i = 0; i < rows.length; i++) {
    const peak = share[i] >= WALL_AT && share[i] >= (share[i - 1] ?? 0) && share[i] >= (share[i + 1] ?? 0);
    if (peak || rows[i].role === 'call wall' || rows[i].role === 'put wall') shape[i] = 'wall';
  }
  /* cliffs: the strike right past a wall on the far side from price, where the hedging falls to a third or less */
  for (let i = 0; i < rows.length; i++) {
    if (shape[i] !== 'wall' || share[i] < SHELF_LO) continue;
    const j = rows[i].above ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length || shape[j] === 'wall') continue;
    if (share[j] <= share[i] * CLIFF_DROP) shape[j] = 'cliff';
  }
  /* voids */
  for (let i = 0; i < rows.length; i++) if (shape[i] == null && share[i] < VOID_AT) shape[i] = 'void';
  /* shelves: two or more in a row of steady, middling hedging on the same side */
  let i = 0;
  while (i < rows.length) {
    if (shape[i] != null || share[i] < SHELF_LO || share[i] > SHELF_HI) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < rows.length && shape[j + 1] == null && share[j + 1] >= SHELF_LO && share[j + 1] <= SHELF_HI && Math.sign(rows[j + 1].net) === Math.sign(rows[i].net)) j++;
    if (j > i) for (let k = i; k <= j; k++) shape[k] = 'shelf';
    i = j + 1;
  }
  return rows.map((r, k) => ({ ...r, shape: shape[k] }));
}

/** THE CUT — the heaviest ordinary strike: the 90th percentile of |net| among the rows shown (the heaviest itself under ten rows) */
export function cutOf(rows: readonly MapRow[]): number {
  const abs = rows.map(r => Math.abs(r.net)).sort((a, b) => a - b);
  if (!abs.length) return 1;
  const p90 = abs.length >= 10 ? abs[Math.floor(0.9 * (abs.length - 1))] : abs[abs.length - 1];
  return Math.max(1, p90 > 0 ? p90 : abs[abs.length - 1]);
}

