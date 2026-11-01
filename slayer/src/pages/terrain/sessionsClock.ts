/*
==================================================
  SLAYER TERMINAL - THE SESSIONS CLOCK'S ARITHMETIC (pages/terrain/sessionsClock.ts)

  The partner tree's sessions clock (2026-10-31) laid four world markets on fixed hours of its own. Ours reads THE
  SESSION THE WHOLE SITE FOLLOWS — src/core/session.ts over shared/marketSession.mjs: overnight 20:00–04:00, pre-market
  04:00–09:30, regular 09:30–16:00, after hours 16:00–20:00, with the holidays and early closes of shared/
  marketCalendar.mjs (an early close ends the regular session at 13:00 and after hours at 17:00; the evening before a
  full holiday has no overnight). Nothing here spells an hour: every span is a window the module answers.

  One New York day is the card's ruler, midnight to midnight, a lane a session; the chip names the next change.
  Nothing is read from the network.
==================================================
*/

import { addDays, isEarlyCloseDay, isHolidayDay, isSessionDay, nextWindow, nyInstant, nyWall, regularCloseMin, sessionAt, windowAt, type Phase } from '../../core/session';

export type Lane = 'overnight' | 'pre' | 'regular' | 'post';
export const LANES: readonly Lane[] = ['overnight', 'pre', 'regular', 'post'];
export const LANE_WORDS: Record<Lane, { name: string; short: string }> = {
  overnight: { name: 'Overnight', short: 'ON' },
  pre: { name: 'Pre-market', short: 'PM' },
  regular: { name: 'Regular', short: 'RTH' },
  post: { name: 'After hours', short: 'AH' },
};

export interface Span {
  kind: Lane;
  from: number;
  to: number;
}

const isLane = (k: string): k is Lane => (LANES as readonly string[]).includes(k);

/** The New York day holding `at`: its midnight and the next (DST included — the module's own instant) */
export function nyDayBounds(at: number): { iso: string; from: number; to: number } {
  const iso = nyWall(at).iso;
  return { iso, from: nyInstant(iso, 0), to: nyInstant(addDays(iso, 1), 0) };
}

/** The stock tape's windows touching the New York day holding `at`, in order, as the module answers them */
export function dayWindows(at: number): Span[] {
  const day = nyDayBounds(at);
  const out: Span[] = [];
  let t = day.from;
  for (let i = 0; i < 12 && t < day.to; i++) {
    const w = windowAt(t, 'equity') ?? nextWindow(t, 'equity');
    if (!w || w.from >= day.to) break;
    if (isLane(w.kind)) out.push({ kind: w.kind, from: w.from, to: w.to });
    if (w.to <= t) break;
    t = w.to;
  }
  return out;
}

export interface LaneNow {
  kind: Lane;
  open: boolean;
  /** the instant the lane next changes — its close while open, its next opening while shut (null beyond three weeks) */
  changeAt: number | null;
}

/** Where each session stands at an instant */
export function readLanes(at: number): LaneNow[] {
  return LANES.map(kind => {
    const w = windowAt(at, 'equity');
    if (w && w.kind === kind) return { kind, open: true, changeAt: w.to };
    /* the next window of this kind: walk the module's openings (a week holds at most ~20 windows) */
    let t = at;
    for (let i = 0; i < 30; i++) {
      const n = nextWindow(t, 'equity');
      if (!n) break;
      if (n.kind === kind) return { kind, open: false, changeAt: n.from };
      t = n.from;
    }
    return { kind, open: false, changeAt: null };
  });
}

/** The tape's phase now and the next turn of it — the chip's line */
export function nextTurn(at: number): { phase: Phase; next: Lane | 'closed'; at: number; opens: boolean } | null {
  const s = sessionAt(at, 'equity');
  const w = windowAt(at, 'equity');
  if (w) {
    const after = windowAt(w.to, 'equity');
    return { phase: s.phase, next: after && isLane(after.kind) ? after.kind : 'closed', at: w.to, opens: !!after };
  }
  const n = nextWindow(at, 'equity');
  if (!n || !isLane(n.kind)) return null;
  return { phase: s.phase, next: n.kind, at: n.from, opens: true };
}

export interface DayNote {
  iso: string;
  kind: 'holiday' | 'early';
  /** an early close's regular close, minutes of New York's day */
  closeMin?: number;
}

/** The next closures and early closes on the calendar, from the New York day holding `at` (within `days`) */
export function aheadNotes(at: number, days = 45, max = 2): DayNote[] {
  const out: DayNote[] = [];
  let iso = nyWall(at).iso;
  for (let i = 0; i <= days && out.length < max; i++, iso = addDays(iso, 1)) {
    if (isHolidayDay(iso)) out.push({ iso, kind: 'holiday' });
    else if (isEarlyCloseDay(iso) && isSessionDay(iso)) out.push({ iso, kind: 'early', closeMin: regularCloseMin(iso) });
  }
  return out;
}

/** "in 1d 5h" · "in 2h 14m" · "in 12m" · "in under a minute" */
export function inWords(msAhead: number): string {
  const m = Math.max(0, Math.round(msAhead / 60_000));
  if (m < 1) return 'in under a minute';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `in ${d}d${h > 0 ? ` ${h}h` : ''}`;
  if (h > 0) return `in ${h}h${mm > 0 ? ` ${mm}m` : ''}`;
  return `in ${mm}m`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Thu 26 Nov" off an ISO date */
export function isoDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`;
}
/** "13:00" off minutes of the day */
export const minuteClock = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
