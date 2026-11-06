/*
  The Terrain against recorded answers. Two sets:
  - terrain-2026-10-29 (Unusual Whales, recorded here): the walls, flip and supreme a Terrain pane plots must be the
    house levels (data/levelsFor.ts) for SPY's Today cut, and those must match the raw spot-exposure rows; the chart's
    bar folding (one-minute bars into 5 and 30 minutes and into the day) is checked on SPY's real one-minute bars.
  - terrain-theta-2026-10-29 (ThetaData, recorded on a machine whose terminal answers): the same folding on ThetaData's
    own bars, read through data/thetaTape.ts. Skipped, and said so, until that set exists.
  - terrain-2026-10-29-open (Unusual Whales, recorded in the session): two answers of SPY's Oct 29 rows a poll apart and
    the vendor's max pain — the exposure field's open-interest and today's-flow cells across a bar, read by hand off them.
  The exposure field's cells, the cut's net, the forward cone and the levels' words at the edge are checked by hand too.

  Replay: npx tsx scripts/golden/terrain-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/terrain-golden.ts   (the Theta set records only when the terminal answers)
*/
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt, settleOn } from './uwFixtures';
import { byStrike, contractOi, contractVols, levelsOfRows, pricedFlip, pricedLegs, rawAnswers } from './pinpointRaw';

const SET = 'terrain-2026-10-29';
const THETA_SET = 'terrain-theta-2026-10-29';
const RECORD = process.env.GOLDEN_RECORD === '1';

/* the browser bits the loader touches, on the Terrain's own route (ThetaData is its source, not a UW-only desk) */
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/terrain', href: 'http://127.0.0.1/terrain', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const fx = installUwFixtures(SET);
const { asked } = fx;
freezeClock(recordedAt(SET, new Date().toISOString()));

const book = await import('../../src/data/uwBook');
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();

/* settled: nothing in flight and nothing new asked for a count of event-loop turns (uwFixtures settleOn), not a
   stretch of quiet wall-clock time */
const settle = (ok: () => boolean) => settleOn(fx, ok, 'SPY');

book.ensureBook('SPY', 'board');
await settle(() => book.peekEntry('SPY')?.status === 'live');
/* the bars the chart folds, asked the way the book asks them */
await (await import('../../src/data/whales')).whalesBars('SPY', '1m', 2500);

const { levelsFor } = await import('../../src/data/levelsFor');
const { paneLevels } = await import('../../src/pages/terrain/paneLevels');
const raw = rawAnswers(SET);

/* ---- 1. the plotted levels are the house's, and the house's are the raw rows' ---- */
/* Hand values, read off spot-exposures/expiry-strike for 2026-10-29: the strike with the most call_gamma_oi (775), the
   most put_gamma_oi (758), the most |call + put| (758); the flip re-priced independently below. They equal
   pinpoint-golden's SPY Today read of the same Oct 28 close. */
