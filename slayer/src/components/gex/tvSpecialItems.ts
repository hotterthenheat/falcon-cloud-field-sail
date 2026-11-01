/* The chart's built-in volume profiles and auto levels (the standard desks' special built-ins that are not a line or an
   oscillator), as library rows with their Inputs tab: data/volumeAtPrice.ts and data/tvLevels.ts do the maths,
   tvProfilesPrimitive.ts and tvLevelsPrimitive.ts draw, useTvSpecialLayer.ts wires them to a chart. The defaults are
   the standard built-ins' defaults. */

import type { IndicatorInputSpec } from '../../data/indicatorLooks';
import { PITCHFORK_KINDS, PIVOT_KINDS, PIVOT_TFS } from '../../data/tvLevels';
import { PATTERN_TYPES, TREND_RULES } from '../../data/candlePatterns';
import { CANDLE_PATTERNS } from '../../data/builtinScriptsCandles';

export const TV_PROFILE_KEYS = ['vrvp', 'svp', 'pvp', 'aavp'] as const;
export const TV_LEVEL_KEYS = ['pivotsStd', 'pivotsHL', 'zigzag', 'autoFib', 'autoFibExt', 'autoPitchfork'] as const;
export type TvProfileKey = (typeof TV_PROFILE_KEYS)[number];
export type TvLevelKey = (typeof TV_LEVEL_KEYS)[number];
export type TvSpecialKey = TvProfileKey | TvLevelKey | 'candlesAll';
export const TV_SPECIAL_KEYS: readonly TvSpecialKey[] = ['candlesAll', ...TV_PROFILE_KEYS, ...TV_LEVEL_KEYS];

/** One value for every special key — for the chart's per-indicator records */
export function tvSpecialRecord<T>(v: T): Record<TvSpecialKey, T> {
  return Object.fromEntries(TV_SPECIAL_KEYS.map(k => [k, v])) as Record<TvSpecialKey, T>;
}

export const TV_SPECIAL_INKS: Record<TvSpecialKey, string> = {
  candlesAll: '#C7D3E8',
  vrvp: '#8FB8D8',
  svp: '#A7C4D9',
  pvp: '#B9C7E8',
  aavp: '#C9B3E6',
  pivotsStd: '#E3B58C',
  pivotsHL: '#C7D3E8',
  zigzag: '#F0A07A',
  autoFib: '#D8BC8F',
  autoFibExt: '#BBB2E8',
  autoPitchfork: '#9FD3B5',
};

const toggle = (id: string, title: string, on: boolean, tooltip?: string): IndicatorInputSpec => ({ id, title, default: on ? 1 : 0, min: 0, max: 1, step: 1, kind: 'toggle', quiet: true, tooltip });
const choice = (id: string, title: string, options: readonly string[], dflt = 0, tooltip?: string, quiet = false): IndicatorInputSpec => ({ id, title, default: dflt, min: 0, max: options.length - 1, step: 1, kind: 'choice', options, tooltip, quiet });
const num = (id: string, title: string, dflt: number, min: number, max: number, step: number, tooltip?: string, quiet = false): IndicatorInputSpec => ({ id, title, default: dflt, min, max, step, tooltip, quiet });

export const ROW_LAYOUTS = ['Number of rows', 'Ticks per row'] as const;
export const PROFILE_VALUES = ['Up/Down', 'Total', 'Delta'] as const;

const profileInputs = (width: number): IndicatorInputSpec[] => [
  choice('layout', 'Rows layout', ROW_LAYOUTS, 0, 'Cut the range into a number of rows, or a fixed number of ticks a row', true),
  num('rowSize', 'Row size', 24, 1, 1000, 1, 'Rows across the range, or ticks a row'),
  choice('values', 'Volume', PROFILE_VALUES, 0, 'Up and down volume side by side, their total, or up minus down'),
  num('va', 'Value area (%)', 70, 5, 100, 1, 'The share of the volume the value area holds'),
  num('width', 'Width (%)', width, 5, 95, 1, 'How wide the widest row draws', true),
  toggle('poc', 'Point of control', true),
  toggle('vaShow', 'Value area', true, 'The value area rows stronger, VAH and VAL as rules'),
  toggle('extendPoc', 'Extend the POC right', false),
];

