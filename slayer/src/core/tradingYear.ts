import { isTradingDay, sessionCloseMinOn } from './calendar';
import { nyMinutesExact, nyParts, SESSION_LENGTH_MIN, SESSION_OPEN_MIN } from './nyTime';

/** Sessions in the year the desk decays on. Not 365. */
export const TRADING_DAYS = 252;
const DAY = 86_400_000;
/** A leg at the bell stays finite. Five trading minutes, not five clock minutes. */
const FLOOR_MIN = 5;

/** The cash close of the UTC-midnight day `t` (ms), minutes after midnight New York: 13:00 on an early close. */
const closeOfUtc = (t: number): number => sessionCloseMinOn(new Date(t).toISOString().slice(0, 10));

/** Is the UTC-midnight day `t` (ms) a session — memoised, every leg of every book asks the same few hundred days. */
const sessionDay = new Map<number, boolean>();
function isSessionUtc(t: number): boolean {
  let v = sessionDay.get(t);
  if (v == null) {
    const utc = new Date(t);
    v = isTradingDay(new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()));
    if (sessionDay.size > 50_000) sessionDay.clear();
    sessionDay.set(t, v);
  }
  return v;
}

/* CONTINUOUS (audit 2026-11-06, finding 1). The time to expiry once ran on whole New York minutes (hour·60 + minute):
   09:30:49 read as 09:30, so every front-date fraction was 0.3–1.0 minute long against the seconds-exact clock, and the
   memo held it for the whole minute. Now the clock is exact to the millisecond: the walk over the days (sessions,
   holidays, early closes) depends only on the expiry and the New York minute, so it is memoised per (expiry, minute) as
   the whole minutes from the START of that minute, with a flag saying whether that minute lies inside a session the
   walk counts from; the seconds already gone in it come off that, exactly (minutes − fraction). The five-minute floor
   and the null past the close are applied after, on the continuous value. */
interface MinuteWalk {
  /** Trading minutes from the start of the New York minute, unfloored; null once the expiry is past (or not a session) */
  minutes: number | null;
  /** The minute is inside a counted session (open ≤ minute < close on the start day): its elapsed fraction comes off */
  running: boolean;
}
const minutesMemo = new Map<string, MinuteWalk>();

/** Trading minutes left until the cash close (16:00 ET, 13:00 on an early close) on `expiry` (weekends and overnight do not
    count), continuous to the millisecond; null once past. `floor` keeps five minutes. */
export function tradingMinutes(expiry: string, nowMs = Date.now(), floor = false): number | null {
  const minute = Math.floor(nowMs / 60_000);
  const key = `${expiry}|${minute}`;
  let walk = minutesMemo.get(key);
  if (walk === undefined) {
    walk = minuteWalk(expiry, minute * 60_000);
    if (minutesMemo.size > 20_000) minutesMemo.clear();
    minutesMemo.set(key, walk);
  }
  if (walk.minutes == null) return floor ? FLOOR_MIN : null;
  const minutes = walk.running ? walk.minutes - (nowMs - minute * 60_000) / 60_000 : walk.minutes;
  if (!(minutes > 0)) return floor ? FLOOR_MIN : null;
  return floor ? Math.max(FLOOR_MIN, minutes) : minutes;
}

/** The walk at the start of a New York minute (`minuteMs` a whole minute): whole trading minutes left from it */
function minuteWalk(expiry: string, minuteMs: number): MinuteWalk {
  const past: MinuteWalk = { minutes: null, running: false };
  const [ey, em, ed] = expiry.split('-').map(Number);
  if (!ey || !em || !ed) return past;
  const p = nyParts(minuteMs);
  const start = Date.UTC(p.year, p.month - 1, p.day);
  const end = Date.UTC(ey, em - 1, ed);
  if (end < start) return past;
  let minutes = 0;
  let running = false;
  for (let t = start; t <= end; t += DAY) {
    if (!isSessionUtc(t)) {
      if (t === end) return past;
      continue;
    }
    const close = closeOfUtc(t);
    if (t === start) {
      const nowMin = p.hour * 60 + p.minute;
      if (nowMin >= close) {
        if (t === end) return past;
        continue;
      }
      running = nowMin >= SESSION_OPEN_MIN;
      minutes += close - Math.max(nowMin, SESSION_OPEN_MIN);
    } else minutes += close - SESSION_OPEN_MIN;
  }
  return { minutes, running };
}

/** Regular-session minutes between two instants (0 when `b` is not after `a`), continuous to the millisecond. Walks only
    the days between them. */
export function tradingMinutesBetween(a: number, b: number): number {
  if (!(b > a)) return 0;
  const pa = nyParts(a);
  const pb = nyParts(b);
  const start = Date.UTC(pa.year, pa.month - 1, pa.day);
  const end = Date.UTC(pb.year, pb.month - 1, pb.day);
  const minA = nyMinutesExact(a);
  const minB = nyMinutesExact(b);
  let total = 0;
  for (let t = start; t <= end; t += DAY) {
    if (!isSessionUtc(t)) continue;
    const close = closeOfUtc(t);
    const clamp = (m: number) => Math.min(close, Math.max(SESSION_OPEN_MIN, m));
    const from = t === start ? clamp(minA) : SESSION_OPEN_MIN;
    const to = t === end ? clamp(minB) : close;
    if (to > from) total += to - from;
  }
  return total;
}

/** Years on the 252-session clock. The floor is five trading minutes. */
export function tradingYears(expiry: string, nowMs = Date.now()): number {
  const minutes = tradingMinutes(expiry, nowMs, true) ?? FLOOR_MIN;
  return minutes / (SESSION_LENGTH_MIN * TRADING_DAYS);
}

/** False from the cash close on the expiry's own day. The five-minute floor is for a re-price, not for keeping the column. */
export function expiryOpen(expiry: string, nowMs = Date.now()): boolean {
  return tradingMinutes(expiry, nowMs, false) != null;
}
