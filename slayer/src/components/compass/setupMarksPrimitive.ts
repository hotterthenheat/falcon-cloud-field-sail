/* The setup's marks drawn on the chart's own canvas at the tape's right edge: the entry, the stop and the targets
   as one short ladder, docked when off screen. */

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';
import { LADDER_MONO as MONO, ladderPen, type DrawTarget } from '../gex/ladderPaint';

export interface SetupMarks {
  /** The entry: its candle's time, the stock price then, and the premium paid */
  entry: { time: UTCTimestamp; price: number; mid: number } | null;
  /** The floor, and where it stops if it broke */
  floor: { price: number; brokeAt: UTCTimestamp | null } | null;
  targets: { level: number; price: number; won: boolean }[];
  /** Planned ask on the premium chart. Omitted marks stay unlabeled as a fill. */
  entryWord?: string;
  /** The inks — literals, the chart is its own island */
  silver: string;
  /** The tape's ground — the entry chip's fill */
  bg: string;
  bull: string;
  bear: string;
  ink: string;
  /** The rung under the pointer, if any */
  hot: string | null;
  /** CSS px the page's chrome covers — a level that doesn't fit docks under this, not under the buttons. */
  insetTop?: number;
  /** No words on the tape. The scale names the level. Entry fades to a bead, the stop is a floor, a sell is a tick. */
  bare?: boolean;
}

