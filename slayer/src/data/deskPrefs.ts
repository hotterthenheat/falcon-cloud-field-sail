/* What every desk reads by, set on Settings: the name and timeframe a desk opens on, whether alerts sound, whose clock the axes keep.
   In localStorage until the account carries them; read at first render, by the chart clock and by the bell. */

import { useSyncExternalStore } from 'react';
import type { Timeframe } from './timeframe';

export type ClockZone = 'local' | 'ny';

interface DeskPrefs {
  opensOn: {
    /** null = where you left off (the simulator's last active name) */
    ticker: string | null;
    /** null = each desk's own (Pulse 1m, the Map 15m …) */
    timeframe: Timeframe | null;
    /** null = the start page; else a rail page's path, where the landing's launch door lands (landing/pieces.tsx doorTo). */
    page: string | null;
  };
  /** the jingle when one arms, the chime when it fires */
  alertsSound: boolean;
  /** the axes' clock — New York's, or the machine's own */
  clock: ClockZone;
}

const KEY = 'slayer_desk_prefs';
const DEFAULT_DESK_PREFS: DeskPrefs = { opensOn: { ticker: null, timeframe: null, page: null }, alertsSound: true, clock: 'ny' };

let prefs: DeskPrefs = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DESK_PREFS;
    const p = JSON.parse(raw) as Partial<DeskPrefs>;
    return {
      opensOn: { ticker: p.opensOn?.ticker ?? null, timeframe: p.opensOn?.timeframe ?? null, page: typeof p.opensOn?.page === 'string' ? p.opensOn.page : null },
      alertsSound: p.alertsSound ?? true,
      /* New York's clock unless the reader chose the machine's (every time in the app is ET) */
      clock: p.clock === 'local' ? 'local' : 'ny',
    };
  } catch {
    return DEFAULT_DESK_PREFS;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A patch — `opensOn` may name only the name or only the timeframe */
type DeskPrefsPatch = Partial<Omit<DeskPrefs, 'opensOn'>> & { opensOn?: Partial<DeskPrefs['opensOn']> };
export function setDeskPrefs(patch: DeskPrefsPatch): void {
  prefs = { ...prefs, ...patch, opensOn: { ...prefs.opensOn, ...(patch.opensOn ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage off — the choice lives for the session */
  }
  listeners.forEach(fn => fn());
}

/** For code outside React — a host's first render, the chart clock, the bell */
export const readDeskPrefs = (): DeskPrefs => prefs;
export const useDeskPrefs = (): DeskPrefs => useSyncExternalStore(subscribe, readDeskPrefs, () => DEFAULT_DESK_PREFS);
