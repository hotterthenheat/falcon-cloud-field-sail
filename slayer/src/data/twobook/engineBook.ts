/*
  The two books in the browser, for every page (docs/TWO_BOOK.md §The Map). The browser asks the server only — one board
  per name there, shared by every viewer:
    the open-interest book   GET /api/twobook/oi?ticker=…       (src/data/twobook/model1Server.ts)
    the flow book            GET /api/tape/flowbook?ticker=…    (src/data/twobook/flowBook.ts, on the option tape)
  Each answer carries the board's cells (legs.ts); engineView.ts lays them out as the chains every page reads.

  Which names read the flow book: the flow book makes the server read a name's whole session of prints from the terminal,
  so it is asked only for the names a page focuses — the Map's names, Terrain's panes, Compare's pair (flowFocus) — the
  most recent FLOW_NAMES of them. Every other name (a Board row) stays on the open-interest book and says so.
*/

import { feedHeaders } from '../feedGate';
import { bookMode, subscribeBookMode, type BookMode } from '../bookMode';
import type { FlowBoardWire } from './flowBook';
import type { Model1Wire } from './model1';

const OI_EVERY_MS = 60_000;
/** While the open-interest board is out with its four only, it is asked again soon for the six */
const OI_ROWS_MS = 2_500;
const FLOW_EVERY_MS = 30_000;
/** A flow book still reading its prints is asked again soon */
const FLOW_READING_MS = 5_000;
const ERROR_MS = 15_000;
export const FLOW_NAMES = 6;

interface Held<T> {
  wire: T | null;
  /** when it was asked last, and answered */
  asked: number;
  at: number;
  error: string | null;
  running: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
}
const oi = new Map<string, Held<Model1Wire>>();
const flow = new Map<string, Held<FlowBoardWire>>();
const listeners = new Set<() => void>();
let rev = 0;
const changed = () => {
  rev += 1;
  for (const fn of [...listeners]) fn();
};
/** The book's store registers its emit here (no import cycle): every answer redraws the pages */
export function onEngineChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const engineRevision = (): number => rev;

/* the names that follow the toggle, most recent last */
const focus: string[] = [];
/** A page focuses a name: it follows the Map's book toggle (and its flow book is read while the toggle says so) */
export function flowFocus(ticker: string | null | undefined): void {
  const t = ticker?.trim().toUpperCase();
  if (!t) return;
  const i = focus.indexOf(t);
  if (i === focus.length - 1 && i >= 0) return;
  if (i >= 0) focus.splice(i, 1);
  focus.push(t);
  if (focus.length > FLOW_NAMES) focus.shift();
  if (bookFor(t) === 'flow') {
    askFlow(t);
    changed();
  }
}
export const followsToggle = (ticker: string): boolean => focus.includes(ticker.toUpperCase());

/* A page whose subject is the open-interest book itself holds it while it is on screen (Building: the overnight change
   of open interest, valued at each contract's open-interest-book gamma). While held, every name is drawn from the
   open-interest book whatever the toggle says, so the page and the shell around it (the head's regime and flip) show
   one book; the page says so when the toggle reads Flow (docs/OLD_PATH_AUDIT.md item 4). */
let oiHolds = 0;
/** Hold the open-interest book for every name until the returned release is called (a page's mount and unmount) */
export function holdOiBook(): () => void {
  oiHolds += 1;
  changed();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    oiHolds = Math.max(0, oiHolds - 1);
    /* the focused names' flow books are asked again once nothing holds the open-interest book */
    if (!oiHolds && bookMode() === 'flow') for (const t of focus) askFlow(t);
    changed();
  };
}
export const oiBookHeld = (): boolean => oiHolds > 0;

/** The book a name is drawn from right now: the toggle's, for a focused name; the open-interest book for any other, and
    for every name while a page holds the open-interest book */
export function bookFor(ticker: string): BookMode {
  return bookMode() === 'flow' && !oiBookHeld() && followsToggle(ticker) ? 'flow' : 'oi';
}

