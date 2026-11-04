/* A fired signal's outcome, read off the contract's own one-minute NBBO after the call. One rule for every book:
   the fill is the ask of the first quote stamped a full minute after the call (none within three minutes, or an
   invalid one, and the fill is unavailable); then each later quote in order, stop first, then the take-profit, then
   the 0.40% reversal on the underlying's own one-minute closes, then the flat. Book C checks 3× and 2× on its
   second quotes. Nothing is filled from a quote that was not printed. */

import { nyParts } from '../core/nyTime';
import { lotteryExit, reversalLine, stopAfter, treeExit } from './compassParams';
import type { OptionRight } from '../types/compass';

export type SignalBook = 'A' | 'B' | 'C' | 'R';

/** One NBBO reading: its own instant (epoch ms), bid and ask. */
export interface PathQuote {
  t: number;
  bid: number;
  ask: number;
}

/** One underlying one-minute bar: the minute's start (epoch ms) and close. */
export interface PathBar {
  t: number;
  c: number;
}

export interface SignalCore {
  book: SignalBook;
  right: OptionRight;
  /** Model 2 at the call cleared 0.50, or Book B (the ratchet always runs there) */
  runner: boolean;
  firedAt: number;
  /** The session's last regular minute on an early-close day (13:00 ET is 780): the flats move with it */
  closeMin?: number;
  /** The call's own flat, epoch ms (its session's: 09:20 overnight and pre-market). Absent: the day's flat. */
  flatAt?: number;
}

export type OutcomeStatus = 'waiting' | 'open' | 'closed' | 'unavailable';

export interface Outcome {
  status: OutcomeStatus;
  fill: { at: number; bid: number; ask: number } | null;
  exit: { at: number; px: number; why: string } | null;
  /** Highest bid seen after the fill, before the exit */
  peak: number;
  /** The stop standing after the last quote read */
  stop: number;
  /** The last quote read (open), or the exit quote */
  last: PathQuote | null;
  /** Exit against the fill, percent, one decimal */
  ret: number | null;
  /** Per contract, dollars: (exit - fill ask) x 100. No fees: Compass publishes entries and exits, it does not trade */
  pnl: number | null;
  /** Minutes from the fill to the exit (or to the last quote) */
  heldMin: number | null;
}

const FILL_WAIT_MS = 3 * 60_000;
const FLAT_MIN = 15 * 60 + 55;
const LOTTERY_FLAT_MIN = 15 * 60 + 50;

const minuteOfDay = (ms: number) => {
  const p = nyParts(ms);
  return p.hour * 60 + p.minute;
};
const dayOf = (ms: number) => {
  const p = nyParts(ms);
  return p.year * 10000 + p.month * 100 + p.day;
};
/** The New York minute a ms instant falls in, as epoch ms of that minute's start. */
const minuteStart = (ms: number) => Math.floor(ms / 60_000) * 60_000;


const validQuote = (q: PathQuote) => q.ask > 0 && q.bid >= 0 && q.ask >= q.bid;

/** The underlying's last five minutes, from closes known at `at`: the close of the minute before against the close
    six minutes before. */
function ret5At(bars: readonly PathBar[], at: number): number {
  const cut = minuteStart(at);
  let now = NaN;
  let then = NaN;
  for (const b of bars) {
    if (b.t === cut - 60_000) now = b.c;
    if (b.t === cut - 6 * 60_000) then = b.c;
  }
  return now > 0 && then > 0 ? now / then - 1 : NaN;
}

/** A call's P&L per contract: (exit - entry) x 100, to the cent. */
export function grossPnl(entryAsk: number, exitPx: number): number {
  return Number(((exitPx - entryAsk) * 100).toFixed(2));
}

/** An outcome as the owner's rule reads it: a closed call's P&L is (exit - fill ask) x 100. Records settled before
    the rule carried the round trip's fees inside it; they are read without them. */
export function noFees<T extends { outcome: Outcome | null }>(row: T): T {
  const o = row.outcome as (Outcome & { fees?: unknown }) | null;
  if (!o) return row;
  const { fees: _fees, ...rest } = o;
  const pnl = o.status === 'closed' && o.fill && o.exit ? grossPnl(o.fill.ask, o.exit.px) : o.pnl;
  return { ...row, outcome: { ...rest, pnl } };
}

