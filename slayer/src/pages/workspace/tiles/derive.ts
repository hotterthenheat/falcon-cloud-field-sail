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
import { bookCandles, bookHistory } from '../../../data/book/levels';
import { snapshotFor } from '../../../data/book/feed';
import { drawnLevels, levelsFor, type TickerLevels } from '../../../data/levelsFor';
import { levelsForName } from '../../../data/levelsScope';
import { LEVELS_WINDOW } from '../../../data/roomLevels';
import { peekIv } from '../../../data/book/move';
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
/** The name's live at-the-money IV from the vendor book; without it the range model does not run */
const ivOf = (ticker: string): number => {
  const iv = peekIv(ticker);
  if (iv == null || !(iv > 0)) throw new Error('no iv');
  return iv;
};

/** The scope a name's levels are read in — the one Pinpoint's head sets for it (data/levelsScope.ts), the scope Terrain,
    Pinpoint and Weigher read the same name in. The snapshot itself is materialized in it (data/book/feed.ts snapshotOf). */
const scopeOf = (s: MarketSnapshot) => levelsForName(s.ticker);
/** The name's book in its levels scope, fifteen strikes each side — the agenda */
const profile15 = once<ExposureProfileData>(s => buildExposureProfile(s, scopeOf(s), 15));
/** …and the levels' own window (roomLevels LEVELS_WINDOW, levelsFor's) — the walls, the agenda, the chain's read */
export const profile30 = once<ExposureProfileData>(s => buildExposureProfile(s, scopeOf(s), LEVELS_WINDOW));
/** The whole calendar's book — the Map's */
export const surface30 = once<ExposureSurface>(s => buildExposureSurface(s, 30, CALENDAR_DTES));

/** The name's levels — the ONE source every page prints a wall, the supreme or the flip from (data/levelsFor.ts, on the
    name's own scope). Null off the live book. Read on every render (levelsFor is memoised on the book's own state), never
    kept per snapshot: a desk context outlives the book landing under it. */
export const houseOf = (s: MarketSnapshot | null): TickerLevels | null => (s?.liveBook ? levelsFor(s.ticker, scopeOf(s)) : null);

/** A house reading as the chart's levels: the walls and the supreme only once the scope's own contracts are in, the flip
    only once final — before that each is NaN (nothing drawn), never another book's level standing in */
export const keyLevelsFrom = (spot: number, house: TickerLevels | null): KeyLevels => {
  /* the one gate (levelsFor drawnLevels), the one Terrain's and Weigher's panes read through */
  const d = drawnLevels(house);
  const n = (v: number | null) => (v == null ? Number.NaN : v);
  return { spot, callWall: n(d.callWall), putWall: n(d.putWall), supreme: n(d.supreme), flip: n(d.flip) };
};

/** The walls, flip and supreme the chart draws: the house's on a live book; a replayed or simulated book (no house) reads
    its own profile, by the same rule */
export const levelsOf = (s: MarketSnapshot | null): KeyLevels => {
  if (!s) return { spot: Number.NaN, callWall: Number.NaN, putWall: Number.NaN, flip: Number.NaN, supreme: Number.NaN };
  if (s.liveBook) return keyLevelsFrom(s.spot, houseOf(s));
  return profile30Safe(s)?.levels ?? { spot: s.spot, callWall: Number.NaN, putWall: Number.NaN, flip: Number.NaN, supreme: Number.NaN };
};
const profile30Safe = (s: MarketSnapshot | null) => (s ? profile30(s) : null);

/** The key-levels rail's rows off a house reading: the levels' own book sizes each one (the contracts they were read on),
    the most open interest is that book's too. Null without a book. */
export function keyLevelsFor(s: MarketSnapshot, house: TickerLevels | null): KeyLevelRow[] | null {
  const book = (house && s.liveBook ? snapshotFor(s.ticker, house.scope) : null) ?? s;
  const p = profile30Safe(book);
  if (!p) return null;
  const levels = s.liveBook ? keyLevelsFrom(book.spot, house) : p.levels;
  return buildKeyLevels(book, levels, house && !house.wallsFinal ? Number.NaN : p.levels.pin ?? book.spot);
}

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

/** A live book whose levels are not final yet: the scope's own contracts, or the flip's pricing, still landing. The
    agenda names its targets by the levels ("the call wall"), so it waits as board.ts deskAgenda does. */
export const levelsWaiting = (s: MarketSnapshot): boolean => !!s.liveBook && profile15(s)?.levels.complete === false;

export const agendaOf = onceBy<AgendaOrder, Agenda>((s, order) => {
  const p = profile15(s);
  const b = buildingOf(s);
  const surf = surface30(s);
  if (!p || !b || !surf) throw new Error('no book');
  /* nothing named off a stand-in book (the whole book standing in for "Today" names other walls) */
  if (levelsWaiting(s)) throw new Error('levels pending');
  return buildAgenda(s, p, b, surf, sessionBars(s.ticker) ?? [], clockNow(), ivOf(s.ticker), order);
});
