/* The vendor's per-strike, per-expiry gamma as the book reads it through the day (spot-exposures/expiry-strike), kept as
   readings, and the exposure field's grid built from them: one row per strike, one column per chart bar, one value per
   cell for the chosen expiries.

   A row is the vendor's book for one strike and expiry at its own `time` — the last moment the vendor recalculated it
   (a new trade or new greeks; a price move alone does not recalculate it) — and it stands unchanged until the answer
   that carried it. So one answer says the value held from the row's `time` to the latest `time` in that answer, and
   that interval is all a reading claims. Readings an answer apart (the book reads every minute) are joined; a longer gap
   is no reading, and its cells are left empty. The vendor serves no earlier per-strike state for today: its per-strike
   routes answer the latest book only, and a past date only as of that date's close (closes below).

   Both of the vendor's measures are kept, in its dealer sign (positive: dealers long gamma, their hedging absorbs):
   - open interest: call_gamma_oi + put_gamma_oi, the morning's open interest priced at the row's minute;
   - today's flow: call_gamma_ask + call_gamma_bid + put_gamma_ask + put_gamma_bid — the day's volume by the side it
     traded on, a customer buying at the ask leaving dealers short (the vendor prints those fields negative) and one
     selling at the bid leaving them long. It is the day's trades only, never a position carried from earlier days. */

import { useEffect, useSyncExternalStore } from 'react';
import { nyIsoDate, nyMinutes, nyWallTime } from '../../core/nyTime';
import { isTradingDay } from '../../core/calendar';
import { keptOf } from '../../core/dealerSign';
import { uwCall } from '../whales';
import { feedHeaders } from '../feedGate';
import type { GexSnapshot } from '../../types/market';
import { ALL, JOIN_MS, closeOf, dayStartOf, placeSeg, readAnswer, rowMeasures, spanOf, type KeptSeries } from './exposureSegs';

export { JOIN_MS, rowMeasures };

/** The two models the field draws: the open-interest book, or the dealer gamma of today's trades by side */
export type FieldMode = 'oi' | 'flow';
/** The expiries a cut reads: one date, or every expiry ('book') */
export type FieldCut = string | 'book';

/* The join (JOIN_MS), the strike window, the day's 04:00 start and the whole book's pseudo-expiry are one rule with the
   server's recorder: data/book/exposureSegs.ts */
/** Readings older than this are dropped from memory and from the kept copy */
const KEEP_DAYS = 12;

interface Series {
  expiry: string;
  strike: number;
  /** 16:00 New York on the expiry, ms — the contracts are gone after it */
  closeAt: number;
  /** Flat: from, to (ms), oi, flow — one reading each, in time order, never overlapping */
  segs: number[];
}

interface Latest {
  oi: number;
  flow: number;
  at: number;
}

interface NameLog {
  /** The newest day any reading is on */
  day: string;
  series: Map<string, Series>;
  latest: Map<string, Map<number, Latest>>;
  /** The earliest moment any reading covers, ms */
  from: number;
  rev: number;
}

const logs = new Map<string, NameLog>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

const logOf = (t: string): NameLog => {
  let log = logs.get(t);
  if (!log) logs.set(t, (log = { day: '', series: new Map(), latest: new Map(), from: Infinity, rev: 0 }));
  return log;
};

/** Take one answer of exposure rows into the name's log: one expiry's rows (spot-exposures/expiry-strike, each with its
    `expiry`), or with `allRows` the whole book's (spot-exposures/strike, every expiry at the strike in one row). */
export function noteExposureRows(ticker: string, rows: unknown, allRows = false): void {
  const read = readAnswer(rows, allRows);
  if (!read) return;
  const t = ticker.toUpperCase();
  const { answeredAt } = read;
  const day = nyIsoDate(answeredAt);
  const log = logOf(t);
  if (day > log.day) log.day = day;
  let changed = false;
  for (const r of read.rows) {
    const { expiry, strike, rowAt, oi, flow } = r;
    let byStrike = log.latest.get(expiry);
    if (!byStrike) log.latest.set(expiry, (byStrike = new Map()));
    const prev = byStrike.get(strike);
    if (!prev || rowAt >= prev.at) byStrike.set(strike, { oi, flow, at: rowAt });
    if (!r.near) continue;
    const span = spanOf(rowAt, answeredAt);
    if (!span) continue;
    const key = `${expiry}|${strike}`;
    let s = log.series.get(key);
    if (!s) log.series.set(key, (s = { expiry, strike, closeAt: closeOf(expiry), segs: [] }));
    if (placeSeg(s.segs, span.from, span.to, oi, flow)) {
      if (span.from < log.from) log.from = span.from;
      changed = true;
    }
  }
  if (changed) {
    log.rev += 1;
    scheduleSave(t);
    emit();
  }
}

