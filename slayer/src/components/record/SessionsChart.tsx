/* A small chart on the chart library: sessions or minutes as an area, a line or bars, levels as price lines, bars under
   the line on their own scale, marks, a hover card and a kept focus. It fits its content and does not pan or zoom. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AreaSeries, BaselineSeries, HistogramSeries, LineSeries, LineStyle, LineType, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { DARK_FIGURE_SURFACE } from '../gex/candleTheme';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { alpha, resolveInk } from '../gex/paletteInk';
import { fmtClockLocal, fmtDayLocal, fmtStampLocal, localTickMarks, nyTickMarks, type ChartClock } from '../gex/chartTime';
import { PlotNotesPrimitive } from './plotNotesPrimitive';

export interface ChartPoint {
  /** Unix seconds */
  time: number;
  value: number;
  /** A bar's own ink (histograms) */
  color?: string;
}
interface ChartLine {
  price: number;
  color: string;
  title: string;
  style?: 'dashed' | 'dotted' | 'solid';
  /** Where a level's name prints: on the axis tag (the default), or inside the plot at the line's left end. */
  name?: 'axis' | 'plot';
  /** false: no line across the plot, only its tag on the axis (a band's edge the primitive already draws) */
  line?: boolean;
}
/** A soft fill between two prices across the plot — the room a line lives in (the pair's usual range) */
interface ChartBand {
  from: number;
  to: number;
  color: string;
}
export interface ChartMark {
  time: number;
  color: string;
  /** Under the point rather than over it */
  below?: boolean;
  /** on the point itself, at its value */
  on?: boolean;
  /** The mark's size, in the library's units (0.6 unless said) */
  size?: number;
  /** The shape beside the point — an arrow says a direction, a circle an event */
  shape?: 'circle' | 'arrowUp' | 'arrowDown';
  /** The word drawn beside the mark */
  word?: string;
  /** What the card says for it */
  text: string;
}
/** What sits under the pointer, or under the focus */
interface ChartHover {
  time: number;
  point: ChartPoint | null;
  prev: ChartPoint | null;
  bar: ChartPoint | null;
  marks: ChartMark[];
  /** The card is up because the bar is kept, not because the pointer is on it */
  kept: boolean;
}

interface Props {
  points: ChartPoint[];
  /** 'baseline': the line wears `ink` above `baseline` and `inkBelow` under it, a faint fill each side */
  kind?: 'area' | 'line' | 'histogram' | 'baseline';
  /** A token ink ('rgb(var(--bull))') or a literal — resolved off the island for the canvas */
  ink: string;
  /** The baseline kind's ink under the line, and the level it turns on (0 unless said) */
  inkBelow?: string;
  baseline?: number;
  /** Bars under the main series on their own scale — prints on a tape */
  bars?: ChartPoint[];
  lines?: ChartLine[];
  bands?: ChartBand[];
  marks?: ChartMark[];
  /** A fixed height — or `fill`, and the chart takes its parent's height (the trend's chart fills its box's spare room) */
  height?: number;
  fill?: boolean;
  /** 'day' names the axis by the date, 'clock' by the minute; 'span' runs through several days and names each day once in
      a strip of its own under the tape. */
  clock?: 'day' | 'clock' | 'span';
  /** The word after the last day of a span — "exp" on the simulated returns */
  spanEndWord?: string;
  /** How the price scale prints — 'pnl' is signed dollars ("+$1.2K", "−$340") */
  scale?: 'price' | 'volume' | 'plain' | 'pnl' | 'ratio';
  /** The scale's own range when the host knows it better than the library's fit; the chart keeps its margins round it. */
  range?: readonly [number, number];
  card: (h: ChartHover) => ReactNode;
  cardW?: number;
  cardH?: number;
  /** The kept bar's time — a click on a bar asks the host to keep it, a click elsewhere to let it go */
  focus?: number | null;
  onFocus?: (time: number | null) => void;
  /** whose clock the axis and card speak: the reader's (Settings), or New York's */
  zone?: ChartClock;
  /** The point under the pointer, as it moves — so a host can light the row that point is (null when it leaves) */
  onHover?: (time: number | null) => void;
  /** a click on a point, handed to the host */
  onPick?: (time: number) => void;
  /** the line drawn as a curve through its points */
  curved?: boolean;
  testId?: string;
}

