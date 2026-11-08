/*
  The browser smoke test CI runs on the production build: it serves dist/ with the app's own server (server.ts), with no
  vendor keys and no terminal (every page shows its offline state), loads every route at a desktop and a phone size in
  Chromium, and fails on any console error or uncaught page error, any "NaN" or "undefined" in a page's text, or a page
  wider than its window (sideways overflow).
    npx vite build && node scripts/browser-smoke.mjs
  SMOKE_PORT moves the server (8199). SMOKE_ROUTES=/pulse,/terrain runs only those. SMOKE_CHROMIUM points at a
  Chromium other than Playwright's own (a machine without `npx playwright install chromium`).
*/

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT) || 8199;
const BASE = `http://127.0.0.1:${PORT}`;

/* every route a visitor can land on (src/App.tsx), a path parameter filled with a sample; the redirects are followed */
const ROUTES = [
  '/', '/products/pulse', '/products/dossier', '/products/pinpoint', '/products/trace', '/products/weigher', '/products/compass',
  '/products/terrain', '/products/practice', '/products/paper', '/products/backtest', '/products/journal',
  '/signin', '/checkout', '/terms', '/privacy',
  '/start', '/pulse', '/terrain', '/weigher',
  '/compass', '/compass/blotter', '/compass/tracker', '/compass/review', '/compass/study', '/compass/SPY-0DTE-smoke',
  '/practice/paper', '/practice/paper/smoke-account', '/practice/backtest', '/practice/backtest/smoke-session',
  '/practice/backtest/smoke-session/report', '/practice/journal', '/practice/journal/smoke-session/smoke-trade',
  '/dossier/news', '/dossier/earnings', '/dossier/earnings/NVDA', '/dossier/insiders', '/dossier/insiders/smoke-person',
  '/dossier/congress', '/dossier/congress/smoke-member', '/dossier/stocks', '/dossier/stocks/NVDA', '/dossier/institutions',
  '/dossier/institutions/smoke-house', '/dossier/shorts', '/dossier/shorts/NVDA', '/dossier/etfs', '/dossier/etfs/SPY',
  '/pinpoint/map', '/pinpoint/agenda', '/pinpoint/board', '/pinpoint/compare',
  '/trace/live-tape', '/trace/screener', '/trace/net-flow', '/trace/footprints', '/trace/watchers', '/trace/intervals',
  '/trace/odte', '/trace/multi-leg', '/trace/compare', '/trace/dark-pool', '/trace/tracker',
  '/settings', '/settings/account', '/settings/billing', '/settings/data', '/settings/appearance', '/settings/desk',
  '/settings/keyboard', '/settings/about',
  '/community', '/watchlist', '/alerts', '/notifications', '/help', '/status', '/changelog', '/report',
  '/no-such-page', '/pulse/no-such-room',
];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
/* a page is read once its text has held still this long (it keeps polling a feed that is offline), at most SETTLE_MAX */
const QUIET_MS = 1500;
const SETTLE_MAX_MS = 12_000;
const PARALLEL = 4;

const only = (process.env.SMOKE_ROUTES || '').split(',').map(s => s.trim()).filter(Boolean);
const routes = only.length ? only : ROUTES;

/* ---- the production server, keyless: no vendor key, no accounts, a terminal address that refuses ---- */
const env = { ...process.env, PORT: String(PORT), THETA_REST_BASE: 'http://127.0.0.1:9', EXPOSURE_RECORDER: '0', VOL_OUTLOOK: '0' };
for (const k of ['UNUSUAL_WHALES_API_KEY', 'THETA_RELAY_URL', 'THETA_RELAY_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) delete env[k];
const scratch = mkdtempSync(join(tmpdir(), 'slayer-smoke-'));
env.COMPASS_DIR = join(scratch, 'compass');
env.EXPOSURE_DIR = join(scratch, 'exposure');
env.VOL_OUTLOOK_DIR = join(scratch, 'vol');
env.THETA_RUN_DIR = join(scratch, 'theta');
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('browser-smoke: no dist/index.html — run `npx vite build` first');
  process.exit(2);
}
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => (serverLog += d));
server.stderr.on('data', d => (serverLog += d));
const exited = new Promise(r => server.on('exit', r));
/* the server writes its engine's record as it stops: the scratch folder goes once it has */
const stop = async () => {
  if (server.exitCode == null) {
    server.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
  }
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
};
process.on('exit', () => {
  if (server.exitCode == null) server.kill('SIGKILL');
});

