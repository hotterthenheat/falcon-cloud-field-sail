/* PHASE TWO OF TRADINGVIEW PARITY (2026-11-01): the rest of TradingView's drawing toolbar — the inside pitchfork and the
   pitchfan, the trend-based fib time, the speed resistance arcs, the Gann square, the Cypher and the other Elliott
   patterns, the cycles (cyclic lines, time cycles, the sine line), the bars pattern and the ghost feed, the sector, the
   fixed-range and anchored volume profiles, the double curve and the arrow marker, the price note, the pin, the table,
   the comment and the screen-fixed text. And each tool's options drawn over it (a line's extensions and stats, a range's
   volume, a path's second head).

   Built the phase-one way (drawingKindsMore.ts): each kind is a list of pieces in whatever space it is asked for; the
   renderer strokes them in bitmap pixels and the hit test measures the pointer against the very same pieces in CSS
   pixels. The arithmetic is drawingGeometry.ts, held to the book by scripts/drawing-geometry-proof.ts. Every number a
   volume tool prints is the chart's own bars' volume — nothing is invented; with no bars in range it says so. */

import { fmtElapsed, measureSpan } from '../../data/measure';
import type { Drawing, DrawingKind, DrawingPoint } from './drawingsPrimitive';
import type { KindBar, KindHit, KindRender } from './drawingKinds';
import { drawPieces, hitPieces, hitSpace, rayTo, renderSpace, type Piece, type Space } from './drawingKindsMore';
import {
  avgRange,
  barsPatternCopy,
  cypherRatios,
  doubleCurve,
  fmtRatio,
  fmtVolume,
  ghostCandles,
  insideForkLines,
  intersect,
  pitchfanTargets,
  screenAngle,
  sineAt,
  tbFibTimeBars,
  volumeProfile,
  type Pt,
} from './drawingGeometry';
import { levelsOf, opt } from './drawingLevels';

const UP = '48,209,88';
const DOWN = '255,59,48';
const POC = '255,149,0';
const DARK = '10,10,10';

/** How many presses each phase-two pattern takes before it seals itself */
export const PATTERN_POINTS_TV: Partial<Record<DrawingKind, number>> = {
  cypher: 5,
  elliotttri: 6,
  elliottwxy: 4,
  elliottwxyxz: 6,
};
const NAMES: Partial<Record<DrawingKind, string[]>> = {
  cypher: ['X', 'A', 'B', 'C', 'D'],
  elliotttri: ['0', 'A', 'B', 'C', 'D', 'E'],
  elliottwxy: ['0', 'W', 'X', 'Y'],
  elliottwxyxz: ['0', 'W', 'X', 'Y', 'X', 'Z'],
};

const TV_KINDS = new Set<DrawingKind>([
  'insidefork', 'pitchfan', 'tbfibtime', 'fibarcs', 'gannsq',
  'cypher', 'elliotttri', 'elliottwxy', 'elliottwxyxz', 'cyclic', 'timecycles', 'sine',
  'barspattern', 'ghostfeed', 'sector', 'frvp', 'avp',
  'doublecurve', 'arrowmarker', 'pricenote', 'pin', 'table', 'comment', 'anchoredtext',
]);
export const isTvKind = (k: DrawingKind): boolean => TV_KINDS.has(k);

const priceWords = (p: number): string => p.toFixed(2);
const signed = (d: number): string => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
const pctWords = (d: number, base: number): string => (base ? `${d >= 0 ? '+' : '−'}${Math.abs((d / base) * 100).toFixed(2)}%` : '—');

/** The pixel width of one bar on the chart now: two neighbouring bars' x, else 6 */
function barSpacing(S: Space): number {
  const n = S.bars.length;
  if (n >= 2) {
    const x1 = S.X(S.bars[n - 1].time);
    const x0 = S.X(S.bars[n - 2].time);
    if (x1 !== null && x0 !== null && x1 !== x0) return Math.abs(x1 - x0);
  }
  return 6 * S.s;
}

/** The bars whose time is within [t0, t1] */
function barsBetween(bars: KindBar[], t0: number, t1: number): KindBar[] {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  return bars.filter(b => b.time >= lo && b.time <= hi);
}

/** Sampled half-ellipse from x0 to x1 on base y, rising `h` (negative h hangs below) */
const halfArc = (x0: number, x1: number, y: number, h: number, n = 24): Pt[] => {
  const out: Pt[] = [];
  const cx = (x0 + x1) / 2;
  const rx = (x1 - x0) / 2;
  for (let k = 0; k <= n; k++) {
    const t = Math.PI - (Math.PI * k) / n;
    out.push([cx + rx * Math.cos(t), y - h * Math.sin(t)]);
  }
  return out;
};

