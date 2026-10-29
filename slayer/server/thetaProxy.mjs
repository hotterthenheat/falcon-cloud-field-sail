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

const RELAY = (process.env.THETA_RELAY_URL || '').replace(/\/+$/, '');
const RELAY_SECRET = process.env.THETA_RELAY_SECRET || '';
const BASE = RELAY || process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';

const cache = new Map();
const inflight = new Map();
const MAX_CACHE = 400;

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

async function load(reqPath) {
  const running = inflight.get(reqPath);
  if (running) return running;
  const job = (async () => {
    const upstream = await fetch(`${BASE}/v3${reqPath}`, {
      headers: { Accept: 'application/json, text/csv', ...(RELAY ? { 'x-relay-secret': RELAY_SECRET } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    let buf = Buffer.from(await upstream.arrayBuffer());
    let type = upstream.headers.get('content-type') || 'text/plain';
    let status = upstream.status;
    if (status !== 200 && sessionLost(buf.toString('utf8', 0, Math.min(buf.length, 400)))) {
      status = 503;
      buf = Buffer.from(LOST);
      type = 'application/json';
    }
    if (status === 200) {
      cache.set(reqPath, { at: Date.now(), status, body: buf, type });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    return { status, body: buf, type };
  })();
  inflight.set(reqPath, job);
  try {
    return await job;
  } finally {
    inflight.delete(reqPath);
  }
}

export async function proxyTheta(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  if (process.env.VERCEL && !RELAY && !process.env.THETA_REST_BASE) {
    send(res, 503, NO_TERMINAL);
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
  const hit = cache.get(reqPath);
  if (hit && Date.now() - hit.at < thetaTtl(reqPath)) {
    send(res, hit.status, hit.body, hit.type);
    return;
  }
  try {
    const got = await load(reqPath);
    send(res, got.status, got.body, got.type);
  } catch {
    send(res, 503, DOWN);
  }
}
