/*
  Each expiry is priced off its own implied forward from put-call parity (core/parity.ts → core/carry.ts setForward →
  carryFor with the expiry), so SPX no longer prices with no yield.

  Known numbers (the audit's probes, /tmp/qa/theta-docs/report.md §2(a); copied to scripts/fixtures/theta-carry/):
  /option/at_time/quote at 15:30 ET on 2026-10-30, the 2027-01-15 expiry (77 days), four strikes; the spot then
  (SPX 7552.04, the index's at-time price; SPY 752.855, the mid of its at-time quote); SOFR 3.94%.
    SPX parity forward 7611.35–7611.55 (spread 0.2), implied carry ≈ 3.71%, q ≈ 0.23% at SOFR; S·e^{0.042T} 7619.3 (+7.9)
    SPY parity forward 757.09–757.49, q ≈ 1.1% at SOFR; S·e^{0.042T} 759.56 (+2.3)
  Run:  npx tsx scripts/forward-proof.ts
*/
import fs from 'node:fs';
import { carryFor, forwardFor, resetCarry, setDividend, setForward, setRate } from '../src/core/carry';
import { parityForward, type ParityPair } from '../src/core/parity';
import { blackScholesPrice } from '../src/core/greeks';
import { calendarYears } from '../src/core/volClock';
import { readContract } from '../src/data/weigherGate';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
const read = (f: string) => JSON.parse(fs.readFileSync(`scripts/fixtures/theta-carry/${f}`, 'utf8')).response;

function pairsOf(rows: { contract: { strike: number; right: string }; data: { bid: number; ask: number }[] }[]): ParityPair[] {
  const by = new Map<number, ParityPair>();
  for (const it of rows) {
    const q = it.data[it.data.length - 1];
    const p = by.get(it.contract.strike) ?? { strike: it.contract.strike, callBid: NaN, callAsk: NaN, putBid: NaN, putAsk: NaN };
    if (it.contract.right.startsWith('C')) Object.assign(p, { callBid: q.bid, callAsk: q.ask });
    else Object.assign(p, { putBid: q.bid, putAsk: q.ask });
    by.set(p.strike, p);
  }
  return [...by.values()];
}

const R = 0.0394;
const T77 = 77 / 365;
const NOW = Date.parse('2026-10-30T19:30:00Z'); // 15:30 New York
const DAY = '2026-10-30';
const EXP = '2027-01-15';
const SPX = read('spx-at-2026-10-30-1530.json')[0].price as number;
const spyQ = read('spy-at-2026-10-30-1530.json')[0];
const SPY = (spyQ.bid + spyQ.ask) / 2;
check(`the spots: SPX ${SPX}, SPY ${SPY}`, SPX === 7552.04 && Math.abs(SPY - 752.855) < 1e-9);

resetCarry();
setRate(R, 'live', DAY);

/* ---- SPX ---- */
const spx = parityForward(pairsOf(read('spxw-20270115-at-2026-10-30-1530.json')), SPX, R, T77)!;
const oldSpx = SPX * Math.exp(0.042 * T77);
const zeroQSpx = SPX * Math.exp(R * T77);
check(`SPX parity forward ${spx.F.toFixed(2)} (median of ${spx.n}: ${spx.strikes.join(', ')}; ${spx.lo.toFixed(2)}–${spx.hi.toFixed(2)}) = the audit's 7611.35–7611.55 within 0.05`, spx.n === 4 && spx.lo > 7611.3 && spx.hi < 7611.6 && Math.abs(spx.F - 7611.45) < 0.1);
check(`SPX implied carry ${pct(spx.b)} (audit ≈ 3.71%), implied yield at SOFR ${pct(spx.q)} (audit ≈ 0.23%), each within 0.02 pt`, Math.abs(spx.b - 0.0371) < 0.0002 && Math.abs(spx.q - 0.0023) < 0.0002);
check(`before: the model's SPX forward was ${oldSpx.toFixed(1)} at the fixed 4.2% (+${(oldSpx - spx.F).toFixed(1)}; the audit's +7.9), ${zeroQSpx.toFixed(1)} at SOFR with no yield (+${(zeroQSpx - spx.F).toFixed(1)})`, Math.abs(oldSpx - 7619.3) < 0.05 && Math.abs(oldSpx - spx.F - 7.9) < 0.15);

