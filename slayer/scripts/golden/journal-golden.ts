/*
  THE JOURNAL — `npx tsx scripts/golden/journal-golden.ts`

  1. The split into journals, on REAL recorded trades: two backtest sessions played on ThetaData's recorded SPY day
     (set practice-2026-10-29, Wed 2026-10-28 — the same recording practice-golden.ts replays). Each session's journal
     holds its own trades and only those; the every-session journal is the two added up. The dollars are checked
     against the raw recorded NBBO rows read plainly (none of the app's code), as practice-golden does.
  2. The address: which journal `?journal=…` names, the older `?book=&session=` words, and the trade page's walk.
  3. A journal of your own: entries a reader would type (they are the reader's input, not market data), added up by
     hand below — the day's P&L after fees, the win rate, the profit factor by day and by trade.
  4. The CSV import: the documented format read, every refusal said with its line, and the export read back the same.
  5. A journal deleted on its own page is remembered by name and last count.
*/
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'practice-2026-10-29';
const DAY = '2026-10-28';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden', SET);
const recorded = existsSync(join(DIR, 'clock.txt'));

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/practice/journal', href: 'http://127.0.0.1/practice/journal', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
(g.window as { addEventListener?: unknown }).addEventListener ??= () => {};

if (recorded) {
  installUwFixtures(SET);
  freezeClock(recordedAt(SET, new Date().toISOString()));
}

const J = await import('../../src/data/review/journal');
const F = await import('../../src/data/review/journalFigures');
const B = await import('../../src/data/review/journalBooks');
const M = await import('../../src/data/review/journalManual');

