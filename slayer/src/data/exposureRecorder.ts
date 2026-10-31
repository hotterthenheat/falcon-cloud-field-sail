/// <reference types="node" />
/*
  The exposure recorder, in the Node process that serves the app (the dev server, `npm run serve`), like the Compass
  engine. Terrain's exposure field (one row a strike, one column a bar) is built from the vendor's per-strike rows read
  through the day; the vendor serves no earlier per-strike state for today, so a browser that opens at 14:00 could only
  draw from 14:00. The recorder reads the same rows a Terrain viewer reads, for a set of names, once a minute through the
  session, keeps them on disk and serves them at /api/exposure/day, so every viewer's field starts at the open.

  - What it reads: the whole book (spot-exposures/strike, Terrain's default "Every expiry" cut) and the front expiry
    (spot-exposures/expiry-strike?expirations[]=<front>, the "Today" cut), the exact paths the browser asks
    (data/book/exposureLog.ts readCut), through the in-process hub (server/uwProxy.mjs uwDirect, lane 'record'): the
    same cache and three slots, one ask at a time, in the background lane behind every waiting viewer.
  - When: trading days, every minute 09:30–16:15 ET; every `extEvery` minutes (default 2) 04:00–09:30 and 16:15–20:00,
    the premarket and after-hours sessions Terrain draws. Readings two minutes apart still join (JOIN_MS is three).
  - Which names: the house's (HOUSE_NAMES, or EXPOSURE_NAMES) and every name a Terrain viewer opened today (the
    /api/exposure/day ask names it), up to `max` (EXPOSURE_NAMES_MAX, default 25), the house first, then viewers by
    their latest open.
  - A pass never outlives its minute: past 50 s it stops, and the names it did not reach go first next time. A 429, a
    vendor fault or a timeout stops the pass and backs off 1, 2, 4, up to 8 minutes.
  - The record: <dir>/YYYY-MM-DD/<TICKER>.jsonl, one line an answer (a page), only the rows the field keeps (within 5%
    of the row's price). A finished day is gzipped; days older than `keepDays` (default 10) are removed.
  - One process per folder records: it holds <dir>/recorder.lock. Another server on the same folder serves the files.

  This module never runs in a browser bundle (docs/exposure-recorder.md).
*/

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { nyIsoDate, nyParts, nyWallTime } from '../core/nyTime';
import { isTradingDay } from '../core/calendar';
import { phaseAt, sessionAt } from '../core/session';
import { ALL, closeOf, placeSeg, readAnswer, spanOf, type KeptSeries } from './book/exposureSegs';

export const EXPOSURE_FORMAT = 'exposure-day/1';
/** The house's names: Terrain's opening desk first, then the most-watched index and megacap names */
export const HOUSE_NAMES = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'SPX', 'IWM', 'TSLA', 'MSFT', 'AMZN', 'META'];
/** The regular session the recorder reads every minute, minutes of the New York day (09:30–16:15) */
export const RTH_FROM = 9 * 60 + 30;
export const RTH_TO = 16 * 60 + 15;
/** The extended sessions Terrain draws (premarket from 04:00, after hours to 20:00) */
export const EXT_FROM = 4 * 60;
export const EXT_TO = 20 * 60;
/** A pass stops this long after it started, so it never runs into the next minute's */
export const PASS_MS = 50_000;
/** A copy of the answer this young is reused (a viewer's own read of the same path), not asked again */
export const REUSE_MS = 45_000;
const PAGE = 500;
const MAX_PAGES = 4;
const LOCK_STALE_MS = 120_000;

export type UwAnswer = { status: number; body: string; at?: number };

export interface RecorderOptions {
  /** the record folder (.cache/exposure) */
  dir: string;
  /** one Unusual Whales answer, in-process (server/uwProxy.mjs uwDirect with lane 'record') */
  uw: (path: string) => Promise<UwAnswer>;
  /** false: serve the folder, record nothing (EXPOSURE_RECORDER=0) */
  record?: boolean;
  /** the house's names (EXPOSURE_NAMES) */
  house?: string[];
  /** names recorded at most (EXPOSURE_NAMES_MAX) */
  max?: number;
  /** days kept (EXPOSURE_KEEP_DAYS) */
  keepDays?: number;
  /** also the front expiry (EXPOSURE_FRONT=0 turns it off) */
  front?: boolean;
  /** minutes between reads outside the regular session; 0 reads the regular session only (EXPOSURE_EXT_EVERY) */
  extEvery?: number;
  /** the clock (the proof pins it) */
  now?: () => number;
  /** no timers: the caller drives tick() (the proof) */
  manual?: boolean;
  log?: (line: string) => void;
}

