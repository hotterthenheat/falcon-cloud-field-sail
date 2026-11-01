import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, Search, X } from 'lucide-react';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { ShapeGlyph } from './LayoutDoor';
import { isShape, shapeByRest, type LayoutShape } from './layoutShapes';
import { DESK_PRESETS, type DeskPreset } from './deskPresets';

/*
==================================================
  SLAYER TERMINAL - THE DESKS DOOR (pages/terrain/DesksDoor.tsx)

  Ported from the partner tree (2026-10-31): one chip on the desk bar that wears the desk in hand's name, and a menu —
  YOUR DESKS (the layout door's shelf, each row its names' marks, its name and its names, its shape; a × on the hover
  forgets it), then BY FIELD (the house's four-name desks, deskPresets.ts); a search at the top finds either by name or
  by a ticker in it. A field pressed opens its four names in a four-pane desk. Opens UP from the bar (a portal, so the
  bar's own box never clips it).
==================================================
*/

export interface DeskRow {
  name: string;
  count: number;
  shape?: string;
  names: string[];
}

interface Props {
  /** the desk in hand's name, when it came from the shelf or a field */
  current: string | null;
  saved: DeskRow[];
  onRecall: (name: string) => void;
  onForget: (name: string) => void;
  onPreset: (preset: DeskPreset) => void;
}

const MENU_W = 340;

const shapeOf = (row: DeskRow): LayoutShape => (row.shape && isShape(row.shape) ? row.shape : shapeByRest(row.count));

/* the names' own marks, stacked — the real thing, never a drawn ornament */
const Marks = ({ names }: { names: readonly string[] }) => (
  <span className="flex shrink-0 items-center" aria-hidden>
    {names.slice(0, 4).map((n, i) => (
      <span key={n + i} className={`inline-flex rounded-full ring-2 ring-panel bg-panel ${i ? '-ml-2' : ''}`} style={{ zIndex: 4 - i }}>
        <CompanyLogo ticker={n} size={20} className="rounded-full" />
      </span>
    ))}
  </span>
);
const Words = ({ name, line, names, on }: { name: string; line: string; names: readonly string[]; on: boolean }) => (
  <span className="flex-1 min-w-0 flex flex-col justify-center gap-px">
    <span className={`truncate text-t12 font-semibold leading-4 ${on ? 'text-silver' : 'text-textPrimary'}`}>{name}</span>
    <span className="truncate font-mono text-t10 leading-[14px] text-textMuted tnum">
      {names.join(' · ')}
      {line ? <span className="text-textMuted/80"> — {line}</span> : null}
    </span>
  </span>
);

const DesksDoor = ({ current, saved, onRecall, onForget, onPreset }: Props) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, 'top', MENU_W, 'end');
  useEffect(() => {
    if (!open) {
      setQ('');
      return;
    }
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, anchorRef, menuRef]);

  const needle = q.trim().toUpperCase();
  const hit = (name: string, names: readonly string[]) => !needle || name.toUpperCase().includes(needle) || names.some(n => n.toUpperCase().includes(needle));
  const mine = saved.filter(r => hit(r.name, r.names));
  const fields = DESK_PRESETS.filter(p => hit(p.name, p.names));
  const pick = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  const rowCls = 'group w-full flex items-center gap-3 h-11 px-2 rounded-lg text-left hover:bg-ink/[0.06] transition-colors';

  return (
    <span className="relative pointer-events-auto inline-flex shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={current ? `Desks — ${current} in hand` : 'Desks'}
        title={current ? `Desks — ${current} in hand. Your saved desks and the desks by field` : 'Desks — your saved desks and the desks by field'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-ink/[0.08] backdrop-blur-[3px] font-mono text-t10 uppercase tracking-wider transition-colors max-w-[160px] ${
          open ? 'bg-ink/[0.16] text-textPrimary' : 'bg-canvas/40 text-textSecondary hover:text-textPrimary'
        }`}
        data-desks-door={current ?? ''}
      >
        <span className="truncate">{current ?? 'Desks'}</span>
        <ChevronUp className={`w-3 h-3 shrink-0 text-textMuted transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden />
      </button>
      {open &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Desks"
            className="z-[120] p-1.5 rounded-md border border-borderMuted bg-panel/95 backdrop-blur-md shadow-xl shadow-black/50 overflow-y-auto overscroll-contain animate-fade-in"
            style={{ position: 'fixed', ...placed.box, width: MENU_W, maxHeight: 'min(72vh, 560px)' }}
            data-desks-menu
          >
            <label className="flex items-center gap-2 h-8 px-2 mb-1 rounded-md border border-borderSubtle bg-inset focus-within:border-borderMuted transition-colors">
              <Search className="w-3.5 h-3.5 shrink-0 text-textMuted" aria-hidden />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Escape') e.stopPropagation();
                }}
                placeholder="Find a desk or a name"
                aria-label="Find a desk or a name"
                className="min-w-0 flex-1 bg-transparent outline-none text-t12 text-textPrimary placeholder:text-textMuted"
                data-desks-search
              />
            </label>
            {mine.length > 0 && (
              <div data-desks-section="mine">
                <div className="h-6 px-2 flex items-center font-mono text-t10 font-bold uppercase tracking-[0.06em] text-textMuted">Your desks</div>
                {mine.map(r => (
                  <div key={r.name} className="relative group/row">
                    <button type="button" onClick={() => pick(() => onRecall(r.name))} className={`${rowCls} pr-8`} role="menuitem" data-desk-row={r.name}>
                      <Marks names={r.names} />
                      <Words name={r.name} line="" names={r.names} on={current === r.name} />
                      <ShapeGlyph shape={shapeOf(r)} className={`shrink-0 ${current === r.name ? 'text-silver' : 'text-textMuted'}`} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget ${r.name}`}
                      onClick={() => onForget(r.name)}
                      className="absolute right-8 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-textPrimary hover:bg-ink/[0.08] transition-opacity"
                      data-desk-forget={r.name}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {fields.length > 0 && (
              <div className={mine.length ? 'mt-1 pt-1 border-t border-borderSubtle/60' : ''} data-desks-section="fields">
                <div className="h-6 px-2 flex items-center font-mono text-t10 font-bold uppercase tracking-[0.06em] text-textMuted">By field</div>
                {fields.map(p => (
                  <button key={p.name} type="button" onClick={() => pick(() => onPreset(p))} className={rowCls} role="menuitem" data-desk-field={p.name}>
                    <Marks names={p.names} />
                    <Words name={p.name} line={p.line} names={p.names} on={current === p.name} />
                    <ShapeGlyph shape={shapeByRest(p.names.length)} className={`shrink-0 ${current === p.name ? 'text-silver' : 'text-textMuted'}`} />
                  </button>
                ))}
              </div>
            )}
            {mine.length === 0 && fields.length === 0 && <p className="px-2 py-3 text-t115 text-textMuted">Nothing by that name.</p>}
            <p className="px-2 pt-1.5 pb-0.5 text-t105 leading-4 text-textMuted">A field opens its four names in four charts. The layout door saves the desk in hand under a name.</p>
          </div>,
          document.body
        )}
    </span>
  );
};

export default DesksDoor;
