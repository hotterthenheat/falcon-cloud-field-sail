/*
  The terminal's holidays (/calendar/year_holidays) merged into the calendar (core/calendar.ts mergeLiveHolidays,
  data/holidayFeed.ts), the hard-coded table (shared/marketCalendar.mjs) winning on every disagreement, each logged.

  Known numbers: the terminal's answers for 2025, 2026 and 2027 (scripts/fixtures/theta-carry/holidays-*.json, read
  2026-10-31; 2028 answered "no data"): 2025 11 full closes (the 2025-01-09 national day of mourning among them) and
  3 early closes; 2026 10 and 2 (11-27, 12-24 at 13:00); 2027 10 and 1.
  Run:  npx tsx scripts/holidays-proof.ts
*/
import fs from 'node:fs';
import { isEarlyClose, isTradingDay, mergeLiveHolidays, sessionCloseMinOn } from '../src/core/calendar';
import { parseHolidays, holidayPath } from '../src/data/holidayFeed';
import { thetaTtl } from '../shared/thetaPaths.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const read = (y: number) => parseHolidays(JSON.parse(fs.readFileSync(`scripts/fixtures/theta-carry/holidays-${y}.json`, 'utf8')));

for (const [y, full, early] of [[2025, 11, 3], [2026, 10, 2], [2027, 10, 1]] as const) {
  const rows = read(y);
  const logged: string[] = [];
  const m = mergeLiveHolidays(rows, l => logged.push(l));
  const f = rows.filter(r => r.type === 'full_close').length;
  const e = rows.filter(r => r.type === 'early_close').length;
  check(`${y}: the terminal lists ${f} full closes and ${e} early closes; the table agrees on every one (${m.disagree.length} disagreements, nothing logged)`, f === full && e === early && m.disagree.length === 0 && logged.length === 0 && m.added.length === 0);
}
check('the national day of mourning 2025-01-09 is closed in both', !isTradingDay(day('2025-01-09')));
check(`2026-11-27 closes at 13:00 (minute ${sessionCloseMinOn('2026-11-27')}), 2026-11-26 is shut`, sessionCloseMinOn('2026-11-27') === 780 && !isTradingDay(day('2026-11-26')));

/* a disagreement: the terminal says a table holiday is open, an open day is closed, and an early close is a full day */
{
  const logged: string[] = [];
  const rows = read(2026).filter(r => r.date !== '2026-07-03' && r.date !== '2026-12-24');
  rows.push({ date: '2026-11-30', type: 'full_close', close: null });
  const m = mergeLiveHolidays(rows, l => logged.push(l));
  for (const l of logged) console.log(`     logged: ${l}`);
  check(`three disagreements, each logged once: ${m.disagree.length}, ${logged.length} lines`, m.disagree.length === 3 && logged.length === 3);
  check('the table wins: 2026-07-03 stays shut, 2026-11-30 stays open, 2026-12-24 still closes at 13:00', !isTradingDay(day('2026-07-03')) && isTradingDay(day('2026-11-30')) && isEarlyClose('2026-12-24'));
  const again: string[] = [];
  mergeLiveHolidays(rows, l => again.push(l));
  check('the same disagreement is not logged twice', again.length === 0);
}

/* a year the table does not cover takes the terminal's answer */
{
  check('before: 2031-07-04 (a Friday) reads as a trading day — the table stops at 2030', isTradingDay(day('2031-07-04')));
  const m = mergeLiveHolidays([
    { date: '2031-07-04', type: 'full_close', close: null },
    { date: '2031-07-03', type: 'early_close', close: '13:00:00' },
  ], () => {});
  check(`after: ${m.added.join(', ')} taken from the terminal; 2031-07-04 shut, 2031-07-03 closes at 13:00`, !isTradingDay(day('2031-07-04')) && sessionCloseMinOn('2031-07-03') === 780 && m.disagree.length === 0);
}

check(`once a day on the server: ${holidayPath(2026)} is kept ${thetaTtl(holidayPath(2026)) / 3_600_000} h by the hub (was 5 min)`, thetaTtl(holidayPath(2026)) === 24 * 3_600_000);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
