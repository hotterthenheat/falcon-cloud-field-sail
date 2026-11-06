/* WHICH CONTRACTS OF A NAME THE BOOK COUNTS, AND WHEN EACH STOPS (audit 2026-11-06).

   One name's option-contracts answer mixes OCC roots, and the root says how the contract settles:
   - PM, the book's own clock: the name itself (SPY, AAPL) and an index's weekly root (SPXW, NDXP, RUTW) — trading to
     16:00 ET (13:00 on an early close) on the date in the symbol.
   - AM, at the open: an index's standard monthly root (SPX, NDX, RUT; DJX; every VIX root). Its last trade is the
     session BEFORE the date in the symbol; it settles at 09:30 ET on that date off the opening prints. Until then it is
     priced to 09:30 of that date (on the trading clock, the previous session's close); from 09:30 it is gone. The
     vendor's spot-exposure rows still carry it after the open (SPX 2026-10-16 at 16:15: the open interest at all 52
     strikes with AM contracts was the AM + PM total, ThetaData's own SPX and SPXW reports of that morning).
   - ADJUSTED, never counted: any other root — OCC's adjusted series after a split, a special dividend or a merger
     (AAPL1, AAPL2: a deliverable that is not 100 shares of the name) and anything else the name does not list. Its
     price is not 100 shares' option, so neither its open interest at ×100 nor its quote's vol is the name's.

   Pure: no fetch, no state. */

import { sessionBefore, isoDate } from './calendar';
import { nyInstant } from './session';
import { nyIsoDate, nyMinutes, SESSION_LENGTH_MIN, SESSION_OPEN_MIN } from './nyTime';
import { tradingMinutes, TRADING_DAYS } from './tradingYear';
import { usableMid } from './volClock';
import { impliedVolFromPrice } from './greeks';

export type Settle = 'PM' | 'AM' | 'ADJUSTED';

/** An index's roots: the AM monthly root and the PM weekly root(s) */
const INDEX_ROOTS: Record<string, { am: readonly string[]; pm: readonly string[] }> = {
  SPX: { am: ['SPX'], pm: ['SPXW'] },
  NDX: { am: ['NDX'], pm: ['NDXP'] },
  RUT: { am: ['RUT'], pm: ['RUTW'] },
  DJX: { am: ['DJX'], pm: [] },
  /* VIX and its weeklies both settle off the Wednesday morning's special opening quotation */
  VIX: { am: ['VIX', 'VIXW'], pm: [] },
};
/** The names a weekly root is read under (the book's ticker for SPXW is SPX) */
const INDEX_OF: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', VIXW: 'VIX' };

/** The OCC root of a symbol: whatever sits in front of the 15-character tail (YYMMDD + C/P + strike × 1000) */
export function occRoot(symbol: string): string {
  return symbol.length > 15 ? symbol.slice(0, -15).trim().toUpperCase() : '';
}

/** How a contract of `ticker` with this OCC root settles. A name whose ticker carries a class dot (BRK.B) lists it bare. */
export function settleOf(ticker: string, root: string): Settle {
  const t = ticker.trim().toUpperCase();
  const name = INDEX_OF[t] ?? t;
  const r = root.trim().toUpperCase();
  const idx = INDEX_ROOTS[name];
  if (idx) {
    if (idx.am.includes(r)) return 'AM';
    if (idx.pm.includes(r)) return 'PM';
    return 'ADJUSTED';
  }
  if (r === name || r === name.replace(/[.\-/]/g, '')) return 'PM';
  return 'ADJUSTED';
}

/** The instant an AM contract dated `expiry` settles: 09:30 ET that day */
export const amSettleAt = (expiry: string): number => nyInstant(expiry, SESSION_OPEN_MIN);

/** True from 09:30 ET on its date: an AM contract is settled and holds nothing */
export const amGone = (expiry: string, nowMs: number): boolean => nowMs >= amSettleAt(expiry);

/** The session an AM contract last trades: the one before its date */
export function amLastSession(expiry: string): string {
  const [y, m, d] = expiry.split('-').map(Number);
  return isoDate(sessionBefore(new Date(y, m - 1, d)));
}

const FLOOR_MIN = 5;
/** Trading years left on an AM contract: to its last session's close (on the trading clock 09:30 of its date is that
    close), five trading minutes at the least until it settles; null once settled */
export function amTradingYears(expiry: string, nowMs: number): number | null {
  if (amGone(expiry, nowMs)) return null;
  const left = tradingMinutes(amLastSession(expiry), nowMs, true) ?? FLOOR_MIN;
  return Math.max(FLOOR_MIN, left) / (SESSION_LENGTH_MIN * TRADING_DAYS);
}

/** Calendar years to an AM contract's 09:30 settlement (five minutes at the least) — the clock its calendar vol is on */
export function amCalendarYears(expiry: string, nowMs: number): number {
  const today = nyIsoDate(nowMs);
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const mins = days * 1440 + (SESSION_OPEN_MIN - nyMinutes(nowMs));
  return Math.max(FLOOR_MIN, mins) / (365 * 24 * 60);
}

/** ∂σ_trading/∂σ_quoted on an AM contract's own clock: √(T_cal ÷ T_trade) to its 09:30 settlement (core/volClock
    quotedVolPoint for the PM clock); 1 once settled */
export function amVolPoint(expiry: string, nowMs: number): number {
  const tt = amTradingYears(expiry, nowMs);
  const tc = amCalendarYears(expiry, nowMs);
  return tt != null && tt > 0 && tc > 0 ? Math.sqrt(tc / tt) : 1;
}

/** An AM contract's vol on the trading clock, to ITS settlement: solved from the mid when the spread is tight (as
    core/volClock ivOnTradingClock), else the vendor's calendar vol moved onto that clock with the variance unchanged.
    0 once settled. */
export function amIvOnTradingClock(bid: number, ask: number, vendorIv: number, spot: number, strike: number, expiry: string, right: 'C' | 'P', nowMs: number, r?: number, q?: number): number {
  const t = amTradingYears(expiry, nowMs);
  if (t == null) return 0;
  const mid = usableMid(bid, ask);
  if (mid > 0 && spot > 0 && strike > 0) {
    const solved = impliedVolFromPrice(mid, spot, strike, t, right, r, q);
    if (solved != null && solved > 0.01 && solved < 5) return solved;
  }
  return vendorIv > 0 ? vendorIv * amVolPoint(expiry, nowMs) : 0;
}
