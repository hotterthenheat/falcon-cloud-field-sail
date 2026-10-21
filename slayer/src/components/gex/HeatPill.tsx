import { memo, type ReactNode } from 'react';
import { heatCellStyle, type HeatMode } from './heatmap';

/*
==================================================
  SLAYER TERMINAL - THE HEAT CELL, AS A PILL
  (components/gex/HeatPill.tsx)

  One cell of a heat surface: a rounded capsule
  carrying its own value, floating on the surface
  rather than tiling with its neighbours.

  WHY A PILL AND NOT A TILE. The old cell was the
  table cell — a flat rectangle with a background
  colour, edge to edge, so a row of them read as one
  continuous band and the eye had to find the seams
  before it could count columns. Reading a strike
  across five expiries meant tracking a colour change
  with no boundary to hold on to.

  A capsule with air around it is a COUNTABLE object.
  The gap does the work the borders used to: columns
  separate without a single rule being drawn, and a
  quiet cell reads as a quiet cell rather than as a
  gap in the band.

  THE COLOUR IS UNCHANGED, deliberately. This is the
  same `heatCellStyle` ramp every heat surface has
  used — gold is put-dominant and amplifying, steel
  is call-dominant and absorbing, ink is chosen by
  measured contrast against the fill it lands on.
  Only the SHAPE moved. A form change that also moves
  the colours is two changes wearing one commit, and
  the next person cannot tell which one they are
  looking at.
==================================================
*/

export interface HeatPillProps {
  /** Signed value — decides both the pole and the intensity. */
  value: number;
  /** The scale this surface paints against. */
  maxAbs: number;
  /** What to print inside. Right-aligned, because a column of numbers is read
      down its last digit, not its first. */
  children: ReactNode;
  /**
   * Ringed rather than recoloured.
   *
   * A selected cell cannot be marked by changing its fill: the fill IS the
   * value, and overriding it makes the one cell the reader is looking at the
   * one cell that no longer says what it holds.
   */
  selected?: boolean;
  /** Override the ring's colour — the supreme strike wears the supreme magenta, not the
      selection lime, because it is a property of the BOOK rather than of what
      the reader clicked. */
  ringColor?: string;
  /** A mark at the leading edge — the supreme strike, a held position. Sits in its
      own lane so it never collides with the number. */
  marker?: ReactNode;
  /** A badge in the same lane, before the mark — the calendar's "since the open" figure (2026-10-12), drawn as its own
      small chip because the capsule's fill is the value and the badge's ink must read on every fill */
  badge?: ReactNode;
  /** The same word as a dot, in this ink: BESIDE THE FIGURE when the column has room (Noah, 2026-10-12: "all the
      dots should be right next to the number"), else OVER the padding at the leading edge, in no lane, so the
      narrowest column's short figure keeps every glyph (a lane's 4px gap alone turned "435M" into "43…") */
  dot?: string;
  dotBeside?: boolean;
  /** Height of the capsule. The row owns its rhythm; this only fills it. */
  className?: string;
  /** The figure's size in px when the row is tall enough to earn more than the 10px default
      (the Ledger's rows share the panel's height — a 40px row prints 13px). */
  fontSize?: number;
  /** Another ramp for THIS surface only (the Ledger's thermal try) — the house ramp otherwise */
  mode?: HeatMode;
  /** Less side padding — a narrow cell (the Ledger's All at forty columns) keeps its short figure: right-aligned, the
      figure keeps its 4px on the right and gives the left up (the paying-user audit: "−187M" was 39px in 38) */
  tight?: boolean;
  /** On paper (the light page): the tint ramp, a faint colour on the page's grey — the surface says so, never the pill
      itself, because the surfaces that stay dark islands on the light page keep the dark ramp */
  paper?: boolean;
  title?: string;
  onClick?: () => void;
}

/*
  The ring is the SELECTION voice (lime), not a heat colour, so it cannot be
  mistaken for a value. It is drawn as an inset shadow rather than a border:
  a border would add a pixel to the box and shift every neighbour by half a
  row when one cell is picked.
*/
const SELECTION_INK = 'rgb(var(--select))';
/* Two rings, not one: the accent alone vanishes against the ramp's bright
   platinum pole, so a dark outer ring gives it an edge to sit on at both ends
   of the scale. Same trick the old supreme cell used. */
