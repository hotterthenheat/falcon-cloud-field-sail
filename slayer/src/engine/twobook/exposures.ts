/* Exposures, the UW conversions, the time unit and hedge demand (TWO_BOOK_SPEC_V2 §3.4, §3.5, §4.4, §4.5, §5).

   One unit system for both books (§4.4), Slayer sign: + GEX = modelled dealer long gamma. C is the signed dealer
   contract count (Model 1: +OI calls, −OI puts; Model 2: Σ dealer-signed print sizes), M the contract's multiplier, S
   the contract's own S (Model 1: the UW row price; Model 2: S_T = S*).
   `per` 'hour' divides CHARM, COLOR and VETA by 24 (§4.5); the board decides it once for all its contracts.

   The formula lines are spelled so scripts/twobook-mutation.mjs can inject the spec's Test 6 bugs; keep their text. */

import { D } from './contracts';
import type { Greeks } from './bsm';

export type TimeUnit = 'day' | 'hour';
export const EXPOSURE_NAMES = ['GEX', 'DEX', 'VEGA', 'VANNA', 'CHARM', 'VOMMA', 'COLOR', 'SPEED', 'VETA', 'ZOMMA'] as const;
export type ExposureName = (typeof EXPOSURE_NAMES)[number];
export type Exposures = Record<ExposureName, number>;

export const zeroExposures = (): Exposures => ({ GEX: 0, DEX: 0, VEGA: 0, VANNA: 0, CHARM: 0, VOMMA: 0, COLOR: 0, SPEED: 0, VETA: 0, ZOMMA: 0 });

/** §4.4 — the ten exposures of one contract line */
export function exposures(g: Greeks, C: number, M: number, S: number, per: TimeUnit = 'day'): Exposures {
  const u = per === 'hour' ? 24 : 1;
  return {
    GEX: g.gamma * C * M * S * S * 0.01,
    DEX: g.delta * C * M * S,
    VEGA: g.vega * C * M * 0.01,
    VANNA: g.vanna * C * M * S * 0.01,
    CHARM: (g.charm * C * M * S) / D / u,
    VOMMA: g.vomma * C * M * 0.0001,
    COLOR: (-g.colorT * C * M * S * S * 0.01) / D / u,
    SPEED: g.speed * C * M * S * S * S * 0.0001,
    VETA: (-g.vetaT * C * M * 0.01) / D / u,
    ZOMMA: g.zomma * C * M * S * S * 0.0001,
  };
}

/** §5: the complete first-order change of GEX for a +1% spot move (not SPEED alone) */
export const totalGexChange1pct = (g: Greeks, C: number, M: number, S: number): number => C * M * 0.0001 * (g.speed * S * S * S + 2 * g.gamma * S * S);

export interface Hedge {
  dealer_delta_units: number;
  hedge_units: number;
  dealer_dex: number;
  hedge_dollars: number;
  hedge_units_change_1pct: number;
}
/** §5 hedge demand for internal inventory C */
export function hedge(g: Greeks, C: number, M: number, S: number): Hedge {
  const units = g.delta * C * M;
  const dex = units * S;
  return { dealer_delta_units: units, hedge_units: -units, dealer_dex: dex, hedge_dollars: -dex, hedge_units_change_1pct: -g.gamma * C * M * 0.01 * S };
}

/** Hedge instruments (beta and tracking to the book's underlying assumed 1; recorded on the board) */
export const HEDGE_MULTIPLIER = { SPY: 1, ES: 50, MES: 5 } as const;
export const hedgeInInstrument = (hedgeDollars: number, instrumentPrice: number, instrument: keyof typeof HEDGE_MULTIPLIER): number => hedgeDollars / (instrumentPrice * HEDGE_MULTIPLIER[instrument]);

/** §4.5: per hour when any contract in the board has T < 1 calendar day, else per day */
export const boardTimeUnit = (Ts: Iterable<number>): TimeUnit => {
  for (const T of Ts) if (T * D < 1) return 'hour';
  return 'day';
};
/** §4.5: under an hour left on any contract the per-hour figure is an instantaneous rate, not a forecast */
export const boardIsRate = (Ts: Iterable<number>): boolean => {
  for (const T of Ts) if (T * D * 24 < 1) return true;
  return false;
};

/** UW's four `_oi` fields of one row (or a sum of rows), raw */
export interface UwFour {
  call_gamma_oi: number;
  put_gamma_oi: number;
  call_delta_oi: number;
  put_delta_oi: number;
  call_vanna_oi: number;
  put_vanna_oi: number;
  call_charm_oi: number;
  put_charm_oi: number;
}

/** §3.4 step 3 — the only transformations allowed: S the row `price`, iv30 the ticker IV of the same timestamp.
    DEX_UW_SIGN is UW's own put sign, an OBSERVED secondary value only. */
export function uwToSlayer(f: UwFour, S: number, iv30: number, per: TimeUnit = 'day'): { GEX: number; DEX: number; VANNA: number; CHARM: number; DEX_UW_SIGN: number } {
  const u = per === 'hour' ? 24 : 1;
  return {
    GEX: f.call_gamma_oi + f.put_gamma_oi,
    DEX: ((f.call_delta_oi - f.put_delta_oi) * 100) / S,
    VANNA: (f.call_vanna_oi + f.put_vanna_oi) / iv30,
    CHARM: ((f.call_charm_oi + f.put_charm_oi) * 100) / (365 * D) / u,
    DEX_UW_SIGN: ((f.call_delta_oi + f.put_delta_oi) * 100) / S,
  };
}
