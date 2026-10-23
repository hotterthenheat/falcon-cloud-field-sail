/*
  The live record. The browser asks this app's server (/api/uw); the server
  holds the Unusual Whales token. Until a feed answers, the page shows nothing.
  A failed feed stays empty. It does not invent a congressman or a headline.
*/

import { useMemo, useSyncExternalStore } from 'react';
import { EMPTY_CONGRESS } from './congress';
import { ALL_CODES, OPEN_MARKET_CODES, personSlug, summariseFlow } from './insiders';
import { geoFromItems, type EconEvent, type GeoNewsEvent } from './newsroom';
import type { CongressFeed, CongressTrade, InsiderFlow, InsiderTrade, TxCode } from '../types/record';
import { whalesEcon, whalesPoliticians, uwCall, type UwCongress, type UwInsider, type UwNews, type UwPolitician } from './whales';
import { nyIsoDaysBack } from './nyDate';
import { loadRegularCloses, peekRegularCloses } from './dayChange';
import { congressFromWhales, econFromWhales, insidersFromWhales, newsFromWhales, readInsiders, rollCongress } from './whalesMap';

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

/* THE WHOLE DAY'S WIRE (the data audit, 2026-10-22). The page said "every story on the wire today" over at most four
   pages of 50 — about two hours of a busy afternoon. The first read now pages back (100 a page, the route's maximum)
   until it passes New York's midnight, bounded at NEWS_PAGE_CAP pages; each minute after, only the newest page is read
   and merged in. The coverage — from what time the stories are complete — is kept and said on the page. */
