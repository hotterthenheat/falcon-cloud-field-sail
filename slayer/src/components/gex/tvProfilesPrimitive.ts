/* The volume profile INDICATORS on the tape (data/volumeAtPrice.ts does the maths): the visible range profile docked
   to an edge of the pane and recomputed as the view moves, and the session / periodic / auto anchored profiles, each
   a histogram laid over its own bars from its first bar rightward. Up volume and down volume in the house's two
   directions, the value area's rows stronger than the rest, the POC as a rule (optionally run on to the right edge)
   and VAH / VAL as faint rules. Drawn under the candles. Inks are resolved theme tokens (useTvSpecialLayer.ts). */

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { VapProfile } from '../../data/volumeAtPrice';

export type ProfileValues = 'updown' | 'total' | 'delta';

export interface ProfileInks {
  up: string;
  down: string;
  upVa: string;
  downVa: string;
  total: string;
  totalVa: string;
  poc: string;
  vaEdge: string;
  word: string;
}

export interface ProfileLook {
  values: ProfileValues;
  /** Width of the widest row: a share of the pane (docked) or of the profile's own span (laid over its bars) */
  widthPct: number;
  showPoc: boolean;
  showVa: boolean;
  extendPoc: boolean;
  inks: ProfileInks;
}

/** A profile laid over its own bars */
export interface SpanProfile {
  profile: VapProfile;
  look: ProfileLook;
}

/** The docked one: recomputed for the bars in view */
export interface DockedProfile {
  build: (fromSec: number, toSec: number) => VapProfile | null;
  side: 'right' | 'left';
  look: ProfileLook;
}

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}

/** The chart bar at or before a time (the profile's bars may be finer than the chart's) */
function barAtOrBefore(times: readonly number[], t: number): number | null {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t < times[0]) return times.length ? times[0] : null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return times[lo];
}

