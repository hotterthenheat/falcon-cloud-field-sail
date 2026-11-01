/*
  The Surface tab's Skew lens (data/skew.ts on shared/optionChain.mjs, read by server/terrainApi.mjs) against known
  numbers: a chain priced by Black-Scholes at a known forward, rate and smile is read back — the parity forward, the
  at-the-money vol, the 25-delta risk reversal and butterfly — and the reader's request budget: one snapshot and one
  open-interest read per name however many viewers ask, the prior close read once and kept, never more than two
  history reads at once.
  Run: npx tsx scripts/skew-proof.ts
*/

import { blackScholesPrice } from '../src/core/greeks';
import { normCdf } from '../src/core/math';
import { calendarYears } from '../src/core/volClock';
import { nyInstant, regularCloseMin } from '../src/core/session';
import { chainSkew, expirySkew, gridExpiries, wallMs } from '../src/data/skew';
import { chainRoot, readChain, readCloses, readOpenInterest } from '../shared/optionChain.mjs';
import { createTerrain, HISTORY_AT_ONCE, chainPath, closesPath, oiPath } from '../server/terrainApi.mjs';

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const near = (a: number | null | undefined, b: number, eps: number) => a != null && Math.abs(a - b) <= eps;

/* ---- 1. a chain priced at a known forward and smile ---- */

const S = 7500;
const r = 0.0394;
const q = 0.012;
const EXP = '2026-11-20';
const AT = nyInstant('2026-10-30', 14 * 60);
const t = calendarYears(EXP, AT);
const F = S * Math.exp((r - q) * t);
/** the smile, in log-moneyness: 16% at the forward, 0.9 vol points lower per 1% of strike, a little curvature */
const smile = (k: number) => 0.16 - 0.9 * k + 2.5 * k * k;
type Row = (number | null)[];
const rowsAt = (vol: (k: number) => number, spread = 0.1): Row[] => {
  const rows: Row[] = [];
  for (let K = 6500; K <= 8500; K += 5) {
    const v = vol(Math.log(K / F));
    const c = blackScholesPrice(S, K, t, v, 'C', r, q);
    const p = blackScholesPrice(S, K, t, v, 'P', r, q);
    /* a symmetric spread around the model price; a sub-nickel price has no bid */
    const quote = (m: number) => (m < 0.05 ? [null, 0.05] : [m - spread / 2, m + spread / 2]);
    rows.push([K, ...quote(c), ...quote(p)]);
  }
  return rows;
};

/* flat at 20%: the wings and the middle agree */
{
  const s = expirySkew(EXP, rowsAt(() => 0.2), S, r, AT);
  check('flat 20%: a skew is read', !!s);
  check(`flat 20%: the parity forward is the model's, ${F.toFixed(4)}`, near(s?.F ?? null, F, 0.01), s ? s.F.toFixed(4) : '');
  check('flat 20%: the implied yield is the 1.20% the chain was priced at', near(s?.q ?? null, q, 2e-4), s ? (s.q * 100).toFixed(3) : '');
  check('flat 20%: ATM 20.00%, every bucket 20.00%', near(s?.atm, 0.2, 2e-4) && !!s && Object.values(s.at).every(v => near(v, 0.2, 3e-4)));
  check('flat 20%: risk reversal 0, butterfly 0', near(s?.rr25, 0, 3e-4) && near(s?.fly25, 0, 3e-4), s ? `${(s.rr25! * 100).toFixed(3)} / ${(s.fly25! * 100).toFixed(3)}` : '');
}

