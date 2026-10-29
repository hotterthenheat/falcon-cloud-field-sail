/* Vanna and charm level shifts. On the live book they move the delta hedge, not the gamma walls, so the projected levels are the current ones
   named by the pages' rules (core/walls.ts pickLegWalls, flipLevel levelFlip). */

import { bookCandles, bookHistory } from './uwBook';
import { pickFlip, pickLegWalls } from '../core/walls';
import { levelFlip } from './flipLevel';
import type { MarketSnapshot, StrikeNode } from '../types/market';
import type {
  IvShift,
  LevelShift,
  MigrationRead,
  ShiftBarRow,
  ShiftMode,
  VannaCharmView,
  WallDriftPoint,
} from '../types/gex';

const HOURS_TO_CLOSE = 3; // fixed session posture for the sim

// ---- deterministic RNG ------------------------------------------------------
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function h01(seed: string): number {
  return (hash(seed) % 1000) / 1000;
}

interface LevelSet {
  callWall: number;
  putWall: number;
  flip: number;
  supreme: number;
}

/** Walls, flip and supreme off net rows (the simulator's projection): the most |net| above and below spot, the sign
    change nearest spot (core/walls.ts pickFlip — never the first crossing from the bottom), the most |net|. */
function levelsFrom(rows: { strike: number; value: number }[], spot: number): LevelSet {
  let callWall = spot;
  let putWall = spot;
  let supreme = spot;
  let maxAbove = 0;
  let maxBelow = 0;
  let maxAll = 0;
  for (const r of rows) {
    const mag = Math.abs(r.value);
    if (r.strike > spot && mag > maxAbove) {
      maxAbove = mag;
      callWall = r.strike;
    }
    if (r.strike < spot && mag > maxBelow) {
      maxBelow = mag;
      putWall = r.strike;
    }
    if (mag > maxAll) {
      maxAll = mag;
      supreme = r.strike;
    }
  }
  return { callWall, putWall, flip: pickFlip(rows, spot, r => r.value) ?? spot, supreme };
}

/** The live book's levels: the same walls, supreme and flip the levels card prints. */
function liveLevels(snapshot: MarketSnapshot, chain: readonly StrikeNode[]): LevelSet {
  const w = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  const supreme = chain.reduce((b, n) => (Math.abs(n.netGex) > Math.abs(b.netGex) ? n : b), chain[0])?.strike ?? snapshot.spot;
  const flip = levelFlip(snapshot, chain).flip;
  return { callWall: w.callWall ?? snapshot.spot, putWall: w.putWall ?? snapshot.spot, flip: flip ?? snapshot.spot, supreme };
}

// ---- scenario projection -------------------------------------------------------
function projectStrike(n: StrikeNode, mode: ShiftMode, ivShift: IvShift, maxCharm: number, spot: number, ticker: string): number {
  if (mode === 'CHARM') {
    // Charm bleeds gamma hardest at the money and at different rates per leg; that differential lets the net flip sign and walls migrate.
    const norm = Math.abs(n.charm) / (maxCharm || 1);
    const t = HOURS_TO_CLOSE / 6.5;
    const jc = h01(`${ticker}-${n.strike}-charm-c`);
    const jp = h01(`${ticker}-${n.strike}-charm-p`);
    const callDecay = 1 - (0.42 + 0.4 * jc) * norm * t;
    const putDecay = 1 - (0.42 + 0.4 * jp) * norm * t;
    return n.callGex * callDecay + n.putGex * putDecay;
  }
  // VANNA: an IV move re-prices dealer deltas; vanna is signed per strike so
  // the profile tilts rather than scales — jitter keeps the tilt uneven enough
  // to re-rank walls under a real vol shock.
  const oiNotional = (n.callOI + n.putOI) * spot;
  const j = 0.6 + h01(`${ticker}-${n.strike}-vanna`) * 0.7;
  return n.netGex + n.vanna * oiNotional * 0.8 * j * ivShift;
}

// ---- wall drift timeline ---------------------------------------------------------
const DRIFT_BARS = 390; // one session of 1-min bars
const DRIFT_STEP = 3; // sample every 3rd bar

