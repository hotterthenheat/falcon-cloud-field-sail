/*
  One quote. The last print, the regular session's change, and the move outside the session kept apart.
  Nothing here reads the simulator. A name with no print yet is null.

  THE DAY'S CHANGE AFTER THE BELL (the re-audit, 2026-10-22): after the close stock-state is the post-market bar and its
  prev_close is TODAY's regular close, so close − prev_close was the after-hours move (PG read +0.01% on a +5.59% day).
  `changePct` is now the regular session's change (data/dayChange.ts), `extPct` the pre-/post-market move on its own,
  labelled by `phase`. The price stays the last print.
*/

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { peekSpot, subscribeBook } from './uwBook';
import { whalesState } from './whales';
import { dayChangeOf, loadRegularCloses, peekRegularCloses, type MarketPhase } from './dayChange';

export interface LiveQuote {
  /** The last print (post-market after the close) */
  spot: number;
  /** The regular session's change, percent — what "today" means */
  changePct: number;
  /** The pre-market or post-market move, percent, or null in the session */
  extPct: number | null;
  phase: MarketPhase;
  at: number;
}

const TTL = 15_000;
interface Raw {
  close: number;
  prev_close: number;
  market_time?: string;
  at: number;
}
const raw = new Map<string, Raw>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const memo = new Map<string, LiveQuote>();

function quoteOf(t: string): LiveQuote | null {
  const r = raw.get(t);
  if (!r) return null;
  const bookSpot = peekSpot(t);
  const closes = peekRegularCloses(t);
  /* after the bell the day's change needs the regular closes: until they land the quote is not given (its own
     close − prev_close would be the after-hours move alone, printed as the day's) */
  const m = (r.market_time ?? '').toLowerCase();
  if (!closes && !m.startsWith('reg') && !m.startsWith('pre')) return null;
  const ch = dayChangeOf({ close: r.close, prev_close: r.prev_close, market_time: r.market_time }, closes);
  /* in the session the book's spot is fresher than our 15s read; outside it the state's last print is the one */
  const spot = ch.phase === 'regular' && bookSpot != null ? bookSpot : r.close;
  const changePct = ch.phase === 'regular' && bookSpot != null && ch.base > 0 ? ((bookSpot - ch.base) / ch.base) * 100 : ch.dayPct;
  const prev = memo.get(t);
  if (prev && prev.spot === spot && prev.changePct === changePct && prev.extPct === ch.extPct && prev.phase === ch.phase) return prev;
  const next: LiveQuote = { spot, changePct, extPct: ch.extPct, phase: ch.phase, at: r.at };
  memo.set(t, next);
  return next;
}

export function peekQuote(ticker: string): LiveQuote | null {
  return quoteOf(ticker.toUpperCase());
}

export function ensureQuote(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || inflight.has(t) || typeof window === 'undefined') return;
  const hit = raw.get(t);
  if (hit && Date.now() - hit.at < TTL) return;
  inflight.add(t);
  whalesState(t)
    .then(async s => {
      const close = Number(s?.close);
      const prev = Number(s?.prev_close);
      if (!(close > 0)) return;
      const mt = typeof s?.market_time === 'string' ? s.market_time : undefined;
      raw.set(t, { close, prev_close: prev > 0 ? prev : 0, market_time: mt, at: Date.now() });
      emit();
      /* outside the session the day's change needs the regular close before today — read once a New York day */
      const m = (mt ?? '').toLowerCase();
      if (!m.startsWith('reg') && !m.startsWith('pre') && !peekRegularCloses(t)) {
        await loadRegularCloses(t).catch(() => null);
        emit();
      }
    })
    .catch(() => {})
    .finally(() => inflight.delete(t));
}

/** "after hours +0.4%" / "pre-market −1.1%" — the move outside the session, or null */
export function extendedLine(q: LiveQuote | null | undefined, digits = 2): string | null {
  if (!q || q.extPct == null || !Number.isFinite(q.extPct)) return null;
  const word = q.phase === 'pre' ? 'pre-market' : 'after hours';
  return `${word} ${q.extPct >= 0 ? '+' : '−'}${Math.abs(q.extPct).toFixed(digits)}%`;
}

const none = () => () => {};
const nullSnap = () => null;

export function useLiveQuote(ticker: string | null | undefined): LiveQuote | null {
  const t = ticker ? ticker.toUpperCase() : '';
  useEffect(() => {
    if (!t) return;
    ensureQuote(t);
    const id = window.setInterval(() => ensureQuote(t), TTL);
    return () => window.clearInterval(id);
  }, [t]);
  return useSyncExternalStore(
    t
      ? fn => {
          listeners.add(fn);
          const offBook = subscribeBook(fn);
          return () => {
            listeners.delete(fn);
            offBook();
          };
        }
      : none,
    t ? () => peekQuote(t) : nullSnap,
    nullSnap,
  );
}

/** Several names' quotes at once, read once each (no polling) — the News page's "Biggest move today" over the names its
    stories carry. The map holds only the names whose day change has landed. */
export function useDayMoves(tickers: readonly string[]): Map<string, LiveQuote> {
  const key = tickers.map(t => t.toUpperCase()).join(',');
  useEffect(() => {
    if (!key) return;
    key.split(',').forEach(t => ensureQuote(t));
  }, [key]);
  const at = useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => rev,
    () => 0,
  );
  return useMemo(() => {
    const out = new Map<string, LiveQuote>();
    if (!key) return out;
    for (const t of key.split(',')) {
      const q = peekQuote(t);
      if (q) out.set(t, q);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, at]);
}
