import {
  memo, useCallback, useEffect, useMemo, useRef, useReducer, useState,
  useSyncExternalStore,
  type MutableRefObject, type PointerEvent as ReactPointerEvent, useLayoutEffect,
  type ReactNode,
} from 'react';
import { Eraser, MousePointer2, Trash2 } from 'lucide-react';
import {
  createChart,
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type SeriesType,
  type UTCTimestamp,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { chainForDate, deskTape, ensureBook, peekDaySigma, peekEntry, peekIv, snapshotFor, useBookMinutes, useBookRev } from '../../data/uwBook';
import { ensureFieldCloses, exposureGrid, gridColumns, useExposureLogRev } from '../../data/book/exposureLog';
import { useFieldMode } from '../../data/fieldMode';
import { useSessionQuote } from '../../data/sessionQuote';
import { getDeskSession, minuteInSession, sessionMeta, sessionOfMinute, useDeskSession, type DeskSession } from '../../data/deskSession';
import { snapsAsOf } from '../../data/exposureScope';
import { onGlide, promisedWidth } from '../../core/glide';
import { compile, explain, run as runScript, type Compiled } from '../../core/pine';
import { setPaneBars, usePaneScripts } from '../../data/paneScripts';
import { drawRun, type ScriptHandle } from './scriptLayer';
import ScriptLegend from './ScriptLegend';
import ResetViewControl from './ResetViewControl';
import { LOCAL_TIME, NY_TIME, localTickMarks, nyTickMarks } from './chartTime';
import {
  aggregateCandles,
  aggregateSnapshots,
  snapshotsMaxAbs,
  tfMinutes,
  type Timeframe,
} from '../../data/timeframe';
import { BEAD_INK_CSS, GexTrailsPrimitive, type BeadHit } from './gexNodesPrimitive';
import { ExpectedMovePrimitive, type ConeHit } from './expectedMovePrimitive';
import { coneTerm, ensureCone } from '../../data/coneFeed';
import { coneMarks, forwardCone, runwaySlots, todayOpenOf, tradingMinutesPerBar } from '../../data/terrainCone';
import { EXTRA_INK, coneRungs } from './levelExtras';
import { KeyLevelsPrimitive, KEY_LEVEL_KEYS, KEY_LEVEL_WORDS, type KeyLevelKey, type KeyLevelRung } from './keyLevelsPrimitive';
import { LADDER_HIT_W, nearRule } from './ladderPaint';
import PointerCard, { CardRow, PointerFollowCard, letGoWords } from '../ui/PointerCard';
import { CellView, makeCell } from './hoverCell';
import { nyClock, nyMinutes } from '../../core/nyTime';
import { beepAlert } from '../../data/alertSound';
import { oiDoubled } from '../../data/oiWatch';
import { chartGrain, thetaChartBars, thetaChartNote, wantChartTape } from '../../data/thetaCandles';
import { usePrintRev } from '../../data/thetaTape';
import { nodeScore } from '../../data/nodeScore';
import { fmtStrike } from '../../data/ahead';
import PaneFoot from './PaneFoot';
import ReplayStrip from './ReplayStrip';
import { commitArm, evaluateAlert, markFired, useAlerts, type AlertContext, type IndicatorSource } from './alertStore';
import { newsPulse } from '../../data/news';
import { exposureNowFor, fmtGexUsd as fmtUsd } from '../../data/gex';
import { ChevronsLeft, ChevronsUp, GripVertical, Lock, PanelLeft, PanelTop, Pencil, Type, Unlock } from 'lucide-react';
import { DrawingsPrimitive, REST_INK_DARK, REST_INK_LIGHT, gestureOf, isFreehand, isWordsKind, loadDrawings, needsThirdAnchor, popDrawings, saveDrawings, usesPts, type Drawing, type DrawingKind } from './drawingsPrimitive';
import DrawRailTools, { DrawSheet, RAIL_ARROW_PAD } from './DrawRailTools';
import { drawToolLabel, registerDrawChart, rememberDrawTool, touchDrawChart } from './drawTools';
import {
  CANDLE_THEMES,
  chartGround,
  useCandleThemeKey,
  candleSeriesOptions,
  chartSurface,
  type CandleTheme,
  type CandleThemeKey,
} from './candleTheme';
import { useResolvedTheme, readToken } from '../../theme/theme';
import { barClockSpec, type AltBarSpec } from '../../data/altBars';
import type { Candle, GexSnapshot } from '../../types/market';
import type { DarkPoolPrint, KeyLevels } from '../../types/gex';
import { bucketFlow, flowMaxLeg } from '../../data/flowBars';
import { atrBarSeries, alignGamma, alignPremium, alignSides, bollingerSeries, emaSeries, flowVwapSeries, gammaEmaSeries, gammaVwapSeries, macdSeries, rsiSeries, smaSeries, vwapSeries, vwapSigmaSeries } from '../../data/indicators';
import { buildSessionLevels, type OpeningRange } from '../../data/sessionLevels';
import { SessionLevelsPrimitive, sessionLines } from './sessionLevelsPrimitive';
import { daySigmaOfIv } from '../../data/expectedMove';
import { buildTapeEvents, macroWindow, type MarketEvent, type MacroDate } from '../../data/events';
import { sessionAtr } from '../../data/atr';
import { thetaUseHere } from '../../data/theta';
import { type EarningsEvent } from '../../data/earnings';
import { ensureEarnings, peekEarningsEvent } from '../../data/earningsFeed';
import { EventsPrimitive } from './eventsPrimitive';
import { cumulativeDrift, driftPeak } from '../../data/driftSeries';
import { impliedVolLine, realizedVol, volCeiling } from '../../data/volDrift';
import type { FlowPrint } from '../../types/trace';

/* The shape this chart needs off a print: whatever FlowPrint is, plus the instant it arrived. Declared here rather
   than imported from the provider so a chart never depends on a React context it does not use. */
type StampedFlowPrint = FlowPrint & { at: number };

/* The band's share of the chart, as a stretch factor against the price pane's. */
const FLOW_STRETCH = 1;
const PRICE_STRETCH = 3;

/* A comparison in pane mode goes below the flow band when there is one. It was hard-coded to index 1. */

/* The flow legs do not take the candle theme's volume ink, and that was the first thing I tried. */
const FLOW_CALL_INK = '#30D158';
const FLOW_PUT_INK = '#FF3B30';

/* The drift lines wear the same two inks as the flow legs, and they should: they are the same two quantities. The
   band draws call and put premium per bar; the drift lines draw the running totals of exactly those bars. */
const DRIFT_CALL_INK = BULL;
const DRIFT_PUT_INK = PUT_WALL;

/* The two volatility lines add no new hue. */
const RV_INK = '#BBB2E8';
const IV_INK = '#EDE4CD';

const PANE_LABEL_LOOK: Record<string, string> = {
  flow: 'Flow',
  netDrift: 'Net drift',
  volDrift: 'Vol drift',
};

/* The drawing tools themselves — their families, names and glyphs — are drawTools.tsx; the rail's buttons are
   DrawRailTools.tsx. */

/** What the user chose to draw — every overlay is independent. */
export interface ChartOverlays {
  trails: boolean;
  levels: boolean;
  darkpool: boolean;
  volume: boolean;
  /** Trace's option prints, bucketed to these bars — calls up, puts down. */
  flow: boolean;
  /** Running call/put premium totals for the session — the flow band summed. */
  netDrift: boolean;
  /** Realised vol measured off these bars against the feed's implied. */
  volDrift: boolean;
  /* Exposure by strike, docked under the chart rather than drawn inside it. */
  dexStrike: boolean;
  /* The session's reference prices. Prior day high/low/close, the opening range and the initial balance, as
     horizontal rules with distinct dashes and their shorthand ON the field rather than on the price axis. */
  session: boolean;
  /* The expected-move cone. */
  cone: boolean;
  /* Event markers. The calendar on the tape: this name's next report, fomc/cpi/nfp, and the session's largest option
     prints, as glyphs in a lane above the time axis with a hover card each (data/events.ts). */
  events: boolean;
  /* The dotted orange line where a price alert waits. Off by default: the bell, the chip and the drawer say it
     either way; the line is for a reader who wants to see where the watch sits on the tape. */
  alerts?: boolean;
}

/* Chart styles, TradingView's picker — the shape of the tape, orthogonal to the candle color theme. Every style
   draws from the same bars. */
export type ChartStyle = 'candles' | 'hollow' | 'bars' | 'line' | 'step' | 'area' | 'baseline';

export const CHART_STYLES: { value: ChartStyle; label: string }[] = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow', label: 'Hollow candles' },
  { value: 'bars', label: 'Bars' },
  { value: 'line', label: 'Line' },
  { value: 'step', label: 'Step line' },
  { value: 'area', label: 'Area' },
  { value: 'baseline', label: 'Baseline' },
];

/* Indicator overlays — computed chart-side from the same aggregated bars the tape draws, so they agree with it on
   every timeframe. */
export interface ChartIndicators {
  ema9: boolean;
  ema21: boolean;
  ema50: boolean;
  vwap: boolean;
  /* The growth of the set. Overlays ride the tape's own scale */
  /** Bollinger bands — SMA20 ± 2σ, basis and both bands. */
  bb: boolean;
  /** ±1σ/±2σ around the session VWAP — the vwap line's own family. */
  vwapBands: boolean;
  /** SMA 200 — the long classic the EMA trio does not cover. */
  sma: boolean;
  /** Session price weighted by option premium, not shares. Blank until prints land. */
  flowVwap: boolean;
  /** Call premium and put premium, each as its own session price. */
  sideVwap: boolean;
  /** Close average that speeds up when minute gamma is heavy. Blank until that path moves. */
  gammaEma: boolean;
  /** Session price weighted by minute gamma. Blank until that path moves. */
  gammaVwap: boolean;
  /* Sub-panes share the time axis below the tape */
  rsi: boolean;
  macd: boolean;
  /** ATR of this pane's bars — distinct from the session-ATR ruler. */
  atrPane: boolean;
}

export const DEFAULT_INDICATORS: ChartIndicators = {
  ema9: false, ema21: false, ema50: false, vwap: false,
  bb: false, vwapBands: false, sma: false, flowVwap: false, sideVwap: false, gammaEma: false, gammaVwap: false, rsi: false, macd: false, atrPane: false,
};

/* One categorical ink family for auxiliary lines (indicators here, compare lines in the widget) — hues that carry no
   house meaning. Each key's lead ink; multi-line indicators carry their parts in INDICATOR_PARTS below. */
export const INDICATOR_INKS: Record<keyof ChartIndicators, string> = {
  ema9: '#5B9CF6',
  ema21: '#BBB2E8',
  ema50: '#EDE4CD',
  vwap: '#6BD3C7',
  bb: '#C7A9CF',
  vwapBands: '#6BD3C7',
  sma: '#D8BC8F',
  flowVwap: '#E7C36A',
  sideVwap: '#9ED4EA',
  gammaEma: '#F0A07A',
  gammaVwap: '#F0A07A',
  rsi: '#A9C77F',
  macd: '#8FB8D8',
  atrPane: '#C0C7CF',
};

/* What each indicator draws, and where, as data. */
export const SUB_PANE_ORDER: (keyof ChartIndicators)[] = ['rsi', 'macd', 'atrPane'];
export const MAX_SUB_PANES = 2;

interface IndicatorPartSpec {
  part: string;
  kind: 'line' | 'hist';
  ink: string;
  dashed?: boolean;
  faint?: boolean;
}
const INDICATOR_PARTS: Record<keyof ChartIndicators, { pane: 'overlay' | 'sub'; parts: IndicatorPartSpec[] }> = {
  ema9: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.ema9 }] },
  ema21: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.ema21 }] },
  ema50: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.ema50 }] },
  vwap: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.vwap }] },
  bb: {
    pane: 'overlay',
    parts: [
      { part: 'basis', kind: 'line', ink: INDICATOR_INKS.bb },
      { part: 'upper', kind: 'line', ink: INDICATOR_INKS.bb, dashed: true, faint: true },
      { part: 'lower', kind: 'line', ink: INDICATOR_INKS.bb, dashed: true, faint: true },
    ],
  },
  vwapBands: {
    pane: 'overlay',
    parts: [
      { part: 'up1', kind: 'line', ink: INDICATOR_INKS.vwapBands, faint: true },
      { part: 'dn1', kind: 'line', ink: INDICATOR_INKS.vwapBands, faint: true },
      { part: 'up2', kind: 'line', ink: INDICATOR_INKS.vwapBands, dashed: true, faint: true },
      { part: 'dn2', kind: 'line', ink: INDICATOR_INKS.vwapBands, dashed: true, faint: true },
    ],
  },
  sma: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.sma }] },
  flowVwap: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.flowVwap }] },
  sideVwap: {
    pane: 'overlay',
    parts: [
      { part: 'call', kind: 'line', ink: INDICATOR_INKS.sideVwap },
      { part: 'put', kind: 'line', ink: '#F5C542' },
    ],
  },
  gammaEma: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.gammaEma }] },
  gammaVwap: { pane: 'overlay', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.gammaVwap }] },
  rsi: { pane: 'sub', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.rsi }] },
  macd: {
    pane: 'sub',
    parts: [
      /* The histogram draws first so the lines read over it. One steel wash for its bars, not red/green — the sign
         of momentum is not the price direction the pair is reserved for. */
      { part: 'hist', kind: 'hist', ink: 'rgba(226,234,244,0.30)' },
      { part: 'line', kind: 'line', ink: INDICATOR_INKS.macd },
      { part: 'signal', kind: 'line', ink: '#D8A6A6' },
    ],
  },
  atrPane: { pane: 'sub', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.atrPane }] },
};

/** The keys the readout prints — single-line overlays only: a five-line band pair would blow the readout row's
    measured width budget, and a sub-pane's value is in its own units, not the tape's. */
const READOUT_INDICATOR_KEYS = new Set<keyof ChartIndicators>(['ema9', 'ema21', 'ema50', 'vwap', 'sma']);

/* Compare symbols, TradingView's three flavors: percent = ride the same pane with the whole right scale in % change;
   scale = same pane, its own left price scale; pane = its own pane below the tape, own scale. */
export type CompareMode = 'percent' | 'scale' | 'pane';
export interface CompareEntry {
  ticker: string;
  mode: CompareMode;
  /** Line + legend ink — assigned by the host so both stay in agreement */
  ink: string;
}

/* The main price scale's mode. Four, and they are the library's four: a plain price axis, a logarithmic one, percent
   change from the left edge of the visible range, and every series indexed to 100 at that same edge. */
export type PriceScale = 'normal' | 'log' | 'percent' | 'indexed';

/** The picker's rows, and the short label the trigger wears — the axis mode is state a reader needs at a glance, so
    the trigger shows it rather than the word "Scale". */
export const PRICE_SCALES: { value: PriceScale; label: string; short: string; blurb: string }[] = [
  { value: 'normal', label: 'Linear', short: 'LIN', blurb: 'Equal dollars, equal height' },
  { value: 'log', label: 'Logarithmic', short: 'LOG', blurb: 'Equal percentages, equal height' },
  { value: 'percent', label: 'Percent', short: '%', blurb: 'Change from the left edge' },
  { value: 'indexed', label: 'Indexed to 100', short: '100', blurb: 'Every series starts at 100' },
];

const PRICE_SCALE_MODE: Record<PriceScale, PriceScaleMode> = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage,
  indexed: PriceScaleMode.IndexedTo100,
};

/* When the reader's choice does not get to win, and what is holding it. A `percent` comparison rides the main right
   scale. */
export const priceScaleLockedBy = (compares: readonly CompareEntry[]): { mode: PriceScale; reason: string } | null =>
  compares.some(c => c.mode === 'percent')
    ? { mode: 'percent', reason: 'A % comparison shares this axis' }
    : null;

