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
      /* the rule: solid from the entry candle to its end; LEFT of the entry a faint dotted trace, so a level still reads
         across the tape when the entry is the newest candle (the simulator grades at the last bar) — the pen's default */
      const rule = (x0: number | null, y: number, x1: number, rgb: string, alpha: number, trace = true) => pen.rule(x0, y, x1, rgb, alpha, { trace });
      const figure = (text: string, y: number, rgb: string, above = true) => pen.figure(text, y, rgb, above);
      ctx.save();

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

      /* A line at its real premium. Off the canvas it docks — a line at a fake y is a lie.
         Sitting under the toolbar is still on the tape; the toolbar is clear. */
      const onScale = (raw: number | null): raw is number => raw != null && raw > 2 * vr && raw < H - 2 * vr;
      /* a level on the tape but under the chart's chrome (its readout row): its rule is drawn, its label docks below */
      const underChrome = (raw: number | null): raw is number => onScale(raw) && raw < topLimit;

      const ENTRY = '#FF9500';
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

      /* a stop lifted to the entry (break-even) is one line with one label, never two words printed over each other */
      const stopAtEntry = !!data.floor && !!data.entry && Math.abs(data.floor.price - data.entry.price) < 0.005;

      /* THE STOP — a line across the tape at the real premium. */
      if (data.floor && !stopAtEntry) {
        const raw = yOf(data.floor.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = `STOP  ${px(data.floor.price)}${fromEntry(data.floor.price)}${data.floor.brokeAt ? '  broke' : ''}`;
        const alpha = data.hot === 'floor' ? 1 : 0.9;
        if (onScale(raw) && !underChrome(raw)) {
          rule(0, raw, right, data.bear, alpha, false);
          figure(word, raw, data.bear, raw > topLimit);
        } else {
          if (underChrome(raw)) rule(0, raw, right, data.bear, alpha * 0.6, false);
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

      /* THE ENTRY — a full line across the tape at the fill, amber, the price
         at the right. Same bar as the stop and the targets. Not a chip on a candle. */
      if (data.entry) {
        const raw = yOf(data.entry.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = `${data.entryWord || 'ASK'}${stopAtEntry ? ' · STOP' : ''}  ${px(data.entry.mid)}`;
        if (onScale(raw) && !underChrome(raw)) {
          rule(0, raw, right, ENTRY, 0.95, false);
          figure(word, raw, ENTRY, raw > topLimit);
        } else {
          if (underChrome(raw)) rule(0, raw, right, ENTRY, 0.6, false);
          const y = dockY(raw);
          chip(word, y, ENTRY, false);
        }
      }

      /* The take profits — a full line with a dark chip, so a green candle cannot swallow the label. A hit is
         thicker and says so. */
      for (const t of data.targets) {
        const raw = yOf(t.price);
        const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const word = t.won ? `TP${t.level} HIT  ${px(t.price)}${fromEntry(t.price)}` : `TP${t.level}  ${px(t.price)}${fromEntry(t.price)}`;
        const ink = t.won ? '#D6FFE2' : data.bull;
        if (onScale(raw)) {
          pen.rule(0, raw, right, '#04140A', t.won ? 0.95 : 0.75, { trace: false, width: t.won ? 5 : 3 });
          pen.rule(0, raw, right, ink, 1, { trace: false, width: t.won ? 2.4 : 1.35 });
          if (!underChrome(raw)) {
            chip(word, raw, ink, t.won);
            continue;
          }
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
