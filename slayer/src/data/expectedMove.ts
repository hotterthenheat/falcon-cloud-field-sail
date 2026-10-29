import type { Candle } from '../types/market';

/*
  The expected-move cone and the one σ every Pinpoint odd reads. The vendor's implied move is the ATM straddle, which
  for a normal move is σ·√(2/π) ≈ 0.80σ; a vendor vol is a calendar-year vol, so one session carries one calendar
  day's variance. The cone, the reach odds, the corridor and the close odds all take their σ from here.
*/

/** 1σ per dollar of ATM straddle: σ = straddle·√(π/2) ≈ 1.2533 (dollars → dollars; E|X| = σ·√(2/π) for a normal X;
    UW SPY 10/29 implied_move 5.09 against the 772 straddle mid 5.26). */
export const STRADDLE_TO_SIGMA = Math.sqrt(Math.PI / 2);
/** Straddle ÷ (S·σ·√T) for a normal move, √(2/π) ≈ 0.798 — the straddle fit's k when the vendor's rows give none. */
export const STRADDLE_K = Math.sqrt(2 / Math.PI);
/** Session minutes, and the calendar days a vendor vol is annualised over (one session = one calendar day of variance). */
const SESSION_MIN = 390;
const VOL_YEAR_DAYS = 365;

/** One standard move, dollars, from the vendor's straddle (its implied move), dollars. */
export const sigmaFromStraddle = (straddle: number): number => (straddle > 0 ? straddle * STRADDLE_TO_SIGMA : 0);

/** 1σ as a fraction of price over `minutes` session minutes, for an annualised calendar-year vol (0.2 = 20%). */
export function sigmaFracOver(iv: number, minutes: number): number {
  return iv > 0 && minutes > 0 ? iv * Math.sqrt(minutes / (SESSION_MIN * VOL_YEAR_DAYS)) : 0;
}

/** One session's 1σ, dollars, off an annualised calendar-year vol — null without a price or a vol. */
export function daySigmaOfIv(spot: number, iv: number): number | null {
  return spot > 0 && iv > 0 ? spot * sigmaFracOver(iv, SESSION_MIN) : null;
}

/** 1σ dollars over the session minutes left, from one full session's 1σ (variance spread evenly over the session). */
export function sigmaOverMinutes(sigmaDay: number, minutes: number): number {
  return sigmaDay > 0 ? sigmaDay * Math.sqrt(Math.min(SESSION_MIN, Math.max(0, minutes)) / SESSION_MIN) : 0;
}

/** Odds price touches `level` before the horizon, for a driftless move with 1σ `sigma` dollars over it: the reflection
    principle, 2·(1 − Φ(z)), with z on log distance, |ln(level/spot)| ÷ (σ/spot). */
export function touchOdds(spot: number, level: number, sigma: number): number {
  if (!(spot > 0) || !(level > 0)) return 0;
  if (!(sigma > 0)) return Math.abs(level - spot) < 1e-9 ? 1 : 0;
  const z = Math.abs(Math.log(level / spot)) / (sigma / spot);
  return Math.min(1, Math.max(0, 2 * (1 - normCdf(z))));
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, error under 1e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export interface ConePastPoint {
  time: number;
  up1: number;
  dn1: number;
  up2: number;
  dn2: number;
}

export interface ConeForwardPoint {
  /** Trading minutes ahead of the last bar. */
  minutesAhead: number;
  up1: number;
  dn1: number;
  up2: number;
  dn2: number;
}

export interface ConeCrossing {
  time: number;
  /** The ±1σ edge price at the moment it was crossed. */
  edge: number;
  dir: 'up' | 'down';
}

export interface ExpectedMoveCone {
  past: ConePastPoint[];
  forward: ConeForwardPoint[];
  crossings: ConeCrossing[];
  openPrice: number;
  openTime: number | null;
}

const EMPTY: ExpectedMoveCone = { past: [], forward: [], crossings: [], openPrice: 0, openTime: null };

/**
 * The cone, from the session's bars and the book's σ.
 *
 * @param sessionBars   today's 1-minute bars, oldest first — the caller cuts
 *                      the session (sessionStarts) so this cannot disagree
 *                      with the session-levels overlay about where today began
 * @param iv            annualized ATM vol on the calendar year, as the vendor quotes it (0.2 = 20%)
 * @param minutesToClose remaining trading minutes — 0 after the bell, and 0
 *                      is honest: the forward half collapses to nothing
 *                      because nothing remains implied
 */
export function buildExpectedMoveCone(
  sessionBars: readonly Candle[],
  iv: number,
  minutesToClose: number,
  barMinutes = 1
): ExpectedMoveCone {
  if (sessionBars.length === 0 || !(iv > 0)) return EMPTY;
  const openPrice = sessionBars[0].open;
  const openTime = sessionBars[0].time;
  if (!(openPrice > 0)) return EMPTY;

  /* ── the envelope, per bar since the open ─────────────────────────────── */
  const past: ConePastPoint[] = [];
  const crossings: ConeCrossing[] = [];
  let prevSide: -1 | 0 | 1 = 0;
  for (let i = 0; i < sessionBars.length; i++) {
    const b = sessionBars[i];
    const elapsedMin = ((b.time - openTime) / 60);
    const w1 = openPrice * sigmaFracOver(iv, Math.max(0, elapsedMin));
    const p: ConePastPoint = {
      time: b.time,
      up1: openPrice + w1,
      dn1: openPrice - w1,
      up2: openPrice + 2 * w1,
      dn2: openPrice - 2 * w1,
    };
    past.push(p);

    /* Inside or outside the 1σ band by close. The first bar always counts as inside (its band has zero width); a crossing
       is a transition, and a re-entry re-arms the edge. */
    const side: -1 | 0 | 1 = b.close > p.up1 ? 1 : b.close < p.dn1 ? -1 : 0;
    if (side !== 0 && prevSide === 0 && i > 0) {
      crossings.push({ time: b.time, edge: side === 1 ? p.up1 : p.dn1, dir: side === 1 ? 'up' : 'down' });
    }
    prevSide = i === 0 ? 0 : side;
  }

  /* ── the forward cone, from now to the bell ───────────────────────────── */
  const spot = sessionBars[sessionBars.length - 1].close;
  const forward: ConeForwardPoint[] = [];
  const step = Math.max(1, barMinutes);
  const total = Math.max(0, minutesToClose);
  /* Every bar-step plus the exact close, so the tip lands ON the bell rather
     than one stride short of it. */
  for (let m = 0; m <= total; m += step) {
    const w1 = spot * sigmaFracOver(iv, m);
    forward.push({ minutesAhead: m, up1: spot + w1, dn1: spot - w1, up2: spot + 2 * w1, dn2: spot - 2 * w1 });
  }
  if (total > 0 && (total % step !== 0 || forward.length === 1)) {
    const w1 = spot * sigmaFracOver(iv, total);
    forward.push({ minutesAhead: total, up1: spot + w1, dn1: spot - w1, up2: spot + 2 * w1, dn2: spot - 2 * w1 });
  }

  return { past, forward, crossings, openPrice, openTime };
}