/* ================================================================== */
/* 1. The split, on recorded trades */
/* ================================================================== */
if (!recorded) console.log(`PENDING  ${SET} has not been recorded: the per-session split on recorded trades is skipped`);
else {
  const H = await import('../../src/data/review/history');
  const E = await import('../../src/data/review/engine');
  const { openFeeds } = await import('../../src/data/feedGate');
  openFeeds();
  await H.ensureBars('SPY', DAY);
  await H.ensureListing('SPY', DAY);
  const listing = H.listingOf('SPY', DAY)!;
  const expiry = listing.expiries.find(e => e >= '2026-10-30')!;
  const s29 = H.spotAt('SPY', DAY, 29);
  const strikes = listing.strikes[`${expiry}|C`];
  const strike = strikes.reduce((b, k) => (Math.abs(k - s29) < Math.abs(b - s29) ? k : b), strikes[0]);
  const call = { ticker: 'SPY', strike, right: 'C' as const, expiry };
  const put = { ticker: 'SPY', strike, right: 'P' as const, expiry };
  await H.ensureLeg(call, DAY);
  await H.ensureLeg(put, DAY);

  /* the raw rows, read plainly (practice-golden.ts's reading) */
  const raw = (path: string): Record<string, unknown>[] => {
    const file = join(DIR, `${createHash('sha1').update(`theta:${path}`).digest('hex').slice(0, 16)}.json.gz`);
    const saved = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { body: string };
    const parsed = JSON.parse(saved.body) as { response?: unknown[] } | unknown[];
    const top = (Array.isArray(parsed) ? parsed : (parsed.response ?? [])) as Record<string, unknown>[];
    return top.flatMap(o => (Array.isArray(o.data) ? (o.data as Record<string, unknown>[]).map(d => ({ ...(o.contract as object), ...d })) : [o]));
  };
  const ymd = DAY.replace(/-/g, '');
  const legPath = (c: typeof call) => `/option/history/quote?symbol=SPY&expiration=${c.expiry.replace(/-/g, '')}&strike=${c.strike.toFixed(2)}&right=${c.right === 'C' ? 'call' : 'put'}&date=${ymd}&interval=1m&format=json`;
  const callRows = raw(legPath(call));
  const putRows = raw(legPath(put));
  const hm = (r: Record<string, unknown>) => String(r.timestamp).slice(11, 16);
  const clock = (m: number) => `${String(Math.floor((570 + m) / 60)).padStart(2, '0')}:${String((570 + m) % 60).padStart(2, '0')}`;
  const quoteRowAt = (rows: Record<string, unknown>[], m: number) => rows.find(r => hm(r) === clock(m + 1))!;
  const FEE = 0.65;

  /* session A: two calls bought at 10:00, one sold at 11:30, the other at 14:00 — two trades? one: a position closed in two
     pieces is one trade */
  let a = E.newSession({ id: 'jA', name: 'Calls', ticker: 'SPY', startCash: 25000, startDay: DAY, now: 0 });
  a = E.place(E.advance(a, { day: DAY, minute: 29 }, 0), { contract: call, side: 'buy', qty: 2, kind: 'market' }, 0);
  a = E.place(E.advance(a, { day: DAY, minute: 119 }, 0), { contract: call, side: 'sell', qty: 1, kind: 'market' }, 0);
  a = E.place(E.advance(a, { day: DAY, minute: 269 }, 0), { contract: call, side: 'sell', qty: 1, kind: 'market' }, 0);
  /* then one more round trip on the call, 14:30 in, 15:30 out */
  a = E.place(E.advance(a, { day: DAY, minute: 299 }, 0), { contract: call, side: 'buy', qty: 1, kind: 'market' }, 0);
  a = E.place(E.advance(a, { day: DAY, minute: 359 }, 0), { contract: call, side: 'sell', qty: 1, kind: 'market' }, 0);
  /* session B: a put bought at 13:00 and sold at 15:00 */
  let b = E.newSession({ id: 'jB', name: 'Puts', ticker: 'SPY', startCash: 25000, startDay: DAY, now: 0 });
  b = E.place(E.advance(b, { day: DAY, minute: 209 }, 0), { contract: put, side: 'buy', qty: 3, kind: 'market' }, 0);
  b = E.place(E.advance(b, { day: DAY, minute: 329 }, 0), { contract: put, side: 'sell', qty: 3, kind: 'market' }, 0);

  const ask = (rows: Record<string, unknown>[], m: number) => Number(quoteRowAt(rows, m).ask);
  const bid = (rows: Record<string, unknown>[], m: number) => Number(quoteRowAt(rows, m).bid);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /* by hand, from the raw rows: a hundred a point, 0.65 a contract each way */
  const wantA1 = r2(bid(callRows, 119) * 100 + bid(callRows, 269) * 100 - 2 * ask(callRows, 29) * 100 - 4 * FEE);
  const wantA2 = r2(bid(callRows, 359) * 100 - ask(callRows, 299) * 100 - 2 * FEE);
  const wantB = r2(3 * bid(putRows, 329) * 100 - 3 * ask(putRows, 209) * 100 - 6 * FEE);

  const rows = J.rowsOf([a, b]);
  const ofA = F.rowsIn(rows, null, 'jA');
  const ofB = F.rowsIn(rows, null, 'jB');
  expectEqual('the every-session journal holds every closed trade: three', rows.length, 3);
  expectEqual('session A’s journal holds its two trades and only its own', ofA.map(r => r.s.id).join(), 'jA,jA');
  expectEqual('session B’s journal holds its one trade', ofB.map(r => r.s.id).join(), 'jB');
  const two = ofA.find(r => r.t.qty === 2)!;
  const one = ofA.find(r => r.t.qty === 1)!;
  expectNear('A’s first trade (two calls out in two pieces) made what the recorded rows say', two.t.pnl, wantA1, 0.006);
  expectNear('A’s second trade made what the recorded rows say', one.t.pnl, wantA2, 0.006);
  expectNear('B’s put made what the recorded rows say', ofB[0].t.pnl, wantB, 0.006);
  const daysA = F.dayTotals(ofA);
  const daysAll = F.dayTotals(rows);
  expectNear('A’s day on its own calendar is its two trades', daysA.get(DAY)!.net, r2(wantA1 + wantA2), 0.006);
  expectNear('the every-session calendar’s day is both sessions added up', daysAll.get(DAY)!.net, r2(wantA1 + wantA2 + wantB), 0.006);
  expectEqual('…and counts all three', daysAll.get(DAY)!.n, 3);
  const lanes = F.byAccount(rows);
  expectEqual('by session: one lane each, the busiest first', lanes.map(l => `${l.label}:${l.n}`).join(), 'Calls:2,Puts:1');
  expectNear('…adding up to the whole', lanes.reduce((x, l) => x + l.net, 0), daysAll.get(DAY)!.net, 0.006);
  /* the trade page walks the journal the address names */
  const walk = rows.filter(r => J.inCut(r, J.cutFromQuery('?journal=backtest:jB')));
  expectEqual('a trade opened from session B’s journal walks B’s trades only', walk.map(r => r.s.id).join(), 'jB');
  expectEqual('…and from the every-session journal, all of them', rows.filter(r => J.inCut(r, J.cutFromQuery('?journal=backtest'))).length, 3);
  console.log(`REPORT  A ${wantA1} + ${wantA2} · B ${wantB} (strike ${strike}, expiry ${expiry})`);
  /* the recording's figures, pinned (checked by hand against the rows above: SPY Oct 30 771 C/P) */
  expectEqual('the recording: the 771 call and put, Oct 30', `${strike} ${expiry}`, '771 2026-10-30');
  expectNear('pinned: A’s two-piece call trade', wantA1, 19.4, 0.006);
  expectNear('pinned: A’s second call trade', wantA2, -31.3, 0.006);
  expectNear('pinned: B’s puts', wantB, -9.9, 0.006);
}

