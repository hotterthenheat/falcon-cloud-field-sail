/* HEAT — Slayer's exposure terrain (dev only, ?nodes=heat; nodeConcept.ts). Every strike is a band across time, each
   cell lit by its dealer gamma on the desk's own heat palette — the one the matrix, the calendar and the rails wear
   (heatmap.ts), Thermal unless the COLOURS menu at Terrain's foot says House — so the chart and its rails read alike and
   switch together. The strikes that matter (nodeStrikes.ts) carry the light; every other strike is a whisper of context.
   In each moment the heaviest node takes a one-pixel foil on its strike, so the eye finds the king without a bloom or a
   star over the candle. The field itself is gexNodesPrimitive's raster (the same cells, the same cache and pan
   mapping); this file holds its inks, the palette it follows, the king pass's inks and the labels at the price axis. */

import type { KeptLevel } from './nodeStrikes';
import { HEAT_MODE, heatRampColorFor, ladderRampT, type HeatMode } from './heatmap';
import { PHONE_ROW_PX, fitEdgeLabels } from './edgeLabelFit';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './palette';
import { groundToken, type Rgb } from './groundTokens';

export type { Rgb };

/* ---------- the inks the field does not take from the palette: the app's tokens, on the chart's ground ---------- */

const hexRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** The mark's foil (tokens.css --foil-1..5) on a ground; the fallbacks are those tokens' values */
export function foilOn(light: boolean): Rgb[] {
  const fb: Rgb[] = light
    ? [[43, 45, 56], [102, 113, 143], [35, 35, 44], [103, 93, 126], [43, 45, 56]]
    : [[238, 241, 248], [194, 214, 240], [228, 216, 244], [255, 255, 255], [200, 216, 236]];
  return fb.map((f, i) => groundToken(`--foil-${i + 1}`, light, f));
}
/** The labels' inks: palette.ts's canvas hexes for the walls, the flip and the pin on the black tape (heavier than the
    DOM tokens, so a 10px word holds); on paper the tokens' own cuts (--glacier, --ember, --flip, --supreme); the text
    is --text-primary on either */
function wallInks(light: boolean): { call: Rgb; put: Rgb; flip: Rgb; text: Rgb; pin: Rgb } {
  const tok = (name: string, fb: Rgb) => groundToken(name, light, fb);
  return light
    ? { call: tok('--glacier', [3, 105, 161]), put: tok('--ember', [146, 86, 4]), flip: tok('--flip', [75, 85, 99]), text: tok('--text-primary', [14, 15, 17]), pin: tok('--supreme', [163, 0, 179]) }
    : { call: hexRgb(CALL_WALL), put: hexRgb(PUT_WALL), flip: hexRgb(FLIP), text: tok('--text-primary', [237, 237, 237]), pin: hexRgb(SUPREME) };
}

/** Colour steps per side */
export const HEAT_STEPS = 32;

/* ---------- the palette it follows ---------- */

/** Terrain's COLOURS menu (ProfilePanel PALETTE_OPTIONS): Thermal, or the house's ember and glacier */
export type HeatPalette = 'thermal' | 'house';
const modeOf = (p: HeatPalette): HeatMode => (p === 'house' ? HEAT_MODE : 'thermal-yellow');
let palette: HeatPalette = 'thermal';
const paletteSubs = new Set<() => void>();
/** The page's palette, set by the page that owns the menu (Terrain) */
export function setHeatPalette(p: HeatPalette): void {
  if (p === palette) return;
  palette = p;
  paletteSubs.forEach(fn => fn());
}
export const heatPalette = (): HeatPalette => palette;
export function onHeatPalette(fn: () => void): () => void {
  paletteSubs.add(fn);
  return () => paletteSubs.delete(fn);
}

export interface HeatInks {
  light: boolean;
  /** fills per step: [side 0 long gamma, side 1 short gamma] for the strikes that matter, and the whisper for the rest */
  lit: [string[], string[]];
  quiet: [string[], string[]];
  /** solid per step, for the hover */
  solid: [string[], string[]];
  /** the king's light: the foil over its cell, and its bloom */
  crown: Rgb;
  bloom: Rgb;
}

