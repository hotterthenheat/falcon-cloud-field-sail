/* Vanna and charm on the live book: they move the dealers' delta hedge, not the gamma walls, so the levels are the current
   ones, named by the pages' one rule (core/walls.ts pickLegWalls, flipLevel levelFlip). */

import { pickLegWalls } from '../core/walls';
import { levelFlip } from './flipLevel';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type { IvShift, LevelShift, MigrationRead, ShiftBarRow, ShiftMode, VannaCharmView } from '../types/gex';

interface LevelSet {
  callWall: number;
  putWall: number;
  flip: number;
  supreme: number;
}

/** The live book's levels: the same walls, supreme and flip the levels card prints. A level the book does not have is
    NaN ("—"), never the spot standing in — a spot-valued wall read "0.00% away" and a flip "at price". */
function liveLevels(snapshot: MarketSnapshot, chain: readonly StrikeNode[]): LevelSet {
  const w = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  const top = chain.reduce<StrikeNode | null>((b, n) => (n.netGex !== 0 && (!b || Math.abs(n.netGex) > Math.abs(b.netGex)) ? n : b), null);
  const flip = levelFlip(snapshot, chain).flip;
  return { callWall: w.callWall ?? Number.NaN, putWall: w.putWall ?? Number.NaN, flip: flip ?? Number.NaN, supreme: top?.strike ?? Number.NaN };
}

// ---- top-level assembly -----------------------------------------------------------
export function buildVannaCharm(
  snapshot: MarketSnapshot,
  mode: ShiftMode,
  ivShift: IvShift,
  half: 10 | 15 = 10
): VannaCharmView {
  const { ticker, spot, chain } = snapshot;

  const desc = [...chain].sort((a, b) => b.strike - a.strike);
  /* spot under every strike: the nearest are the lowest, at the bottom of the list */
  const below = desc.findIndex(n => n.strike <= spot);
  const spotIdx = below >= 0 ? below : Math.max(0, desc.length - 1);
  const start = Math.max(0, spotIdx - half);
  const window = desc.slice(start, start + half * 2 + 1);

  const charmOf = (n: StrikeNode) => n.netCharm;

  // Pin (max total OI) for the rail
  let pinStrike = window[0]?.strike ?? spot;
  let pinOI = 0;
  for (const n of window) {
    if (n.callOI + n.putOI > pinOI) {
      pinOI = n.callOI + n.putOI;
      pinStrike = n.strike;
    }
  }

  let maxAbs = 1;
  const rows: ShiftBarRow[] = window.map(n => {
    /* No migration model: vanna changes the delta hedge, charm is that hedge bleeding; neither relocates a gamma wall. */
    const projected = n.netGex;
    maxAbs = Math.max(maxAbs, Math.abs(n.netGex), Math.abs(projected));
    return { strike: n.strike, pin: n.strike === pinStrike, current: n.netGex, projected };
  });

  const base = liveLevels(snapshot, chain);
  const proj = base;

  const shifts: LevelShift[] = [
    { label: 'Call Wall', kind: 'call-wall', current: base.callWall, projected: proj.callWall },
    { label: 'Gamma Flip', kind: 'flip', current: base.flip, projected: proj.flip },
    { label: 'Put Wall', kind: 'put-wall', current: base.putWall, projected: proj.putWall },
    { label: 'Supreme Node', kind: 'supreme', current: base.supreme, projected: proj.supreme },
  ];

  // The read is measurements, not narrative: levels with distances, the charm concentration, the biggest move since the
  // last scan, and one line stating what the scenario computes.
  const fmt = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  const dist = (price: number) => (Number.isFinite(price) && spot > 0 ? Number((((price - spot) / spot) * 100).toFixed(2)) : Number.NaN);
  const lvl = (price: number) => ({ price, distPct: dist(price) });

  let charmStrike = window[0]?.strike ?? spot;
  let charmAbs = 0;
  for (const n of window) {
    const mag = Math.abs(charmOf(n));
    if (mag > charmAbs) {
      charmAbs = mag;
      charmStrike = n.strike;
    }
  }

  const delta: MigrationRead['delta'] = null;

  const line = 'Vanna and charm are the settled book. They do not move the gamma walls.';

  const read: MigrationRead = {
    flip: lvl(base.flip),
    callWall: lvl(base.callWall),
    putWall: lvl(base.putWall),
    charm: lvl(charmStrike),
    delta,
    line,
  };

  return {
    ticker,
    spot,
    mode,
    ivShift,
    rows,
    maxAbs,
    flipCurrent: base.flip,
    flipProjected: proj.flip,
    shifts,
    drift: [],
    read,
  };
}
