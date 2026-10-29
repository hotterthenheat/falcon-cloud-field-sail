/* The live record through this app's server (/api/uw), which holds the token; a feed that has not
   answered, or failed, stays empty. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BoundedMap, createStore, keepFresh, keptRead, type Cadence } from './feedStore';
import { EMPTY_CONGRESS, summariseCongress } from './congress';
import { personSlug, summariseFlow } from './insiders';
import { geoFromItems, type EconEvent, type GeoNewsEvent } from './newsroom';
import type { CongressFeed, CongressTrade, InsiderFlow, InsiderTrade, TxCode } from '../types/record';
import { whalesEcon, whalesPoliticians, uwCall, type UwCongress, type UwEcon, type UwInsider, type UwNews, type UwPolitician } from './whales';
import { nyIsoDaysBack } from './nyDate';
import { isTradingDay } from '../core/calendar';
import { peekRegularCloses } from './dayChange';
import { loadCloses } from './stockFile';
import { congressFromWhales, econFromWhales, foreignSuspects, insidersFromWhales, markForeignIssuers, newsFromWhales, readInsiders, storyLeadTicker } from './whalesMap';

type FeedStatus = 'loading' | 'live' | 'sim';

/* `keptAt`: the book on screen is the answers this browser kept at that instant, until the fresh read lands */
interface LiveSnapshot {
  news: { status: FeedStatus; events: GeoNewsEvent[]; keptAt?: number | null };
  econ: { status: FeedStatus; events: EconEvent[]; keptAt?: number | null };
  congress: { status: FeedStatus; trades: CongressTrade[]; notMemberAges?: number[]; keptAt?: number | null };
  insiders: { status: FeedStatus; trades: InsiderTrade[]; keptAt?: number | null };
}

const initial: LiveSnapshot = {
  news: { status: 'loading', events: [] },
  econ: { status: 'loading', events: [] },
  congress: { status: 'loading', trades: [] },
  insiders: { status: 'loading', trades: [] },
};

const store = createStore<LiveSnapshot>(initial);
let snap: LiveSnapshot = initial;
const patch = (part: Partial<LiveSnapshot>) => {
  snap = { ...snap, ...part };
  store.set(snap);
};
const notify = () => store.notify();

/* The whole day's wire: the first read pages back (100 a page) past New York's midnight, at most NEWS_PAGE_CAP pages;
   after that only the newest page is merged in. The page says from what time the stories are complete. */
