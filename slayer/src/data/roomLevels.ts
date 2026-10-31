import { buildExposureProfile, type StrikeWindow } from './exposure';
import type { LevelsScope } from './levelsScope';
import type { ExposureLevels } from '../types/gex';
import type { MarketSnapshot } from '../types/market';
import { bookRevision } from './book/store';

/* One reading of the room's levels for every box (band tags, tape, profile rules, report, export): the band's snapshot, scope and window,
   computed once per snapshot and scope. A box that cannot read a book gets null. */

/** The band's own window (ExposureField's WHOLE_BOOK) — every box reads the levels through it. */
export const LEVELS_WINDOW: StrikeWindow = 30;

/* Keyed on the book's revision too, so a snapshot whose book moves on is read again. */
const cache = new WeakMap<MarketSnapshot, { rev: number; byScope: Partial<Record<LevelsScope, ExposureLevels | null>> }>();

export function roomLevels(snapshot: MarketSnapshot, scope: LevelsScope): ExposureLevels | null {
  const rev = bookRevision();
  let hit = cache.get(snapshot);
  if (!hit || hit.rev !== rev) {
    hit = { rev, byScope: {} };
    cache.set(snapshot, hit);
  }
  const byScope = hit.byScope;
  if (scope in byScope) return byScope[scope] ?? null;
  let out: ExposureLevels | null = null;
  try {
    out = buildExposureProfile(snapshot, scope, LEVELS_WINDOW).levels;
  } catch {
    out = null;
  }
  byScope[scope] = out;
  return out;
}
