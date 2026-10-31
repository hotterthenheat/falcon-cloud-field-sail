/* Compass's calls on the underlying's own canvas: a chip at the minute each call fired (its New York time and ▲ for a
   call, ▼ for a put) on a stem down to the price then, in its book's ink; a hollow square where it left, with its own
   small chip; a dotted run between the two. The picked call draws whole and the rest step back; a picked event that is
   not the call or the exit (a stop step) stands as a hairline at its minute. Chips never sit on one another: a chip
   that would is stacked further from the line, or takes the line's other side. */

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time, UTCTimestamp } from 'lightweight-charts';
import { LADDER_MONO as MONO, type DrawTarget } from '../gex/ladderPaint';

export interface CallMark {
  /** The signal's key */
  key: string;
  /** The bar (UTC seconds) of the minute it fired, and the underlying's close then */
  time: number;
  price: number;
  /** "13:45 ▲" */
  text: string;
  /** Above the line (a call) or under it (a put) */
  up: boolean;
  /** The book's ink, a literal */
  ink: string;
  exit: { time: number; price: number; text: string } | null;
}

export interface CallMarksData {
  marks: CallMark[];
  /** The picked call's key, or null */
  hot: string | null;
  /** A picked stop step: its bar and word */
  rule: { time: number; text: string; ink: string } | null;
  /** The plot's ground: chips stand on it */
  bg: string;
}

type Box = { x0: number; x1: number; y0: number; y1: number };
const hits = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

