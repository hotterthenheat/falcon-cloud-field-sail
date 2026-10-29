/* The listed names each desk may offer: every stock on the equity desks (Terrain, Dossier, Weigher), option roots on
   Pinpoint, Trace, Paper and Backtest, the 456 on Compass. Bundled lists stand; Theta refreshes them off Dossier and Pinpoint. */

import { useSyncExternalStore } from 'react';
import { thetaCall } from './theta';
import type { TickerListing } from './tickers';
import { BUNDLED_OPTIONS, BUNDLED_STOCKS } from './listedBundle';
import { COMPASS_TICKERS } from './compassUniverse';

export type NameRoom = 'equity' | 'option' | 'compass' | 'listed';

const FEATURED = [
  'SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL',
  'AMD', 'NFLX', 'AVGO', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'HOOD', 'MU', 'TSM',
  'SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP', 'DJX',
];

/** Index underlyings the stock list does not carry. Offered on an equity desk. */
const INDEXES = ['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP', 'DJX', 'OEX', 'XEO', 'MRUT'];
/** Cash indexes whose options are the chain. The weekly root is the same name, not a second ticker. */
const OPTION_INDEXES = ['SPX', 'NDX', 'RUT', 'VIX', 'XSP'];
const SAME_AS: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', NDXP: 'NDX', VIXW: 'VIX' };

const stocks: string[] = [];
const options: string[] = [];
const stockSet = new Set<string>();
const optionSet = new Set<string>();
let stockDone = false;
let optionDone = false;
let loading = false;
const listeners = new Set<() => void>();
let rev = 0;

const CACHE_KEY = 'slayer.listed.v1';

function emit(): void {
  rev += 1;
  listeners.forEach(fn => fn());
}

function rank(symbol: string): number {
  const i = FEATURED.indexOf(symbol);
  return i < 0 ? FEATURED.length : i;
}

function keep(raw: unknown, kind: 'equity' | 'option'): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s || !/[A-Z0-9]/.test(s)) return null;
  if (kind === 'option') return /^[A-Z0-9]{1,6}$/.test(s) ? s : null;
  return /^[A-Z0-9.][A-Z0-9./$-]{0,15}$/.test(s) || /^\.[A-Z0-9./$-]{1,15}$/.test(s) ? s : null;
}

function replace(kind: 'equity' | 'option', next: string[]): void {
  const into = kind === 'equity' ? stocks : options;
  const seen = kind === 'equity' ? stockSet : optionSet;
  into.length = 0;
  seen.clear();
  next.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const symbol of next) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    into.push(symbol);
  }
  if (kind === 'equity') stockDone = true;
  else optionDone = true;
}

function remember(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), stocks, options }));
  } catch {
    /* a full disk keeps the names for this visit only */
  }
}

function hydrate(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { stocks?: unknown; options?: unknown };
    const eq = Array.isArray(parsed.stocks) ? parsed.stocks.map(s => keep(s, 'equity')).filter((s): s is string => !!s) : [];
    const op = Array.isArray(parsed.options) ? parsed.options.map(s => keep(s, 'option')).filter((s): s is string => !!s) : [];
    if (eq.length > 500) replace('equity', eq);
    if (op.length > 100) replace('option', op);
    stockDone = false;
    optionDone = false;
  } catch {
    /* a bad cache is ignored; the next pull replaces it */
  }
}

hydrate();

/* The house lists are in the client. Search does not wait on the terminal, and a
   later Theta answer still replaces them. Done stays false so that refresh runs. */
function seedBundle(): void {
  if (stocks.length < 500 && BUNDLED_STOCKS.length >= 500) {
    replace('equity', [...BUNDLED_STOCKS]);
    stockDone = false;
  }
  if (options.length < 100 && BUNDLED_OPTIONS.length >= 100) {
    replace('option', [...BUNDLED_OPTIONS]);
    optionDone = false;
  }
}
seedBundle();

async function pull(kind: 'equity' | 'option'): Promise<void> {
  const path = kind === 'equity' ? '/stock/list/symbols?format=json' : '/option/list/symbols?format=json';
  const got = await thetaCall(path);
  if (got.error || !Array.isArray(got.data)) return;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const row of got.data) {
    const symbol = keep(row && typeof row === 'object' ? (row as { symbol?: unknown }).symbol ?? (row as { root?: unknown }).root : row, kind);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    next.push(symbol);
  }
  const floor = kind === 'equity' ? 500 : 100;
  if (next.length < floor) return;
  replace(kind, next);
  if (kind === 'equity') stockDone = true;
  else optionDone = true;
  remember();
  emit();
}

/* Dossier and Pinpoint read Unusual Whales only (docs/DATA_SOURCES.md): there the bundled lists stand. */
const unusualWhalesOnly = (path = typeof location !== 'undefined' ? location.pathname : ''): boolean => path.startsWith('/dossier') || path.startsWith('/pinpoint');

/** Ask Theta once for both lists. Safe to call from every picker. A cached copy shows immediately. */
export function ensureListed(): void {
  if (loading || (stockDone && optionDone) || unusualWhalesOnly()) return;
  loading = true;
  void (async () => {
    try {
      await Promise.all([stockDone ? null : pull('equity'), optionDone ? null : pull('option')]);
    } finally {
      loading = false;
      if (!(stockDone && optionDone) && (stocks.length || options.length)) emit();
    }
  })();
}

