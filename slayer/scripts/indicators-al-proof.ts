// THE A–L CLASSIC TECHNICALS, PROVED (2026-11-01). Every built-in added from TradingView's list A to L
// (src/data/builtinScriptsAL.ts) and the A–L ones we already shipped whose inputs were brought to TradingView's
// (ATR, Bollinger Bands, CCI, Donchian, Keltner) — run through the Pine runtime exactly as the library ships them.
//   1. a six-bar fixture typed in by hand, with values worked out by hand (the arithmetic is in the comments);
//   2. a fixed 780-bar fixture (ten New York sessions of 5-minute bars, a seeded walk — no market data), every
//      series checked bar by bar against an independent array implementation written here from the published formula;
//   3. the new ta.* calls (ta.cmo, ta.kc, ta.kcw) against the same formulas, and their argument checks.
//   npx tsx scripts/indicators-al-proof.ts
import { compile, run } from '../src/core/pine';
import type { Bar } from '../src/core/pine';
import { builtinScripts } from '../src/data/builtinScripts';
import { SOURCES_AL } from '../src/data/builtinScriptsAL';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`);
};
const near = (a: number, b: number, eps = 1e-9) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const sameSeries = (got: ArrayLike<number>, want: number[], eps = 1e-9) => {
  if (got.length !== want.length) return `length ${got.length} vs ${want.length}`;
  let numbers = 0;
  for (let i = 0; i < want.length; i++) {
    if (!near(got[i], want[i], eps)) return `bar ${i}: got ${got[i]} want ${want[i]}`;
    if (!Number.isNaN(want[i])) numbers++;
  }
  return numbers === 0 ? 'no bar had a number to compare' : '';
};

/* ---- the scripts as the library ships them --------------------------------------------- */
const shipped = new Map(builtinScripts().map(s => [s.id.replace('builtin:', ''), s]));
type Opts = { inputs?: Record<string, string | number | boolean>; timeframe?: string };
const runScript = (slug: string, bars: Bar[], o: Opts = {}) => {
  const s = shipped.get(slug);
  if (!s) throw new Error(`no built-in ${slug}`);
  return run(compile(s.source), bars, { budgetMs: 30_000, timeframe: o.timeframe ?? '5', inputs: o.inputs });
};
const plotOf = (r: ReturnType<typeof runScript>, title: string) => {
  const p = r.plots.find(x => x.title === title);
  if (!p) throw new Error(`no plot "${title}" — have ${r.plots.map(x => x.title).join(', ')}`);
  return p.values;
};
const at = (r: ReturnType<typeof runScript>, title: string, i: number) => plotOf(r, title)[i];

/* ---- 0. every A–L source compiles, sits on the shared shelf groups, and is reachable ---- */
{
  const GROUPS = new Set(['Slayer', 'Trend', 'Bands', 'Momentum', 'Volume', 'Volatility', 'Statistics', 'Candlesticks', 'Breadth']);
  const bad = SOURCES_AL.filter(s => shipped.get(s.slug)?.status !== 'ok').map(s => s.slug);
  check(`all ${SOURCES_AL.length} A–L sources compile in the library`, bad.length === 0, bad.join(', '));
  check('every A–L source names a shared group', SOURCES_AL.every(s => GROUPS.has(s.group)));
  const slugs = builtinScripts().map(s => s.id);
  check('no built-in slug is used twice', new Set(slugs).size === slugs.length);
  check('every A–L source declares its inputs or none (meta read)', SOURCES_AL.every(s => Array.isArray(shipped.get(s.slug)?.meta?.inputs)));
}

/* ---- 1. six bars by hand ------------------------------------------------------------------ */
//            open  high  low   close  volume
const HAND: [number, number, number, number, number][] = [
  [10.0, 11.0, 9.0, 10.5, 100],
  [10.5, 12.0, 10.0, 11.5, 200],
  [11.5, 12.0, 10.5, 11.0, 150],
  [11.0, 11.5, 10.0, 10.2, 300],
  [10.2, 11.0, 9.5, 10.8, 250],
  [10.8, 12.5, 10.6, 12.4, 400],
];
const T0 = Date.UTC(2026, 8, 14, 13, 30) / 1000; // 09:30 New York, Monday 14 September 2026
const hand: Bar[] = HAND.map(([open, high, low, close, volume], i) => ({ time: T0 + i * 300, open, high, low, close, volume }));
{
  /* BOP = (C − O) / (H − L): b0 0.5/2, b2 −0.5/1.5, b5 1.6/1.9 */
  const r = runScript('balance-of-power', hand);
  check('BOP by hand: 0.25, −1/3, 0.842105', near(at(r, 'BOP', 0), 0.25) && near(at(r, 'BOP', 2), -1 / 3) && near(at(r, 'BOP', 5), 1.6 / 1.9, 1e-12));

  /* CLV = (2C − L − H)/(H − L): 0.5, 0.5, −1/3, −11/15, 11/15, 17/19; A/D = Σ CLV·V: 50, 150, 100, −120, 63.333, 421.228 */
  const ad = runScript('accumulation-distribution', hand);
  const adWant = [50, 150, 100, -120, -120 + (11 / 15) * 250, -120 + (11 / 15) * 250 + (17 / 19) * 400];
  check('A/D by hand: 50 150 100 −120 63.33 421.23', sameSeries(plotOf(ad, 'Accumulation/Distribution'), adWant, 1e-12) === '', sameSeries(plotOf(ad, 'Accumulation/Distribution'), adWant));
  check('A/D last bar 421.2281', near(at(ad, 'Accumulation/Distribution', 5), 421.2281, 1e-6));

  /* CMF(3) at b5 = (−220 + 183.333 + 357.895) / (300 + 250 + 400) = 321.228 / 950 */
  const cmf = runScript('cmf', hand, { inputs: { len: 3 } });
  check('CMF(3) by hand: 0.338135 at the last bar, na before three bars', near(at(cmf, 'CMF', 5), 0.338135, 1e-5) && Number.isNaN(at(cmf, 'CMF', 1)));

  /* A/D ratio (bars) (3): up = C ≥ O → U U D D U U; b2 2/1, b3 1/2, b4 1/2, b5 2/1 */
  const adb = runScript('advance-decline-bars', hand, { inputs: { len: 3 } });
  check('A/D ratio (bars)(3) by hand: 2, 0.5, 0.5, 2', [2, 0.5, 0.5, 2].every((v, k) => near(at(adb, 'A/D ratio', k + 2), v)), Array.from(plotOf(adb, 'A/D ratio')).join(' '));

  /* Aroon(3) at b5: highs b2..b5 12 11.5 11 12.5 → newest is highest, offset 0 → 100·3/3; lows 10.5 10 9.5 10.6 → offset −1 → 100·2/3 */
  const ar = runScript('aroon', hand, { inputs: { len: 3 } });
  check('Aroon(3) by hand: up 100, down 66.667', near(at(ar, 'Aroon Up', 5), 100) && near(at(ar, 'Aroon Down', 5), 200 / 3));
  const ao = runScript('aroon-oscillator', hand, { inputs: { len: 3 } });
  check('Aroon oscillator(3) by hand: 33.333', near(at(ao, 'Aroon Oscillator', 5), 100 / 3));

  /* CMO(3) at b5: changes −0.8 +0.6 +1.6 → up 2.2, down 0.8 → 100·1.4/3.0 */
  const cmo = runScript('chande-momentum', hand, { inputs: { len: 3 } });
  check('CMO(3) by hand: 46.667', near(at(cmo, 'ChandeMO', 5), 140 / 3, 1e-12));

  /* EFI(2): force 200 −75 −240 150 640; EMA seeded with the SMA of the first two (62.5), then α = 2/3:
     −160 + 20.8333 = −139.1667, 100 − 46.3889 = 53.6111, 426.6667 + 17.8704 = 444.5370 */
  const efi = runScript('elder-force-index', hand, { inputs: { len: 2 } });
  check('EFI(2) by hand: 62.5, −139.1667, 53.6111, 444.5370', [62.5, -139.1667, 53.6111, 444.537].every((v, k) => near(at(efi, 'EFI', k + 2), v, 1e-5)), Array.from(plotOf(efi, 'EFI')).join(' '));

  /* Envelope(3, 10%) at b5: SMA 33.4/3 = 11.1333 → 12.2467 and 10.0200 */
  const env = runScript('envelope', hand, { inputs: { len: 3 } });
  check('Envelope(3, 10%) by hand: 11.1333 / 12.2467 / 10.0200', near(at(env, 'Basis', 5), 33.4 / 3) && near(at(env, 'Upper', 5), (33.4 / 3) * 1.1) && near(at(env, 'Lower', 5), (33.4 / 3) * 0.9));

  /* LSMA(3) at b5: 10.2 10.8 12.4 → slope 1.1, mean 11.1333 at x = 1 → 12.2333 at the end */
  const ls = runScript('lsma', hand, { inputs: { len: 3 } });
  check('LSMA(3) by hand: 12.2333', near(at(ls, 'LSMA', 5), 33.4 / 3 + 1.1, 1e-12));

  /* DEMA(2): EMA(2) of close 11, 11, 10.4667, 10.6889, 11.8296; its EMA(2) 11, 10.6444, 10.6741, 11.4444 → 2·11.8296 − 11.4444 */
  const de = runScript('dema', hand, { inputs: { len: 2 } });
  check('DEMA(2) by hand: 12.2148', near(at(de, 'DEMA', 5), 12.21481, 1e-5), String(at(de, 'DEMA', 5)));

  /* CHOP(3) at b5: TR 1.5 1.5 1.9 = 4.9 over range 12.5 − 9.5 = 3 → 100·log10(4.9/3)/log10(3) */
  const ch = runScript('choppiness', hand, { inputs: { len: 3 } });
  check('CHOP(3) by hand: 44.66', near(at(ch, 'CHOP', 5), (100 * Math.log10(4.9 / 3)) / Math.log10(3), 1e-12) && near(at(ch, 'CHOP', 5), 44.658, 1e-4));

  /* BB(3, 2) of 10.2 10.8 12.4: mean 11.1333, population σ 0.928559 → %b 0.84103, BBW 33.361 */
  const pb = runScript('bb-percent-b', hand, { inputs: { len: 3 } });
  check('%b(3) by hand: 0.84103', near(at(pb, '%b', 5), 0.84103, 1e-4), String(at(pb, '%b', 5)));
  const bw = runScript('bb-width', hand, { inputs: { len: 3, expLen: 2, conLen: 2 } });
  check('BBW(3) by hand: 33.361', near(at(bw, 'BBW', 5), 33.3614, 1e-4), String(at(bw, 'BBW', 5)));

  /* HV(3), intraday: ln returns −0.075508 0.057158 0.138150, population σ 0.088072 → ·100·√365 = 168.26 */
  const hv = runScript('historical-volatility', hand, { inputs: { len: 3 } });
  check('HV(3) by hand: 168.26 (intraday, √365)', near(at(hv, 'HV', 5), 168.26, 1e-3), String(at(hv, 'HV', 5)));

  /* 24-hour volume: six bars in one morning — every bar so far is inside the 24 hours */
  const v24 = runScript('volume-24h', hand);
  check('24-hour volume by hand: 100, 300, 450, 750, 1000, 1400', sameSeries(plotOf(v24, '24h volume'), [100, 300, 450, 750, 1000, 1400]) === '');

  /* BOP's sibling sanity: Bull Bear Power(2) at b5 = (12.5 − e) + (10.6 − e), e = EMA(2) of close = 11.8296 */
  const bbp = runScript('bull-bear-power', hand, { inputs: { len: 2 } });
  check('Bull Bear Power(2) by hand: −0.5593', near(at(bbp, 'BBPower', 5), 12.5 + 10.6 - 2 * 11.829630, 1e-5), String(at(bbp, 'BBPower', 5)));
}

/* ---- 2. the fixed 780-bar fixture ----------------------------------------------------------- */
let seed = 20261101;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const bars: Bar[] = [];
{
  let px = 5800;
  for (let d = 0; d < 14 && bars.length < 780; d++) {
    const day = new Date(Date.UTC(2026, 8, 14 + d));
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const open = Date.UTC(2026, 8, 14 + d, 13, 30) / 1000;
    for (let k = 0; k < 78; k++) {
      const o = px;
      const c = px + (rnd() - 0.5) * 6;
      const h = Math.max(o, c) + rnd() * 2;
      const l = Math.min(o, c) - rnd() * 2;
      /* one bar in fifty with no range, so the "high == low" branches run */
      const flat = k % 50 === 7;
      bars.push({ time: open + k * 300, open: flat ? c : o, high: flat ? c : h, low: flat ? c : l, close: c, volume: Math.round(500 + rnd() * 20000) });
      px = c;
    }
  }
}
const N = bars.length;
const O = bars.map(b => b.open);
const H = bars.map(b => b.high);
const L = bars.map(b => b.low);
const C = bars.map(b => b.close);
const V = bars.map(b => b.volume);
const HL2 = bars.map(b => (b.high + b.low) / 2);
const HLC3 = bars.map(b => (b.high + b.low + b.close) / 3);

/* independent array maths, from the published formulas */
type S = number[];
const nan = () => new Array<number>(N).fill(NaN);
const win = (x: S, i: number, n: number) => (i < n - 1 ? null : x.slice(i - n + 1, i + 1));
const okWin = (w: S | null): w is S => !!w && w.every(v => !Number.isNaN(v));
const map = (x: S, n: number, f: (w: S) => number) => x.map((_, i) => {
  const w = win(x, i, n);
  return okWin(w) ? f(w) : NaN;
});
const avg = (w: S) => w.reduce((a, b) => a + b, 0) / w.length;
const SMA = (x: S, n: number) => map(x, n, avg);
const SUM = (x: S, n: number) => map(x, n, w => w.reduce((a, b) => a + b, 0));
const HIGH = (x: S, n: number) => map(x, n, w => Math.max(...w));
const LOW = (x: S, n: number) => map(x, n, w => Math.min(...w));
const SD = (x: S, n: number) => map(x, n, w => {
  const m = avg(w);
  return Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / n);
});
const WMA = (x: S, n: number) => map(x, n, w => w.reduce((a, v, k) => a + v * (k + 1), 0) / ((n * (n + 1)) / 2));
const recursive = (x: S, n: number, alpha: number) => {
  const out = nan();
  let prev = NaN;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(prev)) {
      const w = win(x, i, n);
      prev = okWin(w) ? avg(w) : NaN;
      out[i] = prev;
    } else if (Number.isNaN(x[i])) out[i] = NaN;
    else out[i] = prev = alpha * x[i] + (1 - alpha) * prev;
  }
  return out;
};
const EMA = (x: S, n: number) => recursive(x, n, 2 / (n + 1));
const RMA = (x: S, n: number) => recursive(x, n, 1 / n);
const VWMA = (x: S, n: number) => {
  const a = SMA(x.map((v, i) => v * V[i]), n);
  const b = SMA(V, n);
  return a.map((v, i) => v / b[i]);
};
const lag = (x: S, k: number) => x.map((_, i) => (i - k < 0 ? NaN : x[i - k]));
const CHANGE = (x: S, k = 1) => x.map((v, i) => (i - k < 0 ? NaN : v - x[i - k]));
const ROC = (x: S, k: number) => x.map((v, i) => (i - k < 0 ? NaN : (100 * (v - x[i - k])) / x[i - k]));
const TR = (handleNa: boolean) => C.map((_, i) => (i === 0 ? (handleNa ? H[0] - L[0] : NaN) : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
const ATR = (n: number) => RMA(TR(true), n);
const CLV = C.map((c, i) => ((c === H[i] && c === L[i]) || H[i] === L[i] ? 0 : (2 * c - L[i] - H[i]) / (H[i] - L[i])));
const CUM = (x: S) => {
  let s = 0;
  return x.map(v => (s += Number.isNaN(v) ? 0 : v));
};
const RSI = (x: S, n: number) => {
  const ch = CHANGE(x);
  const u = RMA(ch.map(v => (Number.isNaN(v) ? NaN : Math.max(v, 0))), n);
  const d = RMA(ch.map(v => (Number.isNaN(v) ? NaN : Math.max(-v, 0))), n);
  return u.map((uu, i) => (Number.isNaN(uu) || Number.isNaN(d[i]) ? NaN : d[i] === 0 ? 100 : uu === 0 ? 0 : 100 - 100 / (1 + uu / d[i])));
};
/** offset of the newest extreme in the window of n, 0 for this bar */
const BARS = (x: S, n: number, hi: boolean) => map(x, n, w => {
  let best = 0;
  for (let k = 1; k < n; k++) if (hi ? w[k] >= w[best] : w[k] <= w[best]) best = k;
  return best - (n - 1);
});
const LINREG = (x: S, n: number, off: number) => map(x, n, w => {
  const mx = (n - 1) / 2;
  const my = avg(w);
  let num = 0;
  let den = 0;
  w.forEach((y, k) => {
    num += (k - mx) * (y - my);
    den += (k - mx) ** 2;
  });
  const slope = num / den;
  return my + slope * (n - 1 - off - mx);
});
const ALMA = (x: S, n: number, offset: number, sigma: number) => map(x, n, w => {
  const m = offset * (n - 1);
  const s = n / sigma;
  let num = 0;
  let den = 0;
  w.forEach((v, k) => {
    const wt = Math.exp(-((k - m) ** 2) / (2 * s * s));
    num += v * wt;
    den += wt;
  });
  return num / den;
});
const PRANK = (x: S, n: number) => x.map((v, i) => {
  if (i < n) return NaN;
  const prev = x.slice(i - n, i);
  if (prev.some(Number.isNaN) || Number.isNaN(v)) return NaN;
  return (100 * prev.filter(p => p <= v).length) / n;
});
const sub = (a: S, b: S) => a.map((v, i) => v - b[i]);
const series = (slug: string, title: string, o: Opts = {}) => plotOf(runScript(slug, bars, o), title);
const same = (name: string, got: ArrayLike<number>, want: S, eps = 1e-9) => {
  const why = sameSeries(got, want, eps);
  check(name, why === '', why);
};

/* Trend */
same('ALMA(9, 0.85, 6)', series('alma', 'ALMA'), ALMA(C, 9, 0.85, 6));
same('ALMA(20, 0.5, 4) on hl2', series('alma', 'ALMA', { inputs: { len: 20, offset: 0.5, sigma: 4, src: 'hl2' } }), ALMA(HL2, 20, 0.5, 4));
{
  const e1 = EMA(C, 9);
  same('DEMA(9) = 2·EMA − EMA(EMA)', series('dema', 'DEMA'), sub(e1.map(v => 2 * v), EMA(e1, 9)), 1e-8);
}
same('EMA(9)', series('ema', 'EMA'), EMA(C, 9));
{
  const r = runScript('ema', bars, { inputs: { smoothing: 'SMA + Bollinger Bands', smoothLen: 14, bbMult: 2 } });
  const e = EMA(C, 9);
  const sm = SMA(e, 14);
  const sd = SD(e, 14);
  same('EMA smoothing line: SMA(14) of the EMA', plotOf(r, 'Smoothing'), sm, 1e-8);
  same('EMA smoothing bands: ± 2σ', plotOf(r, 'Upper BB'), sm.map((v, i) => v + 2 * sd[i]), 1e-8);
  check('EMA smoothing hidden by default, shown when chosen', runScript('ema', bars).plots.find(p => p.title === 'Smoothing')!.hidden && !r.plots.find(p => p.title === 'Smoothing')!.hidden);
}
{
  const half = WMA(C, 4);
  const full = WMA(C, 9);
  same('Hull MA(9) = WMA(2·WMA(4) − WMA(9), 3)', series('hull-ma', 'HMA'), WMA(half.map((v, i) => 2 * v - full[i]), 3), 1e-8);
}
{
  const n = 14;
  const fastA = 2 / 3;
  const slowA = 2 / 31;
  const out = nan();
  let prev = NaN;
  for (let i = 0; i < N; i++) {
    const mom = i >= n ? Math.abs(C[i] - C[i - n]) : NaN;
    let noise = NaN;
    if (i >= n) {
      noise = 0;
      for (let k = i - n + 1; k <= i; k++) noise += Math.abs(C[k] - C[k - 1]);
    }
    const er = Number.isNaN(noise) ? NaN : noise !== 0 ? mom / noise : 0;
    const alpha = (er * (fastA - slowA) + slowA) ** 2;
    const k = alpha * C[i] + (1 - alpha) * (Number.isNaN(prev) ? C[i] : prev);
    out[i] = prev = k;
  }
  same("KAMA(14, 2, 30)", series('kama', 'KAMA'), out, 1e-8);
}
same('LSMA(25)', series('lsma', 'LSMA'), LINREG(C, 25, 0), 1e-8);
same('LSMA(25, offset 3)', series('lsma', 'LSMA', { inputs: { offset: 3 } }), LINREG(C, 25, 3), 1e-8);
{
  const atr = ATR(10);
  const fh = HIGH(H, 10).map((v, i) => v - atr[i]);
  const fl = LOW(L, 10).map((v, i) => v + atr[i]);
  same('Chande Kroll stop short = highest(highest(H,10) − ATR, 9)', series('chande-kroll-stop', 'Stop short'), HIGH(fh, 9), 1e-9);
  same('Chande Kroll stop long = lowest(lowest(L,10) + ATR, 9)', series('chande-kroll-stop', 'Stop long'), LOW(fl, 9), 1e-9);
}
{
  const a = ATR(22).map(v => v * 3);
  same('Chandelier long exit = highest(H, 22) − 3·ATR(22)', series('chandelier-exit', 'Long exit'), sub(HIGH(H, 22), a), 1e-9);
  same('Chandelier short exit = lowest(L, 22) + 3·ATR(22)', series('chandelier-exit', 'Short exit'), LOW(L, 22).map((v, i) => v + a[i]), 1e-9);
}

/* Bands */
{
  const b = SMA(C, 20);
  same('Envelope basis SMA(20)', series('envelope', 'Basis'), b);
  same('Envelope upper +10%', series('envelope', 'Upper'), b.map(v => v * 1.1));
  same('Envelope exponential lower −10%', series('envelope', 'Lower', { inputs: { exponential: true } }), EMA(C, 20).map(v => v * 0.9));
}
{
  const m = SMA(C, 20);
  const sd = SD(C, 20);
  const up = m.map((v, i) => v + 2 * sd[i]);
  const lo = m.map((v, i) => v - 2 * sd[i]);
  same('%b(20, 2)', series('bb-percent-b', '%b'), C.map((c, i) => (c - lo[i]) / (up[i] - lo[i])), 1e-8);
  const bbw = up.map((u, i) => ((u - lo[i]) / m[i]) * 100);
  same('BBW(20, 2) in percent', series('bb-width', 'BBW'), bbw, 1e-8);
  same('BBW highest expansion over 125', series('bb-width', 'Highest expansion'), HIGH(bbw, 125), 1e-8);
  same('BBW lowest contraction over 125', series('bb-width', 'Lowest contraction'), LOW(bbw, 125), 1e-8);
  const m50 = SMA(C, 50);
  const sd50 = SD(C, 50);
  const bbt = C.map((_, i) => ((Math.abs(lo[i] - (m50[i] - 2 * sd50[i])) - Math.abs(up[i] - (m50[i] + 2 * sd50[i]))) / m[i]) * 100);
  same('BBTrend(20, 50, 2)', series('bbtrend', 'BBTrend'), bbt, 1e-7);
}

/* Momentum */
{
  const up = BARS(H, 15, true).map(v => (100 * (v + 14)) / 14);
  const dn = BARS(L, 15, false).map(v => (100 * (v + 14)) / 14);
  same('Aroon up(14)', series('aroon', 'Aroon Up'), up);
  same('Aroon down(14)', series('aroon', 'Aroon Down'), dn);
  same('Aroon oscillator(14)', series('aroon-oscillator', 'Aroon Oscillator'), sub(up, dn));
}
{
  const ao = sub(SMA(HL2, 5), SMA(HL2, 34));
  same('Awesome oscillator = SMA(hl2,5) − SMA(hl2,34)', series('awesome-oscillator', 'AO'), ao, 1e-9);
  const r = runScript('awesome-oscillator', bars);
  const cols = r.plots[0].colors!;
  const i = 200;
  check('AO colour follows the change: green rising, red falling', (ao[i] - ao[i - 1] <= 0) === /255, 59, 48|#ff3b30/i.test(String(cols[i])), String(cols[i]));
}
same('Balance of Power', series('balance-of-power', 'BOP'), C.map((c, i) => (c - O[i]) / (H[i] - L[i])));
{
  const e = EMA(C, 13);
  same('Bull Bear Power(13) = (H − EMA) + (L − EMA)', series('bull-bear-power', 'BBPower'), H.map((h, i) => h - e[i] + (L[i] - e[i])), 1e-9);
}
{
  const ch = CHANGE(C);
  const u = SUM(ch.map(v => (Number.isNaN(v) ? NaN : v >= 0 ? v : 0)), 9);
  const d = SUM(ch.map(v => (Number.isNaN(v) ? NaN : v >= 0 ? 0 : -v)), 9);
  same('Chande momentum(9) = 100·(Σup − Σdown)/(Σup + Σdown)', series('chande-momentum', 'ChandeMO'), u.map((x, i) => (100 * (x - d[i])) / (x + d[i])), 1e-9);
}
{
  /* the Chop Zone: the 34 EMA's angle from its scaled slope, bucketed into nine colours */
  const e = EMA(C, 34);
  const hh = HIGH(H, 30);
  const ll = LOW(L, 30);
  const angle = C.map((_, i) => {
    const span = (25 / (hh[i] - ll[i])) * ll[i];
    const y2 = ((e[i - 1] - e[i]) / HLC3[i]) * span;
    const a1 = Math.round((180 * Math.acos(1 / Math.sqrt(1 + y2 * y2))) / Math.PI);
    return y2 > 0 ? -a1 : a1;
  });
  const bucket = (a: number) => (a >= 5 ? '#26c6da' : a >= 3.57 ? '#43a047' : a >= 2.14 ? '#a5d6a7' : a >= 0.71 ? '#009688' : a <= -5 ? '#d50000' : a <= -3.57 ? '#e91e63' : a <= -2.14 ? '#ff6d00' : a <= -0.71 ? '#ffb74d' : '#fdd835');
  const r = runScript('chop-zone', bars);
  const cols = r.plots[0].colors!;
  let bad = '';
  const seen = new Set<string>();
  for (let i = 40; i < N; i++) {
    const want = bucket(angle[i]);
    seen.add(want);
    if (String(cols[i]).toLowerCase() !== want) {
      bad = `bar ${i}: got ${cols[i]} want ${want} (angle ${angle[i]})`;
      break;
    }
  }
  check('Chop Zone colour = bucket of the 34 EMA angle, every bar', bad === '', bad);
  check('Chop Zone fixture reaches at least four of the nine zones', seen.size >= 4, [...seen].join(' '));
}
{
  /* Connors RSI: RSI(3), RSI(2) of the streak, percent rank of the 1-bar ROC over 100 */
  const streak = nan();
  for (let i = 0; i < N; i++) {
    const p = i > 0 ? streak[i - 1] : NaN;
    const pz = Number.isNaN(p) ? 0 : p;
    streak[i] = i === 0 ? (C[i] > NaN ? 0 : -1) : C[i] === C[i - 1] ? 0 : C[i] > C[i - 1] ? (pz <= 0 ? 1 : pz + 1) : pz >= 0 ? -1 : pz - 1;
  }
  /* bar 0: na == na is false and na > na is false, so Pine's streak starts at −1 there */
  streak[0] = -1;
  const a = RSI(C, 3);
  const b = RSI(streak, 2);
  const c = PRANK(ROC(C, 1), 100);
  same('Connors RSI(3, 2, 100)', series('connors-rsi', 'CRSI'), a.map((x, i) => (x + b[i] + c[i]) / 3), 1e-8);
}
same('Coppock curve(10, 14, 11)', series('coppock-curve', 'Coppock Curve'), WMA(ROC(C, 14).map((v, i) => v + ROC(C, 11)[i]), 10), 1e-8);
{
  const ma = SMA(C, 21);
  same('DPO(21) = close − SMA(21)[11]', series('dpo', 'DPO'), sub(C, lag(ma, 11)), 1e-9);
  const r = runScript('dpo', bars, { inputs: { centered: true } });
  same('DPO centred = close[11] − SMA(21), drawn 11 bars back', plotOf(r, 'DPO'), sub(lag(C, 11), ma), 1e-9);
  check('DPO centred plot offset −11', r.plots[0].offset === -11, String(r.plots[0].offset));
}
{
  const hi = HIGH(HL2, 9);
  const lo = LOW(HL2, 9);
  const fish = nan();
  let value = NaN;
  let f = NaN;
  for (let i = 0; i < N; i++) {
    let v = 0.66 * ((HL2[i] - lo[i]) / (hi[i] - lo[i]) - 0.5) + 0.67 * (Number.isNaN(value) ? 0 : value);
    v = v > 0.99 ? 0.999 : v < -0.99 ? -0.999 : v;
    value = v;
    f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * (Number.isNaN(f) ? 0 : f);
    fish[i] = f;
  }
  same('Fisher transform(9)', series('fisher-transform', 'Fisher'), fish, 1e-8);
  same('Fisher trigger = Fisher one bar back', series('fisher-transform', 'Trigger'), lag(fish, 1), 1e-8);
}
{
  const sr = (r: number, s: number) => SMA(ROC(C, r), s);
  const a = sr(10, 10);
  const b = sr(15, 10);
  const c = sr(20, 10);
  const d = sr(30, 15);
  const kst = a.map((v, i) => v + 2 * b[i] + 3 * c[i] + 4 * d[i]);
  same('KST(10/15/20/30, 10/10/10/15)', series('kst', 'KST'), kst, 1e-8);
  same('KST signal SMA(9)', series('kst', 'Signal'), SMA(kst, 9), 1e-8);
}

/* Volume */
{
  /* 24 h: every bar that opened inside the last 86 400 s, by brute force */
  const want = bars.map((b, i) => {
    let s = 0;
    for (let k = i; k >= 0 && bars[k].time > b.time - 86400; k--) s += bars[k].volume;
    return s;
  });
  same('24-hour volume, by brute force over the clock', series('volume-24h', '24h volume'), want);
  check('24-hour volume reaches back across the overnight gap (one session plus)', want[200] > want[77] && want[200] !== CUM(V)[200]);
}
{
  const ad = CUM(CLV.map((c, i) => c * V[i]));
  same('Accumulation/Distribution', series('accumulation-distribution', 'Accumulation/Distribution'), ad, 1e-9);
  same('Chaikin money flow(20)', series('cmf', 'CMF'), SUM(CLV.map((c, i) => c * V[i]), 20).map((v, i) => v / SUM(V, 20)[i]), 1e-9);
  same('Chaikin oscillator(3, 10)', series('chaikin-oscillator', 'Chaikin Oscillator'), sub(EMA(ad, 3), EMA(ad, 10)), 1e-9);
  check('the fixture has flat bars (CLV 0 branch ran)', bars.some(b => b.high === b.low));
}
same('Ease of movement(14, 10000)', series('ease-of-movement', 'EOM'), SMA(CHANGE(HL2).map((c, i) => (10000 * c * (H[i] - L[i])) / V[i]), 14), 1e-9);
same("Elder's force index(13)", series('elder-force-index', 'EFI'), EMA(CHANGE(C).map((c, i) => c * V[i]), 13), 1e-9);
{
  const ch = CHANGE(HLC3);
  const sv = V.map((v, i) => (ch[i] >= 0 ? v : -v));
  const kvo = sub(EMA(sv, 34), EMA(sv, 55));
  same('Klinger oscillator (34, 55)', series('klinger', 'Klinger Oscillator'), kvo, 1e-9);
  same('Klinger signal EMA(13)', series('klinger', 'Signal'), EMA(kvo, 13), 1e-9);
}

/* Volatility */
{
  /* ADR on an intraday chart: the SMA of each finished session's high − low, stepping at the first bar of the next */
  const days: { first: number; hi: number; lo: number }[] = [];
  bars.forEach((b, i) => {
    const key = new Date((b.time - 4 * 3600) * 1000).getUTCDate();
    const last = days[days.length - 1];
    if (!last || new Date((bars[last.first].time - 4 * 3600) * 1000).getUTCDate() !== key) days.push({ first: i, hi: b.high, lo: b.low });
    else {
      last.hi = Math.max(last.hi, b.high);
      last.lo = Math.min(last.lo, b.low);
    }
  });
  const len = 3;
  const want = nan();
  for (let d = len; d < days.length; d++) {
    const v = days.slice(d - len, d).reduce((a, x) => a + (x.hi - x.lo), 0) / len;
    const end = d + 1 < days.length ? days[d + 1].first : N;
    for (let i = days[d].first; i < end; i++) want[i] = v;
  }
  same('ADR(3) intraday = SMA of the last three finished sessions', series('average-daily-range', 'ADR', { inputs: { len: 3 } }), want, 1e-9);
  same('ADR(14) on a daily chart = SMA(high − low, 14)', series('average-daily-range', 'ADR', { timeframe: 'D' }), SMA(sub(H, L), 14), 1e-9);
}
{
  const tr = TR(true);
  const ci = SUM(tr, 14).map((s, i) => (100 * Math.log10(s / (HIGH(H, 14)[i] - LOW(L, 14)[i]))) / Math.log10(14));
  same('Choppiness index(14)', series('choppiness', 'CHOP'), ci, 1e-9);
}
{
  const lr = C.map((c, i) => (i === 0 ? NaN : Math.log(c / C[i - 1])));
  same('Historical volatility(10), intraday √365', series('historical-volatility', 'HV'), SD(lr, 10).map(v => 100 * v * Math.sqrt(365)), 1e-9);
  same('Historical volatility(10), daily √365', series('historical-volatility', 'HV', { timeframe: 'D' }), SD(lr, 10).map(v => 100 * v * Math.sqrt(365)), 1e-9);
  same('Historical volatility(10), weekly √(365/7)', series('historical-volatility', 'HV', { timeframe: 'W' }), SD(lr, 10).map(v => 100 * v * Math.sqrt(365 / 7)), 1e-9);
}

/* Statistics */
{
  const up = O.map((o, i) => (C[i] - o >= 0 ? 1 : 0));
  const u = SUM(up, 9);
  const d = SUM(up.map(x => 1 - x), 9);
  same('Advance/decline ratio (bars)(9)', series('advance-decline-bars', 'A/D ratio'), u.map((x, i) => (d[i] === 0 ? x : x / d[i])));
}

/* ---- the A–L ones we already shipped, now on TradingView's inputs ---------------------------- */
{
  same('ATR(14) RMA (default)', series('atr', 'ATR'), ATR(14), 1e-9);
  same('ATR(14) SMA smoothing', series('atr', 'ATR', { inputs: { smoothing: 'SMA' } }), SMA(TR(true), 14), 1e-9);
  same('ATR(14) WMA smoothing', series('atr', 'ATR', { inputs: { smoothing: 'WMA' } }), WMA(TR(true), 14), 1e-9);
  const m = SMA(C, 20);
  const sd = SD(C, 20);
  same('Bollinger basis SMA(20) (default)', series('bollinger', 'Basis'), m);
  same('Bollinger upper ± 2σ', series('bollinger', 'Upper'), m.map((v, i) => v + 2 * sd[i]), 1e-9);
  const e = EMA(HLC3, 20);
  const sd3 = SD(HLC3, 20);
  same('Bollinger EMA basis on hlc3, 2.5σ', series('bollinger', 'Lower', { inputs: { maType: 'EMA', src: 'hlc3', mult: 2.5 } }), e.map((v, i) => v - 2.5 * sd3[i]), 1e-9);
  same('Bollinger VWMA basis', series('bollinger', 'Basis', { inputs: { maType: 'VWMA' } }), VWMA(C, 20), 1e-9);
  const tp = HLC3;
  const tpm = SMA(tp, 20);
  const md = map(tp, 20, w => {
    const mm = avg(w);
    return w.reduce((a, v) => a + Math.abs(v - mm), 0) / 20;
  });
  const cci = tp.map((v, i) => (v - tpm[i]) / (0.015 * md[i]));
  same('CCI(20) on hlc3', series('cci', 'CCI'), cci, 1e-8);
  same('CCI smoothing line SMA(5)', series('cci', 'Smoothing line'), SMA(cci, 5), 1e-8);
  same('Donchian upper(20)', series('donchian', 'Upper'), HIGH(H, 20));
  const kb = EMA(C, 20);
  same('Keltner upper: EMA(20) + 2·ATR(10) (default)', series('keltner', 'Upper'), kb.map((v, i) => v + 2 * ATR(10)[i]), 1e-9);
  same('Keltner true-range bands', series('keltner', 'Lower', { inputs: { style: 'True Range' } }), kb.map((v, i) => v - 2 * TR(true)[i]), 1e-9);
  same('Keltner range bands on an SMA basis', series('keltner', 'Upper', { inputs: { style: 'Range', useEma: false } }), SMA(C, 20).map((v, i) => v + 2 * RMA(sub(H, L), 20)[i]), 1e-9);
}

/* ---- 3. the new ta.* calls ------------------------------------------------------------------- */
{
  const src = `//@version=6
