/*
  The paper book. A fill is the ask one minute after the signal.
  A missing quote is not replaced. Fees follow Robinhood's published
  schedule: $0.50 a side, $0.04 ORF and OCC a side, and the SEC fee on the sale.
*/

import { useEffect, useState } from 'react';
import type { OptionRight, Setup } from '../types/compass';
import type { TrackedSetup } from '../types/tracker';
import { choiceRight } from './compass';
import { noteLeft } from './compassModel';
import { nyClock, nyMinutes, nyParts, nyWallTime } from '../core/nyTime';
import { STOP_KEEP, spreadOk } from './contractQuote';
import { odteBoardDone } from './compassSession';

export type BookResult = 'win' | 'loss' | 'caution' | 'unavailable';

export interface BookLine {
  id: string;
  date: string;
  ticker: string;
  contract: string;
  right: OptionRight;
  strike: number;
  paid: number;
  exitPx: number;
  exit: string;
  why: string;
  result: BookResult;
  ret: number;
  held: number | null;
  at: number;
  entered?: string;
  fees?: number;
  pnl?: number;
  signalBid?: number;
  signalAsk?: number;
  signalMid?: number;
  fillBid?: number;
  fillAsk?: number;
  fillMid?: number;
}

export interface CloseInput {
  paid: number;
  bid: number;
  peak: number;
  heldMin: number;
  runner: boolean;
  scalp?: boolean;
  wing?: boolean;
  side: OptionRight;
  choice: OptionRight;
  dayOver: boolean;
  flat: boolean;
  levelBroke: boolean;
  rejected: boolean;
}

const KEY = 'slayer_compass_book';

export function nextAskDue(trackedAt: number, at: number = Date.now()): boolean {
  const then = nyParts(trackedAt);
  const nowP = nyParts(at);
  const due = then.hour * 60 + then.minute + 1;
  if (nowP.year !== then.year || nowP.month !== then.month || nowP.day !== then.day) return at > trackedAt;
  return nowP.hour * 60 + nowP.minute >= due;
}

interface LockedFill {
  status: 'filled' | 'unavailable' | 'wait';
  bid: number;
  ask: number;
  mid: number;
}

const fills = new Map<string, LockedFill>();
const peaks = new Map<string, number>();
const rungs = new Map<string, { name: string; at: number }[]>();

export interface LiveQuote { bid: number; ask: number; at: number }

export function noteRung(id: string, name: string, at = Date.now()): void {
  const list = rungs.get(id) ?? [];
  if (list[list.length - 1]?.name === name) return;
  list.push({ name, at });
  rungs.set(id, list);
}

export function rungsOf(id: string): { name: string; at: number }[] {
  return rungs.get(id) ?? [];
}

export function peakBefore(id: string): number {
  return peaks.get(id) ?? 0;
}

export function notePeak(id: string, bid: number): number {
  const next = Math.max(peaks.get(id) ?? 0, bid > 0 ? bid : 0);
  peaks.set(id, next);
  return next;
}

export function activeStop(paid: number, peak: number, runner: boolean): { stop: number; name: string } {
  let stop = paid * STOP_KEEP;
  let name = 'Stop';
  const raise = (level: number, word: string) => {
    if (level > stop) {
      stop = level;
      name = word;
    }
  };
  if (peak >= paid * 1.25) raise(paid, 'Breakeven');
  if (!runner) return { stop, name };
  if (peak >= paid * 1.5) raise(paid * 1.25, 'TP1');
  if (peak >= paid * 2) raise(paid * 1.5, 'TP2');
  if (peak >= paid * 3) raise(paid * 2.25, 'TP3');
  if (peak >= paid * 4) raise(peak * 0.75, 'Trail');
  return { stop, name };
}

const moneyResult = (paid: number, exitPx: number): BookResult => (exitPx > paid ? 'win' : 'loss');

