/* HEAT — Slayer's exposure terrain (dev only, ?nodes=heat; nodeConcept.ts). Every strike is a band across time, each
   cell lit by its dealer gamma on a ramp of the desk's own two inks: long gamma (hedging damps a move) rises from the
   ground through slate and glacier to ice, short gamma (hedging extends one) through umber and ember to pale gold. The
   lightness climbs evenly along each ramp. The strikes that matter (nodeStrikes.ts) carry the light; every other strike
   is a whisper of context. In each moment only the heaviest node glows — the mark's foil over its cell — so the eye
   finds the king first and the candles stay readable on top. The field itself is gexNodesPrimitive's raster (the same
   cells, the same cache and pan mapping); this file holds its inks, the king pass and the labels at the price axis. */

import type { KeptLevel } from './nodeStrikes';

export type Rgb = readonly [number, number, number];

/** Colour steps per side */
export const HEAT_STEPS = 32;

/* The ramps, ground to full, for each ground. Each climbs in lightness at an even pace (L* ≈ 8 → 90 on black). */
const DARK_LONG: Rgb[] = [
  [18, 24, 36],
  [30, 50, 78],
  [46, 92, 126],
  [92, 160, 194],
  [206, 234, 246],
];
const DARK_SHORT: Rgb[] = [
  [24, 20, 30],
  [72, 40, 50],
  [152, 82, 42],
  [216, 150, 54],
  [252, 224, 142],
];
/* on paper the ramps run the other way: from the paper down to the inks' deep cuts (tokens.css light --glacier/--ember) */
const LIGHT_LONG: Rgb[] = [
  [226, 232, 236],
  [176, 202, 220],
  [98, 152, 190],
  [26, 108, 160],
  [8, 62, 104],
];
const LIGHT_SHORT: Rgb[] = [
  [236, 228, 216],
  [226, 196, 150],
  [200, 140, 64],
  [150, 90, 10],
  [96, 56, 4],
];

const rampAt = (stops: readonly Rgb[], t: number): Rgb => {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
};

export interface HeatInks {
  light: boolean;
  /** fills per step: [side 0 long, side 1 short] for the strikes that matter, and the whisper for the rest */
  lit: [string[], string[]];
  quiet: [string[], string[]];
  /** solid per step, for the hover */
  solid: [string[], string[]];
  /** the king's light: the foil over its cell, and its bloom */
  crown: Rgb;
  bloom: Rgb;
}

const cache = new Map<boolean, HeatInks>();
/** The field's inks on a ground */
export function heatInks(light: boolean): HeatInks {
  const hit = cache.get(light);
  if (hit) return hit;
  const long = light ? LIGHT_LONG : DARK_LONG;
  const short = light ? LIGHT_SHORT : DARK_SHORT;
  const lit: [string[], string[]] = [[], []];
  const quiet: [string[], string[]] = [[], []];
  const solid: [string[], string[]] = [[], []];
  for (let s = 0; s < HEAT_STEPS; s++) {
    const t = (s + 0.5) / HEAT_STEPS;
    /* the lit strikes: present from the first step, never opaque, so a candle over the brightest cell still reads */
    const a = (light ? 0.1 : 0.1) + (light ? 0.5 : 0.56) * Math.pow(t, 1.15);
    /* the rest: context only */
    /* the rest: context only — the ramp's lower third, lifted enough to read as terrain, never as a level */
    const q = (light ? 0.06 : 0.1) + (light ? 0.12 : 0.18) * Math.pow(t, 0.9);
    [long, short].forEach((stops, side) => {
      const c = rampAt(stops, 0.12 + 0.88 * t);
      lit[side].push(`rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`);
      const cq = rampAt(stops, 0.26 + 0.3 * t);
      quiet[side].push(`rgba(${cq[0]},${cq[1]},${cq[2]},${q.toFixed(3)})`);
      solid[side].push(`rgb(${c[0]},${c[1]},${c[2]})`);
    });
  }
  const inks: HeatInks = {
    light,
    lit,
    quiet,
    solid,
    /* tokens.css --foil-1 on the black tape; the galaxy ink's deep cut (--foil-2 on paper) */
    crown: light ? [62, 70, 96] : [238, 241, 248],
    bloom: light ? [102, 113, 143] : [194, 214, 240],
  };
  cache.set(light, inks);
  return inks;
}

