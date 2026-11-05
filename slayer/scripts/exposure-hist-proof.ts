/*
  The rebuilt past day (src/data/book/exposureHist.ts): a hand example, the rules a reading follows (the vol grid in time
  and strike, open interest that never moves inside the day, a leg gone at its close), and the close of Friday Oct 30
  2026 against the vendor's own book for SPY — the book the live path reads (spot-exposures, call_gamma_oi + put_gamma_oi).
    npx tsx scripts/exposure-hist-proof.ts

  The stated tolerance, at 16:14 (the vendor stamps its close book 16:15), strikes 735-780:
  - every expiry still trading after the close (the whole book less the day's own expiry): net within 15%, and the
    strikes' mean absolute error within 15% of their mean absolute size (measured: −8.1B against −9.3B, 11%: the
    vendor's far expiries carry vols and open interest of their own);
  - the next expiry alone (11-02): net within 10%, mean absolute error within 12% (measured: −966M against −902M, 9%).
  The day's own expiry is left out of the comparison: the rebuild drops it at 16:00, when it expires, while the vendor's
  after-close book still carries it at its own frozen clock (its 10-30 rows sum to −7.9B at 16:15).

  Live (the opening open interest moved by the day's prints, by the Live book's own rule): a hand example; Live =
  Settled with no prints, past five sessions to expiry, and where the signed net is under the noise; the terminal's
  prints read (cancelled out, multi-leg kept apart, sided against the quote); and the 11-02 expiry's Live book at 16:14
  against the vendor's (oi + ask + bid gamma): net within 15% (measured −1,053M against −959M).
*/
import { readFileSync } from 'node:fs';
import { FLOW_FORMAT, HIST_FORMAT, flowOf, lastVols, nyStampMs, readBars, readIv, readOi, rebuildDay, tallyTradeQuotes, type FlowInputs, type FlowTally, type HistInputs } from '../src/data/book/exposureHist';
import { ALL } from '../src/data/book/exposureSegs';
import { nyWallTime } from '../src/core/nyTime';
import { getCarry } from '../src/core/carry';
import { createExposureHist } from '../src/data/exposureHistServer';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const at = (segs: number[], t: number) => {
  for (let i = 0; i < segs.length; i += 4) if (segs[i] === t) return segs[i + 2];
  return NaN;
};

