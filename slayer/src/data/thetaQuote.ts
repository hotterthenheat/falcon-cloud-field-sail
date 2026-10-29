/*
  Real-time prices off the ThetaData terminal: a stock's last trade, an index's last price, and one option contract's
  NBBO mid. The last reading of each is kept on this machine, so with the terminal down a page shows that price
  stamped with the instant it was taken (never a stand-in from another feed). Polling follows the session and stops
  while the tab is hidden.
*/

import { useEffect, useSyncExternalStore } from 'react';
import { thetaAllowedHere, thetaCall } from './theta';

/* what the page in view may ask the terminal (data/theta.ts): a price, an option's quote, the daily closes */
const pricesHere = () => thetaAllowedHere('/stock/snapshot/trade');
const marksHere = () => thetaAllowedHere('/option/snapshot/quote');
const closesHere = () => thetaAllowedHere('/stock/history/eod');
import { nyIsoDate, nyMinutes, nyWallStamp } from '../core/nyTime';
import { isTradingDay, today as nyToday } from '../core/calendar';
import type { OptionRight } from '../types/compass';
import type { Candle } from '../types/market';

const INDEX = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };
/** A weekly root quotes the index it tracks */
const UNDERLYING: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };

export interface ThetaPrice {
  /** The last trade (a stock) or the last price (an index) */
  price: number;
  /** The last regular-session close before today's New York date, when the daily rows are in */
  prevClose: number | null;
  /** Today's regular close, once the daily row for today is written */
  todayClose: number | null;
  /** The print's own instant (epoch ms) */
  at: number;
  /** When this reading was taken */
  read: number;
}

export interface ThetaMark {
  bid: number;
  ask: number;
  /** The NBBO mid */
  mark: number;
  /** The quote's own instant; null when the terminal sent none (such a quote is never shown as live) */
  at: number | null;
  read: number;
}

export type ThetaStatus = 'unknown' | 'up' | 'down';

/** A reading with whether it is this session's (live) or one kept from before (stamp it with `read`). */
export interface Held<T> {
  value: T;
  live: boolean;
}

/* ---- state ---- */

const KEPT_KEY = 'slayer_theta_kept_v1';
const MAX_KEPT = 120;

type KeptMap = Record<string, ThetaPrice | ThetaMark>;
function loadKept(): KeptMap {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEPT_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as KeptMap) : {};
  } catch {
    return {};
  }
}
const kept: KeptMap = loadKept();
let keepTimer: ReturnType<typeof setTimeout> | null = null;
function keep(key: string, v: ThetaPrice | ThetaMark): void {
  kept[key] = v;
  if (keepTimer) return;
  keepTimer = setTimeout(() => {
    keepTimer = null;
    const keys = Object.keys(kept);
    if (keys.length > MAX_KEPT) {
      keys.sort((a, b) => kept[a].read - kept[b].read);
      for (const k of keys.slice(0, keys.length - MAX_KEPT)) delete kept[k];
    }
    try {
      localStorage.setItem(KEPT_KEY, JSON.stringify(kept));
    } catch {
      /* storage full or blocked: the readings live for this page */
    }
  }, 2000);
}

const live = new Map<string, ThetaPrice | ThetaMark>();
let status: ThetaStatus = 'unknown';
let rev = 0;
const listeners = new Set<() => void>();
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};
function setStatus(next: ThetaStatus): void {
  if (status === next) return;
  status = next;
  emit();
}

/* ---- parsing (v3 answers are flat rows, or { contract, data: [row] } for options) ---- */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};
function rowsOf(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    const inner = Array.isArray(bag.data) ? bag.data : bag.data && typeof bag.data === 'object' ? [bag.data] : null;
    if (inner) for (const r of inner) if (r && typeof r === 'object') out.push(r as Record<string, unknown>);
    else out.push(bag);
  }
  return out;
}

/** A trade or price snapshot's last print, or null */
export function readPrint(data: unknown): { price: number; at: number } | null {
  for (const r of rowsOf(data)) {
    const price = num(r.price ?? r.last ?? r.close);
    const at = nyWallStamp(r.timestamp ?? r.last_trade ?? r.created);
    if (price > 0 && at > 0) return { price, at };
  }
  return null;
}

/** An option quote snapshot's two-sided NBBO and its mid, or null */
export function readNbbo(data: unknown): { bid: number; ask: number; mark: number; at: number | null } | null {
  for (const r of rowsOf(data)) {
    const bid = num(r.bid);
    const ask = num(r.ask);
    if (bid >= 0 && ask > 0 && ask >= bid) return { bid, ask, mark: Number(((bid + ask) / 2).toFixed(4)), at: nyWallStamp(r.timestamp) || null };
  }
  return null;
}

