/* Compass scorer. Books A and B call Model 1 (entry) and Model 2 (runner). Book C calls neither. A hash or
   tree-count miss scores nothing. */

import { parseBoosters, predict, type Tree } from './lgbm';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp } from '../core/nyTime';
import { isTradingDay } from '../core/calendar';
import { ensureBook, snapshotOf } from './uwBook';
import { econReleases } from './monthCalendar';
import {
  R,
  Q,
  IV_LO,
  IV_HI,
  IV_BISECTS,
  IV_FEATURE_MIN,
  GEX_CORE,
  DO_NOT_REQUEST,
  NO_SAME_DAY,
  CLS_INDEX,
  CLS_HIGHBETA,
  ENTRY_SHA,
  RUNNER_SHA,
  TREE_N,
  UNIVERSE_SHA,
  UNIVERSE_N,
  printOf,
  weekdayDte,
  yearFrac,
  minutesLeftCol,
  sessionScanOpen,
  quoteValid,
  spreadPass,
  ivFeature,
  greekVol,
  f32,
  atmStrike,
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
} from './compassParams';
import { COMPASS_TICKERS } from './compassUniverse';
import { optionScanOpen, sessionYmd } from './compassSession';
import type { OptionRight, Setup } from '../types/compass';
import type { StrikeNode } from '../types/market';

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

const INDEX = new Set(['SPX', 'SPXW', 'RUT', 'RUTW', 'VIX', 'XSP', 'NDX', 'NDXP']);
const CLS_INDEX_SET = new Set<string>(CLS_INDEX);
const CLS_HIGH_SET = new Set<string>(CLS_HIGHBETA);
const UNDER: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };
const CORE = new Set<string>(GEX_CORE);
const NO_DAILY = new Set<string>(NO_SAME_DAY);
const SMH = ['NVDA', 'AMD', 'AVGO', 'MU', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'MRVL', 'QCOM', 'INTC', 'SMCI', 'ARM', 'ON', 'NXPI', 'ADI', 'TXN', 'SWKS', 'WOLF', 'COHR', 'STX', 'WDC', 'NTAP', 'SOXL', 'SOXS', 'NVDL'];
const BITO = ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'IREN', 'HUT', 'CIFR', 'WULF', 'CORZ', 'BITX', 'HOOD'];
const XLE = ['XOM', 'CVX', 'OXY', 'COP', 'DVN', 'EOG', 'APA', 'HAL', 'SLB', 'MPC', 'PSX', 'VLO', 'FANG', 'EQT', 'AR', 'BTU', 'OIH', 'XOP', 'USO', 'UCO'];
const GDX = ['NEM', 'GOLD', 'AEM', 'WPM', 'PAAS', 'AG', 'GDXJ', 'NUGT', 'JNUG', 'SLV', 'GLD', 'AGQ'];
const XLF = ['JPM', 'BAC', 'C', 'WFC', 'GS', 'MS', 'SCHW', 'AXP', 'COF', 'USB', 'TFC', 'KRE', 'FAS', 'DPST', 'ALLY', 'BLK', 'BX', 'KKR', 'APO'];
const SECTOR_OF: Record<string, string> = {
  ...Object.fromEntries(SMH.map(t => [t, 'SMH'])),
  ...Object.fromEntries(BITO.map(t => [t, 'BITO'])),
  ...Object.fromEntries(XLE.map(t => [t, 'XLE'])),
  ...Object.fromEntries(GDX.map(t => [t, 'GDX'])),
  ...Object.fromEntries(XLF.map(t => [t, 'XLF'])),
};

interface Bar { d: string; m: number; o: number; h: number; l: number; c: number; v: number }
interface Curve { cum: Map<number, number[]>; five: Map<number, number[]> }
interface PinBook { nodes: { strike: number; call: number; put: number }[]; oi: (strike: number, right: OptionRight) => number }
interface LeftRow { id: string; ticker: string; contract: string; why: string; at: number }

