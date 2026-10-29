/* Dealer-gamma helpers off the live vendor book (uwBook): money formatting, the heat pattern's read, a name's key levels, the book as an alert reads it. */

import { keptOf } from '../core/dealerSign';
import { bookOfLevels, peekChange, snapshotFor } from './uwBook';
import { levelsFor } from './levelsFor';
import { levelsForName } from './levelsScope';
import type { DarkPoolPrint, KeyLevels } from '../types/gex';

// ---- formatting -------------------------------------------------------------
export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  /* A figure that rounds to nothing is nothing, never "-$0". */
  const sign = v < 0 && a >= 0.5 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** fmtUsd with the true minus (U+2212), as Pinpoint prints everywhere. */
export const fmtGexUsd = (v: number): string => {
  const s = fmtUsd(v);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};

/** Dark-pool prints come from the live tape. This used to hash a few blocks. It does not. */
export function buildPrints(_ticker: string, _spot: number): DarkPoolPrint[] {
  return [];
}

/** A name's key levels: its Levels card's own (data/levelsFor.ts — one wall rule, one flip), NaN while the book loads. */
export function buildLevelsFor(ticker: string): KeyLevels {
  const lv = levelsFor(ticker, levelsForName(ticker));
  if (!lv) return { spot: NaN, callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN };
  return { spot: lv.spot, callWall: lv.callWall ?? NaN, putWall: lv.putWall ?? NaN, flip: lv.flip ?? NaN, supreme: lv.supreme };
}

/** The live session change for a ticker, percent (0 until the vendor's read lands) */
export function spotChangePct(ticker: string): number {
  return peekChange(ticker) ?? 0;
}

/* The book as an alert reads it: the Levels card's real nulls, not the rail's fallbacks (a wall parked at spot would move
   every tick). */
export interface ExposureNow {
  /** Net GEX of the Levels card's contracts, kept (house) sign */
  netGex: number;
  supreme: number | null;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  /** The chain's strike spacing — smallest gap actually present (the ladder's
      own rule); 0 when the chain is too thin to say. */
  step: number;
}

/** The book as an alert reads it. A live book's snapshot reads its name's Levels card (exposureNowFor); a chain made
    anywhere else carries only its net, so it names the supreme and no wall or flip. */
export function readExposureNow(chain: readonly { strike: number; value: number }[], spot: number): ExposureNow {
  const owner = bookOfLevels(chain);
  const live = owner ? exposureNowFor(owner) : null;
  if (live) return live;
  void spot;
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
  return { netGex, supreme, callWall: null, putWall: null, flip: null, step: stepOf(chain) };
}

/** The chain's strike spacing — the smallest gap present; 0 when the chain is too thin to say */
function stepOf(chain: readonly { strike: number }[]): number {
  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].strike - sorted[i - 1].strike;
    if (d > 1e-9) step = Math.min(step, d);
  }
  return Number.isFinite(step) ? step : 0;
}

/** A name's book as an alert reads it: its Levels card's net (house sign), supreme, walls and flip — null while loading */
export function exposureNowFor(ticker: string): ExposureNow | null {
  const lv = levelsFor(ticker, levelsForName(ticker));
  if (!lv) return null;
  const chain = snapshotFor(ticker, lv.scope)?.chain ?? [];
  return { netGex: keptOf(lv.netGex), supreme: lv.supreme, callWall: lv.callWall, putWall: lv.putWall, flip: lv.flip, step: stepOf(chain) };
}
