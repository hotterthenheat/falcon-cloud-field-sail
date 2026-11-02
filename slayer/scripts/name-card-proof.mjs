/*
  The palette's name card (server/nameCard.mjs) against a counting stand-in for the hub: the four paths are the
  browser's own spellings (so the hub's copy is shared with the Dossier and the name's hooks), they travel in the
  background lane, the vendor's envelope is opened, a failed table is null (never stand-in rows), a composed card is
  kept for its minute and one in flight is shared, and a bad symbol asks nothing.
  Run: node scripts/name-card-proof.mjs
*/

import { CARD_TABLES, MEMO_MS, READ_MAX_AGE_MS, cardPath, createNameCard, proxyNameCard, rowsOfBody } from '../server/nameCard.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- 1. the paths: the browser's own (data/earningsFeed.ts whalesEarnings, data/liveRecord.ts) ---- */
check('earnings path', cardPath('earnings', 'NVDA') === '/earnings/NVDA');
check('news path', cardPath('news', 'NVDA') === '/news/headlines?ticker=NVDA&limit=50&page=0');
check('insiders path', cardPath('insiders', 'NVDA') === '/insider/transactions?ticker_symbol=NVDA');
check('congress path', cardPath('congress', 'NVDA') === '/congress/recent-trades?ticker=NVDA&limit=200');
check('a dotted symbol is escaped once', cardPath('earnings', 'BRK.B') === '/earnings/BRK.B');

/* ---- 2. the envelope ---- */
check('{data:[…]} opens to its rows', JSON.stringify(rowsOfBody('{"data":[{"a":1}]}')) === '[{"a":1}]');
check('a bare list is its rows', JSON.stringify(rowsOfBody('[{"a":2}]')) === '[{"a":2}]');
check('an error body is no rows', rowsOfBody('{"error":"x"}') === null && rowsOfBody('<html>') === null && rowsOfBody('') === null);

/* ---- 3. the keeper, on a counting hub ---- */
let t = 1_000_000;
const asks = [];
let fail = new Set();
const hub = async (path, opt) => {
  asks.push({ path, opt });
  await new Promise((r) => setTimeout(r, 5));
  if (fail.has(path)) return { status: 429, body: '{"message":"rate limited"}', at: t };
  return { status: 200, body: JSON.stringify({ data: [{ path }] }), at: t - 1000 };
};
const k = createNameCard({ read: hub, now: () => t });
const [c1, c2] = await Promise.all([k.ask('nvda'), k.ask('NVDA')]);
check('two asks at once share one compose: four reads', asks.length === 4 && c1 === c2, `${asks.length} reads`);
check('every read in the background lane, reusing a copy up to 10 minutes old', asks.every((a) => a.opt?.lane === 'record' && a.opt?.maxAge === READ_MAX_AGE_MS));
check('the reads are the four paths', CARD_TABLES.every((tb) => asks.some((a) => a.path === cardPath(tb, 'NVDA'))));
check('the card carries each table\'s rows and the hub\'s instant', CARD_TABLES.every((tb) => c1.tables[tb].status === 200 && c1.tables[tb].rows?.[0]?.path === cardPath(tb, 'NVDA') && c1.tables[tb].at === t - 1000));
t += MEMO_MS - 1;
await k.ask('NVDA');
check('inside its minute the card is the kept one: no reads', asks.length === 4);
t += 2;
fail = new Set([cardPath('news', 'NVDA')]);
const c3 = await k.ask('NVDA');
check('past its minute it composes again: four reads', asks.length === 8);
check('a refused table is null with its status — no stand-in rows', c3.tables.news.rows === null && c3.tables.news.status === 429 && c3.tables.news.at === null);
check('the other tables still land', c3.tables.earnings.rows?.length === 1 && c3.tables.congress.rows?.length === 1);
const bad = await k.ask('not a name!');
check('a bad symbol asks nothing', bad === null && asks.length === 8);

/* ---- 4. the route ---- */
process.env.UW_PROXY_OPEN = '1';
const call = async (url, method = 'GET') => {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(h, v) { this.headers[h.toLowerCase()] = v; }, end(b) { this.body = String(b ?? ''); } };
  await proxyNameCard({ method, url, headers: {} }, res, k);
  return res;
};
const r1 = await call('/api/name-card/NVDA');
check('GET /api/name-card/NVDA answers the card', r1.statusCode === 200 && JSON.parse(r1.body).ticker === 'NVDA' && r1.headers['cache-control'] === 'no-store');
const r2 = await call('/api/name-card/..%2Fetc');
check('a path that is not a symbol is 404', r2.statusCode === 404);
const r3 = await call('/api/name-card/NVDA', 'POST');
check('only GET', r3.statusCode === 405);

if (failed) {
  console.error(`${failed} name-card check(s) failed`);
  process.exit(1);
}
console.log('name card: every check passed');
