/*
  The exposure recorder (src/data/exposureRecorder.ts) against a counting stand-in for Unusual Whales, with the clock
  pinned: when it reads, which names, what one pass and one day cost, the folder lock, pruning, the answers it serves,
  the merge with a page's own live log (data/book/exposureLog.ts), and the hub's record lane (server/uwProxy.mjs with
  the vendor's fetch stood in): never more than one slot, always behind a waiting viewer, a viewer's fresh copy reused.
  No network. Run: npx tsx scripts/exposure-recorder-proof.ts
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { nyWallTime } from '../src/core/nyTime';
import {
  DaySeries,
  EXT_FROM,
  EXT_TO,
  HOUSE_NAMES,
  PASS_MS,
  RTH_FROM,
  RTH_TO,
  bookPath,
  exposureRoute,
  expiriesPath,
  frontPath,
  lineOf,
  slotAt,
  startExposureRecorder,
  takeLock,
  type UwAnswer,
} from '../src/data/exposureRecorder';
import * as field from '../src/data/book/exposureLog';

let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-proof-'));
const made: string[] = [];
const folder = () => {
  const d = temp();
  made.push(d);
  return d;
};

/* 2026-10-29 is a Thursday session; 2026-10-31 a Saturday; 2026-11-26 Thanksgiving */
const DAY = '2026-10-29';
const at = (h: number, m: number, s = 0, day = DAY) => {
  const [y, mo, d] = day.split('-').map(Number);
  return nyWallTime(y, mo, d, h, m) + s * 1000;
};

/* ---- the stand-in: a book of eleven strikes around 100 (all inside the field's 5% window) that the vendor recalculates every minute ---- */
interface Vendor {
  uw: (p: string) => Promise<UwAnswer>;
  calls: Map<string, number>;
  total: () => number;
  status: (p: string) => number;
}
function vendor(clock: () => number, opt: { status?: (p: string) => number; onCall?: () => void; pages?: number } = {}): Vendor {
  const calls = new Map<string, number>();
  const status = opt.status ?? (() => 200);
  const rows = (expiry: string | null) => {
    const now = clock();
    /* the vendor's book is stamped with the minute it was last priced */
    const stamp = new Date(Math.floor(now / 60_000) * 60_000).toISOString();
    const minute = Math.floor(now / 60_000) % 1000;
    const out: Record<string, string>[] = [];
    for (let k = 95; k <= 105; k += 1) {
      out.push({
        strike: String(k),
        price: '100',
        time: stamp,
        ...(expiry ? { expiry } : {}),
        call_gamma_oi: String(k * 1000 + minute),
        put_gamma_oi: String(-k * 400),
        call_gamma_ask: String(-minute * 10),
        call_gamma_bid: String(minute * 7),
        put_gamma_ask: '0',
        put_gamma_bid: String(k),
      });
    }
    return out;
  };
  return {
    calls,
    status,
    total: () => [...calls.values()].reduce((a, b) => a + b, 0),
    uw: async (p: string) => {
      calls.set(p, (calls.get(p) ?? 0) + 1);
      opt.onCall?.();
      const s = status(p);
      if (s !== 200) return { status: s, body: '{}', at: clock() };
      if (p.includes('/greek-exposure/expiry')) {
        return { status: 200, body: JSON.stringify({ data: [{ expiry: '2026-10-29' }, { expiry: '2026-10-30' }, { expiry: '2026-11-06' }] }), at: clock() };
      }
      const m = /expirations\[\]=([0-9-]+)/.exec(decodeURIComponent(p));
      return { status: 200, body: JSON.stringify({ data: rows(m ? m[1] : null) }), at: clock() };
    },
  };
}

