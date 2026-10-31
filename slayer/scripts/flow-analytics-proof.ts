/*
  Flow analytics proof: roll detection (src/data/flowRolls.ts), repeat-buyer clusters (src/data/flowRepeats.ts) and
  the dark-pool baseline (src/data/darkBaseline.ts), on hand-built vendor rows whose every expected number is worked
  out by hand in the comments, plus the recorded Unusual Whales tape of 2026-10-28 (scripts/fixtures/golden/trace-*).
  Pure and offline: the dark loader is fed a fake vendor; nothing leaves the machine.
  Run:  npx tsx scripts/flow-analytics-proof.ts      (CI runs it through scripts/golden/flow-analytics-golden.ts)
*/
import '../src/data/traceLive';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { detectRolls, printsOfRows, withoutRollLegs, type OrderUnit } from '../src/data/flowRolls';
import { detectRepeats, median } from '../src/data/flowRepeats';
import { baselineStat, loadDarkBaseline, sessionsBack } from '../src/data/darkBaseline';
import { summarizeTape } from '../src/data/tape';
import { nyWallTime } from '../src/core/nyTime';
import { done, expectEqual, expectNear } from './golden/uwFixtures';

/* The recorded SPY tape's rolls at 1 lot tagged / 10 inferred, each checked by hand against the raw rows:
   - none inferred: 16:14:51.287 SPY 777C 10/28 bought 10 @0.02 and 16:14:51.485 778C 10/29 sold 10 @0.50 would
     pair (both can close and open; 10/28 → 10/29 up-and-out, net −480), but the 9-lot 778C sold at :51.486 is a
     rival within ±10% (|10 − 9| ≤ 1) → ambiguous → no roll.
   - 16:14:55.062 'mlat' 772C 10/28 bought 3 ($156) / 774C 10/29 sold 3 ($486) — the millisecond's only two
     multi-leg contracts: net 156 − 486 = −330.
   - 16:14:55.100 'mlet' 772C 10/28 bought 5 ($265) / 775C 10/29 sold 5 ($615): −350.
   - 16:14:56.050 'mlet' 773C 10/28 bought 1 ($23) / 776C 10/29 sold 1 ($92): −69. */
const FIXTURE_LOOSE: string[] = [
  'tagged up-and-out short SPY|C|772|2026-10-28 ASK 3 → SPY|C|774|2026-10-29 BID 3 net -330',
  'tagged up-and-out short SPY|C|772|2026-10-28 ASK 5 → SPY|C|775|2026-10-29 BID 5 net -350',
  'tagged up-and-out short SPY|C|773|2026-10-28 ASK 1 → SPY|C|776|2026-10-29 BID 1 net -69',
];
/* ---------- vendor rows ---------- */
type Opt = { id?: string | null; t: string; sym: string; right: 'C' | 'P'; strike: number; exp: string; side: 'ask' | 'bid' | 'mid'; price: number; bid: number; ask: number; size: number; vol: number; oi: number; cond?: string; flags?: string[]; canceled?: boolean };
/** "14:00:00.800" New York on 2026-10-30 (EDT, UTC−4) → ISO */
const at = (t: string) => {
  const [h, m, rest] = t.split(':');
  const [s, ms = '0'] = rest.split('.');
  return new Date(nyWallTime(2026, 10, 30, Number(h), Number(m)) + Number(s) * 1000 + Number(ms.padEnd(3, '0'))).toISOString();
};
const msOf = (t: string) => Date.parse(at(t));
function opt(o: Opt): Record<string, unknown> {
  const row: Record<string, unknown> = {
    underlying_symbol: o.sym,
    option_chain_id: `${o.sym}${o.exp.slice(2, 4)}${o.exp.slice(5, 7)}${o.exp.slice(8, 10)}${o.right}${String(Math.round(o.strike * 1000)).padStart(8, '0')}`,
    option_type: o.right === 'C' ? 'call' : 'put',
    strike: String(o.strike),
    expiry: o.exp,
    executed_at: at(o.t),
    price: String(o.price),
    nbbo_bid: String(o.bid),
    nbbo_ask: String(o.ask),
    size: o.size,
    premium: (Math.round(o.price * o.size * 100 * 100) / 100).toFixed(2),
    volume: o.vol,
    open_interest: o.oi,
    tags: [`${o.side}_side`],
    upstream_condition_detail: o.cond ?? 'auto',
    report_flags: o.flags ?? [],
    canceled: o.canceled ?? false,
  };
  if (o.id !== null) row.id = o.id ?? `${o.sym}-${o.t}-${o.strike}${o.right}-${o.exp}-${o.size}`;
  return row;
}

/* R1 — the base inferred roll. XYZ 100C 11/20 sold on the bid (100 lots, oi 5,000 ≥ 100: can close; vol 800 ≤ oi:
   no opening read), 0.8 s later 105C 12/18 bought at the ask (95 lots, vol 300 > oi 50: opening; oi 50 < 95: cannot
   close). |100 − 95| = 5 ≤ 10% × 100. Only 100C → 105C is valid: later expiry, higher strike = up-and-out; the close
   was sold = a long position. Premiums 100 × $2.00 × 100 = $20,000 and 95 × $1.50 × 100 = $14,250; net = bought −
   sold = 14,250 − 20,000 = −$5,750 (a credit). size = min(100, 95) = 95. */
