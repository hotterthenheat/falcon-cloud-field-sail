import { useSyncExternalStore } from 'react';
import { DISTANCE_UNITS, type DistanceUnit } from './atr';

/*
  THE DESK-WIDE UNIT — T-19's toggle, one store for every surface.

  The directive's point is that the surfaces SWITCH TOGETHER: a distance in
  ATR on the flip strip and in dollars on the measure box would be two desks
  wearing one skin. So the unit lives here — the candleTheme pattern, a
  module-level store with a reactive hook — and every renderer of a distance
  reads this one value. Persisted, because a reader who thinks in ATR thinks
  in ATR tomorrow too.
*/

const STORAGE_KEY = 'slayer_distance_unit';

function loadUnit(): DistanceUnit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (DISTANCE_UNITS as string[]).includes(raw)) return raw as DistanceUnit;
  } catch {
    /* storage blocked — session default */
  }
  return '$';
}

let current: DistanceUnit = loadUnit();
const listeners = new Set<() => void>();

export function getDistanceUnit(): DistanceUnit {
  return current;
}

export function setDistanceUnit(unit: DistanceUnit): void {
  if (unit === current) return;
  current = unit;
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    /* non-fatal */
  }
  listeners.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive unit — every distance on the desk re-words in place. A name with its own ruler does not read this. */
export function useDistanceUnit(): DistanceUnit {
  return useSyncExternalStore(subscribe, getDistanceUnit, getDistanceUnit);
}

/* A name keeps its own ruler. The desk default above is what a name uses until it is set. */
const NAME_KEY = 'slayer_ruler_by_name';
const readNames = (): Record<string, DistanceUnit> => {
  try {
    const raw = JSON.parse(localStorage.getItem(NAME_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, DistanceUnit> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && (DISTANCE_UNITS as string[]).includes(v)) out[k.toUpperCase()] = v as DistanceUnit;
    }
    return out;
  } catch {
    return {};
  }
};
let byName: Record<string, DistanceUnit> = readNames();

export function unitForName(ticker: string | null | undefined): DistanceUnit {
  if (!ticker) return current;
  return byName[ticker.toUpperCase()] ?? current;
}

export function setUnitForName(ticker: string, unit: DistanceUnit): void {
  const t = ticker.toUpperCase();
  if (!t || byName[t] === unit) return;
  byName = { ...byName, [t]: unit };
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify(byName));
  } catch {
    /* storage off */
  }
  listeners.forEach(fn => fn());
}

export function useNameUnit(ticker: string | null | undefined): DistanceUnit {
  useDistanceUnit();
  return useSyncExternalStore(subscribe, () => unitForName(ticker), () => unitForName(ticker));
}
