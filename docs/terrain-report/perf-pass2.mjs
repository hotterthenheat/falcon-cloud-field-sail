/**
 * Second pass: 1-minute panes, a Chrome trace of a tick burst, and a
 * production-build open. Does not modify the app.
 */
import pkg from '/workspace/slayer/node_modules/playwright/index.js';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const { chromium } = pkg;
const DEV = 'http://127.0.0.1:8080';
const PREVIEW = 'http://127.0.0.1:8081';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function book(ticker, base, step) {
  const bars = [];
  let px = base;
  const start = Date.parse('2026-10-26T04:00:00-04:00');
  for (let i = 0; i < 1000; i++) {
    const seed = ((hash(ticker) + i * 17) % 1000) / 1000;
    const drift = Math.sin(i / 40) * base * 0.00022 + (seed - 0.48) * step * 0.08;
    const open = px;
    px = Math.max(step, px + drift);
    bars.push({
      start_time: new Date(start + i * 60_000).toISOString(),
      end_time: new Date(start + (i + 1) * 60_000).toISOString(),
      market_time: 'r',
      open: open.toFixed(2), high: Math.max(open, px).toFixed(2),
      low: Math.min(open, px).toFixed(2), close: px.toFixed(2),
      volume: 50000 + (i % 50) * 1000,
    });
  }
  const strikes = [];
  for (let k = -14; k <= 14; k++) {
    const strike = Math.round((base + k * step) * 100) / 100;
    const call = Math.exp(-(k * k) / 28) * 8000;
    const put = Math.exp(-(k * k) / 28) * 7000;
    strikes.push({ strike, call_gex: call.toFixed(2), put_gex: put.toFixed(2), call_delta: '1', put_delta: '1', call_oi: 1000, put_oi: 1000, call_vanna: '1', put_vanna: '1', call_charm: '1', put_charm: '1' });
  }
  return { bars, strikes, last: px, open: base, iv: 0.16 };
}
const BOOKS = {
  SPY: book('SPY', 455, 5), QQQ: book('QQQ', 442, 5), AAPL: book('AAPL', 190, 2.5), NVDA: book('NVDA', 120, 1),
};
function pane(ticker) {
  return {
    ticker, tabs: [ticker], timeframe: '1m',
    overlays: { trails: true, levels: true, darkpool: false, volume: true, flow: false, netDrift: false, volDrift: false, dexStrike: false, session: false, cone: true, events: false, alerts: false },
    indicators: { ema9: false, ema21: false, ema50: false, vwap: false, bb: false, vwapBands: false, sma: false, rsi: false, macd: false, atrPane: false },
    chartStyle: 'candles', clock: 'time', compares: [], priceScale: 'normal', sessionOr: 15, ladder: false, lane: 'size', link: null,
  };
}
function cfg(layout) {
  return { layout, panes: ['SPY', 'QQQ', 'AAPL', 'NVDA'].slice(0, 4).map(pane), setups: {}, palette: 'thermal', railCut: 'book' };
}
async function routeUw(page) {
  await page.route('**/api/uw/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/uw/, '');
    const m = p.match(/^\/stock\/([^/]+)\/(.+)$/);
    const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : 'SPY';
    const rest = m ? m[2] : '';
    const b = BOOKS[ticker] ?? BOOKS.SPY;
    if (rest.startsWith('spot-exposures')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    let body = [];
    if (rest.startsWith('stock-state')) body = { close: b.last, open: b.open, prev_close: b.open, high: b.last, low: b.open, market_time: 'regular', tape_time: '2026-10-26T20:00:00.000Z' };
    else if (rest.startsWith('ohlc/')) body = b.bars;
    else if (rest.startsWith('greek-exposure/strike')) body = b.strikes;
    else if (rest.startsWith('greek-exposure/expiry')) body = [{ expiry: '2026-10-30', dte: 4 }];
    else if (rest.startsWith('iv-rank')) body = [{ date: '2026-10-26', volatility: b.iv, iv_rank_1y: 42 }];
    else if (rest.startsWith('volatility/term-structure')) body = [{ expiry: '2026-10-30', volatility: b.iv, implied_move_perc: 0.012 }];
    else if (rest.startsWith('interpolated-iv')) body = [{ days: 1, volatility: b.iv, implied_move_perc: 0.008 }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
  });
}
function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: arr.length, p50: Math.round(q(0.5) * 100) / 100, p95: Math.round(q(0.95) * 100) / 100, max: Math.round(s.at(-1) * 100) / 100, over32: arr.filter(x => x > 32.5).length, over50: arr.filter(x => x > 50).length };
}
async function framesDuring(page, work) {
  await page.evaluate(() => {
    window.__d = [];
    let last = 0;
    const loop = now => { if (last) window.__d.push(now - last); last = now; window.__raf = requestAnimationFrame(loop); };
    window.__raf = requestAnimationFrame(loop);
  });
  await work();
  return page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__d; });
}
async function pan(page) {
  const b = await page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 100) continue;
      if (!best || r.width * r.height > best.w * best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return best;
  });
  if (!b) return;
  const x = b.x + b.w * 0.6, y = b.y + b.h * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(x - i * 16, y);
  await page.mouse.up();
}
async function zoom(page) {
  const b = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].map(el => el.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return c ? { x: c.x + c.width / 2, y: c.y + c.height / 2 } : null;
  });
  if (!b) return;
  await page.mouse.move(b.x, b.y);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -160); await page.waitForTimeout(40); }
}

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const out = { oneMinute: [], trace: null, preview: null };

