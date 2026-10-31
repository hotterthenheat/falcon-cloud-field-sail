/* What the three node looks share (nodeStrata, nodeRidge, nodeGlyphs): the frame each reads off the chart (the strikes
   in view, their sizes now, the levels kept by nodeStrikes' rule), the inks on either ground, and the labels — laid out
   in the bottom pass, pushed apart so none overlaps another, and painted on the top layer so a candle never covers a
   name. */

import { MismatchDirection, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { selectNodeStrikes, type KeptLevel } from './nodeStrikes';

export interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
  bitmapSize: { width: number; height: number };
}
export interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

/** A level the host names at the right edge (the key levels' rungs) — gexNodesPrimitive's EdgeLevel */
export interface HostLevel {
  price: number;
  name: string;
  short: string;
  ink: string;
  rank: number;
}

/** What a look reads off the nodes primitive (GexTrailsPrimitive satisfies it) */
export interface ConceptSource {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  enabled: boolean;
  tagsOn: boolean;
  cols: { time: number }[];
  strikes: number[];
  values: Float64Array;
  ref: number;
  rev: number;
  cwStrike: number | null;
  pwStrike: number | null;
  flipPrice: number | null;
  supremeStrike: number | null;
  chromeInset: number;
  edgeLevels: (() => HostLevel[]) | null;
  chips: { strike: number; left: number; top: number; bottom: number }[];
  /** the host's hover overlay, redrawn after every body pass (as the field's renderer does) */
  afterDraw: (() => void) | null;
  groundRgb(): readonly [number, number, number];
}

export type Rgb = readonly [number, number, number];

/** The looks' inks. Walls wear the legs' inks (glacier, ember), never the sign's green or red; a plain level wears warm
    where dealers' hedging damps a move (long gamma) and cool where it extends one (short gamma). */
export interface NodeInks {
  light: boolean;
  ground: Rgb;
  warm: Rgb;
  cool: Rgb;
  call: Rgb;
  put: Rgb;
  flip: Rgb;
  pin: Rgb;
  text: Rgb;
  muted: Rgb;
}
const DARK: Omit<NodeInks, 'ground' | 'light'> = {
  warm: [232, 156, 96],
  cool: [152, 148, 236],
  call: [158, 212, 234],
  put: [245, 197, 66],
  flip: [228, 231, 238],
  pin: [255, 90, 241],
  text: [226, 228, 233],
  muted: [138, 142, 150],
};
const LIGHT: Omit<NodeInks, 'ground' | 'light'> = {
  warm: [184, 84, 34],
  cool: [84, 74, 190],
  call: [3, 105, 161],
  put: [146, 86, 4],
  flip: [75, 85, 99],
  pin: [163, 0, 179],
  text: [20, 22, 26],
  muted: [84, 88, 96],
};
export function inksFor(ground: Rgb): NodeInks {
  const light = (0.299 * ground[0] + 0.587 * ground[1] + 0.114 * ground[2]) / 255 > 0.55;
  return { light, ground, ...(light ? LIGHT : DARK) };
}
/** The key's swatches for the looks (FieldKey): quiet to full, short gamma (cool) and long gamma (warm) */
export const CONCEPT_RAMP_CSS = {
  pos: `linear-gradient(90deg, rgba(${DARK.warm.join(',')},0.18), rgb(${DARK.warm.join(',')}))`,
  neg: `linear-gradient(90deg, rgba(${DARK.cool.join(',')},0.18), rgb(${DARK.cool.join(',')}))`,
} as const;

