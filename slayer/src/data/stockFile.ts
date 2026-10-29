/* One name's file for the stock page: daily sessions, the last prints, the flow alerts and the
   off-exchange tape. */

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { daysBetween, lastSessionIso, nyDayOf, nyTodayIso } from './nyDate';
import type { DarkPoolPrint } from '../types/darkpool';
import type { FlowPrint } from '../types/trace';
import { darkPrint } from './traceLive';
import { alertSides, darkPrintKey } from './sidesRule';
import { uwCall, whalesAnalysts, whalesBars, whalesDailyLong, whalesEarnings, whalesFinancials, whalesOptionContracts, whalesScreener, whalesStock, type UwDaily } from './whales';
import { nyClock, nyIsoDate, nyMinutes as nyMinuteOf, SESSION_CLOSE_MIN, SESSION_OPEN_MIN } from '../core/nyTime';
import { noteBarCloses, peekRegularCloses, regularCloses } from './dayChange';

/* Five regular closes need about fifteen daily rows (pre, regular and post a day), not two years of them. */
const CLOSES_ROWS = 18;
const closesAsked = new Map<string, Promise<{ date: string; close: number }[]>>();
/** A name's last regular closes, newest first, read once a New York day and shared with the quote's cache */
export function loadCloses(ticker: string): Promise<{ date: string; close: number }[]> {
  const t = ticker.toUpperCase();
  const hit = peekRegularCloses(t);
  if (hit) return Promise.resolve(hit);
  const running = closesAsked.get(t);
  if (running) return running;
  const p = uwCall(`/stock/${encodeURIComponent(t)}/ohlc/1d?limit=${CLOSES_ROWS}`, true)
    .then(got => {
      const closes = regularCloses(Array.isArray(got.data) ? (got.data as UwDaily[]) : []).slice(0, 5);
      if (closes.length) noteBarCloses(t, closes);
      return peekRegularCloses(t) ?? closes;
    })
    .finally(() => closesAsked.delete(t));
  closesAsked.set(t, p);
  return p;
}

export interface EarnRow {
  report_date?: string;
  actual_eps?: string | number | null;
  street_mean_est?: string | number | null;
  post_earnings_move_1d?: string | number | null;
  expected_move_perc?: string | number | null;
  /** 'company' when the company set the date; 'estimation' while it is the vendor's estimate */
  source?: string | null;
  report_time?: string | null;
}

/** One quarterly filing from /stock/{t}/financials. Dollars, as the vendor prints them. */
export interface QuarterFiling {
  fiscal: string;
  revenue: number;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCash: number | null;
  capex: number | null;
}

/** Latest price target from each firm, last 180 days. The median is the street's fair value. */
export interface StreetBook {
  median: number;
  low: number;
  high: number;
  firms: number;
  asOf: string;
}

export interface StockFile {
  status: 'loading' | 'live' | 'error';
  screen: Record<string, unknown> | null;
  earnings: EarnRow[];
  days: Candle[];
  flow: FlowPrint[];
  dark: DarkPoolPrint[];
  /** The window the session's flow alerts truly cover (paged back, bounded) */
  flowWindow: TapeWindow;
  /** The window the dark prints truly cover (paged back, bounded) */
  darkWindow: TapeWindow;
  /** The chain's contracts, busiest by volume first (/stock/{t}/option-contracts) — the earnings page reads the same */
  contracts: Record<string, unknown>[];
  /** The New York session the flow alerts and the dark prints are filtered to */
  session: string;
  /** The session's tapes (flow alerts, dark prints), read after the file's head so the page opens on the name first */
  tapes: 'loading' | 'live';
  /** The session's one-minute cash bars (/stock/{t}/ohlc/1m, shared with Pinpoint): the tape the dark prints are drawn on */
  minutes?: Candle[];
  /** In the session: the New York clock today's range is read to (from the minutes) — "15:08" */
  rangeAsOf?: string;
  /** Epoch ms of the last print that landed. */
  at?: number;
  /** Quarterly income and cash flow, newest first. Empty when the vendor has no statements. */
  quarters: QuarterFiling[];
  /** The street's targets. Null when no firm has printed one in the last 180 days. */
  street: StreetBook | null;
}

