/* The official record of Compass's signals: every Book A, B and C call the server's scan fired, with the quote it
   fired on. The server keeps it (one file per session, data/compassServer.ts) and every browser shows the same rows
   from /api/compass/state. Its outcome is read off the contract's own one-minute NBBO after the call
   (compassOutcome.ts) from ThetaData, and frozen once it closes. Nothing here is a stand-in: a signal with no path
   yet says so. */

import { useSyncExternalStore } from 'react';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import { currentPicks, noteLeft, takeWouldPicks, underCloses } from './compassModel';
import { fineWindows, noFees, settleSignal, type Outcome, type PathQuote, type SignalBook } from './compassOutcome';
import { stopAfter } from './compassParams';
import { compassHost } from './compassHost';
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
  /** 'live': fired by the scan at its mark. 'late': the scan missed the mark and scored it afterwards from the quotes
      ThetaData recorded at that mark. Rows from before the field are live. */
  how?: 'live' | 'late';
  /** The mark the call belongs to, epoch ms of its minute */
  mark?: number;
  /** The session's last regular minute when it closes early (13:00 ET is 780); absent on a full day */
  closeMin?: number;
  /** Not a call: what a mark scored late would have called, settled by the same rules for the review and study */
  would?: true;
  /** The option tape session it was called in; absent on rows from before sessions (regular) */
  tapeSession?: 'overnight' | 'pre' | 'regular' | 'curb';
  /** Called at a minute outside the trees' trained minutes (t 15 to 330) */
  outsideTrained?: true;
  /** When its session flats it, epoch ms (absent: the day's 15:55, or five before an early close) */
  flatAt?: number;
}

let rows: Signal[] = [];
/** What late marks would have called: never official, never a seat */
let wouldRows: Signal[] = [];
let rev = 0;
const listeners = new Set<() => void>();
const changeFns = new Set<() => void>();

function emit(): void {
  rev += 1;
  for (const fn of listeners) fn();
}

function save(): void {
  for (const fn of changeFns) fn();
}

const validRow = (r: unknown): r is Signal => {
  if (!r || typeof r !== 'object') return false;
  const s = r as Signal;
  return typeof s.key === 'string' && typeof s.id === 'string' && (s.book === 'A' || s.book === 'B' || s.book === 'C') && s.firedAt > 0 && s.ask > 0;
};

/** Called after every change to the record (the server writes it). */
export function onSignalsChange(fn: () => void): () => void {
  changeFns.add(fn);
  return () => changeFns.delete(fn);
}

/** Replace the record with kept or served rows, newest first. */
export function importSignals(next: readonly unknown[]): void {
  rows = next.filter(validRow).map(noFees).sort((a, b) => b.firedAt - a.firedAt);
  emit();
}

/** Replace the "would have called" list (late marks), newest first. */
export function importWould(next: readonly unknown[]): void {
  wouldRows = next.filter(validRow).map(r => ({ ...noFees(r), would: true as const })).sort((a, b) => b.firedAt - a.firedAt);
  emit();
}

/** What late marks would have called, newest first. Not calls. */
export function wouldSignals(): Signal[] {
  return wouldRows;
}

