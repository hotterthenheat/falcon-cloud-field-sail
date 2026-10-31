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
/** Which of the vendor's minute series a name's path is. Only the open-interest series is drawn (the levels' measure):
    the volume and directional series are other quantities, and a line that silently switched to them on the same axis
    read as the same book. A name without the open-interest series has no path ('oi' never stands for them). */
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

/** The day's gamma, one print a minute: the vendor's open-interest series (gamma_per_one_percent_move_oi), and only it. */
export function ensureBookMinutes(ticker: string): void {
  if (SIM_DESK) return;
  const t = ticker.toUpperCase();
  if (!t || minuteCache.has(t) || minuteWait.has(t)) return;
  const job = (async () => {
    const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures`);
    const raw = Array.isArray(res.data) ? res.data : [];
    /* gamma_per_one_percent_move_oi is the whole book re-priced each minute (the same measure as the levels' net GEX).
       The volume and directional series are not drawn in its place. */
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
    const seen = new Set<number>();
    const rows = oiRows.filter(r => (seen.has(r.time) ? false : (seen.add(r.time), true)));
    if (rows.length) minuteKind.set(t, 'oi');
    else minuteKind.delete(t);
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
