import { useSyncExternalStore } from 'react';
import { nyParts } from '../core/nyTime';
import { phaseAt } from '../core/session';

/* The session the book is read in, one choice for every desk: pre, regular, after hours or overnight (SPX, VIX, XSP).
   Nothing saved follows the clock; a pin stays until Follow the clock. An old saved choice is not a pin. */

export type DeskSession = 'rth' | 'pre' | 'post' | 'overnight';

export const DESK_SESSIONS: readonly { value: DeskSession; label: string; hint: string; window: string; from: number; to: number; wraps: boolean }[] = [
  { value: 'rth', label: 'Regular', hint: 'The cash session', window: '9:30 AM–4:00 PM ET', from: 9 * 60 + 30, to: 16 * 60, wraps: false },
  { value: 'pre', label: 'Premarket', hint: 'Early equity options, and the morning index session', window: '4:00 AM–9:30 AM ET', from: 4 * 60, to: 9 * 60 + 30, wraps: false },
  { value: 'post', label: 'After hours', hint: 'The curb, then the stock tape to 8:00 PM ET', window: '4:00 PM–8:00 PM ET', from: 16 * 60, to: 20 * 60, wraps: false },
  { value: 'overnight', label: 'Overnight', hint: 'The stock tape from 8:00 PM. Index options open at 8:15. The morning leg is under Premarket', window: '8:00 PM–4:00 AM ET', from: 20 * 60, to: 4 * 60, wraps: true },
];

const STORAGE_KEY = 'slayer_desk_session_pin';
const BORN_KEY = 'slayer_desk_session_pin_born';

/** The desk session the clock is in — the global phase (core/session.ts). Closed (Friday 20:00 → Sunday 20:00, a
    holiday, the gap after an early close's after hours) reads the last regular session. */
export function deskSessionAt(ms: number): DeskSession {
  const ph = phaseAt(ms);
  return ph === 'overnight' ? 'overnight' : ph === 'pre' ? 'pre' : ph === 'post' ? 'post' : 'rth';
}
const clockSession = (): DeskSession => deskSessionAt(Date.now());

function loadPin(): DeskSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && DESK_SESSIONS.some(s => s.value === raw)) return raw as DeskSession;
  } catch {
    /* storage blocked */
  }
  return null;
}

function loadBorn(): DeskSession | null {
  try {
    const raw = localStorage.getItem(BORN_KEY);
    if (raw && DESK_SESSIONS.some(s => s.value === raw)) return raw as DeskSession;
  } catch {
    /* storage blocked */
  }
  return null;
}

/** A pin is a look at one session, taken while the clock was `pinBorn`. When that clock moves, the pin lets go. */
let pin: DeskSession | null = typeof localStorage === 'undefined' ? null : loadPin();
let pinBorn: DeskSession | null = pin == null || typeof localStorage === 'undefined' ? null : loadBorn();
let current: DeskSession = pin ?? (typeof localStorage === 'undefined' ? 'rth' : clockSession());
const listeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function publish(): void {
  listeners.forEach(l => l());
}

function releasePin(): void {
  pin = null;
  pinBorn = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BORN_KEY);
  } catch {
    /* non-fatal */
  }
}

function syncClock(): void {
  const next = clockSession();
  /* A pin taken in a session that has ended does not keep the site there. No birth stamp means the pin is from
     before this rule, and it lets go the moment the clock is not that session. */
  if (pin != null && (pinBorn == null || pinBorn !== next)) {
    releasePin();
    if (next !== current) current = next;
    publish();
    return;
  }
  if (pin != null) return;
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
  const next = clockSession();
  if (pin != null && (pinBorn == null || pinBorn !== next)) {
    releasePin();
    current = next;
  } else if (pin == null && next !== current) {
    current = next;
  }
  return current;
}

function deskFollowsClock(): boolean {
  return pin == null;
}

export { deskFollowsClock };

/** Look at one session. It holds only while the clock stays in the session it was taken. When the clock moves, the site follows. */
export function setDeskSession(next: DeskSession): void {
  const born = clockSession();
  pin = next;
  pinBorn = born;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
    localStorage.setItem(BORN_KEY, born);
  } catch {
    /* non-fatal */
  }
  publish();
}

/** Drop the pin. The session becomes whatever the New York clock says, and it changes when the window does. */
export function followDeskClock(): void {
  releasePin();
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

/** Which evening an overnight bar belongs to. A print before 4:00 AM is the previous evening's session, not a new one. */
export function sessionOccurrence(timeSec: number, session: DeskSession): string {
  const p = nyParts(timeSec * 1000);
  const min = p.hour * 60 + p.minute;
  if (session === 'overnight' && min < 4 * 60) {
    const prev = new Date(Date.UTC(p.year, p.month - 1, p.day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
  }
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The bars of the last occurrence of `session` in this list. A halt inside the occurrence stays in it. */
export function currentSessionBars<T extends { time: number }>(bars: readonly T[], session: DeskSession): T[] {
  if (bars.length === 0) return [];
  const last = sessionOccurrence(bars[bars.length - 1].time, session);
  let i = bars.length - 1;
  while (i > 0 && sessionOccurrence(bars[i - 1].time, session) === last) i -= 1;
  return bars.slice(i);
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
