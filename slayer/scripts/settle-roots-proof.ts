/*
  WHICH ROOTS THE BOOK COUNTS, AND WHEN EACH STOPS (audit 2026-11-06, items 6 and 7) — core/settle.ts,
  book/scale.ts foldContracts / paintLegs / withLiveGamma, data/liveHigher.ts, data/flipLevel.ts.

  A synthetic SPX monthly, 2026-11-20 (a third Friday), every strike listed on both roots: SPX (AM, settles at 09:30 on
  the 20th off the opening prints; last trade Thursday the 19th) and SPXW (PM, trades to 16:00 on the 20th), plus two
  strikes only the AM root lists. Each contract's quote is a Black-Scholes price on ITS OWN clock at its own vol (AM
  20%–24%, PM 16%–19%), its `gamma` the vendor's at that clock, and the vendor's spot-exposure row at each strike the
  sum of both roots' gamma × OI × 100 × S² × 1% — the vendor's rows keep the AM contracts after the open (SPX
  2026-10-16 16:15: all 52 strikes with AM open interest read AM + PM, against ThetaData's SPX and SPXW reports).

  Thursday 14:00 ET: two hours of trading left on the AM contracts, 510 minutes on the PM. Before, the AM quote at a
  strike the AM root alone lists was solved on the PM clock (its vol came out at √(120/510) of the truth) and its
  greeks priced there; at a strike both list, whichever row came last set the strike's vol.
  Friday 10:00 ET: the AM contracts are settled. Before, their open interest and the vendor's gamma for them stayed in
  the book — net GEX, walls and flip on contracts that no longer exist.
  An adjusted root (AAPL1, not 100 shares) was summed into AAPL at ×100 and its quote could set the strike's vol.

  Run: npx tsx scripts/settle-roots-proof.ts
*/
import { foldContracts, paintLegs, withLiveGamma, liveGammaRows, pricedClockOf, type LiveGamma } from '../src/data/book/scale';
import { amCalendarYears, amGone, amTradingYears, settleOf } from '../src/core/settle';
import { tradingYears } from '../src/core/tradingYear';
import { calendarYears, quotedVolPoint } from '../src/core/volClock';
import { nyInstant } from '../src/core/session';
import { dealerOf } from '../src/core/dealerSign';
import { addHigher, amStrikeHigher, contractHigher, strikeHigher } from '../src/data/liveHigher';
import type { UwContract } from '../src/data/whales';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* ---- an independent Black-Scholes (no app code) ---- */
function erf(z: number): number {
  const a = Math.abs(z);
  let e: number;
  if (a < 3) {
    let term = a;
    let sum = a;
    for (let i = 1; i < 300; i++) {
      term *= (-a * a) / i;
      sum += term / (2 * i + 1);
    }
    e = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    let cf = 0;
    for (let i = 80; i >= 1; i--) cf = i / 2 / (a + cf);
    e = 1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / (a + cf);
  }
  return z < 0 ? -e : e;
}
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const R = 0.042;
const d1 = (S: number, K: number, t: number, v: number) => (Math.log(S / K) + (R + v * v / 2) * t) / (v * Math.sqrt(t));
const price = (right: 'C' | 'P', S: number, K: number, t: number, v: number) => {
  const a = d1(S, K, t, v);
  const b = a - v * Math.sqrt(t);
  return right === 'C' ? S * N(a) - K * Math.exp(-R * t) * N(b) : K * Math.exp(-R * t) * N(-b) - S * N(-a);
};
const gammaOf = (S: number, K: number, t: number, v: number) => Math.exp(-0.5 * d1(S, K, t, v) ** 2) / Math.sqrt(2 * Math.PI) / (S * v * Math.sqrt(t));
const vegaPt = (S: number, K: number, t: number, v: number) => (S * Math.exp(-0.5 * d1(S, K, t, v) ** 2) / Math.sqrt(2 * Math.PI)) * Math.sqrt(t) / 100;

