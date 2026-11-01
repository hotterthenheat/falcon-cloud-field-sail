/* THE OBJECT TREE (TradingView's): every drawing on this tape in one list, the one drawn on top first — select it,
   rename it (double-click or the pencil), hide it, lock it, move it up or down the stack (drag a row, or the arrows),
   delete it. A panel on the chart's right; a bottom sheet on a narrow pane.
   In Noah's visual language (his rail's fly-out lists): the dark glass panel, the mono caps head, rows of 28 with the
   tool's glyph, the select ink for the one in hand, and his glide in (8px, 180ms). Its head carries our sync switch. */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Eye, EyeOff, Link2, Link2Off, Lock, Pencil, Trash2, Unlock, X } from 'lucide-react';
import type { Drawing } from './drawingsPrimitive';
import { drawToolDef, drawToolLabel } from './drawTools';
import { setDrawSync, useDrawSync } from './drawingSync';

interface Props {
  drawings: Drawing[];
  selected: number | null;
  onSelect: (index: number) => void;
  onPatch: (index: number, patch: Partial<Drawing>) => void;
  onDelete: (index: number) => void;
  /** Move the drawing at `from` to stack position `to` (0 = drawn first, at the bottom) */
  onMove: (from: number, to: number) => void;
  onClose: () => void;
  narrow: boolean;
}

const DrawObjectTree = ({ drawings, selected, onSelect, onPatch, onDelete, onMove, onClose, narrow }: Props) => {
  const [editing, setEditing] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const sync = useDrawSync();
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing !== null) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose, editing]);
  /* top of the list is top of the stack: the last drawn */
  const order = drawings.map((_, i) => i).reverse();
  const iconBtn = 'inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] [@media(pointer:coarse)]:w-8 [@media(pointer:coarse)]:h-8';

  return (
    <motion.div
      ref={box}
      initial={{ opacity: 0, ...(narrow ? { y: 12 } : { x: 8 }), scale: 0.98 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      role="dialog"
      aria-label="Object tree"
      data-chart-rail
      data-draw-tree
      onPointerDown={e => e.stopPropagation()}
      className={`absolute z-50 flex flex-col border border-borderMuted bg-panel/95 backdrop-blur-md p-1 shadow-2xl shadow-black/60 select-none ${
        narrow ? 'inset-x-0 bottom-0 max-h-[70%] rounded-t-xl border-b-0' : 'right-2 top-12 w-[320px] max-h-[calc(100%-64px)] rounded-md'
      }`}
    >
      <div className="shrink-0 flex items-center gap-2 pl-2 pr-0.5 pt-1 pb-1">
        <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">Object tree</span>
        <span className="font-mono text-t9 tnum text-textMuted">· {drawings.length}</span>
        <button
          type="button"
          onClick={() => setDrawSync(!sync)}
          title={sync ? 'Sync drawings — on: every pane on this symbol shows the same drawings' : 'Sync drawings — off: each pane keeps its own drawings'}
          aria-label="Sync drawings"
          aria-pressed={sync}
          className={`ml-auto inline-flex items-center gap-1 h-6 px-1.5 rounded text-t10 transition-colors ${sync ? 'bg-select/15 text-select' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
          data-draw-sync
        >
          {sync ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />} Sync
        </button>
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className={iconBtn}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {drawings.length === 0 && <div className="px-3 py-6 text-center text-t11 leading-snug text-textSecondary">No drawings on this chart yet. Pick a tool from the rail and they are listed here.</div>}
        {order.map(i => {
          const d = drawings[i];
          const def = drawToolDef(d.kind);
          const on = selected === i;
          const name = d.name || drawToolLabel(d.kind);
          return (
            <div
              key={i}
              draggable={editing === null}
              onDragStart={e => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={e => {
                if (drag !== null) e.preventDefault();
              }}
              onDrop={e => {
                e.preventDefault();
                if (drag !== null && drag !== i) onMove(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              className={`group flex items-center gap-2.5 h-7 [@media(pointer:coarse)]:h-10 pl-2 pr-1 rounded transition-colors ${on ? 'bg-select/15' : 'hover:bg-ink/[0.06]'} ${drag === i ? 'opacity-50' : ''} ${d.hidden ? 'opacity-60' : ''}`}
              data-draw-tree-row={i}
            >
              <span className={`text-t15 inline-flex shrink-0 ${on ? 'text-select' : 'text-textSecondary'}`}>{def?.icon}</span>
              {editing === i ? (
                <input
                  autoFocus
                  defaultValue={name}
                  maxLength={48}
                  aria-label="Drawing name"
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    onPatch(i, { name: v && v !== drawToolLabel(d.kind) ? v : undefined });
                    setEditing(null);
                  }}
                  className="min-w-0 flex-1 h-6 px-1.5 rounded border border-silver/50 bg-chip text-t12 text-textPrimary outline-none"
                  data-draw-tree-rename
                />
              ) : (
                <button type="button" onClick={() => onSelect(i)} onDoubleClick={() => setEditing(i)} className={`min-w-0 flex-1 truncate text-left text-t12 ${on ? 'text-select font-semibold' : 'text-textPrimary'}`} title={`${name} — double-click to rename`}>
                  {name}
                </button>
              )}
              <button type="button" onClick={() => setEditing(i)} title="Rename" aria-label="Rename" className={`${iconBtn} opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100`}>
                <Pencil className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onMove(i, Math.min(drawings.length - 1, i + 1))} disabled={i === drawings.length - 1} title="Bring forward" aria-label="Bring forward" className={`${iconBtn} disabled:opacity-20`}>
                <ArrowUp className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onMove(i, Math.max(0, i - 1))} disabled={i === 0} title="Send backward" aria-label="Send backward" className={`${iconBtn} disabled:opacity-20`}>
                <ArrowDown className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => onPatch(i, { hidden: d.hidden ? undefined : true })} title={d.hidden ? 'Show' : 'Hide'} aria-label={d.hidden ? 'Show' : 'Hide'} aria-pressed={!!d.hidden} className={iconBtn} data-draw-tree-hide>
                {d.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
              <button type="button" onClick={() => onPatch(i, { locked: d.locked ? undefined : true })} title={d.locked ? 'Unlock' : 'Lock'} aria-label={d.locked ? 'Unlock' : 'Lock'} aria-pressed={!!d.locked} className={iconBtn} data-draw-tree-lock>
                {d.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button type="button" onClick={() => onDelete(i)} title="Delete" aria-label="Delete" className={iconBtn} data-draw-tree-delete>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default DrawObjectTree;
