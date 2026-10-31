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

/** A close within this share of a level is on neither side of it (the flip's own band: a chop on a level is one
    test, not dozens) */
export const LEVEL_BAND = 0.0002;

/** THE test rule, for every level on every page (the Map's report, the column facts, the Agenda, the wall card's
    held/broke, the flip gauge): a test is a VISIT, not a bar. It begins on the first bar whose range reaches the level
    and ends held on the first bar that leaves it with the close back on its own side, or broke on the first close
    beyond it (outside ±LEVEL_BAND). After a break the level is re-armed once a close is back on its side; a visit still
    at the level as the tape ends has held so far. One tick per visit, at the bar that decided it.
    `side`: the side the level is tested from — 'call' from below (beyond = above), 'put' from above. */
export function levelTicks(bars: readonly Candle[], strike: number, side: 'call' | 'put'): Tick[] {
  const out: Tick[] = [];
  const band = Math.abs(strike) * LEVEL_BAND;
  let at = -1;
  let beyond = false;
  bars.forEach((b, i) => {
    const touched = b.low <= strike && b.high >= strike;
    const closedBeyond = side === 'call' ? b.close > strike + band : b.close < strike - band;
    if (beyond) {
      /* back on the original side: the next visit is a new test */
      if (!closedBeyond) beyond = false;
      return;
    }
    if (touched || at >= 0) {
      if (closedBeyond) {
        out.push({ i, time: b.time, close: b.close, kind: 'broke' });
        at = -1;
        beyond = true;
        return;
      }
      if (touched) at = i;
      else {
        out.push({ i, time: b.time, close: b.close, kind: 'held' });
        at = -1;
      }
    }
  });
  if (at >= 0) {
    const b = bars[at];
    out.push({ i: at, time: b.time, close: b.close, kind: 'held' });
  }
  return out;
}

/** The rule's counts: tests, held, broke */
export function levelTests(bars: readonly Candle[], strike: number, side: 'call' | 'put'): { tests: number; held: number; broke: number } {
  const ticks = levelTicks(bars, strike, side);
  const broke = ticks.filter(t => t.kind === 'broke').length;
  return { tests: ticks.length, held: ticks.length - broke, broke };
}

/** The same rule for a level with no side of its own (the flip): price tests it from wherever it is, and each break is a
    crossing — after it, price tests the level from the new side. `sideAt(i)`: the side of the level bar i's close is on
    (+1 above, −1 below, 0 inside the band); a fixed level passes its own, a moving one (the flip as it stood at each
    bar) its own reading per bar. */
export function levelCrossings(sideAt: (i: number) => -1 | 0 | 1, n: number): number {
  let side = 0;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const s = sideAt(i);
    if (s === 0) continue;
    if (side !== 0 && s !== side) crossings++;
    side = s;
  }
  return crossings;
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
