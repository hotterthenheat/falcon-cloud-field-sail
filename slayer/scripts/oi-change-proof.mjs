/*
  The day-over-day open-interest change map (shared/volRegime.mjs oiChange, server/regimeApi.mjs) against known
  numbers and a counting stand-in for the terminal: the per-strike change, the scopes (one expiry, the whole book of
  expiries still live), the dates compared (OI is stamped ~06:30 ET for the PREVIOUS close), and the request budget —
  two all-expiration reads for a name's first day, one a day after (yesterday's latest is today's prior).
  Run: node scripts/oi-change-proof.mjs
*/

import { nyInstant } from '../shared/marketSession.mjs';
import { oiChange, oiReportDay, oiRootOf, priorSession, readOiReport } from '../shared/volRegime.mjs';
import { createRegime } from '../server/regimeApi.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- 1. the dates ---- */
check('Sat Oct 31: the latest report is Fri Oct 30 (it counts the Oct 29 close)', oiReportDay(nyInstant('2026-10-31', 18 * 60)) === '2026-10-30' && priorSession('2026-10-30') === '2026-10-29');
check('Mon Nov 2 06:00 (before the stamp): still Friday\'s report', oiReportDay(nyInstant('2026-11-02', 6 * 60)) === '2026-10-30');
check('Mon Nov 2 06:40 (after the stamp): Monday\'s report, prior Friday', oiReportDay(nyInstant('2026-11-02', 6 * 60 + 40)) === '2026-11-02' && priorSession('2026-11-02') === '2026-10-30');
check('Fri Nov 27 (after Thanksgiving): the prior report is Wed Nov 25', priorSession('2026-11-27') === '2026-11-25');
check('SPX reads its dailies (SPXW); SPY reads SPY', oiRootOf('SPX') === 'SPXW' && oiRootOf('spy') === 'SPY');

/* ---- 2. the arithmetic, by hand ---- */
/* the audit's probe p25: SPXW Nov 20 7600C, 916 on the Oct 29 report, 971 on Oct 30's (+55) */
const contract = (exp, strike, right, oi, day) => ({ contract: { right, strike, symbol: 'SPXW', expiration: exp }, data: [{ open_interest: oi, timestamp: `${day}T06:30:00.673` }] });
const NOW = {
  response: [
    contract('2026-11-20', 7600, 'CALL', 971, '2026-10-30'),
    contract('2026-11-20', 7600, 'PUT', 13584, '2026-10-30'),
    contract('2026-11-20', 7550, 'PUT', 500, '2026-10-30'),
    contract('2026-11-06', 7600, 'CALL', 300, '2026-10-30'),
    contract('2026-11-06', 7650, 'CALL', 40, '2026-10-30'),
    /* an expiry already settled at the close the report counts: not in the book */
    contract('2026-10-29', 7600, 'PUT', 9999, '2026-10-30'),
  ],
};
const PRIOR = {
  response: [
    contract('2026-11-20', 7600, 'CALL', 916, '2026-10-29'),
    contract('2026-11-20', 7600, 'PUT', 12000, '2026-10-29'),
    contract('2026-11-20', 7550, 'PUT', 800, '2026-10-29'),
    contract('2026-11-06', 7600, 'CALL', 100, '2026-10-29'),
    contract('2026-10-29', 7600, 'PUT', 5000, '2026-10-29'),
  ],
};
const now = readOiReport(NOW);
const prior = readOiReport(PRIOR);
check('report: by expiry, [strike, calls, puts]', JSON.stringify(now['2026-11-20']) === JSON.stringify([[7550, 0, 500], [7600, 971, 13584]]), JSON.stringify(now['2026-11-20']));

const one = oiChange(now, prior, { expiry: '2026-11-20', from: '2026-10-30' });
const r7600 = one.rows.find((r) => r[0] === 7600);
check('Nov 20 7600C: 916 → 971 = +55; 7600P: 12,000 → 13,584 = +1,584', r7600[1] - r7600[2] === 55 && r7600[3] - r7600[4] === 1584, JSON.stringify(r7600));
check('Nov 20 7550P: 800 → 500 = −300, the one unwind', one.unwinds.length === 1 && one.unwinds[0].strike === 7550 && one.unwinds[0].d === -300);
check('builds ranked by size: 7600P +1,584, then 7600C +55', one.builds[0].strike === 7600 && one.builds[0].right === 'P' && one.builds[0].d === 1584 && one.builds[1].d === 55);

const book = oiChange(now, prior, { expiry: 'book', from: '2026-10-30' });
const b7600 = book.rows.find((r) => r[0] === 7600);
check('whole book: Nov 6 and Nov 20 only (Oct 29 settled before the close the report counts)', JSON.stringify(book.expiries) === '["2026-11-06","2026-11-20"]');
check('whole book 7600C: (971 + 300) − (916 + 100) = +255; the settled Oct 29 puts are not an unwind', b7600[1] - b7600[2] === 255 && b7600[3] - b7600[4] === 1584);
check('a new strike (Nov 6 7650C, no prior figure) is a build of +40', book.builds.some((m) => m.strike === 7650 && m.d === 40 && m.prior === 0));
check('totals: calls 1,016 → 1,311, puts 12,800 → 14,084', book.totals.callPrior === 1016 && book.totals.call === 1311 && book.totals.putPrior === 12800 && book.totals.put === 14084, JSON.stringify(book.totals));
check('an expiry not in the report: no rows', oiChange(now, prior, { expiry: '2026-12-18', from: '2026-10-30' }).rows.length === 0);

