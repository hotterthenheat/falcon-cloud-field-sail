/* Compass scorer. Books A and B call Model 1 (entry) and Model 2 (runner). Book C calls neither. A hash or
   tree-count miss scores nothing. */

import { firstNaN, nanUnsafeColumns, parseBoosters, predict, type Tree } from './lgbm';
import { compassHost } from './compassHost';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { nyYmd as ymd, sessionBefore, sessionCloseMinOn } from '../core/calendar';
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
  BOOK_B_LOOKBACK,
  LOTTERY_CAP,
  SESSION_MIN,
  YEAR_SESSIONS,
  QUOTE_MAX_AGE_MS,
  inLottery,
  releaseBlocks,
  thetaBurns,
  lotteryEntry,
  P1_MIN,
  WEEKLY_STRIKES,
  MODEL_1_NAME,
  MODEL_2_NAME,
  BOOK_NAME,
  entryTimeOk,
  flatTOf,
  inModelWindow,
  minutesToFlat,
  sessionKindOf,
  OVERNIGHT_ROOTS,
  OUTSIDE_TRAINED_WORD,
} from './compassParams';
import { COMPASS_TICKERS } from './compassUniverse';
import { optionScanOpen, sessionDayOpen, sessionIso, sessionYmd } from './compassSession';
import type { OptionRight, Setup } from '../types/compass';
import type { PathBar } from './compassOutcome';
import { CORE, INDEX, INPUT_NAMES, NO_DAILY, SECTOR_OF, UNDER, atmPair, curveFrom, features, tapeOf, yearsLeft, type Bar, type Curve, type PinBook } from './compassFeatures';

let ENTRY: Tree[] = [];
let RUNNER: Tree[] = [];
/* The columns each model never saw a NaN in and whose 0 (what LightGBM reads a NaN as there) lies outside the
   training range: a NaN in one of them walks a branch no training row took (lgbm.ts nanUnsafeColumns). */
let ENTRY_UNSAFE: number[] = [];
let RUNNER_UNSAFE: number[] = [];
let locked = false;
/* Empty until a load has been tried and failed: an unscored session is not a failed load. */
let lockText = '';
let loading: Promise<boolean> | null = null;

export function lockReason(): string {
  return lockText;
}

const lockFns = new Set<(text: string) => void>();

/** Called when the lock's reason changes ('' once the files verify): the server logs it. */
export function onLockReason(fn: (text: string) => void): () => void {
  lockFns.add(fn);
  return () => lockFns.delete(fn);
}

