/*
  Timeframe aggregation — rolls the simulator's 1-minute base bars (and the
  parallel GEX snapshots) up to the selected interval. Both keep bar-aligned,
  matching timestamps so the on-chart node overlay stays pinned to price/time.
*/

import type { Candle, GexSnapshot } from '../types/market';
import { nyParts, nyTradingDay, nyWallTime } from '../core/nyTime';
import { sessionCloseMinOn } from '../core/calendar';

export type Timeframe =
  | '15s'
  | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m' | '45m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1D' | '3D' | '1W' | '1M' | '3M' | '6M' | '1Y';

export type TfGroup = 'minute' | 'hour' | 'day';

/*
  The interval menu is minutes, then hours, then date frames. 15s stays in the
  type because a saved pane can still be on it. It is not a row in the menu:
  the feed's finest stored bar is a quarter-minute, and the menu is the list
  a chart is asked to offer.
*/
export const TIMEFRAMES: { value: Timeframe; label: string; minutes: number; menu?: string; group?: TfGroup }[] = [
  { value: '15s', label: '15s', minutes: 0.25 },
  { value: '1m', label: '1m', minutes: 1, menu: '1 minute', group: 'minute' },
  { value: '2m', label: '2m', minutes: 2, menu: '2 minutes', group: 'minute' },
  { value: '3m', label: '3m', minutes: 3, menu: '3 minutes', group: 'minute' },
  { value: '5m', label: '5m', minutes: 5, menu: '5 minutes', group: 'minute' },
  { value: '10m', label: '10m', minutes: 10, menu: '10 minutes', group: 'minute' },
  { value: '15m', label: '15m', minutes: 15, menu: '15 minutes', group: 'minute' },
  { value: '30m', label: '30m', minutes: 30, menu: '30 minutes', group: 'minute' },
  { value: '45m', label: '45m', minutes: 45, menu: '45 minutes', group: 'minute' },
  { value: '1h', label: '1h', minutes: 60, menu: '1 hour', group: 'hour' },
  { value: '2h', label: '2h', minutes: 120, menu: '2 hours', group: 'hour' },
  { value: '4h', label: '4h', minutes: 240, menu: '4 hours', group: 'hour' },
  { value: '6h', label: '6h', minutes: 360, menu: '6 hours', group: 'hour' },
  { value: '8h', label: '8h', minutes: 480, menu: '8 hours', group: 'hour' },
  { value: '12h', label: '12h', minutes: 720, menu: '12 hours', group: 'hour' },
  { value: '1D', label: '1D', minutes: 1440, menu: '1 day', group: 'day' },
  { value: '3D', label: '3D', minutes: 3 * 1440, menu: '3 days', group: 'day' },
  { value: '1W', label: '1W', minutes: 7 * 1440, menu: '1 week', group: 'day' },
  { value: '1M', label: '1M', minutes: 30 * 1440, menu: '1 month', group: 'day' },
  { value: '3M', label: '3M', minutes: 91 * 1440, menu: '3 months', group: 'day' },
  { value: '6M', label: '6M', minutes: 182 * 1440, menu: '6 months', group: 'day' },
  { value: '1Y', label: '1Y', minutes: 365 * 1440, menu: '1 year', group: 'day' },
];

/** Node overlay is an intraday feature — hidden at daily/weekly. */
export const INTRADAY_MAX_MINUTES = 60;

export function tfMinutes(tf: Timeframe): number {
  return TIMEFRAMES.find(t => t.value === tf)?.minutes ?? 1;
}

/*
  Longer than one cash day is on the menu so the list matches a chart's
  interval picker. The feed does not serve those bars yet. A click stays on
  the frame already up, and a stored one is not drawn.
*/
export function frameServed(tf: Timeframe): boolean {
  return tfMinutes(tf) <= 1440;
}

/*
  INCREMENTAL, NOT FROM SCRATCH (2026-09-06, the perf sweep). Both folds ran
  over the whole store on every call — 8,580 bars, or 8,580 snapshots × 61
  strikes — and every chart called them on every tick and on every mount:
  250ms of the Terrain's open, 60ms on the Map's, and a slice of every idle
  frame. The store is APPEND-ONLY except for its last element (the forming
  bar, the live snapshot), so each base array keeps, per interval, the
  buckets already closed and how far into the base they reach; a call folds
  only what arrived since and rebuilds the one open bucket. A base whose
  front moved (the cap trimming old history) starts over.
*/
interface CandleFold {
  closed: Candle[];
  folded: number; // base entries whose bucket is closed
  firstRef: Candle | undefined;
  lastRef: Candle | undefined; // base[folded - 1] when the fold was taken
}
const candleFolds = new WeakMap<Candle[], Map<number, CandleFold>>();

