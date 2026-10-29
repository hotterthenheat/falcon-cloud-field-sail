/* A watched contract (docs/watchlist-spec.md): marked at the add and tracked like a position (cost, mark, returns,
   breakeven, expiry) until closed by the reader or settled at the bell. No orders or broker. */

import type { OptionRight } from './compass';

export type WatchStatus = 'open' | 'closed' | 'expired';

/** One session's close of the contract's mark. */
export interface WatchMark {
  /** ISO date */
  day: string;
  close: number;
}

export interface WatchedContract {
  /** `${ticker}-${strike}-${right}-${expiry}-${addedAt}` */
  id: string;
  ticker: string;
  strike: number;
  right: OptionRight;
  /** The real expiry date, ISO — the chain's */
  expiry: string;
  /** Date.now() at the add */
  addedAt: number;
  /** The mark at the add: the cost, the risk, 1R. */
  addedMark: number;
  /** The underlying at the add, the card's breakeven anchor. */
  addedSpot: number;
  /** Contracts; 1 unless the reader sets it */
  size: number;
  status: WatchStatus;
  closedAt?: number;
  /** The mark at the close, or intrinsic at the bell */
  closedMark?: number;
  /** The reader's one line, optional */
  note?: string;
  /** One close per session since the add */
  marks: WatchMark[];
}

/** What an add hands the store; the same shape as the Weigher's deep link. */
export interface WatchRequest {
  ticker: string;
  strike: number;
  right: OptionRight;
  /** ISO date */
  expiry: string;
  size?: number;
  /** The live quote at the press. A watch is not added without one. */
  mark?: number;
  /** The stock at the press. */
  spot?: number;
}
