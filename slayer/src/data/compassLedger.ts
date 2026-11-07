/* The official record of Compass's signals: every Book A, B and C call the server's scan fired, with the quote it
   fired on. The server keeps it (one file per session, data/compassServer.ts) and every browser shows the same rows
   from /api/compass/state. Its outcome is read off the contract's own one-minute NBBO after the call
   (compassOutcome.ts) from ThetaData, and frozen once it closes. Nothing here is a stand-in: a signal with no path
   yet says so. */

import { useSyncExternalStore } from 'react';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import { currentPicks, noteLeft, takeWouldPicks, underCloses } from './compassModel';
import { FINE_MAX, fineAgrees, fineWindows, grossPnl, noFees, settleSignal, trustedPath, type Outcome, type PathBar, type PathQuote, type SignalBook, type SignalCore } from './compassOutcome';
import { stopAfter } from './compassParams';
import { compassHost } from './compassHost';
import { nyIsoDate, nyParts, nyWallStamp } from '../core/nyTime';
import { REGULAR_CLOSE_MIN, REGULAR_OPEN_MIN } from '../core/session';
import type { TailTicket } from './modelRisk';
import type { CostMark } from './compassCost';

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
  /** The contract's cost read at the call and how it was chosen (data/compassCost.ts); absent on rows from before it */
  cost?: CostMark;
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
  return typeof s.key === 'string' && typeof s.id === 'string' && (s.book === 'A' || s.book === 'B' || s.book === 'C' || s.book === 'R') && s.firedAt > 0 && s.ask > 0;
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

/** The ask a signal filled at (the first quote from the start of the minute after the call's), or 0 before it fills. */
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
    ...(pick.cost ? { cost: pick.cost } : {}),
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

const tailKey = (t: TailTicket) => `${t.day}|tail|${t.ticker}|${t.book}|${t.right === 'C' ? 'C' : 'P'}`;

function tailPeak(t: TailTicket): number {
  const hi = t.exitMinute;
  let peak = t.entryBid > 0 ? t.entryBid : 0;
  for (const b of t.bids ?? []) {
    if (!(b.bid > 0) || b.minute < t.entryMinute) continue;
    if (hi != null && b.minute > hi) continue;
    if (b.bid > peak) peak = b.bid;
  }
  if (t.exitBid != null && t.exitBid > peak) peak = t.exitBid;
  return peak;
}

function tailOutcome(t: TailTicket): Outcome {
  const fill = { at: t.entryAt, bid: t.entryBid, ask: t.entryAsk };
  const peak = tailPeak(t);
  if (t.why && t.exitBid != null && t.exitAt) {
    const ret = Number(((t.exitBid / t.entryAsk - 1) * 100).toFixed(1));
    return {
      status: 'closed',
      fill,
      exit: { at: t.exitAt, px: t.exitBid, why: t.why === 'back' ? (t.right === 'C' ? 'Back through the range low' : 'Back through the range high') : t.why === 'held' ? 'The break held' : 'Flat at 15:59' },
      peak,
      stop: 0,
      last: { t: t.exitAt, bid: t.exitBid, ask: t.exitBid },
      ret,
      /* to the cent, like every other book (was the raw float: (1.10 - 1.00) x 100 = 10.000000000000009) */
      pnl: grossPnl(t.entryAsk, t.exitBid),
      heldMin: Math.max(0, Math.round((t.exitAt - t.entryAt) / 60_000)),
    };
  }
  /* open: marked at the last bid read (was the entry quote for the whole hold) */
  const last = tailLast(t);
  return {
    status: 'open',
    fill,
    exit: null,
    peak,
    stop: 0,
    last,
    ret: t.entryAsk > 0 && last.t > t.entryAt ? Number(((last.bid / t.entryAsk - 1) * 100).toFixed(1)) : null,
    pnl: null,
    heldMin: last.t > t.entryAt ? Math.max(0, Math.round((last.t - t.entryAt) / 60_000)) : null,
  };
}

