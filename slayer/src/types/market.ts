/* Shared market types: option chain, dealer exposure, trade plan and ledger. */

/** Any listed symbol. Core sim tickers are seeded; others are synthesized on demand. */
export type TickerSymbol = string;

export interface TickerConfig {
  basePrice: number;
  currentPrice: number;
  iv: number;
  step: number;
}

export interface Greeks {
  deltaCall: number;
  deltaPut: number;
  gamma: number;
  vega: number;
  vanna: number;
  charmCall: number;
  charmPut: number;
  /** Per one point of rate, as vega is per one point of vol. */
  rhoCall: number;
  rhoPut: number;
}

export interface Candle {
  /** Unix seconds, strictly increasing, bar-aligned */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GexLevel {
  strike: number;
  /** Net GEX at this strike (summed across expiries), signed dollars */
  value: number;
  /** Net delta exposure at the same instant, signed dollars; optional on older snapshots. */
  dex?: number;
  /** Net vega exposure at the same instant, signed dollars */
  vex?: number;
  /* Open interest at the same instant, carried on the snapshot so the two never drift apart. Optional: absence is not
     zero change. */
  callOI?: number;
  putOI?: number;
  /** False when the flow net is under about 2% of that strike's gross volume. Absent means the open-interest book. */
  firm?: boolean;
}

/** Net GEX across strikes captured at one bar-aligned moment. */
export interface GexSnapshot {
  time: number;
  levels: GexLevel[];
}

export interface Indicators {
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  squeeze: boolean;
}

export interface StrikeNode {
  strike: number;
  /** The price and instant (epoch ms) the vendor priced this strike's live gamma at; the flip re-prices from them
      (data/flipLevel.ts). */
  gexPx?: number;
  gexAt?: number;
  callOI: number;
  putOI: number;
  gamma: number;
  /* Every exposure below (gex, dex, vex, vanna, charm; call, put, net) is KEPT in the house sign of core/dealerSign.ts —
     the negative of the dealer figure under the one model, dealers long the calls and short the puts. Read it through
     dealerOf(); never negate by hand. */
  callGex: number;
  putGex: number;
  netGex: number;
  /** Open-interest gamma, kept when near-dated netGex is the signed-flow inventory. */
  oiNetGex?: number;
  oiCallGex?: number;
  oiPutGex?: number;
  /** Flow and open interest disagree by more than a fifth. */
  bookGap?: boolean;
  callDex: number;
  putDex: number;
  netDex: number;
  callVex: number;
  putVex: number;
  netVex: number;
  /** The unit greeks at the strike, per contract (not exposures). */
  vanna: number;
  charm: number;
  /** Vanna exposure: dollars of delta per one point of vol, by leg, kept sign (dealer positive: a vol drop makes dealers buy). */
  callVanna: number;
  putVanna: number;
  netVanna: number;
  /** Charm exposure: dollars of delta per session, by leg, kept sign (dealer positive: the clock makes dealers sell). */
  callCharm: number;
  putCharm: number;
  netCharm: number;
  /** Today's contracts at this strike, when the feed has them. Absent on a sample chain. */
  callVol?: number;
  putVol?: number;
  /** The vendor's implied vol and per-contract gamma for this strike's call and put on one expiry, once its
      option-contracts rows are read. */
  callIv?: number;
  putIv?: number;
  callGamma?: number;
  putGamma?: number;
  /** The contract count the greeks were multiplied by: the leg's open interest; absent until the contracts are read. */
  callBook?: number;
  putBook?: number;
  /** False when this strike's flow net is too small a share of its volume to trust. The sign is still the flow sign. */
  flowFirm?: boolean;
  /** Spot-exposure dollars for one strike. Ask is dealers selling, bid is dealers buying. Not greek-exposure shares. */
  vendor?: {
    px: number;
    at?: number;
    /** call oi, call ask, call bid, put oi, put ask, put bid */
    g: number[];
    d: number[];
    v: number[];
    c: number[];
    asks: boolean;
  };
  /** The flow book, in the same kept sign as the open-interest fields. A held strike draws the open-interest figure. */
  flow?: {
    gex: { call: number; put: number };
    dex: { call: number; put: number };
    vex: { call: number; put: number };
    vanna: { call: number; put: number };
    charm: { call: number; put: number };
    color: { call: number; put: number };
    vomma: { call: number; put: number };
    speed: { call: number; put: number };
    veta: { call: number; put: number };
    zomma: { call: number; put: number };
    disagree: boolean;
    held: boolean;
    outside: boolean;
  };
}

export type TradeDirection = 'BULLISH' | 'BEARISH';

export interface TradePlan {
  ticker: TickerSymbol;
  direction: TradeDirection;
  score: number;
  confidence: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  flipZone: number;
  supportWall: number;
  resistanceWall: number;
}

export interface TapeOrder {
  time: string;
  ticker: TickerSymbol;
  strike: string;
  type: 'C' | 'P';
  size: number;
  orderType: 'SWEEP' | 'BLOCK';
  side: 'ASK' | 'BID';
  /** Days to expiry. 0 is the session's contracts. Absent only on a print that never named one. */
  dte?: number;
}

export interface MarketSnapshot {
  ticker: TickerSymbol;
  spot: number;
  changePercent: number;
  priceHistory: number[];
  chain: StrikeNode[];
  indicators: Indicators;
  plan: TradePlan;
  tape: TapeOrder[];
  /** Set when this snapshot was built from Unusual Whales, not the simulator. */
  liveBook?: boolean;
  /** House-signed chains for the expiry lenses the desk can ask for (0DTE, 1D, ALL, …). */
  uwChains?: Partial<Record<string, StrikeNode[]>>;
  /** House-signed chain per listed expiry date (YYYY-MM-DD). */
  uwByDate?: Record<string, StrikeNode[]>;
  /** Every expiry the vendor listed, nearest first. */
  uwExpiries?: { date: string; dte: number }[];
  /** Expiry dates whose option-contracts rows have been read. VEX and the higher greeks are real only on these dates. */
  uwFacts?: ReadonlySet<string>;
  /** The day move outside the regular session (pre-market or after hours), kept apart from `changePercent`, and whether
      the day's change is known yet. */
  dayMove?: { extPct: number | null; phase: 'pre' | 'regular' | 'post' | 'closed'; known: boolean };
  /** The instant (epoch ms) a closed session's book is read as of, so its flip is priced at that session's clock
      (data/bookWindow.ts sessionBook). */
  asOf?: number;
  /** A finished session's close (epoch ms), freezing the flip and the counts against it after the bell. */
  flipAt?: number;
  /** The Levels scope has not loaded and the whole book stands in: every level is provisional and none is drawn
      (data/bookWindow.ts levelsBook). */
  levelsPending?: boolean;
}

