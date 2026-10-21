import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';

/*
==================================================
  SLAYER TERMINAL - THE THERMAL FIELD
  (components/gex/thermalFieldPrimitive.ts)

  Where price is likelier to be from this bar to the
  close. Hottest on the price, gold halfway to one
  expected move, gone at the move. Nothing past it.

  ONE SURFACE, not a column a minute. Rectangles
  stepped the fan — a rib at every seam and a
  staircase at the tip, which read as a pixelated
  cone. Every device pixel is lerped off the minute
  samples instead, then blitted. A crosshair repaint
  reuses the last raster.
==================================================
*/

/** One minute of the field: the band's edges and its hot centre, in price */
export interface FieldPoint {
  /** New York minutes from midnight */
  min: number;
  lo2: number;
  lo1: number;
  mid: number;
  hi1: number;
  hi2: number;
}

export type Rgb = [number, number, number];

export interface FieldData {
  /** The epoch second at New York's midnight of the session's day (dayChart.ts dayStartOf) */
  dayStart: number;
  points: FieldPoint[];
  /** The thermal ramp's inks, resolved off the page (paletteInk resolveInk) */
  warm: Rgb;
  yellow: Rgb;
  cool: Rgb;
  /** The core's strength — the page's ground shows through everywhere */
  strength: number;
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

/** The thermal ramp's yellow halfway out (heatmap.ts 'thermal-yellow' at 0.2) — the one ink the tokens do not carry */
export const THERMAL_YELLOW: Rgb = [254, 224, 144];
/** A resolved ink's channels, for the canvas — "rgb(r, g, b)" or "r g b" */
export const rgbOf = (s: string): Rgb => {
  const m = s.match(/\d+(?:\.\d+)?/g) ?? [];
  return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
};
/** The field's inks and its core's strength — what a host hands any primitive that paints the field */
export interface ThermalInks {
  warm: Rgb;
  yellow: Rgb;
  cool: Rgb;
  strength: number;
}

/** One slice of the field, in device pixels. x runs left to right; y grows downward. */
export interface ThermalSample {
  x: number;
  yHi2: number;
  yHi1: number;
  yMid: number;
  yLo1: number;
  yLo2: number;
}

/** Last raster, so a crosshair repaint blits instead of rebuilding the field. */
export interface ThermalCache {
  hash: number;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

const LUT_N = 256;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** Colour at a distance from the price, in expected-move units.
 *  0 sits on the price (warm). 0.5 is halfway to the move (yellow).
 *  1 is the move itself and is clear. Past that there is nothing. */
function colorAt(s: number, inks: ThermalInks): [number, number, number, number] {
  const { warm, yellow, cool, strength } = inks;
  const u = s < 0 ? 0 : s > 1 ? 1 : s;
  const fade = Math.cos(u * Math.PI * 0.5);
  const alpha = Math.round(255 * strength * fade);
  const rgb = u <= 0.5 ? mix(warm, yellow, smooth(u / 0.5)) : mix(yellow, cool, smooth((u - 0.5) / 0.5));
  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), alpha];
}

function buildLut(inks: ThermalInks): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) {
    const [r, g, b, a] = colorAt((i / (LUT_N - 1)) * 2, inks);
    const o = i * 4;
    lut[o] = r;
    lut[o + 1] = g;
    lut[o + 2] = b;
    lut[o + 3] = a;
  }
  return lut;
}

function hashSamples(samples: ThermalSample[], inks: ThermalInks, w: number, h: number): number {
  let hsh = Math.imul(samples.length ^ (w << 8) ^ h, 31) + ((inks.strength * 1000) | 0) + inks.warm[0] + inks.yellow[1] + inks.cool[2];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    hsh = Math.imul(hsh, 31) + (s.x * 4 | 0);
    hsh = Math.imul(hsh, 31) + (s.yHi2 * 4 | 0);
    hsh = Math.imul(hsh, 31) + (s.yHi1 * 4 | 0);
    hsh = Math.imul(hsh, 31) + (s.yMid * 4 | 0);
    hsh = Math.imul(hsh, 31) + (s.yLo1 * 4 | 0);
    hsh = Math.imul(hsh, 31) + (s.yLo2 * 4 | 0);
  }
  return hsh | 0;
}

/** Paint one band of a column: sigma runs from s0 at y0 to s1 at y1. */
function fillSpan(data: Uint8ClampedArray, bw: number, col: number, bh: number, y0: number, y1: number, s0: number, s1: number, lut: Uint8ClampedArray): void {
  const span = y1 - y0;
  if (!(Math.abs(span) > 0.25)) return;
  const yStart = Math.max(0, Math.ceil(Math.min(y0, y1)));
  const yEnd = Math.min(bh - 1, Math.floor(Math.max(y0, y1)));
  for (let y = yStart; y <= yEnd; y++) {
    const s = Math.abs(s0 + ((s1 - s0) * (y + 0.5 - y0)) / span);
    if (s >= 2) continue;
    const li = Math.min(LUT_N - 1, (s * 0.5 * (LUT_N - 1)) | 0);
    const o = (y * bw + col) * 4;
    const lo = li * 4;
    data[o] = lut[lo];
    data[o + 1] = lut[lo + 1];
    data[o + 2] = lut[lo + 2];
    data[o + 3] = lut[lo + 3];
  }
}

/**
 * Draw the field. Samples are the minute slices in device pixels; pixels
 * between them are lerped, so the cone's edge is a curve.
 */
