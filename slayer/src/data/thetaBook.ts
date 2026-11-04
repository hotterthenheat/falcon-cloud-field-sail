/*
  The live book as this browser shows it. The scan runs once on the server for every viewer (data/compassScan.ts,
  data/compassServer.ts); this reads its board and record (data/compassFeed.ts) and paints them. The contract page's
  own quote, bars and second-order greeks are read here, from ThetaData, while that page is open and the tab is
  visible. With the terminal down every read waits on data/theta.ts's breaker and the board keeps the last state,
  stamped.
*/

import { useEffect, useState, useSyncExternalStore } from 'react';
import { thetaCall } from './theta';
import { nyWallStamp, nyWallTime } from '../core/nyTime';
import { indexLevel, indexRoot, liveSpotOf, noteIndex, pinChainSpot } from './traceLive';
import { deskPhase } from './compassSession';
import { currentPicks, earlierScan, lastScanAt, stampPickQuote } from './compassModel';
import { ALL, ALL_SET, INDEX_OF, OPTION_OF, WEEKLY_FOCUS, asRows, odteBook, onScanMeta, perDay, perPoint, rowOf, scanMeta, type ThetaState } from './compassScan';
import { holdCompassFeed, useCompassFeed, type FeedStatus } from './compassFeed';
import { subscribeTheta, thetaStatus } from './thetaQuote';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import type { Timeframe } from './timeframe';
import { tfMinutes } from './timeframe';
import { shapeBars } from './thetaCandles';
import { vendorVol } from './coneFeed';
import { nyYmd as ymd } from '../core/calendar';
import { anchorSession, daysBack, readEod, sessionsBack } from './thetaTape';
import { noData } from './thetaFeed';

export type { ThetaState };

const listeners = new Set<() => void>();
let rev = 0;

function emit(): void {
  rev += 1;
  for (const fn of listeners) fn();
}

/* the server's spots reach the shell's shared prices once per new state */
let spotsSeen: Record<string, number> | null = null;
onScanMeta(() => {
  const m = scanMeta();
  if (m.spots !== spotsSeen) {
    spotsSeen = m.spots;
    for (const [ticker, spot] of Object.entries(m.spots)) {
      if (!(spot > 0)) continue;
      /* the chain's underlying at the last mark. Not a stock print, so it must not be stamped as of now
         or it beats the last trade on every chip and every dropdown. */
      if (indexRoot(ticker)) {
        if (!(indexLevel(ticker) > 0)) noteIndex(ticker, spot, 1);
      } else pinChainSpot(ticker, spot);
    }
  }
  emit();
});

export function liveSetup(id: string): Setup | null {
  return currentPicks().find(s => s.id === id) ?? null;
}

export function liveSetups(): Setup[] {
  return currentPicks();
}

export function liveSpot(ticker: string): number {
  const shared = indexRoot(ticker) ? indexLevel(ticker) : liveSpotOf(ticker);
  if (shared > 0) return shared;
  const spots = scanMeta().spots;
  return spots[ticker] ?? spots[INDEX_OF[ticker] ?? ''] ?? 0;
}

