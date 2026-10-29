import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HoverReadoutProps {
  /** Cursor client X/Y — the card floats just off the pointer and stays on-screen. */
  x: number;
  y: number;
  children: ReactNode;
}

const GAP = 14;
const EDGE = 8;

/** The floating hover card: pointer-transparent, portalled to <body> (a transformed ancestor would anchor `fixed`),
    clamped to the viewport and flipped when out of room. */
const HoverReadout = ({ x, y, children }: HoverReadoutProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 240, h: 130 });
  /* translucent glass that fades in; once placed, a change of anchor glides on the house curve (armed a frame after
     mount, so the first placement never slides) */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [children]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

  const flipX = x + GAP + size.w > vw - EDGE;
  const flipY = y + GAP + size.h > vh - EDGE;
  const left = Math.max(EDGE, flipX ? x - GAP - size.w : x + GAP);
  const top = Math.max(EDGE, flipY ? y - GAP - size.h : y + GAP);

  return createPortal(
    <div
      ref={ref}
      /* z-[90]: above the fullscreen takeovers (z-[80]) */
      className="pointer-events-none fixed z-[90] max-w-[320px] rounded-lg border border-borderMuted/80 bg-card/80 backdrop-blur-md backdrop-saturate-150 px-3 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.75),0_4px_10px_-6px_rgba(0,0,0,0.55)] animate-soft-in motion-reduce:transition-none"
      style={{ left, top, transition: settled ? 'left 180ms cubic-bezier(0.16,1,0.3,1), top 180ms cubic-bezier(0.16,1,0.3,1)' : 'none' }}
      data-hover-readout
    >
      {children}
    </div>,
    document.body
  );
};

export default HoverReadout;
