/* PHASE ONE OF TRADINGVIEW PARITY (2026-11-01): the drawing kinds the everyday set did not have — the rest of the lines
   and channels, the pitchforks, the fib and Gann family, the chart patterns and Elliott waves, the forecast, the arc, the
   signpost, the flag and the emoji stamp.

   Each kind describes itself ONCE, as a list of pieces (segments, polygons, circles, arcs, words) in whatever space it is
   asked for. The renderer strokes the pieces in bitmap pixels; the hit test measures the pointer against the very same
   pieces in CSS pixels — so what is drawn and what can be grabbed cannot disagree. The numbers come from
   drawingGeometry.ts, which scripts/drawing-geometry-proof.ts holds to the textbook. */

import { fmtElapsed, measureSpan } from '../../data/measure';
import { fmtPx } from '../../core/format';
import type { Drawing, DrawingKind, DrawingPoint } from './drawingsPrimitive';
import type { KindBar, KindHit, KindRender } from './drawingKinds';
import {
  abcdRatios,
  circleThrough,
  fibSpiral,
  fmtRatio,
  forkLines,
  gannDir,
  intersect,
  pearsonR,
  regression,
  screenAngle,
  threeDrivesRatios,
  xabcdRatios,
  type ForkVariant,
  type Pt,
} from './drawingGeometry';
import { gannName, levelsOf, opt } from './drawingLevels';

const UP = '48,209,88';
const DOWN = '255,59,48';

/** How many presses a pattern takes before it seals itself */
export const PATTERN_POINTS: Partial<Record<DrawingKind, number>> = {
  xabcd: 5,
  abcd: 4,
  hs: 7,
  tripattern: 4,
  threedrives: 7,
  elliott5: 6,
  elliott3: 4,
};

/** The points' names a pattern prints beside its pivots */
const PATTERN_NAMES: Partial<Record<DrawingKind, string[]>> = {
  xabcd: ['X', 'A', 'B', 'C', 'D'],
  abcd: ['A', 'B', 'C', 'D'],
  tripattern: ['A', 'B', 'C', 'D'],
  elliott5: ['0', '1', '2', '3', '4', '5'],
  elliott3: ['0', 'A', 'B', 'C'],
  threedrives: ['', '1', '', '2', '', '3', ''],
  hs: ['', 'Left shoulder', '', 'Head', '', 'Right shoulder', ''],
};

export type Piece =
  | { t: 'candle'; x: number; o: number; h: number; l: number; c: number; bw: number; dim?: boolean; stick?: 'hl' | 'oc' }
  | { t: 'seg'; a: Pt; b: Pt; dim?: boolean; dash?: boolean; thin?: boolean }
  | { t: 'poly'; pts: Pt[]; closed?: boolean; dim?: boolean; dash?: boolean }
  | { t: 'fill'; pts: Pt[]; a?: number; rgb?: string; solid?: boolean }
  | { t: 'circle'; c: Pt; r: number; dim?: boolean }
  | { t: 'arc'; c: Pt; r: number; a0: number; a1: number; ccw: boolean; dim?: boolean }
  | { t: 'words'; text: string; x: number; y: number; dim?: boolean; rgb?: string; px?: number; frame?: boolean; centre?: boolean; solid?: boolean; bare?: boolean; bold?: boolean }
  | { t: 'glyph'; text: string; x: number; y: number; px: number; set?: string }
  | { t: 'flag'; x: number; y: number }
  | { t: 'dot'; p: Pt };

/** What the pieces are laid out in: one space, its own x and y, its own pixel size */
export interface Space {
  X(time: number): number | null;
  Y(price: number): number | null;
  w: number;
  h: number;
  /** one CSS px in this space, horizontally and vertically */
  s: number;
  v: number;
  bars: KindBar[];
  barMinutes: number;
  typePx(width?: number): number;
  /** bar index of a time on the chart's grid, and the time at an index (off either end it keeps counting) */
  idx(time: number): number | null;
  timeAt(i: number): number | null;
}

const NEW_KINDS = new Set<DrawingKind>([
  'infoline', 'trendangle', 'regression', 'flattop', 'disjoint', 'pitchfork', 'schiff', 'mschiff',
  'fibtime', 'fibfan', 'fibcircles', 'fibspiral', 'fibwedge', 'gannbox', 'gannsquare', 'gannfan',
  'xabcd', 'abcd', 'hs', 'tripattern', 'threedrives', 'elliott5', 'elliott3',
  'forecast', 'arc', 'signpost', 'flag', 'stamp',
]);
export const isMoreKind = (k: DrawingKind): boolean => NEW_KINDS.has(k);

/** Where a ray from a through b leaves the box [0, w] */
export const rayTo = (a: Pt, b: Pt, w: number): Pt => {
  if (b[0] === a[0]) return [a[0], b[1] >= a[1] ? 1e5 : -1e5];
  const xe = b[0] > a[0] ? w : 0;
  return [xe, a[1] + ((b[1] - a[1]) / (b[0] - a[0])) * (xe - a[0])];
};