const R1a = (o: Partial<Opt> = {}) => opt({ id: 'r1a', t: '14:00:00.000', sym: 'XYZ', right: 'C', strike: 100, exp: '2026-11-20', side: 'bid', price: 2, bid: 2, ask: 2.1, size: 100, vol: 800, oi: 5000, ...o });
const R1b = (o: Partial<Opt> = {}) => opt({ id: 'r1b', t: '14:00:00.800', sym: 'XYZ', right: 'C', strike: 105, exp: '2026-12-18', side: 'ask', price: 1.5, bid: 1.4, ask: 1.5, size: 95, vol: 300, oi: 50, ...o });
{
  const read = detectRolls(printsOfRows([R1a(), R1b()]));
  expectEqual('R1 one roll', read.rolls.length, 1);
  const r = read.rolls[0];
  expectEqual('R1 kind / holder / confidence', [r.kind, r.holder, r.confidence], ['up-and-out', 'long', 'inferred']);
  expectEqual('R1 from → to', [r.from.contract, r.to.contract], ['XYZ|C|100|2026-11-20', 'XYZ|C|105|2026-12-18']);
  expectNear('R1 size', r.size, 95);
  expectNear('R1 net premium (bought 14,250 − sold 20,000)', r.netPremium, -5750);
  expectNear('R1 gap ms', r.gapMs, 800);
  expectNear('R1 ts = the earlier leg', r.ts, msOf('14:00:00.000'));
  expectEqual('R1 excludeIds', [...read.excludeIds].sort(), ['r1a', 'r1b']);
  /* directional net: 100C sold on the bid = bearish $20,000, 105C bought = bullish $14,250 → −5,750 with the legs,
     0 without them (the roll is one repositioning, not two bets) */
  const prints = printsOfRows([R1a(), R1b()]);
  expectNear('R1 tape net with both legs', summarizeTape(prints).netPremium, -5750);
  expectNear('R1 tape net without the roll legs', summarizeTape(withoutRollLegs(prints, read)).netPremium, 0);
}
/* duplicates: r1a twice (same id) is one print — counted twice it would be a 200-lot, off 95 by more than 10% */
expectEqual('R1 duplicate print counted once', detectRolls(printsOfRows([R1a(), R1a(), R1b()])).rolls.map(r => r.from.size), [100]);
/* cancels: the vendor's canceled row is dropped (printsOfRows), and so is a print named in `cancelled` */
expectEqual('cancelled leg (vendor flag) → no roll', detectRolls(printsOfRows([R1a(), R1b({ canceled: true })])).rolls.length, 0);
expectEqual('cancelled leg (cancelled set) → no roll', detectRolls(printsOfRows([R1a(), R1b()]), { cancelled: new Set(['r1b']) }).rolls.length, 0);
/* a cross trade takes no side (MID) */
expectEqual('cross-trade leg → no roll', detectRolls(printsOfRows([R1a(), R1b({ flags: ['cross_trade'] })])).rolls.length, 0);
/* a mid fill: tagged mid at 1.45 inside 1.40 × 1.50 sits at 0.5 of the spread → MID */
expectEqual('mid-fill leg → no roll', detectRolls(printsOfRows([R1a(), R1b({ side: 'mid', price: 1.45 })])).rolls.length, 0);
/* missing ids: the print's content is its key (printKeyOf); an identical no-id row is the same print */
{
  const a = R1a({ id: null });
  const read = detectRolls(printsOfRows([a, { ...a }, R1b({ id: null })]));
  expectEqual('no-id legs: one roll, the 100-lot once', read.rolls.map(r => [r.from.size, r.to.size]), [[100, 95]]);
  expectEqual('no-id legs: two content keys excluded', read.excludeIds.size, 2);
}
/* the 2 s window is inclusive: 2,000 ms pairs, 2,001 does not */
expectEqual('gap 2,000 ms → roll', detectRolls(printsOfRows([R1a(), R1b({ t: '14:00:02.000' })])).rolls.length, 1);
expectEqual('gap 2,001 ms → no roll', detectRolls(printsOfRows([R1a(), R1b({ t: '14:00:02.001' })])).rolls.length, 0);
/* ±10% of the larger: 90 vs 100 differs by 10 ≤ 10 → pairs; 89 by 11 > 10 → not */
expectEqual('size 100 vs 90 → roll', detectRolls(printsOfRows([R1a(), R1b({ size: 90 })])).rolls.length, 1);
expectEqual('size 100 vs 89 → no roll', detectRolls(printsOfRows([R1a(), R1b({ size: 89 })])).rolls.length, 0);
/* a rival under the line still makes it ambiguous: 100C sold 52, 105C bought 50, and a 47-lot 110C bought 0.5 s
   later (|52 − 47| = 5 ≤ 5.2) → no roll; without the 47-lot → the roll */
{
  const rival = opt({ id: 'r1r', t: '14:00:01.300', sym: 'XYZ', right: 'C', strike: 110, exp: '2026-12-18', side: 'ask', price: 1, bid: 0.9, ask: 1, size: 47, vol: 300, oi: 50 });
  expectEqual('rival 47-lot → no roll', detectRolls(printsOfRows([R1a({ size: 52 }), R1b({ size: 50 }), rival])).rolls.length, 0);
  expectEqual('no rival → roll', detectRolls(printsOfRows([R1a({ size: 52 }), R1b({ size: 50 })])).rolls.length, 1);
}
/* inferred legs need 50 lots: 49 vs 49 is under the line */
expectEqual('inferred 49-lots → no roll', detectRolls(printsOfRows([R1a({ size: 49 }), R1b({ size: 49 })])).rolls.length, 0);
/* zero volume and zero interest: 105C with vol 0 / oi 0 can neither open (no volume) nor close (0 < 95); 100C cannot
   open (800 ≤ 5,000) → no direction → no roll. A size-0 print is not a fill. */