/** Place kept series (this browser's copy, or the server's recording) into a name's log. True when anything landed. */
function placeKept(t: string, series: readonly KeptSeries[] | readonly [string, number, ArrayLike<number>][], floor = -Infinity): boolean {
  const log = logOf(t);
  let changed = false;
  for (const [expiry, strike, segs] of series) {
    if (typeof expiry !== 'string' || !(strike > 0) || !segs || segs.length % 4) continue;
    const key = `${expiry}|${strike}`;
    let s = log.series.get(key);
    if (!s) log.series.set(key, (s = { expiry, strike, closeAt: closeOf(expiry), segs: [] }));
    for (let i = 0; i < segs.length; i += 4) {
      if (segs[i + 1] < floor) continue;
      if (placeSeg(s.segs, segs[i], segs[i + 1], segs[i + 2], segs[i + 3])) {
        changed = true;
        if (segs[i] < log.from) log.from = segs[i];
        const day = nyIsoDate(segs[i + 1]);
        if (day > log.day) log.day = day;
      }
    }
  }
  if (changed) log.rev += 1;
  return changed;
}

/** Merge the server's recorded series for a name (GET /api/exposure/day) into the log: the same segments this browser
    would have read, so the two join without seams; where both hold the same minute, they agree. */
export function mergeExposureSeries(ticker: string, series: readonly KeptSeries[]): boolean {
  const t = ticker.toUpperCase();
  const changed = placeKept(t, series);
  if (changed) {
    scheduleSave(t);
    emit();
  }
  return changed;
}

/** The log's revision for a name — a grid built at one revision stands until it moves */
export const exposureLogRev = (ticker: string): number => logs.get(ticker.toUpperCase())?.rev ?? 0;

/** The log's revision for a name, as a hook (it also brings back this browser's kept copy of the day) */
export function useExposureLogRev(ticker: string): number {
  const t = ticker.toUpperCase();
  useEffect(() => {
    restoreExposureLog(t);
  }, [t]);
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => exposureLogRev(t),
    () => exposureLogRev(t),
  );
}

/** The newest day the log holds, and the earliest moment it covers (ms) — null before the first answer */
export function exposureLogSpan(ticker: string): { day: string; from: number } | null {
  const log = logs.get(ticker.toUpperCase());
  return log && Number.isFinite(log.from) ? { day: log.day, from: log.from } : null;
}

const todayMemo = new Map<string, { rev: number; at: number | null }>();
/** The first moment today any reading covers, ms — null before today's first answer */
export function exposureTodayFrom(ticker: string, now: number = Date.now()): number | null {
  const t = ticker.toUpperCase();
  const log = logs.get(t);
  if (!log) return null;
  const hit = todayMemo.get(t);
  if (hit && hit.rev === log.rev) return hit.at;
  const start = dayStartOf(now);
  let best = Infinity;
  for (const s of log.series.values()) {
    for (let i = 0; i < s.segs.length; i += 4) {
      if (s.segs[i + 1] < start) continue;
      if (Math.max(start, s.segs[i]) < best) best = Math.max(start, s.segs[i]);
      break;
    }
  }
  const at = Number.isFinite(best) ? best : null;
  todayMemo.set(t, { rev: log.rev, at });
  return at;
}

/* One expiry's own rows, or for every expiry the vendor's whole-book rows: each cut reads one row a strike, so a cell is
   one series' reading */
const seriesOf = (cut: FieldCut): string => (cut === 'book' ? ALL : cut);

/** The cut's latest net, dealer sign, per measure: every strike's newest row. One expiry's open-interest figure is the
    same rows' sum the book's net GEX is for that date. */
