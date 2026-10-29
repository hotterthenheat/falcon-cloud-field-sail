/* Pinpoint's book, from Unusual Whales (the browser asks /api/uw; the server holds the token).
   Sign: UW prints call gamma positive, puts negative; the house sign negates both legs (core/walls.ts), so call-heavy
   strikes are NEGATIVE (dealers long gamma) and put-heavy ones POSITIVE. Readers print -house as the retail sign. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { startPinpoint } from './vendorFeed';
import { bookToday, expiryFor, isoDate, isTradingDay, nextSession, MONTHS as MON3 } from '../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase, nyWallStamp, nyWallTime } from '../core/nyTime';
import { pickLegWalls } from '../core/walls';
import { registerChainDates } from './chainDates';
import { dayChangeOf, loadRegularCloses, noteBarCloses, peekRegularCloses, type MarketPhase } from './dayChange';
import { levelFlip } from './flipLevel';
import type { Candle, GexSnapshot, Indicators, MarketSnapshot, StrikeNode, TradePlan } from '../types/market';
import { getDeskSession, minuteInSession, sessionMeta, useDeskSession, type DeskSession } from './deskSession';
import { resolveDeskSession, type SessionRead } from './compassSession';
import { levelsForName, readLevelsScope, useNameLevels, type LevelsScope } from './levelsScope';
import { awaitSpotGex, sameName, uwOnlyDesk } from './spotGexBook';
import { thetaCall } from './theta';
import { spxRead } from './spxBook';
import { blackScholesGreeks } from '../core/greeks';
import { expiryOpen, tradingYears } from '../core/tradingYear';
import { carryFor } from '../core/carry';
import { dealerInventory, flowFirm, flowImbalance, flowWindow, ivOnTradingClock, quoteMaxAge, smoothSmile, unsignedShare } from '../core/volClock';
import { noteClose, noteNodes, peakStrikes, type CloseRow } from './nodeScore';
import { SIM_DESK } from './deskMode';
import { sigmaFromStraddle, sigmaOverMinutes, STRADDLE_K, STRADDLE_TO_SIGMA } from './expectedMove';
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
  whalesOptionContractsPaged,
  whalesScreener,
  whalesState,
  whalesTermStructure,
  type UwBar,
  type UwContract,
  type UwFlowStrike,
  type UwGreekStrike,
  type UwInterp,
  type UwIv,
  type UwTerm,
  type UwState,
} from './whales';

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
/** An index's closing print lands after 16:00 (VIX prints through 16:15): that is the close, not after hours. */
const INDEX_CASH_TO = 16 * 60 + 15;
/** CBOE indexes. /stock/SPX/ohlc and stock-state answer 422 (cboe_index_access_missing). The day's price is the index tape. */
const INDEX_TAPE = new Set(['SPX', 'RUT', 'NDX', 'VIX', 'XSP']);

function ymdNY(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
}

/** How far the cash chart runs. A stock's 16:00 bar is the closing print. An index's close can print until 16:15. */
function cashToOf(symbol: string): number {
  return INDEX_TAPE.has(symbol.toUpperCase()) ? INDEX_CASH_TO : CLOSE_MIN;
}

/** Regular, pre, or post off the clock. The 16:00 minute is the close. Anything later is after hours, except an index through 16:15. */
function tapeMark(symbol: string, minute: number): 'r' | 'pr' | 'po' {
  if (minute >= OPEN_MIN && minute <= cashToOf(symbol)) return 'r';
  if (minute < OPEN_MIN) return 'pr';
  return 'po';
}

function pushPrint(out: UwBar[], px: number, at: number, symbol: string): void {
  if (!(px > 0) || !at) return;
  const barStart = Math.floor(at / 60000) * 60000;
  const iso = new Date(at).toISOString();
  const minute = nyMinutes(at);
  const mt = tapeMark(symbol, minute);
  const last = out[out.length - 1];
  const lastAt = last ? Date.parse(last.start_time || '') : 0;
  if (last && Math.floor(lastAt / 60000) * 60000 === barStart) {
    last.close = px;
    last.high = Math.max(num(last.high), px);
    last.low = Math.min(num(last.low) || px, px);
    last.end_time = iso;
    last.market_time = mt;
  } else if (!last || barStart > lastAt) {
    out.push({ open: px, high: px, low: px, close: px, volume: 0, start_time: new Date(barStart).toISOString(), end_time: iso, market_time: mt });
  }
}

/** A bar with no price is missing. All-zero open, high, low and close is not a print at $0. */
export function barPriced(open: number, high: number, low: number, close: number): boolean {
  if (!(close > 0)) return false;
  if (open === 0 && high === 0 && low === 0 && close === 0) return false;
  return true;
}

/** A day the tape returned only empty bars, so the chart must not pretend that day printed. */
const blankTapeDay = new Map<string, string>();

function noteBlankDays(symbol: string, rows: readonly { at: number; priced: boolean }[]): void {
  const by = new Map<string, { n: number; good: number }>();
  for (const row of rows) {
    if (!row.at) continue;
    const day = nyIsoDate(row.at);
    const cur = by.get(day) ?? { n: 0, good: 0 };
    cur.n += 1;
    if (row.priced) cur.good += 1;
    by.set(day, cur);
  }
  let blank = '';
  for (const [day, v] of by) if (v.n > 0 && v.good === 0 && day > blank) blank = day;
  if (blank) blankTapeDay.set(symbol.toUpperCase(), blank);
}
/** One-minute bars off the ThetaData terminal (a name the vendor has no bars for) — none on the UW-only desks. */
async function thetaTape(symbol: string, index: boolean): Promise<UwBar[]> {
  if (uwOnlyDesk()) return [];
  const end = ymdNY(Date.now());
  const back = symbol.toUpperCase() === 'SPX' ? 8 : 4;
  const start = ymdNY(Date.now() - back * 86400000);
  const root = index ? 'index' : 'stock';
  /* The vendor's default window is the cash session. Premarket, the curb and the overnight book are separate asks. */
  const windows = [
    { start: '09:30:00', end: '16:15:00' },
    { start: '04:00:00', end: '09:29:59' },
    { start: '16:00:00', end: '19:59:59' },
    { start: '20:00:00', end: '23:59:59' },
    { start: '00:00:00', end: '03:59:59' },
  ];
  const got = await Promise.all(
    windows.map(w => thetaCall(`/${root}/history/ohlc?symbol=${symbol}&start_date=${start}&end_date=${end}&interval=1m&start_time=${w.start}&end_time=${w.end}&format=json`)),
  );
  const rows = got.flatMap(g => (Array.isArray(g.data) ? (g.data as Record<string, unknown>[]) : []));
  const snapPath = index
    ? `/index/snapshot/price?symbol=${symbol}&format=json`
    : `/stock/snapshot/trade?symbol=${symbol}&format=json`;
  const snap = await thetaCall(snapPath);
  const out: UwBar[] = [];
  const seen: { at: number; priced: boolean }[] = [];
  const kept = new Set<number>();
  for (const b of rows) {
    const at = nyWallStamp(b.timestamp);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    const priced = barPriced(open, high, low, close);
    if (at) seen.push({ at, priced });
    if (!at || !priced) continue;
    const minuteKey = Math.floor(at / 60000);
    if (kept.has(minuteKey)) continue;
    kept.add(minuteKey);
    const iso = new Date(at).toISOString();
    const minute = nyMinutes(at);
    out.push({
      open: open || close,
      high: high || close,
      low: low || close,
      close,
      volume: num(b.volume),
      start_time: iso,
      end_time: iso,
      market_time: tapeMark(symbol, minute),
    });
  }
  noteBlankDays(symbol, seen);
  out.sort((a, b) => Date.parse(a.start_time || '') - Date.parse(b.start_time || ''));
  const row = Array.isArray(snap.data) ? snap.data[0] as Record<string, unknown> | undefined : undefined;
  const px = row ? num(row.price ?? row.close) : 0;
  const at = row ? nyWallStamp(row.timestamp) : 0;
  pushPrint(out, px, at, symbol);
  return out;
}

/** VIX prints from 03:15. That print is the price, not a pre-market stock. */
function vixLive(symbol: string, minute: number): boolean {
  return symbol.toUpperCase() === 'VIX' && minute >= 3 * 60 + 15 && minute <= INDEX_CASH_TO;
}

/** Price off the tape when the vendor has no stock-state. A regular print keeps yesterday as prev_close; after hours
    prev_close is today's regular close, the way the vendor's stock-state is read. */
function quoteFromBars(symbol: string, bars: readonly UwBar[]): { close: number; prev_close: number; market_time: string; tape_time: string } | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const lastAt = Date.parse(last.end_time || last.start_time || '');
  const close = num(last.close);
  if (!Number.isFinite(lastAt) || !(close > 0)) return null;
  const minute = nyMinutes(lastAt);
  const day = nyIsoDate(lastAt);
  let prior = 0;
  let todayReg = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].market_time !== 'r') continue;
    const at = Date.parse(bars[i].end_time || bars[i].start_time || '');
    if (!Number.isFinite(at)) continue;
    const d = nyIsoDate(at);
    const c = num(bars[i].close);
    if (!(c > 0)) continue;
    if (d === day) {
      if (!todayReg) todayReg = c;
    } else if (d < day) {
      prior = c;
      break;
    }
  }
  const tape_time = last.end_time || last.start_time || '';
  if (vixLive(symbol, minute) && minute < OPEN_MIN) return { close, prev_close: prior || close, market_time: 'regular', tape_time };
  if (last.market_time === 'r') return { close, prev_close: prior || close, market_time: 'regular', tape_time };
  if (last.market_time === 'pr') return { close, prev_close: prior || todayReg || close, market_time: 'premarket', tape_time };
  return { close, prev_close: todayReg || prior || close, market_time: 'postmarket', tape_time };
}

/** Last regular close of each finished session on the tape. Today is included only after the index close window, so a mid-session print is not cached as the close. */
function closesFromTape(bars: readonly UwBar[]): { date: string; close: number }[] {
  const by = new Map<string, { t: number; close: number }>();
  for (const b of bars) {
    if (b.market_time !== 'r') continue;
    const t = Date.parse(b.end_time || b.start_time || '');
    const c = num(b.close);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    const day = nyIsoDate(t);
    const cur = by.get(day);
    if (!cur || t >= cur.t) by.set(day, { t, close: c });
  }
  const today = nyIsoDate();
  const includeToday = nyMinutes() > INDEX_CASH_TO;
  return [...by.entries()]
    .filter(([date]) => date < today || (date === today && includeToday))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 5)
    .map(([date, v]) => ({ date, close: v.close }));
}

/** The price when the vendor's stock-state is missing. Indexes use the index print. Stocks use the last trade, not the bid. */
export async function tapeQuote(symbol: string): Promise<{ close: number; prev_close: number; market_time: string; tape_time: string } | null> {
  const name = symbol.trim().toUpperCase();
  if (!name) return null;
  const index = INDEX_TAPE.has(name);
  const bars = await thetaTape(name, index);
  const quoted = quoteFromBars(name, bars);
  if (!quoted) return null;
  noteBarCloses(name, closesFromTape(bars), index);
  return quoted;
}
const BOARD_MS = 90_000;
const FULL_MS = 45_000;

type BookMode = 'board' | 'full';

interface Entry {
  ticker: string;
  /** How the failed read answered, when the message named a status. */
  http?: number;
  /** loading until the book lands, live once it has, error after the read threw. */
  status?: 'loading' | 'live' | 'error';
  at: number;
  full: boolean;
  wantFull: boolean;
  spot: number;
  prev: number;
  /** The regular session's change, percent (data/dayChange.ts) — 0 until `dayKnown` */
  changePct: number;
  /** The move outside the session (pre-market / after hours), percent, or null in the session */
  extPct?: number | null;
  phase?: MarketPhase;
  /** False after the bell until the regular closes land (the state's own change would be the after-hours move) */
  dayKnown?: boolean;
  /** The last print — the after-hours or pre-market one outside the session (`spot` is then the regular close) */
  last?: number;
  /** The stock-state as read: close, prev_close, market_time */
  state?: { close: number; prev_close: number; market_time?: string };
  iv: number;
  /** Vendor implied move into today's expiry, dollars. 0 until that row exists. Already the move from the quote — not a full-year vol. */
  impliedMove: number;
  /** One session of the surface, as a fraction of spot (interpolated 1-day). 0 until it lands. */
  dayMoveFrac: number;
  /** The interpolated 1-day implied vol, annualised fraction (interpolated-iv, days = 1) — one FULL session's vol, which
      the same-day expiry's own implied move stops being once its session runs (peekDaySigma) */
  dayIv?: number;
  all: StrikeNode[];
  byDate: Record<string, StrikeNode[]>;
  expiries: { date: string; dte: number }[];
  flow: Map<number, { call: number; put: number }>;
  /** Cash session only. The book, the clock and the level report read these. */
  candles: Candle[];
  /** Every bar the vendor sent, including premarket and after hours. */
  tape: Candle[];
  history: GexSnapshot[];
  /** Prior sessions' close-of-day strike books. One snapshot each, stamped on that session's last bar. Not a walk of today's chain. */
  closes?: GexSnapshot[];
  /** Same-day expiry, and everything after it. Absent until both books exist. */
  history0?: GexSnapshot[];
  historyRest?: GexSnapshot[];
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
  /** The dates whose contract rows have been read (painted, or asked and refused) — the flip is final only once its own-vol
      dates are here. */
  factsDates?: Set<string>;
  /** Every listed date has landed at least once (a later refresh re-reads them in place) — until then the Map's
      matrix window is still growing, and says so */
  everFull?: boolean;
  /** Each expiry's own implied move (volatility/term-structure implied_move), dollars from the quote into that expiry */
  termMove?: Record<string, number>;
  /** The vendor's own scaling of its implied move against the ATM vol, k in move = k·S·σ·√(dte/365) (≈ 0.68), fitted
      off its own term-structure rows — the formula a date with no implied move of its own is read with */
  termK?: number;
  /** The calendar days to each expiry the vendor's implied moves are quoted over (its `dte`) */
  termDte?: Record<string, number>;
  /** The whole book's gamma is the vendor's live open-interest book (spot-exposures/strike), not the morning snapshot */
  gammaLive?: boolean;
  /** When the price in `spot` was printed (epoch ms): the state's tape time, the newest bar's, or the price refresh's quote */
  priceAt?: number;
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

/** Both legs negated into the house sign (head of this file, core/walls.ts). */
/* greek-exposure rows are shares (greek × OI × 100); scaled to the house's dollars: GEX per 1% × S²·1%, DEX × S, vanna
   per vol point × S·1%, charm per session × S/252. */
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
  /* This row is every expiry at the strike, calls and puts already split. It is not one expiry's volume,
     and it is not the flow inventory. The inventory reads option-contracts for that expiry only. */
  const m = new Map<number, { call: number; put: number }>();
  for (const r of rows) {
    const k = num(r.strike);
    if (k > 0) m.set(k, { call: num(r.call_volume), put: num(r.put_volume) });
  }
  return m;
}

/* The book's gamma is the vendor's spot-exposures rows: open interest priced at the current price each minute
   (call_gamma_oi / put_gamma_oi, $ per 1%; equal to OI × Γ × 100 × S² × 1% off option-contracts). Their vanna and charm
   are scaled to the house's dollars (fitted against the share rows; the put legs print with the opposite sign). */
