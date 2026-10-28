import { nyWallStamp } from '../core/nyTime';
import type { Candle } from '../types/market';
import { thetaCall } from './theta';
import { barPriced } from './uwBook';

const INDEX = new Set(['SPX', 'RUT', 'NDX', 'VIX', 'XSP']);
const failed = new Set<string>();
const cache = new Map<string, Candle[]>();
const pending = new Set<string>();
const drawn = new Set<string>();

export function bookFailed(ticker: string): boolean {
  return failed.has(ticker.toUpperCase());
}

export function markBookFailed(ticker: string): void {
  failed.add(ticker.toUpperCase());
}

export function noteThetaDraw(ticker: string, on: boolean): void {
  const t = ticker.toUpperCase();
  if (on) drawn.add(t);
  else drawn.delete(t);
}

export function usingThetaCandles(ticker: string): boolean {
  return drawn.has(ticker.toUpperCase());
}

export function thetaCandles(ticker: string): Candle[] | null {
  return cache.get(ticker.toUpperCase()) ?? null;
}

/** Theta is only the fallback, and only after the book has failed. An all-zero day is not a session. */
export function ensureThetaCandles(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!failed.has(t) || cache.has(t) || pending.has(t)) return;
  pending.add(t);
  const index = INDEX.has(t);
  const end = new Date();
  const start = new Date(end.getTime() - 4 * 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const path = index
    ? `/index/history/ohlc?symbol=${t}&start_date=${ymd(start)}&end_date=${ymd(end)}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${t}&start_date=${ymd(start)}&end_date=${ymd(end)}&interval=1m&format=json`;
  void thetaCall(path).then(res => {
    pending.delete(t);
    const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    const bars: Candle[] = [];
    for (const b of rows) {
      const at = nyWallStamp(b.timestamp);
      const open = Number(b.open) || 0;
      const high = Number(b.high) || 0;
      const low = Number(b.low) || 0;
      const close = Number(b.close) || 0;
      if (!at || !barPriced(open, high, low, close)) continue;
      bars.push({
        time: Math.floor(at / 1000),
        open: open || close,
        high: high || close,
        low: low || close,
        close,
        volume: Number(b.volume) || 0,
      });
    }
    bars.sort((a, b) => a.time - b.time);
    if (bars.length >= 2) cache.set(t, bars);
  }).catch(() => { pending.delete(t); });
}
