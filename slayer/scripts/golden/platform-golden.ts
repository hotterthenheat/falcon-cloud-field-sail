/*
  The platform's math against recorded Unusual Whales answers (SPY, read before the Oct 29 open): Pulse's desk book
  and its key-levels rows, a watched contract's P&L marked at a recorded NBBO, and the alert rules walked along the
  recorded Oct 28 one-minute path. Every expected value is recomputed here straight from the raw rows.

  Replay: npx tsx scripts/golden/platform-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/platform-golden.ts
*/
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';
import { byStrike, levelsOfRows, rawAnswers } from './pinpointRaw';
import type { Candle } from '../../src/types/market';

const SET = 'platform-2026-10-29';
const T = 'SPY';
const DAY = '2026-10-28';

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.addEventListener ??= () => undefined;
g.removeEventListener ??= () => undefined;
g.location = { search: '', pathname: '/pulse', href: 'http://127.0.0.1/pulse', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
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
const { uwCall } = await import('../../src/data/whales');
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
    if (ok() && quiet >= (process.env.GOLDEN_RECORD === '1' ? 12000 : 1500)) return;
  }
  throw new Error('golden: the book did not settle');
};

/* ---- Pulse: the desk's book (snapshotOf, board mode) and the key-levels tile ---- */

book.ensureBook(T);
await settle(() => book.snapshotOf(T) != null);
const snap = book.snapshotOf(T)!;
const { buildExposureProfile } = await import('../../src/data/exposure');
const { buildKeyLevels } = await import('../../src/data/pulse');
const raw = rawAnswers(SET);

const profile30 = buildExposureProfile(snap, '0DTE', 30);
const lv = profile30.levels;
/* the desk's book reads the front expiry's rows (spot-exposures/expiry-strike for that one date) */
const FRONT = '2026-10-29';
const rows = raw.get(`/stock/${T}/spot-exposures/expiry-strike?expirations[]=${FRONT}&limit=500`) as Record<string, string | number | null>[];
const frontDates = new Set([FRONT]);
/* hand: call wall = the strike of the largest positive call+put gamma sum on the front expiry, put wall the most
   negative, supreme the largest |net| (levelsOfRows over spot-exposures/expiry-strike rows) */
const hand = levelsOfRows(byStrike(rows, frontDates));
console.log(`front expiry ${[...frontDates][0]}, spot ${snap.spot}`);
expectEqual('Pulse key levels: call · put wall · supreme match the raw rows', [lv.callWall, lv.putWall, lv.supreme], [hand.callWall, hand.putWall, hand.supreme]);

const keyRows = buildKeyLevels(snap, lv, lv.pin ?? snap.spot);
const strikes = snap.chain.map(n => n.strike);
for (const r of keyRows) {
  if (r.kind === 'spot') continue;
  /* hand: distance = (level − spot) ÷ spot × 100; pressure = |net| at the strike nearest the level in the desk's chain */
  expectNear(`key level ${r.kind} ${r.price}: distance from spot`, r.distPct, ((r.price - snap.spot) / snap.spot) * 100, 1e-12);
  const nearest = strikes.reduce((b, k) => (Math.abs(k - r.price) < Math.abs(b - r.price) ? k : b), strikes[0]);
  expectNear(`key level ${r.kind} ${r.price}: pressure is |net| at ${nearest}`, r.pressure, Math.abs(snap.chain.find(n => n.strike === nearest)!.netGex), 1e-12);
}
expectEqual('key levels: highest price first', keyRows.map(r => r.price), [...keyRows.map(r => r.price)].sort((a, b) => b - a));

/* ---- the watchlist: one watched contract marked at its recorded NBBO ---- */

const { returnsOf } = await import('../../src/data/watchlist');
const expiry = [...frontDates][0];
const contracts = await uwCall(`/stock/${T}/option-contracts?limit=500&expiry=${expiry}`);
const crow = (contracts.data as Record<string, string>[]).find(r => /C00775000$/.test(r.option_symbol));
if (!crow) throw new Error('golden: no 775C row');
/* hand: the mark is the NBBO mid of the raw row */
const mark = (Number(crow.nbbo_bid) + Number(crow.nbbo_ask)) / 2;
const spot = snap.spot;
const watched = {
  id: 'w1',
  ticker: T,
  strike: 775,
  right: 'C' as const,
  expiry,
  addedAt: Date.parse('2026-10-27T15:00:00Z'),
  addedMark: 3,
  addedSpot: 760,
  size: 2,
  status: 'open' as const,
  marks: [
    { day: '2026-10-27', close: 3 },
    { day: DAY, close: 2.5 },
  ],
};
const r = returnsOf(watched, spot, { mark, live: true, at: null });
console.log(`775C ${expiry}: bid ${crow.nbbo_bid} ask ${crow.nbbo_ask} → mark ${mark}`);
/* hand: today = (mark − yesterday's close) × 100 × size; total = (mark − cost) × 100 × size; R = Δ ÷ cost */
expectNear('watch: today $', r.todayDollars, Number(((mark - 2.5) * 200).toFixed(2)), 1e-12);
expectNear('watch: total $', r.totalDollars, Number(((mark - 3) * 200).toFixed(2)), 1e-12);
expectNear('watch: total R', r.totalR, (mark - 3) / 3, 1e-12);
expectNear('watch: breakeven = strike + cost', r.breakeven, 778, 1e-12);
expectNear('watch: spot to breakeven, % of spot', r.toBreakevenPct, ((778 - spot) / spot) * 100, 1e-12);
const none = returnsOf(watched, spot, { mark: NaN, live: false, at: null });
expectEqual('watch: no mark is no P&L (never a zero)', Number.isFinite(none.totalDollars), false);

