/*
  Compass on a stale feed (2026-11-06, "FIX COMPASS"):
    A  09:35–10:15 ET every mark scored nothing: the option snapshot answered every name, but its rows' own stamps lagged
       real time by minutes (5–8 min at 09:41 and 09:46, stock prints current), so no quote was inside 90 s and every
       name read "quiet". The same on 2026-11-05 11:45–12:10. Now the stale snapshot is named (Snap.stale, the engine's
       FeedHealth, the Status rows and the board say "stale snapshots"), and the name is read from a current source
       (the quote snapshot, else the quotes recorded at this instant), each row checked on its own stamp; the stale
       rows are never used. An answer that waited for a slot is not "from the future".
    S  the engine's reads go ahead of every page's and always find two of the terminal's eight slots free
       (server/thetaSlots.mjs).
    F  10:21–10:31 the record filled and closed calls on a frozen copy: the minute history answered every row from some
       minute to the present with one quote, sizes and all (caught live at 10:53:16 on MU 680P; MU 710P "filled" at
       09:51's 7.10/7.45 at 10:22 against a real 17.05/17.65). A frozen tail is cut before the call is settled; a
       1-second window that disagrees with both its minute ends is not kept.
    M  the scan's mids 5 and 15 minutes back came from the same frozen copy (every 10:20 call read one mid at 10:05
       and 10:15): a frozen seed window is a fault, so a live mark does not score on it.
  Run: npx tsx scripts/compass-feed-proof.ts
*/

