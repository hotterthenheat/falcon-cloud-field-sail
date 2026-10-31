/* The reader's backtest sessions, kept in localStorage, as a module store with a subscription. A move of the clock
   first loads the recorded days it walks (history.ts), then runs the engine over them. */

import { useSyncExternalStore } from 'react';
import { advance, amend, attach, bookOf, cancel, newSession, place, rebase, setBreakeven, setTrail, type Draft, type Moment, type Session, type SessionRules } from './engine';
import type { DayNote, JournalEntry } from './journal';
import { contractKey, longLeg, type ContractId } from './quotes';
import { barsKnown, daysBetween, ensureBars, ensureLeg, historyOffline, legKnown } from './history';

const REVIEW_KEY = 'slayer_review_v1';

/* Only sessions played on the recorded quotes are kept: one from the old synthetic tape (or a futures one) is dropped */
const isSession = (v: unknown): v is Session => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return s.tape === 'theta' && typeof s.id === 'string' && typeof s.ticker === 'string' && typeof s.startCash === 'number' && Array.isArray(s.orders) && Array.isArray(s.fills) && typeof s.cursor === 'object' && s.cursor !== null;
};
function load(): Session[] {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const all = Array.isArray(parsed) ? parsed : [];
    const kept = all.filter(isSession);
    if (kept.length !== all.length) localStorage.setItem(REVIEW_KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return [];
  }
}
let list: Session[] = typeof localStorage === 'undefined' ? [] : load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const save = () => {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(list));
  } catch {
    /* full or unavailable — the session still runs for the visit */
  }
};
/** The clock ticks four times a second while a session plays: the write is held a moment, the screen is not */
const commit = (next: Session[], now = false) => {
  list = next;
  listeners.forEach(fn => fn());
  if (typeof localStorage === 'undefined') return;
  clearTimeout(saveTimer);
  if (now) save();
  else saveTimer = setTimeout(save, 600);
};
if (typeof window !== 'undefined') window.addEventListener('beforeunload', save);

