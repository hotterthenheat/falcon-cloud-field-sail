/*
==================================================
  SLAYER TERMINAL - THE KEY LEVELS' LADDER
  (components/gex/keyLevelsPrimitive.ts)

  Noah, 2026-10-04: "have the green and red thing we
  have on the compass chart be the call and put wall
  for the other charts like terrain instead of mixing
  the color palettes for key levels + gex. it should
  also have that little hover."

  Until now the Key levels switch painted the levels
  INTO the exposure field — green and red beads for
  the walls, a blue tick trail for the flip, a magenta
  band for the supreme — so the field's thermal
  palette and the levels' inks shared one place. Now
  the field keeps its own palette (the supreme's
  magenta band alone stays on the beads, at Noah's
  word 2026-10-05), and the levels take the Compass
  ladder's form at the tape's right edge:

    CALL WALL   a thin green rule, its price above it
    PUT WALL    the same in red
    FLIP        a thin silver dashed rule
    SUPREME     a magenta rule, one step heavier

  Short rungs, not full-width lines; no capsule on the
  axis; no words over the candles. The one under the
  pointer brightens and reaches further in, and the
  host draws the pointer card (name, price, how far
  from spot, one line on what it does to price). The
  pen is shared with the Compass marks (ladderPaint).

  THE EDGE IS SHARED WITH THE FIELD'S CHIPS. The
  exposure field names its heaviest strikes at the
  right edge ("510 · 13%"), and the walls are those
  strikes by definition — so a rung whose price has a
  chip ends AT the chip and prints no figure (the
  chip already says the number); every other rung
  runs to the edge with its figure above it, placed
  clear of the chips and of each other.

  ONE RUNG A PRICE. When the supreme sits on a wall,
  or the flip on either, the higher rank draws alone
  (the crown is never diluted — Noah, 2026-08-29) and
  the card says what it shares the price with.
==================================================
*/

import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { KeyLevels } from '../../types/gex';
import { ladderPen, type DrawTarget } from './ladderPaint';

export type KeyLevelKey = 'callWall' | 'putWall' | 'flip' | 'supreme';
export const KEY_LEVEL_KEYS: KeyLevelKey[] = ['callWall', 'putWall', 'flip', 'supreme'];

export interface KeyLevelRung {
  key: KeyLevelKey;
  price: number;
  /** A literal — the chart is its own island */
  ink: string;
  dash?: boolean;
  weight?: 1 | 2;
}

export interface KeyLevelsLadder {
  rungs: KeyLevelRung[];
  /** The rung under the pointer, if any */
  hot: KeyLevelKey | null;
}

/** What the pointer card says of each level — the name in the head, a short role beside it, one line under the figures */
export const KEY_LEVEL_WORDS: Record<KeyLevelKey, { name: string; aside: string; line: string }> = {
  callWall: { name: 'Call wall', aside: 'the ceiling', line: 'The strike with the most call hedging above spot. A rise tends to slow into it.' },
  putWall: { name: 'Put wall', aside: 'the floor', line: 'The strike with the most put hedging below spot. A fall tends to slow into it.' },
  flip: { name: 'Flip', aside: 'the border', line: 'Above it, dealer hedging steadies price. Below it, the hedging adds to the move.' },
  supreme: { name: 'Supreme', aside: 'the biggest strike', line: 'The strike with the most hedging in the whole book. Price tends to be drawn to it as expiry nears.' },
};

/** The rung at rest, and reaching further in under the pointer — media px */
const RUNG_W = 26;
const RUNG_W_HOT = 44;
/* THE REACH GLIDES (Noah, 2026-10-14: "the hover should be smooth not rapid"): a rung the pointer lands on widens and
   brightens over this long on the house's expo ease, and the one it left eases back the same way — never a snap */
const HOT_MS = 180;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** The gap between a rung's end and the chip it leads into, media px */
const CHIP_GAP = 3;