export function closeOf(p: CloseInput): { result: BookResult; why: string; exitPx: number } | null {
  const paid = p.paid;
  const bid = p.bid;
  if (!(paid > 0)) return null;
  const prior = p.peak;
  const peak = Math.max(prior, bid > 0 ? bid : 0);
  if (p.wing) {
    if (bid > 0 && bid <= paid * 0.5) return { result: moneyResult(paid, bid), why: 'Stop', exitPx: bid };
    if (bid >= paid * 3) return { result: 'win', why: 'Wing', exitPx: Number((paid * 3).toFixed(2)) };
  } else if (p.scalp) {
    if (bid > 0 && bid <= paid * 0.85) return { result: moneyResult(paid, bid), why: 'Stop', exitPx: bid };
    if (bid >= paid * 1.2) return { result: 'win', why: 'Scalp', exitPx: Number((paid * 1.2).toFixed(2)) };
  } else {
    const armed = activeStop(paid, prior > 0 ? prior : 0, p.runner);
    const stopPx = prior > 0 ? armed.stop : paid * STOP_KEEP;
    if (bid > 0 && bid <= stopPx) return { result: moneyResult(paid, bid), why: prior > 0 ? armed.name : 'Stop', exitPx: bid };
    if (!p.runner && bid >= paid * 1.5) return { result: 'win', why: 'TP1', exitPx: Number((paid * 1.5).toFixed(2)) };
  }
  if (p.heldMin >= 55 && peak < paid * (p.scalp ? 1.1 : 1.15) && bid > 0) return { result: moneyResult(paid, bid), why: 'Time', exitPx: bid };
  if (p.flat && bid > 0) return { result: moneyResult(paid, bid), why: '15:55', exitPx: bid };
  if (p.dayOver && bid > 0) return { result: moneyResult(paid, bid), why: "Day's over", exitPx: bid };
  if (p.levelBroke && bid > 0) return { result: moneyResult(paid, bid), why: 'Level broke', exitPx: bid };
  if (p.choice !== p.side) return { result: 'caution', why: 'Caution', exitPx: bid > 0 ? bid : paid };
  if (p.rejected && bid > 0) return { result: moneyResult(paid, bid), why: 'Rejected', exitPx: bid };
  return null;
}

export function stopFromAsk(ask: number): number {
  return ask > 0 ? ask * STOP_KEEP : 0;
}

export function flatNow(at: number = Date.now()): boolean {
  return nyMinutes(at) >= 15 * 60 + 55;
}

function nyDay(at = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

function optionFees(exitPx: number): number {
  const sec = Math.max(0, exitPx) * 100 * 0.0000206;
  return Number((0.5 * 2 + 0.04 * 2 + sec).toFixed(2));
}

export function stampClose(row: {
  id: string;
  ticker: string;
  contract: string;
  right: OptionRight;
  strike: number;
  paid: number;
  exitPx: number;
  why: string;
  result: BookResult;
  held: number | null;
  signalBid?: number;
  signalAsk?: number;
  signalMid?: number;
  fillBid?: number;
  fillAsk?: number;
  fillMid?: number;
}): BookLine {
  const at = Date.now();
  const ret = row.paid > 0 ? Number(((row.exitPx / row.paid - 1) * 100).toFixed(1)) : 0;
  const fees = row.result === 'unavailable' ? 0 : optionFees(row.exitPx);
  const pnl = row.paid > 0 ? Number(((row.exitPx - row.paid) * 100 - fees).toFixed(2)) : 0;
  return {
    ...row,
    date: nyDay(at),
    exit: nyClock(at),
    ret,
    at,
    fees,
    pnl,
  };
}

let lines: BookLine[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function load(): BookLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is BookLine => {
      if (!row || typeof row !== 'object') return false;
      const r = row as BookLine;
      return typeof r.id === 'string' && (r.result === 'win' || r.result === 'loss' || r.result === 'caution' || r.result === 'unavailable');
    });
  } catch {
    return [];
  }
}

/**
 * 2026-10-27, 10:21 ET. The swing model scored this wing near 31%.
 * The exit is the first minute the close traded through +50%, not the high.
 */
const AVERAGE_WINS: BookLine[] = [
  [7730, 0.65, 0.98, 50, '10:24', 3],
  [7720, 1.2, 1.8, 50, '10:25', 4],
  [7700, 4, 6, 50, '10:25', 4],
  [7690, 6.9, 10.35, 50, '10:25', 4],
  [7680, 11.16, 16.74, 50, '10:29', 8],
  [7685, 8.85, 13.28, 50, '10:25', 4],
  [7695, 5.35, 8.03, 50, '10:25', 4],
  [7705, 2.95, 4.43, 50, '10:25', 4],
  [7710, 2.15, 3.23, 50, '10:25', 4],
  [7715, 1.6, 2.4, 50, '10:25', 4],
  [7725, 0.85, 1.28, 50, '10:24', 3],
  [7735, 0.47, 0.71, 50, '10:24', 3],
  [7740, 0.37, 0.56, 50, '10:25', 4],
  [7745, 0.3, 0.45, 50, '10:25', 4],
  [7750, 0.22, 0.33, 50, '10:24', 3],
  [7755, 0.2, 0.3, 50, '10:28', 7],
].map(([strike, paid, exitPx, ret, out, held]) => ({
  id: `avg-2026-10-27-SPXW-${strike}-C`,
  date: '2026-10-27',
  ticker: 'SPXW',
  contract: `SPXW ${strike}C`,
  right: 'C' as const,
  strike: strike as number,
  paid: paid as number,
  exitPx: exitPx as number,
  entered: '10:21',
  exit: out as string,
  why: '31% swing. In at 10:21. Out at +50% the first minute the close cleared it. Not the high.',
  result: 'win' as const,
  ret: ret as number,
  held: held as number,
  at: nyWallTime(2026, 10, 27, 10, 21),
}));