const NEWS_LIMIT = 100;
const NEWS_PAGE_CAP = 16;
let newsRows: UwNews[] = [];
let newsBackfilled = false;
let newsPulling = false;
interface NewsCoverage {
  /** The earliest story read, epoch ms, or null before the first answer */
  fromMs: number | null;
  /** True once the read reached back past the wire day's New York midnight */
  wholeDay: boolean;
  reading: boolean;
  /** The wire's day: New York's today once a story has crossed on a trading day; else the last session's day, with the
      newer stories since it counted in `since`. */
  day: string;
  /** True when `day` is New York's today */
  today: boolean;
  /** Stories after the wire day's own midnight-to-midnight (the weekend's, the holiday's) */
  since: number;
}
const newsKey = (r: UwNews) => `${r.created_at}|${r.headline}`;
/** New York's midnight starting a calendar day as an instant: 04:00 UTC in daylight time, 05:00 in standard time */
const nyMidnightOf = (day: string): number => {
  const at4 = Date.parse(`${day}T04:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at4)));
  return hour === 0 ? at4 : Date.parse(`${day}T05:00:00Z`);
};
const isTradingIso = (iso: string): boolean => {
  const [y, m, d] = iso.split('-').map(Number);
  return isTradingDay(new Date(y, m - 1, d));
};
/** The trading day before `iso` on the exchange calendar */
const sessionBefore = (iso: string): string => {
  let day = iso;
  for (let i = 0; i < 10; i++) {
    day = nyIsoDaysBack(1, day);
    if (isTradingIso(day)) return day;
  }
  return day;
};
/** The wire's day (NewsCoverage.day): today on a trading day once a story of today's has been read, else the last
    session before today. Before the first page answers, a trading day is taken to be today's */
function wireDay(rows: UwNews[]): string {
  const today = nyIsoDaysBack(0);
  if (isTradingIso(today)) {
    const midnight = nyMidnightOf(today);
    if (rows.length === 0 || rows.some(r => !(Date.parse(r.created_at) < midnight))) return today;
  }
  return sessionBefore(today);
}
const nyMidnightMs = (): number => nyMidnightOf(wireDay(newsRows));
let newsCoverage: NewsCoverage = { fromMs: null, wholeDay: false, reading: true, day: nyIsoDaysBack(0), today: true, since: 0 };

/* the kept pages paint the wire until the first fresh page lands */
let keptNews: { rows: UwNews[]; at: number } | null = null;
function paintNews() {
  const kept = !newsRows.length && keptNews ? keptNews : null;
  const seen = new Set<string>();
  const rows = (kept ? kept.rows : newsRows).filter(r => {
    const k = newsKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!kept) newsRows = rows;
  /* the wire on the page is the wire day's stories (and, on a weekend or holiday, the newer ones since) only */
  const day = wireDay(rows);
  const midnight = nyMidnightOf(day);
  const dayEnd = nyMidnightOf(nyIsoDaysBack(-1, day));
  const todays = rows.filter(r => !(Date.parse(r.created_at) < midnight));
  const since = todays.filter(r => !(Date.parse(r.created_at) < dayEnd)).length;
  const times = rows.map(r => Date.parse(r.created_at)).filter(Number.isFinite);
  const from = times.length ? Math.min(...times) : null;
  const sameDay = newsCoverage.day === day;
  newsCoverage = {
    ...newsCoverage,
    day,
    today: day === nyIsoDaysBack(0),
    since,
    fromMs: from == null ? null : Math.max(from, midnight),
    wholeDay: (sameDay && newsCoverage.wholeDay) || (from != null && from <= midnight),
  };
  const items = newsFromWhales(todays, priorClose);
  patch({ news: { status: 'live', events: geoFromItems(items), keptAt: kept ? kept.at : null } });
  if (!kept) wantCloses(todays);
}

async function paintKeptNews(): Promise<void> {
  const k = keptRead();
  const rows: UwNews[] = [];
  for (let page = 0; page < NEWS_PAGE_CAP; page++) {
    const res = await k.get(`/news/headlines?limit=${NEWS_LIMIT}&page=${page}`);
    if (res.error || !Array.isArray(res.data)) break;
    rows.push(...(res.data as UwNews[]));
    if ((res.data as UwNews[]).length < NEWS_LIMIT) break;
  }
  if (!rows.length || newsRows.length || k.at == null) return;
  keptNews = { rows, at: k.at };
  paintNews();
}

/* the regular closes for the names whose stories crossed outside the session, read once a day; the wire repaints as they land */
const priorClose = (ticker: string, before: string): number | null => {
  const closes = peekRegularCloses(ticker);
  return closes?.find(c => c.date < before)?.close ?? null;
};
const closesAsked = new Set<string>();
let closesRepaint: number | null = null;
function wantCloses(rows: UwNews[]): void {
  const need = new Set<string>();
  for (const r of rows) {
    /* the close is read for a story's lead ticker alone, never a currency code or a plain word */
    const t = storyLeadTicker(r.headline || '', r.tickers);
    if (!t) continue;
    const m = (r.meta ?? {})[t];
    const mt = String((m as { curr?: { mt?: string } } | undefined)?.curr?.mt ?? '').toLowerCase();
    /* after-hours and pre-market stories both need the close before their last session (publishMove's `last`) */
    if ((mt.startsWith('post') || mt.startsWith('pre')) && !closesAsked.has(t) && !peekRegularCloses(t)) need.add(t);
  }
  for (const t of need) {
    closesAsked.add(t);
    void loadCloses(t)
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
      if (!newsRows.length) void paintKeptNews();
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
        /* the wire day is re-read with each page: a trading day's first page with no story of its own yet is the last
           session's wire, read back to that session's midnight */
        if (rows.length < NEWS_LIMIT || !(oldest > nyMidnightMs())) break;
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
    notify();
  }
}

export function useNewsCoverage(): NewsCoverage {
  useNewsFeed();
  return newsCoverage;
}

async function pullEcon() {
  if (snap.econ.status === 'loading') {
    const k = keptRead();
    void k.get('/market/economic-calendar').then(res => {
      if (snap.econ.status === 'loading' && Array.isArray(res.data) && k.at != null) patch({ econ: { status: 'live', events: econFromWhales(res.data as UwEcon[]), keptAt: k.at } });
    });
  }
  try {
    const rows = await whalesEcon();
    if (!Array.isArray(rows)) throw new Error('shape');
    patch({ econ: { status: 'live', events: econFromWhales(rows), keptAt: null } });
  } catch {
    if (snap.econ.status !== 'live') patch({ econ: { status: 'sim', events: [] } });
  }
}

/* /congress/recent-trades answers at most 200 reports a call, newest trade first, and ignores `page`; its `date` is the
   paging door, so each read asks from the oldest trade day reached. A day of 200+ reports is stepped past and flagged. */
const CONGRESS_LIMIT = 200;
/** enough calls to reach 180 days on the busiest stretch measured, with room */
const CONGRESS_CALL_CAP = 40;
let congressRows: UwCongress[] = [];
let congressPeople: UwPolitician[] = [];
let congressWant = 90;
let congressPulling: Promise<void> | null = null;
/** The oldest trade day whose reports are complete, the days a read could not finish, and whether it is still reading */
export interface CongressCoverage {
  since: string | null;
  partialDays: string[];
  /** Of each partial day's first 200 filings, how many were members' */
  partialMembers: Record<string, number>;
  reading: boolean;
  capped: boolean;
}
let congressCoverage: CongressCoverage = { since: null, partialDays: [], partialMembers: {}, reading: true, capped: false };
let congressCursor: string | null = null;
let congressCalls = 0;
let congressDone = false;

/* Each read marks its rows: two identical rows in one answer are two lots; the same row in two answers is paging overlap. */
let congressPageNo = 0;
const markPage = (rows: UwCongress[]): UwCongress[] => {
  const n = ++congressPageNo;
  for (const r of rows) Object.defineProperty(r, '__page', { value: n, enumerable: false, configurable: true });
  return rows;
};
const paintCongress = () => {
  const feed = congressFromWhales(congressRows, congressPeople);
  patch({ congress: { status: 'live', trades: feed.trades, notMemberAges: feed.notMemberAges, keptAt: null } });
};
/* the kept first page and roster paint the book until the fresh read lands */
function paintKeptCongress(): void {
  const k = keptRead();
  void Promise.all([k.get(`/congress/recent-trades?limit=${CONGRESS_LIMIT}`), k.get('/congress/politicians?last_traded_within_months=24')]).then(([rows, people]) => {
    if (congressRows.length || !Array.isArray(rows.data) || k.at == null) return;
    const feed = congressFromWhales(rows.data as UwCongress[], Array.isArray(people.data) ? (people.data as UwPolitician[]) : congressPeople);
    patch({ congress: { status: 'live', trades: feed.trades, notMemberAges: feed.notMemberAges, keptAt: k.at } });
  });
}

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
    congressRows = congressRows.concat(markPage(rows));
    const days = rows.map(r => (r.transaction_date || '').slice(0, 10)).filter(Boolean).sort();
    const oldest = days[0];
    const full = rows.length >= CONGRESS_LIMIT;
    if (!full) {
      congressDone = true;
      congressCoverage = { ...congressCoverage, since: oldest ?? congressCoverage.since };
    } else if (oldest && oldest === congressCursor) {
      /* A day with more than 200 reports cannot be read past (no offset, no member filter): it is stepped past and named, with
         how many of its first 200 were members'. */
      const members = rows.filter(r => !r.member_type || /house|senate/i.test(r.member_type)).length;
      congressCoverage = { ...congressCoverage, partialDays: [...congressCoverage.partialDays, oldest], partialMembers: { ...congressCoverage.partialMembers, [oldest]: members }, since: oldest };
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
        if (congressRows.length) paintCongress();
        else notify();
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
      congressRows = markPage(res.data as UwCongress[]).concat(congressRows);
      paintCongress();
    }
    return;
  }
  paintKeptCongress();
  const people = whalesPoliticians()
    .then(p => {
      if (Array.isArray(p) && p.length) {
        congressPeople = p;
        if (congressRows.length) paintCongress();
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

/* /insider/transactions answers at most 500 filings a call, so three reads: P purchases and $1M+ S sales paged over the
   window (capped at PAGE_CAP), and the latest REST_PAGES × 500 of everything else; common_stock_only keeps out notes. */
const INS_LIMIT = 500;
/* 180 days of $1M+ sales measured at about thirteen pages */
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

/* An issuer with a market-priced row 2.5× off its listing is looked up once (/stock/{T}/info): an ADR's rows are in the
   home currency; the books repaint when one turns out to be foreign. */
const issuerProbe = new Map<string, Promise<boolean>>();
const DEPOSITARY_ISSUE = /\bADR\b|\bADS\b|depositary/i;
function probeIssuers(rows: UwInsider[]): Promise<boolean> {
  const want = foreignSuspects(rows as Parameters<typeof foreignSuspects>[0]).filter(t => !issuerProbe.has(t));
  for (const t of want)
    issuerProbe.set(
      t,
      uwCall(`/stock/${encodeURIComponent(t)}/info`, false, true).then(res => {
        const issue = String((res.data as { issue_type?: unknown } | null)?.issue_type ?? '');
        const foreign = DEPOSITARY_ISSUE.test(issue);
        if (foreign) markForeignIssuers([t]);
        return foreign;
      }),
    );
  return Promise.all(want.map(t => issuerProbe.get(t)!)).then(found => found.some(Boolean));
}

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
  insiderLive = true;
  void probeIssuers(merged).then(found => {
    if (found) paintInsiders();
  });
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
  patch({ insiders: { status: 'live', trades: read.trades, keptAt: null } });
}
/* the kept first pages paint the book until a fresh page lands */
let insiderLive = false;
function paintKeptInsiders(): void {
  const k = keptRead();
  void Promise.all([k.get(`${BUYS_PATH}&page=0`), k.get(`${SALES_PATH}&page=0`), k.get(`${REST_PATH}&page=0`)]).then(pages => {
    const rows = pages.flatMap(p => (Array.isArray(p.data) ? (p.data as UwInsider[]) : []));
    if (insiderLive || !rows.length || k.at == null) return;
    const seen = new Set<string>();
    const merged = rows.filter(r => {
      const key = String(r.id ?? `${r.ticker}-${r.owner_name}-${r.transaction_date}-${r.transaction_code}-${r.amount}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    patch({ insiders: { status: 'live', trades: readInsiders(merged).trades, keptAt: k.at } });
  });
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
  if (!insiderLive) paintKeptInsiders();
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
    if (!insiderLive) patch({ insiders: { status: 'sim', trades: [] } });
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

