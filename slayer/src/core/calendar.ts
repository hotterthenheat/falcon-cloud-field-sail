/* The market calendar: whether the market is open on a date, and turning a horizon in days into a real expiry
   (options expire on trading days; anything naming an expiry comes through here). */

import { now } from './clock';
import { nyParts } from './nyTime';
import { EARLY_CLOSE_DATES, HOLIDAY_DATES } from '../../shared/marketCalendar.mjs';

/** US equity market holidays back to 2016 for the replay (incl. 2018-12-05 and 2025-01-09; Juneteenth from 2022) through
    2030: NYSE's published calendar to 2028, projected from its rules for 2029–2030 (shared/marketCalendar.mjs, which the
    server's market-hours check reads too). Mirrored by engine/slayer_core/calendar.py via scripts/calendar-ref.ts. Early
    closes are EARLY_CLOSES below. */
export const MARKET_HOLIDAYS: ReadonlySet<string> = new Set(HOLIDAY_DATES);

/* Holidays the market-data terminal reports (/calendar/year_holidays, read once a day through the server's hub:
   data/holidayFeed.ts → mergeLiveHolidays). Merged with the table above, THE TABLE WINNING on any disagreement: for a
   year the table covers, a date the two disagree on is logged and the table's answer kept; only a year the table does not
   cover takes the terminal's closures and early closes. An empty set changes nothing. */
const LIVE_HOLIDAYS = new Set<string>();
const LIVE_EARLY = new Set<string>();
const TABLE_YEARS: ReadonlySet<string> = new Set(HOLIDAY_DATES.map(d => d.slice(0, 4)));

/** Cash session ends at 1:00 PM ET (12:00 PM CT) on these dates, back to 2016 for the replay (the day after
    Thanksgiving, and July 3 and December 24 when they are weekdays and not themselves holidays). Not holidays, and not a
    reason to invent a bar. */
export const EARLY_CLOSES: ReadonlySet<string> = new Set(EARLY_CLOSE_DATES);

export const isEarlyClose = (iso: string): boolean => EARLY_CLOSES.has(iso) || LIVE_EARLY.has(iso);

/** Minute of the New York day the cash session ends on a date (YYYY-MM-DD): 13:00 on an early close, else 16:00. */
export const sessionCloseMinOn = (iso: string): number => (isEarlyClose(iso) ? 13 * 60 : 16 * 60);

