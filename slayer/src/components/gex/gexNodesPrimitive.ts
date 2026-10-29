import type { ISeriesPrimitive, SeriesAttachedParameter, Time, IChartApi, ISeriesApi } from 'lightweight-charts';
import type { GexSnapshot } from '../../types/market';
import { nyIsoDate, nySession } from '../../core/nyTime';
import { nodeMark, peakStrikes, priceTag, type NodeMark, type PriceTag } from '../../data/nodeScore';

/*
  Exposure nodes — the ORIGINAL trail form, back by request (Noah,
  2026-08-22: "the prev exposure trail we used to have, the same one Skylit
  and a few others had"). For every bar-aligned snapshot, one small bead at
  each strike that carries enough gamma: its thickness and brightness are
  that moment's strength, and it simply isn't drawn when the strike stops
  mattering — so a wall reads as a dotted band that fattens as it builds,
  thins as it drains, and breaks where it died. Beads are anchored to
  absolute price (y) and time (x), so they stay pinned across timeframes.

  WHITE, not red/green (Noah): the trails say WHERE and HOW MUCH; the sign
  lives on the ladder, the map and the levels. Strength lives in alpha and
  height, never in desaturation.

  The level view rides on top: a focused strike's beads wear the focus ink
  (lime, or magenta while it is the supreme) at full strength, and the rest of
  the field steps back.
*/

/* THE FIELD'S OWN INKS (Noah, 2026-08-22): the house heatmap's steel-gold
   poles — gold = put-dominant / amplifying, steel = call-dominant /
   absorbing — and magenta on the supreme strike, as everywhere else. Not the
   market red/green: on THIS surface those belong to the candles, and a
   field in the tape's ink can't be told from the tape. The legend above the
   chart teaches the pair. Strength lives in height and alpha, never in
   desaturation. */
const PUT_RGB: readonly [number, number, number] = [245, 197, 66]; // honey gold
const CALL_RGB: readonly [number, number, number] = [214, 237, 248]; // glacier ice — the absorb pole (2026-08-29)
const SUPREME_RGB: readonly [number, number, number] = [234, 0, 255]; // magenta, restored — mirrors palette SUPREME
/* THE WALLS LIVE HERE (Noah, 2026-08-22: "I hate how they look on the side
   line"): each moment's call wall beads ink glacier, its put wall ember, and the
   flip runs as a blue tick trail — the levels ON the tape, history included,
   instead of static lines at today's values. Same level rules as the chips
   used (buildLevelsFor): wall = heaviest |gamma| above/below that moment's
   close, flip = the sign-change midpoint nearest it. */
const CW_RGB: readonly [number, number, number] = [48, 209, 88]; // bull green
const PW_RGB: readonly [number, number, number] = [255, 59, 48]; // bear red
const FLIP_RGBA = 'rgba(156,163,175,0.8)'; // indecision gray — the regime border (mirrors palette FLIP); alpha raised with the 2026-08-29 weight pass

/* WHEN TWO IDENTITIES SHARE A STRIKE, THE SUPREME WINS OUTRIGHT (Noah,
   2026-08-29: "its so bright practically hard to miss especially on the
   charts" — then, shown a supreme-on-put-wall band rendering amber: "this is
   nowhere near neon"). The 2026-08-22 blends (wine/violet/amber) existed so
   a wall was never swallowed, but a 50/50 mix swallows the SUPREME instead —
   and lime diluted is olive, not neon. The wall's identity still gets told:
   its chip, its axis line, and the ladder's K·PW / K·CW tags all name it.
   The band belongs to the crown. */
const FLIPK_RGBA = 'rgba(234,0,255,0.85)';
/* the field's ink slots, in the order the renderer's INKS list holds them */
const INK_F = 0;
const INK_K = 1;
const INK_CW = 2;
const INK_PW = 3;
const INK_P = 4;
const INK_C = 5; // the supreme outranks the flip on a shared strike too

/* A peak is at least each same-sign neighbour and 20% of that moment's largest node.
   A tie is one node across both strikes. The rest stays, at about a quarter. */

/* THE HOVER (Noah, 2026-10-15, after reading his partner's Terrain: "i want all of those things like hover ring, chain,
   veil, card and legend line … but do not incorporate his sizing … nor his colors. the hover should ONLY hover over
   that specific one"): the bead under the pointer wears a ring in the page's ink and is drawn again at its full light,
   and a veil of the chart's ground dims the rest of the field to HOVER_KEEP — the one bead, never its strike's whole
   chain. THE CHAIN IS THE CLICK: a click on a bead keeps its strike (the host's focus — the level view the field has
   had since 2026-08-22: the strike's beads at full in silver, the rest stepping back), and its card stays up. The
   veil and the ring are drawn over the cached bitmap each frame, never into it, so a pointer never rebuilds the field.
   The sizes and the inks are the field's own. */
/** The light the rest of the field keeps under a hover */
export const HOVER_KEEP = 0.6;
/** The bead under the pointer, as the card reads it */
export interface BeadHit {
  strike: number;
  /** the bead's own moment, and its column's index in the field */
  time: number;
  ci: number;
  /** the greek drawn at the strike then, signed dollars; its share of that moment's book, 0–1; its value at the day's
      open — null where the field holds no column of that day's open */
  value: number;
  share: number;
  open: number | null;
  /** the side (positive = put-dominant, pushes a move along) and the bead's strength against the reference */
  put: boolean;
  t: number;
  /** Born, grew, flipped, died — set on the bucket that confirmed it. */
  mark?: 'born' | 'grew' | 'flipped' | 'died';
  /** What price did over the ten minutes after it touched. */
  tag?: 'rejected' | 'absorbed' | 'broke';
  /** False when the flow net is too small a share of the volume to trust. */
  firm?: boolean;
  /** the bead's centre and half-sizes on the pane, CSS px */
  x: number;
  y: number;
  rx: number;
  ry: number;
}
/** The side beads' inks as CSS, for the card's figure (the honey gold and the glacier ice above) */
export const BEAD_INK_CSS = { put: `rgb(${PUT_RGB[0]},${PUT_RGB[1]},${PUT_RGB[2]})`, call: `rgb(${CALL_RGB[0]},${CALL_RGB[1]},${CALL_RGB[2]})` } as const;
/** The bead's half-height at strength t: t^1.6 between the hairline and the bar's swell (the draw's own amplitude) */
const beadHalfHeight = (t: number, aMin: number, aMax: number): number => aMin + Math.pow(t, 1.6) * (aMax - aMin);
/** A colour as the chart's options give it — "#rrggbb" or "rgb(a)(r, g, b)" — as channels */
const rgbOf = (css: string): readonly [number, number, number] => {
  const hex = css.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
  const m = css.match(/\d+(?:\.\d+)?/g) ?? [];
  return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
};

/** One bead: a strike's strength against the reference, and which side owns it */
interface Bead {
  strike: number;
  t: number;
  /** Sim side-coding: positive = put-dominant (amplifies), negative = call-dominant (absorbs) */
  put: boolean;
  /** A local peak or a flat tie. The rest of the column stays, faded. */
  peak: boolean;
  /** False when the bead is the rest of the book, drawn behind same-day expiry. */
  front: boolean;
  /** The other strike of a tie. One bead covers both. */
  span?: number;
  /** Born, grew, flipped, or died. Set on the bucket the rule confirms. */
  mark?: NodeMark;
  /** What price did in the ten minutes after it touched. */
  tag?: PriceTag;
  /** The bucket has no print for a strike that was a node. Not a blank. */
  missing?: boolean;
  /** False when the flow net is under about 2% of the strike's volume. Drawn dashed. */
  firm?: boolean;
}

