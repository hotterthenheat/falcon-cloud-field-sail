import type { ISeriesPrimitive, SeriesAttachedParameter, Time, IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ExpectedMoveCone } from '../../data/expectedMove';

/*
  The forward cone — from the last bar over the rest of today's session and the next one (data/terrainCone.ts). A faint
  fan fills ±2σ and ±1σ, the 1σ curves are solid and the 2σ curves dashed, and the host's marks name the curves' ends
  (and today's close) with their prices. The hover reads the cone at the pointer.
*/

const INK = '255,255,255';

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** What a pointer inside the cone can read. Prices are the cone's own. */
export interface ConeHit {
  horizon: string;
  iv: number;
  minutes: number;
  source: string;
  spot: number;
  up1: number;
  dn1: number;
  up2: number;
  dn2: number;
  band: 1 | 2;
}

interface ConeGeom {
  pts: { x: number; up1: number; dn1: number; up2: number; dn2: number; pUp1: number; pDn1: number; pUp2: number; pDn2: number; minutes: number }[];
  spot: number;
  tipUp1: number;
  tipDn1: number;
  tipUp2: number;
  tipDn2: number;
  horizon: string;
  iv: number;
  minutes: number;
  source: string;
}

/** A labelled point on the cone: where a curve ends (or crosses today's close), named with its price */
export interface ConeMark {
  minutesAhead: number;
  price: number;
  text: string;
  /** 1σ marks draw brighter than 2σ marks */
  strong?: boolean;
}

export interface ConeData {
  cone: ExpectedMoveCone;
  marks?: ConeMark[];
  /** Print the marks' words beside their dots (off where the key levels name the same prices at the edge) */
  markWords?: boolean;
  barTimes: number[];
  barMinutes: number;
  anchor?: number;
  legend?: string;
  oddsName?: string;
  iv?: number;
  source?: string;
}

class ExpectedMoveRenderer {
  constructor(private source: ExpectedMovePrimitive) {}

  /* The cone is drawn once into its own bitmap, from its anchor rightward, and blitted at the anchor's x: a pan moves the
     anchor only, so the frame is one drawImage until the bar spacing, the price scale, the size or the data change. */
  private cache: { key: string; canvas: HTMLCanvasElement; pad: number; width: number } | null = null;
  /** When the bitmap was last rebuilt: a view still changing (a zoom) is drawn straight, not rebuilt every frame */
  private builtAt = 0;

