/* The drawing rail's middle: one button a family (wearing its last tool; a chevron, long press or right click opens the list),
   the list, the sheet of every tool (a bottom sheet on a narrow pane) and the starred row. List and sheet portal into the chart box so the rail's scroll cannot clip them.

   NOAH'S UI (his DrawRailTools.tsx and DeskDrawRail.tsx, 2026-10-31, openmarket measured): `big` is his desk rail's size —
   a 36×36 face centred in a 48px rail, a 20px glyph, the family's chevron an overlay at the face's right edge, and
   TradingView's corner triangle on every button that holds more tools (40% ink at rest, gone under the pointer where the
   chevron takes over). A family's list glides out of the arrow (8px of travel, 180ms on the house's ease). */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Eye, EyeOff, Link2, Link2Off, ListTree, Lock, Redo2, Search, Star, Undo2, Unlock, X } from 'lucide-react';
import type { DrawingKind } from './drawingsPrimitive';
import { DRAW_FAMILIES, DRAW_HOTKEY, drawToolDef, familyFace, searchDrawTools, setDrawPref, toggleDrawFavourite, useDrawToolPrefs, type DrawToolDef } from './drawTools';
import { STAMP_SETS, getStampSet, setStamp, type StampSet } from './drawStamp';
import { setDrawSync, useDrawSync } from './drawingSync';

type Dock = 'left' | 'top';
type OpenList = { id: string; anchor: DOMRect } | null;

const LONG_PRESS_MS = 420;

interface RailToolsProps {
  dock: Dock;
  /** Noah's desk rail size: a 36px cell, a 20px glyph, the chevron an overlay. The pane rail over a tape keeps the small size. */
  big?: boolean;
  /** Draw mode is on — only then is a tool "in hand" */
  drawing: boolean;
  drawTool: DrawingKind | 'select';
  onPick: (kind: DrawingKind) => void;
  /** The chart's box: what the list and the sheet are portalled into, and clamped inside */
  host: HTMLElement | null;
  sheetOpen: boolean;
  onSheet: (open: boolean) => void;
}

/* Two columns, a 24 px icon and a 10 px arrow; docked top, only buttons with an arrow pay for its column. */
/* ON A TOUCH SCREEN the arrow column is 24 wide, not 10 (the last-targets pass, 2026-10-30): there it is always shown
   ([@media(hover:none)]) and a finger needs it; the rail widens to 58 to carry it (StrikeChart), and every cell's
   right padding follows so the icons stay in one column. RAIL_ARROW_PAD is that padding, for StrikeChart's own
   buttons in the rail. */
export const RAIL_ARROW_PAD = 'pr-[10px] [@media(pointer:coarse)]:pr-[24px]';
/** Noah's desk cell: a 36×36 face centred in the 48px rail (openmarket's, measured), the rows stacked with no air between */
export const BIG_CELL = 'h-[36px] w-[36px] mx-auto shrink-0';
const cell = (dock: Dock, big = false) => (dock === 'left' ? (big ? BIG_CELL : `h-[26px] w-full ${RAIL_ARROW_PAD}`) : 'w-[24px] h-full');
const listCell = (dock: Dock, big = false) => (dock === 'left' ? (big ? 'h-[36px] w-full' : 'h-[26px] w-full') : 'w-[34px] [@media(pointer:coarse)]:w-[48px] h-full');
export const railFace = (on: boolean) => (on ? 'bg-select/15 text-select' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]');
const face = railFace;
/** big: Noah's group gap — rows 36 apart, 53 across a group, so 17px with the hairline in the middle */
export const RailRule = ({ dock, big = false }: { dock: Dock; big?: boolean }) => (
  <div className={dock === 'left' ? (big ? 'mx-1.5 my-2 h-px shrink-0 bg-borderMuted' : 'mx-1 my-0.5 h-px bg-borderMuted') : 'my-1 mx-0.5 w-px bg-borderMuted'} aria-hidden />
);
const Rule = RailRule;

