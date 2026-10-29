/* One market, three prices: the ETF, the cash index (ETF × family ratio) and the futures (index + a carry basis), so a GEX surface
   can read in the instrument traded. Ratios are fixed and the basis is a deterministic fair-value estimate, no wall clock. */

export type TwinLensKey = 'etf' | 'index' | 'futures';

interface TwinFamily {
  etf: string;
  index: string;
  futures: string;
  /** Cash index ≈ ETF × ratio (fixed in sim; measured live later). */
  ratio: number;
  /** Typical carry premium of the futures over cash, in index points. */
  baseBasis: number;
}

const FAMILIES: Record<string, TwinFamily> = {
  SPY: { etf: 'SPY', index: 'SPX', futures: 'ES', ratio: 10, baseBasis: 12 },
  QQQ: { etf: 'QQQ', index: 'NDX', futures: 'NQ', ratio: 41, baseBasis: 45 },
  IWM: { etf: 'IWM', index: 'RUT', futures: 'RTY', ratio: 10, baseBasis: 6 },
};

export const twinFamilyFor = (ticker: string): TwinFamily | null => FAMILIES[ticker.toUpperCase()] ?? null;

// Tiny local hash — deterministic drift needs no import from gex.ts.
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Carry basis in index points — drifts deterministically with the tape
    (seeded off the rounded ETF spot, so replays reproduce it exactly). */
function twinBasis(fam: TwinFamily, etfSpot: number): number {
  const drift = (hash01(`${fam.futures}-basis-${Math.round(etfSpot)}`) * 2 - 1) * fam.baseBasis * 0.25;
  return Math.round((fam.baseBasis + drift) * 4) / 4;
}

/** A price in the chosen instrument's terms. Futures round to their
    quarter-point tick, the way the board actually prints them. */
export function twinPrice(fam: TwinFamily, lens: TwinLensKey, etfPrice: number, etfSpot: number): number {
  if (lens === 'etf') return etfPrice;
  const idx = etfPrice * fam.ratio;
  if (lens === 'index') return idx;
  return Math.round((idx + twinBasis(fam, etfSpot)) * 4) / 4;
}

export const twinLabel = (fam: TwinFamily, lens: TwinLensKey): string =>
  lens === 'etf' ? fam.etf : lens === 'index' ? fam.index : fam.futures;

/** Index/futures prices print with thousands separators, no dollar sign. */
export const fmtTwin = (v: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
