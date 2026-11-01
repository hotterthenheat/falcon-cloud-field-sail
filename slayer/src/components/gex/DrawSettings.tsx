/* A drawing's settings (TradingView's dialog, our own look): Style, Text, Coordinates, Visibility. Opened from the
   floating mark bar's gear; every change lands at once and is stored with the mark (StrikeChart's updateSelected). */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { isWordsKind, usesPts, type Drawing, type DrawingPoint, type DrawingsPrimitive } from './drawingsPrimitive';
import { drawToolLabel } from './drawTools';

type Tab = 'style' | 'text' | 'coords' | 'vis';

/* the mark bar's twenty inks, so the two pickers agree */
const INKS = [
  '#0A0A0A', '#FFFFFF', '#C7D3E8', '#9CA3AF', '#64748B',
  '#FF3B30', '#FF6B4A', '#FF9500', '#F5C542', '#FFE08A',
  '#D2FF00', '#30D158', '#2DD4BF', '#3DD6E8', '#7DD3FC',
  '#5B9CF6', '#6366F1', '#A78BFA', '#EA00FF', '#FF5EA8',
];

const etWords = (sec: number): string =>
  new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

interface Props {
  mark: Drawing;
  timeframe: string;
  prim: DrawingsPrimitive;
  onChange: (patch: Partial<Drawing>) => void;
  onClose: () => void;
}

