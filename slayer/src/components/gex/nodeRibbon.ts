/* RIBBON — the exposure nodes as waveforms, not dots (the desk's 4th look, deskPrefs `nodeLook: 'ribbon'`).
   Each strike is a horizontal ribbon across time: every bead is as wide as its slot so the beads touch, and the strength
   shows as the ribbon's vertical THICKNESS, flickering bar to bar like an audio waveform. Weak strikes are hairlines.
   A translucent halo under a soft core lets the candles read through it.

   The data is the beads' own: gexNodesPrimitive's grid (values[col * R + row], one column a bar, the last reading of
   each bar kept), its scale (`ref`, the 98th percentile cell) and its view window. No request of its own, nothing
   invented: a column with no reading draws nothing, and a bar holds one bead because the grid holds one reading a bar.

   Inks are the desk's: long gamma climbs the glacier, short gamma the ember (heatmap.ts's house ramp, through the
   ladder's window — nodeHeat.heatHueAt — quantised to RIBBON_BINS so the batcher stays a batcher); the top node now in
   the beads' crown; the supreme, the call wall and the put wall in the key levels' inks (palette.ts); the flip a faint
   tick trail. One Path2D per ink and alpha step, filled into a bitmap kept until the view moves. */

import { HEAT_MODE } from './heatmap';
import { heatHueAt, type Rgb } from './nodeHeat';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './palette';

/** At most this many strikes a column; under this strength (against the field's scale) a cell is not drawn */
export const RIBBON_TOP_N = 12;
export const RIBBON_MIN_STRENGTH = 0.08;
/** The hairline's half-height, CSS px */
export const RIBBON_A_MIN = 0.45;
/** Hue steps per side */
export const RIBBON_BINS = 8;
/** A slot narrower than this (CSS px) is drawn every k-th bar */
export const RIBBON_MIN_SLOT = 3;

/** The heaviest ribbon's half-height: in proportion to the bar (about 60% of it), never under 3px or over 9px */
export const ribbonAMax = (barSpacing: number): number => Math.max(3, Math.min(barSpacing * 0.6, 9));

/** The half-height at strength t (0..1): t^1.6 between the hairline and the swell, capped by the row's own room */
export function ribbonHalf(t: number, aMin: number, aMax: number): number {
  const tt = t > 0 ? Math.min(1, t) : 0;
  const hi = Math.max(aMin, aMax);
  return aMin + Math.pow(tt, 1.6) * (hi - aMin);
}

/** Every k-th bar, so no slot is narrower than RIBBON_MIN_SLOT */
export const ribbonStride = (barSpacing: number): number => Math.max(1, Math.ceil(RIBBON_MIN_SLOT / Math.max(0.1, barSpacing)));

/** The hue bin at strength t, floored at 0.2 so the faintest cell still whispers its side's hue */
export const ribbonBin = (t: number): number => Math.max(0, Math.min(RIBBON_BINS - 1, Math.round((0.2 + 0.8 * Math.max(0, Math.min(1, t))) * (RIBBON_BINS - 1))));

/** The core's and the halo's opacity at strength t: translucent on purpose, the tape reads through */
export function ribbonAlpha(t: number): { core: number; halo: number } {
  const s = Math.pow(Math.max(0, Math.min(1, t)), 1.6);
  return { core: 0.16 + s * 0.5, halo: 0.04 + s * 0.14 };
}

/**
 * The column group's strongest rows: for each row in [rLo, rHi) the group's largest reading (so a strided zoom keeps
 * its peaks), the top `n` by size with strength ≥ `minT`. Writes rows and values into `outRows`/`outVals`; returns the
 * count. A row with no reading in the group is never picked.
 */
