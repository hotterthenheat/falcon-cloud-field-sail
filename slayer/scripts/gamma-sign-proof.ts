/*
  Gamma sign and book proof for Pinpoint. The book's gamma is the vendor's open-interest gamma, kept in the house sign
  (core/dealerSign.ts: calls negative, puts positive) and printed in the dealer sign: a put-only strike reads short gamma, a
  call-only strike long, every other greek follows the same model (dealers long the calls, short the puts), and one SPY
  expiry's book (captured rows, scripts/fixtures/spy-2026-10-29.json) nets exactly what the vendor's rows sum
  to, contracts laid on or not. Also: the flip's outright pricing of far legs, the hold, and the trading clock.
  Run:  npx tsx scripts/gamma-sign-proof.ts
*/
import { readFileSync } from 'node:fs';
import { expiryBookFromRows } from '../src/data/uwBook';
import { regimeOfNet, stickFlip } from '../src/data/flipLevel';
import { pickLegWalls } from '../src/core/walls';
import { dollarGammaPerContract, netGammaAt, repricedFlip, type GammaLeg } from '../src/core/gammaFlip';
import { tradingMinutes, tradingMinutesBetween, tradingYears } from '../src/core/tradingYear';
import { buildExpectedMoveCone, daySigmaOfIv, sigmaFromStraddle, STRADDLE_K, touchOdds } from '../src/data/expectedMove';
import { contractHigher } from '../src/data/liveHigher';
import { buildFlowFromRows, buildHedgeFlowLadder } from '../src/data/hedgeFlow';
import { blackScholesGreeks } from '../src/core/greeks';
import { dealerOf, keptLeg, keptVendorLeg } from '../src/core/dealerSign';
import { dealerInventory } from '../src/core/volClock';
import { dealerPuts, emptyNode } from '../src/data/book/scale';
import { shownGreek } from '../src/components/gex/retailSign';
import type { StrikeNode } from '../src/types/market';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
function normal(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}
const M = (v: number) => `${(v / 1e6).toFixed(2)}M`;
/** Retail net (+ = dealers long gamma), as levelsFor prints it */
const retail = (chain: readonly StrikeNode[]) => -chain.reduce((a, n) => a + n.netGex, 0);
const house = (chain: readonly StrikeNode[]) => chain.reduce((a, n) => a + n.netGex, 0);

/* Pin the clock to the capture (after the 10/28 close): the near-dated contracts then carry heavy ask-side volume,
   the case that used to replace the vendor's gamma. */
const CAPTURE = Date.parse('2026-10-28T20:15:00Z');
const realNow = Date.now;
Date.now = () => CAPTURE;

