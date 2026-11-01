/* What can go on a pane and what is on it: the built-in scripts, the classic technicals, the chart's tools, your
   scripts and favourites, with one search, a tick to draw one and a gear for its inputs. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Settings2, Star } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import { armScript, removeAlert, useAlerts } from '../gex/alertStore';
import { builtinScripts } from '../../data/builtinScripts';
import { openEditor, recentScripts, remember } from '../../data/editorDock';
import { bumpLibrary, getPaneBars, liftFromPane, placeOnPane, updateOnPane, useLibraryVersion, usePaneScripts, type PaneScript } from '../../data/paneScripts';
import { scriptStore } from '../../data/scriptStore';
import type { ChartScript, PaneId, Script, ScriptInput, ScriptInputValue } from '../../types/scripts';
import Modal from '../ui/Modal';
import { INDICATOR_ITEMS, indicatorBlurb, physicsOf } from '../gex/indicatorItems';
import IndicatorSettings, { PhysicsTag } from '../gex/IndicatorSettings';
import { DEFAULT_OVERLAYS, MAX_SUB_PANES, SUB_PANE_ORDER, type ChartIndicators, type ChartOverlays } from '../gex/StrikeChart';
import { NODE_LOOKS, setDeskPrefs, useDeskPrefs } from '../../data/deskPrefs';
import { OPENING_RANGES, type OpeningRange } from '../../data/sessionLevels';

type Shelf = 'recent' | 'favourites' | 'mine' | 'slayer' | 'physics' | 'technicals' | 'chart';
type Kind = 'slayer' | 'pine' | 'chart';

interface Row {
  key: string;
  kind: Kind;
  title: string;
  description: string;
  pane: 'overlay' | 'own';
  group: string;
  script?: Script;
  chartKey?: keyof ChartIndicators;
  on: boolean;
  placed?: PaneScript;
  inputs: ScriptInput[];
}

const SHELVES: { key: Shelf; label: string; section: 'Personal' | 'Built in' }[] = [
  /* what you added to a chart or opened lately, newest first */
  { key: 'recent', label: 'Recently used', section: 'Personal' },
  { key: 'favourites', label: 'Favourites', section: 'Personal' },
  { key: 'mine', label: 'My scripts', section: 'Personal' },
  { key: 'slayer', label: 'Slayer', section: 'Built in' },
  /* the five reads the physics study kept, each under its plain name and how it is made */
  { key: 'physics', label: 'Physics reads', section: 'Built in' },
  { key: 'technicals', label: 'Technicals', section: 'Built in' },
  { key: 'chart', label: 'Chart tools', section: 'Built in' },
];

const KIND_WORD: Record<Kind, string> = { slayer: 'slayer', pine: 'pine', chart: 'chart' };

/* ---- the script's own alerts ------------------------------------------------------ */

/* Tell me when, for a script: every `alertcondition(...)` the script declares, as a switch — the Targets card's
   grammar. Set in place: armed here for THIS name on THIS pane's timeframe with the placement's inputs; judged by
   the shell's watcher on every page; rung through the bell like every other alert. */
const AlertSwitches = ({ script, chart, paneId }: { script: Script; chart: ChartScript; paneId: PaneId }) => {
  const pane = getPaneBars(paneId);
  const ticker = pane?.ticker ?? '';
  const alerts = useAlerts(ticker);
  const conditions = script.meta?.alerts ?? [];
  if (!pane || !ticker || conditions.length === 0) return null;
  const hit = (id: string) => alerts.find(a => a.kind === 'script' && a.scriptId === script.id && a.conditionId === id && a.paneId === paneId && !a.firedAt);
  const set = (c: { id: string; title: string; message: string }, on: boolean) => {
    const h = hit(c.id);
    if (!on && h) removeAlert(ticker, h.id);
    else if (on && !h) armScript(ticker, { scriptId: script.id, scriptTitle: script.title, conditionId: c.id, title: c.title, message: c.message, paneId, tf: pane.timeframe, inputs: chart.inputs, armedBar: pane.bars[pane.bars.length - 1]?.time ?? 0 }, Date.now());
  };
  return (
    <div className="col-span-3 mt-1 pt-2 border-t border-borderSubtle/60" data-script-alerts>
      <div className="pb-1 font-mono text-t8 uppercase tracking-[0.14em] text-textMuted">
        Tell me when · {ticker} · {pane.timeframe}
      </div>
      {conditions.map(c => {
        const on = !!hit(c.id);
        const id = `script-alert-${script.id}-${c.id}`;
        return (
          <label key={c.id} htmlFor={id} className="flex items-center gap-3 h-7 cursor-pointer" data-script-alert={c.id}>
            <span className={`flex-1 min-w-0 truncate font-mono text-t11 ${on ? 'font-semibold text-silver' : 'text-textPrimary'}`} title={c.message || undefined}>
              {c.title}
            </span>
            <Switch.Root
              id={id}
              checked={on}
              onCheckedChange={v => set(c, v)}
              aria-label={c.title}
              className="relative shrink-0 w-8 h-[18px] rounded-full border border-borderSubtle bg-ink/[0.06] data-[state=checked]:bg-silver data-[state=checked]:border-silver transition-colors outline-none focus-visible:ring-2 focus-visible:ring-silver/60"
            >
              <Switch.Thumb className="block w-3 h-3 rounded-full bg-textPrimary translate-x-[2px] data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-panel transition-transform" />
            </Switch.Root>
          </label>
        );
      })}
    </div>
  );
};

