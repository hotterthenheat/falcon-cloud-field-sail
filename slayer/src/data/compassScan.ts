/*
  The Compass scan: one pass per sleeve at every mark of every session the names trade, the Book C sweep from 15:20,
  the cards' quotes between marks, and the settlement of every open call. It runs in the server process
  (data/compassServer.ts), once for every viewer; browsers render what it found (data/thetaBook.ts).

  A mark the scan could not read (the terminal down, the session lost, the previous pass still running past the
  minute) is scored afterwards from the quotes ThetaData recorded at that exact instant (option/at_time/quote), name
  by name, and marked late. A name ThetaData has no quotes for at that mark is recorded as not scored.
*/

import { compassHost, type ThetaAnswer } from './compassHost';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { setupIdOf } from './compass';
import { GEX_CORE, WEEKLY_STRIKES, inLottery, sessionScanOpen, weekdayDte } from './compassParams';
import { deskPhase, odteAsleep, optionScanOpen, sessionDayOpen, sessionIso, sessionYmd } from './compassSession';
import { COMPASS_TICKERS } from './compassUniverse';
import {
  commitClosest,
  currentPicks,
  noteScanned,
  paintQuotes,
  resetScanReport,
  scanReport,
  scoreBook,
  scoreLottery,
  setScanBusy,
  setScanReport,
  setScoreClose,
  underAt,
  warmSession,
  type ScoreResult,
} from './compassModel';
import { recordPicks, setSessionClose, settleOpen } from './compassLedger';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import { nyYmd as ymd, sessionCloseMinOn } from '../core/calendar';

export const INDEX_OF: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };
export const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };
/** A snapshot quote older than this is not on the board */
const FRESH_MS = 90 * 1000;

/* ---- the names ---- */

/** Monday–Friday. The chain wins: an empty expiration is not a ticket. */
const DAILY_0DTE = ['SPXW', 'NDXP', 'XSP', 'RUTW', 'VIX', 'SPY', 'QQQ', 'IWM', 'GLD', 'XLF', 'SMH'];
/** Monday, Wednesday, Friday stocks. GOOG is not in this set. */
const MWF_STOCK = ['AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA'];
/** Monday, Wednesday, Friday ETFs. EEM and SOXL skip some of those days. */
const MWF_ETF = ['SLV', 'TLT', 'XLE', 'EEM', 'TQQQ', 'SOXL'];
/** Wednesday and Friday. */
const WF_0DTE = ['USO', 'UNG'];

export const ALL = [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];
export const ALL_SET = new Set(ALL);
/** The weekly scan's names: the roots with the full feature row (open interest, net gamma and the walls). */
export const WEEKLY_FOCUS = GEX_CORE.filter(t => ALL_SET.has(t));

/** The roots that list a same-day contract on this session. */
export function odteBook(now: number): string[] {
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
  return WEEKLY_FOCUS.filter(t => optionScanOpen(t, 1, now));
}

/* ---- reading the terminal ---- */

export type ThetaState = 'unknown' | 'up' | 'down';

export interface ScanMeta {
  theta: ThetaState;
  /** Since when the terminal has been down, epoch ms (0 while it answers) */
  downSince: number;
  /** A pass is running */
  busy: boolean;
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
}

let meta: ScanMeta = { theta: 'unknown', downSince: 0, busy: false, spots: {}, sparks: {}, line: 'Reading the live book.' };
const metaFns = new Set<() => void>();

export function scanMeta(): ScanMeta {
  return meta;
}

export function setScanMeta(next: Partial<ScanMeta>): void {
  meta = { ...meta, ...next };
  for (const fn of metaFns) fn();
}

