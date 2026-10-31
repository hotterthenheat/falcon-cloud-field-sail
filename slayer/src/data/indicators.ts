import type { Candle } from '../types/market';
import { sessionOccurrence, type DeskSession } from './deskSession';
import { nyTradingDay } from '../core/nyTime';

/*
==================================================
  SLAYER TERMINAL - INDICATOR SERIES (data/indicators.ts)

  Every indicator the tape draws, as plain numbers.
==================================================

  WHY THEY LEFT THE CHART.

  Both were written inside `StrikeChart`'s indicator effect, as a closure over
  the bars it had just aggregated. That was fine while the chart was the only
  thing that had an opinion about them. T-12's confluence strip has to say
  whether price is above its EMA21 and its VWAP on five timeframes at once,
  and a second copy of these formulas would be a strip that can disagree with
  the lines it is summarising — the same "written twice, and the copies
  disagreed" that `core/walls.ts` exists because of.

  So: one generator, and the chart maps the numbers onto its own series.
  Nothing here knows about charts, so `npm test` can hold both to a fixture.

  ALIGNED TO `bars`, one value per bar. The EMA is TradingView's (Pine v5
  ta.ema): null through bar `period − 2`, the SMA of the first `period`
  closes on bar `period − 1`, then α = 2/(period+1). The Pine interpreter
  (core/pine/ta.ts) and these lines are one convention, so a script's
  ta.ema(close, 21) and the toolbar's EMA21 draw the same line.
*/

/**
 * How many bars an EMA needs behind it before it has a value: one period —
 * the SMA seed lands on bar `period − 1` (emaSeries, Pine's ta.ema).
 */
export const emaWarmup = (period: number): number => period;

/** Pine's ta.ema over a number stream: NaN/null in → that bar null; the seed is the SMA of the first `period` values. */
function emaOf(xs: readonly (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null);
  if (period < 1) return out;
  const k = 2 / (period + 1);
  let ema: number | null = null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x == null || !Number.isFinite(x)) {
      /* before the seed a gap restarts the window, as Pine's sma does (a window holding na is na) */
      if (ema == null) {
        sum = 0;
        n = 0;
      }
      continue;
    }
    if (ema == null) {
      sum += x;
      n += 1;
      if (n > period) sum -= (xs[i - period] as number);
      if (n >= period) {
        ema = sum / period;
        out[i] = ema;
      }
      continue;
    }
    ema = x * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/**
 * Exponential moving average of closes, TradingView's: null through bar
 * `period − 2`, seeded on bar `period − 1` with the SMA of the first
 * `period` closes (Pine v5 ta.ema), α = 2/(period+1) after. The tape used
 * to seed at the first close, which drew a different left edge from the
 * same EMA in a Pine script on the same pane.
 */
export function emaSeries(bars: readonly Candle[], period: number): (number | null)[] {
  return emaOf(bars.map(b => b.close), period);
}

/**
 * THE TRADING DAY a bar belongs to, as a number (yyyymmdd): its New York
 * date, and an evening bar from 20:00 on belongs to the NEXT date — the
 * overnight tape leads into the session it opens, so 20:00–04:00, the
 * premarket, the cash session and the after-hours are one day and the
 * overnight is never cut at midnight.
 */
export const tradingDayKey = (timeSec: number): number => nyTradingDay(timeSec * 1000);

/**
 * WHERE A SESSION STARTS — index 0, and every bar whose trading day
 * (tradingDayKey: the New York date, the overnight from 20:00 joined to the
 * day it opens) differs from the bar before it.
 *
 * It used to be a GAP of more than 1.5 bars, so one missing 1-minute bar —
 * a quiet minute, a halt, a dropped read — started a new session mid-day
 * and reset the VWAP, its bands, the flow and gamma VWAPs, the volume
 * profile and the session ATR. A day is a date, not a silence.
 * `barMinutes` is kept for the callers; the day does not depend on it.
 *
 * ONE RULE, because many things need it: the VWAP re-anchors here, and
 * T-6's session levels cut the prior day here. Two copies would be a prior
 * high taken from a different day than the VWAP was anchored to.
 */
export function sessionStarts(bars: readonly Candle[], _barMinutes?: number): number[] {
  if (bars.length === 0) return [];
  const out = [0];
  let prev = tradingDayKey(bars[0].time);
  for (let i = 1; i < bars.length; i++) {
    const key = tradingDayKey(bars[i].time);
    if (key !== prev) out.push(i);
    prev = key;
  }
  return out;
}

