/*
  Compass cost proof (data/compassCost.ts, data/compassHurdle.ts):
  - the hurdle module is the markdown's (research/edge0dte/results/HURDLE.md): regenerated, it is byte for byte the
    committed src/data/compassHurdle.gen.ts, and its lookups read the right cells;
  - a contract's break-even level pays the ask back at the flat, its move is in priced moves, and the mean move it
    needs (mu) is ~0 for a fair contract with no spread and grows with the spread;
  - mu matches its first-order form, round trip ÷ (delta × priced move in dollars);
  - the choice takes the smallest mu among the allowed contracts, with no cap, and leaves the choice to the score when
    nothing can be read.
  Run:  npx tsx scripts/compass-cost-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blackScholesPrice } from '../src/core/greeks';
import { costPick, costRead, atmIvOf, needsLine, type CostQuote } from '../src/data/compassCost';
import { hurdleFor, horizonOf, bucketOf } from '../src/data/compassHurdle';
import { HURDLE_GEN, HURDLE_MD, hurdleModule } from './compass-hurdle-sync';
import { Q, R, tradingMinutesTo, SESSION_MIN, YEAR_SESSIONS } from '../src/data/compassParams';
import { nyWallTime } from '../src/core/nyTime';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/* ---- the hurdle, from the markdown, in one place ---- */
const md = readFileSync(join(root, HURDLE_MD), 'utf8');
const gen = readFileSync(join(root, HURDLE_GEN), 'utf8');
check('compassHurdle.gen.ts is HURDLE.md as it stands (else: npx tsx scripts/compass-hurdle-sync.ts)', hurdleModule(md) === gen);
const at10 = hurdleFor('SPXW', 10 * 60 + 5, 55);
check('SPXW 10:05, held 55 min: the 10:00 bucket at 60 min, +0.15 [+0.10, +0.19]', !!at10 && at10.hz === 0.15 && at10.lo === 0.1 && at10.hi === 0.19 && !at10.pooled, JSON.stringify(at10));
/* h = 60 is undefined after 15:00 (HURDLE.md), so a 15:30 call held 50 minutes falls back to the pooled 60-minute row */
const at1530 = hurdleFor('SPX', 15 * 60 + 30, 50);
check('SPX 15:30 (no 60-minute number in its bucket): the pooled 60-minute row, +0.11', !!at1530 && at1530.hz === 0.11 && at1530.pooled, JSON.stringify(at1530));
check('a root the research has not measured has no hurdle', hurdleFor('TSLA', 10 * 60, 30) == null);
check('horizons: 10 → 15, 30 → 30, 75 → 60, 300 → close', horizonOf(10) === 15 && horizonOf(30) === 30 && horizonOf(75) === 60 && horizonOf(300) === 'close');
check('buckets: 09:47 → 09:30, 14:59 → 14:30', bucketOf(9 * 60 + 47) === '09:30' && bucketOf(14 * 60 + 59) === '14:30');

