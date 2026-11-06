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
import { takeWire, writeWire } from '../../shared/jsonWire.mjs';
import { setCompassHost, type EconRow, type ThetaAnswer } from './compassHost';
import { demoteLate, exportModelState, importModelState, lockReason, modelDay, onLockReason, onModelChange, onScoredRow, rollModelDay, type ModelPack, type ScoredRow } from './compassModel';
import { importSignals, importWould, onSignalsChange, setSessionClose, signals, wouldSignals, type Signal } from './compassLedger';
import { exportMarks, importMarks, lotterySwept, onMarks, onScanMeta, scanMeta, sessionClose, setLotteryDay, setScanMeta, startScan, stopScan, type MarkRow, type ScanMeta } from './compassScan';
import { importTail } from './modelRiskScan';
import { emptyTail } from './modelRisk';
import { sessionIso } from './compassSession';
import { buildSession, builtCurrent, builtOpenCalls, openCalls, reviewFile, studyFile } from './compassReview';
import { startReviewScan, stopReviewScan } from './reviewLive';
import { poolStudies, type Label, type PooledStudy, type ScoredLine, type StudyDay, type StudyResult } from './compassStudy';
import { nyParts } from '../core/nyTime';
import { onShadowCall, setShadow } from './compassShadow';
import { groupBOn } from './compassParams';
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
  /** Every Book A, B and C call the live scan fired this session, newest first, with its settlement */
  calls: Signal[];
  /** What marks scored late would have called, settled by the same rules. Never calls, never seats. */
  would?: Signal[];
  /** Every mark of the session and what happened to each name at it */
  marks: MarkRow[];
  /** Book C swept this session */
  lottery: boolean;
  /** The engine's cards, seats and passes, to resume after a restart */
  state: ModelPack;
  meta: Pick<ScanMeta, 'spots' | 'sparks' | 'line' | 'theta' | 'downSince' | 'tail'>;
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
  /** What late marks would have called, the same sessions; not calls */
  would: Signal[];
  marks: MarkRow[];
}

export interface EngineOptions {
  /** Where the day files live */
  dir: string;
  /** The app's public/ folder (the model files and the universe) */
  publicDir: string;
  /** One ThetaData answer, in-process (server/thetaProxy.mjs thetaDirect). The engine asks in the 'engine' lane: its
      reads go ahead of every page's and always find the terminal's reserved slots (server/thetaSlots.mjs). */
  theta: (path: string, opt?: { lane?: 'engine' }) => Promise<{ status: number; body: string; type: string }>;
  /** One Unusual Whales answer, in-process (server/uwProxy.mjs uwDirect), for the economic calendar */
  uw?: (path: string) => Promise<{ status: number; body: string }>;
  /** Run the scan (false: serve the files only) */
  scan?: boolean;
  /** The earliest mark of a session to fill in from recorded quotes when the engine starts after it (epoch ms for a
      session date YYYY-MM-DD); the session's 09:30 ET by default */
  backfillFrom?: (day: string) => number;
  log?: (line: string) => void;
  /** How often a reader asks for the lock and a scanner refreshes it (LOCK_RETRY_MS; shorter in the golden) */
  lockRetryMs?: number;
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
  /* the terminal now and then answers 200 with an empty body (seen on option/at_time/quote: 0 bytes, then 18 kB a
     second later); its "no data" is 472. An empty 200 is a fault to ask again, not an empty chain (it used to read
     as no quotes and mark the name not scored for good) */
  if (status === 200 && !body.trim()) return { status, data: null, error: 'empty' };
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

/** A call recorded from a late mark is what that mark would have called: it moves to `would` on every read. */
function splitLate(f: DayFile): DayFile & { demoted: Signal[] } {
  const demoted = f.calls.filter(c => c.how === 'late');
  if (!demoted.length) return { ...f, would: f.would ?? [], demoted };
  const would = [...(f.would ?? []), ...demoted.map(c => ({ ...c, would: true as const }))];
  return { ...f, calls: f.calls.filter(c => c.how !== 'late'), would, demoted };
}

/** One session's record, with any call made from a late mark moved to `would`. */
export function readDay(dir: string, day: string): (DayFile & { demoted: Signal[] }) | null {
  try {
    const got = JSON.parse(fs.readFileSync(dayFile(dir, day), 'utf8')) as DayFile;
    return got && got.format === RECORD_FORMAT && got.day === day ? splitLate(got) : null;
  } catch {
    return null;
  }
}

/** Session dates the live review has written, oldest first. */
function reviewDays(dir: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, 'review')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
  } catch {
    return [];
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

/** How often a reader asks for the engine lock, and a scanner refreshes it. */
export const LOCK_RETRY_MS = 30_000;

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

const unsettled = (s: Signal) => !s.outcome || s.outcome.status === 'open' || s.outcome.status === 'waiting';

/** A session's review and study may be built now: today's once nothing is open or pending; an earlier day's once its
    calls are settled, or when none of them is still being settled in memory (`held`: the record the engine settles,
    today's and the four sessions before it). An earlier day used to be built with its calls open and frozen so. */
/** A session's file with the settlements held in memory for its calls and would-calls written in. Each row keeps the
    list it was written in (a late call stays in calls; reading the file moves it), and the rest of the file is kept. */
export function mergeSettled(raw: DayFile, held: readonly Signal[], at = Date.now()): DayFile {
  const now = new Map(held.map(s => [s.key, s]));
  const calls = raw.calls.map(c => {
    const got = now.get(c.key);
    if (!got) return c;
    const { would: _would, ...row } = got;
    return { ...c, ...row, how: c.how };
  });
  const would = (raw.would ?? []).map(c => now.get(c.key) ?? c);
  return { ...raw, calls, would, savedAt: at };
}

const g9 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null);

