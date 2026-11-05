/*
  The Compass record's settlement and study labels (audit "Compass record/outcome", 2026-11-05), on a terminal stand-in
  that answers the way ThetaData does: an option quote history read without a clock window holds 09:30 to 16:00 only.
    A1  an overnight (Tue 21:00) or pre-market (Wed 08:00) call's path is read in its own session, and fills
    A2  a 1-second exit window that did not answer keeps the call open (Books A, B and C) and the study's label
        unresolved, never closed on the minute quotes (which resolve a minute that touched the stop and the target in
        the call's favour)
    A3  the exit windows are found again on the path as read: a trail stop the seconds raised is judged in the next
        minute's seconds too
    A9  a label flats at its own session's flat and at an early close's
    A10 the 1.50× take-profit is never under 1.50× the ask (0.33 took profit at 0.49, +48.5%)
    A11 an overnight row before midnight is placed at its own mark, not a day later; a past session's settlements are
        written back to its file; a past day is not built while its calls are being settled
    and Model Risk's P&L to the cent, its open ticket marked at the last bid read.
  Run:  npx tsx scripts/compass-record-proof.ts
*/
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nyParts, nyWallTime } from '../src/core/nyTime';
import { setCompassHost, type ThetaAnswer } from '../src/data/compassHost';
import { settleSignal, type PathQuote } from '../src/data/compassOutcome';
import { lotteryExit, treeExit } from '../src/data/compassParams';
import * as params from '../src/data/compassParams';
import * as ledger from '../src/data/compassLedger';
import * as study from '../src/data/compassStudy';
import * as review from '../src/data/compassReview';
import * as server from '../src/data/compassServer';
import type { Signal } from '../src/data/compassLedger';
import type { TailTicket } from '../src/data/modelRisk';

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) console.log('ok  ', name);
  else {
    failed += 1;
    console.error('FAIL', name, got === undefined ? '' : JSON.stringify(got));
  }
};
const has = (mod: object, name: string) => typeof (mod as Record<string, unknown>)[name] === 'function';

