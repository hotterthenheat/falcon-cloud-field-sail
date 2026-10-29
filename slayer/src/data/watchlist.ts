/* The watched contracts, kept on this machine (`slayer_watchlist_v2`) and carried by the account when signed in
   (data/sync.ts). A row is marked at its live vendor quote (weigherChain): the mid of a two-sided NBBO, else the
   last print; with no quote yet the mark is blank, never a model price. */

import { useSyncExternalStore } from 'react';
import { isoDate, sessionsBetween, today } from '../core/calendar';
import { now } from '../core/clock';
import { estimatePremium } from './compass';
import { contractIvFor } from './weigherDesk';
import { ensureMarks, liveSpotOf, peekMark, subscribeMarks } from './weigherChain';
import type { OptionRight } from '../types/compass';
import type { WatchRequest, WatchedContract } from '../types/watchlist';

/** v2: the store's key moved once so the desk opened on a clean list for the walk */
export const WATCHLIST_KEY = 'slayer_watchlist_v2';

/* ---- storage ------------------------------------------------------------------- */

function isValid(w: unknown): w is WatchedContract {
  if (typeof w !== 'object' || w === null) return false;
  const s = w as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.ticker === 'string' &&
    typeof s.strike === 'number' &&
    (s.right === 'C' || s.right === 'P') &&
    typeof s.expiry === 'string' &&
    typeof s.addedAt === 'number' &&
    typeof s.addedMark === 'number' &&
    typeof s.addedSpot === 'number' &&
    typeof s.size === 'number' &&
    (s.status === 'open' || s.status === 'closed' || s.status === 'expired') &&
    Array.isArray(s.marks)
  );
}

function load(): WatchedContract[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function save(list: WatchedContract[]): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    /* full or unavailable — the page still works for the session */
  }
}

let list: WatchedContract[] = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
const commit = (next: WatchedContract[]) => {
  list = next;
  save(next);
  emit();
};

/* ---- pricing --------------------------------------------------------------------- */

/** Years to the expiry's session, floored at half a session — a listed contract has at least that (the Weigher's floor) */
export function yearsToExpiry(expiry: string, from: Date = today()): number {
  const sessions = sessionsBetween(from, new Date(`${expiry}T12:00:00`));
  return Math.max(sessions, 0.5) / 252;
}

/** The underlying's live price, or NaN until it lands */
export function spotOf(ticker: string): number {
  return liveSpotOf(ticker) ?? NaN;
}

/** The contract's live mark (NBBO mid, else last print), or NaN until its quote lands */
export function markOf(w: Pick<WatchedContract, 'ticker' | 'strike' | 'right' | 'expiry'>): number {
  void ensureMarks(w.ticker, w.expiry);
  const m = peekMark(w.ticker, w.expiry, w.strike, w.right);
  return m && m.mark > 0 ? Number(m.mark.toFixed(2)) : NaN;
}

/** What the contract is worth at the bell — intrinsic, nothing else */
export function intrinsicOf(strike: number, right: OptionRight, spot: number): number {
  return Number(Math.max(0, right === 'C' ? spot - strike : strike - spot).toFixed(2));
}

/** The contract's value at a spot on a date — the what-if's pricer, the same one */
export function valueAt(w: Pick<WatchedContract, 'ticker' | 'strike' | 'right'>, spot: number, tYears: number): number {
  if (tYears <= 0) return intrinsicOf(w.strike, w.right, spot);
  const iv = contractIvFor(w.ticker, w.strike, w.right);
  return Number(estimatePremium(spot, w.strike, w.right, iv, tYears).toFixed(2));
}

/* ---- the returns ------------------------------------------------------------------ */

export interface WatchReturns {
  /** The mark the row shows: priced live while open, the close once settled */
  mark: number;
  /** Yesterday's close of the mark, or the cost if added today */
  prevClose: number;
  todayDollars: number;
  todayR: number;
  totalDollars: number;
  totalR: number;
  /** The contract's own breakeven — the strike ± the cost */
  breakeven: number;
  /** Spot's distance to the breakeven, signed percent of spot */
  toBreakevenPct: number;
  spot: number;
  /** Sessions left to the expiry; 0 on the day */
  dte: number;
}

export function returnsOf(w: WatchedContract, spot = spotOf(w.ticker)): WatchReturns {
  const open = w.status === 'open';
  const mark = open ? markOf(w) : (w.closedMark ?? w.addedMark);
  const todayKey = isoDate(today());
  const before = [...w.marks].filter(m => m.day < todayKey).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  const prevClose = before ? before.close : w.addedMark;
  const risk = Math.max(0.01, w.addedMark);
  const per = 100 * w.size;
  const breakeven = Number((w.right === 'C' ? w.strike + w.addedMark : w.strike - w.addedMark).toFixed(2));
  return {
    mark,
    prevClose,
    todayDollars: Number(((mark - prevClose) * per).toFixed(2)),
    todayR: (mark - prevClose) / risk,
    totalDollars: Number(((mark - w.addedMark) * per).toFixed(2)),
    totalR: (mark - w.addedMark) / risk,
    breakeven,
    toBreakevenPct: ((breakeven - spot) / spot) * 100,
    spot,
    dte: sessionsBetween(today(), new Date(`${w.expiry}T12:00:00`)),
  };
}

