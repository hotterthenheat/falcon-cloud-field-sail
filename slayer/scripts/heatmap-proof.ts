/* The heatmap paints every Pinpoint name, and a short-dated index book is priced at the parity spot. */

import { heatCellStyle } from '../src/components/gex/heatmap';
import { impliedBookSpot, type ParityPair } from '../src/core/parity';
import { emptyNode, paintLegs } from '../src/data/book/scale';
import { DEFAULT_BOARD_NAMES } from '../src/data/boardNames';
import { nyIsoDate } from '../src/core/nyTime';

const fail = (m: string): never => {
  throw new Error(m);
};

const rgb = (v: number, max = 1e9) => {
  const s = heatCellStyle(v, max);
  const bg = String(s.backgroundColor ?? '');
  if (!bg.startsWith('rgb(') || bg.includes('NaN')) fail(`heat ${v} -> ${bg}`);
  return bg;
};

rgb(0);
rgb(1);
rgb(-1);
rgb(1e8, 5e8);
rgb(Number.NaN);
if (rgb(0) !== rgb(Number.NaN)) fail('a bad cell must paint as a zero, not a hole');

const cash = 5000;
const r = 0.04;
const hour = 1 / 365 / 24;
const quote = (mid: number): [number, number] => [mid * 0.98, mid * 1.02];
const leg = (k: number, call: number, put: number): ParityPair => {
  const [cb, ca] = quote(call);
  const [pb, pa] = quote(put);
  return { strike: k, callBid: cb, callAsk: ca, putBid: pb, putAsk: pa };
};
/* F = K + (C − P) at a tiny t, so each strike says 5004. */
const pairs = [leg(4990, 20, 6), leg(5000, 10, 6), leg(5010, 6, 12)];
const star = impliedBookSpot('SPX', cash, pairs, r, hour);
if (Math.abs(star - 5004) > 1) fail(`SPX spot ${star}`);
for (const t of ['SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'XSP']) {
  const s = impliedBookSpot(t, cash, pairs, r, hour);
  if (Math.abs(s - star) > 0.01) fail(`${t} stayed on the cash print`);
}
for (const t of DEFAULT_BOARD_NAMES) {
  if (impliedBookSpot(t, cash, pairs, r, hour) !== cash) fail(`${t} left the cash print`);
}
if (impliedBookSpot('SPX', cash, pairs, r, 30 / 365) !== cash) fail('a month-out index moved');

const book = new Map(pairs.map(p => [p.strike, {
  callOI: 10, putOI: 10, callVex: 0, putVex: 0, callVol: 0, putVol: 0,
  callIv: 0.2, putIv: 0.2, callGamma: 0, putGamma: 0,
  callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, callMulti: 0, putMulti: 0, callMid: 0, putMid: 0, callNone: 0, putNone: 0,
  callBidPx: p.callBid, callAskPx: p.callAsk, putBidPx: p.putBid, putAskPx: p.putAsk,
}]));
const nodes = pairs.map(p => emptyNode(p.strike));
const today = nyIsoDate();
const spx = paintLegs(nodes, book, true, cash, today, 'SPX');
const marked = spx.find(n => (n.bookPx ?? 0) > 0)?.bookPx ?? 0;
if (Math.abs(marked - star) > 1) fail(`painted SPX at ${marked}`);
const aapl = paintLegs(nodes, book, true, cash, today, 'AAPL');
if (aapl.some(n => n.bookPx != null)) fail('AAPL was priced off the index spot');
for (const n of spx) {
  if (!Number.isFinite(n.netVex) || !Number.isFinite(n.flow?.color.call ?? 0)) fail(`SPX ${n.strike} cell is not a number`);
}

console.log('heatmap-proof ok');