const STYLE: Record<NonNullable<ChartLine['style']>, LineStyle> = { dashed: LineStyle.Dashed, dotted: LineStyle.Dotted, solid: LineStyle.Solid };
/* one shared empty list: a fresh `[]` default would re-run the data effect every render and loop the crosshair state */
const NONE: never[] = [];

/** "+$1.2K" · "−$340" · "$0" — the pnl scale's words */
const fmtSignedDollars = (v: number): string => {
  if (Math.abs(v) < 0.5) return '$0';
  const a = Math.abs(v);
  const body = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
  return `${v < 0 ? '−' : '+'}${body}`;
};

/** The span's day strip under the tape */
const DAY_STRIP_H = 18;

const SessionsChart = ({ points, kind = 'area', ink, inkBelow, baseline = 0, bars = NONE, lines = NONE, bands = NONE, marks = NONE, height = 200, fill = false, clock = 'day', spanEndWord, scale = 'price', range, card, cardW = 208, cardH = 86, focus = null, onFocus, zone = 'reader', onHover, onPick, curved = false, testId }: Props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const span = clock === 'span';
  /* the day strip: one label per day, placed by the chart's own scale */
  const [dayTicks, setDayTicks] = useState<{ left: number; label: string; edge: 'start' | 'mid' | 'end' }[]>([]);
  const layDays = () => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host || !span) return;
    const ts = chart.timeScale();
    const first = new Map<string, number>();
    for (const p of [...pointsRef.current].sort((a, b) => a.time - b.time)) {
      const key = fmtDayLocal(p.time as Time, zone);
      if (!first.has(key)) first.set(key, p.time);
    }
    const days = [...first.entries()];
    const W = host.clientWidth;
    const out: { left: number; label: string; edge: 'start' | 'mid' | 'end' }[] = [];
    days.forEach(([label, t], i) => {
      const x = ts.timeToCoordinate(t as UTCTimestamp);
      if (x == null) return;
      const last = i === days.length - 1;
      out.push({ left: i === 0 ? 0 : last ? W : x, label, edge: i === 0 ? 'start' : last ? 'end' : 'mid' });
    });
    /* a label that would touch the one before it is left out; the first and last always stay */
    const CHAR = 5.6;
    const GAP = 10;
    const extent = (t: (typeof out)[number]): [number, number] => {
      const w = (t.label.length + (t.edge === 'end' && spanEndWord ? spanEndWord.length + 3 : 0)) * CHAR;
      return t.edge === 'start' ? [t.left + 6, t.left + 6 + w] : t.edge === 'end' ? [t.left - 6 - w, t.left - 6] : [t.left - w / 2, t.left + w / 2];
    };
    const kept: typeof out = [];
    for (const t of out) {
      const [a] = extent(t);
      if (!kept.length || a >= extent(kept[kept.length - 1])[1] + GAP) kept.push(t);
      else if (t.edge === 'end') {
        while (kept.length > 1 && extent(kept[kept.length - 1])[1] + GAP > a) kept.pop();
        kept.push(t);
      }
    }
    setDayTicks(kept);
  };
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Baseline'> | null>(null);
  const barsRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  /** The bands under the series and the names inside the plot — drawn on the chart's own canvas */
  const notesRef = useRef<PlotNotesPrimitive | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const barsDataRef = useRef(bars);
  barsDataRef.current = bars;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const [hover, setHover] = useState<{ time: number; left: number; top: number } | null>(null);
  /** Where the kept bar's card sits when the pointer is away */
  const [pinned, setPinned] = useState<{ time: number; left: number; top: number } | null>(null);
  const withBars = bars.length > 0;

  /** The card's place beside a point of the plot, flipped to the other side near the right edge, kept inside the plot */
  const placeCard = (x: number, y: number) => {
    const host = hostRef.current;
    const W = host?.clientWidth ?? 0;
    const H = host?.clientHeight ?? 0;
    const left = x + 16 + cardW <= W - 8 ? x + 16 : Math.max(8, x - 16 - cardW);
    const top = Math.max(4, Math.min(H - cardH - 4, y - cardH / 2));
    return { left, top };
  };

  /* Mount once — and again on a theme flip: the island reads its inks at creation */
  const appTheme = useResolvedTheme();
  /* On the light page the chart sits in a soft-white well with the page's inks; on the dark page it is the dark island.
     The hover card stays dark glass on both. */
  const paper = appTheme === 'light';
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const surface = paper
      ? { bg: readToken('--inset', undefined, host), text: readToken('--text-secondary', undefined, host), line: readToken('--ink', 0.16, host), crosshair: readToken('--ink', 0.4, host), label: readToken('--text-primary', undefined, host) }
      : DARK_FIGURE_SURFACE; /* the page, never the candle pick (candleTheme.ts: a figure is not a tape) */
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: surface.bg === 'transparent' ? readToken('--panel', undefined, host) : surface.bg }, textColor: surface.text, fontFamily: "'Inter', sans-serif", fontSize: 9, attributionLogo: false },
      localization: { timeFormatter: (t: Time) => (clock === 'day' ? fmtDayLocal(t, zone) : clock === 'span' ? fmtStampLocal(t, zone) : fmtClockLocal(t, zone)) },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: surface.line, scaleMargins: withBars ? { top: 0.1, bottom: 0.42 } : { top: 0.14, bottom: 0.08 } },
      timeScale: {
        borderColor: surface.line,
        /* a span puts the library's axis away — the day strip under the tape names the days */
        visible: clock !== 'span',
        timeVisible: clock === 'clock',
        secondsVisible: false,
        rightOffset: clock === 'span' ? 0 : 1,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: zone === 'ny' ? nyTickMarks : localTickMarks,
      },
      crosshair: {
        vertLine: { color: surface.crosshair, labelBackgroundColor: surface.label },
        horzLine: { color: surface.crosshair, labelBackgroundColor: surface.label },
      },
      handleScroll: false,
      handleScale: false,
    });
    const priceFormat =
      scale === 'volume'
        ? { type: 'volume' as const }
        : scale === 'plain'
          ? { type: 'price' as const, precision: 0, minMove: 1 }
          : scale === 'pnl'
            ? { type: 'custom' as const, minMove: 1, formatter: fmtSignedDollars }
            : scale === 'ratio'
              ? /* one price over another (the pair): three places, or two names a cent apart read as the same figure */
                { type: 'price' as const, precision: 3, minMove: 0.001 }
              : { type: 'price' as const, precision: 2, minMove: 0.01 };
    const color = resolveInk(ink, host);
    const below = resolveInk(inkBelow ?? ink, host);
    const series =
      kind === 'histogram'
        ? chart.addSeries(HistogramSeries, { color, priceFormat, priceLineVisible: false, lastValueVisible: false, base: 0 })
        : kind === 'line'
          ? chart.addSeries(LineSeries, { color, lineWidth: 2, lineType: curved ? LineType.Curved : LineType.Simple, priceFormat, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 })
          : kind === 'baseline'
            ? chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price', price: baseline },
                topLineColor: color,
                topFillColor1: alpha(color, 0.22),
                topFillColor2: alpha(color, 0.02),
                bottomLineColor: below,
                bottomFillColor1: alpha(below, 0.02),
                bottomFillColor2: alpha(below, 0.22),
                lineWidth: 2,
                lineType: curved ? LineType.Curved : LineType.Simple,
                priceFormat,
                priceLineVisible: false,
                /* no last-value tag: it sat on the floor line's own label when the line ended there */
                lastValueVisible: false,
                crosshairMarkerRadius: 3,
              })
            : chart.addSeries(AreaSeries, { lineColor: color, topColor: alpha(color, 0.26), bottomColor: alpha(color, 0.02), lineWidth: 2, lineType: curved ? LineType.Curved : LineType.Simple, priceFormat, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
    /* the level the baseline turns on, as a hairline */
    if (kind === 'baseline') series.createPriceLine({ price: baseline, color: alpha(resolveInk('rgb(var(--text-primary))', host), 0.28), lineStyle: LineStyle.Solid, lineWidth: 1, axisLabelVisible: false });
    /* A level's axis tag is dropped when it would overlap the last price's tag or one already placed; its line stays. */
    const vals = pointsRef.current.map(p => p.value).concat(lines.map(l => l.price)).filter(v => Number.isFinite(v));
    const span = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    const gap = span * 0.1;
    const lastPt = pointsRef.current.length ? [...pointsRef.current].sort((a, b) => a.time - b.time)[pointsRef.current.length - 1].value : null;
    const tagged: number[] = kind === 'line' || kind === 'area' ? (lastPt != null ? [lastPt] : []) : [];
    for (const l of lines) {
      const c = resolveInk(l.color, host);
      const room = gap <= 0 || tagged.every(t => Math.abs(t - l.price) >= gap);
      if (room) tagged.push(l.price);
      /* a name inside the plot leaves the axis tag to the figure alone */
      series.createPriceLine({ price: l.price, color: c, title: l.name === 'plot' ? '' : l.title, lineStyle: STYLE[l.style ?? 'dashed'], lineWidth: 1, lineVisible: l.line !== false, axisLabelVisible: room, axisLabelColor: c, axisLabelTextColor: paper ? '#ffffff' : '#0a0a0a' });
    }
    const notes = new PlotNotesPrimitive();
    series.attachPrimitive(notes);
    notesRef.current = notes;
    if (withBars) {
      const b = chart.addSeries(HistogramSeries, { priceScaleId: 'bars', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false, base: 0 });
      chart.priceScale('bars').applyOptions({ scaleMargins: { top: 0.64, bottom: 0 }, visible: false });
      barsRef.current = b;
    }
    markersRef.current = createSeriesMarkers(series, []);
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point) {
        setHover(null);
        onHoverRef.current?.(null);
        return;
      }
      const t = param.time as number;
      if (!pointsRef.current.some(q => q.time === t) && !barsDataRef.current.some(q => q.time === t)) {
        setHover(null);
        onHoverRef.current?.(null);
        return;
      }
      onHoverRef.current?.(t);
      const W = host.clientWidth;
      const H = host.clientHeight;
      const left = param.point.x + 16 + cardW <= W - 8 ? param.point.x + 16 : Math.max(8, param.point.x - 16 - cardW);
      const top = Math.max(4, Math.min(H - cardH - 4, param.point.y - cardH / 2));
      setHover({ time: t, left, top });
    });
    /* a click keeps the bar under it, or lets the kept one go */
    chart.subscribeClick(param => {
      const t = param.time as number | undefined;
      const onBar = t != null && barsDataRef.current.some(b => b.time === t);
      onFocusRef.current?.(onBar ? t! : null);
      if (t != null) onPickRef.current?.(t);
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      barsRef.current = null;
      markersRef.current = null;
      notesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appTheme, kind, clock, scale, withBars, zone, curved]);

  /* The bands and the in-plot names, whenever they move — inks resolved off the island for the canvas */
  useEffect(() => {
    const host = hostRef.current;
    const notes = notesRef.current;
    if (!host || !notes) return;
    /* the notes stand on the island's own ground, so the line passing under one leaves it legible */
    const ground = paper ? readToken('--inset', undefined, host) : DARK_FIGURE_SURFACE.bg === 'transparent' ? readToken('--panel', undefined, host) : DARK_FIGURE_SURFACE.bg;
    notes.update({
      ground,
      bands: bands.map(b => {
        const c = resolveInk(b.color, host);
        return { from: b.from, to: b.to, fill: alpha(c, paper ? 0.1 : 0.08), edge: alpha(c, paper ? 0.3 : 0.24) };
      }),
      notes: lines.filter(l => l.name === 'plot').map(l => ({ price: l.price, text: l.title, color: alpha(resolveInk(l.color, host), 0.9) })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, lines, appTheme]);

  /* The data, the bars and the marks, whenever they move — the kept bar keeps its ink, the others dim beside it */
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!series || !chart || !host) return;
    const sorted = [...points].sort((a, b) => a.time - b.time);
    series.setData(sorted.map(p => ({ time: p.time as UTCTimestamp, value: p.value, ...(p.color ? { color: resolveInk(p.color, host) } : {}) })));
    if (barsRef.current) {
      const sb = [...bars].sort((a, b) => a.time - b.time);
      barsRef.current.setData(
        sb.map(p => {
          const c = resolveInk(p.color ?? ink, host);
          return { time: p.time as UTCTimestamp, value: p.value, color: focus != null && p.time !== focus ? alpha(c, 0.3) : c };
        })
      );
    }
    const times = new Set(sorted.map(p => p.time));
    const valueAt = new Map(sorted.map(p => [p.time, p.value]));
    const ms: SeriesMarker<Time>[] = marks
      .filter(m => times.has(m.time))
      .sort((a, b) => a.time - b.time)
      .map(m => {
        const base = { time: m.time as UTCTimestamp, color: resolveInk(m.color, host), shape: m.shape ?? 'circle', size: m.size ?? 0.6, text: m.word };
        /* a mark ON the point sits at its value — the library's price positions */
        if (m.on) return { ...base, position: 'atPriceMiddle' as const, price: valueAt.get(m.time) ?? 0 };
        return { ...base, position: m.below ? ('belowBar' as const) : ('aboveBar' as const) };
      });
    markersRef.current?.setMarkers(ms);
    /* the host's range, if it gave one — else the library fits the data */
    series.applyOptions({ autoscaleInfoProvider: range ? () => ({ priceRange: { minValue: range[0], maxValue: range[1] } }) : undefined });
    chart.timeScale().fitContent();
    /* the day strip follows the scale — a frame later, once the fit has landed */
    if (span) {
      const raf = requestAnimationFrame(layDays);
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, bars, marks, ink, focus, range?.[0], range?.[1]]);
  /* …and the host's width */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !span) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(layDays));
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span]);

  /* The kept bar: the crosshair parks on it and its card stays where it is */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    if (focus == null) {
      chart.clearCrosshairPosition();
      setPinned(null);
      setHover(null);
      return;
    }
    const bar = bars.find(b => b.time === focus);
    if (!bar) {
      setPinned(null);
      return;
    }
    const point = points.find(p => p.time === focus);
    const value = point?.value ?? bar.value;
    const onSeries = point ? series : barsRef.current ?? series;
    chart.setCrosshairPosition(value, focus as UTCTimestamp, onSeries);
    const x = chart.timeScale().timeToCoordinate(focus as UTCTimestamp);
    const y = onSeries.priceToCoordinate(value);
    if (x == null || y == null) {
      setPinned(null);
      return;
    }
    setPinned({ time: focus, ...placeCard(x, y) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, points, bars]);

  const at = hover ?? pinned;
  const hp = at ? points.find(p => p.time === at.time) ?? null : null;
  const index = hp ? points.indexOf(hp) : -1;
  const prev = index > 0 ? points[index - 1] : null;
  const bar = at ? bars.find(b => b.time === at.time) ?? null : null;
  const onPoint = at ? marks.filter(m => m.time === at.time) : [];
  /* the card is the kept bar's whenever it stands on the kept time — the parked crosshair reports itself as a pointer move */
  const kept = focus != null && at?.time === focus;

  return (
    <div className={`relative rounded-md overflow-hidden ${fill ? 'flex-1 min-h-0' : ''} ${paper ? 'border border-borderSubtle bg-inset' : ''}`} style={{ height: fill ? undefined : height }} data-chart-ink={paper ? undefined : ''} data-theme={paper ? 'light' : 'dark'} data-sessions-chart={testId} data-points={points.length} data-bars={bars.length || undefined} data-focus={focus ?? undefined}>
      <div ref={hostRef} className="absolute inset-x-0 top-0" style={{ bottom: span ? DAY_STRIP_H : 0, cursor: withBars || onPick ? 'pointer' : 'default' }} />
      {span && (
        <div className="absolute inset-x-0 bottom-0 border-t border-borderSubtle/60" style={{ height: DAY_STRIP_H }} data-day-strip>
          {dayTicks.map(t => (
            <span
              key={t.label}
              className="absolute top-[3px] font-mono text-t9 tnum text-textMuted whitespace-nowrap"
              style={{ left: t.left, transform: t.edge === 'start' ? 'translateX(6px)' : t.edge === 'end' ? 'translateX(calc(-100% - 6px))' : 'translateX(-50%)' }}
              data-day-tick={t.label}
            >
              {t.label}
              {t.edge === 'end' && spanEndWord ? <span className="ml-1 text-textSecondary">· {spanEndWord}</span> : null}
            </span>
          ))}
        </div>
      )}
      {at && (hp || bar) && (
        <div className={`absolute z-10 pointer-events-none rounded-md border px-2.5 py-2 flex flex-col gap-1 text-t105 text-textSecondary ${kept ? 'border-silver/40' : 'border-borderSubtle'}`} style={{ left: at.left, top: at.top, width: cardW, background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }} data-theme="dark" data-chart-glass data-sessions-card={kept ? 'kept' : 'hover'}>
          {card({ time: at.time, point: hp, prev, bar, marks: onPoint, kept })}
        </div>
      )}
    </div>
  );
};

export default SessionsChart;
