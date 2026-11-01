/* THE AUTO LEVELS the standard desks ship as built-in indicators, as plain maths over the chart's own bars:
   Pivot Points Standard (six formulas, on the day / week / month / quarter / year before), Pivot Points High Low, the
   Zig Zag, Auto Fib Retracement and Extension and the Auto Pitchfork (all three on the zig zag's last legs). Drawn by components/gex/tvLevelsPrimitive.ts; hand-checked in scripts/tv-levels-proof.ts.

   Periods are the session module's: an intraday bar belongs to its trading day (core/session tradingDayOf — the
   overnight joins the morning it opens into), a week starts on that day's Monday, a month / quarter / year is that
   day's. "Regular hours only" builds the previous period's high, low and close from the regular-session bars alone
   — the nearest the chart's own bars come to the day bars the standard desks build pivots from. */

import { phaseAt, tradingDayOf, nyWall, addDays } from '../core/session';

export interface LevelBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/* ---- Pivot Points Standard ------------------------------------------------------------------------------------- */

export const PIVOT_KINDS = ['Traditional', 'Fibonacci', 'Woodie', 'Classic', 'DM', 'Camarilla'] as const;
export type PivotKind = (typeof PIVOT_KINDS)[number];
export const PIVOT_TFS = ['Auto', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
export type PivotTf = (typeof PIVOT_TFS)[number];

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Level {
  name: string;
  price: number;
}

/** The levels from the previous period's bar (and the current period's open, which Woodie reads) */
export function pivotLevels(kind: PivotKind, prev: Ohlc, currOpen: number): Level[] {
  const { open: po, high: h, low: l, close: c } = prev;
  const r = h - l;
  const L = (name: string, price: number): Level => ({ name, price });
  switch (kind) {
    case 'Traditional': {
      const p = (h + l + c) / 3;
      return [
        L('P', p),
        L('R1', p * 2 - l), L('S1', p * 2 - h),
        L('R2', p + r), L('S2', p - r),
        L('R3', p * 2 + (h - 2 * l)), L('S3', p * 2 - (2 * h - l)),
        L('R4', p * 3 + (h - 3 * l)), L('S4', p * 3 - (3 * h - l)),
        L('R5', p * 4 + (h - 4 * l)), L('S5', p * 4 - (4 * h - l)),
      ];
    }
    case 'Fibonacci': {
      const p = (h + l + c) / 3;
      return [L('P', p), L('R1', p + 0.382 * r), L('S1', p - 0.382 * r), L('R2', p + 0.618 * r), L('S2', p - 0.618 * r), L('R3', p + r), L('S3', p - r)];
    }
    case 'Woodie': {
      const p = (h + l + 2 * currOpen) / 4;
      const r3 = h + 2 * (p - l);
      const s3 = l - 2 * (h - p);
      return [L('P', p), L('R1', 2 * p - l), L('S1', 2 * p - h), L('R2', p + r), L('S2', p - r), L('R3', r3), L('S3', s3), L('R4', r3 + r), L('S4', s3 - r)];
    }
    case 'Classic': {
      const p = (h + l + c) / 3;
      return [L('P', p), L('R1', 2 * p - l), L('S1', 2 * p - h), L('R2', p + r), L('S2', p - r), L('R3', p + 2 * r), L('S3', p - 2 * r), L('R4', p + 3 * r), L('S4', p - 3 * r)];
    }
    case 'DM': {
      const x = po === c ? h + l + 2 * c : c > po ? 2 * h + l + c : 2 * l + h + c;
      return [L('P', x / 4), L('R1', x / 2 - l), L('S1', x / 2 - h)];
    }
    case 'Camarilla': {
      const p = (h + l + c) / 3;
      const r5 = (h / l) * c;
      return [
        L('P', p),
        L('R1', c + (1.1 * r) / 12), L('S1', c - (1.1 * r) / 12),
        L('R2', c + (1.1 * r) / 6), L('S2', c - (1.1 * r) / 6),
        L('R3', c + (1.1 * r) / 4), L('S3', c - (1.1 * r) / 4),
        L('R4', c + (1.1 * r) / 2), L('S4', c - (1.1 * r) / 2),
        L('R5', r5), L('S5', c - (r5 - c)),
      ];
    }
  }
}

/** Auto: the day under charts up to 15 minutes, the week up to the day, the month from the day up */
export function resolvePivotTf(tf: PivotTf, barMinutes: number): Exclude<PivotTf, 'Auto'> {
  if (tf !== 'Auto') return tf;
  return barMinutes <= 15 ? 'Daily' : barMinutes < 1440 ? 'Weekly' : 'Monthly';
}

/** The trading day a bar belongs to (the session module's), its New York date when the tape is shut */
export const sessionDayOf = (timeSec: number): string => tradingDayOf(timeSec * 1000) ?? nyWall(timeSec * 1000).iso;

/** The period a bar belongs to, as a sortable key */
export function periodKey(timeSec: number, tf: Exclude<PivotTf, 'Auto'>): string {
  const day = sessionDayOf(timeSec);
  if (tf === 'Daily') return day;
  if (tf === 'Weekly') {
    const [y, m, d] = day.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(day, -((wd + 6) % 7));
  }
  if (tf === 'Monthly') return day.slice(0, 7);
  if (tf === 'Quarterly') return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
  return day.slice(0, 4);
}

export interface PivotPeriod {
  key: string;
  /** First and last bar times of the period on the chart */
  from: number;
  to: number;
  levels: Level[];
  /** The period still printing — its lines run on to the right edge */
  live: boolean;
}

/** Pivot periods over the bars: the levels each period inherits from the one before it, the last `back` of them */
export function pivotPeriods(bars: readonly LevelBar[], o: { kind: PivotKind; tf: PivotTf; barMinutes: number; back: number; regularOnly: boolean }): PivotPeriod[] {
  const tf = resolvePivotTf(o.tf, o.barMinutes);
  const intraday = o.barMinutes < 1440;
  const groups: { key: string; from: number; to: number; ohlc: Ohlc | null }[] = [];
  for (const b of bars) {
    const key = periodKey(b.time, tf);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, from: b.time, to: b.time, ohlc: null };
      groups.push(g);
    }
    g.to = b.time;
    if (intraday && o.regularOnly && phaseAt(b.time * 1000) !== 'regular') continue;
    if (!g.ohlc) g.ohlc = { open: b.open, high: b.high, low: b.low, close: b.close };
    else {
      g.ohlc.high = Math.max(g.ohlc.high, b.high);
      g.ohlc.low = Math.min(g.ohlc.low, b.low);
      g.ohlc.close = b.close;
    }
  }
  const out: PivotPeriod[] = [];
  for (let k = 1; k < groups.length; k++) {
    const prev = groups[k - 1].ohlc;
    const cur = groups[k];
    if (!prev) continue;
    const open = cur.ohlc?.open ?? bars.find(b => b.time >= cur.from)?.open ?? prev.close;
    out.push({ key: cur.key, from: cur.from, to: cur.to, levels: pivotLevels(o.kind, prev, open), live: k === groups.length - 1 });
  }
  return out.slice(-Math.max(1, Math.round(o.back)));
}

