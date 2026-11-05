/*
  The vendor's rows as the book's strike nodes (src/data/book/scale.ts), held to the math audit's terrain findings:
    T1 vanna is priced off the contracts, never the vendor's vanna_oi × price × 1% — that unit is $Δ per vol point on
       SPY and NVDA but ~11× on SPX and ~0.04× on F (2026-11-04 rows against Black-Scholes vanna·S·OI off the same
       contracts). The open-interest leg, the flow leg and a rows-only leg (none until the contracts are read).
    T2 charm on the flow book and on greek-exposure rows is put on the session clock at the rows' own minute, not the
       wall clock: a shut market's book does not drift overnight.
    T3 the flow book's delta is scaled at the price the vendor priced its columns at, as the open-interest book's is.
    T6 merged chains sum every leg (call and put vanna and charm, the traded volume), not only the nets.
  The clock is pinned (Date.now) so the five-session flow window and the "now" a wall-clock read would use are fixed.
*/
import { chainFrom, expiryBookFromRows, mergeChains, emptyNode, rowsClock } from '../src/data/book/scale';
import { dealerOf } from '../src/core/dealerSign';
import { dealerInventory, quotedVolPoint } from '../src/core/volClock';
import { tradingYears } from '../src/core/tradingYear';
import { getCarry } from '../src/core/carry';
import type { StrikeNode } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, rel = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1);

const realNow = Date.now;
const pin = (ms: number) => (Date.now = () => ms);

/* rows priced Wed 2026-10-28 16:15 ET at 777, read with the live price at 779; the expiry is Fri 10-30 */
const expiry = '2026-10-30';
const ROWS_AT = '2026-10-28T20:15:00Z';
const px = 777;
const spot = 779;
const K = 780;
const occ = (right: 'C' | 'P', k: number) => `SPY${expiry.slice(2).replace(/-/g, '')}${right}${String(Math.round(k * 1000)).padStart(8, '0')}`;
/* the vendor's row for the strike, every column it sends; its vanna deliberately in a foreign unit (×12.7, as on SPX) */
const vendorRow = (vannaOi: number) => ({
  strike: String(K), expiry, price: String(px), time: ROWS_AT,
  call_gamma_oi: '5000000', call_gamma_ask: '-30000000', call_gamma_bid: '4000000', put_gamma_oi: '0', put_gamma_ask: '0', put_gamma_bid: '0',
  call_delta_oi: '300000000000', call_delta_ask: '0', call_delta_bid: '0', put_delta_oi: '0', put_delta_ask: '0', put_delta_bid: '0',
  call_vanna_oi: String(vannaOi), call_vanna_ask: String(vannaOi * 3), call_vanna_bid: String(vannaOi / 2), put_vanna_oi: '0', put_vanna_ask: '0', put_vanna_bid: '0',
  call_charm_oi: '-90000000000', call_charm_ask: '40000000000', call_charm_bid: '-5000000000', put_charm_oi: '0', put_charm_ask: '0', put_charm_bid: '0',
});
const contract = { option_symbol: occ('C', K), open_interest: 1000, volume: 60000, ask_volume: 50000, bid_volume: 5000, multi_leg_volume: 0, mid_volume: 5000, no_side_volume: 0, implied_volatility: '0.16', gamma: 0.05, vega: 0.1, nbbo_bid: '1.00', nbbo_ask: '1.02', last_tape_time: '2026-10-28T20:14:00Z' };

/* an independent Black-Scholes vanna (∂Δ/∂σ per 1.00 of vol), written out here */
const phi = (x: number) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
const bsVanna = (S: number, k: number, t: number, v: number, r: number, q: number) => {
  const d1 = (Math.log(S / k) + (r - q + (v * v) / 2) * t) / (v * Math.sqrt(t));
  const d2 = d1 - v * Math.sqrt(t);
  return -Math.exp(-q * t) * phi(d1) * (d2 / v);
};

const book = (vannaOi: number, contracts: unknown[], now: number): StrikeNode => {
  pin(now);
  try {
    return expiryBookFromRows([vendorRow(vannaOi)], contracts as never[], spot, expiry).find(n => n.strike === K)!;
  } finally {
    Date.now = realNow;
  }
};

/* the evening after the rows, and the small hours of the next day: the same rows, two wall clocks */
const EVENING = Date.parse('2026-10-28T23:00:00Z');
const NIGHT = Date.parse('2026-10-29T07:30:00Z');

