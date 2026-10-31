/* Where New York's clock stands against the session, loading no data module — a thin reading of core/session.ts (the one
   rule): stocks overnight 20:00–04:00, pre from 04:00, regular 09:30–16:00 (13:00 on an early close), after to 20:00
   (17:00 on an early close); 'late' is the quarter hour after the cash close while index and ETF options still trade. */

import { sessionAt } from './session';

export type SessionPhase = 'overnight' | 'pre' | 'regular' | 'after' | 'closed';

export function sessionPhase(at: Date = new Date()): SessionPhase {
  const ph = sessionAt(at.getTime()).phase;
  return ph === 'post' ? 'after' : ph;
}

export type MarketPhase = SessionPhase | 'late';

export function marketPhase(at: Date = new Date()): MarketPhase {
  const ph = sessionPhase(at);
  if (ph !== 'after') return ph;
  /* index and ETF options trade a quarter hour past the cash close (16:15; 13:15 on an early close) */
  return sessionAt(at.getTime(), 'etfOption').open ? 'late' : 'after';
}