function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

function bsStates(S: number, K: number, T: number, sig: number, call: boolean): { px: number; de: number; ga: number; th: number; ve: number } {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sig > 0)) return { px: NaN, de: NaN, ga: NaN, th: NaN, ve: NaN };
  const vol = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R - Q + 0.5 * sig * sig) * T) / vol;
  const d2 = d1 - vol;
  const df = Math.exp(-R * T);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const nd1 = cdf(d1);
  const px = call ? S * nd1 - K * df * cdf(d2) : K * df * cdf(-d2) - S * cdf(-d1);
  const de = call ? nd1 : nd1 - 1;
  const ga = pdf / (S * vol);
  const thetaYear = -(S * pdf * sig) / (2 * Math.sqrt(T)) - (call ? R * K * df * cdf(d2) : -R * K * df * cdf(-d2));
  /* Theta per calendar day: the convention the trees were trained on and the one the app shows. */
  return { px, de, ga, th: thetaYear / 365, ve: (S * pdf * Math.sqrt(T)) / 100 };
}

function ivStates(price: number, S: number, K: number, T: number, call: boolean): number {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return NaN;
  let lo = IV_LO;
  let hi = IV_HI;
  const atLo = bsStates(S, K, T, lo, call).px;
  const atHi = bsStates(S, K, T, hi, call).px;
  if (!(atLo <= price) || !(atHi >= price)) return NaN;
  for (let i = 0; i < IV_BISECTS; i++) {
    const mid = (lo + hi) / 2;
    if (bsStates(S, K, T, mid, call).px > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
}

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
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  for (let i = 0; i < 10; i++) {
    d.setDate(d.getDate() - 1);
    if (isTradingDay(d)) break;
  }
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
  if (hit && Date.now() - hit.at < 60_000) return hit.bars;
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

function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function median(s: number[]): number {
  if (!s.length) return NaN;
  const a = [...s].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
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
  const bars = got.error ? [] : barsOf(got.data);
  const days = new Map<string, Bar[]>();
  for (const b of bars) {
    const list = days.get(b.d);
    if (list) list.push(b);
    else days.set(b.d, [b]);
  }
  const cum = new Map<number, number[]>();
  const five = new Map<number, number[]>();
  for (const list of days.values()) {
    /* Cumulative volume by minute, and the volume of the last five minutes from a running window. */
    let run = 0;
    const totals: { m: number; total: number }[] = [];
    let back = 0;
    for (const b of list) {
      run += b.v;
      totals.push({ m: b.m, total: run });
    }
    for (let k = 0; k < totals.length; k++) {
      const { m, total } = totals[k];
      while (back + 1 <= k && totals[back + 1].m <= m - 5) back++;
      const prior = totals[back].m <= m - 5 ? totals[back].total : 0;
      const held = cum.get(m) ?? [];
      held.push(total);
      cum.set(m, held);
      const bag5 = five.get(m) ?? [];
      bag5.push(Math.max(0, total - prior));
      five.set(m, bag5);
    }
  }
  return cum.size ? { cum, five } : null;
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

async function pinOf(ticker: string, expiry: string, spot: number): Promise<PinBook | null> {
  if (!CORE.has(ticker)) return null;
  const key = `${ticker}|${expiry}`;
  const hit = pinCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.book;
  const name = printOf(ticker);
  const chain = await new Promise<StrikeNode[] | null>(resolve => {
    const read = (): StrikeNode[] | null => {
      ensureBook(name);
      const snap = snapshotOf(name);
      if (!snap) return null;
      const dated = snap.uwByDate?.[expiry];
      if (dated?.length) return dated;
      return snap.chain.length ? snap.chain : null;
    };
    const got = read();
    if (got) {
      resolve(got);
      return;
    }
    resolve(null);
  });
  if (!chain?.length || !(spot > 0)) {
    pinCache.set(key, { at: Date.now(), book: null });
    return null;
  }
  const book: PinBook = {
    nodes: chain.map(node => ({ strike: node.strike, call: node.callOI, put: node.putOI })),
    oi: (strike, right) => {
      const node = chain.find(row => Math.abs(row.strike - strike) < 0.001);
      if (!node) return NaN;
      return right === 'C' ? node.callOI : node.putOI;
    },
  };
  pinCache.set(key, { at: Date.now(), book });
  return book;
}

function span(arr: number[], from: number, to: number, max: boolean): number {
  let y = NaN;
  const end = Math.min(to, arr.length);
  for (let i = from; i < end; i++) {
    if (!Number.isFinite(arr[i])) continue;
    y = Number.isFinite(y) ? (max ? Math.max(y, arr[i]) : Math.min(y, arr[i])) : arr[i];
  }
  return y;
}

function tapeOf(rows: Bar[], index: boolean, minute: number, spot = NaN): { tt: number; S: number; op: number; H: number; L: number; orh: number; orl: number; rv30: number; rvPrev: number; compress: number; vwapZ: number; cum: number; last5: number; at: (back: number) => number } {
  const tt = minute - (9 * 60 + 30);
  const o = Array<number>(392).fill(NaN);
  const h = Array<number>(392).fill(NaN);
  const l = Array<number>(392).fill(NaN);
  const v = Array<number>(392).fill(0);
  let op = NaN;
  for (const b of rows) {
    const k = b.m - (9 * 60 + 30);
    if (k < 0 || k > 390) continue;
    /* Spot at minute t is that minute's first print. A missing minute stays missing. */
    if (!(o[k] > 0) && b.o > 0) o[k] = b.o;
    h[k] = b.h;
    l[k] = b.l;
    v[k] = b.v;
    if (k === 0 && b.o > 0) op = b.o;
  }
  const S = (() => {
    if (tt > 390 && spot > 0) return spot;
    const last = Math.min(Math.max(tt, 0), o.length - 1);
    for (let i = last; i >= 0; i--) if (o[i] > 0) return o[i];
    return spot > 0 ? spot : NaN;
  })();
  const logs = (from: number, to: number) => {
    const out: number[] = [];
    for (let i = Math.max(from + 1, 1); i < to; i++) {
      if (o[i] > 0 && o[i - 1] > 0) out.push(Math.log(o[i] / o[i - 1]));
    }
    return out;
  };
  const rv = (xs: number[]) => (xs.length >= 10 ? stdev(xs) : NaN);
  const rv30 = rv(logs(Math.max(1, tt - 30), tt + 1));
  const rvPrev = rv(logs(Math.max(1, tt - 60), tt - 29));
  let compress = NaN;
  if (tt >= 60) {
    if (index) {
      const changes = (n: number) => {
        const d: number[] = [];
        for (let i = Math.max(1, tt - n + 1); i <= tt; i++) if (o[i] > 0 && o[i - 1] > 0) d.push(o[i] - o[i - 1]);
        return d;
      };
      const a = stdev(changes(5));
      const b = stdev(changes(60));
      compress = b > 0 ? a / b : NaN;
    } else {
      const meanRange = (n: number) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(1, tt - n + 1); i < tt; i++) {
          if (Number.isFinite(h[i]) && Number.isFinite(l[i])) {
            sum += h[i] - l[i];
            count += 1;
          }
        }
        return count ? sum / count : NaN;
      };
      const a = meanRange(5);
      const b = meanRange(60);
      compress = b > 0 ? a / b : NaN;
    }
  }
  let pv = 0;
  let vv = 0;
  const devs: number[] = [];
  for (let i = 1; i < tt && i < o.length; i++) {
    if (!(v[i] > 0) || !(o[i] > 0)) continue;
    pv += o[i] * v[i];
    vv += v[i];
    devs.push(o[i] - pv / vv);
  }
  const vwap = vv > 0 ? pv / vv : NaN;
  const sd = stdev(devs);
  const vwapZ = !index && sd > 0 && S > 0 && vwap > 0 ? (S - vwap) / sd : NaN;
  const cum = index ? NaN : vv;
  let last5 = 0;
  for (let i = Math.max(1, tt - 4); i < tt && i < v.length; i++) last5 += v[i] || 0;
  /* High and low of minute t-1 are known at t. The current minute's high, low, and close are not. */
  return {
    tt,
    S,
    op,
    H: span(h, 0, tt, true),
    L: span(l, 0, tt, false),
    orh: span(h, 0, 30, true),
    orl: span(l, 0, 30, false),
    rv30,
    rvPrev,
    compress,
    vwapZ,
    cum,
    last5,
    at: (back: number) => (tt - back >= 0 && o[tt - back] > 0 ? o[tt - back] : NaN),
  };
}

const seenAsks = new Map<string, { minute: number; bid: number; ask: number }[]>();
const seenMids = new Map<string, { minute: number; mid: number }[]>();

function noteAsk(id: string, minute: number, bid: number, ask: number): void {
  if (!quoteValid(bid, ask) || !Number.isFinite(minute)) return;
  const list = seenAsks.get(id) ?? [];
  const last = list[list.length - 1];
  if (last && last.minute === minute) {
    last.bid = bid;
    last.ask = ask;
  } else list.push({ minute, bid, ask });
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
  const last = list[list.length - 1];
  if (last && last.minute === minute) last.mid = mid;
  else list.push({ minute, mid });
  if (list.length > 40) list.splice(0, list.length - 40);
  seenMids.set(id, list);
}

function midThen(id: string, minute: number): number {
  const list = seenMids.get(id) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].minute === minute) return list[i].mid;
  return NaN;
}