/* ================================================================== */
/* 2. The address */
/* ================================================================== */
expectEqual('no journal named is every paper account', JSON.stringify(B.pickOf('')), JSON.stringify({ book: 'paper', id: null }));
expectEqual('?journal=paper:<id> is one paper account', JSON.stringify(B.pickOf('?journal=paper:p123&period=week')), JSON.stringify({ book: 'paper', id: 'p123' }));
expectEqual('?journal=manual is every journal of your own', JSON.stringify(B.pickOf('?journal=manual')), JSON.stringify({ book: 'manual', id: null }));
expectEqual('the older ?book=backtest&session= reads as the same journal', JSON.stringify(B.pickOf('?book=backtest&session=s9')), JSON.stringify({ book: 'backtest', id: 's9' }));
expectEqual('a word that is no journal is the one at rest', JSON.stringify(B.pickOf('?journal=bonds:1')), JSON.stringify({ book: 'paper', id: null }));
expectEqual('picking a journal rewrites the address and drops the older words', B.searchWithPick('?book=backtest&session=s9&period=week&day=2026-10-28', { book: 'paper', id: 'p1' }, ['day']), '?period=week&journal=paper%3Ap1');
expectEqual('…and the one at rest leaves no word', B.searchWithPick('?journal=manual:m1', { book: 'paper', id: null }), '');
for (const p of [{ book: 'paper', id: 'a:b' }, { book: 'backtest', id: null }, { book: 'manual', id: 'm1' }] as const) expectEqual(`${JSON.stringify(p)} survives the address`, JSON.stringify(B.pickOf(B.searchWithPick('', p))), JSON.stringify(p));

/* ================================================================== */
/* 3. A journal of your own */
/* ================================================================== */
/* typed by a reader: three days, one with its trades instead of a day figure, one with a day figure AND trades */
const j: import('../../src/data/review/journalManual').ManualJournal = {
  id: 'mine',
  name: 'Schwab',
  createdAt: 0,
  days: {
    '2026-10-26': { pnl: 500, fees: 20, trades: 5, wins: 3, losses: 2, notes: 'Waited for the open', tags: ['ORB'] },
    '2026-10-27': { pnl: -300, fees: 10, trades: 4, wins: 1, losses: 3 },
    '2026-10-29': { pnl: 150, trades: 2 },
    '2026-10-30': { notes: 'Plan: no trades before 10' },
  },
  trades: [
    { id: 't1', day: '2026-10-28', ticker: 'SPY', contract: 'SPY 580C', side: 'long', qty: 2, entry: 1.85, exit: 2.4, pnl: 110, fees: 2.6 },
    { id: 't2', day: '2026-10-28', ticker: 'QQQ', side: 'short', qty: 50, entry: 512.4, exit: 513.1, pnl: -35, fees: 1 },
    { id: 't3', day: '2026-10-28', ticker: 'IWM', side: 'long', pnl: 40 },
    { id: 't4', day: '2026-10-29', ticker: 'SPY', side: 'long', pnl: 999, fees: 4 },
  ],
};
const days = M.manualDaysOf([j]);
/* by hand:
   10-26  500 − 20            = +480   5 trades, 3 won, 2 lost
   10-27  −300 − 10           = −310   4 trades, 1 won, 3 lost
   10-28  trades only: 110 − 35 + 40 = 115 before fees, fees 2.6 + 1 = 3.6 → +111.40; won 2 (t1 107.40, t3 40), lost 1 (t2 −36)
   10-29  the day's 150 stands over its trade's 999; fees blank → the trade's 4 → +146; 2 trades as entered, 1 won (the
          trade), 0 lost
   10-30  notes alone: no day on the calendar */
