/* After the close the vendor's stock-state is the post-market bar and its prev_close is today's close, so close − prev_close is only
   the after-hours move. The day's change after the bell is today's regular close against the one before (daily rows, market_time 'r'). */
import { whalesDailyRecent, type UwDaily } from './whales';
import { nyIsoDate, nyMinutes, nySessionPhase } from '../core/nyTime';
import { isTradingDay, sessionCloseMinOn, today as nyToday } from '../core/calendar';

export type MarketPhase = 'pre' | 'regular' | 'post' | 'closed';

interface DayChange {
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
  /** The vendor's last print (tape_time, ISO or epoch ms) — a "regular" bar whose print is from an earlier New York
      day is the last session's, not today's */
  tape_time?: string | number;
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

/** Post-market: the quote's prev_close (today's close) against the regular close before today; otherwise the quote's close against its prev_close. */
export function dayChangeOf(state: StateLike, closes: readonly { date: string; close: number }[] | null): DayChange {
  const last = n(state.close);
  const prevClose = n(state.prev_close);
  /* A thin name's regular bar whose print is from an earlier New York day is read as the closed session it belongs to. */
  const raw = phaseOf(state.market_time);
  const tapeMs = typeof state.tape_time === 'number' ? state.tape_time : Date.parse(String(state.tape_time ?? ''));
  const phase: MarketPhase = raw === 'regular' && Number.isFinite(tapeMs) && nyIsoDate(tapeMs) < nyIsoDate() ? 'closed' : raw;
  /* After midnight the quote still says "postmarket" though the day has turned; on a trading day before 09:30 the move is the pre-market one. */
  /* …but until a pre-market trade prints, the quote is last evening's after-hours bar: overnight it stays the last session's change
     with its after-hours move; a real pre-market bar arrives as market_time "pre". */
  const overnight = phase === 'post' && isTradingDay(nyToday()) && nySessionPhase() === 'before';
  if (phase === 'post' || phase === 'closed') {
    /* the last regular session (today after the bell; Friday on a weekend or a holiday) against the session before
       it — never the last session against itself, which read ≈0% all weekend */
    const today = nyIsoDate();
    const sessions = (closes ?? []).filter(c => c.date <= today);
    /* after today's bell before the vendor has written today's daily row, today's close is the quote's prev_close */
    /* Only on a trading day: on a weekend or holiday Friday's row is not "missing today". */
    const todayMissing = phase === 'post' && !overnight && isTradingDay(nyToday()) && sessions[0]?.date !== today;
    const lastSession = todayMissing ? undefined : sessions[0];
    const before = todayMissing ? sessions[0] : sessions[1];
    const regClose = lastSession?.close ?? prevClose;
    if (!(before && before.close > 0 && regClose > 0)) {
      return { dayPct: Number.NaN, extPct: null, phase, base: prevClose };
    }
      return {
        dayPct: ((regClose - before.close) / before.close) * 100,
        /* a stale regular bar is the session's last print, not an after-hours one */
        extPct: raw !== 'regular' && regClose > 0 && last > 0 && Math.abs(last - regClose) >= 0.005 ? ((last - regClose) / regClose) * 100 : null,
        phase,
        base: before.close,
      };
  }
  if (phase === 'pre') {
    /* Before the open the day's change is the last session's (its close against the one before); the pre-market move is kept apart. */
    const today = nyIsoDate();
    const sessions = (closes ?? []).filter(c => c.date < today);
    const lastClose = sessions[0]?.close ?? prevClose;
    const before = sessions[1];
    return {
      dayPct: before && before.close > 0 && lastClose > 0 ? ((lastClose - before.close) / before.close) * 100 : Number.NaN,
      extPct: lastClose > 0 && last > 0 && Math.abs(last - lastClose) >= 0.005 ? ((last - lastClose) / lastClose) * 100 : null,
      phase,
      base: before?.close ?? prevClose,
    };
  }
  return { dayPct: prevClose > 0 && last > 0 ? ((last - prevClose) / prevClose) * 100 : Number.NaN, extPct: null, phase, base: prevClose };
}

/* ---- The app's one price/change convention, off a last trade and the daily closes (any feed) ----
   headline price = the last trade, any session, with its time;
   the day's change = the last regular session's close (the live price inside the session) against the regular close
   before it — on a weekend or a holiday that is the last session's change, named by its date;
   outside the session the last trade's move from that regular close is kept apart, labelled after hours / pre-market. */
export interface CloseMove {
  /** The regular session's change, percent; null while the close it needs is not written (after the bell, before the daily row) */
  dayPct: number | null;
  /** The move of the last trade from the last regular close, outside the session; null in the session or when equal */
  extPct: number | null;
  /** Which extended session the last trade is in */
  extWord: 'pre-market' | 'after hours' | null;
  phase: MarketPhase;
  /** The close the day's change is measured from */
  base: number | null;
  /** The last regular close (outside the session) and its New York date */
  regClose: number | null;
  regDate: string | null;
}

const isoToDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The day's change and the extended move off a last trade, its instant, and the regular closes (any order, one per
    date). `todayClose` is today's regular close when another feed already has it (after the bell, before the daily row). */
