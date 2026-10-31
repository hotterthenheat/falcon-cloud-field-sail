/*
  W4 — the Weigher prices with the name's own dividend yield (data/carryFeed.ts → core/carry.ts), from the market-data
  screener row, and a name our data has no yield for is priced with none and says so.

  The rows below are the screener's answers through the dev proxy on 31 Oct 2026 (the fields that matter): SPY 1.0015%
  (ttm 7.582718 / close 757.12), QQQ 0.4463% (3.09182 / 692.74), SPX null (a cash index). The stock-info route carries no
  `dividend_yield` for SPY or QQQ at all, so before this the Weigher's q was 0 for every one of them.
  Run:  npx tsx scripts/carry-proof.ts
*/
import { carryFor, setDividend } from '../src/core/carry';
import { carryWords, screenerYield } from '../src/data/carryFeed';
import { clockCarry, readContract } from '../src/data/weigherGate';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const rows = [
  { ticker: 'SPY', dividend_yield: '0.0100152129120879120879120879', ttm_dividend: '7.58271800000000000000', close: '757.12' },
  { ticker: 'QQQ', dividend_yield: '0.0044631752172532263186765597', ttm_dividend: '3.09182000000000000000', close: '692.74' },
  { ticker: 'SPX', dividend_yield: null, ttm_dividend: null, close: null },
];
const spyQ = screenerYield({ data: rows }, 'SPY');
const qqqQ = screenerYield({ data: rows }, 'QQQ');
check(`SPY's yield off its row: ${(spyQ! * 100).toFixed(4)}% = 7.582718 / 757.12 = ${((7.582718 / 757.12) * 100).toFixed(4)}%`, spyQ != null && Math.abs(spyQ - 7.582718 / 757.12) < 1e-6);
check(`QQQ's: ${(qqqQ! * 100).toFixed(4)}% = 3.09182 / 692.74`, qqqQ != null && Math.abs(qqqQ - 3.09182 / 692.74) < 1e-6);
check('SPX has none in our data: null, not a number made up', screenerYield({ data: rows }, 'SPX') === null);

/* the Weigher's own read of one contract: SPY 757 call and put, 20 sessions out, 15% on the calendar year */
const now = Date.parse('2026-10-30T15:00:00Z');
const expiryIso = '2026-11-27';
const read = (right: 'C' | 'P') => readContract({ ticker: 'SPY', spot: 757.12, strike: 757, right, bid: 0, ask: 0, expiryIso, vendorIv: 0.15, now } as never);
check('before the yield lands, SPY is priced with q = 0', carryFor('SPY').q === 0);
const c0 = read('C')!;
const p0 = read('P')!;
setDividend('SPY', spyQ!);
const c1 = read('C')!;
const p1 = read('P')!;
const k = clockCarry('SPY', expiryIso, now);
check(`with it, the Weigher's carry for SPY is q = ${(carryFor('SPY').q * 100).toFixed(4)}% (on its trading clock ${(k.q * 100).toFixed(4)}%)`, Math.abs(carryFor('SPY').q - spyQ!) < 1e-12 && k.q > 0);
/* a yield lowers the forward S·e^{(r−q)T}. By hand, on the calendar clock (T = 28/365, σ√T = 0.15·√T = 0.04155):
   d1 = (ln(757.12/757) + (r + σ²/2)·T) / σ√T, and with the yield d1 − q·T/σ√T; Δcall = e^{−qT}·N(d1); Δput = Δcall − e^{−qT} */
const T = 28 / 365;
const sd = 0.15 * Math.sqrt(T);
const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const d1 = (Math.log(757.12 / 757) + (0.042 + 0.15 ** 2 / 2) * T) / sd;
const handCall = Math.exp(-spyQ! * T) * ncdf(d1 - (spyQ! * T) / sd) - ncdf(d1);
const dCall = c1.delta - c0.delta;
const dPut = p1.delta - p0.delta;
check(`SPY 757C delta ${c0.delta.toFixed(4)} → ${c1.delta.toFixed(4)} (${dCall.toFixed(5)}; by hand ${handCall.toFixed(5)}), 757P ${p0.delta.toFixed(4)} → ${p1.delta.toFixed(4)} (${dPut.toFixed(5)})`, dCall < 0 && dPut < 0 && Math.abs(dCall - handCall) < Math.abs(handCall) * 0.1);
check(`the chance it finishes in the money moves too: call ${c0.itm.toFixed(2)}% → ${c1.itm.toFixed(2)}%, put ${p0.itm.toFixed(2)}% → ${p1.itm.toFixed(2)}%`, c1.itm < c0.itm && p1.itm > p0.itm);

/* the hover */
console.log('     ' + carryWords('SPY', { state: 'known', q: spyQ! }));
console.log('     ' + carryWords('SPX', { state: 'none' }));
check('the hover names the yield, or says our data has none — never a number for SPX', carryWords('SPY', { state: 'known', q: spyQ! }).includes('1.00% dividend yield') && carryWords('SPXW', { state: 'none' }).includes('no dividend yield for SPX'));

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
