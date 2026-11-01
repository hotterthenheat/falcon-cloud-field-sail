/*
  The complete open-interest change (shared/oiChange.mjs, server/oiChangeApi.mjs) against known numbers and a counting
  stand-in for the terminal: the change contract by contract, the dates compared (OI is stamped ~06:30 ET for the
  PREVIOUS close), SPX's two roots, and the request budget — two all-expiration reads per root for a name's first day,
  one a day after (yesterday's latest is today's prior), kept on disk across a restart, two reads at once at most.
  The recorded terminal answers and Building's hand sum are in scripts/golden/pinpoint-golden.ts.
  Run: node scripts/oi-change-proof.mjs
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nyInstant } from '../shared/marketSession.mjs';
import { mergeReports, oiChangeRows, oiReportDay, oiRootsOf, priorSession, readOiReport } from '../shared/oiChange.mjs';
import { createOiChange, proxyOiChange } from '../server/oiChangeApi.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- 1. the dates ---- */
check('Sat Oct 31: the latest report is Fri Oct 30 (it counts the Oct 29 close)', oiReportDay(nyInstant('2026-10-31', 18 * 60)) === '2026-10-30' && priorSession('2026-10-30') === '2026-10-29');
check("Mon Nov 2 06:00 (before the stamp): still Friday's report", oiReportDay(nyInstant('2026-11-02', 6 * 60)) === '2026-10-30');
check("Mon Nov 2 06:40 (after the stamp): Monday's report, prior Friday", oiReportDay(nyInstant('2026-11-02', 6 * 60 + 40)) === '2026-11-02' && priorSession('2026-11-02') === '2026-10-30');
check('Fri Nov 27 (after Thanksgiving): the prior report is Wed Nov 25', priorSession('2026-11-27') === '2026-11-25');
check('SPX reads both its roots (SPX monthlies, SPXW dailies); SPY reads SPY', JSON.stringify(oiRootsOf('SPX')) === '["SPX","SPXW"]' && JSON.stringify(oiRootsOf('spy')) === '["SPY"]');

/* ---- 2. the arithmetic, by hand ---- */
const contract = (root, exp, strike, right, oi, day) => ({ contract: { right, strike, symbol: root, expiration: exp }, data: [{ open_interest: oi, timestamp: `${day}T06:30:00.673` }] });
const SPY_NOW = {
  response: [
    contract('SPY', '2026-11-20', 800, 'CALL', 153613, '2026-10-29'),
    contract('SPY', '2026-11-20', 800, 'PUT', 500, '2026-10-29'),
    contract('SPY', '2026-11-20', 750, 'PUT', 0, '2026-10-29'),
    contract('SPY', '2026-11-06', 800, 'CALL', 300, '2026-10-29'),
    contract('SPY', '2026-11-06', 810, 'CALL', 40, '2026-10-29'),
    contract('SPY', '2026-11-06', 820, 'CALL', 7, '2026-10-29'),
    /* an expiry already settled at the close the report counts: not counted */
    contract('SPY', '2026-10-28', 800, 'PUT', 9999, '2026-10-29'),
  ],
};
const SPY_PRIOR = {
  response: [
    contract('SPY', '2026-11-20', 800, 'CALL', 149421, '2026-10-28'),
    contract('SPY', '2026-11-20', 800, 'PUT', 800, '2026-10-28'),
    contract('SPY', '2026-11-20', 750, 'PUT', 1200, '2026-10-28'),
    contract('SPY', '2026-11-06', 800, 'CALL', 100, '2026-10-28'),
    contract('SPY', '2026-11-06', 820, 'CALL', 7, '2026-10-28'),
    /* listed on the earlier report, gone from the later: closed out */
    contract('SPY', '2026-11-13', 790, 'PUT', 25, '2026-10-28'),
    contract('SPY', '2026-10-28', 800, 'PUT', 5000, '2026-10-28'),
  ],
};
const now = readOiReport(SPY_NOW);
const prior = readOiReport(SPY_PRIOR);
check('report: one figure per contract, keyed expiry|strike|side', now['2026-11-20|800|C'] === 153613 && now['2026-11-20|800|P'] === 500 && Object.keys(now).length === 7);
const rows = oiChangeRows(now, prior, '2026-10-29');
const at = (exp, k, r) => rows.find((x) => x[0] === exp && x[1] === k && x[2] === r)?.[3];
check('Nov 20 800C: 149,421 → 153,613 = +4,192 (the vendor row SPY261120C00800000 reads the same two figures)', at('2026-11-20', 800, 'C') === 4192);
check('Nov 20 800P: 800 → 500 = −300; 750P: 1,200 → 0 = −1,200', at('2026-11-20', 800, 'P') === -300 && at('2026-11-20', 750, 'P') === -1200);
check('a new contract (Nov 6 810C, not on the earlier report) is +40', at('2026-11-06', 810, 'C') === 40);
check('a contract gone from the later report (Nov 13 790P) is −25', at('2026-11-13', 790, 'P') === -25);
check('an unchanged contract (Nov 6 820C, 7 → 7) is not listed', at('2026-11-06', 820, 'C') === undefined);
check('the expiry settled at the counted close (Oct 28) is not an unwind', rows.every((r) => r[0] >= '2026-10-29'));
check('ordered by expiry, strike, side', JSON.stringify(rows.map((r) => `${r[0]}|${r[1]}|${r[2]}`)) === JSON.stringify(['2026-11-06|800|C', '2026-11-06|810|C', '2026-11-13|790|P', '2026-11-20|750|P', '2026-11-20|800|C', '2026-11-20|800|P']), JSON.stringify(rows));
const sum = rows.reduce((a, r) => a + r[3], 0);
check('the total by hand: +200 + 40 − 25 − 1,200 + 4,192 − 300 = +2,907', sum === 2907, String(sum));
check('two roots on one expiry and strike add', mergeReports([{ 'x|1|C': 2 }, { 'x|1|C': 3, 'x|1|P': 1 }])['x|1|C'] === 5);

