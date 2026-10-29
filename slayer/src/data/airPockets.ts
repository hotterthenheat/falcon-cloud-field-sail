import type { StrikeExposure, ZoneBand } from '../types/gex';

/* Air pockets: a run of at least MIN_STRIKES strikes each under QUIET_SHARE of the window's heaviest, bounded on both sides
   by a shelf (SHELF_SHARE). Relative to the book, so it reads the same on a $600 index and a $12 name; the window's edge is not a pocket. */

/** A strike under this share of the window's heaviest is "quiet". */
const QUIET_SHARE = 0.12;
/** A strike over this share bounds a pocket. */
export const SHELF_SHARE = 0.35;
/** Fewer contiguous quiet strikes than this is texture, not a pocket. */
const MIN_STRIKES = 3;

export interface AirPocket {
  /** Upper strike of the empty run (inclusive). */
  from: number;
  /** Lower strike of the empty run (inclusive). */
  to: number;
  /** Strikes in the run. */
  width: number;
  /** The shelves that bound it, above and below. */
  ceiling: number;
  floor: number;
  /** Largest |net gamma| inside the run, against the window's heaviest. */
  peakShare: number;
}

/** The pockets in a strike window; `strikes` are the profile's rows, highest first. */
export function findAirPockets(strikes: readonly StrikeExposure[]): AirPocket[] {
  if (strikes.length < MIN_STRIKES + 2) return [];
  const mag = strikes.map(s => Math.abs(s.gex.net));
  const heaviest = Math.max(...mag);
  if (heaviest <= 0) return [];

  const quiet = mag.map(m => m / heaviest < QUIET_SHARE);
  const shelf = mag.map(m => m / heaviest >= SHELF_SHARE);

  const out: AirPocket[] = [];
  let i = 0;
  while (i < strikes.length) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < strikes.length && quiet[j + 1]) j++;
    const width = j - i + 1;
    /* Bounded by a shelf on BOTH sides, and wide enough to matter. Rows run
       descending, so i−1 is the strike ABOVE the run and j+1 the one below. */
    const above = i - 1;
    const below = j + 1;
    if (width >= MIN_STRIKES && above >= 0 && below < strikes.length && shelf[above] && shelf[below]) {
      out.push({
        from: strikes[i].strike,
        to: strikes[j].strike,
        width,
        ceiling: strikes[above].strike,
        floor: strikes[below].strike,
        peakShare: Math.max(...mag.slice(i, j + 1)) / heaviest,
      });
    }
    i = j + 1;
  }
  return out;
}

/** The pockets as map bands, in the same shape the zones already use. */
export function airPocketZones(pockets: readonly AirPocket[]): ZoneBand[] {
  return pockets.map(p => ({
    from: p.from,
    to: p.to,
    kind: 'air-pocket' as const,
    label: 'AIR POCKET',
  }));
}

