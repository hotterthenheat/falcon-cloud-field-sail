/* Off-exchange prints with the read attached: the likely intent behind a print and what the level means. */

/** What the print is most likely doing — the read, not just the tape line. */
export type DarkPoolIntent = 'ACCUMULATION' | 'DISTRIBUTION' | 'HEDGE FLOW' | 'ROTATION';

export interface DarkPoolPrint {
  id: number;
  time: string;
  /** The print's instant (epoch ms) and its New York day, for session filters and sorting. */
  epochMs?: number;
  dateIso?: string;
  /** An auction print (opening or closing cross), named by `special`; never read. */
  auction?: boolean;
  ticker: string;
  price: number;
  size: number;
  /** Dollars */
  notional: number;
  venue: string;
  /** Signed % distance of the print from current spot */
  vsSpotPct: number;
  /** Print landed on one of the session's tracked liquidity shelves */
  atLevel: boolean;
  /** A sized print: the top quarter by shares, which the reads are built on. */
  sized: boolean;
  intent: DarkPoolIntent;
  /** 0–100 — how confident the classifier is in the intent */
  conviction: number;
  /** One-line human read of the print */
  read: string;
  /** Where the print sat in the NBBO, when that quote exists. */
  exec?: 'ASK' | 'BID' | 'MID' | null;
  /** The quote at the print, when the feed sent one. */
  bid?: number | null;
  ask?: number | null;
  /** Priced by its own terms (average-price, contingent, derivative-priced), not the quote: carries no read. */
  special?: string | null;
  /** The FINRA trade reporting facility the print was reported to; the dark venue itself is not disclosed. */
  facility?: string;
  /** Reported outside the regular session (ext_hour_sold_codes): no read. */
  extended?: boolean;
  /** A lit print (on an exchange, /lit-flow) in the same shape; not a dark cross. */
  lit?: boolean;
}

export type LevelRole = 'SUPPORT' | 'RESISTANCE' | 'PIVOT';

export interface DarkPoolLevel {
  price: number;
  /** Aggregate off-exchange dollars transacted at this shelf */
  notional: number;
  prints: number;
  /** Share of session dark-pool notional, 0–100 */
  sharePct: number;
  role: LevelRole;
  /** Times intraday price reversed off this shelf, only where counted from real bars; absent otherwise. */
  defended?: number;
  /** Signed % distance from spot */
  distPct: number;
  /** How to actually trade against the shelf */
  usage: string;
}

export type Posture = 'ACCUMULATING' | 'DISTRIBUTING' | 'BALANCED';

// ---- sector leaders (the market-wide view) ----------------------------------

export interface DarkLeaderRow {
  ticker: string;
  price: number;
  /** Day direction — drives the tiny price arrow */
  dirUp: boolean;
  /** Dark notional today, dollars */
  notional: number;
  /** Dark volume as % of the name's average daily volume */
  pctAvgVol: number;
  /** Shares printed dark */
  size: number;
}

export interface DarkSector {
  sector: string;
  /** Sector identity color (categorical) */
  color: string;
  notional: number;
  /** Share of total dark notional, 0–100 */
  sharePct: number;
  prints: number;
  /** Top tickers by dark notional, descending */
  rows: DarkLeaderRow[];
}

export interface DarkLeadersView {
  totalNotional: number;
  totalPrints: number;
  updated: string;
  /** Sorted by notional, descending — the leaders */
  sectors: DarkSector[];
}

export interface DarkPoolView {
  ticker: string;
  spot: number;
  /** % of total session volume executed off-exchange */
  dpSharePct: number;
  /** −100…+100 — net accumulation vs distribution across sized prints */
  netPosturePct: number;
  posture: Posture;
  postureNote: string;
  totalNotional: number;
  levels: DarkPoolLevel[];
  prints: DarkPoolPrint[];
  largest: DarkPoolPrint | null;
}
