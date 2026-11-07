/* The symbol directory: every symbol the data keys serve, with its name, its kind, its exchange, and which desks can
   serve it — options listed on the terminal's chains (the Weigher, Paper, Backtest), options the vendor lists (what
   Pinpoint reads), and a quote with bars (what Terrain draws). scripts/build-ticker-universe.mjs writes it daily to
   generated/tickerUniverse.json. The data is its own chunk, loaded the first time a search or a name asks for it, so
   it never weighs on first paint. Every ticker search goes through searchDirectory; names go through data/tickers.ts
   companyName, which reads directoryName.

   Search is indexed: each symbol and each word of each name is filed under its first two letters (one letter for a
   one-letter word), so a keystroke reads only the rows that can match in the exact, prefix and word tiers; the
   middle-of-a-word tiers scan only when those leave the page short. */

import { useSyncExternalStore } from 'react';

export type SymbolKind = 'stock' | 'etf' | 'index' | 'preferred' | 'warrant' | 'unit' | 'right';

export interface DirectoryEntry {
  symbol: string;
  /** The listing's name; '' when no source names it */
  name: string;
  kind: SymbolKind;
  /** Options are listed on it today (the terminal's chains: the Weigher, Paper, Backtest) */
  options: boolean;
  /** The vendor lists options on it today */
  vendorOptions: boolean;
  /** Terrain can serve it: quoted with bars (a stock or fund), or priced (an index) */
  terrain: boolean;
  /** Pinpoint can serve it: the vendor lists live options on it */
  pinpoint: boolean;
  /** The listing exchange's code (Q, N, A, P, Z, V, O, C) or '' */
  exchange: string;
  /** Popularity: 0 is the most traded options name */
  rank: number;
}

/** What a search may offer: every row, or the rows one desk can serve. `options` is the terminal's live options (the
    Weigher, Paper, Backtest), `vendor` the vendor's (Trace, which reads the vendor only) */
export type DirectoryFilter = 'options' | 'vendor' | 'terrain' | 'pinpoint';