/* ---- the inputs form ------------------------------------------------------------- */

const InputsForm = ({ inputs, chart, paneId, script }: { inputs: ScriptInput[]; chart: ChartScript; paneId: PaneId; script: Script }) => {
  const set = (id: string, v: ScriptInputValue) => void updateOnPane(paneId, { ...chart, inputs: { ...chart.inputs, [id]: v } });
  const reset = () => void updateOnPane(paneId, { ...chart, inputs: {} });
  const val = (i: ScriptInput): ScriptInputValue => chart.inputs[i.id] ?? i.default;
  const SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'];
  const field = 'h-7 px-2 rounded-md border border-borderSubtle bg-chip font-mono text-t11 text-textPrimary outline-none focus:border-borderMuted';
  return (
    <div className="mx-2 mb-2 px-3 py-2.5 rounded-md border border-borderSubtle/60 bg-chip grid grid-cols-3 gap-x-4 gap-y-2" data-script-inputs>
      {inputs.map(i => (
        <label key={i.id} className="flex items-center gap-2 min-w-0" title={i.tooltip}>
          <span className="w-[120px] shrink-0 truncate text-t10 text-textSecondary">{i.title}</span>
          {i.kind === 'bool' ? (
            <input type="checkbox" checked={!!val(i)} onChange={e => set(i.id, e.target.checked)} className="accent-[rgb(var(--select))]" />
          ) : i.kind === 'color' ? (
            <input type="color" value={String(val(i)).slice(0, 7)} onChange={e => set(i.id, e.target.value)} className="h-7 w-10 bg-transparent border border-borderSubtle rounded-md" />
          ) : i.kind === 'source' ? (
            <select value={String(val(i))} onChange={e => set(i.id, e.target.value)} className={field}>
              {SOURCES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : i.options ? (
            <select value={String(val(i))} onChange={e => set(i.id, e.target.value)} className={field}>
              {i.options.map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : i.kind === 'int' || i.kind === 'float' ? (
            <input type="number" value={Number(val(i))} min={i.min} max={i.max} step={i.step ?? (i.kind === 'int' ? 1 : 0.1)} onChange={e => set(i.id, i.kind === 'int' ? Math.round(Number(e.target.value)) : Number(e.target.value))} className={`${field} w-20`} />
          ) : (
            <input type="text" value={String(val(i))} onChange={e => set(i.id, e.target.value)} className={`${field} w-32`} />
          )}
        </label>
      ))}
      {inputs.length > 0 && (
        <div className="col-span-3 flex justify-end">
          <button onClick={reset} className="font-mono text-t9 uppercase tracking-wider text-textMuted hover:text-textPrimary transition-colors">
            Back to the script's defaults
          </button>
        </div>
      )}
      <AlertSwitches script={script} chart={chart} paneId={paneId} />
    </div>
  );
};

/* ---- the library ------------------------------------------------------------------- */

interface ScriptLibraryProps {
  open: boolean;
  onClose: () => void;
  paneId?: PaneId;
  indicators?: ChartIndicators;
  onIndicators?: (next: ChartIndicators) => void;
  /** The editor sits beside a FULL-SCREEN chart only — off, the doors to it stay shut and say why */
  fullscreen?: boolean;
  overlays?: ChartOverlays;
  onOverlays?: (next: ChartOverlays) => void;
  coneHorizon?: 'session' | 'week' | 'next';
  onConeHorizon?: (h: 'session' | 'week' | 'next') => void;
  trailGreek?: 'gex' | 'dex' | 'vex';
  onTrailGreek?: (g: 'gex' | 'dex' | 'vex') => void;
  sessionOr?: OpeningRange;
  onSessionOr?: (m: OpeningRange) => void;
  barClock?: string;
}

const EDITOR_SHUT = 'Open the chart full screen first — the editor sits beside it';

const OVERLAY_ROWS: { key: keyof ChartOverlays; label: string; hint: string; pane: string }[] = [
  { key: 'trails', label: 'Exposure trails', hint: 'Peak nodes on the tape. Size is the greek at that strike.', pane: 'on the tape' },
  { key: 'levels', label: 'Key levels', hint: 'Call wall, put wall, flip, supreme.', pane: 'on the tape' },
  { key: 'darkpool', label: 'Dark pool', hint: 'Off-exchange prints, when the feed has them.', pane: 'on the tape' },
  { key: 'volume', label: 'Volume', hint: 'Share volume along the floor.', pane: 'on the tape' },
  { key: 'flow', label: 'Flow', hint: 'Call premium up, put premium down, on this chart’s minutes.', pane: 'own pane' },
  { key: 'netDrift', label: 'Net drift', hint: 'Running call and put premium.', pane: 'own pane' },
  { key: 'volDrift', label: 'Vol drift', hint: 'Realised vol of these bars against the book’s IV.', pane: 'own pane' },
  { key: 'session', label: 'Session levels', hint: 'Previous high, low and close, the opening range, the first hour.', pane: 'on the tape' },
  { key: 'cone', label: 'Expected move', hint: 'The wedge the options priced from here to the horizon.', pane: 'on the tape' },
  { key: 'wind', label: 'Wind · model forecast', hint: 'A model’s paths for the rest of today’s session: the implied vol, bent by the dealer book. A forecast, not a price.', pane: 'on the tape' },
  { key: 'events', label: 'Events', hint: 'Earnings, FOMC, CPI, NFP, and the largest prints.', pane: 'on the tape' },
  { key: 'alerts', label: 'Alert lines', hint: 'A line where a price alert is waiting.', pane: 'on the tape' },
  { key: 'dexStrike', label: 'Exposure by strike', hint: 'The chain, docked under the tape.', pane: 'own pane' },
  /* the two session washes: on by default, and until now switchable only from the overlays menu, which a pane with the
     library (Terrain) does not show */
  { key: 'extHours', label: 'Extended hours', hint: 'A faint wash behind the pre-market, after-hours and overnight bars. Intraday only.', pane: 'on the tape' },
  { key: 'sessionBreaks', label: 'Session breaks', hint: 'A dashed rule where each session day starts. Intraday only.', pane: 'on the tape' },
];

const CLOCK_HELD = new Set<keyof ChartOverlays>(['trails', 'flow', 'netDrift', 'volDrift', 'session', 'cone', 'wind', 'events']);
/* Book lines and share VWAP have no session to cut on a rule clock. Keyed by the indicator, not the shelf group — search rewrites the group. */
const CLOCK_HELD_CHART = new Set<keyof ChartIndicators>(['vwap', 'vwapBands', 'flowVwap', 'sideVwap', 'gammaEma', 'gammaVwap', 'harBand', 'gammaRegime', 'volShock']);
/* the kind and shelf columns fold away on a phone */
const ROW_GRID = 'grid items-center gap-x-2 px-2 grid-cols-[minmax(0,1fr)_28px_28px_36px] sm:grid-cols-[68px_minmax(0,1fr)_88px_28px_28px_44px]';

const ScriptLibrary = ({
  open,
  onClose,
  paneId,
  indicators,
  onIndicators,
  fullscreen = false,
  overlays,
  onOverlays,
  coneHorizon = 'session',
  onConeHorizon,
  trailGreek = 'gex',
  onTrailGreek,
  sessionOr = 15,
  onSessionOr,
  barClock,
}: ScriptLibraryProps) => {
  const [shelf, setShelf] = useState<Shelf>('slayer');
  const { nodeLook } = useDeskPrefs();
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState<Script[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<keyof ChartIndicators | null>(null);
  /* bumped when something is remembered, so the Recently used shelf re-reads */
  const [recentTick, setRecentTick] = useState(0);
  const version = useLibraryVersion();
  const placed = usePaneScripts(paneId);
  /* The editor is the dock's: opening a script closes this chooser so the chart shows under the code */
  const edit = useCallback(
    (script: Script | null) => {
      if (!fullscreen) return;
      if (script) remember(script);
      openEditor(script, paneId);
      onClose();
    },
    [paneId, onClose, fullscreen]
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const [m, f] = await Promise.all([scriptStore.list('mine'), scriptStore.favourites()]);
      if (!alive) return;
      setMine(m);
      setFavourites(new Set(f.map(x => x.scriptId)));
    })();
    return () => {
      alive = false;
    };
  }, [open, version]);

  const subsOn = useMemo(() => SUB_PANE_ORDER.filter(k => indicators?.[k]).length + placed.filter(p => p.chart.visible && p.script.meta?.pane === 'own').length, [indicators, placed]);

  const rowFor = useCallback(
    (s: Script): Row => {
      const p = placed.find(x => x.script.id === s.id);
      return { key: s.id, kind: s.tags[0] === 'Slayer' ? 'slayer' : 'pine', title: s.title, description: s.description, pane: s.meta?.pane ?? 'overlay', group: s.tags[0] ?? 'My scripts', script: s, on: !!p, placed: p, inputs: s.meta?.inputs ?? [] };
    },
    [placed]
  );

  const allRows = useMemo<Record<Shelf, Row[]>>(() => {
    const builtins = builtinScripts();
    const slayer = builtins.filter(s => s.tags[0] === 'Slayer').map(rowFor);
    const technicals = builtins.filter(s => s.tags[0] !== 'Slayer').map(rowFor);
    const chartRow = (i: (typeof INDICATOR_ITEMS)[number]): Row => ({ key: `chart:${i.key}`, kind: 'chart', title: i.label, description: i.hint, pane: i.sub ? 'own' : 'overlay', group: i.group === 'book' ? 'From the book' : i.group === 'physics' ? 'Five tested reads' : 'Chart built-ins', chartKey: i.key, on: !!indicators?.[i.key], inputs: [] });
    const chart: Row[] = INDICATOR_ITEMS.filter(i => i.group !== 'physics').map(chartRow);
    const physics: Row[] = indicators ? INDICATOR_ITEMS.filter(i => i.group === 'physics').map(chartRow) : [];
    const myRows = mine.map(rowFor).map(r => ({ ...r, group: 'My scripts' }));
    const everything = [...slayer, ...physics, ...technicals, ...chart, ...myRows];
    const favs = everything.filter(r => favourites.has(r.key)).map(r => ({ ...r, group: 'Favourites' }));
    /* newest first, from the same list the editor's menu keeps; a script no longer in the library is skipped */
    const recent = recentScripts()
      .map(r => everything.find(x => x.key === r.id))
      .filter((r): r is Row => !!r)
      .map(r => ({ ...r, group: 'Recently used' }));
    return { recent, favourites: favs, mine: myRows, slayer, physics, technicals, chart };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, favourites, indicators, rowFor, recentTick]);

  const q = query.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    if (!q) return allRows[shelf];
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const s of ['slayer', 'physics', 'technicals', 'chart', 'mine'] as Shelf[]) {
      for (const r of allRows[s]) {
        if (seen.has(r.key)) continue;
        if (`${r.title} ${r.description} ${r.group}`.toLowerCase().includes(q)) {
          seen.add(r.key);
          out.push({ ...r, group: SHELVES.find(x => x.key === s)!.label });
        }
      }
    }
    return out;
  }, [q, shelf, allRows]);

  useEffect(() => setHighlight(0), [shelf, q]);

  const capped = (r: Row) => r.pane === 'own' && !r.on && subsOn >= MAX_SUB_PANES;

  const toggle = useCallback(
    async (r: Row) => {
      if (capped(r)) return;
      if ((barClock ?? 'time') !== 'time' && r.chartKey && CLOCK_HELD_CHART.has(r.chartKey)) return;
      /* turning something ON is a use — it goes to the top of Recently used */
      const used = () => {
        remember({ id: r.key, title: r.title });
        setRecentTick(t => t + 1);
      };
      if (r.kind === 'chart') {
        if (indicators && onIndicators && r.chartKey) {
          onIndicators({ ...indicators, [r.chartKey]: !r.on });
          if (!r.on) used();
        }
        return;
      }
      if (!paneId || !r.script) return;
      if (r.placed) await liftFromPane(paneId, r.placed.chart.id);
      else {
        if (r.script.status !== 'ok') {
          edit(r.script);
          return;
        }
        await placeOnPane(paneId, r.script.id);
        used();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paneId, indicators, onIndicators, subsOn, edit, barClock]
  );

  const star = async (r: Row) => {
    await scriptStore.toggleFavourite(r.key);
    bumpLibrary();
  };

  /* ↑↓ move · ↵ toggle — while the library is the front window */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'checkbox' && !(t as HTMLElement).hasAttribute('data-library-search');
      if (typing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(h => Math.min(rows.length - 1, h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(h => Math.max(0, h - 1));
      } else if (e.key === 'Enter' && rows[highlight]) {
        e.preventDefault();
        void toggle(rows[highlight]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, highlight, toggle]);

  const shipped = allRows.slayer.length + allRows.physics.length + allRows.technicals.length + allRows.chart.length;
  const overlayOn = overlays ? OVERLAY_ROWS.filter(r => !!overlays[r.key]).length : 0;
  const onThisPane = placed.filter(p => p.chart.visible).length + (indicators ? INDICATOR_ITEMS.filter(i => indicators[i.key]).length : 0) + overlayOn;
  const counts: Record<Shelf, number> = { recent: allRows.recent.length, favourites: allRows.favourites.length, mine: allRows.mine.length, slayer: allRows.slayer.length, physics: allRows.physics.length, technicals: allRows.technicals.length, chart: allRows.chart.length };

  /* the rows, grouped by their heading in order of first appearance */
  const groups = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      if (!by.has(r.group)) {
        by.set(r.group, []);
        order.push(r.group);
      }
      by.get(r.group)!.push(r);
    }
    return order.map(g => ({ title: g, rows: by.get(g)! }));
  }, [rows]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        ariaLabel="Indicators and scripts"
        widthClass="max-w-[1080px]"
        header={
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative foil-glide holo-bg w-6 h-6 rounded-[6px] shrink-0 flex items-center justify-center font-mono text-t10 font-bold text-onfoil" aria-hidden>
              &gt;_
            </span>
            <span className="text-t15 font-semibold leading-tight text-textPrimary">Indicators and scripts</span>
            <span className="font-mono text-t10 text-textPrimary whitespace-nowrap" data-library-count>
              {onThisPane} on this pane
            </span>
          </div>
        }
        headerActions={
          <button
            onClick={() => edit(null)}
            disabled={!fullscreen}
            title={fullscreen ? 'A new script on the template, in the editor beside the chart' : EDITOR_SHUT}
            className="inline-flex items-center h-7 px-2.5 rounded-md border border-silver/40 bg-silver/[0.06] font-mono text-t10 uppercase tracking-wider text-textPrimary hover:bg-silver/[0.1] transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-silver/[0.06]"
            data-library-write
          >
            Write your own
          </button>
        }
      >
        {/* THE SEARCH — one field over every shelf */}
        <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-borderSubtle bg-chip focus-within:border-borderMuted">
          <Search className="w-3.5 h-3.5 text-textMuted shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search every shelf — a name, a word, a group"
            spellCheck={false}
            data-library-search
            className="flex-1 min-w-0 bg-transparent font-mono text-t12 text-textPrimary placeholder:text-textSecondary outline-none"
          />
        </label>

        {/* One size on every shelf: the shelves and the rows share a fixed height and the rows scroll inside it,
            so five Slayer scripts and eighteen technicals open the same card. */}
        {/* A phone stacks them: the shelves as one scrolling row over the rows */}
        <div className="grid gap-3 sm:gap-4 h-[60vh] sm:h-[56vh] min-h-0 overflow-hidden grid-cols-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-rows-1 sm:grid-cols-[176px_minmax(0,1fr)]" data-library>
          {/* THE SHELVES */}
          <nav className="flex sm:flex-col gap-1 sm:pr-4 sm:border-r border-borderSubtle overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto" aria-label="Shelves">
            {(['Personal', 'Built in'] as const).map(section => (
              <div key={section} className="flex sm:block shrink-0 gap-1 sm:mb-2">
                <div className="hidden sm:block px-2 pb-1 font-mono text-t8 uppercase tracking-widest text-textSecondary">{section}</div>
                {SHELVES.filter(s => s.section === section && ((s.key !== 'chart' && s.key !== 'physics') || !!onIndicators)).map(s => {
                  const on = shelf === s.key && !q;
                  return (
                    <button
                      key={s.key}
                      onClick={() => {
                        setShelf(s.key);
                        setQuery('');
                      }}
                      aria-pressed={on}
                      data-library-shelf={s.key}
                      className={`shrink-0 whitespace-nowrap gap-2 sm:w-full flex items-center justify-between h-8 px-2 rounded-md text-t12 transition-colors ${on ? 'bg-silver/[0.08] text-textPrimary shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'text-textPrimary hover:bg-ink/[0.05]'}`}
                    >
                      <span className={on ? 'font-semibold' : ''}>{s.label}</span>
                      <span className="font-mono text-t10 tnum text-textPrimary">{counts[s.key]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* THE ROWS — the head pinned, the list scrolling under it; a new shelf or a
              new search fades its rows up softly (the house soft-in, keyed) instead of
              swapping them in a frame */}
          <div className="min-w-0 min-h-0 h-full flex flex-col overflow-hidden" role="table" aria-label="Scripts">
            <div className={`${ROW_GRID} h-7 font-mono text-t8 uppercase tracking-widest text-textSecondary border-b border-borderSubtle shrink-0`} role="row">
              <span className="hidden sm:block">Kind</span>
              <span>Name</span>
              <span className="hidden sm:block">Shelf</span>
              <span />
              <span />
              <span className="text-right">On</span>
            </div>
            <div key={`${q ? 'search' : shelf}|${q}`} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden animate-soft-in" data-library-rows>
            {overlays && onOverlays && (shelf === 'chart' || !!q) && (
              <div>
                <div className="px-2 pt-3 pb-1 font-mono text-t8 uppercase tracking-widest text-textSecondary">On the chart</div>
                {OVERLAY_ROWS.filter(r => !q || `${r.label} ${r.hint}`.toLowerCase().includes(q)).map(r => {
                  /* an overlay the host never set reads as its default (the session washes are on unless turned off) */
                  const on = !!(overlays[r.key] ?? DEFAULT_OVERLAYS[r.key]);
                  const held = (barClock ?? 'time') !== 'time' && CLOCK_HELD.has(r.key);
                  return (
                    <div key={r.key}>
                      <div role="row" className={`${ROW_GRID} min-h-[46px] overflow-hidden rounded-md ${on ? 'shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : ''}`}>
                        <span className="hidden sm:inline-flex w-fit items-center font-mono text-t8 font-semibold uppercase tracking-widest rounded px-1.5 py-0.5 border bg-ink/[0.1] border-borderMuted text-textPrimary">chart</span>
                        <button
                          type="button"
                          disabled={held}
                          onClick={() => !held && onOverlays({ ...overlays, [r.key]: !on })}
                          title={held ? 'Needs time bars — the pane is on a rule clock' : r.hint}
                          className="min-w-0 flex flex-col items-start text-left overflow-hidden disabled:cursor-default"
                        >
                          <span className="font-semibold text-t12 text-textPrimary truncate max-w-full">{r.label}</span>
                          <span className="text-t10 text-textSecondary truncate max-w-full">{held ? 'Needs time bars' : r.hint}</span>
                        </button>
                        <span className="hidden sm:block font-mono text-t10 text-textPrimary whitespace-nowrap truncate">{r.pane}</span>
                        <span />
                        <span />
                        <span className="flex justify-end">
                          <button
                            role="checkbox"
                            aria-checked={on}
                            disabled={held}
                            onClick={() => !held && onOverlays({ ...overlays, [r.key]: !on })}
                            className={`inline-flex w-5 h-5 items-center justify-center rounded-[3px] border transition-colors ${on && !held ? 'bg-silverFill border-silverFill' : 'border-textPrimary/60 hover:border-textPrimary'} ${held ? 'opacity-40 cursor-default' : ''}`}
                          >
                            {on && !held && (
                              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" aria-hidden>
                                <path d="M2 5.2 4.2 7.4 8 3" fill="none" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        </span>
                      </div>
                      {on && r.key === 'trails' && (
                        /* HOW THE NODES DRAW — the overlays menu's Draw row, here for the panes that show the library instead */
                        <div className="flex items-center gap-2 pl-16 pr-2 pb-1" role="group" aria-label="How the exposure nodes draw" data-library-node-look>
                          <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">Draw</span>
                          {NODE_LOOKS.map(l => (
                            <button key={l.value} type="button" onClick={() => setDeskPrefs({ nodeLook: l.value })} aria-pressed={nodeLook === l.value} title={l.hint} className={`px-1.5 py-0.5 rounded font-mono text-t10 ${nodeLook === l.value ? 'bg-ink/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>{l.label}</button>
                          ))}
                        </div>
                      )}
                      {on && r.key === 'trails' && onTrailGreek && (
                        <div className="flex items-center gap-2 pl-16 pr-2 pb-1">
                          <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">Greek</span>
                          {(['gex', 'dex', 'vex'] as const).map(g => (
                            <button key={g} type="button" onClick={() => onTrailGreek(g)} aria-pressed={trailGreek === g} className={`px-1.5 py-0.5 rounded font-mono text-t10 uppercase ${trailGreek === g ? 'bg-ink/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>{g}</button>
                          ))}
                        </div>
                      )}
                      {on && r.key === 'cone' && onConeHorizon && (
                        <div className="flex items-center gap-2 pl-16 pr-2 pb-1">
                          <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">Horizon</span>
                          {(['session', 'week', 'next'] as const).map(h => (
                            <button key={h} type="button" onClick={() => onConeHorizon(h)} aria-pressed={coneHorizon === h} className={`px-1.5 py-0.5 rounded font-mono text-t10 ${coneHorizon === h ? 'bg-ink/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>{h === 'session' ? 'Session' : h === 'week' ? 'Week' : 'Next'}</button>
                          ))}
                        </div>
                      )}
                      {on && r.key === 'session' && onSessionOr && (
                        <div className="flex items-center gap-2 pl-16 pr-2 pb-1">
                          <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">Opening range</span>
                          {OPENING_RANGES.map(m => (
                            <button key={m} type="button" onClick={() => onSessionOr(m)} aria-pressed={sessionOr === m} className={`px-1.5 py-0.5 rounded font-mono text-t10 tnum ${sessionOr === m ? 'bg-ink/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}>{m}m</button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {rows.length === 0 && !(overlays && onOverlays && (shelf === 'chart' || !!q)) && (
              <div className="h-[200px] flex items-center justify-center font-mono text-t10 uppercase tracking-widest text-textMuted">
                {q ? 'Nothing on any shelf matches' : shelf === 'mine' ? 'Nothing of your own yet — Write your own, or copy a built-in' : shelf === 'favourites' ? 'No favourites yet — the star on any row keeps it here' : shelf === 'recent' ? 'Nothing used yet — what you add to a chart or open lands here, newest first' : 'Nothing here'}
              </div>
            )}
            {groups.map(g => (
              <div key={g.title}>
                <div className="px-2 pt-3 pb-1 font-mono text-t8 uppercase tracking-widest text-textSecondary">{g.title}</div>
                {g.title === 'Five tested reads' && (
                  <p className="px-2 pb-1 font-mono text-t10 text-textSecondary leading-snug" data-physics-note>Five reads the physics study tested out of sample, each under its plain name. CALCULATED is measured from the data; MODEL is a forecast. None claims a direction.</p>
                )}
                {g.title === 'Slayer' && (
                  <p className="px-2 pb-1 font-mono text-t10 text-textSecondary leading-snug">slayer.netGex is the minute net on the house sign. Negative is call-dominant. A bar with no snapshot is na.</p>
                )}
                {g.rows.map(r => {
                  const idx = rows.indexOf(r);
                  const hi = idx === highlight;
                  const held = capped(r) || ((barClock ?? 'time') !== 'time' && !!r.chartKey && CLOCK_HELD_CHART.has(r.chartKey));
                  const fav = favourites.has(r.key);
                  return (
                    <div key={r.key}>
                      <div
                        role="row"
                        onMouseEnter={() => setHighlight(idx)}
                       
                        className={`${ROW_GRID} min-h-[46px] overflow-hidden rounded-md transition-colors ${hi ? 'bg-silver/[0.06]' : ''} ${r.on ? 'shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : ''}`}
                        data-library-row={r.key}
                        data-on={r.on || undefined}
                      >
                        {/* The kind as a filled tag: SLAYER the house's silver tag, PINE and CHART the chip ground */}
                        <span className={`hidden sm:inline-flex w-fit items-center font-mono text-t8 font-semibold uppercase tracking-widest rounded px-1.5 py-0.5 border ${r.kind === 'slayer' ? 'bg-silverFill border-silverFill text-onfoil' : 'bg-ink/[0.1] border-borderMuted text-textPrimary'}`} data-library-kind={r.kind}>{KIND_WORD[r.kind]}</span>
                        <span className="min-w-0 flex flex-col justify-center gap-px overflow-hidden">
                          {r.script && fullscreen ? (
                            <button onClick={() => edit(r.script!)} className="min-w-0 max-w-full truncate text-left font-semibold text-t12 text-textPrimary hover:underline underline-offset-2" title="Open in the editor">
                              {r.title}
                            </button>
                          ) : r.script ? (
                            <span className="font-semibold text-t12 text-textPrimary truncate" title={EDITOR_SHUT}>
                              {r.title}
                            </span>
                          ) : (
                            <button type="button" disabled={held} onClick={() => void toggle(r)} className="min-w-0 max-w-full flex items-center gap-1.5 text-left font-semibold text-t12 text-textPrimary disabled:cursor-default">
                              <span className="truncate">{r.title}</span>
                              {r.chartKey && physicsOf(r.chartKey) && (
                                <>
                                  <span className="hidden sm:inline truncate font-normal text-textSecondary">{physicsOf(r.chartKey)!.plain}</span>
                                  <PhysicsTag tag={physicsOf(r.chartKey)!.tag} />
                                </>
                              )}
                            </button>
                          )}
                          <span className="text-t10 text-textSecondary truncate" title={held ? 'Needs time bars — the pane is on a rule clock' : r.description}>{held && r.chartKey ? 'Needs time bars' : r.kind === 'chart' ? indicatorBlurb(r.description) : r.description}</span>
                          {r.script?.status === 'error' && <span className="font-mono text-t8 uppercase tracking-widest text-bear">does not read</span>}
                        </span>
                        <span className="hidden sm:block font-mono text-t10 text-textPrimary whitespace-nowrap truncate" title={r.pane === 'own' ? 'Takes its own pane under the tape — two at most' : 'Draws on the tape itself'}>
                          {r.pane === 'own' ? 'own pane' : 'on the tape'}
                        </span>
                        <span>
                          {r.on && r.chartKey && (
                            <button onClick={() => setSettingsFor(r.chartKey!)} title="Its settings — inputs, style, visibility" className="p-1 rounded text-textSecondary hover:text-textPrimary transition-colors" data-library-gear>
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {r.on && r.placed && (r.inputs.length > 0 || (r.script?.meta?.alerts.length ?? 0) > 0) && paneId && (
                            <button onClick={() => setExpanded(x => (x === r.key ? null : r.key))} aria-pressed={expanded === r.key} title={r.inputs.length > 0 ? 'Its inputs and alerts' : 'Its alerts'} className={`p-1 rounded transition-colors ${expanded === r.key ? 'text-textPrimary bg-ink/[0.06]' : 'text-textSecondary hover:text-textPrimary'}`} data-library-gear>
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                        <button onClick={() => void star(r)} aria-pressed={fav} title={fav ? 'Take it off your favourites' : 'Keep it in your favourites'} className={`p-1 rounded transition-colors ${fav ? 'text-silver' : 'text-textSecondary hover:text-textPrimary'}`} data-library-star>
                          <Star className="w-3.5 h-3.5" fill={fav ? 'currentColor' : 'none'} />
                        </button>
                        <span className="flex justify-end">
                          <button
                            role="checkbox"
                            aria-checked={r.on}
                            disabled={held}
                            onClick={() => void toggle(r)}
                            title={held ? (r.chartKey && (barClock ?? 'time') !== 'time' ? 'Needs time bars — the pane is on a rule clock' : 'Two own panes are the cap — turn one off first, or the tape shrinks past its floor') : r.on ? 'Take it off this pane' : 'Draw it on this pane'}
                            className={`inline-flex w-5 h-5 items-center justify-center rounded-[3px] border transition-colors ${r.on ? 'bg-silverFill border-silverFill' : 'border-textPrimary/60 hover:border-textPrimary'} ${held ? 'opacity-40 cursor-default' : ''}`}
                            data-library-toggle
                          >
                            {r.on && (
                              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" aria-hidden>
                                <path d="M2 5.2 4.2 7.4 8 3" fill="none" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        </span>
                      </div>
                      {expanded === r.key && r.placed && r.script && paneId && <InputsForm inputs={r.inputs} chart={r.placed.chart} paneId={paneId} script={r.script} />}
                    </div>
                  );
                })}
              </div>
            ))}
            </div>
          </div>
        </div>

        {/* THE FOOT */}
        <div className="shrink-0 flex items-center gap-3 pt-3 border-t border-borderSubtle font-mono text-t10 text-textSecondary min-w-0" data-library-foot>
          <span className="shrink-0">
            <span className="text-textPrimary">{shipped}</span> shipped · <span className="text-textPrimary">{allRows.mine.length}</span> of your own
          </span>
          <span className="min-w-0 truncate">Slayer and Pine draw on this pane. Chart rows are the tape's built-ins.</span>
          <span className="ml-auto shrink-0 whitespace-nowrap">↑↓ move · ↵ toggle · esc close</span>
        </div>
      </Modal>
      {settingsFor && <IndicatorSettings indicator={settingsFor} onClose={() => setSettingsFor(null)} />}
    </>
  );
};

export default ScriptLibrary;
