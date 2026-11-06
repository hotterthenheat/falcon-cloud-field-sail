/*
  CLOCK TO THE SECOND (audit 2026-11-06, finding 1). The page's time to expiry once ignored the seconds: trading minutes
  were whole New York minutes (hour·60 + minute) and the memo was per minute, so at 09:30:49 the front date read 390
  minutes where 389.18 are left (the live check's tPm, with the seconds, was 0.3–1.0 minute off on every run, the SPX AM
  monthly likewise). This proof prices every clock the page uses against an INDEPENDENT seconds-exact computation written
  here (New York wall time by Intl, the NYSE's published tables in shared/marketCalendar.mjs — no app code in the
  arithmetic) at instants with seconds in them, within 1e-9 relative:

    tradingYears / tradingMinutes   PM contracts, to 16:00 (13:00 on an early close) of the date, five minutes at the least
    amTradingYears                  an index's AM monthly, to 09:30 of its date (the previous session's close), null after
    calendarYears / amCalendarYears the calendar-year fractions the vendor's vols are on (New York's wall clock)
    tradingMinutesBetween           the session minutes between two instants (the net path's clock)

  at 09:30:49, 15:59:30, before the open (09:29:45), on a half day (2026-11-27), across the weekend, across a holiday
  and across the spring DST change; and the memo never freezes a minute (09:30:00 and 09:30:49 differ by 49 s).
*/
import { EARLY_CLOSE_DATES, HOLIDAY_DATES } from '../shared/marketCalendar.mjs';
import { tradingMinutes, tradingMinutesBetween, tradingYears } from '../src/core/tradingYear';
import { amCalendarYears, amTradingYears } from '../src/core/settle';
import { calendarYears } from '../src/core/volClock';

/* ---- the independent clock ---- */
const HOL = new Set<string>(HOLIDAY_DATES as string[]);
const EARLY = new Set<string>(EARLY_CLOSE_DATES as string[]);
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function ny(ms: number): { iso: string; min: number } {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const frac = (ms - Math.floor(ms / 1000) * 1000) / 60_000;
  return { iso: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 + frac };
}
const isSession = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6 && !HOL.has(iso);
};
const closeOf = (iso: string) => (EARLY.has(iso) ? 13 * 60 : 16 * 60);
const OPEN = 9 * 60 + 30;
const YEAR_MIN = 390 * 252;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The instant New York reads `iso` at `min` minutes, by search (DST-safe without a table) */
function at(iso: string, min: number): number {
  let t = Date.parse(`${iso}T00:00:00Z`) + (min + 300) * 60_000;
  for (let i = 0; i < 4; i++) {
    const p = ny(t);
    const dayOff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${p.iso}T00:00:00Z`)) / 86_400_000);
    t += (dayOff * 1440 + min - p.min) * 60_000;
  }
  return Math.round(t);
}
function tradeMin(ms: number, end: string, endMin: number): number {
  const now = ny(ms);
  let total = 0;
  for (let d = now.iso; d <= end; d = addDays(d, 1)) {
    if (!isSession(d)) continue;
    const to = d === end ? Math.min(endMin, closeOf(d)) : closeOf(d);
    const from = d === now.iso ? Math.max(OPEN, now.min) : OPEN;
    if (to > from) total += to - from;
  }
  return total;
}
const tPm = (ms: number, exp: string) => Math.max(5, tradeMin(ms, exp, closeOf(exp))) / YEAR_MIN;
const tAm = (ms: number, exp: string) => (ms >= at(exp, OPEN) ? null : Math.max(5, tradeMin(ms, exp, OPEN)) / YEAR_MIN);
/* the calendar year on New York's wall clock, as the vendors count days: whole days to the date × 1440 plus the minutes of
   the day (across a DST change the wall clock's minutes, not the hour more or less that elapses) */
const wallMin = (ms: number, exp: string, endMin: number) => {
  const now = ny(ms);
  const days = Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${now.iso}T00:00:00Z`)) / 86_400_000);
  return days * 1440 + endMin - now.min;
};
const cPm = (ms: number, exp: string) => Math.max(5, wallMin(ms, exp, closeOf(exp))) / (365 * 1440);
const cAm = (ms: number, exp: string) => Math.max(5, wallMin(ms, exp, OPEN)) / (365 * 1440);
function between(a: number, b: number): number {
  if (!(b > a)) return 0;
  const A = ny(a);
  const B = ny(b);
  let total = 0;
  for (let d = A.iso; d <= B.iso; d = addDays(d, 1)) {
    if (!isSession(d)) continue;
    const c = closeOf(d);
    const clamp = (m: number) => Math.min(c, Math.max(OPEN, m));
    const from = d === A.iso ? clamp(A.min) : OPEN;
    const to = d === B.iso ? clamp(B.min) : c;
    if (to > from) total += to - from;
  }
  return total;
}

/* ---- the checks ---- */
let fails = 0;
let checks = 0;
const near = (what: string, page: number | null, hand: number | null) => {
  checks++;
  const ok = page == null || hand == null ? page == null && hand == null : Math.abs(page / hand - 1) <= 1e-9;
  if (!ok) {
    fails++;
    console.log(`FAIL ${what}: page ${page} hand ${hand}${page != null && hand != null ? ` (${((page / hand - 1) * 100).toExponential(2)}%, ${((page - hand) * YEAR_MIN).toFixed(4)} trading min)` : ''}`);
  }
};
const sec = (iso: string, h: number, m: number, s: number, msPart = 0) => at(iso, h * 60 + m) + s * 1000 + msPart;