/** A strike chip the exposure field drew at the right edge this frame, media px (gexNodesPrimitive `chips`) */
export interface EdgeChip {
  strike: number;
  left: number;
  top: number;
  bottom: number;
}

/** Who draws when two levels share a price: the supreme, then a wall, then the flip */
const RANK: Record<KeyLevelKey, number> = { supreme: 3, callWall: 2, putWall: 2, flip: 1 };
const samePrice = (a: number, b: number) => Math.abs(a - b) < 1e-6;

class LadderRenderer {
  constructor(private readonly source: KeyLevelsPrimitive) {}
  draw(target: DrawTarget): void {
    const { series, data } = this.source;
    if (!series || !data || data.rungs.length === 0) return;
    const chips = this.source.chips?.() ?? [];
    target.useBitmapCoordinateSpace(scope => {
      const pen = ladderPen(scope);
      const { ctx, hr, vr, H, right } = pen;
      const placed: { r: KeyLevelRung; y: number }[] = [];
      for (const r of this.source.visible()) {
        const yc = series.priceToCoordinate(r.price);
        if (yc == null) continue;
        const y = Math.round(yc * vr) + 0.5;
        if (y < 4 * vr || y > H - 4 * vr) continue;
        placed.push({ r, y });
      }
      ctx.save();
      /* figures placed clear of the chips and of one another, top to bottom: above the rule by default, below it when
         above is taken, dropped when both are (the card carries the price) — the session tags' push, cut to two lanes */
      const taken: { top: number; bottom: number }[] = chips.map(c => ({ top: c.top * vr, bottom: c.bottom * vr }));
      const clear = (box: { top: number; bottom: number }) => !taken.some(t => box.top < t.bottom && box.bottom > t.top) && box.top >= 0 && box.bottom <= H;
      placed.sort((a, b) => a.y - b.y);
      /* a playhead, when the host has one: the levels are the book at THAT minute, so the rungs stand on it and a
         faint trace covers only the tape already printed. Null keeps the rungs on the plot's right edge. */
      const edgeMedia = this.source.edge;
      for (const { r, y } of placed) {
        /* how far into its hot state the rung is, 0 at rest to 1 under the pointer (the tween) */
        const hot = this.source.hotT(r.key);
        const chip = edgeMedia == null ? chips.find(c => samePrice(c.strike, r.price)) : undefined;
        /* a rung with a chip leads INTO it and lets the chip say the number; the rest run to the edge with a figure */
        const end = edgeMedia != null ? edgeMedia * hr : chip ? (chip.left - CHIP_GAP) * hr : right;
        const w = (RUNG_W + (RUNG_W_HOT - RUNG_W) * hot) * hr;
        pen.rule(end - w, y, end, r.ink, 0.82 + 0.18 * hot, { trace: edgeMedia != null, dash: r.dash ? [3, 3] : undefined, width: r.weight ?? 1 });
        if (chip) continue;
        const text = r.price.toFixed(2);
        const figAt = edgeMedia != null ? end - w - 4 * hr : undefined;
        if (clear(pen.figureBox(y, true))) taken.push(pen.figure(text, y, r.ink, true, 0.92 + 0.08 * hot, figAt));
        else if (clear(pen.figureBox(y, false))) taken.push(pen.figure(text, y, r.ink, false, 0.92 + 0.08 * hot, figAt));
      }
      ctx.restore();
    });
  }
}

class LadderPaneView {
  private readonly _renderer: LadderRenderer;
  constructor(source: KeyLevelsPrimitive) {
    this._renderer = new LadderRenderer(source);
  }
  /* over the candles — thin enough to leave the tape whole, like the Compass marks */
  zOrder(): 'top' {
    return 'top';
  }
  renderer(): LadderRenderer {
    return this._renderer;
  }
}

