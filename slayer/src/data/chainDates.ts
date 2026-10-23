/*
  WHICH EXPIRY DATES A CHAIN IS (data/chainDates.ts) — a chain handed to a page is either one date's own strikes, the
  sum of several (bookWindow.chainForDates) or the whole live book (uwBook.chainsFor). The flip re-prices each date's
  legs at its own time to expiry, so it has to know which; the chains say so here, by identity.
*/
import type { StrikeNode } from '../types/market';

const registry = new WeakMap<readonly StrikeNode[], string[] | 'ALL'>();

/** Mark a chain as the sum of these expiry dates, or as the whole live book */
export function registerChainDates(chain: readonly StrikeNode[], dates: string[] | 'ALL'): void {
  registry.set(chain, dates);
}

export const registeredDates = (chain: readonly StrikeNode[]): string[] | 'ALL' | undefined => registry.get(chain);
