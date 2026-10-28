/*
==================================================
  SLAYER TERMINAL - THE CHART'S OWN INDICATORS
  (components/gex/indicatorItems.ts)

  The built-in overlays and panes StrikeChart draws
  from its own maths (data/indicators.ts) — the
  "Chart tools" shelf of the script library, and
  the rows the toolbar used to list. Kept apart from
  the toolbar so the library can read them without
  a circle.
==================================================
*/

import type { ChartIndicators } from './StrikeChart';

export interface IndicatorItem {
  key: keyof ChartIndicators;
  label: string;
  hint: string;
  /** Takes its own pane under the tape (the sub-pane cap applies) */
  sub?: boolean;
  /** The shelf it sits on. The book lines are not more moving averages. */
  group?: 'book';
}

/* The order is the menu's order: the book first, then the tape, then the
   panes. A pane takes height OFF the tape, which is why the sub-panes carry
   the cap (MAX_SUB_PANES), refused in place with the reason. */
export const INDICATOR_ITEMS: IndicatorItem[] = [
  { key: 'flowVwap', group: 'book', label: 'Flow VWAP', hint: 'Where the options paid. Session price weighted by premium, not by shares. SPX uses the SPXW prints. Other names use the feed’s ask, bid and mid dollars. Blank until those land — a share VWAP is not stood in. Unit: price. Warmup: the session. Source: gross premium. Alert: no. Replay: no.' },
  { key: 'sideVwap', group: 'book', label: 'Side VWAP', hint: 'Two lines. Where calls paid, and where puts paid. A side that has not printed stays blank. Unit: price. Warmup: the session. Source: call and put premium. Alert: no. Replay: no.' },
  { key: 'gammaEma', group: 'book', label: 'Gamma EMA', hint: 'A 21-bar average that speeds up when the feed’s minute gamma is heavy and slows when it is quiet. Blank until that path actually moves — a plain EMA is not stood in. Unit: price. Warmup: 21 bars, and a gamma path that moves. Source: minute net gamma. Alert: no. Replay: no.' },
  { key: 'gammaVwap', group: 'book', label: 'Gamma VWAP', hint: 'Session price weighted by the size of the minute gamma, not by shares. It sits where the heavy minutes printed. Blank until that path moves. Unit: price. Warmup: the session. Source: minute net gamma. Alert: no. Replay: no.' },
  { key: 'ema9', label: 'EMA 9', hint: '9-bar exponential moving average of the close. Seeded on the first close. Unit: price. Warmup: 9 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'ema21', label: 'EMA 21', hint: '21-bar exponential moving average of the close. Unit: price. Warmup: 21 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'ema50', label: 'EMA 50', hint: '50-bar exponential moving average of the close. Unit: price. Warmup: 50 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'sma', label: 'SMA 200', hint: 'Mean of the last 200 closes. Blank until the window exists. Unit: price. Warmup: 200 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.' },
  { key: 'vwap', label: 'VWAP', hint: 'Volume-weighted average price, reset when a gap looks like a new session. Off on range bars. Unit: price. Warmup: the session. Source: price and share volume. Alert: yes. Replay: the tape only.' },
  { key: 'vwapBands', label: 'VWAP bands', hint: '±1σ and ±2σ around the session VWAP, volume-weighted. Unit: price. Warmup: the session. Source: price and share volume. Alert: no. Replay: the tape only.' },
  { key: 'bb', label: 'Bollinger', hint: '20-bar average ± 2 standard deviations. Unit: price. Warmup: 20 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.' },
  { key: 'rsi', label: 'RSI 14', hint: 'Wilder momentum, 30 and 70 rails, in its own pane. Unit: 0–100. Warmup: 14 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.', sub: true },
  { key: 'macd', label: 'MACD', hint: '12/26 EMAs, a 9-bar signal, and the histogram, in its own pane. Unit: price. Warmup: 26 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.', sub: true },
  { key: 'atrPane', label: 'ATR 14', hint: 'Wilder average true range of the bars on this pane. Unit: price. Warmup: 14 bars. Source: this pane’s bars. Alert: no. Replay: the tape only.', sub: true },
];

/** Short word on the crosshair row. The key itself is what the menu already says. */
export const INDICATOR_WORD: Partial<Record<keyof ChartIndicators, string>> = {
  flowVwap: 'flow',
  sideVwap: 'sides',
  gammaEma: 'gEMA',
  gammaVwap: 'gVWAP',
};
