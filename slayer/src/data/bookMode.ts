/* Which book Pinpoint draws (docs/TWO_BOOK_SPEC_V2.md; what was built: docs/TWO_BOOK.md §The Map). Two books, one engine,
   never mixed or added (§6):
     'oi'    the open-interest book (Model 1): listed open interest, dealers long the listed calls and short the listed
             puts by convention; four figures are the listing's own exposures converted to house units (§3.4), six are
             the house model on the same contracts (§3.5) — /api/twobook/oi;
     'flow'  the flow book (Model 2): today's prints, each signed by the side that crossed the quote, the modelled dealer
             on the other side, revalued now (§4) — /api/tape/flowbook.
   The Map's toggle sets it; the Map's matrix, chart, walls, flip, regime, and the pages that follow the Map's name read
   the book it names (src/data/book/engineView.ts). Before 2026-11-07 'flow' meant open interest PLUS signed volume —
   forbidden by §6 — so a browser that kept that choice under the old key starts on the open-interest book. */

import { useSyncExternalStore } from 'react';
import type { MarketSnapshot, StrikeNode } from '../types/market';

export type BookMode = 'oi' | 'flow';

/** The books' names wherever a reader sees them: what each book is, never where it comes from */
export const BOOK_MODE_WORDS: Record<BookMode, { label: string; short: string; line: string }> = {
  oi: { label: 'Open-interest book', short: 'Open interest', line: 'Listed open interest from the last report: dealers long the listed calls and short the listed puts by convention — not observed positions' },
  flow: { label: 'Flow book', short: 'Flow', line: 'Today’s prints, each signed by the side that crossed the quote, the modelled dealer on the other side, revalued now — its own book, never added to open interest' },
};

const OLD_KEY = 'slayer_book_mode_v1';
const KEY = 'slayer_book_mode_v2';
let mode: BookMode = 'oi';
try {
  if (typeof localStorage !== 'undefined') {
    /* the old key's 'flow' was open interest + flow (retired); it is not carried over */
    localStorage.removeItem(OLD_KEY);
    if (localStorage.getItem(KEY) === 'flow') mode = 'flow';
  }
} catch {
  /* nothing kept */
}
const listeners = new Set<() => void>();

export const bookMode = (): BookMode => mode;

export function setBookMode(next: BookMode): void {
  if (next !== 'oi' && next !== 'flow') return;
  if (next === mode) return;
  mode = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, next);
  } catch {
    /* the choice lives for this page */
  }
  for (const fn of [...listeners]) fn();
}

export function subscribeBookMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBookMode(): BookMode {
  return useSyncExternalStore(subscribeBookMode, bookMode, bookMode);
}

/* The chains a page reads are already the chosen book's (engineView.ts builds them from that book's cells), so these
   hand back what they are given. They keep their names so every caller compiles; none of them mixes the books. */
export const flowNode = (n: StrikeNode): StrikeNode => n;
export const flowChainOf = (chain: StrikeNode[]): StrikeNode[] => chain;
export const flowChainIn = (chain: StrikeNode[]): StrikeNode[] => chain;
export const chainInMode = (chain: StrikeNode[], _by?: Record<string, StrikeNode[]>, _m?: BookMode, _all?: readonly StrikeNode[]): StrikeNode[] => chain;
export const bookInMode = (snapshot: MarketSnapshot, _m?: BookMode): MarketSnapshot => snapshot;