const fx = JSON.parse(readFileSync(new URL('./fixtures/spy-2026-10-29.json', import.meta.url), 'utf8')) as {
  spot: number;
  expiry: string;
  spotExposures: Record<string, string>[];
  contracts: Record<string, unknown>[];
};
const { spot, expiry } = fx;
const occ = (right: 'C' | 'P', k: number) => `SPY${expiry.slice(2).replace(/-/g, '')}${right}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const row = (k: number, call: number, put: number) => ({ strike: String(k), expiry, price: String(spot), time: '2026-10-28T20:15:00Z', call_gamma_oi: String(call), put_gamma_oi: String(put) });
/* a contract bought hard at the ask: 1,000 open, 50,000 lifted */
const hot = (right: 'C' | 'P', k: number) => ({ option_symbol: occ(right, k), open_interest: 1000, volume: 60000, ask_volume: 50000, bid_volume: 5000, multi_leg_volume: 0, mid_volume: 5000, no_side_volume: 0, implied_volatility: '0.16', gamma: 0.05, vega: 0.1, nbbo_bid: '1.00', nbbo_ask: '1.02', last_tape_time: '2026-10-28T20:14:00Z' });

/* 1 — sign of a one-sided strike, with and without its contracts laid on */
{
  const putRow = [row(765, 0, -5_000_000)];
  for (const [label, contracts] of [['rows only', []], ['with ask-heavy contracts', [hot('P', 765)]]] as const) {
    const book = expiryBookFromRows(putRow, contracts as never[], spot, expiry);
    const net = retail(book);
    check(`put-only strike (${label}) reads short gamma: retail net ${M(net)} < 0, regime ${regimeOfNet(house(book))}`, net < 0 && regimeOfNet(house(book)) === 'SHORT' && Math.abs(net + 5_000_000) < 1e-6);
  }
  const callRow = [row(780, 5_000_000, 0)];
  for (const [label, contracts] of [['rows only', []], ['with ask-heavy contracts', [hot('C', 780)]]] as const) {
    const book = expiryBookFromRows(callRow, contracts as never[], spot, expiry);
    const net = retail(book);
    check(`call-only strike (${label}) reads long gamma: retail net ${M(net)} > 0, regime ${regimeOfNet(house(book))}`, net > 0 && regimeOfNet(house(book)) === 'LONG' && Math.abs(net - 5_000_000) < 1e-6);
  }
}

/* 2 — SPY's 10/29 book equals the vendor's rows */
{
  const vendorNet = fx.spotExposures.reduce((a, r) => a + Number(r.call_gamma_oi) + Number(r.put_gamma_oi), 0);
  const bare = expiryBookFromRows(fx.spotExposures, [], spot, expiry);
  const book = expiryBookFromRows(fx.spotExposures, fx.contracts as never[], spot, expiry);
  check(`SPY ${expiry} vendor rows sum ${M(vendorNet)}; book ${M(retail(bare))} (rows), ${M(retail(book))} (contracts laid on)`, Math.abs(retail(bare) - vendorNet) < 1 && Math.abs(retail(book) - vendorNet) < 1);
  const k772 = book.find(n => n.strike === 772)!;
  const v772 = fx.spotExposures.find(r => Number(r.strike) === 772)!;
  check(`SPY 772: call ${M(-k772.callGex)} put ${M(-k772.putGex)} = vendor ${M(Number(v772.call_gamma_oi))} / ${M(Number(v772.put_gamma_oi))}`, Math.abs(-k772.callGex - Number(v772.call_gamma_oi)) < 1 && Math.abs(-k772.putGex - Number(v772.put_gamma_oi)) < 1);
  const oi772 = (fx.contracts.find(c => c.option_symbol === occ('C', 772))?.open_interest as number) ?? 0;
  check(`SPY 772C counts its open interest (${k772.callBook}) for every greek, not a flow inventory`, k772.callBook === oi772 && oi772 === 1310);
  /* units (docs/DATA_MAP.md §7): the spot-exposure row is dollars per 1% — Γ·OI·100 shares × S²·1% at the row's price */
  {
    const c772 = fx.contracts.find(c => c.option_symbol === occ('C', 772))!;
    const px = Number(v772.price);
    const dollars = Number(c772.gamma) * oi772 * 100 * px * px * 0.01;
    check(`units: 772C Γ·OI·100·S²·1% = ${M(dollars)} at ${px} against the row's ${M(Number(v772.call_gamma_oi))} (shares would read ${(Number(c772.gamma) * oi772 * 100).toFixed(0)})`, Math.abs(dollars / Number(v772.call_gamma_oi) - 1) < 0.05);
  }
  /* the walls off the book against the walls off the raw rows */
  const w = pickLegWalls(book, n => n.callGex, n => n.putGex);
  const by = (f: (r: Record<string, string>) => number) => Number(fx.spotExposures.reduce((b, r) => (f(r) > f(b) ? r : b)).strike);
  const rawCall = by(r => Math.abs(Number(r.call_gamma_oi)));
  const rawPut = by(r => Math.abs(Number(r.put_gamma_oi)));
  const rawSup = by(r => Math.abs(Number(r.call_gamma_oi) + Number(r.put_gamma_oi)));
  const sup = book.reduce((b, n) => (Math.abs(n.netGex) > Math.abs(b.netGex) ? n : b)).strike;
  check(`SPY walls off the book = off the raw rows: call ${w.callWall}/${rawCall}, put ${w.putWall}/${rawPut}, supreme ${sup}/${rawSup}`, w.callWall === rawCall && w.putWall === rawPut && sup === rawSup);
  /* the flip off the same rows, each leg at its own contract vol on the trading clock */
  const t = tradingYears(expiry, CAPTURE);
  const legs: GammaLeg[] = [];
  for (const n of book) {
    if (n.callGex || n.callOI) legs.push({ strike: n.strike, g0: n.callGex, iv: n.callIv ?? 0, t, s0: spot, oi: n.callOI || undefined, side: -1, ownIv: !!n.callIv });
    if (n.putGex || n.putOI) legs.push({ strike: n.strike, g0: n.putGex, iv: n.putIv ?? 0, t, s0: spot, oi: n.putOI || undefined, side: 1, ownIv: !!n.putIv });
  }
  const flip = repricedFlip(legs, spot, 0.042, 0.1, 0);
  check(`SPY ${expiry} flip ${flip.flip?.toFixed(2)} sits $1–2 below spot (vendor rows recomputed ≈770.9–771.3), long gamma at spot`, flip.flip != null && flip.flip > 769.5 && flip.flip < 772 && flip.netAtSpot < 0);
  /* the hedge-flow ladder integrates that re-priced profile from spot to each rung */
  const near = book.filter(n => Math.abs(n.strike - spot) <= 12);
  const profile = { strikes: near.map(n => ({ strike: n.strike, gex: { net: n.netGex } })), levels: { spot } } as never;
  const at = (S: number) => netGammaAt(legs, spot, S, 0.042, 0);
  const ladder = buildHedgeFlowLadder(profile, prices => prices.map(at));
  let ok = true;
  for (const K of [765, 771, 775, 780]) {
    let fine = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const x = spot + ((K - spot) * (i + 0.5)) / N;
      fine += (at(x) / x) * ((K - spot) / N) * 100;
    }
    const got = ladder.rungs.find(r => r.strike === K)!.flow;
    console.log(`     flow to ${K}: ${M(got)} (fine sum ${M(fine)})`);
    if (Math.abs(got - fine) > 0.01 * Math.max(Math.abs(fine), 1e6)) ok = false;
  }
  check('the hedge-flow ladder equals ∫ G(x)·dx/(0.01·x) of the re-priced book', ok);
}

