/* ThetaData as the Terrain's and the Weigher's real-time source: one wrapper over `thetaCall` that knows whether the
   terminal answers, lets a single probe through while it does not (data/theta.ts holds the rest back), and keeps the
   last good answer in this browser so a reload paints it, stamped with when it was taken. */

import { useSyncExternalStore } from 'react';
import { thetaCall } from './theta';
import { readSaved, save } from './uwStore';

export type ThetaAnswer = { status: number; data: unknown; error: string | null };

/* The terminal's own answers that are about the request, not the terminal: 471 permission, 472 no data, 473 bad
   parameters, 477 no such page. */
const REQUEST_FAULT = new Set([471, 472, 473, 477]);

/** The terminal cannot answer anything: down, not deployed, disconnected, or held by another session. */
const offlineError = (a: ThetaAnswer): boolean => {
  if (REQUEST_FAULT.has(a.status)) return false;
  return a.error === 'terminal_down' || a.error === 'terminal_unavailable' || a.status === 0 || a.status === 503 || a.status === 474 || a.status === 478 || a.status === 571;
};

/** A read that answered but has nothing for this request (no rows that day, a contract not listed). */
export const noData = (a: ThetaAnswer): boolean => REQUEST_FAULT.has(a.status);

let down = false;
/* Until the first answer nobody knows: callers wait on that one read rather than all failing together. */
let known = false;
let firstRead: Promise<unknown> | null = null;
let downSince = 0;
let probing = false;
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

function note(a: ThetaAnswer): void {
  const off = offlineError(a);
  known = true;
  if (off === down) return;
  down = off;
  downSince = off ? Date.now() : 0;
  emit();
}

/** One ThetaData read. While the terminal is down only one call at a time goes out; the others answer offline at once. */
export async function thetaGet(path: string, jump = false): Promise<ThetaAnswer> {
  if (!known && firstRead) await firstRead.catch(() => undefined);
  if (down && probing) return { status: 503, data: null, error: 'terminal_down' };
  const probe = down;
  if (probe) probing = true;
  try {
    const call = thetaCall(path, jump);
    if (!known && !firstRead) firstRead = call;
    const a = await call;
    note(a);
    return a;
  } finally {
    if (probe) probing = false;
  }
}

/** Whether the last ThetaData read failed because the terminal is not there. */
export const thetaDown = (): boolean => down;
export const thetaDownSince = (): number => downSince;

export function subscribeTheta(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useThetaDown(): boolean {
  return useSyncExternalStore(subscribeTheta, () => down, () => false);
}

/* ---- kept answers: the last good read, per key, in IndexedDB (data/uwStore.ts) under a `theta:` prefix ---- */

export function keepTheta(key: string, data: unknown): void {
  save(`theta:${key}`, 200, data);
}

export async function keptTheta<T>(key: string): Promise<{ at: number; data: T } | null> {
  const got = await readSaved(`theta:${key}`);
  return got ? { at: got.at, data: got.data as T } : null;
}

/** No request while the tab is hidden. */
export const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** "10:42 ET" for a stamp. */
export function etClock(at: number): string {
  if (!(at > 0)) return '';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(at));
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date());
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  return day === today ? `${time} ET` : `${day} ${time} ET`;
}

/** The line a box shows while the terminal is down. */
export const offlineWords = (takenAt: number): string =>
  takenAt > 0 ? `ThetaData offline — reconnecting · as of ${etClock(takenAt)}` : 'ThetaData offline — reconnecting';

export const thetaRev = (): number => rev;
