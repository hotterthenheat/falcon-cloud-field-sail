import type { IncomingMessage, ServerResponse } from 'node:http';

export function proxyTheta(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function thetaHubStats(): Record<string, number>;
export function expiryCheckStats(): Record<string, number>;
export function thetaDirect(path: string, opt?: { lane?: 'viewer' | 'record' | 'engine'; maxAge?: number }): Promise<{ status: number; body: string; type: string }>;
export function thetaUncached(path: string, opt?: { timeoutMs?: number }): Promise<{ status: number; body: string; type: string }>;
export function thetaSlots(): { terminal: number; history: number; busy: number; busyHistory: number; waiting: number; engine: number; waitingEngine: number };
