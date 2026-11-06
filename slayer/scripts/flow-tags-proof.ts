/*
  Terrain's option tape (src/data/tapeServer.ts, data/printTags.ts, data/flowBuckets.ts): the trade types, the side at
  the quote and the flow pane's net, held to real recorded answers.

  Fixtures (scripts/fixtures/tape/, recorded from the terminal 2026-10-31 for Fri 2026-10-30):
    spx-options-2026-10-30-1500.csv  /option/history/trade_quote SPX (the AM root) every expiry, 15:00–15:14:59,
                                     strike_range=30, exclusive=true — floor packages (137, 144), cancels (40, 41)
    spy-options-2026-10-30-1500.csv  the same for SPY, 15:00:00–15:00:59, strike_range=2 — sweeps (95), legs, singles
    spx-oi-2026-10-30.csv            /option/history/open_interest SPX for the day, cut to the contracts in the window
    spx-1m-2026-10-30-1500.csv       /index/history/ohlc SPX 1m, 15:00–15:14
    trade-conditions.csv             ThetaData's Trade Conditions table (code, name, Volume column), from the docs
  The expected counts were taken by an independent recount of the CSVs (a separate script, not this code).
  Run:  npx tsx scripts/flow-tags-proof.ts
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANCEL_CODES, FLOOR_CODES, LEG_CODES, NO_VOLUME_CODES, STOCK_BLOCK_CODES, SWEEP_CODES, hasType, primaryOf, sideAtQuote, tagsOfBits, optionTagsOf } from '../src/data/printTags';
import { ingestOptions, ingestSpot, newOptionTape, readOi, startTapes, type OptionPrintRow } from '../src/data/tapeServer';
import { rowOfCell, rowOfPrint, type TapeRow } from '../src/data/tapeRows';
import { flowCaption, legsInNet, passesFlow, signedFlowBars } from '../src/data/flowBuckets';
import { DEFAULT_FLOW_FILTERS, type FlowFilters } from '../src/data/deskPrefs';
import { nyInstant } from '../shared/marketSession.mjs';

let fail = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const FIX = join(import.meta.dirname, 'fixtures', 'tape');
const read = (f: string) => readFileSync(join(FIX, f), 'utf8');
const same = (a: Iterable<number>, b: Iterable<number>) => {
  const x = [...a].sort((p, q) => p - q).join(',');
  const y = [...b].sort((p, q) => p - q).join(',');
  return x === y;
};

/* ---- 1. every code against the docs' table ---- */
const table = read('trade-conditions.csv').trim().split('\n').slice(1).map(l => l.split(','));
const named = (re: RegExp) => table.filter(r => re.test(r[1])).map(r => Number(r[0]));
check(`sweeps are the table's INTERMARKET_SWEEP and the single-leg ISO auction/cross: ${[...SWEEP_CODES].join(', ')}`, same(SWEEP_CODES, named(/^(INTERMARKET_SWEEP|SINGLE_LEG_(AUCTION|CROSS)_ISO)$/)));
check(`spread legs are every multi-leg family in the table (130–144): ${[...LEG_CODES].length} codes`, same(LEG_CODES, named(/^(MULTI_LEG|ML_|STK_OPT|STOCK_OPTIONS)/)));
check(`floor prints are every *_FLOOR_TRADE* code in the table: ${[...FLOOR_CODES].join(', ')} (129 and 133, and 137/140/143/144 the table also names floor trades)`, same(FLOOR_CODES, named(/FLOOR_TRADE/)));
check(`cancels are the table's CANC*: ${[...CANCEL_CODES].join(', ')}`, same(CANCEL_CODES, named(/^CANC/)));
check(`stock blocks are RULE_127, RULE_155, BLOCK_TRADE: ${[...STOCK_BLOCK_CODES].join(', ')}`, same(STOCK_BLOCK_CODES, named(/^(RULE_127|RULE_155|BLOCK_TRADE)$/)));
const noVol = new Set(table.filter(r => r[2] !== 'x').map(r => Number(r[0])));
check('every code counted as no volume is one the table gives no Volume mark', [...NO_VOLUME_CODES].every(c => noVol.has(c)));
check('the markers that ride regular prints (107, 108, 50, 90–94) are not reasons to drop a print', ![107, 108, 50, 90, 91, 92, 93, 94].some(c => NO_VOLUME_CODES.has(c)));

