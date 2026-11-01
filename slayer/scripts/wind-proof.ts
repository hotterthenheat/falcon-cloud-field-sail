/*
  The wind field's proof (ported from Noah's fork, adapted to our inputs). Holds core/windField.ts and
  data/windInputs.ts to their promises on a staged book and clock:
    1. every bending weight at zero, the flat shape, no drift: the field IS the cone — its band and touch odds match the
       lognormal walk's analytic figures at the cone's σ to the close, and the band at the close is that σ;
    2. the U-shaped session carries the same variance over the minutes left: the band at the close is the cone's;
    3. the draws are seeded from (symbol, session date, minute): the same three draw the same field, another minute,
       name or day another;
    4. short gamma widens the band, long gamma narrows it, momentum under short gamma fattens the tails;
    5. the pin pulls the median toward the heaviest same-day strike and raises the odds of closing there;
    6. the carry drifts the paths: a positive rate less yield lifts the median by the carry over the minutes left;
    7. the clock is the session module's: 11:30 on a full day leaves 270 minutes, 11:30 on an early close 90, nothing
       before the open, after the bell or on a holiday; the realised blend reads today's closes;
    8. the book's kept sign is turned to the dealer sign, and the same-day open interest lands on its strikes;
    9. a resting run fits the worker's budget.
  Run: npx tsx scripts/wind-proof.ts
*/
import { coneBand, coneTouch, KAPPA_CONE, realisedSigmaDay, runWind, windSeed, type WindInputs, type WindStrike } from '../src/core/windField';
import { windClock, windInputsFor } from '../src/data/windInputs';
import { nyInstant, REGULAR_OPEN_MIN } from '../src/core/session';

const misses: string[] = [];
let held = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) held++;
  else misses.push(what);
};
const fmt = (v: number) => v.toFixed(3);

/* a book of 41 strikes a dollar apart around 500 (dealer sign): long gamma above spot, short below, same-day OI at 505 */
const book = (sign: 'mixed' | 'long' | 'short'): WindStrike[] =>
  Array.from({ length: 41 }, (_, i) => {
    const strike = 480 + i;
    const size = 400e6 * Math.exp(-Math.abs(strike - 500) / 6);
    const net = sign === 'long' ? size : sign === 'short' ? -size : strike >= 500 ? size : -size;
    return { strike, netGex: net, sameDayOI: strike === 505 ? 120000 : 8000 };
  });

const LEN = 390;
const LEFT = 270;
const SIGMA_LEFT = 0.01 * Math.sqrt(LEFT / LEN);
const base: WindInputs = {
  spot: 500,
  minutesLeft: LEFT,
  elapsedMin: LEN - LEFT,
  sessionLen: LEN,
  sigmaLeft: SIGMA_LEFT,
  strikes: book('mixed'),
  levels: [
    { key: 'up1', price: 503 },
    { key: 'dn1', price: 497 },
    { key: 'up2', price: 507 },
  ],
  paths: 6000,
  seed: 7,
};
const flat = { ...base, kappa: KAPPA_CONE, shape: 'flat' as const, pin: null };

/* 1. the cone */
const cone = runWind(flat);
ok(cone.quantiles.length === LEFT, `the field runs ${cone.quantiles.length} minutes, the clock has ${LEFT}`);
ok(Math.abs(cone.sigmaMin * Math.sqrt(LEFT) - SIGMA_LEFT) < 1e-12, `the per-minute σ is the cone's σ to the close over the minutes left`);
for (const q of cone.quantiles.filter(q => q.ahead % 30 === 0 || q.ahead === LEFT)) {
  const a = coneBand(base.spot, cone.sigmaMin, q.ahead);
  const s = base.spot * cone.sigmaMin * Math.sqrt(q.ahead);
  ok(Math.abs(q.mid - a.mid) <= 0.05 * s, `cone median +${q.ahead}: ${fmt(q.mid)} vs ${fmt(a.mid)}`);
  ok(Math.abs(q.lo1 - a.lo1) <= 0.08 * s && Math.abs(q.hi1 - a.hi1) <= 0.08 * s, `cone 1σ band +${q.ahead}: ${fmt(q.lo1)}..${fmt(q.hi1)} vs ${fmt(a.lo1)}..${fmt(a.hi1)}`);
  ok(Math.abs(q.lo2 - a.lo2) <= 0.16 * s && Math.abs(q.hi2 - a.hi2) <= 0.16 * s, `cone 2σ band +${q.ahead}: ${fmt(q.lo2)}..${fmt(q.hi2)} vs ${fmt(a.lo2)}..${fmt(a.hi2)}`);
}
for (const l of base.levels) {
  const want = coneTouch(base.spot, cone.sigmaMin, LEFT, l.price);
  ok(Math.abs(cone.touch[l.key] - want) <= 0.03, `cone touch odds ${l.key}: ${fmt(cone.touch[l.key])} vs ${fmt(want)}`);
}
ok(cone.pin == null, 'the cone pulls toward nothing');

