/*
  Trace's math against recorded Unusual Whales answers: the Oct 28 session, read before the Oct 29 open. The app's own
  loaders (data/traceLive.ts read*) map the fixtures exactly as the browser maps the proxy's answers, and the pages'
  own aggregates (data/tape.ts, data/flowBook.ts) add them up.

  Every expected value was recomputed straight from the raw fixture rows by a separate script (plain JSON arithmetic,
  none of the app's code); the line above each check says what was counted.

  Replay: npx tsx scripts/golden/trace-golden.ts
  Record: GOLDEN_RECORD=1 npx tsx scripts/golden/trace-golden.ts
*/
import { done, expectEqual, expectNear, freezeClock, installUwFixtures, recordedAt } from './uwFixtures';

const SET = 'trace-2026-10-29';

const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/trace/live-tape', href: 'http://127.0.0.1/trace/live-tape', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
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

const T = await import('../../src/data/traceLive');
const { summarizeTape, isSpreadLeg, sentimentOf, notCrownable } = await import('../../src/data/tape');
const { bookFacts, boardSums, notABet, floorPackaged, spreadLegDay, crossDay } = await import('../../src/data/flowBook');
const { openFeeds } = await import('../../src/data/feedGate');
const { uwCall } = await import('../../src/data/whales');
openFeeds();

const REPORT = process.env.GOLDEN_REPORT === '1';
const say = (k: string, v: unknown) => REPORT && console.log(`REPORT ${k} = ${JSON.stringify(v)}`);

/* the session the fixtures hold, and its bells */
const close = T.lastRegularClose()!;
expectEqual('session read is Oct 28', close.iso, '2026-10-28');
const stockClose = T.lastStockClose()!.closeMs;
const preOpen = T.dayStartMs(close.iso); // 04:00 ET, where the day's alerts start
/* the 04:00 New York boundary in daylight time (08:00Z) and after the clocks go back on Nov 1 (09:00Z) */
expectEqual('day start Oct 28 (EDT) and Nov 2 (EST)', [new Date(T.dayStartMs('2026-10-28')).toISOString(), new Date(T.dayStartMs('2026-11-02')).toISOString()], ['2026-10-28T08:00:00.000Z', '2026-11-02T09:00:00.000Z']);

/* ---- 1. not-a-bet: the market's last 500 prints before the 16:15 close ---------------------------------------- */
const mkt = await T.readTapePage({}, { olderThan: close.closeMs }, 500);
const regular = mkt.prints.filter(p => !p.extended);
const count = (xs: typeof mkt.prints, f: (p: (typeof mkt.prints)[number]) => boolean) => xs.filter(f).length;
const mktFacts = {
  prints: mkt.prints.length,
  extended: count(mkt.prints, p => !!p.extended),
  cross: count(mkt.prints, p => !!p.cross),
  spreadLeg: count(mkt.prints, p => isSpreadLeg(p)),
  compression: count(mkt.prints, p => !!p.compression),
  crossed: count(mkt.prints, p => p.quoteNoRead === 'crossed'),
  stale: count(mkt.prints, p => p.quoteNoRead === 'stale'),
  noRead: count(mkt.prints, p => sentimentOf(p) === 'NEUTRAL'),
  crownable: count(mkt.prints, p => !notCrownable(p)),
};
say('mktFacts', mktFacts);
/* counted per raw row: report_flags/trading_hours/clock for extended, OPRA ML?T/?ESL codes for legs, bid >= ask for
   crossed, an NBBO side stamped 5+ minutes before the fill for stale; no read = mid, legs, after hours, no-read quotes */
