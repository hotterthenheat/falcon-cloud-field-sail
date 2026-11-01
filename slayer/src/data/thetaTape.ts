/* A stock's or an index's bars and its live print from ThetaData, shared by the Terrain, the Weigher and Pinpoint's tape. One store per
   name, grain and session: the first read paints the copy this browser kept (stamped with when it was taken), a
   timer re-reads only today's window while that session trades, and nothing is asked while the tab is hidden. With
   the terminal down the last bars stay on screen and say so; nothing stands in for them. */

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { nyMinutes, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { isTradingDay, isEarlyClose, nyYmd, EARLY_CLOSES, sessionBefore, sessionCloseMinOn } from '../core/calendar';
import { minuteInSession, sessionMeta, type DeskSession } from './deskSession';
import { phaseAt, sessionAt } from '../core/session';
import { etClock, keepTheta, keptTheta, noData, offlineWords, pageHidden, thetaDown, thetaGet, type ThetaAnswer } from './thetaFeed';
import { thetaUseHere } from './theta';
import { isCashIndex } from './symbolDirectory';
import { EXT_WINDOWS, RTH_WINDOW, cleanExtendedBars, saneStockBars } from './thetaEligible';
import { saneBars } from './barSanity';
import { InUseLru } from './boundedMap';
import { ensureThetaPrice, peekThetaPrice, subscribeThetaPrices, thetaPriceRev, type ThetaPrice } from './thetaQuote';

export const THETA_INDEX = new Set(['SPX', 'VIX', 'RUT', 'NDX', 'XSP']);

/** Minute of day the overnight tape opens. Stocks at 8:00 PM. The index book at 8:15 PM. */
export function tapeOpenMinute(session: DeskSession, symbol = ''): number {
  if (session === 'overnight' && THETA_INDEX.has(symbol.trim().toUpperCase())) return 20 * 60 + 15;
  return sessionMeta(session).from;
}

/** Intraday grains are ThetaData intervals; `day` and `week` are the EOD rows (today folded from 5-minute bars). */
export type TapeGrain = '15s' | '1m' | '5m' | '15m' | '30m' | '1h' | 'day' | 'week';

/* Each window ends on its last millisecond: an end of 15:59:59 leaves out every print stamped 15:59:59.xxx (on SPY
   2026-10-29, 14,897 shares of the 15:59 bar and its 769.66 high), and 16:00:00 would open the 16:00 bar. */
const WINDOWS: Record<DeskSession, { start: string; end: string }[]> = {
  rth: [RTH_WINDOW],
  pre: [EXT_WINDOWS.pre],
  post: [EXT_WINDOWS.post],
  overnight: [
    { start: '20:00:00', end: '23:59:59.999' },
    { start: '00:00:00', end: '03:59:59.999' },
  ],
};

/*
  HISTORY IN SESSIONS, AND MORE OF IT ON THE WAY LEFT (2026-10-31). The windows were calendar days ending today, so a
  weekend or a holiday ate them (15 s and 1 m were empty on a Sunday before the first print) and the coarse grains were
  shallow (an hour chart was about 28 bars). Each grain now counts TRADING SESSIONS back from the last session whose window
  has opened (a Saturday or a 7 AM Monday reads Friday), paints its newest chunk first, then backfills older chunks one at a
  time to its depth; a chart scrolled to its left edge asks for one more chunk (extendTape), until the data's start (two
  empty chunks in a row; ThetaData's "no data" for the EOD rows). A chunk is at most a month for intraday bars (ThetaData:
  "Bulk history requests are limited to no more than 1 month"; spansOf cuts 28-day spans) and 365 days for EOD rows. A
  finished day never changes: it is read once and kept in the slot, and the refresh re-reads only the last few sessions.
*/
type IntraGrain = Exclude<TapeGrain, 'day' | 'week'>;
/** Sessions of history a grain fills on its own: 15 s one session, 1 m a week, 5 m a month, 1 h six months */
const DEPTH: Record<TapeGrain, number> = { '15s': 1, '1m': 5, '5m': 20, '15m': 40, '30m': 63, '1h': 126, day: 5 * 252, week: 5 * 252 };
/** Sessions in one read: the first paint, every backfill step and every scroll-back step */
const CHUNK: Record<TapeGrain, number> = { '15s': 1, '1m': 5, '5m': 20, '15m': 20, '30m': 20, '1h': 20, day: 252, week: 252 };
/** Sessions in the FIRST read, kept small so a pane paints in a second or two even while three other panes, the
    Compass warm-up and the backfills share the terminal's six history slots; the backfill then reads CHUNK at a time */
const FIRST: Record<IntraGrain, number> = { '15s': 1, '1m': 2, '5m': 3, '15m': 5, '30m': 5, '1h': 10 };
/** Sessions the ten-minute refresh re-reads (late corrections land on the last day or two); between refreshes, today only */
const REFRESH_SESSIONS = 2;
/** A daily or weekly chart off the extended sessions folds 5-minute bars: its sessions per chunk and its depth */
const EXT_DAY_CHUNK = 20;
const EXT_DAY_DEPTH = 40;
const STEP_SEC: Partial<Record<TapeGrain, number>> = { '15s': 15, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 };

const ymd = (at = Date.now()): string => nyYmd(at);
const two = (n: number) => String(n).padStart(2, '0');
const ymdOfDate = (d: Date): string => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
const dateOfYmd = (v: string): Date => new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));

/** The calendar day before a YYYYMMDD */
export function dayBefore(v: string): string {
  const d = dateOfYmd(v);
  d.setDate(d.getDate() - 1);
  return ymdOfDate(d);
}

/** Calendar days back from a YYYYMMDD */
export function daysBack(v: string, n: number): string {
  const d = dateOfYmd(v);
  d.setDate(d.getDate() - n);
  return ymdOfDate(d);
}

