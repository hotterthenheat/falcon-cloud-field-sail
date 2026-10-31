/*
  Compass replayed over recorded sessions, through the engine's own late path: every 5-minute mark from 09:30 ET is
  read from the quotes ThetaData recorded at that instant (compassScan atMark), scored by the scan's own scorer
  (compassModel scoreBook, late) with its gates and seats, written by the ledger (recordPicks), Book C swept from its
  15:20 quotes (scoreLottery), and every call settled by the ledger's own settlement (settleOpen: the one-minute NBBO,
  the 1-second quotes of each stop/target minute, the fees). A late mark never makes an official call: what each mark
  would have called is the "would" list, and that list is the replay's book (five seats, one book a root, as live).

  Each session runs in its own process (the scorer's memos are per process) and writes
  .cache/compass/replay/YYYY-MM-DD.json: every mark and what happened to each name, the gate funnel (contracts on the
  board, past the spread, scored, at or over the line, inside the entry minutes), every contract at or over the line,
  every call with its fill, exit and P&L after fees, and the checks below.

    npx tsx scripts/compass-replay.ts 2026-10-26 2026-10-27 …     replay those sessions (two at a time), then the table
    npx tsx scripts/compass-replay.ts --table 2026-10-26 …         the table from the files already written
    npx tsx scripts/compass-replay.ts --verify 2026-10-26 …        each call re-derived from the raw REST rows by an
                                                                   independent reading of the rules (no app code)

  THETA_BASE is the terminal's REST base (default http://127.0.0.1:25503/v3). REPLAY_CONC caps the requests in
  flight (default 5; the terminal takes eight across every client). REPLAY_LAST is the last mark (default 15:05, the
  first mark past the entry gate). A live snapshot is refused (a replay must not read today's book): only the open
  interest snapshot is answered, from that session's own open-interest history.

  The checks: a fill outside the 3-minute window or before its mark's next minute, an exit before its fill, a Book A/B
  call outside t 15–330 or within 55 minutes of the flat, a Book C call outside its window, two calls on one root, more
  than five seats, a NaN in any number.
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.REPLAY_OUT || path.join(root, '.cache', 'compass', 'replay');
const BASE = process.env.THETA_BASE || 'http://127.0.0.1:25503/v3';
const CONC = Math.max(1, Number(process.env.REPLAY_CONC) || 5);
const LAST = process.env.REPLAY_LAST || '15:05';

const asIso = (a: string) => (/^\d{8}$/.test(a) ? `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}` : a);
const args = process.argv.slice(2);
const days = args.filter(a => /^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(a)).map(asIso);

/* ---- the terminal, read directly, at most CONC at a time ---- */

let inFlight = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= CONC) await new Promise<void>(res => waiters.push(res));
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    waiters.shift()?.();
  }
}

async function rawGet(p: string): Promise<{ status: number; body: string; type: string }> {
  for (let i = 0; ; i++) {
    try {
      const r = await slot(() => fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(60_000) }));
      const body = await r.text();
      /* a transient answer (an empty 200, a 5xx, busy) is asked again here: the replay reads the record, not the
         terminal's mood. The engine's own handling of those is checked in the golden. */
      if ((r.status === 200 && !body.trim()) || r.status >= 500 || r.status === 429) {
        if (i < 6) {
          await new Promise(res => setTimeout(res, 500 * 2 ** i));
          continue;
        }
      }
      return { status: r.status, body, type: r.headers.get('content-type') || '' };
    } catch {
      if (i >= 6) return { status: 503, body: '', type: 'text/plain' };
      await new Promise(res => setTimeout(res, 1_000 * 2 ** i));
    }
  }
}

/* ---- one session, in this process ---- */

interface FunnelRow { board: number; spread: number; scored: number; line: number; entry: number; noRunner: number; would: number }
interface MarkOut { clock: string; t: number; kind: 'overnight' | 'pre' | 'regular'; sleeve: 'odte' | 'weekly'; names: Record<string, string>; funnel: FunnelRow; over: { contract: string; p1: number; prun: number | null; why: string[] }[] }

