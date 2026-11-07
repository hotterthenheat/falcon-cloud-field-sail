/*
  The two-book engine's proof (docs/TWO_BOOK_SPEC_V2.md §7; what was built: docs/TWO_BOOK.md):
    - Test 6: the golden vectors of the independent 60-digit reference (research/twobook/ref/make_golden.py →
      scripts/golden/twobook-vectors.json), |got − expected| ≤ 1e-10·|expected| + 1e-14, every value;
    - Test 1 (single-contract scaling), Test 2 (signs), Test 3 (one-level 4th-order finite differences on 1,568 contracts
      per Greek, the exposure-level calendar checks), Test 5 (every §4.1 row, inventory before Greeks, linearity, +1%),
      Test 7 (identities, IV round trip, parity forward, invalid inputs, unidentifiable IV).
  Separate suites for the two books: the Model 1 suite (UW conversions, UW_COMPAT) and the Model 2 suite (classifier,
  inventory, S*), beside the shared engine's.

  TWOBOOK_ENGINE=<dir> runs it against another copy of the engine (scripts/twobook-mutation-proof.mjs injects the spec's
  bugs that way and expects this proof to fail). Exit 1 on any failure.
*/

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as Engine from '../src/engine/twobook/index';

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = process.env.TWOBOOK_ENGINE ? resolve(process.env.TWOBOOK_ENGINE) : join(here, '..', 'src', 'engine', 'twobook');
const E = (await import(pathToFileURL(join(engineDir, 'index.ts')).href)) as typeof Engine;
const QUIET = process.env.TWOBOOK_QUIET === '1';

type Gold = Record<string, unknown>;
const G = JSON.parse(readFileSync(join(here, 'golden', 'twobook-vectors.json'), 'utf8')) as Gold;
const num = (s: unknown): number => Number(s);

let fails = 0;
const failLines: string[] = [];
const fail = (msg: string) => {
  fails++;
  if (failLines.length < 12) failLines.push(msg);
};
const say = (s: string) => {
  if (!QUIET) console.log(s);
};
let goldenChecked = 0;
const near = (got: number, exp: string | null, where: string) => {
  goldenChecked++;
  if (exp == null) {
    if (got != null && !Number.isNaN(got)) fail(`${where}: expected none, got ${got}`);
    return;
  }
  const e = Number(exp);
  if (!(Math.abs(got - e) <= 1e-10 * Math.abs(e) + 1e-14)) fail(`${where}: got ${got}, expected ${exp}`);
};

