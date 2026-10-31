import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronUp, Code2, Link2, Maximize2, Minimize2, Rows3, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { DOCK_ROOM, openEditor } from '../../data/editorDock';
import { useDeskSession, sessionMeta, type DeskSession } from '../../data/deskSession';
import { chainForDate, expiryLabel } from '../../data/book/levels';
import { ensureBook } from '../../data/book/load';
import { peekSpot } from '../../data/book/day';
import { snapshotFor } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { levelNetPath } from '../../data/flipLevel';
import { rootTradesSession } from '../../data/compassSession';
import { useSessionQuote } from '../../data/sessionQuote';
import { asOfText } from '../../components/ui/states';
import { barInTape, peekPrint, peekTape, usePrintRev, useTapeRev, useThetaTape, wantPrint } from '../../data/thetaTape';
import { thetaChartBars } from '../../data/thetaCandles';
import { fmtUsd } from '../../data/gex';
import { CALENDAR_DTES } from '../../data/exposureSurface';
import { expiryFor, futuresPhaseAt, FUTURES_PHASE_WORDS } from '../../core/calendar';
import { nyClock, nyIsoDate } from '../../core/nyTime';
import { peekThetaPrice, thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { closeMoveTitle, sessionWhen, signedPct } from '../../data/dayChange';

import DistanceUnitPicker from '../../components/ui/DistanceUnitPicker';
import SessionBook from '../../components/ui/SessionBook';
import {
  deleteNamedLayout, loadNamedLayouts, persistNamedLayouts, saveNamedLayout,
  MAX_NAMED_LAYOUTS, type NamedLayoutEntry,
} from './layouts';
import { expiryOpen } from '../../core/tradingYear';
import ExpiryCard, { type ExpiryChoice } from '../../components/ui/ExpiryCard';
import StrikeChart, {
  PRICE_SCALE_MIN_WIDTH,
  DEFAULT_INDICATORS,
  DEFAULT_OVERLAYS,
  type ChartIndicators,
  type ChartOverlays,
  type ChartStyle,
  priceScaleLockedBy,
  PRICE_SCALES,
  type CrosshairBar,
  type CompareEntry,
  type CompareMode,
  type CrosshairSync,
  type PriceProjection,
  type PriceScale,
} from '../../components/gex/StrikeChart';
import ChartToolbar from '../../components/gex/ChartToolbar';
import { makeCell, useCell, type Cell } from '../../components/gex/hoverCell';
import { useFadeClose } from '../../components/ui/useFadeClose';
import CompareControl from '../../components/gex/CompareControl';
import TickerTabStrip, { TAB_MAX } from '../../components/gex/TickerTabStrip';
import FieldKey from '../../components/gex/FieldKey';
import GapChip from '../../components/gex/GapChip';
import { dealerOf } from '../../core/dealerSign';
import { useMaxPain } from '../../components/gex/levelExtras';
import { composeSnapshot, snapshotName } from '../../components/gex/snapshot';
import { readSessionClock } from '../../data/moc';
import ProfilePanel, { PALETTE_OPTIONS, PROFILE_MIN_W, type ProfileLane, type ProfilePalette } from '../../components/gex/ProfilePanel';
import DropdownSelect from '../../components/ui/DropdownSelect';
import { netSinceOpenRatio } from '../../data/levelview';
import { useLevelsFor } from '../../data/levelsFor';
import { useLevelsScope } from '../../data/levelsScope';
import ProfileGuide from '../../components/gex/ProfileGuide';
import GuideFocus from '../../components/ui/GuideFocus';
import { buildFlowFromRows } from '../../data/hedgeFlow';
import useFocusTrap from '../../components/ui/useFocusTrap';
import { useIsBelowXl, useIsPhone, useIsPortraitDesk } from '../../components/ui/useMediaQuery';
import ScopeChip from '../../components/ui/ScopeChip';
import { ChartSkeleton, Deferred } from '../../components/ui/Skeleton';
import SpotPrice from '../../components/gex/SpotPrice';
import { CANDLE_THEMES, chartGround, pageDefaultCandleKey, usePageDefaultCandleKey, type CandleThemeKey } from '../../components/gex/candleTheme';
import { TIMEFRAMES, frameServed, type Timeframe } from '../../data/timeframe';
import FrameMeter, { frameMeterOn } from '../../components/gex/FrameMeter';
import { paneLevels } from './paneLevels';
import { buildConfluence, type TrendState } from '../../data/confluence';
import { OPENING_RANGES, type OpeningRange } from '../../data/sessionLevels';
import { isBarClock } from '../../data/altBars';
import {
  SETUP_KEYS, applySetup, captureSetup, evict, readSetups, symKey, type SetupMap,
} from './setups';
import { flipRing, stepSymbol, stepTf } from './paneKeys';

/* The bottom bar's futures clock in plain words (core/calendar.ts has the long ones, on its hover) */
const FUTURES_PHASE_SHORT: Record<ReturnType<typeof futuresPhaseAt>, string> = {
  GLOBEX_ASIA: 'Asia hours',
  GLOBEX_EUROPE: 'Europe hours',
  RTH: 'cash session',
  GLOBEX_POST: 'after the close',
  MAINTENANCE: 'daily break 17–18 ET',
  CLOSED: 'closed',
};

/* Terrain — one to four chart panes that own the viewport. Each pane is its own workspace: symbol, interval,
   overlays, indicators, style, theme and rail. */

const TERRAIN_KEY = 'slayer_terrain_v1';

/* `stepTf` and the symbol ring live in ./paneKeys so `npm test` can load them without the charting library. */

/** How many panes are on screen. Four is the ceiling: at 1440 a fifth pane is 260px wide, and a chart that narrow
    stops being a chart — the same finding that keeps the Pulse desk's widgets from going below their floor. */
export const LAYOUTS = [1, 2, 3, 4] as const;
export type TerrainLayout = (typeof LAYOUTS)[number];

/* Everything one pane owns. There is nothing else — a setting that is not here is a setting every pane shares, and
   only two of those exist. */
export interface PaneCfg {
  /** The pane's link group. Panes sharing a letter follow each other's symbol changes; null stands alone. Not a setup
      key: linking is slot business, like the rail. */
  link?: 'A' | 'B' | null;
  ticker: string;
  /** The pane's tabs: every name it holds, the ticker among them — the "+" beside the symbol adds one, five at most
      (TickerTabs); a name picked in the symbol chip or stepped with ↑/↓ swaps the active tab's name */
  tabs: string[];
  timeframe: Timeframe;
  overlays: ChartOverlays;
  indicators: ChartIndicators;
  chartStyle: ChartStyle;
  /** The bar clock: 'time', or a range/volume key from data/altBars.ts's BAR_CLOCKS. Rule bars fold the live seconds
      tape by rule instead of by the timeframe. */
  clock: string;
  /** Symbols crossed onto this pane's tape — the compare overlay. Per pane, like everything else here, and persisted
      with it. */
  compares: CompareEntry[];
  /** The main price axis's mode — linear, log, percent or indexed. Follows the symbol, like the interval; see
      ./setups. */
  priceScale: PriceScale;
  /* Which opening range the session overlay draws. Per slot, not per symbol, and that is the opposite call from
     `timeframe` on purpose. */
  sessionOr: OpeningRange;
  /** Whether this pane carries the strike rail down its right edge. Per pane too — the rail has its own × and the top
      button is a convenience that sets every pane at once, not the only way out. */
  ladder: boolean;
  /** The strike rail's width in px. Absent = the house default. */
  ladderW?: number;
  /** Which lanes the rail's panel draws — size, what a move forces, or both. Per slot like `ladder`: a way of reading
      a pane. 'size' by default, because the docked panel is 132px and two lanes want room. */
  lane: ProfileLane;
  /** This pane's candle theme. A slot field like the rail: the arrangement's look, not the symbol's memory. Ours,
      kept through the port — the partner tree paints every pane from one store. */
  theme?: CandleThemeKey;
}

interface TerrainCfg {
  layout: TerrainLayout;
  /** Always four, whatever the layout, so going 3 → 2 → 3 gives the third pane back exactly as it was rather than
      resetting it. */
  panes: PaneCfg[];
  /** How each symbol was last set up. Consulted only when a symbol is newly picked — never re-applied to what is
      already on screen, or a reader's live pane would be rewritten under them by an old decision. */
  setups: SetupMap;
  /** The rails' colours — the thermal ramp or the house gold and ice — one choice for the desk: a colour that means
      one thing on one pane and another next door is a colour nobody can read. */
  palette: ProfilePalette;
  /** Which contracts the rails read — one expiry (the calendar card in the rail's head) or the whole book, for the
      desk. The chart's walls, flip and supreme are the house levels: the levels scope, or this cut's date when later. */
  railCut: RailCut;
  /** The desk's look: from 2 every pane opens with the cone and the key levels on (a stored desk is moved once) */
  look?: number;
}

/** A calendar expiry's days-to-expiry, or the whole book */
export type RailCut = number | 'book';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The card's choices: the calendar's expiries as lit days (two horizons on one Friday are one day), the book as the
    foot pill — built at render, since the dates are today's */
const railCutChoices = (): ExpiryChoice<RailCut>[] => {
  const out: ExpiryChoice<RailCut>[] = [];
  const seen = new Set<string>();
  for (const dte of CALENDAR_DTES) {
    const e = expiryFor(dte);
    const key = e.date.toISOString().slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    const day = `${MONTHS[e.date.getMonth()]} ${e.date.getDate()}`;
    out.push({ value: dte, label: dte === 0 ? `Today · ${day}` : day, hint: dte === 0 ? "The contracts that expire at today's bell" : `${e.sessions} sessions out`, date: e.date });
  }
  out.push({ value: 'book', label: 'Whole book', hint: 'Every listed expiry, on the contracts live in this session', date: null });
  return out;
};
type RailData = {
  rows: { strike: number; value: number; callOI?: number }[];
  core: { strike: number; value: number; callOI?: number }[];
  maxAbs: number;
  spot: number;
  step: number;
  legs: Map<number, { put: number; call: number }>;
};
/** The rail's shape off rows in descending strike order: the near-spot core, its scale, the step */
const railShape = (rows: { strike: number; value: number; callOI?: number }[], spot: number) => {
  const spotIdx = Math.max(0, rows.findIndex(s => s.strike <= spot));
  const core = rows.slice(Math.max(0, spotIdx - 10), spotIdx + 11);
  let maxAbs = 1;
  for (const r of core) maxAbs = Math.max(maxAbs, Math.abs(r.value));
  let step = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i - 1].strike - rows[i].strike;
    if (d > 1e-9) step = Math.min(step, d);
  }
  if (!Number.isFinite(step) || step <= 0) step = 1;
  return { rows, core, maxAbs, spot, step };
};
/** The rail reads the same live chain the chart draws. No book yet means an empty rail, not a made-up one. */
function railForCut(ticker: string, cut: RailCut): RailData {
  const spot = peekSpot(ticker);
  const blank: RailData = {
    rows: [],
    core: [],
    maxAbs: 1,
    spot: spot ?? Number.NaN,
    step: 1,
    legs: new Map(),
  };
  const date = cut === 'book'
    ? 'book'
    : cut === 0
      ? null
      : (() => {
          const d = expiryFor(cut).date;
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
  const pack = chainForDate(ticker, date);
  if (!pack || !(spot != null && spot > 0) || pack.nodes.length === 0) return blank;
  const legs = new Map<number, { put: number; call: number }>();
  const rows = pack.nodes
    .map(n => {
      legs.set(n.strike, { put: n.putGex, call: n.callGex });
      return { strike: n.strike, value: n.netGex, callOI: n.callOI };
    })
    .sort((a, b) => b.strike - a.strike);
  return { ...railShape(rows, spot), legs };
}

const TF_VALUES = new Set<string>(TIMEFRAMES.map(t => t.value));
const COMPARE_MODES = new Set<CompareMode>(['percent', 'scale', 'pane']);
/* The desk's comparison inks (LiveChartWidget's set, verbatim): none of them collide with the field's gold/steel,
   the levels' magenta/green/red/blue, or the interface's lime. Four, so a pane can cross four symbols at most. */
const COMPARE_INKS = ['#5B9CF6', '#BBB2E8', '#EDE4CD', '#6BD3C7'];
const STYLES = new Set<ChartStyle>(['candles', 'hollow', 'bars', 'line', 'step', 'area', 'baseline']);
/* Derived from the picker's own list rather than typed a second time — a fifth mode added there is accepted here
   without an edit, and one removed stops validating here in the same commit. */
const SCALES = new Set<string>(PRICE_SCALES.map(o => o.value));
/* Same rule: derived from the engine's own list rather than typed twice. */
const OR_VALUES = new Set<number>(OPENING_RANGES);

/** A Terrain pane opens with the field, the forward cone and the key levels. trails is on here only — a saved desk that turned it off stays off. */
const TERRAIN_OVERLAYS = { ...DEFAULT_OVERLAYS, trails: true, cone: true, levels: true, flow: true };
const LOOK = 3;
/** A desk stored before LOOK, moved once: every pane's and every setup's cone and key levels on (look 2), and the flow
    pane under the tape (look 3) — a desk already at 2 keeps its cone and levels as the reader left them */
const lookUp = (cfg: TerrainCfg, stored: unknown): TerrainCfg => {
  if (stored === LOOK) return cfg;
  const lift = stored === 2 ? { flow: true } : { cone: true, levels: true, flow: true };
  const on = <T extends { overlays?: ChartOverlays }>(x: T): T => (x.overlays ? { ...x, overlays: { ...x.overlays, ...lift } } : x);
  return { ...cfg, look: LOOK, panes: cfg.panes.map(on), setups: Object.fromEntries(Object.entries(cfg.setups).map(([k, v]) => [k, on(v)])) as SetupMap };
};

/** The pane slots differ only by symbol at first; a reader sets the rest. */
const OPEN_NAMES = ['SPY', 'QQQ', 'AAPL', 'NVDA'] as const;
const defaultPanes = (): PaneCfg[] =>
  OPEN_NAMES.map(ticker => ({
    ticker,
    tabs: [ticker],
    timeframe: '15m' as Timeframe,
    overlays: { ...TERRAIN_OVERLAYS },
    indicators: { ...DEFAULT_INDICATORS },
    chartStyle: 'candles' as ChartStyle,
    clock: 'time',
    compares: [] as CompareEntry[],
    priceScale: 'normal' as PriceScale,
    sessionOr: 15 as OpeningRange,
    ladder: true,
    lane: 'size' as ProfileLane,
    theme: undefined as CandleThemeKey | undefined,
    link: null,
  }));

/* The map starts empty on a fresh install, deliberately. */
const defaults = (): TerrainCfg => ({ layout: 3, panes: defaultPanes(), setups: {}, palette: 'thermal', railCut: 'book', look: LOOK });

/** One stored pane, validated field by field against a known-good default. */
/* Migration only. A blob written before setups existed has four panes a reader did configure, so their settings
   become those four symbols' setups — the same reasoning as the legacy fan-out below. */
const seedFrom = (panes: PaneCfg[]): SetupMap => {
  const now = Date.now();
  const out: SetupMap = {};
  for (const p of panes) out[symKey(p.ticker)] = captureSetup(p, now);
  return out;
};

/** The stored tabs, whole: strings, unique, five at most, the ticker among them */
function readTabs(raw: unknown, ticker: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= TAB_MAX) break;
  }
  if (!out.includes(ticker)) out.unshift(ticker);
  return out.slice(0, TAB_MAX);
}
/** The tabs after the active name changes to `to` — the active tab renamed, unless `to` already has a tab */
const tabsAfter = (tabs: string[], from: string, to: string): string[] => (tabs.includes(to) ? tabs : tabs.length ? tabs.map(x => (x === from ? to : x)) : [to]);

