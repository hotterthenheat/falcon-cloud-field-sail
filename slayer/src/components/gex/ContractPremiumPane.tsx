/* The desk chart's contract lens, on lightweight-charts like the house chart. Premium is monotonic in spot (up for calls,
   down for puts), so pricing the contract at a bar's O, H, L and C gives that bar's true premium high and low. */

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
  type Logical,
} from 'lightweight-charts';
import { liveBars } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { aggregateCandles, tfMinutes, type Timeframe } from '../../data/timeframe';
import { candleSeriesOptions, chartGround, chartSurface, getCandleTheme, useCandleThemeKey } from './candleTheme';
import { fmtPx, pxSeriesFormat } from '../../core/format';
import { useResolvedTheme } from '../../theme/theme';
import { LOCAL_TIME, fmtClockLocal, fmtDayLocal, localTickMarks } from './chartTime';
import type { OptionRight } from '../../types/compass';
import type { Candle } from '../../types/market';
import { SetupMarksPrimitive, type SetupMarks } from '../compass/setupMarksPrimitive';
import ResetViewControl from './ResetViewControl';

/** A neighboring strike, drawn as Terrain draws a node: a bead on each bar at that strike's premium. Height is its share of the gamma. Ice is a call, gold is a put, silver is this strike. */
interface PremiumNode {
  premium: number;
  /** Share of the window's gamma, 0–1. */
  share: number;
  here: boolean;
  call: boolean;
}

const CALL_BEAD = 'rgb(214, 237, 248)';
const PUT_BEAD = 'rgb(245, 197, 66)';
const HERE_BEAD = 'rgb(210, 210, 214)';

class PremiumNodesPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  nodes: PremiumNode[] = [];
  /** CSS px the page's chrome covers at the top — the column starts under it. */
  insetTop = 48;
  private readonly pane = new NodesPane(this);
  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }
  updateAllViews(): void {}
  paneViews() {
    return [this.pane];
  }
  setNodes(nodes: PremiumNode[], insetTop?: number): void {
    this.nodes = nodes;
    if (insetTop != null) this.insetTop = insetTop;
    this.requestUpdate?.();
  }
}

class NodesPane {
  constructor(private readonly source: PremiumNodesPrimitive) {}
  zOrder(): 'top' {
    return 'top';
  }
  renderer() {
    return {
      draw: (target: { useBitmapCoordinateSpace: (cb: (s: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number; mediaSize: { width: number; height: number } }) => void) => void }) => {
        const { chart, series, nodes, insetTop } = this.source;
        if (!chart || !series || nodes.length === 0) return;
        target.useBitmapCoordinateSpace(scope => {
          const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize } = scope;
          const ts = chart.timeScale();
          const range = ts.getVisibleLogicalRange();
          if (!range) return;
          const lastBar = Math.max(0, series.data().length - 1);
          const from = Math.max(0, Math.floor(range.from));
          const to = Math.min(lastBar, Math.ceil(range.to));
          if (to < from) return;
          const spacing = ts.options().barSpacing ?? 6;
          /* A slot under ~3px is skipped, the same budget Terrain uses, so a
             zoomed-out tape stays a field of beads and not a smear. */
          const stride = Math.max(1, Math.ceil(3 / Math.max(0.5, spacing)));
          const rx = Math.max(0.7, Math.min(spacing * 0.34, 4.5)) * hr;
          const maxShare = nodes.reduce((m, n) => (n.share > m ? n.share : m), 0.001);
          const top = (insetTop + 4) * vr;
          const bot = mediaSize.height * vr - 6 * vr;
          /* Stop short of the ladder. The entry chip and the target figures own the right edge. */
          const right = mediaSize.width * hr - 96 * hr;
          ctx.save();
          const paint = (node: PremiumNode) => {
            const yMedia = series.priceToCoordinate(node.premium);
            if (yMedia == null) return;
            const y = yMedia * vr;
            if (y < top || y > bot) return;
            const t = Math.min(1, node.share / maxShare);
            const s = Math.pow(Math.max(node.here ? 0.35 : 0, t), 1.6);
            /* Hairline for a light strike, a short swell for the heavy one.
               The field steps back; this strike stays silver and readable. */
            const ry = (0.45 + s * Math.min(spacing * 0.42, 3.4)) * vr;
            ctx.globalAlpha = node.here ? 0.95 : 0.38 + s * 0.5;
            ctx.fillStyle = node.here ? HERE_BEAD : node.call ? CALL_BEAD : PUT_BEAD;
            for (let i = from; i <= to; i += stride) {
              const xMedia = ts.logicalToCoordinate(i as never);
              if (xMedia == null) continue;
              const x = xMedia * hr;
              if (x < -rx || x > right) continue;
              ctx.fillRect(x - rx, y - ry, rx * 2, Math.max(vr, ry * 2));
            }
          };
          for (const node of nodes) if (!node.here) paint(node);
          for (const node of nodes) if (node.here) paint(node);
          ctx.restore();
        });
      },
    };
  }
}

