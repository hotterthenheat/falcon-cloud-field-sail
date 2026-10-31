/* GLYPHS — the book now, as one column of marks beside the newest bar. Each kept level is one diamond: its area the
   strike's size (a named level too small to show keeps the smallest), filled where dealers' hedging damps a move (positive), drawn in outline where it extends one
   (negative). Warm and cool for the sign, the walls in glacier and ember, the flip a bow-tie where the sign turns. Only
   the walls and the flip draw a line, thin, across the whole chart; nothing else crosses the candles. */

import {
  ConceptLook,
  hostLabels,
  isWall,
  LABEL_GAP,
  labelWidth,
  lastBarX,
  levelInk,
  levelLabel,
  neighbourRoom,
  publishChips,
  readFrame,
  rgba,
  stackLabels,
  type DrawTarget,
  type NodeLabel,
} from './nodeConceptKit';

/** The largest glyph's half-diagonal, and the smallest's, CSS px */
const R_MAX = 9;
const R_MIN = 3;

export class GlyphsLook extends ConceptLook {
  protected drawBody(target: DrawTarget): void {
    this.reset();
    const src = this.src;
    const f = readFrame(src);
    if (!f || !src.chart) return;
    const { W, H, ink, kept } = f;
    const barSpacing = src.chart.timeScale().options().barSpacing ?? 6;
    const ys = kept.map(l => f.yOf(l.price));
    const room = neighbourRoom(ys);
    /* the size of each glyph: area by size, so the half-diagonal by its square root; never into a neighbour's */
    const rad = kept.map((l, i) => {
      const cap = Math.max(2, Math.min(R_MAX, room[i] * 0.92));
      if (l.value !== l.value) return Math.min(4.5, cap);
      return Math.min(cap, Math.max(R_MIN, R_MAX * Math.sqrt(l.share)));
    });
    const labels: NodeLabel[] = [];
    for (let i = 0; i < kept.length; i++) {
      const y = ys[i];
      if (y != null && y >= 0 && y <= H) labels.push(levelLabel(kept[i], y, ink));
    }
    if (src.tagsOn) for (const h of hostLabels(src, f)) labels.push(h);
    const widest = labels.reduce((m, l) => Math.max(m, (l.w = labelWidth(l))), 0);

    /* the column: just right of the newest bar, in the space the chart leaves after it; where that space is too narrow
       for the names, the names go left of the column instead */
    const lx = lastBarX(src);
    const gx = Math.max(R_MAX + 2, Math.min(W - R_MAX - 3, (lx ?? W) + barSpacing / 2 + 7 + R_MAX));
    const namesRight = gx + R_MAX + LABEL_GAP + widest <= W - 2;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      /* the walls and the flip: one thin line each, the width of the chart */
      for (let i = 0; i < kept.length; i++) {
        const l = kept[i];
        const y = ys[i];
        if (y == null || y < 0 || y > H) continue;
        const wall = isWall(l);
        if (!wall && !l.roles.includes('flip')) continue;
        const c0 = levelInk(l, ink);
        const lw = Math.max(1, Math.round(vr));
        ctx.fillStyle = rgba(c0, wall ? (ink.light ? 0.62 : 0.5) : ink.light ? 0.5 : 0.4);
        ctx.fillRect(0, Math.round(y * vr - lw / 2), Math.round(W * hr), lw);
      }
      /* the spine the glyphs hang on, from the highest to the lowest */
      const inView = ys.filter((y): y is number => y != null && y >= 0 && y <= H);
      if (inView.length >= 2) {
        ctx.fillStyle = rgba(ink.text, ink.light ? 0.14 : 0.1);
        const t = Math.min(...inView);
        const b = Math.max(...inView);
        ctx.fillRect(Math.round(gx * hr), Math.round(t * vr), Math.max(1, Math.round(hr)), Math.round((b - t) * vr));
      }
      for (let i = 0; i < kept.length; i++) {
        const l = kept[i];
        const y = ys[i];
        if (y == null || y < -R_MAX || y > H + R_MAX) continue;
        const c0 = levelInk(l, ink);
        const r = rad[i];
        const cx = gx * hr;
        const cy = y * vr;
        const rx = r * hr;
        const ry = r * vr;
        ctx.beginPath();
        if (l.value !== l.value) {
          /* the flip: a bow-tie, two points meeting where the sign turns */
          ctx.moveTo(cx - rx, cy - ry * 0.8);
          ctx.lineTo(cx + rx, cy + ry * 0.8);
          ctx.lineTo(cx + rx, cy - ry * 0.8);
          ctx.lineTo(cx - rx, cy + ry * 0.8);
          ctx.closePath();
          ctx.fillStyle = rgba(c0, 0.9);
          ctx.fill();
          continue;
        }
        ctx.moveTo(cx, cy - ry);
        ctx.lineTo(cx + rx, cy);
        ctx.lineTo(cx, cy + ry);
        ctx.lineTo(cx - rx, cy);
        ctx.closePath();
        /* the ground under the glyph, so a candle behind it does not read through */
        ctx.fillStyle = rgba(ink.ground, 0.9);
        ctx.fill();
        if (l.value > 0) {
          ctx.fillStyle = rgba(c0, 0.95);
          ctx.fill();
        } else {
          ctx.fillStyle = rgba(c0, ink.light ? 0.1 : 0.14);
          ctx.fill();
          ctx.strokeStyle = rgba(c0, 1);
          ctx.lineWidth = Math.max(1.25, 1.5 * hr);
          ctx.lineJoin = 'miter';
          ctx.stroke();
        }
        /* the pin wears a ring of its own ink */
        if (l.roles.includes('pin') && !isWall(l)) {
          ctx.beginPath();
          ctx.moveTo(cx, cy - ry - 2.5 * vr);
          ctx.lineTo(cx + rx + 2.5 * hr, cy);
          ctx.lineTo(cx, cy + ry + 2.5 * vr);
          ctx.lineTo(cx - rx - 2.5 * hr, cy);
          ctx.closePath();
          ctx.strokeStyle = rgba(ink.pin, 0.8);
          ctx.lineWidth = Math.max(1, hr);
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    if (!labels.length) return;
    const [ceil, floor] = this.bounds(f);
    const placed = stackLabels(labels, ceil, floor);
    for (const l of placed) {
      if (namesRight) {
        l.x = gx + R_MAX + LABEL_GAP + 1;
        l.leadTo = 'left';
        l.leadX = gx + R_MAX * 0.6;
      } else {
        l.x = gx - R_MAX - LABEL_GAP - 1 - l.w;
        l.leadTo = 'right';
        l.leadX = gx - R_MAX * 0.6;
      }
    }
    this.labels = placed;
    /* the ladder's rungs keep to the right edge: the names here sit beside the glyphs, not at the edge */
    publishChips(src, placed, W - 1);
  }
}
