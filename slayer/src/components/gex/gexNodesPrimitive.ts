import { MismatchDirection, type Logical, type ISeriesPrimitive, type SeriesAttachedParameter, type Time, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { GexSnapshot } from '../../types/market';
import { nySession } from '../../core/nyTime';
import { dealerOf } from '../../core/dealerSign';

/*
  The exposure field: one row per strike, as tall as the strike spacing, one column per chart bar, one colour per cell —
  that strike's dealer gamma at that time on the chosen expiries (data/book/exposureLog.ts builds the grid). Rows never
  overlap; a cell with no reading is left empty.

  The colour is a perceptual ramp on the cell's size against the field's own scale (the 98th percentile of every cell,
  so one freak print does not flatten the rest): dim navy for the quiet cells, rising through teal and green to yellow
  where dealers are long gamma (their hedging absorbs a move), and through violet and rose to amber where they are short
  it (their hedging pushes a move along). Small cells recede in alpha as well as in light.
*/

/* The two ramps, low to high: lightness rises monotonically along each */
const POS_STOPS: readonly (readonly [number, number, number])[] = [
  [24, 38, 66],
  [27, 84, 112],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];
const NEG_STOPS: readonly (readonly [number, number, number])[] = [
  [24, 38, 66],
  [74, 44, 120],
  [156, 47, 143],
  [232, 84, 63],
  [252, 166, 54],
];
/** Colour steps per side */
const STEPS = 32;
const rampAt = (stops: readonly (readonly [number, number, number])[], t: number): [number, number, number] => {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
};
/** A cell's alpha at strength t: quiet cells recede */
const alphaAt = (t: number): number => 0.14 + 0.62 * Math.pow(Math.max(0, Math.min(1, t)), 0.75);
const LUT: { pos: string[]; neg: string[]; posSolid: string[]; negSolid: string[] } = { pos: [], neg: [], posSolid: [], negSolid: [] };
for (let s = 0; s < STEPS; s++) {
  const t = (s + 0.5) / STEPS;
  const p = rampAt(POS_STOPS, t);
  const n = rampAt(NEG_STOPS, t);
  const al = alphaAt(t).toFixed(3);
  LUT.pos.push(`rgba(${p[0]},${p[1]},${p[2]},${al})`);
  LUT.neg.push(`rgba(${n[0]},${n[1]},${n[2]},${al})`);
  LUT.posSolid.push(`rgb(${p[0]},${p[1]},${p[2]})`);
  LUT.negSolid.push(`rgb(${n[0]},${n[1]},${n[2]})`);
}

/** The ramps as CSS gradients (the legend's scale) and their top inks: `put` is the long-gamma side (positive dealer
    gamma, absorbs), `call` the short-gamma side — names the cards and keys have always read */
export const FIELD_RAMP_CSS = {
  pos: `linear-gradient(90deg, ${POS_STOPS.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
  neg: `linear-gradient(90deg, ${NEG_STOPS.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
} as const;
const top = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const BEAD_INK_CSS = { put: top(POS_STOPS[3]), call: top(NEG_STOPS[3]) } as const;

/* The field's raster reaches this share of the pane past each side (x) and above and below (y), and is redrawn this long
   after the view last moved */
const RASTER_MX = 0.35;
const RASTER_MY = 0.25;
const SETTLE_MS = 120;

/** The cell under the pointer, as the card reads it */
export interface BeadHit {
  strike: number;
  /** the cell's bar time, and its column's index in the field */
  time: number;
  ci: number;
  /** the cell's dealer gamma, dollars per 1% (positive: dealers long gamma); its share of the column's gross; the strike's
      value at the day's first column on or after the open — null where the field holds none */
  value: number;
  share: number;
  open: number | null;
  /** the long-gamma side, and the cell's strength against the field's scale */
  put: boolean;
  t: number;
  mark?: 'born' | 'grew' | 'flipped' | 'died';
  tag?: 'rejected' | 'absorbed' | 'broke';
  firm?: boolean;
  /** the cell's centre and half-sizes on the pane, CSS px */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** The focused level's ink. Mirrors palette FOCUS/SUPREME. */
export type FocusInk = 'focus' | 'supreme';
const INK_RGB: Record<FocusInk, readonly [number, number, number]> = {
  focus: [199, 211, 232],
  supreme: [234, 0, 255],
};

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
  bitmapSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** Which exposure the field draws. Gamma is the grid's `value`; delta and vega ride beside it where a host hands them. */
export type TrailGreek = 'gex' | 'dex' | 'vex';
const levelValue = (l: GexSnapshot['levels'][number], greek: TrailGreek): number => (greek === 'gex' ? l.value : greek === 'dex' ? (l.dex ?? 0) : (l.vex ?? 0));

class FieldRenderer {
  constructor(private source: GexTrailsPrimitive) {}

  private cacheKey = '';
  /** The field, rasterized: a hover repaint blits this, and a pan or zoom maps it until the gesture rests */
  private bmp: HTMLCanvasElement | null = null;
  /* The raster's own frame, to map it onto a moved view */
  private rMx = 0;
  private rMy = 0;
  private rRev = -1;
  private rHr = 1;
  private rVr = 1;
  private rRefLogical = 0;
  private rXRef = 0;
  private rBar = 0;
  private rPrice = 0;
  private rYa = 0;
  private rYb = 0;
  private settle = 0;
  private rebuildNext = false;
  private movedAt = 0;

  /** One rebuild after the gesture stops. Re-arming during the gesture never paints. */
  private armSettle(src: GexTrailsPrimitive): void {
    this.movedAt = performance.now();
    if (this.settle) return;
    const wait = () => {
      if (performance.now() - this.movedAt < SETTLE_MS) {
        this.settle = requestAnimationFrame(wait);
        return;
      }
      this.settle = 0;
      this.cacheKey = '';
      /* the resting frame re-rasters, never maps the old raster again */
      this.rebuildNext = true;
      src.requestUpdate?.();
    };
    this.settle = requestAnimationFrame(wait);
  }

  draw(target: DrawTarget): void {
    this.drawField(target);
    this.source.afterDraw?.();
  }

  private drawField(target: DrawTarget): void {
    const src = this.source;
    src.chips = [];
    const cols = src.cols;
    if (!src.enabled || !src.chart || !src.series || cols.length === 0 || !(src.ref > 0)) return;
    const series = src.series;
    const ts = src.chart.timeScale();
    const vis = ts.getVisibleRange();
    if (!vis) return;
    const barSec = src.barSec;
    const fromT = Number(vis.from) - barSec * 2;
    const toT = Number(vis.to) + barSec * 2;
    const first = src.colIndexAtOrAfter(fromT);
    const last = src.colIndexAtOrAfter(toT + 1e-6); // exclusive
    if (last <= first) return;
    /* the raster's reach past the view, in bars through the logical range (a session gap does not shorten it) */
    const barSpacing = ts.options().barSpacing ?? 6;
    let rFirst = first;
    let rLast = last;
    const lr = ts.getVisibleLogicalRange();
    const paneW = src.chart.paneSize(0).width;
    if (lr && paneW > 0) {
      const mB = Math.ceil((paneW * RASTER_MX) / Math.max(0.5, barSpacing)) + 2;
      const at = (i: number, dir: MismatchDirection) => {
        const d = series.dataByIndex(i, dir);
        return d ? Number(d.time) : null;
      };
      const tL = at(Math.floor(lr.from) - mB, MismatchDirection.NearestRight);
      const tR = at(Math.ceil(lr.to) + mB, MismatchDirection.NearestLeft);
      rFirst = Math.min(first, src.colIndexAtOrAfter(Math.min(fromT, (tL ?? fromT) - barSec * 2)));
      rLast = Math.max(last, src.colIndexAtOrAfter(Math.max(toT, (tR ?? toT) + barSec * 2) + 1e-6));
    }
    const focus = src.focusStrike;
    const ink = INK_RGB[src.focusInk];
    const strikes = src.strikes;
    const R = strikes.length;
    const probeStrike = strikes[R >> 1] ?? 0;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const wCss = scope.mediaSize.width;
      const halfW = barSpacing * 0.5;

      const x0 = ts.timeToCoordinate(cols[first].time as Time);
      const probeA = series.priceToCoordinate(probeStrike) ?? -1;
      const probeB = series.priceToCoordinate(probeStrike + 1) ?? -1;
      const key = `${src.rev}|${wCss}|${scope.mediaSize.height}|${barSpacing.toFixed(3)}|${x0}|${first}|${last}|${probeA.toFixed(2)}|${probeB.toFixed(2)}|${hr}|${vr}|${focus}|${src.focusInk}`;
      const cached = key === this.cacheKey && !!this.bmp;
      /* A moved view maps the last raster: both axes are affine, so one drawImage puts every cell where this frame's
         scales want it, until the gesture rests (SETTLE_MS) or the view leaves the raster or the scale drifts too far */
      let scrolled = false;
      const bmp0 = this.bmp;
      if (!cached && !this.rebuildNext && bmp0 && this.rRev === src.rev && this.rHr === hr && this.rVr === vr && this.rBar > 0 && this.rYb !== this.rYa) {
        const xRef = ts.logicalToCoordinate(this.rRefLogical as Logical);
        const yA = series.priceToCoordinate(this.rPrice);
        const yB = series.priceToCoordinate(this.rPrice + 1);
        if (xRef !== null && yA !== null && yB !== null) {
          this.movedAt = performance.now();
          const sx = barSpacing / this.rBar;
          const sy = (yB - yA) / (this.rYb - this.rYa);
          const dX = (xRef + sx * (-this.rMx / hr - this.rXRef)) * hr;
          const dY = (yA + sy * (-this.rMy / vr - this.rYa)) * vr;
          const dW = bmp0.width * sx;
          const dH = bmp0.height * sy;
          const covers = dX <= 0.5 && dX + dW >= scope.bitmapSize.width - 0.5 && dY <= 0.5 && dY + dH >= scope.bitmapSize.height - 0.5;
          if (covers && sx > 0.5 && sx < 2.5 && sy > 0.5 && sy < 2) {
            ctx.drawImage(bmp0, dX, dY, dW, dH);
            scrolled = true;
            this.armSettle(src);
          }
        }
      }

      if (!cached && !scrolled) {
        /* margins only while the view moves (or right after it rests) */
        const wide = this.rebuildNext || performance.now() - this.movedAt < SETTLE_MS;
        const mxPx = wide ? Math.round(scope.bitmapSize.width * RASTER_MX) : 0;
        const myPx = wide ? Math.round(scope.bitmapSize.height * RASTER_MY) : 0;
        const mxCss = mxPx / hr;
        const cFrom = wide ? rFirst : first;
        const cTo = wide ? rLast : last;
        /* each row's edges: half way to the neighbouring strikes, the outer rows as tall as their neighbour's step */
        const edgeY = new Float64Array(R + 1);
        for (let r = 0; r <= R; r++) {
          const lo = r === 0 ? strikes[0] - (R > 1 ? (strikes[1] - strikes[0]) / 2 : 0.5) : (strikes[r - 1] + strikes[r]) / 2;
          const y = series.priceToCoordinate(r === R ? strikes[R - 1] + (R > 1 ? (strikes[R - 1] - strikes[R - 2]) / 2 : 0.5) : lo);
          edgeY[r] = y === null ? NaN : y * vr;
        }
        const hBmp = scope.bitmapSize.height;
        /* one path per ink step and side, cells of a row merged across touching bars of the same step */
        const paths = new Map<number, Path2D>();
        const pathFor = (k: number) => {
          let p = paths.get(k);
          if (!p) paths.set(k, (p = new Path2D()));
          return p;
        };
        const xl = new Float64Array(cTo - cFrom);
        const xr = new Float64Array(cTo - cFrom);
        for (let c = cFrom; c < cTo; c++) {
          const x = ts.timeToCoordinate(cols[c].time as Time);
          if (x === null || x < -halfW - mxCss || x > wCss + halfW + mxCss) {
            xl[c - cFrom] = NaN;
            continue;
          }
          xl[c - cFrom] = Math.round((x - halfW) * hr);
          xr[c - cFrom] = Math.round((x + halfW) * hr);
        }
        const vals = src.values;
        const ref = src.ref;
        for (let r = 0; r < R; r++) {
          const ya = edgeY[r];
          const yb = edgeY[r + 1];
          if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
          let yTop = Math.min(ya, yb);
          let yBot = Math.max(ya, yb);
          if (yBot < -myPx || yTop > hBmp + myPx) continue;
          /* a hairline between rows once they are tall enough to spare it */
          const h = yBot - yTop;
          if (h > 5 * vr) yTop += Math.max(1, Math.round(0.6 * vr));
          yTop = Math.round(yTop);
          yBot = Math.round(yBot);
          if (yBot - yTop < 1) yBot = yTop + 1;
          const dim = focus != null && strikes[r] !== focus;
          let runKey = -1;
          let runL = 0;
          let runR = 0;
          const flush = () => {
            if (runKey >= 0) pathFor(runKey).rect(runL, yTop, runR - runL, yBot - yTop);
            runKey = -1;
          };
          for (let c = cFrom; c < cTo; c++) {
            const L = xl[c - cFrom];
            const v = vals[c * R + r];
            if (Number.isNaN(L) || Number.isNaN(v) || v === 0) {
              flush();
              continue;
            }
            const tt = Math.min(1, Math.abs(v) / ref);
            const step = Math.min(STEPS - 1, Math.floor(tt * STEPS));
            const k = (v > 0 ? 0 : 1) * 1000 + step + (dim ? 100 : 0);
            const Rr = xr[c - cFrom];
            if (k === runKey && Math.abs(L - runR) <= 1) {
              runR = Rr;
              continue;
            }
            flush();
            runKey = k;
            runL = L;
            runR = Rr;
          }
          flush();
        }
        const bw = scope.bitmapSize.width + 2 * mxPx;
        const bh = scope.bitmapSize.height + 2 * myPx;
        const bmp = this.bmp ?? document.createElement('canvas');
        if (bmp.width !== bw || bmp.height !== bh) {
          bmp.width = bw;
          bmp.height = bh;
        }
        const bctx = bmp.getContext('2d');
        if (bctx) {
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.clearRect(0, 0, bw, bh);
          bctx.setTransform(1, 0, 0, 1, mxPx, myPx);
          for (const [k, path] of paths) {
            const step = k % 100;
            const side = Math.floor(k / 1000) === 0 ? LUT.pos : LUT.neg;
            bctx.globalAlpha = k % 1000 >= 100 ? 0.4 : 1;
            bctx.fillStyle = side[step];
            bctx.fill(path);
          }
          bctx.globalAlpha = 1;
          /* the focused strike's row, outlined across the field */
          if (focus != null) {
            const r = strikes.indexOf(focus);
            if (r >= 0 && Number.isFinite(edgeY[r]) && Number.isFinite(edgeY[r + 1])) {
              bctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.9)`;
              const lw = Math.max(1, Math.round(vr));
              bctx.fillRect(-mxPx, Math.round(Math.min(edgeY[r], edgeY[r + 1])), bw, lw);
              bctx.fillRect(-mxPx, Math.round(Math.max(edgeY[r], edgeY[r + 1])) - lw, bw, lw);
            }
          }
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          this.bmp = bmp;
          this.cacheKey = key;
          this.rebuildNext = false;
          this.rMx = mxPx;
          this.rMy = myPx;
          this.rRev = src.rev;
          this.rHr = hr;
          this.rVr = vr;
          this.rRefLogical = ts.coordinateToLogical(wCss / 2) ?? 0;
          this.rXRef = ts.logicalToCoordinate(this.rRefLogical as Logical) ?? wCss / 2;
          this.rBar = barSpacing;
          this.rPrice = probeStrike;
          this.rYa = probeA;
          this.rYb = probeB;
          if (this.settle) {
            cancelAnimationFrame(this.settle);
            this.settle = 0;
          }
        }
      }
      if (!scrolled && this.bmp) ctx.drawImage(this.bmp, -this.rMx, -this.rMy);
    });
  }
}

class FieldPaneView {
  private _renderer: FieldRenderer;
  constructor(source: GexTrailsPrimitive) {
    this._renderer = new FieldRenderer(source);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): FieldRenderer {
    return this._renderer;
  }
}

export class GexTrailsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  /** The columns as handed in (one a bar, the last reading of each bar kept) */
  snapshots: GexSnapshot[] = [];
  /** The columns' bar times, and the dense grid: values[col * strikes.length + row], dealer sign, NaN = no reading */
  cols: { time: number }[] = [];
  strikes: number[] = [];
  values: Float64Array = new Float64Array(0);
  maxAbs = 1;
  /** The field's scale: the 98th percentile of every cell's size — the size a cell is drawn at full light */
  ref = 0;
  restRef = 0;
  enabled = true;
  /** The chart's bar length, seconds — a column finds its bar by it */
  barSec = 60;
  /** Kept for the hosts that set it: the field prints no labels of its own */
  labelPx = 9.5;
  chromeInset = 0;
  stepSec = 60;
  focusStrike: number | null = null;
  focusInk: FocusInk = 'focus';
  supremeStrike: number | null = null;
  cwStrike: number | null = null;
  pwStrike: number | null = null;
  flipPrice: number | null = null;
  /** Strike chips at the right edge this frame — none: the key levels' ladder names the levels */
  chips: { strike: number; left: number; top: number; bottom: number }[] = [];
  private _paneViews: FieldPaneView[];
  hover: BeadHit | null = null;
  ringInk: readonly [number, number, number] = [255, 255, 255];
  /** Told after every data hand-off, with the scale the cells stand against — the host's legend */
  onData?: (ref: number) => void;
  /** Bumped on every data hand-off — the raster's cache keys on it */
  rev = 0;
  greek: TrailGreek = 'gex';
  hoverOverlay = false;
  afterDraw: (() => void) | null = null;

  constructor() {
    this._paneViews = [new FieldPaneView(this)];
  }

  valueOf(l: GexSnapshot['levels'][number]): number {
    return levelValue(l, this.greek);
  }

  /** The first column at or after time t (seconds) */
  colIndexAtOrAfter(t: number): number {
    const cols = this.cols;
    let lo = 0;
    let hi = cols.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cols[m].time < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /** The row holding a price: half way to each neighbouring strike, or -1 off the field */
  rowAt(price: number): number {
    const s = this.strikes;
    const R = s.length;
    if (!R) return -1;
    let lo = 0;
    let hi = R;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < price) lo = m + 1;
      else hi = m;
    }
    const cand = [lo - 1, lo].filter(i => i >= 0 && i < R);
    let best = -1;
    let bestD = Infinity;
    for (const i of cand) {
      const d = Math.abs(s[i] - price);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    const step = R > 1 ? (best === 0 ? s[1] - s[0] : best === R - 1 ? s[R - 1] - s[R - 2] : Math.min(s[best] - s[best - 1], s[best + 1] - s[best])) : 1;
    return bestD <= step / 2 + 1e-9 ? best : -1;
  }

  /** A cell's dealer value, NaN where it has no reading */
  cell(ci: number, row: number): number {
    if (ci < 0 || ci >= this.cols.length || row < 0 || row >= this.strikes.length) return NaN;
    return this.values[ci * this.strikes.length + row];
  }

  setHover(hit: BeadHit | null): void {
    const was = this.hover;
    if (was === hit || (was && hit && was.strike === hit.strike && was.time === hit.time)) {
      this.hover = hit;
      return;
    }
    this.hover = hit;
    if (this.hoverOverlay) this.afterDraw?.();
    else this.requestUpdate?.();
  }

  setRingInk(rgb: readonly [number, number, number]): void {
    if (this.ringInk[0] === rgb[0] && this.ringInk[1] === rgb[1] && this.ringInk[2] === rgb[2]) return;
    this.ringInk = rgb;
    if (this.hover && this.hoverOverlay) this.afterDraw?.();
  }

  /** The hovered cell for the host's overlay canvas: its rectangle at full light, ringed in the page's ink */
  hoverShape(): { x: number; y: number; rx: number; ry: number; fill: string; ring: string; rect: true } | null {
    const hover = this.hover;
    if (!hover || !this.enabled || !this.chart || !this.series) return null;
    const geo = this.cellGeom(hover.ci, this.strikes.indexOf(hover.strike));
    if (!geo) return null;
    const v = this.cell(hover.ci, this.strikes.indexOf(hover.strike));
    if (Number.isNaN(v)) return null;
    const step = Math.min(STEPS - 1, Math.floor(Math.min(1, Math.abs(v) / (this.ref || 1)) * STEPS));
    const r = this.ringInk;
    return { ...geo, fill: v > 0 ? LUT.posSolid[step] : LUT.negSolid[step], ring: `rgba(${r[0]},${r[1]},${r[2]},0.95)`, rect: true };
  }

  /** A cell's centre and half-sizes on the pane, CSS px */
  private cellGeom(ci: number, row: number): { x: number; y: number; rx: number; ry: number } | null {
    if (!this.chart || !this.series || row < 0 || ci < 0 || ci >= this.cols.length) return null;
    const ts = this.chart.timeScale();
    const x = ts.timeToCoordinate(this.cols[ci].time as Time);
    const s = this.strikes;
    const R = s.length;
    const lo = row === 0 ? s[0] - (R > 1 ? (s[1] - s[0]) / 2 : 0.5) : (s[row - 1] + s[row]) / 2;
    const hi = row === R - 1 ? s[R - 1] + (R > 1 ? (s[R - 1] - s[R - 2]) / 2 : 0.5) : (s[row] + s[row + 1]) / 2;
    const ya = this.series.priceToCoordinate(lo);
    const yb = this.series.priceToCoordinate(hi);
    if (x === null || ya === null || yb === null) return null;
    const half = (ts.options().barSpacing ?? 6) / 2;
    return { x, y: (ya + yb) / 2, rx: half, ry: Math.max(1, Math.abs(ya - yb) / 2) };
  }

  /** The chart's ground, as channels */
  groundRgb(): readonly [number, number, number] {
    const bg = this.chart?.options().layout.background as { color?: string; topColor?: string } | undefined;
    const css = bg?.color ?? bg?.topColor ?? '#0a0a0a';
    const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
    const m = css.match(/\d+(?:\.\d+)?/g) ?? [];
    return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
  }

  /** The cell under a point on the pane (CSS px), or null: the bar under x, the strike row under y, a cell with a reading */
  beadAt(x: number, y: number): BeadHit | null {
    if (!this.enabled || !this.chart || !this.series || !this.cols.length || !(this.ref > 0)) return null;
    if (y < this.chromeInset) return null;
    const ts = this.chart.timeScale();
    const logical = ts.coordinateToLogical(x);
    if (logical === null) return null;
    const bar = this.series.dataByIndex(Math.round(logical), MismatchDirection.None);
    if (!bar) return null;
    const ci = this.colIndexAtOrAfter(Number(bar.time));
    if (ci >= this.cols.length || this.cols[ci].time !== Number(bar.time)) return null;
    const price = this.series.coordinateToPrice(y);
    if (price === null) return null;
    const row = this.rowAt(price);
    const v = this.cell(ci, row);
    if (Number.isNaN(v) || v === 0) return null;
    const geo = this.cellGeom(ci, row);
    if (!geo) return null;
    let total = 0;
    const R = this.strikes.length;
    for (let r = 0; r < R; r++) {
      const w = this.values[ci * R + r];
      if (!Number.isNaN(w)) total += Math.abs(w);
    }
    return { strike: this.strikes[row], time: this.cols[ci].time, ci, value: v, share: total > 0 ? Math.abs(v) / total : 0, open: this.openValue(ci, this.strikes[row]), put: v > 0, t: Math.min(1, Math.abs(v) / this.ref), ...geo };
  }

  /** The strike's value at its day's first column on or after the New York open — null where the field holds none */
  openValue(ci: number, strike: number): number | null {
    const at = this.cols[ci];
    if (!at) return null;
    const open = nySession(at.time * 1000).open / 1000;
    if (at.time < open) return null;
    const first = this.colIndexAtOrAfter(open);
    if (first > ci) return null;
    const v = this.cell(first, this.strikes.indexOf(strike));
    return Number.isNaN(v) ? null : v;
  }

  /** The strike's standing at a column: its rank by size among the column's cells, of how many */
  rankAt(ci: number, strike: number): { rank: number; of: number } | null {
    const row = this.strikes.indexOf(strike);
    const v = this.cell(ci, row);
    if (Number.isNaN(v)) return null;
    const a = Math.abs(v);
    let rank = 1;
    let of = 0;
    const R = this.strikes.length;
    for (let r = 0; r < R; r++) {
      const w = this.values[ci * R + r];
      if (Number.isNaN(w)) continue;
      of++;
      if (Math.abs(w) > a) rank++;
    }
    return { rank, of };
  }

  /** The strike's value `seconds` before a column, from the nearest column with a reading at or before then */
  valueBefore(ci: number, strike: number, seconds: number): { value: number; time: number } | null {
    const at = this.cols[ci];
    if (!at) return null;
    const row = this.strikes.indexOf(strike);
    let i = this.colIndexAtOrAfter(at.time - seconds + 1e-6) - 1;
    if (i < 0) return null;
    if (this.cols[i].time < at.time - seconds - Math.max(this.barSec, 60)) return null;
    const v = this.cell(i, row);
    return Number.isNaN(v) ? null : { value: v, time: this.cols[i].time };
  }

  setSupreme(strike: number | null): void {
    this.supremeStrike = strike;
  }

  setWalls(cw: number | null, pw: number | null, flip: number | null): void {
    this.cwStrike = cw;
    this.pwStrike = pw;
    this.flipPrice = flip;
  }

  setFocus(strike: number | null, ink: FocusInk = 'focus'): void {
    if (this.focusStrike === strike && this.focusInk === ink) return;
    this.focusStrike = strike;
    this.focusInk = ink;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  updateAllViews(): void {}

  paneViews(): FieldPaneView[] {
    return this._paneViews;
  }

  /**
   * The columns (house sign, as the book keeps every figure), the chart's bar length and the greek. Columns are folded to
   * the chart's bars, the last of each bar kept (a level reads its last reading inside the bar). The trailing arguments
   * are kept for the hosts' call shape.
   */
  setData(snapshots: GexSnapshot[], maxAbs: number, enabled: boolean, barSec = 60, greek: TrailGreek = 'gex', _scaleTo = 0, _behind: GexSnapshot[] = [], prices: readonly { time: number; close: number }[] = []): void {
    this.rev++;
    this.greek = greek;
    this.barSec = barSec;
    this.maxAbs = maxAbs;
    this.enabled = enabled;
    const lastPx = prices.length ? prices[prices.length - 1].time + barSec : Infinity;
    const folded: GexSnapshot[] = [];
    /* each column onto its own bar: the last bar starting at or before it (the chart's bars need not sit on round times) */
    const barOf = (t: number): number => {
      if (!prices.length) return barSec >= 86_400 ? t : Math.floor(t / barSec) * barSec;
      let lo = 0;
      let hi = prices.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (prices[m].time <= t) lo = m + 1;
        else hi = m;
      }
      return lo > 0 ? prices[lo - 1].time : Math.floor(t / barSec) * barSec;
    };
    for (const s of snapshots) {
      if (s.time > lastPx) continue;
      const bucket = barOf(s.time);
      const prev = folded[folded.length - 1];
      if (prev && prev.time === bucket) folded[folded.length - 1] = { time: bucket, levels: s.levels };
      else folded.push({ time: bucket, levels: s.levels });
    }
    this.snapshots = folded;
    const strikeSet = new Set<number>();
    for (const s of folded) for (const l of s.levels) strikeSet.add(l.strike);
    const strikes = [...strikeSet].sort((a, b) => a - b);
    const index = new Map(strikes.map((k, i) => [k, i]));
    const R = strikes.length;
    const values = new Float64Array(folded.length * R).fill(NaN);
    const sizes: number[] = [];
    for (let c = 0; c < folded.length; c++) {
      for (const l of folded[c].levels) {
        const v = dealerOf(levelValue(l, greek));
        values[c * R + index.get(l.strike)!] = v;
        if (v !== 0) sizes.push(Math.abs(v));
      }
    }
    sizes.sort((a, b) => a - b);
    this.ref = sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.98))] : 0;
    this.cols = folded.map(s => ({ time: s.time }));
    this.strikes = strikes;
    this.values = values;
    if (this.hover && (this.hover.ci >= folded.length || this.cols[this.hover.ci]?.time !== this.hover.time)) this.hover = null;
    this.requestUpdate?.();
    this.onData?.(enabled ? this.ref : 0);
  }
}
