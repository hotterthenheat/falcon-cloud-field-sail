/* The levels a Terrain pane plots: the house's (data/levelsFor.ts) for the pane's name and cut, and nothing else. Before
   the house has a reading there is no wall, flip or supreme to draw; the pane's own rows never stand in. */

import { drawnLevels, type TickerLevels } from '../../data/levelsFor';

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
  /* The one gate (levelsFor drawnLevels). The walls and the supreme wait for the scope's own contracts: a stand-in
     book's walls are not the day's (SPY once read the whole book's 800 against the day's 770). The flip waits for its
     final pricing, as Pulse's chart and Pinpoint's tape do. */
  const d = drawnLevels(house);
  return {
    spot: n(spot),
    callWall: n(d.callWall),
    putWall: n(d.putWall),
    flip: n(d.flip),
    supreme: n(d.supreme),
    ...(extra.maxPain != null && extra.maxPain > 0 ? { maxPain: extra.maxPain } : {}),
    ...(house && d.wallsIn && top > 0 ? { shares: { callWall: share(d.callWall), putWall: share(d.putWall), supreme: share(d.supreme) } } : {}),
  };
}
