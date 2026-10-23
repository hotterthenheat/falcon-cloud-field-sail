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
import { bookToday, expiryFor, isoDate, isTradingDay, nextSession } from '../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase } from '../core/nyTime';
import { pickLegWalls } from '../core/walls';
import { registerChainDates } from './chainDates';
import { dayChangeOf, loadRegularCloses, peekRegularCloses, type MarketPhase } from './dayChange';
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
  whalesOptionContractsPaged,
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
  /** The dates whose contract rows have been read (painted, or asked and refused) — the flip re-prices the front date
      with its contracts' own vols, so it is final only once the front date is here (the fourth audit's M1: SPY's Map
      read 771.25 for seconds on the at-the-money vol, then 772.17) */
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

/*
  THE GAMMA IS THE LIVE OPEN-INTEREST BOOK, NOT THE MORNING SNAPSHOT (the second re-audit, 2026-10-22). The vendor's
  greek-exposure rows (strike, expiry, strike-expiry) are priced ONCE, at the spot and the greeks of their snapshot:
  fitted leg by leg against Black-Scholes they sit at NVDA ~216.5, SPY ~766.8, AAPL ~346.1 — the morning's prices, not
  the close (NVDA 212.21). On a −4% day that is the whole gap the audit found: NVDA's 10/23 rows netted +$182M while the
  same vendor's contracts (open interest × gamma × 100, at today's price) net −$74M, and the flip carried the ≈$256M
  difference flat and printed "none nearby" over a crossing at 213. The vendor's spot-exposures rows are the same open
  interest priced at the current price, once a minute (call_gamma_oi / put_gamma_oi: dollars per 1% move) — checked
  strike by strike against OI × Γ × 100 × S² × 1% off option-contracts: equal to the cent. The book's gamma is read off
  them: spot-exposures/strike for every expiry, spot-exposures/expiry-strike for one date. Delta, vanna and charm stay on
  the greek-exposure rows (spot-exposures prints them in another unit). If the live rows fail, the snapshot is kept.
*/
type LiveGamma = Map<number, { c: number; p: number; px?: number; at?: number }>;
/** A settled date's live rows (ticker|date), kept only to come off the whole book's live total */
const settledLive = new Map<string, LiveGamma>();
const liveGammaCache = new Map<string, { at: number; rows: LiveGamma }>();
const liveGammaWait = new Map<string, Promise<LiveGamma | null>>();
const LIVE_GAMMA_MS = 60_000;

