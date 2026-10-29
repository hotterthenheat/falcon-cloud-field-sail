/// <reference types="node" />
/*
  The official Compass engine, in the Node process that serves the app (the dev server, `npm run serve`). One scan
  for every viewer (data/compassScan.ts), through the same ThetaData hub and eight-request cap the browsers' calls
  use, asked in-process. The record of every call, its settlement and every mark is kept on disk, one file per
  session date (<dir>/YYYY-MM-DD.json), and served read-only at /api/compass/*.

  One process at a time runs the engine: it holds <dir>/engine.lock. A second process on the same folder (a preview
  on another port) serves the files the first one writes and scans nothing.

  This module never runs in a browser bundle. A host without a long-lived process (Vercel) cannot run it: the always-on
  machine beside the terminal would run `npm run serve` and the site would read /api/compass/* from it
  (docs/compass-engine.md).
*/

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { setCompassHost, type EconRow, type ThetaAnswer } from './compassHost';
import { exportModelState, importModelState, lockReason, modelDay, onModelChange, onScoredRow, rollModelDay, type ModelPack } from './compassModel';
import { importSignals, onSignalsChange, setSessionClose, signals, type Signal } from './compassLedger';
import { exportMarks, importMarks, lotterySwept, onMarks, onScanMeta, scanMeta, sessionClose, setLotteryDay, setScanMeta, startScan, stopScan, type MarkRow, type ScanMeta } from './compassScan';
import { sessionIso } from './compassSession';
import type { Setup } from '../types/compass';

export const RECORD_FORMAT = 'compass-record/1';

/** One session's file: the official record (calls and marks) and the engine's state to resume from. */
export interface DayFile {
  format: typeof RECORD_FORMAT;
  /** The session date, YYYY-MM-DD */
  day: string;
  savedAt: number;
  /** The session's early close (minute of the day), or null on a full day */
  close: number | null;
  /** Every Book A, B and C call of the session, newest first, with its settlement */
  calls: Signal[];
  /** Every mark of the session and what happened to each name at it */
  marks: MarkRow[];
  /** Book C swept this session */
  lottery: boolean;
  /** The engine's cards, seats and passes, to resume after a restart */
  state: ModelPack;
  meta: Pick<ScanMeta, 'spots' | 'sparks' | 'line' | 'theta' | 'downSince'>;
}

/** What a browser reads: the board, the record and the engine's own condition. */
export interface CompassState {
  format: typeof RECORD_FORMAT;
  rev: number;
  /** The server's clock when this was taken */
  at: number;
  day: string;
  engine: { running: boolean; readOnly: boolean; startedAt: number; why: string };
  meta: ScanMeta;
  lock: string;
  close: number | null;
  model: ModelPack;
  earlier: { day: string; at: number; setups: Setup[] } | null;
  /** The record: this session's calls and the four sessions before it, newest first */
  signals: Signal[];
  marks: MarkRow[];
}

export interface EngineOptions {
  /** Where the day files live */
  dir: string;
  /** The app's public/ folder (the model files and the universe) */
  publicDir: string;
  /** One ThetaData answer, in-process (server/thetaProxy.mjs thetaDirect) */
  theta: (path: string) => Promise<{ status: number; body: string; type: string }>;
  /** One Unusual Whales answer, in-process (server/uwProxy.mjs uwDirect), for the economic calendar */
  uw?: (path: string) => Promise<{ status: number; body: string }>;
  /** Run the scan (false: serve the files only) */
  scan?: boolean;
  /** The earliest mark of a session to fill in from recorded quotes when the engine starts after it (epoch ms for a
      session date YYYY-MM-DD); the session's 09:30 ET by default */
  backfillFrom?: (day: string) => number;
  log?: (line: string) => void;
}

/* ---- ThetaData answers in the browser client's shape (data/theta.ts) ---- */

function unwrap(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.response)) return o.response;
    if (Array.isArray(o.data)) return o.data;
  }
  return parsed;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes(',')) return [];
  const head = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    head.forEach((h, i) => {
      row[h] = (cols[i] ?? '').trim().replace(/^"|"$/g, '');
    });
    return row;
  });
}

const downStatus = (status: number) => status === 503 || status === 474 || status === 478 || status === 571;

