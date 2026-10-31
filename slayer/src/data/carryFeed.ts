/* A name's dividend yield for the pricing carry (core/carry.ts setDividend), for the desks that price contracts (the
   Weigher). Read from the market-data screener row (`/screener/stocks?ticker=`), whose `dividend_yield` is the trailing
   twelve months' dividends over the price, as a fraction (SPY 0.0100 on 31 Oct 2026: 7.58 / 757.12; QQQ 0.0045). The
   stock-info route the Dossier card reads carries no yield at all for SPY, QQQ or AAPL (docs/DATA_MAP.md), and the screener
   has none for a cash index (SPX: null) — such a name is priced with no yield, and says so; nothing is invented. */

import { useEffect, useSyncExternalStore } from 'react';
import { carryFor, setDividend } from '../core/carry';
import { uwCall } from './whales';

export type YieldRead =
  /** not asked yet, or the read is out */
  | { state: 'pending' }
  /** the name's own yield, a fraction, now in the carry */
  | { state: 'known'; q: number }
  /** the read answered and the name has no yield in our data (a cash index, a name with no row) */
  | { state: 'none' }
  /** the read did not land: priced with none until it does */
  | { state: 'failed' };

const reads = new Map<string, YieldRead>();
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

/** The weekly roots price off their index */
const yieldName = (t: string): string => {
  const u = t.trim().toUpperCase();
  return u === 'SPXW' || u === 'XSP' ? 'SPX' : u === 'NDXP' ? 'NDX' : u === 'RUTW' ? 'RUT' : u;
};

/** The screener's yield off its row: a fraction in [0, 0.25), or null when the row has none */
export function screenerYield(rows: unknown, ticker: string): number | null {
  const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' && Array.isArray((rows as { data?: unknown }).data) ? (rows as { data: unknown[] }).data : [];
  const row = (list as Record<string, unknown>[]).find(r => String(r?.ticker ?? '').toUpperCase() === ticker);
  const raw = row?.dividend_yield;
  if (raw == null || raw === '') return null;
  const q = Number(raw);
  return Number.isFinite(q) && q >= 0 && q < 0.25 ? q : null;
}

/** Ask once for a name's yield (again a minute after a failed read) and put it in the carry. */
export function ensureYield(ticker: string): void {
  const name = yieldName(ticker);
  if (!name) return;
  const cur = reads.get(name);
  if (cur && cur.state !== 'failed') return;
  if (cur?.state === 'failed' && Date.now() - (asked.get(name) ?? 0) < 60_000) return;
  asked.set(name, Date.now());
  if (!cur) reads.set(name, { state: 'pending' });
  void uwCall(`/screener/stocks?ticker=${encodeURIComponent(name)}`, false, true).then(a => {
    if (a.error) {
      reads.set(name, { state: 'failed' });
    } else {
      const q = screenerYield(a.data, name);
      if (q == null) reads.set(name, { state: 'none' });
      else {
        setDividend(name, q);
        /* a weekly root prices through its own name too */
        if (name !== ticker.trim().toUpperCase()) setDividend(ticker, q);
        reads.set(name, { state: 'known', q });
      }
    }
    emit();
  });
}

export const peekYield = (ticker: string): YieldRead => reads.get(yieldName(ticker)) ?? { state: 'pending' };

/** The name's yield read, asked for on mount */
export function useYield(ticker: string | null | undefined): YieldRead {
  useEffect(() => {
    if (ticker) ensureYield(ticker);
  }, [ticker]);
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  return ticker ? peekYield(ticker) : { state: 'pending' };
}

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

/** The pricing line a hover gives: the model, the rate, and the name's yield — or that our data has none for it. */
export function carryWords(ticker: string, read: YieldRead = peekYield(ticker)): string {
  const name = yieldName(ticker);
  const r = carryFor(ticker).r;
  const head = `Priced with Black–Scholes at a ${pct(r)} rate`;
  if (read.state === 'known') return `${head} and ${name}'s ${pct(read.q)} dividend yield (the last twelve months' dividends over the price).`;
  if (read.state === 'none') return `${head}. Our data has no dividend yield for ${name}, so none is used — a payer's calls read a little rich and its puts a little cheap.`;
  if (read.state === 'failed') return `${head}. ${name}'s dividend yield did not load, so none is used until it does.`;
  return `${head}. ${name}'s dividend yield is still loading; none is used until it lands.`;
}
