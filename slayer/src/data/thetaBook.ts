/*
  The live book. Theta's own quotes. No simulated price, no invented greek.
  A contract is on the board only while its quote is from this session.
*/

import { useEffect, useState } from 'react';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp } from '../core/nyTime';
import { indexLevel, indexRoot, liveSpotOf, noteIndex, noteSpot } from './traceLive';
import { setupIdOf } from './compass';
import { COMPASS_TICKERS } from './compassUniverse';
import { STOP_KEEP } from './contractQuote';
import { claimSlot, commitScalps, currentPicks, dropPending, resetScanReport, scoreBook, setScanBusy, setScanPace } from './compassModel';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import type { Timeframe } from './timeframe';

const OPEN_ROOTS = ['SPXW', 'RUTW', 'VIX', 'XSP'] as const;
const INDEX_OF: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };
const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW' };
const FRESH_MS = 30 * 1000;

export interface ThetaBook {
  status: 'loading' | 'live' | 'down';
  setups: Setup[];
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
}

const empty: ThetaBook = { status: 'loading', setups: [], spots: {}, sparks: {}, line: 'Reading the live book.' };

let book: ThetaBook = empty;
const byId = new Map<string, Setup>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function liveSetup(id: string): Setup | null {
  return byId.get(id) ?? null;
}

export function liveSetups(): Setup[] {
  return [...byId.values()];
}

export function liveSpot(ticker: string): number {
  const shared = indexRoot(ticker) ? indexLevel(ticker) : liveSpotOf(ticker);
  if (shared > 0) return shared;
  return book.spots[ticker] ?? book.spots[INDEX_OF[ticker] ?? ''] ?? 0;
}

function publishSpots(spots: Record<string, number>, at: number): void {
  for (const [ticker, spot] of Object.entries(spots)) {
    if (!(spot > 0)) continue;
    if (indexRoot(ticker)) noteIndex(ticker, spot, at);
    else noteSpot(ticker, spot, at);
  }
}

export function liveSpark(ticker: string): number[] {
  const key = INDEX_OF[ticker] ?? ticker;
  return book.sparks[key] ?? book.sparks[ticker] ?? [];
}

function finite(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function num(v: unknown): number {
  const n = finite(v);
  return Number.isFinite(n) ? n : 0;
}

/** Theta publishes the annual Black-Scholes theta. The model splits, and the desk, are dollars per calendar day. */
function perDay(theta: number): number {
  return Number.isFinite(theta) ? theta / 365 : NaN;
}

/** Theta says vega and rho are raw partials. Divide by 100 to get the per-point number. */
function perPoint(v: number): number {
  return Number.isFinite(v) ? v / 100 : NaN;
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  return [];
}

function stampMs(stamp: unknown): number {
  return nyWallStamp(stamp);
}

function contractWord(symbol: string, strike: number, right: OptionRight): string {
  const k = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2);
  return `${symbol} ${k}${right}`;
}

function sessionsAhead(expiration: string, now: number): number {
  const dte = Math.max(0, Math.round((Date.parse(`${expiration}T21:00:00Z`) - now) / 86400000));
  if (dte > 0) return dte;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const mins = Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
  if (mins < 9 * 60 + 30) return 1;
  return Math.max(16 * 60 - mins, 5) / (6.5 * 60);
}

const listedAt = new Map<string, number>();

interface LiveGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  rho: number;
  vanna: number;
  charm: number;
  vomma: number;
  veta: number;
  speed: number;
  zomma: number;
  color: number;
  ultima: number;
  lambda: number;
  epsilon: number;
}

