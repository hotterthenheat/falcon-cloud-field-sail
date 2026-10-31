/* The vendor's per-strike, per-expiry gamma as the book reads it through the day (spot-exposures/expiry-strike), kept as
   readings, and the exposure field's grid built from them: one row per strike, one column per chart bar, one value per
   cell for the chosen expiries.

   A row is the vendor's book for one strike and expiry at its own `time` — the last moment the vendor recalculated it
   (a new trade or new greeks; a price move alone does not recalculate it) — and it stands unchanged until the answer
   that carried it. So one answer says the value held from the row's `time` to the latest `time` in that answer, and
   that interval is all a reading claims. Readings an answer apart (the book reads every minute) are joined; a longer gap
   is no reading, and its cells are left empty. The vendor serves no earlier per-strike state for today: its per-strike
   routes answer the latest book only, and a past date only as of that date's close (closes below).

   Both levels are the vendor's dollars per 1% (already dollars — not scaled by spot again), dealer sign. The painter
   flips once, through dealerOf, so a positive cell is dealers long gamma:
   - open interest: call_gamma_oi + put_gamma_oi;
   - dealer flow: those two, plus call_gamma_ask + call_gamma_bid + put_gamma_ask + put_gamma_bid.
   A cell is that level, not the change from the previous bar. The last reading at or before the bar's end is carried
   through the later bars of the same New York session. It is not carried across a session, a weekend, or a holiday.
   JOIN_MS only joins two raw answers into one segment. It does not punch a hole between them. */

import { nyWall, windowAt } from '../../core/session';
import { useEffect, useSyncExternalStore } from 'react';
import { nyIsoDate, nyMinutes, nyParts, nyWallTime } from '../../core/nyTime';
import { isTradingDay } from '../../core/calendar';
import { keptOf, dealerOf } from '../../core/dealerSign';
import { uwCall } from '../whales';
import { sameName } from '../spotGexBook';
import { feedHeaders } from '../feedGate';
import { sessionOccurrence, sessionOfMinute } from '../deskSession';
import { peekEntry } from './store';
import { expiryOpen } from '../../core/tradingYear';
import type { GexSnapshot } from '../../types/market';
import { ALL, JOIN_MS, closeOf, dayStartOf, placeSeg, readAnswer, rowMeasures, spanOf, type KeptSeries } from './exposureSegs';

export { JOIN_MS, rowMeasures };

/** The two models the field draws: the open-interest book, or the dealer gamma of today's trades by side */
export type FieldMode = 'oi' | 'flow';
/** The expiries a cut reads: one date, or every expiry ('book') */
export type FieldCut = string | 'book';

/** Weekly index roots are the cash index on Unusual Whales. SPXW is SPX. One book, one log. */
const rootOf = (ticker: string): string => sameName(ticker);

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
  const t = rootOf(ticker);
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
  const t = rootOf(ticker);
  const changed = placeKept(t, series);
  if (changed) {
    scheduleSave(t);
    emit();
  }
  return changed;
}

/** The log's revision for a name — a grid built at one revision stands until it moves */
export const exposureLogRev = (ticker: string): number => logs.get(rootOf(ticker))?.rev ?? 0;

/** The log's revision for a name, as a hook (it also brings back this browser's kept copy of the day) */
export function useExposureLogRev(ticker: string): number {
  const t = rootOf(ticker);
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
  const log = logs.get(rootOf(ticker));
  return log && Number.isFinite(log.from) ? { day: log.day, from: log.from } : null;
}