export function drawThermalField(ctx: CanvasRenderingContext2D, samples: ThermalSample[], inks: ThermalInks, viewW: number, viewH: number, cache: { current: ThermalCache | null }): void {
  if (samples.length < 2 || !(viewW > 1) || !(viewH > 1)) return;
  const ordered = samples[0].x <= samples[samples.length - 1].x ? samples : samples.slice().sort((a, b) => a.x - b.x);
  const hash = hashSamples(ordered, inks, viewW | 0, viewH | 0);
  let stamp = cache.current;
  if (!stamp || stamp.hash !== hash) {
    let top = viewH;
    let bot = 0;
    let xLo = ordered[0].x;
    let xHi = ordered[0].x;
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i];
      if (s.x < xLo) xLo = s.x;
      if (s.x > xHi) xHi = s.x;
      const yTop = Math.min(s.yHi2, s.yLo2, s.yMid);
      const yBot = Math.max(s.yHi2, s.yLo2, s.yMid);
      if (yTop < top) top = yTop;
      if (yBot > bot) bot = yBot;
    }
    const x0 = Math.max(0, Math.floor(xLo));
    const x1 = Math.min(viewW, Math.ceil(xHi));
    const y0 = Math.max(0, Math.floor(top) - 1);
    const y1 = Math.min(viewH, Math.ceil(bot) + 1);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw < 2 || bh < 2) {
      cache.current = null;
      return;
    }
    const canvas = stamp?.canvas ?? document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    const sctx = canvas.getContext('2d');
    if (!sctx) return;
    const img = sctx.createImageData(bw, bh);
    const data = img.data;
    const lut = buildLut(inks);
    let k = 0;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5;
      while (k + 1 < ordered.length - 1 && ordered[k + 1].x <= px) k++;
      const a = ordered[k];
      const b = ordered[Math.min(ordered.length - 1, k + 1)];
      const span = b.x - a.x;
      const u = span > 0.001 ? Math.max(0, Math.min(1, (px - a.x) / span)) : 0;
      const lerp = (p: number, q: number) => p + (q - p) * u;
      const yHi2 = lerp(a.yHi2, b.yHi2) - y0;
      const yHi1 = lerp(a.yHi1, b.yHi1) - y0;
      const yMid = lerp(a.yMid, b.yMid) - y0;
      const yLo1 = lerp(a.yLo1, b.yLo1) - y0;
      const yLo2 = lerp(a.yLo2, b.yLo2) - y0;
      if (!(yLo2 > yHi2 + 0.5)) continue;
      const col = x - x0;
      fillSpan(data, bw, col, bh, yMid, yHi1, 0, 1, lut);
      fillSpan(data, bw, col, bh, yHi1, yHi2, 1, 2, lut);
      fillSpan(data, bw, col, bh, yMid, yLo1, 0, 1, lut);
      fillSpan(data, bw, col, bh, yLo1, yLo2, 1, 2, lut);
    }
    sctx.putImageData(img, 0, 0);
    stamp = { hash, canvas, x: x0, y: y0 };
    cache.current = stamp;
  }
  ctx.drawImage(stamp.canvas, stamp.x, stamp.y);
}

class ThermalFieldRenderer {
  private cache: { current: ThermalCache | null } = { current: null };
  constructor(private source: ThermalFieldPrimitive) {}

  draw(target: DrawTarget): void {
    const src = this.source;
    const chart = src.chart;
    const series = src.series;
    const data = src.data;
    if (!chart || !series || !data || data.points.length < 2) return;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const w = scope.mediaSize.width * hr;
      const h = scope.mediaSize.height * vr;
      const ts = chart.timeScale();
      const xOf = (min: number): number | null => {
        const x = ts.timeToCoordinate((data.dayStart + min * 60) as UTCTimestamp);
        return x === null ? null : x * hr;
      };
      const yOf = (price: number): number | null => {
        const y = series.priceToCoordinate(price);
        return y === null ? null : y * vr;
      };
      const samples: ThermalSample[] = [];
      for (let i = 0; i < data.points.length; i++) {
        const p = data.points[i];
        const x = xOf(p.min);
        const yHi2 = yOf(p.hi2);
        const yLo2 = yOf(p.lo2);
        const yHi1 = yOf(p.hi1);
        const yLo1 = yOf(p.lo1);
        const yMid = yOf(p.mid);
        if (x === null || yHi2 === null || yLo2 === null || yHi1 === null || yLo1 === null || yMid === null) continue;
        const prev = samples[samples.length - 1];
        if (prev && x <= prev.x) continue;
        samples.push({ x, yHi2, yHi1, yMid, yLo1, yLo2 });
      }
      ctx.save();
      drawThermalField(ctx, samples, data, w, h, this.cache);
      ctx.restore();
    });
  }
}

class ThermalFieldPaneView {
  private _renderer: ThermalFieldRenderer;
  constructor(source: ThermalFieldPrimitive) {
    this._renderer = new ThermalFieldRenderer(source);
  }
  /* under the price line and its levels — the field is the ground the day's path runs on */
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): ThermalFieldRenderer {
    return this._renderer;
  }
}

export class ThermalFieldPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Area'> | null = null;
  requestUpdate?: () => void;
  data: FieldData | null = null;
  private _paneViews: ThermalFieldPaneView[];

  constructor() {
    this._paneViews = [new ThermalFieldPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Area'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  updateAllViews(): void {}

  paneViews(): ThermalFieldPaneView[] {
    return this._paneViews;
  }

  /** Swap what is drawn. Off to off is skipped; anything else repaints. */
  setData(next: FieldData | null): void {
    const wasOff = this.data === null;
    this.data = next;
    if (!(wasOff && next === null)) this.requestUpdate?.();
  }
}