function setLock(text: string): void {
  if (text === lockText) return;
  lockText = text;
  for (const fn of lockFns) fn(text);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** One model file: its trees, or why it was refused (missing, a hash miss, not 300 numerical trees). */
async function loadOne(url: string, expect: string): Promise<{ trees: Tree[]; text: string } | string> {
  const bytes = await compassHost().asset(url);
  if (!bytes) return `${url} is missing`;
  const got = await sha256Hex(bytes);
  if (got !== expect) return `${url} hashes to ${got.slice(0, 12)}…, not ${expect.slice(0, 12)}…`;
  const text = new TextDecoder().decode(bytes);
  const trees = parseBoosters(text, TREE_N);
  return trees ? { trees, text } : `${url} is not ${TREE_N} numerical trees`;
}

async function ensureModels(): Promise<boolean> {
  if (locked) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await compassHost().asset('/config/universe_458.json');
      if (!raw) {
        setLock('Universe file missing. Scoring is closed.');
        return false;
      }
      if (await sha256Hex(raw) !== UNIVERSE_SHA) {
        setLock('Universe hash does not match. Scoring is closed.');
        return false;
      }
      const names = JSON.parse(new TextDecoder().decode(raw)) as unknown;
      if (!Array.isArray(names) || names.length !== UNIVERSE_N || names.some((n, i) => n !== COMPASS_TICKERS[i])) {
        setLock('Universe list does not match. Scoring is closed.');
        return false;
      }
      const entry = await loadOne('/models/model_entry_all6months.txt', ENTRY_SHA);
      const runner = await loadOne('/models/model_runner_all6months.txt', RUNNER_SHA);
      if (typeof entry === 'string' || typeof runner === 'string') {
        setLock(`The read failed its check (${[entry, runner].filter(v => typeof v === 'string').join('; ')}). Scoring is closed.`);
        return false;
      }
      ENTRY = entry.trees;
      RUNNER = runner.trees;
      ENTRY_UNSAFE = nanUnsafeColumns(entry.text);
      RUNNER_UNSAFE = nanUnsafeColumns(runner.text);
      locked = true;
      setLock('');
      return true;
    } catch {
      setLock('Model files could not be read. Scoring is closed.');
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
/* When each official Book A/B seat and contract was taken (the mark, epoch ms): a late mark is judged on the seats and
   contracts as they stood at its own mark, not on calls that fired after it. A pack from before these maps reads every
   seat as taken from the start of the session (the old rule). */
const rootAt = new Map<string, number>();
const seenMark = new Map<string, number>();
const seenRootC = new Set<string>();
/* A mark scored late is never an official call and never takes a seat. What it would have called is kept apart, one
   per contract and one per root and book a session, for the review and the study. */
const wouldSeen = new Set<string>();
const wouldRoot = { A: new Set<string>(), B: new Set<string>(), C: new Set<string>() };
/* The mark each "would have called" Book A/B root was noted at: a late mark counts them as seats taken at or before
   it, beside the official ones, so the would list is what the live book would have called (one book a
   root, no daily cap). It used to count official seats only and stop at five. */
const wouldRootAt = new Map<string, number>();
const wouldPicks = new Map<string, Setup>();

/** The calls late marks would have made (never official), not yet taken by the ledger. */
export function takeWouldPicks(): Setup[] {
  const out = [...wouldPicks.values()];
  wouldPicks.clear();
  return out;
}

/** The Book A/B seats taken at a mark: live, every official one so far; a late mark, the official ones taken at or
    before it and the would-have-called ones noted at or before it. */
export function heldSeatsAt(mark: number, late: boolean): Set<string> {
  const held = new Set<string>([...seenRootA, ...seenRootB].filter(t => !late || (rootAt.get(t) ?? 0) <= mark));
  if (late) for (const [t, at] of wouldRootAt) if (at <= mark) held.add(t);
  return held;
}

/** Notes what a late mark would have called (exported for the golden): one per contract, one book a root, a session. */
export function noteWould(setup: Setup, book: 'A' | 'B' | 'C'): boolean {
  const key = book === 'C' ? setup.ticker : `${setup.sleeve}|${setup.ticker}`;
  if (wouldSeen.has(setup.id) || wouldRoot[book].has(key) || wouldRoot[book].has(setup.ticker)) return false;
  /* Books A and B share a root's seat on a sleeve. The other sleeve can still call its own best. */
  if (book !== 'C' && (wouldRoot.A.has(key) || wouldRoot.B.has(key))) return false;
  wouldSeen.add(setup.id);
  wouldRoot[book].add(key);
  if (book !== 'C' && !wouldRootAt.has(key)) wouldRootAt.set(key, setup.mark ?? 0);
  wouldPicks.set(setup.id, setup);
  return true;
}

export interface LeftRow { id: string; ticker: string; contract: string; why: string; at: number }


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

/** An input the terminal did not answer (down, busy, a fault): the scan does not score on a partial row. */
class InputFault extends Error {}

/** A fault, as against an answer (rows, or ThetaData's "no data for this request"). */
const faulted = (got: { error: string | null }) => !!got.error && got.error !== 'no_data';

/** The last bar's minute is at least `need` (a live score needs minute t-1's bar: its high and low are in the range
    columns). A memo older than two seconds that ends earlier is read again once; a name that did not trade in t-1
    has no bar there, so a second read that still ends earlier is taken as it is. */
function barsReach(bars: readonly Bar[], day: string, need: number | undefined): boolean {
  if (need == null) return true;
  const last = bars[bars.length - 1];
  return !!last && last.d === day && last.m >= need;
}

async function loadBars(symbol: string, day: string, strict = false, need?: number): Promise<Bar[]> {
  const key = `${symbol}|${day}`;
  const hit = barMemo.get(key);
  /* a finished session's bars do not change; today's are read again after a minute, or sooner when the memo does not
     reach the minute the score needs */
  const finished = !!hit?.bars.length && day < ymd(Date.now());
  if (hit && (finished || (Date.now() - hit.at < 60_000 && (barsReach(hit.bars, day, need) || Date.now() - hit.at < 2_000)))) return hit.bars;
  const root = UNDER[symbol] ?? symbol;
  const index = INDEX.has(symbol) || INDEX.has(root);
  const path = index
    ? `/index/history/ohlc?symbol=${root}&start_date=${day}&end_date=${day}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${root}&start_date=${day}&end_date=${day}&interval=1m&format=json`;
  /* every name of a pass reads SPY's and its sector ETF's bars at once: one request answers them all */
  let job = barReads.get(key);
  if (!job) {
    job = compassHost().theta(path).finally(() => barReads.delete(key));
    barReads.set(key, job);
  }
  const got = await job;
  if (faulted(got)) {
    if (strict) throw new InputFault(path);
    return hit?.bars ?? [];
  }
  const memo = barMemo.get(key);
  if (memo && memo.at >= Date.now() - 50 && memo !== hit) return memo.bars;
  const bars = got.error ? [] : barsOf(got.data);
  barMemo.set(key, { at: Date.now(), bars });
  return bars;
}

const barReads = new Map<string, Promise<{ status: number; data: unknown; error: string | null }>>();

/** The scan's one-minute bar read (and memo), for the golden. */
export const minuteBars = (symbol: string, day: string, need?: number): Promise<Bar[]> => loadBars(symbol, day, false, need);

async function loadPrior(name: string, day: string, strict = false): Promise<{ h: number; l: number; c: number } | null> {
  const bars = await loadBars(name, priorSessionYmd(day), strict);
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

/** The underlying at an instant: the first print of that minute, else the last close before it (the scan's own bar
    read). NaN when the day has no bars yet. */
export async function underAt(ticker: string, at: number): Promise<number> {
  const bars = await loadBars(UNDER[ticker] ?? printOf(ticker), ymd(at));
  const minute = minuteOf(at);
  let last = NaN;
  for (const b of bars) {
    if (b.m === minute && b.o > 0) return b.o;
    if (b.m < minute) last = b.c;
  }
  return last;
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
  /* the sessions of the last three weeks before today, one day a request: a whole range of a busy name's minutes
     outlasts the terminal's answer time, and each finished day is kept once read */
  const first = ymd(now - 21 * 86400000);
  const days: string[] = [];
  for (let d = priorSessionYmd(sessionYmd(now)); d >= first && days.length < 30; d = priorSessionYmd(d)) days.push(d);
  const got: Bar[][] = [];
  for (let i = 0; i < days.length; i += 3) {
    got.push(...(await Promise.all(days.slice(i, i + 3).map(d => loadBars(symbol, d, true)))));
  }
  return curveFrom(got.reverse().flat());
}

const priceMemo = new Map<string, { at: number; job: Promise<number> }>();

/** The last trade of a stock or ETF now, shared by every name of a pass for three seconds (each name used to ask for
    SPY's and its sector's trade on its own). */
function priceNow(symbol: string): Promise<number> {
  const hit = priceMemo.get(symbol);
  if (hit && Date.now() - hit.at < 3_000) return hit.job;
  const job = readPrice(symbol);
  priceMemo.set(symbol, { at: Date.now(), job });
  return job;
}

/** The last trade of a stock or ETF now (ThetaData's trade snapshot), or NaN. */
async function readPrice(symbol: string): Promise<number> {
  const got = await compassHost().theta(`/stock/snapshot/trade?symbol=${encodeURIComponent(symbol)}&format=json`, true);
  if (got.error) return NaN;
  const row = (Array.isArray(got.data) ? got.data[0] : null) as Record<string, unknown> | null;
  const px = num(row?.price);
  const at = nyWallStamp(row?.timestamp);
  return px > 0 && at && Date.now() - at < 120_000 ? px : NaN;
}

const curveLoads = new Map<string, Promise<Curve | null>>();

/** The name's intraday volume curve over the prior sessions, read before the name is scored (a first scan of the
    day waits for it rather than score the two volume inputs as missing). */
async function curveFor(symbol: string, now: number): Promise<Curve | null> {
  if (INDEX.has(symbol)) return null;
  const key = `${symbol}|${sessionYmd(now)}`;
  if (curves.has(key)) return curves.get(key) ?? null;
  let job = curveLoads.get(key);
  if (!job) {
    job = fetchCurve(symbol, now);
    curveLoads.set(key, job);
  }
  let curve: Curve | null;
  try {
    curve = await job;
  } finally {
    curveLoads.delete(key);
  }
  if (curve) curves.set(key, curve);
  return curve;
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

/** The session's one-time reads for these names, in the background and two at a time: the prior session's bars and
    the volume curve (fifteen sessions of bars a name). A first mark used to wait on them inside its minute. */
export async function warmSession(names: readonly string[], now = Date.now()): Promise<void> {
  const unders = [...new Set(names.map(n => UNDER[n] ?? printOf(n)))];
  const day = sessionYmd(now);
  let i = 0;
  const run = async () => {
    while (i < unders.length) {
      const name = unders[i++];
      while (scanBusyFlag) await new Promise(resolve => setTimeout(resolve, 400));
      try {
        await loadPrior(name, day, false);
        await curveFor(name, now);
      } catch {
        /* the pass reads it itself */
      }
    }
  };
  await Promise.all([run(), run()]);
}

/** Open interest per strike of one expiry, from ThetaData's open-interest snapshot (one ask per name and expiry). */
async function pinOf(ticker: string, expiry: string, spot: number, strict = false): Promise<PinBook | null> {
  if (!CORE.has(ticker)) return null;
  /* open interest is the clearing house's overnight count, published early each morning (stamped 06:30 ET): one read
     per published count (an empty answer is asked again after five minutes). The key was the session, and a session
     starts at 20:15 the evening before, so a book read overnight was kept through the next regular session, one
     count stale; it is now the count's own day (from 07:00 ET, today's count). */
  const clock = nyParts(Date.now());
  const countDay = ymd(Date.now() - (clock.hour * 60 + clock.minute < 7 * 60 ? 86_400_000 : 0));
  const key = `${ticker}|${expiry}|${countDay}`;
  const hit = pinCache.get(key);
  if (hit && (hit.book || Date.now() - hit.at < 5 * 60_000)) return hit.book;
  const got = await compassHost().theta(`/option/snapshot/open_interest?symbol=${encodeURIComponent(ticker)}&expiration=${expiry.replace(/-/g, '').slice(0, 8)}&format=json`);
  if (strict && faulted(got)) throw new InputFault('open interest');
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
  /* the open interest does not depend on the spot: an empty answer is kept five minutes, a filled one for the session.
     A read with no spot (an overnight or pre-market mark, where the cash price is not in) used to keep "no book" for
     five minutes, so the marks read after it in those minutes scored with no open interest, gamma or walls */
  if (!byStrike.size) {
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

/** One scored row: the contract, the minute of the day and the mark it was scored at (epoch ms of its minute), the 56
    inputs as the trees read them, and both models' answers. */
export interface ScoredRow { setup: Setup; minute: number; mark: number; x: number[]; p1: number; prun: number | null; late: boolean }
const rowFns = new Set<(row: ScoredRow) => void>();

/** Every row the scan scores (the server's input check, scripts/compass-validate.ts). */
export function onScoredRow(fn: (row: ScoredRow) => void): () => void {
  rowFns.add(fn);
  return () => rowFns.delete(fn);
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

/** One seed window's quotes: contract id → minute of the day → bid and ask. The scan reads the mids 5 and 15 minutes
    back and Book B's ask 30 back from the window of its own mark, so a late mark of the morning is never short of
    them because later minutes filled the running lists. */
type SeedWindow = Map<string, Map<number, { bid: number; ask: number }>>;
const seedWindows = new Map<string, SeedWindow>();

/** One expiry's NBBO, one reading a minute, from 30 minutes before the scan's 5-minute mark through the mark (one ask
    for every strike of the name and expiry): the mids 5 and 15 minutes back and Book B's ask 30 minutes back come
    from the quotes that stood then, not only from the scans this tab happened to run. The window is fixed to the
    mark, so every viewer scanning the same slot asks the same path and the server shares one answer. */
async function seedQuotes(list: Setup[], now: number, strict = false): Promise<SeedWindow | null> {
  const first = list[0];
  if (!first?.expiryDate) return null;
  const clock = nyParts(now);
  const mark = Math.floor((clock.hour * 60 + clock.minute) / 5) * 5;
  const key = `${first.ticker}|${first.expiryDate}|${ymd(now)}|${mark}`;
  if (seededAt.has(key)) return seedWindows.get(key) ?? null;
  const byContract = new Map<string, string>();
  for (const s of list) byContract.set(`${s.strike}|${s.right}`, s.id);
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  /* The scan reads the quotes 5, 15 and 30 minutes back. On a 5-minute mark those are 5-minute points, and ThetaData's
     5-minute NBBO points are its 1-minute ones at those instants (checked: SPY 2026-10-29 10:00-10:30, 56 of 56
     equal), so the window is asked at 5 minutes: 7 points a contract, not 31. 09:29, 15:59 and 16:14 keep 1 minute.
     A weekly expiry reads Book B's band (to 17 strikes out); the same-day read stays at 16. */
  const step = clock.minute % 5 === 0 && mark === clock.hour * 60 + clock.minute ? 5 : 1;
  const weekly = first.expiryDate.slice(0, 10) !== sessionIso(now);
  const got = await compassHost().theta(`/option/history/quote?symbol=${encodeURIComponent(first.ticker)}&expiration=${first.expiryDate.replace(/-/g, '').slice(0, 8)}&start_date=${ymd(now)}&end_date=${ymd(now)}&strike_range=${weekly ? WEEKLY_STRIKES : 16}&interval=${step}m&start_time=${hm(Math.max(0, mark - 30))}&end_time=${hm(mark)}&format=json`);
  if (faulted(got)) {
    /* not marked as read: the next pass asks again, and a strict one does not score without it */
    if (strict) throw new InputFault('quotes 30 minutes back');
    return null;
  }
  seededAt.set(key, now);
  const win: SeedWindow = new Map();
  seedWindows.set(key, win);
  if (seededAt.size > 120) {
    for (const k of [...seededAt.keys()].slice(0, 60)) {
      seededAt.delete(k);
      seedWindows.delete(k);
    }
  }
  if (got.error) return win;
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
      const mine = win.get(id) ?? new Map<number, { bid: number; ask: number }>();
      mine.set(minuteOf(at), { bid, ask });
      win.set(id, mine);
    }
  }
  return win;
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

export interface ScanReport { best: number; prun: number; contract: string; ticker: string; scored: number; quiet: number; setup: Setup | null }
const emptyReport = (): ScanReport => ({ best: 0, prun: 0, contract: '', ticker: '', scored: 0, quiet: 0, setup: null });
const reports: Record<'odte' | 'weekly', ScanReport> = { odte: emptyReport(), weekly: emptyReport() };

export function scanReport(sleeve: 'odte' | 'weekly'): ScanReport {
  return reports[sleeve];
}

export function resetScanReport(sleeve: 'odte' | 'weekly'): void {
  reports[sleeve] = emptyReport();
}

/** Put a report back (a late mark's scoring does not replace the last live scan's report). */
export function setScanReport(sleeve: 'odte' | 'weekly', report: ScanReport): void {
  reports[sleeve] = report;
}

const nearPicks = new Map<string, Setup>();
const misses = new Map<string, { setup: Setup; p1: number; prun: number }>();
const kept = new Map<string, Setup>();

export interface PassLine {
  ticker: string;
  contract: string;
  p1: number;
  why: string;
  sleeve: string;
  /** The contract's expiration, YYYY-MM-DD. A line without one is from an older file and is not this session. */
  expiry?: string;
}

/** A closest or a pass that was on the board. Not an official call. */
export interface WatchedPass {
  ticker: string;
  contract: string;
  right: 'C' | 'P';
  strike: number;
  sleeve: string;
  p1: number | null;
  why: string;
  bid: number;
  ask: number;
  at: number;
  kind: 'closest' | 'passed';
}

const passBook = new Map<string, PassLine>();
const watched = new Map<string, WatchedPass>();

export function passLines(sleeve: 'odte' | 'weekly'): PassLine[] {
  return [...passBook.values()].filter(row => row.sleeve === sleeve).sort((a, b) => b.p1 - a.p1 || a.contract.localeCompare(b.contract));
}

/** Closest and passed contracts saved apart from Book A, B and C. Newest first. */
export function watchedPasses(): WatchedPass[] {
  return [...watched.values()].sort((a, b) => b.at - a.at || a.contract.localeCompare(b.contract));
}

function noteWatched(s: Setup, kind: 'closest' | 'passed', why: string, at: number): void {
  const key = `${s.sleeve}|${s.contract}`;
  const had = watched.get(key);
  const quoted = quoteValid(s.bid, s.ask);
  if (had && had.kind === 'closest' && kind === 'passed') {
    watched.set(key, {
      ...had,
      why: why || had.why,
      p1: s.p1 ?? had.p1,
      bid: quoted ? s.bid : had.bid,
      ask: quoted ? s.ask : had.ask,
    });
    return;
  }
  watched.set(key, {
    ticker: s.ticker,
    contract: s.contract,
    right: s.right === 'P' ? 'P' : 'C',
    strike: s.strike,
    sleeve: s.sleeve,
    p1: s.p1 ?? null,
    why: why || had?.why || '',
    bid: quoted ? s.bid : had?.bid ?? 0,
    ask: quoted ? s.ask : had?.ask ?? 0,
    at: had?.at || at || Date.now(),
    kind: had?.kind === 'closest' ? 'closest' : kind,
  });
}

function rememberPass(s: Setup, p1: number, why: string): void {
  const key = `${s.sleeve}|${s.contract}`;
  passBook.set(key, { ticker: s.ticker, contract: s.contract, p1, why, sleeve: s.sleeve, expiry: s.expiryDate });
  noteWatched({ ...s, p1 }, 'passed', why, s.quotedAt || s.seenAt || Date.now());
  const mine = [...passBook.entries()].filter(([, row]) => row.ticker === s.ticker && row.sleeve === s.sleeve);
  if (mine.length <= 50) return;
  mine.sort((a, b) => a[1].p1 - b[1].p1);
  passBook.delete(mine[0][0]);
}

function stampPassed(): void {
  const called = new Set<string>();
  for (const s of [...picks.values(), ...wingPicks.values(), ...lotteryPicks.values()]) called.add(`${s.sleeve}|${s.contract}`);
  for (const key of [...passBook.keys()]) if (called.has(key)) passBook.delete(key);
  for (const key of [...watched.keys()]) if (called.has(key)) watched.delete(key);
  for (const row of misses.values()) {
    const key = `${row.setup.sleeve}|${row.setup.contract}`;
    if (called.has(key)) continue;
    const had = passBook.get(key);
    const foreign = !had || had.why.startsWith(MODEL_1_NAME) || had.why.startsWith('Short of the line') || had.why.startsWith('The line cleared') || /^[A-Z]{1,6}\s+\d/.test(had.why);
    const why = foreign
      ? (row.p1 + 1e-12 < P1_MIN ? `Short of the line. A call needs ${(P1_MIN * 100).toFixed(2)}%.` : 'The line cleared. This root was already called, or this was not its best contract.')
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

/** The engine's state for one session: the cards, the passes, the seats taken and every contract already called.
    The server keeps it in the day's record file (data/compassServer.ts); a browser takes it from /api/compass/state. */
export type ModelPack = {
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
  /** The mark each Book A/B root's seat was taken at (epoch ms) */
  rootAt?: [string, number][];
  /** The mark each contract was called at (epoch ms) */
  seenMark?: [string, number][];
  rootC?: string[];
  scanned?: { odte?: number; weekly?: number };
  misses?: [string, { setup: Setup; p1: number; prun: number }][];
  left?: LeftRow[];
  passed?: [string, string[]][];
  /** Closest and passed kept apart from official calls */
  watched?: WatchedPass[];
  reports?: { odte?: ScanReport; weekly?: ScanReport };
  wouldSeen?: string[];
  wouldRoot?: { A?: string[]; B?: string[]; C?: string[] };
  /** The mark each would-have-called Book A/B root was noted at (epoch ms) */
  wouldRootAt?: [string, number][];
};

/** The session the engine's state belongs to: after 20:15 ET it is the next trading day's. */
const dayKey = (at = Date.now()) => sessionYmd(at);

/** The last session's scan, kept to show (stamped) until today's first pass lands. It is never scored or traded. */
let earlier: { day: string; at: number; setups: Setup[] } | null = null;

export function earlierScan(): { day: string; at: number; setups: Setup[] } | null {
  return earlier;
}

let stateDay = dayKey();
const changeFns = new Set<() => void>();

/** Called after every change the engine makes to its state (the server writes the record). */
export function onModelChange(fn: () => void): () => void {
  changeFns.add(fn);
  return () => changeFns.delete(fn);
}

function persistCalls(): void {
  for (const fn of changeFns) fn();
}

export function modelDay(): string {
  return stateDay;
}

export function exportModelState(): ModelPack {
  return {
    day: stateDay,
    picks: [...picks.entries()],
    wings: [...wingPicks.entries()],
    lottery: [...lotteryPicks.entries()],
    kept: [...kept.entries()],
    near: [...nearPicks.entries()],
    pass: [...passBook.values()],
    seen: [...seen],
    rootA: [...seenRootA],
    rootB: [...seenRootB],
    rootAt: [...rootAt],
    seenMark: [...seenMark],
    rootC: [...seenRootC],
    scanned: { ...scannedAt },
    misses: [...misses.entries()],
    left: [...left.values()],
    passed: [...passed.entries()],
    watched: [...watched.values()],
    reports: { odte: reports.odte, weekly: reports.weekly },
    wouldSeen: [...wouldSeen],
    wouldRoot: { A: [...wouldRoot.A], B: [...wouldRoot.B], C: [...wouldRoot.C] },
    wouldRootAt: [...wouldRootAt],
  };
}

function clearState(): void {
  for (const m of [picks, wingPicks, lotteryPicks, kept, nearPicks, passBook, misses, left, passed, watched, rootAt, seenMark, wouldRootAt]) m.clear();
  for (const set of [seen, seenRootA, seenRootB, seenRootC, wouldSeen, wouldRoot.A, wouldRoot.B, wouldRoot.C]) set.clear();
  wouldPicks.clear();
  scannedAt.odte = 0;
  scannedAt.weekly = 0;
  reports.odte = emptyReport();
  reports.weekly = emptyReport();
}

/** Replace the state with a kept or served one. A pack from another session is shown as the earlier scan only. */
/** A contract that expired before this session is not a score, a miss, or a card. */
function deadExpiry(expiryDate: string | undefined, day = stateDay): boolean {
  const exp = (expiryDate || '').replace(/-/g, '');
  const d = (day || '').replace(/-/g, '');
  return exp.length === 8 && d.length === 8 && exp < d;
}

export function importModelState(pack: ModelPack | null, earlierScanned: { day: string; at: number; setups: Setup[] } | null = earlier): void {
  clearState();
  earlier = earlierScanned;
  if (!pack) return;
  if (pack.day) stateDay = pack.day;
  const day = pack.day || stateDay;
  const live = (s: { expiryDate?: string } | null | undefined) => !!s && !deadExpiry(s.expiryDate, day);
  for (const [k, v] of pack.picks ?? []) if (v && v.id && live(v)) picks.set(k, v);
  for (const [k, v] of pack.wings ?? []) if (v && v.id && live(v)) wingPicks.set(k, v);
  for (const [k, v] of pack.lottery ?? []) if (v && v.id && live(v)) lotteryPicks.set(k, v);
  for (const [k, v] of pack.kept ?? []) if (v && v.id && live(v)) kept.set(k, v);
  for (const [k, v] of pack.near ?? []) if (v && v.id && live(v)) nearPicks.set(k, v);
  for (const row of pack.pass ?? []) if (row && row.ticker && row.contract && row.expiry && !deadExpiry(row.expiry, day)) passBook.set(`${row.sleeve}|${row.contract}`, row);
  if (pack.watched) {
    for (const row of pack.watched) if (row && row.ticker && row.contract && row.sleeve) watched.set(`${row.sleeve}|${row.contract}`, row);
  } else {
    for (const row of pack.pass ?? []) {
      if (!row || !row.ticker || !row.contract || !row.sleeve) continue;
      const strike = Number(String(row.contract).replace(/^[A-Za-z]+\s+/, '').replace(/[CP]$/i, ''));
      watched.set(`${row.sleeve}|${row.contract}`, {
        ticker: row.ticker,
        contract: row.contract,
        right: row.contract.endsWith('P') ? 'P' : 'C',
        strike: Number.isFinite(strike) ? strike : 0,
        sleeve: row.sleeve,
        p1: row.p1,
        why: row.why,
        bid: 0,
        ask: 0,
        at: 0,
        kind: 'passed',
      });
    }
    for (const [, v] of pack.near ?? []) {
      if (v && v.id && v.band === 'closest') noteWatched(v, 'closest', v.whyText || 'Not a call.', v.seenAt || v.quotedAt || 0);
    }
  }
  for (const id of pack.seen ?? []) seen.add(id);
  const seatIn = (into: Set<string>, t: string) => {
    if (t.includes('|')) { into.add(t); return; }
    const sleeves = new Set((pack.seen ?? []).filter(id => id.startsWith(`${t}-`)).map(id => (id.endsWith('-weekly') ? 'weekly' : id.endsWith('-odte') ? 'odte' : '')));
    sleeves.delete('');
    if (sleeves.size) for (const s of sleeves) into.add(`${s}|${t}`);
    else into.add(t);
  };
  for (const t of pack.rootA ?? []) seatIn(seenRootA, t);
  for (const t of pack.rootB ?? []) seatIn(seenRootB, t);
  for (const [t, at] of pack.rootAt ?? []) if (typeof t === 'string' && Number.isFinite(at)) rootAt.set(t, at);
  for (const [id, at] of pack.seenMark ?? []) if (typeof id === 'string' && Number.isFinite(at)) seenMark.set(id, at);
  for (const t of pack.rootC ?? []) seenRootC.add(t);
  for (const [k, v] of pack.misses ?? []) if (v && v.setup && live(v.setup)) misses.set(k, v);
  for (const row of pack.left ?? []) if (row && row.id) left.set(row.id, row);
  for (const [k, v] of pack.passed ?? []) if (Array.isArray(v)) passed.set(k, v);
  if (pack.reports?.odte) reports.odte = pack.reports.odte;
  if (pack.reports?.weekly) reports.weekly = pack.reports.weekly;
  scannedAt.odte = pack.scanned?.odte ?? 0;
  scannedAt.weekly = pack.scanned?.weekly ?? 0;
  for (const id of pack.wouldSeen ?? []) wouldSeen.add(id);
  for (const b of ['A', 'B', 'C'] as const) for (const t of pack.wouldRoot?.[b] ?? []) wouldRoot[b].add(t);
  for (const [t, at] of pack.wouldRootAt ?? []) if (typeof t === 'string' && Number.isFinite(at)) wouldRootAt.set(t, at);
}

/** Calls once made from a late mark (before late marks stopped calling): they are what a late mark would have
    called. Their seats and contracts go back to the official book. */
export function demoteLate(calls: readonly { id: string; ticker: string; book: 'A' | 'B' | 'C'; mark?: number }[], liveRoots: { A: Set<string>; B: Set<string>; C: Set<string> }): void {
  for (const c of calls) {
    seen.delete(c.id);
    seenMark.delete(c.id);
    const roots = c.book === 'A' ? seenRootA : c.book === 'B' ? seenRootB : seenRootC;
    if (!liveRoots[c.book].has(c.ticker)) {
      roots.delete(c.ticker);
      if (!liveRoots.A.has(c.ticker) && !liveRoots.B.has(c.ticker)) rootAt.delete(c.ticker);
    }
    for (const m of [picks, wingPicks, lotteryPicks, nearPicks]) for (const [k, v] of m) if (v.id === c.id) m.delete(k);
    wouldSeen.add(c.id);
    wouldRoot[c.book].add(c.ticker);
    if (c.book !== 'C' && !wouldRootAt.has(c.ticker)) wouldRootAt.set(c.ticker, c.mark ?? 0);
  }
  persistCalls();
}

/** A new session: nothing called, every seat free. The session that ended is kept to show until the first pass. */
export function rollModelDay(day: string): void {
  if (day === stateDay) return;
  const setups = [...picks.values(), ...wingPicks.values(), ...lotteryPicks.values(), ...nearPicks.values()];
  const at = Math.max(scannedAt.odte, scannedAt.weekly);
  const was = setups.length || at ? { day: stateDay, at, setups } : earlier;
  importModelState(null, was);
  stateDay = day;
  seenAsks.clear();
  seenMids.clear();
  pruneMemos(day);
  persistCalls();
}

/** The session memos the engine no longer needs, dropped at the roll: they used to grow for the life of the process
    (every name's minute bars of every day read, a volume curve and an open-interest book per name and day). Kept: the
    bars of the last 40 days (the volume curve reads three weeks back), today's curves, the last two counts' books. */
function pruneMemos(day: string): void {
  const oldest = ymd(Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00Z`) - 40 * 86_400_000);
  for (const key of [...barMemo.keys()]) if ((key.split('|')[1] ?? '') < oldest) barMemo.delete(key);
  for (const key of [...curves.keys()]) if (key.split('|')[1] !== day) curves.delete(key);
  const twoBack = ymd(Date.now() - 2 * 86_400_000);
  for (const key of [...pinCache.keys()]) if ((key.split('|')[2] ?? '') < twoBack) pinCache.delete(key);
  liveScoreMemo.clear();
  priceMemo.clear();
}

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
    if (s.sleeve !== sleeve || !(p1 >= 0) || deadExpiry(s.expiryDate)) return;
    const had = out.get(s.ticker);
    if (!had || p1 > had.p1) out.set(s.ticker, { p1, contract: s.contract, id: s.id });
  };
  for (const row of misses.values()) take(row.setup, row.p1);
  for (const s of [...picks.values(), ...wingPicks.values()]) take(s, s.p1 ?? -1);
  for (const row of passBook.values()) {
    if (row.sleeve !== sleeve || !(row.p1 > 0) || !row.expiry || deadExpiry(row.expiry)) continue;
    const had = out.get(row.ticker);
    if (!had || row.p1 > had.p1) out.set(row.ticker, { p1: row.p1, contract: row.contract, id: had?.contract === row.contract ? had.id : '' });
  }
  return out;
}

/** Best scored miss per name. A later slice does not erase a higher one. */
function noteMiss(s: Setup, p1: number, prun: number | null): void {
  if (!(p1 >= 0) || deadExpiry(s.expiryDate)) return;
  const key = `${s.sleeve}|${s.ticker}`;
  const had = misses.get(key);
  if (had && had.p1 >= p1) return;
  misses.set(key, { setup: s, p1, prun: prun ?? 0 });
}

const CLOSEST_CAP = 8;

/** The eight highest misses on this sleeve that are not already a call. They stay until an exit. */
export function commitClosest(sleeve: 'odte' | 'weekly', at = Date.now()): void {
  for (const [k, p] of [...nearPicks]) if (p.sleeve === sleeve && deadExpiry(p.expiryDate)) nearPicks.delete(k);
  for (const [k, row] of [...misses]) if (row.setup.sleeve === sleeve && deadExpiry(row.setup.expiryDate)) misses.delete(k);
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
      seenAt: at,
      verdict: 'WATCH',
      score: 0,
      takeProfits: [],
      priceTargets: [],
      invalidationPrice: 0,
      invalidationReason: '',
      whyText: row.p1 + 1e-12 < P1_MIN ? `Short of the line. A call needs ${(P1_MIN * 100).toFixed(2)}%.` : 'The line cleared. This root was already called, or this was not its best contract.',
    };
    nearPicks.set(s.id, card);
    noteWatched(card, 'closest', card.whyText, at);
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
  for (const ev of compassHost().econ()) {
    const parts = String(ev.time || '').split(':');
    const hh = Number(parts[0]);
    const mm = Number(parts[1] ?? 0);
    if (!Number.isFinite(hh)) continue;
    if (!(ev.date instanceof Date) || Number.isNaN(ev.date.getTime())) continue;
    /* the release's New York wall date is held in the Date's local fields (data/monthCalendar.ts) */
    const evDay = `${ev.date.getFullYear()}-${String(ev.date.getMonth() + 1).padStart(2, '0')}-${String(ev.date.getDate()).padStart(2, '0')}`;
    if (evDay === today && releaseBlocks(ev.title, hh * 60 + mm, minute)) return true;
  }
  return false;
}

/** The session's early close (minute of the day) or null, for the entry gate and the theta burn's flat. The scan sets
    it with the ledger's (compassScan readClose); unset, the core calendar's close for the day stands. */
let scoreClose: { day: string; min: number | null } | null = null;

export function setScoreClose(day: string, min: number | null): void {
  scoreClose = { day, min };
}

function closeOn(day: string): number | null {
  if (scoreClose && scoreClose.day === day) return scoreClose.min;
  const m = sessionCloseMinOn(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`);
  return m < 16 * 60 ? m : null;
}

/** 'scored' (the rows went through the books; a release window or a shut tape is also a pass), 'fault' (an input
    the terminal did not answer: nothing was scored, the name is scored again), 'locked' (the model files failed). */
export type ScoreResult = 'scored' | 'fault' | 'locked';

/** Model 1 and Model 2 on one row. A model whose NaN-unsafe column (lgbm.ts nanUnsafeColumns) is NaN in the row is
    not scored: LightGBM would read the NaN as 0, a value no training row had there (realised vol 0, range
    compression 0, gamma/|theta| 0), and walk a branch no training row took. Model 1 unscored means no call; Model 2
    unscored means prun is null and Book A does not ride. */
export function scoreRow(x: readonly number[]): { p1: number | null; prun: number | null; why: string } {
  const bad1 = firstNaN(x, ENTRY_UNSAFE);
  if (bad1 >= 0) return { p1: null, prun: null, why: `${MODEL_1_NAME} not scored: ${INPUT_NAMES[bad1]} (input ${bad1}) is not defined yet.` };
  const p1 = predict(ENTRY, x);
  const bad2 = firstNaN(x, RUNNER_UNSAFE);
  if (bad2 >= 0) return { p1, prun: null, why: `${MODEL_2_NAME} not scored: ${INPUT_NAMES[bad2]} (input ${bad2}) is not defined yet.` };
  return { p1, prun: predict(RUNNER, x), why: '' };
}

async function scoreAll(setups: Setup[], now: number, merge = false, late = false): Promise<ScoreResult> {
  try {
    return await scoreRows(setups, now, merge, late);
  } catch (e) {
    if (e instanceof InputFault) return 'fault';
    throw e;
  }
}

async function scoreRows(setups: Setup[], now: number, merge: boolean, late: boolean): Promise<ScoreResult> {
  if (!(await ensureModels()) || !modelsLocked()) return 'locked';
  /* a live call is stamped when it is made; a late one at its mark. Both carry the mark they belong to. */
  const stamp = () => (late ? now : Date.now());
  const mark = Math.floor(now / 60_000) * 60_000;
  const clock = nyParts(now);
  const minute = clock.hour * 60 + clock.minute;
  if (!merge && !(sessionScanOpen(minute, clock.weekday) && sessionDayOpen(now))) return 'scored';
  if (releaseShut(now)) return 'scored';
  const blocked = new Set<string>(DO_NOT_REQUEST);
  const day = sessionYmd(now);
  const rows = setups.filter(s => {
    if (blocked.has(s.ticker)) return false;
    const dte = weekdayDte(day, s.expiryDate);
    if (!(dte >= 0 && dte <= 7)) return false;
    if (dte === 0 && NO_DAILY.has(s.ticker)) return false;
    return optionScanOpen(s.ticker, dte, now);
  });
  if (!rows.length) return 'scored';
  const names = [...new Set(rows.map(s => UNDER[s.ticker] ?? printOf(s.ticker)))];
  /* a live score reads minute t-1's bar (the day range, the returns): a memo up to a minute old may not have it yet */
  const need = !late && minute - 1 >= 9 * 60 + 30 && minute - 1 < 16 * 60 ? minute - 1 : undefined;
  const book = new Map<string, Bar[]>();
  await Promise.all(names.map(async name => { book.set(name, await loadBars(name, day, true, need)); }));
  const spy = await loadBars('SPY', day, true, need);
  const etfs = [...new Set(names.map(name => SECTOR_OF[name]).filter(Boolean))];
  const secBars = new Map<string, Bar[]>();
  await Promise.all(etfs.map(async etf => { secBars.set(etf, await loadBars(etf, day, true, need)); }));
  const flatT = flatTOf(closeOn(day));
  /* a late mark is judged on the seats and contracts as they stood at its mark */
  const calledBy = (id: string) => seen.has(id) && (!late || (seenMark.get(id) ?? 0) <= mark);
  /* a live scan reads SPY's and the sector ETFs' price at the mark: their minute bar is not in yet */
  const marks = new Map<string, number>();
  if (!late) {
    await Promise.all(['SPY', ...etfs].map(async name => {
      const px = await priceNow(name);
      if (px > 0) marks.set(name, px);
    }));
  }
  const pd = new Map<string, { h: number; l: number; c: number } | null>();
  await Promise.all(names.map(async name => { pd.set(name, await loadPrior(name, day, true)); }));
  const pins = new Map<string, PinBook | null>();
  const wanted = new Map<string, { ticker: string; expiry: string; spot: number }>();
  for (const s of rows) {
    if (!CORE.has(s.ticker)) continue;
    const key = `${s.ticker}|${s.expiryDate}`;
    if (!wanted.has(key)) wanted.set(key, { ticker: s.ticker, expiry: s.expiryDate, spot: s.spot ?? 0 });
  }
  await Promise.all([...wanted].map(async ([key, row]) => {
    pins.set(key, await pinOf(row.ticker, row.expiry, row.spot, true));
  }));
  const groups = new Map<string, Setup[]>();
  for (const s of rows) {
    const key = `${s.ticker}|${s.expiryDate}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  const windows = new Map<string, SeedWindow | null>();
  await Promise.all([...groups].map(async ([key, list]) => { windows.set(key, await seedQuotes(list, now, true)); }));
  /* a minute's quote from the mark's own window first, else what the scans saw */
  const seeded = (s: Setup, m: number) => windows.get(`${s.ticker}|${s.expiryDate}`)?.get(s.id)?.get(m) ?? null;
  const midBack = (s: Setup, m: number) => {
    const q = seeded(s, m);
    return q ? (q.bid + q.ask) / 2 : midThen(s.id, m);
  };
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
  const aPool: { setup: Setup; p1: number; prun: number | null; gex: number; retOpen: number }[] = [];
  const bPool: { setup: Setup; p1: number; prun: number | null; gex: number; retOpen: number }[] = [];
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
    const curve = await curveFor(under, now);
    /* the session the mark is in (overnight for the index roots, pre-market for the equity options, regular, curb):
       the entry gate and the call's flat are that session's */
    const overnightRoot = OVERNIGHT_ROOTS.includes(ticker);
    const left = minutesToFlat(tape.tt, flatT, overnightRoot);
    const session = sessionKindOf(tape.tt, flatT, overnightRoot) ?? undefined;
    const trained = inModelWindow(tape.tt);
    const notes: string[] = [];
    const scoredP = new Map<string, number>();
    const lineWhy = (p: number) => (p + 1e-12 < P1_MIN
      ? `Short of the line. A call needs ${(P1_MIN * 100).toFixed(2)}%.`
      : 'The line cleared. This root was already called, or this was not its best contract.');
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
      const raw = features({ ...s, mid }, minute, book.get(under) ?? [], spy, pd.get(under) ?? null, iv, skew, sec, curve, pin, { m5: midBack(s, minute - 5), m15: midBack(s, minute - 15) }, { spy: marks.get('SPY'), sec: etf ? marks.get(etf) : undefined });
      if (!raw) continue;
      const x = f32(raw);
      const scored = scoreRow(x);
      if (scored.p1 == null) {
        notes.push(`${word} ${scored.why}`);
        continue;
      }
      const p1 = scored.p1;
      const prun = scored.prun;
      for (const fn of rowFns) fn({ setup: s, minute, mark, x, p1, prun, late });
      report.scored += 1;
      if (p1 > report.best) {
        report.best = p1;
        report.prun = prun ?? 0;
        report.contract = word;
        report.ticker = s.ticker;
        report.setup = { ...s, p1, prun: prun ?? undefined, seenAt: undefined };
      }
      noteMiss(s, p1, prun);
      if (!entryTimeOk(tape.tt, flatT, overnightRoot)) {
        notes.push(`${word} is outside this root's session`);
        continue;
      }
      /* the decay to this session's flat (was the regular flat for every mark) */
      const dt = Math.max(0, left - 1) / (SESSION_MIN * YEAR_SESSIONS);
      if (thetaBurns(x[39], x[38], s.ask, dt)) {
        notes.push(`${word} theta burns the stop before the flat`);
        continue;
      }
      if (calledBy(s.id)) {
        notes.push(`${word} already called today`);
        continue;
      }
      const dist = strikeDistance(list.map(row => row.strike), tape.S, s.strike);
      const span = strikeSpan(tape.S, list.map(row => row.strike), SPAN_INDEX.includes(s.ticker as typeof SPAN_INDEX[number]));
      const prior = seeded(s, minute - BOOK_B_LOOKBACK) ?? quoteAt(s.id, minute - BOOK_B_LOOKBACK);
      const retOpen = tape.op > 0 && tape.S > 0 ? tape.S / tape.op - 1 : NaN;
      const flatAt = mark + left * 60_000;
      const row = { setup: { ...s, tapeSession: session, outsideTrained: !trained || undefined, flatAt }, p1, prun, gex: x[27], retOpen };
      if (bookAPass(tape.tt, dist, span, dte, s.bid, s.ask, p1, flatT, overnightRoot)) aPool.push(row);
      else if (prior && bookBPass(tape.tt, dist, span, dte, s.bid, s.ask, prior.bid, prior.ask, p1, flatT, overnightRoot)) bPool.push(row);
      else if (!prior && dist > span) notes.push(`${word} has no quote from 30 minutes earlier`);
      notes.push(`${word} ${lineWhy(p1)}${prun == null ? ` ${scored.why}` : ''}`);
      scoredP.set(word, p1);
    }
    passed.set(ticker, notes.slice(0, 6));
    for (const note of notes) {
      const cut = note.indexOf(' ', note.indexOf(' ') + 1);
      if (cut < 0) continue;
      const contract = note.slice(0, cut);
      const hit = list.find(s => s.contract === contract);
      if (!hit) continue;
      const pct = scoredP.get(hit.contract);
      rememberPass(hit, pct ?? 0, note.slice(cut + 1));
    }
  }
  type Row = { setup: Setup; p1: number; prun: number | null; gex: number; retOpen: number; book: 'A' | 'B' };
  const choose = (pool: { setup: Setup; p1: number; prun: number | null; gex: number; retOpen: number }[], book: 'A' | 'B'): Row[] => {
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
  /* one call per root for the session: the best contract that clears, whenever it clears, on 0DTE or 1–7 DTE.
     A later name is not blocked because five earlier roots already fired. */
  const heldRoots = heldSeatsAt(mark, late);
  const cands = [...choose(aPool, 'A'), ...choose(bPool, 'B')].sort((a, b) => {
    const ad = Number.isFinite(a.retOpen) && Math.abs(a.retOpen) >= DRIVE ? 1 : 0;
    const bd = Number.isFinite(b.retOpen) && Math.abs(b.retOpen) >= DRIVE ? 1 : 0;
    return bd - ad || b.p1 - a.p1;
  });
  const anyDrive = cands.some(r => Number.isFinite(r.retOpen) && Math.abs(r.retOpen) >= DRIVE);
  for (const row of cands) {
    const drive = Number.isFinite(row.retOpen) && Math.abs(row.retOpen) >= DRIVE;
    if (anyDrive && !drive) continue;
    if (heldRoots.has(`${row.setup.sleeve}|${row.setup.ticker}`) || heldRoots.has(row.setup.ticker) || calledBy(row.setup.id)) continue;
    if (late) {
      /* it clears every gate the official book stood at, but a late mark calls nothing and takes no official seat:
         its would-seat is counted here and at the later late marks (wouldRootAt) */
      const run = row.book === 'B' || (row.prun != null && runnerFlag(row.prun));
      const noted = noteWould({
        ...row.setup,
        p1: row.p1,
        prun: row.prun ?? undefined,
        runner: run,
        band: row.book === 'A' ? 'top' : 'wing',
        seenAt: now,
        mark,
        late: true,
        verdict: 'WATCH',
        whyText: `Would have called (${BOOK_NAME[row.book]}), scored late from recorded quotes. Not a call.${row.setup.outsideTrained ? ` ${OUTSIDE_TRAINED_WORD}.` : ''}`,
      }, row.book);
      if (noted) heldRoots.add(`${row.setup.sleeve}|${row.setup.ticker}`);
      continue;
    }
    const seatKey = `${row.setup.sleeve}|${row.setup.ticker}`;
    heldRoots.add(seatKey);
    seenMark.set(row.setup.id, mark);
    if (!rootAt.has(seatKey)) rootAt.set(seatKey, mark);
    if (!rootAt.has(row.setup.ticker)) rootAt.set(row.setup.ticker, mark);
    if (row.book === 'A') {
      /* no Model 2 (an input it never saw missing is missing): no runner */
      const run = row.prun != null && runnerFlag(row.prun);
      seen.add(row.setup.id);
      seenRootA.add(seatKey);
      next.set(slotOf(row.setup), {
        ...row.setup,
        p1: row.p1,
        prun: row.prun ?? undefined,
        runner: run,
        modelAgree: false,
        better: run ? 'runner' : 'entry',
        band: 'top',
        strength: false,
        seenAt: stamp(),
        mark,
        ...(late ? { late: true } : {}),
        verdict: 'ENTER',
        score: 0,
        takeProfits: [],
        priceTargets: [],
        invalidationPrice: 0,
        invalidationReason: '',
        whyText: `${row.prun == null ? `The math passes. ${MODEL_2_NAME} not scored, so the exit does not ride.` : 'The math passes.'}${row.setup.outsideTrained ? ` ${OUTSIDE_TRAINED_WORD}.` : ''}`,
      });
    } else {
      seen.add(row.setup.id);
      seenRootB.add(seatKey);
      wingNext.set(row.setup.id, {
        ...row.setup,
        p1: row.p1,
        prun: row.prun ?? undefined,
        runner: true,
        modelAgree: false,
        better: 'runner',
        band: 'wing',
        strength: false,
        seenAt: stamp(),
        mark,
        ...(late ? { late: true } : {}),
        verdict: 'ENTER',
        score: 0,
        takeProfits: [],
        priceTargets: [],
        invalidationPrice: 0,
        invalidationReason: '',
        whyText: `The math passes. The exit rides.${row.setup.outsideTrained ? ` ${OUTSIDE_TRAINED_WORD}.` : ''}`,
      });
    }
  }
  picks.clear();
  for (const [key, pick] of next) picks.set(key, pick);
  wingPicks.clear();
  for (const [key, pick] of wingNext) wingPicks.set(key, pick);
  stampPassed();
  persistCalls();
  return 'scored';
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
      whyText: pick.band === 'lottery' ? 'Book C. No score.' : pick.band === 'wing' ? 'The math passes. The exit rides.' : pick.band === 'closest' ? pick.whyText : 'The math passes.',
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
export async function scoreLottery(setups: Setup[], now = Date.now(), late = false): Promise<void> {
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
  /* a late sweep counts its own would-calls against the five (it used to note every root's pick) */
  let open = late ? lotteryPicks.size + wouldRoot.C.size : lotteryPicks.size;
  for (const setup of ranked) {
    if (open >= LOTTERY_CAP || seenRootC.has(setup.ticker)) continue;
    if (late) {
      if (noteWould({ ...setup, runner: false, band: 'lottery', seenAt: now, mark: Math.floor(now / 60_000) * 60_000, late: true, verdict: 'WATCH', whyText: `Would have called (${BOOK_NAME.C}), scored late from recorded quotes. Not a call.` }, 'C')) open += 1;
      continue;
    }
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
      seenAt: late ? now : Date.now(),
      mark: Math.floor(now / 60_000) * 60_000,
      ...(late ? { late: true } : {}),
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

export async function scoreBook(setups: Setup[], now = Date.now(), merge = false, late = false): Promise<ScoreResult> {
  return scoreAll(setups, now, merge, late);
}

let claimedSlot = -2;
const claimedSleeves = new Set<string>();

function scanSlot(now: number): number {
  const p = nyParts(now);
  const m = p.hour * 60 + p.minute;
  if (!sessionScanOpen(m, p.weekday) || !sessionDayOpen(now)) return -1;
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

/** Roots already called today. One call per root on each sleeve (0DTE and 1–7 DTE), with no daily cap. */
export function seatsNow(): { seats: number; sentRoots: string[] } {
  /* in a browser the seats are the server engine's: read them when nothing on the page holds the feed */
  if (!compassHost().server && typeof window !== 'undefined') void import('./compassFeed').then(m => m.refreshCompassSoon());
  const sentRoots = [...new Set([...seenRootA, ...seenRootB, ...seenRootC])];
  const names = new Set<string>();
  for (const k of [...seenRootA, ...seenRootB]) names.add(k.includes('|') ? k.slice(k.indexOf('|') + 1) : k);
  return { seats: names.size, sentRoots };
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
    const both = scoreRow(x);
    const p1 = both.p1 ?? NaN;
    const prun = both.prun ?? NaN;
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