/* Each book is read again while a page shows it and the tab is in front: the wire every minute in the session, the
   filings every five; less often around the session, and the wire only when the market is shut. */
const NEWS_EVERY: Cadence = { open: 60_000, extended: 120_000, closed: 600_000 };
const BOOK_EVERY: Cadence = { open: 5 * 60_000, extended: 15 * 60_000, closed: null };
const shown = () => store.readers() > 0;
const ensureNews = () => keepFresh('record:news', NEWS_EVERY, pullNews, shown);
const ensureEcon = () => keepFresh('record:econ', BOOK_EVERY, pullEcon, shown);
const ensureCongress = () => keepFresh('record:congress', BOOK_EVERY, pullCongress, shown);
const ensureInsiders = () => keepFresh('record:insiders', BOOK_EVERY, pullInsiders, shown);

function ensure() {
  ensureNews();
  ensureEcon();
  ensureCongress();
  ensureInsiders();
}

const listen = (fn: () => void) => store.subscribe(fn);

export const peekLive = (): LiveSnapshot => snap;

/** The instant of the kept answers a book shows until its fresh read lands, else null — never starts a read */
export function useKeptAt(part: keyof LiveSnapshot): number | null {
  return useSyncExternalStore(listen, () => snap[part].keptAt ?? null, () => null);
}

