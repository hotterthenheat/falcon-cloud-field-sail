/* A drawing's own levels and its own inputs (TradingView's per-tool settings: fib ratios on and off, custom ones, Gann
   angles, the regression's σ, the pitchfork's style, the position's account and risk, the anchored VWAP's source and
   bands …), and the visibility ranges by interval. Pure: the renderers, the hit tests, the settings dialog and the proof
   read the same tables. A mark that never touched its settings carries none of this and draws with the defaults. */

import type { Drawing, DrawingKind } from './drawingsPrimitive';

export interface Level {
  v: number;
  on: boolean;
}

const L = (on: number[], off: number[] = []): Level[] => [...on.map(v => ({ v, on: true })), ...off.map(v => ({ v, on: false }))].sort((a, b) => a.v - b.v);

const FORK = L([0.5, 1], [0.25, 0.382, 0.618, 0.75, 1.5, 1.75, 2]);

/** Each levelled tool's default set — the ones TradingView ships on, then the ones it ships off */
export const DEFAULT_LEVELS: Partial<Record<DrawingKind, Level[]>> = {
  fib: L([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1], [1.272, 1.618, 2.618, 3.618, 4.236]),
  fibext: L([0, 0.618, 1, 1.272, 1.618, 2.618], [0.236, 0.382, 0.5, 0.786, 2, 3.618, 4.236]),
  fibchannel: L([0, 0.382, 0.618, 1, 1.618], [0.236, 0.5, 0.786, 2.618]),
  fibtime: L([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]),
  tbfibtime: L([0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.618, 4.236], [0.236, 0.786, 3, 3.618]),
  fibfan: L([0.25, 0.382, 0.5, 0.618, 0.75]),
  fibarcs: L([0.236, 0.382, 0.5, 0.618, 0.786, 1], [1.618, 2.618]),
  fibcircles: L([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618], [3.618, 4.236]),
  fibwedge: L([0.236, 0.382, 0.5, 0.618, 0.786, 1]),
  pitchfan: L([0.382, 0.5, 0.618, 1], [0.236, 0.786]),
  gannbox: L([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]),
  gannsq: L([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]),
  gannfan: L([8, 4, 3, 2, 1, 0.5, 1 / 3, 0.25, 0.125]),
  pitchfork: FORK,
  schiff: FORK,
  mschiff: FORK,
  insidefork: FORK,
};

/** Kinds whose levels the dialog edits, and what a level is called there */
export const LEVEL_WORD: Partial<Record<DrawingKind, string>> = {
  fibtime: 'Zone',
  gannfan: 'Angle (price/time)',
  pitchfork: 'Line (× half the B–C spread)',
  schiff: 'Line (× half the B–C spread)',
  mschiff: 'Line (× half the B–C spread)',
  insidefork: 'Line (× point 3’s offset)',
};

export const hasLevels = (kind: DrawingKind): boolean => !!DEFAULT_LEVELS[kind];

/** The levels a mark draws: its own set if it has one, else its tool's; only those switched on, in order */
export function levelsOf(d: Pick<Drawing, 'kind' | 'levels'>): number[] {
  const set = d.levels ?? DEFAULT_LEVELS[d.kind] ?? [];
  return set.filter(l => l.on && Number.isFinite(l.v)).map(l => l.v);
}
/** The whole set, on and off — what the dialog lists */
export const levelSet = (d: Pick<Drawing, 'kind' | 'levels'>): Level[] => d.levels ?? DEFAULT_LEVELS[d.kind] ?? [];

/** A Gann fan angle's name off its price/time ratio: 2 → 2/1, 0.25 → 1/4 */
export function gannName(r: number): string {
  if (r >= 1) return `${+r.toFixed(3)}/1`;
  return `1/${+(1 / r).toFixed(3)}`;
}

// ---- the tools' own inputs -----------------------------------------------------------------------------

export type OptVal = number | string | boolean;