/** Bucket from a session open in New York, not from the unix epoch. A morning overnight bar belongs to the previous evening's open. */
function sessionBucket(timeSec: number, bucketSec: number, openMin: number): number {
  const p = nyParts(timeSec * 1000);
  const min = p.hour * 60 + p.minute;
  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (openMin >= 20 * 60 && min < 4 * 60) {
    const utc = new Date(Date.UTC(y, m - 1, d));
    utc.setUTCDate(utc.getUTCDate() - 1);
    y = utc.getUTCFullYear();
    m = utc.getUTCMonth() + 1;
    d = utc.getUTCDate();
  }
  const open = Math.floor(nyWallTime(y, m, d, Math.floor(openMin / 60), openMin % 60) / 1000);
  if (timeSec < open) return open;
  return open + Math.floor((timeSec - open) / bucketSec) * bucketSec;
}

const two = (n: number) => String(n).padStart(2, '0');
/** 09:30 New York (epoch seconds) on the civil date y-m-d, the day normalised (d = 0 is the last of the month before). */
function openOn(y: number, m: number, d: number, min = 9 * 60 + 30): number {
  const u = new Date(Date.UTC(y, m - 1, d));
  return Math.floor(nyWallTime(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), Math.floor(min / 60), min % 60) / 1000);
}

/*
  THE BUCKET A BAR BELONGS TO, TradingView style (2026-10-31). The default used to be the unix epoch: an hour cut at :00 so the
  first 1h bar was 9:30–10:00, a day cut at UTC midnight (20:00 New York in summer), a week began on a Thursday (1970-01-01).
  Intraday buckets now count from the open of the session segment the bar is in — the cash session at 9:30, the after-hours
  at the close (13:00 on an early close), the premarket at 4:00, the overnight at 20:00 (its morning leg with the evening it
  started) — so 1h reads 9:30, 10:30 … 15:30 and the 15:30 bar is half an hour. A day is the New York trading day
  (core/nyTime nyTradingDay; the overnight from 20:00 joins the day it opens), stamped at its 9:30 open; a week starts on that
  day's Monday; 3D counts civil days; a month, quarter, half or year is the calendar's.
*/
/** The bucket a moment falls in on a chart of `minutes` — the key a synced crosshair matches on. A bar is stamped somewhere
    inside its own bucket (an intraday bar at its start, a daily bar at its 16:00 close), so two moments are on the same
    bar exactly when their keys are equal. A minutes of 0 or less (a rule clock) is read as one minute. */
export const syncBucket = (timeSec: number, minutes: number): number => barBucket(timeSec, minutes > 0 ? minutes : 1);