const priceWords = (p: number): string => fmtPx(p);
const pctWords = (d: number, base: number): string => `${d >= 0 ? '+' : '−'}${Math.abs((d / base) * 100).toFixed(2)}%`;
const signed = (d: number): string => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;

/** The regression trend's centre and band over the closes between its anchors — in bar index, so a timeframe change re-reads it */
export function regressionOf(d: Drawing, bars: KindBar[]): { i0: number; i1: number; slope: number; icept: number; sd: number; pearson: number | null } | null {
  if (!d.p2 || bars.length < 2) return null;
  const t0 = Math.min(d.p1.time, d.p2.time);
  const t1 = Math.max(d.p1.time, d.p2.time);
  let i0 = bars.findIndex(b => b.time >= t0);
  if (i0 < 0) return null;
  let i1 = i0;
  while (i1 + 1 < bars.length && bars[i1 + 1].time <= t1) i1++;
  if (i1 - i0 < 1) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = i0; i <= i1; i++) {
    xs.push(i);
    ys.push(bars[i].close);
  }
  const r = regression(xs, ys);
  if (!r) return null;
  i0 = Math.max(0, i0);
  return { i0, i1, ...r, pearson: pearsonR(xs, ys) };
}

/** A pivot's word sits above a peak and below a trough */
const besideY = (pts: Pt[], i: number, gap: number): number => {
  const p = pts[i];
  const ref = [pts[i - 1], pts[i + 1]].filter(Boolean) as Pt[];
  const peak = ref.length ? ref.every(q => p[1] <= q[1]) : true;
  return peak ? p[1] - gap : p[1] + gap;
};