export function onScanMeta(fn: () => void): () => void {
  metaFns.add(fn);
  return () => metaFns.delete(fn);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One ThetaData answer, with the terminal's state noted. A 429 (eight requests already working) waits and asks
    again, up to three times. */
async function theta(path: string, jump = false): Promise<ThetaAnswer> {
  let got = await compassHost().theta(path, jump);
  for (let i = 0; i < 3 && got.status === 429; i++) {
    await sleep(400 * 2 ** i);
    got = await compassHost().theta(path, jump);
  }
  const down = got.error === 'terminal_down';
  if (down && meta.theta !== 'down') setScanMeta({ theta: 'down', downSince: Date.now() });
  else if (!got.error && meta.theta !== 'up') setScanMeta({ theta: 'up', downSince: 0 });
  return got;
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
export function perDay(theta: number): number {
  return Number.isFinite(theta) ? theta / 365 : NaN;
}

/** Theta says vega and rho are raw partials. Divide by 100 to get the per-point number. */
export function perPoint(v: number): number {
  return Number.isFinite(v) ? v / 100 : NaN;
}

export function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  return [];
}

/** A v3 row: either flat (contract fields and quote fields on one object) or `{ contract, data: [quote] }`. */
export function rowOf(item: Record<string, unknown>): { contract: Record<string, unknown>; quote: Record<string, unknown> } | null {
  const contract = item.contract && typeof item.contract === 'object' ? (item.contract as Record<string, unknown>) : item;
  const quote = Array.isArray(item.data) ? (item.data[0] as Record<string, unknown>) : item;
  if (!quote || typeof quote !== 'object') return null;
  return { contract, quote };
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

const NO_GREEKS: LiveGreeks = { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, rho: NaN, lambda: NaN, epsilon: NaN };

function toSetup(
  symbol: string, strike: number, right: OptionRight, expiration: string,
  bid: number, ask: number, spot: number, sleeve: SleeveKey, quotedAt: number,
  greeks: LiveGreeks, listed: number,
): Setup {
  const mid = (bid + ask) / 2;
  const id = setupIdOf({ ticker: symbol, strike, right, scanner: 'top-setups', sleeve });
  const session = sessionYmd(quotedAt || listed);
  const wd = weekdayDte(session, expiration);
  const dte = Number.isFinite(wd) ? wd : Math.max(0, Math.round((Date.parse(`${expiration}T16:00:00`) - listed) / 86400000));
  const spread = mid > 0 ? (ask - bid) / mid : 1;
  const sessions = sessionsAhead(expiration, quotedAt || listed);
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
    greeks: { delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega, iv: greeks.iv, rho: greeks.rho },
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
    seenAt: listed,
    quotedAt,
    lambda: greeks.lambda,
    epsilon: greeks.epsilon,
  };
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

/** Book A reaches the span (4 strikes on an index root, up to 12 on a single name). Book B is the band past it,
    max(8, span + 1) to that + 4 strikes out, at an ask of 1.00 or less. A long chain keeps 12 strikes either side and
    every contract asking 1.65 or less, which holds all of Book B (it asks 1.00 or less) and Book C. */
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
  /** ThetaData had quote rows for the name (fresh or not) */
  rows: number;
}

function draftOf(item: Record<string, unknown>, symbol: string, now: number, freshMs: number, spotFallback: number): Draft | null {
  const row = rowOf(item);
  if (!row) return null;
  const bid = num(row.quote.bid);
  const ask = num(row.quote.ask);
  const at = nyWallStamp(row.quote.timestamp);
  if (!(bid > 0) || !(ask >= bid) || !at || now - at > freshMs || at > now + 60_000) return null;
  const strike = num(row.contract.strike);
  const expiry = String(row.contract.expiration || '').slice(0, 10);
  const rightWord = String(row.contract.right || '').toLowerCase();
  const right: OptionRight | null = rightWord.startsWith('c') ? 'C' : rightWord.startsWith('p') ? 'P' : null;
  if (!right || !(strike > 0) || expiry.length < 10) return null;
  const quoted = num(row.quote.underlying_price);
  const under = quoted > 0 ? quoted : spotFallback;
  const iv = finite(row.quote.implied_vol);
  const root = String(row.contract.symbol || row.contract.root || symbol).toUpperCase();
  const greeks: LiveGreeks = 'delta' in row.quote
    ? {
        delta: finite(row.quote.delta),
        gamma: NaN,
        theta: perDay(finite(row.quote.theta)),
        vega: perPoint(finite(row.quote.vega)),
        rho: perPoint(finite(row.quote.rho)),
        iv: iv > 0 ? iv * 100 : iv,
        lambda: finite(row.quote.lambda),
        epsilon: finite(row.quote.epsilon),
      }
    : NO_GREEKS;
  return { root, strike, right, exp: expiry, bid, ask, under, at, greeks };
}

function build(drafts: Map<string, Draft[]>, expiry: string, sleeve: SleeveKey, listed: number): Setup[] {
  return kept(drafts.get(expiry) ?? []).map(d => toSetup(d.root, d.strike, d.right, d.exp, d.bid, d.ask, d.under, sleeve, d.at, d.greeks, listed));
}

/** One snapshot of one name: today's expiry (0DTE), one named expiry, or '*' for the nearest expiry 1 to 7 sessions
    out (every expiry within 11 calendar days in one ask, the nearest kept). A same-day read reaches 16 strikes out;
    any other expiry reaches Book B's band (WEEKLY_STRIKES, 17): at the old 4 a weekly Book B (8 or more strikes out)
    could never be read. */
async function once(symbol: string, now: number, only: string, jump = false, freshMs = FRESH_MS): Promise<Snap> {
  const today = sessionIso(now);
  const weekly = only === '*';
  const range = only.slice(0, 10) === today ? 16 : WEEKLY_STRIKES;
  const exp = weekly ? '*' : only.replace(/-/g, '');
  const got = await theta(`/option/snapshot/greeks/first_order?symbol=${symbol}&expiration=${exp}&right=both&strike_range=${range}${weekly ? '&max_dte=11' : ''}&format=json`, jump);
  if (got.error) return { setups: [], spot: 0, ok: got.error !== 'terminal_down', rows: 0 };
  const drafts = new Map<string, Draft[]>();
  let spot = 0;
  const items = asRows(got.data);
  for (const item of items) {
    const d = draftOf(item, symbol, now, freshMs, 0);
    if (!d) continue;
    if (d.under > 0) spot = d.under;
    const list = drafts.get(d.exp) ?? [];
    list.push(d);
    drafts.set(d.exp, list);
  }
  if (!weekly) {
    const sleeve: SleeveKey = only.replace(/-/g, '') === sessionYmd(now) ? 'odte' : 'weekly';
    return { setups: build(drafts, only.slice(0, 10), sleeve, now), spot, ok: true, rows: items.length };
  }
  const nearest = [...drafts.keys()].filter(e => {
    const n = weekdayDte(today, e);
    return n >= 1 && n <= 7;
  }).sort()[0];
  return { setups: nearest ? build(drafts, nearest, 'weekly', now) : [], spot, ok: true, rows: items.length };
}

const two = (n: number) => String(n).padStart(2, '0');
const clockOf = (ms: number) => {
  const p = nyParts(ms);
  return `${two(p.hour)}:${two(p.minute)}`;
};

const expiryMemo = new Map<string, { at: number; list: string[] }>();

/** The name's listed expirations (YYYY-MM-DD), read once an hour. */
async function expirationsOf(symbol: string): Promise<string[] | null> {
  const hit = expiryMemo.get(symbol);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.list;
  const got = await theta(`/option/list/expirations?symbol=${encodeURIComponent(symbol)}&format=json`);
  if (got.error === 'terminal_down') return null;
  const list = asRows(got.data).map(r => String(r.expiration ?? '').slice(0, 10)).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e));
  expiryMemo.set(symbol, { at: Date.now(), list });
  return list;
}

