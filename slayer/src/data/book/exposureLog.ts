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
import { nyIsoDate, nyWallTime } from '../../core/nyTime';
import { isTradingDay } from '../../core/calendar';
import { keptOf } from '../../core/dealerSign';
import { uwCall } from '../whales';
import type { GexSnapshot } from '../../types/market';

/** The two models the field draws: the open-interest book, or the dealer gamma of today's trades by side */
export type FieldMode = 'oi' | 'flow';
/** The expiries a cut reads: one date, or every expiry ('book') */
export type FieldCut = string | 'book';

/** Readings further apart than this are not joined: the cells between them are empty */
export const JOIN_MS = 180_000;
/** Strikes kept with their history: within this share of the row's price (every strike keeps its latest values) */
const WINDOW = 0.05;
/** A day's readings start at 04:00 New York, the start of the day's tape */
const DAY_START_HOUR = 4;
/** The pseudo-expiry of the vendor's whole-book rows (spot-exposures/strike), read for past sessions' closes only */
const ALL = 'ALL';
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

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const closeOf = (expiry: string): number => {
  if (expiry === ALL) return Infinity;
  const [y, m, d] = expiry.split('-').map(Number);
  return nyWallTime(y, m, d, 16, 0);
};

const dayStartOf = (ms: number): number => {
  const [y, m, d] = nyIsoDate(ms).split('-').map(Number);
  return nyWallTime(y, m, d, DAY_START_HOUR, 0);
};

/** One row's two measures, dealer sign, dollars per 1% move */
export function rowMeasures(r: Record<string, unknown>): { oi: number; flow: number } {
  return {
    oi: num(r.call_gamma_oi) + num(r.put_gamma_oi),
    flow: num(r.call_gamma_ask) + num(r.call_gamma_bid) + num(r.put_gamma_ask) + num(r.put_gamma_bid),
  };
}

const logOf = (t: string): NameLog => {
  let log = logs.get(t);
  if (!log) logs.set(t, (log = { day: '', series: new Map(), latest: new Map(), from: Infinity, rev: 0 }));
  return log;
};

/** Put one reading into a series in time order: the same recalculation read again extends it; one that overlaps a
    different reading adds nothing */
function place(s: Series, from: number, to: number, oi: number, flow: number): boolean {
  const segs = s.segs;
  let lo = 0;
  let hi = segs.length / 4;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (segs[m * 4] <= from) lo = m + 1;
    else hi = m;
  }
  const at = lo * 4; // insertion point; the reading before it starts at or before `from`
  if (at > 0 && segs[at - 4] === from) {
    if (segs[at - 2] !== oi || segs[at - 1] !== flow) return false;
    if (to <= segs[at - 3]) return false;
    if (at < segs.length && to >= segs[at]) return false;
    segs[at - 3] = to;
    return true;
  }
  if (at > 0 && from <= segs[at - 3]) return false;
  if (at < segs.length && to >= segs[at]) return false;
  segs.splice(at, 0, from, to, oi, flow);
  return true;
}

/** Take one answer of exposure rows into the name's log. Rows carry their expiry (spot-exposures/expiry-strike); rows
    without one (the whole book, spot-exposures/strike) are taken only when `allRows` says so — a past close. */
export function noteExposureRows(ticker: string, rows: unknown, allRows = false): void {
  if (!Array.isArray(rows) || !rows.length) return;
  const t = ticker.toUpperCase();
  let answeredAt = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const at = Date.parse(String(r?.time ?? ''));
    if (Number.isFinite(at) && at > answeredAt) answeredAt = at;
  }
  if (!(answeredAt > 0)) return;
  const day = nyIsoDate(answeredAt);
  const log = logOf(t);
  if (day > log.day) log.day = day;
  const start = dayStartOf(answeredAt);
  let changed = false;
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const expiry = allRows ? ALL : String(r.expiry ?? '').slice(0, 10);
    const strike = num(r.strike);
    if ((!allRows && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) || !(strike > 0)) continue;
    const rowAt = Date.parse(String(r.time ?? ''));
    if (!Number.isFinite(rowAt)) continue;
    const { oi, flow } = rowMeasures(r);
    if (!allRows) {
      let byStrike = log.latest.get(expiry);
      if (!byStrike) log.latest.set(expiry, (byStrike = new Map()));
      const prev = byStrike.get(strike);
      if (!prev || rowAt >= prev.at) byStrike.set(strike, { oi, flow, at: rowAt });
    }
    const px = num(r.price);
    if (px > 0 && Math.abs(strike - px) > px * WINDOW) continue;
    const key = `${expiry}|${strike}`;
    let s = log.series.get(key);
    if (!s) log.series.set(key, (s = { expiry, strike, closeAt: closeOf(expiry), segs: [] }));
    const from = Math.max(rowAt, start);
    if (answeredAt < from) continue;
    if (place(s, from, answeredAt, oi, flow)) {
      if (from < log.from) log.from = from;
      changed = true;
    }
  }
  if (changed) {
    log.rev += 1;
    scheduleSave(t);
    emit();
  }
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

