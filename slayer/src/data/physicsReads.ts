/* The five "physics" reads the study kept (research/physics/REPORT.md, "Ranked results" and "Recommendations"), as
   chart reads under their plain names. Pure functions over bars; StrikeChart maps them onto series and the proof
   (scripts/physics-reads-proof.ts) checks each one against hand-computed fixtures.

   - Volatility half-life → the HAR realised-vol forecast (MODEL). No new math: the forecast, the half-life and the
     next-hour read are data/volOutlook.ts's, the same fit behind Pulse's Vol outlook tile. This file only turns an
     annualised vol into a price band: a day's forecast spread over the minutes left in today's session (the session
     module's close, so an early close shrinks it), and the next hour's.
   - Potential energy → the dealer-gamma regime (CALCULATED): the sign of the book's minute net gamma under each bar,
     house sign (negative = dealers long gamma). Long gamma: moves tend to be damped. Short gamma: moves tend to extend.
     Never a pin or a pull (the study's #7).
   - Gravitational wave → the market's vol shock (CALCULATED): SPY's last 15 one-minute returns against its last 390
     (build_features.py lrv15 − lrv390), as a per-minute ratio, flagged on single names only.
   - Reynolds regime → the Kaufman efficiency ratio (CALCULATED): |Σ r| / Σ |r| over the last n returns (lib.py).
   - Viscosity → Amihud illiquidity (CALCULATED, display only): mean |r| / dollar volume over the last n bars with
     volume, at least a third of them (build_features.py: > 20 of 60), in bps of move per $1M traded.

   Returns follow lib.py returns(): regular-session bars only (the session module's open and that day's close, early
   closes included), a day's first return is its own open → close, the overnight gap is never a return, and the windows
   reach back across days the way the study's flattened returns do. Daily-or-longer bars have no session to cut: every
   bar counts and returns run close to close. */

import { isTradingDay, sessionCloseMinOn, sessionLengthOn } from '../core/calendar';
import { nyMinutes, nyParts } from '../core/nyTime';
import { REGULAR_OPEN_MIN } from '../core/session';

export interface PhysBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Trading days a year, and one-minute bars in a full session — data/volOutlook.ts's clock */
export const TRADING_DAYS = 252;
export const FULL_SESSION_BARS = 390;

export type PhysicsTag = 'CALCULATED' | 'MODEL';

export interface PhysicsRead {
  physics: string;
  plain: string;
  tag: PhysicsTag;
}

/** The names each read wears: the physics word, the plain name, and how it is made */
export const PHYSICS_READS = {
  harBand: { physics: 'Volatility Half-Life', plain: 'HAR vol forecast', tag: 'MODEL' },
  gammaRegime: { physics: 'Potential Energy', plain: 'Dealer gamma regime', tag: 'CALCULATED' },
  volShock: { physics: 'Gravitational Wave', plain: 'Market vol shock', tag: 'CALCULATED' },
  effRatio: { physics: 'Reynolds Regime', plain: 'Efficiency ratio', tag: 'CALCULATED' },
  amihud: { physics: 'Viscosity', plain: 'Amihud illiquidity', tag: 'CALCULATED' },
} as const satisfies Record<string, PhysicsRead>;

export type PhysicsKey = keyof typeof PHYSICS_READS;

/** The market's own names: the vol-shock flag is about the market reaching a single name, so it stays off these */
export const MARKET_NAMES: ReadonlySet<string> = new Set(['SPY', 'QQQ', 'SPX', 'SPXW', 'XSP', 'NDX', 'NDXP']);

const two = (n: number) => String(n).padStart(2, '0');
const isoOf = (sec: number) => {
  const p = nyParts(sec * 1000);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
};

/** Where a bar sits: its New York day and whether it opens inside that day's regular session */
export function regularOf(bars: readonly { time: number }[], mins: number): { day: string; reg: boolean }[] {
  if (mins >= 1440) return bars.map(b => ({ day: isoOf(b.time), reg: true }));
  return bars.map(b => {
    const day = isoOf(b.time);
    const [y, m, d] = day.split('-').map(Number);
    if (!isTradingDay(new Date(y, m - 1, d))) return { day, reg: false };
    const at = nyMinutes(b.time * 1000);
    return { day, reg: at >= REGULAR_OPEN_MIN && at < sessionCloseMinOn(day) };
  });
}