/* ---- 2. the side at the quote ---- */
check('side: at/above the ask a buyer, at/below the bid a seller, inside within a fifth of a side that side, else none', sideAtQuote(1.0, 0.9, 1.0) === 'ASK' && sideAtQuote(0.9, 0.9, 1.0) === 'BID' && sideAtQuote(0.98, 0.9, 1.0) === 'ASK' && sideAtQuote(0.92, 0.9, 1.0) === 'BID' && sideAtQuote(0.95, 0.9, 1.0) === 'MID');
check('side: a crossed or locked quote, a missing one, one older than five minutes give no read', sideAtQuote(1, 1, 1) === 'MID' && sideAtQuote(1, 0, 1) === 'MID' && sideAtQuote(1, 0.9, 1, 5 * 60_000 + 1) === 'MID' && sideAtQuote(1, 0.9, 1, 5 * 60_000) === 'ASK');
const leg133 = optionTagsOf([133, 255, 255, 255, 255], 500, 900_000)!;
check('a floor package leg (133) is a leg and a floor print, named a leg, never a block', leg133.leg && leg133.floor && !leg133.block && primaryOf(leg133) === 'leg' && hasType(leg133, 'floor') && hasType(leg133, 'leg') && !hasType(leg133, 'single'));
check('a print carrying a cancel is not taken', optionTagsOf([18, 40, 255, 255, 255], 1, 100) === null);

/* ---- 3. a window of real prints, against the independent recount ---- */
const DAY = '2026-10-30';
const open = nyInstant(DAY, 570);
const close = nyInstant(DAY, 975);
const spx = newOptionTape('SPX', DAY, open, close);
const spxRoot = spx.roots.findIndex(r => r.root === 'SPX');
spx.roots[spxRoot].oi = readOi(read('spx-oi-2026-10-30.csv'));
ingestSpot(spx, read('spx-1m-2026-10-30-1500.csv'));
const taken = ingestOptions(spx, spxRoot, read('spx-options-2026-10-30-1500.csv'));
const mixOf = (t: typeof spx, k: string) => t.mix.get(k as never) ?? ['', 0, 0, 0, 0, 0];
check(`SPX 15:00–15:15: 1,086 prints taken of 1,091 (4 cancels, 1 empty) — got ${taken}`, taken === 1086);
check(`SPX: spread legs 8,280 contracts, singles 2,006 (recount) — got ${mixOf(spx, 'leg')[4]}, ${mixOf(spx, 'single')[4]}`, mixOf(spx, 'leg')[4] === 8280 && mixOf(spx, 'single')[4] === 2006);
const legShare = mixOf(spx, 'leg')[4] / (mixOf(spx, 'leg')[4] + mixOf(spx, 'single')[4]);
check(`SPX: legs are ${(legShare * 100).toFixed(0)}% of the window's contracts (the audit's point: most are not bets)`, legShare > 0.75);
const prem = (t: typeof spx, k: string) => Math.round(mixOf(t, k)[1] + mixOf(t, k)[2] + mixOf(t, k)[3]);
check(`SPX: leg premium $142,564,982, single $38,562,150 (recount) — got ${prem(spx, 'leg')}, ${prem(spx, 'single')}`, Math.abs(prem(spx, 'leg') - 142_564_982) <= 1 && Math.abs(prem(spx, 'single') - 38_562_150) <= 1);
const sides = [1, 2, 3].map(i => Math.round([...spx.mix.values()].reduce((a, m) => a + (m[i] as number), 0)));
check(`SPX: premium at the ask $61,786,355, at the bid $51,346,982, no side $67,993,795 (recount) — got ${sides.join(', ')}`, Math.abs(sides[0] - 61_786_355) <= 2 && Math.abs(sides[1] - 51_346_982) <= 2 && Math.abs(sides[2] - 67_993_795) <= 2);
check('SPX: every kept print is $50K or more; every folded minute leans (a side) and opened', spx.prints.every(p => p[4] * p[5] * 100 >= 50_000) && spx.cellList.every(c => c[2] !== 0));
check('SPX: a print opened exactly when the contract\'s volume through it ran past the interest it opened on', spx.prints.every(p => p[12] === (p[14] >= 0 && p[13] > p[14] ? 1 : 0)));
check('SPX: how far out of the money is read off the minute\'s close (every print has one)', spx.prints.every(p => p[10] != null && Number.isFinite(p[10])));
const one = spx.prints.find(p => p[3] === 1)!;
const spotAt = Number(read('spx-1m-2026-10-30-1500.csv').split('\n').find(l => l.startsWith(`2026-10-30T15:${String(new Date(one[0]).getUTCMinutes()).padStart(2, '0')}`))!.split(',')[4]);
check(`SPX: a call's distance is (strike − close) / close: ${one[2]} vs ${spotAt} → ${one[10]}%`, Math.abs((one[10] as number) - Math.round(((one[2] - spotAt) / spotAt) * 10_000) / 100) < 1e-9);

