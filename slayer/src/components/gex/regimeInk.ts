/* The Regime tab's colour language — the site's own, never greys for data (2026-10-31, the owner: "the regime section is
   gray — how is that our UI?"):
   - the curve's shape in the walls' inks: contango (calm, near-term vol under the 3-month) in glacier, backwardation
     (stress, the curve inverted) in ember — the curve, the CURVE chip, and each ratio by its side of 1.00;
   - a reading's place in its year on the desk's heat ramp (heatmap.ts, the Calendar's and Matrix's cells): high runs
     hot, low runs cool, the middle quiet.
   Grey stays for the axes, the grid and the secondary words. */

import { heatCellStyle, type HeatMode } from './heatmap';

export const GLACIER = 'rgb(var(--glacier))';
export const EMBER = 'rgb(var(--ember))';

/** The curve's shape as an ink: contango glacier, backwardation ember, flat the secondary text */
export const regimeInk = (regime: string | null | undefined): string =>
  regime === 'contango' ? GLACIER : regime === 'backwardation' ? EMBER : 'rgb(var(--text-secondary))';

/** A ratio's ink by its side of 1.00 (over 1 the curve is inverted at that point) */
export const sideInk = (ratio: number | null | undefined): string => (ratio == null ? 'rgb(var(--text-secondary))' : ratio > 1 ? EMBER : GLACIER);

/** A percentile (0–100) on the desk's heat ramp: the Calendar cell a reading that far from the median would wear */
export const pctFill = (pct: number, mode: HeatMode, paper: boolean): string => String(heatCellStyle((pct - 50) / 50, 1, mode, paper).backgroundColor ?? GLACIER);