/** One input in a tool's Inputs tab */
export interface OptDef {
  key: string;
  label: string;
  type: 'num' | 'bool' | 'pick';
  def: OptVal;
  min?: number;
  max?: number;
  step?: number;
  choices?: { v: string; label: string }[];
  hint?: string;
}

const LINE_OPTS: OptDef[] = [
  { key: 'extL', label: 'Extend left', type: 'bool', def: false },
  { key: 'extR', label: 'Extend right', type: 'bool', def: false },
  { key: 'stats', label: 'Show price range, change, bars and angle', type: 'bool', def: false },
  { key: 'plabels', label: 'Price labels at the ends', type: 'bool', def: false },
  { key: 'mid', label: 'Middle point', type: 'bool', def: false },
];
const POSITION_OPTS: OptDef[] = [
  { key: 'account', label: 'Account size', type: 'num', def: 10000, min: 0, step: 100 },
  { key: 'risk', label: 'Risk, % of the account', type: 'num', def: 1, min: 0, max: 100, step: 0.25 },
  { key: 'lot', label: 'Lot size (shares a lot)', type: 'num', def: 1, min: 0.0001, step: 1 },
  { key: 'pnl', label: 'Open P&L at the last close', type: 'bool', def: true },
];
const RANGE_OPTS: OptDef[] = [{ key: 'vol', label: 'Volume in the range', type: 'bool', def: true }];

export const KIND_OPTS: Partial<Record<DrawingKind, OptDef[]>> = {
  trend: LINE_OPTS,
  arrow: LINE_OPTS.filter(o => o.key !== 'extR'),
  ray: LINE_OPTS.filter(o => o.key !== 'extR'),
  infoline: LINE_OPTS.filter(o => o.key !== 'stats'),
  trendangle: LINE_OPTS.filter(o => o.key !== 'stats'),
  long: POSITION_OPTS,
  short: POSITION_OPTS,
  avwap: [
    {
      key: 'src',
      label: 'Source',
      type: 'pick',
      def: 'hlc3',
      choices: [
        { v: 'hlc3', label: 'HLC/3' },
        { v: 'hl2', label: 'HL/2' },
        { v: 'ohlc4', label: 'OHLC/4' },
        { v: 'close', label: 'Close' },
      ],
    },
    { key: 'b1', label: 'Band ×1 σ', type: 'bool', def: false },
    { key: 'b2', label: 'Band ×2 σ', type: 'bool', def: false },
    { key: 'b3', label: 'Band ×3 σ', type: 'bool', def: false },
  ],
  regression: [
    { key: 'sd', label: 'Deviation, × σ', type: 'num', def: 2, min: 0, max: 10, step: 0.1 },
    { key: 'upper', label: 'Upper deviation', type: 'bool', def: true },
    { key: 'lower', label: 'Lower deviation', type: 'bool', def: true },
    { key: 'pearson', label: 'Pearson’s R', type: 'bool', def: false },
  ],
  measure: RANGE_OPTS,
  drange: RANGE_OPTS,
  prange: RANGE_OPTS,
  fibarcs: [{ key: 'full', label: 'Full circles', type: 'bool', def: false }],
  fib: [
    { key: 'reverse', label: 'Reverse', type: 'bool', def: false },
    { key: 'extL', label: 'Extend lines left', type: 'bool', def: false },
    { key: 'extR', label: 'Extend lines right', type: 'bool', def: false },
  ],
  gannsq: [{ key: 'reverse', label: 'Reverse', type: 'bool', def: false }],
  barspattern: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'pick',
      def: 'hl',
      choices: [
        { v: 'hl', label: 'HL bars' },
        { v: 'oc', label: 'OC bars' },
        { v: 'close', label: 'Line — close' },
        { v: 'open', label: 'Line — open' },
        { v: 'high', label: 'Line — high' },
        { v: 'low', label: 'Line — low' },
        { v: 'hl2', label: 'Line — HL/2' },
      ],
    },
    { key: 'mirrored', label: 'Mirrored', type: 'bool', def: false },
    { key: 'flipped', label: 'Flipped', type: 'bool', def: false },
  ],
  ghostfeed: [{ key: 'avgHL', label: 'Average high–low (0: the chart’s own last 50 bars)', type: 'num', def: 0, min: 0, step: 0.05 }],
  frvp: [
    { key: 'rows', label: 'Rows', type: 'num', def: 24, min: 4, max: 200, step: 1 },
    { key: 'va', label: 'Value area, % of volume', type: 'num', def: 70, min: 1, max: 100, step: 1 },
    { key: 'updown', label: 'Up and down volume', type: 'bool', def: true },
    { key: 'lines', label: 'POC, VAH and VAL lines', type: 'bool', def: true },
  ],
  brush: [{ key: 'fill', label: 'Fill the shape', type: 'bool', def: false }],
  path: [{ key: 'headStart', label: 'Arrow at the start too', type: 'bool', def: false }],
};
KIND_OPTS.avp = KIND_OPTS.frvp;

