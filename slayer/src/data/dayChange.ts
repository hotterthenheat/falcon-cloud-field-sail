/*
==================================================
  SLAYER TERMINAL - THE DAY'S CHANGE, BEFORE AND AFTER THE BELL
  (data/dayChange.ts)

  The vendor's /stock/{t}/stock-state is the LATEST bar: after the close it is the post-market bar, and its
  prev_close is TODAY's regular close — so close − prev_close is only the after-hours move (the re-audit, 2026-10-22:
  NVDA read +0.05% on a −4.40% day, AAPL −0.06% on a +1.23% day). The day's change after the bell is today's regular
  close against the regular close before it, read off the daily rows (market_time 'r'); the after-hours move is kept
  apart. In the session and before it, the quote's own prev_close is the prior close and nothing changes.
==================================================
*/
import { whalesDaily, type UwDaily } from './whales';
import { nyIsoDate, nySessionPhase } from '../core/nyTime';
import { isTradingDay, today as nyToday } from '../core/calendar';

export type MarketPhase = 'pre' | 'regular' | 'post' | 'closed';

export interface DayChange {
  /** The regular session's change: the move a reader means by "today" */
  dayPct: number;
  /** The move outside the session (pre-market before the open, post-market after the close), or null in the session */
  extPct: number | null;
  phase: MarketPhase;
  /** The close the day's change is measured from */
  base: number;
}

interface StateLike {
  close?: string | number;
  prev_close?: string | number;
  market_time?: string;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

export const phaseOf = (marketTime: string | undefined): MarketPhase => {
  const m = (marketTime ?? '').toLowerCase();
  if (m.startsWith('pre') || m === 'pr') return 'pre';
  if (m.startsWith('post') || m === 'po' || m.startsWith('after')) return 'post';
  if (m.startsWith('reg') || m === 'r' || m === 'market' || m === 'open') return 'regular';
  return 'closed';
};

/** The regular closes, newest first, one per date */
export function regularCloses(rows: readonly UwDaily[]): { date: string; close: number }[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if ((r.market_time ?? 'r') !== 'r') continue;
    const d = String((r as { date?: string }).date ?? '');
    const c = n(r.close);
    if (d && c > 0) byDate.set(d, c);
  }
  return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, close]) => ({ date, close }));
}

/**
 * The day's change from the quote and the daily rows.
 * Post-market: today's regular close (the quote's prev_close) against the regular close before today.
 * Otherwise: the quote's close against its prev_close (the prior regular close), as the vendor states it.
 */
export function dayChangeOf(state: StateLike, closes: readonly { date: string; close: number }[] | null): DayChange {
  const last = n(state.close);
  const prevClose = n(state.prev_close);
  const phase = phaseOf(state.market_time);
  /* AFTER MIDNIGHT, BEFORE THE OPEN (the third audit, 2026-10-23): the vendor's quote still says "postmarket" — the
     last bar is last evening's — but the New York day has turned. Read as post-market it measured yesterday's close
     against itself (0.00%). On a trading day before 9:30 the move is the pre-market one: the last print against the
     last regular close (the quote's prev_close, which after the bell IS that close). */
  /* — but until a pre-market trade prints, the quote is still last evening's after-hours bar: calling its move
     "pre-market" mislabelled the after-hours move (the fourth audit: "pre-market +0.00%" at 01:30). Overnight the read
     stays the last session's change with its after-hours move; a real pre-market bar arrives as market_time "pre". */
  const overnight = phase === 'post' && isTradingDay(nyToday()) && nySessionPhase() === 'before';
  if (phase === 'post' || phase === 'closed') {
    /* the last regular session (today after the bell; Friday on a weekend or a holiday) against the session before
       it — never the last session against itself, which read ≈0% all weekend */
    const today = nyIsoDate();
    const sessions = (closes ?? []).filter(c => c.date <= today);
    /* after today's bell before the vendor has written today's daily row, today's close is the quote's prev_close */
    /* — only on a trading day: on a weekend or holiday the quote still says "postmarket", and reading Friday's row as
       "missing today" measured Friday's close against itself (the fourth audit, 2026-10-22: AAPL +0.00% on Sat) */
    const todayMissing = phase === 'post' && !overnight && isTradingDay(nyToday()) && sessions[0]?.date !== today;
    const lastSession = todayMissing ? undefined : sessions[0];
    const before = todayMissing ? sessions[0] : sessions[1];
    const regClose = lastSession?.close ?? prevClose;
    if (before && before.close > 0 && regClose > 0) {
      return {
        dayPct: ((regClose - before.close) / before.close) * 100,
        extPct: regClose > 0 && last > 0 ? ((last - regClose) / regClose) * 100 : null,
        phase,
        base: before.close,
      };
    }
  }
  if (phase === 'pre') {
    /* BEFORE THE OPEN THE DAY'S CHANGE IS THE LAST SESSION'S (the sixth audit, 2026-10-23: "SPY $763.96 0.00% · pre
       764.40" beside the Oct 22 close, which closed −1.18%): the last regular close against the one before it; the
       pre-market move is kept apart, against that close */
    const today = nyIsoDate();
    const sessions = (closes ?? []).filter(c => c.date < today);
    const lastClose = sessions[0]?.close ?? prevClose;
    const before = sessions[1];
    return {
      dayPct: before && before.close > 0 && lastClose > 0 ? ((lastClose - before.close) / before.close) * 100 : 0,
      extPct: lastClose > 0 && last > 0 ? ((last - lastClose) / lastClose) * 100 : null,
      phase,
      base: before?.close ?? prevClose,
    };
  }
  return { dayPct: prevClose > 0 && last > 0 ? ((last - prevClose) / prevClose) * 100 : 0, extPct: null, phase, base: prevClose };
}

/* The regular closes per name, read once a New York day (they only change at the close) */
const closesCache = new Map<string, { day: string; closes: { date: string; close: number }[] }>();
const closesInflight = new Map<string, Promise<{ date: string; close: number }[]>>();

export function peekRegularCloses(ticker: string): { date: string; close: number }[] | null {
  const hit = closesCache.get(ticker.toUpperCase());
  return hit && hit.day === nyIsoDate() ? hit.closes : null;
}

export function loadRegularCloses(ticker: string): Promise<{ date: string; close: number }[]> {
  const t = ticker.toUpperCase();
  const hit = peekRegularCloses(t);
  if (hit) return Promise.resolve(hit);
  const running = closesInflight.get(t);
  if (running) return running;
  const p = whalesDaily(t)
    .then(rows => {
      const closes = regularCloses(Array.isArray(rows) ? rows : []).slice(0, 5);
      closesCache.set(t, { day: nyIsoDate(), closes });
      return closes;
    })
    .finally(() => closesInflight.delete(t));
  closesInflight.set(t, p);
  return p;
}
