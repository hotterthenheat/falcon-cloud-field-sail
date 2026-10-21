import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time, UTCTimestamp } from 'lightweight-charts';

/*
==================================================
  SLAYER TERMINAL - THE PLAYHEAD
  (components/gex/playheadPrimitive.ts)

  The minute the day is standing on: the last print
  while the session runs, the replayed minute while
  it is rewound. One rule, on the price and on the
  dealer book, so the cut between what printed and
  what is still ahead is the same line on both.
==================================================
*/

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

class PlayheadRenderer {
  constructor(private readonly source: PlayheadPrimitive) {}
  draw(target: DrawTarget): void {
    const { chart, time, color } = this.source;
    if (!chart || time == null) return;
    const xMedia = chart.timeScale().timeToCoordinate(time);
    if (xMedia == null) return;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const h = scope.mediaSize.height * scope.verticalPixelRatio;
      const x = Math.round(xMedia * hr) + 0.5;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1, hr);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.restore();
    });
  }
}

class PlayheadPane {
  private readonly _renderer: PlayheadRenderer;
  constructor(source: PlayheadPrimitive) {
    this._renderer = new PlayheadRenderer(source);
  }
  zOrder(): 'normal' {
    return 'normal';
  }
  renderer(): PlayheadRenderer {
    return this._renderer;
  }
}

/** A vertical rule at one minute. `color` is a resolved ink — a canvas cannot read a token. */
export class PlayheadPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  requestUpdate?: () => void;
  time: UTCTimestamp | null = null;
  color = 'rgba(186, 198, 216, 0.9)';
  private readonly _views: PlayheadPane[];
  constructor() {
    this._views = [new PlayheadPane(this)];
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
  paneViews(): PlayheadPane[] {
    return this._views;
  }
  setTime(time: UTCTimestamp | null): void {
    if (this.time === time) return;
    this.time = time;
    this.requestUpdate?.();
  }
  setColor(color: string): void {
    if (this.color === color) return;
    this.color = color;
    this.requestUpdate?.();
  }
}
