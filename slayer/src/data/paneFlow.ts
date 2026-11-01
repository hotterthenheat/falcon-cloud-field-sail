/* The flow pane's prints: the option tape Trace reads (readTapePage — the same endpoint, the same mapping), asked for
   one name under the pane's filters, kept in one store per name and filter set so every pane on it shares one read.

   One poll a store, on the newest page, every POLL_LIVE_MS in the session and every POLL_QUIET_MS outside it; behind
   the first answer the store walks back a page at a time on the low lane (one request in flight a store, never ahead of
   a page's own reads) until the vendor's tape runs out — it holds one session — or BACK_PAGES pages are in hand. The
   prints Trace already holds for the name (its shelf) join without a request.

   On Terrain the pane reads the server's tape instead (`source: 'tape'`, data/tapeFeed.ts): the name's every print of
   the session, tagged by type and sided at the quote, read once on the server for every viewer — the same rows, the
   same filters (data/flowBuckets.ts passesFlow), no vendor page walk. */

import { useEffect, useMemo, useState } from 'react';
import type { FlowPrint } from '../types/trace';
import type { FlowFilters } from './deskPrefs';
import { readTapePage, useShelfPrints } from './traceLive';
import { marketPhase } from '../core/marketPhase';
import { flowKey, flowQuery, passesFlow } from './flowBuckets';
import { useOptionTape } from './tapeFeed';

const PAGE = 500;
const BACK_PAGES = 10;
const POLL_LIVE_MS = 10_000;
const POLL_QUIET_MS = 120_000;
/** SPX's listed tape is SPXW, and the same for NDX and RUT: the pane reads both roots */
const WEEKLY: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };

interface Store {
  name: string;
  filters: FlowFilters;
  rows: FlowPrint[];
  ids: Set<string>;
  /** per root: the oldest fill in hand (the next older page's cursor), and whether the walk back is done */
  back: Map<string, { oldest: number; done: boolean; pages: number }>;
  ready: boolean;
  fault: string | null;
  polledAt: number;
  running: boolean;
  backing: boolean;
  subs: Set<() => void>;
  timer: number | null;
  rev: number;
}
const stores = new Map<string, Store>();

const idOf = (p: FlowPrint) => p.vendorId || String(p.id);

function notify(s: Store): void {
  s.rev++;
  s.subs.forEach(fn => fn());
}

/** Merge a page into the store; returns how many were new */
function merge(s: Store, prints: FlowPrint[]): number {
  let n = 0;
  for (const p of prints) {
    const id = idOf(p);
    if (s.ids.has(id)) continue;
    s.ids.add(id);
    s.rows.push(p);
    n++;
  }
  return n;
}

function rootsOf(name: string): string[] {
  const w = WEEKLY[name];
  return w ? [w, name] : [name];
}

async function poll(s: Store): Promise<void> {
  if (s.running) return;
  s.running = true;
  let failed = 0;
  let answered = 0;
  try {
    for (const root of rootsOf(s.name)) {
      try {
        const got = await readTapePage(flowQuery(root, s.filters), {}, PAGE);
        answered++;
        merge(s, got.prints.map(p => ({ ...p, ticker: s.name })));
        const b = s.back.get(root);
        if (!b) s.back.set(root, { oldest: got.oldest, done: !got.full, pages: 1 });
      } catch {
        failed++;
      }
    }
    s.fault = !answered && failed ? 'the tape did not answer' : null;
    s.ready = true;
    s.polledAt = Date.now();
  } finally {
    s.running = false;
    notify(s);
  }
  void walkBack(s);
}