function toSetup(
  symbol: string, strike: number, right: OptionRight, expiration: string,
  bid: number, ask: number, spot: number, sleeve: SleeveKey, quotedAt: number,
  greeks: LiveGreeks,
): Setup {
  const mid = (bid + ask) / 2;
  const id = setupIdOf({ ticker: symbol, strike, right, scanner: 'top-setups', sleeve });
  if (!listedAt.has(id)) listedAt.set(id, Date.now());
  const dte = Math.max(0, Math.round((Date.parse(`${expiration}T16:00:00`) - Date.now()) / 86400000));
  const spread = mid > 0 ? (ask - bid) / mid : 1;
  const sessions = sessionsAhead(expiration, quotedAt || Date.now());
  const sigma = greeks.iv > 0 ? (greeks.iv / 100) * Math.sqrt(sessions / 252) * 100 : 0;
  return {
    id,
    ticker: symbol,
    contract: contractWord(symbol, strike, right),
    right,
    strike,
    expiry: dte === 0 ? '0DTE' : `${dte}DTE`,
    expiryDate: expiration,
    sessionsLeft: sessions,
    sigmaMovePct: Number(sigma.toFixed(2)),
    sleeve,
    score: spread <= 0.08 && bid > 0.15 ? Math.round((1 - Math.min(spread, 1)) * 100) : 0,
    verdict: 'WATCH',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: Number((ask * 1.5).toFixed(2)), pct: 50 },
    scalpExit: { price: Number((ask * (1 - STOP_KEEP)).toFixed(2)), pct: 53 },
    headline: `${contractWord(symbol, strike, right)} · bid ${bid.toFixed(2)} ask ${ask.toFixed(2)}`,
    whyChips: ['LIVE'],
    whyText: 'The national bid and ask, and the greeks on that quote.',
    greeks: {
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      iv: greeks.iv,
      rho: greeks.rho,
    },
    bid,
    ask,
    mid,
    liveMid: mid,
    highWater: mid,
    confidence: 0,
    health: 0,
    momentum: 'NEUTRAL',
    takeProfits: [1, 2, 3].map(level => ({
      level,
      status: 'PENDING' as const,
      expectedPct: level === 1 ? 50 : level === 2 ? 100 : 200,
      target: Number((ask * (level === 1 ? 1.5 : level === 2 ? 2 : 3)).toFixed(2)),
    })),
    priceTargets: [],
    liquidityLabel: spread <= 0.02 ? 'Tight' : spread <= 0.08 ? 'Normal' : 'Wide',
    liquiditySpread: `${(spread * 100).toFixed(1)}% spread`,
    invalidationPrice: 0,
    invalidationReason: 'No separate level on this quote.',
    spot,
    seenAt: listedAt.get(id) ?? Date.now(),
    quotedAt,
    vanna: greeks.vanna,
    charm: greeks.charm,
    vomma: greeks.vomma,
    veta: greeks.veta,
    speed: greeks.speed,
    zomma: greeks.zomma,
    color: greeks.color,
    ultima: greeks.ultima,
    lambda: greeks.lambda,
    epsilon: greeks.epsilon,
  };
}

function rowOf(item: Record<string, unknown>): { contract: Record<string, unknown>; quote: Record<string, unknown> } | null {
  const contract = item.contract && typeof item.contract === 'object' ? (item.contract as Record<string, unknown>) : item;
  const quote = Array.isArray(item.data) ? (item.data[0] as Record<string, unknown>) : item;
  if (!quote || typeof quote !== 'object') return null;
  return { contract, quote };
}

