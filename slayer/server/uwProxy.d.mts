import type { IncomingMessage, ServerResponse } from 'node:http';

export function proxyUw(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function uwHubStats(): Record<string, number>;
