/*
  Compass's late path and scan bookkeeping (audit 2026-11-05, A4, A8 and the scan items with them):
    A4  the late Book C sweep runs only on its session's own date, after its window, for an instant already past
        (lateLotteryAt). From 20:00 the session day is the next one's (over a weekend or a holiday, all afternoon), so
        the sweep ran 20:00–20:15 every weekday (and weekend afternoons from 15:50) for the NEXT session's 15:20;
        ThetaData refused it as a future date (a 400), the 400 counted as an answer, every name was marked not scored
        and the session's sweep done (.cache/compass/2026-11-02.json), so the real 15:20 sweep never ran. A future-date
        400 is not an answer now. A sweep with no same-day root on (a weekend, a holiday) writes no empty mark row.
    A8  a late mark reads the bars as they stood at it (barsBefore: every bar begun before its minute). A pre-market or
        overnight mark filled late read the 09:30 open as its spot, an evening mark the next session's high, low,
        open, opening range and VWAP. The spot never falls back to a later bar. LIVE: the tape is byte-identical — every
        minute of a full synthetic session, index and stock, with and without a quoted spot, against a frozen copy of
        tapeOf before the fix (legacyTapeOf below); and a late mark cut to its minute reads exactly what live read.
    The late fill starts at the first index-option window of the session day (sessionOpenAt): Sunday 20:15 for the
    Tuesday after Martin Luther King Day (the holiday's GTH belong to Tuesday), unchanged on every other day.
    A same-day snapshot reaches Book B's band (WEEKLY_STRIKES, 17 strikes), as the weekly one does (was 16).
  Run: npx tsx scripts/compass-late-proof.ts
*/