/* ---- 1. when it reads ---- */
{
  const cases: [string, number, number, boolean | null][] = [
    ['03:58 is before the tape', at(3, 58), 2, null],
    ['04:00 premarket, every two minutes', at(4, 0), 2, false],
    ['04:01 premarket, between reads', at(4, 1), 2, null],
    ['09:29 premarket, between reads', at(9, 29), 2, null],
    ['09:30 the open, every minute', at(9, 30), 2, true],
    ['12:07 the session', at(12, 7), 2, true],
    ['16:14 the last regular minute', at(16, 14), 2, true],
    ['16:15 after hours (odd minute: no read)', at(16, 15), 2, null],
    ['16:16 after hours, every two minutes', at(16, 16), 2, false],
    ['19:58 the last after-hours read', at(19, 58), 2, false],
    ['20:00 the tape is over', at(20, 0), 2, null],
    ['16:16 with the extended sessions off', at(16, 16), 0, null],
    ['10:00 on a Saturday', at(10, 0, 0, '2026-10-31'), 2, null],
    ['10:00 on Thanksgiving', at(10, 0, 0, '2026-11-26'), 2, null],
  ];
  for (const [name, ms, every, want] of cases) {
    const s = slotAt(ms, every);
    check(`slot: ${name}`, want === null ? s === null : !!s && s.rth === want, s ? `${s.day} ${s.minute} ${s.rth ? 'rth' : 'ext'}` : 'none');
  }
  check('the windows: 09:30–16:15 every minute, 04:00–20:00 outside it', RTH_FROM === 570 && RTH_TO === 975 && EXT_FROM === 240 && EXT_TO === 1200);
}

/* ---- 2. one pass, the names and the cap ---- */
{
  const dir = folder();
  let now = at(10, 0, 3);
  const v = vendor(() => now);
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, max: 25 });
  check('the house names come first', rec.names().join(',') === HOUSE_NAMES.join(','), rec.names().join(','));
  const extra = Array.from({ length: 16 }, (_, i) => `V${String.fromCharCode(65 + i)}`);
  for (const t of extra) {
    rec.noteViewer(t);
    now += 1_000;
  }
  rec.noteViewer('not a ticker!');
  const names = rec.names();
  check('viewers fill the names up to the cap (25), the latest opens first', names.length === 25 && names[10] === 'VP' && !names.includes('VA'), `${names.length}: ${names.slice(10, 13).join(',')}…`);
  now = at(10, 0, 30);
  const p1 = await rec.tick();
  check('the first pass of the day: a book, an expiry list and a front-expiry read per name', !!p1 && v.total() === 75 && p1.asks === 75 && p1.vendor === 75, `${v.total()} calls`);
  check('… and one line per answer the field keeps (25 books, 25 fronts)', p1?.lines === 50, `${p1?.lines}`);
  check('the same minute is read once', (await rec.tick()) === null && v.total() === 75);
  now = at(10, 1, 4);
  const before = v.total();
  const p2 = await rec.tick();
  check('the next minute: two reads a name (the expiry list is kept for the day)', !!p2 && v.total() - before === 50, `${v.total() - before}`);
  check('the paths are the browser\'s own, so a viewer\'s copy serves both', v.calls.has(bookPath('SPY', 0)) && v.calls.has(frontPath('SPY', '2026-10-29')) && v.calls.has(expiriesPath('SPY')));
  const served = rec.day('SPY', DAY)!;
  check('the day serves the series in the log\'s shape', served.format === 'exposure-day/1' && served.readings === 4 && served.series.length === 22 && served.series.every(s => s[2].length % 4 === 0), `${served.readings} readings, ${served.series.length} series`);
  check('the first and last read are kept', served.firstAt === at(10, 0, 30) && served.lastAt === at(10, 1, 4));
  const file = fs.readFileSync(path.join(dir, DAY, 'SPY.jsonl'), 'utf8').trim().split('\n');
  check('on disk: one compact line an answer', file.length === 4 && JSON.parse(file[0]).r.length === 11, `${file.length} lines, ${Buffer.byteLength(file[0])} bytes`);
  /* a name the vendor does not know is dropped after two passes, freeing its place */
  const dirB = folder();
  let nowB = at(10, 0, 1);
  const vb = vendor(() => nowB, { status: p => (p.includes('/ZZZZ/') ? 404 : 200) });
  const recB = startExposureRecorder({ dir: dirB, uw: vb.uw, manual: true, now: () => nowB, house: ['SPY', 'ZZZZ'], front: false });
  await recB.tick();
  nowB = at(10, 1, 1);
  await recB.tick();
  check('a name the vendor refuses twice is left out for the day', recB.names().join(',') === 'SPY', recB.names().join(','));
  rec.stop();
  recB.stop();
}