async function replayOne(day: string): Promise<void> {
  const { setCompassHost } = await import('../src/data/compassHost');
  const { thetaAnswer } = await import('../src/data/compassServer');
  const scan = await import('../src/data/compassScan');
  const { atMark, odteBook, WEEKLY_FOCUS } = scan;
  const model = await import('../src/data/compassModel');
  const ledger = await import('../src/data/compassLedger');
  const { optionScanOpen, odteAsleep, sessionDayOpen } = await import('../src/data/compassSession');
  const { nyWallTime, nyParts } = await import('../src/core/nyTime');
  const params = await import('../src/data/compassParams');
  const { sessionCloseMinOn } = await import('../src/core/calendar');

  const ymd = day.replace(/-/g, '');
  const memo = new Map<string, Promise<{ status: number; body: string; type: string }>>();
  const refused: string[] = [];
  let asked = 0;
  setCompassHost({
    server: true,
    theta: async p => {
      let q = p;
      const oi = /^\/option\/snapshot\/open_interest\?(.*)$/.exec(p);
      if (oi) q = `/option/history/open_interest?${oi[1].replace(/&?format=json/, '')}&date=${ymd}&format=json`;
      else if (/\/snapshot\//.test(p)) {
        refused.push(p);
        return { status: 404, data: null, error: 'a replay reads no live snapshot' };
      }
      let job = memo.get(q);
      if (!job) {
        asked += 1;
        job = rawGet(q);
        memo.set(q, job);
      }
      const got = await job;
      return thetaAnswer(got.status, got.body, got.type);
    },
    asset: async p => {
      const b = fs.readFileSync(path.join(root, 'public', p.replace(/^\/+/, '')));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    /* the week's high-impact releases inside the session (the live engine reads Unusual Whales' calendar; the replay
       week's one intraday release is the FOMC decision, Wednesday 2026-10-28 14:00 ET) */
    econ: () => (ymd === '20261028' ? [{ date: new Date(2026, 9, 28, 14, 0), time: '14:00', title: 'FOMC Interest Rate Decision' }] : []),
  });

  const close = sessionCloseMinOn(day);
  const closeMin = close < 16 * 60 ? close : null;
  ledger.setSessionClose(closeMin);
  model.setScoreClose(ymd, closeMin);
  model.rollModelDay(ymd);
  ledger.importSignals([]);
  ledger.importWould([]);

  const [y, mo, d] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  const lastMin = Number(LAST.slice(0, 2)) * 60 + Number(LAST.slice(3, 5));
  const flatT = params.flatTOf(closeMin);
  let collecting = false;
  let rows: { sleeve: string; contract: string; p1: number; prun: number | null; t: number }[] = [];
  model.onScoredRow(r => {
    if (collecting) rows.push({ sleeve: r.setup.sleeve, contract: r.setup.contract, p1: r.p1, prun: r.prun, t: r.x[0] });
  });

  const marks: MarkOut[] = [];
  const t0 = Date.now();
  /* every mark of the session's book, from 20:15 ET the evening before (the overnight index session, the equity
     options' pre-market from 07:30, VIX's 09:29, the regular session) to REPLAY_LAST, on the engine's own grid */
  const endMin = Math.min(lastMin, (closeMin ?? 16 * 60) - 5);
  const endAt = nyWallTime(y, mo, d, Math.floor(endMin / 60), endMin % 60);
  const gridAt: number[] = [];
  for (let at = scan.sessionOpenAt(day); at <= endAt; at += 60_000) {
    const p = nyParts(at);
    if (params.sessionScanOpen(p.hour * 60 + p.minute, p.weekday) && sessionDayOpen(at)) gridAt.push(at);
  }
  const onlyFrom = process.env.REPLAY_FROM ? Number(process.env.REPLAY_FROM.slice(0, 2)) * 60 + Number(process.env.REPLAY_FROM.slice(3, 5)) : null;
  for (const at of gridAt) {
    const p = nyParts(at);
    const m = p.hour * 60 + p.minute;
    if (onlyFrom != null && (p.day !== d || m < onlyFrom)) continue;
    const t = m - (9 * 60 + 30);
    const kind: MarkOut['kind'] = m >= 20 * 60 + 15 || m < 7 * 60 + 30 ? 'overnight' : m < 9 * 60 + 30 ? 'pre' : 'regular';
    const jobs: { sym: string; sleeve: 'odte' | 'weekly' }[] = [
      ...(odteAsleep(at) ? [] : odteBook(at).filter(n => optionScanOpen(n, 0, at))).map(sym => ({ sym, sleeve: 'odte' as const })),
      ...WEEKLY_FOCUS.filter(n => optionScanOpen(n, 1, at)).map(sym => ({ sym, sleeve: 'weekly' as const })),
    ];
    /* every read of the mark first, in parallel and on a copy of the state; then the names scored in the book's own
       order, one at a time, so the seats go the same way on every run (live, the first name to answer goes first) */
    const pack = model.exportModelState();
    let i = 0;
    await Promise.all(Array.from({ length: CONC + 2 }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        const snap = await atMark(job.sym, at, job.sleeve);
        if (snap.setups.length) await model.scoreBook(snap.setups, at, true, true).catch(() => 'fault');
      }
    }));
    model.importModelState(pack, null);
    rows = [];
    collecting = true;
    const out: Record<'odte' | 'weekly', MarkOut> = {
      odte: { clock: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, t, kind, sleeve: 'odte', names: {}, funnel: { board: 0, spread: 0, scored: 0, line: 0, entry: 0, noRunner: 0, would: 0 }, over: [] },
      weekly: { clock: '', t, kind, sleeve: 'weekly', names: {}, funnel: { board: 0, spread: 0, scored: 0, line: 0, entry: 0, noRunner: 0, would: 0 }, over: [] },
    };
    out.weekly.clock = out.odte.clock;
    const wouldBefore = new Set(model.exportModelState().wouldSeen ?? []);
    for (const job of jobs) {
      const snap = await atMark(job.sym, at, job.sleeve);
      const o = out[job.sleeve];
      if (!snap.ok) {
        o.names[job.sym] = 'fault';
        continue;
      }
      if (!snap.rows) {
        o.names[job.sym] = 'none';
        continue;
      }
      if (!snap.setups.length) {
        o.names[job.sym] = 'quiet';
        continue;
      }
      o.funnel.board += snap.setups.length;
      o.funnel.spread += snap.setups.filter(s => params.spreadPass(s.bid, s.ask)).length;
      const result = await model.scoreBook(snap.setups, at, true, true).catch(() => 'fault' as const);
      o.names[job.sym] = result === 'scored' ? 'scored' : result;
      ledger.recordPicks(at);
    }
    collecting = false;
    for (const r of rows) {
      const o = out[r.sleeve === 'weekly' ? 'weekly' : 'odte'];
      o.funnel.scored += 1;
      if (r.prun == null) o.funnel.noRunner += 1;
      if (r.p1 + 1e-12 >= params.P1_MIN) {
        o.funnel.line += 1;
        if (params.entryTimeOk(r.t, flatT, params.OVERNIGHT_ROOTS.includes(r.contract.split(' ')[0]))) o.funnel.entry += 1;
        const ticker = r.contract.split(' ')[0];
        o.over.push({ contract: r.contract, p1: Number(r.p1.toFixed(6)), prun: r.prun == null ? null : Number(r.prun.toFixed(6)), why: model.passedOver(ticker).filter(n => n.startsWith(r.contract) || !/^[A-Z]+ \d/.test(n)) });
      }
    }
    const wouldNow = model.exportModelState().wouldSeen ?? [];
    for (const id of wouldNow) if (!wouldBefore.has(id)) {
      const sig = ledger.wouldSignals().find(s => s.id === id);
      if (sig) out[sig.sleeve === 'weekly' ? 'weekly' : 'odte'].funnel.would += 1;
    }
    marks.push(out.odte, out.weekly);
    memo.clear();
    const f = (x: FunnelRow) => `${x.board}/${x.spread}/${x.scored}/${x.line}/${x.entry}/${x.would}`;
    process.stdout.write(`${day} ${out.odte.clock} 0DTE ${f(out.odte.funnel)} weekly ${f(out.weekly.funnel)} · ${asked} asks · ${Math.round((Date.now() - t0) / 1000)} s\n`);
  }

  /* Book C: the 15:20 quotes, as the late sweep reads them (15:20:15, every same-day root) */
  let lottery: { names: Record<string, string>; found: number } | null = null;
  const cStart = closeMin != null ? closeMin - 40 : 15 * 60 + 20;
  if (lastMin >= 15 * 60 + 5 || closeMin != null) {
    const at = nyWallTime(y, mo, d, Math.floor(cStart / 60), cStart % 60) + 15_000;
    const names = odteAsleep(at) ? [] : odteBook(at).filter(n => optionScanOpen(n, 0, at));
    const snaps = await Promise.all(names.map(sym => atMark(sym, at, 'odte')));
    lottery = { names: {}, found: 0 };
    const found = snaps.flatMap((s, k) => {
      lottery!.names[names[k]] = !s.ok ? 'fault' : !s.rows ? 'none' : s.setups.length ? 'scored' : 'quiet';
      return s.setups;
    });
    lottery.found = found.length;
    await model.scoreLottery(found, at, true);
    ledger.recordPicks(at);
  }

  /* settlement: the ledger's own, over the whole session (every path is complete) */
  for (let pass = 0; pass < 3; pass++) {
    await new Promise(res => setTimeout(res, 100));
    await ledger.settleOpen(Date.now() + pass * 60_000);
  }
  const calls = ledger.wouldSignals().slice().sort((a, b) => a.firedAt - b.firedAt);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${day}.json`), JSON.stringify({ day, close: closeMin, builtAt: Date.now(), asked, refused, marks, lottery, calls }, null, 1));
  console.log(`${day}: ${marks.length / 2} marks, ${calls.length} calls, ${asked} asks, ${refused.length} snapshots refused, ${Math.round((Date.now() - t0) / 1000)} s`);
}

/* ---- the table and the checks ---- */

type Sig = { book: 'A' | 'B' | 'C'; ticker: string; contract: string; day: string; expiry: string; sleeve: string; firedAt: number; mark?: number; tapeSession?: 'overnight' | 'pre' | 'regular' | 'curb'; outsideTrained?: true; flatAt?: number; bid: number; ask: number; p1: number | null; prun: number | null; runner: boolean; closeMin?: number; outcome: { status: string; fill: { at: number; bid: number; ask: number } | null; exit: { at: number; px: number; why: string } | null; peak: number; ret: number | null; pnl: number | null; fees: number | null } | null };

const ny = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
const nyMin = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  return (Number(p.find(x => x.type === 'hour')?.value) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value);
};

async function checks(day: string, calls: Sig[]): Promise<string[]> {
  const params = await import('../src/data/compassParams');
  const bad: string[] = [];
  const nan = (label: string, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${day} ${label}: ${v}`);
  };
  const roots = new Map<string, string>();
  let seats = 0;
  let cSeats = 0;
  for (const c of calls) {
    const w = `${c.contract} ${c.expiry} (${c.book})`;
    for (const k of ['bid', 'ask', 'firedAt', 'p1', 'prun'] as const) nan(`${w} ${k}`, c[k]);
    const o = c.outcome;
    if (!o) {
      bad.push(`${day} ${w}: no outcome`);
      continue;
    }
    for (const k of ['peak', 'ret', 'pnl', 'fees'] as const) nan(`${w} ${k}`, o[k]);
    const mark = c.mark ?? Math.floor(c.firedAt / 60_000) * 60_000;
    const t = nyMin(mark) - (9 * 60 + 30);
    const flatT = params.flatTOf(c.closeMin ?? null);
    const overnightRoot = params.OVERNIGHT_ROOTS.includes(c.ticker);
    if (c.book !== 'C' && !params.entryTimeOk(t, flatT, overnightRoot)) bad.push(`${day} ${w}: called at ${ny(mark)} (under 15 minutes into its session or under 55 before its flat)`);
    if (c.book !== 'C' && !!c.outsideTrained === params.inModelWindow(t)) bad.push(`${day} ${w}: "outside trained hours" label wrong at t=${t}`);
    if (c.book === 'C') {
      const m = nyMin(c.firedAt);
      const start = c.closeMin != null && c.closeMin < 16 * 60 ? c.closeMin - 40 : 15 * 60 + 20;
      if (m < start || m >= start + 30) bad.push(`${day} ${w}: Book C at ${ny(c.firedAt)}`);
      cSeats += 1;
    } else {
      const had = roots.get(c.ticker);
      if (had) bad.push(`${day} ${w}: ${c.ticker} already holds a ${had} seat`);
      roots.set(c.ticker, c.book);
      seats += 1;
    }
    if (o.fill) {
      if (o.fill.at < mark + 60_000) bad.push(`${day} ${w}: fill ${ny(o.fill.at)} before the minute after the mark ${ny(mark)}`);
      if (o.fill.at > c.firedAt + 3 * 60_000) bad.push(`${day} ${w}: fill ${ny(o.fill.at)} more than 3 minutes after the call`);
      if (!(o.fill.ask >= o.fill.bid && o.fill.bid >= 0 && o.fill.ask > 0)) bad.push(`${day} ${w}: fill quote ${o.fill.bid}×${o.fill.ask} is not an NBBO`);
      for (const k of ['bid', 'ask'] as const) nan(`${w} fill.${k}`, o.fill[k]);
    }
    if (o.exit && o.fill && o.exit.at <= o.fill.at) bad.push(`${day} ${w}: exit ${ny(o.exit.at)} at or before the fill ${ny(o.fill.at)}`);
    if (o.exit && c.flatAt && o.exit.at > c.flatAt + 60_000 && !/^Last quote/.test(o.exit.why)) bad.push(`${day} ${w}: exit ${ny(o.exit.at)} after its flat ${ny(c.flatAt)}`);
    if (o.exit) nan(`${w} exit.px`, o.exit.px);
  }
  if (seats > 5) bad.push(`${day}: ${seats} Book A/B seats (five at most)`);
  if (cSeats > 5) bad.push(`${day}: ${cSeats} Book C calls (five at most)`);
  return bad;
}

