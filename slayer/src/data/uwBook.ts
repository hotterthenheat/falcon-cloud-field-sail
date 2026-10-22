/*
  Pinpoint's book, from Unusual Whales.

  The browser asks /api/uw. The server holds the token. Spot, the strike
  book, open interest, today's tape and (for the name on screen) each
  expiry's own gamma are the vendor's rows. Walls and the flip are still
  named here, off those rows.

  Sign. UW prints call gamma positive and put gamma negative. This house
  prints call-dominant shelves NEGATIVE and put-dominant shelves POSITIVE
  (core/walls.ts). Negating both legs lands on that, and the net flips
  with them, so a put-heavy strike stays the one that amplifies.
*/

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { startPinpoint } from './vendorFeed';
import { bookToday, expiryFor, isoDate } from '../core/calendar';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { pickFlip, pickWalls } from '../core/walls';
import type { Candle, GexSnapshot, Indicators, MarketSnapshot, StrikeNode, TradePlan } from '../types/market';
import { getDeskSession, minuteInSession, type DeskSession } from './deskSession';
import { readLevelsScope, useLevelsScope, type LevelsScope } from './levelsScope';
import {
  uwCall,
  whalesBars,
  whalesFlowStrike,
  whalesGreekExpiry,
  whalesGreekStrike,
  whalesGreekStrikeExpiry,
  whalesIvRank,
  whalesInterpIv,
  whalesOiStrike,
  whalesOptionContracts,
  whalesState,
  whalesTermStructure,
  type UwBar,
  type UwContract,
  type UwFlowStrike,
  type UwGreekStrike,
  type UwInterp,
  type UwIv,
  type UwTerm,
} from './whales';

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const BOARD_MS = 90_000;
const FULL_MS = 45_000;

export type BookMode = 'board' | 'full';

interface Entry {
  ticker: string;
  status: 'loading' | 'live' | 'error';
  at: number;
  full: boolean;
  wantFull: boolean;
  spot: number;
  prev: number;
  changePct: number;
  iv: number;
  /** Vendor implied move into today's expiry, dollars. 0 until that row exists. Already the move from the quote — not a full-year vol. */
  impliedMove: number;
  /** One session of the surface, as a fraction of spot (interpolated 1-day). 0 until it lands. */
  dayMoveFrac: number;
  all: StrikeNode[];
  byDate: Record<string, StrikeNode[]>;
  expiries: { date: string; dte: number }[];
  flow: Map<number, { call: number; put: number }>;
  /** Cash session only. The book, the clock and the level report read these. */
  candles: Candle[];
  /** Every bar the vendor sent, including premarket and after hours. */
  tape: Candle[];
  history: GexSnapshot[];
  /** When the per-expiry chains last landed. The aggregate refreshes without them. */
  expiriesAt?: number;
}

const cache = new Map<string, Entry>();
const gen = new Map<string, number>();
const listeners = new Set<() => void>();
let rev = 0;

const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const emptyNode = (strike: number): StrikeNode => ({
  strike,
  callOI: 0,
  putOI: 0,
  gamma: 0,
  callGex: 0,
  putGex: 0,
  netGex: 0,
  callDex: 0,
  putDex: 0,
  netDex: 0,
  callVex: 0,
  putVex: 0,
  netVex: 0,
  vanna: 0,
  charm: 0,
  callVanna: 0,
  putVanna: 0,
  netVanna: 0,
  callCharm: 0,
  putCharm: 0,
  netCharm: 0,
});

/** Both gamma legs are negated into the house sign (see the head of this file and core/walls.ts): the vendor's call
    gamma prints positive, the house's call-dominant shelf is NEGATIVE. Left as printed (the live sweep, 2026-10-22),
    pickWalls found no call-dominant shelf above spot and named SPOT the call wall, the put wall landed 80 points away,
    the matrix wore ice on the amplifying side, and a call-heavy book read "amplifying". */
/* AND SCALED INTO THE HOUSE'S UNITS (the vendor's own spec, 2026-10-22): greek-exposure prints each greek × open
   interest × 100 — shares, "without underlying-price scaling". The house book (core/simulator.ts) is dollars: GEX per
   1% move is × spot² × 0.01, DEX × spot, vanna per vol point × 0.01 × spot, charm per session × spot / 252. Read raw,
   SPY's heaviest strike printed $413K of gamma instead of ~$2.5B, so every wall weighed nothing against the market's
   dollars per 1% and the hold odds sat on their 8% floor on every name. */
