/* Which book the desk's levels read. Since the two-book spec (docs/TWO_BOOK_SPEC_V2.md, 2026-11-07) there is ONE answer:
   the open-interest book. The old "Live" book — open interest PLUS today's signed volume — is retired: the spec forbids
   adding open interest to flow inventory (§6). The flow book is now its own board (Model 2: today's prints only,
   classified per §4.1 and revalued on the server, /api/tape/flowbook), shown beside the open-interest book on Pinpoint's
   Books page and never added to it.

   The field, the walls, the flip, the regime and the Terrain strike rail therefore all read the open-interest book. The
   functions below keep their names so every caller still compiles, and hand back what they were given — the same
   objects — so nothing downstream can change. A browser that kept the old "flow" choice is moved back to the
   open-interest book. */

import { useSyncExternalStore } from 'react';
import type { MarketSnapshot, StrikeNode } from '../types/market';

export type BookMode = 'oi' | 'flow';

/** The books' names wherever a reader sees them. The flow book is its own board (Pinpoint → Books), never this toggle. */
export const BOOK_MODE_WORDS: Record<BookMode, { label: string; line: string }> = {
  oi: { label: 'Open-interest book', line: 'Listed open interest as of the last report, dealers long the calls and short the puts by convention' },
  flow: { label: 'Flow book', line: 'Today’s prints, signed by the side that crossed, revalued now — its own board, never added to open interest' },
};

const KEY = 'slayer_book_mode_v1';
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'flow') localStorage.removeItem(KEY);
} catch {
  /* nothing kept */
}

export const bookMode = (): BookMode => 'oi';

/** Kept for callers: the open-interest book is the only one the desk's levels read */
export function setBookMode(_next: BookMode): void {
  /* the flow book is not a mode of this book (docs/TWO_BOOK_SPEC_V2.md §6) */
}

export function subscribeBookMode(_fn: () => void): () => void {
  return () => undefined;
}

export function useBookMode(): BookMode {
  return useSyncExternalStore(subscribeBookMode, bookMode, bookMode);
}

/** The chain as the desk reads it: the open-interest chain itself */
export const flowNode = (n: StrikeNode): StrikeNode => n;
export const flowChainOf = (chain: StrikeNode[]): StrikeNode[] => chain;
export const flowChainIn = (chain: StrikeNode[]): StrikeNode[] => chain;
export const chainInMode = (chain: StrikeNode[], _by?: Record<string, StrikeNode[]>, _m?: BookMode, _all?: readonly StrikeNode[]): StrikeNode[] => chain;
/** The snapshot as the desk reads it: itself */
export const bookInMode = (snapshot: MarketSnapshot, _m?: BookMode): MarketSnapshot => snapshot;