/** The last bid read on an open ticket (the entry quote until a later minute is read), as a path quote. A later
    minute's ask is not read, so it stands at the bid, as a closed ticket's exit does. */
function tailLast(t: TailTicket): PathQuote {
  let last: PathQuote = { t: t.entryAt, bid: t.entryBid, ask: t.entryAsk };
  let at = t.entryMinute;
  for (const b of t.bids ?? []) {
    if (!(b.bid >= 0) || !Number.isFinite(b.bid) || b.minute <= at) continue;
    at = b.minute;
    last = { t: t.entryAt + (b.minute - t.entryMinute) * 60_000, bid: b.bid, ask: b.bid };
  }
  return last;
}

function tailSignal(t: TailTicket): Signal {
  return {
    key: tailKey(t),
    id: `tail|${t.ticker}|${t.book}|${t.right === 'C' ? 'C' : 'P'}`,
    day: t.day,
    book: 'R',
    ticker: t.ticker,
    contract: t.contract,
    right: t.right === 'C' ? 'C' : 'P',
    strike: t.strike,
    expiry: t.expiry.slice(0, 10),
    sleeve: t.book === '0' ? 'odte' : 'weekly',
    firedAt: t.entryAt,
    quoteAt: t.entryAt,
    bid: t.entryBid,
    ask: t.entryAsk,
    spot: t.spot > 0 ? t.spot : null,
    p1: null,
    prun: null,
    runner: false,
    outcome: tailOutcome(t),
    pathAt: t.entryAt,
    spark: [],
    how: 'live',
    mark: t.entryAt,
    tapeSession: 'regular',
  };
}

/** A Model Risk call, on the same record as Books A, B and C. The fill is that minute's ask. Model 1's stop does not run. */
export function recordTail(t: TailTicket): void {
  if (!(t.entryAsk > 0) || !(t.entryBid >= 0) || !t.entryAt) return;
  const sig = tailSignal(t);
  if (rows.some(r => r.key === sig.key)) return;
  rows = [sig, ...rows];
  save();
  emit();
}

/** The same call, closed on the tail-risk rule: back through the line it broke. An old ticket may still say it flattened at 15:59. */
export function closeTail(t: TailTicket): void {
  const key = tailKey(t);
  if (!rows.some(r => r.key === key)) {
    recordTail(t);
    return;
  }
  rows = rows.map(r => (r.key === key ? { ...r, outcome: tailOutcome(t), pathAt: t.exitAt ?? Date.now() } : r));
  save();
  emit();
}

