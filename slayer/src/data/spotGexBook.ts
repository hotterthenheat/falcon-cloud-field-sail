/*
  Names as the books key them (a weekly index root is its index), and whether the page in view reads Unusual Whales alone.
  The Theta-chain spot-gex book that lived here is gone: nothing on screen read it, and exposure comes from Unusual Whales.
*/

import { thetaUseHere } from './theta';

const SAME: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', NDXP: 'NDX', VIXW: 'VIX' };

/** The page in view reads no ThetaData option data — greeks, open interest, chains (Trace, the Dossier, Pinpoint: data/theta.ts
    thetaUseHere is the one rule) — so exposure, levels and vols come from Unusual Whales alone. */
export function uwOnlyDesk(): boolean {
  return thetaUseHere() !== 'all';
}

/** The weekly root is the same index. One book, one name. */
export function sameName(ticker: string): string {
  const name = ticker.trim().toUpperCase();
  return SAME[name] ?? name;
}