type LiveLeg = {
  c: number;
  p: number;
  px?: number;
  at?: number;
  cv: number;
  pv: number;
  cc: number;
  pc: number;
  /** The vendor row included its vanna fields, so a zero is a real zero */
  vanna: boolean;
  charm: boolean;
};
type LiveGamma = Map<number, LiveLeg>;
/** A settled date's live rows (ticker|date), kept only to come off the whole book's live total */
const settledLive = new Map<string, LiveGamma>();
const liveGammaCache = new Map<string, { at: number; rows: LiveGamma }>();
const liveGammaWait = new Map<string, Promise<LiveGamma | null>>();
const LIVE_GAMMA_MS = 60_000;

/* Each spot-exposures row carries the price and minute it was priced at; the flip re-prices each leg from there, so a
   shut market's flip stands still until the vendor prints a new minute. */
const gammaPriced = new Map<string, { price: number; at: number }>();
/** The price and the instant the vendor priced a name's live gamma rows (one date, or the whole book) — null until in */
export const peekGammaPriced = (ticker: string, date: string | null): { price: number; at: number } | null =>
  gammaPriced.get(`${ticker.toUpperCase()}|${date ?? 'ALL'}`) ?? null;

const blankLeg = (): LiveLeg => ({ c: 0, p: 0, cv: 0, pv: 0, cc: 0, pc: 0, vanna: false, charm: false });

function liveGammaRows(rows: unknown, into: LiveGamma, stamp?: { price: number; at: number }): number {
  if (!Array.isArray(rows)) return 0;
  for (const r of rows as Record<string, unknown>[]) {
    const k = num(r.strike);
    if (!(k > 0)) continue;
    const at = Date.parse(String(r.time ?? ''));
    const px = num(r.price);
    /* each row's own pricing (after the vendor's overnight roll the rows of one date carry their own minutes and prices) */
    const own = Number.isFinite(at) && px > 0;
    if (stamp && own && at >= stamp.at) {
      stamp.at = at;
      stamp.price = px;
    }
    const cur = into.get(k) ?? blankLeg();
    cur.c += num(r.call_gamma_oi);
    cur.p += num(r.put_gamma_oi);
    if ('call_vanna_oi' in r || 'put_vanna_oi' in r) {
      cur.cv += num(r.call_vanna_oi);
      cur.pv += num(r.put_vanna_oi);
      cur.vanna = true;
    }
    if ('call_charm_oi' in r || 'put_charm_oi' in r) {
      cur.cc += num(r.call_charm_oi);
      cur.pc += num(r.put_charm_oi);
      cur.charm = true;
    }
    if (own && (cur.at == null || at >= cur.at)) {
      cur.at = at;
      cur.px = px;
    }
    into.set(k, cur);
  }
  return rows.length;
}

/** The live open-interest gamma per strike (retail sign: calls +, puts −, dollars per 1%) — every expiry when `date` is
    null, else that one date. Null when the vendor has none. Kept a minute. */
function liveGamma(ticker: string, date: string | null, priority = false): Promise<LiveGamma | null> {
  const key = `${ticker}|${date ?? 'ALL'}`;
  const hit = liveGammaCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_GAMMA_MS) return Promise.resolve(hit.rows);
  const running = liveGammaWait.get(key);
  if (running) return running;
  const job = (async (): Promise<LiveGamma | null> => {
    const out: LiveGamma = new Map();
    const t = encodeURIComponent(ticker);
    const stamp = { price: 0, at: 0 };
    if (date) {
      const res = await uwCall(`/stock/${t}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(date)}&limit=500`, priority);
      if (res.error) return hit?.rows ?? null;
      liveGammaRows(res.data, out, stamp);
    } else {
      for (let page = 0; page < 6; page++) {
        const res = await uwCall(`/stock/${t}/spot-exposures/strike?limit=500&page=${page}`, priority);
        if (res.error) {
          if (out.size) break;
          return hit?.rows ?? null;
        }
        if (liveGammaRows(res.data, out, stamp) < 500) break;
      }
    }
    if (stamp.price > 0 && stamp.at > 0) gammaPriced.set(`${ticker.toUpperCase()}|${date ?? 'ALL'}`, stamp);
    liveGammaCache.set(key, { at: Date.now(), rows: out });
    return out;
  })().finally(() => liveGammaWait.delete(key));
  liveGammaWait.set(key, job);
  return job;
}

/** The live gamma still carried by contracts that have settled (dates before the book's day), RETAIL sign, dollars per
    1% — what the vendor's whole-book figures (spot-exposures/strike, the minute series) still count after the close.
    0 when nothing settled is listed; null while a settled date's live rows are not in yet. */
export function peekSettledNet(ticker: string): number | null {
  const e = cache.get(ticker.toUpperCase());
  if (!e) return null;
  const floor = isoDate(bookToday());
  const settled = (e.expiries ?? []).map(x => x.date).filter(d => d < floor);
  let sum = 0;
  for (const d of settled) {
    const rows = settledLive.get(`${e.ticker}|${d}`);
    if (!rows) return null;
    for (const v of rows.values()) sum += v.c + v.p;
  }
  return sum;
}

/** A chain with its gamma replaced by the live open-interest book (house sign) — strikes the live book holds that the
    chain lacks are added, strikes it lacks carry no gamma. Vanna and charm on those rows are the same minute's book,
    scaled into the house's dollars (see the note above liveGammaRows): per vol point, and per session. */