/* 3 — a far same-day leg the vendor prints ~0 gamma for at spot is priced outright from its open interest */
{
  const S0 = 500;
  const K = 525;
  const t = 120 / (390 * 252);
  const iv = 0.18;
  const per = dollarGammaPerContract(K, K, t, iv, 0.042, 0);
  const g0 = -5000 * dollarGammaPerContract(S0, K, t, iv, 0.042, 0);
  const leg: GammaLeg = { strike: K, g0, iv, t, oi: 5000, side: -1, ownIv: true };
  const at = netGammaAt([leg], S0, K, 0.042, 0);
  check(`0DTE 525C, 2h left, 18% vol, 5,000 OI (d1 at spot ${((Math.log(S0 / K) + (0.042 + iv * iv / 2) * t) / (iv * Math.sqrt(t))).toFixed(1)}): ${g0.toExponential(1)} at 500, ${M(-at)} at 525 (outright ${M(5000 * per)})`, Math.abs(at + 5000 * per) < 1 && Math.abs(at) > 1e8);
  const noOi = netGammaAt([{ ...leg, oi: undefined, side: undefined }], S0, K, 0.042, 0);
  check(`…and without open interest it is carried flat (${noOi.toExponential(1)})`, noOi === g0);
}

/* 4 — the hold never prints a flip that is not one of the current read's crossings */
{
  Date.now = realNow;
  const key = `PROOF|${Math.random()}`;
  const reads = [[770.9], [770.95, 774.2], [774.1], [774.1], [774.0, 760], [], [771.2]];
  let ok = true;
  let n = 0;
  for (const xs of reads) {
    const r = stickFlip(key, { flip: xs[0] ?? null, netAtSpot: -1, beyond: null, range: 0.1, method: 'repriced', crossings: xs }, 772.3, 1e12 + n * 70_000, `r${n++}`);
    if (r.flip != null && !xs.includes(r.flip)) ok = false;
    if (r.flip == null && xs.length) ok = false;
    if (r.second != null && !xs.includes(r.second)) ok = false;
  }
  check('the held flip is always one of the current crossings', ok);
}