function closed(fill: PathQuote, exit: { at: number; px: number; why: string }, peak: number, stop: number, last: PathQuote): Outcome {
  return {
    status: 'closed',
    fill: { at: fill.t, bid: fill.bid, ask: fill.ask },
    exit,
    peak,
    stop,
    last,
    ret: Number(((exit.px / fill.ask - 1) * 100).toFixed(1)),
    pnl: grossPnl(fill.ask, exit.px),
    heldMin: Math.max(0, Math.round((exit.at - fill.t) / 60_000)),
  };
}

/**
 * Settle a signal on the quotes printed after it. `quotes` are the contract's NBBO readings (one a minute; Book C
 * may add its second-by-second readings), `under` the underlying's one-minute closes, `now` the reading's clock.
 */
export function settleSignal(sig: SignalCore, quotes: readonly PathQuote[], under: readonly PathBar[], now: number): Outcome {
  const rows = quotes.filter(q => Number.isFinite(q.t) && q.t > sig.firedAt).slice().sort((a, b) => a.t - b.t);
  const base: Outcome = { status: 'waiting', fill: null, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, heldMin: null };
  const due = minuteStart(sig.firedAt) + 60_000;
  const fillAt = rows.findIndex(q => q.t >= due);
  if (fillAt < 0 || rows[fillAt].t > sig.firedAt + FILL_WAIT_MS) {
    return now > sig.firedAt + FILL_WAIT_MS ? { ...base, status: 'unavailable' } : base;
  }
  const fill = rows[fillAt];
  if (!validQuote(fill)) return { ...base, status: 'unavailable' };
  const paid = fill.ask;
  const lottery = sig.book === 'C';
  const runner = !lottery && (sig.book === 'B' || sig.runner);
  const day = dayOf(sig.firedAt);
  /* 15:55 and 15:50 on a full day; five and ten minutes before an early close */
  const early = sig.closeMin != null && sig.closeMin < 16 * 60 ? sig.closeMin : null;
  const flatMin = early != null ? early - 5 : FLAT_MIN;
  const lotteryFlatMin = early != null ? early - 10 : LOTTERY_FLAT_MIN;
  const flatWord = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} flat`;
  /* a Book A/B call that carries its session's flat (an overnight or pre-market call flats at 09:20, before the halt) */
  const ownFlat = !lottery && sig.flatAt != null && sig.flatAt > sig.firedAt ? sig.flatAt : null;
  let peak = 0;
  let last: PathQuote = fill;
  for (let i = fillAt + 1; i < rows.length; i++) {
    const q = rows[i];
    if (!validQuote(q)) continue;
    const late = ownFlat != null ? q.t >= ownFlat : dayOf(q.t) !== day || minuteOfDay(q.t) >= (lottery ? lotteryFlatMin : flatMin);
    if (lottery) {
      const hit = lotteryExit(paid, q.bid, (q.t - fill.t) / 1000);
      if (hit) return closed(fill, { at: q.t, px: hit.px, why: hit.why }, Math.max(peak, q.bid), 0, q);
      if (late) return closed(fill, { at: q.t, px: q.bid, why: flatWord(lotteryFlatMin) }, Math.max(peak, q.bid), 0, q);
    } else {
      const hit = treeExit(paid, q.bid, peak, runner);
      if (hit) return closed(fill, { at: q.t, px: hit.px, why: hit.why === 'tp1' ? 'Take profit 1.50×' : 'Stop' }, peak, stopAfter(paid, peak, runner), q);
      /* the reversal reads the underlying's minute closes: it is judged on the minute quotes only, not on the 1-second
         quotes added inside a minute that crossed the stop or a target */
      if (q.t % 60_000 === 0 && q.t - fill.t >= 60_000) {
        const line = reversalLine(paid, q.bid, sig.right, ret5At(under, q.t));
        if (line) return closed(fill, { at: q.t, px: q.bid, why: line }, peak, stopAfter(paid, peak, runner), q);
      }
      if (late) return closed(fill, { at: q.t, px: q.bid, why: flatWord(ownFlat != null ? minuteOfDay(ownFlat) : flatMin) }, peak, stopAfter(paid, peak, runner), q);
    }
    peak = Math.max(peak, q.bid);
    last = q;
  }
  /* The session is over and no quote stood at the flat: the last quote printed is the exit. */
  const over = ownFlat != null ? now >= ownFlat + 10 * 60_000 : dayOf(now) !== day || minuteOfDay(now) >= (early != null ? early : 16 * 60) + 5;
  if (over) {
    const p = nyParts(last.t);
    const why = `Last quote ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ET`;
    return closed(fill, { at: last.t, px: last.bid, why }, peak, lottery ? 0 : stopAfter(paid, peak, runner), last);
  }
  return {
    status: 'open',
    fill: { at: fill.t, bid: fill.bid, ask: fill.ask },
    exit: null,
    peak,
    stop: lottery ? 0 : stopAfter(paid, peak, runner),
    last,
    ret: last.bid >= 0 ? Number(((last.bid / paid - 1) * 100).toFixed(1)) : null,
    pnl: null,
    heldMin: Math.max(0, Math.round((last.t - fill.t) / 60_000)),
  };
}

/** The most 1-second windows read for one call's exits. */
export const FINE_MAX = 12;

/**
 * The minutes whose 1-second quotes decide a Book A or B exit: each minute after the fill (up to the exit the minute
 * quotes give) whose range, from the bid that ended the minute before to the bid that ends it, crosses the stop
 * standing then, the 1.50× target of a non-runner, or a ratchet rung (1.25×, and a runner's 1.50×, 2×, 3×, 4×). One
 * quote a minute cannot tell when inside the minute the stop or target was touched, or at what bid; the seconds can.
 * Returned as [after, through] epoch ms, the exit's own minute first, at most FINE_MAX. Book C reads its seconds
 * already (compassLedger contractPath).
 */
export function fineWindows(sig: SignalCore, quotes: readonly PathQuote[], now = Number.MAX_SAFE_INTEGER): [number, number][] {
  if (sig.book === 'C') return [];
  const minute = quotes.filter(q => q.t % 60_000 === 0);
  const out = settleSignal(sig, minute, [], now);
  if (!out.fill) return [];
  const paid = out.fill.ask;
  const runner = sig.book === 'B' || sig.runner;
  const end = out.exit?.at ?? Infinity;
  const rows = minute.filter(q => q.t > out.fill!.at && q.t <= end && validQuote(q)).sort((a, b) => a.t - b.t);
  const rungs = runner ? [1.25, 1.5, 2, 3, 4] : [1.25, 1.5];
  const found: [number, number][] = [];
  let prev: PathQuote = { t: out.fill.at, bid: out.fill.bid, ask: out.fill.ask };
  let peak = 0;
  for (const q of rows) {
    const lo = Math.min(prev.bid, q.bid);
    const hi = Math.max(prev.bid, q.bid);
    const levels = [stopAfter(paid, peak, runner), ...rungs.map(r => paid * r)];
    if (levels.some(L => L >= lo && L <= hi)) found.push([prev.t, q.t]);
    peak = Math.max(peak, q.bid);
    prev = q;
  }
  if (found.length <= FINE_MAX) return found;
  const last = found[found.length - 1];
  return [last, ...found.slice(0, FINE_MAX - 1)];
}

export interface DaySummary {
  /** Calls fired */
  calls: number;
  /** Closed with a gain */
  won: number;
  /** Closed at or under the fill */
  lost: number;
  /** Filled and still held */
  open: number;
  /** Not filled yet (inside the first minutes after the call) */
  waiting: number;
  /** No valid quote in the three minutes after the call */
  unavailable: number;
  /** Closed calls, dollars per contract: (exit - fill) x 100 */
  net: number;
  /** Open calls marked at their last bid, dollars per contract */
  openMark: number;
}

/** The day in one line: calls, won, lost, open, and the net per contract after the round-trip cost. */
export function daySummary(rows: readonly { outcome: Outcome | null }[]): DaySummary {
  const out: DaySummary = { calls: rows.length, won: 0, lost: 0, open: 0, waiting: 0, unavailable: 0, net: 0, openMark: 0 };
  for (const { outcome: o } of rows) {
    if (!o || o.status === 'waiting') out.waiting += 1;
    else if (o.status === 'unavailable') out.unavailable += 1;
    else if (o.status === 'closed' && o.pnl != null) {
      if (o.pnl > 0) out.won += 1;
      else out.lost += 1;
      out.net += o.pnl;
    } else if (o.status === 'open' && o.fill && o.last) {
      out.open += 1;
      out.openMark += (o.last.bid - o.fill.ask) * 100;
    } else out.waiting += 1;
  }
  out.net = Number(out.net.toFixed(2));
  out.openMark = Number(out.openMark.toFixed(2));
  return out;
}
