/* The Ledger's pointer contract: a cell is one strike at one expiry. The greek pick is DropdownMulti's list (greeks, or 'all');
   none ticked reads as all five, and `pickGreeks` returns them in the book's order. */
import { GREEKS, type Greek } from '../../data/exposureSurface';
import type { MultiOption } from '../ui/DropdownMulti';

export interface SurfaceCell {
  strike: number;
  /** Index into surface.expiries */
  e: number;
}

export const GREEK_PICK_OPTIONS: MultiOption[] = [
  { value: 'all', label: 'All', hint: 'GEX, DEX, dollar vega, vanna, charm, and the five higher greeks' },
  { value: 'gex', label: 'GEX', hint: 'Gamma: dollars of stock dealers trade for a 1% move — positive absorbs moves, negative amplifies them' },
  { value: 'dex', label: 'DEX', hint: 'Delta: the dealers’ option delta in dollars of stock — they hold the opposite in shares' },
  { value: 'vex', label: 'vega $', hint: 'Dollar vega: what the dealers’ options gain or lose if implied vol moves one point' },
  { value: 'vanna', label: 'VANNA', hint: 'Vanna: dollars of stock a one-point drop in implied vol makes dealers buy (negative: sell)' },
  { value: 'charm', label: 'CHARM', hint: 'Charm: dollars of stock one session’s passing makes dealers sell (negative: buy), price and vol unchanged' },
  { value: 'color', label: 'COLOR', hint: 'Change in GEX over one session ($ per 1%, per session)' },
  { value: 'vomma', label: 'VOMMA', hint: 'Change in dollar vega for a one-point vol move ($ per vol point, per vol point)' },
  { value: 'speed', label: 'SPEED', hint: 'Change in dealer gamma for a 1% move, in GEX dollars at today’s price ($ per 1%, per 1%)' },
  { value: 'veta', label: 'VETA', hint: 'Change in dollar vega over one session ($ per vol point, per session)' },
  { value: 'zomma', label: 'ZOMMA', hint: 'Change in GEX for a one-point vol move ($ per 1%, per vol point)' },
];

const isGreek = (v: string): v is Greek => (GREEKS as string[]).includes(v);

/** The greeks drawn for a pick — the book's order, all five for 'all' or nothing */
export function pickGreeks(values: readonly string[]): Greek[] {
  const ticked = GREEKS.filter(g => values.includes(g));
  return values.includes('all') || ticked.length === 0 ? GREEKS : ticked;
}

/** The pick after the reader ticks or unticks — 'all' and the greeks never stand together */
export function nextGreekPick(prev: readonly string[], next: readonly string[]): string[] {
  const hadAll = prev.includes('all');
  const hasAll = next.includes('all');
  if (hasAll && !hadAll) return ['all'];
  const greeks = next.filter(isGreek);
  if (greeks.length === 0 || greeks.length === GREEKS.length) return ['all'];
  return GREEKS.filter(g => greeks.includes(g));
}
