import type { CSSProperties } from 'react';

/*
==================================================
  SLAYER TERMINAL - THE DESK'S SHAPES (terrain/layoutShapes.ts)

  How the panes stand on the desk. A layout used to be a COUNT, 1 to 4, and the grid decided the rest; now it is a
  count and, for each count, the arrangements it can take (ported from the partner tree's layout door, 2026-10-31):
  counts 1 · 2 · 3 · 4 · 6. SIX IS THE CEILING, not eight: a pane is a live book, a tape and a rail, and every new name
  on the desk is its own set of reads — six is what the request budget carries (two panes on one name still share one
  read: the stores are keyed by symbol, not by pane).

  The count stays the desk's `layout` (every count-based rule — the keys, the rail's rest width, the active pane's
  clamp — reads it); the shape is a second field beside it, and the two always agree (countOf(shape) === layout).

  A shape is a CSS grid: columns, rows and the template areas, each pane named a..f by its index. Below `xl` (and on a
  phone) the panes stack in one column whatever the shape, as they always did.

  THE SYNC — Symbol (every chart takes the name picked on one), Interval (the timeframe too), Crosshair (the moment
  under the pointer marked on every chart; ON by rest, as it has always been here), Time (the visible window).
==================================================
*/

export type LayoutShape = '1' | '2h' | '2v' | '3B' | '3h' | '3L' | '3T' | '3v' | '4g' | '4h' | '4L' | '4T' | '6g' | '6v';

export interface ShapeSpec {
  /** how many panes stand */
  n: number;
  cols: number;
  rows: number;
  /** one string a row, the pane letters a..f; a letter spanning cells spans the pane */
  areas: readonly string[];
  /** the words on the glyph's hover */
  word: string;
}

export const AREA_NAMES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export const MAX_PANES = 6;
export const LAYOUT_COUNTS = [1, 2, 3, 4, 6] as const;

export const SHAPES: Record<LayoutShape, ShapeSpec> = {
  '1': { n: 1, cols: 1, rows: 1, areas: ['a'], word: 'one chart' },
  '2h': { n: 2, cols: 2, rows: 1, areas: ['a b'], word: 'two, side by side' },
  '2v': { n: 2, cols: 1, rows: 2, areas: ['a', 'b'], word: 'two, stacked' },
  '3B': { n: 3, cols: 2, rows: 2, areas: ['a b', 'c c'], word: 'two on top, one wide below' },
  '3h': { n: 3, cols: 3, rows: 1, areas: ['a b c'], word: 'three across' },
  '3L': { n: 3, cols: 2, rows: 2, areas: ['a b', 'a c'], word: 'one tall at the left, two stacked' },
  '3T': { n: 3, cols: 2, rows: 2, areas: ['a a', 'b c'], word: 'one wide on top, two below' },
  '3v': { n: 3, cols: 1, rows: 3, areas: ['a', 'b', 'c'], word: 'three, stacked' },
  '4g': { n: 4, cols: 2, rows: 2, areas: ['a b', 'c d'], word: 'four in a square' },
  '4h': { n: 4, cols: 4, rows: 1, areas: ['a b c d'], word: 'four across' },
  '4L': { n: 4, cols: 2, rows: 3, areas: ['a b', 'a c', 'a d'], word: 'one tall at the left, three stacked' },
  '4T': { n: 4, cols: 3, rows: 2, areas: ['a a a', 'b c d'], word: 'one wide on top, three below' },
  '6g': { n: 6, cols: 3, rows: 2, areas: ['a b c', 'd e f'], word: 'six, three by two' },
  '6v': { n: 6, cols: 2, rows: 3, areas: ['a b', 'c d', 'e f'], word: 'six, two by three' },
};

export const SHAPE_KEYS = Object.keys(SHAPES) as LayoutShape[];
export const isShape = (v: unknown): v is LayoutShape => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, v);
export const isLayoutCount = (n: unknown): n is (typeof LAYOUT_COUNTS)[number] => typeof n === 'number' && (LAYOUT_COUNTS as readonly number[]).includes(n);

/** The shapes a count can take, in the menu's order */
export const shapesOf = (n: number): LayoutShape[] => SHAPE_KEYS.filter(k => SHAPES[k].n === n);

/** The shape a count takes by rest — the first of its row: 3 is two on top and one wide below (the desk as it stood
    at a laptop's width — three across is a press away), 4 the square, as it always stood */
export const shapeByRest = (n: number): LayoutShape => shapesOf(n)[0] ?? '1';

/** The count a shape stands */
export const countOf = (shape: LayoutShape): number => SHAPES[shape].n;

/** The shape after this one in its count's row — a number key pressed again walks the row */
export const nextShapeOf = (shape: LayoutShape): LayoutShape => {
  const row = shapesOf(countOf(shape));
  return row[(row.indexOf(shape) + 1) % row.length] ?? shape;
};

/** The grid the shape draws, as inline style; `stacked` is the one column below xl and on a phone */
export const gridStyleOf = (shape: LayoutShape, stacked: boolean): CSSProperties =>
  stacked
    ? { gridTemplateColumns: 'minmax(0, 1fr)' }
    : {
        gridTemplateColumns: `repeat(${SHAPES[shape].cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${SHAPES[shape].rows}, minmax(0, 1fr))`,
        gridTemplateAreas: SHAPES[shape].areas.map(r => `"${r}"`).join(' '),
      };

/** The cells a glyph draws — one box a pane, in grid units, in pane order */
export const glyphCells = (shape: LayoutShape): { x: number; y: number; w: number; h: number }[] => {
  const { areas } = SHAPES[shape];
  const seen = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  areas.forEach((row, y) =>
    row.split(' ').forEach((name, x) => {
      const got = seen.get(name);
      if (!got) seen.set(name, { x0: x, y0: y, x1: x, y1: y });
      else {
        got.x1 = Math.max(got.x1, x);
        got.y1 = Math.max(got.y1, y);
      }
    })
  );
  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, c]) => ({ x: c.x0, y: c.y0, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 }));
};

/** How many columns the pane at `i` spans in the shape — the widest pane on a row owns the room the rail rest asks for */
export const paneColsOf = (shape: LayoutShape, i: number): number => glyphCells(shape)[i]?.w ?? 1;

export interface SyncCfg {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  time: boolean;
}
export const SYNC_BY_REST: SyncCfg = { symbol: false, interval: false, crosshair: true, time: false };
export const readSync = (raw: unknown): SyncCfg => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    symbol: r.symbol === true,
    interval: r.interval === true,
    crosshair: r.crosshair !== false,
    time: r.time === true,
  };
};
