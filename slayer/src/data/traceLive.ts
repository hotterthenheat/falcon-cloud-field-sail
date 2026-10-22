/*
  TRACE — live Unusual Whales rows, mapped onto the grids the desks already draw.
  The browser calls /api/uw. This file does not invent a layout and does not
  talk to the simulator.
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { uwCall } from './whales';
import { vendorFault, type FeedFault } from '../components/ui/liveRead';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolIntent, DarkPoolLevel, DarkPoolPrint, DarkPoolView, LevelRole, Posture } from '../types/darkpool';
import { isoDate, isTradingDay, sessionsBetween } from '../core/calendar';
import { nyParts } from '../core/nyTime';
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
  return [];
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
  if (t.includes('ask_side')) return 'ASK';
  if (t.includes('bid_side')) return 'BID';
  if (t.includes('mid_side') || t.includes('no_side')) return 'MID';
  return execOf(price, bid, ask) ?? 'MID';
}

/* THE PRINT'S OWN CONDITION CODE (OPRA, upstream_condition_detail) says what it was: ISOI is an intermarket sweep;
   ML?T / TL?T and the ?ESL / ?ASL / ?FSL family are legs of a multi-leg order. `stock_multi_vol` / `multi_vol` are the
   CONTRACT's day volumes, never this print's kind (the audit, 2026-10-22: reading them made every print on a contract
   that had ever traded in a spread a "×2 legs · CUSTOM"). */
export function printCondition(row: Record<string, unknown>): { multi: boolean; sweep: boolean; floor: boolean } {
  const cond = String(row.upstream_condition_detail || '').toLowerCase();
  const flags = (Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')]).join(' ');
  return {
    multi: /^(ml|tl)[aecf]t$|^[mt][aecf]sl$/.test(cond) || /multi/i.test(flags),
    sweep: cond === 'isoi' || /sweep/i.test(flags),
    floor: /floor/i.test(flags) || /^(ml|tl)ft$|^[mt]fsl$/.test(cond),
  };
}

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
  const { multi, sweep } = printCondition(row);
  const idRaw = String(row.id || `${ticker}-${when.epoch}-${i}`);
  return {
    id: hashId(idRaw),
    time: when.time,
    ticker,
    /* the condition says "a leg of a multi-leg order", not how many legs it had — 2 is the marker, drawn as "multi-leg" */
    legs: multi ? 2 : 1,
    strike,
    right,
    otmPct: spot > 0 && strike > 0 ? ((right === 'C' ? strike - spot : spot - strike) / spot) * 100 : NaN,
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
      executed_at: row.created_at ?? row.end_time,
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
  };
}

/** Rows mapped once the index levels they need are in hand (an index print carries no underlying price) */
async function mapWithIndex<T>(rows: Record<string, unknown>[], fn: (r: Record<string, unknown>, i: number) => T): Promise<T[]> {
  await ensureIndexLevels(rows.map(tickerOfRow));
  return rows.map(fn);
}

export function useOptionTape(limit = 200): LivePack<FlowPrint[]> {
  return useLive(`tape:${limit}`, async () => mapWithIndex(await getRows(`/option-trades?limit=${limit}`), tradeToPrint), []);
}

/* ONE NAME'S TAPE AND STRUCTURES (Trace › Compare, 2026-10-22): the market-wide windows are the market's latest prints
   — after the close almost all index — so a name like SPY read "0 prints" beside a full book. Additive: the vendor's
   ticker_symbol filter on the same routes. */
export function useNameTape(ticker: string | null, limit = 200): LivePack<FlowPrint[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(name ? `tape:${name}:${limit}` : 'tape:name:off', async () => mapWithIndex(await getRows(`/option-trades?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}`), tradeToPrint), [], !!name);
}

