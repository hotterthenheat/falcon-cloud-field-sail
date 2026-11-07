/*
  Vol outlook proof: data/volOutlook.ts against the physics study (research/physics/scripts lib.py, halflife.py,
  build_features.py, evaluate.py) — the same numbers, from the same bars.

  1. Hand cases: the minute grid's carry rule, returns, five-minute realised vol, least squares, the half-life, the
     decision rows' 400-return rule, the annualisation.
  2. One known day, offline (scripts/fixtures/spy-1m-2026-10-29-30.json, the terminal's SPY minute rows): the daily
     ln RV of 2026-10-29 and 2026-10-30 against research/physics/results/gravity_rows_SPY.json, and the next-hour
     inputs, target and forecast at 10:00, 12:00 and 15:00 on 2026-10-30 against the study's own code (the values
     below were printed by lib.py + build_features.py's lrv lines + evaluate.py's baseline fit for 2026Q4).
  3. The whole study, when its cached bars are on this machine (research/physics/data/bars/SPY, `python3 fetch.py
     bars` — git-ignored): every session's ln RV against gravity_rows_SPY.json (940 sessions), halflife.py's SPY table
     (586 test days; MSE of RW, MA20, AR(1), HAR, HAR+VIX; φ and the half-life of the first and last refit) and
     evaluate.py's next-hour baseline (n 12,255, OOS R² 0.73508); then the live tile's trailing window scored on the
     same test months. Skipped, and said so, without the cache.

  Run:  npx tsx scripts/vol-outlook-proof.ts
*/
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  DECISIONS,
  HISTORY_SESSIONS,
  annualiseDay,
  annualiseHour,
  arForecast,
  dailyLogRv,
  dayGrid,
  dayReturns,
  fitDaily,
  fitHour,
  harForecast,
  harRow,
  hourForecast,
  hourReadAt,
  hourRows,
  hourX,
  lstsq,
  ma20At,
  minuteBarsOfRows,
  monthStart,
  quarterOf,
  type DayGrid,
  type HourRow,
} from '../src/data/volOutlook';
import { nyWallStamp } from '../src/core/nyTime';
import type { Candle } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const f6 = (v: number) => v.toFixed(6);

