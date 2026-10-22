/*
  The live record. The browser asks this app's server (/api/uw); the server
  holds the Unusual Whales token. Until a feed answers, the page shows nothing.
  A failed feed stays empty. It does not invent a congressman or a headline.
*/

import { useMemo, useSyncExternalStore } from 'react';
import { EMPTY_CONGRESS } from './congress';
import { ALL_CODES, insiderBook, OPEN_MARKET_CODES, personSlug, summariseFlow } from './insiders';
import { geoFromItems, type EconEvent, type GeoNewsEvent } from './newsroom';
import type { CongressFeed, CongressTrade, InsiderFlow, InsiderTrade, TxCode } from '../types/record';
import { whalesCongress, whalesEcon, whalesNews, whalesPoliticians, uwCall, type UwInsider } from './whales';
import { congressFromWhales, econFromWhales, insidersFromWhales, newsFromWhales, rollCongress } from './whalesMap';

export type FeedStatus = 'loading' | 'live' | 'sim';

export interface LiveSnapshot {
  news: { status: FeedStatus; events: GeoNewsEvent[] };
  econ: { status: FeedStatus; events: EconEvent[] };
  congress: { status: FeedStatus; trades: CongressTrade[] };
  insiders: { status: FeedStatus; trades: InsiderTrade[] };
}

const initial: LiveSnapshot = {
  news: { status: 'loading', events: [] },
  econ: { status: 'loading', events: [] },
  congress: { status: 'loading', trades: [] },
  insiders: { status: 'loading', trades: [] },
};

let snap: LiveSnapshot = initial;
const listeners = new Set<() => void>();

const emit = (next: LiveSnapshot) => {
  snap = next;
  listeners.forEach(fn => fn());
};

const patch = (part: Partial<LiveSnapshot>) => emit({ ...snap, ...part });

async function pullNews() {
  try {
    let painted = false;
    const rows = await whalesNews(soFar => {
      painted = true;
      patch({ news: { status: 'live', events: geoFromItems(newsFromWhales(soFar)) } });
    });
    if (!Array.isArray(rows)) throw new Error('shape');
    if (!painted) patch({ news: { status: 'live', events: geoFromItems(newsFromWhales(rows)) } });
  } catch {
    if (snap.news.status !== 'live') patch({ news: { status: 'sim', events: [] } });
  }
}

async function pullEcon() {
  try {
    const rows = await whalesEcon();
    if (!Array.isArray(rows)) throw new Error('shape');
    patch({ econ: { status: 'live', events: econFromWhales(rows) } });
  } catch {
    if (snap.econ.status !== 'live') patch({ econ: { status: 'sim', events: [] } });
  }
}

async function pullCongress() {
  try {
    const rows = await whalesCongress();
    if (!Array.isArray(rows)) throw new Error('shape');
    const paint = (people: Awaited<ReturnType<typeof whalesPoliticians>>) =>
      patch({ congress: { status: 'live', trades: congressFromWhales(rows, Array.isArray(people) ? people : []).trades } });
    paint([]);
    const people = await whalesPoliticians().catch(() => []);
    if (Array.isArray(people) && people.length) paint(people);
  } catch {
    if (snap.congress.status !== 'live') patch({ congress: { status: 'sim', trades: [] } });
  }
}

/* THE INSIDER BOOK'S COVERAGE (the retail pass, 2026-10-22). /insider/transactions answers at most 500 filings a call,
   newest filing first — the old single call covered about nine days while the page said 90. Now three reads:
     · open-market PURCHASES (code P, Form 4, common stock) are paged until the window is covered — about 500 every
       two to three weeks, so 90 days is five calls (capped at PAGE_CAP);
     · open-market SALES of $1M or more (code S, Form 4, common stock) are paged the same way — about 500 a fortnight;
     · everything else (smaller sales, grants, exercises, tax withholding, gifts) is the latest REST_PAGES × 500
       filings, and the page says exactly which filing dates that covers.
   common_stock_only keeps out SAFE notes and convertible debentures, whose "price" is the face of the whole note
   (a $2,000,000 "price" on a SAFE read as $15.7 trillion of chosen buying). */
