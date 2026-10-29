/* The Weigher's tape: one timeframe, one session, the vendor's own bars; an empty session stays empty.
   ThetaData first; when it does not answer, Unusual Whales' stock bars (no index prices, no 15s, no overnight). */

import { useEffect, useState } from 'react';
import type { Candle } from '../types/market';
import type { Timeframe } from './timeframe';
import type { OptionRight } from '../types/compass';
import { nyMinutes, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { minuteInSession, sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { thetaCall } from './theta';
import { whalesBars, whalesDailyLong, type UwBar, type UwDaily } from './whales';
import { ensureQuote, peekQuote } from './liveQuote';

const INDEX = new Set(['SPX', 'VIX', 'RUT', 'NDX', 'XSP']);

const WINDOWS: Record<DeskSession, { start: string; end: string }[]> = {
  rth: [{ start: '09:30:00', end: '15:59:59' }],
  pre: [{ start: '04:00:00', end: '09:29:59' }],
  post: [{ start: '16:00:00', end: '19:59:59' }],
  overnight: [
    { start: '20:00:00', end: '23:59:59' },
    { start: '00:00:00', end: '03:59:59' },
  ],
};

const STEP: Partial<Record<Timeframe, number>> = {
  '15s': 15,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
};

interface Spec {
  interval: string;
  days: number;
}

function specOf(tf: Timeframe): Spec | 'day' | 'week' {
  switch (tf) {
    case '15s':
      return { interval: '15s', days: 2 };
    case '1m':
      return { interval: '1m', days: 5 };
    case '5m':
      return { interval: '5m', days: 12 };
    case '15m':
      return { interval: '15m', days: 25 };
    case '30m':
      return { interval: '30m', days: 40 };
    case '1h':
      return { interval: '1h', days: 60 };
    case '1W':
      return 'week';
    default:
      return 'day';
  }
}

function ymd(at = Date.now()): string {
  const p = nyParts(at);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function flatRows(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const rows = Array.isArray(data) ? data : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown; close?: unknown };
    if (Array.isArray(row.data)) out.push(...(row.data as Record<string, unknown>[]));
    else out.push(item as Record<string, unknown>);
  }
  return out;
}

function dayClose(timeSec: number): number {
  const p = nyParts(timeSec * 1000);
  return Math.floor(nyWallTime(p.year, p.month, p.day, 16, 0) / 1000);
}

function weekClose(timeSec: number): number {
  const p = nyParts(timeSec * 1000);
  const back = (p.weekday + 6) % 7;
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  utc.setUTCDate(utc.getUTCDate() - back);
  return Math.floor(nyWallTime(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), 16, 0) / 1000);
}

