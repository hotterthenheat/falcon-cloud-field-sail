/*
  SLAYER TERMINAL - THE SEED POOL (core/seedPool.ts)

  Noah (2026-10-10), of the Compass board: "these charts often lag behind the cards loading in for the first time and
  i dont know why." Because a name's session line is its real tape, and the tape has to be walked — ~0.5s of work a
  name — and the main thread walked it five milliseconds every twenty-four so a chart's frame never stuttered: two
  seconds a name, one name at a time, the last card's line half a minute away on a cold load.

  Now the walk runs in a few web workers at once (core/seedWorker.ts), the main thread free. A worker hands back the
  bars first — the spark draws off them within a second — then the book's snapshots in chunks small enough to take
  between frames, and the name is installed whole with the last. A browser without workers falls back to the slices.

  seedOffThread(sym) → a promise that resolves when the bars are in (the spark's moment); the rest follows.
*/

import Simulator from './simulator';
import type { SeedAsk, SeedReply } from './seedWorker';
import type { Candle, GexSnapshot } from '../types/market';

const SIZE = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4) - 1));

interface Gather {
  bars: Candle[] | null;
  snaps: GexSnapshot[];
}
const gathering = new Map<string, Gather>();
const waiting = new Map<string, Promise<void>>();
const resolvers = new Map<string, () => void>();
const queue: string[] = [];
let pool: Worker[] | null = null;
let idle: Worker[] = [];
let broken = false;

const makePool = (): Worker[] | null => {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return null;
  try {
    const ws: Worker[] = [];
    for (let i = 0; i < SIZE; i++) ws.push(new Worker(new URL('./seedWorker.ts', import.meta.url), { type: 'module' }));
    return ws;
  } catch {
    return null;
  }
};

const settle = (sym: string): void => {
  resolvers.get(sym)?.();
  resolvers.delete(sym);
  waiting.delete(sym);
  gathering.delete(sym);
};

/* a message costs the main thread ~12ms at most (a chunk of 600 snapshots deserialised), measured on a cold Pulse */
const onReply = (w: Worker, e: MessageEvent<SeedReply>): void => {
  const m = e.data;
  const g = gathering.get(m.sym);
  if (m.kind === 'failed') {
    console.warn('[seed] the worker could not walk', m.sym, m.why);
    fallback(m.sym);
    free(w);
    return;
  }
  if (!g) return;
  if (m.kind === 'bars') {
    g.bars = m.bars;
    /* the spark's moment: the bars stand in as a preview until the rest lands */
    Simulator.installPreview(m.sym, m.bars);
    resolvers.get(m.sym)?.();
    resolvers.delete(m.sym);
    return;
  }
  if (m.kind === 'snaps') {
    g.snaps.push(...m.snaps);
    return;
  }
  /* done: the name installed whole — never over one the main thread finished first */
  if (g.bars) Simulator.installHistory(m.sym, { bars: g.bars, snaps: g.snaps, prices: m.prices, currentPrice: m.currentPrice, book: m.book });
  settle(m.sym);
  free(w);
};

const free = (w: Worker): void => {
  idle.push(w);
  pump();
};

const pump = (): void => {
  if (!pool) return;
  while (idle.length && queue.length) {
    const sym = queue.shift()!;
    if (Simulator.isSeeded(sym)) {
      settle(sym);
      continue;
    }
    const w = idle.pop()!;
    w.onmessage = e => onReply(w, e);
    w.onerror = () => {
      fallback(sym);
      free(w);
    };
    gathering.set(sym, { bars: null, snaps: [] });
    const ask: SeedAsk = { sym, anchor: Simulator.historyAnchor() };
    w.postMessage(ask);
  }
};

/* ---- without workers: the slices, as before ------------------------------------------------------------------- */
const sliceQueue: string[] = [];
let slicing = false;
const slicePump = (): void => {
  const next = sliceQueue[0];
  if (!next) {
    slicing = false;
    return;
  }
  if (document.hidden) {
    window.setTimeout(slicePump, 1000);
    return;
  }
  let state: 'done' | 'pending' = 'done';
  try {
    state = Simulator.seedAsync(next, 8);
  } catch {
    /* a name the sim cannot build simply never gets a line */
  }
  if (state === 'done') {
    sliceQueue.shift();
    settle(next);
  }
  window.setTimeout(slicePump, 16);
};
const fallback = (sym: string): void => {
  gathering.delete(sym);
  if (!sliceQueue.includes(sym)) sliceQueue.push(sym);
  if (!slicing) {
    slicing = true;
    window.setTimeout(slicePump, 0);
  }
};

/** Walk a name's history off the main thread. Resolves the moment its bars are here (a spark can draw); the whole
    history follows a breath later. A name already seeded resolves at once. */
export function seedOffThread(symRaw: string): Promise<void> {
  const sym = symRaw.toUpperCase();
  if (Simulator.isSeeded(sym) || Simulator.peekCandles(sym)) return Promise.resolve();
  const open = waiting.get(sym);
  if (open) return open;
  const p = new Promise<void>(resolve => resolvers.set(sym, resolve));
  waiting.set(sym, p);
  if (!broken && !pool) {
    pool = makePool();
    if (pool) idle = [...pool];
    else broken = true;
  }
  if (pool) {
    queue.push(sym);
    pump();
  } else fallback(sym);
  return p;
}

/* the simulator's own boot seeding of the roster comes here too, once this module is loaded (main.tsx) */
Simulator.setOffThreadSeeder(sym => void seedOffThread(sym));