/* ---- 3. the budget: a whole session, minute by minute ---- */
{
  const dir = folder();
  let now = at(4, 0, 2);
  const v = vendor(() => now);
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, max: 25, extEvery: 2 });
  for (let i = 0; i < 15; i++) rec.noteViewer(`W${String.fromCharCode(65 + i)}`);
  const perMinute: number[] = [];
  let rth = 0;
  let ext = 0;
  let rthCalls = 0;
  let extCalls = 0;
  let peak = 0;
  for (let m = 4 * 60; m < 20 * 60; m++) {
    now = at(Math.floor(m / 60), m % 60, 2);
    const was = v.total();
    const p = await rec.tick();
    const n = v.total() - was;
    perMinute.push(n);
    if (p) {
      if (m >= RTH_FROM && m < RTH_TO) {
        rth += 1;
        rthCalls += n;
      } else {
        ext += 1;
        extCalls += n;
      }
    }
    peak = Math.max(peak, n);
  }
  const day = v.total();
  check('regular session: 405 passes, one a minute', rth === 405, `${rth}`);
  check('extended sessions: one pass every two minutes (165 premarket, 112 after hours)', ext === 277, `${ext}`);
  check('25 names: 50 calls a minute in the session, never more than the first pass (75)', rthCalls === 405 * 50 && peak === 75, `session ${rthCalls}, peak ${peak}`);
  console.log(`  budget, 25 names, book + front: ${day} calls in the day (${rthCalls} in 09:30–16:15, ${extCalls} outside it), ${(rthCalls / 405).toFixed(1)} a minute in the session, ${(extCalls / Math.max(1, (EXT_TO - EXT_FROM) - 405)).toFixed(1)} a minute averaged outside it, peak ${peak}`);
  const size = fs.readdirSync(path.join(dir, DAY)).filter(f => f.endsWith('.jsonl')).reduce((a, f) => a + fs.statSync(path.join(dir, DAY, f)).size, 0);
  console.log(`  disk, 25 names × 11 strikes in the window: ${(size / 1e6).toFixed(2)} MB for the day before gzip`);
  rec.stop();
}

/* ---- 4. a pass never outlives its minute; a refusal backs off ---- */
{
  const dir = folder();
  let now = at(11, 0, 1);
  /* each answer takes three seconds of the pinned clock */
  const v = vendor(() => now, { onCall: () => (now += 3_000) });
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, max: 10 });
  const p = (await rec.tick())!;
  check('a slow pass stops at its deadline (past it by one name at most) and counts what it missed', p.took <= PASS_MS + 6_000 && p.missed > 0 && p.asks < 30, `${p.asks} asks in ${p.took / 1000}s, ${p.missed} missed`);
  now = at(11, 1, 1);
  const first = [...v.calls.keys()].length;
  await rec.tick();
  const reached = [...v.calls.entries()].filter(([k]) => k.startsWith('/stock/') && k.includes('spot-exposures/strike'));
  check('the next pass starts where the last one stopped', reached.length > 5 && first > 0, `${reached.length} books reached over two passes`);
  rec.stop();

  const dirB = folder();
  let nowB = at(11, 0, 1);
  let refuse = true;
  const vb = vendor(() => nowB, { status: () => (refuse ? 429 : 200) });
  const recB = startExposureRecorder({ dir: dirB, uw: vb.uw, manual: true, now: () => nowB, max: 10 });
  const r1 = (await recB.tick())!;
  check('a 429 stops the pass at once', vb.total() === 1 && !!r1.fault, `${vb.total()} calls`);
  check('… and backs off a minute', recB.status().backoffUntil === nowB + 60_000);
  nowB = at(11, 0, 50);
  check('no pass inside the backoff', (await recB.tick()) === null && vb.total() === 1);
  nowB = at(11, 1, 5);
  await recB.tick();
  check('a second refusal doubles it (two minutes)', recB.status().backoffUntil === nowB + 120_000);
  refuse = false;
  nowB = at(11, 3, 10);
  const r3 = (await recB.tick())!;
  check('once the vendor answers, a full pass, and the backoff resets', !r3.fault && r3.lines === 20 && recB.status().backoffUntil <= nowB, `${r3.lines} lines`);
  recB.stop();
}