function nodeFrom(row: UwGreekStrike, spot: number, oi?: { c: number; p: number }): StrikeNode {
  const g = spot > 0 ? spot * spot * 0.01 : 1;
  const d = spot > 0 ? spot : 1;
  const v = spot > 0 ? spot * 0.01 : 1;
  const c = spot > 0 ? spot / 252 : 1;
  const callGex = -num(row.call_gex) * g;
  const putGex = -num(row.put_gex) * g;
  const callDex = -num(row.call_delta) * d;
  const putDex = -num(row.put_delta) * d;
  const callVanna = -num(row.call_vanna) * v;
  const putVanna = -num(row.put_vanna) * v;
  const callCharm = -num(row.call_charm) * c;
  const putCharm = -num(row.put_charm) * c;
  const strike = num(row.strike);
  return {
    ...emptyNode(strike),
    callOI: oi?.c ?? num(row.call_oi),
    putOI: oi?.p ?? num(row.put_oi),
    callGex,
    putGex,
    netGex: callGex + putGex,
    callDex,
    putDex,
    netDex: callDex + putDex,
    callVanna,
    putVanna,
    netVanna: callVanna + putVanna,
    callCharm,
    putCharm,
    netCharm: callCharm + putCharm,
  };
}

function chainFrom(rows: UwGreekStrike[], spot: number, oi: Map<number, { c: number; p: number }>, flow?: Map<number, { call: number; put: number }>): StrikeNode[] {
  const out: StrikeNode[] = [];
  for (const row of rows) {
    const strike = num(row.strike);
    if (!(strike > 0)) continue;
    const node = nodeFrom(row, spot, oi.get(strike));
    const traded = flow?.get(strike);
    if (traded && (traded.call > 0 || traded.put > 0)) {
      node.callVol = traded.call;
      node.putVol = traded.put;
    }
    out.push(node);
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

function oiMap(rows: UwGreekStrike[]): Map<number, { c: number; p: number }> {
  const m = new Map<number, { c: number; p: number }>();
  for (const r of rows) {
    const k = num(r.strike);
    if (k > 0) m.set(k, { c: num(r.call_oi), p: num(r.put_oi) });
  }
  return m;
}

function flowMap(rows: UwFlowStrike[]): Map<number, { call: number; put: number }> {
  const m = new Map<number, { call: number; put: number }>();
  for (const r of rows) {
    const k = num(r.strike);
    if (k > 0) m.set(k, { call: num(r.call_volume), put: num(r.put_volume) });
  }
  return m;
}

function candlesFrom(bars: UwBar[]): { cash: Candle[]; tape: Candle[] } {
  const parsed: Candle[] = [];
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!(close > 0)) continue;
    parsed.push({
      time,
      open: num(b.open) || close,
      high: num(b.high) || close,
      low: num(b.low) || close,
      close,
      volume: num(b.volume) || num(b.total_volume),
    });
  }
  parsed.sort((a, b) => a.time - b.time);
  if (!parsed.length) return { cash: [], tape: [] };
  const day = nyIsoDate(parsed[parsed.length - 1].time * 1000);
  const tape = parsed.filter(b => nyIsoDate(b.time * 1000) === day || nyMinutes(b.time * 1000) >= 20 * 60);
  const session = tape.filter(b => nyMinutes(b.time * 1000) >= OPEN_MIN && nyMinutes(b.time * 1000) < CLOSE_MIN);
  const cash = session.length >= 2 ? session : tape.filter(b => nyIsoDate(b.time * 1000) === day);
  return { cash: cash.length >= 2 ? cash : parsed, tape: tape.length ? tape : parsed };
}

/** OCC tail is YYMMDD + C/P + strike×1000. The root is whatever sits in front. */
function parseOcc(symbol: string): { expiry: string; right: 'CALL' | 'PUT'; strike: number } | null {
  if (symbol.length < 16) return null;
  const tail = symbol.slice(-15);
  const m = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(tail);
  if (!m) return null;
  const strike = Number(m[5]) / 1000;
  if (!(strike > 0)) return null;
  return { expiry: `20${m[1]}-${m[2]}-${m[3]}`, right: m[4] === 'C' ? 'CALL' : 'PUT', strike };
}