/** The pieces `d` is made of, in space `S`; null when it cannot be placed (an anchor off the grid) */
function piecesOf(d: Drawing, S: Space, draft: boolean): Piece[] | null {
  const P = (p?: DrawingPoint): Pt | null => {
    if (!p) return null;
    const x = S.X(p.time);
    const y = S.Y(p.price);
    return x === null || y === null ? null : [x, y];
  };
  const a = P(d.p1);
  const b = P(d.p2);
  const c = P(d.p3);
  const out: Piece[] = [];
  const s = S.s;
  const v = S.v;

  switch (d.kind) {
    // ── lines ───────────────────────────────────────────────────────────────
    case 'infoline': {
      if (!a || !b || !d.p2) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      const delta = d.p2.price - d.p1.price;
      const span = measureSpan(d.p1.time, d.p1.price, d.p2.time, d.p2.price, S.barMinutes);
      const ang = screenAngle([a[0] / s, a[1] / v], [b[0] / s, b[1] / v]);
      const when = S.barMinutes > 0 ? `${span.bars} bar${span.bars === 1 ? '' : 's'} · ${fmtElapsed(span.tradingMin)}` : fmtElapsed(span.tradingMin);
      const x = Math.max(a[0], b[0]) + 8 * s;
      const y = (a[1] + b[1]) / 2;
      out.push(
        { t: 'words', text: `${signed(delta)}  ${pctWords(delta, d.p1.price)}`, x, y: y - 16 * v, rgb: delta >= 0 ? UP : DOWN, solid: true },
        { t: 'words', text: when, x, y, solid: true },
        { t: 'words', text: `angle ${ang.toFixed(1)}°`, x, y: y + 16 * v, solid: true }
      );
      return out;
    }
    case 'trendangle': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      const len = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), 70 * s);
      out.push({ t: 'seg', a, b: [a[0] + Math.max(len, 30 * s), a[1]], dim: true, dash: true });
      const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const r = Math.max(18 * s, len * 0.55);
      out.push({ t: 'arc', c: a, r, a0: 0, a1: th, ccw: th < 0, dim: true });
      const ang = screenAngle([a[0] / s, a[1] / v], [b[0] / s, b[1] / v]);
      out.push({ t: 'words', text: `${ang.toFixed(1)}°`, x: a[0] + r + 6 * s, y: a[1] + (th < 0 ? -9 : 9) * v });
      return out;
    }
    case 'regression': {
      if (!a || !b) return null;
      const r = regressionOf(d, S.bars);
      if (!r) {
        out.push({ t: 'seg', a, b, dash: true, dim: true });
        if (!draft) out.push({ t: 'words', text: 'regression needs two bars', x: Math.max(a[0], b[0]) + 6 * s, y: b[1], dim: true });
        return out;
      }
      const x0 = S.X(S.bars[r.i0].time);
      const x1 = S.X(S.bars[r.i1].time);
      if (x0 === null || x1 === null) return null;
      const K = Math.max(0, Number(opt<number>(d, 'sd', 2)) || 0);
      const at = (i: number, k: number) => S.Y(r.icept + r.slope * i + k * K * r.sd);
      const lines: Pt[][] = [];
      for (const k of [1, 0, -1]) {
        const y0 = at(r.i0, k);
        const y1 = at(r.i1, k);
        if (y0 === null || y1 === null) return null;
        lines.push([[x0, y0], [x1, y1]]);
      }
      const upper = opt<boolean>(d, 'upper');
      const lower = opt<boolean>(d, 'lower');
      const kw = `${+K.toFixed(2)}σ`;
      out.push({ t: 'fill', pts: [(upper ? lines[0] : lines[1])[0], (upper ? lines[0] : lines[1])[1], (lower ? lines[2] : lines[1])[1], (lower ? lines[2] : lines[1])[0]], a: 0.05 });
      out.push({ t: 'seg', a: lines[1][0], b: lines[1][1], dash: true });
      if (upper) {
        out.push({ t: 'seg', a: lines[0][0], b: lines[0][1], dim: true });
        out.push({ t: 'words', text: `+${kw} ${priceWords(r.icept + r.slope * r.i1 + K * r.sd)}`, x: x1 + 6 * s, y: lines[0][1][1], dim: true });
      }
      if (lower) {
        out.push({ t: 'seg', a: lines[2][0], b: lines[2][1], dim: true });
        out.push({ t: 'words', text: `−${kw} ${priceWords(r.icept + r.slope * r.i1 - K * r.sd)}`, x: x1 + 6 * s, y: lines[2][1][1], dim: true });
      }
      if (opt<boolean>(d, 'pearson') && r.pearson !== null) out.push({ t: 'words', text: `R ${r.pearson.toFixed(3)}`, x: x0 + 4 * s, y: Math.max(lines[0][0][1], lines[2][0][1]) + 14 * v, dim: true });
      return out;
    }
    case 'flattop': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (c) {
        const fa: Pt = [a[0], c[1]];
        const fb: Pt = [b[0], c[1]];
        out.push({ t: 'fill', pts: [a, b, fb, fa], a: 0.055 }, { t: 'seg', a: fa, b: fb }, { t: 'dot', p: c });
      }
      return out;
    }
    case 'disjoint': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (c) {
        const da: Pt = [a[0], c[1]];
        const db: Pt = [b[0], c[1] - (b[1] - a[1])];
        out.push({ t: 'fill', pts: [a, b, db, da], a: 0.055 }, { t: 'seg', a: da, b: db }, { t: 'dot', p: c });
      }
      return out;
    }
    case 'pitchfork':
    case 'schiff':
    case 'mschiff': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) {
        out.push({ t: 'seg', a, b, dim: true });
        return out;
      }
      const v2: ForkVariant = d.kind === 'pitchfork' ? 'standard' : d.kind === 'schiff' ? 'schiff' : 'mschiff';
      const ls = forkLines(a, b, c, v2, levelsOf(d));
      const med = ls.find(l => l.level === 0)!;
      const origin: Pt = [med.from[0] - med.dir[0], med.from[1] - med.dir[1]];
      const far = (from: Pt, dir: Pt): Pt => (dir[0] === 0 && dir[1] === 0 ? from : rayTo(from, [from[0] + dir[0], from[1] + dir[1]], S.w));
      const lo = ls[0];
      const hi = ls[ls.length - 1];
      if (ls.length > 1) out.push({ t: 'fill', pts: [lo.from, far(lo.from, lo.dir), far(hi.from, hi.dir), hi.from], a: 0.045 });
      out.push({ t: 'seg', a: b, b: c, dim: true });
      out.push({ t: 'seg', a: origin, b: far(origin, med.dir) });
      for (const l of ls) {
        if (l.level === 0) continue;
        const outer = Math.abs(l.level) >= 1;
        out.push({ t: 'seg', a: l.from, b: far(l.from, l.dir), dim: outer, dash: outer });
      }
      if (d.kind !== 'pitchfork') out.push({ t: 'seg', a, b: origin, dim: true, dash: true }, { t: 'dot', p: origin });
      out.push({ t: 'dot', p: c });
      return out;
    }

    // ── fib and Gann ──────────────────────────────────────────────────────────
    case 'fibtime': {
      if (!a || !b) return null;
      const dx = b[0] - a[0];
      out.push({ t: 'seg', a, b, dim: true, dash: true }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (Math.abs(dx) < 2 * s) return out;
      for (const n of levelsOf(d)) {
        const x = a[0] + n * dx;
        if (x < -2 || x > S.w + 2) continue;
        const major = n === 0 || n === 1 || n === 5 || n === 13 || n === 34 || n === 89;
        out.push({ t: 'seg', a: [x, 0], b: [x, S.h], dim: !major, thin: true });
        out.push({ t: 'words', text: String(n), x: x + 3 * s, y: 12 * v, dim: !major });
      }
      return out;
    }
    case 'fibfan': {
      if (!a || !b) return null;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      out.push({ t: 'poly', pts: [a, [b[0], a[1]], b, [a[0], b[1]]], closed: true, dim: true, dash: true });
      out.push({ t: 'seg', a, b: rayTo(a, b, S.w) }, { t: 'dot', p: a }, { t: 'dot', p: b });
      for (const r of levelsOf(d)) {
        const pp: Pt = [b[0], a[1] + dy * r];
        const tp: Pt = [a[0] + dx * r, b[1]];
        out.push({ t: 'seg', a, b: rayTo(a, pp, S.w), dim: true }, { t: 'seg', a, b: rayTo(a, tp, S.w), dim: true });
        out.push({ t: 'words', text: String(r), x: b[0] + 4 * s, y: pp[1], dim: true, px: 9 });
      }
      return out;
    }
    case 'fibcircles': {
      if (!a || !b) return null;
      const R0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push({ t: 'seg', a, b, dim: true, dash: true }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (R0 < 2) return out;
      /* a ring is named only where it stands clear of the last named one — small circles keep their names apart */
      let named = -Infinity;
      for (const r of levelsOf(d)) {
        out.push({ t: 'circle', c: a, r: R0 * r, dim: r !== 1 });
        if (R0 * r - named < 34 * s) continue;
        named = R0 * r;
        out.push({ t: 'words', text: String(r), x: a[0] + R0 * r + 3 * s, y: a[1], dim: r !== 1, px: 9 });
      }
      return out;
    }
    case 'fibspiral': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b, dim: true, dash: true }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return out;
      out.push({ t: 'poly', pts: fibSpiral(a, b) });
      return out;
    }
    case 'fibwedge': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) return out;
      const R0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tb = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const tc = Math.atan2(c[1] - a[1], c[0] - a[0]);
      let sweep = tc - tb;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push({ t: 'seg', a, b: [a[0] + R0 * Math.cos(tc), a[1] + R0 * Math.sin(tc)] }, { t: 'dot', p: c });
      for (const r of levelsOf(d)) {
        out.push({ t: 'arc', c: a, r: R0 * r, a0: tb, a1: tb + sweep, ccw: sweep < 0, dim: r !== 1 });
        out.push({ t: 'words', text: String(r), x: a[0] + R0 * r * Math.cos(tb) + 3 * s, y: a[1] + R0 * r * Math.sin(tb), dim: true, px: 9 });
      }
      return out;
    }
    case 'gannbox':
    case 'gannsquare': {
      if (!a || !b) return null;
      let bb = b;
      /* the square keeps its sides equal on screen — the fixed ratio of bars to points the reader sets with the drag */
      if (d.kind === 'gannsquare') {
        const side = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        bb = [a[0] + Math.sign(b[0] - a[0] || 1) * side, a[1] + Math.sign(b[1] - a[1] || 1) * side];
      }
      const x0 = Math.min(a[0], bb[0]);
      const x1 = Math.max(a[0], bb[0]);
      const y0 = Math.min(a[1], bb[1]);
      const y1 = Math.max(a[1], bb[1]);
      out.push({ t: 'fill', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], a: 0.04, solid: true });
      out.push({ t: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
      const lv = d.kind === 'gannbox' ? levelsOf(d) : [0, 0.25, 0.5, 0.75, 1];
      for (const r of lv) {
        if (r === 0 || r === 1) continue;
        const x = a[0] + (bb[0] - a[0]) * r;
        const y = a[1] + (bb[1] - a[1]) * r;
        out.push({ t: 'seg', a: [x, y0], b: [x, y1], dim: true, thin: true }, { t: 'seg', a: [x0, y], b: [x1, y], dim: true, thin: true });
      }
      if (d.kind === 'gannbox') {
        /* every level is labelled where the box has room for it; a small box keeps its quarters and its half */
        const room = (r: number, span: number, need: number) => (r === 0.382 || r === 0.618 ? span * 0.118 > need : r === 0.25 || r === 0.75 ? span * 0.25 > need : true);
        for (const r of levelsOf(d)) {
          const x = a[0] + (bb[0] - a[0]) * r;
          const y = a[1] + (bb[1] - a[1]) * r;
          const roomX = room(r, x1 - x0, 34 * s);
          const roomY = room(r, y1 - y0, 16 * v);
          if (roomX) out.push({ t: 'words', text: String(r), x: x - 8 * s, y: y0 - 9 * v, dim: true, px: 9 });
          if (roomY) out.push({ t: 'words', text: String(r), x: x1 + 4 * s, y, dim: true, px: 9 });
        }
      } else {
        /* the square's own angles: both diagonals, the fan from its anchor, and the arcs of a quarter and a half turn */
        out.push({ t: 'seg', a: [x0, y0], b: [x1, y1], dim: true }, { t: 'seg', a: [x0, y1], b: [x1, y0], dim: true });
        const side = x1 - x0;
        for (const r of [0.5, 1]) {
          const th0 = Math.atan2(0, Math.sign(bb[0] - a[0]) || 1);
          const th1 = Math.atan2(Math.sign(bb[1] - a[1]) || 1, 0);
          let sw = th1 - th0;
          while (sw > Math.PI) sw -= 2 * Math.PI;
          while (sw < -Math.PI) sw += 2 * Math.PI;
          out.push({ t: 'arc', c: a, r: side * r, a0: th0, a1: th0 + sw, ccw: sw < 0, dim: true });
        }
      }
      out.push({ t: 'dot', p: a }, { t: 'dot', p: bb });
      return out;
    }
    case 'gannfan': {
      if (!a || !b) return null;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (Math.hypot(dx, dy) < 2) return out;
      const L = Math.hypot(dx, dy);
      let lastTip: Pt | null = null;
      for (const ratio of levelsOf(d)) {
        const g = ratio >= 1 ? { p: ratio, t: 1, name: gannName(ratio) } : { p: 1, t: 1 / ratio, name: gannName(ratio) };
        const dir = gannDir(dx, dy, g.p, g.t);
        const k = L / Math.hypot(dir[0], dir[1]);
        const tip: Pt = [a[0] + dir[0] * k, a[1] + dir[1] * k];
        const one = Math.abs(g.p - g.t) < 1e-9;
        out.push({ t: 'seg', a, b: rayTo(a, [a[0] + dir[0], a[1] + dir[1]], S.w), dim: !one });
        /* the steep angles crowd at the anchors' distance: a name too near the last one waits for room */
        if (one || !lastTip || Math.hypot(tip[0] - lastTip[0], tip[1] - lastTip[1]) >= 26 * s) {
          out.push({ t: 'words', text: g.name, x: tip[0] + 3 * s, y: tip[1], dim: !one, px: 9 });
          lastTip = tip;
        }
      }
      return out;
    }

    // ── patterns ──────────────────────────────────────────────────────────────
    case 'xabcd':
    case 'abcd':
    case 'hs':
    case 'tripattern':
    case 'threedrives':
    case 'elliott5':
    case 'elliott3': {
      const ps: Pt[] = [];
      for (const q of d.pts ?? []) {
        const p = P(q);
        if (!p) return null;
        ps.push(p);
      }
      if (ps.length < 2) return null;
      const n = PATTERN_POINTS[d.kind] ?? ps.length;
      const whole = ps.length >= n && !draft;
      const pr = (d.pts ?? []).map(q => q.price);
      const ratioAt = (i: number, j: number, r: number | null) => {
        out.push({ t: 'seg', a: ps[i], b: ps[j], dim: true, dash: true });
        out.push({ t: 'words', text: fmtRatio(r), x: (ps[i][0] + ps[j][0]) / 2 - 14 * s, y: (ps[i][1] + ps[j][1]) / 2, px: 9, frame: true });
      };
      if (d.kind === 'xabcd' && ps.length >= 3) {
        out.push({ t: 'fill', pts: [ps[0], ps[1], ps[2]], a: 0.08 });
        if (ps.length >= 5) out.push({ t: 'fill', pts: [ps[2], ps[3], ps[4]], a: 0.08 });
      }
      if (d.kind === 'hs' && ps.length >= 3) {
        for (let i = 0; i + 2 < ps.length; i += 2) out.push({ t: 'fill', pts: [ps[i], ps[i + 1], ps[i + 2]], a: 0.07 });
      }
      if (d.kind === 'tripattern' && ps.length >= 4) {
        const x = intersect(ps[0], ps[2], ps[1], ps[3]);
        const reach = x && x[0] > Math.max(ps[2][0], ps[3][0]) && x[0] < S.w * 3 ? x[0] : S.w;
        const along = (p: Pt, q: Pt): Pt => (q[0] === p[0] ? q : [reach, p[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (reach - p[0])]);
        const e1 = along(ps[0], ps[2]);
        const e2 = along(ps[1], ps[3]);
        out.push({ t: 'fill', pts: [ps[0], e1, e2, ps[1]], a: 0.06 });
        out.push({ t: 'seg', a: ps[0], b: e1, dim: true }, { t: 'seg', a: ps[1], b: e2, dim: true });
      }
      out.push({ t: 'poly', pts: ps });
      for (const p of ps) out.push({ t: 'dot', p });
      if (whole) {
        if (d.kind === 'xabcd') {
          const r = xabcdRatios(pr[0], pr[1], pr[2], pr[3], pr[4]);
          ratioAt(0, 2, r.ab);
          ratioAt(1, 3, r.bc);
          ratioAt(2, 4, r.cd);
          ratioAt(0, 4, r.xd);
        } else if (d.kind === 'abcd') {
          const r = abcdRatios(pr[0], pr[1], pr[2], pr[3]);
          ratioAt(0, 2, r.bc);
          ratioAt(1, 3, r.cd);
        } else if (d.kind === 'threedrives') {
          const r = threeDrivesRatios(pr);
          /* each pullback against the drive before it, each later drive against its pullback */
          for (let i = 2; i < ps.length - 1; i++) out.push({ t: 'words', text: fmtRatio(r[i - 2]), x: ps[i][0] + 6 * s, y: besideY(ps, i, 14 * v) + (i % 2 ? -12 : 12) * v, px: 9, dim: true });
        } else if (d.kind === 'hs') {
          const nl = (x: number): number => (ps[4][0] === ps[2][0] ? ps[2][1] : ps[2][1] + ((ps[4][1] - ps[2][1]) / (ps[4][0] - ps[2][0])) * (x - ps[2][0]));
          const xa = ps[0][0];
          const xb = ps[6][0] + (ps[6][0] - ps[4][0]) * 0.5;
          out.push({ t: 'seg', a: [xa, nl(xa)], b: [xb, nl(xb)], dash: true });
          out.push({ t: 'words', text: 'neckline', x: xb + 4 * s, y: nl(xb), dim: true, px: 9 });
        }
      }
      const names = PATTERN_NAMES[d.kind] ?? [];
      ps.forEach((p, i) => {
        const nm = names[i];
        if (!nm) return;
        const circled = d.kind === 'elliott5' || d.kind === 'elliott3';
        out.push({ t: 'words', text: circled ? `(${nm})` : nm, x: p[0], y: besideY(ps, i, 13 * v), centre: true, px: nm.length > 2 ? 10 : 11, frame: !circled });
      });
      return out;
    }

    // ── forecast ──────────────────────────────────────────────────────────────
    case 'forecast': {
      if (!a || !b || !d.p2) return null;
      const delta = d.p2.price - d.p1.price;
      const ink = delta >= 0 ? UP : DOWN;
      out.push({ t: 'seg', a, b: [b[0], a[1]], dim: true, dash: true });
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      const span = measureSpan(d.p1.time, d.p1.price, d.p2.time, d.p2.price, S.barMinutes);
      const when = S.barMinutes > 0 ? `in ${span.bars} bar${span.bars === 1 ? '' : 's'} · ${fmtElapsed(span.tradingMin)}` : `in ${fmtElapsed(span.tradingMin)}`;
      const up = b[1] < a[1];
      out.push(
        { t: 'words', text: `Forecast ${priceWords(d.p2.price)}  ${signed(delta)}  ${pctWords(delta, d.p1.price)}`, x: b[0] + 8 * s, y: b[1] + (up ? -10 : 10) * v, rgb: ink, solid: true, frame: true },
        { t: 'words', text: when, x: b[0] + 8 * s, y: b[1] + (up ? 8 : 28) * v, dim: true, solid: true }
      );
      return out;
    }

    // ── shapes ────────────────────────────────────────────────────────────────
    case 'arc': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) {
        out.push({ t: 'seg', a, b, dim: true });
        return out;
      }
      const k = circleThrough(a, c, b);
      if (!k) {
        out.push({ t: 'seg', a, b });
        return out;
      }
      const ta = Math.atan2(a[1] - k.c[1], a[0] - k.c[0]);
      const tb = Math.atan2(b[1] - k.c[1], b[0] - k.c[0]);
      const tc = Math.atan2(c[1] - k.c[1], c[0] - k.c[0]);
      const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      /* clockwise from a to b passes c, or the other way round does */
      const cw = norm(tc - ta) <= norm(tb - ta);
      out.push({ t: 'arc', c: k.c, r: k.r, a0: ta, a1: tb, ccw: !cw }, { t: 'dot', p: c });
      return out;
    }

    // ── words and stamps ────────────────────────────────────────────────────────
    case 'signpost': {
      if (!a) return null;
      const px = S.typePx(d.width);
      const top = a[1] - 30 * v;
      out.push({ t: 'seg', a, b: [a[0], top], thin: true }, { t: 'dot', p: a });
      out.push({ t: 'words', text: d.text ?? '', x: a[0], y: top - px * 0.9 * v, px, frame: true, centre: true, solid: true });
      return out;
    }
    case 'flag': {
      if (!a) return null;
      out.push({ t: 'flag', x: a[0], y: a[1] });
      return out;
    }
    case 'stamp': {
      if (!a) return null;
      out.push({ t: 'glyph', text: d.text ?? '★', x: a[0], y: a[1], px: S.typePx(d.width) * 1.9, set: String(d.opts?.set ?? 'emoji') });
      return out;
    }
    default:
      return null;
  }
}

