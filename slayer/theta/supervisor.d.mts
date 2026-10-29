export function findJar(): string | null;
export function superviseTheta(opts?: { log?: (message: string) => void }): (() => void) | null;
