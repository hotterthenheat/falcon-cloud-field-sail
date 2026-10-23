/*
  RELATIVE DAYS, FROM THE CLOCK (audit round 5, 2026-10-23): at 01:00 ET on Fri Oct 23 the last session was Thu Oct 22,
  and Trace still said "expires tomorrow" of an Oct 23 contract, "expires today" of an Oct 22 one, "expiring today" of
  the Oct 22 0DTE book and "rose overnight" of the Oct 21 → Oct 22 open interest. Every relative-day word on Trace comes
  from here: New York's calendar day against the data's session day. When the data is a past session's, its date is
  named ("Oct 22"), never "today".
*/

import { isoDate, isTradingDay } from '../../core/calendar';
import { nyIsoToday, tapeSessionIso } from '../../data/traceLive';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parse = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
};
/** "MM/DD/YYYY" or "YYYY-MM-DD" → "YYYY-MM-DD" */
export function isoOf(expiry: string): string {
  const us = expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1]}-${us[2]}` : expiry.slice(0, 10);
}
/** "Oct 22" */
export function shortDay(iso: string): string {
  const p = parse(isoOf(iso));
  return p ? `${MONTHS[p.mo - 1]} ${p.d}` : iso;
}
/** Whole calendar days from New York's today to the day (negative = past) */
export function daysFromToday(iso: string): number {
  const p = parse(isoOf(iso));
  const t = parse(nyIsoToday());
  if (!p || !t) return NaN;
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(t.y, t.mo - 1, t.d)) / 86_400_000);
}
/** True when the data's session is New York's today */
export const isLiveDay = (sessionIso: string = tapeSessionIso()) => sessionIso === nyIsoToday();
/** "today" — or "on Oct 22" when the data is a past session's */
export const dayAdv = (sessionIso: string = tapeSessionIso()) => (isLiveDay(sessionIso) ? 'today' : `on ${shortDay(sessionIso)}`);
/** "today's" — or "Oct 22's" */
export const dayPos = (sessionIso: string = tapeSessionIso()) => (isLiveDay(sessionIso) ? "today's" : `${shortDay(sessionIso)}'s`);
/** "Today" — or "Oct 22" (a label) */
export const dayLabel = (sessionIso: string = tapeSessionIso()) => (isLiveDay(sessionIso) ? 'Today' : shortDay(sessionIso));
/** The session before a session day, YYYY-MM-DD */
export function prevSessionIso(sessionIso: string = tapeSessionIso()): string {
  const p = parse(sessionIso);
  if (!p) return sessionIso;
  const d = new Date(p.y, p.mo - 1, p.d);
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  return isoDate(d);
}
/** The open-interest change in words: "overnight" while the session is today's, else "from Oct 21 to Oct 22" */
export const oiSpanWords = (sessionIso: string = tapeSessionIso()) => (isLiveDay(sessionIso) ? 'overnight' : `from ${shortDay(prevSessionIso(sessionIso))} to ${shortDay(sessionIso)}`);
/** A contract's expiry against New York's today: "expires today", "expires tomorrow", "expires in 3 days", "expired
    yesterday (Oct 22)", "expired Oct 20" */
export function expiryWords(expiry: string): string {
  const n = daysFromToday(expiry);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'expires today';
  if (n === 1) return 'expires tomorrow';
  if (n > 1) return `expires in ${n} days`;
  if (n === -1) return `expired yesterday (${shortDay(expiry)})`;
  return `expired ${shortDay(expiry)}`;
}
/** The same-day expiry of a session in words: "expiring today" — or "expiring Oct 22" (expired at that bell) */
export const sameDayWords = (sessionIso: string = tapeSessionIso()) => (isLiveDay(sessionIso) ? 'expiring today' : `expiring ${shortDay(sessionIso)}`);
/** A contract row's next report in words — earnDays counts TRADING days (sessions) from the tape's session, so it says
    so (audit round 5: "Earnings in 19d" beside a DTE column of calendar days read as 19 calendar days; NVDA reports
    Wed Nov 18, 26 calendar days out) */
export function earnWords(r: { earnDays: number | null; earnIso?: string | null }): { text: string; title: string } | null {
  if (r.earnDays == null) return null;
  const date = r.earnIso ? shortDay(r.earnIso) : '';
  const cal = r.earnIso ? daysFromToday(r.earnIso) : NaN;
  const text = r.earnDays === 0 ? (Number.isFinite(cal) && cal === 0 ? 'today' : date || 'this session') : `${r.earnDays} trading day${r.earnDays === 1 ? '' : 's'}`;
  const title = `The name's next report${date ? `, ${date}` : ''}: ${r.earnDays} trading day${r.earnDays === 1 ? '' : 's'} (sessions) from the ${shortDay(tapeSessionIso())} session${Number.isFinite(cal) ? ` · ${cal} calendar day${Math.abs(cal) === 1 ? '' : 's'} from today` : ''}`;
  return { text, title };
}
