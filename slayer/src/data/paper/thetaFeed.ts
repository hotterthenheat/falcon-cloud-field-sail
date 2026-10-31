/* The paper desk's market, live from ThetaData: each name's NBBO (an index's price), the expiries listed today, and
   every contract's NBBO on the expiries the desk is looking at or holds. One snapshot ask per name and per expiry, on a
   two-second beat while the tab is visible; nothing while it is hidden, and the client's breaker (data/theta.ts)
   holds every ask while the terminal is down. The last answer of each is kept in this browser and painted on a
   reload, stamped with when it was taken; a kept or stale quote never fills. */

import { thetaCall } from '../theta';
import { readSaved, save as keep } from '../uwStore';
import { flatRows } from '../review/history';
import { nyAt, nyInstant } from './clock';
import { sessionCloseMinOn } from '../../core/calendar';
import { productOf, sessionAt } from '../../core/session';

/** A quote older than this (from when it was read) does not fill: the desk says the feed is behind */
export const FRESH_MS = 8_000;
const BEAT_MS = 2_000;
/** A want not renewed for this long is let go */
const WANT_MS = 30_000;

/* index options trade on their own roots: SPX's dailies are SPXW, NDX's NDXP, RUT's RUTW */
const INDEX_ROOTS: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW', VIX: 'VIX', XSP: 'XSP' };
const INDEXES = new Set(Object.keys(INDEX_ROOTS));
export const optionRootOf = (ticker: string): string => INDEX_ROOTS[ticker.toUpperCase()] ?? ticker.toUpperCase();
const isIndex = (t: string) => INDEXES.has(t.toUpperCase());
const ymd = (iso: string) => iso.replace(/-/g, '');

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};
/** A v3 stamp ("2026-10-29T10:42:31.120", New York's wall clock) as an instant */
function stampOf(v: unknown): number {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v) : null;
  if (!m) return 0;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 5, +m[5], +m[6]);
  /* New York is UTC−5 in winter, −4 in summer: the guess read back in New York says which */
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric' }).format(new Date(guess)));
  return guess - ((hour - +m[4] + 24) % 24) * 3600_000;
}

/* ---- the pulse ---- */
let rev = 0;
const heard = new Set<() => void>();
const emit = () => {
  rev++;
  heard.forEach(fn => fn());
};
export const subscribeFeed = (fn: () => void) => {
  heard.add(fn);
  return () => {
    heard.delete(fn);
  };
};
export const feedRev = () => rev;
let offlineSince = 0;
/** Since when (ms) the terminal has not answered, or 0 */
export const feedOffline = (): number => offlineSince;
const noteAnswer = (error: string | null, status: number): boolean => {
  if (error === 'terminal_down' || status === 401) {
    if (!offlineSince) {
      offlineSince = Date.now();
      emit();
    }
    return false;
  }
  if (offlineSince) {
    offlineSince = 0;
    emit();
  }
  return true;
};

/* ---- a name ---- */
export interface NameQuote {
  bid: number;
  ask: number;
  /** The mid (an index: its price) */
  px: number;
  /** When it was read (ms), and whether it is this browser's copy from an earlier visit */
  takenAt: number;
  kept?: boolean;
}
const names = new Map<string, NameQuote>();
const nameWant = new Map<string, number>();
async function pullName(t: string): Promise<void> {
  const path = isIndex(t) ? `/index/snapshot/price?symbol=${encodeURIComponent(t)}&format=json` : `/stock/snapshot/quote?symbol=${encodeURIComponent(t)}&format=json`;
  const got = await thetaCall(path, true);
  if (!noteAnswer(got.error, got.status) || got.error) return;
  const r = flatRows(got.data)[0];
  if (!r) return;
  const now = Date.now();
  let q: NameQuote | null = null;
  if (isIndex(t)) {
    const px = num(r.price);
    if (px > 0) q = { bid: px, ask: px, px, takenAt: now };
  } else {
    const bid = num(r.bid);
    const ask = num(r.ask);
    if (bid > 0 && ask >= bid) q = { bid, ask, px: Math.round(((bid + ask) / 2) * 10000) / 10000, takenAt: now };
  }
  if (!q) return;
  names.set(t, q);
  keep(`theta:paper:name|${t}`, 200, q);
  emit();
}
/** The name's quote now (or the kept one, marked so) — null until one lands */
export function nameQuote(ticker: string): NameQuote | null {
  const t = ticker.toUpperCase();
  want(nameWant, t);
  return names.get(t) ?? null;
}