/** An open Model Risk ticket, remarked from the bids read so far. A closed ticket stays closed. */
export function touchTail(t: TailTicket): void {
  const key = tailKey(t);
  if (!rows.some(r => r.key === key && r.outcome?.status !== 'closed')) return;
  rows = rows.map(r => (r.key === key ? { ...r, outcome: tailOutcome(t), pathAt: Date.now() } : r));
  save();
  emit();
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

/** Theta's NBBO rows as path quotes: the row's own stamp, bid and ask, and the sizes when the row has them (the frozen
    copy check reads them: compassOutcome frozenTail). */
export function readQuotes(data: unknown): PathQuote[] {
  const out: PathQuote[] = [];
  for (const r of flat(data)) {
    const t = nyWallStamp(r.timestamp ?? r.ms_of_day ?? r.time);
    const bid = n(r.bid);
    const ask = n(r.ask);
    if (!t || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
    const bidSize = n(r.bid_size);
    const askSize = n(r.ask_size);
    out.push(Number.isFinite(bidSize) && Number.isFinite(askSize) ? { t, bid, ask, bidSize, askSize } : { t, bid, ask });
  }
  return out.sort((a, b) => a.t - b.t);
}

const ymd = (iso: string) => iso.replace(/-/g, '');
const two = (v: number) => String(v).padStart(2, '0');
const clockOf = (ms: number) => {
  const p = nyParts(ms);
  return `${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
};

/** The New York minute of the day of an instant. */
const minuteOfDay = (ms: number) => {
  const p = nyParts(ms);
  return p.hour * 60 + p.minute;
};

/** The next New York date after a YYYY-MM-DD. */
const nextDate = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** One read of a call's one-minute path: its first and last date, and the clock window on that date (none: the day
    as the terminal gives it, 09:30 to 16:00). */
export interface PathRead {
  from: string;
  to: string;
  start?: string;
  end?: string;
}

/** The reads of a call's one-minute path, from the call's own minute to a minute past its flat. A regular-session
    call is read as the terminal gives a day (09:30 to 16:00), as before. An overnight, pre-market or curb call is
    read in its own session, one read per New York date with that date's window: asked without a window, the
    terminal answers only 09:30 to 16:00, so a Tuesday 21:00 or a Wednesday 08:00 call had no quote after it and
    settled unavailable. A call without a flat (Book C, rows from before flats) is read as before. */
export function pathReads(sig: { day: string; book: SignalBook; flatAt?: number; firedAt?: number }): PathRead[] {
  /* an overnight call before midnight flats on the next calendar day: the path reads through the flat's date */
  const last = sig.flatAt && nyIsoDate(sig.flatAt) > sig.day ? nyIsoDate(sig.flatAt) : sig.day;
  if (sig.book === 'C' || !sig.flatAt || !sig.firedAt) return [{ from: sig.day, to: last }];
  const from = Math.floor(sig.firedAt / 60_000) * 60_000;
  const to = sig.flatAt + 60_000;
  const first = nyIsoDate(from);
  const end = nyIsoDate(to);
  const regular = first === sig.day && end === sig.day && minuteOfDay(from) >= REGULAR_OPEN_MIN && minuteOfDay(sig.flatAt) < REGULAR_CLOSE_MIN;
  if (regular) return [{ from: sig.day, to: last }];
  const out: PathRead[] = [];
  for (let d = first; d <= end && out.length < 4; d = nextDate(d)) {
    out.push({ from: d, to: d, start: d === first ? clockOf(from) : '00:00:00', end: d === end ? clockOf(to) : '23:59:59' });
  }
  return out;
}

const pathBase = (sig: Pick<Signal, 'ticker' | 'expiry' | 'strike' | 'right'>, from: string, to: string) =>
  `/option/history/quote?symbol=${encodeURIComponent(sig.ticker)}&expiration=${ymd(sig.expiry)}&strike=${sig.strike}&right=${sig.right === 'C' ? 'call' : 'put'}&start_date=${ymd(from)}&end_date=${ymd(to)}`;

/** The contract's NBBO after the call: its one-minute readings through its session (pathReads), and Book C's second
    readings for the two minutes after its fill. Null when a read did not answer, and the next pass asks again: a Book
    C path whose seconds did not answer is not handed over as its minutes alone, which cannot see a 3× inside 120 s. */
export async function contractPath(sig: Pick<Signal, 'ticker' | 'expiry' | 'strike' | 'right' | 'day' | 'book' | 'flatAt'> & { firedAt?: number }, fillAt: number | null): Promise<PathQuote[] | null> {
  const minute: PathQuote[] = [];
  for (const r of pathReads(sig)) {
    const window = r.start ? `&start_time=${r.start}&end_time=${r.end}` : '';
    const got = await compassHost().theta(`${pathBase(sig, r.from, r.to)}&interval=1m${window}&format=json`);
    /* a session window with nothing printed is an empty part of the path, not a fault */
    if (got.error && !(r.start && got.error === 'no_data')) return null;
    minute.push(...readQuotes(got.data));
  }
  minute.sort((a, b) => a.t - b.t);
  if (sig.book !== 'C' || !fillAt) return minute;
  const fine = await compassHost().theta(`${pathBase(sig, sig.day, sig.day)}&interval=1s&start_time=${clockOf(fillAt)}&end_time=${clockOf(fillAt + 125_000)}&format=json`);
  if (fine.error === 'no_data') return minute;
  if (fine.error) return null;
  return [...minute, ...readQuotes(fine.data)].sort((a, b) => a.t - b.t);
}

/* The 1-second quotes already read for a call's stop and target minutes, by signal key and window. */
const fineMemo = new Map<string, { windows: Set<string>; quotes: PathQuote[] }>();

const windowId = (w: readonly [number, number]) => `${w[0]}|${w[1]}`;

/** One exit window's 1-second quotes, on the date of its end (a window across midnight reads its later date from
    00:00:00), its minute stamps left out (the minute path has them). Null when the read did not answer. */
export async function readFineWindow(sig: Pick<Signal, 'ticker' | 'expiry' | 'strike' | 'right'>, [after, through]: readonly [number, number]): Promise<PathQuote[] | null> {
  const d = nyIsoDate(through);
  const from = nyIsoDate(after + 1_000) === d ? clockOf(after + 1_000) : '00:00:00';
  const got = await compassHost().theta(`${pathBase(sig, d, d)}&interval=1s&start_time=${from}&end_time=${clockOf(through)}&format=json`);
  if (got.error && got.error !== 'no_data') return null;
  return readQuotes(got.data).filter(q => q.t > after && q.t <= through && q.t % 60_000 !== 0);
}

/** A path with its 1-second exit windows read, and the windows up to its exit still unread (a read that did not
    answer, every window after it, and any past this pass's FINE_MAX). */
export interface FinePath {
  path: PathQuote[];
  unread: [number, number][];
}

type FineSig = Pick<Signal, 'key' | 'ticker' | 'expiry' | 'strike' | 'right' | 'day' | 'book' | 'runner' | 'firedAt' | 'closeMin' | 'flatAt'>;

/** A Book A or B call's minute path with the 1-second quotes of every minute whose range crossed its stop or a target
    (compassOutcome fineWindows), each window read once, oldest first. The windows are found again on the path as read
    so far until no new one appears: a peak the seconds found raises the stop the later minutes are judged against
    (they were found on the minute quotes alone, so a trail stop raised inside a minute could be crossed in a minute
    never read). A window that does not answer is left to the next pass, and so is every window after it. */
export async function fineExits(sig: FineSig, minute: PathQuote[], now = Date.now()): Promise<FinePath> {
  if (sig.book === 'C') return { path: minute, unread: [] };
  const memo = fineMemo.get(sig.key) ?? { windows: new Set<string>(), quotes: [] };
  const pathOf = () => (memo.quotes.length ? [...minute, ...memo.quotes].sort((a, b) => a.t - b.t) : minute);
  let path = pathOf();
  let budget = FINE_MAX;
  let stalled = false;
  for (;;) {
    const due = fineWindows(sig, path, now).filter(w => !memo.windows.has(windowId(w)));
    if (!due.length || stalled || budget <= 0) {
      if (memo.windows.size) {
        fineMemo.set(sig.key, memo);
        if (fineMemo.size > 400) fineMemo.delete(fineMemo.keys().next().value as string);
      }
      return { path, unread: due };
    }
    for (const w of due) {
      if (budget <= 0) break;
      budget -= 1;
      const got = await readFineWindow(sig, w);
      /* a window that did not answer, or that disagrees with the minute quotes at both its ends (a store behind real
         time: compassOutcome fineAgrees), is not kept: it and every window after it wait for the next pass */
      if (!got || !fineAgrees(got, minute.find(q => q.t === w[0]), minute.find(q => q.t === w[1]))) {
        stalled = true;
        break;
      }
      memo.windows.add(windowId(w));
      memo.quotes.push(...got);
    }
    path = pathOf();
  }
}

/** fineExits' path alone: the minute path and every 1-second window that answered. */
export async function withFineExits(sig: FineSig, minute: PathQuote[], now = Date.now()): Promise<PathQuote[]> {
  return (await fineExits(sig, minute, now)).path;
}

/** A close is final only once every 1-second window before its exit was read. While one is not, the call is held open
    as it stood at that window's start and read again on the next pass: closed on the minute quotes, a minute that
    touched both the stop and the target was resolved in the call's favour, and frozen so. */
export function heldOpen(sig: SignalCore, path: readonly PathQuote[], under: readonly PathBar[], out: Outcome, unread: readonly (readonly [number, number])[]): Outcome {
  if (out.status !== 'closed' || !out.exit || !unread.length) return out;
  const cut = Math.min(...unread.map(w => w[0]));
  if (cut >= out.exit.at) return out;
  const held = settleSignal(sig, path.filter(q => q.t <= cut), under, cut);
  if (held.status === 'closed' || !held.fill) return held;
  return { ...held, status: 'open' };
}

let reading = false;

/** One call's settlement read again from its contract's path: the next copy of the row, or null when the path did not
    answer (the next pass asks again). The one rule every row settles by: official calls, would-calls and the
    random-side twins of the forward test (data/compassTwins.ts). */
export async function settledCopy(sig: Signal, now = Date.now()): Promise<Signal | null> {
  const read = await contractPath(sig, sig.outcome?.fill?.at ?? null);
  /* this contract's path did not answer: the next one is still read (one fault used to stop every later call's
     settlement for that minute, newest first, so an old open call behind a failing one never settled) */
  if (!read) return null;
  /* a frozen copy at the end of the read (a store behind real time, filled forward to now: compassOutcome
     frozenTail) is not the contract's path: the call is settled on the rows before it, as of that instant, and read
     again on the next pass. Fills and exits were priced on it (2026-11-06 10:21–10:31: five of nine calls, frozen
     on the record). */
  const trust = trustedPath(read, now);
  const quotes = trust.path;
  const under = await underCloses(sig.ticker, ymd(sig.day));
  /* Books A and B: the stop and target minutes are judged on their 1-second quotes, and a close is final only
     once every one of them before the exit was read (a read that failed let the call close, and freeze, on the
     minute quotes) */
  const fine: FinePath = sig.book === 'C' ? { path: quotes, unread: [] } : await fineExits(sig, quotes);
  let out = heldOpen(sig, fine.path, under, settleSignal(sig, fine.path, under, trust.cutAt == null ? Date.now() : trust.asOf), fine.unread);
  if (sig.book === 'C' && out.fill && !sig.outcome?.fill) {
    const sec = await contractPath(sig, out.fill.at);
    const secTrust = sec ? trustedPath(sec, now) : null;
    /* its seconds did not answer: held open at the fill and read again next pass, not closed on the minutes */
    out = secTrust ? settleSignal(sig, secTrust.path, under, secTrust.cutAt == null ? Date.now() : secTrust.asOf) : heldOpen(sig, quotes, under, out, [[out.fill.at, out.fill.at + 125_000]]);
  }
  const after = quotes.filter(q => q.t > sig.firedAt && q.t % 60_000 === 0 && (!out.exit || q.t <= out.exit.at));
  return { ...sig, outcome: out, pathAt: Date.now(), spark: after.map(q => q.bid).filter(b => b >= 0) };
}

/** A row that still needs its path read: not frozen (closed or unavailable), not Model Risk, not read in the last 50 s. */
export function settleDue(sig: Signal, now = Date.now()): boolean {
  if (sig.book === 'R') return false;
  if (sig.outcome && (sig.outcome.status === 'closed' || sig.outcome.status === 'unavailable')) return false;
  return now - sig.pathAt >= 50_000;
}

/** Read the path of every signal still open and settle it. A closed outcome is frozen and never asked for again. The
    official engine runs this once a minute; a browser only shows the result. */
export async function settleOpen(now = Date.now()): Promise<void> {
  if (reading || !compassHost().server) return;
  reading = true;
  try {
    for (const sig of [...rows, ...wouldRows]) {
      if (!settleDue(sig, now)) continue;
      const next = await settledCopy(sig, now);
      if (!next) continue;
      const out = next.outcome!;
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
