/* The server's tapes in the browser (data/tapeServer.ts, /api/tape/*): one store per name and kind, shared by every pane
   and every rail on the page, each asking the server — never the terminal — for what landed since its last answer.

   The pace follows the session (core/session.ts): while the name's options trade (or, for the stock tape, while the
   market's prints are still arriving) every LIVE_MS; while the server is still reading the day back every FILL_MS; once
   the day is in and nothing trades, a slow look every IDLE_MS that only notices a new session. A hidden tab asks
   nothing. */

import { useEffect, useState } from 'react';
import { feedHeaders } from './feedGate';
import { optionProductOf, sessionAt } from '../core/session';
import type { PrintType } from './printTags';
import type { OptionTapeWire, StockMarkRow, StockTapeWire, TypeMixRow, VenueRow } from './tapeServer';
import { rowOfCell, rowOfPrint, type TapeRow } from './tapeRows';

export type { TapeRow };

const LIVE_MS = 15_000;
const FILL_MS = 4_000;
const IDLE_MS = 5 * 60_000;
const TICK_MS = 2_000;

/* ---- the stores ---------------------------------------------------------------------------------------------- */

interface Common {
  day: string;
  through: number;
  open: number;
  close: number;
  complete: boolean;
  live: boolean;
  ready: boolean;
  /** Said plainly when the server could not read, or has no tapes */
  fault: string | null;
  askedAt: number;
  running: boolean;
  subs: Set<() => void>;
  timer: number | null;
  rev: number;
}
interface OptionStore extends Common {
  kind: 'options';
  name: string;
  rows: TapeRow[];
  cellN: number;
  mix: TypeMixRow[];
  oi: boolean;
}
interface StockStore extends Common {
  kind: 'stock';
  name: string;
  venues: VenueRow[];
  shares: number;
  offShares: number;
  marks: StockMarkRow[];
  delayed: boolean;
  index: boolean;
}
type Store = OptionStore | StockStore;
const stores = new Map<string, Store>();

const blank = (): Common => ({ day: '', through: 0, open: 0, close: 0, complete: false, live: false, ready: false, fault: null, askedAt: 0, running: false, subs: new Set(), timer: null, rev: 0 });
function storeOf(kind: 'options', name: string): OptionStore;
function storeOf(kind: 'stock', name: string): StockStore;
function storeOf(kind: Store['kind'], name: string): Store {
  const key = `${kind}|${name}`;
  let s = stores.get(key);
  if (!s) {
    s = kind === 'options'
      ? { ...blank(), kind, name, rows: [], cellN: 0, mix: [], oi: false }
      : { ...blank(), kind, name, venues: [], shares: 0, offShares: 0, marks: [], delayed: false, index: false };
    stores.set(key, s);
  }
  return s;
}

const notify = (s: Store) => {
  s.rev++;
  s.subs.forEach(fn => fn());
};

const FAULTS: Record<string, string> = {
  tape_hosted: 'prints are not served on this host',
  tape_down: 'the prints did not load',
  no_session: 'no session to read',
};

async function ask(s: Store): Promise<void> {
  if (s.running) return;
  s.running = true;
  s.askedAt = Date.now();
  try {
    const auth = await feedHeaders();
    if (!auth.ok) return;
    const since = s.through;
    const res = await fetch(`/api/tape/${s.kind}?ticker=${encodeURIComponent(s.name)}&since=${since}`, { headers: auth.headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      let code = '';
      try {
        code = String(((await res.json()) as { code?: string }).code ?? '');
      } catch {
        /* no body */
      }
      s.fault = FAULTS[code] ?? 'the prints did not load';
      s.ready = true;
      return;
    }
    const w = (await res.json()) as OptionTapeWire | StockTapeWire;
    /* a new session: start over */
    if (w.day !== s.day) {
      s.day = w.day;
      s.through = 0;
      if (s.kind === 'options') {
        s.rows = [];
        s.cellN = 0;
      } else s.marks = [];
      if (since !== 0) {
        s.running = false;
        await ask(s);
        return;
      }
    }
    s.open = w.open;
    s.close = w.close;
    s.complete = w.complete;
    s.live = w.live;
    s.fault = w.fault;
    if (s.kind === 'options' && w.kind === 'options') {
      if (w.prints.length || w.cells.length) {
        const add: TapeRow[] = w.prints.map(p => rowOfPrint(s.name, p));
        w.cells.forEach(c => add.push(rowOfCell(s.name, c, s.cellN++)));
        add.sort((a, b) => (a.epochMs ?? 0) - (b.epochMs ?? 0));
        s.rows = s.rows.concat(add);
      }
      s.mix = w.mix;
      s.oi = w.oi;
    } else if (s.kind === 'stock' && w.kind === 'stock') {
      if (w.marks.length) s.marks = s.marks.concat(w.marks);
      s.venues = w.venues;
      s.shares = w.shares;
      s.offShares = w.offShares;
      s.delayed = w.delayed;
      s.index = w.index;
    }
    s.through = w.through;
    s.ready = true;
  } catch {
    s.fault = 'the prints did not load';
    s.ready = true;
  } finally {
    s.running = false;
    notify(s);
  }
}

/** How long a store waits between asks: the session's pace */
function paceOf(s: Store): number {
  const product = s.kind === 'options' ? optionProductOf(s.name) : 'equity';
  const open = sessionAt(Date.now(), product).open;
  if (!s.ready) return 0;
  if (s.fault) return 30_000;
  if (!s.complete && !s.live) return FILL_MS;
  if (s.live || (open && !s.complete)) return LIVE_MS;
  return IDLE_MS;
}

function watch(s: Store, fn: () => void): () => void {
  s.subs.add(fn);
  if (!s.askedAt) void ask(s);
  if (s.timer == null) {
    s.timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - s.askedAt >= paceOf(s)) void ask(s);
    }, TICK_MS);
  }
  return () => {
    s.subs.delete(fn);
    if (!s.subs.size && s.timer != null) {
      window.clearInterval(s.timer);
      s.timer = null;
    }
  };
}