/* heatmap.ts reads +1 as the side whose hedging amplifies (dealers short gamma) and −1 as the side that absorbs */
const rampSign = (side: number): 1 | -1 => (side === 0 ? -1 : 1);

const cache = new Map<string, HeatInks>();
/** Where on the palette's ramp a cell of strength t (0..1 against the field's scale) takes its hue: the ladder's window
    (heatmap.ts ladderRampT) — the saturated stretch the rails' bars wear, so the chart and its rails read alike and
    every hue holds on black — and on paper the paper ink's deep half */
export const heatHueAt = (side: number, t: number, mode: HeatMode, light: boolean): Rgb => heatRampColorFor(rampSign(side), ladderRampT(rampSign(side), t, mode, light), mode, light);
/** A lit cell's opacity: the light carries the size, so the eye reads strength as brightness on any palette (a deep
    red is darker than a pale one; the ramp's own lightness cannot be the scale). Never opaque: a candle over the
    brightest cell still reads; a lit band draws its core twice (gexNodesPrimitive), so the core runs brighter. */
export const litAlpha = (t: number, light: boolean): number => (light ? 0.08 : 0.09) + (light ? 0.3 : 0.36) * Math.pow(Math.max(0, Math.min(1, t)), 0.9);
/** A cell under the strike cut: context only, a whisper of the same hue */
export const quietAlpha = (t: number, light: boolean): number => (light ? 0.035 : 0.04) + (light ? 0.07 : 0.09) * Math.pow(Math.max(0, Math.min(1, t)), 0.9);

