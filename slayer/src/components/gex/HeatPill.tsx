import { memo, type ReactNode } from 'react';
import { heatCellStyle, type HeatMode } from './heatmap';

/* One heat-surface cell as a capsule with air around it, so columns separate without rules and a quiet cell reads as quiet.
   The colour is the shared `heatCellStyle` ramp, unchanged. */

interface HeatPillProps {
  /** Signed value — decides both the pole and the intensity. */
  value: number;
  /** The scale this surface paints against. */
  maxAbs: number;
  /** What to print inside. Right-aligned, because a column of numbers is read
      down its last digit, not its first. */
  children: ReactNode;
  /** Ringed rather than recoloured: the fill is the value. */
  selected?: boolean;
  /** Override the ring's colour — the supreme strike wears the supreme magenta, not the
      selection lime, because it is a property of the BOOK rather than of what
      the reader clicked. */
  ringColor?: string;
  /** A mark at the leading edge — the supreme strike, a held position. Sits in its
      own lane so it never collides with the number. */
  marker?: ReactNode;
  /** A badge in the lane before the mark (the calendar's "since the open"), its own chip so its ink reads on every fill. */
  badge?: ReactNode;
  /** The same word as a dot in this ink: beside the figure when the column has room, else over the leading padding
      in no lane, so the narrowest column's figure keeps every glyph. */
  dot?: string;
  dotBeside?: boolean;
  /** Height of the capsule. The row owns its rhythm; this only fills it. */
  className?: string;
  /** The figure's size in px when the row is tall enough to earn more than the 10px default
      (the Ledger's rows share the panel's height — a 40px row prints 13px). */
  fontSize?: number;
  /** Another ramp for THIS surface only (the Ledger's thermal try) — the house ramp otherwise */
  mode?: HeatMode;
  /** Less side padding for a narrow cell: right-aligned, the figure keeps its 4 px on the right. */
  tight?: boolean;
  /** On paper (the light page): the tint ramp, a faint colour on the page's grey — the surface says so, never the pill
      itself, because the surfaces that stay dark islands on the light page keep the dark ramp */
  paper?: boolean;
  title?: string;
  onClick?: () => void;
}

/* The ring is the selection voice (lime), never a heat colour, drawn as a shadow so a pick never shifts neighbours. */
const SELECTION_INK = 'rgb(var(--select))';
/* Two rings, not one: the accent alone vanishes against the ramp's bright
   platinum pole, so a dark outer ring gives it an edge to sit on at both ends
   of the scale. Same trick the old supreme cell used. */
/* The ring stands outside the capsule so the figure's padding stays whole; the cells' 2 px of air holds it. */
const ring = (ink: string) => `0 0 0 1.5px ${ink}`;

/* The ink pair is fixed by heatmap.ts's contrast maths (≥4.11:1 at the crossover), so legibility comes from weight (bold)
   and a faint halo in the other ink under every glyph. */
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
      className={`relative flex min-w-0 items-center justify-end gap-1 rounded-full ${tight ? 'pl-px pr-1' : 'px-2'} font-mono text-t11 font-bold tnum leading-none transition-colors duration-700 ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {dot && !dotBeside && <span aria-hidden className="absolute left-[2px] top-1/2 h-[4px] w-[4px] -translate-y-1/2 rounded-full" style={{ background: dot, boxShadow: '0 0 0 1px rgb(var(--panel) / 0.7)' }} />}
      {/* The chip keeps the leading edge; the dot and the mark stand beside the figure. */}
      {badge && <span className="mr-auto flex shrink-0 items-center">{badge}</span>}
      {dot && dotBeside && <span aria-hidden className="h-[4px] w-[4px] shrink-0 rounded-full" style={{ background: dot, boxShadow: '0 0 0 1px rgb(var(--panel) / 0.7)' }} />}
      {marker && <span className="flex shrink-0 items-center">{marker}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
};

/* Memoised: a calendar is ~800 of these, and a tick that changes one column must not restyle them all. */
export default memo(HeatPill);