/* 5 — the trading clock: minutes between two instants match the old walk-to-2099 difference */
{
  let ok = true;
  const base = Date.parse('2026-10-26T13:00:00Z');
  for (let i = 0; i < 200; i++) {
    const a = base + Math.floor(Math.random() * 20 * 86_400_000);
    const b = a + Math.floor(Math.random() * 6 * 86_400_000);
    const old = (tradingMinutes('2099-12-31', a) ?? 0) - (tradingMinutes('2099-12-31', b) ?? 0);
    if (old !== tradingMinutesBetween(a, b)) ok = false;
  }
  const t0 = performance.now();
  for (let i = 0; i < 10_000; i++) tradingMinutesBetween(base + i * 60_000, base + 6 * 3_600_000);
  const ms = performance.now() - t0;
  check(`tradingMinutesBetween equals the old difference on 200 random pairs; 10,000 calls in ${ms.toFixed(1)}ms`, ok && ms < 500);
}

/* 6 — one σ: the straddle is ≈0.80σ; reach odds and the chart cone read the same σ */
{
  const S = 760;
  const iv = 0.174;
  /* one session of a 30-day calendar-year vol on the trading clock (core/volClock: the variance kept, ≈ σ/√252), the
     straddle that prices it, and back: the three must agree */
  const daySigma = daySigmaOfIv(S, iv) ?? 0;
  const straddle = STRADDLE_K * daySigma;
  const sigma = sigmaFromStraddle(straddle);
  const oldSigma = 0.68 * S * iv * Math.sqrt(1 / 365);
  const rows = [3, 5, 7, 10].map(d => ({ d, now: touchOdds(S, S + d, sigma), was: 2 * (1 - normal(d / oldSigma)) }));
  for (const r of rows) console.log(`     $${r.d} away: ${(r.now * 100).toFixed(0)}% (was ${(r.was * 100).toFixed(0)}%)`);
  const seven = rows.find(r => r.d === 7)!;
  check(`SPY ${S}, ATM ${iv * 100}%, 1 session: 1σ $${sigma.toFixed(2)} (straddle $${straddle.toFixed(2)}); a level $7 away reads ${(seven.now * 100).toFixed(0)}% (was ${(seven.was * 100).toFixed(0)}%)`, Math.abs(seven.now - 2 * (1 - normal(Math.log((S + 7) / S) / (sigma / S)))) < 1e-5 && sigma > 8.2 && sigma < 8.9);
  const bars = [{ time: 0, open: S, high: S, low: S, close: S, volume: 0 }];
  const cone = buildExpectedMoveCone(bars, iv, 390);
  const tip = cone.forward[cone.forward.length - 1];
  const coneSigma = tip.up1 - S;
  check(`the cone's 1σ at the close ($${coneSigma.toFixed(2)}) = the odds' 1σ off the same vol ($${(daySigmaOfIv(S, iv) ?? 0).toFixed(2)}) = straddle × √(π/2) ($${sigma.toFixed(2)})`, Math.abs(coneSigma - sigma) < 1e-6 && Math.abs((daySigmaOfIv(S, iv) ?? 0) - sigma) < 1e-6);
}