export const rgba = (c: Rgb, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** A kept level's ink: a wall's own, the flip's, else its sign's */
export function levelInk(l: KeptLevel, ink: NodeInks): Rgb {
  if (l.roles.includes('callWall')) return ink.call;
  if (l.roles.includes('putWall')) return ink.put;
  if (l.value !== l.value) return l.roles.includes('flip') ? ink.flip : ink.muted;
  return l.value > 0 ? ink.warm : ink.cool;
}
export const isWall = (l: KeptLevel) => l.roles.includes('callWall') || l.roles.includes('putWall');

/** The frame a look draws from */
export interface NodeFrame {
  W: number;
  H: number;
  /** the rows strictly inside the price range in view */
  rLo: number;
  rHi: number;
  /** the newest column */
  cN: number;
  /** the largest size now among the rows in view */
  top: number;
  kept: KeptLevel[];
  ink: NodeInks;
  narrow: boolean;
  yOf: (p: number) => number | null;
}

/** The cut is never measured against less than this share of the book's largest strike (nodeStrikes' floor) */
const FLOOR_SHARE = 0.5;

const selCache = new WeakMap<ConceptSource, { key: string; kept: KeptLevel[] }>();

/** Below this plot width the labels print short */
export const NARROW = 560;

/** The frame, or null while there is nothing to draw (no book, no scale, nothing in view) */
export function readFrame(src: ConceptSource): NodeFrame | null {
  if (!src.enabled || !src.chart || !src.series) return null;
  const chart = src.chart;
  const series = src.series;
  const W = chart.paneSize(0).width;
  const H = chart.paneSize(0).height;
  if (!(W > 0) || !(H > 0)) return null;
  const strikes = src.strikes;
  const R = strikes.length;
  const C = src.cols.length;
  if (!R || !C || C > 2000) return null;
  const yOf = (p: number): number | null => {
    const y = series.priceToCoordinate(p);
    return y == null || !Number.isFinite(y) ? null : y;
  };
  const pTop = series.coordinateToPrice(0);
  const pBot = series.coordinateToPrice(H);
  if (pTop == null || pBot == null || pTop === pBot) return null;
  const loP = Math.min(pTop, pBot);
  const hiP = Math.max(pTop, pBot);
  let rLo = 0;
  while (rLo < R && strikes[rLo] < loP) rLo++;
  let rHi = rLo;
  while (rHi < R && strikes[rHi] <= hiP) rHi++;
  /* an empty scale maps every strike to one y: wait for a real one */
  if (rHi - rLo >= 2) {
    const a = yOf(strikes[rLo]);
    const b = yOf(strikes[rHi - 1]);
    if (a == null || b == null || a === b) return null;
  }
  const cN = C - 1;
  const vals = src.values;
  const base = cN * R;
  let top = 0;
  for (let r = rLo; r < rHi; r++) {
    const v = vals[base + r];
    if (v === v && Math.abs(v) > top) top = Math.abs(v);
  }
  /* the floor the cut never drops under: half the book's largest strike now, in view or not */
  let bookTop = 0;
  for (let r = 0; r < R; r++) {
    const v = vals[base + r];
    if (v === v && Math.abs(v) > bookTop) bookTop = Math.abs(v);
  }
  const floor = bookTop * FLOOR_SHARE;
  top = Math.max(top, top > 0 ? floor : 0);
  const key = `${src.rev}|${rLo}|${rHi}|${src.cwStrike}|${src.pwStrike}|${src.flipPrice}|${src.supremeStrike}`;
  let hit = selCache.get(src);
  if (!hit || hit.key !== key) {
    const rows = [];
    for (let r = rLo; r < rHi; r++) rows.push({ strike: strikes[r], value: vals[base + r] });
    const kept = selectNodeStrikes(rows, { callWall: src.cwStrike, putWall: src.pwStrike, flip: src.flipPrice, pin: src.supremeStrike }, { lo: loP, hi: hiP, floor });
    hit = { key, kept };
    selCache.set(src, hit);
    if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __nodesKept?: unknown }).__nodesKept = { rows, kept };
  }
  return { W, H, rLo, rHi, cN, top, kept: hit.kept, ink: inksFor(src.groundRgb()), narrow: W < NARROW, yOf };
}

/** The strike's row in the grid, -1 for none */
export function rowOf(src: ConceptSource, price: number): number {
  const s = src.strikes;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (s[m] < price) lo = m + 1;
    else hi = m;
  }
  return lo < s.length && Math.abs(s[lo] - price) < 1e-6 ? lo : -1;
}

/** The newest price bar's x on the pane (CSS px) — the tape's, which runs on past the book's last column after the
    close — null while it is off the scale */
export function lastBarX(src: ConceptSource): number | null {
  if (!src.chart || !src.series) return null;
  const bar = src.series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
  const C = src.cols.length;
  const t = bar ? (bar.time as Time) : C ? (src.cols[C - 1].time as Time) : null;
  if (t == null) return null;
  const x = src.chart.timeScale().timeToCoordinate(t);
  return x == null || !Number.isFinite(x) ? null : x;
}

/* ---------- labels ---------- */

export const LABEL_H = 14;
export const LABEL_FONT = 9.5;
export const LABEL_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** One label as laid out this frame, CSS px */
export interface NodeLabel {
  price: number;
  /** the level's y, and the label's after the push */
  y: number;
  ty: number;
  /** the name (CW, PW, Flip, Pin, a host's short) and the figures, printed in two inks */
  tag: string;
  figure: string;
  value: string;
  ink: Rgb;
  /** the value's ink (its sign's) */
  valueInk: Rgb;
  prio: number;
  /** the label's box: its left edge and width */
  x: number;
  w: number;
  /** which side of the box the lead leaves from, toward the level */
  leadTo: 'left' | 'right';
  /** where the lead ends, x */
  leadX: number;
  /** where the label sits when nothing pushes it (its level's y unless a look lifts it); a lead is drawn only off it */
  restY?: number;
}

