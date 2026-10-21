/*
==================================================
  SLAYER TERMINAL - PULSE · THE WIDGET PICKER
  (pages/workspace/Picker.tsx)

  What "Add widget" opens. It was a flat list of
  twelve names; with twenty-one it is a catalogue:

    A SEARCH       by the widget's name or what it
                   says — the list narrows as you type
    THE GROUPS     the rail's own — Market, The book,
                   Trade, Practice, You — each widget
                   with its icon and how many of it
                   are already on this desk
    THE PICTURE    the widget itself, live, on the
                   desk's name, drawn at the size it
                   lands at and scaled into the card —
                   never a depiction; only the one
                   under the pointer is mounted
    WHAT IT IS     one line, the page its door opens,
                   and its size on the grid

  A click (or Enter) puts it in the first gap from
  the top that takes it. DRAGGED, it is dropped onto
  the grid where the reader lets go — the picker
  steps out of the way for the length of the drag.
==================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, GripVertical, Plus, Search } from 'lucide-react';
import { WIDGETS } from './registry';
import { sizeOf } from './TileFrame';
import { WIDGET_GROUPS, type TileState, type WidgetDef, type WorkspaceCtx } from './tile';

const PIC_W = 388;
const PIC_H = 250;

/** The widget, live, at the size it lands at — scaled into the card */
const Picture = ({ def, ctx, width, height }: { def: WidgetDef; ctx: WorkspaceCtx | null; width: number; height: number }) => {
  const scale = Math.min(PIC_W / width, PIC_H / height, 1);
  const state = useMemo<TileState>(() => {
    const base = { ...(def.defaults ?? {}) };
    return def.resolve ? def.resolve(base) : base;
  }, [def]);
  return (
    <div className="relative rounded-md border border-borderSubtle bg-panel overflow-hidden" style={{ width: PIC_W, height: PIC_H }} data-picker-picture={def.key}>
      {ctx ? (
        /* keyed by the widget: a fresh mount each, so one widget's state never rides into the next */
        <div key={def.key} className="absolute left-1/2 top-1/2 pointer-events-none animate-fade-in" style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center' }} aria-hidden>
          <def.Body ctx={ctx} state={state} set={() => undefined} size={sizeOf(width, height)} open={() => undefined} />
        </div>
      ) : (
        <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">Waiting for the first tick</span>
      )}
    </div>
  );
};

interface Props {
  ctx: WorkspaceCtx | null;
  /** How many of each widget the desk already holds */
  counts: Record<string, number>;
  /** A tile's pixel box for a grid size, at the desk's width */
  boxFor: (w: number, h: number) => { width: number; height: number };
  onAdd: (key: string) => void;
  /** A drag out of the list began / ended — the desk makes room for the drop */
  onDragKey: (key: string | null) => void;
  onClose: () => void;
}

const Picker = ({ ctx, counts, boxFor, onAdd, onDragKey, onClose }: Props) => {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<string>(WIDGETS[0].key);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  /* a click anywhere else, or Escape, closes it */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-picker-open]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => WIDGETS.filter(w => !q || w.title.toLowerCase().includes(q) || w.says.toLowerCase().includes(q) || w.group.toLowerCase().includes(q)), [q]);
  const def = shown.find(w => w.key === hover) ?? shown[0] ?? null;
  const box = def ? boxFor(def.w, def.h) : null;

  return (
    <div
      ref={rootRef}
      className={`absolute right-0 top-full mt-1.5 z-40 w-[680px] max-w-[calc(100vw-32px)] border border-borderMuted bg-card rounded-lg shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden flex animate-soft-in transition-opacity duration-150 ${dragging ? 'opacity-0 pointer-events-none' : ''}`}
      role="dialog"
      aria-label="Add a widget"
      data-picker
    >
      {/* THE LIST */}
      <div className="w-[252px] shrink-0 flex flex-col border-r border-borderSubtle">
        <label className="shrink-0 flex items-center gap-2 h-10 px-3 border-b border-borderSubtle">
          <Search className="w-3.5 h-3.5 text-textMuted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && def) onAdd(def.key);
            }}
            placeholder="Find a widget"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-textPrimary placeholder:text-textMuted focus:outline-none"
            data-picker-search
          />
        </label>
        <div className="flex-1 min-h-0 max-h-[404px] overflow-y-auto overscroll-contain py-1">
          {shown.length === 0 && <p className="px-3 py-6 text-center text-[11px] text-textMuted">No widget by that name.</p>}
          {WIDGET_GROUPS.map(group => {
            const items = shown.filter(w => w.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="pb-1">
                <div className="px-3 pt-2 pb-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-silver/70 select-none">{group}</div>
                {items.map(w => {
                  const n = counts[w.key] ?? 0;
                  const on = def?.key === w.key;
                  return (
                    <button
                      key={w.key}
                      type="button"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', w.key);
                        e.dataTransfer.effectAllowed = 'copy';
                        onDragKey(w.key);
                        /* a frame later — a source hidden in the same frame cancels the drag */
                        requestAnimationFrame(() => setDragging(true));
                      }}
                      onDragEnd={() => {
                        setDragging(false);
                        onDragKey(null);
                      }}
                      onClick={() => onAdd(w.key)}
                      onMouseEnter={() => setHover(w.key)}
                      onFocus={() => setHover(w.key)}
                      className={`group w-full flex items-center gap-2 h-8 pl-3 pr-2 text-left transition-colors ${on ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.03]'}`}
                      title={`${w.title} — click to add, or drag it onto the desk`}
                      data-picker-item={w.key}
                    >
                      <w.icon className={`w-3.5 h-3.5 shrink-0 ${on ? 'text-textPrimary' : 'text-textSecondary'}`} aria-hidden />
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${on ? 'text-textPrimary font-semibold' : 'text-textSecondary'}`}>{w.title}</span>
                      {n > 0 && (
                        <span className="shrink-0 font-mono text-[9px] tnum text-textMuted" title={`${n} on this desk`} data-picker-count={n}>
                          {n} on desk
                        </span>
                      )}
                      <GripVertical className="w-3 h-3 shrink-0 text-textMuted opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* THE PICTURE AND WHAT IT IS */}
      <div className="flex-1 min-w-0 p-3.5 flex flex-col gap-2.5">
        {def && box ? (
          <>
            <Picture def={def} ctx={ctx} width={box.width} height={box.height} />
            <div className="flex items-center gap-2">
              <def.icon className="w-4 h-4 text-textSecondary" aria-hidden />
              <span className="text-[13px] font-semibold text-textPrimary">{def.title}</span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-textMuted">{def.group}</span>
            </div>
            <p className="text-[11.5px] leading-snug text-textSecondary">{def.says}.</p>
            <p className="flex items-center gap-1.5 font-mono text-[10px] text-textMuted">
              {def.page ? (
                <>
                  <ArrowUpRight className="w-3 h-3" aria-hidden /> Its door opens {def.page.label}
                </>
              ) : (
                'It has no page of its own'
              )}
              <span aria-hidden>·</span>
              {def.named ? 'follows the desk’s name, or holds its own' : 'the whole market'}
            </p>
            <button type="button" onClick={() => onAdd(def.key)} className="mt-auto inline-flex items-center justify-center gap-1.5 h-8 rounded-md holo-bg text-[#0a0a0a] hover:brightness-105 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all" data-picker-add={def.key}>
              <Plus className="w-3.5 h-3.5" /> Add {def.title}
            </button>
          </>
        ) : (
          <span className="m-auto text-[11px] text-textMuted">Nothing to show.</span>
        )}
      </div>
    </div>
  );
};

export default Picker;