export function thetaAnswer(status: number, body: string, type: string): ThetaAnswer {
  let parsed: unknown = null;
  if (type.includes('json') || body.startsWith('{') || body.startsWith('[')) {
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = body;
    }
  } else {
    const rows = parseCsv(body);
    parsed = rows.length ? rows : body;
  }
  const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const code = o && typeof o.code === 'string' ? o.code : '';
  if (code === 'terminal_down' || code === 'session_lost' || code === 'terminal_unavailable' || downStatus(status) || /not running|invalid session/i.test(String(o?.error ?? ''))) {
    return { status: 503, data: null, error: 'terminal_down' };
  }
  if (status === 472) return { status, data: null, error: 'no_data' };
  if (status === 429) return { status, data: null, error: 'busy' };
  if (status !== 200) return { status, data: unwrap(parsed), error: String(o?.error ?? `unavailable ${status}`).slice(0, 180) };
  return { status, data: unwrap(parsed), error: null };
}

/* ---- the economic calendar ---- */

function econRows(body: string): EconRow[] {
  let rows: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(body) as { data?: unknown };
    rows = Array.isArray(parsed?.data) ? (parsed.data as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const out: EconRow[] = [];
  for (const r of rows) {
    const t = Date.parse(String(r.time ?? ''));
    const title = String(r.event ?? '').trim();
    if (!Number.isFinite(t) || !title) continue;
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map(p => [p.type, p.value]));
    const hh = Number(parts.hour) % 24;
    const mm = Number(parts.minute);
    out.push({ date: new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hh, mm), time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, title });
  }
  return out;
}

/* ---- the engine ---- */

const dayFile = (dir: string, day: string) => path.join(dir, `${day}.json`);

function readDay(dir: string, day: string): DayFile | null {
  try {
    const got = JSON.parse(fs.readFileSync(dayFile(dir, day), 'utf8')) as DayFile;
    return got && got.format === RECORD_FORMAT && got.day === day ? got : null;
  } catch {
    return null;
  }
}

/** The session dates on disk, oldest first. */
export function recordDays(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
  } catch {
    return [];
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Takes the folder's engine lock, or says who holds it. A lock not refreshed for two minutes is stale. */
function takeLock(dir: string): { ok: true } | { ok: false; pid: number } {
  const file = path.join(dir, 'engine.lock');
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid: number; at: number };
    if (held.pid !== process.pid && alive(held.pid) && Date.now() - held.at < 120_000) return { ok: false, pid: held.pid };
  } catch {
    /* no lock yet */
  }
  writeAtomic(file, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return { ok: true };
}

/** Session the signal belongs to (its file): an overnight call after 20:15 ET is the next session's. */
const sessionOf = (s: Signal) => sessionIso(s.firedAt);

export interface Engine {
  state: (rev?: number) => CompassState | null;
  record: (day: string) => DayFile | null;
  days: () => { day: string; calls: number }[];
  stop: () => void;
}

