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
const gate = await import('../../src/data/weigherGate');
const { bsOnMark, yearFracLeft, WEIGHER_R } = gate;
const { blackScholesPrice } = await import('../../src/core/greeks');

/* ---- the contract, straight off the recorded vendor row ---- */
const raw = rawAnswers('terrain-2026-10-29');
const row = (raw.get('/stock/SPY/option-contracts?limit=500&expiry=2026-10-29&page=0') as Record<string, string>[]).find(r => r.option_symbol === 'SPY261029C00775000')!;
const daily = (raw.get('/stock/SPY/ohlc/1d?limit=18') as Record<string, string>[]).find(r => r.date === '2026-10-28' && r.market_time === 'r')!;
const S = Number(daily.close);
const K = 775;
const bid = Number(row.nbbo_bid);
const ask = Number(row.nbbo_ask);
expectEqual('the row: spot · bid · ask', [S, bid, ask], [772.31, 1.22, 1.27]);

/* the clock: core tradingYears — all 390 minutes of today's session, over 390 × 252 (was + 1e-6) */
const t = yearFracLeft('2026-10-29');
expectNear('years left = one session', t, 390 / (390 * 252), 1e-12);
/* holidays and early closes: Wed 2026-11-25 11:00 ET to Fri 11/27 (Thanksgiving shut, Friday closes 13:00) is
   300 + 0 + 210 = 510 trading minutes, not 1140 weekday minutes */
expectNear('Thanksgiving week: Wed 11:00 to Fri 13:00 = 510 trading minutes', yearFracLeft('2026-11-27', Date.parse('2026-11-25T16:00:00Z')) * 390 * 252, 510, 1e-9);
expectNear('YYYYMMDD reads the same', yearFracLeft('20261127', Date.parse('2026-11-25T16:00:00Z')) * 390 * 252, 510, 1e-9);

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
/* theta per trading SESSION: one session left, so the whole price goes (OTM, intrinsic 0) — not θ/365 (−0.7493) */
expectNear('theta per session = −(model price) on the last session', read.theta, -call(S, K, v), 1e-5);
expectNear('theta an hour = V(t − 60 min) − V(t)', read.thetaHour, call(S, K, v) === 0 ? 0 : (() => { const t1 = t - 60 / (390 * 252); const e1 = (Math.log(S / K) + (r + v * v / 2) * t1) / (v * Math.sqrt(t1)); return S * phiCdf(e1) - K * Math.exp(-r * t1) * phiCdf(e1 - v * Math.sqrt(t1)) - call(S, K, v); })(), 1e-5);
expectNear('finish in the money = N(d2), %', read.itm, phiCdf(d2) * 100, 1e-5);
/* breakevens: long pays the ask (775 + 1.27), short collects the bid (775 + 1.22) */
const beLong = K + ask;
const beShort = K + bid;
expectEqual('breakevens, long · short', [beLong, beShort], [776.27, 776.22]);
const mu = r - v * v / 2;
const above = (level: number) => phiCdf((Math.log(S / level) + mu * t) / (v * Math.sqrt(t)));
expectNear('profit odds long = P(S_T > 776.27), %', read.profitLong, above(beLong) * 100, 1e-5);
expectNear('profit odds short = P(S_T < 776.22), %', read.profitShort, (1 - above(beShort)) * 100, 1e-5);
/* touch: the reflection formula for an up barrier with log drift ν = r − q (the walk around the forward, no −σ²/2 —
   the same function Pinpoint's driftless touch is at ν = 0), P(max ≥ K) = N(a) + (K/S)^(2ν/σ²)·N(b),
   a = (ln(S/K) + νt)/σ√t, b = (ln(S/K) − νt)/σ√t */
const nu = r;
const a = (Math.log(S / K) + nu * t) / (v * Math.sqrt(t));
const b = (Math.log(S / K) - nu * t) / (v * Math.sqrt(t));
const touchHand = phiCdf(a) + Math.pow(K / S, (2 * nu) / (v * v)) * phiCdf(b);
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
  /* the walk the touch odds assume: log drift r − q, no −σ²/2 */
  const drift = r * dt;
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
  const m2 = r;
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