const CHARM_SESSION = 0.01 * 365 * 252;
function withLiveGamma(chain: readonly StrikeNode[], live: LiveGamma): StrikeNode[] {
  const seen = new Set<number>();
  const paint = (n: StrikeNode, l: LiveLeg | undefined): StrikeNode => {
    const callGex = l ? -l.c : 0;
    const putGex = l ? -l.p : 0;
    const next: StrikeNode = { ...n, callGex, putGex, netGex: callGex + putGex, gexPx: l?.px, gexAt: l?.at };
    if (l?.vanna && l.px != null && l.px > 0) {
      const callVanna = -l.cv * l.px * 0.01;
      const putVanna = l.pv * l.px * 0.01;
      next.callVanna = callVanna;
      next.putVanna = putVanna;
      next.netVanna = callVanna + putVanna;
    }
    if (l?.charm) {
      const callCharm = -l.cc / CHARM_SESSION;
      const putCharm = l.pc / CHARM_SESSION;
      next.callCharm = callCharm;
      next.putCharm = putCharm;
      next.netCharm = callCharm + putCharm;
    }
    return next;
  };
  const out: StrikeNode[] = chain.map(n => {
    seen.add(n.strike);
    return paint(n, live.get(n.strike));
  });
  for (const [k, l] of live) {
    /* zero-gamma strikes are kept too: a new listing with no open interest yet is a date that IS in, not one missing */
    if (seen.has(k)) continue;
    out.push(paint(emptyNode(k), l));
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/* Every date's live gamma in one walk of spot-exposures/expiry-strike without `expirations[]` (500 rows a page); each
   date's rows are kept exactly as the per-date ask keeps them. Null when a page fails. */
/* One walk shared: a walk in flight, or finished within WALK_REUSE_MS, answers a second caller. */
const WALK_REUSE_MS = 15_000;
const walks = new Map<string, { at: number; p: Promise<Map<string, LiveGamma> | null> }>();
function liveGammaAll(ticker: string, priority = false): Promise<Map<string, LiveGamma> | null> {
  const key = ticker.toUpperCase();
  const hit = walks.get(key);
  if (hit && Date.now() - hit.at < WALK_REUSE_MS) return hit.p;
  const p = liveGammaWalk(ticker, priority);
  const entry = { at: Date.now(), p };
  walks.set(key, entry);
  void p.then(got => {
    if (got == null) walks.delete(key);
    else entry.at = Date.now();
  });
  return p;
}
/* No read waits forever: a walk page or a date's chain that has not answered in its time is taken as failed, and the
   date is asked on its own (or on the next pass). */
const WALK_PAGE_MS = 25_000;
const DATE_READ_MS = 40_000;
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const id = setTimeout(() => resolve(null), ms);
    p.then(
      v => {
        clearTimeout(id);
        resolve(v);
      },
      () => {
        clearTimeout(id);
        resolve(null);
      },
    );
  });
}
async function liveGammaWalk(ticker: string, priority = false): Promise<Map<string, LiveGamma> | null> {
  const t = encodeURIComponent(ticker);
  const rowsBy = new Map<string, Record<string, unknown>[]>();
  for (let page = 0; page < 60; page++) {
    const res = await within(uwCall(`/stock/${t}/spot-exposures/expiry-strike?limit=500&page=${page}`, priority), WALK_PAGE_MS);
    if (!res || res.error || !Array.isArray(res.data)) return null;
    const rows = res.data as Record<string, unknown>[];
    for (const r of rows) {
      const d = String(r.expiry ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const list = rowsBy.get(d) ?? [];
      list.push(r);
      rowsBy.set(d, list);
    }
    if (rows.length < 500) break;
  }
  const out = new Map<string, LiveGamma>();
  const now = Date.now();
  for (const [date, rows] of rowsBy) {
    const live: LiveGamma = new Map();
    const stamp = { price: 0, at: 0 };
    liveGammaRows(rows, live, stamp);
    if (stamp.price > 0 && stamp.at > 0) gammaPriced.set(`${ticker.toUpperCase()}|${date}`, stamp);
    liveGammaCache.set(`${ticker}|${date}`, { at: now, rows: live });
    out.set(date, live);
  }
  return out;
}

/* The dates' gamma kept live: every live date's rows are re-read in one walk (kept a minute) whenever the book
   refreshes, and laid onto the chains in hand; other greeks and contract facts stay. */
const datesGammaAt = new Map<string, number>();
async function refreshDatesGamma(entry: Entry, token: number): Promise<void> {
  if (!entry.gammaLive) return;
  const t = entry.ticker;
  if (Date.now() - (datesGammaAt.get(t) ?? 0) < LIVE_GAMMA_MS) return;
  datesGammaAt.set(t, Date.now());
  const walked = await liveGammaAll(t, isHot(t)).catch(() => null);
  if (!walked || gen.get(t) !== token) return;
  const cur = cache.get(t);
  if (!cur) return;
  const floor = isoDate(bookToday());
  const byDate = { ...cur.byDate };
  let changed = false;
  for (const [d, live] of walked) {
    if (d < floor || !byDate[d]?.length) continue;
    byDate[d] = withLiveGamma(byDate[d], live);
    changed = true;
  }
  if (!changed) return;
  cur.byDate = byDate;
  cur.at = Date.now();
  cache.set(t, cur);
  emit();
}

/** One date's chain. With the greeks: the vendor's strike rows (delta, vanna, charm) carrying the live gamma. Without:
    the live gamma alone (one call — the Board reads nothing else off a date), the strike rows only if it fails. */
async function dateChain(ticker: string, date: string, spot: number, withGreeks: boolean, priority = false): Promise<StrikeNode[] | null> {
  const settled = date < isoDate(bookToday());
  const [rows, live] = await Promise.all([
    withGreeks || settled ? whalesGreekStrikeExpiry(ticker, date).catch(() => null) : Promise.resolve(null),
    liveGamma(ticker, date, priority).catch(() => null),
  ]);
  let base = Array.isArray(rows) ? chainFrom(rows, spot, new Map()) : [];
  /* A date that settled at 4:00: its live rows are kept to come off the whole book (liveAll); its chain is the vendor's
     morning rows — the book the session ran on, for the session's report. */
  if (settled) {
    if (live) settledLive.set(`${ticker}|${date}`, live);
    if (base.length) return base;
    return live ? withLiveGamma([], live) : null;
  }
  if (live) return withLiveGamma(base, live);
  if (!withGreeks) {
    const again = await whalesGreekStrikeExpiry(ticker, date).catch(() => null);
    /* both asks failed: null, so the date is asked again rather than marked empty for good */
    if (!Array.isArray(again)) return null;
    base = chainFrom(again, spot, new Map());
  } else if (!Array.isArray(rows)) return null;
  return base;
}

function candlesFrom(bars: UwBar[], cashTo = CLOSE_MIN): { cash: Candle[]; tape: Candle[] } {
  const parsed: Candle[] = [];
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
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
  /* The 16:00 bar is the closing print. An index keeps the auction through 16:15 (`cashTo`). A later bar is after hours. */
  const inCash = (b: Candle) => {
    const m = nyMinutes(b.time * 1000);
    return m >= OPEN_MIN && m <= cashTo;
  };
  const session = tape.filter(inCash);
  const lastCash = [...parsed].reverse().find(inCash);
  const lastDay = lastCash ? nyIsoDate(lastCash.time * 1000) : null;
  const prior = lastDay && lastDay !== day ? parsed.filter(b => inCash(b) && nyIsoDate(b.time * 1000) === lastDay) : [];
  /* Once today's session has a bar it is the session; the counts wait for their own minimum of bars. */
  if (session.length >= 1 && day === nyIsoDate()) return { cash: session, tape: tape.length ? tape : parsed };
  const cash = session.length >= 2 ? session : prior.length >= 2 ? prior : tape.filter(b => nyIsoDate(b.time * 1000) === day);
  return { cash: cash.length >= 2 ? cash : parsed, tape: tape.length ? tape : parsed };
}

/** Last two regular sessions, for the chart only. SPX keeps three so the prior closes can carry their own books. The book itself stays on today's cash bars. */
const chartSpan = new Map<string, Candle[]>();
/** Every bar the feed sent, all sessions. A session filter reads this. It never borrows another session. */
const chartAll = new Map<string, Candle[]>();

function twoCashSessions(bars: UwBar[], cashTo: number, keepDays = 2): Candle[] {
  const parsed: Candle[] = [];
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
    const m = nyMinutes(time * 1000);
    if (m < OPEN_MIN || m > cashTo) continue;
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
  const days: string[] = [];
  for (const c of parsed) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const keep = new Set(days.slice(-keepDays));
  return parsed.filter(c => keep.has(nyIsoDate(c.time * 1000)));
}

/** The last two cash sessions once the book has landed. Null until then. */
function chartBars(ticker: string): Candle[] | null {
  const rows = chartSpan.get(sameName(ticker));
  return rows && rows.length >= 2 ? rows : null;
}

function parseTape(bars: UwBar[]): Candle[] {
  const parsed: Candle[] = [];
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
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
  return parsed;
}

/** Bars in one session only. Null means that session has no prints. */
function sessionChartBars(ticker: string, session: DeskSession = getDeskSession()): Candle[] | null {
  if (session === 'rth') {
    const span = chartBars(ticker);
    if (span && span.length >= 1) return span;
    const cash = bookCandles(ticker);
    return cash && cash.length >= 1 ? cash : null;
  }
  const all = chartAll.get(sameName(ticker)) ?? peekEntry(ticker)?.tape ?? [];
  if (!all.length) return null;
  const rows = all.filter(c => minuteInSession(nyMinutes(c.time * 1000), session));
  if (rows.length < 1) return null;
  const days: string[] = [];
  for (const c of rows) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const keep = new Set(days.slice(-2));
  return rows.filter(c => keep.has(nyIsoDate(c.time * 1000)));
}

/** The bars the chart should draw. The asked session wins. If it has no prints, the last session that does is used and named — never a silent swap.
    A strike book priced on a different day, or more than 1.5% away from the last candle, is named too. The nodes and the candles are not two prices. */
export function deskTape(ticker: string, session: DeskSession = getDeskSession()): { bars: Candle[]; drawn: DeskSession; note: string | null } {
  const own = sessionChartBars(ticker, session);
  let drawn = session;
  let note: string | null = null;
  let bars: Candle[] = own ?? [];
  if (!own || own.length < 1) {
    bars = [];
    note = `${sessionMeta(session).label} has no prints.`;
  }
  const last = bars[bars.length - 1];
  const priced = peekGammaPriced(ticker, null);
  const blank = blankTapeDay.get(sameName(ticker));
  if (blank && (!last || nyIsoDate(last.time * 1000) < blank)) {
    note = `${blank} minute bars were empty. Showing ${last ? nyIsoDate(last.time * 1000) : 'nothing'}.`;
  } else if (last && priced && priced.price > 0) {
    const candleDay = nyIsoDate(last.time * 1000);
    const bookDay = nyIsoDate(priced.at);
    if (bookDay && candleDay && bookDay !== candleDay) {
      note = `Candles are ${candleDay}. The strike book is ${bookDay}, priced at ${priced.price.toFixed(2)}.`;
    } else if (Math.abs(priced.price - last.close) / priced.price > 0.015) {
      note = `Candles end at ${last.close.toFixed(2)}. The strike book is priced at ${priced.price.toFixed(2)}.`;
    }
  }
  return { bars, drawn, note };
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

/* The vendor's vega stays on the leg until paintLegs replaces it. The node is Black-Scholes vega at the live spot,
   on the trading clock, times the same signed count as gamma. Both legs take −1. A count that has crossed zero
   flips the sign with the rest of the book. */
const LONG_QUOTE_MS = 15 * 60_000;

function quoteUsable(row: UwContract, expiry: string, now = Date.now()): boolean {
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  if (bid > 0 && ask > 0 && bid > ask + 1e-6) return false;
  if (bid === 0 && ask === 0 && (row.nbbo_bid != null || row.nbbo_ask != null)) return false;
  const stamp = Date.parse(String(row.last_tape_time || row.updated_at || ''));
  const limit = expiry ? quoteMaxAge(expiry, now) : LONG_QUOTE_MS;
  if (Number.isFinite(stamp) && now - stamp > limit) return false;
  return true;
}

/** The vendor's implied vol. A stale quote after the close is not a reason to throw it away: the mid is not solved, and this number is the fallback the higher greeks use. */
function contractIv(row: UwContract, _expiry: string, _now = Date.now()): number {
  const iv = num(row.implied_volatility);
  if (!(iv > 0) || iv >= 10) return 0;
  return iv;
}

const DEALER_SHORT = -1;

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
  callAsk: number;
  callBid: number;
  putAsk: number;
  putBid: number;
  callMulti: number;
  putMulti: number;
  callMid: number;
  putMid: number;
  callNone: number;
  putNone: number;
  callBidPx: number;
  callAskPx: number;
  putBidPx: number;
  putAskPx: number;
}

function emptyLeg(): LegBook {
  return { callOI: 0, putOI: 0, callVex: 0, putVex: 0, callVol: 0, putVol: 0, callIv: 0, putIv: 0, callGamma: 0, putGamma: 0, callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, callMulti: 0, putMulti: 0, callMid: 0, putMid: 0, callNone: 0, putNone: 0, callBidPx: 0, callAskPx: 0, putBidPx: 0, putAskPx: 0 };
}

function foldContracts(rows: UwContract[], expiry: string, now = Date.now()): Map<number, LegBook> {
  const by = new Map<number, LegBook>();
  for (const row of rows) {
    const parsed = parseOcc(String(row.option_symbol || ''));
    if (!parsed || parsed.expiry !== expiry) continue;
    const oi = num(row.open_interest);
    const vol = num(row.volume);
    const vega = num(row.vega);
    const leg = by.get(parsed.strike) ?? emptyLeg();
    const dollar = oi * 100 * vega;
    const quoteOk = quoteUsable(row, expiry, now);
    const iv = contractIv(row, expiry);
    const gamma = num(row.gamma);
    const askVol = num(row.ask_volume);
    const bidVol = num(row.bid_volume);
    const multi = num(row.multi_leg_volume);
    const midVol = num(row.mid_volume);
    const none = num(row.no_side_volume);
    const bidPx = num(row.nbbo_bid);
    const askPx = num(row.nbbo_ask);
    if (parsed.right === 'CALL') {
      leg.callOI += oi;
      leg.callVol += vol;
      leg.callAsk += askVol;
      leg.callBid += bidVol;
      leg.callMulti += multi;
      leg.callMid += midVol;
      leg.callNone += none;
      if (quoteOk && bidPx > 0) leg.callBidPx = bidPx;
      if (quoteOk && askPx > 0) leg.callAskPx = askPx;
      leg.callVex += dollar * DEALER_SHORT;
      if (iv > 0) leg.callIv = iv;
      if (gamma > 0) leg.callGamma = gamma;
    } else {
      leg.putOI += oi;
      leg.putVol += vol;
      leg.putAsk += askVol;
      leg.putBid += bidVol;
      leg.putMulti += multi;
      leg.putMid += midVol;
      leg.putNone += none;
      if (quoteOk && bidPx > 0) leg.putBidPx = bidPx;
      if (quoteOk && askPx > 0) leg.putAskPx = askPx;
      leg.putVex += dollar * DEALER_SHORT;
      if (iv > 0) leg.putIv = iv;
      if (gamma > 0) leg.putGamma = gamma;
    }
    by.set(parsed.strike, leg);
  }
  return by;
}

/** A date's chain with its contracts' facts (vols, OI, delta, vanna, charm, vega) laid on — new nodes, never the old
    ones edited, so whatever is keyed on the old chain recomputes. Gamma stays the vendor's open-interest rows. */
function paintLegs(nodes: readonly StrikeNode[], book: Map<number, LegBook>, oi: boolean, spot = 0, expiry = '', ticker = ''): StrikeNode[] {
  /* vols are put on the trading clock at the minute (and price) the vendor priced the date's gamma, the clock the flip
     re-prices at — never the wall clock, or a shut market's book would drift overnight with no new rows */
  const priced = pricedClockOf(nodes);
  const t = expiry ? tradingYears(expiry) : 0;
  const near = !!expiry && flowWindow(expiry);
  const carry = ticker ? carryFor(ticker) : null;
  const painted = nodes.map(n0 => {
    const leg = book.get(n0.strike);
    if (!leg) return n0;
    const n: StrikeNode = { ...n0 };
    if (oi) {
      n.callOI = leg.callOI;
      n.putOI = leg.putOI;
    }
    if (leg.callIv > 0) n.callIv = leg.callIv;
    if (leg.putIv > 0) n.putIv = leg.putIv;
    if (leg.callGamma > 0) n.callGamma = leg.callGamma;
    if (leg.putGamma > 0) n.putGamma = leg.putGamma;
    if (leg.callVol > 0 || leg.putVol > 0) {
      n.callVol = leg.callVol;
      n.putVol = leg.putVol;
    }
    return n;
  });
  if (expiry && spot > 0) {
    for (const n of painted) {
      const leg = book.get(n.strike);
      if (!leg) continue;
      if (leg.callIv > 0 || (leg.callBidPx > 0 && leg.callAskPx > 0)) n.callIv = ivOnTradingClock(leg.callBidPx, leg.callAskPx, leg.callIv, priced.px || spot, n.strike, expiry, 'C', priced.at, carry?.r, carry?.q);
      if (leg.putIv > 0 || (leg.putBidPx > 0 && leg.putAskPx > 0)) n.putIv = ivOnTradingClock(leg.putBidPx, leg.putAskPx, leg.putIv, priced.px || spot, n.strike, expiry, 'P', priced.at, carry?.r, carry?.q);
    }
  }
  smoothSide(painted, 'callIv');
  smoothSide(painted, 'putIv');
  if (!(spot > 0) || !(t > 0)) return painted;
  let volSum = 0;
  let bareSum = 0;
  const closes: CloseRow[] = [];
  const flowNets: { strike: number; value: number }[] = [];
  for (const n of painted) {
    const leg = book.get(n.strike);
    if (!leg) continue;
    /* Every greek counts open interest, like the vendor's gamma rows. The ask-minus-bid inventory is only a
       side estimate (the morning-miss score and the flow peaks); it never reaches the book's gamma, walls or flip. */
    const callN = leg.callOI;
    const putN = leg.putOI;
    const callNet = flowImbalance(leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
    const putNet = flowImbalance(leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
    const gross = leg.callVol + leg.putVol;
    const bare = leg.callMid + leg.callNone + leg.putMid + leg.putNone;
    const firm = !near || flowFirm(Math.abs(callNet) + Math.abs(putNet), gross, unsignedShare(bare, 0, gross));
    n.flowFirm = firm;
    const call = n.callIv && n.callIv > 0 ? blackScholesGreeks(spot, n.strike, t, n.callIv, carry?.r, carry?.q) : null;
    const put = n.putIv && n.putIv > 0 ? blackScholesGreeks(spot, n.strike, t, n.putIv, carry?.r, carry?.q) : null;
    if (near) {
      const callInv = dealerInventory(leg.callOI, leg.callAsk, leg.callBid, leg.callMulti, leg.callVol);
      const putInv = dealerInventory(leg.putOI, leg.putAsk, leg.putBid, leg.putMulti, leg.putVol);
      closes.push({ expiry, strike: n.strike, right: 'C', flow: callInv, oi: leg.callOI });
      closes.push({ expiry, strike: n.strike, right: 'P', flow: putInv, oi: leg.putOI });
      /* house sign, the vendor's convention: calls negative, puts positive */
      const scale = spot * spot * 0.01 * 100;
      flowNets.push({ strike: n.strike, value: (put ? put.gamma * putInv * scale : 0) - (call ? call.gamma * callInv * scale : 0) });
    }
    volSum += leg.callVol + leg.putVol;
    bareSum += leg.callMid + leg.callNone + leg.putMid + leg.putNone;
    /* Vega is repriced here, on this clock and this vol, not the vendor's calendar-time vega. */
    n.callBook = callN;
    n.putBook = putN;
    if (call && callN !== 0) {
      n.callDex = -call.deltaCall * callN * 100 * spot;
      n.callVanna = -call.vanna * callN * spot;
      n.callCharm = -(call.charmCall / 252) * callN * 100 * spot;
      n.callVex = -call.vega * callN * 100;
    } else {
      n.callVex = 0;
    }
    if (put && putN !== 0) {
      n.putDex = -put.deltaPut * putN * 100 * spot;
      n.putVanna = -put.vanna * putN * spot;
      n.putCharm = -(put.charmPut / 252) * putN * 100 * spot;
      n.putVex = -put.vega * putN * 100;
    } else {
      n.putVex = 0;
    }
    n.netVex = n.callVex + n.putVex;
    n.netDex = n.callDex + n.putDex;
    n.netVanna = n.callVanna + n.putVanna;
    n.netCharm = n.callCharm + n.putCharm;
  }
  if (ticker && spot > 0 && near) {
    const flow = peakStrikes(flowNets);
    const oi = peakStrikes(painted.map(n => ({ strike: n.strike, value: n.netGex })));
    noteNodes(ticker, spot, flow, oi, volSum > 0 ? unsignedShare(bareSum, 0, volSum) : null);
  }
  if (ticker && near && closes.length) noteClose(ticker, nyIsoDate(), closes);
  return painted;
}

/** The minute and price the vendor priced a date's gamma rows at (the latest row's), else the wall clock */
function pricedClockOf(nodes: readonly StrikeNode[]): { at: number; px: number } {
  let at = 0;
  let px = 0;
  for (const n of nodes)
    if (n.gexAt != null && n.gexAt >= at) {
      at = n.gexAt;
      px = n.gexPx ?? 0;
    }
  return at > 0 ? { at, px } : { at: Date.now(), px: 0 };
}

/** One expiry's book off the vendor's raw rows, the path a live date takes (spot-exposures/expiry-strike gamma, then
    the date's option-contracts laid on). For the proofs (scripts/gamma-sign-proof.ts). */
export function expiryBookFromRows(spotRows: unknown, contracts: UwContract[], spot: number, expiry: string): StrikeNode[] {
  const live: LiveGamma = new Map();
  liveGammaRows(spotRows, live);
  const chain = withLiveGamma([], live);
  return contracts.length ? paintLegs(chain, foldContracts(contracts, expiry, pricedClockOf(chain).at), true, spot, expiry) : chain;
}

function smoothSide(nodes: StrikeNode[], key: 'callIv' | 'putIv'): void {
  const next = smoothSmile(nodes.map(n => ({ strike: n.strike, iv: n[key] ?? 0 })));
  const by = new Map(next.map(p => [p.strike, p.iv]));
  for (const n of nodes) {
    const iv = by.get(n.strike);
    if (iv != null && iv !== n[key]) n[key] = iv;
  }
}

/** A date's chain read again keeps the contract facts its last read was painted with (vols, per-contract gamma, open
    interest, vega) until its contracts are read again — a refresh never drops the flip back to the at-the-money vol */
function carryFacts(next: StrikeNode[], prev: readonly StrikeNode[] | undefined): StrikeNode[] {
  if (!prev?.length) return next;
  const at = new Map(prev.map(n => [n.strike, n]));
  return next.map(n => {
    const o = at.get(n.strike);
    if (!o || !(o.callIv || o.putIv || o.callGamma || o.putGamma)) return n;
    return {
      ...n,
      callIv: n.callIv || o.callIv,
      putIv: n.putIv || o.putIv,
      callGamma: n.callGamma || o.callGamma,
      putGamma: n.putGamma || o.putGamma,
      /* the contracts' own open interest, as painted, until they are read again (Building values each contract against it) */
      callOI: o.callOI || n.callOI,
      putOI: o.putOI || n.putOI,
      callBook: n.callBook ?? o.callBook,
      putBook: n.putBook ?? o.putBook,
      callVex: n.callBook != null || n.putBook != null ? n.callVex : o.callVex || n.callVex,
      putVex: n.callBook != null || n.putBook != null ? n.putVex : o.putVex || n.putVex,
      netVex: n.callBook != null || n.putBook != null ? n.callVex + n.putVex : (o.callVex || n.callVex) + (o.putVex || n.putVex),
    };
  });
}

/** Sum the per-expiry vega already on the book onto the aggregate chain (a new aggregate — see paintLegs). */
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
  let changed = false;
  const next = entry.all.map(n => {
    const v = agg.get(n.strike);
    if (!v || (n.callVex === v.call && n.putVex === v.put)) return n;
    changed = true;
    return { ...n, callVex: v.call, putVex: v.put, netVex: v.call + v.put };
  });
  if (changed) entry.all = next;
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
  /* laid onto the book's current copy, so a refresh while the contracts were read does not throw them away */
  void token;
  const still = () => cache.get(entry.ticker)?.status === 'live';
  const dates = only ? only.filter(d => d in entry.byDate) : Object.keys(entry.byDate);
  if (!dates.length) return;
  /* One expiry at a time (the whole-name walk of option-contracts pages unstably); a date whose read fails is left unread
     so it is asked again, never taken as having no contracts. */
  const hot = isHot(entry.ticker);
  const books = await mapLimit(dates, 3, async date => {
    try {
      const rows = await whalesOptionContractsPaged(entry.ticker, date, hot);
      return [date, Array.isArray(rows) ? foldContracts(rows, date, pricedClockOf(entry.byDate[date] ?? []).at) : null] as const;
    } catch {
      return [date, null] as const;
    }
  });
  if (!still()) return;
  const current = cache.get(entry.ticker);
  if (!current) return;
  const byDate = { ...current.byDate };
  const facts = new Set(current.factsDates ?? []);
  for (const [date, book] of books) {
    if (!book) continue;
    const chain = byDate[date];
    if (chain && book.size) byDate[date] = paintLegs(chain, book, true, current.spot, date, current.ticker);
    facts.add(date);
  }
  current.byDate = byDate;
  current.factsDates = facts;
  vexOntoAll(current);
  current.at = Date.now();
  cache.set(current.ticker, current);
  emit();
}

/** One book at every bar of the tape. The dollars are the chain's own net gamma, the same figure the strike rail
    shows. Today's volume is not a second multiplier: on a 0DTE name it is many times the open interest, and scaling
    by it turned a $50M strike into tens of billions. */
function historyFrom(chain: StrikeNode[], candles: Candle[], _flow: Map<number, { call: number; put: number }>): GexSnapshot[] {
  if (!chain.length || !candles.length) return [];
  return candles.map(c => ({
    time: c.time,
    levels: chain.map(n => ({
      strike: n.strike,
      value: n.netGex,
      dex: n.netDex ?? 0,
      vex: n.netVex ?? 0,
      callOI: n.callOI,
      putOI: n.putOI,
      firm: n.flowFirm !== false,
    })),
  }));
}

function mergeChains(parts: StrikeNode[][]): StrikeNode[] {
  const by = new Map<number, StrikeNode>();
  for (const chain of parts) {
    for (const n of chain) {
      const prev = by.get(n.strike);
      if (!prev) {
        by.set(n.strike, { ...n });
        continue;
      }
      prev.callOI += n.callOI;
      prev.putOI += n.putOI;
      prev.callGex += n.callGex;
      prev.putGex += n.putGex;
      prev.netGex += n.netGex;
      prev.callDex += n.callDex;
      prev.putDex += n.putDex;
      prev.netDex += n.netDex;
      prev.callVex += n.callVex;
      prev.putVex += n.putVex;
      prev.netVex += n.netVex;
      prev.netVanna += n.netVanna;
      prev.netCharm += n.netCharm;
    }
  }
  return [...by.values()];
}

/** Two scales once a same-day expiry and a later one are both in. The front date is the first expiry still open, never the vendor's dte 0 after that day has settled. */
function noteSplit(entry: Entry): void {
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length).sort();
  const zeroDate = dates[0];
  const restDates = zeroDate ? dates.filter(d => d !== zeroDate) : [];
  if (!zeroDate || !restDates.length) {
    entry.history0 = undefined;
    entry.historyRest = undefined;
    return;
  }
  const histAll = entry.tape.length >= 2 ? entry.tape : entry.candles;
  const candles = entry.wantFull ? histAll : histAll.filter((c, i) => i === histAll.length - 1 || Math.floor(c.time / 60) % 5 === 0);
  entry.history0 = historyFrom(entry.byDate[zeroDate], candles, entry.flow);
  entry.historyRest = historyFrom(mergeChains(restDates.map(d => entry.byDate[d])), candles, entry.flow);
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
  const walls = pickLegWalls(chain, n => n.callGex, n => n.putGex);
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

/* Never an expired date: a choice resolves to its own date, else the first listing after it, else the nearest live one. */
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
  /* the date chainsFor hands the pages, resolved step for step the same way */
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor);
  const hit = closestDate(isoDate(expiryFor(dte, bookToday()).date), dates);
  if (hit && entry.byDate[hit]?.length) return hit;
  if (choice !== '0DTE') return null;
  return [...dates].sort().find(d => entry.byDate[d]?.length) ?? null;
}

