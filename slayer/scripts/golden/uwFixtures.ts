/*
  Golden tests run the app's own data code against recorded Unusual Whales and ThetaData answers, so a change that moves a number
  fails CI. A fixture set is one directory under scripts/fixtures/golden/<set>/, one gzipped answer per request path.

  Replay (CI):   npx tsx scripts/golden/<test>.ts
  Record (once): GOLDEN_RECORD=1 npx tsx scripts/golden/<test>.ts
  Recording goes through the local dev proxy (GOLDEN_UW_BASE, default http://127.0.0.1:8080/api/uw), or straight to the
  vendor with UNUSUAL_WHALES_API_KEY when no proxy runs. Replay fails on a path that was never recorded.
*/

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');
const RECORD = process.env.GOLDEN_RECORD === '1';

const keyOf = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 16);

type Saved = { path: string; status: number; body: string; type?: string };

/** Serve /api/uw/* and /api/theta/* from the named fixture set (or record them). Returns the paths asked for, in order. */
export function installUwFixtures(set: string): { asked: string[] } {
  const dir = join(ROOT, set);
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /^\/api\/(uw|theta)(\/.*)$/.exec(url);
    if (!m) return real(input, init);
    const theta = m[1] === 'theta';
    const path = m[2];
    asked.push(theta ? `theta:${path}` : path);
    const file = join(dir, `${keyOf(theta ? `theta:${path}` : path)}.json.gz`);
    if (existsSync(file)) {
      const saved = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Saved;
      return new Response(saved.body, { status: saved.status, headers: { 'content-type': saved.type ?? 'application/json' } });
    }
    if (!RECORD) throw new Error(`golden: no recording for ${theta ? 'theta ' : ''}${path} in ${set} (record with GOLDEN_RECORD=1)`);
    let res: Response | null = null;
    if (theta) {
      /* ThetaData through the local dev proxy, which forwards to the running terminal */
      res = await real(`${process.env.GOLDEN_THETA_BASE ?? 'http://127.0.0.1:8080/api/theta'}${path}`);
    } else {
      /* through the local proxy when it runs (it holds the key's three slots for everyone), else straight to the vendor */
      const via = process.env.GOLDEN_UW_BASE ?? 'http://127.0.0.1:8080/api/uw';
      const key = process.env.UNUSUAL_WHALES_API_KEY;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          res = await real(`${via}${path}`, { headers: { Accept: 'application/json' } });
        } catch {
          if (!key) throw new Error('golden: no local proxy and no UNUSUAL_WHALES_API_KEY to record with');
          res = await real(`https://api.unusualwhales.com/api${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
        }
        if (res.status !== 429 && res.status < 500) break;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    const body = await res!.text();
    const type = res!.headers.get('content-type') ?? 'application/json';
    /* an outage is not data: recording stops rather than keep it (a lost ThetaData session answers 503 or 478) */
    if (res!.status >= 500 || res!.status === 474 || res!.status === 478 || /terminal_down|session_lost|terminal_unavailable|invalid session id/i.test(body.slice(0, 400))) {
      throw new Error(`golden: ${theta ? 'ThetaData' : 'Unusual Whales'} did not answer ${path} (${res!.status}); nothing recorded — try again when it does`);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, gzipSync(JSON.stringify({ path, status: res!.status, body, type } satisfies Saved)));
    return new Response(body, { status: res!.status, headers: { 'content-type': type } });
  }) as typeof fetch;
  return { asked };
}

/* The clock a fixture set was recorded at, so session and expiry logic replays the same way. */
const RealDate = Date;
/** Pin Date.now() and new Date() to an instant (ISO). Time still advances from there so timers keep working. */
export function freezeClock(iso: string): void {
  const base = RealDate.parse(iso);
  const started = RealDate.now();
  const now = () => base + (RealDate.now() - started);
  class Pinned extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now());
      else super(...(args as [string]));
    }
    static now() {
      return now();
    }
  }
  globalThis.Date = Pinned as DateConstructor;
}

/** The instant a set was recorded at, written on first record and read back on replay. */
export function recordedAt(set: string, fallbackIso: string): string {
  const file = join(ROOT, set, 'clock.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  if (!RECORD) throw new Error(`golden: ${set} has no clock.txt`);
  mkdirSync(join(ROOT, set), { recursive: true });
  writeFileSync(file, fallbackIso);
  return fallbackIso;
}

let pass = 0;
let fail = 0;
/** Compare a computed value to the hand-checked one. */
export function expectNear(name: string, got: number, want: number, tol = 1e-6): void {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got}, want ${want}`);
  ok ? pass++ : fail++;
}
export function expectEqual<T>(name: string, got: T, want: T): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
/** Print the tally and exit non-zero on any failure. */
export function done(): never {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
