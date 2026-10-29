/* What the live dealer book says about each strike of a name: its shape (wall, cliff, shelf, void), which way
   dealers lean on a move through it, its part (a wall, the supreme, distance from the flip), how it held today,
   the close odds and what the day added. Built once per scan; the Weigher's chain and strike block read it. */

import { bookCandles, bookHistory, peekIv, snapshotOf } from './uwBook';
import { aheadClock, buildCloseOdds, buildCorridor, fmtDollars } from './ahead';
import { buildBuilding, type BuildVerdict } from './building';
import { readSessionClock } from './moc';
import { sessionBars } from './levelview';
import { cutOf, shapesOf, type MapRow, type Shape } from './mapShape';
import { GREEKS } from './exposureSurface';
import { testEvents } from './wall';
import type { ExposureProfileData } from '../types/gex';

export type Lean = 'push back' | 'push along';
export interface BookAtStrike {
  strike: number;
  shape: Shape | null;
  /** Net dealer gamma at the strike — signed dollars, the house sign (positive = put-heavy) */
  net: number;
  /** |net| against the cut, 0..1 — the column's bar */
  share: number;
  lean: Lean;
  role: 'call wall' | 'put wall' | 'supreme' | null;
  /** Percent from the flip, signed (+ above) */
  flipDistPct: number;
  held: { tests: number; held: number; broke: number } | null;
  /** The odds the 4:00 print lands at or ABOVE the strike, percent — null when the close could not be read */
  oddsAbove: number | null;
  /** …at or BELOW it */
  oddsBelow: number | null;
  change: { sizeChange: number; verdict: BuildVerdict } | null;
}
export interface Book {
  ticker: string;
  spot: number;
  cut: number;
  rows: Map<number, BookAtStrike>;
}

/** The change, in words */
export const changeWords = (c: BookAtStrike['change']): string => {
  if (!c) return 'no record of today yet';
  const v = c.verdict;
  const amt = fmtDollars(Math.abs(c.sizeChange));
  return v === 'building' ? `building · +${amt} today` : v === 'draining' ? `draining · −${amt} today` : v === 'switched' ? `switched sides today` : v === 'new' ? `new today · ${amt}` : 'steady today';
};

export function buildBook(ticker: string, profile: ExposureProfileData): Book {
  const spot = profile.levels.spot;
  const { callWall, putWall, supreme, flip } = profile.levels;
  const rows: MapRow[] = profile.strikes.map(s => {
    const legs = {} as MapRow['legs'];
    for (const g of GREEKS) legs[g] = s[g];
    return {
      strike: s.strike,
      legs,
      net: s.gex.net,
      shape: null,
      role: s.strike === supreme ? 'supreme' : s.strike === callWall ? 'call wall' : s.strike === putWall ? 'put wall' : null,
      above: s.strike >= spot,
    };
  });
  const shaped = shapesOf(rows);
  const cut = Math.max(1, cutOf(shaped));

  /* the day's tape, once */
  const bars = sessionBars(ticker) ?? [];
  /* the close's odds, once — Ahead's model on this same profile */
  let odds: { strike: number; odds: number }[] | null = null;
  let building: ReturnType<typeof buildBuilding> | null = null;
  /* The close odds and the day's change come from the live vendor book; without it they stay blank. */
  try {
    const snap = snapshotOf(ticker);
    const iv = peekIv(ticker);
    if (snap && iv != null) {
      const clock = aheadClock(readSessionClock());
      const corridor = buildCorridor(snap, profile, iv, clock);
      odds = buildCloseOdds(profile, spot, corridor.sigma, clock).rows;
      try {
        building = buildBuilding(snap, bookHistory(ticker) ?? [], bookCandles(ticker) ?? [], profile, clock);
      } catch {
        building = null;
      }
    }
  } catch {
    odds = null;
  }

  const out = new Map<number, BookAtStrike>();
  for (const r of shaped) {
    const above = odds ? odds.filter(o => o.strike >= r.strike - 1e-9).reduce((s, o) => s + o.odds, 0) : null;
    const below = odds ? odds.filter(o => o.strike <= r.strike + 1e-9).reduce((s, o) => s + o.odds, 0) : null;
    const b = building?.rows.find(x => Math.abs(x.strike - r.strike) < 1e-9);
    out.set(r.strike, {
      strike: r.strike,
      shape: r.shape,
      net: r.net,
      share: Math.min(1, Math.abs(r.net) / cut),
      /* the house sign: negative = call-heavy = dealers absorb (push back); positive = put-heavy = they amplify (push along) */
      lean: r.net < 0 ? 'push back' : 'push along',
      role: r.role,
      flipDistPct: flip > 0 ? ((r.strike - flip) / flip) * 100 : 0,
      held: bars.length ? testEvents(bars, r.strike, r.strike >= spot ? 'call' : 'put') : null,
      oddsAbove: above == null ? null : Math.min(100, above),
      oddsBelow: below == null ? null : Math.min(100, below),
      change: b ? { sizeChange: b.sizeChange, verdict: b.verdict } : null,
    });
  }
  return { ticker, spot, cut, rows: out };
}
