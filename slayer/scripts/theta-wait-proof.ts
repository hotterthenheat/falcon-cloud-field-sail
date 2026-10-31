/*
  How long the browser waits on the quotes terminal (data/theta.ts, data/thetaFeed.ts), without a browser.

  - every read carries its own time limit, a little past the server's (server/thetaProxy.mjs: 20 s for a snapshot,
    90 s for history): 25 s and 95 s;
  - a read that runs out of time is the terminal being busy (504 terminal_busy), never down: no breaker, and the next
    read goes straight out;
  - the reads that start before the first one has answered wait on it at most FIRST_READ_WAIT_MS (8 s), not as long as
    it takes.
  Run:  npx tsx scripts/theta-wait-proof.ts
*/
import { openFeeds } from '../src/data/feedGate';
import { thetaWaitMs } from '../src/data/theta';
import { FIRST_READ_WAIT_MS, thetaDown, thetaGet } from '../src/data/thetaFeed';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* a fetch that never answers on its own: each call is held until the proof answers it or its signal aborts it */
type Held = { path: string; at: number; signal?: AbortSignal; answer: (body: unknown) => void };
const calls: Held[] = [];
const limits: number[] = [];
const timers: AbortController[] = [];
AbortSignal.timeout = (ms: number) => {
  limits.push(ms);
  const c = new AbortController();
  timers.push(c);
  return c.signal;
};
globalThis.fetch = ((url: string, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const held: Held = {
      path: String(url).replace('/api/theta', ''),
      at: Date.now(),
      signal: init?.signal ?? undefined,
      answer: body => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
    };
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    calls.push(held);
  })) as typeof fetch;

openFeeds();

check(`a snapshot waits ${thetaWaitMs('/stock/snapshot/quote?symbol=SPY')} ms, history ${thetaWaitMs('/stock/history/ohlc?symbol=SPY')} ms (the server gives up at 20 000 and 90 000)`, thetaWaitMs('/stock/snapshot/quote?symbol=SPY') === 25_000 && thetaWaitMs('/stock/history/ohlc?symbol=SPY&interval=1m') === 95_000 && thetaWaitMs('/option/at_time/quote?symbol=SPY') === 95_000);

const t0 = Date.now();
/* the page's first read: history, never answered */
const first = thetaGet('/stock/history/ohlc?symbol=SPY&interval=1m&start_date=20261030&end_date=20261030&format=json');
await new Promise(r => setTimeout(r, 50));
/* a second pane's read, asked while the first is out */
const second = thetaGet('/stock/snapshot/quote?symbol=QQQ&format=json');
while (calls.length < 2 && Date.now() - t0 < 20_000) await new Promise(r => setTimeout(r, 25));
const waited = (calls[1]?.at ?? Infinity) - (calls[0]?.at ?? 0);
check(`the second read went out ${waited} ms after the first, which never answered (cap ${FIRST_READ_WAIT_MS} ms; before: as long as the first took)`, waited >= FIRST_READ_WAIT_MS - 100 && waited <= FIRST_READ_WAIT_MS + 400);
check(`each read carried its own limit: ${limits.join(' and ')} ms`, limits[0] === 95_000 && limits[1] === 25_000 && calls.every(c => !!c.signal));

/* the second read answers; the first runs out of the browser's time */
calls[1].answer({ response: [{ symbol: 'QQQ', bid: 1, ask: 1.01 }] });
const b = await second;
check(`the second read answered: status ${b.status}, error ${b.error}`, b.status === 200 && b.error == null);
timers[0].abort(new DOMException('signal timed out', 'TimeoutError'));
const a = await first;
check(`the first read timed out in the browser: status ${a.status}, error ${a.error} — busy, not down (thetaDown ${thetaDown()})`, a.status === 504 && a.error === 'terminal_busy' && !thetaDown());

/* no breaker: the next read goes straight out */
const before = calls.length;
const third = thetaGet('/stock/snapshot/quote?symbol=IWM&format=json');
await new Promise(r => setTimeout(r, 50));
check(`after the timeout the next read goes out at once (calls ${before} → ${calls.length})`, calls.length === before + 1);
calls[calls.length - 1].answer({ response: [{ symbol: 'IWM', bid: 1, ask: 1.01 }] });
await third;

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
