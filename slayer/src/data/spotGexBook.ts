/*
  Names as the books key them (a weekly index root is its index).
  The Theta-chain spot-gex book that lived here is gone: nothing on screen read it, and exposure comes from Unusual Whales.
*/

const SAME: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', NDXP: 'NDX', VIXW: 'VIX' };

/** The weekly root is the same index. One book, one name. */
export function sameName(ticker: string): string {
  const name = ticker.trim().toUpperCase();
  return SAME[name] ?? name;
}