const ZZ = [num('dev', 'Deviation (multiplier)', 3, 0.1, 50, 0.1, 'The 10-bar ATR as a percent of the close, times this, is the move a reversal needs'), num('depth', 'Depth (bars)', 10, 2, 100, 1, 'Bars that confirm a swing, half on each side')];

const FIB_LEVEL_TOGGLES: IndicatorInputSpec[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236].map(l => toggle(`l${String(l).replace('.', '_')}`, `Level ${l}`, true));

export interface TvSpecialItem {
  key: TvSpecialKey;
  label: string;
  hint: string;
  group: 'profile' | 'levels' | 'candles';
  inputs: IndicatorInputSpec[];
}

export const TV_SPECIAL_ITEMS: TvSpecialItem[] = [
  { key: 'candlesAll', group: 'candles', label: 'All candlestick patterns', hint: `Every pattern on the candlestick shelf at once — ${CANDLE_PATTERNS.length} of them, each its own switch — marked under the bar when bullish, over it when bearish or neutral. The same definitions as the single-pattern scripts, with the trend rule (the close against the 50-bar SMA by default) and the bullish / bearish filter. Unit: marks. Warmup: 14 bars for the body average, 50 for the trend. Source: this chart’s bars. Alert: no — the single-pattern scripts carry alerts. Replay: no.`, inputs: [choice('trend', 'Detect trend based on', TREND_RULES, 0, 'The trend a pattern must follow: close against the 50-bar SMA, or that and the 50 against the 200, or none'), choice('type', 'Pattern type', PATTERN_TYPES, 0), ...CANDLE_PATTERNS.map(p => toggle(`p_${p.key}`, p.title, true))] },
  { key: 'vrvp', group: 'profile', label: 'Visible range volume profile', hint: 'Volume at each price across the bars in view, docked to the edge of the pane and rebuilt as the view moves: up and down volume, the point of control and the 70% value area. Built from the one-minute bars where they are loaded, else this chart’s bars — a bar’s volume spread over its range, not its trades. Unit: shares. Warmup: none. Source: this name’s one-minute bars. Alert: no. Replay: no.', inputs: [...profileInputs(30), choice('placement', 'Placement', ['Right', 'Left'], 0)] },
  { key: 'svp', group: 'profile', label: 'Session volume profile', hint: 'One volume profile a trading day, laid over that day’s bars: up and down volume, the point of control and the value area. The day is the session module’s (the overnight joins the morning it opens into); Regular keeps the cash session’s bars only. Built from the one-minute bars where they are loaded, else this chart’s bars. Unit: shares. Warmup: none. Source: this name’s one-minute bars. Alert: no. Replay: no.', inputs: [choice('session', 'Session', ['All', 'Regular'], 0, 'Every bar of the trading day, or the regular session alone'), ...profileInputs(70), num('back', 'Sessions drawn', 20, 1, 200, 1, 'The newest sessions to draw', true)] },
  { key: 'pvp', group: 'profile', label: 'Periodic volume profile', hint: 'One volume profile a period — a day, a week or a month of trading days — laid over its bars, with the point of control and the value area. Built from the one-minute bars where they are loaded, else this chart’s bars. Unit: shares. Warmup: none. Source: this name’s one-minute bars. Alert: no. Replay: no.', inputs: [choice('period', 'Period', ['Day', 'Week', 'Month'], 0), ...profileInputs(70), num('back', 'Periods drawn', 20, 1, 200, 1, 'The newest periods to draw', true)] },
  { key: 'aavp', group: 'profile', label: 'Auto anchored volume profile', hint: 'A volume profile from an anchor to the last bar: the session’s start on an intraday chart (Auto), or the highest high, the lowest low or the heaviest bar of the last N bars. Point of control and value area as the others. Unit: shares. Warmup: the length. Source: this name’s one-minute bars. Alert: no. Replay: no.', inputs: [choice('anchor', 'Anchor', ['Auto', 'Highest high', 'Lowest low', 'Highest volume'], 0, 'Auto: the session on an intraday chart, the month on a day chart'), num('length', 'Length (bars)', 20, 2, 5000, 1, 'Bars searched for the high, the low or the heaviest bar'), ...profileInputs(30)] },
  { key: 'pivotsStd', group: 'levels', label: 'Pivot points standard', hint: 'Pivot levels for each period from the period before it: Traditional, Fibonacci, Woodie, Classic, DM or Camarilla, on the day, week, month, quarter or year (Auto: the day up to 15-minute bars, the week up to the day, the month above). Named and priced at the left of each rung. Unit: price. Warmup: one period. Source: this chart’s bars, the regular session’s by default. Alert: no. Replay: no.', inputs: [choice('type', 'Type', PIVOT_KINDS, 0), choice('tf', 'Pivots timeframe', PIVOT_TFS, 0), num('back', 'Pivots back', 15, 1, 200, 1, 'Periods drawn'), toggle('regular', 'Regular hours only', true, 'Build the previous period from the cash session’s bars, the way day bars are built'), toggle('labels', 'Labels', true), toggle('prices', 'Prices', true)] },
  { key: 'pivotsHL', group: 'levels', label: 'Pivot points high low', hint: 'The price of every swing high and swing low: a high above the bars to its left and at least as high as those to its right, and the low the same way round. Unit: price. Warmup: the left bars. Source: this chart’s bars. Alert: no. Replay: no.', inputs: [num('leftH', 'High · left bars', 10, 1, 100, 1), num('rightH', 'High · right bars', 10, 1, 100, 1), num('leftL', 'Low · left bars', 10, 1, 100, 1), num('rightL', 'Low · right bars', 10, 1, 100, 1)] },
  { key: 'zigzag', group: 'levels', label: 'Zig zag', hint: 'Swings joined into legs: a reversal counts once it moves the deviation from the last point, a further swing the same way moves the point. The last leg runs dashed to the furthest bar since and can still change. Each point wears its price, its change and the volume of its leg. Unit: price. Warmup: the depth. Source: this chart’s bars. Alert: no. Replay: no.', inputs: [num('dev', 'Deviation (%)', 5, 0.1, 100, 0.1, 'The move from the last point a reversal needs'), num('legs', 'Pivot legs', 10, 2, 100, 1, 'Bars that confirm a swing, half on each side'), toggle('extend', 'Extend to the last bar', true), toggle('price', 'Reversal price', true), toggle('change', 'Price change', true), toggle('volume', 'Cumulative volume', true)] },
  { key: 'autoFib', group: 'levels', label: 'Auto fib retracement', hint: 'Fibonacci retracement over the zig zag’s last leg, found on its own: 0 at the leg’s end, 1 at its start, and the levels past it. The reversal threshold is the 10-bar ATR as a percent of the close, times the deviation. Unit: price. Warmup: the depth. Source: this chart’s bars. Alert: no. Replay: no.', inputs: [...ZZ, toggle('reverse', 'Reverse', false), toggle('extendLeft', 'Extend left', false), toggle('extendRight', 'Extend right', true), toggle('prices', 'Prices', true), ...FIB_LEVEL_TOGGLES] },
  { key: 'autoFibExt', group: 'levels', label: 'Auto fib extension', hint: 'Fibonacci extension over the zig zag’s last three points: from the third, the first leg’s move times each level. Same threshold as the retracement. Unit: price. Warmup: the depth. Source: this chart’s bars. Alert: no. Replay: no.', inputs: [...ZZ, toggle('reverse', 'Reverse', false), toggle('extendRight', 'Extend right', true), toggle('prices', 'Prices', true), ...FIB_LEVEL_TOGGLES] },
  { key: 'autoPitchfork', group: 'levels', label: 'Auto pitchfork', hint: 'An Andrews pitchfork on the zig zag’s last three points: the median from the first point through the middle of the other two, and its parallels. Schiff starts the median halfway up to the second point; Modified Schiff at the middle of the first two. Unit: price. Warmup: the depth. Source: this chart’s bars. Alert: no. Replay: no.', inputs: [...ZZ, choice('kind', 'Type', PITCHFORK_KINDS, 0), toggle('f0_25', 'Level 0.25', false), toggle('f0_382', 'Level 0.382', false), toggle('f0_5', 'Level 0.5', true), toggle('f0_618', 'Level 0.618', false), toggle('f0_75', 'Level 0.75', false), toggle('f1', 'Level 1', true)] },
];
