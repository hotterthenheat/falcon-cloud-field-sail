/* Base rates: for every past session on hand, the levels as they stood at its open (its first book, no look-ahead) and what the session did
   to them (tested, held the first test, broke), and whether the close landed inside one expected move. Read, not stored; levelTicks is the report's own rule. */

import type { Candle } from '../types/market';

export interface Tick {
  /** Index into the session's bars — the strip's x */
  i: number;
  time: number;
  close: number;
  kind: 'held' | 'broke';
}

/** Every test of a level along a session, bar by bar — kept as events rather than counts so a strip can draw each one.
    A bar whose range reaches the level is a test; a close beyond it after a test is a break. */
export function levelTicks(bars: readonly Candle[], strike: number, side: 'call' | 'put'): Tick[] {
  const out: Tick[] = [];
  let touches = 0;
  let broken = false;
  bars.forEach((b, i) => {
    const touched = b.low <= strike && b.high >= strike;
    const beyond = side === 'call' ? b.close > strike : b.close < strike;
    if (touched) touches++;
    if (beyond && !broken) {
      if (touches > 0) out.push({ i, time: b.time, close: b.close, kind: 'broke' });
      broken = true;
      return;
    }
    if (!beyond) broken = false;
    if (touched) out.push({ i, time: b.time, close: b.close, kind: 'held' });
  });
  return out;
}

export type RecordLevel = 'callWall' | 'putWall' | 'flip' | 'supreme';
const RECORD_LEVELS: RecordLevel[] = ['callWall', 'putWall', 'flip', 'supreme'];

interface LevelOutcome {
  price: number;
  tests: number;
  held: number;
  broke: number;
  /** Its first test held (true), broke (false), or it was never tested (null) */
  heldFirst: boolean | null;
}

interface SessionRecord {
  /** "Oct 9" */
  day: string;
  open: number;
  close: number;
  bars: number;
  levels: Partial<Record<RecordLevel, LevelOutcome>>;
  /** The close inside one expected move of the open, on the vol given — null without a vol */
  insideMove: boolean | null;
}

interface BaseRates {
  sessions: number;
  levels: Record<RecordLevel, { tested: number; heldFirst: number; neverBroke: number }>;
  insideMove: { n: number; inside: number };
}

/** Every finished session on hand, oldest first — today's is left to the report.
    The feed keeps today's book, not the days before it. The simulator's seeded
    sessions are not those days, so this stays empty rather than grading made-up ones. */
export function sessionRecords(ticker: string, iv: number | null): SessionRecord[] {
  void ticker;
  void iv;
  return [];
}

export function baseRates(records: readonly SessionRecord[]): BaseRates {
  const levels = Object.fromEntries(RECORD_LEVELS.map(k => [k, { tested: 0, heldFirst: 0, neverBroke: 0 }])) as BaseRates['levels'];
  const insideMove = { n: 0, inside: 0 };
  for (const r of records) {
    for (const k of RECORD_LEVELS) {
      const o = r.levels[k];
      if (!o || o.heldFirst == null) continue;
      levels[k].tested++;
      if (o.heldFirst) levels[k].heldFirst++;
      if (o.broke === 0) levels[k].neverBroke++;
    }
    if (r.insideMove != null) {
      insideMove.n++;
      if (r.insideMove) insideMove.inside++;
    }
  }
  return { sessions: records.length, levels, insideMove };
}
