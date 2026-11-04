/*
  MODEL 4 — EVENT 0DTE. Definition only.

  Not fitted. Not validated. No coefficients. No score. The three engines are independent: nothing in this file
  adds them, weights them, or turns them into one call. Weekly, swing, position and long-dated do not use it.
  Same-day expiration only. Regular session 09:30–16:00 America/New_York. Universe: SPY, QQQ, IWM, SPXW.

  This is not Model 1, Model 2 or Model 3, and it is not a seat on the board.
*/

import { blackScholesGreeks, impliedVolFromPrice } from '../core/greeks';

export const MODEL4 = {
  id: 4,
  name: 'EVENT 0DTE',
  status: 'definition',
  fitted: false,
  validated: false,
  coefficients: null,
  score: null,
  sleeve: 'odte',
  session: '09:30-16:00 America/New_York',
  expiry: 'same-day',
  /** European Black-Scholes. Not the Model 1 carry (that rate is 0.042) and not a vendor greek. */
  r: 0.04,
  q: 0,
  combine: false,
} as const;

export const UNIVERSE = ['SPY', 'QQQ', 'IWM', 'SPXW'] as const;
export type Model4Name = (typeof UNIVERSE)[number];
export type EquityName = 'SPY' | 'QQQ' | 'IWM';
export type Side = 'call' | 'put';
export type EngineId = '4A' | '4B' | '4C';

/** One-contract round trip, the schedule stated at a $1 premium. Not scaled. The spread is not in it. */
export const FEE_AT_ONE = { SPY: 0.09, QQQ: 0.09, IWM: 0.09, SPXW: 2.26 } as const;

export const SESSION_MINUTES = 390;
export const YEAR_SESSIONS = 252;
/** Minute index 0 is 09:30. The last bar is 389, covering [15:59, 16:00). */
export const LAST_MINUTE = SESSION_MINUTES - 1;

export const LOOKBACK_4A = 15;
export const LOOKBACK_4C = 30;
export const RECLAIM_SEC = 60;
export const ABSORB_SIZE = 100;
export const BREAK_UP = 1.001;
export const BREAK_DOWN = 0.999;
export const TICK = { SPY: 0.01, QQQ: 0.01, IWM: 0.01, SPX: 0.1 } as const;

export const TARGET = 0.5;
export const STOP = -0.25;
export const PRIMARY_H = 5;
export const FIXED_HORIZONS = [1, 2, 5, 10, 15, 30] as const;

export const DELTA_CALL = { lo: 0.4, hi: 0.6 } as const;
export const DELTA_PUT = { lo: -0.6, hi: -0.4 } as const;

/** Stored if a feed has them. None of these creates a signal. No key is loaded for the flow and dark-pool fields. */
export const NOT_ENTRY_INPUTS = [
  'RSI',
  'indicator weights',
  'an 80% confidence score',
  'dealer positioning',
  'open interest as a dealer sign',
  'Unusual Whales flow',
  'dark pool',
  'option signed flow',
  'best-level OFI',
  'microprice',
] as const;

export interface Aside {
  optionSignedFlow: number | null;
  ofi: number | null;
  microprice: number | null;
}

/** May be stored from strike-range-1 trade-quotes, or from the book. It does not create the signal. */
export function signalFromAside(_aside: Aside): null {
  return null;
}

export function isModel4Name(name: string): name is Model4Name {
  return (UNIVERSE as readonly string[]).includes(name);
}

/** SPXW is priced off SPX. XSP is not rescaled into it, and SPX is not mixed with SPXW. */
export function underlyingSymbol(root: Model4Name): 'SPY' | 'QQQ' | 'IWM' | 'SPX' {
  return root === 'SPXW' ? 'SPX' : root;
}

export function model4OnOdte(sleeve: string): typeof MODEL4 | null {
  return sleeve === 'odte' ? MODEL4 : null;
}

function odteOnly(sleeve: 'odte'): void {
  if (sleeve !== 'odte') throw new Error('Model 4 is the 0DTE book only');
}

export function feeRoundTrip(root: Model4Name): number {
  return FEE_AT_ONE[root];
}

/** Realized option return minus the round trip, as a return. The spread is already in the ask and the bid. */
export function netReturn(root: Model4Name, realized: number, entryAsk: number): number | null {
  if (!(entryAsk > 0) || !Number.isFinite(realized)) return null;
  return realized - feeRoundTrip(root) / (entryAsk * 100);
}

