import { useSyncExternalStore } from 'react';

/*
  THE SESSION THE BOOK IS READ IN.

  Regular hours were the only session the desks asked for. The keys also
  carry premarket and the short after-hours window on the new equity and
  ETF names, and the overnight book on SPX, VIX and XSP. One choice, every
  desk — the distance-unit pattern — so the tape, the chain and the map
  never disagree about which session they are looking at.
*/

export type DeskSession = 'rth' | 'pre' | 'post' | 'overnight';

export const DESK_SESSIONS: readonly { value: DeskSession; label: string; hint: string; window: string; from: number; to: number; wraps: boolean }[] = [
  { value: 'rth', label: 'Regular', hint: 'The cash session', window: '09:30–16:00 ET', from: 9 * 60 + 30, to: 16 * 60, wraps: false },
  { value: 'pre', label: 'Premarket', hint: 'The equity tape before the open', window: '04:00–09:30 ET', from: 4 * 60, to: 9 * 60 + 30, wraps: false },
  { value: 'post', label: 'After hours', hint: 'The equity tape after the cash close', window: '16:00–20:00 ET', from: 16 * 60, to: 20 * 60, wraps: false },
  { value: 'overnight', label: 'Overnight', hint: 'The names that print overnight — others have no tape here', window: '20:00–04:00 ET', from: 20 * 60, to: 4 * 60, wraps: true },
];

const STORAGE_KEY = 'slayer_desk_session';

function load(): DeskSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && DESK_SESSIONS.some(s => s.value === raw)) return raw as DeskSession;
  } catch {
    /* storage blocked */
  }
  return 'rth';
}

let current: DeskSession = typeof localStorage === 'undefined' ? 'rth' : load();
const listeners = new Set<() => void>();

export function getDeskSession(): DeskSession {
  return current;
}

export function setDeskSession(next: DeskSession): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* non-fatal */
  }
  listeners.forEach(l => l());
}

export function useDeskSession(): DeskSession {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getDeskSession,
    getDeskSession,
  );
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
