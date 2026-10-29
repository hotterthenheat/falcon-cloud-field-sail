/* The backtest's market: past sessions as ThetaData recorded them. The underlying's one-minute bars, the contracts
   quoted that day, and each contract's national best bid and offer at the end of every minute. Nothing here is made
   up: a minute with no quote has none, and the engine waits on it.

   Each answer is loaded once (in memory, and kept in this browser's store, since a past day never changes) and then
   read synchronously by the engine and the desk. */

import { isTradingDay, isoDate, MONTHS } from '../../core/calendar';
import { nyParts } from '../../core/nyTime';
import { thetaCall } from '../theta';
import { readSaved, save as keep } from '../uwStore';
import type { Candle } from '../../types/market';

/** Minutes in a session, and the minute the bell rings on (the last bar's index) */
export const DAY_MIN = 390;
export const LAST_MIN = DAY_MIN - 1;
/** Strikes each side of the money a chain's day is loaded with */
export const CHAIN_SPAN = 14;

/* ---- days ---- */
export const dateOf = (iso: string): Date => new Date(`${iso}T12:00:00`);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mar 14" · "Fri, Mar 14, 2025" */
export const dayWords = (iso: string, long = false): string => {
  const d = dateOf(iso);
  return long ? `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
/** "09:31" for minute 0 … "16:00" for the bell. A cursor on minute m stands at the END of that bar: m + 1 minutes in. */
export const clockWords = (minute: number): string => {
  const t = 9 * 60 + 30 + minute + 1;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const ymd = (iso: string) => iso.replace(/-/g, '');
const step = (iso: string, by: 1 | -1): string => {
  const d = dateOf(iso);
  for (let i = 0; i < 12; i++) {
    d.setDate(d.getDate() + by);
    if (isTradingDay(d)) break;
  }
  return isoDate(d);
};

/** The newest session that has finished: today once New York has passed 16:20, else the session before */
export function lastReplayDay(now = Date.now()): string {
  const p = nyParts(now);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (isTradingDay(dateOf(today)) && p.hour * 60 + p.minute >= 16 * 60 + 20) return today;
  return step(today, -1);
}
/** The oldest session this key's option quote history reaches, found once and kept (localStorage) */
let firstDay: string | null = null;
const FIRST_KEY = 'slayer_replay_first_v1';
try {
  firstDay = typeof localStorage !== 'undefined' ? localStorage.getItem(FIRST_KEY) : null;
} catch {
  firstDay = null;
}
/** The days a session can be opened on: every session from the oldest the quotes reach to the newest finished one */
export function replayWindow(now = Date.now()): { first: string | null; last: string } {
  return { first: firstDay, last: lastReplayDay(now) };
}
export const isReplayDay = (iso: string, now = Date.now()): boolean => {
  const w = replayWindow(now);
  return isTradingDay(dateOf(iso)) && iso <= w.last && (w.first == null || iso >= w.first);
};
/** The session after this one, or null past the newest finished one */
export const nextDay = (iso: string, now = Date.now()): string | null => {
  const n = step(iso, 1);
  return n <= lastReplayDay(now) ? n : null;
};
/** The session after this one, with no bound (the engine walks the days a move covers) */
export const sessionAfter = (iso: string): string => step(iso, 1);
/** The session before this one */
export const prevDay = (iso: string): string => step(iso, -1);
/** Sessions from `a` to `b`, both in */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = isTradingDay(dateOf(a)) ? a : step(a, 1); d <= b && out.length < 400; d = step(d, 1)) out.push(d);
  return out;
}
/** A day as one number (days since 1970), for ordering moments across days without a window */
export const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/* 09:30 in New York on a date, as a real instant (seconds). The guess is winter's (14:30 UTC); New York's clock at that
   instant says whether the date is in summer time. The clocks change at 02:00 on a Sunday, never inside a session. */
const opens = new Map<string, number>();
function openEpoch(iso: string): number {
  const hit = opens.get(iso);
  if (hit != null) return hit;
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 14, 30);
  const at = guess / 1000 - (nyParts(guess).hour - 9) * 3600;
  opens.set(iso, at);
  return at;
}
/** A bar's stamp: the real instant its New York minute began */
export const barTime = (iso: string, minute: number): number => openEpoch(iso) + minute * 60;

/* ---- the store's pulse ---- */
let rev = 0;
const heard = new Set<() => void>();
const emit = () => {
  rev++;
  heard.forEach(fn => fn());
};
export const subscribeHistory = (fn: () => void) => {
  heard.add(fn);
  return () => {
    heard.delete(fn);
  };
};
export const historyRev = () => rev;

/** Where a piece of the past stands: here, on its way, not recorded (no quote that day), or the terminal is away */
export type Need = 'ready' | 'loading' | 'none' | 'offline';
let offlineSince = 0;
/** The terminal did not answer the last ask: since when (ms), or 0 */
export const historyOffline = (): number => offlineSince;

/* ---- answers ---- */
type Row = Record<string, unknown>;
/** v3 answers either flat rows, or one item a contract with its rows under `data`: both become flat rows */
export function flatRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  const out: Row[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Row;
    if (Array.isArray(o.data)) {
      const head = o.contract && typeof o.contract === 'object' ? (o.contract as Row) : o;
      for (const d of o.data as Row[]) if (d && typeof d === 'object') out.push({ ...head, ...d, data: undefined });
    } else out.push(o);
  }
  return out;
}
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};
/** Minutes past New York's 09:30 of a v3 stamp ("2026-10-28T09:31:00.000"), read off the wall clock it is written in */
const minuteOfStamp = (stamp: unknown): number => {
  const m = typeof stamp === 'string' ? /T(\d{2}):(\d{2})/.exec(stamp) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) - (9 * 60 + 30) : NaN;
};

const inflight = new Map<string, Promise<unknown>>();
/** One kept-or-fetched answer, parsed once. `keepAs` is what is saved (a past day's answer is final). */
async function load<T>(key: string, path: string, parse: (rows: Row[]) => T | null): Promise<{ value: T | null; offline: boolean }> {
  const running = inflight.get(key) as Promise<{ value: T | null; offline: boolean }> | undefined;
  if (running) return running;
  const job = (async () => {
    const kept = await readSaved(`theta:${key}`);
    if (kept && kept.data != null) return { value: kept.data as T, offline: false };
    const got = await thetaCall(path, true);
    /* 472 is ThetaData's NO_DATA: nothing was recorded for the ask, an answer like any other */
    if (got.status === 472) {
      keep(`theta:${key}`, 200, { none: true });
      return { value: null, offline: false };
    }
    if (got.error === 'terminal_down' || got.status === 401) {
      if (!offlineSince) offlineSince = Date.now();
      return { value: null, offline: true };
    }
    offlineSince = 0;
    const value = got.error ? null : parse(flatRows(got.data));
    /* an empty answer is kept too: the contract did not quote that day, and asking again will not change it */
    keep(`theta:${key}`, 200, value ?? { none: true });
    return { value, offline: false };
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}
const isNone = (v: unknown) => !!v && typeof v === 'object' && (v as { none?: boolean }).none === true;

/* ---- the underlying's bars ---- */
interface DayBars {
  bars: Candle[];
  /** The index of the session's last real bar (an early close stops before 389) */
  last: number;
}
const bars = new Map<string, DayBars | null>();
const barsWant = new Map<string, Need>();
const INDEXES = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP']);

export function parseBars(day: string, rows: Row[]): DayBars | null {
  const at = new Array<Candle | null>(DAY_MIN).fill(null);
  for (const r of rows) {
    const m = minuteOfStamp(r.timestamp);
    const close = num(r.close ?? r.price);
    if (!(m >= 0 && m < DAY_MIN) || !(close > 0)) continue;
    const open = num(r.open);
    const high = num(r.high);
    const low = num(r.low);
    at[m] = { time: barTime(day, m), open: open > 0 ? open : close, high: high > 0 ? high : close, low: low > 0 ? low : close, close, volume: num(r.volume) || 0 };
  }
  let last = -1;
  for (let m = DAY_MIN - 1; m >= 0; m--) if (at[m]) { last = m; break; }
  if (last < 0) return null;
  /* a minute with no trade carries the last price flat, with no volume (said as such: no volume) */
  const out: Candle[] = [];
  const first = at.find(Boolean)!;
  let flat = first.open;
  for (let m = 0; m <= last; m++) {
    const b = at[m];
    if (b) {
      out.push(b);
      flat = b.close;
    } else out.push({ time: barTime(day, m), open: flat, high: flat, low: flat, close: flat, volume: 0 });
  }
  return { bars: out, last };
}

/** Load a name's bars for a day. Resolves true when they are here. */
export async function ensureBars(ticker: string, day: string): Promise<boolean> {
  const t = ticker.toUpperCase();
  const key = `bars|${t}|${day}`;
  if (bars.has(key)) return bars.get(key) != null;
  barsWant.set(key, 'loading');
  const root = INDEXES.has(t) ? 'index' : 'stock';
  const path = root === 'index' ? `/index/history/price?symbol=${encodeURIComponent(t)}&date=${ymd(day)}&interval=1m&format=json` : `/stock/history/ohlc?symbol=${encodeURIComponent(t)}&date=${ymd(day)}&interval=1m&format=json`;
  const got = await load(key, path, rows => parseBars(day, rows));
  if (got.offline) {
    barsWant.set(key, 'offline');
    emit();
    return false;
  }
  const v = got.value && !isNone(got.value) ? (got.value as DayBars) : null;
  bars.set(key, v);
  barsWant.set(key, v ? 'ready' : 'none');
  emit();
  return v != null;
}
/** Load a name's bars for every session from `from` to `to` in one ask (the chart's days behind the clock) */
export async function ensureBarsRange(ticker: string, from: string, to: string): Promise<void> {
  const t = ticker.toUpperCase();
  const days = daysBetween(from, to).filter(d => !bars.has(`bars|${t}|${d}`));
  if (!days.length) return;
  /* what this browser kept, day by day */
  const kept = await Promise.all(days.map(d => readSaved(`theta:bars|${t}|${d}`)));
  const missing: string[] = [];
  days.forEach((d, i) => {
    const k = kept[i];
    if (k && k.data != null) {
      const v = isNone(k.data) ? null : (k.data as DayBars);
      bars.set(`bars|${t}|${d}`, v);
      barsWant.set(`bars|${t}|${d}`, v ? 'ready' : 'none');
    } else missing.push(d);
  });
  if (!missing.length) return emit();
  const a = missing[0];
  const b = missing[missing.length - 1];
  const key = `range|${t}|${a}|${b}`;
  if (inflight.has(key)) {
    await inflight.get(key);
    return;
  }
  const job = (async () => {
    const root = INDEXES.has(t) ? 'index' : 'stock';
    const what = root === 'index' ? 'price' : 'ohlc';
    const got = await thetaCall(`/${root}/history/${what}?symbol=${encodeURIComponent(t)}&start_date=${ymd(a)}&end_date=${ymd(b)}&interval=1m&format=json`, true);
    if (got.status !== 472 && (got.error === 'terminal_down' || got.status === 401)) {
      if (!offlineSince) offlineSince = Date.now();
      return;
    }
    offlineSince = 0;
    if (got.error && got.status !== 472) return;
    const byDay = new Map<string, Row[]>();
    for (const r of flatRows(got.data)) {
      const d = typeof r.timestamp === 'string' ? r.timestamp.slice(0, 10) : '';
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    }
    for (const d of missing) {
      const v = parseBars(d, byDay.get(d) ?? []);
      bars.set(`bars|${t}|${d}`, v);
      barsWant.set(`bars|${t}|${d}`, v ? 'ready' : 'none');
      keep(`theta:bars|${t}|${d}`, 200, v ?? { none: true });
    }
  })();
  inflight.set(key, job);
  try {
    await job;
  } finally {
    inflight.delete(key);
    emit();
  }
}
/** Has the day's bars been answered (with bars, or with none) */
export const barsKnown = (ticker: string, day: string): boolean => bars.has(`bars|${ticker.toUpperCase()}|${day}`);
export const barsNeed = (ticker: string, day: string): Need => barsWant.get(`bars|${ticker.toUpperCase()}|${day}`) ?? 'loading';
/** The name's bars for a day, oldest first — empty until they are loaded */
export const dayBars = (ticker: string, day: string): Candle[] => bars.get(`bars|${ticker.toUpperCase()}|${day}`)?.bars ?? [];
/** The last minute the name traded that day (389 on a full session) — or −1 until loaded */
export const closeMinOf = (ticker: string, day: string): number => bars.get(`bars|${ticker.toUpperCase()}|${day}`)?.last ?? -1;
/** Where the name stood at the end of a minute (NaN until its bars are loaded) */
export function spotAt(ticker: string, day: string, minute: number): number {
  const b = dayBars(ticker, day);
  if (!b.length) return NaN;
  return b[Math.max(0, Math.min(b.length - 1, minute))].close;
}

/* ---- what was quoted that day ---- */
export interface Listing {
  /** Expiries at or after the day, nearest first */
  expiries: string[];
  /** Strikes by expiry and right ("2026-10-30|C"), lowest first */
  strikes: Record<string, number[]>;
}
const listings = new Map<string, Listing | null>();
const listWant = new Map<string, Need>();
export function parseListing(day: string, rows: Row[]): Listing | null {
  const by = new Map<string, Set<number>>();
  const exps = new Set<string>();
  for (const r of rows) {
    const exp = String(r.expiration ?? '').slice(0, 10);
    const k = num(r.strike);
    const right = String(r.right ?? '').toUpperCase().startsWith('C') ? 'C' : String(r.right ?? '').toUpperCase().startsWith('P') ? 'P' : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp < day || !(k > 0) || !right) continue;
    exps.add(exp);
    const key = `${exp}|${right}`;
    if (!by.has(key)) by.set(key, new Set());
    by.get(key)!.add(k);
  }
  if (!exps.size) return null;
  const strikes: Record<string, number[]> = {};
  for (const [k, set] of by) strikes[k] = [...set].sort((a, b) => a - b);
  return { expiries: [...exps].sort(), strikes };
}
export async function ensureListing(ticker: string, day: string): Promise<boolean> {
  const t = ticker.toUpperCase();
  const key = `list|${t}|${day}`;
  if (listings.has(key)) return listings.get(key) != null;
  listWant.set(key, 'loading');
  const got = await load(key, `/option/list/contracts/quote?symbol=${encodeURIComponent(t)}&date=${ymd(day)}&format=json`, rows => parseListing(day, rows));
  if (got.offline) {
    listWant.set(key, 'offline');
    emit();
    return false;
  }
  const v = got.value && !isNone(got.value) ? (got.value as Listing) : null;
  listings.set(key, v);
  listWant.set(key, v ? 'ready' : 'none');
  emit();
  return v != null;
}
export const listingOf = (ticker: string, day: string): Listing | null => listings.get(`list|${ticker.toUpperCase()}|${day}`) ?? null;
export const listingNeed = (ticker: string, day: string): Need => listWant.get(`list|${ticker.toUpperCase()}|${day}`) ?? 'loading';

/* ---- a contract's quotes through a day ---- */
export interface Leg {
  ticker: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
}
/** One leg's day: its bid and ask at the end of every minute (NaN where none stood) */
interface LegDay {
  bid: number[];
  ask: number[];
}
export const legKey = (c: Leg) => `${c.ticker.toUpperCase()}|${c.expiry}|${+c.strike.toFixed(3)}|${c.right}`;
const legs = new Map<string, LegDay | null>();
const legWant = new Map<string, Need>();
/* A v3 interval quote row is the NBBO standing at its stamp: the 09:31:00 row is the quote at the end of minute 0. */
const quoteMinute = (stamp: unknown) => minuteOfStamp(stamp) - 1;
function emptyDay(): LegDay {
  return { bid: new Array<number>(DAY_MIN).fill(NaN), ask: new Array<number>(DAY_MIN).fill(NaN) };
}
/** Rows of one day's quotes, any number of contracts, by leg */
export function parseQuotes(ticker: string, rows: Row[], only?: Leg): Map<string, LegDay> {
  const out = new Map<string, LegDay>();
  for (const r of rows) {
    const m = quoteMinute(r.timestamp);
    if (!(m >= 0 && m < DAY_MIN)) continue;
    const exp = String(r.expiration ?? only?.expiry ?? '').slice(0, 10);
    const k = num(r.strike ?? only?.strike);
    const rw = String(r.right ?? only?.right ?? '').toUpperCase();
    const right = rw.startsWith('C') ? 'C' : rw.startsWith('P') ? 'P' : '';
    if (!exp || !(k > 0) || !right) continue;
    const key = legKey({ ticker, expiry: exp, strike: k, right });
    let d = out.get(key);
    if (!d) out.set(key, (d = emptyDay()));
    const bid = num(r.bid);
    const ask = num(r.ask);
    /* a one-sided or crossed print is no market */
    if (bid >= 0 && ask > 0 && ask >= bid) {
      d.bid[m] = bid;
      d.ask[m] = ask;
    }
  }
  return out;
}
const pack = (d: LegDay) => ({ b: d.bid.map(v => (Number.isFinite(v) ? v : -1)), a: d.ask.map(v => (Number.isFinite(v) ? v : -1)) });
const unpack = (p: { b: number[]; a: number[] }): LegDay => ({ bid: p.b.map(v => (v >= 0 ? v : NaN)), ask: p.a.map(v => (v > 0 ? v : NaN)) });
const hasAny = (d: LegDay) => d.ask.some(v => v > 0);

/** Load one contract's quotes for a day */
export async function ensureLeg(c: Leg, day: string): Promise<boolean> {
  const key = `leg|${legKey(c)}|${day}`;
  if (legs.has(key)) return legs.get(key) != null;
  legWant.set(key, 'loading');
  const t = c.ticker.toUpperCase();
  const path = `/option/history/quote?symbol=${encodeURIComponent(t)}&expiration=${ymd(c.expiry)}&strike=${c.strike.toFixed(2)}&right=${c.right === 'C' ? 'call' : 'put'}&date=${ymd(day)}&interval=1m&format=json`;
  const got = await load(key, path, rows => {
    const one = parseQuotes(t, rows, c).get(legKey(c));
    return one && hasAny(one) ? pack(one) : null;
  });
  if (got.offline) {
    legWant.set(key, 'offline');
    emit();
    return false;
  }
  const v = got.value && !isNone(got.value) ? unpack(got.value as { b: number[]; a: number[] }) : null;
  legs.set(key, v);
  legWant.set(key, v ? 'ready' : 'none');
  emit();
  return v != null;
}

/** Load one expiry's chain for a day: every strike within CHAIN_SPAN of the money, both rights, every minute */
const chains = new Map<string, Need>();
export async function ensureChainDay(ticker: string, expiry: string, day: string): Promise<boolean> {
  const t = ticker.toUpperCase();
  const key = `chain|${t}|${expiry}|${day}`;
  const had = chains.get(key);
  if (had === 'ready' || had === 'none') return had === 'ready';
  chains.set(key, 'loading');
  const path = `/option/history/quote?symbol=${encodeURIComponent(t)}&expiration=${ymd(expiry)}&right=both&strike_range=${CHAIN_SPAN}&date=${ymd(day)}&interval=1m&format=json`;
  const got = await load(key, path, rows => {
    const all = parseQuotes(t, rows);
    const out: Record<string, { b: number[]; a: number[] }> = {};
    for (const [k, d] of all) if (hasAny(d)) out[k] = pack(d);
    return Object.keys(out).length ? out : null;
  });
  if (got.offline) {
    chains.set(key, 'offline');
    emit();
    return false;
  }
  const v = got.value && !isNone(got.value) ? (got.value as Record<string, { b: number[]; a: number[] }>) : null;
  if (v) for (const [k, p] of Object.entries(v)) if (!legs.get(`leg|${k}|${day}`)) {
    legs.set(`leg|${k}|${day}`, unpack(p));
    legWant.set(`leg|${k}|${day}`, 'ready');
  }
  chains.set(key, v ? 'ready' : 'none');
  emit();
  return v != null;
}
export const chainNeed = (ticker: string, expiry: string, day: string): Need => chains.get(`chain|${ticker.toUpperCase()}|${expiry}|${day}`) ?? 'loading';
export const legNeed = (c: Leg, day: string): Need => legWant.get(`leg|${legKey(c)}|${day}`) ?? 'loading';
/** Has the leg's day been answered (with quotes, or with none) */
export const legKnown = (c: Leg, day: string): boolean => legs.has(`leg|${legKey(c)}|${day}`);

/** The NBBO at the end of a minute, or null where none stood (or the day is not loaded). After the name's last bar of
    an early close, nothing stands. */
export function nbboAt(c: Leg, day: string, minute: number): { bid: number; ask: number } | null {
  const d = legs.get(`leg|${legKey(c)}|${day}`);
  if (!d) return null;
  const m = Math.max(0, Math.min(LAST_MIN, minute));
  const last = closeMinOf(c.ticker, day);
  if (last >= 0 && m > last) return null;
  const bid = d.bid[m];
  const ask = d.ask[m];
  return Number.isFinite(ask) && Number.isFinite(bid) ? { bid, ask } : null;
}
/** The leg's mid through the day up to a minute (for the day's high and low so far) */
export function midsUpTo(c: Leg, day: string, minute: number): number[] {
  const d = legs.get(`leg|${legKey(c)}|${day}`);
  if (!d) return [];
  const out: number[] = [];
  for (let m = 0; m <= Math.min(LAST_MIN, minute); m++) if (Number.isFinite(d.bid[m]) && Number.isFinite(d.ask[m])) out.push((d.bid[m] + d.ask[m]) / 2);
  return out;
}

/* ---- a contract's trades through a day (the drill: volume and the last print) ---- */
interface TradeDay {
  /** Contracts traded in each minute */
  volume: number[];
  /** The minute's last print (NaN with no trade) */
  close: number[];
}
const tradeDays = new Map<string, TradeDay | null>();
export async function ensureTrades(c: Leg, day: string): Promise<boolean> {
  const key = `ohlc|${legKey(c)}|${day}`;
  if (tradeDays.has(key)) return tradeDays.get(key) != null;
  const t = c.ticker.toUpperCase();
  const path = `/option/history/ohlc?symbol=${encodeURIComponent(t)}&expiration=${ymd(c.expiry)}&strike=${c.strike.toFixed(2)}&right=${c.right === 'C' ? 'call' : 'put'}&date=${ymd(day)}&interval=1m&format=json`;
  const got = await load(key, path, rows => {
    const volume = new Array<number>(DAY_MIN).fill(0);
    const close = new Array<number>(DAY_MIN).fill(-1);
    for (const r of rows) {
      const m = minuteOfStamp(r.timestamp);
      const v = num(r.volume);
      const px = num(r.close);
      if (!(m >= 0 && m < DAY_MIN) || !(v > 0) || !(px > 0)) continue;
      volume[m] += v;
      close[m] = px;
    }
    return { volume, close };
  });
  if (got.offline) return false;
  const v = got.value && !isNone(got.value) ? (got.value as { volume: number[]; close: number[] }) : null;
  tradeDays.set(key, v ? { volume: v.volume, close: v.close.map(x => (x > 0 ? x : NaN)) } : null);
  emit();
  return v != null;
}
/** Contracts traded up to the end of a minute, and the last print by then — null until loaded */
export function tradesUpTo(c: Leg, day: string, minute: number): { volume: number; last: number } | null {
  const d = tradeDays.get(`ohlc|${legKey(c)}|${day}`);
  if (!d) return null;
  let volume = 0;
  let last = NaN;
  for (let m = 0; m <= Math.min(LAST_MIN, minute); m++) {
    volume += d.volume[m];
    if (Number.isFinite(d.close[m])) last = d.close[m];
  }
  return { volume, last };
}

/* ---- how far back the quotes reach ---- */
let probing: Promise<void> | null = null;
/** Find the oldest session SPY's quote history answers on (a binary search over listing answers, once per browser) */
export function ensureWindow(): Promise<void> {
  if (firstDay) return Promise.resolve();
  if (probing) return probing;
  probing = (async () => {
    const has = async (iso: string) => {
      const got = await thetaCall(`/option/list/contracts/quote?symbol=SPY&date=${ymd(iso)}&format=json`, true);
      if (got.error === 'terminal_down') throw new Error('offline');
      return !got.error && flatRows(got.data).length > 0;
    };
    try {
      let hi = lastReplayDay();
      if (!(await has(hi))) return;
      /* back in steps of a year to the first miss, then halve the gap */
      let lo = hi;
      for (let y = 1; y <= 20; y++) {
        const d = dateOf(hi);
        d.setFullYear(d.getFullYear() - y);
        const iso = isoDate(d);
        if (await has(iso)) lo = iso;
        else {
          hi = lo;
          lo = iso;
          break;
        }
        if (y === 20) {
          firstDay = iso;
          return;
        }
      }
      /* lo misses, hi answers */
      let a = lo;
      let b = hi;
      while (dayNumber(b) - dayNumber(a) > 1) {
        const mid = isoDate(new Date((dayNumber(a) + dayNumber(b)) / 2 * 86400000 + 12 * 3600000));
        if (await has(mid)) b = mid;
        else a = mid;
      }
      firstDay = isTradingDay(dateOf(b)) ? b : step(b, 1);
      try {
        localStorage.setItem(FIRST_KEY, firstDay);
      } catch {
        /* kept for this visit */
      }
      emit();
    } catch {
      /* the terminal is away: asked again on the next visit */
    } finally {
      probing = null;
    }
  })();
  return probing;
}

/* ---- the test seam: the proofs put a day in by hand ---- */
export function putBars(ticker: string, day: string, candles: Candle[]): void {
  const t = ticker.toUpperCase();
  bars.set(`bars|${t}|${day}`, { bars: candles, last: candles.length - 1 });
  barsWant.set(`bars|${t}|${day}`, 'ready');
}
export function putListing(ticker: string, day: string, l: Listing): void {
  listings.set(`list|${ticker.toUpperCase()}|${day}`, l);
  listWant.set(`list|${ticker.toUpperCase()}|${day}`, 'ready');
}
export function putQuotes(c: Leg, day: string, bid: number[], ask: number[]): void {
  legs.set(`leg|${legKey(c)}|${day}`, { bid: [...bid], ask: [...ask] });
  legWant.set(`leg|${legKey(c)}|${day}`, 'ready');
}
export function putWindow(first: string): void {
  firstDay = first;
}