/* ------------------------------------------------------------------ 1. hand cases */
console.log('\n1. hand cases');
{
  /* a gap at minutes 3–4 carries minute 2's close; the first minute missing takes minute 1's open */
  const bars = Array.from({ length: 160 }, (_, i) => i)
    .filter(m => m !== 0 && m !== 3 && m !== 4)
    .map(m => ({ m, open: 100 + m, close: 100.5 + m }));
  const g = dayGrid('2026-01-02', bars)!;
  check('grid: minute 0 takes the first bar’s open', g.O[0] === 101 && g.C[0] === 101);
  check('grid: a gap carries the close before it', g.C[3] === 102.5 && g.C[4] === 102.5 && g.O[3] === 102.5);
  check('grid: NaN after the last bar', g.last === 159 && Number.isNaN(g.C[160]));
  check('grid: under 150 bars is not a day', dayGrid('2026-01-02', bars.slice(0, 140)) === null);
  check('grid: a zero close is not a bar', dayGrid('2026-01-02', [...bars.slice(0, 149), { m: 300, open: 1, close: 0 }]) === null);
  const r = dayReturns(g);
  check('returns: minute 0 is open→close, the rest close→close', r[0] === 0 && near(r[5], Math.log(105.5 / 102.5), 1e-15) && Number.isNaN(r[200]));
}
{
  /* every one-minute return is ρ: each five-minute return is 5ρ (the first from the open), 78 of them */
  const rho = 0.0004;
  const bars = Array.from({ length: 390 }, (_, m) => ({ m, open: 100 * Math.exp(rho * m), close: 100 * Math.exp(rho * (m + 1)) }));
  const g = dayGrid('2026-01-05', bars)!;
  const x = dailyLogRv(g);
  check('daily RV: constant ρ gives √78·5ρ', near(Math.exp(x), Math.sqrt(78) * 5 * rho, 1e-12), `${Math.exp(x).toExponential(6)}`);
  check('daily RV: under 200 minutes has none', Number.isNaN(dailyLogRv(dayGrid('2026-01-05', bars.slice(0, 199))!)));
  /* a half day: 211 bars; the 13:00 print (minute 210) is a minute, not a five-minute close */
  const half = dayGrid('2026-11-27', bars.slice(0, 211))!;
  check('daily RV: a half day samples minutes 4 … 209', near(Math.exp(dailyLogRv(half)), Math.sqrt(42) * 5 * rho, 1e-12));
  check('annualised: a day ×√252, an hour ×√(252·390/60)', near(annualiseDay(0.01), 0.01 * Math.sqrt(252), 1e-15) && near(annualiseHour(0.002), 0.002 * Math.sqrt(1638), 1e-15));
}
{
  const X = [[1, 0], [1, 1], [1, 2], [1, 3]];
  const b = lstsq(X, [1, 3, 5, 7])!;
  check('least squares: exact line', near(b[0], 1, 1e-12) && near(b[1], 2, 1e-12));
  const b2 = lstsq([[1, 1], [1, 2], [1, 3], [1, 4]], [6, 5, 7, 10])!;
  check('least squares: the normal-equation answer (3.5, 1.4)', near(b2[0], 3.5, 1e-12) && near(b2[1], 1.4, 1e-12));
  check('least squares: a dependent column is refused', lstsq([[1, 2], [2, 4], [3, 6]], [1, 2, 3]) === null);
  /* an AR(1) with φ = 0.5 exactly: x_{t+1} = −2.5 + 0.5 x_t from a fresh shock every ten sessions; a session with no
     realised vol (NaN) between the runs, so no row spans a reset */
  const x: number[] = [];
  for (let k = 0; k < 14; k++) {
    x.push(-5 + 1.5 * Math.sin(k * 1.7));
    for (let s = 0; s < 8; s++) x.push(-2.5 + 0.5 * x[x.length - 1]);
    x.push(NaN);
  }
  const fit = fitDaily(x, x.length)!;
  check('half-life: φ = 0.5 halves in one session', near(fit.phi, 0.5, 1e-9) && near(fit.halfLife, 1, 1e-9), `φ=${f6(fit.phi)} hl=${f6(fit.halfLife)}`);
  check('HAR row: [1, x_t, mean5, mean22], cut at the start', JSON.stringify(harRow([1, 2, 3], 2)) === JSON.stringify([1, 3, 2, 2]));
  check('the forecasts are the rows times the fit', near(arForecast(fit, x, 70), fit.ar[0] + fit.ar[1] * x[70], 1e-12) && near(harForecast(fit, x, 70), harRow(x, 70).reduce((s, v, i) => s + v * fit.har[i], 0), 1e-12));
}
{
  /* rows need 400 returns before them and their minute j−1 */
  const day = (d: string) => ({ day: d, r: Float64Array.from({ length: 390 }, (_, m) => 0.0001 * (1 + (m % 7))) });
  const one = hourRows([day('2026-01-05')]);
  check('rows: none on the first day (fewer than 400 returns before)', one.length === 0);
  const two = hourRows([day('2026-01-05'), day('2026-01-06')]);
  check('rows: all 21 decisions on the second day', two.length === 21 && two[0].j === 30 && two[20].j === 330);
  check('rows: 15:00 has its next 60 minutes, so a target', two.every(r => Number.isFinite(r.y)));
  const short = { day: '2026-01-07', r: Float64Array.from({ length: 390 }, (_, m) => (m < 200 ? 0.0002 : NaN)) };
  const three = hourRows([day('2026-01-05'), day('2026-01-06'), short]).filter(r => r.day === '2026-01-07');
  check('rows: a day ending at minute 199 stops at the 13:15 decision; 12:30 has no full next hour', three.length === 12 && three[three.length - 1].j === 195 && !Number.isFinite(three.find(r => r.j === 150)!.y) && Number.isFinite(three.find(r => r.j === 135)!.y));
  check('rows: the regressors are 21 dummies then ln RV 60, 390, 15', JSON.stringify(hourX({ j: 45, l15: 3, l60: 1, l390: 2 }).slice(0, 3)) === '[0,1,0]' && hourX({ j: 45, l15: 3, l60: 1, l390: 2 }).slice(21).join() === '1,2,3');
}