/** The nearest listed expiry 1 to 7 sessions out (YYYY-MM-DD), from the hourly expirations read, or null. */
export async function weeklyExpiry(symbol: string, at: number): Promise<string | null> {
  const list = await expirationsOf(symbol);
  if (!list) return null;
  const session = sessionIso(at);
  return list.filter(e => {
    const n = weekdayDte(session, e);
    return n >= 1 && n <= 7;
  }).sort()[0] ?? null;
}

/** The quotes that stood at one instant: ThetaData's recorded NBBO for every listed strike near the money, each with
    its own stamp (a quote that had not changed for 90 seconds is not on the board, as live). */
export async function atMark(symbol: string, markAt: number, sleeve: 'odte' | 'weekly'): Promise<Snap> {
  const session = sessionIso(markAt);
  let expiry = session;
  if (sleeve === 'weekly') {
    const list = await expirationsOf(symbol);
    if (!list) return { setups: [], spot: 0, ok: false, rows: 0 };
    const near = await weeklyExpiry(symbol, markAt);
    if (!near) return { setups: [], spot: 0, ok: true, rows: 0 };
    expiry = near;
  }
  const day = ymd(markAt);
  const p = nyParts(markAt);
  const time = `${two(p.hour)}:${two(p.minute)}:${two(p.second)}.000`;
  const range = sleeve === 'weekly' ? WEEKLY_STRIKES : 16;
  const got = await theta(`/option/at_time/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiry.replace(/-/g, '')}&right=both&strike_range=${range}&start_date=${day}&end_date=${day}&time_of_day=${time}&format=json`);
  if (got.error === 'terminal_down') return { setups: [], spot: 0, ok: false, rows: 0 };
  if (got.error) return { setups: [], spot: 0, ok: true, rows: 0 };
  const items = asRows(got.data);
  if (!items.length) return { setups: [], spot: 0, ok: true, rows: 0 };
  const spot = await underAt(symbol, markAt);
  const drafts = new Map<string, Draft[]>();
  for (const item of items) {
    const d = draftOf(item, symbol, markAt, FRESH_MS, spot > 0 ? spot : 0);
    if (!d) continue;
    const list = drafts.get(d.exp) ?? [];
    list.push(d);
    drafts.set(d.exp, list);
  }
  const listed = sleeve === 'odte' ? 'odte' : 'weekly';
  return { setups: build(drafts, expiry, listed, markAt), spot: spot > 0 ? spot : 0, ok: true, rows: items.length };
}

