/* Compass scorer. Books A and B call Model 1 (entry) and Model 2 (runner). Book C calls neither. A hash or
   tree-count miss scores nothing. */

import { parseBoosters, predict, type Tree } from './lgbm';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { nyYmd as ymd, sessionBefore } from '../core/calendar';
import { econReleases } from './monthCalendar';
import {
  DO_NOT_REQUEST,
  ENTRY_SHA,
  RUNNER_SHA,
  TREE_N,
  UNIVERSE_SHA,
  UNIVERSE_N,
  printOf,
  weekdayDte,
  sessionScanOpen,
  quoteValid,
  spreadPass,
  f32,
  strikeDistance,
  strikeSpan,
  SPAN_INDEX,
  DRIVE,
  bookAPass,
  bookBPass,
  runnerFlag,
  SEAT_CAP,
  BOOK_B_LOOKBACK,
  LOTTERY_CAP,
  SESSION_MIN,
  YEAR_SESSIONS,
  FLAT_T,
  QUOTE_MAX_AGE_MS,
  inLottery,
  releaseBlocks,
  thetaBurns,
  lotteryEntry,
  MODEL_1_NAME,
  MODEL_2_NAME,
  P1_MIN,
} from './compassParams';
import { COMPASS_TICKERS } from './compassUniverse';
import { optionScanOpen, sessionYmd } from './compassSession';
import type { OptionRight, Setup } from '../types/compass';
import type { PathBar } from './compassOutcome';
import { CORE, INDEX, NO_DAILY, SECTOR_OF, UNDER, atmPair, curveFrom, features, tapeOf, yearsLeft, type Bar, type Curve, type PinBook } from './compassFeatures';

let ENTRY: Tree[] = [];
let RUNNER: Tree[] = [];
let locked = false;
/* Empty until a load has been tried and failed: an unscored session is not a failed load. */
let lockText = '';
let loading: Promise<boolean> | null = null;

export function lockReason(): string {
  return lockText;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadOne(url: string, expect: string): Promise<Tree[] | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  if (await sha256Hex(bytes) !== expect) return null;
  return parseBoosters(new TextDecoder().decode(bytes), TREE_N);
}