/* ---- the table ---- */
check('settleOf: SPX → AM, SPXW → PM; NDX/NDXP, RUT/RUTW the same; VIX and VIXW AM; the book reads SPXW as SPX', settleOf('SPX', 'SPX') === 'AM' && settleOf('SPX', 'SPXW') === 'PM' && settleOf('NDX', 'NDX') === 'AM' && settleOf('NDX', 'NDXP') === 'PM' && settleOf('RUT', 'RUTW') === 'PM' && settleOf('VIX', 'VIXW') === 'AM' && settleOf('SPXW', 'SPX') === 'AM');
check('settleOf: AAPL → PM; AAPL1 and AAPL2 (OCC adjusted) → ADJUSTED; BRK.B lists as BRKB → PM; a stray root on SPX → ADJUSTED', settleOf('AAPL', 'AAPL') === 'PM' && settleOf('AAPL', 'AAPL1') === 'ADJUSTED' && settleOf('AAPL', 'AAPL2') === 'ADJUSTED' && settleOf('BRK.B', 'BRKB') === 'PM' && settleOf('SPX', 'SPXQ') === 'ADJUSTED');

const EXP = '2026-11-20';
const S = 6900;
const thu = nyInstant('2026-11-19', 14 * 60);
const fri = nyInstant('2026-11-20', 10 * 60);
check(`the AM clock: Thursday 14:00 has ${(amTradingYears(EXP, thu)! * 390 * 252).toFixed(0)} trading minutes (to Thursday's close), the PM ${(tradingYears(EXP, thu) * 390 * 252).toFixed(0)}; settled from Friday 09:30`, Math.round(amTradingYears(EXP, thu)! * 390 * 252) === 120 && Math.round(tradingYears(EXP, thu) * 390 * 252) === 510 && !amGone(EXP, nyInstant(EXP, 9 * 60 + 29)) && amGone(EXP, nyInstant(EXP, 9 * 60 + 30)) && amTradingYears(EXP, fri) === null);
check('…and its calendar time runs to 09:30 Friday (19.5 h from Thursday 14:00)', Math.abs(amCalendarYears(EXP, thu) * 365 * 24 - 19.5) < 1e-9);

const BOTH = [6800, 6850, 6900, 6950, 7000];
const AM_ONLY = [6700, 7100];
const pmVol = (k: number) => 0.16 + 0.3 * Math.abs(Math.log(k / S));
const amVol = (k: number) => 0.2 + 0.3 * Math.abs(Math.log(k / S));
const OI_PM = (k: number, right: 'C' | 'P' = 'C') => (right === 'C' ? 1000 + (k % 300) : 600 + (k % 200));
const OI_AM = (k: number, right: 'C' | 'P' = 'C') => (right === 'C' ? 3000 + (k % 500) : 5000 + (k % 400));
const sym = (root: string, right: 'C' | 'P', k: number) => `${root}261120${right}${String(k * 1000).padStart(8, '0')}`;

function chainAt(at: number, amFirst: boolean): { contracts: UwContract[]; rows: Record<string, unknown>[]; pmG: Map<number, { c: number; p: number }> } {
  const tPm = tradingYears(EXP, at);
  /* after its settlement the vendor still prices the AM contract (its row and its `gamma`) as if it had the PM clock */
  const tAm = amTradingYears(EXP, at) ?? tPm;
  const time = new Date(at).toISOString();
  const contracts: UwContract[] = [];
  const rows: Record<string, unknown>[] = [];
  const pmG = new Map<number, { c: number; p: number }>();
  for (const k of [...BOTH, ...AM_ONLY].sort((a, b) => a - b)) {
    let c = 0;
    let p = 0;
    let pc = 0;
    let pp = 0;
    const leg = (root: 'SPX' | 'SPXW', right: 'C' | 'P') => {
      const am = root === 'SPX';
      const t = am ? tAm : tPm;
      const v = am ? amVol(k) : pmVol(k);
      const oi = am ? OI_AM(k, right) : OI_PM(k, right);
      const mid = price(right, S, k, t, v);
      const g = gammaOf(S, k, t, v);
      const dollars = g * oi * 100 * S * S * 0.01;
      if (right === 'C') c += dollars;
      else p -= dollars;
      if (!am && right === 'C') pc += dollars;
      if (!am && right === 'P') pp -= dollars;
      /* the vendor's calendar vol for the same variance on that contract's own clock */
      const tCal = am ? amCalendarYears(EXP, at) : calendarYears(EXP, at);
      contracts.push({ option_symbol: sym(root, right, k), open_interest: oi, volume: 0, implied_volatility: String(v * Math.sqrt(t / tCal)), nbbo_bid: String(mid * 0.995), nbbo_ask: String(mid * 1.005), last_tape_time: time, gamma: g, vega: 1 } as UwContract);
    };
    const roots: ('SPX' | 'SPXW')[] = AM_ONLY.includes(k) ? ['SPX'] : amFirst ? ['SPX', 'SPXW'] : ['SPXW', 'SPX'];
    for (const root of roots) for (const right of ['C', 'P'] as const) leg(root, right);
    rows.push({ strike: String(k), expiry: EXP, time, price: String(S), call_gamma_oi: String(c), put_gamma_oi: String(p) });
    pmG.set(k, { c: pc, p: pp });
  }
  return { contracts, rows, pmG };
}
const lay = (rows: Record<string, unknown>[]) => {
  const live: LiveGamma = new Map();
  liveGammaRows(rows, live);
  return withLiveGamma([], live, EXP);
};

