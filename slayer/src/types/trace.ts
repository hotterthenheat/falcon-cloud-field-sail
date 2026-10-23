/*
==================================================
  SLAYER TERMINAL - TRACE TYPES (trace.ts)
  Rich options-flow prints for the live tape.
==================================================
*/

export type StratTag = '—' | 'Vertical' | 'Butterfly' | 'Ratio' | 'Custom';

export interface FlowPrint {
  id: number;
  time: string;
  ticker: string;
  /** 1 = single leg; >1 renders the ×N multi-leg marker */
  legs: number;
  strike: number;
  right: 'C' | 'P';
  /** Signed % distance of strike from spot */
  otmPct: number;
  /** MM/DD/YYYY */
  expiry: string;
  dte: number;
  fill: number;
  bid: number;
  ask: number;
  /** Where the fill landed in the spread: 0 = at bid, 1 = at ask */
  fillPos: number;
  side: 'BID' | 'ASK' | 'MID';
  /** −100…+100 aggressor conviction */
  flowScore: number;
  /** e.g. "ASK 61%" / "MID" — dominant execution side for the contract today */
  ratioLabel: string;
  /** Bid-side share of the contract's day, 0–100 */
  ratioBidPct: number;
  size: number;
  /** Total premium of the print, dollars */
  premium: number;
  volume: number;
  oi: number;
  /** vs prior session; 0 = unchanged/unknown */
  deltaOI: number;
  spot: number;
  /** % */
  iv: number;
  volOverOI: number;
  strat: StratTag;
  sweep: boolean;
  /** Vendor id when the row is a flow alert — the door to the trades inside it. */
  alertId?: string | null;
  /** Unix seconds of the fill — the tape's cursor. Not drawn. */
  epoch?: number;
  /** Vendor trade id, for dedupe. Not drawn. */
  vendorId?: string;
  /** Milliseconds of the fill — the tape's lossless cursor. Not drawn. */
  epochMs?: number;
  /** The vendor's OCC option symbol — the door to the contract's own tape (Trace's card) */
  occ?: string;
  /** A flow alert's prints — an alert is an aggregate of this many trades */
  trades?: number;
  /** A flow alert's premium by side, dollars */
  alertSides?: { ask: number; bid: number; other: number };
  /** The vendor's name for the alert's rule (RepeatedHits, Sweeps…) */
  alertRule?: string;
  /** Printed outside the regular session (the vendor's report_flags "extended_hours", or its trading_hours) — read
      against a post-market quote, so it carries no bullish/bearish read */
  extended?: boolean;
  /** A flow alert's own fill window, New York "HH:MM:SS" (its start_time … end_time) — `time` is the first fill */
  fillEnd?: string;
  /** Per-share theta, as the vendor sends it on the print (null on most index prints) */
  theta?: number;
  /** The CONTRACT's day so far by side — at the ask, on the bid, at the mid or no side (the vendor's ask_vol, bid_vol,
      mid_vol + no_side_vol on the print) */
  daySide?: { ask: number; bid: number; mid: number };
  /** A compression package (OPRA cbmo / mctp, or the vendor's `arbitrage` tag) — not a bet; kept out of every
      directional total (data/traceLive printCondition) */
  compression?: boolean;
  /** A flow alert's largest single trade, when its trades have been read — the block test reads it, never total_size */
  largestTrade?: { size: number; premium: number };
}

// ---- the day book (data/flowBook.ts) ----------------------------------------

/** One contract's whole day rolled up — the shared row every flow surface
    (screener, net flow, OI explorer, 0DTE, interval, multi-leg) reads. */
export interface BookContract {
  /** TICKER-STRIKE-RIGHT-DTE — stable across the day */
  /** The vendor's OCC option symbol, when the row came from the live screener — the door to the contract's own last trade */
  optionSymbol?: string;
  key: string;
  ticker: string;
  sector: string | null;
  sectorColor: string | null;
  strike: number;
  right: 'C' | 'P';
  /** MM/DD/YYYY */
  expiry: string;
  dte: number;
  spot: number;
  /** Signed % distance of strike from spot — FlowPrint's convention */
  otmPct: number;
  /** Latest fill on the contract */
  last: number;
  /** Latest fill vs the day's opening fill, % */
  chgPct: number;
  /** HH:MM of the contract's most recent print */
  lastAt: string;
  /** Minute-of-day of that print — the recency sort key */
  lastAtMin: number;
  /** Day-cumulative contracts traded */
  volume: number;
  oi: number;
  /** vs prior session close */
  deltaOI: number;
  deltaOIPct: number;
  /** Day-cumulative premium, dollars */
  premium: number;
  /** % */
  iv: number;
  /** Signed IV points vs prior close */
  ivChg: number;
  volOverOI: number;
  /** Share of day volume that arrived in sweeps, 0-100 */
  sweepPct: number;
  /** Share tied to multi-leg structures, 0-100 */
  multiPct: number;
  /** Share executed on the floor — institutional crosses, 0-100 */
  floorPct: number;
  /** Ask-side share of the day's volume, 0-100 — bid side is the remainder */
  askPct: number;

  // -- the overnight ledger (Footprints reads these; day-stable) --
  /** Prior session's OI — deltaOI's base */
  prevOI: number;
  /** Prior session's volume — the day the position was built or unwound */
  prevVolume: number;
  /** Prior session's average fill, dollars */
  prevAvgFill: number;
  /** Prior session's premium total, dollars */
  prevPremium: number;
  /** Ask-side share of the PRIOR session's volume — which side built it */
  prevAskPct: number;
  /** Consecutive sessions OI has climbed; 0 = fell or flat yesterday */
  oiStreak: number;
  /** Consecutive sessions volume ran past standing OI */
  volGtOiStreak: number;
  /** Sessions until earnings, null = not reporting in the calendar window */
  earnDays: number | null;
  /** Prior session's volume by 15-min bucket, 26 values normalized 0-1 —
      the shape of the build, not a second volume fact */
  prevSpark: number[];
  /** The day's contracts by where they traded: at the ask, on the bid, and at the mid or with no side (the vendor's
      mid_volume + no_side_volume — a cross is no side). The three sum to the day's volume. */
  sideVol?: { ask: number; bid: number; mid: number };
  /** The contract expired at the bell of the tape's session — it no longer stands */
  expired?: boolean;
  /** The vendor's per-share theta on the screener row */
  theta?: number;
  /** The contract's last fill as a New York date and minute, for display */
  lastDay?: string;
}

export type PrintSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface LargestPrint {
  ticker: string;
  strike: number;
  right: 'C' | 'P';
  premium: number;
}

export interface TapeSummary {
  /** All premium on the tape, dollars */
  totalPremium: number;
  /** Bullish-premium minus bearish-premium, dollars */
  netPremium: number;
  bullish: boolean;
  bullPremium: number;
  bearPremium: number;
  callCount: number;
  callPremium: number;
  putCount: number;
  putPremium: number;
  pcRatio: number;
  sweeps: number;
  /** One-leg prints of real size (data/tape printKind) */
  blocks: number;
  /** Prints with legs */
  multi: number;
  /** The rest: single prints under the block line, and alerts of several small prints */
  other: number;
  /** Compression packages, counted apart and in no other figure here */
  compression: { count: number; premium: number };
  largest: LargestPrint | null;
}