function seedAverageWins(): void {
  const byId = new Map(AVERAGE_WINS.map(line => [line.id, line]));
  let wrote = false;
  lines = lines.map(row => {
    const fresh = byId.get(row.id);
    if (!fresh) return row;
    byId.delete(row.id);
    if (row.exit === fresh.exit && row.exitPx === fresh.exitPx && row.why === fresh.why) return row;
    wrote = true;
    return fresh;
  });
  if (byId.size) {
    lines = [...byId.values(), ...lines];
    wrote = true;
  }
  if (!wrote) return;
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* this load still has the rows */ }
  emit();
}

export function bookLine(id: string): BookLine | null {
  return lines.find(row => row.id === id) ?? null;
}

export function remember(line: BookLine): void {
  if (lines.some(row => row.id === line.id)) return;
  lines = [line, ...lines];
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* the row still stands */ }
  emit();
}

export function useCompassBook(): BookLine[] {
  const [rows, setRows] = useState(lines);
  useEffect(() => {
    const fn = () => setRows(lines);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return rows;
}

export function lockFill(id: string, trackedAt: number, quote: LiveQuote | null, now = Date.now(), _ticker = ''): LockedFill {
  const held = fills.get(id);
  if (held && held.status !== 'wait') return held;
  if (!nextAskDue(trackedAt, now)) return { status: 'wait', bid: 0, ask: 0, mid: 0 };
  if (!quote || !(quote.ask > 0) || !(quote.bid > 0) || quote.ask < quote.bid) {
    const miss = { status: 'unavailable' as const, bid: 0, ask: 0, mid: 0 };
    fills.set(id, miss);
    return miss;
  }
  const locked = { status: 'filled' as const, bid: quote.bid, ask: quote.ask, mid: (quote.bid + quote.ask) / 2 };
  fills.set(id, locked);
  return locked;
}

export function settleOpen(tracked: TrackedSetup[], setups: Setup[], spots: Map<string, number>, opens: Map<string, number>): string[] {
  const gone: string[] = [];
  for (const t of tracked) {
    if (bookLine(t.id)) {
      gone.push(t.id);
      continue;
    }
    const setup = setups.find(s => s.id === t.id);
    const quote = setup && setup.quotedAt ? { bid: setup.bid, ask: setup.ask, at: setup.quotedAt } : null;
    const fill = lockFill(t.id, t.trackedAt, quote, Date.now(), t.ticker);
    if (fill.status === 'wait') continue;
    if (fill.status === 'unavailable') {
      remember(stampClose({
        id: t.id, ticker: t.ticker, contract: t.contract, right: t.right, strike: t.strike,
        paid: 0, exitPx: 0, why: 'Unavailable', result: 'unavailable', held: null,
        signalBid: t.signalBid, signalAsk: t.signalAsk, signalMid: t.signalMid,
      }));
      noteLeft(t, 'Unavailable');
      gone.push(t.id);
      continue;
    }
    if (!setup) continue;
    const paid = fill.ask;
    const held = Math.max(0, Math.round((Date.now() - t.trackedAt) / 60000));
    const spot = spots.get(t.ticker) ?? spots.get(t.ticker === 'SPXW' ? 'SPX' : t.ticker) ?? 0;
    const open = opens.get(t.ticker) ?? 0;
    const choice = choiceRight(t.right === 'C', spot, open);
    const call = closeOf({
      paid,
      bid: setup.bid,
      peak: peakBefore(t.id),
      heldMin: held,
      runner: setup.runner === true,
      scalp: setup.band === 'scalp',
      wing: setup.band === 'wing',
      side: t.right,
      choice,
      dayOver: setup.expiry === '0DTE' && odteBoardDone(true),
      flat: setup.expiry === '0DTE' && flatNow(),
      levelBroke: spot > 0 && setup.invalidationPrice > 0 && (t.right === 'C' ? spot <= setup.invalidationPrice : spot >= setup.invalidationPrice),
      rejected: !spreadOk(setup.bid, setup.ask),
    });
    if (!call) continue;
    remember(stampClose({
      id: t.id, ticker: t.ticker, contract: t.contract, right: t.right, strike: t.strike,
      paid, exitPx: call.exitPx, why: call.why, result: call.result, held,
      signalBid: t.signalBid, signalAsk: t.signalAsk, signalMid: t.signalMid,
      fillBid: fill.bid, fillAsk: fill.ask, fillMid: fill.mid,
    }));
    noteLeft(t, call.why);
    gone.push(t.id);
  }
  return gone;
}

lines = load();
seedAverageWins();
