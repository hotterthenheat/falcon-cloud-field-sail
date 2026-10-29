/* The book's store: one Entry per name, the revision readers subscribe to, the names whose calls jump the key's queue, and
   the small shared records the loaders and readers both hold. */

import { useSyncExternalStore } from 'react';
import { bookToday, isoDate, isTradingDay } from '../../core/calendar';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { type MarketPhase } from '../dayChange';
import { type Candle, type GexSnapshot, type StrikeNode } from '../../types/market';
import { uwCall } from '../whales';
import { ownIvDates, type LiveGamma } from './scale';
import { OPEN_MIN } from './tape';

export const BOARD_MS = 90_000;
export const FULL_MS = 45_000;

export type BookMode = 'board' | 'full';

export interface Entry {
  ticker: string;
  /** How the failed read answered, when the message named a status. */
  http?: number;
  /** loading until the book lands, live once it has, error after the read threw. */
  status?: 'loading' | 'live' | 'error';
  at: number;
  full: boolean;
  wantFull: boolean;
  spot: number;
  prev: number;
  /** The regular session's change, percent (data/dayChange.ts) — 0 until `dayKnown` */
  changePct: number;
  /** The move outside the session (pre-market / after hours), percent, or null in the session */
  extPct?: number | null;
  phase?: MarketPhase;
  /** False after the bell until the regular closes land (the state's own change would be the after-hours move) */
  dayKnown?: boolean;
  /** The last print — the after-hours or pre-market one outside the session (`spot` is then the regular close) */
  last?: number;
  /** The stock-state as read: close, prev_close, market_time */
  state?: { close: number; prev_close: number; market_time?: string };
  iv: number;
  /** Vendor implied move into today's expiry, dollars. 0 until that row exists. Already the move from the quote — not a full-year vol. */
  impliedMove: number;
  /** One session of the surface, as a fraction of spot (interpolated 1-day). 0 until it lands. */
  dayMoveFrac: number;
  /** The interpolated 1-day implied vol, annualised fraction (interpolated-iv, days = 1) — one FULL session's vol, which
      the same-day expiry's own implied move stops being once its session runs (peekDaySigma) */
  dayIv?: number;
  all: StrikeNode[];
  byDate: Record<string, StrikeNode[]>;
  expiries: { date: string; dte: number }[];
  flow: Map<number, { call: number; put: number }>;
  /** Cash session only. The book, the clock and the level report read these. */
  candles: Candle[];
  /** Every bar the vendor sent, including premarket and after hours. */
  tape: Candle[];
  history: GexSnapshot[];
  /** Prior sessions' close-of-day strike books. One snapshot each, stamped on that session's last bar. Not a walk of today's chain. */
  closes?: GexSnapshot[];
  /** Same-day expiry, and everything after it. Absent until both books exist. */
  history0?: GexSnapshot[];
  historyRest?: GexSnapshot[];
  /** When the per-expiry chains last landed. The aggregate refreshes without them. */
  expiriesAt?: number;
  /** The vendor's gamma per expiry (greek-exposure/expiry): gross dollars a date, for the share that expires today */
  totals?: { date: string; gross: number }[];
  /** When `totals` (and, on a board-only name, the front date's chain) last landed */
  totalsAt?: number;
  /** Each expiry's at-the-money implied vol (volatility/term-structure), annualised fraction — the flip re-prices a
      date's legs with it where that date's own contract vols are not in (data/flipLevel.ts) */
  termIv?: Record<string, number>;
  /** The front date's contract rows (open interest, vol, gamma) are painted on its chain */
  frontFacts?: boolean;
  /** The dates whose contract rows have been read (painted, or asked and refused) — the flip is final only once its own-vol
      dates are here. */
  factsDates?: Set<string>;
  /** Every listed date has landed at least once (a later refresh re-reads them in place) — until then the Map's
      matrix window is still growing, and says so */
  everFull?: boolean;
  /** Each expiry's own implied move (volatility/term-structure implied_move), dollars from the quote into that expiry */
  termMove?: Record<string, number>;
  /** The vendor's own scaling of its implied move against the ATM vol, k in move = k·S·σ·√(dte/365) (≈ 0.68), fitted
      off its own term-structure rows — the formula a date with no implied move of its own is read with */
  termK?: number;
  /** The calendar days to each expiry the vendor's implied moves are quoted over (its `dte`) */
  termDte?: Record<string, number>;
  /** The whole book's gamma is the vendor's live open-interest book (spot-exposures/strike), not the morning snapshot */
  gammaLive?: boolean;
  /** When the price in `spot` was printed (epoch ms): the state's tape time, the newest bar's, or the price refresh's quote */
  priceAt?: number;
}

export const cache = new Map<string, Entry>();
export const gen = new Map<string, number>();
const listeners = new Set<() => void>();
let rev = 0;

export const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};
/** A settled date's live rows (ticker|date), kept only to come off the whole book's live total */
export const settledLive = new Map<string, LiveGamma>();
export const liveGammaCache = new Map<string, { at: number; rows: LiveGamma }>();
export const liveGammaWait = new Map<string, Promise<LiveGamma | null>>();
export const LIVE_GAMMA_MS = 60_000;