const INS_LIMIT = 500;
const PAGE_CAP = 10;
const REST_PAGES = 2;
const BIG_SALE = 1_000_000;
const BUYS_PATH = '/insider/transactions?transaction_codes[]=P&form_types[]=4&form_types[]=4/A&common_stock_only=true&limit=500';
const SALES_PATH = `/insider/transactions?transaction_codes[]=S&form_types[]=4&form_types[]=4/A&common_stock_only=true&min_value=${BIG_SALE}&limit=500`;
const REST_PATH = '/insider/transactions?limit=500';

export interface InsiderCoverage {
  /** Purchases are complete for filings on or after this date (YYYY-MM-DD), or null before the first answer */
  buysSince: string | null;
  /** True when the purchase pages reached back past the window asked for */
  buysComplete: boolean;
  /** Sales of BIG_SALE or more: the same two facts */
  bigSalesSince: string | null;
  bigSalesComplete: boolean;
  bigSale: number;
  /** Everything else is complete for filings on or after this date */
  restSince: string | null;
  restNewest: string | null;
  restCount: number;
}

let insCoverage: InsiderCoverage = { buysSince: null, buysComplete: false, bigSalesSince: null, bigSalesComplete: false, bigSale: BIG_SALE, restSince: null, restNewest: null, restCount: 0 };
let restRows: UwInsider[] = [];
let wantDays = 90;

const nyIso = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const isoDaysBack = (days: number) => nyIso(new Date(Date.now() - days * 86_400_000));
const oldestFiling = (rows: UwInsider[]): string | null =>
  rows.reduce<string | null>((m, r) => {
    const f = (r.filing_date || '').slice(0, 10);
    return f && (!m || f < m) ? f : m;
  }, null);
const newestFiling = (rows: UwInsider[]): string | null =>
  rows.reduce<string | null>((m, r) => {
    const f = (r.filing_date || '').slice(0, 10);
    return f && (!m || f > m) ? f : m;
  }, null);
const nextIso = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** One paged read, newest filing first, walked back until it covers the window */
interface Pager {
  path: string;
  pages: UwInsider[][];
  pulling: Promise<void> | null;
}
const buys: Pager = { path: BUYS_PATH, pages: [], pulling: null };
const bigSales: Pager = { path: SALES_PATH, pages: [], pulling: null };

/** Complete since: the oldest page's oldest filing day may be cut mid-day, so the day after it — unless the read ran out */
const coverOf = (pg: Pager): { since: string | null; complete: boolean } => {
  const last = pg.pages[pg.pages.length - 1];
  const oldest = oldestFiling(pg.pages.flat());
  const ranOut = !!last && last.length < INS_LIMIT;
  return { since: ranOut ? oldest : oldest ? nextIso(oldest) : null, complete: ranOut || (!!oldest && oldest <= isoDaysBack(wantDays)) };
};