const LIVE_KEYS = ['callGex', 'putGex', 'netGex', 'callDex', 'putDex', 'netDex', 'callVex', 'putVex', 'netVex', 'callVanna', 'putVanna', 'netVanna', 'callCharm', 'putCharm', 'netCharm', 'callOI', 'putOI'] as const;

/* The whole book without the day that settled: the vendor's totals still carry it until they roll, so once that date's
   own chain is in it comes off the total, strike by strike. */
function liveAll(entry: Entry): StrikeNode[] {
  const memo = liveAllMemo.get(entry);
  const floor = isoDate(bookToday());
  if (memo && memo.all === entry.all && memo.byDate === entry.byDate && memo.floor === floor && memo.n === entry.expiries.length) return memo.out;
  const out = oneSnapshot(entry, liveAllOld(entry));
  liveAllMemo.set(entry, { all: entry.all, byDate: entry.byDate, floor, n: entry.expiries.length, out });
  return out;
}
const liveAllMemo = new WeakMap<Entry, { all: StrikeNode[]; byDate: Entry['byDate']; floor: string; n: number; out: StrikeNode[] }>();

/* Once every live listed date's rows are in, the whole book's call and put gamma at each strike ARE those dates' rows
   added up (one snapshot for net, walls and flip); until then the vendor's whole-book rows stand in, provisional.
   Delta, vanna, charm and open interest stay on the whole-book greek rows. */
function oneSnapshot(entry: Entry, base: StrikeNode[]): StrikeNode[] {
  const floor = isoDate(bookToday());
  /* every live listing must be one the dates read (the first forty — datesComplete) */
  if (!entry.gammaLive || !datesComplete(entry) || entry.expiries.filter(e => e.date >= floor).length > 40) return base;
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length);
  if (!dates.length) return base;
  const sum = new Map<number, { c: number; p: number; px?: number; at?: number }>();
  for (const d of dates)
    for (const n of entry.byDate[d]) {
      const cur = sum.get(n.strike) ?? { c: 0, p: 0 };
      cur.c += n.callGex;
      cur.p += n.putGex;
      if (n.gexAt != null && (cur.at == null || n.gexAt >= cur.at)) {
        cur.at = n.gexAt;
        cur.px = n.gexPx;
      }
      sum.set(n.strike, cur);
    }
  const seen = new Set<number>();
  const out = base.map(n => {
    seen.add(n.strike);
    const v = sum.get(n.strike);
    const callGex = v ? v.c : 0;
    const putGex = v ? v.p : 0;
    return { ...n, callGex, putGex, netGex: callGex + putGex, gexPx: v?.px ?? n.gexPx, gexAt: v?.at ?? n.gexAt };
  });
  for (const [k, v] of sum) if (!seen.has(k)) out.push({ ...emptyNode(k), callGex: v.c, putGex: v.p, netGex: v.c + v.p, gexPx: v.px, gexAt: v.at });
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/** The book a finished session ran on: the live dates' rows with that session's settled contracts put back — null until
    every date is in. */
export function peekSessionAll(ticker: string, settledDate: string): StrikeNode[] | null {
  const e = cache.get(ticker.toUpperCase());
  if (!e || e.status !== 'live' || !e.gammaLive) return null;
  const floor = isoDate(bookToday());
  if (!datesComplete(e) || e.expiries.filter(x => x.date >= floor).length > 40) return null;
  const live = liveAll(e);
  const rows = settledLive.get(`${e.ticker}|${settledDate}`);
  if (!rows?.size) return live;
  const seen = new Set<number>();
  const out = live.map(n => {
    seen.add(n.strike);
    const l = rows.get(n.strike);
    if (!l) return n;
    const callGex = n.callGex - l.c;
    const putGex = n.putGex - l.p;
    return { ...n, callGex, putGex, netGex: callGex + putGex };
  });
  for (const [k, l] of rows) if (!seen.has(k)) out.push({ ...emptyNode(k), callGex: -l.c, putGex: -l.p, netGex: -l.c - l.p });
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

function liveAllOld(entry: Entry): StrikeNode[] {
  const floor = isoDate(bookToday());
  const settled = Object.keys(entry.byDate).filter(d => d < floor && entry.byDate[d]?.length);
  if (!settled.length) return entry.all;
  /* the live whole book carries the settled contracts' gamma until the vendor rolls: their own live rows come off */
  const liveOff = new Map<number, { c: number; p: number }>();
  if (entry.gammaLive)
    for (const d of settled) {
      const rows = settledLive.get(`${entry.ticker}|${d}`);
      if (rows) for (const [k, v] of rows) {
        const cur = liveOff.get(k) ?? { c: 0, p: 0 };
        cur.c += v.c;
        cur.p += v.p;
        liveOff.set(k, cur);
      }
    }
  const off = new Map<number, StrikeNode[]>();
  for (const d of settled) for (const n of entry.byDate[d]) off.set(n.strike, [...(off.get(n.strike) ?? []), n]);
  return entry.all.map(n => {
    const gone = off.get(n.strike);
    const lo = liveOff.get(n.strike);
    if (!gone && !lo) return n;
    const out = { ...n };
    if (lo) {
      out.callGex = n.callGex + lo.c;
      out.putGex = n.putGex + lo.p;
      out.netGex = out.callGex + out.putGex;
    }
    if (!gone) return out;
    for (const k of LIVE_KEYS) {
      /* on the live book the settled gamma came off above, from the settled date's own live rows */
      if (entry.gammaLive && (k === 'callGex' || k === 'putGex' || k === 'netGex')) continue;
      const less = gone.reduce((a, g) => a + (g[k] ?? 0), 0);
      if (less) out[k] = (k === 'callOI' || k === 'putOI') ? Math.max(0, out[k] - less) : out[k] - less;
    }
    return out;
  });
}

function chainsFor(entry: Entry): Partial<Record<string, StrikeNode[]>> {
  const dates = Object.keys(entry.byDate).filter(d => d >= isoDate(bookToday()) && expiryOpen(d));
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

/* The listing as it stands on the book's day: settled dates leave it, the rest count their days from the book's day. */
function liveListing(expiries: Entry['expiries']): Entry['expiries'] {
  const floor = isoDate(bookToday());
  const settledFront = expiries.find(e => e.dte === 0 && e.date < floor);
  /* the vendor's dte counts calendar days (Oct 21 → Oct 26 is 5), so the shift does too — a Friday's settled front is three days behind Monday */
  const shift = settledFront ? Math.round((Date.parse(`${floor}T00:00:00Z`) - Date.parse(`${settledFront.date}T00:00:00Z`)) / 86_400_000) : 0;
  const live = expiries.filter(e => e.date >= floor && expiryOpen(e.date)).map(e => (shift ? { ...e, dte: Math.max(0, e.dte - shift) } : e));
  return live;
}

/* A name's snapshot is built once per state of its own book (the arrays it is made of, the price, the day's move, the
   session phase) and handed out again until one of them changes. */
const snapMemo = new WeakMap<Entry, Map<LevelsScope, { sig: string; refs: unknown[]; snap: MarketSnapshot }>>();
function materialize(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const refs: unknown[] = [entry.byDate, entry.all, entry.expiries, entry.candles, entry.termIv, entry.totals, entry.factsDates, entry.state, entry.flow, entry.history];
  const sig = [entry.spot, entry.changePct, entry.extPct, entry.phase, entry.dayKnown, entry.iv, entry.gammaLive, entry.full, entry.frontFacts, entry.factsDates?.size ?? 0, entry.candles.length, entry.candles[entry.candles.length - 1]?.close, isoDate(bookToday()), nySessionPhase(Date.now()), settledLive.size, gammaPriced.size].join('|');
  let byScope = snapMemo.get(entry);
  const hit = byScope?.get(scope);
  if (hit && hit.sig === sig && hit.refs.every((r, i) => r === refs[i])) return hit.snap;
  const snap = materializeNow(entry, scope);
  if (!byScope) {
    byScope = new Map();
    snapMemo.set(entry, byScope);
  }
  byScope.set(scope, { sig, refs, snap });
  return snap;
}
function materializeNow(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const uwChains = chainsFor(entry);
  const today = uwChains['0DTE'];
  const chain = scope === 'ALL' ? (uwChains.ALL ?? entry.all) : today && today.length ? today : (uwChains.ALL ?? entry.all);
  const closes = entry.candles.map(c => c.close);
  const snap: MarketSnapshot = {
    ticker: entry.ticker,
    spot: entry.spot,
    changePercent: entry.changePct,
    dayMove: { extPct: entry.extPct ?? null, phase: entry.phase ?? 'regular', known: entry.dayKnown !== false },
    priceHistory: closes.slice(-120),
    chain,
    indicators: indicatorsOf(closes),
    plan: planFor(entry.ticker, entry.spot, chain, null),
    tape: [],
    liveBook: true,
    uwChains,
    uwByDate: entry.byDate,
    uwExpiries: liveListing(entry.expiries),
    uwFacts: entry.factsDates,
  };
  /* the plan's flip zone is the one flip (data/flipLevel.ts), read off the snapshot's own levels chain */
  const flip = levelFlip(snap, chain).flip;
  if (flip != null) snap.plan = { ...snap.plan, flipZone: flip, direction: entry.spot >= flip ? 'BULLISH' : 'BEARISH' };
  return snap;
}

export function peekEntry(ticker: string): Entry | undefined {
  return cache.get(ticker.toUpperCase());
}

/** Every listed date of a full book has landed once — the Map's matrix window is final */
export const bookDatesIn = (ticker: string): boolean => {
  const e = peekEntry(ticker);
  return !!e && (!!e.everFull || (e.status === 'live' && !e.wantFull));
};

/** When the price Pinpoint reads for a name was printed (epoch ms) — null until its book is live */
export function peekPriceAt(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.priceAt ? e.priceAt : null;
}

/* The Board's prices every ten seconds in one /screener/stocks call while the session runs; the levels refresh on their
   own cadence. Names whose book is not live yet are left alone. */
const pricedAsk = new Map<string, number>();
const PRICES_MS = 10_000;
export function refreshBoardPrices(tickers: readonly string[]): void {
  if (SIM_DESK || typeof window === 'undefined') return;
  const now = Date.now();
  /* per name: a name asked in the last ten seconds (by the Board or the page on it) is not asked again */
  const live = tickers.map(t => t.toUpperCase()).filter(t => {
    const e = cache.get(t);
    return e?.status === 'live' && e.state?.market_time === 'regular' && now - (pricedAsk.get(t) ?? 0) >= PRICES_MS - 500;
  });
  if (!live.length) return;
  const [y, m, d] = nyIsoDate().split('-').map(Number);
  if (!isTradingDay(new Date(y, m - 1, d)) || nyMinutes() < OPEN_MIN || nyMinutes() >= CLOSE_MIN) return;
  for (const t of live) pricedAsk.set(t, now);
  void (async () => {
    let changed = false;
    for (let i = 0; i < live.length; i += 50) {
      const part = live.slice(i, i + 50);
      const res = await uwCall(`/screener/stocks?ticker=${part.map(encodeURIComponent).join(',')}`);
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const t = String(r.ticker ?? '').toUpperCase();
        const e = cache.get(t);
        const px = num(r.close);
        const at = num(r.quote_time);
        if (!e || e.status !== 'live' || !(px > 0) || !(at > 0) || String(r.date ?? '') !== nyIsoDate()) continue;
        if (e.priceAt && at <= e.priceAt) continue;
        if (Math.abs(px - e.spot) > e.spot * 0.2) continue;
        e.priceAt = at;
        if (px === e.spot) continue;
        e.spot = px;
        e.last = px;
        if (e.state) e.state = { ...e.state, close: px };
        applyDay(e);
        changed = true;
      }
    }
    if (changed) emit();
  })().catch(() => {});
}

export function peekSpot(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.spot > 0 ? e.spot : null;
}

/** The last print when it is not the price the page uses — after hours or pre-market — with which it is; else null */
export function peekExtLast(ticker: string): { price: number; word: 'after hours' | 'pre-market' } | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.last || !(e.last > 0) || Math.abs(e.last - e.spot) < 0.005) return null;
  return e.phase === 'pre' ? { price: e.last, word: 'pre-market' } : e.phase === 'post' ? { price: e.last, word: 'after hours' } : null;
}

