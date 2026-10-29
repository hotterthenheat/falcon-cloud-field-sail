/* Where New York's clock stands against the session, loading no data module: stocks 09:30–16:00, pre from 04:00, after to 20:00;
   'late' is 16:00–16:15 while index and ETF options still trade. */

import { isTradingDay } from './calendar';
import { nyParts } from './nyTime';

export type SessionPhase = 'pre' | 'regular' | 'after' | 'closed';

export function sessionPhase(at: Date = new Date()): SessionPhase {
  const p = nyParts(at);
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return 'closed';
  const m = p.hour * 60 + p.minute;
  if (m >= 240 && m < 570) return 'pre';
  if (m >= 570 && m < 960) return 'regular';
  if (m >= 960 && m < 1200) return 'after';
  return 'closed';
}

export type MarketPhase = SessionPhase | 'late';

export function marketPhase(at: Date = new Date()): MarketPhase {
  const ph = sessionPhase(at);
  if (ph !== 'after') return ph;
  const p = nyParts(at);
  return p.hour * 60 + p.minute < 975 ? 'late' : 'after';
}
