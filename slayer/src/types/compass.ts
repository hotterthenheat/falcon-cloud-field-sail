/* Compass: the advisory signal engine (enter/exit guidance only), its scanners, setup feed and contract chain. */

import type { CostMark } from '../data/compassCost';

/* Two axes on one board (docs/compass-redesign-port.md): the sleeve is the contract tenor, the scanner the thesis.
   Every scanner runs on every sleeve. */

/* Five sleeves: 0DTE, Weekly, Swing, Position (a quarter) and Long-dated, whose key stays 'leaps' for stored data. */
export type SleeveKey = 'odte' | 'weekly' | 'swing' | 'position' | 'leaps';

interface SleeveDef {
  key: SleeveKey;
  label: string;
  /** Calendar days out, resolved to a real session through core/calendar. */
  dte: number;
  /** Strike-ladder rung width as a fraction of spot (snapped to the grid). */
  rungPct: number;
  blurb: string;
}

export const SLEEVES: SleeveDef[] = [
  { key: 'odte', label: '0DTE', dte: 0, rungPct: 0.005, blurb: 'Same session — expires at today’s bell' },
  { key: 'weekly', label: 'Weekly', dte: 5, rungPct: 0.012, blurb: 'This week — a few sessions to run, theta still light' },
  { key: 'swing', label: 'Swing', dte: 45, rungPct: 0.025, blurb: 'Six weeks — held for as long as the levels hold' },
  { key: 'position', label: 'Position', dte: 90, rungPct: 0.035, blurb: 'A quarter — the bigger levels, a longer hold' },
  { key: 'leaps', label: 'Long-dated', dte: 365, rungPct: 0.06, blurb: 'A year out — direction over days, not minutes' },
];

/* Twelve kinds. Keys are the engine's and the journal's and never change ('top-setups', 'whale-sweeps' keep theirs). */
export type ScannerKey =
  | 'top-setups'
  | 'quick-scalp'
  | 'discounted'
  | 'rebounds'
  | 'breakouts'
  | 'trend'
  | 'vol-expansion'
  | 'mean-reversion'
  | 'whale-sweeps'
  | 'overpriced'
  | 'earnings'
  | 'all';

interface ScannerDef {
  key: ScannerKey;
  label: string;
  blurb: string;
}

/* The kinds in plain words, picked on the board's Kind card; only the words may change, never the keys. */
export const SCANNERS: ScannerDef[] = [
  { key: 'top-setups', label: 'Top ranked', blurb: 'The strongest by trend and hedging' },
  { key: 'quick-scalp', label: 'Quick scalp', blurb: 'Fast intraday moves, held for minutes' },
  { key: 'discounted', label: 'Discounted', blurb: 'Priced under the move expected' },
  { key: 'rebounds', label: 'Rebounds', blurb: 'A turn off a level that held' },
  { key: 'breakouts', label: 'Breakouts', blurb: 'Through a wall, with room to run' },
  { key: 'trend', label: 'Trend continuation', blurb: 'A pullback that held, in a trend that has not' },
  { key: 'vol-expansion', label: 'Volatility expansion', blurb: 'A range too tight to last, with the move underpriced' },
  { key: 'mean-reversion', label: 'Mean reversion', blurb: 'Stretched far from fair, with a level to come back to' },
  { key: 'whale-sweeps', label: 'Unusual activity', blurb: 'Large orders swept across the exchanges' },
  { key: 'overpriced', label: 'Overpriced', blurb: 'Premium asking more than the move usually gets' },
  { key: 'earnings', label: 'Earnings', blurb: 'A report inside the expiry, the move priced against the levels' },
  { key: 'all', label: 'All setups', blurb: 'Every setup, whatever found it' },
];

/* Which kind runs on which sleeve: on, limited (stricter bar, fewer candidates) or off. This map is also the backtest's
   candidate-eligibility gate, so the journal never evaluates a combination the product does not sell. */
type Eligibility = 'on' | 'limited' | 'off';
const SLEEVE_ORDER: SleeveKey[] = ['odte', 'weekly', 'swing', 'position', 'leaps'];
const row = (cells: string): Record<SleeveKey, Eligibility> =>
  Object.fromEntries(SLEEVE_ORDER.map((k, i) => [k, cells[i] === '+' ? 'on' : cells[i] === '~' ? 'limited' : 'off'])) as Record<SleeveKey, Eligibility>;
/* one character a sleeve, in SLEEVE_ORDER: + on · ~ limited · - off */
const ELIGIBILITY: Record<ScannerKey, Record<SleeveKey, Eligibility>> = {
  'top-setups': row('+++++'),
  'quick-scalp': row('+~---'),
  discounted: row('-+++~'),
  rebounds: row('+++~-'),
  breakouts: row('~+++-'),
  trend: row('~++++'),
  'vol-expansion': row('~+++-'),
  'mean-reversion': row('+++~-'),
  'whale-sweeps': row('~++--'),
  overpriced: row('~+++-'),
  earnings: row('~+~--'),
  all: row('+++++'),
};

/** how a kind stands on a sleeve: on, limited, or off */
function scannerEligibility(scanner: ScannerKey, sleeve: SleeveKey): Eligibility {
  return ELIGIBILITY[scanner]?.[sleeve] ?? 'off';
}

