/* THREADS — each level that matters (nodeStrikes.ts) is one continuous ribbon at its strike, left to right through the
   recorded book: as wide, at each bar, as the level was then. A wall that builds swells; one that decays thins and lets
   go; a level born mid-session starts where it was born. At the live edge every thread ends in a clean cap and its name
   sits in a right-aligned rail: role, strike, signed size.

   The inks are the desk's: the call wall glacier, the put wall ember, every other level a muted glacier (dealers long
   gamma, damping) or muted ember (short gamma, extending), the flip a hairline. The body stays faint so the candles read
   through it and sharpens toward the live edge; a 1px darker core runs inside each ribbon so it reads as one object.
   The level the book holds most of now wears the mark's foil on its cap and core.

   No dots, no rows at every strike, no full-width dotted lines. With no recording (one column) a thread is drawn flat. */

import { MismatchDirection, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { selectNodeStrikes, type KeptLevel } from './nodeStrikes';

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

/** A level the host names at the right edge (the key levels' rungs) — gexNodesPrimitive's EdgeLevel */
interface HostLevel {
  price: number;
  short: string;
  ink: string;
  rank: number;
}

/** What the look reads off the nodes primitive (GexTrailsPrimitive satisfies it) */
export interface ThreadSource {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  enabled: boolean;
  tagsOn: boolean;
  cols: { time: number }[];
  strikes: number[];
  values: Float64Array;
  rev: number;
  cwStrike: number | null;
  pwStrike: number | null;
  flipPrice: number | null;
  supremeStrike: number | null;
  chromeInset: number;
  edgeLevels: (() => HostLevel[]) | null;
  chips: { strike: number; left: number; top: number; bottom: number }[];
  afterDraw: (() => void) | null;
  groundRgb(): readonly [number, number, number];
}

type Rgb = readonly [number, number, number];

/* ---------- inks ---------- */

interface Inks {
  light: boolean;
  ground: Rgb;
  call: Rgb;
  put: Rgb;
  /** the muted pair for every other level: long gamma (glacier side), short gamma (ember side) */
  long: Rgb;
  short: Rgb;
  flip: Rgb;
  text: Rgb;
  dim: Rgb;
  /** the mark's foil (tokens.css --foil-1..5; the galaxy ink on paper) */
  foil: readonly Rgb[];
}
/* palette.ts CALL_WALL / PUT_WALL / FLIP on the black tape; tokens.css's light --glacier / --ember / --flip on paper */
const DARK = {
  call: [158, 212, 234] as Rgb,
  put: [245, 197, 66] as Rgb,
  flip: [228, 231, 238] as Rgb,
  text: [226, 228, 233] as Rgb,
  dim: [128, 132, 140] as Rgb,
  foil: [[238, 241, 248], [194, 214, 240], [228, 216, 244], [255, 255, 255], [200, 216, 236]] as Rgb[],
};
const LIGHT = {
  call: [3, 105, 161] as Rgb,
  put: [146, 86, 4] as Rgb,
  flip: [75, 85, 99] as Rgb,
  text: [24, 26, 30] as Rgb,
  dim: [96, 100, 108] as Rgb,
  foil: [[43, 45, 56], [102, 113, 143], [35, 35, 44], [103, 93, 126], [43, 45, 56]] as Rgb[],
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
function inksFor(ground: Rgb): Inks {
  const light = (0.299 * ground[0] + 0.587 * ground[1] + 0.114 * ground[2]) / 255 > 0.55;
  const k = light ? LIGHT : DARK;
  /* muted: the wall ink pulled toward a neutral grey, so the walls stay the loudest thing on the chart */
  const grey: Rgb = light ? [112, 112, 116] : [146, 146, 150];
  return { light, ground, ...k, long: mix(k.call, grey, 0.36), short: mix(k.put, grey, 0.36) };
}
/** The key's swatches in this look (FieldKey): quiet to full, short gamma (the ember side) and long gamma (glacier) */
export const THREAD_RAMP_CSS = (() => {
  const ink = inksFor([10, 10, 10]);
  const css = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  return {
    neg: `linear-gradient(90deg, ${css(ink.short, 0.2)}, ${css(ink.put, 1)})`,
    pos: `linear-gradient(90deg, ${css(ink.long, 0.2)}, ${css(ink.call, 1)})`,
  } as const;
})();
const rgba = (c: Rgb, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/* ---------- the frame ---------- */

/** The cut is never measured against less than this share of the book's largest strike (nodeStrikes' floor) */
const FLOOR_SHARE = 0.5;
/** The widest a thread gets, CSS px either side of its strike */
const HALF_MAX = 7;
/** Bars closer than this (CSS px) are read in groups */
const MIN_PITCH = 1.5;
/** Width by size, eased at the low end so a level a sixth of the largest still has a body beside a giant */
const WIDTH_POW = 0.65;
/** How far a thread's swell runs in from a birth or out to an end, CSS px */
const TAPER_PX = 14;

interface Level extends KeptLevel {
  row: number;
  wall: 'call' | 'put' | null;
  top: boolean;
}

interface Label {
  price: number;
  y: number;
  ty: number;
  role: string;
  figure: string;
  value: string;
  roleInk: Rgb;
  valueInk: Rgb;
  /** where its connector starts (the cap), CSS px; NaN for none */
  capX: number;
  ink: Rgb;
  prio: number;
  foil: boolean;
  /** its plate's left edge, CSS px: as wide as its own words, every column right-aligned with the rail's */
  x: number;
}

const priceText = (p: number): string => (Math.abs(p - Math.round(p)) < 1e-9 ? p.toFixed(0) : p.toFixed(2));
function signedShort(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  const [n, u] = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
  return `${sign}${n >= 100 ? n.toFixed(0) : n.toFixed(1)}${u}`;
}

/** The label face: the app's data voice (Inter, tokens' t10 — 11px under the type floor) */
function labelPx(): number {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-type-floor') ? 11 : 10;
}
const FACE = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
/** Measured label widths, by font and words */
const widths = new Map<string, number>();
let measureCanvas: HTMLCanvasElement | null = null;
function measurer(font: string): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (ctx) ctx.font = font;
  return ctx;
}

/** Dev only: each draw's cost onto window.__nodesMeter, when a probe set one ([start, ms] pairs) */
export function meterLayer(layer: { draw(target: DrawTarget): void }): void {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return;
  const draw = layer.draw.bind(layer);
  layer.draw = (target: DrawTarget) => {
    const m = (window as unknown as { __nodesMeter?: [number, number][] }).__nodesMeter;
    if (!m) return draw(target);
    const t0 = performance.now();
    draw(target);
    m.push([t0, performance.now() - t0]);
  };
}

class View {
  constructor(
    private readonly z: 'top' | 'bottom',
    private readonly r: { draw(target: DrawTarget): void },
  ) {}
  zOrder(): 'top' | 'bottom' {
    return this.z;
  }
  renderer(): { draw(target: DrawTarget): void } {
    return this.r;
  }
}

/** The rail's columns this frame, CSS px */
interface Rail {
  font: string;
  roleFont: string;
  h: number;
  x: number;
  right: number;
  roleRight: number;
  figRight: number;
}

export class ThreadsLook {
  readonly views: View[];
  private labels: Label[] = [];
  private rail: Rail | null = null;
  private selKey = '';
  private kept: KeptLevel[] = [];
  private refKey = '';
  private ref = 0;

  constructor(private readonly src: ThreadSource) {
    const body = {
      draw: (t: DrawTarget) => {
        this.drawBody(t);
        this.src.afterDraw?.();
      },
    };
    const labels = { draw: (t: DrawTarget) => this.drawLabels(t) };
    meterLayer(body);
    meterLayer(labels);
    this.views = [new View('bottom', body), new View('top', labels)];
  }

  /** The kept levels for the rows in view (cached per hand-off and view), and the largest size now in view */
  private select(rLo: number, rHi: number, loP: number, hiP: number): KeptLevel[] {
    const src = this.src;
    const R = src.strikes.length;
    const base = (src.cols.length - 1) * R;
    const key = `${src.rev}|${rLo}|${rHi}|${src.cwStrike}|${src.pwStrike}|${src.flipPrice}|${src.supremeStrike}`;
    if (key === this.selKey) return this.kept;
    let bookTop = 0;
    for (let r = 0; r < R; r++) {
      const v = src.values[base + r];
      if (v === v && Math.abs(v) > bookTop) bookTop = Math.abs(v);
    }
    const rows = [];
    for (let r = rLo; r < rHi; r++) rows.push({ strike: src.strikes[r], value: src.values[base + r] });
    this.kept = selectNodeStrikes(rows, { callWall: src.cwStrike, putWall: src.pwStrike, flip: src.flipPrice, pin: src.supremeStrike }, { lo: loP, hi: hiP, floor: bookTop * FLOOR_SHARE });
    this.selKey = key;
    if (import.meta.env?.DEV && typeof window !== 'undefined') Object.assign(window, { __nodesKept: { rows, kept: this.kept }, __nodesSrc: src });
    return this.kept;
  }

  /** The size a full-width thread stands for: the largest any kept level reaches in the columns in view or now — so the
      widest thread on screen is full width (cached per hand-off, selection and window) */
  private scale(levels: readonly Level[], first: number, last: number): number {
    const src = this.src;
    const key = `${src.rev}|${this.selKey}|${first}|${last}`;
    if (key === this.refKey) return this.ref;
    const R = src.strikes.length;
    const C = src.cols.length;
    let m = 0;
    for (const l of levels) {
      if (l.row < 0) continue;
      for (let c = Math.max(0, first); c < Math.min(C, last); c++) {
        const v = src.values[c * R + l.row];
        if (v === v && Math.abs(v) > m) m = Math.abs(v);
      }
      const v = src.values[(C - 1) * R + l.row];
      if (v === v && Math.abs(v) > m) m = Math.abs(v);
    }
    this.refKey = key;
    this.ref = m;
    return m;
  }

  private drawBody(target: DrawTarget): void {
    const src = this.src;
    this.labels = [];
    this.rail = null;
    src.chips = [];
    if (!src.enabled || !src.chart || !src.series) return;
    const chart = src.chart;
    const series = src.series;
    const ts = chart.timeScale();
    const W = chart.paneSize(0).width;
    const H = chart.paneSize(0).height;
    const strikes = src.strikes;
    const R = strikes.length;
    const C = src.cols.length;
    if (!(W > 0) || !(H > 0) || !R || !C || C > 2000) return;
    const yOf = (p: number): number | null => {
      const y = series.priceToCoordinate(p);
      return y == null || !Number.isFinite(y) ? null : y;
    };
    const pTop = series.coordinateToPrice(0);
    const pBot = series.coordinateToPrice(H);
    if (pTop == null || pBot == null || pTop === pBot) return;
    const loP = Math.min(pTop, pBot);
    const hiP = Math.max(pTop, pBot);
    let rLo = 0;
    while (rLo < R && strikes[rLo] < loP) rLo++;
    let rHi = rLo;
    while (rHi < R && strikes[rHi] <= hiP) rHi++;
    if (rHi - rLo >= 2) {
      const a = yOf(strikes[rLo]);
      const b = yOf(strikes[rHi - 1]);
      if (a == null || b == null || a === b) return;
    }
    const kept = this.select(rLo, rHi, loP, hiP);
    if (!kept.length) return;
    const ink = inksFor(src.groundRgb());
    const vals = src.values;
    const cN = C - 1;

    /* the levels, with their rows and their standing: the largest now is the one the foil marks */
    let topRow = -1;
    let topAbs = 0;
    const levels: Level[] = kept.map(l => {
      let row = -1;
      if (l.value === l.value) {
        let lo = 0;
        let hi = R;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (strikes[m] < l.price) lo = m + 1;
          else hi = m;
        }
        if (lo < R && Math.abs(strikes[lo] - l.price) < 1e-6) row = lo;
      }
      if (row >= 0 && Math.abs(l.value) > topAbs) {
        topAbs = Math.abs(l.value);
        topRow = row;
      }
      const wall = l.roles.includes('callWall') ? 'call' : l.roles.includes('putWall') ? 'put' : null;
      return { ...l, row, wall, top: false };
    });
    for (const l of levels) l.top = l.row >= 0 && l.row === topRow;

    /* the columns in view, through the logical range so a session gap does not shorten it */
    let first = 0;
    let last = C;
    const lr = ts.getVisibleLogicalRange();
    if (lr) {
      const at = (i: number, dir: MismatchDirection) => {
        const d = series.dataByIndex(i, dir);
        return d ? Number(d.time) : null;
      };
      const tL = at(Math.floor(lr.from) - 1, MismatchDirection.NearestRight);
      const tR = at(Math.ceil(lr.to) + 1, MismatchDirection.NearestLeft);
      const colAt = (t: number) => {
        let lo = 0;
        let hi = C;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (src.cols[m].time < t) lo = m + 1;
          else hi = m;
        }
        return lo;
      };
      if (tL != null) first = Math.max(0, colAt(tL) - 1);
      if (tR != null) last = Math.min(C, colAt(tR + 1e-6) + 1);
    }
    const ref = this.scale(levels, first, last);
    const barSpacing = ts.options().barSpacing ?? 6;
    const k = Math.max(1, Math.ceil(MIN_PITCH / Math.max(0.1, barSpacing)));
    const pitch = barSpacing * k;
    const xs: number[] = [];
    const cs: number[] = [];
    for (let c = first - (first % k); c < last; c += k) {
      if (c < first) continue;
      const x = ts.timeToCoordinate(src.cols[c].time as Time);
      if (x == null || x < -barSpacing * 2 || x > W + barSpacing * 2) continue;
      xs.push(x);
      cs.push(c);
    }
    /* the live edge: the newest column's bar; panned into the past, the threads run to the rail instead */
    const liveX = ts.timeToCoordinate(src.cols[cN].time as Time);
    const flat = C < 3;

    /* the rail: three right-aligned columns (role, strike, size), measured once for every label */
    const px = labelPx();
    const font = `500 ${px}px ${FACE}`;
    const roleFont = `600 ${px}px ${FACE}`;
    const labelH = px + 6;
    const pending: Label[] = [];
    const ys = levels.map(l => yOf(l.price));
    const room = ys.map((y, i) => {
      if (y == null) return 0;
      let g = Infinity;
      for (let j = 0; j < ys.length; j++) {
        const o = ys[j];
        if (j !== i && o != null) g = Math.min(g, Math.abs(o - y));
      }
      return g / 2;
    });
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      const y = ys[i];
      if (y == null || y < 0 || y > H) continue;
      const role = l.wall === 'call' ? 'CW' : l.wall === 'put' ? 'PW' : l.row < 0 && l.roles.includes('flip') ? 'Flip' : l.top ? 'Top' : l.roles.includes('pin') ? 'Pin' : '';
      const lineInk = l.wall === 'call' ? ink.call : l.wall === 'put' ? ink.put : l.row < 0 ? ink.flip : l.value > 0 ? ink.long : ink.short;
      pending.push({
        price: l.price,
        y,
        ty: y,
        role,
        figure: priceText(l.price),
        value: signedShort(l.value),
        roleInk: l.wall ? lineInk : l.row < 0 ? ink.flip : ink.text,
        valueInk: l.value > 0 ? ink.long : ink.short,
        capX: NaN,
        ink: lineInk,
        prio: l.wall ? 9 : l.row < 0 ? 8 : l.top ? 7.5 : l.roles.includes('pin') ? 7 : 4 + l.share,
        foil: l.top && !l.wall,
        x: 0,
      });
    }
    if (src.tagsOn) {
      for (const h of src.edgeLevels?.() ?? []) {
        if (levels.some(l => Math.abs(l.price - h.price) < 1e-6)) continue;
        const y = yOf(h.price);
        if (y == null || y < 0 || y > H) continue;
        const hex = h.ink.trim().match(/^#([0-9a-f]{6})/i);
        const m = h.ink.match(/\d+(?:\.\d+)?/g);
        const hi: Rgb = hex ? [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)] : m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : ink.dim;
        pending.push({ price: h.price, y, ty: y, role: h.short, figure: priceText(h.price), value: '', roleInk: hi, valueInk: hi, capX: NaN, ink: hi, prio: Math.min(3, h.rank / 3), foil: false, x: 0 });
      }
    }
    /* the words' widths, measured once each (a frame re-lays the rail, it does not re-measure it) */
    const wOf = (s: string, f: string) => {
      if (!s) return 0;
      const key = `${f}|${s}`;
      let w = widths.get(key);
      if (w == null) {
        const mctx = measurer(f);
        w = mctx ? mctx.measureText(s).width : s.length * px * 0.58;
        if (widths.size > 512) widths.clear();
        /* a width read before Inter has loaded is the fallback face's: kept only once the fonts are in */
        if (typeof document === 'undefined' || document.fonts?.status === 'loaded') widths.set(key, w);
      }
      return w;
    };
    let roleW = 0;
    let figW = 0;
    let valW = 0;
    for (const l of pending) {
      roleW = Math.max(roleW, wOf(l.role, roleFont));
      figW = Math.max(figW, wOf(l.figure, font));
      valW = Math.max(valW, wOf(l.value, font));
    }
    const PAD = W < 480 ? 4 : 6;
    const GAP = W < 480 ? 5 : 7;
    const right = W - PAD;
    const figRight = right - (valW > 0 ? valW + GAP : 0);
    const roleRight = figRight - figW - (roleW > 0 ? GAP - 1 : 0);
    const railX = Math.round(roleRight - roleW - PAD);
    const rail: Rail = { font, roleFont, h: labelH, x: railX, right, roleRight, figRight };
    for (const l of pending) l.x = Math.round((l.role ? roleRight - wOf(l.role, roleFont) : figRight - wOf(l.figure, font)) - PAD);
    /* the threads run to the live edge (or off the pane, panned into the past); the rail's plates sit over them */
    const capped = liveX != null && liveX >= 0 && liveX <= W;
    const endX = Math.min(liveX ?? W, W);

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      /* the fade: faint in the past, crisp at the live edge, the same ramp for every ink */
      const fadeFrom = Math.min(0, endX - W * 0.9) * hr;
      const fadeTo = endX * hr;
      /* one gradient per ink and strength a frame, shared by every run that wears it */
      const ramps = new Map<string, CanvasGradient>();
      const ramp = (c: Rgb, lo: number, hi: number) => {
        const key = `${c[0]},${c[1]},${c[2]}|${lo}|${hi}`;
        let g = ramps.get(key);
        if (!g) {
          g = ctx.createLinearGradient(fadeFrom, 0, Math.max(fadeFrom + 1, fadeTo), 0);
          g.addColorStop(0, rgba(c, lo));
          g.addColorStop(0.7, rgba(c, lo + (hi - lo) * 0.38));
          g.addColorStop(1, rgba(c, hi));
          ramps.set(key, g);
        }
        return g;
      };
      const a = ink.light ? { fill: [0.1, 0.4], core: [0.3, 0.95], thread: [0.1, 0.55] } : { fill: [0.1, 0.4], core: [0.28, 0.95], thread: [0.08, 0.5] };

      for (let i = 0; i < levels.length; i++) {
        const l = levels[i];
        const y = ys[i];
        if (y == null || y < -HALF_MAX * 2 || y > H + HALF_MAX * 2) continue;
        const lab = pending.find(p => p.price === l.price);
        const yb = y * vr;
        const lineInk = l.wall === 'call' ? ink.call : l.wall === 'put' ? ink.put : l.row < 0 ? ink.flip : l.value > 0 ? ink.long : ink.short;
        /* THE FLIP: a hairline, sharpening toward the live edge */
        if (l.row < 0) {
          ctx.fillStyle = ramp(ink.flip, 0.12, ink.light ? 0.75 : 0.6);
          ctx.fillRect(0, Math.round(yb) - (vr >= 2 ? 1 : 0), Math.round(endX * hr), Math.max(1, Math.round(vr * 0.75)));
          if (lab && capped) lab.capX = endX;
          continue;
        }
        const halfMax = Math.max(1.25, Math.min(HALF_MAX, room[i] * 0.82));
        const sign = l.value > 0 ? 1 : -1;
        const halfOf = (v: number) => (v === v && v !== 0 && ref > 0 ? Math.max(0.5, halfMax * Math.pow(Math.min(1, Math.abs(v) / ref), WIDTH_POW)) : 0);
        /* each sample's half-width and side; flat with no recording */
        const n = xs.length;
        const half = new Float64Array(n);
        const side = new Int8Array(n);
        for (let j = 0; j < n; j++) {
          let v = NaN;
          if (flat) v = l.value;
          else
            for (let g = Math.min(last, cs[j] + k) - 1; g >= cs[j]; g--) {
              const w = vals[g * R + l.row];
              if (w === w && w !== 0) {
                v = w;
                break;
              }
            }
          half[j] = halfOf(v);
          side[j] = v === v ? (v > 0 ? 1 : -1) : 0;
        }
        /* runs: unbroken stretches on one side (a wall keeps its ink whatever the sign), cut at a gap in the record */
        let prevEnd = NaN;
        let prevInk: Rgb | null = null;
        let j = 0;
        while (j < n) {
          if (half[j] <= 0 || xs[j] > endX) {
            j++;
            continue;
          }
          const s = side[j];
          let e = j;
          while (e + 1 < n && half[e + 1] > 0 && xs[e + 1] <= endX && xs[e + 1] - xs[e] <= pitch * 1.6 && (l.wall || side[e + 1] === s)) e++;
          const runInk = l.wall ? lineInk : s > 0 ? ink.long : ink.short;
          const reachesEdge = cs[e] + k >= C || (!capped && xs[e] + pitch >= endX - 1);
          const isCap = reachesEdge && capped && e >= n - 1 - Math.ceil(2 / k);
          const x0 = xs[j] * hr;
          const x1 = (reachesEdge ? endX : xs[e]) * hr;
          /* the ends: a level born (or a reading resumed) swells in from a point, one that ends tapers out to the thread;
             only the live edge is cut square, for its cap */
          const taper = Math.max(2, Math.min(TAPER_PX, (x1 - x0) / hr / 3)) * hr;
          const env = (x: number) => {
            const a0 = Math.min(1, (x - x0) / taper);
            const a1 = isCap ? 1 : Math.min(1, (x1 - x) / taper);
            const t = Math.max(0, Math.min(a0, a1));
            return t * t * (3 - 2 * t);
          };
          const px: number[] = [];
          const hy: number[] = [];
          for (let q = j; q <= e; q++) {
            px.push(xs[q] * hr);
            hy.push(half[q] * vr);
          }
          if (reachesEdge && px[px.length - 1] < x1) {
            px.push(x1);
            hy.push(half[e] * vr);
          }
          /* enough points through each taper that it reads as a curve, not a step */
          const ptsX: number[] = [];
          const ptsH: number[] = [];
          for (let q = 0; q < px.length; q++) {
            if (q > 0) {
              const gap = px[q] - px[q - 1];
              const inTaper = px[q - 1] - x0 < taper || x1 - px[q] < taper;
              const sub = inTaper ? Math.min(8, Math.floor(gap / (1.5 * hr))) : 0;
              for (let u = 1; u < sub; u++) {
                const f = u / sub;
                ptsX.push(px[q - 1] + gap * f);
                ptsH.push(hy[q - 1] + (hy[q] - hy[q - 1]) * f);
              }
            }
            ptsX.push(px[q]);
            ptsH.push(hy[q]);
          }
          const m = ptsX.length;
          const hw = ptsH.map((h, q) => h * env(ptsX[q]));
          const lastHalf = hw[m - 1] / vr;
          const body = new Path2D();
          body.moveTo(ptsX[0], yb - hw[0]);
          for (let q = 1; q < m; q++) body.lineTo(ptsX[q], yb - hw[q]);
          for (let q = m - 1; q >= 0; q--) body.lineTo(ptsX[q], yb + hw[q]);
          body.closePath();
          ctx.fillStyle = ramp(runInk, a.fill[0] * (l.wall ? 1.2 : 1), a.fill[1] * (l.wall ? 1.2 : 1));
          ctx.fill(body);
          /* the core: 1px, darker than the ribbon, down its middle — the thread itself */
          const coreInk = l.top && !l.wall ? mix(ink.foil[1], ink.ground, ink.light ? 0.1 : 0.42) : mix(runInk, ink.ground, ink.light ? 0.38 : 0.55);
          ctx.fillStyle = ramp(coreInk, a.core[0], a.core[1]);
          const lw = Math.max(1, Math.round(vr));
          ctx.fillRect(Math.round(x0), Math.round(yb - lw / 2), Math.max(1, Math.round(x1 - x0)), lw);
          if (isCap) {
            /* the cap: a clean square end at the live edge, full ink (the top level's in foil) */
            const ch = Math.max(3.5, lastHalf + 1) * vr;
            const cw = Math.max(2, Math.round(2 * hr));
            if (l.top && !l.wall) {
              const g = ctx.createLinearGradient(0, yb - ch, 0, yb + ch);
              ink.foil.forEach((f, q) => g.addColorStop(q / (ink.foil.length - 1), rgba(f, 1)));
              ctx.fillStyle = g;
            } else ctx.fillStyle = rgba(runInk, 0.95);
            ctx.fillRect(Math.round(x1) - cw, Math.round(yb - ch), cw, Math.round(ch * 2));
            if (lab) lab.capX = x1 / hr;
          }
          /* the thread between two stretches of record (overnight, a pause): a hairline in the level's ink, never a body */
          if (prevEnd === prevEnd && prevInk && x0 - prevEnd > 1) {
            ctx.fillStyle = ramp(mix(prevInk, runInk, 0.5), a.thread[0], a.thread[1]);
            ctx.fillRect(Math.round(prevEnd), Math.round(yb - lw / 2), Math.round(x0 - prevEnd), lw);
          }
          prevEnd = x1;
          prevInk = runInk;
          j = e + 1;
        }
      }
      ctx.restore();
    });

    /* the rail: stacked so none overlaps another or the price's own row at the axis */
    if (!pending.length) return;
    const step = labelH + 2;
    const ceiling = src.chromeInset + labelH / 2 + 2;
    const floor = H - labelH / 2 - 2;
    const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft) as { close?: number } | null;
    const priceY = lastBar?.close != null ? yOf(lastBar.close) : null;
    const roomFor = Math.max(1, Math.floor((floor - ceiling) / step) + (priceY == null ? 1 : 0));
    const placed = pending.sort((p, q) => q.prio - p.prio || p.y - q.y).slice(0, roomFor);
    placed.sort((p, q) => p.y - q.y);
    /* the price row: a label never sits on it; the ones that would are moved to whichever side of it they lean */
    const keepOut = priceY != null && priceY > 0 && priceY < H ? { lo: priceY - labelH / 2 - 1, hi: priceY + labelH / 2 + 1 } : null;
    const clearOf = (t: number, dir: 1 | -1) => {
      if (!keepOut || t + labelH / 2 <= keepOut.lo || t - labelH / 2 >= keepOut.hi) return t;
      return dir > 0 ? keepOut.hi + labelH / 2 : keepOut.lo - labelH / 2;
    };
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      let t = Math.max(p.y, ceiling, i ? placed[i - 1].ty + step : -Infinity);
      t = clearOf(t, keepOut && p.y < (keepOut.lo + keepOut.hi) / 2 && t < keepOut.lo + 1 ? -1 : 1);
      if (i && t < placed[i - 1].ty + step) t = placed[i - 1].ty + step;
      p.ty = t;
    }
    if (placed.length && placed[placed.length - 1].ty > floor) {
      placed[placed.length - 1].ty = floor;
      for (let i = placed.length - 2; i >= 0; i--) {
        let t = Math.min(placed[i].ty, placed[i + 1].ty - step);
        t = clearOf(t, -1);
        placed[i].ty = t;
      }
    }
    this.labels = placed;
    this.rail = rail;
    src.chips = placed.map(p => ({ strike: p.price, left: p.x, top: p.ty - labelH / 2, bottom: p.ty + labelH / 2 }));
  }

  private drawLabels(target: DrawTarget): void {
    const labels = this.labels;
    const rail = this.rail;
    if (!labels.length || !rail) return;
    const ink = inksFor(this.src.groundRgb());
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      const h = Math.round(rail.h * vr);
      for (const l of labels) {
        const left = Math.round(l.x * hr);
        const w = Math.round((rail.right + 6) * hr) - left;
        const ty = Math.round(l.ty * vr);
        const y = Math.round(l.y * vr) + 0.5;
        /* the connector: from the cap (or the thread's end) along the level, and an elbow into the label when it moved */
        if (l.capX === l.capX && l.capX * hr < left - 4 * hr) {
          ctx.strokeStyle = rgba(l.ink, ink.light ? 0.36 : 0.28);
          ctx.lineWidth = Math.max(1, Math.round(hr * 0.75));
          ctx.beginPath();
          ctx.moveTo(l.capX * hr + 3 * hr, y);
          const elbow = left - 7 * hr;
          ctx.lineTo(elbow, y);
          ctx.lineTo(left - 1 * hr, ty + 0.5);
          ctx.stroke();
        } else if (Math.abs(ty - y) > 1.5 * vr) {
          ctx.strokeStyle = rgba(l.ink, 0.4);
          ctx.lineWidth = Math.max(1, Math.round(hr * 0.75));
          ctx.beginPath();
          ctx.moveTo(left - 7 * hr, y);
          ctx.lineTo(left - 1 * hr, ty + 0.5);
          ctx.stroke();
        }
        /* the plate: the chart's ground, so a candle under the rail never muddies a figure */
        ctx.fillStyle = rgba(ink.ground, ink.light ? 0.9 : 0.84);
        const r = 2 * hr;
        const top = ty - (h >> 1);
        ctx.beginPath();
        ctx.moveTo(left + r, top);
        ctx.arcTo(left + w, top, left + w, top + h, r);
        ctx.arcTo(left + w, top + h, left, top + h, r);
        ctx.arcTo(left, top + h, left, top, r);
        ctx.arcTo(left, top, left + w, top, r);
        ctx.closePath();
        ctx.fill();
      }
      /* the words: one font a pass */
      const sized = (f: string) => f.replace(/(\d+)px/, (_, n) => `${Math.round(+n * vr)}px`);
      ctx.font = sized(rail.roleFont);
      for (const l of labels) {
        if (!l.role) continue;
        const yt = Math.round(l.ty * vr) + 0.5 * vr;
        if (l.foil) {
          const g = ctx.createLinearGradient(rail.roleRight * hr - 22 * hr, 0, rail.roleRight * hr, 0);
          ink.foil.forEach((f, q) => g.addColorStop(q / (ink.foil.length - 1), rgba(f, 1)));
          ctx.fillStyle = g;
        } else ctx.fillStyle = rgba(l.roleInk, 1);
        ctx.fillText(l.role, rail.roleRight * hr, yt);
      }
      ctx.font = sized(rail.font);
      for (const l of labels) {
        const yt = Math.round(l.ty * vr) + 0.5 * vr;
        ctx.fillStyle = rgba(ink.text, 0.94);
        ctx.fillText(l.figure, rail.figRight * hr, yt);
        if (l.value) {
          ctx.fillStyle = rgba(l.valueInk, 1);
          ctx.fillText(l.value, rail.right * hr, yt);
        }
      }
      ctx.restore();
    });
  }
}

/** The hovered cell's ink in this look: its side's muted wall ink, solid */
export function threadInk(ground: readonly [number, number, number], value: number): string {
  const ink = inksFor(ground);
  return rgba(value > 0 ? ink.long : ink.short, 1);
}
