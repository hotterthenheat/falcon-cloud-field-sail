/* The listed names each desk may offer: on Terrain every listing the terminal quotes with bars (and every index it
   prices); on Pinpoint every name the vendor lists options on (Pinpoint reads its options from the vendor only); every
   listing on the Dossier; names with the terminal's listed options on the option desks (Weigher, Trace, Paper,
   Backtest); the 456 on Compass. The rows and their desks come from the generated directory
   (scripts/build-ticker-universe.mjs). */

import { useSyncExternalStore } from 'react';
import { thetaCall, thetaUseHere } from './theta';
import type { TickerListing } from './tickers';
import { directoryCount, directoryEntry, directoryReady, hasListedOptions, loadDirectory, normalSymbol, pinpointServes, renamedTo, searchDirectory, type DirectoryFilter } from './symbolDirectory';
import { COMPASS_TICKERS } from './compassUniverse';

type NameRoom = 'equity' | 'terrain' | 'option' | 'pinpoint' | 'compass' | 'listed';
/** The rooms whose names come from the directory */
type DirectoryRoom = 'equity' | 'terrain' | 'option' | 'pinpoint';
/** What each room keeps of the directory */
const ROOM_FILTER: Record<DirectoryRoom, DirectoryFilter | undefined> = { equity: undefined, terrain: 'terrain', option: 'options', pinpoint: 'pinpoint' };

const FEATURED = [
  'SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL',
  'AMD', 'NFLX', 'AVGO', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'HOOD', 'MU', 'TSM',
  'SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP', 'DJX',
];

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

/* The symbol directory (data/symbolDirectory.ts) is what every desk's search reads: each listing with its name,
   kind and whether options are listed today. The terminal's own lists (pulled below, kept a visit in storage) only
   add a symbol the directory is too old to carry — offered when typed in full. */
let dirAsked = false;
function askDirectory(): void {
  if (dirAsked) return;
  dirAsked = true;
  void loadDirectory().then(() => {
    if (!directoryReady()) {
      dirAsked = false;
      return;
    }
    emit();
  });
}

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

/* The symbol lists are ThetaData list reads: only a page that may read all of ThetaData asks (data/theta.ts); elsewhere the
   bundled lists stand. */
const unusualWhalesOnly = (): boolean => thetaUseHere() !== 'all';

/** Ask Theta once for both lists. Safe to call from every picker. A cached copy shows immediately. */
export function ensureListed(): void {
  askDirectory();
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
  /* Terrain charts what the terminal quotes. Pinpoint reads the vendor's options. The Weigher weighs the terminal's
     options chain, so it offers only names with listed options there. */
  if (path.startsWith('/terrain')) return 'terrain';
  if (path.startsWith('/dossier')) return 'equity';
  if (path.startsWith('/pinpoint')) return 'pinpoint';
  if (
    path.startsWith('/weigher')
    || path.startsWith('/trace')
    || path.startsWith('/practice/paper')
    || path.startsWith('/practice/backtest')
  ) return 'option';
  return 'listed';
}