const up = async () => {
  for (let i = 0; i < 240; i++) {
    if (server.exitCode != null) return false;
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
};
if (!(await up())) {
  console.error(`browser-smoke: the server did not start on ${BASE}\n${serverLog.slice(-2000)}`);
  process.exit(2);
}

/* ---- the pages ---- */
const browser = await chromium.launch(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
const failures = [];
let checked = 0;
let offlineAnswers = 0;

/* With no keys and no terminal the app's own data routes answer 503 ("live data offline"), and Chromium logs each as
   "Failed to load resource: … 503" — the browser's network line, not the page's. That one line, from those routes,
   is the expected offline state and is counted, not failed. Anything else is an error: a 503 from anywhere else, any
   other status (a missing script or asset), and everything the page itself logs or throws.
   /api/twobook/oi is the open-interest book (server/twoBookApi.mjs). With no Unusual Whales key it answers 503 the
   same way /api/uw does, and Pinpoint, Terrain, and the shell ask for it on load. */
const OFFLINE_ROUTE = /^\/api\/(uw|theta|compass|exposure|vol-outlook|logo|twobook)(\/|$)/;
const offlineLine = m => {
  if (!/^Failed to load resource: the server responded with a status of 503\b/.test(m.text())) return false;
  try {
    const u = new URL(m.location().url);
    return u.origin === BASE && OFFLINE_ROUTE.test(u.pathname);
  } catch {
    return false;
  }
};

/** One route at one size: what went wrong on it, or nothing */
async function visit(context, route, size) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (offlineLine(m)) offlineAnswers++;
    else errors.push(`console: ${m.text().slice(0, 200)}${m.location().url ? ` (${m.location().url.replace(BASE, '')})` : ''}`);
  });
  page.on('pageerror', e => errors.push(`page error: ${String(e).slice(0, 200)}`));
  const problems = [];
  try {
    const res = await page.goto(BASE + route, { waitUntil: 'load', timeout: 30_000 });
    if (!res || res.status() >= 400) problems.push(`HTTP ${res ? res.status() : 'no answer'}`);
    /* settled: the page's text unchanged for QUIET_MS, polled — not a fixed sleep */
    let last = '';
    let stillSince = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < SETTLE_MAX_MS) {
      const now = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      if (now !== last) {
        last = now;
        stillSince = Date.now();
      } else if (now && Date.now() - stillSince >= QUIET_MS) break;
      await page.waitForTimeout(150);
    }
    const read = await page.evaluate(() => ({
      text: document.body?.innerText ?? '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    const odd = read.text.match(/\bNaN\b|\bundefined\b/g);
    if (odd) {
      const at = read.text.search(/\bNaN\b|\bundefined\b/);
      problems.push(`${odd.length}× "${odd[0]}" in the text: …${read.text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' ')}…`);
    }
    if (read.overflow > 1) problems.push(`${read.overflow}px wider than the window`);
    if (!read.text.trim()) problems.push('blank page');
  } catch (e) {
    problems.push(`load: ${String(e).slice(0, 200)}`);
  }
  problems.push(...errors);
  await page.close();
  checked++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${size.name.padEnd(7)} ${route}${problems.length ? `\n       ${problems.join('\n       ')}` : ''}`);
  if (problems.length) failures.push({ route, size: size.name, problems });
}

for (const size of SIZES) {
  const { name, ...view } = size;
  const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, isMobile: view.isMobile, hasTouch: view.hasTouch, deviceScaleFactor: view.deviceScaleFactor });
  const queue = [...routes];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (queue.length) await visit(context, queue.shift(), size);
    }),
  );
  await context.close();
}
await browser.close();

console.log(`\nbrowser smoke: ${checked - failures.length} of ${checked} page loads clean (${routes.length} routes × ${SIZES.length} sizes); ${offlineAnswers} offline answers (503) from the data routes, as expected with no keys`);
await stop();
process.exit(failures.length ? 1 : 0);
