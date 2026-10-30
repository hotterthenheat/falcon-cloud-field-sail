/* The one price on the page: every box on the Map prints a name's live price, re-rendering a reader only when the figure
   moves. In the regular session it is ThetaData's last print where the page may read it (data/thetaQuote.ts). Outside
   9:30–16:00 it is the same ThetaData last trade the head prints (LivePrice), live or kept, when one exists — never the
   regular close standing in for that print. The vendor book's price is the fallback, and outside the session that
   fallback is the regular close. */

import { useRef, useSyncExternalStore } from 'react';
import { bookStatus, ensureBook, peekSpot } from '../../data/uwBook';
import { peekThetaPrice } from '../../data/thetaQuote';
import { askThetaPrice } from '../../components/gex/LivePrice';
import { thetaAllowedHere } from '../../data/theta';
import { isTradingDay } from '../../core/calendar';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { CLOSE_MIN, OPEN_MIN } from '../../data/book/tape';

/** A read every half second: one property read a name, so a new spot shows within half a second of landing */
const POLL_MS = 500;
const subs = new Map<string, Set<() => void>>();
const last = new Map<string, number | null>();
let timer = 0;

const inSession = (): boolean => {
  const m = nyMinutes();
  if (m < OPEN_MIN || m >= CLOSE_MIN) return false;
  const [y, mo, d] = nyIsoDate().split('-').map(Number);
  return isTradingDay(new Date(y, mo - 1, d));
};

/* the head's last trade (LivePrice peekThetaPrice). Outside the cash session that print is the price, even when the
   book is still marked at the regular close. In the cash session a print that is not this session's, or that disagrees
   with the book by more than a fifth, is a different listing and is not used. */
const thetaSpot = (ticker: string, book: number | null): number | null => {
  if (!thetaAllowedHere('/stock/snapshot/trade')) return null;
  /* paced by the price's own asker (LivePrice askThetaPrice), never at the half-second read */
  askThetaPrice(ticker);
  const held = peekThetaPrice(ticker);
  const px = held && held.value.price > 0 ? held.value.price : null;
  if (px == null) return null;
  if (!inSession()) return px;
  if (!held.live) return null;
  return book == null || Math.abs(px - book) <= book * 0.2 ? px : null;
};

const readSpot = (ticker: string): number | null => {
  const live = peekSpot(ticker);
  const theta = thetaSpot(ticker, live);
  if (theta != null) return theta;
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
