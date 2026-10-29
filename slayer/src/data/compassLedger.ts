/*
  The paper book. Every pick fills at the ask of the first quote a full minute after the call;
  a missing quote is not replaced and a fill is never refused because the ask moved.
  Fees are a flat per-side estimate (see optionFees), not a broker's schedule.
*/

import { useEffect, useState } from 'react';
import type { OptionRight, Setup } from '../types/compass';
import type { TrackedSetup } from '../types/tracker';
import { currentPicks, entryAsk, noteLeft, pinFill } from './compassModel';
import { noteCompassCall } from './compassAlerts';
import { nyClock, nyMinutes, nyParts } from '../core/nyTime';
import { STOP_KEEP } from './contractQuote';
import { lotteryExit, reversalLine, stopAfter, treeExit } from './compassParams';

export type BookResult = 'win' | 'loss' | 'caution' | 'unavailable' | 'open';

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
  lottery?: boolean;
  heldSec?: number;
  scalp?: boolean;
  wing?: boolean;
  side: OptionRight;
  choice: OptionRight;
  dayOver: boolean;
  flat: boolean;
  levelBroke: boolean;
  rejected: boolean;
  ret5?: number;
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
  const stop = stopAfter(paid, peak, runner);
  let name = 'Stop';
  if (runner && peak >= paid * 4) name = 'Trail';
  else if (runner && peak >= paid * 3) name = 'TP3';
  else if (runner && peak >= paid * 2) name = 'TP2';
  else if (runner && peak >= paid * 1.5) name = 'TP1';
  else if (peak >= paid * 1.25) name = 'Breakeven';
  return { stop, name };
}

const moneyResult = (paid: number, exitPx: number): BookResult => (exitPx > paid ? 'win' : 'loss');

export function closeOf(p: CloseInput): { result: BookResult; why: string; exitPx: number } | null {
  const paid = p.paid;
  const bid = p.bid;
  if (!(paid > 0) || !Number.isFinite(bid) || bid < 0) return null;
  if (p.lottery) {
    const hit = lotteryExit(paid, bid, p.heldSec ?? 0);
    if (hit) return { result: moneyResult(paid, hit.px), why: hit.why, exitPx: hit.px };
    if (p.flat) return { result: moneyResult(paid, bid), why: '15:50', exitPx: bid };
    return null;
  }
  const prior = p.peak;
  const hit = treeExit(paid, bid, prior > 0 ? prior : 0, p.runner);
  if (hit) return { result: moneyResult(paid, hit.px), why: hit.why, exitPx: hit.px };
  if (p.heldMin >= 1 && Number.isFinite(p.ret5)) {
    const line = reversalLine(paid, bid, p.side, p.ret5 as number);
    if (line) return { result: moneyResult(paid, bid), why: line, exitPx: bid };
  }
  if (p.flat) return { result: moneyResult(paid, bid), why: 'end of day', exitPx: bid };
  return null;
}

export function stopFromAsk(ask: number): number {
  return ask > 0 ? ask * STOP_KEEP : 0;
}

export function flatNow(at: number = Date.now()): boolean {
  return nyMinutes(at) >= 15 * 60 + 55;
}

export function lotteryFlatNow(at: number = Date.now()): boolean {
  return nyMinutes(at) >= 15 * 60 + 50;
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
  const fees = row.result === 'unavailable' || row.result === 'open' ? 0 : optionFees(row.exitPx);
  const pnl = row.paid > 0 && row.result !== 'open' ? Number(((row.exitPx - row.paid) * 100 - fees).toFixed(2)) : 0;
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
      return typeof r.id === 'string' && (r.result === 'win' || r.result === 'loss' || r.result === 'caution' || r.result === 'unavailable' || r.result === 'open');
    });
  } catch {
    return [];
  }
}

/* Rows an older build wrote into every visitor's book without a real fill. */
const NOT_FILLED = /^avg-2026-10-27-SPXW-\d+-C$|^SPXW-7745-C-top-setups-odte$/;

