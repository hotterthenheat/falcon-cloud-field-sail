/*
  The Compass decision journal: choice, record, resolve, recalibrate. The live writer and the replay harness write the
  same shapes, told apart by FeatureSnapshot.provenance. DecisionEvent and FeatureSnapshot are append-only; an
  OutcomeEvent holds only real market facts; weights change only through a WeightsRevision row.
*/

import type { ScannerKey, SleeveKey, Verdict } from './compass';
/* Horizon is declared beside the weights it indexes; rows use that type, never a copy. */
export type Horizon = 'SAMEDAY' | 'WEEKLIES' | 'SWINGS' | 'LEAPS';

/** Engine build stamp ("compass@0.3.0"), bumped on any scoring, weight, threshold or candidate change so replays stay
    comparable. The current value is in core/journal.ts. */
export type EngineVersion = string;

/** Options today; delta-one instruments are literals already, so futures need no schema change. */
export type Instrument = 'OPTION' | 'STOCK' | 'SINGLE_NAME_FUTURE';

/** Canonical contract identity. Display ids are not stable, so the journal joins on `occ`. */
export interface ContractId {
  instrument: Instrument;
  ticker: string;
  /** OPTION only */
  right?: 'C' | 'P';
  /** OPTION only */
  strike?: number;
  /** Real expiry session, YYYY-MM-DD (core/calendar: never a weekend or holiday). */
  expiry?: string;
  /** The join key: OPTION the 21-char OCC symbol ("SPY   260731C00500000"), STOCK the ticker, SINGLE_NAME_FUTURE
      "FUT:TICKER:YYYY-MM-DD". Built by core/journal.ts only. */
  occ: string;
}

/** The Compass surface that emitted the decision; `sleeve` (tenor) is optional on rows older than it. */
export type DecisionSource =
  | { kind: 'scanner'; scanner: ScannerKey; sleeve?: SleeveKey }
  | { kind: 'weigher'; horizon: Horizon };

/** What the market showed at the decision instant. */
export interface Marks {
  bid: number;
  ask: number;
  mid: number;
  /** Underlying price */
  spot: number;
}

/** One planned rung, in premium space; whether it was reached lives in OutcomeEvent.targetsHit. */
export interface PlannedTarget {
  level: number;
  targetPremium: number;
  expectedPct: number;
}

/** How a level exit is judged: a session close through it (the UI's promise), or a touch for intraday scanners. */
export type CloseRule = 'SESSION_CLOSE_THROUGH' | 'TOUCH';

/** The choice, recorded the instant it was made. Append-only. */
export interface DecisionEvent {
  /** `${occ}|${sourceKey}|${decidedAt}` — see core/journal.ts */
  id: string;
  engineVersion: EngineVersion;
  /** ISO instant: the wall clock live, the pinned engine clock in replay. */
  decidedAt: string;
  source: DecisionSource;
  contract: ContractId;
  marks: Marks;
  /** Composite score at decision time */
  score: number;
  /** Internal verdict vocabulary (users see states) */
  verdict: Verdict;
  targets: PlannedTarget[];
  /** The underlying level that kills the thesis; `side` is the direction through it that means dead. */
  invalidation: { price: number; side: 'BELOW' | 'ABOVE'; rule: CloseRule };
  /** Trading sessions of runway at decision time (calendar-aware) */
  sessionsToExpiry: number;
  featureSnapshotId: string;
}

/** Where a snapshot's inputs came from; evaluation refuses SIM data as market truth. */
export type FeatureProvenance = 'SIM' | 'LIVE' | 'REPLAY';

/** What the engine saw when it decided. Stored apart from DecisionEvent, since outcomes join to decisions far more
    often than anyone re-reads the inputs. */
export interface FeatureSnapshot {
  id: string;
  decidedAt: string;
  ticker: string;
  provenance: FeatureProvenance;
  /** Version of the data pipeline behind the inputs (feeds, GEX constants, dark-pool heuristic). */
  dataVersion?: string;
  spot: number;
  ivRank: number;
  /** Annualized base IV, percent (e.g. 15.2) */
  baseIvPct: number;
  rsi: number;
  /** The dealer-positioning levels the engine saw */
  gex: { callWall: number; putWall: number; flip: number; supreme: number; netGex: number };
  /** Dark-pool posture, -100 (distributing) to +100 (accumulating) */
  darkPool: { posture: number };
  /** News lean, -1 (bearish) to +1 (bullish), and how loud the tape was */
  news: { lean: number; volume: number };
  /** The Weigher's factor board as scored: key, 0-100 score, weight */
  factors: { key: string; score: number; weight: number }[];
}

/** A real, timestamped crossing of a planned target. */
export interface TargetCross {
  level: number;
  at: string;
  /** Premium at the crossing */
  mark: number;
}

export type ExitReason =
  | 'EXPIRY'
  | 'INVALIDATED' // the invalidation level broke per its CloseRule
  | 'ALL_TARGETS_HIT'
  | 'ENGINE_EXIT'; // verdict decayed to EXIT before any terminal event

/** How it ended: one terminal OutcomeEvent per decision, every number derived from market data after decidedAt. */
export interface OutcomeEvent {
  decisionId: string;
  resolvedAt: string;
  exit: { reason: ExitReason; at: string; mark: number };
  /** Real crossings only, in rung order: a level appears here only if price reached it. */
  targetsHit: TargetCross[];
  /** Path stats in premium space: highWater is the best mark; maxFavorablePct / maxAdversePct are MFE/MAE, % of entry
      mid. */
  path: { highWater: number; maxFavorablePct: number; maxAdversePct: number };
  /** P&L as % of entry mid, at exit and at fixed horizons */
  pnl: { atExitPct: number; horizons: { sessions: number; pct: number }[] };
  sessionsHeld: number;
}

// ---- evaluation → recalibration ------------------------------------------

/** One score band's real-world performance — the calibration curve's point. */
export interface CalibrationBucket {
  scoreMin: number;
  scoreMax: number;
  samples: number;
  /** Share of decisions in the band whose TP1 was crossed */
  tp1HitRate: number;
  avgPnlPct: number;
}

/** Which factor misled, tallied over misses. */
export interface FactorAttribution {
  factorKey: string;
  /** Mean factor score on losers minus on winners; large and positive means confidently wrong on losers. */
  missBias: number;
  samples: number;
}

/** One evaluation pass over a window of resolved decisions, per source. */
export interface EvaluationRun {
  id: string;
  ranAt: string;
  engineVersion: EngineVersion;
  source: DecisionSource;
  window: { from: string; to: string };
  samples: number;
  /** Hit rate per rung, rung order */
  targetHitRates: number[];
  /** Mean R multiple (risk = entry to invalidation) */
  expectancyR: number;
  calibration: CalibrationBucket[];
  attribution: FactorAttribution[];
}

/** A deliberate, versioned weights change, justified by an evaluation and activated at a known instant, so any
    decision can be replayed under the weights that scored it. */
export interface WeightsRevision {
  engineVersion: EngineVersion;
  previousVersion: EngineVersion;
  /** Which sleeve's weights changed */
  horizon: Horizon;
  /** Factor key → new weight */
  weights: Record<string, number>;
  basedOnEvaluationId: string;
  activatedAt: string;
  note: string;
}