export function useNameSpreads(ticker: string | null, limit = 80): LivePack<SpreadTrade[]> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(name ? `spreads:${name}:${limit}` : 'spreads:name:off', async () => (await getRows(`/option-trades/multi-leg?ticker_symbol=${encodeURIComponent(name)}&limit=${limit}`)).map(spreadOf), [], !!name);
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
}
export function useContractLast(occ: string | null | undefined): LivePack<ContractLast | null> {
  const sym = (occ || '').trim().toUpperCase();
  return useLive(
    sym ? `last:${sym}` : 'last:off',
    async () => {
      const rows = await getRows(`/option-contract/${encodeURIComponent(sym)}/flow?limit=1`);
      const r = rows[0];
      if (!r) return null;
      const side = sideOfTags(r.tags, num(r.price), num(r.nbbo_bid), num(r.nbbo_ask));
      const { multi, sweep } = printCondition(r);
      return { size: num(r.size), fill: num(r.price), side, time: clock(r.executed_at).time.slice(0, 5), bid: num(r.nbbo_bid), ask: num(r.nbbo_ask), premium: num(r.premium), multi, sweep };
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
  return next.length > TAPE_CAP ? (where === 'front' ? next.slice(0, TAPE_CAP) : next.slice(next.length - TAPE_CAP)) : next;
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
export function usePrintStream(query: TapeQuery, hold: boolean): PrintStream {
  const key = tapeQueryString(query);
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
    const page = async (cursor: { newerThan?: number; olderThan?: number }) => {
      const got = await getRows(`/option-trades?${tapeQueryString(query, { ...cursor, limit: TAPE_PAGE })}`);
      if (stop) return [];
      await ensureIndexLevels(got.map(tickerOfRow));
      return got.map(tradeToPrint);
    };
    /** Everything newer than `sinceMs`, newest first; `joined` false when the walk stopped short of it */
    const newerThan = async (sinceMs: number): Promise<{ batch: FlowPrint[]; joined: boolean }> => {
      let acc: FlowPrint[] = [];
      let olderThan: number | undefined;
      for (let n = 0; n < GAP_PAGES && !stop; n++) {
        const got = await page({ newerThan: sinceMs > 0 ? sinceMs - 1 : undefined, olderThan });
        acc = dedupe(acc.concat(got));
        if (got.length < TAPE_PAGE) return { batch: acc, joined: true };
        const next = oldestMs(got) + 1;
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
        let more = first.length >= TAPE_PAGE;
        setHasOlder(more);
        while (more && held.length < TAPE_CAP && !stop) {
          setLoadingOlder(true);
          const cursor = oldestMs(held) + 1;
          const older = await page({ olderThan: cursor });
          if (stop) return;
          const before = held.length;
          held = mergePrints(held, older, 'back');
          setRows(prev => mergePrints(prev, older, 'back'));
          if (older.length < TAPE_PAGE || held.length === before) {
            more = false;
            setHasOlder(false);
          }
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
      if (!newest.current || polling) return;
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
        await ensureIndexLevels(got.map(tickerOfRow));
        const batch = got.map(tradeToPrint);
        setRows(prev => mergePrints(prev, batch, 'back'));
        if (batch.length < TAPE_PAGE) setHasOlder(false);
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

function intentOf(vs: number, sized: boolean): DarkPoolIntent {
  if (!sized) return 'ROTATION';
  if (vs <= -0.15) return 'ACCUMULATION';
  if (vs >= 0.15) return 'DISTRIBUTION';
  return 'HEDGE FLOW';
}

/** Where a dark print sat against the quote. Two decimals of percent is 0.00%
    on a fill a few cents through a tight spread, which is most of this tape. */
export function quotePlace(pct: number, price: number): { text: string; cents: number } {
  const cents = (pct / 100) * price * 100;
  if (!Number.isFinite(cents) || Math.abs(cents) < 0.5) return { text: 'at the mid', cents: 0 };
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

export function darkPrint(row: Record<string, unknown>, i: number, spot = 0): DarkPoolPrint {
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
  const intent = special ? 'ROTATION' : intentOf(vs, sized);
  const exec = special ? null : execOf(price, bid, ask);
  const when = clock(row.executed_at);
  /* the vendor's tracking_id is NOT unique — distinct prints (other sizes, other cumulative volumes) share one — so the
     id folds in the fields that tell them apart; stable across polls, so the accumulator still de-dupes repeats */
  const id = hashId(row.tracking_id != null ? `${row.tracking_id}-${row.executed_at}-${row.size}-${row.price}-${row.volume}` : `${row.ticker}-${row.executed_at}-${i}`);
  const place = quotePlace(vs, price);
  const where = place.cents === 0 ? 'at the mid' : place.cents > 0 ? `${place.text.slice(1)} over the mid` : `${place.text.slice(1)} under the mid`;
  const read = special ? `${/^[aeiou]/i.test(special) ? 'An' : 'A'} ${special} — priced by its terms, not the quote; no read.` : sized ? `Size printed ${where}.` : `Printed ${where} — too small to read.`;
  const center = String(row.market_center || '');
  return {
    id,
    time: when.time,
    ticker: String(row.ticker || '').toUpperCase(),
    price,
    size,
    notional,
    venue: FACILITY[center] ?? (center ? `FINRA facility ${center}` : 'off-exchange'),
    vsSpotPct: vs,
    atLevel: false,
    sized: sized && !special,
    intent,
    conviction: 0,
    read,
    exec,
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    special,
    facility: FACILITY[center] ?? undefined,
  };
}

export function darkLevels(rows: Record<string, unknown>[], spot: number): DarkPoolLevel[] {
  const raw = rows
    .map(r => ({ price: num(r.price), notional: num(r.dark_pool_volume) * num(r.price) || num(r.dark_pool_volume), prints: 1 }))
    .filter(l => l.price > 0 && l.notional > 0)
    .sort((a, b) => b.notional - a.notional);
  const sum = raw.reduce((a, l) => a + l.notional, 0) || 1;
  /* A dollar bucket within a third of a percent of the market is the pivot.
     Anything further is support or resistance. The feed hands back every
     dollar that printed (META is ~30). Two of each role is the shelf — the
     heaviest — not a fence of the same word. */
  const leveled = raw.map(l => {
    const dist = spot > 0 ? ((l.price - spot) / spot) * 100 : 0;
    const role: LevelRole = Math.abs(dist) <= 0.35 ? 'PIVOT' : dist < 0 ? 'SUPPORT' : 'RESISTANCE';
    return {
      price: l.price,
      notional: l.notional,
      prints: l.prints,
      sharePct: (l.notional / sum) * 100,
      role,
      defended: 0,
      distPct: dist,
      usage: role === 'SUPPORT' ? 'Rested under the market.' : role === 'RESISTANCE' ? 'Rested over the market.' : 'Rested at the market.',
    };
  });
  const take = (role: LevelRole) => leveled.filter(l => l.role === role).slice(0, 2);
  return [...take('SUPPORT'), ...take('RESISTANCE'), ...take('PIVOT')];
}

function postureOf(prints: DarkPoolPrint[]): { posture: Posture; net: number; note: string } {
  const sized = prints.filter(p => p.sized);
  const acc = sized.filter(p => p.intent === 'ACCUMULATION').length;
  const dist = sized.filter(p => p.intent === 'DISTRIBUTION').length;
  const net = sized.length ? Math.round(((acc - dist) / sized.length) * 100) : 0;
  const posture: Posture = net > 15 ? 'ACCUMULATING' : net < -15 ? 'DISTRIBUTING' : 'BALANCED';
  const note =
    posture === 'ACCUMULATING'
      ? 'Sized prints lean under the market.'
      : posture === 'DISTRIBUTING'
        ? 'Sized prints lean over the market.'
        : 'Sized prints sit on both sides of the market.';
  return { posture, net, note };
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
        const batch = (await getRows(path)).filter(r => !r.canceled).map((r, i) => darkPrint(r, i)); // a cancelled print never traded
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
  }, [path]);
  return { rows, at, fault, waiting: waiting && rows.length === 0 };
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

export function useNameDark(ticker: string | null): LivePack<{ view: DarkPoolView | null; lit: DarkPoolPrint[]; day: DarkDay | null }> {
  const name = (ticker || '').trim().toUpperCase();
  return useLive(
    name ? `name-dark:${name}` : 'name-dark:off',
    async () => {
      if (!name) return { view: null, lit: [] as DarkPoolPrint[], day: null };
      const [prints, levels, lit, dayVol] = await Promise.all([
        getRows(`/darkpool/${encodeURIComponent(name)}?limit=200`),
        getRows(`/darkpool/${encodeURIComponent(name)}/price-levels`).catch(() => [] as Record<string, unknown>[]),
        getRows(`/lit-flow/${encodeURIComponent(name)}?limit=200`).catch(() => [] as Record<string, unknown>[]),
        dayVolumeOf(name),
      ]);
      const mapped = prints.filter(r => !r.canceled).map((r, i) => darkPrint(r, i));
      const spot = mapped[0]?.price || 0;
      const day = darkDayOf(levels, dayVol);
      return { view: darkView(name, mapped, darkLevels(levels, spot), spot, day && Number.isFinite(day.sharePct) ? day.sharePct : 0), lit: lit.filter(r => !r.canceled).map((r, i) => darkPrint(r, i)), day };
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
    otmPct: spot > 0 && strike > 0 ? ((right === 'C' ? strike - spot : spot - strike) / spot) * 100 : NaN,
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
  };
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
  return useLive(id ? `alert-trades:${id}` : 'alert-trades:off', async () => mapWithIndex(await getRows(`/option-trades/flow-alerts/${encodeURIComponent(id!)}`), tradeToPrint), [], !!id);
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

/* THE LOSS IS WORKED FROM THE MONEY, NOT TAKEN FROM THE VENDOR'S FIGURE: its max_loss is signed, sometimes a tenth of the
   truth on the small-strike names, and absent on unclassified shapes. A debit structure can lose what was paid; a
   credit vertical or condor loses its width (the condor's wider wing) less the credit. Only a sold straddle or strangle
   is truly uncapped from the row alone; the card works the rest from its settled legs (payoffRange). */
function definedLoss(kind: SpreadKind, strategy: string, size: number, strikes: number[], side: string, netPremium: number, vendorLoss: number | null): number | 'uncapped' | null {
  if (!Number.isFinite(netPremium) || netPremium === 0 || /^other$/i.test(strategy)) return null;
  const debit = netPremium > 0 && !/bid/i.test(side);
  const credit = netPremium < 0 && !/ask/i.test(side);
  if (!debit && !credit) return null;
  if (debit && (kind === 'vertical' || kind === 'butterfly' || kind === 'condor' || kind === 'straddle' || kind === 'strangle' || kind === 'calendar')) return netPremium;
  if (debit) return vendorLoss;
  const got = Math.abs(netPremium);
  const sorted = [...strikes].sort((x, y) => x - y);
  if (kind === 'vertical' && sorted.length === 2) {
    const loss = (sorted[1] - sorted[0]) * 100 * size - got;
    return loss > 0 ? loss : null;
  }
  if (kind === 'condor' && sorted.length === 4) {
    const loss = Math.max(sorted[1] - sorted[0], sorted[3] - sorted[2]) * 100 * size - got;
    return loss > 0 ? loss : null;
  }
  if (kind === 'straddle' || kind === 'strangle') return 'uncapped';
  return vendorLoss;
}

/* The profit side: a credit keeps what it took in ONLY on the sold shapes whose gain is capped at the credit — a sold
   vertical, condor, butterfly, straddle or strangle; a calendar's, a ratio's or an unnamed shape's profit is not its
   credit (the audit, 2026-10-22). A debit vertical earns its width less the debit. Other shapes keep the vendor's. */
function definedProfit(kind: SpreadKind, strategy: string, size: number, strikes: number[], side: string, netPremium: number, vendorProfit: number | null): number | 'uncapped' | null {
  if (/^other$/i.test(strategy)) return null;
  if (!Number.isFinite(netPremium) || netPremium === 0) return vendorProfit;
  if ((kind === 'straddle' || kind === 'strangle') && netPremium > 0 && !/bid/i.test(side)) return 'uncapped';
  if (netPremium < 0 && !/ask/i.test(side)) return kind === 'vertical' || kind === 'condor' || kind === 'butterfly' || kind === 'straddle' || kind === 'strangle' ? Math.abs(netPremium) : vendorProfit;
  const sorted = [...strikes].sort((x, y) => x - y);
  if (kind === 'vertical' && sorted.length === 2 && netPremium > 0 && !/bid/i.test(side)) {
    const gain = (sorted[1] - sorted[0]) * 100 * size - netPremium;
    return gain > 0 ? gain : null;
  }
  return vendorProfit;
}

function spreadOf(row: Record<string, unknown>): SpreadTrade {
  const ticker = String(row.ticker || '').toUpperCase();
  const when = clock(row.executed_at);
  const strikes = Array.isArray(row.strikes) ? row.strikes.map(s => num(s)).filter(n => n > 0) : [];
  const net = num(row.net_price);
  const size = num(row.size) || 1;
  const strategy = String(row.strategy || '');
  const kind = spreadKind(strategy);
  /* the vendor signs the loss (max_loss "-11.20"); uncapped is an ABSENT figure, never a negative one */
  const vendorLoss = row.max_loss != null && row.max_loss !== '' ? Math.abs(num(row.max_loss)) : null;
  const netPremium = row.net_premium != null && row.net_premium !== '' ? num(row.net_premium) : NaN;
  const vendorProfit = row.max_profit != null && row.max_profit !== '' ? Math.abs(num(row.max_profit)) : null;
  /* no legs on the row (txns is a count) — the legs come from the legs route when the card opens; the row carries its
     strikes and its near expiry, the trade's own New York day plus its days to run */
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
    strikesLabel: strikes.length ? strikes.join(' / ') : '—',
    expiry: expiryIso ? expiryLabel(expiryIso) : '—',
    dte: expiryIso ? dteOf(expiryIso) : dteAtTrade,
    size,
    net,
    netPremium: Number.isFinite(netPremium) ? netPremium : 0,
    /* the gross of every leg's money — the row's "Premium"; the net is netPremium */
    premium: num(row.total_premium) || Math.abs(net) * size * 100,
    maxLoss: definedLoss(kind, strategy, size, strikes, String(row.net_side || ''), netPremium, vendorLoss),
    maxProfit: definedProfit(kind, strategy, size, strikes, String(row.net_side || ''), netPremium, vendorProfit),
    iv: num(row.avg_iv) * 100,
    delta: num(row.net_delta),
    theta: NaN,
    spot: num(row.underlying_price) || indexLevel(ticker),
    legs: [],
    legCount: num(row.leg_count) || undefined,
  };
}

/** The newest structures, `limit` of them (the vendor's feed is newest first) */
export function useSpreads(limit = 80): LivePack<SpreadTrade[]> {
  return useLive(`spreads:${limit}`, async () => mapWithIndex(await getRows(`/option-trades/multi-leg?limit=${limit}`), spreadOf), []);
}

/** One structure's real legs, their directions settled by its net premium (resolveLegs) */
export function useSpreadLegs(trade: Pick<SpreadTrade, 'id' | 'size' | 'netPremium'> | null): LivePack<SpreadLeg[]> {
  const id = trade?.id ?? null;
  return useLive(
    id ? `spread-legs:${id}` : 'spread-legs:off',
    async () => resolveLegs(await getRows(`/option-trades/multi-leg/${encodeURIComponent(id!)}/legs`), trade!.size, trade!.netPremium),
    [],
    !!id
  );
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
        .filter(r => r.min >= 0 && r.min < 390)
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
             "Regular" desk) — the running line starts at the bell */
          const m = clock(r.tape_time).minute;
          if (m < 570 || m >= 960) continue;
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
