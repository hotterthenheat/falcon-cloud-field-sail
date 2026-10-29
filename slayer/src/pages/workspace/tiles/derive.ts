/* What the book tiles read off a name's live snapshot — today's book, the calendar's surface, the levels, the
   building, the agenda — each built once per snapshot and shared, so two tiles on one name never build the same
   book twice. A build that throws (a name with no book) is remembered as null and the tile says so. */

import { buildAgenda, type Agenda, type AgendaOrder } from '../../../data/agenda';
import { aheadClock, type AheadClock } from '../../../data/ahead';
import { buildBuilding, type Building } from '../../../data/building';
import { buildExposureProfile } from '../../../data/exposure';
import { buildExposureSurface, CALENDAR_DTES, type ExposureSurface } from '../../../data/exposureSurface';
import { sessionBars } from '../../../data/levelview';
import { readSessionClock } from '../../../data/moc';
import { buildKeyLevels } from '../../../data/pulse';
import { bookCandles, bookHistory, peekIv } from '../../../data/uwBook';
import type { ExposureProfileData, KeyLevelRow, KeyLevels } from '../../../types/gex';
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
/** The name's live at-the-money IV from the vendor book, else a plain 20% for the range model */
const ivOf = (ticker: string) => peekIv(ticker) ?? 0.2;

/** Today's book, fifteen strikes each side — the agenda */
const profile15 = once<ExposureProfileData>(s => buildExposureProfile(s, '0DTE', 15));
/** …and thirty — the walls, the agenda, the chain's read */
export const profile30 = once<ExposureProfileData>(s => buildExposureProfile(s, '0DTE', 30));
/** The whole calendar's book — the Map's */
export const surface30 = once<ExposureSurface>(s => buildExposureSurface(s, 30, CALENDAR_DTES));
/** The walls, flip and supreme the chart draws: today's book, thirty strikes each side */
export const levelsOf = (s: MarketSnapshot | null): KeyLevels => profile30Safe(s)?.levels ?? { spot: s?.spot ?? NaN, callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN };
const profile30Safe = (s: MarketSnapshot | null) => (s ? profile30(s) : null);
export const keyLevelsOf = once<KeyLevelRow[]>(s => {
  const p = profile30(s);
  if (!p) throw new Error('no book');
  return buildKeyLevels(s, p.levels, p.levels.pin ?? s.spot);
});

export const buildingOf = once<Building>(s => {
  const p = profile30(s);
  if (!p) throw new Error('no book');
  return buildBuilding(s, bookHistory(s.ticker) ?? [], bookCandles(s.ticker) ?? [], p, clockNow());
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
