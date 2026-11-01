/* The rest of Pine's `ta.*` the M–Z built-ins need (TradingView parity, 2026-11-01): the true strength index, the rank
   correlation index, the nearest-rank percentile, VWAP with its deviation bands, and relative volume at time. Same
   rules as ta.ts — one stream per call site, `na` is NaN, a window holding NaN or not yet full answers NaN.
   builtins.ts binds names through SIG_MZ and runs them through callMZ, so it changes by two lines. */

import { cci, change, dmi, ema, hma, macd, rsi, vwma } from './ta';
import { PineError, type Tuple, type Value } from './types';

type State = Record<string, unknown>;
const sub = (s: State, k: string): State => (s[k] as State) ?? (s[k] = {});

/* ---- a plain window (ta.ts keeps its own private) --------------------------------- */

function windowOf(s: State, src: number, len: number): number[] | null {
  const buf = (s.w as number[]) ?? (s.w = []);
  buf.push(src);
  if (buf.length > len) buf.splice(0, buf.length - len);
  if (buf.length < len) return null;
  for (const v of buf) if (Number.isNaN(v)) return null;
  return buf;
}

/** `ta.tsi(source, short, long)` — the double-smoothed momentum over the double-smoothed absolute momentum, −1 to 1 */
export function tsi(s: State, src: number, shortLen: number, longLen: number): number {
  const prev = s.p as number | undefined;
  s.p = src;
  const pc = prev === undefined ? NaN : src - prev;
  const num = ema(sub(s, 'n2'), ema(sub(s, 'n1'), pc, longLen), shortLen);
  const den = ema(sub(s, 'd2'), ema(sub(s, 'd1'), Math.abs(pc), longLen), shortLen);
  return den === 0 ? NaN : num / den;
}

