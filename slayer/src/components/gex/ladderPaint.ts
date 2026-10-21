/*
==================================================
  SLAYER TERMINAL - THE LADDER'S PEN
  (components/gex/ladderPaint.ts)

  One way of drawing a level at the tape's right
  edge, shared by the two charts that do it: the
  Compass setup's marks (compass/setupMarksPrimitive)
  and the house chart's key levels (keyLevelsPrimitive).
  Noah, 2026-10-04: "have the green and red thing we
  have on the compass chart be the call and put wall
  for the other charts like terrain". Lifted here so
  the two cannot drift apart later.

  The grammar: a thin RULE in the level's ink, ending
  at the right edge; its FIGURE a small mono number
  right-aligned at the edge, just above (or below)
  the rule. No full-width line, no capsule on the
  axis, no words over the candles — the host draws
  the pointer card, and the hit test is here too so
  both hosts agree on what "on the rule" means.
==================================================
*/

/** The bitmap scope lightweight-charts hands a primitive's renderer */
export interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
}
export interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

export const LADDER_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
/** The ladder's room at the right edge, media px */
export const LADDER_W = 34;
/** How far left of the right edge a pointer still counts as "on the ladder", media px — room for a rung that ends at a
    strike chip (the house chart's exposure field names its heaviest strikes at the edge) */
export const LADDER_HIT_W = 120;
/** A pointer this close to a rule, either side, is on it — media px */
export const RULE_NEAR = 6;

/** Within RULE_NEAR of a rule's y, in media px */
export const nearRule = (ruleY: number | null | undefined, pointerY: number): boolean => ruleY != null && Math.abs(ruleY - pointerY) <= RULE_NEAR;

export interface LadderPen {
  ctx: CanvasRenderingContext2D;
  hr: number;
  vr: number;
  /** The plot's width and height in bitmap px */
  W: number;
  H: number;
  /** The right edge the rules end at, bitmap px */
  right: number;
  /**
   * A rule from x0 to x1 at y (bitmap px). With `trace`, a faint dotted trace runs from the plot's left edge to x0, so a
   * level still reads across the tape when x0 is the newest candle. `dash` draws the solid part dashed (media px, dash then gap).
   */
  rule(x0: number | null, y: number, x1: number, rgb: string, alpha: number, opts?: { trace?: boolean; dash?: number[]; width?: number }): void;
  /** A small mono figure right-aligned at the edge, above the rule by default; returns the box it took (bitmap px) */
  figure(text: string, y: number, rgb: string, above?: boolean, alpha?: number, at?: number): { top: number; bottom: number };
  /** The box a figure WOULD take, for placing one clear of another */
  figureBox(y: number, above?: boolean): { top: number; bottom: number };
}

const FIGURE_PX = 9;
const FIGURE_GAP = 3;

/** The pen for one draw call — media sizes scaled to the bitmap once, here */
export function ladderPen(scope: BitmapScope): LadderPen {
  const ctx = scope.context;
  const hr = scope.horizontalPixelRatio;
  const vr = scope.verticalPixelRatio;
  const W = scope.mediaSize.width * hr;
  const H = scope.mediaSize.height * vr;
  const right = W - 2 * hr;
  const figureBox = (y: number, above = true) => {
    const h = FIGURE_PX * vr;
    const gap = FIGURE_GAP * vr;
    return above ? { top: y - gap - h, bottom: y - gap } : { top: y + gap, bottom: y + gap + h };
  };
  return {
    ctx,
    hr,
    vr,
    W,
    H,
    right,
    rule(x0, y, x1, rgb, alpha, opts) {
      ctx.strokeStyle = rgb;
      ctx.lineWidth = Math.max(1, Math.round((opts?.width ?? 1) * vr));
      const from = Math.max(0, x0 ?? 0);
      if ((opts?.trace ?? true) && from > 0) {
        ctx.globalAlpha = alpha * 0.4;
        ctx.setLineDash([2 * hr, 4 * hr]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(from, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = alpha;
      if (opts?.dash) ctx.setLineDash(opts.dash.map(d => d * hr));
      ctx.beginPath();
      ctx.moveTo(from, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    },
    figure(text, y, rgb, above = true, alpha = 1, at = right) {
      ctx.font = `600 ${FIGURE_PX * vr}px ${LADDER_MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillStyle = rgb;
      ctx.globalAlpha = alpha;
      ctx.fillText(text, at, above ? y - FIGURE_GAP * vr : y + FIGURE_GAP * vr);
      ctx.globalAlpha = 1;
      return figureBox(y, above);
    },
    figureBox,
  };
}
