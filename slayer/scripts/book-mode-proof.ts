/*
  The desk's levels read ONE book: the open-interest book (docs/TWO_BOOK_SPEC_V2.md §6: never add open interest to flow
  inventory, never add the two books). The old "Live = open interest + signed volume" mode is retired; the flow book is
  its own board (Model 2, /api/tape/flowbook) on Pinpoint's Books page.

  1. Every function of data/bookMode.ts hands back the very object it was given, in either mode asked, and the mode is
     always the open-interest book; asking for "flow" changes nothing.
  2. A chain whose strikes carry the old flow legs (StrikeNode.flow) is read with its open-interest figures: the walls,
     the net and the flip off it equal the open-interest chain's, field for field.
  Run:  npx tsx scripts/book-mode-proof.ts
*/
import { bookInMode, bookMode, chainInMode, flowChainIn, flowChainOf, flowNode, setBookMode } from '../src/data/bookMode';
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

check('the mode is the open-interest book', bookMode() === 'oi');
setBookMode('flow');
check('asking for the retired flow mode changes nothing', bookMode() === 'oi');
check('flowNode hands back the node', chain.every(n => flowNode(n) === n));
check('flowChainOf / flowChainIn hand back the chain', flowChainOf(chain) === chain && flowChainIn(chain) === chain);
check('chainInMode(…, "flow") hands back the open-interest chain', chainInMode(chain, { d: chain }, 'flow') === chain);
check('bookInMode(…, "flow") hands back the snapshot', bookInMode(snap, 'flow') === snap);
const walls = pickLegWalls(chainInMode(chain, undefined, 'flow'), n => n.callGex, n => n.putGex);
const oiWalls = pickLegWalls(chain, n => n.callGex, n => n.putGex);
check(`walls off the open interest (${walls.callWall}/${walls.putWall}), never the flow legs`, walls.callWall === oiWalls.callWall && walls.putWall === oiWalls.putWall && walls.callWall === 105);
const net = chainInMode(chain, undefined, 'flow').reduce((a, n) => a + n.netGex, 0);
check('the net is the open-interest net', net === chain.reduce((a, n) => a + n.callGex + n.putGex, 0));

if (fail) {
  console.log(`book-mode-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log('book-mode-proof: the desk reads the open-interest book only; open interest is never added to flow');
