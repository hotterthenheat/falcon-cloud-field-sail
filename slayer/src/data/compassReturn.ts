/* A Compass call's return from its fill, as it stands now: (bid − fill) ÷ fill, read on the bid because the exit sells
   on the bid. One live quote per contract feeds every place that shows it (the board card, the contract page, the
   Tracker, the Blotter): thetaBook's useContractLive, one poll per contract however many readers hold it. Before the
   fill it waits; with no fresh quote it shows the last good one with its time, never as live; a closed call shows what
   it captured at its exit and the P&L, (exit − fill) × 100 a contract. No fees. Display only: nothing here fills,
   settles, scores or exits a call (that is the server's record, compassOutcome.ts). */

import { useCallback, useSyncExternalStore } from 'react';
import type { Signal } from './compassLedger';
import { useContractLive } from './thetaBook';
import { nyClock, nyIsoDate } from '../core/nyTime';

/** A live quote heard longer ago than this is no longer live (the poll is every 3 seconds). */
export const HEARD_MS = 10_000;
/** A quote whose own stamp is older than this, however recently heard, is the last good one, not the live one. */
export const QUOTE_AGE_MS = 60_000;

export type ReturnState = 'waiting' | 'live' | 'asof' | 'noquote' | 'captured' | 'unavailable';

export interface CallReturn {
  state: ReturnState;
  /** Percent from the fill: the live (or last good) bid's, or the exit's once closed */
  pct: number | null;
  /** Dollars per contract, (bid or exit − fill) × 100. No fees. */
  pnl: number | null;
  /** The bid it is read on, or the exit price once closed */
  px: number | null;
  /** The fill: the ask of the first quote a full minute after the call */
  fill: number | null;
  /** The quote's own instant (the exit's once closed), epoch ms; 0 with none */
  at: number;
}

type LiveQuote = { bid: number; ask: number; at: number; heard?: number } | null;
type CallLike = Pick<Signal, 'outcome'> | null | undefined;

const nothing = (state: ReturnState, fill: number | null = null): CallReturn => ({ state, pct: null, pnl: null, px: null, fill, at: 0 });

/** The call's return on a quote. Pure: the live quote (or null) and the clock come in. */
export function returnOf(sig: CallLike, live: LiveQuote, now = Date.now()): CallReturn {
  const o = sig?.outcome ?? null;
  if (!o || o.status === 'waiting') return nothing('waiting');
  if (o.status === 'unavailable') return nothing('unavailable');
  const fill = o.fill?.ask ?? 0;
  if (!(fill > 0)) return nothing('waiting');
  if (o.status === 'closed') {
    if (!o.exit) return nothing('unavailable', fill);
    const px = o.exit.px;
    return { state: 'captured', pct: ((px - fill) / fill) * 100, pnl: (px - fill) * 100, px, fill, at: o.exit.at };
  }
  /* open: the newer of the live quote and the server's last minute read */
  const okLive = live && live.ask > 0 && live.bid >= 0 && live.ask >= live.bid ? live : null;
  const last = o.last && o.last.bid >= 0 ? o.last : null;
  let px: number;
  let at: number;
  let state: ReturnState;
  if (okLive && (!last || okLive.at >= last.t)) {
    px = okLive.bid;
    at = okLive.at;
    const heard = okLive.heard ?? okLive.at;
    state = now - heard <= HEARD_MS && now - okLive.at <= QUOTE_AGE_MS ? 'live' : 'asof';
  } else if (last) {
    px = last.bid;
    at = last.t;
    state = 'asof';
  } else return nothing('noquote', fill);
  return { state, pct: ((px - fill) / fill) * 100, pnl: (px - fill) * 100, px, fill, at };
}

/* One clock for every reader: a call's live return turns "as of" when its quote stops arriving, without a quote to
   re-render it. */
let tickNow = Date.now();
let tickId: number | null = null;
const tickFns = new Set<() => void>();
function subscribeTick(fn: () => void): () => void {
  tickFns.add(fn);
  if (tickId == null && typeof window !== 'undefined') {
    tickId = window.setInterval(() => {
      tickNow = Date.now();
      tickFns.forEach(f => f());
    }, 2_000);
  }
  return () => {
    tickFns.delete(fn);
    if (!tickFns.size && tickId != null) {
      window.clearInterval(tickId);
      tickId = null;
    }
  };
}
const noTick = () => () => {};