/* ---- 5. one recorder per folder ---- */
{
  const dir = folder();
  let now = at(12, 0, 1);
  const v = vendor(() => now);
  const a = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, house: ['SPY'] });
  const b = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, house: ['SPY'] });
  check('the first process holds the lock and records', a.status().recording);
  /* the lock names this process, so the second "process" here is told apart by a held lock of another live pid */
  fs.writeFileSync(path.join(dir, 'recorder.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  const c = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => Date.now(), house: ['SPY'] });
  check('a second process on the folder records nothing', !c.status().recording && /pid/.test(c.status().why), c.status().why);
  await a.tick();
  check('… and serves the first one\'s record', (c.day('SPY', DAY)?.readings ?? 0) === 2 && (await c.tick()) === null);
  fs.writeFileSync(path.join(dir, 'recorder.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
  check('a lock left by a dead process is taken', takeLock(dir).ok);
  fs.writeFileSync(path.join(dir, 'recorder.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() - 180_000 }));
  check('a lock not refreshed for two minutes is taken', takeLock(dir).ok);
  const off = startExposureRecorder({ dir: folder(), uw: v.uw, manual: true, now: () => now, record: false });
  check('EXPOSURE_RECORDER=0: serves, records nothing', !off.status().recording && (await off.tick()) === null);
  a.stop();
  b.stop();
  c.stop();
  off.stop();
  check('stopping lets go of the lock', !fs.existsSync(path.join(dir, 'recorder.lock')) || JSON.parse(fs.readFileSync(path.join(dir, 'recorder.lock'), 'utf8')).pid !== process.pid);
}

/* ---- 6. pruning: ten days kept, a finished day gzipped and still served ---- */
{
  const dir = folder();
  let now = at(10, 0, 1, '2026-10-28');
  const v = vendor(() => now);
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, house: ['SPY'], keepDays: 10 });
  await rec.tick();
  now = at(10, 1, 1, '2026-10-28');
  await rec.tick();
  const yesterday = JSON.stringify(rec.day('SPY', '2026-10-28')!.series);
  for (const d of ['2026-10-18', '2026-10-19', '2026-10-20']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'SPY.jsonl'), '{}\n');
  }
  now = at(9, 0, 0, DAY);
  rec.prune();
  const left = fs.readdirSync(dir).filter(d => /^\d{4}-/.test(d)).sort();
  check('days older than ten are removed (Oct 18 goes, Oct 19 stays)', left.join(',') === '2026-10-19,2026-10-20,2026-10-28', left.join(','));
  const files = fs.readdirSync(path.join(dir, '2026-10-28'));
  check('a finished day is gzipped', files.includes('SPY.jsonl.gz') && !files.includes('SPY.jsonl'), files.join(','));
  const fresh = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, record: false });
  check('… and served the same from the gzip', JSON.stringify(fresh.day('SPY', '2026-10-28')!.series) === yesterday);
  const gz = fs.statSync(path.join(dir, '2026-10-28', 'SPY.jsonl.gz')).size;
  const raw = gunzipSync(fs.readFileSync(path.join(dir, '2026-10-28', 'SPY.jsonl.gz'))).length;
  check('gzip saves space', gz < raw, `${raw} → ${gz} bytes`);
  rec.stop();
  fresh.stop();
}

