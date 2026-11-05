/*
  Challenger rows: one session day through the engine's own late path (the replay's loop: atMark, scoreBook late,
  recordPicks, Book C's 15:20 sweep), answered from the bulk cache (localHost.ts). Every row the scan built inputs
  for (compassModel onFeatureRow) that is a Book A or Book B candidate inside the entry minutes is written with:
    - its 56 live inputs, Model 1 (Hit score) and Model 2 (Runner score) as the engine scored them (null where they
      are not scored, e.g. overnight);
    - the challenger's inputs (src/data/challengerFeatures.ts, the same function the shadow runs live);
    - the gates the books applied, the batch (one scoring pass) and its order, for the seat simulation;
    - its outcome under the books' exits on the contract's one-minute NBBO (compassOutcome settleSignal: the fill a
      full minute after the mark, the 0.5322 stop, the break-even at 1.25x, the 1.50x take-profit or the runner's
      ratchet, the 0.40% reversal, the session's own flat), both as a non-runner and as a runner;
    - the move's anatomy (time to +50%, the best bid, the greeks attribution of the mid's change to the +50% or the
      flat: delta, gamma, vega, theta, residual).
  The engine's own would-calls (Books A, B and C) are written beside them.

    npx tsx research/challenger/build.ts 2026-10-30 [2026-10-29 …]        (each day in its own process)
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA } from './fetch';

const OUT = path.join(DATA, 'rows');
const VERSION = 'rows/3';
const args = process.argv.slice(2);
const days = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

async function buildOne(day: string): Promise<void> {
  const { localTheta, barsOn, ckey } = await import('./localHost');
  const { setCompassHost } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassHost');
  const scan = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassScan');
  const model = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassModel');
  const ledger = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassLedger');
  const params = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassParams');
  const { optionScanOpen, odteAsleep, sessionDayOpen } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassSession');
  const { nyWallTime, nyParts } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/core/nyTime');
  const { sessionCloseMinOn } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/core/calendar');
  const { settleSignal } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassOutcome');
  const { challengerFeatures, CHALLENGER_N, paritySpot, yearsToExpiry } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/challengerFeatures');
  const { ivStates, bsStates } = await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassFeatures');

  const root = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer'; /* the challenger's engine tree (public/ assets): the same code that built the first-look rows */
  const host = localTheta(day, { net: process.env.CHAL_NET === '1' });
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
  ledger.setSessionClose(closeMin);
  model.setScoreClose(ymd, closeMin);
  model.rollModelDay(ymd);
  ledger.importSignals([]);
  ledger.importWould([]);

  type Kept = { r: import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassModel').FeatureRow; f: number[]; order: number };
  const kept: Kept[] = [];
  let order = 0;
  const batches: { batch: number; mark: number; job: number; sym: string; sleeve: string }[] = [];
  let job = 0;
  let curJob = { sym: '', sleeve: '' };
  const off = model.onFeatureRow(r => {
    if (!r.gates.entryOk || !(r.gates.aGate || r.gates.bGate)) return;
    const f = challengerFeatures({ ...r, gates: r.gates });
    /* only what the row file needs: the board, the window and the bars are the mark's, not the row's */
    const slim = { ...r, list: [], window: null, bars: [], spy: [], prior: null, priorSpy: null, pin: null, x: r.x.slice() };
    kept.push({ r: slim, f, order: order++ });
  }, b => {
    batches.push({ batch: b.batch, mark: b.mark, job, sym: curJob.sym, sleeve: curJob.sleeve });
  });

  /* CHAL_SHADOW=1: the shipped shadow challenger runs beside the engine (its calls are written beside the engine's,
     for the parity check against research/challenger/candidates.py) */
  const shadow = process.env.CHAL_SHADOW === '1' ? await import('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassChallenger') : null;
  if (shadow) {
    shadow.resetChallenger(day);
    if (!(await shadow.startChallenger(line => console.log(line)))) console.log(`${day}: the shadow did not start`);
  }
  const [y, mo, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  const endMin = Math.min(15 * 60 + 5, (closeMin ?? 16 * 60) - 5);
  const endAt = nyWallTime(y, mo, d, Math.floor(endMin / 60), endMin % 60);
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
    for (const j of jobs) {
      const snap = await scan.atMark(j.sym, at, j.sleeve);
      if (!snap.ok || !snap.setups.length) continue;
      job += 1;
      curJob = j;
      await model.scoreBook(snap.setups, at, true, true).catch(() => 'fault');
      ledger.recordPicks(at);
    }
  }
  /* Book C: the 15:20 quotes, as the late sweep reads them */
  const cStart = closeMin != null ? closeMin - 40 : 15 * 60 + 20;
  {
    const at = nyWallTime(y, mo, d, Math.floor(cStart / 60), cStart % 60) + 15_000;
    const names = odteAsleep(at) ? [] : scan.odteBook(at).filter(n => optionScanOpen(n, 0, at));
    const snaps = await Promise.all(names.map(sym => scan.atMark(sym, at, 'odte')));
    await model.scoreLottery(snaps.flatMap(s => s.setups), at, true);
    ledger.recordPicks(at);
  }
  off();
  /* the ledger's own settlement of the engine's would-calls (one-minute path from the cache, the 1-second stop and
     target minutes and Book C's seconds from the terminal when CHAL_NET=1), until every call is settled */
  const open = () => ledger.wouldSignals().filter(c => !c.outcome || (c.outcome.status !== 'closed' && c.outcome.status !== 'unavailable'));
  /* without the terminal (CHAL_NET unset) the calls are left for resettle.ts, which reads their 1-second exits */
  for (let pass = 0; process.env.CHAL_NET === '1' && pass < 60 && open().length; pass++) {
    await ledger.settleOpen(Date.now() + pass * 60_000);
    if (open().length) await new Promise(res => setTimeout(res, 1_000));
  }
  const calls = ledger.wouldSignals().slice().sort((a, b) => a.firedAt - b.firedAt);

  /* ---- labels: each kept row settled on its contract's one-minute NBBO ---- */
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
  const batchOf = new Map(batches.map(b => [b.batch, b]));
  const head = ['day', 'sleeve', 'ticker', 'contract', 'expiry', 'right', 'strike', 'mark', 'batch', 'job', 'order', 'session', 'flatAt', 'bid', 'ask', 'mid', 'aGate', 'bGate', 'burns', 'dist', 'span', 'dte', 'retOpen', 'trained', 'p1', 'prun',
    ...Array.from({ length: 56 }, (_, i) => `x${i}`), ...Array.from({ length: CHALLENGER_N }, (_, i) => `c${i}`),
    'fill', 'fillAt', 'exitA', 'whyA', 'pnlA', 'exitR', 'whyR', 'pnlR', 'best', 'hit50', 'min50', 'worstPre', 'flatBid',
    'atS0', 'atS1', 'atIv0', 'atIv1', 'atMin', 'atDelta', 'atGamma', 'atVega', 'atTheta', 'atResid'];
  const lines: string[] = [head.join(',')];
  const num = (v: number | null | undefined, dp = 6) => (v == null || !Number.isFinite(v) ? '' : Number(v.toPrecision(dp)).toString());
  for (const k of kept) {
    const r = k.r;
    const s = r.setup;
    const chain = host.chainOf(s.ticker, s.expiryDate);
    const path0 = chain?.byContract.get(ckey(s.strike, s.right)) ?? [];
    const quotes = path0.map(q => ({ t: q.t, bid: q.bid, ask: q.ask }));
    const under = underCloses(scan.INDEX_OF[s.ticker] ?? s.ticker);
    const book = r.gates.aGate ? 'A' : 'B';
    const sigBase = { book: book as 'A' | 'B', right: s.right, firedAt: r.now, ...(closeMin != null ? { closeMin } : {}), flatAt: r.gates.flatAt };
    const endNow = r.gates.flatAt + 86_400_000;
    const a = settleSignal({ ...sigBase, book: 'A', runner: false }, quotes, under, endNow);
    const run = settleSignal({ ...sigBase, book: 'A', runner: true }, quotes, under, endNow);
    let best = NaN;
    let hit50 = 0;
    let min50 = NaN;
    let worstPre = NaN;
    let flatBid = NaN;
    let att: number[] = Array(11).fill(NaN);
    if (a.fill) {
      const fill = a.fill;
      const after = quotes.filter(q => q.t > fill.at && q.t <= r.gates.flatAt);
      let mx = 0;
      let mn = Infinity;
      let hitAt = NaN;
      for (const q of after) {
        if (!(q.ask > 0)) continue;
        if (q.bid > mx) mx = q.bid;
        if (!Number.isFinite(hitAt)) {
          if (q.bid >= fill.ask * 1.5) hitAt = q.t;
          else mn = Math.min(mn, q.bid);
        }
      }
      best = mx > 0 ? mx / fill.ask : NaN;
      hit50 = Number.isFinite(hitAt) ? 1 : 0;
      min50 = Number.isFinite(hitAt) ? (hitAt - fill.at) / 60_000 : NaN;
      worstPre = Number.isFinite(mn) ? mn / fill.ask : NaN;
      const lastQ = after[after.length - 1];
      flatBid = lastQ ? lastQ.bid / fill.ask : NaN;
      /* the greeks attribution of the mid's change from the mark to the +50% (or the last quote before the flat) */
      const endQ = Number.isFinite(hitAt) ? after.find(q => q.t === hitAt) : lastQ;
      if (chain && endQ) {
        const boardAt = (t: number) => {
          const key = path0.find(q => q.t === t)?.key;
          const list = key ? chain.byMinute.get(key) ?? [] : [];
          return list.map(q => ({ strike: q.strike, right: q.right, mid: (q.bid + q.ask) / 2 }));
        };
        const T0 = yearsToExpiry(s.expiryDate, r.now);
        const T1 = yearsToExpiry(s.expiryDate, endQ.t);
        const S0 = paritySpot(boardAt(Math.floor(r.now / 60_000) * 60_000), T0);
        const S1 = paritySpot(boardAt(endQ.t), T1);
        const m0 = s.mid;
        const m1 = (endQ.bid + endQ.ask) / 2;
        const call = s.right === 'C';
        const iv0 = ivStates(m0, S0, s.strike, T0, call);
        const iv1 = ivStates(m1, S1, s.strike, T1, call);
        if (S0 > 0 && S1 > 0 && iv0 > 0.011) {
          const g = bsStates(S0, s.strike, T0, iv0, call);
          const dS = S1 - S0;
          const dSig = iv1 > 0.011 ? iv1 - iv0 : 0;
          const dtDays = (endQ.t - r.now) / 86_400_000;
          const dl = g.de * dS;
          const gm = 0.5 * g.ga * dS * dS;
          const vg = g.ve * dSig * 100;
          const th = g.th * dtDays;
          const res = m1 - m0 - dl - gm - vg - th;
          att = [S0, S1, iv0, iv1 > 0.011 ? iv1 : NaN, (endQ.t - r.now) / 60_000, dl / m0, gm / m0, vg / m0, th / m0, res / m0];
        }
      }
    }
    const b = batchOf.get(r.batch);
    const p = nyParts(r.now);
    const row = [day, s.sleeve, s.ticker, s.contract, s.expiryDate, s.right, s.strike, `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, r.batch, b?.job ?? '', k.order, r.gates.session ?? '', Math.round((r.gates.flatAt - r.now) / 60_000), s.bid, s.ask, num(s.mid), r.gates.aGate ? 1 : 0, r.gates.bGate ? 1 : 0, r.gates.burns ? 1 : 0, num(r.gates.dist), num(r.gates.span), num(r.gates.dte), num(r.gates.retOpen), r.gates.trained ? 1 : 0, num(r.p1, 10), num(r.prun, 10),
      ...r.x.map(v => num(v)), ...k.f.map(v => num(v)),
      num(a.fill?.ask), a.fill ? Math.round((a.fill.at - r.now) / 1000) : '', num(a.exit?.px), JSON.stringify(a.exit?.why ?? '').replace(/,/g, ';'), num(a.pnl), num(run.exit?.px), JSON.stringify(run.exit?.why ?? '').replace(/,/g, ';'), num(run.pnl), num(best), a.fill ? hit50 : '', num(min50), num(worstPre), num(flatBid),
      ...att.slice(0, 10).map(v => num(v))];
    lines.push(row.join(','));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const lh = await import('./localHost');
  if (lh.netFailures > 0) {
    /* the terminal did not answer a read (Book C's 15:20:15 board, a 1-second exit window): the day is built again
       on a later pass rather than written with a hole */
    console.log(`${day}: ${lh.netFailures} terminal reads did not answer; not written, built again later`);
    return;
  }
  if (process.env.CHAL_SHADOW !== '1') {
    const tmp = path.join(OUT, `${day}.csv.gz.tmp`);
    fs.writeFileSync(tmp, zlib.gzipSync(lines.join('\n')));
    fs.renameSync(tmp, path.join(OUT, `${day}.csv.gz`));
  }
  const shadowOut = shadow ? shadow.shadowCalls().map(c => ({ contract: c.contract, sleeve: c.sleeve, book: c.book, mark: c.mark, pc: c.pc, runner: c.runner, session: c.tapeSession ?? null })) : undefined;
  if (shadow) shadow.stopChallenger();
  if (process.env.CHAL_SHADOW === '1') {
    /* a parity run writes only its shadow calls, beside the built day */
    fs.writeFileSync(path.join(OUT, `${day}.shadow.json`), JSON.stringify({ day, shadow: shadowOut }, null, 1));
    console.log(`${day}: ${shadowOut?.length ?? 0} shadow calls`);
    return;
  }
  fs.writeFileSync(path.join(OUT, `${day}.calls.json`), JSON.stringify({ version: VERSION, day, close: closeMin, marks, rows: kept.length, unknown: host.unknown.slice(0, 20), ...(process.env.CHAL_NET === '1' ? {} : { netless: true }), calls }, null, 1));
  console.log(`${day}: ${marks} marks, ${kept.length} rows, ${calls.length} engine would-calls, ${Math.round((Date.now() - t0) / 1000)} s`);
}

if (args.includes('--one')) {
  await buildOne(days[0]);
  process.exit(0);
}
/* the days to build: those named, or (none named) every fetched day not built yet, newest first, picked up as the
   fetcher lands them until --minutes have passed */
const stopAt = Date.now() + Number(args[args.indexOf('--minutes') + 1] || 110) * 60_000;
const named = days.length > 0;
const pending = () => {
  if (named) return days.filter(d => args.includes('--force') || !fs.existsSync(path.join(OUT, `${d}.calls.json`)));
  const raw = path.join(DATA, 'raw');
  return (fs.existsSync(raw) ? fs.readdirSync(raw) : [])
    .filter(d => /^\d{8}$/.test(d) && fs.existsSync(path.join(raw, d, '_done.json')))
    .map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`)
    .filter(d => !fs.existsSync(path.join(OUT, `${d}.calls.json`)))
    /* CHAL_PREFIX=2022: only the days that start with it (one builder on one regime) */
    .filter(d => !process.env.CHAL_PREFIX || d.startsWith(process.env.CHAL_PREFIX))
    .sort((a, b) => (args.includes('--oldest') ? (a < b ? -1 : 1) : a < b ? 1 : -1));
};
const taken = new Set<string>();
const conc = Math.max(1, Number(process.env.CHAL_BUILD_CONC) || 2);
await Promise.all(Array.from({ length: conc }, async () => {
  for (;;) {
    if (Date.now() > stopAt) return;
    /* a day another builder is on (its lock under 40 minutes old) is left to it */
    const lockOf = (x: string) => path.join(OUT, `${x}.lock`);
    const busy = (x: string) => fs.existsSync(lockOf(x)) && Date.now() - fs.statSync(lockOf(x)).mtimeMs < 40 * 60_000;
    const d = pending().find(x => !taken.has(x) && !busy(x));
    if (d) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(lockOf(d), String(process.pid));
    }
    if (!d) {
      if (named) return;
      await new Promise(res => setTimeout(res, 30_000));
      continue;
    }
    taken.add(d);
    if (!fs.existsSync(path.join(DATA, 'raw', d.replace(/-/g, ''), '_done.json'))) {
      console.log(`${d}: not fetched yet`);
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
