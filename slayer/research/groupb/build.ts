/*
  Group B rows: one session day through the engine's own late path (every scan mark from the session's first minute,
  20:15 the evening before for the index roots, to the curb's end; every same-day and weekly root), answered from the
  bulk cache (localHost.ts). Every row the scan builds inputs for that is inside its session's entry minutes is written
  with both feature versions (compassModel onResearchRow: version 1 = the shipped trees' inputs, version 2 = the
  trading-time clock), the live trees' answer, every book gate apart from the line, and its outcome on the contract's
  one-minute NBBO: the fill a full minute after the mark (compassOutcome settleSignal), `win` (the bid reached the
  1.50× take-profit before the 0.4678× stop, by the session's flat), `win2` (2.00× before the stop), and the book
  exits' return as a non-runner (`retA`: stop, break-even at 1.25×, 1.50× take-profit, the reversal, the flat) and as a
  runner (`retR`: the ratchet).

    npx tsx research/groupb/build.ts 2026-09-30 [2026-09-29 …] [--days-file list.txt]   (each day in its own process;
    GB_BUILD_CONC days at once, GB_NET=1 reads the missing open-interest counts from the terminal)
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA, SRC } from './localHost';

const OUT = process.env.GB_OUT || path.join(DATA, 'rows');
/** the version 2 columns that differ from version 1 (the clock's): the rest are the same input */
export const V2_COLS = [15, 24, 25, 26, 27, 36, 37, 38, 39, 40, 41, 42];
const args = process.argv.slice(2);
const listFile = args.includes('--days-file') ? args[args.indexOf('--days-file') + 1] : '';
const days = [...args, ...(listFile ? fs.readFileSync(listFile, 'utf8').split(/\s+/) : [])].filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