export function peekChange(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.dayKnown !== false ? e.changePct : null;
}

/** The day's move as a reader needs it: the regular session's change, and the move outside it kept apart */
export interface DayMove {
  dayPct: number | null;
  extPct: number | null;
  phase: MarketPhase;
}
export function peekDayMove(ticker: string): DayMove | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  return { dayPct: e.dayKnown === false ? null : e.changePct, extPct: e.extPct ?? null, phase: e.phase ?? 'regular' };
}

/* The day's change is today's regular close against the one before it (data/dayChange.ts); after the close
   close − prev_close on the stock-state is the after-hours move, kept apart. */
function applyDay(entry: Entry): void {
  const st = entry.state;
  if (!st) return;
  const ph = dayChangeOf(st, null).phase;
  /* Every phase but the session needs the regular closes (before the open the lead figure is the last session's change). */
  const needsCloses = ph !== 'regular';
  const closes = peekRegularCloses(entry.ticker);
  const ch = dayChangeOf(st, closes);
  entry.phase = ch.phase;
  entry.dayKnown = Number.isFinite(ch.dayPct) && (!needsCloses || !!closes?.length);
  entry.changePct = entry.dayKnown ? ch.dayPct : 0;
  entry.extPct = ch.extPct;
}

function needDay(entry: Entry): void {
  if (entry.dayKnown !== false) return;
  const t = entry.ticker;
  void loadRegularCloses(t)
    .then(() => {
      const cur = cache.get(t);
      if (!cur) return;
      applyDay(cur);
      emit();
    })
    .catch(() => {});
}

/** "−1.18%" — the regular session's change; null while it is not known */
const fmtPct = (v: number, digits = 2): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

/** The day's move in words: "−1.18% · after hours +0.05%", "pre-market +0.40%", or "−1.18%" in the session */
export function dayMoveWords(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string; when: string | null } | null {
  const w = dayMoveWordsOf(m, digits);
  if (!w) return null;
  /* the session named by its date when it is not today's (before the open, a weekend or a holiday) */
  const rec = recordIso();
  return { ...w, when: m && m.dayPct != null && rec !== nyIsoDate() ? monDayOf(rec) : null };
}
function dayMoveWordsOf(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string } | null {
  if (!m) return null;
  const ext = m.extPct != null && Number.isFinite(m.extPct) ? `${m.phase === 'pre' ? 'pre-market' : 'after hours'} ${fmtPct(m.extPct, digits)}` : null;
  if (m.phase === 'pre') {
    /* before the open: the last session's change, the pre-market move beside it */
    return {
      main: m.dayPct != null && Number.isFinite(m.dayPct) ? fmtPct(m.dayPct, digits) : '…',
      ext,
      title: `${longDayOf(recordIso())}’s regular-session change (its 4:00 close against the close before). The session has not opened${ext ? `; ${ext} against that close` : ''}.`,
    };
  }
  if (m.dayPct == null) return { main: '…', ext, title: 'The day’s change is loading (the regular closes are read once a day)' };
  /* the session named by its date when it is not New York's today */
  const rec = recordIso();
  const word = rec === nyIsoDate() ? 'Today’s' : `${longDayOf(rec)}’s`;
  return {
    main: fmtPct(m.dayPct, digits),
    ext,
    title: ext
      ? `${word} regular-session change (4:00 close against the close before), ${fmtPct(m.dayPct, digits)}; ${ext} is the move since the 4:00 close`
      : `${word} change against the regular close before it`,
  };
}
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Thu Oct 22" (data/bookWindow.ts longDay, kept here without the import cycle) */
const longDayOf = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${DOW3[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${monDayOf(iso)}` : iso;
};

/** The ink of a change: green up, red down, neutral at zero */
export const changeInk = (v: number | null | undefined): string => (v == null || Math.abs(v) < 0.005 ? 'rgb(var(--text-secondary))' : v > 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))');

export function peekIv(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.iv > 0 ? e.iv : null;
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

/** Each expiry's own implied move off the term structure, dollars — null when the rows carry none */
function termMoveOf(rows: UwTerm[], spot: number): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = String(r.expiry ?? '');
    const v = num(r.implied_move);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0 && v < spot * 0.5) out[d] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The vendor's k (see Entry.termK): the median of move ÷ (S·σ·√(dte/365)) over its rows — null when no row carries both */
function termKOf(rows: UwTerm[], spot: number): number | null {
  if (!Array.isArray(rows) || !(spot > 0)) return null;
  const ks: number[] = [];
  for (const r of rows) {
    let v = num(r.volatility);
    if (v > 3) v /= 100;
    const m = num(r.implied_move);
    const dte = num((r as Record<string, unknown>).dte);
    if (v > 0 && v < 5 && m > 0 && dte > 0) ks.push(m / (spot * v * Math.sqrt(dte / 365)));
  }
  if (!ks.length) return null;
  ks.sort((a, b) => a - b);
  const k = ks[Math.floor(ks.length / 2)];
  return k > 0.3 && k < 1.2 ? k : null;
}
function termDteOf(rows: UwTerm[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r.expiry ?? '');
    const dte = num((r as Record<string, unknown>).dte);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && dte > 0) out[d] = dte;
  }
  return Object.keys(out).length ? out : null;
}
/*
  The expected move, as ONE STANDARD MOVE (1σ, dollars). The vendor's implied move is its ATM straddle, so 1σ is
  straddle·√(π/2) (data/expectedMove.ts); a date with no implied move takes the straddle off its ATM vol on the vendor's
  own scale, k·S·σ·√(dte/365) (k fitted off its rows, √(2/π) without them). Every odd and the cone read these.
*/
interface ScopeMove {
  /** Dollars, one standard move (1σ) over the horizon */
  move: number;
  /** The vendor's straddle the move was read from, dollars (≈0.80σ) */
  straddle: number;
  /** The expiry the move runs to */
  until: string | null;
  /** True when that expiry is past the coming session — the odds are "by <date>", not "by the close" */
  multi: boolean;
  source: 'vendor' | 'fitted' | 'iv30';
  /** "1σ = the vendor's straddle into Nov 20 × 1.25" — which number was used, in words */
  words: string;
}
export const monDayOf = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON3[m - 1]} ${d}` : iso;
};
/** The straddle a vendor vol implies over `dte` calendar days on the vendor's own scale */
const straddleOf = (e: Entry, iv: number, dte: number): number => (e.termK ?? STRADDLE_K) * e.spot * iv * Math.sqrt(dte / 365);
export function peekScopeMove(ticker: string, date?: string | null): ScopeMove | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const session = isoDate(nextSession(bookToday()));
  const multi = !!d && d > session;
  const name = d ? monDayOf(d) : null;
  const vendor = d ? e.termMove?.[d] : undefined;
  const of = (straddle: number, source: ScopeMove['source'], words: string): ScopeMove => ({ move: sigmaFromStraddle(straddle), straddle, until: d, multi, source, words: `1σ = ${words} × ${STRADDLE_TO_SIGMA.toFixed(2)}` });
  if (vendor && vendor > 0) return of(vendor, 'vendor', `the vendor's straddle into ${name}`);
  const dte = (d && e.termDte?.[d]) || (d ? Math.max(1, Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${floor}T00:00:00Z`)) / 86_400_000) + 1) : 1);
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return of(straddleOf(e, atm, dte), 'fitted', `the straddle ${name}'s at-the-money vol prices`);
  if (e.iv > 0) return of(straddleOf(e, e.iv, dte), 'iv30', `the straddle the 30-day implied vol prices (no vol printed for ${name ?? 'the expiry'})`);
  return null;
}

/*
  One full session's 1σ, dollars, for the expiry the levels read. The vendor's straddle into the coming session while
  that session has not opened; once a same-day expiry's session runs its straddle is only what is LEFT, so a full
  session is the 1-day vol on the vendor's scale. A later expiry: its ATM vol over one session. Null without a move.
*/
const sameDayRunning = (d: string | null): boolean => !!d && d === nyIsoDate() && nySessionPhase() !== 'before';
export function peekDaySigma(ticker: string, date?: string | null): number | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const session = isoDate(nextSession(bookToday()));
  const move = d ? e.termMove?.[d] : undefined;
  if (d === session && move && move > 0) {
    if (!sameDayRunning(d)) return sigmaFromStraddle(move);
    if (e.dayIv && e.dayIv > 0) return sigmaFromStraddle(straddleOf(e, e.dayIv, 1));
    if (e.dayMoveFrac > 0 && e.dayMoveFrac < 0.2) return sigmaFromStraddle(e.dayMoveFrac * e.spot);
    const left = Math.max(0, CLOSE_MIN - nyMinutes());
    return sigmaFromStraddle(move) / Math.sqrt(Math.max(0.1, left / (CLOSE_MIN - OPEN_MIN)));
  }
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return sigmaFromStraddle(straddleOf(e, atm, 1));
  return e.iv > 0 ? sigmaFromStraddle(straddleOf(e, e.iv, 1)) : null;
}

/** 1σ from now to the close, dollars, time-scaled once: a same-day expiry's straddle read in its session already IS the
    move left; a full session's 1σ is scaled by √(minutes left / 390). `minutesLeft`: 390 outside the session. */
export function peekMoveToClose(ticker: string, date: string | null | undefined, minutesLeft: number): number | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const move = d ? e.termMove?.[d] : undefined;
  if (d && sameDayRunning(d) && nySessionPhase() === 'open' && move && move > 0) return sigmaFromStraddle(move);
  const day = peekDaySigma(ticker, date);
  return day == null ? null : sigmaOverMinutes(day, minutesLeft);
}

/** The interpolated 1-day implied vol (days = 1), annualised fraction — null when the rows carry none */
function dayIvOf(rows: UwInterp[]): number | null {
  if (!Array.isArray(rows)) return null;
  const ones = rows.filter(r => num(r.days) === 1 && num(r.volatility) > 0);
  if (!ones.length) return null;
  const row = ones.reduce((best, r) => (String(r.date ?? '') > String(best.date ?? '') ? r : best));
  let v = num(row.volatility);
  if (v > 3) v /= 100;
  return v > 0 && v < 5 ? v : null;
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

const BOOK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function expiryLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  const month = BOOK_MONTHS[(parts[1] ?? 1) - 1] ?? iso;
  return `${month} ${parts[2] ?? ''}`.trim();
}

/** The chain the chart, the header and the calendar column share. A date is that expiry. Null is the first expiry still open. `'book'` is every expiry added together.
    `movedFrom` is set when the date asked for has settled and the chain drawn is the next one still open. */
export function chainForDate(ticker: string, date: string | 'book' | null): { nodes: StrikeNode[]; label: string; kind: 'Flow' | 'OI'; date: string; movedFrom: string | null } | null {
  const entry = peekEntry(ticker);
  if (!entry || entry.status !== 'live') return null;
  const kindOf = (nodes: StrikeNode[]): 'Flow' | 'OI' => (nodes.some(n => n.oiNetGex != null) ? 'Flow' : 'OI');
  if (date === 'book') {
    return entry.all.length ? { nodes: entry.all, label: 'Every expiry', kind: kindOf(entry.all), date: 'book', movedFrom: null } : null;
  }
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && expiryOpen(d) && entry.byDate[d]?.length).sort();
  const asked = date && date !== 'book' ? date : null;
  const hit = asked && asked >= floor && expiryOpen(asked) && entry.byDate[asked]?.length ? asked : dates[0];
  if (!hit) return null;
  const nodes = entry.byDate[hit];
  const label = expiryLabel(hit);
  const movedFrom = asked && asked !== hit && !expiryOpen(asked) ? expiryLabel(asked) : null;
  return { nodes, label, kind: kindOf(nodes), date: hit, movedFrom };
}

/** One book, stamped on the tape. The dollars are that chain's own net gamma. */
export function historyForDate(ticker: string, date: string | 'book' | null): GexSnapshot[] | null {
  const entry = peekEntry(ticker);
  const picked = chainForDate(ticker, date);
  if (!entry || entry.status !== 'live' || !picked) return null;
  const histAll = entry.tape.length >= 2 ? entry.tape : entry.candles;
  const candles = entry.wantFull ? histAll : histAll.filter((c, i) => i === histAll.length - 1 || Math.floor(c.time / 60) % 5 === 0);
  return historyFrom(picked.nodes, candles, entry.flow);
}

/** Session bars once the book is live. Empty until then — never a made-up chain. */
export function liveBars(ticker: string): Candle[] {
  const t = ticker?.toUpperCase();
  if (!t) return [];
  ensureBook(t, 'board');
  return bookCandles(t) ?? dayBars(t) ?? [];
}

/** One minute of the vendor's own gamma (spot-exposures).
    Positive dampens, the same way the book's net does — call positive, put negative. */
interface BookMinute {
  time: number;
  min: number;
  net: number;
  spot: number | null;
}

const minuteCache = new Map<string, BookMinute[]>();
/** Which of the vendor's minute series a name's path is: open interest (the levels' measure), volume, or directional */
const minuteKind = new Map<string, 'oi' | 'vol' | 'dir'>();
export const bookMinuteKind = (ticker: string): 'oi' | 'vol' | 'dir' | null => minuteKind.get(ticker.toUpperCase()) ?? null;
const minuteWait = new Map<string, Promise<void>>();
const minuteRevListeners = new Set<() => void>();
let minuteRev = 0;

function publishMinutes(ticker: string, rows: BookMinute[]) {
  minuteCache.set(ticker, rows);
  minuteRev += 1;
  minuteRevListeners.forEach(fn => fn());
}