/* ---- 3. the server reader against a counting terminal ---- */
{
  let t = nyInstant('2026-10-31', 18 * 60);
  const calls = [];
  let peak = 0;
  let inFlight = 0;
  /* reports on file: Oct 29, Oct 30, Nov 2 — but Nov 2's not before 06:30 */
  const onFile = (day) => (day === '2026-10-30' ? NOW : day === '2026-10-29' ? PRIOR : day === '2026-11-02' ? NOW : null);
  const theta = async (p, opt) => {
    calls.push(p);
    if (opt?.lane !== 'record') throw new Error('not on the record lane');
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const m = /date=(\d{4})(\d{2})(\d{2})/.exec(p);
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const rep = onFile(day);
    if (day === '2026-11-02' && t < nyInstant('2026-11-02', 6 * 60 + 30)) return { status: 472, body: 'No data for the specified timeframe' };
    return rep ? { status: 200, body: JSON.stringify(rep) } : { status: 472, body: 'none' };
  };
  const r = createRegime({ theta, dir: null, now: () => t });
  const a = await r.oi('SPX', '2026-11-20', { wait: true });
  check('first ask for SPX: two all-expiration reads of SPXW (Oct 30, Oct 29)', calls.length === 2 && calls.every((p) => /^\/option\/history\/open_interest\?symbol=SPXW&expiration=\*&date=2026103[0]|^\/option\/history\/open_interest\?symbol=SPXW&expiration=\*&date=20261029/.test(p)), calls.join(' '));
  check('the same path the exposure history reads (one hub key for both)', calls.every((p) => /&format=json$/.test(p) && !/max_dte|strike_range/.test(p)));
  check('labelled: the Oct 29 close vs the Oct 28 close, reported Oct 30 and Oct 29', a.day === '2026-10-30' && a.prior === '2026-10-29' && a.close === '2026-10-29' && a.priorClose === '2026-10-28');
  check('the answer is the change: 7600C +55', a.rows.find((x) => x[0] === 7600)[1] - a.rows.find((x) => x[0] === 7600)[2] === 55);
  await r.oi('SPX', 'book', { wait: true });
  await r.oi('SPX', '2026-11-06', { wait: true });
  check('another scope, the same reports: no new request', calls.length === 2);
  check('never more than two reads at once', peak <= 2 && r.stats().peakHistory <= 2);

  /* Monday 06:00: Monday's report is not on file — Friday's two still serve (no new request beyond the one try) */
  t = nyInstant('2026-11-02', 6 * 60);
  const pre = await r.oi('SPX', 'book', { wait: true });
  check('Mon 06:00: Friday\'s report still the latest, nothing re-read', pre.day === '2026-10-30' && calls.length === 2);
  /* 06:40: Monday's is stamped — ONE request, its prior (Oct 30) already held */
  t = nyInstant('2026-11-02', 6 * 60 + 40);
  const mon = await r.oi('SPX', 'book', { wait: true });
  check('Mon 06:40: one new request (Nov 2); the prior is Friday\'s, already held', calls.length === 3 && /date=20261102/.test(calls[2]) && mon.day === '2026-11-02' && mon.prior === '2026-10-30', calls.slice(2).join(' '));
  check('…labelled the Oct 30 close vs the Oct 29 close', mon.close === '2026-10-30' && mon.priorClose === '2026-10-29');
}

{
  /* a late stamp: at 06:40 the morning's report is not on file yet — the reader falls back, and asks again in 10 min */
  let t = nyInstant('2026-11-02', 6 * 60 + 40);
  const calls = [];
  const theta = async (p) => {
    calls.push(p);
    const day = /date=(\d{8})/.exec(p)[1];
    if (day === '20261102') return { status: 472, body: 'none' };
    return { status: 200, body: JSON.stringify(day === '20261030' ? NOW : PRIOR) };
  };
  const r = createRegime({ theta, dir: null, now: () => t });
  await r.oi('SPY', 'book', { wait: true });
  const a = await r.oi('SPY', 'book', { wait: true });
  check('a late stamp: Friday\'s report vs Thursday\'s, after one try at Monday\'s', a.day === '2026-10-30' && a.rows?.length > 0 && calls.filter((p) => /20261102/.test(p)).length === 1, calls.join(' '));
  t += 5 * 60_000;
  await r.oi('SPY', 'book', { wait: true });
  check('five minutes on: Monday\'s is not asked again yet', calls.filter((p) => /20261102/.test(p)).length === 1);
  t += 6 * 60_000;
  await r.oi('SPY', 'book', { wait: true });
  check('eleven minutes on: Monday\'s is asked once more', calls.filter((p) => /20261102/.test(p)).length === 2);
}

console.log(failed ? `\n${failed} check(s) failed` : '\noi-change proof: all checks passed');
process.exit(failed ? 1 : 0);
