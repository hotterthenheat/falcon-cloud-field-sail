/*
  The Weigher's gamma is the options-flow vendor's own per-contract gamma (data/weigherDesk.ts withVendorGamma), off the
  option-contracts rows the name's book already reads (/stock/{t}/option-contracts, on server/uwProxy.mjs's allowlist;
  data/book/load.ts fillExpiryFacts → book/scale.ts foldContracts `row.gamma`). Before, the chain's fallback read
  `gamma` off the ThetaData first-order snapshot, which never sends one.

  Known numbers: the recorded sets weigher-theta-2026-10-29 (the SPY 0DTE chain at 11:51:02 ET) and terrain-2026-10-29
  (the SPY book with the 2026-10-29 option-contracts rows).
  Run:  npx tsx scripts/weigher-gamma-proof.ts
*/
import { freezeClock, installUwFixtures, recordedAt, settleOn } from './golden/uwFixtures';
import { rawAnswers } from './golden/pinpointRaw';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/weigher', href: 'http://127.0.0.1/weigher', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
const mem = new Map<string, string>();
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

/* ---- before: the first-order snapshot the chain reads has no gamma on any row ---- */
const THETA_SET = 'weigher-theta-2026-10-29';
const thetaRaw = rawAnswers(THETA_SET);
const firstOrder = [...thetaRaw.entries()].find(([p]) => p.startsWith('/option/snapshot/greeks/first_order'))![1] as { response: { data: Record<string, unknown>[] }[] };
const items = firstOrder.response;
const withGamma = items.filter(it => it.data.some(d => 'gamma' in d)).length;
check(`the first-order snapshot: ${items.length} contracts, ${withGamma} carry a gamma field (the old fallback read nothing)`, items.length > 0 && withGamma === 0);

/* the chain as the Weigher reads it, at the snapshot's own instant */
installUwFixtures(THETA_SET);
freezeClock('2026-10-29T15:51:02.440Z');
const { openFeeds } = await import('../src/data/feedGate');
openFeeds();
const desk = await import('../src/data/weigherDesk');
const chain = await desk.loadLiveChain('SPY', 0, 12, 'SPY');
check(`the chain: ${chain.rows.length} strikes of SPY ${chain.expiryIso}, every gamma the model's before the book lands`, chain.rows.length > 0 && chain.rows.every(r => r.call.gammaFrom !== 'vendor' && r.put.gammaFrom !== 'vendor'));
check('no book yet: nothing to lay on (vendorGammaRows null, the same chain back)', desk.vendorGammaRows('SPY', chain.expiryIso) === null && desk.withVendorGamma(chain, null) === chain);

/* ---- the book, as the Weigher's levels already load it ---- */
const SET = 'terrain-2026-10-29';
const fx = installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));
const book = await import('../src/data/uwBook');
const load = await import('../src/data/book/load');
book.ensureBook('SPY', 'board');
await settleOn(fx, () => book.peekEntry('SPY')?.status === 'live', 'SPY book');
load.wantDateFacts('SPY', [chain.expiryIso]);
await settleOn(fx, () => desk.vendorGammaRows('SPY', chain.expiryIso) != null, 'SPY facts');
const contractAsks = () => fx.asked.filter(p => p.startsWith('/stock/SPY/option-contracts')).length;
const asksBefore = contractAsks();
const nodes = desk.vendorGammaRows('SPY', chain.expiryIso);
const shown = desk.withVendorGamma(chain, nodes);
load.wantDateFacts('SPY', [chain.expiryIso]);
await settleOn(fx, () => true, 'again');
check(`the Weigher asks nothing of its own: option-contracts reads ${asksBefore} → ${contractAsks()} after laying the gamma on and asking again`, contractAsks() === asksBefore && asksBefore > 0);

/* ---- after: populated, and equal to the vendor's rows ---- */
const raw = rawAnswers(SET);
const vendor = new Map<string, number>();
for (const [p, d] of raw) {
  if (!p.startsWith('/stock/SPY/option-contracts') || !p.includes(`expiry=${chain.expiryIso}`) || !Array.isArray(d)) continue;
  for (const row of d as Record<string, unknown>[]) {
    const m = /^SPY(\d{6})([CP])(\d{8})$/.exec(String(row.option_symbol ?? ''));
    const gm = Number(row.gamma);
    if (m && gm > 0) vendor.set(`${Number(m[3]) / 1000}|${m[2]}`, gm);
  }
}
let filled = 0;
let equal = 0;
let model = 0;
const sample: string[] = [];
for (const r of shown.rows) {
  for (const c of [r.call, r.put]) {
    const want = vendor.get(`${r.strike}|${c.right}`);
    if (want == null) {
      if (c.gammaFrom !== 'vendor') model++;
      continue;
    }
    if (c.gammaFrom === 'vendor' && Number.isFinite(c.gamma)) filled++;
    if (c.gamma === want) equal++;
    const before = (c.right === 'C' ? chain.rows.find(x => x.strike === r.strike)!.call : chain.rows.find(x => x.strike === r.strike)!.put).gamma;
    if (sample.length < 4 && Math.abs(r.strike - chain.spot) < 3) sample.push(`${r.strike}${c.right} model ${before} → vendor ${c.gamma}`);
  }
}
const inVendor = shown.rows.reduce((n, r) => n + (vendor.has(`${r.strike}|C`) ? 1 : 0) + (vendor.has(`${r.strike}|P`) ? 1 : 0), 0);
check(`populated: ${filled} of the ${inVendor} chain contracts the vendor's rows carry have gamma from the vendor`, inVendor > 10 && filled === inVendor);
check(`every one equals its option-contracts row's gamma exactly (${equal}/${inVendor})`, equal === inVendor);
check(`a contract with no vendor row keeps the model's (${model})`, shown.rows.every(r => [r.call, r.put].every(c => vendor.has(`${r.strike}|${c.right}`) || c.gammaFrom !== 'vendor')));
/* the two sets were recorded hours apart (the book at 07:36 ET with the whole session left, the chain at 11:51), so the
   model's 0DTE gamma and the vendor's differ by the clock between them; live, both are read within the same minute */
console.log(`     near the money: ${sample.join('; ')}`);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