/* 7 — higher greeks in the units of the columns beside them (finite differences of the dealer-short dollar book) */
{
  const S = 772.31;
  const K = 772;
  const t = 390 / (390 * 252);
  const iv = 0.112;
  const n = 1310;
  const h = contractHigher(S, K, t, iv, n)!;
  const vegaUsd = (s: number, tt: number, v: number) => -blackScholesGreeks(s, K, tt, v).vega * n * 100;
  const gexUsd = (s: number, tt: number, v: number) => -blackScholesGreeks(s, K, tt, v).gamma * s * s * 0.01 * n * 100;
  const vommaFd = (vegaUsd(S, t, iv + 0.0001) - vegaUsd(S, t, iv - 0.0001)) / 0.02;
  const day = 1 / 252;
  const vetaFd = (vegaUsd(S, t - day / 100, iv) - vegaUsd(S, t + day / 100, iv)) / 0.02;
  const speedFd = (gexUsd(S * 1.0001, t, iv) - gexUsd(S * 0.9999, t, iv)) / 0.02;
  const vega = vegaUsd(S, t, iv);
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1);
  const K$ = (v: number) => `${(v / 1e3).toFixed(1)}K`;
  console.log(`     SPY 772C, 1 session, ${n} OI: VEGA ${K$(vega)} · VOMMA ${K$(h.vomma)} (fd ${K$(vommaFd)}) · VETA ${K$(h.veta)}/session (fd ${K$(vetaFd)}) · SPEED ${M(h.speed)} per 1% (fd ${M(speedFd)})`);
  check('vomma is $vega per vol point per vol point (finite difference of the VEGA column)', near(h.vomma, vommaFd, 0.01));
  check('veta is $vega per vol point per session, about half of VEGA one session out', near(h.veta, vetaFd, 0.02) && Math.abs(h.veta / vega) > 0.3 && Math.abs(h.veta / vega) < 0.7);
  /* speed holds S² fixed (∂Γ/∂S × the $ of 1%), the finite difference moves S² too: they differ by 2×$GEX×1% */
  check('speed is $GEX per 1% move (∂Γ/∂S·S²·1%·S·1%)', near(h.speed, speedFd - 2 * gexUsd(S, t, iv) * 0.01, 0.01));
}

/* 8 — one dealer model on every greek (core/dealerSign.ts): a call-only strike prints each greek as dealers LONG the calls, a
   put-only strike as dealers SHORT the puts; every page turns every kept greek the same way */
{
  const t = tradingYears(expiry, CAPTURE);
  const signOf = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  let ok = true;
  for (const [right, k] of [['C', 780], ['P', 765]] as const) {
    const rows = [row(k, right === 'C' ? 5_000_000 : 0, right === 'P' ? -5_000_000 : 0)];
    const book = expiryBookFromRows(rows, [hot(right, k)] as never[], spot, expiry);
    const n = book.find(x => x.strike === k)!;
    const side = right === 'C' ? 1 : -1;
    const iv = (right === 'C' ? n.callIv : n.putIv) ?? 0;
    const g = blackScholesGreeks(spot, k, t, iv);
    const long = { gex: g.gamma, dex: right === 'C' ? g.deltaCall : g.deltaPut, vex: g.vega, vanna: g.vanna, charm: right === 'C' ? g.charmCall : g.charmPut };
    const kept = right === 'C' ? { gex: n.callGex, dex: n.callDex, vex: n.callVex, vanna: n.callVanna, charm: n.callCharm } : { gex: n.putGex, dex: n.putDex, vex: n.putVex, vanna: n.putVanna, charm: n.putCharm };
    for (const greek of ['gex', 'dex', 'vex', 'vanna', 'charm'] as const) {
      const want = side * signOf(long[greek]);
      const got = signOf(dealerOf(kept[greek]));
      const shown = signOf(shownGreek(greek, kept[greek]));
      console.log(`     ${right} ${k} ${greek}: dealer ${got > 0 ? '+' : '−'} (model ${want > 0 ? '+' : '−'}), printed ${shown > 0 ? '+' : '−'}`);
      if (got !== want || shown !== want) ok = false;
    }
  }
  check('every greek follows one model: dealers long the calls, short the puts — and prints in that sign', ok);
}

