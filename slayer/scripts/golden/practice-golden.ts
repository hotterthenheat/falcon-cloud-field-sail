/*
  Practice's backtest against a recorded ThetaData session: SPY on Wed 2026-10-28. The app's own loaders
  (data/review/history.ts) read the recorded answers exactly as the browser reads the proxy's, and the engine
  (data/review/engine.ts) plays a scripted set of entries and exits over them.

  Every expected value is worked out a second way, straight from the raw recorded rows by the plain JSON reading at
  the foot of this file (none of the app's code): the minute's NBBO row a fill must equal, the first row a resting
  limit could fill on, the bar a stop on the name is reached at, and the dollars. GOLDEN_REPORT=1 prints the figures
  with the rows they come from, for a hand check of the recording.

  The set needs the ThetaData terminal to record (it is not reachable from every machine):
    Record: GOLDEN_RECORD=1 npx tsx scripts/golden/practice-golden.ts   (terminal running, dev server on :8080)
    Replay: npx tsx scripts/golden/practice-golden.ts
  Until the set is recorded the test says so and exits without failing.
*/
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'practice-2026-10-29';
const DAY = '2026-10-28';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden', SET);
const RECORD = process.env.GOLDEN_RECORD === '1';
const REPORT = process.env.GOLDEN_REPORT === '1';
if (!RECORD && !existsSync(join(DIR, 'clock.txt'))) {
  console.log(`PENDING  ${SET} has not been recorded yet: it needs the ThetaData terminal. Record with GOLDEN_RECORD=1 npx tsx scripts/golden/practice-golden.ts`);
  process.exit(0);
}

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/practice/backtest', href: 'http://127.0.0.1/practice/backtest', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));

const H = await import('../../src/data/review/history');
const E = await import('../../src/data/review/engine');
const { quoteAt } = await import('../../src/data/review/quotes');
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();
const say = (k: string, v: unknown) => REPORT && console.log(`REPORT ${k} = ${JSON.stringify(v)}`);

/* ---- the day, as the app loads it ---- */
expectEqual('the newest finished session at the recording is Oct 28', H.lastReplayDay(), DAY);
await H.ensureBars('SPY', DAY);
await H.ensureListing('SPY', DAY);
const bars = H.dayBars('SPY', DAY);
const listing = H.listingOf('SPY', DAY)!;
/* the first expiry two calendar days out or more: Friday Oct 30 */
const expiry = listing.expiries.find(e => e >= '2026-10-30')!;
const s29 = H.spotAt('SPY', DAY, 29);
const strikes = listing.strikes[`${expiry}|C`];
const strike = strikes.reduce((b, k) => (Math.abs(k - s29) < Math.abs(b - s29) ? k : b), strikes[0]);
const call = { ticker: 'SPY', strike, right: 'C' as const, expiry };
const put = { ticker: 'SPY', strike, right: 'P' as const, expiry };
await H.ensureLeg(call, DAY);
await H.ensureLeg(put, DAY);

/* ---- the raw rows, read plainly ---- */
const raw = (path: string): Record<string, unknown>[] => {
  const file = join(DIR, `${createHash('sha1').update(`theta:${path}`).digest('hex').slice(0, 16)}.json.gz`);
  const saved = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { body: string };
  const parsed = JSON.parse(saved.body) as { response?: unknown[] } | unknown[];
  const top = (Array.isArray(parsed) ? parsed : (parsed.response ?? [])) as Record<string, unknown>[];
  return top.flatMap(o => (Array.isArray(o.data) ? (o.data as Record<string, unknown>[]).map(d => ({ ...(o.contract as object), ...d })) : [o]));
};
const ymd = DAY.replace(/-/g, '');
const barRows = raw(`/stock/history/ohlc?symbol=SPY&date=${ymd}&interval=1m&format=json`);
const legPath = (c: typeof call) => `/option/history/quote?symbol=SPY&expiration=${c.expiry.replace(/-/g, '')}&strike=${c.strike.toFixed(2)}&right=${c.right === 'C' ? 'call' : 'put'}&date=${ymd}&interval=1m&format=json`;
const callRows = raw(legPath(call));
const putRows = raw(legPath(put));
/* "HH:MM" of a row; a bar is stamped at its start, an interval quote at the instant it stood */
const hm = (r: Record<string, unknown>) => String(r.timestamp).slice(11, 16);
const clock = (m: number) => `${String(Math.floor((570 + m) / 60)).padStart(2, '0')}:${String((570 + m) % 60).padStart(2, '0')}`;
const barAt = (m: number) => barRows.find(r => hm(r) === clock(m))!;
const quoteRowAt = (rows: Record<string, unknown>[], m: number) => rows.find(r => hm(r) === clock(m + 1))!;

/* the bars: the 09:30 bar's open and the 15:59 bar's close, as recorded */
expectNear('the 09:30 bar opens where the recording says', bars[0].open, Number(barAt(0).open), 1e-9);
expectNear('the 15:59 bar closes where the recording says', bars[389].close, Number(barAt(389).close), 1e-9);
expectNear('10:00 is the 09:59 bar’s close', s29, Number(barAt(29).close), 1e-9);
say('strike', strike);
say('expiry', expiry);
say('bar 09:30 open', barAt(0).open);
say('bar 15:59 close', barAt(389).close);

