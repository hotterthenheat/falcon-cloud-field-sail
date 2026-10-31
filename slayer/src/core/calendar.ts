/* The market calendar: whether the market is open on a date, and turning a horizon in days into a real expiry
   (options expire on trading days; anything naming an expiry comes through here). */

import { now } from './clock';
import { nyParts } from './nyTime';

/** US equity market holidays back to 2016 for the replay (incl. 2018-12-05 and 2025-01-09; Juneteenth from 2022),
    mirrored by engine/slayer_core/calendar.py via scripts/calendar-ref.ts. Early closes are not here. */
export const MARKET_HOLIDAYS = new Set([
  // 2016
  '2016-01-01', '2016-01-18', '2016-02-15', '2016-03-25', '2016-05-30',
  '2016-07-04', '2016-09-05', '2016-11-24', '2016-12-26',
  // 2017
  '2017-01-02', '2017-01-16', '2017-02-20', '2017-04-14', '2017-05-29',
  '2017-07-04', '2017-09-04', '2017-11-23', '2017-12-25',
  // 2018
  '2018-01-01', '2018-01-15', '2018-02-19', '2018-03-30', '2018-05-28',
  '2018-07-04', '2018-09-03', '2018-11-22', '2018-12-05', '2018-12-25',
  // 2019
  '2019-01-01', '2019-01-21', '2019-02-18', '2019-04-19', '2019-05-27',
  '2019-07-04', '2019-09-02', '2019-11-28', '2019-12-25',
  // 2020
  '2020-01-01', '2020-01-20', '2020-02-17', '2020-04-10', '2020-05-25',
  '2020-07-03', '2020-09-07', '2020-11-26', '2020-12-25',
  // 2021
  '2021-01-01', '2021-01-18', '2021-02-15', '2021-04-02', '2021-05-31',
  '2021-07-05', '2021-09-06', '2021-11-25', '2021-12-24',
  // 2022
  '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20',
  '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
  // 2023
  '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07', '2023-05-29',
  '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
  // 2024
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
  '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  // 2025
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/* Holidays the Theta terminal reports for the live year. Additive: the
   list above stays, so a replay that never hears from the terminal still
   refuses Good Friday 2019. An empty set changes nothing. */
const LIVE_HOLIDAYS = new Set<string>();

/** Cash session ends at 1:00 PM ET (12:00 PM CT) on these dates, back to 2016 for the replay (the day after
    Thanksgiving, and July 3 and December 24 when they are weekdays and not themselves holidays). Not holidays, and not a
    reason to invent a bar. */
export const EARLY_CLOSES = new Set([
  '2016-11-25',
  '2017-07-03', '2017-11-24',
  '2018-07-03', '2018-11-23', '2018-12-24',
  '2019-07-03', '2019-11-29', '2019-12-24',
  '2020-11-27', '2020-12-24',
  '2021-11-26',
  '2022-11-25',
  '2023-07-03', '2023-11-24',
  '2024-07-03', '2024-11-29', '2024-12-24',
  '2025-07-03', '2025-11-28', '2025-12-24',
  '2026-11-27', '2026-12-24',
  '2027-11-26',
]);

export const isEarlyClose = (iso: string): boolean => EARLY_CLOSES.has(iso);

/** Minute of the New York day the cash session ends on a date (YYYY-MM-DD): 13:00 on an early close, else 16:00. */
export const sessionCloseMinOn = (iso: string): number => (EARLY_CLOSES.has(iso) ? 13 * 60 : 16 * 60);

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

/** The day the book is on: New York's date until 16:00, the next day after, because today's contracts stop at 4:00
    (the 16:15 close is for index and ETF options not expiring that day). */
export function bookToday(): Date {
  const p = nyParts(now());
  const after = p.hour * 60 + p.minute >= 16 * 60;
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
