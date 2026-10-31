/* A call as a trader follows it and reviews it: its events (the call, the stop lifting, the take-profit, the exit) and
   the three numbers its card shows. Display only. Everything here is read off what the engine already recorded on the
   signal (compassLedger Signal: the quote it fired on, the outcome's fill, exit, peak and stop, and the spark of
   minute bids after the call); the stop steps are the engine's own rule (compassParams stopAfter) replayed on those
   minute bids. Nothing here decides a call or settles one. */

import type { Setup } from '../types/compass';
import type { Signal } from './compassLedger';
import { activeStop } from './compassLedger';
import { BOOK_NAME, MODEL_1_NAME, MODEL_2_NAME, printOf, stopAfter, weekdayDte } from './compassParams';
import { nyClock } from '../core/nyTime';

/** Each book's ink: a theme token (the chart reads it off the page), and its text and fill classes. Direction keeps its
    own glyph (▲ ▼), so no book wears the gain or loss inks. */
export const BOOK_INK: Record<'A' | 'B' | 'C', { token: string; text: string; dot: string; ring: string }> = {
  A: { token: '--silver', text: 'text-silver', dot: 'bg-silver', ring: 'border-silver/50' },
  B: { token: '--moon', text: 'text-moon', dot: 'bg-moon', ring: 'border-moon/50' },
  C: { token: '--warn', text: 'text-warn', dot: 'bg-warn', ring: 'border-warn/50' },
};

export type CallEventKind = 'call' | 'breakeven' | 'ratchet' | 'exit';

export interface CallEvent {
  /** Unique across the session: the signal's key, the kind and the step */
  key: string;
  sig: Signal;
  /** Epoch ms of the minute it happened (the call: the instant it fired) */
  at: number;
  kind: CallEventKind;
  /** The short tag the list prints */
  tag: string;
  /** The line after the tag */
  text: string;
  /** Read at the minute: the stop rule ran on one-second quotes, so the step came inside the minute up to this one */
  inMinute?: boolean;
  /** The exit: its return on the fill, percent */
  ret?: number | null;
}

/** "SPX 7800P 0DTE": the root as it prints, the strike and side, and the sessions to expiry from the call's day. */
export function callContract(sig: Pick<Signal, 'ticker' | 'contract' | 'day' | 'expiry'>): string {
  const body = sig.contract.replace(/^\S+\s*/, '');
  const dte = weekdayDte(sig.day, sig.expiry);
  return `${printOf(sig.ticker)} ${body}${Number.isFinite(dte) ? ` ${dte}DTE` : ''}`;
}

/** ▲ for a call, ▼ for a put. */
export const sideGlyph = (right: 'C' | 'P'): string => (right === 'C' ? '▲' : '▼');

export type ExitKind = 'stop' | 'break-even' | 'ratchet' | 'take-profit' | 'flat' | 'reversal' | 'last-quote';

/** Why a call left, in the card's words: the engine's reason, with a stop named by the rung it stood on. */
export function exitReason(sig: Signal): { kind: ExitKind; word: string; full: string } | null {
  const o = sig.outcome;
  if (!o || o.status !== 'closed' || !o.exit) return null;
  const why = o.exit.why;
  if (why === 'Stop') {
    const paid = o.fill?.ask ?? 0;
    const name = paid > 0 ? activeStop(paid, o.peak, sig.runner || sig.book === 'B').name : 'Stop';
    if (name === 'Breakeven') return { kind: 'break-even', word: 'Break-even stop', full: 'The stop at the entry, raised there once the bid reached 1.25× the fill.' };
    if (name !== 'Stop') return { kind: 'ratchet', word: `Ratchet stop · ${name}`, full: `The ratchet's stop, raised at ${name}.` };
    return { kind: 'stop', word: 'Stop', full: 'The hard stop, 0.4678 × the fill.' };
  }
  if (/^Take profit/i.test(why)) return { kind: 'take-profit', word: why.replace(/^Take profit/i, 'Take profit'), full: 'Out at 1.50 × the fill.' };
  if (why === '3×' || why === '2×') return { kind: 'take-profit', word: `Take profit ${why}`, full: why === '3×' ? 'Out at 3 × the fill inside 120 seconds.' : 'Out at 2 × the fill inside 30 seconds.' };
  const flat = /^(\d{2}:\d{2}) flat$/.exec(why);
  if (flat) return { kind: 'flat', word: `Flat ${flat[1]}`, full: `Flat at ${flat[1]} ET, on the bid.` };
  if (/reversed/i.test(why)) return { kind: 'reversal', word: 'Reversal', full: why };
  const last = /^Last quote (\d{2}:\d{2})/.exec(why);
  if (last) return { kind: 'last-quote', word: `Last quote ${last[1]}`, full: why };
  return { kind: 'stop', word: why, full: why };
}

