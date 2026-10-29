import type { IncomingMessage, ServerResponse } from 'node:http';

export function proxyTheta(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function thetaHubStats(): Record<string, number>;