/* ---- Thursday 14:00: both roots live ---- */
for (const amFirst of [true, false]) {
  const { contracts, rows } = chainAt(thu, amFirst);
  const chain = lay(rows);
  const at = pricedClockOf(chain).at;
  const book = foldContracts(contracts, EXP, at, 'SPX');
  /* no ticker: priced at the seam's carry, no parity spot (the fixture's quotes carry no forward to read) */
  const nodes = paintLegs(chain, book, true, S, EXP);
  const order = amFirst ? 'AM rows first' : 'PM rows first';
  const k = 6950;
  const n = nodes.find(x => x.strike === k)!;
  check(`Thu, ${order}: ${k}'s open interest is both roots' (${n.callOI} = ${OI_PM(k)} + ${OI_AM(k)}); the PM count the greeks take is the SPXW's (${n.callBook})`, n.callOI === OI_PM(k) + OI_AM(k) && n.callBook === OI_PM(k) && n.am?.callOI === OI_AM(k));
  check(`Thu, ${order}: ${k}'s vol is the SPXW's ${pmVol(k).toFixed(4)} (${n.callIv?.toFixed(4)}), its AM contract's own ${amVol(k).toFixed(4)} on its own clock (${n.am?.callIv.toFixed(4)})`, Math.abs((n.callIv ?? 0) - pmVol(k)) < 2e-3 && Math.abs((n.am?.callIv ?? 0) - amVol(k)) < 2e-3);
  const ko = 7100;
  const o = nodes.find(x => x.strike === ko)!;
  check(`Thu, ${order}: ${ko} (AM only) solves its quote on the AM clock — ${o.callIv?.toFixed(4)} against the true ${amVol(ko).toFixed(4)} (on the PM clock it read ${(amVol(ko) * Math.sqrt(120 / 510)).toFixed(4)})`, Math.abs((o.callIv ?? 0) - amVol(ko)) < 2e-3 && o.callBook === 0);
  /* the strike's dollar vega = the PM contracts' on the PM clock + the AM contracts' on theirs, by hand */
  const tPm = tradingYears(EXP, thu);
  const tAm = amTradingYears(EXP, thu)!;
  const volPm = quotedVolPoint(EXP, thu);
  const volAm = Math.sqrt(amCalendarYears(EXP, thu) / tAm);
  const vegaHand = 100 * (OI_PM(k) * vegaPt(S, k, tPm, pmVol(k)) * volPm + OI_AM(k) * vegaPt(S, k, tAm, amVol(k)) * volAm);
  check(`Thu, ${order}: ${k}C dollar vega ${(dealerOf(n.callVex) / 1e6).toFixed(4)}M = PM on 510 minutes + AM on 120, by hand ${(vegaHand / 1e6).toFixed(4)}M`, Math.abs(dealerOf(n.callVex) / vegaHand - 1) < 3e-3);
  /* the higher greeks the profile prints: the PM part on its clock plus the AM part on its own */
  const hp = addHigher(strikeHigher(S, k, tPm, n.callIv, n.putIv, n.callBook!, n.putBook!, volPm), amStrikeHigher(S, n, EXP, thu))!;
  const colorHand = (contractHigher(S, k, tPm, pmVol(k), OI_PM(k), 'C', volPm)?.color ?? 0) + (contractHigher(S, k, tAm, amVol(k), OI_AM(k), 'C', volAm)?.color ?? 0);
  check(`Thu, ${order}: ${k}C colour adds the AM contracts on their own two hours (${(dealerOf(hp.color.call) / 1e6).toFixed(2)}M against ${(dealerOf(colorHand) / 1e6).toFixed(2)}M)`, Math.abs(hp.color.call / colorHand - 1) < 2e-2);
  /* the flip's legs: each root's share of the row on its own clock, and the book re-priced 1% either way against both
     roots' gamma summed by hand at that price (sticky strike, each contract at its own vol and time) */
  {
    const { legsOfDate } = await import('../src/data/flipLevel');
    const { netGammaAt } = await import('../src/core/gammaFlip');
    const legs = legsOfDate(nodes, EXP, 0.18, thu, true, S, true, S);
    const k1 = legs.filter(l => l.strike === k);
    const ts = [...new Set(k1.map(l => Math.round(l.t * 390 * 252)))].sort((a, b) => a - b);
    check(`Thu, ${order}: ${k}'s flip legs run on 120 and 510 trading minutes (${ts.join(' and ')}), their gamma the row's`, ts.join() === '120,510' && Math.abs(k1.reduce((a, l) => a + l.g0, 0) - n.netGex) < 1e-6);
    for (const x of [S * 0.99, S * 1.01]) {
      let hand = 0;
      for (const kk of [...BOTH, ...AM_ONLY]) for (const right of ['C', 'P'] as const) {
        const side = right === 'C' ? 1 : -1;
        if (!AM_ONLY.includes(kk)) hand += side * OI_PM(kk, right) * 100 * gammaOf(x, kk, tPm, pmVol(kk)) * x * x * 0.01;
        hand += side * OI_AM(kk, right) * 100 * gammaOf(x, kk, tAm, amVol(kk)) * x * x * 0.01;
      }
      const got = -netGammaAt(legs, S, x, R, 0);
      check(`Thu, ${order}: the flip's book re-priced at ${x.toFixed(0)} is both roots' gamma there on their own clocks (${(got / 1e9).toFixed(3)}B, by hand ${(hand / 1e9).toFixed(3)}B)`, Math.abs(got / hand - 1) < 0.01);
    }
  }
  check(`Thu, ${order}: the row's gamma is all still in the book (both roots trade)`, nodes.every(x => !x.cut) && Math.abs(nodes.reduce((a, x) => a + x.netGex, 0) - chain.reduce((a, x) => a + x.netGex, 0)) < 1e-6);
}

