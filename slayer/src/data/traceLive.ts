/* Trace's live Unusual Whales reads, mapped onto the rows the pages draw. The browser calls /api/uw; nothing here talks
   to the simulator. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uwCall } from './whales';
import { peekQuote } from './liveQuote';
import { vendorFault, type FeedFault } from '../components/ui/liveRead';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import { isoDate, isTradingDay, sessionsBetween } from '../core/calendar';
import { nyParts, nyWallTime } from '../core/nyTime';
import type { MoneynessKey, NetFlowSegment, SpreadKind, SpreadLeg, SpreadTrade } from './flowBook';
import { leanOfSides, postureOfNet } from './traceLean';

export { dayLean, LEAN_EDGE, sideShares, type DayLean } from './traceLean';

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

/** A vendor field as a number; anything unreadable is 0 */
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const COUNT = new Intl.NumberFormat('en-US');
/** A count with thousands separators — the one formatter every Trace page uses */
export const fmtCount = (v: number): string => COUNT.format(v);

export function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return rowsOf((data as { data: unknown }).data);
  }
  /* one alert's trades come as { alert, has_more, trades: [...] } */
  if (data && typeof data === 'object' && Array.isArray((data as { trades?: unknown }).trades)) {
    return rowsOf((data as { trades: unknown }).trades);
  }
  return [];
}

/* The regular session is 09:30–16:00 New York for a stock's options and 09:30–16:15 for the index and ETF options that
   trade to 16:15. LATE_CLOSE is a fallback: a print's own extended_hours flag wins where it has one. */
const LATE_CLOSE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'XSP', 'RUT', 'RUTW', 'MRUT', 'VIX', 'VIXW', 'XND', 'DJX', 'OEX', 'XEO', 'SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'EEM', 'EFA', 'GLD', 'SLV', 'TLT', 'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'SMH', 'SOXX', 'SOXL', 'IBIT', 'KRE', 'KWEB', 'FXI', 'EWZ', 'EWY', 'UNG', 'UVXY', 'UVIX', 'HYG', 'LQD', 'GDX', 'XBI', 'USO', 'TQQQ', 'SQQQ']);
export const SESSION_OPEN = 570;
/** New York minute the regular session ends for this name's options */
export function sessionEndMin(ticker?: string | null): number {
  return ticker && LATE_CLOSE.has(ticker.toUpperCase()) ? 975 : 960;
}
/** "16:15 ET" or "16:00 ET" */
export const sessionEndLabel = (ticker?: string | null) => (sessionEndMin(ticker) === 975 ? '16:15 ET' : '16:00 ET');
export type SessionPhase = 'pre' | 'regular' | 'after' | 'closed';
/** Where New York's clock stands against the stock session (pre-market from 04:00, after hours to 20:00) */
export function sessionPhase(at: Date = new Date()): SessionPhase {
  const p = nyParts(at);
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return 'closed';
  const m = p.hour * 60 + p.minute;
  if (m >= 240 && m < 570) return 'pre';
  if (m >= 570 && m < 960) return 'regular';
  if (m >= 960 && m < 1200) return 'after';
  return 'closed';
}

/** 'late' is 16:00–16:15 on a session day: stock options have closed, the late-closing index and ETF options have not */
export type MarketPhase = SessionPhase | 'late';
export function marketPhase(at: Date = new Date()): MarketPhase {
  const ph = sessionPhase(at);
  if (ph !== 'after') return ph;
  const p = nyParts(at);
  return p.hour * 60 + p.minute < 975 ? 'late' : 'after';
}

/** The last session that has ended at `endMin` (New York minute) — its day, open and close — or null while it runs */
function lastCloseAt(at: Date, endMin: number): { iso: string; closeMs: number; openMs: number } | null {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute;
  const d = new Date(p.year, p.month - 1, p.day);
  if (isTradingDay(d) && m >= SESSION_OPEN && m < endMin) return null;
  if (!(isTradingDay(d) && m >= endMin)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  return { iso: isoDate(d), closeMs: nyWallTime(y, mo, da, Math.floor(endMin / 60), endMin % 60), openMs: nyWallTime(y, mo, da, 9, 30) };
}
/** The last options session that has ended (closing 16:15, the last options to close); null while one runs */
export const lastRegularClose = (at: Date = new Date()) => lastCloseAt(at, 975);
/** The last stock session that has ended (16:00) — dark and lit prints are equity prints; null while it runs */
export const lastStockClose = (at: Date = new Date()) => lastCloseAt(at, 960);

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
export const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;

export function nyIsoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
/** The New York calendar day of an instant, YYYY-MM-DD */
export function nyDateOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}
/** Newest first by the full instant, never by the time of day alone (two days' prints can share a clock) */
export const byNewest = (a: { epochMs?: number; time: string }, b: { epochMs?: number; time: string }) => (b.epochMs ?? 0) - (a.epochMs ?? 0) || b.time.localeCompare(a.time);

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

/** A 53-bit hash (cyrb53) — a 32-bit one collides about once in twenty 20,000-row buffers */
export function hashId(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function expiryLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** The options session an instant belongs to. The option tape has no pre-market, so a trading day becomes the session at
    the 09:30 open; before it (or on a closed day) the session is the last trading day. Every Trace date reads this. */
export function sessionIsoAt(ms: number): string {
  const p = nyParts(new Date(ms));
  const d = new Date(p.year, p.month - 1, p.day);
  const open = p.hour * 60 + p.minute >= SESSION_OPEN_MIN_ET;
  if (!(isTradingDay(d) && open)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  return isoDate(d);
}
const SESSION_OPEN_MIN_ET = 9 * 60 + 30;
export function tapeSessionIso(): string {
  return sessionIsoAt(Date.now());
}

/** Calendar days from a trade day (default the tape's session) to an expiry */
export function dteFrom(iso: string, fromIso: string = tapeSessionIso()): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const f = fromIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !f) return 0;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const from = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]));
  return Math.max(0, Math.round((day - from) / 86_400_000));
}
/** Days to expiry from the tape's session */
const dteOf = (iso: string): number => dteFrom(iso);

/* One read per key, shared: hooks asking the same key share one box and one poll, so a page opened after another
   draws its answer at once (stamped); one older than LIVE_KEEP_MS waits for a fresh read. */
interface LiveShared {
  box: CacheBox<unknown> | null;
  subs: Set<() => void>;
  timer: number | null;
  running: boolean;
  load: () => Promise<unknown>;
  empty: unknown;
}
const liveShared = new Map<string, LiveShared>();
const LIVE_KEEP_MS = 2 * 60_000;
function liveNotify(sh: LiveShared) {
  for (const fn of sh.subs) fn();
}
function liveRun(key: string) {
  const sh = liveShared.get(key);
  if (!sh || sh.running) return;
  sh.running = true;
  sh.load()
    .then(
      rows => {
        sh.box = { key, rows, at: Date.now(), fault: null };
      },
      e => {
        const fault = vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed';
        sh.box = sh.box && sh.box.key === key ? { ...sh.box, fault } : { key, rows: sh.empty, at: null, fault };
      }
    )
    .finally(() => {
      sh.running = false;
      liveNotify(sh);
    });
}
/* While any Trace page holds, no shared read polls again; a read already in flight still lands, and a card opened
   under the pause reads once. */
let holdsPaused = 0;
export function noteTraceHold(paused: boolean): void {
  holdsPaused = Math.max(0, holdsPaused + (paused ? 1 : -1));
}
export const traceHeld = () => holdsPaused > 0;

/* The poll follows the clock: a day read is read once after the session and held to the next (re-read pre-market,
   when the next day and OI arrive); a live read keeps moving slowly outside it. */
export type ReadKind = 'day' | 'live';
const SETTLE_MS = 5 * 60_000;
const PRE_POLL_MS = 120_000;
const QUIET_POLL_MS = 30_000;
/** In the session the book-like reads (the screener, a name's expiries, contract days) every 8s — they were 4s */
const READ_POLL_MS = 8_000;
export const tabHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
/** The ended session's close (ms) while the market stands closed after it — after 16:15, overnight, a weekend or a
    holiday; null in the session and in the pre-market */
export function heldCloseMs(at: Date = new Date()): number | null {
  const ph = marketPhase(at);
  if (ph !== 'after' && ph !== 'closed') return null;
  return lastRegularClose(at)?.closeMs ?? null;
}
/** A read stamped `atMs` of the ended session's figures: it stands until the next session (read after the close settled) */
export function heldFresh(atMs: number | null | undefined): boolean {
  const c = heldCloseMs();
  return c != null && atMs != null && atMs >= c + SETTLE_MS;
}
/** Is a read stamped `atMs` (null: never read) due again, on a beat of `pollMs`, for its kind */
export function readDue(atMs: number | null | undefined, pollMs: number, kind: ReadKind, faulted = false): boolean {
  if (atMs == null) return true;
  if (tabHidden()) return false;
  const age = Date.now() - atMs;
  if (faulted) return age >= Math.min(pollMs, 20_000) - 250;
  const ph = marketPhase();
  if (kind === 'day') {
    if (heldFresh(atMs)) return false;
    if (ph === 'pre') return age >= PRE_POLL_MS - 250;
  } else if (ph !== 'regular' && ph !== 'late') return age >= Math.max(pollMs, QUIET_POLL_MS) - 250;
  return age >= pollMs - 250;
}

export function useLive<T>(key: string, load: () => Promise<T>, empty: T, enabled = true, pollMs = READ_POLL_MS, kind: ReadKind = 'day'): LivePack<T> {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let sh = liveShared.get(key);
    if (!sh) {
      sh = { box: null, subs: new Set(), timer: null, running: false, load, empty };
      liveShared.set(key, sh);
    }
    const me = sh;
    me.load = load;
    me.empty = empty;
    /* an answer kept from an earlier page past its keep is not drawn as this page's — unless it is a closed session's
       day, which no longer changes (it stands until the next session) */
    if (!me.subs.size && me.box && (me.box.at == null || (Date.now() - me.box.at > LIVE_KEEP_MS && !(kind === 'day' && !me.box.fault && heldFresh(me.box.at))))) me.box = null;
    const fn = () => force(n => n + 1);
    me.subs.add(fn);
    if (me.timer == null) {
      const due = (first: boolean) => {
        const b = me.box;
        if (!b || b.at == null) return true;
        if (holdsPaused > 0) return false;
        /* a page opened on a box another page read a moment ago draws it, and asks again only past the short beat */
        return readDue(b.at, first ? Math.min(POLL_MS, pollMs) : pollMs, kind, !!b.fault);
      };
      if (due(true)) liveRun(key);
      me.timer = window.setInterval(() => {
        if (due(false)) liveRun(key);
        /* checked often, cheaply: the beat runs from the last answer, so a check on the poll's own period would skip one
           beat in two (a read that took 1.5s is 6.5s old at the next 8s tick) */
      }, Math.max(1_000, Math.min(pollMs / 4, 5_000)));
    }
    fn();
    return () => {
      me.subs.delete(fn);
      if (!me.subs.size && me.timer != null) {
        window.clearInterval(me.timer);
        me.timer = null;
      }
    };
    // `key` is the request. `load` closes over the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, pollMs, kind]);
  /* a new key never wears the old key's rows */
  const sh = enabled ? liveShared.get(key) : undefined;
  const kept = sh && sh.box && sh.box.key === key && (sh.subs.size > 0 || (sh.box.at != null && (Date.now() - sh.box.at <= LIVE_KEEP_MS || (kind === 'day' && !sh.box.fault && heldFresh(sh.box.at))))) ? sh.box : null;
  const mine = kept as CacheBox<T> | null;
  return { rows: mine?.rows ?? empty, at: mine?.at ?? null, fault: mine?.fault ?? null, waiting: enabled && !mine };
}

/** A read the reader asked for by scrolling — the key's low-priority lane, beside the pages' own reads, never ahead */
async function getRowsLow(path: string): Promise<Record<string, unknown>[]> {
  const got = await uwCall(path, false, true);
  if (got.error) {
    if (got.status === 422 || got.status === 403 || got.status === 404) return [];
    throw new Error(got.error);
  }
  return rowsOf(got.data);
}
async function getRows(path: string): Promise<Record<string, unknown>[]> {
  const got = await uwCall(path, true);
  if (got.error) {
    if (got.status === 422 || got.status === 403 || got.status === 404) return [];
    throw new Error(got.error);
  }
  return rowsOf(got.data);
}

/** The print's own side as the vendor tags it (ask_side / bid_side / mid_side), the side every Trace surface reads;
    the quote is the fallback only when the row carries no tag. */
/** A crossed quote, or a side quoted more than five minutes before the fill, gives no read whatever the tag says
    ("quote crossed · no read"). */
const STALE_QUOTE_MS = 5 * 60_000;
export function quoteNoReadOf(row: Record<string, unknown>, price: number, bid: number, ask: number, atMs: number): 'crossed' | 'stale' | null {
  if (!(price > 0)) return null;
  if (bid > 0 && ask > 0 && bid >= ask) return 'crossed';
  if (atMs > 0) {
    for (const k of ['nbbo_bid_time', 'nbbo_ask_time']) {
      const t = Date.parse(String(row[k] ?? ''));
      if (Number.isFinite(t) && atMs - t > STALE_QUOTE_MS) return 'stale';
    }
  }
  return null;
}
/** The words for a print whose quote gives no read */
export const quoteNoReadWords = (k: 'crossed' | 'stale') => (k === 'crossed' ? 'quote crossed · no read' : 'quote stale · no read');
export function sideOfTags(tags: unknown, price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' {
  const t = Array.isArray(tags) ? tags.map(String) : [];
  /* A tag the quote at the print contradicts loses to the quote: an "ask_side" fill at or under the bid was a sale.
     A fill a cent inside the spread keeps its tag. */
  /* a crossed quote (bid at or over the ask) says nothing about the side — no read (quoteNoReadOf) */
  if (price > 0 && bid > 0 && ask > 0 && bid >= ask) return 'MID';
  const quoted = price > 0 && bid > 0 && ask > bid;
  if (t.includes('ask_side')) return quoted && price <= bid + 1e-6 ? 'BID' : 'ASK';
  if (t.includes('bid_side')) return quoted && price >= ask - 1e-6 ? 'ASK' : 'BID';
  if (t.includes('mid_side') || t.includes('no_side')) return 'MID';
  return execOf(price, bid, ask) ?? 'MID';
}

/* The print's OPRA condition says what it was: ISOI a sweep; ML?T / TL?T and the ?ESL / ?ASL / ?FSL family legs of a
   multi-leg order. `multi_vol` is the contract's day, never this print's kind. */
/* Compression is not a bet: OPRA cbmo / mctp (and UW's `arbitrage` tag) are floor packages that net open interest
   down. Labelled, counted apart, and kept out of every directional total, crown and sentiment. */
