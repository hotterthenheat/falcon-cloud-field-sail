/* Scripts on a pane, listed top left as TradingView does: name, inputs, its plots' values in their own ink (the bar under
   the crosshair, else the last bar), eye and ×; a hidden one stays dimmed.
   It sits 4 px under the lowest `data-chart-chrome` block over the chart's upper third, and its whole box takes the pointer so it cannot jitter. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import type { IChartApi } from 'lightweight-charts';
import { liftFromPane, updateOnPane, type PaneScript } from '../../data/paneScripts';
import type { RunResult } from '../../core/pine';

/** A script's last run and the bar times it ran over (the chart's own clock) */
export interface ScriptRun {
  result: RunResult;
  times: number[];
}

/** The bar at or before `t` */
const barAt = (times: number[], t: number): number => {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t < times[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const fmt = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(a >= 1 || a === 0 ? 2 : 4);
};

/** The drawn plots' values at bar `i` (the last bar when i is null), each in the ink it is drawn in there */
const valuesAt = (run: ScriptRun | undefined, at: number | null): { v: string; ink: string; title: string }[] => {
  if (!run) return [];
  const n = run.times.length;
  const i = at == null ? n - 1 : at;
  return run.result.plots
    .filter(p => !p.hidden)
    .slice(0, 5)
    .map(p => {
      const k = i - p.offset;
      const v = k >= 0 && k < p.values.length ? p.values[k] : NaN;
      return { v: Number.isFinite(v) ? fmt(v) : '∅', ink: (k >= 0 && p.colors?.[k]) || p.ink, title: p.title };
    });
};

const summary = (ps: PaneScript): string =>
  (ps.script.meta?.inputs ?? [])
    .map(i => ps.chart.inputs[i.id] ?? i.default)
    .filter(v => typeof v === 'number' || (typeof v === 'string' && !v.startsWith('#')))
    .slice(0, 6)
    .join(' ');

/** Pixels from the chart box's top to just under the host's floating chrome,
    and the chrome blocks that decided it (so they can be watched) */
const clearance = (root: HTMLElement): { top: number; chrome: HTMLElement[] } => {
  const box = root.parentElement?.getBoundingClientRect();
  if (!box || box.height === 0) return { top: 8, chrome: [] };
  let low = 0;
  const chrome: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>('[data-chart-chrome]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const overlaps = r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.top + box.height / 3;
    if (!overlaps) return;
    low = Math.max(low, r.bottom - box.top);
    chrome.push(el);
  });
  return { top: Math.max(8, Math.round(low) + 4), chrome };
};

const ScriptLegend = ({ paneId, scripts, chart, runOf, tick }: { paneId: string; scripts: PaneScript[]; chart?: () => IChartApi | null; runOf?: (chartId: string) => ScriptRun | undefined; tick?: string | number }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(8);
  /* the crosshair's time, or null for the last bar */
  const [hoverT, setHoverT] = useState<number | null>(null);
  useEffect(() => {
    const c = chart?.();
    if (!c) return;
    const fn = (p: { time?: unknown }) => setHoverT(typeof p.time === 'number' ? p.time : null);
    c.subscribeCrosshairMove(fn);
    return () => {
      try {
        c.unsubscribeCrosshairMove(fn);
      } catch {
        /* chart already gone */
      }
    };
  }, [chart, tick]);
  /* Measured after every render, on the chart's resize, and when a chrome block itself resizes. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const { top: next, chrome } = clearance(root);
      setTop(t => (next === t ? t : next));
      return chrome;
    };
    const chrome = measure();
    const box = root.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    chrome.forEach(el => ro.observe(el));
    return () => ro.disconnect();
  });
  return (
    <div
      ref={rootRef}
      /* It glides to its place (220 ms on `top`, retargeted by each measurement) as the chrome above changes height;
         the first placement is before paint, so nothing glides in on mount. */
      style={{ top, transition: 'top 220ms cubic-bezier(0.45, 0, 0.25, 1)' }}
      className="absolute left-3 z-10 flex flex-col items-start gap-[3px] pointer-events-auto select-none"
      aria-label="Scripts on this pane"
      data-script-legend
    >
      {scripts.map(ps => {
        const on = ps.chart.visible;
        const broken = ps.script.status !== 'ok';
        return (
          <div
            key={ps.chart.id}
            className="group pointer-events-auto inline-flex items-center gap-1.5 h-[20px] pl-1.5 pr-1 rounded bg-canvas/75 backdrop-blur-[2px] font-mono text-t105 leading-none"
            data-legend-row={ps.script.id}
            data-hidden={!on || undefined}
          >
            <span className={`whitespace-nowrap ${on && !broken ? 'text-textPrimary' : 'text-textMuted'}`}>{ps.script.title}</span>
            {summary(ps) && <span className="text-textMuted whitespace-nowrap tnum">{summary(ps)}</span>}
            {on &&
              !broken &&
              (() => {
                const run = runOf?.(ps.chart.id);
                return valuesAt(run, run && hoverT != null ? barAt(run.times, hoverT) : null).map((x, k) => (
                  <span key={k} className="whitespace-nowrap tnum" style={{ color: x.ink }} title={x.title} data-legend-value>
                    {x.v}
                  </span>
                ));
              })()}
            {broken && <span className="text-bear text-t9 uppercase tracking-wider">does not read</span>}
            <span className="inline-flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => void updateOnPane(paneId, { ...ps.chart, visible: !on })}
                aria-pressed={!on}
                title={on ? 'Hide it — it stays on the pane' : 'Show it'}
                className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors"
                data-legend-eye
              >
                {on ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
              <button onClick={() => void liftFromPane(paneId, ps.chart.id)} title="Take it off this pane" className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors" data-legend-remove>
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default ScriptLegend;
