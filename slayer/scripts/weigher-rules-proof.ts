/*
  The Weigher's gate follows Compass's rules (compassParams, 2026-11-07: no fixed price or spread limit). On a pinned
  Wednesday session, one SPY chain, data/weigherGate.ts readGate:
    1. Books A and B (scored by Model 1) take only Model 1's trained quotes (inModel1Domain: a bid over $0.15, a spread
       within 8% of the mid) and say it is the model's domain, not a tradability limit;
    2. Book C (Model 3, 15:20–15:49 ET) reads no bid, spread or price cap: a $3.00 at-the-money ask and a thin, wide quote
       both pass its shape; an in-the-money contract over 0.55 delta does not (lotteryShape);
    3. Book B's wing is |delta| ≤ 0.15 (wingShape), not an ask of $1.00 or less;
    4. validity stays: a one-sided or old quote is refused.
  Every threshold is read from compassParams, never restated.
  Run: node --import tsx scripts/weigher-rules-proof.ts
*/
import { nyInstant } from '../shared/marketSession.mjs';
import { readGate } from '../src/data/weigherGate';
import { deltaOf } from '../src/data/compassCost';
import { LOTTERY_DELTA_MAX, WING_DELTA_MAX } from '../src/data/compassParams';
import type { DeskChain, DeskContract } from '../src/data/weigherDesk';

