/* Compass's 56 model inputs, as pure functions of the bars, the quotes and the open interest the scan read. The
   column order is the trees' (public/models/*_all6months.txt). Nothing here reads a feed or the clock. */

import {
  R,
  Q,
  IV_LO,
  IV_HI,
  IV_BISECTS,
  IV_FEATURE_MIN,
  GEX_CORE,
  NO_SAME_DAY,
  CLS_INDEX,
  CLS_HIGHBETA,
  yearFrac,
  minutesLeftCol,
  ivFeature,
  greekVol,
  atmStrike,
} from './compassParams';
import type { OptionRight, Setup } from '../types/compass';

/** The upper normal tail beyond z > 3, by its continued fraction (evaluated from the 60th term back). */
function upperTail(z: number): number {
  let f = z;
  for (let k = 60; k >= 1; k--) f = z + k / f;
  return Math.exp(-0.5 * z * z - 0.91893853320467274178) / f;
}

/** The standard normal CDF to double precision: Marsaglia's series in the middle, the continued fraction in the
    tails. The app's 1e-7 approximation moves a solved vol in its sixth digit. */
export function cdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < -3) return x < -38 ? 0 : upperTail(-x);
  if (x > 3) return x > 38 ? 1 : 1 - upperTail(x);
  let s = x;
  let t = 0;
  let b = x;
  const q = x * x;
  let i = 1;
  while (s !== t) {
    t = s;
    i += 2;
    b *= q / i;
    s = t + b;
  }
  return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178);
}

export const INDEX = new Set(['SPX', 'SPXW', 'RUT', 'RUTW', 'VIX', 'XSP', 'NDX', 'NDXP']);
export const CLS_INDEX_SET = new Set<string>(CLS_INDEX);
export const CLS_HIGH_SET = new Set<string>(CLS_HIGHBETA);
export const UNDER: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };
export const CORE = new Set<string>(GEX_CORE);
export const NO_DAILY = new Set<string>(NO_SAME_DAY);
const SMH = ['NVDA', 'AMD', 'AVGO', 'MU', 'TSM', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'MRVL', 'QCOM', 'INTC', 'SMCI', 'ARM', 'ON', 'NXPI', 'ADI', 'TXN', 'SWKS', 'WOLF', 'COHR', 'STX', 'WDC', 'NTAP', 'SOXL', 'SOXS', 'NVDL'];
const BITO = ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'IREN', 'HUT', 'CIFR', 'WULF', 'CORZ', 'BITX', 'HOOD'];
const XLE = ['XOM', 'CVX', 'OXY', 'COP', 'DVN', 'EOG', 'APA', 'HAL', 'SLB', 'MPC', 'PSX', 'VLO', 'FANG', 'EQT', 'AR', 'BTU', 'OIH', 'XOP', 'USO', 'UCO'];
const GDX = ['NEM', 'GOLD', 'AEM', 'WPM', 'PAAS', 'AG', 'GDXJ', 'NUGT', 'JNUG', 'SLV', 'GLD', 'AGQ'];
const XLF = ['JPM', 'BAC', 'C', 'WFC', 'GS', 'MS', 'SCHW', 'AXP', 'COF', 'USB', 'TFC', 'KRE', 'FAS', 'DPST', 'ALLY', 'BLK', 'BX', 'KKR', 'APO'];
export const SECTOR_OF: Record<string, string> = {
  ...Object.fromEntries(SMH.map(t => [t, 'SMH'])),
  ...Object.fromEntries(BITO.map(t => [t, 'BITO'])),
  ...Object.fromEntries(XLE.map(t => [t, 'XLE'])),
  ...Object.fromEntries(GDX.map(t => [t, 'GDX'])),
  ...Object.fromEntries(XLF.map(t => [t, 'XLF'])),
};

