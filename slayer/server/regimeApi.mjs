/*
  /api/regime: Terrain's two market reads that every pane and page shares, read here once for every viewer.

  GET /api/regime/vol           the VIX term structure (VIX1D, VIX9D, VIX, VIX3M, VIX6M) with VVIX and SKEW: the live
                                prints, contango or backwardation, the two ratios (VIX/VIX3M, VIX9D/VIX) with their path
                                through the day, and each value's place in its past year of daily closes.
  GET /api/regime/oi?ticker=SPY&expiry=book|YYYY-MM-DD
                                the day-over-day open-interest change per strike for one name and expiry scope.

  What it costs the terminal, however many viewers ask (the arithmetic is shared/volRegime.mjs):
  - the prints: ONE /index/snapshot/price request for all seven indices, re-read at most every SNAP_LIVE_MS while the
    index feed moves (shared/marketSession.mjs feedMoving: Cboe's hours, the VIX from about 03:15) and every
    SNAP_IDLE_MS otherwise;
  - the day's path: /index/history/ohlc at 1m for VIX, VIX3M and VIX9D, once in full, then only the minutes since the
    last bar, at most every PATH_MS each; a finished session is read once and never again;
  - the year: /index/history/eod for each of the seven, ONE request per symbol per day (the year ends the session
    before the regime day), kept on disk so a restart does not read it again;
  - open interest: /option/history/open_interest?expiration=* for the latest report and the one before, ONE request per
    name per report date, kept on disk — tomorrow's prior is today's latest, so a name costs one request a day after its
    first. The path is the one the exposure history reads (src/data/exposureHistServer.ts), so the hub shares them.
  - History reads go two at a time at most (HISTORY_AT_ONCE): the terminal is shared with research jobs.

  Every read rides the hub's record lane (server/thetaProxy.mjs thetaDirect): this module keeps its own copy, so the hub
  never keeps these paths warm on a viewer's schedule. On Vercel each instance keeps its own copy in memory (no disk).
*/

import fs from 'node:fs';
import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { feedMoving, nyInstant, regularCloseMin, sessionAt } from '../shared/marketSession.mjs';
import {
  RATIOS,
  REGIME_SYMBOLS,
  oiChange,
  oiReportDay,
  oiRootOf,
  priorSession,
  ratioSeries,
  readDailyCloses,
  readMinuteCloses,
  readOiReport,
  readSnapshot,
  regimeOf,
  wallOf,
  yearEnd,
  yearRead,
  yearStart,
} from '../shared/volRegime.mjs';

export const REGIME_VERSION = 1;
/** The prints' freshness while the index feed moves, and while it does not */
export const SNAP_LIVE_MS = 10_000;
export const SNAP_IDLE_MS = 5 * 60_000;
/** A live day's path is topped up at most this often */
export const PATH_MS = 60_000;
/** …and before the cash open, when only the VIX prints */
export const PATH_PRE_MS = 5 * 60_000;
/** History reads in flight at once, across this module */
export const HISTORY_AT_ONCE = 2;
/** A failed read is not tried again before this */
const RETRY_MS = 60_000;
/** A report not on file yet (before ~06:30) is asked again after this */
const OI_MISSING_MS = 10 * 60_000;
/** The symbols the day's path reads */
const PATH_SYMBOLS = [...new Set(RATIOS.flatMap(r => [r.num, r.den]))];
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const ymd = (iso) => iso.replace(/-/g, '');
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
/** A terminal answer's failure code, for the page's words (never the vendor's) */
const codeOf = (status, body) => {
  const m = /"code":"([a-z_]+)"/.exec(String(body).slice(0, 300));
  return m ? m[1] : status === 472 ? 'no_data' : status >= 500 ? 'terminal_down' : `status_${status}`;
};