/** A table's words: rows split on a semicolon or a new line, cells on a bar */
export const tableCells = (text: string): string[][] =>
  text
    .split(/;|\n/)
    .map(r => r.split('|').map(c => c.trim()))
    .filter(r => r.some(c => c.length));

/** The screen-fixed text's place as a fraction of the pane, read off a stored point on the chart as it is now */
export function anchoredFrac(
  prim: { timeToX(t: number): number | null; series: { priceToCoordinate(p: number): number | null } | null; paneWidth(): number; paneHeight(): number },
  p: DrawingPoint
): [number, number] | null {
  const x = prim.timeToX(p.time);
  const y = prim.series?.priceToCoordinate(p.price) ?? null;
  const w = prim.paneWidth();
  const h = prim.paneHeight();
  if (x === null || y === null || !w || !h) return null;
  return [x / w, y / h];
}

/** A volume profile's pieces over the bars `vb`, from x0 to x1 on screen, histogram on the left */
function profilePieces(d: Drawing, S: Space, vb: KindBar[], x0: number, x1: number, out: Piece[]): void {
  const s = S.s;
  const v = S.v;
  const rows = Number(opt<number>(d, 'rows', 24)) || 24;
  const va = Number(opt<number>(d, 'va', 70)) || 70;
  const updown = opt<boolean>(d, 'updown', true);
  const vp = volumeProfile(vb, rows, va);
  const xa = Math.min(x0, x1);
  const xb = Math.max(xa + 40 * s, Math.max(x0, x1));
  if (!vp || vp.total <= 0) {
    const y = S.Y(vb.length ? vb[vb.length - 1].close : 0) ?? S.h / 2;
    out.push({ t: 'seg', a: [xa, y - 30 * v], b: [xa, y + 30 * v], dim: true, dash: true }, { t: 'seg', a: [xb, y - 30 * v], b: [xb, y + 30 * v], dim: true, dash: true });
    out.push({ t: 'words', text: vb.length ? 'no volume in this range' : 'no bars in this range yet', x: xa + 4 * s, y, dim: true, solid: true });
    return;
  }
  const tot = vp.up.map((u, r) => u + vp.down[r]);
  const max = Math.max(...tot);
  /* TradingView's default: the histogram is 30% of the range wide, on its left */
  const W = Math.max(30 * s, (xb - xa) * 0.3);
  const yHi = S.Y(vp.hi);
  const yLo = S.Y(vp.lo);
  if (yHi === null || yLo === null) return;
  out.push({ t: 'seg', a: [xa, yHi], b: [xa, yLo], dim: true, dash: true, thin: true }, { t: 'seg', a: [xb, yHi], b: [xb, yLo], dim: true, dash: true, thin: true });
  for (let r = 0; r < tot.length; r++) {
    const ya = S.Y(vp.lo + r * vp.step);
    const yb = S.Y(vp.lo + (r + 1) * vp.step);
    if (ya === null || yb === null || tot[r] <= 0) continue;
    const inVa = vp.lo + (r + 0.5) * vp.step >= vp.val && vp.lo + (r + 0.5) * vp.step <= vp.vah;
    const gap = Math.min(1 * v, Math.abs(ya - yb) * 0.15);
    const top = Math.min(ya, yb) + gap;
    const bot = Math.max(ya, yb) - gap;
    const len = (tot[r] / max) * W;
    const k = inVa ? 1 : 0.45;
    if (updown) {
      const lu = (vp.up[r] / max) * W;
      out.push({ t: 'fill', pts: [[xa, top], [xa + lu, top], [xa + lu, bot], [xa, bot]], rgb: UP, a: 0.42 * k, solid: true });
      out.push({ t: 'fill', pts: [[xa + lu, top], [xa + len, top], [xa + len, bot], [xa + lu, bot]], rgb: DOWN, a: 0.42 * k, solid: true });
    } else out.push({ t: 'fill', pts: [[xa, top], [xa + len, top], [xa + len, bot], [xa, bot]], a: 0.4 * k, solid: true });
  }
  if (opt<boolean>(d, 'lines', true)) {
    const pocP = vp.lo + (vp.poc + 0.5) * vp.step;
    const yp = S.Y(pocP);
    const yh = S.Y(vp.vah);
    const yl = S.Y(vp.val);
    if (yp !== null) {
      out.push({ t: 'seg', a: [xa, yp], b: [xb, yp] });
      out.push({ t: 'words', text: `POC ${priceWords(pocP)}`, x: xb + 4 * s, y: yp, rgb: POC, px: 9, solid: true });
    }
    if (yh !== null) {
      out.push({ t: 'seg', a: [xa, yh], b: [xb, yh], dim: true, dash: true });
      out.push({ t: 'words', text: `VAH ${priceWords(vp.vah)}`, x: xb + 4 * s, y: yh, px: 9, dim: true });
    }
    if (yl !== null) {
      out.push({ t: 'seg', a: [xa, yl], b: [xb, yl], dim: true, dash: true });
      out.push({ t: 'words', text: `VAL ${priceWords(vp.val)}`, x: xb + 4 * s, y: yl, px: 9, dim: true });
    }
  }
  out.push({ t: 'words', text: `Vol ${fmtVolume(vp.total)} · ${vb.length} bar${vb.length === 1 ? '' : 's'} · ${tot.length} rows`, x: xa, y: yHi - 12 * v, px: 9, dim: true });
}

