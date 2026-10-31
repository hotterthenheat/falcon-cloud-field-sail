import type { IncomingMessage, ServerResponse } from 'node:http';

export function volOutlookMount(
  load: () => Promise<unknown>,
  root?: string,
): { start: () => Promise<void>; handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>; stop: () => void };