export function ribbonPick(
  vals: Float64Array,
  R: number,
  c0: number,
  c1: number,
  rLo: number,
  rHi: number,
  ref: number,
  n: number,
  minT: number,
  outRows: Int32Array,
  outVals: Float64Array,
): number {
  if (!(ref > 0)) return 0;
  const floor = minT * ref;
  let m = 0;
  for (let r = rLo; r < rHi; r++) {
    let v = NaN;
    for (let c = c0; c < c1; c++) {
      const w = vals[c * R + r];
      if (w === w && w !== 0 && (v !== v || Math.abs(w) > Math.abs(v))) v = w;
    }
    if (v !== v) continue;
    const a = Math.abs(v);
    if (a < floor) continue;
    if (m === n && a <= Math.abs(outVals[m - 1])) continue;
    /* insertion, largest first */
    let i = m < n ? m++ : m - 1;
    while (i > 0 && Math.abs(outVals[i - 1]) < a) {
      outRows[i] = outRows[i - 1];
      outVals[i] = outVals[i - 1];
      i--;
    }
    outRows[i] = r;
    outVals[i] = v;
  }
  return m;
}

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SUPREME_RGB = hex(SUPREME);
const CW_RGB = hex(CALL_WALL);
const PW_RGB = hex(PUT_WALL);
const FLIP_RGB = hex(FLIP);

/** side 0: dealers long gamma (glacier), 1: short gamma (ember) */
const sideInk = (side: number, bin: number, light: boolean): Rgb => heatHueAt(side, bin / (RIBBON_BINS - 1), HEAT_MODE, light);

/** The key's swatches in this look (FieldKey): short gamma left (ember), long gamma right (glacier), low to high */
export const RIBBON_RAMP_CSS = (() => {
  const css = (side: number) => `linear-gradient(90deg, ${Array.from({ length: RIBBON_BINS }, (_, b) => sideInk(side, b, false)).map(c => `rgb(${c[0]},${c[1]},${c[2]})`).join(', ')})`;
  return { pos: css(0), neg: css(1) } as const;
})();

export interface RibbonView {
  vals: Float64Array;
  R: number;
  strikes: readonly number[];
  /** the window's columns [first, last) and visible rows [rLo, rHi) */
  first: number;
  last: number;
  rLo: number;
  rHi: number;
  ref: number;
  barSpacing: number;
  hr: number;
  vr: number;
  W: number;
  H: number;
  /** a column's bar x (CSS px), null off the scale */
  xOf: (c: number) => number | null;
  /** a strike's y (CSS px), null off the scale */
  yOf: (p: number) => number | null;
  /** the room a row has: half the gap to its neighbour strikes, CSS px */
  roomOf: (r: number) => number;
  /** the top node now (crown), the supreme, the walls — rows, -1 for none */
  topRow: number;
  supremeRow: number;
  cwRow: number;
  pwRow: number;
  /** the flip's y (CSS px), null for none */
  flipY: number | null;
  crown: Rgb;
  light: boolean;
}

/**
 * The ribbons into `ctx` (bitmap space). Returns the rows drawn and their swell (CSS px) — the hover rings them.
 */
