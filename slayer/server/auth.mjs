/*
  The gate in front of the paid-data proxies: a Supabase session, a profile that is not banned, a plan that opens
  the feed (shared/plans.mjs), and a per-user rate limit. Answers are JSON with a `code` the client can act on.

  Rate buckets and caches live in this process only; on Vercel each function instance keeps its own.
*/

import crypto from 'node:crypto';
import { FEED_PLAN, opens, planHeld } from '../shared/plans.mjs';

const PROFILE_TTL_MS = 60_000;
const TOKEN_TTL_MS = 60_000;
const JWKS_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 5_000;

const config = () => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  return {
    url,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  };
};

const onVercel = () => !!process.env.VERCEL;
const isProduction = () => process.env.VERCEL_ENV === 'production';

let warned = false;
const warnOpen = (why) => {
  if (warned) return;
  warned = true;
  console.warn(`[proxy] /api/uw and /api/theta are open: ${why}`);
};

const remember = (map, key, value) => {
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
};

/* ---- the access token ---- */

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

let jwks = { at: 0, keys: [], url: '' };
async function signingKey(url, kid) {
  const stale = Date.now() - jwks.at > JWKS_TTL_MS || jwks.url !== url;
  if (stale || !jwks.keys.some((k) => k.kid === kid)) {
    try {
      const r = await fetch(`${url}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) jwks = { at: Date.now(), keys: (await r.json()).keys || [], url };
    } catch {
      /* the cached set, or the fallback below */
    }
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
}

const VERIFY = {
  ES256: (key, data, sig) => crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig),
  RS256: (key, data, sig) => crypto.verify('sha256', data, key, sig),
  EdDSA: (key, data, sig) => crypto.verify(null, data, key, sig),
};

const tokenCache = new Map();

/** Asks Auth directly: the path for projects still signing with a shared secret, or an unknown key id. */
async function userFromAuth(cfg, token) {
  const hash = crypto.createHash('sha256').update(token).digest('base64url');
  const hit = tokenCache.get(hash);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.sub;
  let sub = null;
  try {
    const r = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey || cfg.serviceKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (r.ok) sub = (await r.json()).id || null;
  } catch {
    return null;
  }
  remember(tokenCache, hash, { at: Date.now(), sub });
  return sub;
}

/** The user id a valid access token belongs to, or null. */
export async function verifyAccessToken(cfg, token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head;
  let claims;
  try {
    head = b64json(parts[0]);
    claims = b64json(parts[1]);
  } catch {
    return null;
  }
  const now = Date.now() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (claims.iss && claims.iss !== `${cfg.url}/auth/v1`) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes('authenticated') || typeof claims.sub !== 'string') return null;

  const verify = VERIFY[head.alg];
  const key = verify && head.kid ? await signingKey(cfg.url, head.kid) : null;
  if (!key) return userFromAuth(cfg, token);
  const ok = verify(key, Buffer.from(`${parts[0]}.${parts[1]}`), Buffer.from(parts[2], 'base64url'));
  return ok ? claims.sub : null;
}

/* ---- the profile ---- */

const profileCache = new Map();

async function profileOf(cfg, userId, token) {
  const hit = profileCache.get(userId);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.row;
  const headers = cfg.serviceKey
    ? cfg.serviceKey.startsWith('sb_')
      ? { apikey: cfg.serviceKey }
      : { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
    : { apikey: cfg.anonKey, Authorization: `Bearer ${token}` };
  const select = 'role,plan,plan_status,grant_plan,grant_until,banned_until';
  const r = await fetch(`${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=${select}`, {
    headers: { ...headers, Accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) throw new Error(`profiles ${r.status}`);
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  remember(profileCache, userId, { at: Date.now(), row });
  return row;
}

/* ---- the rate limit: a token bucket per user and feed ---- */

const buckets = new Map();
const rateBurst = () => Number(process.env.PROXY_RATE_BURST) || 300;
const ratePerSec = () => Number(process.env.PROXY_RATE_PER_SEC) || 5;

/** Takes one token; returns 0 when allowed, else the seconds until the next token. */
export function takeToken(id) {
  const burst = rateBurst();
  const rate = ratePerSec();
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  let wait = 0;
  if (b.tokens >= 1) b.tokens -= 1;
  else wait = Math.ceil((1 - b.tokens) / rate);
  remember(buckets, id, b);
  return wait;
}

/* ---- the gate ---- */

const deny = (status, code, error, extra = {}) => ({ ok: false, status, body: { error, code, ...extra }, headers: extra.retryAfter ? { 'retry-after': String(extra.retryAfter) } : {} });

/**
 * May this request read `feed` ('uw' | 'theta')?
 * Resolves to { ok: true, user } or { ok: false, status, body, headers }.
 */
export async function gate(req, feed) {
  if (process.env.UW_PROXY_OPEN === '1' && !isProduction()) {
    warnOpen('UW_PROXY_OPEN=1');
    return { ok: true, user: null };
  }
  const cfg = config();
  if (!cfg.url || !(cfg.anonKey || cfg.serviceKey)) {
    if (onVercel()) return deny(503, 'auth_unconfigured', 'The data proxy has no account service configured.');
    warnOpen('SUPABASE_URL is not configured (local development)');
    return { ok: true, user: null };
  }

  const header = req.headers?.authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || '';
  if (!token) return deny(401, 'signed_out', 'Sign in to read market data.');
  const userId = await verifyAccessToken(cfg, token);
  if (!userId) return deny(401, 'session_invalid', 'Your session has expired. Sign in again.');

  let row;
  try {
    row = await profileOf(cfg, userId, token);
  } catch {
    return deny(503, 'profile_unavailable', 'The account service did not answer. Try again shortly.');
  }
  if (!row) return deny(403, 'no_profile', 'This account has no profile.');
  if (row.banned_until && Date.parse(row.banned_until) > Date.now()) return deny(403, 'banned', 'This account is suspended.');

  if (process.env.PROXY_PLAN_GATE !== 'off') {
    const held = planHeld({
      role: row.role,
      plan: row.plan,
      planStatus: row.plan_status ?? 'none',
      grantPlan: row.grant_plan ?? null,
      grantUntil: row.grant_until ?? null,
    });
    const needed = FEED_PLAN[feed];
    if (!opens(held, needed)) return deny(403, 'no_plan', 'Your plan does not include this data.', { needed });
  }

  const wait = takeToken(`${feed}:${userId}`);
  if (wait) return deny(429, 'rate_limited', 'Too many requests. Slow down.', { retryAfter: wait });
  return { ok: true, user: userId };
}

/** Writes a refused gate as JSON. */
export function sendDenied(res, verdict) {
  res.statusCode = verdict.status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(verdict.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(verdict.body));
}
