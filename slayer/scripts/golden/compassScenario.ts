/*
  The hand-built session the Compass golden test scores (scripts/golden/compass-golden.ts) and its Python reference
  (scripts/golden/compass-ref.py) rebuild the same way: SPY one-minute bars 09:30–10:30 ET, five prior sessions for
  the volume curve, the prior day's range, an expiry's open interest and an ATM pair. Every number is a closed-form
  of the minute index, so the reference does not read this file.
*/

import type { Bar, PinBook } from '../../src/data/compassFeatures';

export const DAY = '20261028';
/** 10:30 ET: t = 60 minutes after the open */
export const MINUTE = 10 * 60 + 30;

/** Minute k of the session (k = 0 is 09:30). */
export function sessionBar(k: number, d = DAY): Bar {
  const o = 500 + 0.05 * k + 0.3 * Math.sin(k);
  return { d, m: 9 * 60 + 30 + k, o, h: o + 0.2 + 0.01 * (k % 7), l: o - 0.2, c: o + 0.1, v: 1000 + 20 * k };
}

export const sessionBars = (): Bar[] => Array.from({ length: 61 }, (_, k) => sessionBar(k));

/** Prior session j (1–5): volume 800 + 100·j + 10·k at minute k, the whole regular session. */
export const curveBars = (): Bar[] =>
  [1, 2, 3, 4, 5].flatMap(j => Array.from({ length: 390 }, (_, k) => ({ d: `2026102${j}`, m: 9 * 60 + 30 + k, o: 500, h: 500.5, l: 499.5, c: 500, v: 800 + 100 * j + 10 * k })));

export const PRIOR = { h: 505, l: 495, c: 499 };

/** Open interest by strike, 498–508: calls 1000 + 300·(K − 498), puts 4000 − 250·(K − 498). */
export const OI: { strike: number; call: number; put: number }[] = Array.from({ length: 11 }, (_, i) => ({ strike: 498 + i, call: 1000 + 300 * i, put: 4000 - 250 * i }));

export function pinBook(): PinBook {
  return {
    nodes: OI,
    oi: (strike, right) => {
      const n = OI.find(r => r.strike === strike);
      return n ? (right === 'C' ? n.call : n.put) : NaN;
    },
  };
}

/** The scored contract: SPY 505C at 1.20 × 1.24, with mids 1.10 five minutes back and 1.00 fifteen back. */
export const CONTRACT = { strike: 505, right: 'C' as const, bid: 1.2, ask: 1.24, m5: 1.1, m15: 1.0 };

/** The chain the ATM pair reads: strikes 501–507, calls and puts. */
export const CHAIN: { strike: number; right: 'C' | 'P'; bid: number; ask: number }[] = [
  { strike: 501, right: 'C', bid: 2.9, ask: 2.96 },
  { strike: 501, right: 'P', bid: 0.95, ask: 0.99 },
  { strike: 502, right: 'C', bid: 2.3, ask: 2.36 },
  { strike: 502, right: 'P', bid: 1.3, ask: 1.34 },
  { strike: 503, right: 'C', bid: 1.8, ask: 1.84 },
  { strike: 503, right: 'P', bid: 1.75, ask: 1.79 },
  { strike: 504, right: 'C', bid: 1.45, ask: 1.49 },
  { strike: 504, right: 'P', bid: 2.35, ask: 2.41 },
  { strike: 505, right: 'C', bid: 1.2, ask: 1.24 },
  { strike: 505, right: 'P', bid: 3.05, ask: 3.11 },
];