export function barBucket(timeSec: number, minutes: number): number {
  if (minutes >= 1440) {
    const key = nyTradingDay(timeSec * 1000);
    const y = Math.floor(key / 10_000);
    const m = Math.floor(key / 100) % 100;
    const d = key % 100;
    if (minutes === 1440) return openOn(y, m, d);
    if (minutes < 7 * 1440) {
      const serial = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
      const start = serial - (serial % Math.round(minutes / 1440));
      const u = new Date(start * 86_400_000);
      return openOn(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
    }
    if (minutes < 28 * 1440) {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return openOn(y, m, d - ((dow + 6) % 7));
    }
    const months = minutes >= 365 * 1440 ? 12 : minutes >= 180 * 1440 ? 6 : minutes >= 90 * 1440 ? 3 : 1;
    return openOn(y, m - ((m - 1) % months), 1);
  }
  const bucketSec = minutes * 60;
  const p = nyParts(timeSec * 1000);
  const min = p.hour * 60 + p.minute;
  const close = sessionCloseMinOn(`${p.year}-${two(p.month)}-${two(p.day)}`);
  let from: number;
  let back = 0;
  if (min >= 9 * 60 + 30 && min < close) from = 9 * 60 + 30;
  else if (min >= close && min < 20 * 60) from = close;
  else if (min >= 4 * 60 && min < 9 * 60 + 30) from = 4 * 60;
  else {
    from = 20 * 60;
    if (min < 4 * 60) back = 1;
  }
  const open = openOn(p.year, p.month, p.day - back, from);
  return open + Math.floor((timeSec - open) / bucketSec) * bucketSec;
}

/** Aggregate 1m OHLC bars into buckets of `minutes`. The base contract is
    ONE-MINUTE bars: sub-minute timeframes never come through here — they
    read the seconds tape directly (see the T-14 note above), so `<= 1`
    correctly means "already at or below the base grid". `openMin` anchors
    the bucket to that one session's New York open; without it each bar's
    bucket is `barBucket`'s (its session segment's open, the trading day, the
    Monday week). */
export function aggregateCandles(base: Candle[], minutes: number, openMin?: number): Candle[] {
  if (minutes <= 1 || base.length === 0) return base;
  const bucketSec = minutes * 60;
  const cacheKey = openMin == null ? minutes : openMin * 10_000 + minutes;
  let byMin = candleFolds.get(base);
  if (!byMin) {
    byMin = new Map();
    candleFolds.set(base, byMin);
  }
  let fold = byMin.get(cacheKey);
  const stale = !fold || fold.folded > base.length || fold.firstRef !== base[0] || (fold.folded > 0 && fold.lastRef !== base[fold.folded - 1]);
  if (stale) fold = { closed: [], folded: 0, firstRef: base[0], lastRef: undefined };
  const f = fold!;
  /* Fold the closed buckets that arrived since; the open (last) bucket is
     rebuilt every call because its bars still move. */
  let cur: Candle | null = null;
  let curBucket = -1;
  let curStart = f.folded;
  for (let i = f.folded; i < base.length; i++) {
    const b = base[i];
    const bucket = openMin == null ? barBucket(b.time, minutes) : sessionBucket(b.time, bucketSec, openMin);
    if (bucket !== curBucket) {
      if (cur) {
        f.closed.push(cur);
        f.folded = i;
        f.lastRef = base[i - 1];
      }
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      curBucket = bucket;
      curStart = i;
    } else if (cur) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  void curStart;
  byMin.set(cacheKey, f);
  return cur ? [...f.closed, cur] : f.closed.slice();
}

interface SnapFold {
  closed: GexSnapshot[];
  closedMax: number;
  folded: number;
  firstRef: GexSnapshot | undefined;
  lastRef: GexSnapshot | undefined;
}
const snapFolds = new WeakMap<GexSnapshot[], Map<number, SnapFold>>();
/** The largest |value| of an aggregated array, remembered beside it */
const maxAbsOf = new WeakMap<GexSnapshot[], number>();

/*
  THE PEAK MERGE. A snapshot's levels come off the chain in strike order and
  neighbouring snapshots share almost the whole grid, so a bucket's peaks are
  kept as two parallel sorted arrays and each snapshot is MERGED in one
  linear pass — no hashing, no Map churn. The first fold of a 22-session
  store (8,580 snapshots × 61 strikes) went from ~210ms to a few tens.
*/
interface Peaks {
  strikes: number[];
  values: number[];
  abs: number[];
  /* Delta and vega exposure ride along (2026-09-06: the trails follow the
     head's Greek), each keeping ITS OWN peak per strike */
  dex: number[];
  vex: number[];
}
const newPeaks = (): Peaks => ({ strikes: [], values: [], abs: [], dex: [], vex: [] });
const mergePeaks = (p: Peaks, levels: readonly { strike: number; value: number; dex?: number; vex?: number }[]): void => {
  const ps = p.strikes;
  const pv = p.values;
  const pa = p.abs;
  const pd = p.dex;
  const px = p.vex;
  if (ps.length === 0) {
    for (let j = 0; j < levels.length; j++) {
      const l = levels[j];
      ps.push(l.strike);
      pv.push(l.value);
      pa.push(Math.abs(l.value));
      pd.push(l.dex ?? 0);
      px.push(l.vex ?? 0);
    }
    return;
  }
  /* Both sides sorted ascending, IN PLACE: a strike already here keeps the
     larger |value|; a strike the grid has drifted onto is spliced in — one
     or two a bar, never more, so the pass is linear and allocates nothing. */
  let i = 0;
  for (let j = 0; j < levels.length; j++) {
    const l = levels[j];
    const k = l.strike;
    while (i < ps.length && ps[i] < k) i++;
    if (i < ps.length && ps[i] === k) {
      const a = Math.abs(l.value);
      if (a > pa[i]) {
        pv[i] = l.value;
        pa[i] = a;
      }
      const d = l.dex ?? 0;
      if (Math.abs(d) > Math.abs(pd[i])) pd[i] = d;
      const v = l.vex ?? 0;
      if (Math.abs(v) > Math.abs(px[i])) px[i] = v;
    } else {
      ps.splice(i, 0, k);
      pv.splice(i, 0, l.value);
      pa.splice(i, 0, Math.abs(l.value));
      pd.splice(i, 0, l.dex ?? 0);
      px.splice(i, 0, l.vex ?? 0);
    }
    i++;
  }
};
const peakLevels = (p: Peaks) => {
  const out = new Array<{ strike: number; value: number; dex: number; vex: number }>(p.strikes.length);
  for (let k = 0; k < p.strikes.length; k++) out[k] = { strike: p.strikes[k], value: p.values[k], dex: p.dex[k], vex: p.vex[k] };
  return out;
};
const peaksMax = (p: Peaks) => {
  let m = 0;
  for (const a of p.abs) if (a > m) m = a;
  return m;
};

/** The fold for (base, minutes) — fresh when the store's front moved or the fold ran past it */
function foldFor(base: GexSnapshot[], minutes: number): SnapFold {
  let byMin = snapFolds.get(base);
  if (!byMin) {
    byMin = new Map();
    snapFolds.set(base, byMin);
  }
  let fold = byMin.get(minutes);
  const stale = !fold || fold.folded > base.length || fold.firstRef !== base[0] || (fold.folded > 0 && fold.lastRef !== base[fold.folded - 1]);
  if (stale) {
    fold = { closed: [], closedMax: 0, folded: 0, firstRef: base[0], lastRef: undefined };
    byMin.set(minutes, fold);
  }
  return fold!;
}

/** One snapshot per bucket — the PEAK per strike inside it, re-stamped to the bucket start. */
export function aggregateSnapshots(base: GexSnapshot[], minutes: number): GexSnapshot[] {
  if (base.length === 0 || minutes <= 1) return base;
  const f = foldFor(base, minutes);
  /* The bucket's node is its PEAK minute, per strike — the way a candle
     keeps its high and low, not its average. A mean flattened the ribbon's
     envelope into a smooth band; the jagged amplitude IS the texture
     (Noah, 2026-08-22, against Sovereign's close-ups). Signed by the peak's
     own side. */
  let curBucket = -1;
  let peaks = newPeaks();
  for (let i = f.folded; i < base.length; i++) {
    const snap = base[i];
    /* the candles' own bucket, so a node stays pinned to its bar */
    const bucket = barBucket(snap.time, minutes);
    if (bucket !== curBucket) {
      if (curBucket >= 0) {
        f.closed.push({ time: curBucket, levels: peakLevels(peaks) });
        f.closedMax = Math.max(f.closedMax, peaksMax(peaks));
        f.folded = i;
        f.lastRef = base[i - 1];
      }
      curBucket = bucket;
      peaks = newPeaks();
    }
    mergePeaks(peaks, snap.levels);
  }
  const out = f.closed.slice();
  let max = f.closedMax;
  if (curBucket >= 0) {
    out.push({ time: curBucket, levels: peakLevels(peaks) });
    max = Math.max(max, peaksMax(peaks));
  }
  maxAbsOf.set(out, Math.max(1, max));
  return out;
}

/** Largest |value| across all snapshot levels, for normalizing node intensity.
    Free for an array aggregateSnapshots just built; a scan otherwise. */
export function snapshotsMaxAbs(snaps: GexSnapshot[]): number {
  const known = maxAbsOf.get(snaps);
  if (known !== undefined) return known;
  let max = 1;
  for (const s of snaps) {
    for (const l of s.levels) {
      const a = Math.abs(l.value);
      if (a > max) max = a;
    }
  }
  maxAbsOf.set(snaps, max);
  return max;
}