const DrawSettings = ({ mark, timeframe, prim, onChange, onClose }: Props) => {
  const [tab, setTab] = useState<Tab>('style');
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const words = isWordsKind(mark.kind);
  /* the anchors the Coordinates tab lists: the run's points, or p1 · p2 · p3 */
  const anchors: { name: string; get: DrawingPoint; set: (q: DrawingPoint) => Partial<Drawing> }[] = usesPts(mark.kind) && mark.pts
    ? mark.pts.map((q, i) => ({
        name: `Point ${i + 1}`,
        get: q,
        set: (n: DrawingPoint) => {
          const pts = mark.pts!.map((o, k) => (k === i ? n : o));
          return { pts, p1: pts[0] };
        },
      }))
    : ([
        { name: 'Point 1', get: mark.p1, set: (n: DrawingPoint) => ({ p1: n }) },
        mark.p2 && { name: 'Point 2', get: mark.p2, set: (n: DrawingPoint) => ({ p2: n }) },
        mark.p3 && { name: 'Point 3', get: mark.p3, set: (n: DrawingPoint) => ({ p3: n }) },
      ].filter(Boolean) as { name: string; get: DrawingPoint; set: (q: DrawingPoint) => Partial<Drawing> }[]);
  const stepBar = (q: DrawingPoint, k: number): DrawingPoint => {
    const i = prim.barIndexOf(q.time);
    const t = i === null ? null : prim.timeAtBarIndex(i + k);
    return t === null ? q : { ...q, time: t };
  };

  const tabBtn = (id: Tab, name: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`h-8 px-3 text-t12 border-b-2 transition-colors ${tab === id ? 'border-select text-textPrimary font-semibold' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
      data-draw-settings-tab={id}
    >
      {name}
    </button>
  );
  const row = 'flex items-center justify-between gap-3 py-1.5';
  const lab = 'text-t12 text-textSecondary';
  const seg = (on: boolean) => `h-7 px-2.5 rounded text-t11 transition-colors ${on ? 'bg-select/15 text-select' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${drawToolLabel(mark.kind)} settings`}
      data-chart-rail
      data-draw-settings
      className="absolute z-50 left-1/2 top-12 -translate-x-1/2 w-[340px] max-w-[calc(100%-16px)] max-h-[calc(100%-64px)] flex flex-col rounded-lg border border-borderMuted bg-panel/95 backdrop-blur-md shadow-2xl shadow-black/60 select-none animate-fade-in"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2.5">
        <span className="text-t13 font-semibold text-textPrimary truncate">{drawToolLabel(mark.kind)}</span>
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div role="tablist" className="shrink-0 flex px-1.5 border-b border-borderMuted">
        {tabBtn('style', 'Style')}
        {tabBtn('text', 'Text')}
        {tabBtn('coords', 'Coordinates')}
        {tabBtn('vis', 'Visibility')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tab === 'style' && (
          <>
            <div className="py-1.5">
              <div className={`${lab} pb-1.5`}>Line colour</div>
              <div className="grid grid-cols-[repeat(10,22px)] gap-1">
                {INKS.map(c => (
                  <button key={c} type="button" title={c} aria-label={`Ink ${c}`} onClick={() => onChange({ color: c })} className={`w-[22px] h-[22px] rounded-full border ${mark.color === c ? 'border-select ring-1 ring-select' : 'border-ink/20'}`} style={{ background: c }} />
                ))}
              </div>
              <button type="button" onClick={() => onChange({ color: undefined })} className="mt-1.5 text-t11 text-textMuted hover:text-textPrimary">
                Back to the chart's own ink
              </button>
            </div>
            <div className={row}>
              <span className={lab}>{words ? 'Text size' : 'Line weight'}</span>
              <span className="flex gap-0.5">
                {[1, 2, 3, 4].map(w => (
                  <button key={w} type="button" onClick={() => onChange({ width: w })} className={seg((mark.width ?? 2) === w)}>
                    {words ? ['S', 'M', 'L', 'XL'][w - 1] : `${w}px`}
                  </button>
                ))}
              </span>
            </div>
            {!words && (
              <div className={row}>
                <span className={lab}>Line style</span>
                <span className="flex gap-0.5">
                  {(['solid', 'dashed', 'dotted'] as const).map(st => (
                    <button key={st} type="button" onClick={() => onChange({ style: st })} className={seg((mark.style ?? 'solid') === st)} title={st}>
                      <span className="inline-block w-6 border-t-2 border-current align-middle" style={{ borderTopStyle: st }} />
                    </button>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
        {tab === 'text' && (
          <>
            <label className="block py-1.5">
              <span className={`${lab} block pb-1`}>{words ? 'Words' : 'Caption — printed beside the mark'}</span>
              <input
                type="text"
                maxLength={80}
                defaultValue={mark.text ?? ''}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => {
                  const v = e.target.value;
                  /* a words mark cannot be emptied — its words are what it is */
                  if (words && !v.trim()) return;
                  onChange({ text: v.trim() ? v : undefined });
                }}
                className="w-full h-8 px-2 rounded border border-borderSubtle bg-chip font-mono text-t12 text-textPrimary outline-none focus:border-silver/50"
                data-draw-settings-text
              />
            </label>
            <div className="py-1.5">
              <div className={`${lab} pb-1.5`}>Text colour</div>
              <div className="grid grid-cols-[repeat(10,22px)] gap-1">
                {INKS.map(c => (
                  <button key={c} type="button" title={c} aria-label={`Text ink ${c}`} onClick={() => onChange({ textColor: c })} className={`w-[22px] h-[22px] rounded-full border ${mark.textColor === c ? 'border-select ring-1 ring-select' : 'border-ink/20'}`} style={{ background: c }} />
                ))}
              </div>
            </div>
          </>
        )}
        {tab === 'coords' && (
          <div className="divide-y divide-borderMuted">
            {anchors.map(a => (
              <div key={a.name} className="py-2">
                <div className="text-t11 text-textMuted pb-1">{a.name}</div>
                <div className={row}>
                  <span className={lab}>Price</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={a.get.price.toFixed(2)}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v) && v > 0) onChange(a.set({ ...a.get, price: v }));
                    }}
                    className="w-28 h-7 px-2 rounded border border-borderSubtle bg-chip font-mono text-t12 tnum text-right text-textPrimary outline-none focus:border-silver/50"
                  />
                </div>
                <div className={row}>
                  <span className={lab}>Bar</span>
                  <span className="flex items-center gap-1">
                    <button type="button" title="One bar earlier" aria-label="One bar earlier" onClick={() => onChange(a.set(stepBar(a.get, -1)))} className={seg(false)}>
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <span className="font-mono text-t11 tnum text-textPrimary whitespace-nowrap">{etWords(a.get.time)}</span>
                    <button type="button" title="One bar later" aria-label="One bar later" onClick={() => onChange(a.set(stepBar(a.get, 1)))} className={seg(false)}>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'vis' && (
          <>
            <label className={`${row} cursor-pointer`}>
              <span className={lab}>Show on the chart</span>
              <input type="checkbox" checked={!mark.hidden} onChange={e => onChange({ hidden: e.target.checked ? undefined : true })} data-draw-settings-shown />
            </label>
            <div className="py-1.5">
              <div className={`${lab} pb-1.5`}>Timeframes</div>
              <div className="flex gap-1">
                <button type="button" onClick={() => onChange({ tf: undefined })} className={seg(!mark.tf)}>
                  Every timeframe
                </button>
                <button type="button" onClick={() => onChange({ tf: timeframe })} className={seg(!!mark.tf)}>
                  Only {mark.tf ?? timeframe}
                </button>
              </div>
              <p className="pt-2 text-t11 leading-snug text-textMuted">A mark kept to one timeframe stays stored; it shows again when the chart is back on that timeframe.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DrawSettings;
