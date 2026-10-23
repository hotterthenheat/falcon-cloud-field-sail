import type { MarketSnapshot, StrikeNode } from '../types/market';
import { bookToday, isoDate, isTradingDay, nextSession, today as nyToday } from '../core/calendar';
import { nyIsoDate, nySessionPhase, nyWallTime } from '../core/nyTime';
import { registerChainDates } from './chainDates';
import { bookCandles, bookRevision, peekEntry } from './uwBook';

/*
==================================================
  SLAYER TERMINAL - THE EXPIRIES IN HAND
  (data/bookWindow.ts)

  The book’s Expiries card is a window of real dates.
  The clock, the level report and the tape were still
  reading today, or every date, on their own. This
  folds the dates the reader actually picked into one
  chain, so those boxes read the same book the matrix
  is showing.
==================================================
*/

const listedDates = (snapshot: MarketSnapshot): string[] =>
  (snapshot.uwExpiries ?? [])
    .filter(e => snapshot.uwByDate?.[e.date]?.length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dte - b.dte)
    .map(e => e.date);

const add = (into: StrikeNode, n: StrikeNode): void => {
  const w0 = into.callOI + into.putOI;
  const w1 = n.callOI + n.putOI;
  const w = w0 + w1;
  if (w > 0) {
    into.gamma = (into.gamma * w0 + n.gamma * w1) / w;
    into.vanna = (into.vanna * w0 + n.vanna * w1) / w;
    into.charm = (into.charm * w0 + n.charm * w1) / w;
  }
  into.callOI += n.callOI;
  into.putOI += n.putOI;
  into.callGex += n.callGex;
  into.putGex += n.putGex;
  into.callDex += n.callDex;
  into.putDex += n.putDex;
  into.callVex += n.callVex;
  into.putVex += n.putVex;
  into.callVanna += n.callVanna;
  into.putVanna += n.putVanna;
  into.callCharm += n.callCharm;
  into.putCharm += n.putCharm;
  into.callVol = (into.callVol ?? 0) + (n.callVol ?? 0);
  into.putVol = (into.putVol ?? 0) + (n.putVol ?? 0);
  into.netGex = into.callGex + into.putGex;
  into.netDex = into.callDex + into.putDex;
  into.netVex = into.callVex + into.putVex;
  into.netVanna = into.callVanna + into.putVanna;
  into.netCharm = into.callCharm + into.putCharm;
};

/** The strikes of these expiry dates, summed. One date is that date’s own chain. */
export function chainForDates(snapshot: MarketSnapshot, dates: readonly string[]): StrikeNode[] | null {
  const by = snapshot.uwByDate;
  if (!by) return null;
  const chains = dates.map(d => by[d]).filter((c): c is StrikeNode[] => !!c?.length);
  if (!chains.length) return null;
  if (chains.length === 1) return chains[0];
  const acc = new Map<number, StrikeNode>();
  for (const chain of chains) {
    for (const n of chain) {
      const cur = acc.get(n.strike);
      if (!cur) acc.set(n.strike, { ...n, callVol: n.callVol ?? 0, putVol: n.putVol ?? 0 });
      else add(cur, n);
    }
  }
  const out = [...acc.values()].sort((a, b) => a.strike - b.strike);
  /* the flip re-prices each date at its own clock — it has to know which dates this sum is (data/chainDates.ts) */
  registerChainDates(out, dates.filter(d => by[d]?.length));
  return out;
}

/**
 * The same snapshot, with its chain set to the expiries in `dates`.
 * No dates, or a book that does not split by date, is returned unchanged.
 * The whole listed set uses the book’s own aggregate.
 */
