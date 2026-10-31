/*
  The vol-regime panel (shared/volRegime.mjs, server/regimeApi.mjs) against known numbers and a counting stand-in for
  the terminal: the figures, the quirks (the zero 09:30 bar, the VIX's holiday closes), and the request budget — one
  snapshot for seven indices, ONE year request per symbol per day, the day's path read once and then only its new
  minutes, never more than two history reads at once.
  Run: node scripts/vol-regime-proof.mjs
*/

import { isSessionDay, nyInstant } from '../shared/marketSession.mjs';
import { percentileOf, readDailyCloses, readMinuteCloses, readSnapshot, regimeOf, yearEnd, yearRead } from '../shared/volRegime.mjs';
import { createRegime, HISTORY_AT_ONCE } from '../server/regimeApi.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) <= eps;

/* ---- 1. the arithmetic, by hand ---- */

/* Friday 2026-10-30's close, as the terminal answered it (the audit's probe p05) */
const SNAP = {
  response: [
    { symbol: 'VIX1D', price: 19.33, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'VIX9D', price: 19.25, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'VIX', price: 19.42, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'VIX3M', price: 20.78, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'VIX6M', price: 22.2, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'VVIX', price: 106.43, timestamp: '2026-10-30T16:15:01.000' },
    { symbol: 'SKEW', price: 149.76, timestamp: '2026-10-30T17:00:46.000' },
  ],
};
const q = readSnapshot(SNAP);
check('snapshot: seven indices read', Object.keys(q).length === 7);
check('VIX/VIX3M = 19.42 / 20.78 = 0.9346 (contango)', near(q.VIX.price / q.VIX3M.price, 0.934552454, 1e-8) && regimeOf(q.VIX.price / q.VIX3M.price) === 'contango');
check('VIX9D/VIX = 19.25 / 19.42 = 0.9912', near(q.VIX9D.price / q.VIX.price, 0.991246138, 1e-8));
check('regime: 1.035 is backwardation, 1.003 flat, 0.97 contango', regimeOf(1.035) === 'backwardation' && regimeOf(1.003) === 'flat' && regimeOf(0.97) === 'contango');

/* the first bar of the session is all zeros (probe p07): dropped */
const BARS = {
  response: [
    { open: 0, high: 0, low: 0, close: 0, timestamp: '2026-10-30T09:30:00.000' },
    { open: 20.36, high: 20.39, low: 20.36, close: 20.37, timestamp: '2026-10-30T09:31:00.000' },
    { open: 20.35, high: 20.39, low: 20.35, close: 20.39, timestamp: '2026-10-30T09:32:00.000' },
  ],
};
const mins = readMinuteCloses(BARS);
check('1m bars: the zero 09:30 bar is dropped', mins.length === 2 && mins[0][0] === 571 && mins[0][1] === 20.37, JSON.stringify(mins));

/* the VIX also closes Cboe's holiday sessions; a year of closes is the cash market's year */
const EOD = {
  response: [
    { last_trade: '2026-11-25T16:15:01.000', created: '2026-11-25T17:15:00.000', close: 15 },
    { last_trade: '2026-11-26T11:30:00.000', created: '2026-11-26T12:15:00.000', close: 99 },
    { last_trade: '2026-11-27T13:15:00.000', created: '2026-11-27T14:15:00.000', close: 16 },
  ],
};
const closes = readDailyCloses(EOD);
check('daily closes: Thanksgiving (a holiday session) is not a close', closes.length === 2 && closes.every(([d]) => d !== '2026-11-26'), JSON.stringify(closes));

check('percentile: 35 among 10,20,30,40 is the 75th', percentileOf([10, 20, 30, 40], 35) === 75);
check('percentile: ties count half (20 among 10,20,20,30 is the 50th)', percentileOf([10, 20, 20, 30], 20) === 50);
check('percentile: above the year is the 100th, below it the 0th', percentileOf([1, 2, 3], 9) === 100 && percentileOf([1, 2, 3], 0) === 0);
const yr = yearRead([['2026-10-28', 16.91], ['2026-10-29', 17.2]], 19.42);
check('year read: the change is from the last close (19.42 − 17.20 = +2.22)', near(19.42 - yr.prev, 2.22, 1e-9) && yr.prevDay === '2026-10-29' && yr.pct === 100);
check('year end: the session before the regime day (Mon Nov 2 → Fri Oct 30; Fri Nov 27 → Wed Nov 25)', yearEnd('2026-11-02') === '2026-10-30' && yearEnd('2026-11-27') === '2026-11-25');