import { nyWallTime } from '../src/core/nyTime';
import { REGULAR_OPEN_MIN, isSessionDay, windowAt } from '../src/core/session';
import { setCompassHost } from '../src/data/compassHost';
import { barsBefore, span, stdev, tapeOf, type Bar } from '../src/data/compassFeatures';
import { WEEKLY_STRIKES } from '../src/data/compassParams';
import { exportMarks, lateLotteryAt, lotterySweep, once, sessionOpenAt, terminalAnswered } from '../src/data/compassScan';
import { sessionIso } from '../src/data/compassSession';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
};
const ny = (y: number, mo: number, d: number, h: number, mi: number) => nyWallTime(y, mo, d, h, mi);
const clockOf = (ms: number | null) => (ms == null ? null : new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23' }));

/* ---- A4: the late Book C sweep ---- */
const FUTURE = { status: 400, error: 'unavailable 400', data: 'Date range contains future date; end must be before or equal to today' };
check('a 400 "future date" is not an answer (asked again once the day comes)', terminalAnswered(FUTURE) === false);
check('…as JSON too', terminalAnswered({ status: 400, error: 'Date range contains future date; end must be before or equal to today' }) === false);
check('another 400 is still an answer (asking again will not change it)', terminalAnswered({ status: 400, error: 'Invalid symbol' }) === true);
check('rows and no-data are answers; a 5xx is not', [terminalAnswered({ status: 200, error: null }), terminalAnswered({ status: 472, error: 'no_data' }), terminalAnswered({ status: 503, error: 'terminal_down' })].join() === 'true,true,false');
check('Wednesday 2026-11-04 20:05 (the session day is Thursday): no sweep of Thursday\'s 15:20, still to come', lateLotteryAt('2026-11-05', ny(2026, 11, 4, 20, 5), null) === null);
check('Thursday 15:55: the sweep reads 15:20:15', lateLotteryAt('2026-11-05', ny(2026, 11, 5, 15, 55), null) === ny(2026, 11, 5, 15, 20) + 15_000, clockOf(lateLotteryAt('2026-11-05', ny(2026, 11, 5, 15, 55), null)));
check('Thursday 15:45: the window has not ended', lateLotteryAt('2026-11-05', ny(2026, 11, 5, 15, 45), null) === null);
check('Thursday 20:14: still Thursday\'s', lateLotteryAt('2026-11-05', ny(2026, 11, 5, 20, 14), null) === ny(2026, 11, 5, 15, 20) + 15_000);
check('Saturday 16:00 and Sunday 16:00 (the session day is Monday): no sweep', lateLotteryAt('2026-11-09', ny(2026, 11, 7, 16, 0), null) === null && lateLotteryAt('2026-11-09', ny(2026, 11, 8, 16, 0), null) === null);
check('Thanksgiving 16:00 (the session day is Friday): no sweep', lateLotteryAt('2026-11-27', ny(2026, 11, 26, 16, 0), 780) === null);
check('the 13:00 close 2026-11-27, at 12:55: the sweep reads 12:20:15', lateLotteryAt('2026-11-27', ny(2026, 11, 27, 12, 55), 780) === ny(2026, 11, 27, 12, 20) + 15_000);
{
  const asked: string[] = [];
  setCompassHost({ server: true, theta: async p => { asked.push(p); return { status: 472, data: null, error: 'no_data' }; }, asset: async () => null, econ: () => [] });
  const swept = await lotterySweep(ny(2026, 10, 31, 15, 20) + 15_000, true);
  const rows = exportMarks().filter(r => r.sleeve === 'lottery');
  check('a Saturday sweep: nothing is asked, no Book C mark row is written', swept === false && rows.length === 0 && asked.length === 0, { swept, rows: rows.length, asked: asked.length });
}

/* ---- the late fill's first mark ---- */
check('sessionOpenAt: Thursday 10-29 at Wednesday 20:15, Monday 11-02 at Sunday 20:15 (unchanged)', sessionOpenAt('2026-10-29') === ny(2026, 10, 28, 20, 15) && sessionOpenAt('2026-11-02') === ny(2026, 11, 1, 20, 15));
check('sessionOpenAt: the Tuesday after MLK Day 2027-01-19 at Sunday 01-17 20:15 (its GTH run to Monday 11:30; was Monday 20:15)', sessionOpenAt('2027-01-19') === ny(2027, 1, 17, 20, 15), clockOf(sessionOpenAt('2027-01-19')));
check('sessionOpenAt: Friday after Thanksgiving 2026-11-27 at Wednesday 20:15', sessionOpenAt('2026-11-27') === ny(2026, 11, 25, 20, 15), clockOf(sessionOpenAt('2026-11-27')));
{
  /* every session day of 2026 and 2027: the first index-option minute that belongs to it, and where no holiday GTH
     comes before it, the evening before as it was */
  const bad: string[] = [];
  let moved = 0;
  for (let t = Date.UTC(2026, 0, 2); t <= Date.UTC(2027, 11, 31); t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!isSessionDay(iso)) continue;
    const open = sessionOpenAt(iso);
    /* it opens a window of that session day, and the index-option tape a minute earlier is shut or another day's */
    const before = windowAt(open - 60_000, 'indexOption');
    if (sessionIso(open) !== iso || !windowAt(open, 'indexOption') || (before && sessionIso(before.from) === iso)) bad.push(iso);
    const prev = new Date(t - 86_400_000);
    if (open !== ny(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 20, 15)) moved += 1;
  }
  check('2026–2027: every session day\'s book opens on its own first minute', bad.length === 0, bad.length ? bad.slice(0, 6).join(', ') : `${moved} days after a GTH holiday moved`);
}

/* ---- the same-day snapshot's reach ---- */
{
  const asked: string[] = [];
  setCompassHost({ server: true, theta: async p => { asked.push(p); return { status: 472, data: null, error: 'no_data' }; }, asset: async () => null, econ: () => [] });
  await once('NVDA', ny(2026, 11, 4, 11, 0), '2026-11-04', true);
  await once('NVDA', ny(2026, 11, 4, 11, 0), '2026-11-06', true);
  const ranges = asked.map(p => /strike_range=(\d+)/.exec(p)?.[1]);
  check(`a same-day snapshot reaches Book B's band like a weekly one (strike_range=${WEEKLY_STRIKES})`, ranges.join() === `${WEEKLY_STRIKES},${WEEKLY_STRIKES}`, ranges);
}