/* The simulator's dealer side (core/simulator.ts). Call vega negative, put vega
   negative — dealers are short both. Magnitudes are dollar vega: OI × vega × 100. */
const CALL_VEGA = -0.55;
const PUT_VEGA = -0.53;

interface LegBook {
  callOI: number;
  putOI: number;
  callVex: number;
  putVex: number;
  callVol: number;
  putVol: number;
}

function emptyLeg(): LegBook {
  return { callOI: 0, putOI: 0, callVex: 0, putVex: 0, callVol: 0, putVol: 0 };
}

function foldContracts(rows: UwContract[], expiry: string): Map<number, LegBook> {
  const by = new Map<number, LegBook>();
  for (const row of rows) {
    const parsed = parseOcc(String(row.option_symbol || ''));
    if (!parsed || parsed.expiry !== expiry) continue;
    const oi = num(row.open_interest);
    const vol = num(row.volume);
    const vega = num(row.vega);
    const leg = by.get(parsed.strike) ?? emptyLeg();
    const dollar = oi * 100 * vega;
    if (parsed.right === 'CALL') {
      leg.callOI += oi;
      leg.callVol += vol;
      leg.callVex += dollar * CALL_VEGA;
    } else {
      leg.putOI += oi;
      leg.putVol += vol;
      leg.putVex += dollar * PUT_VEGA;
    }
    by.set(parsed.strike, leg);
  }
  return by;
}

function paintLegs(nodes: StrikeNode[], book: Map<number, LegBook>, oi: boolean): void {
  for (const n of nodes) {
    const leg = book.get(n.strike);
    if (!leg) continue;
    if (oi) {
      n.callOI = leg.callOI;
      n.putOI = leg.putOI;
    }
    n.callVex = leg.callVex;
    n.putVex = leg.putVex;
    n.netVex = leg.callVex + leg.putVex;
    if (leg.callVol > 0 || leg.putVol > 0) {
      n.callVol = leg.callVol;
      n.putVol = leg.putVol;
    }
  }
}

/** Sum the per-expiry vega already on the book onto the aggregate chain. */
function vexOntoAll(entry: Entry): void {
  const agg = new Map<number, { call: number; put: number }>();
  for (const chain of Object.values(entry.byDate)) {
    for (const n of chain) {
      if (!n.callVex && !n.putVex) continue;
      const cur = agg.get(n.strike) ?? { call: 0, put: 0 };
      cur.call += n.callVex;
      cur.put += n.putVex;
      agg.set(n.strike, cur);
    }
  }
  if (!agg.size) return;
  for (const n of entry.all) {
    const v = agg.get(n.strike);
    if (!v) continue;
    n.callVex = v.call;
    n.putVex = v.put;
    n.netVex = v.call + v.put;
  }
}

/** A handful at a time. Forty expiry books at once stall the page that is trying to paint. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: items.length ? workers : 0 }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Open interest and vega the greek-by-expiry rows do not carry. One request a date. */
async function fillExpiryFacts(entry: Entry, token: number): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  const dates = Object.keys(entry.byDate);
  if (!dates.length) return;
  const books = await mapLimit(dates, 3, async date => {
      try {
        const rows = await whalesOptionContracts(entry.ticker, date);
        return [date, Array.isArray(rows) ? foldContracts(rows, date) : new Map<number, LegBook>()] as const;
      } catch {
        return [date, new Map<number, LegBook>()] as const;
      }
  });
  if (!still()) return;
  const current = cache.get(entry.ticker);
  if (!current) return;
  for (const [date, book] of books) {
    const chain = current.byDate[date];
    if (chain && book.size) paintLegs(chain, book, true);
  }
  vexOntoAll(current);
  current.at = Date.now();
  cache.set(current.ticker, current);
  emit();
}

/** One book at every bar of the tape, cash and the hours around it. Open interest walks from an
    overnight estimate (today's volume taken back off the current print) across the cash session only —
    that volume did not print before the open or after the close. The net scales with that open interest.
    Volume is not new open interest, so this is the feed's own ceiling, not a second book. */