export function bookForDates(snapshot: MarketSnapshot, dates: readonly string[] | null | undefined): MarketSnapshot {
  if (!dates?.length || !snapshot.uwByDate) return snapshot;
  const listed = listedDates(snapshot);
  const want = dates.filter(d => snapshot.uwByDate?.[d]?.length);
  if (!want.length) return snapshot;
  if (listed.length && want.length >= listed.length && snapshot.uwChains?.ALL?.length) {
    const all = snapshot.uwChains.ALL;
    return { ...snapshot, chain: all, uwChains: { ...snapshot.uwChains, '0DTE': all, ALL: all } };
  }
  const chain = chainForDates(snapshot, want);
  if (!chain?.length) return snapshot;
  return { ...snapshot, chain, uwChains: { ...snapshot.uwChains, '0DTE': chain, ALL: chain } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The window in the book's own words: "Oct 21" or "Oct 21 → Oct 30". */
export function expirySpan(dates: readonly string[] | null | undefined): string | null {
  if (!dates?.length) return null;
  const fmt = (iso: string): string => {
    const parts = iso.slice(0, 10).split('-');
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!m || !d) return iso.slice(0, 10);
    return `${MONTHS[m - 1]} ${d}`;
  };
  if (dates.length === 1) return fmt(dates[0]);
  return `${fmt(dates[0])} → ${fmt(dates[dates.length - 1])}`;
}

/*
  THE LEVELS' BOOK — ONE PER SCOPE (the ship pass, 2026-10-22: the Board and the Agenda read SPY's supreme 764 off
  today's contracts while the Map's card read 760 off the eight dates its matrix showed; a retail reader saw two
  supremes). Every named level on Pinpoint — supreme, call wall, put wall, flip, pin, net GEX — is read off THIS book:
  the Levels card's scope, never the matrix's window. "Today" is today's own chain (the first live date when nothing
  expires today, as uwBook's chainsFor resolves it); "All expiries" is the whole book. The matrix may still draw more
  dates; anything it sums over its own window is labelled with that window.
*/
export function levelsBook(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): MarketSnapshot {
  const ch = snapshot.uwChains;
  if (!snapshot.liveBook || !ch) return snapshot;
  const pick = scope === 'ALL' ? ch.ALL : ch['0DTE']?.length ? ch['0DTE'] : ch.ALL;
  if (!pick?.length) return snapshot;
  if (snapshot.chain === pick && ch['0DTE'] === pick) return snapshot;
  return { ...snapshot, chain: pick, uwChains: { ...ch, '0DTE': pick } };
}

/** The date the "Today" scope reads (null for the whole book, or before the dates are in) */
export function levelsDate(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): string | null {
  if (scope === 'ALL') return null;
  const front = snapshot.uwChains?.['0DTE'];
  const by = snapshot.uwByDate;
  if (!front?.length || !by) return null;
  return Object.keys(by).find(d => by[d] === front) ?? null;
}

/* ---- WHICH DAY A DATE IS, SAID THE WAY THE CLOCK STANDS (the second re-audit, 2026-10-22) ----------------------------
   After the close the book's "today" is the next session's contracts (bookToday rolls at 16:15), and the pages printed
   "SUPREME · TODAY · OCT 23", "Expires today", "EXPIRES AT THE CLOSE 16%" next to "NOW after the close" — about Friday's
   contracts on Thursday evening. A date is "Today" only while today's session has not closed; after it (or on a day with
   no session) the first session ahead is "Next session"; anything later is its own date. */

/** The session day a reader is in: today's New York date while its session is ahead or running, else none */
export function sessionDay(): { today: string; open: boolean; closed: boolean; next: string } {
  const now = nyToday();
  const iso = nyIsoDate();
  const trading = isTradingDay(now);
  const phase = nySessionPhase();
  const closed = !trading || phase === 'after';
  const nextFrom = closed ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : now;
  return { today: iso, open: trading && phase === 'open', closed, next: isoDate(nextSession(nextFrom)) };
}

/** "Today" · "Next session" · null (a later date) — for the date a level, a share or an expiry belongs to */
export function dayWordOf(date: string | null | undefined): 'Today' | 'Next session' | null {
  if (!date) return null;
  const s = sessionDay();
  if (!s.closed && date === s.today) return 'Today';
  if (date === s.next) return s.closed ? 'Next session' : null;
  return null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Fri 10/23" */
export function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}

/** "Expires today" while today's session runs (or has yet to), "Expires Fri 10/23" after its close — the date the
    expiring share (uwBook peekBellShare) is read for */
export function bellDay(): { date: string; head: string; clock: string; tip: (ticker: string) => string } {
  const date = isoDate(bookToday());
  const today = dayWordOf(date) === 'Today';
  const day = shortDay(date);
  return {
    date,
    head: today ? 'Expires today' : `Expires ${day}`,
    clock: today ? 'Expires at the close' : `Expires ${day}`,
    tip: (ticker: string) =>
      today
        ? `The share of ${ticker}'s hedging in contracts that expire at 4:00 today. It is gone after the close, and the walls it made go with it`
        : `The share of ${ticker}'s hedging in contracts that expire at 4:00 on ${day}, the next session. Today's own contracts expired at today's close`,
  };
}

/** The Levels card's "Today" option in the words the clock stands at: "Today" in or before the session, "Next session"
    after the close */
export const todayScopeLabel = (): string => (sessionDay().closed ? 'Next session' : 'Today');

/** The scope in a reader's words, for a label: "Today · Oct 22", "Next session · Oct 23", "Oct 26 · next expiry",
    "All expiries" */
export function levelsWords(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE', today: string = isoDate(bookToday())): string {
  if (scope === 'ALL') return 'All expiries';
  const d = levelsDate(snapshot, scope);
  /* today's own chain is not in yet: the levels are the whole book's until it lands — say so */
  if (!d) return 'All expiries · today loading';
  const span = expirySpan([d]) ?? d;
  const word = dayWordOf(d);
  void today;
  return word ? `${word} · ${span}` : `${span} · next expiry`;
}

/* ---- THE SESSION THAT RAN TODAY, AFTER ITS CLOSE (the second re-audit, 2026-10-22) -----------------------------------
   "How the levels held · Today · Oct 23" with 0 tests / 0 held / 0 broke on every level, while the price panel showed
   today's real session: after the close the levels moved on to Friday's contracts, and Thursday's prices were tested
   against them. The record of TODAY is today's session against the levels that were live in it:
     · Today scope, a name with a same-day expiry (SPY, QQQ): that date's own book — the vendor still serves this
       morning's rows for the contracts that settled at 4:00 (greek-exposure/strike-expiry); its flip re-priced at the
       session's open. Not loaded → null, and the page says so plainly.
     · Today scope, a name with no same-day expiry (NVDA, AAPL on a Thursday): the front expiry the session was already
       reading — the same contracts as now.
     · All expiries: the whole book at the close (today's expiring contracts are no longer in it — said in the label). */
/* ---- THE SESSION ON RECORD (the fifth audit, 2026-10-23: at 01:00 ET Friday "How the levels held today" counted
   Thursday's bars against Friday's levels — 21 tests on NVDA's flip, last 13:26, all of them Oct 22's). The session a
   report, a count or a price range is of: today's while it runs and after its close; before today's open, or on a day
   with no session, the last one that ran — and that is a different day, named by its date, never "today". */
export interface RecordDay {
  /** The session's date, YYYY-MM-DD (New York) */
  date: string;
  /** True when it is today's own session (running, or closed this afternoon) */
  isToday: boolean;
  /** True once it has closed */
  done: boolean;
}

function prevTradingIso(fromIso: string): string {
  const [y, m, d] = fromIso.split('-').map(Number);
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return fromIso;
}

export function recordDay(): RecordDay {
  const iso = nyIsoDate();
  const phase = nySessionPhase();
  if (isTradingDay(nyToday()) && phase !== 'before') return { date: iso, isToday: true, done: phase === 'after' };
  return { date: prevTradingIso(iso), isToday: false, done: true };
}

/** "Thu Oct 22" */
export function longDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

/** A date said from where the clock stands: "today" for New York's own date, else the day by name, "Thu Oct 22" — never
    "yesterday" (at 01:00 ET a reader's "yesterday" is ambiguous; the fifth audit) — the one rule for every relative-day
    word on Pinpoint */
export function dayRef(date: string | null | undefined): string {
  if (!date) return 'today';
  return date === nyIsoDate() ? 'today' : longDay(date);
}

/** The same, capitalised for a head: "Today", "Thu Oct 22" */
export const DayRef = (date: string | null | undefined): string => {
  const w = dayRef(date);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** "today" / "Thu Oct 22's" — a possessive for the session on record ("today's session", "Thu Oct 22's session") */
export const recordPossessive = (): string => {
  const r = recordDay();
  return r.isToday ? "today's" : `${longDay(r.date)}'s`;
};

export interface SessionBook {
  /** The book the session's levels are read off — null when it is no longer available */
  book: MarketSnapshot | null;
  /** "Today · Oct 22", "Oct 23 · today's front expiry", "All expiries · at today's close" */
  label: string;
  /** Plain words when the book is not available */
  why: string | null;
  /** True after today's close (the report is a finished day) */
  after: boolean;
}

const sessionMemo = new WeakMap<MarketSnapshot, Map<string, SessionBook>>();
export function sessionBook(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): SessionBook {
  /* one object per snapshot, scope and minute — the report memoises on the book it is handed */
  const key = `${scope}|${Math.floor(Date.now() / 60_000)}|${bookRevision()}`;
  let m = sessionMemo.get(snapshot);
  if (!m) sessionMemo.set(snapshot, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const out = sessionBookOf(snapshot, scope);
  m.clear();
  m.set(key, out);
  return out;
}

/* A CLOSED SESSION IS READ AT ITS OWN CLOSE (the third audit, 2026-10-23: QQQ's "Flip crossed today" read 13× and then
   9× after the bell — the morning's book re-priced at each after-hours tick and the running clock). After the bell the
   session's book is priced at the last cash bar's price and minute, so its flip, and every count against it, stop. */
function frozenAtClose(out: SessionBook, ticker: string): SessionBook {
  if (!out.after || !out.book) return out;
  const today = recordDay().date;
  const bars = (bookCandles(ticker) ?? []).filter(b => nyIsoDate(b.time * 1000) === today);
  const last = bars[bars.length - 1];
  if (!last) return out;
  /* the bell itself (16:00 ET), not the last bar's minute — a page on five-minute bars and one on one-minute bars read
     the same instant and the same closing price */
  const [y, m, d] = today.split('-').map(Number);
  return { ...out, book: { ...out.book, spot: last.close, flipAt: nyWallTime(y, m, d, 16, 0) } };
}

function sessionBookOf(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): SessionBook {
  return frozenAtClose(sessionBookRaw(snapshot, scope), snapshot.ticker);
}

function sessionBookRaw(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): SessionBook {
  /* THE SESSION ON RECORD (recordDay): today's while it runs and after its close; before today's open the last one that
     ran — graded against the book live in it, and named by its date */
  const rec = recordDay();
  const after = rec.done;
  if (!after || !snapshot.liveBook) return { book: levelsBook(snapshot, scope), label: levelsWords(snapshot, scope), why: null, after: false };
  const s = { today: rec.date };
  const day = rec.isToday ? "today's" : `${longDay(rec.date)}'s`;
  const then = rec.isToday ? '' : ` · against the book live then`;
  const by = snapshot.uwByDate ?? {};
  const listed = (snapshot.uwExpiries ?? []).map(e => e.date);
  const e0 = peekEntry(snapshot.ticker);
  /* the vendor's own listing still names the date that settled (the book's listing has already dropped it) */
  const sameDay = listed.includes(s.today) || s.today in by || !!e0?.expiries.some(x => x.date === s.today);
  if (scope === 'ALL') {
    /* THE BOOK THAT WAS LIVE IN TODAY'S SESSION, TODAY'S CONTRACTS INCLUDED (the fourth audit, 2026-10-23: the session was
       graded against the post-close book less today's contracts — SPY's flip 776.67 beside the headline's 774.17, its
       call wall 800 where, with Oct 22 in, it was 765). The vendor's live whole book at the bell still carries the
       contracts that expired at 4:00 (uwBook keeps it as `all`; the levels' book takes them off): that is the book the
       session ran on. Each live date re-prices as on the headline; today's expired contracts are carried flat. */
    const e = peekEntry(snapshot.ticker);
    if (sameDay && e?.gammaLive && e.all.length) {
      const chain = e.all.slice();
      registerChainDates(chain, Object.keys(by).filter(d => d >= isoDate(bookToday()) && by[d]?.length));
      return {
        book: { ...snapshot, chain, uwChains: { ...snapshot.uwChains, '0DTE': chain, ALL: chain } },
        label: rec.isToday ? `All expiries · as live in today's session, today's ${expirySpan([s.today])} contracts included` : `${longDay(s.today)} · All expiries${then}, its ${expirySpan([s.today])} contracts included`,
        why: null,
        after,
      };
    }
    return {
      book: levelsBook(snapshot, 'ALL'),
      label: rec.isToday ? (sameDay ? `All expiries · at today's close (today's contracts expired)` : `All expiries · at today's close`) : `${longDay(s.today)} · All expiries · at its close${sameDay ? ` (its ${expirySpan([s.today])} contracts expired)` : ''}`,
      why: null,
      after,
    };
  }
  if (sameDay) {
    const chain = by[s.today];
    if (!chain?.length)
      return {
        book: null,
        label: rec.isToday ? `Today · ${expirySpan([s.today])}` : `${longDay(s.today)}${then}`,
        why: `${rec.isToday ? 'Today' : longDay(s.today)}'s ${expirySpan([s.today])} contracts expired at 4:00 and their book is not loaded here — switch Levels to All expiries for the whole book's levels through ${day.replace(/'s$/, '')}.`,
        after,
      };
    const [y, m, d] = s.today.split('-').map(Number);
    return {
      book: { ...snapshot, chain, uwChains: { ...snapshot.uwChains, '0DTE': chain }, asOf: nyWallTime(y, m, d, 9, 30) },
      label: rec.isToday ? `Today · ${expirySpan([s.today])} · this morning's book` : `${longDay(s.today)}${then} · its ${expirySpan([s.today])} contracts`,
      why: null,
      after,
    };
  }
  const front = levelsDate(snapshot, '0DTE');
  return {
    book: levelsBook(snapshot, '0DTE'),
    label: rec.isToday ? (front ? `${expirySpan([front])} · today's front expiry` : 'Today') : `${longDay(s.today)}${then}${front ? ` · its front expiry ${expirySpan([front])}` : ''}`,
    why: null,
    after,
  };
}
