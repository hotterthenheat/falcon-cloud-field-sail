/* Trace's row types: one options print (FlowPrint) and one contract's day (BookContract). */

export type StratTag = '—' | 'Vertical' | 'Butterfly' | 'Ratio' | 'Custom';

export interface FlowPrint {
  /** 53-bit hash of the vendor's id — for in-page maps; grids key on vendorId */
  id: number;
  time: string;
  ticker: string;
  /** 1 = single leg; >1 marks a leg of a multi-leg order */
  legs: number;
  strike: number;
  right: 'C' | 'P';
  /** Distance past the spot, % — positive out of the money for calls and puts alike */
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
  /** Bid-side share of the contract's day, 0–100 */
  ratioBidPct: number;
  size: number;
  /** Contracts on the bid / ask at this print, when the vendor sent them */
  nbboBidSize?: number;
  nbboAskSize?: number;
  /** Premium of the print, dollars */
  premium: number;
  volume: number;
  oi: number;
  /** vs prior session; 0 = unchanged or unknown */
  deltaOI: number;
  spot: number;
  /** % */
  iv: number;
  volOverOI: number;
  strat: StratTag;
  sweep: boolean;
  /** The flow alert this row is (or belongs to) */
  alertId?: string | null;
  /** Unix seconds of the fill */
  epoch?: number;
  /** The vendor's trade id — the dedupe key and the grid's row id */
  vendorId?: string;
  /** Milliseconds of the fill — the tape's paging cursor */
  epochMs?: number;
  /** The vendor's OCC symbol */
  occ?: string;
  /** A flow alert's print count */
  trades?: number;
  /** A flow alert's premium by side, dollars */
  alertSides?: { ask: number; bid: number; other: number };
  /** The vendor's name for the alert's rule */
  alertRule?: string;
  /** Printed outside the regular session — never read bullish or bearish */
  extended?: boolean;
  /** Opening, not closing, when a source has told it (a book row paired with the next count, traceRows
      likelyOpeningOf); absent: read off the print's own volume and open interest (data/tape.ts printOpens) */
  likelyOpening?: boolean | null;
  /** A flow alert's last fill, New York "HH:MM:SS" (`time` is its first) */
  fillEnd?: string;
  /** Per-share theta, as the vendor sends it */
  theta?: number;
  /** The contract's day so far by side (mid includes no-side) */
  daySide?: { ask: number; bid: number; mid: number };
  /** A compression package (OPRA cbmo / mctp, or the arbitrage tag) — not a bet */
  compression?: boolean;
  /** A pre-arranged cross trade — no side, never crowned */
  cross?: boolean;
  /** A flow alert's filing instant, ms — the alerts route's older_than cursor */
  createdMs?: number;
  /** The quote gives no read: crossed, or one side older than five minutes */
  quoteNoRead?: 'crossed' | 'stale';
  /** One leg of a no-side floor package — never ranked or called a block */
  floorPackage?: boolean;
  /** The card stands for a contract's day; `last` is the regular-session print it is anchored on */
  dayCard?: { last: { fill: number; size: number; time: string; side: 'ASK' | 'BID' | 'MID'; volume: number } | null; session: string };
  /** A flow alert's largest single trade, once its trades are read — the block test uses it */
  largestTrade?: { size: number; premium: number };
}

/** One contract's whole day — the row every book page (Screener, Footprints, Watchers, Compare) reads */
export interface BookContract {
  /** Stable across polls: the OCC symbol, else ticker-strike-right-expiry */
  key: string;
  /** The vendor's OCC symbol */
  optionSymbol?: string;
  ticker: string;
  sector: string | null;
  sectorColor: string | null;
  strike: number;
  right: 'C' | 'P';
  /** MM/DD/YYYY */
  expiry: string;
  dte: number;
  spot: number;
  /** Distance past the spot, % — FlowPrint's convention */
  otmPct: number;
  /** Latest fill */
  last: number;
  /** Latest fill vs the previous session's close, % */
  chgPct: number;
  /** HH:MM New York of the latest print */
  lastAt: string;
  /** Minute of day of that print */
  lastAtMin: number;
  volume: number;
  oi: number;
  deltaOI: number;
  deltaOIPct: number;
  /** Day premium, dollars */
  premium: number;
  /** % */
  iv: number;
  /** IV points vs prior close */
  ivChg: number;
  /** Volume over the open interest that stood at the session's open; 0 when there was none */
  volOverOI: number;
  /** Shares of the day's volume, 0–100: swept, in multi-leg orders, on the floor */
  sweepPct: number;
  multiPct: number;
  floorPct: number;
  /** Ask share of the sided volume (ask + bid), 0–100 */
  askPct: number;
  /** Share of the day printed as cross trades, 0–100 */
  crossPct?: number;
  /** Open interest the session opened on */
  prevOI: number;
  /** The previous session's close */
  prevAvgFill: number;
  /** Consecutive sessions OI has climbed */
  oiStreak: number;
  /** Consecutive sessions volume ran past standing OI */
  volGtOiStreak: number;
  /** Sessions until earnings, null = none before expiry */
  earnDays: number | null;
  /** The next report's date, YYYY-MM-DD */
  earnIso?: string | null;
  /** The day's contracts at the ask, on the bid, and at the mid or no side — they sum to the volume */
  sideVol?: { ask: number; bid: number; mid: number };
  /** Expired at the bell of the tape's session */
  expired?: boolean;
  /** Per-share theta, as the vendor sends it */
  theta?: number;
  /** The last fill's New York date */
  lastDay?: string;
  /** The session the volume is from */
  volDay?: string;
  /** The session whose trading set the open interest shown (the count is set the morning after) */
  oiDay?: string;
  /** The count after volDay's trading is not out yet */
  oiPending?: boolean;
  /** New positions likely opened (data/traceRows.ts likelyOpeningOf); null when it cannot be told */
  likelyOpening?: boolean | null;
}

export type PrintSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface LargestPrint {
  ticker: string;
  strike: number;
  right: 'C' | 'P';
  premium: number;
}

export interface TapeSummary {
  totalPremium: number;
  /** Bullish less bearish premium */
  netPremium: number;
  bullish: boolean;
  bullPremium: number;
  bearPremium: number;
  callCount: number;
  callPremium: number;
  putCount: number;
  putPremium: number;
  /** Put premium over call premium */
  pcRatio: number;
  sweeps: number;
  /** One-leg prints of block size (data/tape printKind) */
  blocks: number;
  multi: number;
  /** Single prints under the block line, and alert bursts */
  other: number;
  /** Counted apart, in no other figure */
  compression: { count: number; premium: number };
  /** In the call/put money, never in a side's total or the largest */
  spreadLegs: { count: number; premium: number };
  crosses: { count: number; premium: number };
  /** Sided prints that are not likely opening (data/tape.ts printOpens): shown, in the call/put money, in no lean */
  notOpening: { count: number; premium: number };
  largest: LargestPrint | null;
}