/* ---------------- Test 6: golden vectors ---------------- */
{
  const cases = G.greeks as { in: Record<string, string>; price: string; greeks: Record<string, string>; day: Record<string, string>; hour: Record<string, string>; hedge: Record<string, string>; tgc: string; instr: Record<string, string> }[];
  for (const [i, c] of cases.entries()) {
    const S = num(c.in.S), K = num(c.in.K), T = num(c.in.T), s = num(c.in.sigma), r = num(c.in.r), b = num(c.in.b), C = num(c.in.C), M = num(c.in.M);
    const right = c.in.right as 'C' | 'P';
    const w = `greeks[${i}] S=${S} K=${K} ${right}`;
    near(E.price(S, K, T, s, r, b, right), c.price, `${w} price`);
    const g = E.greeks(S, K, T, s, r, b, right);
    for (const n of E.GREEK_NAMES) near(g[n], c.greeks[n], `${w} ${n}`);
    const ed = E.exposures(g, C, M, S, 'day');
    const eh = E.exposures(g, C, M, S, 'hour');
    for (const n of E.EXPOSURE_NAMES) {
      near(ed[n], c.day[n], `${w} ${n}/day`);
      near(eh[n], c.hour[n], `${w} ${n}/hour`);
    }
    const h = E.hedge(g, C, M, S);
    for (const k of Object.keys(c.hedge)) near(h[k as keyof typeof h], c.hedge[k], `${w} hedge.${k}`);
    near(E.totalGexChange1pct(g, C, M, S), c.tgc, `${w} total_gex_change_1pct`);
    for (const k of Object.keys(c.instr)) near(E.hedgeInInstrument(h.hedge_dollars, k === 'SPY' ? 683.25 : 6850.25, k as 'SPY' | 'ES' | 'MES'), c.instr[k], `${w} hedge in ${k}`);
  }
  say(`golden Greek/exposure/hedge: ${cases.length} cases`);
}
/* Model 1 suite: §3.4 conversions, and that they equal §4.4 on the same contracts */
let uwCases = 0;
{
  const cases = G.uw as { in: { row: Record<string, string>; S: string; iv30: string }; day: Record<string, string>; hour: Record<string, string>; engine: Record<string, string> }[];
  for (const [i, c] of cases.entries()) {
    const f = Object.fromEntries(['call_gamma_oi', 'put_gamma_oi', 'call_delta_oi', 'put_delta_oi', 'call_vanna_oi', 'put_vanna_oi', 'call_charm_oi', 'put_charm_oi'].map(k => [k, num(c.in.row[k] ?? 0)])) as unknown as Engine.UwFour;
    const d = E.uwToSlayer(f, num(c.in.S), num(c.in.iv30), 'day');
    const h = E.uwToSlayer(f, num(c.in.S), num(c.in.iv30), 'hour');
    for (const k of Object.keys(c.day)) {
      near(d[k as keyof typeof d], c.day[k], `uw[${i}] ${k}/day`);
      near(h[k as keyof typeof h], c.hour[k], `uw[${i}] ${k}/hour`);
    }
    for (const k of ['GEX', 'DEX', 'VANNA', 'CHARM'] as const) {
      const e = Number(c.engine[k]);
      if (!(Math.abs(d[k] - e) <= 1e-9 * Math.abs(e) + 1e-6)) fail(`uw[${i}] ${k}: conversion ${d[k]} ≠ §4.4 on the same contracts ${e}`);
    }
    uwCases++;
  }
  say(`Model 1: ${uwCases} UW conversion cases (four fields, per day and per hour, and against §4.4)`);
}
/* Model 2 suite: classifier, inventory, S* */
{
  const cases = G.classify as { in: { conditions: number[]; size: string; price: string; bid: string; ask: string; age: string }; bucket: string; C: number }[];
  for (const [i, c] of cases.entries()) {
    const got = E.classify(c.in.conditions, num(c.in.size), num(c.in.price), num(c.in.bid), num(c.in.ask), num(c.in.age));
    goldenChecked++;
    if (got.bucket !== c.bucket || got.C !== c.C) fail(`classify[${i}] ${JSON.stringify(c.in)}: ${got.bucket} ${got.C} ≠ ${c.bucket} ${c.C}`);
  }
  const acc = G.accumulate as { in: { key: string; conditions: number[]; size: string; price: string; bid: string; ask: string; age: string; seq: number }[]; inventory: Record<string, number>; buckets: Record<string, number>; unlinked: number };
  const inv = new E.FlowInventory();
  for (const p of acc.in) inv.add({ key: p.key, conditions: p.conditions, size: num(p.size), price: num(p.price), bid: num(p.bid), ask: num(p.ask), quoteAgeMs: num(p.age), seq: p.seq });
  for (const [k, v] of Object.entries(acc.inventory)) {
    goldenChecked++;
    if ((inv.inv.get(k) ?? 0) !== v) fail(`accumulate ${k}: ${inv.inv.get(k)} ≠ ${v}`);
  }
  for (const [k, v] of Object.entries(acc.buckets)) {
    goldenChecked++;
    if ((inv.buckets.get(k as Engine.Bucket) ?? 0) !== v) fail(`accumulate bucket ${k}: ${inv.buckets.get(k as Engine.Bucket)} ≠ ${v}`);
  }
  goldenChecked++;
  if (inv.unlinked !== acc.unlinked) fail(`unlinked cancels ${inv.unlinked} ≠ ${acc.unlinked}`);
  const spots = G.spot as { name: string; in: { forwards: [string, string | null][]; r: string }; S: string; prov: string; expiries: { T: string; F: string; b: string; source: string }[] }[];
  for (const c of spots) {
    const res = E.spotAndCarry(c.in.forwards.map(([T, F]) => ({ T: num(T), F: F == null ? null : num(F) })), () => num(c.in.r));
    if (!res) {
      fail(`spot ${c.name}: none`);
      continue;
    }
    near(res.S, c.S, `spot ${c.name} S*`);
    goldenChecked++;
    if (res.prov !== c.prov) fail(`spot ${c.name} provenance ${res.prov} ≠ ${c.prov}`);
    c.expiries.forEach((x, j) => {
      goldenChecked++;
      if (res.expiries[j].source !== (x as { source?: string }).source) fail(`spot ${c.name} source[${j}] ${res.expiries[j].source}`);
      near(res.expiries[j].F, x.F, `spot ${c.name} F[${j}]`);
      near(res.expiries[j].b, x.b, `spot ${c.name} b[${j}]`);
    });
  }
  say(`Model 2: ${cases.length} classifier cases, one inventory sequence, ${spots.length} S* cases`);
}
{
  const cases = G.iv as { in: Record<string, string>; iv: string | null }[];
  for (const [i, c] of cases.entries()) {
    const x = c.in;
    const iv = E.ivFromQuote(num(x.bid), num(x.ask), num(x.S), num(x.K), num(x.T), num(x.r), num(x.b), x.right as 'C' | 'P', num(x.tick));
    goldenChecked++;
    if (c.iv == null) {
      if (iv != null) fail(`iv[${i}]: expected not identifiable, got ${iv}`);
    } else if (iv == null || Math.abs(iv - Number(c.iv)) > 1e-9 * Number(c.iv)) fail(`iv[${i}]: ${iv} vs ${c.iv}`);
  }
}
const goldenFails = fails;