const EMPTY_EARN: EarnRow[] = [];
const EMPTY_DAYS: Candle[] = [];
const EMPTY_FLOW: FlowPrint[] = [];
const EMPTY_DARK: DarkPoolPrint[] = [];
const EMPTY_CONTRACTS: Record<string, unknown>[] = [];
const NO_WINDOW: TapeWindow = { complete: false, from: '', to: '', rows: 0, pages: 0 };
/** One object per status. A fresh object on every read makes useSyncExternalStore
    treat the file as changed and warn that getSnapshot is not cached. */
const EMPTY_QUARTERS: QuarterFiling[] = [];
const LOADING: StockFile = { status: 'loading', tapes: 'loading', session: '', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, flowWindow: NO_WINDOW, dark: EMPTY_DARK, darkWindow: NO_WINDOW, contracts: EMPTY_CONTRACTS, quarters: EMPTY_QUARTERS, street: null };
const FAILED: StockFile = { status: 'error', tapes: 'live', session: '', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, flowWindow: NO_WINDOW, dark: EMPTY_DARK, darkWindow: NO_WINDOW, contracts: EMPTY_CONTRACTS, quarters: EMPTY_QUARTERS, street: null };

const blank = (status: StockFile['status']): StockFile => (status === 'error' ? FAILED : LOADING);

const files = new Map<string, StockFile>();
const listeners = new Set<() => void>();
const started = new Set<string>();

const emit = () => listeners.forEach(fn => fn());

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const clock = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return nyClock(t);
};