async function ensureModels(): Promise<boolean> {
  if (locked) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const uni = await fetch('/config/universe_458.json');
      if (!uni.ok) {
        lockText = 'Universe file missing. Scoring is closed.';
        return false;
      }
      const raw = await uni.arrayBuffer();
      if (await sha256Hex(raw) !== UNIVERSE_SHA) {
        lockText = 'Universe hash does not match. Scoring is closed.';
        return false;
      }
      const names = JSON.parse(new TextDecoder().decode(raw)) as unknown;
      if (!Array.isArray(names) || names.length !== UNIVERSE_N || names.some((n, i) => n !== COMPASS_TICKERS[i])) {
        lockText = 'Universe list does not match. Scoring is closed.';
        return false;
      }
      const entry = await loadOne('/models/model_entry_all6months.txt', ENTRY_SHA);
      const runner = await loadOne('/models/model_runner_all6months.txt', RUNNER_SHA);
      if (!entry || !runner) {
        lockText = `${MODEL_1_NAME} or ${MODEL_2_NAME} failed its hash or its tree count. Scoring is closed.`;
        return false;
      }
      ENTRY = entry;
      RUNNER = runner;
      locked = true;
      lockText = '';
      return true;
    } catch {
      lockText = 'Model files could not be read. Scoring is closed.';
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function modelsLocked(): boolean {
  return locked && ENTRY.length === TREE_N && RUNNER.length === TREE_N;
}

/** Called once per session. The id is ticker, strike, right, and sleeve. */
const seen = new Set<string>();
const seenRootA = new Set<string>();
const seenRootB = new Set<string>();
const seenRootC = new Set<string>();

interface LeftRow { id: string; ticker: string; contract: string; why: string; at: number }


function minuteOf(ms: number): number {
  const p = nyParts(ms);
  return p.hour * 60 + p.minute;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function stampAt(stamp: unknown): { d: string; m: number } | null {
  const at = nyWallStamp(stamp);
  if (!at) return null;
  const p = nyParts(at);
  return { d: `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`, m: p.hour * 60 + p.minute };
}

/** The trading session before `day` (YYYYMMDD), skipping weekends and market holidays. */
function priorSessionYmd(day: string): string {
  const d = sessionBefore(new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function barsOf(data: unknown): Bar[] {
  const flat: Record<string, unknown>[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown };
    if (Array.isArray(row.data)) flat.push(...(row.data as Record<string, unknown>[]));
    else flat.push(item as Record<string, unknown>);
  }
  const out: Bar[] = [];
  for (const b of flat) {
    const at = stampAt(b.timestamp ?? b.time ?? b.date);
    const c = num(b.close);
    if (!at || !(c > 0)) continue;
    out.push({ d: at.d, m: at.m, o: num(b.open) || c, h: num(b.high) || c, l: num(b.low) || c, c, v: num(b.volume) || 0 });
  }
  /* A multi-day pull must stay grouped by date; sorting by minute alone interleaves the days. */
  out.sort((a, b) => (a.d === b.d ? a.m - b.m : a.d < b.d ? -1 : 1));
  return out;
}

const barMemo = new Map<string, { at: number; bars: Bar[] }>();

async function loadBars(symbol: string, day: string): Promise<Bar[]> {
  const key = `${symbol}|${day}`;
  const hit = barMemo.get(key);
  /* a finished session's bars do not change; today's are read again after a minute */
  if (hit && (Date.now() - hit.at < 60_000 || (hit.bars.length && day < ymd(Date.now())))) return hit.bars;
  const root = UNDER[symbol] ?? symbol;
  const index = INDEX.has(symbol) || INDEX.has(root);
  const path = index
    ? `/index/history/ohlc?symbol=${root}&start_date=${day}&end_date=${day}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${root}&start_date=${day}&end_date=${day}&interval=1m&format=json`;
  const got = await thetaCall(path);
  const bars = got.error ? [] : barsOf(got.data);
  barMemo.set(key, { at: Date.now(), bars });
  return bars;
}

async function loadPrior(name: string, day: string): Promise<{ h: number; l: number; c: number } | null> {
  const bars = await loadBars(name, priorSessionYmd(day));
  if (!bars.length) return null;
  let h = 0;
  let l = Infinity;
  for (const b of bars) {
    h = Math.max(h, b.h);
    l = Math.min(l, b.l);
  }
  return { h, l, c: bars[bars.length - 1].c };
}

/** A name's regular-session one-minute bars from the terminal: today's, or the last session's before the open. The
    same read (and memo) the scan uses. */
export async function sessionBars(ticker: string, now = Date.now()): Promise<{ day: string; bars: { t: number; h: number; l: number; c: number }[] } | null> {
  const name = UNDER[ticker] ?? printOf(ticker);
  const today = sessionYmd(now);
  for (const day of [today, priorSessionYmd(today)]) {
    const got = await loadBars(name, day);
    if (got.length) return { day, bars: got.map(b => ({ t: nyWallTime(Number(b.d.slice(0, 4)), Number(b.d.slice(4, 6)), Number(b.d.slice(6, 8)), Math.floor(b.m / 60), b.m % 60), h: b.h, l: b.l, c: b.c })) };
  }
  return null;
}

/** The underlying's one-minute closes on a session day (YYYYMMDD), from the scan's own bar read. */
export async function underCloses(ticker: string, day: string): Promise<PathBar[]> {
  const bars = await loadBars(UNDER[ticker] ?? printOf(ticker), day);
  return bars.map(b => ({ t: nyWallTime(Number(b.d.slice(0, 4)), Number(b.d.slice(4, 6)), Number(b.d.slice(6, 8)), Math.floor(b.m / 60), b.m % 60), c: b.c }));
}

const curves = new Map<string, Curve | null>();
const pinCache = new Map<string, { at: number; book: PinBook | null }>();
const warmQ: string[] = [];
let warming = false;
let scanBusyFlag = false;

export function scanBusy(): boolean {
  return scanBusyFlag;
}

export function setScanBusy(on: boolean): void {
  scanBusyFlag = on;
  (globalThis as { __slayerScan?: boolean }).__slayerScan = on;
}

async function fetchCurve(symbol: string, now: number): Promise<Curve | null> {
  const end = priorSessionYmd(sessionYmd(now));
  const start = ymd(now - 21 * 86400000);
  const root = UNDER[symbol] ?? symbol;
  const index = INDEX.has(symbol) || INDEX.has(root);
  const path = index
    ? `/index/history/ohlc?symbol=${root}&start_date=${start}&end_date=${end}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${root}&start_date=${start}&end_date=${end}&interval=1m&format=json`;
  const got = await thetaCall(path);
  return curveFrom(got.error ? [] : barsOf(got.data));
}

/** The name's intraday volume curve over the prior sessions; asked for in the background the first time it is wanted */
function curveOf(symbol: string, now = Date.now()): Curve | null {
  const key = `${symbol}|${sessionYmd(now)}`;
  if (!curves.has(key) && !INDEX.has(symbol) && !warmQ.includes(key)) {
    warmQ.push(key);
    void drain(now);
  }
  return curves.get(key) ?? null;
}

async function drain(now: number): Promise<void> {
  if (warming) return;
  warming = true;
  while (warmQ.length) {
    if (scanBusyFlag) {
      await new Promise(resolve => setTimeout(resolve, 400));
      continue;
    }
    const key = warmQ.shift();
    if (!key || curves.has(key)) continue;
    const symbol = key.split('|')[0];
    try {
      curves.set(key, await fetchCurve(symbol, now));
    } catch {
      curves.set(key, null);
    }
  }
  warming = false;
}

/** Open interest per strike of one expiry, from ThetaData's open-interest snapshot (one ask per name and expiry). */
async function pinOf(ticker: string, expiry: string, spot: number): Promise<PinBook | null> {
  if (!CORE.has(ticker)) return null;
  const key = `${ticker}|${expiry}`;
  const hit = pinCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.book;
  const got = await thetaCall(`/option/snapshot/open_interest?symbol=${encodeURIComponent(ticker)}&expiration=${expiry.replace(/-/g, '').slice(0, 8)}&format=json`);
  const byStrike = new Map<number, { strike: number; call: number; put: number }>();
  if (!got.error) {
    for (const item of Array.isArray(got.data) ? got.data : []) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { contract?: Record<string, unknown>; data?: unknown };
      const contract = row.contract && typeof row.contract === 'object' ? row.contract : (item as Record<string, unknown>);
      const quote = Array.isArray(row.data) ? (row.data[0] as Record<string, unknown> | undefined) : (item as Record<string, unknown>);
      const strike = num(contract.strike);
      const side = String(contract.right ?? '').toUpperCase().slice(0, 1);
      const oi = num(quote?.open_interest);
      if (!(strike > 0) || !(oi >= 0) || (side !== 'C' && side !== 'P')) continue;
      const node = byStrike.get(strike) ?? { strike, call: 0, put: 0 };
      if (side === 'C') node.call = oi;
      else node.put = oi;
      byStrike.set(strike, node);
    }
  }
  if (!byStrike.size || !(spot > 0)) {
    if (!got.error) pinCache.set(key, { at: Date.now(), book: null });
    return null;
  }
  const nodes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const book: PinBook = {
    nodes,
    oi: (strike, right) => {
      const node = byStrike.get(strike) ?? nodes.find(row => Math.abs(row.strike - strike) < 0.001);
      if (!node) return NaN;
      return right === 'C' ? node.call : node.put;
    },
  };
  pinCache.set(key, { at: Date.now(), book });
  return book;
}

const seenAsks = new Map<string, { minute: number; bid: number; ask: number }[]>();
const seenMids = new Map<string, { minute: number; mid: number }[]>();

function noteAsk(id: string, minute: number, bid: number, ask: number): void {
  if (!quoteValid(bid, ask) || !Number.isFinite(minute)) return;
  const list = seenAsks.get(id) ?? [];
  const had = list.find(row => row.minute === minute);
  if (had) {
    had.bid = bid;
    had.ask = ask;
  } else {
    list.push({ minute, bid, ask });
    list.sort((x, y) => x.minute - y.minute);
  }
  if (list.length > 80) list.splice(0, list.length - 80);
  seenAsks.set(id, list);
}

function quoteAt(id: string, minute: number): { bid: number; ask: number } | null {
  const list = seenAsks.get(id) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].minute === minute) return list[i];
  return null;
}

function noteMid(id: string, minute: number, mid: number): void {
  if (!(mid > 0) || !Number.isFinite(minute)) return;
  const list = seenMids.get(id) ?? [];
  const had = list.find(row => row.minute === minute);
  if (had) had.mid = mid;
  else {
    list.push({ minute, mid });
    list.sort((x, y) => x.minute - y.minute);
  }
  if (list.length > 40) list.splice(0, list.length - 40);
  seenMids.set(id, list);
}

function midThen(id: string, minute: number): number {
  const list = seenMids.get(id) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].minute === minute) return list[i].mid;
  return NaN;
}

const seededAt = new Map<string, number>();