function dropUnfilled(): void {
  const kept = lines.filter(row => !NOT_FILLED.test(row.id));
  if (kept.length === lines.length) return;
  lines = kept;
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* this load is clean either way */ }
}

export function bookLine(id: string): BookLine | null {
  return lines.find(row => row.id === id) ?? null;
}

/** A called ticket is on the blotter the moment it is called. The exit replaces this row. */
export function syncOpenBook(now = Date.now()): void {
  for (const pick of currentPicks()) {
    if (pick.band !== 'top' && pick.band !== 'wing' && pick.band !== 'lottery') continue;
    const paid = entryAsk(pick.id);
    if (!(paid > 0) || bookLine(pick.id)) continue;
    const at = pick.seenAt && pick.seenAt > 0 ? pick.seenAt : now;
    remember({
      id: pick.id,
      date: nyDay(at),
      ticker: pick.ticker,
      contract: pick.contract,
      right: pick.right,
      strike: pick.strike,
      paid,
      exitPx: 0,
      exit: '',
      why: pick.band === 'lottery' ? 'Book C. Open.' : pick.band === 'wing' ? 'Book B. Open.' : 'Book A. Open.',
      result: 'open',
      ret: 0,
      held: null,
      at,
      entered: nyClock(at),
      fees: 0,
      pnl: 0,
    });
    noteCompassCall(pick);
  }
}