export function inSessionMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute <= LAST_MINUTE;
}

/** Tick event inside minute m: selection is m−1, entry is m+1. Bar event known at the close of m: selection is m, entry is m+1. */
export function snapshotsFor(clock: 'tick' | 'bar', eventMinute: number): { selection: number; entry: number } | null {
  if (!inSessionMinute(eventMinute)) return null;
  const selection = clock === 'tick' ? eventMinute - 1 : eventMinute;
  const entry = eventMinute + 1;
  if (!inSessionMinute(selection) || !inSessionMinute(entry)) return null;
  return { selection, entry };
}

/** minutes_left = 390 − (selection_minute + 1). No time left is not a price: the 0.0001 year floor is not used. */
export function minutesLeft(selectionMinute: number): number | null {
  if (!inSessionMinute(selectionMinute)) return null;
  const left = SESSION_MINUTES - (selectionMinute + 1);
  return left > 0 ? left : null;
}

export function yearFrac(selectionMinute: number): number | null {
  const left = minutesLeft(selectionMinute);
  return left == null ? null : left / (SESSION_MINUTES * YEAR_SESSIONS);
}

export function quoteMid(bid: number, ask: number): number | null {
  if (!(ask > 0) || !(bid >= 0) || !(ask >= bid) || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return (bid + ask) / 2;
}

function dayKey(value: string): string {
  return value.replace(/\D/g, '');
}

export function sameDayExpiry(expiry: string, sessionDay: string): boolean {
  const a = dayKey(expiry);
  const b = dayKey(sessionDay);
  return a.length === 8 && a === b;
}

export interface OptionQuote {
  root: Model4Name;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
}

/** The one-minute option snapshot is the last quote of that minute. It is known at minute+1, not at the open. */
export interface ChainSnapshot {
  minute: number;
  asOf: 'last';
  quotes: readonly OptionQuote[];
  underlying: number;
  underlyingSymbol: 'SPY' | 'QQQ' | 'IWM' | 'SPX';
}

export interface Selected {
  root: Model4Name;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  delta: number;
  iv: number;
  mid: number;
}

/** Smallest ||delta| − 0.50|, then the lower strike. One contract. A delta outside the band is not eligible. */
export function chooseContract(side: Side, rows: readonly { strike: number; delta: number }[]): { strike: number; delta: number } | null {
  const lo = side === 'call' ? DELTA_CALL.lo : DELTA_PUT.lo;
  const hi = side === 'call' ? DELTA_CALL.hi : DELTA_PUT.hi;
  const band = rows.filter(r => r.delta >= lo && r.delta <= hi && Number.isFinite(r.strike));
  if (!band.length) return null;
  band.sort((a, b) => {
    const da = Math.abs(Math.abs(a.delta) - 0.5);
    const db = Math.abs(Math.abs(b.delta) - 0.5);
    if (da !== db) return da - db;
    return a.strike - b.strike;
  });
  return band[0];
}

function deltaOf(right: 'C' | 'P', spot: number, strike: number, t: number, iv: number): number | null {
  if (!(iv > 0) || !(t > 0) || !(spot > 0) || !(strike > 0)) return null;
  const g = blackScholesGreeks(spot, strike, t, iv, MODEL4.r, MODEL4.q);
  const delta = right === 'C' ? g.deltaCall : g.deltaPut;
  return Number.isFinite(delta) ? delta : null;
}

export function selectContract(root: Model4Name, side: Side, snap: ChainSnapshot, sessionDay: string): Selected | null {
  if (snap.asOf !== 'last') return null;
  if (snap.underlyingSymbol !== underlyingSymbol(root)) return null;
  if (!(snap.underlying > 0)) return null;
  const t = yearFrac(snap.minute);
  if (t == null) return null;
  const right: 'C' | 'P' = side === 'call' ? 'C' : 'P';
  const byStrike = new Map<number, OptionQuote | 'bad'>();
  for (const q of snap.quotes) {
    if (q.root !== root || q.right !== right || !sameDayExpiry(q.expiry, sessionDay)) continue;
    if (!(q.strike > 0)) continue;
    const prev = byStrike.get(q.strike);
    if (!prev) byStrike.set(q.strike, q);
    else if (prev === 'bad' || prev.bid !== q.bid || prev.ask !== q.ask || prev.expiry !== q.expiry) byStrike.set(q.strike, 'bad');
  }
  const priced: { strike: number; delta: number; iv: number; mid: number; expiry: string }[] = [];
  for (const q of byStrike.values()) {
    if (q === 'bad') continue;
    const mid = quoteMid(q.bid, q.ask);
    if (mid == null) continue;
    const iv = impliedVolFromPrice(mid, snap.underlying, q.strike, t, right, MODEL4.r, MODEL4.q);
    if (iv == null || !(iv > 0)) continue;
    const delta = deltaOf(right, snap.underlying, q.strike, t, iv);
    if (delta == null) continue;
    priced.push({ strike: q.strike, delta, iv, mid, expiry: q.expiry });
  }
  const picked = chooseContract(side, priced);
  if (!picked) return null;
  const row = priced.find(r => r.strike === picked.strike && r.delta === picked.delta);
  if (!row) return null;
  return { root, expiry: row.expiry, strike: row.strike, right, delta: row.delta, iv: row.iv, mid: row.mid };
}

export interface Model4Event {
  engine: EngineId;
  side: Side;
  /** Minute the event belongs to. A bar's close is this minute's end, not the next minute's index. */
  eventMinute: number;
  /** Seconds from 09:30. */
  eventSec: number;
  clock: 'tick' | 'bar';
  /** Tick: the event minute. Bar: the next minute, when the close is known. */
  knownAtMinute: number;
}

export interface SweepEvent extends Model4Event {
  engine: '4A';
  level: number;
  sweepDistance: number;
  path: 'tape' | 'unknown';
  pierceSec?: number;
  reclaim?: number;
}

export interface AbsorbEvent extends Model4Event {
  engine: '4B';
}

export interface BreakEvent extends Model4Event {
  engine: '4C';
  priorHigh: number;
  priorLow: number;
  close: number;
}

export type EntrySkip = 'clock' | 'underlying' | 'snapshot' | 'no-contract' | 'no-entry';

export type EntryPlan =
  | { status: 'in'; entryAsk: number; entryMinute: number; selectionMinute: number; contract: Selected }
  | { status: 'skip'; reason: EntrySkip };

function sameContract(q: OptionQuote, c: Selected): boolean {
  return q.root === c.root && q.right === c.right && q.strike === c.strike && sameDayExpiry(q.expiry, c.expiry);
}

/** Ask of the selected contract on the entry snapshot. No snapshot, no size, or a non-positive ask is a skip. No invented fill. */
export function planEntry(sleeve: 'odte', root: Model4Name, event: Model4Event, selection: ChainSnapshot | null, entry: ChainSnapshot | null, sessionDay: string): EntryPlan {
  odteOnly(sleeve);
  const clock = snapshotsFor(event.clock, event.eventMinute);
  if (!clock) return { status: 'skip', reason: 'clock' };
  if (!selection || selection.asOf !== 'last' || selection.minute !== clock.selection) return { status: 'skip', reason: 'snapshot' };
  if (selection.underlyingSymbol !== underlyingSymbol(root)) return { status: 'skip', reason: 'underlying' };
  const contract = selectContract(root, event.side, selection, sessionDay);
  if (!contract) return { status: 'skip', reason: 'no-contract' };
  if (!entry || entry.asOf !== 'last' || entry.minute !== clock.entry) return { status: 'skip', reason: 'no-entry' };
  const quote = entry.quotes.find(q => sameContract(q, contract));
  if (!quote || !(quote.ask > 0) || !(quote.askSize > 0)) return { status: 'skip', reason: 'no-entry' };
  return { status: 'in', entryAsk: quote.ask, entryMinute: clock.entry, selectionMinute: clock.selection, contract };
}

export interface ExecBid {
  bid: number;
  bidSize: number;
}

/** Executable bid only. A missing bid, a zero bid, or an empty size is a gap, not a zero. */
export function horizonReturn(entryAsk: number, bid: ExecBid | undefined): number | null {
  if (!(entryAsk > 0) || !bid || !(bid.bid > 0) || !(bid.bidSize > 0) || !Number.isFinite(bid.bid)) return null;
  return bid.bid / entryAsk - 1;
}

export type PrimaryResult =
  | { status: 'target' | 'stop' | 'timeout'; k: number; realized: number; net: number; hold: number }
  | { status: 'censored'; k: number; realized: null; net: null; hold: number }
  | { status: 'skip'; k: null; realized: null; net: null; hold: null };

/**
 * Walk k = 1..5 in order. The first of gap, target (return ≥ +0.50), stop (return ≤ −0.25) stands.
 * A hit fills at the observed return, not at the barrier. A gap before a hit is censored. Timeout only if all five exist.
 */
export function primaryTest(root: Model4Name, entryAsk: number, bidAt: (k: number) => ExecBid | undefined): PrimaryResult {
  if (!(entryAsk > 0)) return { status: 'skip', k: null, realized: null, net: null, hold: null };
  let last: number | null = null;
  for (let k = 1; k <= PRIMARY_H; k++) {
    const ret = horizonReturn(entryAsk, bidAt(k));
    if (ret == null) return { status: 'censored', k, realized: null, net: null, hold: k };
    last = ret;
    if (ret >= TARGET) {
      const net = netReturn(root, ret, entryAsk);
      if (net == null) return { status: 'skip', k: null, realized: null, net: null, hold: null };
      return { status: 'target', k, realized: ret, net, hold: k };
    }
    if (ret <= STOP) {
      const net = netReturn(root, ret, entryAsk);
      if (net == null) return { status: 'skip', k: null, realized: null, net: null, hold: null };
      return { status: 'stop', k, realized: ret, net, hold: k };
    }
  }
  if (last == null) return { status: 'censored', k: PRIMARY_H, realized: null, net: null, hold: PRIMARY_H };
  const net = netReturn(root, last, entryAsk);
  if (net == null) return { status: 'skip', k: null, realized: null, net: null, hold: null };
  return { status: 'timeout', k: PRIMARY_H, realized: last, net, hold: PRIMARY_H };
}

/** The executable bid exactly this many minutes after entry. Not the barrier test. A gap is null, not 0. */
export function fixedHorizons(entryAsk: number, bidAt: (minutesAfter: number) => ExecBid | undefined): Record<(typeof FIXED_HORIZONS)[number], number | null> {
  const out = { 1: null, 2: null, 5: null, 10: null, 15: null, 30: null } as Record<(typeof FIXED_HORIZONS)[number], number | null>;
  for (const k of FIXED_HORIZONS) out[k] = horizonReturn(entryAsk, bidAt(k));
  return out;
}

export interface OpenPosition {
  root: Model4Name;
  entryMinute: number;
  hold: number;
}

/** A new signal in the same name at or before entry_minute + hold is skipped. Other names are not. */
export function signalSkipped(open: readonly OpenPosition[], root: Model4Name, signalMinute: number): boolean {
  return open.some(p => p.root === root && signalMinute <= p.entryMinute + p.hold);
}

export interface TapePrint {
  sec: number;
  price: number;
  size: number;
}

function minuteOf(sec: number): number {
  return Math.floor(sec / 60);
}

function sessionPrint(p: TapePrint): boolean {
  return Number.isFinite(p.sec) && p.sec >= 0 && p.sec < SESSION_MINUTES * 60 && Number.isFinite(p.price) && p.price > 0;
}

function levelOf(trades: readonly TapePrint[], minute: number, lookback: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const t of trades) {
    if (!sessionPrint(t)) continue;
    const m = minuteOf(t.sec);
    if (m >= minute - lookback && m < minute) {
      lo = Math.min(lo, t.price);
      hi = Math.max(hi, t.price);
      n++;
    }
  }
  return n ? { lo, hi } : null;
}

