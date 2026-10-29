/* Gross option premium by minute for the chart's book lines: premium-weighted, from the stored SPXW book or a name's
   minute ticks; a minute without ask, bid and mid premium is dropped. */

import { useEffect, useSyncExternalStore } from 'react';
import { uwCall } from './whales';

export interface GrossMinute {
  /** Epoch seconds, on the minute. */
  time: number;
  /** Call premium that minute, dollars. */
  call: number;
  /** Put premium that minute, dollars. */
  put: number;
}

const CALL_KEYS = ['call_premium_ask_side', 'call_premium_bid_side', 'call_premium_mid_side', 'call_premium_no_side'];
const PUT_KEYS = ['put_premium_ask_side', 'put_premium_bid_side', 'put_premium_mid_side', 'put_premium_no_side'];

const cache = new Map<string, GrossMinute[]>();
const wait = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function publish(ticker: string, rows: GrossMinute[]) {
  cache.set(ticker, rows);
  listeners.forEach(fn => fn());
}

function leg(row: Record<string, unknown>, keys: readonly string[]): number | null {
  let seen = false;
  let sum = 0;
  for (const k of keys) {
    const raw = row[k];
    if (raw == null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n)) continue;
    seen = true;
    sum += Math.abs(n);
  }
  return seen ? sum : null;
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(data) ? data : [];
  return raw.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/** One read. An empty list means the feed had no gross premium, not that we have not asked. */
export function ensureGrossFlow(ticker: string): void {
  const t = ticker.trim().toUpperCase();
  /* SPX premium is the stored SPXW book. Do not spend a feed slot on a second tape. */
  if (!t || t === 'SPX' || t === 'SPXW' || cache.has(t) || wait.has(t)) return;
  const job = (async () => {
    const res = await uwCall(`/stock/${encodeURIComponent(t)}/net-prem-ticks`);
    if (res.error || !Array.isArray(res.data)) {
      publish(t, []);
      return;
    }
    const out: GrossMinute[] = [];
    const seen = new Set<number>();
    for (const row of rowsOf(res.data)) {
      const ms = Date.parse(String(row.tape_time ?? row.start_time ?? row.time ?? ''));
      if (!Number.isFinite(ms)) continue;
      const time = Math.floor(ms / 60000) * 60;
      if (seen.has(time)) continue;
      const call = leg(row, CALL_KEYS);
      const put = leg(row, PUT_KEYS);
      /* Net premium is not gross. A minute that does not name both sides' dollars is skipped. */
      if (call == null || put == null) continue;
      if (!(call > 0) && !(put > 0)) continue;
      seen.add(time);
      out.push({ time, call, put });
    }
    out.sort((a, b) => a.time - b.time);
    publish(t, out);
  })().finally(() => {
    wait.delete(t);
  });
  wait.set(t, job);
}

export function rollGross(minutes: readonly GrossMinute[], barSec: number): { time: number; callPrem: number; putPrem: number; count: number }[] {
  const width = Math.max(1, Math.floor(barSec));
  const by = new Map<number, { time: number; callPrem: number; putPrem: number; count: number }>();
  for (const m of minutes) {
    if (!(m.call > 0) && !(m.put > 0)) continue;
    const time = Math.floor(m.time / width) * width;
    let bar = by.get(time);
    if (!bar) {
      bar = { time, callPrem: 0, putPrem: 0, count: 0 };
      by.set(time, bar);
    }
    bar.callPrem += m.call;
    bar.putPrem += m.put;
    bar.count += 1;
  }
  return [...by.values()].sort((a, b) => a.time - b.time);
}

export function useGrossFlow(ticker: string): GrossMinute[] | null {
  const t = ticker.trim().toUpperCase();
  useEffect(() => {
    ensureGrossFlow(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cache.get(t) ?? null,
    () => null,
  );
}
