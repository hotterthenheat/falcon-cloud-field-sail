// THE M–Z TRADINGVIEW BUILT-INS, CHECKED (2026-11-01). Every indicator src/data/builtinScriptsMZ.ts adds, and the M–Z ones
// builtinScripts.ts already had (MACD, OBV, RSI, Stochastic, VWAP, Williams %R), is run through the Pine runtime exactly as
// the library ships it, over one fixed fixture, and every plotted bar is held against an independent array implementation
// written here from the indicator's definition (TradingView's help page / the Pine reference). A short hand-worked block
// pins a few values computed on paper, and the moon marks are held against the published 2026 new and full moons.
//   npx tsx scripts/indicators-mz-proof.ts
import { builtinScripts } from '../src/data/builtinScripts';
import { SOURCES_MZ } from '../src/data/builtinScriptsMZ';
import { run as engineRun, compile } from '../src/core/pine';
import type { Bar, RunResult } from '../src/core/pine';
import type { ScriptInputValue } from '../src/types/scripts';
import { nyTradingDay } from '../src/core/nyTime';

/* ---- the fixture: 40 weekday sessions of 30 ten-minute bars, a deterministic wave (no randomness) ---------------- */
const bars: Bar[] = [];
{
  let prev = 100;
  let k = 0;
  for (let d = 0; bars.length < 1200; d++) {
    const day = Date.UTC(2026, 2, 2 + d); // from Monday 2 March 2026
    const wd = new Date(day).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let j = 0; j < 30; j++, k++) {
      const c = 100 + 10 * Math.sin(k / 37) + 3 * Math.sin(k / 2.3) + 1.5 * Math.cos(k / 5.1) + k * 0.02;
      const o = prev;
      const h = Math.max(o, c) + 0.5 + 0.3 * Math.abs(Math.sin(k));
      const l = Math.min(o, c) - 0.4 - 0.2 * Math.abs(Math.cos(k * 1.3));
      const v = Math.round(1000 + 600 * (1 + Math.sin(k / 3)) + 300 * Math.abs(Math.cos(k / 11)) + (j === 0 ? 2500 : 0));
      bars.push({ time: (day + 15 * 3600_000 + j * 600_000) / 1000, open: o, high: h, low: l, close: c, volume: v });
      prev = c;
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
const OHLC4 = bars.map(b => (b.open + b.high + b.low + b.close) / 4);
const DAY = bars.map(b => nyTradingDay(b.time * 1000));

/* ---- independent maths over whole arrays ---------------------------------------------------------------------- */
type S = number[];
const nan = (): S => new Array(N).fill(NaN);
const at = (xs: S, i: number) => (i < 0 ? NaN : xs[i]);
const back = (xs: S, k: number): S => xs.map((_, i) => at(xs, i - k));
const map2 = (a: S, b: S, f: (x: number, y: number) => number): S => a.map((x, i) => f(x, b[i]));
const win = (xs: S, i: number, len: number): S | null => {
  if (i - len + 1 < 0) return null;
  const w = xs.slice(i - len + 1, i + 1);
  return w.some(Number.isNaN) ? null : w;
};
const mean = (w: S) => w.reduce((a, b) => a + b, 0) / w.length;
const sma = (xs: S, len: number): S => xs.map((_, i) => (win(xs, i, len) ? mean(win(xs, i, len)!) : NaN));
const sum = (xs: S, len: number): S => xs.map((_, i) => (win(xs, i, len) ? win(xs, i, len)!.reduce((a, b) => a + b, 0) : NaN));
/** Pine's recursive averages: seeded with the first full simple average, then alpha·x + (1−alpha)·prev; NaN in, NaN out */
const recur = (xs: S, len: number, alpha: number): S => {
  const out = nan();
  let prev = NaN;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(prev)) {
      const w = win(xs, i, len);
      if (w) prev = out[i] = mean(w);
    } else if (!Number.isNaN(xs[i])) prev = out[i] = alpha * xs[i] + (1 - alpha) * prev;
  }
  return out;
};
const ema = (xs: S, len: number) => recur(xs, len, 2 / (len + 1));
const rma = (xs: S, len: number) => recur(xs, len, 1 / len);
const wma = (xs: S, len: number): S =>
  xs.map((_, i) => {
    const w = win(xs, i, len);
    if (!w) return NaN;
    let n = 0;
    let d = 0;
    w.forEach((x, k) => {
      n += x * (k + 1);
      d += k + 1;
    });
    return n / d;
  });
const vwma = (xs: S, len: number) => map2(sma(map2(xs, V, (x, v) => x * v), len), sma(V, len), (a, b) => a / b);
const hma = (xs: S, len: number) => wma(map2(wma(xs, Math.floor(len / 2)), wma(xs, len), (a, b) => 2 * a - b), Math.round(Math.sqrt(len)));
const stdev = (xs: S, len: number, biased = true): S =>
  xs.map((_, i) => {
    const w = win(xs, i, len);
    if (!w) return NaN;
    const m = mean(w);
    return Math.sqrt(w.reduce((a, x) => a + (x - m) ** 2, 0) / (biased ? len : len - 1));
  });
