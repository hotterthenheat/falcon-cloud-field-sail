/* A drawing's settings (TradingView's dialog, our own look): Style, Inputs, Levels, Text, Coordinates, Visibility, and
   the Template menu at its foot. Opened from the floating mark bar's gear; every change lands at once and is stored
   with the mark (StrikeChart's updateSelected). The tables it edits are drawingLevels.ts. */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { isWordsKind, usesPts, type Drawing, type DrawingPoint, type DrawingsPrimitive } from './drawingsPrimitive';
import { drawToolLabel } from './drawTools';
import { DEFAULT_LEVELS, FORK_STYLES, KIND_OPTS, LEVEL_WORD, VIS_UNITS, gannName, levelSet, opt, tfUnit, type Level, type OptVal, type Vis } from './drawingLevels';
import { applyTemplate, deleteTemplate, saveTemplate, setDefaultTemplate, templatesFor, useDrawTemplates } from './drawTemplates';
import { tableCells } from './drawingKindsTv';

type Tab = 'style' | 'inputs' | 'levels' | 'text' | 'coords' | 'vis';

/* the mark bar's twenty inks, so the two pickers agree */
const INKS = [
  '#0A0A0A', '#FFFFFF', '#C7D3E8', '#9CA3AF', '#64748B',
  '#FF3B30', '#FF6B4A', '#FF9500', '#F5C542', '#FFE08A',
  '#D2FF00', '#30D158', '#2DD4BF', '#3DD6E8', '#7DD3FC',
  '#5B9CF6', '#6366F1', '#A78BFA', '#EA00FF', '#FF5EA8',
];

const etWords = (sec: number): string =>
  new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

const FORKS = new Set(FORK_STYLES.map(f => f.kind));
const STYLE_FIELDS = ['color', 'textColor', 'width', 'style', 'levels', 'opts'] as const;

interface Props {
  mark: Drawing;
  timeframe: string;
  prim: DrawingsPrimitive;
  onChange: (patch: Partial<Drawing>) => void;
  onClose: () => void;
}

/** The Template menu (TradingView's): save the style under a name, apply one, make one the tool's default */
const TemplateMenu = ({ mark, onChange }: { mark: Drawing; onChange: (patch: Partial<Drawing>) => void }) => {
  const store = useDrawTemplates();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const list = templatesFor(mark.kind, store);
  const def = store.defaults[mark.kind];
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const patchFrom = (d: Drawing): Partial<Drawing> => {
    const p: Partial<Drawing> = {};
    for (const k of STYLE_FIELDS) (p as Record<string, unknown>)[k] = d[k];
    return p;
  };
  const save = () => {
    if (!name.trim()) return;
    saveTemplate(mark, name);
    setName('');
  };
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="h-7 px-2.5 rounded border border-borderSubtle text-t11 text-textPrimary hover:bg-ink/[0.06]" data-draw-template-door>
        Template ▾
      </button>
      {open && (
        <div role="menu" className="absolute bottom-9 left-0 z-10 w-[256px] rounded-md border border-borderMuted bg-panel p-1.5 shadow-2xl shadow-black/60" data-draw-template-menu>
          <div className="px-1 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{drawToolLabel(mark.kind)} templates</div>
          {list.length === 0 && <div className="px-1.5 py-2 text-t11 leading-snug text-textSecondary">None yet. Save this one’s style below.</div>}
          {list.map(t => (
            <div key={t.name} className="flex items-center gap-1 h-7 rounded hover:bg-ink/[0.06]">
              <button type="button" role="menuitem" onClick={() => onChange(patchFrom(applyTemplate(mark, t)))} className="min-w-0 flex-1 truncate text-left px-1.5 text-t12 text-textPrimary" data-draw-template-apply={t.name}>
                {t.name}
              </button>
              <button
                type="button"
                onClick={() => setDefaultTemplate(mark.kind, def === t.name ? null : t.name)}
                title={def === t.name ? 'The default for new marks — click to stop' : 'Make it the default for new marks of this tool'}
                aria-label="Default for new marks"
                aria-pressed={def === t.name}
                className={`w-6 h-6 inline-flex items-center justify-center rounded ${def === t.name ? 'text-silver' : 'text-textMuted hover:text-textPrimary'}`}
              >
                <Star className="w-3 h-3" fill={def === t.name ? 'currentColor' : 'none'} />
              </button>
              <button type="button" onClick={() => deleteTemplate(mark.kind, t.name)} title="Delete this template" aria-label="Delete template" className="w-6 h-6 inline-flex items-center justify-center rounded text-textMuted hover:text-textPrimary">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="mt-1 pt-1.5 border-t border-borderMuted flex gap-1">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') save();
              }}
              maxLength={40}
              placeholder="Save as…"
              aria-label="Template name"
              className="min-w-0 flex-1 h-7 px-2 rounded border border-borderSubtle bg-chip text-t12 text-textPrimary outline-none focus:border-silver/50"
              data-draw-template-name
            />
            <button type="button" onClick={save} disabled={!name.trim()} className="h-7 px-2 rounded bg-ink/[0.08] text-t11 text-textPrimary disabled:opacity-40" data-draw-template-save>
              Save
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const p: Partial<Drawing> = {};
              for (const k of STYLE_FIELDS) (p as Record<string, unknown>)[k] = undefined;
              if (mark.opts?.fx !== undefined) p.opts = { fx: mark.opts.fx, fy: mark.opts.fy ?? 0 };
              onChange(p);
            }}
            className="mt-1 w-full h-7 px-1.5 rounded text-left text-t11 text-textSecondary hover:bg-ink/[0.06]"
          >
            Apply the tool’s own defaults
          </button>
        </div>
      )}
    </div>
  );
};