/** The `n`-th trading session counting back from `end` (YYYYMMDD; `end` itself is the first when it trades). */
export function sessionsBack(end: string, n: number): string {
  const d = dateOfYmd(end);
  let left = Math.max(1, Math.floor(n));
  for (let i = 0; i < 4000; i++) {
    if (isTradingDay(d)) {
      left -= 1;
      if (left === 0) return ymdOfDate(d);
    }
    d.setDate(d.getDate() - 1);
  }
  return ymdOfDate(d);
}

/** The minute of New York's day a session's window opens on `iso` (the after-hours at the close: 13:00 on an early close) */
function windowOpenMin(session: DeskSession, iso: string): number {
  if (session === 'rth') return 9 * 60 + 30;
  if (session === 'pre') return 4 * 60;
  if (session === 'post') return sessionCloseMinOn(iso);
  return 0;
}

/** The last session whose `session` window has opened by `nowMs`: today once it has, else the session before (a Saturday,
    a Sunday, a holiday or 7 AM on a Monday for the cash session all read the session before). YYYYMMDD. */
export function anchorSession(session: DeskSession, nowMs = Date.now()): string {
  const p = nyParts(nowMs);
  const today = new Date(p.year, p.month - 1, p.day);
  const iso = `${p.year}-${two(p.month)}-${two(p.day)}`;
  if (isTradingDay(today) && p.hour * 60 + p.minute >= windowOpenMin(session, iso)) return ymdOfDate(today);
  return ymdOfDate(sessionBefore(today));
}

/** Where a read ends: today, except a 15-second read (one request a day) on a day with no session ends on the anchor. */
function readEnd(grain: TapeGrain, session: DeskSession, nowMs = Date.now()): string {
  const today = ymd(nowMs);
  if (grain !== '15s') return today;
  return isTradingDay(dateOfYmd(today)) ? today : anchorSession(session, nowMs);
}

/** The first chunk a grain paints, [from, to] (YYYYMMDD), and how far back it fills on its own */
export function tapeWindow(grain: TapeGrain, session: DeskSession, nowMs = Date.now()): { from: string; to: string; target: string } {
  const anchor = anchorSession(session, nowMs);
  const to = readEnd(grain, session, nowMs);
  const cash = session === 'rth' || (grain !== 'day' && grain !== 'week');
  const intra = grain !== 'day' && grain !== 'week';
  const chunk = intra ? FIRST[grain as IntraGrain] : cash ? CHUNK[grain] : EXT_DAY_CHUNK;
  const depth = cash ? DEPTH[grain] : EXT_DAY_DEPTH;
  if ((grain === 'day' || grain === 'week') && session === 'rth') return { from: daysBack(to, 365), to, target: daysBack(to, 5 * 365) };
  return { from: sessionsBack(anchor, chunk), to, target: sessionsBack(anchor, depth) };
}

/** The older chunk before `from` (YYYYMMDD), no older than `target` when one is given */
export function olderChunk(grain: TapeGrain, session: DeskSession, from: string, target?: string): { from: string; to: string } {
  const to = dayBefore(from);
  const eod = (grain === 'day' || grain === 'week') && session === 'rth';
  const cash = session === 'rth' || (grain !== 'day' && grain !== 'week');
  const start = eod ? daysBack(to, 364) : sessionsBack(to, cash ? CHUNK[grain] : EXT_DAY_CHUNK);
  return { from: target && target > start ? target : start, to };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** ThetaData answers either flat rows or `{ data: [...] }` groups. */
export function flatRows(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown };
    if (Array.isArray(row.data)) out.push(...(row.data as Record<string, unknown>[]));
    else out.push(item as Record<string, unknown>);
  }
  return out;
}

/** 16:00 New York on a bar's day: where a daily bar sits. */
export function dayClose(timeSec: number): number {
  const p = nyParts(timeSec * 1000);
  return Math.floor(nyWallTime(p.year, p.month, p.day, 16, 0) / 1000);
}

/** 16:00 New York on the Monday of a bar's week: where a weekly bar sits. */
export function weekClose(timeSec: number): number {
  const p = nyParts(timeSec * 1000);
  const back = (p.weekday + 6) % 7;
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  utc.setUTCDate(utc.getUTCDate() - back);
  return Math.floor(nyWallTime(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), 16, 0) / 1000);
}

function windowsFor(symbol: string, session: DeskSession, from = '', to = ''): { start: string; end: string }[] {
  if (session === 'overnight' && THETA_INDEX.has(symbol)) {
    return [
      { start: '20:15:00', end: '23:59:59.999' },
      { start: '00:00:00', end: '03:59:59.999' },
    ];
  }
  /* Post opens when the early close ends (13:00), not at 16:00, on any pull that covers a half day.
     A normal day in that pull still drops 13:00–15:59 in barInTape. */
  if (session === 'post' && rangeHasEarlyClose(from, to)) return [{ start: '13:00:00', end: '19:59:59.999' }];
  return WINDOWS[session];
}

function rangeHasEarlyClose(from: string, to: string): boolean {
  if (!(from && to)) return false;
  for (const iso of EARLY_CLOSES) {
    const ymd = iso.replace(/-/g, '');
    if (ymd >= from && ymd <= to) return true;
  }
  return false;
}

/** A print belongs on this tape. The stock overnight starts at 8:00 PM. An index overnight starts at 8:15.
    On a half day the cash session ends at 13:00: 13:00–19:59 is the after-hours (post opens when the early close
    ends), so every minute is in exactly one session and nothing after the close is a regular bar. No bar is invented. */
