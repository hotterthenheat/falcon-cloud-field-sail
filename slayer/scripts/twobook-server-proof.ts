/*
  The flow book on the server (Model 2, docs/TWO_BOOK.md): the option tape's own ingest classifies every print per §4.1
  into one inventory (prints only), and flowBoardOf revalues it in SLAYER mode. Synthetic rows in the terminal's CSV
  shape (no recorded vendor data):
    1. ingestOptions → t.flow: a buy at the ask, a sell at the bid, a complex leg, a cancel of the sell, a stale quote,
       a print inside the spread, an extended-hours print; SPX's two roots keyed apart (SPXW vs SPX);
    2. flowBoardOf on synthetic quotes priced off one S and two forwards → S* recovered, the board's sign follows the
       inventory (customers bought calls → dealers short gamma → GEX < 0), unit per hour on a 0DTE book;
    3. the open-interest book's builder (model1Board): one timestamp, expired rows dropped, the four converted, an
       unavailable name.
  Run: node --import tsx scripts/twobook-server-proof.ts
*/
import { nyInstant } from '../shared/marketSession.mjs';
import { ingestOptions, newOptionTape } from '../src/data/tapeServer';
import { flowBoardOf, type FlowTapeView } from '../src/data/twobook/flowBook';
import { model1Board } from '../src/data/twobook/model1';
import { price } from '../src/engine/twobook';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/* 1. ingest */
const HEAD = 'symbol,expiration,strike,right,trade_timestamp,quote_timestamp,sequence,ext_condition1,ext_condition2,ext_condition3,ext_condition4,condition,size,exchange,price,bid_size,bid_exchange,bid,bid_condition,ask_size,ask_exchange,ask,ask_condition';
const row = (sym: string, k: number, right: string, tt: string, qt: string, seq: number, cond: number, size: number, px: number, bid: number, ask: number) =>
  `"${sym}","2026-11-02",${k.toFixed(3)},"${right}",2026-11-02T${tt},2026-11-02T${qt},${seq},255,255,255,255,${cond},${size},5,${px},10,5,${bid},50,10,5,${ask},50`;
const day = '2026-11-02';
const t = newOptionTape('SPX', day, nyInstant(day, 570), nyInstant(day, 960));
const spxw = [
  HEAD,
  row('SPXW', 7570, 'CALL', '10:00:00.100', '10:00:00.050', 1, 18, 10, 1.5, 1.4, 1.5), // BUY  −10
  row('SPXW', 7570, 'CALL', '10:00:01.100', '10:00:01.050', 2, 18, 4, 1.4, 1.4, 1.5), // SELL +4
  row('SPXW', 7570, 'CALL', '10:00:02.100', '10:00:02.050', 3, 130, 50, 1.45, 1.4, 1.5), // complex
  row('SPXW', 7570, 'CALL', '10:00:03.100', '10:00:03.050', 4, 40, 4, 1.4, 1.4, 1.5), // cancels the sell
  row('SPXW', 7570, 'CALL', '10:00:04.100', '10:00:02.050', 5, 18, 7, 1.5, 1.4, 1.5), // stale (2 s)
  row('SPXW', 7570, 'CALL', '10:00:05.100', '10:00:05.050', 6, 18, 3, 1.45, 1.4, 1.5), // MID
  row('SPXW', 7560, 'PUT', '10:00:06.100', '10:00:06.050', 7, 18, 6, 2.0, 1.9, 2.0), // BUY put −6
].join('\n');
const spx = [HEAD, row('SPX', 7570, 'CALL', '10:00:07.100', '10:00:07.050', 8, 18, 2, 3.0, 3.0, 3.2)].join('\n'); // SELL +2 on the AM root
ingestOptions(t, 0, spxw);
ingestOptions(t, 1, spx);
check(`roots read: ${t.roots.map(r => r.root).join(', ')}`, t.roots[0].root === 'SPXW' && t.roots[1].root === 'SPX');
check(`SPXW 7570 C inventory −10 (buy, sell cancelled, complex/stale/mid excluded): ${t.flow.inv.get('SPXW|2026-11-02|7570|C')}`, t.flow.inv.get('SPXW|2026-11-02|7570|C') === -10);
check(`SPXW 7560 P inventory −6: ${t.flow.inv.get('SPXW|2026-11-02|7560|P')}`, t.flow.inv.get('SPXW|2026-11-02|7560|P') === -6);
check(`SPX (AM root) keyed apart: ${t.flow.inv.get('SPX|2026-11-02|7570|C')}`, t.flow.inv.get('SPX|2026-11-02|7570|C') === 2);
check(`buckets: ${JSON.stringify(Object.fromEntries(t.flow.buckets))}`, t.flow.buckets.get('EXCLUDED_COMPLEX') === 50 && t.flow.buckets.get('EXCLUDED_STALE_QUOTE') === 7 && t.flow.buckets.get('MID') === 3 && t.flow.linked === 1);