export interface Bar { d: string; m: number; o: number; h: number; l: number; c: number; v: number }
export interface Curve { cum: Map<number, number[]>; five: Map<number, number[]> }
export interface PinBook { nodes: { strike: number; call: number; put: number }[]; oi: (strike: number, right: OptionRight) => number }

export function bsStates(S: number, K: number, T: number, sig: number, call: boolean): { px: number; de: number; ga: number; th: number; ve: number } {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sig > 0)) return { px: NaN, de: NaN, ga: NaN, th: NaN, ve: NaN };
  const vol = sig * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R - Q + 0.5 * sig * sig) * T) / vol;
  const d2 = d1 - vol;
  const df = Math.exp(-R * T);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const nd1 = cdf(d1);
  const px = call ? S * nd1 - K * df * cdf(d2) : K * df * cdf(-d2) - S * cdf(-d1);
  const de = call ? nd1 : nd1 - 1;
  const ga = pdf / (S * vol);
  const thetaYear = -(S * pdf * sig) / (2 * Math.sqrt(T)) - (call ? R * K * df * cdf(d2) : -R * K * df * cdf(-d2));
  /* Theta per calendar day: the convention the trees were trained on and the one the app shows. */
  return { px, de, ga, th: thetaYear / 365, ve: (S * pdf * Math.sqrt(T)) / 100 };
}