/** The day's gamma, one print a minute: the open-interest series first, then volume gamma, then directional. */
export function ensureBookMinutes(ticker: string): void {
  if (SIM_DESK) return;
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
    /* The open-interest series first: gamma_per_one_percent_move_oi is the whole book re-priced each minute (the same
       measure as the levels' net GEX); volume, then directional, only when it is absent. */
    const oiRows: BookMinute[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const ms = Date.parse(String(o.start_time ?? o.time ?? ''));
      const v = parseFloat(String(o.gamma_per_one_percent_move_oi ?? ''));
      if (!Number.isFinite(ms) || !Number.isFinite(v)) continue;
      const px = parseFloat(String(o.price ?? ''));
      oiRows.push({ time: Math.floor(ms / 60000) * 60, min: nyMinutes(ms), spot: Number.isFinite(px) && px > 0 ? px : null, net: -v });
    }
    const dedupe = (rows: BookMinute[]) => rows.filter((r, i, a) => a.findIndex(x => x.time === r.time) === i);
    const alive = (rows: BookMinute[]) => rows.reduce((n, r) => n + (r.net !== 0 ? 1 : 0), 0);
    const oiKept = dedupe(oiRows);
    const rows = alive(oiKept) >= 8 ? oiKept : alive(volRows) >= 8 ? volRows : alive(dirRows) >= 8 ? dirRows : volRows.length >= 2 ? volRows : dirRows;
    minuteKind.set(t, rows === oiKept ? 'oi' : rows === volRows ? 'vol' : 'dir');
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
  const name = sameName(ticker);
  ensureBook(name, mode);
  const e = peekEntry(name);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, levelsForName(ticker));
}

export function subscribeBook(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The book's revision — bumps whenever any name's book lands or changes. Caches keyed on a snapshot key on this too. */
export const bookRevision = (): number => rev;

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

/** The session the charts should draw for this name. The clock still moves. A name that does not trade that window stays on the cash session. */
export function useResolvedSession(ticker: string): SessionRead {
  const asked = useDeskSession();
  const rev = useBookRev();
  return useMemo(() => {
    const bars = dayBars(ticker);
    const mins = bars ? bars.map(b => nyMinutes(b.time * 1000)) : null;
    return resolveDeskSession(ticker, mins, asked);
  }, [ticker, asked, rev]);
}

/** The name on screen. Full book: every expiry column, the session's minutes. Null until the first live print — never the simulator's price. */
export function usePinpointFeed(ticker: string | null | undefined): MarketSnapshot | null {
  const name = ticker ? sameName(ticker) : ticker;
  const scope = useNameLevels(name);
  const version = useBookRev();
  useEffect(() => {
    if (!name) return;
    markHotName(name);
    const had = peekEntry(name);
    ensureBook(name, 'full', had?.status === 'error');
    startPinpoint(name);
    const id = window.setInterval(() => ensureBook(name, 'full'), 30_000);
    const px = window.setInterval(() => refreshBoardPrices([name]), PRICES_MS);
    return () => {
      window.clearInterval(id);
      window.clearInterval(px);
    };
  }, [name]);
  return useMemo(() => {
    if (!name) return null;
    const e = peekEntry(name);
    if (!e || e.status !== 'live' || !e.all.length) return null;
    return materialize(e, scope);
    // version bumps when a book lands or refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scope, version]);
}

/* The names on screen first: the key allows three calls at once, so the queue order is the fill order — the name the
   desk is on, and SPY, jump it. */
const hotNames = new Set<string>(['SPY']);
let hotActive: string | null = null;
/** The name the desk is on — its calls jump the key's queue (SPY's always do) */
function markHotName(ticker: string | null | undefined): void {
  const t = ticker?.trim().toUpperCase() || null;
  if (t === hotActive) return;
  if (hotActive && hotActive !== 'SPY') hotNames.delete(hotActive);
  hotActive = t;
  if (t) hotNames.add(t);
}
const isHot = (ticker: string): boolean => hotNames.has(ticker.toUpperCase());

async function hotGet<T>(path: string, hot: boolean): Promise<T> {
  const got = await uwCall(path, hot);
  if (got.error) throw new Error(got.error);
  return got.data as T;
}

/** The last regular session's close off the one-minute bars (the last bar the vendor marks "r"; its daily close for that
    date when the daily rows are in), with the newest extended-hours print kept apart — for a state outside the session
    that still says "regular". Null when the bars carry no regular bar. */
function regularCloseOf(ticker: string, bars: readonly UwBar[]): { close: number; prevClose: number; at: number; last: number; marketTime: string } | null {
  let reg: { t: number; close: number } | null = null;
  let ext: { t: number; close: number; mt: string } | null = null;
  for (const b of bars) {
    const mt = String((b as { market_time?: string }).market_time ?? '');
    const t = Date.parse(b.end_time || b.start_time || '');
    const c = num(b.close);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    if (mt === 'r') {
      if (!reg || t > reg.t) reg = { t, close: c };
    } else if ((mt === 'po' || mt === 'pr') && (!ext || t > ext.t)) ext = { t, close: c, mt };
  }
  if (!reg) return null;
  const day = nyIsoDate(reg.t - 60_000);
  const closes = peekRegularCloses(ticker) ?? [];
  const own = closes.find(c => c.date === day);
  const before = closes.find(c => c.date < day);
  const close = own?.close ?? reg.close;
  const after = ext && ext.t > reg.t ? ext : null;
  return {
    close,
    prevClose: before?.close ?? 0,
    at: reg.t,
    last: after ? after.close : close,
    /* the phase the extended print belongs to; with no print past the close the session is simply over */
    marketTime: after?.mt === 'pr' ? 'premarket' : 'postmarket',
  };
}

/** One close-of-day strike book. A past date is the session's close, not a minute trail. Rows whose stamp is not that date are refused. */
async function spxCloseGamma(date: string): Promise<LiveGamma | null> {
  const out: LiveGamma = new Map();
  const seen = new Set<number>();
  for (let page = 0; page < 8; page++) {
    const res = await uwCall(`/stock/SPX/spot-exposures/strike?date=${encodeURIComponent(date)}&limit=500&page=${page}`);
    if (res.error) return out.size ? out : null;
    const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
    const fresh = rows.filter(r => {
      const k = num(r.strike);
      if (!(k > 0) || seen.has(k)) return false;
      const stamp = String(r.time ?? '');
      if (stamp) {
        const at = Date.parse(stamp);
        const same = stamp.startsWith(date) || (Number.isFinite(at) && nyIsoDate(at) === date);
        if (!same) return false;
      }
      seen.add(k);
      return true;
    });
    if (!fresh.length) break;
    liveGammaRows(fresh, out);
    if (rows.length < 500) break;
  }
  return out.size ? out : null;
}

function snapOfClose(time: number, live: LiveGamma): GexSnapshot {
  const levels: GexSnapshot['levels'] = [];
  for (const [strike, leg] of live) {
    const value = -(leg.c + leg.p);
    if (!value) continue;
    levels.push({ strike, value });
  }
  levels.sort((a, b) => a.strike - b.strike);
  return { time, levels };
}

/** The two sessions before today, each as the vendor's close book on that session's last bar. */
async function attachSpxCloses(ticker: string, token: number): Promise<void> {
  if (sameName(ticker) !== 'SPX') return;
  const span = chartSpan.get('SPX');
  if (!span?.length) return;
  const days: string[] = [];
  for (const c of span) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const prior = days.filter(d => d < nyIsoDate()).slice(-2);
  const snaps: GexSnapshot[] = [];
  for (const date of prior) {
    if (gen.get(ticker) !== token) return;
    const live = await spxCloseGamma(date);
    if (!live) continue;
    const last = span.filter(c => nyIsoDate(c.time * 1000) === date).pop();
    if (!last) continue;
    snaps.push(snapOfClose(last.time, live));
  }
  const cur = cache.get(ticker);
  if (!cur || gen.get(ticker) !== token || !snaps.length) return;
  cur.closes = snaps;
  emit();
}

async function loadCore(ticker: string, mode: BookMode, token: number): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const hot = isHot(ticker);
  const t = encodeURIComponent(ticker);
  const [stateRaw, strikeRaw, oiRows, flowRows, ivRows, termRows, interpRows, stockBars, live] = await Promise.all([
    (hot ? hotGet<UwState>(`/stock/${t}/stock-state`, true) : whalesState(ticker)).catch(() => null),
    (hot ? hotGet<UwGreekStrike[]>(`/stock/${t}/greek-exposure/strike`, true) : whalesGreekStrike(ticker)).catch(() => [] as UwGreekStrike[]),
    whalesOiStrike(ticker).catch(() => [] as UwGreekStrike[]),
    whalesFlowStrike(ticker).catch(() => [] as UwFlowStrike[]),
    whalesIvRank(ticker, hot).catch(() => []),
    (hot ? hotGet<UwTerm[]>(`/stock/${t}/volatility/term-structure`, true) : whalesTermStructure(ticker)).catch(() => [] as UwTerm[]),
    whalesInterpIv(ticker).catch(() => [] as UwInterp[]),
    /* a whole day of one-minute bars (pre-market, the session and the evening) */
    /* one-minute bars for every name, the same URL the full book and the Dossier read (one proxy copy) */
    /* Two cash sessions for the chart (yesterday and today). 1800 one-minute bars
       reach the prior open; the book's own candles stay today's session. */
    whalesBars(ticker, '1m', 1800).catch(() => [] as UwBar[]),
    liveGamma(ticker, null, hot).catch(() => null),
  ]);
  if (!still()) return;
  /* An index has no stock bars on this key (SPX /ohlc/1m is 422). A stock whose bars did not come back is read off the same terminal — the last trade, not a bid. */
  let bars: UwBar[] = Array.isArray(stockBars) ? stockBars : [];
  let tapeKind: 'vendor' | 'index' | 'stock' = 'vendor';
  if (bars.length === 0 && INDEX_TAPE.has(ticker)) {
    bars = await thetaTape(ticker, true);
    if (bars.length) tapeKind = 'index';
    if (!still()) return;
  } else if (bars.length === 0) {
    bars = await thetaTape(ticker, false);
    if (bars.length) tapeKind = 'stock';
    if (!still()) return;
  }
  let state = stateRaw;
  let strikes = Array.isArray(strikeRaw) ? strikeRaw : [];
  /* An index has no stock-state or quote: the live gamma rows carry the price they were marked at, and greek-exposure has
     the strikes. */
  if ((!state || strikes.length === 0) && live && live.size) {
    if (strikes.length === 0) {
      strikes = [...live.keys()].filter(k => k > 0).map(strike => ({ strike }));
    }
    if (!state) {
      const px = peekGammaPriced(ticker, null)?.price ?? 0;
      if (px > 0) {
        const phase = nySessionPhase();
        state = { close: px, prev_close: px, market_time: phase === 'open' ? 'regular' : phase === 'before' ? 'premarket' : 'postmarket' };
      }
    }
  }
  /* Still no price: the screener's close. Indexes often have one when stock-state does not. */
  if (!state && strikes.length > 0) {
    const rows = await whalesScreener([ticker], true).catch(() => [] as Record<string, unknown>[]);
    const row = Array.isArray(rows) ? rows.find(r => String(r.ticker || '').toUpperCase() === ticker) ?? rows[0] : null;
    const px = num(row?.close) || num(row?.prev_close);
    if (px > 0) state = { close: px, prev_close: num(row?.prev_close) || px, market_time: 'postmarket' };
  }
  /* A name the vendor does not price any other way is read off the local chain.
     SPX and SPXW are one book. Do not wait on a dead terminal — four seconds, then the book fails and can be asked again. */
  if ((!state || strikes.length === 0) && !uwOnlyDesk()) {
    const local = await Promise.race([
      awaitSpotGex(ticker),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
    ]);
    if (still() && local && local.used > 0 && local.spot > 0) {
      const g = local.spot * local.spot * 0.01;
      if (strikes.length === 0) {
        strikes = local.strikes
          .filter(s => s.callOi > 0 || s.putOi > 0)
          .map(s => ({ strike: s.strike, call_gex: s.callOi / g, put_gex: -(s.putOi / g) }));
      }
      if (!state) {
        const book = sameName(ticker) === 'SPX' ? spxRead() : null;
        const prev = book && book.prevClose > 0 ? book.prevClose : local.spot;
        state = { close: book?.spot || local.spot, prev_close: prev, market_time: 'postmarket' };
      }
    }
  }
  /* No stock-state. The tape's own print is the price: today's close stays today's close, and yesterday is only the change. */
  if (tapeKind !== 'vendor' && !stateRaw && bars.length) {
    const quoted = quoteFromBars(ticker, bars);
    if (quoted) state = quoted;
  }
  if (!state || strikes.length === 0) throw new Error('shape');
  /* Outside the session the price is the regular close (the levels were priced there); the after-hours or pre-market
     print is kept apart (`last`) and labelled where shown. */
  /* A stalled stock-state is not the price: in the session a bar newer than the state's tape time by over two minutes is. */
  const barsSplit = candlesFrom(Array.isArray(bars) ? bars : [], cashToOf(ticker));
  const name = sameName(ticker);
  chartSpan.set(name, twoCashSessions(Array.isArray(bars) ? bars : [], cashToOf(ticker), name === 'SPX' ? 3 : 2));
  chartAll.set(name, parseTape(Array.isArray(bars) ? bars : []));
  const tapeMs = Date.parse(String((state as { tape_time?: string }).tape_time ?? ''));
  const newest = barsSplit.tape[barsSplit.tape.length - 1] ?? barsSplit.cash[barsSplit.cash.length - 1];
  /* …only inside the session (after the close the newest bar is an after-hours print). */
  const [ty, tm, td] = nyIsoDate().split('-').map(Number);
  const sessionOpen = isTradingDay(new Date(ty, tm - 1, td)) && nySessionPhase() === 'open';
  const stateStalled = sessionOpen && state.market_time === 'regular' && !!newest && Number.isFinite(tapeMs) && newest.time * 1000 + 60_000 - tapeMs > 120_000;
  /* OUTSIDE THE SESSION A STATE STILL SAYING "REGULAR" IS NOT BELIEVED: the price is the last regular session's close — its
     last regular one-minute bar (market_time "r"), the vendor's daily close for that date where it is in hand — and the
     newest after-hours or pre-market bar is kept apart as the extended print (data/liveQuote.ts's convention) */
  const offRegular = tapeKind === 'vendor' && !sessionOpen && state.market_time === 'regular' ? regularCloseOf(ticker, Array.isArray(bars) ? bars : []) : null;
  const barOrState = stateStalled ? newest!.close : offRegular ? offRegular.last : num(state.close);
  const readAt = stateStalled ? newest!.time * 1000 + 60_000 : offRegular ? offRegular.at : Number.isFinite(tapeMs) ? tapeMs : Date.now();
  /* a newer price already in hand (the Board's ten-second refresh, refreshBoardPrices) is not stepped back by a reload */
  const held = cache.get(ticker);
  const keepHeld = sessionOpen && state.market_time === 'regular' && held?.status === 'live' && !!held.priceAt && held.priceAt > readAt && held.spot > 0;
  const last = keepHeld ? held!.spot : barOrState;
  const mt = offRegular ? offRegular.marketTime : typeof state.market_time === 'string' ? state.market_time : undefined;
  const statePrev = offRegular ? offRegular.close : num(state.prev_close);
  const offPhase = dayChangeOf({ close: last, prev_close: statePrev, market_time: mt }, null).phase;
  const regClose = statePrev;
  const spot = (offPhase === 'post' || offPhase === 'pre') && regClose > 0 ? regClose : last;
  /* the close before that session: the daily rows', else the state's own prev_close when its print is of that session */
  const prevOff = offRegular ? offRegular.prevClose || (Number.isFinite(tapeMs) && nyIsoDate(tapeMs) === nyIsoDate(offRegular.at - 60_000) ? num(state.prev_close) : 0) : 0;
  const prev = (offRegular ? prevOff : num(state.prev_close)) || num(state.open) || spot;
  if (!(spot > 0)) throw new Error('spot');
  const ivList = Array.isArray(ivRows) ? ivRows : [];
  const ivRow = ivList.reduce<UwIv | undefined>((best, row) => (!best || String(row.date ?? '') > String(best.date ?? '') ? row : best), undefined);
  const ivRaw = num(ivRow?.volatility);
  const iv = ivRaw > 3 ? ivRaw / 100 : ivRaw;
  const prevEntry = cache.get(ticker);
  const split = barsSplit;
  const entry: Entry = {
    ticker,
    status: 'live',
    at: Date.now(),
    /* a refresh never downgrades or blanks: a full book read again stays full */
    full: !!prevEntry?.full && (mode === 'full' || !!prevEntry?.wantFull),
    wantFull: mode === 'full' || !!prevEntry?.wantFull,
    spot,
    prev,
    changePct: prev > 0 ? ((spot - prev) / prev) * 100 : 0,
    state: { close: last, prev_close: statePrev, market_time: mt },
    last,
    priceAt: keepHeld ? held!.priceAt : readAt,
    iv: iv > 0 ? iv : 0,
    impliedMove: impliedMoveOf(Array.isArray(termRows) ? termRows : [], nyIsoDate(), spot),
    termIv: termIvOf(Array.isArray(termRows) ? termRows : []) ?? prevEntry?.termIv,
    termMove: termMoveOf(Array.isArray(termRows) ? termRows : [], spot) ?? prevEntry?.termMove,
    termK: termKOf(Array.isArray(termRows) ? termRows : [], spot) ?? prevEntry?.termK,
    termDte: termDteOf(Array.isArray(termRows) ? termRows : []) ?? prevEntry?.termDte,
    dayMoveFrac: dayFracOf(Array.isArray(interpRows) ? interpRows : []),
    dayIv: dayIvOf(Array.isArray(interpRows) ? interpRows : []) ?? prevEntry?.dayIv,
    all: (() => {
      const base = chainFrom(strikes, spot, oiMap(Array.isArray(oiRows) ? oiRows : []), flowMap(Array.isArray(flowRows) ? flowRows : []));
      return live && live.size ? withLiveGamma(base, live) : base;
    })(),
    gammaLive: !!(live && live.size),
    byDate: prevEntry?.byDate ?? {},
    expiries: prevEntry?.expiries ?? [],
    expiriesAt: prevEntry?.expiriesAt,
    totals: prevEntry?.totals,
    totalsAt: prevEntry?.totalsAt,
    frontFacts: prevEntry?.frontFacts,
    factsDates: prevEntry?.factsDates,
    everFull: prevEntry?.everFull,
    flow: flowMap(Array.isArray(flowRows) ? flowRows : []),
    candles: split.cash,
    tape: split.tape,
    history: [],
  };
  entry.history = prevEntry?.history?.length ? prevEntry.history : [];
  if (tapeKind !== 'vendor') noteBarCloses(ticker, closesFromTape(bars), tapeKind === 'index');
  applyDay(entry);
  needDay(entry);
  vexOntoAll(entry);
  cache.set(ticker, entry);
  emit();
  /* The per-minute book is for the replay. Building it is one object per strike
     per bar — do it after the page has the live book, not in front of the paint. */
  const histTicker = ticker;
  const histChain = entry.all;
  const histAll = entry.tape.length >= 2 ? entry.tape : entry.candles;
  /* a name read for the Board alone keeps its replay book at five minutes (one object per strike per bar) — the bars
     are one-minute for the counts, the book it never draws need not be */
  const histCandles = entry.wantFull ? histAll : histAll.filter((c, i) => i === histAll.length - 1 || Math.floor(c.time / 60) % 5 === 0);
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
  void attachSpxCloses(ticker, token);
  if (entry.wantFull) {
    void loadFront(entry, token);
    await loadExpiries(entry, token);
  } else await loadFront(entry, token);
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

/* The dates that re-price with their contracts' own vols: the front date and every live date holding at least
   OWN_IV_SHARE of the dates' gross gamma — the Map and a Board-only name pick them by the same rule off the same chains. */
const OWN_IV_SHARE = 0.005;
export function ownIvDates(byDate: Readonly<Record<string, readonly StrikeNode[] | undefined>>, dates: readonly string[], front: string | undefined): Set<string> {
  const gross = (d: string) => (byDate[d] ?? []).reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0);
  const g = dates.map(d => [d, gross(d)] as const);
  const total = g.reduce((a, [, v]) => a + v, 0);
  return new Set(g.filter(([d, v]) => d === front || (total > 0 && v >= OWN_IV_SHARE * total)).map(([d]) => d));
}

/* A Board name's front date: the listing with each date's gamma and the first live date's own strikes (two calls, kept
   three minutes), so its "Today" levels are today's, not the whole book's. */
async function loadFront(entry: Entry, token: number): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  const today = isoDate(bookToday());
  const allScope = levelsForName(entry.ticker) === 'ALL';
  const haveFront = Object.keys(entry.byDate).some(d => d >= today && entry.byDate[d]?.length);
  const fresh = !!entry.totalsAt && Date.now() - entry.totalsAt < FRONT_MS;
  if (fresh && haveFront && !!entry.frontFacts && (!allScope || datesComplete(entry))) {
    if (allScope) await refreshDatesGamma(entry, token);
    return;
  }
  /* the calls that fill a Board row's "Today" levels jump the key's queue */
  let listed: { date: string; dte: number }[] = [];
  const hot = isHot(entry.ticker);
  const got = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/expiry`, hot);
  if (got.error) return;
  listed = listingOf(got.data);
  keepTotals(entry, got.data);
  if (!still() || !listed.length) return;
  /* the first live listing when nothing is within four days */
  const front = closestDate(isoDate(expiryFor(0, bookToday()).date), listed.map(r => r.date)) ?? listed.map(r => r.date).filter(d => d >= today).sort()[0];
  if (!front) return;
  let chain: StrikeNode[] = entry.byDate[front] ?? [];
  if (!chain.length || !fresh) {
    /* the front date's live gamma (one call); a chain the full book already holds keeps its other greeks */
    const live = await liveGamma(entry.ticker, front, hot).catch(() => null);
    if (live) chain = withLiveGamma(chain, live);
    else {
      const rows = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/strike-expiry?expiry=${encodeURIComponent(front)}`, hot);
      chain = !rows.error && Array.isArray(rows.data) ? chainFrom(rows.data as UwGreekStrike[], entry.spot, new Map()) : chain;
    }
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
    const rows = await whalesOptionContractsPaged(entry.ticker, front, hot).catch(() => null);
    if (!still()) return;
    current = cache.get(entry.ticker);
    if (!current || current.full) return;
    if (rows) {
      /* in only once read — a failed read is asked again on the next pass, never taken as "no contracts" */
      current.factsDates = new Set([...(current.factsDates ?? []), front]);
      const have = current.byDate[front] ?? chain;
      const book = foldContracts(rows, front, pricedClockOf(have).at);
      if (book.size && have.length) current.byDate = { ...current.byDate, [front]: paintLegs(have, book, true, current.spot, front, current.ticker) };
      current.frontFacts = true;
      current.at = Date.now();
      cache.set(entry.ticker, current);
      emit();
    }
  }
  /* AFTER THE CLOSE, TODAY'S OWN CONTRACTS (names with a same-day expiry): the book the session ran on, for "Flip crossed
     today" — the vendor still serves this morning's rows for them (one call, once) */
  /* …and before today's open, the last session's own contracts (the session on record): "How the levels held" and "Flip
     crossed" grade that session against its own book */
  const ny = recordIso();
  if (today > ny && listed.some(r => r.date === ny)) {
    const cur = cache.get(entry.ticker);
    if (cur && !cur.byDate[ny]?.length && !emptyDates.get(entry.ticker)?.has(ny)) {
      /* this morning's rows for the session's report, and their live rows to come off the whole book (dateChain) */
      const chain = await dateChain(entry.ticker, ny, cur.spot, false).catch(() => null);
      recordAsked.add(`${entry.ticker}|${ny}`);
      if (!still()) return;
      const after = cache.get(entry.ticker);
      if (after && chain) {
        if (chain.length) after.byDate = { ...after.byDate, [ny]: chain };
        else emptyDates.set(entry.ticker, new Set([...(emptyDates.get(entry.ticker) ?? []), ny]));
        emit();
      }
    }
    /* …and that session's own contracts: its flip is final only once they are read */
    const had = cache.get(entry.ticker);
    if (had && had.byDate[ny]?.length && !had.factsDates?.has(ny)) {
      const rows = await whalesOptionContractsPaged(entry.ticker, ny, hot).catch(() => null);
      if (!still()) return;
      const after = cache.get(entry.ticker);
      if (after && rows) {
        const have = after.byDate[ny];
        const book = foldContracts(rows, ny, pricedClockOf(have ?? []).at);
        if (book.size && have?.length) after.byDate = { ...after.byDate, [ny]: paintLegs(have, book, true, after.spot, ny, after.ticker) };
        after.factsDates = new Set([...(after.factsDates ?? []), ny]);
        after.at = Date.now();
        emit();
      }
    }
  }
  /* "All expiries" on the Board: every live date's strikes, so the flip can re-price each date at its own clock */
  if (levelsForName(entry.ticker) === 'ALL') await loadBoardDates(entry.ticker, token, listed);
}

