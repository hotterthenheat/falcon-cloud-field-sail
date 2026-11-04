import {
  Fragment, memo, useCallback, useEffect, useMemo, useRef, useReducer, useState,
  useSyncExternalStore,
  type MutableRefObject, type PointerEvent as ReactPointerEvent, useLayoutEffect,
  type ReactNode,
} from 'react';
import { Copy, Eraser, MousePointer2, Settings2, Trash2 } from 'lucide-react';
import {
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
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
import { chainForDate, deskTape } from '../../data/book/levels';
import { ensureBook } from '../../data/book/load';
import { peekDaySigma, peekIv } from '../../data/book/move';
import { bookStatus, peekEntry, useBookRev } from '../../data/book/store';
import { snapshotFor } from '../../data/book/feed';
import { useBookMinutes } from '../../data/book/minutes';
import { DAYS_PER_VIEW, alignLatestColumn, ensureFieldCloses, ensureFieldCut, ensureFieldDays, exposureGrid, fieldWindow, nyDaysBetween, fieldSourceWords, gridColumns, heldStrikes, useExposureLogRev } from '../../data/book/exposureLog';
import { useFieldMode } from '../../data/fieldMode';
import { useSessionQuote } from '../../data/sessionQuote';
import { asOfText } from '../ui/states';
import { getDeskSession, minuteInSession, sessionMeta, sessionOccurrence, sessionOfMinute, useDeskSession, type DeskSession } from '../../data/deskSession';
import { snapsAsOf } from '../../data/exposureScope';
import { onGlide, promisedWidth } from '../../core/glide';
import { fmtPx, pxSeriesFormat } from '../../core/format';
import { compile, explain, run as runScript, type Compiled } from '../../core/pine';
import { setPaneBars, usePaneScripts } from '../../data/paneScripts';
import { drawRun, type ScriptHandle } from './scriptLayer';
import ScriptLegend, { type ScriptRun } from './ScriptLegend';
import ResetViewControl from './ResetViewControl';
import { LOCAL_TIME, NY_TIME, createZonedChart, localTickMarks, nyTickMarks, rezoneAxis } from './chartTime';
import { tailOnly } from './barPass';
import {
  aggregateCandles,
  aggregateSnapshots,
  snapshotsMaxAbs,
  syncBucket,
  tfMinutes,
  frameServed,
  type Timeframe,
} from '../../data/timeframe';
import { BEAD_INK_CSS, GexTrailsPrimitive, signedDollars, type BeadHit, type EdgeLevel } from './gexNodesPrimitive';
import { nodeConcept } from './nodeConcept';
import { BOOK_MODE_WORDS } from '../../data/bookMode';
import { ExpectedMovePrimitive, type ConeHit } from './expectedMovePrimitive';
import { rgbOf, THERMAL_YELLOW } from './thermalFieldPrimitive';
import { EMBER, GLACIER, resolveInk } from './paletteInk';
import { nyWall, REGULAR_OPEN_MIN } from '../../core/session';
import { WindFieldPrimitive } from './windFieldPrimitive';
import { askWind } from '../../core/windPool';
import type { WindField } from '../../core/windField';
import { windInputsFor } from '../../data/windInputs';
import { carryFor } from '../../core/carry';
import { coneMissed, coneTerm, ensureCone, useConeRev } from '../../data/coneFeed';
import { coneFrame, coneMarks, forwardCone, runwaySlots, todayOpenOf, tradingMinutesPerBar } from '../../data/terrainCone';
import { EXTRA_INK, coneRungs } from './levelExtras';
import { KeyLevelsPrimitive, KEY_LEVEL_KEYS, KEY_LEVEL_WORDS, type KeyLevelKey, type KeyLevelRung } from './keyLevelsPrimitive';
import { LADDER_HIT_W, nearRule } from './ladderPaint';
import PointerCard, { CardRow, PointerFollowCard, letGoWords } from '../ui/PointerCard';
import { CellView, makeCell } from './hoverCell';
import { nyClock, nyDay, nyIsoDate, nyMinutes, nyParts, nyWallTime } from '../../core/nyTime';
import { beepAlert } from '../../data/alertSound';
import { oiDoubled } from '../../data/oiWatch';
import { chartGrain, extendChartTape, thetaChartBars, thetaChartNote, wantChartTape } from '../../data/thetaCandles';
import { useThetaDown, useThetaLogin } from '../../data/thetaFeed';
import { LIVE_LOGIN_FAILED } from '../../copy/feeds';
import { barInTape, peekPrint, subscribePrints, tapeReach, useSymbolsTapeSig, useThetaTape } from '../../data/thetaTape';
import { useDeskAwake } from '../../data/deskAwake';
import { DECISIONS, hourReadNow, useVolOutlook } from '../../data/volOutlook';
import { alignShock, amihudSeries, efficiencyRatioSeries, flipDistancePct, gammaRegimeSeries, harBandSeries, hourOfAnnual, MARKET_NAMES, regimeWords, restOfDaySigma, volShockSeries } from '../../data/physicsReads';
import { sessionCloseMinOn, sessionLengthOn } from '../../core/calendar';
import { drawnOn, inkAt, inputOf, lookOf, useLooksRev, type IndicatorInputSpec } from '../../data/indicatorLooks';
import IndicatorLegend from './IndicatorLegend';
import { contractsLive } from '../../data/compassSession';
import { sameName } from '../../data/spotGexBook';
import { nodeScore } from '../../data/nodeScore';
import { fmtStrike } from '../../data/ahead';
import PaneFoot from './PaneFoot';
import ReplayStrip from './ReplayStrip';
import { commitArm, evaluateAlert, markFired, useAlerts, type AlertContext, type IndicatorSource } from './alertStore';
import { newsPulse } from '../../data/news';
import { exposureNowFor, fmtGexUsd as fmtUsd } from '../../data/gex';
import { ChevronsLeft, ChevronsUp, GripVertical, Lock, PanelLeft, PanelTop, Pencil, Type, Unlock, X as XIcon } from 'lucide-react';
import SlayerMark from '../../brand/SlayerMark';
import { DrawingsPrimitive, REST_INK_DARK, REST_INK_LIGHT, canRedo, canUndo, fixedPoints, gestureOf, isFreehand, isLineKind, isWordsKind, loadDrawings, needsThirdAnchor, popDrawings, redoDrawings, saveDrawings, usesPts, type Drawing, type DrawingKind } from './drawingsPrimitive';
import DrawObjectTree from './DrawObjectTree';
import { withDefaultTemplate } from './drawTemplates';
import { drawingsKey, hearDrawings, useDrawSync } from './drawingSync';
import DrawRailTools, { DrawFavBar, DrawRailSwitches, DrawSheet, RAIL_ARROW_PAD } from './DrawRailTools';
import DrawSettings from './DrawSettings';
import { snap45 } from './drawingGeometry';
import { drawPrefs, drawToolLabel, registerDrawChart, rememberDrawTool, reportDrawState, setRailPrefs, touchDrawChart, useDrawToolPrefs, useRailPrefs } from './drawTools';
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
import { atrBarSeries, alignGamma, alignPremium, alignSides, bollingerSeries, emaSeries, flowVwapSeries, gammaEmaSeries, gammaMoves, gammaVwapSeries, macdSeries, rsiSeries, smaSeries, vwapSeries, vwapSigmaSeries } from '../../data/indicators';
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
import { useChartDarkPrints, useChartFlowPrints } from '../../data/chartFeeds';
import { useOptionTape, useStockTape } from '../../data/tapeFeed';
import { stockMarkers, tapeDarkLines, tapeEventPrints } from './tapeMarks';
import { usePaneFlow } from '../../data/paneFlow';
import { feedHeaders } from '../../data/feedGate';
import { checkPressure, type PressureLevel } from '../../data/nodePressure';
import { FlowFilterDoor } from './FlowFilterDoor';
import { FLOW_CHIPS, flowCaption, flowSign, legsInNet, passesFlow, signedFlowBars, type SignedFlowBar as SignedFlowBarT } from '../../data/flowBuckets';
import { setDeskPrefs, useDeskPrefs, type FlowFilters } from '../../data/deskPrefs';
import { INDICATOR_ITEMS, indicatorBlurb } from './indicatorItems';
import StrikeExposureBand, { type BandMetric } from './StrikeExposureBand';
import { buildExposureProfile } from '../../data/exposure';
import type { ExposureProfileData } from '../../types/gex';
import GapChip, { GAP_GRACE_MS } from './GapChip';
import { useOvernightLayer } from './useOvernightLayer';
import { SESSION_INPUT_KEYS, useSessionsLayer } from './useSessionsLayer';
import { TV_SPECIAL_INKS, TV_SPECIAL_KEYS, tvSpecialRecord, type TvSpecialKey } from './tvSpecialItems';
import { useTvSpecialLayer } from './useTvSpecialLayer';

/* The shape this chart needs off a print: whatever FlowPrint is, plus the instant it arrived. Declared here rather
   than imported from the provider so a chart never depends on a React context it does not use. */
type StampedFlowPrint = FlowPrint & { at: number };

/* The band's share of the chart, as a stretch factor against the price pane's. */
const FLOW_STRETCH = 1;
/* The flow pane and the net drift sit under the tape at about a sixth of it: a sub-pane, not a second chart */
const SUBPANE_STRETCH = 0.62;
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
  rsi: 'RSI 14',
  macd: 'MACD',
  atrPane: 'ATR 14',
  effRatio: 'Reynolds Regime · efficiency ratio',
  amihud: 'Viscosity · Amihud illiquidity',
};

/** Dark prints far from the tape blow the price scale. Keep the largest ones near spot. */
const DARK_NEAR = 0.1;
const DARK_CAP = 12;
/** Terrain's tape draws this many as lines; its other prints are marks on the bars */
const TAPE_DARK_LINES = 4;
function darkNear(rows: readonly DarkPoolPrint[], spot: number): DarkPoolPrint[] {
  const near = rows.filter(p => {
    if (!(p.price > 0) || !Number.isFinite(p.price) || !(p.notional > 0)) return false;
    if (!(spot > 0)) return true;
    return Math.abs(p.price - spot) / spot <= DARK_NEAR;
  });
  return [...near].sort((a, b) => b.notional - a.notional).slice(0, DARK_CAP);
}

/** A key level's rung as the nodes' edge tag names it: long words on a wide pane, short on a narrow one, and how much it
    matters when the edge is crowded */
const EDGE_SHORT: Record<KeyLevelKey, string> = {
  callWall: 'CW', putWall: 'PW', flip: 'Flip', supreme: 'S', pin: 'OI', maxPain: 'MP',
  coneHigh: 'Cone↑', coneLow: 'Cone↓', moveHigh: 'Move↑', moveLow: 'Move↓', sigmaHigh: '1σ↑', sigmaLow: '1σ↓',
  nextHigh: '1σ↑', nextLow: '1σ↓', twoHigh: '2σ↑', twoLow: '2σ↓',
};
const EDGE_RANK: Partial<Record<KeyLevelKey, number>> = { supreme: 9, callWall: 8, putWall: 8, flip: 7, pin: 5, maxPain: 4 };
function edgeLevelOf(r: KeyLevelRung): EdgeLevel {
  const up = /High$/.test(r.key);
  const name = r.title ? `${r.title} ${up ? 'high' : 'low'}` : KEY_LEVEL_WORDS[r.key].name;
  return { price: r.price, name, short: EDGE_SHORT[r.key], ink: r.ink, rank: EDGE_RANK[r.key] ?? 3 };
}

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
  /* The wind field: a MODEL forecast of the rest of today's session — paths off the cone's implied vol, bent by the
     dealer book (core/windField.ts, run in a worker). Off by default; labelled on the chart as a model forecast. */
  wind?: boolean;
  /* Event markers. The calendar on the tape: this name's next report, fomc/cpi/nfp, and the session's largest option
     prints, as glyphs in a lane above the time axis with a hover card each (data/events.ts). */
  events: boolean;
  /* The dotted orange line where a price alert waits. Off by default: the bell, the chip and the drawer say it
     either way; the line is for a reader who wants to see where the watch sits on the tape. */
  alerts?: boolean;
  /* Node pressure: the alerts' chip when price comes within the desk's distance of one of the three heaviest nodes or
     the flip — once a level a session. Off by default. */
  nodeAlert?: boolean;
  /* The extended hours shaded behind their bars (pre-market, after hours, overnight) and a dashed rule where each
     session day starts, as the standard desks draw them: on unless switched off (sessionsPrimitive.ts) */
  extHours?: boolean;
  sessionBreaks?: boolean;
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
/* The volume profiles and auto levels (tvSpecialItems.ts) are keys too: vrvp, svp, pvp, aavp, pivotsStd, pivotsHL, zigzag, autoFib, autoFibExt, autoPitchfork */
export interface ChartIndicators extends Record<TvSpecialKey, boolean> {
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
  /* The study's five tested reads (research/physics/REPORT.md, data/physicsReads.ts) */
  /** Volatility Half-Life: the HAR forecast as a band around price (MODEL) */
  harBand: boolean;
  /** Potential Energy: long / short dealer gamma shading behind the candles (CALCULATED) */
  gammaRegime: boolean;
  /** Gravitational Wave: SPY's 15-minute vol shock, flagged on single names (CALCULATED) */
  volShock: boolean;
  /** Reynolds Regime: Kaufman efficiency ratio, own pane (CALCULATED) */
  effRatio: boolean;
  /** Viscosity: Amihud illiquidity, own pane, display only (CALCULATED) */
  amihud: boolean;
  /** Sessions: Tokyo, London and New York boxes over their bars, high to low (the session module's hours) */
  sessions: boolean;
}

export const DEFAULT_INDICATORS: ChartIndicators = {
  ema9: false, ema21: false, ema50: false, vwap: false,
  bb: false, vwapBands: false, sma: false, flowVwap: false, sideVwap: false, gammaEma: false, gammaVwap: false, rsi: false, macd: false, atrPane: false,
  harBand: false, gammaRegime: false, volShock: false, effRatio: false, amihud: false, sessions: false,
  ...tvSpecialRecord(false),
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
  harBand: '#A7C4D9',
  gammaRegime: BULL,
  volShock: '#E3B58C',
  effRatio: '#9FD3B5',
  amihud: '#C9B3E6',
  sessions: '#B9A9F4',
  ...TV_SPECIAL_INKS,
};

/* The regime's two washes: the house's gamma signs (green long, red short — palette.ts), faint enough to sit under
   the candles */
const LONG_GAMMA_WASH = 'rgba(48,209,88,0.075)';
/** The wash at the Style tab's opacity: 0.3 (the default) is a 7.5% tint, 1 is a 25% one */
/* the desk's inks, not market green/red: long gamma glacier (the call wall's), short gamma ember (the put wall's) */
const washRgb = (h: string): string => `${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)}`;
const gammaWash = (sign: 1 | -1, opacity = 0.3): string => `rgba(${washRgb(sign > 0 ? CALL_WALL : PUT_WALL)},${Math.round(0.25 * opacity * 1000) / 1000})`;
/** The physics reads' one input each (indicatorItems.ts carries the specs the settings dialog shows) */
const physInput = (key: keyof ChartIndicators): IndicatorInputSpec => INDICATOR_ITEMS.find(i => i.key === key)!.inputs![0];
const PHYS_INPUT = {
  get harBand() { return physInput('harBand'); },
  get volShock() { return physInput('volShock'); },
  get effRatio() { return physInput('effRatio'); },
  get amihud() { return physInput('amihud'); },
};
/** The vol-shock strip under its flag: the axis ink, quiet */
const SHOCK_QUIET = 'rgba(226,234,244,0.16)';

/* What each indicator draws, and where, as data. */
export const SUB_PANE_ORDER: (keyof ChartIndicators)[] = ['rsi', 'macd', 'atrPane', 'effRatio', 'amihud'];
export const MAX_SUB_PANES = 2;

interface IndicatorPartSpec {
  part: string;
  kind: 'line' | 'hist' | 'shade';
  ink: string;
  dashed?: boolean;
  faint?: boolean;
  /** Dotted rather than dashed */
  dotted?: boolean;
  /** Its own hidden price scale on the tape (a shade fills the whole height; a strip sits along the floor) */
  scale?: { id: string; top: number; bottom: number };
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
  harBand: {
    pane: 'overlay',
    parts: [
      { part: 'up', kind: 'line', ink: INDICATOR_INKS.harBand, dashed: true },
      { part: 'dn', kind: 'line', ink: INDICATOR_INKS.harBand, dashed: true },
      { part: 'hourUp', kind: 'line', ink: INDICATOR_INKS.harBand, dotted: true, faint: true },
      { part: 'hourDn', kind: 'line', ink: INDICATOR_INKS.harBand, dotted: true, faint: true },
    ],
  },
  gammaRegime: { pane: 'overlay', parts: [{ part: 'shade', kind: 'shade', ink: LONG_GAMMA_WASH, scale: { id: 'phys-gamma', top: 0, bottom: 0 } }] },
  volShock: { pane: 'overlay', parts: [{ part: 'strip', kind: 'hist', ink: INDICATOR_INKS.volShock, scale: { id: 'phys-shock', top: 0.9, bottom: 0 } }] },
  effRatio: { pane: 'sub', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.effRatio }] },
  amihud: { pane: 'sub', parts: [{ part: 'line', kind: 'line', ink: INDICATOR_INKS.amihud }] },
  /* no series: its boxes are the sessions layer's (useSessionsLayer.ts) */
  sessions: { pane: 'overlay', parts: [] },
  /* no series either: the volume profiles and auto levels draw through useTvSpecialLayer.ts */
  ...tvSpecialRecord<{ pane: 'overlay' | 'sub'; parts: IndicatorPartSpec[] }>({ pane: 'overlay', parts: [] }),
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
  /* Pinpoint, Trace and the Dossier read Unusual Whales. Every other desk draws every session that has a price. */
  if (thetaBars()) return thetaChartBars(ticker, mins, session);
  if (mins < 1) return [];
  ensureBook(ticker, 'board');
  const book = deskTape(ticker, session).bars;
  return book && book.length >= 1 ? aggregateCandles(book, mins) : [];
}

/* ThetaData draws the bars where it is the page's source; Pinpoint, Trace and the Dossier draw Unusual Whales' */
const thetaBars = (): boolean => thetaUseHere() === 'all';

/** THE RECORD'S EDGE's word from the feed (the partner tree's 260a099, his houseCanExtend over OUR tapes): every session's
    tape of this timeframe's grain that holds bars has found its data's start, and none is still reading older — so no
    scroll-back can bring an older bar. Read only, off thetaTape's reach; asks nothing. */
function tapeAtStart(ticker: string, mins: number): boolean {
  const grain = chartGrain(mins);
  const sessions: readonly DeskSession[] = grain === 'day' || grain === 'week' ? ['rth'] : ['overnight', 'pre', 'rth', 'post'];
  const reach = sessions.map(s => tapeReach(ticker, grain, s));
  const held = reach.filter(r => r.from);
  return held.length > 0 && held.every(r => r.done) && !reach.some(r => r.loading);
}

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
  /* Off by default: a model forecast is something a reader asks for */
  wind: false,
  /* Off until asked for, like every other layer of context. */
  events: false,
  /* On, like the desks' own charts: the hours a bar traded in, and where a day starts */
  extHours: true,
  sessionBreaks: true,
};

/** The library sizes the price axis to its tick text and the live-price card takes the measured width; this is the
    axis's usual width at a three-digit price, which the chrome pads for. */
export const PRICE_SCALE_MIN_WIDTH = 58;

/* Where a price lands on this chart, published live. A column drawn beside the tape has to agree with the tape's own
   price scale or it is a second, contradicting set of numbers 54px away. */
export interface PriceProjection {
  /** Y in CSS px from the top of the plot, or null if the series is gone. */
  yFor(price: number): number | null;
  /** The last candle's close — the price the tape is printing. Null before the first bar. */
  last(): number | null;
  /** Pan the price scale by `dy` pixels. Positive moves toward lower prices. The ladder and the candle stay on one scale. */
  pan(dy: number): void;
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
  /** The bars are an option contract's premium, not the name's price (Compass's contract page): nothing read off the
      name — its quote, its expected move — is put on them. */
  premium?: boolean;
  /** The window the chart opens on, in place of the desk session's (unix seconds): a past call's trade */
  view?: { from: number; to: number } | null;
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
  /** Bumped every tick so the chart folds in the newest bar */
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
  /** Terrain: the option prints (the flow pane, the net drift, the events lane) and the stock prints (the dark-pool
      overlay: off-exchange prints and blocks) come from the server's tapes (data/tapeFeed.ts), tagged by type */
  printTape?: boolean;
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
  /** The on-chart legend turns a built-in off. Absent, the legend still names what is on. */
  onIndicators?: (next: ChartIndicators) => void;
  /** Closes the strike band from its own row. */
  onOverlays?: (next: ChartOverlays) => void;
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
  /** NOAH'S DESK RAIL (DeskDrawRail): the host draws the drawing rail outside the chart and drives it by `paneId` — the
      chart draws no rail, no slim tab and no sheet door of its own; drawing itself, the mark bar and the settings stay. */
  hostRail?: boolean;
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
  /** Kept on the props so a host can still pass it. The cone does not read it: the interval on the chart is the horizon. */
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
  /** Time sync (Terrain's layout door): the visible window by time on every change, and a "show this window" handed in */
  onRange?: RangeSync;
  rangeRegister?: (apply: RangeSync | null) => void;
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
  /** The pane's "not in yet" notes (an overlay waiting on its feed). Given, the host shows them in its own corner chip
      row and the chart draws none over the plot; absent, the chart shows them as one small chip in its top-right
      corner. Either way a note only shows once it has stood for a few seconds — a feed that lands soon never says it
      is late. */
  onGapNotes?: (lines: string[]) => void;
}

