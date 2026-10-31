import { sessionStarts } from './indicators';
import type { Candle } from '../types/market';

/* Volume by price for the session: each bar's volume spread over the bins its range covers, by overlap. VPOC is the heaviest bin
   (ties toward the last close); the value area grows from it the standard (CBOT Market Profile) way — the two rows above against
   the two rows below, the heavier PAIR annexed (ties up; one row where only one is left on that side) — to 70%; VAH/VAL are its
   outer edges. */

const VALUE_AREA_FRACTION = 0.7;
/** Bin count the wrapper aims the session's range at. */
const TARGET_BINS = 48;

export interface VolumeProfileBin {
  /** Bin centre price. */
  price: number;
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  binSize: number;
  totalVolume: number;
  /** Heaviest bin's centre — null on an empty or volumeless session. */
  vpoc: number | null;
  /** Value-area high/low — outer edges of the 70% area. Null with vpoc. */
  vah: number | null;
  val: number | null;
}

const EMPTY: VolumeProfile = { bins: [], binSize: 0, totalVolume: 0, vpoc: null, vah: null, val: null };

/** The current session's profile at an explicit bin size; `sessionVolumeProfile` picks the size. */
export function volumeProfileAt(sessionBars: readonly Candle[], binSize: number): VolumeProfile {
  if (sessionBars.length === 0 || !(binSize > 0)) return EMPTY;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of sessionBars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!(hi >= lo)) return EMPTY;

  const base = Math.floor(lo / binSize) * binSize;
  const n = Math.max(1, Math.floor((hi - base) / binSize) + 1);
  const vols = new Array<number>(n).fill(0);

  for (const b of sessionBars) {
    if (!(b.volume > 0)) continue;
    if (b.high === b.low) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((b.high - base) / binSize)));
      vols[i] += b.volume;
      continue;
    }
    /* Overlap-proportional spread across the bins the bar's range covers. */
    const span = b.high - b.low;
    const first = Math.max(0, Math.floor((b.low - base) / binSize));
    const last = Math.min(n - 1, Math.floor((b.high - base) / binSize));
    for (let i = first; i <= last; i++) {
      const binLo = base + i * binSize;
      const overlap = Math.min(b.high, binLo + binSize) - Math.max(b.low, binLo);
      if (overlap > 0) vols[i] += b.volume * (overlap / span);
    }
  }

  const total = vols.reduce((a, v) => a + v, 0);
  const bins: VolumeProfileBin[] = vols.map((v, i) => ({ price: base + (i + 0.5) * binSize, volume: v }));
  if (!(total > 0)) return { bins, binSize, totalVolume: 0, vpoc: null, vah: null, val: null };

  /* VPOC — heaviest, ties toward the last close. */
  const lastClose = sessionBars[sessionBars.length - 1].close;
  let poc = 0;
  for (let i = 1; i < n; i++) {
    if (vols[i] > vols[poc] || (vols[i] === vols[poc] && Math.abs(bins[i].price - lastClose) < Math.abs(bins[poc].price - lastClose))) {
      poc = i;
    }
  }

  /* The 70% area, annexed two rows at a time from the VPOC — the heavier pair, ties upward. */
  let loI = poc;
  let hiI = poc;
  let held = vols[poc];
  const target = total * VALUE_AREA_FRACTION;
  while (held < target && (loI > 0 || hiI < n - 1)) {
    const upN = Math.min(2, n - 1 - hiI);
    const dnN = Math.min(2, loI);
    let up = 0;
    for (let k = 1; k <= upN; k++) up += vols[hiI + k];
    let dn = 0;
    for (let k = 1; k <= dnN; k++) dn += vols[loI - k];
    if (upN > 0 && (dnN === 0 || up >= dn)) {
      hiI += upN;
      held += up;
    } else {
      loI -= dnN;
      held += dn;
    }
  }

  return {
    bins,
    binSize,
    totalVolume: total,
    vpoc: bins[poc].price,
    vah: base + (hiI + 1) * binSize,
    val: base + loI * binSize,
  };
}

/** Today's profile for a ticker's base bars — the session cut plus a bin
    size aimed at TARGET_BINS across the session's own range. */
export function sessionVolumeProfile(bars1m: readonly Candle[], whole = false): VolumeProfile {
  if (bars1m.length === 0) return EMPTY;
  const starts = whole ? [0] : sessionStarts(bars1m, 1);
  const sess = bars1m.slice(starts[starts.length - 1]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of sess) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  const range = hi - lo;
  if (!(range >= 0)) return EMPTY;
  /* A one-price session still gets one bin rather than a zero division. */
  const binSize = range > 0 ? range / TARGET_BINS : Math.max(0.01, hi * 0.0005);
  return volumeProfileAt(sess, binSize);
}
