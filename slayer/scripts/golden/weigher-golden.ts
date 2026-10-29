/*
  The Weigher's contract math (data/weigherGate.ts) on a real contract, and its chain reader on ThetaData's answers.
  - On SPY 2026-10-29 775C as recorded in terrain-2026-10-29 (bid 1.22, ask 1.27; SPY's Oct 28 regular close 772.31;
    the clock pinned to 07:36:50 ET on Oct 29): the session clock, the IV solved off the mid, the greeks, the touch
    odds, both breakevens and both profit odds, each recomputed here with this file's own arithmetic.
  - The touch formula against a Monte Carlo walk (S 100, barrier 105, σ 30%, t 0.1): the review's case.
  - weigher-theta-2026-10-29 (ThetaData, recorded where the terminal answers): the chain built by loadLiveChain from
    the recorded greeks and NBBO snapshots. Skipped, and said so, until that set exists.

  Replay: npx tsx scripts/golden/weigher-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/weigher-golden.ts   (only the ThetaData set records, and only when the terminal answers)
*/
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures } from './uwFixtures';
import { phiCdf, rawAnswers } from './pinpointRaw';

const RECORD = process.env.GOLDEN_RECORD === '1';
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/weigher', href: 'http://127.0.0.1/weigher', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
const mem = new Map<string, string>();
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

/* the recorded instant of the contract's row: 07:36:50 ET, before the open, the 0 DTE's whole session still ahead */
freezeClock('2026-10-29T11:36:50.238Z');
const { bsOnMark, yearFracLeft, WEIGHER_R } = await import('../../src/data/weigherGate');

/* ---- the contract, straight off the recorded vendor row ---- */
const raw = rawAnswers('terrain-2026-10-29');
const row = (raw.get('/stock/SPY/option-contracts?limit=500&expiry=2026-10-29&page=0') as Record<string, string>[]).find(r => r.option_symbol === 'SPY261029C00775000')!;
const daily = (raw.get('/stock/SPY/ohlc/1d?limit=18') as Record<string, string>[]).find(r => r.date === '2026-10-28' && r.market_time === 'r')!;
const S = Number(daily.close);
const K = 775;
const bid = Number(row.nbbo_bid);
const ask = Number(row.nbbo_ask);
expectEqual('the row: spot · bid · ask', [S, bid, ask], [772.31, 1.22, 1.27]);

/* the clock: 0 weekdays ahead and all 390 minutes of today's session, over 390 × 252, plus 1e-6 */
const t = yearFracLeft('2026-10-29');
expectNear('years left = one session', t, 390 / (390 * 252) + 1e-6, 1e-12);

/* this file's own Black-Scholes (r 4.2%, no dividend), and the vol off the mid by Newton's method */
const r = WEIGHER_R;
const pdf = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
const d1Of = (s: number, k: number, v: number) => (Math.log(s / k) + (r + v * v / 2) * t) / (v * Math.sqrt(t));
const call = (s: number, k: number, v: number) => { const d1 = d1Of(s, k, v); return s * phiCdf(d1) - k * Math.exp(-r * t) * phiCdf(d1 - v * Math.sqrt(t)); };
const mid = (bid + ask) / 2;
let v = 0.2;
for (let i = 0; i < 50; i++) v -= (call(S, K, v) - mid) / (S * pdf(d1Of(S, K, v)) * Math.sqrt(t));
const d1 = d1Of(S, K, v);
const d2 = d1 - v * Math.sqrt(t);

const read = bsOnMark(S, K, 'C', bid, ask, t)!;
/* tolerance 1e-5 relative: the app's normal CDF (core/math) and this file's (pinpointRaw phiCdf) are two approximations
   that differ near 1e-7, which the solved vol carries into its fifth digit */
expectNear('IV off the mid, %', read.iv, v * 100, 1e-5);
expectNear('delta = N(d1)', read.delta, phiCdf(d1), 1e-5);
expectNear('gamma = φ(d1)/(Sσ√t)', read.gamma, pdf(d1) / (S * v * Math.sqrt(t)), 1e-5);
expectNear('vega per vol point', read.vega, (S * Math.sqrt(t) * pdf(d1)) / 100, 1e-5);
expectNear('theta per calendar day', read.theta, (-(S * pdf(d1) * v) / (2 * Math.sqrt(t)) - r * K * Math.exp(-r * t) * phiCdf(d2)) / 365, 1e-5);
expectNear('finish in the money = N(d2), %', read.itm, phiCdf(d2) * 100, 1e-5);
/* breakevens: long pays the ask (775 + 1.27), short collects the bid (775 + 1.22) */
const beLong = K + ask;
const beShort = K + bid;
expectEqual('breakevens, long · short', [beLong, beShort], [776.27, 776.22]);
const mu = r - v * v / 2;
const above = (level: number) => phiCdf((Math.log(S / level) + mu * t) / (v * Math.sqrt(t)));
expectNear('profit odds long = P(S_T > 776.27), %', read.profitLong, above(beLong) * 100, 1e-5);
expectNear('profit odds short = P(S_T < 776.22), %', read.profitShort, (1 - above(beShort)) * 100, 1e-5);
/* touch: the reflection formula for an up barrier, P(max ≥ K) = N(a) + (K/S)^(2μ/σ²)·N(b), a = (ln(S/K) + μt)/σ√t, b = (ln(S/K) − μt)/σ√t */
const a = (Math.log(S / K) + mu * t) / (v * Math.sqrt(t));
const b = (Math.log(S / K) - mu * t) / (v * Math.sqrt(t));
const touchHand = phiCdf(a) + Math.pow(K / S, (2 * mu) / (v * v)) * phiCdf(b);
expectNear('touch odds, %', read.touch, touchHand * 100, 1e-5);
/* pinned: what the card shows for this contract */
expectEqual('pinned: IV · delta · touch · profit long (rounded)', [read.iv.toFixed(2), read.delta.toFixed(3), read.touch.toFixed(1), read.profitLong.toFixed(1)], [(v * 100).toFixed(2), phiCdf(d1).toFixed(3), (touchHand * 100).toFixed(1), (above(beLong) * 100).toFixed(1)]);
console.log(`  (775C by hand: IV ${(v * 100).toFixed(3)}%, delta ${phiCdf(d1).toFixed(4)}, touch ${(touchHand * 100).toFixed(2)}%, finish ITM ${(phiCdf(d2) * 100).toFixed(2)}%, profit long ${(above(beLong) * 100).toFixed(2)}%)`);
expectEqual('touch odds are never below the finish odds', read.touch >= read.itm, true);