/** Each bar's log return, or null off the regular session. A day's first regular bar is its own open → close. */
export function regularReturns(bars: readonly PhysBar[], mins: number): (number | null)[] {
  const where = regularOf(bars, mins);
  const out: (number | null)[] = bars.map(() => null);
  let prev = -1;
  for (let i = 0; i < bars.length; i++) {
    if (!where[i].reg) continue;
    const b = bars[i];
    const sameDay = prev >= 0 && (mins >= 1440 || where[prev].day === where[i].day);
    const from = sameDay ? bars[prev].close : b.open;
    out[i] = from > 0 && b.close > 0 ? Math.log(b.close / from) : null;
    prev = i;
  }
  return out;
}

/** Kaufman efficiency ratio over the last n regular returns, 0 (all noise) … 1 (a straight line) */
export function efficiencyRatioSeries(bars: readonly PhysBar[], mins: number, n: number): (number | null)[] {
  const r = regularReturns(bars, mins);
  const win: number[] = [];
  return r.map(x => {
    if (x === null) return null;
    win.push(x);
    if (win.length > n) win.shift();
    if (win.length < n) return null;
    let sum = 0;
    let abs = 0;
    for (const v of win) {
      sum += v;
      abs += Math.abs(v);
    }
    return abs > 0 ? Math.abs(sum) / abs : null;
  });
}

/** Amihud illiquidity: mean |r| / (close × volume) over the last n regular bars that traded, bps per $1M */
export const AMIHUD_SCALE = 1e4 * 1e6;
export function amihudSeries(bars: readonly PhysBar[], mins: number, n: number): (number | null)[] {
  const r = regularReturns(bars, mins);
  const win: (number | null)[] = [];
  const need = Math.max(2, Math.floor(n / 3) + 1);
  return r.map((x, i) => {
    if (x === null) return null;
    const dv = bars[i].close * (bars[i].volume ?? 0);
    win.push(dv > 0 ? Math.abs(x) / dv : null);
    if (win.length > n) win.shift();
    if (win.length < n) return null;
    const ok = win.filter((v): v is number => v !== null);
    if (ok.length < need) return null;
    return (ok.reduce((a, v) => a + v, 0) / ok.length) * AMIHUD_SCALE;
  });
}

/** The market's vol shock on its own one-minute bars: √(mean r² of the last `short`) / √(mean r² of the last `long`).
    1 = the last quarter hour moved like the day; 2 = twice as fast. Null until `short` returns and a third of `long`. */
export const SHOCK_SHORT = 15;
export const SHOCK_LONG = 390;
export function volShockSeries(bars: readonly PhysBar[], short = SHOCK_SHORT, long = SHOCK_LONG): { time: number; value: number }[] {
  const r = regularReturns(bars, 1);
  const win: number[] = [];
  const out: { time: number; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const x = r[i];
    if (x === null) continue;
    win.push(x * x);
    if (win.length > long) win.shift();
    if (win.length < Math.max(short, Math.ceil(long / 3))) continue;
    const s = win.slice(-short).reduce((a, v) => a + v, 0) / short;
    const l = win.reduce((a, v) => a + v, 0) / win.length;
    if (l > 0) out.push({ time: bars[i].time, value: Math.sqrt(s / l) });
  }
  return out;
}

/** The shock as it stood at each chart bar's last minute; null off the regular session or when the market's tape is
    older than three bars (a flag from yesterday is not a flag) */
export function alignShock(bars: readonly { time: number }[], mins: number, shock: readonly { time: number; value: number }[]): (number | null)[] {
  const where = regularOf(bars, mins);
  const barSec = mins * 60;
  let k = 0;
  return bars.map((b, i) => {
    if (!where[i].reg || mins >= 1440) return null;
    const last = b.time + barSec - 60;
    while (k + 1 < shock.length && shock[k + 1].time <= last) k++;
    const p = shock[k];
    if (!p || p.time > last || last - p.time > 3 * Math.max(barSec, 60)) return null;
    return p.value;
  });
}

/* ---- the HAR band ---- */

