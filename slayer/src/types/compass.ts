/*
==================================================
  SLAYER TERMINAL - COMPASS TYPES (compass.ts)
  Advisory signal engine — ENTER/EXIT guidance only.
  Four scanners, grouped setup feed, contract chain,
  signal monitor & impact leaderboard.
==================================================
*/

/*
  TWO AXES, one board (redesign 2026-08-04, docs/compass-redesign-port.md):
  the SLEEVE is the contract tenor (how long the trade lives), the SCANNER is
  the thesis lens (why the trade exists). Weeklies/Swings used to be scanner
  keys — they were always tenors wearing a scanner's hat, and the backtest
  spec's sleeves (Weekly/Swing/LEAPS/Lotto) confirm the split. Every scanner
  runs on every sleeve.
*/

/* FIVE SLEEVES (his partner's table, 2026-10-10): 0DTE · Weekly · Swing · POSITION (new — a quarter) · Long-dated (the
   LEAPS sleeve under its new name; the key stays, so every stored setup, deep link and journal entry still reads) */
export type SleeveKey = 'odte' | 'weekly' | 'swing' | 'position' | 'leaps';

export interface SleeveDef {
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

export const SLEEVE_BY_KEY: Record<SleeveKey, SleeveDef> = Object.fromEntries(
  SLEEVES.map(s => [s.key, s])
) as Record<SleeveKey, SleeveDef>;

/* THE TWELVE KINDS (his partner's table, 2026-10-10 — "the new setups for compass"): the five that stood, with
   Breakouts, Trend continuation, Volatility expansion, Mean reversion, Overpriced and Earnings beside them. The keys are
   the engine's and the journal's; the two that stood under other words keep their keys ('top-setups', 'whale-sweeps'). */
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

export interface ScannerDef {
  key: ScannerKey;
  label: string;
  blurb: string;
}

/* THE KINDS, in plain words (the Compass walk, 2026-09-11): the reader picks
   one on the board's Kind card. The keys are the engine's and the journal's —
   they never change; only the words did ("Whale Sweeps" echoed the
   reference's brand word, banned on Trace the same way). */
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

/*
  WHICH KIND RUNS ON WHICH SLEEVE — HIS PARTNER'S TABLE (2026-10-10), replacing the 2026-08-07 map: on, LIMITED, or
  off, a kind on a sleeve. A fully-crossed grid sells nonsense trades (a scalp's thesis is an intraday hold; a year-long
  instrument for a two-week bounce is twelve months of premium for a fortnight of idea). "Limited" is the kind offered
  on that sleeve with a stricter bar and fewer candidates — the partner's note names each; until the math is final the
  board says "limited" beside the kind. This map IS the backtest spec's candidate-eligibility gate — the journal and
  the harness inherit it, so we never evaluate a combination the product doesn't sell.

                      0DTE     Weekly   Swing    Position  Long-dated
    Top ranked         on       on       on       on        on
    Quick scalp        on       limited  off      off       off
    Discounted         off      on       on       on        limited
    Rebounds           on       on       on       limited   off
    Breakouts          limited  on       on       on        off
    Trend continuation limited  on       on       on        on
    Volatility exp.    limited  on       on       on        off
    Mean reversion     on       on       on       limited   off
    Unusual activity   limited  on       on       off       off
    Overpriced         limited  on       on       on        off
    Earnings           limited  on       limited  off       off
    All setups         on       on       on       on        on
*/
export type Eligibility = 'on' | 'limited' | 'off';
const SLEEVE_ORDER: SleeveKey[] = ['odte', 'weekly', 'swing', 'position', 'leaps'];
const row = (cells: string): Record<SleeveKey, Eligibility> =>
  Object.fromEntries(SLEEVE_ORDER.map((k, i) => [k, cells[i] === '+' ? 'on' : cells[i] === '~' ? 'limited' : 'off'])) as Record<SleeveKey, Eligibility>;
/* one character a sleeve, in SLEEVE_ORDER: + on · ~ limited · - off */
export const ELIGIBILITY: Record<ScannerKey, Record<SleeveKey, Eligibility>> = {
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
export function scannerEligibility(scanner: ScannerKey, sleeve: SleeveKey): Eligibility {
  return ELIGIBILITY[scanner]?.[sleeve] ?? 'off';
}

/** the kinds a sleeve offers (on or limited), in the board's order — the shape the harness and the journal read */
export const ELIGIBLE_SCANNERS: Record<SleeveKey, ScannerKey[]> = Object.fromEntries(
  SLEEVE_ORDER.map(sleeve => [sleeve, SCANNERS.filter(s => scannerEligibility(s.key, sleeve) !== 'off').map(s => s.key)])
) as Record<SleeveKey, ScannerKey[]>;

export function isScannerEligible(scanner: ScannerKey, sleeve: SleeveKey): boolean {
  return scannerEligibility(scanner, sleeve) !== 'off';
}

/** The engine's internal read on a contract. Kept to ourselves for loop
    scoring — users never see a command, only a state (see VERDICT_LABEL). */
export type Verdict = 'ENTER' | 'EXIT' | 'WATCH';

/** User-facing labels: the engine grades itself with ENTER/EXIT internally,
    but the terminal shows states, not orders. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  ENTER: 'ACTIVE',
  WATCH: 'WATCH',
  EXIT: 'FADING',
};

export type Momentum = 'STRENGTHENING' | 'NEUTRAL' | 'WEAKENING';

/** Per-strike engine recommendation shown in the contract chain. */
export type ChainAction = 'HOLD' | 'REDUCE' | 'SELL';

/** LADDER INVARIANT (any provider of this field must hold it): statuses run
    HIT* → at most ONE 'IN PROGRESS' → PENDING*, in rung order. The frontier
    rung is the only one working; the UI draws exactly one live marker from
    it. On real data, HIT additionally means price actually crossed the target
    since the setup triggered — never infer it from anything else. */
export type TakeProfitStatus = 'PENDING' | 'IN PROGRESS' | 'HIT';

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
  /** Display bucket, e.g. "0DTE" / "5DTE" — the sleeve's voice. */
  expiry: string;
  /** The REAL expiry session, YYYY-MM-DD, resolved through core/calendar —
      never a weekend or holiday. This is what the journal writer records. */
  expiryDate: string;
  /** Trading sessions of runway at scan time (calendar-aware). */
  sessionsLeft: number;
  /** Underlying 1σ move to expiry, percent — iv·√(sessions/252)·100. Real
      math, unlike expectedMovePct which speaks premium-target language. */
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
  /** Highest premium reached since entry. INVARIANT with the ladder: a rung is
      HIT if and only if its target ≤ highWater — the rail draws this as the
      campaign's memory, so "banked, then faded" reads instead of contradicting
      the chips. Real data must supply the true running max. */
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
  /** Theta's higher-order greeks on this quote. Charm, color and veta are the annual partial. */
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
}

/** One name's market state as the scan sees it. The Compass engine takes the
    whole universe as an ARGUMENT — live pages pass the simulator's quotes, a
    replay harness passes historical ones, and the engine can't tell which. */
export interface UniverseQuote {
  ticker: string;
  price: number;
  /** Annualized IV, e.g. 0.15 */
  iv: number;
  /** Strike grid increment */
  step: number;
}

export interface SetupGroup {
  ticker: string;
  spot: number;
  sparkline: number[];
  changePct: number;
  found: number;
  setups: Setup[];
}

export interface ChainSide {
  premium: number;
  changePct: number;
  health: number;
  momentum: Momentum;
  action: ChainAction;
}

export interface ChainRow {
  strike: number;
  call: ChainSide;
  put: ChainSide;
}

export interface ContractChain {
  ticker: string;
  spot: number;
  rows: ChainRow[];
}

/** The four reasons a contract carries weight (Mo, 2026-08-19: "show why
    each one matters: Gamma, Volume/OI, Distance from spot, Net exposure"). */
export type ImpactMetric = 'gamma' | 'voloi' | 'distance' | 'exposure';

export interface ImpactRow {
  rank: number;
  contract: string;
  strike: number;
  right: OptionRight;
  /** Display bucket matching the board's sleeve — the expiry the analysis page opens. */
  expiry: string;
  openInterest: number;
  volume: number;
  /** Today's volume against open interest — above 1×, more traded today than existed this morning. */
  volOi: number;
  /** Strike distance from spot, signed percent: + above, − below. */
  distPct: number;
  /** This contract's dealer gamma, signed dollars — negative absorbs moves, positive amplifies. */
  exposureUsd: number;
  /** Share of the whole book's gamma, percent. */
  gamma: number;
}

/** Why a contract is on a setup's driver list — the part it plays in the
    book the campaign trades through. */
export type DriverRole = 'This contract' | 'Call wall' | 'Put wall' | 'Supreme' | 'Pin' | 'In the path';

export interface DriverRow extends ImpactRow {
  role: DriverRole;
}

export interface CompassView {
  scanner: ScannerKey;
  groups: SetupGroup[];
  totalFound: number;
  shown: number;
  chain: ContractChain;
}
