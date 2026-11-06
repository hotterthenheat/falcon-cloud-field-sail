import type { Candle } from '../types/market';
import { sigmaMoveOfQuotedIv } from '../core/volClock';
import { sessionAtOrBefore, isoDate } from '../core/calendar';
import { nyParts } from '../core/nyTime';
import { now } from '../core/clock';

/* The cone and the one σ every Pinpoint odd reads. An ATM straddle is σ·√(2/π) ≈ 0.80σ for a normal move (the vendor's
   implied move is not one: it is ≈ 0.68σ, about 0.85 of the straddle — data/book/move.ts).
   A vol is quoted on the calendar year for its expiry; every σ off a vol is core/volClock's sigmaMoveOfQuotedIv — the variance
   moved onto the trading clock, S·σ_trading·√(minutes / (390·252)) — the same σ as Terrain's forward-variance cone. One session
   is NOT a calendar day's variance: a 30-day 20% vol over one session at S = 600 is ≈ $7.5, not 600·0.2·√(1/365) = $6.28, and a
   0DTE 20% vol at noon prices $2.56 to the close, not $4.93. */

/** 1σ per dollar of ATM straddle: σ = straddle·√(π/2) ≈ 1.2533 (dollars → dollars; E|X| = σ·√(2/π) for a normal X).
    A straddle, not the vendor's implied move (k·S·σ·√T, k ≈ 0.68: SPY 11/20 implied 17.87 against the straddle mid 21.51). */
export const STRADDLE_TO_SIGMA = Math.sqrt(Math.PI / 2);
/** Straddle ÷ (S·σ·√T) for a normal move, √(2/π) ≈ 0.798 — the straddle fit's k when the vendor's rows give none. */
export const STRADDLE_K = Math.sqrt(2 / Math.PI);
/** The unit session a "one session σ" is quoted over: 390 trading minutes (an early close is a shorter horizon, not a shorter unit). */
const SESSION_MIN = 390;
/** The tenor an undated vol is (the 30-day IV every name carries), calendar days. */
const UNDATED_DAYS = 30;

/** The expiry an undated vol is quoted for: the session on or before 30 calendar days out (New York dates). */
export function undatedExpiry(nowMs: number = now().getTime()): string {
  const p = nyParts(nowMs);
  return isoDate(sessionAtOrBefore(new Date(p.year, p.month - 1, p.day + UNDATED_DAYS)));
}

/** One standard move, dollars, from the vendor's straddle (its implied move), dollars. */
export const sigmaFromStraddle = (straddle: number): number => (straddle > 0 ? straddle * STRADDLE_TO_SIGMA : 0);

/** 1σ as a fraction of price over `minutes` trading minutes, for a calendar-year vol (0.2 = 20%) quoted for `expiry`
    (YYYY-MM-DD; an undated vol is the 30-day one). core/volClock's sigmaMoveOfQuotedIv per dollar of spot. */
export function sigmaFracOver(iv: number, minutes: number, expiry?: string | null, nowMs: number = now().getTime()): number {
  if (!(iv > 0) || !(minutes > 0)) return 0;
  return sigmaMoveOfQuotedIv(1, iv, expiry || undatedExpiry(nowMs), minutes, nowMs);
}

/** One session's (390 trading minutes) 1σ, dollars, off a calendar-year vol quoted for `expiry` (the 30-day vol when
    none) — null without a price or a vol. sigmaOverMinutes scales it to the minutes left. */
export function daySigmaOfIv(spot: number, iv: number, expiry?: string | null, nowMs: number = now().getTime()): number | null {
  return spot > 0 && iv > 0 ? spot * sigmaFracOver(iv, SESSION_MIN, expiry, nowMs) : null;
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

/** The cone from the session's 1-minute bars (oldest first, cut by sessionStarts), a calendar-year ATM `iv` (0.2 = 20%)
    quoted for `expiry` (the 30-day vol when none), and `minutesToClose` (0 after the bell collapses the forward half).
    The app draws Terrain's forward-variance cone (data/terrainCone.ts); this stays for the proofs, on the same σ. */
export function buildExpectedMoveCone(
  sessionBars: readonly Candle[],
  iv: number,
  minutesToClose: number,
  barMinutes = 1,
  expiry?: string | null,
  nowMs: number = now().getTime()
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
    const w1 = openPrice * sigmaFracOver(iv, Math.max(0, elapsedMin), expiry, nowMs);
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
    const w1 = spot * sigmaFracOver(iv, m, expiry, nowMs);
    forward.push({ minutesAhead: m, up1: spot + w1, dn1: spot - w1, up2: spot + 2 * w1, dn2: spot - 2 * w1 });
  }
  if (total > 0 && (total % step !== 0 || forward.length === 1)) {
    const w1 = spot * sigmaFracOver(iv, total, expiry, nowMs);
    forward.push({ minutesAhead: total, up1: spot + w1, dn1: spot - w1, up2: spot + 2 * w1, dn2: spot - 2 * w1 });
  }

  return { past, forward, crossings, openPrice, openTime };
}