function yearsLeft(tt: number): number {
  return yearFrac(tt);
}

function features(
  setup: Setup,
  minute: number,
  rows: Bar[],
  spy: Bar[],
  pd: { h: number; l: number; c: number } | null,
  atmIv: number,
  skew: number,
  sec: Bar[],
  curve: Curve | null,
  pin: PinBook | null,
  sessionDay: string,
): number[] | null {
  const indexName = INDEX.has(setup.ticker) || INDEX.has(UNDER[setup.ticker] ?? '');
  const tape = tapeOf(rows, indexName, minute, setup.spot ?? NaN);
  if (!(tape.S > 0)) return null;
  const x = Array.from({ length: 56 }, () => NaN);
  const s = tape.S;
  const op = tape.op;
  const ret = (back: number) => {
    const prev = tape.at(back);
    return s > 0 && prev > 0 ? s / prev - 1 : NaN;
  };
  const retOpen = s > 0 && op > 0 ? s / op - 1 : NaN;
  const ret5 = ret(5);
  const ret15 = ret(15);
  const ret60 = ret(60);
  const spyTape = tapeOf(spy, false, minute);
  const secTape = sec.length ? tapeOf(sec, false, minute) : null;
  const dir: number = setup.right === 'C' ? 1 : -1;
  const mid = setup.mid > 0 ? setup.mid : NaN;
  const was = (back: number) => midThen(setup.id, minute - back);
  const T = yearsLeft(tape.tt);
  const call = setup.right === 'C';
  const solved = ivFeature(ivStates(mid, s, setup.strike, T, call));
  const vol = greekVol(solved, ivFeature(atmIv));
  const greek = bsStates(s, setup.strike, T, vol, call);
  const clock = 9 * 60 + 30 + tape.tt - (indexName ? 0 : 1);
  const hist = curve?.cum.get(clock) ?? [];
  const hist5 = curve?.five.get(clock) ?? [];
  const med = hist.length >= 5 ? median(hist) : NaN;
  const med5 = hist5.length >= 5 ? median(hist5) : NaN;
  const walls = pin ? oiWalls(pin, s) : { call: NaN, put: NaN };
  const mineOi = pin ? pin.oi(setup.strike, setup.right) : NaN;

  x[0] = tape.tt;
  x[1] = retOpen;
  x[2] = ret5;
  x[3] = ret15;
  x[4] = tape.tt >= 60 ? ret60 : NaN;
  x[5] = tape.H > tape.L ? (s - tape.L) / (tape.H - tape.L) : NaN;
  x[6] = tape.H > 0 && tape.L > 0 && op > 0 ? (tape.H - tape.L) / op : NaN;
  x[7] = tape.rv30;
  x[8] = tape.rv30 > 0 && tape.rvPrev > 0 ? tape.rv30 / tape.rvPrev : NaN;
  x[9] = tape.compress;
  x[10] = tape.tt < 30 || !Number.isFinite(tape.orh) ? NaN : s > tape.orh ? 1 : s < tape.orl ? -1 : 0;
  x[11] = tape.tt < 30 || !(op > 0) || !Number.isFinite(tape.orh) ? NaN : s > tape.orh ? (s - tape.orh) / op : s < tape.orl ? (s - tape.orl) / op : 0;
  x[12] = pd && pd.h > 0 ? s / pd.h - 1 : NaN;
  x[13] = pd && pd.l > 0 ? s / pd.l - 1 : NaN;
  x[14] = pd && pd.c > 0 && op > 0 ? op / pd.c - 1 : NaN;
  x[15] = minutesLeftCol(tape.tt);
  x[16] = indexName ? NaN : tape.vwapZ;
  x[17] = indexName || !(med > 0) ? NaN : tape.cum / med;
  x[18] = indexName || !(med5 > 0) ? NaN : tape.last5 / med5;
  x[19] = spyTape.S > 0 && spyTape.at(5) > 0 ? spyTape.S / spyTape.at(5) - 1 : NaN;
  x[20] = spyTape.S > 0 && spyTape.at(15) > 0 ? spyTape.S / spyTape.at(15) - 1 : NaN;
  x[21] = spyTape.S > 0 && spyTape.op > 0 ? spyTape.S / spyTape.op - 1 : NaN;
  x[22] = secTape && secTape.S > 0 && secTape.at(15) > 0 ? secTape.S / secTape.at(15) - 1 : NaN;
  x[23] = secTape && secTape.S > 0 && secTape.op > 0 ? secTape.S / secTape.op - 1 : NaN;
  x[24] = atmIv;
  x[25] = skew;
  x[26] = atmIv > 0 && tape.rv30 > 0 ? atmIv / (tape.rv30 * Math.sqrt(390 * 252)) : NaN;
  const core = CORE.has(setup.ticker);
  const net = core && pin ? netGexBn(pin, s, T, ivFeature(atmIv)) : NaN;
  x[27] = core ? net : NaN;
  x[28] = core ? walls.call : NaN;
  x[29] = core ? walls.put : NaN;
  x[30] = call ? setup.strike / s - 1 : 1 - setup.strike / s;
  x[31] = dir;
  x[32] = mid;
  x[33] = mid > 0 ? (setup.ask - setup.bid) / mid : NaN;
  x[34] = mid > 0 && was(5) > 0 ? mid / was(5) - 1 : NaN;
  x[35] = mid > 0 && was(15) > 0 ? mid / was(15) - 1 : NaN;
  x[36] = solved;
  x[37] = greek.de;
  x[38] = greek.ga;
  x[39] = greek.th;
  x[40] = greek.ve;
  x[41] = Number.isFinite(greek.ga) && Number.isFinite(greek.th) && greek.th !== 0 ? greek.ga / Math.abs(greek.th) : NaN;
  x[42] = Number.isFinite(greek.th) && mid > 0 ? greek.th / mid : NaN;
  x[43] = core && Number.isFinite(mineOi) ? mineOi : NaN;
  x[44] = CLS_INDEX_SET.has(setup.ticker) ? 1 : 0;
  x[45] = CLS_HIGH_SET.has(setup.ticker) ? 1 : 0;
  x[46] = retOpen * dir;
  x[47] = ret5 * dir;
  x[48] = ret15 * dir;
  x[49] = Number.isFinite(x[4]) ? (x[4] as number) * dir : NaN;
  x[50] = Number.isFinite(x[16]) ? (x[16] as number) * dir : NaN;
  x[51] = Number.isFinite(x[11]) ? (x[11] as number) * dir : NaN;
  x[52] = Number.isFinite(x[20]) ? (x[20] as number) * dir : NaN;
  x[53] = Number.isFinite(x[22]) ? (x[22] as number) * dir : NaN;
  x[54] = Number.isFinite(x[12]) ? (x[12] as number) * dir : NaN;
  x[55] = Number.isFinite(x[13]) ? (x[13] as number) * dir : NaN;
  return x;
}