function useStore<S extends Store>(make: () => S | null): S | null {
  const [, bump] = useState(0);
  const s = make();
  useEffect(() => {
    if (!s) return;
    return watch(s, () => bump(n => n + 1));
  }, [s]);
  return s;
}

/* ---- what the panes read ------------------------------------------------------------------------------------ */

export interface OptionTapeView {
  rows: readonly TapeRow[];
  /** The session by type: premium at the ask, at the bid, with no side, contracts, prints */
  mix: readonly TypeMixRow[];
  day: string;
  /** Everything before this instant is in */
  through: number;
  open: number;
  close: number;
  complete: boolean;
  live: boolean;
  /** The interest the session opened on was read — without it no print can be told opening */
  oi: boolean;
  ready: boolean;
  fault: string | null;
  /** The server is still reading the day back */
  filling: boolean;
  rev: number;
}
const NO_ROWS: readonly TapeRow[] = [];

/** The name's option prints on the server's tape, while `enabled` */
export function useOptionTape(ticker: string, enabled: boolean): OptionTapeView {
  const name = ticker.trim().toUpperCase();
  const s = useStore(() => (enabled && name ? storeOf('options', name) : null));
  if (!s) return { rows: NO_ROWS, mix: [], day: '', through: 0, open: 0, close: 0, complete: false, live: false, oi: false, ready: !enabled, fault: null, filling: false, rev: 0 };
  return { rows: s.rows, mix: s.mix, day: s.day, through: s.through, open: s.open, close: s.close, complete: s.complete, live: s.live, oi: s.oi, ready: s.ready, fault: s.fault, filling: s.ready && !s.complete && !s.live && !s.fault, rev: s.rev };
}

export interface StockTapeView {
  venues: readonly VenueRow[];
  shares: number;
  offShares: number;
  marks: readonly StockMarkRow[];
  day: string;
  through: number;
  open: number;
  close: number;
  complete: boolean;
  live: boolean;
  /** Today's prints run fifteen minutes behind */
  delayed: boolean;
  /** An index has no stock prints */
  index: boolean;
  ready: boolean;
  fault: string | null;
  filling: boolean;
  rev: number;
}

/** The name's stock prints on the server's tape: the venue mix and the off-exchange and block marks, while `enabled` */
export function useStockTape(ticker: string, enabled: boolean): StockTapeView {
  const name = ticker.trim().toUpperCase();
  const s = useStore(() => (enabled && name ? storeOf('stock', name) : null));
  if (!s) return { venues: [], shares: 0, offShares: 0, marks: [], day: '', through: 0, open: 0, close: 0, complete: false, live: false, delayed: false, index: false, ready: !enabled, fault: null, filling: false, rev: 0 };
  return { venues: s.venues, shares: s.shares, offShares: s.offShares, marks: s.marks, day: s.day, through: s.through, open: s.open, close: s.close, complete: s.complete, live: s.live, delayed: s.delayed, index: s.index, ready: s.ready, fault: s.fault, filling: s.ready && !s.complete && !s.live && !s.fault, rev: s.rev };
}

export type { PrintType };
