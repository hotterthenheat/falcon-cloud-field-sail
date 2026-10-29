/*
  The Dossier's math against recorded Unusual Whales answers, read before the Oct 29 open: a name's grade and its
  pillars, the earnings usual move / rich-cheap / beat counts, insider de-duplication and unit-error filtering, Congress
  amount ranges, the short squeeze read, and the day's change with the after-hours move kept apart. The app's own code
  maps the fixtures exactly as the browser maps the proxy's answers.

  Every expected value was recomputed from the raw fixture rows by a separate script (plain JSON arithmetic, none of the
  app's code); the line above each check says what was counted.

  Replay: npx tsx scripts/golden/dossier-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/dossier-golden.ts
*/
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'dossier-2026-10-29';

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/dossier/stocks', href: 'http://127.0.0.1/dossier/stocks', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

installUwFixtures(SET);
freezeClock(recordedAt(SET, new Date().toISOString()));

const { openFeeds } = await import('../../src/data/feedGate');
const { uwCall } = await import('../../src/data/whales');
const { readOfScreen, yearlyRate } = await import('../../src/data/stockOverview');
const { dossierFromRows } = await import('../../src/data/earningsFeed');
const { readInsiders, congressFromWhales } = await import('../../src/data/whalesMap');
const { summariseCongress } = await import('../../src/data/congress');
const { shortRowFromFile } = await import('../../src/data/liveFiles');
const { squeezeRead } = await import('../../src/data/squeeze');
const { dayChangeOf, regularCloses } = await import('../../src/data/dayChange');
const { screenerRead } = await import('../../src/data/liveQuote');
openFeeds();

const REPORT = process.env.GOLDEN_REPORT === '1';
const say = (k: string, v: unknown) => REPORT && console.log(`REPORT ${k} = ${JSON.stringify(v)}`);
const get = async <T>(path: string): Promise<T> => {
  const r = await uwCall(path);
  if (r.error) throw new Error(`${path}: ${r.error}`);
  return r.data as T;
};
const round = (v: number, d = 4) => Number(v.toFixed(d));

const READ: Record<string, { pillars: number[]; composite: number; grade: string; rate: number }> = {
  NVDA: { pillars: [28, 87, 46], composite: 51, grade: 'caution', rate: 85 },
  GME: { pillars: [11, 46, 50], composite: 34, grade: 'poor', rate: 8 },
};

/* ---- 1. the stock read: grade and pillars off one screener row -------------------------------------------------- */
for (const t of ['NVDA', 'GME']) {
  const rows = await get<Record<string, unknown>[]>(`/screener/stocks?ticker=${t}`);
  const row = rows.find(r => String(r.ticker).toUpperCase() === t)!;
  /* the row is dated Oct 28 and read before the open: its regular price is that day's regular close */
  const closes = regularCloses((await get<Record<string, unknown>[]>(`/stock/${t}/ohlc/1d?limit=18`)) as never).slice(0, 5);
  const read = readOfScreen(row, closes);
  const pillars = Object.fromEntries(read.pillars.map(p => [p.key, { score: p.score, inRead: p.inRead, factors: p.factors.filter(f => !f.context).map(f => [f.key, round(f.lean), f.weight]) }]));
  say(`${t}.read`, { composite: read.composite, grade: read.grade, lean: read.lean, pillars });
  const growth = read.pillars.find(p => p.key === 'numbers')!.factors.find(f => f.key === 'growth');
  say(`${t}.growth`, growth);
  say(`${t}.rates`, [yearlyRate(Number(row.eps_growth_4q), 1), yearlyRate(Number(row.eps_growth_8q), 2), yearlyRate(Number(row.eps_growth_12q), 3)]);
  const want = READ[t];
  /* trend: ema_20, rsi_14, adx_14 with the week off one_week_close, the month off one_month_close, all against the
     Oct 28 regular close; numbers: the slowest of the 1/2/3-year EPS rates and the share count; money: the side of the
     premium (bullish_premium against bearish_premium), relative volume under 1.3x leaning nothing */
  expectEqual(`${t} pillars trend · numbers · money`, read.pillars.map(p => p.score), want.pillars);
  expectEqual(`${t} composite and grade`, [read.composite, read.grade], [want.composite, want.grade]);
  expectNear(`${t} earnings growth a year read`, Number(String(growth?.value).match(/[+−-]\d+/)?.[0].replace('−', '-')), want.rate);
}