export function barInTape(timeSec: number, session: DeskSession, symbol = ''): boolean {
  const min = nyMinutes(timeSec * 1000);
  const name = symbol.trim().toUpperCase();
  if (session === 'overnight' && THETA_INDEX.has(name)) {
    return min >= 20 * 60 + 15 || min < 4 * 60;
  }
  const p = nyParts(timeSec * 1000);
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (isEarlyClose(iso)) {
    if (session === 'rth') return min >= 9 * 60 + 30 && min < 13 * 60;
    if (session === 'post') return min >= 13 * 60 && min < 20 * 60;
  }
  return minuteInSession(min, session);
}
export function foldTo(bars: readonly Candle[], keyOf: (timeSec: number) => number): Candle[] {
  const map = new Map<number, Candle>();
  for (const b of bars) {
    const k = keyOf(b.time);
    const cur = map.get(k);
    if (!cur) map.set(k, { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Intraday rows in one session, oldest first, one bar per stamp. A bar with a zero open, high, low, or close is not a bar. The close is not copied into a missing field. */
export function readOhlc(data: unknown, session: DeskSession, symbol = ''): Candle[] {
  const bars: Candle[] = [];
  for (const b of flatRows(data)) {
    const at = nyWallStamp(b.timestamp ?? b.time);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    if (!at || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0)) continue;
    const time = Math.floor(at / 1000);
    if (!barInTape(time, session, symbol)) continue;
    bars.push({ time, open, high, low, close, volume: num(b.volume) });
  }
  return dedupe(bars);
}

/** EOD rows as daily bars at 16:00 New York. */
export function readEod(data: unknown): Candle[] {
  const bars: Candle[] = [];
  for (const b of flatRows(data)) {
    /* the row's own day: `created` is when that day's report was made; `last_trade` can be an earlier day's (a contract that
       did not trade) */
    const at = nyWallStamp(b.created ?? b.last_trade ?? b.timestamp ?? b.date);
    const close = num(b.close);
    if (!at || !(close > 0)) continue;
    const open = num(b.open) || close;
    /* A wick off by a decimal place is a bad print, not a day (SPY's 2 Feb 2026 row has a low of 69.005 under a 689–696
       body, and it drew every daily chart down to zero): a low under half the body's foot or a high over twice its top
       is dropped to the body. */
    const foot = Math.min(open, close);
    const top = Math.max(open, close);
    const rawLow = num(b.low);
    const rawHigh = num(b.high);
    const low = rawLow > 0 && rawLow >= foot * 0.5 ? Math.min(rawLow, foot) : foot;
    const high = rawHigh > 0 && rawHigh <= top * 2 ? Math.max(rawHigh, top) : top;
    bars.push({ time: dayClose(Math.floor(at / 1000)), open, high, low, close, volume: num(b.volume) });
  }
  return dedupe(bars);
}

function dedupe(bars: Candle[]): Candle[] {
  bars.sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && prev.time === b.time) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

const root = (symbol: string): 'index' | 'stock' => (isCashIndex(symbol) ? 'index' : 'stock');

type Pull = { bars: Candle[]; offline: boolean };

/** [from, to] as spans the terminal takes in one read: a month at most (28 days), and one day for a grain under a minute.
    A 15-second span on a day with no session is not asked. */
export function spansOf(from: string, to: string, grain: Exclude<TapeGrain, 'day' | 'week'>): [string, string][] {
  const asMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  const asYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const width = grain === '15s' ? 1 : 28;
  const out: [string, string][] = [];
  for (let at = asMs(to); at >= asMs(from); at -= width * 86_400_000) {
    const start = Math.max(asMs(from), at - (width - 1) * 86_400_000);
    if (width === 1 && !isTradingDay(dateOfYmd(asYmd(at)))) continue;
    out.push([asYmd(start), asYmd(at)]);
  }
  return out.reverse();
}

export async function pullIntraday(symbol: string, grain: Exclude<TapeGrain, 'day' | 'week'>, session: DeskSession, from: string, to: string, get?: (path: string) => Promise<ThetaAnswer>): Promise<Pull> {
  const raw = await pullIntradayRaw(symbol, grain, session, from, to, get);
  return { bars: await raw.clean(), offline: raw.offline };
}

/* The bad-print cleaner's own reads (/stock/history/trade, data/thetaEligible.ts): at most CLEAN_READS at once across
   every tape, so a cold desk's dozens of them never take the slots the panes' first bars are waiting for. */
const CLEAN_READS = 2;
let cleanBusy = 0;
const cleanQueue: (() => void)[] = [];
/** The answer a cleaner read gets when no chart wants its tape any more: no request, and the read that asked it is not
    kept (data/thetaEligible.ts drops it at once), so the tape is cleaned whole when a chart wants it again */
const RELEASED: ThetaAnswer = { status: 0, data: null, error: 'released' };
async function cleanGet(path: string, still: () => boolean = () => true): Promise<ThetaAnswer> {
  if (!still()) return RELEASED;
  if (cleanBusy >= CLEAN_READS) await new Promise<void>(resolve => cleanQueue.push(resolve));
  else cleanBusy += 1;
  try {
    /* a read queued behind others is asked only if its tape is still wanted when its turn comes */
    if (!still()) return RELEASED;
    return await thetaGet(path);
  } finally {
    /* the slot passes straight to the next in line */
    const next = cleanQueue.shift();
    if (next) next();
    else cleanBusy -= 1;
  }
}

/* A ROOM OFF SCREEN STOPS ITS HEAVY READS (audit: Terrain's bar-sanity trade reads, ~100 of them, ran on behind the
   Weigher after the reader moved). A tape's cleaner reads only while some chart still wants that tape: once none does,
   its queued reads are not asked, the run is dropped (not stored half-cleaned) and the tape is read again, whole, the
   next time a chart wants it. */
type CleanRun = { released: boolean };
function cleanFor(key: string, run: CleanRun): (path: string) => Promise<ThetaAnswer> {
  const still = () => {
    if (wanted.has(key)) return true;
    run.released = true;
    return false;
  };
  return path => cleanGet(path, still);
}

/** ThetaData's bars as they came (`bars`, already sound enough to draw), and the cleaner that turns them into the bars
    pullIntraday answers (`clean`). The tape paints the first before it runs the second. */
async function pullIntradayRaw(symbol: string, grain: IntraGrain, session: DeskSession, from: string, to: string, get: (path: string) => Promise<ThetaAnswer> = cleanGet): Promise<Pull & { clean: () => Promise<Candle[]> }> {
  const wins = windowsFor(symbol, session, from, to);
  const got = await Promise.all(
    spansOf(from, to, grain).flatMap(([start, end]) =>
      wins.map(win =>
        thetaGet(`/${root(symbol)}/history/ohlc?symbol=${encodeURIComponent(symbol)}&start_date=${start}&end_date=${end}&interval=${grain}&start_time=${win.start}&end_time=${win.end}&format=json`),
      ),
    ),
  );
  const offline = got.some(g => g.error != null && !noData(g));
  const bars = dedupe(got.flatMap(g => (g.error ? [] : readOhlc(g.data, session, symbol))));
  /* a stock's pre-market and after-hours bars take their prices from the prints that may set one (late reports at an
     old price do not; data/thetaEligible.ts) — the regular session is ThetaData's bars as they come */
  const step = STEP_SEC[grain] ?? 60;
  if (root(symbol) === 'stock') {
    return {
      /* the first paint holds the rule's own mends too (barSanity.ts, no prints): a cleaner still reading its prints, or
         one that never finishes, used to leave the vendor's bad-print wicks on screen (SPY 30 Oct 2026, 16:01–16:28) */
      bars: saneBars(bars),
      offline,
      clean: async () => {
        const clean = session === 'pre' || session === 'post' ? await cleanExtendedBars(get, symbol, wins[0], step, bars) : bars;
        /* a bad print's wick on a day the prints above were not read (data/barSanity.ts): rebuilt from that bar's prints */
        return saneStockBars(get, symbol, step, clean);
      },
    };
  }
  const sane = saneBars(bars);
  return { bars: sane, offline, clean: async () => sane };
}

/** EOD rows over [from, to] in spans of at most 365 days (ThetaData's limit), one after another. `none`: the terminal
    answered "no data" for every span — before the name's first day. */
async function pullEodRange(symbol: string, from: string, to: string): Promise<Pull & { none: boolean }> {
  const spans: [string, string][] = [];
  for (let end = to; end >= from; ) {
    const start = daysBack(end, 364) > from ? daysBack(end, 364) : from;
    spans.unshift([start, end]);
    end = dayBefore(start);
  }
  const bars: Candle[] = [];
  let offline = false;
  let none = true;
  for (const [a, b] of spans) {
    const got = await thetaGet(`/${root(symbol)}/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${a}&end_date=${b}&format=json`);
    if (got.error) {
      if (!noData(got)) {
        offline = true;
        none = false;
      }
      continue;
    }
    none = false;
    bars.push(...readEod(got.data));
  }
  return { bars: dedupe(bars), offline, none };
}

/** Daily bars over [from, to]: the regular session's EOD rows, with today's folded from its 5-minute bars until its EOD row
    lands (`withToday`); an extended session's days folded from its own 5-minute bars. A weekly chart folds these days when
    it is read (peekTape), so a chunk's edge never cuts a week in two. */
async function pullDays(symbol: string, session: DeskSession, from: string, to: string, withToday: boolean): Promise<Pull & { none: boolean }> {
  if (session === 'rth') {
    const today = ymd();
    const [daily, now] = await Promise.all([
      pullEodRange(symbol, from, to),
      withToday ? pullIntraday(symbol, '5m', 'rth', today, today) : Promise.resolve({ bars: [] as Candle[], offline: false }),
    ]);
    const byTime = new Map(daily.bars.map(b => [b.time, b]));
    for (const b of foldTo(now.bars, dayClose)) if (!byTime.has(b.time)) byTime.set(b.time, b);
    return { bars: [...byTime.values()].sort((a, b) => a.time - b.time), offline: daily.offline || now.offline, none: daily.none && !now.bars.length };
  }
  const intra = await pullIntraday(symbol, '5m', session, from, to);
  return { bars: foldTo(intra.bars, dayClose), offline: intra.offline, none: false };
}

/* ---- the store ---- */

export type TapeState = 'loading' | 'live' | 'kept' | 'offline';

export interface TapeRead {
  /** Oldest first. Intraday bars sit at their bucket's start, dailies at 16:00 New York. */
  bars: Candle[];
  /** When these bars were read from the terminal, epoch ms. 0 before any answer. */
  takenAt: number;
  /** `kept`: this browser's copy, the fresh read still out. `offline`: the terminal did not answer. */
  state: TapeState;
}

interface Slot extends TapeRead {
  symbol: string;
  grain: TapeGrain;
  session: DeskSession;
  /** When the last full read landed, and when the next read is due */
  fullAt: number;
  dueAt: number;
  busy: boolean;
  keptAsked: boolean;
  /** When this browser last kept the bars */
  keptAt: number;
  /** The oldest day read so far (YYYYMMDD, '' before the first read) and the oldest day wanted: older chunks are read one at a
      time while `from` is after `target` */
  from: string;
  target: string;
  olderBusy: boolean;
  olderDueAt: number;
  /** Older chunks that came back empty in a row; two, or a "no data" on the EOD rows, is the data's start */
  emptyRuns: number;
  done: boolean;
}

/* Bounded (audit DL6): a tape slot holds a name's whole run of bars at one grain and session, and a tab left open used
   to keep every tape it ever drew. The store keeps TAPE_PANES slots — about twelve chart panes' worth — and lets go of
   the least recently used one no pane wants once a thirteenth is made; a slot a pane still wants is never let go,
   however many there are. A tape let go is read again (its kept copy first) if a pane asks for it later. */
export const TAPE_PANES = 12;
const wanted = new Map<string, number>();
const slots = new InUseLru<string, Slot>(TAPE_PANES, key => wanted.has(key));
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const keyOf = (symbol: string, grain: TapeGrain, session: DeskSession) => `${symbol}|${grain}|${session}`;

/** The session trades now: the global phase (core/session.ts) is this desk session — Sunday 20:00 opens the overnight,
    Friday 20:00 closes it, an early close's after hours runs 13:00–17:00. */
export function sessionLive(session: DeskSession, nowMs = Date.now()): boolean {
  const ph = phaseAt(nowMs);
  return session === 'rth' ? ph === 'regular' : session === 'pre' ? ph === 'pre' : session === 'post' ? ph === 'post' : ph === 'overnight';
}

/** How long a read holds: a trading session's bars are re-read every 15 s (60 s for a daily), a closed one's every 5
    minutes. Overnight a stock's tape is read every minute: the overnight venues are not on ThetaData's tape today (its
    bars for 20:00–04:00 come back empty), so a minute is quick enough to show prints the day they appear. An index's
    overnight is the GTH-hours book (the VIX is computed from 03:15): read at the live pace. */
const holdMs = (s: Slot): number => {
  if (!sessionLive(s.session)) return 5 * 60_000;
  if (s.session === 'overnight' && !THETA_INDEX.has(s.symbol)) return 60_000;
  return s.grain === 'day' || s.grain === 'week' ? 60_000 : 15_000;
};

function slotOf(symbol: string, grain: TapeGrain, session: DeskSession): Slot {
  const key = keyOf(symbol, grain, session);
  let s = slots.get(key);
  if (!s) {
    s = { symbol, grain, session, bars: [], takenAt: 0, state: 'loading', fullAt: 0, dueAt: 0, busy: false, keptAsked: false, keptAt: 0, from: '', target: '', olderBusy: false, olderDueAt: 0, emptyRuns: 0, done: false };
    slots.set(key, s);
  }
  return s;
}

/** Keep a closed bar. A later read may update the bar that was still forming, and may add a bar that was not here. It does not rewrite a bar that already had a bar after it. */
function sealBars(old: Candle[], fresh: Candle[]): Candle[] {
  if (!fresh.length) return old;
  if (!old.length) return fresh;
  const oldLast = old[old.length - 1].time;
  const byTime = new Map(old.map(b => [b.time, b]));
  for (const b of fresh) {
    if (!byTime.has(b.time) || b.time >= oldLast) byTime.set(b.time, b);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/* ---- a cold chart's first reads: the lead session first ---- */

/** How long a session's first read waits for its chart's lead session to paint */
export const LEAD_WAIT_MS = 4_000;
const firstAsked = new WeakMap<Slot, number>();
/** The session a chart of this name reads first: the one trading now when it is the pre-market, the regular session or
    the after-hours, else the regular session (the last one with a full day of bars). */
export function leadSession(nowMs = Date.now()): DeskSession {
  for (const s of ['pre', 'rth', 'post'] as const) if (sessionLive(s, nowMs)) return s;
  return 'rth';
}
/** A first read of a session other than the lead waits while the lead's tape of the same name and grain is wanted and
    has not answered yet — up to LEAD_WAIT_MS from its own first ask — so the first bars on a cold desk are the lead's,
    not behind every other window's. */
function firstReadWaits(s: Slot): boolean {
  const lead = leadSession();
  if (s.session === lead || s.grain === 'day' || s.grain === 'week') return false;
  const now = Date.now();
  const since = firstAsked.get(s) ?? now;
  if (!firstAsked.has(s)) firstAsked.set(s, now);
  if (now - since >= LEAD_WAIT_MS) return false;
  const key = keyOf(s.symbol, s.grain, lead);
  const l = slots.get(key);
  return wanted.has(key) && !!l && l.takenAt === 0 && !l.bars.length && l.state !== 'offline';
}

async function read(s: Slot): Promise<void> {
  /* a room kept mounted behind a page that reads Unusual Whales only asks nothing; Pinpoint reads bars and prints (theta.ts) */
  if (s.busy || thetaUseHere() === 'none') return;
  s.busy = true;
  const key = keyOf(s.symbol, s.grain, s.session);
  /* the lead session's turn first (firstReadWaits): asked again on the next beat */
  let deferred = false;
  try {
    if (!s.keptAsked) {
      s.keptAsked = true;
      if (!s.takenAt) {
        const kept = await keptTheta<Candle[]>(`tape:${key}`);
        if (kept && Array.isArray(kept.data) && kept.data.length && !s.takenAt) {
          s.bars = kept.data;
          s.takenAt = kept.at;
          s.state = thetaDown() ? 'offline' : 'kept';
          emit();
        }
      }
    }
    const daily = s.grain === 'day' || s.grain === 'week';
    const win = tapeWindow(s.grain, s.session);
    const first = !s.from;
    /* a cold chart reads its lead session first (firstReadWaits); the others wait their turn, a few seconds at most */
    if (first && !s.bars.length && firstReadWaits(s)) {
      deferred = true;
      return;
    }
    /* the first read paints the newest chunk; every ten minutes the last sessions again (a late correction); between, today */
    const refresh = !first && Date.now() - s.fullAt > 10 * 60_000;
    const from = first ? win.from : refresh ? (daily && s.session === 'rth' ? daysBack(win.to, 12) : sessionsBack(anchorSession(s.session), REFRESH_SESSIONS)) : ymd();
    let got: Pull;
    if (daily) got = await pullDays(s.symbol, s.session, from, win.to, true);
    else {
      const run: CleanRun = { released: false };
      const raw = await pullIntradayRaw(s.symbol, s.grain as IntraGrain, s.session, from, win.to, cleanFor(key, run));
      /* Nothing on screen yet: ThetaData's bars are drawn the moment they land, and the bad-print cleaner (its trade reads,
         capped) runs after; the bars it mends replace them below — the same bars as reading them cleaned. */
      if (first && !s.bars.length && raw.bars.length) {
        s.bars = raw.bars;
        s.state = 'live';
        emit();
      }
      const cleaned = await raw.clean();
      if (run.released) {
        /* no chart wants the tape any more: nothing half-cleaned is kept, and the next want reads it whole */
        if (first && s.bars === raw.bars) {
          s.bars = [];
          s.state = 'loading';
          emit();
        }
        deferred = true;
        return;
      }
      got = { bars: cleaned, offline: raw.offline };
      if (first && s.bars === raw.bars) s.bars = [];
    }
    const full = first || refresh;
    if (first && !(got.offline && !got.bars.length)) {
      s.from = win.from;
      s.target = win.target;
    }
    if (got.offline && !got.bars.length) {
      if (s.state !== 'offline') {
        s.state = 'offline';
        emit();
      }
      return;
    }
    s.bars = s.bars.length ? sealBars(s.bars, got.bars) : got.bars;
    s.takenAt = Date.now();
    s.state = 'live';
    if (full) s.fullAt = s.takenAt;
    /* kept for the next visit at most once a minute: the newest bars, not a scrolled-back history */
    if (s.takenAt - s.keptAt > 60_000) {
      s.keptAt = s.takenAt;
      keepTheta(`tape:${key}`, s.bars.length > KEEP_BARS ? s.bars.slice(-KEEP_BARS) : s.bars);
    }
    emit();
  } finally {
    s.busy = false;
    s.dueAt = deferred ? 0 : Date.now() + (s.state === 'offline' ? 15_000 : holdMs(s));
  }
}

/** Bars a browser keeps of one tape for its next visit */
const KEEP_BARS = 6000;

/** One older chunk for a slot, merged under what it holds. A failed read waits 15 s; two empty chunks are the start. */
async function readOlder(s: Slot): Promise<void> {
  if (s.olderBusy || s.done || !s.from || s.from <= s.target || thetaUseHere() === 'none') return;
  s.olderBusy = true;
  try {
    const span = olderChunk(s.grain, s.session, s.from, s.target);
    const daily = s.grain === 'day' || s.grain === 'week';
    const run: CleanRun = { released: false };
    const got = daily ? await pullDays(s.symbol, s.session, span.from, span.to, false) : { ...(await pullIntraday(s.symbol, s.grain as IntraGrain, s.session, span.from, span.to, cleanFor(keyOf(s.symbol, s.grain, s.session), run))), none: false };
    /* no chart wants the tape any more: the chunk is dropped, read again when one does */
    if (run.released) return;
    if (got.offline && !got.bars.length) {
      s.olderDueAt = Date.now() + 15_000;
      return;
    }
    s.from = span.from;
    if (got.bars.length) {
      s.emptyRuns = 0;
      s.bars = sealBars(s.bars, got.bars);
      emit();
    } else {
      s.emptyRuns += 1;
      if (got.none || s.emptyRuns >= 2) {
        s.done = true;
        s.target = s.from;
      }
    }
  } finally {
    s.olderBusy = false;
  }
}

/** A chart reached the left edge of a tape: one more chunk of older bars (a month of intraday bars at most, a year of daily
    ones), read on the next beat. False when a chunk is already on its way or the data's start was reached. */
export function extendTape(symbol: string, grain: TapeGrain, session: DeskSession): boolean {
  const s = slots.get(keyOf(symbol.trim().toUpperCase(), grain, session));
  if (!s || s.done || !s.from || s.olderBusy || s.from > s.target) return false;
  s.target = olderChunk(grain, session, s.from).from;
  return true;
}

/** How far back a tape reaches and whether its start was found, for a chart's "loading older bars" state */
export function tapeReach(symbol: string, grain: TapeGrain, session: DeskSession): { from: string; loading: boolean; done: boolean } {
  const s = slots.get(keyOf(symbol.trim().toUpperCase(), grain, session));
  return s ? { from: s.from, loading: s.olderBusy || (!!s.from && s.from > s.target && !s.done), done: s.done } : { from: '', loading: false, done: false };
}

/* One clock for every wanted tape and print: a read when it is due, none while the tab is hidden. */
let clock = 0;
function beat(): void {
  if (pageHidden()) return;
  const now = Date.now();
  for (const key of wanted.keys()) {
    const s = slots.get(key);
    if (s && !s.busy && now >= s.dueAt) void read(s);
    /* older chunks, one at a time per tape, after its first paint */
    else if (s && !s.busy && !s.olderBusy && s.takenAt > 0 && s.from && s.from > s.target && !s.done && now >= s.olderDueAt) void readOlder(s);
  }
  if (printWanted.size) askPrints();
}
function startClock(): void {
  if (clock || typeof window === 'undefined') return;
  clock = window.setInterval(beat, 1000);
  document.addEventListener('visibilitychange', beat);
}
function stopClockIfIdle(): void {
  if (!clock || wanted.size || printWanted.size) return;
  window.clearInterval(clock);
  clock = 0;
  document.removeEventListener('visibilitychange', beat);
}

/** Ask for a tape and keep it fresh until the returned release is called. */
export function wantTape(symbol: string, grain: TapeGrain, session: DeskSession): () => void {
  const name = symbol.trim().toUpperCase();
  if (!name) return () => undefined;
  const key = keyOf(name, grain, session);
  const s = slotOf(name, grain, session);
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  startClock();
  if (!s.busy && Date.now() >= s.dueAt && !pageHidden()) void read(s);
  return () => {
    const n = (wanted.get(key) ?? 1) - 1;
    if (n > 0) wanted.set(key, n);
    else {
      wanted.delete(key);
      slots.trim();
    }
    stopClockIfIdle();
  };
}

/* ---- the book's one-minute bars off this store (audit D3, 2026-10-31) ----
   The book (data/book/load.ts) used to read the vendor's one-minute bars (ohlc/1m?limit=1800) on every load beside the
   chart's ThetaData tapes of the same name and minutes: two bar stores, two sources. On a page that reads ThetaData the
   book now takes the chart's tapes from here, every session's one-minute bars; the vendor's are read only where the
   terminal may not be asked (Pinpoint, the Dossier) or for a name no chart on the page reads. */
const BOOK_SESSIONS: readonly DeskSession[] = ['overnight', 'pre', 'rth', 'post'];

/** A name's one-minute bars as this store holds them, every desk session, oldest first; null until the regular
    session's one-minute tape has been read live (not a kept copy, not while the terminal is down). */
export function heldMinuteBars(symbol: string): Candle[] | null {
  const name = symbol.trim().toUpperCase();
  const rth = slots.get(keyOf(name, '1m', 'rth'));
  if (!rth || !rth.takenAt || rth.state !== 'live' || !rth.bars.length) return null;
  const all: Candle[] = [];
  for (const s of BOOK_SESSIONS) {
    const slot = s === 'rth' ? rth : slots.get(keyOf(name, '1m', s));
    if (slot?.takenAt && slot.state === 'live') all.push(...slot.bars);
  }
  return dedupe(all);
}

/** The book's bars off this store: at once when held; when a chart on the page has asked for them and they have not
    landed, once they land (at most `waitMs`); null when neither — the caller then reads its own. */
export async function bookMinuteBars(symbol: string, waitMs = 10_000): Promise<Candle[] | null> {
  const name = symbol.trim().toUpperCase();
  if (typeof window === 'undefined' || thetaUseHere() !== 'all') return null;
  /* a chart mounting with the book asks for its tapes in the same commit: one beat to hear it */
  await new Promise(resolve => setTimeout(resolve, 50));
  const held = heldMinuteBars(name);
  if (held) return held;
  const rthKey = keyOf(name, '1m', 'rth');
  if (!wanted.has(rthKey)) return null;
  return new Promise(resolve => {
    let off = () => {};
    const finish = (v: Candle[] | null) => {
      off();
      window.clearTimeout(stop);
      resolve(v);
    };
    const check = () => {
      const h = heldMinuteBars(name);
      if (h) return finish(h);
      if (!wanted.has(rthKey) || slots.get(rthKey)?.state === 'offline') finish(null);
    };
    const stop = window.setTimeout(() => finish(heldMinuteBars(name)), waitMs);
    off = subscribeTape(check);
  });
}

const NONE: TapeRead = { bars: [], takenAt: 0, state: 'loading' };

const weekly = new WeakMap<Candle[], TapeRead>();
/** What is held for a tape now, without asking. A weekly tape holds days and is folded to weeks here. */
export function peekTape(symbol: string, grain: TapeGrain, session: DeskSession): TapeRead {
  const s = slots.get(keyOf(symbol.trim().toUpperCase(), grain, session));
  if (!s) return NONE;
  if (grain !== 'week') return s;
  const hit = weekly.get(s.bars);
  if (hit && hit.takenAt === s.takenAt && hit.state === s.state) return hit;
  const out: TapeRead = { bars: foldTo(s.bars, weekClose), takenAt: s.takenAt, state: s.state };
  weekly.set(s.bars, out);
  return out;
}

export function subscribeTape(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const tapeRev = (): number => rev;
/** Re-renders when any tape's bars change (not on every print). */
export function useTapeRev(): number {
  return useSyncExternalStore(subscribeTape, tapeRev, tapeRev);
}

/* The prints are the quote store's readings (data/thetaQuote.ts): its price listeners alone, so a reader of bars is not
   re-rendered by them, nor a print reader by every option mark */
export const subscribePrints = subscribeThetaPrices;
export const printRevNow = (): number => thetaPriceRev();
/** Re-renders when any name's print changes. */
export function usePrintRev(on = true): number {
  return useSyncExternalStore(on ? subscribePrints : noSub, printRevNow, printRevNow);
}
const noSub = () => () => undefined;

/** A tape, kept fresh while the caller is mounted. */
export function useThetaTape(symbol: string, grain: TapeGrain, session: DeskSession, on = true): TapeRead {
  const name = symbol.trim().toUpperCase();
  useEffect(() => (on && name ? wantTape(name, grain, session) : undefined), [name, grain, session, on]);
  useTapeRev();
  return on && name ? peekTape(name, grain, session) : NONE;
}

/** The words a box shows for a tape that is not live: kept, offline, or empty. Null when the bars are live and there. */
export function tapeWords(t: TapeRead, session: DeskSession): string | null {
  if (t.state === 'offline') return offlineWords(t.takenAt);
  if (t.state === 'kept') return `Kept bars · as of ${etClock(t.takenAt)}`;
  if (t.state === 'live' && !t.bars.length) {
    return session === 'overnight'
      ? 'No overnight prints on this feed. The cash close is not shown in its place.'
      : `${sessionMeta(session).label} has no prints on this name.`;
  }
  return null;
}

/* ---- the live print ---- */

export interface Print {
  price: number;
  /** Exchange time, epoch seconds */
  at: number;
  /** The prior regular session's close, 0 until the EOD rows land */
  prev: number;
  /** When this print was read off the terminal, epoch ms */
  readAt: number;
  /** This browser's copy from an earlier read, not this one's */
  kept?: boolean;
}

/* ONE STORE FOR A NAME'S LAST TRADE (audit D1, 2026-10-31). The tape used to read every wanted name's trade snapshot on
   its own (1 s) beside the quote store's read of the same address (3 s): 21 reads a minute a name, and the Terrain tab
   strip (this store) and the nav (the quote store) showing two different moves of one price. The print is now the
   quote store's reading (data/thetaQuote.ts): a wanted print only asks that store to keep the name fresher (printGap),
   and every reader — the forming bar, the tab, the nav, the heads — reads the one reading. */
const printWanted = new Map<string, number>();
/** The tapes held now, least recently used first, and the names whose print is wanted now (scripts/tape-cache-proof.ts) */
export const heldTapeKeys = (): string[] => [...slots.keys()];
export const heldPrintNames = (): string[] => [...printWanted.keys()];

/** A stock's print moves in every session the stock trades (core/session.ts: overnight, pre, regular, after hours); an
    index's from 09:30 to a quarter after the cash close (16:15; 13:15 on an early close), and the VIX through Global
    Trading Hours too (Cboe computes it from 03:15). Outside that they hold. */
export function printLive(symbol: string, nowMs = Date.now()): boolean {
  if (!THETA_INDEX.has(symbol)) return sessionAt(nowMs).open;
  const idx = sessionAt(nowMs, 'indexOption');
  return idx.window?.kind === 'regular' || (symbol === 'VIX' && idx.window?.kind === 'gth');
}
/** How fresh a wanted print is kept: a second while a stock's pre/regular/after tape or an index moves; 15 s overnight
    (the overnight venues are not on this feed yet — a fresh look, not a firehose); a minute when shut. The quote store
    never reads a name more often than this, whoever else asks. */
export function printGap(symbol: string, nowMs = Date.now()): number {
  if (printLive(symbol, nowMs) && (THETA_INDEX.has(symbol) || phaseAt(nowMs) !== 'overnight')) return 1_000;
  if (printLive(symbol, nowMs)) return 15_000;
  return 60_000;
}

function askPrints(): void {
  if (thetaUseHere() === 'none') return;
  for (const name of printWanted.keys()) ensureThetaPrice(name, printGap(name));
}

/** Ask for a name's live print until the returned release is called. */
export function wantPrint(symbol: string): () => void {
  const name = symbol.trim().toUpperCase();
  if (!name) return () => undefined;
  const fresh = !printWanted.has(name);
  printWanted.set(name, (printWanted.get(name) ?? 0) + 1);
  startClock();
  /* a new name is asked at once, not on the next beat */
  if (fresh && !pageHidden() && thetaUseHere() !== 'none') ensureThetaPrice(name, printGap(name));
  return () => {
    const n = (printWanted.get(name) ?? 1) - 1;
    if (n > 0) printWanted.set(name, n);
    else printWanted.delete(name);
    stopClockIfIdle();
  };
}

/* one Print per reading, so a reader comparing objects sees a change only when the reading changed */
const printOf = new WeakMap<ThetaPrice, { live: boolean; print: Print }>();
export function peekPrint(symbol: string): Print | null {
  const held = peekThetaPrice(symbol.trim().toUpperCase());
  if (!held) return null;
  const v = held.value;
  const hit = printOf.get(v);
  if (hit && hit.live === held.live) return hit.print;
  const print: Print = { price: v.price, at: Math.floor(v.at / 1000), prev: v.prevClose ?? 0, readAt: v.read, ...(held.live ? {} : { kept: true }) };
  printOf.set(v, { live: held.live, print });
  return print;
}

/** A name's live print, kept fresh while the caller is mounted. */
export function useThetaPrint(symbol: string, on = true): Print | null {
  const name = symbol.trim().toUpperCase();
  useEffect(() => (on && name ? wantPrint(name) : undefined), [name, on]);
  usePrintRev();
  return on && name ? peekPrint(name) : null;
}

/* ---- the forming bar ---- */

function openSec(atSec: number, session: DeskSession, symbol = ''): number {
  const p = nyParts(atSec * 1000);
  const from = tapeOpenMinute(session, symbol);
  const hour = Math.floor(from / 60);
  const minute = from % 60;
  if (session === 'overnight' && p.hour * 60 + p.minute < sessionMeta(session).to) {
    const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
    utc.setUTCDate(utc.getUTCDate() - 1);
    return Math.floor(nyWallTime(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), hour, minute) / 1000);
  }
  return Math.floor(nyWallTime(p.year, p.month, p.day, hour, minute) / 1000);
}

/** The live print joins the bar it belongs to (opening one when the print is past the last). It never opens a bar in
    another session. `stepSec` is the bar's width; 0 for a daily, -1 for a weekly. */
export function paintPrint(bars: Candle[], price: number, atSec: number, stepSec: number, session: DeskSession, symbol = ''): Candle[] {
  if (!(price > 0) || !(atSec > 0) || !barInTape(atSec, session, symbol)) return bars;
  const last = bars[bars.length - 1];
  let bucket: number;
  if (stepSec <= 0) bucket = stepSec < 0 ? weekClose(atSec) : dayClose(atSec);
  else {
    const open = openSec(atSec, session, symbol);
    bucket = open + Math.floor(Math.max(0, atSec - open) / stepSec) * stepSec;
  }
  if (last && bucket < last.time) return bars;
  const next = bars.slice();
  if (last && last.time === bucket) next[next.length - 1] = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
  else next.push({ time: bucket, open: price, high: price, low: price, close: price, volume: 0 });
  return next;
}

/** A grain's bar width for `paintPrint`. */
export const grainStep = (grain: TapeGrain): number => (grain === 'day' ? 0 : grain === 'week' ? -1 : STEP_SEC[grain] ?? 60);
