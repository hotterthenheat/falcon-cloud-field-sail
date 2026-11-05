/*
  The Weigher's greek, held to the math audit's findings (W4, W5, W6, W8, W10; W1 is in weigher-density-proof, W2, W3
  and W7 in paper-proof, W9 in rate-proof):
    W4 theta per session (and per calendar day and hour) never takes more than the extrinsic value inside the last
       session: θ_year × min(t, span), floored at −extrinsic (readGreek thetaOver) — the same figure the Weigher's row,
       its Decay/sess column and the paper desk carry. Far from expiry it is θ_year / 252 to the digit.
    W5 one parity forward: the Weigher's chain forward is readGreek's parityMedian, read once and handed to every row.
    W6 with the forward in, the greek is read at the average of the call's and the put's IVs (the comment said one IV).
    W8 the density's implied − forecast reads the first expiry a session out, against the forecast's median, said so.
    W10 a contract's previous close is the session before today's: holidays skipped as well as weekends.
  Run:  npx tsx scripts/weigher-audit-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGreek, parityMedian, parityMedianRead, thetaOver, type ChainPair } from '../src/core/readGreek';
import { readContract } from '../src/data/weigherGate';
import { blackScholesPrice } from '../src/core/greeks';
import { setDayRates } from '../src/core/carry';
import { nyInstant } from '../src/data/paper/clock';
import { priorSessionYmd } from '../src/data/weigherDesk';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, e = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= e;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* the fixing published by Nov 4 and by Dec 1 (core/carry rateOn reads the day before's) */
setDayRates([{ day: '2026-11-03', r: 0.0397 }, { day: '2026-11-30', r: 0.0397 }]);

/* ---- W4: theta capped at the extrinsic inside the last session ---- */
{
  /* SPY 767C expiring 2026-11-04, read at 14:00 with two hours left: bid 2.05, ask 2.09, the stock at 768.02 */
  const at = nyInstant('2026-11-04', 14 * 60);
  const g = readGreek({ right: 'C', strike: 767, expiry: '2026-11-04', at, option: { bid: 2.05, ask: 2.09, at }, stock: { price: 768.02, at } });
  if (!g.ok) check('the 0DTE read solves', false, g.why);
  else {
    const price = blackScholesPrice(g.spot, 767, g.t, g.iv, 'C', g.r, g.q);
    const extrinsic = price - (g.spot - 767);
    /* θ_year itself: uncapped, thetaSession is θ_year × t here (t under 1/252) */
    const raw = g.thetaSession / Math.min(g.t, 1 / 252);
    check(`0DTE, two hours left: theta per session ${(g.thetaSession * 100).toFixed(2)} $/contract, never past the extrinsic −${(extrinsic * 100).toFixed(2)} (θ_year/252 would read ${((raw / 252) * 100).toFixed(0)})`, g.thetaSession < 0 && g.thetaSession >= -extrinsic - 1e-12 && raw / 252 < -extrinsic, `${g.thetaSession} vs −${extrinsic}`);
    check('…and per calendar day and hour the same cap (the day is the whole extrinsic too, the hour less)', g.thetaDay >= -extrinsic - 1e-12 && g.thetaHour > g.thetaDay && g.thetaHour < 0);
    const row = readContract({ ticker: 'SPY', spot: 768.02, strike: 767, right: 'C', bid: 2.05, ask: 2.09, expiryIso: '2026-11-04', now: at, optionAt: at, stockAt: at });
    check(`the Weigher's row carries the same theta (${row?.theta.toFixed(4)}) — its Decay/sess column is |θ| × 100`, !!row && near(row.theta, g.thetaSession, 1e-12) && near(row.thetaHour, g.thetaHour, 1e-12));
  }
  /* far from expiry nothing changes: 30 days out it is θ_year / 252 */
  const far = nyInstant('2026-12-01', 11 * 60);
  const f = readGreek({ right: 'P', strike: 680, expiry: '2026-12-31', at: far, option: { bid: 9.8, ask: 10.0, at: far }, stock: { price: 690, at: far } });
  check('a month out the cap does not bite: theta per session is θ_year / 252, per day θ_year / 365', f.ok && near(f.thetaSession * 252, f.thetaDay * 365, 1e-12) && near(f.thetaHour, f.thetaDay / 24, 1e-12));
  check('thetaOver: a long\'s loss is θ_year × the time left, at most its extrinsic; a gain is never capped', thetaOver(-100, 0.001, 1 / 252, 2, 1) === -0.1 && thetaOver(-1000, 0.003, 1 / 252, 2, 1) === -1 && thetaOver(5, 0.01, 1 / 252, 2, 1) === 5 / 252);
  const grid = readFileSync(join(root, 'src/components/weigher/ChainGrid.tsx'), 'utf8');
  check('ChainGrid\'s Decay/sess is the row\'s theta × 100 (the capped figure), not a figure of its own', /key: 'decay'[^\n]*Math\.abs\(c\.theta \* 100\)/.test(grid));
}