class ProfilesRenderer {
  constructor(private src: TvProfilesPrimitive) {}
  draw(target: { useBitmapCoordinateSpace(cb: (s: BitmapScope) => void): void }): void {
    const { chart, series, spans, docked, times } = this.src;
    if (!chart || !series || (!spans.length && !docked)) return;
    const ts = chart.timeScale();
    const half = Math.max(0.5, ts.options().barSpacing / 2);
    const xOf = (t: number): number | null => {
      const bt = barAtOrBefore(times, t);
      return bt == null ? null : ts.timeToCoordinate(bt as Time);
    };
    const y = (p: number) => series.priceToCoordinate(p);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const W = mediaSize.width;
      const drawRows = (p: VapProfile, look: ProfileLook, x0: number, maxW: number, dir: 1 | -1) => {
        const peak = Math.max(...p.rows.map(r => (look.values === 'delta' ? Math.abs(r.up - r.down) : r.total)), 0);
        if (!(peak > 0) || maxW < 2) return;
        const k = look.inks;
        for (let i = 0; i < p.rows.length; i++) {
          const r = p.rows[i];
          const top = y(r.hi);
          const foot = y(r.lo);
          if (top == null || foot == null) continue;
          const inVa = look.showVa && i >= p.vaLo && i <= p.vaHi;
          const t = Math.round(top * vr) + 1;
          const h = Math.max(1, Math.round((foot - top) * vr) - 1);
          const bar = (from: number, len: number, ink: string) => {
            if (len <= 0) return;
            const a = dir > 0 ? x0 + from : x0 - from - len;
            ctx.fillStyle = ink;
            ctx.fillRect(Math.round(a * hr), t, Math.max(1, Math.round(len * hr)), h);
          };
          if (look.values === 'total') bar(0, (r.total / peak) * maxW, inVa ? k.totalVa : k.total);
          else if (look.values === 'delta') {
            const d = r.up - r.down;
            bar(0, (Math.abs(d) / peak) * maxW, d >= 0 ? (inVa ? k.upVa : k.up) : inVa ? k.downVa : k.down);
          } else {
            const wu = (r.up / peak) * maxW;
            const wd = (r.down / peak) * maxW;
            bar(0, wu, inVa ? k.upVa : k.up);
            bar(wu, wd, inVa ? k.downVa : k.down);
          }
        }
      };
      const rule = (price: number, xa: number, xb: number, ink: string, dash: boolean) => {
        const c = y(price);
        if (c == null) return;
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, Math.floor(hr));
        if (dash) ctx.setLineDash([3 * hr, 3 * hr]);
        ctx.beginPath();
        const py = Math.round(c * vr) + 0.5;
        ctx.moveTo(Math.round(Math.max(0, xa) * hr), py);
        ctx.lineTo(Math.round(Math.min(W, xb) * hr), py);
        ctx.stroke();
        ctx.restore();
      };
      for (const s of spans) {
        const a = xOf(s.profile.from);
        const b = xOf(s.profile.to);
        if (a == null || b == null) continue;
        const left = a - half;
        const right = b + half;
        if (right < 0 || left > W) continue;
        drawRows(s.profile, s.look, left, ((right - left) * s.look.widthPct) / 100, 1);
        if (s.look.showVa) {
          rule(s.profile.vah, left, right, s.look.inks.vaEdge, true);
          rule(s.profile.val, left, right, s.look.inks.vaEdge, true);
        }
        if (s.look.showPoc) rule(s.profile.pocPrice, left, s.look.extendPoc ? W : right, s.look.inks.poc, false);
      }
      if (docked) {
        const vis = ts.getVisibleRange();
        const p = vis ? this.src.dockedProfile(Number(vis.from), Number(vis.to)) : null;
        if (p) {
          const maxW = (W * docked.look.widthPct) / 100;
          const x0 = docked.side === 'right' ? W : 0;
          drawRows(p, docked.look, x0, maxW, docked.side === 'right' ? -1 : 1);
          if (docked.look.showVa) {
            rule(p.vah, docked.side === 'right' ? W - maxW : 0, docked.side === 'right' ? W : maxW, docked.look.inks.vaEdge, true);
            rule(p.val, docked.side === 'right' ? W - maxW : 0, docked.side === 'right' ? W : maxW, docked.look.inks.vaEdge, true);
          }
          if (docked.look.showPoc) rule(p.pocPrice, docked.look.extendPoc ? 0 : docked.side === 'right' ? W - maxW : 0, docked.look.extendPoc ? W : docked.side === 'right' ? W : maxW, docked.look.inks.poc, false);
        }
      }
    });
  }
}

class ProfilesPaneView {
  private r: ProfilesRenderer;
  constructor(src: TvProfilesPrimitive) {
    this.r = new ProfilesRenderer(src);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): ProfilesRenderer {
    return this.r;
  }
}

export class TvProfilesPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  spans: SpanProfile[] = [];
  docked: DockedProfile | null = null;
  /** The chart's bar times, ascending — where a profile's own times land on the axis */
  times: number[] = [];
  private dockKey = '';
  private dockHit: VapProfile | null = null;
  /** The last visible-range profile, for the legend */
  lastDocked: VapProfile | null = null;
  private requestUpdate?: () => void;
  private views = [new ProfilesPaneView(this)];
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
  paneViews(): ProfilesPaneView[] {
    return this.views;
  }
  /** The docked profile for a view, built once per range */
  dockedProfile(from: number, to: number): VapProfile | null {
    if (!this.docked) return null;
    const key = `${from}|${to}`;
    if (key !== this.dockKey) {
      this.dockKey = key;
      this.dockHit = this.docked.build(from, to);
      this.lastDocked = this.dockHit;
    }
    return this.dockHit;
  }
  set(times: number[], spans: SpanProfile[], docked: DockedProfile | null): void {
    if (!spans.length && !docked && !this.spans.length && !this.docked) return;
    this.times = times;
    this.spans = spans;
    this.docked = docked;
    this.dockKey = '';
    this.requestUpdate?.();
  }
}