export function remember(line: BookLine): void {
  const i = lines.findIndex(row => row.id === line.id);
  if (i >= 0) {
    if (lines[i].result !== 'open') return;
    lines = lines.map(row => (row.id === line.id ? line : row));
  } else {
    lines = [line, ...lines];
  }
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

const WAIT: LockedFill = { status: 'wait', bid: 0, ask: 0, mid: 0 };
/* No quote from the fill minute within this long after the call, and the fill is unavailable. */
const FILL_GIVE_UP_MS = 3 * 60_000;

/** The one fill rule for a pick: the ask of the first valid quote stamped a full minute after the call. */
export function lockFill(id: string, calledAt: number, quote: LiveQuote | null, now = Date.now()): LockedFill {
  const held = fills.get(id);
  if (held && held.status !== 'wait') return held;
  const pinned = entryAsk(id);
  if (pinned > 0) {
    const restored = { status: 'filled' as const, bid: 0, ask: pinned, mid: 0 };
    fills.set(id, restored);
    return restored;
  }
  if (!nextAskDue(calledAt, now)) return WAIT;
  const fresh = quote != null && quote.at > 0 && nextAskDue(calledAt, quote.at);
  const valid = fresh && quote.ask > 0 && quote.bid >= 0 && quote.ask >= quote.bid;
  if (!valid) {
    if (fresh || now - calledAt > FILL_GIVE_UP_MS) {
      const miss = { status: 'unavailable' as const, bid: 0, ask: 0, mid: 0 };
      fills.set(id, miss);
      return miss;
    }
    return WAIT;
  }
  const locked = { status: 'filled' as const, bid: quote.bid, ask: quote.ask, mid: (quote.bid + quote.ask) / 2 };
  fills.set(id, locked);
  pinFill(id, quote.ask);
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
    if (setup?.band === 'closest') continue;
    const quote = setup && setup.quotedAt ? { bid: setup.bid, ask: setup.ask, at: setup.quotedAt } : null;
    const lottery = setup?.band === 'lottery';
    const fill = lockFill(t.id, t.trackedAt, quote);
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
    const heldSec = Math.max(0, Math.round((Date.now() - t.trackedAt) / 1000));
    const prior = peakBefore(t.id);
    const spot = spots.get(t.ticker) ?? 0;
    const call = closeOf({
      paid,
      bid: setup.bid,
      peak: prior,
      heldMin: held,
      heldSec,
      runner: lottery ? false : setup.band === 'wing' || setup.runner === true,
      lottery,
      scalp: false,
      wing: setup.band === 'wing',
      side: t.right,
      choice: t.right,
      dayOver: false,
      flat: lottery ? lotteryFlatNow() : setup.expiry === '0DTE' && flatNow(),
      levelBroke: false,
      rejected: false,
      ret5: ret5Of(t.ticker, spot, Date.now()),
    });
    if (!call) {
      notePeak(t.id, setup.bid);
      continue;
    }
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

const spotMem = new Map<string, { t: number; px: number }[]>();

export function ret5Of(ticker: string, spot: number, now: number): number {
  const list = spotMem.get(ticker) ?? [];
  if (spot > 0) {
    const last = list[list.length - 1];
    if (!last || now - last.t >= 15_000) list.push({ t: now, px: spot });
  }
  const kept = list.filter(p => now - p.t <= 12 * 60_000);
  spotMem.set(ticker, kept);
  const want = now - 5 * 60_000;
  let ago = NaN;
  for (const p of kept) if (p.t <= want) ago = p.px;
  return ago > 0 && spot > 0 ? spot / ago - 1 : NaN;
}
export function settleBoard(live: Setup[], now = Date.now()): void {
  const byId = new Map(live.map(s => [s.id, s]));
  for (const pick of currentPicks()) {
    if (pick.band === 'closest') continue;
    const q = byId.get(pick.id);
    const bid = q && q.ask > 0 && q.bid >= 0 && q.ask >= q.bid ? q.bid : pick.bid;
    const spot = (q?.spot ?? pick.spot) || 0;
    const calledAt = pick.seenAt && pick.seenAt > 0 ? pick.seenAt : now;
    const quoted = q && q.quotedAt ? { bid: q.bid, ask: q.ask, at: q.quotedAt } : pick.quotedAt ? { bid: pick.bid, ask: pick.ask, at: pick.quotedAt } : null;
    const fill = lockFill(pick.id, calledAt, quoted, now);
    if (fill.status === 'wait') continue;
    if (fill.status === 'unavailable') {
      if (!bookLine(pick.id)) {
        remember(stampClose({
          id: pick.id, ticker: pick.ticker, contract: pick.contract, right: pick.right, strike: pick.strike,
          paid: 0, exitPx: 0, why: 'Unavailable', result: 'unavailable', held: null,
        }));
        noteLeft(pick, 'Unavailable');
      }
      continue;
    }
    const paid = fill.ask;
    if (!(paid > 0) || !(bid >= 0)) continue;
    const heldMin = pick.seenAt ? Math.max(0, Math.round((now - pick.seenAt) / 60000)) : 0;
    const heldSec = pick.seenAt ? Math.max(0, Math.round((now - pick.seenAt) / 1000)) : 0;
    const prior = peakBefore(pick.id);
    const call = closeOf({
      paid,
      bid,
      peak: prior,
      heldMin,
      heldSec,
      runner: pick.band === 'wing' || pick.runner === true,
      lottery: pick.band === 'lottery',
      scalp: false,
      wing: pick.band === 'wing',
      side: pick.right,
      choice: pick.right,
      dayOver: false,
      flat: pick.band === 'lottery' ? lotteryFlatNow(now) : flatNow(now),
      levelBroke: false,
      rejected: false,
      ret5: ret5Of(pick.ticker, spot, now),
    });
    if (!call) {
      notePeak(pick.id, bid);
      continue;
    }
    const why = call.why === 'TP1' ? 'Take profit' : call.why === 'Stop' ? 'Stop' : call.why;
    const at = pick.seenAt && pick.seenAt > 0 ? pick.seenAt : now;
    const had = bookLine(pick.id);
    remember({
      ...stampClose({
        id: pick.id,
        ticker: pick.ticker,
        contract: pick.contract,
        right: pick.right,
        strike: pick.strike,
        paid,
        exitPx: call.exitPx,
        why,
        result: call.result,
        held: heldMin,
        fillBid: fill.bid || undefined,
        fillAsk: fill.ask,
        fillMid: fill.mid || undefined,
      }),
      entered: had?.entered || nyClock(at),
    });
    noteLeft(pick, why);
  }
}

lines = load();
dropUnfilled();
