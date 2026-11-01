export interface Night {
  from: number;
  to: number;
  live: boolean;
}
/** strike, callBid, callAsk, putBid, putAsk */
export type NightPair = [number, number, number, number, number];
export const PAIRS_KEPT: number;
export function nightAt(ms: number): Night | null;
export function nightExpiry(night: { from: number; to: number }): string;
export function nightParts(night: { from: number; to: number }): { date: string; start: string; end: string }[];
export function wallMs(stamp: string): number;
export function readQuoteStamps(text: string, bucketMs?: number): Map<number, Map<number, (number | null)[]>>;
export function pairsAround(byStrike: Map<number, (number | null)[]>, kept?: number): NightPair[];