export function liveSpark(ticker: string): number[] {
  const key = INDEX_OF[ticker] ?? ticker;
  const sparks = scanMeta().sparks;
  return sparks[key] ?? sparks[ticker] ?? [];
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/* The board's name filter. The server scans every name of the sleeve; the filter only narrows what is shown. */
let focus: string | null = null;

/** Narrow the board to one name, or back to the sleeve's list (null). */
export function setScanFocus(ticker: string | null): void {
  const next = ticker ? OPTION_OF[ticker] ?? ticker : null;
  if (next === focus) return;
  focus = next;
  emit();
}

/** The names a sleeve's scan reads now: the board lists them. */
export function scanNames(sleeve: 'odte' | 'weekly', now = Date.now()): string[] {
  const names = sleeve === 'odte' ? odteBook(now) : WEEKLY_FOCUS;
  return focus ? names.filter(t => t === focus) : names;
}

/** The names a sleeve can call. 0DTE is the roots that list a same-day contract on this session, even while the tape is shut. */
export function alertUniverse(sleeve: 'odte' | 'weekly'): readonly string[] {
  if (sleeve === 'odte') return odteBook(Date.now());
  return ALL;
}
void ALL_SET;

/** Every answer passes through here; the contract page's reads. */
async function theta(path: string, jump = false): Promise<{ status: number; data: unknown; error: string | null }> {
  return thetaCall(path, jump);
}

/** A contract's bar. `volume` is the contracts that traded in it, where the feed says (the chart's volume bars). */
interface LiveBar { time: number; open: number; high: number; low: number; close: number; volume?: number }

const barCache = new Map<string, { at: number; bars: LiveBar[] }>();

/* A contract's window in TRADING SESSIONS back from the last session that opened (a Sunday reads Friday's), not calendar
   days ending today (1m was today alone and empty all weekend). Intraday reads stay inside ThetaData's one-month limit (one
   28-day span at most: the 1h window was 40 days and every read was refused); daily bars are the contract's EOD rows
   (interval=1d is not an interval ThetaData has), a year at most. */
function barWindow(tf: Timeframe): { interval: string; sessions: number; minutes: number } {
  const minutes = tfMinutes(tf);
  if (minutes >= 1440) return { interval: '1d', sessions: 252, minutes };
  if (minutes >= 60) return { interval: '1h', sessions: 20, minutes };
  if (minutes >= 30) return { interval: '30m', sessions: 20, minutes };
  if (minutes >= 15) return { interval: '15m', sessions: 10, minutes };
  if (minutes >= 5) return { interval: '5m', sessions: 5, minutes };
  if (minutes < 1) return { interval: '15s', sessions: 1, minutes };
  return { interval: '1m', sessions: 2, minutes };
}

/** [start, end] (YYYYMMDD) of a contract read: `sessions` back from the last session that opened, to today, inside 28 days
    (365 for the EOD rows) */
export function contractSpan(sessions: number, daily: boolean, nowMs = Date.now()): { start: string; end: string } {
  const end = ymd(nowMs);
  const start = sessionsBack(anchorSession('rth', nowMs), sessions);
  const floor = daysBack(end, daily ? 364 : 27);
  return { start: start < floor ? floor : start, end };
}

/** A contract's EOD rows as daily bars at 16:00 New York, the day the row reports (`created`) */
function readEodBars(data: unknown): LiveBar[] {
  return readEod(asRows(data)).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume > 0 ? b.volume : 0 }));
}

