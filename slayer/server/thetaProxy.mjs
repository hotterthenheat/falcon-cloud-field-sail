/*
  ThetaData v3 proxy. The browser calls /api/theta/*; this checks the caller (server/auth.mjs) and forwards stocks,
  options, indices, the session calendar and Treasury rates to the account's one terminal:
  - through the relay beside the always-on terminal when THETA_RELAY_URL is set (the live site, and any machine that
    should share that terminal rather than start its own), with THETA_RELAY_SECRET;
  - otherwise straight to a terminal on this machine (THETA_REST_BASE, default 127.0.0.1:25503) for local work.
  It never starts a terminal (theta/supervisor.mjs and theta/relay.mjs do).
*/

import { gate, sendDenied } from './auth.mjs';
import { forwardPath } from './paths.mjs';
import { sessionLost, thetaAllowed, thetaTtl } from '../shared/thetaPaths.mjs';
import { createHub } from './hub.mjs';

const RELAY = (process.env.THETA_RELAY_URL || '').replace(/\/+$/, '');
const RELAY_SECRET = process.env.THETA_RELAY_SECRET || '';
const BASE = RELAY || process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';

const send = (res, status, body, type = 'application/json') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
};

/* The client reads `code`; the sentence is for people and says nothing about the machine. */
const DOWN = JSON.stringify({ error: 'The market data terminal is not running.', code: 'terminal_down' });
const LOST = JSON.stringify({ error: 'The market data session is reconnecting.', code: 'session_lost' });
const NO_TERMINAL = JSON.stringify({ error: 'This deployment has no market data terminal configured.', code: 'terminal_unavailable' });

/* The app's own client sends x-theta-soft: 1 and reads `code`, so an outage it already shows on screen is answered
   200 rather than 503, and the browser does not log every call of a known outage as an error. Anyone else gets 503. */
const OUTAGE = /"code":"(terminal_down|session_lost|terminal_unavailable)"/;
const statusFor = (req, status, body) =>
  status === 503 && req.headers['x-theta-soft'] === '1' && OUTAGE.test(String(body).slice(0, 200)) ? 200 : status;
/* 472 is ThetaData's "no data for this request" (a contract that never quoted that day): an answer, not a fault */
const NO_DATA = JSON.stringify({ error: 'No data for this request.', code: 'no_data' });
function sendSoftly(req, res, status, body, type) {
  if (status === 472 && req.headers['x-theta-soft'] === '1') send(res, 200, NO_DATA);
  else send(res, statusFor(req, status, body), body, type);
}

/* The terminal answers at most eight requests at once (its log says "Max concurrent requests: 8"); past that it
   refuses with 429. However many viewers ask, this process sends at most that many, and a live snapshot goes ahead of
   history so prices never wait behind a long replay. History never holds more than six of the eight. */
const TERMINAL_SLOTS = Number(process.env.THETA_MAX_CONCURRENT) || 8;
const HISTORY_SLOTS = Math.max(1, TERMINAL_SLOTS - 2);
let busy = 0;
let busyHistory = 0;
const quick = [];
const slow = [];
const isHistory = (p) => /\/(history|at_time)\//.test(p);
function wake() {
  while (busy < TERMINAL_SLOTS && quick.length) {
    busy += 1;
    quick.shift()();
  }
  while (busy < TERMINAL_SLOTS && busyHistory < HISTORY_SLOTS && slow.length) {
    busy += 1;
    busyHistory += 1;
    slow.shift()();
  }
}
async function slot(p, fn) {
  const hist = isHistory(p);
  if (busy < TERMINAL_SLOTS && (!hist || busyHistory < HISTORY_SLOTS) && !(hist ? slow : quick).length) {
    busy += 1;
    if (hist) busyHistory += 1;
  } else {
    /* the slot is counted for us when we are woken */
    await new Promise((r) => (hist ? slow : quick).push(r));
  }
  try {
    return await fn();
  } finally {
    busy -= 1;
    if (hist) busyHistory -= 1;
    wake();
  }
}

async function load(reqPath) {
  return slot(reqPath, () => loadNow(reqPath));
}

async function loadNow(reqPath) {
  const upstream = await fetch(`${BASE}/v3${reqPath}`, {
    headers: { Accept: 'application/json, text/csv', ...(RELAY ? { 'x-relay-secret': RELAY_SECRET } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get('content-type') || 'text/plain';
  if (upstream.status !== 200 && sessionLost(buf.toString('utf8', 0, Math.min(buf.length, 400)))) {
    return { status: 503, body: Buffer.from(LOST), type: 'application/json' };
  }
  return { status: upstream.status, body: buf, type };
}

/* One shared copy per request for every viewer (server/hub.mjs). A snapshot is refreshed about once a second while
   anyone watches it, whatever the number of viewers; the terminal's eight slots are far from full at that rate. */
const hub = createHub({
  name: 'theta',
  fetch: (p) => load(p).catch(() => ({ status: 503, body: Buffer.from(DOWN), type: 'application/json' })),
  ttl: (p) => Math.max(thetaTtl(p), /\/snapshot\//.test(p) ? 900 : 0),
  refreshPerSec: Number(process.env.THETA_HUB_REFRESH_PER_SEC) || 25,
});
/** The hub's counts, for the load check (scripts/load-proof.mjs). */
export const thetaHubStats = () => hub.stats();

/** One answer for a reader inside this process (the Compass engine): the same hub and the same eight slots as every
    viewer's call, with no HTTP hop. An outage answers 503 with its code, as the proxy does. */
export async function thetaDirect(reqPath) {
  if (process.env.VERCEL && !RELAY && !process.env.THETA_REST_BASE) return { status: 503, body: NO_TERMINAL, type: 'application/json' };
  if (!thetaAllowed(reqPath)) return { status: 404, body: JSON.stringify({ error: 'not found' }), type: 'application/json' };
  try {
    const got = await hub.get(reqPath);
    return { status: got.status, body: got.body.toString('utf8'), type: got.type };
  } catch {
    return { status: 503, body: DOWN, type: 'application/json' };
  }
}

export async function proxyTheta(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  if (/^(?:\/api\/theta)?\/__hub(?:\?|$)/.test(req.url || '') && process.env.VERCEL_ENV !== 'production') {
    send(res, 200, JSON.stringify(hub.stats()));
    return;
  }
  if (process.env.VERCEL && !RELAY && !process.env.THETA_REST_BASE) {
    send(res, statusFor(req, 503, NO_TERMINAL), NO_TERMINAL);
    return;
  }
  const reqPath = forwardPath(req.url, /^\/api\/theta/, 500);
  if (!reqPath || !thetaAllowed(reqPath)) {
    send(res, 404, JSON.stringify({ error: 'not found' }));
    return;
  }
  const verdict = await gate(req, 'theta');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  try {
    const got = await hub.get(reqPath);
    sendSoftly(req, res, got.status, got.body, got.type);
  } catch {
    send(res, statusFor(req, 503, DOWN), DOWN);
  }
}
