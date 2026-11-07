/*
  The Map's book switch (data/bookMode.ts) chooses which of the two books every chain IS (book/engineView.ts builds the
  chains from that book's cells); it never mixes them (docs/TWO_BOOK_SPEC_V2.md §6: never add open interest to flow
  inventory, never add the two books). The old "Live = open interest + signed volume" reading is retired.

  1. The switch holds 'oi' or 'flow' and tells its listeners; the old key's 'flow' (open interest + flow) is not carried.
  2. Every chain function of data/bookMode.ts hands back the very object it was given, in either mode: no chain is ever
     re-read through the old StrikeNode.flow legs, so the walls and the net off it are the chain's own figures.
  (That the chains are the chosen book's, cell by cell, is scripts/twobook-map-proof.ts.)
  Run:  npx tsx scripts/book-mode-proof.ts
*/
import { bookInMode, bookMode, chainInMode, flowChainIn, flowChainOf, flowNode, setBookMode, subscribeBookMode } from '../src/data/bookMode';
import { emptyNode } from '../src/data/book/scale';
import { pickLegWalls } from '../src/core/walls';
import type { MarketSnapshot, StrikeNode } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const node = (k: number, cg: number, pg: number, flowC: number, flowP: number): StrikeNode => ({
  ...emptyNode(k),
  callGex: cg,
  putGex: pg,
  netGex: cg + pg,
  flow: { gex: { call: flowC, put: flowP }, dex: { call: 0, put: 0 }, vex: { call: 0, put: 0 }, vanna: { call: 0, put: 0 }, charm: { call: 0, put: 0 } },
} as StrikeNode);
const chain = [node(95, -1e6, 4e6, -9e6, 1e6), node(100, -5e6, 2e6, -1e6, 8e6), node(105, -7e6, 1e6, -2e6, 0)];
const snap = { ticker: 'XYZ', spot: 100, chain, uwByDate: { '2026-11-20': chain }, uwChains: { ALL: chain } } as unknown as MarketSnapshot;

check('the switch starts on the open-interest book', bookMode() === 'oi');
let told = 0;
const off = subscribeBookMode(() => told++);
setBookMode('flow');
check('the switch turns to the flow book and tells its listeners', bookMode() === 'flow' && told === 1);
setBookMode('flow');
check('asking for the book already shown tells nobody', told === 1);
off();
check('flowNode hands back the node', chain.every(n => flowNode(n) === n));
check('flowChainOf / flowChainIn hand back the chain', flowChainOf(chain) === chain && flowChainIn(chain) === chain);
check('chainInMode(…, "flow") hands back the open-interest chain', chainInMode(chain, { d: chain }, 'flow') === chain);
check('bookInMode(…, "flow") hands back the snapshot', bookInMode(snap, 'flow') === snap);
const walls = pickLegWalls(chainInMode(chain, undefined, 'flow'), n => n.callGex, n => n.putGex);
const oiWalls = pickLegWalls(chain, n => n.callGex, n => n.putGex);
check(`walls off the chain's own figures (${walls.callWall}/${walls.putWall}), never the old flow legs`, walls.callWall === oiWalls.callWall && walls.putWall === oiWalls.putWall && walls.callWall === 105);
const net = chainInMode(chain, undefined, 'flow').reduce((a, n) => a + n.netGex, 0);
check('the net is the chain’s own net', net === chain.reduce((a, n) => a + n.callGex + n.putGex, 0));
setBookMode('oi');
check('the switch turns back', bookMode() === 'oi');

if (fail) {
  console.log(`book-mode-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log('book-mode-proof: the switch picks one book; a chain is never re-read through the retired open interest + flow legs');