/** Where the session you picked opens again. A halt is not a new session. Overnight's morning belongs to the evening it started. */
function anchorsOf(bars: readonly { time: number }[], barMinutes: number, session?: DeskSession): Set<number> {
  if (!session || bars.length === 0) return new Set(sessionStarts(bars as Candle[], barMinutes));
  const out = [0];
  let prev = sessionOccurrence(bars[0].time, session);
  for (let i = 1; i < bars.length; i++) {
    const key = sessionOccurrence(bars[i].time, session);
    if (key !== prev) {
      out.push(i);
      prev = key;
    }
  }
  return new Set(out);
}

/**
 * Session-anchored VWAP: cumulative typical×volume over cumulative volume,
 * reset at every session start.
 *
 * Falls back to the close on a bar with no volume behind it, so the series is
 * a price throughout rather than dropping to zero on a dead open.
 */
export function vwapSeries(bars: readonly Candle[], barMinutes: number, session?: DeskSession): number[] {
  const starts = anchorsOf(bars, barMinutes, session);
  const out: number[] = [];
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    /* `i > 0` because index 0 is a session start too and there is nothing to
       reset before the first bar — resetting there is a no-op, but saying so
       keeps this loop reading the same as it did before the rule moved out. */
    if (i > 0 && starts.has(i)) {
      pv = 0;
      vol = 0;
    }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
    out.push(vol > 0 ? pv / vol : b.close);
  }
  return out;
}

/*
  ──────────────────────────────────────────────────────────────────────────
  THE T-4 SET. Two conventions live in this file now, and the difference is
  deliberate:

  · vwapSeries is SEEDED — full-length, no nulls — because a session's VWAP
    exists from its first bar.
  · emaSeries and everything below is WARMED UP — null until the window it claims to
    summarise actually exists. An RSI printed off three bars is a number the
    app cannot source, and the chart maps a null to whitespace, not to zero.
  ──────────────────────────────────────────────────────────────────────────
*/

/**
 * Wilder's RSI. Null through index `period` − the first value sits ON the
 * bar that completes the seed window (period changes need period+1 bars).
 * A lossless window reads 100 and a gainless one 0, as Pine's ta.rsi does.
 */
export function rsiSeries(bars: readonly Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (period < 1 || bars.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    if (ch >= 0) g += ch;
    else l -= ch;
  }
  g /= period;
  l /= period;
  /* Pine v5 ta.rsi: no loss reads 100, no gain 0 — a flat window too reads 100, as TradingView draws it */
  const rsiOf = () => (l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l));
  out[period] = rsiOf();
  for (let i = period + 1; i < bars.length; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    g = (g * (period - 1) + Math.max(0, ch)) / period;
    l = (l * (period - 1) + Math.max(0, -ch)) / period;
    out[i] = rsiOf();
  }
  return out;
}

export interface MacdSeries {
  macd: (number | null)[];
  signal: (number | null)[];
  /** macd − signal, the bars under the lines. */
  hist: (number | null)[];
}

/**
 * MACD, TradingView's (Pine v5 ta.macd): the fast and slow EMAs as
 * emaSeries draws them, the line from bar `slow − 1` where both exist, the
 * signal the same SMA-seeded EMA of the line (first on bar
 * `slow + signal − 2`), the histogram line − signal.
 */
export function macdSeries(bars: readonly Candle[], fast = 12, slow = 26, signal = 9): MacdSeries {
  const n = bars.length;
  const ef = emaSeries(bars, fast);
  const es = emaSeries(bars, slow);
  const macd: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const f = ef[i];
    const s = es[i];
    if (f != null && s != null) macd[i] = f - s;
  }
  const sig = emaOf(macd, signal);
  const hist = macd.map((m, i) => (m != null && sig[i] != null ? m - (sig[i] as number) : null));
  return { macd, signal: sig, hist };
}

export interface BollingerSeries {
  basis: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

/**
 * Bollinger bands: SMA(period) ± k·σ, population σ over the same window.
 * Null until a full window exists.
 */
export function bollingerSeries(bars: readonly Candle[], period = 20, k = 2): BollingerSeries {
  const n = bars.length;
  const basis: (number | null)[] = new Array(n).fill(null);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const mid = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (bars[j].close - mid) ** 2;
    const sd = Math.sqrt(v / period);
    basis[i] = mid;
    upper[i] = mid + k * sd;
    lower[i] = mid - k * sd;
  }
  return { basis, upper, lower };
}