const todayMemo = new Map<string, { rev: number; at: number | null }>();
/** The first moment today any reading covers, ms — null before today's first answer */
export function exposureTodayFrom(ticker: string, now: number = Date.now()): number | null {
  const t = rootOf(ticker);
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
  const log = logs.get(rootOf(ticker));
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

/** The desk session a reading belongs to, or null while the market is shut (core/session.ts): overnight is 8:00 PM to
    4:00 AM New York on the nights it trades (from Sunday 8:00 PM; not Friday night, not the evening before a holiday),
    one session through midnight keyed by its evening; an early close's after hours runs 13:00–17:00. */
const fieldSession = (ms: number): string | null => {
  const w = windowAt(ms, 'equity');
  if (!w) return null;
  return `${w.kind === 'regular' ? 'rth' : w.kind}|${nyWall(w.from).iso}`;
};

/**
 * The field's grid for a cut, on the chart's bars (`times`, seconds, oldest first; each bar spans `barSec`).
 * Both books are a level, not a change. The cell is the last reading at or before the bar's end, carried forward
 * through the later bars of the same New York session. A new session stays empty until its first reading.
 * A day bar is that session's last reading. A week bar is that week's last session's last reading.
 * A forming bar uses the newest reading so far (`now`). A reading after a bar's end does not rewrite it.
 */
export function exposureGrid(ticker: string, cut: FieldCut, timesIn: readonly number[], barSec: number, mode: FieldMode, now: number = Date.now(), price: { lo: number; hi: number } | null = null, spot: number | null = null, held: ReadonlySet<number> | null = null): ExposureGrid | null {
  if (timesIn.length > 2000) return null;
  const times = timesIn;
  const t = rootOf(ticker);
  restoreExposureLog(t);
  const log = logs.get(t);
  if (!log || !times.length || !Number.isFinite(log.from)) return null;
  const memoKey = `${t}|${cut}|${mode}|${barSec}`;
  const heldKey = held == null ? 'x' : [...held].sort((a, b) => a - b).join(',');
  const key = `${log.rev}|${times.length}|${times[0]}|${times[times.length - 1]}|${Math.floor(now / 30_000)}|${price ? Math.round(price.lo) : 'x'}|${price ? Math.round(price.hi) : 'x'}|${spot ?? 's'}|${heldKey}`;
  const hit = gridMemo.get(memoKey);
  if (hit && hit.key === key) return hit.grid;
  const weekBars = barSec >= 7 * 86_400;
  const dayBars = barSec >= 86_400;
  const n = times.length;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const sess: (string | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (dayBars) {
      const [y, m, d] = nyIsoDate(times[i] * 1000).split('-').map(Number);
      const span = Math.max(1, Math.round(barSec / 86_400));
      a[i] = nyWallTime(y, m, d, 0, 0);
      b[i] = Math.min(now, nyWallTime(y, m, d + span, 0, 0));
      sess[i] = weekBars ? null : fieldSession(nyWallTime(y, m, d, 12, 0));
    } else {
      a[i] = times[i] * 1000;
      const next = i + 1 < n ? times[i + 1] * 1000 : (times[i] + barSec) * 1000;
      b[i] = Math.min(now, next);
      sess[i] = fieldSession(a[i]);
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
  const strikesAll = [...byStrike.keys()].sort((x, y) => x - y);
  /* Visible prices, plus the one strike past each edge. The whole book on every bar is what froze the page. */
  let strikes = strikesAll;
  if (price && price.hi > price.lo) {
    let i = 0;
    while (i < strikesAll.length && strikesAll[i] < price.lo) i++;
    let j = i;
    while (j < strikesAll.length && strikesAll[j] <= price.hi) j++;
    strikes = strikesAll.slice(Math.max(0, i - 1), Math.min(strikesAll.length, j + 1));
  }
  /* More than 200 strikes in view: keep the 200 nearest the last close. Do not blank the field. */
  if (strikes.length > 200) {
    const anchor = spot != null && spot > 0 ? spot : price && price.hi > price.lo ? (price.lo + price.hi) / 2 : strikes[strikes.length >> 1];
    strikes = [...strikes].sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b).slice(0, 200).sort((a, b) => a - b);
  }
  const R = strikes.length;
  const values = new Float64Array(n * R).fill(NaN);
  const sum = new Float64Array(n);
  const any = new Uint8Array(n);
  /* The last reading at or before the bar's end, from that bar's own session. A new session stays empty.
     A strike that failed the flow gate uses the open-interest gamma, the same rule as the ledger. */
  const levelAt = (segs: number[], end: number, lo: number, session: string | null, field: number): number => {
    let loI = 0;
    let hi = segs.length / 4;
    while (loI < hi) {
      const m = (loI + hi) >> 1;
      if (segs[m * 4] <= end) loI = m + 1;
      else hi = m;
    }
    const j = loI - 1;
    if (j < 0) return NaN;
    if (weekBars || dayBars) return segs[j * 4] >= lo ? segs[j * 4 + field] : NaN;
    for (let i = j; i >= 0; i--) {
      const s = fieldSession(segs[i * 4]);
      if (s == null) continue;
      /* A reading from the next session can start before this bar's end (the 15:45 bar ends at 16:00).
         Skip it and keep this session's last reading. A previous session does not carry in. */
      if (s !== session) {
        if (segs[i * 4] < lo) return NaN;
        continue;
      }
      return segs[i * 4 + field];
    }
    return NaN;
  };
  const walk = (s: Series, field: number, into: (c: number, v: number) => void) => {
    const segs = s.segs;
    if (!segs.length) return;
    for (let c = c0; c < n; c++) {
      if (a[c] >= s.closeAt) break;
      if (!weekBars && !dayBars && !sess[c]) {
        into(c, NaN);
        continue;
      }
      into(c, levelAt(segs, b[c], a[c], sess[c], field));
    }
  };
  for (let r = 0; r < R; r++) {
    sum.fill(0);
    any.fill(0);
    const field = mode === 'oi' || (held != null && held.has(strikes[r])) ? 2 : 3;
    for (const s of byStrike.get(strikes[r])!) {
      walk(s, field, (c, v) => {
        if (Number.isNaN(v)) return;
        sum[c] += v;
        any[c] = 1;
      });
    }
    for (let c = c0; c < n; c++) if (any[c]) values[c * R + r] = sum[c];
  }
  const grid: ExposureGrid = { times: [...times], strikes, values };
  gridMemo.set(memoKey, { key, grid });
  if (gridMemo.size > 24) gridMemo.delete(gridMemo.keys().next().value!);
  return grid;
}

/** Strikes whose flow gate failed. The field draws their open-interest gamma, the same rule as the ledger.
    Null until that chain is in. The whole book keeps a strike on open interest only when every live expiry there failed. */
export function heldStrikes(ticker: string, cut: FieldCut): ReadonlySet<number> | null {
  const entry = peekEntry(rootOf(ticker));
  if (!entry || entry.status !== 'live') return null;
  const dates = cut === 'book'
    ? Object.keys(entry.byDate).filter(d => expiryOpen(d) && entry.byDate[d]?.length)
    : entry.byDate[cut]?.length ? [cut] : [];
  if (!dates.length) return null;
  const seen = new Map<number, number>();
  for (const d of dates) {
    for (const n of entry.byDate[d]) {
      const pass = n.flow && !n.flow.held ? 1 : 0;
      seen.set(n.strike, (seen.get(n.strike) ?? 0) + pass);
    }
  }
  if (!seen.size) return null;
  const held = new Set<number>();
  for (const [strike, pass] of seen) if (pass === 0) held.add(strike);
  return held;
}

/** The ledger's net GEX for this cut, dealer sign. A failed gate is already open-interest gamma on `flow.gex`. */
export function ledgerFlowNet(ticker: string, cut: FieldCut): number | null {
  const entry = peekEntry(rootOf(ticker));
  if (!entry || entry.status !== 'live') return null;
  const dates = cut === 'book'
    ? Object.keys(entry.byDate).filter(d => expiryOpen(d) && entry.byDate[d]?.length)
    : entry.byDate[cut]?.length ? [cut] : [];
  if (!dates.length) return null;
  let sum = 0;
  let any = false;
  for (const d of dates) {
    for (const n of entry.byDate[d]) {
      any = true;
      const g = n.flow?.gex;
      sum += g ? g.call + g.put : n.netGex;
    }
  }
  return any ? dealerOf(sum) : null;
}

/** The newest column of the current session is the ledger's figure at that strike, house sign.
    A column from an earlier session is left as that session's carried close. */
export function alignLatestColumn(cols: GexSnapshot[], ticker: string, cut: FieldCut, mode: FieldMode, now = Date.now()): void {
  if (!cols.length) return;
  const last = cols[cols.length - 1];
  const sess = fieldSession(last.time * 1000);
  if (!sess || sess !== fieldSession(now)) return;
  const entry = peekEntry(rootOf(ticker));
  if (!entry || entry.status !== 'live') return;
  const dates = cut === 'book'
    ? Object.keys(entry.byDate).filter(d => expiryOpen(d) && entry.byDate[d]?.length)
    : entry.byDate[cut]?.length ? [cut] : [];
  if (!dates.length) return;
  const by = new Map<number, number>();
  for (const d of dates) {
    for (const n of entry.byDate[d]) {
      const kept = mode === 'oi' ? n.netGex : n.flow ? n.flow.gex.call + n.flow.gex.put : n.netGex;
      by.set(n.strike, (by.get(n.strike) ?? 0) + kept);
    }
  }
  for (const level of last.levels) {
    const kept = by.get(level.strike);
    if (kept != null) level.value = kept;
  }
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
      /* keptOf once: the sum of keptVendorLeg(field, dealerSigned) for the call and the put. The painter's dealerOf flips it back. */
      levels.push({ strike: grid.strikes[r], value: keptOf(v), dex: 0, vex: 0, callOI: 0, putOI: 0 });
    }
    if (levels.length) out.push({ time: grid.times[c], levels });
  }
  return out;
}

