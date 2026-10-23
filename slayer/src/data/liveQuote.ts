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
import { nyClock, nyIsoDate } from '../core/nyTime';

export interface LiveQuote {
  /** The last print (post-market after the close) */
  spot: number;
  /** The regular session's change, percent — what "today" means */
  changePct: number;
  /** The pre-market or post-market move, percent, or null in the session */
  extPct: number | null;
  phase: MarketPhase;
  /** The last regular-session close (null in the session) — what "close" means beside an extended-hours print */
  regClose: number | null;
  /** The New York date of that close, when the daily rows name it */
  regDate: string | null;
  /** Before the open the session's change is not yet made: the LAST session's change, kept so a pre-market page can
      say "−1.2% Oct 22" instead of a bare 0.00% (null when the rows have not landed) */
  lastSessionPct: number | null;
  /** Epoch ms of the vendor's last print (tape_time), else of our read */
  tapeAt: number;
  at: number;
}

const TTL = 15_000;
interface Raw {
  close: number;
  prev_close: number;
  market_time?: string;
  tapeAt: number;
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
  /* (pre-market reads the closes too, for the last session's change — loaded beside the quote, never waited on) */
  const ch = dayChangeOf({ close: r.close, prev_close: r.prev_close, market_time: r.market_time }, closes);
  /* in the session the book's spot is fresher than our 15s read; outside it the state's last print is the one */
  const spot = ch.phase === 'regular' && bookSpot != null ? bookSpot : r.close;
  const changePct = ch.phase === 'regular' && bookSpot != null && ch.base > 0 ? ((bookSpot - ch.base) / ch.base) * 100 : ch.dayPct;
  const today = nyIsoDate();
  const past = (closes ?? []).filter(c => c.date <= today);
  let regClose: number | null = null;
  let regDate: string | null = null;
  let lastSessionPct: number | null = null;
  if (ch.phase === 'pre') {
    regClose = r.prev_close > 0 ? r.prev_close : past[0]?.close ?? null;
    regDate = past[0] && past[0].date < today ? past[0].date : null;
    const a = past.find(c => c.date < today);
    const b = a ? past[past.indexOf(a) + 1] : undefined;
    lastSessionPct = a && b && b.close > 0 ? ((a.close - b.close) / b.close) * 100 : null;
  } else if (ch.phase !== 'regular') {
    regClose = ch.base > 0 ? ch.base * (1 + ch.dayPct / 100) : null;
    regDate = past[0]?.date ?? null;
  }
  const prev = memo.get(t);
  if (prev && prev.spot === spot && prev.changePct === changePct && prev.extPct === ch.extPct && prev.phase === ch.phase && prev.regClose === regClose && prev.lastSessionPct === lastSessionPct && prev.tapeAt === r.tapeAt) return prev;
  const next: LiveQuote = { spot, changePct, extPct: ch.extPct, phase: ch.phase, regClose, regDate, lastSessionPct, tapeAt: r.tapeAt, at: r.at };
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
      const tape = Date.parse(String((s as { tape_time?: string } | null)?.tape_time ?? ''));
      raw.set(t, { close, prev_close: prev > 0 ? prev : 0, market_time: mt, tapeAt: Number.isFinite(tape) ? tape : Date.now(), at: Date.now() });
      emit();
      /* outside the session the day's change needs the regular close before today — read once a New York day */
      const m = (mt ?? '').toLowerCase();
      if (!m.startsWith('reg') && !peekRegularCloses(t)) {
        await loadRegularCloses(t).catch(() => null);
        emit();
      }
    })
    .catch(() => {})
    .finally(() => inflight.delete(t));
}

/** THE PRICE, SAID AS WHICH PRICE IT IS (the retail test, 2026-10-23: AAPL read $348.20 / $348.30 / $348.34 on three
    pages, the after-hours print beside the regular-session change, with no clock). In the session: "348.34 · 14:05 ET";
    outside it: "348.22 close · 348.34 after hours 19:25 ET". */
export function priceWords(q: LiveQuote | null | undefined): { lead: number; line: string } | null {
  if (!q) return null;
  const clock = `${nyClock(q.tapeAt)} ET`;
  if (q.phase === 'regular' || q.regClose == null) return { lead: q.spot, line: `${q.spot.toFixed(2)} · ${clock}` };
  const word = q.phase === 'pre' ? 'pre-market' : 'after hours';
  if (Math.abs(q.spot - q.regClose) < 0.005) return { lead: q.regClose, line: `${q.regClose.toFixed(2)} close` };
  return { lead: q.regClose, line: `${q.regClose.toFixed(2)} close · ${q.spot.toFixed(2)} ${word} ${clock}` };
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
