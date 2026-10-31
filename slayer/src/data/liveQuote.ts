/* One quote: the last print, the regular session's change (data/dayChange.ts) and the extended-hours move kept apart, labelled by `phase`.
   A name with no print yet is null. */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { peekSpot, subscribeBook, tapeQuote } from './uwBook';
import { whalesQuote, whalesScreener, whalesState } from './whales';
import { BoundedMap } from './boundedMap';
import { dayChangeOf, loadRegularCloses, peekRegularCloses, type MarketPhase } from './dayChange';
import { nyClock, nyIsoDate, nyMinutes, nySessionPhase } from '../core/nyTime';
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
  /** The regular price: the last print in the session, the last regular close outside it; every page that prints "the price" prints this. */
  regularPrice: number;
  /** The extended-hours print (pre-market or after hours) when it differs from the regular price, else null — shown
      apart, labelled by `phase`, timed by `tapeAt` */
  extPrice: number | null;
  /** Epoch ms of the vendor's last print (tape_time), else of our read */
  tapeAt: number;
  at: number;
}

const TTL = 15_000;
/* How often a quote is re-read: 15 s in the regular session, a minute in extended hours (04:00–09:30, 16:00–20:00),
   15 minutes when nothing trades; never while the tab is hidden. */
function ttlNow(): number {
  if (!isTradingDay(nyTodayDate())) return 15 * 60_000;
  const m = nyMinutes();
  if (m >= 570 && m < 960) return TTL;
  if (m >= 240 && m < 1200) return 60_000;
  return 15 * 60_000;
}
/* the stock-state counts as stalled market-wide when a name's print is this old in the session (a thin name can go
   minutes without a trade; ten minutes on a name the page asks for is the vendor, not the tape) */
const STALL_MARKET = 10 * 60_000;
const STALL_HOLD = 5 * 60_000;
let stalledAt = 0;
interface Raw {
  close: number;
  prev_close: number;
  market_time?: string;
  tapeAt: number;
  at: number;
}
/* bounded (data/boundedMap.ts): every name a long-open tab ever showed would otherwise stay here */
const raw = new BoundedMap<string, Raw>(500);
const inflight = new Set<string>();
const listeners = new Set<() => void>();

let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};

const memo = new BoundedMap<string, LiveQuote>(500);