/* 2. the U-shape */
const shaped = runWind({ ...flat, shape: 'u' });
{
  const qf = cone.quantiles[LEFT - 1];
  const qu = shaped.quantiles[LEFT - 1];
  const s = base.spot * SIGMA_LEFT;
  ok(Math.abs(qu.hi1 - qf.hi1) <= 0.12 * s && Math.abs(qu.lo1 - qf.lo1) <= 0.12 * s, `the U band at the close ${fmt(qu.lo1)}..${fmt(qu.hi1)} is the flat ${fmt(qf.lo1)}..${fmt(qf.hi1)}`);
  const k = LEFT - 31;
  const du = shaped.quantiles[LEFT - 1].hi1 - shaped.quantiles[k].hi1;
  const df = cone.quantiles[LEFT - 1].hi1 - cone.quantiles[k].hi1;
  ok(du > df, `the last half hour adds more band under the U (${fmt(du)}) than flat (${fmt(df)})`);
}

/* 3. the seed */
const again = runWind(flat);
ok(again.density.cells.every((v, i) => v === cone.density.cells[i]), 'the same seed draws the same field');
ok(runWind({ ...flat, seed: 8 }).density.cells.some((v, i) => v !== cone.density.cells[i]), 'another seed draws another field');
ok(windSeed('SPY', '2026-11-02', 690) === windSeed('spy ', '2026-11-02', 690.4), 'the seed is the symbol, the day and the minute');
ok(new Set([windSeed('SPY', '2026-11-02', 690), windSeed('SPY', '2026-11-02', 691), windSeed('QQQ', '2026-11-02', 690), windSeed('SPY', '2026-11-03', 690)]).size === 4, 'another minute, name or day seeds another field');

/* 4. the gamma terms */
{
  const c = cone.quantiles[LEFT - 1];
  const w = runWind({ ...flat, strikes: book('short'), kappa: { sigma: 0.35, momentum: 0, pin: 0 } }).quantiles[LEFT - 1];
  const t = runWind({ ...flat, strikes: book('long'), kappa: { sigma: 0.35, momentum: 0, pin: 0 } }).quantiles[LEFT - 1];
  ok(w.hi1 - w.lo1 > (c.hi1 - c.lo1) * 1.1, `short gamma widens the band: ${fmt(w.hi1 - w.lo1)} vs ${fmt(c.hi1 - c.lo1)}`);
  ok(t.hi1 - t.lo1 < (c.hi1 - c.lo1) * 0.9, `long gamma narrows the band: ${fmt(t.hi1 - t.lo1)} vs ${fmt(c.hi1 - c.lo1)}`);
  const m = runWind({ ...flat, strikes: book('short'), kappa: { sigma: 0, momentum: 0.3, pin: 0 } }).quantiles[LEFT - 1];
  ok(m.hi2 - m.lo2 > (c.hi2 - c.lo2) * 1.05, `momentum under short gamma fattens the tails: ${fmt(m.hi2 - m.lo2)} vs ${fmt(c.hi2 - c.lo2)}`);
}

/* 5. the pin */
{
  const levels = [...base.levels, { key: 'pin', price: 505 }];
  const pinned = runWind({ ...base, kappa: { sigma: 0, momentum: 0, pin: 0.6 }, shape: 'flat', levels });
  const unpinned = runWind({ ...flat, levels });
  ok(pinned.pin != null && Math.abs(pinned.pin - 505) < 1, `the pin is read off the same-day interest: ${pinned.pin}`);
  const p = pinned.quantiles[LEFT - 1];
  const u = unpinned.quantiles[LEFT - 1];
  ok(p.mid > u.mid + 0.3, `the median leans to the pin by the close: ${fmt(p.mid)} vs ${fmt(u.mid)}`);
  ok(pinned.closeAt.pin > unpinned.closeAt.pin * 1.3, `more paths close at the pin: ${fmt(pinned.closeAt.pin)} vs ${fmt(unpinned.closeAt.pin)}`);
}

/* 6. the carry */
{
  const drift = 0.05 / (252 * LEN);
  const carried = runWind({ ...flat, driftPerMin: drift * 40 }).quantiles[LEFT - 1];
  const want = coneBand(base.spot, cone.sigmaMin, LEFT).mid * Math.exp(drift * 40 * LEFT);
  const s = base.spot * SIGMA_LEFT;
  ok(Math.abs(carried.mid - want) <= 0.05 * s, `the carry lifts the median: ${fmt(carried.mid)} vs ${fmt(want)}`);
}