/** One of the rail's buttons that opens a list: the face takes the tool, the corner tick opens the rest */
const ListButton = ({ dock, big = false, on, title, listTitle, icon, onFace, onList, open, testId }: { dock: Dock; big?: boolean; on: boolean; title: string; listTitle: string; icon: ReactNode; onFace: (anchor: DOMRect | null) => void; onList: (anchor: DOMRect) => void; open: boolean; testId: string }) => {
  const wrap = useRef<HTMLDivElement | null>(null);
  const held = useRef<number | null>(null);
  const swallow = useRef(false);
  const openList = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) onList(r);
  };
  const clearHold = () => {
    if (held.current !== null) window.clearTimeout(held.current);
    held.current = null;
  };
  useEffect(() => clearHold, []);
  return (
    <div ref={wrap} className={`group/fam relative shrink-0 flex items-stretch ${big ? 'justify-center' : ''} ${listCell(dock, big)}`} data-draw-family={testId}>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={on}
        onPointerDown={() => {
          swallow.current = false;
          clearHold();
          held.current = window.setTimeout(() => {
            swallow.current = true;
            openList();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onContextMenu={e => {
          e.preventDefault();
          clearHold();
          openList();
        }}
        onClick={() => {
          /* the long press already answered this gesture */
          if (swallow.current) return;
          onFace(wrap.current?.getBoundingClientRect() ?? null);
        }}
        className={`relative shrink-0 inline-flex items-center justify-center rounded transition-colors ${big ? 'w-[36px] text-[20px]' : 'w-[24px] text-t14'} ${face(on || open)}`}
      >
        {icon}
        {/* THE CORNER TRIANGLE (Noah, 2026-10-31: "show the bottom right arrow like they have and like how tradingview has"):
            a button that holds more tools — 40% ink at rest, gone under the pointer where the chevron takes over */}
        <svg aria-hidden width={big ? 5 : 4} height={big ? 5 : 4} viewBox="0 0 4 4" className={`absolute ${big ? 'right-[3px] bottom-[3px]' : 'right-[2px] bottom-[2px]'} opacity-40 transition-opacity group-hover/fam:opacity-0`} data-draw-family-corner>
          <path d="M0 4L4 4L4 0Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        title={listTitle}
        aria-label={listTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openList}
        className={`${big ? 'absolute right-0 top-0 h-full w-[10px] [@media(pointer:coarse)]:w-[14px] z-10' : 'w-[10px] [@media(pointer:coarse)]:w-[24px]'} shrink-0 inline-flex items-center justify-center rounded-r text-textSecondary hover:text-textPrimary hover:bg-ink/[0.1] transition-opacity focus-visible:opacity-100 group-hover/fam:opacity-100 [@media(hover:none)]:opacity-100 ${open ? 'opacity-100 text-textPrimary bg-ink/[0.1]' : 'opacity-0'}`}
        data-draw-family-more
      >
        {dock === 'left' ? <ChevronRight className={big ? 'w-3 h-3 -mx-px' : 'w-2.5 h-2.5 -mx-px'} strokeWidth={2.6} /> : <ChevronDown className="w-2.5 h-2.5 -mx-px" strokeWidth={2.6} />}
      </button>
    </div>
  );
};

/** The star a tool is kept with */
const StarToggle = ({ kind, on, className = '' }: { kind: DrawingKind; on: boolean; className?: string }) => (
  <span
    role="button"
    tabIndex={0}
    aria-pressed={on}
    aria-label={on ? 'Take out of your favourites' : 'Keep in your favourites'}
    title={on ? 'Take out of your favourites' : 'Keep in your favourites'}
    onClick={e => {
      e.stopPropagation();
      toggleDrawFavourite(kind);
    }}
    onKeyDown={e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      toggleDrawFavourite(kind);
    }}
    className={`inline-flex items-center justify-center rounded transition-colors ${on ? 'text-silver' : 'text-textMuted/60 hover:text-textPrimary'} ${className}`}
    data-draw-star={kind}
  >
    <Star className="w-3 h-3" fill={on ? 'currentColor' : 'none'} />
  </span>
);

/** A family's list, beside the rail */
const ToolList = ({ title, tools, anchor, dock, host, drawTool, favs, onPick, onClose, empty, footer }: { title: string; tools: DrawToolDef[]; anchor: DOMRect; dock: Dock; host: HTMLElement; drawTool: DrawingKind | 'select'; favs: DrawingKind[]; onPick: (k: DrawingKind) => void; onClose: () => void; empty?: string; footer?: ReactNode }) => {
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = host.getBoundingClientRect();
    const maxH = Math.max(120, h.height - 12);
    const bw = el.offsetWidth;
    const bh = Math.min(el.scrollHeight, maxH);
    const left = dock === 'left' ? anchor.right - h.left + 8 : anchor.left - h.left - 8;
    const top = dock === 'left' ? anchor.top - h.top - 8 : anchor.bottom - h.top + 8;
    setPos({ left: Math.max(6, Math.min(left, h.width - bw - 6)), top: Math.max(6, Math.min(top, h.height - bh - 6)), maxH });
  }, [anchor, dock, host, tools.length]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && box.current?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-draw-family]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  let lastSub: string | null = null;
  /* THE LIST GLIDES OUT OF THE ARROW (Noah, 2026-10-31: "the dropdown for the tools when i click the right arrow needs to be
     smooth"): from the rail's edge, 8px of travel and a touch of scale, 180ms on the house's ease; back the same way */
  const from = dock === 'left' ? { x: -8, y: 0 } : { x: 0, y: -6 };
  return createPortal(
    <motion.div
      ref={box}
      role="menu"
      aria-label={title}
      data-chart-rail
      data-draw-list
      className="absolute z-50 w-[232px] overflow-y-auto rounded-md border border-borderMuted bg-panel/95 backdrop-blur-md p-1 shadow-2xl shadow-black/60 select-none"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
      initial={{ opacity: 0, scale: 0.97, ...from }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, ...from, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="px-2 pt-1.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{title}</div>
      {tools.length === 0 && empty && <div className="px-2 py-3 text-t11 leading-snug text-textSecondary">{empty}</div>}
      {tools.map(t => {
        const head = t.sub !== lastSub && tools.some(o => o.sub !== tools[0].sub);
        lastSub = t.sub;
        const on = drawTool === t.tool;
        return (
          <div key={t.tool}>
            {head && <div className="px-2 pt-2 pb-0.5 text-t10 text-textMuted">{t.sub}</div>}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(t.tool);
                onClose();
              }}
              className={`w-full flex items-center gap-2.5 h-7 pl-2 pr-1 rounded text-left text-t12 transition-colors ${on ? 'bg-select/15 text-select' : 'text-textPrimary hover:bg-ink/[0.06]'}`}
              data-draw-tool={t.tool}
            >
              <span className={`text-t15 inline-flex ${on ? '' : 'text-textSecondary'}`}>{t.icon}</span>
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
              {DRAW_HOTKEY[t.tool] && <span className="shrink-0 font-mono text-t9 text-textMuted">{DRAW_HOTKEY[t.tool]}</span>}
              <StarToggle kind={t.tool} on={favs.includes(t.tool)} className="w-6 h-6" />
            </button>
          </div>
        );
      })}
      {footer}
    </motion.div>,
    host
  );
};