async function table(list: string[]): Promise<void> {
  const { trackLine, sessionOfSignal } = await import('../src/data/compassTrack');
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const head = 'slice                    calls  won lost  hit%  avg ret%   total $  outside  worst';
  const all: Sig[] = [];
  const problems: string[] = [];
  const funnel: Record<string, { marks: number; board: number; spread: number; scored: number; line: number; entry: number; would: number }> = {};
  const lines: string[] = [];
  for (const day of list) {
    const file = path.join(OUT, `${day}.json`);
    if (!fs.existsSync(file)) {
      lines.push(`${day}  (not replayed)`);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { calls: Sig[]; marks: MarkOut[]; refused: string[] };
    problems.push(...(await checks(day, doc.calls)));
    if (doc.refused.length) problems.push(`${day}: ${doc.refused.length} live snapshots asked (refused)`);
    const faults = doc.marks.flatMap(m => Object.entries(m.names).filter(([, v]) => v === 'fault').map(([k]) => `${m.clock} ${m.sleeve} ${k}`));
    if (faults.length) problems.push(`${day}: ${faults.length} name-marks did not answer (${faults.slice(0, 6).join(', ')}${faults.length > 6 ? ', …' : ''})`);
    for (const m of doc.marks) {
      const k = m.kind ?? 'regular';
      const f = (funnel[k] ??= { marks: 0, board: 0, spread: 0, scored: 0, line: 0, entry: 0, would: 0 });
      if (m.sleeve === 'odte') f.marks += 1;
      f.board += m.funnel.board;
      f.spread += m.funnel.spread;
      f.scored += m.funnel.scored;
      f.line += m.funnel.line;
      f.entry += m.funnel.entry;
      f.would += m.funnel.would;
    }
    all.push(...doc.calls);
    for (const b of ['A', 'B', 'C'] as const) lines.push(line(`${day} ${BOOKW[b]}`, doc.calls.filter(c => c.book === b)));
    lines.push(line(`${day} all`, doc.calls));
  }
  console.log(`\n${head}`);
  for (const l of lines) console.log(l);
  console.log('');
  for (const b of ['A', 'B', 'C'] as const) console.log(line(`week ${BOOKW[b]}`, all.filter(c => c.book === b)));
  for (const k of ['overnight', 'pre', 'regular', 'curb'] as const) console.log(line(`week ${k}`, all.filter(c => sessionOfSignal(c as never) === k)));
  console.log(line('week all', all));
  console.log('\nsession     marks  on board  spread ok    scored  at/over line  entry ok  calls');
  for (const [k, f] of Object.entries(funnel)) console.log(`${k.padEnd(10)} ${pad(f.marks, 6)} ${pad(f.board, 9)} ${pad(f.spread, 10)} ${pad(f.scored, 9)} ${pad(f.line, 13)} ${pad(f.entry, 9)} ${pad(f.would, 6)}`);
  console.log(problems.length ? `\nCHECKS: ${problems.length} problem(s)\n${problems.map(p => `  ${p}`).join('\n')}` : '\nCHECKS: none (fills, exits, entry minutes, labels, seats, NaN)');
  function line(label: string, rows: Sig[]): string {
    const t = trackLine(rows as never);
    const other = t.calls - t.closed;
    return `${label.padEnd(24)} ${pad(t.calls, 5)}${other ? `(${other}?)` : '    '} ${pad(t.won, 3)} ${pad(t.lost, 4)} ${pad(t.hitRate == null ? '–' : (t.hitRate * 100).toFixed(0), 5)} ${pad(t.avgRet == null ? '–' : t.avgRet.toFixed(1), 9)} ${pad(t.pnl.toFixed(2), 9)} ${pad(t.outsideTrained, 8)}  ${t.worst ? `${t.worst.contract} ${t.worst.pnl}` : '–'}`;
  }
}

/* ---- an independent reading of each call from the raw rows (no app code) ---- */

async function verify(list: string[]): Promise<void> {
  const two = (n: number) => String(n).padStart(2, '0');
  const hms = (ms: number) => ny(ms);
  const stampMs = (s: string) => {
    /* "2026-10-29T10:01:00.000" New York wall time; EDT until 2026-11-01 */
    const [d, t] = s.split('T');
    const [hh, mm, ss] = t.split(':');
    const off = d < '2026-11-01' ? 4 : 5;
    return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), Number(hh) + off, Number(mm), 0) + Math.round(Number(ss) * 1000);
  };
  const quotes = async (sig: Sig, extra: string) => {
    const p = `/option/history/quote?symbol=${sig.ticker}&expiration=${sig.expiry.replace(/-/g, '')}&strike=${(sig.contract.split(' ')[1] ?? '').replace(/[CP]$/, '')}&right=${sig.contract.endsWith('C') ? 'call' : 'put'}&start_date=${list0(sig)}&end_date=${list0(sig)}${extra}&format=json`;
    const got = await rawGet(p);
    const doc = JSON.parse(got.body || '{"response":[]}') as { response: { data: { bid: number; ask: number; timestamp: string }[] }[] };
    return (doc.response?.[0]?.data ?? []).map(q => ({ t: stampMs(q.timestamp), bid: q.bid, ask: q.ask }));
  };
  const list0 = (sig: Sig) => new Date(sig.firedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  let n = 0;
  let ok = 0;
  for (const day of list) {
    const file = path.join(OUT, `${day}.json`);
    if (!fs.existsSync(file)) continue;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { calls: Sig[] };
    for (const sig of doc.calls) {
      const o = sig.outcome;
      if (!o?.fill || !o.exit) continue;
      n += 1;
      const minute = await quotes(sig, '&interval=1m');
      const mark = sig.mark ?? Math.floor(sig.firedAt / 60_000) * 60_000;
      const fill = minute.find(q => q.t >= Math.floor(sig.firedAt / 60_000) * 60_000 + 60_000);
      /* the exit by the rules, read again: every minute quote after the fill, and inside a minute the 1-second quotes
         when the minute's bid range crosses a level (stop or target) */
      const paid = fill?.ask ?? NaN;
      const fees = (px: number) => Number((1.08 + px * 100 * 0.0000278 + 0.00279).toFixed(2));
      const runner = sig.book === 'B' || sig.runner;
      const flatMin = sig.closeMin != null && sig.closeMin < 960 ? sig.closeMin - 5 : 955;
      const stopOf = (peak: number) => {
        let s = paid * (1 - 0.5322);
        if (peak >= paid * 1.25) s = Math.max(s, paid + fees(paid) / 100);
        if (runner) {
          if (peak >= paid * 1.5) s = Math.max(s, paid * 1.25);
          if (peak >= paid * 2) s = Math.max(s, paid * 1.5);
          if (peak >= paid * 3) s = Math.max(s, paid * 2.25);
          if (peak >= paid * 4) s = Math.max(s, peak * 0.75);
        }
        return s;
      };
      let mine: { at: number; px: number; why: string } | null = null;
      if (sig.book !== 'C' && fill) {
        let peak = 0;
        let prev = fill;
        const after = minute.filter(q => q.t > fill.t);
        for (const q of after) {
          const levels = [stopOf(peak), paid * 1.25, paid * 1.5, ...(runner ? [paid * 2, paid * 3, paid * 4] : [])];
          const lo = Math.min(prev.bid, q.bid);
          const hi = Math.max(prev.bid, q.bid);
          let path = [q];
          if (levels.some(L => L >= lo && L <= hi)) {
            const fine = await quotes(sig, `&interval=1s&start_time=${hms(prev.t + 1000)}&end_time=${hms(q.t)}`);
            path = [...fine.filter(x => x.t > prev.t && x.t <= q.t && x.t % 60_000 !== 0), q];
          }
          for (const x of path) {
            if (!(x.ask > 0 && x.bid >= 0 && x.ask >= x.bid)) continue;
            const stop = stopOf(peak);
            const m = nyMin(x.t);
            if (x.bid <= stop) { mine = { at: x.t, px: x.bid, why: 'Stop' }; break; }
            if (!runner && x.bid >= paid * 1.5) { mine = { at: x.t, px: Number((paid * 1.5).toFixed(2)), why: 'Take profit 1.50×' }; break; }
            if (x.t % 60_000 === 0 && /reversed/.test(o.exit.why) && x.t === o.exit.at) { mine = { at: x.t, px: x.bid, why: o.exit.why }; break; }
            if (m >= flatMin) { mine = { at: x.t, px: x.bid, why: `${two(Math.floor(flatMin / 60))}:${two(flatMin % 60)} flat` }; break; }
            peak = Math.max(peak, x.bid);
          }
          if (mine) break;
          prev = q;
        }
      }
      const pnl = mine ? Number(((mine.px - paid) * 100 - fees(mine.px)).toFixed(2)) : NaN;
      const same = fill && fill.ask === o.fill.ask && fill.t === o.fill.at && (sig.book === 'C' || (mine && mine.at === o.exit.at && Math.abs(mine.px - o.exit.px) < 1e-9 && mine.why === o.exit.why && pnl === o.pnl));
      if (same) ok += 1;
      const at = (ms: number) => minute.find(q => q.t === Math.floor(ms / 60_000) * 60_000);
      console.log(`${same ? 'OK   ' : 'CHECK'} ${day} ${BOOKW[sig.book]} ${sig.contract} ${sig.expiry} mark ${hms(mark)} fired ${hms(sig.firedAt)} @ ${sig.bid}×${sig.ask}`
        + `\n      raw: fill quote ${fill ? `${hms(fill.t)} ${fill.bid}×${fill.ask}` : 'none'} (engine ${hms(o.fill.at)} ask ${o.fill.ask}); exit minute ${(() => { const q = at(o.exit.at); return q ? `${hms(q.t)} ${q.bid}×${q.ask}` : '–'; })()}`
        + `\n      engine exit ${hms(o.exit.at)} ${o.exit.px} ${o.exit.why} pnl ${o.pnl} fees ${o.fees} · re-read ${mine ? `${hms(mine.at)} ${mine.px} ${mine.why} pnl ${pnl}` : sig.book === 'C' ? '(Book C: fill only)' : 'none'}`);
    }
  }
  console.log(`\nVERIFIED ${ok} of ${n} calls agree with the raw rows`);
}

const BOOKW: Record<string, string> = { A: 'A Core', B: 'B Wing', C: 'C Late sweep' };

/* ---- main ---- */

if (args.includes('--one')) {
  await replayOne(days[0]);
  process.exit(0);
}
if (!days.length) {
  console.error('Usage: npx tsx scripts/compass-replay.ts [--table|--verify] YYYY-MM-DD …');
  process.exit(2);
}
if (args.includes('--verify')) {
  await verify(days);
  process.exit(0);
}
if (!args.includes('--table')) {
  const queue = [...days];
  const run = async () => {
    while (queue.length) {
      const d = queue.shift()!;
      await new Promise<void>(res => {
        const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--one', d], { stdio: 'inherit', env: process.env });
        child.on('exit', () => res());
      });
    }
  };
  await Promise.all([run(), run()]);
}
await table(days);
process.exit(0);
