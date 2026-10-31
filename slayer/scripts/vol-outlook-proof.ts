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

console.log(fail ? `\n${fail} FAILED` : '\nvol outlook proof: all checks pass');
process.exit(fail ? 1 : 0);