function readPane(raw: unknown, def: PaneCfg): PaneCfg {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<PaneCfg>;
  return {
    ticker: typeof c.ticker === 'string' && c.ticker ? c.ticker : def.ticker,
    tabs: readTabs(c.tabs, typeof c.ticker === 'string' && c.ticker ? c.ticker : def.ticker),
    timeframe: typeof c.timeframe === 'string' && TF_VALUES.has(c.timeframe) && frameServed(c.timeframe as Timeframe) ? (c.timeframe as Timeframe) : def.timeframe,
    overlays: { ...DEFAULT_OVERLAYS, ...(c.overlays && typeof c.overlays === 'object' ? c.overlays : {}) },
    indicators: { ...DEFAULT_INDICATORS, ...(c.indicators && typeof c.indicators === 'object' ? c.indicators : {}) },
    chartStyle: typeof c.chartStyle === 'string' && STYLES.has(c.chartStyle as ChartStyle) ? (c.chartStyle as ChartStyle) : def.chartStyle,
    /* The clock list lives with the engine (data/altBars.ts) and is checked through its own validator — not a second
       enumeration here. */
    clock: isBarClock(c.clock) ? c.clock : def.clock,
    /* Each entry validated on its own: a stored comparison whose symbol was renamed, or whose ink went missing, must
       not take the pane down. */
    compares: Array.isArray(c.compares)
      ? (c.compares as unknown[])
          .filter(
            (e): e is CompareEntry =>
              !!e &&
              typeof e === 'object' &&
              typeof (e as CompareEntry).ticker === 'string' &&
              typeof (e as CompareEntry).ink === 'string' &&
              COMPARE_MODES.has((e as CompareEntry).mode)
          )
          .slice(0, COMPARE_INKS.length)
      : def.compares,
    priceScale: typeof c.priceScale === 'string' && SCALES.has(c.priceScale) ? (c.priceScale as PriceScale) : def.priceScale,
    sessionOr: typeof c.sessionOr === 'number' && OR_VALUES.has(c.sessionOr) ? (c.sessionOr as OpeningRange) : def.sessionOr,
    ladder: typeof c.ladder === 'boolean' ? c.ladder : def.ladder,
    ladderW:
      typeof c.ladderW === 'number' && c.ladderW >= PROFILE_MIN_W && c.ladderW < 4000 ? c.ladderW : def.ladderW,
    lane: c.lane === 'both' || c.lane === 'size' || c.lane === 'flow' ? c.lane : def.lane,
    theme: typeof c.theme === 'string' && c.theme in CANDLE_THEMES ? (c.theme as CandleThemeKey) : def.theme,
    link: c.link === 'A' || c.link === 'B' ? c.link : null,
  };
}

/* Self-healing load, and a migration. The shape stored before this change was flat — one timeframe, one set of
   overlays, one style for the whole desk, plus a `tickers` array. */
function loadCfg(): TerrainCfg {
  const def = defaults();
  try {
    const raw = localStorage.getItem(TERRAIN_KEY);
    if (!raw) return def;
    const c = JSON.parse(raw) as Record<string, unknown>;
    if (!c || typeof c !== 'object') return def;

    const layout = (LAYOUTS as readonly number[]).includes(c.layout as number)
      ? (c.layout as TerrainLayout)
      : def.layout;
    /* `ladder` used to be one flag for the whole desk. If that is what is in storage it becomes every pane's flag,
       the same way the one shared interval did. */
    const deskLadder = typeof c.ladder === 'boolean' ? (c.ladder as boolean) : undefined;
    const palette: ProfilePalette = c.palette === 'house' ? 'house' : def.palette;
    const railCut: RailCut = typeof c.railCut === 'number' && (CALENDAR_DTES as readonly number[]).includes(c.railCut) ? c.railCut : def.railCut;

    if (Array.isArray(c.panes)) {
      const stored = c.panes as unknown[];
      const panes = def.panes.map((d, i) => readPane(stored[i], { ...d, ladder: deskLadder ?? d.ladder }));
      const hadSetups = !!c.setups && typeof c.setups === 'object';
      return lookUp({ layout, panes, setups: hadSetups ? readSetups(c.setups) : seedFrom(panes), palette, railCut }, c.look);
    }

    // The flat shape, fanned out
    const legacy: Partial<PaneCfg> = {
      timeframe: typeof c.timeframe === 'string' && TF_VALUES.has(c.timeframe) && frameServed(c.timeframe as Timeframe) ? (c.timeframe as Timeframe) : undefined,
      overlays: c.overlays && typeof c.overlays === 'object' ? (c.overlays as ChartOverlays) : undefined,
      indicators: c.indicators && typeof c.indicators === 'object' ? (c.indicators as ChartIndicators) : undefined,
      chartStyle: typeof c.chartStyle === 'string' && STYLES.has(c.chartStyle as ChartStyle) ? (c.chartStyle as ChartStyle) : undefined,
      /* Not in the flat shape, so `readPane` gives the pane its default. */
    };
    const tickers = Array.isArray(c.tickers) ? (c.tickers as unknown[]) : [];
    const panes = def.panes.map((d, i) =>
      readPane({ ...legacy, ticker: typeof tickers[i] === 'string' ? tickers[i] : d.ticker }, {
        ...d,
        ladder: deskLadder ?? d.ladder,
      })
    );
    return lookUp({ layout, panes, setups: seedFrom(panes), palette, railCut }, c.look);
  } catch {
    return def;
  }
}

/** How many columns a layout wants, and from which breakpoint. */
const COLS: Record<TerrainLayout, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 xl:grid-cols-2',
  3: 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3',
  4: 'grid-cols-1 xl:grid-cols-2',
};

/* Rows have to follow columns, at every breakpoint, or a pane falls out of the grid's height. Three panes in two
   columns need two rows. */
const ROWS: Record<TerrainLayout, string> = {
  1: 'xl:grid-rows-1',
  2: 'xl:grid-rows-1',
  3: 'xl:grid-rows-2 2xl:grid-rows-1',
  4: 'xl:grid-rows-2',
};

/* Height of the time axis lightweight-charts draws under the plot, in px. Measured, not chosen: with `timeVisible:
   true` and this font the axis canvas runs 858→884 in a 1000px viewport. */
const TIME_AXIS_PX = 26;
/** The floating desk bar's margin from the screen's foot, and from the expanded chart's time axis above it */
const DESK_BAR_GAP_PX = 8;

/* Clearance for the price gutter lightweight-charts draws down the right of the plot, in px. Floating chrome has to
   stop short of that gutter or it lands on the price ticks. */
const PRICE_GUTTER_PX = PRICE_SCALE_MIN_WIDTH + 2;

/* What the full control strip needs — inside the chart column, with the price gutter already taken off it. */
/* Measured with the words, the link chip and Compare in it: 1044 */
const TOOLBAR_FULL_PX = 1056;
/** The same toolbar compact — the seven timeframes as one trigger, every card its icon (measured 350) */
const TOOLBAR_COMPACT_PX = 380;
/** The fullscreen door when it rides the identity row: its 24px button and the row's 8px gap */
const ROW_DOOR_PX = 32;

/* The strip's own padding, when it is not clearing a price gutter (`p-1.5`). Named because the usable width below is
   derived from it rather than from a second copy of the number. */
const STRIP_PAD_PX = 6;
/** The expand chip in a docked pane's top-right corner: the identity row stops this far short of it */
const EXPAND_CHIP_PX = 38;

/* What the identity row costs, and what it gives up when the column cannot pay. The row is `w-fit max-w-full` and
   every child is `shrink-0`, which caps the box at the column and lets the contents overflow it visibly. */
/* 52 less since: the link chip and the Compare door moved to the toolbar's right cluster (measured: the identity at
   its fullest is ~300 with the tabs' "+" where the compare's stood) */
const ID_ROW_FULL_PX = 314;
const ID_ROW_NO_PCT_PX = 259;
const ID_ROW_NO_BADGE_PX = 234;

/* The heaviest read's entries, measured the same way: the heaviest label is 50 and the widest entry seen is 86
   ("172.50 $131.3M"), each followed by a 10px gap. */
const HEAVY_LABEL_PX = 60; // the word plus its gap
const HEAVY_ENTRY_PX = 96; // the widest entry plus its gap
const HEAVY_MAX = 3;

/* What the hovered-bar readout costs, measured in this build with all four indicators drawn, at a width where
   nothing was forcing it to shed. */
/* What the confluence strip costs, measured in this build at 1024–1920 with two panes, not estimated. */
/** The glyphs inside the five pills the confluence reads */
const MTF_FULL_PX = 36;

const READOUT_C_PX = 55;
const READOUT_OHL_PX = 168;
const READOUT_VOL_PX = 55;
const READOUT_IND_PX = 81;

/* The heaviest strikes in the pane's window, signed — the one-line read of where the book is, and the same rows the
   rail draws. How many depends on the layout, and that is a correctness fix rather than a tidiness one. */
const heaviest = (rows: { strike: number; value: number }[], n: number) =>
  [...rows].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, n);

/* Share count, not dollars — `fmtUsd` would print a $ in front of a volume. Same K/M/B ladder so the two reads scan
   alike. */
const fmtVol = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

/* The timeframes, and whether they agree. */
/* The confluence strip stood here until — its five glyphs ride the timeframe pills now (ChartToolbar TimeframeStrip
   `trend`). */

/* One labelled figure in the readout row. */
const ReadoutCell = ({ k, v, ink }: { k: string; v: string; ink?: string }) => (
  <span className="shrink-0 whitespace-nowrap">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className="ml-1 font-mono text-t10 tnum" style={ink ? { color: ink } : undefined}>
      {v}
    </span>
  </span>
);

/** A stable function that calls the latest `fn` — the memoised chart's callbacks, so a pane render (a resize, a tick)
    does not re-render the chart behind it. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/* The head's price and its move off the regular close, off ThetaData. The chart series stays the full join.
   The number is the last real bar of the session on the desk, not the newest bar of another session. */
const SESSION_EMPTY: Record<DeskSession, string> = {
  overnight: 'No overnight prints',
  pre: 'No premarket prints',
  rth: 'No regular prints',
  post: 'No after-hours prints',
};
type HeadMv = ReturnType<typeof thetaMove>;
/** The pane head's price and move. The regular session's head speaks the app's one convention (data/dayChange.ts
    moveOffCloses): once that session is over its price is the official regular close (not the last minute bar's close),
    its move the day's change; an extended session's move is from that same close. */
function headRead(ticker: string, session: DeskSession, cashClose: number | null, mv: HeadMv = null): { px: number | null; at: number; move: number | null; note: string | null; closed: boolean } {
  const bars = thetaChartBars(ticker, 1, session);
  let last: { close: number; time: number } | null = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    if (!(b.open > 0) || !(b.high > 0) || !(b.low > 0) || !(b.close > 0)) continue;
    if (!barInTape(b.time, session, ticker)) continue;
    last = b;
    break;
  }
  if (!last) {
    const tape = peekTape(ticker, '1m', session);
    const waiting = tape.bars.length === 0 && (tape.state === 'loading' || tape.takenAt === 0);
    const note = waiting ? null : SESSION_EMPTY[session];
    return { px: null, at: 0, move: null, note, closed: false };
  }
  const lastDay = nyIsoDate(last.time * 1000);
  /* the regular close of the session this tape's last bar is in, when the closes have it */
  const regClose = mv && mv.regClose != null && mv.regDate === lastDay ? mv.regClose : null;
  if (session === 'rth' && regClose != null) return { px: regClose, at: last.time, move: mv?.pct ?? null, note: null, closed: true };
  const px = last.close;
  const print = peekPrint(ticker);
  const extBase = mv && mv.regClose != null && mv.regDate != null && mv.regDate <= lastDay ? mv.regClose : cashClose;
  const base = session === 'post' || session === 'overnight' ? extBase : mv && mv.base != null && session === 'rth' ? mv.base : print && print.prev > 0 ? print.prev : null;
  return { px, at: last.time, move: px != null && base != null && base > 0 ? ((px - base) / base) * 100 : null, note: null, closed: false };
}
/* Leaves, so a print (every second in the session) re-renders the number and not the pane */
const HeadPrice = ({ ticker, session, className }: { ticker: string; session: DeskSession; className?: string }) => {
  usePrintRev();
  useTapeRev();
  const mv = thetaMove(useThetaPrice(ticker).held?.value);
  const { px, at, note, closed } = headRead(ticker, session, null, mv);
  const quote = useSessionQuote(ticker, session, session !== 'rth' && px == null && !note);
  if (px == null && note) {
    return (
      <span className="font-mono text-t11 text-textMuted" title={`${note}. ${sessionMeta(session).label} is not borrowing another session's print.`} data-head-note={session}>
        {note}
      </span>
    );
  }
  if (px == null && quote)
    return (
      <span className={`font-mono text-t11 font-semibold tnum ${quote.current ? 'text-textPrimary' : 'text-textSecondary'}`} title={quote.current ? 'No prints on this name. Bid and ask.' : `No prints in this session on this feed. The last bid and ask, ${asOfText(quote.at)}.`} data-session-quote={quote.current ? 'live' : 'as-of'}>
        {quote.bid.toFixed(2)} × {quote.ask.toFixed(2)}
        {!quote.current && quote.at > 0 && <span className="ml-1 font-normal text-t9 text-warn uppercase tracking-widest">{asOfText(quote.at)}</span>}
      </span>
    );
  if (px == null) return <span className="font-mono text-t11 text-textMuted">—</span>;
  const stale = at > 0 && Date.now() / 1000 - at > 120;
  return (
    <span className="inline-flex items-baseline gap-1" data-head-price={closed ? 'close' : session}>
      <SpotPrice value={px} className={className} />
      {closed ? (
        <span className="font-mono text-t10 text-textMuted" title={`The official regular close of ${sessionWhen(mv?.regDate) ?? 'today'}. The rail's price is the last trade, any session.`}>{sessionWhen(mv?.regDate) ? `${sessionWhen(mv?.regDate)!.slice(0, 3)} close` : 'close'}</span>
      ) : (
        stale && <span className="font-mono text-t10 text-textMuted" title="The last print on the tape. Nothing newer has printed.">{nyClock(at * 1000)}</span>
      )}
    </span>
  );
};
const HeadMove = ({ ticker, session, cashClose, className = '' }: { ticker: string; session: DeskSession; cashClose: number | null; className?: string }) => {
  usePrintRev();
  useTapeRev();
  const mv = thetaMove(useThetaPrice(ticker).held?.value);
  const { move, closed } = headRead(ticker, session, cashClose, mv);
  if (move == null) return null;
  return (
    <span className={`${className} ${move >= 0 ? 'text-bull' : 'text-bear'}`} title={closed && mv ? closeMoveTitle(mv) : session === 'rth' ? 'Against the regular close before it' : `${session === 'pre' ? 'Pre-market' : 'After hours'}, from the regular close`} data-head-move>
      {session === 'post' || session === 'overnight' ? 'AH ' : session === 'pre' ? 'PM ' : ''}
      {signedPct(move)}
    </span>
  );
};