import { nyParts, nyWallTime } from '../src/core/nyTime';
import { setCompassHost, type ThetaAnswer } from '../src/data/compassHost';
import { feedAfter, freshFeed, once } from '../src/data/compassScan';
import { fineAgrees, frozenTail, ret5At, settleSignal, trustedPath, type PathQuote } from '../src/data/compassOutcome';
import { maxOpenCalls, setGroupBSwitch, setMaxOpenCalls } from '../src/data/compassParams';
import * as ledger from '../src/data/compassLedger';
import { chainFrozen } from '../src/data/compassModel';
import { compassRow, pathRow, type OptionStaleness } from '../src/data/statusModel';
import { createSlots } from '../server/thetaSlots.mjs';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
};
const two = (n: number) => String(n).padStart(2, '0');
const wall = (ms: number) => {
  const p = nyParts(ms);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}.${String(ms % 1000).padStart(3, '0')}`;
};
const at = (h: number, m: number, s = 0) => nyWallTime(2026, 11, 6, h, m) + s * 1000;

/* ---- A: a snapshot three minutes stale ---- */
const NOW = at(9, 45, 10);
const STRIKES = [732, 734, 736, 738, 740, 742, 744];
const SPOT = 738.2;
/* the stale snapshot's prices are the ones from three minutes before; the current sources' are the market's now */
const chainRows = (stamp: number, px: (k: number, right: 'C' | 'P') => number, greeks: boolean, under: boolean) =>
  STRIKES.flatMap(k => (['C', 'P'] as const).map(right => {
    const mid = px(k, right);
    return {
      contract: { symbol: 'SPY', strike: k, right: right === 'C' ? 'CALL' : 'PUT', expiration: '2026-11-06' },
      data: [{
        bid: Number((mid - 0.01).toFixed(2)), ask: Number((mid + 0.01).toFixed(2)), bid_size: 20, ask_size: 30, timestamp: wall(stamp),
        ...(under ? { underlying_price: SPOT } : {}),
        ...(greeks ? { delta: right === 'C' ? 0.5 : -0.5, theta: -40, vega: 20, rho: 1, implied_vol: 0.2, lambda: 50, epsilon: -1 } : {}),
      }],
    };
  }));
const stalePx = (k: number, right: 'C' | 'P') => Math.max(0.2, (right === 'C' ? 742 - k : k - 734) * 0.5 + 2);
const freshPx = (k: number, right: 'C' | 'P') => Math.max(0.2, (right === 'C' ? SPOT - k : k - SPOT) + 3);

type Answer = (path: string) => ThetaAnswer | Promise<ThetaAnswer>;
let answer: Answer = () => ({ status: 472, data: null, error: 'no_data' });
const asked: string[] = [];
setCompassHost({ server: true, theta: async p => { asked.push(p); return answer(p); }, asset: async () => null, econ: () => [] });

const greeksStale = (p: string): ThetaAnswer | null => (p.startsWith('/option/snapshot/greeks/first_order') ? { status: 200, data: chainRows(NOW - 180_000, stalePx, true, true), error: null } : null);
const stock = (p: string): ThetaAnswer | null => (p.startsWith('/stock/snapshot/quote') ? { status: 200, data: [{ bid: SPOT - 0.01, ask: SPOT + 0.01, timestamp: wall(NOW - 1_000) }], error: null } : null);
const none: ThetaAnswer = { status: 472, data: null, error: 'no_data' };

{
  /* before: the greeks snapshot alone, as the scan read it (no current source answers) */
  answer = p => greeksStale(p) ?? none;
  const before = await once('SPY', NOW, '2026-11-06', true);
  check('A before: a snapshot 3 minutes stale scores 0 setups (the blind window), and now says it is stale', before.setups.length === 0 && before.rows === STRIKES.length * 2 && before.stale === true && !before.source, { setups: before.setups.length, rows: before.rows, stale: before.stale });
  check('A the lag is measured from the rows\' own stamps: 180 s', before.lagMs === 180_000, before.lagMs);

  /* after: the quote snapshot is current */
  asked.length = 0;
  answer = p => greeksStale(p) ?? stock(p) ?? (p.startsWith('/option/snapshot/quote') ? { status: 200, data: chainRows(NOW - 2_000, freshPx, false, false), error: null } : none);
  const after = await once('SPY', NOW, '2026-11-06', true);
  const staleMids = new Set(STRIKES.flatMap(k => [stalePx(k, 'C'), stalePx(k, 'P')].map(v => v.toFixed(2))));
  check('A after: the names are scored on the current quote snapshot (14 setups)', after.setups.length === STRIKES.length * 2 && after.source === 'quote' && after.stale === true, { setups: after.setups.length, source: after.source });
  check('A every setup is the current quote: its mid, its stamp 2 s before the ask, the live spot', after.setups.every(s => Math.abs(s.mid - freshPx(s.strike, s.right)) < 1e-9 && s.quotedAt === NOW - 2_000 && s.spot === SPOT), after.setups.map(s => [s.contract, s.mid, s.quotedAt === NOW - 2_000, s.spot]).slice(0, 3));
  check('A no setup carries a stale price', after.setups.every(s => !staleMids.has(s.mid.toFixed(2)) || Math.abs(s.mid - freshPx(s.strike, s.right)) < 1e-9));
  const atm = after.setups.find(s => s.strike === 738 && s.right === 'C');
  check('A the current rows carry no greeks: they are priced locally from the mid (IV solved, delta near 0.5 at the money)', !!atm && atm.greeks.iv > 0 && atm.greeks.delta > 0.4 && atm.greeks.delta < 0.7 && atm.greeks.theta < 0, atm?.greeks);
  check('A the quote snapshot was asked after the greeks snapshot, once', asked.filter(p => p.startsWith('/option/snapshot/quote')).length === 1 && asked[0].startsWith('/option/snapshot/greeks/first_order'), asked);

  /* the quote snapshot is stale too (2026-11-05): the quotes recorded at this instant, each row on its own stamp */
  asked.length = 0;
  answer = p => greeksStale(p) ?? stock(p)
    ?? (p.startsWith('/option/snapshot/quote') ? { status: 200, data: chainRows(NOW - 150_000, stalePx, false, false), error: null } : null)
    ?? (p.startsWith('/option/at_time/quote') ? { status: 200, data: chainRows(NOW - 2_400, freshPx, false, false), error: null } : none);
  const recorded = await once('SPY', NOW, '2026-11-06', true);
  const atTime = asked.find(p => p.startsWith('/option/at_time/quote')) ?? '';
  check('A both snapshots stale: scored on the quotes recorded 2 s before the ask', recorded.setups.length === STRIKES.length * 2 && recorded.source === 'at_time' && /time_of_day=09:45:08\.000/.test(atTime) && /start_date=20261106/.test(atTime), { n: recorded.setups.length, source: recorded.source, atTime });

  /* nothing current anywhere: not scored, and said */
  answer = p => greeksStale(p) ?? stock(p)
    ?? (p.startsWith('/option/snapshot/quote') || p.startsWith('/option/at_time/quote') ? { status: 200, data: chainRows(NOW - 150_000, stalePx, false, false), error: null } : none);
  const blind = await once('SPY', NOW, '2026-11-06', true);
  check('A no current source: 0 setups, stale, no source (never the stale rows)', blind.setups.length === 0 && blind.stale === true && !blind.source);

  /* a current snapshot: nothing else is asked */
  asked.length = 0;
  answer = p => (p.startsWith('/option/snapshot/greeks/first_order') ? { status: 200, data: chainRows(NOW - 800, freshPx, true, true), error: null } : none);
  const live = await once('SPY', NOW, '2026-11-06', true);
  check('A a current snapshot: scored as before, one ask, not stale', live.setups.length === STRIKES.length * 2 && !live.stale && !live.source && asked.length === 1);

  /* an answer that waited for a slot: its stamps are after the ask, up to the receipt (was dropped as "future") */
  const asking = Date.now() - 70_000;
  answer = p => (p.startsWith('/option/snapshot/greeks/first_order') ? { status: 200, data: chainRows(Date.now() - 500, freshPx, true, true), error: null } : none);
  const waited = await once('SPY', asking, '2026-11-06', true);
  check('A an answer 70 s after its ask, stamped at its receipt, is kept (was dropped: a busy terminal read as a quiet book)', waited.setups.length === STRIKES.length * 2 && !waited.stale, waited.setups.length);

  /* the engine's health line */
  const h = feedAfter(freshFeed(), at(9, 45), [
    { symbol: 'SPY', stale: true, lagMs: 180_000, source: 'quote', scored: true },
    { symbol: 'QQQ', stale: true, lagMs: 300_000, scored: false },
    { symbol: 'IWM', stale: false, lagMs: 0, scored: true },
  ]);
  check('A feed health: stale since the mark, the worst lag, who fell back, who is blind', h.state === 'stale' && h.since === at(9, 45) && h.lagMs === 300_000 && h.fallback.join() === 'SPY' && h.blind.join() === 'QQQ', h);
  const h2 = feedAfter(h, at(9, 46), [{ symbol: 'SPY', stale: true, lagMs: 120_000, source: 'quote', scored: true }]);
  check('A feed health keeps its first stale mark; a mark with every name current is fresh again', h2.since === at(9, 45) && feedAfter(h2, at(9, 47), [{ symbol: 'SPY', stale: false, lagMs: 0, scored: true }]).state === 'fresh');
  const t = at(9, 45, 30);
  const quotesUp = { condition: 'up' as const, okAt: t - 2_000, dataAt: null, failAt: 0, failSince: 0, why: '', login: false };
  const row = pathRow('quotes', quotesUp, t, h as OptionStaleness);
  check('A Status: "Live quotes" is degraded with stale option quotes (was "answering")', row.state === 'degraded' && /option quotes 5 min(utes)? behind/.test(row.line) && /since 09:45/.test(row.line), row.line);
  check('A Status: a fresh feed leaves "Live quotes" up', pathRow('quotes', quotesUp, t, freshFeed()).state === 'up');
  check('A Status: a stale reading three minutes old no longer counts', pathRow('quotes', quotesUp, at(9, 49), h as OptionStaleness).state === 'up');
  const crow = compassRow({ status: 'live', heardAt: t, at: t, error: '', engine: { running: true, readOnly: false, startedAt: 0, why: '' }, lastMark: at(9, 45), quotes: 'up', quotesDownSince: 0, markDue: true, options: h as OptionStaleness }, t);
  check('A Status: the Compass engine row says "stale snapshots", who fell back and who was not scored', crow.state === 'degraded' && /Stale snapshots/.test(crow.line) && /1 of 2 scored from a current source/.test(crow.line) && /1 of 2 not scored/.test(crow.line), crow.line);
}

/* ---- S: the engine's slots ---- */
{
  const slots = createSlots({ terminal: 8, history: 6, reserved: 2 });
  const gates: (() => void)[] = [];
  const hold = () => new Promise<void>(r => gates.push(r));
  const order: string[] = [];
  const run = (name: string, path: string, lane?: string) => slots.slot(path, async () => { order.push(name); await hold(); }, lane);
  /* a busy site: twelve page reads ask first */
  const pages = Array.from({ length: 12 }, (_, i) => run(`page${i}`, `/option/snapshot/quote?symbol=P${i}`));
  await new Promise(r => setTimeout(r, 5));
  check('S a busy site takes six of the eight slots, never the engine\'s two', slots.stats().busy === 6 && order.length === 6, slots.stats());
  const eng = [run('engine0', '/option/snapshot/greeks/first_order?symbol=SPY', 'engine'), run('engine1', '/option/snapshot/greeks/first_order?symbol=QQQ', 'engine')];
  await new Promise(r => setTimeout(r, 5));
  check('S the engine gets its slots at once, behind twelve page reads', order.slice(6).join() === 'engine0,engine1' && slots.stats().busy === 8, order);
  const eng2 = run('engine2', '/option/snapshot/greeks/first_order?symbol=IWM', 'engine');
  await new Promise(r => setTimeout(r, 5));
  gates.shift()?.();
  await new Promise(r => setTimeout(r, 5));
  check('S a slot coming free goes to the engine before the pages waiting longer', order[8] === 'engine2', order.slice(6));
  /* the engine joins a page read still waiting: it moves up */
  const promoted = slots.promote('/option/snapshot/quote?symbol=P11');
  gates.shift()?.();
  await new Promise(r => setTimeout(r, 5));
  check('S a page read the engine joined is promoted to the engine\'s queue', promoted && order[9] === 'page11', order.slice(8));
  while (gates.length || order.length < 15) {
    gates.shift()?.();
    await new Promise(r => setTimeout(r, 2));
  }
  await Promise.all([...pages, ...eng, eng2]);
  check('S every read ran once; the counts are back to 0', order.length === 15 && slots.stats().busy === 0 && slots.stats().busyEngine === 0, slots.stats());
  const hs = createSlots({ terminal: 8, history: 6, reserved: 2 });
  const hg: (() => void)[] = [];
  const hist = Array.from({ length: 8 }, (_, i) => hs.slot(`/option/history/quote?x=${i}`, () => new Promise<void>(r => hg.push(r)), i < 4 ? 'engine' : undefined));
  await new Promise(r => setTimeout(r, 5));
  check('S history holds at most six slots, the engine\'s included', hs.stats().busyHistory === 6, hs.stats());
  while (hg.length) {
    hg.shift()?.();
    await new Promise(r => setTimeout(r, 2));
  }
  await Promise.all(hist);
}

/* ---- F: a frozen copy at the end of the minute history ---- */
{
  /* MU 2026-11-06 710P, as the record read it at 10:23: every row from 09:51 to the present one quote, sizes and all */
  const real: PathQuote[] = [
    { t: at(10, 18), bid: 19.6, ask: 20.1, bidSize: 22, askSize: 6 }, { t: at(10, 19), bid: 17.1, ask: 17.7, bidSize: 37, askSize: 36 },
    { t: at(10, 20), bid: 14.9, ask: 15.25, bidSize: 37, askSize: 5 }, { t: at(10, 21), bid: 14.45, ask: 14.9, bidSize: 38, askSize: 7 },
    { t: at(10, 22), bid: 17.05, ask: 17.65, bidSize: 40, askSize: 1 }, { t: at(10, 23), bid: 15.75, ask: 16.15, bidSize: 1, askSize: 40 },
  ];
  const frozen: PathQuote[] = [];
  for (let m = 9 * 60 + 51; m <= 10 * 60 + 23; m++) frozen.push({ t: at(Math.floor(m / 60), m % 60), bid: 7.1, ask: 7.45, bidSize: 41, askSize: 12 });
  const readAt = at(10, 23, 30);
  check('F frozenTail finds the copy from 09:51 to the present', frozenTail(frozen) === at(9, 51));
  check('F the real path has no frozen tail', frozenTail(real) === null);
  check('F a run that ended 15 minutes before is the record (the session over), kept', trustedPath(frozen, at(10, 40)).cutAt === null);
  check('F rows without sizes (a stand-in path) are never a frozen copy', frozenTail(frozen.map(({ t, bid, ask }) => ({ t, bid, ask }))) === null);
  const sig = { book: 'A' as const, right: 'P' as const, runner: false, firedAt: at(10, 21, 9), flatAt: at(15, 55) };
  const asCoded = settleSignal(sig, frozen, [], readAt);
  check('F before: the frozen copy fills at 09:51\'s 7.45 (the record\'s fill)', asCoded.fill?.ask === 7.45 && asCoded.fill.at === at(10, 22), asCoded.fill);
  const trust = trustedPath(frozen, readAt);
  const held = settleSignal(sig, trust.path, [], trust.asOf);
  check('F after: the frozen copy is cut; the call waits (no fill, not "unavailable")', trust.cutAt === at(9, 51) && held.status === 'waiting' && held.fill === null, [trust.cutAt, held.status]);

  /* the ledger: the first read is the frozen copy, the next is the market's */
  const rows = (list: PathQuote[]) => ({ status: 200, data: [{ data: list.map(r => ({ timestamp: wall(r.t), bid: r.bid, ask: r.ask, bid_size: r.bidSize, ask_size: r.askSize })) }], error: null });
  let reads = 0;
  answer = p => {
    if (p.startsWith('/option/history/quote') && p.includes('interval=1m')) {
      reads += 1;
      return rows(reads === 1 ? frozen : real);
    }
    return none;
  };
  const call: ledger.Signal = {
    key: '2026-11-06|MU-710-P-top-setups-odte', id: 'MU-710-P-top-setups-odte', day: '2026-11-06', book: 'A', ticker: 'MU', contract: 'MU 710P', right: 'P', strike: 710, expiry: '2026-11-06',
    sleeve: 'odte', firedAt: sig.firedAt, quoteAt: at(10, 20, 47), bid: 14.85, ask: 15.25, spot: 699, p1: 0.79, prun: null, runner: false, outcome: null, pathAt: 0, spark: [], how: 'live', flatAt: at(15, 55),
  };
  ledger.importSignals([call]);
  await ledger.settleOpen(readAt);
  const first = ledger.signals()[0];
  check('F the ledger never fills on the frozen copy: the call waits, no spark of 7.10', reads === 1 && (first.outcome?.fill ?? null) === null && first.outcome?.status === 'waiting' && !first.spark.includes(7.1), first.outcome);
  ledger.importSignals([{ ...first, pathAt: 0 }]);
  await ledger.settleOpen(readAt + 30_000);
  const second = ledger.signals()[0];
  check('F the next read is the market\'s: filled at 10:22 at 17.65 (not 7.45)', reads === 2 && second.outcome?.fill?.ask === 17.65 && second.outcome.fill.at === at(10, 22), second.outcome?.fill);

  /* a 1-second window from a store behind real time: AVGO 305P, a 3.35 "stop" at 10:29:01 inside minutes bidding 6.30–6.85 */
  const secs: PathQuote[] = Array.from({ length: 59 }, (_, i) => ({ t: at(10, 28, i + 1), bid: 3.35, ask: 3.5 }));
  check('F a 1-second window far from both its minute ends is refused', !fineAgrees(secs, { t: at(10, 28), bid: 6.85, ask: 7.0 }, { t: at(10, 29), bid: 6.6, ask: 6.75 }));
  const moving = [{ t: at(10, 28, 20), bid: 6.4, ask: 6.55 }, { t: at(10, 28, 40), bid: 3.6, ask: 3.7 }];
  check('F a real spike inside the minute (its first second at the minute\'s start quote) is kept', fineAgrees(moving, { t: at(10, 28), bid: 6.5, ask: 6.6 }, { t: at(10, 29), bid: 3.4, ask: 3.5 }));
}

/* ---- M: the scan's seed window ---- */
{
  const P = (list: [number, number, number, number, number][]) => list.map(([m, bid, ask, bs, as]) => ({ t: at(10, m), bid, ask, bidSize: bs, askSize: as }));
  /* 10:20's window for a chain: every contract one copy from 10:05 on (mid 5 and 15 minutes back the same) */
  const frozenChain = new Map<string, ReturnType<typeof P>>();
  const liveChain = new Map<string, ReturnType<typeof P>>();
  for (let i = 0; i < 10; i++) {
    const b = 2 + i;
    frozenChain.set(`c${i}`, P([[-10 + 10, b, b + 0.05, 10, 12], [5, b + 0.3, b + 0.35, 11, 9], [10, b + 0.3, b + 0.35, 11, 9], [15, b + 0.3, b + 0.35, 11, 9], [20, b + 0.3, b + 0.35, 11, 9]]));
    liveChain.set(`c${i}`, P([[0, b, b + 0.05, 10, 12], [5, b + 0.3, b + 0.35, 11, 9], [10, b + 0.1, b + 0.15, 14, 9], [15, b + 0.4, b + 0.45, 3, 22], [20, b + 0.2, b + 0.25, 8, 8]]));
  }
  check('M a seed window that is one frozen copy across the chain is a fault (not scored live)', chainFrozen(frozenChain));
  check('M a live chain is read as before', !chainFrozen(liveChain));
  const wings = new Map(liveChain);
  wings.set('w1', P([[0, 0.01, 0.02, 1, 1], [5, 0.01, 0.02, 1, 1], [10, 0.01, 0.02, 1, 1], [15, 0.01, 0.02, 1, 1], [20, 0.01, 0.02, 1, 1]]));
  check('M a few static wings (under 0.20) do not make a chain frozen', !chainFrozen(wings));
}

/* ---- R: the reversal exit's window (a strategy choice, COMPASS_REVERSAL_AFTER_ENTRY=1, off by default) ---- */
{
  /* the stock fell 0.5% from 10:17 to 10:21, the call (a call) filled at 10:22, the stock flat after */
  const bars = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map(m => ({ t: at(10, m), c: m <= 17 ? 100 : m <= 20 ? 99.7 : 99.5 }));
  check('R as coded: at 10:23 the "last 5 minutes" are 10:17-10:22, four of them before the 10:22 fill (-0.5%)', Math.abs(ret5At(bars, at(10, 23)) + 0.005) < 1e-9 && ret5At(bars, at(10, 23), at(10, 22)) === 0 && !Number.isFinite(ret5At(bars, at(10, 22), at(10, 22))));
  check('R after entry: from 10:24 the move since the fill (flat)', ret5At(bars, at(10, 24), at(10, 22)) === 0);
  const sig = { book: 'A' as const, right: 'C' as const, runner: false, firedAt: at(10, 21, 10), flatAt: at(15, 55) };
  const path = [{ t: at(10, 22), bid: 2.0, ask: 2.05 }, { t: at(10, 23), bid: 1.95, ask: 2.0 }, { t: at(10, 24), bid: 1.97, ask: 2.02 }, { t: at(10, 25), bid: 2.0, ask: 2.05 }];
  setGroupBSwitch('COMPASS_REVERSAL_AFTER_ENTRY', false);
  const coded = settleSignal(sig, path, bars, at(10, 26));
  setGroupBSwitch('COMPASS_REVERSAL_AFTER_ENTRY', true);
  const after = settleSignal(sig, path, bars, at(10, 26));
  setGroupBSwitch('COMPASS_REVERSAL_AFTER_ENTRY', null);
  check('R off (the default): out at 10:23 on the drop before the entry', coded.status === 'closed' && /reversed/.test(coded.exit?.why ?? '') && coded.exit?.at === at(10, 23), coded.exit);
  check('R on: held, the stock has not moved against it since the entry', after.status === 'open', after.status);
  check('R the switch is off unless the environment turns it on', !(globalThis as { process?: { env?: Record<string, string> } }).process?.env?.COMPASS_REVERSAL_AFTER_ENTRY);
}

/* ---- C: the cap on open calls (a strategy choice, COMPASS_MAX_OPEN=N, off by default) ---- */
{
  check('C COMPASS_MAX_OPEN unset: no cap', maxOpenCalls() === Infinity);
  setMaxOpenCalls(3);
  check('C forced to 3: 3', maxOpenCalls() === 3);
  setMaxOpenCalls(null);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall compass feed checks passed');
process.exit(failed ? 1 : 0);