/* ---- the cut's own reading, once a minute while a field shows it ---------------------------------------------- */

const POLL_MS = 60_000;
const polls = new Map<string, { n: number; id: number }>();
/** When this page last asked a cut that no poll owns yet. A chart tick must not ask again. */
const cutAskedAt = new Map<string, number>();

/** One cut off Unusual Whales, on the cash root. True when the vendor answered (an empty book is an answer). */
async function readCut(ticker: string, cut: FieldCut): Promise<boolean> {
  const t = rootOf(ticker);
  if (!t) return false;
  try {
    if (cut === 'book') {
      for (let page = 0; page < 4; page++) {
        const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/strike?limit=500&page=${page}`);
        if (res.error || !Array.isArray(res.data)) return false;
        noteExposureRows(t, res.data, true);
        if (res.data.length < 500) return true;
      }
      return true;
    }
    const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(cut)}&limit=500`);
    if (res.error || !Array.isArray(res.data)) return false;
    noteExposureRows(t, res.data);
    return true;
  } catch {
    return false;
  }
}

/** Ask this cut if nobody is polling it. At most once a minute. No rows means an empty field — strikes are not invented. */
export function ensureFieldCut(ticker: string, cut: FieldCut): void {
  const t = rootOf(ticker);
  if (!t || !cut) return;
  const key = `${t}|${cut}`;
  if (polls.has(key)) return;
  const at = cutAskedAt.get(key) ?? 0;
  if (Date.now() - at < POLL_MS) return;
  cutAskedAt.set(key, Date.now());
  pullExposureServer(t);
  void readCut(t, cut);
}

/** Read the cut's rows once a minute while a field shows them (the book itself reads a date's rows every few minutes,
    and readings further apart than JOIN_MS are not joined); the same paths the book asks, so a shared answer is reused */
export function useFieldPoll(ticker: string, cut: FieldCut | null, on = true): void {
  const t = rootOf(ticker);
  useEffect(() => {
    if (!on || !t || !cut) return;
    const key = `${t}|${cut}`;
    const cur = polls.get(key);
    if (cur) cur.n += 1;
    else {
      /* the server's recording of the day first (from the open, whenever this page opened), then this page's own reads */
      pullExposureServer(t);
      void readCut(t, cut);
      polls.set(key, {
        n: 1,
        id: window.setInterval(() => {
          pullExposureServer(t);
          void readCut(t, cut);
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
  }, [t, cut, on]);
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
  const t = rootOf(ticker);
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
  const t = rootOf(ticker);
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
/** A past session's close has been answered (rows or an empty book). Until then the key does not claim yesterday. */
const closesSettled = new Set<string>();

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

/** What the field key says about the session before this one. Null until that close has been answered. */
export function priorSessionWords(ticker: string, cut: FieldCut): string | null {
  const t = rootOf(ticker);
  const prev = priorSessions(1)[0];
  if (!t || !prev || !cut) return null;
  const want = seriesOf(cut);
  const tag = `rth|${prev}`;
  const log = logs.get(t);
  if (log) {
    for (const s of log.series.values()) {
      if (s.expiry !== want) continue;
      for (let i = 0; i < s.segs.length; i += 4) {
        if (fieldSession(s.segs[i]) === tag) return "Yesterday is that session's close, carried across its bars.";
      }
    }
  }
  if (!closesSettled.has(`${t}|${cut}|${prev}`)) return null;
  return 'Yesterday is empty.';
}

/** A past session's book is one close. Stamp it at 09:30 New York so the band runs that cash session.
    A live poll is not rewritten — a bar before the first reading of today stays empty. */
function asSessionBook(rows: unknown, day: string): unknown {
  if (!Array.isArray(rows)) return rows;
  const [y, m, d] = day.split('-').map(Number);
  const open = nyWallTime(y, m, d, 9, 30);
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const rec = row as Record<string, unknown>;
    const at = Date.parse(String(rec.time ?? ''));
    if (!Number.isFinite(at) || nyIsoDate(at) !== day || at <= open) return row;
    return { ...rec, time: new Date(open).toISOString() };
  });
}

/** Read the cut's book as of each of the last `count` sessions' closes, once each (a past date never changes): one
    expiry's rows off spot-exposures/expiry-strike, or the whole book off spot-exposures/strike. One call at a time. */
export function ensureFieldCloses(ticker: string, cut: FieldCut, count = 8): void {
  const t = rootOf(ticker);
  const days = priorSessions(count).filter(d => cut === 'book' || d <= cut);
  const todo = days.filter(d => !closesAsked.has(`${t}|${cut}|${d}`));
  if (!todo.length) return;
  for (const d of todo) closesAsked.add(`${t}|${cut}|${d}`);
  void (async () => {
    for (const d of todo) {
      let answered = false;
      try {
        if (cut === 'book') {
          for (let page = 0; page < 4; page++) {
            const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/strike?date=${d}&limit=500&page=${page}`);
            if (res.error || !Array.isArray(res.data)) break;
            answered = true;
            noteExposureRows(t, asSessionBook(res.data, d), true);
            if (res.data.length < 500) break;
          }
        } else {
          const res = await uwCall(`/stock/${encodeURIComponent(t)}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(cut)}&date=${d}&limit=500`);
          if (!res.error && Array.isArray(res.data)) {
            answered = true;
            noteExposureRows(t, asSessionBook(res.data, d));
          }
        }
      } catch {
        answered = false;
      }
      if (answered) closesSettled.add(`${t}|${cut}|${d}`);
      else closesAsked.delete(`${t}|${cut}|${d}`);
    }
    emit();
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
  const t = rootOf(ticker);
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
    logs.delete(rootOf(ticker));
    serverState.delete(rootOf(ticker));
    serverPull.delete(rootOf(ticker));
  } else {
    logs.clear();
    serverState.clear();
    serverPull.clear();
  }
  gridMemo.clear();
  todayMemo.clear();
  closesAsked.clear();
  cutAskedAt.clear();
}
