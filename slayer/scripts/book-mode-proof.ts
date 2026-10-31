/*
  TM10 — the walls, the flip, the regime and the Terrain strike rail follow the exposure field's Open interest / Flow
  toggle (data/bookMode.ts), on the same flow book the field draws (StrikeNode.flow, data/book/scale.ts stampFlow).

  1. On Open interest nothing may change: every function hands back the very object it was given, and the levels off a
     real SPY expiry (captured rows and contracts) are equal field for field.
  2. A hand example on Flow: the walls, the net, the regime and the flip move the way the arithmetic says.
  3. A whole-book chain (a sum of dates) on Flow is its own rows plus each date's flow-minus-open-interest.
  Run:  npx tsx scripts/book-mode-proof.ts
*/
import { readFileSync } from 'node:fs';
import { bookInMode, chainInMode, flowChainIn, flowChainOf, flowNode } from '../src/data/bookMode';
import { buildExposureProfile } from '../src/data/exposure';
import { expiryBookFromRows, emptyNode } from '../src/data/book/scale';
import { regimeOfNet } from '../src/data/flipLevel';
import { pickLegWalls } from '../src/core/walls';
import { repricedFlip, type GammaLeg } from '../src/core/gammaFlip';
import { registerChainDates } from '../src/data/chainDates';
import type { MarketSnapshot, StrikeNode } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const M = (v: number) => `${(v / 1e6).toFixed(2)}M`;

/* ---- 1. Open interest: nothing changes ---- */
const CAPTURE = Date.parse('2026-10-28T20:15:00Z');
const realNow = Date.now;
Date.now = () => CAPTURE;
const fx = JSON.parse(readFileSync(new URL('./fixtures/spy-2026-10-29.json', import.meta.url), 'utf8')) as {
  spot: number;
  expiry: string;
  spotExposures: Record<string, string>[];
  contracts: Record<string, unknown>[];
};
const chain = expiryBookFromRows(fx.spotExposures, fx.contracts as never[], fx.spot, fx.expiry);
Date.now = realNow;
const snap = { ticker: 'SPY', spot: fx.spot, chain, uwChains: { '0DTE': chain, ALL: chain }, uwByDate: { [fx.expiry]: chain }, liveBook: true } as unknown as MarketSnapshot;
const oiSnap = bookInMode(snap, 'oi');
check('Open interest: the snapshot comes back as the same object', oiSnap === snap);
check('Open interest: a chain comes back as the same array (the rail\'s rows)', chainInMode(chain, snap.uwByDate, 'oi') === chain);
const a = buildExposureProfile(snap, '0DTE', 20);
const b = buildExposureProfile(oiSnap, '0DTE', 20);
check(`Open interest: SPY ${fx.expiry} levels equal field for field (call wall ${a.levels.callWall}, put wall ${a.levels.putWall}, net ${M(a.netGex)})`, JSON.stringify(a) === JSON.stringify(b));
const withFlow = chain.filter(n => n.flow);
const moved = chain.filter(n => flowNode(n) !== n);
console.log(`     SPY ${fx.expiry}: ${withFlow.length} of ${chain.length} strikes carry a flow book, ${moved.length} differ from open interest`);
const flowSnap = bookInMode(snap, 'flow');
const c = buildExposureProfile(flowSnap, '0DTE', 20);
const flowNet = flowSnap.chain.reduce((s, n) => s + n.netGex, 0);
const oiNet = chain.reduce((s, n) => s + n.netGex, 0);
const flowSum = chain.reduce((s, n) => s + (n.flow ? n.flow.gex.call + n.flow.gex.put : n.netGex), 0);
check(`Flow: SPY's book is the flow figures (net ${M(oiNet)} on open interest, ${M(flowNet)} on flow = Σ flow legs ${M(flowSum)}); walls ${c.levels.callWall}/${c.levels.putWall}`, Math.abs(flowNet - flowSum) < 1 && (moved.length === 0 ? flowSnap === snap : flowSnap !== snap));
check('Flow: the date rows and the scope chains stay one array (the flip keys a scope by identity)', flowSnap.uwChains?.['0DTE'] === flowSnap.uwByDate?.[fx.expiry] && flowSnap.chain === flowSnap.uwChains?.['0DTE']);

/* ---- 2. A hand example ---- */
/* House sign (core/dealerSign.ts): calls negative, puts positive. Spot 100, 20 sessions, 25% vol.
     open interest: 97P +2.50M, 103C −0.90M, 105C −1.20M     → call wall 105, put wall 97, net +0.40M → SHORT
     flow:          97P +2.50M, 103C −1.60M, 105C −1.00M     → call wall 103, put wall 97, net −0.10M → LONG
   (today's trades put 0.70M more call gamma at 103 and took 0.20M off 105). */
