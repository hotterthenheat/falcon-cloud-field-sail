import type { IncomingMessage, ServerResponse } from 'node:http';

export function proxyUw(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function uwHubStats(): Record<string, number>;
export function uwDirect(path: string, opt?: { lane?: 'viewer' | 'record'; maxAge?: number }): Promise<{ status: number; body: string; at: number }>;