expectEqual('zero volume / oi leg → no roll', detectRolls(printsOfRows([R1a(), R1b({ vol: 0, oi: 0 })])).rolls.length, 0);
expectEqual('size-0 leg → no roll', detectRolls(printsOfRows([R1a(), R1b({ size: 0 })])).rolls.length, 0);
/* same side, or another right, never pairs */
expectEqual('same side → no roll', detectRolls(printsOfRows([R1a(), R1b({ side: 'bid', price: 1.4 })])).rolls.length, 0);
expectEqual('call vs put → no roll', detectRolls(printsOfRows([R1a(), R1b({ right: 'P' })])).rolls.length, 0);

/* R2 — a tagged roll, one leg filled in two prints. ABC 50P 11/20 bought at the ask in one millisecond as 20 + 30 lots
   (multi-leg 'mlet'), 45P 12/18 sold on the bid, 50 lots, same millisecond. Units: 50P ASK 50, 45P BID 50. 50P can
   close (oi 1,000 ≥ 50), 45P can open (vol 60 > oi 10) and cannot close (10 < 50) → 50P → 45P: later and lower =
   down-and-out; the close was bought = a short position. Premiums 20 × 120 + 30 × 120 = 6,000 and 50 × 80 = 4,000;
   net = 6,000 − 4,000 = +$2,000 (a debit). */
const R2 = [
  opt({ id: 'r2a1', t: '14:10:00.000', sym: 'ABC', right: 'P', strike: 50, exp: '2026-11-20', side: 'ask', price: 1.2, bid: 1.1, ask: 1.2, size: 20, vol: 200, oi: 1000, cond: 'mlet' }),
  opt({ id: 'r2a2', t: '14:10:00.000', sym: 'ABC', right: 'P', strike: 50, exp: '2026-11-20', side: 'ask', price: 1.2, bid: 1.1, ask: 1.2, size: 30, vol: 200, oi: 1000, cond: 'mlet' }),
  opt({ id: 'r2b', t: '14:10:00.000', sym: 'ABC', right: 'P', strike: 45, exp: '2026-12-18', side: 'bid', price: 0.8, bid: 0.8, ask: 0.9, size: 50, vol: 60, oi: 10, cond: 'mlet' }),
];
{
  const read = detectRolls(printsOfRows(R2));
  const r = read.rolls[0];
  expectEqual('R2 tagged roll', read.rolls.map(x => [x.kind, x.holder, x.confidence, x.size, x.gapMs]), [['down-and-out', 'short', 'tagged', 50, 0]]);
  expectNear('R2 net premium (6,000 − 4,000)', r.netPremium, 2000);
  expectEqual('R2 both 50P prints excluded', [...read.excludeIds].sort(), ['r2a1', 'r2a2', 'r2b']);
  /* tagged legs only need 10 lots; 9-lots are under it */
  expectEqual('R2 at 9 lots → no roll', detectRolls(printsOfRows([R2[0], R2[2]].map(r => ({ ...r, size: 9, premium: '0' })))).rolls.length, 0);
}

/* R3 — a four-leg multi-leg order (double calendar) is a spread: the two sided legs alone would pair, but the
   millisecond holds four multi-leg contracts (two of them mid) → no roll. Dropping the mid legs shows the guard is
   what decides. */
