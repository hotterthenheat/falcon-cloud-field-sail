/* The market's holidays from the terminal (/calendar/year_holidays), this year's and next year's, merged into the
   calendar (core/calendar.ts mergeLiveHolidays — the hard-coded table wins on any disagreement, which is logged). Every
   browser asks the same path for a year and the server's hub keeps it a day (shared/thetaPaths.mjs thetaTtl), so the
   vendor is asked about once a day. A year the terminal has not published yet answers "no data" and is asked again on
   the next page load. */

import { mergeLiveHolidays, type HolidayMerge, type HolidayRow } from '../core/calendar';
import { nyIsoDate } from '../core/nyTime';
import { thetaCall } from './theta';

export const holidayPath = (year: number | string): string => `/calendar/year_holidays?year=${year}&format=json`;

/** The answer's rows (`response` unwrapped or not) */
export function parseHolidays(data: unknown): HolidayRow[] {
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { response?: unknown }).response) ? (data as { response: unknown[] }).response : [];
  return (rows as Record<string, unknown>[])
    .filter(r => r && typeof r === 'object' && typeof r.date === 'string' && typeof r.type === 'string')
    .map(r => ({ date: String(r.date), type: String(r.type), close: r.close == null ? null : String(r.close) }));
}

/** Merges one answer into the calendar */
export const takeHolidays = (data: unknown): HolidayMerge => mergeLiveHolidays(parseHolidays(data));

const asked = new Map<string, number>();
/** Reads this year's and next year's holidays once a page load (again a minute after a failed read) */
export function ensureHolidays(now = Date.now()): void {
  if (typeof window === 'undefined') return;
  const year = Number(nyIsoDate(now).slice(0, 4));
  for (const y of [year, year + 1]) {
    const key = String(y);
    const at = asked.get(key);
    if (at != null && (at === 0 || now - at < 60_000)) continue;
    asked.set(key, 0);
    void thetaCall(holidayPath(y)).then(a => {
      /* no data yet for a year not published: kept as asked (0) until the next load */
      if (a.status === 472) return;
      if (a.error) asked.set(key, Date.now());
      else takeHolidays(a.data);
    });
  }
}