function nyISO(ms: number): string {
  const day = ymd(ms);
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

function dteOf(today: string, exp: string): number {
  return Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

interface Draft {
  root: string;
  strike: number;
  right: OptionRight;
  exp: string;
  bid: number;
  ask: number;
  under: number;
  at: number;
  greeks: LiveGreeks;
}

/** Every session. Checked against the live book on 2026-10-27. */
const DAILY_0DTE = ['SPXW', 'SPY', 'QQQ', 'IWM', 'XSP', 'RUTW', 'GLD'];
/** Monday, Wednesday, Friday. A name that does not list that day comes back empty and is skipped. */
const MWF_0DTE = ['NVDA', 'TSLA', 'META', 'AVGO', 'AAPL', 'TLT', 'AMD', 'AMZN', 'TQQQ', 'SLV', 'MU', 'SMH', 'XLE', 'GDX', 'USO', 'UNG', 'XLF'];

function odteNames(now: number): string[] {
  const day = nyParts(now).weekday;
  return day === 1 || day === 3 || day === 5 ? [...DAILY_0DTE, ...MWF_0DTE] : [...DAILY_0DTE];
}

async function weeklyDate(symbol: string, today: string): Promise<string> {
  const hit = weeklyMemo.get(symbol);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.date;
  const got = await thetaCall(`/option/list/expirations?symbol=${symbol}&format=json`);
  let best = '';
  for (const row of asRows(got.data)) {
    const exp = String(row.expiration ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
    const n = dteOf(today, exp);
    if (n >= 1 && n <= 7 && (!best || exp < best)) best = exp;
  }
  weeklyMemo.set(symbol, { at: Date.now(), date: best });
  return best;
}

const weeklyMemo = new Map<string, { at: number; date: string }>();

/** One snapshot. `only` is today's date for 0DTE. The 1–7 day book asks for that one expiry, not the whole chain. */
async function once(symbol: string, now: number, only: string, jump = false): Promise<{ setups: Setup[]; spot: number }> {
  const today = nyISO(now);
  let weeklyExp = '';
  let asked = only.replace(/-/g, '');
  if (only === '*') {
    weeklyExp = await weeklyDate(symbol, today);
    if (!weeklyExp) return { setups: [], spot: 0 };
    asked = weeklyExp.replace(/-/g, '');
  }
  const range = only === '*' ? 4 : 16;
  const got = await thetaCall(`/option/snapshot/greeks/first_order?symbol=${symbol}&expiration=${asked}&right=both&strike_range=${range}&format=json`, jump);
  const drafts = new Map<string, Draft[]>();
  let spot = 0;
  if (!got.error && got.status !== 472) {
    for (const item of asRows(got.data)) {
      const row = rowOf(item);
      if (!row) continue;
      const bid = num(row.quote.bid);
      const ask = num(row.quote.ask);
      const at = stampMs(row.quote.timestamp);
      if (!(bid > 0) || !(ask >= bid) || !at || now - at > FRESH_MS) continue;
      const strike = num(row.contract.strike);
      const exp = String(row.contract.expiration || '').slice(0, 10);
      const rightWord = String(row.contract.right || '').toLowerCase();
      const right: OptionRight | null = rightWord.startsWith('c') ? 'C' : rightWord.startsWith('p') ? 'P' : null;
      if (!right || !(strike > 0) || exp.length < 10) continue;
      const under = num(row.quote.underlying_price);
      if (under > 0) spot = under;
      const iv = finite(row.quote.implied_vol);
      const root = String(row.contract.symbol || row.contract.root || symbol).toUpperCase();
      const empty = NaN;
      const list = drafts.get(exp) ?? [];
      list.push({
        root, strike, right, exp, bid, ask, under, at,
        greeks: {
          delta: finite(row.quote.delta),
          gamma: empty,
          theta: perDay(finite(row.quote.theta)),
          vega: perPoint(finite(row.quote.vega)),
          rho: perPoint(finite(row.quote.rho)),
          iv: iv > 0 && iv < 3 ? iv * 100 : iv,
          vanna: empty, charm: empty, vomma: empty, veta: empty,
          speed: empty, zomma: empty, color: empty, ultima: empty,
          lambda: finite(row.quote.lambda),
          epsilon: finite(row.quote.epsilon),
        },
      });
      drafts.set(exp, list);
    }
  }
  const build = (exp: string, sleeve: SleeveKey) => (drafts.get(exp) ?? []).map(d => toSetup(d.root, d.strike, d.right, d.exp, d.bid, d.ask, d.under, sleeve, d.at, d.greeks));
  if (only !== '*') return { setups: build(only, only === today ? 'odte' : 'weekly'), spot };
  return { setups: weeklyExp ? build(weeklyExp, 'weekly') : [], spot };
}

const ALL = [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];

function pickLine(): string {
  const rows = currentPicks();
  const swings = rows.filter(s => s.band === 'top').length;
  const band = rows.filter(s => s.band === 'average').length;
  const wings = rows.filter(s => s.band === 'wing').length;
  const scalps = rows.filter(s => s.band === 'scalp').length;
  return `${swings} at 70.67%. ${band} at 31%. ${wings} wing. ${scalps} scalp.`;
}

function writeBook(next: Setup[], spots: Record<string, number>): void {
  byId.clear();
  for (const s of next) byId.set(s.id, s);
  book = { ...book, setups: next, status: 'live', spots, line: pickLine() };
  publishSpots(spots, Date.now());
  emit();
}

async function scoreSlice(symbols: string[], only: string, jump: boolean, spots: Record<string, number>, found: Setup[]): Promise<void> {
  const before = currentPicks().length;
  const got = await Promise.all(symbols.map(symbol => once(symbol, Date.now(), only, jump)));
  for (const row of got) {
    if (row.setups.length) {
      try { await scoreBook(row.setups, Date.now(), true); } catch { /* this name, not the rest */ }
    }
    const symbol = row.setups[0]?.ticker;
    if (symbol && row.spot > 0) {
      spots[symbol] = row.spot;
      if (INDEX_OF[symbol]) spots[INDEX_OF[symbol]] = row.spot;
    }
    for (const s of row.setups) found.push(s);
  }
  if (currentPicks().length !== before) {
    book = { ...book, status: 'live', spots, line: pickLine() };
    emit();
  }
}

/** The whole 0DTE book. It does not wait on the weekly walk. */
async function scanOdte(now: number): Promise<void> {
  setScanBusy(true);
  emit();
  try {
    const symbols = odteNames(now);
    resetScanReport('odte');
    dropPending('odte');
    setScanPace(0, symbols.length, 'odte');
    const spots = { ...book.spots };
    const found: Setup[] = [];
    for (let i = 0; i < symbols.length; i += 8) {
      const slice = symbols.slice(i, i + 8);
      await scoreSlice(slice, nyISO(now), true, spots, found);
      setScanPace(Math.min(symbols.length, i + slice.length), symbols.length, 'odte');
    }
    writeBook([...book.setups.filter(s => s.expiry !== '0DTE'), ...found], spots);
    commitScalps('odte');
    book = { ...book, line: pickLine() };
    emit();
  } catch {
    /* the next slot tries again */
  } finally {
    setScanBusy(false);
    emit();
  }
}

let weeklyOn = false;
let weeklyCursor = 0;
let weeklyFound: Setup[] = [];
let weeklySeen = new Set<string>();

function startWeekly(): void {
  weeklyOn = true;
  weeklyCursor = 0;
  weeklyFound = [];
  weeklySeen = new Set();
  resetScanReport('weekly');
  dropPending('weekly');
  setScanPace(0, ALL.length, 'weekly');
}

/** Eight names, then yield so the next tick can run 0DTE again. */
async function scanWeeklyWave(): Promise<boolean> {
  const slice = ALL.slice(weeklyCursor, weeklyCursor + 8);
  if (!slice.length) {
    weeklyOn = false;
    return true;
  }
  const spots = { ...book.spots };
  const found: Setup[] = [];
  try {
    await scoreSlice(slice, '*', false, spots, found);
  } catch {
    /* this wave, not the walk */
  }
  for (const symbol of slice) weeklySeen.add(symbol);
  for (const s of found) weeklyFound.push(s);
  weeklyCursor += slice.length;
  setScanPace(Math.min(weeklyCursor, ALL.length), ALL.length, 'weekly');
  const fresh = new Set(slice);
  const kept = book.setups.filter(s => s.expiry === '0DTE' || !fresh.has(s.ticker));
  writeBook([...kept, ...found], spots);
  if (weeklyCursor < ALL.length) return false;
  const done = book.setups.filter(s => s.expiry === '0DTE' || (weeklySeen.has(s.ticker) && weeklyFound.some(f => f.ticker === s.ticker)));
  writeBook(done, spots);
  commitScalps('weekly');
  book = { ...book, line: pickLine() };
  emit();
  weeklyOn = false;
  return true;
}

const SPARK_UNDER: Record<string, string> = { SPXW: 'SPX', XSP: 'SPX', RUTW: 'RUT', SPX: 'SPX', RUT: 'RUT', VIX: 'VIX' };

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
}

async function closesOf(symbol: string, index: boolean): Promise<number[]> {
  for (let back = 0; back < 4; back++) {
    const day = ymd(Date.now() - back * 86400000);
    const path = index
      ? `/index/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`
      : `/stock/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`;
    const got = await thetaCall(path);
    const series = asRows(got.data).map(r => num(r.close)).filter(n => n > 0);
    if (series.length >= 2) return series;
  }
  return [];
}

async function fillSparks(symbols: string[]): Promise<void> {
  const keys = [...new Set(symbols.map(s => SPARK_UNDER[s] ?? s))];
  const fresh: Record<string, number[]> = { ...book.sparks };
  await Promise.all(keys.map(async key => {
    if ((fresh[key]?.length ?? 0) >= 2) return;
    const series = await closesOf(key, key in SPARK_UNDER || key in INDEX_OF);
    if (series.length >= 2) fresh[key] = series;
  }));
  book = { ...book, sparks: fresh };
  emit();
}

export interface LiveBar { time: number; open: number; high: number; low: number; close: number }

const barCache = new Map<string, { at: number; bars: LiveBar[] }>();

function barWindow(tf: Timeframe): { interval: string; days: number } {
  switch (tf) {
    case '1W': return { interval: '1d', days: 120 };
    case '1D': return { interval: '1d', days: 40 };
    case '1h': return { interval: '1h', days: 15 };
    case '30m': return { interval: '30m', days: 10 };
    case '15m': return { interval: '15m', days: 6 };
    case '5m': return { interval: '5m', days: 4 };
    default: return { interval: '1m', days: 2 };
  }
}

function readBars(data: unknown): LiveBar[] {
  const flat: Record<string, unknown>[] = [];
  for (const item of asRows(data)) {
    const row = item as { data?: unknown; close?: unknown };
    if (Array.isArray(row.data)) flat.push(...(row.data as Record<string, unknown>[]));
    else if (row.close != null) flat.push(item);
  }
  return flat
    .map(b => ({
      time: Math.floor(stampMs(b.timestamp) / 1000),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close),
    }))
    .filter(b => b.time > 0 && b.high > 0 && b.low > 0 && b.close > 0)
    .sort((a, b) => a.time - b.time);
}

export function useContractBars(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean, tf: Timeframe = '1m'): LiveBar[] | null {
  const spec = barWindow(tf);
  const key = `${ticker}|${expiration}|${strike}|${right}|${spec.interval}`;
  const [bars, setBars] = useState<LiveBar[] | null>(barCache.get(key)?.bars ?? null);
  useEffect(() => {
    if (!on || !ticker || !expiration) return;
    const hit = barCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) {
      setBars(hit.bars);
      return;
    }
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const end = ymd(Date.now());
    const start = ymd(Date.now() - spec.days * 86400000);
    const rightWord = right === 'C' ? 'call' : 'put';
    const path = (interval: string, from: string) => `/option/history/ohlc?symbol=${ticker}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${from}&end_date=${end}&interval=${interval}&format=json`;
    void thetaCall(path(spec.interval, start)).then(async got => {
      if (dead) return;
      let rows = readBars(got.data);
      if (!rows.length && spec.interval !== '1m') {
        const again = await thetaCall(path('1m', ymd(Date.now() - 2 * 86400000)));
        if (!dead) rows = readBars(again.data);
      }
      if (dead) return;
      barCache.set(key, { at: Date.now(), bars: rows });
      setBars(rows);
    });
    return () => { dead = true; };
  }, [key, on, ticker, expiration, strike, right, spec.interval, spec.days]);
  return bars;
}

