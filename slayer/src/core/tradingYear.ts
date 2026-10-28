import { isTradingDay } from './calendar';
import { nyParts, SESSION_CLOSE_MIN, SESSION_LENGTH_MIN, SESSION_OPEN_MIN } from './nyTime';

/** Sessions in the year the desk decays on. Not 365. */
export const TRADING_DAYS = 252;
const DAY = 86_400_000;
/** A leg at the bell stays finite. Five trading minutes, not five clock minutes. */
const FLOOR_MIN = 5;

/**
 * Trading minutes left until 16:00 ET on `expiry`. Weekends and the overnight do not count.
 * Null once that close has passed. `floor` keeps five trading minutes so a re-price at the bell does not explode.
 */
export function tradingMinutes(expiry: string, nowMs = Date.now(), floor = false): number | null {
  const [ey, em, ed] = expiry.split('-').map(Number);
  if (!ey || !em || !ed) return null;
  const p = nyParts(nowMs);
  const start = Date.UTC(p.year, p.month - 1, p.day);
  const end = Date.UTC(ey, em - 1, ed);
  if (end < start) return floor ? FLOOR_MIN : null;
  let minutes = 0;
  for (let t = start; t <= end; t += DAY) {
    const utc = new Date(t);
    const day = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    if (!isTradingDay(day)) {
      if (t === end) return floor ? FLOOR_MIN : null;
      continue;
    }
    if (t === start) {
      const nowMin = p.hour * 60 + p.minute;
      if (nowMin >= SESSION_CLOSE_MIN) {
        if (t === end) return floor ? FLOOR_MIN : null;
        continue;
      }
      minutes += SESSION_CLOSE_MIN - Math.max(nowMin, SESSION_OPEN_MIN);
    } else minutes += SESSION_LENGTH_MIN;
  }
  if (!(minutes > 0)) return floor ? FLOOR_MIN : null;
  return floor ? Math.max(FLOOR_MIN, minutes) : minutes;
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