interface SweepHit {
  side: Side;
  eventSec: number;
  level: number;
  sweepDistance: number;
  pierceSec: number;
  reclaim: number;
}

/** First pierce, then the first reclaim within 60 seconds. No reclaim in that window is no event. A later pierce is not a second try. */
function sweepSide(trades: readonly TapePrint[], minute: number, level: number, side: Side, eps: number): SweepHit | null {
  const down = side === 'call';
  const start = minute * 60;
  const end = (minute + 1) * 60;
  const ordered = trades.filter(sessionPrint).sort((a, b) => a.sec - b.sec);
  let pierce: TapePrint | null = null;
  let extreme = down ? Infinity : -Infinity;
  for (const t of ordered) {
    if (t.sec < start) continue;
    const past = down ? t.price <= level - eps : t.price >= level + eps;
    const back = down ? t.price >= level : t.price <= level;
    if (!pierce) {
      if (t.sec >= end) break;
      if (past) {
        pierce = t;
        extreme = t.price;
      }
      continue;
    }
    if (t.sec - pierce.sec > RECLAIM_SEC) return null;
    if (back) {
      if (minuteOf(t.sec) !== minute) return null;
      const sweepDistance = down ? level - extreme : extreme - level;
      return { side, eventSec: t.sec, level, sweepDistance, pierceSec: pierce.sec, reclaim: t.price };
    }
    if (down ? t.price < extreme : t.price > extreme) extreme = t.price;
  }
  return null;
}

