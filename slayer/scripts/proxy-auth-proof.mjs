/*
  Proof for the data proxies' gate (server/auth.mjs) and path checks (server/paths.mjs), against a local stand-in
  for Supabase (JWKS, Auth and the profiles table) and for the Theta terminal. Nothing leaves the machine.
  Run: node scripts/proxy-auth-proof.mjs
*/

import crypto from 'node:crypto';
import http from 'node:http';

const fail = [];
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : ` (want ${want})`}`);
  if (!ok) fail.push(name);
};

/* ---- stand-ins ---- */

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'proof-key', alg: 'ES256', use: 'sig' };
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;

const PROFILES = {
  'u-book': { role: 'member', plan: 'book', plan_status: 'active', grant_plan: null, grant_until: null, banned_until: null },
  'u-none': { role: 'member', plan: 'none', plan_status: 'none', grant_plan: null, grant_until: null, banned_until: null },
  'u-lapsed': { role: 'member', plan: 'desk', plan_status: 'past_due', grant_plan: null, grant_until: null, banned_until: null },
  'u-grant': { role: 'member', plan: 'none', plan_status: 'none', grant_plan: 'tape', grant_until: '2999-01-01T00:00:00Z', banned_until: null },
  'u-banned': { role: 'member', plan: 'desk', plan_status: 'active', grant_plan: null, grant_until: null, banned_until: '2999-01-01T00:00:00Z' },
  'u-owner': { role: 'owner', plan: 'none', plan_status: 'none', grant_plan: null, grant_until: null, banned_until: null },
  'u-rate': { role: 'member', plan: 'book', plan_status: 'active', grant_plan: null, grant_until: null, banned_until: null },
};

const supa = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/auth/v1/.well-known/jwks.json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (url.pathname === '/rest/v1/profiles') {
    const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(PROFILES[id] ? [PROFILES[id]] : []));
    return;
  }
  res.statusCode = 404;
  res.end();
});
const terminal = http.createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"response":[]}');
});
await new Promise((r) => supa.listen(0, '127.0.0.1', r));
await new Promise((r) => terminal.listen(0, '127.0.0.1', r));
const SUPA = `http://127.0.0.1:${supa.address().port}`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub, { key = privateKey, exp = Date.now() / 1000 + 600, iss = `${SUPA}/auth/v1` } = {}) => {
  const head = b64({ alg: 'ES256', kid: 'proof-key', typ: 'JWT' });
  const body = b64({ sub, aud: 'authenticated', role: 'authenticated', exp, iss });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
};

/* ---- the proxies, called as a Node server would ---- */

process.env.THETA_REST_BASE = `http://127.0.0.1:${terminal.address().port}`;
delete process.env.UNUSUAL_WHALES_API_KEY;
const { proxyUw } = await import('../server/uwProxy.mjs');
const { proxyTheta } = await import('../server/thetaProxy.mjs');

async function call(fn, url, bearer) {
  const req = { method: 'GET', url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} };
  let body = '';
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { body = b ? String(b) : ''; } };
  await fn(req, res);
  let code = '';
  try {
    code = JSON.parse(body).code || '';
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, code };
}
const show = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const UW = '/api/uw/stock/SPY/info';
const TH = '/api/theta/calendar/today';

/* local development with no account service: open (UW then reports its own missing key) */
for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'UW_PROXY_OPEN']) delete process.env[k];
check('dev, no Supabase: uw passes the gate', show(await call(proxyUw, UW)), '503');
check('dev, no Supabase: theta passes the gate', show(await call(proxyTheta, TH)), '200');

/* encoded dot segments never reach the allowlist */
check('uw %2e%2e rejected', show(await call(proxyUw, '/api/uw/stock/%2e%2e/info')), '404');
check('uw %2E%2E rejected', show(await call(proxyUw, '/api/uw/stock/%2E%2E/info')), '404');
check('uw .. rejected', show(await call(proxyUw, '/api/uw/stock/../info')), '404');
check('theta %2e%2e rejected', show(await call(proxyTheta, '/api/theta/stock/%2e%2e/%2e%2e/v2/x')), '404');

/* Vercel with no account service: closed */
process.env.VERCEL = '1';
check('vercel, no Supabase: uw refused', show(await call(proxyUw, UW)), '503 auth_unconfigured');
check('vercel with a remote terminal, no Supabase: theta refused', show(await call(proxyTheta, TH)), '503 auth_unconfigured');
delete process.env.THETA_REST_BASE;
check('vercel, no THETA_REST_BASE: theta 503', show(await call(proxyTheta, TH)), '503 terminal_unavailable');
process.env.THETA_REST_BASE = `http://127.0.0.1:${terminal.address().port}`;
process.env.UW_PROXY_OPEN = '1';
process.env.VERCEL_ENV = 'production';
check('UW_PROXY_OPEN ignored in production', show(await call(proxyUw, UW)), '503 auth_unconfigured');
delete process.env.UW_PROXY_OPEN;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;

/* configured: sign-in, ban and plan */
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-proof-key';
check('no token: 401', show(await call(proxyUw, UW)), '401 signed_out');
check('garbage token: 401', show(await call(proxyUw, UW, 'not.a.jwt')), '401 session_invalid');
check('wrong signing key: 401', show(await call(proxyUw, UW, token('u-book', { key: other }))), '401 session_invalid');
check('expired token: 401', show(await call(proxyUw, UW, token('u-book', { exp: Date.now() / 1000 - 5 }))), '401 session_invalid');
check('foreign issuer: 401', show(await call(proxyUw, UW, token('u-book', { iss: 'https://evil.example/auth/v1' }))), '401 session_invalid');
check('book plan: uw passes the gate', show(await call(proxyUw, UW, token('u-book'))), '503');
check('book plan: theta passes', show(await call(proxyTheta, TH, token('u-book'))), '200');
check('no plan: 403', show(await call(proxyUw, UW, token('u-none'))), '403 no_plan');
check('lapsed plan: 403', show(await call(proxyUw, UW, token('u-lapsed'))), '403 no_plan');
check('granted plan: passes', show(await call(proxyUw, UW, token('u-grant'))), '503');
check('owner without a plan: passes', show(await call(proxyUw, UW, token('u-owner'))), '503');
check('banned: 403', show(await call(proxyUw, UW, token('u-banned'))), '403 banned');
check('unknown user: 403', show(await call(proxyUw, UW, token('u-ghost'))), '403 no_profile');
process.env.PROXY_PLAN_GATE = 'off';
check('PROXY_PLAN_GATE=off: signed in without a plan passes', show(await call(proxyUw, UW, token('u-none'))), '503');
check('PROXY_PLAN_GATE=off: banned still refused', show(await call(proxyUw, UW, token('u-banned'))), '403 banned');
delete process.env.PROXY_PLAN_GATE;

/* per-user rate limit */
process.env.PROXY_RATE_BURST = '3';
process.env.PROXY_RATE_PER_SEC = '0.001';
const rate = token('u-rate');
const seen = [];
for (let i = 0; i < 4; i++) seen.push(show(await call(proxyTheta, TH, rate)));
check('rate limit: fourth call within the burst refused', seen.join(','), '200,200,200,429 rate_limited');

supa.close();
terminal.close();
if (fail.length) {
  console.error(`\n${fail.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall proxy checks passed');