/* ---- a hand example ---------------------------------------------------------------------------------------- */
/* One name, one day (Fri 2026-10-30), two bars at 10:00 and 10:01, one strike (100) with a call (OI 1,000) and a put
   (OI 400) expiring Fri 2026-11-06 at 16:00. Vols: the call's grid says 20% at 09:30 and 30% at 10:30; the put's 25% at
   both. At 10:00 S = 100 (at the money: the call is the out-of-the-money side), at 10:01 S = 101. */
{
  const t930 = nyWallTime(2026, 10, 30, 9, 30);
  const t1030 = nyWallTime(2026, 10, 30, 10, 30);
  const b0 = nyWallTime(2026, 10, 30, 10, 0);
  const b1 = nyWallTime(2026, 10, 30, 10, 1);
  const inp: HistInputs = {
    format: HIST_FORMAT,
    ticker: 'XYZ',
    day: '2026-10-30',
    oi: [
      ['2026-11-06', 100, 'C', 1000],
      ['2026-11-06', 100, 'P', 400],
    ],
    iv: [
      ['2026-11-06', 100, 'C', [t930, t1030], [0.2, 0.3], [100, 100]],
      ['2026-11-06', 100, 'P', [t930, t1030], [0.25, 0.25], [100, 100]],
    ],
    bars: [
      [b0, 100],
      [b1, 101],
    ],
  };
  /* by hand: Γ = e^{−qT} φ(d1) / (S σ √T), d1 = (ln(S/K) + (r − q + σ²/2) T) / (σ √T); a contract's dollars per 1% =
     Γ × 100 × S² × 0.01; the dealer is long the call (+) and short the put (−) */
  const { r, q } = getCarry();
  const expiryClose = nyWallTime(2026, 11, 6, 16, 0);
  const hand = (S: number, t: number) => {
    const T = (expiryClose - (t + 59_999)) / (365 * 86_400_000);
    /* corrected (audit T7): this once read 10:00 as halfway along the grid (25%, a value from 10:30, later in the day).
       The vol is the last grid value known at the minute: 09:30's 20% holds until the 10:30 point. */
    const sigma = t >= t1030 ? 0.3 : 0.2;
    const d1 = (Math.log(S / 100) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    const gamma = (Math.exp(-q * T) * Math.exp(-(d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / (S * sigma * Math.sqrt(T));
    return (1000 - 400) * gamma * 100 * S * S * 0.01;
  };
  const got = rebuildDay(inp, 'book');
  check('hand example: one strike, two bars, the whole book', got.series.length === 1 && got.series[0][0] === ALL && got.series[0][1] === 100 && got.series[0][2].length === 8);
  const segs = got.series[0][2];
  check('hand example: 10:00 is side × OI × Γ × 100 × S² × 0.01 at the call\'s last quoted vol (09:30\'s 20%, held — never 10:30\'s)', Math.abs(segs[2] - hand(100, b0)) <= 1, `${segs[2]} vs ${hand(100, b0).toFixed(1)}`);
  check('hand example: 10:01 reprices S and the vol, the open interest unchanged', Math.abs(segs[6] - hand(101, b1)) <= 1, `${segs[6]} vs ${hand(101, b1).toFixed(1)}`);
  check('hand example: one segment a bar, a minute long, flow = open interest (no trades are guessed)', segs[0] === b0 && segs[1] === b0 + 59_999 && segs[3] === segs[2] && segs[4] === b1);
  const oneExpiry = rebuildDay(inp, '2026-11-06');
  check('a date cut keeps that expiry under its own name', oneExpiry.series[0][0] === '2026-11-06' && oneExpiry.series[0][2][2] === segs[2]);
  check('another expiry\'s cut is empty', rebuildDay(inp, '2026-11-13').series.length === 0);

  /* before the grid: the session before's last vol, carried; after it: the last */
  const early = nyWallTime(2026, 10, 30, 8, 0);
  const pre = rebuildDay({ ...inp, bars: [[early, 100]] }, 'book', { '2026-11-06|100': 0.4 });
  const preNo = rebuildDay({ ...inp, bars: [[early, 100]] }, 'book');
  const preHand = (sigma: number) => {
    const T = (expiryClose - (early + 59_999)) / (365 * 86_400_000);
    const d1 = (Math.log(1) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    return (600 * Math.exp(-q * T) * Math.exp(-(d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / (100 * sigma * Math.sqrt(T)) * 100 * 100 * 100 * 0.01;
  };
  check('pre-market holds the session before\'s last vol', Math.abs(pre.series[0][2][2] - preHand(0.4)) <= 1, `${pre.series[0][2][2]} vs ${preHand(0.4).toFixed(1)}`);
  /* corrected (audit T7): this once priced the pre-market bar at the day's first vol — 09:30's, not yet quoted at 08:00 */
  check('with none carried, the pre-market bar is not priced (09:30\'s vol is not known at 08:00)', preNo.series.length === 0, JSON.stringify(preNo.series));
  {
    /* no look-ahead: the minute before the 10:30 point is priced exactly as if the grid stopped at 10:29 */
    const b1029 = nyWallTime(2026, 10, 30, 10, 29);
    const full = rebuildDay({ ...inp, bars: [[b1029, 100]] }, 'book').series[0][2][2];
    const cut = rebuildDay({ ...inp, bars: [[b1029, 100]], iv: inp.iv.map(r => [r[0], r[1], r[2], [r[3][0]], [r[4][0]], [r[5][0]]] as typeof r) }, 'book').series[0][2][2];
    check('10:29 reads nothing from the 10:30 grid point (the same gamma with that point deleted)', full === cut, `${full} vs ${cut}`);
  }
  const late = nyWallTime(2026, 10, 30, 19, 0);
  const post = rebuildDay({ ...inp, bars: [[late, 100]] }, 'book');
  check('after the last grid point the vol holds (the call\'s 30%)', post.series[0][2].length === 4 && post.series[0][2][2] > 0);
  check('the day\'s last vols carry to the next day', lastVols(inp)['2026-11-06|100'] === 0.3);

  /* the out-of-the-money side: with the underlying at 102 on the grid, strike 100 is below the money and the put's vol
     (35%) prices it, not the call's (25% at 10:00) */
  const putSide: HistInputs = {
    ...inp,
    iv: [
      ['2026-11-06', 100, 'C', [t930, t1030], [0.2, 0.3], [102, 102]],
      ['2026-11-06', 100, 'P', [t930, t1030], [0.35, 0.35], [102, 102]],
    ],
    bars: [[b0, 102]],
  };
  const below = rebuildDay(putSide, 'book').series[0][2][2];
  const hand102 = (() => {
    const S = 102;
    const sigma = 0.35;
    const T = (expiryClose - (b0 + 59_999)) / (365 * 86_400_000);
    const d1 = (Math.log(S / 100) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    return (600 * Math.exp(-q * T) * Math.exp(-(d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / (S * sigma * Math.sqrt(T)) * 100 * S * S * 0.01;
  })();
  check('a strike below the price takes the put\'s vol, the out-of-the-money side', Math.abs(below - hand102) <= 1, `${below} vs ${hand102.toFixed(1)}`);

  /* a strike off the vol grid takes its nearest neighbour's; a leg is gone at its expiry's close */
  const off = rebuildDay({ ...inp, oi: [['2026-11-06', 101, 'C', 1000]] }, 'book');
  check('a strike off the grid takes the nearest strike\'s vol', off.series.length === 1 && off.series[0][2][2] > 0);
  const lastDay = rebuildDay({ ...inp, oi: [['2026-10-30', 100, 'C', 1000]], iv: [['2026-10-30', 100, 'C', [t930], [0.2], [100]]], bars: [[nyWallTime(2026, 10, 30, 15, 59), 100], [nyWallTime(2026, 10, 30, 16, 0), 100]] }, 'book');
  check('a leg in its expiry\'s last minute prices; from its close it is gone', lastDay.series[0][2].length === 4 && lastDay.series[0][2][0] === nyWallTime(2026, 10, 30, 15, 59));
  check('an empty day rebuilds nothing', rebuildDay({ ...inp, bars: [] }, 'book').series.length === 0 && rebuildDay({ ...inp, oi: [] }, 'book').series.length === 0);
}

/* ---- reading the terminal's answers -------------------------------------------------------------------------- */
{
  const toMs = (s: string) => nyStampMs(s, nyWallTime);
  check('a terminal stamp is New York wall time', toMs('2026-10-30T09:30:00.000') === nyWallTime(2026, 10, 30, 9, 30));
  const oi = readOi({ response: [{ contract: { strike: 750, right: 'PUT', expiration: '2026-11-02' }, data: [{ open_interest: 1234 }] }, { contract: { strike: 751, right: 'CALL', expiration: '2026-11-02' }, data: [{ open_interest: 0 }] }] });
  check('open interest: a contract with none is left out', oi.length === 1 && oi[0][0] === '2026-11-02' && oi[0][2] === 'P' && oi[0][3] === 1234);
  const iv = readIv({ response: [{ contract: { strike: 750, right: 'CALL', expiration: '2026-11-02' }, data: [{ implied_vol: 0.14, underlying_price: 755, timestamp: '2026-10-30T10:00:00.000' }, { implied_vol: 0, timestamp: '2026-10-30T10:30:00.000' }] }] }, toMs);
  check('vols: a zero (no quote) is not a vol', iv.length === 1 && iv[0][3].length === 1 && iv[0][4][0] === 0.14);
  const bars = readBars({ response: [{ timestamp: '2026-10-30T04:00:00.000', open: 760, high: 761, low: 759, close: 760.5, volume: 10 }, { timestamp: '2026-10-30T04:01:00.000', open: 0, high: 0, low: 0, close: 0 }] }, toMs);
  check('bars: a minute that did not trade is not a price', bars.length === 1 && bars[0][1] === 760.5);
}

/* ---- Live: the opening open interest moved by the day's prints ------------------------------------------------- */
{
  /* One strike (100) on the Tue 11-03 expiry, inside the Live book's five sessions from Fri 10-30. Calls: OI 1,000;
     by 10:00, 400 traded — 300 at the ask (40 of them in multi-leg prints), 100 at the bid. Puts: OI 500; 100 bought at
     the ask. Rule (core/volClock.ts dealerInventory, data/book/scale.ts dealerPuts): multi-leg volume comes out in
     proportion (40 / 400 = 10%), so calls count 1,000 − 270 + 90 = 820 (dealers long); puts count 500 + 100 = 600
     (dealers short, ask and bid swapped). Live = (820 − 600) × g, Settled = (1,000 − 500) × g. */
  const t930 = nyWallTime(2026, 10, 30, 9, 30);
  const b0 = nyWallTime(2026, 10, 30, 10, 0);
  const pre = nyWallTime(2026, 10, 30, 8, 0);
  const inp: HistInputs = {
    format: HIST_FORMAT,
    ticker: 'XYZ',
    day: '2026-10-30',
    oi: [
      ['2026-11-03', 100, 'C', 1000],
      ['2026-11-03', 100, 'P', 500],
    ],
    iv: [['2026-11-03', 100, 'C', [t930], [0.2], [100]]],
    bars: [
      [pre, 100],
      [b0, 100],
    ],
  };
  /* the session before's last vol, carried, so the 08:00 bar is priced (with none carried it has no vol yet — audit T7) */
  const CARRY = { '2026-11-03|100': 0.2 };
  const m = nyWallTime(2026, 10, 30, 9, 45);
  const flow: FlowInputs = {
    format: FLOW_FORMAT,
    ticker: 'XYZ',
    day: '2026-10-30',
    legs: [
      ['2026-11-03', 100, 'C', [m], [400], [300], [100], [40], [0]],
      ['2026-11-03', 100, 'P', [m], [100], [100], [0], [0], [0]],
    ],
  };
  const got = rebuildDay(inp, 'book', CARRY, flow).series[0][2];
  const g = got[6] / 500;
  check('Live hand example: Settled is (1,000 − 500) × g', Math.abs(got[6] - 500 * g) < 1e-6 && got[6] !== 0);
  check('Live hand example: calls 1,000 − 270 + 90 = 820, puts 500 + 100 = 600, Live = 220 × g', Math.abs(got[7] - Math.round(220 * g)) <= 1, `${got[7]} vs ${(220 * g).toFixed(1)}`);
  check('Live before the first print is Settled (the pre-market bar)', got[2] === got[3]);
  check('Live = Settled with no prints', (() => {
    const a = rebuildDay(inp, 'book', CARRY).series[0][2];
    const b = rebuildDay(inp, 'book', CARRY, { ...flow, legs: [] }).series[0][2];
    return a.every((v, i) => i % 4 !== 3 || v === a[i - 1]) && b.every((v, i) => v === a[i]);
  })());
  /* the same prints on an expiry past the Live book's five sessions (Fri 11-13) leave it settled */
  const far: HistInputs = { ...inp, oi: inp.oi.map(r => ['2026-11-13', r[1], r[2], r[3]] as HistInputs['oi'][number]), iv: [['2026-11-13', 100, 'C', [t930], [0.2], [100]]] };
  const farFlow: FlowInputs = { ...flow, legs: flow.legs.map(l => ['2026-11-13', ...l.slice(1)] as FlowInputs['legs'][number]) };
  const f = rebuildDay(far, 'book', { '2026-11-13|100': 0.2 }, farFlow).series[0][2];
  check('Live past five sessions to expiry stays Settled', f[7] === f[6]);
  /* balanced prints (as many at the bid as at the ask) are under the noise: the strike keeps its settled count */
  const even: FlowInputs = { ...flow, legs: [['2026-11-03', 100, 'C', [m], [400], [200], [200], [0], [0]]] };
  const e = rebuildDay(inp, 'book', CARRY, even).series[0][2];
  check('Live where the signed net is under the noise stays Settled', e[7] === e[6]);
  /* a print that set no side (mid) does not move the count */
  const mid: FlowInputs = { ...flow, legs: [['2026-11-03', 100, 'C', [m], [400], [300], [0], [0], [100]]] };
  const md = rebuildDay(inp, 'book', CARRY, mid).series[0][2];
  check('Live: a mid print adds volume, not count (1,000 − 300 = 700 calls)', Math.abs(md[7] - Math.round((700 - 500) * g)) <= 1);

  /* the terminal's prints read: a cancelled print dropped, a multi-leg print kept apart, each sided against its quote */
  const csv = [
    'symbol,expiration,strike,right,trade_timestamp,quote_timestamp,sequence,ext_condition1,ext_condition2,ext_condition3,ext_condition4,condition,size,exchange,price,bid_size,bid_exchange,bid,bid_condition,ask_size,ask_exchange,ask,ask_condition',
    '"XYZ","2026-11-03",100.000,"CALL",2026-10-30T09:45:01.000,2026-10-30T09:45:00.900,1,255,255,255,255,18,10,1,2.10,1,1,2.00,50,1,1,2.10,50',
    '"XYZ","2026-11-03",100.000,"CALL",2026-10-30T09:45:02.000,2026-10-30T09:45:01.900,2,255,255,255,255,18,4,1,2.00,1,1,2.00,50,1,1,2.10,50',
    '"XYZ","2026-11-03",100.000,"CALL",2026-10-30T09:45:03.000,2026-10-30T09:45:02.900,3,255,255,255,255,18,3,1,2.05,1,1,2.00,50,1,1,2.10,50',
    '"XYZ","2026-11-03",100.000,"CALL",2026-10-30T09:45:04.000,2026-10-30T09:45:03.900,4,255,255,255,255,130,6,1,2.10,1,1,2.00,50,1,1,2.10,50',
    '"XYZ","2026-11-03",100.000,"CALL",2026-10-30T09:45:05.000,2026-10-30T09:45:04.900,5,255,255,255,255,40,99,1,2.10,1,1,2.00,50,1,1,2.10,50',
    '"XYZ","2026-11-03",100.000,"PUT",2026-10-30T09:46:00.000,2026-10-30T09:45:59.900,6,255,255,255,255,18,7,1,1.50,1,1,1.40,50,1,1,1.50,50',
  ].join('\n');
  const tally: FlowTally = new Map();
  const read = tallyTradeQuotes(csv, s => nyStampMs(s, nyWallTime), tally);
  const fl = flowOf('XYZ', '2026-10-30', tally);
  const call = fl.legs.find(l => l[2] === 'C')!;
  const put = fl.legs.find(l => l[2] === 'P')!;
  check('prints: the cancelled one is dropped, five read', read === 5);
  check('prints: calls 23 traded — 16 at the ask (6 in a multi-leg print), 4 at the bid, 3 at mid', call[3][0] === m && call[4][0] === 23 && call[5][0] === 16 && call[6][0] === 4 && call[7][0] === 6 && call[8][0] === 3);
  check('prints: a put minute of its own', put[3][0] === nyWallTime(2026, 10, 30, 9, 46) && put[5][0] === 7);
}

/* ---- the close of 2026-10-30 against the vendor's book ------------------------------------------------------- */
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/spy-exposure-hist-2026-10-30.json', import.meta.url), 'utf8')) as {
    inputs: HistInputs;
    flow: FlowInputs;
    vendor: Record<string, Record<string, number>>;
  };
  const t = nyWallTime(2026, 10, 30, 16, 14);
  const compare = (cut: string, want: (k: number) => number) => {
    const got = rebuildDay(fx.inputs, cut);
    let net = 0;
    let vnet = 0;
    let err = 0;
    let size = 0;
    let n = 0;
    for (const [, k, segs] of got.series) {
      const v = at(segs, t);
      if (v !== v || k < 735 || k > 780) continue;
      const w = want(k);
      net += v;
      vnet += w;
      err += Math.abs(v - w);
      size += Math.abs(w);
      n++;
    }
    return { net, vnet, err: err / size, n };
  };
  const vendor = (cut: string) => (k: number) => fx.vendor[cut][String(k.toFixed(1))] ?? 0;
  /* every expiry still trading after the close: the whole book less the day's own */
  const live = compare('book', k => vendor('book')(k) - vendor('2026-10-30')(k));
  const M = (v: number) => `${(v / 1e6).toFixed(0)}M`;
  console.log(`     the whole book less 10-30 at 16:14, ${live.n} strikes: rebuilt ${M(live.net)}, vendor ${M(live.vnet)}, mean abs error ${(live.err * 100).toFixed(1)}%`);
  check('the close, every expiry still trading: net within 15% of the vendor\'s', Math.abs(live.net - live.vnet) <= 0.15 * Math.abs(live.vnet));
  check('the close, every expiry still trading: strikes within 15% (mean absolute error over mean size)', live.err <= 0.15);
  const next = compare('2026-11-02', vendor('2026-11-02'));
  console.log(`     the 11-02 expiry at 16:14, ${next.n} strikes: rebuilt ${M(next.net)}, vendor ${M(next.vnet)}, mean abs error ${(next.err * 100).toFixed(1)}%`);
  check('the close, the next expiry: net within 10%', Math.abs(next.net - next.vnet) <= 0.1 * Math.abs(next.vnet));
  check('the close, the next expiry: strikes within 12%', next.err <= 0.12);
  /* the Live book on the 11-02 expiry, against the vendor's live book (oi + ask + bid gamma) */
  const liveGot = rebuildDay(fx.inputs, '2026-11-02', {}, fx.flow);
  let ln = 0;
  let lv = 0;
  for (const [, k, segs] of liveGot.series) {
    if (k < 735 || k > 780) continue;
    for (let i = 0; i < segs.length; i += 4) if (segs[i] === t) ln += segs[i + 3];
    lv += fx.vendor['2026-11-02 live'][String(k.toFixed(1))] ?? 0;
  }
  console.log(`     the 11-02 Live book at 16:14: rebuilt ${M(ln)}, vendor ${M(lv)}`);
  check('the close, Live on the next expiry: net within 15% of the vendor\'s live book', Math.abs(ln - lv) <= 0.15 * Math.abs(lv));
  check('the close: Live moved off Settled where the day traded', liveGot.series.some(s => s[2].some((v, i) => i % 4 === 3 && v !== s[2][i - 1])));
  const day = rebuildDay(fx.inputs, 'book');
  check('the rebuild spans every bar it was handed (15:30–16:14)', day.bars === 45 && day.series.every(s => s[2].length / 4 >= 44));
  check('the day\'s own expiry is gone from 16:00', (() => {
    const own = rebuildDay(fx.inputs, '2026-10-30');
    return own.series.every(s => s[2][s[2].length - 4] < nyWallTime(2026, 10, 30, 16, 0));
  })());
}

/* A name the terminal cannot rebuild (VIX, SPX: no stock bars) and a day still trading answer 200 with no series, never a
   404 — the browser printed each 404 as a console error, one a day in view on Terrain's VIX (live, 2026-11-01). */
{
  const hist = createExposureHist({ dir: mkdtempSync(join(tmpdir(), 'hist-proof-')), theta: async () => ({ status: 472, body: '' }), now: () => nyWallTime(2026, 11, 1, 20, 30) });
  for (const [t, day, why] of [['VIX', '2026-10-30', 'no bars to rebuild from'], ['SPY', '2026-11-02', 'a day not finished'], ['SPY', '2026-10-31', 'a Saturday']] as const) {
    const got = await hist.answer(t, day, 'book');
    const body = JSON.parse(gunzipSync(got.gz).toString('utf8')) as { series: unknown[] };
    check(`nothing to serve is an empty answer, not a 404: ${t} ${day} (${why})`, got.status === 200 && Array.isArray(body.series) && body.series.length === 0, `status ${got.status}`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nexposure rebuild: all ok');
process.exit(fail ? 1 : 0);