function asTick(hit: SweepHit): SweepEvent {
  const eventMinute = minuteOf(hit.eventSec);
  return {
    engine: '4A',
    side: hit.side,
    eventMinute,
    eventSec: hit.eventSec,
    clock: 'tick',
    knownAtMinute: eventMinute,
    level: hit.level,
    sweepDistance: hit.sweepDistance,
    path: 'tape',
    pierceSec: hit.pierceSec,
    reclaim: hit.reclaim,
  };
}

/**
 * 4A on SPY, QQQ, IWM, from the trade tape. Down through L_m − 0.01 and back through L_m is the call.
 * Up through H_m + 0.01 and back through H_m is the put. SPXW does not use this: SPX has no stock tape.
 * Both sides, if both print, are two events. Array order is time, not a rank, and not a blend.
 */
export function sweepEquity(sleeve: 'odte', root: EquityName, prints: readonly TapePrint[], minute: number): SweepEvent[] {
  odteOnly(sleeve);
  if (!inSessionMinute(minute) || minute < LOOKBACK_4A) return [];
  const level = levelOf(prints, minute, LOOKBACK_4A);
  if (!level) return [];
  const eps = TICK[root];
  const hits = [sweepSide(prints, minute, level.lo, 'call', eps), sweepSide(prints, minute, level.hi, 'put', eps)].filter((h): h is SweepHit => h != null);
  hits.sort((a, b) => a.eventSec - b.eventSec);
  return hits.map(asTick);
}

