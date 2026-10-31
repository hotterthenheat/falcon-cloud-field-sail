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
import { dealerPuts } from '../src/data/book/scale';
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
  const old = buildFlowFromRows(near.map(n => ({ strike: n.strike, value: n.netGex })), spot);
  let ok = true;
  for (const K of [765, 771, 775, 780]) {
    let fine = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const x = spot + ((K - spot) * (i + 0.5)) / N;
      fine += (at(x) / x) * ((K - spot) / N) * 100;
    }
    const got = ladder.rungs.find(r => r.strike === K)!.flow;
    const was = old.rungs.find(r => r.strike === K)!.flow;
    console.log(`     flow to ${K}: ${M(got)} (fine sum ${M(fine)}; the old crossed-strikes sum ${M(was)})`);
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
  const straddle = STRADDLE_K * S * iv * Math.sqrt(1 / 365);
  const sigma = sigmaFromStraddle(straddle);
  const oldSigma = 0.68 * S * iv * Math.sqrt(1 / 365);
  const rows = [3, 5, 7, 10].map(d => ({ d, now: touchOdds(S, S + d, sigma), was: 2 * (1 - normal(d / oldSigma)) }));
  for (const r of rows) console.log(`     $${r.d} away: ${(r.now * 100).toFixed(0)}% (was ${(r.was * 100).toFixed(0)}%)`);
  const seven = rows.find(r => r.d === 7)!;
  check(`SPY ${S}, ATM ${iv * 100}%, 1 session: 1σ $${sigma.toFixed(2)} (straddle $${straddle.toFixed(2)}); a level $7 away reads ${(seven.now * 100).toFixed(0)}% (was ${(seven.was * 100).toFixed(0)}%)`, Math.abs(seven.now - 0.31) < 0.015);
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

if (fail) {
  console.log(`\n${fail} failed`);
  process.exit(1);
}
console.log('\nall gamma sign checks pass');