/** A labeled rule on the premium tape — a TP, the stop, the reference. */
interface PremiumLevel {
  price: number;
  label: string;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
  /** The price scale keeps the name. The line across the tape is not drawn. */
  axisOnly?: boolean;
}

/** A modeled projection drawn past NOW — theta held flat, spot at the stop. */
interface PremiumProjection {
  key: string;
  color: string;
  dashed?: boolean;
  points: { time: number; value: number }[];
}

interface ContractPremiumPaneProps {
  ticker: string;
  strike: number;
  right: OptionRight;
  /** Years to expiry, fixed at selection — the curve shows the session, not decay */
  tYears: number;
  /** When set, this prices the tape instead of the desk's estimator. */
  priceAt?: (spot: number) => number;
  timeframe: Timeframe;
  revision: number;
  /** The pricing vol for the modelled tape. Omitted, nothing is modelled. The campaign passes the setup's own iv so
      the tape and its level lines speak one model. */
  iv?: number;
  /** Labelled rules pinned to premiums: targets, the stop, the reference. */
  levels?: PremiumLevel[];
  /** Modeled futures drawn past the last bar. */
  projections?: PremiumProjection[];
  /** Fraction of the pane the plot leaves clear at the TOP — callers with
      floating chrome over the tape pass their measured chrome height so no
      candle or level label ever runs under it. Default = the engine's 0.2. */
  topMargin?: number;
  /** Draw the level list as price lines. Off when the caller paints the stock ladder instead. */
  rules?: boolean;
  /** The stock chart's ladder — entry, targets, floor — in premium, not price lines. */
  marks?: SetupMarks | null;
  /** Neighboring strikes as small beads. Not on the premium scale — a column, high strike at the top. */
  nodes?: PremiumNode[];
  /** CSS px of chrome covering the top of the pane. The bead column starts under it. */
  beadInset?: number;
  /** The tape to reprice: the setup page passes the bars its card's premium came from; omitted, the live book (the Weigher).
      A book at another price floors a cheap strike to a flat line. */
  bars?: Candle[] | null;
  /** Line the last bar up with this spot before pricing, so the right edge is the printed premium. */
  spot?: number;
  /** Premiums the scale must include while following the tape (entry, targets, floor), or a target above the session docks as a tick. */
  framePrices?: number[];
  /** The wheel belongs to the page over a docked pane (as StrikeChart's `pageScroll`): no zoom or pan; off in fullscreen. */
  pageScroll?: boolean;
  /** One contract, not a book to tour: the time window stops at the first and last bar, the price window holds the entry,
      stop and targets, and the axis shows the day with the clock. */
  bound?: boolean;
  /** The bar under the crosshair, or the last bar when the pointer leaves. The line above the tape. */
  onBar?: (bar: { open: number; high: number; low: number; close: number } | null) => void;
  /** A second pane on the same time scale: the underlying. Option prices stay on the top pane. */
  stockPane?: boolean;
  /** Stock prices that are modeled scenarios, drawn only on the stock pane. */
  scenarios?: { price: number; title: string }[];
  /** The contract's own prints, already priced. When passed (null while loading) the stock path is not repriced;
      null keeps the last draw, an empty list clears it. `volume` is the contracts in the bar, drawn under the tape. */
  traded?: { time: number; open: number; high: number; low: number; close: number; volume?: number }[] | null;
  /** The rows are already this timeframe. Folding them again pulls a daily bar onto the wrong day. */
  tradedAsIs?: boolean;
  /** A faint grid, so a price can be read off the tape and not only off a label. */
  grid?: boolean;
}

const LEVEL_STYLE: Record<NonNullable<PremiumLevel['style']>, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.SparseDotted,
};