function buildDrift(ticker: string): WallDriftPoint[] {
  const candles = bookCandles(ticker);
  const snaps = bookHistory(ticker);
  if (!candles?.length || !snaps?.length) return [];

  const n = Math.min(DRIFT_BARS, snaps.length, candles.length);
  const candleTail = candles.slice(candles.length - n);
  const snapTail = snaps.slice(snaps.length - n);

  const out: WallDriftPoint[] = [];
  for (let i = 0; i < n; i += DRIFT_STEP) {
    const spot = candleTail[i].close;
    const { callWall, putWall, flip } = levelsFrom(snapTail[i].levels, spot);
    out.push({ time: snapTail[i].time, spot, callWall, putWall, flip });
  }
  return out;
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
  const spotIdx = Math.max(0, desc.findIndex(n => n.strike <= spot));
  const start = Math.max(0, spotIdx - half);
  const window = desc.slice(start, start + half * 2 + 1);

  const live = snapshot.liveBook === true;
  const charmOf = (n: StrikeNode) => (live ? n.netCharm : n.charm);
  const maxCharm = window.reduce((a, n) => Math.max(a, Math.abs(charmOf(n))), 0);

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
    /* A live book has no migration model. Vanna changes the delta hedge; charm is that hedge bleeding.
       Neither one relocates a gamma wall, and a hash must not pretend it did. */
    const projected = live ? n.netGex : projectStrike(n, mode, ivShift, maxCharm, spot, ticker);
    maxAbs = Math.max(maxAbs, Math.abs(n.netGex), Math.abs(projected));
    return { strike: n.strike, pin: n.strike === pinStrike, current: n.netGex, projected };
  });

  const base = live ? liveLevels(snapshot, chain) : levelsFrom(rows.map(r => ({ strike: r.strike, value: r.current })), spot);
  const proj = live ? base : levelsFrom(rows.map(r => ({ strike: r.strike, value: r.projected })), spot);

  const shifts: LevelShift[] = [
    { label: 'Call Wall', kind: 'call-wall', current: base.callWall, projected: proj.callWall },
    { label: 'Gamma Flip', kind: 'flip', current: base.flip, projected: proj.flip },
    { label: 'Put Wall', kind: 'put-wall', current: base.putWall, projected: proj.putWall },
    { label: 'Supreme Node', kind: 'supreme', current: base.supreme, projected: proj.supreme },
  ];

  // The read is measurements, not narrative: levels with distances, the charm concentration, the biggest move since the
  // last scan, and one line stating what the scenario computes.
  const fmt = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  const dist = (price: number) => Number((((price - spot) / spot) * 100).toFixed(2));
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

  let delta: MigrationRead['delta'] = null;
  if (!live) {
    const snaps = bookHistory(ticker);
    if (snaps && snaps.length >= 2) {
      const nowSnap = snaps[snaps.length - 1];
      const prevSnap = snaps[Math.max(0, snaps.length - 1 - 10)];
      const prevMap = new Map(prevSnap.levels.map(l => [l.strike, l.value]));
      const inWindow = new Set(window.map(n => n.strike));
      let best: { strike: number; changeUsd: number } | null = null;
      for (const l of nowSnap.levels) {
        if (!inWindow.has(l.strike)) continue;
        const prev = prevMap.get(l.strike);
        if (prev === undefined) continue;
        const change = l.value - prev;
        if (!best || Math.abs(change) > Math.abs(best.changeUsd)) best = { strike: l.strike, changeUsd: change };
      }
      if (best) delta = { ...best, distPct: dist(best.strike) };
    }
  }

  const moved = shifts.filter(sh => sh.projected !== sh.current);
  const line = live
    ? 'Vanna and charm are the open-interest book. They do not move the gamma walls.'
    : moved.length === 0
      ? `This scenario leaves all ${shifts.length} levels in place.`
      : (() => {
          const biggest = moved.reduce((a, b) =>
            Math.abs(b.projected - b.current) > Math.abs(a.projected - a.current) ? b : a
          );
          return `This scenario moves ${moved.length} of ${shifts.length} levels; largest: ${biggest.label.toLowerCase()} ${fmt(
            biggest.current
          )} → ${fmt(biggest.projected)}.`;
        })();

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
    drift: live ? [] : buildDrift(ticker),
    read,
  };
}
