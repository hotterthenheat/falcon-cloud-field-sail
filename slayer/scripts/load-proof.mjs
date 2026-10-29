/*
  Shows that viewers do not multiply vendor calls. Opens the same pages in N separate browsers at once and reads the
  data hub's counts (server/hub.mjs) over the steady part of the run: what the viewers asked the server for, and the
  Unusual Whales and ThetaData calls that took behind them.

    node scripts/load-proof.mjs                          1 viewer, then 5, on the default pages
    node scripts/load-proof.mjs --viewers 1,10 --seconds 90 --pages /trace/live-tape,/pulse
    BASE=http://127.0.0.1:8080 (default)                  the running dev server (`npm run dev`)
*/

import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const VIEWERS = arg('viewers', '1,5').split(',').map(Number);
const SECONDS = Number(arg('seconds', '75'));
const WARM = 25;
const PAGES = arg('pages', '/trace/live-tape,/pulse,/dossier/news').split(',');

const hubs = async () => {
  const read = async (p) => {
    try {
      return await (await fetch(`${BASE}${p}`)).json();
    } catch {
      return {};
    }
  };
  return { uw: await read('/api/uw/__hub'), theta: await read('/api/theta/__hub') };
};
const diff = (a, b) => ({
  asks: (b.asks ?? 0) - (a.asks ?? 0),
  vendor: (b.upstreamViewer ?? 0) + (b.upstreamRefresh ?? 0) - (a.upstreamViewer ?? 0) - (a.upstreamRefresh ?? 0),
  waited: (b.waited ?? 0) - (a.waited ?? 0),
});

async function run(n) {
  /* PW_CHROMIUM points at a browser Playwright did not download itself */
  const exe = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const tabs = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    for (const p of PAGES) {
      const page = await ctx.newPage();
      void page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
      tabs.push(page);
    }
  }
  /* let every viewer load, then measure the steady state: what keeping the pages live costs */
  await new Promise((r) => setTimeout(r, WARM * 1000));
  const a = await hubs();
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const b = await hubs();
  await browser.close();
  return { uw: diff(a.uw, b.uw), theta: diff(a.theta, b.theta) };
}

console.log(`pages: ${PAGES.join(' ')} · measured over ${SECONDS}s after a ${WARM}s load\n`);
console.log('viewers'.padEnd(9), 'asked server'.padStart(13), 'UW calls'.padStart(10), 'UW/min'.padStart(8), 'Theta calls'.padStart(12), 'Theta/min'.padStart(10));
for (const n of VIEWERS) {
  const r = await run(n);
  const per = (x) => ((x / SECONDS) * 60).toFixed(1);
  console.log(String(n).padEnd(9), String(r.uw.asks + r.theta.asks).padStart(13), String(r.uw.vendor).padStart(10), per(r.uw.vendor).padStart(8), String(r.theta.vendor).padStart(12), per(r.theta.vendor).padStart(10));
}
