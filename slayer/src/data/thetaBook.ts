/*
  The live book. ThetaData's own quotes: no simulated price, no invented greek. A contract is on the board only while
  its quote is from this session. The scan reads only the names on screen (the session's 0DTE roots, the weekly
  focus list, or the one name the board is filtered to), one snapshot per name, and stops when Compass closes or the
  tab is hidden. With the terminal down every read waits on data/theta.ts's breaker and the board keeps the last
  scan, stamped.
*/

import { useEffect, useState } from 'react';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { indexLevel, indexRoot, liveSpotOf, noteIndex, noteSpot } from './traceRows';
import { setupIdOf } from './compass';
import { GEX_CORE, inModelWindow, onScanGrid, weekdayDte } from './compassParams';
import { deskPhase, odteAsleep, optionScanOpen, sessionIso, sessionYmd } from './compassSession';
import { COMPASS_TICKERS } from './compassUniverse';
import { SIM_DESK } from './deskMode';
import { claimSlot, commitClosest, currentPicks, earlierScan, noteScanned, paintQuotes, releaseSlot, resetScanReport, scanReport, scoreBook, scoreLottery, setScanBusy, stampPickQuote } from './compassModel';
import { recordPicks } from './compassLedger';
import { subscribeTheta, thetaStatus } from './thetaQuote';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import type { Timeframe } from './timeframe';
import { nyYmd as ymd } from '../core/calendar';

const INDEX_OF: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };
const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };
/** A snapshot quote older than this is not on the board */
const FRESH_MS = 90 * 1000;

export type ThetaState = 'unknown' | 'up' | 'down';

interface ThetaBook {
  status: 'loading' | 'live' | 'down';
  setups: Setup[];
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
  /** The terminal as the last read found it, and since when it has been down */
  theta: ThetaState;
  downSince: number;
}

const heldNow = currentPicks();
const empty: ThetaBook = {
  status: heldNow.length ? 'live' : 'loading',
  setups: heldNow,
  spots: {},
  sparks: {},
  line: heldNow.length ? pickLine() : 'Reading the live book.',
  theta: 'unknown',
  downSince: 0,
};

let book: ThetaBook = empty;
const byId = new Map<string, Setup>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Every answer passes through here: a down terminal flips the book to its offline state, an answer flips it back. */
async function theta(path: string, jump = false): Promise<{ status: number; data: unknown; error: string | null }> {
  const got = await thetaCall(path, jump);
  const down = got.error === 'terminal_down';
  if (down && book.theta !== 'down') {
    book = { ...book, theta: 'down', downSince: Date.now(), status: 'down' };
    emit();
  } else if (!got.error && book.theta !== 'up') {
    book = { ...book, theta: 'up', downSince: 0, status: book.status === 'down' ? 'live' : book.status };
    emit();
  }
  return got;
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

function contractWord(symbol: string, strike: number, right: OptionRight): string {
  const k = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2);
  return `${symbol} ${k}${right}`;
}

function sessionsAhead(expiration: string, now: number): number {
  const dte = Math.max(0, Math.round((Date.parse(`${expiration}T21:00:00Z`) - now) / 86400000));
  if (dte > 0) return dte;
  const p = nyParts(now);
  const mins = p.hour * 60 + p.minute;
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
    lambda: greeks.lambda,
    epsilon: greeks.epsilon,
  };
}

