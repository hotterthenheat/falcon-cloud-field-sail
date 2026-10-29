/* One market, two prices: the ETF and the cash index it tracks, so a dealer book read in the ETF can be priced in
   the index. The ratio is measured, the index's real-time price over the ETF's (ThetaData), never a constant. Futures
   are not carried by either feed, so there is no futures lens. */

import { peekThetaPrice, useThetaPrices } from './thetaQuote';

export type TwinLensKey = 'etf' | 'index';

interface TwinFamily {
  etf: string;
  index: string;
}

const FAMILIES: Record<string, TwinFamily> = {
  SPY: { etf: 'SPY', index: 'SPX' },
  QQQ: { etf: 'QQQ', index: 'NDX' },
  IWM: { etf: 'IWM', index: 'RUT' },
};

export const twinFamilyFor = (ticker: string): TwinFamily | null => FAMILIES[ticker.toUpperCase()] ?? null;

/** Two readings this far apart are not one moment: no ratio from them */
const SAME_MOMENT_MS = 60_000;

/** The index's price over the ETF's, from two readings taken together, or null */
export function measuredRatio(fam: TwinFamily): number | null {
  const i = peekThetaPrice(fam.index)?.value;
  const e = peekThetaPrice(fam.etf)?.value;
  if (!i || !e || !(i.price > 0) || !(e.price > 0)) return null;
  if (Math.abs(i.read - e.read) > SAME_MOMENT_MS) return null;
  return i.price / e.price;
}

/** Keeps both prices of a family fresh while mounted; returns the ratio (null until both are in) */
export function useTwinRatio(fam: TwinFamily | null): number | null {
  useThetaPrices(fam ? [fam.etf, fam.index] : []);
  return fam ? measuredRatio(fam) : null;
}

/** A price in the chosen instrument's terms; NaN for the index lens until the ratio is measured */
export function twinPrice(lens: TwinLensKey, etfPrice: number, ratio: number | null): number {
  if (lens === 'etf') return etfPrice;
  return ratio != null && ratio > 0 ? etfPrice * ratio : NaN;
}

export const twinLabel = (fam: TwinFamily, lens: TwinLensKey): string => (lens === 'etf' ? fam.etf : fam.index);

/** Index prices print with thousands separators, no dollar sign. */
export const fmtTwin = (v: number): string => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
