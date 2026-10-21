import type { ISeriesPrimitive, SeriesAttachedParameter, Time, IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ExpectedMoveCone } from '../../data/expectedMove';

/*
==================================================
  SLAYER TERMINAL - EXPECTED-MOVE LAYER — T-9
  (components/gex/expectedMovePrimitive.ts)
==================================================

  Draws data/expectedMove.ts on the tape: the heat the options claim from
  here to the bell, as the Map's day box paints it. The engine is pure and
  proven headless; this file is only geometry.

  THE FIELD ALONE (Noah, 2026-10-15, on the √t arcs behind the bar: "what is
  this?" … "yes do both"): the envelope since the open — the ±1σ and ±2σ
  lines and the ticks where a close left them — is no longer drawn. The
  engine still measures it (the crossings stay a fact the card could read);
  the tape shows only what is ahead. The tip's claim stays in white, spot's
  ink at furniture alpha, since it is a claim ABOUT spot.

  THE FIELD STANDS ON AN ANCHOR BAR. Future minutes map through LOGICAL
  coordinates from that bar: a point m minutes out sits at `anchor + m /
  barMinutes`, which lands fractional strides (a 12.5-minute remainder on
  5-minute bars) exactly where they belong instead of snapping them to a
  slot. In session the anchor is the live bar and the field draws on the
  runway — the whitespace the chart keeps to the right of it (ensureRunway).
  Out of hours the chart hands the STAGE bar instead — the minute of the last
  session the wall clock is at, the Map's day box's clock — and the field
  runs from there to the close UNDER the bars that followed: the heat the
  options claimed at that minute, with how the session actually went drawn
  over it.

  THE 0DTE COLLAPSE IS DRAWN, NOT PADDED. By late afternoon the forward claim
  is nearly nothing; the directive warns that an honest zero-width cone can
  read as a broken overlay. The answer here is not a minimum width — inflating
  the geometry would draw a claim the options are not making — it is the TAG:
  the tip always prints `EM ±$…`, so a collapsed cone reads "the claim is
  ±$0.04" rather than "the overlay died". The edges still converge to their
  point, which is the correct picture of the correct fact.
*/

/* Spot's white, at furniture alpha — the tip's tag. */
const INK = '255,255,255';
const TAG_ALPHA = 0.62;

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** Everything one paint needs, swapped as a unit so a half-updated frame
    cannot pair yesterday's cone with today's bar grid. */
import { drawThermalField, type ThermalCache, type ThermalInks, type ThermalSample } from './thermalFieldPrimitive';

export interface ConeData {
  cone: ExpectedMoveCone;
  /** The DISPLAYED bars' times — the same grid the engine's session slice
      came from, so every past point is an exact hit. */
  barTimes: number[];
  barMinutes: number;
  /** The bar the field stands on, an index into barTimes — the last bar by rest (the live bar, the runway ahead); on
      the stage out of hours, the stage minute's bar, the session's own bars ahead (2026-10-15) */
  anchor?: number;
}

class ExpectedMoveRenderer {
  private cache: { current: ThermalCache | null } = { current: null };
  constructor(private source: ExpectedMovePrimitive) {}

