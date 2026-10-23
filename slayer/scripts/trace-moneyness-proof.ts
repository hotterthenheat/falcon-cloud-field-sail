/*
  Moneyness proof for Trace (audit round 7, the blocker: Screener › "Out of the
  money" returned in-the-money puts — CRWV 78P −40.3%, BAC 60P, TSLA 380P — and
  dropped the out-of-the-money NVDA 210P +1.0%; Compare's Money cut and the
  "Conviction puts" screen had the same inversion).

  otmPct is + out of the money for calls AND puts. The rows below are real
  Unusual Whales screener rows from the Oct 22 session (the fields the cut
  reads), run through the ACTUAL otmOf and the three cuts that read it.
  Run:  npx tsx scripts/trace-moneyness-proof.ts
*/
import { otmOf } from '../src/data/traceLive';
import { applyFilters, DEFAULT_FILTERS, moneynessFilter, runScreen, type BookContract } from '../src/data/flowBook';

/* /screener/option-contracts, 2026-10-22 (stock_price is the row's own) */
const RAW = [
  { option_symbol: 'NVDA261023C00220000', ticker: 'NVDA', strike: 220, right: 'C' as const, spot: 212.21, want: 'otm' },
  { option_symbol: 'NVDA270917C00190000', ticker: 'NVDA', strike: 190, right: 'C' as const, spot: 212.21, want: 'itm' },
  { option_symbol: 'NVDA261218P00210000', ticker: 'NVDA', strike: 210, right: 'P' as const, spot: 212.21, want: 'otm' },
  { option_symbol: 'CRWV261023P00078000', ticker: 'CRWV', strike: 78, right: 'P' as const, spot: 55.6, want: 'itm' },
  { option_symbol: 'TSLA261023P00380000', ticker: 'TSLA', strike: 380, right: 'P' as const, spot: 374.58, want: 'itm' },
];

const row = (r: (typeof RAW)[number]): BookContract =>
  ({
    key: r.option_symbol,
    optionSymbol: r.option_symbol,
    ticker: r.ticker,
    strike: r.strike,
    right: r.right,
    spot: r.spot,
    otmPct: otmOf(r.right, r.strike, r.spot, false),
    dte: 30,
    volume: 1000,
    premium: 1_000_000,
    sweepPct: 50,
  }) as unknown as BookContract;

const rows = RAW.map(row);
let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

for (const [i, r] of rows.entries()) {
  const want = RAW[i].want;
  const pct = r.otmPct.toFixed(1);
  check(`${r.optionSymbol} ${pct}% reads ${want.toUpperCase()} on Compare's Money cut`, moneynessFilter(r, want as 'itm' | 'otm') && !moneynessFilter(r, want === 'itm' ? 'otm' : 'itm'));
  check(`${r.optionSymbol} ${pct}% ${want === 'otm' ? 'kept' : 'dropped'} by Screener › Out of the money`, applyFilters([r], { ...DEFAULT_FILTERS, excludeItm: true }).length === (want === 'otm' ? 1 : 0));
}
const puts = runScreen(rows, 'conviction-puts').map(r => r.optionSymbol);
check(`Conviction puts takes the OTM put only (${puts.join(', ') || 'none'})`, puts.length === 1 && puts[0] === 'NVDA261218P00210000');
const calls = runScreen(rows, 'conviction-calls').map(r => r.optionSymbol);
check(`Conviction calls takes the OTM call only (${calls.join(', ') || 'none'})`, calls.length === 1 && calls[0] === 'NVDA261023C00220000');

console.log(fail ? `\n${fail} failed` : '\nall moneyness checks pass');
process.exit(fail ? 1 : 0);
