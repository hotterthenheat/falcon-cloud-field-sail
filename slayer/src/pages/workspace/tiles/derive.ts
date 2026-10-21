/*
==================================================
  SLAYER TERMINAL - PULSE · WHAT THE TILES READ
  (pages/workspace/tiles/derive.ts)

  The book tiles all read the same few things off a
  name's snapshot — today's book, the calendar's
  surface, the range to the close, where the walls
  are heading, the wall board, the agenda. Each is
  built ONCE per snapshot and shared: two tiles on
  one name never build the same book twice, and a
  tile's head (its controls are data, read every
  render) asks for what its body already built.

  The desk hands a name one snapshot per sweep (10s),
  so "per snapshot" is the sweep's cadence. A build
  that throws (a name with no book) is remembered as
  null — the tile says so.
==================================================
*/

import Simulator from '../../../core/simulator';
import { buildAgenda, type Agenda, type AgendaOrder } from '../../../data/agenda';
import { aheadClock, type AheadClock } from '../../../data/ahead';
import { buildBuilding, type Building } from '../../../data/building';
import { buildExposureProfile } from '../../../data/exposure';
import { buildExposureSurface, CALENDAR_DTES, type ExposureSurface } from '../../../data/exposureSurface';
import { sessionBars } from '../../../data/levelview';
import { readSessionClock } from '../../../data/moc';
import { buildPulseView } from '../../../data/pulse';
import type { ExposureProfileData, KeyLevelRow } from '../../../types/gex';
import type { MarketSnapshot } from '../../../types/market';

const once = <T,>(build: (s: MarketSnapshot) => T) => {
  const kept = new WeakMap<MarketSnapshot, { v: T | null }>();
  return (s: MarketSnapshot): T | null => {
    let hit = kept.get(s);
    if (!hit) {
      try {
        hit = { v: build(s) };
      } catch {
        hit = { v: null };
      }
      kept.set(s, hit);
    }
    return hit.v;
  };
};

/** New York's clock now — what the agenda and the building run on */
export const clockNow = (): AheadClock => aheadClock(readSessionClock());
export const ivOf = (ticker: string) => Simulator.TICKERS[ticker]?.iv ?? 0.2;

/** Today's book, fifteen strikes each side — the agenda */
export const profile15 = once<ExposureProfileData>(s => buildExposureProfile(s, '0DTE', 15));
/** …and thirty — the walls, the agenda, the chain's read */
export const profile30 = once<ExposureProfileData>(s => buildExposureProfile(s, '0DTE', 30));
/** The whole calendar's book — the Map's */
export const surface30 = once<ExposureSurface>(s => buildExposureSurface(s, 30, CALENDAR_DTES));
export const keyLevelsOf = once<KeyLevelRow[]>(s => buildPulseView(s).keyLevels);

export const buildingOf = once<Building>(s => {
  const p = profile30(s);
  if (!p) throw new Error('no book');
  return buildBuilding(s, Simulator.getGexHistory(s.ticker), Simulator.getCandles(s.ticker), p, clockNow());
});

/* by a second key — the agenda's order */
const onceBy = <K, T>(build: (s: MarketSnapshot, k: K) => T) => {
  const kept = new WeakMap<MarketSnapshot, Map<K, T | null>>();
  return (s: MarketSnapshot, k: K): T | null => {
    let by = kept.get(s);
    if (!by) kept.set(s, (by = new Map()));
    if (!by.has(k)) {
      try {
        by.set(k, build(s, k));
      } catch {
        by.set(k, null);
      }
    }
    return by.get(k) ?? null;
  };
};

export const agendaOf = onceBy<AgendaOrder, Agenda>((s, order) => {
  const p = profile15(s);
  const b = buildingOf(s);
  const surf = surface30(s);
  if (!p || !b || !surf) throw new Error('no book');
  return buildAgenda(s, p, b, surf, sessionBars(s.ticker) ?? [], clockNow(), ivOf(s.ticker), order);
});