export function exposureNet(ticker: string, cut: FieldCut): { oi: number; flow: number; at: number } | null {
  const log = logs.get(ticker.toUpperCase());
  const rows = log?.latest.get(seriesOf(cut));
  if (!rows?.size) return null;
  let oi = 0;
  let flow = 0;
  let at = 0;
  for (const v of rows.values()) {
    oi += v.oi;
    flow += v.flow;
    if (v.at > at) at = v.at;
  }
  return { oi, flow, at };
}

/** One cut's grid on the chart's bars, dealer sign */
export interface ExposureGrid {
  /** Bar start times, seconds — the chart's own bars */
  times: number[];
  strikes: number[];
  /** values[col * strikes.length + row], dealer sign; NaN = no reading */
  values: Float64Array;
}

const gridMemo = new Map<string, { key: string; grid: ExposureGrid }>();

/**
 * The field's grid for a cut, on the chart's bars (`times`, seconds, oldest first; each bar spans `barSec`, a day bar its
 * New York day). Open interest: the last reading inside the bar, a level. Today's flow: the change in the day's
 * directional dealer gamma across the bar — the bar's trades, plus the re-pricing of the day's earlier ones — a sum (a
 * day bar: the whole day's, the measure starting each day at nothing). A cell is drawn only where a reading covers it
 * (the flow: its start and its end); a past session read only as of its close draws only on a day bar.
 */
export function exposureGrid(ticker: string, cut: FieldCut, times: readonly number[], barSec: number, mode: FieldMode, now: number = Date.now()): ExposureGrid | null {
  const t = ticker.toUpperCase();
  restoreExposureLog(t);
  const log = logs.get(t);
  if (!log || !times.length || !Number.isFinite(log.from)) return null;
  const memoKey = `${t}|${cut}|${mode}|${barSec}`;
  const key = `${log.rev}|${times.length}|${times[0]}|${times[times.length - 1]}|${Math.floor(now / 30_000)}`;
  const hit = gridMemo.get(memoKey);
  if (hit && hit.key === key) return hit.grid;
  const dayBars = barSec >= 86_400;
  const n = times.length;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (dayBars) {
      const [y, m, d] = nyIsoDate(times[i] * 1000).split('-').map(Number);
      a[i] = nyWallTime(y, m, d, 0, 0);
      b[i] = Math.min(now, nyWallTime(y, m, d + Math.max(1, Math.round(barSec / 86_400)), 0, 0));
    } else {
      a[i] = times[i] * 1000;
      b[i] = Math.min(now, (times[i] + barSec) * 1000);
    }
  }
  /* the first bar that can hold a reading */
  let c0 = 0;
  while (c0 < n && b[c0] <= log.from) c0++;
  const want = seriesOf(cut);
  const byStrike = new Map<number, Series[]>();
  for (const s of log.series.values()) {
    if (s.expiry !== want) continue;
    const list = byStrike.get(s.strike);
    if (list) list.push(s);
    else byStrike.set(s.strike, [s]);
  }
  const strikes = [...byStrike.keys()].sort((x, y) => x - y);
  const R = strikes.length;
  const values = new Float64Array(n * R).fill(NaN);
  const sum = new Float64Array(n);
  const bad = new Uint8Array(n);
  const any = new Uint8Array(n);
  /* how far a reading reaches: to the next when they are an answer apart, and the newest toward now by the same join */
  const reach = (segs: number[], j: number): number => {
    const to = segs[j + 1];
    const next = j + 4 < segs.length ? segs[j + 4] : now;
    return next - to <= JOIN_MS ? Math.max(to, next) : to;
  };
  const field = mode === 'oi' ? 2 : 3;
  /* one series' value in each bar into `into` (NaN where it has none), by a walk in time order */
  const walk = (s: Series, into: (c: number, v: number) => void) => {
    const segs = s.segs;
    if (!segs.length) return;
    let j = 0; // the last reading starting before the bar's end
    let k = 0; // the last reading starting at or before the bar's start
    for (let c = c0; c < n; c++) {
      if (a[c] >= s.closeAt) break;
      while (j + 4 < segs.length && segs[j + 4] < b[c]) j += 4;
      const end = segs[j] < b[c] && reach(segs, j) >= a[c] ? segs[j + field] : NaN;
      if (Number.isNaN(end) || mode === 'oi') {
        into(c, end);
        continue;
      }
      /* flow: the change across the bar; a day bar starts its day at nothing */
      if (dayBars) {
        into(c, end);
        continue;
      }
      while (k + 4 < segs.length && segs[k + 4] <= a[c]) k += 4;
      const startOk = segs[k] <= a[c] && reach(segs, k) >= a[c];
      into(c, startOk ? end - segs[k + field] : NaN);
    }
  };
  for (let r = 0; r < R; r++) {
    sum.fill(0);
    bad.fill(0);
    any.fill(0);
    for (const s of byStrike.get(strikes[r])!) {
      /* a bar the series was alive in but has no reading for spoils the cell */
      walk(s, (c, v) => {
        if (Number.isNaN(v)) bad[c] = 1;
        else {
          sum[c] += v;
          any[c] = 1;
        }
      });
    }
    for (let c = c0; c < n; c++) if (any[c] && !bad[c]) values[c * R + r] = sum[c];
  }
  const grid: ExposureGrid = { times: [...times], strikes, values };
  gridMemo.set(memoKey, { key, grid });
  if (gridMemo.size > 24) gridMemo.delete(gridMemo.keys().next().value!);
  return grid;
}