/* ---- 2. the server reader against a counting terminal ---- */

const SYMS = ['VIX1D', 'VIX9D', 'VIX', 'VIX3M', 'VIX6M', 'VVIX', 'SKEW'];
/* a year of 252 session closes, 1..252, for every symbol (a print of 19.42 has 19 below it: the 7.54th percentile) */
const yearRows = () => {
  const rows = [];
  let d = new Date(Date.UTC(2025, 9, 31));
  let n = 0;
  while (n < 252) {
    d = new Date(d.getTime() + 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || !isSessionDay(iso)) continue;
    n += 1;
    rows.push({ last_trade: `${iso}T16:15:01.000`, close: n });
  }
  return rows;
};
function terminal({ day = '2026-10-30', stamp = '16:15:01', bars = (sym) => [] } = {}) {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  return {
    calls,
    peak: () => peak,
    of: (re) => calls.filter((p) => re.test(p)),
    theta: async (p, opt) => {
      calls.push(p);
      if (opt?.lane !== 'record') throw new Error('not on the record lane');
      const hist = /\/history\//.test(p);
      if (hist) peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      if (hist) inFlight -= 1;
      if (p.startsWith('/index/snapshot/price')) return { status: 200, body: JSON.stringify({ response: SNAP.response.map((r) => ({ ...r, timestamp: `${day}T${stamp}.000` })) }) };
      if (p.startsWith('/index/history/eod')) return { status: 200, body: JSON.stringify({ response: yearRows() }) };
      if (p.startsWith('/index/history/ohlc')) {
        const sym = /symbol=([A-Z0-9]+)/.exec(p)[1];
        const from = /start_time=(\d\d):(\d\d)/.exec(p);
        const fromMin = Number(from[1]) * 60 + Number(from[2]);
        return { status: 200, body: JSON.stringify({ response: bars(sym).filter(([m]) => m >= fromMin).map(([m, c]) => ({ close: c, timestamp: `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000` })) }) };
      }
      return { status: 404, body: '{}' };
    },
  };
}

