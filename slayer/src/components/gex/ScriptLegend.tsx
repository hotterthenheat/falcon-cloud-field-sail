/* Scripts on a pane, listed top left as TradingView does: name, inputs, eye and ×; a hidden one stays dimmed.
   It sits 4 px under the lowest `data-chart-chrome` block over the chart's upper third, and its whole box takes the pointer so it cannot jitter. */

import { useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { liftFromPane, updateOnPane, type PaneScript } from '../../data/paneScripts';

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

const ScriptLegend = ({ paneId, scripts }: { paneId: string; scripts: PaneScript[] }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(8);
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
            {broken && <span className="text-bear text-t9 uppercase tracking-wider">does not read</span>}
            <span className={`inline-flex items-center gap-0.5 ${on ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
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
