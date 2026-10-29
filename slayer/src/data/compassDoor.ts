/* Compass doors the scan already claims. The window is 09:30–15:00 ET on a session day. One tracked name per
   session. Five open. The blotter is not this book. */

import { useEffect, useMemo, useState } from 'react';
import { isoDate, isTradingDay, nextSession } from '../core/calendar';
import { now } from '../core/clock';
import { nyParts, type At } from '../core/nyTime';
import type { TrackedSetup } from '../types/tracker';
import type { SleeveKey } from '../types/compass';
import { deskPhase } from './compassSession';
import type { OptionPhase } from './compassSession';

export const OPEN_CAP = 5;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ScanClock {
  /** A tape that can take a ticket is open. The halt and the shut hours are not. */
  open: boolean;
  phase: OptionPhase;
  /** The session a new entry belongs to. ISO date. */
  session: string;
  /** "Monday Oct 26" */
  label: string;
  line: string;
}

const dayOf = (p: { year: number; month: number; day: number }) => new Date(p.year, p.month - 1, p.day);

/** The session an entry belongs to. After 16:00, or on a closed day, the next session. */
export function entrySession(at: At = now()): string {
  const p = nyParts(at);
  const day = dayOf(p);
  const mins = p.hour * 60 + p.minute;
  if (!isTradingDay(day) || mins >= 16 * 60) {
    const from = new Date(day);
    if (mins >= 16 * 60) from.setDate(from.getDate() + 1);
    return isoDate(nextSession(from));
  }
  return isoDate(day);
}

export function scanClock(at: At = now()): ScanClock {
  const p = nyParts(at);
  const day = dayOf(p);
  const mins = p.hour * 60 + p.minute;
  const phase = deskPhase(at);
  const open = phase === 'overnight' || phase === 'pre' || phase === 'open' || phase === 'curb';
  const sessionDate = (() => {
    if (!isTradingDay(day) || mins >= 16 * 60) {
      const from = new Date(day);
      if (mins >= 16 * 60) from.setDate(from.getDate() + 1);
      return nextSession(from);
    }
    return day;
  })();
  const session = isoDate(sessionDate);
  const label = `${WEEKDAY[sessionDate.getDay()]} ${MONTHS[sessionDate.getMonth()]} ${sessionDate.getDate()}`;
  const line = phase === 'overnight'
    ? 'Overnight. SPX, NDX, RUT, and VIX only. A name with no overnight tape is not on this scan.'
    : phase === 'pre'
      ? 'Pre-market. Index roots, the extended single names, and GLD, IWM, QQQ, SPY, XLF.'
      : phase === 'halt'
        ? 'Halted, 09:25 to 09:30 ET. No new ticket.'
        : phase === 'open'
          ? 'Regular session. Every name.'
          : phase === 'curb'
            ? 'Curb. Extended names until 16:15 ET. Index weeklies until 17:00 ET.'
            : `Options are shut. Next tape ${label}.`;
  return { open, phase, session, label, line };
}

export function useScanClock(): ScanClock {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(n => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => scanClock(), [tick]);
}

/** Tracks that count against this session. Older rows stay on the tracker and do not take a slot. */
export function sessionBook(tracked: readonly TrackedSetup[], at: At = now()): TrackedSetup[] {
  const session = entrySession(at);
  return tracked.filter(t => entrySession(t.trackedAt) === session);
}

const usedNames = new Set<string>();

export function nameUsed(ticker: string, at: At = now()): boolean {
  return usedNames.has(`${entrySession(at)}|${ticker.toUpperCase()}`);
}

export type TrackAnswer =
  | { ok: true }
  | { ok: false; why: 'name'; contract: string; sleeve?: SleeveKey }
  | { ok: false; why: 'full'; open: number }
  | { ok: false; why: 'closed' };

export function gateTrack(tracked: readonly TrackedSetup[], setup: { id: string; ticker: string; sleeve?: SleeveKey }, at: At = now()): TrackAnswer {
  if (tracked.some(t => t.id === setup.id)) return { ok: true };
  if (!scanClock(at).open) return { ok: false, why: 'closed' };
  const mine = sessionBook(tracked, at);
  if (nameUsed(setup.ticker, at)) {
    const taken = mine.find(t => t.ticker === setup.ticker);
    return { ok: false, why: 'name', contract: taken?.contract ?? setup.ticker, sleeve: taken?.sleeve };
  }
  const taken = mine.find(t => t.ticker === setup.ticker);
  if (taken) return { ok: false, why: 'name', contract: taken.contract, sleeve: taken.sleeve };
  if (mine.length >= OPEN_CAP) return { ok: false, why: 'full', open: mine.length };
  return { ok: true };
}