function historyFrom(chain: StrikeNode[], candles: Candle[], flow: Map<number, { call: number; put: number }>): GexSnapshot[] {
  if (!chain.length || candles.length < 2) return [];
  const cash = candles.filter(c => {
    const m = nyMinutes(c.time * 1000);
    return m >= OPEN_MIN && m < CLOSE_MIN;
  });
  const cashFirst = cash[0]?.time;
  const cashLast = cash[cash.length - 1]?.time;
  const span = cashFirst != null && cashLast != null ? cashLast - cashFirst : 0;
  return candles.map(c => {
    let k = 0;
    if (span > 0 && cashFirst != null && cashLast != null) {
      if (c.time <= cashFirst) k = 0;
      else if (c.time >= cashLast) k = 1;
      else k = (c.time - cashFirst) / span;
    }
    const levels = chain.map(n => {
      const f = flow.get(n.strike);
      const callVol = f?.call ?? n.callVol ?? 0;
      const putVol = f?.put ?? n.putVol ?? 0;
      const openC = Math.max(0, n.callOI - callVol);
      const openP = Math.max(0, n.putOI - putVol);
      const callOI = openC + callVol * k;
      const putOI = openP + putVol * k;
      const now = (n.callOI ?? 0) + (n.putOI ?? 0);
      const then = callOI + putOI;
      const scale = now > 0 ? then / now : 1;
      return {
        strike: n.strike,
        value: n.netGex * scale,
        dex: (n.netDex ?? 0) * scale,
        vex: (n.netVex ?? 0) * scale,
        callOI,
        putOI,
      };
    });
    return { time: c.time, levels };
  });
}

function indicatorsOf(closes: number[]): Indicators {
  const ema = (n: number) => {
    if (!closes.length) return 0;
    const k = 2 / (n + 1);
    let e = closes[0];
    for (const c of closes) e = c * k + e * (1 - k);
    return e;
  };
  let rsi = 50;
  if (closes.length > 15) {
    let gain = 0;
    let loss = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return { rsi, ema9: ema(9), ema21: ema(21), ema50: ema(50), squeeze: false };
}

function planFor(ticker: string, spot: number, chain: StrikeNode[]): TradePlan {
  const walls = pickWalls(chain, spot, n => n.netGex);
  const flip = pickFlip(chain, spot, n => n.netGex) ?? spot;
  const callWall = walls.callWall ?? spot;
  const putWall = walls.putWall ?? spot;
  return {
    ticker,
    direction: spot >= flip ? 'BULLISH' : 'BEARISH',
    score: 0,
    confidence: 0,
    entry: spot,
    stopLoss: putWall,
    target1: callWall,
    target2: callWall,
    flipZone: flip,
    supportWall: putWall,
    resistanceWall: callWall,
  };
}

const closestDate = (want: string, dates: string[]): string | null => {
  if (dates.includes(want)) return want;
  const target = Date.parse(`${want}T00:00:00Z`);
  let best: string | null = null;
  let dist = 4 * 86_400_000;
  for (const d of dates) {
    const dd = Math.abs(Date.parse(`${d}T00:00:00Z`) - target);
    if (dd < dist) {
      dist = dd;
      best = d;
    }
  }
  return best;
};

function chainsFor(entry: Entry): Partial<Record<string, StrikeNode[]>> {
  const dates = Object.keys(entry.byDate);
  const out: Partial<Record<string, StrikeNode[]>> = { ALL: entry.all };
  const labels: [string, number][] = [
    ['0DTE', 0],
    ['1D', 1],
    ['2D', 2],
    ['5D', 5],
    ['7D', 7],
  ];
  for (const [label, dte] of labels) {
    const want = isoDate(expiryFor(dte, bookToday()).date);
    const hit = closestDate(want, dates);
    if (hit && entry.byDate[hit]?.length) out[label] = entry.byDate[hit];
  }
  const fridays = entry.expiries.filter(e => {
    const dt = new Date(`${e.date}T00:00:00`);
    return dt.getUTCDay() === 5 && e.dte >= 14 && e.dte <= 45;
  });
  const opex = fridays.sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
  if (opex && entry.byDate[opex.date]?.length) out.OPEX = entry.byDate[opex.date];
  if (!out['0DTE'] && dates[0] && entry.byDate[dates[0]]?.length) out['0DTE'] = entry.byDate[dates.sort()[0]];
  return out;
}

function materialize(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const uwChains = chainsFor(entry);
  const today = uwChains['0DTE'];
  const chain = scope === 'ALL' ? entry.all : today && today.length ? today : entry.all;
  const closes = entry.candles.map(c => c.close);
  return {
    ticker: entry.ticker,
    spot: entry.spot,
    changePercent: entry.changePct,
    priceHistory: closes.slice(-120),
    chain,
    indicators: indicatorsOf(closes),
    plan: planFor(entry.ticker, entry.spot, chain),
    tape: [],
    liveBook: true,
    uwChains,
    uwByDate: entry.byDate,
    uwExpiries: entry.expiries,
  };
}

export function peekEntry(ticker: string): Entry | undefined {
  return cache.get(ticker.toUpperCase());
}

export function peekSpot(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.spot > 0 ? e.spot : null;
}

export function peekChange(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' ? e.changePct : null;
}

export function peekIv(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.iv > 0 ? e.iv : null;
}

/** Dollars the book prices from here into today's expiry. Null when that row has not landed. */
export function peekImpliedMove(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.impliedMove > 0 ? e.impliedMove : null;
}

/** One session's priced move, fraction of spot. Null until the 1-day surface lands. */
export function peekDayMoveFrac(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.dayMoveFrac > 0 && e.dayMoveFrac < 0.2 ? e.dayMoveFrac : null;
}

/** Today's expiry, else nothing — a later expiry's move is not this session's. */
function impliedMoveOf(rows: UwTerm[], today: string, spot: number): number {
  if (!Array.isArray(rows) || !(spot > 0)) return 0;
  const row = rows.find(r => String(r.expiry ?? '') === today);
  const dollars = num(row?.implied_move);
  if (!(dollars > 0) || dollars > spot * 0.2) return 0;
  return dollars;
}

/** The 1-day tenor, as a fraction of spot. The vendor prints a fraction (0.004 = 0.4%). */
function dayFracOf(rows: UwInterp[]): number {
  if (!Array.isArray(rows)) return 0;
  const ones = rows.filter(r => num(r.days) === 1 && num(r.implied_move_perc) > 0);
  if (!ones.length) return 0;
  const row = ones.reduce((best, r) => (String(r.date ?? '') > String(best.date ?? '') ? r : best));
  let frac = num(row.implied_move_perc);
  if (frac > 1) frac /= 100;
  return frac > 0 && frac < 0.2 ? frac : 0;
}

export function bookCandles(ticker: string): Candle[] | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' ? e.candles : null;
}

