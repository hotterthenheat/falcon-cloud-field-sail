/*
  SLAYER TERMINAL - THE SEED WORKER (core/seedWorker.ts)

  One worker of the pool (core/seedPool.ts): asked for a name and the clock to land it on, it walks the name's whole
  history with the simulator's own code, whole and at full speed, and hands it back in pieces the main thread can take
  without a long frame — the bars first (a spark draws off them at once), then the book's snapshots a few hundred at a
  time, then the rest with the last chunk. It forgets the name once sent; the main thread keeps the only copy.
*/

import Simulator from './simulator';
import type { Candle, GexSnapshot } from '../types/market';

export type SeedAsk = { sym: string; anchor: number };
export type SeedReply =
  | { kind: 'bars'; sym: string; bars: Candle[] }
  | { kind: 'snaps'; sym: string; part: number; of: number; snaps: GexSnapshot[] }
  | { kind: 'done'; sym: string; prices: number[]; currentPrice: number; book: [number, number, number][] }
  | { kind: 'failed'; sym: string; why: string };

const CHUNK = 600;
const post = (m: SeedReply): void => (globalThis as unknown as { postMessage: (m: SeedReply) => void }).postMessage(m);

addEventListener('message', (e: MessageEvent<SeedAsk>) => {
  const { sym, anchor } = e.data;
  try {
    const h = Simulator.buildHistory(sym, anchor);
    post({ kind: 'bars', sym, bars: h.bars });
    const of = Math.max(1, Math.ceil(h.snaps.length / CHUNK));
    for (let i = 0; i < of; i++) post({ kind: 'snaps', sym, part: i, of, snaps: h.snaps.slice(i * CHUNK, (i + 1) * CHUNK) });
    post({ kind: 'done', sym, prices: h.prices, currentPrice: h.currentPrice, book: h.book });
  } catch (err) {
    post({ kind: 'failed', sym, why: (err as Error)?.message ?? String(err) });
  }
});
