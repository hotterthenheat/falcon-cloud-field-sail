/* The day box's charts, drawn by lightweight-charts as Compare's "Since the open": the library's own canvas, no grid,
   price scale right with a live chip, the clock along the foot. The two charts share one clock and one price-scale width. */

import type { DeepPartial, IChartApi, ISeriesApi, LineData, SeriesType, Time, TimeChartOptions, UTCTimestamp } from 'lightweight-charts';
import { DARK_FIGURE_SURFACE } from './candleTheme';
import { readToken } from '../../theme/theme';
import { fmtClockLocal } from './chartTime';
import { nyTickMarks } from '../../core/nyTime';

/** The axis's width before it is measured — a chrome offset's rest value only (the axes size themselves, below) */
export const DAY_SCALE_W = 76;

/* One width for the day's two axes: each chart reports its natural axis width to its group and the widest sets both,
   so a minute stays one x on both. A width only grows; a chart that leaves is forgotten. */
const groups = new Map<string, { widths: Map<string, number>; subs: Map<string, (w: number) => void> }>();
export function syncDayScale(chart: IChartApi, group: string, id: string, onWidth?: (w: number) => void): () => void {
  let g = groups.get(group);
  if (!g) {
    g = { widths: new Map(), subs: new Map() };
    groups.set(group, g);
  }
  const G = g;
  const widest = () => Math.max(0, ...G.widths.values());
  const apply = (w: number) => {
    chart.priceScale('right').applyOptions({ minimumWidth: w });
    onWidth?.(w);
  };
  G.subs.set(id, apply);
  const emit = () => {
    const w = widest();
    G.subs.forEach(fn => fn(w));
  };
  const measure = () => {
    const w = chart.priceScale('right').width();
    if (w > (G.widths.get(id) ?? 0)) {
      G.widths.set(id, w);
      emit();
    } else apply(widest());
  };
  /* after the first paint, then whenever the chart's range changes (new data, a resize) */
  let raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(measure);
  });
  const onRange = () => measure();
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
  return () => {
    cancelAnimationFrame(raf);
    try {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
    } catch {
      /* the chart is gone already */
    }
    G.subs.delete(id);
    G.widths.delete(id);
    if (!G.subs.size) groups.delete(group);
  };
}

export interface DaySurface {
  bg: string;
  text: string;
  line: string;
  crosshair: string;
  label: string;
  /** The page's first ink, resolved — the price line */
  ink: string;
  /** The zero line's ink */
  zero: string;
}

/** The figure surface, read off the box the chart sits in (a canvas cannot read a token) — Compare's own */
export function daySurface(host: HTMLElement, paper: boolean): DaySurface {
  const bg = readToken('--panel', undefined, host);
  const ink = readToken('--text-primary', undefined, host);
  if (paper) return { bg, text: readToken('--text-secondary', undefined, host), line: readToken('--ink', 0.16, host), crosshair: readToken('--ink', 0.4, host), label: readToken('--text-primary', undefined, host), ink, zero: readToken('--ink', 0.32, host) };
  return { bg, text: DARK_FIGURE_SURFACE.text, line: DARK_FIGURE_SURFACE.line, crosshair: DARK_FIGURE_SURFACE.crosshair, label: DARK_FIGURE_SURFACE.label, ink, zero: 'rgba(255,255,255,0.22)' };
}

/** The chart's options: Compare's, on New York's clock, the clock along the foot only where it is asked for */
export function dayChartOptions(s: DaySurface, opts: { clock: boolean; logo: boolean }): DeepPartial<TimeChartOptions> {
  return {
    autoSize: true,
    layout: { background: { color: s.bg }, textColor: s.text, fontFamily: "'Inter', sans-serif", fontSize: 10, attributionLogo: opts.logo },
    localization: { timeFormatter: (t: Time) => fmtClockLocal(t, 'ny') },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    /* whole figures only on the scale: the top tick's figure sat half under the pane's edge */
    rightPriceScale: { borderColor: s.line, minimumWidth: 0, entireTextOnly: true, scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: {
      visible: opts.clock,
      borderColor: s.line,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 0,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: nyTickMarks,
    },
    crosshair: {
      vertLine: { color: s.crosshair, labelBackgroundColor: s.label },
      horzLine: { color: s.crosshair, labelBackgroundColor: s.label },
    },
    handleScroll: false,
    handleScale: false,
  };
}

/** The epoch second at a New York minute of the session's day, off its first bar */
export const dayStartOf = (firstTime: number, firstMin: number): number => firstTime - firstMin * 60;

/** Every minute from the axis' first to its last, as real points on a hidden series (CLOCK_SCALE): the library leaves
    whitespace-only data out of the clock, so a replay's axes would otherwise end at different minutes. */
export const CLOCK_SCALE = 'clock';
export function dayClock(dayStart: number, from: number, to: number): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  for (let m = from; m <= to; m++) out.push({ time: (dayStart + m * 60) as UTCTimestamp, value: 0 });
  return out;
}

/** Two points that print the same — same time, same fields */
const samePoint = (a: object | undefined, b: object | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
};

/** The newest minute, not the whole day: a tick moves the last point, a new minute adds one; anything else sets the whole series. */
export function feedSeries<T extends { time: Time }>(series: ISeriesApi<SeriesType>, next: readonly T[], prev: { current: readonly T[] | null }): void {
  const p = prev.current;
  /* A tick only if the first point and the last settled one match by value: same first minute and length is not enough
     (a name switch kept the previous name's day). */
  const settled = next.length === (p?.length ?? -1) ? next.length - 2 : next.length - 3;
  if (
    p &&
    p.length > 0 &&
    next.length > 0 &&
    p[0].time === next[0].time &&
    (next.length === p.length || next.length === p.length + 1) &&
    samePoint(p[0], next[0]) &&
    (settled < 0 || samePoint(p[settled], next[settled]))
  ) {
    if (next.length === p.length + 1) series.update(next[next.length - 2] as never);
    series.update(next[next.length - 1] as never);
  } else {
    series.setData(next as never);
  }
  prev.current = next;
}
