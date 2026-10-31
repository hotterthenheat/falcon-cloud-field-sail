/* STRATA — each kept level is a soft band under the candles, as thick as the strike is large. The band runs back through
   the session at the size the strike held then, and fades toward the left: bright where the book stands now, faint
   where it stood hours ago. Warm where dealers' hedging damps a move, cool where it extends one; the walls in their own
   glacier and ember. The names sit in a compact rail at the right edge. No dots, no row at every strike. */

import { MismatchDirection, type Time } from 'lightweight-charts';
import {
  ConceptLook,
  colAtOrAfter,
  hostLabels,
  isWall,
  LABEL_GAP,
  labelWidth,
  levelInk,
  levelLabel,
  neighbourRoom,
  publishChips,
  readFrame,
  rgba,
  rowOf,
  stackLabels,
  type DrawTarget,
  type NodeLabel,
} from './nodeConceptKit';

/** The thickest a band gets, CSS px either side of its strike */
const HALF_MAX = 12;
/** Bars closer than this (CSS px) are read in groups, the group's largest standing for it */
const MIN_PITCH = 2;

export class StrataLook extends ConceptLook {
  protected drawBody(target: DrawTarget): void {
    this.reset();
    const src = this.src;
    const f = readFrame(src);
    if (!f || !src.chart || !src.series || !(f.top > 0 || f.kept.length)) return;
    const ts = src.chart.timeScale();
    const series = src.series;
    const strikes = src.strikes;
    const R = strikes.length;
    const vals = src.values;
    const { W, H, ink, kept } = f;
    const barSpacing = ts.options().barSpacing ?? 6;

    /* the columns in view, through the logical range so a session gap does not shorten it */
    let first = 0;
    let last = src.cols.length;
    const lr = ts.getVisibleLogicalRange();
    if (lr) {
      const at = (i: number, dir: MismatchDirection) => {
        const d = series.dataByIndex(i, dir);
        return d ? Number(d.time) : null;
      };
      const tL = at(Math.floor(lr.from) - 1, MismatchDirection.NearestRight);
      const tR = at(Math.ceil(lr.to) + 1, MismatchDirection.NearestLeft);
      if (tL != null) first = Math.max(0, colAtOrAfter(src, tL) - 1);
      if (tR != null) last = Math.min(src.cols.length, colAtOrAfter(src, tR + 1e-6) + 1);
    }
    const k = Math.max(1, Math.ceil(MIN_PITCH / Math.max(0.1, barSpacing)));
    const xs: number[] = [];
    const cs: number[] = [];
    for (let c = first - (first % k); c < last; c += k) {
      if (c < first) continue;
      const x = ts.timeToCoordinate(src.cols[c].time as Time);
      if (x == null || x < -barSpacing * 2 || x > W + barSpacing * 2) continue;
      xs.push(x);
      cs.push(c);
    }

    const ys = kept.map(l => f.yOf(l.price));
    const room = neighbourRoom(ys);
    const labels: NodeLabel[] = [];

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      for (let i = 0; i < kept.length; i++) {
        const l = kept[i];
        const y = ys[i];
        if (y == null || y < -HALF_MAX || y > H + HALF_MAX) continue;
        const c0 = levelInk(l, ink);
        const yb = y * vr;
        const wall = isWall(l);
        /* the flip, or a named level the book holds nothing at: a hairline, fading left like the bands */
        const r = rowOf(src, l.price);
        const sign = l.value > 0 ? 1 : l.value < 0 ? -1 : 0;
        if (r >= 0 && sign !== 0 && f.top > 0 && xs.length) {
          const halfMax = Math.max(1.5, Math.min(HALF_MAX, room[i] * 0.95));
          const half = new Float64Array(xs.length);
          for (let j = 0; j < xs.length; j++) {
            /* the group's largest reading on the strike's present side */
            let a = 0;
            for (let g = cs[j]; g < Math.min(last, cs[j] + k); g++) {
              const v = vals[g * R + r];
              if (v === v && v * sign > 0) a = Math.max(a, Math.abs(v));
            }
            half[j] = a > 0 ? Math.max(0.6, halfMax * Math.min(1.12, Math.sqrt(a / f.top))) : 0;
          }
          /* a light smoothing, so a flickering print reads as a band and not a comb */
          const sm = new Float64Array(xs.length);
          for (let j = 0; j < xs.length; j++) {
            const a = half[Math.max(0, j - 1)];
            const b = half[j];
            const c = half[Math.min(xs.length - 1, j + 1)];
            sm[j] = b === 0 ? 0 : (a + 2 * b + c) / 4;
          }
          const nowHalf = Math.max(1, halfMax * Math.min(1, Math.sqrt(Math.abs(l.value) / f.top)));
          const xEnd = W * hr;
          const outer = new Path2D();
          const core = new Path2D();
          const edge = (p: Path2D, scale: number) => {
            p.moveTo(xs[0] * hr, yb);
            for (let j = 0; j < xs.length; j++) p.lineTo(xs[j] * hr, yb - sm[j] * scale * vr);
            p.lineTo(xEnd, yb - nowHalf * scale * vr);
            p.lineTo(xEnd, yb + nowHalf * scale * vr);
            for (let j = xs.length - 1; j >= 0; j--) p.lineTo(xs[j] * hr, yb + sm[j] * scale * vr);
            p.closePath();
          };
          edge(outer, 1);
          edge(core, 0.42);
          /* the fade: the past at a whisper, now at full ink */
          const peak = ink.light ? 0.3 : 0.26;
          const g1 = ctx.createLinearGradient(0, 0, xEnd, 0);
          g1.addColorStop(0, rgba(c0, peak * 0.06));
          g1.addColorStop(0.6, rgba(c0, peak * 0.42));
          g1.addColorStop(1, rgba(c0, peak));
          ctx.fillStyle = g1;
          ctx.fill(outer);
          const g2 = ctx.createLinearGradient(0, 0, xEnd, 0);
          const corePeak = ink.light ? 0.6 : 0.55;
          g2.addColorStop(0, rgba(c0, corePeak * 0.05));
          g2.addColorStop(0.6, rgba(c0, corePeak * 0.4));
          g2.addColorStop(1, rgba(c0, corePeak));
          ctx.fillStyle = g2;
          ctx.fill(core);
        }
        /* the strike itself: a hairline over the band's newer half, the walls' and the flip's across the whole */
        const from = wall || l.roles.includes('flip') ? 0 : W * 0.45;
        const gl = ctx.createLinearGradient(from * hr, 0, W * hr, 0);
        const lineA = wall ? 0.75 : l.roles.includes('flip') ? 0.6 : 0.5;
        gl.addColorStop(0, rgba(c0, wall ? lineA * 0.18 : 0));
        gl.addColorStop(1, rgba(c0, lineA));
        ctx.fillStyle = gl;
        const lw = Math.max(1, Math.round((wall ? 1.25 : 1) * vr));
        ctx.fillRect(Math.round(from * hr), Math.round(yb - lw / 2), Math.round((W - from) * hr), lw);

        if (y >= 0 && y <= H) labels.push(levelLabel(l, y, ink));
      }
      ctx.restore();
    });

    /* the rail: the right edge, top to bottom, pushed apart */
    if (!src.tagsOn) return;
    for (const h of hostLabels(src, f)) labels.push(h);
    const [ceil, floor] = this.bounds(f);
    const placed = stackLabels(labels, ceil, floor);
    for (const l of placed) {
      l.w = labelWidth(l);
      l.x = W - l.w;
      l.leadTo = 'left';
      l.leadX = l.x - LABEL_GAP;
    }
    this.labels = placed;
    publishChips(src, placed);
  }
}