/** One column of the field, ranked and scaled at load time */
interface Column {
  time: number;
  /** The strikes that draw, strongest first */
  top: Bead[];
  /** Every strike — only consulted for a focused strike outside the top */
  all: Map<number, Bead>;
  /** The bucket before this one was missing. The row says so. */
  gap?: boolean;
  /** `top` in draw order (the rest-of-book beads first), sorted once on first draw */
  ordered?: Bead[];
}

/** The focused level's ink: the focus lime — or the supreme's magenta while the
    focused strike IS the supreme. Mirrors palette FOCUS/SUPREME. */
export type FocusInk = 'focus' | 'supreme';
const INK_RGB: Record<FocusInk, readonly [number, number, number]> = {
  focus: [199, 211, 232],
  supreme: [234, 0, 255],
};

interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  mediaSize: { width: number; height: number };
  bitmapSize: { width: number; height: number };
}
interface DrawTarget {
  useBitmapCoordinateSpace(cb: (scope: BitmapScope) => void): void;
}

class TrailsPaneRenderer {
  constructor(private source: GexTrailsPrimitive) {}

  /*
    The bead field (hundreds of columns × a dozen beads × two subpaths) is the layer's whole cost, so it is rasterized
    once and cached against everything it depends on: the data revision, pan/zoom, both scales and the identity inputs.
    A hover or crosshair repaint blits the bitmap. The vertical scale is fingerprinted by two prices' coordinates
    (price→pixel is affine, so two points pin it).
  */
  private cacheKey = '';
  /** The field, rasterized — a hover repaint blits this. A pan or a price-scale
      drag blits it shifted, and the paths are rebuilt once the gesture stops,
      so the frame stays a drawImage instead of thousands of fills. */
  private bmp: HTMLCanvasElement | null = null;
  private blitRev = -1;
  private blitX = 0;
  private blitProbe = 0;
  private blitBar = 0;
  private blitHr = 1;
  private blitVr = 1;
  private settle = 0;
  private movedAt = 0;
  private labelsOf: { snap: GexSnapshot; greek: TrailGreek; total: number; top: { strike: number; value: number }[] } | null = null;

  /** One rebuild after the pan stops. Re-arming during the gesture never paints. */
  private armSettle(src: GexTrailsPrimitive): void {
    this.movedAt = performance.now();
    if (this.settle) return;
    const wait = () => {
      if (performance.now() - this.movedAt < 48) {
        this.settle = requestAnimationFrame(wait);
        return;
      }
      this.settle = 0;
      this.cacheKey = '';
      src.requestUpdate?.();
    };
    this.settle = requestAnimationFrame(wait);
  }

  draw(target: DrawTarget): void {
    this.drawField(target);
    this.source.afterDraw?.();
  }

