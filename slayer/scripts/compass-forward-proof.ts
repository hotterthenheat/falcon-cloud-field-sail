/*
  Compass forward test proof (data/compassTwins.ts, data/compassForward.ts):
  - a call's twin is the other side at the mirrored strike, keyed to the call, and is made and settled by the engine's
    own settlement (compassLedger settledCopy) on its own recorded quotes: fill at the ask of the first quote a full
    minute after the call, exit by the call's rules;
  - the day-clustered bootstrap is deterministic, collapses to the mean on one day, and widens with day-to-day spread;
  - the forward lines count, pair, flip and difference the calls and twins exactly; small samples read as counts;
  - the export has one row per official call with its twin, the coin flip and the cost read.
  Run:  npx tsx scripts/compass-forward-proof.ts
*/
import { setCompassHost } from '../src/data/compassHost';
import { mirrorStrike, settleTwins, twinOf, twinRows, importTwins, type Twin } from '../src/data/compassTwins';
import { clusteredMean, forwardCsv, forwardTest, rateWords, RESAMPLES, SMALL_N } from '../src/data/compassForward';
import type { Signal } from '../src/data/compassLedger';
import type { Outcome } from '../src/data/compassOutcome';
import { nyWallTime } from '../src/core/nyTime';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};

/* ---- the twin's contract ---- */
const SPY = Array.from({ length: 60 }, (_, i) => 725 + i);
check('SPY 757P at 754.15 mirrors to the 751 call (754.15² ÷ 757 = 751.3)', mirrorStrike(SPY, 754.15, 757) === 751);
check('an at-the-money strike mirrors to itself', mirrorStrike(SPY, 740, 740) === 740);
check('a tie goes to the strike nearer the spot', mirrorStrike([99, 101], 100, 100) === 99 || mirrorStrike([99, 101], 100, 100) === 101);
check('no spot: no twin strike', mirrorStrike(SPY, 0, 740) == null);

const day = '2026-11-06';
const fired = nyWallTime(2026, 11, 6, 10, 0) + 20_000;
const flat = nyWallTime(2026, 11, 6, 15, 55);
const closed = (pnl: number, ask = 2): Outcome => ({ status: 'closed', fill: { at: fired + 60_000, bid: ask - 0.05, ask }, exit: { at: fired + 600_000, px: ask + pnl / 100, why: 'Take profit 1.50×' }, peak: 0, stop: 0, last: null, ret: Number(((pnl / 100 / ask) * 100).toFixed(1)), pnl, heldMin: 9 });
const call = (o: Partial<Signal> & { key: string }): Signal => ({
  id: o.key, day, book: 'A', ticker: 'SPY', contract: 'SPY 757P', right: 'P', strike: 757, expiry: day, sleeve: 'odte', firedAt: fired, quoteAt: fired,
  bid: 5.66, ask: 5.68, spot: 754.15, p1: 0.75, prun: null, runner: false, outcome: null, pathAt: 0, spark: [], how: 'live', flatAt: flat, ...o,
});
const c0 = call({ key: `${day}|SPY-757-P` });
const t0 = twinOf(c0, 751);
check('the twin is the other side, at its strike, keyed to the call', t0.right === 'C' && t0.strike === 751 && t0.contract === 'SPY 751C' && t0.twinOf === c0.key && t0.key === `${c0.key}|twin`);
check('the twin keeps the call\'s instant, book, runner and flat, and carries no score', t0.firedAt === c0.firedAt && t0.book === 'A' && t0.runner === false && t0.flatAt === flat && t0.p1 == null && !t0.cost);
check('no contract on the other side: an unavailable twin that says why', twinOf(c0, null, 'No strike.').outcome?.status === 'unavailable' && twinOf(c0, null, 'No strike.').none === 'No strike.');