/** The older pages, one at a time on the low lane, back to the start of the vendor's session */
async function walkBack(s: Store): Promise<void> {
  if (s.backing) return;
  s.backing = true;
  try {
    for (;;) {
      if (!s.subs.size) return;
      const next = [...s.back.entries()].find(([, b]) => !b.done && b.oldest > 0 && b.pages < BACK_PAGES);
      if (!next) return;
      const [root, b] = next;
      try {
        const got = await readTapePage(flowQuery(root, s.filters), { olderThan: b.oldest }, PAGE, true);
        const fresh = merge(s, got.prints.map(p => ({ ...p, ticker: s.name })));
        b.pages++;
        /* the vendor's cursor is inclusive: a page with nothing new is the tape's end */
        if (!got.full || fresh === 0 || !(got.oldest > 0) || got.oldest >= b.oldest) b.done = true;
        else b.oldest = got.oldest;
        notify(s);
      } catch {
        b.done = true;
        return;
      }
    }
  } finally {
    s.backing = false;
  }
}

function storeFor(name: string, filters: FlowFilters): Store {
  const key = `${name}|${flowKey(filters)}`;
  let s = stores.get(key);
  if (!s) {
    s = { name, filters, rows: [], ids: new Set(), back: new Map(), ready: false, fault: null, polledAt: 0, running: false, backing: false, subs: new Set(), timer: null, rev: 0 };
    stores.set(key, s);
  }
  return s;
}

export interface PaneFlow {
  /** The prints that pass the filters, this name's */
  rows: readonly FlowPrint[];
  /** The first answer landed; empty is an answer */
  ready: boolean;
  fault: string | null;
  /** The walk back is still reading older pages */
  filling: boolean;
  /** The server's tape: the session it holds, [open, close) in ms — the caption's figure is that session's */
  span?: { from: number; to: number };
}

const EMPTY: readonly FlowPrint[] = [];

/** Where the pane's prints come from: the vendor's tape (Trace's), or the server's tape (Terrain's) */
export type PaneFlowSource = 'vendor' | 'tape';

/** The flow pane's prints for one name under one filter set, live while `enabled` */
export function usePaneFlow(ticker: string, filters: FlowFilters, enabledFor: boolean, source: PaneFlowSource = 'vendor'): PaneFlow {
  const name = ticker.trim().toUpperCase();
  const fkey = flowKey(filters);
  const tape = useOptionTape(name, enabledFor && source === 'tape');
  const tapeRows = useMemo(
    () => (source === 'tape' ? tape.rows.filter(p => passesFlow(p, filters)) : EMPTY),
    // `rev` stands for the store's rows; the filters are the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, tape.rev, tape.rows, fkey],
  );
  const enabled = enabledFor && source === 'vendor';
  const [, bump] = useState(0);
  const shelf = useShelfPrints(enabled ? name : null);
  useEffect(() => {
    if (!enabled || !name) return;
    const s = storeFor(name, filters);
    const fn = () => bump(n => n + 1);
    s.subs.add(fn);
    const due = () => {
      const ph = marketPhase();
      const every = ph === 'regular' || ph === 'late' ? POLL_LIVE_MS : POLL_QUIET_MS;
      return !s.running && Date.now() - s.polledAt >= every - 250;
    };
    if (due()) void poll(s);
    else void walkBack(s);
    if (s.timer == null) {
      s.timer = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (due()) void poll(s);
      }, 2_500);
    }
    return () => {
      s.subs.delete(fn);
      if (!s.subs.size && s.timer != null) {
        window.clearInterval(s.timer);
        s.timer = null;
      }
    };
    // the filters are the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, fkey, enabled]);
  const s = enabled && name ? stores.get(`${name}|${fkey}`) : undefined;
  const rev = s?.rev ?? 0;
  const rows = useMemo(() => {
    if (!s) return EMPTY;
    const mine = s.rows;
    const extra = shelf.filter(p => !s.ids.has(idOf(p)) && passesFlow(p, filters));
    return extra.length ? [...mine, ...extra] : mine.slice();
    // `rev` stands for the store's rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, rev, shelf, fkey]);
  if (source === 'tape') return { rows: tapeRows, ready: tape.ready, fault: tape.fault, filling: tape.filling, span: tape.open > 0 ? { from: tape.open, to: tape.close } : undefined };
  if (!s) return { rows: EMPTY, ready: !enabled, fault: null, filling: false };
  return { rows, ready: s.ready, fault: s.fault, filling: s.backing };
}