function subscribeLive(fn: () => void): () => void {
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

export function useEconCalendar(): EconEvent[] {
  const econ = useEconFeed();
  return useMemo(() => (econ.status === 'live' ? econ.events : []), [econ]);
}

/** The congress book as read; starts the congress read alone, not every feed */
export function useCongressBook(): LiveSnapshot['congress'] {
  return useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureCongress();
      return off;
    },
    () => snap.congress,
    () => snap.congress,
  );
}

/** The reports in a window, by the trade's date or (basis 'filed') by the day the report was filed */
export function useCongressFeed(windowDays: number, basis: 'traded' | 'filed' = 'traded'): CongressFeed {
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
    /* the executive-branch filings left out, counted for the window */
    const notMembers = (congress.notMemberAges ?? []).filter(d => d <= windowDays).length;
    return { ...summariseCongress(congress.trades.filter(t => (basis === 'filed' ? t.filedDaysAgo : t.tradedDaysAgo) <= windowDays), windowDays), notMembers };
  }, [congress, windowDays, basis]);
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

const TICKER_WAIT: { status: FeedStatus; trades: InsiderTrade[]; keptAt?: number | null } = { status: 'loading', trades: [] };
const tickerIns = new BoundedMap<string, { status: FeedStatus; trades: InsiderTrade[]; keptAt?: number | null }>(40);