/** Plain SMA of closes, null until a full window exists. */
export function smaSeries(bars: readonly Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * The volume-weighted σ around the session VWAP, per bar — the ruler the
 * VWAP bands are k of. Same anchor rule as the VWAP itself (sessionStarts),
 * computed off the same typical prices, so the band and its centre line
 * cannot disagree about where the session began. σ is null on a bar with no
 * volume behind it yet — a band of width zero would claim certainty, not
 * absence.
 */
export function vwapSigmaSeries(bars: readonly Candle[], barMinutes: number, session?: DeskSession): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length === 0) return out;
  const starts = anchorsOf(bars, barMinutes, session);
  let cumV = 0;
  let cumPV = 0;
  let cumP2V = 0;
  for (let i = 0; i < bars.length; i++) {
    if (starts.has(i)) {
      cumV = 0;
      cumPV = 0;
      cumP2V = 0;
    }
    const typ = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumV += bars[i].volume;
    cumPV += typ * bars[i].volume;
    cumP2V += typ * typ * bars[i].volume;
    if (cumV > 0) {
      const vwap = cumPV / cumV;
      out[i] = Math.sqrt(Math.max(0, cumP2V / cumV - vwap * vwap));
    }
  }
  return out;
}

/**
 * ATR over the DISPLAYED bars, TradingView's (Pine v5 ta.atr = ta.rma of
 * ta.tr(true)): the first bar's true range is its high − low, the seed is
 * the mean of the first `period` true ranges, on bar `period − 1`, then
 * Wilder's (atr·(n−1) + tr)/n. The sub-pane's line, in this pane's own
 * interval, distinct from data/atr.ts's session ATR (T-19's ruler): a
 * 5-minute pane's ATR answers "how big are 5-minute bars lately", the
 * ruler answers "how big is a day". Null through the seed window.
 */
export function atrBarSeries(bars: readonly Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (period < 1 || bars.length < period) return out;
  const tr = (i: number) =>
    i === 0
      ? bars[0].high - bars[0].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr(i);
  atr /= period;
  out[period - 1] = atr;
  for (let i = period; i < bars.length; i++) {
    atr = (atr * (period - 1) + tr(i)) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Session price weighted by `weight`, not by shares.
 *
 * A bar whose weight is missing or not positive does not move the average
 * and does not zero it. Before the first weight of a session the value is
 * null. Callers that wanted a share VWAP already have `vwapSeries`.
 */
export function weightedSessionSeries(
  bars: readonly Candle[],
  barMinutes: number,
  weight: readonly (number | null)[],
  session?: DeskSession,
): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length === 0 || weight.length !== bars.length) return out;
  const starts = anchorsOf(bars, barMinutes, session);
  let pv = 0;
  let w = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0 && starts.has(i)) {
      pv = 0;
      w = 0;
    }
    const p = weight[i];
    if (p != null && p > 0) {
      const typical = (bars[i].high + bars[i].low + bars[i].close) / 3;
      pv += typical * p;
      w += p;
    }
    if (w > 0) out[i] = pv / w;
  }
  return out;
}

/**
 * Session price weighted by option premium, not shares.
 *
 * `premium[i]` is the dollars of calls plus puts that landed on bar i.
 * A quiet bar does not move the average and does not zero it. Before the
 * first print of a session the value is null — a share VWAP stood in for
 * a flow VWAP would be a different line wearing this one's name.
 */
export function flowVwapSeries(bars: readonly Candle[], barMinutes: number, premium: readonly number[], session?: DeskSession): (number | null)[] {
  return weightedSessionSeries(bars, barMinutes, premium, session);
}

/**
 * The book's minute gamma has to actually change. A flat path, or one
 * print carried across a few bars, is a plain average wearing a new name.
 * Eight real prints, and the middle of the path has to move by at least
 * two percent of its own typical size.
 */
export function gammaMoves(gamma: readonly (number | null)[]): boolean {
  const abs: number[] = [];
  for (const g of gamma) if (g != null && Number.isFinite(g) && g !== 0) abs.push(Math.abs(g));
  if (abs.length < 8) return false;
  abs.sort((a, b) => a - b);
  const mid = abs[Math.floor(abs.length / 2)];
  if (!(mid > 0)) return false;
  const lo = abs[Math.floor(abs.length * 0.1)];
  const hi = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))];
  return (hi - lo) / mid >= 0.02;
}

/**
 * An EMA of the close whose speed follows the book's net gamma.
 *
 * The base is a 21-bar EMA. A bar whose |gamma| is the session's typical
 * size takes that speed. A heavier book speeds it up; a quiet book slows
 * it down. No gamma on a bar holds the last average instead of inventing
 * a speed. The whole line stays null until the path moves — a constant
 * gamma is just the EMA.
 */