/*
  WHERE AND WHEN THE VENDOR PRICED THE ROWS (the fourth audit, 2026-10-23: CROX's flip read 113.89 against 115.35 — the
  vendor's gamma was computed at the row's own price, the 120.99 regular close, at 20:15Z, and the flip re-priced it as
  if it had been computed at the after-hours 119.44 and at the wall clock). Every spot-exposures row carries the price
  and the minute it was priced at; the flip re-prices each leg FROM that price and AT that minute (data/flipLevel.ts),
  so after the close it stops moving until the vendor prints a new minute, and every page reads the same flip.
*/
const gammaPriced = new Map<string, { price: number; at: number }>();
/** The price and the instant the vendor priced a name's live gamma rows (one date, or the whole book) — null until in */
export const peekGammaPriced = (ticker: string, date: string | null): { price: number; at: number } | null =>
  gammaPriced.get(`${ticker.toUpperCase()}|${date ?? 'ALL'}`) ?? null;

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
    const cur = into.get(k) ?? { c: 0, p: 0 };
    cur.c += num(r.call_gamma_oi);
    cur.p += num(r.put_gamma_oi);
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
export function liveGamma(ticker: string, date: string | null, priority = false): Promise<LiveGamma | null> {
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
        if (res.error) return hit?.rows ?? null;
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
    chain lacks are added, strikes it lacks carry no gamma */
function withLiveGamma(chain: readonly StrikeNode[], live: LiveGamma): StrikeNode[] {
  const seen = new Set<number>();
  const out: StrikeNode[] = chain.map(n => {
    seen.add(n.strike);
    const l = live.get(n.strike);
    const callGex = l ? -l.c : 0;
    const putGex = l ? -l.p : 0;
    return { ...n, callGex, putGex, netGex: callGex + putGex, gexPx: l?.px, gexAt: l?.at };
  });
  for (const [k, l] of live) {
    /* zero-gamma strikes are kept too: a new listing with no open interest yet is a date that IS in, not one missing */
    if (seen.has(k)) continue;
    out.push({ ...emptyNode(k), callGex: -l.c, putGex: -l.p, netGex: -l.c - l.p, gexPx: l.px, gexAt: l.at });
  }
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/*
  EVERY DATE'S LIVE GAMMA IN ONE WALK (the sixth audit's M3, 2026-10-23: the Board on All expiries had 2 of 20 rows at
  41s — each name asked spot-exposures/expiry-strike once per listed date, ~25 asks a name, 514 across the Board). The
  same route without `expirations[]` returns every expiry's rows, one per strike and expiry, 500 a page — SPY's 34 dates
  in 13 pages, AAPL's 23 in 4, CROX's 8 in 1. Each date's rows are kept exactly as the per-date ask keeps them (the same
  per-row price and minute, the same cache), so a date read either way is the same chain. Null when a page fails.
*/
/* ONE WALK SHARED (audit round 7: a stock page walked SPY's pages 0–10 twice — the Board dates' read and the levels'
   far dates each started their own walk seconds apart). A walk in flight, or one finished in the last WALK_REUSE_MS, is
   the walk: the second caller takes its answer. */
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
async function liveGammaWalk(ticker: string, priority = false): Promise<Map<string, LiveGamma> | null> {
  const t = encodeURIComponent(ticker);
  const rowsBy = new Map<string, Record<string, unknown>[]>();
  for (let page = 0; page < 60; page++) {
    const res = await uwCall(`/stock/${t}/spot-exposures/expiry-strike?limit=500&page=${page}`, priority);
    if (res.error || !Array.isArray(res.data)) return null;
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

/*
  THE DATES' GAMMA KEPT LIVE (the seventh audit's live pass, 2026-10-23): the whole book's gamma is now the dates' own rows
  added up (oneSnapshot), and a date's chain was read once — the Board's never again, the full book's every three minutes —
  so in the session the All-expiries levels would have stood still. Every live date's gamma is read again in one walk of
  every expiry's rows (liveGammaAll, kept a minute) whenever the book refreshes, and laid onto the chains in hand; each
  chain's other greeks and its contracts' facts stay as they were.
*/
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
  /* A DATE THAT SETTLED AT 4:00 (after the close, until the book rolls): the vendor's live aggregate still carries its
     contracts (SPY's whole book read −$17.7B against −$14.7B on the live dates, the 10/22 contracts' gamma at the bell),
     so its live rows are kept to come off the whole book (liveAll); its chain is the vendor's rows as they stood this
     morning — the book today's session ran on, for the session's report (data/bookWindow.ts sessionBook) */
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
  /* BEFORE TODAY'S OPEN THE CASH BARS ARE THE LAST SESSION'S (the fifth audit, 2026-10-23): with pre-market prints on the
     tape the newest day had no cash bars, and its pre-market stood in as "the session" — the last day that has cash
     bars is the session on record (data/bookWindow.ts recordDay) */
  const inCash = (b: Candle) => nyMinutes(b.time * 1000) >= OPEN_MIN && nyMinutes(b.time * 1000) < CLOSE_MIN;
  const lastCash = [...parsed].reverse().find(inCash);
  const lastDay = lastCash ? nyIsoDate(lastCash.time * 1000) : null;
  const prior = lastDay && lastDay !== day ? parsed.filter(b => inCash(b) && nyIsoDate(b.time * 1000) === lastDay) : [];
  /* ONCE TODAY'S SESSION HAS ITS FIRST BAR IT IS THE SESSION, HOWEVER SHORT (the seventh audit's live pass: at 09:35 on
     five-minute bars today had one cash bar, so the Board fell back to Thursday's bars and counted "NVDA 15×" against
     Friday's live flip under "today") — the counts wait for their own minimum of bars instead */
  if (session.length >= 1 && day === nyIsoDate()) return { cash: session, tape: tape.length ? tape : parsed };
  const cash = session.length >= 2 ? session : prior.length >= 2 ? prior : tape.filter(b => nyIsoDate(b.time * 1000) === day);
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

/* NEW NODES, NEVER THE OLD ONES EDITED (the third audit, 2026-10-23: CROX's Map flip read 114.43 against 114.77 on
   Compare and levelsFor — the Map's levels were cached on the snapshot object, and the contract vols the flip re-prices
   with were then painted INTO that same snapshot's nodes, so the cache never saw them land). A chain that gains its
   contract facts is a new chain; whatever is keyed on the old one recomputes. */
function paintLegs(nodes: readonly StrikeNode[], book: Map<number, LegBook>, oi: boolean): StrikeNode[] {
  return nodes.map(n0 => {
    const leg = book.get(n0.strike);
    if (!leg) return n0;
    const n: StrikeNode = { ...n0 };
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
    return n;
  });
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
      /* the contracts' own open interest and vega, as painted, until they are read again — the greek rows' open
         interest is another count, and Building values each contract against it (the seventh audit's M3) */
      callOI: o.callOI || n.callOI,
      putOI: o.putOI || n.putOI,
      callVex: o.callVex || n.callVex,
      putVex: o.putVex || n.putVex,
      netVex: (o.callVex || n.callVex) + (o.putVex || n.putVex),
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
  /* laid onto the book's current copy — a refresh while the contracts were read (the full book re-reads every 45s) must
     not throw them away (the tenth audit's B3) */
  void token;
  const still = () => cache.get(entry.ticker)?.status === 'live';
  const dates = only ? only.filter(d => d in entry.byDate) : Object.keys(entry.byDate);
  if (!dates.length) return;
  /* ONE EXPIRY AT A TIME, NEVER THE WHOLE NAME IN ONE WALK (the seventh audit's M1, 2026-10-23): the whole-name walk of
     option-contracts pages unstably — META's handed 7,416 rows of which 6,332 were unique and 916 own-vol-date contracts
     were missing, a different 1,096 on the next walk, so the All-expiries flip read 617.29 on one load and 617.11 on
     the next. Each date's contracts are read on their own (whales.ts whalesOptionContractsPaged: one page, or calls and
     puts apart — no unstable paging), and a date whose read fails is left unread (not marked in), so it is asked
     again rather than taken as having no contracts. */
  const hot = isHot(entry.ticker);
  const books = await mapLimit(dates, 3, async date => {
    try {
      const rows = await whalesOptionContractsPaged(entry.ticker, date, hot);
      return [date, Array.isArray(rows) ? foldContracts(rows, date) : null] as const;
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
    if (chain && book.size) byDate[date] = paintLegs(chain, book, true);
    facts.add(date);
  }
  current.byDate = byDate;
  current.factsDates = facts;
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
  /* THE DATE chainsFor HANDS THE PAGES, NOT THE NEAREST WITHIN FOUR DAYS (the third audit, 2026-10-23: CROX's Expiry
     card said "Next session · Oct 23" while its Today scope read Nov 20 — closestDate gives up past four days, chainsFor
     then falls back to the first live date). The same resolution, step for step. */
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor);
  const hit = closestDate(isoDate(expiryFor(dte, bookToday()).date), dates);
  if (hit && entry.byDate[hit]?.length) return hit;
  if (choice !== '0DTE') return null;
  return [...dates].sort().find(d => entry.byDate[d]?.length) ?? null;
}

const LIVE_KEYS = ['callGex', 'putGex', 'netGex', 'callDex', 'putDex', 'netDex', 'callVex', 'putVex', 'netVex', 'callVanna', 'putVanna', 'netVanna', 'callCharm', 'putCharm', 'netCharm', 'callOI', 'putOI'] as const;

/* THE WHOLE BOOK WITHOUT THE DAY THAT SETTLED (the ship pass, 2026-10-22): the vendor's per-strike totals are dated to its
   last session, so before the next open "every expiry" still carried the settled 0DTE's gamma. Once that date's own
   chain is in, it comes off the total, strike by strike. */
function liveAll(entry: Entry): StrikeNode[] {
  const memo = liveAllMemo.get(entry);
  const floor = isoDate(bookToday());
  if (memo && memo.all === entry.all && memo.byDate === entry.byDate && memo.floor === floor && memo.n === entry.expiries.length) return memo.out;
  const out = oneSnapshot(entry, liveAllOld(entry));
  liveAllMemo.set(entry, { all: entry.all, byDate: entry.byDate, floor, n: entry.expiries.length, out });
  return out;
}
const liveAllMemo = new WeakMap<Entry, { all: StrikeNode[]; byDate: Entry['byDate']; floor: string; n: number; out: StrikeNode[] }>();

/*
  THE WHOLE BOOK'S GAMMA IS THE SUM OF ITS DATES' ROWS, ONE SNAPSHOT (the seventh audit's m9, 2026-10-23): the vendor's
  whole-book rows (spot-exposures/strike) and its per-expiry rows (spot-exposures/expiry-strike) are two snapshots with
  their own minutes, and the difference was carried flat into the flip (META +$297.46M net against +$297.33M on the
  dates). Once every live listed date's rows are in, the whole book's call and put gamma at each strike ARE those
  dates' rows added up — the net, the walls and the flip are then read off the one snapshot. Until then the vendor's
  whole-book rows stand in, and the levels say they are provisional (datesComplete). Delta, vanna, charm and open
  interest stay on the whole-book greek rows (the per-date ones are not read for a Board-only name).
*/
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

/** THE BOOK A FINISHED SESSION RAN ON, ONE SNAPSHOT (the seventh audit's m9): the live dates' rows added up (oneSnapshot)
    with the contracts that settled at that session's bell put back from their own live rows — null until every date
    is in (the vendor's whole-book rows, a second snapshot, then stand in) */
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

/*
  ONE SNAPSHOT PER BOOK STATE (the sixth audit's M3, 2026-10-23): every page asked for a name's snapshot on every book
  event — dozens a second while a Board's dates land — and each ask summed every date's chain again and re-read the flip,
  so the main thread was busy over half the time and the next reads went out late. A name's snapshot is now built once
  per state of its own book (the arrays it is made of, the price, the day's move, the clock's minute) and handed out
  again until one of them changes; another name's book landing leaves it alone.
*/
const snapMemo = new WeakMap<Entry, Map<LevelsScope, { sig: string; refs: unknown[]; snap: MarketSnapshot }>>();
function materialize(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const refs: unknown[] = [entry.byDate, entry.all, entry.expiries, entry.candles, entry.termIv, entry.totals, entry.factsDates, entry.state, entry.flow, entry.history];
  const sig = [entry.at, entry.spot, entry.changePct, entry.extPct, entry.phase, entry.dayKnown, entry.iv, entry.gammaLive, entry.full, entry.frontFacts, entry.factsDates?.size ?? 0, entry.candles.length, entry.candles[entry.candles.length - 1]?.close, isoDate(bookToday()), Math.floor(Date.now() / 60_000), settledLive.size, gammaPriced.size].join('|');
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

/*
  THE BOARD'S PRICES EVERY TEN SECONDS, ONE CALL (the ninth audit's m2, 2026-10-23: the Board's price could be 90s old
  under "updated … every 10s" — a Board name's book refreshes every 90s). In the regular session every live name on the
  Board takes its last price from one /screener/stocks call (the quote's last trade, quote_time — fresh while the
  stock-state is stalled), so the price, every distance and "at price" move on at the Board's own cadence; the levels
  refresh on theirs. Names whose book is not live yet are left alone.
*/
const pricedAsk = new Map<string, number>();
const PRICES_MS = 10_000;
export function refreshBoardPrices(tickers: readonly string[]): void {
  if (typeof window === 'undefined') return;
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

/* THE DAY'S CHANGE, BEFORE AND AFTER THE BELL (the second re-audit, 2026-10-22: SPY −0.00% on a −1.18% day, AAPL −0.06%
   on +1.23%): after the close the stock-state is the post-market bar and its prev_close is TODAY's regular close, so
   close − prev_close is the after-hours move. The day's change is today's regular close against the one before it
   (data/dayChange.ts, the daily rows, read once a New York day — the visible names first, as each book lands). */
function applyDay(entry: Entry): void {
  const st = entry.state;
  if (!st) return;
  const ph = dayChangeOf(st, null).phase;
  /* THE CLOSES IN EVERY PHASE (the sixth audit's M1, 2026-10-23): before the open the lead figure is the last session's
     change, which needs the regular closes as much as after the bell does — handed only to post/closed, the pre-market
     read got null and printed 0.00%. In the session the quote's own prev_close is the base and the closes change nothing. */
  const needsCloses = ph !== 'regular';
  const closes = peekRegularCloses(entry.ticker);
  const ch = dayChangeOf(st, closes);
  entry.phase = ch.phase;
  entry.dayKnown = !needsCloses || !!closes?.length;
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
export const fmtPct = (v: number, digits = 2): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

/** The day's move in words: "−1.18% · after hours +0.05%", "pre-market +0.40%", or "−1.18%" in the session */
export function dayMoveWords(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string; when: string | null } | null {
  const w = dayMoveWordsOf(m, digits);
  if (!w) return null;
  /* THE SESSION NAMED BY ITS DATE when it is not today's (the sixth audit's M1: "−1.18% Oct 22 · pre-market +0.12%",
     the Dossier's words) — before the open, and on a weekend or a holiday */
  const rec = recordIso();
  return { ...w, when: m && m.dayPct != null && rec !== nyIsoDate() ? monDayOf(rec) : null };
}
function dayMoveWordsOf(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string } | null {
  if (!m) return null;
  const ext = m.extPct != null && Number.isFinite(m.extPct) ? `${m.phase === 'pre' ? 'pre-market' : 'after hours'} ${fmtPct(m.extPct, digits)}` : null;
  if (m.phase === 'pre') {
    /* before the open the lead figure is the last session's change, the pre-market move beside it (the sixth audit:
       one page read "0.00%", another only the pre-market move, for the same name at the same minute) */
    return {
      main: m.dayPct != null && Number.isFinite(m.dayPct) ? fmtPct(m.dayPct, digits) : '…',
      ext,
      title: `${longDayOf(recordIso())}’s regular-session change (its 4:00 close against the close before). The session has not opened${ext ? `; ${ext} against that close` : ''}.`,
    };
  }
  if (m.dayPct == null) return { main: '…', ext, title: 'The day’s change is loading (the regular closes are read once a day)' };
  /* the session named by its date when it is not New York's today (the fifth audit: "Today's regular-session change" at
     01:00 Friday over Thursday's) */
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
/** The k used when the vendor's rows give none — its typical value (straddle-to-σ√T with its day count) */
const K_DEFAULT = 0.68;

/*
  THE SCOPE'S EXPECTED MOVE (the fifth audit, 2026-10-23: CROX's Today scope is Nov 20, and the page read ATM IV × spot
  × √(1/252) = $4.95 while the vendor's own implied move into Nov 20 is $14.98; where both exist that ATM formula runs
  ≈ 1.76× the vendor's one-day figure). The move the reach odds and the "expected move" read is the vendor's implied move
  into the scope's expiry wherever it has one — over the scope's whole horizon, so a multi-day scope's odds are "by Nov
  20", and say so. A date with no implied move of its own is read with the vendor's own formula, k·S·σ·√(dte/365), k
  fitted off its other rows; the 30-day IV only when the date has no ATM vol either. `source` says which was used.
*/
export interface ScopeMove {
  /** Dollars, one standard move over the horizon */
  move: number;
  /** The expiry the move runs to */
  until: string | null;
  /** True when that expiry is past the coming session — the odds are "by <date>", not "by the close" */
  multi: boolean;
  source: 'vendor' | 'fitted' | 'iv30';
  /** "the vendor's implied move into Nov 20" — which number was used, in words */
  words: string;
}
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monDayOf = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON3[m - 1]} ${d}` : iso;
};
export function peekScopeMove(ticker: string, date?: string | null): ScopeMove | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const session = isoDate(nextSession(bookToday()));
  const multi = !!d && d > session;
  const k = e.termK ?? K_DEFAULT;
  const name = d ? monDayOf(d) : null;
  const vendor = d ? e.termMove?.[d] : undefined;
  if (vendor && vendor > 0) return { move: vendor, until: d, multi, source: 'vendor', words: `the vendor's implied move into ${name}` };
  const dte = (d && e.termDte?.[d]) || (d ? Math.max(1, Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${floor}T00:00:00Z`)) / 86_400_000) + 1) : 1);
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return { move: k * e.spot * atm * Math.sqrt(dte / 365), until: d, multi, source: 'fitted', words: `${name}'s at-the-money vol on the vendor's own scale (no implied move printed for ${name})` };
  if (e.iv > 0) return { move: k * e.spot * e.iv * Math.sqrt(dte / 365), until: d, multi, source: 'iv30', words: `the 30-day implied vol on the vendor's scale (no vol printed for ${name ?? 'the expiry'})` };
  return null;
}

/*
  ONE SESSION'S EXPECTED MOVE, DOLLARS (the third audit, 2026-10-23: "EXPECTED MOVE ±$7.32", which drives every reach
  odd, was the 30-day IV off iv-rank — 15.2% — while the Oct 23 ATM vol is 17.4% and the vendor's own implied move into
  Oct 23 is $4.74). The move is the expiry the levels read: when that expiry IS the coming session, the vendor's own
  implied move into it; a later expiry (CROX's Nov 20) its at-the-money vol over one session on the vendor's own scale
  (k·S·σ·√(1/365) — the move over the scope's whole horizon is peekScopeMove); the 30-day IV only when the term structure
  has nothing. `date` null: the first live listing.
  THIS IS ALWAYS A FULL SESSION'S FIGURE (the tenth audit's B2, 2026-10-23): the vendor's implied move into a same-day
  expiry is its straddle priced NOW — the move LEFT to that close (SPY $1.17 at 15:28, $0.75 after the bell), not a
  session's — and the pages scaled it by √(minutes left / 390) a second time (Compare ±$0.35 to the close, "Likeliest
  close 195 · 100%" with PLTR $0.76 away). Once the same-day expiry's session has opened, one full session is the
  vendor's interpolated 1-day vol on its own scale (k·S·σ₁·√(1/365)); the move from now to the close is peekMoveToClose,
  scaled exactly once.
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
  const k = e.termK ?? K_DEFAULT;
  if (d === session && move && move > 0) {
    if (!sameDayRunning(d)) return move;
    /* the session is running: the vendor's figure is what is left of it — one full session off the 1-day vol */
    if (e.dayIv && e.dayIv > 0) return k * e.spot * e.dayIv * Math.sqrt(1 / 365);
    if (e.dayMoveFrac > 0 && e.dayMoveFrac < 0.2) return e.dayMoveFrac * e.spot;
    const left = Math.max(0, CLOSE_MIN - nyMinutes());
    return move / Math.sqrt(Math.max(0.1, left / (CLOSE_MIN - OPEN_MIN)));
  }
  /* ONE SESSION ON THE VENDOR'S OWN SCALE (the fifth audit: ATM × S × √(1/252) ran ≈ 1.76× the vendor's one-day move):
     k·S·σ·√(1/365), k fitted off its rows — on SPY 0.68 × 763.96 × 0.174 × √(1/365) = $4.73 against its $4.74 */
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return k * e.spot * atm * Math.sqrt(1 / 365);
  return e.iv > 0 ? k * e.spot * e.iv * Math.sqrt(1 / 365) : null;
}

/*
  THE MOVE FROM NOW TO THE CLOSE, TIME-SCALED ONCE (the tenth audit's B2). Which number is which:
  · the vendor's implied move into the same-day expiry, read while its session runs, IS the move to that close — taken
    as it is, never scaled again;
  · peekDaySigma is one full session — scaled by √(minutes left / 390).
  `minutesLeft`: the session's minutes still to run (a full 390 outside the session). Null when the book has no move.
  The reach odds (data/wall.ts scopeSigma), the corridor (data/ahead.ts), the Map's "One move" (TapeBox) and the Read's
  "To the close" all read this.
*/
export function peekMoveToClose(ticker: string, date: string | null | undefined, minutesLeft: number): number | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const move = d ? e.termMove?.[d] : undefined;
  if (d && sameDayRunning(d) && nySessionPhase() === 'open' && move && move > 0) return move;
  const day = peekDaySigma(ticker, date);
  return day == null ? null : day * Math.sqrt(Math.min(CLOSE_MIN - OPEN_MIN, Math.max(0, minutesLeft)) / (CLOSE_MIN - OPEN_MIN));
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
    /* THE OPEN-INTEREST SERIES FIRST (the second re-audit, 2026-10-22: the Map printed "LINE NOW · VENDOR −$13.8B", the
       volume-based series — a different measure from every net GEX on the page). gamma_per_one_percent_move_oi is the
       whole book's open interest re-priced each minute at that minute's price: the same measure as the levels' net GEX
       (its last print is the All-expiries net to the cent). Volume, then the directional series, only when it is absent. */
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
  ensureBook(ticker, mode);
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.all.length || !(e.spot > 0)) return null;
  return materialize(e, readLevelsScope());
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

/** The name on screen. Full book: every expiry column, the session's minutes. Null until the first live print — never the simulator's price. */
export function usePinpointFeed(ticker: string | null | undefined): MarketSnapshot | null {
  const scope = useLevelsScope();
  const version = useBookRev();
  useEffect(() => {
    if (!ticker) return;
    markHotName(ticker);
    ensureBook(ticker, 'full');
    startPinpoint(ticker);
    const id = window.setInterval(() => ensureBook(ticker, 'full'), 30_000);
    /* the name on screen's price every ten seconds too, as the Board's (refreshBoardPrices) — so "at price" and every
       distance agree between the Board and the page the name is open on */
    const px = window.setInterval(() => refreshBoardPrices([ticker]), PRICES_MS);
    return () => {
      window.clearInterval(id);
      window.clearInterval(px);
    };
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

/*
  THE NAMES ON SCREEN FIRST (the fourth audit's M1: the Board's SPY and NVDA rows sat on "…" past 30s while other names
  filled; the Agenda's Targets stayed a skeleton as long). The key allows three calls at once across the app, so the
  order of the queue is the order things fill: the name the desk is on, and SPY (the market's own), jump it; every
  other name queues behind them in turn.
*/
const hotNames = new Set<string>(['SPY']);
let hotActive: string | null = null;
/** The name the desk is on — its calls jump the key's queue (SPY's always do) */
export function markHotName(ticker: string | null | undefined): void {
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

async function loadCore(ticker: string, mode: BookMode, token: number): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const hot = isHot(ticker);
  const t = encodeURIComponent(ticker);
  const [state, strikes, oiRows, flowRows, ivRows, termRows, interpRows, bars, live] = await Promise.all([
    hot ? hotGet<UwState>(`/stock/${t}/stock-state`, true) : whalesState(ticker),
    hot ? hotGet<UwGreekStrike[]>(`/stock/${t}/greek-exposure/strike`, true) : whalesGreekStrike(ticker),
    whalesOiStrike(ticker).catch(() => [] as UwGreekStrike[]),
    whalesFlowStrike(ticker).catch(() => [] as UwFlowStrike[]),
    whalesIvRank(ticker, hot).catch(() => []),
    (hot ? hotGet<UwTerm[]>(`/stock/${t}/volatility/term-structure`, true) : whalesTermStructure(ticker)).catch(() => [] as UwTerm[]),
    whalesInterpIv(ticker).catch(() => [] as UwInterp[]),
    /* A WHOLE DAY OF BARS, NOT THE LAST FEW HOURS (the ship pass, 2026-10-22): the feed hands bars newest first,
       post-market included — after the bell 500 one-minute bars reached back only to ~11:40, so the day's chart and
       "How the levels held" started late morning. 1000 / 200 cover pre-market, the session and the evening. */
    /* ONE-MINUTE BARS FOR EVERY NAME (the ninth audit's M1/M2, 2026-10-23): a Board name read 5-minute bars, so its
       "Times price crossed the flip" and the Map's "How the levels held" — opened from the Board, or after a Board refresh
       re-read a full name in board mode — counted 5-minute bars (SPY 9/7/2 against 14/10/4) where one-minute counts are
       promised. One /ohlc/1m call a name a refresh, the same URL the full book and the Dossier read (one proxy copy). */
    whalesBars(ticker, '1m', 1000).catch(() => [] as UwBar[]),
    liveGamma(ticker, null, hot).catch(() => null),
  ]);
  if (!still()) return;
  if (!state || !Array.isArray(strikes) || strikes.length === 0) throw new Error('shape');
  /* OUTSIDE THE SESSION THE PRICE IS THE REGULAR CLOSE (the fourth audit, 2026-10-23: the Board printed AAPL's after-hours
     $348.60 beside the regular session's change, measured every distance from it, and the Dossier said 348.22). The
     levels were priced at the 4:00 close (the vendor's rows carry that price), so the price on Pinpoint, and every
     distance to a level, is that close — the Dossier's own convention (data/liveQuote.ts priceWords). The after-hours
     or pre-market print is kept apart (`last`) and labelled where it is shown. */
  /* A STALLED STOCK-STATE IS NOT THE PRICE (the eighth Pinpoint fix, 2026-10-23 11:16 ET: the vendor's stock-state sat at
     its 10:35 print — SPY 759.68, tape_time 14:35Z — on every name for 40 minutes while the one-minute bars and the quote
     ran on at 762.8; every distance and "at price" on Pinpoint was read off the stalled print). In the regular session a
     bar newer than the state's tape time by more than two minutes is the price. */
  const barsSplit = candlesFrom(Array.isArray(bars) ? bars : []);
  const tapeMs = Date.parse(String((state as { tape_time?: string }).tape_time ?? ''));
  const newest = barsSplit.tape[barsSplit.tape.length - 1] ?? barsSplit.cash[barsSplit.cash.length - 1];
  const stateStalled = state.market_time === 'regular' && !!newest && Number.isFinite(tapeMs) && newest.time * 1000 + 60_000 - tapeMs > 120_000;
  const barOrState = stateStalled ? newest!.close : num(state.close);
  const readAt = stateStalled ? newest!.time * 1000 + 60_000 : Number.isFinite(tapeMs) ? tapeMs : Date.now();
  /* a newer price already in hand (the Board's ten-second refresh, refreshBoardPrices) is not stepped back by a reload */
  const held = cache.get(ticker);
  const keepHeld = state.market_time === 'regular' && held?.status === 'live' && !!held.priceAt && held.priceAt > readAt && held.spot > 0;
  const last = keepHeld ? held!.spot : barOrState;
  const mt = typeof state.market_time === 'string' ? state.market_time : undefined;
  const offPhase = dayChangeOf({ close: last, prev_close: num(state.prev_close), market_time: mt }, null).phase;
  const regClose = num(state.prev_close);
  const spot = (offPhase === 'post' || offPhase === 'pre') && regClose > 0 ? regClose : last;
  const prev = num(state.prev_close) || num(state.open) || spot;
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
    /* A REFRESH NEVER DOWNGRADES OR BLANKS (the ninth audit's M1): a full book read again stays full — its dates and
       their contracts are carried below and re-read in place — so nothing on the page drops back to "loading" */
    full: !!prevEntry?.full && (mode === 'full' || !!prevEntry?.wantFull),
    wantFull: mode === 'full' || !!prevEntry?.wantFull,
    spot,
    prev,
    changePct: prev > 0 ? ((spot - prev) / prev) * 100 : 0,
    state: { close: last, prev_close: num(state.prev_close), market_time: mt },
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

/* WHICH DATES RE-PRICE WITH THEIR CONTRACTS' OWN VOLS (the fifth audit, 2026-10-23): the front date, and every live date
   holding at least OWN_IV_SHARE of the dates' gross gamma. With only the front date's own vols AAPL's whole book read
   336.7 (its later dates' wings at the ATM vol) against 326.0 with every contract's own; with the dates under 0.5% of
   the gross on their ATM vol it reads 326.00 (QQQ 734.37 against 734.33) — at 2% it was 329.1, AAPL's book is that
   flat — and a Board-only name skips five to nine dates' contracts. The full book reads every date's contracts anyway; the
   Board reads these dates' (loadBoardDates) — both pages pick the dates by the same rule off the same chains, so both
   re-price with the same vols. */
export const OWN_IV_SHARE = 0.005;
export function ownIvDates(byDate: Readonly<Record<string, readonly StrikeNode[] | undefined>>, dates: readonly string[], front: string | undefined): Set<string> {
  const gross = (d: string) => (byDate[d] ?? []).reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0);
  const g = dates.map(d => [d, gross(d)] as const);
  const total = g.reduce((a, [, v]) => a + v, 0);
  return new Set(g.filter(([d, v]) => d === front || (total > 0 && v >= OWN_IV_SHARE * total)).map(([d]) => d));
}

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
  if (fresh && haveFront && !!entry.frontFacts && (!allScope || datesComplete(entry))) {
    if (allScope) await refreshDatesGamma(entry, token);
    return;
  }
  /* THE BOARD'S FRONT DATE AHEAD OF THE QUEUE (the retail test, 2026-10-22: 16 of 20 names sat on "…" at 22s): the
     three calls that fill a row's "Today" levels jump the key's queue, so each name's row fills as its own core lands
     rather than after every name's */
  let listed: { date: string; dte: number }[] = [];
  const hot = isHot(entry.ticker);
  const got = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/expiry`, hot);
  if (got.error) return;
  listed = listingOf(got.data);
  keepTotals(entry, got.data);
  if (!still() || !listed.length) return;
  /* the first live listing when nothing is within four days (CROX: Nov 20 — the fourth audit found its Board "Today"
     levels never loaded and read the whole book's, labelled "today loading", for good) */
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
      const book = foldContracts(rows, front);
      const have = current.byDate[front] ?? chain;
      if (book.size && have.length) current.byDate = { ...current.byDate, [front]: paintLegs(have, book, true) };
      current.frontFacts = true;
      current.at = Date.now();
      cache.set(entry.ticker, current);
      emit();
    }
  }
  /* AFTER THE CLOSE, TODAY'S OWN CONTRACTS (names with a same-day expiry): the book the session ran on, for "Flip crossed
     today" — the vendor still serves this morning's rows for them (one call, once) */
  /* …and before today's open, the last session's own contracts (the session on record — data/bookWindow.ts recordDay):
     "How the levels held" and "Flip crossed" grade that session against the book live in it (the fifth audit) */
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
    /* …and that session's own contracts (the seventh audit's M2): its flip re-prices them with their own vols, and is
       final — "Flip crossed", "How the levels held" — only once they are read */
    const had = cache.get(entry.ticker);
    if (had && had.byDate[ny]?.length && !had.factsDates?.has(ny)) {
      const rows = await whalesOptionContractsPaged(entry.ticker, ny, hot).catch(() => null);
      if (!still()) return;
      const after = cache.get(entry.ticker);
      if (after && rows) {
        const book = foldContracts(rows, ny);
        const have = after.byDate[ny];
        if (book.size && have?.length) after.byDate = { ...after.byDate, [ny]: paintLegs(have, book, true) };
        after.factsDates = new Set([...(after.factsDates ?? []), ny]);
        after.at = Date.now();
        emit();
      }
    }
  }
  /* "All expiries" on the Board: every live date's strikes, so the flip can re-price each date at its own clock */
  if (readLevelsScope() === 'ALL') await loadBoardDates(entry.ticker, token, listed);
}

/** The session on record's own date has been asked for (its chain landed, or the ask came back) — until then a page
    that needs that book says "…", never "not available" (the seventh audit's m1) */
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
/*
  ONE BOARD NAME'S DATES AT A TIME, THE NAME ON SCREEN FIRST (the fifth audit, 2026-10-23: the Board in All expiries sat
  on "Reading the levels…" for 17 of 20 names at 45s). Every name queued its forty dates at once, so the key's three
  slots were shared by all twenty and every row finished late together. The dates are read a name at a time — the hot
  name (the one the desk is on) ahead of the rest, then in the order asked (the Board's own order) — so rows land one
  after another; the chains already read are kept on the book and never asked again.
*/
const datesQueue: { ticker: string; run: () => Promise<void>; done: () => void }[] = [];
let datesRunning = 0;
/* five names at a time (the sixth audit's M3; five since the seventh's m11, with five asks in flight from the browser —
   whales.ts MAX_INFLIGHT): each name's walk is one page after another, so five names keep the proxy's queue fed — the
   name on screen still first */
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
        return [date, await dateChain(ticker, date, e.spot, false, isHot(ticker))] as const;
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
  /* THE LIVE BOOK, NOT THE MORNING SNAPSHOT (the third audit, 2026-10-23: NVDA 17% against 13% live, TSLA 25 against 28,
     AAPL 23 against 25): today's date's live open-interest gamma, gross, against the whole live book's (settled dates
     off). Calls carry one sign on every date and puts the other, so the whole book's per-strike legs add to the same
     gross as every date's added up. The morning snapshot (greek-exposure/expiry) only stands in until the live rows land. */
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
  /* NOTHING PROVISIONAL (the fourth audit: the Board read 16% off the morning snapshot at first load, then the live 15%):
     with the live book on, a name whose date is listed waits for that date's live rows rather than print the stand-in */
  if (e.gammaLive && listedToday && !todayChain?.length) return { share: null, why: 'wait' };
  if (!e.totals?.length) return listedToday === false && e.expiries.length ? { share: null, why: 'none' } : { share: null, why: 'wait' };
  const live = e.totals.filter(t => t.date >= today);
  const dies = live.filter(t => t.date === today).reduce((a, t) => a + t.gross, 0);
  if (!live.some(t => t.date === today)) return { share: null, why: 'none' };
  const total = live.reduce((a, t) => a + t.gross, 0);
  return total > 0 ? { share: Math.round((100 * dies) / total) } : { share: null, why: 'wait' };
}

/*
  ONE FULL WALK A NAME AT A TIME, NEVER ABANDONED BY A REFRESH (the tenth audit's B3, 2026-10-23: SPY's All-expiries levels
  never finished on the Map, the Board or Compare in 2–3.5 minutes). The full book is re-read every FULL_MS (45s), and
  each re-read started the forty-date walk again and dropped the one in flight (its writes were tied to the read that
  started it) — SPY's walk takes longer than 45s on the key's three slots, so it never reached its end and the book was
  never `full`. The walk now runs once per name, lays what it reads onto whatever copy of the book is current, and a
  re-read while it runs leaves it be. A date whose read failed is asked once more at the end, and a date the vendor
  answers empty is taken as empty (not waited on for good).
*/
const expWalking = new Set<string>();
async function loadExpiries(entry: Entry, token: number): Promise<void> {
  console.debug('[fix10dbg] loadExpiries', entry.ticker, expWalking.has(entry.ticker));
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
        return [date, await dateChain(entry.ticker, date, entry.spot, true, isHot(entry.ticker) && first)] as const;
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
    cache.set(entry.ticker, current);
    emit();
  };
  /* The dates on screen first, then the rest of the listed book. */
  /* THE NEAR DATES' OPEN INTEREST AT ONCE (the ship pass, 2026-10-22): the by-expiry rows carry no open interest, and
     it was filled only after all ~40 dates had landed — on Building (today's expiry by default) every strike's change
     read +$0 for the better part of a minute. The dates on screen get theirs as soon as they are in. */
  /* the far dates' live gamma in one walk of every expiry (liveGammaAll — the sixth audit's M3), read beside the near
     dates; each far date then asks only its greek rows, its live rows already in hand */
  /* THE FRONT DATE FIRST, ON ITS OWN (the eighth audit's load times: Map 17s, Agenda 19s, Building 27s). "Today" — the
     desk's default scope — is final once the front date's chain and its contracts are in; it waited on all six near
     dates' chains before its contracts were even asked. The front date is pulled and its contracts asked at once; the
     other near dates follow beside them. */
  const front = near.slice(0, 1);
  const frontGot = await pull(front, true);
  if (!still()) return;
  apply(frontGot, false);
  const atFront = cache.get(entry.ticker);
  /* the front date's contracts before the rest: "Today" is final with them */
  const frontFacts = atFront ? fillExpiryFacts(atFront, liveToken(), front) : null;
  const walk = dates.length > 6 ? liveGammaAll(entry.ticker, isHot(entry.ticker)).catch(() => null) : null;
  const nearGot = await pull(near.slice(1), true);
  console.debug('[fix10dbg] near got', entry.ticker, nearGot.map(([d, c]) => `${d}:${c?.length ?? 'null'}`).join(' '), still());
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
    console.debug('[fix10dbg] before walk', entry.ticker);
    await walk;
    console.debug('[fix10dbg] after walk', entry.ticker, still());
    if (!still()) return;
    const farGot = await pull(dates.slice(6));
    console.debug('[fix10dbg] far got', entry.ticker, farGot.length);
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
  /* NEVER A DOWNGRADE (the ninth audit's M1): a name the Map holds in full is refreshed in full whoever asks — a Board
     caller's 'board' read used to reload it with the Board's mode */
  if (e && (e.full || e.wantFull)) mode = 'full';
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
/* BOTH DIRECTIONS (the third audit, 2026-10-23): the vendor's default order is the largest INCREASE first — six pages
   of it ran out at a change of 0 and never reached one contract that was closed. SPY's 770 call wall read "steady
   −$95K" over −2,995 calls (−$70.5M), 769 "+$0" over −6,478 puts; 110 of the 342 Oct 23 contracts fell and none were
   counted. Increases are read largest first (order=desc), decreases largest first (order=asc), each until its pages
   reach a change of 0 — everything past that point is unchanged. */
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
}
const oiChangeCache = new Map<string, OiChange>();
const oiChangeAt = new Map<string, number>();
/* the count is set once overnight — re-read every half hour, so a page left open across the roll picks up the new one */
const OI_CHANGE_MS = 30 * 60_000;
const oiChangeWait = new Set<string>();

/* KEYED BY CONTRACT, NOT BY STRIKE (the Pinpoint audit, 2026-10-22): the strike-only parse dropped the expiry and summed
   every date's change at a strike, and Building then valued that sum at the selected scope's per-contract gamma — SPY
   767 read "+42,691 puts" on today's chain when 1,921 of them were 10/22 and 36,716 were 10/27. Each row keeps its
   expiry, strike and side; Building picks the contracts in scope and values each with its own gamma. */
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
/* THE NEXT COUNT AS SOON AS IT IS OUT (the seventh audit's retail finding: "BUILT OCT 21" with "Oct 22's count is not out
   yet" at 07:25 on Oct 23, and nothing said when it would be): while the count in hand does not yet cover the last
   finished session, the vendor's first page is asked every five minutes, and the whole count is read again the moment it
   carries a newer date */
const OI_STALE_MS = 5 * 60_000;
const oiChangeChecked = new Map<string, number>();
/** When the open-interest count was last asked for (epoch ms), and whether it is behind the last finished session */
export function peekOiChangeCheck(ticker: string): { at: number | null; behind: boolean } {
  const t = ticker.toUpperCase();
  const c = oiChangeCache.get(t);
  return { at: oiChangeChecked.get(t) ?? oiChangeAt.get(t) ?? null, behind: !!c?.lastDate && c.lastDate < finishedSessionIso() };
}
export function ensureOiChange(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeWait.has(t)) return;
  const held = oiChangeCache.get(t);
  const behind = !!held?.lastDate && held.lastDate < finishedSessionIso();
  const age = Date.now() - Math.max(oiChangeAt.get(t) ?? 0, oiChangeChecked.get(t) ?? 0);
  if (held && age < (behind ? OI_STALE_MS : OI_CHANGE_MS)) return;
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
        readOiChange(t);
      } else emit();
    })().catch(() => oiChangeWait.delete(t));
    return;
  }
  readOiChange(t);
}
function readOiChange(t: string): void {
  oiChangeWait.add(t);
  void (async () => {
    const out: OiChangeRow[] = [];
    let lastDate: string | null = null;
    let currDate: string | null = null;
    const seen = new Set<string>();
    for (const order of ['desc', 'asc'] as const) {
      for (let page = 0; page < OI_PAGES; page++) {
        /* a name off screen reads its change in the background lane — no row's levels wait on it (the sixth audit's M3) */
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
    oiChangeCache.set(t, { rows: out, lastDate, currDate });
    oiChangeAt.set(t, Date.now());
    oiChangeChecked.set(t, Date.now());
    emit();
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each contract's open-interest change over the last session — null until it lands */
export const peekOiChange = (ticker: string): OiChange | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
