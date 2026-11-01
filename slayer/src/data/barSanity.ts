/* One shared sanity rule for intraday bars, run on every chart read of them: ThetaData's bars in data/thetaTape.ts
   pullIntraday (Terrain, the Weigher, Paper), the one-minute book tape in data/book/tape.ts (UW's or ThetaData's bars,
   Pinpoint's charts) and a Dossier name's session minutes (data/stockFile.ts, which also set the day's range). Daily
   bars have their own decimal-place rule (thetaTape.ts readEod).

   A bad print reaches a vendor bar's prices: on Fri 2026-10-23 SPY traded at 761 after the close, yet six Form T
   reports from one off-exchange venue (exchange 57, conditions 4 and 115 — neither may set the consolidated high, low
   or last) at 723.57–787.52 gave ThetaData's 17:00 fifteen-minute bar a 723.57–787.52 range under a 761.04→761.08
   body, and its 17:01 one-minute bar a close of 728.67 (the next minute opened at 761.01). On days the prints are read
   (thetaEligible.ts) those bars are rebuilt from the prints that may set a price; older days keep the vendor's bars,
   so this rule is the net under every intraday chart.

   The rule, for a bar with at least MIN_SIDE bars on each side in its own run (bars with no pause of over 15 minutes
   between them: a session's first bar is never held against the day before, and the newest bars of a live tape wait
   for the bars after them). Its neighbours are the NEAR bars on each side in that run; their band runs from their
   lowest to their highest open or close, less the three most extreme values at each end (a run of odd lots can set a
   few opens and closes — SPY's 17:40–17:42 minutes on 23 Oct 2026 opened or closed at 767.61–768.01 with the market at
   761.05; a real level is held by more bars than that). Its margin is max(SPAN_TIMES × the neighbours' median range,
   FLOOR × price): 8 typical bars, and at least 0.5%.
   - An open or close outside the band by more than the margin is a bad print.
   - A high or low past both the band and the bar's own (mended) body by more than the margin is a bad print.
   A stock's flagged bar is rebuilt from its own price-setting prints (thetaEligible.ts saneStockBars: one small
   /stock/history/trade read per flagged bar); with no prints to read (an index, UW's bars, the terminal down) a wick
   is cut back to the body, an open takes the close before it and a close the open after it. Volume is never changed and
   no bar is dropped or added, so a real move — which moves the bodies of the bars it runs through, and is held by the
   next bar's open — keeps its shape: of the 28,000 regular-session minutes of SPY, QQQ, NVDA and TSLA in April 2025
   (the tariff crash and the 9 April rally) and GME's in May–June 2024 (halts, a 64.83 open over a 30.45 close) one is
   flagged (SPY 14 Apr 14:48, a 537.09 print that may set a price, so its rebuild keeps it), and a real pre-market wick
   in a crash (SPY 7 Apr 2025 08:04, 480.00) is put back from its prints (scripts/golden/bar-sanity-golden.ts). Most flags are in the extended hours, where late reports at the prior
   close (SPY 5 Aug 2024 pre-market at 532.90, 3 Apr 2025 at 564.52) and average-price prints draw the same spikes. */

import type { Candle } from '../types/market';

/** Bars on each side a bar is judged against */
export const NEAR = 10;
/** Fewer neighbours than this on either side and the bar is left alone */
export const MIN_SIDE = 3;
/** How many typical neighbour ranges a price must reach past the neighbours' band */
export const SPAN_TIMES = 8;
/** …and at least this share of the price */
export const FLOOR = 0.005;
/** The neighbours' most extreme opens and closes at each end left out of their band */
const TRIM = 3;
/** A pause longer than this (and than four bars) ends a run of bars: a session's edge, not a halt */
const RUN_GAP_SEC = 15 * 60;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type BarField = 'open' | 'high' | 'low' | 'close';
export interface SaneFix {
  index: number;
  field: BarField;
  /** the vendor's value, and the value kept when the bar's prints cannot be read */
  was: number;
  now: number;
}