// ---- DRAWN ---------------------------------------------------------------------------------------------

/** Draw `d` if it is one of the phase-one kinds. False: not mine. */
/** The space a paint lays its pieces out in — bitmap px */
export const renderSpace = (R: KindRender): Space => ({
  X: R.X,
  Y: R.Y,
  w: R.w,
  h: R.h,
  s: R.hr,
  v: R.vr,
  bars: R.bars,
  barMinutes: R.barMinutes,
  typePx: R.typePx,
  idx: t => R.idx?.(t) ?? null,
  timeAt: i => R.timeAt?.(i) ?? null,
});
/** …and the one a hit test measures in — CSS px */
export const hitSpace = (H: KindHit, barMinutes = 1): Space => ({
  X: H.X,
  Y: H.Y,
  w: H.w,
  h: H.h,
  s: 1,
  v: 1,
  bars: H.bars,
  barMinutes,
  typePx: H.typePx,
  idx: t => H.idx?.(t) ?? null,
  timeAt: i => H.timeAt?.(i) ?? null,
});

export function renderMore(d: Drawing, R: KindRender): boolean {
  if (!NEW_KINDS.has(d.kind)) return false;
  const ps = piecesOf(d, renderSpace(R), R.draft);
  if (ps) drawPieces(ps, R);
  return true;
}