expectEqual('market tape: prints, after hours, crosses, spread legs, compression', [mktFacts.prints, mktFacts.extended, mktFacts.cross, mktFacts.spreadLeg, mktFacts.compression], [500, 3, 0, 184, 0]);
expectEqual('market tape: quote crossed / stale, no read, crownable', [mktFacts.crossed, mktFacts.stale, mktFacts.noRead, mktFacts.crownable], [2, 1, 201, 316]);
const mktSum = summarizeTape(regular);
say('mktSum', { bull: mktSum.bullPremium, bear: mktSum.bearPremium, calls: mktSum.callPremium, puts: mktSum.putPremium, sweeps: mktSum.sweeps, blocks: mktSum.blocks, legs: mktSum.spreadLegs, crosses: mktSum.crosses, largest: mktSum.largest });
/* the regular prints' premium summed by call/put, and by side (ask-call or bid-put bullish) over the prints that read */
expectNear('market tape: bullish premium', mktSum.bullPremium, 61249, 1e-9);
expectNear('market tape: bearish premium', mktSum.bearPremium, 138158, 1e-9);
expectNear('market tape: call premium', mktSum.callPremium, 365791, 1e-9);
expectNear('market tape: put premium', mktSum.putPremium, 501144, 1e-9);
expectEqual('market tape: spread legs set apart', [mktSum.spreadLegs.count, Math.round(mktSum.spreadLegs.premium)], [184, 659289]);
expectEqual('market tape: largest crownable print', mktSum.largest, { ticker: 'QQQ', strike: 725, right: 'C', premium: 27000 });

/* SPY's last 500 prints before its 16:15 close */
const spy = await T.readTapePage({ ticker: 'SPY' }, { olderThan: close.closeMs }, 500);
const spyFacts = {
  prints: spy.prints.length,
  extended: count(spy.prints, p => !!p.extended),
  spreadLeg: count(spy.prints, p => isSpreadLeg(p)),
  noRead: count(spy.prints, p => sentimentOf(p) === 'NEUTRAL'),
  ask: count(spy.prints, p => p.side === 'ASK'),
  bid: count(spy.prints, p => p.side === 'BID'),
};
say('spyFacts', spyFacts);
/* the same rules over SPY's raw rows; the side is the tag unless the quote contradicts it */
expectEqual('SPY tape: prints, after hours, legs, no read, ask, bid', [spyFacts.prints, spyFacts.extended, spyFacts.spreadLeg, spyFacts.noRead, spyFacts.ask, spyFacts.bid], [500, 0, 42, 59, 197, 283]);
const spySum = summarizeTape(spy.prints.filter(p => !p.extended));
say('spySum', { bull: spySum.bullPremium, bear: spySum.bearPremium, calls: spySum.callPremium, puts: spySum.putPremium, largest: spySum.largest });
expectEqual('SPY tape: bull, bear, calls, puts', [spySum.bullPremium, spySum.bearPremium, spySum.callPremium, spySum.putPremium].map(Math.round), [190079, 169433, 132473, 245827]);
expectEqual('SPY tape: largest crownable print', spySum.largest, { ticker: 'SPY', strike: 775, right: 'C', premium: 52320 });

/* compression: the session's last cbmo / mctp prints */
const comp = await T.readTapePage({ codes: ['cbmo', 'mctp'] }, { olderThan: close.closeMs }, 100);
const compSum = summarizeTape(comp.prints);
say('comp', { prints: comp.prints.length, compression: compSum.compression, bull: compSum.bullPremium, bear: compSum.bearPremium, largest: compSum.largest });
/* all 100 raw rows carry cbmo/mctp: every one is compression, none reads bullish or bearish, none is crowned */
expectEqual('compression: count, premium, in no lean, never largest', [compSum.compression.count, Math.round(compSum.compression.premium), compSum.bullPremium, compSum.bearPremium, compSum.largest], [100, 25384547, 0, 0, null]);

/* the day's $5M+ alerts: floor packages are set apart */
const alerts = await T.readDayAlerts(preOpen, close.closeMs, 'regular', 5_000_000, 200);
say('alerts', { n: alerts.length, floor: count(alerts, p => !!p.floorPackage), prem: alerts.reduce((a, p) => a + p.premium, 0), top: alerts[0] && `${alerts[0].ticker} ${alerts[0].strike}${alerts[0].right} ${alerts[0].premium}` });
/* alerts starting 09:30 to the name's close; a floor package is a no-side alert sharing its root and start ms with another contract */
expectEqual('$5M+ alerts: count, floor packages, premium, largest', [alerts.length, count(alerts, p => !!p.floorPackage), Math.round(alerts.reduce((a, p) => a + p.premium, 0)), alerts[0]?.ticker, alerts[0]?.premium], [14, 2, 101284706, 'MU', 21110010]);