export interface MinuteBar {
  minute: number;
  high: number;
  low: number;
  close: number;
}

function barIndex(bars: readonly MinuteBar[]): Map<number, MinuteBar> | null {
  const map = new Map<number, MinuteBar>();
  for (const b of bars) {
    if (!Number.isInteger(b.minute) || !(b.high > 0) || !(b.low > 0) || !(b.close > 0)) continue;
    if (b.low > b.high) return null;
    const prev = map.get(b.minute);
    if (!prev) map.set(b.minute, b);
    else if (prev.high !== b.high || prev.low !== b.low || prev.close !== b.close) return null;
  }
  return map;
}

function rangeOf(map: Map<number, MinuteBar>, minute: number, lookback: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (let m = minute - lookback; m < minute; m++) {
    const b = map.get(m);
    if (!b) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
    n++;
  }
  return n ? { lo, hi } : null;
}

/**
 * 4A on SPXW, from SPX minute bars only. The path inside the bar is unknown.
 * Call: low_m ≤ L_m − 0.10 and close_m ≥ L_m. Put: high_m ≥ H_m + 0.10 and close_m ≤ H_m. Known at the close of m.
 */
export function sweepIndex(sleeve: 'odte', bars: readonly MinuteBar[], minute: number): SweepEvent[] {
  odteOnly(sleeve);
  if (!inSessionMinute(minute) || minute < LOOKBACK_4A) return [];
  const map = barIndex(bars);
  if (!map) return [];
  const level = rangeOf(map, minute, LOOKBACK_4A);
  const bar = map.get(minute);
  if (!level || !bar) return [];
  const eps = TICK.SPX;
  const out: SweepEvent[] = [];
  const base = { engine: '4A' as const, eventMinute: minute, eventSec: (minute + 1) * 60, clock: 'bar' as const, knownAtMinute: minute + 1, path: 'unknown' as const };
  if (bar.low <= level.lo - eps && bar.close >= level.lo) {
    out.push({ ...base, side: 'call', level: level.lo, sweepDistance: level.lo - bar.low });
  }
  if (bar.high >= level.hi + eps && bar.close <= level.hi) {
    out.push({ ...base, side: 'put', level: level.hi, sweepDistance: bar.high - level.hi });
  }
  return out;
}

export interface Nbbo {
  sec: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
}

export interface SignedPrint {
  sec: number;
  price: number;
  size: number;
  bid: number;
  ask: number;
}

function inSecond(sec: number, second: number): boolean {
  return sec >= second && sec < second + 1;
}