  private drawField(target: DrawTarget): void {
    const src = this.source;
    /* the frame's chips, told to the key levels' ladder (drawn after this, at `top`) — none until the labels pass writes them */
    src.chips = [];
    if (!src.enabled || !src.chart || !src.series || src.snapshots.length === 0) return;
    const series = src.series;
    const ts = src.chart.timeScale();
    /* Only the columns on screen: the snapshots are time-sorted, so the visible window is two binary searches, and a
       column is built the first time it is seen (columnAt), not for the whole session up front. */
    const vis = ts.getVisibleRange();
    if (!vis) return;
    const fromT = Number(vis.from) - src.barSec * 2;
    const toT = Number(vis.to) + src.barSec * 2;
    const snaps = src.snapshots;
    let lo = 0;
    let hi = snaps.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (snaps[m].time < fromT) lo = m + 1;
      else hi = m;
    }
    const first = lo;
    lo = first;
    hi = snaps.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (snaps[m].time <= toT) lo = m + 1;
      else hi = m;
    }
    const last = lo; // exclusive
    if (last <= first) return;
    const col0 = src.columnAt(first);
    const barSpacing = ts.options().barSpacing ?? 6;
    if (src.ref <= 0 && src.restRef <= 0) return;
    /* WAVEFORMS, NOT DOTS (Noah, 2026-08-22, against Sovereign's close-ups):
       a rail is a ribbon — every bead is as WIDE as its slot, so they touch,
       and the variation is VERTICAL: the ribbon's thickness flickers with
       each moment's strength, like an audio waveform. Weak strikes draw as
       hairline dashes, not specks. The ribbon is translucent and layered (a
       wider, fainter halo under a soft core) so candles show through it. */
    /* Amplitude follows the BAR WIDTH, not a fixed pixel count, so 15m/1h
       ribbons sit in proportion to their candles: the heaviest rail is
       ~60% of a bar tall, a hairline is under a pixel. t^1.6 keeps the
       weak field thin without crushing the mid-rails to nothing. */
    const A_MIN = 0.45;
    const A_MAX = Math.max(3, Math.min(barSpacing * 0.6, 9));
    const focus = src.focusStrike;
    const supreme = src.supremeStrike;
    const ink = INK_RGB[src.focusInk];
    const inkCss = `rgba(${ink[0]},${ink[1]},${ink[2]},0.95)`;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const wCss = scope.mediaSize.width;
      /* SUB-BAR BEADS (Noah, 2026-08-22: one bead per 30m/1h bar was a row of
         pearls): the field's clock is finer than the bars, so a bar holds
         several beads, each placed at its own time across the bar's width.
         On 1m/5m the slot IS the bar and nothing changes.
         BUDGET: never more columns than the pixels can show — a slot under
         ~3px wide is drawn every 2nd/3rd/nth, so a zoomed-out 1h chart costs
         the same frame as a 1m one (the price-scale drag lagged without it). */
      const barSec = src.barSec;
      const slots = Math.max(1, Math.round(barSec / Math.max(1, src.stepSec)));
      const stride = Math.max(1, Math.ceil(3 / (barSpacing / slots)));
      const drawnSlots = Math.max(1, Math.ceil(slots / stride));
      const rx = (barSpacing / drawnSlots) * 0.54 * hr;
      const halfW = barSpacing * 0.5;

      /* The cache fingerprint — see the field notes above. */
      const firstBucket = Math.floor(col0.time / barSec) * barSec;
      const x0 = ts.timeToCoordinate(firstBucket as Time);
      const probeA = series.priceToCoordinate(col0.top[0]?.strike ?? 0) ?? -1;
      const probeB = series.priceToCoordinate((col0.top[0]?.strike ?? 0) + 1) ?? -1;
      const key = `${src.rev}|${wCss}|${scope.mediaSize.height}|${barSpacing.toFixed(3)}|${x0}|${first}|${last}|${probeA.toFixed(2)}|${probeB.toFixed(2)}|${hr}|${vr}|${focus}|${supreme}|${src.cwStrike}|${src.pwStrike}|${src.flipPrice}|${src.focusInk}`;
      const cached = key === this.cacheKey && !!this.bmp;
      /* PAN AND SCALE DRAGS stay a blit. The bitmap was painted at blitX /
         blitProbe; this frame's origin moved, so it is drawn shifted. The
         paths rebuild once, after the pointer rests. */
      let scrolled = false;
      if (
        !cached &&
        this.bmp &&
        x0 != null &&
        this.blitRev === src.rev &&
        this.bmp.width === scope.bitmapSize.width &&
        this.bmp.height === scope.bitmapSize.height &&
        this.blitHr === hr &&
        this.blitVr === vr
      ) {
        const scale = this.blitBar > 0 ? barSpacing / this.blitBar : 1;
        const dx = (Number(x0) - this.blitX) * hr;
        const dy = (probeA - this.blitProbe) * vr;
        const zoomOk = scale > 0.75 && scale < 1.35;
        if (
          zoomOk &&
          Math.abs(dx) < scope.bitmapSize.width * 0.5 &&
          Math.abs(dy) < scope.bitmapSize.height * 0.5
        ) {
          const w = this.bmp.width;
          const h = this.bmp.height;
          ctx.drawImage(this.bmp, dx, dy, w * scale, h * scale);
          scrolled = true;
          this.armSettle(src);
        }
      }

      /* BATCHED: beads are gathered into one path per ink (alpha quantised to
         ~20 steps), then each path is filled once — into the BITMAP. */
      /* one path per ink and quantised alpha, keyed inkIndex * 1000 + alphaStep (numbers: no string per bead) */
      const cores = new Map<number, Path2D>();
      const halos = new Map<number, Path2D>();
      const flipPath = new Path2D();
      let flipDrawn = false;
      const glyphs: { x: number; y: number; mark?: NodeMark; tag?: PriceTag; word?: string }[] = [];
      const dashes: { x: number; y: number; w: number }[] = [];
      /* Zoomed out, one word per node stacks into noise. Count the window instead. */
      const tight = barSpacing < 8;
      let born = 0;
      let grew = 0;
      let flipped = 0;
      let died = 0;
      let held = 0;
      let off = 0;
      let broke = 0;
      const pathFor = (map: Map<number, Path2D>, key: number) => {
        let p = map.get(key);
        if (!p) map.set(key, (p = new Path2D()));
        return p;
      };
      const yCache = new Map<number, number | null>();
      const yOf = (strike: number) => {
        let y = yCache.get(strike);
        if (y === undefined) {
          y = series.priceToCoordinate(strike);
          yCache.set(strike, y);
        }
        return y;
      };

      // ---- the beads (skipped whole when the cache holds) --------------------
      for (let ci = cached || scrolled ? last : first; ci < last; ci++) {
        const col = src.columnAt(ci);
        if (tight && !cached) {
          for (const bead of col.top) {
            if (bead.mark === 'born') born += 1;
            else if (bead.mark === 'grew') grew += 1;
            else if (bead.mark === 'flipped') flipped += 1;
            else if (bead.mark === 'died') died += 1;
            if (bead.tag === 'absorbed') held += 1;
            else if (bead.tag === 'rejected') off += 1;
            else if (bead.tag === 'broke') broke += 1;
          }
        }
        // The bead's bar, and where inside it this moment sits
        const bucket = Math.floor(col.time / barSec) * barSec;
        const slot = slots > 1 ? Math.floor(((col.time - bucket) / barSec) * slots) : 0;
        if (slot % stride !== 0) continue;
        const xBar = ts.timeToCoordinate(bucket as Time);
        if (xBar === null || xBar < -halfW || xBar > wCss + halfW) continue;
        const x = slots > 1 ? xBar - halfW + ((slot / stride + 0.5) / drawnSlots) * barSpacing : xBar;
        const cx = x * hr;
        if (col.gap) glyphs.push({ x: cx, y: 16 * vr, word: 'gap' });

        // The flip: ONE dotted blue line at TODAY'S flip — a tick per column
        // in the field's grammar, never a solid side line
        if (src.flipPrice != null) {
          const fy = series.priceToCoordinate(src.flipPrice);
          if (fy !== null) {
            /* Taller and near-continuous (Noah, 2026-08-29: "more noticable
               ... not color wise") — 90% slot coverage keeps it reading as a
               dashed rule rather than a row of crumbs. */
            const w = (barSpacing / drawnSlots) * 0.9 * hr;
            flipPath.rect(cx - w / 2, fy * vr - 1.3 * vr, w, 2.6 * vr);
            flipDrawn = true;
          }
        }

        // This moment's field, ranked at load — plus the focused strike at
        // EVERY moment, however faint (its history must have no gaps)
        let beads = (col.ordered ??= [...col.top].sort((a, b) => Number(a.front !== false) - Number(b.front !== false)));
        if (focus != null && !col.top.some(b => b.strike === focus)) {
          const fb = col.all.get(focus);
          if (fb) {
            /* where the stable sort would have put it: after the rest-of-book beads, or last */
            const back = beads.findIndex(b => b.front !== false);
            const at = fb.front === false ? (back < 0 ? beads.length : back) : beads.length;
            beads = [...beads.slice(0, at), fb, ...beads.slice(at)];
          }
        }

        for (const bead of beads) {
          const isFocus = focus != null && bead.strike === focus;
          const y = yOf(bead.strike);
          if (y === null) continue;

          // t^1.6 — the amplitude; weak strikes stay hairlines, rails swell
          const t = Math.max(isFocus ? 0.08 : 0, bead.t);
          const s = Math.pow(t, 1.6);
          const thin = bead.front === false && !isFocus ? 0.62 : 1;
          const ry = (A_MIN + s * (A_MAX - A_MIN)) * vr * thin;
          const yc = y * vr;
          // Translucent on purpose — the tape reads THROUGH the ribbon
          let core = 0.42 + s * 0.5;
          let halo = 0.03 + s * 0.06;
          /* A peak keeps its ink. Anything else stays at about a quarter, and is not deleted. */
          if (bead.missing) {
            core = 0.35;
            halo = 0;
          } else if (!bead.peak && !isFocus) {
            core = 0.25;
            halo = 0;
          }
          if (bead.front === false && !isFocus && bead.peak) {
            core *= 0.55;
            halo *= 0.45;
          }
          if (focus != null && !isFocus) {
            core *= 0.3; // the field steps back
            halo *= 0.3;
          }
          /* A thin flow net is still drawn, dashed and faded, so a sign flip stays visible without looking certain. */
          if (bead.firm === false) {
            core *= 0.35;
            halo *= 0.2;
          }
          /* Ink precedence: the focus wins, then THE SUPREME — above the walls
             (Noah, 2026-08-29: the crown is never diluted; reverses the
             2026-08-22 wall-over-supreme order, whose worry — "I don't even see
             any put wall" — is answered by the wall's chip, axis line and
             the ladder's K·PW tag), then today's walls, then the side. */
          const isSupreme = supreme != null && bead.strike === supreme;
          /* SIDE BEADS TRAVEL THE HOUSE RAMP (ember/glacier, 2026-08-29 —
             "what about the charts"): each bead's hue comes from the ramp at
             its own strength, so a band heats oxblood → fire → gold where
             the book is heavy and cools where it drains — the ladder's
             journey, on the tape. Identity beads (focus/supreme/walls) keep
             their identity inks. The color-t is floored at 0.2 so the
             faintest bead still whispers in hue instead of vanishing into
             ramp-black — the alpha already carries the fade. Quantised to 8
             bins so the batcher stays a batcher. */
          const inkKey = isFocus
            ? INK_F
            : isSupreme
              ? INK_K
              : bead.strike === src.cwStrike
                ? INK_CW
                : bead.strike === src.pwStrike
                  ? INK_PW
                  : bead.put
                    ? INK_P
                    : INK_C;

          /* Each ELLIPSE bead is its OWN subpath: ellipse() draws a line
             from the path's current point to the ellipse's start, so without
             the moveTo every bead joined the last one. HAIRLINES DRAW AS
             RECTS (2026-08-29): under ~2px of height an ellipse is invisible
             arc math — the vast majority of beads — and rect() paths cost a
             fraction. Only the swelling rails keep the round nose. */
          const y2 = bead.span ? yOf(bead.span) : null;
          const top = y2 == null ? yc - ry : Math.min(y, y2) * vr;
          const bot = y2 == null ? yc + ry : Math.max(y, y2) * vr;
          const mid = (top + bot) / 2;
          const half = Math.max(ry, (bot - top) / 2);
          const round = half > 2 * vr && !bead.missing;
          if (!bead.missing && t > 0.55 && half * 1.35 > 2.4 * vr) {
            const hx = rx * 1.15;
            const p = pathFor(halos, inkKey * 1000 + Math.round(halo * 40));
            if (round) {
              p.moveTo(cx + hx, mid);
              p.ellipse(cx, mid, hx, half * 1.9, 0, 0, Math.PI * 2);
            } else {
              p.rect(cx - hx, mid - half * 1.9, hx * 2, half * 3.8);
            }
          }
          const p = pathFor(cores, inkKey * 1000 + Math.round(core * 20));
          if (bead.missing) {
            p.rect(cx - rx * 0.7, mid - 0.6 * vr, rx * 1.4, 1.2 * vr);
          } else if (round) {
            p.moveTo(cx + rx, mid);
            p.ellipse(cx, mid, rx, half, 0, 0, Math.PI * 2);
          } else {
            p.rect(cx - rx, top, rx * 2, Math.max(1, bot - top));
          }
          if (bead.mark || bead.tag) {
            if (!tight) glyphs.push({ x: cx, y: Math.max(11 * vr, top - 2 * vr), mark: bead.mark, tag: bead.tag });
          }
          if (bead.firm === false) dashes.push({ x: cx, y: mid, w: Math.max(rx * 2, 4 * hr) });
        }
      }
      if (tight && !cached) {
        const parts: string[] = [];
        if (born) parts.push(`${born} born`);
        if (grew) parts.push(`${grew} grew`);
        if (flipped) parts.push(`${flipped} flipped`);
        if (died) parts.push(`${died} died`);
        if (held) parts.push(`${held} held`);
        if (off) parts.push(`${off} off`);
        if (broke) parts.push(`${broke} broke`);
        if (parts.length) glyphs.push({ x: 8 * hr, y: 14 * vr, word: parts.join(' · ') });
      }

      const INKS: readonly (readonly [number, number, number])[] = [ink, SUPREME_RGB, CW_RGB, PW_RGB, PUT_RGB, CALL_RGB];
      const paint = (tctx: CanvasRenderingContext2D, map: Map<number, Path2D>, step: number) => {
        for (const [key, path] of map) {
          const rgb = INKS[Math.floor(key / 1000)] ?? CALL_RGB;
          tctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${((key % 1000) / step).toFixed(3)})`;
          tctx.fill(path);
        }
      };
      if (!cached && !scrolled) {
        const bmp = this.bmp && this.bmp.width === scope.bitmapSize.width && this.bmp.height === scope.bitmapSize.height
          ? this.bmp
          : document.createElement('canvas');
        bmp.width = scope.bitmapSize.width;
        bmp.height = scope.bitmapSize.height;
        const bctx = bmp.getContext('2d');
        if (bctx) {
          paint(bctx, halos, 40);
          paint(bctx, cores, 20);
          bctx.font = `${Math.round(8 * vr)}px sans-serif`;
          bctx.fillStyle = 'rgba(237,237,237,0.9)';
          bctx.textBaseline = 'bottom';
          for (const g of glyphs) {
            const word = g.word ?? (g.mark === 'born' ? '+' : g.mark === 'grew' ? '↑' : g.mark === 'flipped' ? '↔' : g.mark === 'died' ? '×' : g.tag === 'broke' ? 'broke' : g.tag === 'absorbed' ? 'held' : g.tag === 'rejected' ? 'off' : '');
            if (!word) continue;
            bctx.textAlign = g.word && !g.mark && !g.tag ? 'left' : 'center';
            bctx.fillText(word, g.x, g.y);
          }
          if (dashes.length) {
            bctx.save();
            bctx.setLineDash([3 * hr, 2 * hr]);
            bctx.strokeStyle = 'rgba(237,237,237,0.7)';
            bctx.lineWidth = Math.max(1, vr);
            bctx.beginPath();
            for (const d of dashes) {
              bctx.moveTo(d.x - d.w / 2, d.y);
              bctx.lineTo(d.x + d.w / 2, d.y);
            }
            bctx.stroke();
            bctx.restore();
          }
          /* The regime border draws OVER the field (2026-08-29): it is the
             line the whole map hinges on, and under the beads it spent half
             its length buried in whatever band it crossed. */
          if (flipDrawn) {
            const flipOnSupreme = supreme != null && src.flipPrice != null && Math.abs(src.flipPrice - supreme) < 1e-6;
            bctx.fillStyle = flipOnSupreme ? FLIPK_RGBA : FLIP_RGBA;
            bctx.fill(flipPath);
          }
          this.bmp = bmp;
          this.cacheKey = key;
          this.blitRev = src.rev;
          this.blitX = x0 == null ? 0 : Number(x0);
          this.blitProbe = probeA;
          this.blitBar = barSpacing;
          this.blitHr = hr;
          this.blitVr = vr;
          if (this.settle) {
            cancelAnimationFrame(this.settle);
            this.settle = 0;
          }
        }
      }
      if (!scrolled && this.bmp) ctx.drawImage(this.bmp, 0, 0);

      // ---- THE HOVER, over the bitmap (never in it): the veil, the bead again at full, its ring --------------
      const hover = src.hoverOverlay ? null : src.hover;
      if (hover && hover.ci >= first && hover.ci < last) {
        const col = src.columnAt(hover.ci);
        const b = col.all.get(hover.strike);
        const bucket = Math.floor(col.time / barSec) * barSec;
        const slot = slots > 1 ? Math.floor(((col.time - bucket) / barSec) * slots) : 0;
        const xBar = ts.timeToCoordinate(bucket as Time);
        const y = yOf(hover.strike);
        if (b && xBar !== null && y !== null && slot % stride === 0) {
          /* No veil. Dimming the whole field read as a blur on the nodes.
             The bead under the pointer is drawn again, with a ring. The rest stay as they are. */
          const x = slots > 1 ? xBar - halfW + ((slot / stride + 0.5) / drawnSlots) * barSpacing : xBar;
          const cx = x * hr;
          const yc = y * vr;
          const ry = beadHalfHeight(Math.max(focus != null && b.strike === focus ? 0.08 : 0, b.t), A_MIN, A_MAX) * vr;
          /* the bead again, at its full light, in its own ink */
          const isSupreme = supreme != null && b.strike === supreme;
          const rgb = focus != null && b.strike === focus ? ink : isSupreme ? SUPREME_RGB : b.put ? PUT_RGB : CALL_RGB;
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`;
          ctx.beginPath();
          ctx.ellipse(cx, yc, rx, Math.max(ry, 1.5 * vr), 0, 0, Math.PI * 2);
          ctx.fill();
          /* the ring: 1.5 CSS px in the page's ink, just outside the bead */
          const lw = Math.max(1, Math.round(1.5 * Math.min(hr, vr)));
          const r = src.ringInk;
          ctx.lineWidth = lw;
          ctx.strokeStyle = `rgba(${r[0]},${r[1]},${r[2]},0.95)`;
          ctx.beginPath();
          ctx.ellipse(cx, yc, rx + lw, Math.max(ry, 1.5 * vr) + lw, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ---- axis-side strength labels for the heaviest strikes ---------------
      const latest = src.snapshots[src.snapshots.length - 1];
      if (!latest) return;
      // Four labels at most, read off the latest snapshot — once per snapshot and greek, not every frame
      if (this.labelsOf?.snap !== latest || this.labelsOf.greek !== src.greek) {
        const total = latest.levels.reduce((s, l) => s + Math.abs(src.valueOf(l)), 0);
        const top =
          total > 0
            ? [...latest.levels]
                .map(l => ({ strike: l.strike, value: src.valueOf(l) }))
                .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                .slice(0, 4)
                .filter(l => Math.abs(l.value) / total >= 0.08)
            : [];
        this.labelsOf = { snap: latest, greek: src.greek, total, top };
      }
      const { total, top } = this.labelsOf;
      if (total <= 0) return;

      const labelPx = src.labelPx;
      ctx.font = `${Math.round(labelPx * vr)}px "Inter", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const xRight = (wCss - 8) * hr;

      const drawLabel = (lvl: { strike: number; value: number }, color: string) => {
        const y = series.priceToCoordinate(lvl.strike);
        // Off the pane's top there is no line to name — the words go with it
        if (y === null || y < 0) return;
        const pct = Math.round((Math.abs(lvl.value) / total) * 100);
        const strikeLabel = lvl.strike % 1 === 0 ? lvl.strike.toFixed(0) : lvl.strike.toFixed(2);
        const text = `${strikeLabel} · ${pct}%`;

        // Dark backing pad so the label survives whatever sits behind it
        const w = ctx.measureText(text).width;
        /* The pad rides the type size. Fixed padding around shrinking text
           leaves the chip the same height with a smaller word rattling inside
           it — smaller type and no more room, which is the opposite of the
           point. */
        const scale = labelPx / 9.5;
        const padX = 4 * hr * scale;
        const padY = 2.5 * vr * scale;
        const boxH = 12 * vr * scale;
        /* UNDER THE HOST'S CHROME, NEVER BEHIND IT (Noah, 2026-09-14: the top
           wall's "430 · 17%" over the strip's fullscreen door): the label's box
           stops at the chrome's edge and slides down to sit under it — the line
           stays where the price is. The autoscale keeps the walls clear of the
           band by rest; this is for a tape the reader has scaled by hand. */
        let yPix = y * vr;
        const floor = src.chromeInset > 0 ? (src.chromeInset + 3) * vr : 0;
        const boxTop = yPix - boxH / 2 - padY / 2;
        if (boxTop < floor) yPix += floor - boxTop;
        ctx.fillStyle = 'rgba(5,5,5,0.72)';
        ctx.fillRect(xRight - w - padX, yPix - boxH / 2 - padY / 2, w + padX * 2, boxH + padY);
        ctx.fillStyle = color;
        ctx.fillText(text, xRight, yPix);
        src.chips.push({ strike: lvl.strike, left: (xRight - w - padX) / hr, top: (yPix - boxH / 2 - padY / 2) / vr, bottom: (yPix + boxH / 2 + padY / 2) / vr });
      };

      for (const lvl of top) {
        if (focus != null && lvl.strike === focus) continue; // drawn below, in its own ink
        const isSupreme = supreme != null && lvl.strike === supreme;
        const rgb = isSupreme ? SUPREME_RGB : lvl.value >= 0 ? PUT_RGB : CALL_RGB;
        /* The field's labels step back while a strike is focused — the SUPREME's
           never does. Lime at 0.55 is olive, not neon (the house lime rule:
           its identity IS luminance), and the crown is the one label that
           must survive every state. */
        drawLabel(lvl, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${focus != null && !isSupreme ? 0.55 : 0.95})`);
      }
      // The focused level is always labelled — its share of the book, in its ink
      if (focus != null) {
        const f = latest.levels.find(l => l.strike === focus);
        if (f) drawLabel(f, inkCss);
      }
    });
  }
}

