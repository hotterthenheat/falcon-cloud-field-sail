/* Every figure for one cell (strike and expiry) plus the strike netted across every drawn expiry, under the pointer.
   The calendar line wraps to its own row so nothing overruns the card. */

import { type Greek } from '../../data/exposureSurface';
import { BULL, LONG_GAMMA, PUT_WALL, SHORT_GAMMA } from './paletteInk';

/** The net's ink per greek — gamma speaks regime, delta speaks direction, vega, vanna and charm stay plain. */
export const netInk = (greek: Greek, v: number): string =>
  greek === 'gex' ? (v >= 0 ? SHORT_GAMMA : LONG_GAMMA) : greek === 'dex' ? (v >= 0 ? BULL : PUT_WALL) : '#EDEDED';