function oiWalls(pin: PinBook, S: number): { call: number; put: number } {
  if (!(S > 0)) return { call: NaN, put: NaN };
  let callK = NaN;
  let callOi = -1;
  let callGap = Infinity;
  let putK = NaN;
  let putOi = -1;
  let putGap = Infinity;
  for (const n of pin.nodes) {
    if (n.strike >= S && n.call > 0 && (n.call > callOi || (n.call === callOi && Math.abs(n.strike - S) < callGap))) {
      callOi = n.call;
      callK = n.strike;
      callGap = Math.abs(n.strike - S);
    }
    if (n.strike <= S && n.put > 0 && (n.put > putOi || (n.put === putOi && Math.abs(n.strike - S) < putGap))) {
      putOi = n.put;
      putK = n.strike;
      putGap = Math.abs(n.strike - S);
    }
  }
  return {
    call: callK > 0 ? callK / S - 1 : NaN,
    put: putK > 0 ? putK / S - 1 : NaN,
  };
}

function netGexBn(pin: PinBook, S: number, T: number, atmIv: number): number {
  if (!(S > 0) || !(T > 0) || !(atmIv > IV_FEATURE_MIN)) return NaN;
  let sum = 0;
  for (const n of pin.nodes) {
    const g = bsStates(S, n.strike, T, atmIv, true).ga;
    if (!Number.isFinite(g)) continue;
    if (n.call > 0) sum += n.call * g * S * S * 0.01;
    if (n.put > 0) sum -= n.put * g * S * S * 0.01;
  }
  return sum / 1e9;
}