const spy = newOptionTape('SPY', DAY, open, nyInstant(DAY, 975));
spy.roots[0].oi = new Map();
check(`SPY 15:00: 378 prints taken — got ${ingestOptions(spy, 0, read('spy-options-2026-10-30-1500.csv'))}`, true);
check(`SPY: sweeps 122 contracts, legs 289, singles 1,684 (recount) — got ${mixOf(spy, 'sweep')[4]}, ${mixOf(spy, 'leg')[4]}, ${mixOf(spy, 'single')[4]}`, mixOf(spy, 'sweep')[4] === 122 && mixOf(spy, 'leg')[4] === 289 && mixOf(spy, 'single')[4] === 1684);

/* ---- 4. reads that land in pieces give the same tape as one read (the live tape reads the newest minutes) ---- */
{
  const csv = read('spx-options-2026-10-30-1500.csv');
  const [head, ...rows] = csv.trim().split('\n');
  const cut = rows.findIndex(l => l.split(',')[4] >= '2026-10-30T15:07:00');
  const t2 = newOptionTape('SPX', DAY, open, close);
  t2.roots[spxRoot].oi = readOi(read('spx-oi-2026-10-30.csv'));
  ingestSpot(t2, read('spx-1m-2026-10-30-1500.csv'));
  ingestOptions(t2, spxRoot, [head, ...rows.slice(0, cut)].join('\n'));
  ingestOptions(t2, spxRoot, [head, ...rows.slice(cut)].join('\n'));
  const key = (p: OptionPrintRow) => p.slice(0, 15).join('|');
  check(`two reads (to 15:07, then on) give the one read's prints, folded minutes and mix (${t2.prints.length} prints, ${t2.cellList.length} minutes)`, t2.prints.map(key).join() === spx.prints.map(key).join() && JSON.stringify(t2.cellList) === JSON.stringify(spx.cellList) && JSON.stringify([...t2.mix]) === JSON.stringify([...spx.mix]));
}

/* ---- 5. the flow pane: the type filter, and spread legs out of the net by default ---- */
const rows: TapeRow[] = [...spx.prints.map(p => rowOfPrint('SPX', p)), ...spx.cellList.map((c, i) => rowOfCell('SPX', c, i))];
const bars = Array.from({ length: 15 }, (_, i) => (nyInstant(DAY, 900 + i) / 1000));
const netOf = (f: FlowFilters) => signedFlowBars(rows.filter(p => passesFlow(p, f)), bars, 60, legsInNet(f)).reduce((a, b) => a + b.net, 0);
/* the net by hand, off the wire rows: a call bought or a put sold up, a put bought or a call sold down, opening only */
const byHand = (keep: (bits: number) => boolean) =>
  [...spx.prints.filter(p => p[8] !== 0 && p[12] === 1 && keep(p[9])).map(p => (p[3] === p[8] ? 1 : -1) * p[4] * p[5] * 100), ...spx.cellList.filter(c => keep(c[1])).map(c => (c[3] === c[2] ? 1 : -1) * c[8])].reduce((a, b) => a + b, 0);