/* ---- the touch odds are one function: Pinpoint's driftless 2·(1 − Φ(z)) is touchChance at drift 0 ---- */
{
  const { touchOdds } = await import('../../src/data/expectedMove');
  for (const [s0, lv, sd] of [[600, 606, 0.012], [600, 590, 0.02], [772.31, 775, 0.0063]] as const) {
    expectNear(`touchChance(${s0} → ${lv}, σ√T ${sd}, drift 0) = expectedMove.touchOdds`, gate.touchChance(s0, lv, sd, 0), touchOdds(s0, lv, sd * s0), 1e-9);
  }
  /* known number: S 100 → 105, σ√T 0.3·√0.1, drift 0.042·0.1 (the review's case on the forward walk) */
  expectNear('touchChance(100 → 105, σ 30%, t 0.1, ν 4.2%)', gate.touchChance(100, 105, 0.3 * Math.sqrt(0.1), 0.042 * 0.1), 0.620828, 1e-5);
  expectNear('a down touch mirrors an up touch on the log scale', gate.touchChance(100, 100 / 1.05, 0.3 * Math.sqrt(0.1), -0.0042), gate.touchChance(100, 105, 0.3 * Math.sqrt(0.1), 0.0042), 1e-12);
}

/* ---- carry, the core bracket, and the American flag ---- */
{
  /* an index with a 1.3% yield: delta is e^(−qT)·N(d1), the price the core's (the old inline model dropped q) */
  const T = 30 / 252, sig = 0.18, S0 = 5800, K0 = 5850, rr = 0.042, qq = 0.013;
  const px = blackScholesPrice(S0, K0, T, sig, 'C', rr, qq);
  const rd = bsOnMark(S0, K0, 'C', px - 0.05, px + 0.05, T, { r: rr, q: qq })!;
  const dd1 = (Math.log(S0 / K0) + (rr - qq + sig * sig / 2) * T) / (sig * Math.sqrt(T));
  expectNear('carry: IV solved with the yield', rd.iv, sig * 100, 1e-6);
  expectNear('carry: delta = e^(−qT)·N(d1)', rd.delta, Math.exp(-qq * T) * phiCdf(dd1), 1e-5);
  /* the core's bracket is [1e-4, 5]: a mark that needs 600% vol is a quote problem, not a vol */
  const wild = blackScholesPrice(100, 100, 0.01, 6, 'C', 0.042, 0);
  expectEqual('a mark past 500% vol is blank', gate.solveIv(wild, 100, 100, 0.01, 'C'), null);
  expectEqual('American put in the money is flagged · European index is not · a call is not', [gate.europeanApprox('SPY', 'P', 780, 769.35), gate.europeanApprox('SPXW', 'P', 5900, 5800), gate.europeanApprox('SPY', 'C', 760, 769.35), gate.europeanApprox('AAPL', 'P', 200, 210)], [true, false, false, false]);
}

/* ---- one clock in a row: the vendor's calendar IV moved onto the trading clock, the odds priced off that same vol ---- */
{
  /* SPY 770C at 11:51:02 ET on 2026-10-29, ThetaData IV 22.09% (calendar year to 16:00) */
  const at = Date.parse('2026-10-29T15:51:02Z');
  const rd = gate.readContract({ ticker: 'SPY', spot: 769.35, strike: 770, right: 'C', bid: 1.18, ask: 1.19, expiryIso: '2026-10-29', vendorIv: 0.2209, now: at })!;
  const tCal = (16 * 60 - (11 * 60 + 51 + 2 / 60)) / (365 * 1440);
  const tTr = (16 * 60 - (11 * 60 + 51)) / (390 * 252);
  const sigTr = 0.2209 * Math.sqrt(Math.max(5, (16 * 60 - (11 * 60 + 51 + 2 / 60))) / (365 * 1440) / tTr);
  /* the rate accrues on the calendar: r·T_calendar, the variance on the trading clock */
  const d2Tr = (Math.log(769.35 / 770) + 0.042 * tCal - (sigTr * sigTr / 2) * tTr) / (sigTr * Math.sqrt(tTr));
  expectNear('one clock: IV shown is the vendor\'s quoted 22.09%', rd.iv, 22.09, 1e-9);
  expectNear('one clock: the trading-clock vol keeps the variance', (rd.ivTrading / 100) ** 2 * tTr, 0.2209 ** 2 * tCal, 1e-6);
  expectNear('one clock: finish odds = N(d2) at that vol on that clock', rd.itm, phiCdf(d2Tr) * 100, 1e-4);
  expectNear('one clock: delta within 0.001 of ThetaData\'s 0.4327', rd.delta, 0.4327, 0.001 / 0.4327);
  expectEqual('one clock: the vol came from the vendor', rd.ivFrom, 'vendor');
  /* the payoff curve prices on the same clock: at today's spot it is the row's model price */
  const price = gate.pricerFor({ ticker: 'SPY', expiryIso: '2026-10-29' }, { strike: 770, right: 'C', iv: rd.iv }, at)!;
  expectNear('pricerFor at spot = the mid (1.185) within a cent', price(769.35), 1.185, 0.01 / 1.185);
}

