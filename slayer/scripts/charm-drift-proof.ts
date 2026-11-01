/*
  The Surface tab's Drift lens (data/charmDrift.ts) against known numbers: the vendor's charm and vanna units (per year,
  per 1.00 of vol) checked against the site's own Black-Scholes on a real snapshot row, one contract's delta drift to
  the close, the dealers' hedge across a small book by hand in the site's one dealer sign (core/dealerSign.ts,
  retailSign.ts — the gamma-sign proof's convention), and the close the drift runs to (the session module's).
  Run: npx tsx scripts/charm-drift-proof.ts
*/

import { blackScholesGreeks } from '../src/core/greeks';
import { DEALER_SIDE, dealerOf, keptLeg } from '../src/core/dealerSign';
import { nyInstant, regularCloseMin } from '../src/core/session';
import { chainDrift, closeAfter, driftBins, legDrift, VOL_MOVE } from '../src/data/charmDrift';
import type { ChainRow } from '../shared/optionChain.mjs';

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

/* ---- 1. the vendor's units, against the site's own Black-Scholes ---- */
/* SPY Nov 9 750 put on Fri Oct 30's last snapshot (the audit's probe p29): spot 756.59, IV 16.39%, 10 days, SOFR 3.94%,
   no yield (the vendor's defaults): charm 1.8253, vanna −0.7904, delta −0.3535 */
{
  const g = blackScholesGreeks(756.59, 750, 10 / 365, 0.1639, 0.0394, 0);
  check(`charm is delta per YEAR of clock: ours ${g.charmPut.toFixed(4)} vs the vendor's 1.8253`, near(g.charmPut, 1.8253, 0.02));
  check(`vanna is delta per 1.00 of vol: ours ${g.vanna.toFixed(4)} vs the vendor's −0.7904`, near(g.vanna, -0.7904, 0.01));
  check(`delta ${g.deltaPut.toFixed(4)} vs the vendor's −0.3535`, near(g.deltaPut, -0.3535, 0.002));
}

/* ---- 2. one contract ---- */
{
  const day = 1 / 365;
  const d = legDrift('P', -0.3535, 1.8253, -0.7904, day);
  check('the 750 put over one day: delta rises 1.8253/365 = +0.00500', near(d.charm, 1.8253 / 365, 1e-9), d.charm.toFixed(5));
  check('…and a one-point vol fall: −0.7904 × −0.01 = +0.00790', near(d.vanna, -0.7904 * VOL_MOVE, 1e-12), d.vanna.toFixed(5));
  /* a 0DTE call 10-delta with 3 hours left: a charm of −80/yr would take 0.0274 — the bound holds it at its delta */
  const z = legDrift('C', 0.01, -80, 0, 3 / (24 * 365));
  check('an expiring call cannot lose more delta than it has: held at −0.01', near(z.charm, -0.01, 1e-12));
  const p = legDrift('P', -0.98, -50, 0, 1 / 365);
  check('an in-the-money put cannot pass −1: held at −0.02', near(p.charm, -0.02, 1e-12));
}