/* ---- the expiries listed today ---- */
const expiries = new Map<string, { list: string[]; takenAt: number; kept?: boolean }>();
const expAsked = new Map<string, number>();
async function pullExpiries(root: string): Promise<void> {
  const got = await thetaCall(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`, true);
  if (!noteAnswer(got.error, got.status) || got.error) return;
  const list = flatRows(got.data)
    .map(r => String(r.expiration ?? r.date ?? '').slice(0, 10))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e))
    .sort();
  if (!list.length) return;
  const v = { list: [...new Set(list)], takenAt: Date.now() };
  expiries.set(root, v);
  keep(`theta:paper:exp|${root}`, 200, v);
  emit();
}
/** Every expiry the root lists (past ones included — the caller cuts at today), or null until they land */
export function listedExpiries(ticker: string): string[] | null {
  const root = optionRootOf(ticker);
  const hit = expiries.get(root);
  if (typeof window === 'undefined') return hit?.list ?? null;
  const asked = expAsked.get(root) ?? 0;
  /* the list is read once an hour, and once as soon as it is first wanted */
  if (Date.now() - asked > (hit && !hit.kept ? 3600_000 : 20_000)) {
    expAsked.set(root, Date.now());
    if (!hit) void hydrate(`theta:paper:exp|${root}`, v => !expiries.has(root) && expiries.set(root, { ...(v as { list: string[]; takenAt: number }), kept: true }));
    void pullExpiries(root);
  }
  return hit?.list ?? null;
}

/* ---- the contracts of an expiry ---- */
export interface LegQuote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  /** The quote's own stamp (ms) */
  at: number;
}
export interface Book {
  /** By "strike|C" */
  legs: Map<string, LegQuote>;
  strikes: number[];
  takenAt: number;
  kept?: boolean;
}
const books = new Map<string, Book>();
const bookWant = new Map<string, number>();
const legKey = (strike: number, right: 'C' | 'P') => `${+strike.toFixed(3)}|${right}`;
async function pullBook(key: string): Promise<void> {
  const [root, exp] = key.split('|');
  const got = await thetaCall(`/option/snapshot/quote?symbol=${encodeURIComponent(root)}&expiration=${ymd(exp)}&format=json`, true);
  if (!noteAnswer(got.error, got.status)) return;
  if (got.error) return;
  const legs = new Map<string, LegQuote>();
  for (const r of flatRows(got.data)) {
    const k = num(r.strike);
    const rw = String(r.right ?? '').toUpperCase();
    const right = rw.startsWith('C') ? 'C' : rw.startsWith('P') ? 'P' : null;
    if (!(k > 0) || !right) continue;
    legs.set(legKey(k, right), { bid: num(r.bid), ask: num(r.ask), bidSize: num(r.bid_size), askSize: num(r.ask_size), at: stampOf(r.timestamp) });
  }
  if (!legs.size) return;
  const strikes = [...new Set([...legs.keys()].map(k => Number(k.split('|')[0])))].sort((a, b) => a - b);
  const b: Book = { legs, strikes, takenAt: Date.now() };
  books.set(key, b);
  keep(`theta:paper:book|${key}`, 200, { legs: [...legs.entries()], strikes, takenAt: b.takenAt });
  emit();
}
/** An expiry's quotes now (or the kept ones, marked so) — null until they land */
export function bookOf(ticker: string, expiry: string): Book | null {
  const key = `${optionRootOf(ticker)}|${expiry}`;
  want(bookWant, key);
  return books.get(key) ?? null;
}
/** One leg's quote, and how old the read is */
export function legQuoteOf(ticker: string, expiry: string, strike: number, right: 'C' | 'P'): (LegQuote & { takenAt: number; kept: boolean }) | null {
  const b = bookOf(ticker, expiry);
  const q = b?.legs.get(legKey(strike, right));
  return b && q ? { ...q, takenAt: b.takenAt, kept: !!b.kept } : null;
}

/* ---- the beat ---- */
const hydrated = new Set<string>();
async function hydrate(key: string, put: (v: unknown) => void): Promise<void> {
  if (hydrated.has(key)) return;
  hydrated.add(key);
  const s = await readSaved(key);
  if (s?.data != null) {
    put(s.data);
    emit();
  }
}
function want(map: Map<string, number>, key: string): void {
  if (typeof window === 'undefined') return;
  const first = !map.has(key);
  map.set(key, Date.now());
  if (!first) return;
  /* a first want paints what this browser kept, then asks at once */
  if (map === nameWant) void hydrate(`theta:paper:name|${key}`, v => !names.has(key) && names.set(key, { ...(v as NameQuote), kept: true }));
  if (map === bookWant)
    void hydrate(`theta:paper:book|${key}`, v => {
      if (books.has(key)) return;
      const x = v as { legs: [string, LegQuote][]; strikes: number[]; takenAt: number };
      books.set(key, { legs: new Map(x.legs), strikes: x.strikes, takenAt: x.takenAt, kept: true });
    });
  start();
  queueMicrotask(beat);
}
/** Does this read move now (core/session.ts)? A book (`b|ROOT|expiry`) while its root's options trade — an index's
    (SPX, XSP, VIX, RUT) through Global Trading Hours and the curb, a stock's 09:30–16:00 — and five minutes either side;
    a name's price (`n|TICKER`) in every session the stock tape trades (overnight to after hours). Outside, once a minute. */
function inSession(now: number, key: string): boolean {
  const [kind, name] = key.split('|');
  if (kind === 'n') return sessionAt(now).open;
  const product = productOf(name ?? '', true);
  return sessionAt(now, product).open || sessionAt(now + 5 * 60_000, product).open || sessionAt(now - 5 * 60_000, product).open;
}
const OUT_OF_SESSION_MS = 60_000;
const pulled = new Map<string, number>();
let busy = false;
async function beat(): Promise<void> {
  if (busy || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
  busy = true;
  try {
    const now = Date.now();
    for (const m of [nameWant, bookWant]) for (const [k, at] of m) if (now - at > WANT_MS) m.delete(k);
    const due = (k: string) => {
      if (!inSession(now, k) && now - (pulled.get(k) ?? 0) < OUT_OF_SESSION_MS) return false;
      pulled.set(k, now);
      return true;
    };
    await Promise.all([...[...nameWant.keys()].filter(k => due(`n|${k}`)).map(pullName), ...[...bookWant.keys()].filter(k => due(`b|${k}`)).map(pullBook)]);
  } finally {
    busy = false;
  }
}
let timer: ReturnType<typeof setInterval> | null = null;
function start(): void {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(() => void beat(), BEAT_MS);
  /* back from a hidden tab: ask at once rather than wait a beat */
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void beat());
}

/** Is a read fresh enough to fill on: read in the last few seconds, not a kept one — and, where the quote's own stamp is
    known (`quotedAt`, ThetaData's timestamp), quoted today, and past the day's close (16:00, 13:00 on an early close)
    only if it changed after the close (a late name's 16:15 window). A snapshot read after a 13:00 close still answers
    with the 12:59 quote, freshly read: it is frozen, and nothing fills on it. */
export function isFresh(takenAt: number, kept: boolean | undefined, now = Date.now(), quotedAt?: number): boolean {
  if (kept || now - takenAt > FRESH_MS) return false;
  if (!(quotedAt != null && quotedAt > 0)) return true;
  const day = nyAt(now).date;
  if (nyAt(quotedAt).date !== day) return false;
  const close = nyInstant(day, sessionCloseMinOn(day));
  return now <= close || quotedAt > close;
}

/* ---- the test seam ---- */
export function putName(ticker: string, q: NameQuote): void {
  names.set(ticker.toUpperCase(), q);
}
export function putBook(ticker: string, expiry: string, rows: { strike: number; right: 'C' | 'P'; bid: number; ask: number }[], takenAt: number): void {
  const legs = new Map(rows.map(r => [legKey(r.strike, r.right), { bid: r.bid, ask: r.ask, bidSize: NaN, askSize: NaN, at: takenAt }]));
  books.set(`${optionRootOf(ticker)}|${expiry}`, { legs, strikes: [...new Set(rows.map(r => r.strike))].sort((a, b) => a - b), takenAt });
}