const COMPRESSION_CODES = new Set(['cbmo', 'mctp']);
export function printCondition(row: Record<string, unknown>): { multi: boolean; sweep: boolean; floor: boolean; compression: boolean; cross: boolean } {
  const cond = String(row.upstream_condition_detail || '').toLowerCase();
  const flags = (Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')]).join(' ');
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    multi: /^(ml|tl)[aecf]t$|^[mt][aecf]sl$/.test(cond) || cond === 'cbmo' || /multi/i.test(flags),
    sweep: cond === 'isoi' || /sweep/i.test(flags),
    floor: /floor/i.test(flags) || /^(ml|tl)ft$|^[mt]fsl$/.test(cond),
    compression: COMPRESSION_CODES.has(cond) || tags.includes('arbitrage'),
    /* a cross trade (report_flags "cross_trade") is pre-arranged at one price: no side taken */
    cross: /cross_trade/i.test(flags),
  };
}

/** A cancelled print never traded; every option-trade route drops it here. */
export const liveTrades = (rows: Record<string, unknown>[]) => rows.filter(r => r.canceled !== true && r.canceled !== 'true');

/* The index level (SPX, NDX, XSP, RUT, VIX): index prints carry no underlying price, but the vendor's spot-exposure
   minutes carry the level; read at most every 30s, only for an index on screen. */
const INDEX_ROOT: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', NDX: 'NDX', NDXP: 'NDX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', VIXW: 'VIX', XND: 'XND', DJX: 'DJX', MRUT: 'MRUT' };
const indexLevels = new Map<string, { at: number; level: number }>();
const indexFrom = new Map<string, 'quote' | 'book'>();
const indexAsks = new Map<string, Promise<void>>();
export function indexRoot(ticker: string): string | null {
  return INDEX_ROOT[ticker.toUpperCase()] ?? null;
}
/** The newest index level we hold for this ticker's index, 0 when none */
export function indexLevel(ticker: string): number {
  const root = indexRoot(ticker);
  return root ? (indexLevels.get(root)?.level ?? 0) : 0;
}
/** A live index print. The quote wins over the book's last minute while it is fresh. */
export function noteIndex(ticker: string, level: number, at = Date.now()): void {
  const root = indexRoot(ticker) ?? ticker.toUpperCase();
  if (!INDEX_ROOT[root] || !(level > 0) || !(at > 0)) return;
  const had = indexLevels.get(root);
  if (had && indexFrom.get(root) === 'quote' && had.at > at) return;
  indexLevels.set(root, { at, level });
  indexFrom.set(root, 'quote');
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
    if (hit && indexFrom.get(root) === 'quote' && Date.now() - hit.at < 60_000) continue;
    if (hit && (Date.now() - hit.at < 30_000 || heldFresh(hit.at))) continue;
    /* a level in hand is used while the new one is asked for; only a root with no level holds its rows back */
    const waitFor = !hit;
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
          if (best && !(indexFrom.get(root) === 'quote' && Date.now() - (indexLevels.get(root)?.at ?? 0) < 60_000)) {
            indexLevels.set(root, { at: Date.now(), level: best.p });
            indexFrom.set(root, 'book');
          }
        } catch {
          /* no level: the moneyness reads "—" */
        } finally {
          indexAsks.delete(root);
        }
      })();
      indexAsks.set(root, job);
    }
    if (waitFor) jobs.push(job);
  }
  await Promise.all(jobs);
}
const tickerOfRow = (r: Record<string, unknown>) => String(r.underlying_symbol || r.ticker || r.ticker_symbol || '').toUpperCase();

/* One live spot per name, the newest of the live quote, the newest print's underlying price and the stock screener's
   close (read at most once a minute for names on the page): the vendor's stock state can sit frozen for hours. */
interface SeenSpot {
  spot: number;
  at: number;
}
const spotSeen = new Map<string, SeenSpot>();
const spotScreenAt = new Map<string, number>();
const spotAsks = new Map<string, Promise<void>>();
const SPOT_SCREEN_MS = 60_000;
/** Note a price for a name, stamped by when it printed — the newest wins */
export function noteSpot(ticker: string, spot: number, at: number): void {
  if (!ticker || !(spot > 0) || !(at > 0)) return;
  const t = ticker.toUpperCase();
  const had = spotSeen.get(t);
  if (!had || at >= had.at) spotSeen.set(t, { spot, at });
}
/** The newest live price we hold for a name, with its time; null when none (an index reads its level instead) */
export function liveSpotAt(ticker: string): SeenSpot | null {
  const t = (ticker || '').toUpperCase();
  if (!t || indexRoot(t)) return null;
  const seen = spotSeen.get(t) ?? null;
  const q = peekQuote(t);
  const quoted = q && q.spot > 0 ? { spot: q.spot, at: q.tapeAt } : null;
  if (seen && quoted) return quoted.at >= seen.at ? quoted : seen;
  return seen ?? quoted;
}
/** The newest live price for a name, 0 when none is in hand */
export const liveSpotOf = (ticker: string): number => liveSpotAt(ticker)?.spot ?? 0;
/** Read the names' live prices off the stock screener (sixty a call), at most once a minute a name. Waits only for names
    with no price at all; never throws. */
export async function ensureSpots(tickers: Iterable<string>): Promise<void> {
  const want: string[] = [];
  const waitFor: Promise<void>[] = [];
  for (const raw of new Set([...tickers].map(t => (t || '').toUpperCase()))) {
    if (!raw || indexRoot(raw) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(raw)) continue;
    const pending = spotAsks.get(raw);
    if (pending) {
      if (!spotSeen.has(raw)) waitFor.push(pending);
      continue;
    }
    if (Date.now() - (spotScreenAt.get(raw) ?? 0) < SPOT_SCREEN_MS || (spotSeen.has(raw) && heldFresh(spotScreenAt.get(raw)))) continue;
    want.push(raw);
  }
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of want) {
    if (cur.length && len + t.length + 1 > 300) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(t);
    len += t.length + 1;
  }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const job = (async () => {
      try {
        const got = await uwCall(`/screener/stocks?ticker=${chunk.join(',')}`, true);
        const readAt = Date.now();
        for (const r of got.error ? [] : rowsOf(got.data)) {
          const t = String(r.ticker ?? '').toUpperCase();
          const close = num(r.close);
          /* the screener row carries no clock of its own: stamped a little before the read, so a print seen since wins */
          if (t && close > 0) noteSpot(t, close, readAt - 5_000);
        }
      } catch {
        /* no price: the row keeps its own */
      } finally {
        for (const t of chunk) {
          spotScreenAt.set(t, Date.now());
          spotAsks.delete(t);
        }
      }
    })();
    for (const t of chunk) spotAsks.set(t, job);
    if (chunk.some(t => !spotSeen.has(t) && !peekQuote(t))) waitFor.push(job);
  }
  /* never holds a page's first read long: past SPOT_WAIT_MS the rows map with what is in hand, and the next poll (4s)
     carries the live prices once they land */
  if (waitFor.length) await Promise.race([Promise.all(waitFor), new Promise(r => setTimeout(r, SPOT_WAIT_MS))]);
}
const SPOT_WAIT_MS = 2_000;

/* A whole-point level is too coarse for a distance on a small index (a point is 5% of VIX), so none is stated there;
   SPX, NDX and RUT keep theirs, marked "≈". */
export function otmOf(right: 'C' | 'P', strike: number, spot: number, fromIndex: boolean): number {
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
  /* the print's own underlying price is the name's price at that instant — the live spot hears it (noteSpot) */
  if (num(row.underlying_price) > 0 && when.ms > 0) noteSpot(ticker, num(row.underlying_price), when.ms);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  /* (a flow alert's side is its money's split, not one quote — the check is a print's) */
  const quoteNoRead = row.__aggregate ? null : quoteNoReadOf(row, fill, bid, ask, when.ms);
  /* a cross takes no side on the screen, so no read */
  const crossPrint = /cross_trade/i.test(Array.isArray(row.report_flags) ? row.report_flags.join(' ') : String(row.report_flags || ''));
  const side = quoteNoRead || crossPrint ? 'MID' : sideOfTags(row.tags, fill, bid, ask);
  /* the vendor's flag, else the clock: a fill outside the name's regular session (09:30 to 16:00, 16:15 for the index
     and ETF options) is an extended-hours print whether or not it came flagged (a hive call at 17:11:50 did not) */
  /* By the print, not the wall clock: between 16:00 and 16:15 the vendor's own flag decides; before 09:30 and from
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
  /* the contract's day by side (the vendor's ask_vol / bid_vol / mid_vol sum to its volume) — the row's day lean */
  const askVol = num(row.ask_vol);
  const bidVol = num(row.bid_vol);
  const volSum = askVol + bidVol;
  const { multi, sweep, compression, cross } = printCondition(row);
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
    /* days to run from the print's own trade date (the vendor's dte where the row carries one), never the clock's */
    dte: row.dte != null && row.dte !== '' && Number.isFinite(Number(row.dte)) ? Math.max(0, Number(row.dte)) : dteFrom(expiryIso, when.ms > 0 ? nyDateOf(when.ms) : tapeSessionIso()),
    fill,
    bid,
    ask,
    fillPos,
    side,
    ratioBidPct: volSum > 0 ? Math.round((bidVol / volSum) * 100) : NaN,
    size,
    nbboBidSize: row.nbbo_bid_size != null && row.nbbo_bid_size !== '' ? num(row.nbbo_bid_size) : undefined,
    nbboAskSize: row.nbbo_ask_size != null && row.nbbo_ask_size !== '' ? num(row.nbbo_ask_size) : undefined,
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
    cross: cross || undefined,
    quoteNoRead: quoteNoRead ?? undefined,
  };
}

/* A flow alert is an aggregate (`trade_count` prints on one contract in a window): its side is the one that carried
   60% or more of its money, else mid; its quote is `bid` / `ask` and its last fill `price`. */
function alertToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const askPrem = num(row.total_ask_side_prem);
  const bidPrem = num(row.total_bid_side_prem);
  const sided = askPrem + bidPrem;
  const total = num(row.total_premium);
  /* the alert's side is the one lean rule over its premium by side, the unsided rest as mid */
  const whole = Math.max(total, sided);
  const lean = leanOfSides({ ask: askPrem, bid: bidPrem, mid: Math.max(0, whole - sided) }).lean;
  const side: 'ASK' | 'BID' | 'MID' = lean === 'ASK' ? 'ASK' : lean === 'BID' ? 'BID' : 'MID';
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
      /* start_time … end_time is the window the alert's prints filled in; created_at is only its filing */
      executed_at: row.start_time ?? row.end_time ?? row.created_at,
      underlying_price: row.underlying_price,
      option_type: row.type ?? row.option_type,
      option_chain_id: row.option_chain,
      implied_volatility: row.iv ?? row.iv_end ?? row.iv_start,
      flow_alert_id: row.id,
      upstream_condition_detail: '',
      report_flags: [],
      __aggregate: true,
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
    ratioBidPct: whole > 0 ? Math.round((bidPrem / whole) * 100) : NaN,
    alertSides: { ask: askPrem, bid: bidPrem, other: Math.max(0, total - sided) },
    alertRule: row.alert_rule ? String(row.alert_rule) : undefined,
    /* the alert's filing instant — the route's older_than cursor (the endless lists) */
    createdMs: row.created_at != null && Number.isFinite(Date.parse(String(row.created_at))) ? Date.parse(String(row.created_at)) : undefined,
    fillEnd: row.end_time != null && row.start_time != null && num(row.end_time) - num(row.start_time) >= 1000 ? clock(row.end_time).time : undefined,
    /* an alert carries no session flag of its own: its fill time says it */
    extended: (() => {
      const m = clock(row.start_time ?? row.created_at).minute;
      return m > 0 && (m < SESSION_OPEN || m >= sessionEndMin(base.ticker)) ? true : undefined;
    })(),
  };
}

/** A floor package filed as alerts: no-side alerts on one root whose fills started in the same millisecond, known by
    shape since the route carries no floor flag. */
export function markAlertPackages(rows: FlowPrint[]): FlowPrint[] {
  const rootOf = (p: FlowPrint) => (indexRoot(p.ticker) ?? p.ticker).toUpperCase();
  const by = new Map<string, Set<string>>();
  for (const p of rows) {
    if (p.side !== 'MID' || !p.epochMs) continue;
    const k = `${rootOf(p)}|${p.epochMs}`;
    const set = by.get(k) ?? new Set<string>();
    set.add(`${p.strike}${p.right}${p.expiry}`);
    by.set(k, set);
  }
  return rows.map(p => (p.side === 'MID' && p.epochMs && (by.get(`${rootOf(p)}|${p.epochMs}`)?.size ?? 0) > 1 ? { ...p, floorPackage: true } : p));
}

/** Rows mapped once the index levels they need are in hand (an index print carries no underlying price) */
async function mapWithIndex<T>(rows: Record<string, unknown>[], fn: (r: Record<string, unknown>, i: number) => T): Promise<T[]> {
  await ensureIndexLevels(rows.map(tickerOfRow));
  return rows.map(fn);
}
/** Screener rows mapped once their names' live prices are in hand too — the row's stock_price is the stalled state */
async function mapBook(rows: Record<string, unknown>[]): Promise<BookContract[]> {
  const names = rows.map(tickerOfRow);
  await Promise.all([ensureIndexLevels(names), ensureSpots(names)]);
  return rows.map(contractRow);
}

export function useOptionTape(limit = 200): LivePack<FlowPrint[]> {
  return useLive(`tape:${limit}`, async () => mapWithIndex(liveTrades(await getRows(`/option-trades?limit=${limit}`)), tradeToPrint), [], true, POLL_MS, 'live');
}

/* One name's tape and structures, via the vendor's ticker_symbol filter: the market-wide windows after the close are
   almost all index prints. */
export function useNameTape(ticker: string | null, limit = 200): LivePack<FlowPrint[]> {
  const name = (ticker || '').trim().toUpperCase();
  const pack = useLive(name ? `tape:${name}:${limit}` : 'tape:name:off', async () => mapWithIndex(liveTrades(await getRows(`/option-trades?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}`)), tradeToPrint), [], !!name);
  useEffect(() => {
    if (pack.rows.length) publishPrints(pack.rows);
  }, [pack.rows]);
  return pack;
}

/** One name's structures on the session: the vendor's newest `limit` a page, paged back to the session's start (at
    most `pages`); `complete` says it got there. Legs are read only for the heaviest `legsFor` by net. */