const NEWS_LIMIT = 100;
const NEWS_PAGE_CAP = 16;
let newsRows: UwNews[] = [];
let newsBackfilled = false;
let newsPulling = false;
export interface NewsCoverage {
  /** The earliest story read, epoch ms, or null before the first answer */
  fromMs: number | null;
  /** True once the read reached back past New York's midnight */
  wholeDay: boolean;
  reading: boolean;
}
let newsCoverage: NewsCoverage = { fromMs: null, wholeDay: false, reading: true };
const newsKey = (r: UwNews) => `${r.created_at}|${r.headline}`;
/** New York's midnight today as an instant: 04:00 UTC in daylight time, 05:00 in standard time */
const nyMidnightMs = (): number => {
  const day = nyIsoDaysBack(0);
  const at4 = Date.parse(`${day}T04:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at4)));
  return hour === 0 ? at4 : Date.parse(`${day}T05:00:00Z`);
};

function paintNews() {
  const seen = new Set<string>();
  const rows = newsRows.filter(r => {
    const k = newsKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  newsRows = rows;
  /* TODAY IS NEW YORK'S DAY (the third audit, 2026-10-23): "every story on the wire today" counted 27 of 1,393 stories
     from before midnight — the backfill's last page crosses it. The wire on the pages is the NY day's stories only. */
  const midnight = nyMidnightMs();
  const todays = rows.filter(r => !(Date.parse(r.created_at) < midnight));
  const times = rows.map(r => Date.parse(r.created_at)).filter(Number.isFinite);
  const from = times.length ? Math.min(...times) : null;
  newsCoverage = { ...newsCoverage, fromMs: from == null ? null : Math.max(from, midnight), wholeDay: newsCoverage.wholeDay || (from != null && from <= midnight) };
  const items = newsFromWhales(todays, priorClose);
  patch({ news: { status: 'live', events: geoFromItems(items) } });
  wantCloses(todays);
}

/* THE CLOSE BEFORE AN AFTER-HOURS STORY'S SESSION (whalesMap.publishMove): the name's regular closes, read once a New
   York day (data/dayChange.ts), for the names whose stories crossed outside the session; the wire repaints as they land */
const priorClose = (ticker: string, before: string): number | null => {
  const closes = peekRegularCloses(ticker);
  return closes?.find(c => c.date < before)?.close ?? null;
};
const closesAsked = new Set<string>();
let closesRepaint: number | null = null;
function wantCloses(rows: UwNews[]): void {
  const need = new Set<string>();
  for (const r of rows) {
    for (const [t, m] of Object.entries(r.meta ?? {})) {
      const mt = String((m as { curr?: { mt?: string } })?.curr?.mt ?? '').toLowerCase();
      /* after-hours and pre-market stories both need the close before their last session (publishMove's `last`) */
      if ((mt.startsWith('post') || mt.startsWith('pre')) && (r.tickers ?? []).includes(t) && !closesAsked.has(t) && !peekRegularCloses(t)) need.add(t);
    }
  }
  for (const t of need) {
    closesAsked.add(t);
    void loadRegularCloses(t)
      .catch(() => null)
      .then(() => {
        if (closesRepaint != null || typeof window === 'undefined') return;
        closesRepaint = window.setTimeout(() => {
          closesRepaint = null;
          paintNews();
        }, 1500);
      });
  }
}

async function pullNews() {
  if (newsPulling) return;
  newsPulling = true;
  try {
    if (!newsBackfilled) {
      const midnight = nyMidnightMs();
      for (let page = 0; page < NEWS_PAGE_CAP; page++) {
        const res = await uwCall(`/news/headlines?limit=${NEWS_LIMIT}&page=${page}`, page === 0);
        if (res.error || !Array.isArray(res.data)) {
          if (page === 0) throw new Error(res.error || 'shape');
          break;
        }
        const rows = res.data as UwNews[];
        newsRows = newsRows.concat(rows);
        paintNews();
        const oldest = Math.min(...rows.map(r => Date.parse(r.created_at)).filter(Number.isFinite));
        if (rows.length < NEWS_LIMIT || !(oldest > midnight)) break;
      }
      newsBackfilled = true;
    } else {
      const res = await uwCall(`/news/headlines?limit=${NEWS_LIMIT}&page=0`);
      if (!res.error && Array.isArray(res.data)) {
        newsRows = (res.data as UwNews[]).concat(newsRows);
        /* a new day keeps only its own stories */
        const midnight = nyMidnightMs();
        if (newsCoverage.wholeDay) newsRows = newsRows.filter(r => !(Date.parse(r.created_at) < midnight - 6 * 3_600_000));
        paintNews();
      }
    }
  } catch {
    if (snap.news.status !== 'live') patch({ news: { status: 'sim', events: [] } });
  } finally {
    newsPulling = false;
    newsCoverage = { ...newsCoverage, reading: false };
    listeners.forEach(fn => fn());
  }
}

export function useNewsCoverage(): NewsCoverage {
  useNewsFeed();
  return newsCoverage;
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

/* THE CONGRESS BOOK'S REACH (the data audit, 2026-10-22). /congress/recent-trades answers at most 200 reports a call,
   newest TRADE first, and ignores `page` — the old three "pages" were one page three times, so the 90- and 180-day
   windows both showed the same six weeks. Its `date` parameter is the paging door: it returns the reports traded on or
   before that day. Each read asks again from the oldest trade day the last one reached, until the window is covered.
   A day with more than 200 reports cannot be read past (the call has no offset); the read steps to the day before and
   the coverage records that day as possibly incomplete. */
const CONGRESS_LIMIT = 200;
/** Enough calls to reach 180 days on the busiest stretch measured (27 on 2026-10-22), with room */
const CONGRESS_CALL_CAP = 40;
let congressRows: UwCongress[] = [];
let congressPeople: UwPolitician[] = [];
let congressWant = 90;
let congressPulling: Promise<void> | null = null;
/** The oldest trade day whose reports are complete, the days a read could not finish, and whether it is still reading */
export interface CongressCoverage {
  since: string | null;
  partialDays: string[];
  reading: boolean;
  capped: boolean;
}
let congressCoverage: CongressCoverage = { since: null, partialDays: [], reading: true, capped: false };
let congressCursor: string | null = null;
let congressCalls = 0;
let congressDone = false;

const paintCongress = () =>
  patch({ congress: { status: 'live', trades: congressFromWhales(congressRows, congressPeople).trades } });

async function pageCongress(): Promise<void> {
  while (!congressDone && congressCalls < CONGRESS_CALL_CAP) {
    const since = congressCoverage.since;
    if (since && since <= nyIsoDaysBack(congressWant)) break;
    const path = `/congress/recent-trades?limit=${CONGRESS_LIMIT}${congressCursor ? `&date=${congressCursor}` : ''}`;
    const res = await uwCall(path, congressCalls === 0);
    congressCalls += 1;
    if (res.error || !Array.isArray(res.data)) throw new Error(res.error || 'shape');
    const rows = res.data as UwCongress[];
    if (!rows.length) {
      congressDone = true;
      break;
    }
    congressRows = congressRows.concat(rows);
    const days = rows.map(r => (r.transaction_date || '').slice(0, 10)).filter(Boolean).sort();
    const oldest = days[0];
    const full = rows.length >= CONGRESS_LIMIT;
    if (!full) {
      congressDone = true;
      congressCoverage = { ...congressCoverage, since: oldest ?? congressCoverage.since };
    } else if (oldest && oldest === congressCursor) {
      /* the whole read was one day — more than 200 reports on it; step past it and say so */
      congressCoverage = { ...congressCoverage, partialDays: [...congressCoverage.partialDays, oldest], since: oldest };
      congressCursor = nyIsoDaysBack(1, oldest);
    } else {
      /* the oldest day may be cut mid-day: complete from the day after it, and the next read starts on it */
      congressCoverage = { ...congressCoverage, since: oldest ? nyIsoDaysBack(-1, oldest) : congressCoverage.since };
      congressCursor = oldest ?? null;
    }
    paintCongress();
  }
  congressCoverage = { ...congressCoverage, capped: !congressDone && congressCalls >= CONGRESS_CALL_CAP };
}

function extendCongress(): Promise<void> {
  if (!congressPulling) {
    congressCoverage = { ...congressCoverage, reading: true };
    congressPulling = pageCongress()
      .catch(() => {
        if (snap.congress.status !== 'live') patch({ congress: { status: 'sim', trades: [] } });
      })
      .finally(() => {
        congressPulling = null;
        congressCoverage = { ...congressCoverage, reading: false };
        if (snap.congress.status === 'live') paintCongress();
        else listeners.forEach(fn => fn());
      });
  }
  return congressPulling;
}

async function pullCongress() {
  /* a refresh re-reads from the newest report; the rows already read past it stay */
  if (congressPulling) return;
  if (congressCalls > 0) {
    const res = await uwCall(`/congress/recent-trades?limit=${CONGRESS_LIMIT}`);
    if (!res.error && Array.isArray(res.data)) {
      congressRows = (res.data as UwCongress[]).concat(congressRows);
      paintCongress();
    }
    return;
  }
  const people = whalesPoliticians()
    .then(p => {
      if (Array.isArray(p) && p.length) {
        congressPeople = p;
        if (snap.congress.status === 'live') paintCongress();
      }
    })
    .catch(() => undefined);
  await Promise.all([extendCongress(), people]);
}

/** The window the Congress page shows: the reports are paged back by trade day until it is covered */
export function wantCongressWindow(days: number): void {
  if (days <= congressWant) return;
  congressWant = days;
  if (congressCalls > 0) void extendCongress();
}

export function useCongressCoverage(): CongressCoverage {
  useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureCongress();
      return off;
    },
    () => snap.congress,
    () => snap.congress,
  );
  return congressCoverage;
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
/* 180 days of $1M+ sales measured at about thirteen pages (2026-10-22) */
const PAGE_CAP = 16;
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
  /** True when the purchases ran out (every filing the vendor has was read) */
  buysRanOut: boolean;
  /** True while purchase pages are still being read */
  buysReading: boolean;
  /** True when the reading stopped at the page cap, short of the window */
  buysCapped: boolean;
  /** Sales of BIG_SALE or more: the same facts */
  bigSalesSince: string | null;
  bigSalesComplete: boolean;
  bigSalesRanOut: boolean;
  bigSalesReading: boolean;
  bigSalesCapped: boolean;
  /** Rows set aside: open-market rows that were not common shares, and rows whose price or size cannot be a trade */
  notShares: number;
  implausible: number;
  bigSale: number;
  /** Everything else is complete for filings on or after this date */
  restSince: string | null;
  restNewest: string | null;
  restCount: number;
  /** True while the latest-filings read is still paging */
  restReading: boolean;
}

let restReading = true;
let insCoverage: InsiderCoverage = { buysSince: null, buysComplete: false, buysRanOut: false, buysReading: true, buysCapped: false, bigSalesSince: null, bigSalesComplete: false, bigSalesRanOut: false, bigSalesReading: true, bigSalesCapped: false, notShares: 0, implausible: 0, bigSale: BIG_SALE, restSince: null, restNewest: null, restCount: 0, restReading: true };
let restRows: UwInsider[] = [];
let wantDays = 90;

const isoDaysBack = (days: number) => nyIsoDaysBack(days);
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
const coverOf = (pg: Pager): { since: string | null; complete: boolean; ranOut: boolean; reading: boolean; capped: boolean } => {
  const last = pg.pages[pg.pages.length - 1];
  const oldest = oldestFiling(pg.pages.flat());
  const ranOut = !!last && last.length < INS_LIMIT;
  const complete = ranOut || (!!oldest && oldest <= isoDaysBack(wantDays));
  return { since: ranOut ? oldest : oldest ? nextIso(oldest) : null, complete, ranOut, reading: !!pg.pulling, capped: !complete && !pg.pulling && pg.pages.length >= PAGE_CAP };
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
  const read = readInsiders(merged);
  insCoverage = {
    buysSince: b.since,
    buysComplete: b.complete,
    buysRanOut: b.ranOut,
    buysReading: b.reading,
    buysCapped: b.capped,
    bigSalesSince: s.since,
    bigSalesComplete: s.complete,
    bigSalesRanOut: s.ranOut,
    bigSalesReading: s.reading,
    bigSalesCapped: s.capped,
    notShares: read.notShares,
    implausible: read.implausible,
    bigSale: BIG_SALE,
    restSince: restRows.length >= INS_LIMIT * REST_PAGES ? (restOldest ? nextIso(restOldest) : null) : restOldest,
    restNewest: newestFiling(restRows),
    restCount: restRows.length,
    restReading,
  };
  patch({ insiders: { status: 'live', trades: read.trades } });
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
    void rest.finally(() => {
      restReading = false;
      paintInsiders();
    });
    await Promise.all([rest, extend(buys), extend(bigSales)]);
  } catch {
    restReading = false;
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

/* ONE PERSON'S OWN FILINGS (the data audit, 2026-10-22). The person page said "every filing in the last 90 days, the
   grants included" over the market-wide feed — the latest thousand filings, so most of a person's year was missing.
   It now reads that person's own filings: /insider/transactions by the reporting owner's SEC CIK when the feed gave
   one (the stable id across companies and spellings), else by the owner's name, over the last year. */
const PERSON_DAYS = 365;
interface PersonBox {
  status: FeedStatus;
  trades: InsiderTrade[];
  /** How the filings were found: by the SEC id, or by the name (which can join two people who share it) */
  by: 'cik' | 'name';
  /** Distinct SEC ids among the rows — more than one when a name is shared */
  filers: number;
  /** True when the read hit the vendor's 500-row cap, so older filings in the year may be missing */
  capped: boolean;
}
const PERSON_WAIT: PersonBox = { status: 'loading', trades: [], by: 'name', filers: 0, capped: false };
const persons = new Map<string, PersonBox>();

function ensurePerson(slug: string, cik: string | undefined, name: string | undefined) {
  const key = cik ? `cik:${cik}` : `name:${slug}`;
  if (persons.has(key) || typeof window === 'undefined') return key;
  persons.set(key, { ...PERSON_WAIT, by: cik ? 'cik' : 'name' });
  void (async () => {
    const owner = name || slug.replace(/-/g, ' ');
    const since = nyIsoDaysBack(PERSON_DAYS);
    const path = cik
      ? `/insider/transactions?reporter_cik=${encodeURIComponent(cik)}&start_date=${since}&limit=500`
      : `/insider/transactions?owner_name=${encodeURIComponent(owner)}&start_date=${since}&limit=500`;
    const res = await uwCall(path, true);
    const rows = Array.isArray(res.data) ? (res.data as (UwInsider & { reporter_cik?: string })[]) : [];
    /* by name, keep only the rows whose name reads the same as the slug (the vendor's match is a substring) */
    const own = cik ? rows : rows.filter(r => personSlug(r.owner_name || '') === slug);
    const trades = insidersFromWhales(own).filter(t => t.daysAgo <= PERSON_DAYS);
    persons.set(key, {
      status: res.error ? 'sim' : 'live',
      trades,
      by: cik ? 'cik' : 'name',
      filers: new Set(own.map(r => r.reporter_cik).filter(Boolean)).size,
      capped: rows.length >= 500,
    });
    listeners.forEach(fn => fn());
  })();
  return key;
}

export interface InsiderPersonBook {
  person: string;
  role: InsiderTrade['role'];
  ticker: string;
  trades: InsiderTrade[];
  by: 'cik' | 'name';
  filers: number;
  capped: boolean;
  windowDays: number;
}

/** undefined while the person's filings are being read; null when none is on file in the year. */
export function useInsiderBook(slug: string): InsiderPersonBook | null | undefined {
  const insiders = useInsidersSnap();
  /* the market feed names the person and their SEC id; the page then reads their own filings */
  const seen = useMemo(() => (insiders.status === 'live' ? insiders.trades.find(t => personSlug(t.person) === slug) ?? null : null), [insiders, slug]);
  const feedSettled = insiders.status !== 'loading';
  const key = feedSettled ? (seen?.cik ? `cik:${seen.cik}` : `name:${slug}`) : null;
  const box = useSyncExternalStore(
    fn => {
      const off = listen(fn);
      if (feedSettled) ensurePerson(slug, seen?.cik, seen?.person);
      return off;
    },
    () => (key ? persons.get(key) ?? PERSON_WAIT : PERSON_WAIT),
    () => PERSON_WAIT,
  );
  return useMemo(() => {
    if (!feedSettled || box.status === 'loading') return undefined;
    const trades = box.status === 'live' && box.trades.length ? box.trades : seen ? insiders.trades.filter(t => personSlug(t.person) === slug) : [];
    if (trades.length === 0) return null;
    const newest = [...trades].sort((a, b) => a.daysAgo - b.daysAgo)[0];
    return {
      person: newest.person,
      role: newest.role,
      ticker: newest.ticker,
      trades,
      by: box.by,
      filers: box.filers,
      capped: box.capped,
      windowDays: box.status === 'live' && box.trades.length ? PERSON_DAYS : -1,
    };
  }, [feedSettled, box, seen, insiders, slug]);
}

export const insiderCodes = { market: OPEN_MARKET_CODES, all: ALL_CODES };

/* ONE NAME'S CONGRESS REPORTS (the data audit, 2026-10-22). The stock page said "STOCK Act reports naming this stock in
   the last 180 days" over the market-wide book, which then reached back six weeks. It now asks for the name's own
   reports (/congress/recent-trades?ticker=), which reach back years, and keeps the trades of the window. */
interface TickerCongress {
  status: FeedStatus;
  trades: CongressTrade[];
  /** False when the 200-report read ended inside the window, so older reports in it may be missing */
  complete: boolean;
}
const TICKER_CONGRESS_WAIT: TickerCongress = { status: 'loading', trades: [], complete: false };
const tickerCongress = new Map<string, TickerCongress>();

/* THE ROSTER FOR A NAME'S PAGE TOO (the third audit, 2026-10-23): party and state come off the politician list, which
   only the Congress page read — the earnings and stock pages' Congress rows had neither. Any page that reads a name's
   reports reads the roster once, and the rows are re-mapped when it lands. */
const tickerCongressRows = new Map<string, UwCongress[]>();
let rosterAsked = false;
function ensureRoster(): void {
  if (rosterAsked || congressPeople.length || typeof window === 'undefined') return;
  rosterAsked = true;
  void whalesPoliticians()
    .then(p => {
      if (!Array.isArray(p) || !p.length) return;
      congressPeople = p;
      for (const [sym, rows] of tickerCongressRows) {
        const box = tickerCongress.get(sym);
        if (box?.status === 'live') tickerCongress.set(sym, { ...box, trades: congressFromWhales(rows, congressPeople).trades.filter(t => t.ticker.toUpperCase() === sym) });
      }
      if (snap.congress.status === 'live') paintCongress();
      listeners.forEach(fn => fn());
    })
    .catch(() => {
      rosterAsked = false;
    });
}

function ensureTickerCongress(sym: string) {
  if (tickerCongress.has(sym) || typeof window === 'undefined') return;
  tickerCongress.set(sym, TICKER_CONGRESS_WAIT);
  ensureRoster();
  void (async () => {
    const res = await uwCall(`/congress/recent-trades?ticker=${encodeURIComponent(sym)}&limit=200`);
    const rows = Array.isArray(res.data) ? (res.data as UwCongress[]) : [];
    tickerCongressRows.set(sym, rows);
    const oldest = rows.map(r => (r.transaction_date || '').slice(0, 10)).filter(Boolean).sort()[0] ?? null;
    tickerCongress.set(sym, res.error
      ? { status: 'sim', trades: [], complete: false }
      : { status: 'live', trades: congressFromWhales(rows, congressPeople).trades.filter(t => t.ticker.toUpperCase() === sym), complete: rows.length < 200 || (!!oldest && oldest <= nyIsoDaysBack(365)) });
    listeners.forEach(fn => fn());
  })();
}

export function useTickerCongress(ticker: string, windowDays: number): TickerCongress {
  const sym = ticker.toUpperCase();
  const box = useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureTickerCongress(sym);
      return off;
    },
    () => tickerCongress.get(sym) ?? TICKER_CONGRESS_WAIT,
    () => TICKER_CONGRESS_WAIT,
  );
  return useMemo(() => {
    if (box.status !== 'live') return box;
    const trades = box.trades.filter(t => t.tradedDaysAgo <= windowDays);
    const oldestIn = box.trades.reduce((m, t) => Math.max(m, t.tradedDaysAgo), 0);
    return { status: box.status, trades, complete: box.complete || oldestIn >= windowDays };
  }, [box, windowDays]);
}

/* ONE MEMBER'S YEAR (the data audit, 2026-10-22). The member page said "37 reports in the last year" over the latest 40
   reports by name (three weeks for an active trader, nine years for a quiet one). It now asks for the trades made in
   the last year (/congress/congress-trader?date_from=) and pages (1-indexed, 200 a page) until the year is read. */
export const MEMBER_DAYS = 365;
const MEMBER_LIMIT = 200;
const MEMBER_PAGE_CAP = 6;
interface MemberBook {
  status: FeedStatus;
  trades: CongressTrade[];
  /** False when the page cap stopped the read inside the year */
  complete: boolean;
  unreadTypes: number;
}
const MEMBER_WAIT: MemberBook = { status: 'loading', trades: [], complete: false, unreadTypes: 0 };
const members = new Map<string, MemberBook>();

/** The first page's address — the vendor desk asks the same, so the two share one call */
export const memberReportsPath = (name: string, page = 1) =>
  `/congress/congress-trader?name=${encodeURIComponent(name)}&date_from=${nyIsoDaysBack(MEMBER_DAYS)}&limit=${MEMBER_LIMIT}${page > 1 ? `&page=${page}` : ''}`;

function ensureMember(id: string, name: string) {
  const key = `${id}|${name}`;
  if (members.has(key) || typeof window === 'undefined') return;
  members.set(key, MEMBER_WAIT);
  void (async () => {
    const rows: UwCongress[] = [];
    let complete = false;
    let failed = false;
    for (let page = 1; page <= MEMBER_PAGE_CAP; page++) {
      const res = await uwCall(memberReportsPath(name, page), page === 1);
      if (res.error || !Array.isArray(res.data)) {
        failed = page === 1;
        break;
      }
      const got = res.data as UwCongress[];
      rows.push(...got);
      if (got.length < MEMBER_LIMIT) {
        complete = true;
        break;
      }
    }
    const feed = congressFromWhales(rows, congressPeople);
    members.set(key, failed ? { status: 'sim', trades: [], complete: false, unreadTypes: 0 } : { status: 'live', trades: feed.trades.filter(t => t.tradedDaysAgo <= MEMBER_DAYS), complete, unreadTypes: feed.unreadTypes ?? 0 });
    listeners.forEach(fn => fn());
  })();
}

export function useMemberBook(id: string, name: string | null): MemberBook {
  const key = name ? `${id}|${name}` : '';
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      if (name) ensureMember(id, name);
      return off;
    },
    () => (key ? members.get(key) ?? MEMBER_WAIT : MEMBER_WAIT),
    () => MEMBER_WAIT,
  );
}

/** The roster's entry for a member id, once the politician list has landed */
export function memberFromRoster(id: string): UwPolitician | null {
  return congressPeople.find(p => p.politician_id === id) ?? null;
}
