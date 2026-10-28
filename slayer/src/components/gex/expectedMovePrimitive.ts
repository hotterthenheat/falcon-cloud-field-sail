import type { ISeriesPrimitive, SeriesAttachedParameter, Time, IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ExpectedMoveCone } from '../../data/expectedMove';

/*
  Expected move — a wedge from the last bar to the horizon.
  ±1σ is the fill. ±2σ is the quieter outer line.
  Nothing else is painted on the tape. The numbers live on the hover.
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
  pts: { x: number; up1: number; dn1: number; up2: number; dn2: number }[];
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

export interface ConeData {
  cone: ExpectedMoveCone;
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

  draw(target: DrawTarget): void {
    const src = this.source;
    const chart = src.chart;
    const series = src.series;
    const data = src.data;
    if (!chart || !series || !data) {
      src.geom = null;
      return;
    }
    const { cone, barMinutes } = data;
    const fw = cone.forward;
    if (fw.length < 2) {
      src.geom = null;
      return;
    }

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const w = scope.mediaSize.width * hr;
      const h = scope.mediaSize.height * vr;
      const ts = chart.timeScale();
      const barTimes = data.barTimes;

      const logicalToX = (logical: number): number | null => {
        const lo = Math.floor(logical);
        const frac = logical - lo;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const x0 = ts.logicalToCoordinate(lo as any);
        if (x0 === null) return null;
        if (frac === 0) return x0 * hr;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const x1 = ts.logicalToCoordinate((lo + 1) as any);
        if (x1 === null) return x0 * hr;
        return (x0 + (x1 - x0) * frac) * hr;
      };
      const priceToY = (price: number): number | null => {
        const y = series.priceToCoordinate(price);
        return y === null ? null : y * vr;
      };

      const anchor = Math.max(0, Math.min(barTimes.length - 1, data.anchor ?? barTimes.length - 1));
      const pts: ConeGeom['pts'] = [];
      for (const p of fw) {
        const x = logicalToX(anchor + p.minutesAhead / barMinutes);
        const up1 = priceToY(p.up1);
        const dn1 = priceToY(p.dn1);
        const up2 = priceToY(p.up2);
        const dn2 = priceToY(p.dn2);
        if (x === null || up1 === null || dn1 === null || up2 === null || dn2 === null) continue;
        const prev = pts[pts.length - 1];
        if (prev && x <= prev.x) continue;
        pts.push({ x, up1, dn1, up2, dn2 });
      }
      const tip = fw[fw.length - 1];
      const spot = fw[0].up1;
      src.geom = pts.length >= 2
        ? {
            pts: pts.map(p => ({ x: p.x / hr, up1: p.up1 / vr, dn1: p.dn1 / vr, up2: p.up2 / vr, dn2: p.dn2 / vr })),
            spot,
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

      ctx.save();
      const fill = (pickHi: (p: ConeGeom['pts'][number]) => number, pickLo: (p: ConeGeom['pts'][number]) => number, alpha: number) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pickHi(pts[0]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pickHi(pts[i]));
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pickLo(pts[i]));
        ctx.closePath();
        ctx.fillStyle = `rgba(${INK},${alpha})`;
        ctx.fill();
      };
      const stroke = (pick: (p: ConeGeom['pts'][number]) => number, alpha: number, dashed: boolean) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pick(pts[0]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pick(pts[i]));
        ctx.strokeStyle = `rgba(${INK},${alpha})`;
        ctx.lineWidth = Math.max(1, vr);
        ctx.setLineDash(dashed ? [4 * hr, 3 * hr] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      fill(p => p.up2, p => p.dn2, 0.035);
      fill(p => p.up1, p => p.dn1, 0.09);
      stroke(p => p.up2, 0.28, true);
      stroke(p => p.dn2, 0.28, true);
      stroke(p => p.up1, 0.8, false);
      stroke(p => p.dn1, 0.8, false);

      const last = pts[pts.length - 1];
      const dollars = tip.up1 - spot;
      const label = dollars > 0 ? `±${dollars.toFixed(2)}` : '';
      if (label && last.x < w - 4 && last.up1 > 0 && last.up1 < h) {
        ctx.font = `${10 * vr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const textW = ctx.measureText(label).width;
        const x = Math.max(textW + 8 * hr, Math.min(w - 6 * hr, last.x - 6 * hr));
        ctx.fillStyle = 'rgba(10,10,10,0.55)';
        const boxH = 14 * vr;
        ctx.fillRect(x - textW - 4 * hr, last.up1 - boxH / 2, textW + 8 * hr, boxH);
        ctx.fillStyle = `rgba(${INK},0.9)`;
        ctx.fillText(label, x, last.up1);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    });
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

  setData(next: ConeData | null): void {
    const wasOff = this.data === null;
    this.data = next;
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
    const up1 = lerp(a.up1, b.up1);
    const dn1 = lerp(a.dn1, b.dn1);
    const up2 = lerp(a.up2, b.up2);
    const dn2 = lerp(a.dn2, b.dn2);
    const top = Math.min(up2, dn2);
    const bot = Math.max(up2, dn2);
    if (y < top || y > bot) return null;
    const innerTop = Math.min(up1, dn1);
    const innerBot = Math.max(up1, dn1);
    return {
      horizon: g.horizon,
      iv: g.iv,
      minutes: g.minutes,
      source: g.source,
      spot: g.spot,
      up1: g.tipUp1,
      dn1: g.tipDn1,
      up2: g.tipUp2,
      dn2: g.tipDn2,
      band: y >= innerTop && y <= innerBot ? 1 : 2,
    };
  }
}