export interface NameSpreads extends LivePack<SpreadTrade[]> {
  session: string;
  complete: boolean;
  from: string | null;
}
export function useNameSpreads(ticker: string | null, limit = 80, pages = 3, legsFor = 12): NameSpreads {
  const name = (ticker || '').trim().toUpperCase();
  const session = tapeSessionIso();
  const pack = useLive(
    name ? `spreads:${name}:${limit}:${pages}:${session}` : 'spreads:name:off',
    async () => {
      const all: Record<string, unknown>[] = [];
      let older = '';
      let complete = false;
      for (let i = 0; i < pages; i++) {
        const page = await getRows(`/option-trades/multi-leg?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}${older ? `&older_than=${encodeURIComponent(older)}` : ''}`);
        all.push(...page);
        const oldest = page.reduce<string>((m, r) => (typeof r.executed_at === 'string' && (!m || r.executed_at < m) ? r.executed_at : m), '');
        if (page.length < limit || !oldest || nyDateOf(Date.parse(oldest)) < session) {
          complete = true;
          break;
        }
        /* inclusive of the oldest's whole second, the overlap dropped by id (dedupeSpreads) */
        older = new Date(Date.parse(oldest) + 1000).toISOString();
      }
      const rows = dedupeSpreads(all)
        .map(r => ({ ...spreadOf(r), repeats: num(r.__repeats) || undefined }))
        .filter(t => t.day === session);
      return { rows, complete };
    },
    { rows: [] as SpreadTrade[], complete: false },
    !!name,
    /* up to three pages a read, every half minute */
    30_000
  );
  const rev = useLegRev();
  const raw = pack.rows.rows;
  useLegAsker(useMemo(() => [...raw].sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium)).slice(0, legsFor).map(t => t.id), [raw, legsFor]), 1);
  const rows = useMemo(() => raw.map(settleSpread), [raw, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = raw.length ? raw.reduce((m, t) => ((t.epochMs ?? Infinity) < (m.epochMs ?? Infinity) ? t : m), raw[0]).time : null;
  return { rows, at: pack.at, fault: pack.fault, waiting: pack.waiting, session, complete: pack.rows.complete, from };
}

/** One contract's real last trade (/option-contract/{occ}/flow): the card anchors on it. */
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
  /** The contract's day volume as of this print (the vendor's running `volume`) */
  volume?: number;
}
/** The latest regular-session print: after the close, the contract's prints walked back from 16:15; in the session,
    its newest prints, the first regular one taken. */
export function useContractLast(occ: string | null | undefined): LivePack<ContractLast | null> {
  const sym = (occ || '').trim().toUpperCase();
  const closed = lastRegularClose();
  return useLive(
    sym ? `last:${sym}:${closed?.closeMs ?? 'live'}` : 'last:off',
    async () => {
      /* a few back, so a cancelled newest print gives way to the real last trade */
      const got = closed
        ? await getRows(`/option-trades?option_contracts[]=${encodeURIComponent(sym)}&older_than=${closed.closeMs}&limit=20`)
        : await getRows(`/option-contract/${encodeURIComponent(sym)}/flow?limit=20`);
      const rows = liveTrades(got);
      const r = rows.find(x => !extendedOf(x)) ?? rows[0];
      if (!r) return null;
      const noRead = quoteNoReadOf(r, num(r.price), num(r.nbbo_bid), num(r.nbbo_ask), Date.parse(String(r.executed_at ?? '')));
      const side = noRead ? 'MID' : sideOfTags(r.tags, num(r.price), num(r.nbbo_bid), num(r.nbbo_ask));
      const { multi, sweep } = printCondition(r);
      return { size: num(r.size), fill: num(r.price), side, time: clock(r.executed_at).time, bid: num(r.nbbo_bid), ask: num(r.nbbo_ask), premium: num(r.premium), multi, sweep, extended: extendedOf(r), theta: r.theta != null && r.theta !== '' ? num(r.theta) : undefined, volume: num(r.volume) || undefined };
    },
    null,
    !!sym
  );
}

/* The tape opens on its newest BOOT_FILL prints and pages older ones in on scroll, to the session's start, held to
   TAPE_CAP */
/* Past TAPE_CAP, scrolling older lets the newest go (the far end from the reader), said in the foot with a way back */
const TAPE_CAP = 20_000;
const BOOT_FILL = 2_000;
/** The route's largest page (the spec: limit max 500) */
const TAPE_PAGE = 500;
/** Pages one poll may walk back to close the gap to the newest print in hand — 2,000 prints, the buffer's whole cap */
const GAP_PAGES = 4;
/** Late prints land in the vendor's store a few ms behind their fill time — each poll re-reads this far back (and drops
    the repeats by trade id) so a print stamped just before the newest one in hand is never skipped */
const LATE_MS = 2_000;
/** The stream's beats: a full tape every 8s, a light one every 10s on a small page */
const STREAM_BUSY_MS = 8_000;
const STREAM_IDLE_MS = 10_000;
const STREAM_IDLE_PAGE = 100;
export { TAPE_CAP };

export interface TapeQuery {
  ticker?: string;
  /** one contract is asked of the vendor by its OCC symbol (option_contracts[]) */
  contract?: string;
  /** One strike (min_strike = max_strike) and one expiry (expiry_dates[]) of the name — a contract typed without its date,
      or a name and a date */
  strike?: number;
  expiry?: string;
  right?: 'C' | 'P' | null;
  side?: 'ASK' | 'BID' | 'MID' | null;
  multi?: boolean;
  /** Only prints that are NOT legs of a multi-leg order (is_multi_leg=false) */
  single?: boolean;
  /** OPRA condition codes the vendor filters on (trade_codes[]) — isoi for sweeps, cbmo / mctp for compression */
  codes?: string[];
  minSize?: number;
  minPremium?: number;
  minDte?: number | null;
  maxDte?: number | null;
  otm?: boolean;
}

/** The query string the option tape accepts: sweeps and compression go as OPRA codes (trade_codes[]), a block as
    min_size with is_multi_leg=false. Cursors are milliseconds, since the market prints 150–300 a second. */
export function tapeQueryString(q: TapeQuery, extra?: { newerThan?: number; olderThan?: number; limit?: number }): string {
  const p = new URLSearchParams();
  p.set('limit', String(extra?.limit ?? TAPE_PAGE));
  if (q.contract) p.append('option_contracts[]', q.contract.toUpperCase());
  else if (q.ticker) p.set('ticker_symbol', q.ticker.toUpperCase());
  if (!q.contract && q.strike != null && q.strike > 0) {
    p.set('min_strike', String(q.strike));
    p.set('max_strike', String(q.strike));
  }
  if (!q.contract && q.expiry && /^\d{4}-\d{2}-\d{2}$/.test(q.expiry)) p.append('expiry_dates[]', q.expiry);
  if (q.right === 'C') p.set('type', 'call');
  else if (q.right === 'P') p.set('type', 'put');
  if (q.side === 'ASK') p.set('tags[]', 'ask_side');
  else if (q.side === 'BID') p.set('tags[]', 'bid_side');
  else if (q.side === 'MID') p.set('tags[]', 'mid_side');
  if (q.multi) p.set('is_multi_leg', 'true');
  else if (q.single) p.set('is_multi_leg', 'false');
  for (const c of q.codes ?? []) p.append('trade_codes[]', c);
  if (q.minSize && q.minSize > 0) p.set('min_size', String(Math.round(q.minSize)));
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
  /* Past the cap the oldest go, whichever end the batch joined: the list is newest first, so the kept stretch is
     always its unbroken head. */
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

const EMPTY_PRINTS: FlowPrint[] = [];

/* Prints Trace has already read, by name. Compass reads this. It does not ask the vendor. */
const tapeShelf = new Map<string, FlowPrint[]>();
const shelfListeners = new Set<() => void>();
const SHELF_CAP = 2_000;

export function publishPrints(rows: readonly FlowPrint[]): void {
  if (!rows.length) return;
  const by = new Map<string, FlowPrint[]>();
  for (const p of rows) {
    const name = p.ticker?.toUpperCase();
    if (!name) continue;
    const list = by.get(name);
    if (list) list.push(p);
    else by.set(name, [p]);
  }
  let changed = false;
  for (const [name, incoming] of by) {
    const prev = tapeShelf.get(name) ?? [];
    const seen = new Set(prev.map(p => p.vendorId || String(p.id)));
    const fresh = incoming.filter(p => !seen.has(p.vendorId || String(p.id)));
    if (!fresh.length) continue;
    const next = fresh.concat(prev);
    next.sort((a, b) => (b.epochMs ?? 0) - (a.epochMs ?? 0));
    tapeShelf.set(name, next.length > SHELF_CAP ? next.slice(0, SHELF_CAP) : next);
    changed = true;
  }
  if (changed) shelfListeners.forEach(fn => fn());
}

/** The prints Trace already has for this name. Empty until Trace has read it. No request. */
export function useShelfPrints(ticker: string | null | undefined): FlowPrint[] {
  const name = (ticker || '').trim().toUpperCase();
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump(n => n + 1);
    shelfListeners.add(fn);
    return () => {
      shelfListeners.delete(fn);
    };
  }, []);
  return (name && tapeShelf.get(name)) || EMPTY_PRINTS;
}
export interface PrintStream extends LivePack<FlowPrint[]> {
  pending: number;
  loadingOlder: boolean;
  hasOlder: boolean;
  /** Why there is no older page: the session's start reached, or the memory cap */
  olderEnd: 'start' | 'cap' | null;
  /** The newest prints were let go to keep the page light as the reader scrolled back (reset() brings the latest back) */
  trimmed: boolean;
  flush: () => void;
  loadOlder: () => void;
  /** Start again from the newest prints (or the anchor) */
  reset: () => void;
}

/** The market tape as one growing list, lossless in its window: each page asks one millisecond into the last
    (overlap dropped by id); a poll that cannot reach the newest in hand replaces the buffer. */