/** The grid as the field's columns (GexSnapshot, house sign as every book figure is kept) — only bars with a cell */
export function gridColumns(grid: ExposureGrid): GexSnapshot[] {
  const out: GexSnapshot[] = [];
  const R = grid.strikes.length;
  for (let c = 0; c < grid.times.length; c++) {
    const levels: GexSnapshot['levels'] = [];
    for (let r = 0; r < R; r++) {
      const v = grid.values[c * R + r];
      if (Number.isNaN(v)) continue;
      levels.push({ strike: grid.strikes[r], value: keptOf(v), dex: 0, vex: 0, callOI: 0, putOI: 0 });
    }
    if (levels.length) out.push({ time: grid.times[c], levels });
  }
  return out;
}

/* ---- the cut's own reading, once a minute while a field shows it ---------------------------------------------- */

const POLL_MS = 60_000;
const polls = new Map<string, { n: number; id: number }>();

async function readCut(t: string, cut: FieldCut): Promise<void> {
  if (cut === 'book') {
    for (let page = 0; page < 4; page++) {
      const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/strike?limit=500&page=${page}`);
      if (res.error || !Array.isArray(res.data)) return;
      noteExposureRows(t, res.data, true);
      if (res.data.length < 500) return;
    }
    return;
  }
  const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(cut)}&limit=500`);
  if (!res.error) noteExposureRows(t, res.data);
}

/** Read the cut's rows once a minute while a field shows them (the book itself reads a date's rows every few minutes,
    and readings further apart than JOIN_MS are not joined); the same paths the book asks, so a shared answer is reused */
export function useFieldPoll(ticker: string, cut: FieldCut | null, on = true): void {
  useEffect(() => {
    if (!on || !ticker || !cut) return;
    const key = `${ticker.toUpperCase()}|${cut}`;
    const cur = polls.get(key);
    if (cur) cur.n += 1;
    else {
      /* the server's recording of the day first (from the open, whenever this page opened), then this page's own reads */
      pullExposureServer(ticker);
      void readCut(ticker.toUpperCase(), cut);
      polls.set(key, {
        n: 1,
        id: window.setInterval(() => {
          pullExposureServer(ticker);
          void readCut(ticker.toUpperCase(), cut);
        }, POLL_MS),
      });
    }
    return () => {
      const p = polls.get(key);
      if (!p) return;
      p.n -= 1;
      if (p.n <= 0) {
        window.clearInterval(p.id);
        polls.delete(key);
      }
    };
  }, [ticker, cut, on]);
}

/* ---- the server's recording (GET /api/exposure/day, data/exposureRecorder.ts) --------------------------------- */

/** What the server's exposure recorder holds for a name today */
export interface ServerExposure {
  /** 'waiting' before the first answer; 'on' the server serves a record for the name; 'off' no recorder answers here (a
      hosted deployment, or EXPOSURE_RECORDER=0 with nothing on file): the field starts at this page's first read */
  state: 'waiting' | 'on' | 'off';
  /** a recorder reads on the server now */
  recording: boolean;
  /** the server's first read of the name today, ms (null: none yet) */
  firstAt: number | null;
}
const SERVER_WAITING: ServerExposure = { state: 'waiting', recording: false, firstAt: null };
const serverState = new Map<string, ServerExposure>();
const serverPull = new Map<string, { at: number; since: number; busy: boolean; past: Set<string> }>();
/** The server's record is asked again this often while a field shows the name (only what changed since the last ask) */
const SERVER_EVERY_MS = 5 * 60_000;
const OPEN_MIN = 9 * 60 + 30;

interface ServedDay {
  format: string;
  recording: boolean;
  firstAt: number | null;
  lastAt: number | null;
  series: KeptSeries[];
}

async function pullDay(t: string, day: string, since: number): Promise<{ ok: true; body: ServedDay } | { ok: false; off: boolean }> {
  const auth = await feedHeaders();
  if (!auth.ok) return { ok: false, off: false };
  try {
    const res = await fetch(`/api/exposure/day?ticker=${encodeURIComponent(t)}&day=${day}${since > 0 ? `&since=${Math.floor(since)}` : ''}`, { headers: auth.headers });
    const body = (await res.json().catch(() => null)) as ServedDay | null;
    /* a server without the recorder (a hosted deployment answers 404, a stopped one 503) is "off"; a refusal at the gate is not */
    if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, off: false };
    if (!res.ok || !body || body.format !== 'exposure-day/1' || !Array.isArray(body.series)) return { ok: false, off: true };
    mergeExposureSeries(t, body.series);
    return { ok: true, body };
  } catch {
    return { ok: false, off: false };
  }
}

