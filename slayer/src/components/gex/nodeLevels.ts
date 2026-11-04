/* LEVELS — the exposure nodes' default look (deskPrefs `nodeLook: 'levels'`): the book's biggest nodes NOW, drawn the
   way the key-levels ladder draws a rung (ladderPaint.ts). A faint dotted trace crosses the tape so the strike is
   findable, and a short solid rung at the right edge carries the size. Nothing is painted as a band through the candles.

   - Which: the newest column of the field (the cut the page reads: Terrain's expiry pick, in the model the Live /
     Settled switch picks — the field's own numbers, dealer sign), its LEVELS_TOP_N largest strikes by |exposure|, none
     under LEVELS_MIN_SHARE of the largest. A strike with no reading is never picked; no book, no level.
   - No stacking: two bands closer than LEVELS_MIN_GAP_PX on the price axis are one — the weaker is skipped (merged into
     the stronger, which names it), and each band's swell is capped at half the gap to its drawn neighbours, so no two
     bands ever touch. Only the top LEVELS_LABELS are named, through the edge's label fit (edgeLabelFit.ts).
   - The trace is one device pixel, dotted, and quiet. The rung is the same pixel (the largest node a hair thicker) and
     its length is the node's size. The label column stays clear of both. The long-gamma side is the glacier, the
     short-gamma side the ember (heatmap.ts's house ramp, nodeHeat.heatHueAt), and the supreme, the call wall and the
     put wall keep the key levels' identity inks (palette.ts).

   Pure selection (pickLevels, spaceLevels) for scripts/node-levels-proof.ts; drawLevels is the painter. */

import { HEAT_MODE } from './heatmap';
import { heatHueAt, type Rgb } from './nodeHeat';
import { CALL_WALL, PUT_WALL, SUPREME } from './palette';

/** The most bands drawn */
export const LEVELS_TOP_N = 5;
/** A strike under this share of the largest node is not a level */
export const LEVELS_MIN_SHARE = 0.25;
/** The bands named at the edge, the largest first */
export const LEVELS_LABELS = 3;
/** Two bands nearer than this on the price axis (CSS px) are one: the weaker is skipped */
export const LEVELS_MIN_GAP_PX = 12;
/** The hairline's and the heaviest band's half-height, CSS px */
export const LEVEL_A_MIN = 1;
export const LEVEL_A_MAX = 5.5;
/** Hue steps per side */
export const LEVEL_BINS = 8;

/** One strike of the newest column: its price and its dealer exposure (NaN or 0 for none) */
export interface LevelRow {
  strike: number;
  value: number;
}

/** A level the chart draws */
export interface LevelPick {
  strike: number;
  value: number;
  /** its size against the scale (the field's, else the largest node), 0..1 */
  t: number;
  /** 0 = the largest */
  rank: number;
  /** the weaker strikes it stands for (skipped as too near on the axis) */
  merged: number[];
}

/** The largest nodes: up to `n`, each at least `minShare` of the largest, largest first (equal sizes: the lower strike).
    `scale` is the size drawn at full strength (the field's own scale, which the key prints); the largest node by default. */
export function pickLevels(rows: readonly LevelRow[], n = LEVELS_TOP_N, minShare = LEVELS_MIN_SHARE, scale = 0): LevelPick[] {
  let top = 0;
  for (const r of rows) {
    const a = Math.abs(r.value);
    if (Number.isFinite(a) && a > top) top = a;
  }
  if (!(top > 0) || n <= 0) return [];
  return rows
    .filter(r => Number.isFinite(r.value) && r.value !== 0 && r.strike > 0 && Math.abs(r.value) >= minShare * top)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.strike - b.strike)
    .slice(0, n)
    .map((r, i) => ({ strike: r.strike, value: r.value, t: Math.min(1, Math.abs(r.value) / (scale > 0 ? scale : top)), rank: i, merged: [] }));
}

/**
 * The picks the axis has room for, largest first: a pick within `minPx` of one already kept is skipped and named on
 * the kept one's `merged`; a pick the scale cannot place is dropped. Ranks are renumbered in the kept order.
 */
export function spaceLevels(picks: readonly LevelPick[], yOf: (price: number) => number | null, minPx = LEVELS_MIN_GAP_PX): (LevelPick & { y: number })[] {
  const kept: (LevelPick & { y: number })[] = [];
  for (const p of [...picks].sort((a, b) => a.rank - b.rank)) {
    const y = yOf(p.strike);
    if (y == null || !Number.isFinite(y)) continue;
    const near = kept.find(k => Math.abs(k.y - y) < minPx);
    if (near) {
      near.merged.push(p.strike, ...p.merged);
      continue;
    }
    kept.push({ ...p, merged: [...p.merged], y });
  }
  return kept.map((k, i) => ({ ...k, rank: i }));
}

