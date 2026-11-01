/* The wind field's paint (ported from Noah's fork, re-inked in the house tokens): the field core/windField.ts hands back —
   how many model paths pass through each price at each minute ahead, and a handful of the paths kept whole — drawn on
   the chart's runway from the last bar to today's close, under the candles. Two layers in one raster, drawn once a field
   and blitted on every repaint:
     THE GLOW     the density, each minute's column scaled to its own peak: glacier above the last price, ember below,
                  warming to the thermal middle where the paths crowd; clear under a floor, so the ground shows through;
     THE STREAKS  the kept paths as hairlines in the ink of the side they run on, faint alone and bright where they bundle.
   The field names itself on the chart, "Wind · model forecast": it is a model's paths, not a market figure. */
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { Rgb } from './thermalFieldPrimitive';

export interface WindInks {
  /** Above the last price (glacier) and below it (ember) */
  up: Rgb;
  down: Rgb;
  /** Where the paths crowd (the thermal middle) */
  core: Rgb;
  /** The words' ink */
  text: Rgb;
  /** 0..1, the ground's strength */
  strength: number;
}

export interface WindPaint {
  /** Columns, one a trading minute ahead */
  cols: number;
  lo: number;
  step: number;
  bins: number;
  /** cols × bins, row-major by minute, each column 0..1 */
  cells: Float32Array;
  streams: { n: number; cells: Float32Array };
  /** The last price the paths start from — the glacier/ember divide */
  spot: number;
  inks: WindInks;
  /** The logical index of the last drawn bar, and the trading minutes one bar holds */
  anchor: number;
  perBar: number;
  /** The words on the field */
  label: string;
}

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
/** Below this share of a column's peak the paint is clear */
const FLOOR = 0.05;
const PX_MIN = 3;
const PX_BIN = 3;
const GLOW = 0.5;
const STREAK = 0.32;
const css = (c: Rgb, a: number) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a.toFixed(3)})`;

/** The side's ink at a price: glacier above the last price, ember below, blended across a bin either side */
const sideInk = (price: number, p: WindPaint): Rgb => mix(p.inks.down, p.inks.up, smooth(0.5 + (price - p.spot) / (2 * Math.max(p.step, 1e-9))));

function raster(paint: WindPaint): HTMLCanvasElement | null {
  const T = paint.cols;
  const h = paint.bins;
  if (T <= 0 || h <= 0 || typeof document === 'undefined') return null;
  const small = document.createElement('canvas');
  small.width = T;
  small.height = h;
  const sctx = small.getContext('2d');
  if (!sctx) return null;
  const img = sctx.createImageData(T, h);
  const px = img.data;
  const { strength } = paint.inks;
  for (let b = 0; b < h; b++) {
    const side = sideInk(paint.lo + (b + 0.5) * paint.step, paint);
    for (let k = 0; k < T; k++) {
      const d = paint.cells[k * h + b];
      if (!(d > FLOOR)) continue;
      const t = (d - FLOOR) / (1 - FLOOR);
      const rgb = mix(side, paint.inks.core, 0.55 * smooth(t));
      const at = ((h - 1 - b) * T + k) * 4;
      px[at] = rgb[0];
      px[at + 1] = rgb[1];
      px[at + 2] = rgb[2];
      px[at + 3] = Math.round(255 * strength * GLOW * smooth(t));
    }
  }
  sctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = T * PX_MIN;
  c.height = h * PX_BIN;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, c.width, c.height);
  const n = paint.streams.n;
  if (n > 0 && paint.step > 0) {
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const yOf = (price: number) => c.height - ((price - paint.lo) / paint.step) * PX_BIN;
    for (let j = 0; j < n; j++) {
      const row = j * T;
      let prevX = 0;
      let prevY = yOf(paint.spot);
      for (let k = 0; k < T; k++) {
        const price = paint.streams.cells[row + k];
        const x = (k + 1) * PX_MIN;
        const y = yOf(price);
        const bin = Math.max(0, Math.min(h - 1, Math.floor((price - paint.lo) / paint.step)));
        const d = paint.cells[k * h + bin];
        const t = d > FLOOR ? (d - FLOOR) / (1 - FLOOR) : 0;
        ctx.strokeStyle = css(sideInk(price, paint), strength * STREAK * (0.35 + 0.65 * smooth(t)));
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
        prevX = x;
        prevY = y;
      }
    }
  }
  return c;
}

class WindFieldPaneView implements IPrimitivePaneView {
  constructor(private readonly source: WindFieldPrimitive) {}
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer() {
    const src = this.source;
    return {
      draw: (target: DrawTarget) => {
        const paint = src.data;
        const chart = src.chart;
        const series = src.series;
        if (!paint || !chart || !series || paint.cols <= 0) return;
        if (src.rasterFor !== paint) {
          src.raster = raster(paint);
          src.rasterFor = paint;
        }
        const r = src.raster;
        if (!r) return;
        const ts = chart.timeScale();
        /* both axes are affine: the anchor and the next slot place every column (the cone's own probe) */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xa = ts.logicalToCoordinate(paint.anchor as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let xb = ts.logicalToCoordinate((paint.anchor + 1) as any);
        if (xa !== null && (xb === null || xb === xa)) xb = ((xa as number) + (ts.options().barSpacing ?? 6)) as typeof xa;
        const yTop = series.priceToCoordinate(paint.lo + paint.bins * paint.step);
        const yBot = series.priceToCoordinate(paint.lo);
        if (xa === null || xb === null || yTop === null || yBot === null) return;
        const perPx = (xb - xa) / Math.max(1e-9, paint.perBar);
        const x1 = xa + paint.cols * perPx;
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hp, verticalPixelRatio: vp, mediaSize }) => {
          if (x1 < 0 || xa > mediaSize.width) return;
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(r, xa * hp, yTop * vp, (x1 - xa) * hp, (yBot - yTop) * vp);
          /* the field names itself at its top-left, kept inside the pane */
          const fs = 9.5;
          ctx.font = `600 ${Math.round(fs * vp)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textBaseline = 'top';
          const lx = Math.max(4, xa + 6);
          const ly = Math.min(Math.max(6, yTop + 4), mediaSize.height - 40);
          const w = ctx.measureText(paint.label).width;
          if (lx * hp + w < mediaSize.width * hp - 60 * hp) {
            ctx.fillStyle = css(paint.inks.text, 0.72);
            ctx.fillText(paint.label, lx * hp, ly * vp);
          }
          ctx.restore();
        });
      },
    };
  }
}

export class WindFieldPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  requestUpdate?: () => void;
  data: WindPaint | null = null;
  raster: HTMLCanvasElement | null = null;
  rasterFor: WindPaint | null = null;
  private readonly views: WindFieldPaneView[];

  constructor() {
    this.views = [new WindFieldPaneView(this)];
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<SeriesType>;
    this.requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
    this.raster = null;
    this.rasterFor = null;
  }
  updateAllViews(): void {}
  paneViews(): WindFieldPaneView[] {
    return this.views;
  }
  /** Swap what is drawn; off to off is skipped */
  setData(next: WindPaint | null): void {
    if (this.data === null && next === null) return;
    this.data = next;
    this.requestUpdate?.();
  }
}