class MarksRenderer {
  constructor(private readonly source: SetupMarksPrimitive) {}
  draw(target: DrawTarget): void {
    const { chart, series, data } = this.source;
    if (!chart || !series || !data) return;
    target.useBitmapCoordinateSpace(scope => {
      const pen = ladderPen(scope);
      const { ctx, hr, vr, H, right } = pen;
      const yOf = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : y * vr;
      };
      ctx.save();
      const onScale = (raw: number | null): raw is number => raw != null && raw > 2 * vr && raw < H - 2 * vr;
      const ENTRY = '#FF9500';
      if (data.bare) {
        const bead = (y: number, rgb: string, r: number) => {
          ctx.beginPath();
          ctx.arc(right - 8 * hr, y, r * hr, 0, Math.PI * 2);
          ctx.fillStyle = rgb;
          ctx.fill();
        };
        const fade = (y: number, rgb: string) => {
          const x0 = right * 0.55;
          const g = ctx.createLinearGradient(x0, y, right, y);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, rgb);
          ctx.strokeStyle = g;
          ctx.lineWidth = Math.max(1, 1.25 * hr);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(right - 14 * hr, y);
          ctx.stroke();
          bead(y, rgb, 3.2);
        };
        let edgeUp = 0;
        let edgeDn = 0;
        const docked = (price: number, rgb: string, tag: string) => {
          const yRaw = yOf(price);
          if (yRaw == null || onScale(yRaw)) return false;
          const up = yRaw < H / 2;
          const slot = up ? edgeUp : edgeDn;
          if (up) edgeUp += 1;
          else edgeDn += 1;
          const top = ((data.insetTop ?? 36) + 4) * vr;
          const y = up ? top + slot * 18 * vr : H - (16 + slot * 18) * vr;
          bead(y, rgb, 3.2);
          ctx.font = `600 ${12 * vr}px ${MONO}`;
          ctx.fillStyle = rgb;
          ctx.globalAlpha = 1;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, right - 18 * hr, y);
          return true;
        };
        if (data.floor && !docked(data.floor.price, data.bear, 'Stop') && onScale(yOf(data.floor.price))) {
          const y = yOf(data.floor.price) as number;
          ctx.fillStyle = data.bear;
          ctx.globalAlpha = 0.1;
          ctx.fillRect(right * 0.55, y, right * 0.45, 10 * vr);
          ctx.globalAlpha = 1;
          fade(y, data.bear);
        }
        if (data.entry && !docked(data.entry.price, ENTRY, 'Entry') && onScale(yOf(data.entry.price))) fade(yOf(data.entry.price) as number, ENTRY);
        const TP = ['#30D158', '#64D2FF', '#BF5AF2'];
        const glow = (y: number, rgb: string, hot: boolean) => {
          const x = right - 8 * hr;
          const rad = (hot ? 16 : 9) * Math.max(hr, 1);
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, rgb);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.save();
          ctx.globalAlpha = hot ? 0.9 : 0.4;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };
        const liveLevel = data.targets.reduce((n, t) => (t.won ? Math.max(n, t.level) : n), 0);
        for (const t of data.targets) {
          const rgb = TP[(t.level - 1) % TP.length];
          const y = yOf(t.price);
          if (docked(t.price, rgb, `TP${t.level}`)) continue;
          if (!onScale(y)) continue;
          const hot = t.won && t.level === liveLevel;
          glow(y, rgb, hot || t.won);
          ctx.strokeStyle = rgb;
          ctx.globalAlpha = hot ? 1 : 0.75;
          ctx.lineWidth = Math.max(1, (hot ? 2.2 : 1.4) * hr);
          ctx.beginPath();
          ctx.moveTo(right - (hot ? 64 : 48) * hr, y);
          ctx.lineTo(right - 14 * hr, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          bead(y, rgb, hot ? 3.6 : 2.6);
        }
        ctx.restore();
        return;
      }
      const rule = (x0: number | null, y: number, x1: number, rgb: string, alpha: number, trace = true) => pen.rule(x0, y, x1, rgb, alpha, { trace });
      const figure = (text: string, y: number, rgb: string, above = true) => pen.figure(text, y, rgb, above);
      const topLimit = ((data.insetTop ?? 36) + 8) * vr;
      const botLimit = H - 10 * vr;
      const slot = 15 * vr;
      let dockTop = 0;
      let dockBot = 0;
      const dockY = (raw: number | null) => {
        if (raw != null && raw >= H - 2 * vr) {
          const y = botLimit - dockBot * slot;
          dockBot += 1;
          return y;
        }
        const y = topLimit + dockTop * slot;
        dockTop += 1;
        return y;
      };
      const fromEntry = (price: number) => {
        const base = data.entry?.mid ?? 0;
        if (!(base > 0)) return '';
        const p = (price / base - 1) * 100;
        if (Math.abs(p) < 0.5) return '';
        return `  ${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%`;
      };
      const chip = (text: string, y: number, rgb: string, strong: boolean) => {
        ctx.font = `700 ${(strong ? 11 : 9) * vr}px ${MONO}`;
        const tw = ctx.measureText(text).width;
        const padX = 5 * hr;
        const chipH = (strong ? 16 : 13) * vr;
        const chipW = tw + padX * 2;
        const chipX = right - chipW;
        ctx.beginPath();
        ctx.roundRect(chipX, y - chipH / 2, chipW, chipH, 2 * vr);
        ctx.fillStyle = data.bg;
        ctx.globalAlpha = 0.94;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgb;
        ctx.lineWidth = Math.max(1, Math.round((strong ? 1.75 : 1) * vr));
        ctx.stroke();
        ctx.fillStyle = rgb;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, chipX + chipW / 2, y + 0.5 * vr);
      };
      if (data.floor) {
        const raw = yOf(data.floor.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = `STOP  ${px(data.floor.price)}${fromEntry(data.floor.price)}${data.floor.brokeAt ? '  broke' : ''}`;
        const alpha = data.hot === 'floor' ? 1 : 0.9;
        if (onScale(raw)) {
          rule(0, raw, right, data.bear, alpha, false);
          figure(word, raw, data.bear, raw > topLimit);
        } else {
          const y = dockY(raw);
          const tickW = 14 * hr;
          ctx.fillStyle = data.bear;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(right - tickW, y - vr, tickW, 2 * vr);
          ctx.globalAlpha = 1;
          ctx.font = `600 ${8.5 * vr}px ${MONO}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = data.bear;
          ctx.fillText(word, right - tickW - 4 * hr, y);
        }
      }
      if (data.entry) {
        const raw = yOf(data.entry.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = `${data.entryWord || 'ASK'}  ${px(data.entry.mid)}`;
        if (onScale(raw)) {
          rule(0, raw, right, ENTRY, 0.95, false);
          figure(word, raw, ENTRY, raw > topLimit);
        } else {
          const y = dockY(raw);
          chip(word, y, ENTRY, false);
        }
      }
      for (const t of data.targets) {
        const raw = yOf(t.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = t.won ? `TP${t.level} HIT  ${px(t.price)}${fromEntry(t.price)}` : `TP${t.level}  ${px(t.price)}${fromEntry(t.price)}`;
        const ink = t.won ? '#D6FFE2' : data.bull;
        if (onScale(raw)) {
          pen.rule(0, raw, right, '#04140A', t.won ? 0.95 : 0.75, { trace: false, width: t.won ? 5 : 3 });
          pen.rule(0, raw, right, ink, 1, { trace: false, width: t.won ? 2.4 : 1.35 });
          chip(word, raw, ink, t.won);
          continue;
        }
        const y = dockY(raw);
        chip(word, y, ink, t.won);
      }
      ctx.restore();
    });
  }
}

class MarksPaneView {
  private readonly _renderer: MarksRenderer;
  constructor(source: SetupMarksPrimitive) {
    this._renderer = new MarksRenderer(source);
  }
  /* over the candles — the marks are the reading, thin enough to leave the tape whole */
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): MarksRenderer {
    return this._renderer;
  }
}

export class SetupMarksPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  data: SetupMarks | null = null;
  private readonly _paneViews: MarksPaneView[];
  constructor() {
    this._paneViews = [new MarksPaneView(this)];
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
  paneViews(): MarksPaneView[] {
    return this._paneViews;
  }
  setData(data: SetupMarks | null): void {
    this.data = data;
    this.requestUpdate?.();
  }
}