/** One answer on disk: the moment it answers for, when it was read, the cut, the page, and the rows the field keeps:
    [strike, ms from the row's recalculation to the answer, open-interest gamma, today's flow gamma] */
interface Line {
  at: number;
  n: number;
  c: string;
  p: number;
  r: [number, number, number, number][];
}

export interface PassReport {
  slot: string;
  startedAt: number;
  took: number;
  /** answers asked of the hub, and those the vendor answered fresh (the rest were a viewer's copy) */
  asks: number;
  vendor: number;
  /** lines written */
  lines: number;
  /** names (cuts) the pass did not reach before its deadline */
  missed: number;
  fault: string | null;
}

export interface ExposureDay {
  format: typeof EXPOSURE_FORMAT;
  ticker: string;
  day: string;
  /** a recorder runs on this folder now */
  recording: boolean;
  /** this server's recorder started, ms (null when it is not recording) */
  startedAt: number | null;
  /** the recorder's first and last read of this name on this day, ms (null: none) */
  firstAt: number | null;
  lastAt: number | null;
  /** answers on record for the day */
  readings: number;
  /** the field's series, as data/book/exposureLog.ts keeps them; with `since`, only segments that end after it */
  series: KeptSeries[];
}

export interface RecorderStatus {
  recording: boolean;
  why: string;
  startedAt: number;
  names: string[];
  viewers: number;
  max: number;
  front: boolean;
  extEvery: number;
  keepDays: number;
  backoffUntil: number;
  last: PassReport | null;
  passes: number;
  /** the vendor calls of the last ten passes, per pass */
  recentVendor: number[];
  /** cuts the passes did not reach before their deadline, since start, and the passes that missed any (a recorder
      starved of vendor slots shows here; docs/exposure-recorder.md) */
  missedTotal: number;
  passesMissing: number;
}