expectEqual('a day of notes alone is not a traded day', [...days.keys()].join(), '2026-10-26,2026-10-27,2026-10-28,2026-10-29');
expectNear('a day’s figure is its P&L less its fees', days.get('2026-10-26')!.net, 480);
expectNear('a red day', days.get('2026-10-27')!.net, -310);
expectNear('a day with only trades adds them up, fees out', days.get('2026-10-28')!.net, 111.4);
expectEqual('…counting its wins and losses after each trade’s fees', `${days.get('2026-10-28')!.n}/${days.get('2026-10-28')!.wins}/${days.get('2026-10-28')!.losses}`, '3/2/1');
expectNear('the day’s own P&L stands over its trades; a blank fee box takes the trades’ fees', days.get('2026-10-29')!.net, 146);
expectEqual('…and says where its P&L came from', `${days.get('2026-10-29')!.from}/${days.get('2026-10-28')!.from}`, 'day/trades');
const st = M.manualStatsOf([...days.values()]);
expectNear('the period: 480 − 310 + 111.40 + 146', st.net, 427.4);
expectEqual('green and red days', `${st.greenDays}/${st.redDays}`, '3/1');
expectNear('the day win rate: 3 of 4', st.dayWinRate!, 0.75);
expectEqual('wins and losses as entered: 3+1+2+1 won, 2+3+1+0 lost', `${st.wins}/${st.losses}`, '7/6');
expectNear('the win rate: 7 of 13', st.winRate!, 7 / 13, 1e-12);
expectNear('the profit factor by day: (480 + 111.40 + 146) / 310', st.dayProfitFactor!, 2.38);
/* the trades entered: 107.40, −36, 40, 995 → won 1142.40, lost 36 */
expectNear('the profit factor over the trades entered, each after its fees: 1142.40 / 36', st.tradeProfitFactor!, 31.73);
expectNear('fees, all of them', st.fees, 20 + 10 + 3.6 + 4);
expectNear('the worst drop of the day-by-day total: from +480 to +170', st.maxDrawdown, 310);
expectEqual('the longest runs: two green days in a row, one red', `${st.greenRun}/${st.redRun}`, '2/1');
expectEqual('best and worst day', `${st.bestDay!.day}/${st.worstDay!.day}`, '2026-10-26/2026-10-27');
const run = M.manualRunningOf([...days.values()]);
expectEqual('the running total, a day at a time', run.map(p => p.value).join(), '480,170,281.4,427.4');
/* two journals on one day add up */
const other = { ...j, id: 'other', days: { '2026-10-26': { pnl: -80, fees: 0, trades: 1, wins: 0, losses: 1 } }, trades: [] };
const both = M.manualDaysOf([j, other]);
expectNear('every journal of your own: the same day in two journals is added up', both.get('2026-10-26')!.net, 400);
expectEqual('…its counts too', `${both.get('2026-10-26')!.n}/${both.get('2026-10-26')!.losses}`, '6/3');
expectNear('a trade’s P&L from its prices: a contract ×100', M.tradePnlOf('long', 2, 1.85, 2.4, 'SPY 580C'), 110);
expectNear('…shares ×1, a short turned over', M.tradePnlOf('short', 50, 512.4, 513.1), -35);
const none = M.manualStatsOf([days.get('2026-10-26')!]);
expectEqual('with no red day there is no profit factor (the page says "no red days")', none.dayProfitFactor, null);

