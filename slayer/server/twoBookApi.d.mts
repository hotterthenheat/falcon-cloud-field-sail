import type { IncomingMessage, ServerResponse } from 'node:http';

export function twoBookMount(load: () => Promise<unknown>): { start: () => Promise<void>; handle: (req: IncomingMessage, res: ServerResponse) => Promise<void> };