const setServer = (t: string, next: ServerExposure) => {
  const was = serverState.get(t);
  if (was && was.state === next.state && was.recording === next.recording && was.firstAt === next.firstAt) return;
  serverState.set(t, next);
  emit();
};

/** Ask the server for the name's recorded day and merge it into the log: at once on the first ask of a page, then at
    most every five minutes, only the segments that changed. Before today's open (or on a day the market is shut) the
    session before is asked once too: the chart shows it. */
export function pullExposureServer(ticker: string, now: number = Date.now()): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const t = ticker.toUpperCase();
  let p = serverPull.get(t);
  if (!p) serverPull.set(t, (p = { at: 0, since: 0, busy: false, past: new Set() }));
  if (p.busy || (p.at && now - p.at < SERVER_EVERY_MS)) return;
  p.busy = true;
  const pull = p;
  void (async () => {
    try {
      const today = nyIsoDate(now);
      const [y, m, d] = today.split('-').map(Number);
      const trading = isTradingDay(new Date(y, m - 1, d));
      if (!trading || nyMinutes(now) < OPEN_MIN) {
        const prev = priorSessions(1, now)[0];
        if (prev && !pull.past.has(prev)) {
          pull.past.add(prev);
          await pullDay(t, prev, 0);
        }
      }
      const got = await pullDay(t, today, pull.since);
      if (got.ok) {
        /* segments that end after a little before the last read: one a later reading extended is sent again whole */
        if (got.body.lastAt) pull.since = Math.max(pull.since, got.body.lastAt - JOIN_MS);
        const was = serverState.get(t);
        const firstAt = was?.firstAt != null && got.body.firstAt != null ? Math.min(was.firstAt, got.body.firstAt) : got.body.firstAt ?? was?.firstAt ?? null;
        setServer(t, { state: 'on', recording: !!got.body.recording, firstAt });
      } else if (got.off && serverState.get(t)?.state !== 'on') setServer(t, { state: 'off', recording: false, firstAt: null });
    } finally {
      pull.at = Date.now();
      pull.busy = false;
    }
  })();
}

/** The server's recording of a name, as a hook */
export function useServerExposure(ticker: string): ServerExposure {
  const t = ticker.toUpperCase();
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => serverState.get(t) ?? SERVER_WAITING,
    () => serverState.get(t) ?? SERVER_WAITING,
  );
}

