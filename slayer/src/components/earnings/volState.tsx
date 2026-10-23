import type { EarningsEvent } from '../../data/earnings';

/*
  Vol-pricing states — how the market is charging for a print vs what the
  name historically does. States, not orders: the engine's PLAY/FADE/SKIP
  verdicts stay internal; users see the pricing described.
*/

export type VolState = 'RICH' | 'INLINE' | 'CHEAP';

/* ONE BOUNDARY, SAID AS IT IS CODED (the fourth audit, 2026-10-23): the hint said "less than 0.85×" while the code took
   0.85 itself, and SLB's 0.851× printed "0.85× cheap" off a rounded figure. Rich is MORE than 1.3×, cheap LESS than
   0.85×, judged on the unrounded ratio; richText prints a third decimal when two would land on a boundary. */
export const RICH_ABOVE = 1.3;
export const CHEAP_BELOW = 0.85;
export const stateOfRatio = (r: number): VolState => (r > RICH_ABOVE ? 'RICH' : r < CHEAP_BELOW ? 'CHEAP' : 'INLINE');
export const stateOf = (e: EarningsEvent): VolState => stateOfRatio(e.richness);
export const richText = (r: number): string => (Math.abs(r - RICH_ABOVE) < 0.005 || Math.abs(r - CHEAP_BELOW) < 0.005 ? r.toFixed(3) : r.toFixed(2));

// Plain English only — no trader shorthand in user-facing labels
export const STATE_LABEL: Record<VolState, string> = {
  RICH: 'OVERPRICED',
  INLINE: 'FAIRLY PRICED',
  CHEAP: 'UNDERPRICED',
};

const stateDot: Record<VolState, string> = {
  RICH: 'bg-warn',
  INLINE: 'bg-ink/30',
  CHEAP: 'bg-bull',
};

export const StateTag = ({ state }: { state: VolState }) => (
  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-textPrimary whitespace-nowrap">
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateDot[state]}`} />
    {STATE_LABEL[state]}
  </span>
);