const DrawSettings = ({ mark, timeframe, prim, onChange, onClose }: Props) => {
  const optDefs = KIND_OPTS[mark.kind] ?? [];
  const leveled = !!DEFAULT_LEVELS[mark.kind];
  const fork = FORKS.has(mark.kind);
  const [tab, setTab] = useState<Tab>('style');
  const [newLevel, setNewLevel] = useState('');
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

  const setOpt = (key: string, v: OptVal) => onChange({ opts: { ...mark.opts, [key]: v } });
  const levels = levelSet(mark);
  const setLevels = (next: Level[]) => onChange({ levels: [...next].sort((a, b) => a.v - b.v) });
  const levelName = (v: number) => (mark.kind === 'gannfan' ? gannName(v) : String(v));

  /* visibility: the mark's interval ranges; a mark kept to one timeframe (the older choice) reads as that one range */
  const vis: Vis = (() => {
    if (mark.vis) return mark.vis;
    if (!mark.tf) return {};
    const t = tfUnit(mark.tf);
    if (!t) return {};
    const out: Vis = {};
    for (const u of VIS_UNITS) out[u.u] = u.u === t.u ? [t.n, t.n] : false;
    return out;
  })();
  const setVis = (next: Vis) => onChange({ vis: next, tf: undefined });

  const tabs: { id: Tab; name: string }[] = [
    { id: 'style', name: 'Style' },
    ...(optDefs.length || fork ? [{ id: 'inputs' as Tab, name: 'Inputs' }] : []),
    ...(leveled ? [{ id: 'levels' as Tab, name: 'Levels' }] : []),
    { id: 'text', name: 'Text' },
    { id: 'coords', name: 'Coordinates' },
    { id: 'vis', name: 'Visibility' },
  ];
  const tabBtn = (id: Tab, name: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`shrink-0 h-8 px-2.5 text-t12 border-b-2 transition-colors ${tab === id ? 'border-select text-textPrimary font-semibold' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
      data-draw-settings-tab={id}
    >
      {name}
    </button>
  );
  const row = 'flex items-center justify-between gap-3 py-1.5';
  const lab = 'text-t12 text-textSecondary';
  const seg = (on: boolean) => `h-7 px-2.5 rounded text-t11 transition-colors ${on ? 'bg-select/15 text-select' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`;
  const num = 'w-24 h-7 px-2 rounded border border-borderSubtle bg-chip font-mono text-t12 tnum text-right text-textPrimary outline-none focus:border-silver/50';

  return (
    <div
      role="dialog"
      aria-label={`${drawToolLabel(mark.kind)} settings`}
      data-chart-rail
      data-draw-settings
      className="absolute z-50 left-1/2 top-12 -translate-x-1/2 w-[360px] max-w-[calc(100%-16px)] max-h-[calc(100%-64px)] flex flex-col rounded-lg border border-borderMuted bg-panel/95 backdrop-blur-md shadow-2xl shadow-black/60 select-none animate-fade-in"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2.5">
        <span className="text-t13 font-semibold text-textPrimary truncate">{mark.name || drawToolLabel(mark.kind)}</span>
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div role="tablist" className="shrink-0 flex px-1.5 border-b border-borderMuted overflow-x-auto [scrollbar-width:none]">
        {tabs.map(t => tabBtn(t.id, t.name))}
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
        {tab === 'inputs' && (
          <div data-draw-settings-inputs>
            {fork && (
              <div className={row}>
                <span className={lab}>Style</span>
                <select
                  value={mark.kind}
                  onChange={e => onChange({ kind: e.target.value as Drawing['kind'] })}
                  className="h-7 px-1.5 rounded border border-borderSubtle bg-chip text-t12 text-textPrimary outline-none"
                  data-draw-fork-style
                >
                  {FORK_STYLES.map(f => (
                    <option key={f.kind} value={f.kind}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {optDefs.map(o => (
              <div key={o.key} className={row}>
                <span className={lab}>{o.label}</span>
                {o.type === 'bool' ? (
                  <input type="checkbox" checked={!!opt<boolean>(mark, o.key)} onChange={e => setOpt(o.key, e.target.checked)} data-draw-opt={o.key} />
                ) : o.type === 'pick' ? (
                  <select value={String(opt<string>(mark, o.key))} onChange={e => setOpt(o.key, e.target.value)} className="h-7 px-1.5 rounded border border-borderSubtle bg-chip text-t12 text-textPrimary outline-none" data-draw-opt={o.key}>
                    {o.choices?.map(c => (
                      <option key={c.v} value={c.v}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={o.min}
                    max={o.max}
                    step={o.step}
                    defaultValue={String(opt<number>(mark, o.key))}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setOpt(o.key, Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, v)));
                    }}
                    className={num}
                    data-draw-opt={o.key}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'levels' && (
          <div data-draw-settings-levels>
            <div className="flex items-center justify-between pb-1">
              <span className="text-t11 text-textMuted">{LEVEL_WORD[mark.kind] ?? 'Level'}</span>
              <button type="button" onClick={() => onChange({ levels: undefined })} className="inline-flex items-center gap-1 text-t11 text-textMuted hover:text-textPrimary" title="Back to the tool's own levels">
                <RotateCcw className="w-3 h-3" /> Defaults
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              {levels.map((l, i) => (
                <div key={`${l.v}-${i}`} className="flex items-center gap-1.5 py-1">
                  <input type="checkbox" checked={l.on} aria-label={`Level ${levelName(l.v)}`} onChange={e => setLevels(levels.map((o, k) => (k === i ? { ...o, on: e.target.checked } : o)))} data-draw-level={l.v} />
                  <input
                    type="number"
                    step="0.001"
                    defaultValue={String(+l.v.toFixed(4))}
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v) && v !== l.v && (mark.kind !== 'gannfan' || v > 0)) setLevels(levels.map((o, k) => (k === i ? { ...o, v } : o)));
                    }}
                    className="w-[84px] h-6 px-1 rounded border border-borderSubtle bg-chip font-mono text-t11 tnum text-right text-textPrimary outline-none focus:border-silver/50"
                  />
                  {mark.kind === 'gannfan' && <span className="font-mono text-t10 text-textMuted">{gannName(l.v)}</span>}
                  <button type="button" onClick={() => setLevels(levels.filter((_, k) => k !== i))} title="Remove this level" aria-label="Remove level" className="ml-auto w-5 h-5 inline-flex items-center justify-center rounded text-textMuted hover:text-textPrimary">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1 pt-2">
              <input
                type="number"
                step="0.001"
                value={newLevel}
                onChange={e => setNewLevel(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                placeholder="Add a level"
                aria-label="New level"
                className="min-w-0 flex-1 h-7 px-2 rounded border border-borderSubtle bg-chip font-mono text-t12 text-textPrimary outline-none focus:border-silver/50"
                data-draw-level-new
              />
              <button
                type="button"
                onClick={() => {
                  const v = parseFloat(newLevel);
                  if (!Number.isFinite(v) || (mark.kind === 'gannfan' && v <= 0) || levels.some(l => l.v === v)) return;
                  setLevels([...levels, { v, on: true }]);
                  setNewLevel('');
                }}
                className="h-7 px-2 inline-flex items-center gap-1 rounded bg-ink/[0.08] text-t11 text-textPrimary"
                data-draw-level-add
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
        )}
        {tab === 'text' && (
          <>
            <label className="block py-1.5">
              <span className={`${lab} block pb-1`}>{mark.kind === 'table' ? 'Cells — a bar between cells, a semicolon between rows' : words ? 'Words' : 'Caption — printed beside the mark'}</span>
              <input
                type="text"
                maxLength={mark.kind === 'table' ? 400 : 80}
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
            {mark.kind === 'table' && <p className="pb-1 text-t11 text-textMuted">{tableCells(mark.text ?? '').length} rows</p>}
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
          <div data-draw-settings-vis>
            <label className={`${row} cursor-pointer`}>
              <span className={lab}>Show on the chart</span>
              <input type="checkbox" checked={!mark.hidden} onChange={e => onChange({ hidden: e.target.checked ? undefined : true })} data-draw-settings-shown />
            </label>
            <div className="pt-1 pb-1 text-t11 text-textMuted">Intervals it shows on</div>
            {VIS_UNITS.map(u => {
              const r = vis[u.u];
              const on = r !== false;
              const [from, to] = Array.isArray(r) ? r : [1, u.max];
              return (
                <div key={u.u} className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={on} aria-label={u.label} onChange={e => setVis({ ...vis, [u.u]: e.target.checked ? [1, u.max] : false })} data-draw-vis={u.u} />
                  <span className="w-[62px] text-t12 text-textPrimary">{u.label}</span>
                  <input
                    type="number"
                    min={1}
                    max={u.max}
                    disabled={!on}
                    key={`${u.u}-a-${from}`}
                    defaultValue={from}
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => {
                      const v = Math.max(1, Math.min(u.max, Math.round(parseFloat(e.target.value) || 1)));
                      setVis({ ...vis, [u.u]: [Math.min(v, to), Math.max(v, to)] });
                    }}
                    className="w-14 h-6 px-1.5 rounded border border-borderSubtle bg-chip font-mono text-t11 tnum text-right text-textPrimary outline-none disabled:opacity-40"
                  />
                  <span className="text-t11 text-textMuted">to</span>
                  <input
                    type="number"
                    min={1}
                    max={u.max}
                    disabled={!on}
                    key={`${u.u}-b-${to}`}
                    defaultValue={to}
                    onKeyDown={e => e.stopPropagation()}
                    onBlur={e => {
                      const v = Math.max(1, Math.min(u.max, Math.round(parseFloat(e.target.value) || u.max)));
                      setVis({ ...vis, [u.u]: [Math.min(from, v), Math.max(from, v)] });
                    }}
                    className="w-14 h-6 px-1.5 rounded border border-borderSubtle bg-chip font-mono text-t11 tnum text-right text-textPrimary outline-none disabled:opacity-40"
                  />
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1 pt-2">
              <button type="button" onClick={() => onChange({ vis: undefined, tf: undefined })} className={seg(!mark.vis && !mark.tf)}>
                Every interval
              </button>
              <button type="button" onClick={() => onChange({ tf: timeframe, vis: undefined })} className={seg(!mark.vis && !!mark.tf)}>
                Only {mark.tf ?? timeframe}
              </button>
            </div>
            <p className="pt-2 text-t11 leading-snug text-textMuted">A mark kept off an interval stays stored; it shows again when the chart is back on one it is kept to.</p>
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-borderMuted">
        <TemplateMenu mark={mark} onChange={onChange} />
        <span className="ml-auto text-t10 text-textMuted">Changes land at once</span>
      </div>
    </div>
  );
};

export default DrawSettings;
