/*
  The Terrain against recorded answers. Two sets:
  - terrain-2026-10-29 (Unusual Whales, recorded here): the walls, flip and supreme a Terrain pane plots must be the
    house levels (data/levelsFor.ts) for SPY's Today cut, and those must match the raw spot-exposure rows; the chart's
    bar folding (one-minute bars into 5 and 30 minutes and into the day) is checked on SPY's real one-minute bars.
  - terrain-theta-2026-10-29 (ThetaData, recorded on a machine whose terminal answers): the same folding on ThetaData's
    own bars, read through data/thetaTape.ts. Skipped, and said so, until that set exists.

  Replay: npx tsx scripts/golden/terrain-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/terrain-golden.ts   (the Theta set records only when the terminal answers)
*/
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';
import { byStrike, contractOi, contractVols, levelsOfRows, rawAnswers, rawFlip, rawLegs } from './pinpointRaw';

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

const { asked } = installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));

const book = await import('../../src/data/uwBook');
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();

const settle = async (ok: () => boolean, ms = 600_000) => {
  const t0 = Date.now();
  let quiet = 0;
  let last = asked.length;
  while (Date.now() - t0 < ms) {
    await new Promise(r => setTimeout(r, 250));
    if (asked.length === last) quiet += 250;
    else {
      quiet = 0;
      last = asked.length;
    }
    if (ok() && quiet >= (RECORD ? 12000 : 1500)) return;
  }
  throw new Error('golden: SPY did not settle');
};

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
const GOLD = { front: '2026-10-29', call: 775, put: 758, supreme: 758, flip: 771.10993193321 };
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
const rf = rawFlip(rawLegs(rows, dates, contractVols(raw, 'SPY', spot, '2026-10-28'), contractOi(raw, 'SPY')), spot);
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

/* ---- 3. ThetaData's own bars, when that set has been recorded ---- */
const thetaDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', THETA_SET);
if (!(existsSync(thetaDir) && readdirSync(thetaDir).some(f => f.endsWith('.json.gz'))) && !RECORD) {
  console.log(`SKIP  ${THETA_SET} is not recorded: run GOLDEN_RECORD=1 npx tsx scripts/golden/terrain-golden.ts where the ThetaData terminal answers`);
} else {
  installUwFixtures(THETA_SET);
  const { thetaGet } = await import('../../src/data/thetaFeed');
  const path = '/stock/history/ohlc?symbol=SPY&start_date=20261028&end_date=20261028&interval=1m&start_time=09:30:00&end_time=15:59:59&format=json';
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
