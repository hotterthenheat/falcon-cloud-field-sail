/* A fired signal's outcome, read off the contract's own one-minute NBBO after the call. One rule for every book:
   the fill is the ask of the first quote stamped a full minute after the call (none within three minutes, or an
   invalid one, and the fill is unavailable); then each later quote in order, stop first, then the take-profit, then
   the 0.40% reversal on the underlying's own one-minute closes, then the flat. Book C checks 3× and 2× on its
   second quotes. Nothing is filled from a quote that was not printed. */

import { nyParts } from '../core/nyTime';
import { lotteryExit, reversalLine, stopAfter, treeExit } from './compassParams';
import type { OptionRight } from '../types/compass';

export type SignalBook = 'A' | 'B' | 'C';

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
  /** Per contract, dollars, after fees */
  pnl: number | null;
  fees: number | null;
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

/** A per-side estimate: $0.50 commission, $0.04 exchange and clearing, and the SEC fee on the sale. Not a broker's
    schedule. */
export function optionFees(exitPx: number): number {
  const sec = Math.max(0, exitPx) * 100 * 0.0000206;
  return Number((0.5 * 2 + 0.04 * 2 + sec).toFixed(2));
}

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

function closed(fill: PathQuote, exit: { at: number; px: number; why: string }, peak: number, stop: number, last: PathQuote): Outcome {
  const fees = optionFees(exit.px);
  return {
    status: 'closed',
    fill: { at: fill.t, bid: fill.bid, ask: fill.ask },
    exit,
    peak,
    stop,
    last,
    ret: Number(((exit.px / fill.ask - 1) * 100).toFixed(1)),
    pnl: Number(((exit.px - fill.ask) * 100 - fees).toFixed(2)),
    fees,
    heldMin: Math.max(0, Math.round((exit.at - fill.t) / 60_000)),
  };
}

/**
 * Settle a signal on the quotes printed after it. `quotes` are the contract's NBBO readings (one a minute; Book C
 * may add its second-by-second readings), `under` the underlying's one-minute closes, `now` the reading's clock.
 */
export function settleSignal(sig: SignalCore, quotes: readonly PathQuote[], under: readonly PathBar[], now: number): Outcome {
  const rows = quotes.filter(q => Number.isFinite(q.t) && q.t > sig.firedAt).slice().sort((a, b) => a.t - b.t);
  const base: Outcome = { status: 'waiting', fill: null, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, fees: null, heldMin: null };
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
  let peak = 0;
  let last: PathQuote = fill;
  for (let i = fillAt + 1; i < rows.length; i++) {
    const q = rows[i];
    if (!validQuote(q)) continue;
    const late = dayOf(q.t) !== day || minuteOfDay(q.t) >= (lottery ? LOTTERY_FLAT_MIN : FLAT_MIN);
    if (lottery) {
      const hit = lotteryExit(paid, q.bid, (q.t - fill.t) / 1000);
      if (hit) return closed(fill, { at: q.t, px: hit.px, why: hit.why }, Math.max(peak, q.bid), 0, q);
      if (late) return closed(fill, { at: q.t, px: q.bid, why: '15:50 flat' }, Math.max(peak, q.bid), 0, q);
    } else {
      const hit = treeExit(paid, q.bid, peak, runner);
      if (hit) return closed(fill, { at: q.t, px: hit.px, why: hit.why === 'tp1' ? 'Take profit 1.50×' : 'Stop' }, peak, stopAfter(paid, peak, runner), q);
      if (q.t - fill.t >= 60_000) {
        const line = reversalLine(paid, q.bid, sig.right, ret5At(under, q.t));
        if (line) return closed(fill, { at: q.t, px: q.bid, why: line }, peak, stopAfter(paid, peak, runner), q);
      }
      if (late) return closed(fill, { at: q.t, px: q.bid, why: '15:55 flat' }, peak, stopAfter(paid, peak, runner), q);
    }
    peak = Math.max(peak, q.bid);
    last = q;
  }
  /* The session is over and no quote stood at the flat: the last quote printed is the exit. */
  const over = dayOf(now) !== day || minuteOfDay(now) >= 16 * 60 + 5;
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
    fees: null,
    heldMin: Math.max(0, Math.round((last.t - fill.t) / 60_000)),
  };
}