/** One expiry's NBBO, one reading a minute, from 30 minutes before the scan's 5-minute mark through the mark (one ask
    for every strike of the name and expiry): the mids 5 and 15 minutes back and Book B's ask 30 minutes back come
    from the quotes that stood then, not only from the scans this tab happened to run. The window is fixed to the
    mark, so every viewer scanning the same slot asks the same path and the server shares one answer. */
async function seedQuotes(list: Setup[], now: number): Promise<void> {
  const first = list[0];
  if (!first?.expiryDate) return;
  const clock = nyParts(now);
  const mark = Math.floor((clock.hour * 60 + clock.minute) / 5) * 5;
  const key = `${first.ticker}|${first.expiryDate}|${ymd(now)}|${mark}`;
  if (seededAt.has(key)) return;
  seededAt.set(key, now);
  if (seededAt.size > 400) for (const k of [...seededAt.keys()].slice(0, 200)) seededAt.delete(k);
  const byContract = new Map<string, string>();
  for (const s of list) byContract.set(`${s.strike}|${s.right}`, s.id);
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  const got = await thetaCall(`/option/history/quote?symbol=${encodeURIComponent(first.ticker)}&expiration=${first.expiryDate.replace(/-/g, '').slice(0, 8)}&start_date=${ymd(now)}&end_date=${ymd(now)}&strike_range=16&interval=1m&start_time=${hm(Math.max(0, mark - 30))}&end_time=${hm(mark)}&format=json`);
  if (got.error) return;
  for (const item of Array.isArray(got.data) ? got.data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { contract?: Record<string, unknown>; data?: unknown };
    const contract = row.contract && typeof row.contract === 'object' ? row.contract : (item as Record<string, unknown>);
    const strike = num(contract.strike);
    const side = String(contract.right ?? '').toUpperCase().slice(0, 1);
    const id = byContract.get(`${strike}|${side}`);
    if (!id) continue;
    const quotes = Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : [item as Record<string, unknown>];
    for (const q of quotes) {
      const at = nyWallStamp(q.timestamp);
      const bid = num(q.bid);
      const ask = num(q.ask);
      if (!at || !quoteValid(bid, ask)) continue;
      noteAsk(id, minuteOf(at), bid, ask);
      noteMid(id, minuteOf(at), (bid + ask) / 2);
    }
  }
}

const passed = new Map<string, string[]>();

export function passedOver(ticker: string): string[] {
  return passed.get(ticker) ?? [];
}

function slotOf(s: { ticker: string; sleeve: string }): string {
  return `${s.ticker}|${s.sleeve}`;
}

const picks = new Map<string, Setup>();
const wingPicks = new Map<string, Setup>();
const lotteryPicks = new Map<string, Setup>();
const left = new Map<string, LeftRow>();

interface ScanReport { best: number; prun: number; contract: string; ticker: string; scored: number; quiet: number; setup: Setup | null }
const emptyReport = (): ScanReport => ({ best: 0, prun: 0, contract: '', ticker: '', scored: 0, quiet: 0, setup: null });
const reports: Record<'odte' | 'weekly', ScanReport> = { odte: emptyReport(), weekly: emptyReport() };

export function scanReport(sleeve: 'odte' | 'weekly'): ScanReport {
  return reports[sleeve];
}

export function resetScanReport(sleeve: 'odte' | 'weekly'): void {
  reports[sleeve] = emptyReport();
}

const nearPicks = new Map<string, Setup>();
const misses = new Map<string, { setup: Setup; p1: number; prun: number }>();
const kept = new Map<string, Setup>();
const CALLS_KEY = 'slayer_compass_calls_v1';

interface PassLine {
  ticker: string;
  contract: string;
  p1: number;
  why: string;
  sleeve: string;
}

const passBook = new Map<string, PassLine>();

export function passLines(sleeve: 'odte' | 'weekly'): PassLine[] {
  return [...passBook.values()].filter(row => row.sleeve === sleeve).sort((a, b) => b.p1 - a.p1 || a.contract.localeCompare(b.contract));
}

function rememberPass(s: Setup, p1: number, why: string): void {
  const key = `${s.sleeve}|${s.contract}`;
  passBook.set(key, { ticker: s.ticker, contract: s.contract, p1, why, sleeve: s.sleeve });
  const mine = [...passBook.entries()].filter(([, row]) => row.ticker === s.ticker && row.sleeve === s.sleeve);
  if (mine.length <= 50) return;
  mine.sort((a, b) => a[1].p1 - b[1].p1);
  passBook.delete(mine[0][0]);
}

function stampPassed(): void {
  const called = new Set<string>();
  for (const s of [...picks.values(), ...wingPicks.values(), ...lotteryPicks.values()]) called.add(`${s.sleeve}|${s.contract}`);
  for (const key of [...passBook.keys()]) if (called.has(key)) passBook.delete(key);
  for (const row of misses.values()) {
    const key = `${row.setup.sleeve}|${row.setup.contract}`;
    if (called.has(key)) continue;
    const had = passBook.get(key);
    const foreign = !had || had.why.startsWith('Model 1') || /^[A-Z]{1,6}\s+\d/.test(had.why);
    const why = foreign
      ? (row.p1 + 1e-12 < P1_MIN ? `Model 1 ${(row.p1 * 100).toFixed(1)}%. Needs ${(P1_MIN * 100).toFixed(2)}%.` : 'No seat.')
      : had.why;
    passBook.set(key, { ticker: row.setup.ticker, contract: row.setup.contract, p1: row.p1, why, sleeve: row.setup.sleeve });
  }
}

/** When each sleeve's last full pass finished, epoch ms. */
const scannedAt: Record<'odte' | 'weekly', number> = { odte: 0, weekly: 0 };

export function lastScanAt(sleeve: 'odte' | 'weekly'): number {
  return scannedAt[sleeve];
}

export function noteScanned(sleeve: 'odte' | 'weekly', at = Date.now()): void {
  scannedAt[sleeve] = at;
  persistCalls();
}

type Pack = {
  day?: string;
  picks?: [string, Setup][];
  wings?: [string, Setup][];
  lottery?: [string, Setup][];
  kept?: [string, Setup][];
  near?: [string, Setup][];
  pass?: PassLine[];
  seen?: string[];
  rootA?: string[];
  rootB?: string[];
  rootC?: string[];
  scanned?: { odte?: number; weekly?: number };
};

const dayKey = (at = Date.now()) => {
  const p = nyParts(at);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
};

/** The last session's scan, kept to show (stamped) until today's first pass lands. It is never scored or traded. */
let earlier: { day: string; at: number; setups: Setup[] } | null = null;

export function earlierScan(): { day: string; at: number; setups: Setup[] } | null {
  return earlier;
}

