/* The levels a Terrain pane plots: the house's (data/levelsFor.ts) for the pane's name and cut, and nothing else. Before
   the house has a reading there is no wall, flip or supreme to draw; the pane's own rows never stand in. */

import type { TickerLevels } from '../../data/levelsFor';

export interface PaneLevels {
  spot: number;
  callWall: number;
  putWall: number;
  flip: number;
  supreme: number;
  /** The vendor's max pain for the levels' expiry, when read */
  maxPain?: number;
  /** Each wall's and the supreme's |net GEX| against `top`, the largest strike's on the levels' contracts */
  shares?: { callWall?: number; putWall?: number; supreme?: number };
}

export function paneLevels(spot: number | null, house: TickerLevels | null, extra: { top?: number; maxPain?: number | null } = {}): PaneLevels {
  const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? Number.NaN : v);
  const top = extra.top ?? 0;
  const share = (k: number | null | undefined) => {
    const v = k == null || !house ? null : house.netAt(k);
    return v == null || !(top > 0) ? undefined : Math.min(1, Math.abs(v) / top);
  };
  /* a reading whose walls are another book's (the whole book standing in for "Today" before its date lands) draws no
     wall and no supreme — the stand-in's walls are not the day's (SPY: the whole book's 800 against the day's 770) */
  const walls = !!house?.wallsFinal;
  return {
    spot: n(spot),
    callWall: walls ? n(house?.callWall) : Number.NaN,
    putWall: walls ? n(house?.putWall) : Number.NaN,
    flip: n(house?.flip),
    supreme: walls ? n(house?.supreme) : Number.NaN,
    ...(extra.maxPain != null && extra.maxPain > 0 ? { maxPain: extra.maxPain } : {}),
    ...(house && walls && top > 0 ? { shares: { callWall: share(house.callWall), putWall: share(house.putWall), supreme: share(house.supreme) } } : {}),
  };
}
