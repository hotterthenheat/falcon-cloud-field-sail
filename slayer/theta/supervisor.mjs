/*
  Keeps one ThetaData terminal running on 127.0.0.1:25503 for local development.
  Run it with `npm run theta` (any OS), or let `npm run dev` start it (THETA_AUTOSTART=0 turns that off).
  Setup and the download link: docs/theta-terminal.md.

  Invariants: one supervisor per checkout (run/supervisor.pid, its time refreshed every check so a PID the OS has
  since given to another program never holds the lock); a terminal it did not start is never touched, except the one
  an earlier supervisor of this checkout started and left behind (run/terminal.pid, a live java process), which it
  adopts and manages as its own; it only ever kills those; the API key reaches the jar through the child's
  environment, never argv, and the child gets only the variables Java needs (no other service's keys).

  What it knows about the terminal is written to run/state.json every check ({ state, at, pid, detail }), so the data
  proxy in another process (server/thetaProxy.mjs) can tell a failed login from a terminal that is merely down.
  States: starting, up, down, session_lost (another terminal holds the account), unauthenticated (the terminal
  answers 473), login_failed (its log says the key was refused).
*/

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
/* THETA_RUN_DIR moves the pid files, the log and the state file (the proof uses a temp folder) */
const RUN = process.env.THETA_RUN_DIR || path.join(HERE, 'run');
const SUPERVISOR_PID = path.join(RUN, 'supervisor.pid');
const TERMINAL_PID = path.join(RUN, 'terminal.pid');
const TERMINAL_OUT = path.join(RUN, 'terminal.out');
/** Where the supervisor writes what it knows about the terminal */
export const STATE_FILE = path.join(RUN, 'state.json');
const LOG_DIR = path.join(RUN, 'logs');
/* THETA_CONFIG and THETA_REST_BASE move the terminal together (the config's port and the URL the proxy calls) */
const CONFIG = process.env.THETA_CONFIG || path.join(HERE, 'config.toml');
const BASE = process.env.THETA_REST_BASE || 'http://127.0.0.1:25503';
/* a real market-data answer, so a terminal whose session was taken over reads as unhealthy, not as up */
const PROBE = `${BASE}/v3/stock/snapshot/quote?symbol=SPY&format=json`;
const CHECK_MS = 15_000;
/* the terminal's own output is read this often while it starts, so a refused key is reported within seconds */
const OUT_SCAN_MS = 2_000;
/* a supervisor that has not refreshed its pid file for this long is gone, whatever process now has its PID */
const LOCK_STALE_MS = 6 * CHECK_MS;
/* the names the warmer keeps hot (THETA_WARM to change them); indexes are asked for their price */
export const WARM = (process.env.THETA_WARM || 'SPY,QQQ,IWM,SPX,NDX,RUT,VIX').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const INDEXES = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX']);
export const warmPath = (s) => (INDEXES.has(s) ? `/index/snapshot/price?symbol=${s}&format=json` : `/stock/snapshot/quote?symbol=${s}&format=json`);
const BOOT_GRACE_MS = 60_000;
/* A ThetaData key holds one market-data session for two hours. Restart a few seconds before it ends, and only after
   the old terminal is dead — a second terminal on the same key is what knocks the session off. */
const SESSION_MS = 2 * 60 * 60 * 1000;
const RECYCLE_EARLY_MS = 8_000;
const BORN_FILE = path.join(RUN, 'terminal.born');
const MAX_BACKOFF_MS = 5 * 60_000;
/* a refused key is not tried again for 10 minutes, then 20, 40, up to an hour (a new key is tried at once) */
const LOGIN_BACKOFF_MS = 10 * 60_000;
const MAX_LOGIN_BACKOFF_MS = 60 * 60_000;

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
  const bundled = '/tmp/jdk21/jdk-21.0.13+9-jre/bin/java';
  if (fs.existsSync(bundled)) return bundled;
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

/** How the terminal logs in: the key (env first, then the app's untracked env files), else theta/creds.txt. `id` tells
    one key from another without keeping it. */