function atmPair(rows: Setup[], spot: number, T: number): { iv: number; skew: number } {
  const strike = atmStrike(rows.map(s => s.strike), spot);
  if (!Number.isFinite(strike)) return { iv: NaN, skew: NaN };
  let call = NaN;
  let put = NaN;
  for (const s of rows) {
    if (Math.abs(s.strike - strike) > 0.001) continue;
    const iv = ivFeature(ivStates(s.mid, spot, s.strike, T, s.right === 'C'));
    if (!Number.isFinite(iv)) continue;
    if (s.right === 'C') call = iv;
    else put = iv;
  }
  const iv = call > 0 && put > 0 ? (call + put) / 2 : call > 0 ? call : put;
  const skew = call > 0 && put > 0 ? put - call : NaN;
  return { iv, skew };
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
const pinnedAsk = new Map<string, number>();
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
      ? (row.p1 + 1e-12 < 0.7067 ? `Model 1 ${(row.p1 * 100).toFixed(1)}%. Needs 70.67%.` : 'No seat.')
      : had.why;
    passBook.set(key, { ticker: row.setup.ticker, contract: row.setup.contract, p1: row.p1, why, sleeve: row.setup.sleeve });
  }
}

function persistCalls(): void {
  if (typeof localStorage === 'undefined') return;
  const p = nyParts(Date.now());
  const day = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const pack = {
    day,
    picks: [...picks.entries()],
    wings: [...wingPicks.entries()],
    lottery: [...lotteryPicks.entries()],
    kept: [...kept.entries()],
    filled: [...pinnedAsk.entries()],
    near: [...nearPicks.entries()],
    pass: [...passBook.values()],
    seen: [...seen],
    rootA: [...seenRootA],
    rootB: [...seenRootB],
    rootC: [...seenRootC],
  };
  try { localStorage.setItem(CALLS_KEY, JSON.stringify(pack)); } catch { /* the maps still hold this tab */ }
}