/** One row of the terminal's year of holidays */
export interface HolidayRow {
  date: string;
  /** 'full_close' or 'early_close' */
  type: string;
  close?: string | null;
}
export interface HolidayMerge {
  /** Years the answer covered */
  years: string[];
  /** Dates taken from the terminal (a year the table does not cover) */
  added: string[];
  /** Where the terminal and the table disagree, in words; the table's answer is kept */
  disagree: string[];
}
const said = new Set<string>();
/** Merge the terminal's holidays into the calendar, the table winning on every disagreement (logged once each). */
export function mergeLiveHolidays(rows: readonly HolidayRow[], log: (line: string) => void = line => console.warn(line)): HolidayMerge {
  const out: HolidayMerge = { years: [], added: [], disagree: [] };
  const byYear = new Map<string, { full: Set<string>; early: Set<string> }>();
  for (const r of rows) {
    const d = String(r?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const y = byYear.get(d.slice(0, 4)) ?? { full: new Set<string>(), early: new Set<string>() };
    if (r.type === 'full_close') y.full.add(d);
    else if (r.type === 'early_close' && String(r.close ?? '').startsWith('13:00')) y.early.add(d);
    else if (r.type === 'early_close') out.disagree.push(`${d}: the terminal closes early at ${r.close}; only 13:00 closes are known here, so it is not used`);
    byYear.set(d.slice(0, 4), y);
  }
  for (const [year, got] of [...byYear].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.years.push(year);
    if (!TABLE_YEARS.has(year)) {
      for (const d of got.full) {
        if (LIVE_HOLIDAYS.has(d)) continue;
        LIVE_HOLIDAYS.add(d);
        out.added.push(d);
      }
      for (const d of got.early) {
        if (LIVE_EARLY.has(d)) continue;
        LIVE_EARLY.add(d);
        out.added.push(`${d} (early close)`);
      }
      continue;
    }
    const tableFull = HOLIDAY_DATES.filter(d => d.startsWith(year));
    const tableEarly = EARLY_CLOSE_DATES.filter(d => d.startsWith(year));
    for (const d of got.full) if (!MARKET_HOLIDAYS.has(d)) out.disagree.push(`${d}: the terminal says the market is closed; the table says ${EARLY_CLOSES.has(d) ? 'it closes early' : 'it is open'} — the table is kept`);
    for (const d of tableFull) if (!got.full.has(d)) out.disagree.push(`${d}: the table says the market is closed; the terminal says ${got.early.has(d) ? 'it closes early' : 'it is open'} — the table is kept`);
    for (const d of got.early) if (!EARLY_CLOSES.has(d) && !MARKET_HOLIDAYS.has(d)) out.disagree.push(`${d}: the terminal says 13:00 early close; the table says a full session — the table is kept`);
    for (const d of tableEarly) if (!got.early.has(d) && !got.full.has(d)) out.disagree.push(`${d}: the table says 13:00 early close; the terminal says a full session — the table is kept`);
  }
  for (const line of out.disagree) {
    if (said.has(line)) continue;
    said.add(line);
    log(`[calendar] holidays disagree: ${line}`);
  }
  return out;
}

/** Cash-session minutes on a date: 210 on an early close, else 390. */
export const sessionLengthOn = (iso: string): number => sessionCloseMinOn(iso) - (9 * 60 + 30);
export { MONTHS } from './nyTime';

/** New York's date of an instant, YYYYMMDD */
export function nyYmd(ms: number): string {
  const p = nyParts(ms);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isTradingDay(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = isoDate(d);
  return !MARKET_HOLIDAYS.has(iso) && !LIVE_HOLIDAYS.has(iso);
}

/** Midnight local — dates used as calendar keys must not carry a time. */
function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "Today" as the ENGINE sees it — wall clock live, pinned date in a replay.
    Every default `from` in this module flows through here, which is what
    stops a backtest from resolving 2024's expiries against 2026's calendar. */
export function today(): Date {
  /* The market's day, not the browser's: keys are local midnights, but the day they name is New York's. */
  const p = nyParts(now());
  return new Date(p.year, p.month - 1, p.day);
}

/** The day the book is on: New York's date until the cash close (16:00; 13:00 on an early close), the next day after,
    because today's contracts stop then (the 16:15 close is for index and ETF options not expiring that day). */
export function bookToday(): Date {
  const p = nyParts(now());
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const after = p.hour * 60 + p.minute >= sessionCloseMinOn(iso);
  return new Date(p.year, p.month - 1, p.day + (after ? 1 : 0));
}

/** Walk in `step` days until a session is found (bounded — never spins). */
function walkToSession(from: Date, step: 1 | -1): Date {
  const d = new Date(from);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() + step);
  return d;
}

/** The session on or before a date (the date itself when it trades) */
export function sessionAtOrBefore(d: Date): Date {
  const out = new Date(d);
  for (let i = 0; i < 10 && !isTradingDay(out); i++) out.setDate(out.getDate() - 1);
  return out;
}

/** The session strictly before a date, at local midnight */
export function sessionBefore(d: Date): Date {
  const out = atMidnight(d);
  for (let i = 0; i < 12; i++) {
    out.setDate(out.getDate() - 1);
    if (isTradingDay(out)) break;
  }
  return out;
}

/** The next date the market is open, today included if it is a session. */
export function nextSession(from: Date = today()): Date {
  return walkToSession(atMidnight(from), 1);
}

/** Trading days between two dates (exclusive of `from`, inclusive of `to`). */
export function sessionsBetween(from: Date, to: Date): number {
  const a = atMidnight(from);
  const b = atMidnight(to);
  if (b <= a) return 0;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    if (isTradingDay(cur)) n++;
  }
  return n;
}