/* ---- 3. a small book by hand ---- */
/* one expiry, two strikes; spot 100. Dealers are long the calls and short the puts (DEALER_SIDE C +1, P −1). */
{
  const S = 100;
  const from = nyInstant('2026-11-02', 10 * 60);
  const to = nyInstant('2026-11-02', regularCloseMin('2026-11-02'));
  const tau = (to - from) / (365 * 86_400_000);
  const rows: ChainRow[] = [
    /* strike, cBid, cAsk, pBid, pAsk, cΔ, pΔ, cCharm, pCharm, cVanna, pVanna, cOI, pOI, cIV, pIV */
    [95, null, null, null, null, 0.8, -0.2, -2, 2, -0.5, -0.5, 100, 4000, null, null],
    [105, null, null, null, null, 0.2, -0.8, -3, 3, 0.4, 0.4, 2000, 50, null, null],
  ];
  const d = chainDrift([{ exp: '2026-11-06', rows }], S, from, '2026-11-02')!;
  check('the close it runs to: Mon Nov 2 4:00 PM, six hours out', d.toMs === to && near(d.tau * 365 * 24, 6, 1e-9));
  /* by hand: dealer delta change = side × dΔ × 100 × S × OI; the hedge is its opposite */
  const leg = (side: 1 | -1, dD: number, oi: number) => side * dD * 100 * S * oi;
  const k95 = leg(1, -2 * tau, 100) + leg(-1, 2 * tau, 4000);
  const k105 = leg(1, -3 * tau, 2000) + leg(-1, 3 * tau, 50);
  check(`95: dealers' delta falls ${(k95 / 1e3).toFixed(2)}K (short 4,000 puts decaying toward zero) → they BUY ${(-k95 / 1e3).toFixed(2)}K`, near(d.strikes[0].charmFlow, -k95, 1e-6) && d.strikes[0].charmFlow > 0);
  check(`105: long 2,000 calls decaying → dealers BUY ${(-k105 / 1e3).toFixed(2)}K`, near(d.strikes[1].charmFlow, -k105, 1e-6));
  check('the total is the sum of the strikes, and of the expiries', near(d.charmFlow, -(k95 + k105), 1e-6) && near(d.expiries[0].charmFlow, d.charmFlow, 1e-6));
  const v95 = leg(1, -0.5 * VOL_MOVE, 100) + leg(-1, -0.5 * VOL_MOVE, 4000);
  check(`vanna at 95, IV −1: dealers' delta ${v95.toFixed(0)} → hedge ${(-v95).toFixed(0)}`, near(d.strikes[0].vannaFlow, -v95, 1e-6));
  /* the same figure through the site's one convention: kept is the house sign, the page prints dealerOf */
  const kept = keptLeg('P', 2 * tau * 100 * S, 4000) + keptLeg('C', -2 * tau * 100 * S, 100);
  check('the kept figure is the dealer figure turned once (core/dealerSign.ts), as every exposure', near(d.strikes[0].charmKept, kept, 1e-6) && near(dealerOf(kept), k95, 1e-6) && DEALER_SIDE.P === -1);
  check('4 legs with open interest read, none missing', d.legs === 4 && d.missing === 0);
  const noGreeks: ChainRow[] = [[100, null, null, null, null, null, -0.5, null, 1, null, 0.1, 10, 10, null, null]];
  const m = chainDrift([{ exp: '2026-11-06', rows: noGreeks }], S, from, '2026-11-02')!;
  check('a leg with open interest but no greeks is counted as missing, never guessed', m.missing === 1 && m.legs === 1);
  const gone = chainDrift([{ exp: '2026-10-30', rows }], S, from, '2026-11-02')!;
  check('an expiry already closed hedges nothing', gone.legs === 0 && gone.charmFlow === 0);
  check('bins: strikes within 3% of spot, highest first', driftBins(d.strikes, S).map(s => s.strike).join() === '' && driftBins(d.strikes, S, 0.06).map(s => s.strike).join() === '105,95');
}

/* ---- 4. the close it runs to ---- */
{
  const fri = nyInstant('2026-10-30', 17 * 60);
  check('Fri 5:00 PM → Mon Nov 2 4:00 PM', closeAfter(fri, '2026-10-30') === nyInstant('2026-11-02', regularCloseMin('2026-11-02')));
  check('Mon 10:00 AM → that day 4:00 PM', closeAfter(nyInstant('2026-11-02', 10 * 60), '2026-11-02') === nyInstant('2026-11-02', regularCloseMin('2026-11-02')));
  check('the day after Thanksgiving (an early close): 1:00 PM', closeAfter(nyInstant('2026-11-27', 10 * 60), '2026-11-27') === nyInstant('2026-11-27', 13 * 60) && regularCloseMin('2026-11-27') === 13 * 60);
  check('Thanksgiving itself (closed) → Fri 1:00 PM', closeAfter(nyInstant('2026-11-26', 10 * 60), '2026-11-26') === nyInstant('2026-11-27', 13 * 60));
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
