/*
  Compass scorer. Two locked LightGBM books, one contract per name for a top pick.
  A missing feature stays NaN. Spot gamma is the chain's own greek, not a
  Black-Scholes stand-in. The bar path is Theta's one-minute tape.

  A contract is called once a session, call or put, same rule. A later pass
  does not call it again. An average call that later clears 70.67% is not a
  new trade. That is strength: hold longer.
*/

import entryJson from './models/entry.json';
import runnerJson from './models/runner.json';
import { predict, type Tree } from './lgbm';
import { thetaCall } from './theta';
import { nyParts, nyWallStamp } from '../core/nyTime';
import { ensureBook, snapshotOf } from './uwBook';
import { gexFeatures, peekSpotGex, wantSpotGex } from './spotGexBook';
import scalpFit from './models/scalpFit.json';
import wingFit from './models/wingFit.json';
import { spreadOk } from './contractQuote';
import type { OptionRight, Setup } from '../types/compass';
import type { StrikeNode } from '../types/market';

const ENTRY = entryJson as Tree[];
const RUNNER = runnerJson as Tree[];
const P1_MIN = 0.7067;
const PRUN_MIN = 0.5;
/** Swing. Same entry score. Calls and puts. One of each per name. +50% and the runner. */
export const AVG_BAND = 0.31;
/** Rare rungs on this model were a lie. A unicorn is a wing call, not a 100% tag. */
const WING_DELTA = 0.15;
/** Called once per session. The id is ticker, strike, right, and sleeve. */
const seen = new Set<string>();
const R = 0.042;

const INDEX = new Set(['SPX', 'SPXW', 'RUT', 'RUTW', 'VIX', 'XSP', 'NDX', 'NDXP']);
const CLS_INDEX = INDEX;
const CLS_HIGH = new Set(['LLY', 'BKNG', 'AVGO', 'NFLX', 'META', 'COST', 'ASML', 'NOW', 'MELI', 'ISRG', 'TDG', 'AZO', 'MDB']);
const UNDER: Record<string, string> = { SPXW: 'SPX', XSP: 'SPX', RUTW: 'RUT' };
const CORE = new Set(['SPX', 'SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'TSLA', 'AMD', 'AMZN', 'META', 'MSFT', 'GOOGL', 'AVGO', 'COIN', 'MSTR', 'SMCI']);
const SMH = ['NVDA', 'AMD', 'AVGO', 'MU', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'MRVL', 'QCOM', 'INTC', 'SMCI', 'ARM', 'ON', 'NXPI', 'ADI', 'TXN', 'SWKS', 'WOLF', 'COHR', 'STX', 'WDC', 'NTAP', 'SOXL', 'SOXS', 'NVDL'];
const BITO = ['MARA', 'COIN', 'MSTR', 'CLSK', 'RIOT', 'IREN', 'CIFR', 'WULF', 'HUT', 'CORZ', 'BITX', 'BITO'];
const SECTOR_OF: Record<string, string> = {
  ...Object.fromEntries(SMH.map(t => [t, 'SMH'])),
  ...Object.fromEntries(BITO.map(t => [t, 'BITO'])),
};

interface Bar { m: number; o: number; h: number; l: number; c: number; v: number }
interface Curve { cum: Map<number, number[]>; five: Map<number, number[]> }
interface PinBook { nodes: { strike: number; call: number; put: number }[]; oi: (strike: number, right: OptionRight) => number }
interface LeftRow { id: string; ticker: string; contract: string; why: string; at: number }

function modelsLocked(): boolean {
  const entry = ENTRY[0];
  const runner = RUNNER[0];
  if (!entry || !runner || ENTRY.length !== 300 || RUNNER.length !== 300) return false;
  return entry.s[0] === 42
    && Math.abs(entry.t[0] + 0.10803829506039618) < 1e-12
    && Math.abs(entry.v[0] + 0.856027354044286) < 1e-9
    && runner.s[0] === 30
    && Math.abs(runner.t[0] + 0.001826452149543911) < 1e-12
    && Math.abs(runner.v[0] - 0.3963730130421617) < 1e-9;
}

function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

function bsStates(S: number, K: number, T: number, sig: number, call: boolean): { px: number; de: number; ga: number; th: number; ve: number } {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sig > 0)) return { px: NaN, de: NaN, ga: NaN, th: NaN, ve: NaN };
  const vol = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R + 0.5 * sig * sig) * T) / vol;
  const d2 = d1 - vol;
  const df = Math.exp(-R * T);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const nd1 = cdf(d1);
  const px = call ? S * nd1 - K * df * cdf(d2) : K * df * cdf(-d2) - S * cdf(-d1);
  const de = call ? nd1 : nd1 - 1;
  const ga = pdf / (S * vol);
  const thetaYear = -(S * pdf * sig) / (2 * Math.sqrt(T)) - (call ? R * K * df * cdf(d2) : -R * K * df * cdf(-d2));
  return { px, de, ga, th: thetaYear / 365, ve: (S * pdf * Math.sqrt(T)) / 100 };
}

