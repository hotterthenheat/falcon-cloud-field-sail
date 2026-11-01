import type { IncomingMessage, ServerResponse } from 'node:http';

export const TERRAIN_VERSION: number;
export const CHAIN_LIVE_MS: number;
export const CHAIN_IDLE_MS: number;
export const OI_MS: number;
export const HISTORY_AT_ONCE: number;
export const MAX_DTE: number;
export const STRIKE_RANGE: number;
export const NIGHT_LIVE_MS: number;
export const NIGHT_PATH_MS: number;
export const NIGHT_STRIKES: number;
export function nightQuotePath(exp: string, date: string, start: string, end: string): string;
export function nightLivePath(exp: string): string;
export function nightVixPath(date: string, start: string, end: string): string;
export function chainPath(root: string): string;
export function oiPath(root: string): string;
export function closesPath(root: string, day: string): string;
export function createTerrain(o: {
  theta: (path: string, opt?: { lane?: 'record' }) => Promise<{ status: number; body: string }>;
  dir?: string | null;
  now?: () => number;
  log?: (line: string) => void;
}): {
  chain: (symbol: string) => Promise<Record<string, unknown>>;
  prior: (symbol: string) => Promise<Record<string, unknown>>;
  overnight: () => Promise<Record<string, unknown>>;
  stats: () => Record<string, number>;
  settle: () => Promise<void>;
};
export function proxyTerrain(req: IncomingMessage, res: ServerResponse, root?: string): Promise<void>;
export function terrainStats(): Record<string, number> | null;