const t = calendarYears(EXP, NOW);
const spxLive = parityForward(pairsOf(read('spxw-20270115-at-2026-10-30-1530.json')), SPX, R, t)!;
setForward('SPX', EXP, { F: spxLive.F, spot: SPX, b: spxLive.b, t, n: spxLive.n, lo: spxLive.lo, hi: spxLive.hi, at: NOW, day: DAY });
const c = carryFor('SPXW', { expiry: EXP, now: NOW });
const model = SPX * Math.exp((c.r - c.q) * t);
check(`after: SPXW ${EXP} priced at r ${pct(c.r)}, q ${pct(c.q, 3)}: the model forward S·e^{(r−q)T} = ${model.toFixed(2)} — the parity forward ${spxLive.F.toFixed(2)} to the cent`, Math.abs(model - spxLive.F) < 0.005 && c.q > 0);
check('another SPX expiry with no forward read keeps the old yield (none in our data: q = 0)', carryFor('SPX', { expiry: '2026-12-18', now: NOW }).q === 0);
check('a forward is today\'s only: the next day it is not used', forwardFor('SPX', EXP, '2026-10-31') === null && carryFor('SPX', { expiry: EXP, now: NOW + 86_400_000 }).q === 0);
check('a past day (the backtest) never takes today\'s forward', carryFor('SPX', { expiry: EXP, on: '2026-10-29', now: NOW }).q === 0);

/* the Weigher's read of the 7625 call and put: the vendor solves its IV with no yield, so on the old forward the call's
   and the put's IV at one strike disagree; restated on the parity forward they agree, and the price does not move */
{
  const book = pairsOf(read('spxw-20270115-at-2026-10-30-1530.json')).find(p => p.strike === 7625)!;
  const cm = (book.callBid + book.callAsk) / 2;
  const pm = (book.putBid + book.putAsk) / 2;
  const contract = (right: 'C' | 'P', vendorIv: number) => readContract({ ticker: 'SPX', root: 'SPXW', spot: SPX, strike: 7625, right, bid: right === 'C' ? book.callBid : book.putBid, ask: right === 'C' ? book.callAsk : book.putAsk, expiryIso: EXP, vendorIv, now: NOW })!;
  /* the vendor's IVs: each mid solved at SOFR with no yield on the calendar clock, as it quotes them */
  const { impliedVolFromPrice } = await import('../src/core/greeks');
  const vc = impliedVolFromPrice(cm, SPX, 7625, t, 'C', R, 0)!;
  const vp = impliedVolFromPrice(pm, SPX, 7625, t, 'P', R, 0)!;
  const after = { c: contract('C', vc), p: contract('P', vp) };
  resetCarry();
  setRate(R, 'live', DAY);
  const before = { c: contract('C', vc), p: contract('P', vp) };
  check(`SPXW 7625 IV, call vs put: ${before.c.iv.toFixed(2)}% vs ${before.p.iv.toFixed(2)}% at q = 0 (gap ${(before.p.iv - before.c.iv).toFixed(2)}) → ${after.c.iv.toFixed(2)}% vs ${after.p.iv.toFixed(2)}% on the parity forward (gap ${(after.p.iv - after.c.iv).toFixed(3)})`, Math.abs(after.p.iv - after.c.iv) < 0.05 && Math.abs(before.p.iv - before.c.iv) > 0.2);
  check(`its deltas: call ${before.c.delta.toFixed(4)} → ${after.c.delta.toFixed(4)}, put ${before.p.delta.toFixed(4)} → ${after.p.delta.toFixed(4)}; call − put = e^{−qT}: ${(after.c.delta - after.p.delta).toFixed(5)} vs ${Math.exp(-spxLive.q * t).toFixed(5)}`, Math.abs(after.c.delta - after.p.delta - Math.exp(-spxLive.q * t)) < 1e-4 && after.c.delta < before.c.delta);
  setForward('SPX', EXP, { F: spxLive.F, spot: SPX, b: spxLive.b, t, n: spxLive.n, lo: spxLive.lo, hi: spxLive.hi, at: NOW, day: DAY });
  const k = carryFor('SPX', { expiry: EXP, now: NOW });
  check(`the restated vol prices the call at its mid on the implied carry: ${blackScholesPrice(SPX, 7625, t, vc, 'C', R, 0).toFixed(3)} (vendor's) vs ${blackScholesPrice(SPX, 7625, t, (after.c.iv / 100), 'C', k.r, k.q).toFixed(3)}`, Math.abs(blackScholesPrice(SPX, 7625, t, after.c.iv / 100, 'C', k.r, k.q) - cm) < 0.05);
}