export function startCompassEngine(o: EngineOptions): Engine {
  const log = o.log ?? (() => {});
  fs.mkdirSync(o.dir, { recursive: true });
  const startedAt = Date.now();
  let readOnly = o.scan === false;
  let why = readOnly ? 'The scan is off in this process.' : '';
  if (!readOnly) {
    const lock = takeLock(o.dir);
    if (!lock.ok) {
      readOnly = true;
      why = `Another server process (pid ${lock.pid}) runs the engine; this one serves its record.`;
    }
  }

  let econ: EconRow[] = [];
  let econAt = 0;
  const readEcon = () => {
    if (!o.uw || Date.now() - econAt < 3_600_000) return;
    econAt = Date.now();
    void o.uw('/market/economic-calendar').then(r => {
      if (r.status === 200) econ = econRows(r.body);
    }).catch(() => {
      econAt = 0;
    });
  };

  /* the week's releases are read before the first mark, so a release window is never missed at start */
  readEcon();
  setCompassHost({
    server: true,
    theta: async p => {
      try {
        const got = await o.theta(p);
        return thetaAnswer(got.status, got.body, got.type);
      } catch {
        return { status: 503, data: null, error: 'terminal_down' };
      }
    },
    asset: async p => {
      try {
        const buf = fs.readFileSync(path.join(o.publicDir, p.replace(/^\/+/, '')));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },
    econ: () => {
      readEcon();
      return econ;
    },
  });

  let rev = 1;
  let day = sessionIso(Date.now());
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** The previous session's cards, to show (stamped) until today's first pass. */
  const earlierOf = (today: string) => {
    const before = recordDays(o.dir).filter(d => d < today).pop();
    if (!before) return null;
    const f = readDay(o.dir, before);
    if (!f) return null;
    const st = f.state;
    const setups = [...(st.picks ?? []), ...(st.wings ?? []), ...(st.lottery ?? []), ...(st.near ?? [])].map(([, v]) => v).filter(v => v && v.id);
    const at = Math.max(st.scanned?.odte ?? 0, st.scanned?.weekly ?? 0);
    return setups.length || at ? { day: before.replace(/-/g, ''), at, setups } : null;
  };

  /** This session's calls and the four sessions before it. */
  const recentCalls = (today: string): Signal[] => {
    const days = recordDays(o.dir).filter(d => d < today).slice(-4);
    const older = days.flatMap(d => readDay(o.dir, d)?.calls ?? []);
    const mine = readDay(o.dir, today)?.calls ?? [];
    return [...mine, ...older];
  };

  const load = (today: string) => {
    const f = readDay(o.dir, today);
    importModelState(f?.state ?? null, earlierOf(today));
    if (!f) rollModelDay(today.replace(/-/g, ''));
    importSignals(recentCalls(today));
    importMarks(f?.marks ?? []);
    setLotteryDay(f?.lottery ? today : '');
    if (f) setScanMeta({ spots: f.meta?.spots ?? {}, sparks: f.meta?.sparks ?? {}, line: f.meta?.line ?? '', ...(readOnly && f.meta?.theta ? { theta: f.meta.theta, downSince: f.meta.downSince ?? 0 } : {}) });
    setSessionClose(f?.close ?? null);
  };

  const snapshotFile = (): DayFile => {
    const m = scanMeta();
    return {
      format: RECORD_FORMAT,
      day,
      savedAt: Date.now(),
      close: sessionClose(),
      calls: signals().filter(s => sessionOf(s) === day),
      marks: exportMarks(),
      lottery: lotterySwept() === day,
      state: exportModelState(),
      meta: { spots: m.spots, sparks: m.sparks, line: m.line, theta: m.theta, downSince: m.downSince },
    };
  };

  const save = () => {
    if (readOnly || !dirty) return;
    dirty = false;
    try {
      writeAtomic(dayFile(o.dir, day), JSON.stringify(snapshotFile()));
    } catch (e) {
      log(`[compass] the record could not be written: ${(e as Error).message}`);
    }
  };

  const changed = () => {
    rev += 1;
    cached = null;
    if (readOnly) return;
    dirty = true;
    if (!saveTimer) saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 1_000);
  };

  load(day);
  const offs = [onModelChange(changed), onSignalsChange(changed), onMarks(changed), onScanMeta(changed)];

  /* every scored row, as the trees read it, for the input check (scripts/compass-validate.ts): one line each in
     <dir>/rows/YYYY-MM-DD.jsonl */
  let rowBuf: string[] = [];
  const g = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null);
  if (!readOnly) {
    offs.push(onScoredRow(r => {
      rowBuf.push(JSON.stringify({
        t: r.minute,
        d: day,
        k: r.setup.contract,
        e: r.setup.expiryDate,
        b: r.setup.bid,
        a: r.setup.ask,
        q: r.setup.quotedAt ?? 0,
        s: r.setup.spot ?? null,
        late: r.late || undefined,
        x: r.x.map(g),
        p1: g(r.p1),
        p2: g(r.prun),
      }));
    }));
  }
  const flushRows = () => {
    if (!rowBuf.length) return;
    const lines = rowBuf;
    rowBuf = [];
    try {
      fs.mkdirSync(path.join(o.dir, 'rows'), { recursive: true });
      fs.appendFileSync(path.join(o.dir, 'rows', `${day}.jsonl`), `${lines.join('\n')}\n`);
    } catch {
      /* a read-only disk: the check runs without this day's rows */
    }
  };
  const rowTimer = readOnly ? null : setInterval(flushRows, 2_000);
  let cached: { rev: number; state: CompassState } | null = null;

  let lockTimer: ReturnType<typeof setInterval> | null = null;
  let reloadTimer: ReturnType<typeof setInterval> | null = null;
  if (!readOnly) {
    lockTimer = setInterval(() => {
      const lock = takeLock(o.dir);
      if (!lock.ok) log(`[compass] engine lock taken by pid ${lock.pid}`);
    }, 30_000);
    startScan({
      backfillFrom: o.backfillFrom,
      onDay: next => {
        if (next === day) return;
        dirty = !readOnly;
        save();
        day = next;
        rollModelDay(next.replace(/-/g, ''));
        importModelState(exportModelState(), earlierOf(next));
        importSignals(recentCalls(next));
        importMarks([]);
        changed();
        log(`[compass] session ${next}`);
      },
    });
    log(`[compass] engine running, record in ${o.dir}`);
  } else {
    /* a reader: the running engine's file, read again every five seconds */
    let seen = 0;
    reloadTimer = setInterval(() => {
      const today = sessionIso(Date.now());
      let mtime = 0;
      try {
        mtime = fs.statSync(dayFile(o.dir, today)).mtimeMs;
      } catch {
        mtime = 0;
      }
      if (today === day && mtime === seen) return;
      seen = mtime;
      day = today;
      load(today);
      changed();
    }, 5_000);
    log(`[compass] ${why}`);
  }

  const state = (): CompassState => {
    if (cached && cached.rev === rev) return cached.state;
    const s: CompassState = {
      format: RECORD_FORMAT,
      rev,
      at: Date.now(),
      day,
      engine: { running: !readOnly, readOnly, startedAt, why },
      meta: scanMeta(),
      lock: lockReason(),
      close: sessionClose(),
      model: exportModelState(),
      earlier: null,
      signals: signals(),
      marks: exportMarks(),
    };
    s.earlier = s.model.day === modelDay() && (s.model.picks?.length || s.model.scanned?.odte || s.model.scanned?.weekly) ? null : earlierOf(day);
    cached = { rev, state: s };
    return s;
  };

  return {
    state: () => state(),
    record: (d: string) => (d === day ? snapshotFile() : readDay(o.dir, d)),
    days: () => recordDays(o.dir).map(d => ({ day: d, calls: (d === day ? signals().filter(s => sessionOf(s) === day) : readDay(o.dir, d)?.calls ?? []).length })),
    stop: () => {
      stopScan();
      for (const off of offs) off();
      if (lockTimer) clearInterval(lockTimer);
      if (rowTimer) clearInterval(rowTimer);
      flushRows();
      if (reloadTimer) clearInterval(reloadTimer);
      if (saveTimer) clearTimeout(saveTimer);
      dirty = true;
      save();
      if (!readOnly) {
        try {
          const file = path.join(o.dir, 'engine.lock');
          const held = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid: number };
          if (held.pid === process.pid) fs.unlinkSync(file);
        } catch {
          /* already gone */
        }
      }
      log('[compass] engine stopped');
    },
  };
}