/** The session on record's own date has been asked for — until then a page that needs that book says "…". */
const recordAsked = new Set<string>();
export function peekRecordAsked(ticker: string, date: string): boolean {
  const e = cache.get(ticker.toUpperCase());
  if (!e) return false;
  return recordAsked.has(`${e.ticker}|${date}`) || !!e.byDate[date]?.length || !!emptyDates.get(e.ticker)?.has(date) || (e.status === 'live' && !!e.expiries.length && !e.expiries.some(x => x.date === date));
}

/** The own-vol dates (ownIvDates) whose contracts are not read yet */
function horizonFactsMissing(entry: Entry): string[] {
  const facts = entry.factsDates ?? new Set<string>();
  const floor = isoDate(bookToday());
  const live = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length).sort();
  const own = ownIvDates(entry.byDate, live, live[0]);
  return live.filter(d => own.has(d) && !facts.has(d));
}

/** The session on record's date (data/bookWindow.ts recordDay, kept here without the import cycle): today's from the
    open on, else the last session that ran */
function recordIso(): string {
  const iso = nyIsoDate();
  const [y, m, d] = iso.split('-').map(Number);
  if (isTradingDay(new Date(y, m - 1, d)) && nyMinutes() >= OPEN_MIN) return iso;
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return iso;
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
/* One Board name's dates at a time, the name on screen first, so rows land one after another; chains already read are
   kept and never asked again. */
const datesQueue: { ticker: string; run: () => Promise<void>; done: () => void }[] = [];
let datesRunning = 0;
/* five names at a time (each name's walk is one page after another), the name on screen first */
const DATES_AT_ONCE = 5;
function pumpDates(): void {
  while (datesRunning < DATES_AT_ONCE && datesQueue.length) {
    const i = Math.max(0, datesQueue.findIndex(q => isHot(q.ticker)));
    const job = datesQueue.splice(i, 1)[0];
    datesRunning++;
    void job.run().finally(() => {
      datesRunning--;
      job.done();
      pumpDates();
    });
  }
}
function loadBoardDates(ticker: string, token: number, listed?: { date: string; dte: number }[]): Promise<void> {
  if (datesQueue.some(q => q.ticker === ticker)) return Promise.resolve();
  return new Promise(resolve => {
    datesQueue.push({ ticker, run: () => loadBoardDatesNow(ticker, gen.get(ticker) ?? token, listed), done: resolve });
    pumpDates();
  });
}
async function loadBoardDatesNow(ticker: string, token: number, listed?: { date: string; dte: number }[]): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const e = cache.get(ticker);
  if (!e || datesWait.has(ticker)) return;
  const today = isoDate(bookToday());
  void today;
  const want = (listed ?? e.expiries).slice(0, 40).map(x => x.date).filter(d => !e.byDate[d]?.length && !emptyDates.get(ticker)?.has(d));
  if (!want.length) {
    if (horizonFactsMissing(e).length && !e.full) {
      datesWait.add(ticker);
      try {
        await fillExpiryFacts(e, token, horizonFactsMissing(e));
      } finally {
        datesWait.delete(ticker);
      }
    }
    return;
  }
  datesWait.add(ticker);
  try {
    /* the live dates in one walk of every expiry's rows (liveGammaAll); a date the walk does not carry, a settled one,
       or a walk that failed is asked on its own as before */
    const floorDay = isoDate(bookToday());
    const liveWant = want.filter(d => d >= floorDay);
    const walked = liveWant.length >= 3 ? await liveGammaAll(ticker, isHot(ticker)).catch(() => null) : null;
    if (!still()) return;
    const fetched = await mapLimit(want, 3, async date => {
      const got = date >= floorDay ? walked?.get(date) : undefined;
      if (got) return [date, withLiveGamma([], got)] as const;
      try {
        return [date, await within(dateChain(ticker, date, e.spot, false, isHot(ticker)), DATE_READ_MS)] as const;
      } catch {
        return [date, null] as const;
      }
    });
    if (!still()) return;
    const current = cache.get(ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    const empty = emptyDates.get(ticker) ?? new Set<string>();
    for (const [date, chain] of fetched) {
      if (chain == null) continue;
      if (chain.length && !byDate[date]?.length) byDate[date] = chain;
      else if (!chain.length) empty.add(date);
    }
    emptyDates.set(ticker, empty);
    current.byDate = byDate;
    if (listed?.length) current.expiries = listed;
    cache.set(ticker, current);
    emit();
    /* the own-vol horizon's contracts (the flip re-prices those dates with each contract's own vol — data/flipLevel.ts),
       the ones not read yet; the front date's came with loadFront */
    const need = horizonFactsMissing(current);
    if (need.length && !current.full) await fillExpiryFacts(current, token, need);
  } finally {
    datesWait.delete(ticker);
  }
}

/** The Levels card reads "All expiries": a name read for the Board alone loads every live date's strikes (the flip
    re-prices each at its own clock). A no-op for a full book or one already complete. */
export function ensureScopeDates(ticker: string, scope: LevelsScope = readLevelsScope()): void {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || e.full || scope !== 'ALL' || (datesComplete(e) && !horizonFactsMissing(e).length)) return;
  void loadBoardDates(e.ticker, gen.get(e.ticker) ?? 0);
}

/** True while the "All expiries" scope still waits on some live date's strikes */
export function scopeDatesPending(ticker: string, scope: LevelsScope = readLevelsScope()): boolean {
  const e = peekEntry(ticker);
  return !!e && e.status === 'live' && scope === 'ALL' && !datesComplete(e);
}

/** A name's live snapshot read for a scope you name (not the desk's Levels card) — null until the book is live */
export function snapshotFor(ticker: string, scope: LevelsScope, mode: BookMode = 'board'): MarketSnapshot | null {
  ensureBook(ticker, mode);
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, scope);
}