function credentials() {
  const key = process.env.THETADATA_API_KEY
    || keyFromFile(path.join(APP, '.env.local'))
    || keyFromFile(path.join(APP, '.env'))
    || keyFromFile(path.join(HERE, '.env'));
  if (key) return { env: { THETADATA_API_KEY: key }, args: [], id: createHash('sha256').update(key).digest('hex').slice(0, 12) };
  const creds = path.join(HERE, 'creds.txt');
  if (fs.existsSync(creds)) {
    let stamp = '';
    try {
      stamp = String(fs.statSync(creds).mtimeMs);
    } catch {
      /* read below anyway */
    }
    return { env: {}, args: ['--creds-file', creds], id: `file:${stamp}` };
  }
  return null;
}

/* What Java and the terminal need from the environment: the system's own variables (PATH, the temp and home folders,
   Windows' system folders), Java's options (a proxy or trust store set there) and the network proxy. Nothing else: the
   app's own keys (Unusual Whales, Supabase, the relay secret) never reach the jar. */
const CHILD_ENV = new Set([
  'PATH', 'PATHEXT', 'HOME', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'ALLUSERSPROFILE',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'OS', 'COMPUTERNAME',
  'JAVA_HOME', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
].map((k) => k.toUpperCase()));
/** The environment the jar is started with: CHILD_ENV from this process (names matched without case, as Windows
    does), plus the login */
export function childEnv(from = process.env, login = {}) {
  const out = {};
  for (const [k, v] of Object.entries(from)) if (v != null && CHILD_ENV.has(k.toUpperCase())) out[k] = v;
  return { ...out, ...login };
}

/** The terminal's own words for a refused key (the v3 jar's UserAuthenticator: "Invalid credentials. Please check your
    credentials file, API key, or environment variable, and try again.", and FPSS's INVALID_CREDENTIALS) */
export const loginRefused = (text) => /invalid credentials|INVALID_CREDENTIALS|credentials? (?:were |was )?(?:rejected|refused|not valid)/i.test(text);

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** The program a PID runs, lower case ('' when it cannot be told) */
function programOf(pid) {
  try {
    if (process.platform === 'linux') return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').toLowerCase();
    if (process.platform === 'win32') {
      return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 }).toLowerCase();
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5_000 }).toLowerCase();
  } catch {
    return '';
  }
}

const readPid = (file) => {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
};
const ageOf = (file) => {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
};

/** 'up', 'session_lost' (another terminal holds the account), 'unauthenticated' (it answers 473: not logged in), or
    'down' (nothing answers on the port). Any other answer is the terminal answering: up. */
async function health() {
  try {
    const r = await fetch(PROBE, { signal: AbortSignal.timeout(8_000) });
    if (r.ok) return 'up';
    const text = await r.text();
    if (/invalid session id/i.test(text)) return 'session_lost';
    if (r.status === 473 || /unauthenticated/i.test(text) || loginRefused(text)) return 'unauthenticated';
    return 'up';
  } catch {
    return 'down';
  }
}

/** Is the supervisor in the pid file still running? Its PID must be alive, the file refreshed within LOCK_STALE_MS
    (a PID the OS reused for another program after a crash does not refresh it), and where the OS says what the
    program is, it must be Node. */
export function lockHeld(file = SUPERVISOR_PID) {
  const holder = readPid(file);
  if (!holder || holder === process.pid || !alive(holder)) return false;
  if (ageOf(file) > LOCK_STALE_MS) return false;
  const prog = programOf(holder);
  return !prog || /node/.test(prog);
}

/** Take the one-per-checkout lock. A stale PID file (its process gone, or not refreshed) is replaced. */
function lock() {
  fs.mkdirSync(RUN, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(SUPERVISOR_PID, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lockHeld()) return false;
      fs.rmSync(SUPERVISOR_PID, { force: true });
    }
  }
  return false;
}

/* ---- what is known about the terminal, for this process (the relay) and others (the data proxy) ---- */
let known = { state: 'down', at: 0, pid: null, detail: '' };
/** The supervisor's view of the terminal in this process */
export const terminalState = () => known;
/** The supervisor's view from its state file (another process), or null when there is none or it is over a minute old */
export function readTerminalState(file = STATE_FILE) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s.state === 'string' && Date.now() - Number(s.at) < 60_000 ? s : null;
  } catch {
    return null;
  }
}
function note(state, pid, detail = '') {
  known = { state, at: Date.now(), pid: pid ?? null, detail };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(known));
  } catch {
    /* no run folder yet: next check */
  }
}

/**
 * Start supervising. Returns a stop function, or null when another supervisor holds the lock
 * or the machine cannot run the terminal (the reason is logged once).
 */
