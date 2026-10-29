/* A small grouped bar chart in plain SVG: nice ticks on the left, faint horizontal grid, dashed reference lines and a
   hover band with a card. */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface BarSeries {
  values: (number | null)[];
  width: number;
  fill: (i: number) => string;
  opacity?: (i: number) => number;
}
export interface RefLine {
  y: number;
  stroke: string;
  dash?: string;
}
interface Props {
  labels: string[];
  series: BarSeries[];
  refs?: RefLine[];
  tickFormat: (v: number) => string;
  tip: (i: number) => ReactNode;
  testId?: string;
}

const M = { top: 4, right: 8, bottom: 20, left: 48 };
const GAP = 2;
const RADIUS = 2;

/** About five round steps over the range, always spanning zero */
function niceTicks(lo: number, hi: number): number[] {
  const min = Math.min(0, lo);
  const max = Math.max(0, hi);
  const span = max - min || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** A bar with its outer end rounded: the top above zero, the bottom below it */
const barPath = (x: number, w: number, y0: number, y1: number): string => {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  const r = Math.min(RADIUS, h / 2, w / 2);
  if (h < 0.5) return '';
  if (y1 <= y0)
    return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
  return `M${x},${top}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + w - r}Q${x + w},${top + h} ${x + w},${top + h - r}V${top}Z`;
};

export default function BarsChart({ labels, series, refs = [], tickFormat, tip, testId }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const all = [...series.flatMap(s => s.values.filter((v): v is number => v != null && Number.isFinite(v))), ...refs.map(r => r.y)];
  const ticks = niceTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const pw = Math.max(0, size.w - M.left - M.right);
  const ph = Math.max(0, size.h - M.top - M.bottom);
  const y = (v: number) => M.top + (hi === lo ? ph : ((hi - v) / (hi - lo)) * ph);
  const band = n ? pw / n : 0;
  const groupW = series.reduce((a, s) => a + s.width, 0) + GAP * Math.max(0, series.length - 1);

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left - M.left) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div ref={box} className="relative h-full w-full" data-bars={testId}>
      {size.w > 0 && (
        <svg width={size.w} height={size.h} className="block font-mono" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={M.left + pw} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.05)" />
              <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="rgb(var(--text-secondary))">
                {tickFormat(t)}
              </text>
            </g>
          ))}
          {hover != null && <rect x={M.left + hover * band} y={M.top} width={band} height={ph} fill="rgba(255,255,255,0.04)" />}
          {labels.map((l, i) => {
            let x = M.left + i * band + (band - groupW) / 2;
            return (
              <g key={l + i}>
                {series.map((s, k) => {
                  const v = s.values[i];
                  const at = x;
                  x += s.width + GAP;
                  if (v == null || !Number.isFinite(v)) return null;
                  const d = barPath(at, s.width, y(0), y(v));
                  return d ? <path key={k} d={d} fill={s.fill(i)} fillOpacity={s.opacity?.(i) ?? 1} /> : null;
                })}
                <text x={M.left + i * band + band / 2} y={size.h - 6} textAnchor="middle" fontSize={10} fill="rgb(var(--text-secondary))">
                  {l}
                </text>
              </g>
            );
          })}
          {refs.map((r, i) => (
            <line key={i} x1={M.left} x2={M.left + pw} y1={y(r.y)} y2={y(r.y)} stroke={r.stroke} strokeDasharray={r.dash} />
          ))}
        </svg>
      )}
      {hover != null && (
        <div className="pointer-events-none absolute z-10 top-1" style={{ left: Math.min(M.left + (hover + 1) * band + 6, Math.max(0, size.w - 150)) }}>
          {tip(hover)}
        </div>
      )}
    </div>
  );
}