const KINDS: Record<string, SymbolKind> = { s: 'stock', e: 'etf', i: 'index', p: 'preferred', w: 'warrant', u: 'unit', r: 'right' };
const EXCHANGES: Record<string, string> = { Q: 'Nasdaq', N: 'NYSE', A: 'NYSE American', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX', O: 'OTC', C: 'Cboe' };

let entries: DirectoryEntry[] = [];
let bySymbol = new Map<string, DirectoryEntry>();
/* a class share by its letters alone (BRKB → BRK.B), the way option roots spell it */
let byBare = new Map<string, DirectoryEntry>();
/* an old ticker to its new one (FB → META), the changes the build confirmed */
let aliases = new Map<string, string>();
/* the search columns, kept apart so a keystroke reads flat arrays */
let symCol: string[] = [];
let nameCol: string[] = [];
/* the index: two-letter (or one-letter) key → row numbers, in rank order */
let symIndex = new Map<string, Int32Array>();
let wordIndex = new Map<string, Int32Array>();
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

const keyOf = (s: string): string => s.slice(0, 2);
const isWordStart = (s: string, i: number): boolean => i === 0 || !/[A-Z0-9]/.test(s.charAt(i - 1));

function buildIndex(): void {
  const sym = new Map<string, number[]>();
  const word = new Map<string, number[]>();
  const put = (m: Map<string, number[]>, k: string, i: number) => {
    if (!k) return;
    const a = m.get(k);
    if (!a) m.set(k, [i]);
    else if (a[a.length - 1] !== i) a.push(i);
  };
  for (let i = 0; i < symCol.length; i++) {
    put(sym, keyOf(symCol[i]), i);
    if (symCol[i].length > 1) put(sym, symCol[i].charAt(0), i);
    const name = nameCol[i];
    for (let k = 0; k < name.length; k++) {
      if (!isWordStart(name, k) || !/[A-Z0-9&]/.test(name.charAt(k))) continue;
      put(word, name.slice(k, k + 2).replace(/[^A-Z0-9&]$/, ''), i);
      put(word, name.charAt(k), i);
    }
  }
  const pack = (m: Map<string, number[]>) => new Map([...m].map(([k, v]) => [k, Int32Array.from(v)]));
  symIndex = pack(sym);
  wordIndex = pack(word);
}

/** Parse the generated directory: rows are SYMBOL \t NAME \t FLAGS (scripts/build-ticker-universe.mjs's legend) */
export function parseDirectory(text: string, aliasMap: Record<string, string> = {}): void {
  const next: DirectoryEntry[] = [];
  const map = new Map<string, DirectoryEntry>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const a = line.indexOf('\t');
    if (a <= 0) continue;
    const b = line.indexOf('\t', a + 1);
    const flags = b < 0 ? '' : line.slice(b + 1);
    const marks = /^[a-z]*/.exec(flags.slice(1))?.[0] ?? '';
    const symbol = line.slice(0, a);
    const entry: DirectoryEntry = {
      symbol,
      name: b < 0 ? line.slice(a + 1) : line.slice(a + 1, b),
      kind: KINDS[flags.charAt(0)] ?? 'stock',
      options: marks.includes('o'),
      vendorOptions: marks.includes('v'),
      terrain: marks.includes('t'),
      pinpoint: marks.includes('p'),
      exchange: flags.slice(1 + marks.length),
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
  /* an old ticker still carried (a LEAP under the old root) keeps its row; the alias leads the search all the same */
  aliases = new Map(Object.entries(aliasMap).filter(([from, to]) => map.has(to) && !(map.get(from)?.terrain || map.get(from)?.pinpoint)));
  symCol = next.map(e => e.symbol);
  /* "The Coca-Cola Company" is found as Coca-Cola */
  nameCol = next.map(e => e.name.toUpperCase().replace(/^THE /, ''));
  buildIndex();
}

interface UniverseFile {
  schema: number;
  builtOn: string;
  aliases?: Record<string, string>;
  /** The build's expiry checks (scripts/build-ticker-universe.mjs): noContracts are the vendor's dates with no contract */
  expiries?: { session?: string; noContracts?: Record<string, string[]> };
  rows: string;
}

/* the vendor's listed dates with no contract behind them, per symbol (CBTX 2026-11-09): every expiry picker hides them */
let noContracts = new Map<string, ReadonlySet<string>>();
/** Set the vendor dates with no contract (the directory's load; a proof's) */
export function setNoContractDates(map: Record<string, readonly string[]> | undefined): void {
  noContracts = new Map(Object.entries(map ?? {}).map(([k, v]) => [k.toUpperCase(), new Set(v)]));
}
/** The vendor's listed dates for a symbol with no contract behind them (empty before the directory loads) */
export const noContractDates = (symbol: string): ReadonlySet<string> => noContracts.get(normalSymbol(symbol)) ?? EMPTY_DATES;
const EMPTY_DATES: ReadonlySet<string> = new Set();

/** Load the directory (once). Every caller may ask; the data chunk is fetched the first time. */
export function loadDirectory(): Promise<void> {
  if (!loading) {
    loading = import('./generated/tickerUniverse.json')
      .then(m => {
        const doc = ((m as { default?: UniverseFile }).default ?? m) as UniverseFile;
        parseDirectory(doc.rows, doc.aliases);
        setNoContractDates(doc.expiries?.noContracts);
        builtOn = doc.builtOn;
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
export const passes = (e: DirectoryEntry, only: DirectoryFilter | undefined): boolean =>
  !only || (only === 'options' ? e.options : only === 'vendor' ? e.vendorOptions : only === 'terrain' ? e.terrain : e.pinpoint);
const counts = new Map<string, number>();
/** How many rows one filter keeps (every row without one) */
export function directoryCount(only?: DirectoryFilter): number {
  const key = `${only ?? ''}|${entries.length}`;
  let n = counts.get(key);
  if (n === undefined) {
    n = 0;
    for (const e of entries) if (passes(e, only)) n += 1;
    counts.set(key, n);
  }
  return n;
}
export const directoryOptionCount = (): number => directoryCount('options');

/** A symbol's row: its own, a class share's letters (BRKB), or the new ticker of an old one (FB → META) */
export function directoryEntry(symbol: string): DirectoryEntry | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  return bySymbol.get(s) ?? null;
}

/** The new ticker of an old one the directory knows (FB → META), or '' */
export const renamedTo = (symbol: string): string => aliases.get(normalSymbol(symbol)) ?? '';

/** The directory's name for a symbol, or '' (not loaded yet, or no source names it) */
export const directoryName = (symbol: string): string => directoryEntry(symbol)?.name ?? '';

/** Options are listed on the symbol today: true or false once the directory is loaded, null before (or for a symbol it
    does not carry — a listing newer than the directory) */
export function hasListedOptions(symbol: string): boolean | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  const e = bySymbol.get(s) ?? byBare.get(s);
  return e ? e.options : null;
}

/** The vendor lists live options on the symbol (what every book read needs): true or false once loaded, null before or
    for a symbol the directory does not carry */
export function hasVendorOptions(symbol: string): boolean | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  const e = bySymbol.get(s) ?? byBare.get(s);
  return e ? e.vendorOptions : null;
}

/** Pinpoint can serve the symbol (the vendor lists live options on it): true or false once loaded, null before or for a
    symbol the directory does not carry */
export function pinpointServes(symbol: string): boolean | null {
  if (!entries.length) return null;
  const s = normalSymbol(symbol);
  const e = bySymbol.get(s) ?? byBare.get(s);
  return e ? e.pinpoint : null;
}

/** Terrain can serve the symbol (quoted with bars, or a priced index): true or false once loaded, null before */
export function terrainServes(symbol: string): boolean | null {
  if (!entries.length) return null;
  const e = bySymbol.get(normalSymbol(symbol));
  return e ? e.terrain : null;
}

/* The cash indexes the terminal prices that every page knows before the directory loads, so a price read never waits
   on it (the directory then knows every index the terminal prices) */
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
  /** Only names with options listed today on the terminal's chains (the option desks) */
  optionsOnly?: boolean;
  /** Only the rows one desk can serve */
  only?: DirectoryFilter;
  /** Symbols never offered (a weekly root folded into its index) */
  exclude?: ReadonlySet<string>;
}

/** Every symbol matching the query, best first: the exact symbol, then symbols that start with it, then names with a
    word that starts with it (all one tier), then symbols and names that contain it — inside each tier the most traded
    first. The empty query lists the directory by popularity. */
export function searchDirectory(query: string, opts: DirectorySearch = {}): DirectoryEntry[] {
  const limit = opts.limit ?? 60;
  const only: DirectoryFilter | undefined = opts.only ?? (opts.optionsOnly ? 'options' : undefined);
  const ex = opts.exclude;
  const n = entries.length;
  const out: DirectoryEntry[] = [];
  if (!n) return out;
  const raw = query.trim().toUpperCase().replace(/^\$/, '');
  const ok = (e: DirectoryEntry) => passes(e, only) && !ex?.has(e.symbol);
  if (!raw) {
    for (let i = 0; i < n && out.length < limit; i++) if (ok(entries[i])) out.push(entries[i]);
    return out;
  }
  const q = normalSymbol(raw);
  const qBare = bare(q);
  const symbolish = /^[A-Z0-9.]{1,10}$/.test(q);
  const tiers: DirectoryEntry[][] = [[], [], [], [], [], []];
  const seen = new Set<number>();
  const exact = symbolish ? (bySymbol.get(q) ?? byBare.get(qBare)) : undefined;
  /* an old ticker (FB → META) offers the new one first */
  const renamed = symbolish ? aliases.get(q) : undefined;
  for (const e of [renamed ? bySymbol.get(renamed) : undefined, exact]) {
    if (e && ok(e) && !seen.has(e.rank)) {
      tiers[0].push(e);
      seen.add(e.rank);
    }
  }
  /* the indexed tiers: symbols that start with the query, names with a word that starts with it */
  const symRows = symbolish ? symIndex.get(keyOf(q)) : undefined;
  if (symRows) {
    for (let j = 0; j < symRows.length && tiers[1].length < limit; j++) {
      const i = symRows[j];
      if (seen.has(i) || !symCol[i].startsWith(q) || !ok(entries[i])) continue;
      tiers[1].push(entries[i]);
      seen.add(i);
    }
  }
  if (tiers[0].length + tiers[1].length < limit) {
    /* the index files a word under its first two letters, or its first alone when the second is punctuation */
    const wordRows = wordIndex.get(/^.[A-Z0-9&]/.test(raw) ? raw.slice(0, 2) : raw.charAt(0));
    if (wordRows) {
      for (let j = 0; j < wordRows.length && tiers[2].length < limit; j++) {
        const i = wordRows[j];
        if (seen.has(i) || !ok(entries[i])) continue;
        const name = nameCol[i];
        let k = name.indexOf(raw);
        while (k >= 0 && !isWordStart(name, k)) k = name.indexOf(raw, k + 1);
        if (k < 0) continue;
        tiers[2].push(entries[i]);
        seen.add(i);
      }
    }
  }
  /* the scanned tiers, only when the page is still short: symbols and names that contain the query mid-word */
  if (tiers[0].length + tiers[1].length + tiers[2].length < limit) {
    const room = limit - tiers[0].length - tiers[1].length - tiers[2].length;
    for (let i = 0; i < n && tiers[4].length + tiers[5].length < room; i++) {
      if (seen.has(i)) continue;
      const e = entries[i];
      if (!ok(e)) continue;
      if (symbolish && qBare.length >= 2 && symCol[i].includes(q)) tiers[4].push(e);
      else if (nameCol[i] && nameCol[i].includes(raw)) tiers[5].push(e);
    }
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