/* ---------------- Test 1 ---------------- */
for (const S of [37.5, 100, 752.1, 7566.48]) {
  const g = E.greeks(S, S * 1.02, 0.1, 0.22, 0.04, 0.03, 'C');
  const e = E.exposures(g, 1, 100, S);
  if (e.GEX !== g.gamma * 1 * 100 * S * S * 0.01) fail(`Test 1 GEX at ${S}`);
  if (e.DEX !== g.delta * 1 * 100 * S) fail(`Test 1 DEX at ${S}`);
}
/* ---------------- Test 2 ---------------- */
{
  const gp = E.greeks(100, 95, 30 / 365, 0.25, 0.04, 0.04, 'P');
  const sp = E.exposures(gp, -1, 100, 100);
  if (!(sp.GEX < 0 && sp.DEX > 0)) fail('Test 2 short put');
  const gc = E.greeks(100, 105, 30 / 365, 0.25, 0.04, 0.04, 'C');
  const buyCall = E.classify([18], 5, 1.25, 1.2, 1.25, 10);
  if (!(buyCall.bucket === 'BUY' && buyCall.C < 0 && E.exposures(gc, buyCall.C, 100, 100).GEX < 0)) fail('Test 2 customer buys call at ask');
  const sellCall = E.classify([18], 5, 1.2, 1.2, 1.25, 10);
  if (!(sellCall.bucket === 'SELL' && E.exposures(gc, sellCall.C, 100, 100).GEX > 0)) fail('Test 2 customer sells call at bid');
  const buyPut = E.classify([18], 5, 0.8, 0.75, 0.8, 10);
  if (!(buyPut.bucket === 'BUY' && E.exposures(gp, buyPut.C, 100, 100).GEX < 0)) fail('Test 2 customer buys put at ask');
}
/* ---------------- Test 3 ---------------- */
let fdChecks = 0;
let fdSkips = 0;
let fdContracts = 0;
let worst = 0;
{
  const fd = (f: (x: number) => number, x: number, h: number) => (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
  const KS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35];
  const SIG = [0.08, 0.15, 0.25, 0.4, 0.6, 1.0, 1.5];
  const TS = [15 / 525600, 1 / 365, 30 / 365, 3];
  const RB: [number, number][] = [[0, 0], [0.045, 0.045], [0.045, 0.032], [0.02, -0.01]];
  const S = 100;
  for (const sg of SIG)
    for (const T of TS)
      for (const [r, b] of RB)
        for (const right of ['C', 'P'] as const) {
          const ref: Record<string, number> = {};
          for (let i = 0; i <= 40; i++) {
            const g = E.greeks(S, S * (0.6 + i * 0.025), T, sg, r, b, right);
            for (const n of E.GREEK_NAMES) ref[n] = Math.max(ref[n] ?? 0, Math.abs(g[n]));
          }
          for (const ks of KS) {
            fdContracts++;
            const K = S * ks;
            const hS = 1e-3 * S * sg * Math.sqrt(T);
            const hs = 1e-3 * sg;
            const hT = 1e-3 * T;
            const GS = (x: number) => E.greeks(x, K, T, sg, r, b, right);
            const Gs = (x: number) => E.greeks(S, K, T, x, r, b, right);
            const GT = (x: number) => E.greeks(S, K, x, sg, r, b, right);
            const g0 = E.greeks(S, K, T, sg, r, b, right);
            const pairs: [keyof Engine.Greeks, number][] = [
              ['delta', fd(x => E.price(x, K, T, sg, r, b, right), S, hS)],
              ['vega', fd(x => E.price(S, K, T, x, r, b, right), sg, hs)],
              ['gamma', fd(x => GS(x).delta, S, hS)],
              ['vanna', fd(x => Gs(x).delta, sg, hs)],
              ['vomma', fd(x => Gs(x).vega, sg, hs)],
              ['speed', fd(x => GS(x).gamma, S, hS)],
              ['zomma', fd(x => Gs(x).gamma, sg, hs)],
              ['charm', -fd(x => GT(x).delta, T, hT)],
              ['colorT', fd(x => GT(x).gamma, T, hT)],
              ['vetaT', fd(x => GT(x).vega, T, hT)],
            ];
            for (const [n, v] of pairs) {
              const a = g0[n];
              const rf = ref[n];
              if (Math.abs(a) < 1e-12 * rf && Math.abs(v) < 1e-12 * rf) {
                fdSkips++;
                continue;
              }
              const tol = 2e-6 * Math.abs(v) + 1e-9 * rf;
              const err = Math.abs(a - v);
              if (!(err <= tol)) fail(`Test 3 ${n} ${right} K/S=${ks} σ=${sg} T=${T} r=${r} b=${b}: ${a} vs fd ${v}`);
              worst = Math.max(worst, err / tol);
              fdChecks++;
            }
            /* exposure level, calendar convention */
            const C = -3;
            const M = 100;
            const X = (g: Engine.Greeks, s = S) => E.exposures(g, C, M, s);
            const e0 = X(g0);
            /* [name, analytic, fd, the fd's rounding floor: 8·eps·|f(x)| over the step, scaled like the fd] */
            const eps8 = 8 * 2.220446049250313e-16;
            const ePairs: [string, number, number, number][] = [
              ['CHARM', e0.CHARM, -fd(x => X(GT(x)).DEX, T, hT) / 365, (eps8 * Math.abs(e0.DEX)) / hT / 365],
              ['COLOR', e0.COLOR, -fd(x => X(GT(x)).GEX, T, hT) / 365, (eps8 * Math.abs(e0.GEX)) / hT / 365],
              ['VETA', e0.VETA, -fd(x => X(GT(x)).VEGA, T, hT) / 365, (eps8 * Math.abs(e0.VEGA)) / hT / 365],
              ['VANNA', e0.VANNA, fd(x => X(Gs(x)).DEX, sg, hs) * 0.01, ((eps8 * Math.abs(e0.DEX)) / hs) * 0.01],
              ['VOMMA', e0.VOMMA, fd(x => X(Gs(x)).VEGA, sg, hs) * 0.01, ((eps8 * Math.abs(e0.VEGA)) / hs) * 0.01],
              ['ZOMMA', e0.ZOMMA, fd(x => X(Gs(x)).GEX, sg, hs) * 0.01, ((eps8 * Math.abs(e0.GEX)) / hs) * 0.01],
              ['TGC', E.totalGexChange1pct(g0, C, M, S), fd(x => X(GS(x), x).GEX, S, hS) * 0.01 * S, ((eps8 * Math.abs(e0.GEX)) / hS) * 0.01 * S],
            ];
            const refOf: Record<string, number> = { CHARM: ref.charm, COLOR: ref.colorT, VETA: ref.vetaT, VANNA: ref.vanna, VOMMA: ref.vomma, ZOMMA: ref.zomma, TGC: Math.max(ref.speed * S, ref.gamma) };
            const scale: Record<string, number> = { CHARM: 3 * M * S / 365, COLOR: 3 * M * S * S * 0.01 / 365, VETA: 3 * M * 0.01 / 365, VANNA: 3 * M * S * 0.01, VOMMA: 3 * M * 1e-4, ZOMMA: 3 * M * S * S * 1e-4, TGC: 3 * M * 1e-4 * S * S };
            for (const [n, a, v, floor] of ePairs) {
              const rf = refOf[n] * scale[n];
              if (Math.abs(a) < 1e-12 * rf && Math.abs(v) < 1e-12 * rf) {
                fdSkips++;
                continue;
              }
              if (!(Math.abs(a - v) <= 2e-6 * Math.abs(v) + 1e-9 * rf + floor)) fail(`Test 3 exposure ${n} ${right} K/S=${ks} σ=${sg} T=${T}: ${a} vs ${v}`);
              fdChecks++;
            }
          }
        }
}
/* ---------------- Test 5 ---------------- */
{
  /* every §4.1 row once, inventory checked before any Greek */
  const inv = new E.FlowInventory();
  const k = 'SPXW|2026-11-02|7570|C';
  const rows: [number[], number, number, number, number, number, string][] = [
    [[40], 1, 1, 0.9, 1.1, 1, 'CANCEL'],
    [[1], 2, 1.1, 0.9, 1.1, 1, 'EXCLUDED_EXT_HOURS'],
    [[35], 3, 1.1, 0.9, 1.1, 1, 'EXCLUDED_COMPLEX'],
    [[45], 4, 1.1, 0.9, 1.1, 1, 'EXCLUDED_CROSS'],
    [[18], 0, 1.1, 0.9, 1.1, 1, 'EXCLUDED_INVALID'],
    [[145], 5, 1.0, 0.9, 1.1, 1, 'BUY'],
    [[146], 6, 1.0, 0.9, 1.1, 1, 'SELL'],
    [[2], 7, 1.1, 0.9, 1.1, 1, 'EXCLUDED_LATE'],
    [[18], 8, 1.1, NaN, 1.1, 1, 'EXCLUDED_NO_QUOTE'],
    [[18], 9, 1.1, 1.1, 1.1, 1, 'EXCLUDED_LOCKED_CROSSED'],
    [[18], 10, 1.1, 0.9, 1.1, 2000, 'EXCLUDED_STALE_QUOTE'],
    [[18], 11, 1.1, 0.9, 1.1, 1, 'BUY'],
    [[18], 12, 0.9, 0.9, 1.1, 1, 'SELL'],
    [[18], 13, 1.0, 0.9, 1.1, 1, 'MID'],
  ];
  for (const [conds, size, px, bid, ask, age, want] of rows) {
    const got = inv.add({ key: k, conditions: conds, size, price: px, bid, ask, quoteAgeMs: age });
    if (got !== want) fail(`Test 5 row ${want}: ${got}`);
  }
  if (inv.inv.get(k) !== -5 + 6 - 11 + 12) fail(`Test 5 inventory ${inv.inv.get(k)}`);
  const S = 7566.48, K = 7570, T = 30 / 525600, sg = 0.15, r = 0.0395, b = 0.0427;
  const g = E.greeks(S, K, T, sg, r, b, 'C');
  const e1 = E.exposures(g, 1, 100, S);
  const e7 = E.exposures(g, -7, 100, S);
  const e0 = E.exposures(g, 0, 100, S);
  for (const n of E.EXPOSURE_NAMES) {
    if (Math.abs(e7[n] + 7 * e1[n]) > 1e-12 * Math.abs(e1[n])) fail(`Test 5 ${n} not linear in C`);
    if (e0[n] !== 0) fail(`Test 5 ${n} not zero at C = 0`);
    for (const alt of [E.greeks(S * 1.001, K, T, sg, r, b, 'C'), E.greeks(S, K, T, sg * 1.01, r, b, 'C'), E.greeks(S, K, T * 0.9, sg, r, b, 'C')]) if (E.exposures(alt, 1, 100, S)[n] === e1[n]) fail(`Test 5 ${n} does not move with S, σ or T`);
  }
  const gl = (x: number) => E.greeks(x, 800, 0.5, 0.25, 0.04, 0.04, 'C');
  const lo = E.exposures(gl(752.1), -5, 100, 752.1).GEX;
  const up = 752.1 * 1.01;
  const hi = E.exposures(gl(up), -5, 100, up).GEX;
  const tg = E.totalGexChange1pct(gl(752.1), -5, 100, 752.1);
  if (!(Math.abs(hi - (lo + tg)) <= 0.1 * Math.abs(hi - lo))) fail(`Test 5 GEX after +1% ${hi} vs ${lo + tg}`);
}
/* ---------------- Test 7 ---------------- */
let identityPoints = 0;
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const RB: [number, number][] = [[0, 0], [0.045, 0.045], [0.045, 0.032], [0.02, -0.01]];
  for (let i = 0; i < 2000; i++) {
    const S = [37.5, 100, 752.1, 7566.48][i % 4];
    const K = S * (0.7 + 0.65 * rnd());
    const T = [15 / 525600, 1 / 365, 0.1, 1, 3][i % 5];
    const sg = 0.08 + 1.42 * rnd();
    const [r, b] = RB[i % 4];
    const c = E.greeks(S, K, T, sg, r, b, 'C');
    const p = E.greeks(S, K, T, sg, r, b, 'P');
    const ec = Math.exp((b - r) * T);
    if (Math.abs(c.delta - p.delta - ec) > 1e-14) fail(`Test 7 Δc − Δp = ec at ${S} ${K} ${T}`);
    if (Math.abs(c.charm - p.charm + (b - r) * ec) > 1e-12 * Math.max(1, Math.abs(c.charm))) fail('Test 7 charm_c − charm_p');
    const lhs = c.speed * S + 2 * c.gamma;
    const rhs = c.gamma * (1 - c.d1 / (sg * Math.sqrt(T)));
    if (Math.abs(lhs - rhs) > 1e-9 * Math.max(Math.abs(rhs), Math.abs(2 * c.gamma)) + 1e-300) fail('Test 7 speed identity');
    for (const n of ['gamma', 'vega', 'vanna', 'vomma', 'speed', 'zomma', 'colorT', 'vetaT'] as const) if (c[n] !== p[n]) fail(`Test 7 ${n} call ≠ put`);
    identityPoints++;
  }
  /* r = b = 0 reduces to v1 */
  for (let i = 0; i < 200; i++) {
    const S = 100, K = 70 + 65 * rnd(), T = 0.001 + 2 * rnd(), sg = 0.1 + 0.9 * rnd();
    const g = E.greeks(S, K, T, sg, 0, 0, 'C');
    const ph = E.normPdf(g.d1);
    const rel = (a: number, z: number) => Math.abs(a - z) / Math.max(Math.abs(z), 1e-300);
    if (rel(g.charm, (ph * g.d2) / (2 * T)) > 1e-12) fail('Test 7 v1 charm');
    if (rel(g.colorT, (-ph * (1 - g.d1 * g.d2)) / (2 * S * T * sg * Math.sqrt(T))) > 1e-9) fail('Test 7 v1 color');
    if (rel(g.vetaT, (g.vega * (1 + g.d1 * g.d2)) / (2 * T)) > 1e-9) fail('Test 7 v1 veta');
  }
  /* IV round trip, rel 1e-8 */
  for (let i = 0; i < 500; i++) {
    const S = 100, K = S * (0.8 + 0.4 * rnd()), T = [1 / 365, 0.1, 1][i % 3], sg = 0.1 + 0.8 * rnd();
    const [r, b] = RB[i % 4];
    const right = i % 2 ? 'C' : 'P';
    const px = E.price(S, K, T, sg, r, b, right);
    if (px < 1e-6) continue;
    const iv = E.impliedVol(px, S, K, T, r, b, right);
    if (iv == null || Math.abs(E.price(S, K, T, iv, r, b, right) - px) > 1e-8 * px) fail(`Test 7 IV round trip ${K} ${T} ${sg}`);
  }
  /* parity forward recovers S·e^{bT} to 1e-12 */
  for (const [S, r, b, T] of [[7566.48, 0.0395, 0.0427, 30 / 525600], [752.1, 0.04, 0.012, 0.25], [100, 0, 0, 1]] as const) {
    const qs: Engine.ParityQuote[] = [];
    for (let k = -6; k <= 6; k++) {
      const K = S * (1 + k / 200);
      const c = E.price(S, K, T, 0.2, r, b, 'C');
      const p = E.price(S, K, T, 0.2, r, b, 'P');
      qs.push({ strike: K, callBid: c - 0.05, callAsk: c + 0.05, putBid: p - 0.03, putAsk: p + 0.03 });
    }
    const F = E.parityForward(qs, S, r, T);
    if (!F || Math.abs(F.F / (S * Math.exp(b * T)) - 1) > 1e-12) fail(`Test 7 parity forward at ${S}: ${F?.F}`);
  }
  /* invalid inputs and unidentifiable IV */
  const st: [number, number, number, number, string][] = [[NaN, 100, 0.2, 0.1, 'UNAVAILABLE'], [100, 0, 0.2, 0.1, 'UNAVAILABLE'], [100, 100, 0, 0.1, 'UNAVAILABLE'], [100, 100, 0.2, 0, 'EXPIRED'], [100, 100, 0.2, -1e-9, 'EXPIRED'], [-1, 100, 0.2, 0.1, 'UNAVAILABLE'], [Infinity, 100, 0.2, 0.1, 'UNAVAILABLE'], [100, 100, 0.2, 0.1, 'OK']];
  for (const [S, K, s, T, want] of st) if (E.contractStatus(S, K, s, T) !== want) fail(`Test 7 status ${S} ${K} ${s} ${T}`);
  const [, ub] = E.bounds(100, 100, 0.1, 0.04, 0.04, 'C');
  const [deep] = E.bounds(100, 60, 0.1, 0.04, 0.04, 'C');
  if (E.ivFromQuote(0, 2, 100, 100, 0.1, 0.04, 0.04, 'C', 0.01) != null) fail('Test 7 bid = 0 accepted');
  if (E.ivFromQuote(2, 2, 100, 100, 0.1, 0.04, 0.04, 'C', 0.01) != null) fail('Test 7 bid ≥ ask accepted');
  if (E.ivFromQuote(deep - 0.002, deep + 0.006, 100, 60, 0.1, 0.04, 0.04, 'C', 0.05) != null) fail('Test 7 mid ≤ lower bound + ½ tick accepted');
  if (E.ivFromQuote(ub - 0.01, ub + 0.03, 100, 100, 0.1, 0.04, 0.04, 'C', 0.01) != null) fail('Test 7 mid ≥ upper bound accepted');
  if (E.ivFromQuote(3, 3.1, 100, 100, 0.1, 0.04, 0.04, 'C', 0.01) == null) fail('Test 7 a fair quote did not solve');
  /* the contract table: SPX AM to 09:30, SPXW PM to 16:00, the same date and strike different T */
  const am = E.contractSpec('SPX', 'SPX');
  const pm = E.contractSpec('SPXW', 'SPX');
  if (!am || !pm || am.settlement !== 'AM' || pm.settlement !== 'PM' || am.multiplier !== 100) fail('Test 7 contract table SPX/SPXW');
  else {
    const now = Date.UTC(2026, 10, 19, 21, 0); // Thu 2026-11-19 16:00 ET
    const dt = (E.yearsTo(pm, '2026-11-20', now) - E.yearsTo(am, '2026-11-20', now)) * 365 * 24;
    if (Math.abs(dt - 6.5) > 1e-9) fail(`Test 7 SPX vs SPXW settlement gap ${dt} h`);
  }
  if (E.contractSpec('AAPL1', 'AAPL') != null) fail('Test 7 an adjusted root has a spec');
}

/* ---------------- summary ---------------- */
say(`golden: ${goldenChecked} values, ${goldenFails} off`);
say(`Test 3: ${fdContracts} contracts per Greek (×10 Greeks + 7 exposure checks), ${fdChecks} checks, ${fdSkips} numerically-zero skips, worst err/tol ${worst.toExponential(2)}`);
say(`Test 7: identities on ${identityPoints} random points, v1 regression, IV round trip, parity forward, statuses, the contract table`);
if (fails) {
  for (const l of failLines) console.log(`✗ ${l}`);
  console.log(`twobook-proof FAIL: ${fails} failure(s)`);
  process.exit(1);
}
console.log(`twobook-proof OK: ${goldenChecked} golden values, ${fdChecks} finite-difference checks on ${fdContracts} contracts per Greek, Tests 1/2/5/7`);
