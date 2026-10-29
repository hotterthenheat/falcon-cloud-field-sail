/*
  Keeps one ThetaData terminal running on 127.0.0.1:25503 for local development.
  Run it with `npm run theta` (any OS), or let `npm run dev` start it (THETA_AUTOSTART=0 turns that off).
  Setup and the download link: docs/theta-terminal.md.

  Invariants: one supervisor per checkout (run/supervisor.pid); a terminal it did not start is never touched;
  it only ever kills the PID it spawned; the API key reaches the jar through the child's environment, never argv.
*/

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const RUN = path.join(HERE, 'run');
const SUPERVISOR_PID = path.join(RUN, 'supervisor.pid');
const TERMINAL_PID = path.join(RUN, 'terminal.pid');
const LOG_DIR = path.join(RUN, 'logs');
/* THETA_CONFIG and THETA_REST_BASE move the terminal together (the config's port and the URL the proxy calls) */
const CONFIG = process.env.THETA_CONFIG || path.join(HERE, 'config.toml');
const PROBE = `${process.env.THETA_REST_BASE || 'http://127.0.0.1:25503'}/v3/calendar/today`;
const CHECK_MS = 15_000;
const BOOT_GRACE_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** The jar: THETA_JAR, else the newest theta/lib/*.jar, else theta/ThetaTerminalv3.jar. */
export function findJar() {
  if (process.env.THETA_JAR) return fs.existsSync(process.env.THETA_JAR) ? process.env.THETA_JAR : null;
  try {
    const jars = fs.readdirSync(path.join(HERE, 'lib')).filter((n) => n.endsWith('.jar')).sort();
    if (jars.length) return path.join(HERE, 'lib', jars[jars.length - 1]);
  } catch {
    /* no lib/ */
  }
  const boot = path.join(HERE, 'ThetaTerminalv3.jar');
  return fs.existsSync(boot) ? boot : null;
}

function findJava() {
  if (process.env.THETA_JAVA) return process.env.THETA_JAVA;
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin', exe);
    if (fs.existsSync(bin)) return bin;
  }
  return exe;
}

function keyFromFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*THETADATA_API_KEY\s*=\s*["']?([^"'\s#]+)/);
      if (m) return m[1];
    }
  } catch {
    /* no such file */
  }
  return '';
}

/** How the terminal logs in: the key (env first, then the app's untracked env files), else theta/creds.txt. */
function credentials() {
  const key = process.env.THETADATA_API_KEY
    || keyFromFile(path.join(APP, '.env.local'))
    || keyFromFile(path.join(APP, '.env'))
    || keyFromFile(path.join(HERE, '.env'));
  if (key) return { env: { THETADATA_API_KEY: key }, args: [] };
  const creds = path.join(HERE, 'creds.txt');
  if (fs.existsSync(creds)) return { env: {}, args: ['--creds-file', creds] };
  return null;
}

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const readPid = (file) => {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
};

/** Does anything answer HTTP on the terminal's port? Any status counts: the port belongs to a terminal. */
async function answering() {
  try {
    await fetch(PROBE, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

/** Take the one-per-checkout lock. A stale PID file (its process gone) is replaced. */
function lock() {
  fs.mkdirSync(RUN, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(SUPERVISOR_PID, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readPid(SUPERVISOR_PID);
      if (holder && holder !== process.pid && alive(holder)) return false;
      fs.rmSync(SUPERVISOR_PID, { force: true });
    }
  }
  return false;
}

/**
 * Start supervising. Returns a stop function, or null when another supervisor holds the lock
 * or the machine cannot run the terminal (the reason is logged once).
 */
export function superviseTheta({ log = (m) => console.log(`[theta] ${m}`) } = {}) {
  if (process.env.VERCEL) return null;
  const jar = findJar();
  if (!jar) {
    log('terminal jar not found; see docs/theta-terminal.md (set THETA_JAR or put it in theta/lib/)');
    return null;
  }
  const login = credentials();
  if (!login) {
    log('THETADATA_API_KEY is not set and theta/creds.txt is missing; not starting the terminal');
    return null;
  }
  if (!lock()) {
    log('another supervisor is already running for this checkout');
    return null;
  }

  let child = null;
  let startedAt = 0;
  let misses = 0;
  let backoff = 5_000;
  let nextStart = 0;
  let stopped = false;

  const start = () => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const out = fs.openSync(path.join(RUN, 'terminal.out'), 'a');
    child = spawn(findJava(), ['-jar', jar, '--config', CONFIG, '--log-directory', LOG_DIR, ...login.args], {
      cwd: RUN,
      env: { ...process.env, ...login.env },
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
    fs.closeSync(out);
    startedAt = Date.now();
    misses = 0;
    fs.writeFileSync(TERMINAL_PID, String(child.pid ?? ''));
    log(`started terminal (pid ${child.pid})`);
    const mine = child;
    mine.on('error', (e) => {
      log(`could not start java (${e.code || e.message}); install Java 21 or set THETA_JAVA`);
    });
    mine.on('exit', (code, signal) => {
      if (child === mine) {
        child = null;
        fs.rmSync(TERMINAL_PID, { force: true });
        if (!stopped) log(`terminal exited (${signal || code}); next start in ${Math.round(backoff / 1000)}s`);
        nextStart = Date.now() + backoff;
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      }
    });
  };

  const tick = async () => {
    if (stopped) return;
    const up = await answering();
    if (up) {
      misses = 0;
      if (child && Date.now() - startedAt > BOOT_GRACE_MS) backoff = 5_000;
      return;
    }
    if (child) {
      if (Date.now() - startedAt < BOOT_GRACE_MS) return;
      misses += 1;
      if (misses >= 3) {
        log(`terminal (pid ${child.pid}) stopped answering; restarting it`);
        child.kill();
      }
      return;
    }
    if (Date.now() >= nextStart) start();
  };

  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref?.();
  void tick();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (child) child.kill();
    if (readPid(SUPERVISOR_PID) === process.pid) fs.rmSync(SUPERVISOR_PID, { force: true });
  };
  process.once('exit', stop);
  return stop;
}

/* `node theta/supervisor.mjs`: supervise in the foreground until Ctrl+C. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const stop = superviseTheta();
  if (!stop) process.exit(1);
  const keep = setInterval(() => {}, 1 << 30);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      clearInterval(keep);
      stop();
      process.exit(0);
    });
  }
}