/* ---- one contract's read, on quotes priced by the same model ---- */
/* a Monday, 10:00 ET, a same-day expiry, the flat at 15:55 */
const day = '2026-11-09';
const at = nyWallTime(2026, 11, 9, 10, 0);
const flatAt = nyWallTime(2026, 11, 9, 15, 55);
const tNow = tradingMinutesTo(day, at) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
const S = 700;
const vol = 0.18;
const quote = (K: number, right: 'C' | 'P', spread: number, iv = vol): CostQuote => {
  const mid = blackScholesPrice(S, K, tNow, iv, right, R, Q);
  return { strike: K, right, bid: Math.max(0, mid - spread / 2), ask: mid + spread / 2, expiryDate: day };
};
const ctx = { spot: S, atmIv: vol, at, flatAt };
const fair = costRead(quote(700, 'C', 0), ctx);
check('a fair ATM call with no spread reads', !!fair);
if (fair) {
  check('its h is 10:00 to 15:55 on the trading clock', near(fair.hYears, 355 / (SESSION_MIN * YEAR_SESSIONS), 1e-6), String(fair.hYears));
  check('its IV solves back to the quote\'s', near(fair.iv, vol, 1e-4));
  check('with no spread it needs no mean move to break even (|mu| < 0.06 priced moves)', Math.abs(fair.mu) < 0.06, fair.mu.toFixed(4));
  check('it still needs a move by the flat to beat its decay (z > 0)', fair.z > 0, fair.z.toFixed(3));
}
const tight = costRead(quote(700, 'C', 0.05), ctx)!;
const wide = costRead(quote(700, 'C', 0.6), ctx)!;
check('a wider spread needs more: mu and z both rise', wide.mu > tight.mu && wide.z > tight.z, `${tight.mu.toFixed(3)} → ${wide.mu.toFixed(3)}`);
check('the round trip is ask − bid', near(wide.roundTrip, 0.6, 1e-9));
{
  const q = quote(700, 'C', 0.6);
  const tExit = tradingMinutesTo(day, flatAt) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  const bidThere = blackScholesPrice(wide.level, 700, tExit, wide.iv, 'C', R, Q) - 0.3;
  check('at the level, the exit bid at the flat pays the ask back', near(bidThere, q.ask, 1e-4), `${bidThere.toFixed(4)} vs ${q.ask.toFixed(4)}`);
  check('the level is z priced moves up', near(Math.log(wide.level / S) / (vol * Math.sqrt(wide.hYears)), wide.z, 1e-6));
}
/* first order: mu ≈ round trip ÷ (delta × S × priced move); for a deep in-the-money call delta ≈ 1 all the way */
{
  const deep = costRead(quote(560, 'C', 0.4), ctx)!;
  const first = 0.4 / (S * vol * Math.sqrt(deep.hYears));
  check('deep in the money: mu ≈ round trip ÷ (S × priced move)', near(deep.mu, first, first * 0.15), `${deep.mu.toFixed(4)} vs ${first.toFixed(4)}`);
}
const put = costRead(quote(700, 'P', 0.3), ctx)!;
check('a put\'s level is under the spot and its z is sign-aligned (> 0)', put.level < S && put.z > 0);
check('the card line names the print, the side and the clock', needsLine(put, 'P', 'SPX', () => '15:55') === `needs SPX ≤ ${put.level.toFixed(1)} by 15:55 (${put.z.toFixed(2)}× the priced move)`, needsLine(put, 'P', 'SPX', () => '15:55'));
check('the ATM IV solves from the ATM pair', near(atmIvOf([quote(700, 'C', 0.1), quote(700, 'P', 0.1), quote(705, 'C', 0.1)], S, at) ?? 0, vol, 2e-3));
check('a one-sided quote does not read', costRead({ strike: 700, right: 'C', bid: 0, ask: 0, expiryDate: day }, ctx) == null);
check('an empty horizon does not read', costRead(quote(700, 'C', 0.1), { ...ctx, flatAt: at }) == null);

/* ---- the choice: the smallest mu, no cap ---- */
const pool = [quote(690, 'C', 0.9), quote(700, 'C', 0.12), quote(710, 'C', 0.3), quote(640, 'C', 2.5)];
const reads = pool.map(c => costRead(c, ctx)!.mu);
const picked = costPick(pool, c => costRead(c, ctx));
const smallest = reads.indexOf(Math.min(...reads));
check('it picks the contract with the smallest mu', !!picked && picked.pick === pool[smallest] && picked.readN === 4, reads.map(m => m.toFixed(3)).join(' '));
check('a pricier contract is not ruled out by its price: the deep one is read like the rest', Number.isFinite(reads[3]));
check('nothing readable: no pick (the score rule keeps the choice)', costPick([{ strike: 1, right: 'C', bid: 0, ask: 0, expiryDate: day }], c => costRead(c as CostQuote, ctx)) == null);

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass cost proof: every check passed');