function ivStates(price: number, S: number, K: number, T: number, call: boolean): number {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return NaN;
  let lo = 0.01;
  let hi = 8;
  if (bsStates(S, K, T, lo, call).px > price) return NaN;
  for (let i = 0; i < 60; i++) {
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

function stampMinute(stamp: unknown): number {
  const at = nyWallStamp(stamp);
  if (!at) return NaN;
  const p = nyParts(at);
  return p.hour * 60 + p.minute;
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
    const m = stampMinute(b.timestamp ?? b.time ?? b.date);
    const c = num(b.close);
    if (!Number.isFinite(m) || !(c > 0)) continue;
    out.push({ m, o: num(b.open) || c, h: num(b.high) || c, l: num(b.low) || c, c, v: num(b.volume) || 0 });
  }
  out.sort((a, b) => a.m - b.m);
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

async function loadPrior(name: string, now: number): Promise<{ h: number; l: number; c: number } | null> {
  const bars = await loadBars(name, ymd(now - 86400000));
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
  const end = ymd(now - 86400000);
  const start = ymd(now - 21 * 86400000);
  const root = UNDER[symbol] ?? symbol;
  const index = INDEX.has(symbol) || INDEX.has(root);
  const path = index
    ? `/index/history/ohlc?symbol=${root}&start_date=${start}&end_date=${end}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${root}&start_date=${start}&end_date=${end}&interval=1m&format=json`;
  const got = await thetaCall(path);
  const bars = got.error ? [] : barsOf(got.data);
  const byDay = new Map<string, Bar[]>();
  for (const b of bars) {
    const key = String(Math.floor(b.m));
    void key;
  }
  const days = new Map<number, Bar[]>();
  let cursor = -1;
  let bag: Bar[] = [];
  for (const b of bars) {
    if (b.m + 1 < cursor) {
      if (bag.length) days.set(days.size, bag);
      bag = [];
    }
    bag.push(b);
    cursor = b.m;
  }
  if (bag.length) days.set(days.size, bag);
  const cum = new Map<number, number[]>();
  const five = new Map<number, number[]>();
  for (const list of days.values()) {
    list.sort((a, b) => a.m - b.m);
    let run = 0;
    const atMin = new Map<number, number>();
    for (const b of list) {
      run += b.v;
      atMin.set(b.m, run);
    }
    for (const [m, total] of atMin) {
      const held = cum.get(m) ?? [];
      held.push(total);
      cum.set(m, held);
      const prior = [...atMin.entries()].filter(([mm]) => mm <= m - 5).sort((a, b) => b[0] - a[0])[0];
      const last5 = total - (prior ? prior[1] : 0);
      const bag5 = five.get(m) ?? [];
      bag5.push(Math.max(0, last5));
      five.set(m, bag5);
    }
  }
  void byDay;
  return cum.size ? { cum, five } : null;
}

function curveOf(symbol: string): Curve | null {
  return curves.get(symbol) ?? null;
}

export function warmVolumes(symbols: string[], now = Date.now()): void {
  for (const symbol of symbols) {
    if (INDEX.has(symbol) || curves.has(symbol) || warmQ.includes(symbol)) continue;
    warmQ.push(symbol);
  }
  void drain(now);
}

async function drain(now: number): Promise<void> {
  if (warming) return;
  warming = true;
  while (warmQ.length) {
    if (scanBusyFlag) {
      await new Promise(resolve => setTimeout(resolve, 400));
      continue;
    }
    const symbol = warmQ.shift();
    if (!symbol || curves.has(symbol)) continue;
    try {
      curves.set(symbol, await fetchCurve(symbol, now));
    } catch {
      curves.set(symbol, null);
    }
  }
  warming = false;
}

async function pinOf(ticker: string, expiry: string, spot: number): Promise<PinBook | null> {
  if (!CORE.has(ticker)) return null;
  const key = `${ticker}|${expiry}`;
  const hit = pinCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.book;
  const name = ticker === 'SPXW' || ticker === 'XSP' ? 'SPX' : ticker === 'RUTW' ? 'RUT' : ticker;
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

function tapeOf(rows: Bar[], index: boolean, minute: number): { tt: number; S: number; op: number; H: number; L: number; orh: number; orl: number; rv30: number; rvPrev: number; compress: number; vwapZ: number; cum: number; last5: number; at: (back: number) => number } {
  const tt = minute - (9 * 60 + 30);
  const raw = Array<number>(392).fill(NaN);
  const h = Array<number>(392).fill(NaN);
  const l = Array<number>(392).fill(NaN);
  const v = Array<number>(392).fill(0);
  let op = NaN;
  for (const b of rows) {
    const k = b.m - (9 * 60 + 30);
    if (k < 0 || k > 390) continue;
    if (index) {
      if (!Number.isFinite(raw[k])) raw[k] = b.c;
      if (k <= 5 && !(op > 0)) op = b.c;
    } else {
      const at = k + 1;
      if (at > 391) continue;
      raw[at] = b.c;
      h[at] = b.h;
      l[at] = b.l;
      v[at] = b.v;
      if (k === 0 && b.o > 0) op = b.o;
    }
  }
  const c = raw.slice();
  for (let i = 1; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = c[i - 1];
  const S = tt >= 0 && tt < c.length && Number.isFinite(c[tt]) ? c[tt] : NaN;
  const logs = (from: number, to: number) => {
    const out: number[] = [];
    for (let i = Math.max(from + 1, 1); i < to; i++) {
      if (c[i] > 0 && c[i - 1] > 0) out.push(Math.log(c[i] / c[i - 1]));
    }
    return out;
  };
  const rv = (xs: number[]) => (xs.length > 10 ? stdev(xs) : NaN);
  const rv30 = rv(logs(Math.max(1, tt - 30), tt + 1));
  const rvPrev = rv(logs(Math.max(1, tt - 60), tt - 29));
  let compress = NaN;
  if (index) {
    const changes = (n: number) => {
      const d: number[] = [];
      for (let i = Math.max(1, tt - n + 1); i <= tt; i++) if (Number.isFinite(c[i]) && Number.isFinite(c[i - 1])) d.push(c[i] - c[i - 1]);
      return d;
    };
    const a = stdev(changes(5));
    const b = stdev(changes(60));
    compress = b > 0 ? a / b : NaN;
  } else {
    const meanRange = (n: number) => {
      let sum = 0;
      let count = 0;
      for (let i = Math.max(1, tt - n + 1); i <= tt; i++) {
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
  let pv = 0;
  let vv = 0;
  const devs: number[] = [];
  for (let i = 1; i <= tt && i < c.length; i++) {
    if (!(v[i] > 0) || !(c[i] > 0)) continue;
    pv += c[i] * v[i];
    vv += v[i];
    devs.push(c[i] - pv / vv);
  }
  const vwap = vv > 0 ? pv / vv : NaN;
  const sd = stdev(devs);
  const vwapZ = !index && sd > 0 && S > 0 && vwap > 0 ? (S - vwap) / sd : NaN;
  const cum = index ? NaN : vv;
  let last5 = 0;
  for (let i = Math.max(1, tt - 4); i <= tt && i < v.length; i++) last5 += v[i] || 0;
  return {
    tt,
    S,
    op,
    H: span(index ? c : h, 1, tt + 1, true),
    L: span(index ? c : l, 1, tt + 1, false),
    orh: span(index ? c : h, 1, 31, true),
    orl: span(index ? c : l, 1, 31, false),
    rv30,
    rvPrev,
    compress,
    vwapZ,
    cum,
    last5,
    at: (back: number) => (tt - back >= 0 && Number.isFinite(c[tt - back]) ? c[tt - back] : NaN),
  };
}

const seenMids = new Map<string, { minute: number; mid: number }[]>();

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
  for (let i = list.length - 1; i >= 0; i--) if (list[i].minute <= minute) return list[i].mid;
  return NaN;
}

function yearsLeft(setup: Setup, tt: number): number {
  const exp = Date.parse(`${setup.expiryDate}T20:00:00Z`);
  const now = Date.now();
  const minutes = Number.isFinite(exp) ? Math.max(0, (exp - now) / 60000) : Math.max(0, setup.sessionsLeft) * 390 + Math.max(0, 390 - tt);
  return Math.max(1e-6, minutes / (252 * 390));
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
): number[] | null {
  const indexName = INDEX.has(setup.ticker) || INDEX.has(UNDER[setup.ticker] ?? '');
  const tape = tapeOf(rows, indexName, minute);
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
  const T = yearsLeft(setup, tape.tt);
  const call = setup.right === 'C';
  const solved = ivStates(mid, s, setup.strike, T, call);
  const greek = Number.isFinite(solved) ? bsStates(s, setup.strike, T, solved, call) : { px: NaN, de: NaN, ga: NaN, th: NaN, ve: NaN };
  const clock = 9 * 60 + 30 + tape.tt - (indexName ? 0 : 1);
  const hist = curve?.cum.get(clock) ?? [];
  const hist5 = curve?.five.get(clock) ?? [];
  const med = hist.length >= 5 ? median(hist) : NaN;
  const med5 = hist5.length >= 5 ? median(hist5) : NaN;
  const under = UNDER[setup.ticker] ?? setup.ticker;
  const book = gexFeatures(peekSpotGex(under), s);
  const mineOi = pin ? pin.oi(setup.strike, setup.right) : NaN;

  x[0] = tape.tt;
  x[1] = retOpen;
  x[2] = ret5;
  x[3] = ret15;
  x[4] = ret60;
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
  x[15] = 390 - tape.tt;
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
  x[27] = book.net;
  x[28] = book.call;
  x[29] = book.put;
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
  x[41] = Number.isFinite(greek.ga) && Number.isFinite(greek.th) && greek.ga !== 0 && greek.th !== 0 ? greek.ga / Math.abs(greek.th) : NaN;
  x[42] = Number.isFinite(greek.th) && greek.th !== 0 && mid > 0 ? greek.th / mid : NaN;
  x[43] = Number.isFinite(mineOi) ? mineOi : NaN;
  x[44] = CLS_INDEX.has(setup.ticker) ? 1 : 0;
  x[45] = CLS_HIGH.has(setup.ticker) ? 1 : 0;
  x[46] = retOpen * dir;
  x[47] = ret5 * dir;
  x[48] = ret15 * dir;
  x[49] = ret60 * dir;
  x[50] = Number.isFinite(x[16]) ? (x[16] as number) * dir : NaN;
  x[51] = Number.isFinite(x[11]) ? (x[11] as number) * dir : NaN;
  x[52] = Number.isFinite(x[20]) ? (x[20] as number) * dir : NaN;
  x[53] = Number.isFinite(x[22]) ? (x[22] as number) * dir : NaN;
  x[54] = Number.isFinite(x[12]) ? (x[12] as number) * dir : NaN;
  x[55] = Number.isFinite(x[13]) ? (x[13] as number) * dir : NaN;
  return x;
}

function atmPair(rows: Setup[], spot: number, T: number): { iv: number; skew: number } {
  let best = Infinity;
  for (const s of rows) {
    const d = Math.abs(s.strike - spot);
    if (d < best) best = d;
  }
  let call = NaN;
  let put = NaN;
  for (const s of rows) {
    if (Math.abs(s.strike - spot) > best + 0.001) continue;
    const iv = ivStates(s.mid, spot, s.strike, T, s.right === 'C');
    if (!(iv > 0)) continue;
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

interface Scored { setup: Setup; p1: number; prun: number }

function keepOne(entry: Scored, runner: Scored | null): Setup {
  const same = runner != null && runner.setup.id === entry.setup.id;
  const close = runner != null && runner.p1 >= entry.p1 - 0.02;
  const win = same || !runner || !close ? entry : runner;
  const prun = win.prun;
  return {
    ...win.setup,
    p1: win.p1,
    prun,
    runner: prun >= PRUN_MIN,
    modelAgree: same,
    better: prun >= PRUN_MIN ? 'runner' : 'entry',
    band: 'top',
    strength: false,
    seenAt: Date.now(),
  };
}

function asAverage(row: Scored): Setup {
  seen.add(row.setup.id);
  return {
    ...row.setup,
    p1: row.p1,
    prun: row.prun,
    runner: row.prun >= PRUN_MIN,
    modelAgree: false,
    better: row.prun >= PRUN_MIN ? 'runner' : 'entry',
    band: 'average',
    strength: false,
    seenAt: Date.now(),
  };
}

function fitted(fit: { calls?: boolean; bar: number; b: number; w: number[]; mean: number[]; std: number[] }, x: number[]): number {
  if (fit.calls === false) return 0;
  let z = fit.b;
  for (let i = 0; i < fit.w.length; i++) z += fit.w[i] * ((x[i] - fit.mean[i]) / (fit.std[i] || 1));
  const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
  return p >= fit.bar ? p : 0;
}

function impulse(tape: { S: number; at: (back: number) => number }): { side: OptionRight | null; ret5: number; ret15: number } {
  const s = tape.S;
  const r = (back: number) => {
    const prev = tape.at(back);
    return s > 0 && prev > 0 ? s / prev - 1 : 0;
  };
  const ret5 = r(5);
  const mag = Math.abs(ret5);
  let side: OptionRight | null = mag >= 0.0015 ? (ret5 > 0 ? 'C' : 'P') : null;
  if (side) {
    for (let back = 5; back <= 25; back += 5) {
      const a = tape.at(back);
      const b = tape.at(back + 5);
      if (a > 0 && b > 0 && Math.abs(a / b - 1) > mag) side = null;
    }
  }
  return { side, ret5, ret15: r(15) };
}

function asScalp(row: Scored, prob: number): Setup {
  seen.add(row.setup.id);
  return {
    ...row.setup,
    p1: prob,
    prun: row.prun,
    runner: false,
    modelAgree: false,
    better: 'entry',
    band: 'scalp',
    strength: false,
    seenAt: Date.now(),
  };
}
function bandOf(p1: number): Setup['band'] {
  if (p1 >= P1_MIN) return 'top';
  if (p1 >= AVG_BAND) return 'average';
  return 'scalp';
}

function asWing(row: Scored, prob: number): Setup {
  seen.add(row.setup.id);
  return {
    ...row.setup,
    p1: prob,
    prun: row.prun,
    runner: true,
    modelAgree: false,
    better: 'runner',
    band: 'wing',
    strength: false,
    seenAt: Date.now(),
  };
}

/** Same contract. A higher score changes the rung. It does not open a second trade. */
function lift(id: string, p1: number, prun: number, maps: Map<string, Setup>[]): void {
  const band = bandOf(p1);
  for (const into of maps) {
    for (const [key, had] of into) {
      if (had.id !== id) continue;
      const climbed = (had.p1 ?? 0) < p1 && band !== had.band;
      into.set(key, {
        ...had,
        p1,
        prun,
        band: climbed ? band : had.band,
        strength: climbed || !!had.strength,
        runner: p1 >= AVG_BAND,
        better: p1 >= AVG_BAND ? 'runner' : 'entry',
      });
      return;
    }
  }
}

const picks = new Map<string, Setup>();
const wingPicks = new Map<string, Setup>();
const avgPicks = new Map<string, Setup>();
const scalpPicks = new Map<string, Setup>();
const pendingScalp: { sleeve: string; row: Scored; prob: number }[] = [];
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

export function currentPicks(): Setup[] {
  const rank = (s: Setup) => s.band === 'top' ? 4 : s.band === 'wing' ? 3 : s.band === 'average' ? 2 : s.band === 'scalp' ? 1 : 0;
  return [...picks.values(), ...wingPicks.values(), ...avgPicks.values(), ...scalpPicks.values()].sort((a, b) => rank(b) - rank(a) || (b.p1 ?? 0) - (a.p1 ?? 0));
}

export function commitScalps(sleeve: string): boolean {
  const rows = pendingScalp.filter(p => p.sleeve === sleeve);
  for (let i = pendingScalp.length - 1; i >= 0; i--) if (pendingScalp[i].sleeve === sleeve) pendingScalp.splice(i, 1);
  if (!rows.length) return false;
  rows.sort((a, b) => b.prob - a.prob);
  const win = rows[0];
  if (seen.has(win.row.setup.id)) return false;
  for (const [key, pick] of scalpPicks) if (pick.sleeve === sleeve && !seen.has(key)) scalpPicks.delete(key);
  scalpPicks.set(win.row.setup.id, asScalp(win.row, win.prob));
  return true;
}

/** A new pass does not inherit last slot's losers. */
export function dropPending(sleeve: string): void {
  for (let i = pendingScalp.length - 1; i >= 0; i--) if (pendingScalp[i].sleeve === sleeve) pendingScalp.splice(i, 1);
}

export function heldSetup(id: string): Setup | null {
  const held = currentPicks().find(s => s.id === id);
  if (held) return held;
  for (const report of [reports.odte, reports.weekly]) {
    if (report.setup?.id === id) return { ...report.setup, band: 'closest' };
  }
  return null;
}

export function dropSleeve(sleeve: string): void {
  for (const [key, pick] of picks) if (pick.sleeve === sleeve) picks.delete(key);
  for (const [key, pick] of wingPicks) if (pick.sleeve === sleeve) wingPicks.delete(key);
  for (const [key, pick] of avgPicks) if (pick.sleeve === sleeve) avgPicks.delete(key);
  for (const [key, pick] of scalpPicks) if (pick.sleeve === sleeve) scalpPicks.delete(key);
}

let pace = { done: 0, total: 0, sleeve: 'odte' as 'odte' | 'weekly' };

export function scanPace(): { done: number; total: number; sleeve: 'odte' | 'weekly' } {
  return pace;
}

export function setScanPace(done: number, total: number, sleeve: 'odte' | 'weekly' = 'odte'): void {
  pace = { done, total, sleeve };
}

export function noteLeft(row: { id: string; ticker: string; contract: string }, why: string): void {
  left.set(row.id, { id: row.id, ticker: row.ticker, contract: row.contract, why, at: Date.now() });
  for (const [key, pick] of picks) if (pick.id === row.id) picks.delete(key);
  for (const [key, pick] of wingPicks) if (pick.id === row.id) wingPicks.delete(key);
  for (const [key, pick] of avgPicks) if (pick.id === row.id) avgPicks.delete(key);
  for (const [key, pick] of scalpPicks) if (pick.id === row.id) scalpPicks.delete(key);
}

export function leftOf(id: string): LeftRow | null {
  return left.get(id) ?? null;
}

async function scoreAll(setups: Setup[], now: number, merge = false): Promise<void> {
  const names = [...new Set(setups.map(s => UNDER[s.ticker] ?? s.ticker))];
  for (const name of names) if (CORE.has(name)) wantSpotGex(name);
  if (!modelsLocked()) {
    picks.clear();
    return;
  }
  const minute = minuteOf(now);
  const day = ymd(now);
  const book = new Map<string, Bar[]>();
  await Promise.all(names.map(async name => { book.set(name, await loadBars(name, day)); }));
  const spy = await loadBars('SPY', day);
  const etfs = [...new Set(names.map(name => SECTOR_OF[name]).filter(Boolean))];
  const secBars = new Map<string, Bar[]>();
  await Promise.all(etfs.map(async etf => { secBars.set(etf, await loadBars(etf, day)); }));
  const pd = new Map<string, { h: number; l: number; c: number } | null>();
  await Promise.all(names.map(async name => { pd.set(name, await loadPrior(name, now)); }));
  const pins = new Map<string, PinBook | null>();
  const wanted = new Map<string, { ticker: string; expiry: string; spot: number }>();
  for (const s of setups) {
    if (!CORE.has(s.ticker)) continue;
    const key = `${s.ticker}|${s.expiryDate}`;
    if (!wanted.has(key)) wanted.set(key, { ticker: s.ticker, expiry: s.expiryDate, spot: s.spot ?? 0 });
  }
  await Promise.all([...wanted].map(async ([key, row]) => {
    pins.set(key, await pinOf(row.ticker, row.expiry, row.spot));
  }));
  const bySlot = new Map<string, Setup[]>();
  for (const s of setups) {
    const key = slotOf(s);
    const list = bySlot.get(key) ?? [];
    list.push(s);
    bySlot.set(key, list);
  }
  const sleeves = new Set(setups.map(s => s.sleeve));
  const next = new Map(picks);
  const wingNext = new Map(wingPicks);
  const avgNext = new Map(avgPicks);
  const scalpNext = new Map(scalpPicks);
  const books = [wingNext, avgNext, scalpNext, next];
  if (merge) {
    for (const s of setups) {
      const slot = slotOf(s);
      const had = next.get(slot);
      if (had && !seen.has(had.id)) next.delete(slot);
      for (const [key, pick] of wingNext) {
        if (pick.ticker === s.ticker && pick.sleeve === s.sleeve && !seen.has(key)) wingNext.delete(key);
      }
      for (const [key, pick] of avgNext) {
        if (pick.ticker === s.ticker && pick.sleeve === s.sleeve && !seen.has(key)) avgNext.delete(key);
      }
      for (const [key, pick] of scalpNext) {
        if (pick.ticker === s.ticker && pick.sleeve === s.sleeve && !seen.has(key)) scalpNext.delete(key);
      }
    }
  } else {
    for (const [key, pick] of picks) if (sleeves.has(pick.sleeve) && !seen.has(pick.id)) next.delete(key);
    for (const [key, pick] of wingPicks) if (sleeves.has(pick.sleeve) && !seen.has(key)) wingNext.delete(key);
    for (const [key, pick] of avgPicks) if (sleeves.has(pick.sleeve) && !seen.has(key)) avgNext.delete(key);
    for (const [key, pick] of scalpPicks) if (sleeves.has(pick.sleeve) && !seen.has(key)) scalpNext.delete(key);
  }
  for (const [, list] of bySlot) {
    const ticker = list[0].ticker;
    const under = UNDER[ticker] ?? ticker;
    const indexName = INDEX.has(ticker) || INDEX.has(under);
    const tape = tapeOf(book.get(under) ?? [], indexName, minute);
    const report = list[0].sleeve === 'weekly' ? reports.weekly : reports.odte;
    if (!(tape.S > 0)) {
      report.quiet += list.length;
      continue;
    }
    const horizon = yearsLeft(list[0], tape.tt);
    const { iv, skew } = atmPair(list, tape.S, horizon);
    const etf = SECTOR_OF[under] ?? SECTOR_OF[ticker] ?? '';
    const sec = etf ? secBars.get(etf) ?? [] : [];
    const curve = curveOf(under);
    const move = impulse(tape);
    const range = tape.H - tape.L;
    const retOpen = tape.op > 0 && tape.S > 0 ? tape.S / tape.op - 1 : 0;
    const stretchDown = range > 0 ? (tape.H - tape.S) / range : 0;
    const stretchUp = range > 0 ? (tape.S - tape.L) / range : 0;
    const wingSide: OptionRight | null = stretchDown >= 0.85 && retOpen <= -0.0035 ? 'C' : stretchUp >= 0.85 && retOpen >= 0.0035 ? 'P' : null;
    let entry: Scored | null = null;
    let runner: Scored | null = null;
    let avgCall: Scored | null = null;
    let avgPut: Scored | null = null;
    let wing: (Scored & { prob: number }) | null = null;
    const notes: string[] = [];
    for (const s of list) {
      const mid = (s.bid + s.ask) / 2;
      const fresh = !!s.quotedAt && now - s.quotedAt <= 30_000;
      const word = s.contract;
      const tradable = spreadOk(s.bid, s.ask);
      if (!fresh) notes.push(`${word} quote is off the scan minute`);
      else if (!tradable) notes.push(`${word} ${mid < 1 ? 'spread is over 25%' : 'spread is over 8%'}`);
      if (!fresh || !tradable) continue;
      noteMid(s.id, quoteMinute(s, Date.now()), mid);
      const pin = pins.get(`${s.ticker}|${s.expiryDate}`) ?? null;
      const x = features(s, minute, book.get(under) ?? [], spy, pd.get(under) ?? null, iv, skew, sec, curve, pin);
      if (!x) continue;
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
      if (seen.has(s.id)) {
        if ((wingNext.get(s.id)?.band ?? avgNext.get(s.id)?.band) !== 'wing') lift(s.id, p1, prun, books);
        notes.push(`${word} p1 ${(p1 * 100).toFixed(0)}%`);
        continue;
      }
      const row = { setup: s, p1, prun };
      if (wingSide && s.right === wingSide) {
        const delta = Math.abs(s.greeks.delta);
        if (Number.isFinite(delta) && delta >= 0.08 && delta <= 0.25) {
          const dist = Math.abs(delta - WING_DELTA);
          const stretch = wingSide === 'C' ? stretchDown : stretchUp;
          const prob = fitted(wingFit, [stretch, retOpen, Math.log(Math.max(mid, 0.01))]);
          if (prob > 0 && (!wing || dist < Math.abs(Math.abs(wing.setup.greeks.delta) - WING_DELTA))) wing = { ...row, prob };
        }
      }
      if (p1 >= P1_MIN) {
        if (!entry || p1 > entry.p1) entry = row;
        if (prun >= PRUN_MIN && (!runner || prun > runner.prun)) runner = row;
        continue;
      }
      if (p1 >= AVG_BAND) {
        if (s.right === 'P') { if (!avgPut || p1 > avgPut.p1) avgPut = row; }
        else if (!avgCall || p1 > avgCall.p1) avgCall = row;
      } else if (move.side && s.right === move.side) {
        const delta = Math.abs(s.greeks.delta);
        if (Number.isFinite(delta) && delta >= 0.25 && delta <= 0.65) {
          const money = tape.S > 0 ? Math.abs(tape.S - s.strike) / tape.S : 1;
          const prob = fitted(scalpFit, [move.ret5, move.ret15, 1, money]);
          if (prob > 0) pendingScalp.push({ sleeve: s.sleeve, row, prob });
        }
      }
      notes.push(`${word} p1 ${(p1 * 100).toFixed(0)}%`);
    }
    passed.set(ticker, notes.slice(0, 6));
    if (entry && !seen.has(entry.setup.id)) {
      const kept = keepOne(entry, runner);
      seen.add(kept.id);
      next.set(slotOf(kept), kept);
    }
    if (wing && !seen.has(wing.setup.id)) wingNext.set(wing.setup.id, asWing(wing, wing.prob));
    for (const row of [avgCall, avgPut]) {
      if (!row || seen.has(row.setup.id)) continue;
      avgNext.set(row.setup.id, asAverage(row));
    }
  }
  picks.clear();
  for (const [key, pick] of next) picks.set(key, pick);
  wingPicks.clear();
  for (const [key, pick] of wingNext) wingPicks.set(key, pick);
  avgPicks.clear();
  for (const [key, pick] of avgNext) avgPicks.set(key, pick);
  scalpPicks.clear();
  for (const [key, pick] of scalpNext) scalpPicks.set(key, pick);
}

function quoteMinute(s: Setup, now: number): number {
  return s.quotedAt ? minuteOf(s.quotedAt) : minuteOf(now);
}

function refresh(setups: Setup[]): void {
  const byId = new Map(setups.map(s => [s.id, s]));
  for (const [key, pick] of [...picks]) {
    const live = byId.get(pick.id);
    if (!live) continue;
    const mid = (live.bid + live.ask) / 2;
    const spread = mid > 0 ? (live.ask - live.bid) / mid : 1;
    noteMid(pick.id, quoteMinute(live, Date.now()), mid);
    if (!spreadOk(live.bid, live.ask)) {
      noteLeft(pick, 'Rejected');
      continue;
    }
    const slot = slotOf(pick);
    if (key !== slot) picks.delete(key);
    picks.set(slot, { ...live, p1: pick.p1, prun: pick.prun, runner: pick.runner, modelAgree: pick.modelAgree, better: pick.better, band: pick.band, strength: pick.strength, seenAt: pick.seenAt });
  }
  for (const [key, pick] of [...avgPicks]) {
    const live = byId.get(pick.id);
    if (!live) continue;
    const mid = (live.bid + live.ask) / 2;
    const spread = mid > 0 ? (live.ask - live.bid) / mid : 1;
    noteMid(pick.id, quoteMinute(live, Date.now()), mid);
    if (!spreadOk(live.bid, live.ask)) {
      noteLeft(pick, 'Rejected');
      continue;
    }
    avgPicks.set(key, { ...live, p1: pick.p1, prun: pick.prun, runner: pick.runner, modelAgree: pick.modelAgree, better: pick.better, band: 'average', strength: pick.strength, seenAt: pick.seenAt });
  }
  for (const [key, pick] of [...scalpPicks]) {
    const live = byId.get(pick.id);
    if (!live) continue;
    const mid = (live.bid + live.ask) / 2;
    const spread = mid > 0 ? (live.ask - live.bid) / mid : 1;
    noteMid(pick.id, quoteMinute(live, Date.now()), mid);
    if (!spreadOk(live.bid, live.ask)) {
      noteLeft(pick, 'Rejected');
      continue;
    }
    scalpPicks.set(key, { ...live, p1: pick.p1, prun: pick.prun, runner: false, modelAgree: false, better: 'entry', band: pick.band ?? 'scalp', strength: pick.strength, seenAt: pick.seenAt });
  }
  for (const [key, pick] of [...wingPicks]) {
    const live = byId.get(pick.id);
    if (!live) continue;
    const mid = (live.bid + live.ask) / 2;
    noteMid(pick.id, quoteMinute(live, Date.now()), mid);
    if (!spreadOk(live.bid, live.ask)) {
      noteLeft(pick, 'Rejected');
      continue;
    }
    wingPicks.set(key, { ...live, p1: pick.p1, prun: pick.prun, runner: true, modelAgree: false, better: 'runner', band: 'wing', strength: pick.strength, seenAt: pick.seenAt });
  }
}

export async function scoreBook(setups: Setup[], now = Date.now(), merge = false): Promise<void> {
  await scoreAll(setups, now, merge);
}

export function noteMids(setups: Setup[], now = Date.now()): void {
  for (const s of setups) noteMid(s.id, quoteMinute(s, now), s.mid);
}

export function refreshQuotes(setups: Setup[], _now = Date.now()): void {
  refresh(setups);
}

export function pickTickers(): string[] {
  return [...picks.values()].map(s => s.ticker);
}

let claimedSlot = -2;
const claimedSleeves = new Set<string>();

function scanSlot(now: number): number {
  const p = nyParts(now);
  if (p.weekday === 0 || p.weekday === 6) return -1;
  const m = p.hour * 60 + p.minute;
  const open = 9 * 60 + 30;
  const last = 15 * 60;
  if (m < open || m > last) return -1;
  return Math.floor((m - open) / 5);
}

/** One full pass per sleeve per 5-minute slot. 0DTE and weekly do not steal each other's slot. */
export function claimSlot(now: number, sleeve: string): 'closed' | 'scan' | 'hold' {
  const next = scanSlot(now);
  if (next < 0) {
    if (claimedSlot !== -1) {
      claimedSlot = -1;
      claimedSleeves.clear();
      picks.clear();
      wingPicks.clear();
      avgPicks.clear();
      scalpPicks.clear();
      pendingScalp.length = 0;
      seen.clear();
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

export async function lockToSlot(setups: Setup[], now = Date.now()): Promise<void> {
  const next = claimSlot(now, 'book');
  if (next === 'closed') return;
  for (const s of setups) noteMid(s.id, quoteMinute(s, now), s.mid);
  if (next === 'scan') await scoreAll(setups, now);
  else refresh(setups);
}