export function usePrintStream(query: TapeQuery, hold: boolean, opts?: { untilMs?: number | null; keep?: (p: FlowPrint) => boolean; startMs?: number | null }): PrintStream {
  /* `startMs`: the session's first instant — an older page asks nothing before it, and a page that comes back short there
     is the start of the session reached */
  const startMs = opts?.startMs ?? null;
  const startRef = useRef(startMs);
  startRef.current = startMs;
  /* With `untilMs` the stream walks back from that instant (a closed session) and never polls; `keep` drops prints
     that do not belong (a stock's 16:00–16:15 extended prints). */
  const untilMs = opts?.untilMs ?? null;
  const keepRef = useRef(opts?.keep);
  keepRef.current = opts?.keep;
  const [nonce, setNonce] = useState(0);
  const key = `${tapeQueryString(query)}|${untilMs ?? 'live'}|${nonce}`;
  const [rows, setRows] = useState<FlowPrint[]>([]);
  const [trimmed, setTrimmed] = useState(false);
  const trimmedRef = useRef(false);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [pending, setPending] = useState<FlowPrint[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  /* under a new key the stream reads as waiting, never as the old key's rows cut empty */
  const [rowsFor, setRowsFor] = useState(key);
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
    trimmedRef.current = false;
    setTrimmed(false);
    setRows([]);
    setRowsFor(key);
    setPending([]);
    setHasOlder(true);
    setWaiting(true);
    setFault(null);
    /* a page's fullness is the vendor's row count, so a cancelled print dropped from a full page never ends the walk */
    const page = async (cursor: { newerThan?: number; olderThan?: number }, limit = TAPE_PAGE): Promise<FlowPrint[] & { full?: boolean; oldest?: number }> => {
      const capped0 = untilMs && (!cursor.olderThan || cursor.olderThan > untilMs) ? { ...cursor, olderThan: untilMs } : cursor;
      /* nothing before the session's start (a name's 2,000 prints can reach into the day before) */
      const capped = startRef.current && !capped0.newerThan ? { ...capped0, newerThan: startRef.current - 1 } : capped0;
      const got = await getRows(`/option-trades?${tapeQueryString(query, { ...capped, limit })}`);
      if (stop) return [];
      const live = liveTrades(got);
      await ensureIndexLevels(live.map(tickerOfRow));
      const keep = keepRef.current;
      const mapped = live.map(tradeToPrint);
      const out: FlowPrint[] & { full?: boolean; oldest?: number } = keep ? mapped.filter(keep) : mapped;
      out.full = got.length >= limit;
      let o = 0;
      for (const r of got) {
        const t = Date.parse(String(r.executed_at || ''));
        if (Number.isFinite(t) && (o === 0 || t < o)) o = t;
      }
      out.oldest = o;
      return out;
    };
    /** Everything newer than `sinceMs`, newest first; `joined` false when the walk stopped short of it */
    const newerThan = async (sinceMs: number, firstLimit = TAPE_PAGE): Promise<{ batch: FlowPrint[]; joined: boolean }> => {
      let acc: FlowPrint[] = [];
      let olderThan: number | undefined;
      for (let n = 0; n < GAP_PAGES && !stop; n++) {
        /* an idle tape asks a small first page (a 500-print page is ~600 KB); a full one walks on in whole pages */
        const got = await page({ newerThan: sinceMs > 0 ? sinceMs - 1 : undefined, olderThan }, n === 0 ? firstLimit : TAPE_PAGE);
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
        for (let guard = 0; more && held.length < BOOT_FILL && !stop && guard < 12; guard++) {
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
        if (held.length >= BOOT_FILL) setHasOlder(true);
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
    /* The beat follows the tape: STREAM_BUSY_MS while polls come back full, STREAM_IDLE_MS (and a smaller page)
       while light, QUIET_POLL_MS outside the session; a hidden tab or an anchored stream asks nothing. */
    let lastCount = TAPE_PAGE;
    let timer = 0;
    const beat = () => {
      const ph = marketPhase();
      const ms = ph !== 'regular' && ph !== 'late' ? QUIET_POLL_MS : lastCount >= STREAM_IDLE_PAGE ? STREAM_BUSY_MS : STREAM_IDLE_MS;
      timer = window.setTimeout(tick, ms);
    };
    const tick = async () => {
      if (stop) return;
      /* paused: no poll until resume; a window walked back past the cap is not rejoined to the live end until "back
         to the latest" */
      if (untilMs || !newest.current || polling || holdsPaused > 0 || tabHidden() || trimmedRef.current) return beat();
      polling = true;
      try {
        const { batch, joined } = await newerThan(newest.current - LATE_MS, lastCount >= STREAM_IDLE_PAGE ? TAPE_PAGE : STREAM_IDLE_PAGE);
        lastCount = batch.length;
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
        if (!stop) beat();
      }
    };
    if (!untilMs) beat();
    return () => {
      stop = true;
      window.clearTimeout(timer);
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

  const [olderEnd, setOlderEnd] = useState<'start' | 'cap' | null>(null);
  useEffect(() => setOlderEnd(null), [key]);
  /* One older page a call, on demand, in the low lane: from the oldest print in hand back to the session's start,
     500 at a time; a short page is the start reached */
  const loadOlder = useCallback(() => {
    const oldest = oldestMs(rowsRef.current);
    if (filling.current || !oldest || loadingOlder || !hasOlder) return;
    const start = startRef.current;
    if (start && oldest <= start) {
      setHasOlder(false);
      setOlderEnd('start');
      return;
    }
    setLoadingOlder(true);
    void getRowsLow(`/option-trades?${tapeQueryString(query, { olderThan: oldest + 1, newerThan: start ? start - 1 : undefined, limit: TAPE_PAGE })}`)
      .then(async got => {
        const live = liveTrades(got);
        await ensureIndexLevels(live.map(tickerOfRow));
        const keep = keepRef.current;
        const mapped = live.map(tradeToPrint);
        const batch = keep ? mapped.filter(keep) : mapped;
        setRows(prev => {
          const seen = new Set(prev.map(printId));
          const fresh = batch.filter(r => !seen.has(printId(r)));
          if (!fresh.length) return prev;
          const next = prev.concat(fresh).sort((a, b) => msOf(b) - msOf(a));
          if (next.length <= TAPE_CAP) return next;
          /* past the cap the newest go — the reader is at the old end; the live end is joined again by reset() */
          trimmedRef.current = true;
          setTrimmed(true);
          return next.slice(next.length - TAPE_CAP);
        });
        if (got.length < TAPE_PAGE) {
          setHasOlder(false);
          setOlderEnd('start');
        }
        setAt(Date.now());
      })
      .catch(() => {
        /* a failed page is asked again on the next scroll */
      })
      .finally(() => setLoadingOlder(false));
  }, [hasOlder, loadingOlder, query]);

  const reset = useCallback(() => setNonce(n => n + 1), []);
  const fresh = rowsFor === key;
  const shown = fresh ? rows : EMPTY_PRINTS;
  useEffect(() => {
    if (shown.length) publishPrints(shown);
  }, [shown]);
  return {
    rows: shown,
    at: fresh ? at : null,
    fault: fresh ? fault : null,
    waiting: !fresh || (waiting && rows.length === 0),
    pending: fresh ? pending.length : 0,
    loadingOlder,
    hasOlder,
    olderEnd: fresh ? olderEnd : null,
    trimmed: fresh && trimmed,
    flush,
    loadOlder,
    reset,
  };
}

/** Print versus the quote. At or above the ask is a lift; at or below the bid is a hit. Null when NBBO is missing. */
function execOf(price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' | null {
  if (!(price > 0) || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  if (price >= ask - 1e-6) return 'ASK';
  if (price <= bid + 1e-6) return 'BID';
  return 'MID';
}

/* The dark-pool read, one rule across Trace: a sized regular-session print over the mid was paid up (accumulation),
   under it sold down (distribution), at the mid neither. Only sized prints at the quote carry a read. */
/** A sized cross is dollars, not shares: $250K and up carries a read, below it none. */
export const DARK_SIZED_USD = 250_000;
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
  /* a quarter cent, not a half: on a one-cent spread the bid is half a cent under the mid */
  if (!Number.isFinite(cents) || Math.abs(cents) < 0.25) return { text: 'at the mid', cents: 0 };
  /* one unit, cents */
  const abs = Math.abs(cents);
  const n = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return { text: `${cents > 0 ? '+' : '−'}${n}¢`, cents };
}

/** Where a cross printed in the read's own terms: at the ask, on the bid, or inside as MID (within ¼¢) / UNDER MID /
    OVER MID. */
export function execWord(p: { exec?: 'ASK' | 'BID' | 'MID' | null; vsSpotPct: number; price: number }): string | null {
  if (!p.exec) return null;
  if (p.exec !== 'MID') return p.exec;
  const c = quotePlace(p.vsSpotPct, p.price).cents;
  return c === 0 ? 'MID' : c > 0 ? 'OVER MID' : 'UNDER MID';
}

/* The vendor's market_center is the FINRA facility the print was reported to; the dark venue itself is not
   disclosed. */
const FACILITY: Record<string, string> = { L: 'FINRA/Nasdaq TRF Carteret', '2': 'FINRA/Nasdaq TRF Chicago', N: 'FINRA/NYSE TRF', D: 'FINRA ADF', B: 'FINRA/Nasdaq TRF' };
const SPECIAL_WORD: Record<string, string> = {
  average_price_trade: 'average-price trade',
  contingent_trade: 'contingent trade',
  qualified_contingent_trade: 'qualified contingent trade',
  derivative_priced: 'derivative-priced trade',
  prior_reference_price: 'prior-reference-price trade',
  stopped_stock: 'stopped-stock trade',
  /* Auction prints (opening and closing crosses, official open and close) carry no side and no read. */
  cross_trade: 'auction cross',
  opening_print: 'opening-auction print',
  closing_print: 'closing-auction print',
  reopening_print: 'reopening-auction print',
  nasdaq_official_close_price: 'official closing price',
  nasdaq_official_opening_price: 'official opening price',
  official_close_price: 'official closing price',
  official_open_price: 'official opening price',
};
/** The auction codes among SPECIAL_WORD — read as "priced in the auction", not "by its terms" */
const AUCTION_CODES = new Set(['cross_trade', 'opening_print', 'closing_print', 'reopening_print', 'nasdaq_official_close_price', 'nasdaq_official_opening_price', 'official_close_price', 'official_open_price']);

export function darkPrint(row: Record<string, unknown>, i: number, spot = 0, kind: 'dark' | 'lit' = 'dark'): DarkPoolPrint {
  const price = num(row.price);
  const size = num(row.size);
  const notional = num(row.premium) || price * size;
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : spot;
  const vs = mid > 0 ? ((price - mid) / mid) * 100 : 0;
  /* A print priced by its own terms (contingent, average-price, derivative-priced, any sale condition) is shown,
     never read for intent or posture */
  const codes = [row.sale_cond_codes, row.trade_code].flatMap(c => (Array.isArray(c) ? c : [c])).filter(c => c != null && c !== '').map(String);
  /* only the codes that price a trade by its own terms — an intermarket sweep or an odd lot is priced at the quote */
  const own = codes.filter(c => c in SPECIAL_WORD);
  /* an auction print names its auction ("closing-auction print"), not the generic cross word beside it */
  const ownWords = [...new Set((own.some(c => AUCTION_CODES.has(c) && c !== 'cross_trade') ? own.filter(c => c !== 'cross_trade') : own).map(c => SPECIAL_WORD[c]))];
  const special = ownWords.length ? ownWords.join(', ') : null;
  const auction = own.some(c => AUCTION_CODES.has(c));
  const sized = notional >= DARK_SIZED_USD;
  /* after hours (the vendor's ext_hour_sold_codes "extended_hours_trade"): the quote it is set against is the thin
     post-market one, so the print is shown and labelled, never read */
  const extended = row.ext_hour_sold_codes != null && row.ext_hour_sold_codes !== '';
  const placeCents = quotePlace(vs, price).cents;
  const intent = special || extended ? 'ROTATION' : intentOf(placeCents, sized);
  /* an after-hours print's place in a thin quote is drawn neutral, never as a side; `exec` still says where it sat */
  const exec = special ? null : execOf(price, bid, ask);
  const when = clock(row.executed_at);
  /* the vendor's tracking_id is NOT unique — distinct prints (other sizes, other cumulative volumes) share one — so the
     id folds in the fields that tell them apart; stable across polls, so the accumulator still de-dupes repeats */
  const id = hashId(row.tracking_id != null ? `${row.tracking_id}-${row.executed_at}-${row.size}-${row.price}-${row.volume}` : `${row.ticker}-${row.executed_at}-${i}`);
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = special
    ? auction
      ? `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced in the auction, not against the quote; no read.`
      : `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced by its terms, not the quote; no read.`
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
    epochMs: when.ms || undefined,
    dateIso: when.ms ? nyDateOf(when.ms) : undefined,
    auction: auction || undefined,
    ticker: String(row.ticker || '').toUpperCase(),
    price,
    size,
    notional,
    /* a lit print is an exchange's, never a FINRA facility's */
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

/* A price the lit tape never traded is not a shelf: such a bucket holds only own-terms prints, so it is counted
   apart, out of the shelves and the day's dark dollars. */
export const offMarketBucket = (r: Record<string, unknown>) => num(r.dark_pool_volume) > 0 && r.regular_volume != null && num(r.regular_volume) === 0;

export function darkLevels(allRows: Record<string, unknown>[], spot: number, allPrints: DarkPoolPrint[] = []): DarkPoolLevel[] {
  const rows = allRows.filter(r => !offMarketBucket(r));
  /* own-terms prints are priced by their terms, not the market — they never count toward a shelf */
  const prints = allPrints.filter(p => !p.special);
  const buckets = rows.map(r => num(r.price)).filter(p => p > 0);
  /* The route sends shares by price, not a count, so a shelf's count is the dark prints in hand nearest it */
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
  /* Within a third of a percent of the market is the pivot, beyond it support or resistance. A shelf holds at least
     SHELF_MIN_SHARE of the day's dark dollars within SHELF_MAX_DIST, the heaviest two of each role. */
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
  const posture: Posture = postureOfNet(net);
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
  /* `read`: how many prints carried a read; none is "nothing to read", never Balanced */
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
/* `enabled`: nothing is read while it is off */
export function useAccumTape(kind: 'dark' | 'lit', limit: number, enabled = true): LivePack<DarkPoolPrint[]> {
  const path = kind === 'dark' ? `/darkpool/recent?limit=${Math.min(200, limit)}` : `/lit-flow/recent?limit=${Math.min(200, limit)}`;
  const [rows, setRows] = useState<DarkPoolPrint[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [fault, setFault] = useState<FeedFault | null>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (!enabled) return;
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
    /* the newest crosses: every 8s in the session, every 30s outside it, never in a hidden tab */
    let last = Date.now();
    const id = window.setInterval(() => {
      if (holdsPaused > 0 || !readDue(last, READ_POLL_MS, 'live')) return;
      last = Date.now();
      void run();
    }, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [path, kind, enabled]);
  return { rows, at, fault, waiting: waiting && rows.length === 0 };
}

/* The day's regular-session crosses after the close: the recent route ordered by dollars, walked down by max_premium
   (three pages of 200). The page says it holds the day's largest. */
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
          /* the session's own day only; a route's date filter is not trusted */
          out.push(...live.map((r, j) => darkPrint(r, out.length + j)).filter(p => !p.extended && (!p.dateIso || p.dateIso === iso)));
          if (got.length < 200) break;
          const last = num(got[got.length - 1].premium);
          if (!(last > 0) || (max != null && last >= max)) break;
          max = Math.floor(last);
        }
        if (stop) return;
        const seen = new Set<number>();
        const rows = out.filter(p => !seen.has(p.id) && (seen.add(p.id), true)).sort(byNewest);
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

/* The day's regular-session lit prints after the close, name by name ($500K and up, walked back from 16:00) for the
   names heaviest in the dark, since the lit feed has no older cursor. Read once. */
export function useLitRegularDay(close: { iso: string; closeMs: number } | null, names: string[]): LivePack<DarkPoolPrint[]> {
  const key = close && names.length ? `${close.iso}:${names.join(',')}` : null;
  const [box, setBox] = useState<{ key: string; rows: DarkPoolPrint[]; at: number | null; fault: FeedFault | null } | null>(null);
  useEffect(() => {
    if (!key || !close) return;
    let stop = false;
    (async () => {
      try {
        const out: DarkPoolPrint[] = [];
        for (const n of names) {
          const got = await getRows(`/lit-flow/${encodeURIComponent(n)}?date=${close.iso}&older_than=${close.closeMs}&min_premium=500000&limit=200`);
          /* the session's New York day only: `?date=` with `older_than` does not hold the route to the day */
          out.push(...got.filter(r => !r.canceled).map((r, i) => darkPrint(r, out.length + i, 0, 'lit')).filter(p => !p.extended && p.dateIso === close.iso));
          if (stop) return;
        }
        const seen = new Set<number>();
        const rows = out.filter(p => !seen.has(p.id) && (seen.add(p.id), true)).sort(byNewest);
        if (!stop) setBox({ key, rows, at: Date.now(), fault: null });
      } catch (e) {
        if (!stop) setBox({ key, rows: [], at: null, fault: vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed' });
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const mine = box && key && box.key === key ? box : null;
  return { rows: mine?.rows ?? [], at: mine?.at ?? null, fault: mine?.fault ?? null, waiting: !!key && !mine };
}

/** A name's whole day off-exchange (/darkpool/{t}/price-levels): dark dollars are each bucket's shares at its price
    (≈); the share is dark shares over the day's whole volume from the quote. */
export interface DarkDay {
  /** The session the figures are for, YYYY-MM-DD, when asked by date */
  iso?: string;
  /** Dark shares at prices the lit tape also traded */
  darkShares: number;
  litShares: number;
  /** ≈, priced at each $1 bucket — at-market buckets only */
  darkDollars: number;
  /** Dark shares and ≈dollars at prices the lit tape never traded that day — own-terms prints (offMarketBucket), set apart */
  offShares: number;
  offDollars: number;
  /** Dark shares over the day's whole volume, 0–100; NaN when the day's volume is not to hand */
  sharePct: number;
}
function darkDayOf(levels: Record<string, unknown>[], dayVolume: number): DarkDay | null {
  let dark = 0;
  let lit = 0;
  let dollars = 0;
  let off = 0;
  let offDollars = 0;
  for (const r of levels) {
    const d = num(r.dark_pool_volume);
    lit += num(r.regular_volume);
    if (offMarketBucket(r)) {
      off += d;
      offDollars += d * num(r.price);
      continue;
    }
    dark += d;
    dollars += d * num(r.price);
  }
  return dark + off > 0 ? { darkShares: dark, litShares: lit, darkDollars: dollars, offShares: off, offDollars, sharePct: dayVolume >= dark ? (dark / dayVolume) * 100 : NaN } : null;
}
/** The stock's last trade and the day's volume — /stock/{t}/quote */
export interface StockLast {
  price: number;
  vol: number;
  /** epoch ms of the last trade */
  at: number;
}
async function stockLastOf(name: string): Promise<StockLast> {
  try {
    const got = await uwCall(`/stock/${encodeURIComponent(name)}/quote`, true);
    type Q = { last_trade?: { vol?: unknown; price?: unknown; time?: unknown } };
    const d = (got.data as { data?: Q } | null)?.data ?? (got.data as Q | null);
    const lt = (d as Q | null)?.last_trade;
    return { price: num(lt?.price), vol: num(lt?.vol), at: num(lt?.time) };
  } catch {
    return { price: 0, vol: 0, at: 0 };
  }
}
async function dayVolumeOf(name: string): Promise<number> {
  return (await stockLastOf(name)).vol;
}
/** the stock's real price: the quote's last trade, never a cross's */
export function useStockLast(ticker: string | null): LivePack<StockLast | null> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(name ? `stock-last:${name}` : 'stock-last:off', async () => {
    const q = await stockLastOf(name);
    return q.price > 0 ? q : null;
  }, null, !!name, READ_POLL_MS, 'live');
}
/** A name's dark day: with `dateIso`, that session's own, its whole volume off that day's one-minute bars */
export function useDarkDay(ticker: string | null, dateIso: string | null = null): LivePack<DarkDay | null> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `dark-day:${name}:${dateIso ?? 'latest'}` : 'dark-day:off',
    async () => {
      if (dateIso) {
        const [levels, bars] = await Promise.all([
          getRows(`/darkpool/${encodeURIComponent(name)}/price-levels?date=${dateIso}`),
          getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?date=${dateIso}&limit=1000`).catch(() => [] as Record<string, unknown>[]),
        ]);
        const vol = bars.reduce((m, b) => Math.max(m, num(b.total_volume)), 0);
        const d = darkDayOf(levels, vol);
        return d ? { ...d, iso: dateIso } : null;
      }
      const [levels, vol] = await Promise.all([getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`), dayVolumeOf(name)]);
      return darkDayOf(levels, vol);
    },
    null,
    !!name,
    READ_POLL_MS,
    /* a dated day is fixed; the latest one keeps taking after-hours crosses to 20:00 */
    dateIso ? 'day' : 'live'
  );
}

/** Is there such a ticker: the vendor's stock state answers empty for a name it does not carry; an index root is
    always known. Asked once per name, kept. */
const knownTickers = new Map<string, Promise<boolean>>();
export function tickerKnown(name: string): Promise<boolean> {
  const t = name.trim().toUpperCase();
  if (!t) return Promise.resolve(false);
  if (indexRoot(t) || ['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP', 'DJX', 'OEX', 'XEO'].includes(t)) return Promise.resolve(true);
  let p = knownTickers.get(t);
  if (!p) {
    p = uwCall(`/stock/${encodeURIComponent(t)}/stock-state`, true)
      .then(got => {
        const d = got.data as { data?: unknown } | null;
        /* a failed read is not "no such ticker" — the page goes on, and the name is asked again next time */
        if (got.error) {
          knownTickers.delete(t);
          return true;
        }
        return d != null && (d.data ?? null) != null;
      })
      .catch(() => {
        knownTickers.delete(t);
        return true;
      });
    knownTickers.set(t, p);
  }
  return p;
}
/** The check as a hook: null while it is asked, then true / false (null for no name) */
export function useTickerKnown(name: string | null | undefined): boolean | null {
  const t = (name || '').trim().toUpperCase();
  const [state, setState] = useState<{ t: string; ok: boolean | null }>({ t, ok: null });
  useEffect(() => {
    if (!t) return;
    let stop = false;
    void tickerKnown(t).then(ok => {
      if (!stop) setState({ t, ok });
    });
    return () => {
      stop = true;
    };
  }, [t]);
  if (!t) return null;
  return state.t === t ? state.ok : null;
}
export function useNameDark(ticker: string | null, untilMs: number | null = null): LivePack<{ view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null; unknown?: boolean }> {
  const name = (ticker || '').trim().toUpperCase();
  /* with `untilMs` (the stock close, after the bell) the name's crosses are its regular session's, walked back from the
     close — its after-hours prints are the After hours view's */
  const cut = untilMs ? `&older_than=${untilMs}` : '';
  return useLive(
    name ? `name-dark:${name}:${untilMs ?? 'live'}` : 'name-dark:off',
    async () => {
      if (!name) return { view: null, lit: [] as DarkPoolPrint[], day: null };
      /* a name the vendor does not carry is said so, and nothing else is asked for it */
      if (!(await tickerKnown(name))) return { view: null, lit: [] as DarkPoolPrint[], day: null, unknown: true };
      const [prints, levels, lit, quote] = await Promise.all([
        getRows(`/darkpool/${encodeURIComponent(name)}?limit=200${cut}`),
        getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`).catch(() => [] as Record<string, unknown>[]),
        getRows(`/lit-flow/${encodeURIComponent(name)}?limit=200${cut}`).catch(() => [] as Record<string, unknown>[]),
        stockLastOf(name),
      ]);
      /* the session's New York day only: a name with few crosses walks back into the day before */
      const day0 = untilMs ? nyDateOf(untilMs) : nyIsoToday();
      const onDay = (p: DarkPoolPrint) => !p.dateIso || p.dateIso === day0;
      const mapped = prints.filter(r => !r.canceled).map((r, i) => darkPrint(r, i)).filter(onDay);
      /* the stock's own last trade, never a cross's price (a cross may be an own-terms print far off the market); the
         newest cross priced at the quote only when the quote does not answer */
      const spot = quote.price > 0 ? quote.price : mapped.find(p => !p.special)?.price || 0;
      const dayVol = quote.vol;
      const day = darkDayOf(levels, dayVol);
      return { view: darkView(name, mapped, darkLevels(levels, spot, mapped), spot, day && Number.isFinite(day.sharePct) ? day.sharePct : 0), lit: lit.filter(r => !r.canceled).map((r, i) => darkPrint(r, i, 0, 'lit')).filter(onDay), day };
    },
    { view: null, lit: [], day: null } as { view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null; unknown?: boolean },
    !!name,
    READ_POLL_MS,
    untilMs ? 'day' : 'live'
  );
}

/** One screener row as a book contract (exported for scripts/trace-moneyness-proof.ts) */
export function contractRow(row: Record<string, unknown>, _i = 0): BookContract {
  const ticker = String(row.ticker_symbol || row.underlying_symbol || row.ticker || '').toUpperCase();
  const expiryIso = String(row.expiry || '').slice(0, 10);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  /* the row's stock_price is the vendor's stock-state, which can stall for hours: the newest live price wins; an index
     row carries none, so it reads the index level */
  const live = liveSpotOf(ticker);
  const spot = live || num(row.stock_price) || indexLevel(ticker);
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  const premium = num(row.premium);
  const ask = num(row.ask_side_volume);
  const bid = num(row.bid_side_volume);
  const mid = num(row.mid_volume) + num(row.no_side_volume);
  const when = clock(row.last_fill);
  const dte = dteOf(expiryIso);
  return {
    /* stable across polls and re-ranks: the OCC symbol, else the contract's parts */
    key: row.option_symbol ? String(row.option_symbol) : `${ticker}-${strike}-${right}-${expiryIso}`,
    optionSymbol: row.option_symbol ? String(row.option_symbol) : undefined,
    ticker,
    sector: row.sector ? String(row.sector) : null,
    sectorColor: null,
    strike,
    right,
    expiry: expiryLabel(expiryIso),
    dte,
    spot,
    otmPct: otmOf(right, strike, spot, !(live > 0) && !(num(row.stock_price) > 0) && !!indexRoot(ticker)),
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
    crossPct: volume > 0 ? Math.min(100, (num(row.cross_volume) / volume) * 100) : 0,
    askPct: ask + bid > 0 ? (ask / (ask + bid)) * 100 : 0,
    prevOI: num(row.prev_oi),
    prevAvgFill: num(row.chain_prev_close),
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
    earnIso: /^\d{4}-\d{2}-\d{2}$/.test(String(row.next_earnings_date || '').slice(0, 10)) ? String(row.next_earnings_date).slice(0, 10) : null,
    sideVol: { ask, bid, mid },
    expired: expiredAtBell(expiryIso, ticker),
    theta: row.theta != null && row.theta !== '' ? num(row.theta) : undefined,
    lastDay: when.ms > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(when.ms)) : undefined,
  };
}

/** A contract whose expiry was the tape's session (or before) and whose bell has rung no longer stands */
/** Its own bell: 16:15 for the late-closing index and ETF options (sessionEndMin), 16:00 for a stock's. */
export function expiredAtBell(expiryIso: string, ticker?: string | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso)) return false;
  const session = tapeSessionIso();
  if (expiryIso < session) return true;
  if (expiryIso > session) return false;
  const p = nyParts(new Date());
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return today > session || p.hour * 60 + p.minute >= sessionEndMin(ticker);
}

/** The contracts that still stand — the expired ones left out, and how many were */
export function standing<T extends { expired?: boolean }>(rows: T[]): { rows: T[]; expired: number } {
  const out = rows.filter(r => !r.expired);
  return { rows: out, expired: rows.length - out.length };
}

/* The screener's open_interest is the count its session opened on; once the next count is published the row takes it
   and says whose trading it reflects (oiDay, oiPending). */
export function nextSessionIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() + 1);
  return isoDate(d);
}
/** The session before a session day, YYYY-MM-DD */
export function prevSessionIso(iso: string = tapeSessionIso()): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  return isoDate(d);
}
interface NewestOi {
  /** The count after the volume's session */
  oi: number;
  /** The count that session opened on */
  before: number;
  streak?: number;
}
/** occ:date → the count dated `date`; null = asked and the vendor has none (kept for the session) */
const newestOiCache = new Map<string, NewestOi | null>();
/** ticker:date whose oi-change pages are read */
const oiPagesRead = new Set<string>();
/** date → not published yet; asked again after this instant */
const oiNotOutUntil = new Map<string, number>();
const OI_RETRY_MS = 30 * 60_000;
/** The next session's counts land overnight; today's date is not asked before this New York minute */
const OI_PUBLISH_MIN = 7 * 60;
/** A run reads at most this many contracts' /historic — the rows a page has on screen */
const OI_HISTORIC_CAP = 20;
/** Rows a page's book pairs without a grid reporting what is on screen: its heaviest by premium */
const OI_FIRST = 20;
let newestOiVer = 0;
const newestOiListeners = new Set<() => void>();
const volDayOf = (r: BookContract) => (r.lastDay && /^\d{4}-\d{2}-\d{2}$/.test(r.lastDay) ? r.lastDay : tapeSessionIso());
const oiKey = (r: BookContract, next: string) => `${r.optionSymbol}:${next}`;

function oiDateDue(next: string): boolean {
  const today = nyIsoToday();
  if (next > today) return false;
  if (next === today) {
    const p = nyParts(new Date());
    if (p.hour * 60 + p.minute < OI_PUBLISH_MIN) return false;
  }
  return (oiNotOutUntil.get(next) ?? 0) <= Date.now();
}

/** One name's 500 largest open-interest increases and decreases for `next`; false when the date is not published yet */
async function readOiPages(ticker: string, next: string): Promise<boolean> {
  for (const order of ['desc', 'asc'] as const) {
    const res = await uwCall(`/stock/${encodeURIComponent(ticker)}/oi-change?limit=500&date=${next}&order=${order}`, false, true);
    const page = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    const dated = page.filter(x => String(x.curr_date ?? '').slice(0, 10) === next);
    if (order === 'desc' && !dated.length) return false;
    for (const x of dated) newestOiCache.set(`${String(x.option_symbol ?? '')}:${next}`, { oi: num(x.curr_oi), before: num(x.last_oi), streak: x.days_of_oi_increases != null ? num(x.days_of_oi_increases) : undefined });
  }
  return true;
}

async function readOiHistoric(r: BookContract, next: string): Promise<void> {
  try {
    const res = await uwCall(`/option-contract/${encodeURIComponent(r.optionSymbol!)}/historic?limit=3`, false, true);
    const box = res.data as { chains?: unknown[]; data?: unknown[] } | unknown[] | null;
    const list = (Array.isArray(box) ? box : Array.isArray((box as { chains?: unknown[] })?.chains) ? (box as { chains: unknown[] }).chains : Array.isArray((box as { data?: unknown[] })?.data) ? (box as { data: unknown[] }).data : []) as Record<string, unknown>[];
    const at = list.find(x => String(x.date ?? '').slice(0, 10) === next);
    const was = list.find(x => String(x.date ?? '').slice(0, 10) === volDayOf(r));
    newestOiCache.set(oiKey(r, next), at && was ? { oi: num(at.open_interest), before: num(was.open_interest) } : null);
  } catch {
    newestOiCache.set(oiKey(r, next), null);
  }
}

async function pairRun(rows: BookContract[]): Promise<boolean> {
  const byDate = new Map<string, BookContract[]>();
  for (const r of rows) {
    if (!r.optionSymbol || r.expired) continue;
    const next = nextSessionIso(volDayOf(r));
    if (!oiDateDue(next) || newestOiCache.has(oiKey(r, next))) continue;
    byDate.set(next, [...(byDate.get(next) ?? []), r]);
  }
  let changed = false;
  for (const [next, list] of byDate) {
    /* the heaviest name first: if its pages are empty the date is not out, and nothing else is asked */
    const prem = new Map<string, number>();
    for (const r of list) prem.set(r.ticker, (prem.get(r.ticker) ?? 0) + r.premium);
    let out = true;
    for (const t of [...prem.keys()].sort((a, b) => (prem.get(b) ?? 0) - (prem.get(a) ?? 0))) {
      const k = `${t}:${next}`;
      if (oiPagesRead.has(k)) continue;
      if (!(await readOiPages(t, next))) {
        oiNotOutUntil.set(next, Date.now() + OI_RETRY_MS);
        out = false;
        break;
      }
      oiPagesRead.add(k);
      changed = true;
    }
    if (!out) continue;
    /* an unchanged count, or one past the 500 largest changes, is not on the pages: the contract's own history */
    const missing = list.filter(r => !newestOiCache.has(oiKey(r, next)) && oiPagesRead.has(`${r.ticker}:${next}`)).sort((a, b) => b.premium - a.premium);
    for (const r of missing.slice(0, OI_HISTORIC_CAP)) {
      await readOiHistoric(r, next);
      changed = true;
    }
  }
  return changed;
}

/* single flight: one run at a time; rows asked meanwhile wait for the next run */
let oiRunning = false;
const oiWaiting = new Map<string, BookContract>();
async function loadNewestOi(rows: BookContract[]): Promise<void> {
  for (const r of rows) if (r.optionSymbol) oiWaiting.set(r.key, r);
  if (oiRunning || !oiWaiting.size) return;
  oiRunning = true;
  try {
    while (oiWaiting.size) {
      const batch = [...oiWaiting.values()];
      oiWaiting.clear();
      if (await pairRun(batch)) {
        newestOiVer++;
        for (const f of newestOiListeners) f();
      }
    }
  } finally {
    oiRunning = false;
  }
}

/** Pair the open interest of the rows a grid has on screen (TraceGrid onVisible) */
export function pairOiFor(rows: readonly BookContract[]): void {
  void loadNewestOi(rows.slice(0, OI_HISTORIC_CAP));
}

/** The rows with the open interest of their volume's session wherever it is out (see above) */
export function usePairedOi(rows: BookContract[]): BookContract[] {
  const [ver, setVer] = useState(newestOiVer);
  useEffect(() => {
    const f = () => setVer(newestOiVer);
    newestOiListeners.add(f);
    return () => {
      newestOiListeners.delete(f);
    };
  }, []);
  useEffect(() => {
    if (rows.length) void loadNewestOi([...rows].sort((a, b) => b.premium - a.premium).slice(0, OI_FIRST));
  }, [rows]);
  return useMemo(() => {
    void ver;
    return rows.map(r => {
      const vol = volDayOf(r);
      const next = nextSessionIso(vol);
      const hit = r.optionSymbol ? newestOiCache.get(`${r.optionSymbol}:${next}`) : undefined;
      if (!hit) return { ...r, volDay: vol, oiDay: prevSessionIso(vol), oiPending: !r.expired };
      return {
        ...r,
        oi: hit.oi,
        prevOI: hit.before,
        deltaOI: hit.oi - hit.before,
        deltaOIPct: hit.before > 0 ? ((hit.oi - hit.before) / hit.before) * 100 : 0,
        /* Vol/OI stays against the count the session opened on — now the paired `before` */
        volOverOI: hit.before > 0 ? r.volume / hit.before : 0,
        oiStreak: hit.streak ?? r.oiStreak,
        volDay: vol,
        oiDay: vol,
        oiPending: false,
      };
    });
  }, [rows, ver]);
}

const bookIdOf = (r: BookContract) => r.key;
export interface EndlessBook extends LivePack<BookContract[]> {
  /** The screener's older pages, read as the reader scrolls */
  older?: OlderPages<BookContract>;
}
/** The market's 200 heaviest contracts by premium — one shared read for every page and every name */
function useMarketBookRaw(enabled: boolean): LivePack<BookContract[]> {
  return useLive(
    'book:mkt',
    async () => {
      /* nearly every book carries SPXW: its level is asked beside the book, not after it */
      void ensureIndexLevels(['SPX']);
      return mapBook(await getRows('/screener/option-contracts?limit=200&order=premium&order_direction=desc'));
    },
    [],
    enabled
  );
}
/** One name's 80 heaviest contracts */
function useNameBookRaw(name: string, enabled: boolean): LivePack<BookContract[]> {
  return useLive(name ? `book-name:${name}` : 'book-name:off', async () => mapBook(await getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(name)}&limit=80&order=premium&order_direction=desc`)), [], enabled && !!name);
}
/** The market's book, with a name's own 80 ahead of it when one is given; `endless` pages the market's book on scroll */
export function useLiveBook(ticker?: string | null, enabled = true, endless = false): EndlessBook {
  const name = (ticker || '').trim().toUpperCase();
  const market = useMarketBookRaw(enabled);
  const named = useNameBookRaw(name, enabled);
  const older = useOlderPages('book:mkt', market.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, 'order=premium&order_direction=desc', 200), enabled && endless && !name);
  const merged = useMemo(() => {
    if (!name) return endless ? older.rows : market.rows;
    const seen = new Set<string>();
    return named.rows.concat(market.rows).filter(r => !!r.ticker && !seen.has(r.key) && (seen.add(r.key), true));
  }, [name, endless, older.rows, market.rows, named.rows]);
  const rows = usePairedOi(merged);
  const waiting = market.waiting || (!!name && named.waiting);
  return useMemo(() => ({ rows, at: market.at, fault: market.fault, waiting, older: endless && !name ? older : undefined }), [rows, market.at, market.fault, waiting, endless, name, older]);
}
/** A searched name's own book by the day's premium, paged on scroll; without a name, the market's */
export function useSearchBook(name: string | null | undefined): EndlessBook & { name: string | null } {
  const t = (name || '').trim().toUpperCase() || null;
  const market = useLiveBook(null, !t, true);
  const q = t ? `ticker_symbol=${encodeURIComponent(t)}&order=premium&order_direction=desc` : '';
  const key = `namebook:${t ?? 'off'}`;
  const pack = useLive(key, async () => mapBook(await getRows(`/screener/option-contracts?${q}&limit=200&page=0`)), [] as BookContract[], !!t);
  const older = useOlderPages(key, pack.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, q, 200), !!t);
  const rows = usePairedOi(older.rows);
  const named = useMemo(() => ({ ...pack, rows, older }), [pack.at, pack.fault, pack.waiting, rows, older.state, older.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps
  return t ? { ...named, name: t } : { ...market, name: null };
}

/** The screener's page — 200 contracts in the vendor's own order: by premium, or by volume for "most active" */
export function useContracts(unusual: boolean, issue?: 'stock' | 'etf' | null, order: 'premium' | 'volume' = 'premium', ticker?: string | null, enabled = true): EndlessBook {
  const parts = [`order=${order}`, 'order_direction=desc'];
  const t = (ticker || '').trim().toUpperCase();
  if (t) parts.push(`ticker_symbol=${encodeURIComponent(t)}`);
  if (unusual) parts.push('unusual=true');
  if (issue === 'stock') parts.push('issue_types[]=Common Stock');
  else if (issue === 'etf') parts.push('issue_types[]=ETF');
  const q = parts.join('&');
  const key = `contracts:${unusual ? 'u' : 'h'}:${issue ?? 'any'}:${order}:${t || 'mkt'}`;
  const pack = useLive(key, async () => mapBook(await getRows(`/screener/option-contracts?limit=200&${q}`)), [], enabled);
  const older = useOlderPages(key, pack.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, q, 200), enabled);
  const rows = usePairedOi(older.rows);
  return useMemo(() => ({ ...pack, rows, older }), [pack.at, pack.fault, pack.waiting, rows, older.state, older.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The newest flow alerts — or, with `opts.untilMs`, the newest filed before that instant (the regular session's last
    alerts, after the close); `opts.session` keeps only the alerts whose fills sat in (or outside) the regular session */
export function useFlowAlerts(limit = 50, opts?: { untilMs?: number | null; session?: 'regular' | 'extended' | null; enabled?: boolean }): LivePack<FlowPrint[]> {
  const until = opts?.untilMs ?? null;
  const session = opts?.session ?? null;
  return useLive(`alerts:${limit}:${until ?? 'live'}:${session ?? 'any'}`, async () => {
    const rows = markAlertPackages(await mapWithIndex(await getRows(`/option-trades/flow-alerts?limit=${limit}${until ? `&older_than=${new Date(until).toISOString()}` : ''}`), alertToPrint));
    return session ? rows.filter(p => (session === 'regular' ? !p.extended : !!p.extended)) : rows;
    /* walked back from a close, the alerts are that day's and do not change; the newest are live */
  }, [], opts?.enabled ?? true, READ_POLL_MS, until ? 'day' : 'live');
}

export function useAlertTrades(id: string | null): LivePack<FlowPrint[]> {
  return useLive(id ? `alert-trades:${id}` : 'alert-trades:off', async () => mapWithIndex(liveTrades(await getRows(`/option-trades/flow-alerts/${encodeURIComponent(id!)}`)), tradeToPrint), [], !!id);
}

/* No exchange breakdown: /option-trades/exchange-breakdown is not on this key (docs/DATA_SOURCES.md). */

/* Each vendor shape name maps to the shape it is (a diagonal is not custom; a time butterfly is a calendar), and the
   vendor's own name rides along spelled out. */
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
  /* The legs route speaks its own way: `side` is where the leg's print sat, `size` its contracts, the strike in
     thousandths. Direction is settled by resolveLegs, never guessed here. */
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
    /* the vendor's own days to run where the leg carries them, else from the session */
    dte: leg.dte != null && leg.dte !== '' && Number.isFinite(Number(leg.dte)) ? Math.max(0, Number(leg.dte)) : dteOf(expiryIso),
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

/* A leg's print side is not its direction: directions are settled by the one set of buys and sells whose fills add
   up to the net (within 3%). None or several fits: no direction. */
function resolveLegs(raw: Record<string, unknown>[], structSize: number, netPremium: number): SpreadLeg[] {
  const base = raw.map(l => spreadLeg(l, '', structSize));
  if (!base.length || !Number.isFinite(netPremium) || netPremium === 0) return base;
  /* the route's leg `size` is the leg's contracts on most rows and its ratio on some (a 2-lot fly's legs read 1 / 2 / 1);
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
  return positionThetaCapped(legs)?.value ?? null;
}
/* A day of theta cannot take more than the position is worth: each leg's day is capped at its own fill, and the
   position's at the debit paid or credit collected. */
export function positionThetaCapped(legs: SpreadLeg[], netPremium?: number): { value: number; capped: boolean } | null {
  if (!legs.length || legs.some(l => l.side == null || l.theta == null)) return null;
  let capped = false;
  let v = legs.reduce((a, l) => {
    const rate = l.theta as number;
    const fill = Number.isFinite(l.fill) && l.fill > 0 ? l.fill : Infinity;
    const day = Math.abs(rate) > fill ? Math.sign(rate) * fill : rate;
    if (day !== rate) capped = true;
    return a + (l.side === 'BUY' ? 1 : -1) * day * (l.contracts ?? 1) * 100;
  }, 0);
  if (netPremium != null && Number.isFinite(netPremium) && netPremium !== 0) {
    const worth = Math.abs(netPremium);
    /* a bought structure loses to time at most what it cost; a sold one gains at most what it collected */
    if (netPremium > 0 && v < -worth) {
      v = -worth;
      capped = true;
    } else if (netPremium < 0 && v > worth) {
      v = worth;
      capped = true;
    }
  }
  return { value: v, capped };
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

/* One structure from its own legs (net_price is wrong on ratio'd shapes): size is units (the legs' GCD), net is net
   premium over units × 100, risk the legs' expiry payoff. */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
/* Legs are read on a budget: once per structure and kept; each asker's list (the rows on screen, the largest nets)
   replaces its last; one at a time every LEG_GAP_MS in the low lane; an opened card's structure goes first. */
const legRaw = new Map<string, Record<string, unknown>[] | 'none'>();
const legFails = new Map<string, number>();
const legCard: string[] = [];
const legAsks = new Map<string, { order: number; ids: string[] }>();
const legInflight = new Set<string>();
let legBusy = 0;
let legLast = 0;
let legTimer: number | null = null;
const LEG_GAP_MS = 1_200;
let legAskSeq = 0;
let legRev = 0;
const legListeners = new Set<() => void>();
const legNotify = () => {
  legRev++;
  for (const fn of legListeners) fn();
};
const legOpen = (id: string) => !!id && !legRaw.has(id) && !legInflight.has(id);
function readLegs(id: string, low: boolean) {
  legInflight.add(id);
  legBusy++;
  uwCall(`/option-trades/multi-leg/${encodeURIComponent(id)}/legs`, !low, low)
    .then(got => {
      if (got.error) {
        if (got.status === 404 || got.status === 422 || got.status === 403) legRaw.set(id, 'none');
        else throw new Error(got.error);
        return;
      }
      const rows = rowsOf(got.data);
      legRaw.set(id, rows.length ? rows : 'none');
    })
    .catch(() => {
      const n = (legFails.get(id) ?? 0) + 1;
      legFails.set(id, n);
      if (n >= 3) legRaw.set(id, 'none');
    })
    .finally(() => {
      legInflight.delete(id);
      legBusy--;
      legNotify();
      pumpLegs();
    });
}
function pumpLegs() {
  /* an opened card's structure first, at once */
  while (legCard.length && legBusy < 2) {
    const id = legCard.shift()!;
    if (legOpen(id)) readLegs(id, false);
  }
  if (legBusy > 0) return;
  /* the rows on screen (rank 0) at twice the pace of the rest */
  const asks = [...legAsks.values()].sort((a, b) => a.order - b.order);
  const onScreen = asks.some(a => a.order < 1_000_000 && a.ids.some(legOpen));
  const wait = legLast + (onScreen ? LEG_GAP_MS / 2 : LEG_GAP_MS) - Date.now();
  if (wait > 0) {
    if (legTimer == null) legTimer = window.setTimeout(() => {
      legTimer = null;
      pumpLegs();
    }, wait);
    return;
  }
  /* the page's asks, oldest asker first (the rows on screen ask before the largest-net sweep); under a hold only the rows
     on screen finish settling — the held moment's own structures, nothing new */
  for (const a of asks) {
    if (holdsPaused > 0 && a.order >= 1_000_000) continue;
    const id = a.ids.find(legOpen);
    if (id) {
      legLast = Date.now();
      readLegs(id, true);
      return;
    }
  }
}
/** An opened card's structure: read ahead of the page */
function wantLegsNow(ids: string[]) {
  for (const id of ids) if (legOpen(id) && !legCard.includes(id)) legCard.unshift(id);
  pumpLegs();
}
/** One asker's list of structures, in its order — it replaces that asker's last list; null withdraws it */
function askLegs(asker: string, ids: string[] | null, rank: number) {
  if (!ids || !ids.length) legAsks.delete(asker);
  else legAsks.set(asker, { order: rank * 1_000_000 + (legAsks.get(asker)?.order ?? ++legAskSeq) % 1_000_000, ids });
  pumpLegs();
}
/** A stable asker id for one hook */
function useLegAsker(ids: string[], rank: number): void {
  const me = useRef<string>('');
  if (!me.current) me.current = `ask:${++legAskSeq}`;
  const key = ids.join(',');
  useEffect(() => {
    askLegs(me.current, key ? key.split(',') : null, rank);
  }, [key, rank]);
  useEffect(() => () => askLegs(me.current, null, rank), [rank]);
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

/* The shape's canonical signs, used only when the vendor left the net out and no leg settles: the net's size is the
   same either way round, so the row can still say it; the way stays unknown. */
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

/* The sentence comes from the settled legs: what was bought and sold, the money, where the expiry payoff is best and
   worst, and which way it gains. */
/** A shape's name without its directional verdict — "bull put spread" → "put spread", "bullish risk reversal" → "risk
    reversal" — for a structure that is shown but not read (a compression package, an after-hours fill) */
export function neutralShape(name: string): string {
  return name.replace(/\b(bullish|bearish|bull|bear)\s+/gi, '').trim();
}

export function describeStructure(legs: SpreadLeg[], netPremium: number, units: number, unread = false): string {
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
  /* the money in words, never a sign to decode: "collected $3.90 a unit ($780 in all)", "paid $29.80 a unit" */
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
  /* The shape's way first: a payoff that peaks inside its strikes bets on where it settles, one that troughs pays on
     a move, but only on a side where the payoff past the wing is a gain. */
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
  /* a structure shown but not read (compression, after hours) keeps its payoff and drops the verdict */
  return unread ? `${lead}${money}. At expiry it ${bestWords} and ${worstWords}.` : `${lead}${money}. At expiry it ${bestWords} and ${worstWords} — ${way}.`;
}

/* The name comes from settled legs on one expiry (or a two-leg calendar / diagonal); otherwise the vendor's, kept
   beside the legs' name when the two disagree. */
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
    if (new Set([a.strike, m.strike, b.strike]).size !== 3) return null;
    const ca = a.contracts ?? 1;
    const cm = m.contracts ?? 1;
    const cb = b.contracts ?? 1;
    if (B(a) === B(b) && B(a) !== B(m)) {
      if (cb === ca && cm === 2 * ca) return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} butterfly${m.strike - a.strike !== b.strike - m.strike ? ' (uneven wings)' : ''}`, kind: 'butterfly' };
      if (cm === ca + cb) return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} ratio butterfly`, kind: 'butterfly' };
      return null;
    }
    /* a ladder: the leg nearest the money on one side, the two further out on the other, equal sizes */
    const near = a.right === 'C' ? a : b;
    const far = a.right === 'C' ? [m, b] : [a, m];
    if (eq && B(far[0]) === B(far[1]) && B(near) !== B(far[0])) return { name: `${B(near) ? 'long' : 'short'} ${rw(a.right)} ladder`, kind: 'ratio' };
    return null;
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

/** A double calendar is a shape whatever way it went (two strikes, near and far, one right, equal sizes), so it is
    named even unsettled */
function doubleCalendarOf(legs: SpreadLeg[]): { name: string; kind: SpreadKind } | null {
  if (legs.length !== 4 || new Set(legs.map(l => l.right)).size !== 1 || new Set(legs.map(l => l.expiry)).size !== 2 || new Set(legs.map(l => l.strike)).size !== 2) return null;
  if (new Set(legs.map(l => l.contracts ?? 1)).size !== 1) return null;
  return { name: `${legs[0].right === 'C' ? 'call' : 'put'} double calendar`, kind: 'calendar' };
}

/* The vendor's name checked against the legs: a settled set with no textbook shape says what it did ("2 puts
   bought"); an unsettled one keeps the vendor's word, corrected where strikes or money prove it wrong. */
function vendorChecked(vendor: string, legs: SpreadLeg[], net: number): { name: string; kind?: SpreadKind; by: 'legs' | 'vendor' } | null {
  if (!legs.length) return null;
  const v = vendor === 'unnamed' ? '' : vendor;
  const rights = new Set(legs.map(l => l.right));
  const strikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const settled = legs.every(l => l.side != null);
  if (settled) {
    const sides = new Set(legs.map(l => l.side));
    if (sides.size === 1) {
      const way = legs[0].side === 'BUY' ? 'bought' : 'sold';
      const what = rights.size === 1 ? (legs[0].right === 'C' ? 'calls' : 'puts') : 'calls and puts';
      const exp = new Set(legs.map(l => l.expiry)).size;
      return { name: `${what} ${way} · ${exp > 1 ? `${exp} expiries` : `${strikes.length} strikes`}`, kind: 'custom', by: 'legs' };
    }
    /* settled, but no textbook shape: what the legs did, never the vendor's word unchecked (a "iron condor" that bought
       two puts and a call against one call sold) */
    const nb = legs.filter(l => l.side === 'BUY').length;
    return { name: `custom · ${nb} bought, ${legs.length - nb} sold`, kind: 'custom', by: 'legs' };
  }
  if (/butterfly/.test(v) && !/iron/.test(v) && legs.length === 3 && rights.size === 1 && strikes.length === 3 && strikes[1] - strikes[0] !== strikes[2] - strikes[1] && !/uneven/.test(v)) return { name: `${v} (uneven wings)`, by: 'vendor' };
  if (/iron (condor|butterfly)/.test(v) && !/\b(long|short)\b/.test(v) && net !== 0) return { name: `${net > 0 ? 'long' : 'short'} ${v}`, by: 'vendor' };
  return null;
}

/** Off by more than 2% (and $5) of the larger figure */
const offBy = (a: number | 'uncapped', b: number | 'uncapped') => (a === 'uncapped' || b === 'uncapped' ? a !== b : Math.abs(a - b) > Math.max(5, 0.02 * Math.max(Math.abs(a), Math.abs(b))));
/** The settled legs disagree with the vendor: its stated risk when it gave a direction, else its family */
function contradictsVendor(t: SpreadTrade, range: { maxLoss: number | 'uncapped'; maxProfit: number | 'uncapped' } | null, legsKind: SpreadKind): boolean {
  const vk = t.vendorKind ?? t.kind;
  if (t.vendorDirection === 'unknown') return vk !== 'custom' && legsKind !== vk;
  if (!range || !t.vendorRisk) return false;
  return offBy(range.maxLoss, t.vendorRisk.loss) || offBy(range.maxProfit, t.vendorRisk.profit);
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
  const vendor0 = t.shapeOfVendor ?? t.shape;
  const fromLegs = settled ? nameFromLegs(legs) : doubleCalendarOf(legs);
  const checked = fromLegs ? null : vendorChecked(vendor0, legs, known ? t.netPremium : 0);
  const named0 = fromLegs ?? (checked ? { name: checked.name, kind: checked.kind ?? t.kind } : null);
  const namedBy: 'legs' | 'vendor' = fromLegs || checked?.by === 'legs' ? 'legs' : 'vendor';
  /* A compression package or an after-hours fill keeps its shape's name without bull or bear */
  const unread = !!t.compression || !!t.extended;
  const named = named0 && unread ? { ...named0, name: neutralShape(named0.name) } : named0;
  const vendor = t.shapeOfVendor ?? t.shape;
  const unverified = contradictsVendor(t, range, named?.kind ?? t.kind) || undefined;
  const sideTagged = raw.filter(l => String(l.side) === 'ask' || String(l.side) === 'bid').length;
  return {
    ...t,
    strikesLabel: legStrikes.length ? legStrikes.map(k => strikeWord(k)).join(' / ') : t.strikesLabel,
    shape: named ? named.name : t.shape,
    kind: named ? named.kind : t.kind,
    vendorShape: named && vendor !== 'unnamed' && !named.name.includes(vendor) ? vendor : undefined,
    namedBy,
    legs,
    units,
    contracts: legs.reduce((a, l) => a + (l.contracts ?? 0), 0),
    ratioLabel,
    net: known ? t.netPremium / (units * 100) : 0,
    netAbs,
    maxLoss: range ? range.maxLoss : null,
    maxProfit: range ? range.maxProfit : null,
    riskNote: !settled ? 'unsettled' : !oneExpiry ? 'expiries' : !known ? 'no-net' : undefined,
    unverified,
    ...(() => {
      const th = positionThetaCapped(legs, known ? t.netPremium : undefined);
      return { theta: th ? th.value : NaN, thetaCapped: th?.capped || undefined };
    })(),
    /* what the legs' side tags say: the count, and why a partial set cannot settle it */
    read: known
      ? `${describeStructure(legs, t.netPremium, units, unread)}${t.compression ? ` A compression package (OPRA ${t.code ?? 'cbmo'}) — a floor package that nets open interest down between members, not a bet: shown, never read bullish or bearish.` : t.extended ? ' Filled after hours, against thin post-market quotes — the shape is shown, not read for direction.' : ''}`
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
  const code = String(row.code || '').toLowerCase();
  const dir = String(row.direction || '');
  const vendorDirection = dir === 'long' || dir === 'short' || dir === 'unknown' ? dir : undefined;
  /* the vendor's max_loss is negative dollars; a null max_profit beside a stated loss is uncapped */
  const vLoss = row.max_loss != null && row.max_loss !== '' ? Math.abs(num(row.max_loss)) : null;
  const vendorRisk = vendorDirection && vendorDirection !== 'unknown' && vLoss != null ? { loss: vLoss, profit: row.max_profit != null && row.max_profit !== '' ? Math.abs(num(row.max_profit)) : ('uncapped' as const) } : null;
  /* the far leg's expiry, from max_dte */
  const farDte = row.max_dte != null && row.max_dte !== '' ? num(row.max_dte) : dteAtTrade;
  const farIso = tradeDay && farDte > dteAtTrade ? new Date(Date.parse(`${tradeDay}T00:00:00Z`) + farDte * 86_400_000).toISOString().slice(0, 10) : '';
  return {
    id: String(row.id || `${ticker}-${when.epoch}-${strikes.join('-')}`),
    /* OPRA's condition on the structure (mlet, mlat, cbmo…); cbmo / mctp is a compression package, not a bet */
    code: code || undefined,
    compression: COMPRESSION_CODES.has(code) || undefined,
    minute: when.minute,
    day: tradeDay || undefined,
    epochMs: when.ms || undefined,
    extended: when.minute > 0 && (when.minute < SESSION_OPEN || when.minute >= sessionEndMin(ticker)) ? true : undefined,
    time: when.time,
    ticker,
    kind,
    vendorKind: kind,
    vendorDirection,
    vendorRisk,
    shape: shapeName(strategy),
    shapeOfVendor: shapeName(strategy),
    strikesLabel: strikes.length ? strikes.join(' / ') : '—',
    expiry: expiryIso ? expiryLabel(expiryIso) : '—',
    farExpiry: farIso ? expiryLabel(farIso) : undefined,
    farDte: farIso ? farDte : undefined,
    /* the vendor's min_dte, counted from the trade's own day */
    dte: row.min_dte != null && row.min_dte !== '' ? dteAtTrade : expiryIso ? dteFrom(expiryIso, tradeDay || tapeSessionIso()) : 0,
    /* the vendor's size is its largest leg — the units come from the legs (settleSpread) */
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
    namedBy: 'vendor',
  };
}

/** Rows with their legs settled as they land; the legs are asked for in the rows' order */
function useSettled(pack: LivePack<SpreadTrade[]>): LivePack<SpreadTrade[]> {
  const rev = useLegRev();
  /* legs for the LEGS_TOP largest nets here; the rows on screen are the page's own ask (useLegsFirst) */
  useLegAsker(
    useMemo(() => [...pack.rows].sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium)).slice(0, LEGS_TOP).map(t => t.id), [pack.rows]),
    1
  );
  const rows = useMemo(() => pack.rows.map(settleSpread), [pack.rows, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...pack, rows };
}
const LEGS_FIRST = 20;
const LEGS_TOP = 12;
/** The rows a page shows first under its own cut and order — their legs ahead of the rest */
export function useLegsFirst(ids: string[]): void {
  useLegAsker(useMemo(() => ids.slice(0, LEGS_FIRST), [ids.slice(0, LEGS_FIRST).join(',')]), 0); // eslint-disable-line react-hooks/exhaustive-deps
}

/* One structure once: the vendor can send the same structure under two ids, so rows fold by id, then by ticker,
   second, strategy, strikes, size and money; the repeat count rides on the row. */
function dedupeSpreads(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  const ids = new Set<string>();
  for (const r of rows) {
    const id = String(r.id ?? '');
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    const k = [r.ticker, r.executed_at, r.strategy, Array.isArray(r.strikes) ? r.strikes.join('/') : '', r.size, r.net_premium, r.total_premium, r.leg_count].join('|');
    const had = byKey.get(k);
    if (had) had.__repeats = num(had.__repeats) + 1;
    else byKey.set(k, { ...r });
  }
  return [...byKey.values()];
}

/** The newest structures, `limit` of them: `regular` keeps the regular session's (after the close, walked back from
    16:15 via `untilMs`), `extended` the ones outside it */
export function useSpreads(limit = 80, opts?: { untilMs?: number | null; session?: 'regular' | 'extended'; sinceMs?: number | null; ticker?: string | null }): LivePack<SpreadTrade[]> & { older: OlderPages<SpreadTrade> } {
  const until = opts?.untilMs ?? null;
  const session = opts?.session ?? null;
  const since = opts?.sinceMs ?? null;
  /* a searched name reads its own structures (ticker_symbol), paged the same way */
  const ticker = (opts?.ticker || '').trim().toUpperCase() || null;
  const key = `spreads:${limit}:${until ?? 'live'}:${session ?? 'any'}:${ticker ?? 'mkt'}`;
  const pack = useLive(key, async () => {
      const raw = await getRows(`/option-trades/multi-leg?limit=${limit}${ticker ? `&ticker_symbol=${encodeURIComponent(ticker)}` : ''}${until ? `&older_than=${new Date(until).toISOString()}` : ''}`);
      const rows = await mapWithIndex(dedupeSpreads(raw), r => ({ ...spreadOf(r), repeats: num(r.__repeats) || undefined }));
      return session ? rows.filter(t => (session === 'regular' ? !t.extended : !!t.extended)) : rows;
    }, [], true, SPREADS_POLL_MS, until ? 'day' : 'live');
  /* older structures of the session, 200 a page, as the reader scrolls */
  const older = useOlderPages<SpreadTrade>(key, pack.rows, spreadIdOf, inHand => olderSpreads(inHand, since, session, ticker));
  const settled = useSettled({ ...pack, rows: older.rows });
  return { ...settled, older };
}
const spreadIdOf = (t: SpreadTrade) => t.id;
/* The feed every 15 seconds: its newest 200 cover about ten seconds of a busy session, so a faster poll only re-asks
   legs no one can read */
const SPREADS_POLL_MS = 20_000;

/** One structure, settled from its own legs (the card) — read ahead of the page's queue */
export function useSpreadTrade(trade: SpreadTrade | null): { trade: SpreadTrade | null; waiting: boolean; failed: boolean } {
  const rev = useLegRev();
  const id = trade?.id ?? null;
  useEffect(() => {
    if (id) wantLegsNow([id]);
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

export function useTide(kind: TideKind, name: string, enabled = true): LivePack<TidePoint[]> {
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
  }, [], enabled, MINUTE_POLL_MS);
}
/** The vendor writes its per-minute series once a minute, so they are re-read every 30 seconds in the session and
    held after the close (readDue) */
const MINUTE_POLL_MS = 30_000;

/** One expiry of a name's day — /stock/{t}/flow-per-expiry: premium and contracts by side */
export interface ExpiryFlow {
  expiry: string;
  /** The session the vendor's row is for, YYYY-MM-DD (its `date`) */
  date?: string;
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
          date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : undefined,
          dte: dteFrom(expiry, typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : tapeSessionIso()),
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
  }, [], true, MINUTE_POLL_MS);
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
  /** The minute's New York day, YYYY-MM-DD — the data's own session, named on the page when it is not today's */
  day?: string;
}
export function useNameMinutes(ticker: string | null): LivePack<NameMinute[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `name-minutes:${name}` : 'name-minutes:off',
    async () =>
      (await getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`))
        .map(r => {
          const c = clock(r.tape_time);
          const m = c.minute - 570;
          return {
            day: c.ms > 0 ? nyDateOf(c.ms) : undefined,
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
        /* the regular session: to 16:15 for the index and ETF options that trade then (sessionEndMin) */
        .filter(r => r.min >= 0 && r.min < sessionEndMin(name) - SESSION_OPEN)
        .sort((a, b) => a.min - b.min),
    [],
    !!name,
    MINUTE_POLL_MS
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

/** The pane's lines are the vendor's minutes: a name's net-prem-ticks priced by its one-minute closes; a cut's
    /net-flow/expiry; a sector its own tide. */
export function usePaneFlow(opts: { ticker: string | null; seg: NetFlowSegment; mny: MoneynessKey; zeroDte: boolean; enabled: boolean }): LivePack<PaneFlowPoint[]> {
  const { ticker, seg, mny, zeroDte, enabled } = opts;
  const name = (ticker || '').trim().toUpperCase();
  const key = name ? `pane:${name}` : `pane:${seg}:${mny}:${zeroDte ? '0' : 'w'}`;
  /* The ticks never wait on the bars: the line draws from the ticks the moment they land, priced by the closes once
     those are in */
  /* minute series, read every 15 seconds */
  const ticks = useLive(name ? `pane-ticks:${name}` : 'pane-ticks:off', async () => getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`), [] as Record<string, unknown>[], enabled && !!name, MINUTE_POLL_MS);
  const bars = useLive(name ? `pane-bars:${name}` : 'pane-bars:off', async () => getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?limit=1000`).catch(() => [] as Record<string, unknown>[]), [] as Record<string, unknown>[], enabled && !!name, MINUTE_POLL_MS);
  const named = useMemo<PaneFlowPoint[]>(() => {
    if (!name) return [];
    const close = new Map<number, number>();
    for (const b of bars.rows) close.set(minuteOf(b.start_time), num(b.close));
    let c = 0;
    let p = 0;
    let last = 0;
    const out: PaneFlowPoint[] = [];
    for (const r of [...ticks.rows].sort((a, b) => minuteOf(a.tape_time) - minuteOf(b.tape_time))) {
      const t = minuteOf(r.tape_time);
      if (!t) continue;
      /* The regular session: the running line starts at 09:30 and runs to 16:15 for the index and ETF options that
         trade then */
      const m = clock(r.tape_time).minute;
      if (m < SESSION_OPEN || m >= sessionEndMin(name)) continue;
      c += num(r.net_call_premium);
      p += num(r.net_put_premium);
      last = close.get(t) ?? last;
      out.push({ time: t, callPrem: c, putPrem: p, vol: num(r.call_volume) + num(r.put_volume), price: last });
    }
    return out;
  }, [name, ticks.rows, bars.rows]);
  const cut = useLive(
    name ? 'pane:cut:off' : key,
    async () => {
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
      /* Future minutes come with null figures; they are dropped, so the line ends at the last real minute instead of
         a flat $0 */
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
    [] as PaneFlowPoint[],
    enabled && !name,
    MINUTE_POLL_MS
  );
  return name ? { rows: named, at: ticks.at, fault: ticks.fault, waiting: ticks.waiting } : cut;
}


/* One name's biggest contracts today: the tape is a window, the question is the day, so the screener for the one
   name by the day's premium */
export function useNameTopContracts(ticker: string | null, limit = 3): LivePack<BookContract[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `top-contracts:${name}:${limit}` : 'top-contracts:off',
    async () => mapBook(await getRows(`/screener/option-contracts?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}&order=premium&order_direction=desc`)),
    [],
    !!name
  );
}

/* The whole day, market-wide: the screener's contracts by the day's premium, the day's largest flow alerts, and the
   market tide's running net. */

/** The market's contracts with the most premium today — the screener, the whole day */
export function useDayTopContracts(limit = 5, enabled = true): LivePack<BookContract[]> {
  return useLive(`day-top:${limit}`, async () => mapBook(await getRows(`/screener/option-contracts?limit=${limit}&order=premium&order_direction=desc`)), [], enabled);
}

/** The day's largest flow alerts: the vendor's alerts of `minPremium` and up, filed before `untilMs` (the close), largest
    first, in (or outside) the regular session */
export function useDayBigAlerts(sinceMs: number, untilMs: number | null, session: 'regular' | 'extended', minPremium = 5_000_000, limit = 200, enabled = true): LivePack<FlowPrint[]> {
  return useLive(`day-alerts:${sinceMs}:${untilMs ?? 'live'}:${session}:${minPremium}`, async () => {
    /* the route reaches back days: the day's own, from its 04:00 */
    const rows = markAlertPackages(await mapWithIndex(await getRows(`/option-trades/flow-alerts?limit=${limit}&min_premium=${minPremium}&newer_than=${new Date(sinceMs).toISOString()}${untilMs ? `&older_than=${new Date(untilMs).toISOString()}` : ''}`), alertToPrint));
    return rows.filter(p => (session === 'regular' ? !p.extended : !!p.extended)).sort((a, b) => b.premium - a.premium);
  }, [], enabled);
}

/** The tide's net between two New York minutes [from, to): its running figure at the last point before `to`, less the last
    point before `from` (the tide runs from 07:30, so the regular session's own net is the difference) */
export function tideBetween(rows: { time: number; callPrem: number; putPrem: number }[], from: number, to: number): { calls: number; puts: number; net: number; first: number; last: number } | null {
  let base: { callPrem: number; putPrem: number } | null = null;
  let end: { time: number; callPrem: number; putPrem: number } | null = null;
  let first = 0;
  for (const r of rows) {
    const p = nyParts(new Date(r.time * 1000));
    const m = p.hour * 60 + p.minute;
    if (m < from) base = r;
    else if (m < to) {
      if (!first) first = r.time;
      end = r;
    }
  }
  if (!end) return null;
  const calls = end.callPrem - (base?.callPrem ?? 0);
  const puts = end.putPrem - (base?.putPrem ?? 0);
  return { calls, puts, net: calls - puts, first, last: end.time };
}

/* ---- a stock's whole day of one-minute bars, extended hours included (the cross card) --------------------------- */
export interface StockMinute {
  /** epoch seconds */
  time: number;
  close: number;
  /** New York minute of the day */
  minute: number;
  extended: boolean;
  /** The minute's shares, every venue */
  volume?: number;
}
/** The name's one-minute bars for one New York day: `dateIso` (a cross's own date), else the tape's session */
export function useStockMinutes(ticker: string | null, dateIso: string | null = null): LivePack<StockMinute[]> {
  const name = (ticker || '').trim().toUpperCase();
  const day = dateIso ?? tapeSessionIso();
  return useLive(
    name ? `stock-minutes:${name}:${day}` : 'stock-minutes:off',
    async () => {
      const rows = await getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?date=${day}&limit=1000`);
      return rows
        .map(r => {
          const c = clock(r.start_time || r.time || r.date);
          const nyDay = c.ms > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(c.ms)) : '';
          return { time: c.epoch, close: num(r.close), minute: c.minute, extended: c.minute < SESSION_OPEN || c.minute >= 960, volume: num(r.volume), day: nyDay };
        })
        .filter(r => r.time > 0 && r.close > 0 && r.day === day)
        .sort((a, b) => a.time - b.time)
        .map(({ day: _day, ...r }) => r);
    },
    [],
    !!name
  );
}

/* The Tracker reads each mark by its own contract (/option-contract/{occ}/historic, newest session): volume, open
   interest, last price and the day by side. */
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

/* What a mark is now, like with like: a contract marked off a screener row is read again off that row (close against
   close); a marked print against the contract's newest real trade (fill against fill). */
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

/** A contract's OCC symbol from its parts — "SPY", 763, P, "10/22/2026" → SPY261022P00763000; an index's weekly root
    (SPXW, NDXP…) is the caller's to pass */
export function occOf(root: string, strike: number, right: 'C' | 'P', expiry: string): string | null {
  const m = expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) ?? null;
  const iso = m ? `${m[3]}-${m[1]}-${m[2]}` : expiry.slice(0, 10);
  const d = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d || !(strike > 0) || !root) return null;
  return `${root.toUpperCase()}${d[1].slice(2)}${d[2]}${d[3]}${right}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

/* Endless lists: the newest page is polled; older pages are asked only near the bottom, one at a time in the low
   lane, appended and kept to `cap` until the question changes. */
export interface OlderPages<T> {
  rows: T[];
  state: 'more' | 'loading' | 'end' | 'cap' | 'idle';
  loaded: number;
  loadOlder: () => void;
}
export function useOlderPages<T>(key: string, base: T[], idOf: (r: T) => string, fetchOlder: (inHand: T[], pageNo: number) => Promise<{ rows: T[]; end: boolean }>, enabled = true, cap = 50_000): OlderPages<T> {
  const [older, setOlder] = useState<{ key: string; rows: T[]; pages: number; end: boolean }>({ key, rows: [], pages: 0, end: false });
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const mine = older.key === key ? older : { key, rows: [] as T[], pages: 0, end: false };
  const rows = useMemo(() => {
    if (!mine.rows.length) return base;
    const seen = new Set(base.map(idOf));
    return base.concat(mine.rows.filter(r => !seen.has(idOf(r))));
  }, [base, mine.rows, idOf]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const fetchRef = useRef(fetchOlder);
  fetchRef.current = fetchOlder;
  const capped = rows.length >= cap;
  const loadOlder = useCallback(() => {
    if (!enabled || busy.current || mine.end || capped || !rowsRef.current.length) return;
    busy.current = true;
    setLoading(true);
    const k = key;
    const pageNo = mine.pages + 1;
    fetchRef
      .current(rowsRef.current, pageNo)
      .then(got => setOlder(prev => {
        const cur = prev.key === k ? prev : { key: k, rows: [] as T[], pages: 0, end: false };
        const seen = new Set(cur.rows.map(idOf));
        const fresh = got.rows.filter(r => !seen.has(idOf(r)));
        return { key: k, rows: cur.rows.concat(fresh), pages: pageNo, end: got.end || (fresh.length === 0 && got.rows.length === 0) };
      }))
      .catch(() => {
        /* asked again on the next scroll */
      })
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [enabled, key, mine.end, mine.pages, capped, idOf]);
  return { rows, state: !enabled ? 'idle' : loading ? 'loading' : capped ? 'cap' : mine.end ? 'end' : 'more', loaded: rows.length, loadOlder };
}

/** The older flow alerts, walked back from the oldest in hand (`older_than` its filing) to `sinceMs` */
export async function olderAlerts(inHand: FlowPrint[], sinceMs: number | null, session: 'regular' | 'extended' | null, limit = 100): Promise<{ rows: FlowPrint[]; end: boolean }> {
  const oldest = inHand.reduce((m, p) => Math.min(m, p.createdMs ?? p.epochMs ?? Infinity), Infinity);
  if (!Number.isFinite(oldest) || (sinceMs != null && oldest <= sinceMs)) return { rows: [], end: true };
  /* The cursor is inclusive: one millisecond into the oldest, since alerts are filed in batches sharing a
     created_at; the overlap is dropped by id (useOlderPages) */
  const got = await getRowsLow(`/option-trades/flow-alerts?limit=${limit}&older_than=${new Date(oldest + 1).toISOString()}${sinceMs ? `&newer_than=${new Date(sinceMs).toISOString()}` : ''}`);
  const rows = markAlertPackages(await mapWithIndex(got, alertToPrint));
  return { rows: session ? rows.filter(p => (session === 'regular' ? !p.extended : !!p.extended)) : rows, end: got.length < limit };
}

/** The older structures of the session, walked back from the oldest in hand */
export async function olderSpreads(inHand: SpreadTrade[], sinceMs: number | null, session: 'regular' | 'extended' | null, ticker?: string | null, limit = 200): Promise<{ rows: SpreadTrade[]; end: boolean }> {
  const oldest = inHand.reduce((m, t) => Math.min(m, t.epochMs ?? Infinity), Infinity);
  if (!Number.isFinite(oldest) || (sinceMs != null && oldest <= sinceMs)) return { rows: [], end: true };
  /* The cursor takes in the oldest's whole second (the vendor keeps finer than it shows); the overlap is dropped by
     id (useOlderPages) */
  const raw = await getRowsLow(`/option-trades/multi-leg?limit=${limit}${ticker ? `&ticker_symbol=${encodeURIComponent(ticker)}` : ''}&older_than=${new Date(oldest + 1000).toISOString()}`);
  const all = (await mapWithIndex(dedupeSpreads(raw), r => ({ ...spreadOf(r), repeats: num(r.__repeats) || undefined }))).filter(t => sinceMs == null || (t.epochMs ?? 0) >= sinceMs);
  const rows = session ? all.filter(t => (session === 'regular' ? !t.extended : !!t.extended)) : all;
  const reached = raw.some(r => typeof r.executed_at === 'string' && sinceMs != null && Date.parse(r.executed_at) < sinceMs);
  return { rows, end: raw.length < limit || reached };
}

/** The next page of the screener's book (the route's `page`, 0 first), `limit` a page */
export async function olderBook(pageNo: number, query: string, limit: number): Promise<{ rows: BookContract[]; end: boolean }> {
  const got = await getRowsLow(`/screener/option-contracts?${query}&limit=${limit}&page=${pageNo}`);
  return { rows: await mapBook(got), end: got.length < limit };
}

/** The day's next-largest regular-session crosses, walked down by `max_premium` from the smallest in hand */
export async function olderDarkDay(iso: string, inHand: DarkPoolPrint[], limit = 200): Promise<{ rows: DarkPoolPrint[]; end: boolean }> {
  const floor = inHand.reduce((m, p) => Math.min(m, p.notional), Infinity);
  if (!Number.isFinite(floor) || floor <= 0) return { rows: [], end: true };
  const got = await getRowsLow(`/darkpool/recent?limit=${limit}&date=${iso}&order_by=premium&order=desc&max_premium=${Math.floor(floor)}`);
  const rows = got.filter(r => !r.canceled).map((r, j) => darkPrint(r, inHand.length + j)).filter(p => !p.extended && (!p.dateIso || p.dateIso === iso));
  return { rows, end: got.length < limit };
}
/** One name's older crosses of the day, walked back from the oldest in hand (`older_than`) */
export async function olderNameDark(ticker: string, inHand: DarkPoolPrint[], dayIso: string, limit = 200): Promise<{ rows: DarkPoolPrint[]; end: boolean }> {
  const oldest = inHand.reduce((m, p) => Math.min(m, p.epochMs ?? Infinity), Infinity);
  if (!Number.isFinite(oldest)) return { rows: [], end: true };
  const got = await getRowsLow(`/darkpool/${encodeURIComponent(ticker)}?limit=${limit}&older_than=${oldest}`);
  const mapped = got.filter(r => !r.canceled).map((r, i) => darkPrint(r, inHand.length + i));
  const rows = mapped.filter(p => !p.dateIso || p.dateIso === dayIso);
  return { rows, end: got.length < limit || rows.length < mapped.length };
}

/* lets WatchContext read live spots without importing this module (core/liveSpots.ts) */
import { registerLiveSpots } from '../core/liveSpots';
registerLiveSpots(liveSpotOf);
