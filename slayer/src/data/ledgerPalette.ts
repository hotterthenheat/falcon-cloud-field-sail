import { useSyncExternalStore } from 'react';
import type { LedgerPalette } from '../components/gex/ColoursSwitch';

/* Which ramp the matrix and calendar wear, thermal or the house's ember and glacier: a preference in Settings › Appearance, remembered on this machine. */

const KEY = 'slayer_ledger_palette';
/* Thermal by default; a house choice made in Settings is kept. */
const read = (): LedgerPalette => {
  try {
    return localStorage.getItem(KEY) === 'house' ? 'house' : 'thermal';
  } catch {
    return 'house';
  }
};
let current: LedgerPalette = read();
const subs = new Set<() => void>();

export const setLedgerPalette = (p: LedgerPalette): void => {
  current = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* storage off */
  }
  subs.forEach(f => f());
};

export const useLedgerPalette = (): LedgerPalette =>
  useSyncExternalStore(
    f => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => current
  );
