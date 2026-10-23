/*
  One name's file: daily sessions, the last prints, the flow alerts, the
  off-exchange tape. The stock page reads this. Nothing here is invented.
*/

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { daysBetween, lastSessionIso, nyDayOf, nyTodayIso } from './nyDate';
import type { DarkPoolPrint } from '../types/darkpool';
import type { FlowPrint } from '../types/trace';
import { uwCall, whalesDailyLong, whalesEarnings, whalesOptionContracts, whalesScreener, type UwDaily } from './whales';

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
  /** The New York session the flow alerts and the dark prints are filtered to ("2026-10-22" before the open on the 23rd) */
  session: string;
  /** Epoch ms of the last print that landed. */
  at?: number;
}

const EMPTY_EARN: EarnRow[] = [];
const EMPTY_DAYS: Candle[] = [];
const EMPTY_FLOW: FlowPrint[] = [];
const EMPTY_DARK: DarkPoolPrint[] = [];
const EMPTY_CONTRACTS: Record<string, unknown>[] = [];
const NO_WINDOW: TapeWindow = { complete: false, from: '', to: '', rows: 0, pages: 0 };
/** One object per status. A fresh object on every read makes useSyncExternalStore
    treat the file as changed and warn that getSnapshot is not cached. */
const LOADING: StockFile = { status: 'loading', session: '', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, flowWindow: NO_WINDOW, dark: EMPTY_DARK, darkWindow: NO_WINDOW, contracts: EMPTY_CONTRACTS };
const FAILED: StockFile = { status: 'error', session: '', screen: null, earnings: EMPTY_EARN, days: EMPTY_DAYS, flow: EMPTY_FLOW, flowWindow: NO_WINDOW, dark: EMPTY_DARK, darkWindow: NO_WINDOW, contracts: EMPTY_CONTRACTS };

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
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
};

