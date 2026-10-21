/*
==================================================
  SLAYER TERMINAL - A READ-OUT BESIDE ITS POINT
  (components/gex/besideDot.ts)

  The day box's two plots (the tape, the book through the day) said the
  pointer's minute in a card pinned to a top corner — the eye went to the
  corner and back for every minute read (the paying-user audit's M14,
  2026-10-13). The card stands at the point now: right of it, or left of
  it past the plot's middle; above it, or under it where the plot's head
  has no room. Coordinates are the plot's own, the card's box absolute in
  the plot's frame.
==================================================
*/

import type { CSSProperties } from 'react';

/** How far the card stands off its point */
const GAP = 12;
/** Under this many pixels from the plot's top the card drops below its point */
const HEAD_ROOM = 44;

export const besideDot = (x: number, y: number, left: boolean): CSSProperties => ({
  left: left ? x - GAP : x + GAP,
  top: y,
  transform: `translate(${left ? '-100%' : '0'}, ${y < HEAD_ROOM ? `${GAP}px` : `calc(-100% - ${GAP}px)`})`,
});
