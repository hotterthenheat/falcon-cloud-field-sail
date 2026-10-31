/* The one session rule (shared/marketSession.mjs, src/core/session.ts) at every boundary, and the modules that read it.
   Every instant is written as New York wall time (DST included) through nyInstant. */

import { nyInstant, productOf, sessionAt, phaseAt, windowAt, feedMoving, nextChangeAt, type Product } from '../src/core/session';
import { sessionBadge, extWordAt, printIsCurrent, whenWords } from '../src/core/session';
import { sessionPhase, marketPhase } from '../src/core/marketPhase';
import { nySessionPhase } from '../src/core/nyTime';
import { readMarketState, nextOpenWords } from '../src/data/marketState';
import { readSessionClock } from '../src/data/moc';
import { deskSessionAt } from '../src/data/deskSession';
import { sessionLive, printLive } from '../src/data/thetaTape';
import { sessionNow } from '../src/data/feedStore';
import { moveOffCloses } from '../src/data/dayChange';
import { marketHours } from '../server/hub.mjs';

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`);
  }
};
/** New York wall time "2026-11-01 19:59" → ms */
const ny = (s: string): number => {
  const [d, t] = s.split(' ');
  const [h, m] = t.split(':').map(Number);
  return nyInstant(d, h * 60 + m);
};
const ph = (s: string) => phaseAt(ny(s));
const open = (s: string, p: Product) => sessionAt(ny(s), p).open;
const kind = (s: string, p: Product) => windowAt(ny(s), p)?.kind ?? null;

/* ---- the week opens Sunday 20:00 and shuts Friday 20:00 ---- */
check('Sun 19:59: closed', ph('2026-11-01 19:59') === 'closed');
check('Sun 20:00: overnight (the week opens)', ph('2026-11-01 20:00') === 'overnight');
check('Sun 20:00 is the trading day Monday', sessionAt(ny('2026-11-01 20:00')).tradingDay === '2026-11-02');
check('Mon 01:00 overnight still belongs to Monday', sessionAt(ny('2026-11-02 01:00')).tradingDay === '2026-11-02');
check('Mon 03:59: overnight', ph('2026-11-02 03:59') === 'overnight');
check('Mon 04:00: pre-market', ph('2026-11-02 04:00') === 'pre');
check('Mon 09:29: pre-market', ph('2026-11-02 09:29') === 'pre');
check('Mon 09:30: regular', ph('2026-11-02 09:30') === 'regular');
check('Mon 15:59: regular', ph('2026-11-02 15:59') === 'regular');
check('Mon 16:00: after hours', ph('2026-11-02 16:00') === 'post');
check('Mon 19:59: after hours', ph('2026-11-02 19:59') === 'post');
check('Mon 20:00: overnight into Tuesday', ph('2026-11-02 20:00') === 'overnight' && sessionAt(ny('2026-11-02 20:00')).tradingDay === '2026-11-03');
check('Fri 19:59: after hours', ph('2026-10-30 19:59') === 'post');
check('Fri 20:00: closed (no overnight into Saturday)', ph('2026-10-30 20:00') === 'closed');
check('Sat 12:00: closed', ph('2026-10-31 12:00') === 'closed');
check('Sat 12:00: next opening is the overnight, Sun 20:00', sessionAt(ny('2026-10-31 12:00')).next?.at === ny('2026-11-01 20:00'));

/* ---- DST: the fall-back Sunday (Nov 1 2026) and the spring-forward one (Mar 8 2026) ---- */
check('fall-back Sunday 20:00 EST is 01:00Z', ny('2026-11-01 20:00') === Date.parse('2026-11-02T01:00:00Z'));
check('fall-back Sunday 19:59 EST: closed; 20:00: overnight', ph('2026-11-01 19:59') === 'closed' && ph('2026-11-01 20:00') === 'overnight');
check('spring-forward Sunday 20:00 EDT is 00:00Z', ny('2026-03-08 20:00') === Date.parse('2026-03-09T00:00:00Z'));
check('spring-forward Sunday 19:59: closed; 20:00: overnight', ph('2026-03-08 19:59') === 'closed' && ph('2026-03-08 20:00') === 'overnight');
check('Mon after spring-forward 09:30 EDT is 13:30Z: regular', phaseAt(Date.parse('2026-03-09T13:30:00Z')) === 'regular' && phaseAt(Date.parse('2026-03-09T13:29:00Z')) === 'pre');
check('the overnight across the fall-back change runs to 04:00 EST', windowAt(ny('2026-11-01 21:00'))?.to === Date.parse('2026-11-02T09:00:00Z'));

/* ---- early close: Fri Nov 27 2026 (day after Thanksgiving) ---- */
check('early close 12:59: regular', ph('2026-11-27 12:59') === 'regular');
check('early close 13:00: after hours', ph('2026-11-27 13:00') === 'post');
check('early close 16:59: after hours', ph('2026-11-27 16:59') === 'post');
check('early close 17:00: closed (late trading ends at 5:00 PM)', ph('2026-11-27 17:00') === 'closed');
check('early close 13:30: isEarlyClose', sessionAt(ny('2026-11-27 13:30')).isEarlyClose);
check('early close 12:59: equity options open, 13:00 shut', open('2026-11-27 12:59', 'equityOption') && !open('2026-11-27 13:00', 'equityOption'));
check('early close 13:14: ETF options still open, 13:15 shut', open('2026-11-27 13:14', 'etfOption') && !open('2026-11-27 13:15', 'etfOption'));
check('early close 13:10: index options open; no curb at 13:30', open('2026-11-27 13:10', 'indexOption') && !open('2026-11-27 13:30', 'indexOption'));
check('Dec 24 2026 (Thu, early close) 12:59 regular, 13:00 post', ph('2026-12-24 12:59') === 'regular' && ph('2026-12-24 13:00') === 'post');

/* ---- holidays: the evening before a full holiday is closed; the holiday's evening opens when the next day trades ---- */
check('Wed Nov 25 19:59 after hours, 20:00 closed (Thanksgiving tomorrow)', ph('2026-11-25 19:59') === 'post' && ph('2026-11-25 20:00') === 'closed');
check('Thanksgiving 10:00: closed', ph('2026-11-26 10:00') === 'closed' && sessionAt(ny('2026-11-26 10:00')).isHoliday);
check('Thanksgiving 20:00: overnight into the early close', ph('2026-11-26 20:00') === 'overnight' && sessionAt(ny('2026-11-26 20:00')).tradingDay === '2026-11-27');
check('Sun Jan 18 2026 20:00: closed (MLK Monday)', ph('2026-01-18 20:00') === 'closed');
check('MLK Mon 20:00: overnight into Tuesday', ph('2026-01-19 20:00') === 'overnight');
check('Thu Apr 2 2026 20:00: closed (Good Friday)', ph('2026-04-02 20:00') === 'closed');
check('Thu Dec 24 2026 20:00: closed (Christmas Friday)', ph('2026-12-24 20:00') === 'closed');

/* ---- index options: GTH 20:15–09:25, regular to 16:15, curb to 17:00 ---- */
check('Sun 20:14: index GTH not yet open', !open('2026-11-01 20:14', 'indexOption'));
check('Sun 20:15: index GTH open', kind('2026-11-01 20:15', 'indexOption') === 'gth');
check('Mon 09:24 GTH, 09:25 shut, 09:30 regular', kind('2026-11-02 09:24', 'indexOption') === 'gth' && !open('2026-11-02 09:25', 'indexOption') && kind('2026-11-02 09:30', 'indexOption') === 'regular');
check('Mon 16:14 regular, 16:15 curb, 17:00 shut', kind('2026-11-02 16:14', 'indexOption') === 'regular' && kind('2026-11-02 16:15', 'indexOption') === 'curb' && !open('2026-11-02 17:00', 'indexOption'));
check('Fri 20:15: no GTH into Saturday', !open('2026-10-30 20:15', 'indexOption'));
check('Thanksgiving eve 20:15: holiday GTH opens, runs to 11:30', kind('2026-11-25 20:15', 'indexOption') === 'gth' && open('2026-11-26 11:29', 'indexOption') && !open('2026-11-26 11:30', 'indexOption'));
check('Thanksgiving 20:15: GTH into the early close', open('2026-11-26 20:15', 'indexOption'));
check('MLK Sunday 20:15: holiday GTH (Cboe runs it to 11:30 Monday)', open('2026-01-18 20:15', 'indexOption') && open('2026-01-19 11:29', 'indexOption'));
check('Good Friday eve 20:15: no GTH', !open('2026-04-02 20:15', 'indexOption'));
check('Christmas eve 20:15 and Dec 31 20:15: no GTH', !open('2026-12-24 20:15', 'indexOption') && !open('2025-12-31 20:15', 'indexOption'));
check('Christmas Day 2025 20:15: GTH into Dec 26 (Cboe notice)', open('2025-12-25 20:15', 'indexOption'));
check('equity options: 09:29 shut, 09:30 open, 15:59 open, 16:00 shut', !open('2026-11-02 09:29', 'equityOption') && open('2026-11-02 09:30', 'equityOption') && open('2026-11-02 15:59', 'equityOption') && !open('2026-11-02 16:00', 'equityOption'));
check('equity options overnight: shut, next opens 09:30', !open('2026-11-02 21:00', 'equityOption') && sessionAt(ny('2026-11-02 21:00'), 'equityOption').next?.at === ny('2026-11-03 09:30'));
check('ETF options 16:14 open, 16:15 shut', open('2026-11-02 16:14', 'etfOption') && !open('2026-11-02 16:15', 'etfOption'));

/* ---- the words ---- */
const sat = ny('2026-10-31 12:00');
check('Saturday badge: "Closed · overnight opens Sun 8:00 PM ET"', sessionBadge(sessionAt(sat)) === 'Closed · overnight opens Sun 8:00 PM ET', sessionBadge(sessionAt(sat)));
check('Sunday 20:30 badge: "Overnight · live"', sessionBadge(sessionAt(ny('2026-11-01 20:30'))) === 'Overnight · live');
check('Monday 05:00 badge: "Pre-market · live"', sessionBadge(sessionAt(ny('2026-11-02 05:00'))) === 'Pre-market · live');
check('Monday 10:00 badge: "Regular · live"', sessionBadge(sessionAt(ny('2026-11-02 10:00'))) === 'Regular · live');
check('Monday 17:00 badge: "After hours · live"', sessionBadge(sessionAt(ny('2026-11-02 17:00'))) === 'After hours · live');
check('early close 17:30 badge: overnight opens 8:00 PM ET?', sessionBadge(sessionAt(ny('2026-11-27 17:30'))) === 'Closed · overnight opens Sun 8:00 PM ET', sessionBadge(sessionAt(ny('2026-11-27 17:30'))));
check('Thanksgiving noon badge: overnight opens 8:00 PM ET (today)', sessionBadge(sessionAt(ny('2026-11-26 12:00'))) === 'Closed · overnight opens 8:00 PM ET', sessionBadge(sessionAt(ny('2026-11-26 12:00'))));
check('MLK Sunday noon: overnight opens Mon 8:00 PM ET', sessionBadge(sessionAt(ny('2026-01-18 12:00'))) === 'Closed · overnight opens Mon 8:00 PM ET', sessionBadge(sessionAt(ny('2026-01-18 12:00'))));
check('whenWords beyond a week names the date', whenWords(ny('2026-11-10 09:30'), ny('2026-11-01 12:00')) === 'Tue Nov 10 9:30 AM ET', whenWords(ny('2026-11-10 09:30'), ny('2026-11-01 12:00')));
const ms = readMarketState(new Date(sat));
check('readMarketState Saturday: closed for the weekend, the overnight opens Sunday', ms.word === 'closed' && ms.short === 'closed for the weekend' && /overnight session opens Sun 8:00 PM ET/.test(ms.line), ms.line);
check('readMarketState overnight: live, "overnight"', readMarketState(new Date(ny('2026-11-01 20:30'))).word === 'live' && readMarketState(new Date(ny('2026-11-01 20:30'))).short === 'overnight');
check('nextOpenWords Saturday: "overnight opens Sun 8:00 PM ET"', nextOpenWords(new Date(sat))?.short === 'overnight opens Sun 8:00 PM ET', nextOpenWords(new Date(sat)));
check('nextOpenWords never says Monday 09:30 on a weekend', !/Mon/.test(nextOpenWords(new Date(sat))?.short ?? ''));
check('the session clock on a Friday evening no longer says "next session Monday"', !/Monday/.test(readSessionClock(new Date(ny('2026-10-30 20:30'))).label), readSessionClock(new Date(ny('2026-10-30 20:30'))).label);
check('the session clock overnight says so', readSessionClock(new Date(ny('2026-11-01 21:00'))).label === 'Overnight session');

/* ---- the wrappers ---- */
check('sessionPhase: overnight / pre / regular / after / closed', sessionPhase(new Date(ny('2026-11-01 20:30'))) === 'overnight' && sessionPhase(new Date(ny('2026-11-02 05:00'))) === 'pre' && sessionPhase(new Date(ny('2026-11-02 10:00'))) === 'regular' && sessionPhase(new Date(ny('2026-11-02 17:00'))) === 'after' && sessionPhase(new Date(sat)) === 'closed');
check('marketPhase late 16:00–16:15, and 13:00–13:15 on an early close', marketPhase(new Date(ny('2026-11-02 16:10'))) === 'late' && marketPhase(new Date(ny('2026-11-27 13:10'))) === 'late' && marketPhase(new Date(ny('2026-11-27 13:20'))) === 'after');
check('nySessionPhase: a Saturday 10:00 is never "open"', nySessionPhase(sat - 2 * 3_600_000) === 'after');
check('nySessionPhase: Monday 07:00 before, 10:00 open, 16:30 after', nySessionPhase(ny('2026-11-02 07:00')) === 'before' && nySessionPhase(ny('2026-11-02 10:00')) === 'open' && nySessionPhase(ny('2026-11-02 16:30')) === 'after');
check('nySessionPhase: Monday 02:00 (overnight into it) is before; Sunday 21:00 after', nySessionPhase(ny('2026-11-02 02:00')) === 'before' && nySessionPhase(ny('2026-11-01 21:00')) === 'after');
check('desk Follow: Sun 20:30 overnight, Mon 05:00 pre, 10:00 rth, 17:00 post, Sat rth', deskSessionAt(ny('2026-11-01 20:30')) === 'overnight' && deskSessionAt(ny('2026-11-02 05:00')) === 'pre' && deskSessionAt(ny('2026-11-02 10:00')) === 'rth' && deskSessionAt(ny('2026-11-02 17:00')) === 'post' && deskSessionAt(sat) === 'rth');
check('desk Follow: Friday 21:00 is no longer overnight', deskSessionAt(ny('2026-10-30 21:00')) === 'rth');
check('desk Follow: early close 13:30 is post', deskSessionAt(ny('2026-11-27 13:30')) === 'post');
check('tape live: overnight on Sunday 20:30 (it was dead: Sunday is not a trading day)', sessionLive('overnight', ny('2026-11-01 20:30')));
check('tape live: not overnight on Friday 21:00 (it was live: Friday is a trading day)', !sessionLive('overnight', ny('2026-10-30 21:00')));
check('tape live: post on the early close at 13:30, not rth', sessionLive('post', ny('2026-11-27 13:30')) && !sessionLive('rth', ny('2026-11-27 13:30')));
check('tape live: the overnight before Good Friday is dead', !sessionLive('overnight', ny('2026-04-02 21:00')));
check('print live: a stock overnight; SPX not overnight; VIX in GTH', printLive('SPY', ny('2026-11-01 21:00')) && !printLive('SPX', ny('2026-11-01 21:00')) && printLive('VIX', ny('2026-11-02 05:00')));
check('print live: nothing on Saturday', !printLive('SPY', sat) && !printLive('SPX', sat) && !printLive('VIX', sat));
check('vendor cadence: overnight reads at the shut pace (the vendor has no overnight prints)', sessionNow(ny('2026-11-01 21:00')) === 'closed' && sessionNow(ny('2026-11-02 05:00')) === 'extended' && sessionNow(ny('2026-11-02 10:00')) === 'open');
check('vendor cadence: the early close after 17:00 is shut', sessionNow(ny('2026-11-27 17:30')) === 'closed' && sessionNow(ny('2026-11-27 16:30')) === 'extended');
check('hub: a stock path overnight is not moving; SPX in GTH is', !marketHours(ny('2026-11-01 21:00'), '/stock/SPY/stock-state') && marketHours(ny('2026-11-01 21:00'), '/stock/SPX/flow-alerts'));
check('feedMoving: SPXL is a stock, not SPX', !feedMoving(ny('2026-11-01 21:00'), '/stock/SPXL/stock-state'));
check('nextChangeAt from Saturday is Sunday 20:00', nextChangeAt(sat) === ny('2026-11-01 20:00'));

/* ---- the price tags ---- */
check('extWordAt: ON / PM / null / AH', extWordAt(ny('2026-11-02 01:00')) === 'overnight' && extWordAt(ny('2026-11-02 05:00')) === 'pre-market' && extWordAt(ny('2026-11-02 10:00')) === null && extWordAt(ny('2026-11-02 17:00')) === 'after hours');
check('printIsCurrent: Friday 19:59 print on Saturday is not current', !printIsCurrent(ny('2026-10-30 19:59'), sat));
check('printIsCurrent: Friday 19:59 print shown Sunday 21:00 (overnight) is not current', !printIsCurrent(ny('2026-10-30 19:59'), ny('2026-11-01 21:00')));
check('printIsCurrent: a 10:00 print at 10:01 is current', printIsCurrent(ny('2026-11-02 10:00'), ny('2026-11-02 10:01')));
const closes = [
  { date: '2026-10-30', close: 755.72 },
  { date: '2026-10-29', close: 760 },
];
const wk = moveOffCloses(757.12, ny('2026-10-30 19:59'), closes, sat);
check('weekend: Friday\'s change and its AH move', wk.dayPct != null && Math.abs(wk.dayPct - ((755.72 - 760) / 760) * 100) < 1e-9 && wk.extWord === 'after hours' && wk.phase === 'closed' && wk.regDate === '2026-10-30');
const onMv = moveOffCloses(758, ny('2026-11-01 21:00'), closes, ny('2026-11-01 21:30'));
check('an overnight print is labelled ON and the phase is overnight', onMv.extWord === 'overnight' && onMv.phase === 'overnight', onMv);
const preMv = moveOffCloses(758, ny('2026-11-02 05:00'), closes, ny('2026-11-02 05:01'));
check('a pre-market print is PM', preMv.extWord === 'pre-market' && preMv.phase === 'pre');
const regMv = moveOffCloses(758, ny('2026-11-02 10:00'), closes, ny('2026-11-02 10:01'));
check('in the session the day change is the live price off the last close', regMv.phase === 'regular' && regMv.extPct == null && Math.abs((regMv.dayPct ?? 0) - ((758 - 755.72) / 755.72) * 100) < 1e-9);

/* options pre-market (seen trading 07:30–09:25 in ThetaData on 2026-10-30: SPY, QQQ, NVDA, AAPL, TSLA, AMD) */
check('SPY options are extEtfOption', productOf('SPY', true) === 'extEtfOption');
check('NVDA options are extEquityOption', productOf('NVDA', true) === 'extEquityOption');
check('KO options are plain equityOption', productOf('KO', true) === 'equityOption');
check('SPY options open 07:30 (pre)', open('2026-11-02 07:30', 'extEtfOption') && sessionAt(ny('2026-11-02 07:30'), 'extEtfOption').window?.kind === 'pre');
check('SPY options closed 07:29', !open('2026-11-02 07:29', 'extEtfOption'));
check('SPY options halt 09:25–09:29', !open('2026-11-02 09:26', 'extEtfOption'));
check('SPY options open to 16:14, shut 16:15', open('2026-11-02 16:14', 'extEtfOption') && !open('2026-11-02 16:15', 'extEtfOption'));
check('NVDA options pre 08:00', open('2026-11-02 08:00', 'extEquityOption'));
check('NVDA options curb 16:00–16:14', sessionAt(ny('2026-11-02 16:05'), 'extEquityOption').window?.kind === 'curb');
check('NVDA options shut 16:15', !open('2026-11-02 16:15', 'extEquityOption'));
check('KO options closed 08:00', !open('2026-11-02 08:00', 'equityOption'));
check('no options pre-market on a holiday (Thanksgiving)', !open('2026-11-26 08:00', 'extEtfOption'));
check('early close: SPY options end 13:15, NVDA curb 13:00–13:14', open('2026-11-27 13:14', 'extEtfOption') && !open('2026-11-27 13:15', 'extEtfOption') && sessionAt(ny('2026-11-27 13:05'), 'extEquityOption').window?.kind === 'curb');

/* ---- the surfaces moved onto the session module (audit "Sessions", 2026-10-31) ---- */
{
  const { sessionsAhead } = await import('../src/data/compassScan');
  const { nyParts } = await import('../src/core/nyTime');
  /* the formula it replaced, verbatim: 16:00 and the 6.5-hour session on every day */
  const before = (expiration: string, now: number): number => {
    const dte = Math.max(0, Math.round((Date.parse(`${expiration}T21:00:00Z`) - now) / 86400000));
    if (dte > 0) return dte;
    const p = nyParts(now);
    const mins = p.hour * 60 + p.minute;
    if (mins < 9 * 60 + 30) return 1;
    return Math.max(16 * 60 - mins, 5) / (6.5 * 60);
  };
  /* every minute of full days (a Monday, a Friday, a DST Monday), against expiries today, tomorrow and a week out:
     bit-identical (Object.is), so the Compass calls the live path makes on a regular day do not move */
  let same = 0;
  let diff = '';
  for (const day of ['2026-10-26', '2026-10-30', '2026-11-02', '2026-11-30', '2027-03-15']) {
    for (const exp of [day, '2026-12-31', '2027-03-19']) {
      for (let m = 0; m < 24 * 60; m++) {
        const at = nyInstant(day, m);
        const a = sessionsAhead(exp, at);
        const b = before(exp, at);
        if (Object.is(a, b)) same += 1;
        else if (!diff) diff = `${day} ${m} ${exp}: ${a} vs ${b}`;
      }
    }
  }
  check(`compassScan sessionsAhead: every minute of five full days × three expiries bit-identical to the old formula (${same})`, !diff, diff);
  /* an early close (the day after Thanksgiving, 13:00): the 0DTE time left runs to 13:00, not 16:00 */
  check('sessionsAhead early close 12:00 → 60 min of 390', sessionsAhead('2026-11-27', ny('2026-11-27 12:00')) === 60 / 390, sessionsAhead('2026-11-27', ny('2026-11-27 12:00')));
  check('sessionsAhead early close 12:58 → the 5-minute floor', sessionsAhead('2026-11-27', ny('2026-11-27 12:58')) === 5 / 390);
  check('sessionsAhead early close before the open → 210 of 390 (was a whole session)', sessionsAhead('2026-11-27', ny('2026-11-27 08:00')) === 210 / 390);
  check('sessionsAhead full day before the open → 1', sessionsAhead('2026-11-30', ny('2026-11-30 08:00')) === 1);

  const { REGULAR_OPEN_MIN, REGULAR_CLOSE_MIN, regularCloseMin } = await import('../src/core/session');
  check('the session module names the open and a full close (570, 960) and a half day\'s 13:00', REGULAR_OPEN_MIN === 570 && REGULAR_CLOSE_MIN === 960 && regularCloseMin('2026-11-27') === 780 && regularCloseMin('2026-11-30') === 960);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall session checks passed');
