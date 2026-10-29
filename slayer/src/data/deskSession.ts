import { useSyncExternalStore } from 'react';
import { isTradingDay } from '../core/calendar';
import { nyParts } from '../core/nyTime';

/* The session the book is read in, one choice for every desk: pre, regular, after hours or overnight (SPX, VIX, XSP).
   Nothing saved follows the clock; a pin stays until Follow the clock. An old saved choice is not a pin. */

export type DeskSession = 'rth' | 'pre' | 'post' | 'overnight';

export const DESK_SESSIONS: readonly { value: DeskSession; label: string; hint: string; window: string; from: number; to: number; wraps: boolean }[] = [
  { value: 'rth', label: 'Regular', hint: 'The cash session', window: '9:30 AM–4:00 PM ET', from: 9 * 60 + 30, to: 16 * 60, wraps: false },
  { value: 'pre', label: 'Premarket', hint: 'Early equity options, and the morning index session', window: '4:00 AM–9:30 AM ET', from: 4 * 60, to: 9 * 60 + 30, wraps: false },
  { value: 'post', label: 'After hours', hint: 'The curb, then the stock tape to 8:00 PM ET', window: '4:00 PM–8:00 PM ET', from: 16 * 60, to: 20 * 60, wraps: false },
  { value: 'overnight', label: 'Overnight', hint: 'SPX, VIX, and RUT. The morning leg is under Premarket', window: '8:00 PM–4:00 AM ET', from: 20 * 60, to: 4 * 60, wraps: true },
];

const STORAGE_KEY = 'slayer_desk_session_pin';

function clockSession(): DeskSession {
  const p = nyParts();
  const mins = p.hour * 60 + p.minute;
  const trading = isTradingDay(new Date(p.year, p.month - 1, p.day));
  if (!trading) return p.weekday === 0 && mins >= 20 * 60 ? 'overnight' : 'rth';
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'rth';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'post';
  return 'overnight';
}

function loadPin(): DeskSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && DESK_SESSIONS.some(s => s.value === raw)) return raw as DeskSession;
  } catch {
    /* storage blocked */
  }
  return null;
}

/** A pin is a choice the reader made. Nothing pinned means the clock, and the clock moves. */
let pin: DeskSession | null = typeof localStorage === 'undefined' ? null : loadPin();
let current: DeskSession = pin ?? (typeof localStorage === 'undefined' ? 'rth' : clockSession());
const listeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function publish(): void {
  listeners.forEach(l => l());
}

function syncClock(): void {
  if (pin != null) return;
  const next = clockSession();
  if (next === current) return;
  current = next;
  publish();
}

function ensureClock(): void {
  if (clockTimer != null || typeof window === 'undefined') return;
  clockTimer = setInterval(syncClock, 10_000);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureClock();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && clockTimer != null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

export function getDeskSession(): DeskSession {
  if (pin == null) {
    const next = clockSession();
    if (next !== current) current = next;
  }
  return current;
}

function deskFollowsClock(): boolean {
  return pin == null;
}

/** Pin the book to one session until the reader chooses to follow the clock again. */
export function setDeskSession(next: DeskSession): void {
  pin = next;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* non-fatal */
  }
  publish();
}

/** Drop the pin. The session becomes whatever the New York clock says, and it changes when the window does. */
export function followDeskClock(): void {
  pin = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
  current = clockSession();
  publish();
}

export function useDeskSession(): DeskSession {
  return useSyncExternalStore(subscribe, getDeskSession, getDeskSession);
}

export function useDeskFollowsClock(): boolean {
  return useSyncExternalStore(subscribe, deskFollowsClock, () => true);
}

export function sessionMeta(session: DeskSession) {
  return DESK_SESSIONS.find(s => s.value === session) ?? DESK_SESSIONS[0];
}

/** A bar's New York minute sits in this session. Overnight crosses midnight. */
export function minuteInSession(min: number, session: DeskSession): boolean {
  const w = sessionMeta(session);
  return w.wraps ? min >= w.from || min < w.to : min >= w.from && min < w.to;
}

/** Which session a New York minute belongs to. The windows do not overlap. */
export function sessionOfMinute(min: number): DeskSession {
  if (minuteInSession(min, 'pre')) return 'pre';
  if (minuteInSession(min, 'rth')) return 'rth';
  if (minuteInSession(min, 'post')) return 'post';
  return 'overnight';
}