/* ---- SPY ---- */
const spy = parityForward(pairsOf(read('spy-20270115-at-2026-10-30-1530.json')), SPY, R, T77)!;
const oldSpy = SPY * Math.exp(0.042 * T77);
check(`SPY parity forward ${spy.F.toFixed(3)} (median of ${spy.n}: ${spy.lo.toFixed(2)}–${spy.hi.toFixed(2)}) inside the audit's 757.09–757.49`, spy.n === 4 && spy.lo > 757.05 && spy.hi < 757.55 && spy.F > 757.09 && spy.F < 757.49);
check(`SPY implied yield at SOFR ${pct(spy.q)} (audit ≈ 1.1%, within 0.15 pt; the screener's trailing 1.00%)`, Math.abs(spy.q - 0.011) < 0.0015);
check(`before: the model's SPY forward ${oldSpy.toFixed(2)} at 4.2% (+${(oldSpy - spy.F).toFixed(2)}; the audit's +2.3)`, Math.abs(oldSpy - 759.56) < 0.01 && Math.abs(oldSpy - spy.F - 2.3) < 0.15);
/* the fallback: the screener's yield where no forward is read; the forward where it is */
setDividend('SPY', 0.0100152);
check(`SPY with no forward read: the screener's yield, q = ${pct(carryFor('SPY', { expiry: EXP, now: NOW }).q, 4)}`, carryFor('SPY', { expiry: EXP, now: NOW }).q === 0.0100152);
const spyLive = parityForward(pairsOf(read('spy-20270115-at-2026-10-30-1530.json')), SPY, R, t)!;
setForward('SPY', EXP, { F: spyLive.F, spot: SPY, b: spyLive.b, t, n: spyLive.n, lo: spyLive.lo, hi: spyLive.hi, at: NOW, day: DAY });
const s = carryFor('SPY', { expiry: EXP, now: NOW });
check(`with it: q = ${pct(s.q, 3)}, model forward ${(SPY * Math.exp((s.r - s.q) * t)).toFixed(3)} = parity ${spyLive.F.toFixed(3)}; another expiry keeps the screener's ${pct(carryFor('SPY', { expiry: '2026-11-06', now: NOW }).q, 4)}`, Math.abs(SPY * Math.exp((s.r - s.q) * t) - spyLive.F) < 0.001 && carryFor('SPY', { expiry: '2026-11-06', now: NOW }).q === 0.0100152);

/* ---- the guards ---- */
check('fewer than 3 valid pairs: no forward', parityForward([{ strike: 7625, callBid: 211.9, callAsk: 212.9, putBid: 225.3, putAsk: 226.4 }, { strike: 7630, callBid: 208.9, callAsk: 210, putBid: 227.2, putAsk: 228.3 }], SPX, R, T77) === null);
check('a one-sided or wide quote is not a pair (a 0 bid; a spread over 25% of the mid)', parityForward([
  { strike: 7625, callBid: 0, callAsk: 212.9, putBid: 225.3, putAsk: 226.4 },
  { strike: 7630, callBid: 150, callAsk: 260, putBid: 227.2, putAsk: 228.3 },
  { strike: 7635, callBid: 205.9, callAsk: 206.9, putBid: 229.2, putAsk: 230.5 },
  { strike: 7640, callBid: 202.9, callAsk: 203.9, putBid: 231.2, putAsk: 232.2 },
], SPX, R, T77) === null);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
