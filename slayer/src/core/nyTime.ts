/* New York's clock: every session time the terminal prints is New York's, whatever zone the reader is in — never format
   one with a bare toLocaleTimeString() or getHours(). nyClock "14:03" ("14:03:42", "14:03 ET"); deskClock "1:03 PM CT" (the
   desk's Central display clock); nyDay, nyStamp, nyIsoDate, nyMinutes, nyParts, nyWallTime, nySession, chart formatters. */

import type { Time, TickMarkFormatter } from 'lightweight-charts';
import { now } from './clock';

const NY_TZ = 'America/New_York';
/** The cash session, in minutes since New York's midnight */
export const SESSION_OPEN_MIN = 9 * 60 + 30;
export const SESSION_CLOSE_MIN = 16 * 60;
export const SESSION_LENGTH_MIN = SESSION_CLOSE_MIN - SESSION_OPEN_MIN;

export const MONTHS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const two = (n: number) => String(n).padStart(2, '0');

export type At = Date | number;
const ms = (at: At | undefined): number => (at === undefined ? now().getTime() : typeof at === 'number' ? at : at.getTime());

interface NyParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

/* One formatter and a cache by the minute: formatToParts is slow, and New York's offset never changes inside a minute. */
let fmt: Intl.DateTimeFormat | null = null;
const byMinute = new Map<number, NyParts>();
export function nyParts(at?: At): NyParts {
  const t = ms(at);
  const minute = Math.floor(t / 60_000);
  let p = byMinute.get(minute);
  if (!p) {
    fmt ??= new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const r: Record<string, string> = {};
    for (const x of fmt.formatToParts(new Date(minute * 60_000))) if (x.type !== 'literal') r[x.type] = x.value;
    p = { year: Number(r.year), month: Number(r.month), day: Number(r.day), hour: Number(r.hour) % 24, minute: Number(r.minute), second: 0, weekday: WEEKDAYS.indexOf(r.weekday) };
    if (byMinute.size > 5000) byMinute.clear();
    byMinute.set(minute, p);
  }
  const second = Math.floor((t - minute * 60_000) / 1000);
  return second === 0 ? p : { ...p, second };
}

/** Minutes since New York's midnight (0–1439) — 570 is the open, 960 the close */
export const nyMinutes = (at?: At): number => {
  const p = nyParts(at);
  return p.hour * 60 + p.minute;
};

/** New York's clock, 24-hour: "14:03", "14:03:42" with seconds, "14:03 ET" with the zone. */
export function nyClock(at?: At, opts: { seconds?: boolean; zone?: boolean } = {}): string {
  const p = nyParts(at);
  const s = `${two(p.hour)}:${two(p.minute)}${opts.seconds ? `:${two(p.second)}` : ''}`;
  return opts.zone ? `${s} ET` : s;
}

/** "Oct 9", or "Fri Oct 9" with the weekday — the one date style */
export function nyDay(at?: At, opts: { weekday?: boolean } = {}): string {
  const p = nyParts(at);
  const s = `${MONTHS[p.month - 1]} ${p.day}`;
  return opts.weekday ? `${WEEKDAYS[p.weekday]} ${s}` : s;
}

/** "Oct 9, 14:03" — where a bare clock would leave the reader asking "which day's 14:03?" */
export const nyStamp = (at?: At, opts: { seconds?: boolean; zone?: boolean } = {}): string => `${nyDay(at)}, ${nyClock(at, opts)}`;

/** "2026-10-09" — New York's calendar date, the key a day is stored under */
export function nyIsoDate(at?: At): string {
  const p = nyParts(at);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** "09:30" for 570 — a minute-of-the-day index (Trace's windows, a session's minute bars), labelled */
export const minuteLabel = (minuteOfDay: number): string => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
};

/** The instant (epoch ms) at which New York's wall clock reads y-m-d h:mi — DST included */
export function nyWallTime(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  /* New York is 4 or 5 hours behind UTC: read what the guess says there and move by the difference, twice, so a guess
     that lands across a DST change settles */
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = nyParts(t);
    const reads = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += guess - reads;
  }
  return t;
}

/** The trading day an instant belongs to, yyyymmdd as a number: its New York date, and from 20:00 the NEXT date — the
    overnight tape leads into the session it opens, so 20:00–04:00, the premarket, the cash session and the after-hours are one
    day. One key for the chart's VWAP and session cuts (data/indicators.ts) and for Pine's ta.vwap (core/pine). */
export function nyTradingDay(at?: At): number {
  const p = nyParts(at);
  if (p.hour >= 20) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  return p.year * 10_000 + p.month * 100 + p.day;
}

/** A Theta stamp with no zone is New York wall time, on every machine. */
export function nyWallStamp(stamp: unknown): number {
  if (typeof stamp === 'number' && Number.isFinite(stamp)) return stamp > 1e12 ? stamp : stamp * 1000;
  if (typeof stamp !== 'string' || !stamp) return 0;
  const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const parsed = Date.parse(stamp);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return nyWallTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) + Number(m[6] || 0) * 1000;
}

/** That New York day's cash session, as instants (epoch ms): 09:30 and 16:00 New York */
export function nySession(at?: At): { open: number; close: number } {
  const p = nyParts(at);
  return {
    open: nyWallTime(p.year, p.month, p.day, 9, 30),
    close: nyWallTime(p.year, p.month, p.day, 16, 0),
  };
}

/** Where New York's clock stands against the session: before the open, in it, or after the close */
export const nySessionPhase = (at?: At): 'before' | 'open' | 'after' => {
  const m = nyMinutes(at);
  return m < SESSION_OPEN_MIN ? 'before' : m < SESSION_CLOSE_MIN ? 'open' : 'after';
};

/* lightweight-charts on New York's clock (the library stamps UTC and has no zone option). A business day prints as it is.
   TickMarkType as numbers (0 year … 4 time with seconds) so this module does not import the chart library. */
const timeParts = (t: Time): NyParts => {
  if (typeof t === 'number') return nyParts(t * 1000);
  const [y, m, d] = typeof t === 'string' ? t.split('-').map(Number) : [t.year, t.month, t.day];
  return { year: y, month: m || 1, day: d || 1, hour: 0, minute: 0, second: 0, weekday: new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay() };
};

const hm = (p: NyParts) => `${two(p.hour)}:${two(p.minute)}`;

export const nyTickMarks: TickMarkFormatter = (time, type) => {
  const p = timeParts(time);
  switch (type as number) {
    case 0:
      return String(p.year);
    case 1:
      return MONTHS[p.month - 1];
    case 2:
      return String(p.day);
    case 4:
      return typeof time === 'number' ? `${hm(p)}:${two(p.second)}` : String(p.day);
    default:
      return hm(p);
  }
};

/** The crosshair's label: "Oct 9, 14:03" (New York) for an instant, "Oct 9" for a business day */
export const nyTimeFormatter = (time: Time): string => {
  const p = timeParts(time);
  const day = `${MONTHS[p.month - 1]} ${p.day}`;
  return typeof time === 'number' ? `${day}, ${hm(p)}` : day;
};