const R3 = [
  opt({ id: 'r3a', t: '14:20:00.000', sym: 'DEF', right: 'C', strike: 30, exp: '2026-11-20', side: 'ask', price: 1, bid: 0.9, ask: 1, size: 20, vol: 100, oi: 1000, cond: 'mlet' }),
  opt({ id: 'r3b', t: '14:20:00.000', sym: 'DEF', right: 'C', strike: 35, exp: '2026-11-20', side: 'mid', price: 0.5, bid: 0.45, ask: 0.55, size: 20, vol: 100, oi: 1000, cond: 'mlet' }),
  opt({ id: 'r3c', t: '14:20:00.000', sym: 'DEF', right: 'C', strike: 30, exp: '2026-12-18', side: 'bid', price: 2, bid: 2, ask: 2.1, size: 20, vol: 40, oi: 5, cond: 'mlet' }),
  opt({ id: 'r3d', t: '14:20:00.000', sym: 'DEF', right: 'C', strike: 35, exp: '2026-12-18', side: 'mid', price: 1, bid: 0.95, ask: 1.05, size: 20, vol: 40, oi: 5, cond: 'mlet' }),
];
expectEqual('R3 four-leg order → no roll', detectRolls(printsOfRows(R3)).rolls.length, 0);
expectEqual('R3 its two sided legs alone → one tagged roll', detectRolls(printsOfRows([R3[0], R3[2]])).rolls.map(r => r.confidence), ['tagged']);

/* R4 — ambiguity: GHI 10C sold 100, then 12C and 14C (12/18) each bought 100 within 1 s: 10C has two partners → no
   roll; without the 14C print the match is unique → one roll. */
const R4 = [
  opt({ id: 'r4a', t: '14:30:00.000', sym: 'GHI', right: 'C', strike: 10, exp: '2026-11-20', side: 'bid', price: 1, bid: 1, ask: 1.1, size: 100, vol: 100, oi: 5000 }),
  opt({ id: 'r4b', t: '14:30:00.500', sym: 'GHI', right: 'C', strike: 12, exp: '2026-12-18', side: 'ask', price: 0.6, bid: 0.5, ask: 0.6, size: 100, vol: 300, oi: 10 }),
  opt({ id: 'r4c', t: '14:30:01.000', sym: 'GHI', right: 'C', strike: 14, exp: '2026-12-18', side: 'ask', price: 0.3, bid: 0.2, ask: 0.3, size: 100, vol: 300, oi: 10 }),
];
expectEqual('R4 two candidate partners → no roll', detectRolls(printsOfRows(R4)).rolls.length, 0);
expectEqual('R4 one partner → one roll', detectRolls(printsOfRows(R4.slice(0, 2))).rolls.map(r => r.kind), ['up-and-out']);

/* R5 — one expiry (roll up vs a vertical spread). JKL 20C sold 60 at $3.00, 25C bought 60 at $1.00, both 11/20.
   Without the next session's counts → no roll. With them: 20C 5,000 → 4,950 (fell: closed by count), 25C 10 → 70
   (grew 60 ≥ ½ × vol 100: opening; it did not fall) → 20C → 25C, "up", long. Net = 60 × 100 − 60 × 300 = −$12,000. */
const R5 = [
  opt({ id: 'r5a', t: '14:40:00.000', sym: 'JKL', right: 'C', strike: 20, exp: '2026-11-20', side: 'bid', price: 3, bid: 3, ask: 3.1, size: 60, vol: 100, oi: 5000 }),
  opt({ id: 'r5b', t: '14:40:00.300', sym: 'JKL', right: 'C', strike: 25, exp: '2026-11-20', side: 'ask', price: 1, bid: 0.95, ask: 1, size: 60, vol: 100, oi: 10 }),
];
const R5next = (u: OrderUnit) => (u.contract === 'JKL|C|20|2026-11-20' ? { oi: 4950, before: 5000 } : u.contract === 'JKL|C|25|2026-11-20' ? { oi: 70, before: 10 } : null);
expectEqual('R5 one expiry, no next counts → no roll', detectRolls(printsOfRows(R5)).rolls.length, 0);
{
  const r = detectRolls(printsOfRows(R5), { nextOi: R5next }).rolls;
  expectEqual('R5 with next counts → roll up, long', r.map(x => [x.kind, x.holder, x.from.strike, x.to.strike]), [['up', 'long', 20, 25]]);
  expectNear('R5 net premium (6,000 − 18,000)', r[0]?.netPremium ?? NaN, -12000);
}

/* R6 — the next count decides an open the volume cannot: EFG 100C 11/20 sold 100 (oi 5,000, vol 800), 105C 12/18
   bought 100 (oi 500, vol 400: 400 ≤ 500, no opening read, and it could close). Neither leg opens → no roll. With the
   105C count 500 → 750 (+250 ≥ ½ × 400) it opened, and having grown it cannot have closed → 100C → 105C. */
const R6 = [
  opt({ id: 'r6a', t: '14:50:00.000', sym: 'EFG', right: 'C', strike: 100, exp: '2026-11-20', side: 'bid', price: 2, bid: 2, ask: 2.1, size: 100, vol: 800, oi: 5000 }),
  opt({ id: 'r6b', t: '14:50:00.400', sym: 'EFG', right: 'C', strike: 105, exp: '2026-12-18', side: 'ask', price: 1.5, bid: 1.4, ask: 1.5, size: 100, vol: 400, oi: 500 }),
];
expectEqual('R6 no opening read → no roll', detectRolls(printsOfRows(R6)).rolls.length, 0);
expectEqual(
  'R6 next count shows the open → up-and-out',
  detectRolls(printsOfRows(R6), { nextOi: u => (u.contract === 'EFG|C|105|2026-12-18' ? { oi: 750, before: 500 } : null) }).rolls.map(r => [r.kind, r.from.strike, r.to.strike]),
  [['up-and-out', 100, 105]]
);