/** The pieces `d` is made of, in space `S`; null when it cannot be placed */
function piecesTv(d: Drawing, S: Space, draft: boolean): Piece[] | null {
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
  const far = (from: Pt, dir: Pt): Pt => (dir[0] === 0 && dir[1] === 0 ? from : rayTo(from, [from[0] + dir[0], from[1] + dir[1]], S.w));

  switch (d.kind) {
    // ── pitchforks and fans ─────────────────────────────────────────────────
    case 'insidefork': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) {
        out.push({ t: 'seg', a, b, dim: true });
        return out;
      }
      const ls = insideForkLines(a, b, c, levelsOf(d));
      const lo = ls[0];
      const hi = ls[ls.length - 1];
      if (ls.length > 1) out.push({ t: 'fill', pts: [lo.from, far(lo.from, lo.dir), far(hi.from, hi.dir), hi.from], a: 0.045 });
      for (const l of ls) {
        const outer = Math.abs(l.level) >= 1;
        out.push({ t: 'seg', a: l.from, b: far(l.from, l.dir), dim: l.level !== 0 && outer, dash: outer });
      }
      out.push({ t: 'seg', a, b, dim: true, dash: true });
      out.push({ t: 'dot', p: ls[Math.floor(ls.length / 2)].from }, { t: 'dot', p: c });
      return out;
    }
    case 'pitchfan': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) {
        out.push({ t: 'seg', a, b, dim: true });
        return out;
      }
      const ts = pitchfanTargets(b, c, levelsOf(d));
      if (ts.length > 1) out.push({ t: 'fill', pts: [a, rayTo(a, ts[0].to, S.w), rayTo(a, ts[ts.length - 1].to, S.w)], a: 0.04 });
      out.push({ t: 'seg', a: b, b: c, dim: true });
      for (const q of ts) {
        out.push({ t: 'seg', a, b: rayTo(a, q.to, S.w), dim: q.level !== 0 });
        out.push({ t: 'words', text: String(Math.abs(q.level)), x: q.to[0] + 4 * s, y: q.to[1], px: 9, dim: true });
      }
      out.push({ t: 'dot', p: c });
      return out;
    }

    // ── fib ─────────────────────────────────────────────────────────────────
    case 'tbfibtime': {
      if (!a || !b) return null;
      out.push({ t: 'seg', a, b, dim: true, dash: true }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) return out;
      out.push({ t: 'seg', a: b, b: c, dim: true, dash: true }, { t: 'dot', p: c });
      const span = Math.abs(b[0] - a[0]);
      if (span < 2 * s) return out;
      /* bars sit evenly on the time scale, so a span in pixels is a span in bars */
      for (const r of levelsOf(d)) {
        const x = tbFibTimeBars(a[0], b[0], c[0], [r])[0];
        if (x < -2 || x > S.w + 2) continue;
        const major = r === 0 || r === 1 || r === 1.618 || r === 2.618;
        out.push({ t: 'seg', a: [x, 0], b: [x, S.h], dim: !major, thin: true });
        out.push({ t: 'words', text: String(r), x: x + 3 * s, y: 12 * v, dim: !major, px: 9 });
      }
      return out;
    }
    case 'fibarcs': {
      if (!a || !b) return null;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push({ t: 'seg', a, b, dim: true, dash: true }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (L < 2) return out;
      const below = b[1] >= a[1];
      const full = opt<boolean>(d, 'full');
      for (const r of levelsOf(d)) {
        if (full) out.push({ t: 'circle', c: a, r: L * r, dim: r !== 1 });
        else out.push({ t: 'arc', c: a, r: L * r, a0: below ? 0 : Math.PI, a1: below ? Math.PI : 2 * Math.PI, ccw: false, dim: r !== 1 });
        const at: Pt = [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
        out.push({ t: 'words', text: String(r), x: at[0] + 4 * s, y: at[1], dim: true, px: 9 });
      }
      return out;
    }

    // ── Gann square ────────────────────────────────────────────────────────────
    case 'gannsq': {
      if (!a || !b || !d.p2) return null;
      const rev = opt<boolean>(d, 'reverse');
      const o = rev ? b : a;
      const q = rev ? a : b;
      const x0 = Math.min(a[0], b[0]);
      const x1 = Math.max(a[0], b[0]);
      const y0 = Math.min(a[1], b[1]);
      const y1 = Math.max(a[1], b[1]);
      const lv = levelsOf(d);
      out.push({ t: 'fill', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], a: 0.035, solid: true });
      out.push({ t: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
      for (const r of lv) {
        if (r <= 0 || r >= 1) continue;
        const x = o[0] + (q[0] - o[0]) * r;
        const y = o[1] + (q[1] - o[1]) * r;
        out.push({ t: 'seg', a: [x, y0], b: [x, y1], dim: true, thin: true }, { t: 'seg', a: [x0, y], b: [x1, y], dim: true, thin: true });
      }
      /* the fan: from the origin corner to each level on the two far sides, the 1×1 the diagonal */
      for (const r of lv) {
        if (r <= 0) continue;
        out.push({ t: 'seg', a: o, b: [q[0], o[1] + (q[1] - o[1]) * r], dim: r !== 1 });
        if (r !== 1) out.push({ t: 'seg', a: o, b: [o[0] + (q[0] - o[0]) * r, q[1]], dim: true });
      }
      /* the arcs: a quarter of an ellipse a level, in the box's own price-to-bar scale */
      for (const r of lv) {
        if (r <= 0) continue;
        const rx = (q[0] - o[0]) * r;
        const ry = (q[1] - o[1]) * r;
        const pts: Pt[] = [];
        for (let k = 0; k <= 20; k++) {
          const t = (Math.PI / 2) * (k / 20);
          pts.push([o[0] + rx * Math.cos(t), o[1] + ry * Math.sin(t)]);
        }
        out.push({ t: 'poly', pts, dim: true });
      }
      const span = measureSpan(d.p1.time, d.p1.price, d.p2.time, d.p2.price, S.barMinutes);
      const dp = Math.abs(d.p2.price - d.p1.price);
      out.push({ t: 'words', text: `${S.barMinutes > 0 ? `${span.bars} bars` : fmtElapsed(span.tradingMin)} · ${dp.toFixed(2)} pts${span.bars > 0 ? ` · ${(dp / span.bars).toFixed(3)}/bar` : ''}`, x: x0, y: y1 + 12 * v, px: 9, dim: true });
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      return out;
    }

    // ── patterns ──────────────────────────────────────────────────────────────
    case 'cypher':
    case 'elliotttri':
    case 'elliottwxy':
    case 'elliottwxyxz': {
      const ps: Pt[] = [];
      for (const qq of d.pts ?? []) {
        const p = P(qq);
        if (!p) return null;
        ps.push(p);
      }
      if (ps.length < 2) return null;
      const n = PATTERN_POINTS_TV[d.kind] ?? ps.length;
      const whole = ps.length >= n && !draft;
      const pr = (d.pts ?? []).map(qq => qq.price);
      if (d.kind === 'cypher' && ps.length >= 3) {
        out.push({ t: 'fill', pts: [ps[0], ps[1], ps[2]], a: 0.08 });
        if (ps.length >= 5) out.push({ t: 'fill', pts: [ps[2], ps[3], ps[4]], a: 0.08 });
      }
      if (d.kind === 'elliotttri' && ps.length >= 5) {
        /* the triangle's two sides: through A and C, through B and D, carried to E */
        const reach = ps[ps.length - 1][0];
        const along = (p: Pt, q: Pt): Pt => (q[0] === p[0] ? q : [reach, p[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (reach - p[0])]);
        out.push({ t: 'seg', a: ps[1], b: along(ps[1], ps[3]), dim: true, dash: true }, { t: 'seg', a: ps[2], b: along(ps[2], ps[4]), dim: true, dash: true });
        const apex = intersect(ps[1], ps[3], ps[2], ps[4]);
        if (apex && whole && apex[0] > reach && apex[0] < S.w * 2) out.push({ t: 'words', text: 'apex', x: apex[0] + 4 * s, y: apex[1], px: 9, dim: true });
      }
      out.push({ t: 'poly', pts: ps });
      for (const p of ps) out.push({ t: 'dot', p });
      if (whole && d.kind === 'cypher') {
        const r = cypherRatios(pr[0], pr[1], pr[2], pr[3], pr[4]);
        const ratio = (i: number, j: number, val: number | null) => {
          out.push({ t: 'seg', a: ps[i], b: ps[j], dim: true, dash: true });
          out.push({ t: 'words', text: fmtRatio(val), x: (ps[i][0] + ps[j][0]) / 2 - 14 * s, y: (ps[i][1] + ps[j][1]) / 2, px: 9, frame: true });
        };
        ratio(0, 2, r.b);
        ratio(0, 3, r.c);
        out.push({ t: 'words', text: fmtRatio(r.d), x: (ps[3][0] + ps[4][0]) / 2 + 6 * s, y: (ps[3][1] + ps[4][1]) / 2, px: 9, frame: true });
      }
      const names = NAMES[d.kind] ?? [];
      const circled = d.kind !== 'cypher';
      ps.forEach((p, i) => {
        const nm = names[i];
        if (!nm) return;
        const nb = [ps[i - 1], ps[i + 1]].filter(Boolean) as Pt[];
        const peak = nb.length ? nb.every(qq => p[1] <= qq[1]) : true;
        out.push({ t: 'words', text: circled ? `(${nm})` : nm, x: p[0], y: p[1] + (peak ? -13 : 13) * v, centre: true, px: 11, frame: !circled });
      });
      return out;
    }

    // ── cycles ────────────────────────────────────────────────────────────────
    case 'cyclic': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      const step = Math.abs(b[0] - a[0]);
      if (step < 2 * s) {
        out.push({ t: 'seg', a: [a[0], 0], b: [a[0], S.h] });
        return out;
      }
      const x0 = Math.min(a[0], b[0]);
      for (let k = 0, x = x0; x <= S.w + 1 && k < 400; k++, x = x0 + k * step) out.push({ t: 'seg', a: [x, 0], b: [x, S.h], dim: k > 1, thin: k > 1 });
      return out;
    }
    case 'timecycles': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      const step = Math.abs(b[0] - a[0]);
      if (step < 2 * s) return out;
      const x0 = Math.min(a[0], b[0]);
      const hgt = Math.max(16 * v, Math.abs(b[1] - a[1])) * (b[1] <= a[1] ? 1 : -1);
      for (let k = 0; k < 200; k++) {
        const xa = x0 + k * step;
        if (xa > S.w + 1) break;
        const arc = halfArc(xa, xa + step, a[1], hgt);
        if (k % 2 === 0) out.push({ t: 'fill', pts: arc, a: 0.05 });
        out.push({ t: 'poly', pts: arc, dim: k > 0 });
      }
      out.push({ t: 'seg', a: [x0, a[1]], b: [S.w, a[1]], dim: true, dash: true, thin: true });
      return out;
    }
    case 'sine': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (Math.abs(b[0] - a[0]) < 2 * s) {
        out.push({ t: 'seg', a, b });
        return out;
      }
      const pts: Pt[] = [];
      for (let x = 0; x <= S.w; x += 3 * s) pts.push([x, sineAt(x, a, b)]);
      out.push({ t: 'poly', pts });
      return out;
    }

    // ── forecasting ────────────────────────────────────────────────────────────
    case 'barspattern': {
      if (!a || !b || !d.p2) return null;
      const src = barsBetween(S.bars, d.p1.time, d.p2.time);
      const xa = Math.min(a[0], b[0]);
      const xb = Math.max(a[0], b[0]);
      out.push({ t: 'seg', a: [xa, a[1] - 40 * v], b: [xa, a[1] + 40 * v], dim: true, dash: true }, { t: 'seg', a: [xb, b[1] - 40 * v], b: [xb, b[1] + 40 * v], dim: true, dash: true });
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!src.length) {
        if (!draft) out.push({ t: 'words', text: 'no bars between the anchors', x: xb + 6 * s, y: b[1], dim: true, solid: true });
        return out;
      }
      if (!c || !d.p3) {
        out.push({ t: 'words', text: `${src.length} bar${src.length === 1 ? '' : 's'} picked — place the copy`, x: xb + 6 * s, y: b[1], dim: true });
        return out;
      }
      const sp = barSpacing(S);
      const copy = barsPatternCopy(src, 0, d.p3.price, opt<boolean>(d, 'mirrored'), opt<boolean>(d, 'flipped'));
      const mode = String(opt<string>(d, 'mode', 'hl'));
      const xOf = (k: number) => c[0] + k * sp;
      if (mode === 'hl' || mode === 'oc') {
        for (const k of copy) {
          const o = S.Y(k.o);
          const h = S.Y(k.h);
          const l = S.Y(k.l);
          const cc = S.Y(k.c);
          if (o === null || h === null || l === null || cc === null) continue;
          out.push({ t: 'candle', x: xOf(k.i), o, h, l, c: cc, bw: Math.max(1, sp * 0.6), stick: mode as 'hl' | 'oc' });
        }
      } else {
        const pick = (k: { o: number; h: number; l: number; c: number }) => (mode === 'open' ? k.o : mode === 'high' ? k.h : mode === 'low' ? k.l : mode === 'hl2' ? (k.h + k.l) / 2 : k.c);
        const pts: Pt[] = [];
        for (const k of copy) {
          const y = S.Y(pick(k));
          if (y !== null) pts.push([xOf(k.i), y]);
        }
        if (pts.length >= 2) out.push({ t: 'poly', pts });
      }
      out.push({ t: 'dot', p: c });
      return out;
    }
    case 'ghostfeed': {
      const ps: Pt[] = [];
      for (const qq of d.pts ?? []) {
        const p = P(qq);
        if (p) ps.push(p);
      }
      if (ps.length < 2) return null;
      const sp = barSpacing(S);
      const own = Number(opt<number>(d, 'avgHL', 0)) || 0;
      const avg = own > 0 ? own : avgRange(S.bars);
      const x0 = ps[0][0];
      const path: Pt[] = (d.pts ?? []).map((qq, i) => [(ps[i][0] - x0) / sp, qq.price]);
      out.push({ t: 'poly', pts: ps, dim: true, dash: true });
      for (const k of ghostCandles(path, avg)) {
        const o = S.Y(k.o);
        const h = S.Y(k.h);
        const l = S.Y(k.l);
        const cc = S.Y(k.c);
        if (o === null || h === null || l === null || cc === null) continue;
        out.push({ t: 'candle', x: x0 + k.i * sp, o, h, l, c: cc, bw: Math.max(1, sp * 0.62), dim: true });
      }
      return out;
    }
    case 'sector': {
      if (!a || !b || !d.p2) return null;
      out.push({ t: 'seg', a, b }, { t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c || !d.p3) return out;
      const R0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tb = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const tc = Math.atan2(c[1] - a[1], c[0] - a[0]);
      let sw = tc - tb;
      while (sw > Math.PI) sw -= 2 * Math.PI;
      while (sw < -Math.PI) sw += 2 * Math.PI;
      const tip: Pt = [a[0] + R0 * Math.cos(tc), a[1] + R0 * Math.sin(tc)];
      const wedge: Pt[] = [a];
      for (let k = 0; k <= 24; k++) wedge.push([a[0] + R0 * Math.cos(tb + (sw * k) / 24), a[1] + R0 * Math.sin(tb + (sw * k) / 24)]);
      out.push({ t: 'fill', pts: wedge, a: 0.07 });
      out.push({ t: 'seg', a, b: tip }, { t: 'arc', c: a, r: R0, a0: tb, a1: tb + sw, ccw: sw < 0, dim: true }, { t: 'seg', a: tip, b: c, dim: true, thin: true }, { t: 'dot', p: c });
      const delta = d.p3.price - d.p1.price;
      const span = measureSpan(d.p1.time, d.p1.price, d.p2.time, d.p2.price, S.barMinutes);
      const when = S.barMinutes > 0 ? `${span.bars} bar${span.bars === 1 ? '' : 's'}` : fmtElapsed(span.tradingMin);
      out.push({ t: 'words', text: `${priceWords(d.p3.price)}  ${signed(delta)}  ${pctWords(delta, d.p1.price)}  in ${when}`, x: Math.max(b[0], c[0]) + 8 * s, y: c[1], rgb: delta >= 0 ? UP : DOWN, solid: true, frame: true });
      return out;
    }
    case 'frvp': {
      if (!a || !b || !d.p2) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (draft && Math.abs(b[0] - a[0]) < 2 * s) return out;
      profilePieces(d, S, barsBetween(S.bars, d.p1.time, d.p2.time), a[0], b[0], out);
      return out;
    }
    case 'avp': {
      if (!a) return null;
      out.push({ t: 'dot', p: a });
      const vb = S.bars.filter(bb => bb.time >= d.p1.time);
      const last = vb.length ? S.X(vb[vb.length - 1].time) : null;
      profilePieces(d, S, vb, a[0], last ?? a[0] + 60 * s, out);
      return out;
    }

    // ── shapes ────────────────────────────────────────────────────────────────
    case 'doublecurve': {
      if (!a || !b) return null;
      out.push({ t: 'dot', p: a }, { t: 'dot', p: b });
      if (!c) {
        out.push({ t: 'seg', a, b });
        return out;
      }
      out.push({ t: 'poly', pts: doubleCurve(a, b, c) }, { t: 'dot', p: c });
      return out;
    }
    case 'arrowmarker': {
      if (!a || !b) return null;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 2) return out;
      const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const nrm: Pt = [-u[1], u[0]];
      const hl = Math.min(L * 0.45, 20 * s);
      const hw = 10 * s;
      const sw2 = 4 * s;
      const h0: Pt = [b[0] - u[0] * hl, b[1] - u[1] * hl];
      const at = (p: Pt, k: number): Pt => [p[0] + nrm[0] * k, p[1] + nrm[1] * k];
      const shape: Pt[] = [at(a, sw2 * 0.4), at(h0, sw2), at(h0, hw), b, at(h0, -hw), at(h0, -sw2), at(a, -sw2 * 0.4)];
      out.push({ t: 'fill', pts: shape, a: 0.75, solid: true }, { t: 'poly', pts: shape, closed: true });
      return out;
    }

    // ── annotation ─────────────────────────────────────────────────────────────
    case 'pricenote': {
      if (!a || !b || !d.p2) return null;
      out.push({ t: 'seg', a, b, thin: true }, { t: 'dot', p: a });
      out.push({ t: 'words', text: priceWords(d.p1.price), x: b[0], y: b[1], px: S.typePx(d.width), frame: true, centre: true, solid: true });
      return out;
    }
    case 'pin': {
      if (!a) return null;
      const head: Pt = [a[0], a[1] - 16 * v];
      out.push({ t: 'seg', a, b: head, thin: true });
      const disc: Pt[] = [];
      for (let k = 0; k <= 16; k++) disc.push([head[0] + 6 * s * Math.cos((2 * Math.PI * k) / 16), head[1] + 6 * v * Math.sin((2 * Math.PI * k) / 16)]);
      out.push({ t: 'fill', pts: disc, a: 0.9, solid: true }, { t: 'poly', pts: disc, closed: true }, { t: 'dot', p: a });
      const words = (d.text ?? '').length > 40 ? `${(d.text ?? '').slice(0, 39)}…` : d.text ?? '';
      if (words) out.push({ t: 'words', text: words, x: head[0], y: head[1] - 18 * v, px: S.typePx(d.width), frame: true, centre: true, solid: true });
      return out;
    }
    case 'table': {
      if (!a) return null;
      const cells = tableCells(d.text ?? '');
      if (!cells.length) return out;
      const px = S.typePx(d.width);
      const cw = px * 0.62 * s;
      const cols = Math.max(...cells.map(r => r.length));
      const colW = Array.from({ length: cols }, (_, j) => Math.max(...cells.map(r => (r[j] ?? '').length)) * cw + 14 * s);
      const rowH = px * 1.9 * v;
      const W = colW.reduce((t, x) => t + x, 0);
      const H = rowH * cells.length;
      const x0 = a[0];
      const y0 = a[1];
      out.push({ t: 'fill', pts: [[x0, y0], [x0 + W, y0], [x0 + W, y0 + H], [x0, y0 + H]], rgb: DARK, a: 0.72, solid: true });
      out.push({ t: 'poly', pts: [[x0, y0], [x0 + W, y0], [x0 + W, y0 + H], [x0, y0 + H]], closed: true, dim: true });
      for (let r = 1; r < cells.length; r++) out.push({ t: 'seg', a: [x0, y0 + r * rowH], b: [x0 + W, y0 + r * rowH], dim: true, thin: true });
      let cx = x0;
      for (let j = 0; j < cols; j++) {
        if (j > 0) out.push({ t: 'seg', a: [cx, y0], b: [cx, y0 + H], dim: true, thin: true });
        cells.forEach((row, r) => {
          if (row[j]) out.push({ t: 'words', text: row[j], x: cx + 7 * s, y: y0 + (r + 0.5) * rowH, px, bare: true, bold: r === 0 });
        });
        cx += colW[j];
      }
      return out;
    }
    case 'comment': {
      if (!a) return null;
      const px = S.typePx(d.width);
      const text = d.text ?? '';
      const bw = Math.max(40 * s, text.length * px * 0.62 * s + 16 * s);
      const bh = px * 2.1 * v;
      const x0 = a[0] + 6 * s;
      const yb = a[1] - 10 * v;
      const bubble: Pt[] = [[a[0], a[1]], [x0 + 14 * s, yb], [x0 + bw, yb], [x0 + bw, yb - bh], [x0, yb - bh], [x0, yb]];
      out.push({ t: 'fill', pts: bubble, rgb: DARK, a: 0.75, solid: true }, { t: 'poly', pts: bubble, closed: true });
      out.push({ t: 'words', text, x: x0 + 8 * s, y: yb - bh / 2, px, bare: true });
      return out;
    }
    case 'anchoredtext': {
      const fx = Number(d.opts?.fx);
      const fy = Number(d.opts?.fy);
      const at: Pt | null = Number.isFinite(fx) && Number.isFinite(fy) ? [fx * S.w, fy * S.h] : a;
      if (!at) return null;
      out.push({ t: 'words', text: d.text ?? '', x: at[0], y: at[1], px: S.typePx(d.width), solid: true });
      return out;
    }
    default:
      return null;
  }
}

