/* The Dossier's stores share this: a value with its listeners, one clock that refreshes what a page shows (never while
   the tab is hidden, and as often as the session moves), a cap on the books kept per name, and a first paint off the
   answers this browser kept (uwSwr's store). */

import { useSyncExternalStore } from 'react';
import { isTradingDay, today as nyToday } from '../core/calendar';
import { nyCloseMin, nyMinutes, SESSION_OPEN_MIN } from '../core/nyTime';
import { uwCall, uwKept } from './whales';
const NY_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/* ---- reads -------------------------------------------------------------------- */

/** `at`/`held`: when the server's hub took the answer from the vendor, and whether it is serving it past its normal life
    (data/whales.ts UwAnswer); a reader showing `held` answers should say "as of" `at`. */
export type Answer = { status: number; data: unknown; error: string | null; at?: number | null; held?: boolean };
/** One GET by path: the vendor through the proxy, or the kept answers */
export type Get = (path: string, priority?: boolean) => Promise<Answer>;
export const liveGet: Get = (path, priority) => uwCall(path, priority);

/** A read over the answers this browser kept. `at` is the oldest instant among the answers it handed out. */
export interface KeptRead {
  get: Get;
  at: number | null;
}
export function keptRead(): KeptRead {
  const r: KeptRead = {
    at: null,
    get: async path => {
      const k = await uwKept(path);
      if (!k || k.data == null) return { status: 0, data: null, error: 'not kept' };
      r.at = r.at == null ? k.at : Math.min(r.at, k.at);
      return { status: k.status, data: k.data, error: null };
    },
  };
  return r;
}
/** The body of an answer, or a throw with the vendor's message */
export async function body<T>(get: Get, path: string, priority = false): Promise<T> {
  const got = await get(path, priority);
  if (got.error) throw new Error(got.error);
  return got.data as T;
}

/* ---- a store ------------------------------------------------------------------- */

export interface Store<S> {
  get(): S;
  /** Replace the value (or derive it from the last) and tell every reader */
  set(next: S | ((prev: S) => S)): void;
  /** Tell every reader without a new value (a side map changed) */
  notify(): void;
  subscribe(fn: () => void): () => void;
  /** How many readers are on the page */
  readers(): number;
}
export function createStore<S>(initial: S): Store<S> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (p: S) => S)(value) : next;
      listeners.forEach(fn => fn());
    },
    notify: () => listeners.forEach(fn => fn()),
    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) refreshDue();
      return () => listeners.delete(fn);
    },
    readers: () => listeners.size,
  };
}
/** A store's value in a component; `start` runs when the first reader mounts */
export function useStore<S, T = S>(store: Store<S>, pick: (s: S) => T = s => s as unknown as T, start?: () => void): T {
  return useSyncExternalStore(
    fn => {
      const off = store.subscribe(fn);
      start?.();
      return off;
    },
    () => pick(store.get()),
    () => pick(store.get()),
  );
}

export { BoundedMap } from './boundedMap';

/* ---- the session and the clock ---------------------------------------------------- */

export type Session = 'open' | 'extended' | 'closed';
/** Where New York's session stands: the regular hours, the pre-market and evening (04:00–20:00), or shut */
export function sessionNow(at: number = Date.now()): Session {
  if (!isTradingDay(nyToday())) return 'closed';
  const m = nyMinutes(at);
  if (m >= SESSION_OPEN_MIN && m < nyCloseMin(at)) return 'open';
  return m >= 4 * 60 && m < 20 * 60 ? 'extended' : 'closed';
}

/** How often a book is read again: in the session, around it, and when the market is shut (null: not again) */
export interface Cadence {
  open: number;
  extended: number | null;
  closed: number | null;
}
interface Job {
  cadence: Cadence;
  run: () => unknown;
  /** True while a page shows the book */
  shown: () => boolean;
  at: number;
}
const jobs = new Map<string, Job>();
let ticking = false;
const hidden = () => typeof document !== 'undefined' && document.hidden;
function due(j: Job, now: number): boolean {
  const ms = j.cadence[sessionNow(now)];
  return ms != null && now - j.at >= ms;
}
/** Run every shown book whose time has come; nothing while the tab is hidden */
export function refreshDue(): void {
  if (hidden()) return;
  const now = Date.now();
  for (const j of jobs.values()) {
    if (!j.shown() || !due(j, now)) continue;
    j.at = now;
    void j.run();
  }
}
/** Read a book now and again on its cadence while it is shown. Registering a key twice does nothing. */
export function keepFresh(key: string, cadence: Cadence, run: () => unknown, shown: () => boolean): void {
  if (jobs.has(key) || typeof window === 'undefined') return;
  jobs.set(key, { cadence, run, shown, at: Date.now() });
  void run();
  if (ticking) return;
  ticking = true;
  window.setInterval(refreshDue, 10_000);
  document.addEventListener('visibilitychange', refreshDue);
}
/** Forget a book's schedule (its key can be registered again) */
export function dropFresh(key: string): void {
  jobs.delete(key);
}

/* ---- kept, then live ------------------------------------------------------------- */

/** The instant a kept paint stands for, said as New York's clock ("10:42 ET"), or a date when it is not today */
export function keptWords(at: number): string {
  const day = (ms: number) => NY_DAY_FMT.format(new Date(ms));
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  if (day(at) === day(Date.now())) return `${time} ET`;
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(at));
  return `${date}, ${time} ET`;
}