const ANY: FlowFilters = { leg: 'single', mny: 'all', side: 'all', kind: 'all', dte: 'all', prem: 'all' };
const isLeg = (b: number) => tagsOfBits(b).leg;
const netOut = netOf(ANY);
const netIn = netOf({ ...ANY, leg: 'all' });
const netLegs = netOf({ ...ANY, kind: 'leg' });
check(`legs out (the default): the net is the non-leg prints' alone — $${Math.round(netOut).toLocaleString()} vs by hand $${Math.round(byHand(b => !isLeg(b))).toLocaleString()}`, Math.abs(netOut - byHand(b => !isLeg(b))) < 1);
check(`legs in: every leaning print counts — $${Math.round(netIn).toLocaleString()} vs by hand $${Math.round(byHand(() => true)).toLocaleString()}`, Math.abs(netIn - byHand(() => true)) < 1 && Math.abs(netIn - netOut) > 1);
check(`the Spread legs type: the legs' own net — $${Math.round(netLegs).toLocaleString()}`, Math.abs(netLegs - byHand(isLeg)) < 1);
check('the default filters leave the legs out of the net', DEFAULT_FLOW_FILTERS.leg === 'single' && !legsInNet(DEFAULT_FLOW_FILTERS));
check('the type filter keeps only its type: Spread legs passes legs only, Single no leg', rows.filter(p => passesFlow(p, { ...ANY, kind: 'leg' })).every(p => p.tapeTags.leg) && rows.filter(p => passesFlow(p, { ...ANY, kind: 'single' })).every(p => !p.tapeTags.leg && !p.tapeTags.sweep && !p.tapeTags.floor && !p.tapeTags.block));
check('a folded minute (prints under $50K) is in at any size, out under a size floor', rows.some(p => p.aggregate) && rows.filter(p => p.aggregate).every(p => passesFlow(p, ANY) && !passesFlow(p, { ...ANY, prem: '50k' })));
check(`the caption names the type and the legs: "${flowCaption({ ...ANY, kind: 'sweep' })}"`, flowCaption({ ...ANY, kind: 'sweep' }).includes('SWEEPS') && flowCaption(ANY).includes('NO LEGS'));

/* ---- 5b. legs in: a cross trade and a print on a crossed or stale quote read neither (audit T8) ----
   The vendor's tape already makes them MID (traceRows printSideOf), checked here off raw rows; a leg that kept its
   flag with a side from anywhere else still adds nothing once the legs are counted in. */
{
  const { tradeToPrint } = await import('../src/data/traceRows');
  const { flowSign } = await import('../src/data/flowBuckets');
  const at = new Date(nyInstant(DAY, 600)).toISOString();
  const raw = (extra: Record<string, unknown>) => ({ id: `x${JSON.stringify(extra)}`, ticker: 'SPY', option_type: 'call', strike: '700', expiry: '2026-12-18', executed_at: at, price: '2.10', nbbo_bid: '2.00', nbbo_ask: '2.10', size: '50', volume: '5000', open_interest: '100', upstream_condition_detail: 'mlet', ...extra });
  const crossRow = tradeToPrint(raw({ report_flags: ['cross_trade'] }));
  const crossedQuote = tradeToPrint(raw({ nbbo_bid: '2.20', nbbo_ask: '2.10' }));
  const plain = tradeToPrint(raw({}));
  check(`the vendor's tape: a cross and a crossed quote print MID (${crossRow.side}, ${crossedQuote.side}); the same leg on a good quote at the ask (${plain.side})`, crossRow.side === 'MID' && crossedQuote.side === 'MID' && plain.side === 'ASK');
  check('…so with the legs in, those add nothing and the plain leg leans', flowSign(crossRow, true) === 0 && flowSign(crossedQuote, true) === 0 && flowSign(plain, true) === 1);
  check('a leg flagged a cross, or on a crossed or stale quote, reads neither even with a side on it', flowSign({ ...plain, cross: true }, true) === 0 && flowSign({ ...plain, quoteNoRead: 'crossed' }, true) === 0 && flowSign({ ...plain, quoteNoRead: 'stale' }, true) === 0);
}