/**
 * @param {object} o
 * @param {(path: string, opt?: { lane?: 'record' }) => Promise<{ status: number, body: string }>} o.theta
 * @param {string | null} [o.dir]   where the year and the reports are kept (null: memory only)
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 */
export function createRegime(o) {
  const now = o.now ?? (() => Date.now());
  const dir = o.dir ?? null;
  const log = o.log ?? (() => {});
  const stats = { snapshot: 0, path: 0, year: 0, oi: 0, failed: 0 };

  /* ---- two history reads at once ---- */
  let running = 0;
  /** The most history reads ever in flight together (the proof checks it) */
  let peak = 0;
  const waiting = [];
  async function history(p, kind) {
    /* a woken reader inherits the slot of the one that finished */
    if (running >= HISTORY_AT_ONCE) await new Promise((r) => waiting.push(r));
    else running += 1;
    peak = Math.max(peak, running);
    try {
      stats[kind] += 1;
      return await o.theta(p, { lane: 'record' });
    } catch (e) {
      log(`${kind} read failed: ${e && e.message ? e.message : e}`);
      throw e;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  }

  const readJson = (file) => {
    if (!dir) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      return null;
    }
  };
  const writeJson = (file, v) => {
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), JSON.stringify(v));
    } catch {
      /* a read-only disk: kept in memory only */
    }
  };

  /* ---- the prints ---- */
  let snap = { at: 0, quotes: null, error: null };
  let snapJob = null;
  function prints() {
    const t = now();
    const fresh = feedMoving(t, 'VIX') ? SNAP_LIVE_MS : SNAP_IDLE_MS;
    if (snap.quotes && t - snap.at < fresh) return Promise.resolve(snap);
    if (!snap.quotes && snap.error && t - snap.at < 5_000) return Promise.resolve(snap);
    snapJob ??= (async () => {
      try {
        stats.snapshot += 1;
        const got = await o.theta(`/index/snapshot/price?symbol=${REGIME_SYMBOLS.join(',')}&format=json`, { lane: 'record' });
        if (got.status === 200) {
          const quotes = readSnapshot(JSON.parse(got.body));
          snap = { at: now(), quotes, error: Object.keys(quotes).length ? null : 'no_data' };
        } else {
          stats.failed += 1;
          snap = { at: now(), quotes: snap.quotes, error: codeOf(got.status, got.body) };
        }
      } catch {
        stats.failed += 1;
        snap = { at: now(), quotes: snap.quotes, error: 'terminal_down' };
      } finally {
        snapJob = null;
      }
      return snap;
    })();
    return snapJob;
  }

  /* ---- the day's path: per symbol, the minutes of one day ---- */
  /** sym → { day, bars: [min, close][], readAt, done, failAt, job } */
  const paths = new Map();
  /** The session for `day` has finished printing, with a margin for the last bar */
  const dayOver = (day, t) => t > nyInstant(day, regularCloseMin(day) + 15) + 120_000;
  function topUp(sym, day) {
    let s = paths.get(sym);
    if (!s || s.day !== day) {
      s = { day, bars: [], readAt: 0, done: false, failAt: 0, job: null };
      paths.set(sym, s);
    }
    const t = now();
    /* before the cash open only the VIX itself prints (from about 03:15), so a ratio has little to add: a slower pace */
    const pace = nyInstant(day, 9 * 60 + 31) > t ? PATH_PRE_MS : PATH_MS;
    if (s.done || s.job || t - s.readAt < pace || t - s.failAt < RETRY_MS) return;
    const from = s.bars.length ? s.bars[s.bars.length - 1][0] : 3 * 60;
    const over = dayOver(day, t);
    s.job = (async () => {
      try {
        const got = await history(`/index/history/ohlc?symbol=${sym}&start_date=${ymd(day)}&end_date=${ymd(day)}&interval=1m&start_time=${hhmm(from)}&end_time=16:15:00&format=json`, 'path');
        if (got.status === 200 || got.status === 472) {
          const bars = got.status === 200 ? readMinuteCloses(JSON.parse(got.body)) : [];
          const kept = s.bars.filter(([m]) => m < from);
          s.bars = [...kept, ...bars];
          s.readAt = now();
          /* a session read after it ended is whole */
          if (over) s.done = true;
        } else {
          stats.failed += 1;
          s.failAt = now();
        }
      } catch {
        stats.failed += 1;
        s.failAt = now();
      } finally {
        s.job = null;
      }
    })();
  }

  /* ---- the year: per year-end, per symbol ---- */
  /** end → { sym → [day, close][] } */
  const years = new Map();
  const yearFail = new Map();
  const yearJobs = new Map();
  function yearOf(end) {
    let y = years.get(end);
    if (!y) {
      y = readJson(`eod-${end}.json`) ?? {};
      years.set(end, y);
      /* only today's year is kept in memory */
      for (const k of years.keys()) if (k !== end) years.delete(k);
    }
    for (const sym of REGIME_SYMBOLS) {
      const key = `${end}|${sym}`;
      if (y[sym] || yearJobs.has(key) || now() - (yearFail.get(key) ?? 0) < RETRY_MS) continue;
      yearJobs.set(key, (async () => {
        try {
          const got = await history(`/index/history/eod?symbol=${sym}&start_date=${ymd(yearStart(end))}&end_date=${ymd(end)}&format=json`, 'year');
          if (got.status === 200 || got.status === 472) {
            y[sym] = got.status === 200 ? readDailyCloses(JSON.parse(got.body)) : [];
            writeJson(`eod-${end}.json`, y);
          } else {
            stats.failed += 1;
            yearFail.set(key, now());
          }
        } catch {
          stats.failed += 1;
          yearFail.set(key, now());
        } finally {
          yearJobs.delete(key);
        }
      })());
    }
    return y;
  }

  /** The vol regime as it stands; starts whatever reads it lacks (the next ask carries them) */
  async function vol() {
    const s = await prints();
    const t = now();
    const q = s.quotes;
    if (!q || !q.VIX) return { v: REGIME_VERSION, at: t, error: s.error ?? 'no_data' };
    /* THE REGIME DAY is the day of the VIX's latest print: today once the VIX prints (about 03:15 on a session day),
       else the last session's — never a bare clock range */
    const day = wallOf(q.VIX.at).day;
    const end = yearEnd(day);
    const y = yearOf(end);
    for (const sym of PATH_SYMBOLS) topUp(sym, day);
    const vixMs = nyInstant(day, wallOf(q.VIX.at).min);
    const live = feedMoving(t, 'VIX') && t - vixMs < 5 * 60_000;
    const quotes = REGIME_SYMBOLS.map((sym) => {
      const p = q[sym];
      if (!p) return { sym, price: null, at: null, prev: null, prevDay: null, pct: null, n: 0, lo: null, hi: null };
      return { sym, price: p.price, at: p.at, ...yearRead(y[sym] ?? [], p.price) };
    });
    const ratios = RATIOS.map(({ key, num, den }) => {
      const a = q[num];
      const b = q[den];
      /* a ratio of two prints from the same day only */
      const value = a && b && a.at.slice(0, 10) === b.at.slice(0, 10) ? a.price / b.price : null;
      const daily = y[num] && y[den] ? ratioSeries(y[num], y[den]) : [];
      const read = value == null ? null : yearRead(daily, value);
      const pa = paths.get(num);
      const pb = paths.get(den);
      const path = pa && pb && pa.day === day && pb.day === day ? ratioSeries(pa.bars, pb.bars).map(([m, r]) => [m, r4(r)]) : [];
      return { key, num, den, value: value == null ? null : r4(value), pct: read?.pct ?? null, n: read?.n ?? 0, prev: read?.prev == null ? null : r4(read.prev), lo: read?.lo == null ? null : r4(read.lo), hi: read?.hi == null ? null : r4(read.hi), path };
    });
    const main = ratios[0].value;
    return {
      v: REGIME_VERSION,
      at: t,
      day,
      yearEnd: end,
      asOf: q.VIX.at,
      live,
      phase: sessionAt(t, 'indexOption').phase,
      regime: main == null ? null : regimeOf(main),
      quotes,
      ratios,
      pending: {
        year: REGIME_SYMBOLS.some((sym) => !y[sym]),
        path: PATH_SYMBOLS.some((sym) => { const p = paths.get(sym); return !p || p.day !== day || (!p.readAt && !p.done); }),
      },
      error: s.error,
    };
  }

  /* ---- open interest: per name, per report date ---- */
  /** `${root}|${day}` → { report } | { missing: at } | { failed: at } */
  const reports = new Map();
  const reportJobs = new Map();
  function reportOf(root, day) {
    const key = `${root}|${day}`;
    let r = reports.get(key);
    if (!r) {
      const kept = readJson(`oi-${root}-${day}.json`);
      if (kept && kept.report) reports.set(key, (r = { report: kept.report }));
    }
    const t = now();
    if (r?.report) return r;
    if (r?.missing && t - r.missing < OI_MISSING_MS) return r;
    if (r?.failed && t - r.failed < RETRY_MS) return r;
    if (!reportJobs.has(key)) {
      reportJobs.set(key, (async () => {
        try {
          const got = await history(`/option/history/open_interest?symbol=${encodeURIComponent(root)}&expiration=*&date=${ymd(day)}&format=json`, 'oi');
          const report = got.status === 200 ? readOiReport(JSON.parse(got.body)) : null;
          if (report && Object.keys(report).length) {
            reports.set(key, { report });
            writeJson(`oi-${root}-${day}.json`, { root, day, report });
            /* a name keeps at most its last three reports in memory */
            const mine = [...reports.keys()].filter((k) => k.startsWith(`${root}|`)).sort();
            for (const k of mine.slice(0, -3)) reports.delete(k);
          } else if (got.status === 200 || got.status === 472) reports.set(key, { missing: now() });
          else {
            stats.failed += 1;
            reports.set(key, { failed: now(), code: codeOf(got.status, got.body) });
          }
        } catch {
          stats.failed += 1;
          reports.set(key, { failed: now(), code: 'terminal_down' });
        } finally {
          reportJobs.delete(key);
        }
      })());
    }
    return r ?? { pending: true };
  }

  /** The change for one name and scope, or what it waits on */
  async function oi(ticker, expiry, opt = {}) {
    const root = oiRootOf(ticker);
    const t = now();
    let day = oiReportDay(t);
    let latest = reportOf(root, day);
    /* not stamped yet this morning (or a late stamp): the report before it is the latest on file */
    if (latest.missing) {
      day = priorSession(day);
      latest = reportOf(root, day);
    }
    const prior = priorSession(day);
    const before = reportOf(root, prior);
    if (opt.wait) {
      await Promise.all([reportJobs.get(`${root}|${day}`), reportJobs.get(`${root}|${prior}`)]);
      return oi(ticker, expiry);
    }
    const head = { v: REGIME_VERSION, at: t, ticker, root, expiry, day, prior, close: priorSession(day), priorClose: priorSession(prior) };
    if (latest.report && before.report) return { ...head, ...oiChange(latest.report, before.report, { expiry, from: day }) };
    const failed = latest.failed ? latest : before.failed ? before : null;
    if (failed) return { ...head, error: failed.code ?? 'terminal_down' };
    if (latest.missing || before.missing) return { ...head, error: 'no_report' };
    return { ...head, pending: true };
  }

  return {
    vol,
    oi,
    stats: () => ({ ...stats, peakHistory: peak, running, waiting: waiting.length }),
    /** Every read in flight has landed (the proof's) */
    settle: async () => {
      for (let i = 0; i < 20; i++) {
        const jobs = [snapJob, ...[...paths.values()].map((s) => s.job), ...yearJobs.values(), ...reportJobs.values()].filter(Boolean);
        if (!jobs.length) return;
        await Promise.all(jobs);
      }
    },
  };
}