function readBars(data: unknown): LiveBar[] {
  const flat: Record<string, unknown>[] = [];
  for (const item of asRows(data)) {
    const row = item as { data?: unknown; close?: unknown; price?: unknown };
    if (Array.isArray(row.data)) flat.push(...(row.data as Record<string, unknown>[]));
    else if (row.close != null || row.price != null) flat.push(item as Record<string, unknown>);
  }
  const out: LiveBar[] = [];
  for (const b of flat) {
    const time = Math.floor(barStamp(b) / 1000);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    if (!(time > 0 && open > 0 && high > 0 && low > 0 && close > 0)) continue;
    const hasVol = b.volume != null && b.volume !== '';
    const hasCount = b.count != null && b.count !== '';
    /* A minute the feed marks with no contracts traded is not a candle. */
    if ((hasVol || hasCount) && !(hasVol && num(b.volume) > 0) && !(hasCount && num(b.count) > 0)) continue;
    out.push({ time, open, high, low, close, volume: hasVol && num(b.volume) > 0 ? num(b.volume) : 0 });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function barStamp(row: Record<string, unknown>): number {
  const ts = nyWallStamp(row.timestamp ?? row.time);
  if (ts > 1e11) return ts;
  const ms = num(row.ms_of_day);
  const date = String(row.date ?? '');
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(date);
  if (m && row.ms_of_day != null && ms >= 0) return nyWallTime(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0) + ms;
  return ts;
}

/** One candle per bucket that had a print. A minute with no trade is left out. */
function barsFromTrades(data: unknown, step: number): LiveBar[] {
  const ticks: { t: number; price: number; size: number }[] = [];
  for (const item of asRows(data)) {
    const row = item as { data?: unknown; price?: unknown };
    const flat = Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : [item as Record<string, unknown>];
    for (const b of flat) {
      const price = num(b.price);
      const size = num(b.size);
      const ms = barStamp(b);
      if (!(price > 0) || !(size > 0) || !(ms > 0)) continue;
      ticks.push({ t: Math.floor(ms / 1000), price, size });
    }
  }
  ticks.sort((a, b) => a.t - b.t);
  const buckets = new Map<number, LiveBar>();
  for (const tick of ticks) {
    const time = Math.floor(tick.t / step) * step;
    const had = buckets.get(time);
    if (!had) buckets.set(time, { time, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.size });
    else {
      had.high = Math.max(had.high, tick.price);
      had.low = Math.min(had.low, tick.price);
      had.close = tick.price;
      had.volume = (had.volume ?? 0) + tick.size;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

const stepSec = (interval: string): number => {
  if (interval === '5m') return 300;
  if (interval === '15m') return 900;
  if (interval === '30m') return 1800;
  if (interval === '1h') return 3600;
  if (interval === '1d') return 86400;
  return 60;
};

const hidden = () => typeof document !== 'undefined' && document.hidden;

/** The contract's own bars from the terminal: history OHLC, or trades when OHLC has no prints. A quote is not a bar.
    Polls while the page shows it and the tab is visible. Null until the feed answers; [] when it answered and there were no trades. */
export function useContractBars(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean, tf: Timeframe = '1m', day = ''): LiveBar[] | null {
  const spec = barWindow(tf);
  /* a past call's page reads the bars up to its own session (YYYY-MM-DD), once: that window ends at its 16:00 */
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(day) ? nyWallTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), 16, 0) : 0;
  const key = `${ticker}|${expiration}|${strike}|${right}|${tf}|${asOf}`;
  /* the bars are held with the contract they are for: on a switch the last contract's bars are not shown under the new one */
  const [held, setHeld] = useState<{ key: string; bars: LiveBar[] | null }>(() => ({ key, bars: barCache.get(key)?.bars ?? null }));
  const setBars = (next: LiveBar[] | null) => setHeld({ key, bars: next });
  useEffect(() => {
    if (!on || !ticker || !expiration) return;
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const rightWord = right === 'C' ? 'call' : 'put';
    const pull = async () => {
      if (hidden()) return;
      const daily = spec.interval === '1d';
      const { start, end } = contractSpan(spec.sessions, daily, asOf || Date.now());
      const leg = `symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${start}&end_date=${end}`;
      const ohlc = await theta(daily ? `/option/history/eod?${leg}&format=json` : `/option/history/ohlc?${leg}&interval=${spec.interval}&format=json`, true);
      if (dead) return;
      let rows = ohlc.error ? [] : daily ? readEodBars(ohlc.data) : readBars(ohlc.data);
      if (!rows.length && !daily) {
        const trades = await theta(`/option/history/trade?${leg}&format=json`, true);
        if (dead) return;
        rows = trades.error ? [] : barsFromTrades(trades.data, stepSec(spec.interval));
        if (ohlc.error && trades.error) return;
      } else if (!rows.length && ohlc.error && !noData(ohlc)) return;
      const shaped = shapeBars(rows.map(b => ({ ...b, volume: b.volume ?? 0 })), spec.minutes, 'rth', ticker).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
      barCache.set(key, { at: Date.now(), bars: shaped });
      setBars(shaped);
    };
    const hit = barCache.get(key);
    if (hit) setBars(hit.bars);
    /* a finished session's bars do not change: read once */
    if (asOf && hit?.bars.length) return () => { dead = true; };
    void pull();
    const id = asOf ? 0 : window.setInterval(() => void pull(), spec.interval === '1m' ? 15_000 : 60_000);
    return () => {
      dead = true;
      if (id) window.clearInterval(id);
    };
  }, [key, on, ticker, expiration, strike, right, spec.interval, spec.sessions, asOf]);
  return held.key === key ? held.bars : barCache.get(key)?.bars ?? null;
}

interface ContractLive {
  bid: number;
  ask: number;
  /** The quote's own stamp */
  at: number;
  /** When this browser heard it, epoch ms: a quote not heard for a while is no longer live */
  heard: number;
  under: number;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  /** Contracts on the bid and the ask, when the snapshot sent them. NaN if it did not. */
  bidSize: number;
  askSize: number;
  /** Open interest from the snapshot, when it sent one. NaN if it did not. */
  oi: number;
}

function field(v: unknown): number {
  if (v == null || v === '') return NaN;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

interface QuoteWant {
  ticker: string;
  expiration: string;
  strike: number;
  right: OptionRight;
  n: number;
}

const quoteBox = new Map<string, ContractLive>();
const quoteWant = new Map<string, QuoteWant>();
const quoteHeard = new Set<() => void>();
let quoteTimer: number | null = null;
/* One read per contract at a time: every reader of a contract (the board card, its page, the Tracker, the Blotter, a
   page's several figures) shares the read in flight, and a reader that mounts just after a read does not read again. */
const quoteInflight = new Map<string, Promise<void>>();
const quoteLastPull = new Map<string, number>();
/** A reader mounting within this of the last read takes that read's quote */
const QUOTE_REUSE_MS = 2_500;
/** The 3-second poll skips a contract read this recently (a reader's mount read it) */
const QUOTE_SKIP_MS = 2_000;

function quoteKey(ticker: string, expiration: string, strike: number, right: OptionRight): string {
  return `${ticker}|${expiration.slice(0, 10)}|${strike}|${right}`;
}

function pullQuoteOnce(key: string, want: QuoteWant, minGap: number): Promise<void> {
  const running = quoteInflight.get(key);
  if (running) return running;
  if (minGap > 0 && Date.now() - (quoteLastPull.get(key) ?? 0) < minGap) return Promise.resolve();
  quoteLastPull.set(key, Date.now());
  const read = pullQuote(key, want).finally(() => quoteInflight.delete(key));
  quoteInflight.set(key, read);
  return read;
}

async function pullQuote(key: string, want: QuoteWant): Promise<void> {
  const exp = want.expiration.slice(0, 10).replace(/-/g, '');
  const rightWord = want.right === 'C' ? 'call' : 'put';
  const got = await theta(
    `/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(want.ticker)}&expiration=${exp}&strike=${want.strike}&right=${rightWord}&format=json`,
    true,
  );
  if (got.error) return;
  for (const item of asRows(got.data)) {
    const parsed = rowOf(item);
    if (!parsed) continue;
    const k = num(parsed.contract.strike);
    const word = String(parsed.contract.right || '').toLowerCase();
    const side: OptionRight | '' = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : '';
    if (k > 0 && (Math.abs(k - want.strike) > 0.001 || (side && side !== want.right))) continue;
    const nextBid = num(parsed.quote.bid);
    const nextAsk = num(parsed.quote.ask);
    if (!(nextAsk > 0) || nextBid < 0 || nextAsk < nextBid) continue;
    const rawIv = field(parsed.quote.implied_vol);
    quoteBox.set(key, {
      bid: nextBid,
      ask: nextAsk,
      at: nyWallStamp(parsed.quote.timestamp) || Date.now(),
      heard: Date.now(),
      under: field(parsed.quote.underlying_price),
      delta: field(parsed.quote.delta),
      theta: perDay(field(parsed.quote.theta)),
      vega: perPoint(field(parsed.quote.vega)),
      rho: perPoint(field(parsed.quote.rho)),
      /* ThetaData prints implied_vol as a fraction, always (0.1834 = 18.34%; a deep wing's 3.2 is 320%): percent for the page */
      iv: Number.isFinite(rawIv) ? vendorVol(rawIv) * 100 : rawIv,
      bidSize: field(parsed.quote.bid_size),
      askSize: field(parsed.quote.ask_size),
      oi: field(parsed.quote.open_interest),
    });
    stampPickQuote(want.ticker, want.expiration, want.strike, want.right, quoteBox.get(key)!);
    emit();
    return;
  }
}

function pullQuotes(): void {
  if (hidden() || deskPhase() === 'closed') return;
  for (const [key, want] of quoteWant) void pullQuoteOnce(key, want, QUOTE_SKIP_MS).then(() => quoteHeard.forEach(fn => fn()));
}

function stopQuotes(): void {
  if (quoteTimer != null) window.clearInterval(quoteTimer);
  quoteTimer = null;
}

function armQuotes(): void {
  if (typeof window === 'undefined' || quoteTimer != null) return;
  quoteTimer = window.setInterval(pullQuotes, 3_000);
}

/** One contract's quote for whatever shows it: polled every 3 seconds while anything holds it, once per contract
    however many readers hold it. */
export function useContractLive(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean): ContractLive | null {
  const key = quoteKey(ticker, expiration, strike, right);
  /* held with its contract's key: a switch never shows the last contract's quote, and a pull for it that lands late is
     not heard */
  const [held, setHeld] = useState<{ key: string; row: ContractLive | null }>(() => ({ key, row: quoteBox.get(key) ?? null }));
  useEffect(() => {
    if (!on || !ticker || !expiration || !(strike > 0)) return;
    let dead = false;
    const want = quoteWant.get(key) ?? { ticker, expiration, strike, right, n: 0 };
    want.n += 1;
    quoteWant.set(key, want);
    armQuotes();
    const hear = () => {
      if (!dead) setHeld({ key, row: quoteBox.get(key) ?? null });
    };
    quoteHeard.add(hear);
    void pullQuoteOnce(key, want, QUOTE_REUSE_MS).then(hear);
    return () => {
      dead = true;
      quoteHeard.delete(hear);
      const held = quoteWant.get(key);
      if (!held) return;
      held.n -= 1;
      if (held.n <= 0) quoteWant.delete(key);
      if (!quoteWant.size) stopQuotes();
    };
  }, [key, on, ticker, expiration, strike, right]);
  if (!on) return null;
  return held.key === key ? held.row : quoteBox.get(key) ?? null;
}

export function useSecondGreek(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean): { gamma: number; vanna: number; charm: number } | null {
  const key = `${ticker}|${expiration}|${strike}|${right}|g`;
  const [held, setHeld] = useState<{ key: string; row: { gamma: number; vanna: number; charm: number } | null }>({ key, row: null });
  const setRow = (row: { gamma: number; vanna: number; charm: number }) => setHeld({ key, row });
  useEffect(() => {
    if (!on || !ticker || !expiration || !(strike > 0)) return;
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const rightWord = right === 'C' ? 'call' : 'put';
    const pull = () => {
      if (hidden()) return;
      void theta(`/option/snapshot/greeks/second_order?symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&format=json`, true).then(got => {
        if (dead || got.error) return;
        const item = asRows(got.data)[0];
        const quote = item ? rowOf(item)?.quote : null;
        if (!quote) return;
        setRow({ gamma: field(quote.gamma), vanna: field(quote.vanna), charm: Number.isFinite(field(quote.charm)) ? field(quote.charm) / 252 : NaN });
      });
    };
    pull();
    const id = window.setInterval(pull, 15_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [key, on, ticker, expiration, strike, right]);
  /* the last contract's greeks are not shown under a new one while its own read is out */
  return held.key === key ? held.row : null;
}

export interface BookView {
  status: 'loading' | 'live' | 'down';
  setups: Setup[];
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
  /** The terminal as the server's last read found it, and since when it has been down */
  theta: ThetaState;
  downSince: number;
  /** The last session's scan, stamped, while today has none */
  earlier: { day: string; at: number; setups: Setup[] } | null;
  /** The server's state on screen: live, the copy this browser kept (stamped), or none */
  feed: FeedStatus;
  /** When the server took the state on screen, epoch ms */
  feedAt: number;
  /** Why the server could not be read */
  feedError: string;
}

/** The board for one sleeve, from the server's engine. Mounting it keeps the server's state reading. */
export function useThetaBook(sleeve: SleeveKey): BookView {
  useEffect(() => holdCompassFeed(), []);
  useEffect(() => subscribeTheta(emit), []);
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  const f = useCompassFeed();
  const m = scanMeta();
  const wanted = sleeve === 'weekly' ? 'weekly' : 'odte';
  const picks = currentPicks();
  const setups = picks.filter(s => (wanted === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE'));
  /* the server's reading of the terminal; before the first state lands, the shell's own */
  const shell = thetaStatus();
  const state: ThetaState = f.status === 'live' || f.status === 'kept' ? m.theta : shell === 'down' ? 'down' : shell === 'up' ? 'up' : 'unknown';
  const status: BookView['status'] = state === 'down' ? 'down' : f.status === 'loading' && !picks.length ? 'loading' : 'live';
  return {
    status,
    setups,
    spots: m.spots,
    sparks: m.sparks,
    line: m.line,
    theta: state,
    downSince: m.downSince,
    earlier: picks.length || lastScanAt('odte') || lastScanAt('weekly') ? null : earlierScan(),
    feed: f.status,
    feedAt: f.at,
    feedError: f.error,
  };
}

/** A contract's first-order greeks and quote at one minute of a past session (the call's minute, for a past call's
    page): the terminal's own history rows, nothing modelled. Null until it answers, or when that minute has no row. */
export interface GreeksAt {
  at: number;
  bid: number;
  ask: number;
  under: number;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
}
const greeksAtMemo = new Map<string, GreeksAt | null>();

export function useGreeksAt(ticker: string, expiration: string, strike: number, right: OptionRight, atMs: number, on: boolean): GreeksAt | null {
  const minute = Math.floor(atMs / 60_000) * 60_000;
  const key = `${ticker}|${expiration}|${strike}|${right}|${minute}`;
  const [held, setHeld] = useState<{ key: string; row: GreeksAt | null }>(() => ({ key, row: greeksAtMemo.get(key) ?? null }));
  useEffect(() => {
    if (!on || !ticker || !expiration || !(strike > 0) || !(minute > 0)) return;
    if (greeksAtMemo.has(key)) {
      setHeld({ key, row: greeksAtMemo.get(key) ?? null });
      return;
    }
    let dead = false;
    const day = ymd(minute);
    const rightWord = right === 'C' ? 'call' : 'put';
    void theta(`/option/history/greeks/first_order?symbol=${encodeURIComponent(ticker)}&expiration=${expiration.replace(/-/g, '')}&strike=${strike}&right=${rightWord}&start_date=${day}&end_date=${day}&interval=1m&format=json`, true).then(got => {
      if (dead || got.error) return;
      let row: GreeksAt | null = null;
      for (const item of asRows(got.data)) {
        const list = Array.isArray(item.data) ? (item.data as Record<string, unknown>[]) : [item];
        for (const q of list) {
          const t = nyWallStamp(q.timestamp);
          if (Math.floor(t / 60_000) * 60_000 !== minute) continue;
          const rawIv = field(q.implied_vol);
          row = {
            at: t,
            bid: field(q.bid),
            ask: field(q.ask),
            under: field(q.underlying_price),
            delta: field(q.delta),
            theta: perDay(field(q.theta)),
            vega: perPoint(field(q.vega)),
            rho: perPoint(field(q.rho)),
            iv: Number.isFinite(rawIv) ? vendorVol(rawIv) * 100 : NaN,
          };
        }
      }
      greeksAtMemo.set(key, row);
      setHeld({ key, row });
    });
    return () => {
      dead = true;
    };
  }, [key, on, ticker, expiration, strike, right, minute]);
  return on && held.key === key ? held.row : null;
}

/** One strike of the book around a contract, as the live quote prints it. */
export interface ChainRow {
  strike: number;
  right: OptionRight;
  bid: number;
  ask: number;
  delta: number;
  iv: number;
}
const chainMemo = new Map<string, { at: number; rows: ChainRow[] }>();

/** The live book around a contract (both sides, `span` strikes either way of the money) on its expiration, read every
    15 seconds while its page shows it. Null until the feed answers; [] when it answered with nothing. */
export function useChainAround(ticker: string, expiration: string, span: number, on: boolean): ChainRow[] | null {
  const key = `${ticker}|${expiration}|${span}`;
  const [held, setHeld] = useState<{ key: string; rows: ChainRow[] | null }>(() => ({ key, rows: chainMemo.get(key)?.rows ?? null }));
  useEffect(() => {
    if (!on || !ticker || !expiration) return;
    let dead = false;
    const pull = async () => {
      if (hidden()) return;
      const got = await theta(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(ticker)}&expiration=${expiration.replace(/-/g, '')}&right=both&strike_range=${span}&format=json`, true);
      if (dead || (got.error && !noData(got))) return;
      const rows: ChainRow[] = [];
      for (const item of asRows(got.data)) {
        const parsed = rowOf(item);
        if (!parsed) continue;
        const strike = num(parsed.contract.strike);
        const word = String(parsed.contract.right || '').toLowerCase();
        const side: OptionRight | '' = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : '';
        const bid = field(parsed.quote.bid);
        const ask = field(parsed.quote.ask);
        if (!(strike > 0) || !side || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
        const rawIv = field(parsed.quote.implied_vol);
        rows.push({ strike, right: side, bid, ask, delta: field(parsed.quote.delta), iv: Number.isFinite(rawIv) ? vendorVol(rawIv) * 100 : NaN });
      }
      chainMemo.set(key, { at: Date.now(), rows });
      setHeld({ key, rows });
    };
    void pull();
    const id = window.setInterval(() => void pull(), 15_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [key, on, ticker, expiration, span]);
  return on && held.key === key ? held.rows : null;
}