/* 9 — the flow book's contract counts follow the same model: dealers are long the calls (an ask buy leaves them fewer)
   and short the puts (an ask buy leaves them MORE short) — the vendor's own put_gamma_ask prints with put_gamma_oi's
   sign (SPY 10/30 755P: oi −101.3M, ask −784.7M, bid +750.1M). 1,000 open, 50,000 lifted, 5,000 hit. */
{
  const calls = dealerInventory(1000, 50000, 5000, 0, 60000);
  const puts = dealerPuts(1000, 50000, 5000, 0, 60000);
  check(`ask-heavy call: dealers long ${calls} (1,000 − 50,000 + 5,000); ask-heavy put: dealers short ${puts} (1,000 + 50,000 − 5,000)`, calls === -44000 && puts === 46000);
  const vendorPutDealer = keptVendorLeg('P', -101.3e6 - 784.7e6 + 750.1e6, true);
  const countPutDealer = keptLeg('P', 1, puts);
  check('the put count moves the dealer the way the vendor\'s ask and bid columns do (both more short gamma)', Math.sign(vendorPutDealer) === Math.sign(countPutDealer));
}

/* 10 — a row without delta, vanna and charm is not a zero book: its contracts price them (C 780, P 765 above) */
{
  const book = expiryBookFromRows([row(780, 5_000_000, 0)], [hot('C', 780)] as never[], spot, expiry);
  const n = book.find(x => x.strike === 780)!;
  check(`no vendor delta: the call's $delta is its contracts' (${M(dealerOf(n.callDex))} for 1,000 OI)`, dealerOf(n.callDex) > 0 && dealerOf(n.callVanna) !== 0 && dealerOf(n.callCharm) !== 0);
}

/* 11 — the regime and the flip read one curve. A book priced at 100 (call leg 103 −0.9M, put leg 97 +1.0M, house sign,
   20 sessions, 25%) read at a live spot of 101.5: Σg0 = +0.1M (short), but re-priced at 101.5 the net is −0.069M (long)
   and the crossing is at 100.87, below spot — before, netAtSpot was Σg0 and the page said "short gamma" above a flip. */
{
  const t20 = 20 / 252;
  const legs: GammaLeg[] = [
    { strike: 103, g0: -0.9e6, iv: 0.25, t: t20, s0: 100 },
    { strike: 97, g0: 1e6, iv: 0.25, t: t20, s0: 100 },
  ];
  const r = repricedFlip(legs, 101.5, 0.042, 0.1, 0);
  const exact = netGammaAt(legs, 101.5, 101.5, 0.042, 0);
  check(`priced at 100, read at 101.5: net at spot ${M(r.netAtSpot)} (re-priced ${M(exact)}; Σg0 +0.10M), regime ${regimeOfNet(r.netAtSpot)}, flip ${r.flip?.toFixed(2)} below spot`, Math.abs(r.netAtSpot - exact) < 1e-6 && regimeOfNet(r.netAtSpot) === 'LONG' && r.flip != null && Math.abs(r.flip - 100.8746) < 0.001 && r.beyond === 'short');
  const atFlip = netGammaAt(legs, 101.5, r.flip!, 0.042, 0);
  check(`the flip is the exact curve's zero, not the grid's line between points (net there ${atFlip.toExponential(1)})`, Math.abs(atFlip) < 1e-3);
  /* two 0DTE legs ($90 call, $110 put, 5 minutes, 20%): between them both underflow to an exact 0 — the net steps from
     long through a run of exact zeros to short. The old walk skipped any zero point and found no flip. */
  const t5 = 5 / (390 * 252);
  const far: GammaLeg[] = [
    { strike: 90, g0: 0, iv: 0.2, t: t5, oi: 1000, side: -1 },
    { strike: 110, g0: 0, iv: 0.2, t: t5, oi: 1000, side: 1 },
  ];
  const z = repricedFlip(far, 100, 0.042, 0.15, 0);
  check(`a crossing through exact zeros is found: flip ${z.flip?.toFixed(2)} inside the zero run (90…110)`, z.flip != null && z.flip > 91 && z.flip < 109 && netGammaAt(far, 100, z.flip, 0.042, 0) === 0);
}