{
  /* Saturday evening, 2026-10-31 18:00 ET: the last prints are Friday's close */
  let t = nyInstant('2026-10-31', 18 * 60);
  const FRI = { VIX: [[570, 0], [571, 18], [975, 19.42]], VIX3M: [[570, 0], [571, 20], [975, 20.78]], VIX9D: [[571, 19], [975, 19.25]] };
  const term = terminal({ bars: (s) => FRI[s] ?? [] });
  const r = createRegime({ theta: term.theta, dir: null, now: () => t });
  const first = await r.vol();
  await r.settle();
  const a = await r.vol();
  check('one snapshot request for all seven indices', term.of(/snapshot/).length === 1 && SYMS.every((s) => term.of(/snapshot/)[0].includes(s)), term.of(/snapshot/)[0]);
  check('one year request per symbol (7), ending the session before the regime day', term.of(/eod/).length === 7 && term.of(/eod/).every((p) => /start_date=20251029&end_date=20261029/.test(p)), term.of(/eod/)[0]);
  check('the day\'s path: one 1m read per ratio symbol (VIX, VIX3M, VIX9D), from 03:00', term.of(/ohlc/).length === 3 && term.of(/ohlc/).every((p) => /start_date=20261030&end_date=20261030&interval=1m&start_time=03:00:00/.test(p)));
  check(`never more than ${HISTORY_AT_ONCE} history reads at once`, term.peak() <= HISTORY_AT_ONCE && r.stats().peakHistory <= HISTORY_AT_ONCE, `peak ${term.peak()}`);
  check('the first answer is the prints, with the year and path pending', first.quotes.length === 7 && first.pending.year === true);
  check('regime day Fri Oct 30, as of 16:15, not live on a Saturday', a.day === '2026-10-30' && a.asOf === '2026-10-30T16:15:01' && a.live === false && a.regime === 'contango');
  const vix = a.quotes.find((x) => x.sym === 'VIX');
  /* 19.42 among 1..252: 19 below → 19/252 */
  check('VIX 19.42 sits at the 7.54th percentile of closes 1..252, change from the last close (252)', near(vix.pct, (19 / 252) * 100, 1e-9) && vix.prev === 252 && vix.n === 252, `${vix.pct}`);
  const ratio = a.ratios[0];
  check('VIX/VIX3M = 0.9346, its path 18/20 = 0.9 → 0.9346 (the zero bar gone)', ratio.value === 0.9346 && ratio.path.length === 2 && ratio.path[0][0] === 571 && ratio.path[0][1] === 0.9 && ratio.path[1][1] === 0.9346, JSON.stringify(ratio.path));
  check('the year\'s daily VIX/VIX3M closes are all 1.0 here, so 0.9346 is under every one: the 0th', a.ratios[0].pct === 0);

  /* thirty seconds later, and six minutes later: nothing new but the snapshot, once, at its idle pace */
  const before = term.calls.length;
  t += 30_000;
  await r.vol();
  await r.settle();
  check('30 s later on a closed day: no request at all', term.calls.length === before);
  t += 6 * 60_000;
  await r.vol();
  await r.settle();
  check('6 min later: one snapshot, no history (the finished day and the year are kept)', term.calls.length === before + 1 && term.of(/snapshot/).length === 2);
  /* Sunday: the regime day is still Friday — the year is not read again */
  t = nyInstant('2026-11-01', 12 * 60);
  await r.vol();
  await r.settle();
  check('Sunday: still Friday\'s regime day, so no new year request', term.of(/eod/).length === 7);
}

{
  /* a live morning: Monday 2026-11-02 at 10:00, the prints stamped today */
  let t = nyInstant('2026-11-02', 10 * 60);
  let lastMin = 600;
  const bars = (s) => {
    const out = [];
    for (let m = 571; m <= lastMin; m++) out.push([m, s === 'VIX' ? 19 : s === 'VIX3M' ? 20 : 18]);
    return out;
  };
  const term = terminal({ day: '2026-11-02', stamp: '10:00:00', bars });
  const r = createRegime({ theta: term.theta, dir: null, now: () => t });
  await r.vol();
  await r.settle();
  const a = await r.vol();
  check('a live morning: Live, the regime day today, the year ends Friday', a.live === true && a.day === '2026-11-02' && a.yearEnd === '2026-10-30');
  check('the path covers 09:31–10:00 (30 minutes)', a.ratios[0].path.length === 30 && a.ratios[0].path[0][1] === 0.95);
  const ohlc = term.of(/ohlc/).length;
  const snaps = term.of(/snapshot/).length;
  t += 5_000;
  await r.vol();
  await r.settle();
  check('5 s later: neither snapshot nor path re-read (10 s and 60 s paces)', term.of(/ohlc/).length === ohlc && term.of(/snapshot/).length === snaps);
  t += 61_000;
  lastMin = 601;
  await r.vol();
  await r.settle();
  const tops = term.of(/ohlc/).slice(ohlc);
  check('a minute later: one top-up per symbol, from the last bar\'s minute', tops.length === 3 && tops.every((p) => /start_time=10:00:00/.test(p)), tops[0]);
  const b = await r.vol();
  check('the path grows by the new minute', b.ratios[0].path.length === 31);
  /* requests per minute while live, one reader: snapshot every 10 s + 3 paths a minute */
  const c0 = term.calls.length;
  for (let i = 0; i < 6; i++) {
    t += 10_000;
    lastMin += i % 6 === 5 ? 1 : 0;
    await r.vol();
    await r.settle();
  }
  const perMin = term.calls.length - c0;
  check('a live minute costs at most 6 snapshots + 3 path reads, however often it is asked', perMin <= 9, `${perMin} requests`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nvol-regime proof: all checks passed');
process.exit(failed ? 1 : 0);
