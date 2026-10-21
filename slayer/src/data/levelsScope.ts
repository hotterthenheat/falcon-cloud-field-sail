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

export const readLevelsScope = (): LevelsScope => scope;
export function setLevelsScope(next: LevelsScope): void {
  if (next === scope) return;
  scope = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage off — the choice lives for the session */
  }
  subs.forEach(fn => fn());
}
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

export const LEVELS_OPTIONS: DropdownOption<LevelsScope>[] = [
  { value: '0DTE', label: 'Today', hint: "Today's contracts alone — the day's walls and flip, the ones that expire at the close" },
  { value: 'ALL', label: 'All expiries', hint: 'Every listed date together — the structural levels the longer book holds' },
];
export const LEVELS_TITLE = 'Which contracts the call wall, the put wall, the flip and the supreme are read off';