export function ivStates(price: number, S: number, K: number, T: number, call: boolean): number {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return NaN;
  let lo = IV_LO;
  let hi = IV_HI;
  const atLo = bsStates(S, K, T, lo, call).px;
  const atHi = bsStates(S, K, T, hi, call).px;
  if (!(atLo <= price) || !(atHi >= price)) return NaN;
  for (let i = 0; i < IV_BISECTS; i++) {
    const mid = (lo + hi) / 2;
    if (bsStates(S, K, T, mid, call).px > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function median(s: number[]): number {
  if (!s.length) return NaN;
  const a = [...s].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}

export function span(arr: number[], from: number, to: number, max: boolean): number {
  let y = NaN;
  const end = Math.min(to, arr.length);
  for (let i = from; i < end; i++) {
    if (!Number.isFinite(arr[i])) continue;
    y = Number.isFinite(y) ? (max ? Math.max(y, arr[i]) : Math.min(y, arr[i])) : arr[i];
  }
  return y;
}

export function tapeOf(rows: Bar[], index: boolean, minute: number, spot = NaN): { tt: number; S: number; op: number; H: number; L: number; orh: number; orl: number; rv30: number; rvPrev: number; compress: number; vwapZ: number; cum: number; last5: number; at: (back: number) => number } {
  const tt = minute - (9 * 60 + 30);
  const o = Array<number>(392).fill(NaN);
  const h = Array<number>(392).fill(NaN);
  const l = Array<number>(392).fill(NaN);
  const v = Array<number>(392).fill(0);
  let op = NaN;
  for (const b of rows) {
    const k = b.m - (9 * 60 + 30);
    if (k < 0 || k > 390) continue;
    /* Spot at minute t is that minute's first print. A missing minute stays missing. */
    if (!(o[k] > 0) && b.o > 0) o[k] = b.o;
    h[k] = b.h;
    l[k] = b.l;
    v[k] = b.v;
    if (k === 0 && b.o > 0) op = b.o;
  }
  const S = (() => {
    if (tt > 390 && spot > 0) return spot;
    /* Live, minute t's bar is not published until the minute ends: the price read at the mark is its first print. */
    if (tt >= 0 && tt <= 390 && !(o[tt] > 0) && spot > 0) return spot;
    const last = Math.min(Math.max(tt, 0), o.length - 1);
    for (let i = last; i >= 0; i--) if (o[i] > 0) return o[i];
    return spot > 0 ? spot : NaN;
  })();
  const logs = (from: number, to: number) => {
    const out: number[] = [];
    for (let i = Math.max(from + 1, 1); i < to; i++) {
      if (o[i] > 0 && o[i - 1] > 0) out.push(Math.log(o[i] / o[i - 1]));
    }
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
  /* Volume through the minute before t, and over its last five minutes: the same sums the prior sessions' curve
     holds at that minute (fetchCurve), so the two ratios compare like with like. */
  let total = 0;
  for (let i = 0; i < tt && i < v.length; i++) total += v[i] || 0;
  const cum = index ? NaN : total;
  let last5 = 0;
  for (let i = Math.max(0, tt - 5); i < tt && i < v.length; i++) last5 += v[i] || 0;
  /* High and low of minute t-1 are known at t. The current minute's high, low, and close are not. */
  return {
    tt,
    S,
    op,
    H: span(h, 0, tt, true),
    L: span(l, 0, tt, false),
    orh: span(h, 0, 30, true),
    orl: span(l, 0, 30, false),
    rv30,
    rvPrev,
    compress,
    vwapZ,
    cum,
    last5,
    at: (back: number) => (tt - back >= 0 && o[tt - back] > 0 ? o[tt - back] : NaN),
  };
}

export function yearsLeft(tt: number): number {
  return yearFrac(tt);
}

export function features(
  setup: Setup,
  minute: number,
  rows: Bar[],
  spy: Bar[],
  pd: { h: number; l: number; c: number } | null,
  atmIv: number,
  skew: number,
  sec: Bar[],
  curve: Curve | null,
  pin: PinBook | null,
  mids: { m5: number; m15: number },
  /** SPY's and the sector ETF's price at the mark, for a live scan whose minute bar is not in yet */
  marks: { spy?: number; sec?: number } = {},
): number[] | null {
  const indexName = INDEX.has(setup.ticker) || INDEX.has(UNDER[setup.ticker] ?? '');
  const tape = tapeOf(rows, indexName, minute, setup.spot ?? NaN);
  if (!(tape.S > 0)) return null;
  const x = Array.from({ length: 56 }, () => NaN);
  const s = tape.S;
  const op = tape.op;
  const ret = (back: number) => {
    const prev = tape.at(back);
    return s > 0 && prev > 0 ? s / prev - 1 : NaN;
  };
  const retOpen = s > 0 && op > 0 ? s / op - 1 : NaN;
  const ret5 = ret(5);
  const ret15 = ret(15);
  const ret60 = ret(60);
  const spyTape = tapeOf(spy, false, minute, marks.spy ?? NaN);
  const secTape = sec.length ? tapeOf(sec, false, minute, marks.sec ?? NaN) : null;
  const dir: number = setup.right === 'C' ? 1 : -1;
  const mid = setup.mid > 0 ? setup.mid : NaN;
  const was = (back: number) => (back === 5 ? mids.m5 : back === 15 ? mids.m15 : NaN);
  const T = yearsLeft(tape.tt);
  const call = setup.right === 'C';
  const solved = ivFeature(ivStates(mid, s, setup.strike, T, call));
  const vol = greekVol(solved, ivFeature(atmIv));
  const greek = bsStates(s, setup.strike, T, vol, call);
  const clock = 9 * 60 + 30 + tape.tt - (indexName ? 0 : 1);
  const hist = curve?.cum.get(clock) ?? [];
  const hist5 = curve?.five.get(clock) ?? [];
  const med = hist.length >= 5 ? median(hist) : NaN;
  const med5 = hist5.length >= 5 ? median(hist5) : NaN;
  const walls = pin ? oiWalls(pin, s) : { call: NaN, put: NaN };
  const mineOi = pin ? pin.oi(setup.strike, setup.right) : NaN;

  x[0] = tape.tt;
  x[1] = retOpen;
  x[2] = ret5;
  x[3] = ret15;
  x[4] = tape.tt >= 60 ? ret60 : NaN;
  x[5] = tape.H > tape.L ? (s - tape.L) / (tape.H - tape.L) : NaN;
  x[6] = tape.H > 0 && tape.L > 0 && op > 0 ? (tape.H - tape.L) / op : NaN;
  x[7] = tape.rv30;
  x[8] = tape.rv30 > 0 && tape.rvPrev > 0 ? tape.rv30 / tape.rvPrev : NaN;
  x[9] = tape.compress;
  x[10] = tape.tt < 30 || !Number.isFinite(tape.orh) ? NaN : s > tape.orh ? 1 : s < tape.orl ? -1 : 0;
  x[11] = tape.tt < 30 || !(op > 0) || !Number.isFinite(tape.orh) ? NaN : s > tape.orh ? (s - tape.orh) / op : s < tape.orl ? (s - tape.orl) / op : 0;
  x[12] = pd && pd.h > 0 ? s / pd.h - 1 : NaN;
  x[13] = pd && pd.l > 0 ? s / pd.l - 1 : NaN;
  x[14] = pd && pd.c > 0 && op > 0 ? op / pd.c - 1 : NaN;
  x[15] = minutesLeftCol(tape.tt);
  x[16] = indexName ? NaN : tape.vwapZ;
  x[17] = indexName || !(med > 0) ? NaN : tape.cum / med;
  x[18] = indexName || !(med5 > 0) ? NaN : tape.last5 / med5;
  x[19] = spyTape.S > 0 && spyTape.at(5) > 0 ? spyTape.S / spyTape.at(5) - 1 : NaN;
  x[20] = spyTape.S > 0 && spyTape.at(15) > 0 ? spyTape.S / spyTape.at(15) - 1 : NaN;
  x[21] = spyTape.S > 0 && spyTape.op > 0 ? spyTape.S / spyTape.op - 1 : NaN;
  x[22] = secTape && secTape.S > 0 && secTape.at(15) > 0 ? secTape.S / secTape.at(15) - 1 : NaN;
  x[23] = secTape && secTape.S > 0 && secTape.op > 0 ? secTape.S / secTape.op - 1 : NaN;
  x[24] = atmIv;
  x[25] = skew;
  x[26] = atmIv > 0 && tape.rv30 > 0 ? atmIv / (tape.rv30 * Math.sqrt(390 * 252)) : NaN;
  const core = CORE.has(setup.ticker);
  const net = core && pin ? netGexBn(pin, s, T, ivFeature(atmIv)) : NaN;
  x[27] = core ? net : NaN;
  x[28] = core ? walls.call : NaN;
  x[29] = core ? walls.put : NaN;
  x[30] = call ? setup.strike / s - 1 : 1 - setup.strike / s;
  x[31] = dir;
  x[32] = mid;
  x[33] = mid > 0 ? (setup.ask - setup.bid) / mid : NaN;
  x[34] = mid > 0 && was(5) > 0 ? mid / was(5) - 1 : NaN;
  x[35] = mid > 0 && was(15) > 0 ? mid / was(15) - 1 : NaN;
  x[36] = solved;
  x[37] = greek.de;
  x[38] = greek.ga;
  x[39] = greek.th;
  x[40] = greek.ve;
  x[41] = Number.isFinite(greek.ga) && Number.isFinite(greek.th) && greek.th !== 0 ? greek.ga / Math.abs(greek.th) : NaN;
  x[42] = Number.isFinite(greek.th) && mid > 0 ? greek.th / mid : NaN;
  x[43] = core && Number.isFinite(mineOi) ? mineOi : NaN;
  x[44] = CLS_INDEX_SET.has(setup.ticker) ? 1 : 0;
  x[45] = CLS_HIGH_SET.has(setup.ticker) ? 1 : 0;
  x[46] = retOpen * dir;
  x[47] = ret5 * dir;
  x[48] = ret15 * dir;
  x[49] = Number.isFinite(x[4]) ? (x[4] as number) * dir : NaN;
  x[50] = Number.isFinite(x[16]) ? (x[16] as number) * dir : NaN;
  x[51] = Number.isFinite(x[11]) ? (x[11] as number) * dir : NaN;
  x[52] = Number.isFinite(x[20]) ? (x[20] as number) * dir : NaN;
  x[53] = Number.isFinite(x[22]) ? (x[22] as number) * dir : NaN;
  x[54] = Number.isFinite(x[12]) ? (x[12] as number) * dir : NaN;
  x[55] = Number.isFinite(x[13]) ? (x[13] as number) * dir : NaN;
  return x;
}

export function oiWalls(pin: PinBook, S: number): { call: number; put: number } {
  if (!(S > 0)) return { call: NaN, put: NaN };
  let callK = NaN;
  let callOi = -1;
  let callGap = Infinity;
  let putK = NaN;
  let putOi = -1;
  let putGap = Infinity;
  for (const n of pin.nodes) {
    if (n.strike >= S && n.call > 0 && (n.call > callOi || (n.call === callOi && Math.abs(n.strike - S) < callGap))) {
      callOi = n.call;
      callK = n.strike;
      callGap = Math.abs(n.strike - S);
    }
    if (n.strike <= S && n.put > 0 && (n.put > putOi || (n.put === putOi && Math.abs(n.strike - S) < putGap))) {
      putOi = n.put;
      putK = n.strike;
      putGap = Math.abs(n.strike - S);
    }
  }
  return {
    call: callK > 0 ? callK / S - 1 : NaN,
    put: putK > 0 ? putK / S - 1 : NaN,
  };
}

export function netGexBn(pin: PinBook, S: number, T: number, atmIv: number): number {
  if (!(S > 0) || !(T > 0) || !(atmIv > IV_FEATURE_MIN)) return NaN;
  let sum = 0;
  for (const n of pin.nodes) {
    const g = bsStates(S, n.strike, T, atmIv, true).ga;
    if (!Number.isFinite(g)) continue;
    if (n.call > 0) sum += n.call * g * S * S * 0.01;
    if (n.put > 0) sum -= n.put * g * S * S * 0.01;
  }
  return sum / 1e9;
}

export function atmPair(rows: Setup[], spot: number, T: number): { iv: number; skew: number } {
  const strike = atmStrike(rows.map(s => s.strike), spot);
  if (!Number.isFinite(strike)) return { iv: NaN, skew: NaN };
  let call = NaN;
  let put = NaN;
  for (const s of rows) {
    if (Math.abs(s.strike - strike) > 0.001) continue;
    const iv = ivFeature(ivStates(s.mid, spot, s.strike, T, s.right === 'C'));
    if (!Number.isFinite(iv)) continue;
    if (s.right === 'C') call = iv;
    else put = iv;
  }
  const iv = call > 0 && put > 0 ? (call + put) / 2 : call > 0 ? call : put;
  const skew = call > 0 && put > 0 ? put - call : NaN;
  return { iv, skew };
}

/** The prior sessions' volume by minute: each day's cumulative volume at each minute, and its last five minutes. */
export function curveFrom(bars: readonly Bar[]): Curve | null {
  const days = new Map<string, Bar[]>();
  for (const b of bars) {
    const list = days.get(b.d);
    if (list) list.push(b);
    else days.set(b.d, [b]);
  }
  const cum = new Map<number, number[]>();
  const five = new Map<number, number[]>();
  for (const list of days.values()) {
    let run = 0;
    const totals: { m: number; total: number }[] = [];
    let back = 0;
    for (const b of list) {
      run += b.v;
      totals.push({ m: b.m, total: run });
    }
    for (let k = 0; k < totals.length; k++) {
      const { m, total } = totals[k];
      while (back + 1 <= k && totals[back + 1].m <= m - 5) back++;
      const prior = totals[back].m <= m - 5 ? totals[back].total : 0;
      const held = cum.get(m) ?? [];
      held.push(total);
      cum.set(m, held);
      const bag5 = five.get(m) ?? [];
      bag5.push(Math.max(0, total - prior));
      five.set(m, bag5);
    }
  }
  return cum.size ? { cum, five } : null;
}
