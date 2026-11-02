import type { IncomingMessage, ServerResponse } from 'node:http';

export const CARD_TABLES: readonly ['earnings', 'news', 'insiders', 'congress'];
export type CardTable = (typeof CARD_TABLES)[number];
export const MEMO_MS: number;
export const READ_MAX_AGE_MS: number;
export interface NameCardTable {
  /** The vendor's status through the hub; 0 when the hub could not be reached */
  status: number;
  rows: unknown[] | null;
  /** When the hub took the rows from the vendor */
  at: number | null;
}
export interface NameCard {
  ticker: string;
  at: number;
  tables: Record<CardTable, NameCardTable>;
}
export function cardPath(table: CardTable, t: string): string;
export function rowsOfBody(body: string): unknown[] | null;
export function createNameCard(o: {
  read: (path: string, opt?: { lane?: 'viewer' | 'record'; maxAge?: number }) => Promise<{ status: number; body: string; at: number }>;
  now?: () => number;
  memoMs?: number;
}): { ask: (sym: string) => Promise<NameCard | null>; stats: () => Record<string, number> };
export function proxyNameCard(req: IncomingMessage, res: ServerResponse, k?: { ask: (sym: string) => Promise<NameCard | null> }): Promise<void>;
export function nameCardStats(): Record<string, number> | null;