/** The session's early close for the calls recorded from now on (minute of the day), or null on a full day. */
let closeMinNow: number | null = null;
export function setSessionClose(minute: number | null): void {
  closeMinNow = minute;
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
function signalOfPick(pick: Setup, book: SignalBook): Signal | null {
  if (!pick.seenAt || !(pick.ask > 0) || !(pick.bid >= 0)) return null;
  if (!pick.quotedAt || pick.quotedAt > pick.seenAt + 5_000) return null;
  const day = nyIsoDate(pick.seenAt);
  return {
    key: `${day}|${pick.id}`,
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
    how: pick.late ? 'late' : 'live',
    mark: pick.mark ?? Math.floor(pick.seenAt / 60_000) * 60_000,
    ...(closeMinNow != null ? { closeMin: closeMinNow } : {}),
    ...(pick.tapeSession ? { tapeSession: pick.tapeSession } : {}),
    ...(pick.outsideTrained ? { outsideTrained: true as const } : {}),
    ...(pick.flatAt && book !== 'C' ? { flatAt: pick.flatAt } : {}),
  };
}

/** Record the picks the scan just fired. Only a pick still holding its fire-time quote is written: a quote stamped
    after the call is not the one the model read. What a late mark would have called goes to its own list. */
export function recordPicks(now = Date.now()): Signal[] {
  const fresh: Signal[] = [];
  let added = false;
  for (const pick of currentPicks()) {
    const book = bookOf(pick);
    if (!book || pick.late) continue;
    const sig = signalOfPick(pick, book);
    if (!sig || rows.some(r => r.key === sig.key)) continue;
    rows = [sig, ...rows];
    fresh.push(sig);
    added = true;
  }
  for (const pick of takeWouldPicks()) {
    const book = bookOf(pick);
    const sig = book ? signalOfPick(pick, book) : null;
    if (!sig || wouldRows.some(r => r.key === sig.key)) continue;
    wouldRows = [{ ...sig, would: true }, ...wouldRows];
    added = true;
  }
  if (added) {
    save();
    emit();
    void settleOpen(now);
  }
  return fresh;
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
export async function contractPath(sig: Pick<Signal, 'ticker' | 'expiry' | 'strike' | 'right' | 'day' | 'book' | 'flatAt'>, fillAt: number | null): Promise<PathQuote[] | null> {
  /* an overnight call before midnight flats on the next calendar day: the path reads through the flat's date */
  const last = sig.flatAt && nyIsoDate(sig.flatAt) > sig.day ? nyIsoDate(sig.flatAt) : sig.day;
  const base = `/option/history/quote?symbol=${encodeURIComponent(sig.ticker)}&expiration=${ymd(sig.expiry)}&strike=${sig.strike}&right=${sig.right === 'C' ? 'call' : 'put'}&start_date=${ymd(sig.day)}&end_date=${ymd(last)}`;
  const got = await compassHost().theta(`${base}&interval=1m&format=json`);
  if (got.error) return null;
  const minute = readQuotes(got.data);
  if (sig.book !== 'C' || !fillAt) return minute;
  const fine = await compassHost().theta(`${base}&interval=1s&start_time=${clockOf(fillAt)}&end_time=${clockOf(fillAt + 125_000)}&format=json`);
  if (fine.error) return minute;
  return [...minute, ...readQuotes(fine.data)].sort((a, b) => a.t - b.t);
}

/* The 1-second quotes already read for a call's stop and target minutes, by signal key and window. */
const fineMemo = new Map<string, { windows: Set<string>; quotes: PathQuote[] }>();

/** A Book A or B call's minute path with the 1-second quotes of every minute whose range crossed its stop or a target
    (compassOutcome fineWindows), each window read once. A window that does not answer is left to the next pass. */
export async function withFineExits(sig: Pick<Signal, 'key' | 'ticker' | 'expiry' | 'strike' | 'right' | 'day' | 'book' | 'runner' | 'firedAt' | 'closeMin' | 'flatAt'>, minute: PathQuote[], now = Date.now()): Promise<PathQuote[]> {
  if (sig.book === 'C') return minute;
  const memo = fineMemo.get(sig.key) ?? { windows: new Set<string>(), quotes: [] };
  /* each window on its own date (an overnight call's minutes run past midnight) */
  const base = (d: string) => `/option/history/quote?symbol=${encodeURIComponent(sig.ticker)}&expiration=${ymd(sig.expiry)}&strike=${sig.strike}&right=${sig.right === 'C' ? 'call' : 'put'}&start_date=${ymd(d)}&end_date=${ymd(d)}`;
  for (const [after, through] of fineWindows(sig, minute, now)) {
    const id = `${after}|${through}`;
    if (memo.windows.has(id)) continue;
    /* a window across midnight reads its later date from 00:00:00 */
    const d = nyIsoDate(through);
    const from = nyIsoDate(after + 1_000) === d ? clockOf(after + 1_000) : '00:00:00';
    const got = await compassHost().theta(`${base(d)}&interval=1s&start_time=${from}&end_time=${clockOf(through)}&format=json`);
    if (got.error && got.error !== 'no_data') continue;
    memo.windows.add(id);
    memo.quotes.push(...readQuotes(got.data).filter(q => q.t > after && q.t <= through && q.t % 60_000 !== 0));
  }
  if (memo.windows.size) {
    fineMemo.set(sig.key, memo);
    if (fineMemo.size > 400) fineMemo.delete(fineMemo.keys().next().value as string);
  }
  if (!memo.quotes.length) return minute;
  return [...minute, ...memo.quotes].sort((a, b) => a.t - b.t);
}

let reading = false;

/** Read the path of every signal still open and settle it. A closed outcome is frozen and never asked for again. The
    official engine runs this once a minute; a browser only shows the result. */
export async function settleOpen(now = Date.now()): Promise<void> {
  if (reading || !compassHost().server) return;
  reading = true;
  try {
    for (const sig of [...rows, ...wouldRows]) {
      if (sig.outcome && (sig.outcome.status === 'closed' || sig.outcome.status === 'unavailable')) continue;
      if (now - sig.pathAt < 50_000) continue;
      const quotes = await contractPath(sig, sig.outcome?.fill?.at ?? null);
      /* this contract's path did not answer: the next one is still read (one fault used to stop every later call's
         settlement for that minute, newest first, so an old open call behind a failing one never settled) */
      if (!quotes) continue;
      const under = await underCloses(sig.ticker, ymd(sig.day));
      /* Books A and B: the stop and target minutes are judged on their 1-second quotes */
      const path = sig.book === 'C' ? quotes : await withFineExits(sig, quotes);
      let out = settleSignal(sig, path, under, Date.now());
      if (sig.book === 'C' && out.fill && !sig.outcome?.fill) {
        const fine = await contractPath(sig, out.fill.at);
        if (fine) out = settleSignal(sig, fine, under, Date.now());
      }
      const after = quotes.filter(q => q.t > sig.firedAt && q.t % 60_000 === 0 && (!out.exit || q.t <= out.exit.at));
      const next: Signal = { ...sig, outcome: out, pathAt: Date.now(), spark: after.map(q => q.bid).filter(b => b >= 0) };
      if (sig.would) {
        wouldRows = wouldRows.map(r => (r.key === sig.key ? next : r));
        save();
        emit();
        continue;
      }
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

/** The record, newest first (the server's, as the last state read handed it over). */
export function useSignals(): Signal[] {
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

/** What late marks would have called (never calls), newest first, as the last state read handed it over. */
export function useWould(): Signal[] {
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  return wouldRows;
}
