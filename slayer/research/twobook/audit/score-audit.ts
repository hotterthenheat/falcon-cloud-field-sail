/*
  Scores the TypeScript two-book engine (src/engine/twobook) against the lead's independent audit golden file
  (research/twobook-audit/golden_audit.json in the lead's worktree; its code is deliberately not read here).
    node --import tsx research/twobook/audit/score-audit.ts <golden_audit.json> [--json out.json]
  Tolerance |got − e| ≤ 1e-10·|e| + 1e-14; strings exactly. Prints per group: cases, values, mismatches; then each
  mismatch with its case id and ambiguity tags. Naming differences that are not numerical (provenance "CALCULATED"
  for the audit's "EXACT") are mapped and listed.
*/

import { readFileSync, writeFileSync } from 'node:fs';
import * as E from '../../../src/engine/twobook/index';

const file = process.argv[2];
const jsonOut = process.argv.indexOf('--json') > 0 ? process.argv[process.argv.indexOf('--json') + 1] : null;
const G = JSON.parse(readFileSync(file, 'utf8')) as { groups: Record<string, Case[]> };
type Case = { id: string; inputs: Record<string, any>; expected: Record<string, any>; ambiguity?: string[]; info?: Record<string, any> };

const n = (v: unknown): number => (v === null || v === undefined ? NaN : typeof v === 'string' ? Number(v) : (v as number));
const stats: Record<string, { cases: number; values: number; bad: number }> = {};
const misses: { group: string; id: string; key: string; got: unknown; exp: unknown; amb: string[]; f64: boolean }[] = [];