function persistCalls(): void {
  if (typeof localStorage === 'undefined') return;
  const today = dayKey();
  if (!picks.size && !wingPicks.size && !lotteryPicks.size && !nearPicks.size && !scannedAt.odte && !scannedAt.weekly && earlier) return;
  const pack: Pack = {
    day: today,
    picks: [...picks.entries()],
    wings: [...wingPicks.entries()],
    lottery: [...lotteryPicks.entries()],
    kept: [...kept.entries()],
    near: [...nearPicks.entries()],
    pass: [...passBook.values()],
    seen: [...seen],
    rootA: [...seenRootA],
    rootB: [...seenRootB],
    rootC: [...seenRootC],
    scanned: { ...scannedAt },
  };
  try { localStorage.setItem(CALLS_KEY, JSON.stringify(pack)); } catch { /* the maps still hold this tab */ }
}

function restoreCalls(): void {
  if (typeof localStorage === 'undefined') return;
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(CALLS_KEY) || 'null'); } catch { raw = null; }
  const pack = raw && typeof raw === 'object' ? raw as Pack : null;
  if (!pack) return;
  if (pack.day !== dayKey()) {
    const setups = [...(pack.picks ?? []), ...(pack.wings ?? []), ...(pack.lottery ?? []), ...(pack.near ?? [])].map(([, v]) => v).filter(v => v && v.id);
    const at = Math.max(pack.scanned?.odte ?? 0, pack.scanned?.weekly ?? 0);
    if (pack.day && (setups.length || at)) earlier = { day: pack.day, at, setups };
    return;
  }
  for (const [k, v] of pack.picks ?? []) if (v && v.id) picks.set(k, v);
  for (const [k, v] of pack.wings ?? []) if (v && v.id) wingPicks.set(k, v);
  for (const [k, v] of pack.lottery ?? []) if (v && v.id) lotteryPicks.set(k, v);
  for (const [k, v] of pack.kept ?? []) if (v && v.id) kept.set(k, v);
  for (const [k, v] of pack.near ?? []) if (v && v.id) nearPicks.set(k, v);
  for (const row of pack.pass ?? []) if (row && row.ticker && row.contract) passBook.set(`${row.sleeve}|${row.contract}`, row);
  for (const id of pack.seen ?? []) seen.add(id);
  for (const t of pack.rootA ?? []) seenRootA.add(t);
  for (const t of pack.rootB ?? []) seenRootB.add(t);
  for (const t of pack.rootC ?? []) seenRootC.add(t);
  scannedAt.odte = pack.scanned?.odte ?? 0;
  scannedAt.weekly = pack.scanned?.weekly ?? 0;
}

restoreCalls();

/** The card and the contract read this. A pick's quote follows the live book; its signal keeps the one it fired on. */
export function stampPickQuote(ticker: string, expiry: string, strike: number, right: string, q: { bid: number; ask: number; at: number; under: number; iv: number; delta: number; theta: number; vega: number }): void {
  const day = expiry.slice(0, 10);
  const touch = (book: Map<string, Setup>) => {
    for (const [key, s] of book) {
      if (s.ticker !== ticker || s.right !== right || Math.abs(s.strike - strike) > 0.001) continue;
      if (day && s.expiryDate && s.expiryDate.slice(0, 10) !== day) continue;
      book.set(key, {
        ...s,
        bid: q.bid,
        ask: q.ask,
        mid: (q.bid + q.ask) / 2,
        quotedAt: q.at,
        spot: q.under > 0 ? q.under : s.spot,
        greeks: {
          ...s.greeks,
          delta: Number.isFinite(q.delta) ? q.delta : s.greeks.delta,
          theta: Number.isFinite(q.theta) ? q.theta : s.greeks.theta,
          vega: Number.isFinite(q.vega) ? q.vega : s.greeks.vega,
          iv: Number.isFinite(q.iv) ? q.iv : s.greeks.iv,
        },
      });
    }
  };
  touch(picks);
  touch(wingPicks);
  touch(lotteryPicks);
  touch(nearPicks);
}

/** Each scanned name's best Model 1 read on a sleeve this session: its highest-scoring contract. */
export function bestByName(sleeve: 'odte' | 'weekly'): Map<string, { p1: number; contract: string; id: string }> {
  const out = new Map<string, { p1: number; contract: string; id: string }>();
  const take = (s: Setup, p1: number) => {
    if (s.sleeve !== sleeve || !(p1 >= 0)) return;
    const had = out.get(s.ticker);
    if (!had || p1 > had.p1) out.set(s.ticker, { p1, contract: s.contract, id: s.id });
  };
  for (const row of misses.values()) take(row.setup, row.p1);
  for (const s of [...picks.values(), ...wingPicks.values()]) take(s, s.p1 ?? -1);
  for (const row of passBook.values()) {
    if (row.sleeve !== sleeve || !(row.p1 > 0)) continue;
    const had = out.get(row.ticker);
    if (!had || row.p1 > had.p1) out.set(row.ticker, { p1: row.p1, contract: row.contract, id: had?.contract === row.contract ? had.id : '' });
  }
  return out;
}

/** Best scored miss per name. A later slice does not erase a higher one. */
function noteMiss(s: Setup, p1: number, prun: number): void {
  if (!(p1 >= 0)) return;
  const key = `${s.sleeve}|${s.ticker}`;
  const had = misses.get(key);
  if (had && had.p1 >= p1) return;
  misses.set(key, { setup: s, p1, prun });
}

const CLOSEST_CAP = 8;

/** The eight highest misses on this sleeve that are not already a call. They stay until an exit. */
export function commitClosest(sleeve: 'odte' | 'weekly'): void {
  const taken = new Set<string>();
  for (const p of [...picks.values(), ...wingPicks.values(), ...lotteryPicks.values(), ...nearPicks.values()]) {
    if (p.sleeve === sleeve) taken.add(p.ticker);
  }
  const rows = [...misses.values()].filter(r => r.setup.sleeve === sleeve && !taken.has(r.setup.ticker));
  rows.sort((a, b) => b.p1 - a.p1);
  let n = [...nearPicks.values()].filter(p => p.sleeve === sleeve).length;
  for (const row of rows) {
    if (n >= CLOSEST_CAP) break;
    if (taken.has(row.setup.ticker)) continue;
    const s = row.setup;
    const card: Setup = {
      ...s,
      p1: row.p1,
      prun: row.prun,
      runner: false,
      modelAgree: false,
      better: 'entry',
      band: 'closest',
      strength: false,
      seenAt: Date.now(),
      verdict: 'WATCH',
      score: 0,
      takeProfits: [],
      priceTargets: [],
      invalidationPrice: 0,
      invalidationReason: '',
      whyText: row.p1 + 1e-12 < P1_MIN ? `Model 1 ${(row.p1 * 100).toFixed(1)}%. Needs ${(P1_MIN * 100).toFixed(2)}%.` : `Model 1 ${(row.p1 * 100).toFixed(1)}%. No seat.`,
    };
    nearPicks.set(s.id, card);
        taken.add(s.ticker);
    n += 1;
  }
  persistCalls();
}