/* ---- the marks ---- */

export type NameMark = 'pending' | 'live' | 'late' | 'quiet' | 'none';

export interface MarkRow {
  /** The mark's minute, epoch ms */
  at: number;
  /** 'HH:MM' ET */
  clock: string;
  sleeve: 'odte' | 'weekly' | 'lottery';
  /** What happened to each name at this mark: scored live, scored late from recorded quotes, answered with no quote
      fresh enough to score, ThetaData had no quotes, or still waiting to be scored */
  names: Record<string, NameMark>;
  /** Contracts scored */
  scored: number;
  /** When the last pass over it finished, epoch ms */
  ranAt: number;
}

const marks = new Map<string, MarkRow>();
const markFns = new Set<() => void>();
const markKey = (at: number, sleeve: string) => `${at}|${sleeve}`;

export function onMarks(fn: () => void): () => void {
  markFns.add(fn);
  return () => markFns.delete(fn);
}

function markChanged(): void {
  for (const fn of markFns) fn();
}

export function exportMarks(): MarkRow[] {
  return [...marks.values()].sort((a, b) => a.at - b.at || a.sleeve.localeCompare(b.sleeve));
}

export function importMarks(rows: readonly MarkRow[]): void {
  marks.clear();
  for (const r of rows) if (r && r.at > 0 && r.sleeve && r.names) marks.set(markKey(r.at, r.sleeve), { ...r, names: { ...r.names } });
  markChanged();
}

/** One word for how a mark went: every name live, some scored late, none, or still waiting. */
export function markHow(row: MarkRow): 'live' | 'late' | 'none' | 'pending' | 'quiet' {
  const v = Object.values(row.names);
  if (v.includes('pending')) return 'pending';
  if (v.includes('late')) return 'late';
  if (v.includes('live')) return 'live';
  if (v.length && v.every(x => x === 'none')) return 'none';
  return 'quiet';
}

function markRow(at: number, sleeve: 'odte' | 'weekly' | 'lottery', names: string[]): MarkRow {
  const key = markKey(at, sleeve);
  let row = marks.get(key);
  if (!row) {
    row = { at, clock: clockOf(at), sleeve, names: {}, scored: 0, ranAt: 0 };
    marks.set(key, row);
  }
  for (const n of names) if (!row.names[n]) row.names[n] = 'pending';
  return row;
}

