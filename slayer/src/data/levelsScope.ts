/*
==================================================
  SLAYER TERMINAL - WHICH CONTRACTS THE LEVELS ARE READ OFF
  (data/levelsScope.ts)

  The call wall, the put wall, the flip and the
  supreme can be read off TODAY'S contracts alone
  (0DTE — the day's walls, what the clock and the
  report have always read) or off EVERY listed date
  together (the structural levels the longer book
  holds). One choice for the whole Pinpoint desk,
  worn by its head beside the Ruler, remembered on
  this machine (the competitive audit, 2026-10-13:
  "0DTE-specific walls as distinct levels"). On the
  house's simulated book the two agree — its expiry
  lens moves magnitudes, never levels; on the feed
  they are the vendor's own rows by date.
==================================================
*/

import { useSyncExternalStore } from 'react';
import type { DropdownOption } from '../components/ui/DropdownSelect';

export type LevelsScope = '0DTE' | 'ALL';
const KEY = 'slayer_levels_scope';

const read = (): LevelsScope => {
  try {
    return localStorage.getItem(KEY) === 'ALL' ? 'ALL' : '0DTE';
  } catch {
    return '0DTE';
  }
};
let scope: LevelsScope = read();
const subs = new Set<() => void>();
let rev = 0;
const bump = () => {
  rev += 1;
  subs.forEach(fn => fn());
};

export const readLevelsScope = (): LevelsScope => scope;
export const useLevelsScope = (): LevelsScope =>
  useSyncExternalStore(
    fn => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    readLevelsScope,
    readLevelsScope
  );

/** Re-renders when any name's levels change — a parent that reads several names needs this, not one ticker's hook. */
export const useLevelsRev = (): number =>
  useSyncExternalStore(
    fn => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    () => rev,
    () => rev
  );

export const LEVELS_OPTIONS: DropdownOption<LevelsScope>[] = [
  { value: '0DTE', label: 'Today', hint: "Only contracts that expire today (the next expiry if none do) — the day's walls and flip" },
  { value: 'ALL', label: 'All expiries', hint: 'Every listed expiry added together — the bigger, slower levels' },
];

/* A NAME KEEPS ITS OWN (the desk used to force one Levels card on every name). The default above is what a name
   uses until it is set. Remembered on this machine. */
const NAME_KEY = 'slayer_levels_by_name';
const readNames = (): Record<string, LevelsScope> => {
  try {
    const raw = JSON.parse(localStorage.getItem(NAME_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, LevelsScope> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === '0DTE' || v === 'ALL') out[k.toUpperCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
};
let byName: Record<string, LevelsScope> = readNames();

export function levelsForName(ticker: string | null | undefined): LevelsScope {
  if (!ticker) return scope;
  return byName[ticker.toUpperCase()] ?? scope;
}

export function setLevelsForName(ticker: string, next: LevelsScope): void {
  const t = ticker.toUpperCase();
  if (!t || byName[t] === next) return;
  byName = { ...byName, [t]: next };
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify(byName));
  } catch {
    /* storage off — the choice lives for the session */
  }
  bump();
}

export function useNameLevels(ticker: string | null | undefined): LevelsScope {
  useLevelsScope();
  return useSyncExternalStore(
    fn => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    () => levelsForName(ticker),
    () => levelsForName(ticker)
  );
}