function score(group: string, c: Case, got: Record<string, unknown>, keyMap: (k: string) => string = k => k) {
  const s = (stats[group] ??= { cases: 0, values: 0, bad: 0 });
  s.cases++;
  const f64 = new Set<string>((c.info?.f64_twin_out_of_tol as string[]) ?? []);
  const walk = (exp: unknown, gv: unknown, path: string) => {
    if (exp !== null && typeof exp === 'object' && !Array.isArray(exp)) {
      for (const [k, v] of Object.entries(exp)) walk(v, gv && typeof gv === 'object' ? (gv as Record<string, unknown>)[keyMap(k)] : undefined, path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(exp)) {
      exp.forEach((v, i) => walk(v, Array.isArray(gv) ? gv[i] : undefined, `${path}[${i}]`));
      return;
    }
    s.values++;
    let ok: boolean;
    if (typeof exp === 'number') {
      const g = n(gv);
      ok = Math.abs(g - exp) <= 1e-10 * Math.abs(exp) + 1e-14 || (Number.isNaN(exp) && Number.isNaN(g));
    } else ok = exp === gv;
    if (!ok) {
      s.bad++;
      misses.push({ group, id: c.id, key: path, got: gv, exp, amb: c.ambiguity ?? [], f64: f64.has(path) });
    }
  };
  walk(c.expected, got, '');
}

const greekKey = (k: string) => (k === 'color_T' ? 'colorT' : k === 'veta_T' ? 'vetaT' : k);
const msOf = (iso: string) => Date.parse(iso);

for (const c of G.groups.greeks_exposures ?? []) {
  const x = c.inputs;
  const g = E.greeks(x.S, x.K, x.T, x.sigma, x.r, x.b, x.right);
  const e = E.exposures(g, x.C, x.M, x.S, 'day');
  const h = E.exposures(g, x.C, x.M, x.S, 'hour');
  const hd = E.hedge(g, x.C, x.M, x.S);
  const tgc = E.totalGexChange1pct(g, x.C, x.M, x.S);
  const closed = x.C * x.M * 0.0001 * g.gamma * x.S * x.S * (1 - g.d1 / (x.sigma * Math.sqrt(x.T)));
  const got: Record<string, unknown> = { price: E.price(x.S, x.K, x.T, x.sigma, x.r, x.b, x.right), ...g, ...e, CHARM_per_hour: h.CHARM, COLOR_per_hour: h.COLOR, VETA_per_hour: h.VETA, ...hd, speed_gex_component: e.SPEED, total_gex_change_1pct: tgc, total_gex_change_1pct_closed: closed };
  for (const k of ['SPY', 'ES', 'MES'] as const) got[`hedge_in_${k}`] = E.hedgeInInstrument(hd.hedge_dollars, x.instrument_prices[k], k);
  score('greeks_exposures', c, got, greekKey);
}
for (const c of G.groups.model1_six ?? []) {
  const x = c.inputs;
  const C = x.right === 'C' ? x.OI : -x.OI;
  const g = E.greeks(x.S, x.K, x.T, x.sigma, 0, 0, x.right);
  const e = E.exposures(g, C, x.M, x.S, 'day');
  const h = E.exposures(g, C, x.M, x.S, 'hour');
  score('model1_six', c, { ...e, C, COLOR_per_hour: h.COLOR, VETA_per_hour: h.VETA });
}
for (const c of G.groups.uw_contract_fields ?? []) {
  const x = c.inputs;
  /* §3.3 forward: what UW publishes for one contract (the engine never computes this; it is the inverse of uwToSlayer) */
  const s = x.right === 'C' ? 1 : -1;
  score('uw_contract_fields', c, { gamma_oi: s * x.gamma * x.OI * x.S * x.S, delta_oi: x.delta * x.OI * x.S * x.S, vanna_oi: s * x.vanna * x.OI * x.S * x.IV30, charm_oi: s * x.charm * x.OI * x.S * 365 });
}
for (const c of G.groups.uw_conversion ?? []) {
  const x = c.inputs;
  const d = E.uwToSlayer(x as unknown as E.UwFour, x.S, x.IV30, 'day');
  const h = E.uwToSlayer(x as unknown as E.UwFour, x.S, x.IV30, 'hour');
  score('uw_conversion', c, { ...d, DEX_UW_OWN_SIGN: d.DEX_UW_SIGN, CHARM_per_hour: h.CHARM });
}
for (const c of G.groups.uw_population ?? []) score('uw_population', c, { action: E.uwRowAction(msOf(c.inputs.snapshot), c.inputs.expiration, c.inputs.am_settlement_day) });
for (const c of G.groups.time_to_settlement ?? []) {
  const spec = E.contractSpec(c.inputs.root);
  const now = msOf(c.inputs.snapshot);
  const T = spec ? E.yearsTo(spec, c.inputs.expiration, now) : NaN;
  const minutes = spec ? (E.settlementMs(spec, c.inputs.expiration) - now) / 60_000 : NaN;
  score('time_to_settlement', c, { minutes, T, status: T > 0 ? 'OK' : 'EXPIRED' });
}
for (const c of G.groups.status ?? []) score('status', c, { status: E.contractStatus(n(c.inputs.S), n(c.inputs.K), n(c.inputs.sigma), n(c.inputs.T)) });
for (const c of G.groups.iv ?? []) {
  const x = c.inputs;
  const iv = E.ivFromQuote(n(x.bid), n(x.ask), n(x.S), n(x.K), n(x.T), n(x.r), n(x.b), x.right, n(x.tick));
  score('iv', c, { identifiable: iv != null, iv });
}
for (const c of G.groups.flat_wing ?? []) {
  const lines: E.BoardLine[] = c.inputs.contracts.map((k: { K: number; iv: number | null }) => ({ root: 'X', expiry: 'e', strike: k.K, right: 'C', C: 1, M: 100, T: 0.1, S: c.inputs.S_ref, r: 0, b: 0, iv: k.iv, ivProv: k.iv != null ? 'SOLVED' : 'UNAVAILABLE' }));
  const out = E.fillFlatWing(lines);
  score('flat_wing', c, { iv: out.map(l => l.iv), provenance: out.map(l => l.ivProv) });
}
const quotesOf = (qs: { K: number; cb: unknown; ca: unknown; pb: unknown; pa: unknown }[]): E.ParityQuote[] => qs.map(q => ({ strike: q.K, callBid: n(q.cb), callAsk: n(q.ca), putBid: n(q.pb), putAsk: n(q.pa) }));
for (const c of G.groups.parity_forward ?? []) {
  const x = c.inputs;
  score('parity_forward', c, { F: E.parityForward(quotesOf(x.quotes), x.S_ref, x.r, x.T)?.F ?? null });
}
for (const c of G.groups.implied_spot ?? []) {
  const exps = c.inputs.expiries as { id: string; T: number; r: number; S_ref: number; quotes?: any[]; F?: number | null }[];
  let b: Pick<E.SlayerBoard, 'spot' | 'expiries'>;
  if (exps.some(e => 'F' in e)) {
    /* forwards given directly */
    const live = exps.filter(e => e.T > 0);
    const spot = E.spotAndCarry(live.map(e => ({ T: e.T, F: e.F ?? null })), E.rateCurve(live));
    const expiries: E.SlayerBoard['expiries'] = new Map();
    if (spot) live.forEach((e, i) => expiries.set(e.id, { T: e.T, r: e.r, ...spot.expiries[i] }));
    b = { spot, expiries };
  } else b = E.slayerBoard(exps.map(e => ({ id: e.id, T: e.T, r: e.r, Sref: e.S_ref, quotes: quotesOf(e.quotes ?? []) })), []);
  if (!b.spot) {
    score('implied_spot', c, { S_star: null, provenance: 'UNAVAILABLE', T1: null, TL: null });
    continue;
  }
  const idOfT = (T: number | null) => (T == null ? null : (exps.find(e => e.T === T)?.id ?? null));
  const per: Record<string, unknown> = {};
  for (const [id, v] of b.expiries) per[id] = { F: v.F, b: v.b, source: v.source };
  score('implied_spot', c, { S_star: b.spot.S, provenance: b.spot.prov === 'CALCULATED' ? 'EXACT' : b.spot.prov, T1: idOfT(b.spot.T1), TL: idOfT(b.spot.TL), per_expiry: per });
}
for (const c of G.groups.classifier ?? []) {
  const x = c.inputs;
  const age = x.trade_ts_ms == null || x.quote_ts_ms == null ? NaN : n(x.trade_ts_ms) - n(x.quote_ts_ms);
  const r = E.classify(x.condition == null ? [] : [n(x.condition)], n(x.size), n(x.price), n(x.bid), n(x.ask), age);
  score('classifier', c, { bucket: r.bucket, dealer_C: r.C });
}
for (const c of G.groups.accumulate ?? []) {
  const inv = new E.FlowInventory();
  const buckets: string[] = [];
  const unlinked: number[] = [];
  for (const p of c.inputs.prints as Record<string, any>[]) {
    const before = inv.unlinked;
    const age = p.trade_ts_ms == null || p.quote_ts_ms == null ? NaN : n(p.trade_ts_ms) - n(p.quote_ts_ms);
    /* the audit's cancels name the print they cancel (ref_seq); without one, the engine links by contract, price and size */
    const b = inv.add({ key: p.contract, conditions: [n(p.condition)], size: n(p.size), price: n(p.price), bid: n(p.bid), ask: n(p.ask), quoteAgeMs: age, seq: p.seq, ref: p.ref_seq ?? undefined });
    buckets.push(b);
    if (inv.unlinked > before) unlinked.push(p.seq);
  }
  const C: Record<string, number> = {};
  for (const k of Object.keys(c.expected.C)) C[k] = inv.inv.get(k) ?? 0;
  score('accumulate', c, { C, buckets, unlinked_cancels: unlinked });
}
for (const c of G.groups.time_unit ?? []) score('time_unit', c, { unit: E.boardTimeUnit((c.inputs.contracts as { T: number; C: number }[]).filter(k => k.C !== 0 && k.T > 0).map(k => k.T)) });
for (const c of G.groups.board_model2 ?? []) {
  const chain: E.ChainExpiry[] = c.inputs.chain.map((e: any) => ({ id: e.id, T: e.T, r: e.r, Sref: e.S_ref, quotes: quotesOf(e.quotes) }));
  const contracts: E.FlowContract[] = c.inputs.contracts.map((k: any) => ({ expiry: k.expiry, strike: k.K, right: k.right, bid: n(k.bid), ask: n(k.ask), tick: k.tick, M: k.M, C: k.C }));
  const b = E.slayerBoard(chain, contracts);
  const t = b.board!;
  score('board_model2', c, { S_star: b.spot?.S, unit: t.unit, totals: t.totals, total_gex_change_1pct: t.totalGexChange1pct, hedge_dollars: t.hedge.hedge_dollars, share_absC_modeled_iv: t.modeledShare, hedge_ES: E.hedgeInInstrument(t.hedge.hedge_dollars, c.inputs.es_price, 'ES') });
}

let cases = 0, values = 0, bad = 0;
for (const [g, s] of Object.entries(stats)) {
  cases += s.cases;
  values += s.values;
  bad += s.bad;
  console.log(`${g.padEnd(20)} ${String(s.cases).padStart(5)} cases ${String(s.values).padStart(7)} values ${String(s.bad).padStart(4)} off`);
}
console.log(`TOTAL ${cases} cases, ${values} values, ${bad} off (${misses.filter(m => m.f64).length} of them flagged f64_twin_out_of_tol)`);
for (const m of misses.slice(0, 80)) console.log(`  ${m.group} ${m.id} ${m.key}: got ${JSON.stringify(m.got)} expected ${JSON.stringify(m.exp)}${m.amb.length ? ` [${m.amb.join(',')}]` : ''}${m.f64 ? ' (f64)' : ''}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ stats, misses }, null, 1));