  draw(target: DrawTarget): void {
    const src = this.source;
    const chart = src.chart;
    const series = src.series;
    const data = src.data;
    if (!chart || !series || !data || data.cone.forward.length < 2) {
      src.geom = null;
      return;
    }
    const { cone, barMinutes } = data;
    const fw = cone.forward;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const w = scope.mediaSize.width * hr;
      const h = scope.mediaSize.height * vr;
      const ts = chart.timeScale();
      const barTimes = data.barTimes;
      /* both axes are affine: two probes each place every point */
      const anchor = Math.max(0, Math.min(barTimes.length - 1, data.anchor ?? barTimes.length - 1));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xa = ts.logicalToCoordinate(anchor as any);
      let xb = ts.logicalToCoordinate((anchor + 1) as any);
      if (xa !== null && (xb === null || xb === xa)) {
        const spacing = ts.options().barSpacing ?? 6;
        xb = ((xa as number) + spacing) as typeof xa;
      }
      const base = fw[0].up1;
      const ya = series.priceToCoordinate(base);
      const yb = series.priceToCoordinate(base + 1);
      if (xa === null || xb === null || ya === null || yb === null || xb === xa) {
        src.geom = null;
        return;
      }
      const px = (xb - xa) * hr;
      const py = (yb - ya) * vr;
      const x0 = xa * hr;
      const y0 = ya * vr;
      const yOf = (price: number) => y0 + (price - base) * py;
      /* the points, x from the anchor: no more than a point a pixel and a half, and no further than three panes on */
      const reachMax = 3 * w;
      const minStep = Math.max(1, 1.5 * hr);
      const pts: ConeGeom['pts'] = [];
      for (let i = 0; i < fw.length; i++) {
        const p = fw[i];
        const x = (p.minutesAhead / barMinutes) * px;
        const prev = pts[pts.length - 1];
        const last = i === fw.length - 1;
        if (prev && (x <= prev.x || (!last && x - prev.x < minStep))) continue;
        pts.push({ x, up1: yOf(p.up1), dn1: yOf(p.dn1), up2: yOf(p.up2), dn2: yOf(p.dn2), pUp1: p.up1, pDn1: p.dn1, pUp2: p.up2, pDn2: p.dn2, minutes: p.minutesAhead });
        if (x > reachMax) break;
      }
      const tip = fw[fw.length - 1];
      src.geom =
        pts.length >= 2
          ? {
              pts: pts.map(p => ({ x: (p.x + x0) / hr, up1: p.up1 / vr, dn1: p.dn1 / vr, up2: p.up2 / vr, dn2: p.dn2 / vr, pUp1: p.pUp1, pDn1: p.pDn1, pUp2: p.pUp2, pDn2: p.pDn2, minutes: p.minutes })),
              spot: base,
              tipUp1: tip.up1,
              tipDn1: tip.dn1,
              tipUp2: tip.up2,
              tipDn2: tip.dn2,
              horizon: data.oddsName ?? 'Session',
              iv: data.iv ?? 0,
              minutes: tip.minutesAhead,
              source: data.source ?? '',
            }
          : null;
      if (pts.length < 2) return;
      /* the cone left of the pane's right edge is all that is ever shown; the bitmap is rebuilt once a pan uncovers more */
      const pad = Math.round(4 * hr);
      const extent = Math.min(pts[pts.length - 1].x, reachMax);
      const key = `${src.rev}|${px.toFixed(4)}|${py.toFixed(4)}|${y0.toFixed(2)}|${Math.round(w)}|${Math.round(h)}|${hr}|${vr}`;
      let cache = this.cache;
      const at = (m: ConeMark) => ({ x: (m.minutesAhead / barMinutes) * px, y: yOf(m.price) });
      if (!cache || cache.key !== key || x0 + cache.width < w - pad) {
        const now = performance.now();
        if (cache && now - this.builtAt < 150) {
          /* rebuilt a moment ago and changed again: draw this frame straight */
          this.builtAt = now;
          ctx.save();
          ctx.translate(Math.round(x0), 0);
          this.paint(ctx, pts, data, hr, vr, at, h);
          ctx.restore();
          this.cache = { ...cache, key: '' };
          return;
        }
        this.builtAt = now;
        /* the bitmap only grows (in steps), so a changing cone does not reallocate it */
        const cw = Math.max(1, Math.ceil(extent + 2 * pad));
        const ch = Math.max(1, Math.round(h));
        const canvas = cache?.canvas ?? document.createElement('canvas');
        if (canvas.width < cw || canvas.height !== ch) {
          canvas.width = Math.ceil(cw / 256) * 256;
          canvas.height = ch;
        }
        const g = canvas.getContext('2d');
        if (!g) return;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.setTransform(1, 0, 0, 1, pad, 0);
        this.paint(g, pts, data, hr, vr, at, ch);
        cache = { key, canvas, pad, width: cw - pad };
        this.cache = cache;
      }
      ctx.drawImage(cache.canvas, Math.round(x0 - cache.pad), 0);
    });
  }

  private paint(ctx: CanvasRenderingContext2D, pts: ConeGeom['pts'], data: ConeData, hr: number, vr: number, at: (m: ConeMark) => { x: number; y: number }, h: number): void {
    /* the fan: the 2σ ring and the 1σ band, each pixel filled once (the ring is the 2σ shape less the 1σ, even-odd) */
    const outline = (path: Path2D, pickHi: (p: ConeGeom['pts'][number]) => number, pickLo: (p: ConeGeom['pts'][number]) => number) => {
      path.moveTo(pts[0].x, pickHi(pts[0]));
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pickHi(pts[i]));
      for (let i = pts.length - 1; i >= 0; i--) path.lineTo(pts[i].x, pickLo(pts[i]));
      path.closePath();
    };
    const ring = new Path2D();
    outline(ring, p => p.up2, p => p.dn2);
    outline(ring, p => p.up1, p => p.dn1);
    ctx.fillStyle = `rgba(${INK},0.03)`;
    ctx.fill(ring, 'evenodd');
    const band = new Path2D();
    outline(band, p => p.up1, p => p.dn1);
    ctx.fillStyle = `rgba(${INK},0.065)`;
    ctx.fill(band);
    const stroke = (pick: (p: ConeGeom['pts'][number]) => number, alpha: number, dashed: boolean, width: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pick(pts[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pick(pts[i]));
      ctx.strokeStyle = `rgba(${INK},${alpha})`;
      ctx.lineWidth = Math.max(1, width * vr);
      ctx.lineJoin = 'round';
      ctx.setLineDash(dashed ? [4 * hr, 4 * hr] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    stroke(p => p.up2, 0.32, true, 1);
    stroke(p => p.dn2, 0.32, true, 1);
    stroke(p => p.up1, 0.78, false, 1.25);
    stroke(p => p.dn1, 0.78, false, 1.25);

    /* the marks: a dot on the curve, and its words beside it where the key levels do not name it */
    const marks = data.marks ?? [];
    if (!marks.length) return;
    ctx.font = `${Math.round(9.5 * vr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    const boxH = 14 * vr;
    const placed: { x: number; y: number; ty: number; w: number; m: ConeMark }[] = [];
    for (const m of marks) {
      const { x, y } = at(m);
      if (y < 0 || y > h) continue;
      placed.push({ x, y, ty: y, w: ctx.measureText(m.text).width + 8 * hr, m });
    }
    placed.sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1];
      const cur = placed[i];
      const sideBySide = Math.abs(prev.x - cur.x) < Math.max(prev.w, cur.w);
      if (sideBySide && cur.ty - prev.ty < boxH + 2 * vr) cur.ty = prev.ty + boxH + 2 * vr;
    }
    for (const p of placed) {
      const a = p.m.strong ? 0.95 : 0.7;
      ctx.fillStyle = `rgba(${INK},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 * vr, 0, Math.PI * 2);
      ctx.fill();
      if (!data.markWords) continue;
      /* the words sit left of the dot */
      const right = p.x - 6 * hr;
      const left = Math.max(0, right - p.w);
      const ty = Math.max(boxH / 2, Math.min(h - boxH / 2, p.ty));
      ctx.fillStyle = 'rgba(10,10,10,0.72)';
      ctx.fillRect(left, ty - boxH / 2, p.w, boxH);
      ctx.fillStyle = `rgba(${INK},${a})`;
      ctx.textAlign = 'left';
      ctx.fillText(p.m.text, left + 4 * hr, ty);
      if (Math.abs(ty - p.y) > 2 * vr) {
        ctx.strokeStyle = `rgba(${INK},0.35)`;
        ctx.lineWidth = Math.max(1, vr * 0.75);
        ctx.beginPath();
        ctx.moveTo(right, ty);
        ctx.lineTo(p.x - 2 * hr, p.y);
        ctx.stroke();
      }
    }
  }
}