/* ---- A8: no look-ahead in a late mark's tape ---- */
const dayBars = (d: string, n = 391): Bar[] =>
  Array.from({ length: n }, (_, k) => {
    const o = 105 + 0.4 * Math.sin(k / 7) + k * 0.01;
    return { d, m: REGULAR_OPEN_MIN + k, o, h: o + 0.2 + 0.05 * Math.cos(k / 3), l: o - 0.15, c: o + 0.03, v: 1000 + ((k * 37) % 500) };
  });
{
  /* Thursday 2026-11-05's bars, 09:30–10:00, as they stand when an earlier mark of Thursday's book is filled late */
  const thuBars = dayBars('20261105', 31);
  for (const [label, at, minute] of [['Wednesday 20:15 (overnight, Thursday\'s book)', ny(2026, 11, 4, 20, 15), 20 * 60 + 15], ['Thursday 01:00 (overnight)', ny(2026, 11, 5, 1, 0), 60], ['Thursday 08:00 (pre-market)', ny(2026, 11, 5, 8, 0), 8 * 60]] as const) {
    const late = tapeOf(barsBefore(thuBars, at), false, minute, 99);
    const live = tapeOf([], false, minute, 99);
    check(`${label}: scored late, the tape reads only the quoted spot (no 09:30 open, high, low, opening range)`, late.S === 99 && [late.op, late.H, late.L, late.orh, late.orl].every(Number.isNaN) && JSON.stringify(late) === JSON.stringify(live), { S: late.S, op: late.op, H: late.H, orh: late.orh });
  }
  const raw = tapeOf(thuBars, false, 8 * 60, 99);
  check('the spot never falls back to a later bar: 08:00 with the session\'s bars in hand reads the quote, not the 09:30 open', raw.S === 99, raw.S);
  const t15 = ny(2026, 11, 5, 9, 45);
  const cut = barsBefore(thuBars, t15);
  check('09:45 late: the bars begun before 09:45 (15), not the 09:45 bar or the opening range\'s later half', cut.length === 15 && cut[cut.length - 1].m === 9 * 60 + 44, cut.length);
}
{
  /* LIVE: at every minute live holds the bars begun before it; the tape against tapeOf as it was, field by field */
  const full = dayBars('20261029');
  let compared = 0;
  const diff: string[] = [];
  for (let minute = 0; minute < 1440; minute++) {
    const markAt = ny(2026, 10, 29, Math.floor(minute / 60), minute % 60);
    const liveBars = full.filter(b => b.m < minute);
    for (const index of [false, true]) {
      for (const spot of [NaN, 104.5]) {
        const now = tapeOf(liveBars, index, minute, spot);
        const was = legacyTapeOf(liveBars, index, minute, spot);
        compared += 1;
        const a = JSON.stringify({ ...now, at: [0, 1, 5, 15, 60].map(now.at) });
        const b = JSON.stringify({ ...was, at: [0, 1, 5, 15, 60].map(was.at) });
        if (a !== b && diff.length < 4) diff.push(`${minute} ${index} ${spot}: ${b} → ${a}`);
        /* a late mark cut to its minute is the live tape */
        const late = tapeOf(barsBefore(full, markAt), index, minute, spot);
        if (JSON.stringify({ ...late, at: [0, 1, 5, 15, 60].map(late.at) }) !== a && diff.length < 4) diff.push(`late ${minute} ${index} ${spot}`);
      }
    }
  }
  check('LIVE: every minute of a full session, index and stock, with and without a quote: the tape is byte-identical; late = live', diff.length === 0, diff.length ? diff.join('; ') : `${compared} tapes`);
}

