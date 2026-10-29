/* Which expiry dates a chain is (one date, a sum of several via bookWindow.chainForDates, or the whole book via uwBook.chainsFor),
   by identity, so the flip can re-price each date's legs at its own time to expiry. */
import type { StrikeNode } from '../types/market';

const registry = new WeakMap<readonly StrikeNode[], string[] | 'ALL'>();

/** Mark a chain as the sum of these expiry dates, or as the whole live book */
export function registerChainDates(chain: readonly StrikeNode[], dates: string[] | 'ALL'): void {
  registry.set(chain, dates);
}

export const registeredDates = (chain: readonly StrikeNode[]): string[] | 'ALL' | undefined => registry.get(chain);