/** The daily rows' closes by New York date, oldest first */
export function readCloses(data: unknown): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  for (const r of rowsOf(data)) {
    const close = num(r.close);
    const at = nyWallStamp(r.last_trade ?? r.created ?? r.timestamp ?? r.date);
    if (close > 0 && at > 0) out.push({ date: nyIsoDate(at), close });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/* ---- the reads ---- */

const ymd = (iso: string) => iso.replace(/-/g, '');
const symbolOf = (ticker: string) => {
  const t = ticker.trim().toUpperCase();
  return UNDERLYING[t] ?? t;
};

/** How long a reading stays fresh: 3 s in the regular session, 15 s in extended hours, a minute when nothing trades */
function ttl(): number {
  if (!isTradingDay(nyToday())) return 60_000;
  const m = nyMinutes();
  if (m >= 570 && m < 960) return 3_000;
  if (m >= 240 && m < 1200) return 15_000;
  return 60_000;
}
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const inflight = new Map<string, Promise<void>>();
const closesFor = new Map<string, { day: string; closes: { date: string; close: number }[] }>();

async function readCloseRows(sym: string): Promise<{ date: string; close: number }[] | null> {
  const day = nyIsoDate();
  const hit = closesFor.get(sym);
  /* once a New York day, and again after the bell for today's own row */
  if (hit && hit.day === day && (nyMinutes() < 960 || hit.closes.some(c => c.date === day))) return hit.closes;
  /* a page that may not ask for daily rows keeps what an earlier page read */
  if (!closesHere()) return hit?.closes ?? null;
  const root = INDEX.has(sym) ? 'index' : 'stock';
  const start = nyIsoDate(Date.now() - 12 * 86_400_000);
  const got = await thetaCall(`/${root}/history/eod?symbol=${encodeURIComponent(sym)}&start_date=${ymd(start)}&end_date=${ymd(day)}&format=json`);
  if (got.error) return hit?.closes ?? null;
  const closes = readCloses(got.data);
  closesFor.set(sym, { day, closes });
  return closes;
}

/* A read that failed for a reason other than a down terminal (that is the breaker's, data/theta.ts) waits before the next:
   15 s, doubling to a minute, cleared by an answer. */
const failed = new Map<string, { until: number; gap: number }>();
const failWait = (key: string): boolean => (failed.get(key)?.until ?? 0) > Date.now();
const noteFail = (key: string) => {
  const gap = Math.min(60_000, (failed.get(key)?.gap ?? 7_500) * 2);
  failed.set(key, { until: Date.now() + gap, gap });
};

function readPrice(sym: string): Promise<void> {
  const key = `S:${sym}`;
  const running = inflight.get(key);
  if (running) return running;
  if (failWait(key)) return Promise.resolve();
  const root = INDEX.has(sym) ? 'index' : 'stock';
  const path = root === 'index' ? `/index/snapshot/price?symbol=${encodeURIComponent(sym)}&format=json` : `/stock/snapshot/trade?symbol=${encodeURIComponent(sym)}&format=json`;
  const job = (async () => {
    const got = await thetaCall(path, true);
    if (got.error) {
      if (got.error === 'terminal_down') setStatus('down');
      else noteFail(key);
      return;
    }
    const print = readPrint(got.data);
    if (!print) {
      noteFail(key);
      return;
    }
    failed.delete(key);
    const closes = await readCloseRows(sym);
    const today = nyIsoDate();
    const prior = closes ? [...closes].reverse().find(c => c.date < today) : undefined;
    const own = closes?.find(c => c.date === today);
    const next: ThetaPrice = { price: print.price, prevClose: prior?.close ?? null, todayClose: own?.close ?? null, at: print.at, read: Date.now() };
    live.set(key, next);
    keep(key, next);
    status = 'up';
    emit();
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

const markKey = (ticker: string, expiry: string, strike: number, right: OptionRight) => `O:${ticker.trim().toUpperCase()}|${expiry}|${Number(strike.toFixed(3))}|${right}`;

function readMark(ticker: string, expiry: string, strike: number, right: OptionRight): Promise<void> {
  const key = markKey(ticker, expiry, strike, right);
  const running = inflight.get(key);
  if (running) return running;
  if (failWait(key)) return Promise.resolve();
  const name = ticker.trim().toUpperCase();
  const roots = WEEKLY_ROOT[name] ? [WEEKLY_ROOT[name], name] : [name];
  const job = (async () => {
    for (const root of roots) {
      const got = await thetaCall(`/option/snapshot/quote?symbol=${encodeURIComponent(root)}&expiration=${ymd(expiry)}&strike=${strike}&right=${right === 'C' ? 'call' : 'put'}&format=json`, true);
      if (got.error) {
        if (got.error === 'terminal_down') {
          setStatus('down');
          return;
        }
        continue;
      }
      const q = readNbbo(got.data);
      if (!q) continue;
      failed.delete(key);
      const next: ThetaMark = { ...q, read: Date.now() };
      live.set(key, next);
      keep(key, next);
      status = 'up';
      emit();
      return;
    }
    noteFail(key);
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Ask for a name's price, unless a fresh reading is in hand */
export function ensureThetaPrice(ticker: string): void {
  const sym = symbolOf(ticker);
  if (!sym || typeof window === 'undefined') return;
  const hit = live.get(`S:${sym}`);
  /* a page that may not ask the terminal for prices (data/theta.ts) asks nothing */
  if ((hit && Date.now() - hit.read < ttl()) || hidden() || !pricesHere()) return;
  void readPrice(sym);
}

/** Ask for one contract's NBBO, unless a fresh reading is in hand */
export function ensureThetaMark(ticker: string, expiry: string, strike: number, right: OptionRight): void {
  if (typeof window === 'undefined') return;
  const key = markKey(ticker, expiry, strike, right);
  const hit = live.get(key);
  if ((hit && Date.now() - hit.read < Math.max(5_000, ttl())) || hidden() || !marksHere()) return;
  void readMark(ticker, expiry, strike, right);
}

/** The price: this session's reading while the terminal answers, else the one kept from before (live false) */
export function peekThetaPrice(ticker: string): Held<ThetaPrice> | null {
  const key = `S:${symbolOf(ticker)}`;
  const l = live.get(key) as ThetaPrice | undefined;
  if (l && status !== 'down') return { value: l, live: true };
  const k = (l ?? kept[key]) as ThetaPrice | undefined;
  return k && k.price > 0 ? { value: k, live: false } : null;
}

export function peekThetaMark(ticker: string, expiry: string, strike: number, right: OptionRight): Held<ThetaMark> | null {
  const key = markKey(ticker, expiry, strike, right);
  const l = live.get(key) as ThetaMark | undefined;
  if (l && status !== 'down' && l.at != null) return { value: l, live: true };
  const k = (l ?? kept[key]) as ThetaMark | undefined;
  return k && k.mark > 0 ? { value: k, live: false } : null;
}

/* one day's regular close, for settling a contract at its expiry */
const closeOn = new Map<string, number | null>();
const closeAsked = new Set<string>();

/** Ask for a name's regular close on one New York date (a past date; kept once read) */
export function ensureThetaCloseOn(ticker: string, iso: string): void {
  const sym = symbolOf(ticker);
  const key = `${sym}|${iso}`;
  if (closeOn.has(key) || closeAsked.has(key) || typeof window === 'undefined' || hidden() || !closesHere()) return;
  const k = kept[`C:${key}`] as ThetaPrice | undefined;
  if (k && k.price > 0) {
    closeOn.set(key, k.price);
    return;
  }
  closeAsked.add(key);
  const root = INDEX.has(sym) ? 'index' : 'stock';
  void thetaCall(`/${root}/history/eod?symbol=${encodeURIComponent(sym)}&start_date=${ymd(iso)}&end_date=${ymd(iso)}&format=json`)
    .then(got => {
      if (got.error) return;
      const row = readCloses(got.data).find(c => c.date === iso);
      closeOn.set(key, row?.close ?? null);
      if (row) {
        keep(`C:${key}`, { price: row.close, prevClose: null, todayClose: null, at: Date.now(), read: Date.now() });
        emit();
      }
    })
    .finally(() => closeAsked.delete(key));
}

export function peekThetaCloseOn(ticker: string, iso: string): number | null {
  return closeOn.get(`${symbolOf(ticker)}|${iso}`) ?? null;
}

/* today's one-minute bars of a name, for the alerts that read an indicator or run a script */
const barsOf = new Map<string, { read: number; bars: Candle[] }>();
const barsAsked = new Set<string>();
const barsHere = () => thetaAllowedHere('/stock/history/ohlc');

/** Ask for a name's one-minute bars of today's session (refreshed once a minute) */
export function ensureThetaBars(ticker: string): void {
  const sym = symbolOf(ticker);
  if (!sym || typeof window === 'undefined' || hidden() || !barsHere() || barsAsked.has(sym)) return;
  const hit = barsOf.get(sym);
  if (hit && Date.now() - hit.read < 60_000) return;
  barsAsked.add(sym);
  const day = ymd(nyIsoDate());
  const root = INDEX.has(sym) ? 'index' : 'stock';
  void thetaCall(`/${root}/history/ohlc?symbol=${encodeURIComponent(sym)}&start_date=${day}&end_date=${day}&interval=1m&start_time=09:30:00&end_time=16:00:00&format=json`)
    .then(got => {
      if (got.error) {
        if (got.error === 'terminal_down') setStatus('down');
        return;
      }
      const bars: Candle[] = [];
      for (const r of rowsOf(got.data)) {
        const at = nyWallStamp(r.timestamp);
        const close = num(r.close);
        if (!(at > 0) || !(close > 0)) continue;
        bars.push({ time: Math.floor(at / 1000), open: num(r.open) || close, high: num(r.high) || close, low: num(r.low) || close, close, volume: num(r.volume) || 0 });
      }
      bars.sort((a, b) => a.time - b.time);
      barsOf.set(sym, { read: Date.now(), bars });
      status = 'up';
      emit();
    })
    .finally(() => barsAsked.delete(sym));
}

/** Today's one-minute bars off the terminal, or null until they land */
export function peekThetaBars(ticker: string): Candle[] | null {
  return barsOf.get(symbolOf(ticker))?.bars ?? null;
}

export const thetaStatus = (): ThetaStatus => status;

/** The regular session's move off a price reading, percent, and which close it is measured from */
export function thetaMove(p: ThetaPrice | null | undefined, at = Date.now()): { pct: number; base: number; ext: number | null } | null {
  if (!p || !(p.prevClose && p.prevClose > 0)) return null;
  const m = nyMinutes(at);
  /* after the bell with today's row written: the day is its close; the print past it is the after-hours move */
  if (p.todayClose && p.todayClose > 0 && m >= 960) {
    const ext = Math.abs(p.price - p.todayClose) >= 0.005 ? ((p.price - p.todayClose) / p.todayClose) * 100 : null;
    return { pct: ((p.todayClose - p.prevClose) / p.prevClose) * 100, base: p.prevClose, ext };
  }
  return { pct: ((p.price - p.prevClose) / p.prevClose) * 100, base: p.prevClose, ext: null };
}

export function subscribeTheta(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- hooks ---- */

const POLL_MS = 1_000;

/** Several names' prices, kept fresh while mounted; re-renders when any reading lands */
export function useThetaPrices(tickers: readonly string[]): number {
  const key = [...new Set(tickers.map(symbolOf).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const names = key.split(',');
    const pull = () => names.forEach(ensureThetaPrice);
    pull();
    /* each ask is a no-op while its reading is fresh (ttl), so this only paces the session's clock */
    const id = window.setInterval(pull, POLL_MS);
    const onShow = () => {
      if (!hidden()) pull();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [key]);
  return useSyncExternalStore(subscribeTheta, () => rev, () => rev);
}

/** One name's price and the terminal's state; re-renders only when that name's reading or the state changes */
export function useThetaPrice(ticker: string | null | undefined): { held: Held<ThetaPrice> | null; status: ThetaStatus } {
  const t = ticker ? symbolOf(ticker) : '';
  useThetaPricesQuiet(t);
  const sig = useSyncExternalStore(
    subscribeTheta,
    () => {
      const h = t ? peekThetaPrice(t) : null;
      return `${status}|${h ? `${h.live ? 1 : 0}|${h.value.price}|${h.value.prevClose}|${h.value.todayClose}|${h.value.at}` : ''}`;
    },
    () => '',
  );
  void sig;
  return { held: t ? peekThetaPrice(t) : null, status };
}

/* the polling half of useThetaPrices, without its re-render on every landing */
function useThetaPricesQuiet(t: string): void {
  useEffect(() => {
    if (!t) return;
    const pull = () => ensureThetaPrice(t);
    pull();
    const id = window.setInterval(pull, POLL_MS);
    return () => window.clearInterval(id);
  }, [t]);
}

/** Contracts' marks, kept fresh while mounted; re-renders when any reading lands */
export function useThetaMarks(wanted: readonly { ticker: string; expiry: string; strike: number; right: OptionRight }[]): number {
  const key = [...new Set(wanted.map(w => markKey(w.ticker, w.expiry, w.strike, w.right)))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const list = key.split(',').map(k => {
      const [t, e, s, r] = k.slice(2).split('|');
      return { t, e, s: Number(s), r: r as OptionRight };
    });
    const pull = () => list.forEach(c => ensureThetaMark(c.t, c.e, c.s, c.r));
    pull();
    const id = window.setInterval(pull, POLL_MS * 2);
    return () => window.clearInterval(id);
  }, [key]);
  return useSyncExternalStore(subscribeTheta, () => rev, () => rev);
}

/** The terminal's state alone */
export function useThetaStatus(): ThetaStatus {
  return useSyncExternalStore(subscribeTheta, () => status, () => status);
}