export function useSecondGreek(ticker: string, expiration: string, strike: number, right: OptionRight, on: boolean): { gamma: number; vanna: number; charm: number } | null {
  const key = `${ticker}|${expiration}|${strike}|${right}|g`;
  const [row, setRow] = useState<{ gamma: number; vanna: number; charm: number } | null>(null);
  useEffect(() => {
    if (!on || !ticker || !expiration || !(strike > 0)) return;
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const rightWord = right === 'C' ? 'call' : 'put';
    void thetaCall(`/option/snapshot/greeks/second_order?symbol=${ticker}&expiration=${exp}&strike=${strike}&right=${rightWord}&format=json`).then(got => {
      if (dead) return;
      const item = asRows(got.data)[0];
      const quote = item ? rowOf(item)?.quote : null;
      if (!quote) return;
      setRow({ gamma: num(quote.gamma), vanna: num(quote.vanna), charm: num(quote.charm) / 252 });
    });
    return () => { dead = true; };
  }, [key, on, ticker, expiration, strike, right]);
  return row;
}

export function useThetaBook(sleeve: SleeveKey): ThetaBook {
  const [snap, setSnap] = useState(book);
  useEffect(() => {
    bootCompass();
    const fn = () => setSnap(book);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [sleeve]);
  const wanted = sleeve === 'weekly' ? 'weekly' : 'odte';
  const setups = snap.setups.filter(s => (wanted === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE'));
  return { ...snap, setups, line: setups.length ? `${setups.length} live contracts. National bid and ask.` : snap.line };
}

let armed = false;
let ticking = false;

/** 0DTE runs a full pass on its own clock. Weekly walks eight names a tick. */
export function bootCompass(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const odte = claimSlot(now, 'odte');
      if (odte === 'closed') {
        weeklyOn = false;
        return;
      }
      if (odte === 'scan') {
        weeklyOn = false;
        await scanOdte(now);
      }
      if (!weeklyOn) {
        const weekly = claimSlot(now, 'weekly');
        if (weekly === 'scan') startWeekly();
      }
      if (weeklyOn) await scanWeeklyWave();
    } finally {
      ticking = false;
    }
  };
  void tick();
  window.setInterval(() => void tick(), 8_000);
}