/* ---- 7. the merge: a viewer who opens at 10:20 sees the field from 09:30, the same cells as reading it all here ---- */
{
  const dir = folder();
  let now = at(9, 30, 5);
  const v = vendor(() => now);
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, house: ['SPY'], front: false });
  const answers: unknown[] = [];
  for (let m = 9 * 60 + 30; m <= 10 * 60 + 30; m++) {
    now = at(Math.floor(m / 60), m % 60, 5);
    await rec.tick();
    answers.push(JSON.parse((await v.uw(bookPath('SPY', 0))).body).data);
  }
  const bars = Array.from({ length: 61 }, (_, i) => Math.floor(at(9, 30) / 1000) + i * 60);
  const asOf = at(10, 31);
  /* reading it all in the browser */
  field.resetExposureLog('SPY');
  for (const rows of answers) field.noteExposureRows('SPY', rows, true);
  const all = { oi: field.exposureGrid('SPY', 'book', bars, 60, 'oi', asOf)!, flow: field.exposureGrid('SPY', 'book', bars, 60, 'flow', asOf)! };
  const allFrom = field.exposureTodayFrom('SPY', asOf);
  /* the page opens at 10:20: the server's record to 10:20, then its own reads */
  field.resetExposureLog('SPY');
  const served = rec.day('SPY', DAY)!;
  const upTo = new DaySeries();
  for (const line of fs.readFileSync(path.join(dir, DAY, 'SPY.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s))) if (line.n <= at(10, 20, 6)) upTo.add(line);
  field.mergeExposureSeries('SPY', upTo.out());
  for (const rows of answers.slice(50)) field.noteExposureRows('SPY', rows, true);
  const merged = { oi: field.exposureGrid('SPY', 'book', bars, 60, 'oi', asOf)!, flow: field.exposureGrid('SPY', 'book', bars, 60, 'flow', asOf)! };
  const same = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i]);
  const filled = (g: Float64Array) => g.filter(x => !Number.isNaN(x)).length;
  check('merged: every cell the same as reading the whole day here (open interest)', same(all.oi.values, merged.oi.values), `${filled(merged.oi.values)} cells`);
  check("merged: every cell the same (today's flow)", same(all.flow.values, merged.flow.values), `${filled(merged.flow.values)} cells`);
  check('the field starts at the open, not at the page\'s first read', field.exposureTodayFrom('SPY', asOf) === allFrom && allFrom === at(9, 30), `${new Date(field.exposureTodayFrom('SPY', asOf) ?? 0).toISOString()}`);
  check('the whole record merged on top changes nothing', !field.mergeExposureSeries('SPY', served.series) || same(all.oi.values, field.exposureGrid('SPY', 'book', bars, 60, 'oi', asOf)!.values));
  /* without the server the same page starts at 10:20 */
  field.resetExposureLog('SPY');
  for (const rows of answers.slice(50)) field.noteExposureRows('SPY', rows, true);
  const alone = field.exposureGrid('SPY', 'book', bars, 60, 'oi', asOf)!;
  check('with no recorder the field starts at the first read (10:20)', field.exposureTodayFrom('SPY', asOf) === at(10, 20) && filled(alone.values) < filled(merged.oi.values), `${filled(alone.values)} cells`);
  /* `since`: only what changed */
  const later = rec.day('SPY', DAY, at(10, 25))!;
  check('since: only the segments that end after it', later.series.length > 0 && later.series.every(s => s[2][1] > at(10, 25)) && JSON.stringify(later).length < JSON.stringify(served).length / 5, `${JSON.stringify(later).length} vs ${JSON.stringify(served).length} bytes`);
  rec.stop();
}