/* THE RING STANDS OUTSIDE THE CAPSULE (Noah, 2026-10-15, on a supreme node: "its like touching the number"): the inset
   ring — 1.5px of ink and 1.5px of the panel's dark inside the capsule — ate three pixels of the figure's padding, and in
   a tight cell the figure sat against the ink. The ring is drawn outside the capsule's edge now, the figure's padding
   whole; the cells' 2px of air each way holds it. */
const ring = (ink: string) => `0 0 0 1.5px ${ink}`;

/* THE FIGURE LIFTED OFF ITS FILL (the partner, 2026-09-14: "the numbers on the capsules are
   difficult to see"): the ink pair is fixed by the contrast maths in heatmap.ts (≥4.11:1 at the
   crossover, no better pair exists), so the lift comes from WEIGHT — bold, not semibold — and a
   faint halo in the other ink under every glyph, which is what carries a 10px figure across the
   mid-luminance fills where the ratio is at its floor. */
const HALO_UNDER_DARK_INK = '0 0 1.5px rgba(255,255,255,0.45)';
const HALO_UNDER_LIGHT_INK = '0 0 2px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.5)';

const HeatPill = ({
  value,
  maxAbs,
  children,
  selected = false,
  ringColor,
  marker,
  badge,
  dot,
  dotBeside = false,
  className = '',
  fontSize,
  mode,
  tight = false,
  paper = false,
  title,
  onClick,
}: HeatPillProps) => {
  const heat = heatCellStyle(value, maxAbs, mode, paper);
  const halo = heat.color === '#0a0a0a' ? HALO_UNDER_DARK_INK : HALO_UNDER_LIGHT_INK;
  return (
    <span
      title={title}
      onClick={onClick}
      style={{ ...heat, textShadow: halo, ...(selected ? { boxShadow: ring(ringColor ?? SELECTION_INK) } : null), ...(fontSize ? { fontSize } : null) }}
      className={`relative flex min-w-0 items-center justify-end gap-1 rounded-full ${tight ? 'pl-px pr-1' : 'px-2'} font-mono text-[11px] font-bold tnum leading-none transition-colors duration-700 ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {dot && !dotBeside && <span aria-hidden className="absolute left-[2px] top-1/2 h-[4px] w-[4px] -translate-y-1/2 rounded-full" style={{ background: dot, boxShadow: '0 0 0 1px rgb(var(--panel) / 0.7)' }} />}
      {/* the chip keeps the leading edge; the dot and the mark stand beside the figure (2026-10-12 — a star and a
          dot pushed to the far edge "don't look well") */}
      {badge && <span className="mr-auto flex shrink-0 items-center">{badge}</span>}
      {dot && dotBeside && <span aria-hidden className="h-[4px] w-[4px] shrink-0 rounded-full" style={{ background: dot, boxShadow: '0 0 0 1px rgb(var(--panel) / 0.7)' }} />}
      {marker && <span className="flex shrink-0 items-center">{marker}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
};

/* MEMOISED (2026-09-06, the perf sweep): a calendar is eight hundred of these,
   and a tick that changes one column re-rendered every one of them — the
   ramp lookup and the style object for each. A cell whose value, scale and
   words are the same is the same pill. */
export default memo(HeatPill);

/*
  A RUN OF QUIET STRIKES, FOLDED.

  The reference collapses contiguous rows that carry nothing into a single
  line saying how many went. That is worth copying for a reason beyond space:
  a chain is mostly empty away from the money, and rendering forty near-zero
  rows at full height buries the dozen that matter inside a wall of almost-
  black. Folding them keeps the surface honest about where the book actually
  is, and says the count out loud so nothing is silently dropped.
*/
export const HiddenStrikes = ({ count, cols }: { count: number; cols?: number }) => (
  <div
    className="flex items-center gap-2 border-y border-dashed border-borderSubtle/50 px-2 py-[3px] font-mono text-[11px] uppercase tracking-wider text-textMuted"
    {...(cols ? { style: { gridColumn: `span ${cols}` } } : null)}
  >
    <span aria-hidden className="text-textMuted/60">
      ··
    </span>
    {count} {count === 1 ? 'strike' : 'strikes'} hidden
  </div>
);
