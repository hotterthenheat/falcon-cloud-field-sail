/**
 * Terrain screenshots. Does not modify the app.
 * Two modes: the real dev server with no data key, and a synthetic
 * /api/uw payload shaped like the client's parser.
 */
import pkg from '/workspace/slayer/node_modules/playwright/index.js';
const { chromium } = pkg;
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = '/workspace/docs/terrain-report/screenshots';
const BASE = 'http://127.0.0.1:8080';

/* Bases sit on the simulator's drifted prices so the synthetic tape and the
   simulator rail share a scale. The two books are still separate. */
const NAMES = {
  SPY: { base: 455, iv: 0.15, step: 5 },
  QQQ: { base: 442, iv: 0.18, step: 5 },
  AAPL: { base: 190, iv: 0.2, step: 2.5 },
  NVDA: { base: 120, iv: 0.35, step: 1 },
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function book(ticker) {
  const spec = NAMES[ticker] ?? { base: 100, iv: 0.25, step: 1 };
  const bars = [];
  let px = spec.base;
  const start = Date.parse('2026-10-26T09:30:00-04:00');
  const n = 390;
  for (let i = 0; i < n; i++) {
    const seed = ((hash(ticker) + i * 17) % 1000) / 1000;
    const drift = Math.sin(i / 26 + (hash(ticker) % 7)) * spec.base * 0.00035 + (seed - 0.48) * spec.step * 0.15;
    const open = px;
    px = Math.max(spec.step, px + drift);
    const high = Math.max(open, px) + spec.step * 0.04;
    const low = Math.min(open, px) - spec.step * 0.04;
    const t0 = new Date(start + i * 60_000).toISOString();
    const t1 = new Date(start + (i + 1) * 60_000).toISOString();
    bars.push({
      start_time: t0,
      end_time: t1,
      market_time: 'r',
      open: open.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      close: px.toFixed(2),
      volume: 80000 + (i % 40) * 2500,
    });
  }
  const strikes = [];
  for (let k = -14; k <= 14; k++) {
    const strike = Math.round((spec.base + k * spec.step) * 100) / 100;
    const call = Math.exp(-(k * k) / (k >= 0 ? 22 : 70)) * (k >= 0 ? 9000 : 1800);
    const put = Math.exp(-(k * k) / (k <= 0 ? 22 : 70)) * (k <= 0 ? 8200 : 1400);
    strikes.push({
      strike,
      call_gex: call.toFixed(2),
      put_gex: put.toFixed(2),
      call_delta: (call * 0.35).toFixed(2),
      put_delta: (put * 0.35).toFixed(2),
      call_oi: Math.round(call * 12),
      put_oi: Math.round(put * 12),
      call_vanna: (call * 0.02).toFixed(2),
      put_vanna: (put * 0.02).toFixed(2),
      call_charm: (call * 0.01).toFixed(2),
      put_charm: (put * 0.01).toFixed(2),
    });
  }
  return { bars, strikes, last: px, open: spec.base, iv: spec.iv };
}

const BOOKS = Object.fromEntries(Object.keys(NAMES).map(t => [t, book(t)]));

function pane(ticker, extra = {}) {
  return {
    ticker,
    tabs: [ticker],
    timeframe: '15m',
    overlays: {
      trails: true,
      levels: false,
      darkpool: false,
      volume: true,
      flow: false,
      netDrift: false,
      volDrift: false,
      dexStrike: false,
      session: false,
      cone: false,
      events: false,
      alerts: false,
      ...(extra.overlays ?? {}),
    },
    indicators: {
      ema9: false, ema21: false, ema50: false, vwap: false,
      bb: false, vwapBands: false, sma: false, rsi: false, macd: false, atrPane: false,
      ...(extra.indicators ?? {}),
    },
    chartStyle: extra.chartStyle ?? 'candles',
    clock: 'time',
    compares: extra.compares ?? [],
    priceScale: 'normal',
    sessionOr: 15,
    ladder: extra.ladder !== false,
    lane: extra.lane ?? 'size',
    link: null,
  };
}

function terrainCfg(layout, panes) {
  return { layout, panes, setups: {}, palette: 'thermal', railCut: 'book' };
}

function routeUw(page) {
  return page.route('**/api/uw/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/uw/, '');
    const m = p.match(/^\/stock\/([^/]+)\/(.+)$/);
    const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : '';
    const rest = m ? m[2] : '';
    const b = BOOKS[ticker] ?? book(ticker || 'SPY');
    let body;
    if (rest.startsWith('stock-state')) {
      body = {
        close: b.last,
        open: b.open,
        prev_close: b.open,
        high: b.last,
        low: b.open,
        market_time: 'regular',
        tape_time: '2026-10-26T20:00:00.000Z',
      };
    } else if (rest.startsWith('ohlc/1m') || rest.startsWith('ohlc/5m')) {
      body = b.bars;
    } else if (rest.startsWith('ohlc/1d')) {
      body = [{ date: '2026-10-23', close: b.open }, { date: '2026-10-26', close: b.last }];
    } else if (rest.startsWith('greek-exposure/strike-expiry') || rest === 'greek-exposure/strike' || rest.startsWith('greek-exposure/strike?')) {
      body = b.strikes;
    } else if (rest.startsWith('greek-exposure/expiry')) {
      body = [{ expiry: '2026-10-30', dte: 4, call_gex: 5000, put_gex: 4800 }];
    } else if (rest.startsWith('oi-per-strike')) {
      body = b.strikes.map(s => ({ strike: s.strike, call_oi: s.call_oi, put_oi: s.put_oi }));
    } else if (rest.startsWith('flow-per-strike')) {
      body = b.strikes.map(s => ({ strike: s.strike, call_volume: Math.round(s.call_oi / 20), put_volume: Math.round(s.put_oi / 20) }));
    } else if (rest.startsWith('iv-rank')) {
      body = [{ date: '2026-10-26', volatility: b.iv, iv_rank_1y: 42 }];
    } else if (rest.startsWith('volatility/term-structure')) {
      body = [{ date: '2026-10-30', expiry: '2026-10-30', dte: 4, volatility: b.iv, implied_move: b.last * 0.012, implied_move_perc: 0.012 }];
    } else if (rest.startsWith('interpolated-iv')) {
      body = [{ date: '2026-10-26', days: 1, volatility: b.iv, implied_move_perc: 0.008 }];
    } else if (rest.startsWith('spot-exposures')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic feed has no minute gamma' }) });
      return;
    } else if (rest.startsWith('option-contracts')) {
      body = [];
    } else {
      body = [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
  });
}

async function shoot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  const errors = page.__errs ?? [];
  console.log('SHOT', name, 'errors', errors.length);
  return file;
}

async function openTerrain(browser, { mock, cfg, viewport, path: urlPath = '/terrain' }) {
  const page = await browser.newPage({ viewport: viewport ?? { width: 1440, height: 900 } });
  page.__errs = [];
  page.on('pageerror', err => page.__errs.push(String(err)));
  page.on('console', msg => {
    if (msg.type() === 'error') page.__errs.push(msg.text());
  });
  if (mock) await routeUw(page);
  await page.addInitScript(stored => {
    if (stored) localStorage.setItem('slayer_terrain_v1', JSON.stringify(stored));
    else localStorage.removeItem('slayer_terrain_v1');
  }, cfg ?? null);
  await page.goto(BASE + urlPath, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5500);
  const text = await page.locator('body').innerText();
  console.log('TEXT', urlPath, mock ? 'mock' : 'live', text.replace(/\n+/g, ' | ').slice(0, 700));
  console.log('ERRS', [...new Set(page.__errs)].slice(0, 8).join(' || '));
  return page;
}

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

await mkdir(OUT, { recursive: true });

const desk = terrainCfg(3, [
  pane('SPY'),
  pane('QQQ'),
  pane('AAPL'),
  pane('NVDA'),
]);

const focused = terrainCfg(1, [
  pane('SPY', {
    overlays: { trails: true, levels: true, cone: true, session: true, volume: true, events: true },
    indicators: { ema21: true, vwap: true, rsi: true },
    ladder: true,
    lane: 'both',
  }),
  pane('QQQ'),
  pane('AAPL'),
  pane('NVDA'),
]);

const four = terrainCfg(4, [
  pane('SPY', { ladder: false, overlays: { trails: true, levels: true, volume: true } }),
  pane('QQQ', { ladder: false }),
  pane('AAPL', { ladder: false }),
  pane('NVDA', { ladder: false, indicators: { vwap: true, ema21: true } }),
]);

const flow = terrainCfg(1, [
  pane('SPY', { overlays: { trails: false, volume: true, flow: true, netDrift: true, levels: true }, ladder: false }),
  pane('QQQ'),
  pane('AAPL'),
  pane('NVDA'),
]);

// 1. No key — what the page actually does.
{
  const page = await openTerrain(browser, { mock: false, cfg: null });
  await shoot(page, '01-no-key-default.png');
  await page.close();
}

// 2. Synthetic book, default 3-up.
{
  const page = await openTerrain(browser, { mock: true, cfg: desk });
  await shoot(page, '02-three-up-rail-fault.png');
  await page.close();
}

// 3. One pane, levels + cone + session + indicators + rail.
{
  const page = await openTerrain(browser, { mock: true, cfg: focused, viewport: { width: 1600, height: 1000 } });
  await shoot(page, '03-levels-cone-indicators.png');
  const click = async (name) => {
    const btn = page.getByRole('button', { name }).first();
    await btn.click({ force: true });
  };
  const labels = await page.locator('button').evaluateAll(els => els.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean));
  console.log('BUTTONS', labels.slice(0, 40).join(' | '));
  const tools = page.getByRole('button', { name: 'Tools' }).first();
  if (await tools.count()) {
    await tools.click({ force: true });
    await page.waitForTimeout(400);
  }
  const overlays = page.getByRole('button', { name: /Overlays/ }).first();
  if (await overlays.count()) {
    await overlays.click({ force: true });
    await page.waitForTimeout(400);
    await shoot(page, '04-overlays-menu.png');
    await page.keyboard.press('Escape');
  } else {
    await shoot(page, '04-overlays-menu.png');
  }
  const indicators = page.getByRole('button', { name: /Indicators/ }).first();
  if (await indicators.count()) {
    await indicators.click({ force: true });
    await page.waitForTimeout(600);
    await shoot(page, '05-indicators-library.png');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('d');
  await page.waitForTimeout(400);
  await shoot(page, '06-draw-mode.png');
  await page.close();
}

// 4. Four up.
{
  const page = await openTerrain(browser, { mock: true, cfg: four, viewport: { width: 1600, height: 1000 } });
  await shoot(page, '07-four-up.png');
  await page.close();
}

// 5. Flow panes.
{
  const page = await openTerrain(browser, { mock: true, cfg: flow, viewport: { width: 1440, height: 1000 } });
  await shoot(page, '08-flow-panes.png');
  await page.close();
}

// 6. Pinpoint map — another indicator surface, same synthetic book.
{
  const page = await openTerrain(browser, { mock: true, cfg: null, path: '/pinpoint/map', viewport: { width: 1440, height: 1000 } });
  await page.waitForTimeout(2000);
  await shoot(page, '09-pinpoint-map.png');
  await page.close();
}

// 7. Phone.
{
  const page = await openTerrain(browser, {
    mock: true,
    cfg: terrainCfg(1, [pane('SPY', { ladder: false, overlays: { trails: true, levels: true, cone: true, volume: true }, indicators: { ema21: true, vwap: true } }), pane('QQQ'), pane('AAPL'), pane('NVDA')]),
    viewport: { width: 390, height: 844 },
  });
  await shoot(page, '10-phone.png');
  await page.close();
}

await browser.close();
console.log('done');