/* The hovered bar lives in a cell, not the pane's state: the chart reports it on every pointer move, and as pane
   state each move re-rendered the whole pane — its toolbar and the rail's calendar (~500 cells). */
/* The chrome's one read line: the hovered bar while the pointer is on the plot, else the heaviest strikes. */
/* The read line changes on every crosshair move: it is its own layer, contained, so it repaints alone. */
const ChromeReadLine = ({ cell, stripInner, heavy }: { cell: Cell<CrosshairBar | null>; stripInner: number; heavy: { strike: number; value: number }[] }) => {
  const readout = useCell(cell);
  const roomFor = (px: number) => stripInner === 0 || stripInner >= px;
  if (readout) {
    const inds = readout.indicators.length;
    const showInds = inds > 0 && roomFor(READOUT_C_PX + READOUT_OHL_PX + READOUT_VOL_PX + inds * READOUT_IND_PX);
    const showVol = readout.volume != null && roomFor(READOUT_C_PX + READOUT_OHL_PX + READOUT_VOL_PX);
    const showOhl = readout.open != null && roomFor(READOUT_C_PX + READOUT_OHL_PX);
    return (
      <div className="chrome-hover relative z-10 pointer-events-none hidden sm:flex items-center h-[23px] w-fit max-w-full rounded-md bg-canvas/25 backdrop-blur-[3px] px-2 leading-none [contain:layout_paint] will-change-transform" data-readout-line>
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          {showOhl && (
            <>
              <ReadoutCell k="O" v={readout.open!.toFixed(2)} />
              <ReadoutCell k="H" v={readout.high!.toFixed(2)} />
              <ReadoutCell k="L" v={readout.low!.toFixed(2)} />
            </>
          )}
          {/* The one part that never goes. */}
          <ReadoutCell k="C" v={readout.close.toFixed(2)} />
          {showVol && <ReadoutCell k="V" v={fmtVol(readout.volume!)} />}
          {showInds && readout.indicators.map(ind => <ReadoutCell key={ind.key} k={ind.key} v={ind.value.toFixed(2)} ink={ind.ink} />)}
        </span>
      </div>
    );
  }
  if (heavy.length > 0) {
    return (
      <div className="chrome-hover relative z-10 pointer-events-none hidden sm:flex items-center h-[23px] w-fit max-w-full rounded-md bg-canvas/25 backdrop-blur-[3px] px-2 leading-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100" data-heavy-line>
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          <span className="shrink-0 font-mono text-t9 uppercase tracking-widest text-textMuted">Heaviest</span>
          {heavy.map(row => (
            <span key={row.strike} className="shrink-0 font-mono text-t10 tnum whitespace-nowrap">
              <span className="text-textSecondary">{row.strike % 1 === 0 ? row.strike.toFixed(0) : row.strike.toFixed(2)}</span>
              <span className={`ml-1.5 font-semibold ${row.value >= 0 ? 'text-goldline' : 'text-steelline'}`}>{fmtUsd(row.value)}</span>
            </span>
          ))}
        </span>
      </div>
    );
  }
  /* Nothing to read on this line — the slot keeps its height all the same */
  return <div className="hidden sm:block h-[23px]" aria-hidden data-chrome-line-empty />;
};

interface PaneProps {
  /** A strike the pane opens focused on — the arrival's (see `TerrainArrival`) */
  arriveFocus?: number | null;
  cfg: PaneCfg;
  onCfg: (patch: Partial<PaneCfg>) => void;
  revision: number;
  expanded: boolean;
  onToggleExpand: () => void;
  index: number;
  /** Panes get shorter as the grid gets wider — one chart earns the height */
  tall: boolean;
  /** This pane's real hover, out to the desk. Null when the pointer leaves. */
  onCrosshair: CrosshairSync;
  /** Hand the desk this pane's "mark that moment" function, null on unmount. */
  registerSync: (apply: CrosshairSync | null) => void;
  /* Replay, and it lives in the desk rather than in the pane, unlike draw mode. */
  replay: boolean;
  onToggleReplay: () => void;
  onExitReplay: () => void;
  /* Draw mode, and it sits beside replay for the same two reasons. It has a key now (`d`), so the desk has to own it
     — the handler is installed once and toggles whichever pane is active. */
  drawing: boolean;
  onToggleDrawing: () => void;
  onExitDraw: () => void;
  /** Whether the keys act on this pane, and how to make them. */
  isActive: boolean;
  onActivate: () => void;
  /** How many panes are on the desk — a number badge on the only pane on screen is chrome that says nothing. */
  paneCount: number;
  /** Mid-fade on the way out of the takeover — see the desk's `closeExpanded`. */
  closing?: boolean;
  /** Which of this pane's menus a key has opened, if any. */
  menuOpen: 'symbol' | 'compare' | 'tabs' | null;
  onMenu: (which: 'symbol' | 'compare' | 'tabs' | 'tabs' | null) => void;
  /** The pane's real box, handed up so the desk can scroll it into view when a key makes it active — below `lg` the
      panes stack and the page scrolls. */
  boxRef?: (el: HTMLDivElement | null) => void;
  /* Extra grid classes for this pane's box. */
  cell?: string;
  /** The desk's one choice of rail colours — see TerrainCfg.palette */
  palette: ProfilePalette;
  /** Which contracts this pane's rail reads — the desk's one choice, changed from any rail's head */
  railCut: RailCut;
  onRailCut: (cut: RailCut) => void;
  /** Expanded: the floating desk bar's height. The pane keeps that much (and a margin) clear at its foot, so the bar
      sits under the time axis instead of across the flow pane. 0 when no bar floats over this pane. */
  footRoom?: number;
}

/** The strike rail's rest width on this desk: a narrow column beside the tape, not two fifths of the pane (the rail took
    ~40% of a pane's width at the panel's own rest widths). Dragged wider, it keeps the reader's width; the bar's
    STRIKES switch and the panel's × fold it away. */
const railRestWidth = (panes: number, expanded: boolean): number => Math.max(PROFILE_MIN_W, expanded || panes === 1 ? 320 : panes === 3 ? 180 : 210);

/** One pane's fault stays in its cell: the other panes keep drawing, and this one offers to draw again (a new name or
    interval clears it too) — a throw in one chart used to take the whole desk down */
class PaneBoundary extends Component<{ children: ReactNode; name: string; resetKey: string; cell: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[terrain pane]', this.props.name, error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`relative min-h-0 min-w-0 flex flex-col items-center justify-center gap-2 rounded-md border border-bear/25 bg-bear/[0.03] p-4 text-center ${this.props.cell}`} data-pane-fault>
        <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-bear">{this.props.name} could not draw</span>
        <span className="max-w-[360px] font-mono text-t10 text-textMuted break-words">{this.state.error.message}</span>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-1 rounded border border-borderMuted px-2 py-1 font-mono text-t10 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05]"
        >
          Draw it again
        </button>
      </div>
    );
  }
}