export interface Recorder {
  dir: string;
  /** a Terrain viewer opened this name today: record it (up to the cap) */
  noteViewer: (ticker: string) => void;
  names: () => string[];
  day: (ticker: string, day: string, since?: number) => ExposureDay | null;
  status: () => RecorderStatus;
  /** one scheduler step: runs the pass the clock calls for, if any (the timers call it every 5 s) */
  tick: () => Promise<PassReport | null>;
  /** remove days past `keepDays`, gzip finished days */
  prune: () => void;
  stop: () => void;
}

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
export const cleanTicker = (raw: unknown): string | null => {
  const t = String(raw ?? '').trim().toUpperCase();
  return TICKER.test(t) ? t : null;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The recorder's slot for an instant: a trading day's minute it reads, or null. By the one session rule
    (core/session.ts): every minute while the index and ETF options trade their regular session (09:30–16:15; 13:15 on
    an early close), every `extEvery` minutes in the pre-market and after hours (04:00–09:30, to 20:00; to 17:00 on an
    early close). Not overnight: the vendor's per-strike exposures are struck off the stock price, which its tape does
    not carry 20:00–04:00 (its bars and stock state stop at 20:00), so an overnight read would repeat the 19:59 book. */
export function slotAt(ms: number, extEvery: number): { day: string; minute: number; rth: boolean } | null {
  const p = nyParts(ms);
  if (!isTradingDay(new Date(p.year, p.month - 1, p.day))) return null;
  const minute = p.hour * 60 + p.minute;
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (sessionAt(ms, 'etfOption').open) return { day, minute, rth: true };
  const ph = phaseAt(ms);
  if (extEvery > 0 && (ph === 'pre' || ph === 'post') && minute % extEvery === 0) return { day, minute, rth: false };
  return null;
}

/** The book's paths, spelled exactly as the browser asks them, so one copy serves both */
export const bookPath = (t: string, page: number) => `/stock/${encodeURIComponent(t)}/spot-exposures/strike?limit=500&page=${page}`;
export const frontPath = (t: string, expiry: string) => `/stock/${encodeURIComponent(t)}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(expiry)}&limit=500`;
export const expiriesPath = (t: string) => `/stock/${encodeURIComponent(t)}/greek-exposure/expiry`;

/** An answer's rows as one line on disk (null: nothing the field keeps) */
export function lineOf(rows: unknown, cut: string, page: number, readAt: number): Line | null {
  const read = readAnswer(rows, cut === ALL);
  if (!read) return null;
  const r: Line['r'] = [];
  for (const x of read.rows) {
    if (!x.near || (cut !== ALL && x.expiry !== cut)) continue;
    r.push([x.strike, read.answeredAt - x.rowAt, x.oi, x.flow]);
  }
  return r.length ? { at: read.answeredAt, n: readAt, c: cut, p: page, r } : null;
}

/** A day's lines as the field's series: each row placed the way the browser's log places it */
export class DaySeries {
  series = new Map<string, number[]>();
  firstAt: number | null = null;
  lastAt: number | null = null;
  readings = 0;
  /** the newest answer per cut and page, to skip one read twice */
  newest = new Map<string, number>();
  add(line: Line): boolean {
    if (!line || !Number.isFinite(line.at) || !Array.isArray(line.r)) return false;
    const key = `${line.c}|${line.p}`;
    if ((this.newest.get(key) ?? 0) >= line.at) return false;
    this.newest.set(key, line.at);
    this.readings += 1;
    if (this.firstAt == null || line.n < this.firstAt) this.firstAt = line.n;
    if (this.lastAt == null || line.n > this.lastAt) this.lastAt = line.n;
    for (const [strike, back, oi, flow] of line.r) {
      const span = spanOf(line.at - back, line.at);
      if (!span) continue;
      const k = `${line.c}|${strike}`;
      let segs = this.series.get(k);
      if (!segs) this.series.set(k, (segs = []));
      placeSeg(segs, span.from, span.to, oi, flow);
    }
    return true;
  }
  /** the series, or with `since` only the segments that end after it */
  out(since = 0): KeptSeries[] {
    const out: KeptSeries[] = [];
    for (const [k, segs] of this.series) {
      const bar = k.lastIndexOf('|');
      const cut = k.slice(0, bar);
      const strike = Number(k.slice(bar + 1));
      let i = 0;
      if (since > 0) while (i < segs.length && segs[i + 1] <= since) i += 4;
      if (i < segs.length) out.push([cut, strike, i ? segs.slice(i) : segs.slice()]);
    }
    return out;
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/* On Windows a rename over a file another process has open (a reader serving the day, an antivirus scan, the search
   indexer) fails with EPERM, EACCES or EBUSY for a moment: try again a few times before giving up. */
const RENAME_RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);
export function renameRetrying(from: string, to: string, rename: (a: string, b: string) => void = fs.renameSync): void {
  for (let i = 0; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      if (i >= 5 || !RENAME_RETRY.has((e as NodeJS.ErrnoException).code ?? '')) {
        fs.rmSync(from, { force: true });
        throw e;
      }
      /* a short synchronous wait (20, 40 … 320 ms): the callers are synchronous */
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * 2 ** i);
    }
  }
}

function writeAtomic(file: string, text: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  renameRetrying(tmp, file);
}

/** Takes the folder's recorder lock, or says who holds it. A lock not refreshed for two minutes, or left by a process
    that is gone, is stale.
    Only one create can win: the lock is taken by creating the file with open(…, 'wx'), which fails when it exists. A
    stale lock is first moved aside by rename, and removed only when the file moved is the very lock judged stale; if
    another process wrote a fresh lock in between, that file is linked back and this round is lost. A lock that cannot
    be read yet (another process mid-write) counts as held until its file is as old as a stale lock. The holder
    refreshes its own lock in place. */
