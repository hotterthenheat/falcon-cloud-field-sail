/*
  The live book. Theta's own quotes. No simulated price, no invented greek.
  A contract is on the board only while its quote is from this session.
*/

import { useEffect, useState } from 'react';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { indexLevel, indexRoot, liveSpotOf, noteIndex, noteSpot } from './traceLive';
import { setupIdOf } from './compass';
import { sessionScanOpen, weekdayDte } from './compassParams';
import { deskPhase, odteAsleep, optionScanOpen, sessionIso, sessionYmd } from './compassSession';
import { COMPASS_TICKERS } from './compassUniverse';
import { SIM_DESK } from './deskMode';
import { claimSlot, commitClosest, commitScalps, currentPicks, dropPending, paintQuotes, releaseSlot, resetScanReport, scanReport, scoreBook, scoreLottery, setScanBusy, setScanPace, stampPickQuote } from './compassModel';
import { settleBoard, syncOpenBook } from './compassLedger';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import type { Timeframe } from './timeframe';

const OPEN_ROOTS = ['SPXW', 'RUTW', 'VIX', 'XSP'] as const;
const INDEX_OF: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };
const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW' };
const FRESH_MS = 30 * 1000;

export interface ThetaBook {
  status: 'loading' | 'live' | 'down';
  setups: Setup[];
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
}

const heldNow = currentPicks();
const empty: ThetaBook = {
  status: heldNow.length ? 'live' : 'loading',
  setups: heldNow,
  spots: {},
  sparks: {},
  line: heldNow.length ? pickLine() : 'Reading the live book.',
};

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
  const session = sessionYmd(quotedAt || Date.now());
  const wd = weekdayDte(session, expiration);
  const dte = Number.isFinite(wd) ? wd : Math.max(0, Math.round((Date.parse(`${expiration}T16:00:00`) - Date.now()) / 86400000));
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
    score: 0,
    verdict: 'WATCH',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, pct: 0 },
    scalpExit: { price: 0, pct: 0 },
    headline: `${contractWord(symbol, strike, right)} · bid ${bid.toFixed(2)} ask ${ask.toFixed(2)}`,
    whyChips: [],
    whyText: 'National bid and ask. Not a call until a book sends it.',
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
    takeProfits: [],
    priceTargets: [],
    liquidityLabel: spread <= 0.02 ? 'Tight' : spread <= 0.08 ? 'Normal' : 'Wide',
    liquiditySpread: `${(spread * 100).toFixed(1)}% spread`,
    invalidationPrice: 0,
    invalidationReason: '',
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

/** Monday–Friday. The chain wins: an empty expiration is not a ticket. */
const DAILY_0DTE = ['SPXW', 'NDXP', 'XSP', 'RUTW', 'VIX', 'SPY', 'QQQ', 'IWM', 'GLD', 'XLF', 'SMH'];
/** Monday, Wednesday, Friday stocks. GOOG is not in this set. */
const MWF_STOCK = ['AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA'];
/** Monday, Wednesday, Friday ETFs. EEM and SOXL skip some of those days. */
const MWF_ETF = ['SLV', 'TLT', 'XLE', 'EEM', 'TQQQ', 'SOXL'];
/** Wednesday and Friday. */
const WF_0DTE = ['USO', 'UNG'];

function odteBook(now: number): string[] {
  const session = sessionYmd(now);
  const day = nyParts(nyWallTime(Number(session.slice(0, 4)), Number(session.slice(4, 6)), Number(session.slice(6, 8)), 12, 0)).weekday;
  const names = [...DAILY_0DTE];
  if (day === 1 || day === 3 || day === 5) names.push(...MWF_STOCK, ...MWF_ETF);
  if (day === 3 || day === 5) names.push(...WF_0DTE);
  return names;
}

function odteNames(now: number): string[] {
  if (odteAsleep(now)) return [];
  return odteBook(now).filter(t => optionScanOpen(t, 0, now));
}

function weeklyNames(now: number): string[] {
  return ALL.filter(t => optionScanOpen(t, 1, now));
}

/** The names a sleeve can call. 0DTE is the roots that list a same-day contract on this session, even while the tape is shut. */
export function alertUniverse(sleeve: 'odte' | 'weekly'): readonly string[] {
  if (sleeve === 'odte') return odteBook(Date.now());
  return ALL;
}

