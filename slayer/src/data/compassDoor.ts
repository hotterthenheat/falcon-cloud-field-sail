/* Compass doors the scan already claims. The window is 09:30–15:00 ET on a session day. One tracked name per
   session. Five open. The blotter is not this book. */

import { useEffect, useMemo, useState } from 'react';
import { isoDate, MONTHS } from '../core/calendar';
import { isSessionDay, nextSessionDay, nyWall, regularCloseMin } from '../core/session';
import { now } from '../core/clock';
import type { At } from '../core/nyTime';
import type { TrackedSetup } from '../types/tracker';
import type { SleeveKey } from '../types/compass';
import { deskPhase } from './compassSession';
import type { OptionPhase } from './compassSession';

export const OPEN_CAP = 5;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface ScanClock {
  /** A tape that can take a ticket is open. The halt and the shut hours are not. */
  open: boolean;
  phase: OptionPhase;
  /** The session a new entry belongs to. ISO date. */
  session: string;
  /** "Monday Oct 26" */
  label: string;
  line: string;
}


/** The session an entry belongs to: today until its regular close (16:00, or 13:00 on an early close), then, and on a
    day with no session, the next session day (core/session). */
function entryDay(at: At = now()): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  const iso = nyWall(ms).iso;
  if (isSessionDay(iso) && nyWall(ms).min < regularCloseMin(iso)) return iso;
  return nextSessionDay(iso);
}

function entrySession(at: At = now()): string {
  return entryDay(at);
}

function scanClock(at: At = now()): ScanClock {
  const phase = deskPhase(at);
  const open = phase === 'overnight' || phase === 'pre' || phase === 'open' || phase === 'curb';
  const sessionDate = new Date(`${entryDay(at)}T12:00:00`);
  const session = isoDate(sessionDate);
  const label = `${WEEKDAY[sessionDate.getDay()]} ${MONTHS[sessionDate.getMonth()]} ${sessionDate.getDate()}`;
  const line = phase === 'overnight'
    ? 'Overnight. SPX, XSP, RUT and VIX only (NDX has no overnight session). A name with no overnight tape is not on this scan.'
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

function nameUsed(ticker: string, at: At = now()): boolean {
  return usedNames.has(`${entrySession(at)}|${ticker.toUpperCase()}`);
}

export type TrackAnswer =
  | { ok: true }
  | { ok: false; why: 'name'; contract: string; sleeve?: SleeveKey }
  | { ok: false; why: 'full'; open: number }
  | { ok: false; why: 'closed' };

export function gateTrack(tracked: readonly TrackedSetup[], setup: { id: string; ticker: string; sleeve?: SleeveKey }, at: At = now()): TrackAnswer {
  if (tracked.some(t => t.id === setup.id)) return { ok: true };
  /* A bookmark is not a ticket. The scan clock does not refuse it — a closed tape used to
     return { ok: false, why: 'closed' } and the contract page never wrote the row. */
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
