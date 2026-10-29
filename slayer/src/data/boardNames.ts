/*
==================================================
  SLAYER TERMINAL - THE NAMES ON THE BOARD
  (data/boardNames.ts)

  The Board used to carry whatever the simulator
  happened to run — four names — under a caption
  that called them "every name you follow" (Noah,
  2026-09-09: "i still dont understand what it
  means"; then "i need more tickers"). Now the
  board is a list the user keeps: a dozen household
  names to start, add any listing, take any off,
  remembered in localStorage. One store, read with
  useSyncExternalStore, the distance-unit store's
  shape.
==================================================
*/

import { useSyncExternalStore } from 'react';

const KEY = 'slayer_board_names';

/** The board on first open — the index and the names everyone watches, famous first. TWENTY since 2026-10-11 (Noah, of
    the board ending two-thirds of the way down a 960px screen: "add enough ticks to fill it") — the next eight of the
    famous tier after the first twelve. */
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
        /* A DEFAULT THAT CHANGED UNDER STORED STATE (core/storedDefaults.ts's rule, kept here because this store reads
           its key the moment it loads): a stored board that is still the old dozen — the same names, any order — was
           written for the reader, not chosen; it becomes the twenty, once. A board with a name added or taken off is
           theirs and is left alone. */
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