/* ---- one mark ---- */

const minuteStart = (ms: number) => Math.floor(ms / 60_000) * 60_000;

function pickLine(): string {
  const rows = currentPicks();
  const a = rows.filter(s => s.band === 'top').length;
  const b = rows.filter(s => s.band === 'wing').length;
  const c = rows.filter(s => s.band === 'lottery').length;
  return `Book A ${a}. Book B ${b}. Book C ${c}.`;
}

function noteSpots(snaps: { symbol: string; spot: number }[]): void {
  const spots = { ...meta.spots };
  for (const { symbol, spot } of snaps) {
    if (!(spot > 0)) continue;
    spots[symbol] = spot;
    if (INDEX_OF[symbol]) spots[INDEX_OF[symbol]] = spot;
  }
  setScanMeta({ spots, line: pickLine() });
}

/** Run `fn` over `items`, at most `n` at once. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

let running = 0;

/** The live pass of one sleeve at the mark now standing. A name the terminal did not answer stays pending: it is
    scored late once the minute has passed. */
async function liveMark(markAt: number, sleeve: 'odte' | 'weekly'): Promise<void> {
  const at = Date.now();
  if (minuteStart(at) !== markAt) return;
  const names = sleeve === 'odte' ? odteNames(at) : weeklyNames(at);
  const row = markRow(markAt, sleeve, names);
  const todo = names.filter(n => row.names[n] === 'pending');
  if (!todo.length) return;
  running += 1;
  setScanMeta({ busy: true });
  setScanBusy(true);
  try {
    resetScanReport(sleeve);
    const only = sleeve === 'odte' ? sessionIso(at) : '*';
    let answered = false;
    const snaps: { symbol: string; spot: number }[] = [];
    await pool(todo, 6, async symbol => {
      const scanAt = Date.now();
      /* the minute has passed: the quotes now are not the mark's, so the name is scored late */
      if (minuteStart(scanAt) !== markAt) return;
      /* a weekly name reads its own nearest expiry (one expiry, Book B's band) */
      const exp = sleeve === 'weekly' ? (await weeklyExpiry(symbol, scanAt)) ?? '*' : only;
      if (minuteStart(Date.now()) !== markAt) return;
      const snap = await once(symbol, scanAt, exp, true);
      if (!snap.ok) return;
      answered = true;
      snaps.push({ symbol, spot: snap.spot });
      if (snap.setups.length) {
        let result: ScoreResult = 'fault';
        try {
          result = await scoreBook(snap.setups, scanAt, true);
        } catch {
          /* this name, not the rest */
        }
        /* an input the terminal did not answer: the name is scored late from the mark's recorded quotes */
        if (result === 'fault') return;
      }
      recordPicks(scanAt);
      row.names[symbol] = snap.setups.length ? 'live' : snap.rows ? 'quiet' : 'none';
      row.scored += snap.setups.length;
    });
    row.ranAt = Date.now();
    if (answered) {
      commitClosest(sleeve, at);
      noteScanned(sleeve, at);
      noteSpots(snaps);
      bg('the sparklines', fillSparks(names));
    }
    markChanged();
  } finally {
    running -= 1;
    if (!running) {
      setScanBusy(false);
      setScanMeta({ busy: false, line: pickLine() });
    }
  }
}

/** One name at a past mark, from the quotes recorded then. */
async function lateName(row: MarkRow, symbol: string): Promise<void> {
  if (row.sleeve === 'lottery') return;
  const sleeve = row.sleeve;
  const snap = await atMark(symbol, row.at, sleeve);
  if (!snap.ok) return;
  if (!snap.rows) {
    row.names[symbol] = 'none';
  } else if (!snap.setups.length) {
    row.names[symbol] = 'quiet';
  } else {
    const report = { ...scanReport(sleeve) };
    let result: ScoreResult = 'fault';
    try {
      result = await scoreBook(snap.setups, row.at, true, true);
    } catch {
      /* this name, not the rest */
    } finally {
      setScanReport(sleeve, report);
    }
    /* an input did not answer: still pending, asked again on the next pass */
    if (result === 'fault') return;
    recordPicks(row.at);
    row.names[symbol] = 'late';
    row.scored += snap.setups.length;
  }
  row.ranAt = Date.now();
  markChanged();
}

