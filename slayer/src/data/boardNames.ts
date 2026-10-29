/* The Board's names: a list the reader keeps (a default set, add any listing, take any off) in localStorage, one useSyncExternalStore store. */

import { useSyncExternalStore } from 'react';

const KEY = 'slayer_board_names';

/** The board on first open: the index and the most-watched names, famous first. */
export const DEFAULT_BOARD_NAMES = ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX', 'AVGO', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'HOOD', 'MU', 'TSM'];
/** the board as it was first written for everyone — a stored board that still equals it is a default, not a choice */
const OLD_DEFAULT = ['SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX'];
const TWENTY_FLAG = 'slayer_board_names_twenty_v1';

const clean = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().toUpperCase();
    if (/^[A-Z.\-]{1,6}$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.length ? out : null;
};

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const names = clean(JSON.parse(raw));
      if (names) {
        /* A stored board still equal to the old default dozen (any order) was written for the reader, so it becomes the new default once;
           an edited board is left alone (core/storedDefaults.ts's rule). */
        if (!localStorage.getItem(TWENTY_FLAG)) {
          localStorage.setItem(TWENTY_FLAG, '1');
          const same = names.length === OLD_DEFAULT.length && OLD_DEFAULT.every(n => names.includes(n));
          if (same) {
            const next = [...DEFAULT_BOARD_NAMES];
            localStorage.setItem(KEY, JSON.stringify(next));
            return next;
          }
        }
        return names;
      }
    }
  } catch {
    /* no storage, or a bad entry — the default board */
  }
  return [...DEFAULT_BOARD_NAMES];
}

let current: string[] = load();
const listeners = new Set<() => void>();

const commit = (next: string[]) => {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage may be off — the list still lives for the session */
  }
  for (const l of listeners) l();
};

function getBoardNames(): string[] {
  return current;
}

/** Add a listing to the board; already there = no change */
export function addBoardName(symbol: string): void {
  const s = symbol.trim().toUpperCase();
  if (!s || current.includes(s)) return;
  commit([...current, s]);
}

/** Take a name off the board — the last one stays, a board of nothing says nothing */
export function removeBoardName(symbol: string): void {
  const s = symbol.trim().toUpperCase();
  if (!current.includes(s) || current.length <= 1) return;
  commit(current.filter(t => t !== s));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useBoardNames(): string[] {
  return useSyncExternalStore(subscribe, getBoardNames, getBoardNames);
}
