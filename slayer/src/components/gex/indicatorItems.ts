/* The built-in overlays and panes StrikeChart draws from data/indicators.ts (the library's "Chart tools" shelf),
   kept apart from the toolbar so the library can read them without an import cycle. */

import type { ChartIndicators } from './StrikeChart';
import type { IndicatorInputSpec } from '../../data/indicatorLooks';
import { PHYSICS_READS, type PhysicsKey } from '../../data/physicsReads';
import { TV_SPECIAL_ITEMS } from './tvSpecialItems';

interface IndicatorItem {
  key: keyof ChartIndicators;
  label: string;
  hint: string;
  /** Takes its own pane under the tape (the sub-pane cap applies) */
  sub?: boolean;
  /** The shelf it sits on. The book lines are not more moving averages. */
  group?: 'book' | 'physics' | 'profile' | 'levels' | 'candles';
  /** One of the study's five tested reads: its physics name, plain name and CALCULATED / MODEL tag */
  physics?: PhysicsKey;
  /** What the settings dialog's Inputs tab offers (none: the tab is not shown, as on a fixed formula) */
  inputs?: IndicatorInputSpec[];
}

/* The order is the menu's order: the book first, then the tape, then the
   panes. A pane takes height OFF the tape, which is why the sub-panes carry
   the cap (MAX_SUB_PANES), refused in place with the reason. */