/* ------------------------------------------------------------------ 2. one known day, offline */
console.log('\n2. SPY 2026-10-29 and 2026-10-30 from the terminal’s rows (fixture)');
const ROOT = new URL('..', import.meta.url).pathname;
const gravity = JSON.parse(readFileSync(join(ROOT, 'research/physics/results/gravity_rows_SPY.json'), 'utf8').replace(/\bNaN\b/g, 'null')) as { day: string; rv: number; rvp: number }[];
const gravityRv = new Map(gravity.map(g => [g.day, g.rv]));
{
  const fixture = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/spy-1m-2026-10-29-30.json'), 'utf8'));
  const byDay = minuteBarsOfRows(fixture.response);
  const g29 = dayGrid('2026-10-29', byDay.get('2026-10-29')!)!;
  const g30 = dayGrid('2026-10-30', byDay.get('2026-10-30')!)!;
  const x29 = dailyLogRv(g29);
  const x30 = dailyLogRv(g30);
  check('ln RV 2026-10-29 = the study’s (gravity_rows rvp of 10-30)', near(x29, -5.18670445393548, 1e-12), `${x29} vs -5.18670445393548`);
  check('ln RV 2026-10-30 = the study’s (gravity_rows rv)', near(x30, gravityRv.get('2026-10-30')!, 1e-12), `${x30} vs ${gravityRv.get('2026-10-30')}`);
  console.log(`     2026-10-30 realised ${(annualiseDay(Math.exp(x30)) * 100).toFixed(2)}% annualised`);
  /* the study's 2026Q4 next-hour fit (every row before 2026-10-01, the expanding window), printed by its own code */
  const BETA_2026Q4 = [
    -0.5293538878342807, -0.6558990617840761, -0.6776361216524381, -0.6865524959194518, -0.700389696087292, -0.6944770734989024, -0.6899884656432028,
    -0.6930260128716557, -0.680106119661447, -0.6512164356654115, -0.6314730604859982, -0.6231232704014639, -0.6176481175802823, -0.6220168558820258,
    -0.6204146698972084, -0.6164366251991018, -0.5881970831785917, -0.6286619166890985, -0.6106634902223242, -0.6075461351170766, -0.45939826534363487,
    0.4427263613660155, 0.24901674287453346, 0.2307575775258098,
  ];
  const REF = [
    { j: 30, l15: -6.889599700188593, l60: -6.09390994596403, l390: -5.246149571604162, y: -5.964459422951171, pred: -6.123494880594671 },
    { j: 180, l15: -7.166484300772746, l60: -6.357125331163639, l390: -5.3569395389506935, y: -6.165506858946341, pred: -6.433628219488175 },
    { j: 330, l15: -6.510874391204117, l60: -5.979731263625356, l390: -5.21236328257907, y: -5.550058633953147, pred: -5.907182259030841 },
  ];
  const rows = hourRows([{ day: g29.day, r: dayReturns(g29) }, { day: g30.day, r: dayReturns(g30) }], [], 10_000).filter(r => r.day === '2026-10-30');
  for (const ref of REF) {
    const row = rows.find(r => r.j === ref.j)!;
    const pred = hourForecast(BETA_2026Q4, row);
    const ok = near(row.l15, ref.l15, 1e-12) && near(row.l60, ref.l60, 1e-12) && near(row.l390, ref.l390, 1e-12) && near(row.y, ref.y, 1e-12) && near(pred, ref.pred, 1e-12);
    check(`next hour at minute ${ref.j}: inputs, target and forecast = the study’s`, ok, `forecast ${(annualiseHour(Math.exp(pred)) * 100).toFixed(2)}% realised ${(annualiseHour(Math.exp(row.y)) * 100).toFixed(2)}%`);
  }
  /* the tile's live path: today's bars as the chart's tape holds them (epoch seconds), read part-way through the day —
     only the minutes closed by then, the decision it has reached */
  const r29 = dayReturns(g29);
  const tail = { day: '2026-10-29', r: Array.from(r29.slice(0, g29.last + 1)).slice(-390), count: 10_000 };
  const candles: Candle[] = fixture.response
    .filter((row: { timestamp: string; close: number }) => row.timestamp.startsWith('2026-10-30') && row.close > 0)
    .map((row: { timestamp: string; open: number; close: number }) => ({ time: Math.floor(nyWallStamp(row.timestamp) / 1000), open: row.open, high: row.close, low: row.close, close: row.close, volume: 1 }));
  for (const [clock, ref] of [['10:07', REF[0]], ['12:31', REF[1]], ['15:00', REF[2]]] as const) {
    const now = nyWallStamp(`2026-10-30T${clock}:20.000`);
    const live = hourReadAt(BETA_2026Q4, tail, candles, now);
    check(`live read at ${clock} ET stands at minute ${ref.j} with the study’s forecast`, !!live && live.j === ref.j && near(live.forecast, annualiseHour(Math.exp(ref.pred)), 1e-12), live ? `${live.window} ${(live.forecast * 100).toFixed(2)}%, last hour ${(live.lastHour * 100).toFixed(2)}%` : 'none');
  }
  check('live read: none before 10:00', hourReadAt(BETA_2026Q4, tail, candles, nyWallStamp('2026-10-30T09:59:00.000')) === null);
}

