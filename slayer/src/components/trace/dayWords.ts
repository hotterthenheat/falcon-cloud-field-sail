/*
  RELATIVE DAYS, FROM THE CLOCK (audit round 5, 2026-10-23): at 01:00 ET on Fri Oct 23 the last session was Thu Oct 22,
  and Trace still said "expires tomorrow" of an Oct 23 contract, "expires today" of an Oct 22 one, "expiring today" of
  the Oct 22 0DTE book and "rose overnight" of the Oct 21 → Oct 22 open interest. Every relative-day word on Trace comes
  from here: New York's calendar day against the data's session day. When the data is a past session's, its date is
  named ("Oct 22"), never "today".
*/

import { isoDate, isTradingDay } from '../../core/calendar';
import { LEAN_EDGE, nyDateOf, nyIsoToday, tapeSessionIso } from '../../data/traceLive';

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
/** An even day's share, never rounded up onto the edge it fell short of ("54.6", not "55") */
export const shyPct = (v: number) => (Math.round(v) >= LEAN_EDGE ? (Math.floor(v * 10) / 10).toFixed(1) : String(Math.round(v)));
/** A window of prints in words, its day named when it is not New York's today (audit round 6: an after-hours window read
    "16:38:05–17:11:50 ET" at 04:15 the next morning): "Oct 22 16:38:05–17:11:50", "Oct 21 15:59:58–Oct 22 09:31:02",
    or "09:30:01–09:41:15" on today's session. Null when no row carries a time. */
export function spanWords(xs: readonly { time: string; epochMs?: number }[]): string | null {
  const timed = xs.filter(r => r.time && r.time !== '—');
  if (!timed.length) return null;
  const withMs = timed.filter(r => (r.epochMs ?? 0) > 0);
  if (withMs.length !== timed.length) {
    const times = timed.map(r => r.time).sort();
    return `${times[0]}–${times[times.length - 1]}`;
  }
  let first = withMs[0];
  let last = withMs[0];
  for (const r of withMs) {
    if ((r.epochMs ?? 0) < (first.epochMs ?? 0)) first = r;
    if ((r.epochMs ?? 0) > (last.epochMs ?? 0)) last = r;
  }
  const d0 = nyDateOf(first.epochMs!);
  const d1 = nyDateOf(last.epochMs!);
  const today = nyIsoToday();
  if (d0 === d1) return d0 === today ? `${first.time}–${last.time}` : `${shortDay(d0)} ${first.time}–${last.time}`;
  return `${shortDay(d0)} ${first.time}–${shortDay(d1)} ${last.time}`;
}

/* ---- WHOSE TRADING THE OPEN INTEREST REFLECTS (audit round 7, major 2) ----------------------------------------------
   A count of open interest is set the morning after a session trades. Each book row carries the session its volume is
   from (volDay) and the session whose trading set the count it shows (oiDay — traceLive usePairedOi): the same day once
   the vendor publishes the count after the volume, the session before until then (oiPending). Pages name that day
   ("OI after Oct 22's trading") and keep a row that lags out of any sum with the rest. */
type OiRow = { oiDay?: string; volDay?: string; oiPending?: boolean; expired?: boolean };
export interface OiCover {
  /** The newest session whose trading the rows' counts reflect */
  day: string | null;
  /** The volume's session of those rows */
  volDay: string | null;
  /** Rows whose count is an earlier session's than `day` */
  lagging: number;
  /** Every row's count is the session before its volume's (the volume's own is not out — the live session) */
  allPending: boolean;
}
export function oiCoverOf(rows: readonly OiRow[]): OiCover {
  let day: string | null = null;
  let volDay: string | null = null;
  for (const r of rows) {
    if (r.oiDay && (!day || r.oiDay > day)) day = r.oiDay;
    if (r.volDay && (!volDay || r.volDay > volDay)) volDay = r.volDay;
  }
  const lagging = day ? rows.filter(r => r.oiDay && r.oiDay < day!).length : 0;
  return { day, volDay, lagging, allPending: rows.length > 0 && rows.every(r => r.oiPending) };
}
/** "after Oct 22's trading" (or "after the last close" when no row says) */
export const oiAfterWords = (day: string | null) => (day ? `after ${shortDay(day)}'s trading` : 'as of the last count');
/** "in Oct 22's trading" — the session a change of open interest was made in */
export const oiInWords = (day: string | null) => (day ? `in ${shortDay(day)}'s trading` : 'since the count before');
/** A row lags the cover: its count is an earlier session's */
export const oiLags = (r: OiRow, cover: OiCover) => !!(cover.day && r.oiDay && r.oiDay < cover.day);
/** One row's open interest in a hover: whose trading it reflects, and whether the volume's own count is out */
export function oiRowTitle(r: OiRow): string {
  if (!r.oiDay) return 'Open interest as of the last count';
  const set = `Open interest after ${shortDay(r.oiDay)}'s trading (counted the morning after); ΔOI is what ${shortDay(r.oiDay)}'s trading built or unwound`;
  if (!r.oiPending || !r.volDay || r.volDay === r.oiDay) return set;
  return `${set} — the count after ${isLiveDay(r.volDay) ? "today's" : `${shortDay(r.volDay)}'s`} trading, the volume shown, is ${isLiveDay(r.volDay) ? 'set tomorrow morning' : 'not out for this contract yet'}`;
}
/** The pending note for a page's sub-line: "" when the counts pair with the volume */
export function oiPendingWords(cover: OiCover): string {
  if (!cover.day) return '';
  if (cover.allPending && cover.volDay && cover.volDay !== cover.day) return `${isLiveDay(cover.volDay) ? "today's" : `${shortDay(cover.volDay)}'s`} build is counted ${isLiveDay(cover.volDay) ? 'tomorrow morning' : 'once the vendor publishes it'}`;
  if (cover.lagging) return `${cover.lagging} contract${cover.lagging === 1 ? '' : 's'} still on the count before (marked) — kept out of the sums`;
  return '';
}
