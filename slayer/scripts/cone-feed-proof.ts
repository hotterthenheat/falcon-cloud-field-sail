/*
  The cone's live read (data/coneFeed.ts) asks ONE all-expiry first-order greeks snapshot (`expiration=*`, max_dte 14,
  the strike either side of the money) instead of the listed expiries and one snapshot for each of the three it draws.

  Known numbers: the terminal's answers for SPY at Friday 2026-10-30's close, read 2026-10-31
  (scripts/fixtures/theta-carry/cone-spy-2026-10-31.json): the per-expiry snapshots for 11-02, 11-03 and 11-06, the
  listed expiries (trimmed to October 2026 on), and the one all-expiry snapshot. Every field of the 12 per-expiry
  contracts (delta, IV, theta, vega, rho, bid, ask, underlying, stamp) is identical in the all-expiry answer; SPXW's
  11-06 read checked the same way on the terminal (4 of 4 identical).
  Run:  npx tsx scripts/cone-feed-proof.ts
*/
import fs from 'node:fs';
import { freezeClock } from './golden/uwFixtures';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/terrain', href: 'http://127.0.0.1/terrain', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
const mem = new Map<string, string>();
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };

const answers = JSON.parse(fs.readFileSync('scripts/fixtures/theta-carry/cone-spy-2026-10-31.json', 'utf8')) as Record<string, { response: { contract: Record<string, unknown>; data: Record<string, unknown>[] }[] }>;
const asked: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^\/api\/theta/, '');
  asked.push(path);
  const body = answers[path];
  return body ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('No data found for your request', { status: 472 });
}) as typeof fetch;

freezeClock('2026-10-31T16:00:00Z');
(await import('../src/data/feedGate')).openFeeds();
const cone = await import('../src/data/coneFeed');

/* the same fields, contract by contract */
const star = answers['/option/snapshot/greeks/first_order?symbol=SPY&expiration=*&max_dte=14&strike_range=1&format=json'].response;
const key = (c: Record<string, unknown>) => `${c.expiration}|${c.strike}|${c.right}`;
const byKey = new Map(star.map(it => [key(it.contract), it.data[0]]));
const FIELDS = ['delta', 'implied_vol', 'theta', 'vega', 'rho', 'bid', 'ask', 'underlying_price', 'timestamp'];
let same = 0;
let total = 0;
for (const exp of ['20261102', '20261103', '20261106']) {
  for (const it of answers[`/option/snapshot/greeks/first_order?symbol=SPY&expiration=${exp}&strike_range=1&format=json`].response) {
    total++;
    const y = byKey.get(key(it.contract));
    if (y && FIELDS.every(f => String(it.data[0][f]) === String(y[f]))) same++;
  }
}
check(`the all-expiry answer carries every per-expiry contract with the same ${FIELDS.length} fields: ${same}/${total}`, total === 12 && same === 12);

/* before: the per-expiry way */
asked.length = 0;
const before = await cone.coneRowsPerExpiry('SPY');
const beforeAsks = [...asked];
/* after: one request */
asked.length = 0;
const after = await cone.coneRowsAll('SPY');
const afterAsks = [...asked];
const words = (rows: typeof before) => (rows ?? []).map(r => `${r.expiry} ${(r.iv * 100).toFixed(2)}%`).join(', ');
console.log(`     before: ${words(before)}`);
console.log(`     after:  ${words(after)}`);
check('the same three expiries and the same ATM IVs, to the digit', JSON.stringify(before) === JSON.stringify(after) && (after?.length ?? 0) === 3);
check(`requests: ${beforeAsks.length} before (the list + ${beforeAsks.length - 1} snapshots) → ${afterAsks.length} after`, beforeAsks.length === 4 && afterAsks.length === 1);
const bytes = (paths: string[]) => paths.reduce((n, p) => n + JSON.stringify(answers[p] ?? '').length, 0);
console.log(`     bytes read: ${bytes(beforeAsks)} before (the list trimmed here; the full SPY list is 99 KB) → ${bytes(afterAsks)} after`);

/* the surface the cone draws reads it, and asks once */
asked.length = 0;
cone.ensureCone('SPY');
for (let i = 0; i < 200 && !cone.coneTerm('SPY'); i++) await new Promise(r => setTimeout(r, 5));
const term = cone.coneTerm('SPY');
check(`the cone's surface: ${term?.rows.map(r => `${r.expiry} ${(r.iv * 100).toFixed(2)}%`).join(', ')} from ${asked.length} request`, term?.source === 'theta' && term.rows.length === 3 && asked.length === 1);

/* a name with nothing inside two weeks falls back to the per-expiry reads */
asked.length = 0;
const none = await cone.coneRowsAll('ZZZZ');
check(`a name the all-expiry read has nothing for answers null (${asked.length} request), so the per-expiry way takes over`, none === null && asked.length === 1);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
