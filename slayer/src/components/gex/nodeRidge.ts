/* RIDGE — nothing crosses the chart body. The book stands at the right edge as one smooth silhouette: each strike's size
   now, drawn out from the edge (by its square root, so the second rank still has a shape beside a giant), its stretch
   warm where dealers' hedging damps a move and cool where it extends one. Only the kept levels reach into the chart,
   each with a short tick — about a seventh of the plot — and its name at the tick's end. */

import {
  ConceptLook,
  hostLabels,
  isWall,
  LABEL_GAP,
  labelWidth,
  levelInk,
  levelLabel,
  publishChips,
  readFrame,
  rgba,
  stackLabels,
  type DrawTarget,
  type NodeLabel,
  type Rgb,
} from './nodeConceptKit';

/** The silhouette's widest reach, as a share of the plot (clamped in px) */
const RIDGE_SHARE = 0.085;
const RIDGE_MIN = 28;
const RIDGE_MAX = 96;
/** How far a kept level's tick reaches into the plot, as a share of it */
const TICK_SHARE = 0.135;

export class RidgeLook extends ConceptLook {
  protected drawBody(target: DrawTarget): void {
    this.reset();
    const src = this.src;
    const f = readFrame(src);
    if (!f || !src.chart || !src.series) return;
    const strikes = src.strikes;
    const R = strikes.length;
    const vals = src.values;
    const { W, H, ink, kept, cN } = f;
    const ridgeW = Math.max(RIDGE_MIN, Math.min(RIDGE_MAX, W * RIDGE_SHARE));
    /* the rows the silhouette spans: those in view and one past each end, so it runs off the pane instead of stopping */
    const a = Math.max(0, f.rLo - 1);
    const b = Math.min(R, f.rHi + 1);
    const ys: number[] = [];
    const ws: number[] = [];
    const sg: number[] = [];
    for (let r = a; r < b; r++) {
      const y = f.yOf(strikes[r]);
      if (y == null) continue;
      const v = vals[cN * R + r];
      ys.push(y);
      ws.push(v === v && f.top > 0 ? Math.sqrt(Math.min(1.2, Math.abs(v) / f.top)) * ridgeW : 0);
      sg.push(v === v && v !== 0 ? Math.sign(v) : 0);
    }
    /* a strike with nothing keeps its neighbour's side, so the colour does not flicker through the quiet strikes */
    for (let j = 1; j < sg.length; j++) if (sg[j] === 0) sg[j] = sg[j - 1];
    for (let j = sg.length - 2; j >= 0; j--) if (sg[j] === 0) sg[j] = sg[j + 1];
    /* the tick's reach: a seventh of the plot, and always well past the silhouette */
    const reach = Math.max(W * TICK_SHARE, ridgeW + 18);
    const labels: NodeLabel[] = [];

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const right = W * hr;
      ctx.save();
      if (ys.length >= 2) {
        /* the silhouette: smooth curves through the midpoints, so the profile reads as a ridge, not a stack of bars */
        const px = (j: number) => right - ws[j] * hr;
        const py = (j: number) => ys[j] * vr;
        const n = ys.length - 1;
        const line = new Path2D();
        const fill = new Path2D();
        line.moveTo(px(0), py(0));
        fill.moveTo(right, py(0));
        fill.lineTo(px(0), py(0));
        for (let j = 1; j <= n; j++) {
          const mx = (px(j - 1) + px(j)) / 2;
          const my = (py(j - 1) + py(j)) / 2;
          line.quadraticCurveTo(px(j - 1), py(j - 1), mx, my);
          fill.quadraticCurveTo(px(j - 1), py(j - 1), mx, my);
        }
        line.lineTo(px(n), py(n));
        fill.lineTo(px(n), py(n));
        fill.lineTo(right, py(n));
        fill.closePath();
        /* its ink runs down the strikes: each stretch its side's, turning half way between two strikes */
        const y0 = py(0);
        const span = py(n) - y0 || 1;
        const paint = (alpha: number) => {
          const g = ctx.createLinearGradient(0, y0, 0, py(n));
          const inkOf = (s: number): Rgb => (s < 0 ? ink.cool : ink.warm);
          g.addColorStop(0, rgba(inkOf(sg[0]), alpha));
          for (let j = 1; j <= n; j++) {
            if (sg[j] === sg[j - 1]) continue;
            const t = Math.max(0, Math.min(1, ((py(j - 1) + py(j)) / 2 - y0) / span));
            g.addColorStop(t, rgba(inkOf(sg[j - 1]), alpha));
            g.addColorStop(t, rgba(inkOf(sg[j]), alpha));
          }
          g.addColorStop(1, rgba(inkOf(sg[n]), alpha));
          return g;
        };
        ctx.fillStyle = paint(ink.light ? 0.3 : 0.26);
        ctx.fill(fill);
        /* the outline, kept off the spine (a quiet stretch's line would run down the edge) */
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, right - 1.5 * hr, H * vr);
        ctx.clip();
        ctx.strokeStyle = paint(ink.light ? 0.95 : 0.9);
        ctx.lineWidth = Math.max(1, 1.25 * hr);
        ctx.lineJoin = 'round';
        ctx.stroke(line);
        ctx.restore();
        /* the spine: where the widths are measured from */
        ctx.fillStyle = rgba(ink.text, ink.light ? 0.18 : 0.14);
        ctx.fillRect(Math.round(right - Math.max(1, hr)), 0, Math.max(1, Math.round(hr)), Math.round(H * vr));
      }

      /* the kept levels: a short tick out of the ridge into the plot, a notch at its end */
      const x0 = (W - reach) * hr;
      for (const l of kept) {
        const y = f.yOf(l.price);
        if (y == null || y < 0 || y > H) continue;
        const c0 = levelInk(l, ink);
        const wall = isWall(l);
        const lw = Math.max(1, Math.round((wall ? 1.5 : 1) * vr));
        const yb = Math.round(y * vr);
        const g = ctx.createLinearGradient(x0, 0, right, 0);
        g.addColorStop(0, rgba(c0, 0.95));
        g.addColorStop(1, rgba(c0, 0.3));
        ctx.fillStyle = g;
        ctx.fillRect(Math.round(x0), yb - (lw >> 1), Math.round(right - x0), lw);
        const nh = Math.round((wall ? 4 : 3) * vr);
        ctx.fillStyle = rgba(c0, 1);
        ctx.fillRect(Math.round(x0), yb - nh, Math.max(1, Math.round(1.5 * hr)), nh * 2 + lw - 1);
        labels.push(levelLabel(l, y, ink));
      }
      ctx.restore();
    });

    if (!src.tagsOn) return;
    for (const h of hostLabels(src, f)) labels.push(h);
    /* the names: a column whose right edge is the ticks' end, each on its tick, pushed apart with a lead back to it */
    const [ceil, floor] = this.bounds(f);
    const placed = stackLabels(labels, ceil, floor);
    for (const l of placed) {
      l.w = labelWidth(l);
      l.x = Math.max(2, W - reach - LABEL_GAP - l.w);
      l.leadTo = 'right';
      l.leadX = W - reach;
    }
    this.labels = placed;
    publishChips(src, placed);
  }
}