/* ---- the scripted session ---- */
let s = E.newSession({ id: 'g', name: 'golden', ticker: 'SPY', startCash: 25000, startDay: DAY, now: 0 });
s = E.advance(s, { day: DAY, minute: 29 }, 0);
s = E.place(s, { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
/* 1. a market buy at 10:00 fills at the 10:00:00 row's ask */
const ask29 = Number(quoteRowAt(callRows, 29).ask);
expectNear('the 10:00 buy fills at the 10:00:00 row’s ask', s.fills[0].price, ask29, 1e-9);
say('call ask 10:00', ask29);
s = E.advance(s, { day: DAY, minute: 119 }, 0);
s = E.place(s, { contract: call, side: 'sell', qty: 1, kind: 'market' }, 0);
/* 2. a market sell at 11:30 fills at the 11:30:00 row's bid */
const bid119 = Number(quoteRowAt(callRows, 119).bid);
expectNear('the 11:30 sell fills at the 11:30:00 row’s bid', s.fills[1].price, bid119, 1e-9);
say('call bid 11:30', bid119);
/* 3. a resting limit to sell the other one, 0.25 over that bid: it fills on the first later row whose bid reaches it,
      at that bid (never under the limit) — or it is still working at the bell */
const limit = Math.round((bid119 + 0.25) * 100) / 100;
s = E.place(s, { contract: call, side: 'sell', qty: 1, kind: 'limit', price: limit, tif: 'day' }, 0);
s = E.advance(s, { day: DAY, minute: 389 }, 0);
let limitMinute = -1;
for (let m = 120; m <= 389; m++) {
  const r = quoteRowAt(callRows, m);
  if (r && Number(r.bid) > 0 && Number(r.ask) > 0 && Number(r.bid) >= limit) {
    limitMinute = m;
    break;
  }
}
const limitFill = s.fills.find(f => f.how === 'limit');
if (limitMinute >= 0) {
  expectEqual('the limit fills on the first row whose bid reaches it', limitFill?.at.minute, limitMinute);
  expectNear('…at that row’s bid', limitFill?.price ?? NaN, Math.max(limit, Number(quoteRowAt(callRows, limitMinute).bid)), 1e-9);
} else expectEqual('no row’s bid reached the limit: it was cancelled at the bell', s.orders.find(o => o.kind === 'limit')?.why, 'the day ended');
say('limit', limit);
say('limit fill minute', limitMinute);

/* 4. a put bought at 13:00 with a stop on the name 0.50 over where SPY stood: it sells on the first bar whose close is
      at or over that, at that minute's bid */
const s209 = H.spotAt('SPY', DAY, 209);
let p = E.advance(E.newSession({ id: 'p', name: 'put', ticker: 'SPY', startCash: 25000, startDay: DAY, now: 0 }), { day: DAY, minute: 209 }, 0);
/* a put's stop on the name sits above it: SPY rising 0.50 */
const up = Math.round((s209 + 0.5) * 100) / 100;
p = E.place(p, { contract: put, side: 'buy', qty: 1, kind: 'market', bracket: { stop: up, on: 'name' } }, 0);
p = E.advance(p, { day: DAY, minute: 389 }, 0);
let stopMinute = -1;
for (let m = 210; m <= 389; m++) if (Number(barAt(m)?.close) >= up && Number(quoteRowAt(putRows, m)?.bid) > 0) {
  stopMinute = m;
  break;
}
expectNear('the put fills at the 13:00:00 row’s ask', p.fills[0].price, Number(quoteRowAt(putRows, 209).ask), 1e-9);
if (stopMinute >= 0) {
  const sf = p.fills.find(f => f.how === 'stop');
  expectEqual('the stop on the name sells the first minute SPY closes at or over its level', sf?.at.minute, stopMinute);
  expectNear('…at that minute’s bid', sf?.price ?? NaN, Number(quoteRowAt(putRows, stopMinute).bid), 1e-9);
} else expectEqual('SPY never closed over the level: the put is still held at the bell', E.bookOf(p).positions.length, 1);
say('put level', up);
say('put stop minute', stopMinute);

/* ---- the dollars ---- */
const fills = s.fills;
const cash = 25000 + fills.reduce((a, f) => a + (f.side === 'buy' ? -1 : 1) * f.price * 100 * f.qty - f.fee, 0);
expectNear('cash is the fills, a hundred a point, less 0.65 a contract each way', E.cashOf(s), Math.round(cash * 100) / 100, 1e-9);
const closed = E.bookOf(s).trades;
if (closed.length) {
  const t = closed[0];
  expectNear('a closed trade’s P&L is what its fills say', t.pnl, Math.round((t.legs.reduce((a, l) => a + (l.side === 'sell' ? 1 : -1) * l.price * 100 * l.qty - l.fee, 0)) * 100) / 100, 1e-9);
  say('trade pnl', t.pnl);
}
const mark389 = quoteAt(call, DAY, 389);
say('call at 16:00', { bid: mark389.bid, ask: mark389.ask });

done();
