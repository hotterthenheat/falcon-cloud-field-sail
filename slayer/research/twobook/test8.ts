/*
  Test 8 (docs/TWO_BOOK_SPEC_V2.md §7): the terminal's published Greeks against the engine, same scale and sign.
  SPXW 2026-11-09 at 15:30 ET on 2026-11-02 (research/twobook/appendixb_fetch.sh): the vendor's own inputs — its
  underlying price, its implied vol (4 decimals), T to 16:00 ET on the expiry over 365 days, carry b = r (no yield) —
  through engine greeks(); per Greek the median |engine/vendor − 1| over contracts whose vendor value is at least
  0.05 (so 4-decimal rounding stays under 0.1%) and the share of same-sign pairs.
    node --import tsx research/twobook/test8.ts
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nyInstant } from '../../shared/marketSession.mjs';
import { contractSpec, greeks, yearsTo } from '../../src/engine/twobook';
import { eachCsvRow } from '../../src/data/printTags';

const dir = join('.cache', 'tb', 'ab');
const V = nyInstant('2026-11-02', 15 * 60 + 30);
const T = yearsTo(contractSpec('SPXW', 'SPX')!, '2026-11-09', V) + Number(process.env.T8_EXTRA_MIN ?? 0) / 525600;
type Row = Record<string, string>;
const read = (f: string) => {
  const m = new Map<string, Row>();
  eachCsvRow(readFileSync(join(dir, f), 'utf8'), (r, c) => {
    const o: Row = {};
    for (const [k, i] of c) o[k] = (r[i] ?? '').replace(/"/g, '');
    m.set(`${o.strike}|${o.right}`, o);
  });
  return m;
};
const g1 = read('greeks1_20261109.csv');
const g2 = read('greeks2_20261109.csv');
const g3 = read('greeks3_20261109.csv');
const pairs: [string, string, keyof ReturnType<typeof greeks>][] = [
  ['delta', '1', 'delta'],
  ['vega', '1', 'vega'],
  ['gamma', '2', 'gamma'],
  ['vanna', '2', 'vanna'],
  ['charm', '2', 'charm'],
  ['vomma', '2', 'vomma'],
  ['veta', '2', 'vetaT'],
  ['speed', '3', 'speed'],
  ['zomma', '3', 'zomma'],
  ['color', '3', 'colorT'],
];
for (const r of [0.0395, 365 * Math.log1p(0.0395 / 360)]) {
  const out: string[] = [];
  for (const [name, file, key] of pairs) {
    const src = file === '1' ? g1 : file === '2' ? g2 : g3;
    const rel: number[] = [];
    let same = 0;
    let n = 0;
    for (const [k, v] of src) {
      const iv = Number(v.implied_vol);
      const S = Number(v.underlying_price);
      const vend = Number(v[name]);
      if (!(iv > 0) || !(S > 0) || !Number.isFinite(vend)) continue;
      const [strike, right] = k.split('|');
      const g = greeks(S, Number(strike), T, iv, r, r, right.startsWith('C') ? 'C' : 'P');
      const ours = g[key] as number;
      if (Math.abs(vend) >= 0.05) {
        rel.push(Math.abs(ours / vend - 1));
        n++;
        if (Math.sign(ours) === Math.sign(vend)) same++;
      }
    }
    rel.sort((a, b) => a - b);
    out.push(`${name.padEnd(6)} n=${String(n).padStart(3)} median |ours/vendor − 1| ${(rel[rel.length >> 1] ?? NaN).toExponential(2)}  same sign ${n ? ((same / n) * 100).toFixed(1) : '—'}%`);
  }
  console.log(`r = b = ${r.toFixed(6)}, T = ${(T * 365).toFixed(4)} days`);
  for (const l of out) console.log(`  ${l}`);
}
