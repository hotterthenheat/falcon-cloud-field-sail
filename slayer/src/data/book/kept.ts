/* The copy of a name's book this browser kept (IndexedDB, its own store beside data/uwStore.ts's answers), so a reload or a later visit paints at once.
   A kept book is served to readers, stamped with when it was read (Entry.keptAt), only until the fresh read has its front
   date in (store.ts peekEntry); it is never shown as live. */

import type { Candle, StrikeNode } from '../../types/market';
import type { Entry } from './store';
import type { LiveGamma } from './scale';

const VERSION = 1;
const DB = 'slayer-book';
const STORE = 'books';

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}
function put(key: string, value: unknown): void {
  void db().then(d => {
    try {
      d?.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    } catch {
      /* full or blocked storage: the book is simply not kept */
    }
  });
}
async function get(key: string): Promise<unknown> {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
/** A kept book older than this is not painted */
const KEPT_MAX_MS = 5 * 86_400_000;
const keyOf = (ticker: string) => `#book/v${VERSION}/${ticker.toUpperCase()}`;

/* The node's fields in a fixed order, packed as one array per strike */
const NODE_KEYS = [
  'strike', 'gexPx', 'gexAt', 'callOI', 'putOI', 'gamma', 'callGex', 'putGex', 'netGex', 'callDex', 'putDex', 'netDex',
  'callVex', 'putVex', 'netVex', 'vanna', 'charm', 'callVanna', 'putVanna', 'netVanna', 'callCharm', 'putCharm', 'netCharm',
  'callVol', 'putVol', 'callIv', 'putIv', 'callGamma', 'putGamma', 'callBook', 'putBook',
] as const;
type Packed = (number | null)[];

function pack(nodes: readonly StrikeNode[]): Packed[] {
  return nodes.map(n => {
    const row: Packed = NODE_KEYS.map(k => {
      const v = n[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    });
    row.push(n.flowFirm == null ? null : n.flowFirm ? 1 : 0);
    return row;
  });
}

function unpack(rows: readonly Packed[]): StrikeNode[] {
  return rows.map(row => {
    const n = {} as Record<string, unknown>;
    NODE_KEYS.forEach((k, i) => {
      const v = row[i];
      if (v != null) n[k] = v;
    });
    const firm = row[NODE_KEYS.length];
    if (firm != null) n.flowFirm = firm === 1;
    return n as unknown as StrikeNode;
  });
}

const packCandles = (c: readonly Candle[]) => c.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]);
const unpackCandles = (rows: readonly number[][]): Candle[] => rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));

interface KeptBook {
  v: number;
  savedAt: number;
  entry: Omit<Entry, 'all' | 'byDate' | 'flow' | 'candles' | 'tape' | 'history' | 'history0' | 'historyRest' | 'closes' | 'factsDates' | 'keptPriced' | 'keptSettled'> & {
    all: Packed[];
    byDate: Record<string, Packed[]>;
    candles: number[][];
    tape: number[][];
    factsDates: string[];
  };
  priced: [string, { price: number; at: number }][];
  settled: [string, [number, { c: number; p: number }][]][];
}

const lastKept = new Map<string, number>();

/** Keep a name's book (fire and forget). `priced`: its gamma rows' pricing stamps; `settled`: its settled dates' live rows. */
export function keepBook(e: Entry, priced: Map<string, { price: number; at: number }>, settled: Map<string, LiveGamma>, empty: Set<string> | undefined): void {
  if (e.keptAt || e.status !== 'live' || lastKept.get(e.ticker) === e.at) return;
  lastKept.set(e.ticker, e.at);
  const t = e.ticker.toUpperCase();
  const own = (k: string) => k.startsWith(`${t}|`);
  const { all, byDate, flow, candles, tape, history, history0, historyRest, closes, factsDates, keptPriced, keptSettled, ...rest } = e;
  void flow;
  void history;
  void history0;
  void historyRest;
  void closes;
  void keptPriced;
  void keptSettled;
  const book: KeptBook = {
    v: VERSION,
    savedAt: Date.now(),
    entry: {
      ...rest,
      keptEmpty: [...(empty ?? [])],
      all: pack(all),
      byDate: Object.fromEntries(Object.entries(byDate).map(([d, nodes]) => [d, pack(nodes)])),
      candles: packCandles(candles),
      tape: packCandles(tape),
      factsDates: [...(factsDates ?? [])],
    },
    priced: [...priced].filter(([k]) => own(k)),
    settled: [...settled].filter(([k]) => own(k)).map(([k, rows]) => [k, [...rows].map(([strike, l]) => [strike, { c: l.c, p: l.p }])]),
  };
  put(keyOf(t), book);
}

/** The kept book for a name, ready to serve (status live, keptAt set) — null when none, too old or unreadable */
export async function readKept(ticker: string): Promise<Entry | null> {
  try {
    const book = (await get(keyOf(ticker))) as KeptBook | null;
    if (!book || book.v !== VERSION || !book.entry || Date.now() - book.savedAt > KEPT_MAX_MS) return null;
    const k = book.entry;
    const entry: Entry = {
      ...k,
      status: 'live',
      keptAt: book.savedAt,
      all: unpack(k.all),
      byDate: Object.fromEntries(Object.entries(k.byDate).map(([d, rows]) => [d, unpack(rows)])),
      flow: new Map(),
      candles: unpackCandles(k.candles),
      tape: unpackCandles(k.tape),
      history: [],
      factsDates: new Set(k.factsDates),
      keptPriced: Object.fromEntries(book.priced),
      keptSettled: Object.fromEntries(book.settled.map(([key, rows]) => [key, new Map(rows.map(([strike, l]) => [strike, { c: l.c, p: l.p, cv: 0, pv: 0, cc: 0, pc: 0, cd: 0, pd: 0, gA: 0, gB: 0, pA: 0, pB: 0, dA: 0, dB: 0, pdA: 0, pdB: 0, vA: 0, vB: 0, pvA: 0, pvB: 0, cA: 0, cB: 0, pcA: 0, pcB: 0, asks: false, vanna: false, charm: false, delta: false }]))])),
    };
    return entry.all.length && entry.spot > 0 ? entry : null;
  } catch {
    return null;
  }
}
