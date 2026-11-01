/* TERRAIN'S VOL REGIME in the browser: one shared store, so every pane, the phone's sheet and any other reader share
   one request (server/regimeApi.mjs reads the terminal once for every viewer). One loop while anything shows it —
   every 10 s while the index feed moves (the VIX from about 03:15 ET), every minute when it does not, every 2 s while
   the server is still reading the year or the day's path. Never while the tab is hidden. */

import { useEffect, useSyncExternalStore } from 'react';
import { feedMoving } from '../core/session';
import { feedHeaders } from './feedGate';

export interface RegimeQuote {
  sym: string;
  price: number | null;
  /** The print's New York wall stamp, YYYY-MM-DDTHH:MM:SS */
  at: string | null;
  /** The year's last close (the session before the regime day) and its date */
  prev: number | null;
  prevDay: string | null;
  /** Where the print sits among the year's closes, 0–100 */
  pct: number | null;
  n: number;
  lo: number | null;
  hi: number | null;
}
export interface RegimeRatio {
  key: string;
  num: string;
  den: string;
  value: number | null;
  pct: number | null;
  n: number;
  prev: number | null;
  lo: number | null;
  hi: number | null;
  /** [minute of the New York day, ratio] through the regime day */
  path: [number, number][];
}
export interface VolRegime {
  v: number;
  at: number;
  day?: string;
  yearEnd?: string;
  asOf?: string;
  live?: boolean;
  regime?: 'contango' | 'backwardation' | 'flat' | null;
  quotes?: RegimeQuote[];
  ratios?: RegimeRatio[];
  pending?: { year: boolean; path: boolean };
  error?: string | null;
}
/** What a reader shows: the answer, or why there is none yet */
export type Read<T> = { data: T | null; error: string | null; loading: boolean };

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

async function getJson<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const auth = await feedHeaders();
    if (!auth.ok) return { data: null, error: auth.code };
    const res = await fetch(url, { headers: auth.headers });
    if (res.status === 401 || res.status === 403) return { data: null, error: 'signed_out' };
    if (!res.ok) return { data: null, error: res.status === 404 ? 'no_route' : 'terminal_down' };
    return { data: (await res.json()) as T, error: null };
  } catch {
    return { data: null, error: 'terminal_down' };
  }
}

/* ---- the regime ---- */

let vol: Read<VolRegime> = { data: null, error: null, loading: true };
const volListeners = new Set<() => void>();
let volUsers = 0;
let volTimer: ReturnType<typeof setTimeout> | null = null;
let volBusy = false;

const volGap = (): number => {
  const d = vol.data;
  if (d?.pending && (d.pending.year || d.pending.path)) return 2_000;
  if (vol.error && !d) return 30_000;
  return d?.live || feedMoving(Date.now(), 'VIX') ? 10_000 : 60_000;
};
async function volTick(): Promise<void> {
  volTimer = null;
  if (!volUsers) return;
  if (visible() && !volBusy) {
    volBusy = true;
    const got = await getJson<VolRegime>('/api/regime/vol');
    volBusy = false;
    /* a failed ask keeps the last good answer on screen, with the failure beside it */
    vol = { data: got.data && !got.data.error ? got.data : vol.data, error: got.error ?? got.data?.error ?? null, loading: false };
    volListeners.forEach(l => l());
  }
  if (volUsers && !volTimer) volTimer = setTimeout(() => void volTick(), volGap());
}
const volSubscribe = (fn: () => void) => {
  volListeners.add(fn);
  return () => {
    volListeners.delete(fn);
  };
};
const volSnapshot = () => vol;

/** The vol regime, shared by every reader on the page; the loop runs while any reader is mounted */
export function useVolRegime(): Read<VolRegime> {
  useEffect(() => {
    volUsers += 1;
    if (volUsers === 1 && !volTimer) volTimer = setTimeout(() => void volTick(), 0);
    return () => {
      volUsers -= 1;
      if (!volUsers && volTimer) {
        clearTimeout(volTimer);
        volTimer = null;
      }
    };
  }, []);
  return useSyncExternalStore(volSubscribe, volSnapshot, volSnapshot);
}

/** The page's words for a failure code — never a vendor's name */
export function regimeTrouble(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
      return null;
    case 'closed':
    case 'signed_out':
      return 'Sign in to read the market data.';
    case 'no_data':
      return 'The market data terminal has no prints for these indices.';
    case 'terminal_login':
      return 'The market data feed refused its login.';
    case 'session_lost':
      return 'The market data session is reconnecting.';
    case 'terminal_unavailable':
    case 'no_route':
      return 'This deployment has no market data terminal.';
    case 'terminal_busy':
      return 'The market data terminal is busy; asking again shortly.';
    default:
      return 'The market data terminal is not answering.';
  }
}