class TrailsPaneView {
  private _renderer: TrailsPaneRenderer;
  constructor(source: GexTrailsPrimitive) {
    this._renderer = new TrailsPaneRenderer(source);
  }
  zOrder(): 'bottom' {
    return 'bottom';
  }
  renderer(): TrailsPaneRenderer {
    return this._renderer;
  }
}

/** A moment's largest |value|, remembered against the snapshot object */
/** Which exposure the beads draw — the head's Greek (2026-09-06). Gamma is the
    history's `value`; delta and vega ride beside it on every level. */
export type TrailGreek = 'gex' | 'dex' | 'vex';
const momentMax: Record<TrailGreek, WeakMap<GexSnapshot, number>> = { gex: new WeakMap(), dex: new WeakMap(), vex: new WeakMap() };
const levelValue = (l: GexSnapshot['levels'][number], greek: TrailGreek): number => (greek === 'gex' ? l.value : greek === 'dex' ? (l.dex ?? 0) : (l.vex ?? 0));

export class GexTrailsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<'Candlestick'> | null = null;
  requestUpdate?: () => void;
  snapshots: GexSnapshot[] = [];
  maxAbs = 1;
  /** Robust strength reference: high percentile of per-moment maxima. Using
      the absolute max instead lets one freak spike crush every other wall. */
  ref = 0;
  enabled = true;
  /** The chart's bar length, seconds — a bead finds its bar by it */
  barSec = 60;
  /**
   * The strike chips' type size in CSS px — 9.5 normally, smaller on a phone.
   *
   * A field rather than another `setData` argument: it is a presentation
   * setting that changes with the HOST, while setData carries the data and is
   * called on every tick. Bundling them would make a size change look like new
   * data to every reader of this class.
   */
  labelPx = 9.5;
  /** The host's floating chrome, CSS px from the pane's top to its lowest edge — the strike
      chips never paint behind it (set by the chart as it measures the strip; 0 = no chrome) */
  chromeInset = 0;
  /** The field's own clock, seconds between snapshots — beads per bar = barSec / stepSec */
  stepSec = 60;
  /** The level view's strike — its beads lead, the field steps back. */
  focusStrike: number | null = null;
  /** Its ink: lime, or magenta while the focused strike is the supreme. The
      focus never follows the supreme — the strike you clicked is the strike
      you're watching; the ink reports its standing (Noah, 2026-08-22). */
  focusInk: FocusInk = 'focus';
  /** The book's supreme strike — its band wears magenta (re-read every scan) */
  supremeStrike: number | null = null;
  /** TODAY'S levels — ONE green band, ONE red band, ONE blue flip line, all
      re-read every scan so they move with the math (Noah, 2026-08-22) */
  cwStrike: number | null = null;
  pwStrike: number | null = null;
  flipPrice: number | null = null;
  /** The strike chips drawn at the right edge THIS FRAME, media px — the key levels' ladder (keyLevelsPrimitive, drawn
      after this at `top`) ends a wall's rung at its chip and prints no figure of its own there, since the chip already
      names the strike. Empty while the field is off. */
  chips: { strike: number; left: number; top: number; bottom: number }[] = [];
  private _paneViews: TrailsPaneView[];
  /** The bead under the pointer (beadAt), drawn with its ring over the veiled field; null when the pointer is off */
  hover: BeadHit | null = null;
  /** The ring's ink — the page's lead ink on the chart's ground (white on the black tape; the host sets a light tape's) */
  ringInk: readonly [number, number, number] = [255, 255, 255];
  /** Told after every data hand-off, with the size reference the beads stand against — the host's legend line */
  onData?: (ref: number) => void;
  private groundCache: { css: string; rgb: readonly [number, number, number] } | null = null;

  constructor() {
    this._paneViews = [new TrailsPaneView(this)];
  }

  setHover(hit: BeadHit | null): void {
    const was = this.hover;
    if (was === hit || (was && hit && was.strike === hit.strike && was.time === hit.time)) {
      this.hover = hit;
      return;
    }
    this.hover = hit;
    if (this.hoverOverlay) this.afterDraw?.();
    else this.requestUpdate?.();
  }

  setRingInk(rgb: readonly [number, number, number]): void {
    if (this.ringInk[0] === rgb[0] && this.ringInk[1] === rgb[1] && this.ringInk[2] === rgb[2]) return;
    this.ringInk = rgb;
    if (this.hover) {
      if (this.hoverOverlay) this.afterDraw?.();
      else this.requestUpdate?.();
    }
  }

  /*
    THE HOVER ON ITS OWN CANVAS. Drawn into the pane, a new bead under the pointer asked the chart for a full repaint —
    candles, volume and every layer — several times a second on a sweep. With `hoverOverlay` set the host draws the
    bead and its ring on a canvas over the pane from `hoverShape()` (on every hover change and after every pane draw,
    `afterDraw`), and the pane is left alone. The geometry is the renderer's own.
  */
  hoverOverlay = false;
  afterDraw: (() => void) | null = null;
  hoverShape(): { x: number; y: number; rx: number; ry: number; fill: string; ring: string } | null {
    const hover = this.hover;
    if (!hover || !this.enabled || !this.chart || !this.series || hover.ci < 0 || hover.ci >= this.snapshots.length) return null;
    const ts = this.chart.timeScale();
    const barSpacing = ts.options().barSpacing ?? 6;
    const barSec = this.barSec;
    const slots = Math.max(1, Math.round(barSec / Math.max(1, this.stepSec)));
    const stride = Math.max(1, Math.ceil(3 / (barSpacing / slots)));
    const drawnSlots = Math.max(1, Math.ceil(slots / stride));
    const col = this.columnAt(hover.ci);
    const b = col.all.get(hover.strike);
    const bucket = Math.floor(col.time / barSec) * barSec;
    const slot = slots > 1 ? Math.floor(((col.time - bucket) / barSec) * slots) : 0;
    const xBar = ts.timeToCoordinate(bucket as Time);
    const y = this.series.priceToCoordinate(hover.strike);
    if (!b || xBar === null || y === null || slot % stride !== 0) return null;
    const x = slots > 1 ? xBar - barSpacing * 0.5 + ((slot / stride + 0.5) / drawnSlots) * barSpacing : xBar;
    const focus = this.focusStrike;
    const aMax = Math.max(3, Math.min(barSpacing * 0.6, 9));
    const ry = beadHalfHeight(Math.max(focus != null && b.strike === focus ? 0.08 : 0, b.t), 0.45, aMax);
    const isSupreme = this.supremeStrike != null && b.strike === this.supremeStrike;
    const rgb = focus != null && b.strike === focus ? INK_RGB[this.focusInk] : isSupreme ? SUPREME_RGB : b.put ? PUT_RGB : CALL_RGB;
    const r = this.ringInk;
    return { x, y, rx: (barSpacing / drawnSlots) * 0.54, ry: Math.max(ry, 1.5), fill: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`, ring: `rgba(${r[0]},${r[1]},${r[2]},0.95)` };
  }

  /** The chart's ground, as channels — read off its options and kept until the option's string changes */
  groundRgb(): readonly [number, number, number] {
    const bg = this.chart?.options().layout.background as { color?: string; topColor?: string } | undefined;
    const css = bg?.color ?? bg?.topColor ?? '#0a0a0a';
    if (!this.groundCache || this.groundCache.css !== css) this.groundCache = { css, rgb: rgbOf(css) };
    return this.groundCache.rgb;
  }

  /**
   * The bead under a point on the pane (CSS px), or null: the drawn column whose slot holds x (the same slots and stride
   * the renderer placed this frame) and, in it, the drawn strike nearest y within the bead's own height and a little
   * more — a hairline is a few pixels' reach, a swelling rail its own. Read by the chart's hover ring, its card and its
   * click.
   */
  beadAt(x: number, y: number): BeadHit | null {
    if (!this.enabled || !this.chart || !this.series || !this.snapshots.length || this.ref <= 0) return null;
    /* a bead under the host's chrome is behind the strip — nothing to point at there */
    if (y < this.chromeInset) return null;
    const ts = this.chart.timeScale();
    const series = this.series;
    const t = ts.coordinateToTime(x);
    if (t == null) return null;
    const barSec = this.barSec;
    const barSpacing = ts.options().barSpacing ?? 6;
    const slots = Math.max(1, Math.round(barSec / Math.max(1, this.stepSec)));
    const stride = Math.max(1, Math.ceil(3 / (barSpacing / slots)));
    const drawnSlots = Math.max(1, Math.ceil(slots / stride));
    const rx = (barSpacing / drawnSlots) * 0.54;
    const halfW = barSpacing * 0.5;
    const aMin = 0.45;
    const aMax = Math.max(3, Math.min(barSpacing * 0.6, 9));
    const bucket = Math.floor(Number(t) / barSec) * barSec;
    /* the columns of this bar and its neighbours — a bead's width reaches past its bar's edge when the slots are few */
    const snaps = this.snapshots;
    let lo = 0;
    let hi = snaps.length;
    const from = bucket - barSec;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (snaps[m].time < from) lo = m + 1;
      else hi = m;
    }
    const focus = this.focusStrike;
    let best: { bead: Bead; ci: number; cx: number; cy: number; ry: number } | null = null;
    let bestD = Infinity;
    for (let ci = lo; ci < snaps.length && snaps[ci].time < bucket + 2 * barSec; ci++) {
      const col = this.columnAt(ci);
      const cb = Math.floor(col.time / barSec) * barSec;
      const slot = slots > 1 ? Math.floor(((col.time - cb) / barSec) * slots) : 0;
      if (slot % stride !== 0) continue;
      const xBar = ts.timeToCoordinate(cb as Time);
      if (xBar === null) continue;
      const cx = slots > 1 ? xBar - halfW + ((slot / stride + 0.5) / drawnSlots) * barSpacing : xBar;
      if (Math.abs(cx - x) > rx + 0.5) continue;
      let beads = col.top;
      if (focus != null && !beads.some(b => b.strike === focus)) {
        const fb = col.all.get(focus);
        if (fb) beads = [...beads, fb];
      }
      for (const bead of beads) {
        const by = series.priceToCoordinate(bead.strike);
        if (by === null) continue;
        const ry = beadHalfHeight(Math.max(focus != null && bead.strike === focus ? 0.08 : 0, bead.t), aMin, aMax);
        const d = Math.abs(by - y);
        if (d <= Math.max(ry, 3) + 1.5 && d < bestD) {
          bestD = d;
          best = { bead, ci, cx, cy: by, ry };
        }
      }
    }
    if (!best) return null;
    const snap = snaps[best.ci];
    const lvl = snap.levels.find(l => l.strike === best!.bead.strike);
    if (!lvl) return null;
    const value = this.valueOf(lvl);
    let total = 0;
    for (const l of snap.levels) total += Math.abs(this.valueOf(l));
    return { strike: best.bead.strike, time: snap.time, ci: best.ci, value, share: total > 0 ? Math.abs(value) / total : 0, open: this.openValue(best.ci, best.bead.strike), put: best.bead.put, t: best.bead.t, mark: best.bead.mark, tag: best.bead.tag, firm: best.bead.firm, x: best.cx, y: best.cy, rx, ry: best.ry };
  }

  /** The strike's value at its day's first column on or after the New York open — null where the field holds none */
  openValue(ci: number, strike: number): number | null {
    const snaps = this.snapshots;
    const at = snaps[ci];
    if (!at) return null;
    const open = nySession(at.time * 1000).open / 1000;
    if (at.time < open) return null;
    let lo = 0;
    let hi = ci + 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (snaps[m].time < open) lo = m + 1;
      else hi = m;
    }
    const first = snaps[lo];
    if (!first || first.time > at.time) return null;
    const l = first.levels.find(x => x.strike === strike);
    return l ? this.valueOf(l) : null;
  }

  /** The strike's standing at a column: its rank by size among the column's strikes, of how many */
  rankAt(ci: number, strike: number): { rank: number; of: number } | null {
    const snap = this.snapshots[ci];
    if (!snap) return null;
    const v = snap.levels.find(l => l.strike === strike);
    if (!v) return null;
    const a = Math.abs(this.valueOf(v));
    let rank = 1;
    for (const l of snap.levels) if (Math.abs(this.valueOf(l)) > a) rank++;
    return { rank, of: snap.levels.length };
  }

  /** The strike's value `seconds` before a column, from the nearest column at or before that moment — null off the field */
  valueBefore(ci: number, strike: number, seconds: number): { value: number; time: number } | null {
    const snaps = this.snapshots;
    const at = snaps[ci];
    if (!at) return null;
    const want = at.time - seconds;
    let i = ci;
    while (i > 0 && snaps[i].time > want) i--;
    const col = snaps[i];
    if (!col || col.time > want + this.stepSec) return null;
    const l = col.levels.find(x => x.strike === strike);
    return l ? { value: this.valueOf(l), time: col.time } : null;
  }

  setSupreme(strike: number | null): void {
    if (this.supremeStrike === strike) return;
    this.supremeStrike = strike;
    this.requestUpdate?.();
  }

  setWalls(cw: number | null, pw: number | null, flip: number | null): void {
    if (this.cwStrike === cw && this.pwStrike === pw && this.flipPrice === flip) return;
    this.cwStrike = cw;
    this.pwStrike = pw;
    this.flipPrice = flip;
    this.requestUpdate?.();
  }

  setFocus(strike: number | null, ink: FocusInk = 'focus'): void {
    if (this.focusStrike === strike && this.focusInk === ink) return;
    this.focusStrike = strike;
    this.focusInk = ink;
    this.requestUpdate?.();
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
  }

  updateAllViews(): void {}

  paneViews(): TrailsPaneView[] {
    return this._paneViews;
  }

  /** Bumped on every data hand-off — the renderer's path cache keys on it. */
  rev = 0;
  /** Built columns by snapshot identity — see setData's incremental note. */
  private colCache = new WeakMap<GexSnapshot, { time: number; top: Bead[]; all: Map<number, Bead>; back?: GexSnapshot; gap?: boolean; ordered?: Bead[] }>();
  private colRef = -1;

  /** The Greek the beads draw — see TrailGreek */
  greek: TrailGreek = 'gex';
  private colGreek: TrailGreek = 'gex';
  valueOf(l: GexSnapshot['levels'][number]): number {
    return levelValue(l, this.greek);
  }

  /** The 85th percentile of this session's column maxima. It only rises.
      Same-day expiry and the rest of the book each keep their own, so a
      0DTE pin does not resize the monthly shelf. It resets on a new session, not when a larger node prints. */
  private ratchet = 0;
  private restRatchet = 0;
  private scaleDay = '';
  private wasSplit = false;
  private behindAt = new Map<number, GexSnapshot>();
  private glyph = new Map<string, { mark?: NodeMark; tag?: PriceTag }>();
  restRef = 0;
  private colRest = -1;

  setData(snapshots: GexSnapshot[], maxAbs: number, enabled: boolean, barSec = 60, greek: TrailGreek = 'gex', _scaleTo = 0, behind: GexSnapshot[] = [], prices: readonly { time: number; close: number }[] = []): void {
    this.rev++;
    const lastPx = prices.length ? prices[prices.length - 1].time : Infinity;
    const clip = (rows: GexSnapshot[]) => rows.filter(s => s.time <= lastPx);
    snapshots = clip(snapshots);
    behind = clip(behind);
    this.snapshots = snapshots;
    this.behindAt = new Map(behind.map(s => [s.time, s]));
    this.maxAbs = maxAbs;
    this.barSec = barSec;
    const anchor = snapshots[0]?.time ?? behind[0]?.time ?? 0;
    const day = anchor ? nyIsoDate(anchor * 1000) : '';
    const split = behind.length > 0;
    if (day !== this.scaleDay || greek !== this.greek || split !== this.wasSplit) {
      this.ratchet = 0;
      this.restRatchet = 0;
      this.scaleDay = day;
      this.wasSplit = split;
    }
    this.greek = greek;
    let step = Infinity;
    const span = snapshots.length ? snapshots : behind;
    for (let i = 1; i < span.length; i++) {
      const d = span[i].time - span[i - 1].time;
      if (d > 0 && d < step) step = d;
    }
    this.stepSec = Number.isFinite(step) ? step : barSec;
    this.glyph = this.glyphsOf(snapshots, prices);
    const p85 = (rows: GexSnapshot[]) => {
      const maxima: number[] = [];
      const memo = momentMax[greek];
      for (const s of rows) {
        let m = memo.get(s);
        if (m === undefined) {
          m = 0;
          for (const l of s.levels) {
            const a = Math.abs(levelValue(l, greek));
            if (a > m) m = a;
          }
          memo.set(s, m);
        }
        if (m > 0) maxima.push(m);
      }
      maxima.sort((a, b) => a - b);
      return maxima.length ? maxima[Math.min(maxima.length - 1, Math.floor(maxima.length * 0.85))] : 0;
    };
    this.ratchet = Math.max(this.ratchet, p85(snapshots));
    this.restRatchet = Math.max(this.restRatchet, behind.length ? p85(behind) : 0);
    this.ref = this.ratchet;
    this.restRef = this.restRatchet;
    const ref = this.ref;
    const rest = this.restRef;
    if (ref !== this.colRef || rest !== this.colRest || greek !== this.colGreek) {
      this.colCache = new WeakMap();
      this.colRef = ref;
      this.colRest = rest;
      this.colGreek = greek;
    }
    this.enabled = enabled;
    this.requestUpdate?.();
    this.onData?.(enabled ? this.ref : 0);
  }

  /** Born, grew, flipped, and died, plus the ten-minute price tag. One pass over the book the chart is drawing. */
  private glyphsOf(snapshots: readonly GexSnapshot[], prices: readonly { time: number; close: number }[]): Map<string, { mark?: NodeMark; tag?: PriceTag }> {
    const out = new Map<string, { mark?: NodeMark; tag?: PriceTag }>();
    const seen = new Map<number, { v: number; peak: boolean; time: number; floor: number; firm: boolean }[]>();
    for (const s of snapshots) {
      const rows = s.levels.map(l => ({ strike: l.strike, value: this.valueOf(l), firm: l.firm !== false })).filter(r => r.value !== 0);
      const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0);
      const floor = max * 0.2;
      const peaks = new Set(peakStrikes(rows));
      const by = new Map(rows.map(r => [r.strike, r]));
      const strikes = new Set<number>([...seen.keys(), ...by.keys()]);
      for (const strike of strikes) {
        const row = by.get(strike);
        const v = row?.value ?? 0;
        const list = seen.get(strike) ?? [];
        list.push({ v, peak: v !== 0 && peaks.has(strike) && Math.abs(v) >= floor, time: s.time, floor, firm: row?.firm !== false });
        seen.set(strike, list);
      }
    }
    for (const [strike, list] of seen) {
      for (let i = 1; i < list.length; i++) {
        /* nodeMark reads the last five buckets only; handing it the whole prefix made this quadratic in the session */
        const mark = nodeMark(list.slice(Math.max(0, i - 4), i + 1), list[i].floor);
        if (!mark) continue;
        if (!list[i].firm && mark !== 'died') continue;
        out.set(`${list[i].time}|${strike}`, { mark });
      }
    }
    if (prices.length) {
      /* the closes in [t, t + 600], by bisection when the bars are in order (they are: the series' own) */
      let ordered = true;
      for (let k = 1; k < prices.length && ordered; k++) ordered = prices[k].time >= prices[k - 1].time;
      const windowFrom = (t: number): number[] => {
        if (!ordered) return prices.filter(px => px.time >= t && px.time <= t + 600).map(px => px.close);
        let lo = 0;
        let hi = prices.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (prices[mid].time < t) lo = mid + 1;
          else hi = mid;
        }
        const out: number[] = [];
        for (let k = lo; k < prices.length && prices[k].time <= t + 600; k++) out.push(prices[k].close);
        return out;
      };
      for (const [strike, list] of seen) {
        for (const p of list) {
          if (!p.peak) continue;
          const path = windowFrom(p.time);
          const tag = priceTag(strike, path);
          if (!tag) continue;
          const key = `${p.time}|${strike}`;
          const prev = out.get(key);
          out.set(key, { mark: prev?.mark, tag });
        }
      }
    }
    return out;
  }

  /** The column for snapshot i — built the first time it is on screen, then
      cached against the snapshot's identity (see setData's note). */
  columnAt(i: number): Column {
    const snap = this.snapshots[i];
    const back = snap ? this.behindAt.get(snap.time) : undefined;
    const cached = snap ? this.colCache.get(snap) : undefined;
    if (cached && cached.back === back) return cached;
    const all = new Map<number, Bead>();
    const drawn: Bead[] = [];
    const take = (rowsSnap: GexSnapshot | undefined, scale: number, front: boolean) => {
      if (!rowsSnap || !(scale > 0)) return;
      const rows = rowsSnap.levels
        .map(l => ({ strike: l.strike, v: this.valueOf(l), firm: l.firm !== false }))
        .filter(r => r.v !== 0)
        .sort((a, b) => a.strike - b.strike);
      let step = Infinity;
      for (let k = 1; k < rows.length; k++) {
        const d = rows[k].strike - rows[k - 1].strike;
        if (d > 0 && d < step) step = d;
      }
      if (!Number.isFinite(step)) step = 1;
      const floor = rows.reduce((m, r) => Math.max(m, Math.abs(r.v)), 0) * 0.2;
      for (let j = 0; j < rows.length; j++) {
        const n = rows[j];
        const a = Math.abs(n.v);
        const near = (o?: { strike: number; v: number }) =>
          !!o && Math.abs(o.strike - n.strike) <= step * 1.01 && Math.sign(o.v) === Math.sign(n.v) && o.v !== 0;
        const left = rows[j - 1];
        const right = rows[j + 1];
        const L = near(left) ? Math.abs(left.v) : -Infinity;
        const R = near(right) ? Math.abs(right.v) : -Infinity;
        const peak = a >= floor && a >= L && a >= R;
        const span = peak && near(right) && a === Math.abs(right.v) ? right.strike : undefined;
        const folded = near(left) && a === Math.abs(left.v) && Math.abs(left.v) >= floor && Math.abs(left.v) >= (near(rows[j - 2]) ? Math.abs(rows[j - 2].v) : -Infinity);
        const t = Math.min(1, a / scale);
        const note = front ? this.glyph.get(`${rowsSnap.time}|${n.strike}`) : undefined;
        const bead: Bead = { strike: n.strike, t, put: n.v >= 0, peak, front, span, mark: note?.mark, tag: note?.tag, firm: n.firm };
        if (front || !all.has(n.strike)) all.set(n.strike, bead);
        if (folded) continue;
        drawn.push(bead);
      }
      if (front && this.snapshots.length) {
        const prev = this.snapshots[this.snapshots.indexOf(rowsSnap) - 1];
        const prevRows = prev?.levels.map(l => ({ strike: l.strike, v: this.valueOf(l) })).filter(r => r.v !== 0) ?? [];
        const prevMax = prevRows.reduce((m, r) => Math.max(m, Math.abs(r.v)), 0);
        const have = new Set(rows.map(r => r.strike));
        for (const p of prevRows) {
          if (have.has(p.strike) || Math.abs(p.v) < prevMax * 0.2) continue;
          const bead: Bead = { strike: p.strike, t: 0, put: p.v >= 0, peak: false, front, missing: true };
          if (!all.has(p.strike)) all.set(p.strike, bead);
          drawn.push(bead);
        }
      }
    };
    take(back, this.restRef, false);
    take(snap, this.ref || 1, true);
    const top = drawn.sort((a, b) => b.t - a.t);
    const prev = this.snapshots[i - 1];
    const gap = !!snap && !!prev && snap.time - prev.time > this.stepSec * 1.5;
    const col = { time: snap?.time ?? back?.time ?? 0, top, all, back, gap };
    if (snap) this.colCache.set(snap, col);
    return col;
  }
}
