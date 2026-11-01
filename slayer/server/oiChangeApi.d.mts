import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OiChangeTuple } from '../shared/oiChange.mjs';

export const OI_CHANGE_VERSION: number;
export const HISTORY_AT_ONCE: number;
export const RETRY_MS: number;
export const OI_MISSING_MS: number;
export const ANSWER_WAIT_MS: number;
export interface OiChangeAnswer {
  v: number;
  at: number;
  ticker: string;
  roots: string[];
  /** The later report's date (stamped ~06:30 New York for the session before it) */
  day: string;
  /** The earlier report's date */
  prior: string;
  /** The sessions whose closes the two reports count */
  close: string;
  priorClose: string;
  source?: 'terminal';
  /** Contracts listed in the later report */
  contracts?: number;
  rows?: OiChangeTuple[];
  pending?: boolean;
  error?: string;
}
export function createOiChange(o: {
  theta: (path: string, opt?: { lane?: 'record' }) => Promise<{ status: number; body: string }>;
  dir?: string | null;
  now?: () => number;
  log?: (line: string) => void;
}): {
  change: (ticker: string, opt?: { waitMs?: number }) => Promise<OiChangeAnswer>;
  stats: () => Record<string, number>;
  settle: () => Promise<void>;
};
export function proxyOiChange(req: IncomingMessage, res: ServerResponse, root?: string): Promise<void>;
export function oiChangeStats(): Record<string, number> | null;
