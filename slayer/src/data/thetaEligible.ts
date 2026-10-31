/* A stock's extended-hours bars rebuilt from the prints that may set a price (docs/DATA_SOURCES.md, "Extended-hours
   bars"). ThetaData's own one-minute bars after 16:00 and before 09:30 take their high, low, open and close from every
   Form T print, so late reports that carry an old price draw tall false spikes: on 2026-10-29 SPY traded near 765.5
   after the close, yet the closing auction's average-price and prior-reference-price reports (769.5067 on 2.2M shares
   at 16:11:44, 769.36 at 16:16–17:05) and size-1 odd lots at the close (769.36) gave 16:09–16:19 highs of 769.36 and
   769.5067. Here a print sets a bar's price only if every condition it carries is one the SIP marks as updating the
   consolidated high, low and last (ThetaData's Trade Conditions table: High, Low and Last all marked, Late Report not).
   Form T and the other markers that only say the print is extended-hours or trade-through exempt are neutral. The
   volume stays the vendor bar's: every print counts. The regular session is ThetaData's own bars, untouched. */

import type { Candle } from '../types/market';
import { nyParts, nyWallTime } from '../core/nyTime';
import { sessionCloseMinOn } from '../core/calendar';

/** Conditions whose High, Low and Last columns are all marked and whose Late Report column is not
    (https://docs.thetadata.us/Articles/Errors-Exchanges-Conditions/Trade-Conditions.html, read 2026-10-29). */
const SETS_PRICE = new Set([
  0, 10, 14, 18, 21, 22, 23, 24, 25, 29, 30, 31, 32, 34, 35, 36, 37, 38, 39, 45, 46, 47, 52, 53, 54, 55, 56, 58, 63, 67,
  71, 75, 76, 78, 79, 80, 81, 82, 83, 86, 87, 88, 95, 97, 100, 117, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134,
  135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146,
]);
/** Markers, not reasons: 1 FORM_T and 148 EXTENDED_HOURS_TRADE (every print outside 09:30–16:00 carries one), 107
    BENCHMARK and 108 TRADE_THRU_EXEMPT (on every regular-session print too), 255 no condition in that slot. */
const NEUTRAL = new Set([1, 107, 108, 148, 255]);
const CONDITION_FIELDS = ['condition', 'ext_condition1', 'ext_condition2', 'ext_condition3', 'ext_condition4'] as const;

const int = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN);

/** May this print set a bar's open, high, low or close? Volume is never in question. */
export function printSetsPrice(row: Record<string, unknown>): boolean {
  if (!(int(row.size) > 0) || !(int(row.price) > 0)) return false;
  for (const f of CONDITION_FIELDS) {
    const c = int(row[f]);
    if (!Number.isFinite(c)) continue;
    if (!NEUTRAL.has(c) && !SETS_PRICE.has(c)) return false;
  }
  return true;
}

/** One price-setting print: epoch seconds (the stamp's second) and price. */
export type Tick = { t: number; price: number };

/* "2026-10-29T16:11:44.428" in New York wall time, as epoch seconds: the day's midnight once per date */
const midnights = new Map<string, number>();
function stampSec(stamp: unknown): number {
  if (typeof stamp !== 'string') return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (!m) return 0;
  const day = `${m[1]}${m[2]}${m[3]}`;
  let mid = midnights.get(day);
  if (mid === undefined) {
    mid = Math.floor(nyWallTime(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0) / 1000);
    if (midnights.size > 400) midnights.clear();
    midnights.set(day, mid);
  }
  return mid + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
}

/** The price-setting prints of a /stock/history/trade answer, oldest first, with the newest stamp of any print (the
    read's reach). ThetaData's own ±5% check is kept: a print more than 5% from the last accepted one (above $5) is a
    feed error, not a price. `seed` is the last accepted print before these rows (a later read of the same day). */
export function readTicks(rows: readonly Record<string, unknown>[], seed?: Tick | null): { ticks: Tick[]; through: number } {
  const ticks: Tick[] = [];
  let through = 0;
  let ref = seed ? seed.price : 0;
  let refDay = seed ? midnightOf(seed.t) : -1;
  for (const row of rows) {
    const t = stampSec(row.timestamp);
    if (!t) continue;
    if (t > through) through = t;
    if (!printSetsPrice(row)) continue;
    const price = int(row.price);
    /* the reference restarts each New York day */
    const day = midnightOf(t);
    if (day !== refDay) {
      refDay = day;
      ref = 0;
    }
    if (ref > 5 && Math.abs(price / ref - 1) > 0.05) continue;
    ref = price;
    ticks.push({ t, price });
  }
  ticks.sort((a, b) => a.t - b.t);
  return { ticks, through };
}

