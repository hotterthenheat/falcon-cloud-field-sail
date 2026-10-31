import type { IncomingMessage, ServerResponse } from 'node:http';

export function compassMount(
  load: () => Promise<unknown>,
  root?: string,
): { start: () => Promise<void>; handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>; stop: () => void };

/** Logs unhandled rejections and observes uncaught exceptions, once per process. */
export function installProcessLogger(log?: (line: string) => void): void;

/** Backoff before engine start attempt n (ms). */
export function startDelay(attempt: number): number;