/**
 * 4B. SPY, QQQ, IWM trade-quote tape only. One second, and only the prints inside it. The next second is not an input.
 * Buy print: price ≥ ask and price > bid, ask > bid. Sell print: price ≤ bid and price < ask, ask > bid.
 * Inside, locked or crossed quotes are neither. Put: the ask is hit for at least its size and the last trade does not lift it.
 * Call: the bid is hit for at least its size and the last trade does not drop it.
 */
export function absorption(sleeve: 'odte', root: EquityName, second: number, quotes: readonly Nbbo[], prints: readonly SignedPrint[]): AbsorbEvent[] {
  odteOnly(sleeve);
  if (!Number.isInteger(second) || second < 0 || second >= SESSION_MINUTES * 60) return [];
  const qs = quotes.filter(q => inSecond(q.sec, second) && Number.isFinite(q.bid) && Number.isFinite(q.ask)).sort((a, b) => a.sec - b.sec);
  const ps = prints.filter(p => inSecond(p.sec, second) && Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.size) && p.size > 0).sort((a, b) => a.sec - b.sec);
  if (!qs.length || !ps.length) return [];
  const first = qs[0];
  const last = ps[ps.length - 1];
  let buy = 0;
  let sell = 0;
  for (const p of ps) {
    const lockedOrCrossed = !(p.ask > p.bid);
    if (lockedOrCrossed) continue;
    if (p.price >= p.ask && p.price > p.bid) buy += p.size;
    else if (p.price <= p.bid && p.price < p.ask) sell += p.size;
  }
  const eventMinute = minuteOf(last.sec);
  const base = { engine: '4B' as const, eventMinute, eventSec: last.sec, clock: 'tick' as const, knownAtMinute: eventMinute };
  const out: AbsorbEvent[] = [];
  if (first.askSize >= ABSORB_SIZE && buy >= first.askSize && last.price <= first.ask) out.push({ ...base, side: 'put' });
  if (first.bidSize >= ABSORB_SIZE && sell >= first.bidSize && last.price >= first.bid) out.push({ ...base, side: 'call' });
  return out;
}

/** Trade-tape minute extremes for SPY, QQQ, IWM. Close is the last trade. Not an SPX bar. */
export function equityMinutes(prints: readonly TapePrint[]): MinuteBar[] {
  const map = new Map<number, { high: number; low: number; close: number; sec: number }>();
  const ordered = prints.filter(sessionPrint).sort((a, b) => a.sec - b.sec);
  for (const p of ordered) {
    const m = minuteOf(p.sec);
    const row = map.get(m);
    if (!row) map.set(m, { high: p.price, low: p.price, close: p.price, sec: p.sec });
    else {
      row.high = Math.max(row.high, p.price);
      row.low = Math.min(row.low, p.price);
      if (p.sec >= row.sec) {
        row.close = p.price;
        row.sec = p.sec;
      }
    }
  }
  return [...map.entries()].map(([minute, row]) => ({ minute, high: row.high, low: row.low, close: row.close }));
}

/**
 * 4C. Close above the prior 30 completed minutes' high by 0.1% is the call. Close below that low by 0.1% is the put.
 * Minute m is not inside its own range, and minute m+1 is not an input. This is the break, not the failed break.
 * SPY, QQQ, IWM use the tape's extremes. SPXW uses SPX minute bars. A mismatched source is no event.
 */
export function breakout(sleeve: 'odte', root: Model4Name, source: 'tape' | 'SPX', minutes: readonly MinuteBar[], minute: number): BreakEvent | null {
  odteOnly(sleeve);
  if (root === 'SPXW' ? source !== 'SPX' : source !== 'tape') return null;
  if (!inSessionMinute(minute) || minute < LOOKBACK_4C) return null;
  const map = barIndex(minutes);
  if (!map) return null;
  const prior = rangeOf(map, minute, LOOKBACK_4C);
  const bar = map.get(minute);
  if (!prior || !bar) return null;
  const call = bar.close > prior.hi * BREAK_UP;
  const put = bar.close < prior.lo * BREAK_DOWN;
  if (call === put) return null;
  return {
    engine: '4C',
    side: call ? 'call' : 'put',
    eventMinute: minute,
    eventSec: (minute + 1) * 60,
    clock: 'bar',
    knownAtMinute: minute + 1,
    priorHigh: prior.hi,
    priorLow: prior.lo,
    close: bar.close,
  };
}
