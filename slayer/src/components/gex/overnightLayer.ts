/*
  THE OVERNIGHT LAYER on Terrain's chart: what the night holds while the cash tape is dark, drawn in the night's own
  slots on the time scale.

  - SPX, SPXW and XSP panes: the price SPX's options imply through Cboe's Global Trading Hours (data/overnightLine.ts),
    a dashed silver line over the night with its name on the field — "SPX (from options)", never a cash print — and the
    VIX's print beside it once the VIX prints (about 03:15). XSP draws a tenth of it.
  - Stock and ETF panes: the overnight session (20:00–04:00, the session module's) has no prints on the feed, so its
    slots are left empty and labelled "No overnight trading data", rather than the evening's last bar running straight
    into the morning's first as if nothing had happened between them.

  Only the latest night is drawn (the one open now, else the one before the latest session), on intraday timeframes,
  never on a host's own tape or a replay. Its slots are whitespace and a line series of the layer's own: the candles,
  their history and every other overlay are untouched.
*/

import { LineSeries, LineStyle, type IChartApi, type ISeriesApi, type ISeriesPrimitive, type SeriesAttachedParameter, type Time, type UTCTimestamp, type WhitespaceData, type LineData } from 'lightweight-charts';

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** The token inks, cut per chart ground (theme/tokens.css --silver and --text-muted) */
const INKS = {
  dark: { line: 'rgb(199,211,232)', muted: 'rgb(125,125,125)', box: 'rgba(10,10,10,0.78)', wash: 'rgba(255,255,255,0.025)' },
  light: { line: 'rgb(58,79,122)', muted: 'rgb(64,67,74)', box: 'rgba(250,250,250,0.86)', wash: 'rgba(0,0,0,0.025)' },
};

export interface OvernightDraw {
  /** 'line': the options' implied price; 'gap': the empty, labelled night of a stock */
  kind: 'line' | 'gap';
  /** The night's slots, epoch seconds, ascending (whitespace for the gap; the line's own points) */
  points: { time: number; value?: number }[];
  /** "SPX (from options)" / "No overnight trading data" */
  label: string;
  /** The line's last value as printed, and the VIX beside it */
  valueWord?: string;
  vixWord?: string;
  light: boolean;
}

class Renderer {
  constructor(private src: OvernightPrimitive) {}
  draw(target: DrawTarget): void {
    const src = this.src;
    const d = src.draw;
    const chart = src.chart;
    const series = src.series;
    if (!d || !chart || !series || d.points.length < 1) return;
    const ts = chart.timeScale();
    const first = ts.timeToCoordinate(d.points[0].time as Time);
    const last = ts.timeToCoordinate(d.points[d.points.length - 1].time as Time);
    if (first == null && last == null) return;
    const ink = d.light ? INKS.light : INKS.dark;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const W = scope.mediaSize.width;
      const H = scope.mediaSize.height;
      const x0 = Math.max(0, first ?? 0);
      const x1 = Math.min(W, last ?? W);
      if (x1 <= x0) return;
      ctx.save();
      ctx.font = `500 ${10 * vr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'middle';
      if (d.kind === 'gap') {
        /* the empty night: a faint wash over its slots, its name in the middle */
        ctx.fillStyle = ink.wash;
        ctx.fillRect(x0 * hr, 0, (x1 - x0) * hr, H * vr);
        const text = d.label;
        const tw = ctx.measureText(text).width / hr;
        ctx.fillStyle = ink.muted;
        ctx.textAlign = 'center';
        const mid = ((x0 + x1) / 2) * hr;
        if (tw + 12 <= x1 - x0) ctx.fillText(text, mid, (H / 2) * vr);
        else {
          /* a narrow night (a phone): the words on two lines, a word cut nowhere */
          const words = text.split(' ');
          const half = Math.ceil(words.length / 2);
          const lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
          if (Math.max(...lines.map(l => ctx.measureText(l).width / hr)) + 12 <= x1 - x0)
            lines.forEach((l, i) => ctx.fillText(l, mid, (H / 2 + (i - 0.5) * 13) * vr));
        }
        ctx.restore();
        return;
      }
      /* the line's name and its last value over the line's highest point in view, ending where the line ends, kept inside
         the plot: never across the line itself */
      const end = d.points[d.points.length - 1];
      let y: number | null = null;
      for (const p of d.points) {
        if (p.value == null) continue;
        const px = ts.timeToCoordinate(p.time as Time);
        if (px == null || px < 0 || px > W) continue;
        const py = series.priceToCoordinate(p.value);
        if (py != null && (y == null || py < y)) y = py;
      }
      if (y == null || end.value == null) {
        ctx.restore();
        return;
      }
      const parts = [d.label, d.valueWord ?? '', d.vixWord ?? ''].filter(Boolean);
      const gap = 6;
      const widths = parts.map(p => ctx.measureText(p).width / hr);
      const boxW = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 8;
      const boxH = 15;
      const ex = last ?? x1;
      const left = Math.max(2, Math.min(W - boxW - 2, ex - boxW));
      const top = Math.max(2, Math.min(H - boxH - 2, y - boxH - 8));
      ctx.fillStyle = ink.box;
      ctx.fillRect(left * hr, top * vr, boxW * hr, boxH * vr);
      ctx.strokeStyle = ink.line;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, Math.round(hr));
      ctx.strokeRect(left * hr + 0.5, top * vr + 0.5, boxW * hr - 1, boxH * vr - 1);
      ctx.globalAlpha = 1;
      let x = left + 4;
      parts.forEach((p, i) => {
        ctx.fillStyle = i === 1 ? ink.line : ink.muted;
        ctx.font = `${i === 1 ? 600 : 500} ${10 * vr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(p, x * hr, (top + boxH / 2) * vr);
        x += widths[i] + gap;
      });
      ctx.restore();
    });
  }
}

