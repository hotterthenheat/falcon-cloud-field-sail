/* A name's numbers as the page shows them, filled from its file (stockOverview.ts numbersFor). */

export type Valuation = 'undervalued' | 'fairly valued' | 'overvalued';

export interface Fundamentals {
  /** True when the name's file has no numbers yet */
  sample: boolean;
  /** Last reported quarter. Null when that figure is not on the feed. */
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  revenueEstimateB: number | null;
  revenueActualB: number | null;
  revenueSurprisePct: number | null;
  /** Beats of the estimate in the last eight quarters */
  beats: number | null;
  /** How many of those quarters had both a print and an estimate */
  beatOf: number;
  /** In-line and missed counts over the same reports */
  inline?: number | null;
  misses?: number | null;
  /** Year on year. Null when the feed does not carry it. */
  revenueGrowthPct: number | null;
  epsGrowthPct: number | null;
  operatingMarginPct: number | null;
  freeCashFlowMarginPct: number | null;
  pe: number | null;
  sectorMedianPe: number | null;
  evToSales: number | null;
  peg: number | null;
  /** Where the P/E sits among the sector, 0–100 */
  sectorPercentile: number | null;
  fairValue: number | null;
  vsFairValuePct: number | null;
  valuation: Valuation | null;
  /** 0–100. Null when there is no balance-sheet score on the feed. */
  healthScore: number | null;
  /** Guidance's last change. Null when the feed does not say. */
  guidance: 'raised' | 'held' | 'cut' | null;
  /** Dividend yield, percent. Null when the name does not show one. */
  dividendYieldPct: number | null;
  /** Market cap, dollars. */
  marketCap: number | null;
}
