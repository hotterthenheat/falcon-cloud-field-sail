import { useSyncExternalStore } from 'react';
import { TIMEFRAMES, frameServed, type Timeframe } from './timeframe';

/*
==================================================
  SLAYER TERMINAL - THE TIMEFRAMES KEPT ON THE STRIP (data/tfFavourites.ts)

  The partner tree's favourites (2026-11-01 port): the strip carries the STARRED timeframes and a chevron opens the
  whole list, a star beside each. The timeframe in hand always shows, starred or not. One set for every strip in the
  app — the ticker bar's tray, a pane's hover row, the cards — kept on this machine under the key our strip's pins
  already used (slayer-tf-pins), so a reader's pins survive the port. Only timeframes the feed serves are kept.
==================================================
*/

const KEY = 'slayer-tf-pins';
export const TF_FAVOURITES_BY_REST: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '1D'];

/** In the timeframes' own order, only ones the feed serves, no repeats */
const tidy = (list: readonly string[]): Timeframe[] => {
  const want = new Set(list);
  return TIMEFRAMES.map(t => t.value).filter(v => want.has(v) && frameServed(v));
};

const read = (): Timeframe[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    const list = Array.isArray(got) ? tidy(got.map(String)) : [];
    return list.length || Array.isArray(got) ? list : tidy(TF_FAVOURITES_BY_REST);
  } catch {
    return tidy(TF_FAVOURITES_BY_REST);
  }
};

let current: Timeframe[] = typeof window === 'undefined' ? [...TF_FAVOURITES_BY_REST] : read();
const subs = new Set<() => void>();

/** The timeframes kept on the strip, in the timeframes' order */
export const tfFavourites = (): readonly Timeframe[] => current;

export function setTfFavourites(list: readonly Timeframe[]): void {
  current = tidy(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage off — the choice lives for the session */
  }
  subs.forEach(f => f());
}

/** Star or unstar one — an empty set is allowed; the strip then shows the timeframe in hand and the chevron alone */
export const toggleTfFavourite = (tf: Timeframe): void => {
  if (!frameServed(tf)) return;
  setTfFavourites(current.includes(tf) ? current.filter(v => v !== tf) : [...current, tf]);
};

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const useTfFavourites = (): readonly Timeframe[] => useSyncExternalStore(subscribe, tfFavourites, tfFavourites);