const mmddyyyy = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${m}/${d}/${y}` : iso;
};

/* calendar days from New York's today to the expiry — never UTC midnight against the clock (data/nyDate.ts) */
const dteOf = (iso: string): number => {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  return Math.max(0, daysBetween(nyTodayIso(), day));
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

/** New York's calendar day — a contract expiring before it is dead and is never listed as busy */
const nyToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function flowsFrom(rows: Record<string, unknown>[], spot: number, session: string): FlowPrint[] {
  const today = nyToday();
  /* THE SESSION'S ALERTS ONLY (the third audit, 2026-10-23): the vendor's alerts reach back over days — 5 of WOLF's 11
     "today" were from 10/16–10/21 — so the premium-today split and the tape's richest prints read only alerts created on
     the session the page names; an alert on a contract that has since expired is not "busy" any more either */
  const live = rows.filter(row => {
    if (nyDayOf(String(row.created_at || '')) !== session) return false;
    const exp = String(row.expiry || '').slice(0, 10);
    return !/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp >= today;
  });
  /* every alert of the session is kept: the ask and sweep shares are sums over all of them (the tape shows the top few) */
  return live.map((row, i) => {
    const prem = num(row.total_premium);
    const ask = num(row.total_ask_side_prem);
    const bid = num(row.total_bid_side_prem);
    const side: FlowPrint['side'] = ask > bid * 1.15 ? 'ASK' : bid > ask * 1.15 ? 'BID' : 'MID';
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
      dte: dteOf(expiry),
      fill: num(row.price),
      bid: num(row.bid),
      ask: num(row.ask),
      fillPos: side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5,
      side,
      flowScore: side === 'ASK' ? 60 : side === 'BID' ? -60 : 0,
      ratioLabel: side,
      ratioBidPct: prem > 0 ? (100 * bid) / prem : 0,
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

/* THE DARK POOL READ, ON THE TRACE CONVENTION (the re-audit, 2026-10-22). AAPL read "distributing · strong · the
   largest $991M at 348.22" off 80 prints that were all after 16:00 — the largest a prior-reference-price print, others
   average-price trades — and every print was set against today's spot, not its own quote. Now, as Trace reads them: a
   print is set against the NBBO midpoint at its own print time (the print's nbbo_bid / nbbo_ask); paid over the mid is
   buyer-initiated (ACCUMULATION), sold under it seller-initiated (DISTRIBUTION), at the mid (within half a cent) neither.
   Only a sized print (10,000 shares or $500K) in the regular session, priced at the quote, carries a read: average-price,
   prior-reference, contingent, qualified-contingent, derivative-priced and stopped-stock prints, and every
   extended-hours print, are kept on the tape and never read. */
const SPECIAL_WORD: Record<string, string> = {
  average_price_trade: 'average-price trade',
  prior_reference_price: 'prior-reference-price trade',
  contingent_trade: 'contingent trade',
  qualified_contingent_trade: 'qualified contingent trade',
  derivative_priced: 'derivative-priced trade',
  derivatively_priced: 'derivative-priced trade',
  stopped_stock: 'stopped-stock trade',
};
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
    .filter(r => !r.canceled)
    .map((row, i) => {
      const price = num(row.price);
      const size = num(row.size);
      const notional = num(row.premium) || price * size;
      const bid = num(row.nbbo_bid);
      const ask = num(row.nbbo_ask);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      const codes = [row.sale_cond_codes, row.trade_code].flatMap(c => (Array.isArray(c) ? c : [c])).filter(c => c != null && c !== '').map(String);
      const own = codes.filter(c => c in SPECIAL_WORD);
      const special = own.length ? [...new Set(own.map(c => SPECIAL_WORD[c]))].join(', ') : null;
      const minute = nyMinutes(String(row.executed_at || ''));
      const outside = minute != null && (minute < 9 * 60 + 30 || minute >= 16 * 60);
      const extended = (row.ext_hour_sold_codes != null && row.ext_hour_sold_codes !== '') || outside;
      const sized = size >= 10_000 || notional >= 500_000;
      const cents = mid > 0 ? (price - mid) * 100 : 0;
      const place = mid <= 0 ? 'no quote' : Math.abs(cents) < 0.5 ? 'at the mid' : cents > 0 ? 'over the mid' : 'under the mid';
      const readable = sized && !special && !extended && mid > 0;
      const intent: DarkPoolPrint['intent'] = !readable ? 'ROTATION' : Math.abs(cents) < 0.5 ? 'HEDGE FLOW' : cents > 0 ? 'ACCUMULATION' : 'DISTRIBUTION';
      return {
        id: i + 1,
        time: clock(String(row.executed_at || '')),
        ticker: String(row.ticker || '').toUpperCase(),
        price,
        size,
        notional,
        venue: String(row.market_center || 'off-exchange'),
        vsSpotPct: mid > 0 ? ((price - mid) / mid) * 100 : spot > 0 ? ((price - spot) / spot) * 100 : 0,
        atLevel: false,
        sized: sized && !special,
        intent,
        conviction: 40,
        read: special
          ? `${size.toLocaleString('en-US')} shares at ${price.toFixed(2)} — ${/^[aeiou]/i.test(special) ? 'an' : 'a'} ${special}, priced by its terms; no read`
          : extended
            ? `${size.toLocaleString('en-US')} shares at ${price.toFixed(2)} — outside the regular session; no read`
            : `${size.toLocaleString('en-US')} shares at ${price.toFixed(2)}, ${place}`,
        exec: special || mid <= 0 ? null : Math.abs(cents) < 0.5 ? 'MID' : cents > 0 ? 'ASK' : 'BID',
        bid: bid > 0 ? bid : null,
        ask: ask > 0 ? ask : null,
        special,
        extended: extended || undefined,
      } satisfies DarkPoolPrint;
    });
}

/* THE TAPE THE READ STANDS ON. After the bell the newest prints are all post-market, so the read had nothing of the
   session: the prints are asked for on the session the page names, up to its 16:00 New York close once that has passed.
   SIZED IS 10,000 SHARES OR $500K (Trace's SidesRule; the third audit, 2026-10-23: asked for $500K+ alone, GME lost 16
   of its 25 sized prints) — so the tape is two asks, the $500K+ prints and the 10,000-share+ prints, merged on the
   vendor's tracking id. The window they span is printed with the read. */
export const DARK_MIN_PREMIUM = 500_000;
export const DARK_MIN_SIZE = 10_000;

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

/* PAGED BACK, BOUNDED (the fourth audit, 2026-10-23). One call of 500 rows covered SPY's $500K+ prints from 15:42 only
   while the label said 09:32–15:59 (the start came from the 42-row 10,000-share read). Each stream now pages back
   with older_than — the oldest print in hand — until it reaches the session's start or the vendor runs dry, at most
   `maxPages` calls in a row (the key has 3 upstream slots for everyone, so the paging is sequential and capped). */
async function pageBack(base: string, stamp: string, limit: number, startMs: number, endMs: number | null, maxPages: number): Promise<{ rows: Record<string, unknown>[]; complete: boolean; oldestMs: number | null; pages: number; error: string | null }> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let older = endMs != null ? Math.floor(endMs / 1000) : null;
  let oldestMs: number | null = null;
  let pages = 0;
  let error: string | null = null;
  while (pages < maxPages) {
    const res = await uwCall(`${base}${older != null ? `&older_than=${older}` : ''}`, true);
    pages += 1;
    if (res.error) {
      error = res.error;
      break;
    }
    const page = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    let fresh = 0;
    for (const row of page) {
      const key = String(row.tracking_id ?? row.id ?? `${row[stamp]}|${row.price}|${row.size}|${row.option_chain ?? ''}`);
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
       pages is read whole (the tracking id dedupes it); a page with nothing new steps a second further back */
    const next = oldestMs != null ? Math.floor(oldestMs / 1000) + (fresh > 0 ? 1 : 0) : null;
    if (next == null || (older != null && next >= older)) older = older != null ? older - 1 : null;
    else older = next;
    if (older == null) break;
  }
  return { rows, complete: false, oldestMs, pages, error };
}

/* THE TAPE THE READ STANDS ON. After the bell the newest prints are all post-market, so the read had nothing of the
   session: the prints are asked for on the session the page names, up to its 16:00 New York close once that has passed.
   SIZED IS 10,000 SHARES OR $500K (Trace's SidesRule; the third audit, 2026-10-23: asked for $500K+ alone, GME lost 16
   of its 25 sized prints) — so the tape is two asks, the $500K+ prints and the 10,000-share+ prints, merged on the
   vendor's tracking id. When either ask could not be paged back to the open, both are cut to the window the shorter
   one covers, so every print in the read is from one stated window — and that window is printed with the read. */
const DARK_LIMIT = 500;
async function darkTape(ticker: string, session: string): Promise<{ rows: Record<string, unknown>[]; window: TapeWindow }> {
  const closeMs = nyInstant(session, 16);
  const openMs = nyInstant(session, 9, 30);
  const endMs = Date.now() >= closeMs ? closeMs : null;
  const base = `/darkpool/${encodeURIComponent(ticker)}?date=${session}&limit=${DARK_LIMIT}`;
  const [byPrem, bySize] = await Promise.all([
    pageBack(`${base}&min_premium=${DARK_MIN_PREMIUM}`, 'executed_at', DARK_LIMIT, openMs, endMs, 12),
    pageBack(`${base}&min_size=${DARK_MIN_SIZE}`, 'executed_at', DARK_LIMIT, openMs, endMs, 6),
  ]);
  if (byPrem.error && bySize.error && !byPrem.rows.length && !bySize.rows.length) throw new Error(byPrem.error);
  /* the window both streams cover: from the later of the two oldest prints when either stopped short of the open */
  const cuts = [byPrem, bySize].filter(r => !r.complete && r.oldestMs != null).map(r => r.oldestMs as number);
  const fromMs = cuts.length ? Math.max(...cuts) : null;
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const res of [byPrem, bySize]) {
    for (const row of res.rows) {
      const key = String(row.tracking_id ?? `${row.executed_at}|${row.price}|${row.size}`);
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

/* THE SESSION'S FLOW ALERTS, PAGED BACK (the fourth audit, 2026-10-23): 200 rows covered SPY's alerts from 15:53 only
   and AAPL's from 14:38 while the page called them the session's. They are paged back with older_than to the session's
   New York midnight (newer_than holds the floor), at most 8 pages; the window in hand is stated with them. */
const FLOW_LIMIT = 200;
async function flowTape(ticker: string, session: string): Promise<{ rows: Record<string, unknown>[]; window: TapeWindow }> {
  const dayStart = nyInstant(session, 0);
  const dayEnd = nyInstant(session, 23, 59);
  const endMs = Date.now() > dayEnd ? dayEnd : null;
  const base = `/option-trades/flow-alerts?ticker_symbol=${encodeURIComponent(ticker)}&limit=${FLOW_LIMIT}&newer_than=${Math.floor(dayStart / 1000)}`;
  const got = await pageBack(base, 'created_at', FLOW_LIMIT, dayStart, endMs, 8);
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

async function load(ticker: string): Promise<void> {
  const session = lastSessionIso();
  const [screenR, earnR, dayR, flowR, darkR, contractR] = await Promise.all([
    whalesScreener([ticker]).catch(() => [] as Record<string, unknown>[]),
    whalesEarnings(ticker, true).catch(() => [] as EarnRow[]),
    whalesDailyLong(ticker).catch(() => [] as UwDaily[]),
    /* the session's alerts, paged back to its start (bounded); filtered to that session in flowsFrom */
    flowTape(ticker, session).catch(() => ({ rows: [] as Record<string, unknown>[], window: NO_WINDOW })),
    darkTape(ticker, session).catch(() => ({ rows: [] as Record<string, unknown>[], window: NO_WINDOW })),
    /* the same call the earnings page makes, so the two pages' busiest contracts agree */
    whalesOptionContracts(ticker, undefined, true).catch(() => [] as Record<string, unknown>[]),
  ]);
  const screen = Array.isArray(screenR) ? (screenR.find(r => String(r.ticker || '').toUpperCase() === ticker) ?? screenR[0] ?? null) : null;
  const days = daysFrom(Array.isArray(dayR) ? dayR : []);
  const spot = num(screen && typeof screen === 'object' ? (screen as Record<string, unknown>).close : 0) || days[days.length - 1]?.close || 0;
  const got = (Array.isArray(screenR) && screenR.length > 0) || days.length > 0 || (Array.isArray(earnR) && earnR.length > 0);
  files.set(ticker, {
    status: got ? 'live' : 'error',
    session,
    screen: screen && typeof screen === 'object' ? (screen as Record<string, unknown>) : null,
    earnings: Array.isArray(earnR) ? earnR : [],
    days,
    flow: flowsFrom(flowR.rows, spot, session),
    flowWindow: flowR.window,
    dark: darksFrom(darkR.rows, spot),
    darkWindow: darkR.window,
    contracts: Array.isArray(contractR) ? (contractR as Record<string, unknown>[]) : [],
    at: got ? Date.now() : undefined,
  });
  emit();
}

export function peekStockFile(ticker: string): StockFile {
  return files.get(ticker.toUpperCase()) ?? blank('loading');
}

export function ensureStockFile(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || started.has(t)) return;
  started.add(t);
  files.set(t, blank('loading'));
  emit();
  void load(t).catch(() => {
    if (files.get(t)?.status === 'loading') files.set(t, blank('error'));
    emit();
  });
}

export function useStockFile(ticker: string): StockFile {
  const t = ticker.toUpperCase();
  useEffect(() => {
    ensureStockFile(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => peekStockFile(t),
    () => LOADING,
  );
}
