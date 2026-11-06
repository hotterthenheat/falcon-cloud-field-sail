import { MismatchDirection, type Logical, type ISeriesPrimitive, type SeriesAttachedParameter, type Time, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { GexSnapshot } from '../../types/market';
import { nySession } from '../../core/nyTime';
import { dealerOf } from '../../core/dealerSign';
import { fmtStrikePx } from '../../core/format';
import type { NodeLook } from '../../data/deskPrefs';
import { NODE_CAP, NODE_SHARE, selectNodeStrikes, type KeptLevel } from './nodeStrikes';
import type { NodeConcept } from './nodeConcept';
import { PHONE_ROW_PX, fitEdgeLabels } from './edgeLabelFit';
import { RibbonCache, drawRibbons } from './nodeRibbon';
import { LEVELS_LABELS, drawLevels, levelInk, pickLevels, spaceLevels, type LevelPick } from './nodeLevels';
import { heatInks, heatPalette, layoutHeatLabels, onHeatPalette, paintHeatLabels, type HeatLabel } from './nodeHeat';
import { meterLayer, threadInk, ThreadsLook } from './nodeThreads';

/*
  The exposure field: one filled band per strike, from the midpoint of the strike below to the midpoint of the
  strike above. A coordinate the scale cannot see is skipped. A row shorter than one device pixel is drawn at one
  pixel. No strike is dropped because a neighbor is louder. A cell with no reading is left empty.

  The colour is a perceptual ramp on the cell's size against the field's own scale (the 98th percentile of every cell,
  so one freak print does not flatten the rest): dim navy for the quiet cells, rising through teal and green to yellow
  where dealers are long gamma (their hedging absorbs a move), and through violet and rose to amber where they are short
  it (their hedging pushes a move along). Small cells recede in alpha as well as in light.
*/

/* The two ramps, low to high: lightness rises monotonically along each */
const POS_STOPS: readonly (readonly [number, number, number])[] = [
  [24, 38, 66],
  [27, 84, 112],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];
const NEG_STOPS: readonly (readonly [number, number, number])[] = [
  [24, 38, 66],
  [74, 44, 120],
  [156, 47, 143],
  [232, 84, 63],
  [252, 166, 54],
];
/** Colour steps per side */
const STEPS = 32;
const rampAt = (stops: readonly (readonly [number, number, number])[], t: number): [number, number, number] => {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
};
/** A cell's alpha at strength t: quiet cells recede, and even the loudest stays see-through so a candle reads on it */
const alphaAt = (t: number): number => 0.05 + 0.32 * Math.pow(Math.max(0, Math.min(1, t)), 0.9);
const LUT: { pos: string[]; neg: string[]; posSolid: string[]; negSolid: string[] } = { pos: [], neg: [], posSolid: [], negSolid: [] };
for (let s = 0; s < STEPS; s++) {
  const t = (s + 0.5) / STEPS;
  const p = rampAt(POS_STOPS, t);
  const n = rampAt(NEG_STOPS, t);
  const al = alphaAt(t).toFixed(3);
  LUT.pos.push(`rgba(${p[0]},${p[1]},${p[2]},${al})`);
  LUT.neg.push(`rgba(${n[0]},${n[1]},${n[2]},${al})`);
  LUT.posSolid.push(`rgb(${p[0]},${p[1]},${p[2]})`);
  LUT.negSolid.push(`rgb(${n[0]},${n[1]},${n[2]})`);
}
/** The heat as context under the beads: a quarter of the light at most, the quiet cells all but gone */
const faintAlphaAt = (t: number): number => 0.015 + 0.22 * Math.pow(Math.max(0, Math.min(1, t)), 1.35);
const FAINT: { pos: string[]; neg: string[] } = { pos: [], neg: [] };
for (let s = 0; s < STEPS; s++) {
  const t = (s + 0.5) / STEPS;
  const p = rampAt(POS_STOPS, t);
  const n = rampAt(NEG_STOPS, t);
  const al = faintAlphaAt(t).toFixed(3);
  FAINT.pos.push(`rgba(${p[0]},${p[1]},${p[2]},${al})`);
  FAINT.neg.push(`rgba(${n[0]},${n[1]},${n[2]},${al})`);
}

/* The beads' own ramps, the house heat's two ends lifted off the ground so a 1px dot still reads: dealers long gamma
   climb glacier teal through ice to white, short gamma climb ember to amber */
const BEAD_POS: readonly (readonly [number, number, number])[] = [
  [34, 128, 150],
  [68, 165, 197],
  [140, 203, 226],
  [214, 237, 248],
  [255, 255, 255],
];
const BEAD_NEG: readonly (readonly [number, number, number])[] = [
  [150, 42, 22],
  [196, 72, 26],
  [228, 120, 36],
  [242, 160, 50],
  [250, 200, 80],
];
const BEADS: { pos: [number, number, number][]; neg: [number, number, number][] } = { pos: [], neg: [] };
for (let s = 0; s < STEPS; s++) {
  const t = (s + 0.5) / STEPS;
  BEADS.pos.push(rampAt(BEAD_POS, t));
  BEADS.neg.push(rampAt(BEAD_NEG, t));
}
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
/** The beads' ramps as CSS gradients, low to high — the key's swatches */
export const BEAD_RAMP_CSS = {
  pos: `linear-gradient(90deg, ${BEAD_POS.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
  neg: `linear-gradient(90deg, ${BEAD_NEG.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
} as const;

export type { NodeLook };

/** The ramps as CSS gradients (the legend's scale) and their top inks: `put` is the long-gamma side (positive dealer
    gamma, absorbs), `call` the short-gamma side — names the cards and keys have always read */
export const FIELD_RAMP_CSS = {
  pos: `linear-gradient(90deg, ${POS_STOPS.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
  neg: `linear-gradient(90deg, ${NEG_STOPS.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
} as const;
const top = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const BEAD_INK_CSS = { put: top(POS_STOPS[3]), call: top(NEG_STOPS[3]) } as const;

/* The field's raster reaches this share of the pane past each side (x) and above and below (y), and is redrawn this long
   after the view last moved */
const RASTER_MX = 0.35;
const RASTER_MY = 0.25;
const SETTLE_MS = 120;

/** The heat's seam between two strikes' bands, device px, by the row's height. Wide enough that neighbouring strikes stay strata. */
const heatInset = (h: number): number => (h >= 8 ? Math.max(2, Math.round(h * 0.28)) : h >= 4 ? 1 : 0);

/** The cell under the pointer, as the card reads it */
export interface BeadHit {
  strike: number;
  /** the cell's bar time, and its column's index in the field */
  time: number;
  ci: number;
  /** the cell's dealer gamma, dollars per 1% (positive: dealers long gamma); its share of the column's gross; the strike's
      value at the day's first column on or after the open — null where the field holds none */
  value: number;
  share: number;
  open: number | null;
  /** the long-gamma side, and the cell's strength against the field's scale */
  put: boolean;
  t: number;
  mark?: 'born' | 'grew' | 'flipped' | 'died';
  tag?: 'rejected' | 'absorbed' | 'broke';
  firm?: boolean;
  /** the cell's centre and half-sizes on the pane, CSS px */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** The focused level's ink. Mirrors palette FOCUS/SUPREME. */
export type FocusInk = 'focus' | 'supreme';
const INK_RGB: Record<FocusInk, readonly [number, number, number]> = {
  focus: [199, 211, 232],
  supreme: [234, 0, 255],
};

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
  bitmapSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** Which exposure the field draws. Gamma is the grid's `value`; delta and vega ride beside it where a host hands them. */
export type TrailGreek = 'gex' | 'dex' | 'vex';
const levelValue = (l: GexSnapshot['levels'][number], greek: TrailGreek): number => (greek === 'gex' ? l.value : greek === 'dex' ? (l.dex ?? 0) : (l.vex ?? 0));

class FieldRenderer {
  constructor(private source: GexTrailsPrimitive) {}

  private cacheKey = '';
  /** The field, rasterized: a hover repaint blits this, and a pan or zoom maps it until the gesture rests */
  private bmp: HTMLCanvasElement | null = null;
  /* The raster's own frame, to map it onto a moved view */
  private rMx = 0;
  private rMy = 0;
  private rRev = -1;
  private rHr = 1;
  private rVr = 1;
  private rRefLogical = 0;
  private rXRef = 0;
  private rBar = 0;
  private rPrice = 0;
  private rYa = 0;
  private rYb = 0;
  private settle = 0;
  private rebuildNext = false;
  private movedAt = 0;

  /** One rebuild after the gesture stops. Re-arming during the gesture never paints. */
  private armSettle(src: GexTrailsPrimitive): void {
    this.movedAt = performance.now();
    if (this.settle) return;
    const wait = () => {
      if (performance.now() - this.movedAt < SETTLE_MS) {
        this.settle = requestAnimationFrame(wait);
        return;
      }
      this.settle = 0;
      this.cacheKey = '';
      /* the resting frame re-rasters, never maps the old raster again */
      this.rebuildNext = true;
      src.requestUpdate?.();
    };
    this.settle = requestAnimationFrame(wait);
  }

  draw(target: DrawTarget): void {
    this.drawField(target);
    this.source.afterDraw?.();
  }

  private drawField(target: DrawTarget): void {
    const src = this.source;
    const heat = src.concept === 'heat';
    if ((src.look === 'beads' || src.look === 'ribbon' || src.look === 'levels') && !heat) return;
    const cols = src.cols;
    /* hard bail: never draw a field that can blow the page (too many columns, no strikes, or disabled) */
    if (!src.enabled || !src.chart || !src.series || cols.length === 0 || cols.length > 2000 || src.strikes.length === 0 || !(src.ref > 0)) return;
    const series = src.series;
    const ts = src.chart.timeScale();
    const vis = ts.getVisibleRange();
    if (!vis) return;
    const barSec = src.barSec;
    const fromT = Number(vis.from) - barSec * 2;
    const toT = Number(vis.to) + barSec * 2;
    const first = src.colIndexAtOrAfter(fromT);
    const last = src.colIndexAtOrAfter(toT + 1e-6); // exclusive
    if (last <= first) return;
    /* the raster's reach past the view, in bars through the logical range (a session gap does not shorten it) */
    const barSpacing = ts.options().barSpacing ?? 6;
    let rFirst = first;
    let rLast = last;
    const lr = ts.getVisibleLogicalRange();
    const paneW = src.chart.paneSize(0).width;
    if (lr && paneW > 0) {
      const mB = Math.ceil((paneW * RASTER_MX) / Math.max(0.5, barSpacing)) + 2;
      const at = (i: number, dir: MismatchDirection) => {
        const d = series.dataByIndex(i, dir);
        return d ? Number(d.time) : null;
      };
      const tL = at(Math.floor(lr.from) - mB, MismatchDirection.NearestRight);
      const tR = at(Math.ceil(lr.to) + mB, MismatchDirection.NearestLeft);
      rFirst = Math.min(first, src.colIndexAtOrAfter(Math.min(fromT, (tL ?? fromT) - barSec * 2)));
      rLast = Math.max(last, src.colIndexAtOrAfter(Math.max(toT, (tR ?? toT) + barSec * 2) + 1e-6));
    }
    const focus = src.focusStrike;
    const ink = INK_RGB[src.focusInk];
    const strikes = src.strikes;
    const R = strikes.length;
    if (cols.length > 2000) return;
    /* Rows are prices. A strike the scale cannot see is not drawn, and nothing is spaced across the pane in its place. */
    const paneH = src.chart.paneSize(0).height;
    const pTop = series.coordinateToPrice(0);
    const pBot = paneH > 0 ? series.coordinateToPrice(paneH) : null;
    let rLo = 0;
    let rHi = R;
    /* only the strikes that matter are drawn (nodeStrikes.ts); the rest stay in the rail and on hover */
    let keep: ReadonlySet<number> | null = null;
    if (pTop != null && pBot != null && pTop !== pBot) {
      const loP = Math.min(pTop, pBot);
      const hiP = Math.max(pTop, pBot);
      let i = 0;
      while (i < R && strikes[i] < loP) i++;
      let j = i;
      while (j < R && strikes[j] <= hiP) j++;
      rLo = Math.max(0, i - 1);
      rHi = Math.min(R, j + 1);
      keep = src.keptRows(i, j, loP, hiP);
    }
    /* An empty scale maps every strike to one y. Painting that is the stack. Wait for a real scale. */
    if (rHi - rLo >= 2) {
      const yA = series.priceToCoordinate(strikes[rLo]);
      const yB = series.priceToCoordinate(strikes[rHi - 1]);
      if (yA == null || yB == null || yA === yB) return;
    }

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const wCss = scope.mediaSize.width;
      const halfW = barSpacing * 0.5;

      const x0 = ts.timeToCoordinate(cols[first].time as Time);
      const g0 = src.groundRgb();
      const light = (0.299 * g0[0] + 0.587 * g0[1] + 0.114 * g0[2]) / 255 > 0.55;
      const probeStrike = strikes[Math.min(R - 1, Math.max(rLo, (rLo + rHi) >> 1))] ?? 0;
      const probeA = series.priceToCoordinate(probeStrike) ?? -1;
      const probeB = series.priceToCoordinate(probeStrike + 1) ?? -1;
      /* THE PAN IS THE LOGICAL RANGE TOO (the partner tree's a61adbf: "the trails keep lagging behind the candles then pop
         onto them"): the first column's pixel can be null, and then nothing in the key moved under a pan — the stale
         bitmap was blitted in place. The visible logical range moves with every pan and every glide frame. */
      const lr = ts.getVisibleLogicalRange();
      const pan = lr ? `${lr.from.toFixed(3)}:${lr.to.toFixed(3)}` : 'none';
      const key = `${src.rev}|${wCss}|${scope.mediaSize.height}|${barSpacing.toFixed(3)}|${x0}|${pan}|${first}|${last}|${probeA.toFixed(2)}|${probeB.toFixed(2)}|${hr}|${vr}|${focus}|${src.focusInk}|${src.look}|${src.keptKey}|${src.concept}|${light}|${heat ? heatPalette() : ''}`;
      const cached = key === this.cacheKey && !!this.bmp;
      /* A moved view maps the last raster: both axes are affine, so one drawImage puts every cell where this frame's
         scales want it, until the gesture rests (SETTLE_MS) or the view leaves the raster or the scale drifts too far */
      let scrolled = false;
      const bmp0 = this.bmp;
      if (!cached && !this.rebuildNext && bmp0 && this.rRev === src.rev && this.rHr === hr && this.rVr === vr && this.rBar > 0 && this.rYb !== this.rYa) {
        const xRef = ts.logicalToCoordinate(this.rRefLogical as Logical);
        const yA = series.priceToCoordinate(this.rPrice);
        const yB = series.priceToCoordinate(this.rPrice + 1);
        if (xRef !== null && yA !== null && yB !== null) {
          this.movedAt = performance.now();
          const sx = barSpacing / this.rBar;
          const sy = (yB - yA) / (this.rYb - this.rYa);
          const dX = (xRef + sx * (-this.rMx / hr - this.rXRef)) * hr;
          const dY = (yA + sy * (-this.rMy / vr - this.rYa)) * vr;
          const dW = bmp0.width * sx;
          const dH = bmp0.height * sy;
          const covers = dX <= 0.5 && dX + dW >= scope.bitmapSize.width - 0.5 && dY <= 0.5 && dY + dH >= scope.bitmapSize.height - 0.5;
          if (covers && sx > 0.5 && sx < 2.5 && sy > 0.5 && sy < 2) {
            ctx.drawImage(bmp0, dX, dY, dW, dH);
            scrolled = true;
            this.armSettle(src);
          }
        }
      }

      if (!cached && !scrolled) {
        /* margins only while the view moves (or right after it rests) */
        const wide = this.rebuildNext || performance.now() - this.movedAt < SETTLE_MS;
        const mxPx = wide ? Math.round(scope.bitmapSize.width * RASTER_MX) : 0;
        const myPx = wide ? Math.round(scope.bitmapSize.height * RASTER_MY) : 0;
        const mxCss = mxPx / hr;
        const cFrom = wide ? rFirst : first;
        const cTo = wide ? rLast : last;
        /* each row's edges, for the focus outline. A strike the scale cannot see stays NaN.
           Do not space the book across the pane — that fallback is the stack. */
        const edgeY = new Float64Array(R + 1);
        for (let r = 0; r <= R; r++) {
          const lo = r === 0 ? strikes[0] - (R > 1 ? (strikes[1] - strikes[0]) / 2 : 0.5) : (strikes[r - 1] + strikes[r]) / 2;
          const y = series.priceToCoordinate(r === R ? strikes[R - 1] + (R > 1 ? (strikes[R - 1] - strikes[R - 2]) / 2 : 0.5) : lo);
          edgeY[r] = y === null || !Number.isFinite(y) ? NaN : y * vr;
        }
        const hBmp = scope.bitmapSize.height;
        /* one path per ink step and side, cells of a row merged across touching bars of the same step */
        const paths = new Map<number, Path2D>();
        const pathFor = (k: number) => {
          let p = paths.get(k);
          if (!p) paths.set(k, (p = new Path2D()));
          return p;
        };
        const xl = new Float64Array(cTo - cFrom);
        const xr = new Float64Array(cTo - cFrom);
        for (let c = cFrom; c < cTo; c++) {
          const x = ts.timeToCoordinate(cols[c].time as Time);
          if (x === null || x < -halfW - mxCss || x > wCss + halfW + mxCss) {
            xl[c - cFrom] = NaN;
            continue;
          }
          xl[c - cFrom] = Math.round((x - halfW) * hr);
          xr[c - cFrom] = Math.round((x + halfW) * hr);
        }
        const vals = src.values;
        const ref = src.ref;
        /* THE HEAT'S CUT, MOMENT BY MOMENT: a cell is lit when it matters in its own column — nodeStrikes' rule (a fifth
           of the largest strike in view, never less than half the column's largest anywhere, NODE_CAP at most) — so a
           level that ruled three sessions ago is lit there and only there; the walls, the flip and the pin are lit
           through the newest session. Everything under the cut is a whisper of context. */
        const litCut = heat ? new Float64Array(cTo - cFrom).fill(Infinity) : null;
        let anchorFrom = Infinity;
        if (litCut) {
          const sizes = new Float64Array(Math.max(1, rHi - rLo));
          for (let c = cFrom; c < cTo; c++) {
            if (Number.isNaN(xl[c - cFrom])) continue;
            const base = c * R;
            let all = 0;
            for (let r = 0; r < R; r++) {
              const v = vals[base + r];
              if (v === v && Math.abs(v) > all) all = Math.abs(v);
            }
            let n = 0;
            let top = 0;
            for (let r = rLo; r < rHi; r++) {
              const v = vals[base + r];
              if (v !== v || v === 0) continue;
              const a = Math.abs(v);
              sizes[n++] = a;
              if (a > top) top = a;
            }
            if (!n) continue;
            let cut = NODE_SHARE * Math.max(top, all / 2);
            if (n > NODE_CAP) {
              const s = sizes.subarray(0, n).sort();
              cut = Math.max(cut, s[n - NODE_CAP]);
            }
            litCut[c - cFrom] = cut;
          }
          if (cols.length) anchorFrom = src.colIndexAtOrAfter(nySession(cols[cols.length - 1].time * 1000).open / 1000 - 5.5 * 3600);
        }
        /* A row runs from the midpoint below the strike to the midpoint above it. A coordinate the scale
           cannot see is skipped. A row shorter than one device pixel is drawn at one pixel. None is dropped. */
        for (let r = rLo; r < rHi; r++) {
          const ya = edgeY[r];
          const yb = edgeY[r + 1];
          if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
          let yTop = Math.round(Math.min(ya, yb));
          let yBot = Math.round(Math.max(ya, yb));
          if (yBot < -myPx || yTop > hBmp + myPx) continue;
          if (yBot - yTop < 1) yBot = yTop + 1;
          /* today's look draws only the kept strikes; the heat draws every strike, the rest as a whisper of context */
          if (!heat && keep && !keep.has(r)) continue;
          const anchor = heat && !!keep && keep.has(r);
          /* the heat's bands stand apart: a seam of ground between two strikes, so the field reads as strata, not a wall */
          if (heat) {
            const inset = heatInset(yBot - yTop);
            yTop += inset;
            yBot -= inset;
          }
          const dim = focus != null && strikes[r] !== focus;
          let runKey = -1;
          let runL = 0;
          let runR = 0;
          /* a lit heat band has a core: its middle drawn twice, so the band glows at its strike and softens to its seams */
          const coreT = heat ? Math.round(yTop + (yBot - yTop) * 0.28) : 0;
          const coreB = heat ? Math.round(yBot - (yBot - yTop) * 0.28) : 0;
          const flush = () => {
            if (runKey >= 0) {
              pathFor(runKey).rect(runL, yTop, runR - runL, yBot - yTop);
              if (heat && !(Math.floor((runKey % 1000) / 100) & 2) && coreB - coreT >= 1) pathFor(runKey + 10000).rect(runL, coreT, runR - runL, coreB - coreT);
            }
            runKey = -1;
          };
          for (let c = cFrom; c < cTo; c++) {
            const L = xl[c - cFrom];
            const v = vals[c * R + r];
            if (Number.isNaN(L) || Number.isNaN(v) || v === 0) {
              flush();
              continue;
            }
            const tt = Math.min(1, Math.abs(v) / ref);
            const step = Math.min(STEPS - 1, Math.floor(tt * STEPS));
            const quiet = !!litCut && Math.abs(v) < litCut[c - cFrom] && !(anchor && c >= anchorFrom);
            const k = (v > 0 ? 0 : 1) * 1000 + step + (dim ? 100 : 0) + (quiet ? 200 : 0);
            const Rr = xr[c - cFrom];
            if (k === runKey && Math.abs(L - runR) <= 1) {
              runR = Rr;
              continue;
            }
            flush();
            runKey = k;
            runL = L;
            runR = Rr;
          }
          flush();
        }
        const bw = scope.bitmapSize.width + 2 * mxPx;
        const bh = scope.bitmapSize.height + 2 * myPx;
        const bmp = this.bmp ?? document.createElement('canvas');
        if (bmp.width !== bw || bmp.height !== bh) {
          bmp.width = bw;
          bmp.height = bh;
        }
        const bctx = bmp.getContext('2d');
        if (bctx) {
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.clearRect(0, 0, bw, bh);
          bctx.setTransform(1, 0, 0, 1, mxPx, myPx);
          const hInk = heat ? heatInks(light) : null;
          for (const [k, path] of paths) {
            const step = k % 100;
            const flags = Math.floor((k % 1000) / 100);
            const s0 = Math.floor((k % 10000) / 1000);
            if (hInk) {
              bctx.globalAlpha = flags & 1 ? 0.4 : 1;
              bctx.fillStyle = (flags & 2 ? hInk.quiet : hInk.lit)[s0][step];
              bctx.fill(path);
              continue;
            }
            const faint = src.look === 'both';
            const side = s0 === 0 ? (faint ? FAINT.pos : LUT.pos) : faint ? FAINT.neg : LUT.neg;
            bctx.globalAlpha = flags & 1 ? 0.4 : 1;
            bctx.fillStyle = side[step];
            bctx.fill(path);
          }
          bctx.globalAlpha = 1;
          /* THE KING: in each moment, the heaviest cell in view gets a one-pixel foil on its strike. No bloom and no
             star — the band is already the brightest cell, and a glow over it buried the candle. Runs merge. */
          if (hInk) {
            const crown = hInk.crown;
            let runRow = -1;
            let runL = 0;
            let runR = 0;
            const flushKing = () => {
              if (runRow < 0) return;
              const ya = edgeY[runRow];
              const yb = edgeY[runRow + 1];
              if (Number.isFinite(ya) && Number.isFinite(yb)) {
                const mid = (Math.min(ya, yb) + Math.max(ya, yb)) / 2;
                const foil = Math.max(1, Math.round(vr));
                bctx.fillStyle = `rgba(${crown[0]},${crown[1]},${crown[2]},${light ? 0.45 : 0.62})`;
                bctx.fillRect(runL, Math.round(mid - foil / 2), Math.max(1, runR - runL), foil);
              }
              runRow = -1;
            };
            for (let c = cFrom; c < cTo; c++) {
              const L = xl[c - cFrom];
              if (Number.isNaN(L)) {
                flushKing();
                continue;
              }
              let best = -1;
              let bestA = 0;
              const base = c * R;
              for (let r = rLo; r < rHi; r++) {
                const v = vals[base + r];
                if (v === v && Math.abs(v) > bestA) {
                  bestA = Math.abs(v);
                  best = r;
                }
              }
              if (best < 0) {
                flushKing();
                continue;
              }
              if (best === runRow && Math.abs(L - runR) <= 1) {
                runR = xr[c - cFrom];
                continue;
              }
              flushKing();
              runRow = best;
              runL = L;
              runR = xr[c - cFrom];
            }
            flushKing();
          }
          /* the focused strike's row, outlined across the field */
          if (focus != null) {
            const r = strikes.indexOf(focus);
            if (r >= 0 && Number.isFinite(edgeY[r]) && Number.isFinite(edgeY[r + 1])) {
              bctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.9)`;
              const lw = Math.max(1, Math.round(vr));
              bctx.fillRect(-mxPx, Math.round(Math.min(edgeY[r], edgeY[r + 1])), bw, lw);
              bctx.fillRect(-mxPx, Math.round(Math.max(edgeY[r], edgeY[r + 1])) - lw, bw, lw);
            }
          }
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          this.bmp = bmp;
          this.cacheKey = key;
          this.rebuildNext = false;
          this.rMx = mxPx;
          this.rMy = myPx;
          this.rRev = src.rev;
          this.rHr = hr;
          this.rVr = vr;
          this.rRefLogical = ts.coordinateToLogical(wCss / 2) ?? 0;
          this.rXRef = ts.logicalToCoordinate(this.rRefLogical as Logical) ?? wCss / 2;
          this.rBar = barSpacing;
          this.rPrice = probeStrike;
          this.rYa = probeA;
          this.rYb = probeB;
          if (this.settle) {
            cancelAnimationFrame(this.settle);
            this.settle = 0;
          }
        }
      }
      if (!scrolled && this.bmp) ctx.drawImage(this.bmp, -this.rMx, -this.rMy);
    });
  }
}

/** A level the host names at the right edge with the nodes (the key levels' rungs): its price, its words long and short,
    its ink, and how much it matters when the edge is crowded */
export interface EdgeLevel {
  price: number;
  name: string;
  short: string;
  ink: string;
  rank: number;
}

/** One tag at the right edge as laid out this frame, CSS px */
interface EdgeTag {
  price: number;
  y: number;
  ty: number;
  text: string;
  ink: string;
  prio: number;
  w: number;
  zone: boolean;
  /** a wall, the flip, the supreme or the top node: dropped last when the edge is crowded */
  keep?: boolean;
}

/** A zone: one of the heaviest nodes now, outlined from the column it became one of them */
interface Zone {
  row: number;
  start: number;
  value: number;
}

const BEAD_R_MAX = 3.2;
const BEAD_MIN_PITCH = 3.2;
const TAG_H = 14;
const TAG_FONT = 9.5;
const TAG_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
/** Below this plot width the edge tags print short ("760 S +26.5M") */
const TAG_NARROW = 560;

/** Dollars, signed, short: +$26.5M / −$3.1B; `bare` drops the $ */
export function signedDollars(v: number, bare = false): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  const d = bare ? '' : '$';
  if (a >= 1e9) return `${sign}${d}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${d}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${d}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${d}${a.toFixed(0)}`;
}
/** The narrow tag's figure: no $, no decimal past three digits (+155M, −2.3B) */
function shortDollars(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  const [n, u] = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
  return `${sign}${n >= 100 ? n.toFixed(0) : n.toFixed(1)}${u}`;
}
const priceText = (p: number): string => fmtStrikePx(p);

let measureCanvas: HTMLCanvasElement | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  measureCanvas ??= document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

/**
 * The Slayer nodes, drawn under the candles. Levels (the default) are a faint dotted trace and a short rung at the
 * right edge (nodeLevels.ts) — the same grammar as the key-levels ladder, never a band through the candles. Beads are
 * small dots on the heavy strikes. The heaviest node is the brighter ink. A zone is a dotted trace from the bar it
 * became one. The edge tags carry the size and are painted on the top layer (TagsRenderer).
 */
class NodesRenderer {
  constructor(private source: GexTrailsPrimitive) {}
  private selKey = '';
  private sel: number[] = [];
  private zoneRev = -1;
  private zones: Zone[] = [];
  private ribbon = new RibbonCache();
  private levelsCache = new RibbonCache();
  private picksRev = -1;
  private picks: LevelPick[] = [];

  /** The biggest nodes at the newest column (the current book, in the field's model), once per hand-off */
  private levelPicks(src: GexTrailsPrimitive): LevelPick[] {
    if (this.picksRev === src.rev) return this.picks;
    this.picksRev = src.rev;
    const R = src.strikes.length;
    const C = src.cols.length;
    const rows: { strike: number; value: number }[] = [];
    if (R && C) {
      const base = (C - 1) * R;
      for (let r = 0; r < R; r++) rows.push({ strike: src.strikes[r], value: src.values[base + r] });
    }
    this.picks = pickLevels(rows);
    return this.picks;
  }

  /** The three heaviest nodes at the newest column, and the column each became one of them — once per hand-off */
  private zonesFor(src: GexTrailsPrimitive): Zone[] {
    if (this.zoneRev === src.rev) return this.zones;
    this.zoneRev = src.rev;
    const R = src.strikes.length;
    const C = src.cols.length;
    const vals = src.values;
    const out: Zone[] = [];
    this.zones = out;
    if (!R || !C) return out;
    const cN = C - 1;
    const rows: number[] = [];
    for (let r = 0; r < R; r++) {
      const v = vals[cN * R + r];
      if (Number.isFinite(v) && v !== 0) rows.push(r);
    }
    rows.sort((a, b) => Math.abs(vals[cN * R + b]) - Math.abs(vals[cN * R + a]));
    const Z = 3;
    for (const row of rows.slice(0, Z)) {
      let start = cN;
      for (let c = cN - 1; c >= 0; c--) {
        const v = vals[c * R + row];
        if (!Number.isFinite(v) || v === 0) break;
        const a = Math.abs(v);
        let above = 0;
        for (let r = 0; r < R && above < Z; r++) {
          const w = vals[c * R + r];
          if (r !== row && Number.isFinite(w) && Math.abs(w) > a) above++;
        }
        if (above >= Z) break;
        start = c;
      }
      out.push({ row, start, value: vals[cN * R + row] });
    }
    return out;
  }

  draw(target: DrawTarget): void {
    const src = this.source;
    src.chips = [];
    src.tags = [];
    src.beadRows = null;
    if (!src.enabled || !src.tagsOn || !src.chart || !src.series) return;
    const chart = src.chart;
    const series = src.series;
    const ts = chart.timeScale();
    const paneW = chart.paneSize(0).width;
    const paneH = chart.paneSize(0).height;
    if (!(paneW > 0) || !(paneH > 0)) return;
    const cols = src.cols;
    const strikes = src.strikes;
    const R = strikes.length;
    const vals = src.values;
    const ref = src.ref;
    const haveField = cols.length > 0 && cols.length <= 2000 && R > 0 && ref > 0;
    const narrow = paneW < TAG_NARROW;
    const barSpacing = ts.options().barSpacing ?? 6;
    const yOf = (p: number): number | null => {
      const y = series.priceToCoordinate(p);
      return y == null || !Number.isFinite(y) ? null : y;
    };

    /* the visible window, columns and rows, as the field reads it */
    let first = 0;
    let last = 0;
    let rLo = 0;
    let rHi = 0;
    let keep: ReadonlySet<number> = new Set<number>();
    if (haveField) {
      const vis = ts.getVisibleRange();
      if (vis) {
        first = src.colIndexAtOrAfter(Number(vis.from) - src.barSec * 2);
        last = src.colIndexAtOrAfter(Number(vis.to) + src.barSec * 2 + 1e-6);
      }
      const pTop = series.coordinateToPrice(0);
      const pBot = series.coordinateToPrice(paneH);
      if (pTop != null && pBot != null && pTop !== pBot) {
        const loP = Math.min(pTop, pBot);
        const hiP = Math.max(pTop, pBot);
        let i = 0;
        while (i < R && strikes[i] < loP) i++;
        let j = i;
        while (j < R && strikes[j] <= hiP) j++;
        rLo = i;
        rHi = j;
        keep = src.keptRows(i, j, loP, hiP);
      }
      /* an empty scale maps every strike to one y: wait for a real one */
      if (rHi - rLo >= 2) {
        const a = yOf(strikes[rLo]);
        const b = yOf(strikes[rHi - 1]);
        if (a == null || b == null || a === b) rHi = rLo;
      }
    }
    const fieldLive = haveField && last > first && rHi > rLo;
    const cN = cols.length - 1;
    const nowAt = (r: number) => (cN >= 0 ? vals[cN * R + r] : NaN);
    const rowGap = (r: number): number => {
      const y = yOf(strikes[r]);
      if (y == null) return 8;
      const up = r + 1 < R ? yOf(strikes[r + 1]) : null;
      const dn = r > 0 ? yOf(strikes[r - 1]) : null;
      const g = Math.min(up != null ? Math.abs(up - y) : Infinity, dn != null ? Math.abs(dn - y) : Infinity);
      return Number.isFinite(g) ? g : 8;
    };
    const ground = src.groundRgb();
    const light = (0.299 * ground[0] + 0.587 * ground[1] + 0.114 * ground[2]) / 255 > 0.55;
    const crown: readonly [number, number, number] = light ? [24, 24, 30] : [255, 255, 255];

    /* the strikes that bead: the ones that matter now (nodeStrikes.ts — a fifth of the largest in view, eight at most,
       the walls, the flip's strike and the pin always), each with a reading in the window */
    let selected: number[] = [];
    let strongRow = -1;
    if (fieldLive) {
      const key = `${src.keptKey}|${first}|${last}`;
      if (key !== this.selKey) {
        const pick: number[] = [];
        for (const r of keep) {
          if (r < rLo || r >= rHi) continue;
          for (let c = first; c < last; c++) {
            const v = vals[c * R + r];
            if (v === v && v !== 0) {
              pick.push(r);
              break;
            }
          }
        }
        this.sel = pick.sort((a, b) => a - b);
        this.selKey = key;
      }
      selected = this.sel;
      /* the heaviest node now: the selected row with the largest cell at the newest column */
      let best = 0;
      for (const r of selected) {
        const a = Math.abs(nowAt(r));
        if (a > best) {
          best = a;
          strongRow = r;
        }
      }
    }
    if (src.concept === 'heat') {
      src.heatLabels = [];
      if (!fieldLive) return;
      const levels = src.keptLevels;
      let top: number | null = null;
      let topA = 0;
      for (const l of levels) {
        if (l.value === l.value && Math.abs(l.value) > topA) {
          topA = Math.abs(l.value);
          top = l.price;
        }
      }
      const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft) as { close?: number } | null;
      const priceY = lastBar?.close != null ? yOf(lastBar.close) : null;
      const extras = (src.edgeLevels?.() ?? []).map(l => ({ price: l.price, role: l.short, ink: l.ink, rank: l.rank }));
      src.heatLabels = layoutHeatLabels(levels, yOf, paneW, paneH, src.chromeInset, priceY, top, light, extras);
      src.chips = src.heatLabels.map(l => ({ strike: l.price, left: l.x, top: l.ty - 9, bottom: l.ty + 9 }));
      return;
    }
    const levelsLook = src.look === 'levels';
    const zones = haveField && !levelsLook ? this.zonesFor(src).slice(0, paneH < 240 ? 2 : 3) : [];
    /* LEVELS (nodeLevels.ts): the book's biggest nodes now, one band each across every candle, spaced so none stacks */
    const bands = levelsLook && haveField && cN >= 0 ? spaceLevels(this.levelPicks(src), yOf) : [];
    if (import.meta.env?.DEV && typeof window !== 'undefined' && levelsLook)
      (window as unknown as { __levelsPick?: unknown }).__levelsPick = bands.map(l => ({ strike: l.strike, value: Math.round(l.value), t: +l.t.toFixed(3), y: Math.round(l.y), merged: l.merged }));

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const W = scope.mediaSize.width;
      const H = scope.mediaSize.height;
      ctx.save();

      /* ZONES: a dotted trace from the bar a node became one of the heaviest, stopping short of the label column */
      ctx.save();
      ctx.lineCap = 'butt';
      for (const z of zones) {
        if (z.row < rLo || z.row >= rHi || !keep.has(z.row)) continue;
        const y = yOf(strikes[z.row]);
        if (y == null) continue;
        const xs = ts.timeToCoordinate(cols[z.start].time as Time);
        const x0 = Math.max(0, (xs ?? 0) - barSpacing / 2);
        if (x0 >= W - 8) continue;
        const strong = z.row === strongRow;
        const t = Math.min(1, Math.abs(z.value) / (ref || 1));
        const ink = strong ? crown : (z.value > 0 ? BEADS.pos : BEADS.neg)[Math.min(STEPS - 1, Math.floor(t * STEPS))];
        const L = Math.round(x0 * hr);
        const Rr = Math.round((W - Math.min(108, W * 0.22)) * hr);
        if (Rr <= L) continue;
        const yc = Math.round(y * vr) + 0.5;
        ctx.strokeStyle = rgba(ink, 1);
        ctx.globalAlpha = strong ? 0.42 : 0.22;
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.setLineDash([2 * hr, 4 * hr]);
        ctx.beginPath();
        ctx.moveTo(L, yc);
        ctx.lineTo(Rr, yc);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      if (bands.length) {
        const x0 = ts.logicalToCoordinate(0 as Logical);
        const levelsNow = src.edgeLevels?.() ?? [];
        const roleShort = (strike: number, strong: boolean): string => {
          const lv = levelsNow.find(l => Math.abs(l.price - strike) < 1e-6);
          if (lv) return lv.short;
          if (src.supremeStrike != null && Math.abs(src.supremeStrike - strike) < 1e-6) return 'S';
          if (src.cwStrike != null && Math.abs(src.cwStrike - strike) < 1e-6) return 'CW';
          if (src.pwStrike != null && Math.abs(src.pwStrike - strike) < 1e-6) return 'PW';
          return strong ? 'Top' : 'N';
        };
        const measure = measureCtx();
        if (measure) measure.font = `${TAG_FONT}px ${TAG_MONO}`;
        let named = 0;
        let gutter = 0;
        for (const l of bands) {
          if (l.y < 0 || l.y > H || named >= LEVELS_LABELS) continue;
          named++;
          const short = roleShort(l.strike, l.rank === 0);
          const text = `${priceText(l.strike)}${short === 'N' ? '' : ` ${short}`} ${shortDollars(l.value)}`;
          gutter = Math.max(gutter, Math.ceil((measure ? measure.measureText(text).width : text.length * 6) + 16));
        }
        gutter = Math.min(W * 0.36, gutter);
        const lkey = `${src.rev}|${W}|${H}|${hr}|${vr}|${x0 == null ? 'x' : x0.toFixed(1)}|${gutter}|${light}|${src.supremeStrike}|${src.cwStrike}|${src.pwStrike}|${bands.map(l => `${l.strike}@${l.y.toFixed(1)}`).join(',')}`;
        const drawn = this.levelsCache.paint(ctx, lkey, scope.bitmapSize.width, scope.bitmapSize.height, b =>
          drawLevels(b, {
            levels: bands,
            x0: x0 == null ? 0 : x0 - barSpacing / 2,
            x1: W,
            gutter,
            H,
            hr,
            vr,
            ids: { supreme: src.supremeStrike, cw: src.cwStrike, pw: src.pwStrike },
            light,
          }),
        );
        /* the hover answers on a band's own row, within its swell */
        const rows = new Map<number, number>();
        for (const [strike, half] of drawn) {
          const r = strikes.indexOf(strike);
          if (r >= 0) rows.set(r, Math.max(2, half));
        }
        src.beadRows = rows;
      }

      if (fieldLive && src.look === 'ribbon') {
        /* RIBBON (nodeRibbon.ts): the same grid and window as the beads, each strike a waveform across time */
        const rowOf = (p: number | null): number => {
          if (p == null) return -1;
          for (let r = rLo; r < rHi; r++) if (Math.abs(strikes[r] - p) < 1e-6) return r;
          return -1;
        };
        const flipY = src.flipPrice != null ? yOf(src.flipPrice) : null;
        const x0 = ts.timeToCoordinate(cols[first].time as Time);
        const pA = yOf(strikes[rLo]) ?? -1;
        const pB = yOf(strikes[rHi - 1]) ?? -1;
        const rkey = `${src.rev}|${W}|${H}|${barSpacing.toFixed(3)}|${x0}|${first}|${last}|${rLo}|${rHi}|${pA.toFixed(2)}|${pB.toFixed(2)}|${hr}|${vr}|${strongRow}|${light}|${src.supremeStrike}|${src.cwStrike}|${src.pwStrike}|${flipY?.toFixed(2)}`;
        src.beadRows = this.ribbon.paint(ctx, rkey, scope.bitmapSize.width, scope.bitmapSize.height, b =>
          drawRibbons(b, {
            vals, R, strikes, first, last, rLo, rHi, ref, barSpacing, hr, vr, W, H,
            xOf: c => ts.timeToCoordinate(cols[c].time as Time),
            yOf,
            roomOf: r => rowGap(r) / 2 - 0.5,
            topRow: strongRow,
            supremeRow: rowOf(src.supremeStrike),
            cwRow: rowOf(src.cwStrike),
            pwRow: rowOf(src.pwStrike),
            flipY,
            crown,
            light,
          }),
        );
      }

      if (fieldLive && src.look !== 'heat' && src.look !== 'ribbon' && src.look !== 'levels' && selected.length) {
        /* the bar pitch the beads stand on: every bar, or every k-th once bars crowd under a few pixels */
        const k = Math.max(1, Math.ceil(BEAD_MIN_PITCH / Math.max(0.1, barSpacing)));
        const pitch = barSpacing * k;
        const rH = pitch / 2 - 0.5;
        const xs = new Float64Array(last - first).fill(NaN);
        let c0 = first - (first % k);
        if (c0 < first) c0 += k;
        for (let c = c0; c < last; c += k) {
          const x = ts.timeToCoordinate(cols[c].time as Time);
          if (x === null || x < -6 || x > W + 6) continue;
          xs[c - first] = x;
        }
        const ys = selected.map(r => yOf(strikes[r]));
        const beadRows = new Map<number, number>();
        const paths = new Map<number, Path2D>();
        const crownPath = new Path2D();
        const crownFaint = new Path2D();
        for (let i = 0; i < selected.length; i++) {
          const r = selected[i];
          const y = ys[i];
          if (y == null || y < -6 || y > H + 6) continue;
          /* no bead reaches its neighbour row's: half the gap to the nearest drawn row, less a hair */
          let gap = Infinity;
          for (let j = 0; j < selected.length; j++) {
            const o = ys[j];
            if (j !== i && o != null) gap = Math.min(gap, Math.abs(o - y));
          }
          const rCap = Math.max(0.6, Math.min(BEAD_R_MAX, rH, Number.isFinite(gap) ? gap / 2 - 0.5 : BEAD_R_MAX));
          const rFloor = Math.min(1, rCap);
          beadRows.set(r, rCap);
          const strong = r === strongRow;
          const yb = y * vr;
          for (let c = c0; c < last; c += k) {
            const x = xs[c - first];
            if (x !== x) continue;
            /* the group's largest cell, so a crowded zoom keeps the peaks */
            let v = NaN;
            for (let g = c; g < Math.min(last, c + k); g++) {
              const w = vals[g * R + r];
              if (w === w && w !== 0 && (v !== v || Math.abs(w) > Math.abs(v))) v = w;
            }
            if (v !== v) continue;
            const t = Math.min(1, Math.abs(v) / ref);
            if (t < 0.16) continue;
            const rad = Math.max(1, (rFloor + (rCap - rFloor) * Math.sqrt(t)) * hr);
            const xb = x * hr;
            if (strong) {
              const p = t > 0.18 ? crownPath : crownFaint;
              p.moveTo(xb + rad, yb);
              p.arc(xb, yb, rad, 0, Math.PI * 2);
              continue;
            }
            const step = Math.min(STEPS - 1, Math.floor(t * STEPS));
            const key = (v > 0 ? 0 : STEPS) + step;
            let p = paths.get(key);
            if (!p) paths.set(key, (p = new Path2D()));
            p.moveTo(xb + rad, yb);
            p.arc(xb, yb, rad, 0, Math.PI * 2);
          }
        }
        src.beadRows = beadRows;
        for (const [key, p] of paths) {
          const step = key % STEPS;
          const t = (step + 0.5) / STEPS;
          const ink = key < STEPS ? BEADS.pos[step] : BEADS.neg[step];
          ctx.fillStyle = rgba(ink, 0.38 + 0.48 * Math.pow(t, 0.6));
          ctx.fill(p);
        }
        /* the heaviest node now: the same ink, a step brighter, with no bloom */
        ctx.fillStyle = rgba(crown, 0.45);
        ctx.fill(crownFaint);
        ctx.fillStyle = rgba(crown, 0.92);
        ctx.fill(crownPath);
      }

      ctx.restore();
    });

    /* TAGS, laid out in CSS px: the zones with their role and size, and the host's levels; one a price, pushed apart */
    const levels = src.edgeLevels?.() ?? [];
    const tags: EdgeTag[] = [];
    const roleOf = (strike: number, strong: boolean): { name: string; short: string } => {
      const lv = levels.find(l => Math.abs(l.price - strike) < 1e-6);
      if (lv) return { name: lv.name, short: lv.short };
      if (src.supremeStrike != null && Math.abs(src.supremeStrike - strike) < 1e-6) return { name: 'Supreme', short: 'S' };
      if (src.cwStrike != null && Math.abs(src.cwStrike - strike) < 1e-6) return { name: 'Call wall', short: 'CW' };
      if (src.pwStrike != null && Math.abs(src.pwStrike - strike) < 1e-6) return { name: 'Put wall', short: 'PW' };
      return strong ? { name: 'Top node', short: 'Top' } : { name: 'Node', short: 'N' };
    };
    const used: number[] = [];
    /* the levels' names: the largest LEVELS_LABELS drawn bands, each with its role and its size (the rest stay unnamed) */
    let named0 = 0;
    for (const l of bands) {
      if (l.y < 0 || l.y > paneH || named0 >= LEVELS_LABELS) continue;
      named0++;
      const strong = l.rank === 0;
      const role = roleOf(l.strike, strong);
      const ink = rgba(levelInk(l, { supreme: src.supremeStrike, cw: src.cwStrike, pw: src.pwStrike }, light), 1);
      const text = `${priceText(l.strike)}${role.short === 'N' ? '' : ` ${role.short}`} ${shortDollars(l.value)}`;
      const named = role.short !== 'N' && role.short !== 'Top';
      tags.push({ price: l.strike, y: l.y, ty: l.y, text, ink, prio: strong ? 10 : named ? 9 : 9 - named0, keep: strong || named0 === 1 || named, w: 0, zone: true });
      used.push(l.strike);
    }
    for (const z of zones) {
      if (z.row < rLo || z.row >= rHi || !keep.has(z.row)) continue;
      const strike = strikes[z.row];
      const y = yOf(strike);
      if (y == null || y < 0 || y > paneH) continue;
      const strong = z.row === strongRow || (strongRow < 0 && z === zones[0]);
      const role = roleOf(strike, strong);
      const t = Math.min(1, Math.abs(z.value) / (ref || 1));
      const ink = rgba(strong ? crown : (z.value > 0 ? BEADS.pos : BEADS.neg)[Math.min(STEPS - 1, Math.floor(t * STEPS))], 1);
      const text = `${priceText(strike)}${role.short === 'N' ? '' : ` ${role.short}`} ${shortDollars(z.value)}`;
      const named = role.short !== 'N' && role.short !== 'Top';
      tags.push({ price: strike, y, ty: y, text, ink, prio: strong ? 10 : named ? 9 : 6, keep: strong || named, w: 0, zone: true });
      used.push(strike);
    }
    for (const l of levels) {
      if (used.some(p => Math.abs(p - l.price) < 1e-6)) continue;
      const y = yOf(l.price);
      if (y == null || y < 0 || y > paneH) continue;
      tags.push({ price: l.price, y, ty: y, text: narrow || l.rank < 7 ? `${l.short} ${priceText(l.price)}` : `${l.name} ${priceText(l.price)}`, ink: l.ink, prio: l.rank, keep: l.rank >= 7, w: 0, zone: false });
    }
    if (!tags.length) return;
    /* fitted to the pane in one pass (edgeLabelFit.ts): merged where levels touch, the least important dropped first
       (their rungs still draw), none on another or on the price's row */
    const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft) as { close?: number } | null;
    const priceY = lastBar?.close != null ? yOf(lastBar.close) : null;
    const fit = fitEdgeLabels(
      tags.map((t, i) => ({ id: String(i), y: t.y, prio: t.prio, keep: t.keep })),
      { h: TAG_H, gap: 2, top: src.chromeInset + 2, bottom: paneH - 2, rowPx: paneW < 480 ? PHONE_ROW_PX : undefined, reserved: priceY != null ? [{ lo: priceY - TAG_H / 2, hi: priceY + TAG_H / 2 }] : [] },
    );
    const fitted = fit.map(p => ({ ...tags[Number(p.id)], ty: p.ty }));
    tags.length = 0;
    tags.push(...fitted);
    if (!tags.length) return;
    const measure = measureCtx();
    if (measure) measure.font = `${TAG_FONT}px ${TAG_MONO}`;
    const right = paneW - 3;
    for (const t of tags) {
      t.w = Math.ceil((measure ? measure.measureText(t.text).width : t.text.length * 6) + 8);
      src.chips.push({ strike: t.price, left: right - t.w, top: t.ty - TAG_H / 2, bottom: t.ty + TAG_H / 2 });
    }
    src.tags = tags;
  }
}

/** The edge tags, on the top layer so a candle never covers a name */
class TagsRenderer {
  constructor(private source: GexTrailsPrimitive) {}
  draw(target: DrawTarget): void {
    const src = this.source;
    if (src.concept === 'heat') {
      const labels = src.heatLabels;
      if (!labels.length || !src.chart) return;
      const g = src.groundRgb();
      const light = (0.299 * g[0] + 0.587 * g[1] + 0.114 * g[2]) / 255 > 0.55;
      target.useBitmapCoordinateSpace(scope => paintHeatLabels(scope, labels, g, light));
      return;
    }
    const tags = src.tags;
    if (!tags.length || !src.chart) return;
    const g = src.groundRgb();
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const W = scope.mediaSize.width;
      const right = (W - 3) * hr;
      ctx.save();
      ctx.font = `${Math.round(TAG_FONT * vr)}px ${TAG_MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (const t of tags) {
        const left = right - t.w * hr;
        const ty = Math.round(t.ty * vr);
        const y = Math.round(t.y * vr);
        if (Math.abs(ty - y) > 1.5 * vr) {
          ctx.strokeStyle = t.ink;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = Math.max(1, vr * 0.75);
          ctx.beginPath();
          ctx.moveTo(left, ty);
          ctx.lineTo(left - 3 * hr, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, 1.6 * vr);
        ctx.strokeStyle = `rgba(${g[0]},${g[1]},${g[2]},0.8)`;
        ctx.strokeText(t.text, right - 4 * hr, ty + 0.5 * vr);
        ctx.fillStyle = t.ink;
        ctx.fillText(t.text, right - 4 * hr, ty + 0.5 * vr);
      }
      ctx.restore();
    });
  }
}

class NodesPaneView {
  private _renderer: NodesRenderer;
  constructor(source: GexTrailsPrimitive) {
    this._renderer = new NodesRenderer(source);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): NodesRenderer {
    return this._renderer;
  }
}

class TagsPaneView {
  private _renderer: TagsRenderer;
  constructor(source: GexTrailsPrimitive) {
    this._renderer = new TagsRenderer(source);
  }
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): TagsRenderer {
    return this._renderer;
  }
}

class FieldPaneView {
  private _renderer: FieldRenderer;
  constructor(source: GexTrailsPrimitive) {
    this._renderer = new FieldRenderer(source);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): FieldRenderer {
    return this._renderer;
  }
}

export class GexTrailsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  /** The columns as handed in (one a bar, the last reading of each bar kept) */
  snapshots: GexSnapshot[] = [];
  /** The columns' bar times, and the dense grid: values[col * strikes.length + row], dealer sign, NaN = no reading */
  cols: { time: number }[] = [];
  strikes: number[] = [];
  values: Float64Array = new Float64Array(0);
  maxAbs = 1;
  /** The field's scale: the 98th percentile of every cell's size — the size a cell is drawn at full light */
  ref = 0;
  restRef = 0;
  enabled = true;
  /** The chart's bar length, seconds — a column finds its bar by it */
  barSec = 60;
  /** Kept for the hosts that set it: the field prints no labels of its own */
  labelPx = 9.5;
  chromeInset = 0;
  stepSec = 60;
  focusStrike: number | null = null;
  focusInk: FocusInk = 'focus';
  supremeStrike: number | null = null;
  cwStrike: number | null = null;
  pwStrike: number | null = null;
  flipPrice: number | null = null;
  /** Strike chips at the right edge this frame — none: the key levels' ladder names the levels */
  chips: { strike: number; left: number; top: number; bottom: number }[] = [];
  /** The edge tags as laid out this frame (NodesRenderer), painted on the top layer */
  tags: EdgeTag[] = [];
  /** The rows drawn as beads this frame, with their largest radius (CSS px) — the hover rings a bead, not a band */
  beadRows: Map<number, number> | null = null;
  /** Beads, heat, or both */
  look: NodeLook = 'both';
  /** The zones, the profile and the edge tags draw (the host names its levels here instead of on its own ladder) */
  tagsOn = true;
  /** The host's levels, named at the edge with the zones */
  edgeLevels: (() => EdgeLevel[]) | null = null;
  private _paneViews: (FieldPaneView | NodesPaneView | TagsPaneView)[];
  /** The threads look (nodeConcept.ts `threads`, dev only): nodeThreads.ts, drawn on the strikes keptRows keeps */
  private threads: ThreadsLook | null = null;
  hover: BeadHit | null = null;
  ringInk: readonly [number, number, number] = [255, 255, 255];
  /** Told after every data hand-off, with the scale the cells stand against — the host's legend */
  onData?: (ref: number) => void;
  /** Bumped on every data hand-off — the raster's cache keys on it */
  rev = 0;
  greek: TrailGreek = 'gex';
  hoverOverlay = false;
  afterDraw: (() => void) | null = null;

  constructor() {
    this._paneViews = [new FieldPaneView(this), new NodesPaneView(this), new TagsPaneView(this)];
    /* dev only: each layer's draw cost onto window.__nodesMeter when a probe set one ([start, ms] pairs) */
    for (const v of this._paneViews) meterLayer(v.renderer() as { draw(target: DrawTarget): void });
  }

  valueOf(l: GexSnapshot['levels'][number]): number {
    return levelValue(l, this.greek);
  }

  /** The look (nodeConcept.ts, dev only): `current`, `heat` (nodeHeat.ts) or `threads` (nodeThreads.ts) */
  concept: NodeConcept = 'current';
  /** The heat's labels at the price axis, laid out by the nodes pass and painted on the top layer */
  heatLabels: HeatLabel[] = [];
  /** The levels keptRows last kept, with their roles and sizes */
  keptLevels: KeptLevel[] = [];

  private paletteOff: (() => void) | null = null;

  setConcept(concept: NodeConcept): void {
    if (this.concept === concept) return;
    this.concept = concept;
    /* the heat wears the page's palette (Terrain's COLOURS menu): a new palette is a new raster */
    this.paletteOff?.();
    this.paletteOff =
      concept === 'heat'
        ? onHeatPalette(() => {
            this.rev++;
            this.requestUpdate?.();
          })
        : null;
    this.threads = concept === 'threads' ? new ThreadsLook(this) : null;
    this.heatLabels = [];
    this.chips = [];
    this.tags = [];
    this.beadRows = null;
    this.rev++;
    this.requestUpdate?.();
  }

  /** The cache key of keptRows' last answer (the field's raster and the bead selection key on it) */
  keptKey = '';
  private keptSet: ReadonlySet<number> = new Set<number>();

  /**
   * The rows the nodes draw, of the rows in view [rLo, rHi) (prices loP..hiP): nodeStrikes' rule on the newest column —
   * a fifth of the largest strike in view (never less than half the book's largest), eight at most — plus the walls,
   * the flip's strike and the pin (the supreme) while they are in view. Every other strike is left to the rail and the
   * hover.
   */
  keptRows(rLo: number, rHi: number, loP: number, hiP: number): ReadonlySet<number> {
    const key = `${this.rev}|${rLo}|${rHi}|${this.cwStrike}|${this.pwStrike}|${this.flipPrice}|${this.supremeStrike}`;
    if (key === this.keptKey) return this.keptSet;
    const R = this.strikes.length;
    const C = this.cols.length;
    const out = new Set<number>();
    this.keptLevels = [];
    if (R && C) {
      const base = (C - 1) * R;
      let bookTop = 0;
      for (let r = 0; r < R; r++) {
        const v = this.values[base + r];
        if (v === v && Math.abs(v) > bookTop) bookTop = Math.abs(v);
      }
      const rows = [];
      for (let r = Math.max(0, rLo); r < Math.min(R, rHi); r++) rows.push({ strike: this.strikes[r], value: this.values[base + r] });
      const kept = selectNodeStrikes(rows, { callWall: this.cwStrike, putWall: this.pwStrike, flip: this.flipPrice, pin: this.supremeStrike }, { lo: loP, hi: hiP, floor: bookTop / 2 });
      this.keptLevels = kept;
      for (const l of kept) {
        /* a strike's own row; the flip, a price between strikes, beads the strike that holds it */
        const r = l.value === l.value ? this.strikes.indexOf(l.price) : this.rowAt(l.price);
        if (r >= 0) out.add(r);
      }
    }
    this.keptKey = key;
    this.keptSet = out;
    return out;
  }

  /** The first column at or after time t (seconds) */
  colIndexAtOrAfter(t: number): number {
    const cols = this.cols;
    let lo = 0;
    let hi = cols.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cols[m].time < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /** The row holding a price: half way to each neighbouring strike, or -1 off the field */
  rowAt(price: number): number {
    const s = this.strikes;
    const R = s.length;
    if (!R) return -1;
    let lo = 0;
    let hi = R;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < price) lo = m + 1;
      else hi = m;
    }
    const cand = [lo - 1, lo].filter(i => i >= 0 && i < R);
    let best = -1;
    let bestD = Infinity;
    for (const i of cand) {
      const d = Math.abs(s[i] - price);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    const step = R > 1 ? (best === 0 ? s[1] - s[0] : best === R - 1 ? s[R - 1] - s[R - 2] : Math.min(s[best] - s[best - 1], s[best + 1] - s[best])) : 1;
    return bestD <= step / 2 + 1e-9 ? best : -1;
  }

  /** A cell's dealer value, NaN where it has no reading */
  cell(ci: number, row: number): number {
    if (ci < 0 || ci >= this.cols.length || row < 0 || row >= this.strikes.length) return NaN;
    return this.values[ci * this.strikes.length + row];
  }

  setHover(hit: BeadHit | null): void {
    const was = this.hover;
    if (was === hit || (was && hit && was.strike === hit.strike && was.time === hit.time)) {
      this.hover = hit;
      return;
    }
    this.hover = hit;
    if (this.hoverOverlay) this.afterDraw?.();
    else this.requestUpdate?.();
  }

  setRingInk(rgb: readonly [number, number, number]): void {
    if (this.ringInk[0] === rgb[0] && this.ringInk[1] === rgb[1] && this.ringInk[2] === rgb[2]) return;
    this.ringInk = rgb;
    if (this.hover && this.hoverOverlay) this.afterDraw?.();
  }

  /** The hovered cell for the host's overlay canvas: its rectangle at full light, ringed in the page's ink */
  hoverShape(): { x: number; y: number; rx: number; ry: number; fill: string; ring: string; rect: boolean } | null {
    const hover = this.hover;
    if (!hover || !this.enabled || !this.chart || !this.series) return null;
    const row = this.strikes.indexOf(hover.strike);
    const geo = this.cellGeom(hover.ci, row);
    if (!geo) return null;
    const v = this.cell(hover.ci, row);
    if (Number.isNaN(v)) return null;
    const t = Math.min(1, Math.abs(v) / (this.ref || 1));
    const step = Math.min(STEPS - 1, Math.floor(t * STEPS));
    const r = this.ringInk;
    const ring = `rgba(${r[0]},${r[1]},${r[2]},0.95)`;
    /* a bead row rings its bead at the strike, the field a whole cell (and so do the threads: any strike reads) */
    const heat = this.concept === 'heat';
    const bead = this.look !== 'heat' && !heat && !this.threads ? this.beadRows?.get(row) : undefined;
    if (bead != null) {
      const y = this.series.priceToCoordinate(hover.strike);
      if (y == null) return null;
      const rad = Math.min(bead, 1) + (bead - Math.min(bead, 1)) * Math.sqrt(t) + 1.5;
      const ink = v > 0 ? BEADS.pos[step] : BEADS.neg[step];
      return { x: geo.x, y, rx: rad, ry: rad, fill: rgba(ink, 1), ring, rect: false };
    }
    if (heat) {
      const g = this.groundRgb();
      const hi = heatInks((0.299 * g[0] + 0.587 * g[1] + 0.114 * g[2]) / 255 > 0.55);
      return { ...geo, fill: hi.solid[v > 0 ? 0 : 1][step], ring, rect: true };
    }
    if (this.threads) return { ...geo, ry: Math.min(geo.ry, 2.5), fill: threadInk(this.groundRgb(), v), ring, rect: true };
    return { ...geo, fill: v > 0 ? LUT.posSolid[step] : LUT.negSolid[step], ring, rect: true };
  }

  /** A cell's centre and half-sizes on the pane, CSS px */
  private cellGeom(ci: number, row: number): { x: number; y: number; rx: number; ry: number } | null {
    if (!this.chart || !this.series || row < 0 || ci < 0 || ci >= this.cols.length) return null;
    const ts = this.chart.timeScale();
    const x = ts.timeToCoordinate(this.cols[ci].time as Time);
    const s = this.strikes;
    const R = s.length;
    const lo = row === 0 ? s[0] - (R > 1 ? (s[1] - s[0]) / 2 : 0.5) : (s[row - 1] + s[row]) / 2;
    const hi = row === R - 1 ? s[R - 1] + (R > 1 ? (s[R - 1] - s[R - 2]) / 2 : 0.5) : (s[row] + s[row + 1]) / 2;
    const ya = this.series.priceToCoordinate(lo);
    const yb = this.series.priceToCoordinate(hi);
    if (x === null || ya === null || yb === null) return null;
    const half = (ts.options().barSpacing ?? 6) / 2;
    return { x, y: (ya + yb) / 2, rx: half, ry: Math.max(1, Math.abs(ya - yb) / 2) };
  }

  /** The chart's ground, as channels */
  groundRgb(): readonly [number, number, number] {
    const bg = this.chart?.options().layout.background as { color?: string; topColor?: string } | undefined;
    const css = bg?.color ?? bg?.topColor ?? '#0a0a0a';
    const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
    const m = css.match(/\d+(?:\.\d+)?/g) ?? [];
    return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
  }

  /** The cell under a point on the pane (CSS px), or null: the bar under x, the strike row under y, a cell with a reading */
  beadAt(x: number, y: number): BeadHit | null {
    if (!this.enabled || !this.chart || !this.series || !this.cols.length || !(this.ref > 0)) return null;
    if (y < this.chromeInset) return null;
    const ts = this.chart.timeScale();
    const logical = ts.coordinateToLogical(x);
    if (logical === null) return null;
    const bar = this.series.dataByIndex(Math.round(logical), MismatchDirection.None);
    if (!bar) return null;
    const t = Number(bar.time);
    let ci = this.colIndexAtOrAfter(t);
    if (ci >= this.cols.length || this.cols[ci].time !== t) {
      const prev = ci - 1;
      const near = [prev, ci].filter(i => i >= 0 && i < this.cols.length);
      near.sort((a, b) => Math.abs(this.cols[a].time - t) - Math.abs(this.cols[b].time - t));
      const best = near[0];
      if (best == null || Math.abs(this.cols[best].time - t) > Math.max(this.barSec, 60)) return null;
      ci = best;
    }
    const price = this.series.coordinateToPrice(y);
    if (price === null) return null;
    const row = this.rowAt(price);
    /* with no field drawn, only a beaded row answers, and only near its line */
    if ((this.look === 'beads' || this.look === 'ribbon' || this.look === 'levels') && this.concept === 'current') {
      const rad = this.beadRows?.get(row);
      const yRow = row >= 0 ? this.series.priceToCoordinate(this.strikes[row]) : null;
      if (rad == null || yRow == null || Math.abs(yRow - y) > Math.max(4, rad + 2)) return null;
    }
    const v = this.cell(ci, row);
    if (Number.isNaN(v) || v === 0) return null;
    const geo = this.cellGeom(ci, row);
    if (!geo) return null;
    let total = 0;
    const R = this.strikes.length;
    for (let r = 0; r < R; r++) {
      const w = this.values[ci * R + r];
      if (!Number.isNaN(w)) total += Math.abs(w);
    }
    return { strike: this.strikes[row], time: this.cols[ci].time, ci, value: v, share: total > 0 ? Math.abs(v) / total : 0, open: this.openValue(ci, this.strikes[row]), put: v > 0, t: Math.min(1, Math.abs(v) / this.ref), ...geo };
  }

  /** The strike's value at its day's first column on or after the New York open — null where the field holds none */
  openValue(ci: number, strike: number): number | null {
    const at = this.cols[ci];
    if (!at) return null;
    const open = nySession(at.time * 1000).open / 1000;
    if (at.time < open) return null;
    const first = this.colIndexAtOrAfter(open);
    if (first > ci) return null;
    const v = this.cell(first, this.strikes.indexOf(strike));
    return Number.isNaN(v) ? null : v;
  }

  /** The strike's standing at a column: its rank by size among the column's cells, of how many */
  rankAt(ci: number, strike: number): { rank: number; of: number } | null {
    const row = this.strikes.indexOf(strike);
    const v = this.cell(ci, row);
    if (Number.isNaN(v)) return null;
    const a = Math.abs(v);
    let rank = 1;
    let of = 0;
    const R = this.strikes.length;
    for (let r = 0; r < R; r++) {
      const w = this.values[ci * R + r];
      if (Number.isNaN(w)) continue;
      of++;
      if (Math.abs(w) > a) rank++;
    }
    return { rank, of };
  }

  /** The strike's value `seconds` before a column, from the nearest column with a reading at or before then */
  valueBefore(ci: number, strike: number, seconds: number): { value: number; time: number } | null {
    const at = this.cols[ci];
    if (!at) return null;
    const row = this.strikes.indexOf(strike);
    let i = this.colIndexAtOrAfter(at.time - seconds + 1e-6) - 1;
    if (i < 0) return null;
    if (this.cols[i].time < at.time - seconds - Math.max(this.barSec, 60)) return null;
    const v = this.cell(i, row);
    return Number.isNaN(v) ? null : { value: v, time: this.cols[i].time };
  }

  setSupreme(strike: number | null): void {
    if (this.supremeStrike === strike) return;
    this.supremeStrike = strike;
    this.requestUpdate?.();
  }

  setWalls(cw: number | null, pw: number | null, flip: number | null): void {
    if (this.cwStrike === cw && this.pwStrike === pw && this.flipPrice === flip) return;
    this.cwStrike = cw;
    this.pwStrike = pw;
    this.flipPrice = flip;
    this.requestUpdate?.();
  }

  setFocus(strike: number | null, ink: FocusInk = 'focus'): void {
    if (this.focusStrike === strike && this.focusInk === ink) return;
    this.focusStrike = strike;
    this.focusInk = ink;
    this.requestUpdate?.();
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

  setLook(look: NodeLook): void {
    if (this.look === look) return;
    this.look = look;
    /* the raster keys on the hand-off: a new look is a new raster */
    this.rev++;
    if (this.enabled && this.cols.length) this.onData?.(this.scale());
    this.requestUpdate?.();
  }

  /** The heaviest nodes at the newest column, largest first: strike and dealer value (what the zones outline) */
  topNow(n = 3): { strike: number; value: number }[] {
    const R = this.strikes.length;
    const C = this.cols.length;
    if (!R || !C) return [];
    const base = (C - 1) * R;
    const out: { strike: number; value: number }[] = [];
    for (let r = 0; r < R; r++) {
      const v = this.values[base + r];
      if (v === v && v !== 0) out.push({ strike: this.strikes[r], value: v });
    }
    return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, n);
  }

  setTagsOn(on: boolean): void {
    if (this.tagsOn === on) return;
    this.tagsOn = on;
    this.requestUpdate?.();
  }

  paneViews(): readonly { zOrder(): 'top' | 'bottom'; renderer(): { draw(target: DrawTarget): void } }[] {
    return this.threads ? this.threads.views : this._paneViews;
  }

  /**
   * The columns (house sign, as the book keeps every figure), the chart's bar length and the greek. Columns are folded to
   * the chart's bars, the last of each bar kept (a level reads its last reading inside the bar). The trailing arguments
   * are kept for the hosts' call shape.
   */
  setData(snapshots: GexSnapshot[], maxAbs: number, enabled: boolean, barSec = 60, greek: TrailGreek = 'gex', _scaleTo = 0, _behind: GexSnapshot[] = [], prices: readonly { time: number; close: number }[] = []): void {
    this.rev++;
    this.greek = greek;
    this.barSec = barSec;
    this.maxAbs = maxAbs;
    this.enabled = enabled;
    if (!enabled) {
      this.cols = [];
      this.strikes = [];
      this.values = new Float64Array(0);
      this.requestUpdate?.();
      this.onData?.(0);
      return;
    }
    const folded: { time: number; levels: GexSnapshot['levels'] }[] = [];
    /* The column's time is the bar's open. Re-bucketing onto a round clock collapses a session of bars into one needle. */
    const end = prices.length ? prices[prices.length - 1].time : Infinity;
    for (const s of snapshots) {
      if (prices.length && s.time > end) continue;
      const prev = folded[folded.length - 1];
      if (prev && prev.time === s.time) folded[folded.length - 1] = s;
      else folded.push(s);
    }
    if (folded.length > 2000) {
      folded.splice(0, folded.length - 2000);
    }
    this.snapshots = folded;
    const strikeSet = new Set<number>();
    for (const s of folded) for (const l of s.levels) strikeSet.add(l.strike);
    let strikes = [...strikeSet].sort((a, b) => a - b);
    /* More than 200 strikes: keep the 200 nearest the last close. Do not blank the field. */
    if (strikes.length > 200) {
      const anchor = prices.length && prices[prices.length - 1].close > 0 ? prices[prices.length - 1].close : strikes[strikes.length >> 1];
      const keep = new Set(strikes.slice().sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b).slice(0, 200));
      strikes = strikes.filter(s => keep.has(s));
    }
    const index = new Map(strikes.map((k, i) => [k, i]));
    const R = strikes.length;
    const values = new Float64Array(folded.length * R).fill(NaN);
    const sizes: number[] = [];
    for (let c = 0; c < folded.length; c++) {
      for (const l of folded[c].levels) {
        const at = index.get(l.strike);
        if (at == null) continue;
        const v = dealerOf(levelValue(l, greek));
        values[c * R + at] = v;
        /* a missing figure is not a size: one NaN in the sort leaves the 98th percentile (the field's full light) wherever it fell */
        if (v !== 0 && Number.isFinite(v)) sizes.push(Math.abs(v));
      }
    }
    sizes.sort((a, b) => a - b);
    this.ref = sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.98))] : 0;
    this.cols = folded.map(s => ({ time: s.time }));
    this.strikes = strikes;
    this.values = values;
    if (this.hover && (this.hover.ci >= folded.length || this.cols[this.hover.ci]?.time !== this.hover.time)) this.hover = null;
    this.requestUpdate?.();
    let nowTop = 0;
    const base = (folded.length - 1) * R;
    for (let r = 0; r < R; r++) {
      const v = values[base + r];
      if (Number.isFinite(v) && Math.abs(v) > nowTop) nowTop = Math.abs(v);
    }
    this.nowTop = nowTop;
    this.onData?.(enabled ? this.scale() : 0);
  }

  /** The largest node at the newest column — the levels' full strength */
  nowTop = 0;
  /** The size drawn at full strength, as the key prints it: the largest node now for the levels, else the field's scale */
  scale(): number {
    return this.look === 'levels' && this.nowTop > 0 ? this.nowTop : this.ref;
  }
}