const priceText = (p: number): string => (Math.abs(p - Math.round(p)) < 1e-9 ? p.toFixed(0) : p.toFixed(2));
/** +155M, −2.3B: no $, no decimal past three digits */
export function shortDollars(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  const [n, u] = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
  return `${sign}${n >= 100 ? n.toFixed(0) : n.toFixed(1)}${u}`;
}

let measureCanvas: HTMLCanvasElement | null = null;
function measure(text: string): number {
  if (typeof document === 'undefined') return text.length * 5.8;
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 5.8;
  ctx.font = `${LABEL_FONT}px ${LABEL_MONO}`;
  return ctx.measureText(text).width;
}
/** The room between a label and what it names, CSS px */
export const LABEL_GAP = 4;
const PAD = 5;

/** A kept level's label, unplaced */
export function levelLabel(l: KeptLevel, y: number, ink: NodeInks): NodeLabel {
  const tag = l.roles.includes('callWall') ? 'CW' : l.roles.includes('putWall') ? 'PW' : l.roles.includes('pin') ? 'Pin' : l.roles.includes('flip') ? 'Flip' : '';
  const value = shortDollars(l.value);
  const prio = isWall(l) ? 9 : l.roles.includes('flip') ? 8 : l.roles.includes('pin') ? 7 : 4 + l.share;
  return {
    price: l.price,
    y,
    ty: y,
    tag,
    figure: priceText(l.price),
    value,
    ink: levelInk(l, ink),
    valueInk: l.value > 0 ? ink.warm : ink.cool,
    prio,
    x: 0,
    w: 0,
    leadTo: 'right',
    leadX: 0,
  };
}