const swap = (id: string, fn: (s: Session) => Session, now = false) => commit(list.map(s => (s.id === id ? fn(s) : s)), now);
const newId = (now: number) => `s${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** `tickers`: one name or two. `rules`: the reader's own, set here and never after — a rule that can be loosened in the
    middle of a losing day is not a rule. */
export function createSession(o: { name: string; ticker: string; tickers?: string[]; rules?: SessionRules; startCash: number; fee: number; startDay: string }): Session {
  const now = Date.now();
  const s = newSession({ ...o, id: newId(now), now });
  commit([s, ...list], true);
  return s;
}
/** Run it again: a new session on the same set-up — the names, the money, the fee, the start day, the reader's
    rules — with a fresh book and the clock back at that day's open. "SPY from Jun 22" → "SPY from Jun 22 · run 2". */
export function runAgain(id: string): Session | null {
  const from = list.find(s => s.id === id);
  if (!from) return null;
  const stem = from.name.replace(/ · run \d+$/, '');
  const runs = list.filter(s => s.name === stem || s.name.startsWith(`${stem} · run `)).length;
  return createSession({ name: `${stem} · run ${runs + 1}`, ticker: from.ticker, tickers: from.tickers, rules: from.rules, startCash: from.startCash, fee: from.fee, startDay: from.startDay });
}
/** A copy of a session AS IT STANDS — the book, the working orders, the clock, the notes — to try another way from here
    while the first is kept. "SPY from Jun 22" → "SPY from Jun 22 · copy" (· copy 2, …). */
export function duplicateSession(id: string): Session | null {
  const from = list.find(s => s.id === id);
  if (!from) return null;
  const now = Date.now();
  const stem = from.name.replace(/ · copy( \d+)?$/, '');
  const taken = new Set(list.map(s => s.name));
  let name = `${stem} · copy`;
  for (let n = 2; taken.has(name) && n < 100; n++) name = `${stem} · copy ${n}`;
  const copy: Session = { ...structuredClone(from), id: newId(now), name, copiedFrom: from.id, createdAt: now, touchedAt: now };
  commit([copy, ...list], true);
  return copy;
}
export const deleteSession = (id: string) => commit(list.filter(s => s.id !== id), true);
export const renameSession = (id: string, name: string) => commit(list.map(s => (s.id === id ? { ...s, name: name.trim() || s.name } : s)), true);

/* ---- the clock: the days a move walks are loaded, then the engine runs them ---- */
export interface Moving {
  to: Moment;
  /** What is loading, said on the desk */
  words: string;
  /** The terminal did not answer: the clock stays where it is */
  failed?: string;
}
const moving = new Map<string, Moving>();
const movingHeard = new Set<() => void>();
const sayMoving = () => movingHeard.forEach(fn => fn());
/** A move the desk is waiting on (its days loading), or one that could not be made */
export const useMoving = (id: string | undefined): Moving | null =>
  useSyncExternalStore(
    fn => {
      movingHeard.add(fn);
      return () => {
        movingHeard.delete(fn);
      };
    },
    () => (id ? (moving.get(id) ?? null) : null),
    () => null
  );
/** Every leg a session holds or waits on: a spread is its two */
export function legsHeld(s: Session): ContractId[] {
  const out = new Map<string, ContractId>();
  const add = (c: ContractId) => {
    const l = longLeg(c);
    out.set(contractKey(l), l);
    if (c.short != null) out.set(contractKey({ ...l, strike: c.short }), { ...l, strike: c.short });
  };
  for (const p of bookOf(s).positions) add(p.contract);
  for (const o of s.orders) if (o.status === 'working') add(o.contract);
  return [...out.values()];
}
/** What a walk from the cursor to `to` reads: each name's bars, and every leg held or waited on, each day */
function needsOf(s: Session, to: Moment): (() => Promise<boolean>)[] {
  const legs = legsHeld(s);
  const out: (() => Promise<boolean>)[] = [];
  for (const d of daysBetween(s.cursor.day, to.day)) {
    for (const n of s.tickers?.length ? s.tickers : [s.ticker]) if (!barsKnown(n, d)) out.push(() => ensureBars(n, d));
    for (const l of legs) if (l.expiry >= d && !legKnown(l, d)) out.push(() => ensureLeg(l, d));
  }
  /* a contract the bell could not settle yet: its expiry day's close */
  for (const p of bookOf(s).positions) if (p.contract.expiry < s.cursor.day && !barsKnown(p.contract.ticker, p.contract.expiry)) out.push(() => ensureBars(p.contract.ticker, p.contract.expiry));
  return out;
}
/** Move the clock. Backward, or inside what is loaded, it is at once; otherwise the days load first (four at a time). */
export async function moveClock(id: string, to: Moment): Promise<void> {
  const s = list.find(x => x.id === id);
  if (!s) return;
  const needs = needsOf(s, to);
  /* everything it walks is here: the move is made at once (the clock playing) */
  if (!needs.length && !moving.has(id)) {
    swap(id, x => advance(x, to, Date.now()));
    return;
  }
  const days = daysBetween(s.cursor.day, to.day).length;
  moving.set(id, { to, words: days > 1 ? `Loading ${days} recorded sessions` : 'Loading the recorded quotes' });
  sayMoving();
  let i = 0;
  let missed = false;
  const lane = async () => {
    while (i < needs.length) {
      const job = needs[i++];
      if (!(await job())) missed = true;
    }
  };
  await Promise.all([lane(), lane(), lane(), lane()]);
  /* a later move asked for while this one loaded wins */
  if (moving.get(id)?.to !== to) return;
  if (missed && historyOffline()) {
    moving.set(id, { to, words: '', failed: 'Live data is offline — reconnecting. The clock stays where it is until the recorded quotes load.' });
    sayMoving();
    return;
  }
  moving.delete(id);
  sayMoving();
  swap(id, x => advance(x, to, Date.now()));
}

export const placeOrder = (id: string, d: Draft) => swap(id, s => place(s, d, Date.now()), true);
export const cancelOrder = (id: string, orderId: string) => swap(id, s => cancel(s, orderId, Date.now()), true);
export const attachBracket = (id: string, contract: ContractId, kind: 'target' | 'stop', price: number, on?: 'name') => swap(id, s => attach(s, contract, kind, price, Date.now(), on), true);
/** The same way out, waiting on the other thing — the name's price, or the contract's (engine `rebase`) */
export const rebaseOrder = (id: string, orderId: string, to: 'name' | 'contract') => swap(id, s => rebase(s, orderId, to, Date.now()), true);
export const amendOrder = (id: string, orderId: string, price: number) => swap(id, s => amend(s, orderId, price, Date.now()), true);
/** A working stop's two switches (the ladder — engine.ts): trailing is that stop's, breakeven is its whole group's */
export const trailOrder = (id: string, orderId: string, on: boolean, by?: number) => swap(id, s => setTrail(s, orderId, on, Date.now(), by), true);
export const breakevenOrder = (id: string, orderId: string, on: boolean) => swap(id, s => setBreakeven(s, orderId, on, Date.now()), true);
/** Out of a contract now: whatever is working on it goes first, then the lot is sold at the bid */
export const closePosition = (id: string, contract: ContractId, qty: number) =>
  swap(
    id,
    s => {
      const key = contractKey(contract);
      let next = s;
      for (const o of s.orders) if (o.status === 'working' && o.side === 'sell' && contractKey(o.contract) === key) next = cancel(next, o.id, Date.now());
      return place(next, { contract, side: 'sell', qty, kind: 'market' }, Date.now());
    },
    true
  );
/** The bracket on a held contract cancelled — every target and stop of its ladder — so a sell that waits can have its
    contracts (the ticket's "Cancel the bracket") */
export const cancelBracket = (id: string, contract: ContractId) =>
  swap(
    id,
    s => {
      const key = contractKey(contract);
      let next = s;
      for (const o of s.orders) if (o.status === 'working' && o.side === 'sell' && o.oco && contractKey(o.contract) === key) next = cancel(next, o.id, Date.now());
      return next;
    },
    true
  );
/** The bell's setting: carry on into the next day by itself while the clock plays */
export const setRollOver = (id: string, on: boolean) => swap(id, s => ({ ...s, rollOver: on || undefined }), true);
/** The journal's entry on a closed trade — what is given is written over what was there */
export const setEntry = (id: string, tradeId: string, patch: Partial<JournalEntry>) =>
  commit(list.map(s => (s.id === id ? { ...s, journal: { ...s.journal, [tradeId]: { ...s.journal?.[tradeId], ...patch } } } : s)), true);
/** A note on one of a session's replayed days: the plan before, the review after */
export const setDayNote = (id: string, day: string, patch: Partial<DayNote>) =>
  commit(list.map(s => (s.id === id ? { ...s, days: { ...s.days, [day]: { ...s.days?.[day], ...patch } } } : s)), true);

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => list;
/** Every session, newest first */
export const useSessions = (): Session[] => useSyncExternalStore(subscribe, snapshot, snapshot);
/** A session by its id */
export const useSession = (id: string | undefined): Session | null => useSessions().find(s => s.id === id) ?? null;