/** A call's return now. An open call subscribes to its contract's one live quote (shared, keyed by contract); a
    waiting, closed or unavailable call reads nothing. */
export function useCallReturn(sig: Pick<Signal, 'outcome' | 'ticker' | 'expiry' | 'strike' | 'right'> | null | undefined): CallReturn {
  const o = sig?.outcome ?? null;
  const open = !!sig && o?.status === 'open' && (o.fill?.ask ?? 0) > 0 && !!sig.expiry && sig.expiry.slice(0, 10) >= nyIsoDate();
  const live = useContractLive(sig?.ticker ?? '', sig?.expiry ?? '', sig?.strike ?? 0, sig?.right ?? 'C', open);
  const sub = useCallback((fn: () => void) => (open ? subscribeTick(fn) : noTick()), [open]);
  const now = useSyncExternalStore(sub, () => (open ? tickNow : 0), () => 0);
  return returnOf(sig, live, open ? Math.max(now, Date.now()) : Date.now());
}

const MINUS = '−';
/** "+5.2%" · "−3.1%" · "0.0%" */
export const pctWord = (v: number): string => {
  const s = Math.abs(v).toFixed(1);
  return Number(s) === 0 ? '0.0%' : `${v > 0 ? '+' : MINUS}${s}%`;
};
/** "+$52.00" · "−$7.00" */
export const pnlWord = (v: number): string => {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Number(s.replace(/,/g, '')) === 0 ? '$0.00' : `${v > 0 ? '+' : MINUS}$${s}`;
};
/** Gain ink, loss ink, or neither at zero */
export const returnInk = (v: number | null): string => (v == null || Math.abs(v) < 0.05 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

/** What the hover says about the number. */
export function returnTip(r: CallReturn): string {
  const money = (v: number) => `$${v.toFixed(2)}`;
  switch (r.state) {
    case 'live':
      return `Live return from the fill: (bid − fill) ÷ fill, ${money(r.px ?? 0)} against ${money(r.fill ?? 0)}. The bid, because the exit sells on the bid. Per contract ${pnlWord(r.pnl ?? 0)}, no fees. Quote ${nyClock(r.at, { seconds: true, zone: true })}.`;
    case 'asof':
      return `No fresh live quote. This is the last good bid, ${money(r.px ?? 0)} at ${nyClock(r.at, { seconds: true, zone: true })}, against the fill ${money(r.fill ?? 0)}: (bid − fill) ÷ fill. Not live.`;
    case 'captured':
      return `Captured at the exit: (exit − fill) ÷ fill, ${money(r.px ?? 0)} against ${money(r.fill ?? 0)}. P&L per contract (exit − fill) × 100, no fees.`;
    case 'noquote':
      return `Filled at ${money(r.fill ?? 0)}. No valid live quote yet.`;
    case 'unavailable':
      return 'No valid quote stood a minute after the call, so it never filled. No price was substituted.';
    default:
      return 'Fills at the ask of the first quote a full minute after the call. The return counts from the fill.';
  }
}

/** The words: the main figure and what follows it ("+5.2%" · "$1.87 bid"; "Captured +31.0%" · "+$52.00"). */
export function returnWords(r: CallReturn): { main: string; rest: string; ink: string } {
  const px = r.px != null ? `$${r.px.toFixed(2)}` : '';
  switch (r.state) {
    case 'live':
      return { main: pctWord(r.pct ?? 0), rest: `${px} bid`, ink: returnInk(r.pct) };
    case 'asof':
      return { main: pctWord(r.pct ?? 0), rest: `${px} bid · as of ${nyClock(r.at)}`, ink: 'text-textSecondary' };
    case 'captured':
      return { main: `Captured ${pctWord(r.pct ?? 0)}`, rest: pnlWord(r.pnl ?? 0), ink: returnInk(r.pct) };
    case 'noquote':
      return { main: 'No live quote', rest: '', ink: 'text-textMuted' };
    case 'unavailable':
      return { main: 'No fill', rest: '', ink: 'text-textMuted' };
    default:
      return { main: 'Waiting for fill', rest: '', ink: 'text-textMuted' };
  }
}