/** The day's price in the session the head is set to, or the one you name. Regular hours are the cash bars. An empty list means the feed has no prints in that window — never a made-up chain. */
export function deskBars(ticker: string, session: DeskSession = getDeskSession()): Candle[] | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  if (session === 'rth') return e.candles.length ? e.candles : null;
  const src = e.tape?.length ? e.tape : e.candles;
  return src.filter(c => minuteInSession(nyMinutes(c.time * 1000), session));
}

/** Every print on the tape, in order — premarket through the close and the overnight that brackets them. */
export function dayBars(ticker: string): Candle[] | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  const src = e.tape?.length >= 2 ? e.tape : e.candles;
  return src.length >= 2 ? src : null;
}

export function bookHistory(ticker: string): GexSnapshot[] | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' ? e.history : null;
}

/** Session bars once the book is live. Empty until then — never a made-up chain. */
export function liveBars(ticker: string): Candle[] {
  const t = ticker?.toUpperCase();
  if (!t) return [];
  ensureBook(t, 'board');
  return bookCandles(t) ?? dayBars(t) ?? [];
}

/** The book's own gamma path. Empty until the live history lands. */
export function liveHistory(ticker: string): GexSnapshot[] {
  const t = ticker?.toUpperCase();
  if (!t) return [];
  ensureBook(t, 'board');
  return bookHistory(t) ?? [];
}

/** One minute of the vendor's own gamma (spot-exposures).
    Positive dampens, the same way the book's net does — call positive, put negative. */
export interface BookMinute {
  time: number;
  min: number;
  net: number;
  spot: number | null;
}

const minuteCache = new Map<string, BookMinute[]>();
const minuteWait = new Map<string, Promise<void>>();
const minuteRevListeners = new Set<() => void>();
let minuteRev = 0;

function publishMinutes(ticker: string, rows: BookMinute[]) {
  minuteCache.set(ticker, rows);
  minuteRev += 1;
  minuteRevListeners.forEach(fn => fn());
}

/** The day's gamma, one print a minute. Volume gamma — it crosses zero as hedging
    flips — not the open-interest level, and not the straight line reconstructed
    from today's volume in historyFrom. Directional gamma only when volume has
    not printed yet. */
