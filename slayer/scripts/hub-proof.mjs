/*
  The data hub (server/hub.mjs) against a counting stand-in for the vendor: viewers must never multiply the calls.
  Run: node scripts/hub-proof.mjs
*/

import { canonical, createHub } from '../server/hub.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* a vendor that answers in 20 ms and counts every call */
function vendor(status = () => 200) {
  const calls = new Map();
  return {
    calls,
    total: () => [...calls.values()].reduce((a, b) => a + b, 0),
    fetch: async (p) => {
      calls.set(p, (calls.get(p) ?? 0) + 1);
      await sleep(20);
      const s = status(p);
      return { status: s, body: Buffer.from(JSON.stringify({ p, n: calls.get(p) })), type: 'application/json' };
    },
  };
}

/* N viewers, each asking for the same path every `every` ms (out of phase), for `ms` */
async function viewers(hub, n, every, ms, path = '/stock/SPY/stock-state') {
  const end = Date.now() + ms;
  let asks = 0;
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      await sleep((every / n) * i);
      while (Date.now() < end) {
        await hub.get(path);
        asks += 1;
        await sleep(every);
      }
    }),
  );
  return asks;
}

const TTL = 300;
const RUN = 3_000;

check('one key per request', canonical('/a?z=1&b=2&a=3&b=1') === '/a?a=3&b=2&b=1&z=1');

/* the number of viewers does not change the vendor calls: at most one per freshness window, plus the first */
const counts = {};
for (const n of [1, 5, 500]) {
  const v = vendor();
  const hub = createHub({ name: `proof-${n}`, fetch: v.fetch, ttl: () => TTL, refreshPerSec: 50 });
  const asks = await viewers(hub, n, 100, RUN);
  counts[n] = v.total();
  check(`${n} viewer(s) asking every 100 ms: ${asks} asks, ${v.total()} vendor calls`, v.total() <= RUN / TTL + 3);
}
/* timers drift on a busy machine, so the comparison allows a few calls either way; the point is 500 viewers ≈ 1, not 500× */
check('500 viewers cost about what 1 does (within three calls)', counts[500] <= counts[1] + 3, `${counts[1]} vs ${counts[500]}`);

/* a single slow viewer is not refreshed faster than it looks: calls follow its asks, not the freshness window */
{
  const v = vendor();
  const hub = createHub({ name: 'proof-slow', fetch: v.fetch, ttl: () => 100, refreshPerSec: 50 });
  const asks = await viewers(hub, 1, 600, RUN);
  check(`one viewer every 600 ms on a 100 ms path: ${asks} asks, ${v.total()} calls`, v.total() <= asks + 2);
}

/* identical asks at the same instant share one call */
{
  const v = vendor();
  const hub = createHub({ name: 'proof-burst', fetch: v.fetch, ttl: () => TTL, refreshPerSec: 50 });
  await Promise.all(Array.from({ length: 200 }, () => hub.get('/news/headlines?page=0&limit=50')));
  await Promise.all(Array.from({ length: 200 }, () => hub.get('/news/headlines?limit=50&page=0')));
  check('400 simultaneous asks, two spellings: one vendor call', v.total() === 1, `${v.total()}`);
}

/* a failure is shown as one unless the caller allows the last good answer */
{
  let down = false;
  const v = vendor(() => (down ? 503 : 200));
  const strict = createHub({ name: 'proof-strict', fetch: v.fetch, ttl: () => 50, refreshPerSec: 50 });
  const lenient = createHub({ name: 'proof-lenient', fetch: v.fetch, ttl: () => 50, refreshPerSec: 50, keepOnFail: () => true });
  await strict.get('/q');
  await lenient.get('/q2');
  down = true;
  await sleep(200);
  /* the first ask after the outage may get the copy from a moment ago while the refresh runs; once that refresh
     has failed, the next ask sees the failure */
  await strict.get('/q');
  await sleep(60);
  const a = await strict.get('/q');
  await lenient.get('/q2');
  await sleep(60);
  const b = await lenient.get('/q2');
  check('once a refresh fails, the failure shows (no stale price passed off as live)', a.status === 503, `${a.status}`);
  check('keepOnFail keeps the last good answer', b.status === 200, `${b.status}`);
}

/* "no data" is an answer: kept, so viewers asking again do not each go to the vendor */
{
  const v = vendor(() => 472);
  const hub = createHub({ name: 'proof-nodata', fetch: v.fetch, ttl: () => 10_000, refreshPerSec: 50 });
  for (let i = 0; i < 50; i++) await hub.get('/option/history/quote?date=20261028');
  check('a no-data answer is kept like any other', v.total() === 1, `${v.total()}`);
}

/* a viewer who has to wait on a background refresh moves it to the viewers' lane (once), so it is not stuck behind
   the other refreshes */
{
  let n = 0;
  const promoted = [];
  const hub = createHub({
    name: 'proof-promote',
    fetch: async (p) => {
      n += 1;
      await sleep(n === 1 ? 10 : 2_500);
      return { status: 200, body: Buffer.from(String(n)), type: 'text/plain' };
    },
    ttl: () => 50,
    refreshPerSec: 50,
    promote: (p) => promoted.push(p),
  });
  await hub.get('/slow');
  await sleep(80);
  await hub.get('/slow');
  await sleep(2_100);
  const [a, b] = await Promise.all([hub.get('/slow'), hub.get('/slow')]);
  check('a viewer joining a background refresh promotes it once', promoted.length === 1 && promoted[0] === '/slow', JSON.stringify(promoted));
  check('the joined refresh answers the viewers (no second vendor call)', n === 2 && String(a.body) === '2' && String(b.body) === '2', `calls ${n}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall hub checks passed');
process.exit(failed ? 1 : 0);
