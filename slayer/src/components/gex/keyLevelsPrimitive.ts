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

    CALL WALL   a thin glacier rule, letter C
    PUT WALL    the same in ember, letter P
    FLIP        a thin silver dashed rule, letter F
    SUPREME     a magenta rule, one step heavier, letter S

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
import { LADDER_MONO, ladderPen, type DrawTarget } from './ladderPaint';

export type KeyLevelKey = 'callWall' | 'putWall' | 'flip' | 'supreme' | 'pin' | 'maxPain' | 'coneHigh' | 'coneLow' | 'moveHigh' | 'moveLow' | 'sigmaHigh' | 'sigmaLow' | 'nextHigh' | 'nextLow' | 'twoHigh' | 'twoLow';
/** Book rungs only. Cone edges are not on KeyLevels, so the tween must not index them. */
export const KEY_LEVEL_KEYS = ['callWall', 'putWall', 'flip', 'supreme', 'pin', 'maxPain'] as const;
const HOT_KEYS: KeyLevelKey[] = [...KEY_LEVEL_KEYS, 'coneHigh', 'coneLow', 'moveHigh', 'moveLow', 'sigmaHigh', 'sigmaLow', 'nextHigh', 'nextLow', 'twoHigh', 'twoLow'];

export interface KeyLevelRung {
  key: KeyLevelKey;
  price: number;
  /** A literal — the chart is its own island */
  ink: string;
  dash?: boolean;
  weight?: 1 | 2;
  /** How many times today's range reached this price. Drawn as notches, off the candles. */
  touches?: number;
  /** The strike's net GEX against the cut's largest strike's, 0–1 — printed beside the name where the host has it */
  share?: number;
  /** Replaces the stock name when this rung is a cone edge for a specific frame */
  title?: string;
}

export interface KeyLevelsLadder {
  rungs: KeyLevelRung[];
  /** The rung under the pointer, if any */
  hot: KeyLevelKey | null;
  /** The price the labels measure from. Set, each rung is named at the edge with its price and its distance from it. */
  spot?: number;
}

/** What the pointer card says of each level — the name in the head, a short role beside it, one line under the figures */
export const KEY_LEVEL_WORDS: Record<KeyLevelKey, { name: string; aside: string; line: string }> = {
  callWall: { name: 'Call wall', aside: 'the most call gamma', line: 'The strike with the most call hedging, either side of price. Above price a rise tends to slow into it; below, it can act as support.' },
  putWall: { name: 'Put wall', aside: 'the most put gamma', line: 'The strike with the most put hedging, either side of price. Below price it is support while it holds; above, it is overhead put hedging, not a floor.' },
  flip: { name: 'Flip', aside: 'this book', line: 'Where dealer hedging switches sides, on the contracts this rail is reading. The desk names that set. No crossing within 10% is left blank — it is not invented at the price.' },
  supreme: { name: 'Supreme', aside: 'the biggest strike', line: 'The strike with the most hedging in the whole book. Price tends to be drawn to it as expiry nears.' },
  pin: { name: 'Largest OI', aside: 'the most open interest', line: 'The strike with the most open interest on this cut. It is where the chain is heaviest, not a forecast and not a level price is drawn to.' },
  maxPain: { name: 'Max pain', aside: 'not a wall', line: 'The settlement that pays the least intrinsic on the open interest. It is not a wall and it is not the largest-OI strike.' },
  coneHigh: { name: 'Cone high', aside: 'this horizon +1σ', line: 'The top of the expected move on the horizon this chart is drawing. A bell fires when price crosses it.' },
  coneLow: { name: 'Cone low', aside: 'this horizon −1σ', line: 'The bottom of the expected move on the horizon this chart is drawing. A bell fires when price crosses it.' },
  moveHigh: { name: 'Move high', aside: "today's expected move", line: "Today's open plus one session's 1σ at the at-the-money vol: where the options price the day's move to reach, about two days in three." },
  moveLow: { name: 'Move low', aside: "today's expected move", line: "Today's open less one session's 1σ at the at-the-money vol: where the options price the day's move to reach, about two days in three." },
  sigmaHigh: { name: '1σ high', aside: 'to the close', line: 'The last price plus 1σ of the move left to the close (the next close once the bell has rung), off the at-the-money vol.' },
  sigmaLow: { name: '1σ low', aside: 'to the close', line: 'The last price less 1σ of the move left to the close (the next close once the bell has rung), off the at-the-money vol.' },
  nextHigh: { name: 'Next day 1σ high', aside: "the cone's end", line: "The last price plus 1σ of the move to the next session's close: the cone's upper 1σ curve where it ends." },
  nextLow: { name: 'Next day 1σ low', aside: "the cone's end", line: "The last price less 1σ of the move to the next session's close: the cone's lower 1σ curve where it ends." },
  twoHigh: { name: 'Next day 2σ high', aside: "the cone's end", line: "The last price plus 2σ of the move to the next session's close — about one move in forty-four ends above it." },
  twoLow: { name: 'Next day 2σ low', aside: "the cone's end", line: "The last price less 2σ of the move to the next session's close — about one move in forty-four ends below it." },
};