/** The key's swatches in this look (FieldKey), short gamma left, long gamma right */
export const HEAT_RAMP_CSS = {
  neg: `linear-gradient(90deg, ${DARK_SHORT.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
  pos: `linear-gradient(90deg, ${DARK_LONG.map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`,
} as const;

/* ---------- the labels at the price axis ---------- */

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}

export interface HeatLabel {
  price: number;
  y: number;
  ty: number;
  role: string;
  figure: string;
  value: string;
  roleInk: Rgb;
  valueInk: Rgb;
  prio: number;
  /** its plate's left edge and the rail's right edge, CSS px */
  x: number;
  right: number;
  /** the figure's and the role's right edges (the rail's columns), CSS px */
  figRight: number;
  roleRight: number;
  foil: boolean;
}

const FACE = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const widths = new Map<string, number>();
let measureCanvas: HTMLCanvasElement | null = null;
function textW(text: string, font: string): number {
  if (!text) return 0;
  const key = `${font}|${text}`;
  const hit = widths.get(key);
  if (hit != null) return hit;
  if (typeof document === 'undefined') return text.length * 6;
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 6;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  if (widths.size > 512) widths.clear();
  /* a width read before Inter is in is the fallback face's: kept only once the fonts have loaded */
  if (document.fonts?.status === 'loaded') widths.set(key, w);
  return w;
}
/** tokens' t10 — 11px under the type floor */
const labelPx = () => (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-type-floor') ? 11 : 10);

const priceText = (p: number): string => (Math.abs(p - Math.round(p)) < 1e-9 ? p.toFixed(0) : p.toFixed(2));
function signedShort(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  const [n, u] = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
  return `${sign}${n >= 100 ? n.toFixed(0) : n.toFixed(1)}${u}`;
}

/* the labels' inks: palette.ts CALL_WALL / PUT_WALL / FLIP on the tape, tokens.css's light cuts on paper */
const WALL = { dark: { call: [158, 212, 234] as Rgb, put: [245, 197, 66] as Rgb, flip: [228, 231, 238] as Rgb, text: [226, 228, 233] as Rgb, long: [150, 196, 216] as Rgb, short: [228, 170, 96] as Rgb, pin: [255, 90, 241] as Rgb }, light: { call: [3, 105, 161] as Rgb, put: [146, 86, 4] as Rgb, flip: [75, 85, 99] as Rgb, text: [20, 22, 26] as Rgb, long: [26, 98, 146] as Rgb, short: [150, 84, 8] as Rgb, pin: [163, 0, 179] as Rgb } };

/**
 * The kept levels as labels at the price axis: role, strike, signed size in three right-aligned columns, pushed apart so
 * none overlaps another or the price's own row. `top` is the price of the heaviest strike now (its role reads "Top").
 */
export function layoutHeatLabels(
  kept: readonly KeptLevel[],
  yOf: (p: number) => number | null,
  W: number,
  H: number,
  ceiling: number,
  priceY: number | null,
  top: number | null,
  light: boolean,
): HeatLabel[] {
  const ink = light ? WALL.light : WALL.dark;
  const px = labelPx();
  const font = `500 ${px}px ${FACE}`;
  const roleFont = `600 ${px}px ${FACE}`;
  const h = px + 6;
  const out: HeatLabel[] = [];
  for (const l of kept) {
    const y = yOf(l.price);
    if (y == null || y < 0 || y > H) continue;
    const cw = l.roles.includes('callWall');
    const pw = l.roles.includes('putWall');
    const isTop = top != null && Math.abs(l.price - top) < 1e-6;
    const flipOnly = l.value !== l.value && l.roles.includes('flip');
    const role = cw ? 'CW' : pw ? 'PW' : flipOnly ? 'Flip' : isTop ? 'Top' : l.roles.includes('pin') ? 'Pin' : '';
    out.push({
      price: l.price,
      y,
      ty: y,
      role,
      figure: priceText(l.price),
      value: signedShort(l.value),
      roleInk: cw ? ink.call : pw ? ink.put : flipOnly ? ink.flip : role === 'Pin' ? ink.pin : ink.text,
      valueInk: l.value > 0 ? ink.long : ink.short,
      prio: cw || pw ? 9 : flipOnly ? 8 : isTop ? 7.5 : l.roles.includes('pin') ? 7 : 4 + l.share,
      x: 0,
      right: 0,
      figRight: 0,
      roleRight: 0,
      foil: isTop && !cw && !pw,
    });
  }
  if (!out.length) return out;
  const pad = W < 480 ? 4 : 5;
  const gap = W < 480 ? 4 : 6;
  let roleW = 0;
  let figW = 0;
  let valW = 0;
  for (const l of out) {
    roleW = Math.max(roleW, textW(l.role, roleFont));
    figW = Math.max(figW, textW(l.figure, font));
    valW = Math.max(valW, textW(l.value, font));
  }
  const right = W - 2 - pad;
  const figRight = right - (valW > 0 ? valW + gap : 0);
  const roleRight = figRight - figW - (roleW > 0 ? gap - 1 : 0);
  for (const l of out) {
    l.right = right;
    l.figRight = figRight;
    l.roleRight = roleRight;
    l.x = Math.round((l.role ? roleRight - textW(l.role, roleFont) : figRight - textW(l.figure, font)) - pad);
  }
  /* pushed apart top to bottom; the price's row at the axis is kept clear */
  const step = h + 2;
  const top0 = ceiling + h / 2 + 1;
  const floor = H - h / 2 - 2;
  const room = Math.max(1, Math.floor((floor - top0) / step));
  const placed = out.sort((a, b) => b.prio - a.prio || a.y - b.y).slice(0, room);
  placed.sort((a, b) => a.y - b.y);
  const keep = priceY != null && priceY > 0 && priceY < H ? { lo: priceY - h / 2 - 1, hi: priceY + h / 2 + 1 } : null;
  const clear = (t: number, up: boolean) => (!keep || t + h / 2 <= keep.lo || t - h / 2 >= keep.hi ? t : up ? keep.lo - h / 2 : keep.hi + h / 2);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    let t = Math.max(p.y, top0, i ? placed[i - 1].ty + step : -Infinity);
    t = clear(t, !!keep && p.y < (keep.lo + keep.hi) / 2 && t < keep.lo + 1);
    if (i && t < placed[i - 1].ty + step) t = placed[i - 1].ty + step;
    p.ty = t;
  }
  if (placed.length && placed[placed.length - 1].ty > floor) {
    placed[placed.length - 1].ty = floor;
    for (let i = placed.length - 2; i >= 0; i--) placed[i].ty = clear(Math.min(placed[i].ty, placed[i + 1].ty - step), true);
  }
  return placed;
}

/** The labels, on the top layer: a plate of the chart's ground, a short tick from the level into it, the words */
export function paintHeatLabels(scope: BitmapScope, labels: readonly HeatLabel[], ground: Rgb, light: boolean): void {
  if (!labels.length) return;
  const ctx = scope.context;
  const hr = scope.horizontalPixelRatio;
  const vr = scope.verticalPixelRatio;
  const px = labelPx();
  const h = Math.round((px + 6) * vr);
  const foil: Rgb[] = light
    ? [[43, 45, 56], [102, 113, 143], [35, 35, 44], [103, 93, 126], [43, 45, 56]]
    : [[238, 241, 248], [194, 214, 240], [228, 216, 244], [255, 255, 255], [200, 216, 236]];
  const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  ctx.save();
  for (const l of labels) {
    const left = Math.round(l.x * hr);
    const w = Math.round(scope.mediaSize.width * hr) - left;
    const ty = Math.round(l.ty * vr);
    const y = Math.round(l.y * vr) + 0.5;
    /* a label pushed off its level keeps a short lead to it */
    if (Math.abs(ty - y) > 1.5 * vr) {
      ctx.strokeStyle = rgba(l.roleInk, 0.45);
      ctx.lineWidth = Math.max(1, Math.round(hr * 0.75));
      ctx.beginPath();
      ctx.moveTo(left - 8 * hr, y);
      ctx.lineTo(left - 3 * hr, y);
      ctx.lineTo(left, ty + 0.5);
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(l.roleInk, 0.6);
      ctx.fillRect(left - 6 * hr, Math.round(y - 0.5), 5 * hr, Math.max(1, Math.round(vr)));
    }
    ctx.fillStyle = rgba(ground, light ? 0.88 : 0.82);
    const r = 2 * hr;
    const t = ty - (h >> 1);
    ctx.beginPath();
    ctx.moveTo(left + r, t);
    ctx.lineTo(left + w, t);
    ctx.lineTo(left + w, t + h);
    ctx.lineTo(left + r, t + h);
    ctx.arcTo(left, t + h, left, t, r);
    ctx.arcTo(left, t, left + r, t, r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(px * vr)}px ${FACE}`;
  for (const l of labels) {
    if (!l.role) continue;
    const yt = Math.round(l.ty * vr) + 0.5 * vr;
    if (l.foil) {
      const g = ctx.createLinearGradient((l.roleRight - 22) * hr, 0, l.roleRight * hr, 0);
      foil.forEach((f, q) => g.addColorStop(q / (foil.length - 1), rgba(f, 1)));
      ctx.fillStyle = g;
    } else ctx.fillStyle = rgba(l.roleInk, 1);
    ctx.fillText(l.role, l.roleRight * hr, yt);
  }
  ctx.font = `500 ${Math.round(px * vr)}px ${FACE}`;
  const text: Rgb = light ? [20, 22, 26] : [226, 228, 233];
  for (const l of labels) {
    const yt = Math.round(l.ty * vr) + 0.5 * vr;
    ctx.fillStyle = rgba(text, 0.94);
    ctx.fillText(l.figure, l.figRight * hr, yt);
    if (l.value) {
      ctx.fillStyle = rgba(l.valueInk, 1);
      ctx.fillText(l.value, l.right * hr, yt);
    }
  }
  ctx.restore();
}
