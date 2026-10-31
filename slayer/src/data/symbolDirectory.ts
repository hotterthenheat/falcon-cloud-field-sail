/* The symbol directory: every symbol the data keys serve, with its name, its kind, whether options are listed on it
   today, and its exchange (scripts/build-symbol-directory.mjs writes symbolDirectory.data.ts). The data is its own
   chunk, loaded the first time a search or a name asks for it, so it never weighs on first paint. Every ticker
   search goes through searchDirectory; names go through data/tickers.ts companyName, which reads directoryName. */

import { useSyncExternalStore } from 'react';

export type SymbolKind = 'stock' | 'etf' | 'index' | 'preferred' | 'warrant' | 'unit' | 'right';

export interface DirectoryEntry {
  symbol: string;
  /** The listing's name; '' when no source names it */
  name: string;
  kind: SymbolKind;
  /** Options are listed on it today */
  options: boolean;
  /** The listing exchange's code (Q, N, A, P, Z, V, O, C) or '' */
  exchange: string;
  /** Popularity: 0 is the most traded options name */
  rank: number;
}

const KINDS: Record<string, SymbolKind> = { s: 'stock', e: 'etf', i: 'index', p: 'preferred', w: 'warrant', u: 'unit', r: 'right' };
const EXCHANGES: Record<string, string> = { Q: 'Nasdaq', N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX', O: 'OTC', C: 'Cboe' };

let entries: DirectoryEntry[] = [];
let bySymbol = new Map<string, DirectoryEntry>();
/* a class share by its letters alone (BRKB → BRK.B), the way option roots spell it */
let byBare = new Map<string, DirectoryEntry>();
/* the search columns, kept apart so a keystroke reads flat arrays */
let symCol: string[] = [];
let nameCol: string[] = [];
let builtOn = '';
let loading: Promise<void> | null = null;
let rev = 0;
const listeners = new Set<() => void>();

/** A symbol as the directory compares it: "brk/b", "BRK-B", "brk b" all read BRK.B */
export const normalSymbol = (raw: string): string =>
  raw
    .trim()
    .toUpperCase()
    .replace(/^\$/, '')
    .replace(/[/\- ]+(?=[A-Z]{1,2}$)/, '.');
/** The letters and digits alone ("BRK.B" → "BRKB"): how option roots spell a class share */
const bare = (s: string): string => s.replace(/[^A-Z0-9]/g, '');
/** The option root of a listing: a class share's dot dropped (BRK.B → BRKB), anything else as it is */
export const optionRootOf = (symbol: string): string => {
  const s = normalSymbol(symbol);
  return /^[A-Z]{1,4}\.[A-Z]$/.test(s) ? bare(s) : s;
};

function parse(text: string): void {
  const next: DirectoryEntry[] = [];
  const map = new Map<string, DirectoryEntry>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const a = line.indexOf('\t');
    if (a <= 0) continue;
    const b = line.indexOf('\t', a + 1);
    const flags = b < 0 ? '' : line.slice(b + 1);
    const symbol = line.slice(0, a);
    const entry: DirectoryEntry = {
      symbol,
      name: b < 0 ? line.slice(a + 1) : line.slice(a + 1, b),
      kind: KINDS[flags.charAt(0)] ?? 'stock',
      options: flags.charAt(1) === 'o',
      exchange: flags.replace(/^[a-z]+/, ''),
      rank: next.length,
    };
    next.push(entry);
    map.set(symbol, entry);
  }
  const bareMap = new Map<string, DirectoryEntry>();
  for (const e of next) if (/^[A-Z]{1,4}\.[A-Z]$/.test(e.symbol) && !map.has(bare(e.symbol))) bareMap.set(bare(e.symbol), e);
  entries = next;
  bySymbol = map;
  byBare = bareMap;
  symCol = next.map(e => e.symbol);
  /* "The Coca-Cola Company" is found as Coca-Cola */
  nameCol = next.map(e => e.name.toUpperCase().replace(/^THE /, ''));
}

/** Load the directory (once). Every caller may ask; the data chunk is fetched the first time. */
export function loadDirectory(): Promise<void> {
  if (!loading) {
    loading = import('./symbolDirectory.data')
      .then(m => {
        parse(m.DIRECTORY);
        builtOn = m.BUILT_ON;
        rev += 1;
        listeners.forEach(fn => fn());
      })
      .catch(() => {
        /* a failed chunk (offline, a stale deploy) is asked again by the next search */
        loading = null;
      });
  }
  return loading;
}

export const directoryReady = (): boolean => entries.length > 0;
export const directoryBuiltOn = (): string => builtOn;
export const directorySize = (): number => entries.length;
export const directoryOptionCount = (): number => {
  let n = 0;
  for (const e of entries) if (e.options) n += 1;
  return n;
};

export function directoryEntry(symbol: string): DirectoryEntry | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  return bySymbol.get(s) ?? null;
}