async function openDev(layout) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await routeUw(page);
  await page.addInitScript(stored => {
    localStorage.setItem('slayer_terrain_v1', JSON.stringify(stored));
    const orig = window.setInterval.bind(window);
    window.__intervals = [];
    window.setInterval = (fn, ms, ...rest) => {
      const id = orig(fn, ms, ...rest);
      try { window.__intervals.push({ ms: Number(ms), fn }); } catch { /* ignore */ }
      return id;
    };
  }, cfg(layout));
  const t0 = Date.now();
  await page.goto(DEV + '/terrain', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(n => [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 140).length >= n, layout, { timeout: 25000 });
  await page.waitForTimeout(2000);
  const bars = await page.evaluate(() => document.body.innerText.includes('1m'));
  const panD = await framesDuring(page, () => pan(page));
  const zoomD = await framesDuring(page, () => zoom(page));
  out.oneMinute.push({ layout, openMs: Date.now() - t0, saw1m: bars, pan: stats(panD), zoom: stats(zoomD) });
  console.log('1m', layout, JSON.stringify(out.oneMinute.at(-1)));
  return page;
}

try {
  const page = await openDev(1);
  await page.close();
  const page4 = await openDev(4);

  const client = await page4.context().newCDPSession(page4);
  const events = [];
  client.on('Tracing.dataCollected', e => { for (const ev of e.value) events.push(ev); });
  const done = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
    options: 'sampling-frequency=2000',
  });
  await page4.evaluate(async () => {
    const hits = (window.__intervals || []).filter(i => i.ms === 1500 && typeof i.fn === 'function');
    const fn = hits.length ? hits[hits.length - 1].fn : null;
    const t0 = performance.now();
    await new Promise(resolve => {
      const step = () => {
        if (fn) fn();
        if (performance.now() - t0 > 1600) resolve();
        else setTimeout(step, 20);
      };
      step();
    });
  });
  await client.send('Tracing.end');
  await done;
  const tasks = events.filter(e => e.name === 'RunTask' && e.ph === 'X' && e.dur > 16000);
  tasks.sort((a, b) => b.dur - a.dur);
  const frames = events.filter(e => e.name === 'BeginFrame');
  out.trace = {
    events: events.length,
    runTasksOver16ms: tasks.length,
    worst: tasks.slice(0, 8).map(t => ({ ms: Math.round(t.dur / 1000), name: t.name })),
    beginFrames: frames.length,
  };
  console.log('TRACE', JSON.stringify(out.trace));
  await page4.close();

  // production preview
  const ok = await fetch(PREVIEW + '/').then(r => r.status).catch(() => 0);
  out.preview = { up: ok };
  if (ok === 200) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await ctx.newPage();
    await routeUw(p);
    await p.addInitScript(stored => { localStorage.setItem('slayer_terrain_v1', JSON.stringify(stored)); }, cfg(4));
    const t0 = Date.now();
    await p.goto(PREVIEW + '/terrain', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const dcl = Date.now() - t0;
    let canvasMs = null;
    try {
      await p.waitForFunction(() => [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 140).length >= 4, null, { timeout: 30000 });
      canvasMs = Date.now() - t0;
    } catch { canvasMs = null; }
    const nav = await p.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const res = performance.getEntriesByType('resource').filter(r => r.name.includes('.js'));
      const jsBytes = res.reduce((a, r) => a + (r.transferSize || 0), 0);
      const jsDecoded = res.reduce((a, r) => a + (r.decodedBodySize || 0), 0);
      return {
        dcl: n?.domContentLoadedEventEnd, load: n?.loadEventEnd,
        jsFiles: res.length, jsTransfer: jsBytes, jsDecoded,
      };
    });
    const t1 = Date.now();
    await p.reload({ waitUntil: 'domcontentloaded' });
    let warm = null;
    try {
      await p.waitForFunction(() => [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 140).length >= 4, null, { timeout: 30000 });
      warm = Date.now() - t1;
    } catch { warm = null; }
    out.preview = { up: ok, coldCanvasMs: canvasMs, coldDcl: dcl, warmCanvasMs: warm, nav };
    console.log('PREVIEW', JSON.stringify(out.preview));
    await ctx.close();
  }
} finally {
  await browser.close();
}
await writeFile('/workspace/docs/terrain-report/perf/pass2.json', JSON.stringify(out, null, 2));
console.log('WROTE pass2');