/* ---- 3. the server reader against a counting terminal ---- */
/* Oct 30's report is SPY_NOW, Oct 29's (and Oct 28's) SPY_PRIOR; Nov 2's is Oct 30's with Nov 20 800C up 10 */
const bodyFor = (root, day) => {
  const src = day === '2026-10-30' || day === '2026-11-02' ? SPY_NOW : SPY_PRIOR;
  const bump = (r) => (day === '2026-11-02' && r.contract.expiration === '2026-11-20' && r.contract.strike === 800 && r.contract.right === 'CALL' ? { ...r, data: [{ ...r.data[0], open_interest: r.data[0].open_interest + 10 }] } : r);
  return { response: src.response.map((r) => ({ ...bump(r), contract: { ...r.contract, symbol: root } })) };
};
{
  let t = nyInstant('2026-10-31', 18 * 60);
  const calls = [];
  let peak = 0;
  let inFlight = 0;
  const reportDays = new Set(['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02']);
  const theta = async (p, opt) => {
    calls.push(p);
    if (opt?.lane !== 'record') throw new Error('not on the record lane');
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const m = /symbol=([A-Z]+)&expiration=\*&date=(\d{4})(\d{2})(\d{2})&format=json$/.exec(p);
    const day = `${m[2]}-${m[3]}-${m[4]}`;
    if (day === '2026-11-02' && t < nyInstant('2026-11-02', 6 * 60 + 30)) return { status: 472, body: 'No data for the specified timeframe' };
    return reportDays.has(day) ? { status: 200, body: JSON.stringify(bodyFor(m[1], day)) } : { status: 472, body: 'none' };
  };
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'oi-change-proof-'));
  const r = createOiChange({ theta, dir, now: () => t });
  const a = await r.change('SPY', { waitMs: 5_000 });
  check('first ask for SPY: two all-expiration reads (Oct 30, Oct 29)', calls.length === 2 && calls.some((p) => /symbol=SPY&expiration=\*&date=20261030&format=json$/.test(p)) && calls.some((p) => /date=20261029/.test(p)), calls.join(' '));
  check('the same path the exposure history reads (one hub key for both)', calls.every((p) => /^\/option\/history\/open_interest\?symbol=SPY&expiration=\*&date=\d{8}&format=json$/.test(p)));
  check('labelled: report Oct 30 against report Oct 29 — the Oct 29 close against the Oct 28 close', a.day === '2026-10-30' && a.prior === '2026-10-29' && a.close === '2026-10-29' && a.priorClose === '2026-10-28');
  check('the answer is the complete change, from the terminal: the six contracts that moved, of 7 listed', a.source === 'terminal' && JSON.stringify(a.rows) === JSON.stringify(rows) && a.contracts === 7);
  await r.change('SPY', { waitMs: 5_000 });
  check('asked again: no new request', calls.length === 2);
  check('never more than two reads at once', peak <= 2 && r.stats().peakHistory <= 2);

  const spx = await r.change('SPX', { waitMs: 5_000 });
  const spxCalls = calls.slice(2);
  check('SPX: both roots for both dates, four reads', spxCalls.length === 4 && ['SPX', 'SPXW'].every((root) => spxCalls.filter((p) => p.includes(`symbol=${root}&`)).length === 2), spxCalls.join(' '));
  check('SPX: the two roots added — Nov 20 800C +4,192 × 2', spx.rows.find((x) => x[0] === '2026-11-20' && x[1] === 800 && x[2] === 'C')?.[3] === 8384);
  check('…and still two reads at once at most', peak <= 2);

  /* Monday 06:00: Monday's report is not on file — Friday's two still serve */
  t = nyInstant('2026-11-02', 6 * 60);
  const pre = await r.change('SPY', { waitMs: 5_000 });
  check("Mon 06:00: Friday's report still the latest, nothing read", pre.day === '2026-10-30' && calls.length === 6);
  /* 06:40: Monday's is stamped — ONE request, its prior (Oct 30) already held */
  t = nyInstant('2026-11-02', 6 * 60 + 40);
  const mon = await r.change('SPY', { waitMs: 5_000 });
  check("Mon 06:40: one new request (Nov 2); the prior is Friday's, already held", calls.length === 7 && /date=20261102/.test(calls[6]) && mon.day === '2026-11-02' && mon.prior === '2026-10-30', calls.slice(6).join(' '));
  check('…labelled the Oct 30 close against the Oct 29 close', mon.close === '2026-10-30' && mon.priorClose === '2026-10-29');
  check("…and the change is Friday's trading alone: Nov 20 800C +10", JSON.stringify(mon.rows) === JSON.stringify([['2026-11-20', 800, 'C', 10]]), JSON.stringify(mon.rows));

  /* a restart: a new reader on the same disk reads nothing */
  const again = createOiChange({ theta, dir, now: () => t });
  const kept = await again.change('SPY', { waitMs: 5_000 });
  check('after a restart the reports come off disk: no request', calls.length === 7 && kept.day === '2026-11-02' && JSON.stringify(kept.rows) === JSON.stringify(mon.rows));
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  /* a late stamp: at 06:40 the morning's report is not on file yet — the reader falls back, and asks again in 10 min */
  let t = nyInstant('2026-11-02', 6 * 60 + 40);
  const calls = [];
  const theta = async (p) => {
    calls.push(p);
    const day = /date=(\d{8})/.exec(p)[1];
    if (day === '20261102') return { status: 472, body: 'none' };
    return { status: 200, body: JSON.stringify(day === '20261030' ? SPY_NOW : SPY_PRIOR) };
  };
  const r = createOiChange({ theta, dir: null, now: () => t });
  const a = await r.change('SPY', { waitMs: 5_000 });
  check("a late stamp: Friday's report against Thursday's, after one try at Monday's", a.day === '2026-10-30' && a.prior === '2026-10-29' && a.rows?.length > 0 && calls.filter((p) => /20261102/.test(p)).length === 1, calls.join(' '));
  t += 5 * 60_000;
  await r.change('SPY', { waitMs: 5_000 });
  check("five minutes on: Monday's is not asked again yet", calls.filter((p) => /20261102/.test(p)).length === 1);
  t += 6 * 60_000;
  await r.change('SPY', { waitMs: 5_000 });
  check("eleven minutes on: Monday's is asked once more", calls.filter((p) => /20261102/.test(p)).length === 2);
}

{
  /* the terminal down: an error the page falls back on, and no new read for a minute */
  let t = nyInstant('2026-10-30', 10 * 60);
  let n = 0;
  const r = createOiChange({ theta: async () => (n++, { status: 503, body: '{"error":"The terminal is not running.","code":"terminal_down"}' }), dir: null, now: () => t });
  const a = await r.change('SPY', { waitMs: 5_000 });
  check('terminal down: answered terminal_down (the page then reads the movers’ list)', a.error === 'terminal_down' && !a.rows);
  const before = n;
  await r.change('SPY', { waitMs: 5_000 });
  check('…and not asked again within the minute', n === before);
  t += 61_000;
  await r.change('SPY', { waitMs: 5_000 });
  check('…asked again after it', n > before);
}

{
  /* the route: a ticker is required before anything is read */
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await proxyOiChange({ method: 'GET', url: '/api/oi-change/', headers: {} }, res);
  check('GET /api/oi-change/ with no ticker answers 400', res.statusCode === 400);
}

console.log(failed ? `\n${failed} check(s) failed` : '\noi-change proof: all checks passed');
process.exit(failed ? 1 : 0);