/* 12 — Terrain's ladder off bare rows is the same integral. Spot 100, 20 sessions, 25%: 1,000 calls at each strike
   100…115 and 1,500 puts at each 85…100 (house net at spot +$1.34M, short gamma; −$1.12M at 102, long). The old rows
   arithmetic (the net of the strikes crossed × the move) read −$1.68M to 102 — dealers selling $1.7M; the book re-priced
   along the walk says dealers BUY $0.21M. Without re-pricing no rung is drawn: the net at spot carried flat reads
   +1.34M to 101 against +0.71M re-priced. */
{
  const S = 100;
  const t20 = 20 / 252;
  const book: GammaLeg[] = [];
  for (let k = 85; k <= 115; k++) {
    if (k >= 100) book.push({ strike: k, g0: -1000 * dollarGammaPerContract(S, k, t20, 0.25, 0.042, 0), iv: 0.25, t: t20, oi: 1000, side: -1, ownIv: true });
    if (k <= 100) book.push({ strike: k, g0: 1500 * dollarGammaPerContract(S, k, t20, 0.25, 0.042, 0), iv: 0.25, t: t20, oi: 1500, side: 1, ownIv: true });
  }
  const rows = [...new Set(book.map(l => l.strike))].map(k => ({ strike: k, value: book.filter(l => l.strike === k).reduce((a, l) => a + l.g0, 0) }));
  const G = (x: number) => netGammaAt(book, S, x, 0.042, 0);
  const integral = (K: number) => {
    let f = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const x = S + ((K - S) * (i + 0.5)) / N;
      f += (G(x) / x) * ((K - S) / N) * 100;
    }
    return f;
  };
  const ladder = buildFlowFromRows(rows, S, prices => prices.map(G));
  const at102 = ladder.rungs.find(r => r.strike === 102)!.flow;
  check(`rows ladder to 102: ${M(at102)} (dealers buy) against the integral ${M(integral(102))} (the old rows sum read −1.68M)`, Math.abs(at102 - integral(102)) < 0.01 * Math.abs(integral(102)) && Math.abs(integral(102) - 0.2054e6) < 0.002e6);
  const flat = buildFlowFromRows(rows, S);
  const firstOrder101 = G(S) * Math.log(101 / S) * 100;
  check(`no re-pricing, no rungs (${flat.rungs.length}): first order would read ${M(firstOrder101)} to 101 against ${M(integral(101))}`, flat.rungs.length === 0 && Math.abs(firstOrder101 / integral(101) - 1) > 0.5);
}

/* 13 — the surface's columns count trading sessions, not calendar days (it once put dte in `sessions`) */
{
  const { sessionsTo } = await import('../src/data/exposureSurface');
  const fri = Date.parse('2026-10-30T18:00:00Z');
  const got = [sessionsTo('2026-10-30', fri), sessionsTo('2026-11-02', fri), sessionsTo('2026-11-06', fri), sessionsTo('2026-11-27', Date.parse('2026-11-25T15:00:00Z'))];
  check(`sessions to expiry from Fri 10/30: same day ${got[0]}, Mon ${got[1]} (3 calendar days), next Fri ${got[2]}; Wed 11/25 → Fri 11/27 over Thanksgiving ${got[3]}`, JSON.stringify(got) === JSON.stringify([0, 1, 5, 1]));
}

/* 14 — a level the book does not have is blank, never the spot: a call-only book at 100 has no put wall and no flip */
{
  const { buildVannaCharm } = await import('../src/data/vannacharm');
  const chain = [100, 105].map(k => ({ ...emptyNode(k), callGex: -1e6, netGex: -1e6, callOI: 100 }));
  const vc = buildVannaCharm({ ticker: 'TEST', spot: 100, chain } as never, 'CHARM', -1);
  check(`call-only book: put wall ${vc.read.putWall.price} (${vc.read.putWall.distPct}%), flip ${vc.read.flip.price} — not 100 "0.00% away"`, Number.isNaN(vc.read.putWall.price) && Number.isNaN(vc.read.putWall.distPct) && Number.isNaN(vc.read.flip.price) && vc.read.callWall.price === 100);
}

