/* The record of Compass's signals: every Book A, B and C call the scan fired in this browser, with the quote it fired
   on, kept in localStorage (slayer_compass_signals_v1). Its outcome is read off the contract's own one-minute NBBO
   after the call (compassOutcome.ts) from ThetaData, and frozen once it closes. Nothing here is a stand-in: a signal
   with no path yet says so. */

import { useEffect, useSyncExternalStore } from 'react';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import { currentPicks, noteLeft, underCloses } from './compassModel';
import { noteCompassCall } from './compassAlerts';
import { settleSignal, type Outcome, type PathQuote, type SignalBook } from './compassOutcome';
import { stopAfter } from './compassParams';
import { thetaCall } from './theta';
import { nyIsoDate, nyParts, nyWallStamp } from '../core/nyTime';

export interface Signal {
  /** `${day}|${id}`: one contract can fire on more than one session */
  key: string;
  /** The setup's address (data/compass setupIdOf) */
  id: string;
  /** The New York date it fired on, YYYY-MM-DD */
  day: string;
  book: SignalBook;
  ticker: string;
  contract: string;
  right: OptionRight;
  strike: number;
  /** The contract's expiration, YYYY-MM-DD */
  expiry: string;
  sleeve: SleeveKey;
  firedAt: number;
  /** The quote the model read: its own stamp, bid and ask, and the underlying */
  quoteAt: number;
  bid: number;
  ask: number;
  spot: number | null;
  p1: number | null;
  prun: number | null;
  runner: boolean;
  outcome: Outcome | null;
  /** When the path was last read */
  pathAt: number;
  /** The bid each minute after the call, for the line on a row */
  spark: number[];
}

const KEY = 'slayer_compass_signals_v1';
const MAX_ROWS = 600;

let rows: Signal[] = load();
let rev = 0;
const listeners = new Set<() => void>();

function emit(): void {
  rev += 1;
  for (const fn of listeners) fn();
}

function load(): Signal[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is Signal => {
      if (!r || typeof r !== 'object') return false;
      const s = r as Signal;
      return typeof s.key === 'string' && typeof s.id === 'string' && (s.book === 'A' || s.book === 'B' || s.book === 'C') && s.firedAt > 0 && s.ask > 0;
    });
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX_ROWS)));
  } catch {
    /* the rows still stand in this tab */
  }
}

const bookOf = (s: Setup): SignalBook | null => (s.band === 'top' ? 'A' : s.band === 'wing' ? 'B' : s.band === 'lottery' ? 'C' : null);

/** Every signal, newest first. */
export function signals(): Signal[] {
  return rows;
}

/** Today's signal on a setup address, or null. */
export function signalOf(id: string, at = Date.now()): Signal | null {
  const day = nyIsoDate(at);
  return rows.find(r => r.id === id && r.day === day) ?? null;
}

/** The ask a signal filled at (the first quote a full minute after the call), or 0 before it fills. */
export function paidOf(id: string): number {
  return signalOf(id)?.outcome?.fill?.ask ?? 0;
}

/** Record the picks the scan just fired. Only a pick still holding its fire-time quote is written: a quote stamped
    after the call is not the one the model read. */
export function recordPicks(now = Date.now()): void {
  let added = false;
  for (const pick of currentPicks()) {
    const book = bookOf(pick);
    if (!book || !pick.seenAt || !(pick.ask > 0) || !(pick.bid >= 0)) continue;
    const day = nyIsoDate(pick.seenAt);
    const key = `${day}|${pick.id}`;
    if (rows.some(r => r.key === key)) continue;
    if (!pick.quotedAt || pick.quotedAt > pick.seenAt + 5_000) continue;
    rows = [
      {
        key,
        id: pick.id,
        day,
        book,
        ticker: pick.ticker,
        contract: pick.contract,
        right: pick.right,
        strike: pick.strike,
        expiry: (pick.expiryDate || '').slice(0, 10),
        sleeve: pick.sleeve,
        firedAt: pick.seenAt,
        quoteAt: pick.quotedAt,
        bid: pick.bid,
        ask: pick.ask,
        spot: pick.spot && pick.spot > 0 ? pick.spot : null,
        p1: pick.p1 ?? null,
        prun: pick.prun ?? null,
        runner: book === 'B' || pick.runner === true,
        outcome: null,
        pathAt: 0,
        spark: [],
      },
      ...rows,
    ];
    added = true;
    noteCompassCall(pick);
  }
  if (added) {
    save();
    emit();
    void readPaths(now);
  }
}

/* ---- the path after the call ---- */

function flat(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown };
    if (Array.isArray(row.data)) out.push(...(row.data as Record<string, unknown>[]));
    else out.push(item as Record<string, unknown>);
  }
  return out;
}