/* ---- Friday 10:00: the AM contracts settled at 09:30 ---- */
{
  const { contracts, rows, pmG } = chainAt(fri, true);
  const chain = lay(rows);
  const book = foldContracts(contracts, EXP, pricedClockOf(chain).at, 'SPX');
  const nodes = paintLegs(chain, book, true, S, EXP);
  const k = 6950;
  const n = nodes.find(x => x.strike === k)!;
  check(`Fri 10:00: ${k}'s open interest is the SPXW's alone (${n.callOI}; the AM ${OI_AM(k)} settled at 09:30)`, n.callOI === OI_PM(k) && n.putOI === OI_PM(k, 'P') && !n.am);
  const pmNet = [...pmG.values()].reduce((a, v) => a + v.c + v.p, 0);
  const rowNet = rows.reduce((a, r) => a + Number(r.call_gamma_oi) + Number(r.put_gamma_oi), 0);
  const net = nodes.reduce((a, x) => a + dealerOf(x.netGex), 0);
  check(`Fri 10:00: net GEX is the SPXW contracts' ${(pmNet / 1e9).toFixed(3)}B (${(net / 1e9).toFixed(3)}B); the vendor's rows still read ${(rowNet / 1e9).toFixed(3)}B`, Math.abs(net / pmNet - 1) < 1e-9 && Math.abs(rowNet / pmNet - 1) > 0.5);
  check('Fri 10:00: the strikes only the AM root listed hold nothing', AM_ONLY.every(ko => { const o = nodes.find(x => x.strike === ko)!; return o.netGex === 0 && o.callOI === 0 && o.callVex === 0 && o.putVex === 0; }));
  /* a minute later the rows are laid on again: the cut is taken off the raw row once, never twice */
  const live: LiveGamma = new Map();
  liveGammaRows(rows, live);
  const again = withLiveGamma(nodes, live, EXP);
  check('Fri: the next minute\'s rows laid on the painted chain cut the same share once', again.every((x, i) => Math.abs(x.netGex - nodes[i].netGex) < 1e-6));
}

