/*
  /api/oi-change/<T>: a name's complete open-interest change between its two latest reports, contract by contract, read
  from the terminal once here for every page and viewer (Pinpoint's Building and Terrain's Building tab:
  src/data/book/oiChange.ts). Set by the owner on 2026-11-01: Building values every contract's change, not only the
  largest movers' (docs/DATA_SOURCES.md).

  Recovered from the Regime tab's reader (git a2f14ce, server/regimeApi.mjs /api/regime/oi), kept contract by contract.

  What it costs the terminal, however many viewers ask (the arithmetic is shared/oiChange.mjs):
  - /option/history/open_interest?expiration=* for the latest report and the one before, ONE request per root per
    report date (SPX reads its two roots, SPX and SPXW), kept on disk — tomorrow's prior is today's latest, so a name
    costs one request a day after its first. The path is the one the exposure history reads
    (src/data/exposureHistServer.ts), so the hub shares them.
  - A report not stamped yet (before ~06:30 New York, or late) is asked again after OI_MISSING_MS; meanwhile the report
    before it is the latest. A failed read is not tried again before RETRY_MS.
  - History reads go two at a time at most (HISTORY_AT_ONCE): the terminal is shared with research jobs.

  Every read rides the hub's record lane (server/thetaProxy.mjs thetaDirect), so the hub never keeps these paths warm
  on its own. On Vercel each instance keeps its own copy in memory (no disk); with no terminal there it answers
  terminal_down, and the page falls back to the shorter movers' list.
*/

import fs from 'node:fs';
import path from 'node:path';
import { takeWire, writeWire } from '../shared/jsonWire.mjs';
import { gate, sendDenied } from './auth.mjs';
import { mergeReports, oiChangeRows, oiReportDay, oiRootsOf, priorSession, readOiReport } from '../shared/oiChange.mjs';

export const OI_CHANGE_VERSION = 1;
/** History reads in flight at once, across this module */
export const HISTORY_AT_ONCE = 2;
/** A failed read is not tried again before this */
export const RETRY_MS = 60_000;
/** A report not on file yet (before ~06:30, or a late stamp) is asked again after this */
export const OI_MISSING_MS = 10 * 60_000;
/** How long one ask waits for the reads it started before answering `pending` */
export const ANSWER_WAIT_MS = 20_000;
/** Reports held in memory, across every root */
const MEMORY_REPORTS = 48;
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

const ymd = (iso) => iso.replace(/-/g, '');
/** A terminal answer's failure code, for the page's words (never the vendor's) */
const codeOf = (status, body) => {
  const m = /"code":"([a-z_]+)"/.exec(String(body).slice(0, 300));
  return m ? m[1] : status >= 500 ? 'terminal_down' : `status_${status}`;
};

