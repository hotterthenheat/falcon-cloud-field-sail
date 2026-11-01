/* The wind field's inputs, off OUR feeds (core/windField.ts is the model; this is the seam). Pure, so the proof
   (scripts/wind-proof.ts) checks it on a staged book and clock:
     the clock     the session module (core/session.ts): today's regular close (13:00 on an early close), the minutes
                   left and elapsed — nothing before the open, nothing after the bell, nothing on a holiday;
     the σ         the cone's own σ to today's close (data/terrainCone.ts forwardCone: the at-the-money implied vol on the
                   trading clock), handed in by the chart in dollars;
     the realised  today's regular-session one-minute closes;
     the carry     core/carry.ts carryFor: the rate less the name's yield, spread over the trading year's minutes;
     the book      the live dealer book's per-strike net gamma — the same chain Terrain's nodes read (book/levels.ts
                   chainForDate), turned from the kept sign to the dealer sign (core/dealerSign.ts dealerOf) — and the
                   same-day open interest off today's date in that book (none when today is not a listed expiry);
     the seed      (symbol, session date, minute) — the model's draws, stable within the minute. */
import { dealerOf } from '../core/dealerSign';
import { isSessionDay, nyWall, regularCloseMin, REGULAR_CLOSE_MIN, REGULAR_OPEN_MIN } from '../core/session';
import { TRADING_DAYS } from '../core/tradingYear';
import { KAPPA_REST, realisedSigmaDay, windSeed, type WindInputs, type WindStrike } from '../core/windField';

export interface WindBookNode {
  strike: number;
  /** Net gamma, KEPT (house) sign — as the book stores it */
  netGex: number;
  callOI: number;
  putOI: number;
}

/** Today's regular session as the session module reads it at `now`: null outside it (pre-market, after the bell, a
    holiday or a weekend) — the field only runs while there is a rest of the session to forecast */
export function windClock(now: number): { iso: string; nyMin: number; sessionLen: number; minutesLeft: number; elapsedMin: number } | null {
  const w = nyWall(now);
  if (!isSessionDay(w.iso)) return null;
  const close = regularCloseMin(w.iso);
  const nyMin = w.min;
  if (nyMin < REGULAR_OPEN_MIN || nyMin >= close) return null;
  return { iso: w.iso, nyMin, sessionLen: close - REGULAR_OPEN_MIN, minutesLeft: close - nyMin, elapsedMin: nyMin - REGULAR_OPEN_MIN };
}

export interface WindSources {
  ticker: string;
  now: number;
  /** The last price */
  spot: number;
  /** The cone's 1σ to today's close, dollars (forwardCone sigmaToday); null without a vol */
  sigmaToday: number | null;
  /** The book's chain the nodes read, kept sign */
  nodes: readonly WindBookNode[];
  /** Today's expiry in the same book, for the pin (empty when today is not listed) */
  sameDay: readonly WindBookNode[];
  /** Today's regular-session one-minute closes, oldest first */
  closes: readonly number[];
  /** The name's carry (core/carry.ts carryFor) */
  carry: { r: number; q: number };
  paths?: number;
}

/** Why the field is not drawn, in the chart's words — or the inputs */
export type WindReady = { ok: true; inputs: WindInputs; clock: NonNullable<ReturnType<typeof windClock>> } | { ok: false; why: string };

export function windInputsFor(s: WindSources): WindReady {
  const clock = windClock(s.now);
  if (!clock) return { ok: false, why: 'Wind — runs in the regular session' };
  if (!(s.spot > 0)) return { ok: false, why: 'Wind — waiting on the price' };
  if (!(s.sigmaToday != null && s.sigmaToday > 0)) return { ok: false, why: 'Wind — waiting on implied vol' };
  if (!s.nodes.length) return { ok: false, why: 'Wind — waiting on the dealer book' };
  const oi = new Map<number, number>();
  for (const n of s.sameDay) oi.set(n.strike, (oi.get(n.strike) ?? 0) + (n.callOI || 0) + (n.putOI || 0));
  const strikes: WindStrike[] = s.nodes
    .filter(n => Number.isFinite(n.strike) && n.strike > 0 && Number.isFinite(n.netGex))
    .map(n => ({ strike: n.strike, netGex: dealerOf(n.netGex), sameDayOI: oi.get(n.strike) ?? 0 }));
  const yearMin = TRADING_DAYS * (REGULAR_CLOSE_MIN - REGULAR_OPEN_MIN);
  const carry = Number.isFinite(s.carry.r) && Number.isFinite(s.carry.q) ? s.carry.r - s.carry.q : 0;
  return {
    ok: true,
    clock,
    inputs: {
      spot: s.spot,
      minutesLeft: clock.minutesLeft,
      elapsedMin: clock.elapsedMin,
      sessionLen: clock.sessionLen,
      sigmaLeft: s.sigmaToday / s.spot,
      realisedSigmaDay: realisedSigmaDay(s.closes, clock.sessionLen),
      driftPerMin: carry / yearMin,
      strikes,
      levels: [],
      paths: s.paths ?? 3000,
      seed: windSeed(s.ticker, clock.iso, clock.nyMin),
      kappa: KAPPA_REST,
    },
  };
}
