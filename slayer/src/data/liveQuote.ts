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
import { whalesScreener, whalesState } from './whales';
import { dayChangeOf, loadRegularCloses, peekRegularCloses, type MarketPhase } from './dayChange';
import { nyClock, nyIsoDate, nySessionPhase } from '../core/nyTime';
import { isTradingDay, today as nyTodayDate } from '../core/calendar';

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
  /** THE REGULAR PRICE (audit round 5: Pinpoint and Dossier showed $763.96 and $763.97 for one SPY — one page the
      after-hours print, the other the close): in the session the last print; outside it the last regular close. Every
      page that prints "the price" prints this one */
  regularPrice: number;
  /** The extended-hours print (pre-market or after hours) when it differs from the regular price, else null — shown
      apart, labelled by `phase`, timed by `tapeAt` */
  extPrice: number | null;
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
    /* to the hundredth of a cent — the product of base and change carries float dust (763.9699999…) */
    regClose = ch.base > 0 ? Number((ch.base * (1 + ch.dayPct / 100)).toFixed(4)) : null;
    regDate = past[0]?.date ?? null;
  }
  const regularPrice = ch.phase === 'regular' || regClose == null ? spot : regClose;
  const extPrice = ch.phase !== 'regular' && regClose != null && Math.abs(spot - regClose) >= 0.005 ? spot : null;
  const prev = memo.get(t);
  if (prev && prev.spot === spot && prev.changePct === changePct && prev.extPct === ch.extPct && prev.phase === ch.phase && prev.regClose === regClose && prev.lastSessionPct === lastSessionPct && prev.tapeAt === r.tapeAt) return prev;
  const next: LiveQuote = { spot, changePct, extPct: ch.extPct, phase: ch.phase, regClose, regDate, lastSessionPct, regularPrice, extPrice, tapeAt: r.tapeAt, at: r.at };
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

/* ---- THE DAY'S MOVE OVER A WHOLE SET, FROM THE SCREENER (the fourth audit, 2026-10-23) ------------------------------
   "Biggest move today: NVDA −4.4% · 3 of 86 read" while META (−6.98%) and AMD (−8.10%) had stories — the set was read
   one quote at a time and named before it had landed. Now every name is read in bulk off /screener/stocks (about sixty
   names a call, the proxy's path limit), and the result is given only when the whole set is in.
   The screener's `close` is the last print — after the bell, the post-market one — and `intraday_change` is that last
   print's move off the regular close (META 10/22: close 645.89, intraday_change −0.456% → 648.85, the regular close),
   so the regular session's change is close ÷ (1 + intraday_change) against prev_close. In the session it is close
   against prev_close. The move is labelled with the screener's own `date` (the session it belongs to). */
export interface SetMove {
  pct: number;
  /** The New York session the move belongs to */
  date: string;
}
export interface SetMoves {
  /** True once every chunk of the set has answered */
  complete: boolean;
  /** How many names were asked */
  asked: number;
  moves: Map<string, SetMove>;
}
const setCache = new Map<string, { at: number; move: SetMove | null }>();
const setInflight = new Set<string>();
let setRev = 0;
const setListeners = new Set<() => void>();
const SET_TTL = 5 * 60_000;
const numOf = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : NaN;
};
export function screenerDayMove(row: Record<string, unknown>): SetMove | null {
  const close = numOf(row.close);
  const prev = numOf(row.prev_close);
  const date = String(row.date ?? '').slice(0, 10);
  if (!(close > 0) || !(prev > 0) || !date) return null;
  const inSession = isTradingDay(nyTodayDate()) && nySessionPhase() === 'open' && date === nyIsoDate();
  const ext = numOf(row.intraday_change);
  const reg = inSession || !Number.isFinite(ext) ? close : close / (1 + ext);
  return { pct: ((reg - prev) / prev) * 100, date };
}
/** The screener row's REGULAR price and its extended-hours print kept apart — the quote's convention (regularPrice /
    extPrice) for a row whose quote has not landed: outside the session `close` is the last (post-market) print and
    `intraday_change` its move off the regular close (audit round 5: META's row read the after-hours $645.89 as its price
    with no AH tag, where every other row read the close and "AH") */
export function screenerPrices(row: Record<string, unknown>): { regular: number; ext: number | null; extPct: number | null } | null {
  const close = numOf(row.close);
  if (!(close > 0)) return null;
  const date = String(row.date ?? '').slice(0, 10);
  const inSession = isTradingDay(nyTodayDate()) && nySessionPhase() === 'open' && date === nyIsoDate();
  const ext = numOf(row.intraday_change);
  if (inSession || !Number.isFinite(ext) || ext === 0) return { regular: close, ext: null, extPct: null };
  const regular = Number((close / (1 + ext)).toFixed(4));
  return Math.abs(close - regular) >= 0.005 ? { regular, ext: close, extPct: ext * 100 } : { regular, ext: null, extPct: null };
}
function chunksOf(names: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of names) {
    if (cur.length && len + t.length + 1 > 300) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(t);
    len += t.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}
function askSet(names: string[]): void {
  const now = Date.now();
  const want = names.filter(t => !setInflight.has(t) && !((setCache.get(t)?.at ?? 0) > now - SET_TTL));
  if (!want.length) return;
  want.forEach(t => setInflight.add(t));
  for (const chunk of chunksOf(want)) {
    void whalesScreener(chunk)
      .catch(() => [] as Record<string, unknown>[])
      .then(rows => {
        const by = new Map<string, Record<string, unknown>>();
        for (const r of Array.isArray(rows) ? rows : []) by.set(String(r.ticker ?? '').toUpperCase(), r);
        const at = Date.now();
        for (const t of chunk) {
          const r = by.get(t);
          setCache.set(t, { at, move: r ? screenerDayMove(r) : null });
          setInflight.delete(t);
        }
        setRev += 1;
        setListeners.forEach(fn => fn());
      });
  }
}
/** Every name's regular-session move in one stated set, read in bulk — `complete` only once the whole set has answered */
export function useSetMoves(tickers: readonly string[]): SetMoves {
  const key = [...new Set(tickers.map(t => t.toUpperCase()).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (key) askSet(key.split(','));
  }, [key]);
  const rv = useSyncExternalStore(
    fn => {
      setListeners.add(fn);
      return () => {
        setListeners.delete(fn);
      };
    },
    () => setRev,
    () => 0,
  );
  return useMemo(() => {
    const moves = new Map<string, SetMove>();
    const names = key ? key.split(',') : [];
    let answered = 0;
    for (const t of names) {
      const hit = setCache.get(t);
      if (!hit) continue;
      answered += 1;
      if (hit.move) moves.set(t, hit.move);
    }
    return { complete: names.length > 0 && answered === names.length, asked: names.length, moves };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rv]);
}
