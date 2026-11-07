/*
  The audit's A7 (carry extrapolation past the last valid forward) on real boards: the terminal's current quote
  snapshot (every expiry within 60 days, 10 strikes either side) for SPXW, SPY and QQQ, one read each; every expiry's
  parity forward, S*, and each expiry's carry b_T with where it came from (PARITY / INTERPOLATED / EXTRAPOLATED).
    node --import tsx research/twobook/carry_a7.ts SPXW SPY QQQ
*/
import { nyInstant } from '../../shared/marketSession.mjs';
import { contractSpec, parityForward, spotAndCarry, yearsTo, type ParityQuote } from '../../src/engine/twobook';
import { eachCsvRow, stampParts } from '../../src/data/printTags';

const r = 365 * Math.log1p(3.92 / 100 / 360); // SOFR of 2026-11-06, continuous
for (const root of process.argv.slice(2)) {
  const res = await fetch(`http://127.0.0.1:25503/v3/option/snapshot/quote?symbol=${root}&expiration=*&max_dte=60&strike_range=10&format=csv`);
  const csv = await res.text();
  const by = new Map<string, Map<number, ParityQuote>>();
  let at = 0;
  eachCsvRow(csv, (f, c) => {
    const exp = (f[c.get('expiration') ?? -1] ?? '').replace(/"/g, '').slice(0, 10);
    const k = Number(f[c.get('strike') ?? -1]);
    const right = (f[c.get('right') ?? -1] ?? '').includes('C') ? 'C' : 'P';
    const p = stampParts((f[c.get('timestamp') ?? -1] ?? '').replace(/"/g, ''));
    if (p) at = Math.max(at, nyInstant(p.date, p.minute) + p.ms);
    const m = by.get(exp) ?? new Map<number, ParityQuote>();
    const q = m.get(k) ?? { strike: k, callBid: NaN, callAsk: NaN, putBid: NaN, putAsk: NaN };
    if (right === 'C') [q.callBid, q.callAsk] = [Number(f[c.get('bid') ?? -1]), Number(f[c.get('ask') ?? -1])];
    else [q.putBid, q.putAsk] = [Number(f[c.get('bid') ?? -1]), Number(f[c.get('ask') ?? -1])];
    m.set(k, q);
    by.set(exp, m);
  });
  const spec = contractSpec(root)!;
  const exps = [...by.keys()].sort();
  const mids = [...(by.get(exps[0])?.keys() ?? [])].sort((a, b) => a - b);
  const sref = mids[mids.length >> 1];
  const rows = exps.map(e => ({ e, T: yearsTo(spec, e, at), F: parityForward([...by.get(e)!.values()], sref, r, yearsTo(spec, e, at))?.F ?? null })).filter(x => x.T > 0);
  const sc = spotAndCarry(rows.map(x => ({ T: x.T, F: x.F })), () => r);
  console.log(`${root}: quotes at ${new Date(at).toISOString()}, S* ${sc?.S.toFixed(4)} (${sc?.prov}), ${rows.length} expiries, ${rows.filter(x => x.F == null).length} without a valid forward`);
  rows.forEach((x, i) => {
    const s = sc?.expiries[i];
    console.log(`  ${x.e}  T ${(x.T * 365).toFixed(2)}d  F ${s?.F.toFixed(3)}  b ${s ? (s.b * 100).toFixed(3) : '—'}%  ${s?.source}`);
  });
}