export interface Expiry {
  /** The real expiry date — always a trading day */
  date: Date;
  /** MM/DD/YY */
  label: string;
  /** Weekday name, e.g. "Fri" — the tell that makes a bad date obvious */
  weekday: string;
  /** CALENDAR days from today to that date (what pricing uses) */
  dte: number;
  /** TRADING sessions left — the number that actually decays the contract */
  sessions: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtExpiry(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

/** A horizon in calendar days to a real expiry: walk back off a weekend (a 7-day weekly is that Friday), but forward
    if that reaches today (2 days from Friday is Monday). dte 0 is today when open, else the next session. */
export function expiryFor(dte: number, from: Date = today()): Expiry {
  const base = atMidnight(from);
  const want = Math.max(0, Math.round(dte));

  const target = new Date(base);
  target.setDate(target.getDate() + want);

  let date: Date;
  if (want === 0) {
    date = nextSession(base);
  } else {
    date = walkToSession(target, -1);
    if (date <= base) date = walkToSession(target, 1);
  }

  return {
    date,
    label: fmtExpiry(date),
    weekday: WEEKDAY[date.getDay()],
    dte: Math.round((date.getTime() - base.getTime()) / 86400000),
    sessions: sessionsBetween(base, date),
  };
}

/** The expiry at a listed date: a date that is not a session walks back (a holiday Friday's weeklies expire Thursday). */
export function expiryAt(on: Date, from: Date = today()): Expiry {
  const base = atMidnight(from);
  const date = walkToSession(atMidnight(on), -1);
  return {
    date,
    label: fmtExpiry(date),
    weekday: WEEKDAY[date.getDay()],
    dte: Math.round((date.getTime() - base.getTime()) / 86400000),
    sessions: sessionsBetween(base, date),
  };
}

/** The day a listed expiry falls on, read off its own date ("2026-11-18") rather than off a day count: the vendor counts
    its dte from the day its rows were written, so on a weekend or a holiday a count read from today lands a day or more
    late (VIX's Wednesday expiries showed as Thursdays on the Saturday after a Friday). A date that is not a session
    walks back, as expiryAt. Anything but an ISO date falls back to the count. */
export function listedExpiry(iso: string, dte: number, from: Date = today()): Expiry {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? expiryAt(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), from) : expiryFor(dte, from);
}

/* The regular session: 09:30–16:00 New York, 6.5 h, 390 min, defined once. */
const RTH_HOURS = 6.5;
export const RTH_MINUTES = RTH_HOURS * 60;

/* Where in the Globex week a New York instant sits: Sun 18:00 open, Mon–Thu 17:00–18:00 maintenance, Fri 17:00 close;
   Asia 18–03, Europe 03–09:30, RTH, post 16–17. Holidays are the cash market's (an approximation). */
type FuturesPhase = 'GLOBEX_ASIA' | 'GLOBEX_EUROPE' | 'RTH' | 'GLOBEX_POST' | 'MAINTENANCE' | 'CLOSED';

export const FUTURES_PHASE_WORDS: Record<FuturesPhase, { label: string; blurb: string }> = {
  GLOBEX_ASIA: { label: 'GLOBEX · ASIA', blurb: 'The overnight session, Asia hours — the open is being decided out here' },
  GLOBEX_EUROPE: { label: 'GLOBEX · EUROPE', blurb: 'The overnight session, European hours — London is trading the same book' },
  RTH: { label: 'RTH', blurb: 'The cash session — the hours every tape on this desk draws' },
  GLOBEX_POST: { label: 'GLOBEX · POST', blurb: 'Futures still trading in the hour after the cash close' },
  MAINTENANCE: { label: 'MAINTENANCE', blurb: 'The daily 17:00–18:00 ET Globex break — no futures trade in it' },
  CLOSED: { label: 'CLOSED', blurb: 'The futures week runs Sunday 18:00 to Friday 17:00 ET — this is outside it' },
};

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Where a wall-clock instant sits in the Globex week. */
export function futuresPhaseAt(now: Date): FuturesPhase {
  const parts = Object.fromEntries(ET_FMT.formatToParts(now).map(pt => [pt.type, pt.value]));
  const weekday = String(parts.weekday ?? '');
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);

  if (MARKET_HOLIDAYS.has(isoDate(new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))))) return 'CLOSED';
  if (weekday === 'Sat') return 'CLOSED';
  if (weekday === 'Sun') return mins >= 18 * 60 ? 'GLOBEX_ASIA' : 'CLOSED';
  if (weekday === 'Fri' && mins >= 17 * 60) return 'CLOSED';
  if (mins >= 18 * 60) return 'GLOBEX_ASIA';
  if (mins >= 17 * 60) return 'MAINTENANCE';
  if (mins >= 16 * 60) return 'GLOBEX_POST';
  if (mins >= 9 * 60 + 30) return 'RTH';
  if (mins >= 3 * 60) return 'GLOBEX_EUROPE';
  return 'GLOBEX_ASIA';
}