/* ---- HTTP ---- */

type Req = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string | Buffer) => void };

function send(req: Req, res: Res, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const accepts = String(req.headers['accept-encoding'] ?? '');
  if (text.length > 4_096 && /\bgzip\b/.test(accepts)) {
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync(text));
    return;
  }
  res.end(text);
}

/** /api/compass/state[?rev=N]   the board, the record and the engine (just {rev, same: true} when rev is current)
    /api/compass/record?day=D     one session's official record (calls, marks, close)
    /api/compass/days             the sessions on record and their call counts */
export function compassRoute(engine: Engine, req: Req, res: Res): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://local');
  const route = url.pathname.replace(/^\/api\/compass/, '') || '/';
  if (route === '/state') {
    const s = engine.state();
    if (!s) {
      send(req, res, 503, { error: 'The Compass engine is starting.', code: 'engine_starting' });
      return;
    }
    const have = Number(url.searchParams.get('rev'));
    if (have && have === s.rev) {
      send(req, res, 200, { rev: s.rev, same: true, at: Date.now() });
      return;
    }
    send(req, res, 200, { ...s, at: Date.now() });
    return;
  }
  if (route === '/record') {
    const d = url.searchParams.get('day') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      send(req, res, 400, { error: 'day must be YYYY-MM-DD' });
      return;
    }
    const f = engine.record(d);
    if (!f) {
      send(req, res, 404, { error: 'No record for that session.', code: 'no_record' });
      return;
    }
    const { state: _state, meta: _meta, ...record } = f;
    send(req, res, 200, record);
    return;
  }
  if (route === '/days') {
    send(req, res, 200, { days: engine.days() });
    return;
  }
  send(req, res, 404, { error: 'not found' });
}
