/* A stock's or an index's bars and its live print from ThetaData, shared by the Terrain, the Weigher and Pinpoint's tape. One store per
   name, grain and session: the first read paints the copy this browser kept (stamped with when it was taken), a
   timer re-reads only today's window while that session trades, and nothing is asked while the tab is hidden. With
   the terminal down the last bars stay on screen and say so; nothing stands in for them. */

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { nyMinutes, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { isTradingDay, nyYmd } from '../core/calendar';
import { minuteInSession, sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { etClock, keepTheta, keptTheta, noData, offlineWords, pageHidden, thetaDown, thetaGet } from './thetaFeed';
import { thetaUseHere } from './theta';
import { EXT_WINDOWS, cleanExtendedBars } from './thetaEligible';

export const THETA_INDEX = new Set(['SPX', 'VIX', 'RUT', 'NDX', 'XSP']);

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

/** Calendar days of history per grain. 15-second history is asked one day at a time. */
const DAYS: Record<Exclude<TapeGrain, 'day' | 'week'>, number> = { '15s': 1, '1m': 6, '5m': 12, '15m': 25, '30m': 40, '1h': 56 };
const STEP_SEC: Partial<Record<TapeGrain, number>> = { '15s': 15, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 };

const ymd = (at = Date.now()): string => nyYmd(at);

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

/** Bars folded into the bucket `keyOf` names: first open, highest high, lowest low, last close, summed volume. */
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

/** Intraday rows in one session, oldest first, one bar per stamp. A bar with no price is not a bar. */
export function readOhlc(data: unknown, session: DeskSession): Candle[] {
  const bars: Candle[] = [];
  for (const b of flatRows(data)) {
    const at = nyWallStamp(b.timestamp ?? b.time);
    const close = num(b.close);
    const open = num(b.open) || close;
    const high = num(b.high) || close;
    const low = num(b.low) || close;
    if (!at || !(close > 0) || !(high > 0) || !(low > 0)) continue;
    const time = Math.floor(at / 1000);
    if (!minuteInSession(nyMinutes(time * 1000), session)) continue;
    bars.push({ time, open, high, low, close, volume: num(b.volume) });
  }
  return dedupe(bars);
}

/** EOD rows as daily bars at 16:00 New York. */
export function readEod(data: unknown): Candle[] {
  const bars: Candle[] = [];
  for (const b of flatRows(data)) {
    const at = nyWallStamp(b.last_trade ?? b.created ?? b.timestamp ?? b.date);
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

/** One intraday grain over [from, to], every window of the session. 15-second history is one day per call. */
/** [from, to] as spans the terminal takes in one read: a month at most, and one day for a grain under a minute. */
export function spansOf(from: string, to: string, grain: Exclude<TapeGrain, 'day' | 'week'>): [string, string][] {
  const asMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  const asYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const width = grain === '15s' ? 1 : 28;
  const out: [string, string][] = [];
  for (let at = asMs(to); at >= asMs(from); at -= width * 86_400_000) {
    const start = Math.max(asMs(from), at - (width - 1) * 86_400_000);
    out.push([asYmd(start), asYmd(at)]);
  }
  return out.reverse();
}

export async function pullIntraday(symbol: string, grain: Exclude<TapeGrain, 'day' | 'week'>, session: DeskSession, from: string, to: string): Promise<Pull> {
  const got = await Promise.all(
    spansOf(from, to, grain).flatMap(([start, end]) =>
      WINDOWS[session].map(win =>
        thetaGet(`/${root(symbol)}/history/ohlc?symbol=${encodeURIComponent(symbol)}&start_date=${start}&end_date=${end}&interval=${grain}&start_time=${win.start}&end_time=${win.end}&format=json`),
      ),
    ),
  );
  const offline = got.some(g => g.error != null && !noData(g));
  const bars = dedupe(got.flatMap(g => (g.error ? [] : readOhlc(g.data, session))));
  /* a stock's pre-market and after-hours bars take their prices from the prints that may set one (late reports at an
     old price do not; data/thetaEligible.ts) — the regular session is ThetaData's bars as they come */
  if (root(symbol) === 'stock' && (session === 'pre' || session === 'post')) {
    return { bars: await cleanExtendedBars(thetaGet, symbol, WINDOWS[session][0], STEP_SEC[grain] ?? 60, bars), offline };
  }
  return { bars, offline };
}

async function pullEod(symbol: string, from: string, to: string): Promise<Pull> {
  const got = await thetaGet(`/${root(symbol)}/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${from}&end_date=${to}&format=json`);
  if (got.error) return { bars: [], offline: !noData(got) };
  return { bars: readEod(got.data), offline: false };
}

/** Daily or weekly bars: the EOD rows, with today's regular session folded from its 5-minute bars until its EOD row lands. */
async function pullDays(symbol: string, grain: 'day' | 'week', session: DeskSession): Promise<Pull> {
  const to = ymd();
  if (session === 'rth') {
    const [daily, today] = await Promise.all([pullEod(symbol, ymd(Date.now() - 400 * 86_400_000), to), pullIntraday(symbol, '5m', 'rth', to, to)]);
    const byTime = new Map(daily.bars.map(b => [b.time, b]));
    for (const b of foldTo(today.bars, dayClose)) if (!byTime.has(b.time)) byTime.set(b.time, b);
    const days = [...byTime.values()].sort((a, b) => a.time - b.time);
    return { bars: grain === 'week' ? foldTo(days, weekClose) : days, offline: daily.offline || today.offline };
  }
  const intra = await pullIntraday(symbol, '5m', session, ymd(Date.now() - 40 * 86_400_000), to);
  const days = foldTo(intra.bars, dayClose);
  return { bars: grain === 'week' ? foldTo(days, weekClose) : days, offline: intra.offline };
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
  return trading && sessionOfMinute(nyMinutes()) === session;
}

/** How long a read holds: a trading session's bars are re-read every 15 s, a closed one's every 5 minutes. */
const holdMs = (s: Slot): number => (sessionLive(s.session) ? (s.grain === 'day' || s.grain === 'week' ? 60_000 : 15_000) : 5 * 60_000);

function slotOf(symbol: string, grain: TapeGrain, session: DeskSession): Slot {
  const key = keyOf(symbol, grain, session);
  let s = slots.get(key);
  if (!s) {
    s = { symbol, grain, session, bars: [], takenAt: 0, state: 'loading', fullAt: 0, dueAt: 0, busy: false, keptAsked: false, keptAt: 0 };
    slots.set(key, s);
  }
  return s;
}

function merge(old: Candle[], fresh: Candle[]): Candle[] {
  if (!fresh.length) return old;
  if (!old.length) return fresh;
  const from = fresh[0].time;
  const keep = old.filter(b => b.time < from);
  return keep.length ? keep.concat(fresh) : fresh;
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
    const to = ymd();
    /* the full window once every ten minutes; between, today alone, merged onto what is held */
    const full = !s.fullAt || Date.now() - s.fullAt > 10 * 60_000 || s.grain === 'day' || s.grain === 'week' || !s.bars.length;
    const got =
      s.grain === 'day' || s.grain === 'week'
        ? await pullDays(s.symbol, s.grain, s.session)
        : await pullIntraday(s.symbol, s.grain, s.session, full ? ymd(Date.now() - DAYS[s.grain] * 86_400_000) : to, to);
    if (got.offline && !got.bars.length) {
      if (s.state !== 'offline') {
        s.state = 'offline';
        emit();
      }
      return;
    }
    s.bars = full ? got.bars : merge(s.bars, got.bars);
    s.takenAt = Date.now();
    s.state = 'live';
    if (full) s.fullAt = s.takenAt;
    /* kept for the next visit at most once a minute */
    if (s.takenAt - s.keptAt > 60_000) {
      s.keptAt = s.takenAt;
      keepTheta(`tape:${key}`, s.bars);
    }
    emit();
  } finally {
    s.busy = false;
    s.dueAt = Date.now() + (s.state === 'offline' ? 15_000 : holdMs(s));
  }
}

/* One clock for every wanted tape and print: a read when it is due, none while the tab is hidden. */
let clock = 0;
function beat(): void {
  if (pageHidden()) return;
  const now = Date.now();
  for (const key of wanted.keys()) {
    const s = slots.get(key);
    if (s && !s.busy && now >= s.dueAt) void read(s);
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

/** What is held for a tape now, without asking. */
export function peekTape(symbol: string, grain: TapeGrain, session: DeskSession): TapeRead {
  return slots.get(keyOf(symbol.trim().toUpperCase(), grain, session)) ?? NONE;
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
  if (t.state === 'live' && !t.bars.length) return `${sessionMeta(session).label} has no prints on this name.`;
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

/** A stock's print and an index's price move from 04:00 to 20:00 New York on a trading day; outside that they hold. */
function printLive(symbol: string): boolean {
  const p = nyParts();
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return false;
  const m = nyMinutes();
  return THETA_INDEX.has(symbol) ? m >= 9 * 60 + 30 && m < 16 * 60 + 15 : m >= 4 * 60 && m < 20 * 60;
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

function openSec(atSec: number, session: DeskSession): number {
  const p = nyParts(atSec * 1000);
  const meta = sessionMeta(session);
  const hour = Math.floor(meta.from / 60);
  const minute = meta.from % 60;
  if (session === 'overnight' && p.hour * 60 + p.minute < meta.to) {
    const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
    utc.setUTCDate(utc.getUTCDate() - 1);
    return Math.floor(nyWallTime(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), hour, minute) / 1000);
  }
  return Math.floor(nyWallTime(p.year, p.month, p.day, hour, minute) / 1000);
}

/** The live print joins the bar it belongs to (opening one when the print is past the last). It never opens a bar in
    another session. `stepSec` is the bar's width; 0 for a daily, -1 for a weekly. */
export function paintPrint(bars: Candle[], price: number, atSec: number, stepSec: number, session: DeskSession): Candle[] {
  if (!(price > 0) || !(atSec > 0) || !minuteInSession(nyMinutes(atSec * 1000), session)) return bars;
  const last = bars[bars.length - 1];
  let bucket: number;
  if (stepSec <= 0) bucket = stepSec < 0 ? weekClose(atSec) : dayClose(atSec);
  else {
    const open = openSec(atSec, session);
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
