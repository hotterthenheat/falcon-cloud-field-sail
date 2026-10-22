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
import { pickWalls } from '../core/walls';
import { registerChainDates } from './chainDates';
import { levelFlip } from './flipLevel';
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
  /** The vendor's gamma per expiry (greek-exposure/expiry): gross dollars a date, for the share that expires today */
  totals?: { date: string; gross: number }[];
  /** When `totals` (and, on a board-only name, the front date's chain) last landed */
  totalsAt?: number;
  /** Each expiry's at-the-money implied vol (volatility/term-structure), annualised fraction — the flip re-prices a
      date's legs with it where that date's own contract vols are not in (data/flipLevel.ts) */
  termIv?: Record<string, number>;
  /** The front date's contract rows (open interest, vol, gamma) are painted on its chain */
  frontFacts?: boolean;
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
export function nodeFrom(row: UwGreekStrike, spot: number, oi?: { c: number; p: number }): StrikeNode {
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

export function chainFrom(rows: UwGreekStrike[], spot: number, oi: Map<number, { c: number; p: number }>, flow?: Map<number, { call: number; put: number }>): StrikeNode[] {
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
  /** The contract's own implied vol and gamma, per contract (0 = not printed) */
  callIv: number;
  putIv: number;
  callGamma: number;
  putGamma: number;
}

function emptyLeg(): LegBook {
  return { callOI: 0, putOI: 0, callVex: 0, putVex: 0, callVol: 0, putVol: 0, callIv: 0, putIv: 0, callGamma: 0, putGamma: 0 };
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
    const iv = num(row.implied_volatility);
    const gamma = num(row.gamma);
    if (parsed.right === 'CALL') {
      leg.callOI += oi;
      leg.callVol += vol;
      leg.callVex += dollar * CALL_VEGA;
      if (iv > 0 && iv < 10) leg.callIv = iv;
      if (gamma > 0) leg.callGamma = gamma;
    } else {
      leg.putOI += oi;
      leg.putVol += vol;
      leg.putVex += dollar * PUT_VEGA;
      if (iv > 0 && iv < 10) leg.putIv = iv;
      if (gamma > 0) leg.putGamma = gamma;
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
    if (leg.callIv > 0) n.callIv = leg.callIv;
    if (leg.putIv > 0) n.putIv = leg.putIv;
    if (leg.callGamma > 0) n.callGamma = leg.callGamma;
    if (leg.putGamma > 0) n.putGamma = leg.putGamma;
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
async function fillExpiryFacts(entry: Entry, token: number, only?: readonly string[]): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  const dates = only ? only.filter(d => d in entry.byDate) : Object.keys(entry.byDate);
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

function planFor(ticker: string, spot: number, chain: StrikeNode[], flipAt: number | null): TradePlan {
  const walls = pickWalls(chain, spot, n => n.netGex);
  const flip = flipAt ?? spot;
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

/* NEVER AN EXPIRED DATE (the ship pass, 2026-10-22): after the bell the vendor still lists the day that just settled
   (NVDA: Oct 21, then Oct 23) — "today" on the 22nd sat equidistant between them and could read the settled book. A
   choice resolves to its own date, else the first listing after it, else the nearest one still live. */
const closestDate = (want: string, dates: string[], floor: string = isoDate(bookToday())): string | null => {
  const live = dates.filter(d => d >= floor).sort();
  if (live.includes(want)) return want;
  const after = live.find(d => d > want);
  const target = Date.parse(`${want}T00:00:00Z`);
  if (after && Date.parse(`${after}T00:00:00Z`) - target <= 4 * 86_400_000) return after;
  let best: string | null = null;
  let dist = 4 * 86_400_000;
  for (const d of live) {
    const dd = Math.abs(Date.parse(`${d}T00:00:00Z`) - target);
    if (dd < dist) {
      dist = dd;
      best = d;
    }
  }
  return best;
};

const LADDER_DTE: [string, number][] = [
  ['0DTE', 0],
  ['1D', 1],
  ['2D', 2],
  ['5D', 5],
  ['7D', 7],
];

/** The date an expiry choice reads on this name's book — the one chainsFor hands the pages — or null when the book is
    not in or the choice is not one date. The expiry cards label themselves with it. */
export function expiryDateFor(ticker: string, choice: string): string | null {
  const entry = cache.get(ticker);
  if (!entry) return null;
  const dte = LADDER_DTE.find(([label]) => label === choice)?.[1];
  if (dte == null) return null;
  return closestDate(isoDate(expiryFor(dte, bookToday()).date), Object.keys(entry.byDate));
}

const LIVE_KEYS = ['callGex', 'putGex', 'netGex', 'callDex', 'putDex', 'netDex', 'callVex', 'putVex', 'netVex', 'callVanna', 'putVanna', 'netVanna', 'callCharm', 'putCharm', 'netCharm', 'callOI', 'putOI'] as const;

/* THE WHOLE BOOK WITHOUT THE DAY THAT SETTLED (the ship pass, 2026-10-22): the vendor's per-strike totals are dated to its
   last session, so before the next open "every expiry" still carried the settled 0DTE's gamma. Once that date's own
   chain is in, it comes off the total, strike by strike. */
function liveAll(entry: Entry): StrikeNode[] {
  const floor = isoDate(bookToday());
  const settled = Object.keys(entry.byDate).filter(d => d < floor && entry.byDate[d]?.length);
  if (!settled.length) return entry.all;
  const off = new Map<number, StrikeNode[]>();
  for (const d of settled) for (const n of entry.byDate[d]) off.set(n.strike, [...(off.get(n.strike) ?? []), n]);
  return entry.all.map(n => {
    const gone = off.get(n.strike);
    if (!gone) return n;
    const out = { ...n };
    for (const k of LIVE_KEYS) {
      const less = gone.reduce((a, g) => a + (g[k] ?? 0), 0);
      if (less) out[k] = (k === 'callOI' || k === 'putOI') ? Math.max(0, out[k] - less) : out[k] - less;
    }
    return out;
  });
}

function chainsFor(entry: Entry): Partial<Record<string, StrikeNode[]>> {
  const dates = Object.keys(entry.byDate).filter(d => d >= isoDate(bookToday()));
  const all = liveAll(entry);
  registerChainDates(all, 'ALL');
  const out: Partial<Record<string, StrikeNode[]>> = { ALL: all };
  for (const [label, dte] of LADDER_DTE) {
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
  /* the fallback is the first LIVE date — the sorted list's head after the bell is the day that just settled */
  const firstLive = [...dates].sort().find(d => d >= isoDate(bookToday()));
  if (!out['0DTE'] && firstLive && entry.byDate[firstLive]?.length) out['0DTE'] = entry.byDate[firstLive];
  return out;
}

/* THE LISTING AS IT STANDS ON THE BOOK'S DAY (the ship pass, 2026-10-22): the vendor's expiries are dated to its last
   session — after the bell and into the next morning it still lists the day that settled at dte 0 (SPY Oct 21 with
   the book on Oct 22), and the Map's window, its supreme and its levels card counted the settled contracts as live.
   Settled dates leave the listing; the rest count their days from the book's day, so Oct 22 is "today" again. */
function liveListing(expiries: Entry['expiries']): Entry['expiries'] {
  const floor = isoDate(bookToday());
  const settledFront = expiries.find(e => e.dte === 0 && e.date < floor);
  /* the vendor's dte counts calendar days (Oct 21 → Oct 26 is 5), so the shift does too — a Friday's settled front is three days behind Monday */
  const shift = settledFront ? Math.round((Date.parse(`${floor}T00:00:00Z`) - Date.parse(`${settledFront.date}T00:00:00Z`)) / 86_400_000) : 0;
  const live = expiries.filter(e => e.date >= floor).map(e => (shift ? { ...e, dte: Math.max(0, e.dte - shift) } : e));
  return live.length ? live : expiries;
}

function materialize(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const uwChains = chainsFor(entry);
  const today = uwChains['0DTE'];
  const chain = scope === 'ALL' ? (uwChains.ALL ?? entry.all) : today && today.length ? today : (uwChains.ALL ?? entry.all);
  const closes = entry.candles.map(c => c.close);
  const snap: MarketSnapshot = {
    ticker: entry.ticker,
    spot: entry.spot,
    changePercent: entry.changePct,
    priceHistory: closes.slice(-120),
    chain,
    indicators: indicatorsOf(closes),
    plan: planFor(entry.ticker, entry.spot, chain, null),
    tape: [],
    liveBook: true,
    uwChains,
    uwByDate: entry.byDate,
    uwExpiries: liveListing(entry.expiries),
  };
  /* the plan's flip zone is the one flip (data/flipLevel.ts), read off the snapshot's own levels chain */
  const flip = levelFlip(snap, chain).flip;
  if (flip != null) snap.plan = { ...snap.plan, flipZone: flip, direction: entry.spot >= flip ? 'BULLISH' : 'BEARISH' };
  return snap;
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

/** Each expiry's at-the-money vol off the term structure, annualised fraction — null when the rows carry none */
function termIvOf(rows: UwTerm[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = String(r.expiry ?? '');
    let v = num(r.volatility);
    if (v > 3) v /= 100;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0 && v < 5) out[d] = v;
  }
  return Object.keys(out).length ? out : null;
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
    /* A WHOLE DAY OF BARS, NOT THE LAST FEW HOURS (the ship pass, 2026-10-22): the feed hands bars newest first,
       post-market included — after the bell 500 one-minute bars reached back only to ~11:40, so the day's chart and
       "How the levels held" started late morning. 1000 / 200 cover pre-market, the session and the evening. */
    whalesBars(ticker, mode === 'full' ? '1m' : '5m', mode === 'full' ? 1000 : 200).catch(() => [] as UwBar[]),
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
    termIv: termIvOf(Array.isArray(termRows) ? termRows : []) ?? prevEntry?.termIv,
    dayMoveFrac: dayFracOf(Array.isArray(interpRows) ? interpRows : []),
    all: chainFrom(strikes, spot, oiMap(Array.isArray(oiRows) ? oiRows : []), flowMap(Array.isArray(flowRows) ? flowRows : [])),
    byDate: prevEntry?.byDate ?? {},
    expiries: prevEntry?.expiries ?? [],
    expiriesAt: prevEntry?.expiriesAt,
    totals: prevEntry?.totals,
    totalsAt: prevEntry?.totalsAt,
    frontFacts: prevEntry?.frontFacts,
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
  else await loadFront(entry, token);
}

/** The vendor's expiry listing, nearest first */
function listingOf(rows: unknown): { date: string; dte: number }[] {
  if (!Array.isArray(rows)) return [];
  return (rows as UwGreekStrike[])
    .map(r => ({ date: String(r.expiry || ''), dte: num(r.dte) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Gamma per expiry, gross (calls and puts both counted) — what each date's hedging weighs */
function keepTotals(entry: Entry, rows: unknown): void {
  if (!Array.isArray(rows)) return;
  const totals = (rows as UwGreekStrike[])
    .map(r => ({ date: String(r.expiry || ''), gross: Math.abs(num(r.call_gex)) + Math.abs(num(r.put_gex)) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (!totals.length) return;
  entry.totals = totals;
  entry.totalsAt = Date.now();
  const cur = cache.get(entry.ticker);
  if (cur && cur !== entry) {
    cur.totals = totals;
    cur.totalsAt = entry.totalsAt;
  }
}

const FRONT_MS = 180_000;

/*
  A BOARD NAME'S FRONT DATE (the ship pass, 2026-10-22). A name read for the Board alone used to carry no per-expiry
  chain at all, so its "Today" levels silently fell back to the whole book (QQQ's net GEX on the Board was the whole
  book's while Compare read today's) and its "Expires today" read "—". Two calls a name, kept three minutes: the
  listing with each date's gamma (the share that expires today comes straight off it) and the first live date's own
  strikes (the "Today" levels). The full book still loads every date for the name on screen.
*/
async function loadFront(entry: Entry, token: number): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  const today = isoDate(bookToday());
  const allScope = readLevelsScope() === 'ALL';
  const haveFront = Object.keys(entry.byDate).some(d => d >= today && entry.byDate[d]?.length);
  const fresh = !!entry.totalsAt && Date.now() - entry.totalsAt < FRONT_MS;
  if (fresh && haveFront && !!entry.frontFacts && (!allScope || datesComplete(entry))) return;
  /* THE BOARD'S FRONT DATE AHEAD OF THE QUEUE (the retail test, 2026-10-22: 16 of 20 names sat on "…" at 22s): the
     three calls that fill a row's "Today" levels jump the key's queue, so each name's row fills as its own core lands
     rather than after every name's */
  let listed: { date: string; dte: number }[] = [];
  const got = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/expiry`, true);
  if (got.error) return;
  listed = listingOf(got.data);
  keepTotals(entry, got.data);
  if (!still() || !listed.length) return;
  const front = closestDate(isoDate(expiryFor(0, bookToday()).date), listed.map(r => r.date));
  if (!front) return;
  let chain: StrikeNode[] = entry.byDate[front] ?? [];
  if (!chain.length || !fresh) {
    const rows = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/strike-expiry?expiry=${encodeURIComponent(front)}`, true);
    chain = !rows.error && Array.isArray(rows.data) ? chainFrom(rows.data as UwGreekStrike[], entry.spot, new Map()) : chain;
  }
  if (!still()) return;
  let current = cache.get(entry.ticker);
  if (!current || current.full) return;
  if (chain.length) current.byDate = { ...current.byDate, [front]: chain };
  if (!current.expiries.length) current.expiries = listed;
  cache.set(entry.ticker, current);
  emit();
  /* the front date's contracts: open interest, each contract's own vol and gamma — the flip re-prices with them and
     Building values the open-interest change with them (one call a name) */
  if (chain.length) {
    const rows = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/option-contracts?limit=1000&expiry=${encodeURIComponent(front)}`, true);
    if (!still()) return;
    current = cache.get(entry.ticker);
    if (!current || current.full) return;
    if (!rows.error && Array.isArray(rows.data)) {
      const book = foldContracts(rows.data as UwContract[], front);
      if (book.size) paintLegs(chain, book, true);
      current.frontFacts = true;
      current.at = Date.now();
      cache.set(entry.ticker, current);
      emit();
    }
  }
  /* "All expiries" on the Board: every live date's strikes, so the flip can re-price each date at its own clock */
  if (readLevelsScope() === 'ALL') await loadBoardDates(entry.ticker, token, listed);
}

/** Every live listed date carries its own strikes */
function datesComplete(entry: Entry): boolean {
  const today = isoDate(bookToday());
  /* the same forty listings the full book pulls (loadExpiries) — the day that just settled too, while the vendor still
     lists it: its chain is what liveAll takes off the whole book's total, so without it a Board name's "All expiries"
     net carried the settled contracts (QQQ −$10.6B on the Board against −$9.3B on the Map after the bell) */
  const live = entry.expiries.slice(0, 40);
  const empty = emptyDates.get(entry.ticker);
  return live.some(e => e.date >= today) && live.every(e => entry.byDate[e.date]?.length || empty?.has(e.date));
}

const datesWait = new Set<string>();
/** Listed dates whose strikes came back empty — asked once, not waited on forever */
const emptyDates = new Map<string, Set<string>>();
async function loadBoardDates(ticker: string, token: number, listed?: { date: string; dte: number }[]): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const e = cache.get(ticker);
  if (!e || datesWait.has(ticker)) return;
  const today = isoDate(bookToday());
  void today;
  const want = (listed ?? e.expiries).slice(0, 40).map(x => x.date).filter(d => !e.byDate[d]?.length && !emptyDates.get(ticker)?.has(d));
  if (!want.length) return;
  datesWait.add(ticker);
  try {
    const fetched = await mapLimit(want, 3, async date => {
      try {
        const rows = await whalesGreekStrikeExpiry(ticker, date);
        return [date, Array.isArray(rows) ? chainFrom(rows, e.spot, new Map()) : []] as const;
      } catch {
        return [date, [] as StrikeNode[]] as const;
      }
    });
    if (!still()) return;
    const current = cache.get(ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    const empty = emptyDates.get(ticker) ?? new Set<string>();
    for (const [date, chain] of fetched) {
      if (chain.length && !byDate[date]?.length) byDate[date] = chain;
      else if (!chain.length) empty.add(date);
    }
    emptyDates.set(ticker, empty);
    current.byDate = byDate;
    if (listed?.length) current.expiries = listed;
    cache.set(ticker, current);
    emit();
  } finally {
    datesWait.delete(ticker);
  }
}

/** The Levels card reads "All expiries": a name read for the Board alone loads every live date's strikes (the flip
    re-prices each at its own clock). A no-op for a full book or one already complete. */
export function ensureScopeDates(ticker: string): void {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || e.full || readLevelsScope() !== 'ALL' || datesComplete(e)) return;
  void loadBoardDates(e.ticker, gen.get(e.ticker) ?? 0);
}

/** True while the "All expiries" scope still waits on some live date's strikes */
export function scopeDatesPending(ticker: string): boolean {
  const e = peekEntry(ticker);
  return !!e && e.status === 'live' && readLevelsScope() === 'ALL' && !datesComplete(e);
}

/** Share of the book's gamma that expires today, percent. `none`: nothing on this name expires today. `wait`: the
    listing is not in yet. One number for the Board, Compare, the Agenda and the Trader's Clock. */
export function peekBellShare(ticker: string): { share: number } | { share: null; why: 'none' | 'wait' } {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.totals?.length) return { share: null, why: 'wait' };
  const today = isoDate(bookToday());
  const live = e.totals.filter(t => t.date >= today);
  const dies = live.filter(t => t.date === today).reduce((a, t) => a + t.gross, 0);
  if (!live.some(t => t.date === today)) return { share: null, why: 'none' };
  const total = live.reduce((a, t) => a + t.gross, 0);
  return total > 0 ? { share: Math.round((100 * dies) / total) } : { share: null, why: 'wait' };
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
    listed = listingOf(rows);
    keepTotals(entry, rows);
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
  /* THE NEAR DATES' OPEN INTEREST AT ONCE (the ship pass, 2026-10-22): the by-expiry rows carry no open interest, and
     it was filled only after all ~40 dates had landed — on Building (today's expiry by default) every strike's change
     read +$0 for the better part of a minute. The dates on screen get theirs as soon as they are in. */
  const near = dates.slice(0, 6);
  apply(await pull(near), dates.length <= 6);
  if (!still()) return;
  const first = cache.get(entry.ticker);
  if (first) void fillExpiryFacts(first, token, near);
  if (dates.length > 6) {
    apply(await pull(dates.slice(6)), true);
    if (!still()) return;
    const current = cache.get(entry.ticker);
    if (current) void fillExpiryFacts(current, token, dates.slice(6));
  }
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

/** One contract's open-interest change: the vendor's oi_diff_plain — this morning's open interest (curr_date, set
    overnight from the previous session's trading) against the session before's (last_date) */
export interface OiChangeRow {
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  /** Contracts added (negative = closed) */
  diff: number;
  /** The two dates the change runs between, as the vendor prints them */
  currDate: string;
  lastDate: string;
}
export interface OiChange {
  rows: OiChangeRow[];
  /** The open-interest dates the change runs between ("2026-10-21" → "2026-10-22") */
  lastDate: string | null;
  currDate: string | null;
}
const oiChangeCache = new Map<string, OiChange>();
const oiChangeWait = new Set<string>();

/* KEYED BY CONTRACT, NOT BY STRIKE (the Pinpoint audit, 2026-10-22): the strike-only parse dropped the expiry and summed
   every date's change at a strike, and Building then valued that sum at the selected scope's per-contract gamma — SPY
   767 read "+42,691 puts" on today's chain when 1,921 of them were 10/22 and 36,716 were 10/27. Each row keeps its
   expiry, strike and side; Building picks the contracts in scope and values each with its own gamma. */
export function ensureOiChange(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeCache.has(t) || oiChangeWait.has(t)) return;
  oiChangeWait.add(t);
  void (async () => {
    const out: OiChangeRow[] = [];
    let lastDate: string | null = null;
    let currDate: string | null = null;
    for (let page = 0; page < OI_PAGES; page++) {
      const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=${page}`);
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const occ = parseOcc(String(r.option_symbol ?? ''));
        const diff = num(r.oi_diff_plain);
        if (!occ || !diff) continue;
        const cd = String(r.curr_date ?? '');
        const ld = String(r.last_date ?? '');
        if (cd && (!currDate || cd > currDate)) currDate = cd;
        if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
        out.push({ expiry: occ.expiry, strike: occ.strike, right: occ.right === 'CALL' ? 'C' : 'P', diff, currDate: cd, lastDate: ld });
      }
      if (rows.length < 500) break;
    }
    oiChangeCache.set(t, { rows: out, lastDate, currDate });
    emit();
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each contract's open-interest change over the last session — null until it lands */
export const peekOiChange = (ticker: string): OiChange | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
