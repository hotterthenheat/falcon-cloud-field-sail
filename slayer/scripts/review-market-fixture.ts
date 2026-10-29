/*
  A hand-made market for the backtest engine's proofs: three sessions of SPY and QQQ minute bars and an NBBO for every
  listed strike, each a plain formula so every expected fill can be worked out by hand. It is test input put straight
  into data/review/history.ts (putBars / putListing / putQuotes) — never shipped, never shown as a market.

  SPY's price at the end of minute m (0…389):
    2026-10-26  500 + 0.02·m up to minute 100 (502.00), then 502 − 0.01·(m − 100)   → 499.11 at the bell
    2026-10-27  499 + 0.005·m                                                         → 500.945 at the bell
    2026-10-28  501 − 0.01·m                                                          → 497.11 at the bell
  QQQ: 400 + 0.01·m every day.
  A contract's mid is what it is worth in the money plus 2.50 (never under 0.05); its bid and ask sit 0.05 either side.
  Listed: expiries 2026-10-28 and 2026-11-06; SPY strikes 490–510, QQQ 390–410, a dollar apart.
*/

import { DAY_MIN, barTime, putBars, putListing, putQuotes, putWindow } from '../src/data/review/history';
import type { Candle } from '../src/types/market';

export const D1 = '2026-10-26';
export const D2 = '2026-10-27';
export const D3 = '2026-10-28';
export const DAYS = [D1, D2, D3];
export const NEAR = '2026-10-28';
export const FAR = '2026-11-06';

const c2 = (v: number) => Math.round(v * 100) / 100;
export function spot(ticker: string, day: string, m: number): number {
  if (ticker === 'QQQ') return c2(400 + 0.01 * m);
  if (day === D1) return c2(m <= 100 ? 500 + 0.02 * m : 502 - 0.01 * (m - 100));
  if (day === D2) return Math.round((499 + 0.005 * m) * 1000) / 1000;
  return c2(501 - 0.01 * m);
}
export const mid = (s: number, k: number, right: 'C' | 'P') => c2(Math.max(0.05, Math.max(0, right === 'C' ? s - k : k - s) + 2.5));
export const bidOf = (s: number, k: number, right: 'C' | 'P') => c2(mid(s, k, right) - 0.05);
export const askOf = (s: number, k: number, right: 'C' | 'P') => c2(mid(s, k, right) + 0.05);

export function installTestMarket(): void {
  putWindow(D1);
  for (const t of ['SPY', 'QQQ']) {
    const strikes = Array.from({ length: 21 }, (_, i) => (t === 'SPY' ? 490 : 390) + i);
    for (const day of DAYS) {
      const bars: Candle[] = [];
      for (let m = 0; m < DAY_MIN; m++) {
        const close = spot(t, day, m);
        const open = m ? spot(t, day, m - 1) : close;
        bars.push({ time: barTime(day, m), open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 });
      }
      putBars(t, day, bars);
      const exps = [NEAR, FAR].filter(e => e >= day);
      putListing(t, day, { expiries: exps, strikes: Object.fromEntries(exps.flatMap(e => [[`${e}|C`, strikes], [`${e}|P`, strikes]])) });
      for (const e of exps)
        for (const k of strikes)
          for (const right of ['C', 'P'] as const) {
            const b: number[] = [];
            const a: number[] = [];
            for (let m = 0; m < DAY_MIN; m++) {
              const s = spot(t, day, m);
              b.push(bidOf(s, k, right));
              a.push(askOf(s, k, right));
            }
            putQuotes({ ticker: t, expiry: e, strike: k, right }, day, b, a);
          }
    }
  }
}
