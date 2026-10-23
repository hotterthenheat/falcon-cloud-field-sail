/*
  TRACE — live Unusual Whales rows, mapped onto the grids the desks already draw.
  The browser calls /api/uw. This file does not invent a layout and does not
  talk to the simulator.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uwCall } from './whales';
import { vendorFault, type FeedFault } from '../components/ui/liveRead';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import { isoDate, isTradingDay, sessionsBetween } from '../core/calendar';
import { nyParts, nyWallTime } from '../core/nyTime';
import type { MoneynessKey, NetFlowSegment, SpreadKind, SpreadLeg, SpreadTrade } from './flowBook';

const POLL_MS = 4_000;

export interface LivePack<T> {
  rows: T;
  at: number | null;
  fault: FeedFault | null;
  waiting: boolean;
}

interface CacheBox<T> {
  /** the request these rows answer — a box for another key is never shown */
  key?: string;
  rows: T;
  at: number | null;
  fault: FeedFault | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return rowsOf((data as { data: unknown }).data);
  }
  /* ONE ALERT'S TRADES COME AS { alert, has_more, trades: [...] } (/option-trades/flow-alerts/{id}) — read as neither an
     array nor `.data`, every alert's strip said "0 prints" (the re-audit, 2026-10-22: alert 3356f987, trade_count 2) */
  if (data && typeof data === 'object' && Array.isArray((data as { trades?: unknown }).trades)) {
    return rowsOf((data as { trades: unknown }).trades);
  }
  return [];
}

/* ---- the session's clock ------------------------------------------------------------------------------------------
   THE REGULAR SESSION IS 09:30–16:00 New York for a stock's options, and 09:30–16:15 for the broad index and ETF options
   that keep trading to 16:15 (SPX, NDX, RUT, VIX, XSP and SPY, QQQ, IWM, DIA…) — the re-audit, 2026-10-22: SPY's panes cut
   at 16:00 read net puts +$6.90M against a day of +$17.27M. Before 09:30 is pre-market, after the close is after hours,
   and a closed day is closed. */
const LATE_CLOSE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'XSP', 'RUT', 'RUTW', 'MRUT', 'VIX', 'VIXW', 'XND', 'DJX', 'OEX', 'XEO', 'SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'EEM', 'EFA', 'GLD', 'SLV', 'TLT', 'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'SMH', 'SOXX', 'SOXL', 'IBIT', 'KRE', 'KWEB', 'FXI', 'EWZ', 'EWY', 'UNG', 'UVXY', 'UVIX', 'HYG', 'LQD', 'GDX', 'XBI', 'USO', 'TQQQ', 'SQQQ']);
export const SESSION_OPEN = 570;
/** New York minute the regular session ends for this name's options — 16:15 for the late-closing index and ETF options */
export function sessionEndMin(ticker?: string | null): number {
  return ticker && LATE_CLOSE.has(ticker.toUpperCase()) ? 975 : 960;
}
/** "16:15" or "16:00" */
export const sessionEndLabel = (ticker?: string | null) => (sessionEndMin(ticker) === 975 ? '16:15' : '16:00');
export type SessionPhase = 'pre' | 'regular' | 'after' | 'closed';
/** Where New York's clock stands against the stock session (09:30–16:00; after hours to 20:00, pre-market from 04:00) */
export function sessionPhase(at: Date = new Date()): SessionPhase {
  const p = nyParts(at);
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return 'closed';
  const m = p.hour * 60 + p.minute;
  if (m >= 240 && m < 570) return 'pre';
  if (m >= 570 && m < 960) return 'regular';
  if (m >= 960 && m < 1200) return 'after';
  return 'closed';
}

/** THE MARKET'S CLOCK, BY INSTRUMENT (the third audit, 2026-10-22: from 16:00 to 16:15 the badge said "After hours" while
    SPX, SPY and QQQ options were still in their regular session). 'late' is 16:00–16:15 on a session day: stock options
    have closed, the index and ETF options that keep trading to 16:15 have not. */
export type MarketPhase = SessionPhase | 'late';
export function marketPhase(at: Date = new Date()): MarketPhase {
  const ph = sessionPhase(at);
  if (ph !== 'after') return ph;
  const p = nyParts(at);
  return p.hour * 60 + p.minute < 975 ? 'late' : 'after';
}
/** Where one name's options stand: in the regular session until its own close (16:00, or 16:15 for the late closers) */
export function sessionPhaseFor(ticker: string | null | undefined, at: Date = new Date()): SessionPhase {
  const ph = marketPhase(at);
  if (ph !== 'late') return ph;
  return sessionEndMin(ticker) === 975 ? 'regular' : 'after';
}

/** THE LAST REGULAR SESSION THAT HAS ENDED — its New York day and the instant of its 16:15 close (the last options to
    close) — or null while one is still running (09:30–16:15 on a session day). After the close, before the open and on a
    closed day, the Trace pages that read "the regular session" read this one (the third audit: after the close the Live
    Tape and the dark pool showed only after-hours prints under a "Regular" session card). */
export function lastRegularClose(at: Date = new Date()): { iso: string; closeMs: number; openMs: number } | null {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute;
  const d = new Date(p.year, p.month - 1, p.day);
  if (isTradingDay(d) && m >= SESSION_OPEN && m < 975) return null;
  if (!(isTradingDay(d) && m >= 975)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  return { iso: isoDate(d), closeMs: nyWallTime(y, mo, da, 16, 15), openMs: nyWallTime(y, mo, da, 9, 30) };
}

/** A Trace figure in money with a real minus sign ("−$4.2K", never "-$4.2K") */
export const usd = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 0.5 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
};

/** "1 contract", "2 contracts" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** THE DAY'S SIDES, ALL THREE (the re-audit, 2026-10-22: QQQ 725C read "ask" on 166 at the ask against 128 on the bid
    while 38,000 of its 38,304 contracts were a no-side cross). Shares of the WHOLE day's volume — at the ask, on the bid,
    and at the mid or with no side — and a lean only where one is real: at least half the day traded on a side, and
    that side carried LEAN_EDGE (55%) or more of the sided volume.
    ONE RULE ACROSS TRACE (the third audit, 2026-10-22: the card's anchor used 55/45 of ask ÷ (ask + bid) ignoring the
    mid, the Lean cell 58/42 with an "unsided" rule, the Tracker a ±6 band): every lean on Trace — the Lean cell, the
    Screener's words, the Tracker, Compare, the card — is this function. It reads CONTRACTS by side, because that is what
    the vendor carries per contract (the screener has no premium by side); a name's net premium is a separate figure and
    says so where it is drawn. */
export const LEAN_EDGE = 55;
export interface DayLean {
  ask: number;
  bid: number;
  mid: number;
  lean: 'ASK' | 'BID' | 'EVEN' | 'UNSIDED';
}
export function dayLean(r: { askPct: number; volume: number; sideVol?: { ask: number; bid: number; mid: number } }): DayLean {
  const sv = r.sideVol;
  if (!sv) {
    const a = Number.isFinite(r.askPct) ? r.askPct : NaN;
    if (!Number.isFinite(a)) return { ask: NaN, bid: NaN, mid: NaN, lean: 'UNSIDED' };
    return { ask: a, bid: 100 - a, mid: 0, lean: a >= LEAN_EDGE ? 'ASK' : a <= 100 - LEAN_EDGE ? 'BID' : 'EVEN' };
  }
  const total = sv.ask + sv.bid + sv.mid;
  if (!(total > 0)) return { ask: NaN, bid: NaN, mid: NaN, lean: 'UNSIDED' };
  const pc = (v: number) => (v / total) * 100;
  const sided = sv.ask + sv.bid;
  const askOfSided = sided > 0 ? sv.ask / sided : 0.5;
  const lean: DayLean['lean'] = sided < total * 0.5 ? 'UNSIDED' : askOfSided >= LEAN_EDGE / 100 ? 'ASK' : askOfSided <= 1 - LEAN_EDGE / 100 ? 'BID' : 'EVEN';
  return { ask: pc(sv.ask), bid: pc(sv.bid), mid: pc(sv.mid), lean };
}

/** Whole-percent shares of a three-way split that always sum to 100 (largest remainder) — one rounding for every side
    figure on a card (the third audit: "bid 44%" in one place, "BID 43%" in the bar) */
export function sideShares(bid: number, mid: number, ask: number): { bid: number; mid: number; ask: number } {
  const total = bid + mid + ask;
  if (!(total > 0)) return { bid: 0, mid: 0, ask: 0 };
  const raw = [bid, mid, ask].map(v => (v / total) * 100);
  const fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const o of order) {
    if (left <= 0) break;
    fl[o.i]++;
    left--;
  }
  return { bid: fl[0], mid: fl[1], ask: fl[2] };
}

export function nyIsoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function clock(iso: unknown): { time: string; minute: number; epoch: number; ms: number } {
  const raw = typeof iso === 'number' ? iso : typeof iso === 'string' ? Date.parse(iso) : NaN;
  const d = Number.isFinite(raw) ? new Date(raw > 1e12 ? raw : raw * 1000) : null;
  if (!d || Number.isNaN(d.getTime())) return { time: '—', minute: 0, epoch: 0, ms: 0 };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const pick = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  const time = `${pick('hour')}:${pick('minute')}:${pick('second')}`;
  const minute = Number(pick('hour')) * 60 + Number(pick('minute'));
  return { time, minute, epoch: Math.floor(d.getTime() / 1000), ms: d.getTime() };
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function expiryLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** THE TAPE'S SESSION — the New York trading day the vendor's prints belong to: today once the day's tape opens (04:00
    New York, a session day), otherwise the last session before it. Overnight and on a closed day every row on Trace is
    the last session's, and its days-to-expiry count from that day (the ship pass, 2026-10-22: at 00:54 on Oct 22 the
    Oct 23 contracts read "1d" while the Oct 21 ones, expired at the bell, read "0d" — two clocks on one grid). */