const OPEN_SEC = (9 * 60 + 30) * 60;
/** The end of the closing minute's bar, seconds after New York midnight: 16:01, or 13:01 on an early close — on a half day
    the 13:00–15:59 prints are the after-hours (data/thetaTape.ts barInTape) and are rebuilt like any other. */
const closeBarEnd = (time: number): number => {
  const p = nyParts(time * 1000);
  return (sessionCloseMinOn(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`) + 1) * 60;
};

/** Seconds since New York midnight */
const daySec = (t: number, mid: number) => t - mid;

/** Is this bar outside the regular session? The closing minute (16:00, 13:00 on an early close) stays ThetaData's; a wider
    bar that starts at the close reaches past it and is rebuilt (the rule matches ThetaData's on the closing prints). */
export function extendedBar(time: number, step: number, mid: number): boolean {
  const from = daySec(time, mid);
  return from < OPEN_SEC || from + step > closeBarEnd(time);
}

function lastBefore(ticks: readonly Tick[], t: number): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ticks[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Midnight (epoch seconds) of the New York day an instant (epoch seconds) is in. */
function midnightOf(time: number): number {
  const p = nyParts(time * 1000);
  const key = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  let mid = midnights.get(key);
  if (mid === undefined) {
    mid = Math.floor(nyWallTime(p.year, p.month, p.day, 0, 0) / 1000);
    midnights.set(key, mid);
  }
  return mid;
}

/**
 * Extended-hours bars rebuilt from price-setting prints. `covered(time)` says whether the prints of that bar's day and
 * window were read; a bar they do not cover stays ThetaData's. A covered bar takes its open, high, low and close from
 * its own price-setting prints; with none, it holds the last such price earlier that day (the consolidated last did not
 * move), and with none earlier either it has no price and is left out. Volume is always the vendor bar's.
 */
export function rebuildExtended(bars: readonly Candle[], stepSec: number, ticks: readonly Tick[], covered: (time: number) => boolean): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const mid = midnightOf(b.time);
    if (!extendedBar(b.time, stepSec, mid) || !covered(b.time)) {
      out.push(b);
      continue;
    }
    const i = lastBefore(ticks, b.time);
    let j = i;
    let open = 0;
    let high = 0;
    let low = 0;
    let close = 0;
    while (j < ticks.length && ticks[j].t < b.time + stepSec) {
      const p = ticks[j].price;
      if (!open) {
        open = p;
        high = p;
        low = p;
      }
      if (p > high) high = p;
      if (p < low) low = p;
      close = p;
      j += 1;
    }
    if (!open) {
      const prev = i > 0 ? ticks[i - 1] : null;
      if (!prev || prev.t < mid) continue;
      open = high = low = close = prev.price;
    }
    out.push({ time: b.time, open, high, low, close, volume: b.volume });
  }
  return out;
}

/* ---- the reads: one /stock/history/trade request per name and window for the earlier days, one for today ---- */

/** Calendar days back the prints are read: the one-minute tape's depth (data/thetaTape.ts). Older bars stay ThetaData's. */
export const PRINT_DAYS = 6;

type Held = { ticks: Tick[]; through: number };
type Window = { start: string; end: string };

/** A stock's extended-hours windows as ThetaData is asked for them. The end is the window's last millisecond: an end
    of 19:59:59 would leave out every print stamped 19:59:59.xxx (the terminal's end_time is exclusive at the stamp's
    resolution), and 20:00:00 would open the next minute's bar. The same strings everywhere, so the reads are shared. */
export const EXT_WINDOWS: { pre: Window; post: Window } = {
  pre: { start: '04:00:00', end: '09:29:59.999' },
  post: { start: '16:00:00', end: '19:59:59.999' },
};

const pastReads = new Map<string, { at: number; got: Promise<Held | null> }>();
const todayReads = new Map<string, { day: string; held: Held | null; at: number; busy: Promise<void> | null }>();

/** "16:11:00" for an instant's minute */
const hhmm00 = (t: number): string => {
  const p = nyParts(t * 1000);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00`;
};

type Get = (path: string) => Promise<{ status: number; data: unknown; error: string | null }>;

const tradePath = (symbol: string, from: string, to: string, start: string, end: string) =>
  `/stock/history/trade?symbol=${encodeURIComponent(symbol)}&start_date=${from}&end_date=${to}&start_time=${start}&end_time=${end}&format=csv`;

const rowsOf = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

/** The finished days' prints: asked once (they never change), again a minute after a failed read. */
function pastPrints(get: Get, symbol: string, w: Window, from: string, to: string): Promise<Held | null> {
  const key = `${symbol}|${w.start}|${from}|${to}`;
  const hit = pastReads.get(key);
  if (hit) return hit.got;
  const got = get(tradePath(symbol, from, to, w.start, w.end)).then(a => {
    if (a.error || !Array.isArray(a.data)) {
      setTimeout(() => pastReads.get(key)?.got === got && pastReads.delete(key), 60_000);
      return null;
    }
    return readTicks(rowsOf(a.data));
  });
  pastReads.set(key, { at: Date.now(), got });
  if (pastReads.size > 200) pastReads.delete(pastReads.keys().next().value as string);
  return got;
}

/** Today's prints, read on from the minute the last read reached (that minute again, since it may have been forming). */
async function todayPrints(get: Get, symbol: string, w: Window, day: string): Promise<Held | null> {
  const key = `${symbol}|${w.start}`;
  let slot = todayReads.get(key);
  if (!slot || slot.day !== day) {
    slot = { day, held: null, at: 0, busy: null };
    todayReads.set(key, slot);
  }
  if (slot.busy) {
    await slot.busy;
    return slot.held;
  }
  if (Date.now() - slot.at < 5_000) return slot.held;
  const s = slot;
  s.busy = (async () => {
    const held = s.held;
    const from = held && held.through ? hhmm00(held.through) : w.start;
    const a = await get(tradePath(symbol, day, day, from > w.start ? from : w.start, w.end));
    if (a.error || !Array.isArray(a.data)) return;
    const cut = held && held.through ? held.through - (held.through % 60) : 0;
    const kept = held ? held.ticks.filter(t => t.t < cut) : [];
    const fresh = readTicks(rowsOf(a.data), kept[kept.length - 1] ?? null);
    s.held = { ticks: kept.concat(fresh.ticks), through: Math.max(held?.through ?? 0, fresh.through) };
    s.at = Date.now();
  })().finally(() => {
    s.busy = null;
  });
  await s.busy;
  return s.held;
}

const ymdOf = (t: number): string => {
  const p = nyParts(t * 1000);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
};

/**
 * A stock's bars in one extended-hours window, rebuilt from its price-setting prints where they were read: one request
 * for the finished days of the last PRINT_DAYS (the same address for every grain and viewer, so the hub keeps one copy),
 * and today's read on from where the last one reached. A day whose prints did not come back keeps ThetaData's bars.
 */
export async function cleanExtendedBars(get: Get, symbol: string, w: Window, stepSec: number, bars: Candle[], nowMs = Date.now()): Promise<Candle[]> {
  if (!bars.length) return bars;
  const today = ymdOf(Math.floor(nowMs / 1000));
  const first = ymdOf(Math.floor(nowMs / 1000) - PRINT_DAYS * 86_400);
  const yesterday = ymdOf(Math.floor(nowMs / 1000) - 86_400);
  const days = new Set(bars.map(b => ymdOf(b.time)));
  const wantPast = [...days].some(d => d >= first && d < today);
  const [past, now] = await Promise.all([
    wantPast ? pastPrints(get, symbol, w, first, yesterday) : Promise.resolve(null),
    days.has(today) ? todayPrints(get, symbol, w, today) : Promise.resolve(null),
  ]);
  if (!past && !now) return bars;
  const ticks = (past?.ticks ?? []).concat(now?.ticks ?? []);
  const covered = (time: number): boolean => {
    const d = ymdOf(time);
    if (d === today) return !!now && time <= now.through;
    return !!past && d >= first && d < today;
  };
  return rebuildExtended(bars, stepSec, ticks, covered);
}