export function isScannerEligible(scanner: ScannerKey, sleeve: SleeveKey): boolean {
  return scannerEligibility(scanner, sleeve) !== 'off';
}

/** The engine's internal verdict, used for loop scoring; users only ever see a state (VERDICT_LABEL). */
export type Verdict = 'ENTER' | 'EXIT' | 'WATCH';

export type Momentum = 'STRENGTHENING' | 'NEUTRAL' | 'WEAKENING';

/** Ladder invariant: statuses run HIT* then at most one 'IN PROGRESS' then PENDING*, in rung order, so the UI draws one
    live marker. On real data HIT means price crossed the target since the setup triggered. */
type TakeProfitStatus = 'PENDING' | 'IN PROGRESS' | 'HIT';

export type OptionRight = 'C' | 'P';

export interface SetupGreeks {
  delta: number;
  gamma: number;
  /** Dollars per calendar day, per share. Not the annual partial. */
  theta: number;
  /** Dollars per 1 vol point, per share. */
  vega: number;
  /** Implied vol in percent, 20 means 20%. */
  iv: number;
  rho?: number;
}

export interface TargetLevel {
  price: number;
  pct: number;
}

export interface TakeProfit {
  level: number;
  status: TakeProfitStatus;
  expectedPct: number;
  target: number;
}

export interface Setup {
  id: string;
  ticker: string;
  contract: string;
  right: OptionRight;
  strike: number;
  /** Display bucket ("0DTE", "5DTE"). */
  expiry: string;
  /** The real expiry session, YYYY-MM-DD (core/calendar); what the journal records. */
  expiryDate: string;
  /** Trading sessions of runway at scan time (calendar-aware). */
  sessionsLeft: number;
  /** Underlying 1-sigma move to expiry, percent: iv * sqrt(sessions/252) * 100 (unlike expectedMovePct, a premium
      target). */
  sigmaMovePct: number;
  sleeve: SleeveKey;
  score: number;
  verdict: Verdict;
  topRated: boolean;
  topOpportunity: boolean;
  expectedMovePct: number;
  swingTarget: TargetLevel;
  scalpExit: TargetLevel;
  headline: string;
  whyChips: string[];
  whyText: string;
  greeks: SetupGreeks;
  bid: number;
  ask: number;
  mid: number;
  liveMid: number;
  /** Highest premium since entry. Invariant: a rung is HIT exactly when its target <= highWater; real data must supply
      the true running max. */
  highWater: number;
  confidence: number;
  health: number;
  momentum: Momentum;
  takeProfits: TakeProfit[];
  /** Underlying price milestones matching TP1–TP4 — drawn on campaign charts */
  priceTargets: number[];
  liquidityLabel: 'Tight' | 'Normal' | 'Wide';
  liquiditySpread: string;
  /** Underlying at the quote. Absent on older rows. */
  spot?: number;
  /** Exchange time of the quote, epoch ms. */
  quotedAt?: number;
  /** When Compass first listed this contract, epoch ms. Not a model call. */
  seenAt?: number;
  /** Scored after its mark from the quotes ThetaData recorded at that mark (the live scan missed it) */
  late?: boolean;
  /** The scan mark the call belongs to, epoch ms of its minute */
  mark?: number;
  /** The option tape session the call was made in (compassParams tapeSession) */
  tapeSession?: 'overnight' | 'pre' | 'regular' | 'curb';
  /** The mark's minute lies outside the trees' trained minutes (t 15 to 330): allowed, and labelled */
  outsideTrained?: boolean;
  /** When the call's session flats it (epoch ms): 09:20 overnight and pre-market, 15:55 (or five before an early
      close) in the regular session */
  flatAt?: number;
  /** P(TP1) from the entry model at the scan that picked this contract. */
  p1?: number;
  /** P(runner) from the runner model at that same scan. */
  prun?: number;
  /** Runner probability at the signal minute was at least 0.50. */
  runner?: boolean;
  /** Both models named this exact contract. It is listed once. */
  modelAgree?: boolean;
  /** The hold kept after the two models were compared. */
  better?: 'runner' | 'entry';
  /** Which book the contract landed in. The bars that sort these are not set. */
  band?: 'scalp' | 'average' | 'top' | 'wing' | 'closest' | 'lottery';
  /** Same trade, held after the score climbed. */
  strength?: boolean;
  /** Theta's higher-order greeks on this quote; charm, color and veta are annual partials. */
  vanna?: number;
  charm?: number;
  vomma?: number;
  veta?: number;
  speed?: number;
  zomma?: number;
  color?: number;
  ultima?: number;
  lambda?: number;
  epsilon?: number;
  invalidationPrice: number;
  invalidationReason: string;
  /** What the contract costs to hold to its flat and the move it needs, read at the call, and how it was chosen
      (data/compassCost.ts) */
  cost?: CostMark;
}

/** One name's market state as a scan sees it. The engine takes the universe as an argument (live quotes or replayed
    history) and cannot tell which. */
export interface UniverseQuote {
  ticker: string;
  price: number;
  /** Annualized IV, e.g. 0.15 */
  iv: number;
  /** Strike grid increment */
  step: number;
}