/* ---- the route ---- */

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

let shared = null;
/** The one reader for this process: the in-process hub's terminal reads, kept under <root>/.cache/regime */
async function reader(root) {
  if (shared) return shared;
  const { thetaDirect } = await import('./thetaProxy.mjs');
  shared = createRegime({
    theta: thetaDirect,
    dir: process.env.VERCEL ? null : path.join(root, '.cache', 'regime'),
    log: (line) => console.log(`[regime] ${line}`),
  });
  return shared;
}

/** GET /api/regime/vol and /api/regime/oi?ticker=&expiry= (mounted at /api/regime, or the whole URL on Vercel) */
export async function proxyRegime(req, res, root = process.cwd()) {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://x');
  const route = url.pathname.replace(/^\/api\/regime/, '').replace(/\/+$/, '');
  if (route !== '/vol' && route !== '/oi') {
    send(res, 404, { error: 'not found' });
    return;
  }
  const verdict = await gate(req, 'theta');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  const r = await reader(root);
  try {
    if (route === '/vol') {
      send(res, 200, await r.vol());
      return;
    }
    const ticker = String(url.searchParams.get('ticker') ?? '').toUpperCase();
    const expiry = String(url.searchParams.get('expiry') ?? 'book');
    if (!TICKER.test(ticker) || (expiry !== 'book' && !ISO.test(expiry))) {
      send(res, 400, { error: 'a ticker and an expiry: /api/regime/oi?ticker=SPY&expiry=book' });
      return;
    }
    send(res, 200, await r.oi(ticker, expiry));
  } catch (e) {
    send(res, 500, { error: 'The regime read failed.', code: 'regime_failed' });
    console.warn(`[regime] ${e && e.message ? e.message : e}`);
  }
}

/** For the load check: the reader's terminal reads so far */
export const regimeStats = () => (shared ? shared.stats() : null);