export function tapeSessionIso(): string {
  const p = nyParts(new Date());
  const d = new Date(p.year, p.month - 1, p.day);
  if (!(isTradingDay(d) && p.hour >= 4)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  return isoDate(d);
}

function dteOf(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.parse(`${tapeSessionIso()}T00:00:00Z`);
  return Math.max(0, Math.round((day - today) / 86_400_000));
}

export function useLive<T>(key: string, load: () => Promise<T>, empty: T, enabled = true): LivePack<T> {
  const [box, setBox] = useState<CacheBox<T> | null>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (!enabled) {
      setWaiting(false);
      return;
    }
    let stop = false;
    const run = async () => {
      try {
        const rows = await load();
        if (stop) return;
        setBox({ key, rows, at: Date.now(), fault: null });
        setWaiting(false);
      } catch (e) {
        if (stop) return;
        const fault = vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed';
        setBox(prev => (prev && prev.key === key ? { ...prev, fault } : { key, rows: empty, at: null, fault }));
        setWaiting(false);
      }
    };
    void run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // `key` is the request. `load` closes over the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  /* A NEW KEY NEVER WEARS THE OLD KEY'S ROWS (the ship pass, 2026-10-22): the box outlived its request, so a Net Flow pane
     moved from SPY to META drew SPY's minutes under META's name until the next answer landed */
  const mine = box && box.key === key ? box : null;
  return { rows: mine?.rows ?? empty, at: mine?.at ?? null, fault: mine?.fault ?? null, waiting: enabled && !mine && (waiting || !!box) };
}

async function getRows(path: string): Promise<Record<string, unknown>[]> {
  const got = await uwCall(path, true);
  if (got.error) {
    if (got.status === 422 || got.status === 403 || got.status === 404) return [];
    throw new Error(got.error);
  }
  return rowsOf(got.data);
}

/** The print's own side, as the vendor tags it (ask_side / bid_side / mid_side) — the side every Trace surface reads.
    "Mid" is the vendor's mid_side or no side at all, never our own reading of the quote (the audit, 2026-10-22: 757 of
    2,700 prints the vendor tags bid_side or ask_side fill a cent inside the spread, and the tape called them NEUTRAL
    while the card called them bought or sold). Falls back to the quote only when the row carries no side tag. */
export function sideOfTags(tags: unknown, price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' {
  const t = Array.isArray(tags) ? tags.map(String) : [];
  /* A TAG THE QUOTE AT THE PRINT CONTRADICTS loses to the quote: an "ask_side" fill at or under the bid was a sale, a
     "bid_side" fill at or over the ask a purchase (the retail pass, 2026-10-22: a fill a cent inside the spread keeps its
     tag — 757 such prints — but a tag on the far side of the quote is the vendor's error, not the print's side) */
  const quoted = price > 0 && bid > 0 && ask > bid;
  if (t.includes('ask_side')) return quoted && price <= bid + 1e-6 ? 'BID' : 'ASK';
  if (t.includes('bid_side')) return quoted && price >= ask - 1e-6 ? 'ASK' : 'BID';
  if (t.includes('mid_side') || t.includes('no_side')) return 'MID';
  return execOf(price, bid, ask) ?? 'MID';
}

/* THE PRINT'S OWN CONDITION CODE (OPRA, upstream_condition_detail) says what it was: ISOI is an intermarket sweep;
   ML?T / TL?T and the ?ESL / ?ASL / ?FSL family are legs of a multi-leg order. `stock_multi_vol` / `multi_vol` are the
   CONTRACT's day volumes, never this print's kind (the audit, 2026-10-22: reading them made every print on a contract
   that had ever traded in a spread a "×2 legs · CUSTOM"). */
/* COMPRESSION IS NOT A BET (the third audit, 2026-10-22: "Largest in window SPX 7000C bought · $642.0M" was one OPRA
   `cbmo` print, paired in the same millisecond with an SPX 8000P sold, and 154 such prints — $2.69B — drove "bullish
   premium leads by $2.0B"). OPRA's CBMO is a multi-leg floor trade of proprietary products and MCTP a multilateral
   compression trade of proprietary products: SPX/XSP packages that net open interest down between members (conversions,
   reversals, boxes — a call bought against a put sold at one strike), whatever side each leg prints on. UW's own
   `arbitrage` tag marks the same kind of package. These carry no direction: they are labelled, counted on their own,
   and kept out of every bullish/bearish total, the largest/top-bull/top-bear facts and the sentiment. (The vendor's
   `futures_floor` flag rides on EVERY floor trade — slft, mlft, mfsl, tlft as well as cbmo, 1,713 of the 2,000 newest
   $1M prints — so it alone is not compression; the condition code is.) */
const COMPRESSION_CODES = new Set(['cbmo', 'mctp']);
export function printCondition(row: Record<string, unknown>): { multi: boolean; sweep: boolean; floor: boolean; compression: boolean } {
  const cond = String(row.upstream_condition_detail || '').toLowerCase();
  const flags = (Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')]).join(' ');
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    multi: /^(ml|tl)[aecf]t$|^[mt][aecf]sl$/.test(cond) || cond === 'cbmo' || /multi/i.test(flags),
    sweep: cond === 'isoi' || /sweep/i.test(flags),
    floor: /floor/i.test(flags) || /^(ml|tl)ft$|^[mt]fsl$/.test(cond),
    compression: COMPRESSION_CODES.has(cond) || tags.includes('arbitrage'),
  };
}

/** A cancelled print never traded (the third audit, 2026-10-22: 14 of 2,000 prints, $68.4M, sat on the Live Tape and in
    every total — SPXW 270930P 8125 37 × $560.81 = $2.07M read "PAID OFFER"). Every option-trade route goes through here. */
export const liveTrades = (rows: Record<string, unknown>[]) => rows.filter(r => r.canceled !== true && r.canceled !== 'true');

/* ---- the index level (SPX, NDX, XSP, RUT, VIX) -------------------------------------------------------------------
   The vendor sends no underlying price on a CBOE index's prints (`underlying_price: null`, "missing_periscope") and
   refuses the index quote on this key — but its spot-exposure minutes for the index carry the level each minute
   (whole points). The newest minute is the index level the moneyness is read against; a weekly root reads its index
   (SPXW → SPX). Asked at most every 30s per index, and only for an index that is on the screen. */
const INDEX_ROOT: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', NDX: 'NDX', NDXP: 'NDX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', VIXW: 'VIX', XND: 'XND', DJX: 'DJX', MRUT: 'MRUT' };
const indexLevels = new Map<string, { at: number; level: number }>();
const indexAsks = new Map<string, Promise<void>>();
export function indexRoot(ticker: string): string | null {
  return INDEX_ROOT[ticker.toUpperCase()] ?? null;
}
/** The newest index level we hold for this ticker's index, 0 when none */
export function indexLevel(ticker: string): number {
  const root = indexRoot(ticker);
  return root ? (indexLevels.get(root)?.level ?? 0) : 0;
}
/** Fetch the index levels the rows need (cached 30s); never throws */
async function ensureIndexLevels(tickers: Iterable<string>): Promise<void> {
  const roots = new Set<string>();
  for (const t of tickers) {
    const r = indexRoot(t);
    if (r) roots.add(r);
  }
  const jobs: Promise<void>[] = [];
  for (const root of roots) {
    const hit = indexLevels.get(root);
    if (hit && Date.now() - hit.at < 30_000) continue;
    let job = indexAsks.get(root);
    if (!job) {
      job = (async () => {
        try {
          const got = await uwCall(`/stock/${root}/spot-exposures`, true);
          const rows = got.error ? [] : rowsOf(got.data);
          let best: { t: number; p: number } | null = null;
          for (const r of rows) {
            const t = Date.parse(String(r.time || r.start_time || ''));
            const p = num(r.price);
            if (p > 0 && Number.isFinite(t) && (!best || t > best.t)) best = { t, p };
          }
          if (best) indexLevels.set(root, { at: Date.now(), level: best.p });
        } catch {
          /* no level: the moneyness reads "—" */
        } finally {
          indexAsks.delete(root);
        }
      })();
      indexAsks.set(root, job);
    }
    jobs.push(job);
  }
  await Promise.all(jobs);
}
const tickerOfRow = (r: Record<string, unknown>) => String(r.underlying_symbol || r.ticker || r.ticker_symbol || '').toUpperCase();

/* AN INDEX LEVEL IN WHOLE POINTS IS TOO COARSE FOR A DISTANCE ON A SMALL INDEX (the re-audit, 2026-10-22: "VIX 19 put ·
   0.0%"): a point is 5% of VIX and 0.13% of XSP, so the distance is not stated there. SPX, NDX and RUT (thousands of
   points) keep theirs, marked "≈" where it is drawn. */
function otmOf(right: 'C' | 'P', strike: number, spot: number, fromIndex: boolean): number {
  if (!(spot > 0) || !(strike > 0)) return NaN;
  if (fromIndex && spot < 2000) return NaN;
  return ((right === 'C' ? strike - spot : spot - strike) / spot) * 100;
}
/** True when the row's spot is the index's whole-point level (no underlying price on the print) */
const spotIsIndexLevel = (row: Record<string, unknown>, ticker: string) => !(num(row.underlying_price || row.stock_price) > 0) && !!indexRoot(ticker);

/** The print ran outside the regular session: the vendor's own flag, else its trading_hours word */
function extendedOf(row: Record<string, unknown>): boolean {
  const flags = Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')];
  if (flags.some(f => /extended/i.test(f))) return true;
  if (String(row.upstream_condition_detail || '').toLowerCase() === 'exht') return true;
  const th = String(row.trading_hours || '').toLowerCase();
  return th !== '' && th !== 'rth' && th !== 'regular';
}

function tradeToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const ticker = tickerOfRow(row);
  const expiryIso = String(row.expiry || row.expiration || '').slice(0, 10);
  const when = clock(row.executed_at || row.created_at);
  const fill = num(row.price);
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const spot = num(row.underlying_price || row.stock_price) || indexLevel(ticker);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  const side = sideOfTags(row.tags, fill, bid, ask);
  /* the vendor's flag, else the clock: a fill outside the name's regular session (09:30 to 16:00, 16:15 for the index
     and ETF options) is an extended-hours print whether or not it came flagged (a HIVE call at 17:11:50 did not) */
  /* BY THE PRINT, NOT THE WALL CLOCK (the third audit): between 16:00 and 16:15 the vendor's own flag decides — SPY, QQQ,
     SOXL or IBIT options at 16:14 are regular-session prints, a stock's are flagged extended_hours; before 09:30 and from
     16:15 nothing is regular */
  const flagged = Array.isArray(row.report_flags) || row.trading_hours != null;
  const m = when.minute;
  const extended = extendedOf(row) || (m > 0 && (m < SESSION_OPEN || m >= 975 || (!flagged && m >= sessionEndMin(ticker))));
  const spread = ask > bid ? ask - bid : 0;
  const fillPos = spread > 0 ? Math.min(1, Math.max(0, (fill - bid) / spread)) : side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5;
  const size = num(row.size);
  const premium = num(row.premium) || fill * size * 100;
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  /* the CONTRACT's day by side (the vendor's ask_vol / bid_vol / mid_vol sum to its volume) — the row's day lean */
  const askVol = num(row.ask_vol);
  const bidVol = num(row.bid_vol);
  const volSum = askVol + bidVol;
  const { multi, sweep, compression } = printCondition(row);
  const idRaw = String(row.id || `${ticker}-${when.epoch}-${i}`);
  return {
    id: hashId(idRaw),
    time: when.time,
    ticker,
    /* the condition says "a leg of a multi-leg order", not how many legs it had — 2 is the marker, drawn as "multi-leg" */
    legs: multi ? 2 : 1,
    strike,
    right,
    otmPct: otmOf(right, strike, spot, spotIsIndexLevel(row, ticker)),
    expiry: expiryLabel(expiryIso),
    dte: dteOf(expiryIso),
    fill,
    bid,
    ask,
    fillPos,
    side,
    /* where the fill sat in its quote, −100 at the bid to +100 at the ask */
    flowScore: spread > 0 ? Math.round((fillPos - 0.5) * 200) : 0,
    ratioLabel: volSum > 0 ? (askVol >= bidVol ? `ASK ${Math.round((askVol / volSum) * 100)}%` : `BID ${Math.round((bidVol / volSum) * 100)}%`) : '—',
    ratioBidPct: volSum > 0 ? Math.round((bidVol / volSum) * 100) : NaN,
    size,
    premium,
    volume,
    oi,
    deltaOI: 0,
    spot,
    /* the vendor's IV is always a fraction — a same-day contract's 5.3 is 530%, not 5% */
    iv: num(row.implied_volatility) * 100,
    volOverOI: oi > 0 ? volume / oi : 0,
    strat: '—',
    sweep,
    alertId: typeof row.flow_alert_id === 'string' ? row.flow_alert_id : null,
    epoch: when.epoch,
    epochMs: when.ms,
    vendorId: idRaw,
    occ: row.option_chain_id ? String(row.option_chain_id) : row.option_chain ? String(row.option_chain) : row.option_symbol ? String(row.option_symbol) : undefined,
    extended: extended || undefined,
    theta: row.theta != null && row.theta !== '' ? num(row.theta) : undefined,
    daySide: row.ask_vol != null || row.bid_vol != null ? { ask: askVol, bid: bidVol, mid: num(row.mid_vol) + num(row.no_side_vol) } : undefined,
    compression: compression || undefined,
  };
}

/* A FLOW ALERT IS AN AGGREGATE (the audit, 2026-10-22): `trade_count` prints on one contract inside a window, its money
   split by side in total_ask_side_prem / total_bid_side_prem, its quote in `bid` / `ask` and its last fill in `price`.
   Handed to the print mapper as a trade it read MID 0.00 × 0.00, NEUTRAL, "ASK 100%" on every row — the mapper looked
   for nbbo_bid / nbbo_ask and a side tag. The side is the alert's own: the side that carried 60% or more of its money,
   else mid. */
function alertToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const askPrem = num(row.total_ask_side_prem);
  const bidPrem = num(row.total_bid_side_prem);
  const sided = askPrem + bidPrem;
  const total = num(row.total_premium);
  const side: 'ASK' | 'BID' | 'MID' = sided > 0 && askPrem >= 0.6 * sided ? 'ASK' : sided > 0 && bidPrem >= 0.6 * sided ? 'BID' : 'MID';
  const tags = side === 'ASK' ? ['ask_side'] : side === 'BID' ? ['bid_side'] : ['mid_side'];
  const base = tradeToPrint(
    {
      ...row,
      tags,
      price: row.price,
      nbbo_bid: row.bid,
      nbbo_ask: row.ask,
      premium: row.total_premium ?? row.premium,
      size: row.total_size ?? row.size,
      /* THE FILLS' OWN TIME (the re-audit, 2026-10-22: "Filled 16:44:12" was created_at — the alert's filing — while
         its fills were at 16:43:37): start_time … end_time is the window the alert's prints filled in */
      executed_at: row.start_time ?? row.end_time ?? row.created_at,
      underlying_price: row.underlying_price,
      option_type: row.type ?? row.option_type,
      option_chain_id: row.option_chain,
      implied_volatility: row.iv ?? row.iv_end ?? row.iv_start,
      flow_alert_id: row.id,
      upstream_condition_detail: '',
      report_flags: [],
      ask_vol: undefined,
      bid_vol: undefined,
    },
    i
  );
  return {
    ...base,
    alertId: String(row.id || base.alertId || ''),
    sweep: row.has_sweep === true,
    legs: row.has_multileg === true && row.has_singleleg !== true ? 2 : 1,
    trades: num(row.trade_count) || undefined,
    /* the alert's own money by side: "ASK 72%" of its sided premium */
    ratioLabel: sided > 0 ? (askPrem >= bidPrem ? `ASK ${Math.round((askPrem / sided) * 100)}%` : `BID ${Math.round((bidPrem / sided) * 100)}%`) : '—',
    ratioBidPct: sided > 0 ? Math.round((bidPrem / sided) * 100) : NaN,
    alertSides: { ask: askPrem, bid: bidPrem, other: Math.max(0, total - sided) },
    alertRule: row.alert_rule ? String(row.alert_rule) : undefined,
    fillEnd: row.end_time != null && row.start_time != null && num(row.end_time) - num(row.start_time) >= 1000 ? clock(row.end_time).time : undefined,
    /* an alert carries no session flag of its own: its fill time says it */
    extended: (() => {
      const m = clock(row.start_time ?? row.created_at).minute;
      return m > 0 && (m < SESSION_OPEN || m >= sessionEndMin(base.ticker)) ? true : undefined;
    })(),
  };
}

/** Rows mapped once the index levels they need are in hand (an index print carries no underlying price) */
async function mapWithIndex<T>(rows: Record<string, unknown>[], fn: (r: Record<string, unknown>, i: number) => T): Promise<T[]> {
  await ensureIndexLevels(rows.map(tickerOfRow));
  return rows.map(fn);
}

export function useOptionTape(limit = 200): LivePack<FlowPrint[]> {
  return useLive(`tape:${limit}`, async () => mapWithIndex(liveTrades(await getRows(`/option-trades?limit=${limit}`)), tradeToPrint), []);
}

/* ONE NAME'S TAPE AND STRUCTURES (Trace › Compare, 2026-10-22): the market-wide windows are the market's latest prints
   — after the close almost all index — so a name like SPY read "0 prints" beside a full book. Additive: the vendor's
   ticker_symbol filter on the same routes. */
export function useNameTape(ticker: string | null, limit = 200): LivePack<FlowPrint[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(name ? `tape:${name}:${limit}` : 'tape:name:off', async () => mapWithIndex(liveTrades(await getRows(`/option-trades?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}`)), tradeToPrint), [], !!name);
}

export function useNameSpreads(ticker: string | null, limit = 80): LivePack<SpreadTrade[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useSettled(useLive(name ? `spreads:${name}:${limit}` : 'spreads:name:off', async () => (await getRows(`/option-trades/multi-leg?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}`)).map(spreadOf), [], !!name));
}

/** One contract's real last trade — /option-contract/{occ}/flow (the vendor's "last trades"). The contract card anchors
    on it: a book row's card had stood on an invented clip (a hashed size and spread), "$1.2M BOUGHT × 205" on a contract
    whose last print was 2 lots on the bid. */
export interface ContractLast {
  size: number;
  fill: number;
  side: 'ASK' | 'BID' | 'MID';
  time: string;
  bid: number;
  ask: number;
  premium: number;
  /** The print's own OPRA condition said it was a leg of a multi-leg order / an intermarket sweep */
  multi: boolean;
  sweep: boolean;
  /** Printed outside the regular session */
  extended?: boolean;
  /** The vendor's per-share theta on the print */
  theta?: number;
}
export function useContractLast(occ: string | null | undefined): LivePack<ContractLast | null> {
  const sym = (occ || '').trim().toUpperCase();
  return useLive(
    sym ? `last:${sym}` : 'last:off',
    async () => {
      /* a few back, so a cancelled newest print gives way to the real last trade */
      const rows = liveTrades(await getRows(`/option-contract/${encodeURIComponent(sym)}/flow?limit=5`));
      const r = rows[0];
      if (!r) return null;
      const side = sideOfTags(r.tags, num(r.price), num(r.nbbo_bid), num(r.nbbo_ask));
      const { multi, sweep } = printCondition(r);
      return { size: num(r.size), fill: num(r.price), side, time: clock(r.executed_at).time, bid: num(r.nbbo_bid), ask: num(r.nbbo_ask), premium: num(r.premium), multi, sweep, extended: extendedOf(r), theta: r.theta != null && r.theta !== '' ? num(r.theta) : undefined };
    },
    null,
    !!sym
  );
}