/* ---- T1: vanna off the contracts ---- */
{
  const at = Date.parse(ROWS_AT);
  const t = tradingYears(expiry, at);
  const volPt = quotedVolPoint(expiry, at);
  const { r, q } = getCarry();
  /* the contract's vanna per quoted vol point, × S × OI, dealers long the calls */
  const n = book(1.27e7, [contract], EVENING);
  const iv = n.callIv ?? NaN;
  const per = bsVanna(spot, K, t, iv, r, q) * spot * volPt;
  const vendorFigure = 1.27e7 * px * 0.01;
  check(`open-interest vanna is the contracts' Black-Scholes vanna × S × OI per quoted vol point: ${(dealerOf(n.callVanna) / 1e6).toFixed(3)}M = ${((per * 1000) / 1e6).toFixed(3)}M (the vendor's figure would read ${(vendorFigure / 1e6).toFixed(1)}M)`, near(dealerOf(n.callVanna), per * 1000, 1e-9), `${dealerOf(n.callVanna)} vs ${per * 1000}`);
  check('…and it does not move with the vendor\'s vanna column at all (×12.7 or ×0.034, the same figure)', near(book(1.27e7, [contract], EVENING).callVanna, book(3.4e4, [contract], EVENING).callVanna, 1e-12));
  const flow = n.flow!;
  const count = dealerInventory(1000, 50000, 5000, 0, 60000);
  check(`the flow book's vanna is the same contract vanna × the flow count (${count}): ${(dealerOf(flow.vanna.call) / 1e6).toFixed(3)}M`, !flow.held && near(dealerOf(flow.vanna.call), per * count, 1e-9), `held ${flow.held}, ${dealerOf(flow.vanna.call)} vs ${per * count}`);
  const bare = book(1.27e7, [], EVENING);
  check('rows only (no contracts read yet): no vanna — never the vendor\'s unit', bare.callVanna === 0 && bare.netVanna === 0, String(bare.callVanna));
  const rowsOnly = chainFrom([{ strike: K, date: '2026-10-28', call_vanna: 6.6e5, put_vanna: 3.3e5, call_charm: -9.6e6, call_delta: 1.9e5 }], spot, new Map(), undefined, expiry)[0];
  check('greek-exposure rows carry no vanna either (their unit is the vendor\'s too)', rowsOnly.callVanna === 0 && rowsOnly.putVanna === 0 && rowsOnly.callCharm !== 0);
}

/* ---- T2: the rows' own clock, not the wall clock ---- */
{
  const a = book(1.27e7, [contract], EVENING);
  const b = book(1.27e7, [contract], NIGHT);
  check(`the flow book's charm is the same at 19:00 and 03:30 with no new rows (${(a.flow!.charm.call / 1e6).toFixed(3)}M, ${(b.flow!.charm.call / 1e6).toFixed(3)}M)`, !a.flow!.held && a.flow!.charm.call === b.flow!.charm.call && a.flow!.charm.call !== 0, `${a.flow!.charm.call} vs ${b.flow!.charm.call}`);
  check('…and so is the open-interest charm', a.callCharm === b.callCharm);
  const rows = [{ strike: K, date: '2026-10-28', call_charm: -9.6e6, put_charm: -4.8e6 }];
  const ge = (now: number) => {
    pin(now);
    try {
      return chainFrom(rows, spot, new Map(), undefined, expiry)[0];
    } finally {
      Date.now = realNow;
    }
  };
  check(`greek-exposure rows of 10-28 put charm on the session clock at that session's close, whatever the wall clock (${(ge(EVENING).callCharm / 1e6).toFixed(3)}M both)`, ge(EVENING).callCharm === ge(NIGHT).callCharm, `${ge(EVENING).callCharm} vs ${ge(NIGHT).callCharm}`);
  check('the rows\' clock: 10-28 rows were priced at its 16:00 close; while that session trades, now', rowsClock(rows, NIGHT) === Date.parse('2026-10-28T20:00:00Z') && rowsClock(rows, Date.parse('2026-10-28T15:00:00Z')) === Date.parse('2026-10-28T15:00:00Z'));
}

/* ---- T3: the flow book's delta at the vendor's own price ---- */
{
  const n = book(1.27e7, [contract], EVENING);
  /* with no delta in the ask and bid columns the flow delta is the open-interest delta: both scaled at 777, not 779 */
  check(`flow delta = open-interest delta when the columns add nothing (${(n.flow!.dex.call / 1e6).toFixed(2)}M vs ${(n.callDex / 1e6).toFixed(2)}M; at the live price it read ×${(px / spot).toFixed(4)})`, !n.flow!.held && near(n.flow!.dex.call, n.callDex, 1e-12), `${n.flow!.dex.call} vs ${n.callDex}`);
}

/* ---- T6: merged chains sum every leg ---- */
{
  const a: StrikeNode = { ...emptyNode(100), callVanna: 1, putVanna: 2, netVanna: 3, callCharm: 4, putCharm: 5, netCharm: 9, callVol: 10, putVol: 20 };
  const b: StrikeNode = { ...emptyNode(100), callVanna: 10, putVanna: 20, netVanna: 30, callCharm: 40, putCharm: 50, netCharm: 90, callVol: 1, putVol: 2 };
  const c: StrikeNode = { ...emptyNode(100), callVanna: 100, putVanna: 0, netVanna: 100 };
  const m = mergeChains([[a], [b], [c]])[0];
  check(
    `merged: call vanna ${m.callVanna} + put ${m.putVanna} = net ${m.netVanna}; call charm ${m.callCharm} + put ${m.putCharm} = net ${m.netCharm}; volume ${m.callVol}/${m.putVol}`,
    m.callVanna === 111 && m.putVanna === 22 && m.netVanna === 133 && m.callCharm === 44 && m.putCharm === 55 && m.netCharm === 99 && m.callVol === 11 && m.putVol === 22,
  );
  check('…and the inputs are left as they were', a.callVanna === 1 && a.callVol === 10);
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
