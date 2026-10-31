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

export const OI_ROOT: Record<string, string>;
export function oiRootOf(ticker: string): string;
export const OI_READY_MIN: number;
export function oiReportDay(ms: number): string;
export function priorSession(day: string): string;
/** expiry → [strike, call OI, put OI][] */
export type OiReport = Record<string, [number, number, number][]>;
export function readOiReport(json: unknown): OiReport;
export const OI_TOP: number;
export interface OiMove {
  strike: number;
  right: 'C' | 'P';
  d: number;
  now: number;
  prior: number;
}
export interface OiChange {
  expiries: string[];
  /** [strike, call now, call prior, put now, put prior], strikes ascending */
  rows: [number, number, number, number, number][];
  totals: { call: number; callPrior: number; put: number; putPrior: number };
  builds: OiMove[];
  unwinds: OiMove[];
}
export function oiChange(now: OiReport, prior: OiReport, scope: { expiry: 'book' | string; from: string }): OiChange;