/** Paint a name's book off the kept answer for its path while it is still loading */
function keptFirst<V extends { status: FeedStatus }>(path: string, books: BoundedMap<string, V>, key: string, make: (data: unknown, at: number) => V | null): void {
  const k = keptRead();
  void k.get(path).then(res => {
    if (res.error || k.at == null || books.peek(key)?.status !== 'loading') return;
    const v = make(res.data, k.at);
    if (!v) return;
    books.set(key, v);
    notify();
  });
}

function ensureTickerInsiders(sym: string) {
  if (tickerIns.has(sym) || typeof window === 'undefined') return;
  tickerIns.set(sym, { status: 'loading', trades: [] });
  const path = `/insider/transactions?ticker_symbol=${encodeURIComponent(sym)}`;
  keptFirst(path, tickerIns, sym, (data, at) => (Array.isArray(data) ? { status: 'live', trades: insidersFromWhales(data as UwInsider[]), keptAt: at } : null));
  void (async () => {
    const res = await uwCall(path);
    const rows = Array.isArray(res.data) ? (res.data as UwInsider[]) : [];
    await probeIssuers(rows);
    const had = tickerIns.peek(sym);
    tickerIns.set(sym, res.error ? (had?.keptAt ? had : { status: 'sim', trades: [] }) : { status: 'live', trades: insidersFromWhales(rows), keptAt: null });
    notify();
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
    return { ...summariseFlow(sym, trades, windowDays), status: box.status };
  }, [box, sym, windowDays]);
}