function paintInsiders() {
  const seen = new Set<string>();
  const merged: UwInsider[] = [];
  const keyOf = (r: UwInsider) => String((r as { id?: string }).id ?? `${r.ticker}-${r.owner_name}-${r.transaction_date}-${r.transaction_code}-${r.amount}`);
  for (const r of [...buys.pages.flat(), ...bigSales.pages.flat(), ...restRows]) {
    const key = keyOf(r);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  const b = coverOf(buys);
  const s = coverOf(bigSales);
  const restOldest = oldestFiling(restRows);
  insCoverage = {
    buysSince: b.since,
    buysComplete: b.complete,
    bigSalesSince: s.since,
    bigSalesComplete: s.complete,
    bigSale: BIG_SALE,
    restSince: restRows.length >= INS_LIMIT * REST_PAGES ? (restOldest ? nextIso(restOldest) : null) : restOldest,
    restNewest: newestFiling(restRows),
    restCount: restRows.length,
  };
  patch({ insiders: { status: 'live', trades: insidersFromWhales(merged) } });
}

async function pageBack(pg: Pager): Promise<void> {
  while (pg.pages.length < PAGE_CAP) {
    const last = pg.pages[pg.pages.length - 1];
    if (last && (last.length < INS_LIMIT || (oldestFiling(last) ?? '9999') <= isoDaysBack(wantDays))) break;
    const res = await uwCall(`${pg.path}&page=${pg.pages.length}`);
    if (res.error || !Array.isArray(res.data)) throw new Error(res.error || 'shape');
    pg.pages.push(res.data as UwInsider[]);
    paintInsiders();
  }
}

function extend(pg: Pager): Promise<void> {
  if (!pg.pulling) {
    pg.pulling = pageBack(pg)
      .catch(() => undefined)
      .finally(() => {
        pg.pulling = null;
        paintInsiders();
      });
  }
  return pg.pulling;
}

async function pullInsiders() {
  try {
    /* the first page of each read lands first so the grid paints, then the purchases and big sales page back */
    const [buy0, sale0, rest0] = await Promise.all([uwCall(`${BUYS_PATH}&page=0`), uwCall(`${SALES_PATH}&page=0`), uwCall(`${REST_PATH}&page=0`)]);
    if (buy0.error && sale0.error && rest0.error) throw new Error(buy0.error);
    for (const [pg, res] of [[buys, buy0], [bigSales, sale0]] as const) {
      if (res.error || !Array.isArray(res.data)) continue;
      if (pg.pages.length) pg.pages[0] = res.data as UwInsider[];
      else pg.pages.push(res.data as UwInsider[]);
    }
    const restFirst = !rest0.error && Array.isArray(rest0.data) ? (rest0.data as UwInsider[]) : [];
    restRows = restFirst.concat(restRows.slice(restFirst.length));
    paintInsiders();
    const rest = (async () => {
      for (let n = 1; n < REST_PAGES && restRows.length < INS_LIMIT * REST_PAGES; n++) {
        const res = await uwCall(`${REST_PATH}&page=${n}`);
        if (res.error || !Array.isArray(res.data)) break;
        restRows = restRows.concat(res.data as UwInsider[]);
        paintInsiders();
        if ((res.data as UwInsider[]).length < INS_LIMIT) break;
      }
    })();
    await Promise.all([rest, extend(buys), extend(bigSales)]);
  } catch {
    if (snap.insiders.status !== 'live') patch({ insiders: { status: 'sim', trades: [] } });
  }
}

/** The window the page shows: purchases and big sales are paged back to cover it */
export function wantInsiderWindow(days: number): void {
  if (days <= wantDays) return;
  wantDays = days;
  if (buys.pages.length) void extend(buys);
  if (bigSales.pages.length) void extend(bigSales);
}

export function useInsiderCoverage(): InsiderCoverage {
  useInsidersSnap();
  return insCoverage;
}

let newsOn = false;
let econOn = false;
let congressOn = false;
let insidersOn = false;

function ensureNews() {
  if (newsOn || typeof window === 'undefined') return;
  newsOn = true;
  void pullNews();
  window.setInterval(() => void pullNews(), 60_000);
}
function ensureEcon() {
  if (econOn || typeof window === 'undefined') return;
  econOn = true;
  void pullEcon();
  window.setInterval(() => void pullEcon(), 60_000);
}
function ensureCongress() {
  if (congressOn || typeof window === 'undefined') return;
  congressOn = true;
  void pullCongress();
  window.setInterval(() => void pullCongress(), 5 * 60_000);
}
function ensureInsiders() {
  if (insidersOn || typeof window === 'undefined') return;
  insidersOn = true;
  void pullInsiders();
  window.setInterval(() => void pullInsiders(), 5 * 60_000);
}

/** News opens on the wire and the calendar. The other books wait until their page. */
export function warmNews() {
  ensureNews();
  ensureEcon();
}

function ensure() {
  ensureNews();
  ensureEcon();
  ensureCongress();
  ensureInsiders();
}

const listen = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const peekLive = (): LiveSnapshot => snap;

export function subscribeLive(fn: () => void): () => void {
  const off = listen(fn);
  ensure();
  return off;
}

export function useLiveRecord(): LiveSnapshot {
  return useSyncExternalStore(subscribeLive, peekLive, peekLive);
}

export function useNewsFeed() {
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureNews();
      return off;
    },
    () => snap.news,
    () => snap.news,
  );
}

export function useEconFeed() {
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureEcon();
      return off;
    },
    () => snap.econ,
    () => snap.econ,
  );
}

export function useGeoNews(): GeoNewsEvent[] {
  const news = useNewsFeed();
  return useMemo(() => (news.status === 'live' ? news.events : []), [news]);
}

export function useEconCalendar(): EconEvent[] {
  const econ = useEconFeed();
  return useMemo(() => (econ.status === 'live' ? econ.events : []), [econ]);
}

