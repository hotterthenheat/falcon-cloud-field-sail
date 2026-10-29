/* What a strike's net did over a window (a percent with its arrow, dollars from near zero, "steady"), shared by BookRead
   and Compare's Head to head; the windows read today's contracts off the minute grid (data/replay.ts). */

import { useEffect, useRef, useState } from 'react';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { CALL_WALL, PUT_WALL } from './paletteInk';

const MUTED = 'rgb(var(--text-muted))';
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`;

/** The windows a strike's change is read over — today's contracts, off the minute grid */
export const READ_WINDOWS: { key: string; min: number }[] = [
  { key: '1m', min: 1 },
  { key: '5m', min: 5 },
  { key: '15m', min: 15 },
  { key: '30m', min: 30 },
  { key: '1h', min: 60 },
  { key: '4h', min: 240 },
  { key: 'open', min: Infinity },
];

/* The figure glides to its new value over 360 ms, so a window change lands as a slide. */
const GLIDE_MS = 360;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const useGlide = (target: number | null): number | null => {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    const start = from.current;
    if (target == null || start == null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }
    if (start === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      const v = start + (target - start) * easeOutCubic(t);
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
};

/** ▲ 358% grew, ▼ 51% shrank, dollars when it was next to nothing then. `quiet`: only the glyph takes the direction's ink. */
export const Change = ({ now, then, quiet = false }: { now: number; then: number | null; quiet?: boolean }) => {
  /* the figure and its kind, then the figure glides */
  const kind: 'none' | 'steady' | 'dollars' | 'pct' =
    then == null ? 'none'
    : Math.abs(then) < 1e6 ? (Math.abs(now - then) < 1e6 ? 'steady' : 'dollars')
    : 'pct';
  const target = kind === 'pct' ? ((Math.abs(now) - Math.abs(then!)) / Math.abs(then!)) * 100 : kind === 'dollars' ? now - then! : null;
  const v = useGlide(target);
  if (kind === 'none') return <span style={{ color: MUTED }}>—</span>;
  if (kind === 'steady' || v == null) return <span style={{ color: MUTED }}>steady</span>;
  const grew = v >= 0;
  const ink = grew ? CALL_WALL : PUT_WALL;
  if (kind === 'pct' && Math.abs(v) < 1) return <span style={{ color: MUTED }}>steady</span>;
  const figure = kind === 'dollars' ? fmtUsd(Math.abs(v)) : pct(v).replace(/^[+−]/, '');
  return (
    <span style={quiet ? undefined : { color: ink }}>
      <span style={{ color: ink }}>{grew ? '▲' : '▼'}</span> {figure}
    </span>
  );
};