/** Mark a moment on this chart on another pane's behalf; null clears it. */
export type CrosshairSync = (time: UTCTimestamp | null) => void;
/** A visible window by time — another pane's pan or zoom, set on this one */
export type RangeSync = (range: { from: UTCTimestamp; to: UTCTimestamp }) => void;

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
/* The rail's two reader preferences (hide, dock) live in drawTools.tsx (useRailPrefs), where Terrain's desk rail reads them too. */

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

/** A daily or weekly bar is stamped at 16:00 — the cash close, not an after-hours print. */
function barOnDesk(time: number, session: DeskSession, ticker: string, mins: number): boolean {
  if (mins >= 1440) return session === 'rth';
  return barInTape(time, session, ticker);
}

type FocusHold = { key: string; from: number; to: number };

let labelMeasure: CanvasRenderingContext2D | null = null;
function measureLabel(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 7;
  labelMeasure ??= document.createElement('canvas').getContext('2d');
  if (!labelMeasure) return text.length * 7;
  labelMeasure.font = font;
  return labelMeasure.measureText(text).width;
}

/** The series on the chart. A session focus that starts before the recent window widens the left edge so the
    logical range is computed against bars that are actually drawn. */
function sliceFor(all: Candle[], full: boolean, hold: FocusHold | null, world: string): Candle[] {
  const recent = windowOf(all, full);
  if (full || !hold || !hold.key.startsWith(`${world}|`) || !all.length || !recent.length) return recent;
  if (recent[0].time <= hold.from) return recent;
  let i0 = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].time >= hold.from) {
      i0 = i;
      break;
    }
  }
  return all.slice(i0);
}

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

/** Minutes left on the cone, in the unit of the frame. A year is not 98,280 minutes. */
function coneLeft(m: number): string {
  if (!(m > 0)) return '—';
  if (m < 90) return `${Math.round(m)}m`;
  if (m < 390 * 2) {
    const h = m / 60;
    return `${h >= 10 ? Math.round(h) : h.toFixed(1)}h`;
  }
  const sessions = m / 390;
  if (sessions < 12) return `${sessions >= 10 ? Math.round(sessions) : sessions.toFixed(1)}d`;
  if (sessions < 50) return `${Math.round(sessions / 5)}w`;
  if (sessions < 400) return `${Math.round(sessions / 21)}mo`;
  return `${(sessions / 252).toFixed(1)}y`;
}

/** A counter that moves only when `sig` changes. The chart's heavy effects key on a number. */
function useBump(sig: string): number {
  const held = useRef({ sig, n: 0 });
  if (held.current.sig !== sig) {
    held.current.sig = sig;
    held.current.n += 1;
  }
  return held.current.n;
}

