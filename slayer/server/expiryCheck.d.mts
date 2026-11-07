export const EXPIRATION_LIST: RegExp;
export const SNAPSHOT_MS: number;
export const REPORT_MS: number;
export const RETRY_MS: number;
export function lastFinishedSession(ms: number): string;
export interface ExpiryCheck {
  answer(reqPath: string, lane?: string): Promise<{ status: number; body: Buffer | string; type: string }>;
  stats(): Record<string, number>;
}
export function createExpiryCheck(o: {
  load: (path: string, lane?: string) => Promise<{ status: number; body: Buffer | string; type: string }>;
  now?: () => number;
  log?: (line: string) => void;
  fallbackOf?: (root: string) => { drop?: string[]; add?: string[] } | undefined;
}): ExpiryCheck;