let fail = 0;
const check = (what: string, ok: boolean, got?: string) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${got ? ` — ${got}` : ''}`);
};

/* Wednesday 2026-11-11, a full session; the chain is SPY's same-day expiry */
const DAY = '2026-11-11';
const spot = 600;
const contract = (strike: number, right: 'C' | 'P', bid: number, ask: number, quotedAt: number, priorAsk?: number): DeskContract =>
  ({ strike, right, mark: (bid + ask) / 2, delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, itmOdds: NaN, rho: NaN, bid, ask, quotedAt, priorAsk }) as unknown as DeskContract;
const chainAt = (quotedAt: number, expiryIso: string): DeskChain => {
  const rows = [];
  for (let k = 560; k <= 640; k++) rows.push({ strike: k, call: contract(k, 'C', 1, 1.02, quotedAt), put: contract(k, 'P', 1, 1.02, quotedAt) });
  return { ticker: 'SPY', spot, step: 1, rows, expiry: 0 as unknown as DeskChain['expiry'], expectedMovePct: 1, source: 'live', quotedAt, expiryIso } as DeskChain;
};
const at = (min: number) => nyInstant(DAY, min);
const gate = (min: number, c: DeskContract, expiryIso = DAY, extra: Partial<Parameters<typeof readGate>[0]> = {}) => {
  const now = at(min);
  return readGate({ chain: chainAt(now - 5_000, expiryIso), contract: c, now, minute: min, retOpen: 0, p1: 0.9, ...extra });
};
const absDelta = (c: DeskContract, min: number, exp = DAY) => Math.abs(deltaOf({ strike: c.strike, right: c.right, bid: c.bid, ask: c.ask, expiryDate: exp }, spot, at(min)));

/* 1. Book A: Model 1's trained quotes */
const A = 10 * 60 + 0;
const thin = contract(600, 'C', 0.12, 0.13, at(A) - 5_000);
const wide = contract(600, 'C', 1.0, 1.2, at(A) - 5_000);
const fine = contract(600, 'C', 2.0, 2.04, at(A) - 5_000);
const gThin = gate(A, thin);
const gWide = gate(A, wide);
const gFine = gate(A, fine);
check('Book A: a bid at or under $0.15 is outside Model 1\'s trained quotes (not "too thin to take")', gThin.rank === 5 && /trained quotes: the bid/.test(gThin.failed ?? ''), gThin.failed ?? gThin.status);
check('Book A: a spread over 8% of the mid is outside Model 1\'s trained quotes', gWide.rank === 6 && /trained quotes: the spread/.test(gWide.failed ?? ''), gWide.failed ?? gWide.status);
check('Book A: a quote inside them goes on to the next gates', gFine.rank > 6 && gFine.passed.some(p => /Inside Model 1's trained quotes/.test(p)), gFine.failed ?? gFine.status);

/* 2. Book C: no price, bid or spread cap; at the money or out of it by delta */
const C = 15 * 60 + 30;
const atmDear = contract(600, 'C', 2.95, 3.0, at(C) - 5_000);
const atmThin = contract(600, 'C', 0.1, 0.14, at(C) - 5_000);
const itm = contract(585, 'C', 15.0, 15.1, at(C) - 5_000);
const gDear = gate(C, atmDear);
const gThinC = gate(C, atmThin);
const gItm = gate(C, itm);
const dDear = absDelta(atmDear, C);
const dItm = absDelta(itm, C);
check(`Book C: an at-the-money $3.00 ask (over the old $1.65 cap) passes its shape (${dDear.toFixed(2)} ≤ ${LOTTERY_DELTA_MAX} delta)`, gDear.rank > 8 && dDear <= LOTTERY_DELTA_MAX, gDear.failed ?? gDear.status);
check('Book C: a thin, wide quote (bid $0.10, spread 33%) is not refused on bid or spread — Model 3 does not read them', gThinC.rank !== 5 && gThinC.rank !== 6 && !/trained quotes/.test(gThinC.failed ?? ''), gThinC.failed ?? gThinC.status);
check(`Book C: an in-the-money contract (${dItm.toFixed(2)} delta) is not at the money or out of it`, gItm.rank === 8 && /Book C takes/.test(gItm.failed ?? '') && dItm > LOTTERY_DELTA_MAX, gItm.failed ?? gItm.status);

/* 3. Book B: the wing by delta, then the halving */
const B = 10 * 60 + 0;
const next = '2026-11-13';
const probe = readGate({ chain: chainAt(at(B) - 5_000, next), contract: fine, now: at(B), minute: B, retOpen: 0, p1: 0.9 });
const span = Number((probe.passed.find(p => /Offset/.test(p)) ?? '').match(/of (\d+)/)?.[1] ?? NaN);
let wingDone = false;
let wingSeen = false;
for (let off = 1; off <= 40 && !wingDone; off++) {
  for (const right of ['C', 'P'] as const) {
    const k = right === 'C' ? spot + off : spot - off;
    for (const [bid, ask] of [[1.5, 1.52], [0.4, 0.41]] as const) {
      const c = contract(k, right, bid, ask, at(B) - 5_000, ask * 2.5);
      const g = gate(B, c, next);
      const d = absDelta(c, B, next);
      if (!g.passed.some(p => /Inside Book B/.test(p))) continue;
      if (d > WING_DELTA_MAX && g.rank === 8 && /Book B is a wing/.test(g.failed ?? '')) {
        check(`Book B: a band contract at ${d.toFixed(2)} delta is not a wing (≤ ${WING_DELTA_MAX}), whatever its ask ($${ask})`, true);
        wingDone = true;
      }
      if (!wingSeen && d <= WING_DELTA_MAX && g.passed.some(p => /is a wing/.test(p))) {
        check(`Book B: a band contract at ${d.toFixed(2)} delta is a wing (a ${ask} ask, half of ${(ask * 2.5).toFixed(2)} or less)`, true);
        wingSeen = true;
      }
    }
  }
}
check(`Book B: the band was reached (span ${span}): a wing passed and a fatter contract was refused`, wingDone && wingSeen);

/* 4. validity */
const oneSided = contract(600, 'C', 0, 1.0, at(A) - 5_000);
const old = contract(600, 'C', 2.0, 2.04, at(A) - 120_000);
const gOne = readGate({ chain: { ...chainAt(at(A) - 120_000, DAY) }, contract: oneSided, now: at(A), minute: A, retOpen: 0, p1: 0.9 });
const gOld = readGate({ chain: { ...chainAt(at(A) - 120_000, DAY) }, contract: old, now: at(A), minute: A, retOpen: 0, p1: 0.9 });
check('validity: a one-sided quote (bid 0) is refused', gOne.rank === 1, gOne.failed ?? gOne.status);
check('validity: a quote older than 90 s is refused', gOld.rank === 1, gOld.failed ?? gOld.status);

if (fail) {
  console.log(`weigher-rules-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log("weigher-rules-proof OK: the Weigher's gate reads Compass's rules — Model 1's trained quotes for Books A and B, the wing and Book C by delta, no price cap");