/* ---- 2. multi-leg settlement on real rows -------------------------------------------------------------------- */
const spreads = await T.readSpreads(200, null, close.closeMs, 'regular');
const spySpreads = await T.readSpreads(80, 'SPY', close.closeMs, 'regular');
const pick = [...spreads.filter(t => t.netKnown !== false).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium)).slice(0, 8), ...spySpreads.filter(t => t.netKnown !== false).sort((a, b) => Math.abs(b.netPremium) - Math.abs(a.netPremium)).slice(0, 4)];
const settled = new Map<string, ReturnType<typeof T.settleSpreadWith>>();
for (const t of pick) {
  const raw = await T.readLegRows(t.id);
  const s = T.settleSpreadWith(t, raw.length ? raw : 'none');
  settled.set(t.id, s);
  say(`spread ${t.id}`, { ticker: s.ticker, vendor: s.shapeOfVendor, shape: s.shape, kind: s.kind, net: s.netPremium, dirs: s.legs.map(l => `${l.side ?? '?'}${l.contracts}${l.right}${l.strike}`), maxLoss: s.maxLoss, maxProfit: s.maxProfit, unverified: !!s.unverified, units: s.units, vendorDirection: s.vendorDirection, vendorRisk: s.vendorRisk });
}
/* each: the one buy/sell set of the raw legs whose fill × size × 100 sums to net_premium within 3% (brute force over
   every sign), then the expiry payoff at 0, each strike and past the top strike; the vendor's max_loss agrees on all */
const legsOf = (id: string) => {
  const s = settled.get(id);
  return s ? { shape: s.shape, dirs: s.legs.map(l => `${l.side === 'BUY' ? 'B' : l.side === 'SELL' ? 'S' : '?'}${l.contracts}${l.right}${l.strike}`), maxLoss: s.maxLoss, maxProfit: s.maxProfit, unverified: !!s.unverified } : null;
};
expectEqual('multi-leg SPX "iron condor": two puts sold, two calls bought, renamed, unverified', legsOf('01a18426-dbec-7f42-9031-bab53f950023'), { shape: 'custom · 2 bought, 2 sold', dirs: ['S155P7690', 'S155P7695', 'B155C7795', 'B155C7800'], maxLoss: 238378220, maxProfit: 'uncapped', unverified: true });
expectEqual('multi-leg SPX strangle: long, risk = the debit', legsOf('01a18426-765c-7280-ad1f-c51a08512061'), { shape: 'long strangle', dirs: ['B14P7640', 'B14C7840'], maxLoss: 58100, maxProfit: 'uncapped', unverified: false });
expectEqual('multi-leg QQQ "call ladder": every leg bought, renamed, unverified', legsOf('01a18426-c095-7971-ab8b-66c86919f41c'), { shape: 'calls bought · 3 strikes', dirs: ['B43C728', 'B43C729', 'B43C730'], maxLoss: 24295, maxProfit: 'uncapped', unverified: true });
expectEqual('multi-leg SPX put vertical: bull put spread', legsOf('01a18426-c095-7971-ab8b-661fc51c8b8f'), { shape: 'bull put spread', dirs: ['B250P7690', 'S250P7695'], maxLoss: 102500, maxProfit: 22500, unverified: false });
expectEqual('multi-leg SPY call vertical: bull call spread', legsOf('01a18425-9b9c-70c3-a605-deeafc192dd2'), { shape: 'bull call spread', dirs: ['B100C767', 'S100C771'], maxLoss: 26400, maxProfit: 13600, unverified: false });
expectEqual('multi-leg SPY "put ratio": both strikes sold, renamed, unverified', legsOf('01a18425-da1d-7331-8e7e-aae747ceb3ee'), { shape: 'puts sold · 2 strikes', dirs: ['S20P755', 'S10P775'], maxLoss: 2260750, maxProfit: 24250, unverified: true });
expectEqual('multi-leg SPY "call diagonal": both sold, two expiries, no single-expiry risk', legsOf('01a18426-2455-78b1-9c8b-07e56e3acc60'), { shape: 'calls sold · 2 expiries', dirs: ['S3C700', 'S3C775'], maxLoss: null, maxProfit: null, unverified: true });

