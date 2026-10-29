/* What is left of Compass's first engine: the setup address (a setup's page lives at /compass/<id>), the side
   Compass takes on the day's move, the tenor a DTE falls in, and the plain premium curve the what-if charts draw.
   The live calls come from compassModel; nothing here scores a contract. */

import type { OptionRight, ScannerKey, SleeveKey } from '../types/compass';

/** The what-if curve's floor */
const PREMIUM_FLOOR = 0.05;

/** A plain premium curve for what-if charts: intrinsic plus a normal-shaped time value of width iv·√t. It draws a
    scenario; a quote on screen is always the contract's own. */
export function estimatePremium(spot: number, strike: number, right: OptionRight, iv: number, tYears: number): number {
  const width = iv * Math.sqrt(Math.max(tYears, 0));
  const m = Math.log(strike / spot) / (width || 1e-6);
  const timeValue = spot * width * 0.4 * Math.exp(-(m * m) / 2);
  const intrinsic = right === 'C' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  return Math.max(PREMIUM_FLOOR, intrinsic + timeValue);
}

/** The tenor a bare DTE falls in */
export function sleeveForDte(dte: number): SleeveKey {
  return dte <= 0 ? 'odte' : dte <= 6 ? 'weekly' : dte <= 60 ? 'swing' : dte <= 180 ? 'position' : 'leaps';
}

/* A setup's id is its address: TICKER-strike-R-scanner-tenor, built and read back here. */
const ID_RE = /^([A-Z][A-Z0-9.]{0,6})-(\d+(?:\.\d+)?)-([CP])-(top-setups|quick-scalp|discounted|rebounds|breakouts|trend|vol-expansion|mean-reversion|whale-sweeps|overpriced|earnings|all)-(odte|weekly|swing|position|leaps)$/;

export interface SetupAddress {
  ticker: string;
  strike: number;
  right: OptionRight;
  scanner: ScannerKey;
  sleeve: SleeveKey;
}

export function setupIdOf(a: SetupAddress): string {
  const strikeLabel = a.strike % 1 === 0 ? a.strike.toFixed(0) : a.strike.toFixed(2);
  return `${a.ticker.toUpperCase()}-${strikeLabel}-${a.right}-${a.scanner}-${a.sleeve}`;
}

export function parseSetupId(id: string): SetupAddress | null {
  const m = id.match(ID_RE);
  if (!m) return null;
  return { ticker: m[1], strike: Number(m[2]), right: m[3] as OptionRight, scanner: m[4] as ScannerKey, sleeve: m[5] as SleeveKey };
}

/** The side Compass would take now: a call book flips to puts once the session is down 0.35%, a put book to calls
    once it is up 0.35%. An open trade leaves on that flip even if it is only up 20%. */
export function choiceRight(calls: boolean, spot: number, open: number): OptionRight {
  const base: OptionRight = calls ? 'C' : 'P';
  if (!(spot > 0) || !(open > 0)) return base;
  const ret = spot / open - 1;
  if (base === 'C' && ret <= -0.0035) return 'P';
  if (base === 'P' && ret >= 0.0035) return 'C';
  return base;
}