/** The directory's name for a symbol, or '' (not loaded yet, or no source names it) */
export const directoryName = (symbol: string): string => directoryEntry(symbol)?.name ?? '';

/** Options listed on the symbol today: true or false once the directory is loaded, null before (or for a symbol it
    does not carry — a listing newer than the directory) */
export function hasListedOptions(symbol: string): boolean | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  const e = bySymbol.get(s) ?? byBare.get(s);
  return e ? e.options : null;
}

/* The cash indexes the terminal prices (scripts/build-symbol-directory.mjs INDEX_NAMES, less the symbols a stock
   holds): known before the directory loads, so a price read never waits on it */
const CASH_INDEXES = new Set([
  'SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'XNDX', 'NQX', 'MNX', 'RUT', 'RUTW', 'MRUT', 'RUI', 'RUA', 'RLG', 'RLV', 'VIX', 'VIXW',
  'VIX1D', 'VIX9D', 'VIX3M', 'VIX6M', 'VIX1Y', 'VVIX', 'VXN', 'RVX', 'VXD', 'GVZ', 'OVX', 'VXEEM', 'SKEW', 'DJX', 'DJI', 'DJU',
  'OEX', 'XEO', 'SPESG', 'SOX', 'OSX', 'BKX', 'HGX', 'XAU', 'UTY', 'TNX', 'TYX', 'FVX', 'IRX',
]);
/** A cash index (priced off the terminal's index reads, never its stock reads) */
export function isCashIndex(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  const e = entries.length ? bySymbol.get(s) : undefined;
  return e ? e.kind === 'index' : CASH_INDEXES.has(s);
}

export const kindLabel = (kind: SymbolKind): string =>
  kind === 'etf' ? 'ETF' : kind === 'index' ? 'Index' : kind === 'stock' ? 'Stock' : kind.charAt(0).toUpperCase() + kind.slice(1);
export const exchangeLabel = (code: string): string => EXCHANGES[code] ?? '';

export interface DirectorySearch {
  limit?: number;
  /** Only names with options listed today (the option desks) */
  optionsOnly?: boolean;
  /** Symbols never offered (a weekly root folded into its index) */
  exclude?: ReadonlySet<string>;
}

const isWordStart = (s: string, i: number): boolean => i === 0 || !/[A-Z0-9]/.test(s.charAt(i - 1));

/** Every symbol matching the query, best first: the exact symbol, then symbols that start with it, then names with a
    word that starts with it (all one tier), then symbols and names that contain it — inside each tier the most traded first. The
    empty query lists the directory by popularity. */
export function searchDirectory(query: string, opts: DirectorySearch = {}): DirectoryEntry[] {
  const limit = opts.limit ?? 60;
  const only = !!opts.optionsOnly;
  const ex = opts.exclude;
  const n = entries.length;
  const out: DirectoryEntry[] = [];
  if (!n) return out;
  const raw = query.trim().toUpperCase().replace(/^\$/, '');
  if (!raw) {
    for (let i = 0; i < n && out.length < limit; i++) {
      const e = entries[i];
      if ((only && !e.options) || ex?.has(e.symbol)) continue;
      out.push(e);
    }
    return out;
  }
  const q = normalSymbol(raw);
  const qBare = bare(q);
  const symbolish = /^[A-Z0-9.]{1,10}$/.test(q);
  const tiers: DirectoryEntry[][] = [[], [], [], [], [], []];
  const exact = symbolish ? (bySymbol.get(q) ?? byBare.get(qBare)) : undefined;
  if (exact && !(only && !exact.options) && !ex?.has(exact.symbol)) tiers[0].push(exact);
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    if (e === exact || (only && !e.options) || ex?.has(e.symbol)) continue;
    const sym = symCol[i];
    let tier = -1;
    if (symbolish && sym.startsWith(q)) tier = 1;
    else {
      const name = nameCol[i];
      const at = name ? name.indexOf(raw) : -1;
      if (at === 0) tier = 2;
      else if (at > 0) {
        let k = at;
        while (k >= 0 && !isWordStart(name, k)) k = name.indexOf(raw, k + 1);
        /* a word of the name that starts with the query is a name match like any other: popularity orders them */
        tier = k >= 0 ? 2 : 5;
      }
      if (tier < 0 && symbolish && qBare.length >= 2 && sym.includes(q)) tier = 4;
    }
    if (tier < 0) continue;
    const bucket = tiers[tier];
    if (bucket.length < limit) bucket.push(e);
    /* the exact and prefix tiers alone fill the page: nothing later can outrank them */
    if (tier === 1 && tiers[0].length + tiers[1].length >= limit) break;
  }
  for (const t of tiers) {
    for (const e of t) {
      if (out.length >= limit) return out;
      out.push(e);
    }
  }
  return out;
}

export function subscribeDirectory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const directoryRev = (): number => rev;
export function useDirectoryRev(): number {
  return useSyncExternalStore(subscribeDirectory, directoryRev, () => 0);
}