async function buildOne(day: string): Promise<void> {
  const lh = await import('./localHost');
  const { localTheta, barsOn, ckey } = lh;
  const { setCompassHost } = await import('../../src/data/compassHost');
  const scan = await import('../../src/data/compassScan');
  const model = await import('../../src/data/compassModel');
  const params = await import('../../src/data/compassParams');
  const { optionScanOpen, odteAsleep, sessionDayOpen } = await import('../../src/data/compassSession');
  const { nyWallTime, nyParts } = await import('../../src/core/nyTime');
  const { sessionCloseMinOn } = await import('../../src/core/calendar');
  const { settleSignal } = await import('../../src/data/compassOutcome');

  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const host = localTheta(day, { net: process.env.GB_NET === '1' });
  setCompassHost({
    server: true,
    theta: host.theta,
    asset: async p => {
      const b = fs.readFileSync(path.join(root, 'public', p.replace(/^\/+/, '')));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    econ: () => [],
  });
  const ymd = day.replace(/-/g, '');
  const close = sessionCloseMinOn(day);
  const closeMin = close < 16 * 60 ? close : null;
  model.setScoreClose(ymd, closeMin);
  model.rollModelDay(ymd);

  const kept: import('../../src/data/compassModel').ResearchRow[] = [];
  let mismatch = 0;
  const off = model.onResearchRow(r => {
    if (!r.entryOk) return;
    for (let i = 0; i < 56; i++) {
      if (V2_COLS.includes(i)) continue;
      const a = r.x1[i];
      const b = r.x2[i];
      if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) mismatch += 1;
    }
    kept.push({ ...r, setup: { ...r.setup } });
  });
  const [y, mo, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  const endAt = nyWallTime(y, mo, d, 17, 0);
  const t0 = Date.now();
  let marks = 0;
  for (let at = scan.sessionOpenAt(day); at <= endAt; at += 60_000) {
    const p = nyParts(at);
    if (!(params.sessionScanOpen(p.hour * 60 + p.minute, p.weekday) && sessionDayOpen(at))) continue;
    const jobs: { sym: string; sleeve: 'odte' | 'weekly' }[] = [
      ...(odteAsleep(at) ? [] : scan.odteBook(at).filter(n => optionScanOpen(n, 0, at))).map(sym => ({ sym, sleeve: 'odte' as const })),
      ...scan.WEEKLY_FOCUS.filter(n => optionScanOpen(n, 1, at)).map(sym => ({ sym, sleeve: 'weekly' as const })),
    ];
    marks += 1;
    host.setMark(at);
    for (const j of jobs) {
      const snap = await scan.atMark(j.sym, at, j.sleeve);
      if (!snap.ok || !snap.setups.length) continue;
      await model.scoreBook(snap.setups, at, true, true).catch(() => 'fault');
    }
  }
  off();

  const closesOf = new Map<string, { t: number; c: number }[]>();
  const underCloses = (name: string) => {
    let c = closesOf.get(name);
    if (!c) {
      const pr = scan.INDEX_OF[name] ?? name;
      c = barsOn(pr, day).map(b => ({ t: nyWallTime(Number(b.key.slice(0, 4)), Number(b.key.slice(5, 7)), Number(b.key.slice(8, 10)), Number(b.key.slice(11, 13)), Number(b.key.slice(14, 16))), c: b.c }));
      closesOf.set(name, c);
    }
    return c;
  };
  const head = ['day', 'sleeve', 'ticker', 'id', 'expiry', 'right', 'strike', 'mark', 'markMs', 'pass', 'order', 'session', 'regularDay', 'trained', 'aGeom', 'bGeom', 'burns1', 'burns2', 'dte', 'tm', 'retOpen', 'flatMin', 'bid', 'ask', 'p1', 'prun', 'atmMoved',
    ...Array.from({ length: 56 }, (_, i) => `x${i}`), ...V2_COLS.map(i => `v${i}`),
    'fill', 'fillSec', 'win', 'win2', 'retA', 'retR', 'best'];
  const lines: string[] = [head.join(',')];
  const paths = new Map<string, { t: number; bid: number; ask: number }[]>();
  const pathOf = (chain: ReturnType<typeof host.chainOf>, key: string) => {
    const k = `${chain?.root}|${chain?.expiry}|${key}`;
    let got = paths.get(k);
    if (!got) {
      got = (chain?.byContract.get(key) ?? []).map(q => ({ t: q.t, bid: q.bid, ask: q.ask }));
      paths.set(k, got);
    }
    return got;
  };
  /** the first index whose time is after `t` (the path is sorted by time) */
  const firstAfter = (list: readonly { t: number }[], t: number) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const num = (v: number | null | undefined, dp = 7) => (v == null || !Number.isFinite(v) ? '' : Number(v.toPrecision(dp)).toString());
  for (const r of kept) {
    const s = r.setup;
    const chain = host.chainOf(s.ticker, s.expiryDate);
    /* the contract's path from the mark through ten minutes past its flat (all a settlement reads: the fill a full
       minute after the mark, every minute to the first quote at or after the flat), sliced from the sorted path */
    const whole = pathOf(chain, ckey(s.strike, s.right));
    const quotes = whole.slice(firstAfter(whole, r.mark), firstAfter(whole, r.flatAt + 10 * 60_000));
    const under = underCloses(scan.INDEX_OF[s.ticker] ?? s.ticker);
    const sigBase = { right: s.right, firedAt: r.mark, ...(closeMin != null ? { closeMin } : {}), flatAt: r.flatAt };
    const endNow = r.flatAt + 86_400_000;
    const a = settleSignal({ ...sigBase, book: 'A', runner: false }, quotes, under, endNow);
    const run = settleSignal({ ...sigBase, book: 'A', runner: true }, quotes, under, endNow);
    let win: number | null = null;
    let win2: number | null = null;
    let best = NaN;
    if (a.fill) {
      const ask = a.fill.ask;
      const tp = params.takeProfitPx(ask);
      const tp2 = params.targetPx(ask, 2);
      const stop = ask * params.STOP_KEEP;
      win = 0;
      win2 = 0;
      let done1 = false;
      let done2 = false;
      let mx = 0;
      for (const q of quotes) {
        if (q.t <= a.fill.at || q.t > r.flatAt) continue;
        if (!(q.ask > 0) || !(q.bid >= 0) || q.ask < q.bid) continue;
        mx = Math.max(mx, q.bid);
        if (!done1) {
          if (q.bid >= tp) { win = 1; done1 = true; } else if (q.bid <= stop) done1 = true;
        }
        if (!done2) {
          if (q.bid >= tp2) { win2 = 1; done2 = true; } else if (q.bid <= stop) done2 = true;
        }
      }
      best = mx > 0 ? mx / ask : NaN;
    }
    const ret = (o: typeof a) => (o.fill && o.exit && o.status === 'closed' ? o.exit.px / o.fill.ask - 1 : NaN);
    const p = nyParts(r.mark);
    const row = [day, s.sleeve, s.ticker, s.id, s.expiryDate, s.right, s.strike, `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, r.mark, r.pass, r.order, r.session, r.regularDay ? 1 : 0, r.trained ? 1 : 0,
      r.aGeom ? 1 : 0, r.bGeom ? 1 : 0, r.burns1 ? 1 : 0, r.burns2 ? 1 : 0, r.dte, r.tm, num(r.retOpen), Math.round((r.flatAt - r.mark) / 60_000), s.bid, s.ask, num(r.p1, 10), num(r.prun, 10), r.atmMoved ? 1 : 0,
      ...r.x1.map(v => num(v)), ...V2_COLS.map(i => num(r.x2[i])),
      num(a.fill?.ask), a.fill ? Math.round((a.fill.at - r.mark) / 1000) : '', win ?? '', win2 ?? '', num(ret(a)), num(ret(run)), num(best)];
    lines.push(row.join(','));
  }
  if (lh.netFailures > 0) {
    console.log(`${day}: ${lh.netFailures} reads did not answer; not written`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, `${day}.csv.gz.tmp`);
  fs.writeFileSync(tmp, zlib.gzipSync(lines.join('\n')));
  fs.renameSync(tmp, path.join(OUT, `${day}.csv.gz`));
  fs.writeFileSync(path.join(OUT, `${day}.meta.json`), JSON.stringify({ day, close: closeMin, marks, rows: kept.length, mismatch, unknown: host.unknown.slice(0, 10), seconds: Math.round((Date.now() - t0) / 1000) }));
  console.log(`${day}: ${marks} marks, ${kept.length} rows, v1/v2 mismatch outside the clock columns ${mismatch}, ${Math.round((Date.now() - t0) / 1000)} s`);
}

if (args.includes('--one')) {
  await buildOne(days[0]);
  process.exit(0);
}
const pending = days.filter(d => args.includes('--force') || !fs.existsSync(path.join(OUT, `${d}.meta.json`)));
const conc = Math.max(1, Number(process.env.GB_BUILD_CONC) || 2);
let next = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (next < pending.length) {
    const d = pending[next++];
    if (!fs.existsSync(path.join(SRC, 'raw', d.replace(/-/g, ''), '_done.json'))) {
      console.log(`${d}: not in the cache`);
      continue;
    }
    await new Promise<void>(res => {
      const child = spawn(process.execPath, ['--max-old-space-size=3000', ...process.execArgv, fileURLToPath(import.meta.url), '--one', d], { stdio: 'inherit', env: process.env });
      child.on('exit', code => {
        if (code) console.log(`${d}: build exited ${code}`);
        res();
      });
    });
  }
}));
process.exit(0);