export function ensureBookMinutes(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || minuteCache.has(t) || minuteWait.has(t)) return;
  const job = (async () => {
    const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures`);
    const raw = Array.isArray(res.data) ? res.data : [];
    const volRows: BookMinute[] = [];
    const dirRows: BookMinute[] = [];
    const seen = new Set<number>();
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const ms = Date.parse(String(o.start_time ?? o.time ?? ''));
      if (!Number.isFinite(ms)) continue;
      const time = Math.floor(ms / 60000) * 60;
      if (seen.has(time)) continue;
      seen.add(time);
      const px = parseFloat(String(o.price ?? ''));
      const spot = Number.isFinite(px) && px > 0 ? px : null;
      const base = { time, min: nyMinutes(ms), spot };
      const vol = parseFloat(String(o.gamma_per_one_percent_move_vol ?? ''));
      const dir = parseFloat(String(o.gamma_per_one_percent_move_dir ?? ''));
      /* the vendor's dealer gamma is positive when dealers are long gamma (they absorb); the house prints that
         NEGATIVE ("absorbs") and short gamma positive ("amplifies") — so the minute's net is negated like the strikes */
      if (Number.isFinite(vol)) volRows.push({ ...base, net: -vol });
      if (Number.isFinite(dir)) dirRows.push({ ...base, net: -dir });
    }
    const alive = (rows: BookMinute[]) => rows.reduce((n, r) => n + (r.net !== 0 ? 1 : 0), 0);
    const rows = alive(volRows) >= 8 ? volRows : alive(dirRows) >= 8 ? dirRows : volRows.length >= 2 ? volRows : dirRows;
    rows.sort((a, b) => a.time - b.time);
    publishMinutes(t, rows);
  })().finally(() => {
    minuteWait.delete(t);
  });
  minuteWait.set(t, job);
}

export function useBookMinutes(ticker: string): BookMinute[] | null {
  const t = ticker.toUpperCase();
  useEffect(() => {
    ensureBookMinutes(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      minuteRevListeners.add(fn);
      return () => minuteRevListeners.delete(fn);
    },
    () => minuteCache.get(t) ?? null,
    () => minuteCache.get(t) ?? null,
  );
}

export function bookStatus(ticker: string): Entry['status'] | 'idle' {
  return peekEntry(ticker)?.status ?? 'idle';
}

export function snapshotOf(ticker: string, mode: BookMode = 'board'): MarketSnapshot | null {
  ensureBook(ticker, mode);
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, readLevelsScope());
}

export function subscribeBook(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBookRev(): number {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev
  );
}

/** The name on screen. Full book: every expiry column, the session's minutes. Null until the first live print — never the simulator's price. */
export function usePinpointFeed(ticker: string | null | undefined): MarketSnapshot | null {
  const scope = useLevelsScope();
  const version = useBookRev();
  useEffect(() => {
    if (!ticker) return;
    ensureBook(ticker, 'full');
    startPinpoint(ticker);
    const id = window.setInterval(() => ensureBook(ticker, 'full'), 30_000);
    return () => window.clearInterval(id);
  }, [ticker]);
  return useMemo(() => {
    if (!ticker) return null;
    const e = peekEntry(ticker);
    if (!e || e.status !== 'live' || !e.all.length) return null;
    return materialize(e, scope);
    // version bumps when a book lands or refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, scope, version]);
}

async function loadCore(ticker: string, mode: BookMode, token: number): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const [state, strikes, oiRows, flowRows, ivRows, termRows, interpRows, bars] = await Promise.all([
    whalesState(ticker),
    whalesGreekStrike(ticker),
    whalesOiStrike(ticker).catch(() => [] as UwGreekStrike[]),
    whalesFlowStrike(ticker).catch(() => [] as UwFlowStrike[]),
    whalesIvRank(ticker).catch(() => []),
    whalesTermStructure(ticker).catch(() => [] as UwTerm[]),
    whalesInterpIv(ticker).catch(() => [] as UwInterp[]),
    whalesBars(ticker, mode === 'full' ? '1m' : '5m', mode === 'full' ? 500 : 90).catch(() => [] as UwBar[]),
  ]);
  if (!still()) return;
  if (!state || !Array.isArray(strikes) || strikes.length === 0) throw new Error('shape');
  const spot = num(state.close);
  const prev = num(state.prev_close) || num(state.open) || spot;
  if (!(spot > 0)) throw new Error('spot');
  const ivList = Array.isArray(ivRows) ? ivRows : [];
  const ivRow = ivList.reduce<UwIv | undefined>((best, row) => (!best || String(row.date ?? '') > String(best.date ?? '') ? row : best), undefined);
  const ivRaw = num(ivRow?.volatility);
  const iv = ivRaw > 3 ? ivRaw / 100 : ivRaw;
  const prevEntry = cache.get(ticker);
  const split = candlesFrom(Array.isArray(bars) ? bars : []);
  const entry: Entry = {
    ticker,
    status: 'live',
    at: Date.now(),
    full: false,
    wantFull: mode === 'full' || !!prevEntry?.wantFull,
    spot,
    prev,
    changePct: prev > 0 ? ((spot - prev) / prev) * 100 : 0,
    iv: iv > 0 ? iv : 0,
    impliedMove: impliedMoveOf(Array.isArray(termRows) ? termRows : [], nyIsoDate(), spot),
    dayMoveFrac: dayFracOf(Array.isArray(interpRows) ? interpRows : []),
    all: chainFrom(strikes, spot, oiMap(Array.isArray(oiRows) ? oiRows : []), flowMap(Array.isArray(flowRows) ? flowRows : [])),
    byDate: prevEntry?.byDate ?? {},
    expiries: prevEntry?.expiries ?? [],
    expiriesAt: prevEntry?.expiriesAt,
    flow: flowMap(Array.isArray(flowRows) ? flowRows : []),
    candles: split.cash,
    tape: split.tape,
    history: [],
  };
  entry.history = prevEntry?.history?.length ? prevEntry.history : [];
  vexOntoAll(entry);
  cache.set(ticker, entry);
  emit();
  /* The per-minute book is for the replay. Building it is one object per strike
     per bar — do it after the page has the live book, not in front of the paint. */
  const histTicker = ticker;
  const histChain = entry.all;
  const histCandles = entry.tape.length >= 2 ? entry.tape : entry.candles;
  const histFlow = entry.flow;
  const buildHist = () => {
    if (gen.get(histTicker) !== token) return;
    const cur = cache.get(histTicker);
    if (!cur) return;
    cur.history = historyFrom(histChain, histCandles, histFlow);
    emit();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(buildHist, { timeout: 700 });
  else window.setTimeout(buildHist, 32);
  if (entry.wantFull) await loadExpiries(entry, token);
}

async function loadExpiries(entry: Entry, token: number): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  if (entry.expiriesAt && Date.now() - entry.expiriesAt < 180_000 && Object.keys(entry.byDate).length > 0) {
    entry.full = true;
    vexOntoAll(entry);
    return;
  }
  let listed: { date: string; dte: number }[] = [];
  try {
    const rows = await whalesGreekExpiry(entry.ticker);
    if (Array.isArray(rows)) {
      listed = rows
        .map(r => ({ date: String(r.expiry || ''), dte: num(r.dte) }))
        .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch {
    listed = [];
  }
  if (!still()) return;
  /* Every listed expiry. The old cut kept eight horizons and stamped the WHOLE book's
     open interest onto each of them, so a November column wore October's contracts. */
  const dates = listed.map(r => r.date).slice(0, 40);
  const pull = (list: string[]) =>
    mapLimit(list, 3, async date => {
      try {
        const rows = await whalesGreekStrikeExpiry(entry.ticker, date);
        return [date, (Array.isArray(rows) ? chainFrom(rows, entry.spot, new Map()) : []) as StrikeNode[]] as const;
      } catch {
        return [date, [] as StrikeNode[]] as const;
      }
    });
  const apply = (fetched: readonly (readonly [string, StrikeNode[]])[], done: boolean) => {
    if (!still()) return;
    const current = cache.get(entry.ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    for (const [date, chain] of fetched) if (chain.length) byDate[date] = chain;
    current.byDate = byDate;
    current.expiries = listed;
    if (done) {
      current.full = true;
      current.expiriesAt = Date.now();
    }
    current.at = Date.now();
    vexOntoAll(current);
    cache.set(entry.ticker, current);
    emit();
  };
  /* The dates on screen first, then the rest of the listed book. */
  const near = dates.slice(0, 6);
  apply(await pull(near), dates.length <= 6);
  if (!still()) return;
  if (dates.length > 6) {
    apply(await pull(dates.slice(6)), true);
    if (!still()) return;
  }
  const current = cache.get(entry.ticker);
  if (current) void fillExpiryFacts(current, token);
}

function load(ticker: string, mode: BookMode) {
  const token = (gen.get(ticker) ?? 0) + 1;
  gen.set(ticker, token);
  const prev = cache.get(ticker);
  if (!prev) {
    cache.set(ticker, {
      ticker,
      status: 'loading',
      at: Date.now(),
      full: false,
      wantFull: mode === 'full',
      spot: 0,
      prev: 0,
      changePct: 0,
      iv: 0.2,
      impliedMove: 0,
      dayMoveFrac: 0,
      all: [],
      byDate: {},
      expiries: [],
      flow: new Map(),
      candles: [],
      tape: [],
      history: [],
    });
    queueMicrotask(emit);
  } else if (mode === 'full') prev.wantFull = true;
  void loadCore(ticker, mode, token).catch(() => {
    if (gen.get(ticker) !== token) return;
    const cur = cache.get(ticker);
    if (cur?.status === 'live') return;
    cache.set(ticker, {
      ticker,
      status: 'error',
      at: Date.now(),
      full: false,
      wantFull: false,
      spot: 0,
      prev: 0,
      changePct: 0,
      iv: 0.2,
      impliedMove: 0,
      dayMoveFrac: 0,
      all: [],
      byDate: {},
      expiries: [],
      flow: new Map(),
      candles: [],
      tape: [],
      history: [],
    });
    emit();
  });
}

export function ensureBook(ticker: string, mode: BookMode = 'board'): void {
  if (typeof window === 'undefined') return;
  const t = ticker.trim().toUpperCase();
  if (!t) return;
  const e = cache.get(t);
  if (e?.status === 'loading') {
    if (mode === 'full') e.wantFull = true;
    return;
  }
  const age = e ? Date.now() - e.at : Infinity;
  const limit = e?.status === 'error' ? 15_000 : e?.full ? FULL_MS : BOARD_MS;
  const stale = !e || age > limit;
  const upgrade = mode === 'full' && !!e && e.status === 'live' && !e.full && !e.wantFull;
  if (!stale && !upgrade) return;
  if (upgrade && e) {
    e.wantFull = true;
    const token = (gen.get(t) ?? 0) + 1;
    gen.set(t, token);
    void loadExpiries(e, token);
    return;
  }
  load(t, mode);
}

/* ---- the last session's open-interest change, contract by contract ---------------------------------------------- */

/* WHAT WAS BUILT IS THE VENDOR'S OPEN-INTEREST CHANGE, NOT THE DAY'S VOLUME (the Pinpoint sweep, 2026-10-22): Building
   took every contract traded today as open interest added since the open — on SPY, where a strike trades several times
   its open interest in a day, that printed walls "was $11.1B" against $36M now and "drained $144.6B". The vendor's
   oi-change is the real thing: each contract's open interest this morning against the session before. Summed here to
   the strike, calls and puts apart. Pages are ordered by the size of the change, so the first few hold everything that
   moved a wall. */
const OI_PAGES = 6;
const oiChangeCache = new Map<string, Map<number, { c: number; p: number }>>();
const oiChangeWait = new Set<string>();

export function ensureOiChange(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeCache.has(t) || oiChangeWait.has(t)) return;
  oiChangeWait.add(t);
  void (async () => {
    const byStrike = new Map<number, { c: number; p: number }>();
    for (let page = 0; page < OI_PAGES; page++) {
      const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=${page}`);
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const m = /([CP])(\d{8})$/.exec(String(r.option_symbol ?? ''));
        const diff = num(r.oi_diff_plain);
        if (!m || !diff) continue;
        const strike = Number(m[2]) / 1000;
        const cell = byStrike.get(strike) ?? { c: 0, p: 0 };
        if (m[1] === 'C') cell.c += diff;
        else cell.p += diff;
        byStrike.set(strike, cell);
      }
      if (rows.length < 500) break;
    }
    oiChangeCache.set(t, byStrike);
    emit();
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each strike's open-interest change over the last session (calls, puts, in contracts) — null until it lands */
export const peekOiChange = (ticker: string): ReadonlyMap<number, { c: number; p: number }> | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