  draw(target: DrawTarget): void {
    const src = this.source;
    const chart = src.chart;
    const series = src.series;
    const data = src.data;
    if (!chart || !series || !data) return;
    const { cone, barTimes, barMinutes } = data;
    if (cone.forward.length === 0) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const w = scope.mediaSize.width * hr;

      const ts = chart.timeScale();
      /* MEASURED, not assumed: v5.2's logicalToCoordinate mishandles a
         FRACTIONAL logical — logical 610 mapped to x 1064 while 610.263
         returned 0, which dragged the cone's exact-close tip to the left
         edge and wrapped the fill across the whole tape. Integers go
         direct; fractions interpolate between their integer neighbours,
         which is exact because the logical axis is linear in x. */
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

      ctx.save();

      /* ── the forward claim, as THE THERMAL FIELD (Noah, 2026-10-15: "make the expected move overlay have the same
         thermal look thing as my pinpoint map one") — the Map's day box paints where price is likelier to be between now
         and the close as heat, one column a minute: the warm core at the centre, yellow halfway out, cool at one move,
         clear at two. The same painter here, on Terrain's own √t cone from the last close: a minute's edges read between
         the forward points that bracket it, its column from that minute's x to the next on the runway. The wash and the
         four lines the forward half wore are gone; the field is the shape. The anchor is the bar the host named — the
         live bar, or the stage's — and the columns run from it whether the bars ahead exist or not. ──────────────── */
      const anchor = Math.max(0, Math.min(barTimes.length - 1, data.anchor ?? barTimes.length - 1));
      const inks = src.inks;
      const fw = cone.forward;
      if (fw.length >= 2 && inks) {
        const last = fw[fw.length - 1].minutesAhead;
        const mid = fw[0].up1;
        const samples: ThermalSample[] = [];
        let k = 0;
        for (let m = 0; m <= last; m++) {
          while (k + 1 < fw.length - 1 && fw[k + 1].minutesAhead <= m) k++;
          const a = fw[k];
          const b = fw[Math.min(fw.length - 1, k + 1)];
          const u = b.minutesAhead > a.minutesAhead ? Math.max(0, Math.min(1, (m - a.minutesAhead) / (b.minutesAhead - a.minutesAhead))) : 0;
          const lerp = (p: number, q: number) => p + (q - p) * u;
          const x = logicalToX(anchor + m / barMinutes);
          const yHi2 = priceToY(lerp(a.up2, b.up2));
          const yHi1 = priceToY(lerp(a.up1, b.up1));
          const yMid = priceToY(mid);
          const yLo1 = priceToY(lerp(a.dn1, b.dn1));
          const yLo2 = priceToY(lerp(a.dn2, b.dn2));
          if (x === null || yHi2 === null || yHi1 === null || yMid === null || yLo1 === null || yLo2 === null) continue;
          const prev = samples[samples.length - 1];
          if (prev && x <= prev.x) continue;
          samples.push({ x, yHi2, yHi1, yMid, yLo1, yLo2 });
        }
        drawThermalField(ctx, samples, inks, w, scope.mediaSize.height * vr, this.cache);
      }

      /* ── the tip's claim, in words ─────────────────────────────────────
         Always printed while the forward half exists — this is what keeps a
         collapsed 0DTE cone reading as a fact instead of a failure. */
      if (cone.forward.length > 0) {
        const tip = cone.forward[cone.forward.length - 1];
        const tipW1 = tip.up1 - cone.forward[0].up1; // forward[0] is spot exactly
        const label = `EM ±$${tipW1.toFixed(2)}`;
        ctx.font = `${9 * vr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(label).width;
        const boxW = textW + 4 * 2 * hr;
        const boxH = 13 * vr + 2 * 2 * vr;
        const tipX = logicalToX(anchor + tip.minutesAhead / barMinutes);
        const tipY = priceToY(tip.up1);
        if (tipX !== null && tipY !== null) {
          /* Left of the tip, clamped onto the paint; riding the upper edge so
             it never sits on the live price line. */
          const x = Math.max(0, Math.min(w - boxW, tipX - boxW - 4 * hr));
          const top = Math.max(0, tipY - boxH - 2 * vr);
          ctx.fillStyle = 'rgba(10,10,10,0.55)';
          ctx.fillRect(x, top, boxW, boxH);
          ctx.fillStyle = `rgba(${INK},${TAG_ALPHA})`;
          ctx.fillText(label, x + 4 * hr, top + boxH / 2);
        }
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
  /* Under the tape, like the session rules — the candles are the subject and
     the claim is context. */
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): ExpectedMoveRenderer {
    return this._renderer;
  }
}

export class ExpectedMovePrimitive implements ISeriesPrimitive<Time> {
  /** The field's inks, handed by the host off the chart's own box (thermalFieldPrimitive ThermalInks); null draws no
      forward field */
  inks: ThermalInks | null = null;
  setInks(next: ThermalInks | null): void {
    this.inks = next;
    this.requestUpdate?.();
  }
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  data: ConeData | null = null;
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
  }

  updateAllViews(): void {}

  paneViews(): ExpectedMovePaneView[] {
    return this._paneViews;
  }

  /**
   * Swap what is drawn. No deep compare here, unlike the session layer's
   * setLines: the cone's spot re-anchor moves on every tick while the overlay
   * is on, so consecutive frames genuinely differ — comparing ~400 points to
   * discover that would cost more than the repaint it saves. Only the
   * off→off case is skipped.
   */
  setData(next: ConeData | null): void {
    const wasOff = this.data === null;
    this.data = next;
    if (!(wasOff && next === null)) this.requestUpdate?.();
  }
}