// ---- drawn and hit ----------------------------------------------------------------------------------------

export function renderTv(d: Drawing, R: KindRender): boolean {
  if (!TV_KINDS.has(d.kind)) return false;
  const ps = piecesTv(d, renderSpace(R), R.draft);
  if (ps) drawPieces(ps, R);
  return true;
}

export function hitTv(d: Drawing, H: KindHit): boolean | null {
  if (!TV_KINDS.has(d.kind)) return null;
  const ps = piecesTv(d, hitSpace(H), false);
  if (!ps) return false;
  /* the solid shapes and the boxes of words count inside; the table, the comment, the pin's head */
  return hitPieces(ps, H);
}

// ---- a tool's options, over the mark ------------------------------------------------------------------------

const LINE_KINDS = new Set<DrawingKind>(['trend', 'arrow', 'ray', 'infoline', 'trendangle']);
const RANGE_KINDS = new Set<DrawingKind>(['measure', 'drange', 'prange']);

function extrasOf(d: Drawing, S: Space): Piece[] | null {
  const P = (p?: DrawingPoint): Pt | null => {
    if (!p) return null;
    const x = S.X(p.time);
    const y = S.Y(p.price);
    return x === null || y === null ? null : [x, y];
  };
  const s = S.s;
  const v = S.v;
  const out: Piece[] = [];
  if (LINE_KINDS.has(d.kind) && d.opts) {
    const a = P(d.p1);
    const b = P(d.p2);
    if (!a || !b || !d.p2) return null;
    if (opt<boolean>(d, 'extL') && (a[0] !== b[0] || a[1] !== b[1])) out.push({ t: 'seg', a, b: rayTo(b, a, S.w) });
    if (opt<boolean>(d, 'extR') && d.kind !== 'ray' && (a[0] !== b[0] || a[1] !== b[1])) out.push({ t: 'seg', a: b, b: rayTo(a, b, S.w) });
    if (opt<boolean>(d, 'mid')) out.push({ t: 'dot', p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    if (opt<boolean>(d, 'plabels')) {
      out.push({ t: 'words', text: priceWords(d.p1.price), x: a[0] - 4 * s, y: a[1] + (a[1] < b[1] ? -12 : 12) * v, px: 9, centre: true, solid: true });
      out.push({ t: 'words', text: priceWords(d.p2.price), x: b[0] + 4 * s, y: b[1] + (b[1] < a[1] ? -12 : 12) * v, px: 9, centre: true, solid: true });
    }
    if (opt<boolean>(d, 'stats')) {
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
    }
    return out;
  }
  if (RANGE_KINDS.has(d.kind) && d.p2 && opt<boolean>(d, 'vol', true)) {
    const a = P(d.p1);
    const b = P(d.p2);
    if (!a || !b) return null;
    const vb = barsBetween(S.bars, d.p1.time, d.p2.time);
    if (!vb.length) return null;
    const vol = vb.reduce((t, x) => t + (x.volume > 0 ? x.volume : 0), 0);
    const y = d.kind === 'measure' ? Math.min(a[1], b[1]) - 12 * v : Math.max(a[1], b[1]) + (d.kind === 'drange' ? 28 : 14) * v;
    out.push({ t: 'words', text: `Vol ${fmtVolume(vol)}`, x: Math.min(a[0], b[0]) + 4 * s, y, px: 10 });
    return out;
  }
  if (d.kind === 'path' && opt<boolean>(d, 'headStart') && d.pts && d.pts.length >= 2) {
    const a = P(d.pts[0]);
    const b = P(d.pts[1]);
    if (!a || !b) return null;
    const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const hd = 9 * v;
    out.push({ t: 'fill', pts: [a, [a[0] - hd * Math.cos(ang - 0.42), a[1] - hd * Math.sin(ang - 0.42)], [a[0] - hd * Math.cos(ang + 0.42), a[1] - hd * Math.sin(ang + 0.42)]], a: 0.95 });
    return out;
  }
  return null;
}

/** Draw a mark's options over it (called after the mark itself) */
export function renderExtras(d: Drawing, R: KindRender): void {
  const ps = extrasOf(d, renderSpace(R));
  if (ps && ps.length) drawPieces(ps, R);
}
/** Is the pointer on a mark's drawn options (an extension, a stats box)? */
export function hitExtras(d: Drawing, H: KindHit): boolean {
  if (!LINE_KINDS.has(d.kind) || !d.opts) return false;
  const ps = extrasOf(d, hitSpace(H));
  return !!ps && hitPieces(ps, H);
}