/* ---- 8. HTTP ---- */
{
  const dir = folder();
  let now = at(13, 0, 1);
  const v = vendor(() => now);
  const rec = startExposureRecorder({ dir, uw: v.uw, manual: true, now: () => now, house: ['SPY'], max: 3 });
  for (let m = 0; m < 8; m++) {
    now = at(13, m, 1);
    await rec.tick();
  }
  const call = (url: string, headers: Record<string, string> = {}) => {
    const out = { statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
    exposureRoute(rec, { url, method: 'GET', headers }, {
      get statusCode() {
        return out.statusCode;
      },
      set statusCode(s: number) {
        out.statusCode = s;
      },
      setHeader: (k: string, val: string) => (out.headers[k] = val),
      end: (b?: string | Buffer) => (out.body = Buffer.from(b ?? '')),
    }, () => now);
    return out;
  };
  const ok = call(`/api/exposure/day?ticker=spy&day=${DAY}`);
  check('GET /api/exposure/day answers the series (11 strikes, the book and the front)', ok.statusCode === 200 && JSON.parse(ok.body.toString()).series.length === 22);
  const big = call(`/api/exposure/day?ticker=SPY&day=${DAY}`, { 'accept-encoding': 'gzip' });
  check('… gzipped for a browser that takes it', big.headers['content-encoding'] === 'gzip' && JSON.parse(gunzipSync(big.body).toString()).ticker === 'SPY');
  check('a bad ticker or day is refused', call('/api/exposure/day?ticker=../x').statusCode === 400 && call('/api/exposure/day?ticker=SPY&day=29-10-2026').statusCode === 400);
  call(`/api/exposure/day?ticker=amd&day=${DAY}`);
  call('/api/exposure/day?ticker=TSLA&day=2026-10-28');
  check("asking for today names the ticker as a viewer's (an earlier day does not)", rec.names().join(',') === 'SPY,AMD', rec.names().join(','));
  const st = JSON.parse(call('/api/exposure/status').body.toString());
  check('GET /api/exposure/status: names, the last pass and its vendor calls', st.recording && st.names.length === 2 && st.last && st.recentVendor.length === 8, JSON.stringify(st.last));
  check('only GET', (() => {
    const out = { statusCode: 0 };
    exposureRoute(rec, { url: '/api/exposure/day', method: 'POST', headers: {} }, { set statusCode(s: number) { out.statusCode = s; }, get statusCode() { return out.statusCode; }, setHeader: () => {}, end: () => {} });
    return out.statusCode === 405;
  })());
  rec.stop();
}

/* ---- 9. the hub's record lane, through the real proxy with the vendor's fetch stood in ---- */
{
  const home = folder();
  const cwd = process.cwd();
  process.chdir(home);
  process.env.UNUSUAL_WHALES_API_KEY = 'proof-key';
  let busy = 0;
  let peak = 0;
  let recordBusy = 0;
  let recordPeak = 0;
  const done: { path: string; end: number; start: number }[] = [];
  const upstream = new Map<string, number>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const p = url.replace('https://api.unusualwhales.com/api', '');
    upstream.set(p, (upstream.get(p) ?? 0) + 1);
    const record = p.includes('spot-exposures/strike');
    busy += 1;
    peak = Math.max(peak, busy);
    if (record) {
      recordBusy += 1;
      recordPeak = Math.max(recordPeak, recordBusy);
    }
    const start = Date.now();
    await sleep(60);
    busy -= 1;
    if (record) recordBusy -= 1;
    done.push({ path: p, start, end: Date.now() });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const { uwDirect, uwHubStats } = await import('../server/uwProxy.mjs');
    /* eight record asks queued first, then eight viewers arrive */
    const recs = Array.from({ length: 8 }, (_, i) => uwDirect(bookPath(`R${String.fromCharCode(65 + i)}`, 0), { lane: 'record', maxAge: 45_000 }));
    await sleep(5);
    const views = Array.from({ length: 8 }, (_, i) => uwDirect(`/stock/V${String.fromCharCode(65 + i)}/stock-state`));
    await Promise.all([...recs, ...views]);
    const lastViewer = Math.max(...done.filter(d => d.path.includes('stock-state')).map(d => d.end));
    const recordsAfter = done.filter(d => d.path.includes('spot-exposures') && d.start >= lastViewer - 60).length;
    check('never more than the key\'s three requests at once', peak <= 3, `peak ${peak}`);
    check('the recorder holds at most one of them', recordPeak === 1, `peak ${recordPeak}`);
    check('viewers who arrive later go ahead of the queued recorder', recordsAfter >= 5, `${recordsAfter} of 8 record asks ran after the last viewer`);
    /* a viewer's fresh copy is the recorder's: no second call */
    const p = bookPath('SHARED', 0);
    const was = upstream.get(p) ?? 0;
    await uwDirect(p);
    await sleep(3_200);
    const got = await uwDirect(p, { lane: 'record', maxAge: 45_000 });
    check("a viewer's copy (3 s past fresh) is reused by the recorder", (upstream.get(p) ?? 0) - was === 1 && got.status === 200 && got.at < Date.now() - 3_000);
    const stats = uwHubStats() as Record<string, number>;
    check('record asks are counted apart and keep nothing warm', stats.recordAsks === 9 && stats.recordReused === 1 && stats.upstreamRecord === 8, JSON.stringify({ recordAsks: stats.recordAsks, reused: stats.recordReused, upstreamRecord: stats.upstreamRecord, watching: stats.watching }));
    check('… the hub watches only the viewers\' paths', stats.watching === 9, `${stats.watching}`);
  } finally {
    globalThis.fetch = realFetch;
    process.chdir(cwd);
    delete process.env.UNUSUAL_WHALES_API_KEY;
  }
}

for (const d of made) fs.rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall exposure recorder checks passed');
process.exit(failed ? 1 : 0);