export function currentPicks(): Setup[] {
  const rank = (s: Setup) => s.band === 'top' ? 4 : s.band === 'wing' ? 3 : s.band === 'lottery' ? 2 : s.band === 'closest' ? 1 : 0;
  return [...picks.values(), ...wingPicks.values(), ...lotteryPicks.values(), ...nearPicks.values()].sort((a, b) => rank(b) - rank(a) || (b.p1 ?? 0) - (a.p1 ?? 0));
}

export function heldSetup(id: string): Setup | null {
  const held = currentPicks().find(s => s.id === id);
  if (held) return held;
  const was = kept.get(id);
  if (was) return was;
  for (const report of [reports.odte, reports.weekly]) {
    if (report.setup?.id === id) return { ...report.setup, band: 'closest' };
  }
  return null;
}

export function noteLeft(row: { id: string; ticker: string; contract: string }, why: string): void {
  const held = currentPicks().find(s => s.id === row.id);
  if (held) kept.set(row.id, held);
  left.set(row.id, { id: row.id, ticker: row.ticker, contract: row.contract, why, at: Date.now() });
  for (const [key, pick] of picks) if (pick.id === row.id) picks.delete(key);
  for (const [key, pick] of wingPicks) if (pick.id === row.id) wingPicks.delete(key);
  for (const [key, pick] of lotteryPicks) if (pick.id === row.id) lotteryPicks.delete(key);
  for (const [key, pick] of nearPicks) if (pick.id === row.id) nearPicks.delete(key);
  persistCalls();
}

export function leftOf(id: string): LeftRow | null {
  return left.get(id) ?? null;
}

/** Fifteen minutes before a high-impact release until fifteen minutes after. No new ticket. */
function releaseShut(now: number): boolean {
  const clock = nyParts(now);
  const minute = clock.hour * 60 + clock.minute;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  for (const ev of econReleases()) {
    const parts = String(ev.time || '').split(':');
    const hh = Number(parts[0]);
    const mm = Number(parts[1] ?? 0);
    if (!Number.isFinite(hh)) continue;
    if (!(ev.date instanceof Date) || Number.isNaN(ev.date.getTime())) continue;
    const evDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ev.date);
    if (evDay === today && releaseBlocks(ev.title, hh * 60 + mm, minute)) return true;
  }
  return false;
}