export function gammaEmaSeries(bars: readonly Candle[], gamma: readonly (number | null)[], period = 21): (number | null)[] {
  const n = bars.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n === 0 || gamma.length !== n || period < 1 || !gammaMoves(gamma)) return out;
  const abs: number[] = [];
  for (const g of gamma) if (g != null && Number.isFinite(g) && g !== 0) abs.push(Math.abs(g));
  abs.sort((a, b) => a - b);
  const mid = abs[Math.floor(abs.length / 2)];
  if (!(mid > 0)) return out;
  const base = 2 / (period + 1);
  let ema: number | null = null;
  let seen = 0;
  const warm = Math.min(period, 8);
  for (let i = 0; i < n; i++) {
    const g = gamma[i];
    if (g == null || !Number.isFinite(g) || g === 0) {
      if (ema != null && seen >= warm) out[i] = ema;
      continue;
    }
    const ratio = Math.min(4, Math.max(0.25, Math.abs(g) / mid));
    const k = Math.min(0.8, Math.max(0.02, base * ratio));
    ema = ema == null ? bars[i].close : bars[i].close * k + ema * (1 - k);
    seen += 1;
    if (seen >= warm) out[i] = ema;
  }
  return out;
}

/**
 * Session price weighted by the size of net gamma, not by shares and not
 * by an EMA. Same honesty rule as the gamma EMA: a path that does not
 * move is a time average, and it stays blank.
 */
export function gammaVwapSeries(bars: readonly Candle[], barMinutes: number, gamma: readonly (number | null)[], session?: DeskSession): (number | null)[] {
  if (!gammaMoves(gamma)) return new Array(bars.length).fill(null);
  const weight = gamma.map(g => (g != null && Number.isFinite(g) && g !== 0 ? Math.abs(g) : null));
  return weightedSessionSeries(bars, barMinutes, weight, session);
}

/** Premium per bar, keyed on the bar's own clock. A bar with no prints is 0, not a guess. */
export function alignPremium(
  bars: readonly { time: number }[],
  flow: readonly { time: number; callPrem: number; putPrem: number }[],
  barSec: number,
): number[] {
  const sides = alignSides(bars, flow, barSec);
  return sides.call.map((c, i) => c + sides.put[i]);
}

/** Call premium and put premium, apart, on the same bars. A side that did not print is 0. */
export function alignSides(
  bars: readonly { time: number }[],
  flow: readonly { time: number; callPrem: number; putPrem: number }[],
  barSec: number,
): { call: number[]; put: number[] } {
  const step = Math.max(1, Math.floor(barSec));
  const key = (t: number) => Math.floor(t / step) * step;
  const call = new Map<number, number>();
  const put = new Map<number, number>();
  for (const f of flow) {
    const c = f.callPrem > 0 ? f.callPrem : 0;
    const p = f.putPrem > 0 ? f.putPrem : 0;
    if (!(c > 0) && !(p > 0)) continue;
    const k = key(f.time);
    if (c > 0) call.set(k, (call.get(k) ?? 0) + c);
    if (p > 0) put.set(k, (put.get(k) ?? 0) + p);
  }
  return {
    call: bars.map(b => call.get(key(b.time)) ?? 0),
    put: bars.map(b => put.get(key(b.time)) ?? 0),
  };
}

/** Net gamma of the last snapshot that falls on the bar. Null when the book has gone quiet for more than a few bars. */
export function alignGamma(
  bars: readonly { time: number }[],
  snaps: readonly { time: number; levels: readonly { value: number }[] }[],
  barSec: number,
): (number | null)[] {
  const nets = snaps.map(s => ({
    time: s.time,
    value: s.levels.reduce((a, l) => a + (Number.isFinite(l.value) ? l.value : 0), 0),
  }));
  return alignScalar(bars, nets, barSec);
}

/**
 * The last scalar that falls on the bar. A print older than three bar
 * widths is not carried forward — one snapshot stretched across the
 * session would be a flat line claiming to be a path.
 */
export function alignScalar(
  bars: readonly { time: number }[],
  points: readonly { time: number; value: number }[] | null,
  barSec: number,
): (number | null)[] {
  if (!points || points.length === 0) return bars.map(() => null);
  const step = Math.max(1, Math.floor(barSec));
  const sorted = points.filter(p => Number.isFinite(p.time) && Number.isFinite(p.value)).sort((a, b) => a.time - b.time);
  if (!sorted.length) return bars.map(() => null);
  let j = 0;
  let last: number | null = null;
  let lastT = -Infinity;
  return bars.map(b => {
    /* the bar is [time, time + step): a point stamped on the next bar's open is the next bar's */
    const end = b.time + step;
    while (j < sorted.length && sorted[j].time < end) {
      last = sorted[j].value;
      lastT = sorted[j].time;
      j += 1;
    }
    if (last == null || b.time - lastT > step * 3) return null;
    return last;
  });
}