/* ================================================================== */
/* 4. The CSV */
/* ================================================================== */
const ex = M.readJournalCsv(M.CSV_DAYS_EXAMPLE);
expectEqual('the page’s own days example reads: two days, nothing refused', `${ex.kind}/${ex.days.length}/${ex.misses.length}`, 'days/2/0');
expectEqual('…a quoted note with a comma in it stays one cell', ex.days[1].entry.notes, 'Chased the first move, then sized up');
expectEqual('…tags split on ;', JSON.stringify(ex.days[0].entry.tags), '["ORB","Patience"]');
const tx = M.readJournalCsv(M.CSV_TRADES_EXAMPLE);
expectEqual('the trades example reads: two trades', `${tx.kind}/${tx.trades.length}/${tx.misses.length}`, 'trades/2/0');
expectNear('…a blank P&L worked out from shares: (513.10 − 512.40) × 50, short', tx.trades[1].pnl, -35);
expectEqual('…the time kept as New York’s HH:MM', tx.trades[0].time, '09:52');
const messy = M.readJournalCsv(['Date,P&L,Commission,Trades,Won,Lost,Note', '10/27/2026,"$1,250.50",$8.40,6,4,2,ok', '10/28/26,(340.00),-5,3,1,2,', '2026-02-30,10,,,,,', '2026-10-29,ten,,,,,', '2026-10-30,50,,2,2,1,', '2026-10-27,1,,,,,'].join('\r\n'));
expectEqual('a broker’s headers (P&L, Commission, Won, Lost) are read as ours', messy.kind, 'days');
expectNear('"$1,250.50" is 1250.50', messy.days[0].entry.pnl!, 1250.5);
expectNear('"(340.00)" is a loss', messy.days[1].entry.pnl!, -340);
expectEqual('10/28/26 is 2026-10-28; a fee written negative is a fee', `${messy.days[1].day}/${messy.days[1].entry.fees}`, '2026-10-28/5');
expectEqual('every refusal says its line and why', messy.misses.map(m => m.line).join(), '4,5,6,7');
expectEqual('…a date that is no date', messy.misses[0].why.includes('not a date'), true);
expectEqual('…words where a number goes', messy.misses[1].why, 'pnl "ten" is not a number');
expectEqual('…more wins and losses than trades', messy.misses[2].why, 'More wins and losses than trades');
expectEqual('…a day twice keeps the first', messy.misses[3].why.includes('line 2 is the one kept'), true);
expectEqual('a file with no date column is refused at line 1', M.readJournalCsv('ticker,pnl\nSPY,10').misses[0].line, 1);
expectEqual('a file that is neither (a ticker and no P&L or prices) says what each needs', M.readJournalCsv('date,ticker,side\n2026-10-28,SPY,long').misses[0].why.startsWith('A days file needs'), true);
expectEqual('a trade with no P&L and nothing to work it out from is refused', M.readJournalCsv('date,ticker,side,qty,entry,exit\n2026-10-28,SPY,long,,1.10,1.50').misses[0].why, 'No P&L, and no entry, exit and qty to work it out from');
expectEqual('a side that is not one', M.readJournalCsv('date,ticker,side,pnl\n2026-10-28,SPY,sideways,5').misses[0].why.startsWith('side "sideways"'), true);
/* the export reads back the same */
const back = M.readJournalCsv(M.manualDaysCsv(j));
expectEqual('the days export reads back every day, a day of words alone too', `${back.days.map(d => d.day).join()}/${back.misses.length}`, '2026-10-26,2026-10-27,2026-10-29,2026-10-30/0');
expectEqual('…the day of words alone still has no figure', JSON.stringify(back.days[3].entry), JSON.stringify({ notes: 'Plan: no trades before 10' }));
expectEqual('…figures, notes and tags the same', JSON.stringify(back.days[0].entry), JSON.stringify(j.days['2026-10-26']));
const tback = M.readJournalCsv(M.manualTradesCsv(j));
expectEqual('the trades export reads back every trade, field for field', JSON.stringify(tback.trades.map(t => [t.day, t.ticker, t.side, t.pnl, t.fees ?? null])), JSON.stringify(j.trades.map(t => [t.day, t.ticker, t.side, t.pnl, t.fees ?? null])));
const imp = M.importInto(j, M.readJournalCsv('date,pnl\n2026-10-26,600\n2026-10-31,75'));
expectEqual('an import replaces a day already entered and adds a new one', `${imp.daysReplaced}/${imp.daysNew}`, '1/1');
expectEqual('…keeping the day’s notes and tags where the file has none', `${imp.journal.days['2026-10-26'].pnl}/${imp.journal.days['2026-10-26'].notes}/${imp.journal.days['2026-10-26'].tags}`, '600/Waited for the open/ORB');
const twice = M.importInto(j, tback);
expectEqual('the same trades brought in twice are not added twice', `${twice.tradesAdded}/${twice.tradesSkipped}`, '0/4');

/* ================================================================== */
/* 5. A journal deleted on its own page */
/* ================================================================== */
const s0 = B.seenAfter({ paper: {}, backtest: {} }, 'paper', [{ id: 'p1', name: 'Practice 25K', n: 4, net: 120.456 }, { id: 'p2', name: 'Eval 50K', n: 0, net: 0 }], 1000);
expectEqual('the register writes down each account it sees', Object.keys(s0.paper).join(), 'p1,p2');
expectEqual('…the same again changes nothing', B.seenAfter(s0, 'paper', [{ id: 'p1', name: 'Practice 25K', n: 4, net: 120.46 }], 2000) === s0, true);
const gone = B.goneOf(s0, 'paper', [{ id: 'p2' }]);
expectEqual('an account not there now is gone, with its name and last count', `${gone.length}/${gone[0].name}/${gone[0].n}/${gone[0].net}`, '1/Practice 25K/4/120.46');

done();
