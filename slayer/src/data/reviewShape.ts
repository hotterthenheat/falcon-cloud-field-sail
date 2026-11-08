/* The review page's shape. No files and no feed: the scanner (reviewLive.ts) and the page both read this,
   and the page must not pull the scanner into the browser bundle. */

import type { WindowKind } from '../core/session';

export const REVIEW_LIVE = 5;

export type ReviewSleeve = '0' | '1-7' | '8-30';
export type ReviewBand = 0 | 1 | 2 | 3;
export type RunEnd = 'open' | 'back' | 'session';

/** One pullback from a peak inside the run. `through` means the bid came back to the turn or under it. */
export interface ReviewDraw {
  peak: number;
  low: number;
  pct: number;
  at: number;
  through: boolean;
}

export interface ReviewHit {
  id: string;
  root: string;
  contract: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  sleeve: ReviewSleeve;
  dte: number;
  band: ReviewBand;
  /** Peak ran past 5,000%. Still band 3. */
  over: boolean;
  /** The option session this move belongs to */
  session: WindowKind;
  sessionDay: string;
  /** The turn bid. */
  baseAsk: number;
  baseAt: number;
  /** This run's own turn. */
  baseFrom: 'turn';
  /** The turn minute's ask and sizes. Not the live quote. */
  turnAsk: number | null;
  turnBidSize: number | null;
  turnAskSize: number | null;
  /** (peak bid / turn bid) − 1. The bands read this. */
  reviewPct: number;
  /** The turn could have been bought: bid, ask, size, and an 8% mid. */
  fillable: boolean;
  /** (peak bid / turn ask) − 1. Set only when the turn was fillable. */
  tradePct: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  pct: number;
  peakBid: number;
  peakPct: number;
  peakAt: number;
  crossedAt: number;
  /** Pullbacks from a peak during the run. The one that comes back to the turn ends it. */
  draws: ReviewDraw[];
  /** The deepest pullback, as a percent of the peak it fell from. */
  maxDraw: number;
  /** A pullback came back to the turn. */
  through: boolean;
  end: RunEnd;
  endAt: number | null;
  endBid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
  oi: number | null;
  under: number | null;
  updatedAt: number;
}

export interface LiveReview {
  version: typeof REVIEW_LIVE;
  day: string;
  updatedAt: number;
  line: string;
  /** Names whose option book was open on the last pass */
  open: number;
  /** Names in the universe, after the weekly root is folded in */
  names: number;
  passAt: number;
  rows: ReviewHit[];
}

/** A turn that could be bought. The spread is on the mid. Size has to stand on both sides. */
export function fillableQuote(bid: number, ask: number | null, bidSize: number | null, askSize: number | null): boolean {
  if (!(bid >= 0.4) || ask == null || !(ask >= 0.5) || !(ask >= bid)) return false;
  if (!(bidSize != null && bidSize > 0) || !(askSize != null && askSize > 0)) return false;
  const mid = (ask + bid) / 2;
  if (!(mid > 0)) return false;
  return (ask - bid) / mid <= 0.08 + 1e-12;
}

/** 60–99 is its own band. 100–300, 301–800, 801 and up. Past 5,000 stays in the top band. Under 60 is not a run. */
export function bandOf(pct: number): ReviewBand | null {
  if (!(pct >= 60)) return null;
  if (pct >= 801) return 3;
  if (pct >= 301) return 2;
  if (pct >= 100) return 1;
  return 0;
}

/** Weekday sessions from the session day to the expiry. Same day is 0. Past 30 is not this scan. */
export function sleeveOf(dte: number): ReviewSleeve | null {
  if (dte === 0) return '0';
  if (dte >= 1 && dte <= 7) return '1-7';
  if (dte >= 8 && dte <= 30) return '8-30';
  return null;
}