class PaneView {
  private r: Renderer;
  constructor(src: OvernightPrimitive) {
    this.r = new Renderer(src);
  }
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): Renderer {
    return this.r;
  }
}

class OvernightPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Line'> | null = null;
  draw: OvernightDraw | null = null;
  private views = [new PaneView(this)];
  private request?: () => void;
  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<'Line'>;
    this.request = p.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.request = undefined;
  }
  updateAllViews(): void {}
  paneViews(): PaneView[] {
    return this.views;
  }
  set(d: OvernightDraw | null): void {
    this.draw = d;
    this.request?.();
  }
}

/** The layer: its own line series (whitespace for a stock's gap) and the primitive that names it */
export class OvernightLayer {
  private series: ISeriesApi<'Line'> | null = null;
  private prim = new OvernightPrimitive();
  private sig = '';
  constructor(private chart: IChartApi) {}

  /** Whether this layer was drawn on `chart` — a chart rebuilt or removed takes the layer's series down with it */
  isOn(chart: IChartApi | null): boolean {
    return chart === this.chart;
  }

  /** Draws `d`, or clears the layer with null. Redraws only when what is drawn changes. */
  update(d: OvernightDraw | null): void {
    const sig = d ? `${d.kind}|${d.light}|${d.label}|${d.valueWord ?? ''}|${d.vixWord ?? ''}|${d.points.length}|${d.points[0]?.time}|${d.points[d.points.length - 1]?.time}|${d.points[d.points.length - 1]?.value ?? ''}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    if (!d || !d.points.length) {
      this.destroy();
      return;
    }
    const ink = d.light ? INKS.light : INKS.dark;
    if (!this.series) {
      this.series = this.chart.addSeries(LineSeries, {
        color: ink.line,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: d.kind === 'line',
        priceScaleId: 'right',
        title: '',
      });
      this.series.attachPrimitive(this.prim);
    } else this.series.applyOptions({ color: ink.line, crosshairMarkerVisible: d.kind === 'line' });
    const data: (LineData<Time> | WhitespaceData<Time>)[] = d.points.map(p => (d.kind === 'line' && p.value != null ? { time: p.time as UTCTimestamp, value: p.value } : { time: p.time as UTCTimestamp }));
    const series = this.series;
    this.keepView(() => series.setData(data));
    this.prim.set(d);
  }

  /* THE VIEW STAYS WHERE THE READER LEFT IT: the night's slots land between bars already drawn, and the time scale counts
     its slots, so without this the bars right of the night would slide out of view as it loads. The slot at the view's
     right edge is found again after the change and the view moved by as many slots as were added before it. */
  private keepView(change: () => void): void {
    const ts = this.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const x = range ? ts.logicalToCoordinate(Math.floor(range.to) as never) : null;
    const anchor = x != null ? ts.coordinateToTime(x) : null;
    const before = anchor != null ? ts.timeToIndex(anchor, true) : null;
    change();
    if (!range || anchor == null || before == null) return;
    const after = ts.timeToIndex(anchor, true);
    const shift = after != null ? Number(after) - Number(before) : 0;
    if (shift) ts.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
  }

  destroy(): void {
    this.sig = '';
    if (!this.series) return;
    const series = this.series;
    this.series = null;
    try {
      series.detachPrimitive(this.prim);
      this.keepView(() => this.chart.removeSeries(series));
    } catch {
      /* the chart is already gone */
    }
  }
}
