/* What the mark reports (the system, never the price). Precedence: offline, alert, loading (a load past 450 ms),
   then live/closed from data/marketState.ts. */

import { useSyncExternalStore } from 'react';
import { readMarketState } from '../data/marketState';

export type MarkState = 'idle' | 'loading' | 'live' | 'closed' | 'alert' | 'offline';

/** Loads under this never show. */
const LOAD_SHOWN_MS = 450;
/** two flashes of the warning ink, then back */
const ALERT_MS = 1200;
/** how often the market's open/shut is read again while anything listens */
const CLOCK_MS = 30_000;

let marketOpen = isMarketOpen();
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let loadsShown = 0;
let alertUntil = 0;
let state: MarkState = derive();

const listeners = new Set<() => void>();
let clockTimer: number | null = null;
let alertTimer: number | null = null;

/** live while the market is open, with early closes and holidays (data/marketState.ts) */
function isMarketOpen(): boolean {
  return readMarketState().word === 'live';
}

function derive(): MarkState {
  if (!online) return 'offline';
  if (alertUntil > Date.now()) return 'alert';
  if (loadsShown > 0) return 'loading';
  return marketOpen ? 'live' : 'closed';
}

function emit(): void {
  const next = derive();
  if (next === state) return;
  state = next;
  listeners.forEach(l => l());
}

const onOnline = () => {
  online = true;
  emit();
};
const onOffline = () => {
  online = false;
  emit();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    marketOpen = isMarketOpen();
    online = navigator.onLine !== false;
    emit();
    clockTimer = window.setInterval(() => {
      marketOpen = isMarketOpen();
      emit();
    }, CLOCK_MS);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      if (clockTimer != null) window.clearInterval(clockTimer);
      clockTimer = null;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
  };
}

const getMarkState = (): MarkState => state;

/** The mark's state, for anything that draws it. */
export function useMarkState(): MarkState {
  return useSyncExternalStore(subscribe, getMarkState, getMarkState);
}

/** An alert fired: the cursor flashes the warning ink twice. */
export function flashAlert(): void {
  alertUntil = Date.now() + ALERT_MS;
  emit();
  if (alertTimer != null) window.clearTimeout(alertTimer);
  alertTimer = window.setTimeout(() => {
    alertTimer = null;
    emit();
  }, ALERT_MS + 20);
}

/** A load began. The mark says so only once it has run past 450 ms; call the returned function when it ends. */
export function beginLoad(): () => void {
  let shown = false;
  let done = false;
  const t = window.setTimeout(() => {
    if (done) return;
    shown = true;
    loadsShown += 1;
    emit();
  }, LOAD_SHOWN_MS);
  return () => {
    if (done) return;
    done = true;
    window.clearTimeout(t);
    if (shown) {
      loadsShown = Math.max(0, loadsShown - 1);
      emit();
    }
  };
}
