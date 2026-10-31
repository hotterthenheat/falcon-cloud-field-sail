export type Phase = 'overnight' | 'pre' | 'regular' | 'post' | 'closed';
export type Product = 'equity' | 'equityOption' | 'etfOption' | 'indexOption';
export type WindowKind = 'overnight' | 'pre' | 'regular' | 'post' | 'gth' | 'curb';
export interface SessionWindow {
  kind: WindowKind;
  from: number;
  to: number;
}
export interface MarketSessionAt {
  at: number;
  product: Product;
  /** The global phase: the stock tape's (overnight / pre / regular / post / closed) */
  phase: Phase;
  /** The product trades now */
  open: boolean;
  /** The product's window holding this instant */
  window: SessionWindow | null;
  /** The product's next window opening */
  next: { kind: WindowKind; at: number; to: number } | null;
  /** The stock tape's next window opening (the global phase's next turn up) */
  nextPhase: { kind: WindowKind; at: number; to: number } | null;
  /** New York's calendar date and minute of the day */
  date: string;
  minute: number;
  /** The session day this instant is in, or leads into (overnight belongs to the morning it opens; closed: the next) */
  tradingDay: string;
  /** The last session day whose regular session has opened by now */
  lastRegular: string;
  isHoliday: boolean;
  isEarlyClose: boolean;
  regularOpenAt: number;
  regularCloseAt: number;
}
export const PHASES: readonly Phase[];
export const PRODUCTS: readonly Product[];
export const LATE_ETFS: ReadonlySet<string>;
export const GTH_ROOTS: ReadonlySet<string>;
export const INDEX_SYMBOLS: ReadonlySet<string>;
export function nyWall(ms: number): { iso: string; weekday: number; min: number };
export function addDays(iso: string, n: number): string;
export function nyInstant(iso: string, min: number): number;
export function isSessionDay(iso: string): boolean;
export function isHolidayDay(iso: string): boolean;
export function isEarlyCloseDay(iso: string): boolean;
export function regularCloseMin(iso: string): number;
export function postCloseMin(iso: string): number;
export function gthHoliday(iso: string): boolean;
export function nextSessionDay(iso: string): string;
export function sessionDayAtOrBefore(iso: string): string;
export function productOf(symbol: string, option?: boolean): Product;
export function windowAt(ms: number, product?: Product): SessionWindow | null;
export function nextWindow(ms: number, product?: Product): SessionWindow | null;
export function phaseAt(ms: number): Phase;
export function sessionAt(ms: number, product?: Product): MarketSessionAt;
export function nextChangeAt(ms: number): number;
export function inRegular(ms: number): boolean;
export function feedMoving(ms: number, path?: string): boolean;
