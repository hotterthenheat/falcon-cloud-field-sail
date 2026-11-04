/* Compass's track record, from the record itself: the calls, how many won and lost, the hit rate, the average
   return, the total P&L ((exit - entry) x 100 a contract, no fees) and the worst trade, overall, by book and by the session the call was made
   in. One function for the Blotter's header and the replay's table (scripts/compass-replay.ts), so every number is
   the sum of the rows under it (scripts/golden/compass-golden.ts checks it). */

import type { Signal } from './compassLedger';
import type { TapeSession } from './compassParams';
import { nyParts } from '../core/nyTime';

export interface TrackLine {
  /** Calls in the slice */
  calls: number;
  /** Closed with a P&L */
  closed: number;
  /** Closed with a gain */
  won: number;
  /** Closed at or under the fill */
  lost: number;
  /** Filled and still held, or not filled yet */
  open: number;
  /** No valid quote in the three minutes after the call */
  unavailable: number;
  /** won / closed, 0 to 1; null with nothing closed */
  hitRate: number | null;
  /** Mean of the closed calls' returns, percent; null with nothing closed */
  avgRet: number | null;
  /** Closed calls' P&L per contract, (exit - fill) x 100, dollars, to the cent */
  pnl: number;
  /** The closed call that lost the most */
  worst: { contract: string; day: string; pnl: number } | null;
  /** Calls made at a minute outside the trees' trained minutes */
  outsideTrained: number;
}

export interface TrackRecord {
  all: TrackLine;
  byBook: Record<'A' | 'B' | 'C', TrackLine>;
  bySession: Record<TapeSession, TrackLine>;
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** The session a call was made in: its own field, else read off its mark's New York minute (rows from before the
    field were all regular-session calls under the old gate). */
export function sessionOfSignal(s: Pick<Signal, 'tapeSession' | 'mark' | 'firedAt' | 'ticker'>): TapeSession {
  if (s.tapeSession) return s.tapeSession;
  const p = nyParts(s.mark ?? s.firedAt);
  const m = p.hour * 60 + p.minute;
  if (m >= 20 * 60 + 15 || m < 7 * 60 + 30) return 'overnight';
  if (m < 9 * 60 + 30) return /^(SPX|SPXW|XSP|VIX|RUT|RUTW)$/.test(s.ticker) ? 'overnight' : 'pre';
  if (m < 16 * 60) return 'regular';
  return 'curb';
}

export function trackLine(rows: readonly Pick<Signal, 'contract' | 'day' | 'outcome' | 'outsideTrained'>[]): TrackLine {
  let won = 0;
  let lost = 0;
  let open = 0;
  let unavailable = 0;
  let pnl = 0;
  let retSum = 0;
  let worst: TrackLine['worst'] = null;
  let outsideTrained = 0;
  for (const r of rows) {
    if (r.outsideTrained) outsideTrained += 1;
    const o = r.outcome;
    if (o?.status === 'closed' && o.pnl != null) {
      if (o.pnl > 0) won += 1;
      else lost += 1;
      pnl += o.pnl;
      retSum += o.ret ?? 0;
      if (!worst || o.pnl < worst.pnl) worst = { contract: r.contract, day: r.day, pnl: o.pnl };
    } else if (o?.status === 'unavailable') unavailable += 1;
    else open += 1;
  }
  const closed = won + lost;
  return {
    calls: rows.length,
    closed,
    won,
    lost,
    open,
    unavailable,
    hitRate: closed ? won / closed : null,
    avgRet: closed ? Number((retSum / closed).toFixed(2)) : null,
    pnl: cents(pnl),
    worst,
    outsideTrained,
  };
}

export function trackRecord(rows: readonly Signal[]): TrackRecord {
  const books = { A: [] as Signal[], B: [] as Signal[], C: [] as Signal[] };
  const sessions: Record<TapeSession, Signal[]> = { overnight: [], pre: [], regular: [], curb: [] };
  for (const r of rows) {
    if (r.book === 'A' || r.book === 'B' || r.book === 'C') books[r.book].push(r);
    sessions[sessionOfSignal(r)].push(r);
  }
  return {
    all: trackLine(rows),
    byBook: { A: trackLine(books.A), B: trackLine(books.B), C: trackLine(books.C) },
    bySession: { overnight: trackLine(sessions.overnight), pre: trackLine(sessions.pre), regular: trackLine(sessions.regular), curb: trackLine(sessions.curb) },
  };
}