/* ---- past sessions: each one's book as of its close ---------------------------------------------------------- */

const closesAsked = new Set<string>();

/** The sessions before today, newest first */
function priorSessions(count: number, now: number = Date.now()): string[] {
  const out: string[] = [];
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  for (let back = 1; out.length < count && back < count * 3 + 7; back++) {
    const day = new Date(y, m - 1, d - back);
    if (!isTradingDay(day)) continue;
    out.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** Read the cut's book as of each of the last `count` sessions' closes, once each (a past date never changes): one
    expiry's rows off spot-exposures/expiry-strike, or the whole book off spot-exposures/strike. One call at a time. */
export function ensureFieldCloses(ticker: string, cut: FieldCut, count = 8): void {
  const t = ticker.toUpperCase();
  const days = priorSessions(count).filter(d => cut === 'book' || d <= cut);
  const todo = days.filter(d => !closesAsked.has(`${t}|${cut}|${d}`));
  if (!todo.length) return;
  for (const d of todo) closesAsked.add(`${t}|${cut}|${d}`);
  void (async () => {
    for (const d of todo) {
      try {
        if (cut === 'book') {
          for (let page = 0; page < 4; page++) {
            const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/strike?date=${d}&limit=500&page=${page}`);
            if (res.error || !Array.isArray(res.data)) break;
            noteExposureRows(t, res.data, true);
            if (res.data.length < 500) break;
          }
        } else {
          const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(cut)}&date=${d}&limit=500`);
          if (!res.error) noteExposureRows(t, res.data);
        }
      } catch {
        closesAsked.delete(`${t}|${cut}|${d}`);
      }
    }
  })();
}

/* ---- this browser's kept copy (IndexedDB), so a reload keeps the readings it has seen ------------------------- */

const DB = 'slayer-field';
const STORE = 'logs';
const VERSION = 1;
let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

interface KeptLog {
  v: number;
  series: [string, number, Float64Array][];
}

const restored = new Set<string>();
const saving = new Map<string, number>();
const SAVE_MS = 90_000;

function scheduleSave(t: string): void {
  if (saving.has(t) || typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  saving.set(
    t,
    window.setTimeout(() => {
      const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 5000 }) : window.setTimeout(cb, 0));
      idle(() => {
        saving.delete(t);
        void saveLog(t);
      });
    }, SAVE_MS),
  );
}

async function saveLog(t: string): Promise<void> {
  const log = logs.get(t);
  const d = await db();
  if (!log || !d) return;
  const floor = Date.now() - KEEP_DAYS * 86_400_000;
  const series: KeptLog['series'] = [];
  for (const s of log.series.values()) {
    let i = 0;
    while (i < s.segs.length && s.segs[i + 1] < floor) i += 4;
    if (i > 0) s.segs.splice(0, i);
    if (s.segs.length) series.push([s.expiry, s.strike, Float64Array.from(s.segs)]);
  }
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ v: VERSION, series } satisfies KeptLog, t);
  } catch {
    /* full or blocked storage: the readings are simply not kept */
  }
}

/** Bring back this browser's kept readings for a name, once a page */
export function restoreExposureLog(ticker: string): void {
  const t = ticker.toUpperCase();
  if (restored.has(t) || typeof indexedDB === 'undefined') return;
  restored.add(t);
  void (async () => {
    const d = await db();
    if (!d) return;
    const kept = await new Promise<KeptLog | null>(resolve => {
      try {
        const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(t);
        req.onsuccess = () => resolve((req.result as KeptLog) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!kept || kept.v !== VERSION) return;
    if (placeKept(t, kept.series, Date.now() - KEEP_DAYS * 86_400_000)) emit();
  })();
}

/** Forget a name's log (tests) */
export function resetExposureLog(ticker?: string): void {
  if (ticker) {
    logs.delete(ticker.toUpperCase());
    serverState.delete(ticker.toUpperCase());
    serverPull.delete(ticker.toUpperCase());
  } else {
    logs.clear();
    serverState.clear();
    serverPull.clear();
  }
  gridMemo.clear();
  todayMemo.clear();
  closesAsked.clear();
}