const TAPE_CAP = 2000;
/** The route's largest page (the spec: limit max 500) */
const TAPE_PAGE = 500;
/** Pages one poll may walk back to close the gap to the newest print in hand — 2,000 prints, the buffer's whole cap */
const GAP_PAGES = 4;
/** Late prints land in the vendor's store a few ms behind their fill time — each poll re-reads this far back (and drops
    the repeats by trade id) so a print stamped just before the newest one in hand is never skipped */
const LATE_MS = 2_000;
export { TAPE_CAP };

export interface TapeQuery {
  ticker?: string;
  right?: 'C' | 'P' | null;
  side?: 'ASK' | 'BID' | 'MID' | null;
  multi?: boolean;
  minPremium?: number;
  minDte?: number | null;
  maxDte?: number | null;
  otm?: boolean;
}

/** Query string the option tape actually accepts. Sweep, block and floor stay client-side — those flags 400 this route.
    The cursors are MILLISECONDS (the route takes seconds, milliseconds or ISO) — whole seconds skipped every print that
    shared the cursor's second, and the market prints 150–300 a second. */
export function tapeQueryString(q: TapeQuery, extra?: { newerThan?: number; olderThan?: number; limit?: number }): string {
  const p = new URLSearchParams();
  p.set('limit', String(extra?.limit ?? TAPE_PAGE));
  if (q.ticker) p.set('ticker_symbol', q.ticker.toUpperCase());
  if (q.right === 'C') p.set('type', 'call');
  else if (q.right === 'P') p.set('type', 'put');
  if (q.side === 'ASK') p.set('tags[]', 'ask_side');
  else if (q.side === 'BID') p.set('tags[]', 'bid_side');
  else if (q.side === 'MID') p.set('tags[]', 'mid_side');
  if (q.multi) p.set('is_multi_leg', 'true');
  if (q.minPremium && q.minPremium > 0) p.set('min_premium', String(Math.round(q.minPremium)));
  if (q.minDte != null) p.set('min_dte', String(q.minDte));
  if (q.maxDte != null) p.set('max_dte', String(q.maxDte));
  if (q.otm) p.set('is_otm', 'true');
  if (extra?.newerThan) p.set('newer_than', String(extra.newerThan));
  if (extra?.olderThan) p.set('older_than', String(extra.olderThan));
  return p.toString();
}

const printId = (r: FlowPrint) => r.vendorId || String(r.id);

