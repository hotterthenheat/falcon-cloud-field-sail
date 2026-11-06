/* THE NOTIFICATION CENTER'S LIST: one list over the stores that already speak, newest first. Nothing is detected
   here: each item is a firing the store itself logged —
   - an alert that fired (components/gex/alertStore.ts, the chart, level, flow, news and script alerts; the alerts
     drawer's "Alerted" shelf),
   - a Compass call the reader asked to hear (data/compassAlerts.ts, the toasts' Compass chips),
   - a paper trade's fill or verdict (data/paper/store.ts, the toasts' paper chips),
   - the banner's current outage or announcement (data/banner.ts), so a dismissed strip is still on record here.
   What this module adds is the reader's own marks on them: read or not, and cleared from the list. The stores keep
   their logs for this tab ("while this tab is open", as the alerts promise), so the marks are kept for the tab too,
   in sessionStorage. Clearing everything also clears the alert log (the drawer's own Clear), so the two agree. */

import { useMemo, useSyncExternalStore } from 'react';

export type NoticeKind = 'alert' | 'compass' | 'paper' | 'status';

export interface Notice {
  /** Unique across every source: `<kind>:<the store's own key>` */
  id: string;
  kind: NoticeKind;
  at: number;
  title: string;
  detail: string;
  ticker?: string;
  /** Where its door goes */
  to?: string;
  /** A tone for the dot: an alert's ink, a call's silver, a loss or a win, an outage */
  tone: 'alert' | 'silver' | 'bull' | 'bear' | 'warn';
}

/* ---- the marks ---- */
interface Marks {
  read: string[];
  cleared: string[];
}
const KEY = 'slayer_notice_marks_v1';
const CAP = 400;

const load = (): Marks => {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
    const p = raw ? (JSON.parse(raw) as Partial<Marks>) : null;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-CAP) : []);
    return { read: list(p?.read), cleared: list(p?.cleared) };
  } catch {
    return { read: [], cleared: [] };
  }
};
let marks: Marks = load();
let readSet = new Set(marks.read);
let clearedSet = new Set(marks.cleared);
let rev = 0;
const subs = new Set<() => void>();
const save = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    /* no storage: the marks last for this page view */
  }
};
const commit = (next: Marks) => {
  marks = { read: next.read.slice(-CAP), cleared: next.cleared.slice(-CAP) };
  readSet = new Set(marks.read);
  clearedSet = new Set(marks.cleared);
  rev += 1;
  save();
  subs.forEach(fn => fn());
};
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};

export const isRead = (id: string): boolean => readSet.has(id);
export const isCleared = (id: string): boolean => clearedSet.has(id);

export function markRead(ids: readonly string[]): void {
  const fresh = ids.filter(id => !readSet.has(id));
  if (fresh.length) commit({ ...marks, read: [...marks.read, ...fresh] });
}
export function markUnread(id: string): void {
  if (readSet.has(id)) commit({ ...marks, read: marks.read.filter(x => x !== id) });
}
export function clearNotices(ids: readonly string[]): void {
  const fresh = ids.filter(id => !clearedSet.has(id));
  if (fresh.length) commit({ ...marks, cleared: [...marks.cleared, ...fresh], read: [...marks.read, ...fresh.filter(id => !readSet.has(id))] });
}

/** Re-renders when a mark changes */
export const useNoticeMarks = (): number => useSyncExternalStore(subscribe, () => rev, () => rev);

/** The list on screen: every item not cleared, newest first, each with whether it is read. */
export function visibleNotices(all: readonly Notice[], read: (id: string) => boolean = isRead, cleared: (id: string) => boolean = isCleared): (Notice & { read: boolean })[] {
  const seen = new Set<string>();
  return all
    .filter(n => {
      if (seen.has(n.id) || cleared(n.id)) return false;
      seen.add(n.id);
      return true;
    })
    .map(n => ({ ...n, read: read(n.id) }))
    .sort((a, b) => b.at - a.at);
}

/** How many are unread */
export const unreadCount = (list: readonly { read: boolean }[]): number => list.reduce((n, x) => n + (x.read ? 0 : 1), 0);

/** Memoised by the inputs' identities (the stores hand out stable snapshots) */
export function useMergedNotices(parts: readonly (readonly Notice[])[]): (Notice & { read: boolean })[] {
  const r = useNoticeMarks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => visibleNotices(parts.flat()), [r, ...parts]);
}
