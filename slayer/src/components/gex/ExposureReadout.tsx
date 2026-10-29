/*
  Every figure for one cell — strike and expiry — the ledger on demand,
  plus the strike netted across every expiry drawn: the floating house
  card under the pointer. Nothing here is allowed to bleed: the calendar
  line wraps into its own row (the pointer card once overran its edge on
  "498 across 7 expiries").
*/

import { type Greek } from '../../data/exposureSurface';
import { BULL, LONG_GAMMA, PUT_WALL, SHORT_GAMMA } from './paletteInk';

/** The net's ink per greek — gamma speaks regime, delta speaks direction, vega, vanna and charm stay plain. */
export const netInk = (greek: Greek, v: number): string =>
  greek === 'gex' ? (v >= 0 ? SHORT_GAMMA : LONG_GAMMA) : greek === 'dex' ? (v >= 0 ? BULL : PUT_WALL) : '#EDEDED';

