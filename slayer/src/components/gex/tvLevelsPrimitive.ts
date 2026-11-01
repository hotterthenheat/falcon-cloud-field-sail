/* The auto levels on the tape (data/tvLevels.ts does the maths): Pivot Points Standard as a rung per level over each
   period, named at its left; Pivot Points High Low as the price over each swing; the Zig Zag as one polyline with its
   live leg dashed and each point's price / change / volume; Auto Fib Retracement and Extension as their levels from
   the anchors to the right edge with the anchor legs dashed; the Auto Pitchfork's median and parallels. Inks are resolved theme tokens (useTvSpecialLayer.ts). */

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import type { FibSet, Pitchfork, PivotPeriod, Swing, ZigPoint } from '../../data/tvLevels';
import type { PatternMark } from '../../data/candlePatterns';
import { forkAt } from '../../data/tvLevels';

export interface LevelsScene {
  pivots?: { periods: PivotPeriod[]; labels: boolean; prices: boolean; ink: string; word: string; width: number };
  hl?: { swings: Swing[]; inkHigh: string; inkLow: string };
  zigzag?: { pts: ZigPoint[]; tail: Swing | null; ink: string; width: number; price: boolean; change: boolean; volume: boolean; word: string };
  fib?: { set: FibSet; ink: string; word: string; prices: boolean; extendLeft: boolean; extendRight: boolean; width: number };
  ext?: { set: FibSet; ink: string; word: string; prices: boolean; extendRight: boolean; width: number };
  fork?: { f: Pitchfork; levels: number[]; ink: string; faint: string; width: number };
  /** All candlestick patterns: a tag per mark, under the bar when bullish, over it otherwise, stacked when several share a bar */
  marks?: { marks: (PatternMark & { price: number })[]; bull: string; bear: string; neutral: string; text: string };
}

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}

const fmtVol = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v)));
const fmtLevel = (l: number): string => String(Number(l.toFixed(3)));