/* ---- made and settled by the engine on recorded quotes (a host that answers like the terminal) ---- */
const asked: string[] = [];
const two = (n: number) => String(n).padStart(2, '0');
const minutes = Array.from({ length: 391 }, (_, i) => i);
setCompassHost({
  server: true,
  theta: async path => {
    asked.push(path);
    if (path.startsWith('/option/list/strikes')) return { status: 200, data: SPY.map(strike => ({ symbol: 'SPY', strike })), error: null };
    if (path.startsWith('/option/history/quote') && path.includes('strike=751') && path.includes('right=call') && path.includes('interval=1m')) {
      /* the 751 call quoted 2.00 × 2.05 at 10:00, then 1.00/1.01 bid against 1.05/1.06 ask to the close: no stop or
         target crossed, so it leaves at its 15:55 flat on the bid */
      return {
        status: 200,
        data: minutes.map(i => {
          const m = 9 * 60 + 30 + i;
          const early = m <= 10 * 60;
          const bid = early ? 2 : 1.6 + (i % 2) * 0.01;
          return { timestamp: `${day}T${two(Math.floor(m / 60))}:${two(m % 60)}:00.000`, bid, ask: early ? 2.05 : bid + 0.05 };
        }),
        error: null,
      };
    }
    return { status: 200, data: [], error: 'no_data' };
  },
  asset: async () => null,
  econ: () => [],
});
importTwins([]);
await settleTwins([c0, call({ key: `${day}|R`, book: 'R' }), call({ key: `${day}|W`, would: true })], Date.now());
check('one twin made: the official call, not Model Risk, not a would-call', twinRows().length === 1 && twinRows()[0].twinOf === c0.key, String(twinRows().length));
check('its strike came from the listed strikes', asked.some(p => p.startsWith('/option/list/strikes?symbol=SPY&expiration=20261106')));
const settled = twinRows()[0];
const o = settled.outcome;
check('settled on its own quotes: filled at the ask of the first quote a full minute after the call (10:01, 1.66)', !!o?.fill && o.fill.at === nyWallTime(2026, 11, 6, 10, 1) && Math.abs(o.fill.ask - 1.66) < 1e-9, JSON.stringify(o?.fill));
check('and left at its flat on the bid, by the call\'s rules', o?.status === 'closed' && /flat/i.test(o.exit?.why ?? '') && o.exit?.at === flat, JSON.stringify(o?.exit));
check('P&L is (exit − fill) × 100', o?.pnl != null && Math.abs(o.pnl - Math.round((o.exit!.px - o.fill!.ask) * 10000) / 100) < 1e-9);
const before = asked.length;
await settleTwins([c0], Date.now() + 120_000);
check('a closed twin is frozen: never read again', asked.length === before);

/* ---- the bootstrap ---- */
const one = clusteredMean([{ day: 'a', v: 1 }, { day: 'a', v: 3 }]);
check('one session: the mean, and no interval', one.mean === 2 && one.lo == null && one.hi == null);
const same = clusteredMean(Array.from({ length: 20 }, (_, i) => ({ day: `d${i}`, v: 5 })));
check('no spread between days: the interval is the mean', same.lo === 5 && same.hi === 5);
const spread = Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, v: i % 2 ? 10 : -10 }));
const a = clusteredMean(spread);
const b = clusteredMean(spread);
check('deterministic (seeded): the page and the export agree', a.lo === b.lo && a.hi === b.hi);
check('a spread between days widens it around the mean', a.lo! < 0 && a.hi! > 0 && a.mean === 0);
/* days move together: 10 sessions of 10 calls each, every call the same within its day, is 10 draws, not 100 */
const clustered = clusteredMean(Array.from({ length: 100 }, (_, i) => ({ day: `d${Math.floor(i / 10)}`, v: Math.floor(i / 10) % 2 ? 10 : -10 })));
const iid = clusteredMean(Array.from({ length: 100 }, (_, i) => ({ day: `d${i}`, v: i % 2 ? 10 : -10 })));
check('clustered by day: ten sessions of ten like calls are wider than a hundred separate sessions', clustered.hi! - clustered.lo! > (iid.hi! - iid.lo!) * 2, `${(clustered.hi! - clustered.lo!).toFixed(1)} vs ${(iid.hi! - iid.lo!).toFixed(1)}`);

