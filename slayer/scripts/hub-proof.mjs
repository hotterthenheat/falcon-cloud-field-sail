/*
  The data hub (server/hub.mjs) against a counting stand-in for the vendor: viewers must never multiply the calls.
  Run: node scripts/hub-proof.mjs
*/

import { canonical, createHub, marketHours } from '../server/hub.mjs';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* a vendor that answers in 20 ms and counts every call */
function vendor(status = () => 200) {
  const calls = new Map();
  return {
    calls,
    total: () => [...calls.values()].reduce((a, b) => a + b, 0),
    fetch: async (p) => {
      calls.set(p, (calls.get(p) ?? 0) + 1);
      await sleep(20);
      const s = status(p);
      return { status: s, body: Buffer.from(JSON.stringify({ p, n: calls.get(p) })), type: 'application/json' };
    },
  };
}

/* N viewers, each asking for the same path every `every` ms (out of phase), for `ms` */
async function viewers(hub, n, every, ms, path = '/stock/SPY/stock-state') {
  const end = Date.now() + ms;
  let asks = 0;
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      await sleep((every / n) * i);
      while (Date.now() < end) {
        await hub.get(path);
        asks += 1;
        await sleep(every);
      }
    }),
  );
  return asks;
}

const TTL = 300;
const RUN = 3_000;

check('one key per request', canonical('/a?z=1&b=2&a=3&b=1') === '/a?a=3&b=2&b=1&z=1');

/* the number of viewers does not change the vendor calls: at most one per freshness window, plus the first */
const counts = {};
for (const n of [1, 5, 500]) {
  const v = vendor();
  const hub = createHub({ hours: () => true, name: `proof-${n}`, fetch: v.fetch, ttl: () => TTL, refreshPerSec: 50 });
  const asks = await viewers(hub, n, 100, RUN);
  counts[n] = v.total();
  check(`${n} viewer(s) asking every 100 ms: ${asks} asks, ${v.total()} vendor calls`, v.total() <= RUN / TTL + 3);
}
/* timers drift on a busy machine, so the comparison allows a few calls either way; the point is 500 viewers ≈ 1, not 500× */
check('500 viewers cost about what 1 does (within three calls)', counts[500] <= counts[1] + 3, `${counts[1]} vs ${counts[500]}`);

/* a single slow viewer is not refreshed faster than it looks: calls follow its asks, not the freshness window */
{
  const v = vendor();
  const hub = createHub({ hours: () => true, name: 'proof-slow', fetch: v.fetch, ttl: () => 100, refreshPerSec: 50 });
  const asks = await viewers(hub, 1, 600, RUN);
  check(`one viewer every 600 ms on a 100 ms path: ${asks} asks, ${v.total()} calls`, v.total() <= asks + 2);
}

/* identical asks at the same instant share one call */
{
  const v = vendor();
  const hub = createHub({ hours: () => true, name: 'proof-burst', fetch: v.fetch, ttl: () => TTL, refreshPerSec: 50 });
  await Promise.all(Array.from({ length: 200 }, () => hub.get('/news/headlines?page=0&limit=50')));
  await Promise.all(Array.from({ length: 200 }, () => hub.get('/news/headlines?limit=50&page=0')));
  check('400 simultaneous asks, two spellings: one vendor call', v.total() === 1, `${v.total()}`);
}

/* a failure is shown as one unless the caller allows the last good answer */
{
  let down = false;
  const v = vendor(() => (down ? 503 : 200));
  const strict = createHub({ hours: () => true, name: 'proof-strict', fetch: v.fetch, ttl: () => 50, refreshPerSec: 50 });
  const lenient = createHub({ hours: () => true, name: 'proof-lenient', fetch: v.fetch, ttl: () => 50, refreshPerSec: 50, keepOnFail: () => true });
  await strict.get('/q');
  await lenient.get('/q2');
  down = true;
  await sleep(200);
  /* the first ask after the outage may get the copy from a moment ago while the refresh runs; once that refresh
     has failed, the next ask sees the failure */
  await strict.get('/q');
  await sleep(60);
  const a = await strict.get('/q');
  await lenient.get('/q2');
  await sleep(60);
  const b = await lenient.get('/q2');
  check('once a refresh fails, the failure shows (no stale price passed off as live)', a.status === 503, `${a.status}`);
  check('keepOnFail keeps the last good answer', b.status === 200, `${b.status}`);
}

/* "no data" is an answer: kept, so viewers asking again do not each go to the vendor */
{
  const v = vendor(() => 472);
  const hub = createHub({ hours: () => true, name: 'proof-nodata', fetch: v.fetch, ttl: () => 10_000, refreshPerSec: 50 });
  for (let i = 0; i < 50; i++) await hub.get('/option/history/quote?date=20261028');
  check('a no-data answer is kept like any other', v.total() === 1, `${v.total()}`);
}