export function takeLock(dir: string, now = Date.now(), race?: { afterRead?: () => void }): { ok: true } | { ok: false; pid: number } {
  const file = path.join(dir, 'recorder.lock');
  const mine = JSON.stringify({ pid: process.pid, at: now });
  let holder = 0;
  for (let round = 0; round < 3; round++) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      return { ok: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // gone between the create and the read: create again
    }
    /* the proof's hook: another process acting between this read and what follows (scripts/exposure-recorder-proof.ts) */
    race?.afterRead?.();
    let held: { pid: number; at: number } | null = null;
    try {
      held = JSON.parse(text) as { pid: number; at: number };
    } catch {
      held = null;
    }
    if (held && held.pid === process.pid) {
      writeAtomic(file, mine);
      return { ok: true };
    }
    if (held && alive(held.pid) && now - held.at < LOCK_STALE_MS) return { ok: false, pid: held.pid };
    if (!held) {
      /* half-written, or not a lock this process can read: held until its file is as old as a stale lock */
      let age = Infinity;
      try {
        age = now - fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < LOCK_STALE_MS) return { ok: false, pid: 0 };
    }
    holder = held?.pid ?? 0;
    const aside = `${file}.${process.pid}.stale`;
    try {
      fs.renameSync(file, aside);
    } catch {
      continue; // another process moved it first
    }
    let moved = '';
    try {
      moved = fs.readFileSync(aside, 'utf8');
    } catch {
      /* gone */
    }
    if (moved !== text) {
      /* a fresh lock landed between the read and the move: put it back (the link fails if yet another took the name) */
      try {
        fs.linkSync(aside, file);
      } catch {
        /* someone holds the name now */
      }
      fs.rmSync(aside, { force: true });
      continue;
    }
    fs.rmSync(aside, { force: true });
  }
  try {
    holder = (JSON.parse(fs.readFileSync(file, 'utf8')) as { pid: number }).pid;
  } catch {
    /* as last seen */
  }
  return { ok: false, pid: holder };
}

function dropLock(dir: string): void {
  try {
    const file = path.join(dir, 'recorder.lock');
    const held = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid: number };
    if (held.pid === process.pid) fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

const isoDay = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
};

