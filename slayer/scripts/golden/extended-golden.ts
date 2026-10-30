/*
  Extended-hours bars (data/thetaEligible.ts through data/thetaTape.ts pullIntraday) on SPY, recorded through the dev
  proxy from ThetaData on Thu 2026-10-29 after the close (the extended-2026-10-29 set): the one-minute bars of the
  after-hours window for Oct 23–29 and of the pre-market and regular session for Oct 29, and the prints they are
  rebuilt from (/stock/history/trade, one request for the finished days and one for today, per window).

  ThetaData's own after-hours bars on Oct 29 reach 769.36 and 769.5067 from 16:09 to 16:19 while SPY traded near 765.5:
  the closing auction's late reports (average price, prior reference price) and size-1 odd lots at the close price, all
  Form T. Rebuilt from the prints whose conditions may set the consolidated high, low and last, those minutes stay at
  the market's level, with every print's volume kept. The regular session and the 16:00 close bar are ThetaData's own.

  The expected prices were worked out by hand off the recorded raw prints (the condition codes of each print against
  ThetaData's Trade Conditions table), not by this file's code.

    Replay: npx tsx scripts/golden/extended-golden.ts
    Record: GOLDEN_RECORD=1 npx tsx scripts/golden/extended-golden.ts   (needs the terminal and the dev server on 8080)
*/
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'extended-2026-10-29';
const RECORD = process.env.GOLDEN_RECORD === '1';
const REPORT = process.env.GOLDEN_REPORT === '1';
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.location = { search: '', pathname: '/terrain', href: 'http://127.0.0.1/terrain', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', SET);
if (!RECORD && !(existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.json.gz')))) {
  console.log(`SKIP  ${SET} is not recorded: run GOLDEN_RECORD=1 npx tsx scripts/golden/extended-golden.ts where the ThetaData terminal answers`);
  done();
}

installUwFixtures(SET);
/* recorded after the close on Oct 29: "today" is Oct 29, its after-hours window still open */
freezeClock(recordedAt(SET, new Date().toISOString()));
const { openFeeds } = await import('../../src/data/feedGate');
openFeeds();
const { pullIntraday, readOhlc } = await import('../../src/data/thetaTape');
const { nyMinutes, nyIsoDate } = await import('../../src/core/nyTime');
type Candle = import('../../src/types/market').Candle;

const hm = (b: Candle) => {
  const m = nyMinutes(b.time * 1000);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const on = (bars: Candle[], day: string) => bars.filter(b => nyIsoDate(b.time * 1000) === day);
const at = (bars: Candle[], day: string, t: string) => on(bars, day).find(b => hm(b) === t);
const say = (k: string, v: unknown) => REPORT && console.log(`REPORT ${k} = ${JSON.stringify(v)}`);

/* ThetaData's own bars, as the proxy answered them (the same addresses pullIntraday asks) */
const raw = async (path: string): Promise<Candle[]> => {
  const body = (await (await fetch(`/api/theta${path}`)).json()) as { response?: unknown[] };
  return readOhlc(body.response ?? [], path.includes('16:00:00') ? 'post' : path.includes('04:00:00') ? 'pre' : 'rth');
};

/* ---- after hours, Oct 23–29: one read for the finished days, one for today ---- */
const post = await pullIntraday('SPY', '1m', 'post', '20261023', '20261029');
if (post.offline) throw new Error('golden: ThetaData did not answer the after-hours bars');
const rawPost = await raw('/stock/history/ohlc?symbol=SPY&start_date=20261023&end_date=20261029&interval=1m&start_time=16:00:00&end_time=19:59:59.999&format=json');
const late = ['16:09', '16:10', '16:11', '16:13', '16:15', '16:16', '16:17', '16:19'];
say('raw 16:09–16:19 highs', late.map(t => at(rawPost, '2026-10-29', t)?.high));
say('rebuilt 16:09–16:19', late.map(t => at(post.bars, '2026-10-29', t)));

/* the problem, as ThetaData's bars carry it */
expectEqual(
  "ThetaData's own Oct 29 highs 16:09–16:19 (the late reports)",
  late.map(t => at(rawPost, '2026-10-29', t)?.high),
  [769.36, 769.36, 769.5067, 769.5067, 769.36, 769.36, 769.36, 769.36],
);
/* hand values: the highest price-setting print of each minute (16:11's 769.5067 × 2.2M is AVG_PRC, ext_condition4 3;
   16:16–16:19's 769.36 prints are PRIOR_REFERENCE_PRICE, 8; 16:10's and 16:15's are size-1 ODD_LOT, 115) */
expectEqual(
  'rebuilt Oct 29 highs 16:09–16:19',
  late.map(t => at(post.bars, '2026-10-29', t)?.high),
  [766.45, 765.909, 765.6797, 765.8, 765.5749, 765.719, 765.97, 765.77],
);
const lateBars = on(post.bars, '2026-10-29').filter(b => hm(b) >= '16:09' && hm(b) <= '16:19');
expectEqual('no rebuilt bar 16:09–16:19 reaches 767', lateBars.filter(b => b.high >= 767).length, 0);
expectEqual('16:19 closes at the last price-setting print, not the 769.36 prior-reference report', at(post.bars, '2026-10-29', '16:19')?.close, 765.77);
expectEqual('16:04 opens at 767.13, not the size-1 odd lots at 769.36', at(post.bars, '2026-10-29', '16:04')?.open, 767.13);

/* every print's volume stays: the same minutes and the same volume as ThetaData's bars */
expectEqual('16:11 keeps the 2.2M-share report in its volume', at(post.bars, '2026-10-29', '16:11')?.volume, 2207934);
expectEqual('16:13 keeps 1,783,101 shares', at(post.bars, '2026-10-29', '16:13')?.volume, 1783101);
const volOf = (bars: Candle[]) => bars.reduce((s, b) => s + b.volume, 0);
for (const day of ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) {
  const mine = on(post.bars, day);
  const theirs = on(rawPost, day);
  const lost = theirs.filter(b => !mine.some(m => m.time === b.time));
  say(`${day} bars lost`, lost.map(b => [hm(b), b.volume]));
  expectEqual(`${day}: after-hours volume = ThetaData's, less the minutes with no price yet`, volOf(mine) + volOf(lost), volOf(theirs));
  expectEqual(`${day}: no minute added`, mine.every(m => theirs.some(b => b.time === m.time)), true);
}

/* the close bar is ThetaData's own (its prints follow the regular session's rules) */
const close = at(post.bars, '2026-10-29', '16:00');
const rawClose = at(rawPost, '2026-10-29', '16:00');
expectEqual("the 16:00 bar is ThetaData's", close, rawClose);

/* ---- pre-market, Oct 29 ---- */
const pre = await pullIntraday('SPY', '1m', 'pre', '20261029', '20261029');
const rawPre = await raw('/stock/history/ohlc?symbol=SPY&start_date=20261029&end_date=20261029&interval=1m&start_time=04:00:00&end_time=09:29:59.999&format=json');
say('pre 04:00 / 07:41 raw', [at(rawPre, '2026-10-29', '04:00'), at(rawPre, '2026-10-29', '07:41')]);
say('pre 04:00 / 07:41 rebuilt', [at(pre.bars, '2026-10-29', '04:00'), at(pre.bars, '2026-10-29', '07:41')]);
/* 772.31 is Oct 28's close, printed again as size-1 odd lots (some CASH_SALE, ext_condition1 11) through the morning */
expectEqual("ThetaData's own pre-market high (a 07:01 odd lot)", Math.max(...rawPre.map(b => b.high)), 772.3136);
expectNear('rebuilt pre-market high', Math.max(...pre.bars.map(b => b.high)), 771.24, 1e-9);
expectEqual('04:00 high off the round lots, not the 772.31 odd lots', at(pre.bars, '2026-10-29', '04:00')?.high, 771.2);
expectEqual('pre-market volume = ThetaData\'s', volOf(pre.bars), volOf(rawPre));
/* 07:41 printed only those odd lots (vendor high 772.31): the bar holds the last price-setting print, 769.854 at 07:40:56 */
expectEqual('07:41 holds the last price-setting print', at(pre.bars, '2026-10-29', '07:41'), { time: at(rawPre, '2026-10-29', '07:41')!.time, open: 769.854, high: 769.854, low: 769.854, close: 769.854, volume: 40 });

/* ---- the regular session is untouched ---- */
const rth = await pullIntraday('SPY', '1m', 'rth', '20261029', '20261029');
const rawRth = await raw('/stock/history/ohlc?symbol=SPY&start_date=20261029&end_date=20261029&interval=1m&start_time=09:30:00&end_time=15:59:59.999&format=json');
expectEqual("regular session bars = ThetaData's", JSON.stringify(rth.bars) === JSON.stringify(rawRth) && rth.bars.length === 390, true);

done();