export function roomOf(path = typeof location !== 'undefined' ? location.pathname : ''): NameRoom {
  if (path.startsWith('/pulse')) return 'listed';
  if (path.startsWith('/compass')) return 'compass';
  /* Trade's other desk is the Weigher: every listed name, not the option book. Compass stays the 456. */
  if (path.startsWith('/terrain') || path.startsWith('/dossier') || path.startsWith('/weigher')) return 'equity';
  if (
    path.startsWith('/pinpoint')
    || path.startsWith('/trace')
    || path.startsWith('/practice/paper')
    || path.startsWith('/practice/backtest')
  ) return 'option';
  return 'listed';
}

/** Compass only. Both SPX and SPXW stay. The cash-index fold does not apply here. */
export function searchCompass(query: string, limit: number, nameOf: (symbol: string) => string): TickerListing[] {
  const q = query.trim().toUpperCase();
  const row = (symbol: string): TickerListing => ({ symbol, name: nameOf(symbol) });
  if (!q) return COMPASS_TICKERS.slice(0, limit).map(row);
  const exact: string[] = [];
  const prefix: string[] = [];
  const contains: string[] = [];
  const named: string[] = [];
  for (const symbol of COMPASS_TICKERS) {
    if (symbol === q) exact.push(symbol);
    else if (symbol.startsWith(q)) prefix.push(symbol);
    else if (symbol.includes(q)) contains.push(symbol);
    else {
      const name = nameOf(symbol).toUpperCase();
      if (name !== symbol && name.includes(q)) named.push(symbol);
    }
  }
  return [...exact, ...prefix, ...contains, ...named].slice(0, limit).map(row);
}

/** Equity, option, or the Compass 456. The bundled Pulse list is not this function. */
export function searchRoom(room: Exclude<NameRoom, 'listed'>, query: string, limit: number, fallback: readonly TickerListing[], nameOf: (symbol: string) => string): TickerListing[] {
  if (room === 'compass') return searchCompass(query, limit, nameOf);
  return searchListed(room, query, limit, fallback, nameOf);
}

export function searchListed(kind: 'equity' | 'option', query: string, limit: number, fallback: readonly TickerListing[], nameOf: (symbol: string) => string): TickerListing[] {
  const set = kind === 'equity' ? stockSet : optionSet;
  const list = kind === 'equity' ? stocks : options;
  const ready = list.length > 0;
  const extra = kind === 'equity' ? INDEXES : OPTION_INDEXES;
  const q = query.trim().toUpperCase();
  /* An option desk must not offer equity names while Theta's option list is still out. The cash indexes are the only
     roots that are options even before that list lands. */
  if (!ready) {
    if (kind === 'option') {
      const indexes = OPTION_INDEXES.filter(s => !q || s.includes(q) || nameOf(s).toUpperCase().includes(q));
      return indexes.slice(0, limit).map(symbol => ({ symbol, name: nameOf(symbol) }));
    }
    return fallback.slice(0, limit);
  }
  const row = (symbol: string): TickerListing => {
    const name = nameOf(symbol);
    return { symbol, name };
  };
  if (!q) {
    const pinned = FEATURED.filter(s => !SAME_AS[s] && (set.has(s) || extra.includes(s)));
    const out: TickerListing[] = [];
    const seenOut = new Set<string>();
    const push = (symbol: string) => {
      if (seenOut.has(symbol) || SAME_AS[symbol]) return;
      seenOut.add(symbol);
      out.push(row(symbol));
    };
    for (const symbol of pinned) push(symbol);
    for (const symbol of list) {
      if (out.length >= limit) break;
      push(symbol);
    }
    return out;
  }
  const prefix: string[] = [];
  const contains: string[] = [];
  const named: string[] = [];
  const pool = [...extra.filter(s => !set.has(s)), ...list].filter(s => !SAME_AS[s]);
  const asked = SAME_AS[q] ?? q;
  for (const symbol of pool) {
    if (symbol.startsWith(asked)) prefix.push(symbol);
    else if (symbol.includes(asked)) contains.push(symbol);
    else {
      const name = nameOf(symbol).toUpperCase();
      if (name !== symbol && name.includes(q)) named.push(symbol);
    }
    if (prefix.length >= limit) break;
  }
  prefix.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [...prefix, ...contains, ...named].slice(0, limit).map(row);
}

export function listedCount(kind: 'equity' | 'option'): number {
  const set = kind === 'equity' ? stockSet : optionSet;
  let n = 0;
  for (const symbol of set) if (!SAME_AS[symbol]) n += 1;
  return n;
}

/** How many names this desk's search is allowed to offer. Pulse has no floor. */
export function roomCount(room: NameRoom): number {
  if (room === 'compass') return COMPASS_TICKERS.length;
  if (room === 'listed') return 0;
  return listedCount(room);
}

export function equitySymbols(): readonly string[] {
  return stocks;
}

export function optionSymbols(): readonly string[] {
  return options;
}

export function isOptionRoot(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return optionSet.has(s) || OPTION_INDEXES.includes(s);
}

export function useListedRev(): number {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
  );
}