/* ---- Book C ---- */

let lotteryDay = '';

/** Book C's window on this session: 15:20–15:50 ET, or 40 to 10 minutes before an early close. */
function lotteryWindow(mins: number, second: number): boolean {
  if (closeMin != null && closeMin < 16 * 60) {
    const s = mins * 60 + second;
    return s >= (closeMin - 40) * 60 && s < (closeMin - 10) * 60;
  }
  return inLottery(mins, second);
}

async function lotterySweep(now: number, late: boolean): Promise<boolean> {
  const at = late ? now : Date.now();
  const names = odteNames(at);
  const row = markRow(minuteStart(at), 'lottery', names);
  const found: Setup[] = [];
  let answered = false;
  await pool(names, 6, async symbol => {
    const snap = late ? await atMark(symbol, at, 'odte') : await once(symbol, at, sessionIso(at), true, 20_000);
    if (!snap.ok) return;
    answered = true;
    row.names[symbol] = !snap.rows && late ? 'none' : snap.setups.length ? (late ? 'late' : 'live') : 'quiet';
    found.push(...snap.setups);
  });
  if (!answered) return false;
  await scoreLottery(found, at, late);
  recordPicks(at);
  row.scored = found.length;
  row.ranAt = Date.now();
  markChanged();
  return true;
}

/* ---- between marks ---- */

let heldAt = 0;

