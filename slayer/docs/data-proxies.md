# The data proxies: `/api/uw` and `/api/theta`

The browser never holds a vendor key. It calls this app's own endpoints, which add the key server-side:

| Endpoint | Code | Runs where |
|---|---|---|
| `/api/uw/*` (Unusual Whales) | `server/uwProxy.mjs`, `api/uw/[...path].js` on Vercel | dev, preview, `server.ts`, Vercel |
| `/api/theta/*` (ThetaData) | `server/thetaProxy.mjs` | locally only, next to the terminal (`docs/theta-terminal.md`) |

## Who may call them

Every request passes `server/auth.mjs` before anything reaches a vendor:

1. **A Supabase session.** The browser sends `Authorization: Bearer <access token>` (`src/data/feedGate.ts`). The
   token is verified against the project's JWKS (`/auth/v1/.well-known/jwks.json`, cached 10 minutes); a project
   still signing with a shared secret falls back to asking `/auth/v1/user` (cached 60 s per token). Expired tokens,
   other issuers and wrong signatures answer `401`.
2. **A profile that is not banned** (`profiles.banned_until` in the future answers `403 banned`).
3. **A plan that opens the feed.** The rules are `shared/plans.mjs`, the same module the browser's gates
   (`src/data/access.ts`) use: a paid plan that is active or trialing, or a live grant, or the owner role. Both feeds
   need at least Book (`FEED_PLAN`). `PROXY_PLAN_GATE=off` skips this check.
4. **A rate limit**: a token bucket per user and feed, `PROXY_RATE_BURST` (300) deep, refilled at
   `PROXY_RATE_PER_SEC` (5) per second. It lives in the process, so on Vercel each function instance keeps its own.

Refusals are JSON: `{ "error": "...", "code": "signed_out" | "session_invalid" | "banned" | "no_plan" | "no_profile" |
"rate_limited" | "profile_unavailable" | "auth_unconfigured" }`.

The profile is read with `SUPABASE_SERVICE_ROLE_KEY` when it is set, else with the publishable key and the caller's
own token under row-level security. Profiles are cached 60 s, so a ban or a lapsed plan takes up to a minute.

In the browser, calls are made only while the terminal's shell is mounted and, when accounts are configured, only
with a session: the landing page and signed-out visitors never call either proxy.

## Local development

- No `SUPABASE_URL` / `VITE_SUPABASE_URL` configured: the proxies are open and log one warning line. This is the
  default for a clone without keys.
- Supabase configured but you need the proxies open (a signed-out Playwright run, say): `UW_PROXY_OPEN=1`. It is
  ignored when `VERCEL_ENV=production`.
- On Vercel without Supabase configured, the proxies answer `503 auth_unconfigured`. They never run open there.

## Paths

`server/paths.mjs` refuses any path the URL parser would rewrite (`..`, `.`, `%2e%2e`, backslashes, empty
segments) before the allowlist is matched, so the allowlist always matches what goes upstream. Every UW route the
browser uses must be on the allowlist in `server/uwProxy.mjs`.

## Proof

`node scripts/proxy-auth-proof.mjs` runs the gate against a local stand-in for Supabase (JWKS, profiles) and a
stand-in terminal, with no network: open in dev, closed on Vercel, every refusal code, the plan rules, the rate
limit, and the dot-segment cases. CI runs it.
