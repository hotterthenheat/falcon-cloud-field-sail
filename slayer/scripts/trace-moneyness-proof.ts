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
import { contractRow, liveSpotOf, noteSpot, otmOf } from '../src/data/traceLive';
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

/* ROUND 9 — THE LIVE SPOT, NOT THE SCREENER'S FROZEN stock_price. Real rows of Oct 23: the screener's stock_price sat at
   the vendor's 10:35 stock-state (NVDA 212.745, TSLA 370.22) while /stock/{t}/quote's last_trade ran on (NVDA 211.79 at
   17:31Z, TSLA 371.87 at 17:40Z). Run through the ACTUAL contractRow with the live prices noted (noteSpot — what the
   tape's underlying_price, the quote and /screener/stocks feed): */
const LIVE_ROWS = [
  { row: { option_symbol: 'NVDA261023C00212500', ticker_symbol: 'NVDA', strike: '212.5', option_type: 'call', expiry: '2026-10-23', stock_price: '212.745', volume: 174023, premium: '17034598.00' }, live: 211.79, want: 'otm' },
  { row: { option_symbol: 'TSLA261023C00370000', ticker_symbol: 'TSLA', strike: '370', option_type: 'call', expiry: '2026-10-23', stock_price: '370.22', volume: 1000, premium: '1000000' }, live: 371.87, want: 'itm' },
  { row: { option_symbol: 'TSLA261023P00370000', ticker_symbol: 'TSLA', strike: '370', option_type: 'put', expiry: '2026-10-23', stock_price: '370.22', volume: 1000, premium: '1000000' }, live: 371.87, want: 'otm' },
];
const frozenRows = LIVE_ROWS.map(x => contractRow(x.row, 0));
for (const [i, x] of LIVE_ROWS.entries()) {
  const t = String(x.row.ticker_symbol);
  const frozen = frozenRows[i];
  noteSpot(t, x.live, Date.now());
  const live = contractRow(x.row, 0);
  check(`${x.row.option_symbol}: screener ${x.row.stock_price} read ${frozen.otmPct.toFixed(2)}%; live ${liveSpotOf(t)} reads ${live.otmPct.toFixed(2)}% ${x.want.toUpperCase()}`, live.spot === x.live && (x.want === 'otm' ? live.otmPct > 0 : live.otmPct < 0));
}

/* THE BANDS DO NOT OVERLAP: within 1% of the spot either way a strike is ATM and neither ITM nor OTM (a 0.5% OTM strike
   was OTM and ATM at once); past it, ITM or OTM alone */
for (const [pct, want] of [[0.5, 'atm'], [-0.5, 'atm'], [1, 'atm'], [1.04, 'otm'], [-1.45, 'itm']] as const) {
  const r = { otmPct: pct, right: 'P' } as const;
  const got = (['itm', 'atm', 'otm'] as const).filter(m => moneynessFilter(r, m));
  check(`${pct}% from the spot reads ${want.toUpperCase()} alone (${got.join(', ') || 'none'})`, got.length === 1 && got[0] === want);
}

console.log(fail ? `\n${fail} failed` : '\nall moneyness checks pass');
process.exit(fail ? 1 : 0);