function restoreCalls(): void {
  if (typeof localStorage === 'undefined') return;
  const p = nyParts(Date.now());
  const day = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(CALLS_KEY) || 'null'); } catch { raw = null; }
  const pack = raw && typeof raw === 'object' ? raw as {
    day?: string;
    picks?: [string, Setup][];
    wings?: [string, Setup][];
    lottery?: [string, Setup][];
    kept?: [string, Setup][];
    filled?: [string, number][];
    near?: [string, Setup][];
    pass?: PassLine[];
    seen?: string[];
    rootA?: string[];
    rootB?: string[];
    rootC?: string[];
  } : null;
  if (pack && pack.day === day) {
    for (const [k, v] of pack.picks ?? []) if (v && v.id) picks.set(k, v);
    for (const [k, v] of pack.wings ?? []) if (v && v.id) wingPicks.set(k, v);
    for (const [k, v] of pack.lottery ?? []) if (v && v.id) lotteryPicks.set(k, v);
    for (const [k, v] of pack.kept ?? []) if (v && v.id) kept.set(k, v);
    for (const [k, n] of pack.filled ?? []) if (k && n > 0) pinnedAsk.set(k, n);
    for (const [k, v] of pack.near ?? []) if (v && v.id) nearPicks.set(k, v);
    for (const row of pack.pass ?? []) if (row && row.ticker && row.contract) passBook.set(`${row.sleeve}|${row.contract}`, row);
    for (const id of pack.seen ?? []) seen.add(id);
    for (const t of pack.rootA ?? []) seenRootA.add(t);
    for (const t of pack.rootB ?? []) seenRootB.add(t);
    for (const t of pack.rootC ?? []) seenRootC.add(t);
  }
  persistCalls();
}