/** Stroke, fill and print a list of pieces — every kind built from pieces paints through here */
export function drawPieces(ps: Piece[], R: KindRender): void {
  const { ctx, hr, vr, ink, alpha } = R;
  const baseDash = ctx.getLineDash();
  const baseW = ctx.lineWidth;
  const stroke = (dim?: boolean, dash?: boolean, thin?: boolean) => {
    ctx.strokeStyle = `rgba(${ink},${dim ? alpha * 0.5 : alpha})`;
    ctx.lineWidth = thin ? Math.max(1, baseW * 0.7) : baseW;
    ctx.setLineDash(dash ? [4 * hr, 4 * hr] : baseDash);
  };
  /* the fills first, the lines over them, the words over everything */
  for (const p of ps) {
    if (p.t !== 'fill') continue;
    ctx.fillStyle = `rgba(${p.rgb ?? ink},${(p.a ?? 0.055) * (alpha / 0.8)})`;
    ctx.beginPath();
    p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.fill();
  }
  for (const p of ps) {
    if (p.t === 'seg') {
      stroke(p.dim, p.dash, p.thin);
      ctx.beginPath();
      ctx.moveTo(p.a[0], p.a[1]);
      ctx.lineTo(p.b[0], p.b[1]);
      ctx.stroke();
    } else if (p.t === 'poly') {
      stroke(p.dim, p.dash);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (p.closed) ctx.closePath();
      ctx.stroke();
    } else if (p.t === 'circle') {
      stroke(p.dim);
      ctx.beginPath();
      ctx.arc(p.c[0], p.c[1], Math.max(0.5, p.r), 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.t === 'arc') {
      stroke(p.dim);
      ctx.beginPath();
      ctx.arc(p.c[0], p.c[1], Math.max(0.5, p.r), p.a0, p.a1, p.ccw);
      ctx.stroke();
    } else if (p.t === 'flag') {
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = 1.4 * vr;
      ctx.strokeStyle = `rgba(${ink},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 24 * vr);
      ctx.stroke();
      ctx.fillStyle = `rgba(${R.inked ? ink : '255,107,74'},${Math.min(1, alpha + 0.1)})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 24 * vr);
      ctx.lineTo(p.x + 14 * hr, p.y - 19.5 * vr);
      ctx.lineTo(p.x, p.y - 15 * vr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.t === 'dot') {
      ctx.fillStyle = `rgba(${ink},${alpha})`;
      R.dot(p.p[0], p.p[1]);
    } else if (p.t === 'candle') {
      /* a projected or copied candle: rising hollow, falling filled, in the mark's own ink — never the market's colours */
      const a = p.dim ? alpha * 0.55 : alpha;
      const up = p.c <= p.o;
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(1, 1 * hr);
      ctx.strokeStyle = `rgba(${ink},${a})`;
      ctx.fillStyle = `rgba(${ink},${a * 0.85})`;
      if (p.stick === 'hl') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.h);
        ctx.lineTo(p.x, p.l);
        ctx.stroke();
      } else if (p.stick === 'oc') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.o);
        ctx.lineTo(p.x, p.c);
        ctx.lineWidth = Math.max(1.5 * hr, p.bw * 0.5);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x, p.h);
        ctx.lineTo(p.x, Math.min(p.o, p.c));
        ctx.moveTo(p.x, Math.max(p.o, p.c));
        ctx.lineTo(p.x, p.l);
        ctx.stroke();
        const top = Math.min(p.o, p.c);
        const hh = Math.max(1, Math.abs(p.c - p.o));
        if (up) ctx.strokeRect(p.x - p.bw / 2, top, p.bw, hh);
        else ctx.fillRect(p.x - p.bw / 2, top, p.bw, hh);
      }
      ctx.restore();
    }
  }
  ctx.setLineDash([]);
  for (const p of ps) {
    if (p.t === 'glyph') {
      /* a sticker sits on a round badge with a white rim; an icon is a plain symbol in the mark's own ink */
      if (p.set === 'sticker') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.px * 0.72 * vr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ink},${Math.min(1, alpha) * 0.22})`;
        ctx.fill();
        ctx.lineWidth = 2.2 * vr;
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.1)})`;
        ctx.stroke();
      }
      ctx.font = p.set === 'icon' ? `${p.px * vr}px ui-sans-serif, system-ui, "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif` : `${p.px * vr}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${p.set === 'icon' ? ink : R.textInk},${Math.min(1, alpha + 0.2)})`;
      ctx.fillText(p.text, p.x, p.y);
      ctx.textAlign = 'start';
      continue;
    }
    if (p.t !== 'words' || !p.text) continue;
    const px = p.px ?? 10;
    ctx.font = p.bold ? R.font(px).replace(/^500 /, '700 ') : R.font(px);
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(p.text).width;
    const pad = 4 * hr;
    const bw = tw + pad * 2;
    const hh = px * 0.85 * vr;
    let bx = p.centre ? p.x - bw / 2 : p.x;
    if (p.bare) bx = p.centre ? p.x - tw / 2 - pad : p.x - pad;
    else bx = Math.max(2 * hr, Math.min(bx, R.w - bw - 2 * hr));
    if (!p.bare) R.wash(bx, p.y - hh, bw, hh * 2, 3 * vr, 'rgba(10,10,10,0.82)', p.frame ? `rgba(${ink},0.45)` : undefined);
    ctx.fillStyle = `rgba(${p.rgb ?? R.textInk},${p.dim ? alpha * 0.7 : Math.min(1, alpha + 0.15)})`;
    ctx.fillText(p.text, bx + pad, p.y);
  }
}