/* a viewer who has to wait on a background refresh moves it to the viewers' lane (once), so it is not stuck behind
   the other refreshes */
{
  let n = 0;
  const promoted = [];
  const hub = createHub({ hours: () => true,
    name: 'proof-promote',
    fetch: async (p) => {
      n += 1;
      await sleep(n === 1 ? 10 : 2_500);
      return { status: 200, body: Buffer.from(String(n)), type: 'text/plain' };
    },
    ttl: () => 50,
    refreshPerSec: 50,
    promote: (p) => promoted.push(p),
  });
  await hub.get('/slow');
  await sleep(80);
  await hub.get('/slow');
  await sleep(2_100);
  const [a, b] = await Promise.all([hub.get('/slow'), hub.get('/slow')]);
  check('a viewer joining a background refresh promotes it once', promoted.length === 1 && promoted[0] === '/slow', JSON.stringify(promoted));
  check('the joined refresh answers the viewers (no second vendor call)', n === 2 && String(a.body) === '2' && String(b.body) === '2', `calls ${n}`);
}

/* ---- market hours know the calendar ---- */
{
  delete process.env.SLAYER_HUB_HOURS;
  const at = (iso) => marketHours(Date.parse(iso));
  check('Thanksgiving 2026, 10:00 ET: closed', at('2026-11-26T15:00:00Z') === false);
  check('the day after Thanksgiving (early close), 12:00 ET: open', at('2026-11-27T17:00:00Z') === true);
  check('the day after Thanksgiving, 17:30 ET: closed (after-hours end at 17:00)', at('2026-11-27T22:30:00Z') === false);
  check('an ordinary Monday, 17:30 ET: open (after hours run to 20:00)', at('2026-11-30T22:30:00Z') === true);
  check('Good Friday 2029 (projected): closed', at('2029-03-30T15:00:00Z') === false);
}