/* ---- tapeOf before the fix, frozen (compassFeatures.tapeOf at 6f886cb) ---- */
function legacyTapeOf(rows: Bar[], index: boolean, minute: number, spot = NaN) {
  const tt = minute - REGULAR_OPEN_MIN;
  const o = Array<number>(392).fill(NaN);
  const h = Array<number>(392).fill(NaN);
  const l = Array<number>(392).fill(NaN);
  const v = Array<number>(392).fill(0);
  let op = NaN;
  for (const b of rows) {
    const k = b.m - REGULAR_OPEN_MIN;
    if (k < 0 || k > 390) continue;
    if (!(o[k] > 0) && b.o > 0) o[k] = b.o;
    h[k] = b.h;
    l[k] = b.l;
    v[k] = b.v;
    if (k === 0 && b.o > 0) op = b.o;
  }
  const S = (() => {
    if (tt > 390 && spot > 0) return spot;
    if (tt >= 0 && tt <= 390 && !(o[tt] > 0) && spot > 0) return spot;
    const last = Math.min(Math.max(tt, 0), o.length - 1);
    for (let i = last; i >= 0; i--) if (o[i] > 0) return o[i];
    return spot > 0 ? spot : NaN;
  })();
  const logs = (from: number, to: number) => {
    const out: number[] = [];
    for (let i = Math.max(from + 1, 1); i < to; i++) if (o[i] > 0 && o[i - 1] > 0) out.push(Math.log(o[i] / o[i - 1]));
    return out;
  };
  const rv = (xs: number[]) => (xs.length >= 10 ? stdev(xs) : NaN);
  const rv30 = rv(logs(Math.max(1, tt - 30), tt + 1));
  const rvPrev = rv(logs(Math.max(1, tt - 60), tt - 29));
  let compress = NaN;
  if (tt >= 60) {
    if (index) {
      const changes = (n: number) => {
        const d: number[] = [];
        for (let i = Math.max(1, tt - n + 1); i <= tt; i++) if (o[i] > 0 && o[i - 1] > 0) d.push(o[i] - o[i - 1]);
        return d;
      };
      const a = stdev(changes(5));
      const b = stdev(changes(60));
      compress = b > 0 ? a / b : NaN;
    } else {
      const meanRange = (n: number) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(1, tt - n + 1); i < tt; i++) {
          if (Number.isFinite(h[i]) && Number.isFinite(l[i])) {
            sum += h[i] - l[i];
            count += 1;
          }
        }
        return count ? sum / count : NaN;
      };
      const a = meanRange(5);
      const b = meanRange(60);
      compress = b > 0 ? a / b : NaN;
    }
  }
  let pv = 0;
  let vv = 0;
  const devs: number[] = [];
  for (let i = 1; i < tt && i < o.length; i++) {
    if (!(v[i] > 0) || !(o[i] > 0)) continue;
    pv += o[i] * v[i];
    vv += v[i];
    devs.push(o[i] - pv / vv);
  }
  const vwap = vv > 0 ? pv / vv : NaN;
  const sd = stdev(devs);
  const vwapZ = !index && sd > 0 && S > 0 && vwap > 0 ? (S - vwap) / sd : NaN;
  let total = 0;
  for (let i = 0; i < tt && i < v.length; i++) total += v[i] || 0;
  const cum = index ? NaN : total;
  let last5 = 0;
  for (let i = Math.max(0, tt - 5); i < tt && i < v.length; i++) last5 += v[i] || 0;
  return {
    tt, S, op,
    H: span(h, 0, tt, true), L: span(l, 0, tt, false),
    orh: span(h, 0, 30, true), orl: span(l, 0, 30, false),
    rv30, rvPrev, compress, vwapZ, cum, last5,
    at: (back: number) => (tt - back >= 0 && o[tt - back] > 0 ? o[tt - back] : NaN),
  };
}

console.log(failed ? `\n${failed} FAILED` : '\ncompass late proof: all checks pass');
process.exit(failed ? 1 : 0);