class CallMarksRenderer {
  constructor(private readonly source: CallMarksPrimitive) {}
  draw(target: DrawTarget): void {
    const { chart, series, data } = this.source;
    if (!chart || !series || !data || (!data.marks.length && !data.rule)) return;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const W = scope.mediaSize.width * hr;
      const H = scope.mediaSize.height * vr;
      const xOf = (t: number) => {
        const x = chart.timeScale().timeToCoordinate(t as UTCTimestamp);
        return x == null ? null : x * hr;
      };
      const yOf = (p: number) => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : y * vr;
      };
      const taken: Box[] = [];
      /* a chip's box beside a point: up or down from it, stacked clear of what is drawn, or null */
      const place = (x: number, y: number, w: number, h: number, up: boolean, lift: number): Box | null => {
        const x0 = Math.max(1 * hr, Math.min(W - w - 1 * hr, x - w / 2));
        for (const side of [up, !up]) {
          for (let n = 0; n < 6; n++) {
            const off = lift + n * (h + 3 * vr);
            const y0 = side ? y - off - h : y + off;
            const box = { x0, x1: x0 + w, y0, y1: y0 + h };
            if (box.y0 < 2 * vr || box.y1 > H - 2 * vr) break;
            if (!taken.some(b => hits(b, box))) return box;
          }
        }
        return null;
      };
      const chip = (box: Box, text: string, ink: string, size: number, strong: boolean, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 2 * vr);
        ctx.fillStyle = data.bg;
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, Math.round((strong ? 1.75 : 1) * vr));
        ctx.stroke();
        ctx.font = `700 ${size * vr}px ${MONO}`;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2 + 0.5 * vr);
        ctx.globalAlpha = 1;
      };
      const stem = (x: number, y: number, box: Box, ink: string, alpha: number) => {
        const toY = box.y1 <= y ? box.y1 : box.y0;
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, y);
        ctx.lineTo(Math.round(x) + 0.5, toY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      ctx.save();
      /* the picked stop step: a hairline at its minute, its word at the top */
      if (data.rule) {
        const x = xOf(data.rule.time);
        if (x != null) {
          ctx.strokeStyle = data.rule.ink;
          ctx.lineWidth = Math.max(1, Math.round(hr));
          ctx.setLineDash([3 * vr, 3 * vr]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, H);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `700 ${9 * vr}px ${MONO}`;
          const w = ctx.measureText(data.rule.text).width + 10 * hr;
          const box = { x0: Math.max(1, Math.min(W - w - 1, x - w / 2)), x1: 0, y0: 4 * vr, y1: 17 * vr };
          box.x1 = box.x0 + w;
          taken.push(box);
          chip(box, data.rule.text, data.rule.ink, 9, true, 1);
        }
      }
      /* the picked call last, so it draws over the rest */
      const order = [...data.marks].sort((a, b) => (a.key === data.hot ? 1 : 0) - (b.key === data.hot ? 1 : 0));
      /* the picked call places first, so its chips keep their spot */
      const placing = [...order].reverse();
      const plan = new Map<string, { inBox: Box | null; outBox: Box | null }>();
      for (const m of placing) {
        const x = xOf(m.time);
        const y = yOf(m.price);
        let inBox: Box | null = null;
        let outBox: Box | null = null;
        if (x != null && y != null) {
          ctx.font = `700 ${10 * vr}px ${MONO}`;
          const w = ctx.measureText(m.text).width + 12 * hr;
          inBox = place(x, y, w, 16 * vr, m.up, 14 * vr);
          if (inBox) taken.push(inBox);
        }
        if (m.exit) {
          const ex = xOf(m.exit.time);
          const ey = yOf(m.exit.price);
          if (ex != null && ey != null) {
            ctx.font = `700 ${9 * vr}px ${MONO}`;
            const w = ctx.measureText(m.exit.text).width + 10 * hr;
            outBox = place(ex, ey, w, 14 * vr, !m.up, 10 * vr);
            if (outBox) taken.push(outBox);
          }
        }
        plan.set(m.key, { inBox, outBox });
      }
      for (const m of order) {
        const hot = data.hot === m.key;
        const alpha = data.hot && !hot ? 0.38 : 1;
        const x = xOf(m.time);
        const y = yOf(m.price);
        const p = plan.get(m.key);
        const ex = m.exit ? xOf(m.exit.time) : null;
        const ey = m.exit ? yOf(m.exit.price) : null;
        /* the run from the call to the exit */
        if (x != null && y != null && ex != null && ey != null) {
          ctx.globalAlpha = alpha * (hot ? 0.9 : 0.55);
          ctx.strokeStyle = m.ink;
          ctx.lineWidth = Math.max(1, Math.round((hot ? 1.5 : 1) * vr));
          ctx.setLineDash([2 * hr, 3 * hr]);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        if (x != null && y != null) {
          if (p?.inBox) stem(x, y, p.inBox, m.ink, alpha);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = m.ink;
          ctx.beginPath();
          ctx.arc(x, y, (hot ? 4 : 3) * vr, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (p?.inBox) chip(p.inBox, m.text, m.ink, 10, hot, alpha);
        }
        if (m.exit && ex != null && ey != null) {
          if (p?.outBox) stem(ex, ey, p.outBox, m.ink, alpha);
          const s = (hot ? 4.5 : 3.5) * vr;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = data.bg;
          ctx.fillRect(ex - s, ey - s, s * 2, s * 2);
          ctx.strokeStyle = m.ink;
          ctx.lineWidth = Math.max(1, Math.round(1.5 * vr));
          ctx.strokeRect(ex - s, ey - s, s * 2, s * 2);
          ctx.globalAlpha = 1;
          if (p?.outBox) chip(p.outBox, m.exit.text, m.ink, 9, hot, alpha);
        }
      }
      ctx.restore();
    });
  }
}

class CallMarksView {
  private readonly _renderer: CallMarksRenderer;
  constructor(source: CallMarksPrimitive) {
    this._renderer = new CallMarksRenderer(source);
  }
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): CallMarksRenderer {
    return this._renderer;
  }
}

export class CallMarksPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  data: CallMarksData | null = null;
  private requestUpdate?: () => void;
  private readonly views: CallMarksView[];
  constructor() {
    this.views = [new CallMarksView(this)];
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }
  updateAllViews(): void {}
  paneViews(): CallMarksView[] {
    return this.views;
  }
  setData(data: CallMarksData | null): void {
    this.data = data;
    this.requestUpdate?.();
  }
}
