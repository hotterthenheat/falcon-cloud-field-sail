/*
==================================================
  SLAYER TERMINAL - THE DESKS DOOR (pages/terrain/DesksDoor.tsx)

  On the tab strip after the wordmark (Noah, 2026-10-31, openmarket's workspace door in his recording: a chip opens a
  menu — a search field, OPEN TABS with each layout's names and timeframe, RECENTLY USED, "+ New layout" — and the
  workspaces stand as tabs across its top row: "we need that layout thing they have but for our own use case to maybe
  Technology, other fields etc."). Ours keeps the strip's row for the pane's NAMES (TradingView's bar, his word on
  2026-10-18) and puts the desks behind one chip that wears the desk in hand's name: YOUR DESKS — the layout door's
  shelf, each row its shape, its name and its names, a × on the hover to forget it — then BY FIELD, the house's own
  four-name desks (deskPresets.ts); a search at the top finds either by name or by a ticker in it. Opens on the hover,
  as every door on the strip and the bar does (ui/useHoverOpen); a portal, since the strip clips. THE CHIP IS THEIR
  MONITOR AND CHEVRON, MEASURED (Noah, the same day: "i want their icon for desks and not a word" … "the exact same icon
  with the little down arrow verbatim"; and "their spacing is really nice compared to ours"): 48×28, sixteen pixels
  after the wordmark, standing four above the row's floor as their door does, the first tab eight after it — the desk
  in hand's name is its title and its row in the menu, never a word on the strip.
==================================================
*/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import { useHoverOpen } from '../../components/ui/useHoverOpen';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { ShapeGlyph } from './LayoutDoor';
import { isShape, shapeByRest, type LayoutShape } from './layoutShapes';
import { DESK_PRESETS, type DeskPreset } from './deskPresets';

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

/* THEIR MONITOR, VERBATIM (Noah, 2026-10-31: "i need the exact same icon with the little down arrow verbatim. not a
   knock off"), read off openmarket's top bar: a 16px glyph on a 24 box, stroke 1.5 with round caps — a rounded rect
   18×14 at (3,3) rx 4 and the stand's line at y 20.5 — then lucide's chevron-down at 14, stroke 2, turning 180° open. */
const MonitorGlyph = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" aria-hidden="true">
    <rect width="18" height="14" x="3" y="3" rx="4" />
    <path d="M7 20.5h10" />
  </svg>
);

const shapeOf = (row: DeskRow): LayoutShape => (row.shape && isShape(row.shape) ? row.shape : shapeByRest(row.count));

const DesksDoor = ({ current, saved, onRecall, onForget, onPreset }: Props) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', MENU_W, 'start');
  const hover = useHoverOpen(true, setOpen, menuRef);
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
  /* THE ROW HAS A FACE (Noah, the same day, the first cut's grey rows: "our desks are so bland no color no nothing it
     looks soulless"): the four names' own marks stacked at its left — the real thing, never a drawn ornament — the
     desk's name in the primary ink over its names, the shape at the right; the desk in hand wears the silver. */
  const rowCls = 'group w-full flex items-center gap-3 h-11 px-2 rounded-lg text-left hover:bg-ink/[0.06] transition-colors';
  const Marks = ({ names }: { names: readonly string[] }) => (
    <span className="flex shrink-0 items-center" aria-hidden>
      {names.slice(0, 4).map((n, i) => (
        <span key={n + i} className={`inline-flex rounded-full ring-2 ring-panel bg-panel ${i ? '-ml-2' : ''}`} style={{ zIndex: 4 - i }}>
          <CompanyLogo ticker={n} size={20} className="rounded-full overflow-hidden" />
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

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={current ? `Desks — ${current} in hand` : 'Desks'}
        title={current ? `Desks — ${current} in hand` : 'Desks'}
        className={`shrink-0 self-end mb-1 ml-4 inline-flex items-center gap-1 h-7 pl-2 pr-1.5 rounded-lg transition-colors duration-[120ms] ${
          open ? 'text-textPrimary bg-ink/[0.08]' : 'text-textPrimary/90 hover:text-textPrimary hover:bg-ink/[0.05]'
        }`}
        data-desks-door={current ?? ''}
        {...hover.trigger}
      >
        <MonitorGlyph />
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-[140ms] ${open ? 'rotate-180' : ''}`} strokeWidth={2} aria-hidden />
      </button>
      {open &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Desks"
            className="tf-menu z-[120] p-1.5 rounded-xl border border-borderMuted shadow-xl shadow-black/25 overflow-y-auto overscroll-contain animate-fade-in"
            style={{ position: 'fixed', ...placed.box, width: MENU_W, maxHeight: 'min(72vh, 560px)' }}
            data-desks-menu
            {...hover.menu}
          >
            <label className="flex items-center gap-2 h-8 px-2 mb-1 rounded-lg border border-ink/[0.08] bg-ink/[0.03] focus-within:border-silver/50 transition-colors">
              <Search className="w-3.5 h-3.5 shrink-0 text-textMuted" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Find a desk or a name"
                className="min-w-0 flex-1 bg-transparent outline-none text-t12 text-textPrimary placeholder:text-textMuted"
                data-desks-search
              />
            </label>
            {mine.length > 0 && (
              <div data-desks-section="mine">
                <div className="h-6 px-2 flex items-center font-mono text-t10 font-bold uppercase tracking-[0.06em] text-textMuted">Your desks</div>
                {mine.map(r => (
                  <div key={r.name} className="relative">
                    <button type="button" onClick={() => pick(() => onRecall(r.name))} className={`${rowCls} pr-8`} role="menuitem" data-desk-row={r.name}>
                      <Marks names={r.names} />
                      <Words name={r.name} line="" names={r.names} on={current === r.name} />
                      <ShapeGlyph shape={shapeOf(r)} className={`shrink-0 ${current === r.name ? 'text-silver' : 'text-textMuted'}`} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget ${r.name}`}
                      onClick={() => onForget(r.name)}
                      className="absolute right-8 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted opacity-0 hover:opacity-100 focus-visible:opacity-100 [div:hover>&]:opacity-100 hover:text-textPrimary hover:bg-ink/[0.08] transition-opacity"
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
            <p className="px-2 pt-1.5 pb-0.5 text-t105 leading-4 text-textMuted">The layout door on the bar saves the desk in hand under a name.</p>
          </div>,
          document.body
        )}
    </>
  );
};

export default DesksDoor;
