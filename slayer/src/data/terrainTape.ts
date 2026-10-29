/*
  Terrain's tape. Yesterday and today, one-minute bars, from Theta.
  Nothing older. Nothing invented when the terminal is down.
*/

import { useSyncExternalStore } from 'react';
import type { Candle } from '../types/market';
import { nyWallStamp } from '../core/nyTime';
import { thetaCall } from './theta';

const INDEX = new Set(['SPX', 'VIX', 'RUT', 'NDX', 'XSP']);
const UNDER: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', XSP: 'SPX' };

interface TerrainTape {
  bars: Candle[];
  spot: number;
  prev: number;
  at: number;
  status: 'idle' | 'live' | 'down';
}

const tapes = new Map<string, TerrainTape>();
const wait = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(fn => fn());
}

function terrainRoot(ticker: string): string {
  return UNDER[ticker] ?? ticker;
}

function ymd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function stampSec(stamp: unknown): number {
  const at = nyWallStamp(stamp);
  return at ? Math.floor(at / 1000) : 0;
}

function read(data: unknown): Candle[] {
  const flat: Record<string, unknown>[] = [];
  const rows = Array.isArray(data) ? data : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown; close?: unknown };
    if (Array.isArray(row.data)) flat.push(...(row.data as Record<string, unknown>[]));
    else if (row.close != null) flat.push(item as Record<string, unknown>);
  }
  return flat
    .map(b => ({
      time: stampSec(b.timestamp ?? b.time ?? b.date),
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close),
      volume: num(b.volume ?? b.count),
    }))
    .filter(b => b.time > 0 && b.high > 0 && b.low > 0 && b.close > 0)
    .sort((a, b) => a.time - b.time);
}

function priorClose(bars: Candle[]): number {
  if (bars.length < 2) return 0;
  const last = new Date(bars[bars.length - 1].time * 1000);
  const day = last.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  let prev = 0;
  for (const b of bars) {
    const d = new Date(b.time * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (d !== day) prev = b.close;
  }
  return prev;
}

/** History is the closed minutes. The print is a snapshot, so the chart is not a minute behind. */
const HISTORY_MS = 15_000;
const SPOT_MS = 1_000;
const armed = new Set<string>();

function paintSpot(symbol: string, price: number, atSec: number): void {
  if (!(price > 0) || !(atSec > 0)) return;
  const prev = tapes.get(symbol);
  const bars = prev?.bars ? prev.bars.slice() : [];
  const minute = atSec - (atSec % 60);
  const last = bars[bars.length - 1];
  if (last && minute <= last.time) {
    const i = bars.length - 1;
    bars[i] = {
      ...last,
      close: price,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
    };
  } else if (!last || minute > last.time) {
    bars.push({ time: minute, open: price, high: price, low: price, close: price, volume: 0 });
  }
  tapes.set(symbol, {
    bars,
    spot: price,
    prev: prev?.prev || priorClose(bars),
    at: Date.now(),
    status: 'live',
  });
  emit();
}

async function pullSpot(symbol: string): Promise<void> {
  const index = INDEX.has(symbol);
  const path = index
    ? `/index/snapshot/price?symbol=${symbol}&format=json`
    : `/stock/snapshot/trade?symbol=${symbol}&format=json`;
  const got = await thetaCall(path, true);
  const row = Array.isArray(got.data) ? (got.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return;
  /* The quote snapshot is the bid and ask. The last trade is the print. A bid is not a price. */
  const price = num(row.price ?? row.last ?? row.close);
  paintSpot(symbol, price, stampSec(row.timestamp));
}

async function pull(symbol: string): Promise<void> {
  const end = ymd(Date.now());
  const start = ymd(Date.now() - 86400000);
  const index = INDEX.has(symbol);
  const path = index
    ? `/index/history/ohlc?symbol=${symbol}&start_date=${start}&end_date=${end}&interval=1m&format=json`
    : `/stock/history/ohlc?symbol=${symbol}&start_date=${start}&end_date=${end}&interval=1m&format=json`;
  const got = await thetaCall(path);
  const bars = read(got.data);
  const prevTape = tapes.get(symbol);
  let merged = bars.length ? bars : prevTape?.bars ?? [];
  const liveBar = prevTape?.bars[prevTape.bars.length - 1];
  const histBar = merged[merged.length - 1];
  if (liveBar && histBar && liveBar.time > histBar.time) merged = merged.concat(liveBar);
  else if (liveBar && histBar && liveBar.time === histBar.time && (prevTape?.spot ?? 0) > 0) {
    merged = merged.slice();
    merged[merged.length - 1] = {
      ...histBar,
      close: prevTape!.spot,
      high: Math.max(histBar.high, prevTape!.spot),
      low: Math.min(histBar.low, prevTape!.spot),
    };
  }
  const spot = (prevTape?.spot ?? 0) > 0 ? prevTape!.spot : histBar?.close ?? 0;
  tapes.set(symbol, {
    bars: merged,
    spot,
    prev: priorClose(merged),
    at: prevTape?.at || Date.now(),
    status: merged.length ? 'live' : got.error ? 'down' : 'live',
  });
  wait.delete(symbol);
  emit();
}

function arm(symbol: string): void {
  if (!symbol || armed.has(symbol)) return;
  armed.add(symbol);
  let historyAt = 0;
  const tick = () => {
    if (Date.now() - historyAt >= HISTORY_MS) {
      historyAt = Date.now();
      void pull(symbol);
    }
    void pullSpot(symbol).finally(() => {
      if (armed.has(symbol)) window.setTimeout(tick, SPOT_MS);
    });
  };
  void tick();
}

/** Ask for yesterday and today, and the live print every second, ahead of the scan. */
function ensureTerrain(ticker: string): void {
  arm(terrainRoot(ticker));
}

function subscribeTerrain(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTerrainTape(ticker: string): TerrainTape | null {
  const symbol = terrainRoot(ticker);
  ensureTerrain(symbol);
  return useSyncExternalStore(subscribeTerrain, () => tapes.get(symbol) ?? null);
}