/** The stop's rungs in order: what lifted it, and to where. */
const RUNGS: { name: string; tag: string; reached: string }[] = [
  { name: 'Breakeven', tag: 'Break-even', reached: '1.25×' },
  { name: 'TP1', tag: 'Ratchet · TP1', reached: '1.50×' },
  { name: 'TP2', tag: 'Ratchet · TP2', reached: '2×' },
  { name: 'TP3', tag: 'Ratchet · TP3', reached: '3×' },
  { name: 'Trail', tag: 'Ratchet · trail', reached: '4×' },
];
const rungIndex = (name: string) => RUNGS.findIndex(r => r.name === name);

const money = (v: number) => `$${v.toFixed(2)}`;
/** "+4.8%", "−28.8%" */
export const pctWord = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;

/**
 * The minute bids after the fill, timed. The engine writes the spark from the contract's one-minute quotes after the
 * call (the fill's minute first, through the exit); a spark that does not run one a minute from the fill is not timed.
 */
function timedSpark(sig: Signal): { t: number; bid: number }[] | null {
  const o = sig.outcome;
  if (!o?.fill || !sig.spark.length) return null;
  const end = o.exit?.at ?? o.last?.t ?? o.fill.at;
  const want = Math.floor((end - o.fill.at) / 60_000) + 1;
  if (sig.spark.length !== want || Math.abs(sig.spark[0] - o.fill.bid) > 1e-9) return null;
  return sig.spark.map((bid, i) => ({ t: o.fill!.at + i * 60_000, bid }));
}

/** Every event of one call, oldest first. */
export function callEvents(sig: Signal): CallEvent[] {
  const out: CallEvent[] = [];
  const book = BOOK_NAME[sig.book];
  out.push({
    key: `${sig.key}|call`,
    sig,
    at: sig.firedAt,
    kind: 'call',
    tag: 'Call',
    text: [
      `${book} · ${callContract(sig)} ${sideGlyph(sig.right)}`,
      `ask ${sig.ask.toFixed(2)}`,
      sig.p1 != null ? `${MODEL_1_NAME} ${(sig.p1 * 100).toFixed(1)}%` : '',
      sig.book === 'A' && sig.runner ? `${MODEL_2_NAME} cleared, it rides` : '',
    ].filter(Boolean).join(' · '),
  });
  const o = sig.outcome;
  const paid = o?.fill?.ask ?? 0;
  const runner = sig.book === 'B' || sig.runner;
  /* the stop's steps: Core and Wing only (the late sweep has no stop) */
  if (o && paid > 0 && sig.book !== 'C') {
    const spark = timedSpark(sig);
    const end = o.exit?.at ?? Infinity;
    let peak = 0;
    let rung = -1;
    let lastT = o.fill!.at;
    const step = (to: number, at: number, inMinute: boolean) => {
      for (let r = rung + 1; r <= to; r++) {
        const stop = stopAfter(paid, r === RUNGS.length - 1 ? peak : paid * [1.25, 1.5, 2, 3, 4][r], runner);
        const rungDef = RUNGS[r];
        out.push({
          key: `${sig.key}|stop|${rungDef.name}`,
          sig,
          at,
          kind: r === 0 ? 'breakeven' : 'ratchet',
          tag: rungDef.tag,
          text: r === 0
            ? `Bid reached 1.25× the fill · stop lifts to the entry, ${money(stop)}`
            : rungDef.name === 'Trail'
              ? `Bid reached 4× · stop trails at 0.75 × the best bid, ${money(stop)} then`
              : `Bid reached ${rungDef.reached} · stop lifts to ${money(stop)}`,
          ...(inMinute ? { inMinute: true } : {}),
        });
      }
      rung = Math.max(rung, to);
    };
    if (spark) {
      /* the engine reads each quote after the fill: the exit checks the stop standing before it, then the peak moves */
      for (const q of spark.slice(1)) {
        if (q.t >= end) break;
        peak = Math.max(peak, q.bid);
        const name = activeStop(paid, peak, runner).name;
        const r = rungIndex(name);
        if (r > rung) step(r, q.t, false);
        lastT = q.t;
      }
    }
    /* the recorded peak counts the one-second quotes too: a rung only they reached lifted inside a minute */
    const final = rungIndex(activeStop(paid, o.peak, runner).name);
    if (final > rung) {
      if (spark) {
        peak = o.peak;
        step(final, lastT, true);
      }
    }
  }
  if (o?.status === 'closed' && o.exit && o.fill) {
    const why = exitReason(sig);
    const tp = why?.kind === 'take-profit';
    out.push({
      key: `${sig.key}|exit`,
      sig,
      at: o.exit.at,
      kind: 'exit',
      tag: tp ? 'Take profit' : 'Exit',
      text: `${why?.word ?? o.exit.why} · ${money(o.exit.px)}`,
      ret: o.ret,
    });
  }
  return out;
}

