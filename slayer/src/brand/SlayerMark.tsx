/* The mark ">S|": a still SVG, the S as a mask over a sliding foil strip (compositor transform) and an opacity cursor,
   all on brandClock.ts so nothing repaints. Under 64 px only the S| shows; `bare` drops the tile. */

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { MARK, MARK_CONTENT } from './paths';
import { useMarkState, type MarkState } from './markState';
import { alignBrandLoops } from './brandClock';

interface SlayerMarkProps {
  /** the box's side, px */
  size: number;
  /** the state to show — the terminal's own when left out */
  state?: MarkState;
  /** no tile: the S| alone */
  bare?: boolean;
  /** bare, but with the ">" — ">S|", the folded rail */
  prompt?: boolean;
  /** brighten the S when the pointer comes within 80 px */
  near?: boolean;
  className?: string;
  /** The accessible name, "Slayer Terminal" by default; an empty string makes the mark decorative. */
  label?: string;
}

type Box = { x: number; y: number; side: number };

const boxFor = (size: number, bare: boolean, prompt: boolean): Box => {
  if (!bare && size >= 64) return { x: 0, y: 0, side: 64 };
  /* room under the S: a box ending on the stroke clipped the last row at 26 px */
  const x0 = prompt ? 9.5 : MARK_CONTENT.x0 - 2;
  const y0 = MARK_CONTENT.y0 - 3;
  const x1 = MARK_CONTENT.x1 + 3;
  const y1 = MARK_CONTENT.y1 + 5;
  const w = x1 - x0;
  const h = y1 - y0;
  const side = Math.max(w, h);
  return { x: x0 - (side - w) / 2, y: y0 - (side - h) / 2, side };
};

/** a rectangle in tile units, as percentages of the box */
const place = (b: Box, x: number, y: number, w: number, h: number): CSSProperties => ({
  left: `${((x - b.x) / b.side) * 100}%`,
  top: `${((y - b.y) / b.side) * 100}%`,
  width: `${(w / b.side) * 100}%`,
  height: `${(h / b.side) * 100}%`,
});

/* The S outline as a mask image, built once, with a margin round its box: an edge landing mid-pixel clipped the
   S's last row flat. */
const S_PAD = 3;
const [sx0, sy0, sx1, sy1] = MARK.sBox;
const S_BOX = [sx0 - S_PAD, sy0 - S_PAD, sx1 - sx0 + S_PAD * 2, sy1 - sy0 + S_PAD * 2] as const;
const S_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${S_BOX.join(' ')}" preserveAspectRatio="none"><path d="${MARK.s}"/></svg>`
)}")`;

/* one pointer listener for every mark that asked for `near`, rect reads batched per frame */
const nearMarks = new Set<HTMLElement>();
let nearFrame = 0;
let lastPointer: { x: number; y: number } | null = null;
const NEAR_PX = 80;
const checkNear = () => {
  nearFrame = 0;
  if (!lastPointer) return;
  const { x, y } = lastPointer;
  nearMarks.forEach(el => {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const near = dx * dx + dy * dy <= NEAR_PX * NEAR_PX && r.width > 0;
    if (near !== el.hasAttribute('data-near')) el.toggleAttribute('data-near', near);
  });
};
const onPointer = (e: PointerEvent) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (!nearFrame) nearFrame = requestAnimationFrame(checkNear);
};
const watchNear = (el: HTMLElement) => {
  nearMarks.add(el);
  if (nearMarks.size === 1) window.addEventListener('pointermove', onPointer, { passive: true });
  return () => {
    nearMarks.delete(el);
    el.removeAttribute('data-near');
    if (nearMarks.size === 0) {
      window.removeEventListener('pointermove', onPointer);
      if (nearFrame) cancelAnimationFrame(nearFrame);
      nearFrame = 0;
    }
  };
};

/** The mark with the terminal's own state. */
const LiveMark = (props: Omit<SlayerMarkProps, 'state'>) => {
  const state = useMarkState();
  return <MarkFace {...props} state={state} />;
};

/** The mark: the terminal's state unless one is given. */
const SlayerMark = (props: SlayerMarkProps) => (props.state ? <MarkFace {...props} state={props.state} /> : <LiveMark {...props} />);

const MarkFace = ({ size, state, bare = false, prompt = false, near = false, className = '', label }: SlayerMarkProps & { state: MarkState }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!near || !ref.current) return;
    return watchNear(ref.current);
  }, [near]);
  /* align to the brand clock on mount and whenever the state changes the loops */
  useLayoutEffect(() => {
    alignBrandLoops(ref.current);
  }, [state]);

  const b = boxFor(size, bare, prompt);
  const full = !bare && size >= 64;
  const radius = full ? 3 : b.side * 0.075;
  const [cx, cy, cw, ch] = MARK.cursor;
  const name = label ?? 'Slayer Terminal';
  return (
    <span
      ref={ref}
      className={`slayer-mark ${className}`}
      data-state={state}
      data-mark-size={full ? 'full' : bare ? 'bare' : 'small'}
      style={{ width: size, height: size }}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      data-brand-mark
    >
      <svg viewBox={`${b.x} ${b.y} ${b.side} ${b.side}`} aria-hidden focusable="false">
        {!bare && (
          <>
            <rect x={b.x} y={b.y} width={b.side} height={b.side} rx={radius} style={{ fill: 'rgb(var(--tile))' }} />
            <rect
              x={b.x + 0.4}
              y={b.y + 0.4}
              width={b.side - 0.8}
              height={b.side - 0.8}
              rx={Math.max(0, radius - 0.4)}
              style={{ fill: 'none', stroke: 'rgb(var(--tile-edge))', strokeWidth: 0.8 }}
            />
          </>
        )}
        {full && <path d={MARK.brackets} style={{ fill: 'none', stroke: 'rgb(var(--bracket))', strokeWidth: 0.7 }} />}
        {(full || prompt) && <path d={MARK.chevron} style={{ fill: 'rgb(var(--chevron))' }} />}
      </svg>
      <span className="sm-s" style={{ ...place(b, S_BOX[0], S_BOX[1], S_BOX[2], S_BOX[3]), WebkitMaskImage: S_MASK, maskImage: S_MASK }} aria-hidden>
        <span className="sm-foil" />
      </span>
      <span className="sm-cursor" style={place(b, cx, cy, cw, ch)} aria-hidden />
      <span className="sm-cursor sm-cursor-warn" style={place(b, cx, cy, cw, ch)} aria-hidden />
    </span>
  );
};

export default SlayerMark;
