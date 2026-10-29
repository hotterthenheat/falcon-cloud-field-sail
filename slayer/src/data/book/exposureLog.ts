/* The vendor's per-strike, per-expiry gamma as the book reads it through the day (spot-exposures/expiry-strike), kept as
   readings, and the exposure field's grid built from them: one row per strike, one column per chart bar, one value per
   cell for the chosen expiries.

   A row is the vendor's book for one strike and expiry at its own `time` — the last moment the vendor recalculated it
   (a new trade or new greeks; a price move alone does not recalculate it) — and it stands unchanged until the answer
   that carried it. So one answer says the value held from the row's `time` to the latest `time` in that answer, and
   that interval is all a reading claims. Readings an answer apart (the book reads every minute) are joined; a longer gap
   is no reading, and its cells are left empty.

   Both of the vendor's measures are kept, in its dealer sign (positive: dealers long gamma, their hedging absorbs):
   - open interest: call_gamma_oi + put_gamma_oi, the morning's open interest priced at the row's minute;
   - today's flow: call_gamma_ask + call_gamma_bid + put_gamma_ask + put_gamma_bid — today's volume by the side it
     traded on, a customer buying at the ask leaving dealers short (the vendor prints those fields negative) and one
     selling at the bid leaving them long. It is the day's trades only, never a position carried from earlier days. */

import { nyIsoDate, nyWallTime } from '../../core/nyTime';
import { keptOf } from '../../core/dealerSign';
import type { GexSnapshot } from '../../types/market';

/** The two models the field draws: the open-interest book, or the dealer gamma of today's trades by side */
export type FieldMode = 'oi' | 'flow';

/** Readings further apart than this are not joined: the cells between them are empty */
export const JOIN_MS = 180_000;
/** Strikes kept with their history: within this share of the row's price (every strike keeps its latest values) */
const WINDOW = 0.08;
/** The day's readings start at 04:00 New York, the start of the day's tape */
const DAY_START_HOUR = 4;

interface Series {
  expiry: string;
  strike: number;
  /** 16:00 New York on the expiry, ms — the contracts are gone after it */
  closeAt: number;
  /** Flat: from, to (ms), oi, flow — one reading each, in time order */
  segs: number[];
}

interface Latest {
  oi: number;
  flow: number;
  at: number;
}

interface DayLog {
  day: string;
  series: Map<string, Series>;
  latest: Map<string, Map<number, Latest>>;
  /** The earliest moment any reading covers, ms */
  from: number;
  rev: number;
}

const logs = new Map<string, DayLog>();

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const closeOf = (expiry: string): number => {
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

/** Take one answer of spot-exposures/expiry-strike rows (each with its `expiry`) into the name's log. Rows without an
    expiry (the whole-book spot-exposures/strike) are left out: the cuts are built from the expiries' own rows. */
export function noteExposureRows(ticker: string, rows: unknown): void {
  if (!Array.isArray(rows) || !rows.length) return;
  const t = ticker.toUpperCase();
  let answeredAt = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const at = Date.parse(String(r?.time ?? ''));
    if (Number.isFinite(at) && at > answeredAt) answeredAt = at;
  }
  if (!(answeredAt > 0)) return;
  const day = nyIsoDate(answeredAt);
  let log = logs.get(t);
  if (log && log.day !== day) {
    /* an older day's answer (a kept copy) never replaces today's */
    if (log.day > day) return;
    log = undefined;
  }
  if (!log) {
    log = { day, series: new Map(), latest: new Map(), from: Infinity, rev: 0 };
    logs.set(t, log);
  }
  const start = dayStartOf(answeredAt);
  let changed = false;
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const expiry = String(r.expiry ?? '').slice(0, 10);
    const strike = num(r.strike);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !(strike > 0)) continue;
    const rowAt = Date.parse(String(r.time ?? ''));
    if (!Number.isFinite(rowAt)) continue;
    const { oi, flow } = rowMeasures(r);
    let byStrike = log.latest.get(expiry);
    if (!byStrike) log.latest.set(expiry, (byStrike = new Map()));
    const prevLatest = byStrike.get(strike);
    if (!prevLatest || rowAt >= prevLatest.at) byStrike.set(strike, { oi, flow, at: rowAt });
    const px = num(r.price);
    if (px > 0 && Math.abs(strike - px) > px * WINDOW) continue;
    const key = `${expiry}|${strike}`;
    let s = log.series.get(key);
    if (!s) log.series.set(key, (s = { expiry, strike, closeAt: closeOf(expiry), segs: [] }));
    const from = Math.max(rowAt, start);
    const to = answeredAt;
    if (to < from) continue;
    const segs = s.segs;
    const n = segs.length;
    if (n) {
      const lastFrom = segs[n - 4];
      const lastTo = segs[n - 3];
      /* the same recalculation read again: it held until this answer */
      if (from === lastFrom && segs[n - 2] === oi && segs[n - 1] === flow) {
        if (to > lastTo) {
          segs[n - 3] = to;
          changed = true;
        }
        continue;
      }
      /* an answer older than what the log holds (a kept copy arriving late) adds nothing */
      if (from <= lastFrom || to <= lastTo) continue;
    }
    segs.push(from, to, oi, flow);
    if (from < log.from) log.from = from;
    changed = true;
  }
  if (changed) log.rev += 1;
}