export class KeyLevelsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  data: KeyLevelsLadder | null = null;
  /** Media px from the pane's left. Set, the rungs stand on this minute — the playhead — not the plot's right edge. */
  edge: number | null = null;
  /** The field's strike chips at the edge this frame — set by the host, read at draw and in its hit test */
  chips?: () => EdgeChip[];
  private readonly _paneViews: LadderPaneView[];
  /** Each rung's hot state as drawn, 0..1, and where each was when the last pointer move began its glide */
  private _hotNow: Partial<Record<KeyLevelKey, number>> = {};
  private _hotFrom: Partial<Record<KeyLevelKey, number>> = {};
  private _hotStart = 0;
  private _hotFrame = 0;
  constructor() {
    this._paneViews = [new LadderPaneView(this)];
  }
  /** The rungs that draw: finite prices, one a price, the higher rank keeping a shared one */
  visible(): KeyLevelRung[] {
    const rungs = (this.data?.rungs ?? []).filter(r => Number.isFinite(r.price));
    return rungs.filter(r => !rungs.some(o => o !== r && samePrice(o.price, r.price) && (RANK[o.key] > RANK[r.key] || (RANK[o.key] === RANK[r.key] && rungs.indexOf(o) < rungs.indexOf(r)))));
  }
  /** The levels a drawn rung stands on the price of — what its card says it shares the price with */
  sharedWith(key: KeyLevelKey): KeyLevelKey[] {
    const rungs = this.data?.rungs ?? [];
    const me = rungs.find(r => r.key === key);
    if (!me) return [];
    return rungs.filter(r => r.key !== key && samePrice(r.price, me.price)).map(r => r.key);
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
    if (this._hotFrame) cancelAnimationFrame(this._hotFrame);
    this._hotFrame = 0;
  }
  updateAllViews(): void {}
  paneViews(): LadderPaneView[] {
    return this._paneViews;
  }
  /** A rung's hot state as drawn this frame: 0 at rest, 1 under the pointer, between while it glides */
  hotT(key: KeyLevelKey): number {
    return this._hotNow[key] ?? 0;
  }
  /* the glide: every rung moves from where it was toward 1 (the hot one) or 0 on one clock, a frame at a time */
  private _glide = (): void => {
    this._hotFrame = 0;
    const p = easeOut(Math.min(1, (performance.now() - this._hotStart) / HOT_MS));
    let going = false;
    for (const k of KEY_LEVEL_KEYS) {
      const from = this._hotFrom[k] ?? 0;
      const to = this.data?.hot === k ? 1 : 0;
      const now = from + (to - from) * p;
      this._hotNow[k] = now;
      if (now !== to) going = true;
    }
    this.requestUpdate?.();
    if (going && p < 1) this._hotFrame = requestAnimationFrame(this._glide);
  };
  setData(data: KeyLevelsLadder | null): void {
    this.data = data;
    this.requestUpdate?.();
  }
  /** Stand the rungs on the playhead (media px from the pane's left). Null returns them to the plot's right edge. */
  setEdge(x: number | null): void {
    const next = x != null && Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
    if (next === this.edge) return;
    this.edge = next;
    this.requestUpdate?.();
  }
  /** Move the rungs to new prices (the host's tween) — the inks and the hot rung stay */
  setPrices(levels: KeyLevels): void {
    if (!this.data) return;
    let moved = false;
    for (const r of this.data.rungs) {
      const p = levels[r.key];
      if (r.price !== p) {
        r.price = p;
        moved = true;
      }
    }
    if (moved) this.requestUpdate?.();
  }
  setHot(key: KeyLevelKey | null): void {
    if (!this.data || this.data.hot === key) return;
    this.data = { ...this.data, hot: key };
    /* the glide starts from wherever each rung is now — a pointer crossing two rungs never jumps */
    this._hotFrom = { ...this._hotNow };
    this._hotStart = performance.now();
    if (this._hotFrame) cancelAnimationFrame(this._hotFrame);
    this._hotFrame = requestAnimationFrame(this._glide);
  }
}
