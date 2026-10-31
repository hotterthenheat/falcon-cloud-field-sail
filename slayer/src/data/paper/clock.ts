/* The paper account's clock: New York's wall clock, the trading day, the bell and years to expiry, as pure
   functions of an instant so the engine can be handed any moment. */

import { isTradingDay, isoDate, sessionCloseMinOn, sessionLengthOn, MONTHS } from '../../core/calendar';
import { nyClock } from '../../core/nyTime';

/** The minutes after midnight New York's clock names: the open, the bell, the flat-by and the roll */
export const OPEN_MIN = 9 * 60 + 30;
export const BELL_MIN = 16 * 60;
const FLAT_MIN = 16 * 60 + 59;
const ROLL_MIN = 17 * 60;
/** A full session's minutes — the unit the trading year counts in (an early close is 210 of them) */
const SESSION_MIN = BELL_MIN - OPEN_MIN;

/** Minute of New York's day the options session closes on a date: 16:00, 13:00 on an early close (core/calendar) */
export const closeMinOn = (date: string): number => sessionCloseMinOn(date);
/** A plan's time written against the 16:00 bell ("15:55", "15:59", "16:10"), on a date's real session. On a full day it
    is itself. On an early close (13:00) a time from 15:00 on keeps its distance from the bell — 15:55 → 12:55, 15:59 →
    12:59, 16:10 → 13:10 (a late name's 16:15 close is 13:15) — and a time between the early close and 15:00 is the minute
    before it (12:59). A time before the early close stands. */
export function sessionTimeOn(date: string, minutes: number): number {
  const close = sessionCloseMinOn(date);
  if (close === BELL_MIN || minutes < close) return minutes;
  if (minutes >= BELL_MIN - 60) return close + (minutes - BELL_MIN);
  return close - 1;
}

interface NyTime {
  /** New York's date, YYYY-MM-DD */
  date: string;
  /** Minutes after New York's midnight */
  minutes: number;
  /** Seconds into that minute */
  seconds: number;
  /** 0 Sunday … 6 Saturday */
  weekday: number;
}

let fmt: Intl.DateTimeFormat | null = null;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** New York's wall clock at an instant (ms) */
export function nyAt(ms: number): NyTime {
  fmt ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), seconds: Number(p.second), weekday: WEEKDAYS[p.weekday] ?? 0 };
}

/** A date as the calendar's Date (local noon — isTradingDay and isoDate read its local fields) */
export const dateAt = (iso: string): Date => new Date(`${iso}T12:00:00`);
/** The date `n` days after an ISO date */
export function addDays(iso: string, n: number): string {
  const d = dateAt(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
/** The first trading day at or after a date */
export function sessionFrom(iso: string): string {
  let d = iso;
  for (let i = 0; i < 12 && !isTradingDay(dateAt(d)); i++) d = addDays(d, 1);
  return d;
}

/** The instant (ms) New York's clock reads `minutes` after midnight on `date` — guessed as winter's (UTC−5) and set right
    by what New York reads then. Daylight saving changes at 02:00 on a Sunday: every time asked of here is clear of it. */
export function nyInstant(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number);
  let at = Date.UTC(y, m - 1, d, 0, minutes) + 5 * 3600_000;
  for (let i = 0; i < 2; i++) {
    const got = nyAt(at);
    const drift = (got.date === date ? got.minutes : got.date > date ? got.minutes + 1440 : got.minutes - 1440) - minutes;
    if (drift === 0) break;
    at -= drift * 60_000;
  }
  return at;
}

/** The trading day a moment belongs to: the one that ends after it (17:00 New York is the edge) */
export function tradingDayOf(ms: number): string {
  const t = nyAt(ms);
  return sessionFrom(t.minutes >= ROLL_MIN ? addDays(t.date, 1) : t.date);
}
/** When a trading day ends: 17:00 New York on its date */
export const dayEndsAt = (day: string): number => nyInstant(day, ROLL_MIN);
/** When it began: 17:00 on the session before it */
export function dayBeginsAt(day: string): number {
  let d = addDays(day, -1);
  for (let i = 0; i < 12 && !isTradingDay(dateAt(d)); i++) d = addDays(d, -1);
  return nyInstant(d, ROLL_MIN);
}
/** The options session's close on a date — 16:00 New York, 13:00 on an early close: when a contract expiring that day
    settles and the session's orders stop filling */
export const bellOf = (date: string): number => nyInstant(date, sessionCloseMinOn(date));
/** 16:59 New York on a trading day — an evaluation's flat-by */
export const flatByOf = (day: string): number => nyInstant(day, FLAT_MIN);

/** Years of trading time an option has left at an instant, on the trading clock (core/tradingYear): the session minutes
    still to come today (all of it before the open, none after the close, none on a day with no session) and every
    session's minutes after today up to the expiry's close — an early close counts its 210 minutes, not 390 — over
    390 × 252. Unlike tradingYears it has no five-minute floor and counts the seconds: 0 at the close. */
export function yearsToExpiry(expiry: string, ms: number): number {
  const t = nyAt(ms);
  if (expiry < t.date) return 0;
  let minutes = 0;
  if (isTradingDay(dateAt(t.date))) {
    const close = sessionCloseMinOn(t.date);
    const now = t.minutes + t.seconds / 60;
    minutes += t.minutes < OPEN_MIN ? close - OPEN_MIN : Math.max(0, close - now);
  }
  return (minutes + sessionMinutesAfter(t.date, expiry)) / (SESSION_MIN * 252);
}
/** Session minutes on the trading days after `from` up to and including `to` — kept, every quote asks the same few */
const afterMemo = new Map<string, number>();
function sessionMinutesAfter(from: string, to: string): number {
  const key = `${from}|${to}`;
  let v = afterMemo.get(key);
  if (v != null) return v;
  v = 0;
  for (let d = addDays(from, 1), guard = 0; d <= to && guard < 4000; d = addDays(d, 1), guard++) if (isTradingDay(dateAt(d))) v += sessionLengthOn(d);
  if (afterMemo.size > 5000) afterMemo.clear();
  afterMemo.set(key, v);
  return v;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "7:55 AM CT" — the desk's clock. The trading day underneath is still New York's. */
const nyClockWords = (ms: number): string => nyClock(ms, { zone: true });
/** "Sep 22 · 14:03" in New York */
export const nyMomentWords = (ms: number): string => {
  const t = nyAt(ms);
  return `${MONTHS[Number(t.date.slice(5, 7)) - 1]} ${Number(t.date.slice(8))} · ${nyClockWords(ms)}`;
};
/** A trading day in words: "Tue, Sep 22" */
export const dayWords = (day: string): string => {
  const d = dateAt(day);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
