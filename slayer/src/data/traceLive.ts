/* Trace's live Unusual Whales reads, mapped onto the rows the pages draw. The browser calls /api/uw; nothing here talks
   to the simulator. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uwCall } from './whales';
import { readSaved, save as saveKept } from './uwStore';
import { vendorFault, type FeedFault } from '../components/ui/liveRead';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolPrint, DarkPoolView } from '../types/darkpool';
import { marketPhase } from '../core/marketPhase';
import { nyParts } from '../core/nyTime';
import type { MoneynessKey, NetFlowSegment, SpreadTrade } from './flowBook';
import { alertToPrint, byNewest, clock, contractRow, coversOf, dteFrom, ensureIndexLevels, ensureSpots, extendedOf, heldFresh, indexRoot, lastRegularClose, likelyOpeningOf, liveSpotOf, liveTrades, mapBook, mapWithIndex, markAlertPackages, nextSessionIso, num, nyDateOf, nyIsoToday, prevSessionIso, printCondition, printKeyOf, printSideOf, rowsOf, SESSION_OPEN, sessionEndLabel, sessionEndMin, tapeSessionIso, type NetCovers, tickerOfRow, tradeToPrint } from './traceRows';
import { dedupeSpreads, settleSpreadWith, spreadOf } from './traceSpreads';
import { type DarkDay, darkDayOf, darkLevels, darkPrint, darkView, mergeDark } from './traceDark';

export { dayLean, LEAN_EDGE, sideShares } from './traceLean';
export * from './traceRows';
export * from './traceSpreads';
export * from './traceDark';

const POLL_MS = 4_000;

export interface LivePack<T> {
  rows: T;
  at: number | null;
  fault: FeedFault | null;
  waiting: boolean;
  /** The rows are an earlier answer (this browser's kept copy, or one read before the page was left), shown "as of"
      `at` while the fresh one loads — never as live */
  kept?: boolean;
}

interface CacheBox<T> {
  /** the request these rows answer — a box for another key is never shown */
  key?: string;
  rows: T;
  at: number | null;
  fault: FeedFault | null;
  kept?: boolean;
  /** When the last read failed — a failed read is asked again on its own beat, not on every check */
  failAt?: number;
}

export { marketPhase, sessionPhase, type MarketPhase,  } from '../core/marketPhase';

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
/* Each read's last answer is kept in this browser (uwStore) under its key, so a reload or a later visit paints it at
   once, "as of" its instant, while the fresh read loads. Written at most once a half minute a key. */
