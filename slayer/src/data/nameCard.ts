/* A name's card for Terrain's name search (components/ui/NameSearchSheet.tsx), in one request (server/nameCard.mjs, GET /api/name-card/<T>): its earnings
   rows, its wire, its insiders' filings and its Congress reports, composed on the server from the hub's copies.
   The card SEEDS the shared /api/uw answers (data/whales.ts seedUwAnswer) under the browser's own paths, so the hooks
   that read those tables (data/earningsFeed.ts useNextReport, data/liveRecord.ts useTickerNews / useInsiderFlow /
   useTickerCongress) mount on rows already in hand and ask for nothing.

   The budget: one card in flight (a new name aborts the last one's ask; the server keeps what lands regardless), and a
   name asked once is not asked again for CARD_AGAIN_MS — a sweep up and down the list costs one request a name. A
   table the server could not read is marked so, and its slot says so: nothing asks for it on its own. */

import { useSyncExternalStore } from 'react';
import { feedHeaders } from './feedGate';
import { seedUwAnswer, type UwNews } from './whales';

export type CardTable = 'earnings' | 'news' | 'insiders' | 'congress';
export const CARD_TABLES: readonly CardTable[] = ['earnings', 'news', 'insiders', 'congress'];
/** A name's card is asked at most once in this window */
export const CARD_AGAIN_MS = 5 * 60_000;
/** A card that did not answer is asked again no sooner than this */
export const MISSED_AGAIN_MS = 30_000;

/** The browser's own spellings (the server's cardPath is the same): the seed lands where the hooks look */
export const cardPath = (table: CardTable, t: string): string => {
  const T = encodeURIComponent(t);
  if (table === 'earnings') return `/earnings/${T}`;
  if (table === 'news') return `/news/headlines?ticker=${T}&limit=50&page=0`;
  if (table === 'insiders') return `/insider/transactions?ticker_symbol=${T}`;
  return `/congress/recent-trades?ticker=${T}&limit=200`;
};

interface Served {
  ticker: string;
  at: number;
  tables: Record<CardTable, { status: number; rows: unknown[] | null; at: number | null }>;
}

/** 'loading' until the card answers; then each table is 'ready' (seeded, its hook may mount) or 'missed' */
export type TableState = 'ready' | 'missed';
export interface CardState {
  status: 'loading' | 'live' | 'missed';
  tables: Partial<Record<CardTable, TableState>>;
  /** When the card was asked (the window above runs from here) */
  askedAt: number;
  /** The wire's rows as the card carried them — the column reads its latest headlines straight off these (any day,
      newest first), so no wire hook is mounted and nothing re-reads the wire while the column is open */
  news?: UwNews[];
}

const state = new Map<string, CardState>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
let inFlight: { sym: string; ac: AbortController } | null = null;

const set = (sym: string, next: CardState) => {
  state.set(sym, next);
  if (state.size > 300) state.delete(state.keys().next().value as string);
  notify();
};

/** Ask the server for a name's card once in CARD_AGAIN_MS; its tables are seeded when it lands */
export function askCard(raw: string): void {
  const sym = raw.trim().toUpperCase();
  if (!sym || typeof window === 'undefined' || !/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) return;
  const had = state.get(sym);
  /* a card that did not answer may be asked again after a short wait; one that did stands its five minutes */
  if (had && (had.status === 'loading' || Date.now() - had.askedAt < (had.status === 'missed' ? MISSED_AGAIN_MS : CARD_AGAIN_MS))) return;
  if (inFlight && inFlight.sym !== sym) {
    inFlight.ac.abort();
    /* an aborted name is unasked: the next rest on it asks afresh (the server has kept what it read) */
    state.delete(inFlight.sym);
    inFlight = null;
  }
  const ac = new AbortController();
  inFlight = { sym, ac };
  const askedAt = Date.now();
  set(sym, { status: 'loading', tables: {}, askedAt });
  void (async () => {
    try {
      const auth = await feedHeaders();
      if (!auth.ok) throw new Error(auth.code);
      const res = await fetch(`/api/name-card/${encodeURIComponent(sym)}`, { headers: auth.headers, signal: ac.signal });
      if (!res.ok) throw new Error(`card ${res.status}`);
      const card = (await res.json()) as Served;
      if (!card || typeof card !== 'object' || !card.tables) throw new Error('card shape');
      const tables: CardState['tables'] = {};
      let news: UwNews[] | undefined;
      for (const tb of CARD_TABLES) {
        const t = card.tables[tb];
        if (t && t.status === 200 && Array.isArray(t.rows)) {
          seedUwAnswer(cardPath(tb, sym), t.rows, t.at ?? null, CARD_AGAIN_MS);
          tables[tb] = 'ready';
          if (tb === 'news') news = t.rows as UwNews[];
        } else tables[tb] = 'missed';
      }
      set(sym, { status: 'live', tables, askedAt, news });
    } catch {
      if (ac.signal.aborted) return;
      set(sym, { status: 'missed', tables: {}, askedAt });
    } finally {
      if (inFlight?.sym === sym) inFlight = null;
    }
  })();
}

const NONE: CardState | null = null;
/** A name's card state — null until it has been asked */
export function useNameCard(ticker: string | null): CardState | null {
  const sym = ticker ? ticker.trim().toUpperCase() : '';
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (sym ? state.get(sym) ?? NONE : NONE),
    () => NONE,
  );
}