/** One scored row as the engine logs it (<dir>/rows/YYYY-MM-DD.jsonl, data/compassStudy ScoredLine), under its session
    date `day`. */
export function scoredLine(r: ScoredRow, day: string): ScoredLine {
  return {
    t: r.minute,
    d: day,
    /* the mark itself: an overnight mark before midnight is logged under the next session's date, and its minute of
       the day alone put it a day late in the study */
    m: r.mark,
    k: r.setup.contract,
    e: r.setup.expiryDate,
    b: r.setup.bid,
    a: r.setup.ask,
    q: r.setup.quotedAt ?? 0,
    s: r.setup.spot ?? null,
    late: r.late || undefined,
    x: r.x.map(g9),
    p1: g9(r.p1) ?? NaN,
    p2: r.prun == null ? null : g9(r.prun),
  };
}

export function buildReady(d: string, today: string, f: Pick<DayFile, 'calls' | 'would' | 'marks'>, held: readonly Signal[]): boolean {
  const open = openCalls(f) > 0;
  const pending = f.marks.some(m => Object.values(m.names).includes('pending'));
  if (d === today) return !open && !pending;
  return !open || !held.some(s => sessionOf(s) === d && unsettled(s));
}

export interface Engine {
  state: (rev?: number) => CompassState | null;
  record: (day: string) => DayFile | null;
  /** the record folder (the review and the study live beside the record) */
  dir: string;
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
        const got = await o.theta(p, { lane: 'engine' });
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
  let cached: { rev: number; state: CompassState } | null = null;

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
  const recentWould = (today: string): Signal[] => {
    const days = [...recordDays(o.dir).filter(d => d < today).slice(-4), today];
    return days.flatMap(d => readDay(o.dir, d)?.would ?? []);
  };