const KEPT_PREFIX = '#trace:';
const KEEP_EVERY_MS = 30_000;
const keptAt = new Map<string, number>();
function keepBox(key: string, rows: unknown): void {
  if (rows == null || (Array.isArray(rows) && rows.length === 0)) return;
  const now = Date.now();
  if (now - (keptAt.get(key) ?? 0) < KEEP_EVERY_MS) return;
  keptAt.set(key, now);
  saveKept(KEPT_PREFIX + key, 200, rows);
}
function restoreBox(key: string, sh: LiveShared): void {
  void readSaved(KEPT_PREFIX + key).then(k => {
    if (!k || sh.box || liveShared.get(key) !== sh) return;
    sh.box = { key, rows: k.data, at: k.at, fault: null, kept: true };
    liveNotify(sh);
  });
}
function liveRun(key: string) {
  const sh = liveShared.get(key);
  if (!sh || sh.running) return;
  sh.running = true;
  sh.load()
    .then(
      rows => {
        sh.box = { key, rows, at: Date.now(), fault: null };
        keepBox(key, rows);
      },
      e => {
        const fault = vendorFault(e instanceof Error ? e.message : 'unusual whales') ?? 'failed';
        const failAt = Date.now();
        sh.box = sh.box && sh.box.key === key ? { ...sh.box, fault, failAt } : { key, rows: sh.empty, at: null, fault, failAt };
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
/* 'fixed': a closed day's answer, read once (again only after a failure) */
type ReadKind = 'day' | 'live' | 'fixed';
const PRE_POLL_MS = 120_000;
const QUIET_POLL_MS = 30_000;
/** In the session the book-like reads (the screener, a name's expiries, contract days) every 8s — they were 4s */
const READ_POLL_MS = 8_000;
const tabHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
/** Is a read stamped `atMs` (null: never read) due again, on a beat of `pollMs`, for its kind */
function readDue(atMs: number | null | undefined, pollMs: number, kind: ReadKind, faulted = false): boolean {
  if (atMs == null) return true;
  if (kind === 'fixed' || tabHidden()) return false;
  const age = Date.now() - atMs;
  if (faulted) return age >= Math.min(pollMs, 20_000) - 250;
  const ph = marketPhase();
  if (kind === 'day') {
    if (heldFresh(atMs)) return false;
    if (ph === 'pre') return age >= PRE_POLL_MS - 250;
  } else if (ph !== 'regular' && ph !== 'late') return age >= Math.max(pollMs, QUIET_POLL_MS) - 250;
  return age >= pollMs - 250;
}

function useLive<T>(key: string, load: () => Promise<T>, empty: T, enabled = true, pollMs = READ_POLL_MS, kind: ReadKind = 'day'): LivePack<T> {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let sh = liveShared.get(key);
    let fresh = false;
    if (!sh) {
      sh = { box: null, subs: new Set(), timer: null, running: false, load, empty };
      liveShared.set(key, sh);
      fresh = true;
    }
    const me = sh;
    me.load = load;
    me.empty = empty;
    /* an answer read before the page was left stays on screen, "as of" its instant, past its keep — unless it is a
       closed session's day, which no longer changes (it stands until the next session) */
    if (!me.subs.size && me.box && me.box.at != null && Date.now() - me.box.at > LIVE_KEEP_MS && !(kind === 'day' && !me.box.fault && heldFresh(me.box.at))) me.box = { ...me.box, kept: true };
    if (!me.subs.size && me.box && me.box.at == null) me.box = null;
    if (fresh) restoreBox(key, me);
    const fn = () => force(n => n + 1);
    me.subs.add(fn);
    if (me.timer == null) {
      const due = (first: boolean) => {
        const b = me.box;
        if (b?.fault) return !me.running && !tabHidden() && Date.now() - (b.failAt ?? 0) >= Math.min(pollMs, 20_000) - 250;
        if (!b || b.at == null || b.kept) return !me.running;
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
  const mine = (sh && sh.box && sh.box.key === key ? sh.box : null) as CacheBox<T> | null;
  return { rows: mine?.rows ?? empty, at: mine?.at ?? null, fault: mine?.fault ?? null, waiting: enabled && !mine, kept: !!mine?.kept };
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
interface NameSpreads extends LivePack<SpreadTrade[]> {
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
  return { rows, at: pack.at, fault: pack.fault, waiting: pack.waiting, kept: pack.kept, session, complete: pack.rows.complete, from };
}

/** One contract's real last trade (/option-contract/{occ}/flow): the card anchors on it. */
interface ContractLast {
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
      const side = printSideOf(r, num(r.price), num(r.nbbo_bid), num(r.nbbo_ask), Date.parse(String(r.executed_at ?? '')));
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
function tapeQueryString(q: TapeQuery, extra?: { newerThan?: number; olderThan?: number; limit?: number }): string {
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

/** One page of the option tape: its prints (cancelled ones dropped), whether the vendor sent a full page, and the
    oldest fill on it (the next page's cursor) */
export async function readTapePage(q: TapeQuery, cursor: { newerThan?: number; olderThan?: number }, limit = TAPE_PAGE, low = false): Promise<{ prints: FlowPrint[]; full: boolean; oldest: number; cancelled: string[] }> {
  const path = `/option-trades?${tapeQueryString(q, { ...cursor, limit })}`;
  const got = low ? await getRowsLow(path) : await getRows(path);
  const live = liveTrades(got);
  /* a print the vendor has since cancelled is retracted from every list that already merged it (retractCancelled) */
  const cancelled = noteCancelled(got);
  await ensureIndexLevels(live.map(tickerOfRow));
  let oldest = 0;
  for (const r of got) {
    const t = Date.parse(String(r.executed_at || ''));
    if (Number.isFinite(t) && (oldest === 0 || t < oldest)) oldest = t;
  }
  return { prints: live.map(r => tradeToPrint(r)), full: got.length >= limit, oldest, cancelled };
}

const printId = (r: FlowPrint) => r.vendorId || String(r.id);

/* Prints the vendor sent as cancelled, by identity (printKeyOf), the newest CANCEL_CAP kept: a cancel that lands after
   its print was merged takes the print back out of the tape, the shelf and every buffer that merges again */
const CANCEL_CAP = 20_000;
const cancelledIds = new Set<string>();
let cancelRev = 0;
/** Note the cancelled rows of a page; returns their identities */
export function noteCancelled(rows: readonly Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.canceled !== true && r.canceled !== 'true') continue;
    const k = printKeyOf(r);
    out.push(k);
    if (!cancelledIds.has(k)) {
      cancelledIds.add(k);
      cancelRev++;
    }
  }
  if (cancelledIds.size > CANCEL_CAP) for (const k of [...cancelledIds].slice(0, cancelledIds.size - CANCEL_CAP)) cancelledIds.delete(k);
  return out;
}
/** The list with every print since cancelled taken out (the same array when none was) */
export function retractCancelled<T extends { vendorId?: string; id: number | string }>(list: T[]): T[] {
  if (!cancelledIds.size) return list;
  const out = list.filter(r => !cancelledIds.has(r.vendorId || String(r.id)));
  return out.length === list.length ? list : out;
}

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

export function mergePrints(prev0: FlowPrint[], incoming: FlowPrint[], where: 'front' | 'back'): FlowPrint[] {
  const prev = retractCancelled(prev0);
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

function publishPrints(rows: readonly FlowPrint[]): void {
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
    const had = tapeShelf.get(name) ?? [];
    const prev = retractCancelled(had);
    if (prev !== had) changed = true;
    const seen = new Set(prev.map(p => p.vendorId || String(p.id)));
    const fresh = retractCancelled(incoming).filter(p => !seen.has(p.vendorId || String(p.id)));
    if (!fresh.length) {
      if (prev !== had) tapeShelf.set(name, prev);
      continue;
    }
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
interface PrintStream extends LivePack<FlowPrint[]> {
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

/* The streams a page held, by question, so a page left and opened again stands at once */
const streamStore = new Map<string, { rows: FlowPrint[]; at: number; hasOlder: boolean; newest: number }>();
const STREAM_STORE_MAX = 6;
const TAPE_KEPT = '#tape:';

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
  /* the window is part of the key: a regular/extended keep or a new start must not keep the other session's rows */
  const keepTag = opts?.keep ? opts.keep.toString() : 'all';
  const storeKey = `${tapeQueryString(query)}|${untilMs ?? 'live'}|${startMs ?? 'open'}|${keepTag}`;
  const key = `${storeKey}|${nonce}`;
  const [rows, setRows] = useState<FlowPrint[]>([]);
  /* the rows on screen are an earlier answer (kept in this browser, or read before the page was left) until a read lands */
  const [kept, setKept] = useState(false);
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
    setKept(false);
    /* back on the page: the rows it held stand at once and the poll joins them to the newest; a closed session's
       stream is whole and is not read again */
    const had = nonce === 0 ? streamStore.get(storeKey) : undefined;
    if (had) {
      newest.current = had.newest;
      setRows(had.rows);
      setAt(had.at);
      setHasOlder(had.hasOlder);
      setWaiting(false);
      setKept(!untilMs && Date.now() - had.at > STREAM_IDLE_MS);
    }
    /* a page's fullness is the vendor's row count, so a cancelled print dropped from a full page never ends the walk */
    const page = async (cursor: { newerThan?: number; olderThan?: number }, limit = TAPE_PAGE): Promise<FlowPrint[] & { full?: boolean; oldest?: number }> => {
      const capped0 = untilMs && (!cursor.olderThan || cursor.olderThan > untilMs) ? { ...cursor, olderThan: untilMs } : cursor;
      /* nothing before the session's start (a name's 2,000 prints can reach into the day before) */
      const capped = startRef.current && !capped0.newerThan ? { ...capped0, newerThan: startRef.current - 1 } : capped0;
      const got = await readTapePage(query, capped, limit);
      if (stop) return [];
      const keep = keepRef.current;
      const out: FlowPrint[] & { full?: boolean; oldest?: number } = keep ? got.prints.filter(keep) : got.prints;
      out.full = got.full;
      out.oldest = got.oldest;
      return out;
    };
    /** Everything newer than `sinceMs`, newest first; `joined` false when the walk stopped short of it */
    const newerThan = async (sinceMs: number, firstLimit = TAPE_PAGE): Promise<{ batch: FlowPrint[]; joined: boolean }> => {
      let acc: FlowPrint[] = [];
      let olderThan: number | undefined;
      for (let n = 0; n < GAP_PAGES && !stop; n++) {
        /* the newest page carries no time cursor, so every viewer's poll is the same request (the proxy serves one copy);
           older pages walk back from the data's own oldest print. An idle tape asks a small first page (a 500-print page
           is ~600 KB); a full one walks on in whole pages. */
        const got = await page({ olderThan }, n === 0 ? firstLimit : TAPE_PAGE);
        const fresh = sinceMs > 0 ? got.filter(r => msOf(r) >= sinceMs) : got;
        acc = dedupe(acc.concat(fresh));
        if (!got.full || (sinceMs > 0 && (got.oldest || oldestMs(got)) <= sinceMs)) return { batch: acc, joined: true };
        const oldest = got.oldest || oldestMs(got);
        const next = oldest + 1;
        if (!next || (olderThan != null && next >= olderThan)) break;
        /* a gap the walk's remaining pages cannot cover at this page's pace (the open prints ~1,000 a second) is not
           walked: the newest page stands alone and older pages load as the reader scrolls */
        const span = newestMs(got) - oldest;
        if (sinceMs > 0 && span > 0 && ((oldest - sinceMs) / span) > GAP_PAGES - 1 - n) break;
        olderThan = next;
      }
      return { batch: acc, joined: sinceMs <= 0 };
    };
    const boot = async () => {
      filling.current = true;
      /* a reload paints the first page this browser kept, "as of" its instant, while the fresh one loads */
      let landed = false;
      if (nonce === 0) {
        void readSaved(TAPE_KEPT + storeKey).then(k => {
          if (stop || landed || !k || !Array.isArray(k.data) || !k.data.length) return;
          setRows(k.data as FlowPrint[]);
          setAt(k.at);
          setWaiting(false);
          setKept(true);
        });
      }
      try {
        const first = await page({});
        if (stop) return;
        landed = true;
        let held = dedupe(first);
        newest.current = newestMs(held);
        setRows(held);
        setKept(false);
        setAt(Date.now());
        setFault(null);
        setWaiting(false);
        if (held.length) saveKept(TAPE_KEPT + storeKey, 200, held.slice(0, TAPE_PAGE));
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
    if (!had) void boot();
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
        const revBefore = cancelRev;
        const { batch, joined } = await newerThan(newest.current - LATE_MS, lastCount >= STREAM_IDLE_PAGE ? TAPE_PAGE : STREAM_IDLE_PAGE);
        lastCount = batch.length;
        /* a cancel on this poll's pages takes its print back out even when nothing new landed */
        if (!stop && cancelRev !== revBefore && !batch.length) {
          setRows(prev => retractCancelled(prev));
          setPending(prev => retractCancelled(prev));
        }
        if (!stop && !batch.length) {
          setKept(false);
          setAt(Date.now());
        }
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
        setKept(false);
        setAt(Date.now());
        setFault(null);
      } catch {
        /* a missed poll keeps the prints already in hand; the next one walks back to them */
      } finally {
        polling = false;
        if (!stop) beat();
      }
    };
    /* a returning live stream asks for what it missed at once */
    if (!untilMs) {
      if (had) void tick();
      else beat();
    }
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
    void readTapePage(query, { olderThan: oldest + 1, newerThan: start ? start - 1 : undefined }, TAPE_PAGE, true)
      .then(got => {
        const keep = keepRef.current;
        const batch = keep ? got.prints.filter(keep) : got.prints;
        setRows(prev0 => {
          const prev = retractCancelled(prev0);
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
        if (!got.full) {
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
  const raw = fresh ? rows : EMPTY_PRINTS;
  /* a window change drops what no longer belongs even before the new read lands */
  const shown = useMemo(() => {
    if (!raw.length) return raw;
    const keep = opts?.keep;
    if (!keep && startMs == null && untilMs == null) return raw;
    const next = raw.filter(p => {
      const ms = p.epochMs ?? (p.epoch ? p.epoch * 1000 : 0);
      if (startMs != null && ms > 0 && ms < startMs) return false;
      if (untilMs != null && ms > untilMs) return false;
      return keep ? keep(p) : true;
    });
    return next.length === raw.length ? raw : next;
  }, [raw, startMs, untilMs, opts?.keep]);
  /* what the page holds, for its return */
  useEffect(() => {
    if (!fresh || !rows.length || kept) return;
    streamStore.delete(storeKey);
    streamStore.set(storeKey, { rows, at: at ?? Date.now(), hasOlder, newest: newest.current });
    while (streamStore.size > STREAM_STORE_MAX) streamStore.delete(streamStore.keys().next().value as string);
  }, [fresh, rows, kept, storeKey, at, hasOlder]);
  useEffect(() => {
    if (shown.length) publishPrints(shown);
  }, [shown]);
  return {
    rows: shown,
    at: fresh ? at : null,
    fault: fresh ? fault : null,
    waiting: !fresh || (waiting && rows.length === 0),
    kept: fresh && kept,
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

/** Dark or lit prints, accumulating across polls. The recent route caps at 200 and has no older cursor. */
/* `enabled`: nothing is read while it is off */
/* the newest crosses, merged as they come; the merged list outlives the page */
const accumRows = new Map<string, DarkPoolPrint[]>();
export function useAccumTape(kind: 'dark' | 'lit', limit: number, enabled = true): LivePack<DarkPoolPrint[]> {
  const path = kind === 'dark' ? `/darkpool/recent?limit=${Math.min(200, limit)}` : `/lit-flow/recent?limit=${Math.min(200, limit)}`;
  /* every 8s in the session, every 30s outside it, never in a hidden tab */
  return useLive(
    `accum:${path}`,
    async () => {
      const got = await getRows(path);
      const batch = got.filter(r => !r.canceled).map((r, i) => darkPrint(r, i, 0, kind)); // a cancelled print never traded
      /* and a cancel that lands after its print was merged takes it back out */
      const gone = new Set(got.filter(r => r.canceled === true || r.canceled === 'true').map((r, i) => darkPrint(r, i, 0, kind).id));
      const next = mergeDark(accumRows.get(path) ?? [], batch, gone);
      accumRows.set(path, next);
      return next;
    },
    [],
    enabled,
    READ_POLL_MS,
    'live'
  );
}

/* The day's regular-session crosses after the close: the recent route ordered by dollars, walked down by max_premium
   (three pages of 200). The page says it holds the day's largest. */
export function useDarkRegularDay(iso: string | null): LivePack<DarkPoolPrint[]> {
  /* a closed session does not change: read once (three pages), and again only to retry a read that failed */
  return useLive(
    iso ? `dark-day-top:${iso}` : 'dark-day-top:off',
    async () => {
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
      const seen = new Set<number>();
      return out.filter(p => !seen.has(p.id) && (seen.add(p.id), true)).sort(byNewest);
    },
    [],
    !!iso,
    READ_POLL_MS,
    'fixed'
  );
}

/* The day's regular-session lit prints after the close, name by name ($500K and up, walked back from 16:00) for the
   names heaviest in the dark, since the lit feed has no older cursor. Read once. */
export function useLitRegularDay(close: { iso: string; closeMs: number } | null, names: string[]): LivePack<DarkPoolPrint[]> {
  const key = close && names.length ? `${close.iso}:${names.join(',')}` : null;
  return useLive(
    key ? `lit-day:${key}` : 'lit-day:off',
    async () => {
      const out: DarkPoolPrint[] = [];
      for (const n of names) {
        const got = await getRows(`/lit-flow/${encodeURIComponent(n)}?date=${close!.iso}&older_than=${close!.closeMs}&min_premium=500000&limit=200`);
        /* the session's New York day only: `?date=` with `older_than` does not hold the route to the day */
        out.push(...got.filter(r => !r.canceled).map((r, i) => darkPrint(r, out.length + i, 0, 'lit')).filter(p => !p.extended && p.dateIso === close!.iso));
      }
      const seen = new Set<number>();
      return out.filter(p => !seen.has(p.id) && (seen.add(p.id), true)).sort(byNewest);
    },
    [],
    !!key,
    READ_POLL_MS,
    'fixed'
  );
}

/** The stock's last trade and the day's volume — /stock/{t}/quote */
interface StockLast {
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
/* last_trade.vol is the day's running share volume as of the last trade, not that trade's size (verified live, AAPL
   Oct 30: last_trade.vol 67,841,550 beside stock-state total_volume 67,846,959) — pre-market and after hours included */
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
/** Cumulative share volume for one dated session: regular stops at 16:00 (its cumulative total then, pre-market
    included); extended is the whole day to 20:00 — the dark share's divisor */
function datedDayVolume(bars: Record<string, unknown>[], session: 'regular' | 'extended'): number {
  let maxAll = 0;
  let maxReg = 0;
  for (const b of bars) {
    const tv = num(b.total_volume);
    if (tv > maxAll) maxAll = tv;
    const c = clock(b.start_time || b.time || b.date);
    if (c.minute >= SESSION_OPEN && c.minute < 960 && tv > maxReg) maxReg = tv;
  }
  return session === 'regular' ? maxReg || maxAll : maxAll;
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
function tickerKnown(name: string): Promise<boolean> {
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
        /* uwCall has already unwrapped the vendor's { data } box: a carried name answers its state, an unknown one null */
        const state = d != null && typeof d === 'object' && 'data' in d ? d.data : d;
        return state != null;
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
export function useNameDark(ticker: string | null, untilMs: number | null = null, session: 'regular' | 'extended' = 'regular', dateIso: string | null = null): LivePack<{ view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null; unknown?: boolean }> {
  const name = (ticker || '').trim().toUpperCase();
  /* with `untilMs` (the stock close, after the bell) the name's crosses are walked back from the close; `session`
     drops the other side — regular leaves out premarket and after hours, extended leaves out the regular session */
  const cut = untilMs ? `&older_than=${untilMs}` : '';
  const day0 = dateIso || (untilMs ? nyDateOf(untilMs) : nyIsoToday());
  return useLive(
    name ? `name-dark:${name}:${untilMs ?? 'live'}:${session}:${day0}` : 'name-dark:off',
    async () => {
      if (!name) return { view: null, lit: [] as DarkPoolPrint[], day: null };
      /* a name the vendor does not carry is said so, and nothing else is asked for it */
      if (!(await tickerKnown(name))) return { view: null, lit: [] as DarkPoolPrint[], day: null, unknown: true };
      const [prints, levels, lit, quote, bars] = await Promise.all([
        getRows(`/darkpool/${encodeURIComponent(name)}?limit=200${cut}`),
        /* (beside them, the name's screener row, cached a minute: its average day sizes the posture's prints) */
        getRows(`/darkpool/${encodeURIComponent(name)}/price-levels?date=${day0}`).catch(() => [] as Record<string, unknown>[]),
        getRows(`/lit-flow/${encodeURIComponent(name)}?limit=200${cut}`).catch(() => [] as Record<string, unknown>[]),
        stockLastOf(name),
        getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?date=${day0}&limit=1000`).catch(() => [] as Record<string, unknown>[]),
        ensureSpots([name]),
      ]);
      /* the session's New York day, and only the session that was picked */
      const inSession = (p: DarkPoolPrint) => (session === 'regular' ? !p.extended : !!p.extended);
      const onDay = (p: DarkPoolPrint) => (!p.dateIso || p.dateIso === day0) && inSession(p);
      const mapped = prints.filter(r => !r.canceled).map((r, i) => darkPrint(r, i)).filter(onDay);
      /* the stock's own last trade, never a cross's price (a cross may be an own-terms print far off the market); with no
         quote there is no spot, and nothing is placed against one */
      const spot = quote.price > 0 ? quote.price : 0;
      /* one dark share in the app (data/darkBaseline.ts): the day's price levels hold the whole day's dark shares, so they
         are divided by the whole day's volume, pre-market to 20:00, in either session view — the same figure the
         20-session baseline compares. Over the volume to 16:00 it read AAPL 57% against the baseline's 40.1%. */
      const dayVol = datedDayVolume(bars, 'extended');
      const dayRaw = darkDayOf(levels, dayVol);
      const day = dayRaw ? { ...dayRaw, iso: day0 } : null;
      return { view: darkView(name, mapped, darkLevels(levels, spot, mapped), spot, day && Number.isFinite(day.sharePct) ? day.sharePct : 0), lit: lit.filter(r => !r.canceled).map((r, i) => darkPrint(r, i, 0, 'lit')).filter(onDay), day };
    },
    { view: null, lit: [], day: null } as { view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null; unknown?: boolean },
    !!name,
    READ_POLL_MS,
    untilMs ? 'day' : 'live'
  );
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

/** The next session's count for a contract (its vendor symbol) traded on `sessionIso`, from what pairOiFor has already
    read — never asks: { oi, before } once paired; null or undefined when not to hand */
export function nextOiOf(occ: string, sessionIso: string): { oi: number; before: number } | null | undefined {
  return newestOiCache.get(`${occ}:${nextSessionIso(sessionIso)}`);
}
/** Called whenever pairOiFor's counts change; returns the unsubscribe */
export function onNextOi(f: () => void): () => void {
  newestOiListeners.add(f);
  return () => {
    newestOiListeners.delete(f);
  };
}

/** The rows with the open interest of their volume's session wherever it is out (see above) */
function usePairedOi(rows: BookContract[], only?: string): BookContract[] {
  const [ver, setVer] = useState(newestOiVer);
  useEffect(() => {
    const f = () => setVer(newestOiVer);
    newestOiListeners.add(f);
    return () => {
      newestOiListeners.delete(f);
    };
  }, []);
  useEffect(() => {
    /* a name's book pairs that name's rows only — the market's rows behind them are another page's */
    const mine = only ? rows.filter(r => r.ticker === only) : rows;
    if (mine.length) void loadNewestOi([...mine].sort((a, b) => b.premium - a.premium).slice(0, OI_FIRST));
  }, [rows, only]);
  return useMemo(() => {
    void ver;
    return rows.map(r => {
      const vol = volDayOf(r);
      const next = nextSessionIso(vol);
      const hit = r.optionSymbol ? newestOiCache.get(`${r.optionSymbol}:${next}`) : undefined;
      /* likelyOpening (likelyOpeningOf): a flag beside the row, its classifications untouched */
      if (!hit) return { ...r, volDay: vol, oiDay: prevSessionIso(vol), oiPending: !r.expired, likelyOpening: likelyOpeningOf(r) };
      return {
        ...r,
        likelyOpening: likelyOpeningOf(r, hit),
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
interface EndlessBook extends LivePack<BookContract[]> {
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
      return readBook('limit=200&order=premium&order_direction=desc');
    },
    [],
    enabled
  );
}
/** One name's 80 heaviest contracts */
function useNameBookRaw(name: string, enabled: boolean): LivePack<BookContract[]> {
  return useLive(name ? `book-name:${name}` : 'book-name:off', () => readBook(`ticker_symbol=${encodeURIComponent(name)}&limit=80&order=premium&order_direction=desc`), [], enabled && !!name);
}
/** The screener's contracts for a query, as book rows */
export async function readBook(query: string): Promise<BookContract[]> {
  return mapBook(await getRows(`/screener/option-contracts?${query}`));
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
  const rows = usePairedOi(merged, name || undefined);
  const waiting = market.waiting || (!!name && named.waiting);
  return useMemo(() => ({ rows, at: market.at, fault: market.fault, waiting, kept: market.kept, older: endless && !name ? older : undefined }), [rows, market.at, market.fault, market.kept, waiting, endless, name, older]);
}
/** A searched name's own book by the day's premium, paged on scroll; without a name, the market's */
export function useSearchBook(name: string | null | undefined): EndlessBook & { name: string | null } {
  const t = (name || '').trim().toUpperCase() || null;
  const market = useLiveBook(null, !t, true);
  const q = t ? `ticker_symbol=${encodeURIComponent(t)}&order=premium&order_direction=desc` : '';
  const key = `namebook:${t ?? 'off'}`;
  const pack = useLive(key, () => readBook(`${q}&limit=200&page=0`), [] as BookContract[], !!t);
  const older = useOlderPages(key, pack.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, q, 200), !!t);
  const rows = usePairedOi(older.rows);
  const named = useMemo(() => ({ ...pack, rows, older }), [pack.at, pack.fault, pack.waiting, pack.kept, rows, older.state, older.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const pack = useLive(key, () => readBook(`limit=200&${q}`), [], enabled);
  const older = useOlderPages(key, pack.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, q, 200), enabled);
  const rows = usePairedOi(older.rows);
  return useMemo(() => ({ ...pack, rows, older }), [pack.at, pack.fault, pack.waiting, pack.kept, rows, older.state, older.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One name's contracts expiring on `iso` (its same-day book), by the day's premium, paged on scroll */
export function useSameDayBook(name: string | null, iso: string): EndlessBook {
  const t = (name || '').trim().toUpperCase();
  const q = `ticker_symbol=${encodeURIComponent(t)}&expiry_dates[]=${iso}&order=premium&order_direction=desc`;
  const key = `sameday:${t}:${iso}`;
  const pack = useLive(t ? key : 'sameday:off', () => readBook(`${q}&limit=200`), [] as BookContract[], !!t);
  const older = useOlderPages(key, pack.rows, bookIdOf, (_inHand, pageNo) => olderBook(pageNo, q, 200), !!t);
  return useMemo(() => ({ ...pack, rows: older.rows, older }), [pack.at, pack.fault, pack.waiting, pack.kept, older.rows, older.state, older.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The newest flow alerts — or, with `opts.untilMs`, the newest filed before that instant (the regular session's last
    alerts, after the close); `opts.session` keeps only the alerts whose fills sat in (or outside) the regular session */
export function useFlowAlerts(limit = 50, opts?: { untilMs?: number | null; session?: 'regular' | 'extended' | null; enabled?: boolean }): LivePack<FlowPrint[]> {
  const until = opts?.untilMs ?? null;
  const session = opts?.session ?? null;
  /* walked back from a close, the alerts are that day's and do not change; the newest are live */
  return useLive(`alerts:${limit}:${until ?? 'live'}:${session ?? 'any'}`, () => readAlerts(limit, until, session), [], opts?.enabled ?? true, READ_POLL_MS, until ? 'day' : 'live');
}
/** The newest `limit` flow alerts filed before `until` (or now), in (or outside) the regular session */
export async function readAlerts(limit: number, until: number | null, session: 'regular' | 'extended' | null): Promise<FlowPrint[]> {
  const rows = markAlertPackages(await mapWithIndex(await getRows(`/option-trades/flow-alerts?limit=${limit}${until ? `&older_than=${new Date(until).toISOString()}` : ''}`), alertToPrint));
  return session ? rows.filter(p => (session === 'regular' ? !p.extended : !!p.extended)) : rows;
}

export function useAlertTrades(id: string | null): LivePack<FlowPrint[]> {
  return useLive(id ? `alert-trades:${id}` : 'alert-trades:off', async () => mapWithIndex(liveTrades(await getRows(`/option-trades/flow-alerts/${encodeURIComponent(id!)}`)), tradeToPrint), [], !!id);
}

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
/* A structure's legs never change: the answer this browser kept for its legs route stands in for a read */
const legKeptTried = new Set<string>();
async function primeKeptLegs(ids: string[]): Promise<void> {
  const want = ids.filter(id => legOpen(id) && !legKeptTried.has(id));
  if (!want.length) return;
  for (const id of want) legKeptTried.add(id);
  const got = await Promise.all(want.map(id => readSaved(`/option-trades/multi-leg/${encodeURIComponent(id)}/legs`).then(k => [id, k] as const)));
  let any = false;
  for (const [id, k] of got) {
    const rows = k ? rowsOf(k.data) : [];
    if (rows.length && !legRaw.has(id)) {
      legRaw.set(id, rows);
      any = true;
    }
  }
  if (any) legNotify();
}
/** One structure's raw legs, read straight (no queue, no keep) */
export async function readLegRows(id: string): Promise<Record<string, unknown>[]> {
  return getRows(`/option-trades/multi-leg/${encodeURIComponent(id)}/legs`);
}
function pumpLegs() {
  /* an opened card's structure first, at once */
  while (legCard.length && legBusy < 2) {
    const id = legCard.shift()!;
    if (legOpen(id)) readLegs(id, false);
  }
  if (legBusy > 0) return;
  /* a hidden tab asks nothing; the queue picks up when it is shown */
  if (tabHidden()) {
    if (legTimer == null) legTimer = window.setTimeout(() => {
      legTimer = null;
      pumpLegs();
    }, 5_000);
    return;
  }
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
  void primeKeptLegs(ids).then(() => {
    for (const id of ids) if (legOpen(id) && !legCard.includes(id)) legCard.unshift(id);
    pumpLegs();
  });
}
/** One asker's list of structures, in its order — it replaces that asker's last list; null withdraws it */
function askLegs(asker: string, ids: string[] | null, rank: number) {
  if (!ids || !ids.length) legAsks.delete(asker);
  else legAsks.set(asker, { order: rank * 1_000_000 + (legAsks.get(asker)?.order ?? ++legAskSeq) % 1_000_000, ids });
  void primeKeptLegs(ids ?? []).then(pumpLegs);
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

/** The structure the row stands for, settled from its legs once they are in hand */
function settleSpread(t: SpreadTrade): SpreadTrade {
  return settleSpreadWith(t, legRaw.get(t.id));
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

/** The newest structures, `limit` of them: `regular` keeps the regular session's (after the close, walked back from
    16:15 via `untilMs`), `extended` the ones outside it */
export function useSpreads(limit = 80, opts?: { untilMs?: number | null; session?: 'regular' | 'extended'; sinceMs?: number | null; ticker?: string | null }): LivePack<SpreadTrade[]> & { older: OlderPages<SpreadTrade> } {
  const until = opts?.untilMs ?? null;
  const session = opts?.session ?? null;
  const since = opts?.sinceMs ?? null;
  /* a searched name reads its own structures (ticker_symbol), paged the same way */
  const ticker = (opts?.ticker || '').trim().toUpperCase() || null;
  const key = `spreads:${limit}:${until ?? 'live'}:${session ?? 'any'}:${ticker ?? 'mkt'}`;
  const pack = useLive(key, () => readSpreads(limit, ticker, until, session), [], true, SPREADS_POLL_MS, until ? 'day' : 'live');
  /* older structures of the session, 200 a page, as the reader scrolls */
  const older = useOlderPages<SpreadTrade>(key, pack.rows, spreadIdOf, inHand => olderSpreads(inHand, since, session, ticker));
  const settled = useSettled({ ...pack, rows: older.rows });
  return { ...settled, older };
}
/** The newest `limit` structures (a name's with `ticker`) filed before `until`, in (or outside) the regular session —
    unsettled until their legs are read */
export async function readSpreads(limit: number, ticker: string | null, until: number | null, session: 'regular' | 'extended' | null): Promise<SpreadTrade[]> {
  const raw = await getRows(`/option-trades/multi-leg?limit=${limit}${ticker ? `&ticker_symbol=${encodeURIComponent(ticker)}` : ''}${until ? `&older_than=${new Date(until).toISOString()}` : ''}`);
  const rows = await mapWithIndex(dedupeSpreads(raw), r => ({ ...spreadOf(r), repeats: num(r.__repeats) || undefined }));
  return session ? rows.filter(t => (session === 'regular' ? !t.extended : !!t.extended)) : rows;
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

type TideKind = 'market' | 'sector' | 'etf';

interface TidePoint {
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
  return useLive(`tide:${kind}:${name}`, () => readTide(path), [], enabled, MINUTE_POLL_MS);
}
/** A tide's minutes: running net call and put premium from the vendor's day start */
export async function readTide(path: string): Promise<TidePoint[]> {
  return (await getRows(path)).filter(r => r.net_call_premium != null && r.net_put_premium != null).map(r => ({
    time: clock(r.timestamp || r.date).epoch,
    callPrem: num(r.net_call_premium),
    putPrem: num(r.net_put_premium),
    volume: Math.abs(num(r.net_volume)),
    price: num(r.close || r.price),
  })).filter(p => p.time > 0);
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
  return useLive(name ? `fpe:${name}` : 'fpe:off', () => readFlowPerExpiry(name), [], !!name);
}
/** A name's day by expiry: net premium (ask less bid) and contracts by side */
export async function readFlowPerExpiry(name: string): Promise<ExpiryFlow[]> {
  return (await getRows(`/stock/${encodeURIComponent(name)}/flow-per-expiry`)).map(r => {
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
      });
}

interface TopNet {
  ticker: string;
  net: number;
  volume: number;
  count: number;
}

export function useTopNet(limit = 40): LivePack<TopNet[]> {
  return useLive(`top-net:${limit}`, () => readTopNet(limit), [], true, MINUTE_POLL_MS);
}
/** The vendor's most bullish and most bearish names by the day's net premium */
export async function readTopNet(limit: number): Promise<TopNet[]> {
  return (await getRows(`/market/top-net-impact?limit=${limit}`)).map(r => ({
    ticker: String(r.ticker || '').toUpperCase(),
    net: num(r.net_premium),
    volume: num(r.volume),
    count: num(r.count) || 1,
  }));
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
  return useLive(name ? `name-minutes:${name}` : 'name-minutes:off', () => readNameMinutes(name), [], !!name, MINUTE_POLL_MS);
}
/** A name's regular session minute by minute (net-prem-ticks) */
export async function readNameMinutes(name: string): Promise<NameMinute[]> {
  return (await getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`))
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
        .sort((a, b) => a.min - b.min);
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
export function usePaneFlow(opts: { ticker: string | null; seg: NetFlowSegment; mny: MoneynessKey; zeroDte: boolean; enabled: boolean }): LivePack<PaneFlowPoint[]> & { covers: NetCovers } {
  const { ticker, seg, mny, zeroDte, enabled } = opts;
  const name = (ticker || '').trim().toUpperCase();
  const key = name ? `pane:${name}` : `pane:${seg}:${mny}:${zeroDte ? '0' : 'w'}`;
  /* The ticks never wait on the bars: the line draws from the ticks the moment they land, priced by the closes once
     those are in */
  /* minute series, read every 15 seconds */
  const ticks = useLive(name ? `pane-ticks:${name}` : 'pane-ticks:off', async () => getRows(`/stock/${encodeURIComponent(name)}/net-prem-ticks`), [] as Record<string, unknown>[], enabled && !!name, MINUTE_POLL_MS);
  const bars = useLive(name ? `pane-bars:${name}` : 'pane-bars:off', async () => getRows(`/stock/${encodeURIComponent(name)}/ohlc/1m?limit=1000`).catch(() => [] as Record<string, unknown>[]), [] as Record<string, unknown>[], enabled && !!name, MINUTE_POLL_MS);
  const named = useMemo<PaneFlowPoint[]>(() => (name ? paneFromTicks(name, ticks.rows, bars.rows) : []), [name, ticks.rows, bars.rows]);
  const cut = useLive(name ? 'pane:cut:off' : key, () => readPaneCut(seg, mny, zeroDte), [] as PaneFlowPoint[], enabled && !name, MINUTE_POLL_MS);
  const covers = useMemo(() => (name ? paneCovers(name, named) : cutCovers(seg, mny, zeroDte, cut.rows)), [name, named, seg, mny, zeroDte, cut.rows]);
  return name ? { rows: named, at: ticks.at, fault: ticks.fault, waiting: ticks.waiting, kept: ticks.kept, covers } : { ...cut, covers };
}

/** What a name's pane line covers: its regular session's minute ticks, every expiry and strike, from 09:30 — a cut's
    line or the tide runs from the vendor's own day start (07:30), so the two are said apart */
export function paneCovers(name: string, points: readonly PaneFlowPoint[]): NetCovers {
  return coversOf(points, 'net-prem-ticks', ['pre-market', `after ${sessionEndLabel(name)}`]);
}
/** What a cut's line covers: the vendor's net flow by expiry (or a sector's tide) from its first minute */
export function cutCovers(seg: NetFlowSegment, mny: MoneynessKey, zeroDte: boolean, points: readonly PaneFlowPoint[]): NetCovers {
  if (seg.startsWith('sector:')) return coversOf(points, 'sector tide', []);
  return coversOf(points, 'net flow by expiry', [...(mny !== 'all' ? [`strikes not ${mny.toUpperCase()}`] : []), zeroDte ? 'expiries after today' : 'expiries past the week']);
}

/** A name's running net call and put premium through its regular session, priced by its one-minute closes */
export function paneFromTicks(name: string, ticks: Record<string, unknown>[], bars: Record<string, unknown>[]): PaneFlowPoint[] {
  const close = new Map<number, number>();
  for (const b of bars) close.set(minuteOf(b.start_time), num(b.close));
  let c = 0;
  let p = 0;
  let last = 0;
  const out: PaneFlowPoint[] = [];
  for (const r of [...ticks].sort((a, b) => minuteOf(a.tape_time) - minuteOf(b.tape_time))) {
    const t = minuteOf(r.tape_time);
    if (!t) continue;
    /* the regular session: from 09:30 to 16:15 for the index and ETF options that trade then */
    const m = clock(r.tape_time).minute;
    if (m < SESSION_OPEN || m >= sessionEndMin(name)) continue;
    c += num(r.net_call_premium);
    p += num(r.net_put_premium);
    last = close.get(t) ?? last;
    out.push({ time: t, callPrem: c, putPrem: p, vol: num(r.call_volume) + num(r.put_volume), price: last });
  }
  return out;
}

/** A cut's minutes: a sector's tide, else the vendor's net flow by moneyness and expiry (same-day or weekly) */
export async function readPaneCut(seg: NetFlowSegment, mny: MoneynessKey, zeroDte: boolean): Promise<PaneFlowPoint[]> {
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
}

/* One name's biggest contracts today: the tape is a window, the question is the day, so the screener for the one
   name by the day's premium */
export function useNameTopContracts(ticker: string | null, limit = 3): LivePack<BookContract[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `top-contracts:${name}:${limit}` : 'top-contracts:off',
    () => readBook(`ticker_symbol=${encodeURIComponent(name)}&limit=${limit}&order=premium&order_direction=desc`),
    [],
    !!name
  );
}

/* The whole day, market-wide: the screener's contracts by the day's premium, the day's largest flow alerts, and the
   market tide's running net. */

/** The market's contracts with the most premium today — the screener, the whole day */
export function useDayTopContracts(limit = 5, enabled = true): LivePack<BookContract[]> {
  return useLive(`day-top:${limit}`, () => readBook(`limit=${limit}&order=premium&order_direction=desc`), [], enabled);
}

/** The day's largest flow alerts: the vendor's alerts of `minPremium` and up, filed before `untilMs` (the close), largest
    first, in (or outside) the regular session */
export function useDayBigAlerts(sinceMs: number, untilMs: number | null, session: 'regular' | 'extended', minPremium = 5_000_000, limit = 200, enabled = true): LivePack<FlowPrint[]> {
  return useLive<FlowPrint[]>(`day-alerts:${sinceMs}:${untilMs ?? 'live'}:${session}:${minPremium}`, () => readDayAlerts(sinceMs, untilMs, session, minPremium, limit), [], enabled);
}
/** Pages of the day's big alerts walked back before the list says it holds only the newest */
const DAY_ALERT_PAGES = 3;
/** The day's alerts of `minPremium` and up from `sinceMs` (the route reaches back days), largest first. The route sends
    the newest first and orders by nothing else, so a full page is walked back (older_than, at most DAY_ALERT_PAGES) until
    the day is in hand: the largest are then the day's largest. `complete` false says the list is the largest of the
    newest DAY_ALERT_PAGES × `limit` only. */
export async function readDayAlerts(sinceMs: number, untilMs: number | null, session: 'regular' | 'extended', minPremium: number, limit: number): Promise<FlowPrint[] & { complete: boolean }> {
  const raw: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let older: number | null = untilMs;
  let complete = false;
  for (let page = 0; page < DAY_ALERT_PAGES; page++) {
    const got = await getRows(`/option-trades/flow-alerts?limit=${limit}&min_premium=${minPremium}&newer_than=${new Date(sinceMs).toISOString()}${older ? `&older_than=${new Date(older).toISOString()}` : ''}`);
    let oldest = 0;
    for (const r of got) {
      const k = String(r.id ?? `${r.option_chain ?? ''}|${r.created_at ?? ''}|${r.total_premium ?? ''}`);
      const t = Date.parse(String(r.created_at ?? ''));
      if (Number.isFinite(t) && (!oldest || t < oldest)) oldest = t;
      if (seen.has(k)) continue;
      seen.add(k);
      raw.push(r);
    }
    if (got.length < limit || !oldest || oldest <= sinceMs) {
      complete = true;
      break;
    }
    /* older_than is strict: the next page starts at the oldest instant in hand (its repeats are dropped by id) */
    if (older != null && oldest + 1 >= older) break;
    older = oldest + 1;
  }
  const rows = markAlertPackages(await mapWithIndex(raw, alertToPrint));
  return Object.assign(rows.filter(p => (session === 'regular' ? !p.extended : !!p.extended)).sort((a, b) => b.premium - a.premium), { complete });
}

/* ---- a stock's whole day of one-minute bars, extended hours included (the cross card) --------------------------- */
interface StockMinute {
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
          const nyDay = c.ms > 0 ? nyDateOf(c.ms) : '';
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
interface MarkNow {
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
              v.trade = { fill: p.fill, volume: p.volume, oi: p.oi, time: p.time, day: p.epochMs ? nyDateOf(p.epochMs) : '', extended: !!p.extended };
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

/* Endless lists: the newest page is polled; older pages are asked only near the bottom, one at a time in the low
   lane, appended and kept to `cap` until the question changes. */
interface OlderPages<T> {
  rows: T[];
  state: 'more' | 'loading' | 'end' | 'cap' | 'idle';
  loaded: number;
  loadOlder: () => void;
}
/* the older pages a list has read, by its key: a page left and opened again keeps what the reader scrolled in */
const olderStore = new Map<string, { key: string; rows: unknown[]; pages: number; end: boolean }>();
const OLDER_STORE_MAX = 12;
export function useOlderPages<T>(key: string, base: T[], idOf: (r: T) => string, fetchOlder: (inHand: T[], pageNo: number) => Promise<{ rows: T[]; end: boolean }>, enabled = true, cap = 50_000): OlderPages<T> {
  type Held = { key: string; rows: T[]; pages: number; end: boolean };
  const stored = (k: string) => (olderStore.get(k) as Held | undefined) ?? { key: k, rows: [] as T[], pages: 0, end: false };
  const [older, setOlderState] = useState<Held>(() => stored(key));
  const setOlder = useCallback((fn: (prev: Held) => Held) => {
    setOlderState(prev => {
      const next = fn(prev);
      olderStore.delete(next.key);
      olderStore.set(next.key, next as Held & { rows: unknown[] });
      while (olderStore.size > OLDER_STORE_MAX) olderStore.delete(olderStore.keys().next().value as string);
      return next;
    });
  }, []);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const mine = older.key === key ? older : stored(key);
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
        const cur = prev.key === k ? prev : stored(k);
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
  }, [enabled, key, mine.end, mine.pages, capped, idOf, setOlder]);
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
async function olderSpreads(inHand: SpreadTrade[], sinceMs: number | null, session: 'regular' | 'extended' | null, ticker?: string | null, limit = 200): Promise<{ rows: SpreadTrade[]; end: boolean }> {
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
async function olderBook(pageNo: number, query: string, limit: number): Promise<{ rows: BookContract[]; end: boolean }> {
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
/** One name's older crosses of the day, walked back from the oldest in hand (`older_than`), kept to the session */
export async function olderNameDark(ticker: string, inHand: DarkPoolPrint[], dayIso: string, limit = 200, session: 'regular' | 'extended' = 'regular'): Promise<{ rows: DarkPoolPrint[]; end: boolean }> {
  const oldest = inHand.reduce((m, p) => Math.min(m, p.epochMs ?? Infinity), Infinity);
  if (!Number.isFinite(oldest)) return { rows: [], end: true };
  const got = await getRowsLow(`/darkpool/${encodeURIComponent(ticker)}?limit=${limit}&older_than=${oldest}`);
  const mapped = got.filter(r => !r.canceled).map((r, i) => darkPrint(r, inHand.length + i));
  const rows = mapped.filter(p => (!p.dateIso || p.dateIso === dayIso) && (session === 'regular' ? !p.extended : !!p.extended));
  /* a shorter page, or the first print of the other session or the day before, is the end of this walk */
  return { rows, end: got.length < limit || rows.length < mapped.length };
}

/* lets WatchContext read live spots without importing this module (core/liveSpots.ts) */
import { registerLiveSpots } from '../core/liveSpots';
registerLiveSpots(liveSpotOf);