indicator("ta more")
plot(ta.cmo(close, 14), "cmo")
[m, u, l] = ta.kc(close, 20, 1.5)
plot(m, "kc m")
plot(u, "kc u")
plot(l, "kc l")
plot(ta.kcw(close, 20, 1.5, false), "kcw hl")`;
  const r = run(compile(src), bars, { budgetMs: 30_000 });
  const p = (t: string) => r.plots.find(x => x.title === t)!.values;
  const ch = CHANGE(C);
  const u = SUM(ch.map(v => (Number.isNaN(v) ? NaN : v >= 0 ? v : 0)), 14);
  const d = SUM(ch.map(v => (Number.isNaN(v) ? NaN : v >= 0 ? 0 : -v)), 14);
  same('ta.cmo(close, 14)', p('cmo'), u.map((x, i) => (100 * (x - d[i])) / (x + d[i])), 1e-9);
  const m = EMA(C, 20);
  const rr = EMA(TR(false), 20);
  same('ta.kc basis = EMA(20)', p('kc m'), m);
  same('ta.kc upper = EMA + 1.5·EMA(true range)', p('kc u'), m.map((v, i) => v + 1.5 * rr[i]), 1e-9);
  same('ta.kc lower', p('kc l'), m.map((v, i) => v - 1.5 * rr[i]), 1e-9);
  const hl = EMA(sub(H, L), 20);
  same('ta.kcw with high − low', p('kcw hl'), m.map((v, i) => (2 * 1.5 * hl[i]) / v), 1e-9);
  let msg = '';
  try {
    run(compile(`//@version=6\nindicator("x")\nplot(ta.cmo(close, 0))`), bars);
  } catch (e) {
    msg = (e as Error).message;
  }
  check('ta.cmo refuses a length of 0 with a sentence', /ta\.cmo: "length" must be a whole number/.test(msg), msg);
}

/* ---- speed: the heaviest of them inside the engine's own 200 ms budget on the fixture ---------- */
{
  let worst = 0;
  let who = '';
  for (const s of SOURCES_AL) {
    const t0 = performance.now();
    run(compile(shipped.get(s.slug)!.source), bars, { timeframe: '5' });
    const ms = performance.now() - t0;
    if (ms > worst) {
      worst = ms;
      who = s.slug;
    }
  }
  check(`every A–L script runs in the default budget (slowest ${who} ${worst.toFixed(0)} ms)`, worst < 200);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
