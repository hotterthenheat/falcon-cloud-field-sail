/* The contract-spec table and the clock of the two-book engine (TWO_BOOK_SPEC_V2 §1.1, §1.5, §2).

   Every contract is keyed by (root, expiration, strike, right). The ROOT, never the ticker, decides:
   - settlement: PM roots run to 16:00 ET on the expiration date; AM roots (SPX, NDX, RUT standard monthlies; VIX) to
     09:30 ET on it (the opening settlement, Cboe/Nasdaq contract specifications);
   - the multiplier M (never a hard-coded 100): $100 per index point on SPX/SPXW/NDX/NDXP/RUT/RUTW/XSP/VIX, 100 shares on
     a standard equity or ETF option; an adjusted root (OCC's AAPL1, …) has no spec here and is UNAVAILABLE;
   - the exercise style (European for the cash-settled index roots: parity is exact; American otherwise: parity and the
     BSM Greeks are model approximations, recorded as such);
   - the minimum tick at a price (§1.5's "half a tick"): Cboe SPX/SPXW/XSP/NDX/RUT 0.05 below $3, 0.10 at or above; the
     penny-program ETFs (SPY, QQQ, IWM) 0.01 at any price; other penny-program names 0.01 below $3, 0.05 above.
   Time: T = calendar minutes to the settlement instant / (365 × 1440), D = 365 (§1.1). Pure. */

import { nyInstant, nyWall } from '../../../shared/marketSession.mjs';
import { SESSION_CLOSE_MIN, SESSION_OPEN_MIN } from '../../core/nyTime';

export const D = 365;
export const MINUTES_PER_YEAR = D * 1440;

export type Settlement = 'AM' | 'PM';
export type Exercise = 'EUROPEAN' | 'AMERICAN';
export interface ContractSpec {
  root: string;
  /** The ticker whose book the root belongs to (SPXW → SPX) */
  underlying: string;
  settlement: Settlement;
  multiplier: number;
  exercise: Exercise;
  /** The minimum price increment at a premium */
  tick: (price: number) => number;
}

const cboeIndexTick = (p: number) => (p < 3 ? 0.05 : 0.1);
const pennyAll = () => 0.01;
const pennyPilot = (p: number) => (p < 3 ? 0.01 : 0.05);

const INDEX: Record<string, { underlying: string; settlement: Settlement }> = {
  SPX: { underlying: 'SPX', settlement: 'AM' },
  SPXW: { underlying: 'SPX', settlement: 'PM' },
  NDX: { underlying: 'NDX', settlement: 'AM' },
  NDXP: { underlying: 'NDX', settlement: 'PM' },
  RUT: { underlying: 'RUT', settlement: 'AM' },
  RUTW: { underlying: 'RUT', settlement: 'PM' },
  XSP: { underlying: 'XSP', settlement: 'PM' },
  VIX: { underlying: 'VIX', settlement: 'AM' },
  VIXW: { underlying: 'VIX', settlement: 'AM' },
};
/** ETFs whose whole chain trades in pennies */
const PENNY_ALL = new Set(['SPY', 'QQQ', 'IWM']);

/** The roots a ticker's book is made of: an index's AM root and its PM root (SPX = SPX + SPXW, §3.3); a stock or ETF
    its own symbol */
export function rootsOf(ticker: string): string[] {
  const t = ticker.toUpperCase().replace(/^\^/, '');
  const roots = Object.entries(INDEX)
    .filter(([, s]) => s.underlying === t)
    .map(([r]) => r);
  return roots.length ? roots : [t];
}

/** The spec of a root of `ticker`'s book; null for a root the table does not know (an adjusted series → UNAVAILABLE) */
export function contractSpec(root: string, ticker?: string): ContractSpec | null {
  const r = root.toUpperCase();
  const idx = INDEX[r];
  if (idx) {
    if (ticker && idx.underlying !== ticker.toUpperCase()) return null;
    return { root: r, underlying: idx.underlying, settlement: idx.settlement, multiplier: 100, exercise: 'EUROPEAN', tick: cboeIndexTick };
  }
  /* a stock or ETF option: its root is the ticker itself; anything with a digit after the ticker is an adjusted series */
  if (ticker && r !== ticker.toUpperCase()) return null;
  if (!/^[A-Z][A-Z.]{0,9}$/.test(r)) return null;
  return { root: r, underlying: r, settlement: 'PM', multiplier: 100, exercise: 'AMERICAN', tick: PENNY_ALL.has(r) ? pennyAll : pennyPilot };
}

/** The instant the engine's clock runs to: 16:00 ET (PM) or 09:30 ET (AM) on the expiration date */
export const settlementMs = (spec: Pick<ContractSpec, 'settlement'>, expiry: string): number => nyInstant(expiry, spec.settlement === 'AM' ? SESSION_OPEN_MIN : SESSION_CLOSE_MIN);

/** T in years from `nowMs` to the contract's settlement (≤ 0 once there: EXPIRED, §1.5) */
export const yearsTo = (spec: Pick<ContractSpec, 'settlement'>, expiry: string, nowMs: number): number => (settlementMs(spec, expiry) - nowMs) / 60_000 / MINUTES_PER_YEAR;

/** A contract's key, the one spelling every map uses */
export const contractKey = (root: string, expiry: string, strike: number, right: 'C' | 'P'): string => `${root}|${expiry}|${strike}|${right}`;

/** OCC symbol → (root, expiry, strike, right). The root is whatever stands in front of the 15-character tail. */
export function parseOccSymbol(symbol: string): { root: string; expiry: string; strike: number; right: 'C' | 'P' } | null {
  const s = symbol.trim().replace(/^O:/, '');
  const m = /^([A-Z0-9.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(s);
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, strike: Number(m[6]) / 1000, right: m[5] as 'C' | 'P' };
}

export type UwRowAction = 'INCLUDE' | 'DROP' | 'FLAG_AM';
/** §3.4 step 2 for one UW row (and the same population in §3.5): an expiration before the snapshot's New York date is
    dropped; today's expiration is dropped from 16:00 ET; on an AM-settlement day for that expiration (its SPX/NDX/RUT
    AM root settles that morning) the row is FLAG_AM from 09:30 ET until 16:00 — one flagged line outside the totals,
    since UW sums the AM and PM roots and they cannot be split. Dropped rows stay in raw storage for reconciliation. */
export function uwRowAction(snapshotMs: number, expiry: string, amSettlementDay: boolean): UwRowAction {
  const w = nyWall(snapshotMs);
  if (expiry < w.iso) return 'DROP';
  if (expiry === w.iso && w.min >= SESSION_CLOSE_MIN) return 'DROP';
  if (expiry === w.iso && amSettlementDay && w.min >= SESSION_OPEN_MIN) return 'FLAG_AM';
  return 'INCLUDE';
}