const instants: [string, number][] = [
  ['Fri 09:30:49', sec('2026-11-06', 9, 30, 49)],
  ['Fri 09:29:45 (before the open)', sec('2026-11-06', 9, 29, 45)],
  ['Fri 10:30:07.250', sec('2026-11-06', 10, 30, 7, 250)],
  ['Fri 15:59:30', sec('2026-11-06', 15, 59, 30)],
  ['Fri 15:56:30 (the floor)', sec('2026-11-06', 15, 56, 30)],
  ['Fri 16:00:00 (the close)', sec('2026-11-06', 16, 0, 0)],
  ['Sat 14:00:13 (the weekend)', sec('2026-11-07', 14, 0, 13)],
  ['Thu 11:00:20 (Thanksgiving)', sec('2026-11-26', 11, 0, 20)],
  ['half day 10:15:41', sec('2026-11-27', 10, 15, 41)],
  ['half day 12:59:30', sec('2026-11-27', 12, 59, 30)],
  ['Fri 2026-03-06 15:00:30 (before the DST change)', sec('2026-03-06', 15, 0, 30)],
  ['Fri 2026-11-20 09:29:59.5 (the AM monthly settles at 09:30)', sec('2026-11-20', 9, 29, 59, 500)],
];
const expiries = ['2026-11-06', '2026-11-09', '2026-11-13', '2026-11-20', '2026-11-27', '2026-11-30', '2026-12-18', '2027-01-15', '2026-03-06', '2026-03-09', '2026-03-20'];
for (const [label, t] of instants) {
  for (const x of expiries) {
    const sessionsLeft = tradeMin(t, x, closeOf(x));
    /* a PM contract the clock has passed is not priced: both sides floor to five minutes */
    if (x < ny(t).iso && sessionsLeft === 0) continue;
    near(`${label} → ${x} tradingYears`, tradingYears(x, t), tPm(t, x));
    const left = tradingMinutes(x, t, false);
    const handLeft = tradeMin(t, x, closeOf(x));
    near(`${label} → ${x} tradingMinutes`, left, handLeft > 0 && isSession(x) ? handLeft : null);
    near(`${label} → ${x} calendarYears`, calendarYears(x, t), cPm(t, x));
    /* the AM monthly clock on the third Fridays (and any date: the rule is the date's 09:30) */
    if (['2026-11-20', '2026-12-18', '2027-01-15', '2026-03-20'].includes(x)) {
      near(`${label} → ${x} amTradingYears`, amTradingYears(x, t), tAm(t, x));
      near(`${label} → ${x} amCalendarYears`, amCalendarYears(x, t), cAm(t, x));
    }
  }
}
/* the session minutes between two instants with seconds (the net path's clock), across the weekend and the half day */
const pairs: [number, number][] = [
  [sec('2026-11-06', 9, 30, 49), sec('2026-11-06', 15, 59, 30)],
  [sec('2026-11-06', 15, 59, 30), sec('2026-11-09', 9, 31, 15)],
  [sec('2026-11-25', 12, 0, 1), sec('2026-11-27', 12, 59, 30)],
  [sec('2026-11-06', 9, 0, 59), sec('2026-11-06', 9, 30, 0, 1)],
];
for (const [a, b] of pairs) {
  checks++;
  const page = tradingMinutesBetween(a, b);
  const hand = between(a, b);
  if (Math.abs(page - hand) > 1e-9 * Math.max(1, hand)) {
    fails++;
    console.log(`FAIL tradingMinutesBetween ${new Date(a).toISOString()} → ${new Date(b).toISOString()}: page ${page} hand ${hand}`);
  }
}
/* the memo never freezes a minute: two reads 49 s apart inside one minute are 49 s apart */
{
  checks++;
  const a = tradingMinutes('2026-11-06', sec('2026-11-06', 9, 30, 0), false)!;
  const b = tradingMinutes('2026-11-06', sec('2026-11-06', 9, 30, 49), false)!;
  if (Math.abs(a - b - 49 / 60) > 1e-9) {
    fails++;
    console.log(`FAIL the memo froze the minute: 09:30:00 ${a} and 09:30:49 ${b} (want ${49 / 60} apart)`);
  }
  /* and the same instant asked again answers the same (the memo is the walk, not the answer) */
  checks++;
  const c = tradingMinutes('2026-11-06', sec('2026-11-06', 9, 30, 49), false)!;
  if (c !== b) {
    fails++;
    console.log(`FAIL the memo answered ${c} then ${b} at one instant`);
  }
}
/* the floor, the close and the AM settlement, by value */
{
  const close = sec('2026-11-06', 16, 0, 0);
  checks += 4;
  if (tradingMinutes('2026-11-06', close, false) !== null) fails++, console.log('FAIL the front date still open at 16:00:00');
  if (tradingMinutes('2026-11-06', close - 1, false) == null) fails++, console.log('FAIL the front date shut at 15:59:59.999');
  if (Math.abs(tradingYears('2026-11-06', sec('2026-11-06', 15, 58, 0)) - 5 / YEAR_MIN) > 1e-15) fails++, console.log('FAIL the five-minute floor');
  if (amTradingYears('2026-11-20', sec('2026-11-20', 9, 30, 0)) !== null) fails++, console.log('FAIL the AM monthly still live at 09:30:00 of its date');
}

if (fails) {
  console.log(`clock seconds proof: ${fails} of ${checks} checks FAILED`);
  process.exit(1);
}
console.log(`clock seconds proof ok: ${checks} checks, every clock equals the seconds-exact hand clock within 1e-9`);
