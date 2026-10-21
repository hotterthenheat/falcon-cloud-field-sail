/*
==================================================
  SLAYER TERMINAL - THE SETUP'S MARKS ON THE TAPE
  (components/compass/setupMarksPrimitive.ts)

  Noah, 2026-09-28: "i dont like the look of the
  target capsules on the chart. and the entry look
  is not appealing either." The setup's chart used
  three vocabularies at once — dashed target lines
  with the library's axis capsules, an entry dot with
  words floating over the candles, a thick red floor
  with another capsule. Now one short ladder on the
  tape's right edge, drawn on the chart's own canvas:

    THE ENTRY    a thin silver rule from the entry
                 candle to the right edge at the price
                 it was entered, the premium as a small
                 silver figure at its end
    THE FLOOR    a thin red rule from the entry candle
                 to the right edge, its figure at the
                 end in red; a broken floor stops at the
                 candle that broke it
    THE TARGETS  short green ticks at the right edge,
                 one a rung, a small numeral beside each;
                 a won rung is filled in

  No full-width line, no capsule on the axis, no words
  over the candles. The host draws the pointer card.

  2026-10-04: the rule and the figure moved to a pen
  the house chart's key levels share (gex/ladderPaint),
  so the two ladders are one grammar.
==================================================
*/

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';
import { LADDER_MONO as MONO, ladderPen, type DrawTarget } from '../gex/ladderPaint';
export { LADDER_W } from '../gex/ladderPaint';

export interface SetupMarks {
  /** The entry: its candle's time, the stock price then, and the premium paid */
  entry: { time: UTCTimestamp; price: number; mid: number } | null;
  /** The floor, and where it stops if it broke */
  floor: { price: number; brokeAt: UTCTimestamp | null } | null;
  targets: { level: number; price: number; won: boolean }[];
  /** The inks — literals, the chart is its own island */
  silver: string;
  /** The tape's ground — the entry chip's fill */
  bg: string;
  bull: string;
  bear: string;
  ink: string;
  /** The rung under the pointer, if any */
  hot: string | null;
}

class MarksRenderer {
  constructor(private readonly source: SetupMarksPrimitive) {}
  draw(target: DrawTarget): void {
    const { chart, series, data } = this.source;
    if (!chart || !series || !data) return;
    target.useBitmapCoordinateSpace(scope => {
      const pen = ladderPen(scope);
      const { ctx, hr, vr, H, right } = pen;
      const ts = chart.timeScale();
      const xOf = (t: UTCTimestamp): number | null => {
        const x = ts.timeToCoordinate(t as Time);
        return x == null ? null : x * hr;
      };
      const yOf = (p: number): number | null => {
        const y = series.priceToCoordinate(p);
        return y == null ? null : y * vr;
      };
      /* the rule: solid from the entry candle to its end; LEFT of the entry a faint dotted trace, so a level still reads
         across the tape when the entry is the newest candle (the simulator grades at the last bar) — the pen's default */
      const rule = (x0: number | null, y: number, x1: number, rgb: string, alpha: number, trace = true) => pen.rule(x0, y, x1, rgb, alpha, { trace });
      const figure = (text: string, y: number, rgb: string, above = true) => pen.figure(text, y, rgb, above);
      ctx.save();

      /* the entry's x — the rules start here */
      const xEntry = data.entry ? xOf(data.entry.time) : null;

      /* THE FLOOR */
      if (data.floor) {
        const y = yOf(data.floor.price);
        if (y != null && y > 0 && y < H) {
          const xEnd = data.floor.brokeAt ? xOf(data.floor.brokeAt) ?? right : right;
          rule(xEntry, y, xEnd, data.bear, data.hot === 'floor' ? 1 : 0.75);
          figure(`${data.floor.price.toFixed(2)}${data.floor.brokeAt ? ' broke' : ''}`, y, data.bear, false);
        }
      }

      /* THE ENTRY — the paper desk's grammar (Noah, 2026-09-26: the position chip in the silver ring): a thin silver rule
         from the entry candle to a CHIP at the right edge, "ENTRY 0.75" in a silver ring on the tape's ground; no trace to
         the left — an entry is an event, not a level */
      if (data.entry) {
        const y = yOf(data.entry.price);
        if (y != null && y > 0 && y < H) {
          const word = `ENTRY ${data.entry.mid.toFixed(2)}`;
          ctx.font = `700 ${8.5 * vr}px ${MONO}`;
          const tw = ctx.measureText(word).width;
          const chipW = tw + 12 * hr;
          const chipH = 16 * vr;
          const chipX = right - chipW;
          rule(xEntry, y, chipX, data.silver, data.hot === 'entry' ? 1 : 0.75, false);
          ctx.fillStyle = data.bg;
          ctx.strokeStyle = data.silver;
          ctx.lineWidth = Math.max(1, Math.round(vr));
          ctx.globalAlpha = data.hot === 'entry' ? 1 : 0.92;
          ctx.beginPath();
          ctx.roundRect(chipX, y - chipH / 2, chipW, chipH, 3 * vr);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = data.silver;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(word, chipX + chipW / 2, y + 0.5 * vr);
        }
      }

      /* THE TARGETS — the ladder at the edge */
      for (const t of data.targets) {
        const y = yOf(t.price);
        if (y == null || y < 4 * vr || y > H - 4 * vr) continue;
        const hot = data.hot === `target-${t.level}`;
        const tickW = (t.won ? 14 : 10) * hr;
        ctx.fillStyle = data.bull;
        ctx.globalAlpha = hot ? 1 : t.won ? 0.95 : 0.8;
        ctx.fillRect(right - tickW, y - (t.won ? 2 : 1) * vr, tickW, (t.won ? 4 : 2) * vr);
        ctx.globalAlpha = 1;
        ctx.font = `700 ${8.5 * vr}px ${MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = data.bull;
        ctx.fillText(String(t.level), right - tickW - 4 * hr, y);
        if (hot) {
          ctx.font = `600 ${9 * vr}px ${MONO}`;
          ctx.fillText(t.price.toFixed(2), right - tickW - 14 * hr, y);
        }
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