/** TradingView-grade candlestick chart with dealer-structure overlays and the net-GEX node heatmap. */
const StrikeChart = ({
  ticker,
  paneId,
  revision: revisionProp,
  levels,
  timeframe: timeframeIn,
  height = 460,
  keepView = false,
  trailsGreek = 'gex',
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
  printTape = false,
  compares = NO_COMPARES,
  priceScale = 'normal',
  sessionOr = 15,
  chartStyle = 'candles',
  themeKey: themeKeyProp,
  barClock = 'time',
  indicators = DEFAULT_INDICATORS,
  onIndicators,
  onOverlays,
  drawing = false,
  onExitDraw,
  onEnterDraw,
  railTopOk = true,
  hostRail = false,
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
  onRange: onRangeOut,
  rangeRegister,
  snapshotRegister,
  onReadout,
  projectionRef,
  exportRef,
  onGapNotes,
}: StrikeChartProps) => {
  /* A date frame the feed does not serve yet never reaches the tape. The menu
     stays on the frame already up; a stored week or month falls back here. */
  const servedTf = useRef<Timeframe>(frameServed(timeframeIn) ? timeframeIn : '15m');
  if (frameServed(timeframeIn)) servedTf.current = timeframeIn;
  const timeframe = servedTf.current;
  const bookRev = useBookRev();
  const bookMinutes = useBookMinutes(ticker);
  /* The physics reads' inputs, asked for only while their indicator is on: the vol outlook fit and today's minutes
     (the very reads Pulse's Vol outlook tile makes), and SPY's minutes for the market's vol shock — one shared tape,
     not a request of their own */
  const looksRev = useLooksRev();
  const getChart = useCallback(() => chartRef.current, []);
  const getIndicatorSeries = useCallback((id: string) => indicatorSeriesRef.current.get(id) as ISeriesApi<SeriesType> | undefined, []);
  const harOn = !!indicators.harBand;
  const shockOn = !!indicators.volShock && !MARKET_NAMES.has(ticker.trim().toUpperCase());
  const volOutlook = useVolOutlook(ticker, harOn);
  const harMinutes = useThetaTape(ticker, '1m', 'rth', harOn);
  const marketMinutes = useThetaTape('SPY', '1m', 'rth', shockOn);
  const session = useDeskSession();
  const volsRev = useConeRev();
  const deskSessionRef = useRef(session);
  deskSessionRef.current = session;
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;
  /* Where the bars come from — the host's tape, or every session that has a price. A session with no prints is a gap. */
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
  const fieldColumns = (bars: readonly Candle[], mins: number, live = true): GexSnapshot[] => {
    /* A host's tape (the paper and backtest desks) draws the nodes too, from the readings logged at its bars' own times —
       empty where the log holds none, and never aligned to the live book (its newest bar is not now) */
    if (!bars.length) return [];
    /* SPXW, NDXP, RUTW and VIXW are the cash index on Unusual Whales. The greek chain is not required
       for the whole book: that cut is the spot-exposures rows. A named expiry is that date. No chain and
       no rows leaves the field empty — strikes are not invented. */
    const name = sameName(ticker);
    const asked = bookDate;
    const resolved = chainForDate(name, asked)?.date ?? null;
    const cut = asked === 'book' ? 'book' : resolved ?? (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null);
    if (!cut) return [];
    /* A column is a bar whose contracts were live then. The desk clock is not a filter: the chart draws
       every session, and keeping only the clock's window (barInTape) blanked every name but SPX once the
       cash session ended. A shut book (QQQ overnight, a name with no session then) stays empty. */
    const dayBar = mins >= 1440;
    const times: number[] = [];
    for (const b of bars) {
      if (dayBar) {
        /* A day bar is the cash session. The desk clock being after hours must not blank the field. */
        const p = nyParts(b.time * 1000);
        if (!contractsLive(name, cut, nyWallTime(p.year, p.month, p.day, 9, 30))) continue;
      }
      /* every intraday bar with a price is a column: a reading in the pre-market or after hours (the recorder's, or a
         rebuilt day's) is a cell, and a session with none stays empty in the grid */
      times.push(b.time);
    }
    if (!times.length) return [];
    /* A daily chart can hold years of bars. The field only needs the recent ones — walking every strike across
       every session locks the page (and is what "This page stopped" was). An intraday chart builds the bars in view
       and as many again each side, 2000 at most (fieldWindow); a pan past them rebuilds (fieldViewRef). */
    const vis = live ? chartRef.current?.timeScale().getVisibleRange() : null;
    const view = vis ? { from: Number(vis.from), to: Number(vis.to) } : null;
    const [wLo, wHi] = dayBar ? [Math.max(0, times.length - 60), times.length] : fieldWindow(times, view, 2000);
    const drawn = wLo === 0 && wHi === times.length ? times : times.slice(wLo, wHi);
    if (live) fieldWinRef.current = { from: drawn[0], to: drawn[drawn.length - 1], first: wLo === 0, last: wHi === times.length, name, cut, price: null };
    ensureFieldCut(name, cut);
    /* every finished session in view, read once (recorded, else rebuilt from the day's open interest and quotes) */
    if (dayBar) ensureFieldCloses(name, cut);
    else {
      const a = view ? Math.max(drawn[0], view.from) : drawn[Math.max(0, drawn.length - 200)];
      const z = view ? Math.min(drawn[drawn.length - 1], view.to) : drawn[drawn.length - 1];
      ensureFieldDays(name, cut, nyDaysBetween(a * 1000, z * 1000).slice(-DAYS_PER_VIEW));
    }
    const series = candleSeriesRef.current;
    const paneH = chartRef.current?.paneSize(0).height ?? 0;
    let price: { lo: number; hi: number } | null = null;
    if (series && paneH > 0) {
      const top = series.coordinateToPrice(0);
      const bot = series.coordinateToPrice(paneH);
      if (top != null && bot != null && top !== bot) price = { lo: Math.min(top, bot), hi: Math.max(top, bot) };
    }
    if (!price) {
      const tail = bars.slice(-40);
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of tail) {
        if (b.low < lo) lo = b.low;
        if (b.high > hi) hi = b.high;
      }
      if (hi > lo) price = { lo, hi };
    }
    /* a quarter of the view more each side, as the raster reaches (a small drag of the scale needs no rebuild) */
    if (price) {
      const pad = (price.hi - price.lo) * 0.25;
      price = { lo: price.lo - pad, hi: price.hi + pad };
    }
    if (live && fieldWinRef.current) fieldWinRef.current.price = price;
    const spot = bars.length ? bars[bars.length - 1].close : null;
    const grid = exposureGrid(name, cut, drawn, mins * 60, fieldMode, Date.now(), price, spot, fieldMode === 'flow' ? heldStrikes(name, cut) : null);
    if (!grid) return [];
    const cols = gridColumns(grid);
    /* the live book stands in for the newest column only when that column IS now: a replay bar keeps its own readings */
    if (live && !tapeRef.current) alignLatestColumn(cols, name, cut, fieldMode);
    return cols;
  };
  const nameIv = (): number | undefined => (tapeRef.current ? tapeRef.current.iv : peekIv(ticker) ?? undefined);
  /* the drawings' key: the tape's own, or this pane's own when the reader turned sync drawings off (drawingSync.ts) */
  const drawSync = useDrawSync();
  const drawKey = drawingsKey(tape?.key ?? ticker, paneId, drawSync);
  const drawKeyRef = useRef(drawKey);
  drawKeyRef.current = drawKey;
  const tapeStamp = tape
    ? `${tape.key}|${tape.bars.length}|${tape.bars.length ? tape.bars[tape.bars.length - 1].time : 0}|${tape.bars.length ? tape.bars[tape.bars.length - 1].close : 0}|${tape.note ?? ''}`
    : '';
  /* No tick rebuild under the hand: while a pointer is down on the chart the revision is held (every tick-driven
     effect keys on it) and the newest one is applied on release. */
  /* A print used to be added into the shared revision, so every name's tick rebuilt indicators, the field,
     the cone and the wind — on this pane and on every other pane, including desks left open behind this one.
     The forming bar is updated on its own (below). `revision` stays the host's book tick. */
  const deskAwake = useDeskAwake();
  const compareNames = compares.map(c => c.ticker).join(',');
  const ownLive = !tape && thetaBars() && deskAwake;
  const tapeNames = ownLive ? [ticker, ...compareNames.split(',').filter(Boolean)].join(',') : '';
  const tapeSig = useSymbolsTapeSig(tapeNames);
  const tapeRev = useBump(tapeSig);
  /* Bars (not the last trade) still rebuild overlays. A print does not. */
  const liveRev = revisionProp + tapeRev;
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
  /* A host that already has prints wins. An empty list is not a feed — the chart asks while the overlay is on. */
  const hostFlow = flowPrints && flowPrints.length > 0 ? flowPrints : null;
  const darkFeed = useChartDarkPrints(ticker, !!overlays.darkpool && !replay && prints.length === 0 && !printTape);
  /* Terrain's dark-pool overlay: the stock tape's off-exchange prints and blocks, at their price and minute */
  const stockTape = useStockTape(ticker, !!overlays.darkpool && !replay && prints.length === 0 && printTape);
  const tapeDark = useMemo(() => (printTape ? tapeDarkLines(stockTape.marks) : []), [printTape, stockTape.marks]);
  const darkRows = prints.length > 0 ? prints : printTape ? tapeDark : darkFeed.rows;
  /* The events lane and the premium VWAPs read the name's newest prints; the flow pane and the net drift read the pane's
     own store (data/paneFlow.ts), the tape under the pane's filters, back to the vendor session's start */
  const flowWanted = !!overlays.events || !!indicators.flowVwap || !!indicators.sideVwap;
  const flowFeed = useChartFlowPrints(ticker, flowWanted && !replay && !hostFlow && barClock === 'time' && !printTape);
  const desk = useDeskPrefs();
  const flowFilters = desk.flowFilters;
  const legsIn = legsInNet(flowFilters);
  /* on Terrain the lane and the VWAPs read the server's tape: its whole prints, of the pane's type, legs only when counted */
  const optionTape = useOptionTape(ticker, flowWanted && !replay && !hostFlow && barClock === 'time' && printTape);
  const tapeFlowRows = useMemo(() => (printTape ? tapeEventPrints(optionTape.rows, flowFilters) : []), [printTape, optionTape.rows, flowFilters]);
  const flowRows: readonly StampedFlowPrint[] = hostFlow ?? (printTape ? tapeFlowRows : flowFeed.rows);
  const nodeLook = desk.nodeLook;
  const paneFlowOn = (!!overlays.flow || !!overlays.netDrift) && !replay && !altSpec && barClock === 'time';
  const paneFlowFeed = usePaneFlow(ticker, flowFilters, paneFlowOn && !hostFlow, printTape ? 'tape' : 'vendor');
  const paneFlowRows = useMemo<readonly FlowPrint[]>(
    () => (hostFlow ? hostFlow.filter(p => passesFlow(p, flowFilters)) : paneFlowFeed.rows),
    [hostFlow, paneFlowFeed.rows, flowFilters],
  );
  const [bandMetric, setBandMetric] = useState<BandMetric>('gex');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  /* The host's chrome band: CSS px from the box's top to the lowest floating block over its upper third — every host
     marks its strip `data-chart-chrome`, measured here the way the scripts legend measures. */
  const chromeInsetRef = useRef(0);
  /* …and as state, with the box's height, for the drawing rail's placement */
  const [chromeInset, setChromeInset] = useState(0);
  const [boxH, setBoxH] = useState(0);
  const [boxW, setBoxW] = useState(0);
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
  const [paneLabels, setPaneLabels] = useState<{ key: string; top: number; last?: boolean; h?: number }[]>([]);
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
  /** The bars the field's grid was last built on (seconds; `first`/`last`: the window reaches the tape's ends), and its
      name and cut — a pan that leaves them rebuilds the field, and the sessions newly in view are read */
  const fieldWinRef = useRef<{ from: number; to: number; first: boolean; last: boolean; name: string; cut: string; price: { lo: number; hi: number } | null } | null>(null);
  /** Rebuild the field on the bars now drawn (set by the bars effect; a resting pan calls it) */
  const fieldViewRef = useRef<(() => void) | null>(null);
  /** The cone's 1σ ends as rungs (levelExtras coneRungs): named at the edge with the nodes when the key levels are off */
  const coneEdgeRef = useRef<KeyLevelRung[]>([]);
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
  /* each script's last run, for the legend's values */
  const scriptRunsRef = useRef(new Map<string, ScriptRun>());
  const [scriptRunsRev, setScriptRunsRev] = useState(0);
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
  /** The wind field's layer (a model forecast), and the field the worker last handed back for this chart */
  const windPrimRef = useRef<WindFieldPrimitive | null>(null);
  const [windField, setWindField] = useState<WindField | null>(null);
  const windAskRef = useRef('');
  const [windWhy, setWindWhy] = useState<string | null>(null);
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
  /** The series was cleared while this name was still loading, so a later empty poll does not reset the scale. */
  const blankedRef = useRef(false);
  /** Every bar the store holds is on the chart (no recent window held back) — only then does the left edge ask for older */
  const drawnAllRef = useRef(false);
  /* History on demand: a world (name · interval · clock) opens on its recent bars and scrolling to their left edge
     loads the whole store once. `fullWorldRef` names the world that asked; the nonce re-runs the data effects. */
  const fullWorldRef = useRef<string | null>(null);
  const recentHeldRef = useRef(false);
  const worldKeyRef = useRef('');
  const [fullNonce, setFullNonce] = useState(0);
  /* THE RECORD'S EDGE (the partner tree's 260a099, openmarket's card where its candles run out): the world whose first bar
     stands in view with room before it and nothing older to come — a glass card at the plot's left says so, the mark
     adrift in it; dismissed a world at a time. Set from onRange against the ref first, so a still chart renders nothing.
     The value is the world and how it ends: 'tape' (the feed's tapes reached their start) or 'held' (a page whose bars
     have no scroll-back: everything held is drawn). */
  /** the wheel glide's target, reachable from the data effect: bars landing in front shift it, a new world lets it go */
  const zoomShiftRef = useRef<{ shift: (delta: number) => void; cancel: () => void }>({ shift: () => {}, cancel: () => {} });
  /** the first bar drawn, for the glide's shift when older bars land in front of it */
  const firstBarRef = useRef(0);
  const [edge, setEdge] = useState<string | null>(null);
  const edgeRef = useRef<string | null>(null);
  const [edgeGone, setEdgeGone] = useState('');
  /* Mirrored every render, read from a subscription installed once — the same pattern levelsRef and focusPriceRef
     use, and the reason the mount effect never has to re-subscribe. */
  const onCrosshairRef = useRef(onCrosshair);
  onCrosshairRef.current = onCrosshair;
  const syncRegisterRef = useRef(syncRegister);
  syncRegisterRef.current = syncRegister;
  const onRangeOutRef = useRef(onRangeOut);
  onRangeOutRef.current = onRangeOut;
  const rangeRegisterRef = useRef(rangeRegister);
  rangeRegisterRef.current = rangeRegister;
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
  const loadedRef = useRef<{ ticker: string; timeframe: Timeframe; theme: string; clock: string; full: boolean; session: string }>({
    ticker: '',
    timeframe: '1m',
    theme: '',
    clock: 'time',
    full: false,
    session: '',
  });

  // Drawing state
  const drawingsRef = useRef<DrawingsPrimitive | null>(null);
  /* THE NIGHT'S SLOTS (useOvernightLayer.ts): the overnight layer's own times on the time scale. The layers that place
     themselves by slot (the drawings, the cone, the events) count them with the bars, or everything right of the night
     would sit as many slots off as the night has. */
  const nightSlotsRef = useRef<number[]>([]);
  const [nightRev, setNightRev] = useState(0);
  const drawnTimesRef = useRef<number[]>([]);
  /** Bar times with the night's slots among them: the time scale's own slots, in order */
  const withNight = (times: readonly number[]): number[] => {
    const night = nightSlotsRef.current;
    if (!night.length) return times as number[];
    const out = [...times, ...night].sort((a, b) => a - b);
    return out.filter((t, i) => i === 0 || t !== out[i - 1]);
  };
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
  /* Bars on the chart: until then, and until the tape is called empty (quiet), the pane says it is loading rather than
     standing blank */
  const [barsIn, setBarsIn] = useState(false);
  useEffect(() => setBarsIn(false), [ticker, timeframe, barClock]);
  /* A signed-out session is not a feed that is down: the empty pane asks for a sign-in */
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (barsIn) return;
    let stop = false;
    void feedHeaders().then(a => {
      if (!stop) setSignedOut(!a.ok && a.code === 'signed_out');
    });
    return () => {
      stop = true;
    };
  }, [barsIn, quiet, ticker]);
  /* The quotes terminal known down, and whether its login was refused: then the pane says so rather than "busy" */
  const feedDown = useThetaDown();
  const feedLogin = useThetaLogin();
  /** A tape's note in the desk's words: no vendor named, a signed-out read asks for a sign-in, a refused login says so,
      a terminal known to be down is offline, and one that did not answer in time is busy and being asked again */
  const noteWords = (note: string | null | undefined): string | null => {
    if (!note) return null;
    if (signedOut) return 'Sign in to load prices';
    const asOf = note.match(/as of (.+)$/)?.[1];
    const stamp = asOf ? ` · as of ${asOf}` : '';
    if (feedLogin && /offline|did not answer|reconnecting|login failed/i.test(note)) return `${LIVE_LOGIN_FAILED}${stamp}`;
    if (feedDown && /offline|reconnecting/i.test(note)) return note;
    if (/offline|did not answer|reconnecting/i.test(note)) return `Prices busy — retrying${stamp}`;
    return note.replace(/ThetaData|Unusual Whales/g, 'the feed');
  };
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [sessionGap, setSessionGap] = useState<string | null>(null);
  const focusKeyRef = useRef('');
  /** The world whose first paint belongs to the recent window, not to every bar of the session. */
  const openedWorldRef = useRef('');
  const quote = useSessionQuote(ticker, session, quiet && session !== 'rth' && !tape?.premium);
  useEffect(() => {
    const id = window.setTimeout(() => {
      /* a ThetaData tape still being read (this browser's copy included) is not an empty one */
      if (barCountRef.current === 0 && (tapeRef.current || !thetaBars() || thetaChartNote(ticker, tfMinutes(timeframe), getDeskSession()) != null)) setQuiet(true);
    }, 1200);
    return () => window.clearTimeout(id);
    /* the terminal going down (or its login refused) asks again: a known outage is said, not loaded forever */
  }, [ticker, timeframe, barClock, feedDown, feedLogin]);
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
    /* the field's cell under the pointer, at full light, ringed — or the bead, as a ringed dot */
    if (!shape.rect) {
      g.beginPath();
      g.arc(cx, cy, rx, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(cx, cy, rx + lw / 2, 0, Math.PI * 2);
      g.stroke();
      return;
    }
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
  const pitchPx = (tf: Timeframe): number => {
    const m = tfMinutes(tf);
    /* THE CHART OPENS SPACIOUS (the partner tree's f5262be, 2026-11-01 port): every intraday tape at 8–11px a bar — a
       body of five or six — instead of the dense ~4px of 08-22; the reader zooms out from there */
    if (m <= 5) return 8;
    if (m <= 15) return 9;
    if (m <= 45) return 10;
    if (m <= 60) return 11;
    if (m <= 240) return 12;
    if (m < 1440) return 13;
    if (m <= 1440) return 14;
    if (m <= 7 * 1440) return 16;
    return 18;
  };
  /* History takes ~82% of the width; the rest stays OPEN ahead of the last bar — room for the cone's end and the edge
     tags, never half the pane (the forward area squeezed the session into the left 40% of a Terrain pane). */
  const HISTORY_SHARE = 0.82;
  const timeframeRef = useRef<Timeframe>(timeframe);
  timeframeRef.current = timeframe;
  const barClockRef = useRef(barClock);
  barClockRef.current = barClock;
  /** Session focus the reader just set. showRecent must not snap it back to the right edge. */
  const focusHoldRef = useRef<FocusHold | null>(null);
  const focusBumpRef = useRef('');
  const [focusNonce, setFocusNonce] = useState(0);
  /** The container's last observed width — the re-fit observer keeps it, so showRecent reads the DOM (a forced
      layout, 28–44ms of every desk open on the profiler) only the first time, before any observation. */
  const widthRef = useRef(0);
  const showRecent = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const hold = focusHoldRef.current;
    const world = `${tickerRef.current}|${timeframeRef.current}|${barClockRef.current}`;
    if (hold && hold.key.startsWith(`${world}|`)) return;
    /* the newest bar's own slot on the time scale: the overnight layer's slots (useOvernightLayer.ts) can stand between
       bars, so the bar count is not always the newest bar's index */
    const lastSlot = lastBarTimeRef.current ? chart.timeScale().timeToIndex(lastBarTimeRef.current as UTCTimestamp, true) : null;
    const len = lastSlot != null ? Math.max(barCountRef.current, Number(lastSlot) + 1) : barCountRef.current;
    const width = widthRef.current || containerRef.current?.clientWidth || 0;
    /* A zero width is the pane before layout. Fitting against a guessed 1200px
       packed a narrow Terrain pane with a wide pane's bars, and the candles jittered. */
    if (width < 80) return;
    const pitch = pitchPx(timeframeRef.current);
    const total = Math.min(700, Math.max(32, Math.round(width / pitch)));
    /* A short tape (a live-only one minutes old, a few hour bars) fills the same share of the width at a wider pitch
       rather than standing as a sliver at the left edge of an empty runway: the runway is always the bars' own
       fraction of the span, so the session dominates and the forward cone keeps at most a fifth of the plot. */
    /* never under 48 slots: a tape of a bar or two (the first live answer) is not blown up to fill the plot, and the
       view the next bars land in keeps a sane pitch */
    const span = Math.max(48, Math.min(total, Math.ceil(len / HISTORY_SHARE)));
    const history = Math.round(span * HISTORY_SHARE);
    const ahead = Math.max(3, span - history);
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
    let lastWidth = 0;
    let fitted = false;
    let raf = 0;
    const obs = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (!w) return;
      widthRef.current = w;
      if (fitted && lastWidth > 0 && Math.abs(w - lastWidth) < lastWidth * 0.02) return;
      fitted = true;
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
    /* A day bar is one session. 12,000 of them is years of empty axis and froze the page on 1D. */
    const cap = bucketSec >= 86_400 ? 40 : RUNWAY_MAX;
    const want = Math.min(cap, Math.ceil(need / RUNWAY_STEP) * RUNWAY_STEP);
    if (cur.from === lastTime && cur.slots >= want) return;

    /* Cash minutes only. Premarket, after hours, and overnight are not cash minutes — the fan ends at the cash close
       (1:00 PM on a half day). A week of runway is still five cash sessions, not five overnight clocks. */
    const pts = runwaySlots(lastTime, bucketSec, want, { from: 9 * 60 + 30, to: 16 * 60, wraps: false, earlyClose: true }).map(t => ({ time: t as UTCTimestamp }));
    series.setData(pts);
    runwayRef.current = { from: lastTime, slots: want };
  }, []);

  const resetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    focusHoldRef.current = null;
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
    /* The bar the moment is inside of, in this chart's own buckets (data/timeframe.ts barBucket: session-anchored — 1h
       bars at 9:30, 10:30 …, a day the New York trading day). Flooring on the unix epoch put a 1h moment on :00, where
       no bar is, and a day on UTC midnight. The library's own nearest lookup rounds UP, so a 12:07 hover would land on a
       15m neighbour's 12:15 bar: only a bar whose own bucket is the moment's is taken. */
    const mins = tfMinutes(timeframeRef.current);
    const key = syncBucket(time, mins);
    const ts = chart.timeScale();
    const stampAt = (i: number): number | null => {
      const d = series.dataByIndex(i) as { time?: unknown } | null;
      return d && typeof d.time === 'number' ? d.time : null;
    };
    let idx: number | null = ts.timeToIndex(key as UTCTimestamp, false); // a bar stamped at its bucket's start
    if (idx === null) {
      /* a bar stamped later inside its bucket (a daily bar at its close): the bars either side of the key */
      const near = ts.timeToIndex(key as UTCTimestamp, true);
      idx = near == null ? null : ([near, near + 1, near - 1].find(i => { const t = stampAt(i); return t != null && syncBucket(t, mins) === key; }) ?? null);
    }
    const stamp = idx === null ? null : stampAt(idx);
    const target = (stamp ?? key) as UTCTimestamp;
    const vis = ts.getVisibleLogicalRange();
    /* Outside this chart's data, or outside what it is currently showing, draw nothing. SetCrosshairPosition clamps
       the index to the visible range and would otherwise print a confident mark on the wrong bar. */
    if (idx === null || stamp === null || vis === null || idx < vis.from || idx > vis.to) {
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

  // The candles set the scale. A level just outside that range can stay. The field's strikes do not —
  // stretching the axis to every strike near the price is what crushed the tape into a line.
  const autoscaleProvider = useCallback(
    (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
      let base: { priceRange: { minValue: number; maxValue: number } | null } | null = null;
      try {
        base = original();
      } catch {
        base = null;
      }
      const range = base?.priceRange ?? null;
      if (!range || !(range.maxValue > range.minValue)) return base;
      const span = range.maxValue - range.minValue;
      const room = Math.max(span * 0.35, 0.01);
      let min = range.minValue;
      let max = range.maxValue;
      const lv = levelsRef.current;
      for (const v of [lv.spot, lv.putWall, lv.callWall, lv.flip, lv.supreme, focusPriceRef.current ?? NaN, ...roomRef.current]) {
        if (!(v > 0) || !Number.isFinite(v)) continue;
        if (v < min - room || v > max + room) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const pad = Math.max((max - min) * 0.08, span * 0.02);
      /* a premium is never under zero: the scale stops at it */
      const floor = tapeRef.current?.premium ? Math.max(0, min - pad) : min - pad;
      return { priceRange: { minValue: floor, maxValue: max + pad } };
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
      setBoxW(w => (w === Math.round(box.width) ? w : Math.round(box.width)));
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
        priceFormat: pxSeriesFormat(),
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
    const chart = createZonedChart(container, {
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
      /* THE READER'S CLOCK (the partner tree's 260a099, the timezone door on Terrain's strip): the axis and the crosshair
         speak the zone the desk keeps — New York by rest, or the machine's, UTC, London's or Tokyo's (deskPrefs
         CLOCK_ZONES); labels only — the session cut, the bars and every window stay New York's. A host's tape that IS
         the market's day (a backtest, clock 'ny') keeps New York. Re-applied when the choice changes (below). */
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
      /* THE WHEEL'S ZOOM IS OURS (below, onWheelZoom — the partner tree's glide): the library's steps the bar spacing once
         a notch, in one frame */
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
        horzLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
      },
    }, () => (tapeRef.current?.clock === 'ny' ? 'ny' : 'reader'));

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
    trails.setConcept(nodeConcept()); // dev-only switch: ?nodes=current|heat
    trails.chromeInset = chromeInsetRef.current;
    trails.hoverOverlay = true;
    trails.afterDraw = () => drawHoverRef.current();
    trails.onData = ref => setTrailRef(ref);
    candles.attachPrimitive(trails);
    /* The key levels' ladder ends each wall's rung at the field's strike chip, so it is attached after the trails to
       draw after them in the same frame. */
    const ladder = new KeyLevelsPrimitive();
    ladder.chips = () => trails.chips;
    ladder.figures = () => !(trails.enabled && trails.tagsOn && trails.cols.length > 0);
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
    /* The wind field (a model forecast), the same way: under the candles, its field swapped by the wind effect. */
    const windPrim = new WindFieldPrimitive();
    candles.attachPrimitive(windPrim);
    windPrimRef.current = windPrim;

    /* The event lane. */
    const eventsPrim = new EventsPrimitive();
    candles.attachPrimitive(eventsPrim);

    /* Zooming out reaches past the runway's end; extend it as they go. The handler reads refs rather than closing
       over the bar time, so it is installed once with the chart and never re-subscribed. */
    let stamped = 0;
    /* The field follows the view: once a pan or zoom rests, the sessions now in view are read (each once), and a view
       past the bars the grid was built on rebuilds it */
    let fieldTimer = 0;
    const fieldRest = () => {
      fieldTimer = 0;
      const win = fieldWinRef.current;
      const vis = chart.timeScale().getVisibleRange();
      if (!win || !vis || replayRef.current) return;
      const from = Number(vis.from);
      const to = Number(vis.to);
      /* the grid holds the strikes of the prices in view when it was built: a scale moved past them rebuilds it too */
      const series = candleSeriesRef.current;
      const paneH = chart.paneSize(0).height;
      const pTop = series && paneH > 0 ? series.coordinateToPrice(0) : null;
      const pBot = series && paneH > 0 ? series.coordinateToPrice(paneH) : null;
      const priceOut = !!win.price && pTop != null && pBot != null && (Math.min(pTop, pBot) < win.price.lo || Math.max(pTop, pBot) > win.price.hi);
      if (priceOut || (from < win.from && !win.first) || (to > win.to && !win.last)) {
        fieldViewRef.current?.();
        return;
      }
      ensureFieldDays(win.name, win.cut, nyDaysBetween(Math.max(from, win.from) * 1000, Math.min(to, win.to) * 1000).slice(-DAYS_PER_VIEW));
    };
    const onRange = () => {
      window.clearTimeout(fieldTimer);
      fieldTimer = window.setTimeout(fieldRest, 300);
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
      } else if (drawnAllRef.current && thetaBars() && !tapeRef.current && loadedRef.current.clock === 'time' && barCountRef.current > 0) {
        /* Everything held is drawn and the reader is at its left edge: the chunk before it, from ThetaData (each tape
           reads one chunk at a time and stops at the data's start; the bars land through the tape's revision, and a
           prepend keeps the view where it is — the time scale counts from the right edge) */
        const r = chart.timeScale().getVisibleLogicalRange();
        if (r && r.from < FULL_TRIGGER && r.to - r.from > 10) extendChartTape(loadedRef.current.ticker, tfMinutes(loadedRef.current.timeframe));
      }
      /* THE RECORD'S EDGE: three bar widths of room before the first bar, every bar held drawn, and no older bar to
         come — on the feed's tapes when they have found their start; on a page whose bars have no scroll-back, once
         everything held is drawn. Never a host's own tape (a backtest's day), a rule clock, or replay. */
      {
        const r = chart.timeScale().getVisibleLogicalRange();
        const w = loadedRef.current;
        const room = !!r && r.from < -3 && r.to - r.from > 10 && drawnAllRef.current && !recentHeldRef.current && barCountRef.current > 0 && !tapeRef.current && w.clock === 'time' && !replayRef.current;
        const how = !room ? null : thetaBars() ? (tapeAtStart(w.ticker, tfMinutes(w.timeframe)) ? 'tape' : null) : 'held';
        const key = how ? `${w.ticker}|${w.timeframe}|${how}` : null;
        if (key !== edgeRef.current) {
          edgeRef.current = key;
          setEdge(key);
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
    /* Time sync: the window out on every change (the host keeps only the pane under the pointer's), and in by time */
    const onTimeRange = (r: { from: Time; to: Time } | null) => {
      if (r && typeof r.from === 'number' && typeof r.to === 'number') onRangeOutRef.current?.({ from: r.from as UTCTimestamp, to: r.to as UTCTimestamp });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onTimeRange);
    rangeRegisterRef.current?.(range => {
      try {
        chart.timeScale().setVisibleRange(range);
      } catch {
        /* no bars yet — nothing to show the window on */
      }
    });
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
        last: () => lastCloseRef.current,
        pan: (dy: number) => {
          const chart = chartRef.current;
          const series = candleSeriesRef.current;
          if (!chart || !series || !dy) return;
          cancelAnimationFrame(scaleGlideRef.current);
          const ps = chart.priceScale('right');
          ps.applyOptions({ autoScale: false });
          const range = ps.getVisibleRange();
          if (!range) return;
          const span = range.to - range.from;
          const h = Math.max(1, chart.paneSize(0).height);
          if (!(span > 0)) return;
          const shift = span * (dy / h);
          try {
            ps.setVisibleRange({ from: range.from - shift, to: range.to - shift });
          } catch {
            /* a range the scale will not take */
          }
        },
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
       pan keeps it on, so every 1s tick re-fit the price scale and undid the reader's hand: a press on the tape freezes
       it (a vertical drag pans the price and stays where the hand left it). */
    /* applyOptions re-lays the whole chart, so only the first press of a gesture pays it */
    const freezeScale = () => {
      const ps = chart.priceScale('right');
      if (ps.options().autoScale) ps.applyOptions({ autoScale: false });
    };
    container.addEventListener('pointerdown', freezeScale);
    /* THE WHEEL KEEPS THE CANDLES (ported from Noah's fork, 2026-10-31: "if i scroll too rapidly... then they
       disappear"): the wheel no longer freezes the scale — a zoom keeps it fitting the bars it shows, as TradingView's
       does. A scale the hand froze stays frozen through a zoom while the candles are still in it; a zoom out that
       leaves no visible candle inside the frozen price range (the empty pane, the volume at its foot) gives the fit
       back. Read once a frame after the library has applied the zoom. */
    let wheelRaf = 0;
    const keepCandles = () => {
      wheelRaf = 0;
      const ps = chart.priceScale('right');
      if (ps.options().autoScale) return;
      const series = candleSeriesRef.current;
      const range = chart.timeScale().getVisibleLogicalRange();
      const shown = ps.getVisibleRange();
      if (!series || !range || !shown) return;
      const data = series.data() as readonly { high?: number; low?: number; value?: number }[];
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(data.length - 1, Math.ceil(range.to));
      if (to < from) return;
      const lo = Math.min(shown.from, shown.to);
      const hi = Math.max(shown.from, shown.to);
      for (let i = from; i <= to; i++) {
        const d = data[i];
        const top = d.high ?? d.value;
        const bot = d.low ?? d.value;
        if (top != null && bot != null && top >= lo && bot <= hi) return;
      }
      ps.applyOptions({ autoScale: true });
    };
    const onWheelKeep = () => {
      if (!wheelRaf) wheelRaf = requestAnimationFrame(keepCandles);
    };
    container.addEventListener('wheel', onWheelKeep, { passive: true });

    /* THE WHEEL'S ZOOM GLIDES (the partner tree's b608857 · 12f1ef0 · abfc34b · a61adbf, openmarket's feel): the library's
       wheel moved the bar spacing once a notch, in the frame the notch landed — a 10% jump, then nothing. Ours keeps a
       TARGET view and eases the visible range toward it every frame (a 70 ms time constant), so notches in a row read as
       one glide and a single notch lands softly; the bar under the pointer stays under the pointer. Wheel down widens the
       view; a sideways wheel still pans through the library; the span is held to half a pixel a bar at the widest and
       fifty at the narrowest. The glide ends when the library holds the range still for two frames (it clamped), and a
       zoom out never opens more than half a window of empty runway past the last bar. OURS KEPT: the wheel never freezes
       the price scale, and a scale the hand froze (a price-axis drag) holds through the glide while candles stay in it —
       keepCandles runs each frame of the glide, as it ran after each library notch. */
    let zoomTarget: { from: number; to: number } | null = null;
    let zoomRaf = 0;
    let zoomLast = 0;
    let zoomPrev: { from: number; to: number } | null = null;
    let zoomStill = 0;
    const zoomEnd = () => {
      zoomTarget = null;
      zoomRaf = 0;
      zoomLast = 0;
      zoomPrev = null;
      zoomStill = 0;
    };
    const zoomStep = (now: number) => {
      const ts = chart.timeScale();
      const cur = ts.getVisibleLogicalRange();
      if (!cur || !zoomTarget) {
        zoomEnd();
        return;
      }
      /* read ACROSS frames: the library applies a set on its next render, so two still frames mean it clamped */
      const still = !!zoomPrev && Math.abs(cur.from - zoomPrev.from) < 0.005 && Math.abs(cur.to - zoomPrev.to) < 0.005;
      zoomStill = still ? zoomStill + 1 : 0;
      if (zoomStill >= 2) {
        zoomEnd();
        return;
      }
      zoomPrev = cur;
      const dt = zoomLast ? Math.min(48, now - zoomLast) : 16;
      zoomLast = now;
      const a = 1 - Math.exp(-dt / 70);
      const from = cur.from + (zoomTarget.from - cur.from) * a;
      const to = cur.to + (zoomTarget.to - cur.to) * a;
      const done = Math.abs(zoomTarget.from - from) < 0.02 && Math.abs(zoomTarget.to - to) < 0.02;
      ts.setVisibleLogicalRange(done ? zoomTarget : { from, to });
      onWheelKeep();
      if (done) zoomEnd();
      else zoomRaf = requestAnimationFrame(zoomStep);
    };
    /* a press on the tape, or a sideways wheel, is the reader taking the view back: the glide lets go */
    const cancelZoom = () => {
      zoomTarget = null;
      zoomPrev = null;
    };
    zoomShiftRef.current = {
      shift: delta => {
        if (zoomTarget) zoomTarget = { from: zoomTarget.from + delta, to: zoomTarget.to + delta };
        if (zoomPrev) zoomPrev = { from: zoomPrev.from + delta, to: zoomPrev.to + delta };
      },
      cancel: cancelZoom,
    };
    const onWheelZoom = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (dy === 0 || Math.abs(dy) < Math.abs(e.deltaX)) {
        cancelZoom();
        return;
      }
      if (e.cancelable) e.preventDefault();
      const ts = chart.timeScale();
      const cur = ts.getVisibleLogicalRange();
      if (!cur) return;
      const base = zoomTarget ?? cur;
      /* the cursor's bar, read in the current view and carried into the target's frame */
      const x = e.clientX - container.getBoundingClientRect().left;
      const underCursor = ts.coordinateToLogical(x);
      const t = underCursor == null ? 0.5 : (underCursor - cur.from) / Math.max(1e-6, cur.to - cur.from);
      const anchor = base.from + t * (base.to - base.from);
      const width = Math.max(1, ts.width());
      const span0 = base.to - base.from;
      const span = Math.min(width / 0.5, Math.max(width / 50, span0 * Math.exp(dy * 0.0015)));
      const ratio = span / span0;
      let from = anchor - (anchor - base.from) * ratio;
      let to = anchor + (base.to - anchor) * ratio;
      /* the void ahead is capped: never more than half the window past the last bar — the window slides back instead */
      const len = barCountRef.current;
      if (len > 0 && to > len - 1 + span * 0.5) {
        const over = to - (len - 1 + span * 0.5);
        from -= over;
        to -= over;
      }
      zoomTarget = { from, to };
      if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
    };
    container.addEventListener('wheel', onWheelZoom, { passive: false });
    container.addEventListener('pointerdown', cancelZoom);

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
      container.removeEventListener('wheel', onWheelKeep);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
      zoomShiftRef.current = { shift: () => {}, cancel: () => {} };
      container.removeEventListener('wheel', onWheelZoom);
      container.removeEventListener('pointerdown', cancelZoom);
      if (zoomRaf) cancelAnimationFrame(zoomRaf);
      container.removeEventListener('pointerdown', freezeScale);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      window.clearTimeout(fieldTimer);
      chart.unsubscribeCrosshairMove(onCross);
      devCharts?.delete(devEntry);
      syncRegisterRef.current?.(null);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onTimeRange);
      rangeRegisterRef.current?.(null);
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
      windPrimRef.current = null;
      eventsPrimRef.current = null;
      compareSeriesRef.current.clear();
      compareLoadedRef.current = '';
      indicatorSeriesRef.current.clear();
      indicatorLoadedRef.current = '';
      styleBuiltRef.current = null;
      printLinesRef.current = [];
      shownLevelsRef.current = null;
      cancelAnimationFrame(levelRafRef.current);
      loadedRef.current = { ticker: '', timeframe: '1m', theme: '', clock: 'time', full: false, session: '' };
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
    if (windPrimRef.current) next.attachPrimitive(windPrimRef.current);
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
    for (const key of ['rsi', 'macd', 'atrPane', 'effRatio', 'amihud'] as const) {
      const series = indicatorSeriesRef.current.get(`${key}:line`);
      wanted.push({ key, series: series ?? null });
    }
    let next: { key: string; top: number; last?: boolean; h?: number }[] = [];
    if (chart) {
      try {
        const panes = chart.panes();
        const heights = panes.map(pane => pane.getHeight());
        for (const w of wanted) {
          if (!w.series) continue;
          const idx = w.series.getPane().paneIndex();
          /* Pane 0 is the tape. A product series that somehow landed there has no band of its own to label. */
          if (idx <= 0 || idx >= heights.length) continue;
          if (heights[idx] < 20) continue;
          let top = 0;
          for (let j = 0; j < idx; j++) top += heights[j];
          next.push({ key: w.key, top: top + 6, last: idx === heights.length - 1, h: heights[idx] });
        }
      } catch {
        /* The chart is mid-teardown; no chips rather than a thrown render */
        next = [];
      }
    }
    setPaneLabels(prev =>
      prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.top === next[i].top && p.last === next[i].last && p.h === next[i].h)
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

  /* The flow pane: one bar a candle, the signed net premium of the option prints that pass the pane's filters — calls
     bought at the ask and puts sold at the bid up, puts bought and calls sold down (data/flowBuckets.ts). Built on
     demand and torn down when off or when the name has no prints under the filters. */
  const flowBarsRef = useRef<SignedFlowBarT[]>([]);
  /* The flow pane's symmetric scale, read by the autoscale provider set once at the series' birth. Not an applyOptions
     per run: options left pending on a histogram while another series' setData re-indexes the time scale (the full
     history landing) made the library re-colour stale items in its hit test — "Value is null", the pane gone, whenever
     the pointer rested on the flow pane during a load (seen live 2026-11-01). */
  const flowMaxRef = useRef(0);
  /** The bar times the tape draws now — the candles' own, never the whole store: a pane series holding times the price
      series does not would shift every logical index and pull the view off its runway */
  const drawnTimes = (): number[] => (candleSeriesRef.current?.data() ?? []).map(d => Number(d.time));
  const [flowSum, setFlowSum] = useState<{ net: number; prints: number } | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const fmins = tfMinutes(timeframe);
    const fbars = overlays.flow && paneFlowOn && paneFlowRows.length && barsIn ? signedFlowBars(paneFlowRows, drawnTimes(), fmins * 60, legsIn) : [];
    /* no print under the filters lands on these bars (a quiet name, a backtest day the tape no longer holds): no pane */
    const off = !overlays.flow || altSpec || !paneFlowOn || !fbars.some(b => b.count > 0);
    if (off) {
      const old = flowCallsRef.current;
      /* Refs cleared before the removal, not after: removing a series can throw on a chart that is already tearing
         down, and a ref still holding a destroyed series is one the label measurer would ask for a pane. */
      flowCallsRef.current = null;
      flowPutsRef.current = null;
      try {
        if (old) chart.removeSeries(old);
      } catch {
        /* Already gone */
      }
      flowBarsRef.current = [];
      setFlowSum(null);
      remeasurePaneLabels();
      return;
    }

    let net = flowCallsRef.current;
    if (!net) {
      /* Appended, never a fixed index. Compare-in-pane mode may already own a pane. */
      const paneIndex = chart.panes().length;
      net = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' as const },
          lastValueVisible: false,
          priceLineVisible: false,
          base: 0,
          autoscaleInfoProvider: () => (flowMaxRef.current > 0 ? { priceRange: { minValue: -flowMaxRef.current, maxValue: flowMaxRef.current } } : null),
        },
        paneIndex,
      );
      flowCallsRef.current = net;
      try {
        chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);
        net.getPane().setStretchFactor(SUBPANE_STRETCH);
        /* room at the top for the caption line */
        net.priceScale().applyOptions({ scaleMargins: { top: 0.22, bottom: 0.04 }, borderVisible: false });
        net.createPriceLine({ price: 0, color: 'rgba(237,237,237,0.22)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
      } catch {
        /* Pane sizing is a nicety; never lose the chart over it */
      }
    }

    const mins = fmins;
    const bars = fbars;
    flowBarsRef.current = bars;
    let max = 0;
    for (const b of bars) max = Math.max(max, Math.abs(b.net));
    net.setData(
      bars.map(b => {
        const t = max > 0 ? Math.abs(b.net) / max : 0;
        const a = (0.45 + 0.55 * Math.sqrt(t)).toFixed(3);
        return { time: b.time as UTCTimestamp, value: b.net, color: b.net >= 0 ? `rgba(48,209,88,${a})` : `rgba(255,69,58,${a})` };
      }),
    );
    flowMaxRef.current = max;
    /* the caption's figure: the newest session's net, from its first bar — on the server's tape, the session it holds
       (an overnight or a weekend after it is a newer stretch of bars with no option prints) */
    let from = bars.length - 1;
    while (from > 0 && bars[from].time - bars[from - 1].time < 3 * 3600) from--;
    const span = paneFlowFeed.span;
    let sum = 0;
    let count = 0;
    if (span) {
      /* the session's every print under the filters, whichever of its bars the tape has drawn */
      for (const p of paneFlowRows) {
        const ms = p.epochMs ?? 0;
        if (ms < span.from || ms >= span.to) continue;
        const sign = flowSign(p, legsIn);
        if (!sign) continue;
        sum += sign * p.premium;
        count += (p as FlowPrint & { aggregate?: number }).aggregate ?? 1;
      }
    } else {
      for (let i = Math.max(0, from); i < bars.length; i++) {
        sum += bars[i].net;
        count += bars[i].count;
      }
    }
    setFlowSum(prev => (prev && prev.net === sum && prev.prints === count ? prev : { net: sum, prints: count }));
    remeasurePaneLabels();
  }, [overlays.flow, paneFlowRows, paneFlowOn, legsIn, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec, revision, tapeRev, session, mainNonce, fullNonce, barsIn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The net drift: the same signed premium the flow pane bars, kept as a running total through each session, one line
     in its own pane. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const dmins = tfMinutes(timeframe);
    const dbars = overlays.netDrift && paneFlowOn && paneFlowRows.length && barsIn ? signedFlowBars(paneFlowRows, drawnTimes(), dmins * 60, legsIn) : [];
    if (!overlays.netDrift || altSpec || !paneFlowOn || !dbars.some(b => b.count > 0)) {
      const old = driftCallsRef.current;
      driftCallsRef.current = null;
      driftPutsRef.current = null;
      try {
        if (old) chart.removeSeries(old);
      } catch {
        /* Already gone */
      }
      remeasurePaneLabels();
      return;
    }
    let line = driftCallsRef.current;
    if (!line) {
      const paneIndex = chart.panes().length;
      line = chart.addSeries(LineSeries, { lineWidth: 2 as const, color: DRIFT_CALL_INK, priceFormat: { type: 'volume' as const }, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false }, paneIndex);
      driftCallsRef.current = line;
      try {
        chart.panes()[0]?.setStretchFactor(PRICE_STRETCH);
        line.getPane().setStretchFactor(SUBPANE_STRETCH);
        line.createPriceLine({ price: 0, color: 'rgba(237,237,237,0.22)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
      } catch {
        /* Pane sizing is a nicety; never lose the chart over it */
      }
    }
    const bars = dbars;
    let run = 0;
    const pts = bars.map((b, i) => {
      if (i > 0 && b.time - bars[i - 1].time >= 3 * 3600) run = 0;
      run += b.net;
      return { time: b.time as UTCTimestamp, value: run, color: run >= 0 ? DRIFT_CALL_INK : DRIFT_PUT_INK };
    });
    line.setData(pts);
    remeasurePaneLabels();
  }, [overlays.netDrift, paneFlowRows, paneFlowOn, legsIn, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec, revision, tapeRev, session, mainNonce, fullNonce, barsIn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The volatility drift: what the underlying is doing against what the option market says it expects. Realised is
     measured from the same aggregated bars the tape draws, so the two agree on every timeframe. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    /* Frozen during replay, like the compares and the indicators: the vol lines are computed off live bars, and
       letting them run forward while the tape is rewound would put two different clocks in one window. */
    if (replayRef.current) return;

    const tearVol = () => {
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
    };

    if (!overlays.volDrift || altSpec) {
      tearVol();
      return;
    }

    const mins = tfMinutes(timeframe);
    const bars = barsFor(mins);
    const rvPoints = realizedVol(bars, mins * 60);
    /* A short window is not a line of zeros. The pane stays down until realised vol exists. */
    if (rvPoints.length === 0) {
      tearVol();
      return;
    }
    const ivPoints = impliedVolLine(nameIv(), rvPoints);

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
  }, [overlays.volDrift, revision, timeframe, ticker, themeKey, remeasurePaneLabels, altSpec, bookRev]);

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
      .filter(k => !(altSpec && (k === 'vwap' || k === 'vwapBands' || k === 'flowVwap' || k === 'sideVwap' || k === 'gammaEma' || k === 'gammaVwap' || k === 'harBand' || k === 'gammaRegime' || k === 'volShock')))
      /* the market's shock is about the market reaching a single name: not drawn on the market itself */
      .filter(k => !(k === 'volShock' && MARKET_NAMES.has(ticker.trim().toUpperCase())))
      .filter(k => k !== 'sessions' && !(TV_SPECIAL_KEYS as readonly string[]).includes(k));
    /* Append under whatever product panes are already open. A fixed index lands RSI in the flow pane, or opens a blank one. */
    const product = lastProductPaneIndex();
    const full = fullWorldRef.current === `${ticker}|${timeframe}|${barClock}`;
    const sig = `${ticker}|${timeframe}|${barClock}|${session}|${active.join(',')}|${product}|${mainNonce}|${full ? 'full' : 'recent'}|${looksRev}`;
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
      let appendAt = chart.panes().length;
      for (const key of active) {
        const spec = INDICATOR_PARTS[key];
        const paneIndex = spec.pane === 'overlay' ? 0 : appendAt++;
        /* The settings dialog's Style and Visibility tabs (data/indicatorLooks.ts): ink, opacity, thickness, the
           price-scale label, the eye and the timeframe bands. Off the record a line draws as it always did. */
        const look = lookOf(key);
        const shown = drawnOn(key, mins);
        const scaleLabel = look.scaleLabel !== false;
        const width = (Math.min(4, Math.max(1, Math.round(look.width ?? 1))) as 1 | 2 | 3 | 4);
        for (const part of spec.parts) {
          const lead = part.part === spec.parts[0].part;
          const base = look.ink && (lead || spec.parts.every(p => p.ink === spec.parts[0].ink)) ? look.ink : part.ink;
          const ink = inkAt(base, (part.faint ? 0.6 : 1) * (look.opacity ?? 1));
          const series =
            part.kind === 'hist' || part.kind === 'shade'
              ? /* a histogram part prints its value on its pane's axis too; a shade or a floor strip rides its own
                   hidden scale on the tape */
                chart.addSeries(
                  HistogramSeries,
                  {
                    color: ink,
                    priceLineVisible: false,
                    lastValueVisible: part.kind === 'hist' && !part.scale && scaleLabel,
                    visible: shown,
                    priceFormat: pxSeriesFormat(),
                    ...(part.scale ? { priceScaleId: part.scale.id } : {}),
                  },
                  paneIndex
                )
              : chart.addSeries(
                  LineSeries,
                  {
                    color: ink,
                    lineWidth: width,
                    lineStyle: part.dotted ? 1 : part.dashed ? 2 : 0,
                    ...(spec.pane === 'overlay' ? { priceScaleId: 'right' } : {}),
                    priceLineVisible: false,
                    /* Every line prints its last value on its axis in its own ink; MACD's signal alone stays quiet. */
                    lastValueVisible: part.part !== 'signal' && scaleLabel,
                    crosshairMarkerVisible: false,
                    visible: shown,
                    ...(key === 'amihud' ? { priceFormat: pxSeriesFormat(4, 0.0001) } : {}),
                    /* the efficiency ratio lives on 0 … 1, so its pane always shows the whole range */
                    ...(key === 'effRatio' ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) } : {}),
                  },
                  paneIndex
                );
          if (part.scale) {
            try {
              chart.priceScale(part.scale.id, paneIndex).applyOptions({ visible: false, scaleMargins: { top: part.scale.top, bottom: part.scale.bottom } });
            } catch {
              /* a scale the chart has not made yet takes its margins with the first data */
            }
          }
          /* the regime's wash goes behind the candles, not over them */
          if (part.kind === 'shade') series.setSeriesOrder(0);
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
    if (active.length === 0) {
      remeasurePaneLabels();
      return;
    }
    /* The same window as the candles — a line that ran further left than the tape would widen the time scale and
       throw showRecent's arithmetic */
    const bars = sliceFor(barsFor(mins, altSpec), full, focusHoldRef.current, `${ticker}|${timeframe}|${barClock}`);
    if (bars.length === 0) {
      indAltCountRef.current = 0;
      remeasurePaneLabels();
      return;
    }
    /* The formulas live in data/indicators.ts — one copy, shared with the confluence strip and every other
       summariser (the walls' lesson). This maps numbers onto series points and owns nothing else. */
    const seriesFor = (key: keyof ChartIndicators): Record<string, (number | null)[]> => {
      switch (key) {
        case 'vwap':
          return { line: vwapSeries(bars, mins, session) };
        case 'bb': {
          const b = bollingerSeries(bars, 20, 2);
          return { basis: b.basis, upper: b.upper, lower: b.lower };
        }
        case 'vwapBands': {
          const vw = vwapSeries(bars, mins, session);
          const sg = vwapSigmaSeries(bars, mins, session);
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
        case 'effRatio':
          return { line: efficiencyRatioSeries(bars, mins, inputOf('effRatio', PHYS_INPUT.effRatio)) };
        case 'amihud':
          return { line: amihudSeries(bars, mins, inputOf('amihud', PHYS_INPUT.amihud)) };
        case 'gammaRegime': {
          const gamma = alignGamma(bars, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
          return { shade: gammaRegimeSeries(bars, mins, gamma) };
        }
        case 'volShock':
          return { strip: alignShock(bars, mins, volShockSeries(marketMinutes.bars)) };
        case 'harBand': {
          const liveDay = nyIsoDate(Date.now());
          const dayAnnual = volOutlook.state === 'ready' && volOutlook.target === liveDay ? volOutlook.forecast : NaN;
          /* the next hour stands at the last decision minute (10:00, 10:15 … 15:00) a bar's end has reached: one read
             per decision, not per bar */
          const byDecision = new Map<number, number | null>();
          const hourAt = (endMs: number): number | null => {
            if (volOutlook.state !== 'ready') return null;
            const closed = nyMinutes(endMs) - REGULAR_OPEN_MIN;
            const j = [...DECISIONS].reverse().find(d => d <= closed);
            if (j == null) return null;
            if (!byDecision.has(j)) byDecision.set(j, hourReadNow(ticker, harMinutes.bars, endMs)?.forecast ?? null);
            return byDecision.get(j) ?? null;
          };
          const b = harBandSeries(bars, mins, liveDay, dayAnnual, hourAt, inputOf('harBand', PHYS_INPUT.harBand));
          return { up: b.up, dn: b.dn, hourUp: b.hourUp, hourDn: b.hourDn };
        }
        case 'flowVwap':
        case 'sideVwap': {
          const sec = (at: number) => (at > 1e12 ? Math.floor(at / 1000) : at);
          const flow = flowRows.map(p => ({ time: sec(p.at), callPrem: p.right === 'C' ? p.premium : 0, putPrem: p.right === 'P' ? p.premium : 0 }));
          if (key === 'sideVwap') {
            const sides = alignSides(bars, flow, mins * 60);
            return { call: flowVwapSeries(bars, mins, sides.call, session), put: flowVwapSeries(bars, mins, sides.put, session) };
          }
          return { line: flowVwapSeries(bars, mins, alignPremium(bars, flow, mins * 60), session) };
        }
        case 'gammaEma': {
          const gamma = alignGamma(bars, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
          return { line: gammaEmaSeries(bars, gamma) };
        }
        case 'gammaVwap': {
          const gamma = alignGamma(bars, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
          return { line: gammaVwapSeries(bars, mins, gamma, session) };
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
        /* the regime's wash and the shock strip carry their colour per bar */
        const flag = key === 'volShock' ? inputOf('volShock', PHYS_INPUT.volShock) : 0;
        const opacity = lookOf(key).opacity ?? 1;
        const pointInk = (v: number): string | undefined =>
          key === 'gammaRegime'
            ? gammaWash(v > 0 ? 1 : -1, lookOf(key).opacity)
            : key === 'volShock'
              ? v >= flag ? inkAt(lookOf(key).ink ?? INDICATOR_INKS.volShock, 0.85 * opacity) : SHOCK_QUIET
              : undefined;
        const pts = bars.map((b, i) => {
          const v = vals[i];
          if (v === null) return { time: b.time as UTCTimestamp };
          const color = pointInk(v);
          /* a shade fills the pane's height: every regime bar is 1 on its own hidden scale */
          const value = key === 'gammaRegime' ? 1 : v;
          return color ? { time: b.time as UTCTimestamp, value, color } : { time: b.time as UTCTimestamp, value };
        });
        /* A length change, including the first bar after an empty tape, reloads. update() on an empty series throws and the line never appears. */
        const stale = rebuild || bars.length !== indAltCountRef.current;
        try {
          if (stale) s.setData(pts);
          else s.update(pts[pts.length - 1]);
        } catch {
          try { s.setData(pts); } catch { /* series already gone */ }
        }
      }
    }
    indAltCountRef.current = bars.length;
    remeasurePaneLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, ticker, revision, timeframe, mainNonce, compares, altSpec, barClock, fullNonce, focusNonce, flowRows, bookMinutes, session, lastProductPaneIndex, remeasurePaneLabels, looksRev, volOutlook, harMinutes.bars, marketMinutes.bars]);

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
    const bars = sliceFor(barsFor(mins, altSpec), full, focusHoldRef.current, `${ticker}|${timeframe}|${barClock}`).map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    setPaneBars(paneId, bars, ticker, String(timeframe));
    if (bars.length === 0) {
      tearDown();
      return;
    }
    const subsActive = SUB_PANE_ORDER.filter(k => indicators?.[k]).slice(0, MAX_SUB_PANES);
    const paneCompareOn = compares.some(c => c.mode === 'pane');
    const subBase = paneCompareOn ? 2 : 1;
    const live = paneScripts.filter(p => p.chart.visible && p.script.status === 'ok');
    const holdFrom = focusHoldRef.current?.key.startsWith(`${ticker}|${timeframe}|${barClock}|`) ? focusHoldRef.current.from : 0;
    const sig = `${ticker}|${timeframe}|${barClock}|${full ? 'full' : 'recent'}|${holdFrom}|${mainNonce}|${subBase}|${subsActive.join(',')}|${live.map(p => `${p.chart.id}:${p.script.sourceHash}:${JSON.stringify(p.chart.inputs)}`).join(';')}`;
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
        scriptRunsRef.current.set(ps.chart.id, { result, times: bars.map(b => b.time) });
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
      const paneIndex = own ? chart.panes().length : 0;
      if (own) ownPanes++;
      handles.set(ps.chart.id, drawRun(chart, result, bars, paneIndex));
    }
    if (rebuild && subsActive.length + ownPanes > 0) {
      const panes = chart.panes();
      panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 64 : Math.max(10, 36 / (panes.length - 1))));
    }
    scriptSigRef.current = sig;
    if (live.length) setScriptRunsRev(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, paneScripts, indicators, ticker, revision, timeframe, mainNonce, compares, altSpec, barClock, fullNonce, focusNonce, levels]);

  /* The handles go with the chart */
  useEffect(
    () => () => {
      for (const h of scriptHandlesRef.current.values()) h.destroy();
      scriptHandlesRef.current.clear();
    },
    []
  );

  /* THE OVERNIGHT LAYER (2026-11-01, from the data audit): on Terrain's panes, the SPX price the options imply through
     the GTH night (SPX, SPXW, XSP) and the labelled empty night of a stock (useOvernightLayer.ts) — its own series, the
     candles untouched; intraday time bars only, never a host's tape or a replay */
  useOvernightLayer(chartRef, {
    ticker,
    mins: tfMinutes(timeframe),
    light: chartSurface(CANDLE_THEMES[themeKey]).light,
    off: !paneId?.startsWith('terrain') || !!tape || replay || barClock !== 'time',
    revision,
    onSlots: times => {
      const was = nightSlotsRef.current;
      if (was.length === times.length && was.every((t, i) => t === times[i])) return;
      nightSlotsRef.current = times;
      drawingsRef.current?.setBarTimes(withNight(drawnTimesRef.current));
      setNightRev(n => n + 1);
    },
  });

  /* THE SESSIONS LAYER (useSessionsLayer.ts): the extended-hours wash and the session breaks (Overlays, on by default)
     and the Sessions indicator's Tokyo / London / New York boxes, on Terrain's intraday time bars */
  const sessionsSpecs = INDICATOR_ITEMS.find(i => i.key === 'sessions')?.inputs ?? [];
  useSessionsLayer(candleSeriesRef as MutableRefObject<ISeriesApi<SeriesType> | null>, {
    bars: () => barsFor(tfMinutes(timeframe), altSpec),
    off: !paneId?.startsWith('terrain') || !!tape || replay || barClock !== 'time' || tfMinutes(timeframe) >= 1440,
    ext: overlays.extHours !== false,
    breaks: overlays.sessionBreaks !== false,
    boxes: indicators.sessions && drawnOn('sessions', tfMinutes(timeframe)) ? SESSION_INPUT_KEYS.filter(k => { const spec = sessionsSpecs.find(x => x.id === k.id); return !spec || inputOf('sessions', spec) >= 1; }).map(k => k.key) : [],
    opacity: lookOf('sessions').opacity ?? 1,
    signature: `${ticker}|${timeframe}|${revision}|${session}|${mainNonce}|${appTheme}|${looksRev}|${themeKey}`,
  });

  /* THE VOLUME PROFILES AND AUTO LEVELS (useTvSpecialLayer.ts): the standard desks' visible range / session / periodic /
     auto anchored profiles, pivot points, zig zag, auto Fib and pitchfork, fractals — over this chart's own bars, the
     volume from the one-minute bars already held. Time bars only, never a host's tape or a replay. */
  const tvSpecialExtras = useTvSpecialLayer(candleSeriesRef as MutableRefObject<ISeriesApi<SeriesType> | null>, {
    bars: () => barsFor(tfMinutes(timeframe), altSpec),
    minuteBars: () => displayBars(ticker, 1),
    mins: tfMinutes(timeframe),
    on: TV_SPECIAL_KEYS.filter(k => indicators[k] && drawnOn(k, tfMinutes(timeframe))),
    off: !!tape || replay || barClock !== 'time',
    signature: `${ticker}|${timeframe}|${revision}|${session}|${mainNonce}|${appTheme}|${looksRev}|${themeKey}`,
  });

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
      const paneAt = chart.panes().length;
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
          /* Below every pane already open, sharing one pane when several compare in pane mode. */
          c.mode === 'pane' ? paneAt : 0
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
    candleSeriesRef.current?.applyOptions({ priceFormat: pxSeriesFormat(tapeDecimals, tapeTick) });
  }, [tapeDecimals, tapeTick, mainNonce]);
  /* …and a premium has no price under zero: the axis room below the floor (the volume's band) carries no figures */
  const tapePremium = !!tape?.premium;
  useEffect(() => {
    if (!tapePremium) return;
    candleSeriesRef.current?.applyOptions({
      priceFormat: { type: 'custom', minMove: 0.01, formatter: (p: number) => (p < -0.004 ? '' : fmtPx(Math.max(0, p), 2)) },
    });
  }, [tapePremium, mainNonce]);

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
        if (!book || book.status === 'loading') {
          candleSeries.setData([]);
          volumeSeries.setData([]);
          trails.setData([], 0, false, 60, trailsGreek);
          return;
        }
      } else if (thetaChartNote(ticker, tfMinutes(timeframe), session) == null) {
        /* Still reading. A tape that already drew this name stays up — clearing it on every empty poll is what
           made the pane flash between a real scale and an empty −0.5…0.5 axis. */
        const held = loadedRef.current.ticker === ticker && loadedRef.current.timeframe === timeframe && barCountRef.current > 0;
        if (held) return;
        if (blankedRef.current) return;
        candleSeries.setData([]);
        volumeSeries.setData([]);
        trails.setData([], 0, false, 60, trailsGreek);
        blankedRef.current = true;
        barCountRef.current = 0;
        return;
      }
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
    const world = `${ticker}|${timeframe}|${barClock}`;
    worldKeyRef.current = world;
    const full = fullWorldRef.current === world;
    const bars = sliceFor(all, full, focusHoldRef.current, world);
    const held = bars.length < all.length;
    barCountRef.current = bars.length;
    drawnAllRef.current = !held;
    if (bars.length > 0) setQuiet(false);
    blankedRef.current = false;
    setBarsIn(bars.length > 0);
    /* A rule clock reads the seconds tape, so it wears the chip too. A host that brought real 15-second history is
       not "live since connect" — that chip would call two days of prints a gap. */
    setLiveFrom(!tapeRef.current?.native && !thetaBars() && (altSpec || mins < 1) ? bars[0]?.time ?? 0 : null);
    drawingsRef.current?.setBars(bars);
    drawnTimesRef.current = bars.map(b => b.time);
    if (nightSlotsRef.current.length) drawingsRef.current?.setBarTimes(withNight(drawnTimesRef.current));
    /* The measure counts bars and annualizes off them, so the layer has to know what a bar is worth here — set
       beside the times it belongs with, so a timeframe change can never move one without the other. */
    drawingsRef.current?.setBarMinutes(altSpec ? 0 : mins);
    /* The rulers ride the same load — one ATR fold per data pass, so the measure box and the flip strip cannot
       disagree about the day's range. */
    drawingsRef.current?.setDistanceScales({
      atr: sessionAtr(base),
      /* The vendor's implied move first — the one expected move the pages share (uwBook peekDaySigma) */
      sigma: (tapeRef.current?.premium ? null : peekDaySigma(ticker)) ?? daySigmaOfIv(base.length ? base[base.length - 1].close : 0, nameIv() ?? 0),
    });

    const loaded = loadedRef.current;
    const tapeKey = tapeRef.current?.key ?? '';
    const newWorld = loaded.ticker !== ticker || loaded.timeframe !== timeframe || loaded.clock !== barClock || tapeKeyRef.current !== tapeKey;
    const changed = newWorld || loaded.theme !== themeKey || loaded.full !== full;
    let armTimer = 0;

    /* A host's tape can jump. */
    const baseLast = base[base.length - 1].time;
    const prevEdge = lastBarTimeRef.current;
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
      /* THE GLIDE RIDES THE LANDING (the partner tree's abfc34b): bars landing IN FRONT of the first shift every logical
         index, and a wheel target kept in the old frame would drag the view into deep history. The target moves with the
         bars; a new world lets the glide go. */
      if (newWorld) zoomShiftRef.current.cancel();
      else if (firstBarRef.current > 0) {
        const delta = bars.findIndex(b => b.time >= firstBarRef.current);
        if (delta > 0) zoomShiftRef.current.shift(delta);
      }
      loadedRef.current = { ticker, timeframe, theme: themeKey, clock: barClock, full, session };
      tapeKeyRef.current = tapeKey;
      /* Armed a frame later: the library reports a range on the setData itself, before it has laid the view out
         (−83..6 was measured on a mount), and that would have asked for the whole store at once. */
      recentHeldRef.current = false;
      if (held) armTimer = requestAnimationFrame(() => (recentHeldRef.current = true));
    } else if (bars.length && !tailOnly(bars, altCountRef.current, firstBarRef.current, prevEdge, held, !!altSpec)) {
      /* A rule clock completes a bar and opens the next in one tick, and a two-session tape can land after a one-
         session paint. Update cannot rewrite older times, so a count jump reloads. */
      candleSeries.setData(bars.map(toMain));
      volumeSeries.setData(bars.map(b => toVolume(b, theme)));
      if (firstBarRef.current > 0) {
        const delta = bars.findIndex(b => b.time >= firstBarRef.current);
        if (delta > 0) zoomShiftRef.current.shift(delta);
      }
      /* Older sessions filling in do not move the right edge. Snapping there on every arrival is what made the
         price look stuck. */
      if (altSpec || bars[bars.length - 1].time !== prevEdge) showRecent();
    } else if (bars.length) {
      const last = bars[bars.length - 1];
      /* a bar that closed and the next that opened in one pass: the closed one's last prints first, then the new one */
      const prev = bars.length > 1 && last.time > prevEdge ? bars[bars.length - 2] : null;
      if (prev && prev.time === prevEdge) {
        candleSeries.update(toMain(prev));
        volumeSeries.update(toVolume(prev, theme));
      }
      candleSeries.update(toMain(last));
      volumeSeries.update(toVolume(last, theme));
    } else {
      /* The minute tape can be full while this frame's own tape is still empty (a day bar is not folded from
         minutes). Updating a bar that is not there is what stopped the page on 1D. */
      candleSeries.setData([]);
      volumeSeries.setData([]);
    }
    altCountRef.current = bars.length;
    firstBarRef.current = bars.length ? bars[0].time : 0;

    /* The exposure field on these bars. One column per bar open, as wide as the bar, carried through the session.
       A bad grid is dropped. It is not left forced off, and it is not laid out by spacing every strike down the pane. */
    const showTrails = !!overlays.trails;
    trails.labelPx = compact ? 8.5 : 9.5;
    const pushField = () => {
      try {
        const cols = showTrails ? fieldColumns(bars, mins) : [];
        trails.setData(cols, 0, showTrails, mins * 60, trailsGreek, 0, [], bars.map(b => ({ time: b.time, close: b.close })));
      } catch (e) {
        console.warn('[trails]', e);
        trails.setData([], 0, false, mins * 60, trailsGreek, 0, [], []);
      }
    };
    pushField();
    fieldViewRef.current = showTrails ? pushField : null;
    return () => cancelAnimationFrame(armTimer);
  }, [ticker, revision, timeframe, themeKey, overlays.trails, showRecent, reloadNonce, mainNonce, toMain, compact, altSpec, barClock, fullNonce, focusNonce, trailsGreek, levels.spot, levels.callWall, levels.putWall, levels.flip, levels.supreme, bookRev, session, tapeRev, bookDate, tapeStamp, fieldMode, fieldRev]);

  /* The last trade moves the bar that is still forming, outside React. A print must not re-render the pane. */
  useEffect(() => {
    if (!ownLive || altSpec) return;
    let seen = '';
    const apply = () => {
      const p = peekPrint(ticker);
      const key = p ? `${p.price}|${p.at}` : '';
      if (key === seen) return;
      seen = key;
      if (!p || replayRef.current || tapeRef.current) return;
      const series = candleSeriesRef.current;
      const vol = volumeSeriesRef.current;
      if (!series || !vol) return;
      if (loadedRef.current.ticker !== ticker) return;
      const bars = barsFor(tfMinutes(timeframe));
      const last = bars.length ? bars[bars.length - 1] : null;
      if (!last || !(last.close > 0)) return;
      const prevEdge = lastBarTimeRef.current;
      lastCloseRef.current = last.close;
      lastBarTimeRef.current = last.time;
      bucketSecRef.current = tfMinutes(timeframe) * 60;
      try {
        if (last.time > prevEdge && prevEdge > 0 && bars.length > 1) {
          const prev = bars[bars.length - 2];
          if (prev.time === prevEdge) {
            series.update(toMain(prev));
            vol.update(toVolume(prev, themeRef.current));
          }
        }
        series.update(toMain(last));
        vol.update(toVolume(last, themeRef.current));
      } catch {
        /* a print older than the drawn bar, or a chart that has not taken data yet */
      }
    };
    return subscribePrints(apply);
  }, [ownLive, ticker, timeframe, toMain, altSpec]); // eslint-disable-line react-hooks/exhaustive-deps

  /* A session click moves the view to that session's bars. It does not drop the other sessions. A session with no
     prints says so, and the tape that does have prices stays up. The range is the series on the chart, not the
     full store. A later showRecent does not undo the focus. */
  useEffect(() => {
    if (replayRef.current || altSpec || !thetaBars()) return;
    const chart = chartRef.current;
    const mins = tfMinutes(timeframe);
    const all = barsFor(mins);
    if (!chart || !all.length) return;
    const world = `${ticker}|${timeframe}|${barClock}`;
    /* a host's tape may name the window it opens on (a past call's trade): that window is the focus, not the session */
    const hostView = tapeRef.current?.view ?? null;
    const key = `${world}|${session}${hostView ? `|${hostView.from}-${hostView.to}` : ''}`;
    if (focusKeyRef.current === key) return;
    /* Opening a pane used to fit every bar of the session into the plot. On a 1-minute tape that is a few hours of
       candles crushed to a couple of pixels, and every later tape tick looked like the chart was shaking. A session
       the reader actually picks still moves the view. The first look stays on the recent bars. */
    if (openedWorldRef.current !== world && !hostView) {
      openedWorldRef.current = world;
      focusKeyRef.current = key;
      focusHoldRef.current = null;
      return;
    }
    openedWorldRef.current = world;
    const mine = hostView ? all.filter(b => b.time >= hostView.from && b.time <= hostView.to) : all.filter(b => barOnDesk(b.time, session, ticker, mins));
    if (!mine.length) {
      focusHoldRef.current = null;
      /* The other sessions stay on the chart. A pill that says this feed has no prints is a lie over a tape that
         has them. The header names an empty session. This overlay does not. */
      setSessionGap(prev => (prev === null ? prev : null));
      return;
    }
    setSessionGap(prev => (prev === null ? prev : null));
    const fromT = mine[0].time;
    const toT = mine[mine.length - 1].time;
    const hold: FocusHold = { key, from: fromT, to: toT };
    focusHoldRef.current = hold;
    const full = fullWorldRef.current === world;
    const want = sliceFor(all, full, hold, world);
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (want.length !== barCountRef.current) {
      if (focusBumpRef.current !== key) {
        focusBumpRef.current = key;
        setFocusNonce(n => n + 1);
        return;
      }
      if (candleSeries && volumeSeries) {
        candleSeries.setData(want.map(toMain));
        volumeSeries.setData(want.map(b => toVolume(b, themeRef.current)));
        barCountRef.current = want.length;
        altCountRef.current = want.length;
      }
    }
    focusKeyRef.current = key;
    let a = 0;
    let b = Math.max(0, want.length - 1);
    for (let i = 0; i < want.length; i++) {
      if (want[i].time >= fromT) {
        a = i;
        break;
      }
    }
    for (let i = want.length - 1; i >= 0; i--) {
      if (want[i].time <= toT) {
        b = i;
        break;
      }
    }
    /* the bars' own slots on the time scale (the overnight layer's slots can stand between them) */
    const slot = (i: number) => {
      const at = want[i] ? chart.timeScale().timeToIndex(want[i].time as UTCTimestamp, true) : null;
      return at != null ? Number(at) : i;
    };
    const atEnd = b >= want.length - 1;
    a = slot(a);
    b = slot(b);
    const pad = Math.max(3, Math.round((b - a) * 0.06));
    /* the session dominates; ahead of its last bar, room for the cone's end and the edge tags (about a seventh of the
       plot when the session ends at the tape's end, the plain pad when it is an earlier one) */
    const ahead = atEnd ? Math.max(pad, Math.round((b - a + pad) * 0.17)) : pad;
    try {
      chart.timeScale().setVisibleLogicalRange({ from: a - pad, to: b + ahead });
    } catch {
      /* chart already gone */
    }
  }, [session, ticker, timeframe, barClock, tapeRev, mainNonce, focusNonce, toMain, altSpec, tapeStamp, tape?.view?.from, tape?.view?.to]);

  /* `compact` can change without the chart being rebuilt — a desktop window dragged across the phone line, a handset
     rotated. The mount effect read it once at create time, so apply later changes here. */
  useEffect(() => {
    chartRef.current?.applyOptions({ layout: { fontSize: compact ? 9 : 10 } });
  }, [compact]);

  /* Fewer price ticks on a short pane (a 3- or 4-pane desk, the phone): a tick every ~70px instead of every ~25, so the
     axis reads as a scale, not a column of figures beside the nodes' labels */
  const tickDensity = boxH > 0 && boxH < 380 ? 5 : boxH > 0 && boxH < 560 ? 3.6 : 2.5;
  useEffect(() => {
    try {
      chartRef.current?.priceScale('right').applyOptions({ tickMarkDensity: tickDensity });
    } catch {
      /* chart already gone */
    }
  }, [tickDensity, mainNonce]);

  /* The desk's clock changed (Settings, or Terrain's timezone door): the formatters read it on every call, so a fresh
     set of options is only the nudge that makes the library redraw its labels now */
  const deskClock = useDeskPrefs().clock;
  useEffect(() => {
    if (tapeRef.current?.clock === 'ny') return;
    try {
      chartRef.current?.applyOptions({ localization: LOCAL_TIME, timeScale: { tickMarkFormatter: localTickMarks } });
      /* the day ticks sit on the zone's midnights (chartTime createZonedChart): weigh the bars again in the new zone */
      rezoneAxis(candleSeriesRef.current);
    } catch {
      /* chart already gone */
    }
  }, [deskClock, mainNonce]);

  /* Crossing the breakpoint must not need a remount — the chart is created once and a window drag changes which side
     of it the reader is on. */
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: { mouseWheel: true },
      /* the wheel's zoom is the glide's (onWheelZoom), never the library's notch */
      handleScale: { mouseWheel: false },
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

  /* The ladder names each level at the edge with its distance from the price; max pain rides with the levels. With the
     nodes on, the nodes' edge tags name the levels instead (one column of names at the right edge, pushed apart, never
     over the candles) and the ladder keeps its rungs, each leading into its tag. */
  /* the zones, the profile and the tags follow a replay too: they read the field's columns, which stop at the replay bar */
  const nodeTags = overlays.trails;
  useEffect(() => {
    ladderRef.current?.setNamed(nodeTags ? null : levels.spot, levels.shares, levels.maxPain ?? null, EXTRA_INK.maxPain);
  }, [levels.spot, levels.shares, levels.maxPain, nodeTags, mainNonce]);
  useEffect(() => {
    const trails = trailsRef.current;
    if (!trails) return;
    trails.setLook(nodeLook);
    trails.setTagsOn(nodeTags);
    /* the key levels, or with them off the cone's 1σ ends: one column of names at the edge, fitted with the nodes' own
       (edgeLabelFit.ts) — the cone prints no words of its own while the nodes name the edge */
    trails.edgeLevels = overlays.levels
      ? () => (ladderRef.current?.visible() ?? []).map(r => edgeLevelOf(r))
      : overlays.cone
        ? () => coneEdgeRef.current.map(r => edgeLevelOf(r))
        : null;
    trails.requestUpdate?.();
  }, [nodeLook, nodeTags, overlays.levels, overlays.cone, mainNonce]);

  /* Node pressure: price near one of the three heaviest nodes now or the flip fires the app's alert, once a level a
     session (data/nodePressure.ts). Live only — a replay is history. */
  const nodeAlertPct = desk.nodeAlertPct;
  useEffect(() => {
    if (!overlays.nodeAlert || replay || tape) return;
    const trails = trailsRef.current;
    const price = lastCloseRef.current ?? levels.spot;
    if (!trails || !(price > 0)) return;
    const named = (strike: number): string =>
      Math.abs(strike - levels.supreme) < 1e-9 ? 'Supreme' : Math.abs(strike - levels.callWall) < 1e-9 ? 'Call wall' : Math.abs(strike - levels.putWall) < 1e-9 ? 'Put wall' : 'Node';
    const near: PressureLevel[] = trails.topNow(3).map(n => ({ price: n.strike, name: named(n.strike), value: n.value }));
    if (Number.isFinite(levels.flip) && levels.flip > 0) near.push({ price: levels.flip, name: 'Flip', value: null });
    checkPressure(ticker, price, near, nodeAlertPct, paneId ?? 'chart', timeframe, lastBarTimeRef.current ?? 0);
  }, [overlays.nodeAlert, replay, revision, ticker, timeframe, nodeAlertPct, levels.spot, levels.flip, levels.supreme, levels.callWall, levels.putWall, paneId, trailRef]); // eslint-disable-line react-hooks/exhaustive-deps

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
      coneEdgeRef.current = [];
      return;
    }
    /* The cone is the expected move of the interval on this chart, not a fixed session fan. */
    const mins = tfMinutes(timeframe);
    const bars = barsFor(mins);
    ensureCone(ticker);
    const barSpot = bars.length ? bars[bars.length - 1].close : 0;
    const print = peekPrint(ticker);
    const live = print && print.price > 0 ? print.price : 0;
    const spot = live > 0 ? live : barSpot;
    const term = coneTerm(ticker);
    const perBar = tradingMinutesPerBar(mins);
    const now = Date.now();
    const clock = coneFrame(mins, now);
    const step = Math.max(1, Math.round(clock.next / 80));
    const fc = term && spot > 0 ? forwardCone(term.rows, spot, now, todayOpenOf(bars), step, clock) : null;
    /* the cone stands on the last bar the chart DRAWS: a chart opens on its recent window (sliceFor), so the tape's
       full length put the anchor hundreds of bars past the edge and the cone off screen */
    const shown = barCountRef.current;
    const drawn = shown > 0 && shown < bars.length ? bars.slice(-shown) : bars;
    prim.setData(
      fc
        ? {
            cone: { past: [], forward: fc.points, crossings: [], openPrice: 0, openTime: null },
            marks: coneMarks(fc, clock.label),
            /* the key levels name the cone's ends at the edge; without them the cone names its own */
            markWords: !overlays.levels && !overlays.trails,
            barTimes: withNight(drawn.map(b => b.time)),
            barMinutes: perBar,
            anchor: withNight(drawn.map(b => b.time)).length - 1,
            oddsName: clock.label,
            iv: fc.ivNext,
            source: term?.source === 'theta' ? 'at-the-money implied vol' : 'term structure',
          }
        : null,
    );
    /* the cone's numbers at the edge: today's expected move, and ±1σ to the tip of this frame */
    coneEdgeRef.current = coneRungs(fc, clock.label);
    ladderRef.current?.setExtras('cone', coneEdgeRef.current);
    trailsRef.current?.requestUpdate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, revision, overlays.cone, overlays.levels, replay, mainNonce, altSpec, session, tapeRev, volsRev, fullNonce, nightRev]);

  /* THE WIND FIELD — a model forecast of the rest of today's session (core/windField.ts, data/windInputs.ts). Its σ is
     the cone's own (the at-the-money implied vol to today's close on the trading clock), its book the chain the nodes
     read, its clock the session module's, its drift the name's carry. Asked of the worker once a minute and once a
     tenth of a move; a tick in between repaints the field it has. Off in replay, on a rule clock and on day bars. */
  useEffect(() => {
    const prim = windPrimRef.current;
    if (!prim) return;
    const mins = tfMinutes(timeframe);
    if (!overlays.wind || replay || altSpec || mins >= 1440) {
      prim.setData(null);
      windAskRef.current = '';
      setWindWhy(null);
      return;
    }
    const bars = barsFor(mins);
    ensureCone(ticker);
    const print = peekPrint(ticker);
    const spot = print && print.price > 0 ? print.price : bars.length ? bars[bars.length - 1].close : 0;
    const now = Date.now();
    const term = coneTerm(ticker);
    const fc = term && spot > 0 ? forwardCone(term.rows, spot, now, null) : null;
    const name = sameName(ticker);
    const nodes = chainForDate(name, bookDate ?? 'book')?.nodes ?? [];
    const todayIso = nyWall(now).iso;
    const today = chainForDate(name, todayIso);
    const closes: number[] = [];
    for (const b of baseBars()) {
      const w = nyWall(b.time * 1000);
      if (b.time * 1000 <= now && w.iso === todayIso && w.min >= REGULAR_OPEN_MIN) closes.push(b.close);
    }
    const ready = windInputsFor({
      ticker,
      now,
      spot,
      sigmaToday: fc?.sigmaToday ?? null,
      nodes,
      sameDay: today && today.date === todayIso ? today.nodes : [],
      closes,
      carry: carryFor(ticker),
    });
    if (!ready.ok) {
      prim.setData(null);
      setWindWhy(ready.why);
      return;
    }
    setWindWhy(null);
    const { inputs, clock } = ready;
    const sigStep = Math.max(spot * inputs.sigmaLeft * 0.1, 0.01);
    const sig = `${clock.iso}|${clock.nyMin}|${Math.round(spot / sigStep)}|${inputs.sigmaLeft.toFixed(5)}|${nodes.length}|${bookRev}`;
    const key = `${paneId ?? 'chart'}:${ticker}`;
    if (windAskRef.current !== sig) {
      windAskRef.current = sig;
      void askWind(key, sig, inputs).then(f => {
        if (f && windAskRef.current === sig) setWindField(f);
      });
    }
    const f = windField;
    if (!f || f.density.cols <= 0 || Math.abs(f.spot - spot) > spot * inputs.sigmaLeft) {
      prim.setData(null);
      return;
    }
    const host = containerRef.current ?? document.documentElement;
    const light = chartGround(themeKey) === 'light';
    const shown = barCountRef.current;
    const drawn = shown > 0 && shown < bars.length ? bars.slice(-shown) : bars;
    prim.setData({
      cols: f.density.cols,
      lo: f.density.lo,
      step: f.density.step,
      bins: f.density.bins,
      cells: f.density.cells,
      streams: f.streams,
      spot: f.spot,
      inks: {
        up: rgbOf(resolveInk(GLACIER, host)),
        down: rgbOf(resolveInk(EMBER, host)),
        core: THERMAL_YELLOW,
        text: rgbOf(resolveInk('rgb(var(--text-primary))', host)),
        strength: light ? 0.62 : 0.8,
      },
      anchor: withNight(drawn.map(b => b.time)).length - 1,
      perBar: tradingMinutesPerBar(mins),
      label: 'Wind · model forecast',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, revision, overlays.wind, replay, mainNonce, altSpec, session, tapeRev, volsRev, fullNonce, nightRev, windField, bookRev, bookDate, themeKey]);

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
      prints: (flowRows).filter(p => cut == null || sec(p.at) <= cut).map(p => ({ ...p, at: sec(p.at) })),
      earnings: cal.earnings,
      macro: cal.macro,
      todayIso: cal.todayIso,
    });
    prim.setData({
      events: cut == null ? built : built.filter(e => e.time != null && e.time <= cut),
      /* the bars the tape draws, never the whole store: the lane maps a time to a logical index on the drawn series, and a
         list longer than it (a deep history held but not drawn) put every glyph thousands of pixels off the plot */
      barTimes: (() => {
        const drawn = drawnTimes();
        const times = drawn.length ? drawn : bars.map(b => b.time);
        return withNight(cut == null ? times : times.filter(t => t <= cut));
      })(),
      barMinutes: mins,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, revision, overlays.events, replay, replayIdx, mainNonce, flowRows, altSpec, nightRev]);

  /* The live price, as a card on the right scale. The library draws a flat one-line tag for the last value.
     A desk left mounted behind the one on screen does not keep a frame loop running. */
  useEffect(() => {
    if (!deskAwake) return;
    const series = candleSeriesRef.current;
    if (!series) return;
    const on = priceTag && !replay;
    series.applyOptions({ lastValueVisible: !on });
    if (!on) return;

    const chart = chartRef.current;
    const el = priceTagRef.current;
    if (!chart || !el) return;
    const priceEl = el.querySelector<HTMLElement>('[data-price-figure]');
    const timeEl = el.querySelector<HTMLElement>('[data-price-left]');
    if (!priceEl || !timeEl) return;

    let shownPrice = '';
    let shownLeft = '';
    let shownY = Number.NaN;
    let shownW = -1;

    const frame = () => {
      priceTagRafRef.current = window.setTimeout(frame, 100);
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

      const p = fmtPx(price, 2);
      const minute = nyMinutes((lastBarTimeRef.current || 0) * 1000);
      const sess = sessionOfMinute(minute);
      const suffix = sess === 'pre' ? ' pre' : sess === 'post' ? ' AH' : sess === 'overnight' ? ' ON' : '';
      let label = `${p}${suffix}`;
      /* The gutter is the tag's width. Omit pre/AH/ON when the suffix would run past it. */
      if (suffix && gw > 0) {
        const font = getComputedStyle(priceEl).font;
        const width = measureLabel(label, font);
        const pad = 10;
        if (width + pad > gw) label = p;
      }
      if (label !== shownPrice) {
        priceEl.textContent = label;
        shownPrice = label;
      }

      /* The candle this close belongs to, under the price. The bar's own open, New York: a day bar says the date,
         an intraday bar the clock. A rule bar has no candle. */
      const anchor = lastBarTimeRef.current;
      const step = Math.round(tfMinutes(timeframe) * 60);
      const t = anchor > 0 && !altSpec ? (step >= 86_400 ? nyDay(anchor * 1000) : nyClock(anchor * 1000)) : '';
      if (t !== shownLeft) {
        timeEl.textContent = t;
        timeEl.classList.toggle('hidden', t === '');
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

    priceTagRafRef.current = window.setTimeout(frame, 100);
    return () => {
      window.clearTimeout(priceTagRafRef.current);
      candleSeriesRef.current?.applyOptions({ lastValueVisible: true });
    };
  }, [priceTag, timeframe, replay, mainNonce, altSpec, deskAwake]);

  // Dark-pool whisper lines — same grammar as the flow board minis
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    for (const line of printLinesRef.current) candleSeries.removePriceLine(line);
    printLinesRef.current = [];
    if (!overlays.darkpool || replay) return;
    const spot = lastCloseRef.current && lastCloseRef.current > 0 ? lastCloseRef.current : levels.spot;
    /* Terrain's tape: the few largest off-exchange prints as lines, in the highlight ink; the rest are marks on the bars */
    const lineInk = printTape && boxElRef.current ? readToken('--select', undefined, boxElRef.current) : DARK_POOL;
    printLinesRef.current = darkNear(darkRows, spot).slice(0, printTape ? TAPE_DARK_LINES : undefined).map(print =>
      candleSeries.createPriceLine({
        price: print.price,
        color: lineInk,
        title: `DP ${fmtUsd(print.notional)}${print.time ? ` · ${print.time}` : print.date ? ` · ${print.date}` : ''}`,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        axisLabelColor: lineInk,
        /* the select ink is light on dark and deep on paper: the label's words take the panel's ground */
        axisLabelTextColor: printTape && boxElRef.current ? readToken('--panel', undefined, boxElRef.current) : '#0a0a0a',
      })
    );
  }, [darkRows, overlays.darkpool, replay, mainNonce, levels.spot, revision, printTape, appTheme]);

  /* Terrain's stock prints on the bars: the session's largest off-exchange prints and blocks, each at its price on its
     bar — a circle off-exchange, a square on an exchange; the side's ink (buyer, seller, none) */
  const stockMarksRef = useRef<{ series: unknown; api: ISeriesMarkersPluginApi<Time> } | null>(null);
  useEffect(() => {
    const series = candleSeriesRef.current;
    const held = stockMarksRef.current;
    const on = printTape && !!overlays.darkpool && !replay && !!series && !altSpec;
    if (!on) {
      if (held && held.series === series) held.api.setMarkers([]);
      return;
    }
    if (!held || held.series !== series) stockMarksRef.current = { series, api: createSeriesMarkers(series!, []) };
    const el = boxElRef.current ?? undefined;
    const inks = { buy: readToken('--glacier', undefined, el), sell: readToken('--ember', undefined, el), none: readToken('--text-secondary', undefined, el) };
    stockMarksRef.current!.api.setMarkers(stockMarkers(stockTape.marks, drawnTimes(), tfMinutes(timeframe) * 60, inks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printTape, stockTape.marks, overlays.darkpool, replay, mainNonce, revision, timeframe, altSpec, barsIn]);

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
        a.source === 'vwap' ? last(vwapSeries(bars, mins, session))
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
        ? flowRows.filter(p => p.ticker === ticker).map(p => ({ at: p.at, premium: p.premium }))
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
  }, [alerts, ticker, revision, replay, timeframe, flowRows]);

  useEffect(() => {
    /* undo (Ctrl+Z) and redo (Ctrl+Y, Ctrl+Shift+Z) for drawing changes — not while typing */
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const redo = k === 'y' || (k === 'z' && e.shiftKey);
      if (k !== 'z' && k !== 'y') return;
      if (redo ? !redoHistory() : !undoHistory()) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ThetaData's bars for this pane and its compares, kept fresh while it is on screen: the one-minute tape (the
     session levels, the ATR and the cone read it) and the timeframe's own grain */
  useEffect(() => {
    if (!deskAwake || tape || !thetaBars()) return;
    const names = [ticker, ...compareNames.split(',').filter(Boolean)];
    const grain = chartGrain(tfMinutes(timeframe));
    const offs = names.flatMap(n => wantChartTape(n, grain, session));
    return () => offs.forEach(off => off());
  }, [ticker, compareNames, timeframe, session, !!tape, deskAwake]); // eslint-disable-line react-hooks/exhaustive-deps



  /* The focus ink follows the strike's standing, re-read every scan: magenta while the focused strike is the
     supreme, silver otherwise. */
  useEffect(() => {
    const isSupreme = focusPrice != null && Math.abs(levels.supreme - focusPrice) < 1e-9;
    trailsRef.current?.setFocus(focusPrice, isSupreme ? 'supreme' : 'focus');
    /* The nodes name the book's walls, flip and supreme on their zones' tags, and bead their strikes */
    const fin = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
    /* in a replay the live book's names would be the future's: the zones go unnamed there */
    trailsRef.current?.setSupreme(replay ? null : fin(levels.supreme));
    trailsRef.current?.setWalls(replay ? null : fin(levels.callWall), replay ? null : fin(levels.putWall), replay ? null : fin(levels.flip));
    focusLineRef.current?.applyOptions({ color: isSupreme ? SUPREME : focusInk() });
  }, [focusPrice, overlays.levels, levels.supreme, levels.callWall, levels.putWall, levels.flip, replay]);

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
        for (let i = 1; i < bars.length; i++) if (sessionOccurrence(bars[i].time, session) !== sessionOccurrence(bars[i - 1].time, session)) starts.push(i);
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
      loadedRef.current = { ticker: '', timeframe: '1m', theme: '', clock: 'time', full: false, session: '' };
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

    const mins = tfMinutes(timeframe);
    const shown = data.bars.slice(0, idx);
    /* The same carried level as live, cut off at this bar. Sparse snapshots are not asked to become bands. */
    trails.setData(
      fieldColumns(shown, mins, false),
      0,
      overlays.trails,
      mins * 60,
      trailsGreek,
      0,
      [],
      shown.map(b => ({ time: b.time, close: b.close })),
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
    /* sync drawings turned off: this pane starts from the tape's shared set, then keeps its own */
    const shared = tape?.key ?? ticker;
    if (drawKey !== shared && loadDrawings(drawKey).length === 0) {
      const from = loadDrawings(shared);
      if (from.length) saveDrawings(drawKeyRef.current, from);
    }
    shapesRef.current = loadDrawings(drawKey);
    drawingsRef.current?.setDrawings([...shapesRef.current]);
  }, [drawKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* SYNC: another pane on this tape changed its drawings — take the stored set, unless it is what is already here */
  useEffect(
    () =>
      hearDrawings(key => {
        if (key !== drawKeyRef.current || editRef.current) return;
        const next = loadDrawings(key);
        if (JSON.stringify(next) === JSON.stringify(shapesRef.current)) return;
        shapesRef.current = next;
        drawingsRef.current?.setDrawings(next);
        setSelectedIdx(i => {
          if (i !== null && i >= next.length) {
            drawingsRef.current?.setSelected(null);
            return null;
          }
          return i;
        });
        forceMarkRef.current();
      }),
    []
  );
  /** History: the stored set one step back (or forward); the selection is dropped, since its index may name another mark */
  const applyHistory = (next: Drawing[] | null): boolean => {
    if (!next) return false;
    shapesRef.current = next;
    drawingsRef.current?.setDrawings(next);
    drawingsRef.current?.setSelected(null);
    setSelectedIdx(null);
    forceMarkRef.current();
    return true;
  };
  const undoHistory = () => applyHistory(popDrawings(drawKeyRef.current));
  const redoHistory = () => applyHistory(redoDrawings(drawKeyRef.current));
  const forceMarkRef = useRef<() => void>(() => {});
  const [treeOpen, setTreeOpen] = useState(false);

  const commitDrawing = useCallback(
    (raw: Drawing) => {
      /* Made whole first (the primitive's normalise): a position is born with its stop, the VWAP's anchor sits on
         its curve */
      /* the tool's default template first (drawTemplates.ts), then made whole */
      const styled = withDefaultTemplate(raw);
      const d = drawingsRef.current?.normalise(styled) ?? styled;
      shapesRef.current = [...shapesRef.current, d];
      drawingsRef.current?.setDrawings(shapesRef.current);
      saveDrawings(drawKeyRef.current, shapesRef.current);
      /* The tool empties into your hand. Placing a mark drops the tool back to Select with the new mark already
         selected, so the very next drag moves it. Want another one? — unless the reader keeps drawing (the rail's
         stay-in-drawing switch, TradingView's), when the tool stays in hand for the next one. */
      if (drawPrefs().stay) return;
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
  /* A short pane (a 3- or 4-pane desk) or a narrow one (the phone) folds the drawing tools to their slim tab at rest:
     the column of nine buttons beside every chart was most of the crowding. The tab opens them in this pane (railPeek);
     drawing keeps them out. */
  const smallPane = (boxH > 0 && boxH < 460) || (boxW > 0 && boxW < 460);
  const [railPeek, setRailPeek] = useState(false);
  useEffect(() => {
    if (!smallPane) setRailPeek(false);
  }, [smallPane]);
  /* The dock the reader asked for, honoured only where it fits. */
  const rail = {
    open: railPrefs.open && (!smallPane || railPeek || drawing),
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
  /* The open rail docked down the left covers the plot's left 50 px: the legend and the panes' titles start past it */
  const railGutter = !hostRail && !compact && (drawing || !!onEnterDraw) && rail.open && rail.dock === 'left' ? 58 : undefined;
  const leftDockStyle = rail.dock === 'left' && boxH > 0 ? { top: Math.max(boxH / 2, chromeInset + 8 + railH / 2), maxHeight: Math.max(120, boxH - chromeInset - 16) } : undefined;
  /* …and never over the TradingView mark in the bottom-left corner, which its licence keeps seen and clickable. On a
     short pane (a desk of three or four) the rail, held under the chrome, reaches the corner: there the mark steps
     right of the rail's column (index.css [data-tv-mark-beside]) rather than the rail losing its foot to a scroll. A
     finger's 44px box round the mark reaches 12.5px above it, hence the 14. */
  const markBeside =
    !hostRail && !compact && (drawing || !!onEnterDraw) && rail.open && rail.dock === 'left' && boxH > 0 && railH > 0 &&
    Math.max(boxH / 2, chromeInset + 8 + railH / 2) + railH / 2 > boxH - markClear - 14;
  const [, forceMark] = useReducer((x: number) => x + 1, 0);
  forceMarkRef.current = forceMark;
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const [barMenu, setBarMenu] = useState<'color' | 'tcolor' | 'width' | 'style' | null>(null);
  useEffect(() => setBarMenu(null), [selectedIdx]);

  const updateSelected = useCallback(
    (patch: Partial<Drawing>) => {
      const i = selectedIdx;
      if (i === null) return;
      shapesRef.current = shapesRef.current.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
      drawingsRef.current?.setDrawings(shapesRef.current);
      saveDrawings(drawKeyRef.current, shapesRef.current);
      forceMark();
    },
    [selectedIdx, ticker]
  );

  /* The rail's switches (drawTools prefs): hide all reaches the layer; the layer knows the timeframe for marks kept to one */
  const drawSwitches = useDrawToolPrefs();
  useEffect(() => {
    drawingsRef.current?.setHideAll(drawSwitches.hideAll);
  }, [drawSwitches.hideAll]);
  useEffect(() => {
    drawingsRef.current?.setTimeframe(timeframe);
  }, [timeframe]);
  const allLocked = shapesRef.current.length > 0 && shapesRef.current.every(d => d.locked);
  const lockAll = useCallback(() => {
    const on = !(shapesRef.current.length > 0 && shapesRef.current.every(d => d.locked));
    shapesRef.current = shapesRef.current.map(d => ({ ...d, locked: on }));
    drawingsRef.current?.setDrawings(shapesRef.current);
    saveDrawings(drawKeyRef.current, shapesRef.current);
    forceMark();
  }, [ticker]);
  /* Clone (TradingView's): the same mark, three bars later, selected so the next drag places it */
  const cloneSelected = useCallback(() => {
    const prim = drawingsRef.current;
    const i = selectedIdx;
    if (!prim || i === null || !shapesRef.current[i]) return;
    const o = shapesRef.current[i];
    const shift = (q?: { time: number; price: number }) => {
      if (!q) return undefined;
      const bi = prim.barIndexOf(q.time);
      const t = bi === null ? null : prim.timeAtBarIndex(bi + 3);
      return t === null ? q : { time: t, price: q.price };
    };
    const pts = o.pts?.map(q => shift(q) ?? q);
    const copy: Drawing = { ...o, locked: false, p1: shift(o.p1)!, p2: shift(o.p2), p3: shift(o.p3), ...(pts ? { pts } : {}) };
    shapesRef.current = [...shapesRef.current, copy];
    prim.setDrawings(shapesRef.current);
    saveDrawings(drawKeyRef.current, shapesRef.current);
    const idx = shapesRef.current.length - 1;
    setSelectedIdx(idx);
    prim.setSelected(idx);
  }, [selectedIdx, ticker]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (selectedIdx === null) setSettingsOpen(false);
  }, [selectedIdx]);

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

  const clearDrawings = useCallback(() => {
    shapesRef.current = [];
    drawingsRef.current?.setDrawings([]);
    saveDrawings(drawKeyRef.current, []);
    deselect();
  }, [ticker, deselect]);

  /** `flip`: Ctrl/⌘ held — TradingView's key that turns the magnet the other way for as long as it is down */
  const pointFromClient = (clientX: number, clientY: number, flip = false): { time: number; price: number } | null => {
    const container = containerRef.current;
    const candleSeries = candleSeriesRef.current;
    const prim = drawingsRef.current;
    if (!container || !candleSeries || !prim) return null;
    const rect = container.getBoundingClientRect();
    const time = prim.xToTime(clientX - rect.left);
    const price = candleSeries.coordinateToPrice(clientY - rect.top);
    if (time === null || price === null) return null;
    const mode = drawPrefs().magnet;
    const on = (mode !== 'off') !== flip;
    if (on) return { time, price: prim.magnet(time, price, mode === 'off' ? 'weak' : mode) };
    return { time, price };
  };
  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => pointFromClient(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
  /** Shift held: a line holds to 45° (flat, upright or diagonal), a box or an ellipse to a square or a circle */
  const constrained = (kind: DrawingKind, p1: { time: number; price: number }, p: { time: number; price: number }, shift: boolean) => {
    const prim = drawingsRef.current;
    const series = candleSeriesRef.current;
    if (!shift || !prim || !series) return p;
    const box = kind === 'rect' || kind === 'ellipse' || kind === 'circle' || kind === 'gannbox';
    if (!isLineKind(kind) && !box) return p;
    const x1 = prim.timeToX(p1.time);
    const y1 = series.priceToCoordinate(p1.price);
    const x2 = prim.timeToX(p.time);
    const y2 = series.priceToCoordinate(p.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return p;
    let q: [number, number];
    if (box) {
      const side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      q = [x1 + Math.sign(x2 - x1 || 1) * side, y1 + Math.sign(y2 - y1 || 1) * side];
    } else q = snap45([x1, y1], [x2, y2]);
    const time = prim.xToTime(q[0]);
    const price = series.coordinateToPrice(q[1]);
    return time === null || price === null ? p : { time, price };
  };
  /** Shift+click on the chart measures (TradingView's): the measure's first corner is down, the next click lands it */
  const startShiftMeasure = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (!e.shiftKey || !onEnterDraw) return false;
    const p = pointFromClient(e.clientX, e.clientY);
    if (!p) return false;
    e.preventDefault();
    e.stopPropagation();
    if (!drawing) onEnterDraw();
    setDrawTool('measure');
    pendingSecondRef.current = { kind: 'measure', p1: p };
    drawingsRef.current?.setDraft({ kind: 'measure', p1: p, p2: p });
    return true;
  };
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
    if (e.button === 0 && startShiftMeasure(e)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const prim = drawingsRef.current;
    if (!rect || !prim) return;
    const hit = prim.hitTestAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    onEnterDraw?.();
    setDrawTool('select');
    const start = pointFromClient(e.clientX, e.clientY);
    const at = (e.ctrlKey || e.metaKey || e.altKey) && hit.anchor === null ? cloneForDrag(hit.index) : hit.index;
    setSelectedIdx(at);
    prim.setSelected(at);
    if (!start) return;
    editRef.current = { index: at, anchor: hit.anchor, start, orig: shapesRef.current[at], moved: at !== hit.index };
    const move = (ev: PointerEvent) => {
      const pt = pointFromClient(ev.clientX, ev.clientY);
      if (pt) applyEdit(pt);
    };
    const up = () => {
      if (editRef.current?.moved) saveDrawings(drawKeyRef.current, shapesRef.current);
      editRef.current = null;
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  /** Ctrl/Alt+drag's copy: the mark at `i`, unlocked, laid on top; its index */
  const cloneForDrag = (i: number): number => {
    const o = shapesRef.current[i];
    if (!o) return i;
    shapesRef.current = [...shapesRef.current, { ...o, locked: undefined, name: o.name ? `${o.name} copy` : undefined }];
    drawingsRef.current?.setDrawings(shapesRef.current);
    return shapesRef.current.length - 1;
  };
  /* the object tree's edits: a mark's fields, its delete, its place in the stack */
  const treePatch = (i: number, patch: Partial<Drawing>) => {
    if (!shapesRef.current[i]) return;
    shapesRef.current = shapesRef.current.map((d, k) => (k === i ? { ...d, ...patch } : d));
    drawingsRef.current?.setDrawings(shapesRef.current);
    saveDrawings(drawKeyRef.current, shapesRef.current);
    forceMark();
  };
  const treeDelete = (i: number) => {
    if (!shapesRef.current[i]) return;
    shapesRef.current = shapesRef.current.filter((_, k) => k !== i);
    drawingsRef.current?.setDrawings(shapesRef.current);
    saveDrawings(drawKeyRef.current, shapesRef.current);
    setSelectedIdx(s => {
      const n = s === null || s === i ? null : s > i ? s - 1 : s;
      drawingsRef.current?.setSelected(n);
      return n;
    });
    forceMark();
  };
  const treeMove = (from: number, to: number) => {
    const list = [...shapesRef.current];
    if (!list[from] || to < 0 || to >= list.length || from === to) return;
    const [m] = list.splice(from, 1);
    list.splice(to, 0, m);
    shapesRef.current = list;
    drawingsRef.current?.setDrawings(list);
    saveDrawings(drawKeyRef.current, list);
    setSelectedIdx(s => {
      const n = s === from ? to : s === null ? null : s > from && s <= to ? s - 1 : s < from && s >= to ? s + 1 : s;
      drawingsRef.current?.setSelected(n);
      return n;
    });
    forceMark();
  };
  const treeSelect = (i: number) => {
    if (!drawing) onEnterDraw?.();
    setDrawTool('select');
    setSelectedIdx(i);
    drawingsRef.current?.setSelected(i);
  };

  const deleteSelected = useCallback(() => {
    setSelectedIdx(idx => {
      if (idx !== null && shapesRef.current[idx]) {
        shapesRef.current = shapesRef.current.filter((_, i) => i !== idx);
        drawingsRef.current?.setDrawings(shapesRef.current);
        saveDrawings(drawKeyRef.current, shapesRef.current);
      }
      drawingsRef.current?.setSelected(null);
      return null;
    });
    editRef.current = null;
  }, [ticker]);

  /* THE HANDLE A RAIL OUTSIDE THIS CHART HOLDS (Noah's, drawTools.tsx): the hands read through a ref so the registration is
     one effect for the chart's life; and the chart says what its drawing is doing by its pane's name, so the desk rail
     wears the tool in hand, lights its lock, its tree and its undo */
  const handleRef = useRef({ arm: pickTool, select: () => setDrawTool('select'), deleteSelected, clear: clearDrawings, lockAll, toggleTree: () => setTreeOpen(o => !o), undo: undoHistory, redo: redoHistory });
  handleRef.current = { arm: pickTool, select: () => setDrawTool('select'), deleteSelected, clear: clearDrawings, lockAll, toggleTree: () => setTreeOpen(o => !o), undo: undoHistory, redo: redoHistory };
  useEffect(
    () =>
      canDraw
        ? registerDrawChart(
            chartId,
            {
              arm: kind => handleRef.current.arm(kind),
              select: () => handleRef.current.select(),
              deleteSelected: () => handleRef.current.deleteSelected(),
              clear: () => handleRef.current.clear(),
              lockAll: () => handleRef.current.lockAll(),
              toggleTree: () => handleRef.current.toggleTree(),
              undo: () => void handleRef.current.undo(),
              redo: () => void handleRef.current.redo(),
            },
            paneId ?? null
          )
        : undefined,
    [canDraw, chartId, paneId]
  );
  /* after every render — the marks live in a ref, so no dependency list could see a lock or a new mark; the store compares
     the fields and tells nobody when nothing moved */
  useEffect(() => {
    if (!canDraw || !paneId) return;
    const marks = shapesRef.current;
    reportDrawState(paneId, {
      drawing: !!drawing,
      tool: drawTool,
      selected: selectedIdx !== null,
      count: marks.length,
      locked: marks.length > 0 && marks.every(d => d.locked),
      treeOpen,
      canUndo: canUndo(drawKey),
      canRedo: canRedo(drawKey),
    });
  });

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

    /* The select tool — the pointer that picks a mark up instead of making one. Shift+click measures, as on the tape. */
    if (drawTool === 'select') {
      if (startShiftMeasure(e)) return;
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
      /* Ctrl/Alt+drag (TradingView's): the body drag moves a copy, the original stays */
      const at = (e.ctrlKey || e.metaKey || e.altKey) && hit.anchor === null ? cloneForDrag(hit.index) : hit.index;
      setSelectedIdx(at);
      drawingsRef.current?.setSelected(at);
      editRef.current = { index: at, anchor: hit.anchor, start: p, orig: shapesRef.current[at], moved: at !== hit.index };
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
      commitDrawing({ ...base, p2: constrained(base.kind, base.p1, p, e.shiftKey) });
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
      const n = fixedPoints(drawTool);
      /* a pattern's pivots are on different bars — a second press on the same bar (a double-click) is not a pivot */
      if (n !== undefined && run.length && run[run.length - 1].time === p.time) return;
      run.push(p);
      /* a pattern seals itself on its last pivot — XABCD on its fifth press, head and shoulders on its seventh */
      if (n !== undefined && run.length >= n) {
        pathDraftRef.current = null;
        drawingsRef.current?.setDraft(null);
        commitDrawing({ kind: drawTool, p1: run[0], pts: run.slice(0, n) });
        return;
      }
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
    if (drawTool === 'select' || gestureOf(drawTool) !== 'clicks') return;
    /* The seal — and the wrapper's own dblclick is resetView, which must not fire under a finished path. */
    e.stopPropagation();
    e.preventDefault();
    /* a pattern is sealed by its own count, never by a double-click */
    if (!pathDraftRef.current || fixedPoints(drawTool) !== undefined) return;
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
      /* the screen-fixed text moves by the pointer's own travel on the pane */
      if (ed.orig.kind === 'anchoredtext') next = prim.moveAnchored(ed.orig, ed.start, p);
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
      if (p) drawingsRef.current?.setDraft({ ...pendingSecondRef.current, p2: constrained(pendingSecondRef.current.kind, pendingSecondRef.current.p1, p, e.shiftKey) });
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
    dragRef.current = { ...dragRef.current, p2: constrained(dragRef.current.kind, dragRef.current.p1, p, e.shiftKey) };
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
      if (editRef.current.moved) saveDrawings(drawKeyRef.current, shapesRef.current);
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

  const gapNotes = (() => {
    if (replay || quiet) return [] as string[];
    const lines: string[] = [];
    const push = (s: string) => {
      if (lines.length >= 4 || lines.includes(s)) return;
      lines.push(s);
    };
    const clock = !!altSpec;
    if (clock && (
      overlays.flow || overlays.netDrift || overlays.volDrift || overlays.session || overlays.cone || overlays.events
      || indicators.vwap || indicators.vwapBands || indicators.flowVwap || indicators.sideVwap || indicators.gammaEma || indicators.gammaVwap
    )) push('Book lines and VWAP need time bars');
    if (overlays.darkpool && printTape && prints.length === 0) {
      if (stockTape.index) push('Dark pool — an index has no stock prints');
      else if (stockTape.fault) push(`Dark pool — ${stockTape.fault}`);
      else if (!stockTape.ready) push('Dark pool — waiting on the prints');
      else if (stockTape.ready && !stockTape.marks.length && (stockTape.complete || stockTape.live)) push('Dark pool — no large off-exchange print or block yet');
    } else if (overlays.darkpool) {
      const spot = lastCloseRef.current && lastCloseRef.current > 0 ? lastCloseRef.current : levels.spot;
      const away = darkRows.length > 0 && darkNear(darkRows, spot).length === 0;
      if (prints.length === 0 && darkFeed.fault) push('Dark pool — the feed did not answer');
      else if (prints.length === 0 && !darkFeed.ready) push('Dark pool — waiting on the feed');
      else if (darkRows.length === 0) push('Dark pool — no prints on this name');
      else if (away) push('Dark pool — prints are away from this tape');
    }
    if (!clock && flowRows.length === 0 && (indicators.flowVwap || indicators.sideVwap)) {
      const why = !hostFlow && printTape && optionTape.fault ? optionTape.fault : !hostFlow && flowFeed.fault
        ? 'the feed did not answer'
        : !hostFlow && !(printTape ? optionTape.ready : flowFeed.ready)
          ? 'waiting on the feed'
          : 'no option prints on this name';
      push(`Flow VWAP — ${why}`);
    }
    /* The flow pane hides itself while it has nothing to draw; only a tape that did not answer is worth a line */
    if (!clock && paneFlowOn && paneFlowRows.length === 0 && paneFlowFeed.fault && (overlays.flow || overlays.netDrift)) push(`Flow — ${paneFlowFeed.fault}`);
    const mins = tfMinutes(timeframe);
    const drawn = barsFor(mins, altSpec);
    if (!clock && overlays.volDrift) {
      const rv = realizedVol(drawn, mins * 60);
      if (rv.length === 0) push('Vol drift — not enough bars yet');
      else if (impliedVolLine(nameIv(), rv).length === 0) push('Vol drift — implied vol is not in');
    }
    if (!clock && overlays.session && sessionLines(buildSessionLevels(baseBars(), sessionOr)).length === 0) {
      push('Session levels — not enough of this session');
    }
    if (!clock && overlays.wind && windWhy) push(windWhy);
    else if (!clock && overlays.wind && tfMinutes(timeframe) >= 1440) push('Wind — needs intraday bars');
    if (!clock && overlays.cone && !coneTerm(ticker)) push(coneMissed(ticker) ? 'Expected move — no implied vol on this name' : 'Expected move — waiting on implied vol');
    if (overlays.levels && ![levels.callWall, levels.putWall, levels.flip, levels.supreme].some(v => Number.isFinite(v) && v > 0)) {
      /* the book did not come back at all: that, not "not named yet" */
      push(bookStatus(ticker) === 'error' ? 'Book — the feed did not answer' : 'Key levels — the book has not named a wall yet');
    }
    if (overlays.alerts && !alerts.some(a => a.kind === 'price')) push('Alert lines — no price alert on this name');
    if (overlays.volume && drawn.length > 0 && drawn.every(b => !(b.volume > 0))) push('Volume — these bars have no share volume');
    if (!clock && drawn.length > 0) {
      const n = drawn.length;
      if (indicators.rsi && n < 14) push('RSI — needs 14 bars');
      if (indicators.macd && n < 26) push('MACD — needs 26 bars');
      if (indicators.atrPane && n < 14) push('ATR — needs 14 bars');
      if (indicators.bb && n < 20) push('Bollinger — needs 20 bars');
      if (indicators.sma && n < 200) push('SMA 200 — needs 200 bars');
      if (indicators.gammaEma || indicators.gammaVwap) {
        const gamma = alignGamma(drawn, (bookMinutes ?? []).map(m => ({ time: m.time, levels: [{ value: m.net }] })), mins * 60);
        if (!gammaMoves(gamma)) push('Gamma lines — the minute gamma has not moved');
      }
      if (indicators.effRatio && n < inputOf('effRatio', PHYS_INPUT.effRatio)) push(`Efficiency ratio — needs ${inputOf('effRatio', PHYS_INPUT.effRatio)} bars`);
      if (indicators.amihud && drawn.every(b => !(b.volume > 0))) push('Amihud — these bars have no share volume');
      if (indicators.harBand && volOutlook.state === 'offline') push('Vol half-life — live data is offline; the forecast comes back when the feed answers');
      else if (indicators.harBand && mins >= 1440) push('Vol half-life — draws on intraday bars');
      if (indicators.gammaRegime && !(bookMinutes ?? []).length) push('Gamma regime — waiting on the book’s minute gamma');
      if (indicators.volShock && !MARKET_NAMES.has(ticker.trim().toUpperCase()) && marketMinutes.bars.length === 0) push('Market vol shock — waiting on SPY’s minutes');
    }
    return lines;
  })();
  /* A note waits out a grace before it shows: three expiries of vols take a while, and a note that flashes up for
     the seconds a feed takes to land is noise over the tape. */
  const gapKey = gapNotes.join('\n');
  const gapSeenRef = useRef(new Map<string, number>());
  const [gapRipe, setGapRipe] = useState('');
  useEffect(() => {
    const seen = gapSeenRef.current;
    const lines = gapKey ? gapKey.split('\n') : [];
    const now = Date.now();
    for (const k of [...seen.keys()]) if (!lines.includes(k)) seen.delete(k);
    for (const l of lines) if (!seen.has(l)) seen.set(l, now);
    const ripen = () => setGapRipe(lines.filter(l => Date.now() - (seen.get(l) ?? Date.now()) >= GAP_GRACE_MS).join('\n'));
    ripen();
    const waits = lines.map(l => GAP_GRACE_MS - (now - (seen.get(l) ?? now))).filter(w => w > 0);
    if (!waits.length) return;
    const t = window.setTimeout(ripen, Math.min(...waits) + 30);
    return () => window.clearTimeout(t);
  }, [gapKey]);
  const shownGaps = gapRipe ? gapRipe.split('\n').filter(l => gapNotes.includes(l)) : [];
  const shownGapKey = shownGaps.join('\n');
  const onGapNotesRef = useRef(onGapNotes);
  onGapNotesRef.current = onGapNotes;
  useEffect(() => {
    onGapNotesRef.current?.(shownGapKey ? shownGapKey.split('\n') : []);
  }, [shownGapKey]);
  useEffect(() => () => onGapNotesRef.current?.([]), []);

  let exposureBand: ExposureProfileData | null = null;
  let exposureNote = '';
  if (overlays.dexStrike && !replay) {
    const snap = snapshotFor(ticker, 'ALL');
    const chain = snap?.uwChains?.ALL?.length ? snap.uwChains.ALL : snap?.chain ?? [];
    if (snap?.liveBook && chain.length) {
      const profile = buildExposureProfile(snap, 'ALL', 15);
      if (profile.strikes.length) exposureBand = profile;
    }
    if (!exposureBand) {
      const status = peekEntry(ticker)?.status;
      exposureNote = status === 'error'
        ? 'Exposure by strike — the book did not answer'
        : status === 'loading' || status == null
          ? 'Exposure by strike — the book is still loading'
          : 'Exposure by strike — the book is not in yet';
    }
  }
  const builtinOn = INDICATOR_ITEMS.filter(item => indicators[item.key]);
  /* The physics reads' context lines: the band's width and the shock half-life, the regime and the flip, the shock's
     source — each from the same reads the series draw, with the honest word when the read is not in */
  const physicsExtras: Partial<Record<keyof ChartIndicators, string>> = {};
  if (indicators.harBand) {
    const o = volOutlook;
    const liveDay = nyIsoDate(Date.now());
    const k = inputOf('harBand', PHYS_INPUT.harBand);
    if (o.state === 'offline') physicsExtras.harBand = 'live data is offline';
    else if (o.state === 'thin') physicsExtras.harBand = 'not enough history to fit';
    else if (!o.origin) physicsExtras.harBand = 'fitting the forecast…';
    else {
      const half = Number.isFinite(o.halfLife) ? ` · shocks halve in ~${o.halfLife.toFixed(1)} sessions` : '';
      const left = sessionCloseMinOn(liveDay) - nyMinutes(Date.now());
      const rest = o.target === liveDay && left > 0 ? restOfDaySigma(o.forecast, left, sessionLengthOn(liveDay)) : NaN;
      const hr = o.target === liveDay ? hourReadNow(ticker, harMinutes.bars) : null;
      const hourPct = hr ? hourOfAnnual(hr.forecast) * 100 * k : NaN;
      physicsExtras.harBand = Number.isFinite(rest)
        ? `±${(rest * 100 * k).toFixed(2)}% rest of day${Number.isFinite(hourPct) ? ` · ±${hourPct.toFixed(2)}% next hour` : ''}${half}`
        : `forecast for ${o.target}: ${(o.forecast * 100).toFixed(1)}% a year${half}`;
    }
  }
  if (indicators.gammaRegime) {
    const last = bookMinutes?.length ? bookMinutes[bookMinutes.length - 1] : null;
    if (!last || !Number.isFinite(last.net) || last.net === 0) physicsExtras.gammaRegime = 'waiting on the book’s minute gamma';
    else {
      const d = flipDistancePct(last.spot ?? NaN, levels.flip);
      physicsExtras.gammaRegime = `${regimeWords(last.net > 0 ? 1 : -1)}${d == null ? '' : ` · flip ${Math.abs(d).toFixed(2)}% ${d >= 0 ? 'below' : 'above'}`}`;
    }
  }
  if (indicators.volShock) {
    physicsExtras.volShock = MARKET_NAMES.has(ticker.trim().toUpperCase())
      ? 'off on the market itself'
      : marketMinutes.bars.length === 0
        ? 'waiting on SPY’s minutes'
        : `SPY 15m vs 390m vol · flags at ×${inputOf('volShock', PHYS_INPUT.volShock).toFixed(1)}`;
  }
  if (indicators.amihud) physicsExtras.amihud = 'bps per $1M · display only';
  Object.assign(physicsExtras, tvSpecialExtras);
  const physicsIdle: Partial<Record<keyof ChartIndicators, string>> = {};
  if (indicators.volShock && MARKET_NAMES.has(ticker.trim().toUpperCase())) physicsIdle.volShock = 'off on the market itself';
  if (altSpec) for (const k of ['harBand', 'gammaRegime', 'volShock'] as const) if (indicators[k]) physicsIdle[k] = 'needs time bars';
  const legendTop = (chromeInset > 0 ? chromeInset + 4 : 8) + (paneScripts.length > 0 ? paneScripts.length * 23 : 0);

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
            if (prev && prev.up1 === coneHit.up1 && prev.dn1 === coneHit.dn1 && prev.minutes === coneHit.minutes && prev.band === coneHit.band && prev.horizon === coneHit.horizon) return prev;
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
        {(sessionGap || sessionNote) && !replay && !quiet && (
          <p className="absolute left-1/2 z-[4] -translate-x-1/2 max-w-[420px] truncate rounded-md border border-borderSubtle bg-canvas/85 px-2 py-1 font-mono text-t10 text-textSecondary pointer-events-none" style={{ top: chromeInset > 0 ? chromeInset + 6 : 8 }} data-session-note>
            {noteWords(sessionNote) || sessionGap}
          </p>
        )}
        {quiet && !replay && (
          <div className="absolute inset-0 z-[4] flex items-center justify-center pointer-events-none" data-chart-empty>
            <div className="max-w-[280px] rounded-md border border-borderSubtle bg-canvas/85 px-4 py-3 text-center">
              <p className="font-mono text-t11 text-textPrimary">{signedOut ? 'Sign in to load prices' : noteWords(tape?.note || sessionNote) || 'No bars for this name'}</p>
              <p className="mt-1 font-mono text-t10 text-textMuted">{signedOut ? 'Prices load for a signed-in session.' : quote ? `Quote ${quote.bid.toFixed(2)} × ${quote.ask.toFixed(2)}${quote.current ? '' : `, ${asOfText(quote.at)}`}. No prints on this name${quote.current ? '' : ' this session'}.` : tape?.note && !/offline|login failed/i.test(tape.note) ? `${etWindow(session)}.` : 'This frame stays. Bars fill it when the tape answers.'}</p>
            </div>
          </div>
        )}
        {/* Still reading: a skeleton of bars and a word, never a blank pane */}
        {!quiet && !barsIn && !replay && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 pointer-events-none" data-chart-loading>
            <div aria-hidden className="flex h-16 items-end gap-[3px] opacity-40">
              {[38, 52, 44, 61, 57, 70, 64, 48, 55, 66, 73, 60].map((h, i) => (
                <span key={i} className="w-[5px] rounded-[1px] bg-ink/30 animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
            <p className="font-mono text-t10 text-textMuted">{signedOut ? 'Sign in to load prices' : 'Loading bars…'}</p>
          </div>
        )}
        {/* The host's layer (Review's position, target and stop) — over the plot, under the chrome */}
        {layer?.({ chart: () => chartRef.current, series: () => candleSeriesRef.current as ISeriesApi<SeriesType> | null, host: () => containerRef.current, room: layerRoom, reset: resetView })}
        {/* The way home — pill, right-click card, Alt+R */}
        {/* …and above a host's own chrome at the foot */}
        <ResetViewControl onReset={resetView} pillClass={footInset > 0 ? 'right-16 bottom-20' : undefined} />
        {/* The scripts on this pane, named at the top left with hide and remove */}
        {paneId && paneScripts.length > 0 && !replay && <ScriptLegend paneId={paneId} scripts={paneScripts} chart={getChart} runOf={id => scriptRunsRef.current.get(id)} tick={`${revision}|${scriptRunsRev}`} />}
        {builtinOn.length > 0 && !replay && (
          <IndicatorLegend
            on={builtinOn.map(i => i.key)}
            top={legendTop}
            mins={tfMinutes(timeframe)}
            chart={getChart}
            seriesOf={getIndicatorSeries}
            tick={`${revision}|${looksRev}|${bookMinutes?.length ?? 0}|${harMinutes.bars.length}|${marketMinutes.bars.length}`}
            extras={physicsExtras}
            idle={physicsIdle}
            narrow={compact || (widthRef.current || 1200) < 520}
            onRemove={onIndicators ? key => onIndicators({ ...indicators, [key]: false }) : undefined}
            paneKey={paneId ?? ticker}
            left={railGutter}
          />
        )}
        {/* What is not in yet: one small chip in the plot's top-right corner, clear of the candles' left edge and the
            legends — the full lines on hover. A host with its own corner row takes them instead (onGapNotes). */}
        {!onGapNotes && shownGaps.length > 0 && !replay && !quiet && (
          <div
            className="absolute z-[4] flex max-w-[min(260px,45%)] pointer-events-auto"
            style={{ top: chromeInset > 0 ? chromeInset + 6 : 8, right: PRICE_SCALE_MIN_WIDTH + 8 }}
            title={shownGaps.join('\n')}
            data-indicator-gaps
          >
            <GapChip lines={shownGaps} />
          </div>
        )}
        {/* Every band says its own name, the way the reference does. An unlabelled strip under a chart is a puzzle;
            `pointer-events-none` so the tape still pans straight through them. */}
        {paneLabels.map(l => {
          const text = PANE_LABEL_LOOK[l.key];
          if (!text) return null;
          if (l.key === 'flow' || l.key === 'netDrift') {
            /* The flow pane's caption is its filters, each a chip that steps to its next setting — short words on a narrow
               pane, and clear of the drawing rail down the left */
            const capNarrow = (widthRef.current || containerRef.current?.clientWidth || 1200) < 640;
            const railLeft = !hostRail && !compact && (drawing || !!onEnterDraw) && rail.dock === 'left';
            const step =(key: keyof FlowFilters) => {
              const chip = FLOW_CHIPS.find(c => c.key === key);
              if (!chip) return;
              const at = chip.options.findIndex(o => o.value === flowFilters[key]);
              const next = chip.options[(at + 1) % chip.options.length].value;
              setDeskPrefs({ flowFilters: { [key]: next } as Partial<FlowFilters> });
            };
            return (
              <div
                key={l.key}
                className={`absolute flex items-center gap-x-1 whitespace-nowrap font-mono text-t9 uppercase tracking-wider text-textMuted ${capNarrow ? "z-20 overflow-visible" : "z-10 overflow-hidden"}`}
                style={{ top: l.top - 3, left: railLeft ? 40 : 8, right: PRICE_SCALE_MIN_WIDTH + 8 }}
                title={flowCaption(flowFilters)}
                data-flow-caption={l.key}
              >
                <span className="text-textSecondary font-semibold">{l.key === 'flow' ? 'Flow' : 'Net drift'}</span>
                {l.key === 'flow' && flowSum && (
                  <span className={`mr-0.5 tnum normal-case tracking-normal ${flowSum.net >= 0 ? 'text-bull' : 'text-bear'}`} title={`The newest session's net premium under these filters, ${flowSum.prints} prints`}>
                    {signedDollars(flowSum.net)}
                  </span>
                )}
                {/* a small pane (a 3- or 4-pane desk, the phone) folds the six chips into one door */}
                {capNarrow && l.key === 'flow' && <FlowFilterDoor filters={flowFilters} legsIn={legsIn} onStep={step} />}
                {!(capNarrow && l.key === 'flow') && FLOW_CHIPS.map(c => {
                  /* the Spread legs type counts its legs whatever the Legs chip holds: the chip says so */
                  const opt = c.key === 'leg' && legsIn ? (c.options.find(o => o.value === 'all') ?? c.options[0]) : (c.options.find(o => o.value === flowFilters[c.key]) ?? c.options[0]);
                  const narrowed = opt.value !== 'all';
                  return (
                    <Fragment key={c.key}>
                      {!capNarrow && <span aria-hidden className="opacity-50">·</span>}
                      <button
                        type="button"
                        onClick={() => step(c.key)}
                        title={`${c.hint} — click for ${c.options[(c.options.indexOf(opt) + 1) % c.options.length].label}`}
                        className={`pointer-events-auto rounded-[3px] px-1 py-px transition-colors hover:bg-ink/[0.08] hover:text-textPrimary ${narrowed ? 'text-textSecondary bg-ink/[0.05]' : 'text-textMuted'}`}
                        data-flow-chip={c.key}
                      >
                        {capNarrow ? opt.short : opt.label}
                      </button>
                    </Fragment>
                  );
                })}
                {paneFlowFeed.filling && <span className="ml-1 normal-case tracking-normal text-textMuted">reading back…</span>}
              </div>
            );
          }
          /* clear of the drawing rail docked down the left, and, in a short bottom pane, of the chart library's corner
             mark (its bottom-left logo, ~36 px wide) */
          const titleLeft = (railGutter ?? 8) + (l.last && (l.h ?? 0) < 72 ? 44 : 0);
          return (
            <span
              key={l.key}
              aria-hidden
              className="pointer-events-none absolute z-10 font-mono text-t9 uppercase tracking-wider text-textMuted whitespace-nowrap"
              style={{ top: l.top, left: titleLeft }}
            >
              {text}
            </span>
          );
        })}


        {/* The pane's own fired chip left on: the shell shows one chip for a firing wherever the reader is
            (components/alerts/AlertToasts.tsx), so a chart of the name no longer says it twice. */}

        {/* Pinned to the container's right edge and moved down it by transform, so it rides the price scale rather
            than being re-laid out. */}
        {/* THE RECORD'S EDGE (the partner tree's 260a099): where the candles run out, a glass card at the plot's left — the
            mark adrift in it (index.css edge-drift), the word that this is as far back as the bars go, and on the feed's
            tapes a coarser timeframe as the way further. Only the × takes the pointer; the plot under the card still pans. */}
        {edge && edgeGone !== edge && (() => {
          const [name, tf, how] = edge.split('|');
          const daily = tfMinutes(tf as Timeframe) >= 1440;
          return (
            <div
              className="pointer-events-none absolute left-3 top-[34%] z-10 w-[252px] max-w-[calc(100%-24px)] rounded-xl border border-ink/[0.08] bg-panel/[0.92] backdrop-blur-[6px] shadow-xl shadow-black/30 p-3 pr-8 animate-fade-in"
              role="note"
              data-record-edge={how}
            >
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setEdgeGone(edge)}
                className="pointer-events-auto absolute top-2 right-2 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
                data-record-edge-close
              >
                <XIcon className="w-3 h-3" />
              </button>
              <div className="flex items-start gap-3">
                <span className="edge-mark shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.05]" aria-hidden>
                  <SlayerMark size={22} bare label="" />
                </span>
                <div className="min-w-0">
                  <div className="text-t13 font-semibold leading-4 text-textPrimary">The record starts here</div>
                  <p className="mt-1 text-[11.5px] leading-4 text-textSecondary">
                    {how === 'tape'
                      ? `This is as far back as the tape goes for ${name} at ${tf}. ${daily ? 'Every day on record for this name is drawn.' : 'A coarser timeframe reaches further.'}`
                      : `This is as far back as the bars on this page go for ${name} at ${tf}.`}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
        {priceTag && !replay && (
          <div
            ref={priceTagRef}
            aria-hidden
            /* The card wears the chart's ground, like its words. */
            /* The card is the library's label size: the price, then the candle's time. */
            /* THE FOIL PRICE TAG (the partner tree's 260a099, ported 2026-11-01): the brand's foil pans under the figure
               (.sig-foil on the mark's keyframes), the figure in the panel's ink so it reads on the silver */
            className="price-foil pointer-events-none absolute top-0 right-0 z-10 will-change-transform overflow-hidden rounded-[3px] pl-[8px] pr-0.5 py-px text-left whitespace-nowrap opacity-0 shadow-sm shadow-black/40"
            data-price-tag
          >
            <span className="sig-foil" aria-hidden />
            <div className="relative font-mono text-t12 font-bold leading-[14px] tnum" data-price-figure />
            {/* the candle's clock, under the figure */}
            <div className="relative font-mono text-t9 leading-[11px] tnum" data-price-left />
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
        {!hostRail && !compact && (drawing || onEnterDraw) && !rail.open && (
          /* The way back — a slim tab at the docked edge, always there, so a hidden toolbar is one click from found
             (TV's collapse grammar). */
          <button
            onClick={() => (smallPane && railPrefs.open ? setRailPeek(true) : setRailPrefs({ open: true }))}
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
        {!hostRail && !compact && (drawing || onEnterDraw) && rail.open && (
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
            {/* magnet, stay in drawing mode, lock all, hide all — TradingView's switches under the tools */}
            <DrawRailSwitches
              dock={rail.dock}
              allLocked={allLocked}
              onLockAll={lockAll}
              treeOpen={treeOpen}
              onTree={() => setTreeOpen(o => !o)}
              onUndo={undoHistory}
              onRedo={redoHistory}
              canUndo={canUndo(drawKey)}
              canRedo={canRedo(drawKey)}
            />
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
              onClick={() => (smallPane && railPeek ? setRailPeek(false) : setRailPrefs({ open: false }))}
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
        {!hostRail && compact && (drawing || onEnterDraw) && (
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
        {!hostRail && sheetOpen && boxEl && (
          <DrawSheet
            host={boxEl}
            dock={rail.dock}
            drawTool={drawing ? drawTool : 'select'}
            onPick={pickTool}
            onClose={() => setSheetOpen(false)}
            onTree={() => {
              setSheetOpen(false);
              setTreeOpen(true);
            }}
          />
        )}
        {treeOpen && (drawing || !!onEnterDraw) && (
          <DrawObjectTree
            drawings={shapesRef.current}
            selected={selectedIdx}
            onSelect={treeSelect}
            onPatch={treePatch}
            onDelete={treeDelete}
            onMove={treeMove}
            onClose={() => setTreeOpen(false)}
            narrow={compact || (boxW > 0 && boxW < 560)}
          />
        )}
        {!compact && onEnterDraw && <DrawFavBar drawTool={drawing ? drawTool : 'select'} onPick={pickTool} />}
        {drawing && settingsOpen && selectedIdx !== null && shapesRef.current[selectedIdx] && drawingsRef.current && (
          <DrawSettings
            mark={shapesRef.current[selectedIdx]}
            timeframe={timeframe}
            prim={drawingsRef.current}
            onChange={updateSelected}
            onClose={() => setSettingsOpen(false)}
          />
        )}
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

              <button onClick={() => setSettingsOpen(o => !o)} title="Settings — style, text, coordinates, visibility" aria-label="Drawing settings" aria-pressed={settingsOpen} className={btn(settingsOpen)} data-mark-settings>
                <Settings2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={cloneSelected} title="Clone — the same mark, three bars on" aria-label="Clone" className={btn(false)} data-mark-clone>
                <Copy className="w-3.5 h-3.5" />
              </button>
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
              hostRail ? 'left-2 top-1/2 -translate-y-1/2' : rail.dock === 'left' || !rail.open ? 'left-[54px] top-1/2 -translate-y-1/2' : 'top-11 left-[calc(50%-48px)] -translate-x-1/2'
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
            const oiBook = levelCard.key === 'callWall' || levelCard.key === 'putWall' || levelCard.key === 'flip' || levelCard.key === 'supreme';
            return (
              <PointerFollowCard start={{ x: levelCard.x, y: levelCard.y }} width={204} testId="data-key-level-card" testValue={levelCard.key} title={w.name} aside={aside}>
                <CardRow k="Price" v={levelCard.price.toFixed(2)} ink={ink} />
                {dist != null && <CardRow k="From spot" v={`${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}%`} sub={dist >= 0 ? 'above' : 'below'} />}
                {oiBook && <span className="col-span-2 text-textSecondary leading-snug">Open interest.</span>}
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
            /* the cell is the book's level at this strike, carried across the session — not the change across the bar */
            const greekWord = `${trailsGreek === 'gex' ? 'Gamma' : trailsGreek === 'dex' ? 'Delta' : 'Vega $'} · ${BOOK_MODE_WORDS[fieldMode].label}`;
            /* The side as the figure's sub, what it does as a line of its own — on the value's line the words ran
               past the card's edge and dragged every figure with them */
            const side = b.value >= 0 ? 'positive' : 'negative';
            const markWord = b.mark === 'born' ? 'Born' : b.mark === 'grew' ? 'Grew' : b.mark === 'flipped' ? 'Flipped' : b.mark === 'died' ? 'Died' : null;
            const tagWord = b.tag === 'absorbed' ? 'Held' : b.tag === 'rejected' ? 'Off' : b.tag === 'broke' ? 'Broke' : null;
            const ink = b.value >= 0 ? BEAD_INK_CSS.put : BEAD_INK_CSS.call;
            const since = b.open == null ? null : b.value - b.open;
            const rank = tr ? tr.rankAt(b.ci, b.strike) : null;
            const bars = replayDataRef.current?.bars ?? baseBars() ?? [];
            let bi = bars.length - 1;
            while (bi > 0 && bars[bi].time > b.time) bi--;
            const closeThen = bi >= 0 && bars[bi] && bars[bi].time <= b.time ? bars[bi].close : null;
            const dist = closeThen != null && closeThen > 0 ? ((b.strike - closeThen) / closeThen) * 100 : null;
            const rows = (
              <>
                <CardRow k={greekWord} v={fmtUsd(b.value)} ink={ink} sub={side} />
                <CardRow k="Of book" v={`${(b.share * 100).toFixed(1)}%`} />
                {dist != null && <CardRow k="From price" v={`${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}%`} sub={closeThen!.toFixed(2)} />}
                {since != null && since !== 0 && <CardRow k="Since open" v={`${since >= 0 ? '+' : '−'}${fmtUsd(Math.abs(since))}`} />}
                {rank && <CardRow k="Rank" v={`${rank.rank} of ${rank.of}`} />}
                {markWord && <CardRow k="Node" v={markWord} />}
                {tagWord && <CardRow k="Price" v={tagWord} />}
                <span className="col-span-2 text-textMuted">{b.value >= 0 ? 'Holds a move back' : 'Pushes a move on'}</span>
                {/* recorded live, or rebuilt from that day's open interest and quotes (data/book/exposureHist.ts) */}
                {fieldSourceWords(ticker, b.time * 1000) && <span className="col-span-2 text-textMuted leading-snug">{fieldSourceWords(ticker, b.time * 1000)}</span>}
              </>
            );
            const foot = <span className="text-textMuted">{kept ? letGoWords() : 'click to keep'}</span>;
            const title = fmtStrike(b.strike);
            const aside = `${nyClock(b.time * 1000)}`;
            return kept ? (
              <PointerCard x={pinnedBead!.x} y={pinnedBead!.y} width={188} dense still testId="data-bead-card" testValue={`${b.strike}`} title={title} aside={aside} foot={foot}>
                {rows}
              </PointerCard>
            ) : (
              <PointerFollowCard start={pointerAtRef.current} width={188} dense testId="data-bead-card" testValue={`${b.strike}`} title={title} aside={aside} foot={foot}>
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
            <CardRow k="Left" v={coneLeft(coneCard.minutes)} />
            {coneCard.source && <span className="col-span-2 mt-0.5 text-textMuted leading-snug">{coneCard.source}</span>}
          </PointerFollowCard>
        )}</CellView>
        )}</CellView>

        {/* The hover card — floats above the lane at the marker's x, flipping to the left of it near the right edge. */}
        <CellView cell={eventCell}>{eventCard => eventCard && (
          <div
            className="absolute bottom-9 z-30 pointer-events-none overflow-hidden border border-borderMuted bg-panel/95 rounded px-2 py-1.5 shadow-xl shadow-black/50 max-w-[260px]"
            style={
              eventCard.x > (containerRef.current?.clientWidth ?? 400) - 270
                ? { right: Math.max(4, (containerRef.current?.clientWidth ?? 400) - eventCard.x + 6) }
                : { left: Math.max(4, eventCard.x + 6) }
            }
          >
            <div className="max-w-full truncate font-mono text-t10 font-semibold uppercase tracking-wider text-textPrimary">
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
      {overlays.dexStrike && !replay && (
        exposureBand ? (
          <StrikeExposureBand
            data={exposureBand}
            metric={bandMetric}
            onMetric={setBandMetric}
            onClose={onOverlays ? () => onOverlays({ ...overlays, dexStrike: false }) : undefined}
          />
        ) : (
          <p className="shrink-0 border-t border-borderSubtle px-2 py-1 font-mono text-t10 text-textSecondary" data-dex-note>{exposureNote}</p>
        )
      )}
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