/** A host level's label (max pain, the σ lines), when no kept level sits on its price */
export function hostLabel(h: HostLevel, y: number): NodeLabel {
  const m = h.ink.match(/\d+(?:\.\d+)?/g);
  const hex = h.ink.trim().match(/^#([0-9a-f]{6})/i);
  const ink: Rgb = hex
    ? [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
    : m && m.length >= 3
      ? [Number(m[0]), Number(m[1]), Number(m[2])]
      : [160, 160, 160];
  return { price: h.price, y, ty: y, tag: h.short, figure: priceText(h.price), value: '', ink, valueInk: ink, prio: Math.min(3, h.rank / 3), x: 0, w: 0, leadTo: 'right', leadX: 0 };
}

/** The label's printed width, CSS px */
export function labelWidth(l: NodeLabel): number {
  const words = [l.tag, l.figure, l.value].filter(Boolean).join(' ');
  return Math.ceil(measure(words) + PAD * 2 + 2);
}

/**
 * The labels pushed apart top to bottom so none overlaps another, inside [ceiling, floor] (CSS px). More than the
 * height holds: the least of them go (their levels still draw). Returns the labels kept, top to bottom.
 */
export function stackLabels(labels: NodeLabel[], ceiling: number, floor: number): NodeLabel[] {
  if (!labels.length) return labels;
  const step = LABEL_H + 2;
  const top = ceiling + LABEL_H / 2;
  const bottom = floor - LABEL_H / 2;
  const room = Math.max(1, Math.floor((bottom - top) / step) + 1);
  const kept = labels.slice().sort((a, b) => b.prio - a.prio || a.y - b.y);
  kept.length = Math.min(kept.length, room);
  kept.sort((a, b) => a.y - b.y);
  kept[0].ty = Math.max(kept[0].y, top);
  for (let i = 1; i < kept.length; i++) kept[i].ty = Math.max(kept[i].y, kept[i - 1].ty + step);
  if (kept[kept.length - 1].ty > bottom) {
    kept[kept.length - 1].ty = bottom;
    for (let i = kept.length - 2; i >= 0; i--) kept[i].ty = Math.min(kept[i].ty, kept[i + 1].ty - step);
  }
  return kept;
}

/** The host's levels as labels, minus the prices a kept level already names */
export function hostLabels(src: ConceptSource, f: NodeFrame): NodeLabel[] {
  const out: NodeLabel[] = [];
  for (const h of src.edgeLevels?.() ?? []) {
    if (f.kept.some(k => Math.abs(k.price - h.price) < 1e-6)) continue;
    const y = f.yOf(h.price);
    if (y == null || y < 0 || y > f.H) continue;
    out.push(hostLabel(h, y));
  }
  return out;
}

/** Publish the labels as the ladder's chips, so a key level's rung leads into its name (or ends at `left`, CSS px) */
export function publishChips(src: ConceptSource, labels: NodeLabel[], left?: number): void {
  src.chips = labels.map(l => ({ strike: l.price, left: left ?? l.x, top: l.ty - LABEL_H / 2, bottom: l.ty + LABEL_H / 2 }));
}

/**
 * The labels, painted: a box of the chart's ground, an ink stroke on the side toward the level, the name in the level's
 * ink, the price in the page's, the size in its sign's. A label pushed off its level keeps a thin lead to it.
 */
export function paintLabels(scope: BitmapScope, labels: readonly NodeLabel[], ink: NodeInks): void {
  if (!labels.length) return;
  const ctx = scope.context;
  const hr = scope.horizontalPixelRatio;
  const vr = scope.verticalPixelRatio;
  ctx.save();
  ctx.font = `${Math.round(LABEL_FONT * vr)}px ${LABEL_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const h = Math.round(LABEL_H * vr);
  const g = ink.ground;
  for (const l of labels) {
    const left = Math.round(l.x * hr);
    const w = Math.round(l.w * hr);
    const ty = Math.round(l.ty * vr);
    const y = Math.round(l.y * vr);
    const top = ty - (h >> 1);
    /* the lead: from the box's side to the level's own y */
    const from = l.leadTo === 'left' ? left : left + w;
    const rest = Math.round((l.restY ?? l.y) * vr);
    if (Math.abs(ty - rest) > 1.5 * vr) {
      ctx.strokeStyle = rgba(l.ink, 0.55);
      ctx.lineWidth = Math.max(1, Math.round(hr * 0.9));
      ctx.beginPath();
      ctx.moveTo(from, ty + 0.5);
      const bend = from + (l.leadTo === 'left' ? -3 : 3) * hr;
      ctx.lineTo(bend, ty + 0.5);
      ctx.lineTo(l.leadX * hr, y + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(g, ink.light ? 0.9 : 0.86);
    roundRect(ctx, left, top, w, h, 2 * hr);
    ctx.fill();
    /* the stroke on the side toward the level */
    ctx.fillStyle = rgba(l.ink, 0.95);
    const sw = Math.max(2, Math.round(2 * hr));
    ctx.fillRect(l.leadTo === 'left' ? left : left + w - sw, top + Math.round(2 * vr), sw, h - Math.round(4 * vr));
    let x = left + (PAD + (l.leadTo === 'left' ? 1 : 0)) * hr;
    const yt = ty + 0.5 * vr;
    if (l.tag) {
      ctx.fillStyle = rgba(l.ink, 1);
      ctx.fillText(l.tag, x, yt);
      x += ctx.measureText(`${l.tag} `).width;
    }
    ctx.fillStyle = rgba(ink.text, l.tag ? 0.92 : 0.86);
    ctx.fillText(l.figure, x, yt);
    x += ctx.measureText(`${l.figure} `).width;
    if (l.value) {
      ctx.fillStyle = rgba(l.valueInk, 1);
      ctx.fillText(l.value, x, yt);
    }
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** A look's layers: the body under the candles, the labels over them */
export interface ConceptLayer {
  draw(target: DrawTarget): void;
}
export class LabelsPaneView {
  constructor(private readonly r: ConceptLayer) {}
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): ConceptLayer {
    return this.r;
  }
}
export class BodyPaneView {
  constructor(private readonly r: ConceptLayer) {}
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): ConceptLayer {
    return this.r;
  }
}

/** A look: its two pane views, and the labels the body pass laid out for the top pass */
export abstract class ConceptLook {
  labels: NodeLabel[] = [];
  readonly views: (BodyPaneView | LabelsPaneView)[];
  constructor(protected readonly src: ConceptSource) {
    const body: ConceptLayer = {
      draw: t => {
        this.drawBody(t);
        this.src.afterDraw?.();
      },
    };
    const labels: ConceptLayer = { draw: t => this.drawLabels(t) };
    meterLayer(body);
    meterLayer(labels);
    this.views = [new BodyPaneView(body), new LabelsPaneView(labels)];
  }
  protected abstract drawBody(target: DrawTarget): void;
  private drawLabels(target: DrawTarget): void {
    const labels = this.labels;
    if (!labels.length) return;
    const ink = inksFor(this.src.groundRgb());
    target.useBitmapCoordinateSpace(scope => paintLabels(scope, labels, ink));
  }
  /** Clears the frame's published state before a body pass */
  protected reset(): void {
    this.labels = [];
    this.src.chips = [];
  }
  /** The ceiling and floor the labels stack between */
  protected bounds(f: NodeFrame): [number, number] {
    return [this.src.chromeInset + 2, f.H - 2];
  }
}

/** The first column at or after time t (seconds) */
export function colAtOrAfter(src: ConceptSource, t: number): number {
  const cols = src.cols;
  let lo = 0;
  let hi = cols.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cols[m].time < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Half the gap from each level's y to its nearest neighbour's (CSS px), Infinity for a lone level */
export function neighbourRoom(ys: readonly (number | null)[]): number[] {
  return ys.map((y, i) => {
    if (y == null) return 0;
    let g = Infinity;
    for (let j = 0; j < ys.length; j++) {
      const o = ys[j];
      if (j !== i && o != null) g = Math.min(g, Math.abs(o - y));
    }
    return g / 2;
  });
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