/** One list, newest first, no print twice (by the vendor's trade id) */
function dedupe(batch: FlowPrint[]): FlowPrint[] {
  const seen = new Set<string>();
  return batch.filter(r => {
    const k = printId(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function mergePrints(prev: FlowPrint[], incoming: FlowPrint[], where: 'front' | 'back'): FlowPrint[] {
  const seen = new Set(prev.map(printId));
  const fresh = incoming.filter(r => {
    const k = printId(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return prev;
  /* a late print can land behind prints already in hand: the list is kept newest first by the fill's millisecond */
  const next = (where === 'front' ? fresh.concat(prev) : prev.concat(fresh)).sort((a, b) => msOf(b) - msOf(a));
  /* PAST THE CAP THE OLDEST GO, whichever end the batch joined (the re-audit, 2026-10-22: the 'back' branch kept the
     OLDEST 2,000 — the first fill walked back four pages and then cut the newest ~497 prints away, a hole from 16:48:26 to
     16:53:19 under a tooltip that promised an unbroken stretch). The list is newest first, so the newest contiguous
     stretch is its head. */
  return next.length > TAPE_CAP ? next.slice(0, TAPE_CAP) : next;
}

const msOf = (r: FlowPrint) => r.epochMs ?? (r.epoch ?? 0) * 1000;
function oldestMs(batch: FlowPrint[]): number {
  let c = 0;
  for (const r of batch) {
    const m = msOf(r);
    if (m > 0 && (c === 0 || m < c)) c = m;
  }
  return c;
}
function newestMs(batch: FlowPrint[]): number {
  let c = 0;
  for (const r of batch) c = Math.max(c, msOf(r));
  return c;
}

export interface PrintStream extends LivePack<FlowPrint[]> {
  pending: number;
  loadingOlder: boolean;
  hasOlder: boolean;
  flush: () => void;
  loadOlder: () => void;
}

/**
 * The market tape as one growing list, LOSSLESS inside the window it holds (the audit, 2026-10-22: second-wide cursors
 * and 300-print pages skipped whole seconds of a tape that prints 150–300 a second).
 *  - every cursor is the fill's millisecond, and each page asks one millisecond INTO the last page (`older_than` its
 *    oldest + 1, `newer_than` the newest − 1), so prints sharing a millisecond are never skipped; the overlap is
 *    dropped by the vendor's trade id;
 *  - a poll walks back page by page until it meets the newest print in hand; when it cannot within the buffer's cap,
 *    the buffer is REPLACED by the newest prints rather than left with a hole in the middle — what is held is always
 *    one unbroken stretch of the tape.
 */
export function usePrintStream(query: TapeQuery, hold: boolean, opts?: { untilMs?: number | null; keep?: (p: FlowPrint) => boolean }): PrintStream {
  /* AN ANCHOR IN THE PAST (the third audit, 2026-10-22: after the close the tape held only after-hours prints, "Window
     16:38:05–17:11:50 ET … all after hours" under a Regular session card, and the day's session could not be reached):
     with `untilMs` the stream walks back from that instant — the last regular-session stretch — and does not poll, since
     nothing newer belongs to it; `keep` drops the prints that do not (a stock's 16:00–16:15 extended prints) */
  const untilMs = opts?.untilMs ?? null;
  const keepRef = useRef(opts?.keep);
  keepRef.current = opts?.keep;
  const key = `${tapeQueryString(query)}|${untilMs ?? 'live'}`;
  const [rows, setRows] = useState<FlowPrint[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [pending, setPending] = useState<FlowPrint[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  /** the newest fill in hand (rows or held) — the next poll's floor */
  const newest = useRef(0);
  const rowsRef = useRef<FlowPrint[]>([]);
  rowsRef.current = rows;
  /** a held batch that could not be joined to the rows — on release it replaces them */
  const pendingGap = useRef(false);
  const filling = useRef(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;

  useEffect(() => {
    let stop = false;
    newest.current = 0;
    pendingGap.current = false;
    setRows([]);
    setPending([]);
    setHasOlder(true);
    setWaiting(true);
    setFault(null);
    /* a page's FULLNESS is the vendor's row count — a cancelled print dropped from a full page must not end the walk */
    const page = async (cursor: { newerThan?: number; olderThan?: number }): Promise<FlowPrint[] & { full?: boolean; oldest?: number }> => {
      const capped = untilMs && (!cursor.olderThan || cursor.olderThan > untilMs) ? { ...cursor, olderThan: untilMs } : cursor;
      const got = await getRows(`/option-trades?${tapeQueryString(query, { ...capped, limit: TAPE_PAGE })}`);
      if (stop) return [];
      const live = liveTrades(got);
      await ensureIndexLevels(live.map(tickerOfRow));
      const keep = keepRef.current;
      const mapped = live.map(tradeToPrint);
      const out: FlowPrint[] & { full?: boolean; oldest?: number } = keep ? mapped.filter(keep) : mapped;
      out.full = got.length >= TAPE_PAGE;
      let o = 0;
      for (const r of got) {
        const t = Date.parse(String(r.executed_at || ''));
        if (Number.isFinite(t) && (o === 0 || t < o)) o = t;
      }
      out.oldest = o;
      return out;
    };
    /** Everything newer than `sinceMs`, newest first; `joined` false when the walk stopped short of it */
    const newerThan = async (sinceMs: number): Promise<{ batch: FlowPrint[]; joined: boolean }> => {
      let acc: FlowPrint[] = [];
      let olderThan: number | undefined;
      for (let n = 0; n < GAP_PAGES && !stop; n++) {
        const got = await page({ newerThan: sinceMs > 0 ? sinceMs - 1 : undefined, olderThan });
        acc = dedupe(acc.concat(got));
        if (!got.full) return { batch: acc, joined: true };
        const next = (got.oldest || oldestMs(got)) + 1;
        if (!next || (olderThan != null && next >= olderThan)) break;
        olderThan = next;
      }
      return { batch: acc, joined: sinceMs <= 0 };
    };
    const boot = async () => {
      filling.current = true;
      try {
        const first = await page({});
        if (stop) return;
        let held = dedupe(first);
        newest.current = newestMs(held);
        setRows(held);
        setAt(Date.now());
        setFault(null);
        setWaiting(false);
        let more = !!first.full;
        setHasOlder(more);
        let cursorMs = first.oldest || oldestMs(held);
        for (let guard = 0; more && held.length < TAPE_CAP && !stop && guard < 12; guard++) {
          setLoadingOlder(true);
          const older = await page({ olderThan: cursorMs + 1 });
          if (stop) return;
          const before = held.length;
          held = mergePrints(held, older, 'back');
          /* the rows may have gained newer prints from the poll meanwhile — the older page joins under them, and the cap
             trims from the old end, never the new */
          setRows(prev => mergePrints(prev, older, 'back'));
          const nextCursor = older.oldest || cursorMs;
          if (!older.full || (held.length === before && nextCursor >= cursorMs)) {
            more = false;
            setHasOlder(false);
          }
          cursorMs = Math.min(cursorMs, nextCursor);
        }
        if (held.length >= TAPE_CAP) setHasOlder(true);
      } catch (e) {
        if (stop) return;
        setFault(vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed');
        setWaiting(false);
      } finally {
        filling.current = false;
        if (!stop) setLoadingOlder(false);
      }
    };
    void boot();
    let polling = false;
    const id = window.setInterval(async () => {
      if (untilMs || !newest.current || polling) return;
      polling = true;
      try {
        const { batch, joined } = await newerThan(newest.current - LATE_MS);
        if (stop || !batch.length) return;
        newest.current = Math.max(newest.current, newestMs(batch));
        if (holdRef.current) {
          if (!joined) pendingGap.current = true;
          setPending(prev => (joined ? mergePrints(prev, batch, 'front') : batch.slice(0, TAPE_CAP)));
        } else if (joined) {
          setRows(prev => mergePrints(prev, batch, 'front'));
        } else {
          setRows(batch.slice(0, TAPE_CAP));
          setHasOlder(true);
        }
        setAt(Date.now());
        setFault(null);
      } catch {
        /* a missed poll keeps the prints already in hand; the next one walks back to them */
      } finally {
        polling = false;
      }
    }, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // `key` is the query. `query` closes over the same fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const flush = useCallback(() => {
    setPending(held => {
      if (held.length) {
        if (pendingGap.current) {
          pendingGap.current = false;
          setRows(held.slice(0, TAPE_CAP));
          setHasOlder(true);
        } else setRows(prev => mergePrints(prev, held, 'front'));
      }
      return [];
    });
  }, []);

  const loadOlder = useCallback(() => {
    const oldest = oldestMs(rowsRef.current);
    if (filling.current || !oldest || loadingOlder || !hasOlder || rowsRef.current.length >= TAPE_CAP) return;
    setLoadingOlder(true);
    void getRows(`/option-trades?${tapeQueryString(query, { olderThan: oldest + 1, limit: TAPE_PAGE })}`)
      .then(async got => {
        const live = liveTrades(got);
        await ensureIndexLevels(live.map(tickerOfRow));
        const keep = keepRef.current;
        const mapped = live.map(tradeToPrint);
        const batch = keep ? mapped.filter(keep) : mapped;
        setRows(prev => mergePrints(prev, batch, 'back'));
        if (got.length < TAPE_PAGE) setHasOlder(false);
        setAt(Date.now());
      })
      .catch(() => setHasOlder(false))
      .finally(() => setLoadingOlder(false));
  }, [hasOlder, loadingOlder, query]);

  return {
    rows,
    at,
    fault,
    waiting: waiting && rows.length === 0,
    pending: pending.length,
    loadingOlder,
    hasOlder: hasOlder && rows.length < TAPE_CAP,
    flush,
    loadOlder,
  };
}

/** Print versus the quote. At or above the ask is a lift; at or below the bid is a hit. Null when NBBO is missing. */
function execOf(price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' | null {
  if (!(price > 0) || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  if (price >= ask - 1e-6) return 'ASK';
  if (price <= bid + 1e-6) return 'BID';
  return 'MID';
}

/* THE DARK-POOL READ, ONE RULE ACROSS TRACE (the re-audit, 2026-10-22: the page tagged prints over the mid at the ask
   "DISTRIBUTION" in red while the Live Tape counts at-the-ask as bought): a print ABOVE the mid was paid up for — the
   buyer crossed toward the offer, buyer-initiated — and reads ACCUMULATION (green); a print BELOW the mid was sold down
   — seller-initiated — and reads DISTRIBUTION (red); a print at the mid (within half a cent) leans neither way. Any
   distance from the mid counts: the Sized fact and the reads share one cut. Only a sized print, in the regular session,
   priced at the quote, carries a read. */
function intentOf(cents: number, sized: boolean): DarkPoolIntent {
  if (!sized) return 'ROTATION';
  if (cents > 0) return 'ACCUMULATION';
  if (cents < 0) return 'DISTRIBUTION';
  return 'HEDGE FLOW';
}

/** Where a dark print sat against the quote. Two decimals of percent is 0.00%
    on a fill a few cents through a tight spread, which is most of this tape. */
export function quotePlace(pct: number, price: number): { text: string; cents: number } {
  const cents = (pct / 100) * price * 100;
  /* a quarter cent, not a half (the third audit: NVDA $211.80 into 211.80 × 211.81 read "at the mid" beside "BID" — on a
     one-cent spread the bid IS half a cent under the mid) */
  if (!Number.isFinite(cents) || Math.abs(cents) < 0.25) return { text: 'at the mid', cents: 0 };
  if (Math.abs(pct) < 0.1) {
    const abs = Math.abs(cents);
    const n = abs >= 10 ? String(Math.round(abs)) : (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return { text: `${cents > 0 ? '+' : '−'}${n}¢`, cents };
  }
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`, cents };
}

/* WHERE A DARK PRINT IS REPORTED (the vendor's market_center): every off-exchange print is reported to a FINRA trade
   reporting facility, which is all the code says — the dark venue itself is not disclosed. A letter is not a venue. */
const FACILITY: Record<string, string> = { L: 'FINRA/Nasdaq TRF Carteret', '2': 'FINRA/Nasdaq TRF Chicago', N: 'FINRA/NYSE TRF', D: 'FINRA ADF', B: 'FINRA/Nasdaq TRF' };
const SPECIAL_WORD: Record<string, string> = {
  average_price_trade: 'average-price trade',
  contingent_trade: 'contingent trade',
  qualified_contingent_trade: 'qualified contingent trade',
  derivative_priced: 'derivative-priced trade',
  prior_reference_price: 'prior-reference-price trade',
  stopped_stock: 'stopped-stock trade',
};

export function darkPrint(row: Record<string, unknown>, i: number, spot = 0, kind: 'dark' | 'lit' = 'dark'): DarkPoolPrint {
  const price = num(row.price);
  const size = num(row.size);
  const notional = num(row.premium) || price * size;
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : spot;
  const vs = mid > 0 ? ((price - mid) / mid) * 100 : 0;
  /* A PRINT PRICED BY ITS OWN TERMS IS NOT A READ (the audit, 2026-10-22: QQQ 103,684 @ $725.39, 3% off the quote, an
     average-price trade, drove the tape's intent): contingent, qualified-contingent, derivative-priced and average-price
     prints — any sale condition or trade code — are shown, and never read for intent or posture */
  const codes = [row.sale_cond_codes, row.trade_code].flatMap(c => (Array.isArray(c) ? c : [c])).filter(c => c != null && c !== '').map(String);
  /* only the codes that price a trade by its own terms — an intermarket sweep or an odd lot is priced at the quote */
  const own = codes.filter(c => c in SPECIAL_WORD);
  const special = own.length ? [...new Set(own.map(c => SPECIAL_WORD[c]))].join(', ') : null;
  const sized = size >= 10_000 || notional >= 500_000;
  /* AFTER HOURS (the vendor's ext_hour_sold_codes "extended_hours_trade"): the quote it is set against is the thin
     post-market one, so the print is shown and labelled, never read */
  const extended = row.ext_hour_sold_codes != null && row.ext_hour_sold_codes !== '';
  const placeCents = quotePlace(vs, price).cents;
  const intent = special || extended ? 'ROTATION' : intentOf(placeCents, sized);
  /* an after-hours print's place in a thin post-market quote is shown in plain ink, never as a side (the third audit:
     after-hours BID red / ASK green) — `exec` still says where it sat, the page draws it neutral */
  const exec = special ? null : execOf(price, bid, ask);
  const when = clock(row.executed_at);
  /* the vendor's tracking_id is NOT unique — distinct prints (other sizes, other cumulative volumes) share one — so the
     id folds in the fields that tell them apart; stable across polls, so the accumulator still de-dupes repeats */
  const id = hashId(row.tracking_id != null ? `${row.tracking_id}-${row.executed_at}-${row.size}-${row.price}-${row.volume}` : `${row.ticker}-${row.executed_at}-${i}`);
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = special
    ? `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced by its terms, not the quote; no read.`
    : extended
      ? `After hours, ${where} of a post-market quote — no read.`
      : sized
        ? place.cents > 0
          ? `Size paid ${where} — buyer-initiated.`
          : place.cents < 0
            ? `Size sold ${where} — seller-initiated.`
            : 'Size crossed at the mid — neither side pressed.'
        : `Printed ${where} — too small to read.`;
  const center = String(row.market_center || '');
  return {
    id,
    time: when.time,
    ticker: String(row.ticker || '').toUpperCase(),
    price,
    size,
    notional,
    /* a lit print is an exchange's, never a FINRA facility's (the re-audit: the lit lane wore the dark wording) */
    venue: kind === 'lit' ? (center ? `exchange ${center}` : 'an exchange') : FACILITY[center] ?? (center ? `FINRA facility ${center}` : 'off-exchange'),
    vsSpotPct: vs,
    atLevel: false,
    sized: sized && !special,
    extended: extended || undefined,
    intent,
    conviction: 0,
    read,
    exec,
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    special,
    facility: kind === 'lit' ? undefined : FACILITY[center] ?? undefined,
    lit: kind === 'lit' || undefined,
  };
}

export function darkLevels(rows: Record<string, unknown>[], spot: number, prints: DarkPoolPrint[] = []): DarkPoolLevel[] {
  const buckets = rows.map(r => num(r.price)).filter(p => p > 0);
  /* THE SHELF'S PRINTS ARE COUNTED (the re-audit, 2026-10-22: every shelf read "1 print", a constant): each dark print in
     hand goes to its nearest price bucket — the route sends shares by price, not a count, so the count is the prints in
     hand, and says so */
  const count = new Map<number, number>();
  for (const p of prints) {
    let best = NaN;
    for (const b of buckets) if (!Number.isFinite(best) || Math.abs(b - p.price) < Math.abs(best - p.price)) best = b;
    if (Number.isFinite(best) && Math.abs(best - p.price) <= 1) count.set(best, (count.get(best) ?? 0) + 1);
  }
  const raw = rows
    .map(r => ({ price: num(r.price), notional: num(r.dark_pool_volume) * num(r.price) || num(r.dark_pool_volume), prints: count.get(num(r.price)) ?? 0 }))
    .filter(l => l.price > 0 && l.notional > 0)
    .sort((a, b) => b.notional - a.notional);
  const sum = raw.reduce((a, l) => a + l.notional, 0) || 1;
  /* A price level within a third of a percent of the market is the pivot.
     Anything further is support or resistance. The feed hands back its own
     price levels — not whole dollars: NVDA's ran 211, 211.75, 212, 212.75 —
     every one that printed. Two of each role is the shelf — the heaviest —
     not a fence of the same word, and A SHELF HAS WEIGHT AND IS NEAR (the
     third audit, 2026-10-22: a $24.0K level 5.7% under the market stood as
     one of two supports): at least SHELF_MIN_SHARE of the day's dark dollars,
     within SHELF_MAX_DIST of the market. */
  const SHELF_MIN_SHARE = 3;
  const SHELF_MAX_DIST = 5;
  const leveled = raw.map(l => {
    const dist = spot > 0 ? ((l.price - spot) / spot) * 100 : 0;
    const role: LevelRole = Math.abs(dist) <= 0.35 ? 'PIVOT' : dist < 0 ? 'SUPPORT' : 'RESISTANCE';
    return {
      price: l.price,
      notional: l.notional,
      prints: l.prints,
      sharePct: (l.notional / sum) * 100,
      role,
      distPct: dist,
      usage: role === 'SUPPORT' ? 'Rested under the market.' : role === 'RESISTANCE' ? 'Rested over the market.' : 'Rested at the market.',
    };
  });
  const take = (role: LevelRole) => leveled.filter(l => l.role === role && l.sharePct >= SHELF_MIN_SHARE && (!(spot > 0) || Math.abs(l.distPct) <= SHELF_MAX_DIST)).slice(0, 2);
  return [...take('SUPPORT'), ...take('RESISTANCE'), ...take('PIVOT')];
}

/** The posture of the sized, read prints — their dollars over the mid (bought up) against under it (sold down) */
export function postureOf(prints: DarkPoolPrint[]): { posture: Posture; net: number; note: string; read: number } {
  const read = prints.filter(p => p.sized && !p.extended && !p.special);
  const acc = read.reduce((a, p) => a + (p.intent === 'ACCUMULATION' ? p.notional : 0), 0);
  const dist = read.reduce((a, p) => a + (p.intent === 'DISTRIBUTION' ? p.notional : 0), 0);
  const all = read.reduce((a, p) => a + p.notional, 0);
  const net = all > 0 ? Math.round(((acc - dist) / all) * 100) : 0;
  const posture: Posture = net > 15 ? 'ACCUMULATING' : net < -15 ? 'DISTRIBUTING' : 'BALANCED';
  const after = prints.length > 0 && read.length === 0 && prints.some(p => p.extended);
  const note = after
    ? 'Every print in hand is after hours — set against a post-market quote, so none is read.'
    : posture === 'ACCUMULATING'
      ? 'Sized dollars lean over the mid — bought up, buyer-initiated.'
      : posture === 'DISTRIBUTING'
        ? 'Sized dollars lean under the mid — sold down, seller-initiated.'
        : read.length
          ? 'Sized dollars sit on both sides of the mid.'
          : 'No sized print in the regular session to read.';
  /* `read` — how many prints carried a read: none is "nothing to read", never "Balanced" (the third audit) */
  return { posture, net, note, read: read.length };
}

export function darkView(ticker: string, prints: DarkPoolPrint[], levels: DarkPoolLevel[], spot: number, dpSharePct = 0): DarkPoolView {
  const marked = prints.map(p => ({
    ...p,
    atLevel: levels.some(l => l.price > 0 && Math.abs(l.price - p.price) / l.price < 0.0015),
  }));
  const { posture, net, note } = postureOf(marked);
  const total = marked.reduce((a, p) => a + p.notional, 0);
  const largest = marked.reduce<DarkPoolPrint | null>((a, p) => (!a || p.notional > a.notional ? p : a), null);
  return {
    ticker,
    spot,
    dpSharePct,
    netPosturePct: net,
    posture,
    postureNote: note,
    totalNotional: total,
    levels,
    prints: marked,
    largest,
  };
}

const DARK_CAP = 2000;

function mergeDark(prev: DarkPoolPrint[], incoming: DarkPoolPrint[]): DarkPoolPrint[] {
  const seen = new Set(prev.map(r => r.id));
  const fresh = incoming.filter(r => !seen.has(r.id) && (seen.add(r.id), true));
  if (!fresh.length) return prev;
  const next = fresh.concat(prev);
  return next.length > DARK_CAP ? next.slice(0, DARK_CAP) : next;
}

/** Dark or lit prints, accumulating across polls. The recent route caps at 200 and has no older cursor. */
export function useAccumTape(kind: 'dark' | 'lit', limit: number): LivePack<DarkPoolPrint[]> {
  const path = kind === 'dark' ? `/darkpool/recent?limit=${Math.min(200, limit)}` : `/lit-flow/recent?limit=${Math.min(200, limit)}`;
  const [rows, setRows] = useState<DarkPoolPrint[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let stop = false;
    setRows([]);
    setWaiting(true);
    const run = async () => {
      try {
        const batch = (await getRows(path)).filter(r => !r.canceled).map((r, i) => darkPrint(r, i, 0, kind)); // a cancelled print never traded
        if (stop) return;
        setRows(prev => mergeDark(prev, batch));
        setAt(Date.now());
        setFault(null);
        setWaiting(false);
      } catch (e) {
        if (stop) return;
        setFault(vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed');
        setWaiting(false);
      }
    };
    void run();
    const id = window.setInterval(run, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [path, kind]);
  return { rows, at, fault, waiting: waiting && rows.length === 0 };
}

/** THE STOCK SESSION THAT HAS ENDED — a dark or lit print is an equity print, and the equity session closes at 16:00 —
    or null while it runs (09:30–16:00 on a session day) */
export function lastStockClose(at: Date = new Date()): { iso: string; closeMs: number; openMs: number } | null {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute;
  const d = new Date(p.year, p.month - 1, p.day);
  if (isTradingDay(d) && m >= SESSION_OPEN && m < 960) return null;
  if (!(isTradingDay(d) && m >= 960)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  return { iso: isoDate(d), closeMs: nyWallTime(d.getFullYear(), d.getMonth() + 1, d.getDate(), 16, 0), openMs: nyWallTime(d.getFullYear(), d.getMonth() + 1, d.getDate(), 9, 30) };
}

/* THE DAY'S REGULAR-SESSION CROSSES, AFTER THE CLOSE (the third audit, 2026-10-22: after the bell the market's dark tape
   was all "NO READ · AFTER HRS" — the recent feed is newest first and has no older cursor). The recent route can order
   a DAY by dollars: its largest crosses, walked down by max_premium (three pages of 200), the extended-hours ones left
   for the After hours view. What it holds is the day's LARGEST regular-session crosses, and the page says so. */
export function useDarkRegularDay(iso: string | null): LivePack<DarkPoolPrint[]> {
  /* a closed session does not change: read once (three pages), and again only to retry a read that failed — never on the
     4s poll, which would spend the key's three upstream slots on a fixed answer */
  const [box, setBox] = useState<{ key: string; rows: DarkPoolPrint[]; at: number | null; fault: FeedFault | null } | null>(null);
  useEffect(() => {
    if (!iso) return;
    let stop = false;
    let timer = 0;
    const run = async () => {
      try {
        const out: DarkPoolPrint[] = [];
        let max: number | null = null;
        for (let i = 0; i < 3; i++) {
          const got = await getRows(`/darkpool/recent?limit=200&date=${iso}&order_by=premium&order=desc${max != null ? `&max_premium=${max}` : ''}`);
          const live = got.filter(r => !r.canceled);
          out.push(...live.map((r, j) => darkPrint(r, out.length + j)).filter(p => !p.extended));
          if (got.length < 200) break;
          const last = num(got[got.length - 1].premium);
          if (!(last > 0) || (max != null && last >= max)) break;
          max = Math.floor(last);
        }
        if (stop) return;
        const seen = new Set<number>();
        const rows = out.filter(p => !seen.has(p.id) && (seen.add(p.id), true)).sort((a, b) => b.time.localeCompare(a.time));
        setBox({ key: iso, rows, at: Date.now(), fault: null });
      } catch (e) {
        if (stop) return;
        const fault = vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed';
        setBox(prev => (prev && prev.key === iso && prev.rows.length ? { ...prev, fault } : { key: iso, rows: [], at: null, fault }));
        timer = window.setTimeout(run, 20_000);
      }
    };
    void run();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [iso]);
  const mine = box && iso && box.key === iso ? box : null;
  return { rows: mine?.rows ?? [], at: mine?.at ?? null, fault: mine?.fault ?? null, waiting: !!iso && !mine };
}

/** A name's whole day off-exchange — /darkpool/{t}/price-levels: its dark shares by $1 price bucket. The day's dark
    dollars are the buckets' shares × their price (≈, to the bucket); the share is dark shares over the day's whole
    volume (/stock/{t}/quote) — the route's own "regular_volume" covers only part of the lit tape (GEV: 0.4M beside 2.2M). */
export interface DarkDay {
  darkShares: number;
  litShares: number;
  /** ≈, priced at each $1 bucket */
  darkDollars: number;
  /** Dark shares over the day's whole volume, 0–100; NaN when the day's volume is not to hand */
  sharePct: number;
}
function darkDayOf(levels: Record<string, unknown>[], dayVolume: number): DarkDay | null {
  let dark = 0;
  let lit = 0;
  let dollars = 0;
  for (const r of levels) {
    const d = num(r.dark_pool_volume);
    dark += d;
    lit += num(r.regular_volume);
    dollars += d * num(r.price);
  }
  return dark > 0 ? { darkShares: dark, litShares: lit, darkDollars: dollars, sharePct: dayVolume >= dark ? (dark / dayVolume) * 100 : NaN } : null;
}
async function dayVolumeOf(name: string): Promise<number> {
  try {
    const got = await uwCall(`/stock/${encodeURIComponent(name)}/quote`, true);
    const d = (got.data as { data?: { last_trade?: { vol?: unknown } } } | null)?.data ?? (got.data as { last_trade?: { vol?: unknown } } | null);
    return num((d as { last_trade?: { vol?: unknown } } | null)?.last_trade?.vol);
  } catch {
    return 0;
  }
}
export function useDarkDay(ticker: string | null): LivePack<DarkDay | null> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `dark-day:${name}` : 'dark-day:off',
    async () => {
      const [levels, vol] = await Promise.all([getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`), dayVolumeOf(name)]);
      return darkDayOf(levels, vol);
    },
    null,
    !!name
  );
}

export function useNameDark(ticker: string | null, untilMs: number | null = null): LivePack<{ view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null }> {
  const name = (ticker || '').trim().toUpperCase();
  /* with `untilMs` (the stock close, after the bell) the name's crosses are its regular session's, walked back from the
     close — its after-hours prints are the After hours view's */
  const cut = untilMs ? `&older_than=${untilMs}` : '';
  return useLive(
    name ? `name-dark:${name}:${untilMs ?? 'live'}` : 'name-dark:off',
    async () => {
      if (!name) return { view: null, lit: [] as DarkPoolPrint[], day: null };
      const [prints, levels, lit, dayVol] = await Promise.all([
        getRows(`/darkpool/${encodeURIComponent(name)}?limit=200${cut}`),
        getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`).catch(() => [] as Record<string, unknown>[]),
        getRows(`/lit-flow/${encodeURIComponent(name)}?limit=200${cut}`).catch(() => [] as Record<string, unknown>[]),
        dayVolumeOf(name),
      ]);
      const mapped = prints.filter(r => !r.canceled).map((r, i) => darkPrint(r, i));
      const spot = mapped[0]?.price || 0;
      const day = darkDayOf(levels, dayVol);
      return { view: darkView(name, mapped, darkLevels(levels, spot, mapped), spot, day && Number.isFinite(day.sharePct) ? day.sharePct : 0), lit: lit.filter(r => !r.canceled).map((r, i) => darkPrint(r, i, 0, 'lit')), day };
    },
    { view: null, lit: [], day: null },
    !!name
  );
}

function contractRow(row: Record<string, unknown>, i: number): BookContract {
  const ticker = String(row.ticker_symbol || row.underlying_symbol || row.ticker || '').toUpperCase();
  const expiryIso = String(row.expiry || '').slice(0, 10);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  /* an index's screener row carries no stock_price — the index level from its spot-exposure minutes (see indexLevel) */
  const spot = num(row.stock_price) || indexLevel(ticker);
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  const premium = num(row.premium);
  const ask = num(row.ask_side_volume);
  const bid = num(row.bid_side_volume);
  const mid = num(row.mid_volume) + num(row.no_side_volume);
  const when = clock(row.last_fill);
  const dte = dteOf(expiryIso);
  return {
    key: `${ticker}-${strike}-${right}-${dte}-${i}`,
    optionSymbol: row.option_symbol ? String(row.option_symbol) : undefined,
    ticker,
    sector: row.sector ? String(row.sector) : null,
    sectorColor: null,
    strike,
    right,
    expiry: expiryLabel(expiryIso),
    dte,
    spot,
    otmPct: otmOf(right, strike, spot, !(num(row.stock_price) > 0) && !!indexRoot(ticker)),
    last: num(row.close || row.avg_price),
    /* the fill against the contract's prior close (chain_prev_close) — `roc` is not a price change (TSLA 370C: roc 0.76
       beside a real +15.0%); no prior close (a new listing) is no change to state */
    chgPct: num(row.chain_prev_close) > 0 ? ((num(row.close || row.avg_price) - num(row.chain_prev_close)) / num(row.chain_prev_close)) * 100 : NaN,
    lastAt: when.time.slice(0, 5),
    lastAtMin: when.minute,
    volume,
    oi,
    deltaOI: num(row.open_interest) - num(row.prev_oi),
    deltaOIPct: num(row.prev_oi) > 0 ? ((oi - num(row.prev_oi)) / num(row.prev_oi)) * 100 : 0,
    premium,
    /* the screener sends no `iv` — only yesterday's and the change since (prev_iv + iv_change); reading `iv` alone put 0% on
       every row of the Screener */
    iv: (() => {
      const v = num(row.iv) || (row.prev_iv != null ? num(row.prev_iv) + num(row.iv_change) : 0);
      return v * 100; // always a fraction: a same-day contract's 5.31 is 531%, never 5%
    })(),
    ivChg: num(row.iv_change) * 100,
    volOverOI: oi > 0 ? volume / oi : 0,
    sweepPct: volume > 0 ? (num(row.sweep_volume) / volume) * 100 : 0,
    multiPct: volume > 0 ? (num(row.multileg_volume) / volume) * 100 : 0,
    floorPct: volume > 0 ? (num(row.floor_volume) / volume) * 100 : 0,
    askPct: ask + bid > 0 ? (ask / (ask + bid)) * 100 : 0,
    prevOI: num(row.prev_oi),
    prevVolume: 0,
    prevAvgFill: num(row.chain_prev_close),
    prevPremium: 0,
    prevAskPct: 0,
    oiStreak: num(row.days_of_oi_increases),
    volGtOiStreak: num(row.days_of_vol_greater_than_oi),
    /* the name's next report in sessions from the tape's day — only when it lands before this contract expires
       (the column was a dead row of dashes: the field was never read) */
    earnDays: (() => {
      const er = String(row.next_earnings_date || '').slice(0, 10);
      const session = tapeSessionIso();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(er) || er < session || (expiryIso && er > expiryIso)) return null;
      const at = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
      return sessionsBetween(at(session), at(er));
    })(),
    prevSpark: [],
    sideVol: { ask, bid, mid },
    expired: expiredAtBell(expiryIso),
    theta: row.theta != null && row.theta !== '' ? num(row.theta) : undefined,
    lastDay: when.ms > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(when.ms)) : undefined,
  };
}

/** A contract whose expiry was the tape's session (or before it) and whose bell has rung: it settled, it no longer
    stands (the re-audit, 2026-10-22: 64 of Footprints' 146 builds were Oct 22 contracts, read after the close as standing) */
export function expiredAtBell(expiryIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso)) return false;
  const session = tapeSessionIso();
  if (expiryIso < session) return true;
  if (expiryIso > session) return false;
  const p = nyParts(new Date());
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return today > session || p.hour * 60 + p.minute >= 960;
}

/** The contracts that still stand — the expired ones left out, and how many were */
export function standing<T extends { expired?: boolean }>(rows: T[]): { rows: T[]; expired: number } {
  const out = rows.filter(r => !r.expired);
  return { rows: out, expired: rows.length - out.length };
}

/** Hottest chains, plus the name on the desk so a one-name page is not an empty SPX book. */
export function useLiveBook(ticker?: string | null): LivePack<BookContract[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    `book:${name || 'mkt'}`,
    async () => {
      const market = getRows('/screener/option-contracts?limit=200&order=premium&order_direction=desc');
      const named = name
        ? getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(name)}&limit=80&order=premium&order_direction=desc`).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]);
      const [a, b] = await Promise.all([market, named]);
      await ensureIndexLevels(b.concat(a).map(tickerOfRow));
      const seen = new Set<string>();
      const out: BookContract[] = [];
      for (const row of b.concat(a)) {
        const mapped = contractRow(row, out.length);
        /* one contract once: the name's page and the market's page overlap, and the key carries the row's index, so it
           never caught the repeat — the same SPY 773 call sat on Footprints twice */
        const id = String(row.option_symbol || `${mapped.ticker}-${mapped.strike}-${mapped.right}-${mapped.expiry}`);
        if (!mapped.ticker || seen.has(id)) continue;
        seen.add(id);
        out.push(mapped);
      }
      return out;
    },
    []
  );
}

/** The screener's page — 200 contracts in the vendor's own order: by premium, or by volume for "most active" (it asked
    for premium and the page said "heaviest volume first", the audit 2026-10-22) */
export function useContracts(unusual: boolean, issue?: 'stock' | 'etf' | null, order: 'premium' | 'volume' = 'premium'): LivePack<BookContract[]> {
  const parts = ['limit=200', `order=${order}`, 'order_direction=desc'];
  if (unusual) parts.push('unusual=true');
  if (issue === 'stock') parts.push('issue_types[]=Common Stock');
  else if (issue === 'etf') parts.push('issue_types[]=ETF');
  const q = parts.join('&');
  return useLive(`contracts:${unusual ? 'u' : 'h'}:${issue ?? 'any'}:${order}`, async () => mapWithIndex(await getRows(`/screener/option-contracts?${q}`), contractRow), []);
}

export function useFlowAlerts(limit = 50): LivePack<FlowPrint[]> {
  return useLive(`alerts:${limit}`, async () => mapWithIndex(await getRows(`/option-trades/flow-alerts?limit=${limit}`), alertToPrint), []);
}

export function useAlertTrades(id: string | null): LivePack<FlowPrint[]> {
  return useLive(id ? `alert-trades:${id}` : 'alert-trades:off', async () => mapWithIndex(liveTrades(await getRows(`/option-trades/flow-alerts/${encodeURIComponent(id!)}`)), tradeToPrint), [], !!id);
}

/* No exchange / trade-code breakdown: /option-trades/exchange-breakdown is gated to the vendor's API Advanced plan
   (422 on this key, verified 2026-10-22 — docs/DATA_SOURCES.md), so the Live Tape no longer asks for it. */

/* THE VENDOR NAMES THE SHAPE (put_vertical_spread, put_diagonal_spread, time_butterfly, iron_condor…): each name maps to
   the shape it is — a diagonal is not "custom" (the audit, 2026-10-22), and a time butterfly is a calendar of three
   legs, never a butterfly. The vendor's own name rides along, spelled out, so the row says exactly what it was told. */
function spreadKind(strategy: string): SpreadKind {
  const s = strategy.toLowerCase();
  if (s.includes('time_butterfly') || s.includes('calendar')) return 'calendar';
  if (s.includes('diagonal')) return 'diagonal';
  if (s.includes('butterfly')) return 'butterfly';
  if (s.includes('condor')) return 'condor';
  if (s.includes('straddle')) return 'straddle';
  if (s.includes('strangle')) return 'strangle';
  if (s.includes('ratio') || s.includes('frontspread') || s.includes('backspread') || s.includes('ladder')) return 'ratio';
  if (s.includes('vertical')) return 'vertical';
  if (s.includes('risk_reversal')) return 'riskReversal';
  if (s.includes('synthetic')) return 'synthetic';
  return 'custom';
}
const shapeName = (strategy: string) => {
  const s = strategy.trim().toLowerCase();
  if (!s || s === 'other') return 'unnamed';
  return s.replace(/_/g, ' ');
};

function spreadLeg(leg: Record<string, unknown>, fallbackExpiry: string, structSize = 1): SpreadLeg {
  const expiryIso = String(leg.expiry || leg.expiration || fallbackExpiry || '').slice(0, 10);
  /* THE LEGS ROUTE (/option-trades/multi-leg/{id}/legs) speaks its own way: `side` is where the leg's PRINT sat (ask,
     bid, or "no"), `size` is the leg's contracts, and the strike is in thousandths (7780000 for 7780). The leg's
     direction is settled by resolveLegs against the structure's own net premium, never guessed here. */
  const occ = String(leg.option_symbol || '').match(/(\d{8})$/);
  const rawStrike = num(leg.strike);
  const contracts = num(leg.size) || structSize;
  return {
    side: null,
    ratio: Math.max(1, Math.round(contracts / Math.max(1, structSize))),
    contracts,
    strike: occ ? Number(occ[1]) / 1000 : rawStrike >= 100000 ? rawStrike / 1000 : rawStrike,
    right: String(leg.type || leg.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C',
    expiry: expiryLabel(expiryIso),
    dte: dteOf(expiryIso) || num(leg.dte),
    fill: num(leg.price || leg.fill || leg.avg_price),
    theta: leg.theta != null ? num(leg.theta) : undefined,
    occ: leg.option_symbol ? String(leg.option_symbol) : undefined,
    volume: leg.volume != null ? num(leg.volume) : undefined,
    oi: leg.open_interest != null ? num(leg.open_interest) : undefined,
    iv: leg.implied_volatility != null ? num(leg.implied_volatility) * 100 : undefined,
    bid: leg.nbbo_bid != null ? num(leg.nbbo_bid) : undefined,
    ask: leg.nbbo_ask != null ? num(leg.nbbo_ask) : undefined,
  };
}

/* WHICH WAY EACH LEG WENT (the audit, 2026-10-22: the card read "Buy ×1 93 put — · 0d @ $0.00" placeholders, and a leg
   printed on the bid of a structure paid for at the ask was read "sold"). A leg's print side is not its direction, so
   the directions are SETTLED BY THE MONEY: the combination of buys and sells whose fills add up to the structure's own
   net premium (Σ ±fill × contracts × 100 within 3%). The print sides are tried first; failing them, every combination;
   only one that fits — and only one — is taken. When nothing fits, or more than one does, the legs say no direction. */
function resolveLegs(raw: Record<string, unknown>[], structSize: number, netPremium: number): SpreadLeg[] {
  const base = raw.map(l => spreadLeg(l, '', structSize));
  if (!base.length || !Number.isFinite(netPremium) || netPremium === 0) return base;
  /* the route's leg `size` is the leg's contracts on most rows and its RATIO on some (a 2-lot fly's legs read 1 / 2 / 1);
     the money says which: both readings are tried */
  const readings: SpreadLeg[][] = [base];
  if (structSize > 1 && base.some(l => (l.contracts ?? 0) < structSize)) {
    readings.push(base.map(l => ({ ...l, contracts: (l.contracts ?? 1) * structSize, ratio: l.contracts ?? 1 })));
  }
  const tagged = raw.map(l => (String(l.side) === 'ask' ? 1 : String(l.side) === 'bid' ? -1 : 0));
  for (const legs of readings) {
    const fits = (dirs: number[]) => Math.abs(legs.reduce((a, l, i) => a + dirs[i] * l.fill * (l.contracts ?? 1) * 100, 0) - netPremium) <= Math.max(1, Math.abs(netPremium) * 0.03);
    let pick: number[] | null = !tagged.includes(0) && fits(tagged) ? tagged : null;
    if (!pick && legs.length <= 6) {
      const found: number[][] = [];
      for (let m = 0; m < 1 << legs.length; m++) {
        const dirs = legs.map((_, i) => (m & (1 << i) ? -1 : 1));
        if (fits(dirs)) found.push(dirs);
        if (found.length > 1) break;
      }
      if (found.length === 1) pick = found[0];
    }
    if (pick) return legs.map((l, i) => ({ ...l, side: pick![i] > 0 ? 'BUY' : 'SELL' }));
  }
  return base;
}

/** The position's theta in dollars a day: Σ ± theta × contracts × 100 over legs whose direction is settled; null when any
    is not (the vendor's net_theta mixes units — "−$8607.55/day" on a 5-lot SPX vertical risking $675) */
export function positionTheta(legs: SpreadLeg[]): number | null {
  if (!legs.length || legs.some(l => l.side == null || l.theta == null)) return null;
  return legs.reduce((a, l) => a + (l.side === 'BUY' ? 1 : -1) * (l.theta as number) * (l.contracts ?? 1) * 100, 0);
}

/** Profit and loss at expiry from settled legs on ONE expiry: the payoff is piecewise straight between strikes, so its
    extremes sit at a strike, at zero, or run off past the top strike (the slope there). */
export function payoffRange(legs: SpreadLeg[], netPremium: number): { maxLoss: number | 'uncapped'; maxProfit: number | 'uncapped' } | null {
  if (!legs.length || legs.some(l => l.side == null) || new Set(legs.map(l => l.expiry)).size !== 1) return null;
  const at = (S: number) =>
    legs.reduce((a, l) => {
      const intrinsic = l.right === 'C' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      return a + (l.side === 'BUY' ? 1 : -1) * intrinsic * (l.contracts ?? 1) * 100;
    }, 0) - netPremium;
  const strikes = [...new Set(legs.map(l => l.strike))].sort((x, y) => x - y);
  const pts = [0, ...strikes].map(at);
  const top = strikes[strikes.length - 1];
  const slope = at(top * 2 + 1) - at(top * 2);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  return {
    maxLoss: slope < -1e-9 ? 'uncapped' : Math.max(0, -Math.min(lo, at(top * 2))),
    maxProfit: slope > 1e-9 ? 'uncapped' : Math.max(0, Math.max(hi, at(top * 2))),
  };
}

/* ---- one structure, settled from its own legs ----------------------------------------------------------------------
   THE ROW IS THE LEGS' (the re-audit, 2026-10-22): the vendor's net_price is wrong on ratio'd shapes — SPX 7690/7720/7750
   read "10× · $12.57 credit" where the legs were S5/B10/S5 and the credit $2,350 on 5 flies, $4.70 a fly — and 45 of 159
   rows had |net_price| × size × 100 ≠ |net_premium|. The row's size is the number of UNITS (the GCD of its legs'
   contracts), its net is net_premium over units × 100, and its max loss and max profit are the expiry payoff of the
   legs as they were bought and sold — one function for the row, the card and the Tracker. Each structure's legs are read
   once (/option-trades/multi-leg/{id}/legs, two at a time beside the page's own calls) and kept. */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const legRaw = new Map<string, Record<string, unknown>[] | 'none'>();
const legFails = new Map<string, number>();
const legQueue: string[] = [];
const legQueued = new Set<string>();
let legBusy = 0;
const LEG_LANES = 2;
let legRev = 0;
const legListeners = new Set<() => void>();
const legNotify = () => {
  legRev++;
  for (const fn of legListeners) fn();
};
function pumpLegs() {
  while (legBusy < LEG_LANES && legQueue.length) {
    const id = legQueue.shift()!;
    legQueued.delete(id);
    if (legRaw.has(id)) continue;
    legBusy++;
    getRows(`/option-trades/multi-leg/${encodeURIComponent(id)}/legs`)
      .then(rows => legRaw.set(id, rows.length ? rows : 'none'))
      .catch(() => {
        const n = (legFails.get(id) ?? 0) + 1;
        legFails.set(id, n);
        if (n >= 3) legRaw.set(id, 'none');
      })
      .finally(() => {
        legBusy--;
        legNotify();
        pumpLegs();
      });
  }
}
/** Ask for these structures' legs, newest first; `front` puts them ahead of the queue (an opened card) */
function wantLegs(ids: string[], front = false) {
  const fresh = ids.filter(id => id && !legRaw.has(id) && !legQueued.has(id));
  if (front) {
    for (const id of ids) {
      const i = legQueue.indexOf(id);
      if (i >= 0) legQueue.splice(i, 1);
      legQueued.delete(id);
    }
    const now = ids.filter(id => id && !legRaw.has(id));
    for (const id of now) legQueued.add(id);
    legQueue.unshift(...now);
  } else {
    for (const id of fresh) legQueued.add(id);
    legQueue.push(...fresh);
  }
  pumpLegs();
}
function useLegRev(): number {
  const [rev, setRev] = useState(legRev);
  useEffect(() => {
    const fn = () => setRev(legRev);
    legListeners.add(fn);
    return () => {
      legListeners.delete(fn);
    };
  }, []);
  return rev;
}

/** The P&L at expiry of settled legs on one expiry, at underlying S, dollars */
export function payoffAt(legs: SpreadLeg[], netPremium: number): (S: number) => number {
  return (S: number) =>
    legs.reduce((a, l) => {
      const intrinsic = l.right === 'C' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      return a + (l.side === 'BUY' ? 1 : -1) * intrinsic * (l.contracts ?? 1) * 100;
    }, 0) - netPremium;
}

/* THE SHAPE'S CANONICAL SIGNS — used only when the vendor left the net out and no leg can be settled by the money: the
   magnitude of a vertical's, a straddle's, a 1:2:1 fly's or a one-wing-each condor's net is the same whichever way it
   went, so the row can still say what changed hands. The way (debit or credit) stays unknown. */
function canonicalDirs(kind: SpreadKind, legs: SpreadLeg[]): number[] | null {
  const n = legs.length;
  if (n === 2) return kind === 'straddle' || kind === 'strangle' ? [1, 1] : kind === 'ratio' || kind === 'custom' ? null : [1, -1];
  const strikes = legs.map(l => l.strike);
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  if (n === 3 && kind === 'butterfly' && new Set(legs.map(l => l.right)).size === 1 && new Set(strikes).size === 3) {
    const sorted = [...legs].sort((a, b) => a.strike - b.strike);
    const [w1, b, w2] = sorted.map(l => l.contracts ?? 1);
    if (w1 !== w2 || b !== 2 * w1) return null;
    return legs.map(l => (l.strike === lo || l.strike === hi ? 1 : -1));
  }
  /* a double calendar (two strikes, each on a near and a far expiry, one right, equal sizes): near one way, far the
     other — the net's size is the same whichever way it went */
  if (n === 4 && new Set(legs.map(l => l.right)).size === 1 && new Set(legs.map(l => l.expiry)).size === 2 && new Set(strikes).size === 2 && new Set(legs.map(l => l.contracts ?? 1)).size === 1) {
    const far = Math.max(...legs.map(l => l.dte));
    return legs.map(l => (l.dte === far ? 1 : -1));
  }
  if (n === 4 && (kind === 'condor' || kind === 'butterfly')) {
    if (strikes.filter(k => k === lo).length !== 1 || strikes.filter(k => k === hi).length !== 1) return null;
    if (new Set(legs.map(l => l.contracts ?? 1)).size !== 1) return null;
    return legs.map(l => (l.strike === lo || l.strike === hi ? 1 : -1));
  }
  return null;
}

const strikeWord = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(2));
/** "7650" / "7650–7675" */
function whereOf(at: { kind: 'below' | 'above' | 'strikes' | 'falls' | 'rises' | 'outside' | 'anywhere'; a?: number; b?: number }): string {
  if (at.kind === 'anywhere') return 'wherever it settles';
  if (at.kind === 'outside') return `at or below ${strikeWord(at.a!)} or at or above ${strikeWord(at.b!)}`;
  if (at.kind === 'below') return `below ${strikeWord(at.a!)}`;
  if (at.kind === 'above') return `above ${strikeWord(at.a!)}`;
  if (at.kind === 'falls') return 'the further it falls';
  if (at.kind === 'rises') return 'the further it rises';
  return at.a === at.b ? `at ${strikeWord(at.a!)}` : `between ${strikeWord(at.a!)} and ${strikeWord(at.b!)}`;
}

/* THE SENTENCE IS THE LEGS' (the re-audit, 2026-10-22: a fixed line per vendor shape called a SHORT fly "wings bought,
   body sold" and a condor that profits on a fall "collects if the name goes nowhere"). Said from the settled legs: what
   was bought and sold, the money, where the expiry payoff is best and worst, and which way it gains. */
export function describeStructure(legs: SpreadLeg[], netPremium: number, units: number): string {
  if (!legs.length) return '';
  if (legs.some(l => l.side == null)) return 'The record does not say which legs were bought and which were sold — no single set of buys and sells adds up to its net — so its risk is not drawn. Read the legs.';
  const word = (l: SpreadLeg) => `${l.contracts ?? 1} ${strikeWord(l.strike)} ${l.right === 'C' ? 'call' : 'put'}${(l.contracts ?? 1) === 1 ? '' : 's'}`;
  const bought = legs.filter(l => l.side === 'BUY').map(word);
  const sold = legs.filter(l => l.side === 'SELL').map(word);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const strikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const lo = strikes[0];
  const hi = strikes[strikes.length - 1];
  let lead = `${bought.length ? `Bought ${list(bought)}` : ''}${bought.length && sold.length ? '; ' : ''}${sold.length ? `${bought.length ? 'sold' : 'Sold'} ${list(sold)}` : ''}`;
  const one = new Set(legs.map(l => l.right)).size === 1 ? (legs[0].right === 'C' ? 'call' : 'put') : '';
  if (legs.length === 3 && one && strikes.length === 3) {
    const wingsBought = legs.filter(l => l.strike === lo || l.strike === hi).every(l => l.side === 'BUY');
    const bodySold = legs.filter(l => l.strike !== lo && l.strike !== hi).every(l => l.side === 'SELL');
    if (wingsBought && bodySold) lead = `A long ${one} butterfly — the ${strikeWord(lo)} and ${strikeWord(hi)} wings bought, the ${strikeWord(strikes[1])} body sold`;
    else if (!wingsBought && !bodySold && legs.filter(l => l.strike === lo || l.strike === hi).every(l => l.side === 'SELL')) lead = `A short ${one} butterfly — the ${strikeWord(lo)} and ${strikeWord(hi)} wings sold, the ${strikeWord(strikes[1])} body bought`;
  }
  /* THE MONEY IN WORDS, NEVER A SIGN TO DECODE (the third audit: "$3.90 credit … −$780" read as a loss) — "collected
     $3.90 a unit ($780 in all)", "paid $29.80 a unit" */
  const money = netPremium === 0 ? '' : ` — ${netPremium > 0 ? 'paid' : 'collected'} $${(Math.abs(netPremium) / (Math.max(1, units) * 100)).toFixed(2)}${units > 1 ? ` a unit on ${units} units (${usd(Math.abs(netPremium))} in all)` : ''}`;
  if (new Set(legs.map(l => l.expiry)).size !== 1) {
    return `${lead}${money}. Its legs run to different expiries, so what it is worth at the near one depends on the far leg's price then — no expiry payoff is drawn.`;
  }
  const pnl = payoffAt(legs, netPremium);
  const far = hi * 2 + 1;
  const deep = pnl(0);
  const atLo = pnl(lo);
  const atHi = pnl(hi);
  const top = pnl(far);
  const eps = Math.max(1, Math.abs(netPremium) * 0.001);
  const pts = strikes.map(k => ({ k, v: pnl(k) }));
  const best = Math.max(deep, top, ...pts.map(p => p.v));
  const worst = Math.min(deep, top, ...pts.map(p => p.v));
  const locate = (target: number): Parameters<typeof whereOf>[0] => {
    const hitDeep = Math.abs(deep - target) <= eps;
    const hitTop = Math.abs(top - target) <= eps;
    if (hitTop && Math.abs(atHi - target) > eps) return { kind: 'rises' };
    if (hitDeep && Math.abs(atLo - target) > eps) return { kind: 'falls' };
    if (hitDeep && hitTop) {
      /* flat at both ends: the low run of strikes that hit, and the high run — "below 7690 or above 7750" */
      let a = -1;
      while (a + 1 < pts.length && Math.abs(pts[a + 1].v - target) <= eps) a++;
      let b = pts.length;
      while (b - 1 > a && Math.abs(pts[b - 1].v - target) <= eps) b--;
      if (b <= a + 1) return { kind: 'anywhere' };
      return { kind: 'outside', a: pts[a].k, b: pts[b].k };
    }
    if (hitDeep && !hitTop) return { kind: 'below', a: pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k).pop() ?? lo };
    if (hitTop && !hitDeep) return { kind: 'above', a: pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k)[0] ?? hi };
    const at = pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k);
    return { kind: 'strikes', a: at[0] ?? lo, b: at[at.length - 1] ?? hi };
  };
  const bestAt = locate(best);
  const worstAt = locate(worst);
  const sign = (v: number) => (v >= 0 ? `+${usd(v)}` : usd(v));
  const bestWords = bestAt.kind === 'rises' || bestAt.kind === 'falls' ? `gains without a cap ${whereOf(bestAt)}` : `makes most (${sign(best)}) ${whereOf(bestAt)}`;
  const worstWords =
    worstAt.kind === 'rises' && deep < -eps
      ? `loses on a big move either way — without a cap on a rise, ${sign(deep)} if it went to zero`
      : worstAt.kind === 'rises' || worstAt.kind === 'falls'
        ? `loses without a cap ${whereOf(worstAt)}`
        : `loses most (${sign(worst)}) ${whereOf(worstAt)}`;
  /* the shape's own way first: a payoff that peaks inside its strikes is a bet on where it settles; one that troughs
     inside them pays on a move — but only on the side where the payoff past the wing is a GAIN (the third audit, 2026-10-22:
     S7655P / B7705P / B7705C / S7715C read "a move away, either way" while a rise to 7715 still lost 66% of its max loss).
     The payoff at the low wing, the high wing and the middle say which way it pays. */
  const pctOfLoss = (v: number) => (worst < 0 ? `${Math.round((Math.abs(v) / Math.abs(worst)) * 100)}% of the max loss` : '');
  const way = (() => {
    if (best > Math.max(deep, top) + eps) return `a bet that the name settles ${bestAt.kind === 'strikes' ? (bestAt.a === bestAt.b ? `near ${strikeWord(bestAt.a!)}` : whereOf(bestAt)) : `near ${strikeWord(lo)}`}`;
    if (worst < Math.min(deep, top) - eps) {
      const downPays = deep > eps;
      const upPays = top > eps;
      if (downPays && upPays) return 'a bet on a move away, either way';
      if (downPays) return `a bet on a fall — ${sign(deep)} at or below ${strikeWord(lo)}, while a rise to ${strikeWord(hi)} or beyond still loses ${usd(Math.abs(top))}${top < -eps ? ` (${pctOfLoss(top)})` : ''}`;
      if (upPays) return `a bet on a rise — ${sign(top)} at or above ${strikeWord(hi)}, while a fall to ${strikeWord(lo)} or below still loses ${usd(Math.abs(deep))}${deep < -eps ? ` (${pctOfLoss(deep)})` : ''}`;
      return `it loses wherever it settles at expiry — least on a ${deep > top ? 'fall' : 'rise'}`;
    }
    if (top > deep + eps) return 'it gains on a rise';
    if (deep > top + eps) return 'it gains on a fall';
    return 'its payoff is flat';
  })();
  return `${lead}${money}. At expiry it ${bestWords} and ${worstWords} — ${way}.`;
}

/* THE NAME IS THE LEGS' (the third audit, 2026-10-22: an "iron condor 7650/7675" was S7650C / S7650P / B7675C / B7675P —
   a call spread sold and a put spread bought, both bearish, $5.8K if it falls and −$4.2K if it rises; the vendor's
   shape label is kept beside it when the two disagree). Named only from settled legs on one expiry (or a two-leg
   calendar / diagonal); anything else keeps the vendor's name. */
export function nameFromLegs(legs: SpreadLeg[]): { name: string; kind: SpreadKind } | null {
  if (!legs.length || legs.some(l => l.side == null)) return null;
  const B = (l: SpreadLeg) => l.side === 'BUY';
  const by = (xs: SpreadLeg[]) => [...xs].sort((a, b) => a.strike - b.strike);
  const rw = (r: 'C' | 'P') => (r === 'C' ? 'call' : 'put');
  const eq = new Set(legs.map(l => l.contracts ?? 1)).size === 1;
  if (new Set(legs.map(l => l.expiry)).size > 1) {
    if (legs.length === 2 && legs[0].right === legs[1].right && B(legs[0]) !== B(legs[1])) return legs[0].strike === legs[1].strike ? { name: `${rw(legs[0].right)} calendar`, kind: 'calendar' } : { name: `${rw(legs[0].right)} diagonal`, kind: 'diagonal' };
    return null;
  }
  const calls = by(legs.filter(l => l.right === 'C'));
  const puts = by(legs.filter(l => l.right === 'P'));
  if (legs.length === 2) {
    if (calls.length === 2 || puts.length === 2) {
      const [a, b] = calls.length === 2 ? calls : puts;
      if (a.strike === b.strike || B(a) === B(b)) return null;
      if (!eq) return { name: `${rw(a.right)} ratio spread`, kind: 'ratio' };
      const bull = a.right === 'C' ? B(a) : !B(b);
      return { name: `${bull ? 'bull' : 'bear'} ${rw(a.right)} spread`, kind: 'vertical' };
    }
    const c = calls[0];
    const q = puts[0];
    if (B(c) === B(q)) return c.strike === q.strike ? { name: `${B(c) ? 'long' : 'short'} straddle`, kind: 'straddle' } : { name: `${B(c) ? 'long' : 'short'} strangle`, kind: 'strangle' };
    if (c.strike === q.strike) return { name: B(c) ? 'synthetic long' : 'synthetic short', kind: 'synthetic' };
    return { name: B(c) ? 'bullish risk reversal' : 'bearish risk reversal', kind: 'riskReversal' };
  }
  if (legs.length === 3 && (calls.length === 3 || puts.length === 3)) {
    const [a, m, b] = calls.length === 3 ? calls : puts;
    if (new Set([a.strike, m.strike, b.strike]).size !== 3 || B(a) !== B(b) || B(a) === B(m)) return null;
    const w = a.contracts ?? 1;
    if ((b.contracts ?? 1) !== w || (m.contracts ?? 1) !== 2 * w) return null;
    return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} butterfly${m.strike - a.strike !== b.strike - m.strike ? ' (uneven wings)' : ''}`, kind: 'butterfly' };
  }
  if (legs.length === 4 && calls.length === 2 && puts.length === 2 && eq) {
    const [cl, ch] = calls;
    const [pl, ph] = puts;
    if (cl.strike === ch.strike || pl.strike === ph.strike || B(cl) === B(ch) || B(pl) === B(ph)) return null;
    const callBull = B(cl);
    const putBull = !B(ph);
    const uneven = ph.strike - pl.strike !== ch.strike - cl.strike ? ' (uneven wings)' : '';
    if (ph.strike <= cl.strike && putBull !== callBull) {
      const short = putBull && !callBull;
      return ph.strike === cl.strike ? { name: `${short ? 'short' : 'long'} iron butterfly${uneven}`, kind: 'butterfly' } : { name: `${short ? 'short' : 'long'} iron condor${uneven}`, kind: 'condor' };
    }
    if (pl.strike === cl.strike && ph.strike === ch.strike && callBull !== putBull) return { name: callBull ? 'long box' : 'short box', kind: 'custom' };
    if (callBull === putBull) return { name: `${callBull ? 'bullish' : 'bearish'} call + put spreads`, kind: 'vertical' };
    return null;
  }
  if (legs.length === 4 && (calls.length === 4 || puts.length === 4) && eq) {
    const [a, b, c, d] = calls.length === 4 ? calls : puts;
    if (new Set([a.strike, b.strike, c.strike, d.strike]).size !== 4 || B(a) !== B(d) || B(b) !== B(c) || B(a) === B(b)) return null;
    return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} condor`, kind: 'condor' };
  }
  return null;
}

/** A double calendar is a shape whatever way it went: two strikes, each on a near and a far expiry, one right, equal
    sizes — named so even when its legs cannot be settled (the third audit: such rows read "Custom" and all dashes) */
function doubleCalendarOf(legs: SpreadLeg[]): { name: string; kind: SpreadKind } | null {
  if (legs.length !== 4 || new Set(legs.map(l => l.right)).size !== 1 || new Set(legs.map(l => l.expiry)).size !== 2 || new Set(legs.map(l => l.strike)).size !== 2) return null;
  if (new Set(legs.map(l => l.contracts ?? 1)).size !== 1) return null;
  return { name: `${legs[0].right === 'C' ? 'call' : 'put'} double calendar`, kind: 'calendar' };
}

/** The structure the row stands for, settled from its legs once they are in hand */
function settleSpread(t: SpreadTrade): SpreadTrade {
  const raw = legRaw.get(t.id);
  if (raw === undefined) return t.legsState === 'in' ? t : { ...t, legsState: 'pending' };
  if (raw === 'none') return { ...t, legsState: 'none' };
  const known = t.netKnown !== false && Number.isFinite(t.netPremium) && t.netPremium !== 0;
  let legs = known ? resolveLegs(raw, t.size, t.netPremium) : raw.map(l => spreadLeg(l, '', t.size));
  /* the route's leg size is the leg's contracts (the multi-leg row's `size` is its largest leg) */
  const units = Math.max(1, legs.reduce((g, l) => gcd(g, Math.round(l.contracts ?? 1)), 0));
  legs = legs.map(l => ({ ...l, ratio: Math.max(1, Math.round((l.contracts ?? units) / units)) }));
  const settled = legs.every(l => l.side != null);
  const oneExpiry = new Set(legs.map(l => l.expiry)).size === 1;
  const range = settled && known && oneExpiry ? payoffRange(legs, t.netPremium) : null;
  let netAbs: number | undefined;
  if (!known) {
    const dirs = canonicalDirs(t.kind, legs);
    if (dirs) netAbs = Math.abs(legs.reduce((a, l, i) => a + dirs[i] * l.fill * (l.contracts ?? 1) * 100, 0));
  }
  const ratioLabel = legs.length ? [...legs].sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right)).map(l => `${l.side === 'BUY' ? 'B' : l.side === 'SELL' ? 'S' : ''}${l.ratio}`).join('/') : undefined;
  /* every distinct strike the legs carry (the vendor's strikes list had 2 for a 4-leg structure) and the name the
     settled legs give it */
  const legStrikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const named = settled ? nameFromLegs(legs) : doubleCalendarOf(legs);
  const vendor = t.shapeOfVendor ?? t.shape;
  const sideTagged = raw.filter(l => String(l.side) === 'ask' || String(l.side) === 'bid').length;
  return {
    ...t,
    strikesLabel: legStrikes.length ? legStrikes.map(k => strikeWord(k)).join(' / ') : t.strikesLabel,
    shape: named ? named.name : t.shape,
    kind: named ? named.kind : t.kind,
    vendorShape: named && vendor !== 'unnamed' && !named.name.includes(vendor) ? vendor : undefined,
    legs,
    units,
    contracts: legs.reduce((a, l) => a + (l.contracts ?? 0), 0),
    ratioLabel,
    net: known ? t.netPremium / (units * 100) : 0,
    netAbs,
    maxLoss: range ? range.maxLoss : null,
    maxProfit: range ? range.maxProfit : null,
    riskNote: !settled ? 'unsettled' : !oneExpiry ? 'expiries' : !known ? 'no-net' : undefined,
    theta: positionTheta(legs) ?? NaN,
    /* WHAT THE LEGS' TAGS ACTUALLY SAY (the third audit: an SPX 7630/7640 card said "its legs print no side" while three
       of its four legs carried one): the count, and why a partial set cannot settle it */
    read: known
      ? describeStructure(legs, t.netPremium, units)
      : `The vendor left the net out${sideTagged === 0 ? ' and its legs print no side' : sideTagged < raw.length ? `, and only ${sideTagged} of its ${raw.length} legs print a side` : ''}, so which way it went is not known — a leg's print side is where it filled, not whether the structure was bought or sold.${netAbs != null ? ` Its legs net ${usd(netAbs)}${units > 1 ? ` (${units} units, $${(netAbs / (units * 100)).toFixed(2)} a unit)` : ''} either way — paid if it was bought, collected if it was sold.` : ' What it risks is not on the record. Read the legs.'}`,
    legsState: 'in',
  };
}

function spreadOf(row: Record<string, unknown>): SpreadTrade {
  const ticker = String(row.ticker || '').toUpperCase();
  const when = clock(row.executed_at);
  const strikes = Array.isArray(row.strikes) ? row.strikes.map(s => num(s)).filter(n => n > 0) : [];
  const size = num(row.size) || 1;
  const strategy = String(row.strategy || '');
  const kind = spreadKind(strategy);
  const netKnown = row.net_premium != null && row.net_premium !== '';
  const netPremium = netKnown ? num(row.net_premium) : 0;
  /* no legs on the row (txns is a count) — the legs come from the legs route; the row carries its strikes and its near
     expiry, the trade's own New York day plus its days to run */
  const dteAtTrade = num(row.min_dte);
  const tradeDay = when.epoch > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(when.epoch * 1000)) : '';
  const expiryIso = tradeDay ? new Date(Date.parse(`${tradeDay}T00:00:00Z`) + dteAtTrade * 86_400_000).toISOString().slice(0, 10) : '';
  return {
    id: String(row.id || `${ticker}-${when.epoch}-${strikes.join('-')}`),
    minute: when.minute,
    time: when.time,
    ticker,
    kind,
    shape: shapeName(strategy),
    shapeOfVendor: shapeName(strategy),
    strikesLabel: strikes.length ? strikes.join(' / ') : '—',
    expiry: expiryIso ? expiryLabel(expiryIso) : '—',
    dte: expiryIso ? dteOf(expiryIso) : dteAtTrade,
    /* the vendor's size is its LARGEST leg — the units come from the legs (settleSpread) */
    size,
    net: 0,
    netKnown,
    netPremium,
    /* the gross of every leg's money — the hover's "across every leg"; the net is netPremium */
    premium: num(row.total_premium),
    maxLoss: null,
    maxProfit: null,
    iv: num(row.avg_iv) * 100,
    delta: num(row.net_delta),
    theta: NaN,
    spot: num(row.underlying_price) || indexLevel(ticker),
    legs: [],
    legCount: num(row.leg_count) || undefined,
    legsState: 'pending',
  };
}

