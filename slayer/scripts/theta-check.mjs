/*
  Checks the ThetaData terminal the app reads: every kind of request the pages make, each asked twice (the second
  shows the warm speed), with its status, row count and time. Run it on the machine where the terminal runs:
    npm run theta:check            (THETA_REST_BASE moves it; default http://127.0.0.1:25503)
*/

const BASE = (process.env.THETA_REST_BASE || 'http://127.0.0.1:25503').replace(/\/+$/, '');
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = NY.format(new Date()).replace(/-/g, '');

async function ask(path) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}/v3${path}`, { signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    const ms = Math.round(performance.now() - t0);
    let rows = 0;
    try {
      const j = JSON.parse(text);
      const list = Array.isArray(j) ? j : Array.isArray(j?.response) ? j.response : Array.isArray(j?.data) ? j.data : null;
      rows = list ? list.length : 1;
    } catch {
      rows = Math.max(0, text.trim().split(/\r?\n/).length - 1);
    }
    return { status: r.status, ms, rows, text };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), rows: 0, text: String(e?.cause?.code || e?.message || e) };
  }
}

const rowsOf = (text) => {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : j?.response ?? j?.data ?? [];
  } catch {
    return [];
  }
};

const first = await ask('/stock/snapshot/quote?symbol=SPY&format=json');
if (first.status === 0) {
  console.log(`No terminal answers at ${BASE} (${first.text}). Start it with "npm run theta" (or "npm run dev").`);
  process.exit(1);
}
if (/invalid session id/i.test(first.text)) {
  console.log('The terminal is running but its session was taken: another ThetaData terminal is logged in with this account. Close the other one.');
  process.exit(1);
}
const q = rowsOf(first.text)[0] ?? {};
const spot = Number(q.bid && q.ask ? (Number(q.bid) + Number(q.ask)) / 2 : q.price ?? 0) || 0;
const exps = rowsOf((await ask('/option/list/expirations?symbol=SPY&format=json')).text)
  .map((r) => String(r.expiration ?? r).slice(0, 10).replace(/-/g, ''))
  .filter((e) => /^\d{8}$/.test(e) && e >= today)
  .sort();
const exp = exps[0] ?? today;
const strike = Math.round(spot || 0);
const lastDay = (() => {
  const d = new Date();
  for (let i = 1; i < 7; i++) {
    const x = new Date(d.getTime() - i * 86_400_000);
    const wd = x.getUTCDay();
    if (wd !== 0 && wd !== 6) return NY.format(x).replace(/-/g, '');
  }
  return today;
})();

const CHECKS = [
  ['stock quote (SPY)', '/stock/snapshot/quote?symbol=SPY&format=json'],
  ['index price (SPX)', '/index/snapshot/price?symbol=SPX&format=json'],
  ['expirations (SPXW)', '/option/list/expirations?symbol=SPXW&format=json'],
  [`chain quotes (SPY ${exp})`, `/option/snapshot/quote?symbol=SPY&expiration=${exp}&right=both&strike_range=20&format=json`],
  [`chain greeks (SPY ${exp})`, `/option/snapshot/greeks/first_order?symbol=SPY&expiration=${exp}&right=both&strike_range=20&format=json`],
  [`second-order greeks`, `/option/snapshot/greeks/second_order?symbol=SPY&expiration=${exp}&right=both&strike_range=10&format=json`],
  [`open interest`, `/option/snapshot/open_interest?symbol=SPY&expiration=${exp}&right=both&strike_range=20&format=json`],
  [`stock 1m bars (${lastDay})`, `/stock/history/ohlc?symbol=SPY&start_date=${lastDay}&end_date=${lastDay}&interval=1m&format=json`],
  [`index 1m bars (${lastDay})`, `/index/history/ohlc?symbol=SPX&start_date=${lastDay}&end_date=${lastDay}&interval=1m&format=json`],
  [`contract 1m bars (${strike}C)`, `/option/history/ohlc?symbol=SPY&expiration=${exp}&strike=${strike}&right=call&start_date=${lastDay}&end_date=${lastDay}&interval=1m&format=json`],
  [`contract NBBO history`, `/option/history/quote?symbol=SPY&expiration=${exp}&strike=${strike}&right=call&start_date=${lastDay}&end_date=${lastDay}&interval=1m&format=json`],
  ['calendar', '/calendar/today?format=json'],
  /* Compass's scan */
  ['weekly greeks (all expiries ≤11 DTE)', `/option/snapshot/greeks/first_order?symbol=SPY&expiration=*&right=both&strike_range=4&max_dte=11&format=json`],
  [`one contract's greeks (${strike}C)`, `/option/snapshot/greeks/first_order?symbol=SPY&expiration=${exp}&strike=${strike}&right=call&format=json`],
  [`open interest, whole expiry`, `/option/snapshot/open_interest?symbol=SPY&expiration=${exp}&format=json`],
  [`chain NBBO history, 1m`, `/option/history/quote?symbol=SPY&expiration=${exp}&start_date=${lastDay}&end_date=${lastDay}&strike_range=16&interval=1m&start_time=10:00:00&end_time=10:30:00&format=json`],
  [`contract NBBO history, 1s`, `/option/history/quote?symbol=SPY&expiration=${exp}&strike=${strike}&right=call&start_date=${lastDay}&end_date=${lastDay}&interval=1s&start_time=10:30:00&end_time=10:32:00&format=json`],
  [`stock 5m bars (${lastDay})`, `/stock/history/ohlc?symbol=SPY&start_date=${lastDay}&end_date=${lastDay}&interval=5m&format=json`],
  /* Practice: Paper and the Backtest replay */
  [`chain quotes, whole expiry`, `/option/snapshot/quote?symbol=SPY&expiration=${exp}&format=json`],
  [`contracts quoted on ${lastDay}`, `/option/list/contracts/quote?symbol=SPY&date=${lastDay}&max_dte=120&format=json`],
  [`chain NBBO for a day (date=)`, `/option/history/quote?symbol=SPY&expiration=${exp}&right=both&strike_range=14&date=${lastDay}&interval=1m&format=json`],
  [`dates quoted for ${exp}`, `/option/list/dates/quote?symbol=SPY&expiration=${exp}&format=json`],
  [`stock 1m bars (date=)`, `/stock/history/ohlc?symbol=SPY&date=${lastDay}&interval=1m&format=json`],
  [`contract NBBO today (paper catch-up)`, `/option/history/quote?symbol=SPY&expiration=${exp}&strike=${strike}&right=call&date=${today}&interval=1m&format=json`],
  [`daily closes (Pinpoint day change)`, `/stock/history/eod?symbol=SPY&start_date=${lastDay}&end_date=${lastDay}&format=json`],
];

console.log(`ThetaData terminal at ${BASE} · SPY ${spot ? spot.toFixed(2) : '?'} · nearest expiry ${exp}\n`);
console.log('check'.padEnd(34), 'status', 'rows'.padStart(6), 'cold ms'.padStart(8), 'warm ms'.padStart(8));
let bad = 0;
for (const [name, path] of CHECKS) {
  const a = await ask(path);
  const b = await ask(path);
  const ok = a.status === 200 && b.status === 200;
  if (!ok) bad += 1;
  const note = ok ? '' : `  ← ${a.text.replace(/\s+/g, ' ').slice(0, 90)}`;
  console.log(name.padEnd(34), String(a.status).padEnd(6), String(a.rows).padStart(6), String(a.ms).padStart(8), String(b.ms).padStart(8), note);
}
console.log(bad ? `\n${bad} check(s) failed.` : '\nEvery check answered.');
process.exit(bad ? 1 : 0);