async function weeklyDate(symbol: string, today: string): Promise<string> {
  const hit = weeklyMemo.get(symbol);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.date;
  const got = await thetaCall(`/option/list/expirations?symbol=${symbol}&format=json`);
  let best = '';
  for (const row of asRows(got.data)) {
    const exp = String(row.expiration ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
    const n = weekdayDte(today, exp);
    if (n >= 1 && n <= 7 && (!best || exp < best)) best = exp;
  }
  weeklyMemo.set(symbol, { at: Date.now(), date: best });
  return best;
}

const weeklyMemo = new Map<string, { at: number; date: string }>();

/** Book A is four strikes from the money. Book B is twelve. Farther than that is not a call and not a closest, except a same-day contract cheap enough for Book C. */
function kept(list: Draft[]): Draft[] {
  if (list.length <= 80) return list;
  const strikes = [...new Set(list.map(d => d.strike))].sort((a, b) => a - b);
  const spot = list.find(d => d.under > 0)?.under ?? 0;
  let atm = 0;
  let best = Infinity;
  strikes.forEach((k, i) => {
    const dist = Math.abs(k - spot);
    if (dist < best) {
      best = dist;
      atm = i;
    }
  });
  const near = new Set(strikes.filter((_, i) => Math.abs(i - atm) <= 12));
  for (const d of list) if (d.ask > 0 && d.ask <= 1.65) near.add(d.strike);
  return list.filter(d => near.has(d.strike));
}

/** One snapshot. `only` is today's date for 0DTE. The 1–7 day book asks for that one expiry, not the whole chain. */
async function once(symbol: string, now: number, only: string, jump = false, freshMs = FRESH_MS): Promise<{ setups: Setup[]; spot: number }> {
  const today = sessionIso(now);
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
      if (!(bid > 0) || !(ask >= bid) || !at || now - at > freshMs) continue;
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
  const build = (exp: string, sleeve: SleeveKey) => kept(drafts.get(exp) ?? []).map(d => toSetup(d.root, d.strike, d.right, d.exp, d.bid, d.ask, d.under, sleeve, d.at, d.greeks));
  if (only !== '*') {
    const sleeve: SleeveKey = only.replace(/-/g, '') === sessionYmd(now) ? 'odte' : 'weekly';
    return { setups: build(only.slice(0, 10), sleeve), spot };
  }
  return { setups: weeklyExp ? build(weeklyExp, 'weekly') : [], spot };
}

const ALL = [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];

function pickLine(): string {
  const rows = currentPicks();
  const a = rows.filter(s => s.band === 'top').length;
  const b = rows.filter(s => s.band === 'wing').length;
  const c = rows.filter(s => s.band === 'lottery').length;
  return `Book A ${a}. Book B ${b}. Book C ${c}. Model 1 entry. Model 2 runner.`;
}

function writeBook(_next: Setup[], spots: Record<string, number>): void {
  const next = currentPicks();
  byId.clear();
  for (const s of next) byId.set(s.id, s);
  book = { ...book, setups: next, status: 'live', spots, line: pickLine() };
  publishSpots(spots, Date.now());
  emit();
}

async function scoreSlice(symbols: string[], only: string, jump: boolean, spots: Record<string, number>, found: Setup[], freshMs = FRESH_MS, at = Date.now()): Promise<void> {
  const before = currentPicks().length;
  const got = await Promise.all(symbols.map(symbol => once(symbol, at, only, jump, freshMs)));
  for (const row of got) {
    if (row.setups.length) {
      try { await scoreBook(row.setups, at, true); } catch { /* this name, not the rest */ }
    }
    syncOpenBook(at);
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

/** One pass. Cards from it stay. A later slot does not walk the universe again. */
async function scanOdte(now: number): Promise<boolean> {
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
      await scoreSlice(slice, sessionIso(now), true, spots, found, 90_000, now);
      setScanPace(Math.min(symbols.length, i + slice.length), symbols.length, 'odte');
    }
    commitClosest('odte');
    writeBook([...book.setups.filter(s => s.expiry !== '0DTE'), ...found], spots);
    void fillSparks(symbols);
    commitScalps('odte');
    book = { ...book, line: pickLine() };
    emit();
    return true;
  } catch {
    return false;
  } finally {
    setScanBusy(false);
    emit();
  }
}

let weeklyOn = false;
let weeklyFinishedAt = 0;
let weeklyCursor = 0;
let weeklyFound: Setup[] = [];
let weeklySeen = new Set<string>();
let weeklyList: string[] = [];

function startWeekly(names: string[]): void {
  weeklyOn = true;
  weeklyCursor = 0;
  weeklyFound = [];
  weeklySeen = new Set();
  weeklyList = names;
  resetScanReport('weekly');
  dropPending('weekly');
  setScanPace(0, names.length, 'weekly');
}

/** Eight names, then yield so the next tick can run 0DTE again. */
async function scanWeeklyWave(): Promise<boolean> {
  const slice = weeklyList.slice(weeklyCursor, weeklyCursor + 8);
  if (!slice.length) {
    weeklyOn = false;
    return true;
  }
  const spots = { ...book.spots };
  const found: Setup[] = [];
  try {
    await scoreSlice(slice, '*', false, spots, found, 90_000);
  } catch {
    /* this wave, not the walk */
  }
  for (const symbol of slice) weeklySeen.add(symbol);
  for (const s of found) weeklyFound.push(s);
  weeklyCursor += slice.length;
  setScanPace(Math.min(weeklyCursor, weeklyList.length), weeklyList.length, 'weekly');
  const fresh = new Set(slice);
  const kept = book.setups.filter(s => s.expiry === '0DTE' || !fresh.has(s.ticker));
  writeBook([...kept, ...found], spots);
  if (weeklyCursor < weeklyList.length) return false;
  const done = book.setups.filter(s => s.expiry === '0DTE' || (weeklySeen.has(s.ticker) && weeklyFound.some(f => f.ticker === s.ticker)));
  writeBook(done, spots);
  commitClosest('weekly');
  commitScalps('weekly');
  void fillSparks(weeklyList);
  book = { ...book, line: pickLine() };
  emit();
  weeklyOn = false;
  weeklyFinishedAt = Date.now();
  return true;
}

let closedRead = 0;

/** The entry window is shut. Still read the chain so the desk is not a spinner. No new call. */
async function readClosed(now: number): Promise<void> {
  if (Date.now() - closedRead < 60_000 && book.status === 'live') return;
  closedRead = Date.now();
  const symbols = odteNames(now);
  const spots = { ...book.spots };
  const found: Setup[] = [];
  const lastQuote = 18 * 60 * 60 * 1000;
  for (let i = 0; i < symbols.length; i += 8) {
    await scoreSlice(symbols.slice(i, i + 8), sessionIso(now), true, spots, found, lastQuote);
  }
  writeBook([...book.setups.filter(s => s.expiry !== '0DTE'), ...found], spots);
  book = {
    ...book,
    status: 'live',
    line: found.length ? 'Last quotes are in. Not a call until a book sends one.' : 'No quote on the chain.',
  };
  emit();
}

const SPARK_UNDER: Record<string, string> = { SPXW: 'SPX', XSP: 'SPX', RUTW: 'RUT', SPX: 'SPX', RUT: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };

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

let sparkAt = 0;

async function fillSparks(symbols: string[]): Promise<void> {
  const stale = Date.now() - sparkAt > 5 * 60_000;
  const keys = [...new Set(symbols.map(s => SPARK_UNDER[s] ?? s))];
  const fresh: Record<string, number[]> = { ...book.sparks };
  await Promise.all(keys.map(async key => {
    if (!stale && (fresh[key]?.length ?? 0) >= 2) return;
    const series = await closesOf(key, key in SPARK_UNDER || key in INDEX_OF);
    if (series.length >= 2) fresh[key] = series;
  }));
  sparkAt = Date.now();
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
    let dead = false;
    const exp = expiration.replace(/-/g, '');
    const rightWord = right === 'C' ? 'call' : 'put';
    const pull = async () => {
      const end = ymd(Date.now());
      const days = spec.interval === '1m' ? 1 : spec.days;
      const start = ymd(Date.now() - days * 86400000);
      const path = (interval: string, from: string) => `/option/history/ohlc?symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${from}&end_date=${end}&interval=${interval}&format=json`;
      const got = await thetaCall(path(spec.interval, start), true);
      if (dead) return;
      let rows = readBars(got.data);
      if (!rows.length && spec.interval !== '1m') {
        const again = await thetaCall(path('1m', ymd(Date.now())), true);
        if (!dead) rows = readBars(again.data);
      }
      if (dead || !rows.length) return;
      barCache.set(key, { at: Date.now(), bars: rows });
      setBars(rows);
    };
    const hit = barCache.get(key);
    if (hit) setBars(hit.bars);
    void pull();
    const id = window.setInterval(() => void pull(), spec.interval === '1m' ? 8_000 : 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [key, on, ticker, expiration, strike, right, spec.interval, spec.days]);
  return bars;
}

export interface ContractLive {
  bid: number;
  ask: number;
  at: number;
  under: number;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  /** This contract's own premium closes, then the live mark. Not the underlying. */
  prem: number[];
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
const premAsked = new Set<string>();
let quoteTimer: number | null = null;

function quoteKey(ticker: string, expiration: string, strike: number, right: OptionRight): string {
  return `${ticker}|${expiration}|${strike}|${right}`;
}

async function seedPrem(key: string, ticker: string, expiration: string, strike: number, right: OptionRight): Promise<void> {
  if (premAsked.has(key)) return;
  premAsked.add(key);
  const exp = expiration.replace(/-/g, '');
  const rightWord = right === 'C' ? 'call' : 'put';
  const day = ymd(Date.now());
  const got = await thetaCall(`/option/history/ohlc?symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${day}&end_date=${day}&interval=1m&format=json`, true);
  const closes = readBars(got.data).map(b => b.close).filter(n => n > 0);
  const box = quoteBox.get(key);
  if (!box || closes.length < 2) return;
  box.prem = closes;
  quoteHeard.forEach(fn => fn());
}

async function pullQuote(key: string, want: QuoteWant): Promise<void> {
  const exp = want.expiration.replace(/-/g, '');
  const rightWord = want.right === 'C' ? 'call' : 'put';
  const got = await thetaCall(
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
    const mark = (nextBid + nextAsk) / 2;
    const prev = quoteBox.get(key);
    const prem = prev?.prem ? prev.prem.slice(-239) : [];
    if (!(prem[prem.length - 1] > 0) || Math.abs(prem[prem.length - 1] - mark) >= 0.01) prem.push(mark);
    quoteBox.set(key, {
      bid: nextBid,
      ask: nextAsk,
      at: stampMs(parsed.quote.timestamp) || Date.now(),
      under: field(parsed.quote.underlying_price),
      delta: field(parsed.quote.delta),
      theta: perDay(field(parsed.quote.theta)),
      vega: perPoint(field(parsed.quote.vega)),
      rho: perPoint(field(parsed.quote.rho)),
      iv: rawIv > 0 && rawIv < 3 ? rawIv * 100 : rawIv,
      prem,
    });
    const box = quoteBox.get(key)!;
    stampPickQuote(want.ticker, want.expiration, want.strike, want.right, box);
    emit();
    void seedPrem(key, want.ticker, want.expiration, want.strike, want.right);
    return;
  }
}

function pullQuotes(): void {
  for (const s of currentPicks()) {
    if (!s.expiryDate || !(s.strike > 0)) continue;
    const key = quoteKey(s.ticker, s.expiryDate, s.strike, s.right);
    if (!quoteWant.has(key)) quoteWant.set(key, { ticker: s.ticker, expiration: s.expiryDate, strike: s.strike, right: s.right, n: 1 });
  }
  for (const [key, want] of quoteWant) void pullQuote(key, want).then(() => quoteHeard.forEach(fn => fn()));
}

function armQuotes(): void {
  if (typeof window === 'undefined') return;
  pullQuotes();
  if (quoteTimer != null) return;
  quoteTimer = window.setInterval(pullQuotes, 2_000);
}

/** One quote for the card and the contract page. Same bid, same premium line. */
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
      void thetaCall(`/option/snapshot/greeks/second_order?symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&format=json`, true).then(got => {
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
  return { ...snap, setups };
}

let armed = false;
let ticking = false;

/** 1–7 DTE. Same grid as same-day. One pass per slot, not a drip. */
async function scanWeekly(now: number): Promise<boolean> {
  setScanBusy(true);
  emit();
  try {
    const symbols = weeklyNames(now);
    resetScanReport('weekly');
    dropPending('weekly');
    setScanPace(0, symbols.length, 'weekly');
    const spots = { ...book.spots };
    const found: Setup[] = [];
    for (let i = 0; i < symbols.length; i += 8) {
      const slice = symbols.slice(i, i + 8);
      await scoreSlice(slice, '*', false, spots, found, 90_000, now);
      setScanPace(Math.min(symbols.length, i + slice.length), symbols.length, 'weekly');
    }
    writeBook([...book.setups.filter(s => s.expiry === '0DTE'), ...found], spots);
    commitClosest('weekly');
    book = { ...book, line: pickLine() };
    emit();
    return true;
  } catch {
    return false;
  } finally {
    setScanBusy(false);
    emit();
  }
}

let lookCursor = 0;
let lookWeekly = false;

/** Quotes only. No model, no call. Eight names a pass, around the clock. */
async function lookTick(now: number): Promise<void> {
  const symbols = lookWeekly ? weeklyNames(now) : odteNames(now);
  if (!symbols.length) {
    lookWeekly = !lookWeekly;
    lookCursor = 0;
    return;
  }
  const slice = symbols.slice(lookCursor, lookCursor + 8);
  if (!slice.length) {
    lookCursor = 0;
    lookWeekly = !lookWeekly;
    return;
  }
  const fresh = 90_000;
  const only = lookWeekly ? '*' : sessionIso(now);
  const spots = { ...book.spots };
  const got = await Promise.all(slice.map(symbol => once(symbol, now, only, false, fresh)));
  for (const row of got) {
    const symbol = row.setups[0]?.ticker;
    if (symbol && row.spot > 0) {
      spots[symbol] = row.spot;
      if (INDEX_OF[symbol]) spots[INDEX_OF[symbol]] = row.spot;
    }
  }
  lookCursor += slice.length;
  writeBook(currentPicks(), spots);
  book = { ...book, line: pickLine() };
  emit();
}

let sweptDay = '';
const swept = { odte: false, weekly: false, lottery: false };

function rollDay(now: number): void {
  const day = sessionYmd(now);
  if (day === sweptDay) return;
  sweptDay = day;
  swept.odte = false;
  swept.weekly = false;
  swept.lottery = false;
}

/** Quotes for the cards already up. No new universe walk. */
async function refreshHeld(now: number): Promise<void> {
  const rows = currentPicks();
  settleBoard(rows, now);
  const live = currentPicks();
  if (!live.length) {
    book = { ...book, line: pickLine() };
    emit();
    return;
  }
  const byExp = new Map<string, string[]>();
  for (const s of live) {
    const exp = s.expiryDate || nyISO(now);
    const list = byExp.get(exp) ?? [];
    if (!list.includes(s.ticker)) list.push(s.ticker);
    byExp.set(exp, list);
  }
  const spots = { ...book.spots };
  const found: Setup[] = [];
  for (const [exp, symbols] of byExp) {
    for (let i = 0; i < symbols.length; i += 8) {
      const slice = symbols.slice(i, i + 8);
      const got = await Promise.all(slice.map(symbol => once(symbol, now, exp, false, 90_000)));
      for (const row of got) {
        const symbol = row.setups[0]?.ticker;
        if (symbol && row.spot > 0) spots[symbol] = row.spot;
        found.push(...row.setups);
      }
    }
  }
  settleBoard(found.length ? found : live, now);
  if (found.length) paintQuotes(found);
  const ids = new Set(found.map(s => s.ticker + s.expiryDate));
  const kept = book.setups.filter(s => !ids.has(s.ticker + s.expiryDate));
  writeBook([...kept, ...found], spots);
  book = { ...book, line: pickLine() };
  emit();
}

/** 0DTE and 1–7 DTE scan once a session. After that the cards stay and only their quotes move. */
export function bootCompass(): void {
  if (SIM_DESK || typeof window === 'undefined') return;
  if (!armed && currentPicks().length) {
    writeBook(currentPicks(), book.spots);
    syncOpenBook();
  }
  armQuotes();
  if (armed) return;
  armed = true;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      rollDay(now);
      const clock = nyParts(now);
      const mins = clock.hour * 60 + clock.minute;
      const grid = sessionScanOpen(mins, clock.weekday);
      let scanned = false;
      if (!swept.lottery && mins >= 15 * 60 + 20 && mins < 15 * 60 + 50) {
        const symbols = odteNames(now);
        const spots = { ...book.spots };
        const found: Setup[] = [];
        for (let i = 0; i < symbols.length; i += 8) {
          await scoreSlice(symbols.slice(i, i + 8), sessionIso(now), true, spots, found, 20_000);
        }
        await scoreLottery(found, now);
        syncOpenBook(now);
        writeBook([...book.setups.filter(s => s.expiry !== '0DTE'), ...found], spots);
        book = { ...book, line: pickLine() };
        emit();
        swept.lottery = true;
        scanned = true;
      }
      if (grid && !odteAsleep(now)) {
        const odte = claimSlot(now, 'odte');
        if (odte === 'scan') {
          await scanOdte(now);
          const report = scanReport('odte');
          if (report.scored === 0 && report.quiet > 0) releaseSlot('odte');
          scanned = report.scored > 0 || report.quiet === 0;
        }
      }
      const phase = deskPhase(now);
      const tapeUp = phase === 'overnight' || phase === 'pre' || phase === 'open' || phase === 'curb';
      const weeklyDue = !weeklyOn && tapeUp && (grid || Date.now() - weeklyFinishedAt > 5 * 60_000);
      if (weeklyDue) {
        const names = weeklyNames(now);
        if (names.length) startWeekly(names);
        else weeklyFinishedAt = Date.now();
      }
      if (weeklyOn) {
        const done = await scanWeeklyWave();
        if (done) scanned = true;
      }
      if (!scanned && currentPicks().length) await refreshHeld(now);
    } finally {
      ticking = false;
    }
  };
  void tick();
  window.setInterval(() => void tick(), 8_000);
}