/** The Icons family's stamps: a press takes one in hand and arms the stamp tool */
const StampGrid = ({ current, onPick }: { current: string; onPick: () => void }) => {
  /* TradingView's three sets — icons, emoji, stickers — ours drawn from plain Unicode */
  const [set, setSet] = useState<StampSet>(() => getStampSet());
  const marks = STAMP_SETS.find(s => s.set === set)?.marks ?? [];
  return (
    <div className="px-1.5 pt-2 pb-1">
      <div className="flex gap-1 pb-1.5" role="tablist">
        {STAMP_SETS.map(s => (
          <button
            key={s.set}
            type="button"
            role="tab"
            aria-selected={set === s.set}
            onClick={() => setSet(s.set)}
            className={`h-6 px-2 rounded-full text-t10 transition-colors ${set === s.set ? 'bg-ink/[0.1] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary'}`}
            data-draw-stamp-set={s.set}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {marks.map(e => (
          <button
            key={e}
            type="button"
            title={`Stamp ${e}`}
            aria-label={`Stamp ${e}`}
            aria-pressed={current === e}
            onClick={() => {
              setStamp(e, set);
              onPick();
            }}
            className={`h-8 rounded text-[17px] leading-none transition-colors ${set === 'sticker' ? 'rounded-full ring-2 ring-white/70 ' : ''}${current === e ? 'bg-select/15 ring-1 ring-select/50' : 'hover:bg-ink/[0.08]'} ${set === 'icon' ? 'text-textPrimary' : ''}`}
            data-draw-stamp={e}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
};

interface SheetProps {
  host: HTMLElement;
  dock: Dock;
  drawTool: DrawingKind | 'select';
  onPick: (kind: DrawingKind) => void;
  onClose: () => void;
  /** The object tree's door — the rail is folded away on a narrow pane, so the sheet carries it */
  onTree?: () => void;
}

/** Every tool: search, a tab a family, a grid of named tiles. A bottom sheet where the pane is narrow. */
export const DrawSheet = ({ host, dock, drawTool, onPick, onClose, onTree }: SheetProps) => {
  const prefs = useDrawToolPrefs();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>(prefs.favs.length ? 'favs' : DRAW_FAMILIES[0].id);
  const box = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(() => host.clientWidth < 560);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setNarrow(host.clientWidth < 560));
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && box.current?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-draw-sheet-door]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const searching = query.trim().length > 0;
  const shown = useMemo<DrawToolDef[]>(() => {
    if (searching) return searchDrawTools(query);
    if (tab === 'favs') return prefs.favs.map(k => drawToolDef(k)).filter((t): t is DrawToolDef => !!t);
    return DRAW_FAMILIES.find(f => f.id === tab)?.tools ?? [];
  }, [searching, query, tab, prefs.favs]);
  const tabs = [{ id: 'favs', name: 'Favourites', full: 'Your favourites' }, ...DRAW_FAMILIES.map(f => ({ id: f.id as string, name: f.short, full: f.name }))];

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Drawings"
      data-chart-rail
      data-draw-sheet={narrow ? 'bottom' : 'side'}
      className={`absolute z-50 flex flex-col border border-borderMuted bg-panel/95 backdrop-blur-md shadow-2xl shadow-black/60 select-none ${
        narrow ? 'inset-x-0 bottom-0 max-h-[86%] rounded-t-xl border-b-0 animate-fade-in' : `w-[392px] max-h-[calc(100%-16px)] rounded-lg animate-fade-in ${dock === 'left' ? 'left-[56px] top-2' : 'left-1/2 -translate-x-1/2 top-[46px]'}`
      }`}
    >
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="text-t13 font-semibold text-textPrimary">Drawings</span>
        <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">{searching ? `${shown.length} found` : `${DRAW_FAMILIES.reduce((n, f) => n + f.tools.length, 0)} tools`}</span>
        {onTree && (
          <button type="button" onClick={onTree} title="Object tree — every drawing on this chart" aria-label="Object tree" className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded text-t11 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]" data-draw-tree-door>
            <ListTree className="w-3.5 h-3.5" /> Object tree
          </button>
        )}
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className={`${onTree ? '' : 'ml-auto '}inline-flex items-center justify-center w-6 h-6 [@media(pointer:coarse)]:w-8 [@media(pointer:coarse)]:h-8 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <label className="shrink-0 mx-3 flex items-center gap-2 h-8 px-2.5 rounded-md border border-borderSubtle bg-chip focus-within:border-silver/50">
        <Search className="w-3.5 h-3.5 text-textMuted shrink-0" />
        <input
          autoFocus={!narrow}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            /* the desk's own keys must not fire while a name is typed */
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && shown[0]) {
              onPick(shown[0].tool);
              onClose();
            }
          }}
          placeholder="Trendline, fib, long position"
          aria-label="Search the drawing tools"
          className="min-w-0 flex-1 bg-transparent text-t12 text-textPrimary placeholder:text-textMuted outline-none"
          data-draw-search
        />
      </label>
      {!searching && (
        <div className="shrink-0 flex items-center gap-1 px-3 pt-2 overflow-x-auto [scrollbar-width:none]" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              title={t.full}
              onClick={() => setTab(t.id)}
              className={`shrink-0 h-6 px-2.5 rounded-full text-t11 whitespace-nowrap transition-colors ${tab === t.id ? 'bg-ink/[0.1] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05]'}`}
              data-draw-tab={t.id}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <div className="py-8 text-center text-t11 leading-snug text-textSecondary">{searching ? 'No tool by that name.' : 'Star a tool and it is kept here, and on the rail.'}</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {shown.map(t => {
              const on = drawTool === t.tool;
              return (
                <button
                  key={t.tool}
                  type="button"
                  onClick={() => {
                    onPick(t.tool);
                    onClose();
                  }}
                  className={`relative flex flex-col items-center justify-center gap-1.5 h-[64px] px-1 rounded-md border transition-colors ${on ? 'border-select/50 bg-select/10 text-select' : 'border-transparent bg-ink/[0.04] text-textPrimary hover:bg-ink/[0.08]'}`}
                  data-draw-tile={t.tool}
                >
                  <span className={`text-t18 inline-flex ${on ? '' : 'text-textSecondary'}`}>{t.icon}</span>
                  <span className="text-t105 leading-[1.15] text-center line-clamp-2">{t.label}</span>
                  <StarToggle kind={t.tool} on={prefs.favs.includes(t.tool)} className="absolute right-0.5 top-0.5 w-5 h-5" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    host
  );
};

/** The rail's middle: a button a family, the search, the star */
const DrawRailTools = ({ dock, big = false, drawing, drawTool, onPick, host, sheetOpen, onSheet }: RailToolsProps) => {
  const glyph = big ? 'w-5 h-5' : 'w-3.5 h-3.5';
  const prefs = useDrawToolPrefs();
  const [list, setList] = useState<OpenList>(null);
  const close = useRef(() => setList(null)).current;
  /* a tool taken, or the sheet opened, puts the list away */
  useEffect(() => {
    if (sheetOpen) setList(null);
  }, [sheetOpen]);
  const favTools = prefs.favs.map(k => drawToolDef(k)).filter((t): t is DrawToolDef => !!t);
  const openFamily = DRAW_FAMILIES.find(f => f.id === list?.id);

  return (
    <>
      <Rule dock={dock} big={big} />
      {DRAW_FAMILIES.map(f => {
        const worn = familyFace(f, prefs);
        const inHand = drawing && f.tools.some(t => t.tool === drawTool);
        /* a tool from this family in hand: the button wears THAT one, not the remembered one */
        const shownTool = inHand ? f.tools.find(t => t.tool === drawTool) ?? worn : worn;
        return (
          <ListButton
            key={f.id}
            testId={f.id}
            dock={dock}
            big={big}
            on={inHand}
            open={list?.id === f.id}
            title={shownTool.label}
            listTitle={f.name}
            icon={shownTool.icon}
            onFace={() => {
              setList(null);
              onPick(shownTool.tool);
            }}
            onList={anchor => setList(cur => (cur?.id === f.id ? null : { id: f.id, anchor }))}
          />
        );
      })}
      <Rule dock={dock} big={big} />
      <button
        type="button"
        onClick={() => onSheet(!sheetOpen)}
        title="Every drawing tool"
        aria-label="Every drawing tool"
        aria-expanded={sheetOpen}
        className={`shrink-0 inline-flex items-center justify-center rounded transition-colors ${cell(dock, big)} ${face(sheetOpen)}`}
        data-draw-sheet-door
      >
        <Search className={glyph} />
      </button>
      <ListButton
        testId="favs"
        dock={dock}
        big={big}
        on={false}
        open={list?.id === 'favs'}
        title="Your favourites"
        listTitle="Your favourites"
        icon={<Star className={glyph} fill={favTools.length ? 'currentColor' : 'none'} />}
        onFace={anchor => {
          if (anchor) setList(cur => (cur?.id === 'favs' ? null : { id: 'favs', anchor }));
        }}
        onList={anchor => setList(cur => (cur?.id === 'favs' ? null : { id: 'favs', anchor }))}
      />
      <AnimatePresence>
      {list && host && (openFamily || list.id === 'favs') && (
        <ToolList
          key={list.id}
          title={openFamily ? openFamily.name : 'Your favourites'}
          tools={openFamily ? openFamily.tools : favTools}
          empty="Star a tool in any list and it is kept here."
          anchor={list.anchor}
          dock={dock}
          host={host}
          drawTool={drawing ? drawTool : 'select'}
          favs={prefs.favs}
          onPick={onPick}
          onClose={close}
          footer={
            list.id === 'words' ? (
              <StampGrid
                current={prefs.stamp}
                onPick={() => {
                  onPick('stamp');
                  close();
                }}
              />
            ) : list.id === 'favs' ? (
              <label className="mt-1 flex items-center gap-2 h-7 px-2 rounded text-t11 text-textSecondary hover:bg-ink/[0.06] cursor-pointer border-t border-borderMuted">
                <input type="checkbox" checked={prefs.favBar} onChange={e => setDrawPref({ favBar: e.target.checked })} className="accent-current" data-draw-favbar-toggle />
                Show the favourites bar
              </label>
            ) : undefined
          }
        />
      )}
      </AnimatePresence>
    </>
  );
};

/* ---- TradingView's switches under the tools: magnet, stay in drawing mode, lock all, hide all ------------------------- */

/** Our magnet: a horseshoe, with a bar under it when it is strong */
export const MagnetGlyph = ({ strong, className = 'w-3.5 h-3.5' }: { strong: boolean; className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d="M4 2.5v5.5a4 4 0 0 0 8 0V2.5" />
    <path d="M2.6 2.5h2.8M10.6 2.5h2.8" strokeWidth="2" />
    {strong && <path d="M3.5 15h9" strokeWidth="1.6" />}
  </svg>
);
/** Stay in drawing mode: a pencil with a loop */
export const StayGlyph = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" />
    <path d="M1.8 15.2c2-1.4 4.2.9 6.2-.4 1-.6 1.6-1.4 3-1.2" />
  </svg>
);

interface SwitchProps {
  dock: Dock;
  allLocked: boolean;
  onLockAll: () => void;
  /** The object tree (TradingView's): every drawing on this tape, listed */
  treeOpen?: boolean;
  onTree?: () => void;
  /** Undo and redo for drawing changes (Ctrl+Z, Ctrl+Y) */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const DrawRailSwitches = ({ dock, allLocked, onLockAll, treeOpen, onTree, onUndo, onRedo, canUndo, canRedo }: SwitchProps) => {
  const prefs = useDrawToolPrefs();
  const sync = useDrawSync();
  const next = prefs.magnet === 'off' ? 'weak' : prefs.magnet === 'weak' ? 'strong' : 'off';
  const magnetWords = prefs.magnet === 'off' ? 'Magnet off — click for the weak magnet (snaps near a bar\'s open, high, low or close)' : prefs.magnet === 'weak' ? 'Weak magnet — click for the strong magnet (always snaps); hold Ctrl to flip it while drawing' : 'Strong magnet — click to turn the magnet off; hold Ctrl to flip it while drawing';
  const b = (on: boolean) => `shrink-0 inline-flex items-center justify-center rounded transition-colors ${cell(dock)} ${face(on)}`;
  return (
    <>
      <Rule dock={dock} />
      <button type="button" onClick={() => setDrawPref({ magnet: next })} title={magnetWords} aria-label={magnetWords} aria-pressed={prefs.magnet !== 'off'} className={b(prefs.magnet !== 'off')} data-draw-magnet={prefs.magnet}>
        <MagnetGlyph strong={prefs.magnet === 'strong'} />
      </button>
      <button type="button" onClick={() => setDrawPref({ stay: !prefs.stay })} title={prefs.stay ? 'Stay in drawing mode — on: a placed mark leaves the tool in hand' : 'Stay in drawing mode — off: a placed mark hands back the pointer'} aria-label="Stay in drawing mode" aria-pressed={prefs.stay} className={b(prefs.stay)} data-draw-stay>
        <StayGlyph />
      </button>
      <button type="button" onClick={onLockAll} title={allLocked ? 'Unlock all drawings' : 'Lock all drawings'} aria-label={allLocked ? 'Unlock all drawings' : 'Lock all drawings'} aria-pressed={allLocked} className={b(allLocked)} data-draw-lock-all>
        {allLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={() => setDrawPref({ hideAll: !prefs.hideAll })} title={prefs.hideAll ? 'Show all drawings (Ctrl+Alt+H)' : 'Hide all drawings (Ctrl+Alt+H)'} aria-label={prefs.hideAll ? 'Show all drawings' : 'Hide all drawings'} aria-pressed={prefs.hideAll} className={b(prefs.hideAll)} data-draw-hide-all>
        {prefs.hideAll ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={() => setDrawSync(!sync)} title={sync ? 'Sync drawings — on: every pane on this symbol shows the same drawings' : 'Sync drawings — off: each pane keeps its own drawings'} aria-label="Sync drawings" aria-pressed={sync} className={b(sync)} data-draw-sync>
        {sync ? <Link2 className="w-3.5 h-3.5" /> : <Link2Off className="w-3.5 h-3.5" />}
      </button>
      {onTree && (
        <button type="button" onClick={onTree} title="Object tree — every drawing on this chart: rename, hide, lock, reorder, delete" aria-label="Object tree" aria-pressed={!!treeOpen} className={b(!!treeOpen)} data-draw-tree-door>
          <ListTree className="w-3.5 h-3.5" />
        </button>
      )}
      {onUndo && (
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo the last drawing change (Ctrl+Z)" aria-label="Undo" className={`${b(false)} disabled:opacity-30`} data-draw-undo>
          <Undo2 className="w-3.5 h-3.5" />
        </button>
      )}
      {onRedo && (
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo" className={`${b(false)} disabled:opacity-30`} data-draw-redo>
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  );
};

/** The favourites bar (TradingView's): the starred tools in a row over the chart, while the reader asks for it */
export const DrawFavBar = ({ drawTool, onPick }: { drawTool: DrawingKind | 'select'; onPick: (k: DrawingKind) => void }) => {
  const prefs = useDrawToolPrefs();
  const tools = prefs.favs.map(k => drawToolDef(k)).filter((t): t is DrawToolDef => !!t);
  if (!prefs.favBar || tools.length === 0) return null;
  return (
    <div data-chart-rail data-draw-favbar className="absolute z-30 bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1 rounded-md border border-borderMuted bg-panel/75 backdrop-blur-md shadow-xl shadow-black/50 select-none max-w-[80%] overflow-x-auto [scrollbar-width:none]">
      <Star className="w-3 h-3 mx-1 shrink-0 text-silver" fill="currentColor" aria-hidden />
      {tools.map(t => (
        <button
          key={t.tool}
          type="button"
          title={t.label}
          aria-label={t.label}
          aria-pressed={drawTool === t.tool}
          onClick={() => onPick(t.tool)}
          className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded text-t15 transition-colors ${face(drawTool === t.tool)}`}
        >
          {t.icon}
        </button>
      ))}
      <button type="button" onClick={() => setDrawPref({ favBar: false })} title="Put the favourites bar away" aria-label="Put the favourites bar away" className="shrink-0 inline-flex items-center justify-center w-5 h-7 rounded text-textMuted hover:text-textPrimary">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

export default DrawRailTools;
