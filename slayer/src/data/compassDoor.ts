/*
  Compass doors the scan already claims.
  The window is 09:30–15:00 ET on a session day.
  One tracked name per session. Five open.
  The blotter is not this book.
*/

import { useEffect, useMemo, useState } from 'react';
import { isoDate, isTradingDay, nextSession } from '../core/calendar';
import { now } from '../core/clock';
import { nyParts, type At } from '../core/nyTime';
import type { TrackedSetup } from '../types/tracker';
import type { SleeveKey } from '../types/compass';

/** First minute the loaded scan looks. Last minute it looks. */
export const SCAN_OPEN_MIN = 9 * 60 + 30;
export const SCAN_FLAT_MIN = 15 * 60;
export const OPEN_CAP = 5;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ScanClock {
  /** Inside 09:30–15:00 ET on a session day. Nothing else. */
  open: boolean;
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
  const open = isTradingDay(day) && mins >= SCAN_OPEN_MIN && mins < SCAN_FLAT_MIN;
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
  return {
    open,
    session,
    label,
    line: open ? 'Scan window is open until 15:00 ET.' : `Scan closed. Next open ${label}, 09:30 ET.`,
  };
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

/** One entry per name per session, including a fill that was unavailable. */
export function noteNameUsed(ticker: string, at: At = now()): void {
  if (!ticker) return;
  usedNames.add(`${entrySession(at)}|${ticker.toUpperCase()}`);
}

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
  if (setup.sleeve !== 'weekly' && !scanClock(at).open) return { ok: false, why: 'closed' };
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
