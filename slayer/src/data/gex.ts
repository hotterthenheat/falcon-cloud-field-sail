/*
  Dealer-gamma helpers: money formatting, the heat pattern's read, a name's key levels and the book as an alert
  reads it, both from the live vendor book (uwBook).
*/

import { pickFlip, pickWalls } from '../core/walls';
import { bookHistory, ensureBook, peekChange, peekSpot } from './uwBook';
import type { GexSnapshot } from '../types/market';
import type { DarkPoolPrint, KeyLevels } from '../types/gex';

// ---- formatting -------------------------------------------------------------
export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  /* a figure that rounds to nothing is nothing — never "-$0" (the matrix's near-zero vannas, 2026-10-18) */
  const sign = v < 0 && a >= 0.5 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** fmtUsd with the true minus (U+2212) — Pinpoint's figures print "−$595.1M" everywhere, never a hyphen beside a minus
    (the fifth audit, 2026-10-23: the Map's "-$595.1M" beside the Agenda's "−$175M") */
export const fmtGexUsd = (v: number): string => {
  const s = fmtUsd(v);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};

/** Dark-pool prints come from the live tape. This used to hash a few blocks. It does not. */
export function buildPrints(_ticker: string, _spot: number): DarkPoolPrint[] {
  return [];
}

/** Key levels for ANY ticker, derived from its latest GEX snapshot — the same
    book the trails draw, so an expanded board chart agrees with its heatmap. */
export function buildLevelsFor(ticker: string): KeyLevels {
  const live = liveBookOf(ticker);
  if (!live) return { spot: NaN, callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN };
  const { spot, latest } = live;

  let supreme = spot;
  let supremeAbs = 0;
  let callWall = spot;
  let cwAbs = 0;
  let putWall = spot;
  let pwAbs = 0;
  for (const l of latest.levels) {
    const a = Math.abs(l.value);
    if (a > supremeAbs) {
      supremeAbs = a;
      supreme = l.strike;
    }
    if (l.strike > spot && a > cwAbs) {
      cwAbs = a;
      callWall = l.strike;
    }
    if (l.strike < spot && a > pwAbs) {
      pwAbs = a;
      putWall = l.strike;
    }
  }

  let flip = spot;
  let flipDist = Infinity;
  const sorted = [...latest.levels].sort((a, b) => a.strike - b.strike);
  for (let i = 1; i < sorted.length; i++) {
    if (Math.sign(sorted[i - 1].value) !== Math.sign(sorted[i].value)) {
      const mid = (sorted[i - 1].strike + sorted[i].strike) / 2;
      const d = Math.abs(mid - spot);
      if (d < flipDist) {
        flipDist = d;
        flip = mid;
      }
    }
  }

  return { spot, callWall, putWall, flip, supreme };
}

/** The live session change for a ticker, percent (0 until the vendor's read lands) */
export function spotChangePct(ticker: string): number {
  return peekChange(ticker) ?? 0;
}

/*
  ══ THE BOOK AS AN ALERT SEES IT ════════════════════════════════════════════

  `buildLevelsFor` is for the RAIL, and the rail's fallbacks are wrong for an
  alert: an unnamed wall parked at `spot` moves every tick, so an exposure
  alert reading it would fire on the fallback's motion, not the wall's. This
  reader keeps core/walls.ts's real nulls — "no call wall qualifies" is a
  state, and an alert waits on it.

  `readExposureNow` is pure over a handed-in chain so a proof can stage a
  book; `exposureNowFor` is the one-line wrapper over the simulator's latest
  snapshot. Null from the wrapper means the book is unreadable, which every
  alert also waits on. (Ported with the alert system, 2026-08-28.)
*/
export interface ExposureNow {
  /** Signed total of the chain's net GEX. */
  netGex: number;
  supreme: number | null;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  /** The chain's strike spacing — smallest gap actually present (the ladder's
      own rule); 0 when the chain is too thin to say. */
  step: number;
}

export function readExposureNow(
  chain: readonly { strike: number; value: number }[],
  spot: number
): ExposureNow {
  let netGex = 0;
  let supreme: number | null = null;
  let supremeAbs = 0;
  for (const l of chain) {
    netGex += l.value;
    const a = Math.abs(l.value);
    if (a > supremeAbs) {
      supremeAbs = a;
      supreme = l.strike;
    }
  }
  const w = pickWalls(chain, spot, l => l.value);
  const flip = pickFlip(chain, spot, l => l.value);
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].strike - sorted[i - 1].strike;
    if (d > 1e-9) step = Math.min(step, d);
  }
  return {
    netGex,
    supreme,
    callWall: w.callWall,
    putWall: w.putWall,
    flip,
    step: Number.isFinite(step) ? step : 0,
  };
}

export function exposureNowFor(ticker: string): ExposureNow | null {
  const live = liveBookOf(ticker);
  if (!live || live.latest.levels.length === 0) return null;
  return readExposureNow(live.latest.levels, live.spot);
}

/** The live vendor book's newest strike snapshot and spot for a name, or null until it lands */
function liveBookOf(ticker: string): { spot: number; latest: GexSnapshot } | null {
  const name = ticker.toUpperCase();
  ensureBook(name);
  const spot = peekSpot(name);
  const snaps = bookHistory(name);
  const latest = snaps?.[snaps.length - 1];
  return spot != null && spot > 0 && latest ? { spot, latest } : null;
}
