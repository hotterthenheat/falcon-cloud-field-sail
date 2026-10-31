/* Pulse, the desk you land on: tiles on a grid the reader arranges, on named desks that save as they go, each tile
   built from the live vendor book of its name. */

import { SessionTag } from '../../components/ui/SessionTag';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import RGL, { type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Check, Lock, LockOpen, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { buildExposureProfile } from '../../data/exposure';
import { levelsForName } from '../../data/levelsScope';
import { bookStatus, useBookRev } from '../../data/book/store';
import { ensureBook } from '../../data/book/load';
import { snapshotOf } from '../../data/book/feed';
import Chip from '../../components/ui/Chip';
import HoverReadout from '../../components/ui/HoverReadout';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import { afterGlide, beginGlide, glideTarget, onGlide } from '../../core/glide';
import PhoneChart from './PhoneChart';
import { ChartTileSkeleton } from './pulseSkeletons';
import { EmptyBox } from '../../components/ui/states';
import Picker from './Picker';
import Tile, { TILE_HEAD_H } from './TileFrame';
import { widgetByKey } from './registry';
import type { TileState, WidgetDef, WorkspaceCtx } from './tile';
import { firstFit, isPreset, loadDesks, PRESET_BLURBS, PRESET_NAMES, presetTemplate, saveDesks, type DeskStore, type SavedWorkspace, type WidgetInstance } from './desks';

/* The grid's own arithmetic (react-grid-layout calcGridItemWHPx): 12 columns, rows of 88, a 12px gutter, no
   padding */
const GRID_COLS = 12;
const GRID_GUTTER = 12;
const ROW_H = 88;
const tileWidth = (hostWidth: number, w: number): number => {
  const colWidth = (hostWidth - GRID_GUTTER * (GRID_COLS - 1)) / GRID_COLS;
  return Math.round(colWidth * w + Math.max(0, w - 1) * GRID_GUTTER);
};
const tileHeight = (h: number): number => ROW_H * h + Math.max(0, h - 1) * GRID_GUTTER;
/** The id the library gives the tile being dragged in from the picker */
const DROPPING = '__dropping';

/* The desk's width, measured before the first paint. The library's WidthProvider rendered the first frame at an
   assumed 1280px, learnt the real width a frame later, and its 200ms transform transition carried every tile from
   the wrong layout to the right one. Its `measureBeforeMount` is broken in 1.5.2. */
const useHostWidth = () => {
  const [width, setWidth] = useState<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    let held = false;
    let settle = 0;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const ro = new ResizeObserver(() => {
      if (!held) read();
    });
    ro.observe(el);
    /* The sidebar glide: the desk lays tiles out for the destination width at once and they travel there on the sidebar's clock
       (index.css [data-glide='frame']), sizing off the tile's promise (data-tile-width). */
    const off = onGlide(
      () => {
        if (document.documentElement.getAttribute('data-glide') !== 'frame') return;
        held = true;
        const to = glideTarget();
        if (to) {
          const main = document.querySelector('main');
          const gutters = main ? main.getBoundingClientRect().width - el.getBoundingClientRect().width : 0;
          flushSync(() => setWidth(Math.max(0, Math.round(to.mainWidth - gutters))));
          afterGlide(() => {
            held = false;
            read();
          });
          return;
        }
        /* no destination given: hold, and take ONE layout when it settles */
        afterGlide(() => {
          held = false;
          el.setAttribute('data-settle', '');
          flushSync(read);
          settle = requestAnimationFrame(() => el.removeAttribute('data-settle'));
        });
      },
      () => undefined
    );
    cleanup.current = () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(settle);
    };
  }, []);
  return [ref, width] as const;
};

const SCAN_INTERVAL_MS = 10_000;
/* How often the desk asks the vendor book to refresh each name it shows */
const BOOK_MS = 30_000;

