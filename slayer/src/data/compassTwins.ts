/* The random-side twin of every Compass call (the forward test the research protocol asks for: PROTOCOL §6 random side,
   §7 the live shadow). For each official Model 1 or Model 3 call, the same root, expiry, instant and rule on the
   OPPOSITE side: a put for a call, a call for a put, at the strike that mirrors the call's moneyness (the listed strike
   nearest spot² ÷ strike, so a contract 3 points in the money mirrors to one about 3 points in the money on the other
   side). It fills and exits by the call's own rules on its own recorded quotes (compassLedger settledCopy), so a call
   and its twin differ only in the side the model chose. A twin is never a call, never a seat and never on the board.

   The engine keeps them (one file per session, <dir>/twins/YYYY-MM-DD.json, data/compassServer.ts) and serves them with
   the record; a twin missing for a recorded call (calls from before twins, a restart) is made and settled from the
   recorded quotes on the next pass, so the past record fills in by itself. */

import { useSyncExternalStore } from 'react';
import { settleDue, settledCopy, type Signal } from './compassLedger';
import { compassHost } from './compassHost';
import type { OptionRight } from '../types/compass';

export interface Twin extends Signal {
  twin: true;
  /** The call's key */
  twinOf: string;
  /** Why it has no contract: no spot at the call, or no strike listed on the other side */
  none?: string;
}

/** The listed strike that mirrors `strike` across `spot` in log moneyness (spot² ÷ strike); ties go to the strike nearer
    the spot. Null with no spot or no strikes. */
export function mirrorStrike(strikes: readonly number[], spot: number, strike: number): number | null {
  if (!(spot > 0) || !(strike > 0) || !strikes.length) return null;
  const target = (spot * spot) / strike;
  let best: number | null = null;
  for (const k of strikes) {
    if (!(k > 0)) continue;
    if (best == null) {
      best = k;
      continue;
    }
    const d = Math.abs(k - target) - Math.abs(best - target);
    if (d < -1e-9 || (Math.abs(d) <= 1e-9 && Math.abs(k - spot) < Math.abs(best - spot))) best = k;
  }
  return best;
}

const strikeWord = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(2));

/** A call's twin on the other side at `strike` (null: no contract; the twin is kept, marked unavailable, with `none`). */
export function twinOf(call: Signal, strike: number | null, none = ''): Twin {
  const right: OptionRight = call.right === 'C' ? 'P' : 'C';
  const k = strike ?? call.strike;
  return {
    ...call,
    key: `${call.key}|twin`,
    id: `${call.id}|twin`,
    right,
    strike: k,
    contract: `${call.ticker} ${strikeWord(k)}${right}`,
    bid: 0,
    ask: 0,
    p1: null,
    prun: null,
    cost: undefined,
    outcome: strike == null ? { status: 'unavailable', fill: null, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, heldMin: null } : null,
    pathAt: 0,
    spark: [],
    twin: true,
    twinOf: call.key,
    ...(strike == null ? { none: none || 'No contract on the other side.' } : {}),
  };
}

/* ---- the store: the server's, and the browser's copy of it ---- */

let rows: Twin[] = [];
let rev = 0;
const listeners = new Set<() => void>();
const changeFns = new Set<() => void>();

function emit(): void {
  rev += 1;
  for (const fn of listeners) fn();
}

function changed(): void {
  for (const fn of changeFns) fn();
  emit();
}

const validTwin = (r: unknown): r is Twin => {
  if (!r || typeof r !== 'object') return false;
  const t = r as Twin;
  return t.twin === true && typeof t.key === 'string' && typeof t.twinOf === 'string' && (t.right === 'C' || t.right === 'P') && t.firedAt > 0;
};

/** Replace the twins with kept or served rows. */
export function importTwins(next: readonly unknown[]): void {
  rows = next.filter(validTwin);
  emit();
}

/** Every twin, in no order. */
export function twinRows(): Twin[] {
  return rows;
}

/** Called after every change the engine makes (the server writes them). */
export function onTwinsChange(fn: () => void): () => void {
  changeFns.add(fn);
  return () => changeFns.delete(fn);
}

/** The twins, as the last state read handed them over. */
export function useTwins(): Twin[] {
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

/* ---- the engine: make the missing twins and settle the open ones ---- */

const strikeMemo = new Map<string, number[]>();
const ymd = (iso: string) => iso.replace(/-/g, '');

/** The strikes listed for a root's expiry (one read, kept), or null when the terminal did not answer. */
async function listedStrikes(ticker: string, expiry: string): Promise<number[] | null> {
  const key = `${ticker}|${expiry}`;
  const kept = strikeMemo.get(key);
  if (kept) return kept;
  const got = await compassHost().theta(`/option/list/strikes?symbol=${encodeURIComponent(ticker)}&expiration=${ymd(expiry)}&format=json`);
  if (got.error && got.error !== 'no_data') return null;
  const list = (Array.isArray(got.data) ? got.data : [])
    .map(r => Number((r as { strike?: unknown })?.strike))
    .filter(k => Number.isFinite(k) && k > 0);
  const strikes = [...new Set(list)].sort((a, b) => a - b);
  strikeMemo.set(key, strikes);
  if (strikeMemo.size > 200) strikeMemo.delete(strikeMemo.keys().next().value as string);
  return strikes;
}

/** The calls that get a twin: official Model 1 and Model 3 calls (not Model Risk, not a would-call). */
export function twinnable(s: Signal): boolean {
  return (s.book === 'A' || s.book === 'B' || s.book === 'C') && !s.would && !(s as Partial<Twin>).twin;
}

let busy = false;

/** One pass: make the twin of every recorded call that has none, then settle the twins still open, oldest call first,
    at most `budget` path reads (the engine runs this after the calls' own settlement, once a minute). */
export async function settleTwins(calls: readonly Signal[], now = Date.now(), budget = 8): Promise<void> {
  if (busy || !compassHost().server) return;
  busy = true;
  try {
    let left = budget;
    const have = new Set(rows.map(t => t.twinOf));
    for (const call of [...calls].filter(twinnable).sort((a, b) => a.firedAt - b.firedAt)) {
      if (have.has(call.key) || left <= 0) continue;
      left -= 1;
      if (!(call.spot && call.spot > 0)) {
        rows = [...rows, twinOf(call, null, 'No underlying price at the call.')];
        have.add(call.key);
        changed();
        continue;
      }
      const strikes = await listedStrikes(call.ticker, call.expiry);
      if (!strikes) continue;
      const k = mirrorStrike(strikes, call.spot, call.strike);
      rows = [...rows, twinOf(call, k, k == null ? 'No strike listed on the other side.' : '')];
      have.add(call.key);
      changed();
    }
    for (const t of [...rows].sort((a, b) => a.firedAt - b.firedAt)) {
      if (left <= 0) break;
      if (!settleDue(t, now)) continue;
      left -= 1;
      const next = await settledCopy(t, now);
      if (!next) continue;
      rows = rows.map(r => (r.key === t.key ? ({ ...next, twin: true, twinOf: t.twinOf } as Twin) : r));
      changed();
    }
  } finally {
    busy = false;
  }
}