// ---- HIT -----------------------------------------------------------------------------------------------

/** Is the pointer on `d`? null: not one of the phase-one kinds. */
export function hitMore(d: Drawing, H: KindHit, barMinutes = 1): boolean | null {
  if (!NEW_KINDS.has(d.kind)) return null;
  const ps = piecesOf(d, hitSpace(H, barMinutes), false);
  return ps ? hitPieces(ps, H) : false;
}

/** Is the pointer on any of these pieces (CSS px)? */
export function hitPieces(ps: Piece[], H: KindHit): boolean {
  const { x, y, BODY } = H;
  const inPoly = (poly: Pt[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const p of ps) {
    switch (p.t) {
      case 'seg':
        if (H.distSeg(p.a[0], p.a[1], p.b[0], p.b[1]) <= BODY) return true;
        break;
      case 'poly':
        for (let i = 1; i < p.pts.length; i++) if (H.distSeg(p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]) <= BODY) return true;
        if (p.closed && p.pts.length > 2 && H.distSeg(p.pts[p.pts.length - 1][0], p.pts[p.pts.length - 1][1], p.pts[0][0], p.pts[0][1]) <= BODY) return true;
        break;
      case 'fill':
        if (p.solid && inPoly(p.pts)) return true;
        break;
      case 'circle':
        if (Math.abs(Math.hypot(x - p.c[0], y - p.c[1]) - p.r) <= BODY) return true;
        break;
      case 'arc': {
        if (Math.abs(Math.hypot(x - p.c[0], y - p.c[1]) - p.r) > BODY) break;
        const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const t = Math.atan2(y - p.c[1], x - p.c[0]);
        const span = p.ccw ? norm(p.a0 - p.a1) : norm(p.a1 - p.a0);
        const at = p.ccw ? norm(p.a0 - t) : norm(t - p.a0);
        if (at <= span + 0.05) return true;
        break;
      }
      case 'words': {
        if (!p.solid) break;
        const px = p.px ?? 10;
        const w = p.text.length * px * 0.6 + 8;
        const x0 = p.centre ? p.x - w / 2 : p.x;
        if (x >= x0 && x <= x0 + w && Math.abs(y - p.y) <= px) return true;
        break;
      }
      case 'glyph':
        if (Math.abs(x - p.x) <= p.px * 0.6 && Math.abs(y - p.y) <= p.px * 0.6) return true;
        break;
      case 'flag':
        if (x >= p.x - 4 && x <= p.x + 16 && y <= p.y + 3 && y >= p.y - 27) return true;
        break;
      case 'candle':
        if (Math.abs(x - p.x) <= Math.max(p.bw / 2, 3) && y >= p.h - 2 && y <= p.l + 2) return true;
        break;
      default:
        break;
    }
  }
  return false;
}
