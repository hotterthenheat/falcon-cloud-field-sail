/*
==================================================
  SLAYER TERMINAL - THE POINTER CARD (components/ui/PointerCard.tsx)

  The Building page's hover card, made one piece so
  every surface can wear it the same way (Noah,
  2026-09-12, on the book ladder: "use the same
  method for the translucent hover card you did for
  the building page… right now they do not function
  the same"): small, translucent glass, beside the
  pointer and moving WITH it, never in its way,
  flipping to the pointer's other side at the right
  edge and riding up when it would run off the
  bottom; a head (the strike in silver, its part, a
  word at the right) over a two-column grid of
  label · value with a small sub. Portalled to
  <body> so a transformed ancestor never traps it.

  ONE MOUNTED ELEMENT PER HOVER — the card's fade-in
  runs once, when it appears; a host that remounted
  it on every pointer move (a component defined
  inside the host's render) restarted the fade sixty
  times a second and the card never got past a third
  of its opacity (Noah, 2026-09-12: "it lacks
  smoothness… gets stuck and glitches/spazzes out").
  `PointerFollowCard` is the host-proof shape: the
  host names where the pointer WAS when the card
  appeared, and the card tracks the pointer itself
  from there, so the host never re-renders on a move.
==================================================
*/

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SILVER = 'rgb(var(--silver))';
const GAP = 14;
const LIFT = 12;
const EDGE = 8;

interface PointerCardProps {
  /** The pointer's client position — the card sits 14px to its right (or left, at the edge), its foot 12px above it */
  x: number;
  y: number;
  width?: number;
  /** The head's left: the strike (in silver) and its part */
  title: ReactNode;
  /** The head's right, muted */
  aside?: ReactNode;
  children: ReactNode;
  /** A line under the grid — the calendar's verdict sentence, a kept card's words (2026-10-12) */
  foot?: ReactNode;
  /** Sits still, for a kept card: no fade-in a second time, pointer events on, no "pointer-events-none" */
  still?: boolean;
  testId?: string;
  testValue?: string | number;
  /** A bit smaller — tighter padding and rows (the Map's grids; the owner, 2026-10-14) */
  dense?: boolean;
}

/** How a kept card is let go, in the hand's own words (the paying-user audit's M11): a tap on a phone, a click or Esc
    at a desk */
export const letGoWords = (): string => (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(hover: none)').matches ? 'tap to let go' : 'click or Esc to let go');

/** One line of the card: the label muted, the value right-aligned in its ink, a small sub after it */
export const CardRow = ({ k, v, sub, ink }: { k: string; v: ReactNode; sub?: ReactNode; ink?: string }) => (
  <>
    <span className="text-textMuted whitespace-nowrap">{k}</span>
    <span className="text-right font-mono text-[11px] tnum whitespace-nowrap" style={{ color: ink ?? 'rgb(var(--text-primary))' }}>
      {v}
      {sub != null && <span className="text-[11px] text-textMuted"> {sub}</span>}
    </span>
  </>
);

const PointerCard = ({ x, y, width = 196, title, aside, children, foot, still = false, testId = 'data-pointer-card', testValue = '', dense = false }: PointerCardProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const vw = typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth : null;
  const onRight = vw === null || x + GAP + width < vw - EDGE;
  /* NEVER OFF THE EDGE (the Map's re-audit H3, 2026-10-13): a card that could not sit to the right went left of the
     pointer by its whole width, and on a phone that was past the edge of the screen — the left 22px of every line cut.
     The card goes where it can and stops at the edge. */
  const wanted = onRight ? x + GAP : x - GAP - width;
  const left = vw === null ? wanted : Math.max(EDGE, Math.min(wanted, vw - EDGE - width));
  /* The card's own height decides where it stops at the bottom edge — measured
     before paint on every placement, so the card follows the pointer as far
     down as it can and never jumps to a guess */
  /* ABOVE THE POINTER, NEVER ON WHAT IT DESCRIBES (the paying-user audit's H5, 2026-10-13): the card hung from 12px
     over the pointer, so it lay on the rest of the row it was reading and the rows under it. Its foot now stands 12px
     over the pointer — the row, the cell and the column under the pointer stay in sight — and only where the head of
     the screen has no room does it drop to the same distance under it. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof globalThis.innerHeight !== 'number') return;
    const h = el.offsetHeight;
    const above = y - LIFT - h;
    const top = above >= EDGE ? above : Math.min(y + LIFT + 6, globalThis.innerHeight - EDGE - h);
    el.style.top = `${Math.max(EDGE, top)}px`;
  });
  return createPortal(
    <div
      ref={ref}
      className={`fixed z-[90] rounded-lg border bg-card/85 backdrop-blur-md ${dense ? 'px-2.5 py-2' : 'px-3 py-2.5'} shadow-[0_12px_32px_rgba(0,0,0,0.55)] pointer-events-none ${still ? 'border-silver/40' : 'border-borderMuted'}`}
      style={{ width, left, top: Math.max(EDGE, y - LIFT - 160) }}
      data-card-kept={still ? '' : undefined}
      {...{ [testId]: testValue }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] font-semibold tnum inline-flex items-baseline gap-1.5" style={{ color: SILVER }}>
          {title}
        </span>
        {aside != null && <span className="ml-auto text-[11px] text-textMuted whitespace-nowrap">{aside}</span>}
      </div>
      <div className={`${dense ? 'mt-1 gap-y-0.5' : 'mt-1.5 gap-y-1'} grid grid-cols-[auto_1fr] gap-x-3 text-[11px]`}>{children}</div>
      {foot != null && <div className={`${dense ? 'mt-1' : 'mt-1.5'} text-[11px] leading-snug`}>{foot}</div>}
    </div>,
    document.body
  );
};

interface PointerFollowCardProps extends Omit<PointerCardProps, 'x' | 'y'> {
  /** Where the pointer was when the card appeared — the card tracks it from here on its own */
  start: { x: number; y: number };
}

/** The card that follows the pointer by itself: mount it once per hover, change
    its content as the pointer crosses rows, and only the card re-renders on a
    move — the host's rows never do */
export const PointerFollowCard = ({ start, ...rest }: PointerFollowCardProps) => {
  const [pos, setPos] = useState(start);
  useEffect(() => {
    const onMove = (ev: PointerEvent) => setPos({ x: ev.clientX, y: ev.clientY });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return <PointerCard x={pos.x} y={pos.y} {...rest} />;
};

export default PointerCard;
