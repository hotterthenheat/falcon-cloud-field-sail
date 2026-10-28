/*
  ThetaData v3 proxy. The browser calls /api/theta/* and this forwards
  the path to the local terminal at http://127.0.0.1:25503/v3/*.
  Stocks, options, indices, the session calendar, and Treasury rates only.
  Identical in-flight GETs share one call. Snapshots are kept 15s;
  a calendar or a rate is kept 300s.

  The terminal is a separate process (java -jar ThetaTerminalv3.jar).
  If nothing is listening, this says why, and starts the jar only when
  Java 21+ and a key or creds.txt are actually on the machine.
*/

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const JAR = process.env.THETA_JAR || path.join(HERE, '..', 'theta', 'ThetaTerminalv3.jar');
const CREDS = path.join(path.dirname(JAR), 'creds.txt');
const LOG = path.join(path.dirname(JAR), 'terminal.log');

function javaBin() {
  if (process.env.THETA_JAVA && fs.existsSync(process.env.THETA_JAVA)) return process.env.THETA_JAVA;
  const bundled = path.join(path.dirname(JAR), 'jdk', 'bin', 'java');
  if (fs.existsSync(bundled)) return bundled;
  return 'java';
}

function javaHome() {
  const bin = javaBin();
  if (bin.endsWith(`${path.sep}bin${path.sep}java`)) return path.dirname(path.dirname(bin));
  return '';
}

function childEnv(key) {
  const home = javaHome();
  const pathEnv = home
    ? `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH;
  return {
    ...process.env,
    ...(key ? { THETADATA_API_KEY: key } : {}),
    ...(home ? { JAVA_HOME: home } : {}),
    ...(pathEnv ? { PATH: pathEnv } : {}),
  };
}

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
let booting = false;

const ttlFor = (p) => {
  const path = p.split('?')[0];
  if (/^\/(calendar|interest_rate)\//.test(path)) return 300_000;
  if (/\/history\//.test(path)) return 15_000;
  return 1_000;
};
const allowed = (p) => p.length < 500 && !p.includes('..') && ALLOWED.some((re) => re.test(p));

const send = (res, status, body, type = 'application/json') => {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(typeof body === 'string' ? body : body);
};

function readKeyFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*THETADATA_API_KEY\s*=\s*"?([^"\s#]+)"?/);
      if (m) return m[1];
    }
    const one = text.trim();
    if (/^td1_[A-Za-z0-9]+$/.test(one)) return one;
  } catch {
    /* no file */
  }
  return '';
}

/** The key on disk beats the process env. Vite loads .env.local over .env, and that file can hold a dead key. */
function apiKey() {
  const dir = path.dirname(JAR);
  return readKeyFile(path.join(dir, '.env'))
    || readKeyFile(path.join(HERE, '..', '.env'))
    || process.env.THETADATA_API_KEY
    || readKeyFile(CREDS)
    || '';
}

/** The bootstrap jar rejects a good key. The current terminal jar in lib/ accepts --api-key. */
function terminalJar() {
  const lib = path.join(path.dirname(JAR), 'lib');
  try {
    const jars = fs.readdirSync(lib).filter((n) => n.endsWith('.jar')).sort();
    if (jars.length) return path.join(lib, jars[jars.length - 1]);
  } catch {
    /* bootstrap */
  }
  return JAR;
}

function javaMajor() {
  const out = spawnSync(javaBin(), ['-version'], { encoding: 'utf8' });
  const text = `${out.stdout || ''}\n${out.stderr || ''}`;
  const m = text.match(/version "(?:1\.)?(\d+)/);
  return m ? Number(m[1]) : 0;
}

function downReason() {
  const major = javaMajor();
  const jar = fs.existsSync(JAR);
  const key = Boolean(apiKey());
  const java = major >= 21 ? `Java ${major}` : `Java ${major || 'missing'} (the terminal needs 21)`;
  if (!jar && !key) {
    return `${java}. ThetaTerminalv3.jar is not installed and THETADATA_API_KEY is not set, so nothing is listening on port 25503.`;
  }
  if (!jar) return `${java}. The Theta terminal jar is not on this machine, so port 25503 is closed.`;
  if (major < 21) {
    const auth = key ? '' : ' THETADATA_API_KEY is not set either, so there is nothing to log in with once Java is 21.';
    return `${java}. The jar is on disk, but it cannot start on this runtime.${auth}`;
  }
  if (!key) return `${java}. The jar is here, but THETADATA_API_KEY is not set, so the terminal was not started.`;
  return 'The Theta terminal was started and has not opened port 25503 yet.';
}

function tryStart() {
  if (booting) return;
  booting = true;
  const child = spawn('sh', [path.join(path.dirname(JAR), 'keep-up.sh')], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  child.on('exit', () => {
    booting = false;
  });
}

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
  let reqPath = req.url || '/';
  reqPath = reqPath.replace(/^\/api\/theta/, '') || '/';
  if (!reqPath.startsWith('/')) reqPath = `/${reqPath}`;
  if (!allowed(reqPath)) {
    send(res, 404, JSON.stringify({ error: 'not found' }));
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
    tryStart();
    send(res, 503, JSON.stringify({ error: `Theta terminal is not running. ${downReason()}`, code: 'terminal_down' }));
  }
}