/* ---------- repeat clusters ---------- */
/* QRS 30C 11/20 bought at the ask: 14:00:00 20 lots @1.10 (fillPos 1), 14:02:00 100 lots (off-size), 14:04:00 25 @1.08
   (fillPos (1.08 − 1.00) / 0.10 = 0.8, still the ask's), 14:13:59 a 22-lot sweep split 12 + 10 in one ms (one hit),
   14:24:00 20 lots (10:01 after → its own run). Also: a duplicate of the 14:00 print, a cancelled 21-lot at 14:08, a
   bid-side 20-lot at 14:06, a cross at 14:07, a mid fill at 14:09 and a three-print multi-leg run — none counted.
   Run 14:00–14:13:59 (gaps 2:00, 2:00, 9:59): sizes 20, 100, 25, 22 → median (22 + 25) / 2 = 23.5, ±30% = ±7.05
   → 100 drops; 20, 25, 22 re-split (gaps 4:00, 9:59) → median 22, ±6.6 → all kept → one cluster of 3 hits.
   totalSize 67; premium 20 × 110 + 25 × 108 + 12 × 110 + 10 × 110 = 2,200 + 2,700 + 1,320 + 1,100 = $7,320;
   avgFillPos (20 × 1 + 25 × 0.8 + 22 × 1) / 67 = 62 / 67; sweepShare 22 / 67. */
const q = (id: string, t: string, size: number, o: Partial<Opt> = {}) => opt({ id, t, sym: 'QRS', right: 'C', strike: 30, exp: '2026-11-20', side: 'ask', price: 1.1, bid: 1, ask: 1.1, size, vol: 5000, oi: 2000, ...o });
const QRS = [
  q('q1', '14:00:00.000', 20),
  q('q1', '14:00:00.000', 20),
  q('q2', '14:02:00.000', 100),
  q('q3', '14:04:00.000', 25, { price: 1.08 }),
  q('qb', '14:06:00.000', 20, { side: 'bid', price: 1 }),
  q('qx', '14:07:00.000', 21, { flags: ['cross_trade'] }),
  q('qc', '14:08:00.000', 21, { canceled: true }),
  q('qm', '14:09:00.000', 21, { side: 'mid', price: 1.05 }),
  q('qs1', '14:13:59.000', 12, { cond: 'isoi' }),
  q('qs2', '14:13:59.000', 10, { cond: 'isoi' }),
  q('q5', '14:24:00.000', 20),
  q('ml1', '14:30:00.000', 20, { cond: 'mlet' }),
  q('ml2', '14:31:00.000', 20, { cond: 'mlet' }),
  q('ml3', '14:32:00.000', 20, { cond: 'mlet' }),
];
{
  const rp = detectRepeats(printsOfRows(QRS));
  expectEqual('QRS one cluster', rp.clusters.length, 1);
  const c = rp.clusters[0];
  expectEqual('QRS cluster hits / side / prints', [c.hits, c.side, c.prints], [3, 'ASK', ['q1', 'q3', 'qs1', 'qs2']]);
  expectNear('QRS totalSize', c.totalSize, 67);
  expectNear('QRS totalPremium', c.totalPremium, 7320);
  expectNear('QRS medianSize', c.medianSize, 22);
  expectNear('QRS avgFillPos = 62/67', c.avgFillPos, 62 / 67);
  expectNear('QRS sweepShare = 22/67', c.sweepShare, 22 / 67);
  expectEqual('QRS first / last', [c.firstTs, c.lastTs], [msOf('14:00:00.000'), msOf('14:13:59.000')]);
  /* the cancelled 21-lot, had it counted, would be a fourth hit (14:08, within ±6.6 of 22) */
  expectEqual('QRS cancelled hit stays out', detectRepeats(printsOfRows(QRS.map(r => (r.id === 'qc' ? { ...r, canceled: false } : r)))).clusters[0]?.hits, 4);
  /* a roll's legs passed as `exclude` leave: without q3 the run is 20, 22 → under three hits */
  expectEqual('QRS exclude q3 → no cluster', detectRepeats(printsOfRows(QRS), { exclude: new Set(['q3']) }).clusters.length, 0);
}
/* 10:00 apart exactly still chains; 10:00.001 does not */
expectEqual('gap 10:00 → cluster', detectRepeats(printsOfRows([q('g1', '14:00:00.000', 20), q('g2', '14:10:00.000', 20), q('g3', '14:20:00.000', 20)])).clusters.length, 1);
expectEqual('gap 10:00.001 → none', detectRepeats(printsOfRows([q('g1', '14:00:00.000', 20), q('g2', '14:10:00.001', 20), q('g3', '14:20:00.001', 20)])).clusters.length, 0);
/* hits under 10 lots are not counted; with the floor at 1 the five 5-lots are a cluster */
{
  const small = [0, 1, 2, 3, 4].map(i => q(`s${i}`, `14:0${i}:00.000`, 5));
  expectEqual('5-lots → no cluster', detectRepeats(printsOfRows(small)).clusters.length, 0);
  expectEqual('5-lots with minSize 1 → one cluster of 5', detectRepeats(printsOfRows(small), { minSize: 1 }).clusters.map(c => c.hits), [5]);
}
/* median of an even count is the mean of the middle two */
expectNear('median [20,100,25,22] = 23.5', median([20, 100, 25, 22]), 23.5);
/* strips: TUV 40P sold 30 (11/06) 14:00, 30 (11/13) 14:03, 33 (11/13) 14:05; the tape shows 11/06, 11/13, 11/20 →
   two adjacent expiries, median 30, ±9 keeps 33 → one strip: 93 lots, 3 × $2.00 → 30 × 200 + 30 × 200 + 33 × 200 =
   $18,600. No contract has three hits → no contract cluster. WXY, the same on 11/06 and 11/20 with 11/13 listed
   between them, is not adjacent → no strip. */
{
  const s = (sym: string, id: string, t: string, exp: string, size: number, strike = 40) => opt({ id, t, sym, right: 'P', strike, exp, side: 'bid', price: 2, bid: 2, ask: 2.1, size, vol: 900, oi: 900 });
  const rp = detectRepeats(printsOfRows([s('TUV', 't1', '14:00:00.000', '2026-11-06', 30), s('TUV', 't2', '14:03:00.000', '2026-11-13', 30), s('TUV', 't3', '14:05:00.000', '2026-11-13', 33), s('TUV', 't4', '14:06:00.000', '2026-11-20', 10, 41)]));
  expectEqual('TUV strip', rp.strips.map(c => [c.kind, c.hits, c.expiries, c.totalSize, c.contract]), [['strip', 3, ['2026-11-06', '2026-11-13'], 93, null]]);
  expectNear('TUV strip premium', rp.strips[0]?.totalPremium ?? NaN, 18600);
  expectEqual('TUV no contract cluster', rp.clusters.length, 0);
  const w = detectRepeats(printsOfRows([s('WXY', 'w1', '14:00:00.000', '2026-11-06', 30), s('WXY', 'w2', '14:03:00.000', '2026-11-20', 30), s('WXY', 'w3', '14:05:00.000', '2026-11-20', 31), s('WXY', 'w4', '14:06:00.000', '2026-11-13', 10, 41)]));
  expectEqual('WXY non-adjacent expiries → no strip', w.strips.length, 0);
}

