/*
  Weigher density proof: data/weigherDensity.ts. Breeden–Litzenberger off a flat smile must give back Black–Scholes'
  own lognormal (bin by bin), the probabilities must sum to one and average to the forward; a put skew must fatten the
  left tail and keep the forward; a wall's touch odds are weigherGate touchChance at the smile's vol there.
  Run:  npx tsx scripts/weigher-density-proof.ts
*/
import { expiryDensity, smileOf, wallTouch } from '../src/data/weigherDensity';
import { touchChance } from '../src/data/weigherGate';
import { clockCarry } from '../src/data/weigherGate';
import { tradingYears } from '../src/core/tradingYear';
import { quotedVolPoint } from '../src/core/volClock';
import { nyWallStamp } from '../src/core/nyTime';
import { normCdf } from '../src/core/math';
import type { DeskChain, DeskContract } from '../src/data/weigherDesk';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`);
};

const NOW = nyWallStamp('2026-10-30T11:00:00.000');
const EXP = '2026-11-20';
const S = 757;
const leg = (strike: number, right: 'C' | 'P', iv: number) => ({ strike, right, iv }) as unknown as DeskContract;
const chainOf = (ivAt: (k: number) => number, from = 640, to = 880): DeskChain =>
  ({
    ticker: 'SPY',
    spot: S,
    step: 1,
    rows: Array.from({ length: to - from + 1 }, (_, i) => from + i).map(k => ({ strike: k, call: leg(k, 'C', ivAt(k)), put: leg(k, 'P', ivAt(k)) })),
    expiryIso: EXP,
    quotedAt: NOW,
    source: 'live',
  }) as unknown as DeskChain;

const t = tradingYears(EXP, NOW);
const pt = quotedVolPoint(EXP, NOW);
const carry = clockCarry('SPY', EXP, NOW);
console.log(`T = ${(t * 252).toFixed(2)} trading sessions; a quoted 15% is ${(15 * pt).toFixed(2)}% on the trading clock`);

{
  const d = expiryDensity(chainOf(() => 15), NOW)!;
  const sig = 0.15 * pt;
  const mu = Math.log(S) + (carry.r - carry.q - (sig * sig) / 2) * t;
  const cdf = (k: number) => normCdf((Math.log(k) - mu) / (sig * Math.sqrt(t)));
  let worst = 0;
  for (const b of d.bins) worst = Math.max(worst, Math.abs(b.p - (cdf(b.hi) - cdf(b.lo))));
  check('flat smile: every bin = the lognormal’s probability', worst < 2e-4, `worst |Δ| ${worst.toExponential(2)}`);
  check('flat smile: probabilities sum to 1', Math.abs(d.mass - 1) < 1e-3 && d.floored < 1e-9, `${d.mass.toFixed(5)}`);
  check('flat smile: the mean is the forward', Math.abs(d.mean / d.forward - 1) < 1e-4, `${d.mean.toFixed(3)} vs ${d.forward.toFixed(3)}`);
  const a = S * 0.98;
  const b2 = S * 1.015;
  check('flat smile: the distribution function = the lognormal’s', Math.abs(d.cdf(b2) - d.cdf(a) - (cdf(b2) - cdf(a))) < 1e-5, `${((d.cdf(b2) - d.cdf(a)) * 100).toFixed(3)}% between ${a.toFixed(1)} and ${b2.toFixed(1)}`);
  check('flat smile: ±1 standard move holds 68.3%',Math.abs(d.bandShare - 0.6827) < 0.005, `${(d.bandShare * 100).toFixed(2)}%`);
  const wall = S * Math.exp(sig * Math.sqrt(t));
  const p = wallTouch(d, 'SPY', wall, NOW);
  check('touch: = weigherGate touchChance at the smile’s vol', p === touchChance(S, wall, sig * Math.sqrt(t), (carry.r - carry.q) * t), `${(p * 100).toFixed(2)}%`);
  const down = wallTouch(d, 'SPY', S * Math.exp(-sig * Math.sqrt(t)), NOW);
  check('touch: one standard move up and down average 2·(1 − Φ(1)) = 31.7% (the carry drift tilts them apart)', p > down && Math.abs((p + down) / 2 - 2 * (1 - normCdf(1))) < 0.003, `up ${(p * 100).toFixed(2)}% down ${(down * 100).toFixed(2)}%`);
}
{
  /* an index-like put skew: half a vol point higher for every 1% below spot, with some smile */
  const flat = expiryDensity(chainOf(() => 15), NOW)!;
  const skew = expiryDensity(chainOf(k => 15 - 50 * Math.log(k / S) + 300 * Math.log(k / S) ** 2), NOW)!;
  const left = (d: typeof flat) => d.bins.filter(b => b.hi <= S * Math.exp(-2 * 0.15 * pt * Math.sqrt(t))).reduce((a, b) => a + b.p, 0);
  check('skew: the left tail is fatter than the flat smile’s', left(skew) > left(flat) * 1.2, `${(left(skew) * 100).toFixed(2)}% vs ${(left(flat) * 100).toFixed(2)}%`);
  check('skew: still sums to 1 and averages to the forward', Math.abs(skew.mass - 1) < 2e-3 && Math.abs(skew.mean / skew.forward - 1) < 5e-4, `mass ${skew.mass.toFixed(4)} mean ${skew.mean.toFixed(2)} fwd ${skew.forward.toFixed(2)} floored ${skew.floored.toExponential(1)}`);
}
{
  /* a narrow chain: the tails are the smile's extension, and the read says how much the quoted strikes cover */
  const d = expiryDensity(chainOf(() => 15, 750, 764), NOW)!;
  check('narrow chain: quoted strikes cover only part of the probability, said', d.quotedShare < 0.6 && Math.abs(d.mass - 1) < 1e-3, `${(d.quotedShare * 100).toFixed(1)}% inside 750–764`);
  check('smile: outliers dropped (one strike at 60%)', Math.abs(smileOf(chainOf(k => (k === 760 ? 60 : 15)), NOW)!.volAt(760) - 0.15 * pt) < 1e-3);
}
check('no chain, no density', expiryDensity(chainOf(() => 0), NOW) === null);

console.log(fail ? `\n${fail} FAILED` : '\nweigher density proof: all checks pass');
process.exit(fail ? 1 : 0);
