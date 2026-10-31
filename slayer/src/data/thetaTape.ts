/* A stock's or an index's bars and its live print from ThetaData, shared by the Terrain, the Weigher and Pinpoint's tape. One store per
   name, grain and session: the first read paints the copy this browser kept (stamped with when it was taken), a
   timer re-reads only today's window while that session trades, and nothing is asked while the tab is hidden. With
   the terminal down the last bars stay on screen and say so; nothing stands in for them. */

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { nyMinutes, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { isTradingDay, isEarlyClose, nyYmd, EARLY_CLOSES, sessionBefore, sessionCloseMinOn } from '../core/calendar';
import { minuteInSession, sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { etClock, keepTheta, keptTheta, noData, offlineWords, pageHidden, thetaDown, thetaGet } from './thetaFeed';
import { thetaUseHere } from './theta';
import { EXT_WINDOWS, cleanExtendedBars } from './thetaEligible';

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
  rth: [{ start: '09:30:00', end: '15:59:59.999' }],
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
  const chunk = cash ? CHUNK[grain] : EXT_DAY_CHUNK;
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
    bars.push({ time: dayClose(Math.floor(at / 1000)), open: num(b.open) || close, high: num(b.high) || close, low: num(b.low) || close, close, volume: num(b.volume) });
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

const root = (symbol: string): 'index' | 'stock' => (THETA_INDEX.has(symbol) ? 'index' : 'stock');

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

export async function pullIntraday(symbol: string, grain: Exclude<TapeGrain, 'day' | 'week'>, session: DeskSession, from: string, to: string): Promise<Pull> {
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
  if (root(symbol) === 'stock' && (session === 'pre' || session === 'post')) {
    return { bars: await cleanExtendedBars(thetaGet, symbol, wins[0], STEP_SEC[grain] ?? 60, bars), offline };
  }
  return { bars, offline };
}

async function pullEod(symbol: string, from: string, to: string): Promise<Pull> {
  const got = await thetaGet(`/${root(symbol)}/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${from}&end_date=${to}&format=json`);
  if (got.error) return { bars: [], offline: !noData(got) };
  return { bars: readEod(got.data), offline: false };
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

const slots = new Map<string, Slot>();
const wanted = new Map<string, number>();
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const keyOf = (symbol: string, grain: TapeGrain, session: DeskSession) => `${symbol}|${grain}|${session}`;

/** The session trades now (its window, on a trading day). */
function sessionLive(session: DeskSession): boolean {
  const p = nyParts();
  const trading = isTradingDay(new Date(p.year, p.month - 1, p.day));
  if (!trading) return false;
  const min = p.hour * 60 + p.minute;
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  /* After the early close, post is the session that is open. Regular's bars stay on the tape; the cash session is not live. */
  if (isEarlyClose(iso) && session === 'post' && min >= 13 * 60 && min < 20 * 60) return true;
  if (sessionOfMinute(min) !== session) return false;
  if (session === 'rth' && isEarlyClose(iso) && min >= 13 * 60) return false;
  return true;
}

/** How long a read holds: a trading session's bars are re-read every 15 s, a closed one's every 5 minutes. */
const holdMs = (s: Slot): number => (sessionLive(s.session) ? (s.grain === 'day' || s.grain === 'week' ? 60_000 : 15_000) : 5 * 60_000);

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

async function read(s: Slot): Promise<void> {
  /* a room kept mounted behind a page that reads Unusual Whales only asks nothing; Pinpoint reads bars and prints (theta.ts) */
  if (s.busy || thetaUseHere() === 'none') return;
  s.busy = true;
  const key = keyOf(s.symbol, s.grain, s.session);
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
    /* the first read paints the newest chunk; every ten minutes the last sessions again (a late correction); between, today */
    const refresh = !first && Date.now() - s.fullAt > 10 * 60_000;
    const from = first ? win.from : refresh ? (daily && s.session === 'rth' ? daysBack(win.to, 12) : sessionsBack(anchorSession(s.session), REFRESH_SESSIONS)) : ymd();
    const got = daily ? await pullDays(s.symbol, s.session, from, win.to, true) : await pullIntraday(s.symbol, s.grain as IntraGrain, s.session, from, win.to);
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
    s.dueAt = Date.now() + (s.state === 'offline' ? 15_000 : holdMs(s));
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
    const got = daily ? await pullDays(s.symbol, s.session, span.from, span.to, false) : { ...(await pullIntraday(s.symbol, s.grain as IntraGrain, s.session, span.from, span.to)), none: false };
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
  if (printWanted.size && !printsBusy && now >= printsDue) void readPrints();
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
    else wanted.delete(key);
    stopClockIfIdle();
  };
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

/* The prints move every second in the session: their own listeners, so a reader of bars alone is not re-rendered by them */
const printListeners = new Set<() => void>();
let printRev = 0;
const emitPrint = () => {
  printRev += 1;
  printListeners.forEach(fn => fn());
};
export function subscribePrints(fn: () => void): () => void {
  printListeners.add(fn);
  return () => printListeners.delete(fn);
}
export const printRevNow = (): number => printRev;
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

interface PrintSlot {
  print: Print | null;
  prevAt: number;
  prev: number;
  keptAt: number;
}

const prints = new Map<string, PrintSlot>();
const printWanted = new Map<string, number>();

/** A stock's print moves from 04:00 to 20:00 New York on a trading day, an index's from 09:30 to a quarter after the cash
    close (16:15; 13:15 on an early close); outside that they hold. */
function printLive(symbol: string): boolean {
  const p = nyParts();
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return false;
  const m = nyMinutes();
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return THETA_INDEX.has(symbol) ? m >= 9 * 60 + 30 && m < (isEarlyClose(iso) ? 13 * 60 : 16 * 60) + 15 : m >= 4 * 60 && m < 20 * 60;
}

/* Every wanted name's print, one read a name (the same address for every viewer, so the server shares it); each name's
   prior close once in 30 minutes. */
let printsBusy = false;
let printsDue = 0;
/* every read failing for a reason other than a down terminal: 15 s before the next, doubling to a minute, cleared by an answer */
let printsFailGap = 0;
async function readPrints(): Promise<void> {
  if (printsBusy || thetaUseHere() === 'none') return;
  printsBusy = true;
  const names = [...printWanted.keys()];
  try {
    await Promise.all(
      names.map(async symbol => {
        const slot = prints.get(symbol);
        if (!slot || Date.now() - slot.prevAt < 30 * 60_000) return;
        const eod = await pullEod(symbol, ymd(Date.now() - 12 * 86_400_000), ymd());
        if (eod.offline) return;
        slot.prevAt = Date.now();
        const before = eod.bars.filter(b => b.time < dayClose(Math.floor(Date.now() / 1000)));
        if (before.length) slot.prev = before[before.length - 1].close;
      }),
    );
    const reads = await Promise.all(
      names.map(n => thetaGet(THETA_INDEX.has(n) ? `/index/snapshot/price?symbol=${encodeURIComponent(n)}&format=json` : `/stock/snapshot/trade?symbol=${encodeURIComponent(n)}&format=json`, true)),
    );
    let moved = false;
    printsFailGap = reads.length && reads.every(got => got.error && got.error !== 'terminal_down') ? Math.min(60_000, printsFailGap ? printsFailGap * 2 : 15_000) : 0;
    reads.forEach((got, i) => {
      if (got.error) return;
      for (const row of flatRows(got.data).slice(-1)) {
        const symbol = names[i];
        const slot = prints.get(symbol);
        const price = num(row.price ?? row.last ?? row.close);
        const at = Math.floor(nyWallStamp(row.timestamp) / 1000);
        if (!slot || !(price > 0) || !(at > 0)) continue;
        const was = slot.print;
        if (!was || was.kept || was.price !== price || was.at !== at || was.prev !== slot.prev) {
          slot.print = { price, at, prev: slot.prev, readAt: Date.now() };
          moved = true;
          /* kept for the next visit, at most twice a minute */
          if (Date.now() - slot.keptAt > 30_000) {
            slot.keptAt = Date.now();
            keepTheta(`print:${symbol}`, slot.print);
          }
        }
      }
    });
    if (moved) emitPrint();
  } finally {
    printsBusy = false;
    printsDue = Date.now() + (thetaDown() ? 15_000 : printsFailGap || (names.some(printLive) ? 1_000 : 60_000));
  }
}

/** Ask for a name's live print until the returned release is called. */
export function wantPrint(symbol: string): () => void {
  const name = symbol.trim().toUpperCase();
  if (!name) return () => undefined;
  const fresh = !printWanted.has(name);
  if (!prints.has(name)) {
    const slot: PrintSlot = { print: null, prevAt: 0, prev: 0, keptAt: 0 };
    prints.set(name, slot);
    void keptTheta<Print>(`print:${name}`).then(kept => {
      if (!kept || slot.print || !(kept.data?.price > 0)) return;
      slot.print = { ...kept.data, kept: true };
      emitPrint();
    });
  }
  printWanted.set(name, (printWanted.get(name) ?? 0) + 1);
  startClock();
  /* a new name is read on the next beat with the others */
  if (fresh) printsDue = 0;
  return () => {
    const n = (printWanted.get(name) ?? 1) - 1;
    if (n > 0) printWanted.set(name, n);
    else printWanted.delete(name);
    stopClockIfIdle();
  };
}

export function peekPrint(symbol: string): Print | null {
  return prints.get(symbol.trim().toUpperCase())?.print ?? null;
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
