/*
  The 1-day implied vol the book reads (data/book/move.ts dayIvOf / dayFracOf) when the vendor's interpolated-iv answer
  carries TWO blocks of tenors for the same date — an index with an AM-settled monthly root and a PM weekly root.
  The rows below are the vendor's own answers of 2026-11-05 after the close (/stock/{T}/interpolated-iv), verbatim.

  Which 1-day is right: the next session is priced by the weeklies' contracts. SPX's second block reads 0.359 at 1 day,
  the Nov 6 SPXW at-the-money vol (its gamma 0.002824 at 7335 is φ(0)/(S·σ·√T) at σ ≈ 0.37 on the 23.75 h to the close),
  and SPY — the same index, one root — reads 0.366. The first block is the monthly root alone (its 14-day 0.239 is the
  Nov 20 AM contract's 0.2409 a day off, its 365-day the Oct 2027 monthly's 0.1966): its 1-day is an extrapolation from
  15 days out. dayIvOf took the first block's row; it now takes the block whose 1-day implied move agrees with its vol
  by the k its own 30-day row prints.

  Run: npx tsx scripts/day-iv-proof.ts
*/
import { dayFracOf, dayIvOf } from '../src/data/book/move';
import type { UwInterp } from '../src/data/whales';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const DAYS = [1, 5, 7, 14, 30, 60, 90, 180, 365];
const block = (date: string, vols: number[], moves: number[]): UwInterp[] => DAYS.map((d, i) => ({ date, days: d, volatility: String(vols[i]), implied_move_perc: String(moves[i]), percentile: '0.9' }));
const D = '2026-11-05';
const SPX = [
  ...block(D, [0.226, 0.23, 0.232, 0.239, 0.217, 0.202, 0.195, 0.193, 0.197], [0.018, 0.022, 0.024, 0.031, 0.042, 0.055, 0.066, 0.091, 0.133]),
  ...block(D, [0.359, 0.265, 0.266, 0.241, 0.214, 0.201, 0.195, 0.193, 0.231], [0.012, 0.021, 0.025, 0.032, 0.042, 0.055, 0.065, 0.092, 0.16]),
];
const NDX = [
  ...block(D, [0.353, 0.357, 0.359, 0.366, 0.321, 0.288, 0.271, 0.258, 0.256], [0.035, 0.039, 0.041, 0.048, 0.062, 0.079, 0.091, 0.122, 0.17]),
  ...block(D, [0.547, 0.406, 0.407, 0.369, 0.32, 0.289, 0.273, 0.259, 0.385], [0.019, 0.032, 0.038, 0.048, 0.062, 0.079, 0.091, 0.123, 0.267]),
];
const RUT = [
  ...block(D, [-0.003, 0.001, 0.003, 0.01, 0.026, 0.056, 0.086, 0.176, 0.223], [-0.108, -0.104, -0.102, -0.095, -0.079, -0.049, -0.019, 0.071, 0.148]),
  ...block(D, [0.279, 0.283, 0.278, 0.261, 0.24, 0.228, 0.223, 0.222, 0.258], [0.018, 0.022, 0.026, 0.034, 0.046, 0.063, 0.075, 0.105, 0.176]),
];
const SPY = block(D, [0.366, 0.268, 0.268, 0.249, 0.223, 0.203, 0.198, 0.196, 0.2], [0.013, 0.021, 0.025, 0.033, 0.043, 0.056, 0.066, 0.093, 0.136]);

/* the first block's row, as dayIvOf read it before this audit (the latest date, the first row of it) */
const firstRow = (rows: UwInterp[]) => Number(rows.find(r => Number(r.days) === 1 && Number(r.volatility) > 0)!.volatility);
console.log(`     before: SPX 1-day ${firstRow(SPX)}, NDX ${firstRow(NDX)} — the monthly root's extrapolation`);

check(`SPX: the 1-day vol is the weeklies' 0.359 (the first block read ${firstRow(SPX)})`, dayIvOf(SPX) === 0.359);
check('SPX: the 1-day move is the same row\'s 1.2% (the first block read 1.8%)', dayFracOf(SPX) === 0.012);
check(`NDX: the weeklies' 0.547 and 1.9% (the first block read ${firstRow(NDX)} and 3.5%)`, dayIvOf(NDX) === 0.547 && dayFracOf(NDX) === 0.019);
check('RUT: the monthly block\'s 1-day is negative (no row) — the weeklies\' 0.279', dayIvOf(RUT) === 0.279 && dayFracOf(RUT) === 0.018);
check('SPY (one block): its own 0.366 and 1.3%, as before', dayIvOf(SPY) === 0.366 && dayFracOf(SPY) === 0.013);
check('SPX\'s weeklies agree with SPY on the next session within 3% (0.359 against 0.366)', Math.abs((dayIvOf(SPX) ?? 0) / (dayIvOf(SPY) ?? 1) - 1) < 0.03);
/* order-free: the vendor lists the monthly block first today; the same rows in the other order read the same */
const flip = (rows: UwInterp[]) => [...rows.slice(9), ...rows.slice(0, 9)];
check('the choice does not depend on the order the blocks arrive in (SPX, NDX, RUT reversed)', dayIvOf(flip(SPX)) === 0.359 && dayIvOf(flip(NDX)) === 0.547 && dayIvOf(flip(RUT)) === 0.279);
/* an older date's rows are never chosen over the latest date's */
const old = block('2026-11-04', [0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], [0.02, 0.03, 0.03, 0.03, 0.05, 0.06, 0.07, 0.09, 0.13]);
check('a block of an earlier date is not read', dayIvOf([...old, ...SPX]) === 0.359 && dayIvOf([...SPX, ...old]) === 0.359);
check('no rows, no vol', dayIvOf([]) === null && dayFracOf([]) === 0);

if (fail) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
console.log('\nday-iv proof: all checks pass');
