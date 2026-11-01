/*
  /api/terrain: Terrain's option-chain reads, done here once for every pane, page and viewer.

  GET /api/terrain/chain?symbol=SPX   the live all-expiry greeks snapshot with the day's open interest folded in, one
                                      slim row a strike (shared/optionChain.mjs CHAIN_COLS): the Surface tab's Skew and
                                      Drift views both draw from it
  GET /api/terrain/prior?symbol=SPX   the session before the snapshot's: its end-of-day closing quotes per strike
                                      (CLOSE_COLS), the surface the Skew view compares against

  What it costs the terminal, however many viewers ask:
  - the chain: ONE /option/snapshot/greeks/all request per name (expiration=*, max_dte, strike_range), re-read at most
    every CHAIN_LIVE_MS while the name's options trade (shared/marketSession.mjs feedMoving) and every CHAIN_IDLE_MS
    otherwise;
  - the open interest: ONE /option/snapshot/open_interest request per name, at most every OI_MS (it is reported once a
    day, about 06:30 New York);
  - the prior session's surface: ONE /option/history/greeks/eod request per name per session, kept on disk;
  - history reads go two at a time at most across this module (HISTORY_AT_ONCE): the terminal is shared.

  Every read rides the hub's record lane (server/thetaProxy.mjs thetaDirect): this module keeps its own copy, so the hub
  never keeps these paths warm on a viewer's schedule. On Vercel each instance keeps its own copy in memory (no disk).
*/

import fs from 'node:fs';
import path from 'node:path';
import { gate, sendDenied } from './auth.mjs';
import { addDays, feedMoving, sessionDayAtOrBefore } from '../shared/marketSession.mjs';
import { chainRoot, okSymbol, readChain, readCloses, readOpenInterest } from '../shared/optionChain.mjs';

export const TERRAIN_VERSION = 1;
/** The chain's freshness while the name's options trade, and while they do not */
export const CHAIN_LIVE_MS = 20_000;
export const CHAIN_IDLE_MS = 10 * 60_000;
/** The open interest is re-read at most this often */
export const OI_MS = 30 * 60_000;
/** History reads in flight at once, across this module */
export const HISTORY_AT_ONCE = 2;
/** The chain's reach: expiries within this many days, this many strikes each side of the money */
export const MAX_DTE = 200;
export const STRIKE_RANGE = 100;
/** Names kept in memory at once */
const MAX_NAMES = 24;
/** A failed read is not tried again before this */
const RETRY_MS = 60_000;

const ymd = (iso) => iso.replace(/-/g, '');
/** A terminal answer's failure code, for the page's words (never the vendor's) */
const codeOf = (status, body) => {
  const m = /"code":"([a-z_]+)"/.exec(String(body).slice(0, 300));
  return m ? m[1] : status === 472 ? 'no_data' : status >= 500 ? 'terminal_down' : `status_${status}`;
};

/** The paths, as written (the proof and scripts/theta-paths-proof.ts read the same) */
export const chainPath = (root) => `/option/snapshot/greeks/all?symbol=${root}&expiration=*&max_dte=${MAX_DTE}&strike_range=${STRIKE_RANGE}&format=csv`;
export const oiPath = (root) => `/option/snapshot/open_interest?symbol=${root}&expiration=*&max_dte=${MAX_DTE}&strike_range=${STRIKE_RANGE}&format=csv`;
export const closesPath = (root, day) => `/option/history/greeks/eod?symbol=${root}&expiration=*&start_date=${ymd(day)}&end_date=${ymd(day)}&max_dte=${MAX_DTE}&strike_range=${STRIKE_RANGE}&format=csv`;