export function drawRibbons(ctx: CanvasRenderingContext2D, v: RibbonView): Map<number, number> {
  const { vals, R, strikes, first, last, rLo, rHi, ref, barSpacing, hr, vr, W, H } = v;
  const rows = new Map<number, number>();
  if (!(ref > 0) || last <= first || rHi <= rLo) return rows;
  const k = ribbonStride(barSpacing);
  const slot = barSpacing * k;
  const rx = slot * 0.54 * hr;
  const aMax = ribbonAMax(barSpacing);
  const outRows = new Int32Array(RIBBON_TOP_N);
  const outVals = new Float64Array(RIBBON_TOP_N);
  const yCache = new Map<number, number | null>();
  const yRow = (r: number): number | null => {
    let y = yCache.get(r);
    if (y === undefined) yCache.set(r, (y = v.yOf(strikes[r])));
    return y;
  };
  const roomCache = new Map<number, number>();
  const roomRow = (r: number): number => {
    let m = roomCache.get(r);
    if (m === undefined) roomCache.set(r, (m = v.roomOf(r)));
    return m;
  };
  const cores = new Map<string, Path2D>();
  const halos = new Map<string, Path2D>();
  const pathFor = (map: Map<string, Path2D>, key: string): Path2D => {
    let p = map.get(key);
    if (!p) map.set(key, (p = new Path2D()));
    return p;
  };
  const flip = new Path2D();
  let flipDrawn = false;
  let c0 = first - (first % k);
  if (c0 < first) c0 += k;
  for (let c = c0; c < last; c += k) {
    const x = v.xOf(c);
    if (x === null || x < -slot || x > W + slot) continue;
    const cx = x * hr;
    const n = ribbonPick(vals, R, c, Math.min(last, c + k), rLo, rHi, ref, RIBBON_TOP_N, RIBBON_MIN_STRENGTH, outRows, outVals);
    if (!n) continue;
    /* the flip's trail: a faint tick a slot, only where the column has a reading */
    if (v.flipY != null) {
      const w = slot * 0.5 * hr;
      flip.rect(cx - w / 2, v.flipY * vr - 0.6 * vr, w, 1.2 * vr);
      flipDrawn = true;
    }
    for (let i = 0; i < n; i++) {
      const r = outRows[i];
      const val = outVals[i];
      const y = yRow(r);
      if (y === null || y < -10 || y > H + 10) continue;
      const t = Math.min(1, Math.abs(val) / ref);
      const cap = Math.max(RIBBON_A_MIN, Math.min(aMax, roomRow(r)));
      const half = ribbonHalf(t, RIBBON_A_MIN, cap);
      rows.set(r, Math.max(rows.get(r) ?? 0, cap));
      const ry = half * vr;
      const yc = y * vr;
      const { core, halo } = ribbonAlpha(t);
      const ink = r === v.supremeRow ? 'k' : r === v.topRow ? 't' : r === v.cwRow ? 'cw' : r === v.pwRow ? 'pw' : `${val > 0 ? 0 : 1}@${ribbonBin(t)}`;
      /* under ~2px a round nose is invisible arc math: hairlines draw as rects */
      const round = ry > 2 * vr;
      if (t > 0.2 && ry * 1.9 > 2.2 * vr) {
        const hx = rx * 1.15;
        const hy = Math.min(ry * 1.9, Math.max(ry, roomRow(r) * vr));
        const p = pathFor(halos, `${ink}|${Math.round(halo * 40)}`);
        if (round) {
          p.moveTo(cx + hx, yc);
          p.ellipse(cx, yc, hx, hy, 0, 0, Math.PI * 2);
        } else p.rect(cx - hx, yc - hy, hx * 2, hy * 2);
      }
      const p = pathFor(cores, `${ink}|${Math.round(core * 20)}`);
      if (round) {
        p.moveTo(cx + rx, yc);
        p.ellipse(cx, yc, rx, ry, 0, 0, Math.PI * 2);
      } else p.rect(cx - rx, yc - ry, rx * 2, ry * 2);
    }
  }
  const named: Record<string, Rgb> = { k: SUPREME_RGB, t: v.crown, cw: CW_RGB, pw: PW_RGB };
  const paint = (map: Map<string, Path2D>, steps: number) => {
    for (const [key, path] of map) {
      const bar = key.indexOf('|');
      const ink = key.slice(0, bar);
      const at = ink.indexOf('@');
      const rgb = at > 0 ? sideInk(Number(ink.slice(0, at)), Number(ink.slice(at + 1)), v.light) : named[ink];
      if (!rgb) continue;
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(Number(key.slice(bar + 1)) / steps).toFixed(3)})`;
      ctx.fill(path);
    }
  };
  paint(halos, 40);
  paint(cores, 20);
  if (flipDrawn) {
    ctx.fillStyle = `rgba(${FLIP_RGB[0]},${FLIP_RGB[1]},${FLIP_RGB[2]},0.32)`;
    ctx.fill(flip);
  }
  return rows;
}

/** The ribbons' raster: a repaint with the same view blits it, a moved view rebuilds it */
export class RibbonCache {
  private key = '';
  private bmp: HTMLCanvasElement | null = null;
  private rows = new Map<number, number>();

  /** Draws (or blits) into `ctx`, a bitmap of `bw`×`bh`; returns the rows drawn */
  paint(ctx: CanvasRenderingContext2D, key: string, bw: number, bh: number, build: (c: CanvasRenderingContext2D) => Map<number, number>): Map<number, number> {
    if (key !== this.key || !this.bmp || this.bmp.width !== bw || this.bmp.height !== bh) {
      const bmp = this.bmp && this.bmp.width === bw && this.bmp.height === bh ? this.bmp : document.createElement('canvas');
      bmp.width = bw;
      bmp.height = bh;
      const b = bmp.getContext('2d');
      if (!b) return build(ctx);
      b.clearRect(0, 0, bw, bh);
      this.rows = build(b);
      this.bmp = bmp;
      this.key = key;
    }
    ctx.drawImage(this.bmp, 0, 0);
    return this.rows;
  }
}