/* ---------- the recorded tape (Unusual Whales, SPY, 2026-10-28 16:14:49–16:14:59 ET, 500 prints) ---------- */
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden', 'trace-2026-10-29');
const fixRows = (f: string) => JSON.parse(JSON.parse(gunzipSync(readFileSync(join(FIX, `${f}.json.gz`))).toString('utf8')).body).data as Record<string, unknown>[];
{
  const rows = fixRows('07ba44e9f2b1bb99');
  const prints = printsOfRows(rows);
  expectEqual('fixture: 500 prints, none cancelled', [rows.length, prints.length], [500, 500]);
  expectEqual('fixture: no roll at the default sizes (no leg reaches 10 tagged / 50 inferred)', detectRolls(prints).rolls.length, 0);
  /* at 1 lot tagged / 10 inferred, by hand from the raw rows: */
  const loose = detectRolls(prints, { minSize: 1, inferredMinSize: 10 });
  const brief = loose.rolls.map(r => `${r.confidence} ${r.kind} ${r.holder} ${r.from.contract} ${r.from.side} ${r.from.size} → ${r.to.contract} ${r.to.side} ${r.to.size} net ${r.netPremium}`);
  for (const b of brief) console.log('      ', b);
  expectEqual('fixture: loose roll count', loose.rolls.length, FIXTURE_LOOSE.length);
  expectEqual('fixture: loose rolls', brief, FIXTURE_LOOSE);
  /* repeats: ten seconds of tape has no ≥10-lot run of three. At 1 lot, SPY 765P 10/29 bought at the ask, by hand from
     the raw rows: single-leg hits 16:14:49.435 1 ($63), :51.521 2 + 2 + 1 = 5 in one ms ($320), :53.363 1 ($65),
     :56.593 1 ($66), :57.906 1 ($65) (the 27-lot at :52.412 is a 'mesl' multi-leg leg — out). Median of
     [1, 5, 1, 1, 1] = 1, ±0.3 drops the 5 → four 1-lot hits: 4 contracts, 63 + 65 + 66 + 65 = $259, every fill at the
     ask (fillPos 1), no sweep. */
  expectEqual('fixture: no repeat cluster at 10 lots', detectRepeats(prints, { exclude: detectRolls(prints).excludeIds }).clusters.length, 0);
  const c = detectRepeats(prints, { minSize: 1 }).clusters.find(x => x.contract === 'SPY|P|765|2026-10-29' && x.side === 'ASK');
  expectEqual('fixture: 765P ask cluster hits / size / premium / fillPos / sweep', c && [c.hits, c.totalSize, c.totalPremium, c.avgFillPos, c.sweepShare], [4, 4, 259, 1, 0]);
  expectEqual('fixture: 765P first / last', c && [new Date(c.firstTs).toISOString(), new Date(c.lastTs).toISOString()], ['2026-10-28T20:14:49.435Z', '2026-10-28T20:14:57.906Z']);
}

