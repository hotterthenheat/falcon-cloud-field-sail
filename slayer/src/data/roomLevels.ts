import { buildExposureProfile, type StrikeWindow } from './exposure';
import type { LevelsScope } from './levelsScope';
import type { ExposureLevels } from '../types/gex';
import type { MarketSnapshot } from '../types/market';

/*
==================================================
  SLAYER TERMINAL - THE ROOM'S LEVELS (data/roomLevels.ts)

  ONE SUPREME PER SCREEN (the re-audit's H6, 2026-10-13).
==================================================

  The band's tags, the tape, the profile's rules, the report and the export
  all print the call wall, the put wall, the flip, the pin and the supreme.
  They used to read them off the same book through two different windows
  (the band's surface at ±30 strikes, the boxes under it at ±20), so the pin
  — the most open interest IN THE WINDOW — could differ by box, and the
  Levels pick moved the band's levels without moving its Supreme door.

  This is the one reading: the same snapshot, the same scope, the same
  window as the band's surface, computed once per snapshot and scope and
  handed to every box. A box that cannot read a book (a feed book without
  its dates yet) gets null and keeps quiet, as before.
*/

/** The band's own window (ExposureField's WHOLE_BOOK) — every box reads the levels through it. */
export const LEVELS_WINDOW: StrikeWindow = 30;

const cache = new WeakMap<MarketSnapshot, Partial<Record<LevelsScope, ExposureLevels | null>>>();

export function roomLevels(snapshot: MarketSnapshot, scope: LevelsScope): ExposureLevels | null {
  let byScope = cache.get(snapshot);
  if (!byScope) {
    byScope = {};
    cache.set(snapshot, byScope);
  }
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
