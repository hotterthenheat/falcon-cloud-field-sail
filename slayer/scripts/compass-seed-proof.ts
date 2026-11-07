/*
  Compass seed-read proof (compassModel seedQuotes, seedStrikeParam). The terminal centres strike_range on the
  underlying as it is when asked, not as it was at the mark. QQQ's 15:21 sweep on 2026-11-05 (QQQ at 652.23), read on a
  later day with QQQ near 683, came back 668 and up at strike_range 16 (checked on the terminal, 2026-11-07): a late mark
  scored after the price moved got none of its own strikes 30 minutes back. Now a read more than SEED_LIVE_MS from the
  wall clock asks for every strike (strike=*) and keeps the mark's own; a live read asks exactly as before.
  The terminal here is a stand-in that answers the way the real one did: strike_range around 683, strike=* everything.
  Run:  npx tsx scripts/compass-seed-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCompassHost } from '../src/data/compassHost';
import { WEEKLY_STRIKES } from '../src/data/compassParams';
import { SEED_LIVE_MS, seedQuotesForProof, seedStrikeParam } from '../src/data/compassModel';
import type { Setup } from '../src/types/compass';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};

interface Sweep { day: string; ticker: string; expiry: string; mark: number; spot: number; quotes: { strike: number; right: 'C' | 'P'; bid: number; ask: number }[] }
const { sweeps } = JSON.parse(readFileSync(join(root, 'scripts', 'fixtures', 'compass-m3-sweeps.json'), 'utf8')) as { sweeps: Sweep[] };
const qqq = sweeps.find(s => s.day === '2026-11-05' && s.ticker === 'QQQ')!;
check('the fixture holds QQQ 2026-11-05 15:21 at 652.23, strikes 636 to 668', !!qqq && Math.abs(qqq.spot - 652.23) < 1e-6 && Math.min(...qqq.quotes.map(q => q.strike)) <= 640 && Math.max(...qqq.quotes.map(q => q.strike)) >= 664);

/* the stand-in terminal: strike_range=N answers the N strikes either side of TODAY's price (683), strike=* answers all */
const TODAY = 683;
const asked: string[] = [];
const row = (strike: number, right: 'C' | 'P', bid: number, ask: number) => ({ contract: { symbol: 'QQQ', strike, right: right === 'C' ? 'CALL' : 'PUT', expiration: '2026-11-05' }, data: [{ timestamp: '2026-11-05T15:20:00.000', bid, ask, bid_size: 10, ask_size: 12 }] });
const farRows = Array.from({ length: 33 }, (_, i) => TODAY - 16 + i).flatMap(k => [row(k, 'C', 0.01, 0.02), row(k, 'P', k - 652, k - 651.5)]);
const allRows = [...qqq.quotes.filter(q => q.strike < TODAY - 16).map(q => row(q.strike, q.right, q.bid, q.ask)), ...farRows];
setCompassHost({
  server: true,
  theta: async p => {
    asked.push(p);
    if (!p.startsWith('/option/history/quote')) return { status: 472, data: null, error: 'no_data' };
    const range = /strike_range=(\d+)/.exec(p);
    return { status: 200, data: range ? farRows : /strike=\*/.test(p) ? allRows : [], error: undefined } as never;
  },
  asset: async () => null,
  econ: () => [],
});

/* the sweep's own contracts near the money */
const near = qqq.quotes.filter(q => Math.abs(q.strike - 652) <= 2);
const list: Setup[] = near.map(q => ({ id: `QQQ-${q.strike}-${q.right}-seed`, ticker: 'QQQ', contract: `QQQ ${q.strike}${q.right}`, strike: q.strike, right: q.right, expiryDate: '2026-11-05', bid: q.bid, ask: q.ask, spot: qqq.spot, sleeve: 'odte' }) as unknown as Setup);
const mark = qqq.mark;

/* before the fix: a read at the mark asked strike_range=16, which the terminal centres on today's 683 */
const realNow = Date.now;
Date.now = () => mark + 60_000;
const live = await seedQuotesForProof(list, mark);
Date.now = realNow;
const livePath = asked[asked.length - 1] ?? '';
check('a live read (within 10 minutes of the mark) asks as before: strike_range=16', /strike_range=16(&|$)/.test(livePath) && !/strike=\*/.test(livePath), livePath.replace(/.*\?/, ''));
check('that read, answered as the terminal answers a day later, holds none of the mark\'s own strikes (the bug)', !!live && list.every(s => !live.has(s.id)), `${live?.size ?? 0} of ${list.length}`);

/* after: the same mark scored on a later day */
const late = await seedQuotesForProof(list, mark);
const latePath = asked[asked.length - 1] ?? '';
check('a late read on a later day asks for every strike (strike=*)', /strike=\*/.test(latePath) && !/strike_range=/.test(latePath), latePath.replace(/.*\?/, ''));
check('and holds every one of the mark\'s own strikes 652 ± 2, both sides', !!late && list.every(s => late.has(s.id)), `${list.filter(s => late?.has(s.id)).length} of ${list.length}`);
{
  const one = late?.get(list[0].id);
  const q = near[0];
  const got = one ? [...one.values()][0] : null;
  check('with the quotes the terminal recorded for them', !!got && got.bid === q.bid && got.ask === q.ask, JSON.stringify(got));
}
check('the rule: live within SEED_LIVE_MS keeps the centred range (16, or 17 weekly); later asks for all strikes',
  seedStrikeParam(mark, mark + SEED_LIVE_MS, false) === 'strike_range=16' && seedStrikeParam(mark, mark + 1000, true) === `strike_range=${WEEKLY_STRIKES}` && seedStrikeParam(mark, mark + SEED_LIVE_MS + 1, false) === 'strike=*' && seedStrikeParam(mark, mark + 86_400_000, true) === 'strike=*');

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass seed proof: every check passed');
