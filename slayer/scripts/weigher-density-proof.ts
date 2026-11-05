/*
  Weigher density proof: data/weigherDensity.ts. Breeden–Litzenberger off a flat smile must give back Black–Scholes'
  own lognormal (bin by bin), the probabilities must sum to one and average to the forward; a put skew must fatten the
  left tail and keep the forward; a wall's touch odds are weigherGate touchChance at the smile's vol there.
  Run:  npx tsx scripts/weigher-density-proof.ts
*/
import { expiryDensity, smileOf, wallTouch } from '../src/data/weigherDensity';
import { modelAt, touchChance } from '../src/data/weigherGate';
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
  /* corrected (audit W1): this once held wallTouch to touchChance with the drift (r − q)·T — the very call it makes, so it
     could not fail, and that drift is the price's, not the log price's: the walk's own drift is (r − q − σ²/2)·T. Now
     the touch is held to a Monte Carlo of the walk itself (below), and here to the reflection formula with that drift. */
  check('touch: the reflection formula at the smile’s vol with the log drift (r − q − σ²/2)·T', Math.abs(p - touchChance(S, wall, sig * Math.sqrt(t), (carry.r - carry.q - (sig * sig) / 2) * t)) < 1e-12, `${(p * 100).toFixed(2)}%`);
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

/* ---- the touch odds against a Monte Carlo of the walk itself (audit W1) ----
   dX = (r − q − σ²/2)dt + σdW in log price, touched when X crosses ln(B/S). Each step's crossing between its two ends is
   the Brownian bridge's exp(−2(b − x0)(b − x1)/(σ²dt)) — exact for continuous watching, so 60 steps lose nothing. A
   seeded generator (mulberry32), so the run is the same every time; tolerance four standard errors. */
{
  const mulberry = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const mcTouch = (s0: number, barrier: number, sig: number, T: number, r: number, q: number, n = 200_000, steps = 60, seed = 7) => {
    const u = mulberry(seed);
    const b = Math.log(barrier / s0);
    const up = barrier > s0;
    const dt = T / steps;
    const mu = (r - q - (sig * sig) / 2) * dt;
    const sd = sig * Math.sqrt(dt);
    let hit = 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let k = 0; k < steps; k++) {
        let a = u();
        while (a === 0) a = u();
        const z = Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
        const x1 = x + mu + sd * z;
        if (up ? x1 >= b : x1 <= b) {
          hit++;
          break;
        }
        if (u() < Math.exp((-2 * (b - x) * (b - x1)) / (sig * sig * dt))) {
          hit++;
          break;
        }
        x = x1;
      }
    }
    return hit / n;
  };
  const se = (p: number, n = 200_000) => Math.sqrt((p * (1 - p)) / n);
  /* the audit's cases through the chain's own model (modelAt: a call touches upward, a put downward) */
  for (const [s0, k, sig, T, r, right] of [[100, 130, 0.6, 0.25, 0.04, 'C'], [100, 70, 0.8, 0.5, 0.04, 'P'], [757, 800, 0.15, 30 / 365, 0.04, 'C']] as const) {
    const got = modelAt(s0, k, right, 1, 1.1, T, sig, { r, q: 0 })!.touch / 100;
    const mc = mcTouch(s0, k, sig, T, r, 0);
    const old = touchChance(s0, k, sig * Math.sqrt(T), r * T);
    check(`touch ${s0}→${k}, σ ${sig * 100}%, T ${T.toFixed(3)}: the model ${(got * 100).toFixed(2)}% = Monte Carlo ${(mc * 100).toFixed(2)}% ± ${(4 * se(mc) * 100).toFixed(2)} (the price-drift formula read ${(old * 100).toFixed(2)}%)`, Math.abs(got - mc) <= 4 * se(mc), `${got} vs ${mc}`);
  }
  /* and the Weigher's wall read, on a 60% smile over the proof's expiry */
  const d = expiryDensity(chainOf(() => 60), NOW)!;
  const sig = 0.6 * pt;
  const wall = S * Math.exp(1.2 * sig * Math.sqrt(t));
  const got = wallTouch(d, 'SPY', wall, NOW);
  const mc = mcTouch(S, wall, d.volAt(wall), t, carry.r, carry.q);
  check(`wall touch on a 60% smile: ${(got * 100).toFixed(2)}% = Monte Carlo ${(mc * 100).toFixed(2)}% ± ${(4 * se(mc) * 100).toFixed(2)}`, Math.abs(got - mc) <= 4 * se(mc), `${got} vs ${mc}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nweigher density proof: all checks pass');
process.exit(fail ? 1 : 0);