/* 7. the clock: the session module's */
{
  const at = (iso: string, min: number) => nyInstant(iso, min);
  const full = windClock(at('2026-11-02', REGULAR_OPEN_MIN + 120));
  ok(full != null && full.minutesLeft === 270 && full.elapsedMin === 120 && full.sessionLen === 390, `11:30 on a full day: ${JSON.stringify(full)}`);
  const early = windClock(at('2026-11-27', REGULAR_OPEN_MIN + 120));
  ok(early != null && early.minutesLeft === 90 && early.sessionLen === 210, `11:30 the day after Thanksgiving (13:00 close): ${JSON.stringify(early)}`);
  ok(windClock(at('2026-11-02', REGULAR_OPEN_MIN - 1)) == null, 'nothing before the open');
  ok(windClock(at('2026-11-27', REGULAR_OPEN_MIN + 210)) == null, 'nothing after an early bell');
  ok(windClock(at('2026-11-26', REGULAR_OPEN_MIN + 60)) == null, 'nothing on Thanksgiving');
  ok(windClock(at('2026-11-01', REGULAR_OPEN_MIN + 60)) == null, 'nothing on a Sunday');
  /* the realised read: ±x alternating one-minute returns realise x over a minute */
  const x = 0.0004;
  const closes = [500];
  for (let i = 0; i < 60; i++) closes.push(closes[i] * Math.exp(i % 2 ? -x : x));
  const rs = realisedSigmaDay(closes, 390);
  ok(rs != null && Math.abs(rs - x * Math.sqrt(390)) < 1e-6, `realised σ off today's closes: ${rs}`);
  ok(realisedSigmaDay(closes.slice(0, 20), 390) == null, 'no realised read before thirty returns');
}

/* 8. the inputs off the book */
{
  const now = nyInstant('2026-11-02', REGULAR_OPEN_MIN + 120);
  const nodes = [
    { strike: 499, netGex: 5e8, callOI: 0, putOI: 0 },
    { strike: 500, netGex: -3e8, callOI: 0, putOI: 0 },
  ];
  const r = windInputsFor({ ticker: 'SPY', now, spot: 500, sigmaToday: 4, nodes, sameDay: [{ strike: 500, netGex: 0, callOI: 900, putOI: 100 }], closes: [], carry: { r: 0.04, q: 0.01 } });
  ok(r.ok, 'a session minute with a price, a vol and a book is ready');
  if (r.ok) {
    ok(r.inputs.strikes[0].netGex === -5e8 && r.inputs.strikes[1].netGex === 3e8, 'the kept sign is turned to the dealer sign');
    ok(r.inputs.strikes[1].sameDayOI === 1000 && r.inputs.strikes[0].sameDayOI === 0, "today's open interest lands on its strike");
    ok(Math.abs(r.inputs.sigmaLeft - 4 / 500) < 1e-12 && r.inputs.minutesLeft === 270, "the cone's σ to the close, over the session's minutes left");
    ok(Math.abs(r.inputs.driftPerMin! - 0.03 / (252 * 390)) < 1e-15, 'the carry is the rate less the yield over the trading year');
    ok(r.inputs.seed === windSeed('SPY', '2026-11-02', REGULAR_OPEN_MIN + 120), 'the seed is the name, the day and the minute');
  }
  ok(!windInputsFor({ ticker: 'SPY', now, spot: 500, sigmaToday: null, nodes, sameDay: [], closes: [], carry: { r: 0, q: 0 } }).ok, 'no vol: waiting');
  ok(!windInputsFor({ ticker: 'SPY', now, spot: 500, sigmaToday: 4, nodes: [], sameDay: [], closes: [], carry: { r: 0, q: 0 } }).ok, 'no book: waiting');
}

/* the density is a field: every column peaks at 1 */
{
  const d = cone.density;
  let bad = 0;
  for (let k = 0; k < d.cols; k++) {
    let max = 0;
    for (let b = 0; b < d.bins; b++) max = Math.max(max, d.cells[k * d.bins + b]);
    if (Math.abs(max - 1) > 1e-6) bad++;
  }
  ok(bad === 0, `${bad} columns do not peak at 1`);
}

/* 9. the budget */
{
  const t0 = performance.now();
  runWind({ ...base, paths: 3000 });
  const ms = performance.now() - t0;
  console.log(`a resting run (3,000 paths, ${LEFT} minutes): ${ms.toFixed(0)}ms`);
  ok(ms < 600, `a resting run took ${ms.toFixed(0)}ms`);
}

if (misses.length) {
  console.log(`MISSED ${misses.length}:`);
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log(`wind-proof: all ${held} rules hold`);