export function useCongressFeed(windowDays: number): CongressFeed {
  const congress = useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureCongress();
      return off;
    },
    () => snap.congress,
    () => snap.congress,
  );
  return useMemo(() => {
    if (congress.status !== 'live') return { ...EMPTY_CONGRESS, windowDays };
    return rollCongress(congress.trades.filter(t => t.tradedDaysAgo <= windowDays), windowDays);
  }, [congress, windowDays]);
}

function useInsidersSnap() {
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureInsiders();
      return off;
    },
    () => snap.insiders,
    () => snap.insiders,
  );
}

/** Where the insider book stands — 'sim' is a failed read, never "nobody traded" */
export function useInsidersStatus(): FeedStatus {
  return useInsidersSnap().status;
}

/** Where the congress book stands — 'sim' is a failed read */
export function useCongressStatus(): FeedStatus {
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureCongress();
      return off;
    },
    () => snap.congress.status,
    () => snap.congress.status,
  );
}

export function useInsiderTrades(windowDays: number, codes: readonly TxCode[]): InsiderTrade[] {
  const insiders = useInsidersSnap();
  return useMemo(() => {
    if (insiders.status !== 'live') return [];
    const keep = new Set(codes);
    return insiders.trades.filter(t => t.daysAgo <= windowDays && keep.has(t.code));
  }, [insiders, windowDays, codes]);
}

export function useInsiderBuyers(windowDays: number): InsiderFlow[] {
  const insiders = useInsidersSnap();
  return useMemo(() => {
    if (insiders.status !== 'live') return [];
    const by = new Map<string, InsiderTrade[]>();
    for (const t of insiders.trades) {
      if (t.daysAgo > windowDays) continue;
      const list = by.get(t.ticker) ?? [];
      list.push(t);
      by.set(t.ticker, list);
    }
    return [...by.entries()]
      .map(([ticker, trades]) => summariseFlow(ticker, trades, windowDays))
      .filter(f => f.openMarketBuys > 0)
      .sort((a, b) => b.openMarketBuys - a.openMarketBuys);
  }, [insiders, windowDays]);
}

const TICKER_WAIT: { status: FeedStatus; trades: InsiderTrade[] } = { status: 'loading', trades: [] };
const tickerIns = new Map<string, { status: FeedStatus; trades: InsiderTrade[] }>();

function ensureTickerInsiders(sym: string) {
  if (tickerIns.has(sym) || typeof window === 'undefined') return;
  tickerIns.set(sym, { status: 'loading', trades: [] });
  void (async () => {
    const res = await uwCall(`/insider/transactions?ticker_symbol=${encodeURIComponent(sym)}`);
    const rows = Array.isArray(res.data) ? (res.data as UwInsider[]) : [];
    tickerIns.set(sym, res.error ? { status: 'sim', trades: [] } : { status: 'live', trades: insidersFromWhales(rows) });
    listeners.forEach(fn => fn());
  })();
}

export function useInsiderFlow(ticker: string, windowDays = 90): InsiderFlow {
  const sym = ticker.toUpperCase();
  const box = useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureTickerInsiders(sym);
      return off;
    },
    () => tickerIns.get(sym) ?? TICKER_WAIT,
    () => tickerIns.get(sym) ?? TICKER_WAIT,
  );
  return useMemo(() => {
    const trades = box.status === 'live' ? box.trades.filter(t => t.daysAgo <= windowDays) : [];
    return summariseFlow(sym, trades, windowDays);
  }, [box, sym, windowDays]);
}

/** undefined while the feed is still being read; null when the person is not on it. */
export function useInsiderBook(slug: string, windowDays = 365): ReturnType<typeof insiderBook> | undefined {
  const insiders = useInsidersSnap();
  return useMemo(() => {
    if (insiders.status === 'loading') return undefined;
    if (insiders.status !== 'live') return null;
    const trades = insiders.trades.filter(t => t.daysAgo <= windowDays && personSlug(t.person) === slug);
    if (trades.length === 0) return null;
    const first = trades[0];
    return { person: first.person, role: first.role, ticker: first.ticker, trades };
  }, [insiders, slug, windowDays]);
}

export const insiderCodes = { market: OPEN_MARKET_CODES, all: ALL_CODES };
