/*
  Opening-lean proof (audit §8 F1): Trace's bullish/bearish lean counts only prints and days that likely OPENED new
  positions (traceRows likelyOpeningOf: the day's volume ran past the open interest the session opened on, or the next
  count rose by half the day's volume). A closing trade bought at the ask or sold on the bid takes an old bet off, so it
  says nothing of where new money points: it still shows, with no lean, and the figure's hover says how much it left out.
  Every expected number below is worked out by hand in the comments. Pure and offline.
  Run:  npx tsx scripts/opening-lean-proof.ts
*/
import { printOpens, sentimentOf, summarizeTape } from '../src/data/tape';
import { closingLeftOut, dayOpens, runScreen } from '../src/data/flowBook';
import { coversTip } from '../src/components/trace/coversWords';
import type { BookContract, FlowPrint } from '../src/types/trace';

let fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got !== undefined ? ` — ${typeof got === 'string' ? got : JSON.stringify(got)}` : ''}`);
};

let id = 0;
const print = (o: Partial<FlowPrint> & Pick<FlowPrint, 'right' | 'side' | 'premium' | 'volume' | 'oi'>): FlowPrint => ({
  id: ++id,
  time: '10:00:00',
  ticker: 'XYZ',
  legs: 1,
  strike: 100,
  otmPct: 2,
  expiry: '2026-11-20',
  dte: 20,
  fill: 1,
  bid: 0.95,
  ask: 1.05,
  fillPos: 0.5,
  ratioBidPct: 50,
  size: 10,
  deltaOI: 0,
  spot: 98,
  iv: 30,
  volOverOI: o.oi > 0 ? o.volume / o.oi : 0,
  strat: '—',
  sweep: false,
  epoch: 1793000000 + id,
  ...o,
});

/* ---- 1. the prints: a hand tape of seven ------------------------------------------------------------------------
   A  call at the ask   $100,000  vol   500 / OI   100  → opening (500 > 100)            bullish  +100,000
   B  put at the ask    $ 40,000  vol   900 / OI   300  → opening (900 > 300)            bearish   +40,000
   C  put on the bid    $250,000  vol   200 / OI 5,000  → cannot be told (200 ≤ 5,000)   no lean   (was bullish)
   D  call on the bid   $ 60,000  vol    50 / OI 1,000  → cannot be told                  no lean   (was bearish)
   E  call at the ask   $ 30,000  vol   400 / OI 1,000, but its row was paired with the next count and told closing
                                                         (likelyOpening false)            no lean   (was bullish)
   F  call at the mid   $ 70,000  vol 9,000 / OI   100  → opening, but a mid print points nowhere: no lean, not "left out"
   G  a spread leg      $ 20,000  vol 9,000 / OI   100  → a leg: no lean, counted as a leg, not "left out"
   Lean: bull 100,000, bear 40,000, net +60,000. Left out: C + D + E = 3 prints, $340,000.
   The old read (every sided print) was bull A + C + E = 380,000, bear B + D = 100,000, net +280,000. */
const tape: FlowPrint[] = [
  print({ right: 'C', side: 'ASK', premium: 100_000, volume: 500, oi: 100 }),
  print({ right: 'P', side: 'ASK', premium: 40_000, volume: 900, oi: 300 }),
  print({ right: 'P', side: 'BID', premium: 250_000, volume: 200, oi: 5_000 }),
  print({ right: 'C', side: 'BID', premium: 60_000, volume: 50, oi: 1_000 }),
  print({ right: 'C', side: 'ASK', premium: 30_000, volume: 400, oi: 1_000, likelyOpening: false }),
  print({ right: 'C', side: 'MID', premium: 70_000, volume: 9_000, oi: 100 }),
  print({ right: 'C', side: 'ASK', premium: 20_000, volume: 9_000, oi: 100, legs: 2, strat: 'Custom' }),
];
const [A, B, C, D, E, F, G] = tape;
check('A call bought on a day past its open interest: opening, bullish', printOpens(A) && sentimentOf(A) === 'BULLISH');
check('B put bought, opening: bearish', printOpens(B) && sentimentOf(B) === 'BEARISH');
check('C put sold inside its open interest: cannot be told, so no lean (it read bullish before)', !printOpens(C) && sentimentOf(C) === 'NEUTRAL');
check('D call sold inside its open interest: no lean (it read bearish before)', !printOpens(D) && sentimentOf(D) === 'NEUTRAL');
check('E told closing by its paired count: the told flag wins over its own volume, no lean', !printOpens(E) && sentimentOf(E) === 'NEUTRAL');
check('F a mid print, opening or not: no lean', sentimentOf(F) === 'NEUTRAL');
check('G a spread leg: no lean', sentimentOf(G) === 'NEUTRAL');

const sum = summarizeTape(tape);
check('the lean: bull $100,000, bear $40,000, net +$60,000 (the old read: +$280,000)', sum.bullPremium === 100_000 && sum.bearPremium === 40_000 && sum.netPremium === 60_000, [sum.bullPremium, sum.bearPremium, sum.netPremium]);
check('left out of the lean: 3 prints, $340,000 (C, D, E) — mid prints and legs are not in it', sum.notOpening.count === 3 && sum.notOpening.premium === 340_000, sum.notOpening);
check('the closing prints still count in the call and put money: calls $280,000, puts $290,000', sum.callPremium === 100_000 + 60_000 + 30_000 + 70_000 + 20_000 && sum.putPremium === 290_000, [sum.callPremium, sum.putPremium]);
check('the closing prints still show: every print is in the summary\'s count', sum.callCount + sum.putCount === tape.length, sum.callCount + sum.putCount);
const tip = coversTip(sum.covers);
check('the hover says how much was left out', tip.includes('3 prints not likely opening, perhaps closing ($340K: shown, no lean)'), tip);
const clean = summarizeTape([A, B]);
check('a tape with nothing left out says nothing about closing', clean.notOpening.count === 0 && !coversTip(clean.covers).includes('closing'), coversTip(clean.covers));

/* ---- 2. edges of the opening rule -------------------------------------------------------------------------------
   volume = OI exactly: no more than the OI can close, but all of it may have, so it cannot be told (not >).
   No volume: nothing to tell. A brand-new contract (OI 0, volume 25): all 25 opened. */
check('volume equal to the open interest: cannot be told', !printOpens({ volume: 300, oi: 300 }));
check('no volume: cannot be told', !printOpens({ volume: 0, oi: 300 }));
check('a new contract (no open interest before the session): opening', printOpens({ volume: 25, oi: 0 }));
check('a paired count that rose by half the day: opening even inside the open interest', printOpens({ volume: 200, oi: 5_000, likelyOpening: true }));

/* ---- 3. the book's screens: Unusually bullish and bearish --------------------------------------------------------
   Four call days, all bought at the ask (askPct 80 → lean ASK), none a package, all at volume ≥ 0.8× OI:
   R1 vol 2,000 / OI 1,000                → opening, bullish                 $500,000
   R2 vol 1,200 / OI 1,400 (0.86×)        → cannot be told: left out         $900,000
   R3 vol   900 / OI 1,000, paired: opening (the next count rose 600 ≥ 450)  $300,000
   R4 vol 3,000 / OI 2,000, paired: closing (likelyOpening false)            $200,000
   Unusually bullish: R1 then R3 by premium. Left out: R2 + R4 = 2 days, $1,100,000. */
const day = (key: string, volume: number, oi: number, premium: number, likelyOpening?: boolean | null): BookContract =>
  ({
    key, ticker: 'XYZ', sector: null, sectorColor: null, strike: 100, right: 'C', expiry: '2026-11-20', dte: 20, spot: 98, otmPct: 2, last: 1,
    chgPct: 0, lastAt: '10:00', lastAtMin: 600, volume, oi, deltaOI: 0, deltaOIPct: 0, premium, iv: 30, ivChg: 0, volOverOI: volume / oi,
    sweepPct: 0, multiPct: 0, floorPct: 0, askPct: 80, prevOI: oi, prevAvgFill: 0, oiStreak: 0, volGtOiStreak: 0, earnDays: null,
    ...(likelyOpening !== undefined ? { likelyOpening } : {}),
  }) as BookContract;
const R1 = day('R1', 2_000, 1_000, 500_000);
const R2 = day('R2', 1_200, 1_400, 900_000);
const R3 = day('R3', 900, 1_000, 300_000, true);
const R4 = day('R4', 3_000, 2_000, 200_000, false);
const book = [R1, R2, R3, R4];
check('the days: R1 opening, R2 cannot be told, R3 told opening, R4 told closing', dayOpens(R1) && !dayOpens(R2) && dayOpens(R3) && !dayOpens(R4));
const bulls = runScreen(book, 'bullish').map(r => r.key);
check('Unusually bullish: R1 then R3 — the largest day, R2, is left out', bulls.join(',') === 'R1,R3', bulls);
check('Unusually bearish: none', runScreen(book, 'bearish').length === 0);
check('the screens still show every day elsewhere: Most active has all four', runScreen(book, 'active').length === 4);
const out = closingLeftOut(book);
check('left out of the lean: 2 days, $1,100,000, both would have read bullish', out.count === 2 && out.premium === 1_100_000 && out.bull === 2 && out.bear === 0, out);

console.log(fail ? `\n${fail} FAILED` : '\nopening-lean proof: all checks pass');
process.exit(fail ? 1 : 0);