/* ---- the lines ---- */
const days = Array.from({ length: 20 }, (_, i) => `2026-10-${two(i + 1)}`);
const calls: Signal[] = days.map((d, i) => call({ key: `${d}|c${i}`, day: d, outcome: closed(100) }));
const twins: Twin[] = calls.map(c => ({ ...twinOf(c, 751), outcome: closed(-100) }));
calls.push(call({ key: '2026-10-21|open', day: '2026-10-21', outcome: closed(50) }));
calls.push(call({ key: '2026-10-21|C', day: '2026-10-21', book: 'C', outcome: closed(-30) }));
const ft = forwardTest(calls, twins);
const m1 = ft.lines.find(l => l.label === 'Model 1')!;
check('Model 1: 21 closed calls, 20 paired, 1 unpaired', m1.calls.n === 21 && m1.paired.n === 20 && m1.unpaired === 1);
check('net and counts are the rows\' own', m1.calls.net === 2050 && m1.calls.won === 21 && m1.twins.won === 0 && m1.twins.net === -2000);
check('the coin flip is the average of each call and its twin', m1.coin.perCall.mean === 0 && m1.coin.net === 0);
check('call − twin is the side choice\'s worth: +$200 a pair, interval [200, 200]', m1.edge.mean === 200 && m1.edge.lo === 200 && m1.edge.hi === 200);
check(`the calls beat (nearly) every one of ${RESAMPLES} coin-flip records`, m1.beatsCoin >= RESAMPLES - 2, String(m1.beatsCoin));
check('Model 3 is its own line; both together count every official call', ft.lines[1].calls.n === 1 && ft.lines[2].calls.n === 22);
check('sessions with a closed call, against the shadow\'s 15', ft.sessions === 21 && ft.target === 15);
check(`under ${SMALL_N} closed calls a rate is a count`, /^21 of 21/.test(rateWords(m1.calls)) && !rateWords(m1.calls).includes('%'), rateWords(m1.calls));
const big = forwardTest(Array.from({ length: 40 }, (_, i) => call({ key: `${days[i % 20]}|b${i}`, day: days[i % 20], outcome: closed(i % 4 ? 100 : -100) })), []);
check(`at ${SMALL_N} or more, a percentage with its interval`, /^75% \(95%: \d+%–\d+%\)$/.test(rateWords(big.lines[0].calls)), rateWords(big.lines[0].calls));

/* ---- the export ---- */
const csv = forwardCsv(calls, twins).trim().split('\n');
check('the export: a header and one row per official call', csv.length === 1 + calls.length, String(csv.length));
const row = csv[1].split(',');
const col = (name: string) => row[csv[0].split(',').indexOf(name)];
check('a row carries the call, its twin, the coin flip and call − twin', col('contract') === 'SPY 757P' && col('twin_contract') === 'SPY 751C' && col('coin_flip_pnl_per_contract') === '0' && col('call_minus_twin') === '200');
check('the export names the model, never a book letter or a score', col('model') === 'Model 1' && !/Book [ABC]|0\.75/.test(csv.join('\n')));

/* ---- the hook for validated rules: empty, and closed to a rule that misses any criterion ---- */
const { VALIDATED_RULES, acceptedRules } = await import('../src/data/compassValidated');
check('no rule has passed EDGE0DTE: the registry is empty and the scan has nothing to call', VALIDATED_RULES.length === 0 && acceptedRules().length === 0);
const passing = {
  id: 'X0', name: 'Model 5', decide: () => null,
  acceptance: {
    stage1: { registryRow: 'X0', fdrQ: 0.05 }, holdout: { ledgerLine: 'x', specSha256: 'a'.repeat(64), trades: 140, sessions: 80, ciLow: 0.01 },
    beatsBaselines: true, dsr: 0.97, pbo: 0.2, neighbourhood: true, costs: true, notOneRegime: true, redTeam: 'note', shadow: { sessions: 15, from: '2026-11-09', to: '2026-11-27' },
  },
};
check('a rule meeting all eight criteria and the shadow is accepted', acceptedRules([passing]).length === 1);
check('one miss (a 14-session shadow, PBO 0.30, a holdout CI touching 0) and it is not', acceptedRules([
  { ...passing, acceptance: { ...passing.acceptance, shadow: { ...passing.acceptance.shadow, sessions: 14 } } },
  { ...passing, acceptance: { ...passing.acceptance, pbo: 0.3 } },
  { ...passing, acceptance: { ...passing.acceptance, holdout: { ...passing.acceptance.holdout, ciLow: 0 } } },
]).length === 0);

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass forward proof: every check passed');
process.exit(0);
