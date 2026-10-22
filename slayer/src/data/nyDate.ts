/*
  NEW YORK CALENDAR DATES FOR THE DOSSIER (the data audit, 2026-10-22).

  The vendor sends a filing or trade day as a bare "YYYY-MM-DD". `Date.parse` reads that as UTC midnight, so after about
  8am New York `(now - parse) / 1 day` rounded up to a whole extra day and every Insiders and Congress row read one day
  early ("10/20 · 2d ago" for a 10/21 trade). A bare date is a New York calendar day: the distance is counted between
  calendar days on New York's clock, never between instants. A full timestamp is first turned into its New York day.
*/

import { nyIsoDate } from '../core/nyTime';

const BARE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z?)?$/;

/** New York's calendar day today, "2026-10-22" */
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
