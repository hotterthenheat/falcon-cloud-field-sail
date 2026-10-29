/*
  ThetaData v3 proxy. The browser calls /api/theta/*; this checks the caller (server/auth.mjs) and forwards
  stocks, options, indices, the session calendar and Treasury rates to the local terminal (THETA_REST_BASE).
  It never starts the terminal (theta/supervisor.mjs does) and never runs on Vercel, where no terminal exists.
*/

import { gate, sendDenied } from './auth.mjs';
import { forwardPath } from './paths.mjs';

const BASE = process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';

const ALLOWED = [
  /^\/stock\/.+/,
  /^\/option\/.+/,
  /^\/index\/.+/,
  /^\/calendar\/(?:today|on_date|year_holidays)(?:\?|$)/,
  /^\/interest_rate\/history\/eod(?:\?|$)/,
];

const cache = new Map();
const inflight = new Map();
const MAX_CACHE = 200;

const ttlFor = (p) => {
  const path = p.split('?')[0];
  if (/^\/(calendar|interest_rate)\//.test(path)) return 300_000;
  if (/\/history\//.test(path)) return 15_000;
  if (/\/snapshot\//.test(path)) return 0;
  return 1_000;
};

const send = (res, status, body, type = 'application/json') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(body);
};

/* The client reads `code`; the sentence is for people and says nothing about the machine. */
const DOWN = JSON.stringify({ error: 'The market data terminal is not running.', code: 'terminal_down' });
const NO_TERMINAL = JSON.stringify({ error: 'This deployment has no market data terminal.', code: 'terminal_unavailable' });

async function load(reqPath) {
  const running = inflight.get(reqPath);
  if (running) return running;
  const job = (async () => {
    const upstream = await fetch(`${BASE}/v3${reqPath}`, {
      headers: { Accept: 'application/json, text/csv' },
      signal: AbortSignal.timeout(20_000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'text/plain';
    if (upstream.status === 200) {
      cache.set(reqPath, { at: Date.now(), status: 200, body: buf, type });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    return { status: upstream.status, body: buf, type };
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
  if (process.env.VERCEL && !process.env.THETA_REST_BASE) {
    send(res, 503, NO_TERMINAL);
    return;
  }
  const reqPath = forwardPath(req.url, /^\/api\/theta/, 500);
  if (!reqPath || !ALLOWED.some((re) => re.test(reqPath))) {
    send(res, 404, JSON.stringify({ error: 'not found' }));
    return;
  }
  const verdict = await gate(req, 'theta');
  if (!verdict.ok) {
    sendDenied(res, verdict);
    return;
  }
  const hit = cache.get(reqPath);
  if (hit && Date.now() - hit.at < ttlFor(reqPath)) {
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
