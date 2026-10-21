/*
==================================================
  SLAYER TERMINAL - THE ONE PRICE ON THE PAGE
  (pages/pinpoint/useRoomSpot.ts)

  The partner's walk through the Map as a user
  (2026-10-14): the head read 455.38, the matrix's
  spot row 455.77 and the tape's Last 455.52 on one
  screen — "the first thing a newcomer checks is
  whether the numbers agree". Every box on the Map
  prints THIS now: a name's price off the simulator
  (core/simulator.ts TICKERS[t].currentPrice — the
  forming bar's close is the same figure, so the
  tape's line ends on it too), read on a short
  clock and re-rendering a reader only when the
  figure moves. His version read the room's market
  store (the feed's or the house's); ours is the
  house's alone until the feed is wired, behind the
  same two hooks, so the boxes need no change then.
==================================================
*/

import { useRef, useSyncExternalStore } from 'react';
import { bookStatus, ensureBook, peekSpot } from '../../data/uwBook';

/** The simulator ticks every 1.5s (MarketDataContext); a read every half second lands within a frame or two of the tick
    at the cost of one property read a name */
const POLL_MS = 500;
const subs = new Map<string, Set<() => void>>();
const last = new Map<string, number | null>();
let timer = 0;

const readSpot = (ticker: string): number | null => {
  const live = peekSpot(ticker);
  if (live != null) return live;
  if (bookStatus(ticker) !== 'error') ensureBook(ticker, 'board');
  return null;
};

function poll(): void {
  for (const [t, fns] of subs) {
    const v = readSpot(t);
    if (v !== last.get(t)) {
      last.set(t, v);
      fns.forEach(fn => fn());
    }
  }
}

function subscribe(ticker: string, fn: () => void): () => void {
  const t = ticker.toUpperCase();
  let set = subs.get(t);
  if (!set) {
    set = new Set();
    subs.set(t, set);
    last.set(t, readSpot(t));
  }
  set.add(fn);
  if (!timer) timer = window.setInterval(poll, POLL_MS);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) {
      subs.delete(t);
      last.delete(t);
    }
    if (subs.size === 0 && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
}

const none = () => () => {};
const nullSnap = () => null;

/** A name's price now, as every box on the page prints it — null for a name with no price yet, or while `live` is off
    (a replayed minute's book reads that minute, not the room) */
export function useRoomSpot(ticker: string | null | undefined, live = true): number | null {
  const t = live && ticker ? ticker : null;
  return useSyncExternalStore(t ? fn => subscribe(t, fn) : none, t ? () => readSpot(t) : nullSnap, nullSnap);
}

/** A READING of a name's price now, re-rendering only when the reading changes — a grid that splits its rows round the
    price wants the strike the price is under, not every cent of every tick */
export function useRoomSpotRead<T>(ticker: string, read: (spot: number | null) => T, isEqual: (a: T, b: T) => boolean = Object.is, live = true): T {
  const cache = useRef<{ v: T } | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const get = () => {
    const next = readRef.current(live ? readSpot(ticker) : null);
    if (cache.current && isEqual(cache.current.v, next)) return cache.current.v;
    cache.current = { v: next };
    return next;
  };
  return useSyncExternalStore(live ? fn => subscribe(ticker, fn) : none, get, get);
}
