/*
  Loads the factual SPX book once. Terrain is the only desk that reads it.
  Other names are not invented from the simulator.
*/

import { useSyncExternalStore } from 'react';
import { barsForRead, buildRead, flowBuckets, railForExpiry, type FlowBucket, type RawBook, type SpxRail, type SpxRead } from './spxFacts';
import type { Candle } from '../types/market';

let read: SpxRead | null = null;
let failed = false;
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(fn => fn());
}

export function ensureSpxBook(): void {
  if (started || typeof fetch !== 'function') return;
  started = true;
  void fetch('/books/spx.json')
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<RawBook>;
    })
    .then(raw => {
      read = buildRead(raw);
      emit();
    })
    .catch(() => {
      failed = true;
      emit();
    });
}

export function spxRead(): SpxRead | null {
  return read;
}

export function spxBookFailed(): boolean {
  return failed;
}

export function subscribeSpx(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSpxBook(): SpxRead | null {
  ensureSpxBook();
  return useSyncExternalStore(subscribeSpx, () => read);
}

export function spxBars(mins: number): Candle[] {
  const book = read;
  if (!book) return [];
  return barsForRead(book, mins);
}

export function spxFlow(barSec: number): FlowBucket[] | null {
  const book = read;
  if (!book || book.flowMinutes.length === 0) return null;
  return flowBuckets(book, barSec);
}

export function spxRail(expiration: string | null): SpxRail | null {
  const book = read;
  if (!book) return null;
  return railForExpiry(book, expiration);
}
