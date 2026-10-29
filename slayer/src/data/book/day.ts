/* The price and the day's change: the regular session's change kept apart from the move outside it, and the Board's
   ten-second price refresh. */

import { isTradingDay } from '../../core/calendar';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { dayChangeOf, loadRegularCloses, peekRegularCloses, type MarketPhase } from '../dayChange';
import { SIM_DESK } from '../deskMode';
import { uwCall } from '../whales';
import { monDayOf } from './move';
import { num } from './scale';
import { cache, emit, peekEntry, recordIso, type Entry } from './store';
import { CLOSE_MIN, OPEN_MIN } from './tape';


/** When the price Pinpoint reads for a name was printed (epoch ms) — null until its book is live */
export function peekPriceAt(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.priceAt ? e.priceAt : null;
}

/* The Board's prices every ten seconds in one /screener/stocks call while the session runs; the levels refresh on their
   own cadence. Names whose book is not live yet are left alone. */
const pricedAsk = new Map<string, number>();
export const PRICES_MS = 10_000;
export function refreshBoardPrices(tickers: readonly string[]): void {
  if (SIM_DESK || typeof window === 'undefined') return;
  const now = Date.now();
  /* per name: a name asked in the last ten seconds (by the Board or the page on it) is not asked again */
  const live = tickers.map(t => t.toUpperCase()).filter(t => {
    const e = cache.get(t);
    return e?.status === 'live' && e.state?.market_time === 'regular' && now - (pricedAsk.get(t) ?? 0) >= PRICES_MS - 500;
  });
  if (!live.length) return;
  const [y, m, d] = nyIsoDate().split('-').map(Number);
  if (!isTradingDay(new Date(y, m - 1, d)) || nyMinutes() < OPEN_MIN || nyMinutes() >= CLOSE_MIN) return;
  for (const t of live) pricedAsk.set(t, now);
  void (async () => {
    let changed = false;
    for (let i = 0; i < live.length; i += 50) {
      const part = live.slice(i, i + 50);
      const res = await uwCall(`/screener/stocks?ticker=${part.map(encodeURIComponent).join(',')}`);
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const t = String(r.ticker ?? '').toUpperCase();
        const e = cache.get(t);
        const px = num(r.close);
        const at = num(r.quote_time);
        if (!e || e.status !== 'live' || !(px > 0) || !(at > 0) || String(r.date ?? '') !== nyIsoDate()) continue;
        if (e.priceAt && at <= e.priceAt) continue;
        if (Math.abs(px - e.spot) > e.spot * 0.2) continue;
        e.priceAt = at;
        if (px === e.spot) continue;
        e.spot = px;
        e.last = px;
        if (e.state) e.state = { ...e.state, close: px };
        applyDay(e);
        changed = true;
      }
    }
    if (changed) emit();
  })().catch(() => {});
}

export function peekSpot(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.spot > 0 ? e.spot : null;
}

/** The last print when it is not the price the page uses — after hours or pre-market — with which it is; else null */
export function peekExtLast(ticker: string): { price: number; word: 'after hours' | 'pre-market' } | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.last || !(e.last > 0) || Math.abs(e.last - e.spot) < 0.005) return null;
  return e.phase === 'pre' ? { price: e.last, word: 'pre-market' } : e.phase === 'post' ? { price: e.last, word: 'after hours' } : null;
}

export function peekChange(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.dayKnown !== false ? e.changePct : null;
}

/** The day's move as a reader needs it: the regular session's change, and the move outside it kept apart */
export interface DayMove {
  dayPct: number | null;
  extPct: number | null;
  phase: MarketPhase;
}
export function peekDayMove(ticker: string): DayMove | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  return { dayPct: e.dayKnown === false ? null : e.changePct, extPct: e.extPct ?? null, phase: e.phase ?? 'regular' };
}

/* The day's change is today's regular close against the one before it (data/dayChange.ts); after the close
   close − prev_close on the stock-state is the after-hours move, kept apart. */
export function applyDay(entry: Entry): void {
  const st = entry.state;
  if (!st) return;
  const ph = dayChangeOf(st, null).phase;
  /* Every phase but the session needs the regular closes (before the open the lead figure is the last session's change). */
  const needsCloses = ph !== 'regular';
  const closes = peekRegularCloses(entry.ticker);
  const ch = dayChangeOf(st, closes);
  entry.phase = ch.phase;
  entry.dayKnown = Number.isFinite(ch.dayPct) && (!needsCloses || !!closes?.length);
  entry.changePct = entry.dayKnown ? ch.dayPct : 0;
  entry.extPct = ch.extPct;
}

export function needDay(entry: Entry): void {
  if (entry.dayKnown !== false) return;
  const t = entry.ticker;
  void loadRegularCloses(t)
    .then(() => {
      const cur = cache.get(t);
      if (!cur) return;
      applyDay(cur);
      emit();
    })
    .catch(() => {});
}

/** "−1.18%" — the regular session's change; null while it is not known */
const fmtPct = (v: number, digits = 2): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

/** The day's move in words: "−1.18% · after hours +0.05%", "pre-market +0.40%", or "−1.18%" in the session */
export function dayMoveWords(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string; when: string | null } | null {
  const w = dayMoveWordsOf(m, digits);
  if (!w) return null;
  /* the session named by its date when it is not today's (before the open, a weekend or a holiday) */
  const rec = recordIso();
  return { ...w, when: m && m.dayPct != null && rec !== nyIsoDate() ? monDayOf(rec) : null };
}
function dayMoveWordsOf(m: Pick<DayMove, 'dayPct' | 'extPct' | 'phase'> | null | undefined, digits = 2): { main: string; ext: string | null; title: string } | null {
  if (!m) return null;
  const ext = m.extPct != null && Number.isFinite(m.extPct) ? `${m.phase === 'pre' ? 'pre-market' : 'after hours'} ${fmtPct(m.extPct, digits)}` : null;
  if (m.phase === 'pre') {
    /* before the open: the last session's change, the pre-market move beside it */
    return {
      main: m.dayPct != null && Number.isFinite(m.dayPct) ? fmtPct(m.dayPct, digits) : '…',
      ext,
      title: `${longDayOf(recordIso())}’s regular-session change (its 4:00 close against the close before). The session has not opened${ext ? `; ${ext} against that close` : ''}.`,
    };
  }
  if (m.dayPct == null) return { main: '…', ext, title: 'The day’s change is loading (the regular closes are read once a day)' };
  /* the session named by its date when it is not New York's today */
  const rec = recordIso();
  const word = rec === nyIsoDate() ? 'Today’s' : `${longDayOf(rec)}’s`;
  return {
    main: fmtPct(m.dayPct, digits),
    ext,
    title: ext
      ? `${word} regular-session change (4:00 close against the close before), ${fmtPct(m.dayPct, digits)}; ${ext} is the move since the 4:00 close`
      : `${word} change against the regular close before it`,
  };
}
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Thu Oct 22" (data/bookWindow.ts longDay, kept here without the import cycle) */
const longDayOf = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${DOW3[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${monDayOf(iso)}` : iso;
};

/** The ink of a change: green up, red down, neutral at zero */
export const changeInk = (v: number | null | undefined): string => (v == null || Math.abs(v) < 0.005 ? 'rgb(var(--text-secondary))' : v > 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))');