/**
 * @param {object} o
 * @param {(path: string, opt?: { lane?: 'record' }) => Promise<{ status: number, body: string }>} o.theta
 * @param {string | null} [o.dir]   where the prior sessions' surfaces are kept (null: memory only)
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 */
export function createTerrain(o) {
  const now = o.now ?? (() => Date.now());
  const dir = o.dir ?? null;
  const log = o.log ?? (() => {});
  const stats = { chain: 0, oi: 0, closes: 0, failed: 0 };

  /* ---- two history reads at once ---- */
  let running = 0;
  let peak = 0;
  const waiting = [];
  async function history(p, kind) {
    if (running >= HISTORY_AT_ONCE) await new Promise((r) => waiting.push(r));
    else running += 1;
    peak = Math.max(peak, running);
    try {
      stats[kind] += 1;
      return await o.theta(p, { lane: 'record' });
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

  /** root → { chain: { at, data, error, job }, oi: { at, day, map, error, job }, closes: Map day → { data, failAt, job } } */
  const names = new Map();
  function slot(root) {
    let s = names.get(root);
    if (s) {
      names.delete(root);
      names.set(root, s);
      return s;
    }
    s = { chain: { at: 0, data: null, error: null, job: null }, oi: { at: 0, day: null, map: null, error: null, job: null }, closes: new Map() };
    names.set(root, s);
    while (names.size > MAX_NAMES) names.delete(names.keys().next().value);
    return s;
  }

  /* ---- the open interest: one read per name per OI_MS ---- */
  function openInterest(root) {
    const s = slot(root).oi;
    const t = now();
    if (s.map && t - s.at < OI_MS) return Promise.resolve(s);
    if (!s.map && s.error && t - s.at < RETRY_MS) return Promise.resolve(s);
    s.job ??= (async () => {
      try {
        stats.oi += 1;
        const got = await o.theta(oiPath(root), { lane: 'record' });
        if (got.status === 200) {
          const read = readOpenInterest(got.body);
          Object.assign(s, { at: now(), day: read.day, map: read.oi, error: null });
        } else {
          stats.failed += 1;
          Object.assign(s, { at: now(), error: codeOf(got.status, got.body) });
        }
      } catch {
        stats.failed += 1;
        Object.assign(s, { at: now(), error: 'terminal_down' });
      } finally {
        s.job = null;
      }
      return s;
    })();
    return s.job;
  }

  /* ---- the chain: one read per name per freshness window ---- */
  function chainOf(root) {
    const s = slot(root).chain;
    const t = now();
    const fresh = feedMoving(t, root) ? CHAIN_LIVE_MS : CHAIN_IDLE_MS;
    if (s.data && t - s.at < fresh) return Promise.resolve(s);
    if (!s.data && s.error && t - s.at < 5_000) return Promise.resolve(s);
    s.job ??= (async () => {
      try {
        const oi = await openInterest(root);
        stats.chain += 1;
        const got = await o.theta(chainPath(root), { lane: 'record' });
        if (got.status === 200) {
          const read = readChain(got.body, oi.map);
          s.data = { ...read, oiDay: oi.map ? oi.day : null };
          s.error = read.expiries.length ? null : 'no_data';
          s.at = now();
        } else {
          stats.failed += 1;
          s.error = codeOf(got.status, got.body);
          s.at = now();
        }
      } catch {
        stats.failed += 1;
        s.error = 'terminal_down';
        s.at = now();
      } finally {
        s.job = null;
      }
      return s;
    })();
    return s.job;
  }

  /** The live chain for a page's name, as the pages read it */
  async function chain(symbol) {
    const root = chainRoot(symbol);
    const s = await chainOf(root);
    const t = now();
    if (!s.data) return { v: TERRAIN_VERSION, at: t, symbol, root, error: s.error ?? 'no_data' };
    const day = (s.data.spotAt ?? s.data.asOf ?? '').slice(0, 10) || null;
    return { v: TERRAIN_VERSION, at: t, readAt: s.at, symbol, root, day, live: feedMoving(t, root) && t - s.at < 2 * CHAIN_LIVE_MS, ...s.data, error: s.error };
  }

  /** The session before the chain's own (its closing surface); starts the read it lacks — the next ask carries it */
  async function prior(symbol) {
    const root = chainRoot(symbol);
    const c = await chainOf(root);
    const t = now();
    const ref = (c.data?.spotAt ?? c.data?.asOf ?? '').slice(0, 10);
    if (!ref) return { v: TERRAIN_VERSION, at: t, symbol, root, error: c.error ?? 'no_data' };
    const day = sessionDayAtOrBefore(addDays(ref, -1));
    const s = slot(root);
    let e = s.closes.get(day);
    if (!e) {
      e = { data: readJson(`closes-${root}-${day}.json`), failAt: 0, error: null, job: null };
      s.closes.set(day, e);
      for (const k of s.closes.keys()) if (k !== day) s.closes.delete(k);
    }
    if (!e.data && !e.job && t - e.failAt >= RETRY_MS) {
      e.job = (async () => {
        try {
          const got = await history(closesPath(root, day), 'closes');
          if (got.status === 200 || got.status === 472) {
            const read = got.status === 200 ? readCloses(got.body) : { day, spot: null, expiries: [] };
            e.data = { ...read, day };
            e.error = read.expiries.length ? null : 'no_data';
            writeJson(`closes-${root}-${day}.json`, e.data);
          } else {
            stats.failed += 1;
            e.failAt = now();
            e.error = codeOf(got.status, got.body);
          }
        } catch (err) {
          stats.failed += 1;
          e.failAt = now();
          e.error = 'terminal_down';
          log(`closes read failed: ${err && err.message ? err.message : err}`);
        } finally {
          e.job = null;
        }
      })();
    }
    if (!e.data) return { v: TERRAIN_VERSION, at: t, symbol, root, day, pending: !!e.job, error: e.job ? null : e.error };
    return { v: TERRAIN_VERSION, at: t, symbol, root, ...e.data, day, pending: false, error: e.data.expiries.length ? null : 'no_data' };
  }

  return {
    chain,
    prior,
    stats: () => ({ ...stats, peakHistory: peak, running, waiting: waiting.length, names: names.size }),
    /** Every read in flight has landed (the proof's) */
    settle: async () => {
      for (let i = 0; i < 20; i++) {
        const jobs = [];
        for (const s of names.values()) {
          jobs.push(s.chain.job, s.oi.job);
          for (const e of s.closes.values()) jobs.push(e.job);
        }
        const live = jobs.filter(Boolean);
        if (!live.length) return;
        await Promise.all(live);
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
/** The one reader for this process: the in-process hub's terminal reads, the surfaces kept under <root>/.cache/terrain */
async function reader(root) {
  if (shared) return shared;
  const { thetaDirect } = await import('./thetaProxy.mjs');
  shared = createTerrain({
    theta: thetaDirect,
    dir: process.env.VERCEL ? null : path.join(root, '.cache', 'terrain'),
    log: (line) => console.log(`[terrain] ${line}`),
  });
  return shared;
}

/** GET /api/terrain/chain|prior?symbol= (mounted at /api/terrain, or the whole URL on Vercel) */
export async function proxyTerrain(req, res, root = process.cwd()) {
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://x');
  const route = url.pathname.replace(/^\/api\/terrain/, '').replace(/\/+$/, '');
  const symbol = String(url.searchParams.get('symbol') ?? '').toUpperCase();
  if (!['/chain', '/prior'].includes(route) || !okSymbol(symbol)) {
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
    send(res, 200, route === '/chain' ? await r.chain(symbol) : await r.prior(symbol));
  } catch (e) {
    send(res, 500, { error: 'The chain read failed.', code: 'terrain_failed' });
    console.warn(`[terrain] ${e && e.message ? e.message : e}`);
  }
}

/** For the load check: the reader's terminal reads so far */
export const terrainStats = () => (shared ? shared.stats() : null);