/** Quotes for the cards already up: one snapshot per name and expiry, at most every 15 seconds. No new universe walk. */
async function refreshHeld(now: number): Promise<void> {
  const live = currentPicks();
  if (!live.length || now - heldAt < 15_000 || deskPhase(now) === 'closed') return;
  heldAt = now;
  const byExp = new Map<string, string[]>();
  for (const s of live) {
    if (!s.expiryDate) continue;
    const dte = weekdayDte(sessionYmd(now), s.expiryDate);
    if (!optionScanOpen(s.ticker, Number.isFinite(dte) ? Math.min(dte, 1) : 1, now)) continue;
    const list = byExp.get(s.expiryDate) ?? [];
    if (!list.includes(s.ticker)) list.push(s.ticker);
    byExp.set(s.expiryDate, list);
  }
  const found: Setup[] = [];
  const snaps: { symbol: string; spot: number }[] = [];
  const jobs = [...byExp].flatMap(([exp, symbols]) => symbols.map(symbol => ({ exp, symbol })));
  await pool(jobs, 4, async ({ exp, symbol }) => {
    const got = await once(symbol, Date.now(), exp, false);
    snaps.push({ symbol, spot: got.spot });
    found.push(...got.setups);
  });
  if (found.length) paintQuotes(found);
  noteSpots(snaps);
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

const sparkAt = new Map<string, number>();

async function fillSparks(symbols: string[]): Promise<void> {
  const keys = [...new Set(symbols.map(s => SPARK_UNDER[s] ?? s))].filter(k => Date.now() - (sparkAt.get(k) ?? 0) > 4 * 60_000);
  if (!keys.length) return;
  const fresh: Record<string, number[]> = { ...meta.sparks };
  await pool(keys, 3, async key => {
    sparkAt.set(key, Date.now());
    const series = await closesOf(key, key in SPARK_UNDER || key in INDEX_OF);
    if (series.length >= 2) fresh[key] = series;
  });
  setScanMeta({ sparks: fresh });
}

/* ---- the clock ---- */

/** The session's close when it is early (minute of the day), from ThetaData's calendar; null on a full day. */
let closeMin: number | null = null;
let closeDay = '';

export function sessionClose(): number | null {
  return closeMin;
}

/** The close the calendar in core/calendar.ts gives for a session date (YYYYMMDD): 13:00 on a listed early close,
    else null. Used until ThetaData's calendar answers, so a terminal that is down at the day roll cannot leave an early
    close unknown (and the 13:00 day scanned and flattened as a full one). */
export function calendarClose(day: string): number | null {
  const m = sessionCloseMinOn(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`);
  return m < 16 * 60 ? m : null;
}

let closeAsked = 0;
let closeBusy = false;

/** ThetaData's calendar for the session, asked again every tick (at most every 10 s) until it answers; the
    core/calendar close stands in meanwhile. */
async function readClose(day: string): Promise<void> {
  if (closeDay === day || closeBusy || Date.now() - closeAsked < 10_000) return;
  closeBusy = true;
  closeAsked = Date.now();
  try {
    const got = await theta(`/calendar/on_date?date=${day}&format=json`);
    if (got.error) return;
    const row = asRows(got.data)[0];
    if (!row) return;
    closeDay = day;
    const type = String(row.type ?? '');
    const m = /^(\d{2}):(\d{2})/.exec(String(row.close ?? ''));
    closeMin = type === 'early_close' && m ? Number(m[1]) * 60 + Number(m[2]) : null;
    /* the calls recorded from now on settle against this session's close, and the entries gate on its flat */
    setSessionClose(closeMin);
    setScoreClose(day, closeMin);
  } finally {
    closeBusy = false;
  }
}

/** On an early-close day nothing is scored after the close: the curb and the later marks do not exist. */
function pastEarlyClose(mins: number): boolean {
  return closeMin != null && closeMin < 16 * 60 && mins >= closeMin && mins < 20 * 60 + 15;
}

/** The marks of this session up to now, from `from` (epoch ms), each sleeve with the names it scans then. */
function marksSince(from: number, now: number): { at: number; sleeve: 'odte' | 'weekly'; names: string[] }[] {
  const out: { at: number; sleeve: 'odte' | 'weekly'; names: string[] }[] = [];
  for (let t = minuteStart(from); t < minuteStart(now); t += 60_000) {
    const p = nyParts(t);
    const mins = p.hour * 60 + p.minute;
    if (!sessionScanOpen(mins, p.weekday) || !sessionDayOpen(t) || pastEarlyClose(mins)) continue;
    const odte = odteNames(t);
    if (odte.length) out.push({ at: t, sleeve: 'odte', names: odte });
    const weekly = weeklyNames(t);
    if (weekly.length) out.push({ at: t, sleeve: 'weekly', names: weekly });
  }
  return out;
}

export interface ScanOptions {
  /** A line for the server's log (a pass that threw, a background read that failed) */
  log?: (line: string) => void;
  /** The earliest mark to fill in from recorded quotes, epoch ms (the session's 09:30 by default) */
  backfillFrom?: (day: string) => number;
  /** A new session began: the server starts its file */
  onDay?: (day: string) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lateBusy = false;
let settleAt = 0;
let lateAt = 0;
let day = '';
let opts: ScanOptions = {};
let stopped = true;

/** The 09:30 ET of a session date (YYYY-MM-DD). */
export function regularOpen(iso: string): number {
  return nyWallTime(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)), 9, 30);
}

const said = new Map<string, number>();

/** Logs a failure of one step of the scan, the same line at most once a minute. */
function fault(where: string, e: unknown): void {
  const text = `[compass] ${where} failed: ${e instanceof Error ? e.message : String(e)}`;
  if (Date.now() - (said.get(text) ?? 0) < 60_000) return;
  said.set(text, Date.now());
  if (said.size > 200) said.clear();
  (opts.log ?? console.warn)(text);
}

/** A background step: run, never left unhandled. */
function bg(where: string, job: Promise<unknown>): void {
  job.catch(e => fault(where, e));
}

function rollDay(now: number): void {
  const next = sessionIso(now);
  if (next !== day) {
    day = next;
    lotteryDay = '';
    /* the close is not known for the new session until its calendar answers */
    closeDay = '';
    closeAsked = 0;
    closeMin = calendarClose(next.replace(/-/g, ''));
    setSessionClose(closeMin);
    setScoreClose(next.replace(/-/g, ''), closeMin);
    opts.onDay?.(next);
    /* the session's one-time reads (prior bars, volume curves, expirations), off the marks' critical path */
    const names = [...new Set([...odteBook(now), ...WEEKLY_FOCUS])];
    bg('the session warm-up', Promise.all([warmSession(names, now), ...WEEKLY_FOCUS.map(n => expirationsOf(n))]));
  }
  if (closeDay !== day.replace(/-/g, '')) bg('the session calendar', readClose(day.replace(/-/g, '')));
}

/** Fill the marks the live pass did not read, oldest first, one name at a time, while no live pass runs. */
let laidFrom = 0;
let laidDay = '';

async function fillLate(now: number): Promise<void> {
  if (lateBusy || running) return;
  lateBusy = true;
  try {
    const from = opts.backfillFrom ? opts.backfillFrom(day) : regularOpen(day);
    /* every mark since the last look gets its row, so a minute nobody scanned is never skipped */
    if (laidDay !== day) {
      laidDay = day;
      laidFrom = from;
    }
    for (const m of marksSince(Math.max(from, laidFrom), now)) markRow(m.at, m.sleeve, m.names);
    laidFrom = Math.max(laidFrom, minuteStart(now));
    const due = exportMarks().filter(r => r.sleeve !== 'lottery' && r.at < minuteStart(Date.now()) && r.at >= from && Object.values(r.names).includes('pending'));
    for (const row of due) {
      if (stopped || running) return;
      const waiting = Object.entries(row.names).filter(([, state]) => state === 'pending').map(([symbol]) => symbol);
      await pool(waiting, 4, symbol => lateName(row, symbol));
      if (meta.theta === 'down') return;
    }
    /* Book C's window passed with no sweep: the 15:20 quotes recorded then */
    const p = nyParts(now);
    const mins = p.hour * 60 + p.minute;
    const lotteryEnd = closeMin != null && closeMin < 16 * 60 ? closeMin - 10 : 15 * 60 + 50;
    if (lotteryDay !== day && mins >= lotteryEnd && mins < 20 * 60 + 15 && sessionIso(now) === day) {
      const start = closeMin != null && closeMin < 16 * 60 ? closeMin - 40 : 15 * 60 + 20;
      const at = nyWallTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), Math.floor(start / 60), start % 60) + 15_000;
      if (at >= from && (await lotterySweep(at, true))) lotteryDay = day;
    }
  } finally {
    lateBusy = false;
  }
}

async function tick(): Promise<void> {
  if (ticking || stopped) return;
  ticking = true;
  try {
    const now = Date.now();
    rollDay(now);
    const p = nyParts(now);
    const mins = p.hour * 60 + p.minute;
    if (sessionScanOpen(mins, p.weekday) && sessionDayOpen(now) && !pastEarlyClose(mins)) {
      const markAt = minuteStart(now);
      await Promise.all([liveMark(markAt, 'odte'), liveMark(markAt, 'weekly')]);
    }
    if (lotteryDay !== day && lotteryWindow(mins, p.second) && sessionIso(now) === day) {
      if (await lotterySweep(now, false)) lotteryDay = day;
    }
    bg('the card quotes', refreshHeld(Date.now()));
    if (Date.now() - settleAt > 60_000) {
      settleAt = Date.now();
      bg('settlement', settleOpen(Date.now()));
    }
    if (Date.now() - lateAt > 5_000) {
      lateAt = Date.now();
      bg('the late fill', fillLate(Date.now()));
    }
  } finally {
    ticking = false;
  }
}

/** Start the scan. It runs until stopScan(), whether or not anyone is viewing. */
export function startScan(options: ScanOptions = {}): void {
  if (!stopped) return;
  opts = options;
  stopped = false;
  bg('the scan tick', tick());
  timer = setInterval(() => bg('the scan tick', tick()), 1_000);
}

/** Stop at the next step: no new pass starts and the late fill gives up its place. */
export function stopScan(): void {
  stopped = true;
  if (timer != null) clearInterval(timer);
  timer = null;
}

/** Book C has swept this session (restored from the record after a restart). */
export function setLotteryDay(d: string): void {
  lotteryDay = d;
}

export function lotterySwept(): string {
  return lotteryDay;
}