/* ---- W5 and W6: one forward, and the IV the greek is read at ---- */
{
  const at = nyInstant('2026-11-04', 15 * 60 + 30);
  const S = 767.9;
  /* a chain whose strikes each imply a slightly different forward (as a real one does): calls and puts priced off a
     forward that drifts by strike, so the median F is the middle strike's and the call's and put's IVs part elsewhere */
  const t = (Date.parse('2026-11-06T21:00:00Z') - at) / (365 * 86_400_000);
  const pairs: ChainPair[] = [];
  for (let k = 755; k <= 780; k += 5) {
    const Fk = S * Math.exp(0.0397 * t) + (k - 767.5) * 0.004;
    const df = Math.exp(-0.0397 * t);
    const c = blackScholesPrice(Fk * df, k, t, 0.16, 'C', 0, 0);
    const p = c - df * (Fk - k);
    pairs.push({ strike: k, callBid: c - 0.02, callAsk: c + 0.02, putBid: p - 0.02, putAsk: p + 0.02 });
  }
  const read = parityMedianRead(pairs, S, 0.0397, t);
  check(`parityMedianRead is parityMedian with what stands behind it: F ${read?.F.toFixed(4)} off ${read?.n} strikes (${read?.lo.toFixed(3)}–${read?.hi.toFixed(3)})`, !!read && read.F === parityMedian(pairs, S, 0.0397, t) && read.n === 6 && read.lo <= read.F && read.F <= read.hi);
  const p760 = pairs.find(p => p.strike === 760)!;
  const viaChain = readGreek({ right: 'C', strike: 760, expiry: '2026-11-06', at, option: { bid: p760.callBid, ask: p760.callAsk, at }, other: { bid: p760.putBid, ask: p760.putAsk, at }, stock: { price: S, at }, chain: pairs });
  const viaForward = readGreek({ right: 'C', strike: 760, expiry: '2026-11-06', at, option: { bid: p760.callBid, ask: p760.callAsk, at }, other: { bid: p760.putBid, ask: p760.putAsk, at }, stock: { price: S, at }, forward: read?.F ?? null });
  check('a row handed the chain\'s forward prices exactly as one that reads it from the chain (one F for every row)', viaChain.ok && viaForward.ok && viaChain.forward === viaForward.forward && near(viaChain.delta, viaForward.delta, 1e-15) && near(viaChain.iv, viaForward.iv, 1e-15));
  check(`W6: with the forward in, the IV is the call's and the put's averaged (${viaChain.ok ? `${(viaChain.callIv! * 100).toFixed(3)}% and ${(viaChain.putIv! * 100).toFixed(3)}% → ${(viaChain.iv * 100).toFixed(3)}%` : '—'}), not one IV both land on`, viaChain.ok && viaChain.callIv != null && viaChain.putIv != null && Math.abs(viaChain.callIv - viaChain.putIv) > 1e-4 && near(viaChain.iv, (viaChain.callIv + viaChain.putIv) / 2, 1e-15));
  const desk = readFileSync(join(root, 'src/data/weigherDesk.ts'), 'utf8');
  check('the Weigher\'s chain forward is parityMedianRead, handed to every row (not parityForward\'s own four strikes)', /parityMedianRead\(chainPairs/.test(desk) && /forward: forward\?\.F \?\? null/.test(desk) && !/parityForward\(/.test(desk));
  const doc = readFileSync(join(root, 'src/core/readGreek.ts'), 'utf8');
  check('readGreek\'s header says the IVs are averaged, not that both sides land on one IV', !/land on one IV/.test(doc) && /AVERAGE/.test(doc));
}

/* ---- W8: implied − forecast reads the next session's implied against the forecast's median ---- */
{
  const src = readFileSync(join(root, 'src/components/weigher/ExpiryDensity.tsx'), 'utf8');
  const spread = /const spread = ([^\n]*);/.exec(src)?.[1] ?? '';
  check('the density\'s implied − forecast is useImplied (the first expiry a session out), not the chosen expiry\'s ATM vol', /useImplied\(ticker\)/.test(src) && /implied\.trading - outlook\.forecast/.test(spread) && !/atmVol/.test(spread), spread);
  check('…and says the forecast is the model\'s median', /forecast&rsquo;s median/.test(src));
}

/* ---- W10: the previous close skips holidays as well as weekends ---- */
{
  const at = (day: string) => nyInstant(day, 12 * 60);
  const cases: [string, string, string][] = [
    ['2026-11-27', '20261125', 'the Friday after Thanksgiving reads Wednesday (Thursday was shut)'],
    ['2027-03-29', '20270325', 'the Monday after Good Friday reads Thursday'],
    ['2026-11-09', '20261106', 'a plain Monday reads Friday'],
    ['2026-11-05', '20261104', 'a Thursday reads Wednesday'],
  ];
  for (const [day, want, words] of cases) check(`${words}: ${priorSessionYmd(at(day))}`, priorSessionYmd(at(day)) === want);
}

console.log(fail ? `\n${fail} FAILED` : '\nweigher audit proof: all checks pass');
process.exit(fail ? 1 : 0);