class LevelsRenderer {
  constructor(private src: TvLevelsPrimitive) {}
  draw(target: { useBitmapCoordinateSpace(cb: (s: BitmapScope) => void): void }): void {
    const { chart, series, scene, times } = this.src;
    if (!chart || !series || !scene || !times.length) return;
    const ts = chart.timeScale();
    const spacing = ts.options().barSpacing;
    const half = Math.max(0.5, spacing / 2);
    const tx = (t: number) => ts.timeToCoordinate(t as Time);
    const n = times.length;
    const lastX = tx(times[n - 1]);
    /* a bar index (fractional, or past the last bar) to x */
    const xi = (i: number): number | null => {
      if (i >= n - 1) return lastX == null ? null : lastX + (i - (n - 1)) * spacing;
      if (i <= 0) {
        const f = tx(times[0]);
        return f == null ? null : f + i * spacing;
      }
      const a = tx(times[Math.floor(i)]);
      const b = tx(times[Math.ceil(i)]);
      if (a == null || b == null) return null;
      return a + (b - a) * (i - Math.floor(i));
    };
    const y = (p: number) => series.priceToCoordinate(p);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const W = mediaSize.width;
      ctx.save();
      ctx.font = `${Math.round(10 * vr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const line = (x1: number, y1: number, x2: number, y2: number, ink: string, width: number, dash = false) => {
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, Math.round(width * hr));
        ctx.setLineDash(dash ? [4 * hr, 3 * hr] : []);
        ctx.beginPath();
        ctx.moveTo(x1 * hr, y1 * vr);
        ctx.lineTo(x2 * hr, y2 * vr);
        ctx.stroke();
      };
      const word = (text: string, x: number, yy: number, ink: string, align: CanvasTextAlign = 'left', base: CanvasTextBaseline = 'bottom') => {
        ctx.fillStyle = ink;
        ctx.textAlign = align;
        ctx.textBaseline = base;
        ctx.fillText(text, x * hr, yy * vr);
      };
      /* ---- pivot points standard ---- */
      if (scene.pivots) {
        const p = scene.pivots;
        for (const per of p.periods) {
          const a = tx(per.from);
          const b = tx(per.to);
          if (a == null || b == null) continue;
          const left = a - half;
          const right = per.live ? W : b + half;
          if (right < 0 || left > W) continue;
          for (const l of per.levels) {
            const c = y(l.price);
            if (c == null) continue;
            line(Math.max(0, left), c, Math.min(W, right), c, p.ink, p.width);
            if ((p.labels || p.prices) && right - left > 40) word(`${p.labels ? l.name : ''}${p.labels && p.prices ? ' ' : ''}${p.prices ? `(${l.price.toFixed(2)})` : ''}`, Math.max(0, left) + 2, c - 1, p.word);
          }
        }
      }
      /* ---- pivot points high low ---- */
      if (scene.hl) {
        for (const s of scene.hl.swings) {
          const x = tx(s.time);
          const c = y(s.price);
          if (x == null || c == null || x < -40 || x > W + 40) continue;
          word(s.price.toFixed(2), x, s.high ? c - 4 : c + 4, s.high ? scene.hl.inkHigh : scene.hl.inkLow, 'center', s.high ? 'bottom' : 'top');
        }
      }
      /* ---- zig zag ---- */
      if (scene.zigzag && scene.zigzag.pts.length) {
        const z = scene.zigzag;
        let prev: { x: number; y: number } | null = null;
        for (const p of z.pts) {
          const x = tx(p.time);
          const c = y(p.price);
          if (x == null || c == null) {
            prev = null;
            continue;
          }
          if (prev) line(prev.x, prev.y, x, c, z.ink, z.width);
          prev = { x, y: c };
          if ((z.price || z.change || z.volume) && x > -60 && x < W + 60) {
            const parts: string[] = [];
            if (z.price) parts.push(p.price.toFixed(2));
            if (z.change && Number.isFinite(p.change)) parts.push(`${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)} (${((p.change / (p.price - p.change)) * 100).toFixed(2)}%)`);
            if (z.volume && p.volume > 0) parts.push(fmtVol(p.volume));
            if (parts.length) word(parts.join(' · '), x, p.high ? c - 4 : c + 4, z.word, 'center', p.high ? 'bottom' : 'top');
          }
        }
        if (z.tail && prev) {
          const x = tx(z.tail.time);
          const c = y(z.tail.price);
          if (x != null && c != null) line(prev.x, prev.y, x, c, z.ink, z.width, true);
        }
      }
      /* ---- auto fib retracement / extension ---- */
      const fibSet = (f: { set: FibSet; ink: string; word: string; prices: boolean; extendRight: boolean; width: number }, extendLeft: boolean) => {
        const pts = f.set.anchors.map(a => ({ x: tx(a.time), y: y(a.price) }));
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1];
          const b = pts[k];
          if (a.x != null && a.y != null && b.x != null && b.y != null) line(a.x, a.y, b.x, b.y, f.ink, 1, true);
        }
        const x0 = tx(f.set.fromTime);
        if (x0 == null) return;
        const left = extendLeft ? 0 : x0;
        const right = f.extendRight ? W : lastX ?? W;
        for (const l of f.set.levels) {
          const c = y(l.price);
          if (c == null) continue;
          line(Math.max(0, left), c, Math.min(W, right), c, f.ink, f.width);
          word(`${fmtLevel(l.level)}${f.prices ? ` (${l.price.toFixed(2)})` : ''}`, Math.max(0, left) + 2, c - 1, f.word);
        }
      };
      if (scene.fib) fibSet(scene.fib, scene.fib.extendLeft);
      if (scene.ext) fibSet(scene.ext, false);
      /* ---- auto pitchfork ---- */
      if (scene.fork) {
        const { f, levels, ink, faint, width } = scene.fork;
        const iEnd = lastX == null ? n - 1 : n - 1 + Math.max(0, (W - lastX) / Math.max(0.5, spacing));
        const [a, b, c] = f.anchors;
        const pa = { x: tx(a.time), y: y(a.price) };
        const pb = { x: tx(b.time), y: y(b.price) };
        const pc = { x: tx(c.time), y: y(c.price) };
        if (pb.x != null && pb.y != null && pc.x != null && pc.y != null) line(pb.x, pb.y, pc.x, pc.y, faint, 1, true);
        const ox = xi(f.origin.i);
        const oy = y(f.origin.price);
        if (pa.x != null && pa.y != null && ox != null && oy != null && (ox !== pa.x || oy !== pa.y)) line(pa.x, pa.y, ox, oy, faint, 1, true);
        for (const lv of [0, ...levels.flatMap(l => [l, -l])]) {
          const startI = lv === 0 ? f.origin.i : lv > 0 ? b.i : c.i;
          const from = lv === 0 || Math.abs(lv) === 1 ? startI : Math.min(b.i, c.i);
          const x1 = xi(from);
          const x2 = xi(iEnd);
          const y1 = y(forkAt(f, from, lv));
          const y2 = y(forkAt(f, iEnd, lv));
          if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
          line(x1, y1, x2, y2, lv === 0 ? ink : faint, lv === 0 ? width : 1);
        }
      }
      /* ---- all candlestick patterns ---- */
      if (scene.marks && scene.marks.marks.length) {
        const k = scene.marks;
        const stack = new Map<string, number>();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const m of k.marks) {
          const x = tx(m.time);
          if (x == null || x < -20 || x > W + 20) continue;
          const below = m.lean === 'bull';
          const yy = y(m.price);
          if (yy == null) continue;
          const slot = `${m.time}|${below ? 'b' : 'a'}`;
          const nth = stack.get(slot) ?? 0;
          stack.set(slot, nth + 1);
          const tw = ctx.measureText(m.mark).width / hr + 6;
          const th = 13;
          const cy = below ? yy + 6 + th / 2 + nth * (th + 2) : yy - 6 - th / 2 - nth * (th + 2);
          ctx.fillStyle = m.lean === 'bull' ? k.bull : m.lean === 'bear' ? k.bear : k.neutral;
          ctx.fillRect(Math.round((x - tw / 2) * hr), Math.round((cy - th / 2) * vr), Math.round(tw * hr), Math.round(th * vr));
          ctx.fillStyle = k.text;
          ctx.fillText(m.mark, x * hr, cy * vr);
        }
      }
      ctx.restore();
    });
  }
}

class LevelsPaneView {
  private r: LevelsRenderer;
  constructor(src: TvLevelsPrimitive) {
    this.r = new LevelsRenderer(src);
  }
  renderer(): LevelsRenderer {
    return this.r;
  }
}

export class TvLevelsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  scene: LevelsScene | null = null;
  times: number[] = [];
  private requestUpdate?: () => void;
  private views = [new LevelsPaneView(this)];
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
  paneViews(): LevelsPaneView[] {
    return this.views;
  }
  set(times: number[], scene: LevelsScene | null): void {
    if (!scene && !this.scene) return;
    this.times = times;
    this.scene = scene;
    this.requestUpdate?.();
  }
}