const node = (k: number, call: number, put: number, flowCall: number, flowPut: number): StrikeNode => {
  const n = { ...emptyNode(k), callGex: call, putGex: put, netGex: call + put };
  const z = { call: 0, put: 0 };
  n.flow = { gex: { call: flowCall, put: flowPut }, dex: { call: n.callDex, put: n.putDex }, vex: { call: n.callVex, put: n.putVex }, vanna: { call: n.callVanna, put: n.putVanna }, charm: { call: n.callCharm, put: n.putCharm }, color: z, vomma: z, speed: z, veta: z, zomma: z, disagree: false, held: flowCall === call && flowPut === put, outside: false };
  return n;
};
const hand = [node(97, 0, 2.5e6, 0, 2.5e6), node(103, -0.9e6, 0, -1.6e6, 0), node(105, -1.2e6, 0, -1.0e6, 0)];
const flowHand = flowChainOf(hand);
const wallsOf = (ch: readonly StrikeNode[]) => pickLegWalls(ch, n => n.callGex, n => n.putGex);
const netOf = (ch: readonly StrikeNode[]) => ch.reduce((s, n) => s + n.netGex, 0);
const t20 = 20 / 252;
const legsOf = (ch: readonly StrikeNode[]): GammaLeg[] => ch.flatMap(n => [
  ...(n.callGex ? [{ strike: n.strike, g0: n.callGex, iv: 0.25, t: t20, s0: 100 }] : []),
  ...(n.putGex ? [{ strike: n.strike, g0: n.putGex, iv: 0.25, t: t20, s0: 100 }] : []),
]);
const oiW = wallsOf(hand);
const flW = wallsOf(flowHand);
const oiFlip = repricedFlip(legsOf(hand), 100, 0.042, 0.1, 0);
const flFlip = repricedFlip(legsOf(flowHand), 100, 0.042, 0.1, 0);
check(`hand, open interest: call wall ${oiW.callWall}, put wall ${oiW.putWall}, net ${M(netOf(hand))}, regime ${regimeOfNet(oiFlip.netAtSpot)}, flip ${oiFlip.flip?.toFixed(2)}`, oiW.callWall === 105 && oiW.putWall === 97 && Math.abs(netOf(hand) - 0.4e6) < 1 && regimeOfNet(oiFlip.netAtSpot) === 'SHORT');
check(`hand, flow: call wall ${flW.callWall}, put wall ${flW.putWall}, net ${M(netOf(flowHand))}, regime ${regimeOfNet(flFlip.netAtSpot)}, flip ${flFlip.flip?.toFixed(2)}`, flW.callWall === 103 && flW.putWall === 97 && Math.abs(netOf(flowHand) + 0.1e6) < 1 && regimeOfNet(flFlip.netAtSpot) === 'LONG');
check(`hand: the flip is where each book's re-priced net crosses zero, and it moves with the book (${oiFlip.flip?.toFixed(2)} → ${flFlip.flip?.toFixed(2)})`, oiFlip.flip != null && flFlip.flip != null && oiFlip.flip !== flFlip.flip && oiFlip.beyond !== flFlip.beyond);
check('hand: the open-interest chain is untouched (the flow chain is new nodes)', hand[1].callGex === -0.9e6 && flowHand[1].callGex === -1.6e6 && flowHand[1] !== hand[1]);

/* ---- 3. A whole book that is the sum of two dates ---- */
const d1 = [node(103, -0.9e6, 0, -1.6e6, 0), node(105, -1.2e6, 0, -1.2e6, 0)];
const d2 = [node(103, -0.5e6, 0.2e6, -0.4e6, 0.2e6), node(110, -0.3e6, 0, -0.3e6, 0)];
/* the whole book also carries a date whose chain is not loaded: +0.05M at 103 */
const all = [
  { ...emptyNode(103), callGex: -1.4e6, putGex: 0.25e6, netGex: -1.15e6 },
  { ...emptyNode(105), callGex: -1.2e6, putGex: 0, netGex: -1.2e6 },
  { ...emptyNode(110), callGex: -0.3e6, putGex: 0, netGex: -0.3e6 },
];
registerChainDates(all, ['2026-11-02', '2026-11-03']);
const by = { '2026-11-02': d1, '2026-11-03': d2 };
const flowAll = flowChainIn(all, by);
const at103 = flowAll.find(n => n.strike === 103)!;
/* 103: rows −1.15M + (−1.6 − −0.9) + (−0.4 − −0.5) = −1.75M; the unloaded date's +0.05M stays */
check(`whole book: 103 reads ${M(at103.netGex)} on flow (rows −1.15M, + date 1 −0.70M, + date 2 +0.10M = −1.75M), 105 and 110 unchanged`, Math.abs(at103.netGex + 1.75e6) < 1 && flowAll.find(n => n.strike === 105)!.netGex === -1.2e6 && flowAll.find(n => n.strike === 110) === all[2]);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