const EARN: Record<string, { iso: string; implied: number; usual: number; richness: number; beats: number[]; insideUp: number[] }> = {
  NVDA: { iso: '2026-11-18', implied: 7.4094, usual: 4.02, richness: 1.8431, beats: [5, 1, 2], insideUp: [5, 8, 3, 8] },
  GME: { iso: '2026-12-08', implied: 0, usual: 4.904, richness: 0, beats: [6, 0, 2], insideUp: [6, 8, 6, 8] },
};

/* ---- 2. earnings: usual move, rich / fair / cheap, beat · in line · miss ---------------------------------------- */
for (const t of ['NVDA', 'GME']) {
  const rows = await get<Record<string, unknown>[]>(`/earnings/${t}`);
  const d = dossierFromRows(t, rows as never)!;
  const e = d.event;
  say(`${t}.earnings`, { iso: e.iso, implied: round(e.impliedMovePct), usual: round(e.histAvgMovePct), n: e.histCount, richness: round(e.richness), beat: e.beatCount, inline: e.inlineCount, miss: e.missCount, inside: d.inside, up: d.up });
  const w = EARN[t];
  /* the upcoming row's expected_move_perc x 100; the mean |post_earnings_move_1d| of the last eight reports with one */
  expectEqual(`${t} next report`, e.iso, w.iso);
  expectNear(`${t} implied move %`, e.impliedMovePct, w.implied, 1e-4);
  expectNear(`${t} usual move %`, e.histAvgMovePct, w.usual, 1e-4);
  /* implied over usual, unrounded; rich above 1.3x */
  expectNear(`${t} richness`, e.richness, w.richness, 1e-4);
  /* actual_eps against street_mean_est to the cent, last eight with both */
  expectEqual(`${t} beat · in line · miss`, [e.beatCount, e.inlineCount, e.missCount], w.beats);
  /* each past move against its own expected_move_perc; moves above zero */
  expectEqual(`${t} inside its own implied · up`, [d.inside?.n, d.inside?.of, d.up?.n, d.up?.of], w.insideUp);
}

const INS: Record<string, { counts: number[]; bought: number; sold: number }> = {
  NVDA: { counts: [500, 351, 134, 0], bought: 0, sold: 5232714698 },
  GME: { counts: [182, 165, 2, 0], bought: 193919386, sold: 32136601 },
};

/* ---- 3. insiders: one name's filings, de-duplicated, unit errors and non-shares set aside ------------------------- */
for (const t of ['NVDA', 'GME']) {
  const rows = await get<Record<string, unknown>[]>(`/insider/transactions?ticker_symbol=${t}`);
  const r = readInsiders(rows as never);
  const market = r.trades.filter(x => x.code === 'P' || x.code === 'S');
  const bought = market.filter(x => x.kind === 'BUY').reduce((a, x) => a + x.value, 0);
  const sold = market.filter(x => x.kind === 'SELL').reduce((a, x) => a + x.value, 0);
  say(`${t}.insiders`, { raw: rows.length, trades: r.trades.length, merged: r.merged, notShares: r.notShares, implausible: r.implausible, market: market.length, bought, sold });
  const w = INS[t];
  /* Form 144 and unnamed codes out; joint owners, twins and 4/A restatements of one trade (ticker, day, code, size)
     folded into one; what is left counted, and its open-market buys and sales summed as shares x price (each row rounded
     to the dollar: the reference rounds half to even, the page half up, hence the tolerance) */
  expectEqual(`${t} insider rows · trades · folded · set aside`, [rows.length, r.trades.length, r.merged, r.notShares + r.implausible], w.counts);
  expectNear(`${t} open-market bought $`, bought, w.bought, 1e-8);
  expectNear(`${t} open-market sold $`, sold, w.sold, 1e-8);
}

/* the market's latest filings: the page's first read, where joint filings, amendments and unit mix-ups turn up */
{
  const rows = await get<Record<string, unknown>[]>('/insider/transactions?limit=500&page=0');
  const r = readInsiders(rows as never);
  say('market.insiders', { raw: rows.length, trades: r.trades.length, merged: r.merged, notShares: r.notShares, implausible: r.implausible });
  /* open-market rows whose security_title is a swap, preferred, warrant or note: 3; whose price is ten times off the
     stock_price, or one trade over a quarter of the marketcap: 10 */
  expectEqual('market insider rows · trades · folded · not shares · implausible', [rows.length, r.trades.length, r.merged, r.notShares, r.implausible], [500, 378, 2, 3, 10]);
}

