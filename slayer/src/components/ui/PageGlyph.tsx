/*
==================================================
  SLAYER TERMINAL - A PAGE'S ICON
  (components/ui/PageGlyph.tsx)

  The icons Noah's partner had drawn for the rooms of
  the terminal, in our clothes (Noah, 2026-10-01: "i
  need you to incoperate the icons he has for the
  different pages but making them smaller, his look a
  bit too large"). The outlines are his
  (glyphPaths.ts); what is ours:

    BARE      no tile, no brackets, no ">" — the icon
              alone on whatever ground it stands on
    SMALL     it sits at the size of the words beside
              it (14 to 18px in a row, never the 26 to
              44 his pages drew it at)
    OUR INKS  the body is the house's foil — silver on
              black, the galaxy ink on paper (tokens
              --glyph-1…5, which follow the ground the
              icon stands on) — and its one coloured
              part is the room's own ink from the rail
              (layout/nav.ts NAV_INK)

  The gaps an icon cuts (round a dot, under a pencil)
  are cut through with a mask, not painted in a
  ground's colour, so it is right on any ground.
  Nothing here moves.
==================================================
*/

import { useId, type ReactNode } from 'react';
import { NAV_INK } from '../layout/nav';
import { GLYPH_DRAW, type GlyphDraw, type GlyphName, type GlyphPart } from './glyphPaths';

export type { GlyphName };

/** each icon's one coloured part — the room's ink on the rail */
const INK: Record<GlyphName, string> = {
  pulse: NAV_INK.pulse,
  terrain: NAV_INK.terrain,
  trace: NAV_INK.trace,
  dossier: NAV_INK.record,
  pinpoint: NAV_INK.pinpoint,
  compass: NAV_INK.compass,
  weigher: NAV_INK.weigher,
  practice: NAV_INK.paperDesk,
  paper: NAV_INK.paperDesk,
  backtest: NAV_INK.backtest,
  journal: NAV_INK.journal,
  community: NAV_INK.community,
  alerts: NAV_INK.alerts,
};

/* the body's quieter runs: dotted guides, ticks, a wedge */
const TONE: Record<NonNullable<GlyphPart['t']>, number> = { dim: 0.5, mid: 0.78, shade: 0.22 };

interface Props {
  name: GlyphName;
  /** the box's side, px */
  size: number;
  className?: string;
  /** an accessible name; decorative when left out */
  label?: string;
}

const PageGlyph = ({ name, size, className, label }: Props) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const draw: GlyphDraw = GLYPH_DRAW[name];
  const [x0, y0, x1, y1] = draw.box;
  /* the icon centred in a square a breath larger than itself */
  const side = Math.max(x1 - x0, y1 - y0) * 1.04;
  const vx = (x0 + x1) / 2 - side / 2;
  const vy = (y0 + y1) / 2 - side / 2;
  const foil = `${uid}f`;

  /* THE CUTS: a gap cuts what was drawn BEFORE it, never what comes after (a dot laid over its own cut-out ring). So the
     parts are drawn in runs, and each run of cuts masks everything drawn up to it. */
  const runs: { parts: GlyphPart[]; cuts: GlyphPart[] }[] = [{ parts: [], cuts: [] }];
  for (const p of draw.parts) {
    const last = runs[runs.length - 1];
    if (p.r === 'x') last.cuts.push(p);
    else if (last.cuts.length) runs.push({ parts: [p], cuts: [] });
    else last.parts.push(p);
  }

  const shape = (p: GlyphPart, i: number, paint: string, opacity?: number) =>
    p.w != null ? (
      <path key={i} d={p.d} fill="none" stroke={paint} strokeWidth={p.w} strokeLinejoin={p.j ?? 'miter'} strokeLinecap={p.cap ?? 'butt'} opacity={opacity} />
    ) : (
      <path key={i} d={p.d} fill={paint} opacity={opacity} />
    );

  let body: ReactNode = null;
  const masks: ReactNode[] = [];
  runs.forEach((run, ri) => {
    const drawn = (
      <>
        {body}
        {run.parts.map((p, i) => shape(p, i, p.r === 'i' ? INK[name] : `url(#${foil})`, p.t ? TONE[p.t] : undefined))}
      </>
    );
    if (!run.cuts.length) {
      body = drawn;
      return;
    }
    const id = `${uid}m${ri}`;
    masks.push(
      <mask key={id} id={id} maskUnits="userSpaceOnUse" x={vx} y={vy} width={side} height={side}>
        <rect x={vx} y={vy} width={side} height={side} fill="#fff" />
        {run.cuts.map((p, i) => shape(p, i, '#000'))}
      </mask>
    );
    body = <g mask={`url(#${id})`}>{drawn}</g>;
  });

  return (
    <svg width={size} height={size} viewBox={`${vx} ${vy} ${side} ${side}`} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false" data-page-glyph={name}>
      <defs>
        <linearGradient id={foil} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
          <stop offset="0" style={{ stopColor: 'rgb(var(--glyph-1))' }} />
          <stop offset="0.3" style={{ stopColor: 'rgb(var(--glyph-2))' }} />
          <stop offset="0.55" style={{ stopColor: 'rgb(var(--glyph-3))' }} />
          <stop offset="0.75" style={{ stopColor: 'rgb(var(--glyph-4))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--glyph-5))' }} />
        </linearGradient>
        {masks}
      </defs>
      {body}
    </svg>
  );
};

export default PageGlyph;