/** Every price the rule would replace, oldest first. Pure: the bars are not changed. */
export function badBars(bars: readonly Candle[]): SaneFix[] {
  const out: SaneFix[] = [];
  const n = bars.length;
  if (n < 2 * MIN_SIDE + 1) return out;
  /* runs of bars with no pause between them: a bar is judged only against its own run, so a session's first bar is
     never held against the day before it (an opening gap is a real move: GME opened 14 May 2024 at 64.83 over a 30.45
     close) */
  let step = Infinity;
  for (let i = 1; i < n; i++) {
    const dt = bars[i].time - bars[i - 1].time;
    if (dt > 0 && dt < step) step = dt;
  }
  const gap = Math.max(4 * step, RUN_GAP_SEC);
  const runFrom: number[] = new Array(n);
  const runTo: number[] = new Array(n);
  for (let i = 0; i < n; i++) runFrom[i] = i > 0 && bars[i].time - bars[i - 1].time <= gap ? runFrom[i - 1] : i;
  for (let i = n - 1; i >= 0; i--) runTo[i] = i < n - 1 && bars[i + 1].time - bars[i].time <= gap ? runTo[i + 1] : i;
  const vals: number[] = [];
  const ranges: number[] = [];
  for (let i = 0; i < n - MIN_SIDE; i++) {
    const from = Math.max(runFrom[i], i - NEAR);
    const to = Math.min(runTo[i], i + NEAR);
    /* the newest bars wait for the bars after them; a run's first bars (the after-hours tape's 16:00–16:02, a
       pre-market's 04:00) are judged against the bars after them alone, twice as many of them */
    if (to - i < MIN_SIDE) continue;
    const left = i - from >= MIN_SIDE;
    if (!left && to - i < 2 * MIN_SIDE) continue;
    const b = bars[i];
    const next = bars[i + 1];
    /* the day before is never the reference: at a run's start the price before is the next bar's open */
    const prev = i > runFrom[i] ? bars[i - 1] : { ...next, close: next.open };
    /* cheap pre-check: a bar that stays within the floor of the prices on both sides of it is never touched (both: the
       price on one side may be a bad print itself) */
    const floorHere = FLOOR * prev.close;
    const near = (v: number) => Math.abs(v - prev.close) <= floorHere && Math.abs(v - next.open) <= floorHere;
    if (near(b.high) && near(b.low)) continue;
    vals.length = 0;
    ranges.length = 0;
    for (let j = from; j <= to; j++) {
      if (j === i) continue;
      const c = bars[j];
      vals.push(c.open, c.close);
      ranges.push(c.high - c.low);
    }
    vals.sort((x, y) => x - y);
    const loN = vals[TRIM];
    const hiN = vals[vals.length - 1 - TRIM];
    const margin = Math.max(SPAN_TIMES * median(ranges), floorHere);
    const inBand = (v: number) => v >= loN - margin && v <= hiN + margin;
    let open = b.open;
    let close = b.close;
    /* an open with no bars before it in its run is the move's own start (news in the first minute): never judged */
    if (left && !inBand(open)) {
      open = inBand(prev.close) ? prev.close : median(vals);
      out.push({ index: i, field: 'open', was: b.open, now: open });
    }
    if (!inBand(close)) {
      close = inBand(next.open) ? next.open : median(vals);
      out.push({ index: i, field: 'close', was: b.close, now: close });
    }
    const top = Math.max(open, close);
    const foot = Math.min(open, close);
    if (b.high - Math.max(hiN, top) > margin) out.push({ index: i, field: 'high', was: b.high, now: top });
    if (Math.min(loN, foot) - b.low > margin) out.push({ index: i, field: 'low', was: b.low, now: foot });
  }
  return out;
}

/** The bars with every bad price replaced as the rule says, without prints. The same array when nothing is flagged. */
export function saneBars<T extends Candle>(bars: T[]): T[] {
  return mendBars(bars, badBars(bars), () => null);
}

/** A bar's price-setting prints: the lowest, highest, first and last */
export type PrintRange = { lo: number; hi: number; first: number; last: number };

/** The flagged prices mended. Where `range(i)` gives bar i's own price-setting prints (a stock's, data/thetaEligible.ts
    saneStockBars) its flagged prices are rebuilt from them — the open from the first, the close from the last, a wick
    from the lowest or highest, never past the vendor's own wick; where it gives null each takes its `now`. A bar always
    holds its body. The same array when nothing is flagged. */
export function mendBars<T extends Candle>(bars: T[], fixes: readonly SaneFix[], range: (index: number) => PrintRange | null): T[] {
  if (!fixes.length) return bars;
  const out = bars.slice();
  const byBar = new Map<number, SaneFix[]>();
  for (const f of fixes) byBar.set(f.index, [...(byBar.get(f.index) ?? []), f]);
  for (const [i, fs] of byBar) {
    const b = { ...out[i] };
    const r = range(i);
    const fix = (f: BarField) => fs.find(x => x.field === f);
    const o = fix('open');
    const c = fix('close');
    const h = fix('high');
    const l = fix('low');
    if (o) b.open = r ? r.first : o.now;
    if (c) b.close = r ? r.last : c.now;
    const top = Math.max(b.open, b.close);
    const foot = Math.min(b.open, b.close);
    if (h) b.high = r ? Math.min(h.was, Math.max(top, r.hi)) : top;
    if (l) b.low = r ? Math.max(l.was, Math.min(foot, r.lo)) : foot;
    b.high = Math.max(b.high, top);
    b.low = Math.min(b.low, foot);
    out[i] = b;
  }
  return out;
}
