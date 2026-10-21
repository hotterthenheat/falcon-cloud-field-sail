/*
  One quote. Stock-state close versus the previous close.
  Nothing here reads the simulator. A name with no print yet is null.
*/

import { useEffect, useSyncExternalStore } from 'react';
import { peekChange, peekSpot, subscribeBook } from './uwBook';
import { whalesState } from './whales';

export interface LiveQuote {
  spot: number;
  changePct: number;
  at: number;
}

const TTL = 15_000;
const cache = new Map<string, LiveQuote>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(fn => fn());

const bookQuote = new Map<string, LiveQuote>();

export function peekQuote(ticker: string): LiveQuote | null {
  const t = ticker.toUpperCase();
  const spot = peekSpot(t);
  const change = peekChange(t);
  if (spot != null && change != null) {
    const prev = bookQuote.get(t);
    if (prev && prev.spot === spot && prev.changePct === change) return prev;
    const next: LiveQuote = { spot, changePct: change, at: Date.now() };
    bookQuote.set(t, next);
    return next;
  }
  return cache.get(t) ?? null;
}

export function ensureQuote(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || inflight.has(t) || typeof window === 'undefined') return;
  if (peekSpot(t) != null) return;
  const hit = cache.get(t);
  if (hit && Date.now() - hit.at < TTL) return;
  inflight.add(t);
  whalesState(t)
    .then(s => {
      const close = Number(s?.close);
      const prev = Number(s?.prev_close);
      if (!(close > 0)) return;
      cache.set(t, {
        spot: close,
        changePct: prev > 0 ? ((close - prev) / prev) * 100 : 0,
        at: Date.now(),
      });
      emit();
    })
    .catch(() => {})
    .finally(() => inflight.delete(t));
}

const none = () => () => {};
const nullSnap = () => null;

export function useLiveQuote(ticker: string | null | undefined): LiveQuote | null {
  const t = ticker ? ticker.toUpperCase() : '';
  useEffect(() => {
    if (!t) return;
    ensureQuote(t);
    const id = window.setInterval(() => ensureQuote(t), TTL);
    return () => window.clearInterval(id);
  }, [t]);
  return useSyncExternalStore(
    t
      ? fn => {
          listeners.add(fn);
          const offBook = subscribeBook(fn);
          return () => {
            listeners.delete(fn);
            offBook();
          };
        }
      : none,
    t ? () => peekQuote(t) : nullSnap,
    nullSnap,
  );
}
