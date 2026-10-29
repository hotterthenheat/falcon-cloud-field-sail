export function findJar(): string | null;
export function superviseTheta(opts?: { log?: (message: string) => void; warm?: boolean }): (() => void) | null;
export const WARM: string[];
export function warmPath(symbol: string): string;