/** The log's revision for a name — a grid built at one revision stands until it moves */
export const exposureLogRev = (ticker: string): number => logs.get(ticker.toUpperCase())?.rev ?? 0;

/** The day the log holds, and the earliest moment it covers (ms) — null before the first answer */
export function exposureLogSpan(ticker: string): { day: string; from: number } | null {
  const log = logs.get(ticker.toUpperCase());
  return log && Number.isFinite(log.from) ? { day: log.day, from: log.from } : null;
}

/** The expiries a cut reads: one date, or every expiry in the log ('book') */
export type FieldCut = string | 'book';

const expiriesOf = (log: DayLog, cut: FieldCut): string[] => (cut === 'book' ? [...log.latest.keys()] : log.latest.has(cut) ? [cut] : []);

/** The cut's latest net, dealer sign, per measure — every strike of every expiry in the cut that has not expired at
    `now`. The open-interest figure is the same rows' sum the book's net GEX is. */
export function exposureNet(ticker: string, cut: FieldCut, now: number = Date.now()): { oi: number; flow: number; at: number } | null {
  const log = logs.get(ticker.toUpperCase());
  if (!log) return null;
  let oi = 0;
  let flow = 0;
  let at = 0;
  let any = false;
  for (const e of expiriesOf(log, cut)) {
    if (cut === 'book' && closeOf(e) <= now) continue;
    for (const v of log.latest.get(e)!.values()) {
      oi += v.oi;
      flow += v.flow;
      if (v.at > at) at = v.at;
      any = true;
    }
  }
  return any ? { oi, flow, at } : null;
}

/** One strike's column values for a cut, dealer sign: NaN where no reading covers the bar */
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
 * directional dealer gamma across the bar — the bar's trades, plus the re-pricing of the day's earlier ones — a sum.
 * A cell is drawn only where every expiry of the cut holding that strike has a reading for it.
 */
export function exposureGrid(ticker: string, cut: FieldCut, times: readonly number[], barSec: number, mode: FieldMode, now: number = Date.now()): ExposureGrid | null {
  const t = ticker.toUpperCase();
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
      const ms = times[i] * 1000;
      const [y, m, d] = nyIsoDate(ms).split('-').map(Number);
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
  /* the reading covering moment x of a series: its value, or NaN — a reading reaches to the next when they are an answer
     apart, and the newest reaches toward now by the same join */
  const reach = (segs: number[], j: number): number => {
    const to = segs[j + 1];
    const next = j + 4 < segs.length ? segs[j + 4] : now;
    return next - to <= JOIN_MS ? next : to;
  };
  for (let r = 0; r < R; r++) {
    sum.fill(0);
    bad.fill(0);
    for (const s of byStrike.get(strikes[r])!) {
      const segs = s.segs;
      const field = mode === 'oi' ? 2 : 3;
      let j = 0; // the last reading starting before the bar's end
      let k = 0; // the last reading starting at or before the bar's start
      for (let c = c0; c < n; c++) {
        /* contracts that have expired hold nothing after their bell */
        if (a[c] >= s.closeAt) continue;
        while (j + 4 < segs.length && segs[j + 4] < b[c]) j += 4;
        const endOk = segs.length > 0 && segs[j] < b[c] && reach(segs, j) >= a[c];
        if (!endOk) {
          bad[c] = 1;
          continue;
        }
        const end = segs[j + field];
        if (mode === 'oi') {
          sum[c] += end;
          continue;
        }
        while (k + 4 < segs.length && segs[k + 4] <= a[c]) k += 4;
        const startOk = segs[k] <= a[c] && reach(segs, k) >= a[c];
        if (!startOk) {
          bad[c] = 1;
          continue;
        }
        sum[c] += end - segs[k + field];
      }
    }
    for (let c = c0; c < n; c++) {
      if (!bad[c]) values[c * R + r] = sum[c];
    }
  }
  /* a column no expiry of the cut was alive in, or before the first reading, stays empty */
  for (let c = 0; c < c0; c++) for (let r = 0; r < R; r++) values[c * R + r] = NaN;
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

/** Forget a name's log (tests) */
export function resetExposureLog(ticker?: string): void {
  if (ticker) logs.delete(ticker.toUpperCase());
  else logs.clear();
  gridMemo.clear();
}