class ExpectedMovePaneView {
  private _renderer: ExpectedMoveRenderer;
  constructor(source: ExpectedMovePrimitive) {
    this._renderer = new ExpectedMoveRenderer(source);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): ExpectedMoveRenderer {
    return this._renderer;
  }
}

export class ExpectedMovePrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  data: ConeData | null = null;
  geom: ConeGeom | null = null;
  private _paneViews: ExpectedMovePaneView[];

  constructor() {
    this._paneViews = [new ExpectedMovePaneView(this)];
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
    this.geom = null;
  }

  updateAllViews(): void {}

  paneViews(): ExpectedMovePaneView[] {
    return this._paneViews;
  }

  /** Kept so older hosts compile. The wedge does not take a thermal ramp. */
  setInks(_next: unknown): void {}

  /** Bumped on every hand-off — the renderer's bitmap keys on it */
  rev = 0;

  setData(next: ConeData | null): void {
    const wasOff = this.data === null;
    this.data = next;
    this.rev++;
    if (!next) this.geom = null;
    if (!(wasOff && next === null)) this.requestUpdate?.();
  }

  /** CSS px on the pane. Null when the pointer is outside ±2σ. */
  probe(x: number, y: number): ConeHit | null {
    const g = this.geom;
    if (!g || g.pts.length < 2) return null;
    const pts = g.pts;
    if (x < pts[0].x || x > pts[pts.length - 1].x) return null;
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1].x < x) i++;
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const u = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
    const lerp = (p: number, q: number) => p + (q - p) * u;
    const up1 = lerp(a.pUp1, b.pUp1);
    const dn1 = lerp(a.pDn1, b.pDn1);
    const up2 = lerp(a.pUp2, b.pUp2);
    const dn2 = lerp(a.pDn2, b.pDn2);
    const y1 = lerp(a.up1, b.up1);
    const y1b = lerp(a.dn1, b.dn1);
    const y2 = lerp(a.up2, b.up2);
    const y2b = lerp(a.dn2, b.dn2);
    const top = Math.min(y2, y2b);
    const bot = Math.max(y2, y2b);
    if (y < top || y > bot) return null;
    const innerTop = Math.min(y1, y1b);
    const innerBot = Math.max(y1, y1b);
    const minutes = lerp(a.minutes, b.minutes);
    return {
      horizon: g.horizon,
      iv: g.iv,
      minutes: Math.max(0, g.minutes - minutes),
      source: g.source,
      spot: g.spot,
      up1,
      dn1,
      up2,
      dn2,
      band: y >= innerTop && y <= innerBot ? 1 : 2,
    };
  }
}