/* 2. revalue: quotes priced off S = 7566 and carry 4% (T1 = 0DTE at 15:30, TL = 7 days) */
const S0 = 7566;
const V = nyInstant(day, 15 * 60 + 30);
const quotes = [];
for (const [exp, days] of [['2026-11-02', 0], ['2026-11-09', 7]] as const) {
  const T = (days * 1440 + 30) / 525600;
  for (let k = 7500; k <= 7640; k += 5)
    for (const right of ['C', 'P'] as const) {
      const p = price(S0, k, T, 0.15, 0.04, 0.04, right);
      quotes.push({ root: 'SPXW', expiry: exp, strike: k, right, bid: Math.max(0.05, p - 0.05), ask: Math.max(0.1, p + 0.05), ms: V });
    }
}
const view: FlowTapeView = { name: 'SPX', day, open: t.open, close: t.close, through: V, live: false, complete: false, byExpiry: false, exps: { SPXW: null, SPX: null }, inv: t.flow.inv, buckets: t.flow.buckets, prints: t.flow.prints, linked: t.flow.linked, unlinked: t.flow.unlinked, spotRef: 7565, fault: null };
const w = flowBoardOf(view, quotes, V, { r: 0.04, sofr: 3.92, day }, V);
check(`S* ${w.spot?.S.toFixed(4)} recovered within 0.05 of ${S0} (quotes rounded to their spread)`, !!w.spot && Math.abs(w.spot.S - S0) < 0.05);
check(`unit per hour on a 30-minute book: ${w.unit}`, w.unit === 'hour');
check(`customers bought: GEX ${w.totals?.GEX.toExponential(3)} < 0`, (w.totals?.GEX ?? 0) < 0);
check(`the AM root's line has no quote: priced on the flat wing or unavailable, never dropped silently (${JSON.stringify(w.counts)})`, w.counts.contracts === 3);
check(`no open interest anywhere in the board (population: ${w.population})`, !JSON.stringify(w).includes('open_interest'));

/* 3. model1Board */
const time = '2026-11-02T21:15:00.000000Z';
const r = (expiry: string, strike: number, extra: Record<string, number> = {}, tm = time) => ({ time: tm, price: '752.1', expiry, strike: String(strike), call_gamma_oi: '1000', put_gamma_oi: '-400', call_delta_oi: '5000000', put_delta_oi: '-2000000', call_vanna_oi: '17.2', put_vanna_oi: '-8.6', call_charm_oi: '36500', put_charm_oi: '-18250', ...extra });
const rows = [r('2026-11-02', 750), r('2026-11-03', 750), r('2026-11-20', 760), r('2026-11-20', 770, {}, '2026-11-02T20:00:00.000000Z')];
const contracts = [
  { option_symbol: 'SPY261103C00750000', open_interest: 100, implied_volatility: '0.2' },
  { option_symbol: 'SPY261103P00750000', open_interest: 50, implied_volatility: null },
  { option_symbol: 'SPY261103P00745000', open_interest: 50, implied_volatility: '0.22' },
  { option_symbol: 'SPY261102C00750000', open_interest: 999, implied_volatility: '0.2' },
];
const m1 = model1Board({ ticker: 'SPY', rows, pages: 1, iv30: 0.172, iv30Date: '2026-11-02', contracts });
check(`one timestamp: ${m1.rows.otherTimestamp} row of another time left out`, m1.rows.otherTimestamp === 1);
check(`expired (today after 16:00) dropped: ${m1.dropped.rows}`, m1.dropped.rows === 1 && m1.rows.used === 2);
check(`GEX = Σ(call + put gamma_oi) = ${m1.four?.GEX.value}`, m1.four?.GEX.value === 1200);
check(`DEX = Σ(call − put delta_oi)·100/S: ${m1.four?.DEX.value.toFixed(4)}`, Math.abs((m1.four?.DEX.value ?? 0) - (2 * 7_000_000 * 100) / 752.1) < 1e-6);
check(`VANNA ÷ IV30: ${m1.four?.VANNA.value.toFixed(6)}`, Math.abs((m1.four?.VANNA.value ?? 0) - (2 * 8.6) / 0.172) < 1e-9);
check(`unit per hour (a contract with under a day left): ${m1.unit}; CHARM ÷ (365·D)·100 ÷ 24`, m1.unit === 'hour' && Math.abs((m1.four?.CHARM.value ?? 0) - (2 * 18250 * 100) / (365 * 365) / 24) < 1e-9);
check(`the put without a vendor vol takes the nearest put's (flat wing): modelled share ${m1.oi.share.modeled.toFixed(3)}`, Math.abs(m1.oi.share.modeled - 50 / 200) < 1e-12);
const none = model1Board({ ticker: 'KVUE', rows: [], pages: 1, iv30: null, iv30Date: null, contracts: [] });
check(`a name with no listed rows: unavailable (${none.why})`, !none.available);

if (fail) {
  console.log(`twobook-server-proof: ${fail} FAILED`);
  process.exit(1);
}
console.log('twobook-server-proof OK: tape → inventory → SLAYER board, and the open-interest builder');