/* ---- 3. net flow: the board, the market tide, a name's session ------------------------------------------------ */
const board = await T.readTopNet(40);
const sums = boardSums(board);
say('board', { n: board.length, ...sums, top: board[0], bottom: board[board.length - 1] });
/* net_premium of the 40 rows summed above and below zero */
expectEqual('net flow board: names, bullish sum, bearish sum, bullish names, ends', [board.length, Math.round(sums.calls), Math.round(sums.puts), sums.bullish, board[0].ticker, board[board.length - 1].ticker], [40, 325633173, -247890832, 20, 'MU', 'META']);
const tide = await T.readTide('/market/market-tide?interval_5m=false');
const tideNet = T.tideBetween(tide, 570, 975);
say('tide', tideNet);
/* the tide's running net at its last minute before 16:15 (16:14) less its last minute before 09:30 */
expectEqual('market net (tide 09:30-16:15): calls, puts, net', [tideNet?.calls, tideNet?.puts, tideNet?.net].map(v => Math.round(v ?? NaN)), [94660581, -80659064, 175319645]);
const MINUTES: Record<string, number[]> = { SPY: [405, 19019718, -739991, 3739722, 4110452], NVDA: [390, -20892826, 19441003, 1303964, 934897] };
for (const name of ['SPY', 'NVDA']) {
  const mins = await T.readNameMinutes(name);
  const calls = mins.reduce((a, m) => a + m.netCall, 0);
  const puts = mins.reduce((a, m) => a + m.netPut, 0);
  say(`minutes ${name}`, { n: mins.length, calls, puts, callVol: mins.reduce((a, m) => a + m.callVol, 0), putVol: mins.reduce((a, m) => a + m.putVol, 0) });
  /* the ticks from 09:30 to the name's close (16:15 SPY, 16:00 NVDA), net premium and volume summed */
  expectEqual(`${name} session: minutes, net calls, net puts, call vol, put vol`, [mins.length, calls, puts, mins.reduce((a, m) => a + m.callVol, 0), mins.reduce((a, m) => a + m.putVol, 0)].map(Math.round), MINUTES[name]);
  /* the Net Flow pane's running line ends on the same session sums */
  const ticks = (await uwCall(`/stock/${name}/net-prem-ticks`)).data as Record<string, unknown>[];
  const pane = T.paneFromTicks(name, ticks, []);
  const end = pane[pane.length - 1];
  expectEqual(`${name} pane: points, running net calls, running net puts at the close`, [pane.length, Math.round(end.callPrem), Math.round(end.putPrem)], MINUTES[name].slice(0, 3));
}

/* ---- 4. the Screener's head for SPY and NVDA, and the market book ------------------------------------------- */
const BOOK: Record<string, number[]> = {
  SPY: [200, 1017830717, 50, 102, 1, 82488995, 27],
  NVDA: [200, 432557421, 66, 71, 1, 65569578, 32],
  market: [200, 3612705132, 57, 87, 14, 6079750536, 97],
};
for (const [label, q] of [
  ['SPY', 'ticker_symbol=SPY&limit=200&order=premium&order_direction=desc'],
  ['NVDA', 'ticker_symbol=NVDA&limit=200&order=premium&order_direction=desc'],
  ['market', 'limit=200&order=premium&order_direction=desc'],
] as const) {
  const rows = await T.readBook(q);
  const f = bookFacts(rows);
  say(`book ${label}`, { rows: rows.length, ...f, floor: rows.filter(floorPackaged).length, legs: rows.filter(spreadLegDay).length, crosses: rows.filter(crossDay).length, notABet: rows.filter(notABet).length });
  /* raw rows: not a bet when floor/multileg/cross volume is half the volume or more; the rest's premium, call share,
     names and volume >= 1.5x open_interest */
  expectEqual(`Screener ${label}: rows, premium, call %, vol>=1.5xOI, names, set-apart premium, set apart`, [rows.length, Math.round(f.prem), f.callPct, f.fresh, f.names, Math.round(f.apartPrem), f.apart], BOOK[label]);
}