/** The record — the Tracker's own line: settled · hit · R */
export function recordOf(rows: WatchedContract[]): { settled: number; hit: number; r: number } {
  const done = rows.filter(w => w.status !== 'open');
  let hit = 0;
  let r = 0;
  for (const w of done) {
    const close = w.closedMark ?? w.addedMark;
    const rr = (close - w.addedMark) / Math.max(0.01, w.addedMark);
    if (close > w.addedMark) hit += 1;
    r += rr;
  }
  return { settled: done.length, hit, r };
}

/* ---- the store's doors ------------------------------------------------------------ */

/** Watch a contract at the live quote. A model price is not a mark. Returns null when there is no quote. */
export function addToWatchlist(req: WatchRequest): WatchedContract | null {
  const same = list.find(w => w.status === 'open' && w.ticker === req.ticker && w.strike === req.strike && w.right === req.right && w.expiry === req.expiry);
  if (same) return same;
  const addedMark = req.mark != null && req.mark > 0 ? Number(req.mark.toFixed(2)) : null;
  if (addedMark == null) return null;
  const spot = req.spot != null && req.spot > 0 ? req.spot : 0;
  const at = now().getTime();
  const row: WatchedContract = {
    id: `${req.ticker}-${req.strike}-${req.right}-${req.expiry}-${at}`,
    ticker: req.ticker,
    strike: req.strike,
    right: req.right,
    expiry: req.expiry,
    addedAt: at,
    addedMark,
    addedSpot: spot,
    size: Math.max(1, Math.round(req.size ?? 1)),
    status: 'open',
    marks: [{ day: isoDate(today()), close: addedMark }],
  };
  commit([row, ...list]);
  return row;
}

/** A mark that came from the estimator, not a quote, is replaced by the live quote. Once. */
export function restampWatch(id: string, live: number, spot: number): void {
  const w = list.find(x => x.id === id);
  if (!w || w.status !== 'open' || !(live > 0)) return;
  const model = markOf(w);
  const addedToday = isoDate(new Date(w.addedAt)) === isoDate(today());
  const modelish = Math.abs(w.addedMark - model) <= 0.02;
  const bogus = addedToday && w.addedMark < 1 && live > w.addedMark * 8;
  if (!modelish && !bogus) return;
  if (Math.abs(live - w.addedMark) < 0.05) return;
  const quote = Number(live.toFixed(2));
  const day = isoDate(today());
  commit(list.map(x => (x.id === id
    ? {
        ...x,
        addedMark: quote,
        addedSpot: spot > 0 ? spot : x.addedSpot,
        marks: x.marks.map(m => (m.day === day && Math.abs(m.close - model) < 0.02 ? { ...m, close: quote } : m)),
      }
    : x)));
}

/** Anything open on the list? — the Weigher's list card opens on the watchlist when there is */
export function hasOpenWatched(): boolean {
  return list.some(w => w.status === 'open');
}

/** The open row for this contract, else its latest settled one, else null */
export function watchedFor(req: Pick<WatchRequest, 'ticker' | 'strike' | 'right' | 'expiry'>): WatchedContract | null {
  const same = list.filter(w => w.ticker === req.ticker && w.strike === req.strike && w.right === req.right && w.expiry === req.expiry);
  return same.find(w => w.status === 'open') ?? same.sort((a, b) => b.addedAt - a.addedAt)[0] ?? null;
}

/** Close at the mark now — the return locks */
export function closeWatched(id: string): void {
  const w = list.find(x => x.id === id);
  if (!w || w.status !== 'open') return;
  const mark = markOf(w);
  /* a close needs a live mark to lock at */
  if (!(mark > 0)) return;
  commit(list.map(x => (x.id === id ? { ...x, status: 'closed', closedAt: now().getTime(), closedMark: mark } : x)));
}

/** Take it off the list altogether — the record forgets it */
export function removeWatched(id: string): void {
  commit(list.filter(x => x.id !== id));
}

export function setWatchedSize(id: string, size: number): void {
  commit(list.map(x => (x.id === id ? { ...x, size: Math.max(1, Math.round(size)) } : x)));
}

/** The housekeeping a page runs on its beat: today's close on every open row (one entry per session, the last live
    mark of the day), and the bell — a contract past its expiry settles at intrinsic against the live price. A row
    with no live mark or price yet is left as it is. */
export function tickWatchlist(): void {
  const todayKey = isoDate(today());
  let changed = false;
  let touched = false;
  const next = list.map(w => {
    if (w.status !== 'open') return w;
    if (w.expiry < todayKey) {
      const spot = spotOf(w.ticker);
      if (!(spot > 0)) return w;
      changed = true;
      return { ...w, status: 'expired' as const, closedAt: now().getTime(), closedMark: intrinsicOf(w.strike, w.right, spot) };
    }
    const mark = markOf(w);
    if (!(mark > 0)) return w;
    const last = w.marks[w.marks.length - 1];
    if (!last || last.day !== todayKey) {
      changed = true;
      return { ...w, marks: [...w.marks, { day: todayKey, close: mark }] };
    }
    if (last.close !== mark) {
      touched = true;
      last.close = mark; // in place — today's close moves with the tape, persisted with the next write
    }
    return w;
  });
  if (changed) commit(next);
  else if (touched) emit();
}

/* a landed quote re-renders every list that shows the rows */
subscribeMarks(() => {
  if (!list.length) return;
  list = list.slice();
  emit();
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => save(list));
}

/* ---- the subscription ------------------------------------------------------------- */

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const snapshot = () => list;

/** The list, live — every page that watches or shows it */
export function useWatchlist(): WatchedContract[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