/* 15 — one test rule (levelRecord levelTicks): a visit is one test however many bars it sits on the level. A call wall
   at 100: three bars on it then away below (one test, held), back up and a close at 100.5 (a second test, broke), back
   under, then a close at 100.01 (inside the ±0.02% band: not beyond). The old ticks read 5 tests and 2 breaks (every
   bar on the level a test, the 100.01 close a break); the wall card counted 3 visits — the Map's report disagreed. */
{
  const { levelTicks, levelTests } = await import('../src/data/levelRecord');
  const { testEvents } = await import('../src/data/wall');
  const { flipCrossings } = await import('../src/data/flipGauge');
  const bar = (time: number, low: number, high: number, close: number) => ({ time, open: close, high, low, close, volume: 0 });
  const bars = [bar(1, 99.5, 100.2, 99.9), bar(2, 99.6, 100.1, 99.8), bar(3, 99.7, 100.05, 99.9), bar(4, 99.0, 99.5, 99.2), bar(5, 99.4, 100.6, 100.5), bar(6, 99.3, 99.9, 99.5), bar(7, 99.6, 100.1, 100.01)];
  const ticks = levelTicks(bars, 100, 'call');
  const t = levelTests(bars, 100, 'call');
  const w = testEvents(bars, 100, 'call');
  check(`one rule: ${ticks.map(x => `${x.kind}@${x.i}`).join(' ')} — ${t.tests} tests, ${t.held} held, ${t.broke} broke; the wall card reads the same (${w.tests}/${w.held}/${w.broke})`, JSON.stringify(ticks.map(x => [x.kind, x.i])) === JSON.stringify([['held', 3], ['broke', 4], ['held', 6]]) && JSON.stringify(t) === JSON.stringify(w) && t.tests === 3);
  check(`the flip's crossings on the same bars at 100: ${flipCrossings(bars, 100)} (up through 100.5, back under; 100.01 is inside the band)`, flipCrossings(bars, 100) === 2);
}

/* 16 — spot under every strike (strikes 100…140, spot 50): the profile's window is the lowest strikes (100…110), the nearest —
   it took the highest (140…120), the farthest */
{
  const { buildExposureProfile } = await import('../src/data/exposure');
  const chain = Array.from({ length: 41 }, (_, i) => ({ ...emptyNode(100 + i), callGex: -1e5, netGex: -1e5, callOI: 10 }));
  const p = buildExposureProfile({ ticker: 'TEST', spot: 50, chain } as never, '0DTE', 10);
  const ks = p.strikes.map(s => s.strike);
  check(`spot 50 under strikes 100–140: the window is ${Math.min(...ks)}–${Math.max(...ks)} (${ks.length} strikes)`, Math.min(...ks) === 100 && Math.max(...ks) === 110 && ks.length === 11);
}

/* 17 — the whole book's vega is the live dates' only: a settled 10/27 date holding −5 of call vex
   and a live 2027-01-15 date holding −3 put −3 on the whole book, not −8 */
{
  const { vexOntoAll } = await import('../src/data/book/levels');
  const node = (vex: number) => ({ ...emptyNode(770), callVex: vex, netVex: vex });
  const entry = { all: [node(0)], byDate: { '2026-10-27': [node(-5)], '2027-01-15': [node(-3)] } } as never as { all: StrikeNode[] };
  vexOntoAll(entry as never);
  check(`whole-book call vex at 770: ${entry.all[0].callVex} (the settled 10/27 date's −5 left off)`, entry.all[0].callVex === -3);
}

/* 18 — the exposure log's series end at the expiry's own close: 13:00 New York on the day after Thanksgiving, not 16:00
   (the field drew three hours of a dead 11/27 series) */
{
  const { closeOf } = await import('../src/data/book/exposureSegs');
  const hm = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  check(`series close: 11/27 ${hm(closeOf('2026-11-27'))}, 11/30 ${hm(closeOf('2026-11-30'))}`, hm(closeOf('2026-11-27')) === '13:00' && hm(closeOf('2026-11-30')) === '16:00');
}

if (fail) {
  console.log(`\n${fail} failed`);
  process.exit(1);
}
console.log('\nall gamma sign checks pass');