/* ---- 5. 0DTE: the market's same-day cut, and SPY's and QQQ's same-day expiry --------------------------------- */
const zero = await T.readPaneCut('all', 'all', true);
const zl = zero[zero.length - 1];
say('zero', { n: zero.length, calls: zl?.callPrem, puts: zl?.putPrem, last: zl?.time });
/* the cut's last minute with figures (15:59 ET): its running net call and put premium */
expectEqual('0DTE market: minutes, net calls, net puts, last minute', [zero.length, zl?.callPrem, zl?.putPrem, zl?.time], [390, 12696327.5, -1001033, Date.parse('2026-10-28T19:59:00Z') / 1000]);
const FPE: Record<string, number[]> = { SPY: [2601625, -3123390, 2641653, 2656704], QQQ: [10981587, 3295678, 1466852, 1545493] };
for (const name of ['SPY', 'QQQ']) {
  const fpe = await T.readFlowPerExpiry(name);
  const day = fpe.filter(e => e.expiry === close.iso);
  say(`fpe ${name}`, { expiries: fpe.length, zero: day });
  /* the Oct 28 expiry row: ask-side less bid-side premium for calls and puts, and the volumes */
  expectEqual(`0DTE ${name}: net calls, net puts, call vol, put vol`, day.length === 1 ? [day[0].callNet, day[0].putNet, day[0].callVol, day[0].putVol].map(Math.round) : null, FPE[name]);
}