/* ---- Thursday's painted chain, Friday's rows laid on at 10:00: the AM contracts turn settled without a new read ---- */
{
  const thuChain = chainAt(thu, true);
  const c0 = lay(thuChain.rows);
  const painted = paintLegs(c0, foldContracts(thuChain.contracts, EXP, pricedClockOf(c0).at, 'SPX'), true, S, EXP);
  const friChain = chainAt(fri, true);
  const live: LiveGamma = new Map();
  liveGammaRows(friChain.rows, live);
  const next = withLiveGamma(painted, live, EXP);
  const pmNet = [...friChain.pmG.values()].reduce((a, v) => a + v.c + v.p, 0);
  const net = next.reduce((a, x) => a + dealerOf(x.netGex), 0);
  /* the share is Thursday's (gamma × OI then), so the net is near, not exactly, Friday's PM-only */
  check(`Thu's chain under Fri 10:00 rows: no AM leg left live, their open interest off (6950C ${next.find(x => x.strike === 6950)!.callOI}), net ${(net / 1e9).toFixed(3)}B against the SPXW's ${(pmNet / 1e9).toFixed(3)}B`, next.every(x => !x.am) && next.find(x => x.strike === 6950)!.callOI === OI_PM(6950) && Math.abs(net / pmNet - 1) < 0.25);
  /* …and the AM contracts' vega comes off with them: what is left is the SPXW's, as Thursday priced it */
  const k = 6950;
  const pmVega = 100 * OI_PM(k) * vegaPt(S, k, tradingYears(EXP, thu), pmVol(k)) * quotedVolPoint(EXP, thu);
  const left = dealerOf(next.find(x => x.strike === k)!.callVex);
  check(`Thu's chain under Fri 10:00 rows: ${k}C dollar vega ${(left / 1e6).toFixed(4)}M is the SPXW contracts' alone (${(pmVega / 1e6).toFixed(4)}M; with the AM ${(dealerOf(painted.find(x => x.strike === k)!.callVex) / 1e6).toFixed(4)}M)`, Math.abs(left / pmVega - 1) < 3e-3);
}

/* ---- an adjusted root ---- */
{
  const at = nyInstant('2026-11-06', 11 * 60);
  const exp = '2026-11-13';
  const S2 = 270;
  const t = tradingYears(exp, at);
  const time = new Date(at).toISOString();
  const mk = (root: string, right: 'C' | 'P', k: number, v: number, oi: number, px?: number): UwContract => {
    const mid = px ?? price(right, S2, k, t, v);
    return { option_symbol: `${root}261113${right}${String(k * 1000).padStart(8, '0')}`, open_interest: oi, volume: 0, implied_volatility: String(v), nbbo_bid: String(mid * 0.99), nbbo_ask: String(mid * 1.01), last_tape_time: time, gamma: 0.02, vega: 0.2 } as UwContract;
  };
  /* AAPL1 270C: a deliverable of 150 shares plus cash — its quote is 1.5× the 270C's, and it comes last */
  const contracts = [mk('AAPL', 'C', 270, 0.3, 5000), mk('AAPL', 'P', 270, 0.3, 4000), mk('AAPL1', 'C', 270, 0.3, 800, 1.5 * price('C', S2, 270, t, 0.3)), mk('AAPL1', 'P', 270, 0.3, 600, 1.5 * price('P', S2, 270, t, 0.3))];
  const book = foldContracts(contracts, exp, at, 'AAPL');
  const leg = book.get(270)!;
  const rows = [{ strike: '270', expiry: exp, time, price: String(S2), call_gamma_oi: '1e8', put_gamma_oi: '-1e8' }];
  const live: LiveGamma = new Map();
  liveGammaRows(rows, live);
  const nodes = paintLegs(withLiveGamma([], live, exp), book, true, S2, exp, 'AAPL');
  const n = nodes[0];
  check(`AAPL1 (adjusted) is left out: 270C open interest ${n.callOI} (not ${5000 + 800}), its quote does not set the vol (${n.callIv?.toFixed(4)} — at its 1.5× price it reads far higher)`, n.callOI === 5000 && n.putOI === 4000 && Math.abs((n.callIv ?? 0) - 0.3) < 2e-3 && leg.adjusted === 2);
}

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nsettle-roots proof: all checks pass');