/* Which tape a timeframe reads. */
/** A bar's own day and minute, the way the axis prints them ("Sep 8 · 11:59") */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (t: number) => {
  const d = new Date(t * 1000);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
};
const timeWords = (t: number) => {
  const d = new Date(t * 1000);
  return `${dayWords(t)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function displayBars(ticker: string, mins: number, alt?: AltBarSpec | null): Candle[] {
  /* Rule bars have no live tape — they stay empty. */
  if (alt) return [];
  const session = getDeskSession();
  /* Pinpoint, Trace and the Dossier read Unusual Whales (docs/DATA_SOURCES.md); every other desk draws ThetaData's bars */
  if (thetaBars()) return thetaChartBars(ticker, mins, session);
  if (mins < 1) return [];
  ensureBook(ticker, 'board');
  const book = deskTape(ticker, session).bars;
  return book && book.length >= 1 ? aggregateCandles(book, mins) : [];
}

/* ThetaData draws the bars where it is the page's source; Pinpoint, Trace and the Dossier draw Unusual Whales' */
const thetaBars = (): boolean => thetaUseHere() === 'all';

/** A session's window in New York time: "4:00 AM–9:30 AM ET" */
const etWindow = (session: DeskSession): string => {
  const { from, to } = sessionMeta(session);
  const at = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;
  return `${at(from)}–${at(to)} ET`;
};

export const DEFAULT_OVERLAYS: ChartOverlays = {
  trails: false,  /* off by default until the field is stable — page was hard-crashing on load */
  /* Off to begin with, on every chart: a chart opens as the tape and the exposure field, with nothing named on it,
     and the walls, the flip and the supreme are one switch away in the Overlays menu. */
  levels: false,
  darkpool: false,
  volume: true,
  /* Off by default, and not out of caution — the tape has no history. It accumulates from the moment the app opens,
     so on a cold load this pane has nothing to draw. */
  flow: false,
  /* Off for the same reason — it reads the same tape. */
  netDrift: false,
  /* Off because realised vol needs RV_MODEL.window bars before it can say anything, and because a reader who has not
     asked for a third band should not get one: every extra pane is height taken off the tape. */
  volDrift: false,
  /* Off because it costs the tape real height rather than sharing it. */
  dexStrike: false,
  /* Off because seven more rules across a tape is a lot to hand somebody who did not ask for them, and every stored
     setup written before the session overlay existed comes back with it false anyway. */
  session: false,
  /* Off for the same courtesy — an envelope plus a runway cone is a lot of geometry to hand a reader who has not
     asked what the options charge. */
  cone: false,
  /* Off until asked for, like every other layer of context. */
  events: false,
};

/** The library sizes the price axis to its tick text and the live-price card takes the measured width; this is the
    axis's usual width at a three-digit price, which the chrome pads for. */
export const PRICE_SCALE_MIN_WIDTH = 58;

/* Where a price lands on this chart, published live. A column drawn beside the tape has to agree with the tape's own
   price scale or it is a second, contradicting set of numbers 54px away. */
export interface PriceProjection {
  /** Y in CSS px from the top of the plot, or null if the series is gone. */
  yFor(price: number): number | null;
  /** The plot's own height — NOT the container's; the time axis is below it. */
  plotHeight(): number;
  /** The time axis's height, for a neighbour that has to stop above it. */
  axisHeight(): number;
}

export interface ChartTape {
  /** One-minute bars, oldest first, up to the host's clock. `native` bars are already the timeframe on screen. */
  bars: Candle[];
  /** The name's annual vol on the tape's day — what the vol pane and the distance scales read */
  iv: number;
  /** What this tape's drawings are kept under */
  key: string;
  /** 'ny': the axis and the crosshair speak New York whatever clock the reader chose in Settings — a tape that IS the
      market's day (a backtest). Read once, when the chart is made. */
  clock?: 'ny';
  /** What a price is printed to, where cents are not it (a future: gold in tenths, silver in thousandths) */
  precision?: { decimals: number; tick: number };
  /** These bars are already the selected timeframe. Folding them again would mash a day into the wrong bucket. */
  native?: boolean;
  /** Why the frame is empty — a session with no prints, or a tape that did not answer. */
  note?: string | null;
}
/** What a host's layer is handed: the chart, and the series that carries price now (a style swap replaces it — ask
    each time, never keep it) */
/** A long or a short mark, as a trade: where it gets in, where it takes profit, where it stops (see `onTradeMark`) */
export interface TradeMark {
  kind: 'long' | 'short';
  entry: number;
  target: number;
  stop: number;
}
export interface ChartLayerApi {
  chart: () => IChartApi | null;
  series: () => ISeriesApi<SeriesType> | null;
  host: () => HTMLElement | null;
  /** Prices the scale has to keep in view (an open position's lines, and the room a target or a stop is pulled into)
      — read by the same provider that keeps the walls on screen; a hand-set scale is left alone */
  room: (prices: number[]) => void;
  /** The chart's way home (ResetViewControl) — for a layer whose own right-click card stands in for the reset card */
  reset: () => void;
}

interface StrikeChartProps {
  ticker: string;
  /** The expiry the nodes draw. Null is the first expiry still open, the same column the calendar shows first. */
  bookDate?: string | null;
  /** Bumped every simulator tick so the chart folds in the newest bar */
  revision: number;
  levels: KeyLevels;
  timeframe: Timeframe;
  height?: number;
  /** Keep the reader's view across remounts. Off by default: Terrain and Pulse re-fit a reloaded chart. */
  keepView?: boolean;
  /** Drop the container's own border/fill/rounding — the host supplies one surface and the tape bleeds to its edges. */
  frameless?: boolean;
  /** Transient user-focused price — renders a cyan focus line while set */
  focusPrice?: number | null;
  overlays?: ChartOverlays;
  /** Dark-pool prints for the DP overlay (whisper lines, MiniPane grammar) */
  prints?: DarkPoolPrint[];
  /** Trace's option prints, for the flow pane. */
  flowPrints?: readonly StampedFlowPrint[];
  /** Comparison symbols drawn as lines over/under the tape */
  compares?: CompareEntry[];
  /** The main (right) price scale's mode. A `percent` comparison overrides it; see `priceScaleLockedBy`. */
  priceScale?: PriceScale;
  /** Which opening range the session overlay draws. Ignored unless `overlays.session` is on. */
  sessionOr?: OpeningRange;
  /** The tape's shape — candles, bars, line, area… (theme-independent) */
  chartStyle?: ChartStyle;
  /** Pin this chart to one candle theme, ignoring the app-wide store — Terrain's panes each own theirs. */
  themeKey?: CandleThemeKey;
  /** The bar clock, keyed into data/altBars.ts's BAR_CLOCKS. 'time' is the ordinary timeframe; a range/volume key
      folds the live seconds tape by rule instead. */
  barClock?: string;
  /** Indicator overlays computed from the same bars */
  indicators?: ChartIndicators;
  /** This pane's name for the script library: 'pulse:main', 'terrain:1', 'weigher', 'pinpoint:map'. Given, the
      scripts placed on it draw here over the same bars; absent, no script draws. */
  paneId?: string;
  /** Draw mode — pointer sketches trendlines/levels instead of panning */
  drawing?: boolean;
  onExitDraw?: () => void;
  /** The persistent rail's way IN — clicking a tool while not drawing arms draw mode with that tool. Hosts that never
      draw leave it unset and get no rail. */
  onEnterDraw?: () => void;
  /** Whether this host has headroom for the top dock. */
  railTopOk?: boolean;
  /** Room a host's own chrome takes at the price pane's foot, in px — the replay card stands that much higher. 0 when
      nothing of the host's is there. */
  footInset?: number;
  /** Replay mode — scrub through history bar by bar, trails included */
  replay?: boolean;
  /** The Map's own replay clock: given, the chart shows the bars up to this time and keeps its own transport off —
      one scrubber drives the whole page. Absent, the chart's own transport plays as before. */
  replayTime?: number | null;
  /** Pick a bar: the crosshair is a silver line and a click on a bar hands its time to the host, which starts the
      replay from that minute. */
  pickTime?: boolean;
  onPickTime?: (time: number) => void;
  onExitReplay?: () => void;
  /** A click on a bead of the field keeps its strike — the host's focus */
  onKeepStrike?: (price: number) => void;
  /** A tape of its own. The backtest drew its own small chart, so it had none of this one's tools: the drawing rail,
      the indicators, the chart styles, the scales, the export. */
  tape?: ChartTape;
  /** Something of the host's drawn over the plot, with the chart in hand (Review's open position and its target and
      stop) */
  layer?: (api: ChartLayerApi) => ReactNode;
  /** A long or a short drawn is a trade: with a long or a short mark selected, its bar offers "Place it", and the
      host is handed the mark's entry, target and stop — the host says what order that is. */
  onTradeMark?: (mark: TradeMark) => void;
  /** The live price on the right scale as a soft two-line card — the price, a rule, and the time left in the current
      bar — in place of the library's flat last-value tag. Off by default; Terrain turns it on. */
  priceTag?: boolean;
  /** Which exposure the trails draw — gamma unless the host's head says otherwise. Pulse and Terrain pass nothing and
      stay on gamma. */
  trailsGreek?: 'gex' | 'dex' | 'vex';
  /** Which expected-move wedge to draw. Session unless the indicators menu says otherwise. */
  coneHorizon?: 'session' | 'week' | 'next';
  /** The field's key row under the plot: drawn here unless the host prints the key on a line of its own — Terrain's
      desk bar — in which case the reference figure goes out through `onTrailKey` (0 when the field is off) */
  trailKey?: boolean;
  onTrailKey?: (ref: number) => void;
  /** Fired on real pointer input only — the hovered bar's time, or null when the pointer leaves the plot. */
  onCrosshair?: CrosshairSync;
  /** Handed this chart's own "mark that moment" function on mount and null on unmount, so a host can call it when a
      different pane is hovered. */
  syncRegister?: (apply: CrosshairSync | null) => void;
  /** The snapshot: handed a function that returns the chart's own picture (the library's takeScreenshot — every
      series, every drawing, the axes) on mount, and null on unmount; the host composes and offers it */
  snapshotRegister?: (take: (() => HTMLCanvasElement | null) | null) => void;
  /** This chart's ohlcv and indicator values at the hovered moment. */
  onReadout?: CrosshairReadout;
  /** Filled with this chart's live price projection on mount, nulled on unmount. */
  projectionRef?: MutableRefObject<PriceProjection | null>;
  /** Filled with the pane's PNG exporter (chart.takeScreenshot plus an identity header and watermark, downloaded on
      call). Ref-based like the projection: the chart owns its canvases, the host owns the trigger. */
  exportRef?: MutableRefObject<(() => void) | null>;
  /** Shrink the price-scale furniture — for a chart on a phone. The axis labels and the strike chips are fixed sizes,
      tuned on a chart about 550px wide. */
  compact?: boolean;
  /** This chart is inside a page that scrolls — leave the wheel to it. */
  pageScroll?: boolean;
}

/** Mark a moment on this chart on another pane's behalf; null clears it. */
export type CrosshairSync = (time: UTCTimestamp | null) => void;

/* What the hovered bar says. A second channel, not an extension of `CrosshairSync`, and the split is deliberate. */
export interface CrosshairBar {
  time: UTCTimestamp;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  /** Active indicators at that bar, in the chart's own order, with its inks. */
  indicators: { key: keyof ChartIndicators; ink: string; value: number }[];
}

/** This chart's values at the hovered moment; null when nothing is hovered. */
export type CrosshairReadout = (bar: CrosshairBar | null) => void;

// Wall / flip / supreme overlay colors (independent of candle theme)
import { defaultStop } from './drawingKinds';
import { BULL, CALL_WALL, PUT_WALL, SUPREME, FOCUS, DARK_POOL, ALERT as ALERT_INK } from './palette';

// Level lines are created once per overlay/ticker, then their prices are
/* The rail's two reader preferences One tiny store, module-wide, persisted — so hiding or re-docking the rail on any
   chart does it on every chart at once, which is the only version a reader can predict. */
type RailDock = 'left' | 'top';
const RAIL_KEY = 'slayer_draw_rail';
let railPrefs: { dock: RailDock; open: boolean } = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(RAIL_KEY) ?? '{}') as { dock?: string; open?: boolean };
    return { dock: raw.dock === 'top' ? 'top' : 'left', open: raw.open !== false };
  } catch {
    return { dock: 'left', open: true };
  }
})();
const railListeners = new Set<() => void>();
function setRailPrefs(patch: Partial<{ dock: RailDock; open: boolean }>): void {
  railPrefs = { ...railPrefs, ...patch };
  try {
    localStorage.setItem(RAIL_KEY, JSON.stringify(railPrefs));
  } catch {
    /* Storage off — the choice lives for the session */
  }
  railListeners.forEach(fn => fn());
}
const railSubscribe = (fn: () => void) => {
  railListeners.add(fn);
  return () => {
    railListeners.delete(fn);
  };
};
const railSnapshot = () => railPrefs;
function useRailPrefs(): { dock: RailDock; open: boolean } {
  return useSyncExternalStore(railSubscribe, railSnapshot, railSnapshot);
}

/* The strip's gap: a host's strip lays its timeframes at the left and its menus at the right with a spacer between
   (ChartToolbar `[data-toolbar-gap]`). */
function useToolbarGap(containerRef: MutableRefObject<HTMLDivElement | null>, on: boolean): { left: number; width: number } | null {
  const [gap, setGap] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!on || !el) {
      setGap(null);
      return;
    }
    const find = (): { host: HTMLElement; spacer: HTMLElement } | null => {
      let host: HTMLElement | null = el.parentElement;
      while (host) {
        const spacer = host.querySelector<HTMLElement>('[data-toolbar-gap]');
        if (spacer) return { host, spacer };
        host = host.parentElement;
      }
      return null;
    };
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let tries = 0;
    const read = (spacer: HTMLElement) => {
      const g = spacer.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      const next = { left: Math.round(g.left - c.left), width: Math.round(g.width) };
      setGap(prev => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    const attach = () => {
      const found = find();
      if (!found) {
        /* The strip's spacer arrives a frame or two after the pane expands — its toolbar sheds `compact` only once
           the strip has measured its new width — so look again for a few frames before giving up */
        if (tries++ < 20) raf = requestAnimationFrame(attach);
        else setGap(null);
        return;
      }
      read(found.spacer);
      ro = new ResizeObserver(() => read(found.spacer));
      ro.observe(found.host);
      ro.observe(found.spacer);
    };
    attach();
    const onResize = () => {
      const found = find();
      if (found) read(found.spacer);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [containerRef, on]);
  return gap;
}

/* The four key levels as rungs at the tape's right edge (keyLevelsPrimitive.ts): call wall glacier (C), put wall
   ember (P), flip dashed silver (F), supreme magenta and one step heavier. */
const ladderOf = (L: KeyLevels, silver: string): KeyLevelRung[] =>
  (
    [
      { key: 'callWall', price: L.callWall, ink: CALL_WALL },
      { key: 'putWall', price: L.putWall, ink: PUT_WALL },
      { key: 'flip', price: L.flip, ink: silver, dash: true },
      { key: 'supreme', price: L.supreme, ink: SUPREME, weight: 2 },
    ] as KeyLevelRung[]
  ).filter(r => Number.isFinite(r.price) && r.price > 0);

const toCandle = (b: Candle) => ({
  time: b.time as UTCTimestamp,
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
});

/** Styles that eat whole bars; the rest eat closes. */
const OHLC_STYLES: ReadonlySet<ChartStyle> = new Set(['candles', 'hollow', 'bars']);
const toVolume = (b: Candle, t: CandleTheme) => ({
  time: b.time as UTCTimestamp,
  value: b.volume,
  color: b.close >= b.open ? t.volUp : t.volDown,
});

/** Bars a chart opens with — more than a screen at any pitch; the rest of the store loads when the reader scrolls to
    their left edge (see onRange) */
const INITIAL_BARS = 1000;
/** ...which is this many bars from the first loaded one */
const FULL_TRIGGER = 80;
/** The bars a world shows: the whole store once asked for, the recent window otherwise */
const windowOf = (all: Candle[], full: boolean): Candle[] =>
  full || all.length <= INITIAL_BARS + 200 ? all : all.slice(all.length - INITIAL_BARS);

/** KeepView: the reader's view per world, surviving a remount and a refresh. */
type KeptView = { barSpacing: number; rightOffset: number; scroll: number };
const VIEW_STORE = 'slayer.chartView';
function loadKept(): Map<string, KeptView> {
  const map = new Map<string, KeptView>();
  try {
    const raw = sessionStorage.getItem(VIEW_STORE);
    if (!raw) return map;
    const obj = JSON.parse(raw) as Record<string, KeptView>;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.barSpacing === 'number') map.set(k, v);
    }
  } catch { /* private mode */ }
  return map;
}
const KEPT_VIEWS = loadKept();
function rememberView(key: string, view: KeptView) {
  KEPT_VIEWS.set(key, view);
  try { sessionStorage.setItem(VIEW_STORE, JSON.stringify(Object.fromEntries(KEPT_VIEWS))); } catch { /* ignore */ }
}

/** One empty array for the `compares` default — a literal [] default is a new identity per render, and an effect
    keyed on it fires every render. */
const NO_COMPARES: never[] = [];

/** TradingView-grade candlestick chart with dealer-structure overlays and the net-GEX node heatmap. */
const StrikeChart = ({
  ticker,
  paneId,
  revision: revisionProp,
  levels,
  timeframe,
  height = 460,
  keepView = false,
  trailsGreek = 'gex',
  coneHorizon = 'session',
  trailKey = true,
  onTrailKey,
  compact = false,
  pageScroll = false,
  frameless = false,
  focusPrice = null,
  onKeepStrike,
  overlays = DEFAULT_OVERLAYS,
  prints = [],
  flowPrints,
  compares = NO_COMPARES,
  priceScale = 'normal',
  sessionOr = 15,
  chartStyle = 'candles',
  themeKey: themeKeyProp,
  barClock = 'time',
  indicators = DEFAULT_INDICATORS,
  drawing = false,
  onExitDraw,
  onEnterDraw,
  railTopOk = true,
  footInset = 0,
  bookDate = null,
  replay = false,
  replayTime = null,
  pickTime = false,
  onPickTime,
  onExitReplay,
  tape,
  layer,
  onTradeMark,
  priceTag = false,
  onCrosshair,
  syncRegister,
  snapshotRegister,
  onReadout,
  projectionRef,
  exportRef,
}: StrikeChartProps) => {
  const bookRev = useBookRev();
  const bookMinutes = useBookMinutes(ticker);
  const session = useDeskSession();
  const deskSessionRef = useRef(session);
  deskSessionRef.current = session;
  /* Where the bars come from — the host's tape, or this session's prints. Another session is never left on screen. */
  const tapeRef = useRef<ChartTape | undefined>(tape);
  tapeRef.current = tape;
  const tapeKeyRef = useRef('');
  const barsFor = (mins: number, alt?: AltBarSpec | null): Candle[] => {
    const host = tapeRef.current;
    if (host?.native) return host.bars;
    if (host) return aggregateCandles(host.bars, Math.max(1, mins));
    return displayBars(ticker, mins, alt);
  };
  const baseBars = (): Candle[] => tapeRef.current?.bars ?? (!thetaBars() ? deskTape(ticker, session).bars : thetaChartBars(ticker, 1, session));
  /* The exposure field's columns on these bars: the vendor's per-strike readings for the cut's expiries
     (data/book/exposureLog.ts), one column a bar, empty where no reading covers it */
  const fieldMode = useFieldMode();
  const fieldRev = useExposureLogRev(ticker);
  const fieldColumns = (bars: readonly Candle[], mins: number): GexSnapshot[] => {
    if (tapeRef.current || !bars.length) return [];
    const cut = chainForDate(ticker, bookDate)?.date;
    /* a day bar also reads the sessions before today, each as of its close */
    if (cut && mins >= 1440) ensureFieldCloses(ticker, cut);
    const grid = cut ? exposureGrid(ticker, cut, bars.map(b => b.time), mins * 60, fieldMode) : null;
    return grid ? gridColumns(grid) : [];
  };
  const nameIv = (): number | undefined => (tapeRef.current ? tapeRef.current.iv : peekIv(ticker) ?? undefined);
  const drawKey = tape?.key ?? ticker;
  const tapeStamp = tape
    ? `${tape.key}|${tape.bars.length}|${tape.bars.length ? tape.bars[tape.bars.length - 1].time : 0}|${tape.bars.length ? tape.bars[tape.bars.length - 1].close : 0}|${tape.note ?? ''}`
    : '';
  /* No tick rebuild under the hand: while a pointer is down on the chart the revision is held (every tick-driven
     effect keys on it) and the newest one is applied on release. */
  /* ThetaData's live print moves the forming bar between the host's ticks (every desk but Pinpoint and the Dossier) */
  const printRev = usePrintRev(!tape && thetaBars());
  const liveRev = revisionProp + printRev;
  const [revision, setRevision] = useState(liveRev);
  const keepViewRef = useRef(keepView);
  keepViewRef.current = keepView;
  /** The price scale's resolved mode — a compare in scale mode locks it, otherwise the prop. A string, so effects can
      key on it safely. */
  const scaleMode = priceScaleLockedBy(compares)?.mode ?? priceScale;
  const panRef = useRef(false); // a pointer is down on the plot (the drawing tools own `dragRef` below)
  const pendingRef = useRef<number | null>(null);
  useEffect(() => {
    if (panRef.current) pendingRef.current = liveRev;
    else setRevision(liveRev);
  }, [liveRev]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const down = () => {
      panRef.current = true;
    };
    const up = () => {
      if (!panRef.current) return;
      panRef.current = false;
      if (pendingRef.current != null) {
        const r = pendingRef.current;
        pendingRef.current = null;
        // Applied at once: deferring it a frame measured worse (87–109ms → 151ms on release) — React interleaved the
        // deferred urgent update with the desk's in-flight transition and did the work twice.
        setRevision(r);
      }
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* Per-pane candle theme. Ours, kept through the port — the partner tree reads the global store here and so paints
     every pane alike. A pinned pane takes the prop; everything unpinned keeps following the app-wide store. */
  const globalThemeKey = useCandleThemeKey();
  /* The app's theme moves the ground of a theme without a canvas of its own */
  const appTheme = useResolvedTheme();
  const themeKey = themeKeyProp ?? globalThemeKey;
  /* The theme this chart paints, wherever it is read: eight places below used to call the store's
     `themeRef.current`, so a pane holding its own theme (Terrain's prop) repainted with the app-wide one — the pick */
  const themeRef = useRef<CandleTheme>(CANDLE_THEMES[themeKey]);
  themeRef.current = CANDLE_THEMES[themeKey];
  /* Read straight from the store rather than taken as a prop: alerts belong to the symbol, and two panes showing the
     same symbol must draw the same set. The drawings store is read the same way, from this same component. */
  const alerts = useAlerts(ticker);
  /* The rule clock's spec, or null on the ordinary timeframe — resolved once per key so every effect gates on the
     same object. */
  const altSpec = useMemo(() => barClockSpec(barClock), [barClock]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  /* The host's chrome band: CSS px from the box's top to the lowest floating block over its upper third — every host
     marks its strip `data-chart-chrome`, measured here the way the scripts legend measures. */
  const chromeInsetRef = useRef(0);
  /* …and as state, with the box's height, for the drawing rail's placement */
  const [chromeInset, setChromeInset] = useState(0);
  const [boxH, setBoxH] = useState(0);
  /* THE TRADINGVIEW MARK'S ROOM (2026-10-30, the last-targets pass): CSS px from the mark's top to the box's bottom,
     measured; 56 until the chart has drawn it (a 27px time axis, the mark's 10px inset, its 19px). */
  const [markClear, setMarkClear] = useState(56);
  /* Read at create time by the mount effect, which must not take `compact` as a dep — that effect builds the whole
     chart, and rebuilding it on a prop change would drop the reader's pan, zoom and drawings. */
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const pageScrollRef = useRef(pageScroll);
  pageScrollRef.current = pageScroll;
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /* Two series, not one signed one: the reference draws both legs around a zero line, and a single net bar cannot
     say whether a quiet bucket was quiet or whether a billion dollars hit each side and cancelled. */
  const flowCallsRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const flowPutsRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /* The two drift lines and the two vol lines, each pair sharing one pane. */
  const driftCallsRef = useRef<ISeriesApi<'Line'> | null>(null);
  const driftPutsRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rvRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ivRef = useRef<ISeriesApi<'Line'> | null>(null);
  /* Where each product pane's top edge sits, in px up from the container's bottom. */
  const [paneLabels, setPaneLabels] = useState<{ key: string; top: number }[]>([]);
  /* The runway — a series that draws nothing and holds only whitespace. Lightweight-charts labels the time axis from
     the time points its series hold, and it has none past the last bar. */
  const runwaySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  /** Bar time the runway was last built from, and how far it reaches. */
  const runwayRef = useRef<{ from: number; slots: number }>({ from: 0, slots: 0 });
  /** Close of the newest bar — what the price card prints. */
  const lastCloseRef = useRef<number | null>(null);
  const priceTagRef = useRef<HTMLDivElement | null>(null);
  const priceTagRafRef = useRef(0);
  const trailsRef = useRef<GexTrailsPrimitive | null>(null);
  /* The field's hover: the bead under the pointer (its card follows the pointer), the one kept by a click (its card
     stands still, with more), the size reference the legend line prints */
  /* The hover cards' reads live in cells, not state: a new bead or rung under the pointer re-renders its card, not
     this component (see hoverCell.tsx) */
  const [beadCell] = useState(() => makeCell<BeadHit | null>(null));
  const [coneCell] = useState(() => makeCell<ConeHit | null>(null));
  const [pinnedBead, setPinnedBead] = useState<{ hit: BeadHit; x: number; y: number } | null>(null);
  const pinnedBeadRef = useRef(pinnedBead);
  pinnedBeadRef.current = pinnedBead;
  const pointerAtRef = useRef({ x: 0, y: 0 });
  const downAtRef = useRef<{ x: number; y: number } | null>(null);
  const [trailRef, setTrailRef] = useState(0);
  /* The key's reference out to the host: Terrain prints the field's key on its own desk line */
  useEffect(() => {
    onTrailKey?.(overlays.trails && !replay ? trailRef : 0);
  }, [onTrailKey, overlays.trails, replay, trailRef]);
  const compareSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const compareLoadedRef = useRef('');
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>(new Map());
  /* The scripts on this pane: one handle per placed script, the compiled trees by source hash, and the signature the
     handles were built for — a tick redraws in place, a change of set or shape rebuilds. */
  const scriptHandlesRef = useRef<Map<string, ScriptHandle>>(new Map());
  const scriptSigRef = useRef('');
  const compiledRef = useRef<Map<string, Compiled>>(new Map());
  const paneScripts = usePaneScripts(paneId);
  const indicatorLoadedRef = useRef('');
  /* The main series' style — a ref for the one-time creation effect, a nonce so every effect that hangs price lines
     off the main series knows to re-hang them after a style swap replaces it. */
  const styleRef = useRef<ChartStyle>(chartStyle);
  styleRef.current = chartStyle;
  const styleBuiltRef = useRef<ChartStyle | null>(null);
  const [mainNonce, setMainNonce] = useState(0);
  /* The sub-minute tape starts at connect, and the pane says so — 0 = connected but no prints yet, a time = the
     first live quarter, null = not a sub-minute view. */
  const [liveFrom, setLiveFrom] = useState<number | null>(null);
  const printLinesRef = useRef<IPriceLine[]>([]);
  /** The key levels' ladder at the tape's right edge, and the rung under the pointer with its card */
  const ladderRef = useRef<KeyLevelsPrimitive | null>(null);
  const [levelCell] = useState(() => makeCell<{ key: KeyLevelKey; price: number; x: number; y: number } | null>(null));
  const shownLevelsRef = useRef<KeyLevels | null>(null);
  /** The layer. One primitive for the life of the chart; what it draws is swapped, never the primitive itself — see
      the session effect below. */
  const sessionPrimRef = useRef<SessionLevelsPrimitive | null>(null);
  /** The layer, run the same way — see the cone effect below. */
  const conePrimRef = useRef<ExpectedMovePrimitive | null>(null);
  /** The layer, ditto. */
  const eventsPrimRef = useRef<EventsPrimitive | null>(null);
  /** The calendar half of the events data, cached per ticker+day: the dates move daily while prints move every tick,
      so it is not rebuilt per tick. */
  const eventsCalRef = useRef<{ key: string; earnings: EarningsEvent | null; macro: MacroDate[]; todayIso: string } | null>(null);
  /** The hovered marker's card. */
  const [eventCell] = useState(() => makeCell<{ e: MarketEvent; x: number } | null>(null));
  const levelRafRef = useRef(0);
  /** Time of that bar, and the seconds one bar covers — what the runway is built from, kept in refs so the time-scale
      subscription can read them without being torn down and rebuilt on every tick. */
  const lastBarTimeRef = useRef(0);
  /** The host tape's last one-minute bar at the last load — how a jump of the host's clock is told from a tick */
  const tapeLastRef = useRef(0);
  /* What the price card's countdown measures against: the bar time we last saw, when we saw it in real ms, and the
     observed real gap between the last two arrivals. */
  const barClockRef = useRef({ stamp: 0, at: 0, realMs: 0 });
  const bucketSecRef = useRef(60);
  const levelTickerRef = useRef('');
  const focusLineRef = useRef<IPriceLine | null>(null);
  /** One price line per alert, by alert id. */
  const alertLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  /** One price line per alert, by alert id. */
  /** The focus price, readable from the autoscale provider (a closure built once at chart creation) — a focused
      strike must never sit off-screen. */
  const focusPriceRef = useRef<number | null>(focusPrice);
  const levelsRef = useRef<KeyLevels>(levels);
  /** What a host's layer asked the scale to keep in view (ChartLayerApi.room) */
  const roomRef = useRef<number[]>([]);
  const layerRoom = useCallback((prices: number[]) => {
    roomRef.current = prices;
    /* Fitted again with what it now has to hold — only a scale that is fitting itself; one set by hand is the
       reader's */
    try {
      const scale = chartRef.current?.priceScale('right');
      if (scale?.options().autoScale) scale.applyOptions({ autoScale: true });
    } catch {
      /* Asked by a layer on its way out, after the chart itself has gone */
    }
  }, []);
  const barCountRef = useRef(0);
  /* History on demand: a world (name · interval · clock) opens on its recent bars and scrolling to their left edge
     loads the whole store once. `fullWorldRef` names the world that asked; the nonce re-runs the data effects. */
  const fullWorldRef = useRef<string | null>(null);
  const recentHeldRef = useRef(false);
  const worldKeyRef = useRef('');
  const [fullNonce, setFullNonce] = useState(0);
  /* Mirrored every render, read from a subscription installed once — the same pattern levelsRef and focusPriceRef
     use, and the reason the mount effect never has to re-subscribe. */
  const onCrosshairRef = useRef(onCrosshair);
  onCrosshairRef.current = onCrosshair;
  const syncRegisterRef = useRef(syncRegister);
  syncRegisterRef.current = syncRegister;
  const snapshotRegisterRef = useRef(snapshotRegister);
  snapshotRegisterRef.current = snapshotRegister;
  const onReadoutRef = useRef(onReadout);
  onReadoutRef.current = onReadout;
  /** The last payload actually sent, as a string — see `emitReadout`. */
  const readoutSigRef = useRef('');
  /** The moment this chart is currently marking for another pane, or null. */
  const syncedRef = useRef<UTCTimestamp | null>(null);
  /** Whether the horizontal crosshair arm is currently hidden because this chart is following another pane. */
  const followerRef = useRef(false);
  /* Rule-clock bookkeeping: the bar counts last painted, so a pass can tell "the forming bar grew" (cheap update)
     from "a bar completed and a new one opened" (reload — update cannot rewrite an older time). */
  const altCountRef = useRef(0);
  const indAltCountRef = useRef(0);
  const loadedRef = useRef<{ ticker: string; timeframe: Timeframe; theme: string; clock: string; full: boolean }>({
    ticker: '',
    timeframe: '1m',
    theme: '',
    clock: 'time',
    full: false,
  });

  // Drawing state
  const drawingsRef = useRef<DrawingsPrimitive | null>(null);
  const shapesRef = useRef<Drawing[]>([]);
  const dragRef = useRef<Drawing | null>(null);
  /** A committed base waiting for its third anchor — the channel's width, the curve's bend. Which kinds owe one comes
      from the same KIND_SHAPE table the validator reads (needsThirdAnchor). */
  const pendingThirdRef = useRef<Drawing | null>(null);
  /* The path under construction — clicks append here; a double-click seals it. Cleared when the hand changes tools
     or leaves draw mode. */
  const pathDraftRef = useRef<{ kind: DrawingKind; pts: { time: number; price: number }[] } | null>(null);
  /* A freehand stroke in the hand (the brush, the highlighter): the pointer's own path while it is held down, kept
     between the bars (the primitive's exact grid) so a stroke is a stroke and not a staircase. */
  const freeRef = useRef<{ kind: DrawingKind; pts: { time: number; price: number }[]; x: number; y: number } | null>(null);
  /* Click-move-click, armed — when a press releases without having really dragged (under the pixel threshold), the
     draft stays in the hand: the line rides the cursor and the next press plants the second anchor. */
  const pendingSecondRef = useRef<Drawing | null>(null);
  /** Where the two-anchor press started, in px — release compares against this to tell a drag from a click. */
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** Where a note is being typed, in both spaces: chart coords to commit, client coords to float the input at. Null =
      no note in progress. */
  /* Three kinds take words now — the note, the text, the callout — and the callout brings the two anchors it was
     drawn with (`base`). */
  const [noteAt, setNoteAt] = useState<{ time: number; price: number; x: number; y: number; kind: DrawingKind; base?: Drawing } | null>(null);
  /** Every tool, as a sheet (DrawRailTools) — the rail's search door, and the whole toolbar on a narrow pane */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const quote = useSessionQuote(ticker, session, quiet && session !== 'rth');
  useEffect(() => {
    const id = window.setTimeout(() => {
      /* a ThetaData tape still being read (this browser's copy included) is not an empty one */
      if (barCountRef.current === 0 && (tapeRef.current || !thetaBars() || thetaChartNote(ticker, tfMinutes(timeframe), getDeskSession()) != null)) setQuiet(true);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [ticker, timeframe, barClock]);
  /** The chart's box — what the rail's lists and the sheet are portalled into */
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  /* The box's client rect for the per-move hit tests, read once and dropped when it can have moved. Read fresh on
     every move it forced a layout each time, right after the pane's read line had written to the DOM. */
  const boxRectRef = useRef<DOMRect | null>(null);
  const wheelAtRef = useRef(0);
  /* The field's hovered bead, drawn on its own canvas over pane 0 (see GexTrailsPrimitive.hoverOverlay) */
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverDrawnRef = useRef(false);
  const drawHoverRef = useRef(() => {});
  drawHoverRef.current = () => {
    const cv = hoverCanvasRef.current;
    const chart = chartRef.current;
    const trails = trailsRef.current;
    if (!cv || !chart || !trails) return;
    const shape = trails.hoverShape();
    if (!shape && !hoverDrawnRef.current) return;
    const { width: w, height: h } = chart.paneSize(0);
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    hoverDrawnRef.current = !!shape;
    if (!shape) return;
    const cx = shape.x * dpr;
    const cy = shape.y * dpr;
    const rx = shape.rx * dpr;
    const ry = shape.ry * dpr;
    g.fillStyle = shape.fill;
    const lw = Math.max(1, Math.round(1.5 * dpr));
    g.lineWidth = lw;
    g.strokeStyle = shape.ring;
    /* the field's cell under the pointer, at full light, ringed */
    g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    g.strokeRect(cx - rx - lw / 2, cy - ry - lw / 2, rx * 2 + lw, ry * 2 + lw);
  };
  const boxRect = (el: HTMLElement) => (boxRectRef.current ??= el.getBoundingClientRect());
  useEffect(() => {
    if (!boxEl) return;
    const drop = () => {
      boxRectRef.current = null;
    };
    const ro = new ResizeObserver(drop);
    ro.observe(boxEl);
    window.addEventListener('scroll', drop, { capture: true, passive: true });
    window.addEventListener('resize', drop);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('resize', drop);
      drop();
    };
  }, [boxEl]);
  /* The focus ink is the silver (where you are), read off the pane's own box so the chart gets a colour, never a CSS
     variable. The box is reached through a ref so the line's effects need not re-run for it. */
  const boxElRef = useRef<HTMLDivElement | null>(null);
  boxElRef.current = boxEl;
  const focusInk = (): string => (boxElRef.current ? readToken('--silver', undefined, boxElRef.current) : FOCUS);
  /* 'select' is the rail's pointer — not a DrawingKind, because it makes no drawing: it picks one up. The default,
     so entering draw mode never scribbles a trend on the first accidental drag. */
  const [drawTool, setDrawTool] = useState<DrawingKind | 'select'>('select');
  /** The selected mark's index in shapesRef — mirrored into the primitive for its handles. */
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  /** A drag in progress on the selected mark: one anchor, or the whole body. */
  const editRef = useRef<{
    index: number;
    /** P1/p2/p3 = 0/1/2; a path's points index freely beyond that. */
    anchor: number | null;
    start: { time: number; price: number };
    orig: Drawing;
    moved: boolean;
  } | null>(null);

  const deselect = useCallback(() => {
    setSelectedIdx(null);
    drawingsRef.current?.setSelected(null);
    editRef.current = null;
  }, []);

  /* Leaving draw mode, or the world changing under it, abandons whatever was mid-gesture: a channel base with no
     width yet, a note not yet typed, a draft mid-drag. */
  useEffect(() => {
    if (drawing) return;
    dragRef.current = null;
    pendingThirdRef.current = null;
    freeRef.current = null;
    setNoteAt(null);
    drawingsRef.current?.setDraft(null);
    deselect();
  }, [drawing, deselect]);
  useEffect(() => {
    dragRef.current = null;
    pendingThirdRef.current = null;
    setNoteAt(null);
    drawingsRef.current?.setDraft(null);
    deselect();
  }, [ticker, timeframe, deselect]);

  // Replay state
  const replayRef = useRef(false); // effect-visible mirror of the replay prop
  const replayDataRef = useRef<{ bars: Candle[]; snaps: ReturnType<typeof aggregateSnapshots>; maxAbs: number } | null>(null);
  const replayAppliedRef = useRef(0); // last idx applied to the series (for the fast append path)
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(2);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Keep the autoscale provider reading the freshest levels without re-mounting
  levelsRef.current = levels;

  /* The default view on a new world (ticker or timeframe): as many bars as the chart can hold at a dense pitch, not
     a fixed 130. Width-aware, so a docked panel and the fullscreen takeover each get the pitch, not the count. */
  /* The bar pitch the default view lands on, per timeframe: 5m reads right at ~4px, 15m at ~6.5 — coarser bars earn
     more room, so a wider frame shows fewer of them and the recent structure stays legible. */
  const DEFAULT_PITCH_PX: Record<Timeframe, number> = { '15s': 3, '1m': 3.5, '5m': 4, '15m': 6.5, '30m': 8, '1h': 10, '1D': 14, '1W': 18 };
  /* History takes ~64% of the width; the rest stays OPEN ahead of the last bar. */
  const HISTORY_SHARE = 0.64;
  const timeframeRef = useRef<Timeframe>(timeframe);
  timeframeRef.current = timeframe;
  /** The container's last observed width — the re-fit observer keeps it, so showRecent reads the DOM (a forced
      layout, 28–44ms of every desk open on the profiler) only the first time, before any observation. */
  const widthRef = useRef(0);
  const showRecent = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const len = barCountRef.current;
    const width = widthRef.current || (containerRef.current?.clientWidth ?? 1200);
    const pitch = DEFAULT_PITCH_PX[timeframeRef.current] ?? 4;
    let total = Math.max(90, Math.min(700, Math.round(width / pitch)));
    /* A live-only tape can be minutes old — twenty quarter-bars against a 300-slot window rendered as a sliver at
       the left edge of 46 minutes of runway (measured on the first 15s pane). */
    total = Math.min(total, Math.max(Math.ceil(len / HISTORY_SHARE) + 8, 48));
    const history = Math.round(total * HISTORY_SHARE);
    const ahead = total - history;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, len - history), to: len + ahead });
  }, []);

  /* Re-fit when the pane changes width `showRecent` splits the visible span 64% history / 36% runway, and it ran
     only on mount, on a ticker/timeframe/theme change, and on a double-click reset. Nothing watched the container. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    /* The Weigher opts out: a wider pane keeps its bar spacing and simply shows more history. Terrain and Pulse keep
       the re-fit. */
    if (keepView) return;
    let lastWidth = el.clientWidth;
    let raf = 0;
    const obs = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (!w) return; // a pane being torn down reports 0 — re-fitting to it is meaningless
      widthRef.current = w;
      // 2%: a layout change is a third of the width or more; this is well clear of sub-pixel reflow noise without
      // needing to guess at a pixel count.
      if (Math.abs(w - lastWidth) < lastWidth * 0.02) return;
      lastWidth = w;
      // Coalesce: a drag fires this every frame, and setVisibleLogicalRange mid-drag would fight the browser's own
      // layout.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (chartRef.current) showRecent();
      });
    });
    obs.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [showRecent, keepView]);

  /* Hold still while the frame glides: resizing on every frame of the sidebar's 300ms glide re-allocated three
     canvases and redrew the tape each frame (35–50ms a frame with two charts). */
  useEffect(
    () =>
      onGlide(
        () => {
          const el = containerRef.current;
          if (!el) return;
          el.style.width = `${promisedWidth(el) ?? el.clientWidth}px`;
          el.style.left = 'auto';
        },
        () => {
          const el = containerRef.current;
          if (!el) return;
          el.style.width = '';
          el.style.left = '';
        }
      ),
    []
  );

  /* Keep enough whitespace ahead of the last bar that the time axis is labelled all the way to the right edge, at
     whatever zoom the reader is at. */
  /* The cap is a runaway guard, not a budget: barSpacing bottoms out near 0.5, so a 4K-wide plot can show ~8000 bars
     and the runway must reach them. */
  const RUNWAY_MAX = 12000;
  /** The runway grows by this many slots at a time — see ensureRunway. */
  const RUNWAY_STEP = 240;
  const ensureRunway = useCallback((lastTime: number, bucketSec: number) => {
    const chart = chartRef.current;
    const series = runwaySeriesRef.current;
    if (!chart || !series || !lastTime || bucketSec <= 0) return;

    const len = barCountRef.current;
    const range = chart.timeScale().getVisibleLogicalRange();
    const span = range ? Math.max(60, range.to - range.from) : 200;
    const reach = range ? range.to - (len - 1) : 0;
    const cur = runwayRef.current;
    /* Grown in chunks, because this runs on every visible-range change. */
    const need = Math.max(120, Math.ceil(reach + span), cur.from === lastTime ? cur.slots : 0);
    const want = Math.min(RUNWAY_MAX, Math.ceil(need / RUNWAY_STEP) * RUNWAY_STEP);
    if (cur.from === lastTime && cur.slots >= want) return;

    /* trading time ahead on a regular-session chart, so a slot is what the cone's variance runs on */
    const pts = runwaySlots(lastTime, bucketSec, want, deskSessionRef.current === 'rth').map(t => ({ time: t as UTCTimestamp }));
    series.setData(pts);
    runwayRef.current = { from: lastTime, slots: want };
  }, []);

  const resetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    showRecent();
  }, [showRecent]);

  /* The horizontal arm goes off while this chart is following another pane — a full crosshair reads as "your cursor
     is here", and it is not. */
  const setFollower = useCallback((on: boolean) => {
    if (followerRef.current === on) return;
    followerRef.current = on;
    chartRef.current?.applyOptions({
      // The wheel belongs to the page when the page is the thing that scrolls.
      handleScroll: { mouseWheel: true },
      handleScale: { mouseWheel: true },
      crosshair: { horzLine: { visible: !on, labelVisible: !on } },
    });
  }, []);

  /* The readout, built from one place. */
  const readoutAt = useCallback((idx: number | null | undefined): CrosshairBar | null => {
    const main = candleSeriesRef.current;
    if (main == null || idx == null) return null;
    /* Structural rather than by the library's data types: the main series is always handled as
       `ISeriesApi<'Candlestick'>` (see makeMain) whatever shape is really under it, so the declared return type is a */
    const d = main.dataByIndex(idx) as unknown as {
      time?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; value?: unknown;
    } | null;
    if (!d || typeof d.time !== 'number') return null;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    /* A line/step/area/baseline tape carries `value`, a candle/bar tape `close`. Either is the close; neither being
       present means there is nothing to report and the row does not render at all. */
    const close = num(d.close) ?? num(d.value);
    if (close == null) return null;
    const volSeries = volumeSeriesRef.current;
    /* Asked of the series, not of the `overlays` prop. */
    const volumeDrawn = volSeries?.options().visible !== false;
    const vol = volSeries?.dataByIndex(idx) as { value?: number } | null;
    const indicatorValues: CrosshairBar['indicators'] = [];
    for (const [id, series] of indicatorSeriesRef.current) {
      /* Map ids are `${key}:${part}`; the readout reports only the single-line overlays
         (READOUT_INDICATOR_KEYS says which and why). */
      const [key, part] = id.split(':') as [keyof ChartIndicators, string];
      if (part !== 'line' || !READOUT_INDICATOR_KEYS.has(key)) continue;
      const point = series.dataByIndex(idx) as { value?: number } | null;
      const v = num(point?.value);
      if (v != null) {
        indicatorValues.push({ key, ink: INDICATOR_INKS[key], value: v });
      }
    }
    return {
      time: d.time as UTCTimestamp,
      open: num(d.open),
      high: num(d.high),
      low: num(d.low),
      close,
      volume: volumeDrawn ? num(vol?.value) : null,
      indicators: indicatorValues,
    };
  }, []);

  /* Deduped, and that is what makes it safe to fire on model echoes. */
  const emitReadout = useCallback((bar: CrosshairBar | null) => {
    const sig = bar
      ? `${bar.time}|${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume}|${bar.indicators
          .map(i => `${i.key}:${i.value}`)
          .join(',')}`
      : '';
    if (sig === readoutSigRef.current) return;
    readoutSigRef.current = sig;
    onReadoutRef.current?.(bar);
  }, []);

  /* Mark a moment that belongs to another pane. */
  const applySync = useCallback((time: UTCTimestamp | null) => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;
    syncedRef.current = time;
    const price = lastCloseRef.current;
    /* Not a nicety: setCrosshairPosition on a series whose price scale has no first value throws. Terrain boots
       through a splash and panes reload on every ticker and timeframe change, so this window is real. */
    if (time === null || price == null) {
      chart.clearCrosshairPosition();
      setFollower(false);
      emitReadout(null);
      return;
    }
    /* This chart's bucket, floored — the bar the moment is inside of. The library's own lookup rounds UP, so a 12:07
       hover would land on a 15m neighbour's 12:15 bar: one that had not happened at 12:07. */
    const bucket = Math.max(60, tfMinutes(timeframeRef.current) * 60);
    const target = (Math.floor(time / bucket) * bucket) as UTCTimestamp;
    const ts = chart.timeScale();
    const idx = ts.timeToIndex(target, false); // exact hit or null — never nearest
    const vis = ts.getVisibleLogicalRange();
    /* Outside this chart's data, or outside what it is currently showing, draw nothing. SetCrosshairPosition clamps
       the index to the visible range and would otherwise print a confident mark on the wrong bar. */
    if (idx === null || vis === null || idx < vis.from || idx > vis.to) {
      chart.clearCrosshairPosition();
      setFollower(false);
      /* This pane has no bar at that moment, or is not showing it. It draws nothing, so it reports nothing — a
         readout beside a blank crosshair would be values with no mark to attach them to. */
      emitReadout(null);
      return;
    }
    setFollower(true);
    chart.setCrosshairPosition(price, target, series);
    /* The follower's own values, at the bar this pane resolved the moment to. `setCrosshairPosition` never fires the
       crosshair event, so the readout is emitted here. */
    emitReadout(readoutAt(idx));
  }, [setFollower, readoutAt, emitReadout]);

  /* One datum mapper for every main-series write: OHLC styles get whole bars, value styles get closes. */
  const toMain = useCallback(
    (b: Candle) =>
      (OHLC_STYLES.has(styleRef.current)
        ? toCandle(b)
        : { time: b.time as UTCTimestamp, value: b.close }) as never,
    []
  );

  // Widen the visible price range to always include the walls/supreme so several strike-node bands are on screen,
  // not just the couple around spot — and the focus strike, when one is set.
  const autoscaleProvider = useCallback(
    /* `priceRange` is nullable in the library and the annotation the partner tree still carries says it is not, so
       tsc blesses `base?.priceRange.minValue` — which throws the moment the view holds no candles at all. */
    (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
      const base = original();
      const lv = levelsRef.current;
      const extras = [lv.putWall, lv.callWall, lv.supreme, lv.spot, focusPriceRef.current ?? NaN, ...roomRef.current].filter(v =>
        Number.isFinite(v)
      );
      const range = base?.priceRange ?? null;
      // Nothing to scale by at all — let the library keep its own answer
      if (range === null && extras.length === 0) return base;
      let min = range ? range.minValue : Math.min(...extras);
      let max = range ? range.maxValue : Math.max(...extras);
      for (const v of extras) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const pad = Math.max((max - min) * 0.08, 0.01);
      /* No pixel margin for the chrome here: the scale's own 20% top margin already lands the highest wall ~130px
         under a 36px strip at rest; a hand-scaled tape is handled by the strike chips' clamp. */
      return { priceRange: { minValue: min - pad, maxValue: max + pad } };
    },
    []
  );

  /* The chrome band, measured: on mount, when this box resizes, and when a chrome block over it changes size (the
     strip wraps to a second row). */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const watched = new Set<Element>();
    const chromeObs = new ResizeObserver(() => schedule());
    const measure = () => {
      const box = el.getBoundingClientRect();
      if (box.height === 0) return;
      setBoxH(h => (h === Math.round(box.height) ? h : Math.round(box.height)));
      let low = 0;
      document.querySelectorAll<HTMLElement>('[data-chart-chrome]').forEach(c => {
        const r = c.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const overlaps = r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.top + box.height / 3;
        if (!overlaps) return;
        low = Math.max(low, r.bottom - box.top);
        if (!watched.has(c)) {
          watched.add(c);
          chromeObs.observe(c);
        }
      });
      const inset = Math.round(low);
      const mark = el.querySelector('#tv-attr-logo');
      const mr = mark?.getBoundingClientRect();
      if (mr && mr.height > 0) setMarkClear(Math.round(box.bottom - mr.top));
      if (inset === chromeInsetRef.current) return;
      chromeInsetRef.current = inset;
      setChromeInset(inset);
      const trails = trailsRef.current;
      if (trails) {
        trails.chromeInset = inset;
        trails.requestUpdate?.();
      }
      /* the levels' words sit under the floating chrome too */
      const ladder = ladderRef.current;
      if (ladder) {
        ladder.chromeInset = inset;
        ladder.requestUpdate?.();
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const obs = new ResizeObserver(schedule);
    obs.observe(el);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      chromeObs.disconnect();
    };
  }, [autoscaleProvider]);

  /* Build the main series for a style. Always returned as the nominal 'Candlestick' handle — every consumer routes
     data through toMain and hangs price lines, which every series type supports. */
  const makeMain = useCallback(
    (chart: IChartApi, style: ChartStyle, t: CandleTheme): ISeriesApi<'Candlestick'> => {
      const base = {
        priceLineVisible: true,
        priceLineColor: 'rgba(237,237,237,0.4)',
        priceLineStyle: LineStyle.Dotted,
        autoscaleInfoProvider: autoscaleProvider,
      };
      let s: ISeriesApi<SeriesType>;
      switch (style) {
        case 'hollow': {
          // Up bodies filled with the surface = hollow; down bodies solid
          const surface = chartSurface(t).bg;
          s = chart.addSeries(CandlestickSeries, {
            ...candleSeriesOptions(t),
            upColor: surface === 'transparent' ? 'rgba(0,0,0,0)' : surface,
            borderUpColor: t.borderUp ?? t.up,
            wickUpColor: t.wickUp,
            ...base,
          });
          break;
        }
        case 'bars':
          s = chart.addSeries(BarSeries, { upColor: t.up, downColor: t.down, thinBars: false, ...base });
          break;
        case 'line':
          s = chart.addSeries(LineSeries, { color: t.up, lineWidth: 2, ...base });
          break;
        case 'step':
          s = chart.addSeries(LineSeries, { color: t.up, lineWidth: 2, lineType: LineType.WithSteps, ...base });
          break;
        case 'area':
          s = chart.addSeries(AreaSeries, {
            lineColor: t.up,
            lineWidth: 2,
            topColor: `${t.up}40`,
            bottomColor: `${t.up}05`,
            ...base,
          });
          break;
        case 'baseline':
          // Above/below the session open IS a price-direction read → the house bull/bear pair (the one style allowed
          // to speak it)
          s = chart.addSeries(BaselineSeries, {
            topLineColor: '#30D158',
            topFillColor1: 'rgba(48,209,88,0.20)',
            topFillColor2: 'rgba(48,209,88,0.02)',
            bottomLineColor: '#FF3B30',
            bottomFillColor1: 'rgba(255,59,48,0.02)',
            bottomFillColor2: 'rgba(255,59,48,0.20)',
            lineWidth: 2,
            ...base,
          });
          break;
        default:
          s = chart.addSeries(CandlestickSeries, { ...candleSeriesOptions(t), ...base });
      }
      return s as ISeriesApi<'Candlestick'>;
    },
    [autoscaleProvider]
  );

  // Mount once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const s0 = chartSurface(themeRef.current);
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: s0.bg },
        // #7d7d7d on the dark family; its dark cut on a light ground (chartSurface)
        textColor: s0.text,
        fontFamily: "'Inter', sans-serif",
        // 9 on a phone. Lightweight-charts sizes the price gutter from its widest label, so this is what actually
        // buys the tape its width back.
        fontSize: compactRef.current ? 9 : 10,
        attributionLogo: true,
      },
      // The reader's clock, not Greenwich's — see chartTime.ts.
      localization: tapeRef.current?.clock === 'ny' ? NY_TIME : LOCAL_TIME,
      // No grid: the nodes and the levels are the structure; a grid behind them competes with the ribbons
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      // The live-price capsule replaces the series' own last-value label and takes the axis's measured width (the
      // priceTag element below) — the axis itself is as wide as its figures; it used to be held open at 74 for a…
      rightPriceScale: { borderColor: s0.line, minimumWidth: 0 },
      timeScale: { borderColor: s0.line, timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 6, minBarSpacing: 0.5, tickMarkFormatter: tapeRef.current?.clock === 'ny' ? nyTickMarks : localTickMarks },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
        horzLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
      },
    });

    const candles = makeMain(chart, styleRef.current, themeRef.current);
    styleBuiltRef.current = styleRef.current;

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    /* Its own price scale, so an empty series cannot drag the tape's autoscale around, and every visible affordance
       off. */
    const runway = chart.addSeries(LineSeries, {
      priceScaleId: 'runway',
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    const trails = new GexTrailsPrimitive();
    trails.chromeInset = chromeInsetRef.current;
    trails.hoverOverlay = true;
    trails.afterDraw = () => drawHoverRef.current();
    trails.onData = ref => setTrailRef(ref);
    candles.attachPrimitive(trails);
    /* The key levels' ladder ends each wall's rung at the field's strike chip, so it is attached after the trails to
       draw after them in the same frame. */
    const ladder = new KeyLevelsPrimitive();
    ladder.chips = () => trails.chips;
    candles.attachPrimitive(ladder);
    /* Dev only: the perf probes read each chart's visible range and loaded bar count off `window.__charts` (the axis
       is canvas, not DOM). */
    const devCharts = import.meta.env?.DEV ? ((window as unknown as { __charts?: Set<unknown> }).__charts ??= new Set()) : null;
    const devEntry = {
      chart,
      candles,
      host: container,
      state: () => ({ held: recentHeldRef.current, full: fullWorldRef.current, world: worldKeyRef.current }),
    };
    devCharts?.add(devEntry);
    const drawingsPrim = new DrawingsPrimitive();
    candles.attachPrimitive(drawingsPrim);
    /* The session rules. Attached with the series like the two above, so it lives as long as the chart does; what it
       draws is swapped by the session effect. */
    const sessionPrim = new SessionLevelsPrimitive();
    candles.attachPrimitive(sessionPrim);

    /* The cone, run exactly the same way. */
    const conePrim = new ExpectedMovePrimitive();
    candles.attachPrimitive(conePrim);

    /* The event lane. */
    const eventsPrim = new EventsPrimitive();
    candles.attachPrimitive(eventsPrim);

    /* Zooming out reaches past the runway's end; extend it as they go. The handler reads refs rather than closing
       over the bar time, so it is installed once with the chart and never re-subscribed. */
    let stamped = 0;
    const onRange = () => {
      if (keepViewRef.current) {
        const now = performance.now();
        if (now - stamped > 400) {
          stamped = now;
          const w = loadedRef.current;
          const ts = chart.timeScale();
          rememberView(`${w.ticker}|${w.timeframe}|${w.clock}`, {
            barSpacing: ts.options().barSpacing,
            rightOffset: ts.options().rightOffset ?? 10,
            scroll: ts.scrollPosition(),
          });
        }
      }
      ensureRunway(lastBarTimeRef.current, bucketSecRef.current);
      /* The history arrives when the reader scrolls to it: only the recent bars are loaded on open; reaching the
         left edge of them asks for the whole store, once per world. */
      if (recentHeldRef.current) {
        const r = chart.timeScale().getVisibleLogicalRange();
        if (r && r.from < FULL_TRIGGER && r.to - r.from > 10) {
          recentHeldRef.current = false;
          fullWorldRef.current = worldKeyRef.current;
          setFullNonce(n => n + 1);
        }
      }
      /* A synthetic crosshair is anchored to a pixel, not to a time: the model re-derives its bar from the saved x
         on the next update, so panning this pane slides someone else's mark onto a different bar without a word. */
      if (syncedRef.current !== null) applySync(syncedRef.current);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    /* Hover, out — and only real hover. */
    const onCross = (param: MouseEventParams<Time>) => {
      if (!param.point) {              // the pointer left the plot
        onCrosshairRef.current?.(null);
        emitReadout(null);
        return;
      }
      /* The echo filter applies to the sync, not to the readout. It used to be a bare early return, which was right
         while the moment was the only thing this handler produced. */
      if (param.sourceEvent) {
        syncedRef.current = null;
        setFollower(false);
        const series = candleSeriesRef.current;
        const price = series ? series.coordinateToPrice(param.point.y) : null;
        const lv = levelsRef.current;
        let snapped: number | null = null;
        if (series && price != null && Number.isFinite(price)) {
          const y2 = series.priceToCoordinate(price + 1);
          const pxPerDollar = y2 == null ? 0 : Math.abs(param.point.y - y2);
          const rungs = [lv.callWall, lv.putWall, lv.flip, lv.supreme].filter(v => v > 0);
          let bestD = 4;
          for (const rung of rungs) {
            const dPx = Math.abs(rung - price) * pxPerDollar;
            if (pxPerDollar > 0 && dPx < bestD) { snapped = rung; bestD = dPx; }
          }
          if (snapped != null && typeof param.time === 'number') chart.setCrosshairPosition(snapped, param.time as UTCTimestamp, series);
        }
        onCrosshairRef.current?.(typeof param.time === 'number' ? (param.time as UTCTimestamp) : null);
      }
      emitReadout(readoutAt(param.logical));
    };
    chart.subscribeCrosshairMove(onCross);
    syncRegisterRef.current?.(applySync);
    snapshotRegisterRef.current?.(() => chartRef.current?.takeScreenshot() ?? null);

    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;
    /* Dev-only handle for the house probes (scripts/*-proof.mjs read the visible range through it to catch a tick
       fighting a drag). Stripped from production builds by the env guard. */
    if (import.meta.env.DEV) {
      const dev = container as unknown as { __chart?: IChartApi; __series?: unknown };
      dev.__chart = chart;
      dev.__series = candles; // the probes read the visible PRICE range through it
    }
    runwaySeriesRef.current = runway;
    trailsRef.current = trails;
    ladderRef.current = ladder;
    drawingsRef.current = drawingsPrim;
    sessionPrimRef.current = sessionPrim;
    conePrimRef.current = conePrim;
    eventsPrimRef.current = eventsPrim;

    /* Reads candleSeriesRef rather than closing over `candles`: the style swap removes and replaces the main series
       in place, and a captured series would leave the neighbour projecting against a dead one. */
    if (projectionRef) {
      projectionRef.current = {
        yFor: price => candleSeriesRef.current?.priceToCoordinate(price) ?? null,
        plotHeight: () => chart.paneSize(0).height,
        axisHeight: () => chart.timeScale().height(),
      };
    }

    /* The exporter. TakeScreenshot captures every canvas layer the pane draws — candles, levels, drawings, the cone,
       the event lane — at device resolution. */
    if (exportRef) {
      exportRef.current = () => {
        const c = chartRef.current;
        if (!c) return;
        const shot = c.takeScreenshot();
        const scale = Math.max(1, Math.round(shot.width / Math.max(1, containerRef.current?.clientWidth ?? shot.width)));
        const pad = 30 * scale;
        const out = document.createElement('canvas');
        out.width = shot.width;
        out.height = shot.height + pad;
        const g = out.getContext('2d');
        if (!g) return;
        g.fillStyle = '#0a0a0a';
        g.fillRect(0, 0, out.width, out.height);
        const stampIso = new Date().toISOString();
        const stamp = `${stampIso.slice(0, 10)} ${stampIso.slice(11, 16)}Z`;
        g.font = `600 ${11 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillText(`${ticker} · ${timeframeRef.current}`, 10 * scale, pad / 2);
        const right = `${stamp} · SLAYER TERMINAL`;
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillText(right, out.width - g.measureText(right).width - 10 * scale, pad / 2);
        g.drawImage(shot, 0, pad);
        /* The in-plot watermark — faint, corner, the free distribution the directive wants from every shared
           screenshot. */
        g.font = `600 ${10 * scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillText('slayer_terminal', 10 * scale, out.height - 12 * scale);
        out.toBlob(blob => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${ticker}-${timeframeRef.current}-${stampIso.slice(0, 16).replace(/[-T:]/g, '')}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        });
      };
    }

    /* The frame belongs to the user after first touch. The library only suspends price autoscale on an axis drag; a
       wheel zoom or a pan keeps it on, so every 1s tick re-fit the price scale and undid the reader's hand. */
    /* applyOptions re-lays the whole chart, so only the first wheel or press of a gesture pays it */
    const freezeScale = () => {
      const ps = chart.priceScale('right');
      if (ps.options().autoScale) ps.applyOptions({ autoScale: false });
    };
    container.addEventListener('wheel', freezeScale, { passive: true });
    container.addEventListener('pointerdown', freezeScale);

    return () => {
      /* Remember the view before this instance dies (the Weigher's fullscreen portal is a remount); spacing and
         scroll, not the logical range, so a wider pane shows more bars. */
      if (keepViewRef.current) {
        const w = loadedRef.current;
        const ts = chart.timeScale();
        rememberView(`${w.ticker}|${w.timeframe}|${w.clock}`, {
          barSpacing: ts.options().barSpacing,
          rightOffset: ts.options().rightOffset ?? 10,
          scroll: ts.scrollPosition(),
        });
      }
      container.removeEventListener('wheel', freezeScale);
      container.removeEventListener('pointerdown', freezeScale);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onCross);
      devCharts?.delete(devEntry);
      syncRegisterRef.current?.(null);
      snapshotRegisterRef.current?.(null);
      syncedRef.current = null;
      if (projectionRef) projectionRef.current = null;
      if (exportRef) exportRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      flowCallsRef.current = null;
      flowPutsRef.current = null;
      driftCallsRef.current = null;
      driftPutsRef.current = null;
      rvRef.current = null;
      ivRef.current = null;
      runwaySeriesRef.current = null;
      runwayRef.current = { from: 0, slots: 0 };
      trailsRef.current = null;
      ladderRef.current = null;
      drawingsRef.current = null;
      sessionPrimRef.current = null;
      conePrimRef.current = null;
      eventsPrimRef.current = null;
      compareSeriesRef.current.clear();
      compareLoadedRef.current = '';
      indicatorSeriesRef.current.clear();
      indicatorLoadedRef.current = '';
      styleBuiltRef.current = null;
      printLinesRef.current = [];
      shownLevelsRef.current = null;
      cancelAnimationFrame(levelRafRef.current);
      loadedRef.current = { ticker: '', timeframe: '1m', theme: '', clock: 'time', full: false };
    };
    // EnsureRunway and applySync are stable useCallback([])s — listed so the subscriptions installed here are never
    // reading a stale one.
  }, [makeMain, ensureRunway, applySync, setFollower, projectionRef, readoutAt, emitReadout]);

  /* Style swap: replace only the main series in place — price lines and primitives die with the old one, so the
     nonce tells the level/focus/print/data effects to re-hang everything on the new series. */
  useEffect(() => {
    const chart = chartRef.current;
    const prev = candleSeriesRef.current;
    if (!chart || !prev) return;
    if (styleBuiltRef.current === chartStyle) return;
    const trails = trailsRef.current;
    const ladder = ladderRef.current;
    const drawingsPrim = drawingsRef.current;
    const sessionPrim = sessionPrimRef.current;
    const conePrim = conePrimRef.current;
    chart.removeSeries(prev);
    const next = makeMain(chart, chartStyle, themeRef.current);
    if (trails) next.attachPrimitive(trails);
    if (ladder) next.attachPrimitive(ladder);
    if (drawingsPrim) next.attachPrimitive(drawingsPrim);
    /* Primitives hang on the series, not the chart, so a style swap must re-attach them or the session rules silently
       vanish. */
    if (sessionPrim) next.attachPrimitive(sessionPrim);
    if (conePrim) next.attachPrimitive(conePrim);
    if (eventsPrimRef.current) next.attachPrimitive(eventsPrimRef.current);
    candleSeriesRef.current = next;
    styleBuiltRef.current = chartStyle;
    shownLevelsRef.current = null;
    focusLineRef.current = null;
    printLinesRef.current = [];
    /* Force the data effect to re-setData onto the new series, but only by blanking the theme: a style swap is a
       redraw, not a new world. */
    loadedRef.current = { ...loadedRef.current, theme: '' };
    setMainNonce(n => n + 1);
  }, [chartStyle, makeMain]);

  // Volume overlay toggle — series stays mounted, just hides
  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: overlays.volume });
  }, [overlays.volume]);

  /* The last pane any product occupies, or 0 when none of them are open. Three optional panes open and close in any
     order, so "the pane below the products" cannot be a constant and cannot be read off any one of them. */
  const lastProductPaneIndex = useCallback(() => {
    let deepest = 0;
    for (const s of [flowCallsRef.current, driftCallsRef.current, rvRef.current] as const) {
      if (!s) continue;
      try {
        const i = s.getPane().paneIndex();
        if (Number.isFinite(i) && i > deepest) deepest = i;
      } catch {
        /* A series mid-teardown has no pane to report */
      }
    }
    return deepest;
  }, []);

  /* Where every product pane's name chip goes, measured in one pass. Each product effect calls this when it
     finishes, and it re-measures ALL of them rather than only its own — which is the point. */
  const remeasurePaneLabels = useCallback(() => {
    const chart = chartRef.current;
    const wanted: { key: string; series: ISeriesApi<'Histogram'> | ISeriesApi<'Line'> | null }[] = [
      { key: 'flow', series: flowCallsRef.current },
      { key: 'netDrift', series: driftCallsRef.current },
      { key: 'volDrift', series: rvRef.current },
    ];
    let next: { key: string; top: number }[] = [];
    if (chart) {
      try {
        const panes = chart.panes();
        const heights = panes.map(pane => pane.getHeight());
        for (const w of wanted) {
          if (!w.series) continue;
          const idx = w.series.getPane().paneIndex();
          /* Pane 0 is the tape. A product series that somehow landed there has no band of its own to label. */
          if (idx <= 0 || idx >= heights.length) continue;
          if (heights[idx] < 36) continue;
          let top = 0;
          for (let j = 0; j < idx; j++) top += heights[j];
          next.push({ key: w.key, top: top + 6 });
        }
      } catch {
        /* The chart is mid-teardown; no chips rather than a thrown render */
        next = [];
      }
    }
    setPaneLabels(prev =>
      prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.top === next[i].top)
        ? prev
        : next
    );
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const kick = () => remeasurePaneLabels();
    const onDrag = (e: PointerEvent) => {
      if (e.buttons) kick();
    };
    el.addEventListener('pointermove', onDrag);
    const ro = new ResizeObserver(kick);
    ro.observe(el);
    return () => {
      el.removeEventListener('pointermove', onDrag);
      ro.disconnect();
    };
  }, [remeasurePaneLabels, mainNonce]);

  /* The flow band: Trace's premium, in this chart's own buckets. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    /* The band is built on demand and torn down when it is off. The first cut created the pane at mount and
       collapsed it to 1px when the overlay was off. */
    if (!overlays.flow || altSpec) {
      const oldCalls = flowCallsRef.current;
      const oldPuts = flowPutsRef.current;
      /* Refs cleared before the removals, not after: removing a series can throw on a chart that is already tearing
         down, and a ref still holding a destroyed series is one the label measurer would ask for a pane. */
      flowCallsRef.current = null;
      flowPutsRef.current = null;
      try {
        if (oldCalls) chart.removeSeries(oldCalls);
        if (oldPuts) chart.removeSeries(oldPuts);
      } catch {
        /* Already gone */
      }
      remeasurePaneLabels();
      return;
    }

    let calls = flowCallsRef.current;
    let puts = flowPutsRef.current;
    if (!calls || !puts) {
      /* Appended, never a fixed index. Compare-in-pane mode may already own a pane, and hard-coding 1 is how two
         features end up in the same band. */
      const opts = {
        priceFormat: { type: 'volume' as const },
        lastValueVisible: false,
        priceLineVisible: false,
        base: 0,
      };
      const paneIndex = chart.panes().length;
      calls = chart.addSeries(HistogramSeries, opts, paneIndex);
      puts = chart.addSeries(HistogramSeries, opts, paneIndex);
      flowCallsRef.current = calls;
      flowPutsRef.current = puts;
      try {
        chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);
        const pane = calls.getPane();
        pane.setStretchFactor(FLOW_STRETCH);
        calls.priceScale().applyOptions({ scaleMargins: { top: 0.04, bottom: 0.04 }, borderVisible: false });
        calls.createPriceLine({ price: 0, color: 'rgba(237,237,237,0.28)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
      } catch {
        /* Pane sizing is a nicety; never lose the chart over it */
      }
    }

    const barSec = tfMinutes(timeframe) * 60;
    const buckets = bucketFlow(flowPrints ?? [], { barSec, ticker });
    const byTime = new Map(buckets.map(b => [b.time, b]));
    const slots = barsFor(tfMinutes(timeframe));
    const times = slots.length > 0 ? slots.map(b => b.time) : buckets.map(b => b.time);
    calls.setData(
      times.map(time => {
        const b = byTime.get(time);
        return { time: time as UTCTimestamp, value: b?.callPrem ?? 0, color: FLOW_CALL_INK };
      }),
    );
    puts.setData(
      times.map(time => {
        const b = byTime.get(time);
        return { time: time as UTCTimestamp, value: -(b?.putPrem ?? 0), color: FLOW_PUT_INK };
      }),
    );

    /* One scale across both legs, and symmetric about zero. */
    const max = flowMaxLeg(slots.length > 0
      ? slots.map(c => {
          const b = byTime.get(c.time);
          return { time: c.time, callPrem: b?.callPrem ?? 0, putPrem: b?.putPrem ?? 0, count: b?.count ?? 0 };
        })
      : buckets);
    if (max > 0) {
      const range = () => ({ priceRange: { minValue: -max, maxValue: max } });
      calls.applyOptions({ autoscaleInfoProvider: range });
      puts.applyOptions({ autoscaleInfoProvider: range });
    }

    remeasurePaneLabels();
  }, [overlays.flow, flowPrints, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec]);

  /* The net drift: the same premium the flow band bars, kept as a running total. Two lines, not a histogram, and
     they share the flow legs' inks because they are the flow legs' numbers. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    /* Built on demand and torn down when off: an always-present pane adds a separator and grows the time axis for
       every chart, including ones that never turn it on. */
    if (!overlays.netDrift || altSpec) {
      const oldCalls = driftCallsRef.current;
      const oldPuts = driftPutsRef.current;
      driftCallsRef.current = null;
      driftPutsRef.current = null;
      try {
        if (oldCalls) chart.removeSeries(oldCalls);
        if (oldPuts) chart.removeSeries(oldPuts);
      } catch {
        /* Already gone */
      }
      remeasurePaneLabels();
      return;
    }

    let calls = driftCallsRef.current;
    let puts = driftPutsRef.current;
    if (!calls || !puts) {
      /* Appended, never a fixed index — three optional panes can be open in any combination, and hard-coding one is
         how two of them end up sharing a scale that belongs to neither. */
      const paneIndex = chart.panes().length;
      const opts = {
        lineWidth: 2 as const,
        priceFormat: { type: 'volume' as const },
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      };
      calls = chart.addSeries(LineSeries, { ...opts, color: DRIFT_CALL_INK, title: 'Calls' }, paneIndex);
      puts = chart.addSeries(LineSeries, { ...opts, color: DRIFT_PUT_INK, title: 'Puts' }, paneIndex);
      driftCallsRef.current = calls;
      driftPutsRef.current = puts;
      try {
        chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);
        calls.getPane().setStretchFactor(FLOW_STRETCH);
      } catch {
        /* Pane sizing is a nicety; never lose the chart over it */
      }
    }

    const barSec = tfMinutes(timeframe) * 60;
    const points = cumulativeDrift(flowPrints ?? [], { barSec, ticker });
    calls.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: p.calls })));
    puts.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: p.puts })));

    /* One scale across both lines, anchored at zero. */
    const peak = driftPeak(points);
    if (peak > 0) {
      const range = () => ({ priceRange: { minValue: 0, maxValue: peak * 1.05 } });
      calls.applyOptions({ autoscaleInfoProvider: range });
      puts.applyOptions({ autoscaleInfoProvider: range });
    }

    remeasurePaneLabels();
  }, [overlays.netDrift, flowPrints, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec]);

  /* The volatility drift: what the underlying is doing against what the option market says it expects. Realised is
     measured from the same aggregated bars the tape draws, so the two agree on every timeframe. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    /* Frozen during replay, like the compares and the indicators: the vol lines are computed off live bars, and
       letting them run forward while the tape is rewound would put two different clocks in one window. */
    if (replayRef.current) return;

    if (!overlays.volDrift || altSpec) {
      const oldRv = rvRef.current;
      const oldIv = ivRef.current;
      rvRef.current = null;
      ivRef.current = null;
      try {
        if (oldRv) chart.removeSeries(oldRv);
        if (oldIv) chart.removeSeries(oldIv);
      } catch {
        /* Already gone */
      }
      remeasurePaneLabels();
      return;
    }

    let rv = rvRef.current;
    let iv = ivRef.current;
    if (!rv || !iv) {
      const paneIndex = chart.panes().length;
      const opts = {
        lineWidth: 1 as const,
        priceFormat: { type: 'custom' as const, formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      };
      rv = chart.addSeries(LineSeries, { ...opts, color: RV_INK, title: 'RV' }, paneIndex);
      iv = chart.addSeries(LineSeries, { ...opts, color: IV_INK, title: 'IV' }, paneIndex);
      rvRef.current = rv;
      ivRef.current = iv;
      try {
        chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);
        rv.getPane().setStretchFactor(FLOW_STRETCH);
      } catch {
        /* Pane sizing is a nicety; never lose the chart over it */
      }
    }

    const mins = tfMinutes(timeframe);
    const bars = barsFor(mins);
    const rvPoints = realizedVol(bars, mins * 60);
    /* The implied line is drawn only where realised is, so the pane never shows a lone flat line hanging over an
       empty half — the two are read as a pair, and a spread against nothing is not a spread. */
    const ivPoints = impliedVolLine(nameIv(), rvPoints);
    rv.setData(rvPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
    iv.setData(ivPoints.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));

    /* One scale, from zero. */
    const ceiling = volCeiling(rvPoints, ivPoints);
    if (ceiling > 0) {
      const range = () => ({ priceRange: { minValue: 0, maxValue: ceiling } });
      rv.applyOptions({ autoscaleInfoProvider: range });
      iv.applyOptions({ autoscaleInfoProvider: range });
    }

    remeasurePaneLabels();
  }, [overlays.volDrift, revision, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec]);

  /* Indicators are computed from the same aggregated bars the tape draws (data/indicators.ts), so nothing
     summarising them can disagree. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (replayRef.current) return; // frozen during replay, like compares
    const mins = tfMinutes(timeframe);
    const allKeys = Object.keys(INDICATOR_PARTS) as (keyof ChartIndicators)[];
    const subsActive = SUB_PANE_ORDER.filter(k => indicators[k]).slice(0, MAX_SUB_PANES);
    /* On a rule clock the session-anchored pair is out: vwapSeries cuts sessions by comparing bar gaps against the
       bar interval, and rule bars have no interval — it would cut sessions mid-day and draw a VWAP of nothing. */
    const active = allKeys.filter(k => indicators[k] && (INDICATOR_PARTS[k].pane === 'overlay' || subsActive.includes(k)))
      .filter(k => !(altSpec && (k === 'vwap' || k === 'vwapBands')));
    const paneCompareOn = compares.some(c => c.mode === 'pane');
    const subBase = paneCompareOn ? 2 : 1;
    const full = fullWorldRef.current === `${ticker}|${timeframe}|${barClock}`;
    const sig = `${ticker}|${timeframe}|${barClock}|${active.join(',')}|${subBase}|${mainNonce}|${full ? 'full' : 'recent'}`;
    const rebuild = indicatorLoadedRef.current !== sig;
    if (rebuild) {
      for (const s of indicatorSeriesRef.current.values()) {
        try {
          chart.removeSeries(s);
        } catch {
          /* Chart already torn down */
        }
      }
      indicatorSeriesRef.current.clear();
      for (const key of active) {
        const spec = INDICATOR_PARTS[key];
        const paneIndex = spec.pane === 'overlay' ? 0 : subBase + subsActive.indexOf(key);
        for (const part of spec.parts) {
          const series =
            part.kind === 'hist'
              ? /* a histogram part prints its value on its pane's axis too */
                chart.addSeries(HistogramSeries, { color: part.ink, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, paneIndex)
              : chart.addSeries(
                  LineSeries,
                  {
                    color: part.ink,
                    lineWidth: 1,
                    lineStyle: part.dashed ? 2 : 0,
                    ...(part.faint ? { color: part.ink + '99' } : {}),
                    ...(spec.pane === 'overlay' ? { priceScaleId: 'right' } : {}),
                    priceLineVisible: false,
                    /* Every line prints its last value on its axis in its own ink; MACD's signal alone stays quiet. */
                    lastValueVisible: part.part !== 'signal',
                    crosshairMarkerVisible: false,
                  },
                  paneIndex
                );
          indicatorSeriesRef.current.set(`${key}:${part.part}`, series);
          /* The RSI pane's 30/70 rails — the two numbers the oscillator is read against, drawn once with the series.
             Unlabelled on the axis; the levels are the pane's grammar, not its data. */
          if (key === 'rsi' && part.part === 'line') {
            for (const lvl of [30, 70]) {
              (series as ISeriesApi<'Line'>).createPriceLine({
                price: lvl,
                color: 'rgba(226,234,244,0.25)',
                lineWidth: 1,
                lineStyle: 3,
                axisLabelVisible: false,
                title: '',
              });
            }
          }
        }
      }
      /* Two thirds to the tape, the rest split — only while subs exist. */
      if (subsActive.length > 0) {
        const panes = chart.panes();
        panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 64 : Math.max(10, 36 / (panes.length - 1))));
      }
      indicatorLoadedRef.current = sig;
    }
    if (active.length === 0) return;
    /* The same window as the candles — a line that ran further left than the tape would widen the time scale and
       throw showRecent's arithmetic */
    const bars = windowOf(barsFor(mins, altSpec), full);
    if (bars.length === 0) return;
    /* The formulas live in data/indicators.ts — one copy, shared with the confluence strip and every other
       summariser (the walls' lesson). This maps numbers onto series points and owns nothing else. */
    const seriesFor = (key: keyof ChartIndicators): Record<string, (number | null)[]> => {
      switch (key) {
        case 'vwap':
          return { line: vwapSeries(bars, mins) };
        case 'bb': {
          const b = bollingerSeries(bars, 20, 2);
          return { basis: b.basis, upper: b.upper, lower: b.lower };
        }
        case 'vwapBands': {
          const vw = vwapSeries(bars, mins);
          const sg = vwapSigmaSeries(bars, mins);
          const band = (k: number) => vw.map((v, i) => (sg[i] === null ? null : v + k * (sg[i] as number)));
          return { up1: band(1), dn1: band(-1), up2: band(2), dn2: band(-2) };
        }
        case 'sma':
          return { line: smaSeries(bars, 200) };
        case 'rsi':
          return { line: rsiSeries(bars, 14) };
        case 'macd': {
          const m = macdSeries(bars, 12, 26, 9);
          return { line: m.macd, signal: m.signal, hist: m.hist };
        }
        case 'atrPane':
          return { line: atrBarSeries(bars, 14) };
        case 'flowVwap':
        case 'sideVwap': {
          const sec = (at: number) => (at > 1e12 ? Math.floor(at / 1000) : at);
          const flow = (flowPrints ?? []).map(p => ({ time: sec(p.at), callPrem: p.right === 'C' ? p.premium : 0, putPrem: p.right === 'P' ? p.premium : 0 }));
          if (key === 'sideVwap') {
            const sides = alignSides(bars, flow, mins * 60);
            return { call: flowVwapSeries(bars, mins, sides.call), put: flowVwapSeries(bars, mins, sides.put) };
          }
          return { line: flowVwapSeries(bars, mins, alignPremium(bars, flow, mins * 60)) };
        }
        case 'gammaEma': {
          const gamma = alignGamma(bars, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
          return { line: gammaEmaSeries(bars, gamma) };
        }
        case 'gammaVwap': {
          const gamma = alignGamma(bars, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
          return { line: gammaVwapSeries(bars, mins, gamma) };
        }
        default:
          return { line: emaSeries(bars, key === 'ema9' ? 9 : key === 'ema21' ? 21 : 50) };
      }
    };
    for (const key of active) {
      const values = seriesFor(key);
      for (const [part, vals] of Object.entries(values)) {
        const s = indicatorSeriesRef.current.get(`${key}:${part}`);
        if (!s) continue;
        const pts = bars.map((b, i) =>
          vals[i] === null ? { time: b.time as UTCTimestamp } : { time: b.time as UTCTimestamp, value: vals[i] as number }
        );
        /* Same completed-bar rule as the candles: update cannot rewrite an older time, so a rule-clock pass that
           changed the bar count reloads the series instead. */
        if (rebuild || (altSpec && indAltCountRef.current !== bars.length)) s.setData(pts);
        else s.update(pts[pts.length - 1]);
      }
    }
    indAltCountRef.current = bars.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, ticker, revision, timeframe, mainNonce, compares, altSpec, barClock, fullNonce, flowPrints, bookMinutes]);

  /* The scripts on this pane — the Pine runtime. */
  useEffect(() => {
    const chart = chartRef.current;
    const handles = scriptHandlesRef.current;
    const tearDown = () => {
      for (const h of handles.values()) h.destroy();
      handles.clear();
      scriptSigRef.current = '';
    };
    if (!chart || !paneId) {
      tearDown();
      return;
    }
    if (replayRef.current) return;
    const mins = tfMinutes(timeframe);
    const full = fullWorldRef.current === `${ticker}|${timeframe}|${barClock}`;
    const bars = windowOf(barsFor(mins, altSpec), full).map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    setPaneBars(paneId, bars, ticker, String(timeframe));
    if (bars.length === 0) {
      tearDown();
      return;
    }
    const subsActive = SUB_PANE_ORDER.filter(k => indicators?.[k]).slice(0, MAX_SUB_PANES);
    const paneCompareOn = compares.some(c => c.mode === 'pane');
    const subBase = paneCompareOn ? 2 : 1;
    const live = paneScripts.filter(p => p.chart.visible && p.script.status === 'ok');
    const sig = `${ticker}|${timeframe}|${barClock}|${full ? 'full' : 'recent'}|${mainNonce}|${subBase}|${subsActive.join(',')}|${live.map(p => `${p.chart.id}:${p.script.sourceHash}:${JSON.stringify(p.chart.inputs)}`).join(';')}`;
    const rebuild = scriptSigRef.current !== sig;
    if (rebuild) tearDown();
    const slayer = { callWall: levels.callWall, putWall: levels.putWall, flip: levels.flip, supreme: levels.supreme };
    let ownPanes = 0;
    for (const ps of live) {
      const own = ps.script.meta?.pane === 'own';
      if (own && subsActive.length + ownPanes >= MAX_SUB_PANES) continue;
      let compiled = compiledRef.current.get(ps.script.sourceHash);
      if (!compiled) {
        try {
          compiled = compile(ps.script.source);
          compiledRef.current.set(ps.script.sourceHash, compiled);
        } catch {
          continue;
        }
      }
      let result;
      try {
        result = runScript(compiled, bars, { inputs: ps.chart.inputs, ticker, timeframe: String(timeframe), slayer });
      } catch (e) {
        if (rebuild) console.warn(`[scripts] ${ps.script.title}: ${explain(e).message}`);
        continue;
      }
      const have = handles.get(ps.chart.id);
      if (have && have.update(result, bars)) {
        if (own) ownPanes++;
        continue;
      }
      if (have) {
        have.destroy();
        handles.delete(ps.chart.id);
      }
      const paneIndex = own ? subBase + subsActive.length + ownPanes++ : 0;
      handles.set(ps.chart.id, drawRun(chart, result, bars, paneIndex));
    }
    if (rebuild && subsActive.length + ownPanes > 0) {
      const panes = chart.panes();
      panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 64 : Math.max(10, 36 / (panes.length - 1))));
    }
    scriptSigRef.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, paneScripts, indicators, ticker, revision, timeframe, mainNonce, compares, altSpec, barClock, fullNonce, levels]);

  /* The handles go with the chart */
  useEffect(
    () => () => {
      for (const h of scriptHandlesRef.current.values()) h.destroy();
      scriptHandlesRef.current.clear();
    },
    []
  );

  /* Compare lines. Rebuilt when the roster/timeframe/ticker changes, ticked per revision otherwise — the same full-
     load/incremental split the candles use. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (replayRef.current) return; // replay owns the tape; compares freeze
    const mins = tfMinutes(timeframe);
    const full = fullWorldRef.current === `${ticker}|${timeframe}|${barClock}`;
    const sig = `${ticker}|${timeframe}|${compares.map(c => `${c.ticker}:${c.mode}:${c.ink}`).join(',')}|${full ? 'full' : 'recent'}`;
    const rebuild = compareLoadedRef.current !== sig;
    if (rebuild) {
      for (const s of compareSeriesRef.current.values()) {
        try {
          chart.removeSeries(s);
        } catch {
          /* Chart already torn down */
        }
      }
      compareSeriesRef.current.clear();
      for (const c of compares) {
        ensureBook(c.ticker, 'board');
        const series = chart.addSeries(
          LineSeries,
          {
            color: c.ink,
            lineWidth: 2,
            priceScaleId: c.mode === 'scale' ? 'left' : 'right',
            priceLineVisible: false,
            lastValueVisible: true,
            title: c.ticker,
          },
          /* Below every product pane that is open, not below the flow band alone. */
          c.mode === 'pane' ? lastProductPaneIndex() + 1 : 0
        );
        compareSeriesRef.current.set(`${c.ticker}:${c.mode}`, series);
      }
      /* The mode is not set here any more — it is the reader's choice now, so it moved to its own effect below,
         which watches both inputs. */
      chart.applyOptions({
        leftPriceScale: { visible: compares.some(c => c.mode === 'scale'), borderColor: chartSurface(themeRef.current).line },
      });
      // TV proportions: the tape keeps ~3/4 of the window, the compare pane rides below at ~1/4 (lightweight-charts
      // defaults to an even split)
      const panes = chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
      }
      compareLoadedRef.current = sig;
    }
    for (const c of compares) {
      const s = compareSeriesRef.current.get(`${c.ticker}:${c.mode}`);
      if (!s) continue;
      const bars = windowOf(displayBars(c.ticker, mins), full);
      if (bars.length === 0) continue;
      if (rebuild) {
        s.setData(bars.map(b => ({ time: b.time as UTCTimestamp, value: b.close })));
      } else {
        const last = bars[bars.length - 1];
        s.update({ time: last.time as UTCTimestamp, value: last.close });
      }
    }
  }, [compares, ticker, revision, timeframe, barClock, fullNonce]);

  /* The main scale's mode, and it is its own effect on purpose. It used to be one line inside the compare effect
     above, keyed on the compare signature. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    /* Only when the mode actually changes. Re-applying the mode, even the same mode, makes the library snap a
       manually-scaled price range back to its pre-drag range. */
    chart.priceScale('right').applyOptions({ mode: PRICE_SCALE_MODE[scaleMode] });
  }, [scaleMode, mainNonce]);

  // Recolor the candle series and the chart surface in place when the theme picker changes — gallery themes carry
  // their own background tint.
  useEffect(() => {
    const t = themeRef.current;
    const main = candleSeriesRef.current;
    if (main) {
      // Recolor IN the active style's vocabulary — baseline keeps its fixed bull/bear pair and needs nothing
      const style = styleRef.current;
      if (style === 'candles') main.applyOptions(candleSeriesOptions(t));
      else if (style === 'hollow') {
        const surface = chartSurface(t).bg;
        main.applyOptions({
          ...candleSeriesOptions(t),
          upColor: surface === 'transparent' ? 'rgba(0,0,0,0)' : surface,
          borderUpColor: t.borderUp ?? t.up,
          wickUpColor: t.wickUp,
        });
      } else if (style === 'bars') (main as unknown as ISeriesApi<'Bar'>).applyOptions({ upColor: t.up, downColor: t.down });
      else if (style === 'line' || style === 'step') (main as unknown as ISeriesApi<'Line'>).applyOptions({ color: t.up });
      else if (style === 'area')
        (main as unknown as ISeriesApi<'Area'>).applyOptions({ lineColor: t.up, topColor: `${t.up}40`, bottomColor: `${t.up}05` });
    }
    /* The frame's inks ride the theme too: a light ground takes the dark axis ink, scale borders and crosshair. */
    const s = chartSurface(t);
    chartRef.current?.applyOptions({
      layout: { background: { color: s.bg }, textColor: s.text },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: s.line },
      leftPriceScale: { borderColor: s.line },
      timeScale: { borderColor: s.line },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: s.crosshair, labelBackgroundColor: s.label },
        horzLine: { color: s.crosshair, labelBackgroundColor: s.label },
      },
    });
  }, [themeKey, appTheme, mainNonce]);

  /* A host's tape may be priced finer or coarser than cents — and a style swap makes a new series, which forgets */
  const tapeDecimals = tape?.precision?.decimals;
  const tapeTick = tape?.precision?.tick;
  useEffect(() => {
    if (tapeDecimals == null || tapeTick == null) return;
    candleSeriesRef.current?.applyOptions({ priceFormat: { type: 'price', precision: tapeDecimals, minMove: tapeTick } });
  }, [tapeDecimals, tapeTick, mainNonce]);

  // Candle data + trails: full load on ticker/timeframe/theme change, incremental per tick (theme forces a reload
  // because volume bars carry per-bar colors)
  useEffect(() => {
    if (replayRef.current) return; // replay owns the series while active
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const trails = trailsRef.current;
    if (!chart || !candleSeries || !volumeSeries || !trails) return;

    const base = baseBars();
    if (!tapeRef.current) {
      const note = !thetaBars() ? deskTape(ticker, session).note : thetaChartNote(ticker, tfMinutes(timeframe), session);
      setSessionNote(prev => (prev === note ? prev : note));
    } else {
      /* a host's tape that is kept or offline says so over its bars */
      const note = tapeRef.current.bars.length ? tapeRef.current.note ?? null : null;
      setSessionNote(prev => (prev === note ? prev : note));
    }
    if (!base || base.length === 0) {
      /* A host tape that has not answered yet is empty on purpose. Waiting on the book here left the previous
         session's candles up, which is another session wearing this one's name. */
      if (tapeRef.current) {
        candleSeries.setData([]);
        volumeSeries.setData([]);
        trails.setData([], 0, false, 60, trailsGreek);
        setQuiet(true);
        return;
      }
      if (!thetaBars()) {
        const book = peekEntry(ticker);
        if (!book || book.status === 'loading') return;
      } else if (thetaChartNote(ticker, tfMinutes(timeframe), session) == null) return;
      candleSeries.setData([]);
      volumeSeries.setData([]);
      trails.setData([], 0, false, 60, trailsGreek);
      setQuiet(true);
      return;
    }

    const theme = themeRef.current;
    const mins = tfMinutes(timeframe);
    const all = barsFor(mins, altSpec);
    /* This world's key, and whether the reader has asked for its whole history (onRange sets it); the recent window
       otherwise */
    const key = `${ticker}|${timeframe}|${barClock}|${session}`;
    worldKeyRef.current = key;
    const full = fullWorldRef.current === key;
    const bars = windowOf(all, full);
    const held = bars.length < all.length;
    barCountRef.current = bars.length;
    if (bars.length > 0) setQuiet(false);
    /* A rule clock reads the seconds tape, so it wears the chip too. A host that brought real 15-second history is
       not "live since connect" — that chip would call two days of prints a gap. */
    setLiveFrom(!tapeRef.current?.native && !thetaBars() && (altSpec || mins < 1) ? bars[0]?.time ?? 0 : null);
    drawingsRef.current?.setBars(bars);
    /* The measure counts bars and annualizes off them, so the layer has to know what a bar is worth here — set
       beside the times it belongs with, so a timeframe change can never move one without the other. */
    drawingsRef.current?.setBarMinutes(altSpec ? 0 : mins);
    /* The rulers ride the same load — one ATR fold per data pass, so the measure box and the flip strip cannot
       disagree about the day's range. */
    drawingsRef.current?.setDistanceScales({
      atr: sessionAtr(base),
      /* The vendor's implied move first — the one expected move the pages share (uwBook peekDaySigma) */
      sigma: peekDaySigma(ticker) ?? daySigmaOfIv(base.length ? base[base.length - 1].close : 0, nameIv() ?? 0),
    });

    const loaded = loadedRef.current;
    const tapeKey = tapeRef.current?.key ?? '';
    const newWorld = loaded.ticker !== ticker || loaded.timeframe !== timeframe || loaded.clock !== barClock || tapeKeyRef.current !== tapeKey;
    const changed = newWorld || loaded.theme !== themeKey || loaded.full !== full;
    let armTimer = 0;

    /* A host's tape can jump. */
    const baseLast = base[base.length - 1].time;
    const jumped = !!tapeRef.current && tapeLastRef.current > 0 && (baseLast < tapeLastRef.current || baseLast - tapeLastRef.current > 60);
    tapeLastRef.current = tapeRef.current ? baseLast : 0;

    lastCloseRef.current = bars.length ? bars[bars.length - 1].close : null;
    if (bars.length) {
      lastBarTimeRef.current = bars[bars.length - 1].time;
      bucketSecRef.current = mins * 60;
      /* No runway on a rule clock: whitespace at timeframe spacing would be a claim about when the next bar lands,
         and rule bars land when the market says. */
      if (!altSpec) ensureRunway(lastBarTimeRef.current, bucketSecRef.current);
    }


    if (changed || jumped) {
      candleSeries.setData(bars.map(toMain));
      volumeSeries.setData(bars.map(b => toVolume(b, theme)));
      if (newWorld || jumped) showRecent();
      // Baseline style pivots on the current session's open — found at the last overnight gap in the aggregated bars
      // (intraday only; dailies fall back to the buffer's first open)
      if (styleRef.current === 'baseline' && bars.length > 0) {
        let baseValue = bars[0].open;
        /* Rule bars have no bar interval to scale — the overnight gap is found on the seconds tape's own line (an
           hour dwarfs any quarter spacing, see altBars.ts). */
        const gapSec = altSpec ? 3600 : mins * 60 * 1.5;
        for (let i = bars.length - 1; i > 0; i--) {
          if (bars[i].time - bars[i - 1].time > gapSec) {
            baseValue = bars[i].open;
            break;
          }
        }
        (candleSeries as unknown as ISeriesApi<'Baseline'>).applyOptions({ baseValue: { type: 'price', price: baseValue } });
      }
      if (newWorld) {
        // A new name/interval is a fresh greeting — autoscale returns with it.
        chart.priceScale('right').applyOptions({ autoScale: true });
        const kept = keepViewRef.current ? KEPT_VIEWS.get(`${ticker}|${timeframe}|${barClock}`) : undefined;
        if (kept) {
          // The reader's own view, carried across a remount (see the cleanup).
          chart.timeScale().applyOptions({ barSpacing: kept.barSpacing, rightOffset: kept.rightOffset ?? 10 });
          chart.timeScale().scrollToPosition(kept.scroll, false);
        } else {
          showRecent(); // theme swaps must not yank the user's pan/zoom
        }
        /* A timeframe change breathes in: the new world lands at zero and fades up on the house curve. Ticker
           changes are keyed by the host and already soft-fade; the first load is not a transition. */
        const el = containerRef.current;
        if (el && loaded.ticker === ticker) {
          el.style.transition = 'none';
          el.style.opacity = '0';
          // Lift on the next frame — or a timer, whichever comes first: a background tab gets no frames, and a chart
          // must never stay dark
          let lifted = false;
          const lift = () => {
            if (lifted) return;
            lifted = true;
            el.style.transition = 'opacity 480ms cubic-bezier(0.16, 1, 0.3, 1)';
            el.style.opacity = '1';
          };
          requestAnimationFrame(lift);
          window.setTimeout(lift, 40);
        }
      }
      loadedRef.current = { ticker, timeframe, theme: themeKey, clock: barClock, full };
      tapeKeyRef.current = tapeKey;
      /* Armed a frame later: the library reports a range on the setData itself, before it has laid the view out
         (−83..6 was measured on a mount), and that would have asked for the whole store at once. */
      recentHeldRef.current = false;
      if (held) armTimer = requestAnimationFrame(() => (recentHeldRef.current = true));
    } else if (bars.length !== altCountRef.current && (altSpec || Math.abs(bars.length - altCountRef.current) > 1)) {
      /* A rule clock completes a bar and opens the next in one tick, and a two-session tape can land after a one-
         session paint. Update cannot rewrite older times, so a count jump reloads. */
      candleSeries.setData(bars.map(toMain));
      volumeSeries.setData(bars.map(b => toVolume(b, theme)));
      showRecent();
    } else {
      const last = bars[bars.length - 1];
      candleSeries.update(toMain(last));
      volumeSeries.update(toVolume(last, theme));
    }
    altCountRef.current = bars.length;

    /* The exposure field on this timeframe's bars and the cut's expiries. A rule clock's axis only carries the times its
       bars happened to start at, so the field stays off there. */
    const showTrails = false; /* forced off: field was hard-crashing the page on load; re-enable once stable */
    trails.labelPx = compact ? 8.5 : 9.5;
    const handTrails = () => {
      try {
        const cols = showTrails ? fieldColumns(bars, mins) : [];
        trails.setData(cols, 0, showTrails, mins * 60, trailsGreek, 0, [], bars.map(b => ({ time: b.time, close: b.close })));
      } catch (e) {
        /* 1D / coarse bars can produce a degenerate grid; never let the trails path kill the page */
        console.warn('[trails] skipped', e);
        trails.setData([], 0, false, mins * 60, trailsGreek, 0, [], []);
      }
    };
    handTrails();
    return () => cancelAnimationFrame(armTimer);
  }, [ticker, revision, timeframe, themeKey, overlays.trails, showRecent, reloadNonce, mainNonce, toMain, compact, altSpec, barClock, fullNonce, trailsGreek, levels.spot, levels.callWall, levels.putWall, levels.flip, levels.supreme, bookRev, session, bookDate, tapeStamp, fieldMode, fieldRev]);

  /* `compact` can change without the chart being rebuilt — a desktop window dragged across the phone line, a handset
     rotated. The mount effect read it once at create time, so apply later changes here. */
  useEffect(() => {
    chartRef.current?.applyOptions({ layout: { fontSize: compact ? 9 : 10 } });
  }, [compact]);

  /* Crossing the breakpoint must not need a remount — the chart is created once and a window drag changes which side
     of it the reader is on. */
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: { mouseWheel: true },
      handleScale: { mouseWheel: true },
    });
  }, [pageScroll]);

  /* which levels are in: a level that arrives after the ladder was hung hangs its rung (the tween moves the rest) */
  const levelsShape = [levels.callWall, levels.putWall, levels.flip, levels.supreme].map(v => (Number.isFinite(v) ? 1 : 0)).join('');
  // The key levels' ladder — hung and taken down when the switch, the ticker or the series changes
  useEffect(() => {
    const ladder = ladderRef.current;
    if (!ladder) return;
    cancelAnimationFrame(levelRafRef.current);
    shownLevelsRef.current = null;

    // Live rungs are today's book. In replay the minute gamma at the bar is the book — walls and flip are not stored
    // on it.
    if (!overlays.levels) {
      ladder.setData(null);
      levelCell.set(null);
      return;
    }
    const silver = boxEl ? readToken('--silver', undefined, boxEl) : '#C7D3E8';
    if (replay) {
      const data = replayDataRef.current;
      const bar = data?.bars[Math.max(0, replayIdx - 1)];
      const prior = bar ? snapsAsOf(data?.snaps ?? [], bar.time) : [];
      const snap = prior.length ? prior[prior.length - 1] : undefined;
      let supreme = Number.NaN;
      let best = 0;
      for (const row of snap?.levels ?? []) {
        const a = Math.abs(row.value);
        if (a > best) {
          best = a;
          supreme = row.strike;
        }
      }
      const asOf = { spot: bar?.close ?? Number.NaN, callWall: Number.NaN, putWall: Number.NaN, flip: Number.NaN, supreme };
      ladder.setData(best > 0 ? { rungs: ladderOf(asOf, silver), hot: null } : null);
      levelCell.set(null);
      return;
    }
    const L = levelsRef.current;
    ladder.setData({ rungs: ladderOf(L, silver), hot: null });
    const chain = snapshotFor(ticker, 'ALL');
    ladder.marks = chain ? oiDoubled(ticker, peekEntry(ticker)?.at ?? 0, chain.chain) : [];
    shownLevelsRef.current = { ...L };
    levelTickerRef.current = ticker;
  }, [ticker, overlays.levels, replay, replayIdx, mainNonce, themeKey, appTheme, boxEl, levelsShape]);

  /* The ladder names each level at the edge with its distance from the price; max pain rides with the levels */
  useEffect(() => {
    ladderRef.current?.setNamed(levels.spot, levels.shares, levels.maxPain ?? null, EXTRA_INK.maxPain);
  }, [levels.spot, levels.shares, levels.maxPain]);

  /* The pointer on a rung — within RULE_NEAR of a rule, in the ladder's band at the right edge: the rung brightens
     and reaches in, and the card says what it is (the Compass marks' hover, CampaignAnalysis). */
  useEffect(() => {
    const chart = chartRef.current;
    const ladder = ladderRef.current;
    if (!chart || !ladder || !overlays.levels) return;
    const onMove = (p: MouseEventParams<Time>) => {
      const d = ladder.data;
      const series = candleSeriesRef.current;
      if (!p.point || !d || !series || panRef.current) {
        ladder.setHot(null);
        levelCell.set(prev => (prev === null ? prev : null));
        return;
      }
      const onLadder = p.point.x >= chart.timeScale().width() - LADDER_HIT_W;
      let hit: KeyLevelRung | null = null;
      let best = Infinity;
      if (onLadder) {
        for (const r of ladder.visible()) {
          const y = series.priceToCoordinate(r.price);
          if (!nearRule(y, p.point.y)) continue;
          const gap = Math.abs((y as number) - p.point.y);
          if (gap < best) {
            best = gap;
            hit = r;
          }
        }
      }
      ladder.setHot(hit?.key ?? null);
      const px = p.point.x;
      const py = p.point.y;
      levelCell.set(prev => {
        const rect = hit ? containerRef.current?.getBoundingClientRect() : null;
        if (!hit || !rect) return prev === null ? prev : null;
        if (prev && prev.key === hit.key && prev.price === hit.price) return prev;
        return { key: hit.key, price: hit.price, x: rect.left + px, y: rect.top + py };
      });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      ladder.setHot(null);
      levelCell.set(null);
    };
  }, [overlays.levels, replay, mainNonce]);

  /* The session's reference prices. */
  useEffect(() => {
    const prim = sessionPrimRef.current;
    if (!prim) return;
    if (!overlays.session || altSpec) {
      prim.setLines([]);
      return;
    }
    let base = baseBars();
    if (replay) {
      const cut = replayDataRef.current?.bars[Math.max(0, replayIdx - 1)]?.time;
      if (cut == null) {
        prim.setLines([]);
        return;
      }
      base = base.filter(b => b.time <= cut);
    }
    prim.setLines(sessionLines(buildSessionLevels(base, sessionOr)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, revision, sessionOr, overlays.session, replay, replayIdx, mainNonce, altSpec, session]);

  /* The expected-move cone. */
  useEffect(() => {
    const prim = conePrimRef.current;
    if (!prim) return;
    if (!overlays.cone || replay || altSpec) {
      prim.setData(null);
      ladderRef.current?.setExtras('cone', []);
      return;
    }
    /* From the last bar over the rest of today's session and the next one, off the at-the-money vols (data/terrainCone.ts) */
    const mins = tfMinutes(timeframe);
    const bars = barsFor(mins);
    ensureCone(ticker);
    const spot = bars.length ? bars[bars.length - 1].close : 0;
    const term = coneTerm(ticker);
    const perBar = tradingMinutesPerBar(mins);
    const fc = term && spot > 0 ? forwardCone(term.rows, spot, Date.now(), todayOpenOf(bars), Math.max(1, Math.min(5, perBar / 3))) : null;
    prim.setData(
      fc
        ? {
            cone: { past: [], forward: fc.points, crossings: [], openPrice: 0, openTime: null },
            marks: coneMarks(fc),
            /* the key levels name the cone's ends at the edge; without them the cone names its own */
            markWords: !overlays.levels,
            barTimes: bars.map(b => b.time),
            barMinutes: perBar,
            anchor: bars.length - 1,
            oddsName: `To the ${fc.nextDay.slice(5)} close`,
            iv: fc.ivNext,
            source: term?.source === 'theta' ? 'ThetaData at-the-money IV' : 'Unusual Whales term structure',
          }
        : null,
    );
    /* the cone's numbers at the edge: today's expected move, and ±1σ to the close */
    ladderRef.current?.setExtras('cone', coneRungs(fc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, revision, overlays.cone, overlays.levels, replay, mainNonce, altSpec, coneHorizon]);

  /* The event markers. The calendar half (this name's report, the macro dates) is cached per ticker and day; the
     prints half is live. */
  useEffect(() => {
    const prim = eventsPrimRef.current;
    if (!prim) return;
    if (!overlays.events || altSpec) {
      prim.setData(null);
      eventCell.set(null);
      return;
    }
    const cut = replay ? replayDataRef.current?.bars[Math.max(0, replayIdx - 1)]?.time : null;
    if (replay && cut == null) {
      prim.setData(null);
      return;
    }
    const now = cut != null ? new Date(cut * 1000) : new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    ensureEarnings();
    const key = `${ticker}|${todayIso}|${peekEarningsEvent(ticker)?.iso ?? ''}`;
    if (eventsCalRef.current?.key !== key) {
      eventsCalRef.current = {
        key,
        earnings: peekEarningsEvent(ticker),
        macro: macroWindow(now).filter(m => !/approximated/i.test(m.detail)),
        todayIso,
      };
    }
    const cal = eventsCalRef.current;
    const mins = tfMinutes(timeframe);
    const bars = barsFor(mins);
    const sec = (at: number) => (at > 1e12 ? at / 1000 : at);
    const built = buildTapeEvents({
      bars: baseBars().filter(b => (cut == null ? true : b.time <= cut)),
      prints: (flowPrints ?? []).filter(p => cut == null || sec(p.at) <= cut).map(p => ({ ...p, at: sec(p.at) })),
      earnings: cal.earnings,
      macro: cal.macro,
      todayIso: cal.todayIso,
    });
    prim.setData({
      events: cut == null ? built : built.filter(e => e.time != null && e.time <= cut),
      barTimes: (cut == null ? bars : bars.filter(b => b.time <= cut)).map(b => b.time),
      barMinutes: mins,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, revision, overlays.events, replay, replayIdx, mainNonce, flowPrints, altSpec]);

  /* The live price, as a card on the right scale. The library draws a flat one-line tag for the last value. */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const on = priceTag && !replay;
    series.applyOptions({ lastValueVisible: !on });
    if (!on) return;

    const chart = chartRef.current;
    const el = priceTagRef.current;
    if (!chart || !el) return;
    const priceEl = el.firstElementChild as HTMLElement | null;
    const timeEl = el.lastElementChild as HTMLElement | null;
    if (!priceEl || !timeEl) return;

    const bucket = Math.max(60, tfMinutes(timeframe) * 60);
    let shownPrice = '';
    let shownLeft = '';
    let shownY = Number.NaN;
    let shownW = -1;

    const frame = () => {
      priceTagRafRef.current = requestAnimationFrame(frame);
      /* AS wide as the gutter, measured — not 68px of guess. */
      const gw = Math.round(chart.priceScale('right').width());
      if (gw > 0 && gw !== shownW) {
        el.style.width = `${gw}px`;
        shownW = gw;
      }
      const price = lastCloseRef.current;
      const y = price == null ? null : series.priceToCoordinate(price);
      if (price == null || y == null) {
        if (!Number.isNaN(shownY)) {
          el.style.opacity = '0';
          shownY = Number.NaN;
        }
        return;
      }

      const p = price.toFixed(2);
      const minute = nyMinutes((lastBarTimeRef.current || 0) * 1000);
      const sess = sessionOfMinute(minute);
      const label = sess === 'pre' ? `${p} pre` : sess === 'post' ? `${p} AH` : sess === 'overnight' ? `${p} ON` : p;
      if (label !== shownPrice) {
        priceEl.textContent = label;
        shownPrice = label;
      }

      /* Time left in the bar, ON the chart's clock This read `bucket - (now % bucket)`: wall-clock seconds to the
         next multiple of the timeframe. Two things wrong with it. It was off by an order of magnitude. */
      const barAt = lastBarTimeRef.current;
      if (barAt !== barClockRef.current.stamp) {
        const nowMs = Date.now();
        if (barClockRef.current.stamp !== 0) barClockRef.current.realMs = nowMs - barClockRef.current.at;
        barClockRef.current.stamp = barAt;
        barClockRef.current.at = nowMs;
      }
      const period = barClockRef.current.realMs;
      const pad = (v: number) => String(v).padStart(2, '0');
      /* Blank until a full bar has been observed — but never return early here. The card is positioned below, and an
         early exit leaves it wherever it was last put. */
      let t = '';
      /* A rule bar closes when the market moves or trades enough — "time left" is not a thing it has, so the card is
         price-only there. */
      if (period > 0 && !altSpec) {
        const left = Math.max(0, Math.round((period - (Date.now() - barClockRef.current.at)) / 1000));
        const hh = Math.floor(left / 3600);
        t = hh > 0
          ? `${hh}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`
          : `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
      }
      if (t !== shownLeft) {
        timeEl.textContent = t;
        shownLeft = t;
      }

      /* Centred on the price, the way the tag it replaces was. */
      const top = Math.round(y);
      if (top !== shownY) {
        el.style.transform = `translateY(${top}px) translateY(-50%)`;
        el.style.opacity = '1';
        shownY = top;
      }
    };

    priceTagRafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(priceTagRafRef.current);
      candleSeriesRef.current?.applyOptions({ lastValueVisible: true });
    };
  }, [priceTag, timeframe, replay, mainNonce, altSpec]);

  // Dark-pool whisper lines — same grammar as the flow board minis
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    for (const line of printLinesRef.current) candleSeries.removePriceLine(line);
    printLinesRef.current = [];
    if (!overlays.darkpool || replay) return;
    // Teal, the app-wide dark-pool ink (Live Tape dot, landing accent) — the old 65% white whisper vanished against
    // the candles.
    printLinesRef.current = prints.map(print =>
      candleSeries.createPriceLine({
        price: print.price,
        color: DARK_POOL,
        title: `DP $${print.notional.toFixed(2)}B · ${print.date}`,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        axisLabelColor: DARK_POOL,
        axisLabelTextColor: '#0a0a0a',
      })
    );
  }, [prints, overlays.darkpool, replay, mainNonce]);

  // Tween the rungs to their new scan values — the ladder glides, never teleports
  useEffect(() => {
    const ladder = ladderRef.current;
    if (!ladder?.data) return; // levels hidden

    // Ticker switch = new world: snap, don't tween across symbols
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (levelTickerRef.current !== ticker || reduced) {
      levelTickerRef.current = ticker;
      ladder.setPrices(levels);
      shownLevelsRef.current = { ...levels };
      return;
    }

    const origin = shownLevelsRef.current ?? { ...levels };
    if (!KEY_LEVEL_KEYS.some(k => origin[k] !== levels[k])) return;

    cancelAnimationFrame(levelRafRef.current);
    const target = { ...levels };
    const start = performance.now();
    const DUR = 650;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const cur: KeyLevels = { ...target };
      for (const k of KEY_LEVEL_KEYS) {
        const from = origin[k];
        const to = target[k];
        if (from == null || to == null) continue;
        cur[k] = from + (to - from) * e;
      }
      ladder.setPrices(cur);
      shownLevelsRef.current = cur;
      if (t < 1) levelRafRef.current = requestAnimationFrame(step);
    };
    levelRafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(levelRafRef.current);
  }, [levels, ticker]);

  /* The scale glides: taking or dropping the focus price from the autoscale extras jolted the range in one frame, so
     the range tweens to the autoscale's target instead. */
  const scaleGlideRef = useRef(0);
  const glideScale = (candleSeries: ISeriesApi<'Candlestick'>, from: { from: number; to: number } | null) => {
    cancelAnimationFrame(scaleGlideRef.current);
    const ps = candleSeries.priceScale();
    ps.applyOptions({ autoScale: true });
    const bars = candleSeries.data();
    const lastBar = bars[bars.length - 1];
    if (lastBar) candleSeries.update(lastBar);
    const to = ps.getVisibleRange();
    if (!from || !to || (Math.abs(from.from - to.from) < 1e-6 && Math.abs(from.to - to.to) < 1e-6)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ps.setVisibleRange(from);
    const t0 = performance.now();
    const DUR = 320;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        ps.setVisibleRange({ from: from.from + (to.from - from.from) * e, to: from.to + (to.to - from.to) * e });
        scaleGlideRef.current = requestAnimationFrame(step);
      } else ps.applyOptions({ autoScale: true });
    };
    scaleGlideRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(scaleGlideRef.current), []);

  // Transient focus line — "what you clicked", drawn via the chart's native API
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    /* The range as it stands, read before the focus moves the autoscale's extras */
    const rangeBefore = candleSeries?.priceScale().getVisibleRange() ?? null;
    focusPriceRef.current = focusPrice;
    if (!candleSeries) return;
    if (focusLineRef.current) {
      candleSeries.removePriceLine(focusLineRef.current);
      focusLineRef.current = null;
    }
    if (focusPrice != null) {
      // With the trails drawn, the painted band IS the focus — a line across the whole tape under it read as a smear
      // joining the band to the label.
      const trailsDrawn = overlays.trails;
      focusLineRef.current = candleSeries.createPriceLine({
        price: focusPrice,
        // The ink at creation too — a trails toggle recreates the line, and the ink effect below only re-runs when
        // the focus or the supreme moves
        color: Math.abs(levelsRef.current.supreme - focusPrice) < 1e-9 ? SUPREME : focusInk(),
        title: 'FOCUS',
        lineVisible: !trailsDrawn,
        lineStyle: LineStyle.Solid,
        lineWidth: 1,
        axisLabelVisible: true,
      });
    }
    // Re-run autoscale now, not on the next tick — the provider above reads the new focus and brings the line into
    // frame — on a glide, not a jump.
    glideScale(candleSeries, rangeBefore);
  }, [focusPrice, overlays.trails, timeframe, mainNonce]);

  /* Alert lines. */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const live = alertLinesRef.current;
    for (const line of live.values()) {
      try {
        series.removePriceLine(line);
      } catch {
        /* Series already gone with the old style */
      }
    }
    live.clear();
    /* The lines are an overlay the reader switches on */
    if (!overlays.alerts) return;
    for (const a of alerts) {
      if (a.kind !== 'price') continue;
      live.set(
        a.id,
        series.createPriceLine({
          price: a.price,
          color: ALERT_INK,
          title: a.firedAt ? 'ALERT' : '',
          lineStyle: a.firedAt ? LineStyle.Solid : LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
        })
      );
    }
    return () => {
      for (const line of live.values()) {
        try {
          series.removePriceLine(line);
        } catch {
          /* Chart already torn down */
        }
      }
      live.clear();
    };
  }, [alerts, mainNonce, overlays.alerts]);

  /* Firing. Driven by the tape rather than by a timer: `revision` bumps on every tick and this runs with the close
     that tick produced. */
  useEffect(() => {
    if (replay) return;
    const close = lastCloseRef.current;
    if (close == null) return;
    const waiting = alerts.filter(a => !a.firedAt);
    if (waiting.length === 0) return;

    const needsBook = waiting.some(a => a.kind === 'level' || a.kind === 'gexflip' || a.kind === 'newsupreme' || a.kind === 'wallmove' || a.kind === 'charmPin' || a.kind === 'oiJump');
    const exp = needsBook ? exposureNowFor(ticker) : null;

    const values: Partial<Record<IndicatorSource, number | null>> = {};
    const mins = tfMinutes(timeframe);
    for (const a of waiting) {
      if (a.kind !== 'indicator' || a.tf !== timeframe || a.source in values) continue;
      /* Deliberately without the pane's rule clock: the alert was armed on this timeframe's time bars and keeps
         watching them, whatever the pane is currently drawing. */
      const bars = barsFor(mins);
      const last = (pts: readonly (number | null)[]) => {
        const p = pts[pts.length - 1];
        return typeof p === 'number' && Number.isFinite(p) ? p : null;
      };
      values[a.source] =
        a.source === 'vwap' ? last(vwapSeries(bars, mins))
        : a.source === 'rsi' ? last(rsiSeries(bars, 14))
        : last(emaSeries(bars, a.source === 'ema9' ? 9 : a.source === 'ema21' ? 21 : 50));
    }

    const ctx: AlertContext = {
      close,
      tf: timeframe,
      levels: {
        callWall: exp?.callWall ?? null,
        putWall: exp?.putWall ?? null,
        flip: exp?.flip ?? null,
        supreme: exp?.supreme ?? null,
      },
      netGex: exp ? exp.netGex : null,
      step: exp?.step ?? 0,
      values,
      prints: waiting.some(a => a.kind === 'flow')
        ? (flowPrints ?? []).filter(p => p.ticker === ticker).map(p => ({ at: p.at, premium: p.premium }))
        : [],
      news: waiting.some(a => a.kind === 'news') ? newsPulse(ticker) : [],
      charm: (() => {
        if (!waiting.some(a => a.kind === 'charmPin')) return null;
        const book = snapshotFor(ticker, 'ALL');
        if (!book) return null;
        let c = 0;
        let any = false;
        for (const n of book.chain) if (n.netCharm) { c += n.netCharm; any = true; }
        return any ? c : null;
      })(),
      nyMin: nyMinutes(Date.now()),
      oiJump: waiting.some(a => a.kind === 'oiJump') && oiDoubled(ticker, peekEntry(ticker)?.at ?? 0, snapshotFor(ticker, 'ALL')?.chain ?? []).length > 0,
    };

    const now = Date.now();
    for (const a of waiting) {
      const verdict = evaluateAlert(a, ctx);
      if (verdict.fire) { markFired(ticker, a.id, now); beepAlert(); }
      else if (verdict.armed) commitArm(ticker, verdict.armed);
    }
  }, [alerts, ticker, revision, replay, timeframe, flowPrints]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const prev = popDrawings(ticker);
      if (!prev) return;
      e.preventDefault();
      shapesRef.current = prev;
      drawingsRef.current?.setDrawings(prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticker]);

  /* ThetaData's bars for this pane and its compares, kept fresh while it is mounted: the one-minute tape (the
     session levels, the ATR and the cone read it) and the timeframe's own grain */
  const compareNames = compares.map(c => c.ticker).join(',');
  useEffect(() => {
    if (tape || !thetaBars()) return;
    const names = [ticker, ...compareNames.split(',').filter(Boolean)];
    const grain = chartGrain(tfMinutes(timeframe));
    const offs = names.flatMap(n => wantChartTape(n, grain, session));
    return () => offs.forEach(off => off());
  }, [ticker, compareNames, timeframe, session, !!tape]); // eslint-disable-line react-hooks/exhaustive-deps



  /* The focus ink follows the strike's standing, re-read every scan: magenta while the focused strike is the
     supreme, silver otherwise. */
  useEffect(() => {
    const isSupreme = focusPrice != null && Math.abs(levels.supreme - focusPrice) < 1e-9;
    trailsRef.current?.setFocus(focusPrice, isSupreme ? 'supreme' : 'focus');
    /* The field keeps its own palette — but the crown. */
    const showLevels = overlays.levels;
    trailsRef.current?.setSupreme(showLevels && Number.isFinite(levels.supreme) ? levels.supreme : null);
    trailsRef.current?.setWalls(null, null, null);
    focusLineRef.current?.applyOptions({ color: isSupreme ? SUPREME : focusInk() });
  }, [focusPrice, overlays.levels, levels.supreme, levels.callWall, levels.putWall, levels.flip]);

  /* The hover ring wears the page's ink on the chart's ground: white on the black tape, near-black on a stone one —
     and so do the reader's marks that chose no ink */
  useEffect(() => {
    const light = chartGround(themeKey) === 'light';
    trailsRef.current?.setRingInk(light ? [20, 20, 24] : [255, 255, 255]);
    drawingsRef.current?.setRestInk(light ? REST_INK_LIGHT : REST_INK_DARK);
  }, [themeKey, mainNonce]);
  /* A kept bead's card lets go on Esc, and with the world it was read in */
  useEffect(() => {
    setPinnedBead(null);
    beadCell.set(null);
    trailsRef.current?.setHover(null);
  }, [ticker, timeframe, replay]);
  useEffect(() => {
    if (!pinnedBead) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinnedBead(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pinnedBead]);

  // Replay lifecycle ----------------------------------------------------- Enter: snapshot the aggregated world and
  // rewind. Exit: hand the series back to the live effect (reloadNonce forces a full refresh).
  useEffect(() => {
    replayRef.current = replay;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    if (replay) {
      const mins = tfMinutes(timeframe);
      const bars = barsFor(mins);
      const snaps = fieldColumns(bars, mins);
      if (bars.length < 40) return;
      replayDataRef.current = { bars, snaps, maxAbs: snapshotsMaxAbs(snaps) };
      /* Driven from outside: start where the host's clock points, and never play on our own — the host's strip is
         the transport. */
      const external = replayTimeRef.current != null;
      replayAppliedRef.current = 0;
      if (external) {
        let i = bars.length;
        while (i > 0 && bars[i - 1].time > (replayTimeRef.current as number)) i--;
        setReplayIdx(Math.max(31, i));
        setReplayNonce(n => n + 1);
        setOwnPhase('play');
      } else {
        setOwnPhase('pick');
        /* The day marks under the track: where each session starts, at most eight named */
        const starts: number[] = [0];
        for (let i = 1; i < bars.length; i++) if (bars[i].time - bars[i - 1].time > 90) starts.push(i);
        const every = Math.max(1, Math.ceil(starts.length / 8));
        setReplayMarks(starts.filter((_, k) => k % every === 0).map(i => ({ u: i / Math.max(1, bars.length), label: dayWords(bars[i].time) })));
      }
      setReplaySpeed(2);
      setReplayPlaying(false);
      /* The view is set once the sliced data is on the series (the apply effect) — set here, against the live window
         still on the series, the library re-anchored it past the last bar and the 1m replay opened blank */
    } else {
      replayDataRef.current = null;
      setReplayPlaying(false);
      loadedRef.current = { ticker: '', timeframe: '1m', theme: '', clock: 'time', full: false };
      setReloadNonce(n => n + 1);
    }
    /* On the host's clock a timeframe change re-cuts the same moment on the new bars (the Map keeps replaying); on
       its own transport it exits below */
  }, [replay, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // A ticker switch ends the replay — it was recorded in another world; so does a timeframe switch when the chart is
  // on its own transport
  useEffect(() => {
    if (replayRef.current) onExitReplay?.();
  }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (replayRef.current && replayTimeRef.current == null) onExitReplay?.();
  }, [timeframe]); // eslint-disable-line react-hooks/exhaustive-deps
  const [replayNonce, setReplayNonce] = useState(0);
  /** Dev only: what the replay applied — read by the probes */
  const [replayDebug, setReplayDebug] = useState('');
  /* The chart's own replay (Pulse, Terrain): pick a bar first, then the same strip the Map wears — by bars, at bars
     a second, the day marks under the track, the bar's own day and minute as the words */
  const [ownPhase, setOwnPhase] = useState<'pick' | 'play'>('pick');
  const [replayMarks, setReplayMarks] = useState<{ u: number; label: string }[]>([]);
  const external = replayTime != null;
  const picking = pickTime || (replay && !external && ownPhase === 'pick');

  /* Picking a bar: the crosshair turns into a silver line without a horizontal arm, and a click hands the bar's time
     up; on the way out the crosshair goes back to what the price tag's own rule wants */
  const onPickTimeRef = useRef(onPickTime);
  onPickTimeRef.current = onPickTime;
  /* The future, faded: a wash from the pointer's line to the plot's right edge, over the bars the replay would not
     yet have seen. */
  const [pickFade, setPickFade] = useState<{ right: number; bottom: number } | null>(null);
  const pickFadeRef = useRef<HTMLDivElement | null>(null);
  const pickLineRef = useRef<HTMLDivElement | null>(null);
  const pickLabelRef = useRef<HTMLDivElement | null>(null);
  const pickXRef = useRef(0);
  const placePick = (x: number) => {
    pickXRef.current = x;
    if (pickFadeRef.current) pickFadeRef.current.style.left = `${x}px`;
    if (pickLineRef.current) pickLineRef.current.style.left = `${x}px`;
    if (pickLabelRef.current) pickLabelRef.current.style.left = `${x}px`;
  };
  const ownLabelRef = useRef('');
  useEffect(() => {
    const chart = chartRef.current;
    if (!picking || !chart) return;
    chart.applyOptions({ crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } } });
    const onClick = (p: MouseEventParams<Time>) => {
      if (typeof p.time !== 'number') return;
      if (pickTime) {
        onPickTimeRef.current?.(p.time as number);
        return;
      }
      /* Our own pick: the bar becomes the position, paused */
      const bars = replayDataRef.current?.bars;
      if (!bars) return;
      let i = bars.length;
      while (i > 0 && bars[i - 1].time > (p.time as number)) i--;
      replayAppliedRef.current = 0;
      setReplayIdx(Math.max(31, i));
      setReplayNonce(n => n + 1);
      setReplayPlaying(false);
      setOwnPhase('play');
    };
    let mounted = false;
    const onHover = (p: MouseEventParams<Time>) => {
      if (!p.point) {
        mounted = false;
        setPickFade(null);
        return;
      }
      placePick(p.point.x);
      /* The bar's own day and minute under the line — through the ref, no render; the host's page holds still until
         a bar is picked */
      ownLabelRef.current = typeof p.time === 'number' ? timeWords(p.time as number) : '';
      if (pickLabelRef.current) pickLabelRef.current.textContent = ownLabelRef.current;
      if (!mounted) {
        mounted = true;
        setPickFade({ right: chart.priceScale('right').width(), bottom: chart.timeScale().height() });
      }
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onHover);
    return () => {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onHover);
      setPickFade(null);
      const tagOn = priceTag && !replay;
      const sx = chartSurface(themeRef.current);
      chart.applyOptions({
        crosshair: {
          vertLine: { color: sx.crosshair, width: 1, style: 3, labelBackgroundColor: sx.label },
          horzLine: { visible: !tagOn, labelVisible: !tagOn, color: sx.crosshair, labelBackgroundColor: sx.label },
        },
      });
    };
  }, [picking, pickTime, priceTag, replay, mainNonce]);

  /* The host's clock moves the position: the last bar at or before its time */
  const replayTimeRef = useRef<number | null>(replayTime);
  replayTimeRef.current = replayTime;
  useEffect(() => {
    if (!replay || replayTime == null) return;
    const bars = replayDataRef.current?.bars;
    if (!bars) return;
    let i = bars.length;
    while (i > 0 && bars[i - 1].time > replayTime) i--;
    setReplayIdx(Math.max(31, i));
  }, [replay, replayTime]);

  // Apply the current replay position to the series (append fast-path when stepping forward one bar; full slice on
  // scrubs/jumps).
  useEffect(() => {
    if (!replay) return;
    /* Our own replay has no position until a bar is picked */
    if (!external && ownPhase === 'pick') return;
    const data = replayDataRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const trails = trailsRef.current;
    if (!data || !candleSeries || !volumeSeries || !trails) return;

    // ReplayIdx still holds its pre-entry value on the entry commit (the lifecycle effect's setReplayIdx lands next
    // commit) — never touch the series until a real position arrives, and never fast-append onto a series that…
    if (replayIdx < 31) return;
    const theme = themeRef.current;
    const idx = Math.max(1, Math.min(replayIdx, data.bars.length));
    const fresh = replayAppliedRef.current === 0;
    if (idx === replayAppliedRef.current + 1 && replayAppliedRef.current >= 1) {
      const bar = data.bars[idx - 1];
      candleSeries.update(toMain(bar));
      volumeSeries.update(toVolume(bar, theme));
    } else {
      const visible = data.bars.slice(0, idx);
      candleSeries.setData(visible.map(toMain));
      volumeSeries.setData(visible.map(b => toVolume(b, theme)));
    }
    replayAppliedRef.current = idx;
    barCountRef.current = idx;

    /* Keep the moment on screen: on entry, and on a seek that lands past the visible edge or leaves fewer than
       twenty bars of history in view, the range comes along; a step inside it leaves the reader's view alone. */
    const chart = chartRef.current;
    const vis = chart?.timeScale().getVisibleLogicalRange();
    if (chart && (fresh || !vis || idx - 1 > vis.to - 2 || idx - 1 - vis.from < 20)) {
      const span = vis ? Math.max(20, vis.to - vis.from) : 120;
      chart.timeScale().setVisibleLogicalRange({ from: idx - 1 - span + 10, to: idx - 1 + 10 });
    }
    if (import.meta.env?.DEV) {
      const v2 = chart?.timeScale().getVisibleLogicalRange();
      setReplayDebug(`${v2 ? `${Math.round(v2.from)}..${Math.round(v2.to)}` : 'none'} · ${data.bars.length} bars · ${data.bars[Math.max(0, idx - 1)]?.time}`);
    }

    const cutoff = data.bars[idx - 1].time;
    const mins = tfMinutes(timeframe);
    // The replay's last bar is complete — its sub-bar beads belong to it
    trails.setData(
      snapsAsOf(data.snaps, cutoff),
      data.maxAbs,
      overlays.trails,
      mins * 60,
      trailsGreek,
      0,
      [],
      data.bars.slice(0, idx).map(b => ({ time: b.time, close: b.close })),
    );
  }, [replay, replayIdx, replayNonce, ownPhase, external, overlays.trails, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playback clock — `replaySpeed` bars a second
  useEffect(() => {
    if (!replay || !replayPlaying) return;
    const id = window.setInterval(() => {
      setReplayIdx(i => {
        const len = replayDataRef.current?.bars.length ?? 0;
        if (i >= len) {
          setReplayPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.round(1000 / replaySpeed));
    return () => window.clearInterval(id);
  }, [replay, replayPlaying, replaySpeed]);

  // Drawings ------------------------------------------------------------- Per-ticker load; marks are the user's, so
  // they persist across sessions
  useEffect(() => {
    shapesRef.current = loadDrawings(drawKey);
    drawingsRef.current?.setDrawings([...shapesRef.current]);
  }, [ticker]);

  const commitDrawing = useCallback(
    (raw: Drawing) => {
      /* Made whole first (the primitive's normalise): a position is born with its stop, the VWAP's anchor sits on
         its curve */
      const d = drawingsRef.current?.normalise(raw) ?? raw;
      shapesRef.current = [...shapesRef.current, d];
      drawingsRef.current?.setDrawings(shapesRef.current);
      saveDrawings(drawKey, shapesRef.current);
      /* The tool empties into your hand. Placing a mark drops the tool back to Select with the new mark already
         selected, so the very next drag moves it. Want another one? */
      setDrawTool('select');
      const idx = shapesRef.current.length - 1;
      setSelectedIdx(idx);
      drawingsRef.current?.setSelected(idx);
    },
    [ticker]
  );

  /* The floating mark bar Appears whenever a mark is selected; movable anywhere on the pane by its grip; its trash
     kills only the selected mark. */
  const railPrefs = useRailPrefs();
  /* The dock the reader asked for, honoured only where it fits. */
  const rail = {
    open: railPrefs.open,
    dock: railPrefs.dock === 'top' && railTopOk ? ('top' as const) : ('left' as const),
    /** Both docks reachable here? Drives whether the flip button shows. */
    canTop: railTopOk,
  };
  /* Where the host strip's gap is, when the rail rides the top */
  const gap = useToolbarGap(containerRef, rail.dock === 'top');
  const topDockStyle = rail.dock === 'top' && gap ? { left: gap.left + gap.width / 2, transform: 'translateX(-50%)', maxWidth: Math.max(160, gap.width - 16) } : undefined;
  /* The left rail stands clear of the chrome. Centred as before, but never higher than 8px under the host's chrome,
     and no taller than the room below it (it scrolls past that). */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [railH, setRailH] = useState(0);
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() =>
      setRailH(h => {
        const n = Math.round(el.getBoundingClientRect().height);
        return n === h ? h : n;
      })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [rail.open, rail.dock, drawing]);
  const leftDockStyle = rail.dock === 'left' && boxH > 0 ? { top: Math.max(boxH / 2, chromeInset + 8 + railH / 2), maxHeight: Math.max(120, boxH - chromeInset - 16) } : undefined;
  /* …and never over the TradingView mark in the bottom-left corner, which its licence keeps seen and clickable. On a
     short pane (a desk of three or four) the rail, held under the chrome, reaches the corner: there the mark steps
     right of the rail's column (index.css [data-tv-mark-beside]) rather than the rail losing its foot to a scroll. A
     finger's 44px box round the mark reaches 12.5px above it, hence the 14. */
  const markBeside =
    !compact && (drawing || !!onEnterDraw) && rail.open && rail.dock === 'left' && boxH > 0 && railH > 0 &&
    Math.max(boxH / 2, chromeInset + 8 + railH / 2) + railH / 2 > boxH - markClear - 14;
  const [, forceMark] = useReducer((x: number) => x + 1, 0);
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const [barMenu, setBarMenu] = useState<'color' | 'tcolor' | 'width' | 'style' | null>(null);
  useEffect(() => setBarMenu(null), [selectedIdx]);

  const updateSelected = useCallback(
    (patch: Partial<Drawing>) => {
      const i = selectedIdx;
      if (i === null) return;
      shapesRef.current = shapesRef.current.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
      drawingsRef.current?.setDrawings(shapesRef.current);
      saveDrawings(drawKey, shapesRef.current);
      forceMark();
    },
    [selectedIdx, ticker]
  );

  const onBarGripDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = containerRef.current;
    const bar = (e.currentTarget as HTMLElement).parentElement;
    if (!wrap || !bar) return;
    const rect = wrap.getBoundingClientRect();
    const bRect = bar.getBoundingClientRect();
    const dx = e.clientX - bRect.left;
    const dy = e.clientY - bRect.top;
    const move = (ev: PointerEvent) => {
      setBarPos({
        x: Math.min(rect.width - bRect.width, Math.max(0, ev.clientX - rect.left - dx)),
        y: Math.min(rect.height - bRect.height, Math.max(0, ev.clientY - rect.top - dy)),
      });
    };
    const up = () => window.removeEventListener('pointermove', move);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  /* A tool taken in hand — by the rail, a family's list, the sheet or the command palette. Its family's button wears
     it from now on. */
  const pickTool = useCallback(
    (kind: DrawingKind) => {
      setDrawTool(kind);
      rememberDrawTool(kind);
      setSheetOpen(false);
      if (!drawing) onEnterDraw?.();
    },
    [drawing, onEnterDraw]
  );
  const pickToolRef = useRef(pickTool);
  pickToolRef.current = pickTool;
  /* The command palette arms a tool on the chart the pointer was last over (drawTools.tsx) */
  const chartId = useRef(Symbol('chart')).current;
  const canDraw = !!onEnterDraw;
  useEffect(() => (canDraw ? registerDrawChart(chartId, kind => pickToolRef.current(kind)) : undefined), [canDraw, chartId]);

  const clearDrawings = useCallback(() => {
    shapesRef.current = [];
    drawingsRef.current?.setDrawings([]);
    saveDrawings(drawKey, []);
    deselect();
  }, [ticker, deselect]);

  const pointFromClient = (clientX: number, clientY: number): { time: number; price: number } | null => {
    const container = containerRef.current;
    const candleSeries = candleSeriesRef.current;
    const prim = drawingsRef.current;
    if (!container || !candleSeries || !prim) return null;
    const rect = container.getBoundingClientRect();
    const time = prim.xToTime(clientX - rect.left);
    const price = candleSeries.coordinateToPrice(clientY - rect.top);
    if (time === null || price === null) return null;
    return { time, price };
  };
  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => pointFromClient(e.clientX, e.clientY);
  /** The same point, kept between the bars — the freehand kinds */
  const exactPointAt = (e: ReactPointerEvent<HTMLDivElement>): { time: number; price: number } | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    const candleSeries = candleSeriesRef.current;
    const prim = drawingsRef.current;
    if (!rect || !candleSeries || !prim) return null;
    const time = prim.xToTimeExact(e.clientX - rect.left);
    const price = candleSeries.coordinateToPrice(e.clientY - rect.top);
    return time === null || price === null ? null : { time, price };
  };

  /* A mark is never static. Outside draw mode the edit overlay is unmounted and the tape owns the pointer — so this
     capture-phase handler on the chart's own container is the marks' standing doorbell. */
  const onSleepingMarkDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drawing) return; // the overlay owns the pointer in draw mode
    const rect = containerRef.current?.getBoundingClientRect();
    const prim = drawingsRef.current;
    if (!rect || !prim) return;
    const hit = prim.hitTestAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    onEnterDraw?.();
    setDrawTool('select');
    setSelectedIdx(hit.index);
    prim.setSelected(hit.index);
    const start = pointFromClient(e.clientX, e.clientY);
    if (!start) return;
    editRef.current = { index: hit.index, anchor: hit.anchor, start, orig: shapesRef.current[hit.index], moved: false };
    const move = (ev: PointerEvent) => {
      const pt = pointFromClient(ev.clientX, ev.clientY);
      if (pt) applyEdit(pt);
    };
    const up = () => {
      if (editRef.current?.moved) saveDrawings(drawKey, shapesRef.current);
      editRef.current = null;
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const deleteSelected = useCallback(() => {
    setSelectedIdx(idx => {
      if (idx !== null && shapesRef.current[idx]) {
        shapesRef.current = shapesRef.current.filter((_, i) => i !== idx);
        drawingsRef.current?.setDrawings(shapesRef.current);
        saveDrawings(drawKey, shapesRef.current);
      }
      drawingsRef.current?.setSelected(null);
      return null;
    });
    editRef.current = null;
  }, [ticker]);

  /* Delete and backspace remove the selected mark — the key every drawing tool honours, beside the rail's bin. Not
     while typing a note. */
  useEffect(() => {
    if (selectedIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIdx, deleteSelected]);

  const onDrawDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointAt(e);
    if (!p) return;

    /* The select tool — the pointer that picks a mark up instead of making one. */
    if (drawTool === 'select') {
      const rect = containerRef.current?.getBoundingClientRect();
      const hit = rect ? drawingsRef.current?.hitTestAt(e.clientX - rect.left, e.clientY - rect.top) ?? null : null;
      if (!hit) {
        /* TV's exit — a press on empty tape doesn't just drop the selection, it leaves edit mode. The checkmark this
           replaced is gone from the rail. */
        deselect();
        onExitDraw?.();
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      setSelectedIdx(hit.index);
      drawingsRef.current?.setSelected(hit.index);
      editRef.current = { index: hit.index, anchor: hit.anchor, start: p, orig: shapesRef.current[hit.index], moved: false };
      return;
    }
    /* The click-move-click second press: the anchor in the hand lands. A three-anchor kind moves on to its width
       phase; the rest commit. */
    if (pendingSecondRef.current) {
      const base = pendingSecondRef.current;
      pendingSecondRef.current = null;
      if (needsThirdAnchor(base.kind)) {
        pendingThirdRef.current = { ...base, p2: p };
        drawingsRef.current?.setDraft({ ...base, p2: p });
        return;
      }
      /* The callout's second press is where its words will sit — they are typed next, the draft staying up behind
         the input */
      if (gestureOf(base.kind) === 'dragWords') {
        e.preventDefault();
        drawingsRef.current?.setDraft({ ...base, p2: p });
        setNoteAt({ time: p.time, price: p.price, x: e.clientX, y: e.clientY, kind: base.kind, base: { ...base, p2: p } });
        return;
      }
      drawingsRef.current?.setDraft(null);
      commitDrawing({ ...base, p2: p });
      return;
    }
    /* A third-anchor kind's second phase ends on this press: the third anchor (channel width, curve bend) has tracked
       the pointer since the base was drawn. */
    if (pendingThirdRef.current) {
      const base = pendingThirdRef.current;
      pendingThirdRef.current = null;
      drawingsRef.current?.setDraft(null);
      commitDrawing({ ...base, p3: p });
      return;
    }
    /* How the kind is made is the primitive's table (gestureOf), not a list kept here */
    const gesture = gestureOf(drawTool);
    if (gesture === 'click') {
      commitDrawing({ kind: drawTool, p1: p });
      return;
    }
    if (gesture === 'words') {
      /* The words come from a floating input at the click; Enter commits it. */
      e.preventDefault();
      setNoteAt({ time: p.time, price: p.price, x: e.clientX, y: e.clientY, kind: drawTool });
      return;
    }
    if (gesture === 'free') {
      const q = exactPointAt(e);
      if (!q) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      freeRef.current = { kind: drawTool, pts: [q], x: e.clientX, y: e.clientY };
      return;
    }
    if (gesture === 'clicks') {
      /* The path plots by clicks — each press adds a point; the draft's tail rides the cursor; the double-click
         handler below seals it with the head. */
      const run = pathDraftRef.current?.kind === drawTool ? pathDraftRef.current.pts : [];
      run.push(p);
      pathDraftRef.current = { kind: drawTool, pts: run };
      drawingsRef.current?.setDraft({ kind: drawTool, p1: run[0], pts: [...run, p] });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    /* Every two-anchor kind takes the same gesture; only what gets drawn between the anchors differs. */
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    dragRef.current = { kind: drawTool, p1: p, p2: p };
    drawingsRef.current?.setDraft(dragRef.current);
  };

  const onDrawDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drawTool === 'select' || gestureOf(drawTool) !== 'clicks' || !pathDraftRef.current) return;
    /* The seal — and the wrapper's own dblclick is resetView, which must not fire under a finished path. */
    e.stopPropagation();
    e.preventDefault();
    const { kind: runKind, pts: run } = pathDraftRef.current;
    pathDraftRef.current = null;
    drawingsRef.current?.setDraft(null);
    /* The double-click's two presses plotted the final point twice — consecutive same-bar points collapse to one. */
    const pts = run.filter((q, i2, arr) => i2 === 0 || q.time !== arr[i2 - 1].time);
    if (pts.length >= 2) commitDrawing({ kind: runKind, p1: pts[0], pts });
  };

  const applyEdit = (p: { time: number; price: number }) => {
    const ed = editRef.current;
    const prim = drawingsRef.current;
    if (!ed || !prim) return;
    /* A locked mark selects (that is how it gets unlocked) but never moves or reshapes — the bar's padlock is the
       only thing that can touch it. */
    if (shapesRef.current[ed.index]?.locked) return;
    let next: Drawing;
    if (ed.anchor !== null) {
      if (usesPts(ed.orig.kind) && ed.orig.pts) {
        const pts = ed.orig.pts.map((q, k2) => (k2 === ed.anchor ? p : q));
        next = { ...ed.orig, pts, p1: pts[0] };
      } else {
        next = ed.anchor === 0 ? { ...ed.orig, p1: p } : ed.anchor === 1 ? { ...ed.orig, p2: p } : { ...ed.orig, p3: p };
      }
    } else {
      /* A body drag moves the mark by the pointer's price shift and a whole number of bars, since anchored times must
         stay on the bar grid. */
      const dPrice = p.price - ed.start.price;
      const i0 = prim.barIndexOf(ed.start.time);
      const i1 = prim.barIndexOf(p.time);
      if (i0 === null || i1 === null) return;
      const k = i1 - i0;
      const shift = (q?: { time: number; price: number }) => {
        if (!q) return undefined;
        const bi = prim.barIndexOf(q.time);
        const t = bi === null ? null : prim.timeAtBarIndex(bi + k);
        return t === null ? q : { time: t, price: q.price + dPrice };
      };
      next = { ...ed.orig, p1: shift(ed.orig.p1)!, p2: shift(ed.orig.p2), p3: shift(ed.orig.p3) };
      if (usesPts(ed.orig.kind) && ed.orig.pts) {
        /* A freehand stroke's points sit between bars: they move by the same k bars and keep their place between
           them */
        const free = isFreehand(ed.orig.kind);
        const pts = ed.orig.pts.map(q => {
          if (!free) return shift(q) ?? q;
          const t = prim.shiftTimeExact(q.time, k);
          return t === null ? q : { time: t, price: q.price + dPrice };
        });
        next = { ...next, pts, p1: pts[0] };
      }
    }
    next = prim.normalise(next);
    ed.moved = true;
    shapesRef.current = shapesRef.current.map((d, i) => (i === ed.index ? next : d));
    prim.setDrawings(shapesRef.current);
  };

  const onDrawMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    /* The cursor says which edit this is. Over a mark's body — a move, position about to change — the pointing
       finger. Over an anchor circle — a reshape, geometry about to change — the plain arrow. */
    if (drawTool === 'select') {
      const edit = editRef.current;
      let cursor = 'crosshair';
      if (edit) {
        cursor = edit.anchor !== null ? 'default' : 'pointer';
      } else {
        const rect = containerRef.current?.getBoundingClientRect();
        const hover = rect ? drawingsRef.current?.hitTestAt(e.clientX - rect.left, e.clientY - rect.top) ?? null : null;
        if (hover) cursor = hover.anchor !== null ? 'default' : 'pointer';
      }
      e.currentTarget.style.cursor = cursor;
      if (!edit) return;
      const p = pointAt(e);
      if (p) applyEdit(p);
      return;
    }
    e.currentTarget.style.cursor = 'crosshair';
    /* Click-move-click: the line in the hand follows the pointer. */
    if (pendingSecondRef.current) {
      const p = pointAt(e);
      if (p) drawingsRef.current?.setDraft({ ...pendingSecondRef.current, p2: p });
      return;
    }
    /* A freehand stroke grows with the pointer — a point every couple of pixels, capped so a long scribble stays a
       light mark */
    if (freeRef.current) {
      const f = freeRef.current;
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < 2 || f.pts.length >= 800) return;
      const q = exactPointAt(e);
      if (!q) return;
      f.pts.push(q);
      f.x = e.clientX;
      f.y = e.clientY;
      drawingsRef.current?.setDraft({ kind: f.kind, p1: f.pts[0], pts: [...f.pts] });
      return;
    }
    /* The run's tail rides the pointer between clicks (the path, the polyline). */
    if (pathDraftRef.current && pathDraftRef.current.kind === drawTool) {
      const p = pointAt(e);
      if (p) drawingsRef.current?.setDraft({ kind: pathDraftRef.current.kind, p1: pathDraftRef.current.pts[0], pts: [...pathDraftRef.current.pts, p] });
      return;
    }
    /* Width phase: the draft is the base plus a p3 riding the pointer. */
    if (pendingThirdRef.current) {
      const p = pointAt(e);
      if (p) drawingsRef.current?.setDraft({ ...pendingThirdRef.current, p3: p });
      return;
    }
    if (!dragRef.current) return;
    const p = pointAt(e);
    if (!p) return;
    dragRef.current = { ...dragRef.current, p2: p };
    drawingsRef.current?.setDraft(dragRef.current);
  };

  /* A tool change or a mode exit abandons an unsealed path — half a path committing itself would be a mark nobody
     asked for. */
  useEffect(() => {
    if (pathDraftRef.current && pathDraftRef.current.kind !== drawTool) {
      pathDraftRef.current = null;
      drawingsRef.current?.setDraft(null);
    }
    /* The armed half-made line dies with the hand that held it. */
    if (pendingSecondRef.current && pendingSecondRef.current.kind !== drawTool) {
      pendingSecondRef.current = null;
      drawingsRef.current?.setDraft(null);
    }
  }, [drawTool]);
  useEffect(() => {
    if (!drawing && pathDraftRef.current) {
      pathDraftRef.current = null;
      drawingsRef.current?.setDraft(null);
    }
    if (!drawing && pendingSecondRef.current) {
      pendingSecondRef.current = null;
      drawingsRef.current?.setDraft(null);
    }
  }, [drawing]);

  const onDrawUp = (e?: ReactPointerEvent<HTMLDivElement>) => {
    if (editRef.current) {
      /* An edit is already applied live; release just makes it stored. */
      if (editRef.current.moved) saveDrawings(drawKey, shapesRef.current);
      editRef.current = null;
      return;
    }
    if (freeRef.current) {
      const f = freeRef.current;
      freeRef.current = null;
      drawingsRef.current?.setDraft(null);
      if (f.pts.length >= 2) commitDrawing({ kind: f.kind, p1: f.pts[0], pts: f.pts });
      return;
    }
    const d = dragRef.current;
    const origin = dragOriginRef.current;
    dragRef.current = null;
    dragOriginRef.current = null;
    if (!d || !d.p2) return;
    /* A real drag, measured in pixels — time/price deltas lied here: one bar of jitter on a quick click committed a
       degenerate arrow ("plops the entire thing down"). */
    const real = !!origin && !!e && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= 5;
    if (!real) {
      pendingSecondRef.current = { kind: d.kind, p1: d.p1 };
      drawingsRef.current?.setDraft(d);
      return;
    }
    /* A three-anchor kind is not finished at release — the base is. The draft stays, the third-anchor phase begins
       (the channel's width, the curve's bend), and the next press commits (onDrawDown). */
    if (needsThirdAnchor(d.kind)) {
      pendingThirdRef.current = d;
      drawingsRef.current?.setDraft(d);
      return;
    }
    /* The callout was dragged from what it points at to where it sits — its words are typed there next */
    if (gestureOf(d.kind) === 'dragWords' && e) {
      drawingsRef.current?.setDraft(d);
      setNoteAt({ time: d.p2.time, price: d.p2.price, x: e.clientX, y: e.clientY, kind: d.kind, base: d });
      return;
    }
    drawingsRef.current?.setDraft(null);
    commitDrawing(d);
  };

  return (
    <div className="flex flex-col h-full">
      {/* No legend row — the chart owns the whole widget; inks are taught by the field itself, dbl-click resets the
          view */}
      <div
        className={`relative flex-grow overflow-hidden ${
          frameless ? '' : 'border border-borderSubtle bg-inset rounded-md'
        }`}
        style={{ minHeight: height }}
        ref={setBoxEl}
        onPointerEnter={() => {
          boxRectRef.current = null;
          touchDrawChart(chartId);
        }}
        /* Everything in this box sits on the chart's dark ground and stamps the theme this chart resolved, so the
           pills and legend inside wear it. */
        data-theme="dark"
        data-chart-ink
        data-chart-ground={chartGround(themeKey)}
        onDoubleClick={resetView}
        onPointerDownCapture={e => {
          downAtRef.current = { x: e.clientX, y: e.clientY };
        }}
        onClickCapture={e => {
          /* A bead kept: a click on a bead of the field keeps its strike — the chain, the host's focus — and its
             card stands still with more; a click elsewhere lets the card go. */
          if (picking || drawing) return;
          if ((e.target as HTMLElement).closest('[data-bead-card], [data-key-level-card], [data-chart-chrome], [data-axis-chips], button, a')) return;
          const down = downAtRef.current;
          downAtRef.current = null;
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
          const tr = trailsRef.current;
          const rect = e.currentTarget.getBoundingClientRect();
          const plotW = chartRef.current?.paneSize(0).width ?? rect.width;
          const px = e.clientX - rect.left;
          const hit = tr && tr.enabled && px >= 0 && px < plotW ? tr.beadAt(px, e.clientY - rect.top) : null;
          if (hit) {
            setPinnedBead({ hit, x: e.clientX, y: e.clientY });
            beadCell.set(null);
            tr?.setHover(null);
            onKeepStrike?.(hit.strike);
          } else if (pinnedBeadRef.current) {
            setPinnedBead(null);
          }
        }}
        onWheelCapture={() => {
          wheelAtRef.current = performance.now();
        }}
        onMouseMove={e => {
          pointerAtRef.current = { x: e.clientX, y: e.clientY };
          /* No hover reads while the view is moving under the pointer — a drag (a button down) or a wheel zoom:
             every move would land on another bead, and the cards would flicker through the gesture. */
          if (e.buttons !== 0 || performance.now() - wheelAtRef.current < 200) {
            trailsRef.current?.setHover(null);
            beadCell.set(null);
            coneCell.set(null);
            eventsPrimRef.current?.setHovered(null);
            eventCell.set(null);
            return;
          }
          const rect = boxRect(e.currentTarget);
          /* The field's bead under the pointer: one hit test a move, the primitive's hover written only when the
             bead changes; nothing while a bead is kept or a rung's card is up */
          const tr = trailsRef.current;
          const plotW = chartRef.current?.paneSize(0).width ?? rect.width;
          const px = e.clientX - rect.left;
          const bead = tr && tr.enabled && !pinnedBeadRef.current && !levelCell.get() && px >= 0 && px < plotW ? tr.beadAt(px, e.clientY - rect.top) : null;
          tr?.setHover(bead);
          beadCell.set(prev => (bead === null ? (prev === null ? prev : null) : prev && prev.strike === bead.strike && prev.time === bead.time ? prev : bead));
          const coneHit = !bead && overlays.cone ? conePrimRef.current?.probe(px, e.clientY - rect.top) ?? null : null;
          coneCell.set(prev => {
            if (!coneHit) return prev === null ? prev : null;
            if (prev && prev.up1 === coneHit.up1 && prev.band === coneHit.band && prev.horizon === coneHit.horizon) return prev;
            return coneHit;
          });
          /* The event lane's hover — resolved here because canvas glyphs cannot be hovered and the card wants real
             type. Cheap: one hit test per move, state written only when the answer changes. */
          const prim = eventsPrimRef.current;
          if (!prim?.data) return;
          const plotH = chartRef.current?.paneSize(0).height ?? rect.height;
          const hit = prim.eventAtX(e.clientX - rect.left, e.clientY - rect.top, plotH);
          prim.setHovered(hit);
          eventCell.set(prev => {
            if (hit === null) return prev === null ? prev : null;
            const x = prim.xOf(hit);
            if (x === null) return null;
            return prev?.e === hit ? prev : { e: hit, x };
          });
        }}
        onMouseLeave={() => {
          eventsPrimRef.current?.setHovered(null);
          eventCell.set(null);
          trailsRef.current?.setHover(null);
          beadCell.set(null);
          coneCell.set(null);
        }}
      >
        {picking && pickFade && (
          <>
            <div ref={pickFadeRef} aria-hidden className="absolute top-0 z-[5] pointer-events-none" style={{ left: pickXRef.current, right: pickFade.right, bottom: pickFade.bottom, background: 'rgba(10,10,10,0.72)' }} data-pick-fade />
            <div ref={pickLineRef} aria-hidden className="absolute top-0 z-[6] w-px pointer-events-none" style={{ left: pickXRef.current, bottom: pickFade.bottom, background: 'rgba(199,211,232,0.9)' }} data-pick-line />
            {/* The bar's day and minute under the line — its text moves through the ref with the pointer */}
            <div ref={pickLabelRef} aria-hidden className="absolute z-[6] -translate-x-1/2 px-1.5 py-0.5 rounded-[3px] font-mono text-t10 tnum whitespace-nowrap pointer-events-none" style={{ left: pickXRef.current, bottom: pickFade.bottom + 4, background: '#C7D3E8', color: '#0a0a0a' }} data-pick-label>
              {ownLabelRef.current}
            </div>
          </>
        )}
        <canvas ref={hoverCanvasRef} aria-hidden className="absolute left-0 top-0 z-[3] pointer-events-none" />
        <div ref={containerRef} className={`absolute inset-0 ${picking ? 'cursor-crosshair' : ''}`} onPointerDownCapture={onSleepingMarkDown} data-pick-time={picking ? '' : undefined} data-replay-idx={replay ? replayIdx : undefined} data-replay-len={replay ? (replayDataRef.current?.bars.length ?? 0) : undefined} data-replay-time={replay && replayTime != null ? replayTime : undefined} data-replay-debug={replay ? replayDebug : undefined} data-tv-mark-beside={markBeside ? '' : undefined} />
        {sessionNote && !replay && !quiet && (
          <p className="absolute left-1/2 z-[4] -translate-x-1/2 max-w-[360px] truncate rounded-md border border-borderSubtle bg-canvas/85 px-2 py-1 font-mono text-t10 text-textSecondary pointer-events-none" style={{ top: chromeInset > 0 ? chromeInset + 6 : 8 }} data-session-note>
            {sessionNote}
          </p>
        )}
        {quiet && !replay && (
          <div className="absolute inset-0 z-[4] flex items-center justify-center pointer-events-none" data-chart-empty>
            <div className="max-w-[280px] rounded-md border border-borderSubtle bg-canvas/85 px-4 py-3 text-center">
              <p className="font-mono text-t11 text-textPrimary">{tape?.note || sessionNote || 'No bars for this name'}</p>
              <p className="mt-1 font-mono text-t10 text-textMuted">{quote ? `Quote ${quote.bid.toFixed(2)} × ${quote.ask.toFixed(2)}. No prints in this session.` : tape?.note && !/offline/i.test(tape.note) ? `${etWindow(session)}.` : 'This frame stays. Bars fill it when the tape answers.'}</p>
            </div>
          </div>
        )}
        {/* The host's layer (Review's position, target and stop) — over the plot, under the chrome */}
        {layer?.({ chart: () => chartRef.current, series: () => candleSeriesRef.current as ISeriesApi<SeriesType> | null, host: () => containerRef.current, room: layerRoom, reset: resetView })}
        {/* The way home — pill, right-click card, Alt+R */}
        {/* …and above a host's own chrome at the foot */}
        <ResetViewControl onReset={resetView} pillClass={footInset > 0 ? 'right-16 bottom-20' : undefined} />
        {/* The scripts on this pane, named at the top left with hide and remove */}
        {paneId && paneScripts.length > 0 && !replay && <ScriptLegend paneId={paneId} scripts={paneScripts} />}
        {/* Every band says its own name, the way the reference does. An unlabelled strip under a chart is a puzzle;
            `pointer-events-none` so the tape still pans straight through them. */}
        {paneLabels.map(l => {
          const text = PANE_LABEL_LOOK[l.key];
          if (!text) return null;
          return (
            <span
              key={l.key}
              aria-hidden
              className="pointer-events-none absolute left-2 z-10 font-mono text-t9 uppercase tracking-wider text-textMuted"
              style={{ top: l.top }}
            >
              {text}
            </span>
          );
        })}


        {/* The pane's own fired chip left on: the shell shows one chip for a firing wherever the reader is
            (components/alerts/AlertToasts.tsx), so a chart of the name no longer says it twice. */}

        {/* Pinned to the container's right edge and moved down it by transform, so it rides the price scale rather
            than being re-laid out. */}
        {priceTag && !replay && (
          <div
            ref={priceTagRef}
            aria-hidden
            /* The card wears the chart's ground, like its words. */
            /* The card is the library's label size: one line at the axis's 12px, as wide as the axis; the countdown
               line stays in the DOM but hidden. */
            className="pointer-events-none absolute top-0 right-0 z-10 will-change-transform rounded-[2px] border border-ink/[0.07] border-l-2 border-l-ink/60 bg-panel/95 pl-[8px] pr-0.5 py-px text-left whitespace-nowrap opacity-0 shadow-sm shadow-black/40"
            data-price-tag
          >
            <div className="font-mono text-t12 font-bold leading-[14px] tnum text-textPrimary" />
            <div className="hidden font-mono text-t9 leading-[11px] tnum text-textMuted" />
          </div>
        )}

        {/* Draw mode: pointer sketches instead of panning */}
        {drawing && (
          <div
            className="absolute inset-0 z-20 cursor-crosshair touch-none"
            onPointerDown={onDrawDown}
            onDoubleClick={onDrawDblClick}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawUp}
          />
        )}
        {!compact && (drawing || onEnterDraw) && !rail.open && (
          /* The way back — a slim tab at the docked edge, always there, so a hidden toolbar is one click from found
             (TV's collapse grammar). */
          <button
            onClick={() => setRailPrefs({ open: true })}
            title="Show the drawing tools"
            aria-label="Show the drawing tools"
            /* Black on any tape, like the rail it opens (index.css) */
            data-chart-rail
            className={`absolute ${rail.dock === 'top' ? 'z-40' : 'z-30'} border border-borderMuted bg-panel/60 backdrop-blur-md text-textSecondary hover:text-textPrimary shadow-lg shadow-black/40 transition-[opacity,color] duration-300 opacity-55 hover:opacity-100 ${
              rail.dock === 'left'
                ? 'left-0 top-1/2 -translate-y-1/2 rounded-r-md border-l-0 px-1 py-2.5'
                : /* the tab hangs from the pane's top edge, in the strip's middle, over the strip */
                  `top-0 rounded-b-md border-t-0 px-2.5 py-1 ${gap ? '' : 'left-[calc(50%-48px)] -translate-x-1/2'}`
            }`}
            style={rail.dock === 'top' && gap ? { left: gap.left + gap.width / 2, transform: 'translateX(-50%)' } : undefined}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {!compact && (drawing || onEnterDraw) && rail.open && (
          /* The tool rail — persistent, and the reader's to place. Solid, not ghost chrome. Clicking any tool arms
             draw mode with that tool in hand; while drawing it grows its editing tail. */
          <div
            ref={railRef}
            /* Glass, and only loud in the hand. */
            /* AT rest it must still be found: the 20% whisper read as gone on his screen. The identity row's rest-
               dim, 55%, is the house's "quiet but there"; hover, focus and drawing still bring it to full. */
            /* Black on any tape — the rail pins the dark tokens on itself while the chrome around it follows the
               chart's ground (index.css [data-chart-rail]). */
            data-chart-rail
            className={`absolute ${rail.dock === 'top' ? 'z-40' : 'z-30'} border border-borderMuted bg-panel/60 backdrop-blur-md backdrop-saturate-150 rounded-md p-1 shadow-xl shadow-black/50 select-none flex items-stretch ${rail.dock === 'top' ? 'gap-px' : 'gap-0.5'} transition-opacity duration-300 ${
              drawing ? 'opacity-100' : 'opacity-55 hover:opacity-100 focus-within:opacity-100'
            } ${
              rail.dock === 'left'
                ? /* 44 wide: a 24px icon column with a 10px arrow column beside it, so a family's arrow sits right of its icon */
                  /* …58 on a touch screen, where the arrow column is 24 (DrawRailTools) */
                  'left-1.5 top-1/2 -translate-y-1/2 w-[44px] [@media(pointer:coarse)]:w-[58px] max-h-[92%] overflow-y-auto flex-col'
                : /* Left of true centre: the right-hand strip cluster reaches further into the middle than the left one */
                  /* In the strip's empty middle: the top dock exists only in the takeovers, and each of them has a
                     44px strip with clusters at both ends. */
                  `top-1.5 h-[34px] overflow-x-auto flex-row ${gap ? '' : 'left-[calc(50%-48px)] -translate-x-1/2 max-w-[94%]'}`
            }`}
            style={rail.dock === 'left' ? leftDockStyle : topDockStyle}
          >
            <button
              onClick={() => setDrawTool('select')}
              title="Select — click a drawing to move or delete it"
              aria-label="Select"
              aria-pressed={drawTool === 'select'}
              className={`inline-flex items-center justify-center rounded transition-colors shrink-0 ${
                rail.dock === 'left' ? `h-[26px] ${RAIL_ARROW_PAD}` : 'w-[24px]'
              } ${
                drawing && drawTool === 'select'
                  ? 'bg-select/15 text-select'
                  : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04]'
              }`}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
            </button>
            {/* One button a family — the rail was thirteen tools long; it is five families, the search and the star,
                and holds thirty-four */}
            <DrawRailTools dock={rail.dock} drawing={drawing} drawTool={drawTool} onPick={pickTool} host={boxEl} sheetOpen={sheetOpen} onSheet={setSheetOpen} />
            {drawing && (
              <>
                <div className={rail.dock === 'left' ? 'mx-1 my-0.5 h-px bg-borderMuted' : 'my-1 mx-0.5 w-px bg-borderMuted'} aria-hidden />
                <button
                  onClick={deleteSelected}
                  disabled={selectedIdx === null}
                  title="Delete the selected drawing"
                  aria-label="Delete selected"
                  className={`inline-flex items-center justify-center rounded transition-colors shrink-0 text-textSecondary enabled:hover:text-textPrimary enabled:hover:bg-ink/[0.04] disabled:opacity-30 disabled:cursor-default ${
                    rail.dock === 'left' ? `h-[26px] ${RAIL_ARROW_PAD}` : 'w-[24px]'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={clearDrawings}
                  title="Clear all drawings"
                  aria-label="Clear all drawings"
                  className={`inline-flex items-center justify-center rounded transition-colors shrink-0 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] ${
                    rail.dock === 'left' ? `h-[26px] ${RAIL_ARROW_PAD}` : 'w-[24px]'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <div className={rail.dock === 'left' ? 'mx-1 my-0.5 h-px bg-borderMuted' : 'my-1 mx-0.5 w-px bg-borderMuted'} aria-hidden />
            {/* Offered only where the top dock would actually apply — a button that silently does nothing is worse
                than no button. */}
            {rail.canTop && <button
              onClick={() => setRailPrefs({ dock: rail.dock === 'left' ? 'top' : 'left' })}
              title={rail.dock === 'left' ? 'Move the tools to the top' : 'Move the tools to the left side'}
              aria-label={rail.dock === 'left' ? 'Move the tools to the top' : 'Move the tools to the left side'}
              className={`inline-flex items-center justify-center rounded transition-colors shrink-0 text-textMuted hover:text-textPrimary hover:bg-ink/[0.04] ${
                rail.dock === 'left' ? `h-[26px] ${RAIL_ARROW_PAD}` : 'w-[24px]'
              }`}
            >
              {rail.dock === 'left' ? <PanelTop className="w-3.5 h-3.5" /> : <PanelLeft className="w-3.5 h-3.5" />}
            </button>}
            <button
              onClick={() => setRailPrefs({ open: false })}
              title="Hide the tools — the small tab at the edge brings them back"
              aria-label="Hide the tools"
              className={`inline-flex items-center justify-center rounded transition-colors shrink-0 text-textMuted hover:text-textPrimary hover:bg-ink/[0.04] ${
                rail.dock === 'left' ? `h-[26px] ${RAIL_ARROW_PAD}` : 'w-[24px]'
              }`}
            >
              {rail.dock === 'left' ? <ChevronsLeft className="w-3.5 h-3.5" /> : <ChevronsUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
        {/* ON A narrow pane the sheet is the toolbar: the rail is off there, and until now the only door to drawing
            was the `d` key — which a phone has not got. A slim tab at the edge opens every tool as a bottom sheet. */}
        {compact && (drawing || onEnterDraw) && (
          <button
            onClick={() => setSheetOpen(o => !o)}
            title="Drawing tools"
            aria-label="Drawing tools"
            aria-expanded={sheetOpen}
            data-chart-rail
            data-draw-sheet-door
            className="absolute z-30 left-0 top-1/2 -translate-y-1/2 rounded-r-md border border-l-0 border-borderMuted bg-panel/60 backdrop-blur-md px-1 py-2.5 text-textSecondary hover:text-textPrimary shadow-lg shadow-black/40 transition-colors"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {sheetOpen && boxEl && <DrawSheet host={boxEl} dock={rail.dock} drawTool={drawing ? drawTool : 'select'} onPick={pickTool} onClose={() => setSheetOpen(false)} />}
        {drawing && selectedIdx !== null && shapesRef.current[selectedIdx] && (() => {
          const m = shapesRef.current[selectedIdx];
          /* On a note the 1–4 width field is type size, not stroke — the picker relabels itself and previews
             letters; the dash picker hides (a note has no line to dash). */
          const isNote = isWordsKind(m.kind);
          /* Twenty inks in four rows — neutrals, warms, greens/cools, blues/violets. The reader's marks are theirs,
             so the wheel here is broader than the house tokens. */
          const swatches = [
            '#0A0A0A', '#FFFFFF', '#C7D3E8', '#9CA3AF', '#64748B',
            '#FF3B30', '#FF6B4A', '#FF9500', '#F5C542', '#FFE08A',
            '#D2FF00', '#30D158', '#2DD4BF', '#3DD6E8', '#7DD3FC',
            '#5B9CF6', '#6366F1', '#A78BFA', '#EA00FF', '#FF5EA8',
          ];
          const btn = (on: boolean) =>
            `inline-flex items-center justify-center h-6 min-w-[24px] px-1 rounded transition-colors ${
              on ? 'bg-select/15 text-select' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
            }`;
          const pop = 'absolute left-0 top-full mt-1 z-50 border border-borderMuted bg-panel rounded-md shadow-2xl shadow-black/60 animate-slide-in';
          return (
            <div
              className={`absolute z-40 flex items-center gap-0.5 border border-borderMuted bg-panel/75 backdrop-blur-md backdrop-saturate-150 rounded-md p-1 shadow-xl shadow-black/50 select-none ${
                barPos ? '' : `left-1/2 -translate-x-1/2 ${rail.dock === 'top' && rail.open ? 'top-12' : 'top-2'}`
              }`}
              style={barPos ? { left: barPos.x, top: barPos.y } : undefined}
            >
              <span
                onPointerDown={onBarGripDown}
                title="Drag to move this bar"
                className="inline-flex items-center justify-center h-6 w-4 cursor-grab active:cursor-grabbing text-textMuted"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>

              <span className="relative">
                <button onClick={() => setBarMenu(mn => (mn === 'color' ? null : 'color'))} title="Line color" className={btn(barMenu === 'color')}>
                  {/* The dot shows the ink the mark wears — its own, or the ground's rest ink */}
                  <span className="w-3.5 h-3.5 rounded-full border border-ink/25" style={{ background: m.color ?? (chartGround(themeKey) === 'light' ? '#0A0A0A' : '#EDEDED') }} />
                </button>
                {barMenu === 'color' && (
                  <span className={`${pop} grid grid-cols-[repeat(5,20px)] gap-1 p-1.5`}>
                    {swatches.map(c => (
                      <button
                        key={c}
                        onClick={() => {
                          updateSelected({ color: c });
                          setBarMenu(null);
                        }}
                        title={c}
                        className="w-5 h-5 rounded-full border border-ink/20 hover:scale-110 transition-transform"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                )}
              </span>

              <span className="relative">
                <button onClick={() => setBarMenu(mn => (mn === 'tcolor' ? null : 'tcolor'))} title="Text color" className={btn(barMenu === 'tcolor')}>
                  <span className="inline-flex flex-col items-center leading-none">
                    <Type className="w-3 h-3" />
                    <span className="mt-px h-[2px] w-3 rounded-full" style={{ background: m.textColor ?? m.color ?? '#EDEDED' }} />
                  </span>
                </button>
                {barMenu === 'tcolor' && (
                  <span className={`${pop} grid grid-cols-[repeat(5,20px)] gap-1 p-1.5`}>
                    {swatches.map(c => (
                      <button
                        key={c}
                        onClick={() => {
                          updateSelected({ textColor: c });
                          setBarMenu(null);
                        }}
                        title={c}
                        className="w-5 h-5 rounded-full border border-ink/20 hover:scale-110 transition-transform"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                )}
              </span>

              <span className="relative">
                <button
                  onClick={() => setBarMenu(mn => (mn === 'width' ? null : 'width'))}
                  title={isNote ? 'Text size' : 'Line weight'}
                  className={`${btn(barMenu === 'width')} gap-1`}
                >
                  {isNote ? (
                    <span className="font-semibold leading-none" style={{ fontSize: 9 + ((m.width ?? 2) - 1) * 2 }}>
                      Aa
                    </span>
                  ) : (
                    <>
                      <span className="w-4 border-t border-current" style={{ borderTopWidth: m.width ?? 2 }} />
                      <span className="font-mono text-t9 tnum">{m.width ?? 2}px</span>
                    </>
                  )}
                </button>
                {barMenu === 'width' && (
                  <span className={`${pop} p-1 flex flex-col gap-0.5`}>
                    {[1, 2, 3, 4].map(wd => (
                      <button
                        key={wd}
                        onClick={() => {
                          updateSelected({ width: wd });
                          setBarMenu(null);
                        }}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink/[0.05] ${
                          (m.width ?? 2) === wd ? 'bg-ink/[0.08]' : ''
                        }`}
                      >
                        {isNote ? (
                          <>
                            <span className="w-8 text-textPrimary font-semibold leading-none" style={{ fontSize: 8 + wd * 2 }}>
                              Aa
                            </span>
                            <span className="font-mono text-t10 text-textPrimary">
                              {['Small', 'Medium', 'Large', 'Huge'][wd - 1]}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="w-6 border-t border-current text-textPrimary" style={{ borderTopWidth: wd }} />
                            <span className="font-mono text-t10 tnum text-textPrimary">{wd}px</span>
                          </>
                        )}
                      </button>
                    ))}
                  </span>
                )}
              </span>

              {!isNote && (
              <span className="relative">
                <button onClick={() => setBarMenu(mn => (mn === 'style' ? null : 'style'))} title="Line style" className={btn(barMenu === 'style')}>
                  <span
                    className="w-4 border-t-2 border-current"
                    style={{ borderTopStyle: (m.style ?? 'solid') === 'solid' ? 'solid' : m.style === 'dashed' ? 'dashed' : 'dotted' }}
                  />
                </button>
                {barMenu === 'style' && (
                  <span className={`${pop} p-1 flex flex-col gap-0.5 min-w-[124px]`}>
                    {(
                      [
                        { key: 'solid', label: 'Line', css: 'solid' },
                        { key: 'dashed', label: 'Dashed line', css: 'dashed' },
                        { key: 'dotted', label: 'Dotted line', css: 'dotted' },
                      ] as const
                    ).map(o => (
                      <button
                        key={o.key}
                        onClick={() => {
                          updateSelected({ style: o.key });
                          setBarMenu(null);
                        }}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink/[0.05] ${
                          (m.style ?? 'solid') === o.key ? 'bg-ink/[0.08]' : ''
                        }`}
                      >
                        <span className="w-6 border-t-2 border-current text-textPrimary" style={{ borderTopStyle: o.css }} />
                        <span className="font-mono text-t10 text-textPrimary whitespace-nowrap">{o.label}</span>
                      </button>
                    ))}
                  </span>
                )}
              </span>
              )}

              <span className="mx-0.5 w-px h-4 bg-borderMuted" aria-hidden />

              <button
                onClick={() => updateSelected({ locked: !m.locked })}
                title={m.locked ? 'Unlock — allow moving again' : 'Lock in place — timeframes and drags cannot move it'}
                aria-pressed={!!m.locked}
                className={btn(!!m.locked)}
              >
                {m.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
              <button onClick={deleteSelected} title="Delete this mark only" className={btn(false)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              {/* A long or a short is a trade: its entry, its target and its stop, handed to the desk */}
              {onTradeMark && (m.kind === 'long' || m.kind === 'short') && m.p2 && (
                <>
                  <span className="mx-0.5 w-px h-4 bg-borderMuted" aria-hidden />
                  <button
                    onClick={() => onTradeMark({ kind: m.kind as 'long' | 'short', entry: m.p1.price, target: m.p2!.price, stop: m.p3 ? m.p3.price : defaultStop(m.p1.price, m.p2!.price) })}
                    title={`Place this ${m.kind} — an order at its entry, its target and its stop riding it`}
                    className="inline-flex items-center h-6 px-2.5 rounded-full text-t11 font-semibold transition-opacity hover:opacity-90"
                    style={{ background: 'rgb(var(--silver-fill))', color: '#0a0a0a' }}
                    data-chart-trade-mark={m.kind}
                  >
                    Place it
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {drawing && (
          /* The active tool, named beside the rail — aria-live so a reader hears the hand change too. */
          <div
            aria-live="polite"
            className={`absolute z-30 pointer-events-none rounded border border-borderMuted bg-panel/95 px-1.5 py-0.5 font-mono text-t9 font-semibold uppercase tracking-widest text-select shadow-lg shadow-black/40 ${
              rail.dock === 'left' || !rail.open ? 'left-[54px] top-1/2 -translate-y-1/2' : 'top-11 left-[calc(50%-48px)] -translate-x-1/2'
            }`}
          >
            {drawTool === 'select' ? 'Select' : drawToolLabel(drawTool)}
          </div>
        )}

        {/* The note's words — a floating input at the click, draw mode only. An input rather than a prompt, because a
            prompt steals focus from the page and cannot be styled to say where the note will land. */}
        {drawing && noteAt && (
          <div
            className="absolute z-40"
            style={{
              left: Math.max(4, Math.min(noteAt.x - (containerRef.current?.getBoundingClientRect().left ?? 0), (containerRef.current?.clientWidth ?? 400) - 190)),
              top: Math.max(4, Math.min(noteAt.y - (containerRef.current?.getBoundingClientRect().top ?? 0) - 14, (containerRef.current?.clientHeight ?? 300) - 36)),
            }}
          >
            <input
              autoFocus
              type="text"
              maxLength={80}
              placeholder={noteAt.kind === 'note' ? 'note, Enter to place' : 'words, Enter to place'}
              aria-label="The mark's words — Enter places them where you clicked"
              className="w-[184px] px-2 py-1 rounded border border-select/60 bg-panel/95 font-mono text-t11 text-textPrimary placeholder:text-textMuted shadow-xl shadow-black/50 outline-none"
              onKeyDown={e => {
                /* The desk's own keys (p, d, s, the arrows) must not fire while typing — the desk's guard checks the
                   target, but stopping here keeps Escape from also collapsing a pane. */
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const text = (e.target as HTMLInputElement).value.trim();
                  if (text) commitDrawing(noteAt.base ? { ...noteAt.base, text } : { kind: noteAt.kind, p1: { time: noteAt.time, price: noteAt.price }, text });
                  drawingsRef.current?.setDraft(null);
                  setNoteAt(null);
                }
                if (e.key === 'Escape') {
                  drawingsRef.current?.setDraft(null);
                  setNoteAt(null);
                }
              }}
              onBlur={() => {
                /* The callout's draft was kept up behind the input — walking away takes it down with the words */
                if (noteAt.base) drawingsRef.current?.setDraft(null);
                setNoteAt(null);
              }}
            />
          </div>
        )}

        {/* The honesty chip: a sub-minute pane shows only what has actually printed since the app connected, and the
            empty region to the left is explained rather than silently blank. */}
        {liveFrom !== null && (
          <span className="absolute bottom-12 left-2 z-10 pointer-events-none font-mono text-t9 uppercase tracking-wider text-textMuted bg-canvas/60 border border-borderSubtle/60 rounded px-1.5 py-0.5">
            {liveFrom === 0
              ? 'live only · awaiting first prints'
              : `live only · from ${new Date(liveFrom * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`}
          </span>
        )}

        {/* The card on a rung of the key levels' ladder: the level's name, its price in its ink, how far from spot,
            and one line on what it does to price — the house's pointer card, as on the Compass marks */}
        <CellView cell={levelCell}>{levelCard =>
          levelCard &&
          (() => {
            const w = KEY_LEVEL_WORDS[levelCard.key];
            const ink = ladderRef.current?.data?.rungs.find(r => r.key === levelCard.key)?.ink;
            /* A rung standing on another level's price says so: "Supreme · on the put wall" */
            const shared = ladderRef.current?.sharedWith(levelCard.key) ?? [];
            const aside = shared.length ? `on the ${shared.map(k => KEY_LEVEL_WORDS[k].name.toLowerCase()).join(' and the ')}` : w.aside;
            const spot = lastCloseRef.current ?? levels.spot;
            const dist = Number.isFinite(spot) && spot > 0 ? ((levelCard.price - spot) / spot) * 100 : null;
            return (
              <PointerFollowCard start={{ x: levelCard.x, y: levelCard.y }} width={204} testId="data-key-level-card" testValue={levelCard.key} title={w.name} aside={aside}>
                <CardRow k="Price" v={levelCard.price.toFixed(2)} ink={ink} />
                {dist != null && <CardRow k="From spot" v={`${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}%`} sub={dist >= 0 ? 'above' : 'below'} />}
                <span className="col-span-2 mt-0.5 text-textSecondary leading-snug">{w.line}</span>
              </PointerFollowCard>
            );
          })()}
        </CellView>

        {/* The bead's card: the strike under the pointer, its moment, the greek with its side, its share of the book,
            and the change since the open; a click pins it. */}
        <CellView cell={beadCell}>{beadCard =>
          (pinnedBead?.hit ?? beadCard) &&
          (() => {
            const b = pinnedBead?.hit ?? beadCard!;
            const kept = !!pinnedBead;
            const tr = trailsRef.current;
            /* the cell is the open-interest book's last reading in the bar, or the change in today's flow gamma across it */
            const greekWord = fieldMode === 'flow' ? 'Flow in bar' : trailsGreek === 'gex' ? 'Gamma' : trailsGreek === 'dex' ? 'Delta' : 'Vega $';
            /* The side as the figure's sub, what it does as a line of its own — on the value's line the words ran
               past the card's edge and dragged every figure with them */
            const side = b.value >= 0 ? 'positive' : 'negative';
            const does =
              fieldMode === 'flow'
                ? b.value >= 0
                  ? "Today's trades left dealers longer gamma across this bar."
                  : "Today's trades left dealers shorter gamma across this bar."
                : b.value >= 0
                  ? 'Dealers long gamma: their hedging holds a move back.'
                  : 'Dealers short gamma: their hedging pushes a move along.';
            const markWord = b.mark === 'born' ? 'Born' : b.mark === 'grew' ? 'Grew' : b.mark === 'flipped' ? 'Flipped' : b.mark === 'died' ? 'Died' : null;
            const tagWord = b.tag === 'absorbed' ? 'Held' : b.tag === 'rejected' ? 'Off' : b.tag === 'broke' ? 'Broke' : null;
            const ink = b.value >= 0 ? BEAD_INK_CSS.put : BEAD_INK_CSS.call;
            const since = b.open == null ? null : b.value - b.open;
            const rank = kept && tr ? tr.rankAt(b.ci, b.strike) : null;
            const before = kept && tr ? tr.valueBefore(b.ci, b.strike, 30 * 60) : null;
            const bars = replayDataRef.current?.bars ?? baseBars() ?? [];
            let bi = bars.length - 1;
            while (bi > 0 && bars[bi].time > b.time) bi--;
            const closeThen = kept && bi >= 0 && bars[bi] && bars[bi].time <= b.time ? bars[bi].close : null;
            const dist = closeThen != null && closeThen > 0 ? ((b.strike - closeThen) / closeThen) * 100 : null;
            const rows = (
              <>
                <CardRow k={greekWord} v={fmtUsd(b.value)} ink={ink} sub={side} />
                {markWord && <CardRow k="Node" v={markWord} />}
                {tagWord && <CardRow k="Price" v={tagWord} sub="ten minutes" />}
                {b.firm === false && <CardRow k="Flow" v="thin" sub="net under 2% of the volume" />}
                <CardRow k="Of the book" v={`${(b.share * 100).toFixed(1)}%`} sub="then" />
                {fieldMode === 'oi' && <CardRow k="Since the open" v={since == null ? '—' : `${since >= 0 ? '+' : '−'}${fmtUsd(Math.abs(since))}`} />}
                {kept && rank && <CardRow k="Rank then" v={`${rank.rank} of ${rank.of}`} />}
                {kept && closeThen != null && <CardRow k="Price then" v={closeThen.toFixed(2)} sub={dist != null ? `${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}% away` : undefined} />}
                {kept && before && <CardRow k="30 min before" v={`${b.value - before.value >= 0 ? '+' : '−'}${fmtUsd(Math.abs(b.value - before.value))}`} sub={`since ${nyClock(before.time * 1000)}`} />}
                <span className="col-span-2 mt-0.5 text-textSecondary leading-snug">{does}</span>
              </>
            );
            const foot = <span className="text-textMuted">{kept ? letGoWords() : 'click to keep the strike'}</span>;
            const title = fmtStrike(b.strike);
            const aside = `${nyClock(b.time * 1000)} ET`;
            return kept ? (
              <PointerCard x={pinnedBead!.x} y={pinnedBead!.y} width={176} dense still testId="data-bead-card" testValue={`${b.strike}`} title={title} aside={aside} foot={foot}>
                {rows}
              </PointerCard>
            ) : (
              <PointerFollowCard start={pointerAtRef.current} width={176} dense testId="data-bead-card" testValue={`${b.strike}`} title={title} aside={aside} foot={foot}>
                {rows}
              </PointerFollowCard>
            );
          })()}
        </CellView>

        <CellView cell={coneCell}>{coneCard => (
        <CellView cell={beadCell}>{beadCard => coneCard && !beadCard && !pinnedBead && (
          <PointerFollowCard
            start={pointerAtRef.current}
            width={176}
            dense
            testId="data-cone-card"
            title={coneCard.horizon}
            aside={coneCard.band === 1 ? 'inside 1σ' : 'inside 2σ'}
          >
            <CardRow k="±1σ" v={`${(coneCard.up1 - coneCard.spot).toFixed(2)}`} sub={coneCard.spot > 0 ? `${(((coneCard.up1 - coneCard.spot) / coneCard.spot) * 100).toFixed(2)}%` : undefined} />
            <CardRow k="Upper" v={coneCard.up1.toFixed(2)} />
            <CardRow k="Lower" v={coneCard.dn1.toFixed(2)} />
            <CardRow k="±2σ" v={coneCard.up2.toFixed(2)} sub={coneCard.dn2.toFixed(2)} />
            <CardRow k="Vol" v={coneCard.iv > 0 ? `${(coneCard.iv * 100).toFixed(1)}%` : '—'} />
            <CardRow k="Left" v={coneCard.minutes > 0 ? `${Math.round(coneCard.minutes)}m` : '—'} />
            {coneCard.source && <span className="col-span-2 mt-0.5 text-textMuted leading-snug">{coneCard.source}</span>}
          </PointerFollowCard>
        )}</CellView>
        )}</CellView>

        {/* The hover card — floats above the lane at the marker's x, flipping to the left of it near the right edge. */}
        <CellView cell={eventCell}>{eventCard => eventCard && (
          <div
            className="absolute bottom-9 z-30 pointer-events-none border border-borderMuted bg-panel/95 rounded px-2 py-1.5 shadow-xl shadow-black/50 max-w-[260px]"
            style={
              eventCard.x > (containerRef.current?.clientWidth ?? 400) - 270
                ? { right: Math.max(4, (containerRef.current?.clientWidth ?? 400) - eventCard.x + 6) }
                : { left: Math.max(4, eventCard.x + 6) }
            }
          >
            <div className="font-mono text-t10 font-semibold uppercase tracking-wider text-textPrimary whitespace-nowrap">
              {eventCard.e.label}
            </div>
            <div className="font-mono text-t9 text-textSecondary mt-0.5">{eventCard.e.detail}</div>
          </div>
        )}</CellView>

        {/* The replay strip — the chart's own, the same one the Map wears, along the foot of the plot; the Map's
            strip drives the chart from outside instead */}
        {/* A card that floats above the time axis (ReplayStrip's head note) — the axis stays readable under it, and
            the wrapper lets the pointer through to the plot either side of the card */}
        {/* …and at the foot of the price pane, so an indicator's own pane under it is never covered */}
        {replay && !external && (
          <PaneFoot chart={() => chartRef.current} gap={8 + footInset}>
            <ReplayStrip
              phase={ownPhase}
              pos={Math.max(0, replayIdx - 1)}
              length={Math.max(1, (replayDataRef.current?.bars.length ?? 1) - 1)}
              words={ownPhase === 'play' ? timeWords(replayDataRef.current?.bars[Math.max(0, Math.min(replayIdx, replayDataRef.current?.bars.length ?? 1) - 1)]?.time ?? 0) : undefined}
              marks={replayMarks}
              /* The chart's own replay plays by its bars: the multiple is candles a second (ReplayStrip's pace note) */
              paceUnit="bars"
              playing={replayPlaying}
              onPlay={setReplayPlaying}
              pace={replaySpeed}
              onPace={setReplaySpeed}
              onSeek={i => setReplayIdx(Math.max(31, Math.min(replayDataRef.current?.bars.length ?? 31, Math.round(i) + 1)))}
              onExit={() => onExitReplay?.()}
              step={1}
              counter={`${Math.max(1, replayIdx)} / ${replayDataRef.current?.bars.length ?? 0}`}
              wordsAt={i => timeWords(replayDataRef.current?.bars[Math.max(0, Math.min((replayDataRef.current?.bars.length ?? 1) - 1, Math.round(i)))]?.time ?? 0)}
            />
          </PaneFoot>
        )}
      </div>
      {/* The field's key: what a bead's size is and what its inks mean, in the house's words, and the size every bead
          stands against — the field's own reference, the very number the beads were drawn with. */}
      {trailKey && overlays.trails && trailRef > 0 && !replay && (
        <div className="shrink-0 h-5 px-2 flex items-center gap-x-3 font-mono text-t9 text-textMuted whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0" data-trail-key>
          <span>Flow · same dollars as the strike rail</span>
          <span>size = {trailsGreek === 'gex' ? 'net gamma' : trailsGreek === 'dex' ? 'net delta' : 'net vega'} at the strike</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-[5px] rounded-full shrink-0" style={{ background: BEAD_INK_CSS.put }} aria-hidden /> positive · holds a move back
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-[5px] rounded-full shrink-0" style={{ background: BEAD_INK_CSS.call }} aria-hidden /> negative · pushes a move along
          </span>
          <span>a tie is one node across both strikes · the rest stays faint</span>
          {(() => {
            const score = nodeScore(ticker);
            if (!score || score.unsigned == null) return null;
            return <span>no side on {Math.round(score.unsigned * 100)}% of the near volume</span>;
          })()}
          <span className="ml-auto" data-trail-key-ref>
            Full size = {fmtUsd(trailRef)}{trailsGreek === 'gex' ? ' per 1% move' : trailsGreek === 'dex' ? ' per $1' : ' per vol point'}
          </span>
        </div>
      )}
    </div>
  );
};

/* Memoised: a host re-render (a pane resize, its toolbar) with the same props leaves the chart alone */
export default memo(StrikeChart);