function foldTo(bars: Candle[], keyOf: (timeSec: number) => number): Candle[] {
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

function readOhlc(data: unknown, session: DeskSession): Candle[] {
  const bars = flatRows(data)
    .map(b => {
      const at = nyWallStamp(b.timestamp ?? b.time);
      const close = num(b.close);
      const open = num(b.open) || close;
      const high = num(b.high) || close;
      const low = num(b.low) || close;
      if (!at || !(close > 0) || !(high > 0) || !(low > 0)) return null;
      return { time: Math.floor(at / 1000), open, high, low, close, volume: num(b.volume) };
    })
    .filter((b): b is Candle => !!b && minuteInSession(nyMinutes(b.time * 1000), session));
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

function readEod(data: unknown): Candle[] {
  const bars = flatRows(data)
    .map(b => {
      const stamp = b.last_trade ?? b.created ?? b.timestamp;
      const at = nyWallStamp(stamp);
      const close = num(b.close);
      const open = num(b.open) || close;
      const high = num(b.high) || close;
      const low = num(b.low) || close;
      if (!at || !(close > 0)) return null;
      return { time: dayClose(Math.floor(at / 1000)), open, high, low, close, volume: num(b.volume) };
    })
    .filter((b): b is Candle => !!b);
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

function rootPath(symbol: string): 'index' | 'stock' {
  return INDEX.has(symbol) ? 'index' : 'stock';
}

async function pullWindow(symbol: string, interval: string, start: string, end: string, session: DeskSession, option?: { exp: string; strike: number; right: OptionRight }): Promise<{ bars: Candle[]; error: boolean }> {
  const wins = WINDOWS[session];
  /* 15-second history is one day per call. A range is rejected, and a rejected range is not a reason to draw a minute bar. */
  const days = interval === '15s' ? [ymd(Date.now() - 86400000), ymd()] : [null];
  const got = await Promise.all(
    days.flatMap(day =>
      wins.map(win => {
        const time = `&start_time=${win.start}&end_time=${win.end}`;
        const from = day ?? start;
        const to = day ?? end;
        const path = option
          ? `/option/history/ohlc?symbol=${encodeURIComponent(symbol)}&expiration=${option.exp}&strike=${option.strike}&right=${option.right === 'C' ? 'call' : 'put'}&start_date=${from}&end_date=${to}&interval=${interval}${time}&format=json`
          : `/${rootPath(symbol)}/history/ohlc?symbol=${encodeURIComponent(symbol)}&start_date=${from}&end_date=${to}&interval=${interval}${time}&format=json`;
        return thetaCall(path);
      }),
    ),
  );
  const error = got.every(g => g.error != null);
  const bars = got.flatMap(g => (g.error ? [] : readOhlc(g.data, session)));
  bars.sort((a, b) => a.time - b.time);
  const dedup: Candle[] = [];
  for (const b of bars) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.time === b.time) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  return { bars: dedup, error };
}

async function pullEod(symbol: string, start: string, end: string, option?: { exp: string; strike: number; right: OptionRight }): Promise<{ bars: Candle[]; error: boolean }> {
  const path = option
    ? `/option/history/eod?symbol=${encodeURIComponent(symbol)}&expiration=${option.exp}&strike=${option.strike}&right=${option.right === 'C' ? 'call' : 'put'}&start_date=${start}&end_date=${end}&format=json`
    : `/${rootPath(symbol)}/history/eod?symbol=${encodeURIComponent(symbol)}&start_date=${start}&end_date=${end}&format=json`;
  const got = await thetaCall(path);
  if (got.error) return { bars: [], error: true };
  return { bars: readEod(got.data), error: false };
}

async function loadBars(symbol: string, tf: Timeframe, session: DeskSession, option?: { exp: string; strike: number; right: OptionRight }): Promise<{ bars: Candle[]; error: boolean }> {
  const end = ymd();
  const kind = specOf(tf);
  if (kind === 'day' || kind === 'week') {
    if (session === 'rth') {
      const daily = await pullEod(symbol, ymd(Date.now() - 200 * 86400000), end, option);
      const today = await pullWindow(symbol, '5m', ymd(Date.now() - 86400000), end, 'rth', option);
      const formed = foldTo(today.bars, dayClose);
      const byTime = new Map(daily.bars.map(b => [b.time, b]));
      for (const b of formed) byTime.set(b.time, b);
      const days = [...byTime.values()].sort((a, b) => a.time - b.time);
      return { bars: kind === 'week' ? foldTo(days, weekClose) : days, error: daily.error && today.error };
    }
    const intra = await pullWindow(symbol, '5m', ymd(Date.now() - 40 * 86400000), end, session, option);
    const days = foldTo(intra.bars, dayClose);
    return { bars: kind === 'week' ? foldTo(days, weekClose) : days, error: intra.error };
  }
  return pullWindow(symbol, kind.interval, ymd(Date.now() - kind.days * 86400000), end, session, option);
}

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

/** The live print joins the bar it belongs to. It never opens a bar in another session. */
export function paintLive(bars: Candle[], price: number, atSec: number, tf: Timeframe, session: DeskSession): Candle[] {
  if (!(price > 0) || !(atSec > 0) || !minuteInSession(nyMinutes(atSec * 1000), session)) return bars;
  const next = bars.slice();
  const last = next[next.length - 1];
  if (tf === '1D' || tf === '1W') {
    const k = tf === '1W' ? weekClose(atSec) : dayClose(atSec);
    if (last && last.time === k) next[next.length - 1] = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    else next.push({ time: k, open: price, high: price, low: price, close: price, volume: 0 });
    return next;
  }
  const step = STEP[tf] ?? 60;
  const open = openSec(atSec, session);
  const bucket = open + Math.floor(Math.max(0, atSec - open) / step) * step;
  if (last && last.time === bucket) next[next.length - 1] = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
  else if (!last || bucket > last.time) next.push({ time: bucket, open: price, high: price, low: price, close: price, volume: 0 });
  return next;
}

const UW_SIZE: Partial<Record<Timeframe, { size: '1m' | '5m' | '15m' | '1h'; limit: number; fold?: number }>> = {
  '1m': { size: '1m', limit: 2500 },
  '5m': { size: '5m', limit: 2500 },
  '15m': { size: '15m', limit: 2500 },
  '30m': { size: '15m', limit: 2500, fold: 1800 },
  '1h': { size: '1h', limit: 1000 },
};

function readUwBars(rows: UwBar[], session: DeskSession): Candle[] {
  const bars: Candle[] = [];
  for (const b of rows) {
    const at = Date.parse(b.start_time ?? '');
    const close = num(b.close);
    if (!Number.isFinite(at) || !(close > 0) || !minuteInSession(nyMinutes(at), session)) continue;
    bars.push({ time: Math.floor(at / 1000), open: num(b.open) || close, high: num(b.high) || close, low: num(b.low) || close, close, volume: num(b.volume) });
  }
  return bars.sort((a, b) => a.time - b.time);
}

/** Unusual Whales' stock bars when ThetaData is down. Regular-session dailies are the vendor's `r` rows. */
async function loadUwBars(symbol: string, tf: Timeframe, session: DeskSession): Promise<{ bars: Candle[]; error: boolean }> {
  if (INDEX.has(symbol) || session === 'overnight') return { bars: [], error: true };
  try {
    const kind = specOf(tf);
    if ((kind === 'day' || kind === 'week') && session === 'rth') {
      const rows = (await whalesDailyLong(symbol)) as UwDaily[];
      const days: Candle[] = [];
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r.market_time !== 'r' || !r.date) continue;
        const [y, m, d] = r.date.split('-').map(Number);
        const close = num(r.close);
        if (!(close > 0)) continue;
        days.push({ time: Math.floor(nyWallTime(y, m, d, 16, 0) / 1000), open: num(r.open) || close, high: num(r.high) || close, low: num(r.low) || close, close, volume: num(r.volume) });
      }
      days.sort((a, b) => a.time - b.time);
      return { bars: kind === 'week' ? foldTo(days, weekClose) : days, error: false };
    }
    const want = kind === 'day' || kind === 'week' ? { size: '5m' as const, limit: 2500 } : UW_SIZE[tf];
    if (!want) return { bars: [], error: true };
    const bars = readUwBars((await whalesBars(symbol, want.size, want.limit)) ?? [], session);
    if (kind === 'day' || kind === 'week') {
      const days = foldTo(bars, dayClose);
      return { bars: kind === 'week' ? foldTo(days, weekClose) : days, error: false };
    }
    const step = 'fold' in want ? want.fold : undefined;
    return { bars: step ? foldTo(bars, t => { const open = openSec(t, session); return open + Math.floor((t - open) / step) * step; }) : bars, error: false };
  } catch {
    return { bars: [], error: true };
  }
}