/* the smile: the 25-delta strikes solved here by hand — N(d1) = 0.75 and 0.25 with the vol at the strike itself */
{
  const solve = (target: number) => {
    let lo = -1;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const k = (lo + hi) / 2;
      const v = smile(k);
      const nd1 = normCdf((-k + (v * v * t) / 2) / (v * Math.sqrt(t)));
      if (nd1 > target) lo = k;
      else hi = k;
    }
    return smile((lo + hi) / 2);
  };
  const p25 = solve(0.75);
  const c25 = solve(0.25);
  const rr = c25 - p25;
  const fly = (c25 + p25) / 2 - smile(0);
  const s = expirySkew(EXP, rowsAt(smile), S, r, AT);
  check(`smile: ATM ${(smile(0) * 100).toFixed(2)}%`, near(s?.atm, smile(0), 2e-4), s ? (s.atm! * 100).toFixed(3) : '');
  check(`smile: 25-delta put ${(p25 * 100).toFixed(2)}%, call ${(c25 * 100).toFixed(2)}%`, near(s?.at.p25, p25, 5e-4) && near(s?.at.c25, c25, 5e-4), s ? `${(s.at.p25! * 100).toFixed(3)} / ${(s.at.c25! * 100).toFixed(3)}` : '');
  check(`smile: risk reversal ${(rr * 100).toFixed(2)} vol points (puts over calls)`, near(s?.rr25, rr, 5e-4) && rr < 0, s ? (s.rr25! * 100).toFixed(3) : '');
  check(`smile: butterfly ${(fly * 100).toFixed(2)} vol points`, near(s?.fly25, fly, 5e-4), s ? (s.fly25! * 100).toFixed(3) : '');
  check('smile: the put wing is read off the puts, the call wing off the calls', !!s && s.points.every(p => (p.strike < s.F ? p.side === 'P' : p.side === 'C')));
}

/* what is not read */
{
  const dead = rowsAt(() => 0.2).map(r0 => [r0[0], null, null, null, null]);
  check('no two-sided quotes: no forward, no skew', expirySkew(EXP, dead, S, r, AT) === null);
  check('an expiry whose close has passed is not read', expirySkew('2026-10-30', rowsAt(() => 0.2), S, r, nyInstant('2026-10-30', regularCloseMin('2026-10-30') + 5)) === null);
  const wide = rowsAt(() => 0.2, 40);
  check('quotes too wide for a mid near the money leave no forward', expirySkew(EXP, wide, S, r, AT) === null);
}

/* ---- 2. the terminal's CSV ---- */

const CHAIN_CSV = [
  'symbol,expiration,strike,right,timestamp,bid,ask,delta,theta,vega,rho,epsilon,lambda,gamma,vanna,charm,vomma,veta,vera,speed,zomma,color,ultima,d1,d2,dual_delta,dual_gamma,implied_vol,iv_error,underlying_timestamp,underlying_price',
  '"SPXW","2026-11-09",7395.000,"PUT",2026-10-30T17:00:00.341,25.0000,26.2000,-0.1957,-3.0470,346.6956,-41.3468,40.6455,-57.9528,0.0011,-1.2331,3.8120,1325.9557,10426.1958,-265.5899,0.0000,-0.0018,-0.0076,-16420.2035,0.8570,0.8263,0.2040,0.0012,0.1851,0.0000,2026-10-30T16:03:43.000,7580.0700',
  '"SPXW","2026-11-09",7395.000,"CALL",2026-10-30T17:00:00.371,215.8000,246.0000,0.7675,-4.7920,383.1900,153.0835,-159.4095,25.1989,0.0011,-0.9705,3.5399,890.0816,10239.7821,-212.0513,0.0000,-0.0025,-0.0108,-10156.2227,0.7309,0.6947,-0.7555,0.0011,0.2186,0.0000,2026-10-30T16:03:43.000,7580.0700',
  '"SPXW","2026-11-02",7600.000,"CALL",2026-10-30T16:59:00.000,0.0000,3.1000,0.4,0,0,0,0,0,0,0.1,0.2,0,0,0,0,0,0,0,0,0,0,0,0.12,0,2026-10-30T16:03:43.000,7580.0700',
].join('\n');
const OI_CSV = ['timestamp,symbol,expiration,strike,right,open_interest', '2026-10-30T06:30:01.516,"SPXW","2026-11-09",7395.000,"PUT",1200', '2026-10-30T06:30:03.962,"SPXW","2026-11-09",7395.000,"CALL",35'].join('\n');
{
  const oi = readOpenInterest(OI_CSV);
  check('open interest: two contracts, reported Oct 30', oi.oi.size === 2 && oi.day === '2026-10-30' && oi.oi.get('2026-11-09|7395|P') === 1200);
  const c = readChain(CHAIN_CSV, oi.oi);
  check('chain: two expiries in order, the spot 7580.07 stamped 16:03:43', c.expiries.map(e => e.exp).join() === '2026-11-02,2026-11-09' && c.spot === 7580.07 && c.spotAt === '2026-10-30T16:03:43' && c.asOf === '2026-10-30T17:00:00');
  const row = c.expiries[1].rows[0];
  check('chain: one row a strike, call and put side by side, the OI folded in', row.join() === [7395, 215.8, 246, 25, 26.2, 0.7675, -0.1957, 3.5399, 3.812, -0.9705, -1.2331, 35, 1200, 0.2186, 0.1851].join());
  const lone = c.expiries[0].rows[0];
  check('chain: a bid of 0 is no bid; a missing put is null', lone[1] === null && lone[2] === 3.1 && lone[3] === null && lone[12] === null);
  const closes = readCloses(CHAIN_CSV);
  check('closes: the closing quotes alone, the day from the underlying stamp', closes.day === '2026-10-30' && closes.expiries[1].rows[0].join() === '7395,215.8,246,25,26.2');
  check('roots: SPX reads its weeklies, SPY itself', chainRoot('SPX') === 'SPXW' && chainRoot('spy') === 'SPY');
}