/** A mark's input, or its tool's default */
export function opt<T extends OptVal>(d: Pick<Drawing, 'kind' | 'opts'>, key: string, fallback?: T): T {
  const v = d.opts?.[key];
  if (v !== undefined) return v as T;
  const def = KIND_OPTS[d.kind]?.find(o => o.key === key)?.def;
  return (def ?? fallback) as T;
}

/** The pitchfork's Style picker (TradingView's): the four kinds are one tool with four origins */
export const FORK_STYLES: { kind: DrawingKind; label: string }[] = [
  { kind: 'pitchfork', label: 'Original' },
  { kind: 'schiff', label: 'Schiff' },
  { kind: 'mschiff', label: 'Modified Schiff' },
  { kind: 'insidefork', label: 'Inside' },
];

// ---- visibility by interval (TradingView's per-interval ranges) --------------------------------------------

export type VisUnit = 'sec' | 'min' | 'hr' | 'day' | 'wk' | 'mo';
export const VIS_UNITS: { u: VisUnit; label: string; max: number }[] = [
  { u: 'sec', label: 'Seconds', max: 59 },
  { u: 'min', label: 'Minutes', max: 59 },
  { u: 'hr', label: 'Hours', max: 24 },
  { u: 'day', label: 'Days', max: 366 },
  { u: 'wk', label: 'Weeks', max: 52 },
  { u: 'mo', label: 'Months', max: 12 },
];
/** Per unit: a [from, to] range, or false for hidden there; a unit left out is shown over its whole range */
export type Vis = Partial<Record<VisUnit, [number, number] | false>>;

/** A timeframe as an interval: '15s' → 15 seconds, '45m' → 45 minutes, '4h', '3D', '1W', '6M', '1Y' → 12 months */
export function tfUnit(tf: string): { u: VisUnit; n: number } | null {
  const m = /^(\d+)(s|m|h|D|W|M|Y)$/.exec(tf);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return { u: 'sec', n };
    case 'm':
      return { u: 'min', n };
    case 'h':
      return { u: 'hr', n };
    case 'D':
      return { u: 'day', n };
    case 'W':
      return { u: 'wk', n };
    case 'M':
      return { u: 'mo', n };
    default:
      return { u: 'mo', n: n * 12 };
  }
}

/** Whether a mark shows on timeframe `tf`: its interval ranges if it has them, else its one kept timeframe, else everywhere */
export function visibleOn(d: Pick<Drawing, 'vis' | 'tf'>, tf: string): boolean {
  if (!tf) return true;
  if (d.vis) {
    const t = tfUnit(tf);
    if (!t) return true;
    const r = d.vis[t.u];
    if (r === false) return false;
    if (!r) return true;
    return t.n >= r[0] && t.n <= r[1];
  }
  return !d.tf || d.tf === tf;
}