/** A v3 row: either flat (contract fields and quote fields on one object) or `{ contract, data: [quote] }`. */
function rowOf(item: Record<string, unknown>): { contract: Record<string, unknown>; quote: Record<string, unknown> } | null {
  const contract = item.contract && typeof item.contract === 'object' ? (item.contract as Record<string, unknown>) : item;
  const quote = Array.isArray(item.data) ? (item.data[0] as Record<string, unknown>) : item;
  if (!quote || typeof quote !== 'object') return null;
  return { contract, quote };
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

const ALL = [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];
const ALL_SET = new Set(ALL);
/** The weekly scan's names when the board is not filtered to one: the roots with the full feature row (open
    interest, net gamma and the walls). */
const WEEKLY_FOCUS = GEX_CORE.filter(t => ALL_SET.has(t));

function odteBook(now: number): string[] {
  const session = sessionYmd(now);
  const day = nyParts(nyWallTime(Number(session.slice(0, 4)), Number(session.slice(4, 6)), Number(session.slice(6, 8)), 12, 0)).weekday;
  const names = [...DAILY_0DTE];
  if (day === 1 || day === 3 || day === 5) names.push(...MWF_STOCK, ...MWF_ETF);
  if (day === 3 || day === 5) names.push(...WF_0DTE);
  return names;
}

/* The board's name filter: the scan reads only that name while it is set. */
let focus: string | null = null;

/** Point the scan at one name, or back at the sleeve's list (null). */
export function setScanFocus(ticker: string | null): void {
  const next = ticker ? OPTION_OF[ticker] ?? ticker : null;
  if (next === focus) return;
  focus = next;
  weeklyFinishedAt = 0;
  emit();
}

function odteNames(now: number): string[] {
  if (odteAsleep(now)) return [];
  const names = odteBook(now).filter(t => optionScanOpen(t, 0, now));
  return focus ? names.filter(t => t === focus) : names;
}

function weeklyNames(now: number): string[] {
  const names = focus ? (ALL_SET.has(focus) ? [focus] : []) : WEEKLY_FOCUS;
  return names.filter(t => optionScanOpen(t, 1, now));
}

/** The names a sleeve's scan reads now: the board lists them. */
export function scanNames(sleeve: 'odte' | 'weekly', now = Date.now()): string[] {
  return sleeve === 'odte' ? (focus ? odteBook(now).filter(t => t === focus) : odteBook(now)) : focus ? (ALL_SET.has(focus) ? [focus] : []) : WEEKLY_FOCUS;
}

/** The names a sleeve can call. 0DTE is the roots that list a same-day contract on this session, even while the tape is shut. */
export function alertUniverse(sleeve: 'odte' | 'weekly'): readonly string[] {
  if (sleeve === 'odte') return odteBook(Date.now());
  return ALL;
}

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

interface Snap {
  setups: Setup[];
  spot: number;
  /** The terminal answered */
  ok: boolean;
}

/** One snapshot of one name: today's expiry (0DTE), one named expiry, or '*' for the nearest expiry 1 to 7 weekdays
    out (every expiry within 11 calendar days in one ask, the nearest kept). */
async function once(symbol: string, now: number, only: string, jump = false, freshMs = FRESH_MS): Promise<Snap> {
  const today = sessionIso(now);
  const weekly = only === '*';
  const range = weekly ? 4 : 16;
  const exp = weekly ? '*' : only.replace(/-/g, '');
  const got = await theta(`/option/snapshot/greeks/first_order?symbol=${symbol}&expiration=${exp}&right=both&strike_range=${range}${weekly ? '&max_dte=11' : ''}&format=json`, jump);
  const drafts = new Map<string, Draft[]>();
  let spot = 0;
  if (got.error) return { setups: [], spot: 0, ok: got.error !== 'terminal_down' };
  for (const item of asRows(got.data)) {
    const row = rowOf(item);
    if (!row) continue;
    const bid = num(row.quote.bid);
    const ask = num(row.quote.ask);
    const at = nyWallStamp(row.quote.timestamp);
    if (!(bid > 0) || !(ask >= bid) || !at || now - at > freshMs) continue;
    const strike = num(row.contract.strike);
    const expiry = String(row.contract.expiration || '').slice(0, 10);
    const rightWord = String(row.contract.right || '').toLowerCase();
    const right: OptionRight | null = rightWord.startsWith('c') ? 'C' : rightWord.startsWith('p') ? 'P' : null;
    if (!right || !(strike > 0) || expiry.length < 10) continue;
    const under = num(row.quote.underlying_price);
    if (under > 0) spot = under;
    const iv = finite(row.quote.implied_vol);
    const root = String(row.contract.symbol || row.contract.root || symbol).toUpperCase();
    const list = drafts.get(expiry) ?? [];
    list.push({
      root, strike, right, exp: expiry, bid, ask, under, at,
      greeks: {
        delta: finite(row.quote.delta),
        gamma: NaN,
        theta: perDay(finite(row.quote.theta)),
        vega: perPoint(finite(row.quote.vega)),
        rho: perPoint(finite(row.quote.rho)),
        iv: iv > 0 && iv < 3 ? iv * 100 : iv,
        lambda: finite(row.quote.lambda),
        epsilon: finite(row.quote.epsilon),
      },
    });
    drafts.set(expiry, list);
  }
  const build = (expiry: string, sleeve: SleeveKey) => kept(drafts.get(expiry) ?? []).map(d => toSetup(d.root, d.strike, d.right, d.exp, d.bid, d.ask, d.under, sleeve, d.at, d.greeks));
  if (!weekly) {
    const sleeve: SleeveKey = only.replace(/-/g, '') === sessionYmd(now) ? 'odte' : 'weekly';
    return { setups: build(only.slice(0, 10), sleeve), spot, ok: true };
  }
  const nearest = [...drafts.keys()].filter(e => {
    const n = weekdayDte(today, e);
    return n >= 1 && n <= 7;
  }).sort()[0];
  return { setups: nearest ? build(nearest, 'weekly') : [], spot, ok: true };
}

function pickLine(): string {
  const rows = currentPicks();
  const a = rows.filter(s => s.band === 'top').length;
  const b = rows.filter(s => s.band === 'wing').length;
  const c = rows.filter(s => s.band === 'lottery').length;
  return `Book A ${a}. Book B ${b}. Book C ${c}. Model 1 entry. Model 2 runner.`;
}

function writeBook(spots: Record<string, number>): void {
  const next = currentPicks();
  byId.clear();
  for (const s of next) byId.set(s.id, s);
  book = { ...book, setups: next, status: book.theta === 'down' ? 'down' : 'live', spots, line: pickLine() };
  publishSpots(spots, Date.now());
  emit();
}

/** Score a slice of names. False when the terminal did not answer for any of them. */
async function scoreSlice(symbols: string[], only: string, jump: boolean, spots: Record<string, number>, found: Setup[], freshMs = FRESH_MS, at = Date.now()): Promise<boolean> {
  const got = await Promise.all(symbols.map(symbol => once(symbol, at, only, jump, freshMs)));
  for (const row of got) {
    if (row.setups.length) {
      try { await scoreBook(row.setups, at, true); } catch { /* this name, not the rest */ }
    }
    recordPicks(at);
    const symbol = row.setups[0]?.ticker;
    if (symbol && row.spot > 0) {
      spots[symbol] = row.spot;
      if (INDEX_OF[symbol]) spots[INDEX_OF[symbol]] = row.spot;
    }
    for (const s of row.setups) found.push(s);
  }
  writeBook(spots);
  return got.some(row => row.ok);
}

/** One pass of the session's 0DTE roots. False when it could not run, so the slot may run again. */
async function scanOdte(now: number): Promise<boolean> {
  setScanBusy(true);
  emit();
  try {
    const symbols = odteNames(now);
    resetScanReport('odte');
    const spots = { ...book.spots };
    const found: Setup[] = [];
    let answered = false;
    for (let i = 0; i < symbols.length; i += 8) {
      if (!armed) return false;
      if (await scoreSlice(symbols.slice(i, i + 8), sessionIso(now), true, spots, found, FRESH_MS, now)) answered = true;
    }
    if (!answered) return false;
    commitClosest('odte');
    noteScanned('odte');
    writeBook(spots);
    void fillSparks(symbols);
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
let weeklyList: string[] = [];
let weeklyAnswered = false;

function startWeekly(names: string[]): void {
  weeklyOn = true;
  weeklyCursor = 0;
  weeklyList = names;
  weeklyAnswered = false;
  resetScanReport('weekly');
}

/** Eight names, then yield so the next tick can run 0DTE again. */
async function scanWeeklyWave(): Promise<boolean> {
  const slice = weeklyList.slice(weeklyCursor, weeklyCursor + 8);
  const spots = { ...book.spots };
  if (slice.length) {
    try {
      if (await scoreSlice(slice, '*', false, spots, [], FRESH_MS)) weeklyAnswered = true;
    } catch {
      /* this wave, not the walk */
    }
    weeklyCursor += slice.length;
    if (weeklyCursor < weeklyList.length) return false;
  }
  weeklyOn = false;
  weeklyFinishedAt = Date.now();
  if (!weeklyAnswered) return true;
  commitClosest('weekly');
  noteScanned('weekly');
  writeBook(spots);
  void fillSparks(weeklyList);
  return true;
}

const SPARK_UNDER: Record<string, string> = { SPXW: 'SPX', XSP: 'SPX', RUTW: 'RUT', SPX: 'SPX', RUT: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };

/** Today's five-minute closes of the underlying (the session so far). */
async function closesOf(symbol: string, index: boolean): Promise<number[]> {
  const day = ymd(Date.now());
  const path = index
    ? `/index/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`
    : `/stock/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`;
  const got = await theta(path);
  return asRows(got.data).flatMap(r => (Array.isArray(r.data) ? asRows(r.data) : [r])).map(r => num(r.close)).filter(n => n > 0);
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

interface LiveBar { time: number; open: number; high: number; low: number; close: number }

const barCache = new Map<string, { at: number; bars: LiveBar[] }>();

function barWindow(tf: Timeframe): { interval: string; days: number } {
  switch (tf) {
    case '1W': return { interval: '1d', days: 120 };
    case '1D': return { interval: '1d', days: 28 };
    case '1h': return { interval: '1h', days: 15 };
    case '30m': return { interval: '30m', days: 10 };
    case '15m': return { interval: '15m', days: 6 };
    case '5m': return { interval: '5m', days: 4 };
    default: return { interval: '1m', days: 1 };
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
      time: Math.floor(nyWallStamp(b.timestamp) / 1000),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close),
    }))
    .filter(b => b.time > 0 && b.high > 0 && b.low > 0 && b.close > 0)
    .sort((a, b) => a.time - b.time);
}

const hidden = () => typeof document !== 'undefined' && document.hidden;

/** The contract's own bars from the terminal. Polls while the page shows it and the tab is visible. */
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
      if (hidden()) return;
      const end = ymd(Date.now());
      const start = ymd(Date.now() - (spec.days - 1) * 86400000);
      const path = (interval: string, from: string) => `/option/history/ohlc?symbol=${encodeURIComponent(ticker)}&expiration=${exp}&strike=${strike}&right=${rightWord}&start_date=${from}&end_date=${end}&interval=${interval}&format=json`;
      const got = await theta(path(spec.interval, start), true);
      if (dead) return;
      const rows = readBars(got.data);
      if (dead || !rows.length) return;
      barCache.set(key, { at: Date.now(), bars: rows });
      setBars(rows);
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
      iv: rawIv > 0 && rawIv < 3 ? rawIv * 100 : rawIv,
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

let users = 0;
let stopTimer: number | null = null;

export interface BookView extends ThetaBook {
  /** The last session's scan, stamped, while today has none */
  earlier: { day: string; at: number; setups: Setup[] } | null;
}

export function useThetaBook(sleeve: SleeveKey): BookView {
  const [snap, setSnap] = useState(book);
  useEffect(() => subscribeTheta(() => setSnap({ ...book })), []);
  useEffect(() => {
    users += 1;
    if (stopTimer != null) window.clearTimeout(stopTimer);
    stopTimer = null;
    bootCompass();
    const fn = () => setSnap(book);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
      users -= 1;
      /* a beat of grace: moving between Compass pages remounts the hook */
      if (users === 0) stopTimer = window.setTimeout(() => { stopTimer = null; if (users === 0) stopCompass(); }, 1_000);
    };
  }, [sleeve]);
  const wanted = sleeve === 'weekly' ? 'weekly' : 'odte';
  const setups = snap.setups.filter(s => (wanted === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE'));
  /* before this book has asked the terminal anything, the shell's own reading of it stands */
  const shell = thetaStatus();
  const state: ThetaState = snap.theta !== 'unknown' ? snap.theta : shell === 'down' ? 'down' : shell === 'up' ? 'up' : 'unknown';
  return { ...snap, theta: state, status: state === 'down' ? 'down' : snap.status, setups, earlier: currentPicks().length ? null : earlierScan() };
}

let armed = false;
let ticking = false;
let tickTimer: number | null = null;

let sweptDay = '';
const swept = { lottery: false };

function rollDay(now: number): void {
  const day = sessionYmd(now);
  if (day === sweptDay) return;
  sweptDay = day;
  swept.lottery = false;
}

/** Quotes for the cards already up: one snapshot per name and expiry. No new universe walk. */
async function refreshHeld(now: number): Promise<void> {
  const live = currentPicks();
  if (!live.length) return;
  const byExp = new Map<string, string[]>();
  for (const s of live) {
    if (!s.expiryDate) continue;
    const dte = weekdayDte(sessionYmd(now), s.expiryDate);
    if (!optionScanOpen(s.ticker, Number.isFinite(dte) ? Math.min(dte, 1) : 1, now)) continue;
    const list = byExp.get(s.expiryDate) ?? [];
    if (!list.includes(s.ticker)) list.push(s.ticker);
    byExp.set(s.expiryDate, list);
  }
  const spots = { ...book.spots };
  const found: Setup[] = [];
  for (const [exp, symbols] of byExp) {
    for (let i = 0; i < symbols.length; i += 8) {
      if (!armed) return;
      const got = await Promise.all(symbols.slice(i, i + 8).map(symbol => once(symbol, now, exp, false)));
      for (const row of got) {
        const symbol = row.setups[0]?.ticker;
        if (symbol && row.spot > 0) spots[symbol] = row.spot;
        found.push(...row.setups);
      }
    }
  }
  if (found.length) paintQuotes(found);
  writeBook(spots);
}

/** Book A and Book B score on the 5-minute grid from 09:45 to 15:00 ET (the minutes the trees were trained on).
    Book C sweeps once at 15:20. Between scans only the cards' quotes move. */
function bootCompass(): void {
  if (SIM_DESK || typeof window === 'undefined') return;
  if (!armed && currentPicks().length) writeBook(book.spots);
  if (armed) return;
  armed = true;
  const tick = async () => {
    if (ticking || hidden()) return;
    ticking = true;
    try {
      const now = Date.now();
      rollDay(now);
      const clock = nyParts(now);
      const mins = clock.hour * 60 + clock.minute;
      const t = mins - (9 * 60 + 30);
      const onGrid = onScanGrid(t) && inModelWindow(t) && clock.weekday >= 1 && clock.weekday <= 5;
      let scanned = false;
      if (!swept.lottery && mins >= 15 * 60 + 20 && mins < 15 * 60 + 50) {
        const symbols = odteNames(now);
        const spots = { ...book.spots };
        const found: Setup[] = [];
        let answered = false;
        for (let i = 0; i < symbols.length && armed; i += 8) {
          if (await scoreSlice(symbols.slice(i, i + 8), sessionIso(now), true, spots, found, 20_000)) answered = true;
        }
        if (!armed) return;
        if (answered) {
          await scoreLottery(found, now);
          recordPicks(now);
          writeBook(spots);
          swept.lottery = true;
          scanned = true;
        }
      }
      if (onGrid && !odteAsleep(now)) {
        const odte = claimSlot(now, 'odte');
        if (odte === 'scan') {
          const ran = await scanOdte(now);
          const report = scanReport('odte');
          if (!ran || !armed || (report.scored === 0 && report.quiet > 0)) releaseSlot('odte');
          scanned = ran;
        }
      }
      const weeklyDue = !weeklyOn && onGrid && Date.now() - weeklyFinishedAt > 4 * 60_000;
      if (weeklyDue) {
        const names = weeklyNames(now);
        if (names.length) startWeekly(names);
      }
      if (weeklyOn) {
        const done = await scanWeeklyWave();
        if (done) scanned = true;
      }
      if (!scanned) await refreshHeld(now);
    } finally {
      ticking = false;
    }
  };
  void tick();
  tickTimer = window.setInterval(() => void tick(), 8_000);
}

/** Leaving Compass: the walk stops at its next slice, and only quotes a page still holds keep polling. */
function stopCompass(): void {
  if (!armed) return;
  armed = false;
  weeklyOn = false;
  if (tickTimer != null) window.clearInterval(tickTimer);
  tickTimer = null;
  for (const [key, want] of quoteWant) if (want.n <= 0) quoteWant.delete(key);
  if (!quoteWant.size) stopQuotes();
}
