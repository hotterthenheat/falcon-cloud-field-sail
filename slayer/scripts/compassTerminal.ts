/* A Compass host for offline scripts (compass-twins-backfill, compass-cost-insample): the engine's own reads, straight
   to the terminal on this machine (THETA_REST_BASE, default 127.0.0.1:25503), one request in flight and at least
   100 ms apart. Read-only: it reads recorded quotes, never live state. */
import { setCompassHost } from '../src/data/compassHost';
import { thetaAnswer } from '../src/data/compassServer';

const BASE = process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;
export let terminalReads = 0;

async function ask(path: string) {
  const wait = Math.max(0, lastAt + 100 - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastAt = Date.now();
  terminalReads += 1;
  try {
    const res = await fetch(`${BASE}/v3${path}`, { signal: AbortSignal.timeout(60_000) });
    const body = await res.text();
    return thetaAnswer(res.status, body, res.headers.get('content-type') || '');
  } catch {
    return { status: 503, data: null, error: 'terminal_down' };
  }
}

export function useTerminalHost(): void {
  setCompassHost({
    server: true,
    theta: path => {
      const next = chain.then(() => ask(path));
      chain = next.catch(() => undefined);
      return next;
    },
    asset: async () => null,
    econ: () => [],
  });
}
