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
import { indexLevel, indexRoot, liveSpotOf, noteIndex, noteSpot } from './traceLive';
import { deskPhase } from './compassSession';
import { currentPicks, earlierScan, lastScanAt, stampPickQuote } from './compassModel';
import { ALL, ALL_SET, INDEX_OF, OPTION_OF, WEEKLY_FOCUS, asRows, odteBook, onScanMeta, perDay, perPoint, rowOf, scanMeta, type ThetaState } from './compassScan';
import { compassFeed, holdCompassFeed, useCompassFeed, type FeedStatus } from './compassFeed';
import { subscribeTheta, thetaStatus } from './thetaQuote';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import type { Timeframe } from './timeframe';
import { tfMinutes } from './timeframe';
import { shapeBars } from './thetaCandles';
import { vendorVol } from './coneFeed';
import { nyYmd as ymd } from '../core/calendar';

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
    const at = compassFeed().at || Date.now();
    for (const [ticker, spot] of Object.entries(m.spots)) {
      if (!(spot > 0)) continue;
      if (indexRoot(ticker)) noteIndex(ticker, spot, at);
      else noteSpot(ticker, spot, at);
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

interface LiveBar { time: number; open: number; high: number; low: number; close: number }

const barCache = new Map<string, { at: number; bars: LiveBar[] }>();

function barWindow(tf: Timeframe): { interval: string; days: number; minutes: number } {
  const minutes = tfMinutes(tf);
  if (minutes >= 7 * 1440) return { interval: '1d', days: 5 * 365, minutes };
  if (minutes >= 1440) return { interval: '1d', days: minutes >= 30 * 1440 ? 5 * 365 : 180, minutes };
  if (minutes >= 60) return { interval: '1h', days: 40, minutes };
  if (minutes >= 30) return { interval: '30m', days: 10, minutes };
  if (minutes >= 15) return { interval: '15m', days: 6, minutes };
  if (minutes >= 5) return { interval: '5m', days: 4, minutes };
  if (minutes < 1) return { interval: '15s', days: 1, minutes };
  return { interval: '1m', days: 2, minutes };
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
    out.push({ time, open, high, low, close });
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
  const ticks: { t: number; price: number }[] = [];
  for (const item of asRows(data)) {
    const row = item as { data?: unknown; price?: unknown };
    const flat = Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : [item as Record<string, unknown>];
    for (const b of flat) {
      const price = num(b.price);
      const size = num(b.size);
      const ms = barStamp(b);
      if (!(price > 0) || !(size > 0) || !(ms > 0)) continue;
      ticks.push({ t: Math.floor(ms / 1000), price });
    }
  }
  ticks.sort((a, b) => a.t - b.t);
  const buckets = new Map<number, LiveBar>();
  for (const tick of ticks) {
    const time = Math.floor(tick.t / step) * step;
    const had = buckets.get(time);
    if (!had) buckets.set(time, { time, open: tick.price, high: tick.price, low: tick.price, close: tick.price });
    else {
      had.high = Math.max(had.high, tick.price);
      had.low = Math.min(had.low, tick.price);
      had.close = tick.price;
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
export function useContractBars(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean, tf: Timeframe = '1m'): LiveBar[] | null {
  const spec = barWindow(tf);
  const key = `${ticker}|${expiration}|${strike}|${right}|${tf}`;
  const [bars, setBars] = useState<LiveBar[] | null>(barCache.get(key)?.bars ?? null);
  useEffect(() => {
    if (!on || !ticker || !expiration) return;
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const rightWord = right === 'C' ? 'call' : 'put';
    const pull = async () => {
      if (hidden()) return;
      const end = ymd(Date.now());
      const start = ymd(Date.now() - (spec.days - 1) * 86400000);
      const leg = `symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${start}&end_date=${end}`;
      const ohlc = await theta(`/option/history/ohlc?${leg}&interval=${spec.interval}&format=json`, true);
      if (dead) return;
      let rows = ohlc.error ? [] : readBars(ohlc.data);
      if (!rows.length) {
        const trades = await theta(`/option/history/trade?${leg}&format=json`, true);
        if (dead) return;
        rows = trades.error ? [] : barsFromTrades(trades.data, stepSec(spec.interval));
        if (ohlc.error && trades.error) return;
      }
      const shaped = shapeBars(rows.map(b => ({ ...b, volume: 0 })), spec.minutes, 'rth', ticker).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
      barCache.set(key, { at: Date.now(), bars: shaped });
      setBars(shaped);
    };
    const hit = barCache.get(key);
    if (hit) setBars(hit.bars);
    void pull();
    const id = window.setInterval(() => void pull(), spec.interval === '1m' ? 15_000 : 60_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [key, on, ticker, expiration, strike, right, spec.interval, spec.days]);
  return bars;
}

interface ContractLive {
  bid: number;
  ask: number;
  at: number;
  under: number;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
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

function quoteKey(ticker: string, expiration: string, strike: number, right: OptionRight): string {
  return `${ticker}|${expiration}|${strike}|${right}`;
}

async function pullQuote(key: string, want: QuoteWant): Promise<void> {
  const exp = want.expiration.replace(/-/g, '');
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
      under: field(parsed.quote.underlying_price),
      delta: field(parsed.quote.delta),
      theta: perDay(field(parsed.quote.theta)),
      vega: perPoint(field(parsed.quote.vega)),
      rho: perPoint(field(parsed.quote.rho)),
      /* ThetaData prints implied_vol as a fraction, always (0.1834 = 18.34%; a deep wing's 3.2 is 320%): percent for the page */
      iv: Number.isFinite(rawIv) ? vendorVol(rawIv) * 100 : rawIv,
    });
    stampPickQuote(want.ticker, want.expiration, want.strike, want.right, quoteBox.get(key)!);
    emit();
    return;
  }
}

function pullQuotes(): void {
  if (hidden() || deskPhase() === 'closed') return;
  for (const [key, want] of quoteWant) void pullQuote(key, want).then(() => quoteHeard.forEach(fn => fn()));
}

function stopQuotes(): void {
  if (quoteTimer != null) window.clearInterval(quoteTimer);
  quoteTimer = null;
}

function armQuotes(): void {
  if (typeof window === 'undefined' || quoteTimer != null) return;
  quoteTimer = window.setInterval(pullQuotes, 3_000);
}

/** One contract's quote for the page that shows it: polled every 3 seconds while that page is open. */
export function useContractLive(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean): ContractLive | null {
  const key = quoteKey(ticker, expiration, strike, right);
  const [row, setRow] = useState<ContractLive | null>(() => quoteBox.get(key) ?? null);
  useEffect(() => {
    if (!on || !ticker || !expiration || !(strike > 0)) return;
    const want = quoteWant.get(key) ?? { ticker, expiration, strike, right, n: 0 };
    want.n += 1;
    quoteWant.set(key, want);
    armQuotes();
    const hear = () => setRow(quoteBox.get(key) ?? null);
    quoteHeard.add(hear);
    void pullQuote(key, want).then(hear);
    return () => {
      quoteHeard.delete(hear);
      const held = quoteWant.get(key);
      if (!held) return;
      held.n -= 1;
      if (held.n <= 0) quoteWant.delete(key);
      if (!quoteWant.size) stopQuotes();
    };
  }, [key, on, ticker, expiration, strike, right]);
  return on ? row : null;
}

export function useSecondGreek(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean): { gamma: number; vanna: number; charm: number } | null {
  const key = `${ticker}|${expiration}|${strike}|${right}|g`;
  const [row, setRow] = useState<{ gamma: number; vanna: number; charm: number } | null>(null);
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
  return row;
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