/* ---- the terminal's greek units, read off the chain (weigherDesk.unitScale) ---- */
{
  const { unitScale } = await import('../../src/data/weigherDesk');
  /* the 775C's theta per calendar day (−0.7493) and two neighbours', as an annual feed would print them (× 365), and
     with the other model's clock putting each 10–30% off */
  const day = [read.theta, -0.61, -0.42];
  expectEqual('theta printed per year reads as ÷ 365', unitScale(day.map((d, i) => [d * 365 * [1, 1.12, 0.8][i], d] as const)), 365);
  expectEqual('theta printed per day reads as ÷ 1', unitScale(day.map((d, i) => [d * [1, 1.25, 0.9][i], d] as const)), 1);
  /* vega per 1.00 of vol (the docs' "divide by 100") against the 775C's 0.1762 per vol point */
  const vega = [read.vega, 0.15, 0.11];
  expectEqual('vega per 1.00 of vol reads as ÷ 100', unitScale(vega.map(v => [v * 100, v] as const)), 100);
  expectEqual('no agreement, no scale (the mark\'s own greek stays)', unitScale([[5, 1], [40, 1], [700, 1]]), null);
  expectEqual('fewer than three rows, no scale', unitScale([[365, 1], [365, 1]]), null);
}

/* ---- the touch formula against a Monte Carlo walk ---- */
{
  const S0 = 100, B = 105, sig = 0.3, T = 0.1;
  const steps = 2000;
  const paths = 20000;
  /* mulberry32, seeded, so the walk is the same on every run */
  let seed = 12345;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const dt = T / steps;
  const drift = (r - sig * sig / 2) * dt;
  const vol = sig * Math.sqrt(dt);
  let hit = 0;
  for (let p = 0; p < paths; p++) {
    let x = Math.log(S0);
    const lb = Math.log(B);
    for (let i = 0; i < steps; i++) {
      x += drift + vol * gauss();
      if (x >= lb) { hit++; break; }
    }
  }
  const mc = hit / paths;
  const m2 = r - sig * sig / 2;
  const s = sig * Math.sqrt(T);
  const formula = phiCdf((Math.log(S0 / B) + m2 * T) / s) + Math.pow(B / S0, (2 * m2) / (sig * sig)) * phiCdf((Math.log(S0 / B) - m2 * T) / s);
  /* the app's touch for a 105 call priced at exactly 30% vol */
  const price = (() => { const tt = T; const dd1 = (Math.log(S0 / B) + (r + sig * sig / 2) * tt) / s; return S0 * phiCdf(dd1) - B * Math.exp(-r * tt) * phiCdf(dd1 - s); })();
  const app = bsOnMark(S0, B, 'C', price, price, T)!;
  expectNear('app touch = reflection formula at σ 30%, t 0.1', app.touch / 100, formula, 1e-5);
  /* a discrete walk misses touches between steps, so it reads a little low: within 2 points */
  expectNear(`Monte Carlo (${paths} paths × ${steps} steps) reads ${(mc * 100).toFixed(1)}%`, mc, formula, 0.02 / formula);
  console.log(`  (S 100 → 105, σ 30%, t 0.1: formula ${(formula * 100).toFixed(2)}%, Monte Carlo ${(mc * 100).toFixed(2)}%)`);
}

/* ---- the chain off ThetaData's snapshots, when recorded ---- */
const THETA_SET = 'weigher-theta-2026-10-29';
const thetaDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', THETA_SET);
if (!(existsSync(thetaDir) && readdirSync(thetaDir).some(f => f.endsWith('.json.gz'))) && !RECORD) {
  console.log(`SKIP  ${THETA_SET} is not recorded: run GOLDEN_RECORD=1 npx tsx scripts/golden/weigher-golden.ts where the ThetaData terminal answers`);
} else {
  installUwFixtures(THETA_SET);
  const { openFeeds } = await import('../../src/data/feedGate');
  openFeeds();
  const { loadLiveChain } = await import('../../src/data/weigherDesk');
  const chain = await loadLiveChain('SPY', 0, 12, 'SPY');
  if (chain.offline || !chain.rows.length) {
    if (RECORD) rmSync(thetaDir, { recursive: true, force: true });
    console.log(`SKIP  ThetaData did not answer; ${THETA_SET} not checked`);
  } else {
    expectEqual('ThetaData chain: up to 25 strikes', chain.rows.length <= 25 && chain.rows.length > 0, true);
    for (const rr of chain.rows) {
      const c = rr.call;
      if (!(c.bid >= 0 && c.ask > c.bid)) continue;
      expectNear(`ThetaData chain ${rr.strike}C: mark = NBBO mid`, c.mark, Number(((c.bid + c.ask) / 2).toFixed(2)), 1e-9);
      expectNear(`ThetaData chain ${rr.strike}C: breakeven = strike + ask`, c.breakeven, Number((rr.strike + c.ask).toFixed(2)), 1e-9);
    }
  }
}

done();