restoreCalls();

export function entryAsk(id: string): number {
  return pinnedAsk.get(id) ?? 0;
}

/** The card and the contract read this. A pick's fill does not move with later quotes. */
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

function pinEntry(_s: Setup): void {
  persistCalls();
}

/** The ledger's fill for a pick: the ask quoted a full minute after the call. Set once. */
export function pinFill(id: string, ask: number): void {
  if (pinnedAsk.has(id) || !(ask > 0)) return;
  pinnedAsk.set(id, ask);
  persistCalls();
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
      whyText: row.p1 + 1e-12 < 0.7067 ? `Model 1 ${(row.p1 * 100).toFixed(1)}%. Needs 70.67%.` : `Model 1 ${(row.p1 * 100).toFixed(1)}%. No seat.`,
    };
    nearPicks.set(s.id, card);
    pinEntry(card);
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
      if (!s.quotedAt || s.quotedAt > now || now - s.quotedAt > QUOTE_MAX_AGE_MS) {
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
      const raw = features({ ...s, mid }, minute, book.get(under) ?? [], spy, pd.get(under) ?? null, iv, skew, sec, curve, pin, day);
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
      pinEntry(next.get(slotOf(row.setup))!);
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
      pinEntry(wingNext.get(row.setup.id)!);
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
    pinEntry(lotteryPicks.get(setup.id)!);
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
    const raw = features(mine, minute, bars, spy, prior, iv, skew, sec, curveOf(under), pin, day);
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