async function loadTape(symbol: string, tf: Timeframe, session: DeskSession): Promise<{ bars: Candle[]; error: boolean; uw: boolean }> {
  const theta = await loadBars(symbol, tf, session);
  if (!theta.error || theta.bars.length) return { ...theta, uw: false };
  const uw = await loadUwBars(symbol, tf, session);
  return uw.error ? { ...theta, uw: false } : { ...uw, uw: true };
}

function uwPrint(symbol: string): { price: number; at: number } | null {
  ensureQuote(symbol);
  const q = peekQuote(symbol);
  if (!q || !(q.spot > 0) || !(q.tapeAt > 0)) return null;
  return { price: q.spot, at: Math.floor(q.tapeAt / 1000) };
}

interface WeigherTape {
  bars: Candle[];
  /** null while the first answer is still out */
  ready: boolean;
  note: string | null;
}

const EMPTY: WeigherTape = { bars: [], ready: false, note: null };
const hist = new Map<string, { at: number; bars: Candle[]; uw: boolean }>();

function noteFor(session: DeskSession, bars: Candle[], error: boolean): string | null {
  if (error && bars.length === 0) return 'The tape did not answer.';
  if (bars.length === 0) return `${sessionMeta(session).label} has no prints on this name.`;
  return null;
}

async function pullPrint(symbol: string): Promise<{ price: number; at: number } | null> {
  const path = INDEX.has(symbol)
    ? `/index/snapshot/price?symbol=${encodeURIComponent(symbol)}&format=json`
    : `/stock/snapshot/trade?symbol=${encodeURIComponent(symbol)}&format=json`;
  const got = await thetaCall(path, true);
  const row = Array.isArray(got.data) ? (got.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  const price = num(row.price ?? row.last ?? row.close);
  const at = Math.floor(nyWallStamp(row.timestamp) / 1000);
  if (!(price > 0) || !(at > 0)) return null;
  return { price, at };
}

export function useWeigherTape(ticker: string, tf: Timeframe, session: DeskSession): WeigherTape {
  const symbol = ticker.trim().toUpperCase();
  const key = `${symbol}|${tf}|${session}`;
  const [state, setState] = useState<{ key: string; tape: WeigherTape }>({ key: '', tape: EMPTY });
  useEffect(() => {
    if (!symbol) return;
    let dead = false;
    let fromUw = false;
    const apply = (bars: Candle[], error: boolean) => {
      if (dead) return;
      setState({ key, tape: { bars, ready: true, note: noteFor(session, bars, error) } });
    };
    const run = () => {
      const hit = hist.get(key);
      const live = sessionOfMinute(nyMinutes()) === session;
      if (hit && Date.now() - hit.at < (live ? 20_000 : 5 * 60_000)) {
        fromUw = hit.uw;
        apply(hit.bars, false);
        return;
      }
      void loadTape(symbol, tf, session).then(got => {
        if (dead) return;
        if (got.error && got.bars.length === 0) {
          apply(hit?.bars ?? [], true);
          return;
        }
        fromUw = got.uw;
        hist.set(key, { at: Date.now(), bars: got.bars, uw: got.uw });
        apply(got.bars, false);
      });
    };
    run();
    const history = window.setInterval(run, 20_000);
    const spot = window.setInterval(() => {
      if (sessionOfMinute(nyMinutes()) !== session) return;
      void (fromUw ? Promise.resolve(uwPrint(symbol)) : pullPrint(symbol)).then(print => {
        if (dead || !print) return;
        setState(prev => {
          if (prev.key !== key || !prev.tape.ready) return prev;
          const bars = paintLive(prev.tape.bars, print.price, print.at, tf, session);
          const last = bars[bars.length - 1];
          const was = prev.tape.bars[prev.tape.bars.length - 1];
          if (was && last && was.time === last.time && was.close === last.close && was.high === last.high && was.low === last.low && bars.length === prev.tape.bars.length) return prev;
          return { key, tape: { bars, ready: true, note: null } };
        });
      });
    }, 1000);
    return () => {
      dead = true;
      window.clearInterval(history);
      window.clearInterval(spot);
    };
  }, [key, symbol, tf, session]);
  return state.key === key ? state.tape : EMPTY;
}

const contracts = new Map<string, { at: number; bars: Candle[] }>();

export function useWeigherContract(
  symbol: string,
  expiryIso: string,
  strike: number,
  right: OptionRight,
  tf: Timeframe,
  session: DeskSession,
  on: boolean,
): { bars: Candle[] | null; note: string | null } {
  const root = symbol.trim().toUpperCase();
  const exp = expiryIso.replace(/-/g, '');
  const key = `${root}|${exp}|${strike}|${right}|${tf}|${session}`;
  const [state, setState] = useState<{ key: string; bars: Candle[] | null; note: string | null }>({ key: '', bars: null, note: null });
  useEffect(() => {
    if (!on || !root || exp.length !== 8 || !(strike > 0)) return;
    let dead = false;
    const option = { exp, strike: Number(strike.toFixed(4)), right };
    const run = () => {
      const hit = contracts.get(key);
      const live = sessionOfMinute(nyMinutes()) === session;
      if (hit && Date.now() - hit.at < (live ? 20_000 : 5 * 60_000)) {
        if (!dead) setState({ key, bars: hit.bars, note: noteFor(session, hit.bars, false) });
        return;
      }
      void loadBars(root, tf, session, option).then(got => {
        if (dead) return;
        if (!got.error) contracts.set(key, { at: Date.now(), bars: got.bars });
        const bars = got.error && got.bars.length === 0 ? (hit?.bars ?? []) : got.bars;
        setState({ key, bars, note: noteFor(session, bars, got.error && bars.length === 0) });
      });
    };
    run();
    const id = window.setInterval(run, 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [on, key, root, exp, strike, right, tf, session]);
  if (!on) return { bars: null, note: null };
  return state.key === key ? { bars: state.bars, note: state.note } : { bars: null, note: null };
}