const Pane = ({
  cfg, onCfg, revision, expanded, onToggleExpand, index, tall,
  onCrosshair, registerSync, replay, onToggleReplay, onExitReplay,
  drawing, onToggleDrawing, onExitDraw,
  isActive, onActivate, paneCount, closing = false, menuOpen, onMenu,
  boxRef, cell = '', palette, railCut, onRailCut, arriveFocus = null, footRoom = 0,
}: PaneProps) => {
  /* the field's scale, for the key in the chart's corner (0 while the field is off) */
  const [fieldScale, setFieldScale] = useState(0);
  const onTrailKey = useCallback((ref: number) => setFieldScale(ref), []);
  const chartCrosshair = useStable(onCrosshair);
  const chartSyncRegister = useStable(registerSync);
  const chartExitDraw = useStable(onExitDraw);
  const chartEnterDraw = useStable(onToggleDrawing);
  const chartExitReplay = useStable(onExitReplay);
  const { ticker, timeframe, overlays, indicators, chartStyle, clock, compares, priceScale, sessionOr, ladder } = cfg;
  /* The pane holds its own name's book, docked or expanded: the takeover hides the tab strip that was asking for it,
     and an expanded pane's rail and nodes went stale with nothing refreshing them. ensureBook is a no-op while the
     book is fresh. */
  useEffect(() => {
    ensureBook(ticker, 'board');
    const id = window.setInterval(() => ensureBook(ticker, 'board'), 30_000);
    return () => window.clearInterval(id);
  }, [ticker, expanded]);
  /* Its own theme, else the page's default — Glacier on the dark terminal, Stone on paper — re-read on a flip */
  const pageDefault = usePageDefaultCandleKey();
  const theme = cfg.theme ?? pageDefault;
  /* The chart's own picture, handed in on mount (StrikeChart snapshotRegister) */
  const snapshotTakeRef = useRef<(() => HTMLCanvasElement | null) | null>(null);
  const chartSnapshotRegister = useCallback((take: (() => HTMLCanvasElement | null) | null) => {
    snapshotTakeRef.current = take;
  }, []);
  /* What the axis is actually drawing, from the one function that decides it. */
  const scaleLock = priceScaleLockedBy(compares);
  /* An "Own scale" comparison gives the tape a second price gutter, down the left (StrikeChart's
     `leftPriceScale.visible`). */
  const ownScale = compares.some(c => c.mode === 'scale');
  /* Below `lg` this desk stops filling the viewport and becomes a column the page scrolls through — so the wheel has
     to belong to the page, not to the chart. See `pageScroll` on StrikeChart for what was measured. */
  const belowLg = useIsBelowXl();
  /* Read here rather than threaded down: this component already takes fourteen props, and it is the same one-line
     media query the page reads. */
  const isPhone = useIsPhone();

  /* The compare legend has to start below the strip, not at 46px The legend was pinned at `top-[46px]` — the strip's
     height when it holds one row. */
  const stripRef = useRef<HTMLDivElement | null>(null);
  /* This pane's own box — the section its toolbar's menus stay inside; the desk's paneRefs get the same element
     through boxRef. */
  const paneBoxRef = useRef<HTMLDivElement | null>(null);
  const [stripH, setStripH] = useState(46);
  /* The same observation answers a second question: how much room the toolbar has. */
  const [stripW, setStripW] = useState(0);
  /* Every layout choice the strip's width makes, as one key: a width that changes none of them (a rail drag, a window
     resize between thresholds) is not a new render of the pane, its toolbar and its rail. */
  const stripKeyRef = useRef<(w: number) => string>(() => '');
  stripKeyRef.current = (w: number) => {
    if (!(w > 0)) return '0';
    const inner = w - PRICE_GUTTER_PX - (ownScale ? PRICE_GUTTER_PX : STRIP_PAD_PX) - (expanded ? 0 : EXPAND_CHIP_PX);
    const row = ID_ROW_FULL_PX + MTF_FULL_PX + 24 + ROW_DOOR_PX;
    const marks = [ID_ROW_FULL_PX, ID_ROW_NO_PCT_PX, ID_ROW_NO_BADGE_PX, READOUT_C_PX + READOUT_OHL_PX, READOUT_C_PX + READOUT_OHL_PX + READOUT_VOL_PX, row + TOOLBAR_FULL_PX, row + TOOLBAR_COMPACT_PX];
    for (let k = 1; k <= 8; k++) marks.push(READOUT_C_PX + READOUT_OHL_PX + READOUT_VOL_PX + k * READOUT_IND_PX);
    const heavy = Math.max(1, Math.min(HEAVY_MAX, Math.floor((inner - HEAVY_LABEL_PX) / HEAVY_ENTRY_PX)));
    const compact = expanded ? w - 24 < ID_ROW_FULL_PX + TOOLBAR_FULL_PX + ROW_DOOR_PX + 36 : w - PRICE_GUTTER_PX < TOOLBAR_FULL_PX;
    return `${marks.map(m => (inner >= m ? 1 : 0)).join('')}|${heavy}|${compact ? 1 : 0}`;
  };
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      // GetBoundingClientRect, not contentRect: the strip carries p-1.5 and contentRect excludes padding, which
      // would put the legend back under it.
      const r = el.getBoundingClientRect();
      const h = Math.round(r.height);
      if (h > 0) setStripH(h);
      const w = Math.round(r.width);
      if (w > 0) setStripW(prev => (prev > 0 && stripKeyRef.current(prev) === stripKeyRef.current(w) ? prev : w));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* What the strip's rows can actually use — the column, less the gutter it clears on each side. Derived from the
     same expression the padding above applies, so the two cannot disagree about how much room was taken. */
  const stripInner = stripW > 0 ? stripW - PRICE_GUTTER_PX - (ownScale ? PRICE_GUTTER_PX : STRIP_PAD_PX) - (expanded ? 0 : EXPAND_CHIP_PX) : 0;
  const roomFor = (px: number) => stripInner === 0 || stripInner >= px;
  const showChangePct = roomFor(ID_ROW_FULL_PX);
  const showBadge = paneCount > 1 && roomFor(ID_ROW_NO_PCT_PX);
  const showCompareAdd = roomFor(ID_ROW_NO_BADGE_PX);
  /* At least one entry: a heaviest label with nothing after it is chrome that says nothing, so the row hides itself
     entirely rather than print a header over an empty line (see `heavy.length > 0` at the row). */
  const heavyCount = stripInner === 0
    ? HEAVY_MAX
    : Math.max(1, Math.min(HEAVY_MAX, Math.floor((stripInner - HEAVY_LABEL_PX) / HEAVY_ENTRY_PX)));

  /* Add / remove a crossed symbol. */
  const addCompare = (t: string, mode: CompareMode) =>
    onCfg({
      compares: (() => {
        if (compares.length >= COMPARE_INKS.length || compares.some(c => c.ticker === t) || t === ticker) return compares;
        const ink = COMPARE_INKS.find(i => !compares.some(c => c.ink === i)) ?? COMPARE_INKS[0];
        return [...compares, { ticker: t, mode, ink }];
      })(),
    });
  const removeCompare = (t: string, mode: CompareMode) =>
    onCfg({ compares: compares.filter(c => !(c.ticker === t && c.mode === mode)) });

  /* The desk's reducer now sets `compares` explicitly on every symbol change, so the effect that used to clear them
     here is gone — and it had to go. */

  // Each pane reads its own book; revision keeps the levels tracking the tick
  /* The rail's book for the desk's cut: rows, core, walls and legs in one read, so the chart's level lines, the
     header's heaviest line and the rail can never name different strikes for different expiries */
  const railData = useMemo(
    () => railForCut(ticker, railCut),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, revision, railCut]
  );
  /* The expiry a later-date cut reads, and its rows: the header's heaviest read and the house levels both use them. */
  const bookPick = railCut === 'book' || railCut === 0
    ? null
    : (() => {
        const d = expiryFor(railCut).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
  const shownBook = useMemo(
    () => chainForDate(ticker, bookPick),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, revision, bookPick],
  );
  /* The walls, flip and supreme are the house's (data/levelsFor.ts): the desk-wide levels scope Pinpoint's head sets, or
     the cut's own expiry when the rail is cut to a later date, off the rows the rail already holds. */
  const levelsScope = useLevelsScope();
  const house = useLevelsFor(ticker, levelsScope, bookPick ? shownBook?.date ?? null : null);
  /* the field's cut: its net GEX off the house's rows for it, the figure Pinpoint prints for the same cut */
  const fieldNodes = (railCut === 'book' ? chainForDate(ticker, 'book') : shownBook)?.nodes;
  const fieldOiNet = useMemo(() => (fieldNodes ? dealerOf(fieldNodes.reduce((a, n) => a + n.netGex, 0)) : null), [fieldNodes]);
  /* the levels' own contracts: their largest strike sizes each wall, and their expiry names max pain */
  const levelsChain = house ? chainForDate(ticker, house.date ?? 'book') : null;
  const levelsNodes = levelsChain?.nodes;
  const levelsTop = useMemo(() => (levelsNodes ? levelsNodes.reduce((m, n) => Math.max(m, Math.abs(n.netGex)), 0) : 0), [levelsNodes]);
  const maxPain = useMaxPain(ticker, house?.date ?? levelsChain?.date ?? null, overlays.levels);
  const levels = useMemo(() => paneLevels(railData.spot, house, { top: levelsTop, maxPain }), [railData, house, levelsTop, maxPain]);
  /* Dark-pool and option prints are the chart's own feed. Passing an empty list here used to win, and the overlay drew nothing. */
  /* The rail's rows come off the same snapshot `levels` was reduced from. The header's three-strike read uses them
     too, so the line and the column can never name different strikes. */
  const rail = railData;
  /* The five timeframes' trend state. */
  /* the regular session's one-minute tape: the trends read it, and after the bell its last bar is the close */
  const cashTape = useThetaTape(ticker, '1m', 'rth');
  const confluence = useMemo(() => buildConfluence(cashTape.bars), [cashTape.bars]);
  /* …as the glyphs on the timeframe pills: one state a timeframe the confluence reads */
  const trendByTf = useMemo(() => {
    const out: Partial<Record<Timeframe, TrendState | null>> = {};
    for (const r of confluence) out[r.tf] = r.state;
    return out;
  }, [confluence]);
  const [rollNote, setRollNote] = useState<string | null>(null);
  const drawnDate = useRef<{ ticker: string; date: string } | null>(null);
  useEffect(() => {
    const date = shownBook?.date;
    if (!date || date === 'book') return;
    const was = drawnDate.current;
    drawnDate.current = { ticker, date };
    if (!was || was.ticker !== ticker) {
      if (was && was.ticker !== ticker) setRollNote(null);
      return;
    }
    if (was.date !== date && !expiryOpen(was.date)) setRollNote(`${expiryLabel(was.date)} settled, now on ${shownBook.label}`);
    else if (was.date !== date) setRollNote(null);
  }, [ticker, shownBook?.date, shownBook?.label]);
  const heavy = useMemo(() => {
    const nodes = shownBook?.nodes;
    if (!nodes?.length) return heaviest(rail.core, heavyCount);
    const rows = nodes.map(n => ({ strike: n.strike, value: n.netGex })).sort((a, b) => b.strike - a.strike);
    const i = Math.max(0, rows.findIndex(s => s.strike <= rail.spot));
    return heaviest(rows.slice(Math.max(0, i - 12), i + 13), heavyCount);
  }, [shownBook, rail, heavyCount]);

  /* What the reader clicked in the rail, flashed on the chart. Clicking the same strike again clears it, so the rail
     is a toggle rather than a thing you can only turn on. */
  /* Where the chart puts a price, handed to the rail so the two columns cannot disagree. A ref, so it never re-
     renders anything: the rail reads it inside its own frame loop. */
  const projectionRef = useRef<PriceProjection | null>(null);
  /** The pane's PNG exporter, filled by the chart. */
  const exportPngRef = useRef<(() => void) | null>(null);

  /* An expanded pane covers the desk, so the keyboard has to be inside it. */
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(expanded, overlayRef);

  const [focus, setFocus] = useState<number | null>(arriveFocus);
  /* The chart's "not in yet" notes, shown as a chip in this pane's corner row — never over the candles */
  const [gapLines, setGapLines] = useState<string[]>([]);
  const chartKeepStrike = useCallback((price: number) => setFocus(cur => (cur != null && Math.abs(cur - price) < 1e-9 ? null : price)), []);
  /* A strike belongs to its name: let go of when the pane changes name (never on the mount — an arrival's would go
     with it) */
  const focusName = useRef(ticker);
  useEffect(() => {
    if (focusName.current === ticker) return;
    focusName.current = ticker;
    setFocus(null);
  }, [ticker]);

  /* What a move to each strike forces dealers to trade — the panel's second lane, off the same rows the size lane
     draws (the cut's own chain, `fieldNodes`), integrated over that book re-priced along the walk: the ladder Pinpoint's
     walls print (wall.ts). A book that cannot be re-priced draws no rungs. */
  /* Re-priced when what it reads moves — the rows' strikes, spot, the cut's chain, the book — not on every tape tick:
     `revision` also counts ThetaData's bars, which bumped this ~14 times a second on a first load (each a ~4 ms re-price
     of the whole book at ~320 prices) without changing any input. */
  const bookRev = useBookRev();
  const flowStrikes = rail.rows.map(r => r.strike).join(',');
  const flow = useMemo(() => {
    if (!rail.rows.length) return null;
    const snap = snapshotFor(ticker, '0DTE');
    const chain = fieldNodes;
    const repriced = snap?.liveBook && chain?.length ? (prices: readonly number[]) => levelNetPath(snap, chain, prices)?.path.map(v => -v) ?? null : undefined;
    return buildFlowFromRows(rail.rows, levels.spot, repriced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStrikes, levels.spot, fieldNodes, ticker, bookRev]);
  /* The ladder's two legs: the put and call hedging behind every strike's net, off the live chain, and the net at
     the open as a ratio of now for the spine's ghost — the size lane draws the strike ladder's rows */
  const legs = railData.legs;
  const openRatio = useMemo(
    () => netSinceOpenRatio(ticker),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, revision]
  );
  /* The panel's "How to read", as a focus over this pane — the Map's own card */
  const [guideOpen, setGuideOpen] = useState(false);

  /* The bar under the crosshair — this pane's pointer or a moment synced from another pane. */
  const [readout] = useState(() => makeCell<CrosshairBar | null>(null));
  useEffect(() => readout.set(null), [ticker, timeframe, readout]);


  /* The chrome wears this pane's candle theme: the box stamps its own ground (data-chart-ground) and index.css re-
     scopes the tokens inside to it. */
  const ground = chartGround(theme);
  const surface = 'rgb(var(--panel))';
  /* The strip's 55% wash of the chrome's panel — the strip carries data-chart-chrome, so the token it reads is the
     ground's: black over a dark tape, stone over a light one */
  const strip = 'rgb(var(--panel) / 0.55)';

  const session = useDeskSession();
  /* The head's price is ThetaData's, drawn by leaves that alone re-render on a print (HeadPrice, HeadMove) */
  useEffect(() => wantPrint(ticker), [ticker]);
  const cashClose = session === 'post' || session === 'overnight' ? cashTape.bars[cashTape.bars.length - 1]?.close ?? null : null;


  /* Compact when the strip would not fit on one line, the phone's mode: the timeframes collapse into one trigger and
     each dropdown shows its icon. */
  /* IN fullscreen the strip carries the identity, the toolbar and the door on one row: the full form must fit beside
     the identity and the way out, or the compact form rides the row — the docked row's own rule */
  const toolbarCompact = stripW > 0 && (expanded ? stripW - 24 < ID_ROW_FULL_PX + TOOLBAR_FULL_PX + ROW_DOOR_PX + 36 : stripW - PRICE_GUTTER_PX < TOOLBAR_FULL_PX);
  /* The toolbar rides the identity row when the row has room for the identity at its fullest, a gap, the toolbar as
     it would draw, and the fullscreen door. */
  /* The pane's tabs left the head for the strip across the desk's top */
  const inlineFull = !expanded && stripInner > 0 && stripInner >= ID_ROW_FULL_PX + MTF_FULL_PX + 24 + TOOLBAR_FULL_PX + ROW_DOOR_PX;
  /* Short of the full labels beside the identity, the compact toolbar rides the row before a row of its own is spent
     (a one-up with the rail open: 1073 usable, the identity 514, the full toolbar 994, the compact 350) */
  const inlineCompact = !inlineFull && !expanded && stripInner > 0 && stripInner >= ID_ROW_FULL_PX + MTF_FULL_PX + 24 + TOOLBAR_COMPACT_PX + ROW_DOOR_PX;
  const toolbarInline = inlineFull || inlineCompact;
  const toolbarCompactShown = toolbarInline ? inlineCompact : toolbarCompact;

  /* The tools button — 3- and 4-pane desks only. */
  const rollable = !expanded && !isPhone && !toolbarInline && paneCount >= 3;
  const [rolled, setRolled] = useState(false);
  const rollIn = useCallback(() => setRolled(false), []);
  useEffect(() => {
    if (!rollable) setRolled(false);
  }, [rollable]);
  useEffect(() => {
    if (!rolled) return;
    const box = paneBoxRef.current;
    const held = () => !!document.querySelector('[data-toolbar-menu], [role="dialog"]');
    let timer = 0;
    const leave = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!held()) setRolled(false);
      }, 400);
    };
    const enter = () => window.clearTimeout(timer);
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || box?.contains(t) || t.closest('[data-toolbar-menu], [role="dialog"], [data-radix-popper-content-wrapper]')) return;
      setRolled(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRolled(false);
    };
    box?.addEventListener('pointerleave', leave);
    box?.addEventListener('pointerenter', enter);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(timer);
      box?.removeEventListener('pointerleave', leave);
      box?.removeEventListener('pointerenter', enter);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [rolled]);
  /* A pick made from the toolbar: the setting lands and the kit rolls in (a no-op where it is not rolled) */
  const pick = (patch: Partial<PaneCfg>) => {
    onCfg(patch);
    rollIn();
  };

  /* One toolbar, two mounts. Docked it is the hover-revealed chip floating over the tape; expanded it is the always-
     on strip pinned across the pane's top, the Pulse fullscreen grammar. */
  /* The identity controls, hoisted. One definition, two homes: expanded they lead the pinned strip, exactly as
     Pulse's takeover leads with its symbol capsule; docked they stay in the floating chip over the tape. */
  const identityControls = (
    <>
      {showBadge && (
        <span
          aria-hidden
          className={`shrink-0 w-4 h-4 rounded-[3px] font-mono text-t9 font-bold tnum inline-flex items-center justify-center ${
            isActive ? 'relative holo-bg foil-glide text-onfoil' : 'bg-ink/[0.08] text-textPrimary'
          }`}
        >
          {index + 1}
        </span>
      )}
      {/* The replay badge, and it is the reason the rest of this is safe to ship. A pane in replay looks exactly like
          a live one, and the transport sits at the bottom where a glance never reaches. */}
      {replay && (
        <span
          title="This pane is replaying history — it is not live"
          className="shrink-0 inline-flex items-center gap-1 px-1.5 h-4 rounded-[3px] bg-silverFill text-onfoil font-mono text-t9 font-bold uppercase tracking-wider"
        >
          Replay
        </span>
      )}
      <span className="shrink-0 inline-flex items-center gap-1.5">
        {/* The own-name scope chip: every Terrain pane holds its own name, so it wears the bordered chip with the
            mark. */}
        <ScopeChip
          ticker={ticker}
          onPick={t => onCfg({ ticker: t, tabs: tabsAfter(cfg.tabs, ticker, t) })}
          open={menuOpen === 'symbol'}
          onOpenChange={o => onMenu(o ? 'symbol' : null)}
          /* The ring ↑/↓ walks is invisible, so the one control it moves is where it gets named. */
          title="Switch ticker — S · ↑ ↓ step your symbols"
        />
      </span>
    </>
  );
  /* The lesser controls, on the toolbar's right: the link chip — ∅ → A → B → ∅, letters not colours, the palette's
     inks all mean something already — and TradingView's compare, another symbol crossed onto this tape */
  const paneRightExtras = (
    <>
      <button
        onClick={() => onCfg({ link: cfg.link === 'A' ? 'B' : cfg.link === 'B' ? null : 'A' })}
        aria-label={cfg.link ? `Link group ${cfg.link} — linked panes follow this pane's symbol` : 'Link this pane — panes sharing a letter follow each other\'s symbol'}
        title={cfg.link ? `Link group ${cfg.link} — panes sharing ${cfg.link} follow each other's symbol` : 'Link this pane to others — shared letters change symbols together'}
        className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded font-mono text-t9 font-bold transition-colors ${
          cfg.link ? 'bg-ink/[0.14] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'
        }`}
        data-pane-link
      >
        {cfg.link ?? <Link2 className="w-3 h-3" />}
      </button>
      {/* Not on a 3- OR 4-pane desk — a crossed symbol on a 480px chart is a second tape in a space that holds one;
          the two-up and the one-up keep the door */}
      {paneCount < 3 && (
        <CompareControl
          current={ticker}
          compares={compares}
          onAdd={addCompare}
          onRemove={removeCompare}
          open={menuOpen === 'compare'}
          onOpenChange={o => onMenu(o ? 'compare' : null)}
        />
      )}
    </>
  );

  /* The pane's picture: the chart's canvases plus the open rail, which html2canvas draws (loaded only on the camera
     press) because some rail views are markup. */
  const takeSnapshot = async (): Promise<HTMLCanvasElement | null> => {
    const chart = snapshotTakeRef.current?.();
    if (!chart) return null;
    const box = paneBoxRef.current;
    const chartEl = box?.querySelector<HTMLElement>('[data-chart-ground]') ?? null;
    const panelEl = ladder ? box?.querySelector<HTMLElement>('[data-profile-panel]') ?? null : null;
    const ground = (el: HTMLElement | null) => {
      const c = el ? getComputedStyle(el).backgroundColor : '';
      return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' ? c : undefined;
    };
    let panel: HTMLCanvasElement | null = null;
    if (panelEl) {
      try {
        const { default: html2canvas } = await import('html2canvas');
        panel = await html2canvas(panelEl, {
          backgroundColor: ground(panelEl) ?? null,
          scale: Math.max(1, window.devicePixelRatio || 1),
          useCORS: true,
          logging: false,
          /* The capsules' figures sit in a truncating span one line tall (leading-none); the drawing library clips a
             glyph's ink to that box where the browser lets it show — the clone's spans let it show too */
          onclone: doc => {
            doc.querySelectorAll<HTMLElement>('[data-profile-panel] .truncate').forEach(el => {
              el.style.overflow = 'visible';
            });
          },
        });
      } catch {
        panel = null; /* the rail could not be drawn — the chart stands alone, as without a rail */
      }
    }
    const clock = readSessionClock();
    const when = `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${clock.etTime} ET`;
    return composeSnapshot(
      chart,
      panel,
      (() => {
        const { px, move } = headRead(ticker, session, cashClose, thetaMove(peekThetaPrice(ticker)?.value));
        return { ticker, timeframe, price: px != null ? px.toFixed(2) : '—', change: move == null ? '—' : `${move >= 0 ? '+' : '−'}${Math.abs(move).toFixed(2)}%`, up: (move ?? 0) >= 0, when };
      })(),
      panelEl ?? chartEl ?? box,
      { chart: ground(chartEl), panel: ground(panelEl) }
    );
  };

  const paneToolbar = (spread: boolean) => (
    <ChartToolbar
      minimal
      candles
      rightExtras={paneRightExtras}
      onSnapshot={takeSnapshot}
      snapshotName={snapshotName(ticker, timeframe)}
      compact={toolbarCompactShown}
      /* Docked, the menus are the small ones, and every menu stays inside this pane */
      dense={!expanded}
      menuBounds={paneBoxRef}
      spread={spread}
      alertTicker={ticker}
      alertSpot={levels.spot}
      timeframe={timeframe}
      onTimeframe={tf => pick({ timeframe: tf })}
      trend={trendByTf}
      overlays={overlays}
      onOverlays={o => onCfg({ overlays: o })}
      /* The strike band docks under the tape when Exposure by strike is on. The chart mounts it; this menu only switches it. */
      overlayKeys={['trails', 'levels', 'darkpool', 'volume', 'flow', 'netDrift', 'volDrift', 'dexStrike', 'session', 'cone', 'events', 'alerts']}
      indicators={indicators}
      onIndicators={i => onCfg({ indicators: i })}
      paneId={`terrain:${index + 1}`}
      fullscreen={expanded}
      chartStyle={chartStyle}
      onChartStyle={st => pick({ chartStyle: st })}
      themeKey={theme}
      onThemeKey={t => pick({ theme: t })}
      barClock={clock}
      onBarClock={k => pick({ clock: k })}
      priceScale={priceScale}
      onPriceScale={ps => pick({ priceScale: ps })}
      priceScaleLock={scaleLock}
      onExportPng={() => exportPngRef.current?.()}
      sessionOr={sessionOr}
      onSessionOr={o => pick({ sessionOr: o })}
      replay={replay}
      onToggleReplay={() => {
        onToggleReplay();
        rollIn();
      }}
    />
  );

  /* The fullscreen door, one button with two homes when docked: the corner chip at rest, or the identity row's last
     item when the toolbar rides that row. */
  const expandDoor = (
    <button
      onClick={onToggleExpand}
      aria-pressed={expanded}
      aria-label={`Expand ${ticker} to the full screen`}
      title="Expand this pane — F"
      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
      data-expand-door
    >
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div
      ref={overlayRef}
      /* IN and out on a fade, the Pulse takeover's own grammar. Enter is the house soft-in; exit is a 200ms opacity
         fade that the desk's `closeExpanded` holds the unmount open for. */
      className={
        expanded
          ? `fixed inset-0 z-[80] flex flex-col animate-soft-in transition-opacity duration-200 ease-out ${
              closing ? 'opacity-0' : ''
            }`
          : 'contents'
      }
      {...(expanded
        ? /* the script editor's dock takes the right edge while it is open (data/editorDock.ts) */
          { role: 'dialog' as const, 'aria-modal': true, tabIndex: -1, 'aria-label': `${ticker} expanded`, style: DOCK_ROOM }
        : {})}
    >
      {/* The pane's own floor, and it has to be here. The wrapper above is `display: contents` when the pane is not
          expanded, so this div is the real grid item. */}
      {/* Activation lives on this div, not the wrapper above: the wrapper is `display: contents` when the pane is not
          expanded and generates no box, so it has neither a border to ring nor an area to click. */}
      <div
        ref={el => {
          paneBoxRef.current = el;
          boxRef?.(el);
        }}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
        className={`relative flex flex-col overflow-hidden animate-soft-in ${
          expanded
            ? 'flex-1 min-h-0'
            /* The 420px floor is for the stacked, scrolling shape between phone and `lg`, where a pane with no floor
               collapses to nothing. */
            : `${isPhone ? 'min-h-0' : 'min-h-[420px]'} xl:min-h-0 border rounded-md ${cell} ${
                /* Active wears the foil — border-transparent holds the layout slot, the .holo-ring overlay paints
                   the silver. */
                isActive && paneCount > 1 ? 'border-transparent' : 'border-borderSubtle'
              }`
        }`}
        style={{ animationDelay: `${index * 60}ms`, background: surface }}
        /* A dark island on any page: a pane reads the dark tokens whatever the page wears */
        data-theme="dark"
        /* …and its chrome the ground of this pane's own theme */
        data-chart-ground={ground}
        /* …and so does the frame itself, the ladder in it with it */
        data-chart-frame
      >
        {!expanded && isActive && paneCount > 1 && (
          <span aria-hidden className="holo-ring foil-glide absolute inset-0 rounded-md z-30" />
        )}
        {/* Chart and rail on one line, and that line is the whole pane — `absolute inset-0`, not a flex row under a
            header. */}
        <div className="absolute inset-0 flex">
          <div
            className="group relative flex-1 min-w-0"
            /* Expanded, the desk bar floats at the foot: the chart ends above it, its time axis and flow pane whole */
            style={expanded && footRoom > 0 ? { paddingBottom: footRoom + DESK_BAR_GAP_PX * 2 } : undefined}
          >
            {/* One pane per frame: each chart mounts a frame after the last behind its skeleton, so a four-pane desk
                opens on its next frame instead of building four charts in the click. */}
            <Deferred index={index} fallback={<ChartSkeleton className="h-full" />} className="h-full animate-fade-in">
            <StrikeChart
              ticker={ticker}
              paneId={`terrain:${index + 1}`}
              revision={revision}
              /* the field reads the rail's cut: one expiry, or every expiry */
              bookDate={railCut === 'book' ? 'book' : bookPick}
              levels={levels}
              timeframe={timeframe}
              height={tall ? 260 : 200}
              overlays={overlays}
              onOverlays={o => onCfg({ overlays: o })}
              indicators={indicators}
              onIndicators={i => onCfg({ indicators: i })}
              chartStyle={chartStyle}
              themeKey={theme}
              /* The field's key prints on the desk's own line, not under every pane */
              trailKey={false}
              onTrailKey={onTrailKey}
              /* The chart's picture, for the toolbar's camera */
              snapshotRegister={chartSnapshotRegister}
              barClock={clock}
              compares={compares}
              priceScale={priceScale}
              sessionOr={sessionOr}
              drawing={drawing}
              onExitDraw={chartExitDraw}
              /* The persistent rail's way in — a tool clicked at rest arms draw mode with that tool in hand (guarded
                 in the chart, so clicking tools while drawing never toggles it off). */
              onEnterDraw={chartEnterDraw}
              /* Only the takeover has a top band to spare. */
              railTopOk={expanded}
              /* IN fullscreen the desk bar floats over the pane's foot (the bar below: `fixed`, 12px above the time
                 axis), where the replay card also lives — the bar lay across the card's controls. */
              footInset={expanded && !(footRoom > 0) ? 44 : 0}
              replay={replay}
              onExitReplay={chartExitReplay}
              focusPrice={focus}
              /* A bead clicked on the field keeps its strike — the ladder's own toggle */
              onKeepStrike={chartKeepStrike}
              priceTag
              onCrosshair={chartCrosshair}
              syncRegister={chartSyncRegister}
              onReadout={readout.set}
              projectionRef={projectionRef}
              exportRef={exportPngRef}
              pageScroll={belowLg}
              frameless
              onGapNotes={setGapLines}
            />
            </Deferred>
            {/* The pane's corner chip row: the field's key (the model, its switch, the colour scale and the cut's net
                GEX) and, beside it, what is not in yet */}
            {!replay && (overlays.trails || gapLines.length > 0) && (
              /* Chips in the top-right corner, under the expand door and in the price scale's top margin — they never
                 sit on a bar (the card it replaced stood over the candles and the volume at the bottom-left) */
              <div
                className="absolute z-20 flex w-max max-w-[calc(100%-120px)] items-center justify-end gap-1.5"
                style={{ top: expanded ? 52 : isPhone ? stripH + 4 : 34, right: PRICE_GUTTER_PX + 6 }}
                data-terrain-corner-chips
              >
                {gapLines.length > 0 && (
                  <span className="flex min-w-0 max-w-[260px]" data-terrain-gaps>
                    <GapChip lines={gapLines} />
                  </span>
                )}
                {overlays.trails && (
                  <div className="shrink-0" data-terrain-field-key>
                    <FieldKey
                      ticker={ticker}
                      cut={railCut === 'book' ? 'book' : shownBook?.date ?? null}
                      cutWords={railCut === 'book' ? (rootTradesSession(ticker, session) ? 'the whole book' : 'options shut') : shownBook?.label ?? '—'}
                      scale={fieldScale}
                      oiNet={fieldOiNet}
                      compact={isPhone || (paneCount > 1 && !expanded)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Who this pane is, and how it is set up floating over the tape, not stacked above it. */}
            {/* IT comes and goes. Graded, not all-or-nothing, because the two rows answer different questions. */}
            {!expanded && !toolbarInline && (
              /* The expand button, far right — its own chip pinned to the pane's top-right corner, clear of the
                 price ticks, out of the identity row it used to ride at the end of. */
              <div
                className="chrome-hover absolute top-1.5 z-30 pointer-events-auto select-none rounded-md bg-canvas/25 backdrop-blur-[3px] p-0.5 opacity-55 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
                style={{ right: PRICE_GUTTER_PX + 6 }}
              >
                {expandDoor}
              </div>
            )}
            {expanded && (
              /* The fullscreen top strip The Pulse takeover's grammar exactly: full width, always visible,
                 translucent over the tape with the same 55% surface wash and blur, controls spread edge to edge. */
              <div
                className="absolute top-0 inset-x-0 z-30 select-none flex flex-wrap items-center px-3 py-2 gap-3 backdrop-blur-md backdrop-saturate-150"
                style={{ background: strip }}
                /* Chrome over the tape: its tokens follow the pane's ground (index.css), and the scripts' legend
                   measures it like the identity row below */
                data-chart-chrome
                data-head-form={inlineFull ? 'full' : inlineCompact ? 'compact' : 'own'}
                data-strip-inner={stripInner}
              >
                {/* The symbol leads, Pulse-style — then a hairline, then everything else spread to the far edge. */}
                <span className="shrink-0 flex items-center gap-2 pointer-events-auto">{identityControls}</span>
                <span className="shrink-0 w-px h-4 bg-borderSubtle" aria-hidden />
                <div className="flex-1 min-w-0">{paneToolbar(true)}</div>
                {/* The way back out, at the far right end of the strip — the mirror of the docked corner chip. */}
                <button
                  onClick={onToggleExpand}
                  aria-pressed={expanded}
                  aria-label={`Collapse ${ticker}`}
                  title="Collapse — Esc"
                  className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div
              ref={stripRef}
              /* Padding clears the price gutter, so nothing floating ever lands on a price tick — both gutters
                 whenever there is a left one, with no width condition on it. */
              style={{
                paddingLeft: ownScale ? PRICE_GUTTER_PX : undefined,
                /* …and the expand chip pinned in the top-right corner: the identity row ends before it, never under it */
                paddingRight: PRICE_GUTTER_PX + (!expanded && !toolbarInline ? EXPAND_CHIP_PX : 0),
              }}
              /* gap-3.5 on a touch screen: the toolbar row's finger boxes (22px above its controls' centres) clear the symbol
                 chip's (22px below its centre) in the identity row (the last-targets pass, 2026-10-30) */
              className={`pointer-events-none absolute inset-x-0 ${expanded ? 'top-11' : 'top-0'} z-20 flex flex-col items-start gap-1 [@media(pointer:coarse)]:gap-3.5 p-1.5`}
              /* Floating chrome the chart's scripts legend measures and sits under */
              data-chart-chrome
              data-head-form={inlineFull ? 'full' : inlineCompact ? 'compact' : 'own'}
              data-strip-inner={stripInner}
              data-toolbar-inline={toolbarInline ? '' : undefined}
            >
              {/* One row, always — it does not wrap, it clips. */}
              {/* IT hugs its content. */}
              {expanded ? (
                /* Fullscreen's second line — the Pulse takeover's own legend: facts on the tape, no chip, no
                   controls; the controls all moved up into the strip. */
                <div className="pointer-events-none select-none flex items-baseline gap-1.5 font-mono">
                  <span className="text-t11 font-semibold text-textPrimary">{ticker}</span>
                  <span className="text-t10 text-textMuted" aria-hidden>·</span>
                  <span className="text-t10 text-textMuted">{timeframe}</span>
                  <span className="text-t10 text-textMuted" aria-hidden>·</span>
                  <HeadPrice ticker={ticker} session={session} className="font-mono text-t11 font-semibold tnum text-textPrimary" />
                  <HeadMove ticker={ticker} session={session} cashClose={cashClose} className="text-t10 font-semibold tnum" />
                </div>
              ) : (
              <div className={`chrome-hover relative z-30 pointer-events-auto max-w-full min-w-0 overflow-hidden select-none flex items-center gap-2 rounded-md bg-canvas/25 backdrop-blur-[3px] px-2 py-1 opacity-55 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${toolbarInline ? 'w-full' : 'w-fit'}`}>
                {/* This strip is the one row visible at rest, so the number is legible without a pointer ever
                    touching the desk. */}
                {showBadge && (
                  <span
                    aria-hidden
                    className={`shrink-0 w-4 h-4 rounded-[3px] font-mono text-t9 font-bold tnum inline-flex items-center justify-center ${
                      isActive ? 'relative holo-bg foil-glide text-onfoil' : 'bg-ink/[0.08] text-textPrimary'
                    }`}
                  >
                    {index + 1}
                  </span>
                )}
                {/* The replay badge, and it is the reason the rest of this is safe to ship. A pane in replay looks
                    exactly like a live one: the same candles, the same rail, the same symbol. */}
                {replay && (
                  <span
                    title="This pane is replaying history — it is not live"
                    className="shrink-0 inline-flex items-center gap-1 px-1.5 h-4 rounded-[3px] bg-silverFill text-onfoil font-mono text-t9 font-bold uppercase tracking-wider"
                  >
                    Replay
                  </span>
                )}
                <span className="shrink-0 inline-flex items-center gap-1.5">
                  <ScopeChip
                    ticker={ticker}
                    onPick={t => onCfg({ ticker: t, tabs: tabsAfter(cfg.tabs, ticker, t) })}
                    open={menuOpen === 'symbol'}
                    onOpenChange={o => onMenu(o ? 'symbol' : null)}
                    /* The ring ↑/↓ walks is invisible, so the one control it moves is where it gets named. */
                    title="Switch ticker — S · ↑ ↓ step your symbols"
                  />
                  {/* The link chip: ∅ → A → B → ∅. Letters, not colours — the palette's inks all mean something
                      already, and a letter reads at 9px where a fourth colour would need a legend. */}
                </span>
                <span className="shrink-0">
                  <HeadPrice ticker={ticker} session={session} />
                </span>
                {shownBook?.movedFrom ? (
                  <span className="shrink-0 font-mono text-t10 text-textSecondary" data-book-roll title="The expiry you had open has settled">
                    {shownBook.movedFrom} settled, now on {shownBook.label}
                  </span>
                ) : rollNote ? (
                  <span className="shrink-0 font-mono text-t10 text-textSecondary" data-book-roll title="The expiry on this chart has settled">
                    {rollNote}
                  </span>
                ) : shownBook ? (
                  <span className="min-w-0 truncate font-mono text-t10 text-textMuted" title="The expiry and the book the nodes and Heaviest are drawn from">
                    {shownBook.label} · {shownBook.kind}
                  </span>
                ) : null}
                {/* First thing the row gives up when the column is narrow (ID_ROW_FULL_PX) — the price it is a delta
                    of is directly to its left, and the chart draws the same move. */}
                {showChangePct && <HeadMove ticker={ticker} session={session} cashClose={cashClose} className="shrink-0 font-mono text-t11 font-semibold tnum" />}
                {/* The toolbar in the row: timeframes after the identity, the replay-to-theme cluster at the far
                    right, and the fullscreen door last. */}
                {toolbarInline && (
                  <>
                    <div className="flex-1 min-w-0" data-toolbar-inline>
                      {paneToolbar(true)}
                    </div>
                    {expandDoor}
                  </>
                )}
              </div>
              )}

              {/* One read line shared by the heaviest strikes and the hovered bar, at a fixed height: a second row or
                  a taller read pushed the chrome under the pointer and made it oscillate. */}
              <ChromeReadLine cell={readout} stripInner={stripInner} heavy={heavy} />

              {/* Its own, every one of them — and not there until you reach. Docked only: the expanded pane pins the
                  same toolbar to the top strip instead, where it does not need a hover to exist. */}
              {!expanded && !toolbarInline && !rollable && (
                <div className="chrome-hover chrome-tap relative z-10 pointer-events-none max-w-full rounded-md bg-canvas/25 backdrop-blur-[3px] px-2 py-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100" data-toolbar-row>
                  {paneToolbar(false)}
                </div>
              )}
              {/* The tools button on a 3- or 4-pane desk (see `rollable`): one button at rest, and a press rolls the
                  kit down from under it. */}
              {rollable && (
                <div
                  className="chrome-hover chrome-tap relative z-10 pointer-events-none max-w-full rounded-md bg-canvas/25 backdrop-blur-[3px] px-1.5 py-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 flex flex-col items-start gap-1"
                  data-toolbar-row
                  data-tools={rolled ? 'out' : 'in'}
                >
                  <button
                    type="button"
                    onClick={() => setRolled(r => !r)}
                    aria-expanded={rolled}
                    aria-controls={`tools-${index + 1}`}
                    title={rolled ? 'Roll the tools back in — Esc' : "Tools — this pane's toolbar, rolled out on a press"}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider transition-colors ${
                      rolled ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'
                    }`}
                    data-tools-door
                  >
                    {rolled ? <ChevronUp className="w-3 h-3" /> : <SlidersHorizontal className="w-3 h-3" />}
                    Tools
                  </button>
                  <AnimatePresence initial={false}>
                    {rolled && (
                      <motion.div
                        key="roll"
                        id={`tools-${index + 1}`}
                        className="min-w-0 overflow-hidden"
                        data-tools-roll
                        /* The height rolls too: the kit's box grew and shrank in one step at the wipe's ends, and
                           the scripts' legend under this chrome — which measures it — jumped with it. */
                        /* Every clip value with its units: framer-motion interpolates a clip-path string only
                           against one of the same shape, and the value it writes back is `inset(0px 0% 0px 0px)` — */
                        initial={{ clipPath: 'inset(0px 0px 100% 0px)', opacity: 0, y: -6, height: 0 }}
                        animate={{ clipPath: 'inset(0px 0px 0% 0px)', opacity: 1, y: 0, height: 'auto' }}
                        exit={{ clipPath: 'inset(0px 0px 100% 0px)', opacity: 0, y: -6, height: 0, transition: { duration: 0.3, ease: [0.45, 0, 0.25, 1] } }}
                        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                      >
                        {paneToolbar(false)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* The crossed symbols, under the floating header One quiet row each: its line's own ink, its live price,
                and the only hand-removal outside the + menu. */}
            {compares.length > 0 && (
              <div
                /* Unconditional, unlike the strip above: the legend rows are ~106px, so even at a 369px column they
                   clear both gutters. */
                style={{ top: stripH + 4 + (expanded ? 44 : 0), left: ownScale ? PRICE_GUTTER_PX : undefined }}
                className="pointer-events-none absolute left-3 z-10 flex flex-col gap-0.5 opacity-70 transition-opacity duration-200 group-hover:opacity-100"
                data-chart-chrome
                data-head-form={inlineFull ? 'full' : inlineCompact ? 'compact' : 'own'}
                data-strip-inner={stripInner}
              >
                {compares.map(c => (
                  <span key={`${c.ticker}:${c.mode}`} className="flex items-center gap-1.5">
                    <span className="w-2 h-[3px] rounded-full" style={{ background: c.ink }} aria-hidden />
                    <span className="font-mono text-t10 font-semibold" style={{ color: c.ink }}>
                      {c.ticker}
                    </span>
                    <HeadPrice ticker={c.ticker} session={session} className="font-mono text-t10 tnum text-textSecondary" />
                    <button
                      onClick={() => removeCompare(c.ticker, c.mode)}
                      aria-label={`Remove the ${c.ticker} comparison`}
                      title="Remove comparison"
                      className="pointer-events-auto inline-flex items-center justify-center w-4 h-4 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Not on a phone. */}
          {ladder && rail.rows.length > 0 && (
            <ProfilePanel
              /* The rest width follows the pane count: 520 alone or expanded, 340 on two or four, 240 three across —
                 the reader's own width once dragged */
              width={cfg.ladderW ?? railRestWidth(paneCount, expanded)}
              restWidth={railRestWidth(paneCount, expanded)}
              onWidth={w => onCfg({ ladderW: w })}
              /* The chart's floor beside the rail: the 2×2's 576px column, except on the three-up desk, where the
                 chart keeps at least half its pane. */
              chartFloor={paneCount === 3 && !expanded ? 'half' : undefined}
              /* The expiry card in the rail's head beside the view tabs — the desk's one cut, so a change here
                 changes every pane */
              headCard={<ExpiryCard label="Expiry" size="sm" value={railCut} choices={railCutChoices()} onChange={onRailCut} title="Which contracts the rails read" testId="terrain-expiry" />}
              ticker={ticker}
              rows={rail.rows}
              maxAbs={rail.maxAbs}
              legs={legs}
              openRatio={openRatio}
              palette={palette}
              step={rail.step}
              levels={levels}
              flow={flow}
              lane={cfg.lane}
              onLane={l => onCfg({ lane: l })}
              greek="GEX"
              onGuide={() => setGuideOpen(v => !v)}
              guideOpen={guideOpen}
              focusPrice={focus}
              projection={projectionRef}
              onClose={() => {
                onCfg({ ladder: false });
                /* A control that removes itself has to say where focus goes. */
                requestAnimationFrame(() => {
                  const undo = document.querySelector<HTMLElement>('[data-strikes-toggle]');
                  // Belt and braces. This × only exists where the rail does, which is `lg` and up, and strikes is
                  // rendered across that whole range — so the query should always find it.
                  if (undo?.isConnected) undo.focus();
                });
              }}
              closeHint="Hide this rail — R"
              onSelect={price => setFocus(cur => (cur != null && Math.abs(cur - price) < 1e-9 ? null : price))}
              className="hidden xl:block"
            />
          )}
        </div>
        {/* The guide in focus — over the whole pane, the pane blurred behind it */}
        {ladder && (
          <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read this panel" testId="profile-guide">
            <ProfileGuide rows={rail.rows} levels={levels} flow={flow} />
          </GuideFocus>
        )}
      </div>
    </div>
  );
};

/** What a door into terrain may carry: the name and the interval the first pane opens on, and a strike it opens
    focused on. Rides the route's state, beside the way back. */
export interface TerrainArrival {
  ticker?: string;
  timeframe?: Timeframe;
  focus?: number;
}

/** Terrain — the charts-only desk. */
const Terrain = () => {
  /* the exposure book and ThetaData's bars both move the panes */
  const revision = useBookRev() + useTapeRev();
  /* The arrival, read once: the first pane takes its name and interval (and keeps them — it is the reader's pane
     now) */
  const location = useLocation();
  const [meterOn] = useState(frameMeterOn);
  const arrive = useRef<TerrainArrival | null>((location.state as { chart?: TerrainArrival } | null)?.chart ?? null).current;

  const [cfg, setCfg] = useState<TerrainCfg>(() => {
    const stored = loadCfg();
    let c = stored;
    if (arrive?.ticker) {
      try {
        const ticker = arrive.ticker.trim().toUpperCase();
        if (ticker) {
        c = { ...stored, panes: stored.panes.map((p, i) => (i === 0 ? { ...p, ticker, timeframe: arrive.timeframe && TF_VALUES.has(arrive.timeframe) && frameServed(arrive.timeframe) ? arrive.timeframe : p.timeframe } : p)) };
        }
      } catch {
        /* A name the feed cannot build — the pane keeps its own */
      }
    }
    /* The candles' one-time flip to the baby-blue tape — pane themes are stored explicitly, so the store-level
       migration alone would leave every existing pane wearing its old metal. Same flag discipline: once. */
    try {
      if (!localStorage.getItem('slayer_terrain_sky1')) {
        localStorage.setItem('slayer_terrain_sky1', '1');
        /* Since the flip lands a pane on the store (whose dark pick that same day became glacier), not on a typed
           'glacier': a typed one would hold a first-time visitor's panes off Stone on the light page for good */
        return { ...c, panes: c.panes.map(p => ({ ...p, theme: undefined })) };
      }
    } catch {
      /* Storage unavailable — panes keep their stored themes */
    }
    return c;
  });

  /* The named-layouts shelf. */
  const [namedLayouts, setNamedLayouts] = useState<Record<string, NamedLayoutEntry<PaneCfg>>>(() =>
    loadNamedLayouts(readPane, defaultPanes()[0], LAYOUTS)
  );
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  const applyNamedLayout = (entry: NamedLayoutEntry<PaneCfg>) => {
    const defs = defaultPanes();
    const panes = defs.map((d, i) => entry.panes[i] ?? d);
    /* Through the dissolve as well — recalling a shelf layout is the biggest reflow the desk does. */
    dissolve(() =>
      setCfg(prev => ({ ...prev, layout: (LAYOUTS as readonly number[]).includes(entry.layout) ? (entry.layout as TerrainLayout) : prev.layout, panes }))
    );
    setLayoutsOpen(false);
  };
  const saveCurrentLayout = () => {
    const next = saveNamedLayout(namedLayouts, layoutName, cfg.layout, cfg.panes, Date.now());
    if (next === null) {
      setLayoutNote(layoutName.trim() ? `the shelf holds ${MAX_NAMED_LAYOUTS} — delete one first` : 'give it a name');
      return;
    }
    setNamedLayouts(next);
    persistNamedLayouts(next);
    setLayoutName('');
    setLayoutNote(null);
  };
  const removeNamedLayout = (name: string) => {
    const next = deleteNamedLayout(namedLayouts, name);
    setNamedLayouts(next);
    persistNamedLayouts(next);
  };
  useEffect(() => {
    try {
      localStorage.setItem(TERRAIN_KEY, JSON.stringify(cfg));
    } catch {
      /* Storage can be full, private, or switched off — never fatal */
    }
  }, [cfg]);

  /* The key handler is installed once, so it reaches the reducer through a ref rather than closing over the first
     render's copy of it. */
  const setPaneRef = useRef<(i: number, patch: Partial<PaneCfg>) => void>(() => {});

  /* Every pane mutation funnels here, which is why both halves of the symbol memory live here and nowhere else. */
  const setPane = (i: number, patch: Partial<PaneCfg>) =>
    setCfg(prev => {
      const cur = prev.panes[i];
      if (!cur) return prev;
      const now = Date.now();
      const put = (p: PaneCfg, setups: SetupMap) => ({
        ...prev,
        setups,
        panes: prev.panes.map((q, j) => (j === i ? p : q)),
      });

      // A symbol change — restore, and never capture the symbol on its way out
      if (patch.ticker && symKey(patch.ticker) !== symKey(cur.ticker)) {
        const key = symKey(patch.ticker);
        const saved = prev.setups[key];
        /* With nothing saved, applySetup reduces to `cur` — a symbol nobody has configured inherits the pane exactly
           as it stands, which is the behaviour that was here before any of this. */
        const setups = saved ? { ...prev.setups, [key]: { ...saved, seen: now } } : prev.setups;
        /* Linked panes follow the symbol. */
        const group = cur.link ?? null;
        const panes = prev.panes.map((q, j) => {
          const inGroup = j === i || (group !== null && q.link === group);
          if (!inGroup) return q;
          const base = j === i ? cur : q;
          const applied = { ...applySetup(base, saved), compares: saved?.compares ?? [] };
          return j === i ? { ...applied, ...patch } : { ...applied, ticker: patch.ticker! };
        });
        return { ...prev, setups, panes };
      }

      // A control touch — this is what earns the symbol its entry
      const next = { ...cur, ...patch };
      // A rail-only patch is slot business and writes nothing to the symbol.
      if (!SETUP_KEYS.some(k => k in patch)) return put(next, prev.setups);
      return put(next, evict({ ...prev.setups, [symKey(cur.ticker)]: captureSetup(next, now) }));
    });
  setPaneRef.current = setPane;

  const [expanded, setExpanded] = useState<number | null>(null);
  /* The floating desk bar's height while a pane is expanded — the pane reserves it at its foot */
  const [deskBarH, setDeskBarH] = useState(0);
  const barFloats = expanded !== null;
  const deskBarObs = useRef<ResizeObserver | null>(null);
  const deskBarRef = useCallback((el: HTMLDivElement | null) => {
    deskBarObs.current?.disconnect();
    deskBarObs.current = null;
    if (!el || !barFloats) {
      setDeskBarH(0);
      return;
    }
    const read = () => setDeskBarH(Math.ceil(el.getBoundingClientRect().height));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    deskBarObs.current = ro;
  }, [barFloats]);
  const expandedRef = useRef<number | null>(null);
  expandedRef.current = expanded;
  /* The takeover leaves on a fade instead of vanishing — the same hook the Pulse fullscreen uses, so the two desks
     feel like one product. */
  const { closing: expClosing, close: closeExpanded } = useFadeClose(() => setExpanded(null));
  const closeExpandedRef = useRef(closeExpanded);
  closeExpandedRef.current = closeExpanded;
  /* Expand is instant, collapse fades. */
  const toggleExpand = useCallback((i: number) => {
    if (expandedRef.current === i) closeExpandedRef.current();
    else setExpanded(i);
  }, []);
  const toggleExpandRef = useRef(toggleExpand);
  toggleExpandRef.current = toggleExpand;

  /* The pane-count swap dissolves. */
  const [swapping, setSwapping] = useState(false);
  const dissolve = useCallback((apply: () => void) => {
    setSwapping(true);
    window.setTimeout(() => {
      apply();
      setSwapping(false);
    }, 130);
  }, []);
  const changeLayout = useCallback(
    (n: TerrainLayout) => {
      if (cfgRef.current.layout === n) return; // a no-op should not blink
      dissolve(() => setCfg(prev => ({ ...prev, layout: n })));
    },
    [dissolve]
  );
  const changeLayoutRef = useRef(changeLayout);
  changeLayoutRef.current = changeLayout;

  /* AN expanded pane cannot outlive the pane it points at. `expanded` is an index, and the number of panes is a
     separate piece of state that the layout buttons and the 1-4 keys both change without consulting it. */
  useEffect(() => {
    setExpanded(cur => (cur !== null && cur >= cfg.layout ? null : cur));
  }, [cfg.layout]);

  useEffect(() => {
    if (expanded === null) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal over the takeover took the key already (Modal marks it)
      if (e.key === 'Escape' && !e.defaultPrevented) closeExpandedRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [expanded]);

  /* A phone gets one chart, and it is the same rule Pulse uses — `useIsPhone`, not a second breakpoint.
     `PHONE_QUERY` already carries the landscape clause `(pointer: coarse) and (max-height: 540px)`, which was */
  const isPhone = useIsPhone();

  /* And the rails are not on screen below `lg`. */
  const belowLg = useIsBelowXl();
  /* A tall screen is told: on a portrait monitor the desk stacks, and one quiet line says it is on purpose rather
     than a page that failed to fit */
  const portraitDesk = useIsPortraitDesk();
  /* The key handler is installed once and must never read a stale closure — the same mirror the config and the
     expanded pane already keep. */
  const belowLgRef = useRef(false);
  belowLgRef.current = belowLg;

  const panes = cfg.panes.slice(0, cfg.layout);
  const anyLadder = panes.some(p => p.ladder);
  /* The page's theme, as the rails read it: the rails wear the page's theme, not their tapes' */
  const pageLight = chartGround(usePageDefaultCandleKey()) === 'light';

  /* Which pane a key acts on. Stored unclamped and clamped on read, the same way the pane configs are: going 4 → 2 →
     4 gives the fourth pane back rather than having silently forgotten it. */
  const [activeRaw, setActiveRaw] = useState(0);
  const activeRaw0 = useRef(0);
  activeRaw0.current = activeRaw;
  const active = Math.min(activeRaw, cfg.layout - 1);
  /* The strip's tabs — the active pane's */
  const stripPane = cfg.panes[active] ?? cfg.panes[0];
  const stripTabs = stripPane.tabs.length ? stripPane.tabs : [stripPane.ticker];
  /* Mirrors for the key handler, which is installed once and must never read a stale closure — the same pattern the
     charts use for their own subscriptions. */
  const activeRef = useRef(0);
  activeRef.current = active;
  /* Assigned during render, not in an effect: two keys inside one frame must both see the config the first one
     produced. */
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  /* Which panes are replaying. Four flags rather than one index: nothing stops a reader replaying two panes side by
     side, and that is arguably the point of a four-pane desk. */
  const [replaying, setReplaying] = useState<boolean[]>(() => [false, false, false, false]);
  const replayingRef = useRef<boolean[]>(replaying);
  replayingRef.current = replaying;
  const setPaneReplay = (i: number, on: boolean) =>
    setReplaying(prev => (prev[i] === on ? prev : prev.map((v, j) => (j === i ? on : v))));

  /* Draw mode, the same shape and here for the same reasons — see PaneProps. */
  const [drawingPanes, setDrawingPanes] = useState<boolean[]>(() => [false, false, false, false]);
  const drawingRef = useRef<boolean[]>(drawingPanes);
  drawingRef.current = drawingPanes;
  const setPaneDrawing = (i: number, on: boolean) =>
    setDrawingPanes(prev => (prev[i] === on ? prev : prev.map((v, j) => (j === i ? on : v))));

  /** Which pane has a menu open, and which menu — so `s` and `c` can open one without every pane growing its own
      piece of state. */
  const [menu, setMenu] = useState<{ pane: number; which: 'symbol' | 'compare' | 'tabs' } | null>(null);
  /* The key handler has to know a menu is up. */
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu !== null;

  /* Who owns ↑ and ↓ — and it is not always this desk. Every other Terrain key is an unmodified letter or digit,
     which the browser does nothing with. */
  const deskOwnsViewportRef = useRef(false);
  deskOwnsViewportRef.current = isPhone || !belowLg;

  /* A ring is feedback for people who can see it. Everything a key changes is also said out loud, or the whole layer
     is silent to a screen reader. */
  const [announce, setAnnounce] = useState('');
  const paneRefs = useRef<(HTMLDivElement | null)[]>([]);

  /* The keys. Installed once, for the page's life: every mutation goes through a functional updater so the deps stay
     empty and `revision` — which bumps ten times a minute — cannot tear the listener down and rebuild it. */
  useEffect(() => {
    const editable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.repeat) return;
      if (editable(e.target) || editable(document.activeElement)) return;
      const i = activeRef.current;
      /* Read the config, compute the delta, then set — rather than doing any of it inside the updater. An updater
         that also calls setState is not pure, and React is free to run it more than once. */
      const cur = cfgRef.current;
      /* Through setPane, not straight to setCfg. */
      const patch = (fn: (q: PaneCfg) => Partial<PaneCfg>, say: (q: PaneCfg) => string) => {
        const q = cur.panes[i];
        if (!q) return;
        const delta = fn(q);
        setPaneRef.current(i, delta);
        setAnnounce(say({ ...q, ...delta }));
      };

      switch (e.key) {
        case '1': case '2': case '3': case '4': {
          e.preventDefault();
          const n = Number(e.key) as TerrainLayout;
          changeLayoutRef.current(n);
          setAnnounce(n === 1 ? 'One chart' : `${n} charts`);
          return;
        }
        case '[': case ']': {
          e.preventDefault();
          const n = cur.layout;
          const next = ((Math.min(activeRaw0.current, n - 1) + (e.key === ']' ? 1 : -1)) + n) % n;
          setActiveRaw(next);
          /* Below `lg` the panes stack and the page scrolls, so the newly active one can be off screen entirely. */
          paneRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          setAnnounce(`Chart ${next + 1} of ${n}, ${cur.panes[next]?.ticker ?? ''}`);
          return;
        }
        case '-': case '=':
          e.preventDefault();
          patch(q => ({ timeframe: stepTf(q.timeframe, e.key === '=' ? 1 : -1) }), q => `${q.ticker} ${q.timeframe}`);
          return;
        /* The watchlist flip — the active pane's symbol, without the picker. */
        case 'ArrowUp': case 'ArrowDown': {
          if (!deskOwnsViewportRef.current && expandedRef.current === null) return;
          if (menuOpenRef.current) return;
          const q = cur.panes[i];
          if (!q) return;
          e.preventDefault();
          const ring = flipRing(OPEN_NAMES, Object.keys(cur.setups));
          const next = stepSymbol(ring, q.ticker, e.key === 'ArrowDown' ? 1 : -1);
          const at = ring.indexOf(next);
          /* A one-name ring steps onto itself. Announce it — silence on a keypress reads as a broken key — but do
             not push a patch that the reducer would turn into a no-op write of the whole config. */
          if (next !== symKey(q.ticker)) setPaneRef.current(i, { ticker: next, tabs: tabsAfter(q.tabs, q.ticker, next) });
          setAnnounce(at >= 0 ? `${next}, ${at + 1} of ${ring.length}` : next);
          return;
        }
        /* Both rail keys are unbound below `lg`: the rail is `hidden xl:block` there, so a press could only rewrite
           storage for a rail nobody sees. */
        case 'r':
          if (belowLgRef.current) return;
          e.preventDefault();
          patch(q => ({ ladder: !q.ladder }), q => `${q.ticker} strike rail ${q.ladder ? 'shown' : 'hidden'}`);
          return;
        case 'R': {
          if (belowLgRef.current) return;
          e.preventDefault();
          const any = cur.panes.slice(0, cur.layout).some(q => q.ladder);
          setCfg(prev => ({ ...prev, panes: prev.panes.map(q => ({ ...q, ladder: !any })) }));
          setAnnounce(any ? 'Every strike rail hidden' : 'Strike rail on every chart');
          return;
        }
        /* Replay. Acts on the active pane, like every other pane key. The chart owns the transport once it is up;
           this is the door. */
        case 'p': {
          e.preventDefault();
          const on = !(replayingRef.current[i] ?? false);
          setPaneReplay(i, on);
          setAnnounce(`${cur.panes[i]?.ticker ?? ''} replay ${on ? 'on' : 'off'}`);
          return;
        }
        /* Draw mode — the pencil's key, so the strip can shed the pencil at widths that cannot pay for it and the
           layer stays reachable. */
        case 'd': {
          e.preventDefault();
          const on = !(drawingRef.current[i] ?? false);
          setPaneDrawing(i, on);
          setAnnounce(`${cur.panes[i]?.ticker ?? ''} draw mode ${on ? 'on' : 'off'}`);
          return;
        }
        case 'f':
          e.preventDefault();
          toggleExpandRef.current(i);
          setAnnounce(`${cur.panes[i]?.ticker ?? ''} ${expandedRef.current === i ? 'collapsed' : 'expanded'}`);
          return;
        case 's':
          e.preventDefault();
          setMenu({ pane: i, which: 'symbol' });
          return;
        case 'c':
          e.preventDefault();
          setMenu({ pane: i, which: 'compare' });
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Crosshair sync — one pane's hover, marking the same moment on the others. Imperative, and that is the design
     rather than a shortcut. */
  const sinks = useRef(new Map<number, CrosshairSync>()).current;
  const sourcePane = useRef<number | null>(null);

  /* StrikeChart holds syncRegister and onCrosshair through refs, so their identity changing between renders costs
     nothing. */
  const registerSync = (i: number, apply: CrosshairSync | null) => {
    if (apply) sinks.set(i, apply);
    else sinks.delete(i);
  };

  /* Whose moment may travel: a replaying pane's moment is historical. */
  const emitCrosshair = (i: number, time: Parameters<CrosshairSync>[0]) => {
    /* A leave from a pane that is not the current source is stale. */
    if (time === null && sourcePane.current !== i) return;
    sourcePane.current = time === null ? null : i;
    const rep = replayingRef.current;
    const panesNow = cfgRef.current.panes;
    for (const [j, apply] of sinks) {
      if (j === i) continue;
      const sameMode = (rep[j] ?? false) === (rep[i] ?? false);
      /* The interval clause applies only in replay — see the note above. */
      const ok = rep[i] ? sameMode && panesNow[j]?.timeframe === panesNow[i]?.timeframe : sameMode;
      if (ok) apply(time);
      /* A pane that is NOT going to be marked has its old mark cleared, or a stale crosshair sits on it for as long
         as the reader hovers elsewhere. */
      else apply(null);
    }
  };

  /* Nothing carries across a change of arrangement: a pane that has gone leaves no mark behind it, and the
     fullscreen takeover has nothing to sync with. */
  useEffect(() => {
    for (const apply of sinks.values()) apply(null);
    sourcePane.current = null;
  }, [cfg.layout, expanded, sinks]);

  return (
    /* Full bleed, and only from `lg`. */
    <div
      /* Full bleed, from `lg` — and on a phone, which is the addition. */
      /* The whole window from `lg`: the height used to subtract the 56px top bar, which the frame lost on — so 56px
         sat empty under the desk. Measured before: the root 904 tall in a 960 window, the panes ending at 861. */
      className={`relative -mx-4 xl:-mx-6 2xl:-mx-8 px-1.5 flex flex-col ${
        isPhone
          ? '-mt-5 -mb-16 py-1.5 h-[calc(100dvh-3rem)] min-h-0'
          : 'xl:-mt-5 xl:-mb-16 xl:pt-1.5 xl:pb-0 xl:h-screen xl:min-h-0'
      }`}
    >
      {/* The tab strip: the active pane's names across the top of the desk, the pane's number at its edge on a split
          desk; not while a pane is expanded — the takeover owns the screen and its own chip still picks */}
      {expanded === null && belowLg && portraitDesk && !isPhone && (
        <p className="px-3 py-1 text-t11 text-textMuted" data-portrait-note>
          Built for a wide screen — on a tall one the panes stack, each at its full width.
        </p>
      )}
      {expanded === null && (
        <TickerTabStrip
          tabs={stripTabs}
          active={stripPane.ticker}
          paneLabel={cfg.layout > 1 && !isPhone ? String(active + 1) : undefined}
          compact={isPhone}
          onPick={t => setPane(active, { ticker: t })}
          onClose={t => {
            const rest = stripTabs.filter(x => x !== t);
            if (!rest.length) return;
            setPane(active, t === stripPane.ticker ? { ticker: rest[Math.max(0, Math.min(rest.length - 1, stripTabs.indexOf(t)))], tabs: rest } : { tabs: rest });
          }}
          onAdd={t => {
            if (stripTabs.includes(t)) {
              setPane(active, { ticker: t });
              return;
            }
            if (stripTabs.length >= TAB_MAX) return;
            setPane(active, { ticker: t, tabs: [...stripTabs, t] });
          }}
        />
      )}
      {/* The arrangement controls, floating over the top-right of the grid. There is no page title and no caption any
          more. */}
      {!isPhone && (
      <div
        /* Bottom right, not top right. */
        /* Cleared past the rail of the pane that is actually under it. */
        /* `&& !belowLg` because the rail is hidden by breakpoint and kept in config: below `lg` the flag reads true
           against a `display: none` element, and the 132px it buys is clearance from nothing. */
        style={
          expanded !== null
            ? {
                right: (panes[expanded]?.ladder && !belowLg ? panes[expanded]?.ladderW ?? railRestWidth(cfg.layout, true) : 0) + PRICE_GUTTER_PX + 8,
                bottom: deskBarH > 0 ? DESK_BAR_GAP_PX : TIME_AXIS_PX + 12,
                /* held inside the screen: a bar wider than the room wraps onto a second line (the pane reserves its
                   height) instead of running off the left edge with the layout buttons on it */
                left: DESK_BAR_GAP_PX,
              }
            : undefined
        }
        /* They come and go with the pane chrome: as solid white controls they were the loudest thing on a desk that
           had been asked to be quiet. */
        /* Above the expanded pane, and fixed while it is up. The expanded pane is `fixed inset-0 z-[80]`, and this
           bar was `absolute z-30` — under it. */
        /* The desk bar, docked: A row under the grid. */
        className={
          expanded !== null
            ? 'chrome-hover pointer-events-none flex flex-wrap items-center justify-end gap-2 opacity-40 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 fixed z-[90]'
            : 'order-last shrink-0 mt-1 flex items-center justify-end gap-2'
        }
        data-terrain-desk-bar={expanded !== null ? 'floating' : 'docked'}
        ref={deskBarRef}
        /* Floating over the expanded pane, it is chrome over that tape and wears its ground like the strip does
           (index.css) — dark words on Stone */
        data-chart-chrome={expanded !== null ? '' : undefined}
        data-chart-ground={expanded !== null ? chartGround(panes[expanded]?.theme ?? pageDefaultCandleKey()) : undefined}
      >
        <div
          role="group"
          aria-label="How many charts"
          className="pointer-events-auto inline-flex flex-wrap items-center gap-0.5 border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] rounded-md p-0.5"
        >
          <Rows3 className="w-3.5 h-3.5 mx-1.5 text-textMuted shrink-0" aria-hidden />
          {LAYOUTS.map(n => {
            const active = n === cfg.layout;
            return (
              <button
                key={n}
                onClick={() => changeLayout(n)}
                aria-pressed={active}
                aria-label={`${n} ${n === 1 ? 'chart' : 'charts'}`}
                title={`${n} ${n === 1 ? 'chart' : 'charts'} — press ${n}`}
                className={`px-2.5 py-1 rounded font-mono text-t11 font-semibold tnum transition-colors ${
                  active ? 'bg-ink/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* Every pane at once — a convenience over the per-pane ×, not the only way out of the rail. */}
        {!belowLg && (
        <button
          /* Named so a control that removes itself can hand focus here — see the rail's × below. */
          data-strikes-toggle=""
          onClick={() => setCfg(prev => ({ ...prev, panes: prev.panes.map(p => ({ ...p, ladder: !anyLadder })) }))}
          aria-pressed={anyLadder}
          title={anyLadder ? 'Hide every strike rail — Shift R' : 'Show the strike rail beside every chart — Shift R'}
          className={`pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-ink/[0.08] backdrop-blur-[3px] font-mono text-t10 uppercase tracking-wider transition-colors ${
            anyLadder ? 'bg-ink/[0.16] text-textPrimary' : 'bg-canvas/40 text-textSecondary hover:text-textPrimary'
          }`}
        >
          Strikes
        </button>
        )}

        {/* The rails' colours, one card for the desk — here rather than in each rail's head, which is 132px on a
            three-up desk and cannot hold it; hidden with the rails, like the button beside it */}
        {/* …and not on the light page: on paper the rails walk one tint-to-pole journey whatever the palette, so the
            card would change nothing the eye can use */}
        {!belowLg && anyLadder && !pageLight && (
          <span className="pointer-events-auto inline-flex" data-terrain-colours>
            {/* The Expiry cut lives in each rail's head beside the view tabs — one desk-wide choice, changed from any
                pane */}
            <DropdownSelect label="Colours" value={cfg.palette} options={PALETTE_OPTIONS} onChange={p => setCfg(prev => ({ ...prev, palette: p }))} title="What the rails' colours mean" testId="terrain-colours" />
          </span>
        )}

        {/* The desk-wide ruler, in the desk's own cluster — the same four chips the flip strip carries on Pinpoint,
            one store behind both. */}
        <span className="pointer-events-auto inline-flex rounded-md border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] px-1 py-0.5">
          <SessionBook />
        </span>
        <span className="pointer-events-auto inline-flex rounded-md border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] px-1 py-0.5">
          <DistanceUnitPicker dense />
        </span>

        {/* The named-layouts shelf, in the desk's own cluster. */}
        <span className="relative pointer-events-auto">
          <button
            onClick={() => setLayoutsOpen(o => !o)}
            aria-haspopup="dialog"
            aria-expanded={layoutsOpen}
            title="Named layouts — save this arrangement, recall another"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-ink/[0.08] backdrop-blur-[3px] font-mono text-t10 uppercase tracking-wider transition-colors ${
              layoutsOpen ? 'bg-ink/[0.16] text-textPrimary' : 'bg-canvas/40 text-textSecondary hover:text-textPrimary'
            }`}
          >
            <Rows3 className="w-3 h-3" /> Layouts
          </button>
          {layoutsOpen && (
            <>
              <span className="fixed inset-0 z-30" onClick={() => setLayoutsOpen(false)} aria-hidden />
              <div
                role="dialog"
                aria-label="Named layouts"
                onKeyDown={e => {
                  /* Escape closes the shelf from anywhere inside it — a panel with a click-away backdrop and no key
                     out is a trap for keyboard readers (and the probe that found this). */
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setLayoutsOpen(false);
                  }
                }}
                className="absolute bottom-full right-0 mb-2 z-40 w-64 border border-borderMuted bg-panel/95 rounded-md p-2 shadow-xl shadow-black/50"
              >
                <div className="font-mono text-t9 uppercase tracking-widest text-textMuted px-1 pb-1.5">
                  Named layouts · {Object.keys(namedLayouts).length}/{MAX_NAMED_LAYOUTS}
                </div>
                {Object.entries(namedLayouts)
                  .sort((a, b) => b[1].savedAt - a[1].savedAt)
                  .map(([name, entry]) => (
                    <div key={name} className="flex items-center gap-1 group">
                      <button
                        onClick={() => applyNamedLayout(entry)}
                        title={`${entry.layout} pane${entry.layout === 1 ? '' : 's'} · ${entry.panes.slice(0, entry.layout).map(pn => pn.ticker).join(' ')}`}
                        className="flex-1 min-w-0 text-left px-1.5 py-1 rounded font-mono text-t11 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05] truncate transition-colors"
                      >
                        {name}
                        <span className="ml-1.5 text-t9 text-textMuted tnum">
                          {entry.layout}× {entry.panes.slice(0, entry.layout).map(pn => pn.ticker).join('·')}
                        </span>
                      </button>
                      <button
                        onClick={() => removeNamedLayout(name)}
                        aria-label={`Delete the layout ${name}`}
                        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted opacity-0 group-hover:opacity-100 hover:text-textPrimary hover:bg-ink/[0.08] transition-all"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                {Object.keys(namedLayouts).length === 0 && (
                  <div className="px-1.5 py-1 font-mono text-t10 text-textMuted">Nothing saved yet — name this desk below.</div>
                )}
                <div className="mt-1.5 pt-1.5 border-t border-borderSubtle/60 flex items-center gap-1">
                  <input
                    value={layoutName}
                    onChange={e => { setLayoutName(e.target.value); setLayoutNote(null); }}
                    onKeyDown={e => { if (e.key === 'Escape') { setLayoutsOpen(false); return; } e.stopPropagation(); if (e.key === 'Enter') saveCurrentLayout(); }}
                    placeholder="name this arrangement"
                    aria-label="Layout name"
                    className="flex-1 min-w-0 px-1.5 py-1 rounded border border-borderSubtle bg-inset font-mono text-t11 text-textPrimary placeholder:text-textMuted outline-none focus:border-borderMuted"
                  />
                  <button
                    onClick={saveCurrentLayout}
                    className="shrink-0 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider text-select hover:bg-select/10 transition-colors"
                  >
                    Save
                  </button>
                </div>
                {layoutNote && <div className="px-1.5 pt-1 font-mono text-t9 text-textMuted">{layoutNote}</div>}
              </div>
            </>
          )}
        </span>

        {/* The pine door, fullscreen only: the editor docks at the right of the expanded pane (data/editorDock.ts —
            the pane narrows by --editor-w), a blank script for this pane. */}
        {expanded !== null && (
          <button
            onClick={() => openEditor(null, `terrain:${expanded + 1}`)}
            title="Write a Pine script for this chart — the editor opens beside it"
            className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors"
            data-terrain-pine
          >
            <Code2 className="w-3 h-3" /> Pine
          </button>
        )}

        {/* The first piece: where in the Globex (futures) week the wall clock sits — a read-out, not a control, so it
            names itself ("Futures · daily break", not a bare MAINTENANCE that read as a button) and wears no button edge. */}
        {(() => {
          const phase = futuresPhaseAt(new Date());
          const words = FUTURES_PHASE_WORDS[phase];
          const short = FUTURES_PHASE_SHORT[phase];
          return (
            <span
              title={`Futures session (Globex): ${words.blurb}. A clock read-out — Terrain charts the cash market; futures are not on the desk.`}
              className={`pointer-events-auto cursor-help inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-canvas/40 backdrop-blur-[3px] font-mono text-t10 uppercase tracking-wider ${
                phase === 'RTH' ? 'text-textPrimary' : 'text-textSecondary'
              }`}
              aria-label={`Futures session: ${short}`}
              data-terrain-futures-phase={phase}
            >
              <span className="text-textMuted">Futures</span>
              {short}
            </span>
          );
        })()}

        {expanded !== null && (
          <button
            onClick={() => closeExpanded()}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-borderSubtle bg-canvas/70 backdrop-blur-[2px] font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary"
          >
            <X className="w-3.5 h-3.5" /> Esc
          </button>
        )}
      </div>
      )}

      {/* The ring and the badge are feedback for people who can see them. A key that rearranges the desk has to say
          so as well, or the whole layer is silent to a screen reader. */}
      <span className="sr-only" aria-live="polite">{announce}</span>

      {/* The charts are the page, so the grid takes every pixel the root has left rather than a fraction of the
          viewport. */}
      <div
        /* The stacked-phone minimum lives on the pane, not here — see the note on Pane's own wrapper for why a rule
           here does nothing. */
        className={`grid ${isPhone ? COLS[1] : COLS[cfg.layout]} ${
          isPhone ? ROWS[1] : ROWS[cfg.layout]
        } gap-1.5 flex-1 min-h-0 transition-opacity duration-200 ease-out ${swapping ? 'opacity-0' : ''}`}
      >
        {panes.map((pane, i) =>
          /* A real branch, not `hidden`. */
          isPhone && i !== active ? null : (
          <PaneBoundary key={i} name={pane.ticker} resetKey={`${pane.ticker}|${pane.timeframe}`} cell={cfg.layout === 3 && i === 2 ? 'xl:col-span-2 2xl:col-span-1' : ''}>
          <Pane
            arriveFocus={i === 0 ? arrive?.focus ?? null : null}
            cfg={pane}
            onCfg={patch => setPane(i, patch)}
            revision={revision}
            expanded={expanded === i}
            onToggleExpand={() => toggleExpand(i)}
            closing={expClosing}
            index={i}
            tall={cfg.layout === 1}
            onCrosshair={t => emitCrosshair(i, t)}
            registerSync={apply => registerSync(i, apply)}
            replay={replaying[i] ?? false}
            onToggleReplay={() => setPaneReplay(i, !(replaying[i] ?? false))}
            /* The chart calls this itself on a ticker or timeframe change — a replay was recorded in another world
               and cannot survive one. */
            onExitReplay={() => setPaneReplay(i, false)}
            drawing={drawingPanes[i] ?? false}
            onToggleDrawing={() => setPaneDrawing(i, !(drawingPanes[i] ?? false))}
            onExitDraw={() => setPaneDrawing(i, false)}
            isActive={i === active}
            onActivate={() => setActiveRaw(i)}
            paneCount={cfg.layout}
            palette={cfg.palette}
            railCut={cfg.railCut}
            onRailCut={c => setCfg(prev => ({ ...prev, railCut: c }))}
            menuOpen={menu?.pane === i ? menu.which : null}
            onMenu={which => setMenu(which ? { pane: i, which } : null)}
            boxRef={el => { paneRefs.current[i] = el; }}
            /* The odd pane out takes the whole row. Three panes in two columns leaves the second row half empty — at
               1440, the most ordinary laptop width there is, that is a quarter of the desk showing nothing. */
            cell={cfg.layout === 3 && i === 2 ? 'xl:col-span-2 2xl:col-span-1' : ''}
            footRoom={expanded === i && !isPhone ? deskBarH : 0}
          />
          </PaneBoundary>
          )
        )}
      </div>
      {meterOn && <FrameMeter />}
    </div>
  );
};

export default Terrain;
