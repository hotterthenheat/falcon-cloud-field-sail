/* A read-out beside its point: right of it (left past the plot's middle), above it (under where the head has no room),
   in the plot's own coordinates. */

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
