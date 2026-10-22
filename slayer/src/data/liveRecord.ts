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
import { whalesCongress, whalesEcon, whalesInsiders, whalesNews, whalesPoliticians, uwCall, type UwInsider } from './whales';
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

async function pullInsiders() {
  try {
    const rows = await whalesInsiders();
    if (!Array.isArray(rows)) throw new Error('shape');
    patch({ insiders: { status: 'live', trades: insidersFromWhales(rows) } });
  } catch {
    if (snap.insiders.status !== 'live') patch({ insiders: { status: 'sim', trades: [] } });
  }
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
