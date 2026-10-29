/* Pinpoint's GEX types: strike-chart overlays, the strike × expiry matrix, the flow board and dark-pool prints. */

/** Key dealer-structure price levels drawn on the strike chart. */
export interface KeyLevels {
  spot: number;
  callWall: number;
  putWall: number;
  flip: number;
  /** Strike holding the largest absolute exposure */
  supreme: number;
  /** Strike with the most open interest. Absent when that figure was not computed. */
  pin?: number;
  /** Settlement that pays the least intrinsic on the open interest. Not a wall. Absent without open interest. */
  maxPain?: number;
}

export interface DarkPoolPrint {
  price: number;
  /** Notional in $B */
  notional: number;
  date: string;
  /** Shares crossed */
  size: number;
  /** HH:MM:SS print time */
  time: string;
}

// ---- Exposure Profile (GEX / DEX / VEX by strike + the pressure ladder) -----

export type ExposureExpiry = '0DTE' | '1D' | '2D' | '5D' | '7D' | 'OPEX' | 'ALL';

/** Put / call legs and their net, signed dollars. */
export interface GreekSplit {
  put: number;
  call: number;
  net: number;
}

export interface StrikeExposure {
  strike: number;
  /** Marks the pin strike (max open-interest magnet) in the rail */
  pin?: boolean;
  gex: GreekSplit;
  dex: GreekSplit;
  vex: GreekSplit;
  /** Dollars of dealer delta per vol point; positive: a vol drop makes them buy there. */
  vanna: GreekSplit;
  /** Dollars of dealer delta the clock takes per session — negative: they buy there as it runs */
  charm: GreekSplit;
  /** Dollars of gamma-per-1% the clock adds per session. Absent until that expiry's contract vol is in — then 0 is a real zero. */
  color: GreekSplit;
  /** Dollars of vega gained or lost per vol point. */
  vomma: GreekSplit;
  /** Dollars of gamma-per-1% added when the underlying moves one dollar. */
  speed: GreekSplit;
  /** Dollars of vega the clock adds per session. */
  veta: GreekSplit;
  /** Dollars of gamma-per-1% added when vol moves one point. */
  zomma: GreekSplit;
  /** Contracts outstanding at the strike, both sides */
  oi: number;
  /** Session volume at the strike — the same figure Ranked Targets ranks by */
  volume: number;
}

/* His P-5 adds `air-pocket`: a run of strikes with almost no dealer gamma
   between two shelves — where price does NOT stop. */
export type ZoneKind = 'call-wall' | 'put-wall' | 'friction' | 'air-pocket';

/** Contiguous strike band the exposure profile annotates (strikes descending: from ≥ to). */
export interface ZoneBand {
  from: number;
  to: number;
  kind: ZoneKind;
  label: string;
}

/** A book's gamma regime — about volatility (absorbs or amplifies moves), never direction */
export type GammaBias = 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';

export interface ExposureLevels {
  spot: number;
  callWall: number;
  putWall: number;
  /** The strike with the most open interest in the window. Only a PIN when `pinFound`: dealers are long gamma there
      (their hedging pulls price back to it) and price is within 1% of it — otherwise no surface calls it a pin */
  pin: number;
  pinFound?: boolean;
  /** The gamma flip (data/flipLevel.ts). When `flipFound` is false there is no crossing within ±10% and this holds
      spot only as a placeholder — print "no flip nearby", never this number */
  flip: number;
  flipFound?: boolean;
  /** False while the contracts these levels are read from are still landing (a date, or the front date's own vols) —
      the levels are then provisional and the pages print "…" rather than a figure that is about to change */
  complete?: boolean;
  /** Net gamma of every strike of these contracts at spot, HOUSE sign (negative = dealers long gamma = absorbs). The
      regime is this sign — never the side of the flip */
  net?: number;
  /** Largest |net gamma| strike on the FULL book — may sit outside the
      rendered window, in which case the map crowns nothing rather than
      promoting a runner-up. */
  supreme: number;
}

export interface ExposureProfileData {
  ticker: string;
  expiry: ExposureExpiry;
  /** Strikes descending, window around spot */
  strikes: StrikeExposure[];
  /** Per-greek scaling for bars (max |leg| across the window) */
  maxAbs: { gex: number; dex: number; vex: number; vanna: number; charm: number };
  netGex: number;
  netDex: number;
  netVex: number;
  levels: ExposureLevels;
  zones: ZoneBand[];
  bias: GammaBias;
  biasNote: string;
  /** Generated narrative — levels translated to English */
  insights: string[];
  /** Row index after which the spot marker renders (-0.5 = above all rows) */
  spotAfterIndex: number;
}

// ---- Command cockpit ---------------------------------------------------------

export type KeyLevelKind = 'call-wall' | 'spot' | 'put-wall' | 'pin' | 'flip' | 'supreme';

export interface KeyLevelRow {
  kind: KeyLevelKind;
  label: string;
  price: number;
  /** Signed % distance from spot (spot row = 0) */
  distPct: number;
  /** Exposure magnitude parked at the level, dollars */
  pressure: number;
}

// ---- Volatility Lab ------------------------------------------------------------

// ---- Vanna & Charm (exposure migration) -----------------------------------------

/** CHARM = decay into the close · VANNA = shift under an IV move */
export type ShiftMode = 'CHARM' | 'VANNA';

export type IvShift = -2 | -1 | 1 | 2;

export interface ShiftBarRow {
  strike: number;
  pin?: boolean;
  /** Net GEX now, signed dollars */
  current: number;
  /** Net GEX under the scenario */
  projected: number;
}

export interface LevelShift {
  label: string;
  kind: KeyLevelKind;
  current: number;
  projected: number;
}

export interface WallDriftPoint {
  /** Unix seconds, bar-aligned */
  time: number;
  spot: number;
  callWall: number;
  putWall: number;
  flip: number;
}

// ---- Ranked Targets (strike scoring engine) ---------------------------------------

// ---- Vanna & Charm view -------------------------------------------------------------

/** One measured level in the migration read — price + signed distance from spot */
export interface ReadLevel {
  price: number;
  distPct: number;
}

/** The migration read as measurements: facts plus one short computation line, never a prediction. */
export interface MigrationRead {
  flip: ReadLevel;
  callWall: ReadLevel;
  putWall: ReadLevel;
  /** The strike where charm (decay repositioning) concentrates */
  charm: ReadLevel;
  /** Largest per-strike net-gex change vs the previous scan, if history allows */
  delta: { strike: number; changeUsd: number; distPct: number } | null;
  /** One short sentence — states what THIS SCENARIO computes, never what the
      market will do */
  line: string;
}

export interface VannaCharmView {
  ticker: string;
  spot: number;
  mode: ShiftMode;
  ivShift: IvShift;
  /** Strikes descending */
  rows: ShiftBarRow[];
  /** Max |value| across current + projected, for bar scaling */
  maxAbs: number;
  flipCurrent: number;
  flipProjected: number;
  shifts: LevelShift[];
  drift: WallDriftPoint[];
  read: MigrationRead;
}
