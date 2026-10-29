/* The levels a Terrain pane plots: the house's (data/levelsFor.ts) for the pane's name and cut, and nothing else. Before
   the house has a reading there is no wall, flip or supreme to draw; the pane's own rows never stand in. */

import type { TickerLevels } from '../../data/levelsFor';

export interface PaneLevels {
  spot: number;
  callWall: number;
  putWall: number;
  flip: number;
  supreme: number;
}

export function paneLevels(spot: number | null, house: TickerLevels | null): PaneLevels {
  const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? Number.NaN : v);
  return {
    spot: n(spot),
    callWall: n(house?.callWall),
    putWall: n(house?.putWall),
    flip: n(house?.flip),
    supreme: n(house?.supreme),
  };
}