/** Rows with their legs settled as they land; the legs are asked for in the rows' order */
function useSettled(pack: LivePack<SpreadTrade[]>): LivePack<SpreadTrade[]> {
  const rev = useLegRev();
  useEffect(() => {
    wantLegs(pack.rows.map(t => t.id));
  }, [pack.rows]);
  const rows = useMemo(() => pack.rows.map(settleSpread), [pack.rows, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...pack, rows };
}

/** The newest structures, `limit` of them (the vendor's feed is newest first) */
export function useSpreads(limit = 80): LivePack<SpreadTrade[]> {
  return useSettled(useLive(`spreads:${limit}`, async () => mapWithIndex(await getRows(`/option-trades/multi-leg?limit=${limit}`), spreadOf), []));
}

/** One structure, settled from its own legs (the card) — read ahead of the page's queue */
export function useSpreadTrade(trade: SpreadTrade | null): { trade: SpreadTrade | null; waiting: boolean; failed: boolean } {
  const rev = useLegRev();
  const id = trade?.id ?? null;
  useEffect(() => {
    if (id) wantLegs([id], true);
  }, [id]);
  const out = useMemo(() => (trade ? settleSpread(trade) : null), [trade, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return { trade: out, waiting: !!id && out?.legsState === 'pending', failed: out?.legsState === 'none' };
}

export type TideKind = 'market' | 'sector' | 'etf';

export interface TidePoint {
  /** Unix seconds — the pane's chart stamps the point. */
  time: number;
  callPrem: number;
  putPrem: number;
  volume: number;
  price: number;
}

export function useTide(kind: TideKind, name: string): LivePack<TidePoint[]> {
  const path =
    kind === 'sector'
      ? `/market/${encodeURIComponent(name || 'Technology')}/sector-tide?interval_5m=false`
      : kind === 'etf'
        ? `/market/${encodeURIComponent(name || 'SPY')}/etf-tide?interval_5m=false`
        : '/market/market-tide?interval_5m=false';
  return useLive(`tide:${kind}:${name}`, async () => {
    return (await getRows(path)).filter(r => r.net_call_premium != null && r.net_put_premium != null).map(r => ({
      time: clock(r.timestamp || r.date).epoch,
      callPrem: num(r.net_call_premium),
      putPrem: num(r.net_put_premium),
      volume: Math.abs(num(r.net_volume)),
      price: num(r.close || r.price),
    })).filter(p => p.time > 0);
  }, []);
}

/** One expiry of a name's day — /stock/{t}/flow-per-expiry: premium and contracts by side */
export interface ExpiryFlow {
  expiry: string;
  dte: number;
  /** Net call premium: at the ask less on the bid */
  callNet: number;
  putNet: number;
  callVol: number;
  putVol: number;
  trades: number;
}
export function useFlowPerExpiry(ticker: string | null): LivePack<ExpiryFlow[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `fpe:${name}` : 'fpe:off',
    async () =>
      (await getRows(`/stock/${encodeURIComponent(name)}/flow-per-expiry`)).map(r => {
        const expiry = String(r.expiry || '').slice(0, 10);
        return {
          expiry,
          dte: dteOf(expiry),
          callNet: num(r.call_premium_ask_side) - num(r.call_premium_bid_side),
          putNet: num(r.put_premium_ask_side) - num(r.put_premium_bid_side),
          callVol: num(r.call_volume),
          putVol: num(r.put_volume),
          trades: num(r.call_trades) + num(r.put_trades),
        };
      }),
    [],
    !!name
  );
}

export interface TopNet {
  ticker: string;
  net: number;
  volume: number;
  count: number;
}

export function useTopNet(limit = 40): LivePack<TopNet[]> {
  return useLive(`top-net:${limit}`, async () => {
    return (await getRows(`/market/top-net-impact?limit=${limit}`)).map(r => ({
      ticker: String(r.ticker || '').toUpperCase(),
      net: num(r.net_premium),
      volume: num(r.volume),
      count: num(r.count) || 1,
    }));
  }, []);
}


/* ---- one name's session, minute by minute (the Intervals page) ---------------------------------------------- */

/** One minute of a name's options — /stock/{t}/net-prem-ticks: every expiry, contracts by side and net premium */
export interface NameMinute {
  /** Minutes since the bell */
  min: number;
  callVol: number;
  putVol: number;
  callAsk: number;
  callBid: number;
  putAsk: number;
  putBid: number;
  /** Net premium that minute: at the ask less on the bid */
  netCall: number;
  netPut: number;
}
export function useNameMinutes(ticker: string | null): LivePack<NameMinute[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `name-minutes:${name}` : 'name-minutes:off',
    async () =>
      (await getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`))
        .map(r => {
          const m = clock(r.tape_time).minute - 570;
          return {
            min: m,
            callVol: num(r.call_volume),
            putVol: num(r.put_volume),
            callAsk: num(r.call_volume_ask_side),
            callBid: num(r.call_volume_bid_side),
            putAsk: num(r.put_volume_ask_side),
            putBid: num(r.put_volume_bid_side),
            netCall: num(r.net_call_premium),
            netPut: num(r.net_put_premium),
          };
        })
        /* the regular session — to 16:15 for the index and ETF options that trade then (sessionEndMin) */
        .filter(r => r.min >= 0 && r.min < sessionEndMin(name) - SESSION_OPEN)
        .sort((a, b) => a.min - b.min),
    [],
    !!name
  );
}

/* ---- the net-flow pane's own minutes ------------------------------------------------------------------------------ */

export interface PaneFlowPoint {
  /** epoch seconds, on the minute */
  time: number;
  /** running net call premium since the open of the vendor's day */
  callPrem: number;
  /** running net put premium */
  putPrem: number;
  /** contracts that minute — gross for a name, |Δ net volume| for a cut */
  vol: number;
  /** the underlying's close that minute (0 when the vendor sends none) */
  price: number;
}

const minuteOf = (iso: unknown) => {
  const e = clock(iso).epoch;
  return e > 0 ? Math.floor(e / 60) * 60 : 0;
};

/** THE PANE'S LINES ARE THE VENDOR'S MINUTES (the ship pass, 2026-10-22): the pane drew a day spread from each
    contract's daily total through a hashed clip table — real end totals, an invented shape — and on Net Flow it was
    handed the WHOLE MARKET's tide under a single name's header. Now:
    - a name: /stock/{t}/net-prem-ticks (per-minute net call and put premium, every expiry) summed into the running
      line, priced by the name's own one-minute closes;
    - a cut: /net-flow/expiry (already running) — tide_type from the segment, moneyness from the card, expiration
      zero_dte for a same-day pane and weekly otherwise; a sector cut reads that sector's tide. */
export function usePaneFlow(opts: { ticker: string | null; seg: NetFlowSegment; mny: MoneynessKey; zeroDte: boolean; enabled: boolean }): LivePack<PaneFlowPoint[]> {
  const { ticker, seg, mny, zeroDte, enabled } = opts;
  const name = (ticker || '').trim().toUpperCase();
  const key = name ? `pane:${name}` : `pane:${seg}:${mny}:${zeroDte ? '0' : 'w'}`;
  return useLive(
    key,
    async () => {
      if (name) {
        const [ticks, bars] = await Promise.all([
          getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`),
          getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?limit=1000`).catch(() => [] as Record<string, unknown>[]),
        ]);
        const close = new Map<number, number>();
        for (const b of bars) close.set(minuteOf(b.start_time), num(b.close));
        let c = 0;
        let p = 0;
        let last = 0;
        const out: PaneFlowPoint[] = [];
        for (const r of [...ticks].sort((a, b) => minuteOf(a.tape_time) - minuteOf(b.tape_time))) {
          const t = minuteOf(r.tape_time);
          if (!t) continue;
          /* THE REGULAR SESSION, 09:30–16:00 New York (the audit, 2026-10-22: a name's pane opened at 07:30 under a
             "Regular" desk) — the running line starts at the bell; to 16:15 for the index and ETF options that trade then
             (the re-audit: SPY's line stopped at 16:00, +$6.90M of net puts against a day of +$17.27M) */
          const m = clock(r.tape_time).minute;
          if (m < SESSION_OPEN || m >= sessionEndMin(name)) continue;
          c += num(r.net_call_premium);
          p += num(r.net_put_premium);
          last = close.get(t) ?? last;
          out.push({ time: t, callPrem: c, putPrem: p, vol: num(r.call_volume) + num(r.put_volume), price: last });
        }
        return out;
      }
      if (seg.startsWith('sector:')) {
        const sector = seg.slice('sector:'.length);
        const rows = (await getRows(`/market/${encodeURIComponent(sector)}/sector-tide?interval_5m=false`)).filter(r => r.net_call_premium != null && r.net_put_premium != null);
        let prevVol = 0;
        return rows
          .map(r => {
            const nv = num(r.net_volume);
            const pt = { time: minuteOf(r.timestamp || r.date), callPrem: num(r.net_call_premium), putPrem: num(r.net_put_premium), vol: Math.abs(nv - prevVol), price: num(r.close || r.price) };
            prevVol = nv;
            return pt;
          })
          .filter(pt => pt.time > 0);
      }
      const tide = seg === 'stocks' ? 'equity_only' : seg === 'index-funds' ? 'etf_only' : seg === 'indexes' ? 'index_only' : 'all';
      const got = await getRows(`/net-flow/expiry?moneyness=${encodeURIComponent(mny)}&tide_type=${tide}&expiration=${zeroDte ? 'zero_dte' : 'weekly'}`);
      /* the series sits one level down: { data: [ { data: [minutes…], moneyness, tide_type } ] } */
      /* FUTURE MINUTES ARE NOT ZERO (the audit, 2026-10-22): the vendor hands all 390 of the session's minutes, the ones
         still to come with `net_call_premium: null` — read as 0 they drew a flat $0 line to 15:58 and the head took the
         last row's "$0". A minute with no figure is dropped, so the line ends at the last real minute. */
      const rows = got
        .flatMap(g => (Array.isArray(g.data) ? (g.data as Record<string, unknown>[]) : [g]))
        .filter(r => r.net_call_premium != null && r.net_put_premium != null);
      let prevVol = 0;
      return rows
        .map(r => {
          const nv = num(r.net_volume);
          const pt = { time: minuteOf(r.timestamp), callPrem: num(r.net_call_premium), putPrem: num(r.net_put_premium), vol: Math.abs(nv - prevVol), price: num(r.underlying_price) };
          prevVol = nv;
          return pt;
        })
        .filter(pt => pt.time > 0);
    },
    [],
    enabled
  );
}


/* ---- one name's biggest contracts today (the Live Tape's per-name answer) ------------------------------------------
   THE TAPE IS A WINDOW, THE QUESTION IS THE DAY (the retail pass, 2026-10-22: "biggest NVDA bets today" — the tape cut to
   NVDA covered 15:58–16:14 and named a $253.7K 220C, while the Screener held an $18.1M 215C). The screener for the one
   name, by the day's premium: every contract's whole day, heaviest first. */
export function useNameTopContracts(ticker: string | null, limit = 3): LivePack<BookContract[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `top-contracts:${name}:${limit}` : 'top-contracts:off',
    async () => mapWithIndex(await getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}&order=premium&order_direction=desc`), contractRow),
    [],
    !!name
  );
}