/* ---- alerts: the rules walked along the recorded Oct 28 one-minute closes ---- */

const { evaluateAlert } = await import('../../src/components/gex/alertStore');
const { emaSeries } = await import('../../src/data/indicators');
const ohlc = await uwCall(`/stock/${T}/ohlc/1m?date=${DAY}&limit=1000`);
const bars: Candle[] = (ohlc.data as Record<string, string>[])
  .filter(b => b.market_time === 'r')
  .map(b => ({ time: Date.parse(b.start_time) / 1000, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) }))
  .sort((a, b) => a.time - b.time);
const closes = bars.map(b => b.close);
console.log(`${bars.length} regular bars, ${closes[0]} → ${closes[closes.length - 1]}`);

type Ctx = Parameters<typeof evaluateAlert>[1];
const ctxOf = (close: number, extra: Partial<Ctx> = {}): Ctx => ({ close, levels: { callWall: null, putWall: null, flip: null, supreme: null, coneHigh: null, coneLow: null }, netGex: null, step: 1, prints: [], news: [], tf: '', values: {}, ...extra }) as Ctx;
const walk = (alert: Parameters<typeof evaluateAlert>[0], ctx: (i: number) => Ctx): number => {
  let a = alert;
  for (let i = 0; i < closes.length; i++) {
    const v = evaluateAlert(a, ctx(i));
    if (v.fire) return i;
    if (v.armed) a = v.armed as typeof a;
  }
  return -1;
};

/* a price alert above the session's 2/3 point of its range: hand = the first close at or over it */
const hi = Math.max(...closes);
const lo = Math.min(...closes);
const above = Number((lo + ((hi - lo) * 2) / 3).toFixed(2));
const handAbove = closes.findIndex(c => c >= above);
expectEqual(`price alert above ${above}: fires on the first close at or over it (bar ${handAbove})`, walk({ id: 'p', kind: 'price', price: above, above: true, firedAt: 0 } as never, i => ctxOf(closes[i])), handAbove);

/* a level alert on a fixed level (the session's midpoint): arms on the first close off it, fires on the first close
   at or through it from that side */
const mid = Number(((hi + lo) / 2).toFixed(2));
const first = closes.findIndex(c => c !== mid);
const side = closes[first] > mid ? 1 : -1;
const handCross = closes.findIndex((c, i) => i > first && (side === 1 ? c <= mid : c >= mid));
expectEqual(`level alert at ${mid}: armed ${side > 0 ? 'above' : 'below'} on bar ${first}, fires on the cross (bar ${handCross})`, walk({ id: 'l', kind: 'level', level: 'flip', side: 0, firedAt: 0 } as never, i => ctxOf(closes[i], { levels: { callWall: null, putWall: null, flip: mid, supreme: null, coneHigh: null, coneLow: null } })), handCross);

/* the 9-bar average cross: hand EMA (k = 2/10, seeded at the first close), armed on the first bar off it */
const ema: number[] = [];
for (const c of closes) ema.push(ema.length ? c * 0.2 + ema[ema.length - 1] * 0.8 : c);
const app = emaSeries(bars, 9);
expectNear('EMA9 on the last bar against the hand series', app[app.length - 1], ema[ema.length - 1], 1e-12);
const eFirst = closes.findIndex((c, i) => c !== ema[i]);
const eSide = closes[eFirst] > ema[eFirst] ? 1 : -1;
const handEma = closes.findIndex((c, i) => i > eFirst && (eSide === 1 ? c <= ema[i] : c >= ema[i]));
expectEqual(`EMA9 alert: armed on bar ${eFirst}, fires on the first cross (bar ${handEma})`, walk({ id: 'e', kind: 'indicator', source: 'ema9', tf: '1m', side: 0, threshold: 0, firedAt: 0 } as never, i => ctxOf(closes[i], { tf: '1m', values: { ema9: app[i] } })), handEma);

console.log(`asked ${asked.length} paths`);
done();