/** Terrain's opening pitch: intraday bars at 8–11px, so a body is readable and the wheel zooms out from there. */
function tapePitch(tf: Timeframe): number {
  const m = tfMinutes(tf);
  if (m <= 5) return 8;
  if (m <= 15) return 9;
  if (m <= 45) return 10;
  if (m <= 60) return 11;
  if (m <= 240) return 12;
  if (m < 1440) return 13;
  if (m <= 1440) return 14;
  if (m <= 7 * 1440) return 16;
  return 18;
}

/** The same window Terrain opens on: most of the width is history, a little air sits ahead of the last bar. */
function fitWindow(len: number, width: number, tf: Timeframe): { from: number; to: number } {
  const pitch = tapePitch(tf);
  const total = Math.max(90, Math.min(700, Math.round((width || 640) / pitch)));
  const span = Math.max(48, Math.min(total, Math.ceil(Math.max(len, 1) / 0.82)));
  const history = Math.round(span * 0.82);
  const ahead = Math.max(3, span - history);
  return { from: Math.max(0, len - history), to: len + ahead };
}

const ContractPremiumPane = ({ ticker, strike, right, tYears, priceAt, timeframe, revision, iv: ivProp, levels, projections, topMargin, rules = true, marks = null, nodes = [], beadInset = 48, bars: barsProp = null, spot = 0, framePrices = [], pageScroll = false, bound = false, onBar, stockPane = false, scenarios = [], traded, tradedAsIs = false, grid = false }: ContractPremiumPaneProps) => {
  const bookRev = useBookRev();
  const pageScrollRef = useRef(pageScroll);
  pageScrollRef.current = pageScroll;
  const boundRef = useRef(bound);
  boundRef.current = bound;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const stockSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const stockLinesRef = useRef<IPriceLine[]>([]);
  const stockPtsRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }[]>([]);
  const stockPaneRef = useRef(stockPane);
  stockPaneRef.current = stockPane;
  const stockFrameRef = useRef<number[]>([]);
  stockFrameRef.current = scenarios.map(s => s.price);
  const loadedRef = useRef('');
  /* The setup tape is years of bars. Autoscale was fitting ALL of them, so the
     last session — a few cents — sat as a hairline. Follow the visible window
     until the reader takes the scale. */
  const followRef = useRef(true);
  const frameRef = useRef<number[]>([]);
  frameRef.current = framePrices;
  const frameKeyRef = useRef('');
  const ptsRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }[]>([]);
  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;
  const hoverRef = useRef(false);
  const clampTimeRef = useRef<() => void>(() => {});
  /* A drag or a wheel owns the frame until Reset. The tape reprices every
     tick; setData rebuilds the time scale and would yank that frame back. */
  const holdRef = useRef(false);
  const linesRef = useRef<IPriceLine[]>([]);
  const marksRef = useRef<SetupMarksPrimitive | null>(null);
  const nodesRef = useRef<PremiumNodesPrimitive | null>(null);
  /* Undocked levels count in the autoscale range so an on-plot rule lands on the plot, not under the chrome;
     the caller's docking still caps how far a wild target stretches the scale. */
  const levelPricesRef = useRef<number[]>([]);
  const projSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const projRangeRef = useRef('');
  const barCountRef = useRef(0);
  const themeKey = useCandleThemeKey();
  const appTheme = useResolvedTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const t = getCandleTheme();
    const s0 = chartSurface(t);
    const silverRaw = getComputedStyle(host).getPropertyValue('--silver').trim();
    const silver = silverRaw ? `rgb(${silverRaw})` : 'rgb(199, 211, 232)';
    const fullClock = boundRef.current;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: s0.bg },
        textColor: s0.text,
        fontFamily: "'Inter', sans-serif",
        fontSize: 10,
        attributionLogo: false,
      },
      // The reader's clock, not Greenwich's — see chartTime.ts.
      localization: LOCAL_TIME,
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: s0.line },
      timeScale: {
        borderColor: s0.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: fullClock ? 6 : 8,
        barSpacing: 8,
        minBarSpacing: 0.5,
        /* A day tick that is only "25" is not a time. On this tape the day carries its month, and a clock tick carries the day. */
        tickMarkMaxCharacterLength: fullClock ? 16 : 8,
        tickMarkFormatter: fullClock
          ? (time: Time, type: TickMarkType, locale: string) => {
              if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) return `${fmtDayLocal(time)} ${fmtClockLocal(time)}`;
              if (type === TickMarkType.DayOfMonth) return fmtDayLocal(time);
              return localTickMarks(time, type, locale);
            }
          : localTickMarks,
      },
      crosshair: {
        vertLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
        horzLine: { color: s0.crosshair, labelBackgroundColor: s0.label },
      },
      handleScroll: { mouseWheel: !pageScrollRef.current, pressedMouseMove: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      ...candleSeriesOptions(t),
      priceLineVisible: true,
      priceLineColor: fullClock ? silver : 'rgba(237,237,237,0.4)',
      priceFormat: {
        type: 'custom',
        minMove: 0.01,
        formatter: (price: number) => fmtPx(price),
      },
      autoscaleInfoProvider: (): AutoscaleInfo | null => {
        /* The candles set the scale. A stop or a target far from the tape stays a
           label on the rail; folding it into the range crushed the session into a line. */
        const pts = ptsRef.current;
        let minValue = Infinity;
        let maxValue = -Infinity;
        for (const p of pts) {
          if (p.high > maxValue) maxValue = p.high;
          if (p.low > 0 && p.low < minValue) minValue = p.low;
        }
        if (!(maxValue > minValue) || !Number.isFinite(minValue)) return null;
        if (minValue < maxValue * 0.25) minValue = maxValue * 0.55;
        const span = Math.max(0.02, maxValue - minValue);
        const pull = (p: number, force: boolean) => {
          if (!(p > 0) || p < maxValue * 0.15 || p > maxValue * 4) return;
          if (!force && !(p < minValue && minValue - p <= span) && !(p > maxValue && p - maxValue <= span)) return;
          if (p < minValue) minValue = p;
          if (p > maxValue) maxValue = p;
        };
        for (const p of frameRef.current) pull(p, boundRef.current);
        for (const p of levelPricesRef.current) pull(p, false);
        const pad = Math.max(0.02, (maxValue - minValue) * 0.1);
        return { priceRange: { minValue: Math.max(0.01, minValue - pad), maxValue: maxValue + pad } };
      },
    });
    if (stockPaneRef.current) {
      chart.panes()[0]?.setStretchFactor(1.35);
      const under = chart.addPane();
      under.setStretchFactor(0.65);
      const stock = chart.addSeries(CandlestickSeries, {
        ...candleSeriesOptions(t),
        priceLineVisible: true,
        priceLineColor: 'rgba(237,237,237,0.35)',
        priceFormat: pxSeriesFormat(),
        autoscaleInfoProvider: (orig: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const base = orig();
          if (!base?.priceRange) return base;
          let { minValue, maxValue } = base.priceRange;
          const span = Math.max(0.5, maxValue - minValue);
          const room = Math.max(span * 2, 1);
          for (const p of stockFrameRef.current) {
            if (!(p > 0)) continue;
            if (p < minValue && minValue - p <= room) minValue = p;
            else if (p > maxValue && p - maxValue <= room) maxValue = p;
          }
          const pad = span * 0.08;
          return { priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
        },
      }, 1);
      stockSeriesRef.current = stock;
    }
    /* The frame is the reader's once they drag the price scale. The wheel does not freeze it — Terrain's rule. */
    const freezeScale = () => {
      const ps = chart.priceScale('right');
      if (ps.options().autoScale) ps.applyOptions({ autoScale: false });
    };
    let clampLock = false;
    /* The window may move through the bars, with a little air at each end.
       It may not run off into an empty tape. */
    const clampTime = () => {
      if (!boundRef.current || clampLock) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      const len = barCountRef.current;
      if (!range || len <= 1) return;
      const padL = 12;
      const padR = 18;
      const maxSpan = len + padL + padR;
      const asLogical = (n: number) => n as Logical;
      let from = range.from as number;
      let to = range.to as number;
      if (to - from > maxSpan) {
        from = -padL;
        to = len - 1 + padR;
      }
      if (from < -padL) {
        to += -padL - from;
        from = -padL;
      }
      if (to > len - 1 + padR) {
        from -= to - (len - 1 + padR);
        to = len - 1 + padR;
      }
      if (from < -padL) from = -padL;
      if (Math.abs(from - (range.from as number)) > 0.05 || Math.abs(to - (range.to as number)) > 0.05) {
        clampLock = true;
        ts.setVisibleLogicalRange({ from: asLogical(from), to: asLogical(to) });
        clampLock = false;
      }
    };
    clampTimeRef.current = clampTime;
    const onPointerDown = () => {
      holdRef.current = true;
    };
    const onPointerUp = () => {
      holdRef.current = false;
      if (!chart.priceScale('right').options().autoScale) followRef.current = false;
    };
    const onRange = () => {
      clampTime();
    };
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointerdown', freezeScale);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onCross = (param: { time?: Time; point?: { x: number; y: number } }) => {
      const list = ptsRef.current;
      if (!list.length) return;
      if (!param.time || !param.point) {
        hoverRef.current = false;
        onBarRef.current?.(list[list.length - 1]);
        return;
      }
      hoverRef.current = true;
      const hit = list.find(p => p.time === param.time);
      if (hit) onBarRef.current?.(hit);
    };
    chart.subscribeCrosshairMove(onCross);

    /* Terrain's wheel: a glide toward a target view, the bar under the pointer stays, and the candles stay fitted.
       The library's own wheel is off. A sideways wheel still pans. A price-scale drag stays frozen while the
       candles are still inside it; a zoom that leaves them behind gives the fit back. */
    let wheelRaf = 0;
    const keepCandles = () => {
      wheelRaf = 0;
      const ps = chart.priceScale('right');
      if (ps.options().autoScale) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      const shown = ps.getVisibleRange();
      const data = series.data() as readonly { high?: number; low?: number }[];
      if (!range || !shown || !data.length) return;
      const from = Math.max(0, Math.floor(range.from as number));
      const to = Math.min(data.length - 1, Math.ceil(range.to as number));
      if (to < from) return;
      const lo = Math.min(shown.from, shown.to);
      const hi = Math.max(shown.from, shown.to);
      for (let i = from; i <= to; i++) {
        const d = data[i];
        if (d && d.high != null && d.low != null && d.high >= lo && d.low <= hi) return;
      }
      ps.applyOptions({ autoScale: true });
    };
    const onWheelKeep = () => {
      if (!wheelRaf) wheelRaf = requestAnimationFrame(keepCandles);
    };
    host.addEventListener('wheel', onWheelKeep, { passive: true });
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
      const still = !!zoomPrev && Math.abs((cur.from as number) - zoomPrev.from) < 0.005 && Math.abs((cur.to as number) - zoomPrev.to) < 0.005;
      zoomStill = still ? zoomStill + 1 : 0;
      if (zoomStill >= 2) {
        zoomEnd();
        return;
      }
      zoomPrev = { from: cur.from as number, to: cur.to as number };
      const dt = zoomLast ? Math.min(48, now - zoomLast) : 16;
      zoomLast = now;
      const a = 1 - Math.exp(-dt / 70);
      const from = (cur.from as number) + (zoomTarget.from - (cur.from as number)) * a;
      const to = (cur.to as number) + (zoomTarget.to - (cur.to as number)) * a;
      const done = Math.abs(zoomTarget.from - from) < 0.02 && Math.abs(zoomTarget.to - to) < 0.02;
      ts.setVisibleLogicalRange(done ? zoomTarget : { from, to });
      onWheelKeep();
      if (done) zoomEnd();
      else zoomRaf = requestAnimationFrame(zoomStep);
    };
    const cancelZoom = () => {
      zoomTarget = null;
      zoomPrev = null;
    };
    const onWheelZoom = (e: WheelEvent) => {
      if (pageScrollRef.current) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (dy === 0 || Math.abs(dy) < Math.abs(e.deltaX)) {
        cancelZoom();
        return;
      }
      if (e.cancelable) e.preventDefault();
      const ts = chart.timeScale();
      const cur = ts.getVisibleLogicalRange();
      if (!cur) return;
      const base = zoomTarget ?? { from: cur.from as number, to: cur.to as number };
      const x = e.clientX - host.getBoundingClientRect().left;
      const underCursor = ts.coordinateToLogical(x);
      const t = underCursor == null ? 0.5 : ((underCursor as number) - (cur.from as number)) / Math.max(1e-6, (cur.to as number) - (cur.from as number));
      const anchor = base.from + t * (base.to - base.from);
      const width = Math.max(1, ts.width());
      const span0 = base.to - base.from;
      const span = Math.min(width / 0.5, Math.max(width / 50, span0 * Math.exp(dy * 0.0015)));
      const ratio = span / span0;
      let from = anchor - (anchor - base.from) * ratio;
      let to = anchor + (base.to - anchor) * ratio;
      const len = barCountRef.current;
      if (len > 0 && to > len - 1 + span * 0.5) {
        const over = to - (len - 1 + span * 0.5);
        from -= over;
        to -= over;
      }
      zoomTarget = { from, to };
      if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
    };
    host.addEventListener('wheel', onWheelZoom, { passive: false });
    host.addEventListener('pointerdown', cancelZoom);

    chartRef.current = chart;
    seriesRef.current = series;
    const marksPrimitive = new SetupMarksPrimitive();
    const nodesPrimitive = new PremiumNodesPrimitive();
    series.attachPrimitive(nodesPrimitive);
    series.attachPrimitive(marksPrimitive);
    marksRef.current = marksPrimitive;
    nodesRef.current = nodesPrimitive;
    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointerdown', freezeScale);
      host.removeEventListener('wheel', onWheelKeep);
      host.removeEventListener('wheel', onWheelZoom);
      host.removeEventListener('pointerdown', cancelZoom);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
      if (zoomRaf) cancelAnimationFrame(zoomRaf);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onCross);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      stockSeriesRef.current = null;
      volSeriesRef.current = null;
      stockPtsRef.current = [];
      marksRef.current = null;
      nodesRef.current = null;
      loadedRef.current = '';
    };
  }, []);

  // The caller's reserved headroom, applied live (it changes on resize/wrap)
  useEffect(() => {
    chartRef.current?.priceScale('right').applyOptions({
      scaleMargins: { top: Math.min(0.55, Math.max(0.05, topMargin ?? 0.2)), bottom: 0.1 },
    });
  }, [topMargin]);

  /* the wheel's owner can change without a remount — fullscreen in and out */
  useEffect(() => {
    chartRef.current?.applyOptions({ handleScroll: { mouseWheel: !pageScroll }, handleScale: { mouseWheel: false } });
  }, [pageScroll]);

  // Recolor in place when the app-wide theme changes — same contract as StrikeChart
  useEffect(() => {
    const t = getCandleTheme();
    seriesRef.current?.applyOptions(candleSeriesOptions(t));
    const s = chartSurface(t);
    chartRef.current?.applyOptions({
      layout: { background: { color: s.bg }, textColor: s.text },
      rightPriceScale: { borderColor: s.line },
      timeScale: { borderColor: s.line },
      crosshair: {
        vertLine: { color: s.crosshair, labelBackgroundColor: s.label },
        horzLine: { color: s.crosshair, labelBackgroundColor: s.label },
      },
      grid: grid
        ? { vertLines: { visible: true, color: s.grid }, horzLines: { visible: true, color: s.grid } }
        : { vertLines: { visible: false }, horzLines: { visible: false } },
    });
  }, [themeKey, appTheme, grid]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const mins = tfMinutes(timeframe);
    if (traded !== undefined) {
      if (traded == null || traded.length === 0) {
        if (loadedRef.current !== 'empty') {
          loadedRef.current = 'empty';
          ptsRef.current = [];
          barCountRef.current = 0;
          series.setData([]);
          if (!hoverRef.current) onBarRef.current?.(null);
        }
        return;
      }
      const raw = traded.map(b => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      }));
      const folded = tradedAsIs ? raw : aggregateCandles(raw, mins);
      const pts = folded.map(b => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      const last = pts[pts.length - 1];
      const lastVol = folded[folded.length - 1]?.volume ?? 0;
      const sig = `traded|${timeframe}|${pts.length}|${last?.time ?? 0}|${last?.close ?? 0}|${lastVol}|${themeKey}`;
      const frameKey = (frameRef.current ?? []).map(p => (Number.isFinite(p) ? p.toFixed(4) : '')).join('|');
      const frameChanged = frameKeyRef.current !== frameKey;
      frameKeyRef.current = frameKey;
      if (loadedRef.current === sig) {
        if (frameChanged) {
          followRef.current = true;
          chart.priceScale('right').applyOptions({ autoScale: true });
        }
        return;
      }
      const fresh = !loadedRef.current.startsWith(`traded|${timeframe}|`);
      loadedRef.current = sig;
      ptsRef.current = pts;
      barCountRef.current = pts.length;
      series.setData(pts);
      if (folded.some(b => (b.volume ?? 0) > 0)) {
        if (!volSeriesRef.current) {
          volSeriesRef.current = chart.addSeries(HistogramSeries, {
            priceScaleId: 'vol',
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false,
          });
          chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, borderVisible: false });
        }
        const ink = getCandleTheme();
        volSeriesRef.current.setData(folded.map(b => ({
          time: b.time as UTCTimestamp,
          value: b.volume ?? 0,
          color: b.close >= b.open ? ink.volUp : ink.volDown,
        })));
      }
      if (fresh && pts.length) {
        followRef.current = true;
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().applyOptions({ barSpacing: tapePitch(timeframe), minBarSpacing: 0.5 });
        chart.timeScale().setVisibleLogicalRange(fitWindow(pts.length, hostRef.current?.clientWidth ?? 0, timeframe));
        clampTimeRef.current();
      }
      if (!hoverRef.current) onBarRef.current?.(last ?? null);
      return;
    }
    /* Caller-owned tape (the setup) is repriced as-is. The live book is a
       different price — using it here drew a $0.05 floor under a $1 contract. */
    const owned = barsProp != null;
    const src = owned ? barsProp : liveBars(ticker);
    const bars = aggregateCandles(src, mins);
    if (bars.length === 0) return;
    /* the contract's own pricer (the Weigher's, off its live quote and vol); without one nothing is drawn */
    const iv = ivProp ?? Number.NaN;
    if (!priceAt) return;
    const px = priceAt;
    const point = (b: (typeof bars)[number], live: boolean) => {
      const o = px(b.open);
      const c = px(live ? spot : b.close);
      const a = px(live ? Math.max(b.high, spot) : b.high);
      const z = px(live ? Math.min(b.low, spot) : b.low);
      return {
        time: b.time as UTCTimestamp,
        open: Number(o.toFixed(2)),
        close: Number(c.toFixed(2)),
        high: Number(Math.max(o, c, a, z).toFixed(2)),
        low: Number(Math.min(o, c, a, z).toFixed(2)),
      };
    };
    const sig = `${ticker}|${strike}|${right}|${timeframe}|${tYears.toFixed(4)}|${iv.toFixed(4)}|bs|${themeKey}|${owned ? 'own' : 'book'}`;
    const pushStock = () => {
      const ss = stockSeriesRef.current;
      if (!ss) return;
      const toStock = (b: (typeof bars)[number]) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      });
      const prev = stockPtsRef.current;
      const formed = toStock(bars[bars.length - 1]);
      const tail = prev[prev.length - 1];
      if (tail && tail.time === formed.time && prev.length === bars.length) {
        prev[prev.length - 1] = formed;
        ss.update(formed);
      } else if (tail && bars.length === prev.length + 1) {
        prev.push(formed);
        ss.update(formed);
      } else {
        const all = bars.map(toStock);
        stockPtsRef.current = all;
        ss.setData(all);
      }
      const host = hostRef.current;
      if (host) {
        host.setAttribute('data-stock-close', formed.close.toFixed(2));
        requestAnimationFrame(() => {
          const h = chart.panes()[1]?.getHeight() ?? 0;
          const top = ss.coordinateToPrice(8);
          const bot = h > 16 ? ss.coordinateToPrice(h - 8) : null;
          if (top != null && bot != null) host.setAttribute('data-stock-scale', `${Math.min(bot, top).toFixed(2)}..${Math.max(bot, top).toFixed(2)}`);
        });
      }
    };
    const fresh = loadedRef.current !== sig;
    /* A tick only moves the live candle. Repricing the whole month, then
       refitting the scale, is what made a wheel zoom feel stuck. */
    if (!fresh && holdRef.current) return;
    if (!fresh && ptsRef.current.length) {
      const prev = ptsRef.current;
      const formed = point(bars[bars.length - 1], spot > 0);
      const tail = prev[prev.length - 1];
      if (tail && tail.time === formed.time && prev.length === bars.length) {
        prev[prev.length - 1] = formed;
        series.update(formed);
        pushStock();
        if (!hoverRef.current) onBarRef.current?.(formed);
        return;
      }
      if (tail && bars.length === prev.length + 1) {
        prev.push(formed);
        barCountRef.current = prev.length;
        series.update(formed);
        pushStock();
        if (!hoverRef.current) onBarRef.current?.(formed);
        return;
      }
    }
    const pts = bars.map((b, i) => point(b, i === bars.length - 1 && spot > 0));
    ptsRef.current = pts;
    barCountRef.current = pts.length;
    const reframe = fresh;
    loadedRef.current = sig;
    series.setData(pts);
    pushStock();
    if (reframe) {
      followRef.current = true;
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().applyOptions({ barSpacing: tapePitch(timeframe), minBarSpacing: 0.5 });
      chart.timeScale().setVisibleLogicalRange(fitWindow(pts.length, hostRef.current?.clientWidth ?? 0, timeframe));
      clampTimeRef.current();
    }
    if (!hoverRef.current) onBarRef.current?.(pts[pts.length - 1] ?? null);
  }, [ticker, strike, right, timeframe, tYears, revision, themeKey, ivProp, bookRev, barsProp, spot, traded, tradedAsIs, (framePrices ?? []).map(p => (Number.isFinite(p) ? p.toFixed(4) : '')).join('|')]);

  /* The level rules — recreated whole when they change; lightweight-charts
     price lines carry the label on the line and the price on the axis, which
     is the ask verbatim. */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    levelPricesRef.current = rules ? (levels ?? []).map(l => l.price) : [];
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = rules
      ? (levels ?? []).map(l =>
          series.createPriceLine({
            price: l.price,
            color: l.color,
            lineWidth: 1,
            lineStyle: LEVEL_STYLE[l.style ?? 'dashed'],
            lineVisible: !l.axisOnly,
            axisLabelVisible: true,
            title: l.label,
          })
        )
      : [];
    marksRef.current?.setData(marks ?? null);
    nodesRef.current?.setNodes(nodes ?? [], beadInset);
  }, [JSON.stringify(levels), JSON.stringify(nodes), rules, marks, beadInset]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Stock-price scenarios live on the stock pane only. They are not the option stop. */
  useEffect(() => {
    const series = stockSeriesRef.current;
    if (!series) return;
    for (const line of stockLinesRef.current) series.removePriceLine(line);
    stockLinesRef.current = (scenarios ?? [])
      .filter(s => s.price > 0)
      .map(s =>
        series.createPriceLine({
          price: s.price,
          color: 'rgba(237, 237, 237, 0.45)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: s.title,
        })
      );
  }, [JSON.stringify(scenarios)]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Projections: their own line series, allowed past now, keyed and reused (setData each tick is a repaint, recreate is churn).
     The range is re-pinned only when the projection shape changes, so per-tick updates never stomp the reader's panning. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const want = (projections ?? []).filter(p => p.points.length >= 2);
    const held = projSeriesRef.current;
    for (const [key, line] of held) {
      if (!want.some(p => p.key === key)) {
        chart.removeSeries(line);
        held.delete(key);
      }
    }
    for (const p of want) {
      let line = held.get(p.key);
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: p.color,
          lineWidth: 1,
          lineStyle: p.dashed === false ? LineStyle.Solid : LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        held.set(p.key, line);
      }
      line.setData(p.points.map(q => ({ time: q.time as UTCTimestamp, value: Number(q.value.toFixed(2)) })));
    }
    if (want.length > 0) {
      // show: recent history + the whole projected horizon — once per shape
      const extraBars = want.reduce((m, p) => Math.max(m, p.points.length), 0);
      const rangeSig = `${want.map(p => p.key).join(',')}|${extraBars}`;
      if (projRangeRef.current !== rangeSig) {
        projRangeRef.current = rangeSig;
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, barCountRef.current - 90),
          to: barCountRef.current + extraBars + 4,
        });
      }
    }
  }, [projections]);

  /* The opening view, restorable: autoscale on and the load's window, widened by projections as on first paint. */
  const resetView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    followRef.current = true;
    chart.priceScale('right').applyOptions({ autoScale: true });
    const len = barCountRef.current;
    const extraBars = (projections ?? [])
      .filter(p => p.points.length >= 2)
      .reduce((m, p) => Math.max(m, p.points.length), 0);
    chart.timeScale().applyOptions({ barSpacing: tapePitch(timeframe), minBarSpacing: 0.5 });
    chart.timeScale().setVisibleLogicalRange(
      extraBars > 0 ? { from: Math.max(0, len - 90), to: len + extraBars + 4 } : fitWindow(len, hostRef.current?.clientWidth ?? 0, timeframe),
    );
  };

  return (
    <div className="absolute inset-0" data-chart-ink data-chart-ground={chartGround(themeKey)}>
      <div ref={hostRef} className="absolute inset-0" />
      <ResetViewControl onReset={resetView} />
    </div>
  );
};

export default ContractPremiumPane;
