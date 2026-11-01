/* The sessions under an intraday tape (data/sessionMarks.ts): the extended hours as a faint wash behind their bars
   (pre-market, after hours, overnight, each its own tint), a dashed rule where each new session day starts, and the
   Sessions indicator's Tokyo / London / New York boxes from their high to their low, named at the top left. All three
   draw BELOW the candles. The inks come from the theme's tokens (StrikeChart passes them resolved). */

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { ExtKind, SessionMarks } from '../../data/sessionMarks';
import type { WorldSessionKey } from '../../core/session';

export interface SessionInks {
  shade: Record<ExtKind, string>;
  rule: string;
  box: Record<WorldSessionKey, { fill: string; edge: string; word: string }>;
}

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}

class SessionsRenderer {
  constructor(private src: SessionsPrimitive) {}
  draw(target: { useBitmapCoordinateSpace(cb: (s: BitmapScope) => void): void }): void {
    const { chart, series, marks, inks } = this.src;
    if (!chart || !series || !marks || !inks) return;
    const ts = chart.timeScale();
    const half = Math.max(0.5, ts.options().barSpacing / 2);
    const x = (t: number) => ts.timeToCoordinate(t as Time);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      const span = (from: number, to: number): [number, number] | null => {
        const a = x(from);
        const b = x(to);
        if (a == null || b == null) return null;
        const l = a - half;
        const r = b + half;
        return r < 0 || l > W ? null : [Math.max(0, l), Math.min(W, r)];
      };
      for (const s of marks.shades) {
        const sp = span(s.from, s.to);
        if (!sp) continue;
        ctx.fillStyle = inks.shade[s.kind];
        ctx.fillRect(Math.round(sp[0] * hr), 0, Math.max(1, Math.round((sp[1] - sp[0]) * hr)), Math.round(H * vr));
      }
      if (marks.breaks.length) {
        ctx.save();
        ctx.strokeStyle = inks.rule;
        ctx.lineWidth = Math.max(1, Math.floor(hr));
        ctx.setLineDash([3 * vr, 3 * vr]);
        ctx.beginPath();
        for (const t of marks.breaks) {
          const c = x(t);
          if (c == null) continue;
          const px = Math.round((c - half) * hr) + 0.5;
          if (px < 0 || px > W * hr) continue;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, H * vr);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (marks.boxes.length) {
        ctx.save();
        ctx.font = `${Math.round(10 * vr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'bottom';
        for (const b of marks.boxes) {
          const sp = span(b.from, b.to);
          if (!sp) continue;
          const top = series.priceToCoordinate(b.high);
          const foot = series.priceToCoordinate(b.low);
          if (top == null || foot == null) continue;
          const ink = inks.box[b.key];
          const l = Math.round(sp[0] * hr);
          const w = Math.max(1, Math.round((sp[1] - sp[0]) * hr));
          const t = Math.round(top * vr);
          const h = Math.max(1, Math.round((foot - top) * vr));
          ctx.fillStyle = ink.fill;
          ctx.fillRect(l, t, w, h);
          ctx.strokeStyle = ink.edge;
          ctx.lineWidth = Math.max(1, Math.floor(hr));
          ctx.strokeRect(l + 0.5, t + 0.5, w - 1, h - 1);
          if (sp[1] - sp[0] >= 34 && top > 12) {
            ctx.fillStyle = ink.word;
            ctx.fillText(b.name, l + 3 * hr, t - 2 * vr);
          }
        }
        ctx.restore();
      }
    });
  }
}

class SessionsPaneView {
  private r: SessionsRenderer;
  constructor(src: SessionsPrimitive) {
    this.r = new SessionsRenderer(src);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): SessionsRenderer {
    return this.r;
  }
}

export class SessionsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  marks: SessionMarks | null = null;
  inks: SessionInks | null = null;
  private requestUpdate?: () => void;
  private views = [new SessionsPaneView(this)];
  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }
  updateAllViews(): void {}
  paneViews(): SessionsPaneView[] {
    return this.views;
  }
  /** Replace what is drawn (null draws nothing) */
  set(marks: SessionMarks | null, inks: SessionInks | null): void {
    const empty = (m: SessionMarks | null) => !m || (!m.shades.length && !m.breaks.length && !m.boxes.length);
    if (empty(marks) && empty(this.marks)) return;
    this.marks = marks;
    this.inks = inks;
    this.requestUpdate?.();
  }
}