export function moveOffCloses(price: number, priceAt: number, closesIn: readonly { date: string; close: number }[], now = Date.now(), todayClose: number | null = null): CloseMove {
  const today = nyIsoDate(now);
  const trading = isTradingDay(isoToDate(today));
  const m = nyMinutes(now);
  const closes = [...closesIn].filter(c => c.close > 0).sort((a, b) => b.date.localeCompare(a.date));
  if (todayClose && todayClose > 0 && !closes.some(c => c.date === today)) closes.unshift({ date: today, close: todayClose });
  const none: CloseMove = { dayPct: null, extPct: null, extWord: null, phase: 'closed', base: null, regClose: null, regDate: null };
  if (!(price > 0)) return none;
  const printDay = priceAt > 0 ? nyIsoDate(priceAt) : today;
  const inSession = trading && m >= 570 && m < sessionCloseMinOn(today);
  if (inSession && printDay === today) {
    const base = closes.find(c => c.date < today)?.close ?? null;
    return { ...none, phase: 'regular', base, dayPct: base ? ((price - base) / base) * 100 : null };
  }
  /* outside the session: the last regular session whose close is due by now */
  const due = (c: { date: string }) => c.date < today || (c.date === today && trading && m >= sessionCloseMinOn(today));
  const sessions = closes.filter(due);
  const todayMissing = trading && m >= sessionCloseMinOn(today) && sessions[0]?.date !== today;
  const last = todayMissing ? undefined : sessions[0];
  const before = todayMissing ? undefined : sessions[1];
  const printMin = priceAt > 0 ? nyMinutes(priceAt) : m;
  const extWord: CloseMove['extWord'] = printDay === today && trading && printMin >= 240 && printMin < 570 ? 'pre-market' : 'after hours';
  const phase: MarketPhase = extWord === 'pre-market' ? 'pre' : trading && m >= 240 ? 'post' : 'closed';
  if (!last) return { ...none, phase, base: sessions[0]?.close ?? null };
  const ext = Math.abs(price - last.close) >= 0.005 ? ((price - last.close) / last.close) * 100 : null;
  return {
    dayPct: before ? ((last.close - before.close) / before.close) * 100 : null,
    extPct: ext,
    extWord: ext != null ? extWord : null,
    phase,
    base: before?.close ?? null,
    regClose: last.close,
    regDate: last.date,
  };
}

/** "−1.77%" with a true minus sign */
export const signedPct = (v: number, digits = 2): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Fri Oct 30" for a New York date other than today, else null */
export const sessionWhen = (iso: string | null | undefined): string | null => {
  if (!iso || iso === nyIsoDate()) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${DOW3[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MON3[m - 1]} ${d}`;
};

/** The hover of a day's change by the one convention: which session, which closes, and the extended move apart */
export function closeMoveTitle(m: { pct: number | null; base: number | null; ext: number | null; extWord: string | null; regClose: number | null; regDate: string | null }): string {
  const day = sessionWhen(m.regDate);
  const head =
    m.pct == null
      ? 'Today’s regular close is not written yet'
      : `${day ? `${day}’s regular-session change` : 'The day’s change'}${m.regClose != null && m.base != null ? `: ${m.regClose.toFixed(2)} close against ${m.base.toFixed(2)}` : m.base != null ? `, against the regular close ${m.base.toFixed(2)}` : ''}`;
  return `${head}${m.ext != null ? ` · ${m.extWord ?? 'after hours'} ${signedPct(m.ext)} since that close` : ''}`;
}

/* The regular closes per name, read once a New York day (they only change at the close) */
const closesCache = new Map<string, { day: string; closes: { date: string; close: number }[] }>();
const closesInflight = new Map<string, Promise<{ date: string; close: number }[]>>();

export function peekRegularCloses(ticker: string): { date: string; close: number }[] | null {
  const hit = closesCache.get(ticker.toUpperCase());
  return hit && hit.day === nyIsoDate() ? hit.closes : null;
}

/** Regular closes read off a tape the vendor's daily rows do not cover (an index, or a stock while that daily is empty). A vendor daily already in the cache is left alone unless `force`. */
export function noteBarCloses(ticker: string, closes: readonly { date: string; close: number }[], force = false): void {
  if (!closes.length) return;
  const t = ticker.toUpperCase();
  if (!force && peekRegularCloses(t)?.length) return;
  const next = closes.slice(0, 5).map(c => ({ date: c.date, close: c.close }));
  const cur = closesCache.get(t);
  const day = nyIsoDate();
  if (cur && cur.day === day && cur.closes.length === next.length && cur.closes.every((c, i) => c.date === next[i].date && c.close === next[i].close)) return;
  closesCache.set(t, { day, closes: next });
}

export function loadRegularCloses(ticker: string): Promise<{ date: string; close: number }[]> {
  const t = ticker.toUpperCase();
  const hit = peekRegularCloses(t);
  if (hit) return Promise.resolve(hit);
  const running = closesInflight.get(t);
  if (running) return running;
  const p = whalesDailyRecent(t)
    .then(rows => {
      const closes = regularCloses(Array.isArray(rows) ? rows : []).slice(0, 5);
      /* an empty daily is not a close — caching it blocked the tape's own closes for the rest of the day */
      if (closes.length) closesCache.set(t, { day: nyIsoDate(), closes });
      return closes;
    })
    .finally(() => closesInflight.delete(t));
  closesInflight.set(t, p);
  return p;
}
