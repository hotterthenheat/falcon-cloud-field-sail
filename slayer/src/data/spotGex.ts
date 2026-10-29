/* Spot gamma as Unusual Whales states it: Σ OI × gamma × price², puts negated; with session volume it is the _vol figure.
   Dollars of gamma for a 1% move off the chain's per-share gamma; contracts without OI or gamma are skipped. */

import { pickFlip, pickLegWalls } from '../core/walls';

export type OptionSide = 'C' | 'P';

export interface SpotGexLeg {
  strike: number;
  right: OptionSide;
  /** Absent when the chain did not print it. Zero is a real print. */
  oi?: number | null;
  gamma?: number | null;
  volume?: number | null;
}

export interface SpotGexStrike {
  strike: number;
  /** Call contribution minus put contribution, open interest. */
  netOi: number;
  netVol: number;
  callOi: number;
  putOi: number;
}

export interface SpotGex {
  price: number;
  priceKind: 'spot' | 'atm';
  /** Whole-book open-interest gamma, dollars per 1% move. */
  netOi: number;
  netVol: number;
  /** netOi / 1e9. Compass feature 27, in billions of dollars. This is the UW sum, not the older spec's extra 0.01. */
  netGexBn: number;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  strikes: SpotGexStrike[];
  used: number;
  skipped: number;
}

/** Underlyings whose spot-gex price is the at-the-money strike, not the index print. */
const INDEX_PRICE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP', 'DJX', 'XND', 'OEX', 'XEO', 'MRUT']);

export function usesAtmPrice(ticker: string): boolean {
  return INDEX_PRICE.has(ticker.toUpperCase());
}

function finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @param spot live underlying. Indexes still need it to choose the ATM strike.
 *             Pass 0 only when the chain itself has no price — the book is then empty.
 */
export function spotGex(ticker: string, spot: number, legs: readonly SpotGexLeg[]): SpotGex {
  const strikes = new Map<number, SpotGexStrike>();
  let used = 0;
  let skipped = 0;
  let volUsed = 0;
  const index = usesAtmPrice(ticker);
  let atm = 0;
  let atmDist = Infinity;
  if (index && spot > 0) {
    for (const leg of legs) {
      if (!(leg.strike > 0)) continue;
      const d = Math.abs(leg.strike - spot);
      if (d < atmDist) {
        atmDist = d;
        atm = leg.strike;
      }
    }
  }
  const price = index ? atm : spot;
  const empty: SpotGex = {
    price, priceKind: index ? 'atm' : 'spot', netOi: 0, netVol: 0, netGexBn: Number.NaN,
    callWall: null, putWall: null, flip: null, strikes: [], used: 0, skipped: legs.length,
  };
  if (!(price > 0)) return empty;
  const px2 = price * price;
  for (const leg of legs) {
    const oi = finite(leg.oi);
    const gamma = finite(leg.gamma);
    if (oi == null || gamma == null || !(leg.strike > 0)) {
      skipped += 1;
      continue;
    }
    used += 1;
    const row = strikes.get(leg.strike) ?? { strike: leg.strike, netOi: 0, netVol: 0, callOi: 0, putOi: 0 };
    const signed = (leg.right === 'P' ? -1 : 1) * oi * gamma * px2;
    row.netOi += signed;
    if (leg.right === 'P') row.putOi += oi * gamma * px2;
    else row.callOi += oi * gamma * px2;
    const vol = finite(leg.volume);
    if (vol != null) {
      row.netVol += (leg.right === 'P' ? -1 : 1) * vol * gamma * px2;
      volUsed += 1;
    }
    strikes.set(leg.strike, row);
  }
  const rows = [...strikes.values()];
  let netOi = 0;
  let netVol = 0;
  for (const row of rows) {
    netOi += row.netOi;
    netVol += row.netVol;
  }
  const walls = pickLegWalls(rows, r => r.callOi, r => r.putOi);
  const flip = pickFlip(rows.filter(r => r.netOi !== 0), spot > 0 ? spot : price, r => r.netOi);
  return {
    price,
    priceKind: index ? 'atm' : 'spot',
    netOi,
    netVol: volUsed > 0 ? netVol : Number.NaN,
    netGexBn: used > 0 ? netOi / 1e9 : Number.NaN,
    callWall: walls.callWall,
    putWall: walls.putWall,
    flip,
    strikes: rows.sort((a, b) => a.strike - b.strike),
    used,
    skipped,
  };
}
