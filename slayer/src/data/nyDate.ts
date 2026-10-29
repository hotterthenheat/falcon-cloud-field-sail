/* New York calendar dates. A vendor's bare "YYYY-MM-DD" is a New York day, never UTC midnight, so distances are
   counted between calendar days on New York's clock. */

import { nyIsoDate, nySessionPhase } from '../core/nyTime';
import { isTradingDay } from '../core/calendar';

const BARE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z?)?$/;

/** New York's calendar day today */
export const nyTodayIso = (): string => nyIsoDate();

/** The New York calendar day a vendor date names: a bare date as written, a timestamp converted; null when unreadable */
export function nyDayOf(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const bare = BARE.exec(s);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  return nyIsoDate(t);
}

/** Whole days since the epoch for a calendar day — arithmetic on days, never on instants */
const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
};

/** Calendar days from `a` to `b` (both "YYYY-MM-DD"), signed */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

/** Calendar days between New York's today and the day a vendor date names (0 today, 1 yesterday); `fallback` when unreadable */
export function nyDaysAgo(raw: string | null | undefined, fallback = 0): number {
  const day = nyDayOf(raw);
  if (!day) return fallback;
  return Math.max(0, daysBetween(day, nyTodayIso()));
}

/** The calendar day `days` days before (negative: after) New York's today */
export function nyIsoDaysBack(days: number, from = nyTodayIso()): string {
  const [y, m, d] = from.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days, 12)).toISOString().slice(0, 10);
}

/** The Monday the earnings board starts on: this week's on a weekday, the coming one on a weekend; feed and board read it. */
export function boardMondayIso(today = nyTodayIso()): string {
  const [y, m, d] = today.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = at.getUTCDay();
  const shift = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  at.setUTCDate(at.getUTCDate() + shift);
  return at.toISOString().slice(0, 10);
}

/** The session a "today" read stands on: today once it has opened; else the last session that traded. */
export function lastSessionIso(today = nyTodayIso(), phase: 'before' | 'open' | 'after' = nySessionPhase()): string {
  const [y, m, d] = today.split('-').map(Number);
  const at = new Date(y, m - 1, d);
  if (isTradingDay(at) && phase !== 'before') return today;
  for (let i = 0; i < 10; i++) {
    at.setDate(at.getDate() - 1);
    if (isTradingDay(at)) break;
  }
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** "Oct 22" for a "2026-10-22" */
export const shortDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** A vendor stamp on UTC's calendar as New York's day: a bare date ahead of New York's today is the evening's stamp. */
export function nyDayOfUtcStamp(raw?: string | null): string | null {
  const day = nyDayOf(raw);
  if (!day) return null;
  const today = nyTodayIso();
  return day > today ? today : day;
}