/* ---------- dark baseline ---------- */
/* baselineStat by hand: today 50 over [40, 42, 44, 46, 48]: mean 44; squares 16 + 4 + 0 + 4 + 16 = 40, / 4 = 10, sd √10;
   z = 6 / √10 = 1.897366596; all five under 50 → percentile 100; n 5 < 20 → PARTIAL */
{
  const s = baselineStat(50, [40, 42, 44, 46, 48]);
  expectNear('stat mean', s.mean, 44);
  expectNear('stat sd = √10', s.sd, Math.sqrt(10));
  expectNear('stat z = 6/√10', s.z ?? NaN, 1.897366596);
  expectNear('stat percentile', s.percentile ?? NaN, 100);
  expectEqual('stat status n=5', s.status, 'PARTIAL');
  /* a tie at the mean: two under, one equal → (2 + ½) / 5 = 50%; z 0 */
  const t = baselineStat(44, [40, 42, 44, 46, 48]);
  expectEqual('tie: percentile 50, z 0', [t.percentile, t.z], [50, 0]);
  /* NaN sessions are left out: [40, NaN, 42, 44, 46] is four → UNAVAILABLE, no z, no percentile */
  const u = baselineStat(50, [40, NaN, 42, 44, 46]);
  expectEqual('four sessions → UNAVAILABLE, no figures', [u.n, u.status, u.z, u.percentile], [4, 'UNAVAILABLE', null, null]);
  /* sd 0 (twenty equal sessions): no z; at the value the percentile is 50; n 20 → OK */
  const f = baselineStat(40, Array(20).fill(40));
  expectEqual('flat baseline: no z, percentile 50, OK', [f.z, f.percentile, f.status], [null, 50, 'OK']);
  expectEqual('no value today → UNAVAILABLE', baselineStat(NaN, Array(20).fill(40)).status, 'UNAVAILABLE');
}
expectEqual('sessionsBack 2026-10-30, 6', sessionsBack('2026-10-30', 6), ['2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', '2026-10-23', '2026-10-22']);

