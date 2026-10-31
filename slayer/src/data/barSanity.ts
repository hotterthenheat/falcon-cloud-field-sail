/* One shared sanity rule for intraday bars, run on every chart read of them: ThetaData's bars in data/thetaTape.ts
   pullIntraday (Terrain, the Weigher, Paper), the one-minute book tape in data/book/tape.ts (UW's or ThetaData's bars,
   Pinpoint's charts) and a Dossier name's session minutes (data/stockFile.ts, which also set the day's range). Daily
   bars have their own decimal-place rule (thetaTape.ts readEod).

   A bad print reaches a vendor bar's high or low and nothing else: on Fri 2026-10-23 SPY traded at 761 after the
   close, yet six Form T reports from one off-exchange venue (exchange 57, conditions 4 and 115 — neither may set the
   consolidated high, low or last) at 723.57–787.52 gave ThetaData's 17:00 fifteen-minute bar a 723.57–787.52 range
   under a 761.04→761.08 body. On days the prints are read (thetaEligible.ts) those bars are rebuilt from the prints
   that may set a price; older days keep the vendor's bars, so this rule is the net under every intraday chart.

   The rule. A wick is a bad print only when all of these hold:
   - it reaches past the body (open..close) of its own bar AND of every bar within NEAR bars on each side by more than
     max(SPAN_TIMES × the median range of those neighbours, FLOOR × price) — 8 typical bars, and at least 0.5%;
   - there are at least MIN_NEAR neighbours to judge by.
   A flagged wick of a stock is rebuilt from the bar's own price-setting prints (thetaEligible.ts saneStockBars: one
   small /stock/history/trade read per flagged bar); with no prints to read (an index, UW's bars, the terminal down) it
   is cut back to its own bar's body, the furthest price the bar is known to have traded at. The open, close and
   volume are never changed and no bar is dropped or added, so a real move — which moves the bodies of the bars it
   runs through — keeps its shape: of the 28,000 regular-session minutes of SPY, QQQ, NVDA and TSLA in April 2025 (the
   tariff crash and the 9 April rally) one is flagged (SPY 14 Apr 14:48, a 537.09 print that may set a price, so its
   rebuild keeps it), on the CPI and August 2024 days nothing in the session is cut, and a real pre-market wick in a
   crash (SPY 7 Apr 2025 08:04, 480.00) is put back from its prints (scripts/golden/bar-sanity-golden.ts). Most cuts
   are in the extended hours, where late reports at the prior close (SPY 5 Aug 2024 pre-market at 532.90, 3 Apr 2025
   at 564.52) and average-price prints draw the same spikes. */

import type { Candle } from '../types/market';

/** Bars on each side a wick is judged against */
export const NEAR = 10;
/** Fewer neighbours than this and the bar is left alone */
export const MIN_NEAR = 4;
/** How many typical neighbour ranges a wick must reach past the neighbours' bodies */
export const SPAN_TIMES = 8;
/** …and at least this share of the price */
export const FLOOR = 0.005;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface SaneWick {
  index: number;
  /** 'high' or 'low' wick cut */
  side: 'high' | 'low';
  /** the vendor's value and the value kept */
  was: number;
  now: number;
}

/** The wicks the rule would cut, oldest first. Pure: the bars are not changed. */
export function badWicks(bars: readonly Candle[]): SaneWick[] {
  const out: SaneWick[] = [];
  const n = bars.length;
  if (n < MIN_NEAR + 1) return out;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const top = Math.max(b.open, b.close);
    const foot = Math.min(b.open, b.close);
    /* cheap pre-check: a wick under the floor beyond its own body can never be cut */
    const floorHere = FLOOR * ((top + foot) / 2);
    if (b.high - top <= floorHere && foot - b.low <= floorHere) continue;
    let hiBody = top;
    let loBody = foot;
    const ranges: number[] = [];
    for (let j = Math.max(0, i - NEAR); j <= Math.min(n - 1, i + NEAR); j++) {
      if (j === i) continue;
      const c = bars[j];
      hiBody = Math.max(hiBody, c.open, c.close);
      loBody = Math.min(loBody, c.open, c.close);
      ranges.push(c.high - c.low);
    }
    if (ranges.length < MIN_NEAR) continue;
    const margin = Math.max(SPAN_TIMES * median(ranges), floorHere);
    if (b.high - hiBody > margin) out.push({ index: i, side: 'high', was: b.high, now: top });
    if (loBody - b.low > margin) out.push({ index: i, side: 'low', was: b.low, now: foot });
  }
  return out;
}

/** The bars with every bad wick cut back to its own body. The same array when nothing is cut. */
export function saneBars<T extends Candle>(bars: T[]): T[] {
  return mendWicks(bars, badWicks(bars), () => null);
}

/** The cut wicks mended: where `range(i)` gives the lowest and highest price-setting print inside bar i (a stock's
    prints, data/thetaEligible.ts saneStockBars), the wick is rebuilt from it — never inside the body, never past the
    vendor's own wick; where it gives null the wick is cut back to the body. The same array when nothing is cut. */
export function mendWicks<T extends Candle>(bars: T[], cuts: readonly SaneWick[], range: (index: number) => { lo: number; hi: number } | null): T[] {
  if (!cuts.length) return bars;
  const out = bars.slice();
  for (const c of cuts) {
    const b = out[c.index];
    const r = range(c.index);
    if (c.side === 'high') {
      const hi = r && r.hi > 0 ? Math.min(c.was, Math.max(c.now, r.hi)) : c.now;
      out[c.index] = { ...b, high: hi };
    } else {
      const lo = r && r.lo > 0 ? Math.max(c.was, Math.min(c.now, r.lo)) : c.now;
      out[c.index] = { ...b, low: lo };
    }
  }
  return out;
}
