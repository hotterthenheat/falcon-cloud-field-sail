/* Which session the Trace pages read: Regular (09:30 to the close, 16:15 ET for index and ETF options) or Extended
   (outside it, shown but never read). Options have no premarket session to offer. */

import { useEffect, useState, useSyncExternalStore } from 'react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { marketPhase } from '../../data/traceLive';

export type TraceSession = 'regular' | 'extended';

const KEY = 'slayer_trace_session';
const load = (): TraceSession => {
  try {
    return localStorage.getItem(KEY) === 'extended' ? 'extended' : 'regular';
  } catch {
    return 'regular';
  }
};
let current: TraceSession = typeof localStorage === 'undefined' ? 'regular' : load();
const listeners = new Set<() => void>();
export function setTraceSession(next: TraceSession): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage blocked — the choice lives for the visit */
  }
  listeners.forEach(l => l());
}

/** True while the regular session runs (09:30–16:00 New York on a session day) — nothing is extended yet */
function useInSession(): boolean {
  const [inSession, setInSession] = useState(() => marketPhase() === 'regular');
  useEffect(() => {
    const id = window.setInterval(() => setInSession(marketPhase() === 'regular'), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return inSession;
}

/** The session the Trace pages read. While the regular session runs there is no extended tape yet, so it reads regular
    whatever was picked. */
export function useTraceSession(): TraceSession {
  const picked = useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current
  );
  const inSession = useInSession();
  return inSession ? 'regular' : picked;
}

/** The shell's card */
export const TraceSessionCard = () => {
  const session = useTraceSession();
  const inSession = useInSession();
  const options: DropdownOption<TraceSession>[] = [
    { value: 'regular', label: 'Regular', hint: '09:30 to the close — 16:15 ET for index and ETF options, 16:00 for a stock’s. After the close, the day’s own session' },
    {
      value: 'extended',
      label: 'Extended hours',
      hint: inSession ? 'From the close — the regular session is still running' : 'Prints outside the regular session — after the close, against thin quotes: shown, labelled, never read',
      disabled: inSession,
    },
  ];
  return (
    <DropdownSelect<TraceSession>
      label="Session"
      value={session}
      options={options}
      onChange={setTraceSession}
      title="Which session this page reads — the regular session, or the prints outside it"
      testId="trace-session"
      align="end"
    />
  );
};
