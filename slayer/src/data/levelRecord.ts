/*
==================================================
  SLAYER TERMINAL - HOW THE LEVELS HELD, SESSION BY SESSION
  (data/levelRecord.ts)

  THE BASE RATES (the competitive audit, 2026-10-13:
  no product in the category publishes auditable
  accuracy for its levels — "none of us publishes
  auditable accuracy statistics"; the Map's report
  grades today, this grades the sessions on hand).
  For every past session the market keeps, the
  levels AS THEY STOOD AT ITS OPEN — read off the
  first book kept that session, never off a later
  one (no look-ahead) — and what the session then
  did to them: tested or not, held its first test or
  broke it, broke at all; and whether the close
  landed inside one expected move of the open.

  The record is read, not stored: the house keeps a
  few sessions of bars and a book a bar; the feed
  keeps the sessions the vendor serves. A machine
  that reads the vendor's two years will grade two
  years. The rule for a test and a break is the
  report's own (levelTicks), moved here so the two
  cannot drift.
==================================================
*/

import { pickFlip, pickWalls } from '../core/walls';
import { nyDay } from '../core/nyTime';
import Simulator from '../core/simulator';
import { sessionStarts } from './indicators';
import { YEAR_MINUTES } from './measure';
import type { Candle, GexSnapshot } from '../types/market';

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
export const RECORD_LEVELS: RecordLevel[] = ['callWall', 'putWall', 'flip', 'supreme'];
export const RECORD_WORDS: Record<RecordLevel, string> = { callWall: 'call wall', putWall: 'put wall', flip: 'flip', supreme: 'supreme' };

export interface LevelOutcome {
  price: number;
  tests: number;
  held: number;
  broke: number;
  /** Its first test held (true), broke (false), or it was never tested (null) */
  heldFirst: boolean | null;
}

export interface SessionRecord {
  /** "Oct 9" */
  day: string;
  open: number;
  close: number;
  bars: number;
  levels: Partial<Record<RecordLevel, LevelOutcome>>;
  /** The close inside one expected move of the open, on the vol given — null without a vol */
  insideMove: boolean | null;
}

export interface BaseRates {
  sessions: number;
  levels: Record<RecordLevel, { tested: number; heldFirst: number; neverBroke: number }>;
  insideMove: { n: number; inside: number };
}

/** The levels as the first book of a session read them — walls, flip and supreme off the per-strike net */
function levelsAtOpen(snap: GexSnapshot, open: number): Partial<Record<RecordLevel, number>> {
  const rows = snap.levels;
  const walls = pickWalls(rows, open, l => l.value);
  const flip = pickFlip(rows, open, l => l.value);
  let supreme: number | null = null;
  let best = 0;
  for (const l of rows)
    if (Math.abs(l.value) > best) {
      best = Math.abs(l.value);
      supreme = l.strike;
    }
  const out: Partial<Record<RecordLevel, number>> = {};
  if (walls.callWall != null) out.callWall = walls.callWall;
  if (walls.putWall != null) out.putWall = walls.putWall;
  if (flip != null) out.flip = flip;
  if (supreme != null) out.supreme = supreme;
  return out;
}

/** A session is graded only when it has most of its bars — a stub (the tape's first minutes) says nothing */
const MIN_BARS = 200;

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