/* The loader on a fake vendor, ZZZ, today 2026-10-30 and seven sessions back. advUsd 11.7e9 → floor = 11.7e9 /
   23,400 = $500,000. Each day: price levels 100 (dark D, lit 1,000) and 90 (dark 50, lit 0 — off-market, never
   counted), one-minute bars running to V; dark prints of $600,000 at 100.01 (over the 100.00 mid: bought) or 99.99
   (under: sold), in the regular session.
     share:  today 400 / 1,000 = 40%; 10-29 300/1000 = 30, 10-28 25, 10-27 35, 10-26 30, 10-23 no bars (volume 0) →
             no share, 10-22 200/1000 = 20, 10-21 nothing at all. Baseline [30, 25, 35, 30, 20]: mean 28; squares
             4 + 9 + 49 + 4 + 64 = 130, / 4 = 32.5 → sd √32.5 = 5.700877; z = 12 / √32.5 = 2.104940; percentile 100;
             n 5 of 7 → PARTIAL.
     posture: today 520 prints (j % 4 = 0 sold: 130; bought 390), read over two pages (500, then older_than — the
             fake repeats the boundary print, read once); besides them a cancelled $5M, an after-hours $5M, a $5M print
             of another day and a $5M average-price trade, none read → net (390 − 130) / 520 = 50% (ACCUMULATING).
             History of 12 prints a day: 10-29 6/6 → 0; 10-28 8/4 → 33.33; 10-27 4/8 → −33.33; 10-26 7/5 → 16.67;
             10-23 6/6 → 0; 10-22 eleven prints → not enough; 10-21 none. Baseline [0, 100/3, −100/3, 50/3, 0]:
             mean 10/3; squares (10² + 90² + 110² + 40² + 10²)/9 = 22,000/9, / 4 = 5,500/9 → sd √5500 / 3 = 24.720661;
             z = (50 − 10/3) / sd = 1.887760; percentile 100; PARTIAL.
     coverage: 10-21 has neither → missing ['2026-10-21']. */
{
  const DAYS: Record<string, { D: number; V: number; buys: number; sells: number }> = {
    '2026-10-30': { D: 400, V: 1000, buys: 390, sells: 130 },
    '2026-10-29': { D: 300, V: 1000, buys: 6, sells: 6 },
    '2026-10-28': { D: 250, V: 1000, buys: 8, sells: 4 },
    '2026-10-27': { D: 350, V: 1000, buys: 4, sells: 8 },
    '2026-10-26': { D: 300, V: 1000, buys: 7, sells: 5 },
    '2026-10-23': { D: 280, V: 0, buys: 6, sells: 6 },
    '2026-10-22': { D: 200, V: 1000, buys: 6, sells: 5 },
  };
  const utc = (iso: string, h: number, m: number, s: number) => {
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(nyWallTime(y, mo, d, h, m) + s * 1000).toISOString();
  };
  const dp = (iso: string, j: number, over: boolean, extra: Record<string, unknown> = {}) => ({ ticker: 'ZZZ', tracking_id: `${iso}-${j}`, executed_at: utc(iso, 9, 30, j), price: over ? '100.01' : '99.99', size: 6000, premium: '600000', nbbo_bid: '99.99', nbbo_ask: '100.01', volume: 1000, sale_cond_codes: null, market_center: 'L', canceled: false, ...extra });
  const prints: Record<string, Record<string, unknown>[]> = {};
  for (const [iso, d] of Object.entries(DAYS)) {
    const n = d.buys + d.sells;
    const list: Record<string, unknown>[] = [];
    for (let j = 0; j < n; j++) list.push(dp(iso, j, iso === '2026-10-30' ? j % 4 !== 0 : j < d.buys));
    prints[iso] = list;
  }
  prints['2026-10-30'].push(
    dp('2026-10-30', 9001, true, { premium: '5000000', canceled: true }),
    { ...dp('2026-10-30', 9002, true, { premium: '5000000' }), executed_at: utc('2026-10-30', 17, 0, 0) },
    { ...dp('2026-10-30', 9003, false, { premium: '5000000' }), executed_at: utc('2026-10-29', 14, 0, 0) },
    dp('2026-10-30', 9004, false, { premium: '5000000', sale_cond_codes: 'average_price_trade' })
  );
  const asked: string[] = [];
  const fake = async (path: string): Promise<unknown> => {
    asked.push(path);
    const u = new URL(`http://x${path}`);
    const date = u.searchParams.get('date') ?? '';
    const day = DAYS[date];
    if (/\/ohlc\/1m$/.test(u.pathname)) return { data: day && day.V > 0 ? [{ total_volume: day.V / 2 }, { total_volume: day.V }] : [] };
    if (/\/price-levels$/.test(u.pathname)) return { data: day ? [{ price: '100', dark_pool_volume: String(day.D), regular_volume: '1000' }, { price: '90', dark_pool_volume: '50', regular_volume: '0' }] : [] };
    if (/^\/darkpool\/ZZZ$/.test(u.pathname)) {
      const min = Number(u.searchParams.get('min_premium') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 500);
      const older = u.searchParams.get('older_than');
      /* newest first; older_than inclusive, so a page boundary repeats one print */
      const list = (prints[date] ?? []).filter(r => Number(r.premium) >= min && (older == null || Date.parse(String(r.executed_at)) <= Number(older))).sort((a, b) => Date.parse(String(b.executed_at)) - Date.parse(String(a.executed_at)));
      return { data: list.slice(0, limit) };
    }
    throw new Error(`fake vendor: unexpected ${path}`);
  };
  const b = await loadDarkBaseline(fake, 'ZZZ', '2026-10-30', { sessions: 7, advUsd: 11.7e9 });
  expectNear('dark floor $500,000', b.floorUsd, 500000);
  expectEqual('dark: no screener call when adv is given', asked.some(p => p.startsWith('/screener')), false);
  expectEqual('dark: today paged twice', asked.filter(p => p.startsWith('/darkpool/ZZZ?date=2026-10-30')).length, 2);
  expectNear('dark share today 40%', b.share.today, 40);
  expectEqual('dark share baseline sessions', b.coverage.withShare, ['2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', '2026-10-22']);
  expectNear('dark share mean 28', b.share.mean, 28);
  expectNear('dark share sd √32.5', b.share.sd, 5.700877125);
  expectNear('dark share z', b.share.z ?? NaN, 2.104939835);
  expectEqual('dark share percentile / status', [b.share.percentile, b.share.status], [100, 'PARTIAL']);
  expectEqual('dark posture today: 520 read, ACCUMULATING', [b.today.postureRead, b.posture.todayPosture], [520, 'ACCUMULATING']);
  expectNear('dark posture today net 50', b.posture.today, 50);
  expectEqual('dark posture baseline sessions', b.coverage.withPosture, ['2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', '2026-10-23']);
  expectNear('dark posture mean 10/3', b.posture.mean, 10 / 3);
  expectNear('dark posture sd √5500/3', b.posture.sd, 24.72066031);
  expectNear('dark posture z', b.posture.z ?? NaN, 1.887760294);
  expectEqual('dark posture percentile / status', [b.posture.percentile, b.posture.status], [100, 'PARTIAL']);
  expectEqual('dark missing sessions', b.coverage.missing, ['2026-10-21']);
}

done();
