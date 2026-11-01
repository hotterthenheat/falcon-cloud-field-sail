/*
  World sessions proof (the chart's Sessions indicator and its extended-hours shading, shared/marketSession.mjs):
  Tokyo, London and New York boxes across each one's own daylight-saving changes, the US holidays and an early close,
  and the extended-hours windows and session-day breaks the chart shades and rules.
    2026: the US clocks change Sun 8 Mar and Sun 1 Nov; London's Sun 29 Mar and Sun 25 Oct; Tokyo never.
  Run:  npx tsx scripts/world-sessions-proof.ts
*/
import { equityWindowsOn, isEarlyCloseDay, tradingDayOf, worldSessionsBetween, zoneInstant } from '../src/core/session';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
/** The sessions of one key opening on a calendar day (UTC midnight to midnight, a day either side) */
const on = (key: 'asia' | 'london' | 'newYork', day: string) => worldSessionsBetween(Date.parse(`${day}T00:00:00Z`) - 86_400_000, Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000, [key]).find(w => w.day === day);

/* Tokyo: 09:00–15:30 JST, 00:00–06:30 UTC all year */
for (const day of ['2026-01-15', '2026-03-16', '2026-07-15', '2026-10-26', '2026-11-02']) {
  const w = on('asia', day);
  const [y, m, d] = day.split('-').map(Number);
  check(`Tokyo ${day}: 00:00–06:30 UTC (no daylight saving)`, !!w && w.from === utc(y, m, d, 0) && w.to === utc(y, m, d, 6, 30), w ? `${iso(w.from)}–${iso(w.to)}` : 'none');
}

/* London: 08:00–16:30 local; GMT in the winter, BST between 29 Mar and 25 Oct 2026 */
const london: [string, number][] = [
  ['2026-01-15', 8],
  ['2026-03-16', 8], // US already on EDT, London still GMT: opens 04:00 New York
  ['2026-03-30', 7], // BST
  ['2026-07-15', 7],
  ['2026-10-23', 7], // the last BST Friday
  ['2026-10-26', 8], // GMT again, New York still EDT: opens 04:00 New York
  ['2026-11-02', 8],
];
for (const [day, h] of london) {
  const w = on('london', day);
  const [y, m, d] = day.split('-').map(Number);
  check(`London ${day}: opens ${h}:00 UTC, closes 8.5 h later`, !!w && w.from === utc(y, m, d, h) && w.to === utc(y, m, d, h + 8, 30), w ? `${iso(w.from)}–${iso(w.to)}` : 'none');
}
const nyOpenHour = (ms: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit' }).format(new Date(ms)));
check('London 2026-03-16 opens 04:00 New York (the US moved first)', nyOpenHour(on('london', '2026-03-16')!.from) === 4);
check('London 2026-03-30 opens 03:00 New York (both on summer time)', nyOpenHour(on('london', '2026-03-30')!.from) === 3);
check('London 2026-10-26 opens 04:00 New York (London moved back first)', nyOpenHour(on('london', '2026-10-26')!.from) === 4);
check('London 2026-11-02 opens 03:00 New York (both on winter time)', nyOpenHour(on('london', '2026-11-02')!.from) === 3);
check('Tokyo 2026-07-15 opens 20:00 New York the evening before (EDT)', nyOpenHour(on('asia', '2026-07-15')!.from) === 20);
check('Tokyo 2026-11-02 opens 19:00 New York the evening before (EST)', nyOpenHour(on('asia', '2026-11-02')!.from) === 19);

/* New York: the regular session, the US holidays and early closes */
{
  const w = on('newYork', '2026-07-15');
  check('New York 2026-07-15: 13:30–20:00 UTC (EDT)', !!w && w.from === utc(2026, 7, 15, 13, 30) && w.to === utc(2026, 7, 15, 20));
  const winter = on('newYork', '2026-01-15');
  check('New York 2026-01-15: 14:30–21:00 UTC (EST)', !!winter && winter.from === utc(2026, 1, 15, 14, 30) && winter.to === utc(2026, 1, 15, 21));
  check('New York 2026-11-26 (Thanksgiving): no session', !on('newYork', '2026-11-26'));
  check('the day after Thanksgiving 2026-11-27 is an early close', isEarlyCloseDay('2026-11-27'));
  const early = on('newYork', '2026-11-27');
  check('New York 2026-11-27: closes 13:00 ET (18:00 UTC)', !!early && early.to === utc(2026, 11, 27, 18), early ? iso(early.to) : 'none');
  check('Tokyo and London still open on Thanksgiving (their own calendars)', !!on('asia', '2026-11-26') && !!on('london', '2026-11-26'));
  check('no box on a Saturday or a Sunday', ['asia', 'london', 'newYork'].every(k => !on(k as 'asia', '2026-10-31') && !on(k as 'asia', '2026-11-01')));
  const week = worldSessionsBetween(utc(2026, 10, 26, 0), utc(2026, 10, 31, 0));
  check('the week of 26 Oct 2026: five of each, oldest first', week.length === 15 && week.every((w, i) => i === 0 || w.from >= week[i - 1].from), `${week.length}`);
}

/* the extended hours the chart shades, and its session-day breaks */
{
  const fri = equityWindowsOn('2026-10-30');
  const kinds = fri.map(w => w.kind).join(',');
  check('Fri 2026-10-30: pre, regular, post and no overnight (the weekend)', kinds === 'pre,regular,post', kinds);
  const post = fri.find(w => w.kind === 'post')!;
  check('Fri 2026-10-30 after hours: 16:00–20:00 ET (20:00–24:00 UTC)', post.from === utc(2026, 10, 30, 20) && post.to === utc(2026, 10, 31, 0));
  const early = equityWindowsOn('2026-11-27').find(w => w.kind === 'post')!;
  check('Fri 2026-11-27 after hours: 13:00–17:00 ET on the early close', early.from === utc(2026, 11, 27, 18) && early.to === utc(2026, 11, 27, 22));
  check('Wed 2026-11-25 has no overnight (Thanksgiving next)', !equityWindowsOn('2026-11-25').some(w => w.kind === 'overnight'));
  check('Thu 21:00 ET overnight belongs to Friday', tradingDayOf(utc(2026, 10, 30, 1)) === '2026-10-30');
  check('Fri 17:00 ET after hours belongs to Friday', tradingDayOf(utc(2026, 10, 30, 21)) === '2026-10-30');
  check('Fri 21:00 ET is closed', tradingDayOf(utc(2026, 10, 31, 1)) === null);
  check('Sun 1 Nov 21:00 EST (the day the US clocks changed) opens Monday', tradingDayOf(utc(2026, 11, 2, 2)) === '2026-11-02');
  check('zoneInstant reads New York through nyInstant', zoneInstant('America/New_York', '2026-07-15', 9 * 60) === utc(2026, 7, 15, 13));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