/* One person's own filings over the last year, by the owner's SEC CIK when known (stable across companies), else by name. */
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
  keptAt?: number | null;
}
const PERSON_WAIT: PersonBox = { status: 'loading', trades: [], by: 'name', filers: 0, capped: false };
const persons = new BoundedMap<string, PersonBox>(30);

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
    keptFirst(path, persons, key, (data, at): PersonBox | null => {
      if (!Array.isArray(data)) return null;
      const rows0 = cik ? (data as UwInsider[]) : (data as UwInsider[]).filter(r => personSlug(r.owner_name || '') === slug);
      return rows0.length ? { status: 'live', trades: insidersFromWhales(rows0).filter(t => t.daysAgo <= PERSON_DAYS), by: cik ? 'cik' : 'name', filers: 1, capped: data.length >= 500, keptAt: at } : null;
    });
    let res = await uwCall(path, true);
    let rows = Array.isArray(res.data) ? (res.data as (UwInsider & { reporter_cik?: string })[]) : [];
    /* by name, keep only the rows whose name reads the same as the slug (the vendor's match is a substring) */
    let own = cik ? rows : rows.filter(r => personSlug(r.owner_name || '') === slug);
    /* the name's rows carry the SEC id; the person is read by it */
    const ids = cik ? [] : [...new Set(own.map(r => (r.reporter_cik || '').trim()).filter(Boolean))];
    if (ids.length === 1) {
      const byId = await uwCall(`/insider/transactions?reporter_cik=${encodeURIComponent(ids[0])}&start_date=${since}&limit=500`, true);
      if (!byId.error && Array.isArray(byId.data) && byId.data.length) {
        res = byId;
        rows = byId.data as (UwInsider & { reporter_cik?: string })[];
        own = rows;
        const box = persons.peek(key);
        if (box) box.by = 'cik';
      }
    }
    await probeIssuers(own);
    const trades = insidersFromWhales(own).filter(t => t.daysAgo <= PERSON_DAYS);
    const had = persons.peek(key);
    if (res.error && had?.keptAt) return;
    persons.set(key, {
      status: res.error ? 'sim' : 'live',
      trades,
      by: cik || had?.by === 'cik' ? 'cik' : 'name',
      filers: new Set(own.map(r => r.reporter_cik).filter(Boolean)).size,
      capped: rows.length >= 500,
      keptAt: null,
    });
    notify();
  })();
  return key;
}

interface InsiderPersonBook {
  person: string;
  role: InsiderTrade['role'];
  ticker: string;
  trades: InsiderTrade[];
  by: 'cik' | 'name';
  filers: number;
  capped: boolean;
  windowDays: number;
  keptAt: number | null;
}

/** undefined while the person's filings are being read; null when none is on file in the year. */
export function useInsiderBook(slug: string): InsiderPersonBook | null | undefined {
  /* the market feed, when already read, names the person and their SEC id; the page does not start it */
  const insiders = useSyncExternalStore(listen, () => snap.insiders, () => snap.insiders);
  const seen = useMemo(() => (insiders.status === 'live' ? insiders.trades.find(t => personSlug(t.person) === slug) ?? null : null), [insiders, slug]);
  const key = seen?.cik ? `cik:${seen.cik}` : `name:${slug}`;
  const box = useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensurePerson(slug, seen?.cik, seen?.person);
      return off;
    },
    () => persons.get(key) ?? PERSON_WAIT,
    () => PERSON_WAIT,
  );
  return useMemo(() => {
    if (box.status === 'loading') return undefined;
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
      keptAt: box.keptAt ?? null,
    };
  }, [box, seen, insiders, slug]);
}

/* One name's own Congress reports (/congress/recent-trades?ticker=), which reach back years; the window's are kept. */
interface TickerCongress {
  status: FeedStatus;
  trades: CongressTrade[];
  /** False when the 200-report read ended inside the window, so older reports in it may be missing */
  complete: boolean;
}
const TICKER_CONGRESS_WAIT: TickerCongress = { status: 'loading', trades: [], complete: false };
const tickerCongress = new BoundedMap<string, TickerCongress>(40);

/* any page that reads a name's reports reads the roster once (party, state), and the rows re-map when it lands */
const tickerCongressRows = new BoundedMap<string, UwCongress[]>(40);
let rosterAsked = false;
function ensureRoster(): void {
  if (rosterAsked || congressPeople.length || typeof window === 'undefined') return;
  rosterAsked = true;
  void whalesPoliticians()
    .then(p => {
      if (!Array.isArray(p) || !p.length) return;
      congressPeople = p;
      for (const [sym, rows] of tickerCongressRows.entries()) {
        const box = tickerCongress.get(sym);
        if (box?.status === 'live') tickerCongress.set(sym, { ...box, trades: congressFromWhales(rows, congressPeople).trades.filter(t => t.ticker.toUpperCase() === sym) });
      }
      if (snap.congress.status === 'live') paintCongress();
      notify();
    })
    .catch(() => {
      rosterAsked = false;
    });
}