/** What a desk holds, on its tab's hover — its purpose and its tiles by name, read off the saved layout itself */
const DeskPeek = ({ name, ws }: { name: string; ws: SavedWorkspace }) => (
  <>
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-t11 font-semibold text-textPrimary">{name}</span>
      <span className="font-mono text-t9 uppercase tracking-wider text-textMuted tnum">
        {ws.instances.length} {ws.instances.length === 1 ? 'tile' : 'tiles'}
      </span>
    </div>
    {PRESET_BLURBS[name] && <p className="mt-1 text-t10 leading-snug text-textSecondary">{PRESET_BLURBS[name]}</p>}
    <ul className="mt-2 flex flex-col gap-0.5">
      {ws.instances.map((i, n) => (
        <li key={`${i.id}-${n}`} className="font-mono text-t10 text-textSecondary">
          <span className="text-textMuted">· </span>
          {widgetByKey(i.key)?.title ?? i.key}
        </li>
      ))}
    </ul>
  </>
);

const barBtn = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-ink/[0.02] hover:bg-ink/[0.05] hover:border-borderMuted font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors';

const Pulse = () => {
  const { activeTicker, changeTicker } = useTicker();
  const isPhone = useIsPhone();
  const navigate = useNavigate();

  // ---- desks: named layouts, every one saving its own working state as it goes ----
  const [store, setStore] = useState<DeskStore>(loadDesks);
  const active = store.active;
  const locked = !!store.locked;
  const [instances, setInstances] = useState<WidgetInstance[]>(() => store.desks[store.active].instances);
  const [layout, setLayout] = useState<Layout[]>(() => store.desks[store.active].layout);
  const [savingAs, setSavingAs] = useState(false);
  const [newName, setNewName] = useState('');
  const saveInputRef = useRef<HTMLInputElement | null>(null);

  // The working state flows into the active desk's slot, and the whole store persists on every change
  useEffect(() => {
    setStore(prev => ({ ...prev, desks: { ...prev.desks, [prev.active]: { instances, layout } } }));
  }, [instances, layout]);
  useEffect(() => {
    saveDesks(store);
  }, [store]);

  const loadWorkspace = (ws: SavedWorkspace) => {
    setInstances(ws.instances);
    setLayout(ws.layout);
  };

  /* A desk changes in two beats: the desk in hand fades out, then the next mounts under a fresh key and breathes
     in. A timer, never an animation's end. */
  const [switching, setSwitching] = useState(false);
  const [deskRef, deskWidth] = useHostWidth();
  const switchTimer = useRef(0);
  const switchDesk = (name: string) => {
    if (name === active || switching) return;
    const ws = store.desks[name];
    if (!ws) return;
    setSwitching(true);
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => {
      setStore(prev => ({ ...prev, active: name }));
      loadWorkspace(ws);
      setSwitching(false);
    }, 220);
  };
  useEffect(() => () => window.clearTimeout(switchTimer.current), []);

  const saveAs = () => {
    const name = newName.trim();
    // the house's names are the templates a desk resets TO
    if (!name || isPreset(name)) return;
    setStore(prev => ({ ...prev, active: name, desks: { ...prev.desks, [name]: { instances, layout } } }));
    setSavingAs(false);
    setNewName('');
  };
  const deleteDesk = (name: string) => {
    if (isPreset(name)) return;
    const fallback = PRESET_NAMES[0];
    setStore(prev => {
      const desks = { ...prev.desks };
      delete desks[name];
      return { ...prev, active: prev.active === name ? fallback : prev.active, desks };
    });
    if (active === name) loadWorkspace(store.desks[fallback]);
  };
  /** A house desk goes back to its template; a desk of the reader's own has nothing to go back to */
  const reset = () => {
    const tpl = presetTemplate(active);
    if (tpl) loadWorkspace(tpl);
  };
  useEffect(() => {
    if (savingAs) requestAnimationFrame(() => saveInputRef.current?.focus());
  }, [savingAs]);
  const customNames = useMemo(() => Object.keys(store.desks).filter(n => !isPreset(n)), [store.desks]);

  // what a desk holds, on its tab's hover
  const [peek, setPeek] = useState<{ name: string; x: number; y: number } | null>(null);
  const peekHandlers = (name: string) => ({
    onMouseEnter: (e: React.MouseEvent) => setPeek({ name, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setPeek({ name, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPeek(null),
  });

  /* A tile whose widget has left the registry would stand as an invisible box that still drags. loadDesks drops
     them at the start; this drops them mid-flight. */
  useEffect(() => {
    if (!instances.some(w => !widgetByKey(w.key))) return;
    const alive = instances.filter(w => widgetByKey(w.key));
    setInstances(alive);
    setLayout(prev => prev.filter(l => alive.some(w => w.id === l.i)));
  }, [instances]);

  // ---- the feed: the live vendor book, one snapshot a name a sweep ----
  const bookRev = useBookRev();
  /* Every name a tile HOLDS (a linked tile is on the desk's). An untouched desk builds exactly one context. */
  const heldNames = useMemo(() => [...new Set(instances.filter(i => i.ticker && widgetByKey(i.key)?.named).map(i => i.ticker as string))].sort().join('|'), [instances]);
  const names = useMemo(() => [...new Set([activeTicker, ...heldNames.split('|').filter(Boolean)])], [activeTicker, heldNames]);
  useEffect(() => {
    const ask = () => names.forEach(t => ensureBook(t));
    ask();
    const id = window.setInterval(ask, BOOK_MS);
    return () => window.clearInterval(id);
  }, [names]);
  /* a sweep at most every ten seconds — the book can land more often than the tiles need to rebuild — except the
     first time a name's book lands: its tiles fill at once instead of waiting out the interval */
  const [sweep, setSweep] = useState(0);
  const lastSweep = useRef(0);
  const built = useRef(new Set<string>());
  useEffect(() => {
    const landed = names.some(t => !built.current.has(t) && snapshotOf(t) != null);
    const due = landed ? 0 : SCAN_INTERVAL_MS - (Date.now() - lastSweep.current);
    if (due <= 0) {
      lastSweep.current = Date.now();
      setSweep(n => n + 1);
      return;
    }
    const id = window.setTimeout(() => {
      lastSweep.current = Date.now();
      setSweep(n => n + 1);
    }, due);
    return () => window.clearTimeout(id);
  }, [bookRev, names]);

  /* One context a name, a sweep; a name whose live book has not landed has none yet, and its tile says so */
  const contexts = useMemo(() => {
    const map = new Map<string, WorkspaceCtx>();
    for (const t of names) {
      const snapshot = snapshotOf(t);
      if (!snapshot) continue;
      try {
        map.set(t, { ticker: snapshot.ticker, snapshot, exposure: buildExposureProfile(snapshot, levelsForName(t), 10), revision: sweep });
      } catch {
        /* a name the book cannot build is skipped — its tile says so */
      }
    }
    built.current = new Set(map.keys());
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep, names]);
  const scanSnapshot = contexts.get(activeTicker)?.snapshot ?? null;
  const revision = sweep;
  const deskCtx = contexts.get(activeTicker) ?? null;
  const ctxOf = (def: WidgetDef, inst: WidgetInstance): WorkspaceCtx | null => (def.named && inst.ticker ? contexts.get(inst.ticker) ?? null : deskCtx);
  const stateOf = (def: WidgetDef, inst: WidgetInstance): TileState => {
    const merged = { ...def.defaults, ...inst.state };
    return def.resolve ? def.resolve(merged) : merged;
  };

  // ---- tiles: add, drop, duplicate, settle, remove ----
  const counterRef = useRef(1);
  const newId = (key: string) => `${key}-${Date.now().toString(36)}-${++counterRef.current}`;
  const bounds = (def: WidgetDef) => ({ minW: def.minW, minH: def.minH, maxH: def.maxH });
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dragDef = dragKey ? widgetByKey(dragKey) : undefined;

  /** The first gap from the top that takes it, shrinking toward its floor when the gap is narrower */
  const addWidget = (key: string) => {
    const def = widgetByKey(key);
    if (!def) return;
    const id = newId(key);
    setInstances(prev => [...prev, { id, key }]);
    setLayout(prev => [...prev, { i: id, ...firstFit(prev, def), ...bounds(def) }]);
    setPickerOpen(false);
  };
  /** Dropped from the picker: where the reader let go */
  const dropWidget = (next: Layout[], item: Layout | undefined) => {
    const def = dragDef;
    setDragKey(null);
    setPickerOpen(false);
    if (!def || !item) return;
    const id = newId(def.key);
    setInstances(prev => [...prev, { id, key: def.key }]);
    setLayout([...next.filter(l => l.i !== DROPPING), { i: id, x: item.x, y: item.y, w: def.w, h: def.h, ...bounds(def) }]);
  };
  const duplicate = (inst: WidgetInstance, def: WidgetDef) => {
    const id = newId(inst.key);
    const own = layout.find(l => l.i === inst.id);
    setInstances(prev => [...prev, { ...inst, id, state: inst.state ? { ...inst.state } : undefined }]);
    setLayout(prev => [...prev, { i: id, ...firstFit(prev, { w: own?.w ?? def.w, h: own?.h ?? def.h, minW: def.minW, minH: def.minH }), ...bounds(def) }]);
  };
  const resetSize = (inst: WidgetInstance, def: WidgetDef) => setLayout(prev => prev.map(l => (l.i === inst.id ? { ...l, w: Math.min(def.w, GRID_COLS - Math.min(l.x, GRID_COLS - def.w)), x: Math.min(l.x, GRID_COLS - def.w), h: def.h } : l)));
  const removeWidget = (id: string) => {
    setInstances(prev => prev.filter(w => w.id !== id));
    setLayout(prev => prev.filter(l => l.i !== id));
  };
  const patchState = (id: string, patch: TileState) => setInstances(prev => prev.map(w => (w.id === id ? { ...w, state: { ...w.state, ...patch } } : w)));

  /* THE LINK: a tile with no name of its own follows the terminal, and a pick on it MOVES the terminal — every
     linked tile follows. A tile holding a name keeps its pick to itself. Unlinking pins it to what it shows now,
     so nothing jumps at the moment of unlinking. */
  const setTileTicker = (id: string, ticker: string | undefined) => setInstances(prev => prev.map(w => (w.id === id ? { ...w, ticker } : w)));
  const pickFor = (inst: WidgetInstance) => (t: string) => {
    if (inst.ticker === undefined) changeTicker(t);
    else setTileTicker(inst.id, t);
  };

  /* Every door is a page. The tile's real page, on the tile's name, set up to show what the tile showed, carrying
     the way back. */
  const openPage = (def: WidgetDef, inst: WidgetInstance) => {
    const page = def.page;
    if (!page) return;
    if (page.run) {
      page.run();
      return;
    }
    const ctx = ctxOf(def, inst);
    const state = stateOf(def, inst);
    if (def.named && inst.ticker && inst.ticker !== activeTicker) changeTicker(inst.ticker);
    if (ctx) page.prepare?.(state, ctx);
    const path = typeof page.path === 'string' ? page.path : page.path(state);
    navigate(`${path}${ctx ? page.search?.(state, ctx) ?? '' : ''}`, { state: { ...(ctx ? page.state?.(state, ctx) : undefined), wayBack: '/pulse' } });
  };

  /* The phone gets one chart, not a stacked desk. Branched here, not hidden with CSS: a hidden grid still MOUNTS —
     its tiles building canvases behind a screen nobody can see, on the device least able to carry them. The desks
     above are untouched: a reader back on a laptop finds their arrangement as they left it. */
  if (isPhone) {
    return (
      /* Full bleed over the shell's padding; `dvh`, so the chart's own axis is not under the browser's bar on arrival */
      <div className="-mx-4 -mt-5 -mb-16 flex h-[calc(100dvh-3rem)] flex-col">
        {scanSnapshot ? (
          <PhoneChart key={scanSnapshot.ticker} snapshot={scanSnapshot} revision={revision} onPick={changeTicker} />
        ) : (
          bookStatus(activeTicker) === 'error' ? (
            <EmptyBox title={`No book for ${activeTicker} yet`} reason="The market-data feed did not answer for this name's dealer book. The desk asks again shortly." />
          ) : (
            <ChartTileSkeleton />
          )
        )}
      </div>
    );
  }

  const counts = instances.reduce<Record<string, number>>((a, i) => ((a[i.key] = (a[i.key] ?? 0) + 1), a), {});
  const boxFor = (w: number, h: number) => ({ width: tileWidth(deskWidth ?? 1200, w), height: tileHeight(h) - TILE_HEAD_H });
  const deskTab = (name: string, own: boolean) => (
    <span key={name} className={own ? 'group inline-flex items-center' : 'inline-flex'} {...peekHandlers(name)} data-desk-tab={name} data-desk-on={active === name || undefined}>
      <Chip active={active === name} onClick={() => switchDesk(name)} title="">
        {/* every desk wears a dot; the one you are ON is the selection's silver — "you are here" */}
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-1 h-1 rounded-full shrink-0 ${active === name ? 'bg-select' : 'bg-silver/50'}`} aria-hidden />
          {name}
        </span>
      </Chip>
      {own && (
        <button onClick={() => deleteDesk(name)} aria-label={`Delete the ${name} desk`} title="Delete this desk" className="w-4 h-4 inline-flex items-center justify-center rounded text-textMuted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:!text-bear transition-opacity">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </span>
  );

  return (
    <>
      {/* The desk bar — one row: where you are, the desks (the house's, then yours), and what you can do to this
          one */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap min-h-9" data-desk-bar>
        <h1 className="text-t15 font-semibold leading-tight text-textPrimary">Pulse</h1>
        {/* the session the desk's books belong to (core/session.ts) */}
        <SessionTag className="max-sm:hidden" what="Books" />
        <span className="w-px h-4 bg-borderSubtle" aria-hidden />
        <span className="flex items-center gap-0.5 flex-wrap" data-desk-presets>
          {PRESET_NAMES.map(n => deskTab(n, false))}
        </span>
        {customNames.length > 0 && (
          <>
            <span className="w-px h-3.5 bg-borderSubtle" aria-hidden />
            <span className="flex items-center gap-0.5 flex-wrap" data-desk-yours>
              {customNames.map(n => deskTab(n, true))}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {savingAs ? (
            <form
              onSubmit={e => {
                e.preventDefault();
                saveAs();
              }}
              className="inline-flex items-center gap-1"
            >
              <input
                ref={saveInputRef}
                value={newName}
                onChange={e => setNewName(e.target.value.slice(0, 24))}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setSavingAs(false);
                    setNewName('');
                  }
                }}
                placeholder="Name this desk…"
                className="w-40 h-7 bg-inset border border-borderSubtle rounded-md px-2 font-mono text-t11 text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-borderMuted"
                data-desk-name
              />
              <button type="submit" disabled={!newName.trim() || isPreset(newName.trim())} title={isPreset(newName.trim()) ? 'That name is one of the house’s desks' : 'Save'} className="p-1 rounded text-textSecondary hover:text-textPrimary disabled:opacity-30 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSavingAs(false);
                  setNewName('');
                }}
                className="p-1 rounded text-textMuted hover:text-textPrimary transition-colors"
                aria-label="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button onClick={() => setSavingAs(true)} title="Keep this arrangement as a desk of your own" className={barBtn} data-desk-save>
              <Save className="w-3 h-3" /> Save as
            </button>
          )}
          {isPreset(active) && (
            <button onClick={reset} title={`Put ${active} back the way it came`} className={barBtn} data-desk-reset>
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
          <button
            onClick={() => setStore(prev => ({ ...prev, locked: !prev.locked }))}
            aria-pressed={locked}
            title={locked ? 'The desk is held still — unlock it to move or resize a tile' : 'Hold the desk still: nothing drags, nothing resizes'}
            aria-label={locked ? 'Unlock the desk' : 'Lock the desk'}
            className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${locked ? 'border-silver/50 text-silver bg-silver/[0.08]' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted'}`}
            data-desk-lock={locked ? 'on' : 'off'}
          >
            {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
          </button>
          <span className="relative">
            <button onClick={() => setPickerOpen(o => !o)} aria-expanded={pickerOpen} className="relative foil-glide inline-flex items-center gap-1.5 h-7 px-3 rounded-md holo-bg text-onfoil hover:brightness-105 font-mono text-t11 font-semibold uppercase tracking-wider transition-all" data-picker-open>
              <Plus className="w-3.5 h-3.5" /> Add widget
            </button>
            {pickerOpen && <Picker ctx={deskCtx} counts={counts} boxFor={boxFor} onAdd={addWidget} onDragKey={setDragKey} onClose={closePicker} />}
          </span>
        </span>
      </div>

      {peek && store.desks[peek.name] && (
        <HoverReadout x={peek.x} y={peek.y}>
          <DeskPeek name={peek.name} ws={store.desks[peek.name]} />
        </HoverReadout>
      )}

      {/* THE GRID — drawn at once, each tile in its own shape until its name's book lands; it fades out on a switch,
          then the next desk mounts under a fresh key and breathes in */}
      {(
        <div key={active} ref={deskRef} /* while a widget is dragged in from the picker the tiles let the pointer through: the library reads the drop's place
             off the element under the pointer, and a tile under it would answer in its own coordinates */
          className={`animate-soft-in-slow transition-opacity duration-200 ease-out ${switching ? 'opacity-0' : 'opacity-100'} ${dragKey ? '[&_.react-grid-item]:pointer-events-none' : ''}`}
          data-desk={active} data-desk-locked={locked || undefined}>
          {instances.length === 0 && !dragKey && (
            <div className="h-64 border border-dashed border-borderMuted rounded-md flex flex-col items-center justify-center gap-3" data-desk-empty>
              <span className="text-t12 text-textSecondary">This desk is empty.</span>
              <button onClick={() => setPickerOpen(true)} className={barBtn} data-picker-open>
                <Plus className="w-3 h-3" /> Add a widget
              </button>
            </div>
          )}
          {deskWidth != null && (instances.length > 0 || dragKey) && (
            <RGL
              layout={layout}
              /* the host's own measure — see useHostWidth */
              width={deskWidth}
              cols={GRID_COLS}
              rowHeight={ROW_H}
              margin={[GRID_GUTTER, GRID_GUTTER]}
              containerPadding={[0, 0]}
              /* the rows close up under a tile taken away */
              compactType="vertical"
              draggableHandle=".widget-drag"
              isDraggable={!locked}
              isResizable={!locked}
              /* every corner resizes — the library defaults to the bottom right alone */
              resizeHandles={['se', 'sw', 'ne', 'nw']}
              /* a widget dragged out of the picker lands where it is let go */
              isDroppable={!!dragDef}
              droppingItem={dragDef ? { i: DROPPING, w: dragDef.w, h: dragDef.h } : undefined}
              onDrop={(next: Layout[], item: Layout) => dropWidget(next, item)}
              /* THE SNAP: on release the library glides the item to its grid size over 200ms, and a chart inside
                 re-laid itself on every frame of it. It holds through the snap and takes the final size once. */
              onDragStop={() => beginGlide(260, 'snap')}
              onResizeStop={() => beginGlide(260, 'snap')}
              onLayoutChange={(next: Layout[]) => setLayout(next.filter(l => l.i !== DROPPING))}
              style={{ minHeight: dragKey ? 360 : undefined }}
            >
              {instances.map((inst, idx) => {
                const def = widgetByKey(inst.key);
                if (!def) return <div key={inst.id} />;
                const width = tileWidth(deskWidth, layout.find(l => l.i === inst.id)?.w ?? def.w);
                return (
                  <div
                    key={inst.id}
                    className="border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col"
                    /* The tile's promise (core/glide.ts): its laid-out width, which during the sidebar's glide is
                       where it is going — what is inside sizes for it at once */
                    data-tile-width={width}
                    data-tile={def.key}
                  >
                    <Tile
                      def={def}
                      ctx={ctxOf(def, inst)}
                      state={stateOf(def, inst)}
                      onState={patch => patchState(inst.id, patch)}
                      width={width}
                      index={idx}
                      locked={locked}
                      scope={def.named ? { ticker: inst.ticker ?? activeTicker, linked: inst.ticker === undefined, onPick: pickFor(inst), onToggleLink: () => setTileTicker(inst.id, inst.ticker === undefined ? activeTicker : undefined) } : undefined}
                      onOpen={def.page ? () => openPage(def, inst) : undefined}
                      onDuplicate={() => duplicate(inst, def)}
                      onResetSize={() => resetSize(inst, def)}
                      onRemove={() => removeWidget(inst.id)}
                      bookFailed={bookStatus(def.named && inst.ticker ? inst.ticker : activeTicker) === 'error'}
                      deskTicker={activeTicker}
                    />
                  </div>
                );
              })}
            </RGL>
          )}
        </div>
      )}
    </>
  );
};

export default Pulse;
