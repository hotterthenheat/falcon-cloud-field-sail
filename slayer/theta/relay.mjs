/*
  The ThetaData relay. It runs beside the account's one always-on terminal and is the only way anything reaches it:
  the live site's /api/theta forwards here (THETA_RELAY_URL + THETA_RELAY_SECRET on Vercel), and so does a
  developer's machine, so one terminal serves everyone and no second terminal ever ends its session.

  It supervises the terminal (theta/supervisor.mjs), keeps it warm, holds the terminal's concurrency limit with
  snapshots ahead of history, shares identical requests in flight, and gzips answers for the trip to Vercel.

  Run:  THETADATA_API_KEY=… THETA_RELAY_SECRET=… node theta/relay.mjs
  Port: THETA_RELAY_PORT (default 25510). Setup: docs/theta-terminal.md, "The always-on terminal".
*/

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { sessionLost, thetaAllowed, thetaTtl } from '../shared/thetaPaths.mjs';
import { WARM, superviseTheta, terminalState, warmPath as quotePath } from './supervisor.mjs';

const LOGIN_FAILED = () => ({
  status: 503,
  body: Buffer.from(JSON.stringify({ error: 'ThetaData refused the login: check THETADATA_API_KEY on the machine that runs the terminal.', code: 'terminal_login' })),
  type: 'application/json',
});

const TERMINAL = process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';
const PORT = Number(process.env.THETA_RELAY_PORT) || 25510;
/* the terminal's own limit (it logs "Max concurrent requests: 8"); history may hold at most six of them */
const MAX_UPSTREAM = Number(process.env.THETA_MAX_CONCURRENT) || 8;
const HISTORY_CAP = Math.max(1, MAX_UPSTREAM - 2);
const CACHE_BYTES = 256 * 1024 * 1024;
const log = (m) => console.log(`[relay] ${new Date().toISOString()} ${m}`);