/* ---- pivots, the zig zag and what is built on it ------------------------------------------------------------- */

export interface Swing {
  i: number;
  time: number;
  price: number;
  high: boolean;
}

/** A swing high: above every high `left` bars back, at least as high as each of the `right` bars after (the zig zag's
    rule); `strict` makes the right side strictly lower too. Lows mirror it. */
export function swings(bars: readonly LevelBar[], left: number, right: number, high: boolean, strict = false): Swing[] {
  const out: Swing[] = [];
  const L = Math.max(1, Math.round(left));
  const R = Math.max(1, Math.round(right));
  for (let i = L; i < bars.length - R; i++) {
    const v = high ? bars[i].high : bars[i].low;
    let ok = true;
    for (let j = i - L; j < i && ok; j++) ok = high ? v > bars[j].high : v < bars[j].low;
    for (let j = i + 1; j <= i + R && ok; j++) ok = high ? (strict ? v > bars[j].high : v >= bars[j].high) : strict ? v < bars[j].low : v <= bars[j].low;
    if (ok) out.push({ i, time: bars[i].time, price: v, high });
  }
  return out;
}

export interface ZigPoint extends Swing {
  /** Volume traded from the bar after the previous point through this one */
  volume: number;
  /** Price change from the previous point (NaN on the first) */
  change: number;
}

/** Wilder's ATR, as the runtime's ta.atr draws it */
export function atrSeries(bars: readonly LevelBar[], len: number): number[] {
  const out: number[] = [];
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close));
    if (i < len) {
      sum += tr;
      prev = i === len - 1 ? sum / len : NaN;
    } else prev = (prev * (len - 1) + tr) / len;
    out.push(prev);
  }
  return out;
}

/**
 * The zig zag: swings `floor(legs / 2)` bars each side, taken in order. An opposite swing that moved at least the
 * deviation (percent of the last point's price) from the last point starts a new leg; a same-side swing past the last
 * point replaces it; anything else is ignored. `dev` may be a number or, for the auto Fib tools, a percent per bar
 * (read at the bar that confirms the swing).
 */