export function superviseTheta({ log = (m) => console.log(`[theta] ${m}`), warm = true } = {}) {
  if (process.env.VERCEL) return null;
  const jar = findJar();
  if (!jar) {
    log('terminal jar not found; see docs/theta-terminal.md (set THETA_JAR or put the v3 terminal jar in theta/lib/)');
    return null;
  }
  let login = credentials();
  if (!login) {
    log('THETADATA_API_KEY is not set and theta/creds.txt is missing; not starting the terminal');
    return null;
  }
  if (!lock()) {
    log('another supervisor is already running for this checkout');
    return null;
  }

  let child = null;
  /* a terminal an earlier supervisor of this checkout started and left running (it was killed hard) */
  let adopted = 0;
  let startedAt = 0;
  let misses = 0;
  let backoff = 5_000;
  let nextStart = 0;
  let stopped = false;
  /* set when this process asked the terminal to exit so a new two-hour session can open */
  let recycling = false;
  /* where this start's output begins in terminal.out, and the refused login, if any */
  let outFrom = 0;
  let refused = null;
  let loginBackoff = LOGIN_BACKOFF_MS;

  {
    const orphan = readPid(TERMINAL_PID);
    if (orphan && alive(orphan) && /java/.test(programOf(orphan))) {
      adopted = orphan;
      let born = 0;
      try { born = Number(fs.readFileSync(BORN_FILE, 'utf8')); } catch { born = 0; }
      startedAt = born > 0 ? born : Date.now();
      /* only what it writes from now on is read for a refused login (the file holds every earlier start too) */
      try {
        outFrom = fs.statSync(TERMINAL_OUT).size;
      } catch {
        outFrom = 0;
      }
      log(`adopting the terminal an earlier supervisor left running (pid ${orphan})`);
    } else if (orphan) fs.rmSync(TERMINAL_PID, { force: true });
  }

  const killAdopted = () => {
    if (!adopted) return;
    try {
      process.kill(adopted);
    } catch {
      /* already gone */
    }
    adopted = 0;
    fs.rmSync(TERMINAL_PID, { force: true });
  };

  /** New output of this start that says the key was refused: log it once and hold off */
  const scanOut = () => {
    if (refused || !(child || adopted)) return;
    let text = '';
    try {
      const fd = fs.openSync(TERMINAL_OUT, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const from = Math.max(outFrom, size - 256 * 1024);
        const buf = Buffer.alloc(Math.max(0, size - from));
        fs.readSync(fd, buf, 0, buf.length, from);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return;
    }
    if (!loginRefused(text)) return;
    refused = { id: login.id, until: Date.now() + loginBackoff };
    log(`ThetaData login failed: check THETADATA_API_KEY (the terminal says the credentials are invalid; see theta/run/terminal.out). Not trying this key again for ${Math.round(loginBackoff / 60_000)} min.`);
    loginBackoff = Math.min(MAX_LOGIN_BACKOFF_MS, loginBackoff * 2);
    note('login_failed', child?.pid ?? adopted, 'invalid credentials');
    /* a terminal that cannot log in only keeps asking the login server: stop it */
    if (child) child.kill();
    killAdopted();
  };

  const start = () => {
    login = credentials() ?? login;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      outFrom = fs.statSync(TERMINAL_OUT).size;
    } catch {
      outFrom = 0;
    }
    const out = fs.openSync(TERMINAL_OUT, 'a');
    child = spawn(findJava(), ['-jar', jar, '--config', CONFIG, '--log-directory', LOG_DIR, ...login.args], {
      cwd: RUN,
      env: childEnv(process.env, login.env),
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
    fs.closeSync(out);
    startedAt = Date.now();
    try { fs.writeFileSync(BORN_FILE, String(startedAt)); } catch { /* the next adopt uses now */ }
    misses = 0;
    fs.writeFileSync(TERMINAL_PID, String(child.pid ?? ''));
    note('starting', child.pid);
    log(`started terminal (pid ${child.pid})`);
    const mine = child;
    mine.on('error', (e) => {
      log(`could not start java (${e.code || e.message}); install Java 21 or set THETA_JAVA`);
    });
    mine.on('exit', (code, signal) => {
      if (child === mine) {
        scanOut();
        child = null;
        fs.rmSync(TERMINAL_PID, { force: true });
        if (!stopped && !refused) log(`terminal exited (${signal || code}); next start in ${Math.round(backoff / 1000)}s`);
        nextStart = Date.now() + backoff;
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
        if (recycling && !stopped && !refused) {
          recycling = false;
          backoff = 5_000;
          nextStart = 0;
          log('previous session closed; opening a new two-hour session');
          start();
        }
      }
    });
  };

  let lastState = 'down';
  let lostTicks = 0;
  const tick = async () => {
    if (stopped) return;
    /* the lock's heartbeat: a supervisor that stops refreshing it is gone */
    try {
      const t = new Date();
      fs.utimesSync(SUPERVISOR_PID, t, t);
    } catch {
      /* removed by hand: the next start takes it again */
    }
    if (adopted && !alive(adopted)) {
      adopted = 0;
      fs.rmSync(TERMINAL_PID, { force: true });
    }
    scanOut();
    if (refused) {
      const now = credentials();
      if (now && now.id !== refused.id) {
        log('the ThetaData key changed; starting the terminal with the new one');
        refused = null;
        nextStart = 0;
        login = now;
      } else if (Date.now() < refused.until) {
        note('login_failed', null, 'invalid credentials');
        return;
      } else refused = null;
    }
    const state = await health();
    lastState = state;
    const running = child?.pid ?? (adopted || null);
    if (state === 'up') {
      misses = 0;
      lostTicks = 0;
      if ((child || adopted) && Date.now() - startedAt > BOOT_GRACE_MS) {
        backoff = 5_000;
        loginBackoff = LOGIN_BACKOFF_MS;
      }
      note('up', running);
      /* one session, two hours, then a clean restart a few seconds before it would die */
      if (startedAt && Date.now() - startedAt >= SESSION_MS - RECYCLE_EARLY_MS) {
        const left = Math.max(0, Math.round((SESSION_MS - (Date.now() - startedAt)) / 1000));
        log(`two-hour session ends in ${left}s; restarting the terminal for a new session`);
        recycling = true;
        backoff = 5_000;
        if (child) child.kill();
        else {
          killAdopted();
          nextStart = 0;
        }
      }
      return;
    }
    if (state === 'session_lost' || state === 'unauthenticated') {
      /* Do not kill it. A restart logs in again, the other session answers UNAUTHENTICATED, and the two
         take turns throwing each other off. The terminal reconnects on its own. */
      lostTicks += 1;
      note(state, running);
      if (lostTicks === 4) {
        log(state === 'session_lost'
          ? 'session lost; leaving this terminal up so it can reconnect. A second terminal on this account is what knocks it off.'
          : 'the terminal answers but is not logged in (473); leaving it up to reconnect. If this lasts, check THETADATA_API_KEY and that no other terminal uses the account.');
      }
      return;
    }
    if (child || adopted) {
      note(Date.now() - startedAt < BOOT_GRACE_MS ? 'starting' : 'down', running);
      if (Date.now() - startedAt < BOOT_GRACE_MS) return;
      misses += 1;
      if (misses >= 3) {
        log(`terminal (pid ${running}) stopped answering; restarting it`);
        if (child) child.kill();
        else {
          killAdopted();
          nextStart = Date.now() + backoff;
        }
      }
      return;
    }
    note('down', null);
    if (Date.now() >= nextStart) start();
  };

  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref?.();
  /* while a start is young, its output is read every two seconds for a refused login */
  const outTimer = setInterval(() => {
    if ((child || adopted) && Date.now() - startedAt < BOOT_GRACE_MS * 2) scanOut();
  }, OUT_SCAN_MS);
  outTimer.unref?.();
  void tick();
  /* the warmer: a quote for each hot name every 15 s keeps the market-data connection and the JVM hot, so the first
     request after a quiet spell is as fast as the rest. It warms a terminal started by hand too; the relay warms
     through its own cache and turns this off. */
  const warmTimer = warm
    ? setInterval(() => {
        if (lastState !== 'up') return;
        for (const s of WARM) void fetch(`${BASE}/v3${warmPath(s)}`, { signal: AbortSignal.timeout(8_000) }).then((r) => r.arrayBuffer(), () => null);
      }, CHECK_MS)
    : null;
  warmTimer?.unref?.();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearInterval(outTimer);
    if (warmTimer) clearInterval(warmTimer);
    if (child) child.kill();
    killAdopted();
    if (readPid(SUPERVISOR_PID) === process.pid) fs.rmSync(SUPERVISOR_PID, { force: true });
    fs.rmSync(STATE_FILE, { force: true });
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