/** The field's inks on a ground, in the page's palette */
export function heatInks(light: boolean): HeatInks {
  const mode = modeOf(palette);
  const key = `${mode}|${light}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lit: [string[], string[]] = [[], []];
  const quiet: [string[], string[]] = [[], []];
  const solid: [string[], string[]] = [[], []];
  for (let s = 0; s < HEAT_STEPS; s++) {
    const t = (s + 0.5) / HEAT_STEPS;
    const a = litAlpha(t, light);
    const q = quietAlpha(t, light);
    for (const side of [0, 1]) {
      const c = heatHueAt(side, t, mode, light);
      lit[side].push(`rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`);
      quiet[side].push(`rgba(${c[0]},${c[1]},${c[2]},${q.toFixed(3)})`);
      solid[side].push(`rgb(${c[0]},${c[1]},${c[2]})`);
    }
  }
  const foil = foilOn(light);
  const inks: HeatInks = {
    light,
    lit,
    quiet,
    solid,
    /* the mark's foil on the chart's ground: --foil-1 for the king's edge, --foil-2 for its bloom */
    crown: foil[0],
    bloom: foil[1],
  };
  cache.set(key, inks);
  return inks;
}

/** The key's swatches in this look (FieldKey), in a palette: short gamma left, long gamma right */
export function heatRampCss(p: HeatPalette, light = false): { neg: string; pos: string } {
  const mode = modeOf(p);
  /* the cells as they land on the chart: the hue and the light together */
  const stops = (side: number) =>
    [0.05, 0.35, 0.7, 1]
      .map(t => {
        const c = heatHueAt(side, t, mode, light);
        return `rgba(${c[0]},${c[1]},${c[2]},${litAlpha(t, light).toFixed(2)})`;
      })
      .join(', ');
  return { neg: `linear-gradient(90deg, ${stops(1)})`, pos: `linear-gradient(90deg, ${stops(0)})` };
}

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


/** A level the host names at the edge beside the nodes (the key levels' rungs, the cone's 1σ ends): drawn in the same
    column, fitted with the nodes' own labels */
export interface HeatExtra {
  price: number;
  /** its short name (1σ↑, MP, Flip) */
  role: string;
  /** a CSS colour (#rrggbb or rgb()) */
  ink: string;
  /** how much it matters when the edge is crowded (EdgeLevel rank: walls 8, flip 7, the cone's ends 3) */
  rank: number;
}

const cssRgb = (css: string, fallback: Rgb): Rgb => {
  const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
  const m = css.match(/\d+(?:\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : fallback;
};

/**
 * The kept levels as labels at the price axis: role, strike, signed size in three right-aligned columns, fitted to the
 * pane with the host's levels (edgeLabelFit.ts) — merged where they touch, the least important dropped first, none on
 * another, on the price's own row or under the pane's chrome. `top` is the price of the heaviest strike now ("★ Top").
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
  extras: readonly HeatExtra[] = [],
): HeatLabel[] {
  const ink = wallInks(light);
  const mode = modeOf(palette);
  const px = labelPx();
  const font = `500 ${px}px ${FACE}`;
  const roleFont = `600 ${px}px ${FACE}`;
  const h = px + 6;
  const out: (HeatLabel & { keep: boolean })[] = [];
  for (const l of kept) {
    const y = yOf(l.price);
    if (y == null || y < 0 || y > H) continue;
    const cw = l.roles.includes('callWall');
    const pw = l.roles.includes('putWall');
    const isTop = top != null && Math.abs(l.price - top) < 1e-6;
    const flipOnly = l.value !== l.value && l.roles.includes('flip');
    const role = isTop ? '★ Top' : cw ? 'CW' : pw ? 'PW' : flipOnly ? 'Flip' : l.roles.includes('pin') ? 'Pin' : '';
    const side = l.value > 0 ? 0 : 1;
    out.push({
      price: l.price,
      y,
      ty: y,
      role,
      figure: priceText(l.price),
      value: signedShort(l.value),
      roleInk: isTop ? ink.text : cw ? ink.call : pw ? ink.put : flipOnly ? ink.flip : role === 'Pin' ? ink.pin : ink.text,
      /* the size in the field's own hue, so a label reads as its band */
      valueInk: heatHueAt(side, light ? 0.85 : 0.7, mode, light),
      prio: isTop ? 9.5 : cw || pw ? 9 : flipOnly ? 8 : l.roles.includes('pin') ? 7 : 4 + l.share,
      keep: isTop || cw || pw || flipOnly,
      x: 0,
      right: 0,
      figRight: 0,
      roleRight: 0,
      foil: isTop,
    });
  }
  for (const e of extras) {
    if (out.some(l => Math.abs(l.price - e.price) < 1e-6)) continue;
    const y = yOf(e.price);
    if (y == null || y < 0 || y > H) continue;
    const c0 = cssRgb(e.ink, ink.text);
    /* the levels' inks are cut for the black tape: a pale one on paper reads in the text ink */
    const c = light && (0.299 * c0[0] + 0.587 * c0[1] + 0.114 * c0[2]) / 255 > 0.6 ? ink.text : c0;
    out.push({ price: e.price, y, ty: y, role: e.role, figure: priceText(e.price), value: '', roleInk: c, valueInk: c, prio: e.rank, keep: e.rank >= 7, x: 0, right: 0, figRight: 0, roleRight: 0, foil: false });
  }
  if (!out.length) return [];
  const fit = fitEdgeLabels(
    out.map((l, i) => ({ id: String(i), y: l.y, prio: l.prio, keep: l.keep })),
    { h, gap: 2, top: ceiling + 1, bottom: H - 2, rowPx: W < 480 ? PHONE_ROW_PX : undefined, reserved: priceY != null && priceY > 0 && priceY < H ? [{ lo: priceY - h / 2, hi: priceY + h / 2 }] : [] },
  );
  const placed: HeatLabel[] = fit.map(p => {
    const { keep: _k, ...l } = out[Number(p.id)];
    return { ...l, ty: p.ty };
  });
  if (!placed.length) return placed;
  /* the columns, measured on what is drawn */
  const pad = W < 480 ? 4 : 5;
  const gap = W < 480 ? 4 : 6;
  let roleW = 0;
  let figW = 0;
  let valW = 0;
  for (const l of placed) {
    roleW = Math.max(roleW, textW(l.role, roleFont));
    figW = Math.max(figW, textW(l.figure, font));
    valW = Math.max(valW, textW(l.value, font));
  }
  const right = W - 2 - pad;
  const figRight = right - (valW > 0 ? valW + gap : 0);
  const roleRight = figRight - figW - (roleW > 0 ? gap - 1 : 0);
  for (const l of placed) {
    l.right = right;
    l.figRight = figRight;
    l.roleRight = roleRight;
    l.x = Math.round((l.role ? roleRight - textW(l.role, roleFont) : figRight - textW(l.figure, font)) - pad);
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
  const foil = foilOn(light);
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
  const text = wallInks(light).text;
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
