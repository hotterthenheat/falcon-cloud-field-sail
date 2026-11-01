export const CHAIN_COLS: readonly string[];
export const CLOSE_COLS: readonly string[];
/** strike, callBid, callAsk, putBid, putAsk, callDelta, putDelta, callCharm, putCharm, callVanna, putVanna, callOi, putOi, callIv, putIv */
export type ChainRow = (number | null)[];
/** strike, callBid, callAsk, putBid, putAsk */
export type CloseRow = (number | null)[];
export interface ChainExpiry<R = ChainRow> {
  exp: string;
  rows: R[];
}
export function chainRoot(symbol: string): string;
export function okSymbol(symbol: unknown): boolean;
export function parseCsv(text: string): Record<string, string>[];
export function readOpenInterest(text: string): { day: string | null; oi: Map<string, number> };
export function readChain(text: string, oi?: Map<string, number> | null): { spot: number | null; spotAt: string | null; asOf: string | null; expiries: ChainExpiry[] };
export function readCloses(text: string): { day: string | null; spot: number | null; expiries: ChainExpiry<CloseRow>[] };