/** Compass only. Both SPX and SPXW stay. The cash-index fold does not apply here. */
function searchCompass(query: string, limit: number, nameOf: (symbol: string) => string): TickerListing[] {
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

const FOLDED = new Set(Object.keys(SAME_AS));

export function searchListed(kind: DirectoryRoom, query: string, limit: number, fallback: readonly TickerListing[], nameOf: (symbol: string) => string): TickerListing[] {
  const q = query.trim().toUpperCase();
  const row = (symbol: string): TickerListing => ({ symbol, name: nameOf(symbol) });
  if (!directoryReady()) {
    askDirectory();
    /* An option desk must not offer equity names before the directory lands. The cash indexes are the only roots that
       are options for certain. */
    if (kind === 'option' || kind === 'pinpoint') {
      const indexes = OPTION_INDEXES.filter(s => !q || s.includes(q) || nameOf(s).toUpperCase().includes(q));
      return indexes.slice(0, limit).map(row);
    }
    return fallback.slice(0, limit);
  }
  const only = ROOM_FILTER[kind];
  const keeps = (e: NonNullable<ReturnType<typeof directoryEntry>>) =>
    !only || (only === 'options' ? e.options : only === 'terrain' ? e.terrain : e.pinpoint);
  if (!q) {
    const out: TickerListing[] = [];
    const seen = new Set<string>();
    for (const symbol of FEATURED) {
      if (FOLDED.has(symbol) || seen.has(symbol)) continue;
      const e = directoryEntry(symbol);
      if (!e || !keeps(e)) continue;
      seen.add(symbol);
      out.push(row(symbol));
    }
    for (const e of searchDirectory('', { limit: limit + out.length, only, exclude: FOLDED })) {
      if (out.length >= limit) break;
      if (!seen.has(e.symbol)) out.push(row(e.symbol));
    }
    return out;
  }
  const asked = SAME_AS[q] ?? q;
  const hits = searchDirectory(asked, { limit, only, exclude: FOLDED }).map(e => row(e.symbol));
  /* a listing newer than the directory: the terminal's live list carries it, offered when typed in full (not on
     Pinpoint: the terminal's lists say nothing of the vendor's options) */
  const typed = normalSymbol(asked);
  if (kind !== 'pinpoint' && !directoryEntry(typed) && !renamedTo(typed) && (kind === 'option' ? optionSet : stockSet).has(typed) && /^[A-Z][A-Z0-9.]{0,7}$/.test(typed)) hits.unshift(row(typed));
  return hits.slice(0, limit);
}

/** How many names this desk's search may offer. Pulse has no floor. */
export function roomCount(room: NameRoom): number {
  if (room === 'compass') return COMPASS_TICKERS.length;
  if (room === 'listed') return 0;
  if (!directoryReady()) return 0;
  return directoryCount(ROOM_FILTER[room]) - FOLDED.size;
}

let optionRoots: string[] = [];
let optionRootsAt = -1;
/** Every name with listed options today, most traded first (the directory; the terminal's list before it lands) */
export function optionSymbols(): readonly string[] {
  if (!directoryReady()) {
    askDirectory();
    return options;
  }
  if (optionRootsAt !== directoryCount()) {
    optionRoots = searchDirectory('', { limit: Infinity, optionsOnly: true }).map(e => e.symbol);
    optionRootsAt = directoryCount();
  }
  return optionRoots;
}

/** Options are listed on the symbol today. Before the directory lands a symbol is given the benefit of the doubt
    unless the terminal's option list (kept from an earlier visit) says otherwise. */
export function isOptionRoot(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (OPTION_INDEXES.includes(s) || SAME_AS[s]) return true;
  const known = hasListedOptions(s);
  if (known !== null) return known;
  if (directoryReady()) return optionSet.has(s);
  askDirectory();
  return optionSet.size ? optionSet.has(s) : true;
}

/** Pinpoint can serve the symbol: the vendor lists options on it. Before the directory lands a symbol is given the
    benefit of the doubt (the cash indexes always are). */
export function isPinpointName(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (OPTION_INDEXES.includes(s) || SAME_AS[s]) return true;
  const known = pinpointServes(s);
  if (known !== null) return known;
  if (!directoryReady()) askDirectory();
  return true;
}

/** Options are listed on the symbol: true or false once the directory is known, null before */
export function listedOptionsKnown(symbol: string): boolean | null {
  const s = symbol.toUpperCase();
  if (OPTION_INDEXES.includes(s) || SAME_AS[s]) return true;
  const known = hasListedOptions(s);
  if (known !== null) return known;
  if (!directoryReady()) {
    askDirectory();
    return null;
  }
  /* newer than the directory: the terminal's live option list decides */
  return optionSet.size ? optionSet.has(s) : null;
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
