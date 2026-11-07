/*
  Records the fixtures scripts/twobook-map-proof.ts reads: what a running server's two books last valued for a name.
    node scripts/twobook-map-record.mjs http://127.0.0.1:8097 SPY SPX
  For each name: the open-interest book's inputs (/api/twobook/oi?inputs=1 — the listed rows, the ticker IV, the
  contracts; only the fields the board reads are kept) with the board the server answered, and the flow book's inputs
  (/api/tape/__flowinputs — the signed inventory, the quotes, the rate, the valuation instant) with its board. Gzipped
  JSON in scripts/fixtures/twobook/. Never run against production (both routes answer 404 there). Keys stay on the server.
*/
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, ...names] = process.argv.slice(2);
if (!base || !names.length) {
  console.error('usage: node scripts/twobook-map-record.mjs <server> <TICKER>…');
  process.exit(2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'twobook');
mkdirSync(out, { recursive: true });
const get = async path => {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const ROW_KEYS = ['time', 'price', 'expiry', 'strike', 'call_gamma_oi', 'put_gamma_oi', 'call_delta_oi', 'put_delta_oi', 'call_vanna_oi', 'put_vanna_oi', 'call_charm_oi', 'put_charm_oi'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
for (const t of names) {
  const inputs = await get(`/api/twobook/oi?ticker=${t}&inputs=1`);
  const board = await get(`/api/twobook/oi?ticker=${t}`);
  const m1 = {
    inputs: { ...inputs, rows: inputs.rows.map(r => pick(r, ROW_KEYS)), contracts: inputs.contracts.map(c => pick(c, ['option_symbol', 'open_interest', 'implied_volatility'])) },
    served: { four: board.four, six: board.six, at: board.at, price: board.price, unit: board.unit, phase: board.phase },
  };
  writeFileSync(join(out, `${t.toLowerCase()}-model1.json.gz`), gzipSync(JSON.stringify(m1)));
  console.log(`${t} open-interest book: ${m1.inputs.rows.length} rows, ${m1.inputs.contracts.length} contracts, phase ${board.phase}`);
  const flowIn = await get(`/api/tape/__flowinputs?ticker=${t}`);
  const flow = await get(`/api/tape/flowbook?ticker=${t}`);
  writeFileSync(join(out, `${t.toLowerCase()}-flow.json.gz`), gzipSync(JSON.stringify({ inputs: flowIn, served: { totals: flow.totals, valuedAt: flow.valuedAt, unit: flow.unit, spot: flow.spot, prints: flow.flow.prints } })));
  console.log(`${t} flow book: ${flowIn.view.inv.length} contracts in the inventory, ${flowIn.quotes.length} quotes, ${flow.flow.prints} prints`);
}