/** Ranks 1…n ascending, ties sharing the mean of the ranks they span */
function ranks(w: number[]): number[] {
  const idx = w.map((v, i) => i).sort((a, b) => w[a] - w[b]);
  const out = new Array<number>(w.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && w[idx[j + 1]] === w[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

/** `ta.rci(source, length)` — Spearman's rank correlation of price against time, ×100: +100 when every bar closed above the last */
export function rci(s: State, src: number, len: number): number {
  const w = windowOf(s, src, len);
  if (!w || len < 2) return NaN;
  const pr = ranks(w);
  let d2 = 0;
  for (let i = 0; i < len; i++) d2 += (i + 1 - pr[i]) ** 2;
  return (1 - (6 * d2) / (len * (len * len - 1))) * 100;
}

/** `ta.percentile_nearest_rank(source, length, percentage)` — the value at rank ⌈p/100 · n⌉ of the sorted window */
export function percentileNearestRank(s: State, src: number, len: number, pct: number): number {
  const w = windowOf(s, src, len);
  if (!w) return NaN;
  const sorted = [...w].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((pct / 100) * len));
  return sorted[Math.min(len, rank) - 1];
}

/** `ta.vwap(source, anchor, stdev_mult)` — [vwap, upper, lower]; the bands are the volume-weighted deviation of source about the vwap */
export function vwapBands(s: State, src: number, vol: number, sessionKey: string, mult: number): [number, number, number] {
  if (s.k !== sessionKey) {
    s.k = sessionKey;
    s.pv = 0;
    s.v = 0;
    s.p2v = 0;
  }
  if (!Number.isNaN(src) && !Number.isNaN(vol)) {
    s.pv = (s.pv as number) + src * vol;
    s.v = (s.v as number) + vol;
    s.p2v = (s.p2v as number) + src * src * vol;
  }
  const v = s.v as number;
  if (v === 0) return [NaN, NaN, NaN];
  const mid = (s.pv as number) / v;
  const sd = Math.sqrt(Math.max(0, (s.p2v as number) / v - mid * mid));
  return [mid, mid + mult * sd, mid - mult * sd];
}

interface SessionTape {
  key: string;
  start: number;
  /** offsets from the session's first bar, seconds, ascending */
  at: number[];
  cum: number[];
  vol: number[];
}

/** Relative volume at time (TradingView's ta library `relativeVolume`): this session's volume up to this bar's offset from the
    session's first bar, over the mean of the same offset in the last `length` sessions — [current, past mean, ratio].
    A past session with no bar at that offset answers with its last bar before it; fewer than `length` past sessions answer NaN. */
export function relativeVolume(s: State, time: number, vol: number, sessionKey: string, length: number, cumulative: boolean): [number, number, number] {
  const tapes = (s.t as SessionTape[]) ?? (s.t = []);
  let cur = tapes[tapes.length - 1];
  if (!cur || cur.key !== sessionKey) {
    cur = { key: sessionKey, start: time, at: [], cum: [], vol: [] };
    tapes.push(cur);
    if (tapes.length > length + 1) tapes.splice(0, tapes.length - (length + 1));
  }
  const v = Number.isNaN(vol) ? 0 : vol;
  const off = time - cur.start;
  const prevCum = cur.cum.length ? cur.cum[cur.cum.length - 1] : 0;
  cur.at.push(off);
  cur.cum.push(prevCum + v);
  cur.vol.push(v);
  const now = cumulative ? prevCum + v : v;
  const past = tapes.slice(0, -1);
  if (past.length < length) return [now, NaN, NaN];
  let sum = 0;
  for (const p of past) {
    /* the last bar at or before this offset */
    let lo = 0;
    let hi = p.at.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (p.at[m] <= off) {
        hit = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    sum += hit < 0 ? 0 : cumulative ? p.cum[hit] : p.vol[hit];
  }
  const mean = sum / length;
  return [now, mean, mean === 0 ? NaN : now / mean];
}

/* ---- O(1) windows for the ratings: a running sum and monotonic queues, NaN anywhere in the window answers NaN ---- */

class Roll {
  private buf: number[];
  private at = 0;
  private n = 0;
  private total = 0;
  private nans = 0;
  constructor(private len: number) {
    this.buf = new Array(len).fill(0);
  }
  /** Push and answer the window's mean */
  mean(v: number): number {
    return this.sum(v) / this.len;
  }
  sum(v: number): number {
    if (this.n >= this.len) {
      const old = this.buf[this.at];
      if (Number.isNaN(old)) this.nans--;
      else this.total -= old;
    }
    this.buf[this.at] = v;
    if (Number.isNaN(v)) this.nans++;
    else this.total += v;
    this.at = (this.at + 1) % this.len;
    this.n++;
    /* short windows are re-added every bar, oldest first as a plain mean adds them, so a tie (a stochastic pinned at
       100 three bars running) stays an exact tie; long ones are re-added now and then, so the running total never drifts */
    if (this.len <= 34 || this.n % (this.len * 64) === 0) {
      let t = 0;
      for (let k = 0; k < this.len; k++) {
        const x = this.buf[(this.at + k) % this.len];
        if (!Number.isNaN(x)) t += x;
      }
      this.total = t;
    }
    return this.n < this.len || this.nans > 0 ? NaN : this.total;
  }
}

class Extreme {
  private q: { i: number; v: number }[] = [];
  private n = 0;
  private lastNan = -1;
  constructor(
    private len: number,
    private max: boolean
  ) {}
  push(v: number): number {
    const i = this.n++;
    if (Number.isNaN(v)) this.lastNan = i;
    else {
      while (this.q.length && (this.max ? this.q[this.q.length - 1].v <= v : this.q[this.q.length - 1].v >= v)) this.q.pop();
      this.q.push({ i, v });
    }
    while (this.q.length && this.q[0].i <= i - this.len) this.q.shift();
    if (this.n < this.len || this.lastNan > i - this.len) return NaN;
    return this.q[0].v;
  }
}

const roll = (s: State, k: string, len: number): Roll => (s[k] as Roll) ?? (s[k] = new Roll(len));
const extreme = (s: State, k: string, len: number, max: boolean): Extreme => (s[k] as Extreme) ?? (s[k] = new Extreme(len, max));

/* ---- technical ratings ------------------------------------------------------------- */

interface Bar5 {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** TradingView's Technical Ratings (its TechnicalRating library's all-in-one call): fifteen averages and eleven oscillators
    each vote +1, 0 or −1 by the rules on TradingView's help page; [overall, averages, oscillators], each the mean of its
    votes. Native because the 26 streams cost too much walked bar by bar inside a 200 ms budget. The trend the Stoch RSI
    and Bull Bear Power votes need — which the page does not define — is the close against its 50-bar simple average. */
export function technicalRating(s: State, b: Bar5): [number, number, number] {
  const { high, low, close, volume } = b;
  const hl2 = (high + low) / 2;
  const prev = (s.prev as Record<string, number>) ?? (s.prev = {});
  const sign = (m: number) => (Number.isNaN(m) ? NaN : Math.sign(close - m));
  const don = (k: string, len: number) => (extreme(s, k + 'l', len, false).push(low) + extreme(s, k + 'h', len, true).push(high)) / 2;
  /* the averages */
  const sma50 = roll(s, 's50', 50).mean(close);
  let maSum = sign(sma50);
  for (const n of [10, 20, 30, 100, 200]) maSum += sign(roll(s, 's' + n, n).mean(close));
  for (const n of [10, 20, 30, 50, 100, 200]) maSum += sign(ema(sub(s, 'e' + n), close, n));
  maSum += sign(hma(sub(s, 'hma'), close, 9));
  maSum += sign(vwma(sub(s, 'vwma'), close, volume, 20));
  const conv = don('c', 9);
  const base = don('b', 26);
  const spanA = (conv + base) / 2;
  const spanB = don('sb', 52);
  const vote = (buy: boolean, sell: boolean) => (buy ? 1 : sell ? -1 : 0);
  maSum += Number.isNaN(spanB) ? NaN : vote(spanA > spanB && base > spanA && conv > base && close > conv, spanA < spanB && base < spanA && conv < base && close < conv);
  const maRating = maSum / 15;
  /* the oscillators */
  const up = close > sma50;
  const down = close < sma50;
  const r = rsi(sub(s, 'rsi'), close, 14);
  const rV = Number.isNaN(prev.rsi ?? NaN) ? NaN : vote(r < 30 && r > prev.rsi, r > 70 && r < prev.rsi);
  const hh14 = extreme(s, 'hh14', 14, true).push(high);
  const ll14 = extreme(s, 'll14', 14, false).push(low);
  const st = (100 * (close - ll14)) / (hh14 - ll14);
  const k = roll(s, 'k', 3).mean(st);
  const d = roll(s, 'd', 3).mean(k);
  const stV = Number.isNaN(d) ? NaN : vote(k < 20 && d < 20 && k > d, k > 80 && d > 80 && k < d);
  const c = cci(sub(s, 'cci'), close, 20);
  const cV = Number.isNaN(prev.cci ?? NaN) ? NaN : vote(c < -100 && c > prev.cci, c > 100 && c < prev.cci);
  const [dip, dim, adx] = dmi(sub(s, 'dmi'), high, low, close, 14, 14);
  const aV = Number.isNaN(prev.adx ?? NaN) ? NaN : vote(adx > 20 && dip > dim && adx > prev.adx, adx > 20 && dip < dim && adx < prev.adx);
  const ao = roll(s, 'ao5', 5).mean(hl2) - roll(s, 'ao34', 34).mean(hl2);
  const ao1 = prev.ao ?? NaN;
  const ao2 = prev.ao1 ?? NaN;
  const aoV = Number.isNaN(ao2) ? NaN : vote((ao > 0 && ao1 < 0) || (ao > 0 && ao1 > 0 && ao > ao1 && ao2 > ao1), (ao < 0 && ao1 > 0) || (ao < 0 && ao1 < 0 && ao < ao1 && ao2 < ao1));
  const mom = change(sub(s, 'mom'), close, 10);
  const mV = Number.isNaN(prev.mom ?? NaN) ? NaN : vote(mom > prev.mom, mom < prev.mom);
  const [ml, ms] = macd(sub(s, 'macd'), close, 12, 26, 9);
  const macdV = Number.isNaN(ms) ? NaN : vote(ml > ms, ml < ms);
  const rh = extreme(s, 'rh', 14, true).push(r);
  const rl = extreme(s, 'rl', 14, false).push(r);
  const sk = roll(s, 'sk', 3).mean((100 * (r - rl)) / (rh - rl));
  const sd = roll(s, 'sd', 3).mean(sk);
  const srV = Number.isNaN(sd) ? NaN : vote(down && sk < 20 && sd < 20 && sk > sd, up && sk > 80 && sd > 80 && sk < sd);
  const wr = st - 100;
  const wV = Number.isNaN(prev.wr ?? NaN) ? NaN : vote(wr < -80 && wr > prev.wr, wr > -20 && wr < prev.wr);
  const e13 = ema(sub(s, 'e13'), close, 13);
  const bull = high - e13;
  const bear = low - e13;
  const bV = Number.isNaN(prev.bear ?? NaN) ? NaN : vote(up && bear < 0 && bear > prev.bear, down && bull > 0 && bull < prev.bull);
  const pc = prev.close ?? NaN;
  const bp = close - Math.min(low, pc);
  const trr = Math.max(high, pc) - Math.min(low, pc);
  const avg = (n: number) => roll(s, 'bp' + n, n).sum(bp) / roll(s, 'tr' + n, n).sum(trr);
  const uo = (100 * (4 * avg(7) + 2 * avg(14) + avg(28))) / 7;
  const uV = Number.isNaN(uo) ? NaN : vote(uo > 70, uo < 30);
  const oscRating = (rV + stV + cV + aV + aoV + mV + macdV + srV + wV + bV + uV) / 11;
  s.prev = { rsi: r, cci: c, adx, ao, ao1, mom, wr, bear, bull, close };
  return [(maRating + oscRating) / 2, maRating, oscRating];
}

/* ---- the binding builtins.ts hands over ------------------------------------------- */

/** Argument names, in order */
export const SIG_MZ: Record<string, string[]> = {
  'ta.tsi': ['source', 'short_length', 'long_length'],
  'ta.rci': ['source', 'length'],
  'ta.percentile_nearest_rank': ['source', 'length', 'percentage'],
  'ta.relativeVolume': ['length', 'isCumulative'],
  'ta.technicalRating': [],
};

interface CtxMZ extends Bar5 {
  time: number;
  sessionKey: string;
}

const numOf = (v: Value | undefined): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
const tuple = (items: number[]): Tuple => ({ tuple: items });

function lenOf(a: Record<string, Value>, key: string, callee: string, line: number): number {
  if (!(key in a)) throw new PineError(`${callee} needs its "${key}"`, line);
  const v = numOf(a[key]);
  if (Number.isNaN(v) || v < 1) throw new PineError(`${callee}: "${key}" must be a whole number of at least 1`, line);
  return Math.floor(v);
}
function srcOf(a: Record<string, Value>, key: string, callee: string, line: number): number {
  if (!(key in a)) throw new PineError(`${callee} needs its "${key}"`, line);
  return numOf(a[key]);
}

/** Runs an M–Z addition; `undefined` when the name is not one of them */
export function callMZ(ctx: CtxMZ, callee: string, a: Record<string, Value>, state: State, line: number): Value | undefined {
  switch (callee) {
    case 'ta.tsi':
      return tsi(state, srcOf(a, 'source', callee, line), lenOf(a, 'short_length', callee, line), lenOf(a, 'long_length', callee, line));
    case 'ta.rci':
      return rci(state, srcOf(a, 'source', callee, line), lenOf(a, 'length', callee, line));
    case 'ta.percentile_nearest_rank':
      return percentileNearestRank(state, srcOf(a, 'source', callee, line), lenOf(a, 'length', callee, line), srcOf(a, 'percentage', callee, line));
    case 'ta.relativeVolume':
      return tuple(relativeVolume(state, ctx.time, ctx.volume, ctx.sessionKey, lenOf(a, 'length', callee, line), 'isCumulative' in a ? a.isCumulative === true || numOf(a.isCumulative) === 1 : true));
    case 'ta.technicalRating':
      return tuple(technicalRating(state, ctx));
  }
  return undefined;
}