const at = (m: number, d: number, h: number, min: number, s = 0) => nyWallTime(2026, m, d, h, min) + s * 1000;
const q = (t: number, bid: number, ask: number): PathQuote => ({ t, bid, ask });
const two = (n: number) => String(n).padStart(2, '0');
const wall = (ms: number) => {
  const p = nyParts(ms);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}.000`;
};
const clockSec = (s: string) => {
  const [h, m, x] = s.split(':').map(Number);
  return h * 3600 + m * 60 + (x || 0);
};

/* ---- the terminal stand-in ---- */
/** Quotes by "strike|right|interval" */
const book = new Map<string, PathQuote[]>();
let fineDown = false;
const asked: string[] = [];
const terminal = async (path: string): Promise<ThetaAnswer> => {
  asked.push(path);
  if (!path.startsWith('/option/history/quote')) return { status: 472, data: null, error: 'no_data' };
  const u = new URLSearchParams(path.split('?')[1]);
  const iv = u.get('interval') ?? '';
  if (iv === '1s' && fineDown) return { status: 503, data: null, error: 'terminal_down' };
  const rows = book.get(`${u.get('strike')}|${u.get('right')}|${iv}`) ?? [];
  const from = u.get('start_date') ?? '';
  const to = u.get('end_date') ?? '';
  /* no window asked: the regular session only, as the terminal answers */
  const t0 = clockSec(u.get('start_time') ?? '09:30:00');
  const t1 = clockSec(u.get('end_time') ?? '16:00:00');
  const out = rows.filter(r => {
    const p = nyParts(r.t);
    const d = `${p.year}${two(p.month)}${two(p.day)}`;
    const s = p.hour * 3600 + p.minute * 60 + p.second;
    return d >= from && d <= to && s >= t0 && s <= t1;
  });
  if (!out.length) return { status: 472, data: null, error: 'no_data' };
  return { status: 200, data: [{ data: out.map(r => ({ timestamp: wall(r.t), bid: r.bid, ask: r.ask })) }], error: null };
};
setCompassHost({ server: true, theta: terminal, asset: async () => null, econ: () => [] });

const sigOf = (over: Partial<Signal>): Signal => ({
  key: `k|${Math.random()}`, id: 'x', day: '2026-10-29', book: 'A', ticker: 'SPY', contract: 'SPY 500C', right: 'C', strike: 500, expiry: '2026-10-29',
  sleeve: 'odte', firedAt: at(10, 29, 10, 0, 30), quoteAt: at(10, 29, 10, 0, 29), bid: 0.98, ask: 1, spot: 500, p1: 0.8, prun: null, runner: false,
  outcome: null, pathAt: 0, spark: [], how: 'live', ...over,
});

/* ---- A10: the take-profit price ---- */
{
  const tp = treeExit(0.33, 0.5, 0, false);
  check('A10 ask 0.33: take profit at 0.50 (+51.5%), not 0.49 (+48.5%)', tp?.why === 'tp1' && tp.px === 0.5, tp);
  let worst = Infinity;
  let over = 0;
  for (let c = 1; c <= 3000; c++) {
    const ask = c / 100;
    const px = has(params, 'takeProfitPx') ? (params as unknown as { takeProfitPx: (a: number) => number }).takeProfitPx(ask) : Number((ask * 1.5).toFixed(2));
    worst = Math.min(worst, px - ask * 1.5);
    over = Math.max(over, px - ask * 1.5);
  }
  check('A10 every cent ask 0.01 to 30.00: the target is at or over 1.50× and under it plus a cent', worst > -1e-9 && over < 0.01 - 1e-9, { worst, over });
  const o = settleSignal({ book: 'A', right: 'C', runner: false, firedAt: at(10, 29, 10, 0, 30) }, [q(at(10, 29, 10, 1), 0.31, 0.33), q(at(10, 29, 10, 9), 0.5, 0.52)], [], at(10, 29, 17, 0));
  check('A10 the settled call returns at least +50%', o.exit?.px === 0.5 && (o.ret ?? 0) >= 50, [o.exit, o.ret]);
  check('A10 Book C 3× of 0.35 is 1.05', lotteryExit(0.35, 1.05, 10)?.px === 1.05);
}

/* ---- A1: the overnight and pre-market paths ---- */
{
  const firedAt = at(11, 3, 21, 0, 20);
  const flatAt = at(11, 4, 9, 20);
  const night = sigOf({ ticker: 'SPXW', contract: 'SPXW 6800C', strike: 6800, expiry: '2026-11-04', day: '2026-11-03', firedAt, flatAt, tapeSession: 'overnight' });
  book.set('6800|call|1m', [
    q(at(11, 3, 21, 1), 2.0, 2.1), q(at(11, 3, 22, 0), 2.2, 2.3), q(at(11, 4, 2, 0), 2.3, 2.4), q(at(11, 4, 8, 0), 2.4, 2.5),
    q(at(11, 4, 9, 20), 2.5, 2.6), q(at(11, 4, 10, 0), 2.7, 2.8),
  ]);
  const reads = has(ledger, 'pathReads') ? (ledger as unknown as { pathReads: (s: unknown) => unknown }).pathReads(night) : null;
  check('A1 an overnight call is read on both dates, each in its own window', JSON.stringify(reads) === JSON.stringify([
    { from: '2026-11-03', to: '2026-11-03', start: '21:00:00', end: '23:59:59' },
    { from: '2026-11-04', to: '2026-11-04', start: '00:00:00', end: '09:21:00' },
  ]), reads);
  const path = await ledger.contractPath(night, null);
  check('A1 the overnight path holds the 21:01 and 02:00 rows', !!path?.some(r => r.t === at(11, 3, 21, 1)) && !!path?.some(r => r.t === at(11, 4, 2, 0)), path?.length);
  const o = settleSignal(night, path ?? [], [], at(11, 4, 12, 0));
  check('A1 the Tuesday 21:00 call fills at 21:01 and flats at 09:20 (was unavailable)', o.status === 'closed' && o.fill?.at === at(11, 3, 21, 1) && o.exit?.why === '09:20 flat', [o.status, o.exit]);
  const pre = sigOf({ ticker: 'SPY', contract: 'SPY 680C', strike: 680, expiry: '2026-11-04', day: '2026-11-04', firedAt: at(11, 4, 8, 0, 20), flatAt: at(11, 4, 9, 20), tapeSession: 'pre' });
  book.set('680|call|1m', [q(at(11, 4, 8, 1), 1.0, 1.04), q(at(11, 4, 9, 0), 1.1, 1.14), q(at(11, 4, 9, 20), 1.12, 1.16), q(at(11, 4, 10, 0), 1.3, 1.34)]);
  const po = settleSignal(pre, (await ledger.contractPath(pre, null)) ?? [], [], at(11, 4, 12, 0));
  check('A1 the Wednesday 08:00 pre-market call fills at 08:01 (was unavailable)', po.status === 'closed' && po.fill?.at === at(11, 4, 8, 1) && po.exit?.why === '09:20 flat', [po.status, po.exit]);
  const regular = sigOf({ day: '2026-10-29', flatAt: at(10, 29, 15, 55) });
  asked.length = 0;
  await ledger.contractPath(regular, null);
  check('A1 a regular-session call reads its day as before (no window, the same path)', asked.length === 1 && !asked[0].includes('start_time') && /start_date=20261029&end_date=20261029&interval=1m&format=json$/.test(asked[0]), asked);
}

/* ---- A2: a 1-second window that did not answer ---- */
const firedA = at(10, 29, 10, 0, 30);
const minuteA = [q(at(10, 29, 10, 1), 0.99, 1.0), q(at(10, 29, 10, 2), 1.3, 1.32), q(at(10, 29, 10, 3), 1.1, 1.12), q(at(10, 29, 10, 4), 1.6, 1.62)];
const secondsA = [q(at(10, 29, 10, 3, 20), 0.98, 1.0), q(at(10, 29, 10, 3, 40), 1.55, 1.57)];
{
  book.set('500|call|1m', minuteA);
  book.set('500|call|1s', secondsA);
  const call = sigOf({ key: '2026-10-29|a2', flatAt: at(10, 29, 15, 55) });
  ledger.importSignals([call]);
  fineDown = true;
  await ledger.settleOpen(Date.now() + 60_000);
  const held = ledger.signals()[0].outcome;
  check('A2 the seconds did not answer: the call stays open (was closed at the 1.50× target on the minute quotes)', held?.status === 'open', held && [held.status, held.exit]);
  fineDown = false;
  ledger.importSignals([{ ...ledger.signals()[0], pathAt: 0 }]);
  await ledger.settleOpen(Date.now() + 120_000);
  const done = ledger.signals()[0].outcome;
  check('A2 read on the next pass: the break-even stop at 10:03:20, bid 0.98', done?.status === 'closed' && done.exit?.why === 'Stop' && done.exit.at === at(10, 29, 10, 3, 20) && done.exit.px === 0.98, done?.exit);

  /* Book C: 3× of 0.50 at 15:22 on the minute quotes, its seconds not read */
  book.set('501|call|1m', [q(at(10, 29, 15, 21), 0.45, 0.5), q(at(10, 29, 15, 22), 1.6, 1.65), q(at(10, 29, 15, 50), 0.2, 0.25)]);
  const c = sigOf({ key: '2026-10-29|c', book: 'C', contract: 'SPY 501C', strike: 501, firedAt: at(10, 29, 15, 20, 5) });
  ledger.importSignals([c]);
  fineDown = true;
  await ledger.settleOpen(Date.now() + 180_000);
  const co = ledger.signals()[0].outcome;
  check('A2 Book C whose seconds did not answer stays open (was closed 3× on its minutes)', co?.status === 'open', co && [co.status, co.exit]);
  fineDown = false;

  /* the study's label on the same path */
  if (has(study, 'settleLabel')) {
    const settleLabel = (study as unknown as { settleLabel: typeof import('../src/data/compassStudy').settleLabel }).settleLabel;
    const core = { book: 'A' as const, right: 'C' as const, runner: false, firedAt: firedA, flatAt: at(10, 29, 15, 55) };
    fineDown = true;
    const un = await settleLabel({ ticker: 'SPY', expiry: '2026-10-29', strike: 500, right: 'C' }, core, minuteA, []);
    check('A2 a label whose exit window did not answer is unresolved, not a take-profit', un.unresolved === true && un.tp1 === null && un.ret === null, un);
    fineDown = false;
    const ok = await settleLabel({ ticker: 'SPY', expiry: '2026-10-29', strike: 500, right: 'C' }, core, minuteA, []);
    check('A2 read, the label is the stop at 0.98 (minute quotes alone: a take-profit)', ok.why === 'Stop' && ok.exit === 0.98 && ok.tp1 === false, ok);
  } else check('A2 the study settles labels on the 1-second windows (settleLabel)', false);
}

/* ---- A3: the windows found again on the path as read ---- */
{
  const rs = sigOf({ key: '2026-10-29|a3', book: 'B', runner: true, contract: 'SPY 502C', strike: 502, firedAt: at(10, 29, 11, 0, 30), flatAt: at(10, 29, 15, 55) });
  const m2 = [q(at(10, 29, 11, 1), 0.99, 1.0), q(at(10, 29, 11, 2), 3.9, 3.95), q(at(10, 29, 11, 3), 4.7, 4.75), q(at(10, 29, 11, 4), 4.4, 4.45)];
  /* a 6.00 spike at 11:02:30 raises the trail stop to 4.50; the bid printed 4.50 at 11:03:30 */
  book.set('502|call|1s', [q(at(10, 29, 11, 2, 30), 6.0, 6.05), q(at(10, 29, 11, 2, 59), 4.75, 4.8), q(at(10, 29, 11, 3, 30), 4.5, 4.55)]);
  const path = await ledger.withFineExits(rs, m2, at(10, 29, 12, 0));
  const o = settleSignal(rs, path, [], at(10, 29, 12, 0));
  check('A3 the trail stop raised by a 1-second peak is judged in the next minute\'s seconds: out at 4.50, 11:03:30 (was 4.40 at 11:04)', o.exit?.px === 4.5 && o.exit.at === at(10, 29, 11, 3, 30), o.exit);
}

/* ---- A9 and A11: the study's own marks and flats ---- */
if (has(study, 'flatOfMark') && has(study, 'rowMark')) {
  const { flatOfMark, rowMark } = study as unknown as { flatOfMark: (t: string, a: number, d: string, c: number | null) => number; rowMark: (r: { t: number; d: string; m?: number }) => number };
  check('A9 a regular mark flats at 15:55; on a 13:00 close at 12:55', flatOfMark('SPY', at(10, 29, 10, 0), '2026-10-29', null) === at(10, 29, 15, 55) && flatOfMark('SPY', at(11, 27, 10, 0), '2026-11-27', 780) === at(11, 27, 12, 55));
  check('A9 overnight SPXW 21:00 flats at 09:20 next day; pre-market SPY 08:00 at 09:20; curb 16:05 at 16:55', flatOfMark('SPXW', at(11, 3, 21, 0), '2026-11-04', null) === at(11, 4, 9, 20) && flatOfMark('SPY', at(11, 4, 8, 0), '2026-11-04', null) === at(11, 4, 9, 20) && flatOfMark('SPY', at(11, 4, 16, 5), '2026-11-04', null) === at(11, 4, 16, 55));
  check('A11 an overnight row of the 11-04 session at t 21:00 was marked Tue 11-03 21:00 (was Wed 21:00)', rowMark({ d: '2026-11-04', t: 21 * 60 }) === at(11, 3, 21, 0), new Date(rowMark({ d: '2026-11-04', t: 21 * 60 })).toISOString());
  check('A11 Monday\'s session: Sunday 21:00; a regular row its own day; a logged mark as logged', rowMark({ d: '2026-11-02', t: 21 * 60 }) === at(11, 1, 21, 0) && rowMark({ d: '2026-11-04', t: 600 }) === at(11, 4, 10, 0) && rowMark({ d: '2026-11-04', t: 21 * 60, m: 123 }) === 123);
  if (has(study, 'settleLabel')) {
    const settleLabel = (study as unknown as { settleLabel: typeof import('../src/data/compassStudy').settleLabel }).settleLabel;
    book.set('503|call|1m', [q(at(11, 27, 12, 1), 1, 1.02), q(at(11, 27, 12, 30), 1.1, 1.12), q(at(11, 27, 12, 55), 1.2, 1.22), q(at(11, 27, 13, 0), 0.9, 0.92), q(at(11, 27, 13, 14), 0.5, 0.52)]);
    const lab = await settleLabel({ ticker: 'SPY', expiry: '2026-11-27', strike: 503, right: 'C' }, { book: 'A', right: 'C', runner: false, firedAt: at(11, 27, 12, 0, 30), flatAt: flatOfMark('SPY', at(11, 27, 12, 0), '2026-11-27', 780), closeMin: 780 }, book.get('503|call|1m')!, []);
    check('A9 a label on a 13:00 close flats at 12:55, bid 1.20 (was the 13:14 bid 0.50)', lab.why === '12:55 flat' && lab.exit === 1.2, lab);
  }
} else check('A9/A11 the study places rows at their mark and flats them at their session\'s flat (flatOfMark, rowMark)', false);

if (has(server, 'mergeSettled') && has(server, 'buildReady') && has(review, 'builtOpenCalls')) {
  const { mergeSettled, buildReady, RECORD_FORMAT } = server as unknown as typeof import('../src/data/compassServer');
  const open = sigOf({ key: '2026-11-03|o', day: '2026-11-03', firedAt: at(11, 3, 10, 0, 30), outcome: { status: 'open', fill: { at: 1, bid: 1, ask: 1 }, exit: null, peak: 0, stop: 0, last: null, ret: null, pnl: null, heldMin: 1 } });
  const late = sigOf({ key: '2026-11-03|l', day: '2026-11-03', firedAt: at(11, 3, 10, 5, 30), how: 'late' });
  const raw = { format: RECORD_FORMAT, day: '2026-11-03', savedAt: 0, close: null, calls: [open, late], would: [], marks: [], lottery: false, state: { day: '20261103' }, meta: { spots: {}, sparks: {}, line: '' } } as unknown as import('../src/data/compassServer').DayFile;
  const shut = { status: 'closed' as const, fill: { at: 1, bid: 1, ask: 1 }, exit: { at: 2, px: 1.2, why: 'Stop' }, peak: 1.3, stop: 1, last: null, ret: 20, pnl: 20, heldMin: 3 };
  const merged = mergeSettled(raw, [{ ...open, outcome: shut }, { ...late, would: true, outcome: shut }], 5);
  check('A11 a past session\'s settlements are written into its own file (a late call stays a late call)', merged.calls[0].outcome?.status === 'closed' && merged.calls[1].outcome?.status === 'closed' && merged.calls[1].how === 'late' && !('would' in merged.calls[1]) && merged.marks === raw.marks, merged.calls.map(c => c.outcome?.status));
  check('A11 a past day is not built while its calls are being settled in memory; built when settled, or when no longer held', !buildReady('2026-11-03', '2026-11-04', raw, [open]) && buildReady('2026-11-03', '2026-11-04', merged, [open]) && buildReady('2026-11-03', '2026-11-04', raw, []) && !buildReady('2026-11-04', '2026-11-04', raw, []));
  const dir = mkdtempSync(join(tmpdir(), 'compass-record-proof-'));
  const file = review.studyFile(dir, '2026-11-03');
  writeFileSync(join(dir, 'x'), '');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'study'), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: review.REVIEW_VERSION, openCalls: review.openCalls(raw) }));
  check('A11 a study built with calls open says so, to be built again once they settle', (review as unknown as { builtOpenCalls: (f: string) => number }).builtOpenCalls(file) === 2, review.openCalls(raw));
} else check('A11 past sessions written back and not built while settling (mergeSettled, buildReady, builtOpenCalls)', false);
if (has(server, 'scoredLine')) {
  const { scoredLine } = server as unknown as typeof import('../src/data/compassServer');
  const mark = at(11, 3, 21, 0);
  const line = scoredLine({ setup: { contract: 'SPXW 6800C', expiryDate: '2026-11-04', bid: 2, ask: 2.1, quotedAt: mark - 1000, spot: 6790 } as never, minute: 21 * 60, mark, x: [1, NaN], p1: 0.8, prun: null, late: false }, '2026-11-04');
  check('A11 a scored row is logged with its mark (Tue 21:00 under the Wednesday session), and the study reads it there', line.m === mark && line.d === '2026-11-04' && line.t === 21 * 60 && study.rowMark(line) === mark, line);
} else check('A11 the scored row carries its mark (scoredLine)', false);

/* ---- Model Risk: P&L to the cent, the open ticket at its last bid ---- */
{
  const t: TailTicket = { id: 't', day: '2026-10-29', book: '0', right: 'C', ticker: 'SPY', root: 'SPY', contract: 'SPY 500C', strike: 500, expiry: '2026-10-29', expiryTradingDays: 0, entryMinute: 600, entryAsk: 1.0, entryBid: 0.98, entryAt: at(10, 29, 10, 0), spot: 500, orHigh: 0, orLow: 0, score: 0, iv: 0, gamma: 0, thetaYear: 0, gex: null, exitMinute: null, exitBid: null, exitAt: null, why: null, bids: [{ minute: 601, bid: 1.04 }, { minute: 605, bid: 1.08 }] } as unknown as TailTicket;
  ledger.importSignals([]);
  ledger.recordTail(t);
  const op = ledger.signals()[0].outcome;
  check('Model Risk open: marked at the last bid read (1.08 at 10:05), not the entry quote', op?.last?.bid === 1.08 && op.last.t === at(10, 29, 10, 5), op?.last);
  ledger.closeTail({ ...t, why: 'back', exitBid: 1.1, exitAt: at(10, 29, 10, 9), exitMinute: 609 });
  const cl = ledger.signals()[0].outcome;
  check('Model Risk closed: (1.10 - 1.00) x 100 = 10 to the cent (was 10.000000000000009)', cl?.pnl === 10, cl?.pnl);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\ncompass-record-proof: all passed');