/** Every event of the calls given, newest first. */
export function sessionEvents(calls: readonly Signal[]): CallEvent[] {
  return calls.flatMap(callEvents).sort((a, b) => b.at - a.at || order(b.kind) - order(a.kind));
}
const order = (k: CallEventKind) => (k === 'call' ? 0 : k === 'exit' ? 2 : 1);

/** The session the board's calls are from: today's when it has a call, else the newest session on record. */
export function callSession(record: readonly Signal[], today: string): { day: string; live: boolean } | null {
  const calls = record.filter(r => !r.would);
  if (calls.some(r => r.day === today)) return { day: today, live: true };
  const newest = calls.reduce<string | null>((m, r) => (m == null || r.day > m ? r.day : m), null);
  return newest ? { day: newest, live: false } : null;
}

/** The card's three numbers, read off the record. */
export interface CallNumbers {
  /** The entry the call is measured from: the fill's ask once filled, else the ask it was called on */
  at: number;
  /** The ask on the quote the model read when it called */
  calledAsk: number;
  calledBid: number;
  /** The fill, once there is one */
  fill: { at: number; ask: number } | null;
  /** The highest bid after the fill (before the exit), and its percent from the entry; null before any */
  best: { px: number; pct: number } | null;
  state: 'waiting' | 'unavailable' | 'open' | 'closed';
  /** Closed: the exit */
  exit: { at: number; px: number; pct: number | null; pnl: number | null; reason: { kind: ExitKind; word: string; full: string } } | null;
  /** Open: the stop standing and its rung's name */
  stop: { px: number; name: string } | null;
  /** Open: the last bid read on the record, and when */
  last: { t: number; bid: number } | null;
}

export function callNumbers(sig: Signal): CallNumbers {
  const o = sig.outcome;
  const fill = o?.fill ? { at: o.fill.at, ask: o.fill.ask } : null;
  const entry = fill?.ask ?? sig.ask;
  const state = !o ? 'waiting' : o.status;
  const best = fill && o && o.peak > 0 ? { px: o.peak, pct: (o.peak / fill.ask - 1) * 100 } : null;
  const reason = exitReason(sig);
  const exit = o?.status === 'closed' && o.exit && reason ? { at: o.exit.at, px: o.exit.px, pct: o.ret, pnl: o.pnl, reason } : null;
  const runner = sig.book === 'B' || sig.runner;
  const stop = state === 'open' && fill && sig.book !== 'C' ? (() => {
    const s = activeStop(fill.ask, o!.peak, runner);
    return { px: Number(s.stop.toFixed(2)), name: s.name };
  })() : null;
  const last = state === 'open' && o?.last ? { t: o.last.t, bid: o.last.bid } : null;
  return { at: entry, calledAsk: sig.ask, calledBid: sig.bid, fill, best, state, exit, stop, last };
}

/** A recorded call as a board card, when the scan no longer holds its setup: the record's own fields, nothing priced. */
export function setupOfSignal(sig: Signal): Setup {
  const dte = weekdayDte(sig.day, sig.expiry);
  const band: Setup['band'] = sig.book === 'A' ? 'top' : sig.book === 'B' ? 'wing' : 'lottery';
  const mid = (sig.bid + sig.ask) / 2;
  const level = { price: 0, pct: 0 };
  return {
    id: sig.id,
    ticker: sig.ticker,
    contract: sig.contract,
    right: sig.right,
    strike: sig.strike,
    expiry: Number.isFinite(dte) ? `${dte}DTE` : sig.expiry,
    expiryDate: sig.expiry,
    sessionsLeft: Number.isFinite(dte) ? dte : 0,
    sigmaMovePct: 0,
    sleeve: sig.sleeve,
    score: 0,
    verdict: 'ENTER',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: level,
    scalpExit: level,
    headline: '',
    whyChips: [],
    whyText: '',
    greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, iv: 0 },
    bid: sig.bid,
    ask: sig.ask,
    mid,
    liveMid: mid,
    highWater: 0,
    confidence: 0,
    health: 0,
    momentum: 'NEUTRAL',
    takeProfits: [],
    priceTargets: [],
    liquidityLabel: 'Normal',
    liquiditySpread: '',
    spot: sig.spot ?? undefined,
    quotedAt: sig.quoteAt,
    seenAt: sig.firedAt,
    late: sig.how === 'late' || undefined,
    mark: sig.mark,
    tapeSession: sig.tapeSession,
    outsideTrained: sig.outsideTrained || undefined,
    flatAt: sig.flatAt,
    p1: sig.p1 ?? undefined,
    prun: sig.prun ?? undefined,
    runner: sig.runner,
    band,
    invalidationPrice: 0,
    invalidationReason: '',
  };
}

/** "13:45" for the list, "≈13:45" for a step read at the minute after one-second quotes made it. */
export const eventClock = (e: CallEvent): string => `${e.inMinute ? '≈' : ''}${nyClock(e.at)}`;