export function startExposureRecorder(o: RecorderOptions): Recorder {
  const log = o.log ?? (() => {});
  const clock = o.now ?? (() => Date.now());
  const max = Math.max(1, Math.floor(o.max ?? 25));
  const keepDays = Math.max(1, Math.floor(o.keepDays ?? 10));
  const front = o.front !== false;
  const extEvery = Math.max(0, Math.floor(o.extEvery ?? 2));
  const house = [...new Set((o.house ?? HOUSE_NAMES).map(cleanTicker).filter((t): t is string => !!t))];
  const startedAt = clock();
  fs.mkdirSync(o.dir, { recursive: true });

  let recording = o.record !== false;
  let why = recording ? '' : 'The recorder is off in this process (EXPOSURE_RECORDER=0).';
  if (recording) {
    const lock = takeLock(o.dir, clock());
    if (!lock.ok) {
      recording = false;
      why = `Another server process (pid ${lock.pid}) records this folder; this one serves its record.`;
    }
  }

  const dayDir = (day: string) => path.join(o.dir, day);
  const fileOf = (day: string, t: string) => path.join(dayDir(day), `${t}.jsonl`);

  /* ---- the days on disk, read incrementally (the recorder appends; a reader parses only the new bytes) ---- */
  const cache = new Map<string, { offset: number; gz: boolean; data: DaySeries; used: number }>();
  function load(t: string, day: string): DaySeries | null {
    const key = `${t}|${day}`;
    let c = cache.get(key);
    const plain = fileOf(day, t);
    const gz = `${plain}.gz`;
    let size = -1;
    try {
      size = fs.statSync(plain).size;
    } catch {
      /* finished and gzipped, or never written */
    }
    if (size < 0) {
      if (c?.gz) {
        c.used = clock();
        return c.data;
      }
      try {
        const text = gunzipSync(fs.readFileSync(gz)).toString('utf8');
        const data = new DaySeries();
        for (const s of text.split('\n')) if (s) addText(data, s);
        c = { offset: 0, gz: true, data, used: clock() };
        cache.set(key, c);
        trim();
        return data;
      } catch {
        return c?.data ?? null;
      }
    }
    if (!c || c.gz || size < c.offset) {
      c = { offset: 0, gz: false, data: new DaySeries(), used: clock() };
      cache.set(key, c);
      trim();
    }
    c.used = clock();
    if (size > c.offset) {
      const fd = fs.openSync(plain, 'r');
      try {
        const buf = Buffer.alloc(size - c.offset);
        fs.readSync(fd, buf, 0, buf.length, c.offset);
        const end = buf.lastIndexOf(10);
        if (end >= 0) {
          for (const s of buf.subarray(0, end).toString('utf8').split('\n')) if (s) addText(c.data, s);
          c.offset += end + 1;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    return c.data;
  }
  function addText(data: DaySeries, s: string): void {
    try {
      data.add(JSON.parse(s) as Line);
    } catch {
      /* a torn line (a crash mid-write) is skipped */
    }
  }
  function trim(): void {
    while (cache.size > 80) {
      let oldest: string | null = null;
      let at = Infinity;
      for (const [k, v] of cache) if (v.used < at) [oldest, at] = [k, v.used];
      if (oldest) cache.delete(oldest);
    }
  }

  /* ---- the names: the house's, then every name a Terrain viewer opened today ---- */
  const namesFile = (day: string) => path.join(dayDir(day), 'names.json');
  const readViewers = (day: string): Record<string, number> => {
    try {
      const raw = JSON.parse(fs.readFileSync(namesFile(day), 'utf8')) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) if (cleanTicker(k) && typeof v === 'number') out[k] = v;
      return out;
    } catch {
      return {};
    }
  };
  /* a name the vendor refuses or answers empty, twice running, is left out for the day */
  const dead = new Map<string, number>();
  let deadDay = '';
  const today = () => nyIsoDate(clock());
  function names(): string[] {
    const day = today();
    if (deadDay !== day) {
      dead.clear();
      deadDay = day;
    }
    const viewers = Object.entries(readViewers(day))
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    const out: string[] = [];
    for (const t of [...house, ...viewers]) {
      if (out.length >= max) break;
      if (!out.includes(t) && (dead.get(t) ?? 0) < 2) out.push(t);
    }
    return out;
  }
  function noteViewer(raw: string): void {
    const t = cleanTicker(raw);
    if (!t) return;
    const day = today();
    try {
      const got = readViewers(day);
      const was = got[t];
      /* written at most once a minute a name */
      if (was && clock() - was < 60_000) return;
      got[t] = clock();
      fs.mkdirSync(dayDir(day), { recursive: true });
      writeAtomic(namesFile(day), JSON.stringify(got));
    } catch {
      /* a read-only disk: the name is not recorded */
    }
  }

  /* ---- the front expiry: the first listed date whose 16:00 close is still ahead ---- */
  const expiries = new Map<string, { day: string; dates: string[] }>();
  async function frontOf(t: string, rep: PassReport): Promise<string | null | 'fault'> {
    const day = today();
    let got = expiries.get(t);
    if (!got || got.day !== day) {
      const t0 = clock();
      const res = await o.uw(expiriesPath(t));
      rep.asks += 1;
      if ((res.at ?? t0) >= t0) rep.vendor += 1;
      if (res.status === 429 || res.status >= 500) return 'fault';
      if (res.status !== 200) return null;
      let dates: string[] = [];
      try {
        const data = (JSON.parse(res.body) as { data?: { expiry?: string }[] }).data;
        dates = [...new Set((Array.isArray(data) ? data : []).map(r => String(r?.expiry ?? '').slice(0, 10)).filter(d => DAY.test(d)))].sort();
      } catch {
        return null;
      }
      got = { day, dates };
      expiries.set(t, got);
    }
    const now = clock();
    return got.dates.find(d => closeOf(d) > now) ?? null;
  }

  /* ---- writing ---- */
  function append(t: string, day: string, line: Line): boolean {
    const data = load(t, day) ?? new DaySeries();
    const key = `${line.c}|${line.p}`;
    if ((data.newest.get(key) ?? 0) >= line.at) return false;
    try {
      fs.mkdirSync(dayDir(day), { recursive: true });
      fs.appendFileSync(fileOf(day, t), `${JSON.stringify(line)}\n`);
    } catch {
      return false;
    }
    load(t, day);
    return true;
  }

  /* ---- one pass ---- */
  let running = false;
  let lastSlot = '';
  let backoff = 0;
  let backoffUntil = 0;
  let turn = 0;
  let passes = 0;
  let missedTotal = 0;
  let passesMissing = 0;
  let last: PassReport | null = null;
  const recentVendor: number[] = [];

  type Job = { t: string; cut: 'book' | 'front' };
  const retryable = (s: number) => s === 429 || s >= 500;

  async function runJob(job: Job, day: string, rep: PassReport): Promise<'ok' | 'fault'> {
    const ask = async (p: string) => {
      const t0 = clock();
      const res = await o.uw(p);
      rep.asks += 1;
      /* a copy taken before the ask was a viewer's (or the recorder's own) read, reused; one far older is the hub's last
         good copy kept through a vendor failure: no new reading, and a fault */
      const at = res.at ?? t0;
      if (at >= t0) rep.vendor += 1;
      else if (t0 - at > REUSE_MS + 30_000) return { ...res, status: 503 };
      return res;
    };
    const fail = (t: string) => dead.set(t, (dead.get(t) ?? 0) + 1);
    if (job.cut === 'book') {
      let any = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await ask(bookPath(job.t, page));
        if (retryable(res.status)) return 'fault';
        if (res.status !== 200) break;
        let rows: unknown[] = [];
        try {
          const data = (JSON.parse(res.body) as { data?: unknown }).data;
          rows = Array.isArray(data) ? data : [];
        } catch {
          break;
        }
        if (rows.length) any = true;
        const line = lineOf(rows, ALL, page, clock());
        if (line && append(job.t, day, line)) rep.lines += 1;
        if (rows.length < PAGE) break;
      }
      if (any) dead.delete(job.t);
      else fail(job.t);
      return 'ok';
    }
    const e = await frontOf(job.t, rep);
    if (e === 'fault') return 'fault';
    if (!e) return 'ok';
    const res = await ask(frontPath(job.t, e));
    if (retryable(res.status)) return 'fault';
    if (res.status !== 200) return 'ok';
    try {
      const data = (JSON.parse(res.body) as { data?: unknown }).data;
      const line = lineOf(data, e, 0, clock());
      if (line && append(job.t, day, line)) rep.lines += 1;
    } catch {
      /* an unreadable answer: no reading this minute */
    }
    return 'ok';
  }

  async function pass(slot: { day: string; minute: number }): Promise<PassReport> {
    running = true;
    const t0 = clock();
    const rep: PassReport = { slot: `${slot.day} ${String(Math.floor(slot.minute / 60)).padStart(2, '0')}:${String(slot.minute % 60).padStart(2, '0')}`, startedAt: t0, took: 0, asks: 0, vendor: 0, lines: 0, missed: 0, fault: null };
    try {
      const list = names();
      /* the book (Terrain's default cut) for every name first, then the front expiry: when time runs short it is the
         second cut that waits. Each phase starts where the last pass stopped, so no name is always last. */
      const n = list.length;
      const start = n ? turn % n : 0;
      const order = list.map((_, i) => list[(start + i) % n]);
      const jobs: Job[] = [...order.map(t => ({ t, cut: 'book' as const })), ...(front ? order.map(t => ({ t, cut: 'front' as const })) : [])];
      for (let i = 0; i < jobs.length; i++) {
        if (clock() - t0 > PASS_MS) {
          rep.missed = jobs.length - i;
          turn = (start + (i % Math.max(1, n))) % Math.max(1, n);
          break;
        }
        let got: 'ok' | 'fault';
        try {
          got = await runJob(jobs[i], slot.day, rep);
        } catch {
          got = 'fault';
        }
        if (got === 'fault') {
          rep.fault = `${jobs[i].t} ${jobs[i].cut}`;
          rep.missed = jobs.length - i - 1;
          backoff = Math.min(8, backoff ? backoff * 2 : 1);
          backoffUntil = clock() + backoff * 60_000;
          log(`[exposure] the vendor refused or failed (${rep.fault}): next pass in ${backoff} min`);
          turn = (start + (i % Math.max(1, n))) % Math.max(1, n);
          break;
        }
      }
      if (!rep.fault) backoff = 0;
    } finally {
      rep.took = clock() - t0;
      running = false;
      passes += 1;
      if (rep.missed > 0) {
        missedTotal += rep.missed;
        passesMissing += 1;
        /* once, then every tenth such pass: a recorder starved of slots says so without filling the log */
        if (!rep.fault && passesMissing % 10 === 1) log(`[exposure] ${rep.slot}: the pass ran out of time with ${rep.missed} cut(s) unread (${passesMissing} such passes since start)`);
      }
      last = rep;
      recentVendor.push(rep.vendor);
      if (recentVendor.length > 10) recentVendor.shift();
    }
    return rep;
  }

  async function tick(): Promise<PassReport | null> {
    if (!recording || running) return null;
    const now = clock();
    if (now < backoffUntil) return null;
    const slot = slotAt(now, extEvery);
    if (!slot) return null;
    const key = `${slot.day} ${slot.minute}`;
    if (key === lastSlot) return null;
    lastSlot = key;
    return pass(slot);
  }

  /* ---- pruning ---- */
  function prune(): void {
    if (!recording) return;
    const p = nyParts(clock());
    const floor = isoDay(p.year, p.month, p.day - keepDays);
    const day = today();
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(o.dir);
    } catch {
      return;
    }
    for (const d of entries) {
      if (!DAY.test(d)) continue;
      const full = dayDir(d);
      if (d < floor) {
        try {
          fs.rmSync(full, { recursive: true, force: true });
          log(`[exposure] removed ${d} (kept ${keepDays} days)`);
        } catch {
          /* in use: next time */
        }
        continue;
      }
      if (d >= day) continue;
      /* a finished day: its lines gzipped (about a fifth of the size) */
      let files: string[] = [];
      try {
        files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        try {
          const plain = path.join(full, f);
          writeAtomic(`${plain}.gz`, gzipSync(fs.readFileSync(plain)));
          fs.unlinkSync(plain);
        } catch {
          /* next time */
        }
      }
    }
    for (const k of [...cache.keys()]) if (k.split('|')[1] < floor) cache.delete(k);
  }

  /* ---- timers ---- */
  const timers: ReturnType<typeof setInterval>[] = [];
  if (recording && !o.manual) {
    timers.push(setInterval(() => void tick().catch(() => {}), 5_000));
    timers.push(
      setInterval(() => {
        const lock = takeLock(o.dir, clock());
        if (!lock.ok) {
          recording = false;
          why = `Another server process (pid ${lock.pid}) took the recorder lock.`;
          log(`[exposure] recorder lock taken by pid ${lock.pid}`);
        }
      }, 30_000),
    );
    timers.push(setInterval(prune, 3_600_000));
    for (const t of timers) t.unref?.();
    prune();
    log(`[exposure] recording ${names().length} names (cap ${max}) into ${o.dir}`);
  } else if (!recording) log(`[exposure] ${why}`);

  return {
    dir: o.dir,
    noteViewer,
    names,
    day(t, day, since = 0) {
      const name = cleanTicker(t);
      if (!name || !DAY.test(day)) return null;
      const data = load(name, day);
      return {
        format: EXPOSURE_FORMAT,
        ticker: name,
        day,
        recording,
        startedAt: recording ? startedAt : null,
        firstAt: data?.firstAt ?? null,
        lastAt: data?.lastAt ?? null,
        readings: data?.readings ?? 0,
        series: data ? data.out(since) : [],
      };
    },
    status: () => ({
      recording,
      why,
      startedAt,
      names: names(),
      viewers: Object.keys(readViewers(today())).length,
      max,
      front,
      extEvery,
      keepDays,
      backoffUntil,
      last,
      passes,
      recentVendor: [...recentVendor],
      missedTotal,
      passesMissing,
    }),
    tick,
    prune,
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      if (recording) dropLock(o.dir);
      recording = false;
      log('[exposure] recorder stopped');
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

/** /api/exposure/day?ticker=T&day=YYYY-MM-DD[&since=ms]  one name's recorded series for a day (asking for today names
                                                            the ticker as opened by a viewer)
    /api/exposure/status                                    the recorder: names, the last pass, its vendor calls */
export function exposureRoute(rec: Recorder, req: Req, res: Res, now: () => number = Date.now): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://local');
  const route = url.pathname.replace(/^\/api\/exposure/, '') || '/';
  if (route === '/day') {
    const t = cleanTicker(url.searchParams.get('ticker'));
    const day = url.searchParams.get('day') || nyIsoDate(now());
    if (!t || !DAY.test(day)) {
      send(req, res, 400, { error: 'ticker must be a symbol and day YYYY-MM-DD' });
      return;
    }
    const since = Number(url.searchParams.get('since')) || 0;
    if (day === nyIsoDate(now())) rec.noteViewer(t);
    send(req, res, 200, rec.day(t, day, since));
    return;
  }
  if (route === '/status') {
    send(req, res, 200, rec.status());
    return;
  }
  send(req, res, 404, { error: 'not found' });
}

/** New York's 04:00 and the regular open on a day, ms: where a full day's record starts */
export function dayMarks(day: string): { start: number; open: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { start: nyWallTime(y, m, d, 4, 0), open: nyWallTime(y, m, d, 9, 30) };
}