async function ask<T>(held: Map<string, Held<T>>, t: string, urlOf: string | ((w: T | null) => string), again: (w: T | null, error: string | null) => number): Promise<void> {
  let h = held.get(t);
  if (!h) held.set(t, (h = { wire: null, asked: 0, at: 0, error: null, running: null, timer: null }));
  if (h.running) return h.running;
  const cur = h;
  cur.asked = Date.now();
  if (cur.timer) clearTimeout(cur.timer);
  cur.timer = null;
  cur.running = (async () => {
    try {
      const auth = await feedHeaders();
      if (!auth.ok) throw new Error('not signed in for this data');
      const url = typeof urlOf === 'string' ? urlOf : urlOf(cur.wire);
      const res = await fetch(url, { headers: auth.headers, signal: AbortSignal.timeout(240_000) });
      const body = (await res.json().catch(() => null)) as (T & { error?: string; same?: boolean }) | null;
      if (!res.ok) throw new Error((body && body.error) || `status ${res.status}`);
      /* "same": the board held is still the server's (the open-interest book's version) */
      if (!(body && body.same && cur.wire)) cur.wire = body as T;
      cur.at = Date.now();
      cur.error = null;
    } catch (e) {
      cur.error = e instanceof Error ? e.message : String(e);
    } finally {
      cur.running = null;
    }
    changed();
    const wait = again(cur.wire, cur.error);
    if (wait > 0 && typeof window !== 'undefined') cur.timer = setTimeout(() => void ask(held, t, urlOf, again), wait);
  })();
  return cur.running;
}

const oiAgain = (w: Model1Wire | null, error: string | null): number => (error ? ERROR_MS : w?.phase === 'rows' ? OI_ROWS_MS : 0);
const flowAgain = (w: FlowBoardWire | null, error: string | null): number => (error ? ERROR_MS : w && w.flow.prints === 0 && !w.fault ? FLOW_READING_MS : 0);

function askFlow(t: string): void {
  const h = flow.get(t);
  if (h?.running || (h?.wire && Date.now() - h.asked < FLOW_EVERY_MS) || (h?.error && Date.now() - h.asked < ERROR_MS)) return;
  void ask(flow, t, `/api/tape/flowbook?ticker=${encodeURIComponent(t)}`, flowAgain);
}

/** A page wants a name's book (book/load.ts ensureBook): its open-interest board, and its flow book when it follows the
    toggle and the toggle says so. Re-asks when the held board is older than its cadence. */
export function wantEngine(ticker: string): void {
  if (typeof window === 'undefined' || legacyBook()) return;
  const t = ticker.trim().toUpperCase();
  if (!t) return;
  const h = oi.get(t);
  const fresh = h?.wire && Date.now() - h.asked < (h.wire.phase === 'rows' ? OI_ROWS_MS : OI_EVERY_MS);
  if (!h?.running && !fresh && !(h?.error && Date.now() - h.asked < ERROR_MS)) void ask(oi, t, w => `/api/twobook/oi?ticker=${encodeURIComponent(t)}${w?.version ? `&v=${encodeURIComponent(w.version)}` : ''}`, oiAgain);
  if (bookFor(t) === 'flow') askFlow(t);
}

/** The board a name is drawn from in a book: the wire, or why there is none yet */
export function peekBook(ticker: string, m: BookMode): { wire: Model1Wire | FlowBoardWire | null; error: string | null; loading: boolean } {
  const t = ticker.toUpperCase();
  const h = m === 'oi' ? oi.get(t) : flow.get(t);
  return { wire: h?.wire ?? null, error: h?.error ?? null, loading: !h || !!h.running };
}
/** The recorded goldens (scripts/golden/uwFixtures.ts) replay the vendor's rows through the per-date pipeline they were
    recorded with, and set this: no engine board is asked and every entry is read as loaded */
export const legacyBook = (): boolean => !!(globalThis as { SLAYER_LEGACY_BOOK?: boolean }).SLAYER_LEGACY_BOOK;

/** The engine has been asked for this name (book/load.ts ensureBook asks before it reads) — the pages' chains are its */
export const engineKnows = (ticker: string): boolean => !legacyBook() && (oi.has(ticker.toUpperCase()) || flow.has(ticker.toUpperCase()));
export const peekModel1 = (ticker: string): Model1Wire | null => oi.get(ticker.toUpperCase())?.wire ?? null;
export const peekFlowBook = (ticker: string): FlowBoardWire | null => flow.get(ticker.toUpperCase())?.wire ?? null;

/* the toggle: the focused names' flow books are asked when it turns to them, and every page redraws */
subscribeBookMode(() => {
  if (bookMode() === 'flow' && !oiBookHeld()) for (const t of focus) askFlow(t);
  changed();
});

/** Hold a board as if the server had answered it (the consistency proof, scripts/twobook-map-proof.ts) */
export function holdBoard(ticker: string, m: BookMode, wire: Model1Wire | FlowBoardWire): void {
  const t = ticker.toUpperCase();
  const held = (m === 'oi' ? oi : flow) as Map<string, Held<Model1Wire | FlowBoardWire>>;
  held.set(t, { wire, asked: Date.now(), at: Date.now(), error: null, running: null, timer: null });
  changed();
}
