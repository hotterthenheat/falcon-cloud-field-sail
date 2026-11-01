export interface Tenor {
  sym: string;
  days: number;
  label: string;
}
export const TERM: readonly Tenor[];
export const GAUGES: readonly string[];
export const REGIME_SYMBOLS: readonly string[];
export const RATIOS: readonly { key: string; num: string; den: string }[];
export const FLAT_BAND: number;
export type Regime = 'contango' | 'backwardation' | 'flat';

export function wallOf(stamp: unknown): { day: string; min: number } | null;
export function readSnapshot(json: unknown): Record<string, { price: number; at: string }>;
export function readMinuteCloses(json: unknown): [number, number][];
export function readDailyCloses(json: unknown): [string, number][];
export function percentileOf(values: Iterable<number>, v: number): number | null;
export function ratioSeries<K>(a: Iterable<[K, number]>, b: Iterable<[K, number]>): [K, number][];
export function regimeOf(ratio: number): Regime | null;
export function yearEnd(day: string): string;
export function yearStart(end: string): string;
export interface YearRead {
  prev: number | null;
  prevDay: string | null;
  pct: number | null;
  n: number;
  lo: number | null;
  hi: number | null;
}
export function yearRead(closes: [string, number][], value: number): YearRead;