function quoteOf(t: string): LiveQuote | null {
  const r = raw.get(t);
  if (!r) return null;
  const bookSpot = peekSpot(t);
  const closes = peekRegularCloses(t);
  /* after the bell the day's change needs the regular closes: until they land the quote is not given (its own
     close − prev_close would be the after-hours move alone, printed as the day's) */
  const ch = dayChangeOf({ close: r.close, prev_close: r.prev_close, market_time: r.market_time, tape_time: r.tapeAt }, closes);
  if (!closes && ch.phase !== 'regular' && ch.phase !== 'pre') return null;
  /* (pre-market reads the closes too, for the last session's change — loaded beside the quote, never waited on) */
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
  /* Object.is: a NaN figure must still match itself, or every read is a new snapshot and useSyncExternalStore loops */
  const same = (x: unknown, y: unknown) => Object.is(x, y);
  if (prev && same(prev.spot, spot) && same(prev.changePct, changePct) && same(prev.extPct, ch.extPct) && prev.phase === ch.phase && same(prev.regClose, regClose) && same(prev.lastSessionPct, lastSessionPct) && same(prev.tapeAt, r.tapeAt) && same(prev.regularPrice, regularPrice) && same(prev.extPrice, extPrice)) return prev;
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
  if (hit && Date.now() - hit.at < ttlNow()) return;
  if (hit && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  inflight.add(t);
  /* While stock-state is known stalled (any name in the last five minutes), a name already read today asks the quote alone, one call not two. */
  if (hit && hit.prev_close > 0 && (hit.market_time ?? '').toLowerCase().startsWith('reg') && nySessionPhase() === 'open' && Date.now() - stalledAt < STALL_HOLD) {
    whalesQuote(t)
      .then(q => {
        const qp = Number(q?.last_trade?.price);
        const qt = Number(q?.last_trade?.time);
        raw.set(t, qp > 0 && Number.isFinite(qt) && qt >= hit.tapeAt ? { ...hit, close: qp, tapeAt: qt, at: Date.now() } : { ...hit, at: Date.now() });
        emit();
      })
      .catch(() => {})
      .finally(() => inflight.delete(t));
    return;
  }
  whalesState(t)
    .then(async s => {
      const close = Number(s?.close);
      const prev = Number(s?.prev_close);
      if (!(close > 0)) {
        await fillTapeQuote(t);
        return;
      }
      let mt = typeof s?.market_time === 'string' ? s.market_time : undefined;
      let tape = Date.parse(String((s as { tape_time?: string } | null)?.tape_time ?? ''));
      let px = close;
      /* Outside the session a "regular" stock-state older than two minutes is not believed; the quote's phase and last trade are. */
      const sessionOpen = isTradingDay(nyTodayDate()) && nySessionPhase() === 'open';
      if ((mt ?? '').toLowerCase().startsWith('reg') && !sessionOpen && Number.isFinite(tape) && Date.now() - tape > 120_000) {
        const q = await whalesQuote(t).catch(() => null);
        const qp = Number(q?.last_trade?.price);
        const qt = Number(q?.last_trade?.time);
        const qm = typeof q?.market_time === 'string' ? q.market_time : undefined;
        if (qp > 0 && Number.isFinite(qt) && qt > tape && qm && !qm.toLowerCase().startsWith('reg')) {
          px = qp;
          tape = qt;
          mt = qm;
        }
      }
      /* In the session, when stock-state's print is over two minutes old, the quote's newer last trade is the price. */
      if ((mt ?? '').toLowerCase().startsWith('reg') && nySessionPhase() === 'open' && Number.isFinite(tape) && Date.now() - tape > 120_000) {
        if (Date.now() - tape > STALL_MARKET) stalledAt = Date.now();
        const q = await whalesQuote(t).catch(() => null);
        const qp = Number(q?.last_trade?.price);
        const qt = Number(q?.last_trade?.time);
        if (qp > 0 && Number.isFinite(qt) && qt > tape) {
          px = qp;
          tape = qt;
        }
      }
      raw.set(t, { close: px, prev_close: prev > 0 ? prev : 0, market_time: mt, tapeAt: Number.isFinite(tape) ? tape : Date.now(), at: Date.now() });
      emit();
      /* outside the session the day's change needs the regular close before today — read once a New York day */
      const stale = Number.isFinite(tape) && nyIsoDate(tape) < nyIsoDate();
      const m = (mt ?? '').toLowerCase();
      if ((!m.startsWith('reg') || stale) && !peekRegularCloses(t)) {
        await loadRegularCloses(t).catch(() => null);
        emit();
      }
    })
    .catch(async () => {
      await fillTapeQuote(t);
    })
    .finally(() => inflight.delete(t));
}

/** The vendor's stock-state did not answer. The terminal's own print is the price — never a bid, never a made-up close. */
async function fillTapeQuote(t: string): Promise<void> {
  const q = await tapeQuote(t).catch(() => null);
  if (!q || !(q.close > 0)) return;
  const tape = Date.parse(q.tape_time);
  raw.set(t, { close: q.close, prev_close: q.prev_close > 0 ? q.prev_close : 0, market_time: q.market_time, tapeAt: Number.isFinite(tape) ? tape : Date.now(), at: Date.now() });
  emit();
}

/** The price of the session this quote is in. `regularPrice` is the cash close, and it is not this number outside that session. */
export function sessionPrice(q: LiveQuote | null | undefined): number | null {
  if (!q) return null;
  if (q.phase !== 'regular' && q.extPrice != null && q.extPrice > 0) return q.extPrice;
  return q.spot > 0 ? q.spot : null;
}

/** The price, said as which price it is. The lead is the session we are in. The regular close is named beside it, not in its place. */
export function priceWords(q: LiveQuote | null | undefined): { lead: number; line: string } | null {
  if (!q) return null;
  const clock = `${nyClock(q.tapeAt, { zone: true })}`;
  const lead = sessionPrice(q);
  if (lead == null) return null;
  if (q.phase === 'regular' || q.regClose == null || Math.abs(lead - q.regClose) < 0.005) return { lead, line: `${lead.toFixed(2)} · ${clock}` };
  const word = q.phase === 'pre' ? 'pre-market' : 'after hours';
  return { lead, line: `${lead.toFixed(2)} ${word} · ${q.regClose.toFixed(2)} close` };
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

/* ---- A whole set's day moves, read in bulk off /screener/stocks (~60 names a call) and given only once the whole set is in.
   The screener has no regular close outside the session, so those closes come from the daily rows (dayChange loadRegularCloses) ---- */
interface SetMove {
  pct: number;
  /** The New York session the move belongs to */
  date: string;
}
interface SetMoves {
  /** True once every name of the set is settled: read, or ruled out of the lead */
  complete: boolean;
  /** How many names were asked */
  asked: number;
  /** How many the screener answered */
  screened: number;
  /** The names whose regular-session move was read */
  moves: Map<string, SetMove>;
}
const numOf = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : NaN;
};
type Closes = readonly { date: string; close: number }[];
const inSessionRow = (date: string): boolean => isTradingDay(nyTodayDate()) && nySessionPhase() === 'open' && date === nyIsoDate();

/** One screener row read against the name's regular closes: the regular price, the regular session's move and its date,
    and the extended-hours print apart. Outside the session, without the closes there is no read (null) — the row's own
    close is an extended print and its intraday_change is off the open. */
interface ScreenerRead {
  /** The regular price: the last print in the session, the last regular close outside it */
  regular: number;
  /** The regular session's change, percent (null when the close before it is not in hand) */
  pct: number | null;
  /** The New York session `regular` and `pct` belong to */
  date: string;
  /** The extended-hours print when it differs from the regular close, else null */
  ext: number | null;
  extPct: number | null;
}
export function screenerRead(row: Record<string, unknown>, closes: Closes | null): ScreenerRead | null {
  const close = numOf(row.close);
  const prev = numOf(row.prev_close);
  const date = String(row.date ?? '').slice(0, 10);
  if (!(close > 0) || !date) return null;
  if (inSessionRow(date)) return { regular: close, pct: prev > 0 ? ((close - prev) / prev) * 100 : null, date, ext: null, extPct: null };
  if (!closes || !closes.length) return null;
  /* the row's own session when its daily row is written; before the open (a row already dated today, its close a
     pre-market print) the last session before it */
  const own = closes.find(c => c.date === date);
  const last = own ?? closes.find(c => c.date < date);
  if (!last) return null;
  /* after today's bell, before the vendor writes today's daily row, the regular close is not in hand: the row's close
     stands, unlabelled as extended (the quote's own rule in dayChange.ts reads its prev_close there) */
  if (!own && date === nyIsoDate() && nySessionPhase() === 'after') return { regular: close, pct: prev > 0 ? ((close - prev) / prev) * 100 : null, date, ext: null, extPct: null };
  const before = closes.find(c => c.date < last.date);
  const base = before?.close ?? (own && prev > 0 ? prev : NaN);
  const pct = base > 0 ? ((last.close - base) / base) * 100 : null;
  const ext = Math.abs(close - last.close) >= 0.005 ? close : null;
  return { regular: last.close, pct, date: last.date, ext, extPct: ext != null ? ((close - last.close) / last.close) * 100 : null };
}
/** The regular session's move off one screener row, given the name's regular closes (null when it cannot be read) */
function screenerDayMove(row: Record<string, unknown>, closes: Closes | null): SetMove | null {
  const r = screenerRead(row, closes);
  return r && r.pct != null ? { pct: r.pct, date: r.date } : null;
}
/** Whether a screener row needs the daily rows for its regular price (every row outside the session) */
export const screenerNeedsCloses = (row: Record<string, unknown>): boolean => !inSessionRow(String(row.date ?? '').slice(0, 10));

/* The largest move a row could have: the regular close sits inside the session's range, so a name whose range is inside the leader's move
   cannot lead and its daily rows are not read. No bound before the open on a row dated today. */
const moveBound = (row: Record<string, unknown>): number => {
  const date = String(row.date ?? '').slice(0, 10);
  const prev = numOf(row.prev_close);
  const hi = numOf(row.high);
  const lo = numOf(row.low);
  if (date >= nyIsoDate() && nySessionPhase() !== 'after') return Infinity;
  if (!(prev > 0) || !(hi > 0) || !(lo > 0)) return Infinity;
  return Math.max(Math.abs(hi / prev - 1), Math.abs(lo / prev - 1)) * 100;
};

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

interface SetResult {
  at: number;
  complete: boolean;
  screened: number;
  moves: Map<string, SetMove>;
}
const setResults = new BoundedMap<string, SetResult>(40);
const setRunning = new Set<string>();
let setRev = 0;
const setListeners = new Set<() => void>();
const SET_TTL = 5 * 60_000;

async function runSet(key: string): Promise<void> {
  const names = key.split(',');
  const rows = new Map<string, Record<string, unknown>>();
  await Promise.all(
    chunksOf(names).map(chunk =>
      whalesScreener(chunk)
        .catch(() => [] as Record<string, unknown>[])
        .then(rs => {
          for (const r of Array.isArray(rs) ? rs : []) rows.set(String(r.ticker ?? '').toUpperCase(), r);
        }),
    ),
  );
  const moves = new Map<string, SetMove>();
  const publish = (complete: boolean) => {
    setResults.set(key, { at: Date.now(), complete, screened: rows.size, moves: new Map(moves) });
    setRev += 1;
    setListeners.forEach(fn => fn());
  };
  const pending: { t: string; row: Record<string, unknown>; bound: number }[] = [];
  for (const t of names) {
    const row = rows.get(t);
    if (!row) continue;
    const m = screenerNeedsCloses(row) ? screenerDayMove(row, peekRegularCloses(t)) : screenerDayMove(row, null);
    if (m) moves.set(t, m);
    else if (screenerNeedsCloses(row)) pending.push({ t, row, bound: moveBound(row) });
  }
  pending.sort((a, b) => b.bound - a.bound);
  const lead = () => Math.max(0, ...[...moves.values()].map(m => Math.abs(m.pct)));
  /* the daily rows of the names that could still lead, largest possible move first, three at a time (the key's slots) */
  for (let i = 0; i < pending.length; i += 3) {
    const batch = pending.slice(i, i + 3).filter(p => !(p.bound < lead()));
    if (!batch.length) break;
    await Promise.all(
      batch.map(p =>
        loadRegularCloses(p.t)
          .then(closes => {
            const m = screenerDayMove(p.row, closes);
            if (m) moves.set(p.t, m);
          })
          .catch(() => undefined),
      ),
    );
  }
  publish(true);
}

function askSet(key: string): void {
  if (setRunning.has(key)) return;
  const hit = setResults.get(key);
  if (hit && hit.at > Date.now() - SET_TTL) return;
  setRunning.add(key);
  void runSet(key).finally(() => setRunning.delete(key));
}
/** The regular-session move over one stated set, read in bulk — `complete` only once every name is read or ruled out of
    the lead (its whole session range inside the leader's move) */
export function useSetMoves(tickers: readonly string[]): SetMoves {
  const key = [...new Set(tickers.map(t => t.toUpperCase()).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (key) askSet(key);
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
    const names = key ? key.split(',') : [];
    const hit = key ? setResults.get(key) : undefined;
    return { complete: !!hit?.complete && names.length > 0, asked: names.length, screened: hit?.screened ?? 0, moves: hit?.moves ?? new Map() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rv]);
}