/* Each spot-exposures row carries the price and minute it was priced at; the flip re-prices each leg from there, so a
   shut market's flip stands still until the vendor prints a new minute. */
export const gammaPriced = new Map<string, { price: number; at: number }>();
/** The price and the instant the vendor priced a name's live gamma rows (one date, or the whole book) — null until in */
export const peekGammaPriced = (ticker: string, date: string | null): { price: number; at: number } | null =>
  gammaPriced.get(`${ticker.toUpperCase()}|${date ?? 'ALL'}`) ?? null;

/** Last two regular sessions, for the chart only. SPX keeps three so the prior closes can carry their own books. The book itself stays on today's cash bars. */
export const chartSpan = new Map<string, Candle[]>();
/** Every bar the feed sent, all sessions. A session filter reads this. It never borrows another session. */
export const chartAll = new Map<string, Candle[]>();

/* Never an expired date: a choice resolves to its own date, else the first listing after it, else the nearest live one. */
export const closestDate = (want: string, dates: string[], floor: string = isoDate(bookToday())): string | null => {
  const live = dates.filter(d => d >= floor).sort();
  if (live.includes(want)) return want;
  const after = live.find(d => d > want);
  const target = Date.parse(`${want}T00:00:00Z`);
  if (after && Date.parse(`${after}T00:00:00Z`) - target <= 4 * 86_400_000) return after;
  let best: string | null = null;
  let dist = 4 * 86_400_000;
  for (const d of live) {
    const dd = Math.abs(Date.parse(`${d}T00:00:00Z`) - target);
    if (dd < dist) {
      dist = dd;
      best = d;
    }
  }
  return best;
};

export const LADDER_DTE: [string, number][] = [
  ['0DTE', 0],
  ['1D', 1],
  ['2D', 2],
  ['5D', 5],
  ['7D', 7],
];

export function peekEntry(ticker: string): Entry | undefined {
  return cache.get(ticker.toUpperCase());
}

export function bookStatus(ticker: string): Entry['status'] | 'idle' {
  return peekEntry(ticker)?.status ?? 'idle';
}

export function subscribeBook(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The book's revision — bumps whenever any name's book lands or changes. Caches keyed on a snapshot key on this too. */
export const bookRevision = (): number => rev;

export function useBookRev(): number {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev
  );
}

/* The names on screen first: the key allows three calls at once, so the queue order is the fill order — the name the
   desk is on, and SPY, jump it. */
const hotNames = new Set<string>(['SPY']);
let hotActive: string | null = null;
/** The name the desk is on — its calls jump the key's queue (SPY's always do) */
export function markHotName(ticker: string | null | undefined): void {
  const t = ticker?.trim().toUpperCase() || null;
  if (t === hotActive) return;
  if (hotActive && hotActive !== 'SPY') hotNames.delete(hotActive);
  hotActive = t;
  if (t) hotNames.add(t);
}
export const isHot = (ticker: string): boolean => hotNames.has(ticker.toUpperCase());

export async function hotGet<T>(path: string, hot: boolean): Promise<T> {
  const got = await uwCall(path, hot);
  if (got.error) throw new Error(got.error);
  return got.data as T;
}

/** The session on record's own date has been asked for — until then a page that needs that book says "…". */
export const recordAsked = new Set<string>();
export function peekRecordAsked(ticker: string, date: string): boolean {
  const e = cache.get(ticker.toUpperCase());
  if (!e) return false;
  return recordAsked.has(`${e.ticker}|${date}`) || !!e.byDate[date]?.length || !!emptyDates.get(e.ticker)?.has(date) || (e.status === 'live' && !!e.expiries.length && !e.expiries.some(x => x.date === date));
}

/** The own-vol dates (ownIvDates) whose contracts are not read yet */
export function horizonFactsMissing(entry: Entry): string[] {
  const facts = entry.factsDates ?? new Set<string>();
  const floor = isoDate(bookToday());
  const live = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length).sort();
  const own = ownIvDates(entry.byDate, live, live[0]);
  return live.filter(d => own.has(d) && !facts.has(d));
}

/** The session on record's date (data/bookWindow.ts recordDay, kept here without the import cycle): today's from the
    open on, else the last session that ran */
export function recordIso(): string {
  const iso = nyIsoDate();
  const [y, m, d] = iso.split('-').map(Number);
  if (isTradingDay(new Date(y, m - 1, d)) && nyMinutes() >= OPEN_MIN) return iso;
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return iso;
}

/** Every live listed date carries its own strikes */
export function datesComplete(entry: Entry): boolean {
  const today = isoDate(bookToday());
  /* the same forty listings the full book pulls (loadExpiries) — the day that just settled too, while the vendor still
     lists it: its chain is what liveAll takes off the whole book's total, so without it a Board name's "All expiries"
     net carried the settled contracts (QQQ −$10.6B on the Board against −$9.3B on the Map after the bell) */
  const live = entry.expiries.slice(0, 40);
  const empty = emptyDates.get(entry.ticker);
  return live.some(e => e.date >= today) && live.every(e => entry.byDate[e.date]?.length || empty?.has(e.date));
}
/** Listed dates whose strikes came back empty — asked once, not waited on forever */
export const emptyDates = new Map<string, Set<string>>();