/* ---- who may call ---- */
const secret = Buffer.from(process.env.THETA_RELAY_SECRET || '');
function authorized(req) {
  if (!secret.length) return false;
  const h = String(req.headers['x-relay-secret'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const got = Buffer.from(h);
  return got.length === secret.length && timingSafeEqual(got, secret);
}

/* ---- the terminal's slots: snapshots first ---- */
let busy = 0;
let busyHistory = 0;
const quick = [];
const slow = [];
const isHistory = (p) => /\/(history|at_time)\//.test(p);
function take(p) {
  const hist = isHistory(p);
  if (busy < MAX_UPSTREAM && (!hist || busyHistory < HISTORY_CAP)) {
    busy += 1;
    if (hist) busyHistory += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => (hist ? slow : quick).push(resolve));
}
function release(p) {
  busy -= 1;
  if (isHistory(p)) busyHistory -= 1;
  if (busy >= MAX_UPSTREAM) return;
  if (quick.length) {
    busy += 1;
    quick.shift()();
  } else if (slow.length && busyHistory < HISTORY_CAP) {
    busy += 1;
    busyHistory += 1;
    slow.shift()();
  }
}

/* ---- answers ---- */
const cache = new Map();
let cacheBytes = 0;
const inflight = new Map();
const stats = { calls: 0, upstream: 0, hits: 0, shared: 0, lastOkAt: 0, lastSessionLostAt: 0, failures: 0 };

function keep(p, entry) {
  const old = cache.get(p);
  if (old) cacheBytes -= old.body.length;
  cache.delete(p);
  cache.set(p, entry);
  cacheBytes += entry.body.length;
  while (cacheBytes > CACHE_BYTES && cache.size) {
    const [k, v] = cache.entries().next().value;
    cache.delete(k);
    cacheBytes -= v.body.length;
  }
}

async function upstream(p) {
  await take(p);
  stats.upstream += 1;
  try {
    const r = await fetch(`${TERMINAL}/v3${p}`, { headers: { Accept: 'application/json, text/csv' }, signal: AbortSignal.timeout(30_000) });
    const body = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') || 'text/plain';
    if (r.status === 200) stats.lastOkAt = Date.now();
    if (r.status !== 200 && sessionLost(body.toString('utf8', 0, Math.min(body.length, 400)))) {
      stats.lastSessionLostAt = Date.now();
      return { status: 503, body: Buffer.from(JSON.stringify({ error: 'The market data session is reconnecting.', code: 'session_lost' })), type: 'application/json' };
    }
    if (r.status !== 200 && r.status !== 472 && terminalState().state === 'login_failed') return LOGIN_FAILED();
    return { status: r.status, body, type };
  } catch {
    stats.failures += 1;
    /* the supervisor read "Invalid credentials" in the terminal's output: say so, not "not running" */
    if (terminalState().state === 'login_failed') return LOGIN_FAILED();
    return { status: 503, body: Buffer.from(JSON.stringify({ error: 'The market data terminal is not running.', code: 'terminal_down' })), type: 'application/json' };
  } finally {
    release(p);
  }
}

/** One answer for a path: cached while good, shared while in flight. */
export async function answer(p) {
  stats.calls += 1;
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < thetaTtl(p)) {
    stats.hits += 1;
    return hit;
  }
  const running = inflight.get(p);
  if (running) {
    stats.shared += 1;
    return running;
  }
  const job = upstream(p).then((got) => {
    const entry = { ...got, at: Date.now(), gz: null };
    if (got.status === 200) keep(p, entry);
    return entry;
  });
  inflight.set(p, job);
  try {
    return await job;
  } finally {
    inflight.delete(p);
  }
}

function send(req, res, got) {
  const gzipOk = /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && got.body.length > 1024;
  res.statusCode = got.status;
  res.setHeader('content-type', got.type);
  res.setHeader('cache-control', 'no-store');
  if (gzipOk) {
    got.gz ??= gzipSync(got.body, { level: 1 });
    res.setHeader('content-encoding', 'gzip');
    res.end(got.gz);
  } else {
    res.end(got.body);
  }
}

/* ---- the warmer ---- */
/* Keeps the terminal's market-data connection and the JVM hot, and keeps the slow lists (expirations, the calendar)
   loaded for the names people open first, so the first page view never waits on them. It never invents a price:
   every answer it holds is the terminal's own, and quotes are only kept for the burst window like any other. */
async function warmQuotes() {
  await Promise.all(WARM.map((s) => answer(quotePath(s))));
}
async function warmLists() {
  await answer('/calendar/today?format=json');
  await Promise.all(WARM.filter((s) => s !== 'VIX').map((s) => answer(`/option/list/expirations?symbol=${s === 'SPX' ? 'SPXW' : s}&format=json`)));
}

export function startRelay() {
  if (!secret.length) {
    log('THETA_RELAY_SECRET is not set: refusing to start (the relay would be open to anyone)');
    return null;
  }
  const stopTerminal = superviseTheta({ log: (m) => log(`terminal: ${m}`), warm: false });
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    if (url === '/health') {
      const up = Date.now() - stats.lastOkAt < 60_000;
      const lost = stats.lastSessionLostAt > stats.lastOkAt;
      res.setHeader('content-type', 'application/json');
      const sup = terminalState().state;
      res.end(JSON.stringify({ terminal: sup === 'login_failed' ? 'login_failed' : lost ? 'session_lost' : up ? 'up' : 'down', supervisor: sup, busy, queued: quick.length + slow.length, cached: cache.size, ...stats }));
      return;
    }
    if (req.method !== 'GET' || !authorized(req)) {
      res.statusCode = req.method !== 'GET' ? 405 : 401;
      res.end();
      return;
    }
    const p = url.replace(/^\/v3/, '');
    if (!thetaAllowed(p) || p.includes('..')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    send(req, res, await answer(p));
  });
  server.keepAliveTimeout = 65_000;
  server.listen(PORT, () => log(`listening on :${PORT}, terminal ${TERMINAL}, warm ${WARM.join(' ')}`));

  const quoteTimer = setInterval(() => void warmQuotes(), 15_000);
  const listTimer = setInterval(() => void warmLists(), 240_000);
  setTimeout(() => void warmLists().then(warmQuotes), 20_000);
  return () => {
    clearInterval(quoteTimer);
    clearInterval(listTimer);
    server.close();
    stopTerminal?.();
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const stop = startRelay();
  if (!stop) process.exit(1);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      stop();
      process.exit(0);
    });
  }
}