/* ---- a stock's whole day of one-minute bars, extended hours included (the cross card) --------------------------- */
export interface StockMinute {
  /** epoch seconds */
  time: number;
  close: number;
  /** New York minute of the day */
  minute: number;
  extended: boolean;
}
export function useStockMinutes(ticker: string | null): LivePack<StockMinute[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `stock-minutes:${name}` : 'stock-minutes:off',
    async () => {
      const day = tapeSessionIso();
      const rows = await getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?limit=1000`);
      return rows
        .map(r => {
          const c = clock(r.start_time || r.time || r.date);
          const nyDay = c.ms > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(c.ms)) : '';
          return { time: c.epoch, close: num(r.close), minute: c.minute, extended: c.minute < SESSION_OPEN || c.minute >= 960, day: nyDay };
        })
        .filter(r => r.time > 0 && r.close > 0 && r.day === day)
        .sort((a, b) => a.time - b.time)
        .map(({ day: _day, ...r }) => r);
    },
    [],
    !!name
  );
}

/* ---- a marked contract's own day (the Tracker) ----------------------------------------------------------------------
   THE TRACKER READS EACH MARK BY ITS OWN CONTRACT (the re-audit, 2026-10-22: a contract marked from the Screener read
   "off today's book" because the Tracker looked for it in another page's book) — /option-contract/{occ}/historic, its
   newest session: volume, open interest, last price, and the day's contracts by side. */
export interface ContractDayNow {
  iso: string;
  volume: number;
  oi: number;
  last: number;
  sideVol: { ask: number; bid: number; mid: number };
  premium: number;
}
const dayNowCache = new Map<string, { at: number; row: ContractDayNow | null }>();
export function useContractDays(occs: string[]): LivePack<Record<string, ContractDayNow | null>> {
  const list = [...new Set(occs.map(o => o.trim().toUpperCase()).filter(o => /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(o)))].sort().slice(0, 40);
  const key = list.join(',');
  return useLive(
    `contract-days:${key}`,
    async () => {
      const out: Record<string, ContractDayNow | null> = {};
      for (const occ of list) {
        const hit = dayNowCache.get(occ);
        if (hit && Date.now() - hit.at < 60_000) {
          out[occ] = hit.row;
          continue;
        }
        let row: ContractDayNow | null = null;
        try {
          const got = await uwCall(`/option-contract/${encodeURIComponent(occ)}/historic?limit=2`, true);
          const box = got.data as { chains?: unknown[]; data?: unknown[] } | null;
          const rows = (Array.isArray(box?.chains) ? box!.chains : Array.isArray(box?.data) ? box!.data : []) as Record<string, unknown>[];
          const newest = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          if (newest) {
            row = {
              iso: String(newest.date || '').slice(0, 10),
              volume: num(newest.volume),
              oi: num(newest.open_interest),
              last: num(newest.last_price),
              sideVol: { ask: num(newest.ask_volume), bid: num(newest.bid_volume), mid: num(newest.mid_volume) + num(newest.neutral_volume) },
              premium: num(newest.total_premium),
            };
          }
        } catch {
          row = hit?.row ?? null;
        }
        dayNowCache.set(occ, { at: Date.now(), row });
        out[occ] = row;
      }
      return out;
    },
    {},
    list.length > 0
  );
}

/* ---- what a mark is now, LIKE WITH LIKE (the Tracker) -------------------------------------------------------------
   THE THEN AND THE NOW FROM ONE SOURCE AND ONE FIELD (the third audit, 2026-10-22: NVDA 220C "Moved most +28.6%" was the
   screener's close, 0.14, against the contract's historic last, 0.18 — an after-hours fill; SPX 7700C read "Vol added
   −200" across two sources). A contract marked off a book row (the screener's) is read again off the screener's row for
   that exact contract — close against close, day volume against day volume, open interest against open interest. A
   marked print is read against the contract's newest real trade on the tape route — a fill against a fill, the trade's
   day volume against the print's. */
export interface MarkNow {
  /** The contract's screener row now (close, volume, open interest, sides) */
  book: BookContract | null;
  /** The contract's newest real trade (cancelled ones skipped) */
  trade: { fill: number; volume: number; oi: number; time: string; day: string; extended: boolean } | null;
}
const markNowCache = new Map<string, { at: number; v: MarkNow }>();
export function useMarkNow(marks: { key: string; kind: string; ticker: string; strike: number; right: 'C' | 'P'; expiry: string; occ?: string }[]): LivePack<Record<string, MarkNow>> {
  const list = marks.filter(m => m.kind === 'contract' || m.kind === 'print').slice(0, 40);
  const key = list.map(m => m.key).sort().join('|');
  return useLive(
    `mark-now:${key}`,
    async () => {
      const out: Record<string, MarkNow> = {};
      for (const m of list) {
        const hit = markNowCache.get(m.key);
        if (hit && Date.now() - hit.at < 60_000) {
          out[m.key] = hit.v;
          continue;
        }
        const occ = (m.occ || '').toUpperCase();
        const root = occ.match(/^([A-Z]{1,6})\d{6}[CP]\d{8}$/)?.[1] ?? m.ticker.toUpperCase();
        const em = m.expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const iso = em ? `${em[3]}-${em[1]}-${em[2]}` : m.expiry.slice(0, 10);
        const v: MarkNow = { book: null, trade: null };
        try {
          const q = `type=${m.right === 'C' ? 'call' : 'put'}&min_strike=${m.strike}&max_strike=${m.strike}&expiry_dates[]=${iso}&limit=10`;
          let rows = await getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(root)}&${q}`);
          if (!rows.length && root !== m.ticker.toUpperCase()) rows = await getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(m.ticker.toUpperCase())}&${q}`);
          await ensureIndexLevels(rows.map(tickerOfRow));
          const row = rows.find(r => !occ || String(r.option_symbol || '').toUpperCase() === occ) ?? rows[0];
          if (row) v.book = contractRow(row, 0);
        } catch {
          v.book = hit?.v.book ?? null;
        }
        if (m.kind === 'print' && occ) {
          try {
            const t = liveTrades(await getRows(`/option-contract/${encodeURIComponent(occ)}/flow?limit=5`))[0];
            if (t) {
              const p = tradeToPrint(t);
              v.trade = { fill: p.fill, volume: p.volume, oi: p.oi, time: p.time, day: p.epochMs ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(p.epochMs)) : '', extended: !!p.extended };
            }
          } catch {
            v.trade = hit?.v.trade ?? null;
          }
        }
        markNowCache.set(m.key, { at: Date.now(), v });
        out[m.key] = v;
      }
      return out;
    },
    {},
    list.length > 0
  );
}

/** The New York trading day an instant's tape belongs to (tapeSessionIso's rule, for any instant) */
export function sessionIsoAt(ms: number): string {
  const p = nyParts(new Date(ms));
  const d = new Date(p.year, p.month - 1, p.day);
  if (!(isTradingDay(d) && p.hour >= 4)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  return isoDate(d);
}

/** A contract's OCC symbol from its parts — "SPY", 763, P, "10/22/2026" → SPY261022P00763000; an index's weekly root
    (SPXW, NDXP…) is the caller's to pass */
export function occOf(root: string, strike: number, right: 'C' | 'P', expiry: string): string | null {
  const m = expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) ?? null;
  const iso = m ? `${m[3]}-${m[1]}-${m[2]}` : expiry.slice(0, 10);
  const d = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d || !(strike > 0) || !root) return null;
  return `${root.toUpperCase()}${d[1].slice(2)}${d[2]}${d[3]}${right}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}