/** A day's annualised vol, back to one session: ÷ √252 */
export const dayOfAnnual = (annual: number): number => annual / Math.sqrt(TRADING_DAYS);
/** An hour's annualised vol, back to one hour: ÷ √(252 × 390 / 60), data/volOutlook.ts annualiseHour's inverse */
export const hourOfAnnual = (annual: number): number => annual / Math.sqrt((TRADING_DAYS * FULL_SESSION_BARS) / 60);

/** The rest of the day's 1σ, as a fraction of price: the day's forecast spread evenly over the session's minutes, the
    share still to come. 0 at the bell; the whole day's at the open. */
export function restOfDaySigma(dayAnnual: number, minutesLeft: number, sessionMinutes: number): number {
  if (!(dayAnnual > 0) || !(sessionMinutes > 0)) return NaN;
  const share = Math.max(0, Math.min(1, minutesLeft / sessionMinutes));
  return dayOfAnnual(dayAnnual) * Math.sqrt(share);
}

export interface HarBand {
  up: (number | null)[];
  dn: (number | null)[];
  hourUp: (number | null)[];
  hourDn: (number | null)[];
}

/** The band on `liveDay`'s regular bars: close ± k σ for the rest of the day (the HAR forecast for that session) and
    ± k σ for the next hour (the hour read standing at the bar's last minute). Other days stay blank — the forecast is
    for one session, not a history. */
export function harBandSeries(
  bars: readonly PhysBar[],
  mins: number,
  liveDay: string,
  dayAnnual: number,
  hourAnnualAt: (endMs: number) => number | null,
  k = 1,
): HarBand {
  const out: HarBand = { up: [], dn: [], hourUp: [], hourDn: [] };
  const where = regularOf(bars, mins);
  const close = liveDay ? sessionCloseMinOn(liveDay) : 0;
  const len = liveDay ? sessionLengthOn(liveDay) : 0;
  const hourCache = new Map<number, number | null>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const on = mins < 1440 && where[i].reg && where[i].day === liveDay;
    if (!on) {
      out.up.push(null);
      out.dn.push(null);
      out.hourUp.push(null);
      out.hourDn.push(null);
      continue;
    }
    const endMin = nyMinutes(b.time * 1000) + mins;
    const s = restOfDaySigma(dayAnnual, close - endMin, len);
    out.up.push(Number.isFinite(s) ? b.close * (1 + k * s) : null);
    out.dn.push(Number.isFinite(s) ? b.close * (1 - k * s) : null);
    const endMs = (b.time + mins * 60) * 1000;
    let h = hourCache.get(endMin);
    if (h === undefined) {
      h = hourAnnualAt(endMs);
      hourCache.set(endMin, h);
    }
    const hs = h != null && h > 0 ? hourOfAnnual(h) : NaN;
    out.hourUp.push(Number.isFinite(hs) ? b.close * (1 + k * hs) : null);
    out.hourDn.push(Number.isFinite(hs) ? b.close * (1 - k * hs) : null);
  }
  return out;
}

/* ---- the gamma regime ---- */

/** Each regular bar's regime from the book's minute net gamma, house sign (negative = dealers long gamma = damped):
    +1 long, −1 short, null unknown (no minute under it, a zero, or off the regular session). */
export function gammaRegimeSeries(bars: readonly { time: number }[], mins: number, gammaPerBar: readonly (number | null)[]): (1 | -1 | null)[] {
  const where = regularOf(bars, mins);
  return bars.map((_, i) => {
    const g = gammaPerBar[i];
    if (!where[i].reg || g === null || !Number.isFinite(g) || g === 0) return null;
    return g < 0 ? 1 : -1;
  });
}

/** The regime in words — a vol regime, never a magnet */
export const regimeWords = (sign: 1 | -1): string => (sign > 0 ? 'Long gamma · moves tend to be damped' : 'Short gamma · moves tend to extend');

/** Signed distance from price to the flip, % of price: + when price is above the flip */
export const flipDistancePct = (spot: number, flip: number): number | null =>
  spot > 0 && flip > 0 && Number.isFinite(spot) && Number.isFinite(flip) ? ((spot - flip) / spot) * 100 : null;
