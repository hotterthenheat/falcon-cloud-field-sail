/* The vendor's own gamma one print a minute (spot-exposures), for the book's path through the day. */

import { useEffect, useSyncExternalStore } from 'react';
import { nyMinutes } from '../../core/nyTime';
import { keptOf } from '../../core/dealerSign';
import { SIM_DESK } from '../deskMode';
import { uwCall } from '../whales';


/** One minute of the vendor's own gamma (spot-exposures), kept in the house sign like the strikes (core/dealerSign.ts):
    negative = dealers long gamma. */
interface BookMinute {
  time: number;
  min: number;
  net: number;
  spot: number | null;
}

const minuteCache = new Map<string, BookMinute[]>();
/** Which of the vendor's minute series a name's path is: open interest (the levels' measure), volume, or directional */
const minuteKind = new Map<string, 'oi' | 'vol' | 'dir'>();
export const bookMinuteKind = (ticker: string): 'oi' | 'vol' | 'dir' | null => minuteKind.get(ticker.toUpperCase()) ?? null;
const minuteWait = new Map<string, Promise<void>>();
const minuteRevListeners = new Set<() => void>();
let minuteRev = 0;

function publishMinutes(ticker: string, rows: BookMinute[]) {
  minuteCache.set(ticker, rows);
  minuteRev += 1;
  minuteRevListeners.forEach(fn => fn());
}

/** The day's gamma, one print a minute: the open-interest series first, then volume gamma, then directional. */
export function ensureBookMinutes(ticker: string): void {
  if (SIM_DESK) return;
  const t = ticker.toUpperCase();
  if (!t || minuteCache.has(t) || minuteWait.has(t)) return;
  const job = (async () => {
    const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures`);
    const raw = Array.isArray(res.data) ? res.data : [];
    const volRows: BookMinute[] = [];
    const dirRows: BookMinute[] = [];
    const seen = new Set<number>();
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const ms = Date.parse(String(o.start_time ?? o.time ?? ''));
      if (!Number.isFinite(ms)) continue;
      const time = Math.floor(ms / 60000) * 60;
      if (seen.has(time)) continue;
      seen.add(time);
      const px = parseFloat(String(o.price ?? ''));
      const spot = Number.isFinite(px) && px > 0 ? px : null;
      const base = { time, min: nyMinutes(ms), spot };
      const vol = parseFloat(String(o.gamma_per_one_percent_move_vol ?? ''));
      const dir = parseFloat(String(o.gamma_per_one_percent_move_dir ?? ''));
      /* the vendor's dealer gamma (positive: dealers long gamma), kept in the house sign like the strikes */
      if (Number.isFinite(vol)) volRows.push({ ...base, net: keptOf(vol) });
      if (Number.isFinite(dir)) dirRows.push({ ...base, net: keptOf(dir) });
    }
    /* The open-interest series first: gamma_per_one_percent_move_oi is the whole book re-priced each minute (the same
       measure as the levels' net GEX); volume, then directional, only when it is absent. */
    const oiRows: BookMinute[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const ms = Date.parse(String(o.start_time ?? o.time ?? ''));
      const v = parseFloat(String(o.gamma_per_one_percent_move_oi ?? ''));
      if (!Number.isFinite(ms) || !Number.isFinite(v)) continue;
      const px = parseFloat(String(o.price ?? ''));
      oiRows.push({ time: Math.floor(ms / 60000) * 60, min: nyMinutes(ms), spot: Number.isFinite(px) && px > 0 ? px : null, net: keptOf(v) });
    }
    const dedupe = (rows: BookMinute[]) => rows.filter((r, i, a) => a.findIndex(x => x.time === r.time) === i);
    const alive = (rows: BookMinute[]) => rows.reduce((n, r) => n + (r.net !== 0 ? 1 : 0), 0);
    const oiKept = dedupe(oiRows);
    const rows = alive(oiKept) >= 8 ? oiKept : alive(volRows) >= 8 ? volRows : alive(dirRows) >= 8 ? dirRows : volRows.length >= 2 ? volRows : dirRows;
    minuteKind.set(t, rows === oiKept ? 'oi' : rows === volRows ? 'vol' : 'dir');
    rows.sort((a, b) => a.time - b.time);
    publishMinutes(t, rows);
  })().finally(() => {
    minuteWait.delete(t);
  });
  minuteWait.set(t, job);
}

export function useBookMinutes(ticker: string): BookMinute[] | null {
  const t = ticker.toUpperCase();
  useEffect(() => {
    ensureBookMinutes(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      minuteRevListeners.add(fn);
      return () => minuteRevListeners.delete(fn);
    },
    () => minuteCache.get(t) ?? null,
    () => minuteCache.get(t) ?? null,
  );
}
