/* THE DEALERS' DRIFT INTO THE CLOSE, from one chain snapshot (data/chainFeed.ts: the live second-order greeks of every
   expiry, the day's open interest folded in) — pure math, no state.

   Per contract, per the vendor's own greeks at the snapshot's clock:
   - charm: the delta the clock takes from now to the next regular close, Δ + charm·τ (charm per year, τ in calendar
     years, the clock the vendor's greeks run on), held to the delta's own bounds (a call's 0…1, a put's −1…0) — a
     contract expiring at that close cannot be hedged past its intrinsic delta;
   - vanna: the delta a one-point fall in implied vol moves, Δ − vanna·0.01, held the same way.
   Each leg's delta change is dollars of delta (× 100 shares × spot) × open interest, kept in the house sign of the one
   dealer model (core/dealerSign.ts keptLeg: dealers long the calls, short the puts) and printed through retailSign's
   shownGreek, as every exposure on the site is. The dealers' HEDGE is the opposite trade: a dealer whose delta rises
   sells the underlying to stay flat, so the flow is −(dealer delta change) — positive buys, negative sells. */

import { keptLeg, type Right } from '../core/dealerSign';
import { shownGreek } from '../components/gex/retailSign';
import { isSessionDay, nextSessionDay, nyInstant, regularCloseMin } from '../core/session';
import type { ChainExpiry, ChainRow } from '../../shared/optionChain.mjs';

const YEAR_MS = 365 * 86_400_000;
/** The vol move the vanna figure is read at: one point down */
export const VOL_MOVE = -0.01;

/** The next regular close at or after an instant: today's while it is still ahead, else the next session's */
export function closeAfter(ms: number, day: string): number {
  if (isSessionDay(day)) {
    const close = nyInstant(day, regularCloseMin(day));
    if (ms < close) return close;
  }
  const next = nextSessionDay(day);
  return nyInstant(next, regularCloseMin(next));
}

const clampDelta = (right: Right, d: number) => (right === 'C' ? Math.min(1, Math.max(0, d)) : Math.min(0, Math.max(-1, d)));

/** One long contract's delta change: from the clock to the close (charm), and from a one-point vol fall (vanna) */
export function legDrift(right: Right, delta: number, charm: number, vanna: number, tau: number): { charm: number; vanna: number } {
  const d0 = clampDelta(right, delta);
  return {
    charm: clampDelta(right, d0 + charm * tau) - d0,
    vanna: clampDelta(right, d0 + vanna * VOL_MOVE) - d0,
  };
}

export interface DriftStrike {
  strike: number;
  /** Kept (house-sign) dollars of dealer delta change, by greek */
  charmKept: number;
  vannaKept: number;
  /** The dealers' hedge, dollars of the underlying: positive buys, negative sells */
  charmFlow: number;
  vannaFlow: number;
}
export interface DriftExpiry {
  exp: string;
  charmFlow: number;
  vannaFlow: number;
}
export interface Drift {
  /** The instant the greeks were priced at, and the close the drift runs to */
  fromMs: number;
  toMs: number;
  /** Calendar years between them */
  tau: number;
  spot: number;
  strikes: DriftStrike[];
  expiries: DriftExpiry[];
  charmFlow: number;
  vannaFlow: number;
  /** Contracts that carried open interest and greeks, and those that had open interest but no greeks */
  legs: number;
  missing: number;
}

/** The hedge a kept dealer figure forces: the opposite of the dealers' delta change */
const flowOf = (kept: number) => {
  const f = -shownGreek('delta', kept);
  return f === 0 ? 0 : f;
};

/** The drift of a whole chain to the next regular close after `fromMs` (the snapshot's own clock) */
export function chainDrift(expiries: readonly ChainExpiry<ChainRow>[], spot: number, fromMs: number, day: string): Drift | null {
  if (!(spot > 0) || !Number.isFinite(fromMs)) return null;
  const toMs = closeAfter(fromMs, day);
  const tau = Math.max(0, (toMs - fromMs) / YEAR_MS);
  const byStrike = new Map<number, DriftStrike>();
  const byExp: DriftExpiry[] = [];
  let legs = 0;
  let missing = 0;
  const perContract = 100 * spot;
  for (const e of expiries) {
    /* an expiry that has already closed has nothing left to hedge */
    if (nyInstant(e.exp, regularCloseMin(e.exp)) <= fromMs) continue;
    let ce = 0;
    let ve = 0;
    for (const row of e.rows) {
      const K = row[0] as number;
      for (const right of ['C', 'P'] as const) {
        const c = right === 'C' ? 0 : 1;
        const oi = row[11 + c];
        if (oi == null || !(oi > 0)) continue;
        const delta = row[5 + c];
        const charm = row[7 + c];
        const vanna = row[9 + c];
        if (delta == null || charm == null || vanna == null) {
          missing += 1;
          continue;
        }
        legs += 1;
        const d = legDrift(right, delta, charm, vanna, tau);
        const charmKept = keptLeg(right, d.charm * perContract, oi);
        const vannaKept = keptLeg(right, d.vanna * perContract, oi);
        let s = byStrike.get(K);
        if (!s) byStrike.set(K, (s = { strike: K, charmKept: 0, vannaKept: 0, charmFlow: 0, vannaFlow: 0 }));
        s.charmKept += charmKept;
        s.vannaKept += vannaKept;
        ce += charmKept;
        ve += vannaKept;
      }
    }
    if (ce !== 0 || ve !== 0) byExp.push({ exp: e.exp, charmFlow: flowOf(ce), vannaFlow: flowOf(ve) });
  }
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  let charmKept = 0;
  let vannaKept = 0;
  for (const s of strikes) {
    s.charmFlow = flowOf(s.charmKept);
    s.vannaFlow = flowOf(s.vannaKept);
    charmKept += s.charmKept;
    vannaKept += s.vannaKept;
  }
  return { fromMs, toMs, tau, spot, strikes, expiries: byExp, charmFlow: flowOf(charmKept), vannaFlow: flowOf(vannaKept), legs, missing };
}

/** The strikes a chart draws: those within `reach` of spot, gathered into bins of a round step so at most `rows` remain */
export function driftBins(strikes: readonly DriftStrike[], spot: number, reach = 0.03, rows = 24): DriftStrike[] {
  const lo = spot * (1 - reach);
  const hi = spot * (1 + reach);
  const near = strikes.filter(s => s.strike >= lo && s.strike <= hi);
  if (!near.length) return [];
  const STEPS = [0.5, 1, 2, 2.5, 5, 10, 25, 50, 100, 250];
  const step = STEPS.find(st => (hi - lo) / st <= rows) ?? STEPS[STEPS.length - 1];
  const bins = new Map<number, DriftStrike>();
  for (const s of near) {
    const k = Math.round(s.strike / step) * step;
    let b = bins.get(k);
    if (!b) bins.set(k, (b = { strike: k, charmKept: 0, vannaKept: 0, charmFlow: 0, vannaFlow: 0 }));
    b.charmKept += s.charmKept;
    b.vannaKept += s.vannaKept;
    b.charmFlow += s.charmFlow;
    b.vannaFlow += s.vannaFlow;
  }
  return [...bins.values()].sort((a, b) => b.strike - a.strike);
}
