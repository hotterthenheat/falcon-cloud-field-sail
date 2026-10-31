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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub, HOT_NAMES, nameOfPath } from './hub.mjs';

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
/* A request the terminal took too long to answer: it is up and busy, so this is not an outage (no breaker, no cache) */
const BUSY = JSON.stringify({ error: 'The market data terminal is busy; asked again shortly.', code: 'terminal_busy' });
const timedOut = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';
const failed = (e) => (timedOut(e) ? { status: 504, body: Buffer.from(BUSY), type: 'application/json' } : { status: 503, body: Buffer.from(DOWN), type: 'application/json' });
const LOST = JSON.stringify({ error: 'The market data session is reconnecting.', code: 'session_lost' });
const NO_TERMINAL = JSON.stringify({ error: 'This deployment has no market data terminal configured.', code: 'terminal_unavailable' });

/* The supervisor on this machine (theta/supervisor.mjs, maybe another process) writes what it knows about the terminal
   to theta/run/state.json. When it says the key was refused, a failed request answers terminal_login, so the page can
   say "ThetaData login failed: check THETADATA_API_KEY" instead of "not running". Read at most every 5 s. Through the
   relay, the relay sends the same code itself. */
const LOGIN = JSON.stringify({ error: 'The live data feed refused the login: check the feed key on the machine that runs the terminal.', code: 'terminal_login' });
const STATE_FILE = process.env.THETA_RUN_DIR ? path.join(process.env.THETA_RUN_DIR, 'state.json') : fileURLToPath(new URL('../theta/run/state.json', import.meta.url));
let stateRead = { at: 0, login: false };
function loginFailed() {
  if (RELAY) return false;
  const now = Date.now();
  if (now - stateRead.at < 5_000) return stateRead.login;
  let login = false;
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    login = s?.state === 'login_failed' && now - Number(s.at) < 60_000;
  } catch {
    /* no supervisor on this machine (a terminal started by hand, or Vercel) */
  }
  stateRead = { at: now, login };
  return login;
}
/** A failed answer from a terminal whose login was refused becomes terminal_login (never kept by the hub: a 503) */
const withLogin = (got) =>
  got.status !== 200 && got.status !== 472 && (got.status >= 500 || (got.status >= 470 && got.status <= 479)) && loginFailed()
    ? { status: 503, body: Buffer.from(LOGIN), type: 'application/json' }
    : got;

/* The app's own client sends x-theta-soft: 1 and reads `code`, so an outage it already shows on screen is answered
   200 rather than 503, and the browser does not log every call of a known outage as an error. Anyone else gets 503. */
const OUTAGE = /"code":"(terminal_down|terminal_login|session_lost|terminal_unavailable)"/;
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
  return slot(reqPath, async () => {
    /* the terminal refusing for a moment (429, its own count of requests in flight) is asked again twice */
    let got = await loadNow(reqPath);
    for (let i = 0; i < 2 && got.status === 429; i++) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
      got = await loadNow(reqPath);
    }
    return got;
  });
}

async function loadNow(reqPath) {
  const upstream = await fetch(`${BASE}/v3${reqPath}`, {
    headers: { Accept: 'application/json, text/csv', ...(RELAY ? { 'x-relay-secret': RELAY_SECRET } : {}) },
    /* a long history span on a terminal already answering seven others can take well over 20 s; a live snapshot cannot */
    signal: AbortSignal.timeout(isHistory(reqPath) ? 90_000 : 20_000),
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
/* ThetaData's own 47x codes are mostly about the terminal, not the request (the v3 jar: 471 PERMISSION, 472 NO_DATA,
   473 UNAUTHENTICATED, 475 TERMINAL_PARSE; older terminals and the relay also send 474 DISCONNECTED, 476 WRONG_IP,
   477 NO_PAGE_FOUND, 478 INVALID_SESSION_ID). Only 472 ("this contract has no data that day") is an answer worth keeping:
   a 474 kept during an outage was served for six hours (a past day's TTL) after the terminal came back. 471 is not
   kept either: a refusal from a terminal that has not finished logging in must not be pinned for hours. */
export const thetaKeepable = (status) =>
  status === 200 || status === 472 || (status >= 400 && status < 500 && !(status >= 470 && status <= 479) && ![401, 403, 408, 429].includes(status));

const hub = createHub({
  name: 'theta',
  fetch: (p) => load(p).catch(failed).then(withLogin),
  keepable: thetaKeepable,
  ttl: (p) => Math.max(thetaTtl(p), /\/snapshot\//.test(p) ? 900 : 0),
  refreshPerSec: Number(process.env.THETA_HUB_REFRESH_PER_SEC) || 25,
  /* the hot names' and today's names' first-paint reads stay warm (quotes, bars, the newest history chunk, the nearest
     chain): 150 paths within a minute is ~2.5 calls a second of the terminal's eight slots, only while the feed moves */
  nameOf: nameOfPath,
  hotNames: HOT_NAMES,
  maxDayPins: Number(process.env.THETA_HUB_DAY_PINS) || 150,
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
    if (got.status === 200) for (const [k, v] of Object.entries(hub.ageHeaders(reqPath, got))) res.setHeader(k, v);
    sendSoftly(req, res, got.status, got.body, got.type);
  } catch {
    send(res, statusFor(req, 503, DOWN), DOWN);
  }
}
