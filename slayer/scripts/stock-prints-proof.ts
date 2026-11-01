/*
  Terrain's stock tape (src/data/tapeServer.ts ingestStock, data/printTags.ts, components/gex/tapeMarks.ts): the session's
  volume by venue, the off-exchange share, and the off-exchange prints and blocks marked on the bars — held to a real
  recorded answer.

  Fixtures (scripts/fixtures/tape/, recorded 2026-10-31 for Fri 2026-10-30):
    spy-stock-2026-10-30-1500.csv  /stock/history/trade_quote SPY 15:00:00–15:00:19.999, exclusive=true (892 prints:
                                   the TRFs, a 13,000-share contingent (QCC, 124) print on NYSE Chicago, odd lots, ISOs)
    exchanges.csv                  ThetaData's Exchanges table (code, name), from the docs
  The expected figures were taken by an independent recount of the CSV (a separate script, not this code).
  Run:  npx tsx scripts/stock-prints-proof.ts
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OFF_EXCHANGE, DARK_MARK_NOTIONAL, stockPrintOf, venueOf } from '../src/data/printTags';
import { ingestStock, newStockTape } from '../src/data/tapeServer';
import { stockMarkers, tapeDarkLines } from '../src/components/gex/tapeMarks';
import { nyInstant } from '../shared/marketSession.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const FIX = join(import.meta.dirname, 'fixtures', 'tape');
const read = (f: string) => readFileSync(join(FIX, f), 'utf8');

/* ---- 1. the venues against the docs' table ---- */
const venues = read('exchanges.csv').trim().split('\n').slice(1).map(l => [Number(l.split(',')[0]), l.slice(l.indexOf(',') + 1)] as const);
const offByName = venues.filter(([, n]) => /Trade Reporting Facility|Alternative Display Facility/.test(n)).map(([c]) => c);
check(`off-exchange is the table's reporting facilities and the ADF: ${[...OFF_EXCHANGE].join(', ')} (${offByName.map(c => venues.find(v => v[0] === c)![1]).join('; ')})`, [...OFF_EXCHANGE].sort((a, b) => a - b).join() === offByName.sort((a, b) => a - b).join());
check('every named venue the tab shows is the code the table gives it (57 the Nasdaq TRF, 59 the NYSE TRF, 7 Arca, 68 IEX)', /NASDAQ Trade Reporting/i.test(venues.find(v => v[0] === 57)![1]) && /NYSE Trade Reporting/.test(venues.find(v => v[0] === 59)![1]) && /ARCA/.test(venues.find(v => v[0] === 7)![1]) && /Investors Exchange/.test(venues.find(v => v[0] === 68)![1]) && venueOf(57).off && !venueOf(7).off);

/* ---- 2. the prints, against the recount ---- */
const DAY = '2026-10-30';
const t = newStockTape('SPY', DAY, nyInstant(DAY, 570), nyInstant(DAY, 960));
const taken = ingestStock(t, read('spy-stock-2026-10-30-1500.csv'));
check(`891 of the 892 prints add volume (recount) — got ${taken}`, taken === 891);
check(`58,053 shares, 16,660 off-exchange (recount) — got ${t.shares.toLocaleString()}, ${t.offShares.toLocaleString()}`, t.shares === 58_053 && t.offShares === 16_660);
const v = (c: number) => t.venues.get(c)?.[1] ?? 0;
check(`by venue: Nasdaq TRF 16,210, NYSE Chicago 13,000, Nasdaq 7,960, Arca 7,082, IEX 3,923, BZX 3,781 (recount) — got ${[57, 17, 1, 7, 68, 60].map(v).join(', ')}`, v(57) === 16_210 && v(17) === 13_000 && v(1) === 7_960 && v(7) === 7_082 && v(68) === 3_923 && v(60) === 3_781);
check('the venues sum to the session\'s shares', [...t.venues.values()].reduce((a, r) => a + r[1], 0) === t.shares);

/* ---- 3. the marks ---- */
const at = (hms: string) => nyInstant(DAY, Number(hms.slice(0, 2)) * 60 + Number(hms.slice(3, 5))) + Number(hms.slice(6)) * 1000;
const qcc = t.marks.find(m => m[2] === 13_000);
check('the 13,000-share contingent print (QCC, 124) counts in the volume but is no mark: its price is a package\'s, not the market\'s', v(17) === 13_000 && !qcc && stockPrintOf([124, 255, 255, 255, 255], 17, 13_000, 752)!.block);
const big = t.marks.find(m => Math.abs(m[0] - at('15:00:12.807')) < 1 && m[2] === 2160);
check(`the 2,160-share Nasdaq TRF print at 15:00:12.807 ($1.62M) is an off-exchange mark — ${big ? `${big[2]} @ ${big[1]}, venue ${big[3]}, kind ${big[4]}, side ${big[5]}` : 'missing'}`, !!big && big[4] === 0 && big[3] === 57);
check(`every mark is an off-exchange print of $${(DARK_MARK_NOTIONAL / 1e6).toFixed(0)}M and up or a block (${t.marks.length} marks)`, t.marks.length > 0 && t.marks.every(m => (OFF_EXCHANGE.has(m[3]) && m[1] * m[2] >= DARK_MARK_NOTIONAL) || m[4] === 1 || m[4] === 2));
check('a block by its condition (75 BLOCK_TRADE) or by size; a cancel is no print', stockPrintOf([75, 255, 255, 255, 255], 3, 500, 50)!.block && stockPrintOf([0], 3, 10_000, 5)!.block && !stockPrintOf([0], 3, 9_999, 5)!.block && stockPrintOf([40], 3, 10, 5) === null);

/* ---- 4. on the chart ---- */
const bars = [nyInstant(DAY, 899), nyInstant(DAY, 900), nyInstant(DAY, 901)].map(ms => ms / 1000);
const inks = { buy: 'glacier', sell: 'ember', none: 'muted' };
const drawn = stockMarkers(t.marks, bars, 60, inks);
check(`one mark of a kind a bar, at the print's own price, the largest: ${drawn.length} drawn on the 15:00 bar`, drawn.length === 1 && Number(drawn[0].time) === bars[1] && drawn[0].position === 'atPriceMiddle' && drawn[0].shape === 'circle');
const largest = [...t.marks].sort((a, b) => b[1] * b[2] - a[1] * a[2])[0];
check(`the drawn mark is the bar's largest (${largest[2]} @ ${largest[1]}) in its side's ink`, (drawn[0] as { price?: number }).price === largest[1] && drawn[0].color === (largest[5] > 0 ? 'glacier' : largest[5] < 0 ? 'ember' : 'muted'));
check('a mark off the drawn bars is not drawn', stockMarkers(t.marks, [nyInstant(DAY, 600) / 1000], 60, inks).length === 0);
const lines = tapeDarkLines(t.marks);
check(`the overlay's lines: off-exchange only, the largest at each price (${lines.length}), largest first`, lines.length > 0 && lines.every((l, i) => i === 0 || l.notional <= lines[i - 1].notional) && lines[0].notional === Math.max(...t.marks.filter(m => m[4] !== 1).map(m => m[1] * m[2])));

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