const highest = (xs: S, len: number): S => xs.map((_, i) => (win(xs, i, len) ? Math.max(...win(xs, i, len)!) : NaN));
const lowest = (xs: S, len: number): S => xs.map((_, i) => (win(xs, i, len) ? Math.min(...win(xs, i, len)!) : NaN));
const change = (xs: S, k = 1): S => xs.map((x, i) => x - at(xs, i - k));
const tr = (handleNa: boolean): S => C.map((_, i) => (i === 0 ? (handleNa ? H[0] - L[0] : NaN) : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
const atr = (len: number) => rma(tr(true), len);
const rsi = (xs: S, len: number): S => {
  const up = rma(xs.map((x, i) => (i === 0 ? NaN : Math.max(x - xs[i - 1], 0))), len);
  const dn = rma(xs.map((x, i) => (i === 0 ? NaN : Math.max(xs[i - 1] - x, 0))), len);
  return up.map((u, i) => (Number.isNaN(u) || Number.isNaN(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
};
const stoch = (src: S, hi: S, lo: S, len: number) => {
  const hh = highest(hi, len);
  const ll = lowest(lo, len);
  return src.map((x, i) => (100 * (x - ll[i])) / (hh[i] - ll[i]));
};
const cci = (xs: S, len: number): S =>
  xs.map((x, i) => {
    const w = win(xs, i, len);
    if (!w) return NaN;
    const m = mean(w);
    return (x - m) / (0.015 * (w.reduce((a, y) => a + Math.abs(y - m), 0) / len));
  });
const linreg = (xs: S, len: number, off: number): S =>
  xs.map((_, i) => {
    const w = win(xs, i, len);
    if (!w) return NaN;
    const xm = (len - 1) / 2;
    const ym = mean(w);
    let sxy = 0;
    let sxx = 0;
    w.forEach((y, k) => {
      sxy += (k - xm) * (y - ym);
      sxx += (k - xm) ** 2;
    });
    const b = sxy / sxx;
    return ym + b * (len - 1 - off - xm);
  });
const swma = (xs: S): S => xs.map((_, i) => (win(xs, i, 4) ? (xs[i - 3] + 2 * xs[i - 2] + 2 * xs[i - 1] + xs[i]) / 6 : NaN));
const tsi = (xs: S, s: number, l: number): S => {
  const pc = change(xs);
  const num = ema(ema(pc, l), s);
  const den = ema(ema(pc.map(Math.abs), l), s);
  return num.map((n, i) => (den[i] === 0 ? NaN : n / den[i]));
};
const dmi = (diLen: number, adxLen: number): [S, S, S] => {
  const up = H.map((h, i) => (i === 0 ? NaN : h - H[i - 1]));
  const dn = L.map((l, i) => (i === 0 ? NaN : L[i - 1] - l));
  const pdm = up.map((u, i) => (Number.isNaN(u) ? NaN : u > dn[i] && u > 0 ? u : 0));
  const mdm = dn.map((d, i) => (Number.isNaN(d) ? NaN : d > up[i] && d > 0 ? d : 0));
  const trs = rma(tr(true), diLen);
  const p = map2(rma(pdm, diLen), trs, (a, b) => (100 * a) / b);
  const m = map2(rma(mdm, diLen), trs, (a, b) => (100 * a) / b);
  const dx = p.map((x, i) => (Number.isNaN(x) || Number.isNaN(m[i]) ? NaN : x + m[i] === 0 ? 0 : (100 * Math.abs(x - m[i])) / (x + m[i])));
  return [p, m, rma(dx, adxLen)];
};
const pearson = (a: S, b: S, len: number): S =>
  a.map((_, i) => {
    const wa = win(a, i, len);
    const wb = win(b, i, len);
    if (!wa || !wb) return NaN;
    const ma = mean(wa);
    const mb = mean(wb);
    let n = 0;
    let da = 0;
    let db = 0;
    for (let k = 0; k < len; k++) {
      n += (wa[k] - ma) * (wb[k] - mb);
      da += (wa[k] - ma) ** 2;
      db += (wb[k] - mb) ** 2;
    }
    return n / Math.sqrt(da * db);
  });
/** Spearman by counting: a value's rank is 1 + how many are below it + half the others equal to it */
const rci = (xs: S, len: number): S =>
  xs.map((_, i) => {
    const w = win(xs, i, len);
    if (!w) return NaN;
    let d2 = 0;
    w.forEach((x, k) => {
      const below = w.filter(y => y < x).length;
      const equal = w.filter(y => y === x).length;
      d2 += (k + 1 - (1 + below + (equal - 1) / 2)) ** 2;
    });
    return (1 - (6 * d2) / (len * (len * len - 1))) * 100;
  });
const crossUp = (a: S, b: S) => a.map((x, i) => i > 0 && x > b[i] && a[i - 1] <= b[i - 1]);
const crossDn = (a: S, b: S) => a.map((x, i) => i > 0 && x < b[i] && a[i - 1] >= b[i - 1]);

/* ---- the harness --------------------------------------------------------------------------------------------- */
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ' — ' + detail : ''}`);
};
const near = (a: number, b: number, eps = 1e-8) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const diff = (got: ArrayLike<number>, want: S, eps = 1e-8): string => {
  let finite = 0;
  for (let i = 0; i < want.length; i++) {
    if (!near(got[i], want[i], eps)) return `bar ${i}: got ${got[i]} want ${want[i]}`;
    if (!Number.isNaN(want[i])) finite++;
  }
  return finite < 20 ? `only ${finite} finite bars — the fixture never warmed it up` : '';
};
const scripts = new Map(builtinScripts().map(s => [s.id.replace('builtin:', ''), s]));
const runs = new Map<string, RunResult>();
const runOf = (slug: string, inputs: Record<string, ScriptInputValue> = {}, b: Bar[] = bars): RunResult => {
  const key = `${slug}|${JSON.stringify(inputs)}|${b.length}`;
  if (!runs.has(key)) runs.set(key, engineRun(compile(scripts.get(slug)!.source), b, { budgetMs: 60_000, inputs }));
  return runs.get(key)!;
};
const plotOf = (slug: string, title: string, inputs?: Record<string, ScriptInputValue>) => {
  const p = runOf(slug, inputs).plots.find(x => x.title === title);
  if (!p) throw new Error(`${slug} has no plot "${title}"`);
  return p;
};
const marks = (slug: string, title: string, inputs?: Record<string, ScriptInputValue>): number[] => {
  const s = runOf(slug, inputs).shapes.find(x => x.title === title);
  if (!s) throw new Error(`${slug} has no shape "${title}"`);
  const out: number[] = [];
  s.values.forEach((v, i) => !Number.isNaN(v) && out.push(i));
  return out;
};
const where = (xs: boolean[]) => xs.flatMap((x, i) => (x ? [i] : []));
const same = (slug: string, title: string, want: S, inputs?: Record<string, ScriptInputValue>, eps?: number) => {
  const d = diff(plotOf(slug, title, inputs).values, want, eps);
  check(`${slug} · ${title}`, d === '', d);
};
const sameMarks = (slug: string, title: string, want: number[], inputs?: Record<string, ScriptInputValue>, needSome = true) => {
  const got = marks(slug, title, inputs);
  const ok = got.join(',') === want.join(',') && (!needSome || want.length > 0);
  check(`${slug} · ${title} (${want.length} marks)`, ok, `got [${got.slice(0, 12)}] want [${want.slice(0, 12)}]`);
};

/* ---- 0. the shelf: every M–Z source compiles, sits in a known group, and no slug repeats ----------------------- */
{
  const all = builtinScripts();
  const bad = all.filter(s => s.status !== 'ok').map(s => `${s.id}: ${s.error?.message}`);
  check('every built-in compiles', bad.length === 0, bad.join('; '));
  const slugs = all.map(s => s.id);
  check('no slug repeats', new Set(slugs).size === slugs.length);
  const groups = new Set(['Slayer', 'Trend', 'Bands', 'Momentum', 'Volume', 'Volatility', 'Statistics', 'Candlesticks', 'Breadth']);
  check('every M–Z source is on a shared shelf group', SOURCES_MZ.every(s => groups.has(s.group)));
  check(`${SOURCES_MZ.length} M–Z sources reach the library`, SOURCES_MZ.every(s => scripts.has(s.slug)));
}

/* ---- 1. by hand: values worked on paper over a five-bar tape --------------------------------------------------- */
{
  const tape = [
    { c: 100, v: 500 },
    { c: 102, v: 400 },
    { c: 101, v: 600 },
    { c: 104, v: 300 },
    { c: 103, v: 700 },
  ].map((x, i) => ({ time: 1772463600 + i * 60, open: x.c, high: x.c + 1, low: x.c - 1, close: x.c, volume: x.v }));
  const last = (slug: string, title: string, inputs: Record<string, ScriptInputValue> = {}) => {
    const r = engineRun(compile(scripts.get(slug)!.source), tape, { inputs });
    return r.plots.find(p => p.title === title)!.values;
  };
  /* momentum(2) at bar 4: 103 − 101 = 2; ROC(2): 100·2/101 */
  check('by hand · Momentum(2) = 2', near(last('momentum', 'Momentum', { len: 2 })[4], 2));
  check('by hand · Rate of Change(2) = 1.980198…%', near(last('roc', 'ROC', { len: 2 })[4], 200 / 101));
  /* net volume: down bar 103 < 104 → −700 */
  check('by hand · Net Volume on a down bar = −700', last('net-volume', 'Net volume')[4] === -700);
  /* majority rule(3) at bar 4: of 102→101 (down), 101→104 (up), 104→103 (down): 1 of 3 */
  check('by hand · Majority Rule(3) = 33.33%', near(last('majority-rule', 'Majority rule', { len: 3 })[4], 100 / 3));
  /* RCI(5) on 100 102 101 104 103: price ranks 1 3 2 5 4 against time 1…5, Σd² = 4 → (1 − 24/120)·100 = 80 */
  check('by hand · RCI(5) = 80', near(last('rci', 'RCI', { len: 5 })[4], 80));
  /* NVI from 1000: bar 1 quieter (400 < 500) and +2% → 1020; bar 2 louder, held; bar 3 quieter, ×104/101 */
  const nvi = last('nvi', 'NVI');
  check('by hand · NVI = 1000 → 1020 → 1020 → 1050.297…', near(nvi[1], 1020) && near(nvi[2], 1020) && near(nvi[3], (1020 * 104) / 101));
  /* PVI: louder bars 2 (600 > 400, −1/102) and 4 (700 > 300, −1/104) */
  const pvi = last('pvi', 'PVI');
  check('by hand · PVI = 1000 → 1000 → 990.196… → 990.196… → 980.675…', near(pvi[1], 1000) && near(pvi[2], (1000 * 101) / 102) && near(pvi[4], (((1000 * 101) / 102) * 103) / 104));
  /* PVT: Σ change/prev·volume = 2/100·400 − 1/102·600 + 3/101·300 − 1/104·700 */
  check('by hand · Price Volume Trend', near(last('pvt', 'PVT')[4], 8 - 600 / 102 + 900 / 101 - 700 / 104));
  /* median price and typical price on the last bar: high 104, low 102, close 103 */
  check('by hand · Median Price = 103, Typical Price = 103', last('median-price', 'Median price')[4] === 103 && last('typical-price', 'Typical price')[4] === 103);
  /* SMA(3) of 101 104 103 = 102.666…; WMA(3) = (101 + 2·104 + 3·103)/6 = 103 */
  check('by hand · SMA(3) = 102.667, WMA(3) = 103', near(last('sma', 'MA', { len: 3 })[4], 308 / 3) && near(last('wma', 'WMA', { len: 3 })[4], 103));
}

/* ---- 2. the averages on price ------------------------------------------------------------------------------- */
same('sma', 'MA', sma(C, 9));
same('wma', 'WMA', wma(C, 9));
same('vwma', 'VWMA', vwma(C, 20));
same('smma', 'SMMA', rma(C, 7));
{
  const e1 = ema(C, 9);
  const e2 = ema(e1, 9);
  const e3 = ema(e2, 9);
  same('tema', 'TEMA', e1.map((x, i) => 3 * (x - e2[i]) + e3[i]));
}
{
  const e = ema(C, 14);
  const mg = nan();
  for (let i = 0; i < N; i++) {
    const p = at(mg, i - 1);
    mg[i] = Number.isNaN(p) ? e[i] : p + (C[i] - p) / (14 * Math.pow(C[i] / p, 4));
  }
  same('mcginley', 'McGinley', mg);
}
{
  const len = 10;
  const w = Array.from({ length: len }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (len - 1)));
  same('ma-hamming', 'Hamming MA', C.map((_, i) => (i < len - 1 ? NaN : w.reduce((a, wi, k) => a + wi * C[i - k], 0) / w.reduce((a, b) => a + b, 0))));
}
same('ma-ribbon', 'MA #1', sma(C, 20));
same('ma-ribbon', 'MA #4', sma(C, 200));
same('ma-ribbon', 'MA #2', ema(C, 50), { k2: 'EMA' });
same('ma-ribbon', 'MA #3', rma(C, 100), { k3: 'SMMA (RMA)' });
same('ma-ribbon', 'MA #3', vwma(C, 100), { k3: 'VWMA' });
{
  const s = sma(C, 9);
  const l = sma(C, 21);
  const crossed = s.map((x, i) => i > 0 && ((x > l[i] && s[i - 1] <= l[i - 1]) || (x < l[i] && s[i - 1] >= l[i - 1])));
  same('ma-cross', 'Short', s);
  same('ma-cross', 'Cross', s.map((x, i) => (crossed[i] ? x : NaN)), undefined);
  check('ma-cross · it crosses on the fixture', crossed.filter(Boolean).length > 5);
  const m = sma(C, 10);
  const e = ema(C, 10);
  same('ma-ema-cross', 'EMA', e);
  same('ma-ema-cross', 'Cross', m.map((x, i) => (i > 0 && ((x > e[i] && m[i - 1] <= e[i - 1]) || (x < e[i] && m[i - 1] >= e[i - 1])) ? x : NaN)));
}
{
  const ma = sma(C, 9);
  let b = 0;
  let s = 0;
  const longs: number[] = [];
  const shorts: number[] = [];
  C.forEach((c, i) => {
    b = c > ma[i] ? b + 1 : 0;
    s = c < ma[i] ? s + 1 : 0;
    if (b === 1) longs.push(i);
    if (s === 1) shorts.push(i);
  });
  sameMarks('movingavg-cross', 'Long entry', longs);
  sameMarks('movingavg-cross', 'Short entry', shorts);
  const f = sma(C, 9);
  const sl = sma(C, 18);
  sameMarks('movingavg2line-cross', 'Long entry', where(crossUp(f, sl)));
  sameMarks('movingavg2line-cross', 'Short entry', where(crossDn(f, sl)));
}
{
  same('williams-alligator', 'Jaw', rma(HL2, 13));
  same('williams-alligator', 'Lips', rma(HL2, 5));
  const offs = ['Jaw', 'Teeth', 'Lips'].map(t => plotOf('williams-alligator', t).offset).join(',');
  check('williams-alligator · jaw, teeth and lips are pushed 8, 5 and 3 bars ahead', offs === '8,5,3', offs);
}
{
  /* TradingView's fractal: the n bars after strictly lower; the n before strictly lower, allowing up to four equal highs right before */
  const n = 2;
  const up: number[] = [];
  const dn: number[] = [];
  for (let i = 0; i < N; i++) {
    const c = i - n;
    if (c < 0) continue;
    const hh = (k: number) => at(H, c - k);
    const lw = (k: number) => at(L, c - k);
    let after = true;
    let afterL = true;
    for (let k = 1; k <= n; k++) {
      after = after && H[c + k] < H[c];
      afterL = afterL && L[c + k] > L[c];
    }
    const before = (eq: number, hi: boolean) => {
      for (let e = 1; e <= eq; e++) if (hi ? !(hh(e) <= H[c]) : !(lw(e) >= L[c])) return false;
      for (let k = 1; k <= n; k++) if (hi ? !(hh(k + eq) < H[c]) : !(lw(k + eq) > L[c])) return false;
      return true;
    };
    if (after && [0, 1, 2, 3, 4].some(e => before(e, true))) up.push(c);
    if (afterL && [0, 1, 2, 3, 4].some(e => before(e, false))) dn.push(c);
  }
  sameMarks('williams-fractals', 'Up fractal', up);
  sameMarks('williams-fractals', 'Down fractal', dn);
}
{
  /* Volatility stop, as TradingView writes it */
  const a = atr(20);
  const trn = tr(false);
  let hi = C[0];
  let lo = C[0];
  let upT = true;
  let stop = 0;
  const want = nan();
  for (let i = 0; i < N; i++) {
    const m = Number.isNaN(a[i] * 2) ? trn[i] : a[i] * 2;
    hi = Math.max(hi, C[i]);
    lo = Math.min(lo, C[i]);
    const s0 = upT ? Math.max(stop, hi - m) : Math.min(stop, lo + m);
    stop = Number.isNaN(s0) ? C[i] : s0;
    const was = upT;
    upT = C[i] - stop >= 0;
    if (upT !== was) {
      hi = C[i];
      lo = C[i];
      stop = upT ? hi - m : lo + m;
    }
    want[i] = stop;
  }
  same('volatility-stop', 'Volatility Stop', want);
}
{
  const want = nan();
  let s = 0;
  let n = 0;
  OHLC4.forEach((x, i) => {
    if (i === 0 || DAY[i] !== DAY[i - 1]) s = n = 0;
    s += x;
    n++;
    want[i] = s / n;
  });
  same('twap', 'TWAP', want);
}

/* ---- 3. technical ratings, vote by vote --------------------------------------------------------------------- */
{
  const vote = (b: boolean, s: boolean) => (b ? 1 : s ? -1 : 0);
  const maV = (m: S) => m.map((x, i) => (Number.isNaN(x) ? NaN : x < C[i] ? 1 : x > C[i] ? -1 : 0));
  const don = (len: number) => map2(lowest(L, len), highest(H, len), (a, b) => (a + b) / 2);
  const conv = don(9);
  const base = don(26);
  const spanA = map2(conv, base, (a, b) => (a + b) / 2);
  const spanB = don(52);
  const ichi = C.map((c, i) => (Number.isNaN(spanB[i]) ? NaN : vote(spanA[i] > spanB[i] && base[i] > spanA[i] && conv[i] > base[i] && c > conv[i], spanA[i] < spanB[i] && base[i] < spanA[i] && conv[i] < base[i] && c < conv[i])));
  const mas = [...[10, 20, 30, 50, 100, 200].map(n => maV(sma(C, n))), ...[10, 20, 30, 50, 100, 200].map(n => maV(ema(C, n))), maV(hma(C, 9)), maV(vwma(C, 20)), ichi];
  const maR = C.map((_, i) => mas.reduce((a, m) => a + m[i], 0) / 15);
  const s50 = sma(C, 50);
  const up = C.map((c, i) => c > s50[i]);
  const down = C.map((c, i) => c < s50[i]);
  const r = rsi(C, 14);
  const rV = r.map((x, i) => (Number.isNaN(at(r, i - 1)) ? NaN : vote(x < 30 && x > r[i - 1], x > 70 && x < r[i - 1])));
  const k = sma(stoch(C, H, L, 14), 3);
  const d = sma(k, 3);
  const stV = k.map((x, i) => (Number.isNaN(d[i]) ? NaN : vote(x < 20 && d[i] < 20 && x > d[i], x > 80 && d[i] > 80 && x < d[i])));
  const cc = cci(C, 20);
  const cV = cc.map((x, i) => (Number.isNaN(at(cc, i - 1)) ? NaN : vote(x < -100 && x > cc[i - 1], x > 100 && x < cc[i - 1])));
  const [dp, dm, adx] = dmi(14, 14);
  const aV = adx.map((x, i) => (Number.isNaN(at(adx, i - 1)) ? NaN : vote(x > 20 && dp[i] > dm[i] && x > adx[i - 1], x > 20 && dp[i] < dm[i] && x < adx[i - 1])));
  const ao = map2(sma(HL2, 5), sma(HL2, 34), (a, b) => a - b);
  const aoV = ao.map((x, i) => {
    const p = at(ao, i - 1);
    const p2 = at(ao, i - 2);
    if (Number.isNaN(p2)) return NaN;
    return vote((x > 0 && p < 0) || (x > 0 && p > 0 && x > p && p2 > p), (x < 0 && p > 0) || (x < 0 && p < 0 && x < p && p2 < p));
  });
  const mom = change(C, 10);
  const mV = mom.map((x, i) => (Number.isNaN(at(mom, i - 1)) ? NaN : vote(x > mom[i - 1], x < mom[i - 1])));
  const ml = map2(ema(C, 12), ema(C, 26), (a, b) => a - b);
  const ms = ema(ml, 9);
  const macdV = ml.map((x, i) => (Number.isNaN(ms[i]) ? NaN : vote(x > ms[i], x < ms[i])));
  const sk = sma(stoch(r, r, r, 14), 3);
  const sd = sma(sk, 3);
  const srV = sk.map((x, i) => (Number.isNaN(sd[i]) ? NaN : vote(down[i] && x < 20 && sd[i] < 20 && x > sd[i], up[i] && x > 80 && sd[i] > 80 && x < sd[i])));
  const hh = highest(H, 14);
  const ll = lowest(L, 14);
  const wr = C.map((c, i) => (100 * (c - hh[i])) / (hh[i] - ll[i]));
  const wV = wr.map((x, i) => (Number.isNaN(at(wr, i - 1)) ? NaN : vote(x < -80 && x > wr[i - 1], x > -20 && x < wr[i - 1])));
  const e13 = ema(C, 13);
  const bull = map2(H, e13, (a, b) => a - b);
  const bear = map2(L, e13, (a, b) => a - b);
  const bV = bear.map((x, i) => (Number.isNaN(at(bear, i - 1)) ? NaN : vote(up[i] && x < 0 && x > bear[i - 1], down[i] && bull[i] > 0 && bull[i] < bull[i - 1])));
  const bp = C.map((c, i) => c - Math.min(L[i], at(C, i - 1)));
  const trr = C.map((_, i) => Math.max(H[i], at(C, i - 1)) - Math.min(L[i], at(C, i - 1)));
  const avg = (n: number) => map2(sum(bp, n), sum(trr, n), (a, b) => a / b);
  const a7 = avg(7);
  const a14 = avg(14);
  const a28 = avg(28);
  const uo = a7.map((x, i) => (100 * (4 * x + 2 * a14[i] + a28[i])) / 7);
  const uV = uo.map(x => (Number.isNaN(x) ? NaN : vote(x > 70, x < 30)));
  const osc = [rV, stV, cV, aV, aoV, mV, macdV, srV, wV, bV, uV];
  const oR = C.map((_, i) => osc.reduce((a, o) => a + o[i], 0) / 11);
  same('technical-ratings', 'MA rating', maR);
  same('technical-ratings', 'Oscillator rating', oR);
  same('technical-ratings', 'Rating', map2(maR, oR, (a, b) => (a + b) / 2));
  same('technical-ratings', 'Rating', maR, { basedOn: 'MAs' });
  const spread = new Set(plotOf('technical-ratings', 'Oscillator rating').values.filter(x => !Number.isNaN(x)).map(x => Math.round(x * 11)));
  check('technical-ratings · the oscillators actually vote both ways on the fixture', [...spread].some(x => x > 0) && [...spread].some(x => x < 0), [...spread].join(','));
}

/* ---- 4. bands ------------------------------------------------------------------------------------------------- */
{
  /* the nearest-rank median of three is the middle one */
  const med = HL2.map((_, i) => (i < 2 ? NaN : [HL2[i - 2], HL2[i - 1], HL2[i]].sort((a, b) => a - b)[1]));
  const a = atr(14);
  same('median', 'Median', med);
  same('median', 'Median EMA', ema(med, 3));
  same('median', 'Upper band', med.map((m, i) => m + 2 * a[i]));
  same('ma-channel', 'Upper', sma(H, 20));
  same('ma-channel', 'Lower', sma(L, 20));
  same('price-channel', 'Center', map2(highest(H, 20), lowest(L, 20), (a, b) => (a + b) / 2));
  /* standard error the long way: the residuals about the regression line, summed one by one */
  const se = (xs: S, len: number): S =>
    xs.map((_, i) => {
      const w = win(xs, i, len);
      if (!w) return NaN;
      const xm = (len - 1) / 2;
      const ym = mean(w);
      let sxy = 0;
      let sxx = 0;
      w.forEach((y, k) => {
        sxy += (k - xm) * (y - ym);
        sxx += (k - xm) ** 2;
      });
      const b = sxy / sxx;
      const ss = w.reduce((acc, y, k) => acc + (y - (ym + b * (k - xm))) ** 2, 0);
      return Math.sqrt(ss / (len - 2));
    });
  const mid = sma(linreg(C, 21, 0), 3);
  const e = sma(se(C, 21), 3);
  same('standard-error-bands', 'Middle', mid);
  same('standard-error-bands', 'Upper', mid.map((m, i) => m + 2 * e[i]), undefined, 1e-7);
  same('standard-error', 'Standard error', se(C, 14), undefined, 1e-6);
}

/* ---- 5. momentum ---------------------------------------------------------------------------------------------- */
same('momentum', 'Momentum', change(C, 10));
same('roc', 'ROC', C.map((c, i) => (100 * (c - at(C, i - 9))) / at(C, i - 9)));
{
  const p = map2(ema(C, 12), ema(C, 26), (a, b) => ((a - b) / b) * 100);
  same('ppo', 'PPO', p);
  same('ppo', 'Signal', ema(p, 9));
  same('ppo', 'Histogram', map2(p, ema(p, 9), (a, b) => a - b));
  same('price-oscillator', 'Oscillator', map2(sma(C, 10), sma(C, 21), (a, b) => ((a - b) / b) * 100));
  same('price-oscillator', 'Oscillator', map2(ema(C, 10), ema(C, 21), (a, b) => ((a - b) / b) * 100), { useEma: true });
}
{
  /* DecisionPoint's custom smoothing: alpha 2/length, seeded by a simple average */
  const csf = (xs: S, len: number) => recur(xs, len, 2 / len);
  const roc1 = C.map((c, i) => (100 * (c - at(C, i - 1))) / at(C, i - 1));
  const pmo = csf(csf(roc1, 35).map(x => 10 * x), 20);
  same('pmo', 'PMO', pmo);
  same('pmo', 'Signal', ema(pmo, 10));
}
{
  const r = (n: number) => C.map((c, i) => (100 * (c - at(C, i - n))) / at(C, i - n));
  const terms: [number, number, number][] = [
    [10, 10, 1],
    [15, 10, 2],
    [20, 10, 3],
    [30, 15, 4],
    [40, 50, 1],
    [65, 65, 2],
    [75, 75, 3],
    [100, 100, 4],
    [195, 130, 1],
    [265, 130, 2],
    [390, 130, 3],
    [530, 195, 4],
  ];
  const parts = terms.map(([roc, len, w]) => sma(r(roc), len).map(x => x * w));
  const sk = C.map((_, i) => parts.reduce((a, p) => a + p[i], 0));
  same('special-k', 'Special K', sk);
  same('special-k', 'Signal', sma(sma(sk, 100), 100), undefined, 1e-7);
}
{
  const t = ema(ema(ema(C.map(Math.log), 18), 18), 18);
  same('trix', 'TRIX', change(t).map(x => 10000 * x), undefined, 1e-7);
  const ts = tsi(C, 13, 25).map(x => 100 * x);
  same('tsi', 'True Strength Index', ts);
  same('tsi', 'Signal', ema(ts, 13));
  const erg = tsi(C, 5, 20);
  same('smi-ergodic', 'SMI', erg);
  same('smi-ergodic', 'Signal', ema(erg, 5));
  same('smi-ergodic-osc', 'SMI Ergodic Oscillator', map2(erg, ema(erg, 5), (a, b) => a - b));
}
{
  const hh = highest(H, 10);
  const ll = lowest(L, 10);
  const ee = (xs: S, n: number) => ema(ema(xs, n), n);
  const smi = map2(ee(C.map((c, i) => c - (hh[i] + ll[i]) / 2), 3), ee(map2(hh, ll, (a, b) => a - b), 3), (a, b) => 200 * (a / b));
  same('smi', 'SMI', smi);
  same('smi', 'SMI-based EMA', ema(smi, 10));
  const r = rsi(C, 14);
  const k = sma(stoch(r, r, r, 14), 3);
  same('stoch-rsi', 'K', k);
  same('stoch-rsi', 'D', sma(k, 3));
  const rv = map2(sum(swma(map2(C, O, (a, b) => a - b)), 10), sum(swma(map2(H, L, (a, b) => a - b)), 10), (a, b) => a / b);
  same('rvgi', 'RVGI', rv);
  same('rvgi', 'Signal', swma(rv));
  same('rci', 'RCI', rci(C, 10));
  same('rci-ribbon', 'Long RCI', rci(C, 50));
}
{
  const bp = C.map((c, i) => c - Math.min(L[i], at(C, i - 1)));
  const trr = C.map((_, i) => Math.max(H[i], at(C, i - 1)) - Math.min(L[i], at(C, i - 1)));
  const avg = (n: number) => map2(sum(bp, n), sum(trr, n), (a, b) => a / b);
  const a7 = avg(7);
  const a14 = avg(14);
  const a28 = avg(28);
  same('ultimate-oscillator', 'UO', a7.map((x, i) => (100 * (4 * x + 2 * a14[i] + a28[i])) / 7));
  const vmp = sum(H.map((h, i) => Math.abs(h - at(L, i - 1))), 14);
  const vmm = sum(L.map((l, i) => Math.abs(l - at(H, i - 1))), 14);
  const st = sum(atr(1), 14);
  same('vortex', 'VI +', map2(vmp, st, (a, b) => a / b));
  same('vortex', 'VI -', map2(vmm, st, (a, b) => a / b));
}
{
  const c14 = cci(C, 14);
  same('woodies-cci', 'CCI 14', c14);
  same('woodies-cci', 'CCI turbo', cci(C, 6));
}
{
  /* RSI divergence: pivots of RSI 5 bars either side, compared with the previous pivot 5–60 bars back */
  const osc = rsi(C, 14);
  const lb = 5;
  const pivot = (lowSide: boolean) =>
    osc.map((_, i) => {
      const c = i - lb;
      if (c - lb < 0) return false;
      const w = osc.slice(c - lb, i + 1);
      if (w.some(Number.isNaN)) return false;
      const v = osc[c];
      return w.every((x, k) => k === lb || (lowSide ? (k < lb ? x > v : x >= v) : k < lb ? x < v : x <= v));
    });
  const found = (lowSide: boolean) => pivot(lowSide);
  const cond = (lowSide: boolean) => {
    const f = found(lowSide);
    const out: number[] = [];
    let prevOsc = NaN;
    let prevPx = NaN;
    let lastHit = NaN;
    let prevBar = -1;
    for (let i = 0; i < N; i++) {
      /* bars since the previous pivot (found[1]) */
      if (i > 0 && f[i - 1]) lastHit = i - 1;
      const since = Number.isNaN(lastHit) ? NaN : i - lastHit;
      const inRange = 5 <= since && since <= 60;
      const o = at(osc, i - lb);
      const px = lowSide ? at(L, i - lb) : at(H, i - lb);
      if (f[i]) {
        const div = lowSide ? px < prevPx && o > prevOsc : px > prevPx && o < prevOsc;
        if (div && inRange) out.push(i - lb);
        prevOsc = o;
        prevPx = px;
        prevBar = i;
      }
    }
    void prevBar;
    return out;
  };
  sameMarks('rsi-divergence', 'Bullish', cond(true));
  sameMarks('rsi-divergence', 'Bearish', cond(false));
}
{
  const m = map2(ema(C, 12), ema(C, 26), (a, b) => a - b);
  const k = sma(stoch(C, H, L, 70), 3);
  const zero = nan().map(() => 0);
  const bear = crossDn(m, zero).map((x, i) => x && k[i] > 70);
  const bull = crossUp(m, zero).map((x, i) => x && k[i] < 30);
  /* the fixture's turns are mild; the softer levels make both kinds fire so the rule is seen to work */
  const kk = k;
  sameMarks('rob-booker-reversal', 'Bearish reversal', where(bear), undefined, false);
  sameMarks('rob-booker-reversal', 'Bullish reversal', where(bull), undefined, false);
  sameMarks('rob-booker-reversal', 'Bearish reversal', where(crossDn(m, zero).map((x, i) => x && kk[i] > 55)), { upper: 55 });
  sameMarks('rob-booker-reversal', 'Bullish reversal', where(crossUp(m, zero).map((x, i) => x && kk[i] < 45)), { lower: 45 });
}
{
  const [, , adx] = dmi(14, 14);
  const top = back(highest(H, 20), 1);
  const bot = back(lowest(L, 20), 1);
  const quiet = adx.map(x => x < 25);
  same('rob-booker-adx-breakout', 'Box top', top.map((t, i) => (quiet[i] ? t : NaN)), { thresh: 25 });
  sameMarks('rob-booker-adx-breakout', 'Breakout up', where(C.map((c, i) => i > 0 && adx[i - 1] < 25 && c > top[i] && C[i - 1] <= top[i - 1])), { thresh: 25 });
  sameMarks('rob-booker-adx-breakout', 'Breakout down', where(C.map((c, i) => i > 0 && adx[i - 1] < 25 && c < bot[i] && C[i - 1] >= bot[i - 1])), { thresh: 25 });
}

/* ---- 6. volume ------------------------------------------------------------------------------------------------ */
same('volume', 'Volume', V);
same('volume', 'Volume MA', sma(V, 20));
same('net-volume', 'Net volume', C.map((c, i) => (i === 0 ? 0 : c > C[i - 1] ? V[i] : c < C[i - 1] ? -V[i] : 0)));
{
  let acc = 0;
  same('pvt', 'PVT', C.map((c, i) => (i === 0 ? 0 : (acc += ((c - C[i - 1]) / C[i - 1]) * V[i]))));
  let n = 1000;
  let p = 1000;
  const nvi = C.map((c, i) => (i > 0 && V[i] < V[i - 1] ? (n += ((c - C[i - 1]) / C[i - 1]) * n) : n));
  const pvi = C.map((c, i) => (i > 0 && V[i] > V[i - 1] ? (p += ((c - C[i - 1]) / C[i - 1]) * p) : p));
  same('nvi', 'NVI', nvi);
  same('nvi', 'NVI-based EMA', ema(nvi, 255));
  same('pvi', 'PVI', pvi);
  const pv = map2(ema(V, 12), ema(V, 26), (a, b) => ((a - b) / b) * 100);
  same('pvo', 'PVO', pv);
  same('pvo', 'Signal', ema(pv, 9));
  same('volume-oscillator', 'Volume oscillator', map2(ema(V, 5), ema(V, 10), (a, b) => (100 * (a - b)) / b));
}
{
  /* relative volume at time: this session's volume to the same offset over the mean of the last 10 sessions' */
  const sessions: { start: number; at: number[]; cum: number[]; vol: number[] }[] = [];
  const rel = nan();
  const relReg = nan();
  bars.forEach((b, i) => {
    if (i === 0 || DAY[i] !== DAY[i - 1]) sessions.push({ start: b.time, at: [], cum: [], vol: [] });
    const s = sessions[sessions.length - 1];
    const off = b.time - s.start;
    s.at.push(off);
    s.cum.push((s.cum[s.cum.length - 1] ?? 0) + b.volume);
    s.vol.push(b.volume);
    const past = sessions.slice(0, -1).slice(-10);
    if (past.length < 10) return;
    const pick = (p: (typeof sessions)[number], cum: boolean) => {
      let k = -1;
      p.at.forEach((t, j) => t <= off && (k = j));
      return k < 0 ? 0 : cum ? p.cum[k] : p.vol[k];
    };
    rel[i] = s.cum[s.cum.length - 1] / (past.reduce((a, p) => a + pick(p, true), 0) / 10);
    relReg[i] = b.volume / (past.reduce((a, p) => a + pick(p, false), 0) / 10);
  });
  same('relative-volume-at-time', 'Relative volume', rel);
  same('relative-volume-at-time', 'Relative volume', relReg, { mode: 'Regular' });
  const firstLive = rel.findIndex(x => !Number.isNaN(x));
  check('relative-volume-at-time · blank until ten past sessions exist', firstLive === 300, `first value at bar ${firstLive}`);
}

/* ---- 7. volatility -------------------------------------------------------------------------------------------- */
{
  const span = map2(H, L, (a, b) => a - b);
  const e1 = ema(span, 9);
  same('mass-index', 'Mass index', sum(map2(e1, ema(e1, 9), (a, b) => a / b), 10));
  const sd = stdev(C, 10);
  const ch = change(C);
  const up = ema(sd.map((s, i) => (ch[i] <= 0 ? 0 : s)), 14);
  const dn = ema(sd.map((s, i) => (ch[i] > 0 ? 0 : s)), 14);
  same('relative-volatility-index', 'RVI', map2(up, dn, (a, b) => (a / (a + b)) * 100));
  const hh = highest(C, 14);
  same('ulcer-index', 'Ulcer index', sma(C.map((c, i) => (100 * (c - hh[i])) / hh[i]).map(x => x * x), 14).map(Math.sqrt));
  const r = C.map((c, i) => Math.log(c / at(C, i - 1)));
  same('volatility-close-to-close', 'Volatility', stdev(r, 10, false).map(x => x * Math.sqrt(252) * 100));
  same('volatility-zero-trend', 'Volatility', sum(r.map(x => x * x), 10).map(x => Math.sqrt(x / 10) * Math.sqrt(252) * 100));
  const gk = C.map((c, i) => 0.5 * Math.log(H[i] / L[i]) ** 2 - (2 * Math.log(2) - 1) * Math.log(c / O[i]) ** 2);
  same('volatility-ohlc', 'Volatility', sma(gk, 10).map(x => Math.sqrt(x) * Math.sqrt(252) * 100));
}

/* ---- 8. statistics -------------------------------------------------------------------------------------------- */
same('standard-deviation', 'StdDev', stdev(C, 20));
same('trend-strength-index', 'Trend Strength Index', pearson(C, C.map((_, i) => i), 14));
same('majority-rule', 'Majority rule', sma(C.map((c, i) => (c > at(C, i - 1) ? 1 : 0)), 14).map(x => x * 100));
same('median-price', 'Median price', HL2);
same('typical-price', 'Typical price', HLC3);
{
  /* the published 2026 moons (UTC): full 3 Mar 11:38, new 19 Mar 01:23, full 2 Apr 02:12, new 17 Apr 11:52 */
  const day = (i: number) => new Date(bars[i].time * 1000).toISOString().slice(0, 10);
  const fulls = marks('moon-phases', 'Full moon').map(day);
  const news = marks('moon-phases', 'New moon').map(day);
  const within = (got: string[], want: string[]) => want.every(w => got.some(g => Math.abs(Date.parse(g) - Date.parse(w)) <= 86400_000));
  check('moon-phases · full moons on or by a day of 3 Mar and 2 Apr 2026', within(fulls, ['2026-03-03', '2026-04-02']) && fulls.length === 2, fulls.join(' '));
  check('moon-phases · new moons on or by a day of 19 Mar and 17 Apr 2026', within(news, ['2026-03-19', '2026-04-17']) && news.length === 2, news.join(' '));
}

/* ---- 9. the M–Z indicators the terminal already had, now on TradingView's inputs ----------------------------------- */
{
  /* MACD 12 26 9 on close with EMA averages; the SMA choices swap both */
  const m = map2(ema(C, 12), ema(C, 26), (a, b) => a - b);
  same('macd', 'MACD', m);
  same('macd', 'Signal', ema(m, 9));
  const ms = map2(sma(C, 12), sma(C, 26), (a, b) => a - b);
  same('macd', 'Signal', sma(ms, 9), { oscKind: 'SMA', sigKind: 'SMA' });
  /* RSI 14 with its 14-bar SMA, and the Bollinger option */
  const r = rsi(C, 14);
  same('rsi', 'RSI', r);
  same('rsi', 'RSI-based MA', sma(r, 14));
  same('rsi', 'Upper Bollinger Band', map2(sma(r, 14), stdev(r, 14), (a, b) => a + 2 * b), { maKind: 'SMA + Bollinger Bands' });
  check('rsi · no Bollinger band unless asked', plotOf('rsi', 'Upper Bollinger Band').values.every(Number.isNaN));
  /* Stochastic 14, %K smoothing 1, %D 3 */
  const k = stoch(C, H, L, 14);
  same('stochastic', '%K', k);
  same('stochastic', '%D', sma(k, 3));
  /* Williams %R 14 on close */
  const hh = highest(H, 14);
  const ll = lowest(L, 14);
  same('williams-r', '%R', C.map((c, i) => (100 * (c - hh[i])) / (hh[i] - ll[i])));
  /* OBV, and its optional smoothing */
  let o = 0;
  const obv = C.map((c, i) => (o += i === 0 ? 0 : Math.sign(c - C[i - 1]) * V[i]));
  same('obv', 'OBV', obv);
  same('obv', 'OBV-based MA', ema(obv, 14), { maKind: 'EMA' });
  /* VWAP on hlc3 restarting each session, with ±1 volume-weighted deviation on */
  const vw = nan();
  const up = nan();
  let pv = 0;
  let vv = 0;
  let p2 = 0;
  HLC3.forEach((x, i) => {
    if (i === 0 || DAY[i] !== DAY[i - 1]) pv = vv = p2 = 0;
    pv += x * V[i];
    vv += V[i];
    p2 += x * x * V[i];
    vw[i] = pv / vv;
    up[i] = vw[i] + Math.sqrt(Math.max(0, p2 / vv - vw[i] ** 2));
  });
  same('vwap', 'VWAP', vw);
  same('vwap', 'Upper band #1', up, undefined, 1e-7);
  check('vwap · bands #2 and #3 are off until asked', plotOf('vwap', 'Upper band #2').values.every(Number.isNaN));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