/** The rung at rest, and reaching further in under the pointer — media px */
const RUNG_W = 26;
const RUNG_W_HOT = 44;
const RUNG_MARK: Partial<Record<KeyLevelKey, string>> = { callWall: 'C', putWall: 'P', flip: 'F', supreme: 'S' };
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
const RANK: Record<KeyLevelKey, number> = { supreme: 3, callWall: 2, putWall: 2, flip: 1, pin: 1, maxPain: 0, coneHigh: 0, coneLow: 0, moveHigh: 0, moveLow: 0, sigmaHigh: 0, sigmaLow: 0, nextHigh: 0, nextLow: 0, twoHigh: 0, twoLow: 0 };
const samePrice = (a: number, b: number) => Math.abs(a - b) < 1e-6;

class LadderRenderer {
  constructor(private readonly source: KeyLevelsPrimitive) {}
  draw(target: DrawTarget): void {
    const { series, data } = this.source;
    if (!series || !data) return;
    const spot = data.spot ?? this.source.namedSpot;
    if (spot != null && spot > 0) {
      drawNamed(this.source, target, spot);
      return;
    }
    if (data.rungs.length === 0) return;
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
      /* FIGURES BY RANK, NEVER A PILE (the fourth audit: "770.27 / 770.00 / 769.00" stacked at the edge): the supreme's
         figure first, then the walls', then the flip's; a figure whose rung sits within a figure's height of one already
         printed is left to the pointer card */
      placed.sort((a, b) => RANK[b.r.key] - RANK[a.r.key] || a.y - b.y);
      const figRungs: number[] = [];
      const FIG_GAP = 14 * vr;
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
        const mark = RUNG_MARK[r.key];
        if (mark) {
          ctx.fillStyle = r.ink;
          ctx.font = `${Math.round(9 * vr)}px ui-monospace, monospace`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'right';
          ctx.fillText(mark, end - w - 3 * hr, y);
        }
        const n = Math.min(4, r.touches ?? 0);
        if (n > 0) {
          ctx.fillStyle = r.ink;
          for (let i = 0; i < n; i++) {
            ctx.beginPath();
            ctx.arc(end - w - (7 + i * 5) * hr, y, 1.5 * vr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (chip) continue;
        if (figRungs.some(fy => Math.abs(fy - y) < FIG_GAP)) continue;
        figRungs.push(y);
        const text = r.price.toFixed(2);
        const figAt = edgeMedia != null ? end - w - 4 * hr : undefined;
        if (clear(pen.figureBox(y, true))) taken.push(pen.figure(text, y, r.ink, true, 0.92 + 0.08 * hot, figAt));
        else if (clear(pen.figureBox(y, false))) taken.push(pen.figure(text, y, r.ink, false, 0.92 + 0.08 * hot, figAt));
      }
      ctx.fillStyle = '#EDEDED';
      for (const price of this.source.marks) {
        const yc = series.priceToCoordinate(price);
        if (yc == null) continue;
        const y = Math.round(yc * vr);
        if (y < 4 * vr || y > H - 4 * vr) continue;
        ctx.beginPath();
        ctx.arc(right - 8 * hr, y, 2.2 * vr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}

const signedPct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
const priceWords = (p: number): string => (Math.abs(p - Math.round(p)) < 1e-9 ? p.toFixed(0) : p.toFixed(2));

/** A rung's words at the edge: its name, its price, its share of the largest strike where it has one, its distance from
    the price */
export function rungLabel(r: KeyLevelRung, spot: number): string {
  const name = r.title ?? KEY_LEVEL_WORDS[r.key].name;
  const share = r.share != null && Number.isFinite(r.share) ? ` · ${r.key === 'supreme' && r.share >= 0.995 ? 'top node' : `${Math.round(r.share * 100)}% of top`}` : '';
  return `${name} ${priceWords(r.price)}${share} · ${signedPct(((r.price - spot) / spot) * 100)}`;
}

/* The named form: a short rung at the edge in the level's ink, and left of it the level's words in a box of the same ink,
   the boxes pushed apart top to bottom so none overlaps another — a box moved off its rung keeps a thin lead to it */
/* The named ladder is drawn on the pane's top layer, which repaints on every crosshair move: it is painted once into its
   own bitmap and blitted until a rung, a word, the scale or the hover changes */
const namedCache = new WeakMap<KeyLevelsPrimitive, { key: string; canvas: HTMLCanvasElement; at: number }>();
function drawNamed(src: KeyLevelsPrimitive, target: DrawTarget, spot: number): void {
  const series = src.series;
  if (!series) return;
  target.useBitmapCoordinateSpace(scope => {
    const hr0 = scope.horizontalPixelRatio;
    const vr0 = scope.verticalPixelRatio;
    const W0 = Math.round(scope.mediaSize.width * hr0);
    const H0 = Math.round(scope.mediaSize.height * vr0);
    const items: { r: KeyLevelRung; y: number; text: string; hot: number }[] = [];
    for (const r of src.visible()) {
      const yc = series.priceToCoordinate(r.price);
      if (yc == null) continue;
      const y = Math.round(yc * vr0) + 0.5;
      if (y < 2 * vr0 || y > H0 - 2 * vr0) continue;
      items.push({ r, y, text: rungLabel({ ...r, share: src.shareOf(r) }, spot), hot: src.hotT(r.key) });
    }
    if (!items.length) return;
    /* A label that is not a wall, the flip, or the supreme yields when it would sit on one of those,
       or on another label. The lines stay. Only the words are dropped, so the rail stops stacking. */
    const book = (k: KeyLevelKey) => k === 'callWall' || k === 'putWall' || k === 'flip' || k === 'supreme';
    const room = Math.round(16 * vr0);
    const kept: typeof items = [];
    const byRank = [...items].sort((a, b) => Number(book(b.r.key)) - Number(book(a.r.key)) || a.y - b.y);
    for (const it of byRank) {
      if (!book(it.r.key) && kept.some(k => Math.abs(k.y - it.y) < room)) continue;
      kept.push(it);
    }
    items.length = 0;
    items.push(...kept);
    if (!items.length) return;
    const key = `${W0}x${H0}|${hr0}|${vr0}|${src.edge}|${src.chromeInset}|${items.map(i => `${i.r.key}:${i.y}:${i.text}:${i.r.ink}:${i.hot.toFixed(3)}:${i.r.dash ? 1 : 0}:${i.r.weight ?? 1}`).join(',')}`;
    let cache = namedCache.get(src);
    if (!cache || cache.key !== key) {
      const now = performance.now();
      /* rebuilt a moment ago and changed again (a zoom): this frame is drawn straight */
      if (cache && now - cache.at < 150) {
        paintNamed(src, scope, items);
        cache.at = now;
        cache.key = '';
        return;
      }
      const canvas = cache?.canvas ?? document.createElement('canvas');
      if (canvas.width !== W0 || canvas.height !== H0) {
        canvas.width = W0;
        canvas.height = H0;
      }
      const off = canvas.getContext('2d');
      if (!off) return;
      off.clearRect(0, 0, W0, H0);
      paintNamed(src, { ...scope, context: off }, items);
      cache = { key, canvas, at: now };
      namedCache.set(src, cache);
    }
    scope.context.drawImage(cache.canvas, 0, 0);
  });
}

function paintNamed(src: KeyLevelsPrimitive, scope: Parameters<typeof ladderPen>[0], items: { r: KeyLevelRung; y: number; text: string; hot: number }[]): void {
  const pen = ladderPen(scope);
  const { ctx, hr, vr, H, right } = pen;
  const edgeMedia = src.edge;
  const end = edgeMedia != null ? edgeMedia * hr : right;
  ctx.save();
  ctx.font = `${Math.round(9.5 * vr)}px ${LADDER_MONO}`;
  ctx.textBaseline = 'middle';
  const boxH = Math.round(14 * vr);
  const gap = Math.round(2 * vr);
  const placed = items.map(i => ({ ...i, ty: i.y, w: ctx.measureText(i.text).width + 10 * hr }));
  for (const p of placed) {
    const w = (RUNG_W + (RUNG_W_HOT - RUNG_W) * p.hot) * hr;
    pen.rule(end - w, p.y, end, p.r.ink, 0.85 + 0.15 * p.hot, { trace: edgeMedia != null, dash: p.r.dash ? [3, 3] : undefined, width: p.r.weight ?? 1 });
  }
  placed.sort((a, b) => a.y - b.y);
  const step = boxH + gap;
  /* the first box clears the host's chrome; the rest are pushed down from it */
  const ceiling = src.chromeInset * vr + boxH / 2 + 2 * vr;
  placed[0].ty = Math.max(placed[0].ty, ceiling);
  for (let i = 1; i < placed.length; i++) placed[i].ty = Math.max(placed[i].ty, placed[i - 1].ty + step);
  const floor = H - boxH / 2 - 2 * vr;
  if (placed[placed.length - 1].ty > floor) {
    placed[placed.length - 1].ty = floor;
    for (let i = placed.length - 2; i >= 0; i--) placed[i].ty = Math.min(placed[i].ty, placed[i + 1].ty - step);
  }
  const labelRight = end - RUNG_W * hr - 4 * hr;
  for (const p of placed) {
    const ty = Math.round(Math.max(boxH / 2, p.ty));
    const left = Math.max(2 * hr, labelRight - p.w);
    const a = 0.88 + 0.12 * p.hot;
    if (Math.abs(ty - p.y) > 1.5 * vr) {
      ctx.strokeStyle = p.r.ink;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, vr * 0.75);
      ctx.beginPath();
      ctx.moveTo(labelRight, ty);
      ctx.lineTo(end - RUNG_W * hr, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(10,10,10,0.8)';
    ctx.fillRect(left, ty - boxH / 2, labelRight - left, boxH);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = p.r.ink;
    ctx.fillRect(left, ty - boxH / 2, Math.max(1, Math.round(2 * hr)), boxH);
    ctx.globalAlpha = a;
    ctx.textAlign = 'right';
    ctx.fillText(p.text, labelRight - 4 * hr, ty + 0.5 * vr);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
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
  /** Strikes whose open interest at least doubled. Dots, not a new study. */
  marks: number[] = [];
  private readonly _paneViews: LadderPaneView[];
  /** Each rung's hot state as drawn, 0..1, and where each was when the last pointer move began its glide */
  private _hotNow: Partial<Record<KeyLevelKey, number>> = {};
  private _hotFrom: Partial<Record<KeyLevelKey, number>> = {};
  private _hotStart = 0;
  private _hotFrame = 0;
  constructor() {
    this._paneViews = [new LadderPaneView(this)];
  }
  /** Set, the rungs are named at the edge, with their distance from this price (setNamed) */
  namedSpot: number | null = null;
  /** The host's floating chrome, media px from the pane's top: the named words stay below it */
  chromeInset = 0;
  private shares: { callWall?: number; putWall?: number; supreme?: number } = {};
  /** The named form's inputs: the price the distances measure from, each wall's share of the largest strike, and the
      levels' max pain as a rung of its own */
  setNamed(spot: number | null, shares: { callWall?: number; putWall?: number; supreme?: number } | undefined, maxPain: number | null, painInk: string): void {
    const s = spot != null && Number.isFinite(spot) && spot > 0 ? spot : null;
    const sh = shares ?? {};
    const same = s === this.namedSpot && sh.callWall === this.shares.callWall && sh.putWall === this.shares.putWall && sh.supreme === this.shares.supreme;
    this.namedSpot = s;
    this.shares = sh;
    this.setExtras('pain', maxPain != null && Number.isFinite(maxPain) && maxPain > 0 ? [{ key: 'maxPain', price: maxPain, ink: painInk, dash: true }] : []);
    if (!same && this.data) this.requestUpdate?.();
  }
  /** A rung's share of the largest strike, from the host's levels */
  shareOf(r: KeyLevelRung): number | undefined {
    return r.share ?? (r.key === 'callWall' || r.key === 'putWall' || r.key === 'supreme' ? this.shares[r.key] : undefined);
  }
  /** Rungs the host adds beside the book's, by source (the cone's moves, max pain) */
  private extras = new Map<string, KeyLevelRung[]>();
  setExtras(group: string, rungs: KeyLevelRung[]): void {
    const was = this.extras.get(group) ?? [];
    if (was.length === rungs.length && was.every((r, i) => r.key === rungs[i].key && r.price === rungs[i].price && r.ink === rungs[i].ink)) return;
    this.extras.set(group, rungs);
    if (this.data) this.requestUpdate?.();
  }
  /** The rungs that draw: finite prices, one a price, the higher rank keeping a shared one */
  visible(): KeyLevelRung[] {
    const all = this.data ? [...this.data.rungs, ...[...this.extras.values()].flat()] : [];
    const rungs = all.filter(r => Number.isFinite(r.price));
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
    for (const k of HOT_KEYS) {
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
      const k = r.key;
      if (k !== 'callWall' && k !== 'putWall' && k !== 'flip' && k !== 'supreme' && k !== 'pin' && k !== 'maxPain') continue;
      const p = levels[k];
      if (p == null || !Number.isFinite(p) || r.price === p) continue;
      r.price = p;
      moved = true;
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
