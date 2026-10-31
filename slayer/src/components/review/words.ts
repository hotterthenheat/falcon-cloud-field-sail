/* REVIEW · how a figure is said (one place, so the desk, the report and the journal say it the same way) */

import { clockWords, dayWords } from '../../data/review/history';
import type { Moment } from '../../data/review/engine';
import { pctWhole as pct } from '../../core/format';

const MINUS = '−';
export const usd = (v: number, digits = 2): string => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** "+$1,240.50" · "−$310.00" · "$0.00" */
export const usdSigned = (v: number, digits = 2): string => (Math.abs(v) < 0.005 ? usd(0, digits) : `${v > 0 ? '+' : MINUS}${usd(v, digits)}`);
/** "+0.42R" */
/** A balance: a minus where it is under zero, no plus where it is not */
export const usdBal = (v: number, digits = 2): string => (v < -0.005 ? `${MINUS}${usd(v, digits)}` : usd(v, digits));
export const rWords = (r: number): string => `${r >= 0 ? '+' : MINUS}${Math.abs(r).toFixed(2)}R`;
export { pct };
/** The direction's ink for a signed figure — flat money is plain */
export const dirInk = (v: number): string => (Math.abs(v) < 0.005 ? 'text-textSecondary' : v > 0 ? 'text-bull' : 'text-bear');
/** "Mar 14 · 10:42 ET" */
export const momentWords = (m: Moment): string => `${dayWords(m.day)} · ${clockWords(m.minute)} ET`;
/** Session minutes as a trader would say them. `dayMin`: the minutes in a trading day of that kind — an option's
    390, a future's 1,380 (a future held twenty hours was read as "3.5 sessions"). Days, not "1.0 sessions". */
export const heldWords = (min: number, dayMin = 390): string => {
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  if (min < dayMin) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  const d = min / dayMin;
  const n = d < 10 ? +d.toFixed(1) : Math.round(d);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
};

/** Sharpe or Sortino, to two places — "—" where it cannot be said (under two closed days, or no spread) */
export const ratioWords = (v: number | null): string => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(2)}`);
/** What Sharpe and Sortino are read off, for their title */
export const RATIO_TITLE =
  'Annualised (×√252) on the account’s day-to-day returns, close to close: Sharpe is the mean over its spread, Sortino the mean over its downside only. No risk-free rate is taken off. Shown once two days have closed.';
/** "1 scratch" · "3 scratches" */
export const scratchWords = (n: number): string => `${n} ${n === 1 ? 'scratch' : 'scratches'}`;
export const SCRATCH_TITLE = 'A scratch closed at exactly $0: neither a win nor a loss, it is left out of the win rate and neither starts nor breaks a losing run';