/* ---- 6. known numbers: one rule per figure, against hand-worked rows ------------------------------------------ */
const { darkPrint } = await import('../../src/data/traceLive');
const { postureOf, darkPosture, darkSizedFloor } = await import('../../src/data/traceDark');
const { noteAdv } = await import('../../src/data/traceRows');
const { printKind } = await import('../../src/data/tape');
const { buildCatches } = await import('../../src/data/flowBook');
{
  /* a regular-session dark print 1¢ over (or under) a 9.99 × 10.01 quote, its dollars as given */
  const dp = (ticker: string, over: boolean, usd: number, k: number) =>
    darkPrint({ ticker, price: over ? '10.01' : '9.99', size: Math.round(usd / 10), premium: String(usd), nbbo_bid: '9.99', nbbo_ask: '10.01', executed_at: `2026-10-28T15:${String(10 + k).padStart(2, '0')}:00Z`, tracking_id: `${ticker}${k}` }, k);
  /* six $588K paid over the mid, six $412K sold under: (3.528M − 2.472M) / 6M = 17.6% — under the 18% edge, Balanced
     on Trace and Dossier alike (Trace rounded it to 18 and read Accumulating) */
  const set = [...Array.from({ length: 6 }, (_, k) => dp('ZZZ', true, 588_000, k)), ...Array.from({ length: 6 }, (_, k) => dp('ZZZ', false, 412_000, k + 6))];
  const t = postureOf(set);
  const d = darkPosture(set);
  expectEqual('dark posture at a 17.6% net: Trace and Dossier both Balanced, unrounded', [t.posture, d.posture, Number(t.net.toFixed(1)), Number(d.net.toFixed(1)), t.read], ['BALANCED', 'BALANCED', 17.6, 17.6, 12]);
  /* five prints all over the mid are too few (12) to read on either page — Trace read them Accumulating */
  const few = postureOf(set.slice(0, 5));
  expectEqual('dark posture on 5 prints: too few to read', [few.posture, few.read, few.enough], ['BALANCED', 5, false]);
  /* NVDA's ~$36B average day: its sized line is a second of it, $1,538,462; a $1M NVDA print is not read, a ZZZ one is */
  noteAdv('NVDA', 36e9);
  expectEqual('dark sized line: a second of the average day, $250K at the least', [Math.round(darkSizedFloor(36e9)), darkSizedFloor(20e6), darkSizedFloor(null)], [1538462, 250000, 250000]);
  expectEqual('dark posture reads a $1M print on ZZZ, not on NVDA', [darkPosture([dp('NVDA', true, 1_000_000, 20)], { minPrints: 1 }).read.length, darkPosture([dp('ZZZ', true, 1_000_000, 21)], { minPrints: 1 }).read.length], [0, 1]);
}
{
  /* a block needs both lines: 100 contracts AND $50K — a 100-lot at $0.05 ($500) and a 20-lot for $300K are single prints */
  const k = (size: number, premium: number) => printKind({ sweep: false, legs: 1, strat: '—', size, premium });
  expectEqual('print kind: 100 × $0.05, 20 for $300K, 100 for $60K', [k(100, 500), k(20, 300_000), k(100, 60_000)], ['SINGLE', 'SINGLE', 'BLOCK']);
  /* big money: $25M at the least, a thousandth of the name's average dollar day where that is more (NVDA's $36B: $36M) */
  const row = (ticker: string) => ({ key: `${ticker}-big`, ticker, premium: 30_000_000, volume: 1, volOverOI: 0, sweepPct: 0, chgPct: 0, floorPct: 0, multiPct: 0, askPct: 50, earnDays: null, deltaOI: 0, lastAtMin: 600, lastAt: '10:00', last: 1 }) as never;
  const caught = buildCatches([row('NVDA'), row('ZZZ')]).filter(c => c.rules.includes('big-money')).map(c => c.row.ticker);
  expectEqual('big money at $30M: ZZZ yes, NVDA (line $36M) no', caught, ['ZZZ']);
  /* one set of cuts: legs at half the day in multi-leg orders, swept at a quarter — on the card and every reason. A day
     40% legs and 27% swept is not a spread-leg card (it was, at 30%) but is a swept one (it was not, at 40%), and
     12,000 contracts 27% swept is hammering (it needed 30%) */
  const { bookRowToPrint } = await import('../../src/data/tape');
  const day = { ...(row('QQQ') as object), right: 'C', strike: 1, expiry: '12/17/2027', dte: 400, otmPct: 1, spot: 1, oi: 1, iv: 20, theta: 0, volume: 12_000, premium: 1_000_000, multiPct: 40, sweepPct: 27, sideVol: { ask: 6000, bid: 3000, mid: 3000 } } as never;
  const card = bookRowToPrint(day);
  expectEqual('day card at 40% legs, 27% swept: not legs, swept', [card.legs, card.sweep], [1, true]);
  expectEqual('hammering at 12,000 contracts, 27% swept', buildCatches([day]).flatMap(c => c.rules), ['hammering']);
}
{
  /* the side inside the spread: within a fifth of it from a side counts to that side, the middle stays mid; a locked
     quote says nothing (execOf read a fill at a locked 1.00 × 1.00 as ASK while sideOfTags read MID) */
  const { execOf, sideOfTags, printSideOf, tradeToPrint, printKeyOf } = await import('../../src/data/traceRows');
  expectEqual('fill inside 1.00 × 1.10 at 1.09, 1.01, 1.05; locked at 1.00', [execOf(1.09, 1, 1.1), execOf(1.01, 1, 1.1), execOf(1.05, 1, 1.1), execOf(1, 1, 1), sideOfTags([], 1, 1, 1)], ['ASK', 'BID', 'MID', 'MID', 'MID']);
  expectEqual('a mid_side tag at 1.09 of 1.00 × 1.10 reads ASK; no_side stays MID', [sideOfTags(['mid_side'], 1.09, 1, 1.1), sideOfTags(['no_side'], 1.09, 1, 1.1)], ['ASK', 'MID']);
  /* a cross is no read on every page (the contract card sided it by its tag) */
  const cross = { tags: ['ask_side'], report_flags: ['cross_trade'], price: '1.10', nbbo_bid: '1.00', nbbo_ask: '1.10', executed_at: '2026-10-28T15:00:00Z' };
  expectEqual('a cross trade at the ask: MID', printSideOf(cross, 1.1, 1, 1.1, Date.parse(cross.executed_at)), 'MID');
  /* a row with no vendor id is the same print on any page: its id is its content, not its index */
  const bare = { underlying_symbol: 'ZZZ', option_chain_id: 'ZZZ271217C00010000', executed_at: '2026-10-28T15:00:00.123Z', price: '1.05', size: 10, premium: '1050', nbbo_bid: '1.00', nbbo_ask: '1.10', strike: '10', option_type: 'call', expiry: '2027-12-17' };
  expectEqual('an id-less print read at index 0 and at index 7: one id', tradeToPrint(bare, 0).id === tradeToPrint(bare, 7).id && printKeyOf(bare) === tradeToPrint(bare, 3).vendorId, true);
  const darkBare = { ticker: 'ZZZ', executed_at: '2026-10-28T15:00:00Z', price: '10', size: 100000, premium: '1000000', volume: 5 };
  expectEqual('an id-less dark print at index 0 and 7: one id', darkPrint(darkBare, 0).id === darkPrint(darkBare, 7).id, true);
  /* a cancel that lands after its print merged takes it back out of the tape and the dark accumulator */
  const { mergePrints, noteCancelled } = await import('../../src/data/traceLive');
  const { mergeDark } = await import('../../src/data/traceDark');
  const a = tradeToPrint({ ...bare, id: 'trade-a' });
  const b = tradeToPrint({ ...bare, id: 'trade-b', executed_at: '2026-10-28T15:00:01Z' });
  const held = mergePrints([], [a, b], 'front');
  noteCancelled([{ ...bare, id: 'trade-a', canceled: true }]);
  expectEqual('tape after trade-a is cancelled: trade-b alone', mergePrints(held, [], 'front').map(p => p.vendorId), ['trade-b']);
  const d1 = darkPrint({ ...darkBare, tracking_id: 1 }, 0);
  const d2 = darkPrint({ ...darkBare, tracking_id: 2 }, 1);
  expectEqual('dark accumulator after print 1 is cancelled: print 2 alone', mergeDark(mergeDark([], [d1, d2]), [], new Set([d1.id])).map(p => p.id), [d2.id]);
  /* a one-minute bar's volume is its own, never the day's running total_volume: 1,000 then 1,500 running, then a bar of
     0, read 1,000 · 1,500 · 1,500; now 0 (no bar before it) · 500 · 0 */
  const { parseTape } = await import('../../src/data/book/tape');
  const bars = [
    { open: 1, high: 1, low: 1, close: 1, total_volume: 1000, start_time: '2026-10-28T13:30:00Z' },
    { open: 1, high: 1, low: 1, close: 1, total_volume: 1500, start_time: '2026-10-28T13:31:00Z' },
    { open: 1, high: 1, low: 1, close: 1, volume: 0, total_volume: 1500, start_time: '2026-10-28T13:32:00Z' },
  ];
  expectEqual('one-minute bar volumes off a running total', parseTape(bars).map(c => c.volume), [0, 500, 0]);
}
{
  /* every net figure says what it covers: the tide from 09:30 (the window's base) to its last minute, a name's pane from
     its own 09:30 tick, the tape's net with what it leaves out */
  expectEqual('market tide 09:30–16:15: covers', tideNet?.covers, { since: '09:30', until: '16:14', source: 'market tide', leaves: [] });
  const spyTicks = (await uwCall('/stock/SPY/net-prem-ticks')).data as Record<string, unknown>[];
  expectEqual("SPY pane: covers", T.paneCovers('SPY', T.paneFromTicks('SPY', spyTicks, [])), { since: '09:30', until: '16:14', source: 'net-prem-ticks', leaves: ['pre-market', 'after 16:15 ET'] });
  expectEqual('market tape summary: covers', [mktSum.covers.source, mktSum.covers.leaves], ['the prints in hand', ['spread legs', 'crosses', 'compression', 'mid prints', 'after hours']]);
  /* Compare's headline obeys the money cut: on OTM it is the cut's own contracts (≈ premium × (ask − bid) share) — an
     OTM call of $1M at 600/200/200 is +$400K, an OTM put of $500K at 100/300/100 −$200K, net +$600K; the every-strike
     expiry route's +$8M is not the cut's (it read +$8M on every cut) */
  const { buildTraceSide } = await import('../../src/data/traceCompare');
  const otm = (right: 'C' | 'P', premium: number, sv: { ask: number; bid: number; mid: number }) => ({ key: `SPY-${right}`, ticker: 'SPY', right, strike: right === 'C' ? 800 : 700, otmPct: 3, dte: 10, expiry: '11/07/2026', premium, volume: sv.ask + sv.bid + sv.mid, sideVol: sv, askPct: (100 * sv.ask) / (sv.ask + sv.bid), multiPct: 0, floorPct: 0, sweepPct: 0, iv: 20, oi: 1, volOverOI: 1, deltaOI: 0 }) as never;
  const itm = { ...(otm('C', 9_000_000, { ask: 900, bid: 0, mid: 100 }) as object), key: 'SPY-ITM', otmPct: -5 } as never;
  const fpe = [{ expiry: '2026-11-07', date: '2026-10-28', dte: 10, callNet: 9_000_000, putNet: 1_000_000, callVol: 1, putVol: 1, trades: 1 }];
  const side = buildTraceSide([otm('C', 1_000_000, { ask: 600, bid: 200, mid: 200 }), otm('P', 500_000, { ask: 100, bid: 300, mid: 100 }), itm], [], [], 'SPY', 'all', 'otm', fpe, '2026-10-28');
  const every = buildTraceSide([otm('C', 1_000_000, { ask: 600, bid: 200, mid: 200 })], [], [], 'SPY', 'all', 'all', fpe, '2026-10-28');
  expectEqual('Compare net on OTM: the cut\'s contracts, ≈; on all strikes: the expiry route', [Math.round(side.net), side.netCovers.approx, every.net, every.netCovers.source], [600_000, true, 8_000_000, 'flow by expiry']);
  /* no call premium is no P/C ratio (it read 0) */
  const putsOnly = summarizeTape(spy.prints.filter(p => p.right === 'P' && !p.extended));
  expectEqual('P/C with no calls: no ratio', Number.isNaN(putsOnly.pcRatio), true);
}
{
  /* the day's big alerts walked to the day's start before the largest are picked: the 14 are the whole day */
  expectEqual("$5M+ alerts: the day's whole list, not the newest page", (alerts as { complete?: boolean }).complete, true);
  /* a name at exactly zero net is neither bullish nor bearish (it counted bearish) */
  const bs = boardSums([{ ticker: 'A', net: 5 }, { ticker: 'B', net: 0 }, { ticker: 'C', net: -3 }]);
  expectEqual('board of +5, 0, −3: bullish, bearish, neutral', [bs.bullish, bs.bearish, bs.neutral], [1, 1, 1]);
  /* an alert's bid share is of its sided money, as a print's is of its sided contracts: $600K ask, $200K bid, $200K
     other is 25% (it read 20% of the whole) */
  const { alertToPrint } = await import('../../src/data/traceRows');
  const al = alertToPrint({ id: 'al-1', ticker: 'ZZZ', type: 'call', strike: '10', expiry: '2027-12-17', total_ask_side_prem: '600000', total_bid_side_prem: '200000', total_premium: '1000000', total_size: 100, price: '1.05', bid: '1.00', ask: '1.10', start_time: Date.parse('2026-10-28T15:00:00Z'), created_at: '2026-10-28T15:00:05Z' });
  expectEqual('alert bid share of the sided premium', al.ratioBidPct, 25);
}
{
  /* insiders: the buyer cluster counts the buyers whose buys count — a planned buy and a fund's are not chosen ones */
  const { summariseFlow } = await import('../../src/data/insiders');
  const tr = (person: string, plan: string, entity = false) => ({ code: 'P', kind: 'BUY', plan, entity, person, value: 100_000, daysAgo: 3 }) as never;
  const f = summariseFlow('ZZZ', [tr('A', 'discretionary'), tr('B', 'plan'), tr('C', 'discretionary', true)], 30);
  expectEqual('insider buyer cluster: one chosen buyer of three', [f.buyerCluster, f.openMarketBuys], [1, 100_000]);
  /* congress: the median of 10, 20, 30, 40 days is 25 (it read the upper middle, 30) */
  const { summariseCongress } = await import('../../src/data/congress');
  const cg = summariseCongress([10, 20, 30, 40].map(lagDays => ({ lagDays, bracket: null, type: 'Purchase', late: false }) as never), 365);
  expectEqual('congress median lag of 10, 20, 30, 40 days', cg.medianLag, 25);
}

void stockClose;
done();
