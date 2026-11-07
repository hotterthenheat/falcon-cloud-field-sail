/* Where a rule that has PASSED the EDGE0DTE study joins Compass as a model of its own (research/edge0dte/PROTOCOL.md §7).
   The registry is empty: no rule has passed (research-v2-ledger.md, ~1,300 trials, no validated edge). Nothing here
   scans, calls or shows anything until a rule is added, and a rule is only accepted with every criterion met.

   To add one (a research decision, never a product one):
   1. Its acceptance, all eight of PROTOCOL §7, with the evidence: the frozen spec's sha256 (v2data/locked_looks.jsonl),
      the ledger line of its one HOLDOUT look, DSR and PBO at the full trial count, the red-team note, and the 15-session
      live shadow it passed on LOCKED-period live data.
   2. `decide`: the rule itself, on the board Compass already scans at a mark (no new data call; a rule that needs one
      goes through docs/DATA_SOURCES.md first). It returns the contract and side, or null. No score is returned: Compass
      shows none.
   3. Its record: give it the next model number and a book letter of its own in compassOutcome SignalBook, settle it
      by its frozen exit (compassOutcome settleSignal takes a book), and it gets a twin and a forward-test line like
      Model 1 and Model 3 (compassTwins twinnable, compassForward forwardTest), its own row in the Blotter and the
      Tracker, and its own words in compassParams modelOfBook. The scan calls `acceptedRules()` at each mark.
   Until then `acceptedRules()` is empty and the scan has nothing to call. */

import type { OptionRight, Setup } from '../types/compass';

/** The board at a mark, as the scan holds it: every quoted contract of one root and sleeve, the underlying, the instant. */
export interface RuleBoard {
  ticker: string;
  at: number;
  spot: number;
  setups: readonly Setup[];
}

export interface RuleCall {
  /** One of `setups`, by id */
  id: string;
  right: OptionRight;
}

/** PROTOCOL §7, every criterion, with the evidence for each. */
export interface Acceptance {
  /** 1. Stage 1 pass in DISCOVERY and CALIBRATION: the registry row and its FDR q */
  stage1: { registryRow: string; fdrQ: number };
  /** 2. HOLDOUT, one blind look: net expectancy CI lower bound > 0, n ≥ 100 trades on ≥ 60 sessions */
  holdout: { ledgerLine: string; specSha256: string; trades: number; sessions: number; ciLow: number };
  /** 3. Beats the random side and the best simpler baseline, CI-separated */
  beatsBaselines: boolean;
  /** 4. Deflated Sharpe at the full trial count, and PBO */
  dsr: number;
  pbo: number;
  /** 5. Each parameter ± one grid step keeps the sign; 6. survives $1.30 fees and +1 tick; 7. not carried by one year,
      regime or time bucket */
  neighbourhood: boolean;
  costs: boolean;
  notOneRegime: boolean;
  /** 8. Red-team review: who, and where its note is */
  redTeam: string;
  /** The 15-session live shadow on LOCKED-period live data */
  shadow: { sessions: number; from: string; to: string };
}

export interface ValidatedRule {
  /** Stable id (the registry row) */
  id: string;
  /** The words a reader sees: the next model number, e.g. "Model 5" */
  name: string;
  acceptance: Acceptance;
  decide: (board: RuleBoard) => RuleCall | null;
}

/** The registry. Empty: no rule has passed. */
export const VALIDATED_RULES: readonly ValidatedRule[] = [];

/** A rule meets every criterion of PROTOCOL §7 as written. */
export function accepted(rule: ValidatedRule): boolean {
  const a = rule.acceptance;
  return (
    !!a.stage1.registryRow && a.stage1.fdrQ <= 0.1 &&
    !!a.holdout.ledgerLine && /^[0-9a-f]{64}$/.test(a.holdout.specSha256) && a.holdout.trades >= 100 && a.holdout.sessions >= 60 && a.holdout.ciLow > 0 &&
    a.beatsBaselines && a.dsr >= 0.95 && a.pbo < 0.3 && a.neighbourhood && a.costs && a.notOneRegime && !!a.redTeam &&
    a.shadow.sessions >= 15
  );
}

/** The rules the scan may call: those in the registry that meet every criterion. */
export function acceptedRules(rules: readonly ValidatedRule[] = VALIDATED_RULES): ValidatedRule[] {
  return rules.filter(accepted);
}