  const load = (today: string) => {
    const f = readDay(o.dir, today);
    importModelState(f?.state ?? null, earlierOf(today));
    if (!f) rollModelDay(today.replace(/-/g, ''));
    importSignals(recentCalls(today));
    importWould(recentWould(today));
    if (f?.demoted.length) {
      /* their seats go back: only a root a live call holds stays taken */
      const live = { A: new Set<string>(), B: new Set<string>(), C: new Set<string>() };
      for (const c of f.calls) if (c.book === 'A' || c.book === 'B' || c.book === 'C') live[c.book].add(c.ticker);
      demoteLate(f.demoted.filter((c): c is Signal & { book: 'A' | 'B' | 'C' } => c.book === 'A' || c.book === 'B' || c.book === 'C'), live);
      changed();
    }
    importMarks(f?.marks ?? []);
    setLotteryDay(f?.lottery ? today : '');
    if (f) setScanMeta({ spots: f.meta?.spots ?? {}, sparks: f.meta?.sparks ?? {}, line: f.meta?.line ?? '', tail: f.meta?.tail ?? emptyTail(today), ...(readOnly && f.meta?.theta ? { theta: f.meta.theta, downSince: f.meta.downSince ?? 0 } : {}) });
    if (f?.meta?.tail) importTail(f.meta.tail);
    else {
      const priorDay = recordDays(o.dir).filter(d => d < today).pop();
      const prior = priorDay ? readDay(o.dir, priorDay)?.meta?.tail : null;
      const carried = (prior?.open ?? []).filter(t => t && !t.why);
      importTail(carried.length ? { ...emptyTail(today), day: today, open: carried } : null);
    }
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
      would: wouldSignals().filter(s => sessionOf(s) === day),
      marks: exportMarks(),
      lottery: lotterySwept() === day,
      state: exportModelState(),
      meta: { spots: m.spots, sparks: m.sparks, line: m.line, theta: m.theta, downSince: m.downSince, tail: m.tail ?? emptyTail(day) },
    };
  };

  /* What the record of each earlier session in memory last held (its calls' and would-calls' settlements): the
     four sessions before today are settled in memory with today's, and a change is written back to their own file
     (it was never written, so a call open at the session roll stayed open on disk, and its study froze it so). */
  const pastSeen = new Map<string, string>();
  const settledOf = (list: readonly Signal[]) => JSON.stringify(list.map(s => [s.key, s.outcome, s.spark]));
  const notePast = () => {
    pastSeen.clear();
    for (const s of [...signals(), ...wouldSignals()]) {
      const d = sessionOf(s);
      if (d !== day) pastSeen.set(d, '');
    }
    for (const d of pastSeen.keys()) pastSeen.set(d, settledOf([...signals(), ...wouldSignals()].filter(s => sessionOf(s) === d)));
  };
  const writePast = () => {
    const mine = [...signals(), ...wouldSignals()];
    const days = [...new Set(mine.map(sessionOf))].filter(d => d !== day);
    for (const d of days) {
      const list = mine.filter(s => sessionOf(s) === d);
      const seen = settledOf(list);
      if (pastSeen.get(d) === seen) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(dayFile(o.dir, d), 'utf8')) as DayFile;
        if (!raw || raw.format !== RECORD_FORMAT || raw.day !== d) continue;
        writeAtomic(dayFile(o.dir, d), JSON.stringify(mergeSettled(raw, list)));
        pastSeen.set(d, seen);
      } catch (e) {
        log(`[compass] the record of ${d} could not be written back: ${(e as Error).message}`);
      }
    }
  };

  const save = () => {
    if (readOnly || !dirty) return;
    dirty = false;
    try {
      writeAtomic(dayFile(o.dir, day), JSON.stringify(snapshotFile()));
    } catch (e) {
      log(`[compass] the record could not be written: ${(e as Error).message}`);
    }
    writePast();
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
  notePast();
  const offs = [onModelChange(changed), onSignalsChange(changed), onMarks(changed), onScanMeta(changed)];

  /* the model lock's reason, logged when it changes (a hash miss used to close scoring without a line in the log) */
  let lockSaid = lockReason();
  if (lockSaid) log(`[compass] model lock: ${lockSaid}`);
  offs.push(onLockReason(text => {
    if (text === lockSaid) return;
    lockSaid = text;
    log(text ? `[compass] model lock: ${text}` : '[compass] model files verified; scoring is open');
    changed();
  }));

  /* every scored row, as the trees read it, for the input check (scripts/compass-validate.ts): one line each in
     <dir>/rows/YYYY-MM-DD.jsonl */
  let rowBuf: string[] = [];
  const logRow = (r: ScoredRow) => {
    rowBuf.push(JSON.stringify(scoredLine(r, day)));
  };
  /* feature version 2's shadow calls (compassShadow; COMPASS_V2_SHADOW=1 turns it on, off by default, and it stays
     empty until version 2 trees ship with their hashes): one line each in <dir>/shadow/YYYY-MM-DD.jsonl, never a call,
     read by the research to settle. The switch is read through globalThis (compassParams groupBOn): vite's define
     empties a bare process.env */
  let shadowOff: (() => void) | null = null;
  const startShadow = () => {
    setShadow(groupBOn('COMPASS_V2_SHADOW'));
    shadowOff?.();
    shadowOff = onShadowCall(c => {
      try {
        fs.mkdirSync(path.join(o.dir, 'shadow'), { recursive: true });
        fs.appendFileSync(path.join(o.dir, 'shadow', `${c.day.slice(0, 4)}-${c.day.slice(4, 6)}-${c.day.slice(6, 8)}.jsonl`), `${JSON.stringify(c)}\n`);
      } catch {
        /* a read-only disk: the shadow keeps its calls in memory */
      }
    });
  };
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

  /* After a session settles, the study is built once: every call, the closest the scan did not take, every scored
     row labelled. The review file is not this. The live scanner owns it, all night. A day whose study was built
     under older rules (compassReview REVIEW_VERSION) is built again. */
  let building = false;
  const buildDue = () => {
    if (building) return;
    const p = nyParts(Date.now());
    const mins = p.hour * 60 + p.minute;
    /* a study built while calls were open is built again once they have settled */
    const settledSince = (d: string) => {
      if (!builtOpenCalls(studyFile(o.dir, d))) return false;
      const f = d === day ? null : readDay(o.dir, d);
      return !!f && !openCalls(f);
    };
    const stale = (d: string) => !builtCurrent(studyFile(o.dir, d)) || settledSince(d);
    const days = recordDays(o.dir).filter(stale);
    const due = days.filter(d => d < day || (d === day && mins >= 16 * 60 + 20)).sort();
    /* A past day goes first. Building today while it is the newest used to leave the day before it unbuilt. A day
       with calls still open is not built while they are being settled in memory (a past day used to be built open,
       and frozen so; its settlements are now written back to its file): the next day due is taken instead. A past day
       older than the ones in memory is built as it stands, and again once it settles. */
    const ready = (d: string): DayFile | null => {
      const f = d === day ? snapshotFile() : readDay(o.dir, d);
      return f && buildReady(d, day, f, [...signals(), ...wouldSignals()]) ? f : null;
    };
    let todo = '';
    let f: DayFile | null = null;
    for (const d of [...due.filter(x => x < day), ...due.filter(x => x === day)]) {
      f = ready(d);
      if (f) {
        todo = d;
        break;
      }
    }
    if (!todo || !f) return;
    building = true;
    void buildSession(o.dir, todo, f, log)
      .catch(e => log(`[compass] the review of ${todo} did not build: ${(e as Error).message}`))
      .finally(() => {
        building = false;
      });
  };

  /* One process scans; the others read its file. The roles are not fixed for life: a scanner that finds the lock taken
     by another live process stops scanning and becomes a reader, and a reader asks for the lock every 30 s and takes
     over once the scanner is gone (its lock is stale after two minutes). */
  let lockTimer: ReturnType<typeof setInterval> | null = null;
  let reloadTimer: ReturnType<typeof setInterval> | null = null;
  let rowTimer: ReturnType<typeof setInterval> | null = null;
  let reviewTimer: ReturnType<typeof setInterval> | null = null;
  let rowOff: (() => void) | null = null;
  const clearRoleTimers = () => {
    for (const t of [lockTimer, reloadTimer, rowTimer, reviewTimer]) if (t) clearInterval(t);
    lockTimer = reloadTimer = rowTimer = reviewTimer = null;
    rowOff?.();
    rowOff = null;
    shadowOff?.();
    shadowOff = null;
    setShadow(false);
    stopReviewScan();
  };

  const asReader = (reason: string) => {
    clearRoleTimers();
    stopScan();
    flushRows();
    readOnly = true;
    why = reason;
    let seen = 0;
    /* the running engine's file, read again every five seconds */
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
    if (o.scan !== false) {
      lockTimer = setInterval(() => {
        const lock = takeLock(o.dir);
        if (lock.ok) {
          log('[compass] the engine lock is free; this process takes over the scan');
          asScanner(true);
        }
      }, o.lockRetryMs ?? LOCK_RETRY_MS);
    }
    changed();
    log(`[compass] ${why}`);
  };

  const asScanner = (takeOver = false) => {
    clearRoleTimers();
    readOnly = false;
    why = '';
    if (takeOver) {
      /* the file the previous scanner left is the state to resume from */
      day = sessionIso(Date.now());
      load(day);
      notePast();
    }
    rowOff = onScoredRow(logRow);
    startShadow();
    rowTimer = setInterval(flushRows, 2_000);
    reviewTimer = setInterval(buildDue, 60_000);
    lockTimer = setInterval(() => {
      const lock = takeLock(o.dir);
      if (!lock.ok) asReader(`Another server process (pid ${lock.pid}) took the engine lock; this one stopped scanning and serves its record.`);
    }, o.lockRetryMs ?? LOCK_RETRY_MS);
    startScan({
      backfillFrom: o.backfillFrom,
      log,
      onDay: next => {
        if (next === day) return;
        dirty = !readOnly;
        save();
        day = next;
        rollModelDay(next.replace(/-/g, ''));
        importModelState(exportModelState(), earlierOf(next));
        importSignals(recentCalls(next));
        importWould(recentWould(next));
        notePast();
        importMarks([]);
        changed();
        log(`[compass] session ${next}`);
      },
    });
    startReviewScan(o.dir, log);
    changed();
    log(`[compass] engine running, record in ${o.dir}`);
  };

  if (readOnly) asReader(why);
  else asScanner();

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
      would: wouldSignals(),
      marks: exportMarks(),
    };
    s.earlier = s.model.day === modelDay() && (s.model.picks?.length || s.model.scanned?.odte || s.model.scanned?.weekly) ? null : earlierOf(day);
    cached = { rev, state: s };
    return s;
  };

  return {
    state: () => state(),
    dir: o.dir,
    record: (d: string) => (d === day ? snapshotFile() : readDay(o.dir, d)),
    days: () => {
      const days = [...new Set([...recordDays(o.dir), ...reviewDays(o.dir)])].sort();
      return days.map(d => ({ day: d, calls: (d === day ? signals().filter(s => sessionOf(s) === day) : readDay(o.dir, d)?.calls ?? []).length }));
    },
    stop: () => {
      stopScan();
      for (const off of offs) off();
      clearRoleTimers();
      flushRows();
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

/* ---- every session's study, pooled ---- */

let pooledMemo: { key: string; doc: PooledStudy } | null = null;

/** Every labelled session in the folder pooled (data/compassStudy.ts poolStudies), rebuilt only when a labels or
    study file changes: a session's labels are tens of thousands of lines. */
export function pooledStudy(dir: string): PooledStudy {
  const labelDir = path.join(dir, 'labels');
  let names: string[] = [];
  try {
    names = fs.readdirSync(labelDir).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  } catch {
    names = [];
  }
  const stamp = (file: string) => {
    try {
      const st = fs.statSync(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '-';
    }
  };
  const key = `${dir}|${names.map(n => `${n}:${stamp(path.join(labelDir, n))}:${stamp(studyFile(dir, n.slice(0, 10)))}`).join(',')}`;
  if (pooledMemo?.key === key) return pooledMemo.doc;
  const days: StudyDay[] = [];
  for (const n of names) {
    const day = n.slice(0, 10);
    let labels: Label[] = [];
    try {
      labels = fs.readFileSync(path.join(labelDir, n), 'utf8').split('\n').filter(Boolean).flatMap(line => {
        try {
          return [JSON.parse(line) as Label];
        } catch {
          return [];
        }
      });
    } catch {
      labels = [];
    }
    let study: StudyDay['study'] = null;
    try {
      const st = JSON.parse(fs.readFileSync(studyFile(dir, day), 'utf8')) as StudyResult;
      study = { missReasons: st.missReasons ?? [], movers: st.movers ?? [] };
    } catch {
      study = null;
    }
    days.push({ day, labels, study });
  }
  const doc = poolStudies(days);
  pooledMemo = { key, doc };
  return doc;
}

/* ---- HTTP ---- */

type Req = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string | Buffer) => void };

/* "not built yet" is a normal state to the terminal's own pages: asked with x-compass-soft it answers 200 with the code,
   so the browser console stays clean; any other caller still gets the 404 */
const notBuilt = (req: Req): number => (String(req.headers['x-compass-soft'] ?? '') === '1' ? 200 : 404);

let stateWire: { rev: number; json: Buffer; gzip: Buffer } | null = null;

/** The board is the same for every viewer until the engine's rev moves. Build the bytes once. */
function sendState(req: Req, res: Res, s: CompassState): void {
  if (!stateWire || stateWire.rev !== s.rev) {
    const json = Buffer.from(JSON.stringify(s));
    stateWire = { rev: s.rev, json, gzip: gzipSync(json) };
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const accepts = String(req.headers['accept-encoding'] ?? '');
  if (/\bgzip\b/.test(accepts)) {
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
    res.end(stateWire.gzip);
    return;
  }
  res.end(stateWire.json);
}

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
    /api/compass/days             the sessions on record and their call counts
    /api/compass/review?day=D     one session's review; /api/compass/study?day=D its study
    /api/compass/study?day=all    every labelled session's study pooled */
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
    sendState(req, res, s);
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
    const { state: _state, meta: _meta, ...rest } = f;
    const { demoted: _demoted, ...record } = rest as typeof rest & { demoted?: unknown };
    send(req, res, 200, record);
    return;
  }
  if (route === '/study' && url.searchParams.get('day') === 'all') {
    const pooled = pooledStudy(engine.dir);
    if (!pooled.days.length) {
      send(req, res, notBuilt(req), { error: 'No session has been labelled yet.', code: 'not_built' });
      return;
    }
    send(req, res, 200, pooled);
    return;
  }
  if (route === '/review' || route === '/study') {
    const d = url.searchParams.get('day') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      send(req, res, 400, { error: 'day must be YYYY-MM-DD' });
      return;
    }
    const file = route === '/review' ? reviewFile(engine.dir, d) : studyFile(engine.dir, d);
    try {
      const st = fs.statSync(file);
      const stamp = `${st.mtimeMs}|${st.size}`;
      writeWire(req, res, 200, takeWire(`compass|${route}|${d}`, stamp, () => {
        const raw = fs.readFileSync(file);
        JSON.parse(raw.toString('utf8'));
        return raw;
      }));
    } catch {
      send(req, res, notBuilt(req), { error: route === '/review' ? 'No review for that session yet.' : 'No study for that session yet.', code: 'not_built' });
    }
    return;
  }
  if (route === '/days') {
    send(req, res, 200, { days: engine.days() });
    return;
  }
  send(req, res, 404, { error: 'not found' });
}
