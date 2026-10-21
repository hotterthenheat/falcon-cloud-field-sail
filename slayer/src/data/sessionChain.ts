/*
  WHAT ACTUALLY PRINTS IN THE SESSION THE DESK IS READING.

  Theta Data Pro carries the cash chain, the new premarket and after-hours
  window on the equity and ETF names that were opened, and the overnight
  book on SPX, VIX and XSP. The strip under the head is that book: the
  underlying quote, then the strikes with bid, ask, implied vol, delta,
  open interest and volume.
*/

import { hRange } from '../core/rng';
import { dayKey } from '../core/rng';
import type { DeskSession } from './deskSession';

export const OVERNIGHT_ROOTS = ['SPX', 'VIX', 'XSP'] as const;
export const EXTENDED_ROOTS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA', 'TSLA', 'AMD', 'AMZN', 'META', 'MSFT'] as const;

export interface SessionQuote {
  root: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
}

export interface SessionPrint {
  id: string;
  root: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  oi: number;
  volume: number;
}

export interface SessionBook {
  session: DeskSession;
  /** The name on the desk is one of the roots that print in this session */
  covered: boolean;
  roots: string[];
  quote: SessionQuote;
  prints: SessionPrint[];
  note: string;
}

const BASE: Record<string, number> = {
  SPX: 5812,
  VIX: 16.4,
  XSP: 581,
  SPY: 578,
  QQQ: 498,
  IWM: 221,
  AAPL: 232,
  NVDA: 139,
  TSLA: 255,
  AMD: 164,
  AMZN: 198,
  META: 543,
  MSFT: 448,
};

function rootsFor(session: DeskSession, ticker: string): { roots: string[]; covered: boolean } {
  const root = ticker.toUpperCase();
  if (session === 'overnight') {
    const covered = (OVERNIGHT_ROOTS as readonly string[]).includes(root);
    return { roots: [...OVERNIGHT_ROOTS], covered };
  }
  if (session === 'pre' || session === 'post') {
    const covered = (EXTENDED_ROOTS as readonly string[]).includes(root);
    return { roots: covered ? [root] : [...EXTENDED_ROOTS].slice(0, 6), covered };
  }
  return { roots: [root], covered: true };
}

export function sessionBook(session: DeskSession, ticker: string): SessionBook {
  const day = dayKey();
  const { roots, covered } = rootsFor(session, ticker);
  const focus = covered ? ticker.toUpperCase() : roots[0];
  const base = BASE[focus] ?? 100;
  const last = Number((base + hRange(`${day}-sq-${session}-${focus}`, -1.4, 1.4)).toFixed(2));
  const quote: SessionQuote = {
    root: focus,
    last,
    bid: Number((last - hRange(`${day}-sb-${focus}`, 0.05, 0.4)).toFixed(2)),
    ask: Number((last + hRange(`${day}-sa-${focus}`, 0.05, 0.4)).toFixed(2)),
    volume: Math.round(hRange(`${day}-sv-${session}-${focus}`, 8_000, 1_800_000)),
  };
  const rights: Array<'C' | 'P'> = ['C', 'P', 'C', 'P', 'C', 'P'];
  const prints: SessionPrint[] = rights.map((right, i) => {
    const root = roots[i % roots.length];
    const rootBase = BASE[root] ?? last;
    const strike = Math.round(rootBase * (0.97 + i * 0.012));
    const bid = Number(hRange(`${day}-ob-${session}-${root}-${i}`, 0.4, 8.5).toFixed(2));
    return {
      id: `${session}-${root}-${strike}${right}`,
      root,
      expiry: session === 'overnight' ? '2026-10-20' : session === 'rth' ? '2026-10-24' : '2026-10-20',
      strike,
      right,
      bid,
      ask: Number((bid + hRange(`${day}-oa-${session}-${root}-${i}`, 0.05, 0.35)).toFixed(2)),
      iv: Number(hRange(`${day}-iv-${session}-${root}-${i}`, 12, 46).toFixed(1)),
      delta: Number((right === 'C' ? hRange(`${day}-d-${root}-${i}`, 0.18, 0.62) : -hRange(`${day}-d-${root}-${i}`, 0.18, 0.62)).toFixed(2)),
      oi: Math.round(hRange(`${day}-oi-${root}-${i}`, 400, 42000)),
      volume: Math.round(hRange(`${day}-ov-${session}-${root}-${i}`, 20, 8000)),
    };
  });
  const window =
    session === 'overnight'
      ? 'Overnight options print on SPX, VIX and XSP only.'
      : session === 'pre'
        ? 'Premarket options print on the equity and ETF names that were opened for the window.'
        : session === 'post'
          ? 'After-hours options print on the same equity and ETF names, in the short window after the cash close.'
          : 'The cash session. Every listed name, stock and options.';
  const note = covered
    ? `${quote.root} is on this session's book. ${window}`
    : `${ticker.toUpperCase()} does not print in this session. ${window}`;
  return { session, covered, roots, quote, prints, note };
}