const GOLD = { front: '2026-10-29', call: 775, put: 758, supreme: 758, flip: 771.1081929770314 };
const house = levelsFor('SPY', '0DTE')!;
const spot = book.peekSpot('SPY')!;
const plotted = paneLevels(spot, house);
expectEqual('SPY Today reads the front expiry', house.date, GOLD.front);
expectEqual('pane plots the house call wall · put wall · supreme', [plotted.callWall, plotted.putWall, plotted.supreme], [house.callWall, house.putWall, house.supreme]);
expectNear('pane plots the house flip', plotted.flip, house.flip ?? NaN, 1e-12);
expectEqual('house levels, SPY Today', [house.callWall, house.putWall, house.supreme], [GOLD.call, GOLD.put, GOLD.supreme]);
expectNear('house flip, SPY Today', house.flip ?? NaN, GOLD.flip, 1e-9);
const rows: Record<string, string | number | null>[] = [];
const seen = new Set<string>();
for (const [p, d] of raw) {
  if (!p.startsWith('/stock/SPY/spot-exposures/expiry-strike') || !Array.isArray(d)) continue;
  for (const r of d as Record<string, string | number | null>[]) {
    const k = `${r.expiry}|${r.strike}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }
}
const dates = new Set([GOLD.front]);
const hand = levelsOfRows(byStrike(rows, dates));
expectEqual('raw rows name the same walls and supreme', [hand.callWall, hand.putWall, hand.supreme], [GOLD.call, GOLD.put, GOLD.supreme]);
/* the rows (and the close's quotes) are marked at the vendor's price, the close; before the open the page's spot is the
   pre-market print — the rows are re-priced from their own price, the search runs from spot */
const marked = Number([...rows].filter(r => r.expiry === GOLD.front).sort((a, b) => String(b.time).localeCompare(String(a.time)))[0].price);
expectEqual(`before the open the house prices at the pre-market print (${spot}), not the rows' close (${marked})`, [spot, marked], [770.115, 772.31]);
const rf = pricedFlip(pricedLegs(rows, dates, contractVols(raw, 'SPY', marked, '2026-10-28'), contractOi(raw, 'SPY')), spot);
expectNear(`an independent re-pricing of the rows puts the flip at ${rf?.toFixed(2)}`, rf ?? NaN, GOLD.flip, (0.0002 * spot) / GOLD.flip);
const none = paneLevels(spot, null);
expectEqual('no house reading, nothing plotted', [none.callWall, none.putWall, none.flip, none.supreme].map(Number.isNaN), [true, true, true, true]);

/* ---- 2. the chart's folding, on SPY's real one-minute bars ---- */
const { aggregateCandles } = await import('../../src/data/timeframe');
const { dayClose, foldTo, readOhlc } = await import('../../src/data/thetaTape');
const { nyWallStamp } = await import('../../src/core/nyTime');
const uwBars = (raw.get('/stock/SPY/ohlc/1m?limit=2500') as Record<string, string>[]).filter(b => b.market_time === 'r');
/* the vendor's minutes in ThetaData's row shape (New York wall time), so the same reader the terminal's rows go through reads them */
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const wall = (ms: number) => {
  const p = Object.fromEntries(ny.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000`;
};
const thetaRows = uwBars.map(b => ({ timestamp: wall(Date.parse(b.start_time)), open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) }));
const minutes = readOhlc({ response: thetaRows }.response, 'rth');
expectEqual('every regular-session minute is read once', minutes.length, new Set(thetaRows.map(r => r.timestamp)).size);
expectEqual('the first minute sits at its own start', minutes[0].time, Math.min(...thetaRows.map(r => nyWallStamp(r.timestamp) / 1000)));

/* one 30-minute bucket by hand: the Oct 28 10:00–10:29 minutes */
const t1000 = nyWallStamp('2026-10-28T10:00:00') / 1000;
const inBucket = minutes.filter(m => m.time >= t1000 && m.time < t1000 + 1800);
const f30 = aggregateCandles(minutes, 30).find(b => b.time === t1000)!;
expectEqual('30-minute bucket at 10:00 holds 30 minutes', inBucket.length, 30);
expectNear('30m open = the 10:00 minute open', f30.open, inBucket[0].open, 1e-12);
expectNear('30m close = the 10:29 minute close', f30.close, inBucket[29].close, 1e-12);
expectNear('30m high = the highest of the 30', f30.high, Math.max(...inBucket.map(m => m.high)), 1e-12);
expectNear('30m low = the lowest of the 30', f30.low, Math.min(...inBucket.map(m => m.low)), 1e-12);
expectNear('30m volume = the sum of the 30', f30.volume, inBucket.reduce((a, m) => a + m.volume, 0), 1e-9);
const f5 = aggregateCandles(minutes, 5).find(b => b.time === t1000 + 1500)!;
expectNear('5m 10:25 close = the 10:29 minute close', f5.close, inBucket[29].close, 1e-12);

/* the day: Oct 28's regular session folded into one bar at 16:00 New York */
const day = foldTo(minutes, dayClose).find(b => b.time === nyWallStamp('2026-10-28T16:00:00') / 1000)!;
const oct28 = minutes.filter(m => m.time >= nyWallStamp('2026-10-28T09:30:00') / 1000 && m.time < nyWallStamp('2026-10-28T16:00:00') / 1000);
expectNear('day open = the 9:30 minute open', day.open, oct28[0].open, 1e-12);
expectNear('day close = the 15:59 minute close', day.close, oct28[oct28.length - 1].close, 1e-12);
expectNear('day high', day.high, Math.max(...oct28.map(m => m.high)), 1e-12);
expectNear('day low', day.low, Math.min(...oct28.map(m => m.low)), 1e-12);
/* Pinned, read by hand off the recorded minutes; the vendor's own Oct 28 daily row ('r') is O 771.43 H 773.36 L 769.24
   C 772.31 — the same open and close, and a high and low a cent wider than any minute bar printed. */
expectEqual('Oct 28 day bar, pinned', [day.open, day.high, day.low, day.close], [771.43, 773.35, 769.25, 772.31]);
expectEqual('Oct 28 10:00 half-hour, pinned', [f30.open, f30.high, f30.low, f30.close], [770.57, 771.1, 770.1334, 770.74]);
const daily = (raw.get('/stock/SPY/ohlc/1d?limit=18') as Record<string, string>[]).find(r => r.date === '2026-10-28' && r.market_time === 'r')!;
expectEqual('the vendor daily row has the same open and close', [Number(daily.open), Number(daily.close)], [day.open, day.close]);
console.log(`  (Oct 28 SPY by hand: ${oct28.length} minutes, O ${oct28[0].open} H ${Math.max(...oct28.map(m => m.high))} L ${Math.min(...oct28.map(m => m.low))} C ${oct28[oct28.length - 1].close}; 10:00 30m O ${f30.open} H ${f30.high} L ${f30.low} C ${f30.close})`);

/* ---- 4. the exposure field, read off the raw spot-exposure rows ---- */
/* Hand values: summed off spot-exposures/expiry-strike?expirations[]=2026-10-29 (the Oct 28 close rows, time 20:15Z) in
   Python — open interest = call_gamma_oi + put_gamma_oi. Dealer flow is that plus the ask and the bid legs
   (call_gamma_ask + call_gamma_bid + put_gamma_ask + put_gamma_bid). Both are the level, dealer sign. */
const field = await import('../../src/data/book/exposureLog');
const FIELD_HAND = {
  oi: { 770: -17915246.21, 772: 31039557.69, 775: 70661411.04 },
  flow: { 770: 103813347.17, 772: -196802710.63, 775: 104436290.75 },
  netOi: 107689622.85,
  netFlow: 301473059.71,
};
const closeAt = Date.parse('2026-10-28T21:00:00Z');
const dayBar = [Date.parse('2026-10-28T20:00:00Z') / 1000];
const oiGrid = field.exposureGrid('SPY', GOLD.front, dayBar, 86_400, 'oi', closeAt)!;
const flowGrid = field.exposureGrid('SPY', GOLD.front, dayBar, 86_400, 'flow', closeAt)!;
const cellOf = (g: typeof oiGrid, k: number, c = 0) => g.values[c * g.strikes.length + g.strikes.indexOf(k)];
for (const k of [770, 772, 775] as const) {
  expectNear(`field, open interest, SPY ${k} Oct 29 = the row's call + put gamma_oi`, cellOf(oiGrid, k), FIELD_HAND.oi[k], 1e-9);
  expectNear(`field, dealer flow, SPY ${k} Oct 29 = open interest plus the ask and bid legs`, cellOf(flowGrid, k), FIELD_HAND.flow[k], 1e-9);
}
const cols = field.gridColumns(oiGrid);
expectNear('a column keeps the house sign: 775 kept = −dealer', cols[0].levels.find(l => l.strike === 775)!.value, -FIELD_HAND.oi[775], 1e-12);
/* every expiry reads the vendor's whole-book rows (spot-exposures/strike, page 0): 775 there is call_gamma_oi + put_gamma_oi
   = 1,146,019,346.43 − 551,841,102.16, and its ask + bid legs −4,283,500,218.57 + 3,948,235,193.07 − 577,005,844.71
   + 499,213,720.89 */
const bookOi = field.exposureGrid('SPY', 'book', dayBar, 86_400, 'oi', closeAt)!;
const bookFlow = field.exposureGrid('SPY', 'book', dayBar, 86_400, 'flow', closeAt)!;
expectNear('every expiry, open interest, SPY 775 = the whole-book row', cellOf(bookOi, 775), 594178244.27, 1e-9);
expectNear("every expiry, dealer flow, SPY 775 = the whole-book open interest plus its ask and bid legs", cellOf(bookFlow, 775), 181121094.95, 1e-9);
const netNow = field.exposureNet('SPY', GOLD.front)!;
expectNear("the cut's net, open interest = the house net GEX Pinpoint prints for SPY Today", netNow.oi, house.netGex, 1e-12);
expectNear('… and the raw rows summed by hand', netNow.oi, FIELD_HAND.netOi, 1e-9);
expectNear("the cut's net, dealer flow, summed by hand", netNow.flow, FIELD_HAND.netFlow, 1e-9);

/* ---- 5. two real polls an answer apart, recorded in the session (terrain-2026-10-29-open) ---- */
const OPEN_SET = 'terrain-2026-10-29-open';
const openDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', OPEN_SET);
if (!(existsSync(openDir) && readdirSync(openDir).some(f => f.endsWith('.json.gz'))) && !RECORD) {
  console.log(`SKIP  ${OPEN_SET} is not recorded: run GOLDEN_RECORD=1 npx tsx scripts/golden/terrain-golden.ts in the session`);
} else {
  installUwFixtures(OPEN_SET);
  /* the same rows asked twice, a poll apart (the second carries page=0 so each answer has its own recording); asked
     straight, past the app's own answer cache, which still holds the closing set's copy of the first path */
  const ask = async (path: string) => ((await (await fetch(`/api/uw${path}`)).json()) as { data: Record<string, string>[] }).data;
  const rowsA = await ask('/stock/SPY/spot-exposures/expiry-strike?expirations[]=2026-10-29&limit=500');
  if (RECORD) await new Promise(r => setTimeout(r, 70_000));
  const rowsB = await ask('/stock/SPY/spot-exposures/expiry-strike?expirations[]=2026-10-29&limit=500&page=0');
  const answered = (rows: Record<string, string>[]) => Math.max(...rows.map(r => Date.parse(r.time)));
  const tA = answered(rowsA);
  const tB = answered(rowsB);
  field.resetExposureLog('SPY');
  field.noteExposureRows('SPY', rowsA);
  field.noteExposureRows('SPY', rowsB);
  /* one bar from poll A's answer to just past poll B's: both books are B's level, not B − A */
  const a = Math.ceil(tA / 1000);
  const span = Math.ceil((tB - tA) / 1000) + 1;
  const now = tB + 5_000;
  const og = field.exposureGrid('SPY', '2026-10-29', [a], span, 'oi', now)!;
  const fg = field.exposureGrid('SPY', '2026-10-29', [a], span, 'flow', now)!;
  const lastOf = (rows: Record<string, string>[], strike: number, book: 'oi' | 'flow') => {
    let best = -1;
    let v = NaN;
    for (const r of rows) {
      if (Number(r.strike) !== strike) continue;
      const t = Date.parse(r.time);
      if (t >= best) {
        best = t;
        const m = field.rowMeasures(r);
        v = book === 'oi' ? m.oi : m.flow;
      }
    }
    return v;
  };
  /* read off the recorded max-pain answer's 2026-10-29 row: max_pain "770" */
  const OPEN_HAND = {
    tA: Date.parse('2026-10-29T15:57:22.000Z'),
    tB: Date.parse('2026-10-29T15:58:32.793Z'),
    oiB: { 770: -445796038.47, 775: 144895773.02 },
  };
  /* read off the recorded max-pain answer's 2026-10-29 row: max_pain "770" */
  const OPEN_HAND_PAIN = 770;
  expectEqual('the two polls were answered at', [new Date(tA).toISOString(), new Date(tB).toISOString()], [new Date(OPEN_HAND.tA).toISOString(), new Date(OPEN_HAND.tB).toISOString()]);
  for (const k of [770, 775] as const) {
    expectNear(`open interest across the bar, SPY ${k}: the last reading (poll B)`, cellOf(og, k), OPEN_HAND.oiB[k], 1e-9);
    expectNear(`dealer flow across the bar, SPY ${k}: poll B's level, not the change`, cellOf(fg, k), lastOf(rowsB, k, 'flow'), 1e-6);
  }
  const gap = field.exposureGrid('SPY', '2026-10-29', [Math.ceil((tB + field.JOIN_MS) / 1000)], 60, 'oi', tB + 20 * 60_000)!;
  expectNear('a later bar in the same session keeps the last reading', cellOf(gap, 770), OPEN_HAND.oiB[770], 1e-9);
  const nextDay = Math.floor(Date.parse('2026-10-30T14:30:00Z') / 1000);
  const next = field.exposureGrid('SPY', '2026-10-29', [nextDay], 60, 'oi', nextDay * 1000 + 60_000);
  expectEqual('the next session does not inherit the level', next ? next.values.every(Number.isNaN) : true, true);
  const before = field.exposureGrid('SPY', '2026-10-29', [Math.floor(tA / 1000) - 3 * 3600], 60, 'oi', now);
  expectEqual('nothing before the first reading', before ? before.values.every(Number.isNaN) : true, true);
  /* The server's recorder (data/exposureRecorder.ts) read poll A; this page opened later and read poll B itself. The
     recorded series merged into the page's log draw the same cells, by the same hand values, as reading both here. */
  const rec = await import('../../src/data/exposureRecorder');
  const served = new rec.DaySeries();
  expectEqual("the recorder keeps poll A's answer", served.add(rec.lineOf(rowsA, '2026-10-29', 0, tA + 1_000)!), true);
  field.resetExposureLog('SPY');
  expectEqual('the recorded series merge into an empty log', field.mergeExposureSeries('SPY', served.out()), true);
  field.noteExposureRows('SPY', rowsB);
  const ogM = field.exposureGrid('SPY', '2026-10-29', [a], span, 'oi', now)!;
  const fgM = field.exposureGrid('SPY', '2026-10-29', [a], span, 'flow', now)!;
  for (const k of [770, 775] as const) {
    expectNear(`recorded poll A + this page's poll B, open interest SPY ${k}: poll B`, cellOf(ogM, k), OPEN_HAND.oiB[k], 1e-9);
    expectNear(`recorded poll A + this page's poll B, dealer flow SPY ${k}: poll B's level`, cellOf(fgM, k), lastOf(rowsB, k, 'flow'), 1e-6);
  }
  /* merging the same record again, or the page's own copy of poll A on top, changes nothing */
  expectEqual('the record merged twice adds nothing', field.mergeExposureSeries('SPY', served.out()), false);
  const revBefore = field.exposureLogRev('SPY');
  field.noteExposureRows('SPY', rowsA);
  expectEqual("the page's own read of a recorded answer adds nothing", field.exposureLogRev('SPY'), revBefore);
  const { ensureMaxPain, maxPainFor } = await import('../../src/components/gex/levelExtras');
  await ensureMaxPain('SPY');
  expectEqual("max pain, SPY Oct 29: the vendor's own row", maxPainFor('SPY', '2026-10-29'), OPEN_HAND_PAIN);
}

/* ---- 6. the cone by hand ---- */
/* σ_move = S × IV_trade × √(sessions/252), IV_trade the quoted (calendar) vol at the same variance; from the Oct 28 close to
   the Oct 29 close that is S × IV × √(1/365). Vendor term structure for Oct 29: volatility 0.1619394046561459,
   implied_move 5.09247441828498; spot 772.31 (the Oct 28 close). */
const { forwardCone, sigmaMove } = await import('../../src/data/terrainCone');
const { vendorIvOnTradingClock } = await import('../../src/core/volClock');
const CONE_HAND = { sigmaNext: 6.546328040734399, pinpoint: 6.546328040734399, mid: { today: 2.6015889068380207, next: 6.352619861882894, move: 4.18834402202155 } };
const atClose = Date.parse('2026-10-28T20:00:00Z');
const fc = forwardCone([{ expiry: '2026-10-29', iv: 0.1619394046561459 }], 772.31, atClose, null)!;
expectNear('cone: 1σ to the Oct 29 close, S·IV·√(1/365)', fc.sigmaNext, CONE_HAND.sigmaNext, 1e-9);
expectNear('cone: the same as S × IV_trade × √(1/252)', sigmaMove(772.31, vendorIvOnTradingClock(0.1619394046561459, '2026-10-29', atClose), 390), fc.sigmaNext, 1e-12);
expectNear('cone: the curve ends at ±1σ and ±2σ', fc.points[fc.points.length - 1].up2 - 772.31, 2 * fc.sigmaNext, 1e-9);
/* Pinpoint's 1σ for the same session is the row's own vol on the row's clock, S·σ·√(dte/365) with dte 1 (data/book/move.ts
   vendorSigma; audit 2026-11-05 — it once read the implied move as a straddle, implied × √(π/2) = 6.382, but that move is
   ~0.85 of the straddle), so the two pages print one 1σ */
const pin = 772.31 * 0.1619394046561459 * Math.sqrt(1 / 365);
expectNear("Pinpoint's 1σ for the same session: S·σ·√(1/365) off the row", pin, CONE_HAND.pinpoint, 1e-9);
expectEqual('the two 1σ agree within 3% (ThetaData-style vol against the vendor row)', Math.abs(fc.sigmaNext / pin - 1) < 0.03, true);
console.log(`  (cone vs Pinpoint, SPY Oct 29: ${fc.sigmaNext.toFixed(4)} against ${pin.toFixed(4)}, ${((fc.sigmaNext / pin - 1) * 100).toFixed(2)}%)`);
/* mid-session: 13:30 ET, 150 minutes left; today's vol 20%, the next session's 15% (round inputs, hand-priced) */
const mid = forwardCone([{ expiry: '2026-10-29', iv: 0.2 }, { expiry: '2026-10-30', iv: 0.15 }], 770, Date.parse('2026-10-29T17:30:00Z'), 768.79)!;
expectEqual('mid-session: 150 minutes to today\'s close, 540 to the next', [mid.todayMin, mid.nextMin], [150, 540]);
expectNear('mid-session: 1σ to the close = 770·0.20·√(150/525600)', mid.sigmaToday ?? NaN, CONE_HAND.mid.today, 1e-9);
expectNear('mid-session: 1σ to the next close = 770·0.15·√(1590/525600)', mid.sigmaNext, CONE_HAND.mid.next, 1e-9);
expectNear("mid-session: today's move = open × IV_trade × √(1/252)", mid.move?.sigma ?? NaN, CONE_HAND.mid.move, 1e-9);
let widening = true;
for (let i = 1; i < mid.points.length; i++) if (mid.points[i].up1 < mid.points[i - 1].up1 - 1e-9) widening = false;
expectEqual('the cone never narrows', widening, true);

/* ---- 7. the levels' words at the edge ---- */
/* Hand: the largest |call_gamma_oi + put_gamma_oi| on Oct 29 is 758's, 101,287,487.45; 775's is 70,661,411.04, so 69.76% */
/* spot is the recorded pre-market print, stock-state close 770.115 (prev_close 772.31): 775 is (775 − 770.115) ÷ 770.115
   = +0.634% away, 758 is (758 − 770.115) ÷ 770.115 = −1.573% */
const LEVEL_HAND = { callShare: 70661411.04 / 101287487.45, callWords: 'Call wall 775 · 70% of top · +0.63%', supremeWords: 'Supreme 758 · top node · −1.57%' };
const { rungLabel } = await import('../../src/components/gex/keyLevelsPrimitive');
const top = Math.max(...rows.filter(r => r.expiry === GOLD.front).map(r => Math.abs(Number(r.call_gamma_oi) + Number(r.put_gamma_oi))));
const lv = paneLevels(spot, house, { top });
expectNear('call wall size: |net 775| ÷ the largest strike on Oct 29', lv.shares?.callWall ?? NaN, LEVEL_HAND.callShare, 1e-9);
expectEqual('call wall words', rungLabel({ key: 'callWall', price: 775, ink: '#fff', share: lv.shares?.callWall }, spot), LEVEL_HAND.callWords);
expectEqual('supreme words', rungLabel({ key: 'supreme', price: 758, ink: '#fff', share: lv.shares?.supreme }, spot), LEVEL_HAND.supremeWords);

/* ---- 3. ThetaData's own bars, when that set has been recorded ---- */
const thetaDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', THETA_SET);
if (!(existsSync(thetaDir) && readdirSync(thetaDir).some(f => f.endsWith('.json.gz'))) && !RECORD) {
  console.log(`SKIP  ${THETA_SET} is not recorded: run GOLDEN_RECORD=1 npx tsx scripts/golden/terrain-golden.ts where the ThetaData terminal answers`);
} else {
  installUwFixtures(THETA_SET);
  const { thetaGet } = await import('../../src/data/thetaFeed');
  const path = '/stock/history/ohlc?symbol=SPY&start_date=20261028&end_date=20261028&interval=1m&start_time=09:30:00&end_time=15:59:59.999&format=json';
  const got = await thetaGet(path);
  if (got.error) {
    /* an outage is not kept as a recording: the set stays empty for a machine whose terminal answers */
    if (RECORD) rmSync(thetaDir, { recursive: true, force: true });
    console.log(`SKIP  ThetaData did not answer (${got.error}); ${THETA_SET} not checked`);
  }
  else {
    const bars = readOhlc(got.data, 'rth');
    expectEqual('ThetaData: 390 regular-session minutes on Oct 28', bars.length, 390);
    const d = foldTo(bars, dayClose)[0];
    expectNear('ThetaData: day open = first minute open', d.open, bars[0].open, 1e-12);
    expectNear('ThetaData: day close = last minute close', d.close, bars[bars.length - 1].close, 1e-12);
    const b30 = aggregateCandles(bars, 30);
    expectEqual('ThetaData: 13 half-hours', b30.length, 13);
  }
}

done();