/* ------------------------------------------------------------------ 3. the whole study, from its cache */
console.log('\n3. the whole study (research/physics/data, when cached)');
const DATA = join(ROOT, 'research/physics/data');
const barDir = join(DATA, 'bars/SPY');
if (!existsSync(barDir) || readdirSync(barDir).filter(f => f.endsWith('.json.gz')).length < 46) {
  console.log('SKIP the study’s minute bars are not cached here (cd research/physics/scripts && python3 fetch.py bars, ~46 requests for SPY)');
} else {
  const t0 = Date.now();
  const byDay = new Map<string, { m: number; open: number; close: number }[]>();
  for (const f of readdirSync(barDir).filter(f => f.endsWith('.json.gz')).sort()) {
    const raw = JSON.parse(gunzipSync(readFileSync(join(barDir, f))).toString('utf8'));
    for (const [day, list] of minuteBarsOfRows(raw.response)) byDay.set(day, [...(byDay.get(day) ?? []), ...list]);
  }
  const grids: DayGrid[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const g = dayGrid(day, byDay.get(day)!);
    if (g) grids.push(g);
  }
  const days = grids.map(g => g.day);
  const x = grids.map(dailyLogRv);
  check('sessions: 961, 2023-01-03 … 2026-10-30 (REPORT.md)', days.length === 961 && days[0] === '2023-01-03' && days[days.length - 1] === '2026-10-30', `${days.length} ${days[0]} … ${days[days.length - 1]}`);
  let worst = 0;
  let matched = 0;
  for (const [i, d] of days.entries()) {
    const want = gravityRv.get(d);
    if (want == null) continue;
    matched++;
    worst = Math.max(worst, Math.abs(x[i] - want));
  }
  check('every session’s ln RV = gravity_rows_SPY.json', matched === 940 && worst < 1e-12, `${matched} sessions, worst |Δ| ${worst.toExponential(2)}`);

  /* halflife.py, line for line: monthly refit from the first test month, the test rows where every model forecasts */
  const TEST_START = '2024-07-01';
  const vix = new Map<string, number>();
  for (const f of readdirSync(join(DATA, 'eod')).filter(f => f.startsWith('VIX')).sort()) {
    const raw = JSON.parse(gunzipSync(readFileSync(join(DATA, 'eod', f))).toString('utf8'));
    for (const r of raw.response) {
      const c = Number(r.close) || 0;
      if (c > 0) vix.set(String(r.created || r.timestamp || r.date || '').slice(0, 10), c);
    }
  }
  const n = x.length;
  const y = x.map((_, t) => (t + 1 < n ? x[t + 1] : NaN));
  const vx = days.map(d => (vix.has(d) ? Math.log(vix.get(d)! / 100 / Math.sqrt(252)) : NaN));
  const preds: Record<string, number[]> = { RW: x.slice(), MA20: x.map((_, t) => ma20At(x, t)), AR1: new Array(n).fill(NaN), HAR: new Array(n).fill(NaN), 'HAR+VIX': new Array(n).fill(NaN) };
  const months = [...new Set(days.filter(d => d >= TEST_START).map(d => d.slice(0, 7)))];
  const phis: [string, number, number][] = [];
  for (const mo of months) {
    const t0m = days.findIndex(d => d.slice(0, 7) === mo);
    const fit = fitDaily(x, t0m)!;
    phis.push([mo, fit.phi, fit.halfLife]);
    /* HAR+VIX: the study's fourth regressor, the VIX close as a daily vol */
    const Xv: number[][] = [];
    const yv: number[] = [];
    for (let t = 22; t <= t0m - 2; t++) {
      const row = [...harRow(x, t), vx[t]];
      if (Number.isFinite(y[t]) && row.every(Number.isFinite)) {
        Xv.push(row);
        yv.push(y[t]);
      }
    }
    const bv = lstsq(Xv, yv)!;
    for (let t = t0m; t < n && days[t].slice(0, 7) === mo; t++) {
      preds.HAR[t] = harForecast(fit, x, t);
      preds.AR1[t] = arForecast(fit, x, t);
      preds['HAR+VIX'][t] = [...harRow(x, t), vx[t]].reduce((s, v, i) => s + v * bv[i], 0);
    }
  }
  const test = days.map((d, t) => d >= TEST_START && Number.isFinite(y[t]) && Object.values(preds).every(p => Number.isFinite(p[t])));
  const yt = y.filter((_, t) => test[t]);
  const mean = yt.reduce((a, b) => a + b, 0) / yt.length;
  const vary = yt.reduce((a, b) => a + (b - mean) ** 2, 0) / yt.length;
  const mse = (p: number[]) => p.filter((_, t) => test[t]).reduce((a, v, i) => a + (yt[i] - v) ** 2, 0) / yt.length;
  const STUDY = { RW: 0.13872598583308973, MA20: 0.18033047442987427, AR1: 0.12006853789265583, HAR: 0.11569268198168119, 'HAR+VIX': 0.11276833505024612 };
  check('halflife.py: 586 test days', yt.length === 586, String(yt.length));
  for (const [k, want] of Object.entries(STUDY)) {
    const got = mse(preds[k]);
    check(`halflife.py: ${k} MSE ${f6(want)}, OOS R² ${(1 - want / vary).toFixed(3)}`, near(got, want, 1e-9), `got ${got}`);
  }
  const gain = (1 - mse(preds.HAR) / mse(preds.MA20)) * 100;
  check('HAR vs 20-day realised vol: −35.8% error (REPORT.md −36%)', Math.abs(gain - 35.84407607895969) < 1e-6, `${gain.toFixed(2)}%`);
  const [first, lastPhi] = [phis[0], phis[phis.length - 1]];
  check('half-life, first refit 2024-07: φ 0.550132, 1.1599 sessions', first[0] === '2024-07' && near(first[1], 0.5501317551534824, 1e-9) && near(first[2], 1.1598897418382765, 1e-9), `φ ${f6(first[1])} hl ${f6(first[2])}`);
  check('half-life, last refit 2026-10: φ 0.656242, 1.6455 sessions', lastPhi[0] === '2026-10' && near(lastPhi[1], 0.6562417647385093, 1e-9) && near(lastPhi[2], 1.6455469446727045, 1e-9), `φ ${f6(lastPhi[1])} hl ${f6(lastPhi[2])}`);
  const hls = phis.map(p => p[2]);
  check('half-life range 1.16 … 2.02 sessions over the refits', near(Math.min(...hls), 1.1598897418382765, 1e-9) && near(Math.max(...hls), 2.0175330229117487, 1e-9));
  /* the HAR forecast made at the close of 2026-10-29 for 2026-10-30 (the 2026-10 coefficients) */
  const k29 = days.indexOf('2026-10-29');
  const fc = harForecast(fitDaily(x, monthStart(days, k29))!, x, k29);
  check('HAR forecast for 2026-10-30 = the study’s −5.244897', near(fc, -5.244896677899237, 1e-9), `${(annualiseDay(Math.exp(fc)) * 100).toFixed(2)}% forecast, ${(annualiseDay(Math.exp(x[k29 + 1])) * 100).toFixed(2)}% realised`);

  /* evaluate.py's next-hour baseline: quarterly expanding refit, at least 200 rows */
  const series = grids.map(g => ({ day: g.day, r: dayReturns(g) }));
  const rows = hourRows(series);
  const quarters = [...new Set(rows.filter(r => r.day >= TEST_START).map(r => quarterOf(r.day)))].sort();
  const pairs: { y: number; p: number }[] = [];
  const hourBy = (start: string) => {
    const out: { y: number; p: number }[] = [];
    for (const q of quarters) {
      const inQ = rows.filter(r => quarterOf(r.day) === q && Number.isFinite(r.y));
      const first = inQ.reduce((a, r) => (r.day < a ? r.day : a), '9999');
      const beta = fitHour(rows.filter(r => r.day < first && r.day >= start(first)));
      if (!beta) continue;
      for (const r of inQ) out.push({ y: r.y, p: hourForecast(beta, r) });
    }
    return out;
  };
  pairs.push(...hourBy(() => ''));
  const r2 = (ps: { y: number; p: number }[]) => {
    const m = ps.reduce((a, v) => a + v.y, 0) / ps.length;
    return 1 - ps.reduce((a, v) => a + (v.y - v.p) ** 2, 0) / ps.reduce((a, v) => a + (v.y - m) ** 2, 0);
  };
  const days587 = new Set(rows.filter(r => r.day >= TEST_START && Number.isFinite(r.y)).map(r => r.day)).size;
  check('evaluate.py next-hour baseline: n 12,255 over 587 days', pairs.length === 12255 && days587 === 587, `${pairs.length} rows, ${days587} days`);
  check('evaluate.py next-hour baseline: OOS R² 0.735078', near(r2(pairs), 0.7350783861047798, 1e-9), String(r2(pairs)));

  /* ---- the live tile's window on the same test months: HISTORY_SESSIONS sessions before the quarter's first session */
  console.log(`\n   the tile’s trailing window (${HISTORY_SESSIONS} sessions before the quarter) on the study’s test months:`);
  const qStartIdx = (t: number) => {
    const q = quarterOf(days[t]);
    let i = t;
    while (i > 0 && quarterOf(days[i - 1]) === q) i--;
    return i;
  };
  const scan = [120, HISTORY_SESSIONS, 500];
  for (const W of scan) {
    const p = new Array(n).fill(NaN);
    for (const mo of months) {
      const t0m = days.findIndex(d => d.slice(0, 7) === mo);
      const s = Math.max(0, qStartIdx(t0m) - W);
      const fit = fitDaily(x.slice(s), t0m - s);
      if (!fit) continue;
      for (let t = t0m; t < n && days[t].slice(0, 7) === mo; t++) p[t] = harForecast(fit, x.slice(s), t - s);
    }
    const ok = test.every((v, t) => !v || Number.isFinite(p[t]));
    const g = (1 - mse(p) / mse(preds.MA20)) * 100;
    const hourW = hourBy(first => {
      const i = days.indexOf(first);
      return days[Math.max(0, i - W)];
    });
    const line = `window ${W}: next-session error ${g >= 0 ? '−' : '+'}${Math.abs(g).toFixed(1)}% vs the 20-day (study, expanding: −${gain.toFixed(1)}%); next-hour OOS R² ${r2(hourW).toFixed(4)} (study 0.7351)`;
    if (W === HISTORY_SESSIONS) {
      check(`tile: ${line}`, ok && g > 30 && r2(hourW) > 0.73);
    } else console.log(`     ${line}`);
  }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

/* ------------------------------------------------------------------ 4. the server's sessions are the browser's */
console.log('\n4. the server reads the sessions once a day; the tile fits on them (data/volOutlookServer.ts)');
{
  const { readSessions, sessionWindow, sessionsFromWire, sessionsToWire, outlookOf, SERVED_VERSION } = await import('../src/data/volOutlook');
  const { startVolOutlookServer, volOutlookRoute } = await import('../src/data/volOutlookServer');
  const { isTradingDay } = await import('../src/core/calendar');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  /* a deep equal that tells NaN from NaN as equal and +0 from −0 apart: the same bits, not the same-looking numbers */
  const same = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a as object).sort();
      const kb = Object.keys(b as object).sort();
      return same(ka, kb) && ka.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return a === b;
  };
  /* the terminal's one-minute rows for any span, made up and fixed per day: a random walk, a few missing minutes, now
     and then a short day (under 200 bars: no daily RV, a NaN on the wire) */
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const rowsOfDay = (iso: string) => {
    let seed = hash(iso);
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const short = rnd() < 0.04;
    const n = short ? 180 : 390;
    const out: { timestamp: string; open: number; close: number }[] = [];
    let px = 500 + (hash(iso.slice(0, 7)) % 100);
    for (let m = 0; m < n; m++) {
      if (rnd() < 0.01) continue;
      const open = px;
      px = Math.round(px * Math.exp((rnd() - 0.5) * 0.002) * 100) / 100;
      const t = 9 * 60 + 30 + m;
      out.push({ timestamp: `${iso}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00.000`, open, close: px });
    }
    return out;
  };
  let reads = 0;
  const body = (p: string) => {
    reads++;
    const a = p.match(/start_date=(\d{8})/)![1];
    const b = p.match(/end_date=(\d{8})/)![1];
    const rows: ReturnType<typeof rowsOfDay> = [];
    const d = new Date(Number(a.slice(0, 4)), Number(a.slice(4, 6)) - 1, Number(a.slice(6, 8)));
    const end = new Date(Number(b.slice(0, 4)), Number(b.slice(4, 6)) - 1, Number(b.slice(6, 8)));
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      if (!isTradingDay(d)) continue;
      rows.push(...rowsOfDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
    }
    return JSON.stringify({ response: rows });
  };
  const browserRead = async (p: string) => ({ status: 200, data: (JSON.parse(body(p)) as { response: unknown }).response, error: null });

  /* a: the browser's first visit, the whole window in one read; b: day by day (yesterday's run, over the wire, topped up
     with today's session, over the wire again) — the server's way */
  const start = '2026-04-01';
  const last = '2026-10-30';
  const liveDay = '2026-11-02';
  const a = await readSessions('SPY', null, start, last, browserRead);
  const b1 = await readSessions('SPY', null, start, '2026-10-29', browserRead);
  const b1w = sessionsFromWire<typeof b1>(sessionsToWire({ days: b1.days, tail: b1.tail }));
  const b = await readSessions('SPY', b1w, start, last, browserRead);
  const bw = sessionsFromWire<typeof b>(sessionsToWire({ days: b.days, tail: b.tail }));
  const nanDays = a.days.filter(d => Number.isNaN(d.x)).length;
  check(`sessions: ${a.days.length} days, the same bits read whole or a day at a time over the wire (${nanDays} short days spelled NaN)`, a.days.length > 120 && nanDays > 0 && same(a.days, bw.days) && same(a.tail, bw.tail));
  const oa = outlookOf('SPY', a.days, liveDay);
  const ob = outlookOf('SPY', bw.days, liveDay);
  check('outlook: forecast, half-life, HAR and next-hour fits identical off either', !!oa && !!oa.hourBeta && same(oa, ob), oa ? `forecast ${(oa.forecast * 100).toFixed(2)}%, half-life ${oa.halfLife.toFixed(2)} sessions, ${oa.hourRows} hour rows` : '');
  check('wire: NaN, ±Infinity and −0 come back as themselves', same(sessionsFromWire(sessionsToWire([NaN, Infinity, -Infinity, -0, 0, 1.5])), [NaN, Infinity, -Infinity, -0, 0, 1.5]));

  /* the server itself, on today's window: a name asked for is read once, then served; its sessions are the browser's */
  const dir = mkdtempSync(join(tmpdir(), 'vol-outlook-'));
  try {
    reads = 0;
    const w = sessionWindow();
    const srv = startVolOutlookServer({ dir, theta: async p => ({ status: 200, body: body(p), type: 'application/json' }), hot: [], log: () => undefined });
    const first = srv.ask('QQQ');
    const t0s = Date.now();
    let got = srv.ask('QQQ');
    while (!('ready' in got) && Date.now() - t0s < 120_000) {
      await new Promise(r => setTimeout(r, 50));
      got = srv.ask('QQQ');
    }
    const readsFirst = reads;
    const again = srv.ask('QQQ');
    const readsAgain = reads;
    const own = await readSessions('QQQ', null, w.start, w.last, browserRead);
    const served = 'ready' in got ? got.ready : null;
    check(`server: building first, then ${served?.days.length ?? 0} sessions ${w.start} … ${w.last} — the browser's own read, bit for bit`, 'building' in first && !!served && served.v === SERVED_VERSION && served.start === w.start && served.last === w.last && same(served.days, own.days) && same(served.tail, own.tail));
    check(`server: a second ask reads nothing (${readsFirst} reads for the first)`, 'ready' in again && readsAgain === readsFirst);
    /* the route: 200 with the wire format; a restart serves the kept file without a read */
    const res = { statusCode: 0, headers: {} as Record<string, string>, text: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(t?: string | Buffer) { this.text = String(t ?? ''); } };
    volOutlookRoute(srv, { url: '/api/vol-outlook/QQQ', method: 'GET', headers: {} }, res);
    const wire = sessionsFromWire<{ days: unknown[]; tail: unknown }>(res.text);
    check('route: 200, the sessions over the wire', res.statusCode === 200 && same(wire.days, own.days) && same(wire.tail, own.tail));
    srv.stop();
    reads = 0;
    const srv2 = startVolOutlookServer({ dir, theta: async p => ({ status: 200, body: body(p), type: 'application/json' }), hot: [], log: () => undefined });
    const kept = srv2.ask('QQQ');
    check('restart: the kept file serves at once, no read', 'ready' in kept && reads === 0 && same(kept.ready.days, own.days));
    srv2.stop();
    const ao = outlookOf('QQQ', own.days, w.liveDay);
    const so = served ? outlookOf('QQQ', served.days, w.liveDay) : null;
    check('tile: the outlook off the served sessions = off its own read', same(ao, so));

    /* the lanes, on a terminal the test plays: each read takes a few milliseconds and is counted in flight per name */
    const { KEEP_FREE, LANES } = await import('../src/data/volOutlookServer');
    const lanesRun = async (hot: string[], others: () => number, ask?: { at: number; name: string }, slots = true) => {
      const ldir = mkdtempSync(join(tmpdir(), 'vol-lanes-'));
      const inflight = new Map<string, number>();
      let total = 0;
      let peakTotal = 0;
      let peakNames = 0;
      let peakBusy = 0;
      let readsDone = 0;
      const doneOrder: string[] = [];
      const slotsNow = () => ({ terminal: 8, history: 6, busy: total + others(), busyHistory: total + others(), waiting: 0 });
      const s = startVolOutlookServer({
        dir: ldir,
        hot,
        ...(slots ? { slots: slotsNow } : {}),
        log: line => {
          const m = line.match(/\] ([A-Z]+): \d+ sessions/);
          if (m) doneOrder.push(m[1]);
        },
        theta: async p => {
          const t = p.match(/symbol=([A-Z]+)/)![1];
          total++;
          inflight.set(t, (inflight.get(t) ?? 0) + 1);
          peakTotal = Math.max(peakTotal, total);
          peakBusy = Math.max(peakBusy, total + others());
          peakNames = Math.max(peakNames, [...inflight.values()].filter(v => v > 0).length);
          await new Promise(r => setTimeout(r, 4));
          total--;
          inflight.set(t, inflight.get(t)! - 1);
          readsDone++;
          if (ask && readsDone === ask.at) s.ask(ask.name);
          return { status: 200, body: body(p), type: 'application/json' };
        },
      });
      const t0l = Date.now();
      while (doneOrder.length < hot.length && Date.now() - t0l < 60_000) await new Promise(r => setTimeout(r, 10));
      s.stop();
      rmSync(ldir, { recursive: true, force: true });
      return { doneOrder, peakTotal, peakNames, peakBusy };
    };
    /* one lane (no slot count): a viewer's ask for CCC, third among the hot names, while AAA is read — CCC goes next,
       ahead of BBB still waiting */
    const jump = await lanesRun(['AAA', 'BBB', 'CCC'], () => 0, { at: 2, name: 'CCC' }, false);
    check('queue: a viewer\'s name jumps ahead of the hot names still waiting (read AAA, then the asked CCC, then BBB)', jump.doneOrder.join(',') === 'AAA,CCC,BBB' && jump.peakNames === 1, jump.doneOrder.join(','));
    /* two lanes on an idle terminal: two names at once, two reads each — four slots held, four left free */
    const idle = await lanesRun(['AAA', 'BBB', 'CCC', 'DDD'], () => 0);
    check(`lanes: ${LANES} names at once on an idle terminal, ${idle.peakTotal} reads in flight, ${8 - idle.peakBusy} of 8 slots left free (≥ ${KEEP_FREE})`, idle.peakNames === 2 && idle.peakTotal === 4 && 8 - idle.peakBusy >= KEEP_FREE, JSON.stringify(idle));
    /* the Compass engine and a chart holding three slots: a second name would leave fewer than four free — one name at a time */
    const shared = await lanesRun(['AAA', 'BBB', 'CCC'], () => 3);
    check('lanes: with three slots taken by others, one name at a time (the second would leave under four free)', shared.peakNames === 1 && shared.peakTotal === 2, JSON.stringify(shared));
    /* one slot taken by others: the second name's reads go only while four stay free (8 − 1 − 2 − 1 = 4 for its first) */
    const one = await lanesRun(['AAA', 'BBB', 'CCC'], () => 1);
    check(`lanes: with one slot taken by others, a second name reads but never past ${KEEP_FREE} free (peak ${one.peakBusy} of 8 busy)`, one.peakNames === 2 && 8 - one.peakBusy >= KEEP_FREE, JSON.stringify(one));
    /* The same, with no clock in it: every read is held open until the proof lets it go, so what the lanes see when the
       second name looks for room is fixed, whatever the machine's load. The first name is walked to its last span (one
       read in flight, its other slot free for a moment) and held there past the second name's look for room; then the
       first name's last read ends and it starts the next name at full width. The free slot was the first name's: had
       the second name taken it, 8 − 1 other − 2 − 2 = 3 would be free (the 1-in-3 failure on a loaded machine before
       2026-11-07, when the timers happened to land there). */
    {
      const ldir = mkdtempSync(join(tmpdir(), 'vol-lanes-held-'));
      const held: { t: string; go: () => void }[] = [];
      let total = 0;
      let peakBusy = 0;
      let draining = false;
      const others = 1;
      const nameOf = (p: string) => p.match(/symbol=([A-Z]+)/)![1];
      const s = startVolOutlookServer({
        dir: ldir,
        hot: ['AAA', 'BBB', 'CCC'],
        slots: () => ({ terminal: 8, history: 6, busy: total + others, busyHistory: total + others, waiting: 0 }),
        log: () => undefined,
        theta: p => {
          if (draining) return Promise.resolve({ status: 200, body: body(p), type: 'application/json' });
          total++;
          peakBusy = Math.max(peakBusy, total + others);
          return new Promise(r => held.push({ t: nameOf(p), go: () => { total--; r({ status: 200, body: body(p), type: 'application/json' }); } }));
        },
      });
      /* every turn the lanes take on a released read runs before the next look (no timer in the read path) */
      const settle = () => new Promise(r => setImmediate(r));
      const release = async (t: string) => {
        const i = held.findIndex(h => h.t === t);
        held.splice(i, 1)[0].go();
        await settle();
      };
      const heldOf = (t: string) => held.filter(h => h.t === t).length;
      await settle();
      const atStart = `${heldOf('AAA')} AAA + ${heldOf('BBB')} BBB`;
      /* the first name's spans, two at a time, until one read is left: its last span */
      while (heldOf('AAA') === 2) await release('AAA');
      const atTail = `${heldOf('AAA')} AAA + ${heldOf('BBB')} BBB`;
      /* the second name's look for room comes every 250 ms; two of them while the first name holds one slot */
      await new Promise(r => setTimeout(r, 600));
      const afterLook = `${heldOf('AAA')} AAA + ${heldOf('BBB')} BBB`;
      const tookFree = heldOf('BBB');
      /* the first name's last read ends: it takes the next name at full width */
      await release('AAA');
      const nextName = `${heldOf('CCC')} CCC + ${heldOf('BBB')} BBB`;
      const peak = peakBusy;
      const ok = atStart === '2 AAA + 1 BBB' && atTail === '1 AAA + 1 BBB' && tookFree === 1 && heldOf('CCC') === 2 && 8 - peak >= KEEP_FREE;
      /* done: the reads still held, and any the readers ask for after, answer at once */
      s.stop();
      draining = true;
      for (const h of held.splice(0)) h.go();
      await settle();
      rmSync(ldir, { recursive: true, force: true });
      check(`lanes: the first name's free slot at the end of a name stays its own — the second name waits, and the next name at full width leaves ${8 - peak} of 8 free (≥ ${KEEP_FREE})`, ok, `start ${atStart}; last span ${atTail}; after the look ${afterLook}; next name ${nextName}; peak ${peak} of 8 busy`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nvol outlook proof: all checks pass');
process.exit(fail ? 1 : 0);