const expiriesOf = (log: NameLog, cut: FieldCut): string[] => {
  if (cut !== 'book') return [cut];
  const out = new Set(log.latest.keys());
  for (const s of log.series.values()) if (s.expiry !== ALL) out.add(s.expiry);
  return [...out];
};

/** The cut's latest net, dealer sign, per measure — every strike of every expiry in the cut not expired at `now`. The
    open-interest figure is the same rows' sum the book's net GEX is. */
export function exposureNet(ticker: string, cut: FieldCut, now: number = Date.now()): { oi: number; flow: number; at: number } | null {
  const log = logs.get(ticker.toUpperCase());
  if (!log) return null;
  let oi = 0;
  let flow = 0;
  let at = 0;
  let any = false;
  for (const e of expiriesOf(log, cut)) {
    if (cut === 'book' && closeOf(e) <= now) continue;
    for (const v of log.latest.get(e)?.values() ?? []) {
      oi += v.oi;
      flow += v.flow;
      if (v.at > at) at = v.at;
      any = true;
    }
  }
  return any ? { oi, flow, at } : null;
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
 * day bar: the whole day's, the measure starting each day at nothing). A cell is drawn only where every expiry of the cut
 * holding that strike has a reading for it; a past session read only as of its close draws only on a day bar.
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
  const exps = new Set(expiriesOf(log, cut));
  if (cut === 'book') exps.add(ALL);
  const byStrike = new Map<number, Series[]>();
  for (const s of log.series.values()) {
    if (!exps.has(s.expiry)) continue;
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
  const whole = new Float64Array(n);
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
    whole.fill(NaN);
    for (const s of byStrike.get(strikes[r])!) {
      if (s.expiry === ALL) {
        walk(s, (c, v) => {
          whole[c] = v;
        });
        continue;
      }
      /* a bar the series was alive in but has no reading for spoils the cell */
      walk(s, (c, v) => {
        if (Number.isNaN(v)) bad[c] = 1;
        else {
          sum[c] += v;
          any[c] = 1;
        }
      });
    }
    for (let c = c0; c < n; c++) {
      /* the vendor's whole-book close stands for a past session the expiries were not read in */
      if (!Number.isNaN(whole[c]) && (bad[c] || !any[c])) values[c * R + r] = whole[c];
      else if (any[c] && !bad[c]) values[c * R + r] = sum[c];
    }
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
    const log = logOf(t);
    const floor = Date.now() - KEEP_DAYS * 86_400_000;
    let changed = false;
    for (const [expiry, strike, segs] of kept.series) {
      const key = `${expiry}|${strike}`;
      let s = log.series.get(key);
      if (!s) log.series.set(key, (s = { expiry, strike, closeAt: closeOf(expiry), segs: [] }));
      for (let i = 0; i < segs.length; i += 4) {
        if (segs[i + 1] < floor) continue;
        if (place(s, segs[i], segs[i + 1], segs[i + 2], segs[i + 3])) {
          changed = true;
          if (segs[i] < log.from) log.from = segs[i];
          const day = nyIsoDate(segs[i + 1]);
          if (day > log.day) log.day = day;
        }
      }
    }
    if (changed) {
      log.rev += 1;
      emit();
    }
  })();
}

/** Forget a name's log (tests) */
export function resetExposureLog(ticker?: string): void {
  if (ticker) logs.delete(ticker.toUpperCase());
  else logs.clear();
  gridMemo.clear();
  closesAsked.clear();
}
