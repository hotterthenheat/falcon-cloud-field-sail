/*
  Appendix B, Model 2, reproduced from the terminal's history (docs/TWO_BOOK.md): SPXW 2026-11-02 0DTE, the prints of
  09:30–15:30 ET classified per §4.1 (src/engine/twobook FlowInventory, the server tape's own path), revalued at 15:30 ET
  in SLAYER mode from the quotes in force at 15:30 (slayerBoard), r = SOFR of 2026-11-02.
  Inputs: research/twobook/appendixb_fetch.sh (raw files under .cache/tb/ab, not committed).
    node --import tsx research/twobook/appendixb.ts [quoted|continuous]
*/

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nyInstant } from '../../shared/marketSession.mjs';
import { FlowInventory, contractKey, contractSpec, hedgeInInstrument, slayerBoard, yearsTo, type ChainExpiry, type FlowContract, type ParityQuote } from '../../src/engine/twobook';
import { eachCsvRow, stampParts } from '../../src/data/printTags';

const dir = join('.cache', 'tb', 'ab');
const rateMode = process.argv[2] ?? 'continuous';
const num = (s: string | undefined) => (s == null || s === '' ? NaN : Number(s));
const unq = (s: string | undefined) => (s ?? '').replace(/"/g, '');
const ms = (s: string) => {
  const p = stampParts(unq(s));
  return p ? nyInstant(p.date, p.minute) + p.ms : NaN;
};

/* 1. the prints */
const inv = new FlowInventory();
const files = readdirSync(dir).filter(f => f.startsWith('tq_')).sort();
let rows = 0;
let sizeAll = 0;
const condCount = new Map<number, number>();
for (const f of files) {
  eachCsvRow(readFileSync(join(dir, f), 'utf8'), (r, c) => {
    const conds = ['condition', 'ext_condition1', 'ext_condition2', 'ext_condition3', 'ext_condition4'].map(k => num(r[c.get(k) ?? -1])).filter(Number.isFinite);
    for (const x of conds) condCount.set(x, (condCount.get(x) ?? 0) + 1);
    const size = num(r[c.get('size') ?? -1]);
    sizeAll += Number.isFinite(size) ? size : 0;
    inv.add({
      key: contractKey('SPXW', unq(r[c.get('expiration') ?? -1]).slice(0, 10), num(r[c.get('strike') ?? -1]), unq(r[c.get('right') ?? -1]).startsWith('C') ? 'C' : 'P'),
      conditions: conds,
      size,
      price: num(r[c.get('price') ?? -1]),
      bid: num(r[c.get('bid') ?? -1]),
      ask: num(r[c.get('ask') ?? -1]),
      quoteAgeMs: ms(r[c.get('trade_timestamp') ?? -1] ?? '') - ms(r[c.get('quote_timestamp') ?? -1] ?? ''),
      seq: num(r[c.get('sequence') ?? -1]),
    });
    rows++;
  });
}
const buckets = Object.fromEntries([...inv.buckets.entries()].map(([k, v]) => [k, { contracts: v, share: v / sizeAll }]));
console.log(`prints ${rows}, contracts ${sizeAll}; aggressor flags 145: ${condCount.get(145) ?? 0}, 146: ${condCount.get(146) ?? 0}; cancels linked ${inv.linked}, unlinked ${inv.unlinked}`);
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(24)} ${String(v.contracts).padStart(9)}  ${(v.share * 100).toFixed(2)}%`);

/* 2. the quotes at 15:30, the rate */
const V = nyInstant('2026-11-02', 15 * 60 + 30);
const sofr = JSON.parse(readFileSync(join(dir, 'sofr.json'), 'utf8')).response.filter((x: { created: string }) => x.created <= '2026-11-02').pop().rate as number;
const r = rateMode === 'quoted' ? sofr / 100 : 365 * Math.log1p(sofr / 100 / 360);
const spx = Number(readFileSync(join(dir, 'spx_1530.csv'), 'utf8').trim().split('\n').pop()!.split(',')[1]);
const chain: ChainExpiry[] = [];
const strip: FlowContract[] = [];
const spec = contractSpec('SPXW', 'SPX')!;
for (const f of readdirSync(dir).filter(x => /^q1530_\d{8}\.csv$/.test(x)).sort()) {
  const text = readFileSync(join(dir, f), 'utf8');
  if (text.length < 100) continue;
  const pairs = new Map<number, ParityQuote>();
  let expiry = '';
  eachCsvRow(text, (q, c) => {
    expiry = unq(q[c.get('expiration') ?? -1]).slice(0, 10);
    const k = num(q[c.get('strike') ?? -1]);
    const right = unq(q[c.get('right') ?? -1]).startsWith('C') ? 'C' : 'P';
    const bid = num(q[c.get('bid') ?? -1]);
    const ask = num(q[c.get('ask') ?? -1]);
    const p = pairs.get(k) ?? { strike: k, callBid: NaN, callAsk: NaN, putBid: NaN, putAsk: NaN };
    if (right === 'C') [p.callBid, p.callAsk] = [bid, ask];
    else [p.putBid, p.putAsk] = [bid, ask];
    pairs.set(k, p);
    if (expiry === '2026-11-02') {
      const mid = 0.5 * (bid + ask);
      strip.push({ root: 'SPXW', expiry: `SPXW|${expiry}`, strike: k, right, bid, ask, tick: process.env.AB_TICK ? Number(process.env.AB_TICK) : spec.tick(Number.isFinite(mid) ? mid : 0), M: spec.multiplier, C: inv.inv.get(contractKey('SPXW', expiry, k, right)) ?? 0 });
    }
  });
  chain.push({ id: `SPXW|${expiry}`, T: yearsTo(spec, expiry, V), r, Sref: spx, quotes: [...pairs.values()] });
}
/* inventory with no quote at 15:30 still enters (flat wing) */
const quoted = new Set(strip.map(c => contractKey('SPXW', '2026-11-02', c.strike, c.right)));
for (const [k, C] of inv.inv) {
  if (C === 0 || quoted.has(k)) continue;
  const [, e, s, rt] = k.split('|');
  if (e !== '2026-11-02') continue;
  strip.push({ root: 'SPXW', expiry: `SPXW|${e}`, strike: Number(s), right: rt as 'C' | 'P', bid: NaN, ask: NaN, tick: 0.05, M: 100, C });
}
/* AB_STRIKES=N: keep the inventory of the N strikes nearest the 15:30 print only (a population check, not the spec's) */
const nStrikes = Number(process.env.AB_STRIKES ?? 0);
if (nStrikes > 0) {
  const ks = [...new Set(strip.map(c => c.strike))].sort((a, z) => Math.abs(a - spx) - Math.abs(z - spx) || a - z).slice(0, nStrikes);
  const keep = new Set(ks);
  for (const c of strip) if (!keep.has(c.strike)) c.C = 0;
}
const b = slayerBoard(chain, strip);
const t = b.board!;
const x0 = b.expiries.get('SPXW|2026-11-02')!;
const x7 = b.expiries.get('SPXW|2026-11-09');
const held = strip.filter(c => c.C !== 0);
const absC = held.reduce((a, c) => a + Math.abs(c.C), 0);
const spec2 = {
  'S*': [7566.4816, b.spot!.S],
  F_0DTE: [7566.5, x0.F],
  'F_7d(Nov-09)': [7572.69, x7?.F ?? NaN],
  b_0DTE: [0.0427, x0.b],
  r: [0.0395, r],
  'net |C|': [74638, absC],
  contracts: [141, held.length],
  'flat-wing share of |C|': [0.409, t.modeledShare],
  GEX: [-1.4694e10, t.totals.GEX],
  DEX: [1.7743e10, t.totals.DEX],
  VEGA: [-2.563e5, t.totals.VEGA],
  VANNA: [-3.6365e7, t.totals.VANNA],
  'CHARM /h': [9.4844e8, t.totals.CHARM],
  'COLOR /h': [1.8887e9, t.totals.COLOR],
  'VETA /h': [5.5169e5, t.totals.VETA],
  VOMMA: [-9.4583e3, t.totals.VOMMA],
  SPEED: [-2.2922e10, t.totals.SPEED],
  ZOMMA: [-5.1336e7, t.totals.ZOMMA],
  total_gex_change_1pct: [-2.3216e10, t.totalGexChange1pct],
  hedge_dollars: [-1.7743e10, t.hedge.hedge_dollars],
  'ES-equivalent': [-46900, hedgeInInstrument(t.hedge.hedge_dollars, b.spot!.S, 'ES')],
} as Record<string, [number, number]>;
console.log(`\nunit ${t.unit}${t.rate ? ' (rate)' : ''}; r ${rateMode} ${r}; SPX print ${spx}; T1 ${b.spot?.T1} TL ${b.spot?.TL} (${b.spot?.prov})`);
console.log('metric'.padEnd(24), 'spec'.padStart(14), 'ours'.padStart(16), 'diff'.padStart(10));
for (const [k, [s, o]] of Object.entries(spec2)) console.log(k.padEnd(24), String(s).padStart(14), o.toPrecision(6).padStart(16), `${(((o - s) / Math.abs(s)) * 100).toFixed(2)}%`.padStart(10));
writeFileSync(join(dir, `result_${rateMode}${nStrikes ? `_k${nStrikes}` : ''}.json`), JSON.stringify({ buckets, rows, sizeAll, table: spec2, unit: t.unit, counts: t.counts, linked: inv.linked, unlinked: inv.unlinked, expiries: [...b.expiries.entries()] }, null, 1));