/* ---- the expected move: S·σ·√T on the calendar clock (core/volClock sigmaToExpiry), not σ·√(trading T) ---- */
{
  /* 0 DTE, IV 20%, S 600, 12:00 ET: 240 calendar minutes, 600·0.2·√(240/525600) = $2.564 (σ·√(trading T) gave $5.93) */
  const pct = gate.expectedMovePctOf(600, 20, '2026-10-30', Date.parse('2026-10-30T16:00:00Z'));
  expectNear('0DTE 20% IV, S 600, 12:00 → $2.564', (pct / 100) * 600, 600 * 0.2 * Math.sqrt(240 / 525600), 1e-9);
  expectEqual('… rounded', ((pct / 100) * 600).toFixed(2), '2.56');
  /* the ATM IV at spot: mean of call and put at each bracketing strike, linear in strike; row order does not matter */
  const rows = [
    { strike: 771, call: { iv: 21.72 }, put: { iv: 21.82 } },
    { strike: 760, call: { iv: 21.87 }, put: { iv: 28.12 } },
    { strike: 769, call: { iv: 22.46 }, put: { iv: 22.53 } },
    { strike: 778, call: { iv: 23.43 }, put: { iv: 28.12 } },
    { strike: 770, call: { iv: 22.09 }, put: { iv: 22.16 } },
  ];
  expectNear('ATM IV at 769.35 = 22.495 + 0.35·(22.125 − 22.495)', gate.atmIvAt(rows, 769.35), 22.495 + 0.35 * (22.125 - 22.495), 1e-9);
  expectNear('ATM IV on a strike = that strike\'s mean', gate.atmIvAt(rows, 770), 22.125, 1e-9);
  expectNear('ATM IV with one side only', gate.atmIvAt([{ strike: 770, call: { iv: NaN }, put: { iv: 22.16 } }, { strike: 771, call: { iv: 21.72 }, put: { iv: NaN } }], 770.5), (22.16 + 21.72) / 2, 1e-9);
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

/* ---- the chain's ATM IV, expected move and greeks on the recorded snapshot's own clock ---- */
if (existsSync(thetaDir) && readdirSync(thetaDir).some(f => f.endsWith('.json.gz')) && !RECORD) {
  /* the snapshot's quotes are stamped 11:51:02 ET (S 769.35): read the chain at that instant */
  freezeClock('2026-10-29T15:51:02.440Z');
  const { loadLiveChain } = await import('../../src/data/weigherDesk');
  const chain = await loadLiveChain('SPY', 0, 12, 'SPY');
  const at = (k: number) => chain.rows.find(r => r.strike === k)!;
  expectEqual('snapshot spot', chain.spot, 769.35);
  /* ThetaData 769C/P 22.46/22.53, 770C/P 22.09/22.16: 22.495 + 0.35·(22.125 − 22.495) = 22.3655 (the old pick was
     whichever row the answer listed in the middle) */
  expectNear('chain ATM IV at spot, interpolated', chain.atmIv ?? NaN, 22.37, 1e-9);
  /* S·σ·√T_calendar: 248.96 calendar minutes to 16:00 → 769.35 × 0.223655 × √(248.96/525600) = $3.745 = 0.49%
     (σ·√(trading T) gave 1.12%) */
  const tCal = (16 * 60 - (11 * 60 + 51 + 2.44 / 60)) / 525600;
  expectNear('chain expected move = S·σ_ATM·√T_calendar, %', chain.expectedMovePct, Number((0.223655 * Math.sqrt(tCal) * 100).toFixed(2)), 1e-9);
  /* the row's delta off the vendor's IV on the trading clock (calendar-accrued carry) agrees with ThetaData's own */
  for (const [k, side, want] of [[769, 'call', 0.5395], [770, 'put', -0.567], [772, 'call', 0.2334]] as const) {
    const c = at(k)[side];
    expectNear(`chain ${k}${side === 'call' ? 'C' : 'P'} delta vs ThetaData ${want}`, c.delta, want, 0.0015 / Math.abs(want));
    expectEqual(`chain ${k}${side === 'call' ? 'C' : 'P'} IV is the vendor's`, c.ivFrom, 'vendor');
  }
  /* theta per session inside the last session: minus the whole extrinsic (model price at the vendor IV, intrinsic 0) */
  const c770 = at(770).call;
  expectEqual('770C theta is minus its extrinsic, within a cent of the mid', Math.abs(c770.theta + c770.mark) < 0.01, true);
  expectEqual('American put in the money is flagged (778P), not the 760P', [at(778).put.europeanApprox, at(760).put.europeanApprox], [true, false]);

  /* ThetaData's implied_vol is a fraction, always: a 3.2 is 320%, not 3.2% (a synthetic next-day chain, rows out of order) */
  const { expiryFor, isoDate } = await import('../../src/core/calendar');
  const nextIso = isoDate(expiryFor(1).date);
  const nextYmd = nextIso.replace(/-/g, '');
  const leg = (strike: number, right: 'CALL' | 'PUT', iv: number, bid: number, ask: number) => ({
    contract: { expiration: nextIso, symbol: 'SPY', strike, right },
    data: [{ underlying_price: 601, implied_vol: iv, delta: 0, bid, ask, timestamp: '2026-10-29T11:51:02.000', underlying_timestamp: '2026-10-29T11:51:02.000' }],
  });
  const synthetic = [
    leg(605, 'CALL', 0.19, 3.1, 3.2), leg(560, 'PUT', 3.2, 0.02, 0.03), leg(600, 'PUT', 0.21, 4.4, 4.5), leg(595, 'CALL', 0.215, 8.4, 8.5),
    leg(600, 'CALL', 0.2, 5.3, 5.4), leg(610, 'CALL', 0.185, 1.5, 1.6), leg(605, 'PUT', 0.2, 7.2, 7.3), leg(595, 'PUT', 0.22, 2.9, 3.0),
  ];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/theta/option/snapshot/') && url.includes(`expiration=${nextYmd}`)) {
      const body = url.includes('/greeks/') ? { response: synthetic } : { response: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  }) as typeof fetch;
  const next = await loadLiveChain('SPY', 1, 12, 'SPY');
  globalThis.fetch = real;
  expectEqual('synthetic chain read', [next.expiryIso, next.spot, next.rows.length], [nextIso, 601, 5]);
  expectNear('a vendor IV of 3.2 reads 320%', next.rows.find(r => r.strike === 560)!.put.iv, 320, 1e-9);
  /* 600: (20 + 21)/2 = 20.5, 605: (19 + 20)/2 = 19.5, at 601: 20.5 − 0.2 = 20.3 (the old middle-of-the-list pick read 20) */
  expectNear('synthetic ATM IV at 601 = 20.30', next.atmIv ?? NaN, 20.3, 1e-9);
  const { sigmaToExpiry } = await import('../../src/core/volClock');
  expectNear('synthetic expected move = sigmaToExpiry / S', next.expectedMovePct, Number((((sigmaToExpiry(601, 0.203, nextIso) ?? 0) / 601) * 100).toFixed(2)), 1e-9);
}

done();