export const INDICATOR_ITEMS: IndicatorItem[] = [
  { key: 'flowVwap', group: 'book', label: 'Flow VWAP', hint: 'Where the options paid. Session price weighted by premium, not by shares. SPX uses the SPXW prints. Other names use the feed’s ask, bid and mid dollars. Blank until those land — a share VWAP is not stood in. Unit: price. Warmup: the session. Source: gross premium. Alert: no. Replay: no.' },
  { key: 'sideVwap', group: 'book', label: 'Side VWAP', hint: 'Two lines. Where calls paid, and where puts paid. A side that has not printed stays blank. Unit: price. Warmup: the session. Source: call and put premium. Alert: no. Replay: no.' },
  { key: 'gammaEma', group: 'book', label: 'Gamma EMA', hint: 'A 21-bar average that speeds up when the feed’s minute gamma is heavy and slows when it is quiet. Blank until eight minutes of that path have moved — a flat path is not drawn, and a plain EMA is not stood in. Unit: price. Warmup: 8 moving minutes. Source: minute net gamma. Alert: no. Replay: no.' },
  { key: 'gammaVwap', group: 'book', label: 'Gamma VWAP', hint: 'Session price weighted by the size of the minute gamma, not by shares. It sits where the heavy minutes printed. Blank until that path moves. Unit: price. Warmup: the session. Source: minute net gamma. Alert: no. Replay: no.' },
  { key: 'ema9', label: 'EMA 9', hint: '9-bar exponential moving average of the close. Seeded with the average of the first 9 closes, then blank until those exist. Unit: price. Warmup: 9 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'ema21', label: 'EMA 21', hint: '21-bar exponential moving average of the close. Unit: price. Warmup: 21 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'ema50', label: 'EMA 50', hint: '50-bar exponential moving average of the close. Unit: price. Warmup: 50 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.' },
  { key: 'sma', label: 'SMA 200', hint: 'Mean of the last 200 closes. Blank until the window exists. Unit: price. Warmup: 200 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.' },
  { key: 'vwap', label: 'VWAP', hint: 'Volume-weighted average price, restarted each New York trading day. The evening from 20:00 belongs to the next session. Off on range bars. Unit: price. Warmup: the session. Source: price and share volume. Alert: yes. Replay: the tape only.' },
  { key: 'vwapBands', label: 'VWAP bands', hint: '±1σ and ±2σ around the session VWAP, volume-weighted. Unit: price. Warmup: the session. Source: price and share volume. Alert: no. Replay: the tape only.' },
  { key: 'bb', label: 'Bollinger', hint: '20-bar average ± 2 standard deviations. Unit: price. Warmup: 20 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.' },
  { key: 'rsi', label: 'RSI 14', hint: 'Wilder momentum, 30 and 70 rails, in its own pane. Unit: 0–100. Warmup: 14 bars. Source: this pane’s closes. Alert: yes. Replay: the tape only.', sub: true },
  { key: 'macd', label: 'MACD', hint: '12/26 EMAs, a 9-bar signal, and the histogram, in its own pane. Unit: price. Warmup: 26 bars. Source: this pane’s closes. Alert: no. Replay: the tape only.', sub: true },
  { key: 'atrPane', label: 'ATR 14', hint: 'Wilder average true range of the bars on this pane. Unit: price. Warmup: 14 bars. Source: this pane’s bars. Alert: no. Replay: the tape only.', sub: true },
  { key: 'sessions', label: 'Sessions', hint: 'Tokyo, London and New York, each a box over its own hours from the highest high to the lowest low the bars there printed, named at its top left. Tokyo 09:00–15:30 Tokyo time, London 08:00–16:30 London time (summer time from the last Sunday of March to the last Sunday of October), New York the regular session with the US holidays and early closes. The hours are the session module’s. Unit: price. Warmup: none. Source: this pane’s bars. Alert: no. Replay: no.', inputs: [
    { id: 'asia', title: 'Tokyo', default: 1, min: 0, max: 1, step: 1, kind: 'toggle', tooltip: 'Tokyo Stock Exchange, 09:00–15:30 Tokyo time (no summer time)' },
    { id: 'london', title: 'London', default: 1, min: 0, max: 1, step: 1, kind: 'toggle', tooltip: 'London Stock Exchange, 08:00–16:30 London time' },
    { id: 'newYork', title: 'New York', default: 1, min: 0, max: 1, step: 1, kind: 'toggle', tooltip: 'The regular session, 09:30–16:00 New York time (13:00 on an early close)' },
  ] },
  { key: 'harBand', group: 'physics', physics: 'harBand', label: 'Volatility Half-Life', hint: 'The HAR model’s forecast of today’s realised vol, as a band around price: the rest of the day’s 1σ move (dashed, narrowing to the bell) and the next hour’s (dotted). The legend carries the current shock half-life. A forecast, not a price. Unit: price. Warmup: a year of minute bars, fitted on the server. Source: the vol outlook fit behind Pulse’s Vol outlook tile, and today’s minutes. Alert: no. Replay: no.', inputs: [{ id: 'k', title: 'Band width (σ)', default: 1, min: 0.5, max: 3, step: 0.5, tooltip: 'How many forecast standard deviations the band spans' }] },
  { key: 'gammaRegime', group: 'physics', physics: 'gammaRegime', label: 'Potential Energy', hint: 'Shading behind the candles from the book’s minute net gamma: long gamma, where moves tend to be damped, and short gamma, where moves tend to extend. The legend gives the distance to the flip. A vol regime, not a magnet. Unit: sign. Warmup: the book’s first minute. Source: the live book’s minute net gamma and flip. Alert: no. Replay: no.' },
  { key: 'volShock', group: 'physics', physics: 'volShock', label: 'Gravitational Wave', hint: 'A strip along the floor when SPY’s last 15 minutes move faster than its last 390 — the market’s vol shock that tends to reach single names within the hour. Off on SPY, QQQ and the indexes themselves. Unit: ratio. Warmup: 130 SPY minutes. Source: SPY’s one-minute bars. Alert: no. Replay: no.', inputs: [{ id: 'flag', title: 'Flag at ratio', default: 2, min: 1.2, max: 5, step: 0.1, tooltip: 'The 15-minute vs 390-minute vol ratio that lights the strip' }] },
  { key: 'effRatio', group: 'physics', physics: 'effRatio', label: 'Reynolds Regime', hint: 'Kaufman efficiency ratio: net move over the path travelled, 0 (all noise) to 1 (a straight line), in its own pane. Regular-session bars only. Unit: 0–1. Warmup: the length. Source: this pane’s bars. Alert: no. Replay: the tape only.', sub: true, inputs: [{ id: 'n', title: 'Length (bars)', default: 60, min: 5, max: 390, step: 1, tooltip: 'Returns in the window; the study used 60 one-minute returns' }] },
  { key: 'amihud', group: 'physics', physics: 'amihud', label: 'Viscosity', hint: 'Amihud illiquidity: the average size of a bar’s move per dollar traded, in bps per $1M, in its own pane. Display only — it says how thick the tape is, not where it goes. Unit: bps per $1M. Warmup: the length. Source: this pane’s bars and share volume. Alert: no. Replay: the tape only.', sub: true, inputs: [{ id: 'n', title: 'Length (bars)', default: 60, min: 10, max: 390, step: 1, tooltip: 'Bars in the window; at least a third of them must trade' }] },
  /* the volume profiles and auto levels (tvSpecialItems.ts) */
  ...TV_SPECIAL_ITEMS,
];

/** The menu line. The rest of the hint (unit, warmup, source) is the hover, not the row. */
export function indicatorBlurb(hint: string): string {
  const cut = hint.split(/\.\s/)[0]?.trim() || hint.trim();
  if (cut.length > 110) return `${cut.slice(0, 107)}…`;
  return cut.endsWith('.') ? cut : `${cut}.`;
}

/** A physics row's two names and its tag */
export const physicsOf = (key: keyof ChartIndicators) => {
  const item = INDICATOR_ITEMS.find(i => i.key === key);
  return item?.physics ? PHYSICS_READS[item.physics] : null;
};
