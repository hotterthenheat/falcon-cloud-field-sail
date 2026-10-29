/* WHICH JOURNAL the page is on, as the address says it, and the register of the journals this browser has seen — so a
   paper account or a backtest session deleted since still has a name and a last count when a kept link names it.

   A journal is a book and, inside it, one container or all of them:
     ?journal=paper:<accountId>     one paper account
     ?journal=backtest:<sessionId>  one backtest session
     ?journal=backtest              every backtest session
     ?journal=manual:<id>           one journal of the reader's own entries
     ?journal=manual                every journal of their own, added up
     (none)                         every paper account
   An older address (`?book=backtest&session=<id>`) reads as the same journal. */

import { useSyncExternalStore } from 'react';

export type JournalBook = 'paper' | 'backtest' | 'manual';
export interface JournalPick {
  book: JournalBook;
  /** One container, or null for every one in the book */
  id: string | null;
}
export const PICK_AT_REST: JournalPick = { book: 'paper', id: null };

const PICK = /^(paper|backtest|manual)(?::(.+))?$/;

/** The journal an address names */
export function pickOf(search: string): JournalPick {
  const q = new URLSearchParams(search);
  const j = q.get('journal');
  if (j) {
    const m = PICK.exec(j);
    if (m) return { book: m[1] as JournalBook, id: m[2] || null };
  }
  return { book: q.get('book') === 'backtest' ? 'backtest' : 'paper', id: q.get('session') || null };
}
/** The address's word for a journal — nothing for the one at rest */
export const pickParam = (p: JournalPick): string | null => (p.book === 'paper' && !p.id ? null : p.id ? `${p.book}:${p.id}` : p.book);
export const samePick = (a: JournalPick, b: JournalPick): boolean => a.book === b.book && a.id === b.id;
/** The address with this journal in it — the older words (`book`, `session`) and any `drop` keys taken out */
export function searchWithPick(search: string, p: JournalPick, drop: readonly string[] = []): string {
  const q = new URLSearchParams(search);
  q.delete('book');
  q.delete('session');
  for (const k of drop) q.delete(k);
  const v = pickParam(p);
  if (v) q.set('journal', v);
  else q.delete('journal');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/* ---- the register of journals seen ---- */
export interface SeenJournal {
  name: string;
  /** Closed trades when last seen, and what they made */
  n: number;
  net: number;
  /** When it was last seen (ms) */
  at: number;
}
type SeenBook = 'paper' | 'backtest';
export type Seen = Record<SeenBook, Record<string, SeenJournal>>;
const SEEN_KEY = 'slayer_journal_seen_v1';
const EMPTY: Seen = { paper: {}, backtest: {} };

const cleanBook = (v: unknown): Record<string, SeenJournal> => {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, SeenJournal> = {};
  for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
    const s = x as Partial<SeenJournal> | null;
    if (s && typeof s.name === 'string' && typeof s.n === 'number' && typeof s.net === 'number' && typeof s.at === 'number') out[id] = { name: s.name, n: s.n, net: s.net, at: s.at };
  }
  return out;
};
function loadSeen(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Partial<Seen> | null;
    return raw ? { paper: cleanBook(raw.paper), backtest: cleanBook(raw.backtest) } : EMPTY;
  } catch {
    return EMPTY;
  }
}
let seen: Seen = typeof localStorage === 'undefined' ? EMPTY : loadSeen();
const seenListeners = new Set<() => void>();

/** What the register would hold after seeing these containers now — the same object when nothing changed */
export function seenAfter(prev: Seen, book: SeenBook, now: { id: string; name: string; n: number; net: number }[], at: number): Seen {
  let changed = false;
  const next = { ...prev[book] };
  for (const c of now) {
    const was = next[c.id];
    if (was && was.name === c.name && was.n === c.n && Math.abs(was.net - c.net) < 0.005) continue;
    next[c.id] = { name: c.name, n: c.n, net: Math.round(c.net * 100) / 100, at };
    changed = true;
  }
  return changed ? { ...prev, [book]: next } : prev;
}
/** Write down the containers a book holds now (an effect of the page; a no-op when nothing moved) */
export function noteSeen(book: SeenBook, now: { id: string; name: string; n: number; net: number }[]): void {
  const next = seenAfter(seen, book, now, Date.now());
  if (next === seen) return;
  seen = next;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage off: the register lasts the visit */
  }
  seenListeners.forEach(fn => fn());
}
export const useSeen = (): Seen =>
  useSyncExternalStore(
    fn => {
      seenListeners.add(fn);
      return () => seenListeners.delete(fn);
    },
    () => seen,
    () => EMPTY
  );
/** The ones seen before and not there now — deleted on their own page since */
export const goneOf = (s: Seen, book: SeenBook, present: readonly { id: string }[]): ({ id: string } & SeenJournal)[] => {
  const here = new Set(present.map(c => c.id));
  return Object.entries(s[book])
    .filter(([id]) => !here.has(id))
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.at - a.at);
};