function ensureTickerCongress(sym: string) {
  if (tickerCongress.has(sym) || typeof window === 'undefined') return;
  tickerCongress.set(sym, TICKER_CONGRESS_WAIT);
  ensureRoster();
  const path = `/congress/recent-trades?ticker=${encodeURIComponent(sym)}&limit=200`;
  keptFirst(path, tickerCongress, sym, data => (Array.isArray(data) ? { status: 'live', trades: congressFromWhales(data as UwCongress[], congressPeople).trades.filter(t => t.ticker.toUpperCase() === sym), complete: (data as UwCongress[]).length < 200 } : null));
  void (async () => {
    const res = await uwCall(path);
    const rows = Array.isArray(res.data) ? (res.data as UwCongress[]) : [];
    tickerCongressRows.set(sym, rows);
    const oldest = rows.map(r => (r.transaction_date || '').slice(0, 10)).filter(Boolean).sort()[0] ?? null;
    tickerCongress.set(sym, res.error
      ? { status: 'sim', trades: [], complete: false }
      : { status: 'live', trades: congressFromWhales(rows, congressPeople).trades.filter(t => t.ticker.toUpperCase() === sym), complete: rows.length < 200 || (!!oldest && oldest <= nyIsoDaysBack(365)) });
    notify();
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

/* One member's year: the trades of the last year (/congress/congress-trader?date_from=), paged 200 at a time. */
const MEMBER_DAYS = 365;
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
const members = new BoundedMap<string, MemberBook>(30);

/** The first page's address — the vendor desk asks the same, so the two share one call */
const memberReportsPath = (name: string, page = 1) =>
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
    notify();
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

/* ---- one name's own headlines ----
   /news/headlines?ticker= answers the name's latest fifty, read like the wire and refreshed each minute while shown. */
interface TickerNews {
  status: FeedStatus;
  events: GeoNewsEvent[];
  keptAt?: number | null;
}
const tickerNewsState = new BoundedMap<string, TickerNews>(40);
const tickerNewsRows = new BoundedMap<string, UwNews[]>(40);
const tickerNewsAt = new Map<string, number>();
const tickerNewsListeners = new Set<() => void>();
const TICKER_NEWS_LOADING: TickerNews = { status: 'loading', events: [] };
function paintTickerNews(t: string, kept: { rows: UwNews[]; at: number } | null = null): void {
  const rows = kept ? kept.rows : tickerNewsRows.get(t) ?? [];
  const midnight = nyMidnightMs();
  const todays = rows.filter(r => !(Date.parse(r.created_at) < midnight));
  tickerNewsState.set(t, { status: 'live', events: geoFromItems(newsFromWhales(todays, priorClose)), keptAt: kept ? kept.at : null });
  tickerNewsListeners.forEach(fn => fn());
}
async function pullTickerNews(t: string): Promise<void> {
  tickerNewsAt.set(t, Date.now());
  const path = `/news/headlines?ticker=${encodeURIComponent(t)}&limit=50&page=0`;
  if (!tickerNewsRows.has(t)) {
    const k = keptRead();
    void k.get(path).then(res => {
      if (!tickerNewsRows.has(t) && Array.isArray(res.data) && k.at != null) paintTickerNews(t, { rows: res.data as UwNews[], at: k.at });
    });
  }
  const res = await uwCall(path, true);
  if (res.error || !Array.isArray(res.data)) {
    if (tickerNewsState.get(t)?.status !== 'live') {
      tickerNewsState.set(t, { status: 'sim', events: [] });
      tickerNewsListeners.forEach(fn => fn());
    }
    return;
  }
  tickerNewsRows.set(t, res.data as UwNews[]);
  paintTickerNews(t);
  const offSession = (res.data as UwNews[]).some(r => {
    const m = (r.meta ?? {})[t] as { curr?: { mt?: string } } | undefined;
    const mt = String(m?.curr?.mt ?? '').toLowerCase();
    return mt.startsWith('post') || mt.startsWith('pre');
  });
  if (offSession && !peekRegularCloses(t)) {
    await loadCloses(t).catch(() => null);
    paintTickerNews(t);
  }
}
export const peekTickerNews = (ticker: string): TickerNews => tickerNewsState.get(ticker.toUpperCase()) ?? TICKER_NEWS_LOADING;
/** A name's headlines today, as instants, for the alert bell; reads the name's wire at most once a minute */
export function newsPulse(ticker: string): readonly { atMs: number; graded: boolean }[] {
  const t = ticker.toUpperCase();
  if (t && typeof window !== 'undefined' && Date.now() - (tickerNewsAt.get(t) ?? 0) > 60_000) void pullTickerNews(t);
  const feed = peekTickerNews(t);
  return feed.status === 'live' ? feed.events.map(e => ({ atMs: e.item.atMs, graded: true })) : [];
}
/* how many readers each name's headlines have; a name is read again on the wire's cadence while one is shown */
const tickerNewsReaders = new Map<string, number>();
export function useTickerNews(ticker: string): TickerNews {
  const t = ticker.toUpperCase();
  return useSyncExternalStore(
    fn => {
      tickerNewsListeners.add(fn);
      if (t) {
        tickerNewsReaders.set(t, (tickerNewsReaders.get(t) ?? 0) + 1);
        if (!tickerNewsAt.has(t) || Date.now() - (tickerNewsAt.get(t) ?? 0) > 60_000) void pullTickerNews(t);
        keepFresh(`record:news:${t}`, NEWS_EVERY, () => Date.now() - (tickerNewsAt.get(t) ?? 0) > 30_000 && pullTickerNews(t), () => (tickerNewsReaders.get(t) ?? 0) > 0);
      }
      return () => {
        tickerNewsListeners.delete(fn);
        if (t) tickerNewsReaders.set(t, Math.max(0, (tickerNewsReaders.get(t) ?? 1) - 1));
      };
    },
    () => peekTickerNews(t),
    () => TICKER_NEWS_LOADING,
  );
}

/* ---- the roster alone ----
   The politician list (one call) names a member; the market book is read only for a member the roster does not list. */
let rosterState: { status: FeedStatus; rev: number } = { status: 'loading', rev: 0 };
let rosterStateAsked = false;
function ensureRosterState(): void {
  if (rosterStateAsked || typeof window === 'undefined') return;
  rosterStateAsked = true;
  if (congressPeople.length) {
    rosterState = { status: 'live', rev: rosterState.rev + 1 };
    return;
  }
  void whalesPoliticians()
    .then(p => {
      if (Array.isArray(p) && p.length) congressPeople = p;
      rosterState = { status: Array.isArray(p) && p.length ? 'live' : 'sim', rev: rosterState.rev + 1 };
    })
    .catch(() => {
      rosterState = { status: 'sim', rev: rosterState.rev + 1 };
    })
    .finally(() => notify());
}
/** The politician roster's state — starts that one read, never the Congress book */
export function useCongressRoster(): FeedStatus {
  useSyncExternalStore(
    fn => {
      const off = listen(fn);
      ensureRosterState();
      return off;
    },
    () => rosterState.rev,
    () => rosterState.rev,
  );
  return congressPeople.length ? 'live' : rosterState.status;
}
/** The Congress book only when `want` — the member page's fallback for a member the roster does not list */
export function useCongressFeedIf(want: boolean, windowDays: number): CongressFeed {
  const congress = useSyncExternalStore(listen, () => snap.congress, () => snap.congress);
  useEffect(() => {
    if (want) ensureCongress();
  }, [want]);
  return useMemo(() => (congress.status !== 'live' ? { ...EMPTY_CONGRESS, windowDays } : summariseCongress(congress.trades.filter(t => t.tradedDaysAgo <= windowDays), windowDays)), [congress, windowDays]);
}
/** The Congress book's state, without starting it */
export function useCongressStatusQuiet(): FeedStatus {
  return useSyncExternalStore(listen, () => snap.congress.status, () => snap.congress.status);
}
/** The Congress book's coverage, without starting it */
export function useCongressCoverageQuiet(): CongressCoverage {
  useSyncExternalStore(listen, () => snap.congress, () => snap.congress);
  return congressCoverage;
}