async function scoreAll(setups: Setup[], now: number, merge = false): Promise<void> {
  if (!(await ensureModels()) || !modelsLocked()) return;
  const clock = nyParts(now);
  const minute = clock.hour * 60 + clock.minute;
  if (!merge && !sessionScanOpen(minute, clock.weekday)) return;
  if (releaseShut(now)) return;
  const blocked = new Set<string>(DO_NOT_REQUEST);
  const day = sessionYmd(now);
  const rows = setups.filter(s => {
    if (blocked.has(s.ticker)) return false;
    const dte = weekdayDte(day, s.expiryDate);
    if (!(dte >= 0 && dte <= 7)) return false;
    if (dte === 0 && NO_DAILY.has(s.ticker)) return false;
    return optionScanOpen(s.ticker, dte, now);
  });
  if (!rows.length) return;
  const names = [...new Set(rows.map(s => UNDER[s.ticker] ?? printOf(s.ticker)))];
  const book = new Map<string, Bar[]>();
  await Promise.all(names.map(async name => { book.set(name, await loadBars(name, day)); }));
  const spy = await loadBars('SPY', day);
  const etfs = [...new Set(names.map(name => SECTOR_OF[name]).filter(Boolean))];
  const secBars = new Map<string, Bar[]>();
  await Promise.all(etfs.map(async etf => { secBars.set(etf, await loadBars(etf, day)); }));
  const pd = new Map<string, { h: number; l: number; c: number } | null>();
  await Promise.all(names.map(async name => { pd.set(name, await loadPrior(name, day)); }));
  const pins = new Map<string, PinBook | null>();
  const wanted = new Map<string, { ticker: string; expiry: string; spot: number }>();
  for (const s of rows) {
    if (!CORE.has(s.ticker)) continue;
    const key = `${s.ticker}|${s.expiryDate}`;
    if (!wanted.has(key)) wanted.set(key, { ticker: s.ticker, expiry: s.expiryDate, spot: s.spot ?? 0 });
  }
  await Promise.all([...wanted].map(async ([key, row]) => {
    pins.set(key, await pinOf(row.ticker, row.expiry, row.spot));
  }));
  const groups = new Map<string, Setup[]>();
  for (const s of rows) {
    const key = `${s.ticker}|${s.expiryDate}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  await Promise.all([...groups.values()].map(list => seedQuotes(list, now)));
  const bySlot = new Map<string, Setup[]>();
  for (const s of rows) {
    const key = slotOf(s);
    const list = bySlot.get(key) ?? [];
    list.push(s);
    bySlot.set(key, list);
  }
  const sleeves = new Set(rows.map(s => s.sleeve));
  const next = new Map(picks);
  const wingNext = new Map(wingPicks);
  if (merge) {
    for (const s of rows) {
      const slot = slotOf(s);
      const had = next.get(slot);
      if (had && !seen.has(had.id)) next.delete(slot);
      for (const [key, pick] of wingNext) {
        if (pick.ticker === s.ticker && pick.sleeve === s.sleeve && !seen.has(key)) wingNext.delete(key);
      }
    }
  } else {
    for (const [key, pick] of picks) if (sleeves.has(pick.sleeve) && !seen.has(pick.id)) next.delete(key);
    for (const [key, pick] of wingPicks) if (sleeves.has(pick.sleeve) && !seen.has(key)) wingNext.delete(key);
  }
  const aPool: { setup: Setup; p1: number; prun: number; gex: number; retOpen: number }[] = [];
  const bPool: { setup: Setup; p1: number; prun: number; gex: number; retOpen: number }[] = [];
  for (const [, list] of bySlot) {
    const ticker = list[0].ticker;
    const under = UNDER[ticker] ?? ticker;
    const indexName = INDEX.has(ticker) || INDEX.has(under);
    const quoted = list.find(s => (s.spot ?? 0) > 0)?.spot ?? NaN;
    const tape = tapeOf(book.get(under) ?? [], indexName, minute, quoted);
    const report = list[0].sleeve === 'weekly' ? reports.weekly : reports.odte;
    if (!(tape.S > 0)) {
      report.quiet += list.length;
      continue;
    }
    const horizon = yearsLeft(tape.tt);
    const { iv, skew } = atmPair(list, tape.S, horizon);
    const etf = ticker === 'SPXW' ? '' : (SECTOR_OF[ticker] ?? SECTOR_OF[under] ?? '');
    const sec = etf ? secBars.get(etf) ?? [] : [];
    const curve = curveOf(under);
    const notes: string[] = [];
    for (const s of list) {
      const word = s.contract;
      const qMin = s.quotedAt ? minuteOf(s.quotedAt) : NaN;
      const dte = weekdayDte(day, s.expiryDate);
      if (quoteValid(s.bid, s.ask) && Number.isFinite(qMin)) noteAsk(s.id, qMin, s.bid, s.ask);
      if (!(dte >= 0 && dte <= 7)) {
        notes.push(`${word} is outside 0 to 7 days`);
        continue;
      }
      if (!s.quotedAt || s.quotedAt > now + 60_000 || now - s.quotedAt > QUOTE_MAX_AGE_MS) {
        notes.push(`${word} quote is older than 90 seconds`);
        continue;
      }
      if (!quoteValid(s.bid, s.ask)) {
        notes.push(`${word} quote is missing`);
        continue;
      }
      if (!spreadPass(s.bid, s.ask)) {
        notes.push(`${word} bid is at or under 0.15, or the spread is over 8%`);
        continue;
      }
      const mid = (s.bid + s.ask) / 2;
      noteMid(s.id, qMin, mid);
      const pin = pins.get(`${s.ticker}|${s.expiryDate}`) ?? null;
      const raw = features({ ...s, mid }, minute, book.get(under) ?? [], spy, pd.get(under) ?? null, iv, skew, sec, curve, pin, { m5: midThen(s.id, minute - 5), m15: midThen(s.id, minute - 15) });
      if (!raw) continue;
      const x = f32(raw);
      const p1 = predict(ENTRY, x);
      const prun = predict(RUNNER, x);
      report.scored += 1;
      if (p1 > report.best) {
        report.best = p1;
        report.prun = prun;
        report.contract = word;
        report.ticker = s.ticker;
        report.setup = { ...s, p1, prun, seenAt: undefined };
      }
      noteMiss(s, p1, prun);
      const dt = Math.max(0, FLAT_T - (tape.tt + 1)) / (SESSION_MIN * YEAR_SESSIONS);
      if (thetaBurns(x[39], x[38], s.ask, dt)) {
        notes.push(`${word} theta burns the stop before the flat`);
        continue;
      }
      if (seen.has(s.id)) {
        notes.push(`${word} ${MODEL_1_NAME} ${(p1 * 100).toFixed(0)}%`);
        continue;
      }
      const dist = strikeDistance(list.map(row => row.strike), tape.S, s.strike);
      const span = strikeSpan(tape.S, list.map(row => row.strike), SPAN_INDEX.includes(s.ticker as typeof SPAN_INDEX[number]));
      const prior = quoteAt(s.id, minute - BOOK_B_LOOKBACK);
      const retOpen = tape.op > 0 && tape.S > 0 ? tape.S / tape.op - 1 : NaN;
      const row = { setup: s, p1, prun, gex: x[27], retOpen };
      if (bookAPass(tape.tt, dist, span, dte, s.bid, s.ask, p1)) aPool.push(row);
      else if (prior && bookBPass(tape.tt, dist, span, dte, s.bid, s.ask, prior.bid, prior.ask, p1)) bPool.push(row);
      else if (!prior && dist > span) notes.push(`${word} has no quote from 30 minutes earlier`);
      notes.push(`${word} ${MODEL_1_NAME} ${(p1 * 100).toFixed(0)}%`);
    }
    passed.set(ticker, notes.slice(0, 6));
    for (const note of notes) {
      const cut = note.indexOf(' ', note.indexOf(' ') + 1);
      if (cut < 0) continue;
      const contract = note.slice(0, cut);
      const hit = list.find(s => s.contract === contract);
      if (!hit) continue;
      const pct = /Model 1 (\d+(?:\.\d+)?)%/.exec(note);
      rememberPass(hit, pct ? Number(pct[1]) / 100 : 0, note.slice(cut + 1));
    }
  }
  type Row = { setup: Setup; p1: number; prun: number; gex: number; retOpen: number; book: 'A' | 'B' };
  const choose = (pool: { setup: Setup; p1: number; prun: number; gex: number; retOpen: number }[], book: 'A' | 'B'): Row[] => {
    const byRoot = new Map<string, typeof pool>();
    for (const row of pool) {
      const list = byRoot.get(row.setup.ticker) ?? [];
      list.push(row);
      byRoot.set(row.setup.ticker, list);
    }
    const out: Row[] = [];
    for (const list of byRoot.values()) {
      const ret = list.find(r => Number.isFinite(r.retOpen))?.retOpen ?? NaN;
      const drive = Number.isFinite(ret) && Math.abs(ret) >= DRIVE;
      const best = (xs: typeof pool) => xs.reduce((a, b) => (b.p1 > a.p1 ? b : a));
      const calls = list.filter(r => r.setup.right === 'C');
      const puts = list.filter(r => r.setup.right === 'P');
      if (drive) {
        const side = ret > 0 ? calls : puts;
        if (!side.length) {
          const had = passed.get(list[0].setup.ticker) ?? [];
          had.push(`${list[0].setup.ticker} is on a drive. The other side was the only one that cleared, so nothing is sent.`);
          passed.set(list[0].setup.ticker, had.slice(0, 6));
          continue;
        }
        out.push({ ...best(side), book });
        continue;
      }
      /* A flat root with both sides clearing has no side named: the ask-side flow split that would break the tie is not read. */
      if (calls.length && puts.length) {
        const had = passed.get(list[0].setup.ticker) ?? [];
        had.push(`${list[0].setup.ticker} is flat and both sides cleared. Nothing names one side, so neither is sent.`);
        passed.set(list[0].setup.ticker, had.slice(0, 6));
        continue;
      }
      out.push({ ...best(list), book });
    }
    return out;
  };
  const heldRoots = new Set<string>([...seenRootA, ...seenRootB]);
  let seats = heldRoots.size;
  const cands = [...choose(aPool, 'A'), ...choose(bPool, 'B')].sort((a, b) => {
    const ad = Number.isFinite(a.retOpen) && Math.abs(a.retOpen) >= DRIVE ? 1 : 0;
    const bd = Number.isFinite(b.retOpen) && Math.abs(b.retOpen) >= DRIVE ? 1 : 0;
    return bd - ad || b.p1 - a.p1;
  });
  const anyDrive = cands.some(r => Number.isFinite(r.retOpen) && Math.abs(r.retOpen) >= DRIVE);
  for (const row of cands) {
    const drive = Number.isFinite(row.retOpen) && Math.abs(row.retOpen) >= DRIVE;
    if (anyDrive && !drive) continue;
    if (seats >= SEAT_CAP || heldRoots.has(row.setup.ticker) || seen.has(row.setup.id)) continue;
    heldRoots.add(row.setup.ticker);
    seats += 1;
    if (row.book === 'A') {
      const run = runnerFlag(row.prun);
      seen.add(row.setup.id);
      seenRootA.add(row.setup.ticker);
      next.set(slotOf(row.setup), {
        ...row.setup,
        p1: row.p1,
        prun: row.prun,
        runner: run,
        modelAgree: false,
        better: run ? 'runner' : 'entry',
        band: 'top',
        strength: false,
        seenAt: Date.now(),
        verdict: 'ENTER',
        score: 0,
        takeProfits: [],
        priceTargets: [],
        invalidationPrice: 0,
        invalidationReason: '',
        whyText: 'Book A. Model 1 cleared.',
      });
    } else {
      seen.add(row.setup.id);
      seenRootB.add(row.setup.ticker);
      wingNext.set(row.setup.id, {
        ...row.setup,
        p1: row.p1,
        prun: row.prun,
        runner: true,
        modelAgree: false,
        better: 'runner',
        band: 'wing',
        strength: false,
        seenAt: Date.now(),
        verdict: 'ENTER',
        score: 0,
        takeProfits: [],
        priceTargets: [],
        invalidationPrice: 0,
        invalidationReason: '',
        whyText: 'Book B. Model 1 cleared. The exit is the runner ratchet.',
      });
    }
  }
  picks.clear();
  for (const [key, pick] of next) picks.set(key, pick);
  wingPicks.clear();
  for (const [key, pick] of wingNext) wingPicks.set(key, pick);
  stampPassed();
  persistCalls();
}

function quoteMinute(s: Setup, now: number): number {
  return s.quotedAt ? minuteOf(s.quotedAt) : minuteOf(now);
}

export function paintQuotes(setups: Setup[]): void {
  const byId = new Map(setups.map(s => [s.id, s]));
  const paint = (into: Map<string, Setup>, key: string, pick: Setup, live: Setup) => {
    const mid = (live.bid + live.ask) / 2;
    if (quoteValid(live.bid, live.ask)) noteMid(pick.id, quoteMinute(live, Date.now()), mid);
    const slot = slotOf(pick);
    if (key !== slot) into.delete(key);
    into.set(slot === key ? key : slot, {
      ...live,
      p1: pick.p1,
      prun: pick.prun,
      runner: pick.runner,
      modelAgree: pick.modelAgree,
      better: pick.better,
      band: pick.band,
      strength: pick.strength,
      seenAt: pick.seenAt,
      verdict: pick.band === 'closest' ? 'WATCH' : 'ENTER',
      score: 0,
      takeProfits: [],
      priceTargets: [],
      invalidationPrice: pick.invalidationPrice,
      invalidationReason: pick.invalidationReason,
      swingTarget: { price: 0, pct: 0 },
      scalpExit: { price: 0, pct: 0 },
      expectedMovePct: 0,
      whyChips: [],
      whyText: pick.band === 'lottery' ? 'Book C. No model.' : pick.band === 'wing' ? 'Book B. Model 1 cleared. Model 2 runs the exit.' : pick.band === 'closest' ? pick.whyText : 'Book A. Model 1 cleared.',
    });
  };
  for (const [key, pick] of [...picks]) {
    const live = byId.get(pick.id);
    if (live) paint(picks, key, pick, live);
  }
  for (const [key, pick] of [...wingPicks]) {
    const live = byId.get(pick.id);
    if (live) paint(wingPicks, key, { ...pick, runner: true }, live);
  }
  for (const [key, pick] of [...lotteryPicks]) {
    const live = byId.get(pick.id);
    if (live) paint(lotteryPicks, key, pick, live);
  }
  for (const [key, pick] of [...nearPicks]) {
    const live = byId.get(pick.id);
    if (live) paint(nearPicks, key, pick, live);
  }
}

/** Book C. No booster. A missing tree does not close this window. No new ticket inside a high-impact release. */
export async function scoreLottery(setups: Setup[], now = Date.now()): Promise<void> {
  const clock = nyParts(now);
  const minute = clock.hour * 60 + clock.minute;
  if (!inLottery(minute, clock.second)) return;
  if (releaseShut(now)) return;
  const day = ymd(now);
  const byRoot = new Map<string, Setup[]>();
  for (const s of setups) {
    if (NO_DAILY.has(s.ticker) || seenRootC.has(s.ticker) || seen.has(s.id)) continue;
    if (weekdayDte(day, s.expiryDate) !== 0) continue;
    if (!lotteryEntry(s.bid, s.ask)) continue;
    const qMin = s.quotedAt ? minuteOf(s.quotedAt) : NaN;
    if (qMin !== minute) continue;
    const list = byRoot.get(s.ticker) ?? [];
    list.push(s);
    byRoot.set(s.ticker, list);
  }
  const ranked: Setup[] = [];
  for (const [ticker, list] of byRoot) {
    const strikes = [...new Set(list.map(s => s.strike))];
    const spot = list.find(s => (s.spot ?? 0) > 0)?.spot ?? 0;
    if (!(spot > 0)) continue;
    list.sort((a, b) => {
      const da = strikeDistance(strikes, spot, a.strike);
      const db = strikeDistance(strikes, spot, b.strike);
      if (da !== db) return da - db;
      if (a.strike !== b.strike) return a.strike - b.strike;
      return a.right === b.right ? 0 : a.right === 'C' ? -1 : 1;
    });
    const win = list[0];
    if (win) ranked.push(win);
    void ticker;
  }
  let open = lotteryPicks.size;
  for (const setup of ranked) {
    if (open >= LOTTERY_CAP || seenRootC.has(setup.ticker)) continue;
    seen.add(setup.id);
    seenRootC.add(setup.ticker);
    open += 1;
    lotteryPicks.set(setup.id, {
      ...setup,
      runner: false,
      modelAgree: false,
      better: 'entry',
      band: 'lottery',
      strength: false,
      seenAt: Date.now(),
      verdict: 'ENTER',
      score: 0,
      takeProfits: [],
      priceTargets: [],
      invalidationPrice: 0,
      invalidationReason: '',
      whyChips: [],
      whyText: 'Book C. No model.',
    });
  }
  persistCalls();
}

export async function scoreBook(setups: Setup[], now = Date.now(), merge = false): Promise<void> {
  await scoreAll(setups, now, merge);
}

let claimedSlot = -2;
const claimedSleeves = new Set<string>();

function scanSlot(now: number): number {
  const p = nyParts(now);
  const m = p.hour * 60 + p.minute;
  if (!sessionScanOpen(m, p.weekday)) return -1;
  if (m === 9 * 60 + 29 || m === 15 * 60 + 59 || m === 16 * 60 + 14) return 10_000 + m;
  return Math.floor(m / 5);
}

/** One full pass per sleeve per 5-minute slot. 0DTE and weekly do not steal each other's slot. */
export function claimSlot(now: number, sleeve: string): 'closed' | 'scan' | 'hold' {
  const next = scanSlot(now);
  if (next < 0) {
    if (claimedSlot !== -1) {
      claimedSlot = -1;
      claimedSleeves.clear();
    }
    return 'closed';
  }
  if (next !== claimedSlot) {
    claimedSlot = next;
    claimedSleeves.clear();
  }
  if (claimedSleeves.has(sleeve)) return 'hold';
  claimedSleeves.add(sleeve);
  return 'scan';
}

/** The tape was not in yet. The same slot may run again. */
export function releaseSlot(sleeve: string): void {
  claimedSleeves.delete(sleeve);
}

export interface LiveScore {
  p1: number | null;
  prun: number | null;
  retOpen: number | null;
  gex: number | null;
  seats: number;
  sentRoots: string[];
}

/** Seats already taken today. Book A and Book B share the five. */
export function seatsNow(): { seats: number; sentRoots: string[] } {
  const sentRoots = [...new Set([...seenRootA, ...seenRootB, ...seenRootC])];
  return { seats: new Set([...seenRootA, ...seenRootB]).size, sentRoots };
}

function weigherStub(ticker: string, strike: number, right: OptionRight, bid: number, ask: number, expiryIso: string): Setup {
  const mid = bid >= 0 && ask >= bid && ask > 0 ? (ask + bid) / 2 : 0;
  return {
    id: `w-${ticker}-${expiryIso}-${strike}-${right}`,
    ticker,
    contract: `${ticker} ${strike}${right}`,
    right,
    strike,
    expiry: expiryIso,
    expiryDate: expiryIso,
    sessionsLeft: 0,
    sigmaMovePct: 0,
    sleeve: 'odte',
    score: 0,
    verdict: 'WATCH',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, pct: 0 },
    scalpExit: { price: 0, pct: 0 },
    headline: '',
    whyChips: [],
    whyText: '',
    greeks: { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN },
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
    liquidityLabel: 'Normal',
    liquiditySpread: '',
    invalidationPrice: 0,
    invalidationReason: '',
  };
}

const liveScoreMemo = new Map<string, { at: number; p1: number | null; prun: number | null; retOpen: number | null; gex: number | null }>();

/** Model 1 and Model 2 on one live contract. The feature row is the scorer's own. A missing bar stays missing. No
    score is invented. */
export async function scoreLiveContract(input: {
  ticker: string;
  strike: number;
  right: OptionRight;
  expiryIso: string;
  bid: number;
  ask: number;
  spot: number;
  rows?: { strike: number; right: OptionRight; bid: number; ask: number }[];
  now?: number;
}): Promise<LiveScore> {
  const seats = seatsNow();
  const blank = { p1: null as number | null, prun: null as number | null, retOpen: null as number | null, gex: null as number | null, ...seats };
  const quoteOk = input.bid >= 0 && input.ask > input.bid && input.ask > 0;
  if (!quoteOk) return blank;
  const key = `${input.ticker}|${input.expiryIso}|${input.strike}|${input.right}|${input.bid}|${input.ask}`;
  const now = input.now ?? Date.now();
  const hit = liveScoreMemo.get(key);
  if (hit && now - hit.at < 20_000) return { ...hit, ...seatsNow() };
  try {
    if (!(await ensureModels()) || !modelsLocked()) return blank;
    const clock = nyParts(now);
    const minute = clock.hour * 60 + clock.minute;
    const day = ymd(now);
    const ticker = input.ticker;
    const under = UNDER[ticker] ?? printOf(ticker);
    const indexName = INDEX.has(ticker) || INDEX.has(under);
    const bars = await loadBars(under, day);
    const spy = under === 'SPY' ? bars : await loadBars('SPY', day);
    const etf = SECTOR_OF[under] ?? SECTOR_OF[ticker] ?? '';
    const sec = etf ? await loadBars(etf, day) : [];
    const prior = await loadPrior(under, day);
    const tape = tapeOf(bars, indexName, minute, input.spot);
    const retOpen = tape.S > 0 && tape.op > 0 ? tape.S / tape.op - 1 : null;
    if (!(tape.S > 0)) {
      const scored = { p1: null, prun: null, retOpen, gex: null };
      liveScoreMemo.set(key, { at: now, ...scored });
      return { ...scored, ...seatsNow() };
    }
    const mine = weigherStub(ticker, input.strike, input.right, input.bid, input.ask, input.expiryIso);
    mine.spot = tape.S;
    const mates = (input.rows ?? [])
      .filter(r => r.ask > r.bid && r.ask > 0 && r.bid >= 0)
      .map(r => weigherStub(ticker, r.strike, r.right, r.bid, r.ask, input.expiryIso));
    if (!mates.some(s => s.right === mine.right && Math.abs(s.strike - mine.strike) < 1e-6)) mates.push(mine);
    const horizon = yearsLeft(tape.tt);
    const { iv, skew } = atmPair(mates, tape.S, horizon);
    const pin = CORE.has(ticker) ? await pinOf(ticker, input.expiryIso, tape.S > 0 ? tape.S : input.spot) : null;
    noteMid(mine.id, minute, mine.mid);
    const raw = features(mine, minute, bars, spy, prior, iv, skew, sec, curveOf(under), pin, { m5: midThen(mine.id, minute - 5), m15: midThen(mine.id, minute - 15) });
    if (!raw) {
      const scored = { p1: null, prun: null, retOpen, gex: null };
      liveScoreMemo.set(key, { at: now, ...scored });
      return { ...scored, ...seatsNow() };
    }
    const x = f32(raw);
    const p1 = predict(ENTRY, x);
    const prun = predict(RUNNER, x);
    const gex = Number.isFinite(x[27]) ? x[27] : null;
    const scored = {
      p1: Number.isFinite(p1) ? p1 : null,
      prun: Number.isFinite(prun) ? prun : null,
      retOpen,
      gex,
    };
    liveScoreMemo.set(key, { at: now, ...scored });
    return { ...scored, ...seatsNow() };
  } catch {
    return blank;
  }
}

