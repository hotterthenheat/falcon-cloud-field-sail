import type { EarningsEvent } from '../../data/earnings';

/* How the options price a report against what the name usually moves: a state, never an order. */

export type VolState = 'RICH' | 'INLINE' | 'CHEAP';

/* Rich is more than 1.3×, cheap less than 0.85×; richText adds a decimal when two would land on a boundary. */
const RICH_ABOVE = 1.3;
const CHEAP_BELOW = 0.85;
const stateOfRatio = (r: number): VolState => (r > RICH_ABOVE ? 'RICH' : r < CHEAP_BELOW ? 'CHEAP' : 'INLINE');
export const stateOf = (e: EarningsEvent): VolState => stateOfRatio(e.richness);
export const richText = (r: number): string => (Math.abs(r - RICH_ABOVE) < 0.005 || Math.abs(r - CHEAP_BELOW) < 0.005 ? r.toFixed(3) : r.toFixed(2));