/** Share of the book's gamma that expires today, percent. `none`: nothing on this name expires today. `wait`: the
    listing is not in yet. One number for the Board, Compare, the Agenda and the Trader's Clock. */
export function peekBellShare(ticker: string): { share: number } | { share: null; why: 'none' | 'wait' } {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return { share: null, why: 'wait' };
  /* the session the book is on (after Friday's bell bookToday is Saturday, and nothing "expired Saturday") */
  const today = isoDate(nextSession(bookToday()));
  /* Today's date's live open-interest gamma, gross, against the whole live book's (settled dates off); the morning
     snapshot (greek-exposure/expiry) stands in only until the live rows land. */
  const listedToday = e.expiries.some(x => x.date === today) || e.totals?.some(t => t.date === today);
  const todayChain = e.byDate[today];
  /* the whole live book is only final once the contracts that settled come off it (liveAll) */
  if (e.gammaLive && todayChain?.length && peekSettledNet(e.ticker) == null) return { share: null, why: 'wait' };
  if (e.gammaLive && todayChain?.length) {
    const gross = (ch: readonly StrikeNode[]) => ch.reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0);
    const total = gross(liveAll(e));
    const dies = gross(todayChain);
    if (total > 0) return { share: Math.min(100, Math.round((100 * dies) / total)) };
  }
  /* nothing provisional: a name whose date is listed waits for that date's live rows */
  if (e.gammaLive && listedToday && !todayChain?.length) return { share: null, why: 'wait' };
  if (!e.totals?.length) return listedToday === false && e.expiries.length ? { share: null, why: 'none' } : { share: null, why: 'wait' };
  const live = e.totals.filter(t => t.date >= today);
  const dies = live.filter(t => t.date === today).reduce((a, t) => a + t.gross, 0);
  if (!live.some(t => t.date === today)) return { share: null, why: 'none' };
  const total = live.reduce((a, t) => a + t.gross, 0);
  return total > 0 ? { share: Math.round((100 * dies) / total) } : { share: null, why: 'wait' };
}

/* One full walk a name at a time, never abandoned by a refresh: it lays what it reads onto the current copy of the book;
   a failed date is asked once more at the end, and an empty answer is taken as empty. */
const expWalking = new Set<string>();
async function loadExpiries(entry: Entry, token: number): Promise<void> {
  if (expWalking.has(entry.ticker)) return;
  expWalking.add(entry.ticker);
  try {
    await loadExpiriesNow(entry, token);
  } finally {
    expWalking.delete(entry.ticker);
  }
}
async function loadExpiriesNow(entry: Entry, token: number): Promise<void> {
  void token;
  /* the walk lays onto the book's current copy (a refresh replaces the object, never the walk) */
  const still = () => cache.get(entry.ticker)?.status === 'live';
  const liveToken = () => gen.get(entry.ticker) ?? token;
  if (entry.expiriesAt && Date.now() - entry.expiriesAt < 180_000 && Object.keys(entry.byDate).length > 0) {
    entry.full = true;
    entry.everFull = true;
    vexOntoAll(entry);
    /* an own-vol date whose contracts failed to read is asked again here, not left provisional until the next listing */
    const missing = horizonFactsMissing(entry);
    if (missing.length) void fillExpiryFacts(entry, liveToken(), missing);
    void refreshDatesGamma(entry, liveToken());
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
  const near = dates.slice(0, 6);
  /* null: the read failed (asked again); []: the vendor has no strikes on that date */
  const pull = (list: string[], first = list === near) =>
    mapLimit(list, 3, async date => {
      try {
        return [date, await within(dateChain(entry.ticker, date, entry.spot, true, isHot(entry.ticker) && first), DATE_READ_MS)] as const;
      } catch {
        return [date, null] as const;
      }
    });
  const apply = (fetched: readonly (readonly [string, StrikeNode[] | null])[], done: boolean) => {
    if (!still()) return;
    const current = cache.get(entry.ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    const empty = emptyDates.get(entry.ticker) ?? new Set<string>();
    for (const [date, chain] of fetched) {
      if (chain?.length) byDate[date] = carryFacts(chain, byDate[date]);
      else if (chain && !byDate[date]?.length) empty.add(date);
    }
    emptyDates.set(entry.ticker, empty);
    current.byDate = byDate;
    current.expiries = listed;
    if (done) {
      current.full = true;
      current.everFull = true;
      current.expiriesAt = Date.now();
    }
    current.at = Date.now();
    vexOntoAll(current);
    if (done) noteSplit(current);
    cache.set(entry.ticker, current);
    emit();
  };
  /* The dates on screen first, then the rest of the listed book. */
  /* the near dates' open interest as soon as they are in, not after all ~40 dates */
  /* the far dates' live gamma in one walk (liveGammaAll); each far date then asks only its greek rows */
  /* the front date first, on its own: "Today" is final once its chain and contracts are in */
  const front = near.slice(0, 1);
  const frontGot = await pull(front, true);
  if (!still()) return;
  apply(frontGot, false);
  const atFront = cache.get(entry.ticker);
  /* the front date's contracts before the rest: "Today" is final with them */
  const frontFacts = atFront ? fillExpiryFacts(atFront, liveToken(), front) : null;
  const walk = dates.length > 6 ? liveGammaAll(entry.ticker, isHot(entry.ticker)).catch(() => null) : null;
  const nearGot = await pull(near.slice(1), true);
  if (!still()) return;
  const retryNear = dates.length <= 6 ? nearGot.filter(([, c]) => c == null).map(([d]) => d) : [];
  apply(nearGot, dates.length <= 6 && !retryNear.length);
  if (retryNear.length) {
    apply(await pull(retryNear, true), true);
    if (!still()) return;
  }
  const first = cache.get(entry.ticker);
  if (first) void fillExpiryFacts(first, liveToken(), near.slice(1));
  if (dates.length > 6) {
    await walk;
    if (!still()) return;
    const farGot = await pull(dates.slice(6));
    if (!still()) return;
    /* a far date whose read failed is asked once more before the walk calls the book whole */
    const retry = [...nearGot, ...farGot].filter(([, c]) => c == null).map(([d]) => d);
    apply(farGot, !retry.length);
    if (retry.length) {
      apply(await pull(retry), true);
      if (!still()) return;
    }
    const current = cache.get(entry.ticker);
    if (current) void fillExpiryFacts(current, liveToken(), dates.slice(6));
  }
  await frontFacts;
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
  void loadCore(ticker, mode, token).catch((err: unknown) => {
    if (gen.get(ticker) !== token) return;
    const cur = cache.get(ticker);
    if (cur?.status === 'live') return;
    const msg = err instanceof Error ? err.message : '';
    const http = /not configured/i.test(msg) ? 503 : Number(msg.match(/\b([45]\d{2})\b/)?.[1] ?? 0) || undefined;
    cache.set(ticker, {
      ticker,
      status: 'error',
      at: Date.now(),
      http,
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

/* A shut market's book is read once: from BOOK_SETTLED_MIN on a trading day to PREMARKET_MIN on the next, a book that
   landed whole is held (bookSettled); one that has not keeps being read until it has. */
const BOOK_SETTLED_MIN = 16 * 60 + 30;
const PREMARKET_MIN = 7 * 60;
/** When a book read at `at` is next read: null in the live window (07:00 → 16:30 ET on a trading day), else the next
    trading day's 07:00 ET (epoch ms) */
function bookFixedUntil(at: number = Date.now()): number | null {
  const [y, m, d] = nyIsoDate(at).split('-').map(Number);
  const mins = nyMinutes(at);
  const trading = isTradingDay(new Date(y, m - 1, d));
  if (trading && mins >= PREMARKET_MIN && mins < BOOK_SETTLED_MIN) return null;
  const day = trading && mins < PREMARKET_MIN ? new Date(y, m - 1, d) : nextSession(new Date(y, m - 1, d + 1));
  return nyWallTime(day.getFullYear(), day.getMonth() + 1, day.getDate(), 7, 0);
}
/** The market is between the settled close and the next pre-market — the book, the prices and the counts stand still */
export const bookFixed = (now: number = Date.now()): boolean => bookFixedUntil(now) != null;
/** "the Oct 23 close" — the session a fixed book is as of */
export function fixedAsOfWords(now: number = Date.now()): string {
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  let day = new Date(y, m - 1, d);
  if (!(isTradingDay(day) && nyMinutes(now) >= CLOSE_MIN))
    for (let back = 1; back < 12; back++) {
      const p = new Date(y, m - 1, d - back);
      if (isTradingDay(p)) {
        day = p;
        break;
      }
    }
  return `the ${MON3[day.getMonth()]} ${day.getDate()} close`;
}
/** Every piece of a name's book has landed — the only book a closed market holds */
function bookSettled(e: Entry): boolean {
  if (e.status !== 'live' || !e.gammaLive || !e.termIv || !e.all.length) return false;
  if (e.wantFull ? !e.everFull : !e.frontFacts) return false;
  if ((e.wantFull || levelsForName(e.ticker) === 'ALL') && horizonFactsMissing(e).length) return false;
  return true;
}

export function ensureBook(ticker: string, mode: BookMode = 'board', force = false): void {
  if (typeof window === 'undefined') return;
  const t = sameName(ticker);
  if (!t) return;
  if (SIM_DESK) return;
  const e = cache.get(t);
  if (e?.status === 'loading') {
    if (mode === 'full') e.wantFull = true;
    return;
  }
  /* never a downgrade: a name held in full is refreshed in full whoever asks */
  if (e && (e.full || e.wantFull)) mode = 'full';
  /* a closed market's settled book is held until the next pre-market (bookFixedUntil) — an upgrade to the full book
     still loads what the board read lacks */
  const heldTo = e && bookSettled(e) ? bookFixedUntil(e.at) : null;
  const upgrading = mode === 'full' && !!e && e.status === 'live' && !e.full && !e.wantFull;
  if (heldTo != null && Date.now() < heldTo && !upgrading) return;
  const age = e ? Date.now() - e.at : Infinity;
  const limit = e?.status === 'error' ? 15_000 : e?.full ? FULL_MS : BOARD_MS;
  const stale = !e || age > limit;
  const upgrade = mode === 'full' && !!e && e.status === 'live' && !e.full && !e.wantFull;
  if (!force && !stale && !upgrade) return;
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

/* What was built is the vendor's open-interest change (each contract's OI this morning against the session before),
   not the day's volume. */
/* Both directions: increases largest first (order=desc), decreases largest first (order=asc), each until a change of 0. */
const OI_PAGES = 14;

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
  /** 'top': the largest 500 increases and 500 decreases only (the Board's read); 'full': every changed contract */
  depth: 'top' | 'full';
}
const oiChangeCache = new Map<string, OiChange>();
const oiChangeAt = new Map<string, number>();
/* the count is set once overnight — re-read every half hour, so a page left open across the roll picks up the new one */
const OI_CHANGE_MS = 30 * 60_000;
const oiChangeWait = new Set<string>();

/* Keyed by contract, not by strike: Building picks the contracts in scope and values each with its own gamma. */
/** The last session that has finished: today's after its 4:00 close, else the trading day before today */
function finishedSessionIso(): string {
  const iso = nyIsoDate();
  const [y, m, d] = iso.split('-').map(Number);
  if (isTradingDay(new Date(y, m - 1, d)) && nyMinutes() >= CLOSE_MIN) return iso;
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return iso;
}
/* While the count in hand is behind the last finished session, the first page is probed every five minutes and the
   whole count is read again once it carries a newer date. */
const OI_STALE_MS = 5 * 60_000;
const oiChangeChecked = new Map<string, number>();
/** A trading day between 07:00 ET and the close — when a new open-interest count can appear */
function oiCheckWindow(now: number = Date.now()): boolean {
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  const mins = nyMinutes(now);
  return isTradingDay(new Date(y, m - 1, d)) && mins >= PREMARKET_MIN && mins < CLOSE_MIN;
}
/** `depth` 'top' reads one page each way (the largest changes — what moves a wall), for a name read in passing (the
    Board, the Agenda's rows); 'full' every page, for Building. A top read in hand is upgraded when full is asked. */
export function ensureOiChange(ticker: string, depth: 'top' | 'full' = 'full'): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeWait.has(t)) return;
  const held = oiChangeCache.get(t);
  if (held && depth === 'full' && held.depth === 'top') {
    readOiChange(t, 'full');
    return;
  }
  const behind = !!held?.lastDate && held.lastDate < finishedSessionIso();
  const age = Date.now() - Math.max(oiChangeAt.get(t) ?? 0, oiChangeChecked.get(t) ?? 0);
  if (held && age < (behind ? OI_STALE_MS : OI_CHANGE_MS)) return;
  /* a count in hand is looked for again only when a new one can land: a trading day from 07:00 ET to the close */
  if (held && !oiCheckWindow()) return;
  oiChangeWait.add(t);
  if (held && behind) {
    /* a probe: the first page's dates — the whole count is read again only when they move */
    void (async () => {
      const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=0&order=desc`, isHot(t), !isHot(t));
      oiChangeChecked.set(t, Date.now());
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      const newer = rows.some(r => String(r.curr_date ?? '') > (held.currDate ?? ''));
      oiChangeWait.delete(t);
      if (newer) {
        oiChangeAt.delete(t);
        oiChangeChecked.delete(t);
        readOiChange(t, held.depth === 'full' ? 'full' : depth);
      } else emit();
    })().catch(() => oiChangeWait.delete(t));
    return;
  }
  readOiChange(t, held?.depth === 'full' ? 'full' : depth);
}
function readOiChange(t: string, depth: 'top' | 'full'): void {
  oiChangeWait.add(t);
  void (async () => {
    const out: OiChangeRow[] = [];
    let lastDate: string | null = null;
    let currDate: string | null = null;
    const seen = new Set<string>();
    for (const order of ['desc', 'asc'] as const) {
      for (let page = 0; page < (depth === 'top' ? 1 : OI_PAGES); page++) {
        /* a name off screen reads its change in the background lane */
        const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=${page}&order=${order}`, isHot(t), !isHot(t));
        const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
        let reachedZero = false;
        for (const r of rows) {
          const sym = String(r.option_symbol ?? '');
          const occ = parseOcc(sym);
          const diff = num(r.oi_diff_plain);
          if (order === 'desc' ? diff <= 0 : diff >= 0) reachedZero = true;
          if (!occ || !diff || seen.has(sym)) continue;
          seen.add(sym);
          const cd = String(r.curr_date ?? '');
          const ld = String(r.last_date ?? '');
          if (cd && (!currDate || cd > currDate)) currDate = cd;
          if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
          out.push({ expiry: occ.expiry, strike: occ.strike, right: occ.right === 'CALL' ? 'C' : 'P', diff, currDate: cd, lastDate: ld });
        }
        if (res.error || rows.length < 500 || reachedZero) break;
      }
    }
    /* nothing came back (every page failed): keep the last count rather than print an empty one */
    if (!out.length && oiChangeCache.has(t)) return;
    oiChangeCache.set(t, { rows: out, lastDate, currDate, depth });
    oiChangeAt.set(t, Date.now());
    oiChangeChecked.set(t, Date.now());
    emit();
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each contract's open-interest change over the last session — null until it lands */
export const peekOiChange = (ticker: string): OiChange | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