const mmddyyyy = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${m}/${d}/${y}` : iso;
};

/* calendar days from New York's today to the expiry — never UTC midnight against the clock (data/nyDate.ts) */
const dteOf = (iso: string, from: string = nyTodayIso()): number => {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  return Math.max(0, daysBetween(from, day));
};

function daysFrom(rows: UwDaily[]): Candle[] {
  const byDate = new Map<string, UwDaily>();
  for (const row of rows) {
    const date = row.date?.slice(0, 10);
    if (!date || !(num(row.close) > 0)) continue;
    const prev = byDate.get(date);
    if (!prev || row.market_time === 'r') byDate.set(date, row);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, row]) => {
      const close = num(row.close);
      const time = Math.floor(Date.parse(`${date}T20:00:00Z`) / 1000);
      return {
        time,
        open: num(row.open) || close,
        high: num(row.high) || close,
        low: num(row.low) || close,
        close,
        volume: Math.max(num(row.total_volume), num(row.volume)),
      };
    })
    .filter(c => c.time > 0);
}

function flowsFrom(rows: Record<string, unknown>[], spot: number, session: string): FlowPrint[] {
  /* Only the alerts created on the session the page names (the vendor's reach back days); an alert on a contract that
     expired before that session is dropped. */
  const live = rows.filter(row => {
    if (nyDayOf(String(row.created_at || '')) !== session) return false;
    const exp = String(row.expiry || '').slice(0, 10);
    return !/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp >= session;
  });
  /* every alert of the session is kept: the ask and sweep shares are sums over all of them */
  return live.map((row, i) => {
    const prem = num(row.total_premium);
    /* SidesRule (sidesRule.ts): the side with 60%+ of the alert's premium, else mid */
    const sides = alertSides(row);
    const { ask, bid, side } = sides;
    const right: FlowPrint['right'] = String(row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
    const strike = num(row.strike);
    const expiry = String(row.expiry || '');
    const under = num(row.underlying_price) || spot;
    return {
      id: i + 1,
      time: clock(String(row.created_at || '')),
      ticker: String(row.ticker || '').toUpperCase(),
      legs: row.has_multileg ? 2 : 1,
      strike,
      right,
      otmPct: under > 0 ? ((strike - under) / under) * 100 : 0,
      expiry: expiry.includes('-') ? mmddyyyy(expiry) : expiry,
      dte: dteOf(expiry, session),
      fill: num(row.price),
      bid: num(row.bid),
      ask: num(row.ask),
      fillPos: side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5,
      side,
      ratioBidPct: sides.whole > 0 ? (100 * bid) / sides.whole : 0,
      alertSides: { ask, bid, other: sides.other },
      size: num(row.total_size),
      premium: prem,
      volume: num(row.volume),
      oi: num(row.open_interest),
      deltaOI: 0,
      spot: under,
      iv: num(row.iv) * (num(row.iv) < 3 ? 100 : 1),
      volOverOI: num(row.volume_oi_ratio),
      strat: '—',
      sweep: !!row.has_sweep,
    };
  });
}

/* Each print is mapped by traceLive.ts darkPrint (Trace's SidesRule): over the mid at its print time buyer-initiated,
   under it seller-initiated; own-terms, auction and after-hours prints are kept, never read. */
const nyMinutes = (iso: string): number | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const h = Number(parts.find(p => p.type === 'hour')?.value);
  const m = Number(parts.find(p => p.type === 'minute')?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function darksFrom(rows: Record<string, unknown>[], spot: number): DarkPoolPrint[] {
  return rows
    .filter(r => r.canceled !== true && r.canceled !== 'true')
    .map((row, i) => {
      /* the page's clock is the minute (HH:MM — its chart buckets prints per minute; Trace's is HH:MM:SS) */
      const p = { ...darkPrint(row, i, spot), time: clock(String(row.executed_at || '')) };
      const minute = nyMinutes(String(row.executed_at || ''));
      const outside = minute != null && (minute < 9 * 60 + 30 || minute >= 16 * 60);
      if (!outside || p.extended) return p;
      return { ...p, extended: true, intent: 'ROTATION', read: p.special ? p.read : 'After hours by its own time — no read.' } satisfies DarkPoolPrint;
    });
}

/* The tape is asked on the session the page names (to its 16:00 close once passed), as two asks merged on the print's
   identity: the $500K+ prints and the 10,000-share+ prints. */
const DARK_MIN_PREMIUM = 500_000;
const DARK_MIN_SIZE = 10_000;

/** The window a paged read truly covers, as New York clocks. `complete` when the paging reached the session's start
    (or the vendor ran out of rows); otherwise `from` is the oldest print in hand and the read covers from there only. */
export interface TapeWindow {
  complete: boolean;
  /** HH:MM New York — the oldest instant the read covers ('' when nothing landed) */
  from: string;
  /** HH:MM New York — the newest */
  to: string;
  rows: number;
  pages: number;
}

/** An instant on the session's New York day at HH:MM, the offset read off the clock itself (EDT −4, EST −5) */
const nyInstant = (session: string, hh: number, mm = 0): number => {
  const nyNoonUtc = Date.parse(`${session}T12:00:00Z`);
  const nyNoonHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(nyNoonUtc)));
  return nyNoonUtc + (hh - nyNoonHour) * 3_600_000 + mm * 60_000;
};

/* Each stream pages back with older_than to the session's start or until the vendor runs dry, at most `maxPages` calls
   in a row (the key's three slots are shared). */
async function pageBack(base: string, stamp: string, limit: number, startMs: number, endMs: number | null, maxPages: number, keyOf: (row: Record<string, unknown>) => string): Promise<{ rows: Record<string, unknown>[]; complete: boolean; oldestMs: number | null; pages: number; error: string | null }> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let older = endMs != null ? Math.floor(endMs / 1000) : null;
  let oldestMs: number | null = null;
  let pages = 0;
  let error: string | null = null;
  while (pages < maxPages) {
    /* not ahead of the queue: the head of every page (the screener row, the quote) goes first */
    const res = await uwCall(`${base}${older != null ? `&older_than=${older}` : ''}`);
    pages += 1;
    if (res.error) {
      error = res.error;
      break;
    }
    const page = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    let fresh = 0;
    for (const row of page) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh += 1;
      rows.push(row);
      const t = Date.parse(String(row[stamp] || ''));
      if (Number.isFinite(t)) oldestMs = oldestMs == null ? t : Math.min(oldestMs, t);
    }
    if (page.length < limit) return { rows, complete: true, oldestMs, pages, error };
    if (oldestMs != null && oldestMs <= startMs) return { rows, complete: true, oldestMs, pages, error };
    /* older_than is strict: the next page starts at the oldest second in hand, plus one so a second split across two
       pages is read whole (the print key dedupes it); a page with nothing new steps a second further back */
    const next = oldestMs != null ? Math.floor(oldestMs / 1000) + (fresh > 0 ? 1 : 0) : null;
    if (next == null || (older != null && next >= older)) older = older != null ? older - 1 : null;
    else older = next;
    if (older == null) break;
  }
  return { rows, complete: false, oldestMs, pages, error };
}

/* When either ask could not page back to the open, both are cut to the window the shorter covers, so every print in the
   read is from one stated window. */
const DARK_LIMIT = 500;
async function darkTape(ticker: string, session: string): Promise<{ rows: Record<string, unknown>[]; window: TapeWindow }> {
  const closeMs = nyInstant(session, 16);
  const openMs = nyInstant(session, 9, 30);
  const endMs = Date.now() >= closeMs ? closeMs : null;
  const base = `/darkpool/${encodeURIComponent(ticker)}?date=${session}&limit=${DARK_LIMIT}`;
  const [byPrem, bySize] = await Promise.all([
    pageBack(`${base}&min_premium=${DARK_MIN_PREMIUM}`, 'executed_at', DARK_LIMIT, openMs, endMs, 12, darkPrintKey),
    pageBack(`${base}&min_size=${DARK_MIN_SIZE}`, 'executed_at', DARK_LIMIT, openMs, endMs, 6, darkPrintKey),
  ]);
  if (byPrem.error && bySize.error && !byPrem.rows.length && !bySize.rows.length) throw new Error(byPrem.error);
  /* the window both streams cover: from the later of the two oldest prints when either stopped short of the open */
  const cuts = [byPrem, bySize].filter(r => !r.complete && r.oldestMs != null).map(r => r.oldestMs as number);
  const fromMs = cuts.length ? Math.max(...cuts) : null;
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const res of [byPrem, bySize]) {
    for (const row of res.rows) {
      const key = darkPrintKey(row);
      /* the vendor's date filter still hands back the evening before; the read is the named session's alone */
      if (nyDayOf(String(row.executed_at || '')) !== session || seen.has(key)) continue;
      if (fromMs != null && Date.parse(String(row.executed_at || '')) < fromMs) continue;
      seen.add(key);
      out.push(row);
    }
  }
  out.sort((a, b) => String(b.executed_at || '').localeCompare(String(a.executed_at || '')));
  const newest = out[0] ? clock(String(out[0].executed_at)) : '';
  const window: TapeWindow = {
    complete: fromMs == null,
    from: fromMs != null ? clock(new Date(fromMs).toISOString()) : out.length ? clock(String(out[out.length - 1].executed_at)) : '',
    to: newest,
    rows: out.length,
    pages: byPrem.pages + bySize.pages,
  };
  return { rows: out, window };
}

/* The session's flow alerts, paged back with older_than to New York's midnight, at most 8 pages; the window is stated. */
const FLOW_LIMIT = 200;
async function flowTape(ticker: string, session: string): Promise<{ rows: Record<string, unknown>[]; window: TapeWindow }> {
  const dayStart = nyInstant(session, 0);
  const dayEnd = nyInstant(session, 23, 59);
  const endMs = Date.now() > dayEnd ? dayEnd : null;
  const base = `/option-trades/flow-alerts?ticker_symbol=${encodeURIComponent(ticker)}&limit=${FLOW_LIMIT}&newer_than=${Math.floor(dayStart / 1000)}`;
  const got = await pageBack(base, 'created_at', FLOW_LIMIT, dayStart, endMs, 8, r => String(r.id ?? `${r.created_at}|${r.option_chain ?? ''}|${r.total_premium ?? ''}|${r.total_size ?? ''}`));
  const rows = got.rows.filter(r => nyDayOf(String(r.created_at || '')) === session);
  const stamps = rows.map(r => String(r.created_at || '')).sort();
  return {
    rows,
    window: {
      complete: got.complete,
      from: !got.complete && got.oldestMs != null ? clock(new Date(got.oldestMs).toISOString()) : stamps[0] ? clock(stamps[0]) : '',
      to: stamps.length ? clock(stamps[stamps.length - 1]) : '',
      rows: rows.length,
      pages: got.pages,
    },
  };
}

/** The prints the dark-pool read is built on: sized, in the regular session, priced at the quote */
export const darkReadable = (p: DarkPoolPrint): boolean => p.intent !== 'ROTATION';

/* a reader that shows only the file's head leaves the tapes unread; the first that shows them asks */
const heads = new Map<string, Promise<StockFile | null>>();
const tapesAsked = new Set<string>();

const finite = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

function quartersFrom(fin: { income_statements?: Record<string, unknown>[]; cash_flows?: Record<string, unknown>[] } | null): QuarterFiling[] {
  const inc = Array.isArray(fin?.income_statements) ? fin.income_statements : [];
  const cash = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(fin?.cash_flows) ? fin.cash_flows : []) {
    if (String(row.report_type ?? '') !== 'quarterly') continue;
    const fiscal = String(row.fiscal_date_ending ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fiscal)) cash.set(fiscal, row);
  }
  const out: QuarterFiling[] = [];
  for (const row of inc) {
    if (String(row.report_type ?? '') !== 'quarterly') continue;
    const fiscal = String(row.fiscal_date_ending ?? '').slice(0, 10);
    const revenue = finite(row.total_revenue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fiscal) || revenue == null || revenue === 0) continue;
    const cf = cash.get(fiscal);
    out.push({
      fiscal,
      revenue,
      grossProfit: finite(row.gross_profit),
      operatingIncome: finite(row.operating_income),
      netIncome: finite(row.net_income),
      operatingCash: cf ? finite(cf.operating_cashflow) : null,
      capex: cf ? finite(cf.capital_expenditures) : null,
    });
  }
  out.sort((a, b) => b.fiscal.localeCompare(a.fiscal));
  return out.slice(0, 12);
}

function earnFromFinancials(rows: Record<string, unknown>[] | undefined): EarnRow[] {
  if (!Array.isArray(rows)) return [];
  const out: EarnRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const date = String(row.report_date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
    seen.add(date);
    out.push({
      report_date: date,
      actual_eps: finite(row.reported_eps),
      street_mean_est: finite(row.estimated_eps),
      source: 'company',
      report_time: typeof row.report_time === 'string' ? row.report_time : null,
    });
  }
  return out;
}

/** Latest quarter against the same quarter a year earlier, when both are on the file. */
export function quarterFacts(rows: readonly QuarterFiling[]): {
  revenue: number | null;
  revenueGrowthPct: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  fcfMarginPct: number | null;
} {
  const q = rows[0];
  if (!q) return { revenue: null, revenueGrowthPct: null, grossMarginPct: null, operatingMarginPct: null, fcfMarginPct: null };
  const prev = rows[4] && rows[4].revenue ? rows[4] : null;
  const pct = (part: number | null) => (part == null || !q.revenue ? null : (100 * part) / q.revenue);
  const capex = q.capex == null ? null : Math.abs(q.capex);
  const fcf = q.operatingCash != null && capex != null ? q.operatingCash - capex : null;
  return {
    revenue: q.revenue,
    revenueGrowthPct: prev ? (q.revenue / prev.revenue - 1) * 100 : null,
    grossMarginPct: pct(q.grossProfit),
    operatingMarginPct: pct(q.operatingIncome),
    fcfMarginPct: pct(fcf),
  };
}

const STREET_MS = 180 * 86_400_000;
function streetFrom(rows: Record<string, unknown>[] | null | undefined): StreetBook | null {
  if (!Array.isArray(rows)) return null;
  const latest = new Map<string, { at: number; target: number }>();
  const floor = Date.now() - STREET_MS;
  for (const row of rows) {
    const target = finite(row.target);
    const firm = String(row.firm || row.analyst_name || '').trim();
    const at = Date.parse(String(row.timestamp || ''));
    if (!firm || target == null || !(target > 0) || !Number.isFinite(at) || at < floor) continue;
    const cur = latest.get(firm);
    if (!cur || at > cur.at) latest.set(firm, { at, target });
  }
  const got = [...latest.values()];
  if (!got.length) return null;
  const vals = got.map(v => v.target).sort((a, b) => a - b);
  const mid = vals.length % 2 === 1 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const asOf = new Date(Math.max(...got.map(v => v.at))).toISOString().slice(0, 10);
  return { median: mid, low: vals[0], high: vals[vals.length - 1], firms: vals.length, asOf };
}

async function load(ticker: string): Promise<StockFile | null> {
  const session = lastSessionIso();
  /* The head first: the screener row, the reports, the sessions and the chain open the page; the tapes land on their own. */
  const headP = Promise.all([
    whalesScreener([ticker], true).catch(() => [] as Record<string, unknown>[]),
    whalesEarnings(ticker, true).catch(() => [] as EarnRow[]),
    whalesDailyLong(ticker).catch(() => [] as UwDaily[]),
    /* the same call the earnings page makes, so the two pages' busiest contracts agree */
    whalesOptionContracts(ticker, undefined, true).catch(() => [] as Record<string, unknown>[]),
    whalesFinancials(ticker, true).catch(() => null),
    whalesStock(ticker).catch(() => null),
    whalesAnalysts(ticker, true).catch(() => [] as Record<string, unknown>[]),
  ]);
  const [screenR, earnR, dayR, contractR, finR, infoR, analystR] = await headP;
  const screen = Array.isArray(screenR) ? (screenR.find(r => String(r.ticker || '').toUpperCase() === ticker) ?? screenR[0] ?? null) : null;
  const days = daysFrom(Array.isArray(dayR) ? dayR : []);
  const quarters = quartersFrom(finR);
  const street = streetFrom(Array.isArray(analystR) ? analystR : []);
  const fromFeed = Array.isArray(earnR) ? earnR : [];
  const fromStatements = earnFromFinancials(finR?.earnings);
  const earnings = fromFeed.length ? fromFeed : fromStatements;
  const nextOnFile = typeof infoR?.next_earnings_date === 'string' ? infoR.next_earnings_date.slice(0, 10) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(nextOnFile) && !earnings.some(e => String(e.report_date ?? '').slice(0, 10) === nextOnFile)) {
    earnings.push({
      report_date: nextOnFile,
      source: 'company',
      report_time: typeof infoR?.announce_time === 'string' ? infoR.announce_time : null,
    });
  }
  const got = (Array.isArray(screenR) && screenR.length > 0) || days.length > 0 || earnings.length > 0 || quarters.length > 0;
  const head: StockFile = {
    status: got ? 'live' : 'error',
    tapes: 'loading',
    session,
    screen: screen && typeof screen === 'object' ? (screen as Record<string, unknown>) : null,
    earnings,
    days,
    flow: EMPTY_FLOW,
    flowWindow: NO_WINDOW,
    dark: EMPTY_DARK,
    darkWindow: NO_WINDOW,
    contracts: Array.isArray(contractR) ? (contractR as Record<string, unknown>[]) : [],
    quarters,
    street,
    at: got ? Date.now() : undefined,
  };
  files.set(ticker, head);
  emit();
  return head;
}

async function loadTapes(ticker: string, headP: Promise<StockFile | null>): Promise<void> {
  /* asked right behind the head (the head's calls are in the queue first), assembled once the head is in */
  const session = lastSessionIso();
  const tapesP = Promise.all([
    flowTape(ticker, session).catch(() => ({ rows: [] as Record<string, unknown>[], window: NO_WINDOW })),
    darkTape(ticker, session).catch(() => ({ rows: [] as Record<string, unknown>[], window: NO_WINDOW })),
    whalesBars(ticker, '1m', 1000).catch(() => []),
  ]);
  const head = await headP;
  const [flowR, darkR, barR] = await tapesP;
  if (!head) return;
  const spot = num(head.screen?.close) || head.days[head.days.length - 1]?.close || 0;
  const got = head.status === 'live';
  const minutes: Candle[] = [];
  for (const b of Array.isArray(barR) ? barR : []) {
    const time = Math.floor(Date.parse(String(b.start_time || b.end_time || '')) / 1000);
    const close = num(b.close);
    if (!time || !(close > 0)) continue;
    const at = time * 1000;
    const m = nyMinuteOf(at);
    if (nyIsoDate(at) !== session || m < SESSION_OPEN_MIN || m >= SESSION_CLOSE_MIN) continue;
    minutes.push({ time, open: num(b.open) || close, high: num(b.high) || close, low: num(b.low) || close, close, volume: num(b.volume) });
  }
  minutes.sort((a, b) => a.time - b.time);
  /* the session's range from its one-minute bars; the vendor's daily bar is kept where the minutes are thin */
  let days2 = head.days;
  let rangeAsOf: string | undefined;
  const lastDay = head.days[head.days.length - 1];
  if (minutes.length >= 30 && lastDay && nyIsoDate(lastDay.time * 1000) === session) {
    const hi = Math.max(...minutes.map(c => c.high));
    const lo = Math.min(...minutes.map(c => c.low));
    const lastMin = minutes[minutes.length - 1];
    const open = nyIsoDate() === session && nyMinuteOf(Date.now()) < SESSION_CLOSE_MIN;
    days2 = [...head.days.slice(0, -1), { ...lastDay, high: hi, low: lo, close: open ? lastMin.close : lastDay.close, open: minutes[0].open || lastDay.open }];
    if (open) rangeAsOf = clock(new Date((lastMin.time + 60) * 1000).toISOString());
  }
  const now0 = files.get(ticker) ?? head;
  files.set(ticker, {
    ...now0,
    days: days2,
    rangeAsOf,
    tapes: 'live',
    minutes,
    flow: flowsFrom(flowR.rows, spot, session),
    flowWindow: flowR.window,
    dark: darksFrom(darkR.rows, spot),
    darkWindow: darkR.window,
    at: got ? Date.now() : head.at,
  });
  emit();
}

export function peekStockFile(ticker: string): StockFile {
  return files.get(ticker.toUpperCase()) ?? blank('loading');
}

function ensureStockFile(ticker: string, tapes = true): void {
  const t = ticker.toUpperCase();
  if (!t) return;
  if (!started.has(t)) {
    started.add(t);
    files.set(t, blank('loading'));
    emit();
    heads.set(
      t,
      load(t).catch(() => {
        if (files.get(t)?.status === 'loading') files.set(t, blank('error'));
        emit();
        return null;
      }),
    );
  }
  if (tapes && !tapesAsked.has(t)) {
    tapesAsked.add(t);
    const headP = heads.get(t);
    if (headP) void loadTapes(t, headP);
  }
}

/** The name's file; `tapes: false` reads only its head (the screener row, the reports, the sessions, the chain) */
export function useStockFile(ticker: string, opts: { tapes?: boolean } = {}): StockFile {
  const t = ticker.toUpperCase();
  const tapes = opts.tapes !== false;
  useEffect(() => {
    ensureStockFile(t, tapes);
  }, [t, tapes]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => peekStockFile(t),
    () => LOADING,
  );
}
