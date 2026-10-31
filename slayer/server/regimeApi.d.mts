import type { IncomingMessage, ServerResponse } from 'node:http';

export const REGIME_VERSION: number;
export const SNAP_LIVE_MS: number;
export const SNAP_IDLE_MS: number;
export const PATH_MS: number;
export const PATH_PRE_MS: number;
export const HISTORY_AT_ONCE: number;
export function createRegime(o: {
  theta: (path: string, opt?: { lane?: 'record' }) => Promise<{ status: number; body: string }>;
  dir?: string | null;
  now?: () => number;
  log?: (line: string) => void;
}): {
  vol: () => Promise<Record<string, unknown>>;
  oi: (ticker: string, expiry: string, opt?: { wait?: boolean }) => Promise<Record<string, unknown>>;
  stats: () => Record<string, number>;
  settle: () => Promise<void>;
};
export function proxyRegime(req: IncomingMessage, res: ServerResponse, root?: string): Promise<void>;
export function regimeStats(): Record<string, number> | null;