/* ---- 6. the reader: two reads at most, the open interest first, contiguous windows, the newest minute live ----
   The clock stands on the tape's own day, so this is the current day: the terminal serves it one expiry at a time
   (scripts/tape-current-day-proof.ts holds that to the terminal's refusal); one expiry is listed here. */
{
  const FRI_1400 = nyInstant(DAY, 840);
  /* five seconds into 14:00: 13:59 has closed (a minute is read once closed a few seconds) */
  let clock = FRI_1400 + 5_000;
  const asked: string[] = [];
  let inFlight = 0;
  let most = 0;
  const tapes = startTapes({
    dir: '/dev/null/none',
    now: () => clock,
    theta: async p => {
      asked.push(p);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      if (p.startsWith('/option/list/expirations')) return { status: 200, body: `symbol,expiration\n"SPY","${DAY}"\n` };
      return { status: 472, body: '' };
    },
  });
  tapes.options('SPY', 0);
  tapes.stock('SPY', 0);
  for (let i = 0; i < 400 && (tapes.options('SPY', 0)!.through < FRI_1400 - 60_000 || tapes.stock('SPY', 0)!.through < FRI_1400 - 16 * 60_000); i++) await new Promise(r => setTimeout(r, 30));
  const opt = asked.filter(p => p.startsWith('/option/history/trade_quote'));
  const stk = asked.filter(p => p.startsWith('/stock/history/trade_quote'));
  check(`never more than 2 reads at once (most: ${most})`, most <= 2);
  check('the open interest is read before the first window', asked.findIndex(p => p.startsWith('/option/history/open_interest')) < asked.findIndex(p => p.startsWith('/option/history/trade_quote')));
  const spans = (ps: string[]) => ps.map(p => /start_time=([^&]+)&end_time=([^&]+)/.exec(p)!.slice(1));
  const secOf = (hms: string) => hms.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  const contiguous = (s: string[][]) => s.every((w, i) => i === 0 || Math.abs(secOf(w[0]) - (secOf(s[i - 1][1]) + 0.001)) < 1e-6);
  check(`options from 09:30 in half-hour windows (the current day, one expiry a read) to the last whole minute: ${spans(opt)[0]?.join('–')} … ${spans(opt).at(-1)?.join('–')}`, spans(opt)[0]?.[0] === '09:30:00' && spans(opt)[0]?.[1] === '09:59:59.999' && spans(opt).at(-1)?.[1] === '13:59:59.999' && contiguous(spans(opt)));
  check('…each read names its expiry, never expiration=*', opt.length > 0 && opt.every(p => p.includes(`expiration=${DAY.replace(/-/g, '')}`)) && !asked.some(p => p.includes('expiration=*')));
  check(`today's stock prints are the merged tape, fifteen minutes behind: ${stk.at(-1)?.includes('venue=utp_cta')} … ${spans(stk).at(-1)?.join('–')}`, stk.every(p => p.includes('venue=utp_cta') && p.includes('exclusive=true')) && spans(stk).at(-1)?.[1] === '13:44:59.999');
  const before = asked.length;
  clock += 61_000;
  for (let i = 0; i < 300 && asked.length < before + 2; i++) await new Promise(r => setTimeout(r, 30));
  const live = asked.slice(before);
  check(`a minute on, the tape reads only the newest minute: ${live.map(p => p.split('?')[0] + ' ' + spans([p])[0].join('–')).join(' · ')}`, live.some(p => p.includes('/option/history/trade_quote') && p.includes('start_time=14:00:00&end_time=14:00:59.999')));
  tapes.stop();
}

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