/** The band's half-height at strength t: t^1.6 between the hairline and the swell (the beads' own amplitude) */
export function levelHalf(t: number, aMin = LEVEL_A_MIN, aMax = LEVEL_A_MAX): number {
  const tt = t > 0 ? Math.min(1, t) : 0;
  return aMin + Math.pow(tt, 1.6) * (Math.max(aMin, aMax) - aMin);
}

/** The core's and the halo's opacity at strength t: see-through on purpose, the tape reads through */
export function levelAlpha(t: number): { core: number; halo: number } {
  const s = Math.pow(Math.max(0, Math.min(1, t)), 1.6);
  return { core: 0.3 + s * 0.45, halo: 0.06 + s * 0.14 };
}

/** The half-height a band may take: half the gap to its nearest drawn neighbour, less a pixel — no two ever touch */
export function levelRoom(y: number, ys: readonly number[]): number {
  let gap = Infinity;
  for (const o of ys) if (o !== y) gap = Math.min(gap, Math.abs(o - y));
  return Number.isFinite(gap) ? Math.max(0.5, gap / 2 - 1) : Infinity;
}

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SUPREME_RGB = hex(SUPREME);
const CW_RGB = hex(CALL_WALL);
const PW_RGB = hex(PUT_WALL);

const binOf = (t: number): number => Math.max(0, Math.min(LEVEL_BINS - 1, Math.round((0.2 + 0.8 * Math.max(0, Math.min(1, t))) * (LEVEL_BINS - 1))));
/** A band's side ink: dealers long gamma (value > 0) the glacier, short gamma the ember, at its strength */
export const levelSideInk = (value: number, t: number, light: boolean): Rgb => heatHueAt(value > 0 ? 0 : 1, binOf(t) / (LEVEL_BINS - 1), HEAT_MODE, light);

/** A band's ink: the identity inks first (the supreme, then the walls), else its side's */
export function levelInk(p: { strike: number; value: number; t: number }, ids: { supreme: number | null; cw: number | null; pw: number | null }, light: boolean): Rgb {
  const same = (a: number | null) => a != null && Math.abs(a - p.strike) < 1e-6;
  if (same(ids.supreme)) return SUPREME_RGB;
  if (same(ids.cw)) return CW_RGB;
  if (same(ids.pw)) return PW_RGB;
  return levelSideInk(p.value, p.t, light);
}

export interface LevelsView {
  levels: readonly (LevelPick & { y: number })[];
  /** where the trace starts (the first candle's left edge) and where the rung ends, CSS px */
  x0: number;
  x1: number;
  H: number;
  hr: number;
  vr: number;
  /** CSS px kept clear at the right for the edge label. The rung ends on its left. */
  gutter?: number;
  ids: { supreme: number | null; cw: number | null; pw: number | null };
  light: boolean;
}

/** Shortest and longest solid rung, CSS px. Length is the node's size. */
const RUNG_MIN = 16;
const RUNG_MAX = 44;

/** The traces and rungs into `ctx` (bitmap space). Returns a hover half-height (CSS px) for each drawn strike. */
export function drawLevels(ctx: CanvasRenderingContext2D, v: LevelsView): Map<number, number> {
  const out = new Map<number, number>();
  const L = Math.round(Math.max(0, v.x0) * v.hr);
  const edge = Math.round(v.x1 * v.hr) - Math.round(Math.max(0, v.gutter ?? 0) * v.hr);
  if (edge <= L + 4) return out;
  ctx.save();
  ctx.lineCap = 'butt';
  /* weakest first, so the largest lies on top where two lines share a pixel */
  for (const l of [...v.levels].sort((a, b) => a.t - b.t)) {
    if (l.y < -8 || l.y > v.H + 8) continue;
    const [r, g, b] = levelInk(l, v.ids, v.light);
    const s = Math.pow(Math.max(0, Math.min(1, l.t)), 0.85);
    const lw = Math.max(1, Math.round((l.rank === 0 ? 1.35 : 1) * v.vr));
    const yc = Math.round(l.y * v.vr) + (lw % 2 === 0 ? 0 : 0.5);
    const rung = Math.round((RUNG_MIN + (RUNG_MAX - RUNG_MIN) * s) * v.hr);
    const rungL = Math.max(L, edge - rung);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = lw;
    ctx.setLineDash([1.5 * v.hr, 4.5 * v.hr]);
    ctx.globalAlpha = 0.14 + s * 0.12;
    ctx.beginPath();
    ctx.moveTo(L, yc);
    ctx.lineTo(Math.max(L, rungL - 5 * v.hr), yc);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.78 + s * 0.18;
    ctx.beginPath();
    ctx.moveTo(rungL, yc);
    ctx.lineTo(edge, yc);
    ctx.stroke();
    out.set(l.strike, 6);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
  return out;
}