/* ---- 4. congress: one name's reports, the brackets summed as a range ------------------------------------------- */
{
  const people = await get<Record<string, unknown>[]>('/congress/politicians?last_traded_within_months=24');
  const rows = await get<Record<string, unknown>[]>('/congress/recent-trades?ticker=NVDA&limit=200');
  const feed = congressFromWhales(rows as never, people as never);
  const nvda = feed.trades.filter(x => x.ticker.toUpperCase() === 'NVDA');
  const year = summariseCongress(nvda.filter(x => x.tradedDaysAgo <= 365), 365);
  say('congress.NVDA', { raw: rows.length, trades: nvda.length, year: { n: year.trades.length, low: year.totalLow, high: year.totalHigh, unknown: year.unknownAmounts, purchases: year.purchases, sales: year.sales, late: year.lateFilings, medianLag: year.medianLag } });
  /* member_type executive left out (26 of 200); traded within 365 days: 45; each amounts bracket's low and high summed */
  expectEqual('NVDA congress reports · in the year', [nvda.length, year.trades.length], [174, 45]);
  expectEqual('NVDA congress amount range', [year.totalLow, year.totalHigh], [1991045, 7790000]);
  /* Buy rows; filed_at_date minus transaction_date over 45 days; the middle lag */
  expectEqual('NVDA congress purchases · late · median lag', [year.purchases, year.lateFilings, year.medianLag], [22, 4, 24]);
}

/* ---- 5. shorts: GME's two newest settlements and the squeeze read ---------------------------------------------- */
{
  const rows = await get<Record<string, unknown>[]>('/short_screener?tickers=GME&order_by=market_date&order_direction=desc&limit=2');
  const row = shortRowFromFile('GME', null, { si: rows })!;
  const q = squeezeRead(row);
  say('shorts.GME', { raw: rows.length, interest: round(row.interestPct), dtc: row.daysToCover, fee: row.feeRate, availableM: row.availableM, floatM: round(row.floatM), change: row.changePct, word: q.word, points: q.points, asOf: q.asOf, stale: q.stale });
  /* the Sep 30 settlement: si_float x 100, days_to_cover, fee_rate, total_float; shares short against Sep 15's */
  expectNear('GME short interest % of float', row.interestPct, 8.4586, 1e-4);
  expectEqual('GME days to cover · fee · change %', [row.daysToCover, row.feeRate, row.changePct], [3.98, 0.2717, 9.2]);
  /* no rung reached: SI under 20%, DTC under 5, fee under 10%, 10M available, +9.2% shares; Oct 15 due by Oct 26 */
  expectEqual('GME squeeze read', [q.word, q.points, q.asOf, q.stale], ['weak', 0, '2026-09-30', true]);
}

const DAY: Record<string, { day: number; ext: number; regular: number; screenExt: number }> = {
  NVDA: { day: -1.1746, ext: -0.5339, regular: 215.38, screenExt: -0.0046 },
  GME: { day: -0.1284, ext: 0.7282, regular: 23.33, screenExt: -0.0857 },
};

/* ---- 6. the day's change, with the move outside the session kept apart ----------------------------------------- */
for (const t of ['NVDA', 'GME']) {
  const state = await get<Record<string, unknown>>(`/stock/${t}/stock-state`);
  const daily = await get<Record<string, unknown>[]>(`/stock/${t}/ohlc/1d?limit=18`);
  const closes = regularCloses(daily as never);
  const dc = dayChangeOf(state as never, closes);
  const screen = (await get<Record<string, unknown>[]>(`/screener/stocks?ticker=${t}`))[0];
  const sr = screenerRead(screen, closes.slice(0, 5));
  say(`${t}.day`, { closes: closes.slice(0, 3), state: { close: state.close, prev: state.prev_close, mt: state.market_time }, dayPct: round(dc.dayPct), extPct: dc.extPct == null ? null : round(dc.extPct), phase: dc.phase, screen: sr && { regular: sr.regular, pct: sr.pct == null ? null : round(sr.pct), ext: sr.ext, extPct: sr.extPct == null ? null : round(sr.extPct), date: sr.date } });
  const w = DAY[t];
  /* before the open: Oct 28's regular close against Oct 27's; the pre-market print against Oct 28's close, apart */
  expectEqual(`${t} phase`, dc.phase, 'pre');
  expectNear(`${t} the session's change %`, dc.dayPct, w.day, 1e-4);
  expectNear(`${t} pre-market move %`, dc.extPct ?? NaN, w.ext, 1e-4);
  /* the screener row (dated Oct 28) reads the regular close, its own close as the move outside the session */
  expectEqual(`${t} screener regular close`, sr?.regular, w.regular);
  expectNear(`${t} screener outside-session move %`, sr?.extPct ?? NaN, w.screenExt, 1e-4);
}

done();
