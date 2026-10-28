/** Exposure-node shots. Does not modify the app. */
import pkg from '/workspace/slayer/node_modules/playwright/index.js';
import path from 'node:path';
const { chromium } = pkg;
const OUT = '/workspace/docs/terrain-report/screenshots';
const BASE = 'http://127.0.0.1:8080';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function book(ticker, base, step) {
  const bars = [];
  let px = base;
  const start = Date.parse('2026-10-26T09:30:00-04:00');
  for (let i = 0; i < 390; i++) {
    const seed = ((hash(ticker) + i * 17) % 1000) / 1000;
    const drift = Math.sin(i / 22) * base * 0.0004 + (seed - 0.48) * step * 0.12;
    const open = px;
    px = Math.max(step, px + drift);
    bars.push({
      start_time: new Date(start + i * 60_000).toISOString(),
      end_time: new Date(start + (i + 1) * 60_000).toISOString(),
      market_time: 'r',
      open: open.toFixed(2), high: (Math.max(open, px) + step * 0.04).toFixed(2),
      low: (Math.min(open, px) - step * 0.04).toFixed(2), close: px.toFixed(2),
      volume: 80000 + (i % 40) * 2000,
    });
  }
  const strikes = [];
  for (let k = -12; k <= 12; k++) {
    const strike = Math.round((base + k * step) * 100) / 100;
    const call = Math.exp(-(k * k) / (k >= 0 ? 18 : 60)) * (k >= 0 ? 12000 : 2200);
    const put = Math.exp(-(k * k) / (k <= 0 ? 18 : 60)) * (k <= 0 ? 11000 : 1800);
    strikes.push({
      strike, call_gex: call.toFixed(2), put_gex: put.toFixed(2),
      call_delta: (call * 0.3).toFixed(2), put_delta: (put * 0.3).toFixed(2),
      call_oi: Math.round(call * 8), put_oi: Math.round(put * 8),
      call_vanna: (call * 0.02).toFixed(2), put_vanna: (put * 0.02).toFixed(2),
      call_charm: (call * 0.01).toFixed(2), put_charm: (put * 0.01).toFixed(2),
    });
  }
  return { bars, strikes, last: px, open: base, iv: 0.16 };
}
const B = book('SPY', 455, 5);
async function route(page) {
  await page.route('**/api/uw/**', async route => {
    const rest = new URL(route.request().url()).pathname.replace(/^\/api\/uw\/stock\/[^/]+\//, '');
    if (rest.startsWith('spot-exposures')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    let body = [];
    if (rest.startsWith('stock-state')) body = { close: B.last, open: B.open, prev_close: B.open, high: B.last, low: B.open, market_time: 'regular', tape_time: '2026-10-26T20:00:00.000Z' };
    else if (rest.startsWith('ohlc/')) body = B.bars;
    else if (rest.startsWith('greek-exposure/strike')) body = B.strikes;
    else if (rest.startsWith('greek-exposure/expiry')) body = [{ expiry: '2026-10-30', dte: 4, call_gex: 5000, put_gex: 4800 }];
    else if (rest.startsWith('oi-per-strike')) body = B.strikes.map(s => ({ strike: s.strike, call_oi: s.call_oi, put_oi: s.put_oi }));
    else if (rest.startsWith('flow-per-strike')) body = B.strikes.map(s => ({ strike: s.strike, call_volume: Math.round(s.call_oi / 20), put_volume: Math.round(s.put_oi / 20) }));
    else if (rest.startsWith('iv-rank')) body = [{ date: '2026-10-26', volatility: B.iv, iv_rank_1y: 42 }];
    else if (rest.startsWith('volatility/term-structure')) body = [{ expiry: '2026-10-30', volatility: B.iv, implied_move_perc: 0.012 }];
    else if (rest.startsWith('interpolated-iv')) body = [{ days: 1, volatility: B.iv, implied_move_perc: 0.008 }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
  });
}
const cfg = {
  layout: 1,
  panes: [{
    ticker: 'SPY', tabs: ['SPY'], timeframe: '5m',
    overlays: { trails: true, levels: true, darkpool: false, volume: true, flow: false, netDrift: false, volDrift: false, dexStrike: false, session: false, cone: false, events: false, alerts: false },
    indicators: { ema9: false, ema21: false, ema50: false, vwap: false, bb: false, vwapBands: false, sma: false, rsi: false, macd: false, atrPane: false },
    chartStyle: 'candles', clock: 'time', compares: [], priceScale: 'normal', sessionOr: 15, ladder: false, lane: 'size', link: null,
  }],
  setups: {}, palette: 'thermal', railCut: 'book',
};
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await route(page);
await page.addInitScript(stored => localStorage.setItem('slayer_terrain_v1', JSON.stringify(stored)), cfg);
await page.goto(BASE + '/terrain', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
const info = await page.evaluate(() => ({
  text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500),
  canvases: document.querySelectorAll('canvas').length,
  fault: document.body.innerText.includes('Rendered more hooks'),
}));
console.log(JSON.stringify(info));
await page.screenshot({ path: path.join(OUT, 'part3-nodes.png') });
const box = await page.evaluate(() => {
  let best = null;
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (!best || r.width * r.height > best.w * best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return best;
});
if (box) {
  await page.mouse.move(box.x + box.w * 0.62, box.y + box.h * 0.48);
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-bead-card], [data-key-level-card]');
    return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 240) : null;
  });
  console.log('CARD', card);
  await page.screenshot({ path: path.join(OUT, 'part3-hover.png') });
}
await page.goto('file:///workspace/docs/terrain-report/mocks/nodes.html');
await page.setViewportSize({ width: 1100, height: 520 });
await page.screenshot({ path: path.join(OUT, 'part3-mock.png') });
await browser.close();