/* ---- the popular-paths file: what is over is let go, and the file is always rewritten ---- */
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'hub-proof-'));
  const file = nodePath.join(dir, 'hub-pins.json');
  const now = Date.now();
  fs.writeFileSync(
    file,
    JSON.stringify([
      { p: '/stock/SPY/stock-state', at: now },
      { p: '/stock/SPY/spot-exposures/expiry-strike?expirations[]=2026-10-29&limit=500', at: now },
      { p: '/stock/SPY/greek-exposure/strike-expiry?expiry=2026-11-03', at: now },
      { p: '/stock/OLD/stock-state', at: now - 5 * 86_400_000 },
    ]),
  );
  let day = '2026-11-02';
  const v = vendor();
  const hub = createHub({ hours: () => true, name: 'proof-pins', file, today: () => day, fetch: v.fetch, ttl: () => 3_000, refreshPerSec: 50 });
  await sleep(700);
  const called = [...v.calls.keys()].sort();
  check(
    'only live pins are kept warm (no expired expiry, no pin idle for days)',
    called.join(' ') === '/stock/SPY/greek-exposure/strike-expiry?expiry=2026-11-03 /stock/SPY/stock-state',
    called.join(' '),
  );
  /* the next morning the 11-03 expiry is still live; the morning after it is over */
  day = '2026-11-04';
  await sleep(400);
  check('a pin whose expiry passes overnight is let go', !hub.pinned?.().some((k) => k.includes('2026-11-03')), JSON.stringify(hub.pinned?.()));
  /* nothing was asked twice this run: the file is still rewritten without what is over */
  hub.savePins?.();
  const kept = JSON.parse(fs.readFileSync(file, 'utf8')).map((x) => (typeof x === 'string' ? x : x.p));
  check('the pin file is rewritten without the expired and idle paths', kept.join(' ') === '/stock/SPY/stock-state', kept.join(' '));
  /* an old file of bare paths still loads */
  fs.writeFileSync(file, JSON.stringify(['/stock/QQQ/stock-state', '/stock/QQQ/oi-change?date=2020-01-03']));
  const v2 = vendor();
  createHub({ hours: () => true, name: 'proof-pins-old', file, today: () => day, fetch: v2.fetch, ttl: () => 3_000, refreshPerSec: 50 });
  await sleep(500);
  check('an old pin file of bare paths loads, minus the dated ones', [...v2.calls.keys()].join(' ') === '/stock/QQQ/stock-state', [...v2.calls.keys()].join(' '));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---- a status the caller marks as a fault is never kept (ThetaData's 474 during an outage) ---- */
{
  let down = true;
  const v = vendor(() => (down ? 474 : 200));
  const hub = createHub({ hours: () => true, name: 'proof-keepable', fetch: v.fetch, ttl: () => 60_000, refreshPerSec: 50, keepable: (s) => s === 200 || s === 472 });
  const a = await hub.get('/option/history/quote?date=20261028');
  down = false;
  const b = await hub.get('/option/history/quote?date=20261028');
  check('a 474 is not kept as the answer: the next ask after recovery reaches the terminal', a.status === 474 && b.status === 200, `${a.status} then ${b.status}`);
}

/* ---- the terminal's supervisor (theta/supervisor.mjs): a refused login is said once, and the jar gets only what it needs ---- */
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const { spawn } = await import('node:child_process');
  const run = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'theta-run-'));
  process.env.THETA_RUN_DIR = run;
  /* read when the module loads: nothing answers on port 9, so the stand-in terminal below is the only one */
  process.env.THETA_REST_BASE = 'http://127.0.0.1:9';
  const sup = await import('../theta/supervisor.mjs');

  const env = sup.childEnv?.({ PATH: '/bin', Path: 'C:\\x', JAVA_TOOL_OPTIONS: '-Dx=1', UNUSUAL_WHALES_API_KEY: 'uw', SUPABASE_SERVICE_ROLE_KEY: 's', THETA_RELAY_SECRET: 'r', STRIPE_SECRET_KEY: 'k' }, { THETADATA_API_KEY: 'td1' }) ?? { UNUSUAL_WHALES_API_KEY: 'uw' };
  check(
    'the jar gets PATH, Java options and its key, not the app\'s other keys',
    Object.keys(env).sort().join(' ') === 'JAVA_TOOL_OPTIONS PATH Path THETADATA_API_KEY',
    Object.keys(env).sort().join(' '),
  );
  check('the jar\'s refusal line is read as a failed login', !!sup.loginRefused?.('ERROR Invalid credentials. Please check your credentials file, API key, or environment variable, and try again.'));

  /* the lock: a live Node supervisor holds it while it refreshes the file; a PID left in a stale file does not */
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  const pidFile = nodePath.join(run, 'supervisor.pid');
  fs.writeFileSync(pidFile, String(holder.pid));
  const heldFresh = sup.lockHeld?.(pidFile);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(pidFile, old, old);
  const heldStale = sup.lockHeld?.(pidFile);
  holder.kill();
  fs.rmSync(pidFile, { force: true });
  check('the lock: held by a live supervisor that refreshes it, not by a PID in a file ten minutes stale', heldFresh === true && heldStale === false, `${heldFresh} / ${heldStale}`);

  if (process.platform !== 'win32') {
    /* a stand-in for java that prints the jar's refusal, records its environment and stays up */
    const fake = nodePath.join(run, 'fake-java.sh');
    fs.writeFileSync(fake, '#!/bin/sh\nenv > env.txt\necho "Picked up JAVA_TOOL_OPTIONS"\necho "[main] ERROR Invalid credentials. Please check your credentials file, API key, or environment variable, and try again."\nexec sleep 30\n');
    fs.chmodSync(fake, 0o755);
    const jar = nodePath.join(run, 'ThetaTerminalv3.jar');
    fs.writeFileSync(jar, '');
    Object.assign(process.env, { THETA_JAVA: fake, THETA_JAR: jar, THETADATA_API_KEY: 'td1_proof_wrong', THETA_REST_BASE: 'http://127.0.0.1:9', UNUSUAL_WHALES_API_KEY: 'uw-proof-secret' });
    const lines = [];
    const stop = sup.superviseTheta({ log: (m) => lines.push(m), warm: false });
    for (let i = 0; i < 40 && !lines.some((l) => /login failed/i.test(l)); i++) await sleep(200);
    await sleep(300);
    const said = lines.filter((l) => /ThetaData login failed: check THETADATA_API_KEY/.test(l)).length;
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(nodePath.join(run, 'state.json'), 'utf8')).state;
    } catch {
      /* none */
    }
    const childEnvText = fs.existsSync(nodePath.join(run, 'env.txt')) ? fs.readFileSync(nodePath.join(run, 'env.txt'), 'utf8') : '';
    check('a refused key: one clear line in the log within seconds', said === 1, lines.join(' | ').slice(0, 300));
    check('… the state says login_failed for the proxy to report', state === 'login_failed', String(state));
    check('… and the terminal is stopped, not restarted', !lines.slice(1).some((l) => /started terminal/.test(l)), lines.join(' | ').slice(0, 300));
    check('the terminal process never saw the Unusual Whales key', childEnvText.includes('THETADATA_API_KEY=td1_proof_wrong') && !childEnvText.includes('uw-proof-secret'), childEnvText ? 'env seen' : 'no env.txt');
    stop?.();
    for (const k of ['THETA_JAVA', 'THETA_JAR', 'THETADATA_API_KEY', 'THETA_REST_BASE', 'UNUSUAL_WHALES_API_KEY']) delete process.env[k];
  }
  delete process.env.THETA_RUN_DIR;
  fs.rmSync(run, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall hub checks passed');
process.exit(failed ? 1 : 0);