/* ---- 3. the reader: one request per piece of data, shared ---- */

{
  const calls: string[] = [];
  let inHistory = 0;
  let peak = 0;
  let t0 = nyInstant('2026-10-30', 14 * 60);
  const theta = async (p: string) => {
    calls.push(p);
    if (p.startsWith('/option/history/')) {
      inHistory += 1;
      peak = Math.max(peak, inHistory);
      await new Promise(res => setTimeout(res, 20));
      inHistory -= 1;
      return { status: 200, body: CHAIN_CSV.replace(/2026-10-30T16:03:43/g, '2026-10-29T16:04:38') };
    }
    await new Promise(res => setTimeout(res, 5));
    return { status: 200, body: p.includes('open_interest') ? OI_CSV : CHAIN_CSV };
  };
  const reader = createTerrain({ theta, dir: null, now: () => t0 });
  const answers = await Promise.all([reader.chain('SPX'), reader.chain('SPX'), reader.chain('SPXW'), reader.chain('SPX')]);
  check('four viewers of SPX at once: ONE chain snapshot and ONE open-interest read', calls.filter(p => p === chainPath('SPXW')).length === 1 && calls.filter(p => p === oiPath('SPXW')).length === 1, `${calls.length} calls`);
  check('the answer carries the open interest and the snapshot', answers.every(a => (a.expiries as unknown[]).length === 2 && a.oiDay === '2026-10-30'));
  t0 += 10_000;
  await reader.chain('SPX');
  check('10 s later (live, fresh for 20 s): no new read', calls.length === 2);
  t0 += 15_000;
  await reader.chain('SPX');
  check('25 s later: one more snapshot, the open interest still held (30 min)', calls.filter(p => p === chainPath('SPXW')).length === 2 && calls.filter(p => p === oiPath('SPXW')).length === 1);
  const first = await reader.prior('SPX');
  check('the prior close: pending while its one read runs', first.pending === true && first.day === '2026-10-29');
  await reader.settle();
  const second = await reader.prior('SPX');
  check('…then the Oct 29 surface, read once', !second.pending && (second.expiries as unknown[]).length === 2 && calls.filter(p => p === closesPath('SPXW', '2026-10-29')).length === 1);
  await reader.prior('SPX');
  await reader.prior('SPX');
  check('asked again: still one read', calls.filter(p => p.startsWith('/option/history/')).length === 1);
  /* five names' prior closes at once: never more than two history reads together */
  await Promise.all(['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL'].map(n => reader.chain(n)));
  await Promise.all(['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL'].map(n => reader.prior(n)));
  await reader.settle();
  check(`five prior closes at once: at most ${HISTORY_AT_ONCE} history reads in flight`, peak <= HISTORY_AT_ONCE && peak >= 1, `peak ${peak}`);
}

/* ---- 4. the live chain read whole, end to end ---- */
{
  const c = readChain(CHAIN_CSV);
  const skews = chainSkew(c.expiries, c.spot!, r, wallMs(c.asOf!));
  check('two strikes are too few for a forward: no skew (said, not invented)', skews.length === 0);
  const grid = gridExpiries([
    { exp: 'a', dte: 0.3 },
    { exp: 'b', dte: 1 },
    { exp: 'c', dte: 7.2 },
    { exp: 'd', dte: 31 },
    { exp: 'e', dte: 400 },
  ].map(x => ({ ...x, t: x.dte / 365 }) as never));
  check('the grid picks the expiries nearest 0, 1, 7, 30 days (400 days out is past its reach)', grid.map(s => (s as { exp: string }).exp).join() === 'a,b,c,d');
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