const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : NaN;
};

/** Theta's NBBO rows as path quotes: the row's own stamp, bid and ask. */
export function readQuotes(data: unknown): PathQuote[] {
  const out: PathQuote[] = [];
  for (const r of flat(data)) {
    const t = nyWallStamp(r.timestamp ?? r.ms_of_day ?? r.time);
    const bid = n(r.bid);
    const ask = n(r.ask);
    if (!t || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
    out.push({ t, bid, ask });
  }
  return out.sort((a, b) => a.t - b.t);
}

const ymd = (iso: string) => iso.replace(/-/g, '');
const two = (v: number) => String(v).padStart(2, '0');
const clockOf = (ms: number) => {
  const p = nyParts(ms);
  return `${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
};

/** The contract's NBBO after the call: one-minute readings for the day, and Book C's second readings for the two
    minutes after its fill. */
export async function contractPath(sig: Pick<Signal, 'ticker' | 'expiry' | 'strike' | 'right' | 'day' | 'book'>, fillAt: number | null): Promise<PathQuote[] | null> {
  const base = `/option/history/quote?symbol=${encodeURIComponent(sig.ticker)}&expiration=${ymd(sig.expiry)}&strike=${sig.strike}&right=${sig.right === 'C' ? 'call' : 'put'}&start_date=${ymd(sig.day)}&end_date=${ymd(sig.day)}`;
  const got = await thetaCall(`${base}&interval=1m&format=json`);
  if (got.error) return null;
  const minute = readQuotes(got.data);
  if (sig.book !== 'C' || !fillAt) return minute;
  const fine = await thetaCall(`${base}&interval=1s&start_time=${clockOf(fillAt)}&end_time=${clockOf(fillAt + 125_000)}&format=json`);
  if (fine.error) return minute;
  return [...minute, ...readQuotes(fine.data)].sort((a, b) => a.t - b.t);
}

let reading = false;

/** Read the path of every signal still open and settle it. A closed outcome is frozen and never asked for again. */
async function readPaths(now = Date.now()): Promise<void> {
  if (reading) return;
  reading = true;
  try {
    for (const sig of rows) {
      if (sig.outcome && (sig.outcome.status === 'closed' || sig.outcome.status === 'unavailable')) continue;
      if (now - sig.pathAt < 50_000) continue;
      const quotes = await contractPath(sig, sig.outcome?.fill?.at ?? null);
      if (!quotes) return;
      const under = await underCloses(sig.ticker, ymd(sig.day));
      let out = settleSignal(sig, quotes, under, Date.now());
      if (sig.book === 'C' && out.fill && !sig.outcome?.fill) {
        const fine = await contractPath(sig, out.fill.at);
        if (fine) out = settleSignal(sig, fine, under, Date.now());
      }
      const after = quotes.filter(q => q.t > sig.firedAt && q.t % 60_000 === 0 && (!out.exit || q.t <= out.exit.at));
      const next: Signal = { ...sig, outcome: out, pathAt: Date.now(), spark: after.map(q => q.bid).filter(b => b >= 0) };
      rows = rows.map(r => (r.key === sig.key ? next : r));
      if (out.status === 'closed' || out.status === 'unavailable') {
        noteLeft({ id: sig.id, ticker: sig.ticker, contract: sig.contract }, out.status === 'unavailable' ? 'Unavailable' : out.exit?.why ?? 'Closed');
      }
      save();
      emit();
    }
  } finally {
    reading = false;
  }
}

/* While a Compass page is open and the tab is showing, open signals are read once a minute. */
let readers = 0;
let timer: number | null = null;

function arm(): void {
  if (timer != null || typeof window === 'undefined') return;
  void readPaths();
  timer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    void readPaths();
  }, 60_000);
}

function disarm(): void {
  if (timer != null) window.clearInterval(timer);
  timer = null;
}

/** The record, newest first. Mounting it keeps open signals' paths reading. */
export function useSignals(): Signal[] {
  useEffect(() => {
    readers += 1;
    arm();
    return () => {
      readers -= 1;
      if (readers === 0) disarm();
    };
  }, []);
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  return rows;
}

/** The stop standing now and its rung's name. */
export function activeStop(paid: number, peak: number, runner: boolean): { stop: number; name: string } {
  const stop = stopAfter(paid, peak, runner);
  let name = 'Stop';
  if (runner && peak >= paid * 4) name = 'Trail';
  else if (runner && peak >= paid * 3) name = 'TP3';
  else if (runner && peak >= paid * 2) name = 'TP2';
  else if (runner && peak >= paid * 1.5) name = 'TP1';
  else if (peak >= paid * 1.25) name = 'Breakeven';
  return { stop, name };
}