/**
 * @param {object} o
 * @param {(path: string, opt?: { lane?: 'record' }) => Promise<{ status: number, body: string }>} o.theta
 * @param {string | null} [o.dir]   where the reports are kept (null: memory only)
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 */
export function createOiChange(o) {
  const now = o.now ?? (() => Date.now());
  const dir = o.dir ?? null;
  const log = o.log ?? (() => {});
  const stats = { reads: 0, failed: 0, fromDisk: 0 };

  /* ---- two history reads at once ---- */
  let running = 0;
  let peak = 0;
  const waiting = [];
  async function history(p) {
    /* a woken reader inherits the slot of the one that finished */
    if (running >= HISTORY_AT_ONCE) await new Promise((r) => waiting.push(r));
    else running += 1;
    peak = Math.max(peak, running);
    try {
      stats.reads += 1;
      return await o.theta(p, { lane: 'record' });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  }

  const fileOf = (root, day) => path.join(dir, `${root}-${day}.json`);
  const readKept = (root, day) => {
    if (!dir) return null;
    try {
      const kept = JSON.parse(fs.readFileSync(fileOf(root, day), 'utf8'));
      return kept && kept.v === OI_CHANGE_VERSION && kept.report ? kept.report : null;
    } catch {
      return null;
    }
  };
  const keep = (root, day, report) => {
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${fileOf(root, day)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: OI_CHANGE_VERSION, root, day, report }));
      fs.renameSync(tmp, fileOf(root, day));
    } catch {
      /* a read-only disk: kept in memory only */
    }
  };

  /* ---- one root's report for one date ---- */
  /** `${root}|${day}` → { report } | { missing: at } | { failed: at, code } */
  const reports = new Map();
  const jobs = new Map();
  const answers = new Map();
  function reportOf(root, day) {
    const key = `${root}|${day}`;
    let r = reports.get(key);
    if (!r) {
      const kept = readKept(root, day);
      if (kept) {
        stats.fromDisk += 1;
        reports.set(key, (r = { report: kept }));
      }
    }
    const t = now();
    if (r?.report) return r;
    if (r?.missing && t - r.missing < OI_MISSING_MS) return r;
    if (r?.failed && t - r.failed < RETRY_MS) return r;
    if (!jobs.has(key)) {
      jobs.set(key, (async () => {
        try {
          const got = await history(`/option/history/open_interest?symbol=${encodeURIComponent(root)}&expiration=*&date=${ymd(day)}&format=json`);
          const report = got.status === 200 ? readOiReport(JSON.parse(got.body)) : null;
          if (report && Object.keys(report).length) {
            reports.set(key, { report });
            keep(root, day, report);
            log(`${root} ${day}: ${Object.keys(report).length} contracts`);
            /* the newest reports stay in memory; the rest are on disk */
            if (reports.size > MEMORY_REPORTS) {
              const old = [...reports.keys()].sort((a, b) => (a.split('|')[1] < b.split('|')[1] ? -1 : 1));
              for (const k of old.slice(0, reports.size - MEMORY_REPORTS)) reports.delete(k);
            }
          } else if (got.status === 200 || got.status === 472) reports.set(key, { missing: now() });
          else {
            stats.failed += 1;
            reports.set(key, { failed: now(), code: codeOf(got.status, got.body) });
          }
        } catch (e) {
          stats.failed += 1;
          log(`${root} ${day}: read failed: ${e && e.message ? e.message : e}`);
          reports.set(key, { failed: now(), code: 'terminal_down' });
        } finally {
          jobs.delete(key);
        }
      })());
    }
    return r ?? { pending: true };
  }

  /** A name's report for one date: every root's, added — or what it waits on */
  function dayOf(roots, day) {
    const parts = roots.map((root) => reportOf(root, day));
    const failed = parts.find((p) => p.failed);
    if (failed) return { failed: failed.failed, code: failed.code };
    if (parts.some((p) => p.pending)) return { pending: true };
    const have = parts.filter((p) => p.report);
    if (!have.length) return { missing: true };
    return { report: mergeReports(have.map((p) => p.report)) };
  }
  const inFlight = (roots, days) => roots.flatMap((root) => days.map((d) => jobs.get(`${root}|${d}`))).filter(Boolean);

  /**
   * The change for one name: { day, prior, close, priorClose, rows, contracts } — or `pending` / `error`.
   * `day` is the later report's date, `prior` the earlier's; `close` and `priorClose` the sessions they count.
   */
  async function change(ticker, opt = {}) {
    const t = String(ticker).toUpperCase();
    const roots = oiRootsOf(t);
    const wait = opt.waitMs ?? 0;
    const started = now();
    for (;;) {
      let day = oiReportDay(now());
      let latest = dayOf(roots, day);
      /* not stamped yet this morning (or a late stamp): the report before it is the latest on file */
      if (latest.missing) {
        day = priorSession(day);
        latest = dayOf(roots, day);
      }
      const prior = priorSession(day);
      const before = dayOf(roots, prior);
      const head = { v: OI_CHANGE_VERSION, at: now(), ticker: t, roots, day, prior, close: priorSession(day), priorClose: priorSession(prior) };
      if (latest.report && before.report) {
        const contracts = Object.keys(latest.report).length;
        const stamp = `${day}|${prior}|${contracts}|${Object.keys(before.report).length}`;
        const hit = answers.get(t);
        if (hit && hit.stamp === stamp) return hit.body;
        const body = { ...head, source: 'terminal', contracts, rows: oiChangeRows(latest.report, before.report, day) };
        answers.set(t, { stamp, body });
        if (answers.size > 80) answers.delete(answers.keys().next().value);
        return body;
      }
      const failed = latest.failed ? latest : before.failed ? before : null;
      if (failed) return { ...head, error: failed.code ?? 'terminal_down' };
      if (latest.missing || before.missing) return { ...head, error: 'no_report' };
      const pending = inFlight(roots, [day, prior]);
      const left = wait - (now() - started);
      if (!pending.length || left <= 0) return { ...head, pending: true };
      await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, left))]);
    }
  }

  return {
    change,
    stats: () => ({ ...stats, peakHistory: peak, running, waiting: waiting.length }),
    /** Every read in flight has landed (the proof's) */
    settle: async () => {
      for (let i = 0; i < 20 && jobs.size; i++) await Promise.all([...jobs.values()]);
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
/** The one reader for this process: the in-process hub's terminal reads, kept under <root>/.cache/oi-change */
async function reader(root) {
  if (shared) return shared;
  const { thetaDirect } = await import('./thetaProxy.mjs');
  shared = createOiChange({
    theta: thetaDirect,
    dir: process.env.VERCEL ? null : path.join(root, '.cache', 'oi-change'),
    log: (line) => console.log(`[oi-change] ${line}`),
  });
  return shared;
}

/** GET /api/oi-change/<T> (mounted at /api/oi-change, or the whole URL on Vercel) */
export async function proxyOiChange(req, res, root = process.cwd()) {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://x');
  const ticker = decodeURIComponent(url.pathname.replace(/^\/api\/oi-change/, '').replace(/^\/+|\/+$/g, '')).toUpperCase();
  if (!TICKER.test(ticker)) {
    send(res, 400, { error: 'a ticker: /api/oi-change/SPY' });
    return;
  }
  const verdict = await gate(req, 'theta');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  try {
    const r = await reader(root);
    const body = await r.change(ticker, { waitMs: ANSWER_WAIT_MS });
    const stamp = `${body.day}|${body.prior}|${body.contracts ?? 0}|${body.rows?.length ?? 0}|${body.error ?? ''}|${body.pending ?? ''}`;
    writeWire(req, res, 200, takeWire(`oi|${ticker}`, stamp, () => body));
  } catch (e) {
    send(res, 500, { error: 'The open-interest read failed.', code: 'oi_change_failed' });
    console.warn(`[oi-change] ${e && e.message ? e.message : e}`);
  }
}

/** For the load check: the reader's terminal reads so far */
export const oiChangeStats = () => (shared ? shared.stats() : null);