export function zigzag(bars: readonly LevelBar[], dev: number | ((i: number) => number), legs: number): ZigPoint[] {
  const half = Math.max(1, Math.floor(legs / 2));
  const all = [...swings(bars, half, half, true), ...swings(bars, half, half, false)].sort((a, b) => a.i - b.i || (a.high ? -1 : 1));
  const pts: ZigPoint[] = [];
  const devAt = (i: number) => (typeof dev === 'number' ? dev : dev(Math.min(bars.length - 1, i + half)));
  for (const s of all) {
    const last = pts[pts.length - 1];
    if (!last) {
      pts.push({ ...s, volume: 0, change: NaN });
      continue;
    }
    if (s.high === last.high) {
      if (s.high ? s.price > last.price : s.price < last.price) pts[pts.length - 1] = { ...s, volume: last.volume, change: last.change };
      continue;
    }
    const d = devAt(s.i);
    if (Number.isFinite(d) && (Math.abs(s.price - last.price) / Math.abs(last.price)) * 100 >= d) pts.push({ ...s, volume: 0, change: NaN });
  }
  /* the volume and change of each leg, once the points are settled */
  for (let k = 1; k < pts.length; k++) {
    let v = 0;
    for (let i = pts[k - 1].i + 1; i <= pts[k].i; i++) v += bars[i].volume;
    pts[k].volume = v;
    pts[k].change = pts[k].price - pts[k - 1].price;
  }
  return pts;
}

/** The live leg past the last confirmed point: to the furthest extreme the other way since (the dashed run to the last bar) */
export function zigzagTail(bars: readonly LevelBar[], pts: readonly ZigPoint[]): Swing | null {
  const last = pts[pts.length - 1];
  if (!last || last.i >= bars.length - 1) return null;
  let best: Swing | null = null;
  for (let i = last.i + 1; i < bars.length; i++) {
    const v = last.high ? bars[i].low : bars[i].high;
    if (!best || (last.high ? v < best.price : v > best.price)) best = { i, time: bars[i].time, price: v, high: !last.high };
  }
  return best;
}

/** The auto Fib tools' zig zag: the deviation is the 10-bar ATR as a percent of the close, times the multiplier */
export function autoZigzag(bars: readonly LevelBar[], mult: number, depth: number): ZigPoint[] {
  const atr = atrSeries(bars, 10);
  return zigzag(bars, i => (atr[i] / bars[i].close) * 100 * mult, depth);
}

export const FIB_RETRACE_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236] as const;
export const FIB_EXT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236] as const;

export interface FibSet {
  /** The anchors, in time order */
  anchors: Swing[];
  levels: { level: number; price: number }[];
  /** The bar the levels start from */
  fromI: number;
  fromTime: number;
}

/** Retracement over the last leg: 0 at its end, 1 at its start (reversed: the other way round) */
export function autoFibRetracement(pts: readonly ZigPoint[], levels: readonly number[], reverse = false): FibSet | null {
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const start = reverse ? b.price : a.price;
  const end = reverse ? a.price : b.price;
  return { anchors: [a, b], levels: levels.map(l => ({ level: l, price: end + (start - end) * l })), fromI: a.i, fromTime: a.time };
}

/** Extension over the last three points A, B, C: from C, the A→B move times each level */
export function autoFibExtension(pts: readonly ZigPoint[], levels: readonly number[], reverse = false): FibSet | null {
  if (pts.length < 3) return null;
  const [a, b, c] = pts.slice(-3);
  const move = (b.price - a.price) * (reverse ? -1 : 1);
  return { anchors: [a, b, c], levels: levels.map(l => ({ level: l, price: c.price + move * l })), fromI: c.i, fromTime: c.time };
}

export const PITCHFORK_KINDS = ['Original', 'Schiff', 'Modified Schiff'] as const;
export type PitchforkKind = (typeof PITCHFORK_KINDS)[number];

export interface Pitchfork {
  anchors: [Swing, Swing, Swing];
  /** The median's origin, in (bar index, price) */
  origin: { i: number; price: number };
  /** The midpoint of the second and third anchors — the median runs through it */
  mid: { i: number; price: number };
  /** Price per bar along the median and every parallel */
  slope: number;
}

/** The fork over the last three points: Original from the first anchor; Schiff from halfway up to the second; Modified
    Schiff from the midpoint of the first two */
export function autoPitchfork(pts: readonly ZigPoint[], kind: PitchforkKind): Pitchfork | null {
  if (pts.length < 3) return null;
  const [a, b, c] = pts.slice(-3) as [ZigPoint, ZigPoint, ZigPoint];
  const mid = { i: (b.i + c.i) / 2, price: (b.price + c.price) / 2 };
  const origin = kind === 'Original' ? { i: a.i, price: a.price } : kind === 'Schiff' ? { i: a.i, price: (a.price + b.price) / 2 } : { i: (a.i + b.i) / 2, price: (a.price + b.price) / 2 };
  const dx = mid.i - origin.i;
  if (!(dx > 0)) return null;
  return { anchors: [a, b, c], origin, mid, slope: (mid.price - origin.price) / dx };
}

/** A parallel's price at bar `i`: the median shifted by `level` of the way to the line through the second anchor
    (positive) or the third (negative), as the standard fork's levels are */
export function forkAt(f: Pitchfork, i: number, level: number): number {
  const median = f.origin.price + f.slope * (i - f.origin.i);
  const [, b] = f.anchors;
  const offset = b.price - (f.origin.price + f.slope * (b.i - f.origin.i));
  return median + offset * level;
}
