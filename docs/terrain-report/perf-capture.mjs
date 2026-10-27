/**
 * Measured Terrain performance. Does not modify the app.
 * Synthetic /api/uw book (same shape as capture.mjs). Ladder off so the
 * rail's known hooks fault is not in the chart numbers; the rail is timed
 * on its own and reported separately.
 */
import pkg from '/workspace/slayer/node_modules/playwright/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = pkg;
const OUT = '/workspace/docs/terrain-report/perf';
const SHOTS = '/workspace/docs/terrain-report/screenshots';
const BASE = 'http://127.0.0.1:8080';

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
  for (let i = 0; i < 390; i++) {
    const seed = ((hash(ticker) + i * 17) % 1000) / 1000;
    const drift = Math.sin(i / 26 + (hash(ticker) % 7)) * spec.base * 0.00035 + (seed - 0.48) * spec.step * 0.15;
    const open = px;
    px = Math.max(spec.step, px + drift);
    const high = Math.max(open, px) + spec.step * 0.04;
    const low = Math.min(open, px) - spec.step * 0.04;
    const t0 = new Date(start + i * 60_000).toISOString();
    const t1 = new Date(start + (i + 1) * 60_000).toISOString();
    bars.push({
      start_time: t0, end_time: t1, market_time: 'r',
      open: open.toFixed(2), high: high.toFixed(2), low: low.toFixed(2), close: px.toFixed(2),
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
      call_gex: call.toFixed(2), put_gex: put.toFixed(2),
      call_delta: (call * 0.35).toFixed(2), put_delta: (put * 0.35).toFixed(2),
      call_oi: Math.round(call * 12), put_oi: Math.round(put * 12),
      call_vanna: (call * 0.02).toFixed(2), put_vanna: (put * 0.02).toFixed(2),
      call_charm: (call * 0.01).toFixed(2), put_charm: (put * 0.01).toFixed(2),
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
      trails: true, levels: true, darkpool: false, volume: true, flow: false,
      netDrift: false, volDrift: false, dexStrike: false, session: false,
      cone: true, events: false, alerts: false, ...(extra.overlays ?? {}),
    },
    indicators: {
      ema9: false, ema21: false, ema50: false, vwap: false,
      bb: false, vwapBands: false, sma: false, rsi: false, macd: false, atrPane: false,
      ...(extra.indicators ?? {}),
    },
    chartStyle: 'candles',
    clock: 'time',
    compares: [],
    priceScale: 'normal',
    sessionOr: 15,
    ladder: extra.ladder === true,
    lane: 'size',
    link: null,
  };
}

function terrainCfg(layout) {
  const names = ['SPY', 'QQQ', 'AAPL', 'NVDA'];
  return {
    layout,
    panes: names.slice(0, 4).map(t => pane(t, { ladder: false })),
    setups: {},
    palette: 'thermal',
    railCut: 'book',
  };
}

async function routeUw(page) {
  await page.route('**/api/uw/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/uw/, '');
    const m = p.match(/^\/stock\/([^/]+)\/(.+)$/);
    const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : '';
    const rest = m ? m[2] : '';
    const b = BOOKS[ticker] ?? book(ticker || 'SPY');
    let body;
    if (rest.startsWith('stock-state')) {
      body = { close: b.last, open: b.open, prev_close: b.open, high: b.last, low: b.open, market_time: 'regular', tape_time: '2026-10-26T20:00:00.000Z' };
    } else if (rest.startsWith('ohlc/1m') || rest.startsWith('ohlc/5m')) body = b.bars;
    else if (rest.startsWith('ohlc/1d')) body = [{ date: '2026-10-23', close: b.open }, { date: '2026-10-26', close: b.last }];
    else if (rest.startsWith('greek-exposure/strike')) body = b.strikes;
    else if (rest.startsWith('greek-exposure/expiry')) body = [{ expiry: '2026-10-30', dte: 4, call_gex: 5000, put_gex: 4800 }];
    else if (rest.startsWith('oi-per-strike')) body = b.strikes.map(s => ({ strike: s.strike, call_oi: s.call_oi, put_oi: s.put_oi }));
    else if (rest.startsWith('flow-per-strike')) body = b.strikes.map(s => ({ strike: s.strike, call_volume: Math.round(s.call_oi / 20), put_volume: Math.round(s.put_oi / 20) }));
    else if (rest.startsWith('iv-rank')) body = [{ date: '2026-10-26', volatility: b.iv, iv_rank_1y: 42 }];
    else if (rest.startsWith('volatility/term-structure')) body = [{ date: '2026-10-30', expiry: '2026-10-30', dte: 4, volatility: b.iv, implied_move: b.last * 0.012, implied_move_perc: 0.012 }];
    else if (rest.startsWith('interpolated-iv')) body = [{ date: '2026-10-26', days: 1, volatility: b.iv, implied_move_perc: 0.008 }];
    else if (rest.startsWith('spot-exposures')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no minute gamma' }) });
      return;
    } else body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: body }) });
  });
}

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    n: arr.length,
    min: round(s[0]),
    p50: round(q(0.5)),
    p95: round(q(0.95)),
    max: round(s[s.length - 1]),
    mean: round(sum / arr.length),
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function frameReport(deltas) {
  const d = deltas.filter(x => x > 0 && x < 5000);
  const span = d.reduce((a, b) => a + b, 0);
  return {
    ...stats(d),
    spanMs: round(span),
    droppedOver32: d.filter(x => x > 32.5).length,
    droppedOver50: d.filter(x => x > 50).length,
    approxHz: span > 0 ? round(d.length / (span / 1000)) : 0,
  };
}

function shorten(url) {
  if (!url) return '';
  return url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\?.*$/, '')
    .replace(/^\/@fs/, '')
    .replace(/^\/workspace\/slayer\//, '');
}

function summarizeProfile(profile) {
  const nodes = new Map((profile.nodes ?? []).map(n => [n.id, n]));
  const self = new Map();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = deltas[i] || 0;
    self.set(id, (self.get(id) || 0) + dt);
  }
  const rows = [];
  for (const [id, us] of self) {
    const node = nodes.get(id);
    const f = node?.callFrame ?? {};
    const url = shorten(f.url || '');
    if (!url && (f.functionName === '(garbage collector)' || f.functionName === '(idle)')) continue;
    rows.push({
      functionName: f.functionName || '(anonymous)',
      url,
      line: (f.lineNumber ?? 0) + 1,
      selfMs: round(us / 1000),
    });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  const totalMs = round(rows.reduce((a, r) => a + r.selfMs, 0));
  const interesting = rows.filter(r =>
    r.url.includes('/src/') || r.url.includes('lightweight-charts') || r.url.includes('react-dom')
  );
  return {
    sampleCount: samples.length,
    selfMs: totalMs,
    top: rows.slice(0, 18),
    topApp: interesting.slice(0, 14),
  };
}

async function arm(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__frameOn = true;
    let last = 0;
    const loop = now => {
      if (!window.__frameOn) return;
      if (last) window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__long = window.__long || [];
    if (!window.__lt) {
      try {
        const obs = new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.__long.push({ dur: e.duration, start: e.startTime });
        });
        obs.observe({ type: 'longtask', buffered: true });
        window.__lt = obs;
      } catch (e) {
        window.__ltErr = String(e);
      }
    }
    if (!window.__mutObs) {
      window.__muts = 0;
      window.__mutObs = new MutationObserver(rs => { window.__muts += rs.length; });
      window.__mutObs.observe(document.body, { subtree: true, childList: true, characterData: true });
    }
    window.__xh = window.__xh || [];
    if (!window.__xhOn) {
      window.__xhOn = true;
      document.addEventListener('pointermove', () => {
        const t = performance.now();
        requestAnimationFrame(() => window.__xh.push(performance.now() - t));
      }, { passive: true });
    }
  });
}

async function takeFrames(page) {
  return page.evaluate(() => {
    const d = window.__frames.splice(0);
    const lt = window.__long.splice(0);
    const muts = window.__muts;
    window.__muts = 0;
    const xh = window.__xh.splice(0);
    return { d, lt, muts, xh, ltErr: window.__ltErr || null };
  });
}

async function largestCanvas(page) {
  const box = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')];
    let best = null;
    for (const c of cs) {
      const r = c.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      const area = r.width * r.height;
      if (!best || area > best.area) best = { x: r.x, y: r.y, w: r.width, h: r.height, area };
    }
    return best;
  });
  return box;
}

async function pan(page) {
  const b = await largestCanvas(page);
  if (!b) return { ok: false };
  const x = b.x + b.w * 0.62;
  const y = b.y + b.h * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 28; i++) await page.mouse.move(x - i * 14, y + (i % 3), { steps: 1 });
  await page.mouse.up();
  return { ok: true, box: { w: Math.round(b.w), h: Math.round(b.h) } };
}

async function zoom(page) {
  const b = await largestCanvas(page);
  if (!b) return { ok: false };
  const x = b.x + b.w * 0.5;
  const y = b.y + b.h * 0.45;
  await page.mouse.move(x, y);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(40);
  }
  return { ok: true };
}

async function sweep(page) {
  const b = await largestCanvas(page);
  if (!b) return { ok: false };
  const y = b.y + Math.min(80, b.h * 0.35);
  const x0 = b.x + 30;
  const x1 = b.x + b.w - 40;
  await page.mouse.move(x0, y);
  for (let i = 1; i <= 24; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 24, y, { steps: 1 });
  return { ok: true };
}

async function pumpTicks(page, hz, ms) {
  return page.evaluate(async ({ hz, ms }) => {
    const hits = (window.__intervals || []).filter(i => i.ms === 1500 && typeof i.fn === 'function');
    const fn = hits.length ? hits[hits.length - 1].fn : null;
    if (!fn) return { error: 'no 1500ms interval', intervals: (window.__intervals || []).map(i => i.ms).slice(0, 20) };
    const gap = 1000 / hz;
    const callMs = [];
    const t0 = performance.now();
    await new Promise(resolve => {
      const step = () => {
        const a = performance.now();
        try { fn(); } catch (e) { window.__tickErr = String(e); }
        callMs.push(performance.now() - a);
        if (performance.now() - t0 >= ms) resolve();
        else setTimeout(step, Math.max(0, gap - (performance.now() - a)));
      };
      step();
    });
    const elapsed = performance.now() - t0;
    return { calls: callMs.length, elapsed, callMs, achievedHz: callMs.length / (elapsed / 1000), err: window.__tickErr || null };
  }, { hz, ms });
}

async function profileDuring(page, work) {
  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 250 });
  await client.send('Profiler.start');
  await work();
  const { profile } = await client.send('Profiler.stop');
  await client.send('Profiler.disable').catch(() => {});
  return summarizeProfile(profile);
}

async function heap(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const { metrics } = await client.send('Performance.getMetrics');
  const want = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'JSEventListeners', 'LayoutCount', 'RecalcStyleCount'];
  const o = {};
  for (const m of metrics) if (want.includes(m.name)) o[m.name] = m.value;
  await client.detach().catch(() => {});
  return o;
}

async function prepare(page, cfg) {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
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
  }, cfg);
  page.__errors = errors;
  return page;
}

async function gotoReady(page, canvases) {
  const t0 = Date.now();
  await page.goto(BASE + '/terrain', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const dcl = Date.now() - t0;
  let canvasMs = null;
  try {
    await page.waitForFunction(n => {
      return [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 160).length >= n;
    }, canvases, { timeout: 25000 });
    canvasMs = Date.now() - t0;
  } catch {
    canvasMs = null;
  }
  await page.waitForTimeout(1800);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? {
      ttfb: n.responseStart,
      domContentLoaded: n.domContentLoadedEventEnd,
      load: n.loadEventEnd,
      transfer: n.transferSize,
      decodedBody: n.decodedBodySize,
    } : null;
  });
  return { dcl, canvasMs, settledMs: Date.now() - t0, nav };
}

async function gesturePass(page, label) {
  await arm(page);
  await page.waitForTimeout(80);
  await takeFrames(page);
  const idleRaw = await (async () => {
    await page.waitForTimeout(2200);
    return takeFrames(page);
  })();
  await takeFrames(page);
  const panInfo = await pan(page);
  const panRaw = await takeFrames(page);
  const zoomInfo = await zoom(page);
  const zoomRaw = await takeFrames(page);
  const intervals = await page.evaluate(() => (window.__intervals || []).map(i => i.ms));
  return {
    label,
    canvases: await page.locator('canvas').count(),
    intervals: intervals.reduce((m, ms) => (m[ms] = (m[ms] || 0) + 1, m), {}),
    panInfo,
    zoomInfo,
    idle: { frames: frameReport(idleRaw.d), longTasks: stats(idleRaw.lt.map(t => t.dur)), longN: idleRaw.lt.length, muts: idleRaw.muts, ltErr: idleRaw.ltErr },
    pan: { frames: frameReport(panRaw.d), longTasks: stats(panRaw.lt.map(t => t.dur)), longN: panRaw.lt.length, worst: panRaw.lt.sort((a, b) => b.dur - a.dur).slice(0, 5), muts: panRaw.muts },
    zoom: { frames: frameReport(zoomRaw.d), longTasks: stats(zoomRaw.lt.map(t => t.dur)), longN: zoomRaw.lt.length, worst: zoomRaw.lt.sort((a, b) => b.dur - a.dur).slice(0, 5), muts: zoomRaw.muts },
    errors: [...new Set(page.__errors)].slice(0, 6),
  };
}

async function tickPass(page, panes) {
  const out = [];
  for (const hz of [10, 50, 200]) {
    await arm(page);
    await takeFrames(page);
    const pump = await pumpTicks(page, hz, 2000);
    await page.waitForTimeout(400);
    const raw = await takeFrames(page);
    const call = stats(pump.callMs || []);
    out.push({
      panes,
      requestedHz: hz,
      achievedHz: pump.achievedHz ? round(pump.achievedHz) : 0,
      calls: pump.calls ?? 0,
      call,
      error: pump.error || pump.err || null,
      frames: frameReport(raw.d),
      longTasks: stats((raw.lt || []).map(t => t.dur)),
      longN: (raw.lt || []).length,
      worst: (raw.lt || []).sort((a, b) => b.dur - a.dur).slice(0, 4),
      domMutations: raw.muts,
    });
  }
  return out;
}

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'],
});

const result = {
  measuredAt: new Date().toISOString(),
  note: 'Synthetic UW book. Chart panes have ladder:false so ExposureField is not mounted. Tick bursts call the live 1500ms processTick (MarketDataContext) faster than production; production cadence is 1.5s. Frame time is rAF delta. A drop is a delta over 32.5ms (missed a 60Hz frame) or over 50ms.',
  gestures: [],
  ticks: [],
  open: null,
  crosshair: null,
  rail: null,
  memory: null,
  profiles: {},
  colors: null,
};

try {
  await mkdir(OUT, { recursive: true });
  await mkdir(SHOTS, { recursive: true });

  for (const layout of [1, 2, 4]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await prepare(page, terrainCfg(layout));
    const open = await gotoReady(page, layout);
    console.log('OPEN', layout, JSON.stringify(open));
    if (layout === 4) {
      result.open = { cold: open };
      const t1 = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      let warmCanvas = null;
      try {
        await page.waitForFunction(() => [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width > 160).length >= 4, null, { timeout: 25000 });
        warmCanvas = Date.now() - t1;
      } catch { warmCanvas = null; }
      await page.waitForTimeout(1800);
      result.open.warm = { canvasMs: warmCanvas, settledMs: Date.now() - t1 };
      console.log('WARM', JSON.stringify(result.open.warm));
      await page.screenshot({ path: path.join(SHOTS, 'part2-desk-4.png') });
    }
    const g = await gesturePass(page, `${layout} pane`);
    g.open = open;
    result.gestures.push(g);
    console.log('GESTURE', layout, 'idle', JSON.stringify(g.idle.frames), 'pan', JSON.stringify(g.pan.frames), 'zoom', JSON.stringify(g.zoom.frames));
    result.ticks.push(...await tickPass(page, layout));
    console.log('TICKS', layout, result.ticks.filter(t => t.panes === layout).map(t => `${t.requestedHz}->${t.achievedHz} callP50=${t.call.p50} frameP95=${t.frames.p95} drop50=${t.frames.droppedOver50}`).join(' | '));

    if (layout === 4) {
      await arm(page);
      await takeFrames(page);
      await sweep(page);
      const xh = await takeFrames(page);
      result.crosshair = {
        frames: frameReport(xh.d),
        pointerToNextFrame: stats(xh.xh),
        longN: xh.lt.length,
        worst: xh.lt.sort((a, b) => b.dur - a.dur).slice(0, 4),
        note: 'pointermove to the next animation frame, measured on the pane under the cursor. emitCrosshair itself is synchronous; this is the visible delay.',
      };
      console.log('CROSSHAIR', JSON.stringify(result.crosshair.pointerToNextFrame));

      result.profiles.pan4 = await profileDuring(page, () => pan(page));
      result.profiles.zoom4 = await profileDuring(page, () => zoom(page));
      result.profiles.tick50 = await profileDuring(page, () => pumpTicks(page, 50, 1800));
      console.log('PROFILE pan', result.profiles.pan4.topApp.slice(0, 5));
      console.log('PROFILE tick', result.profiles.tick50.topApp.slice(0, 5));

      const samples = [];
      const before = await heap(page);
      samples.push({ t: 0, ...before });
      await page.evaluate(() => {
        const hits = (window.__intervals || []).filter(i => i.ms === 1500 && typeof i.fn === 'function');
        const fn = hits.length ? hits[hits.length - 1].fn : null;
        window.__pumpBusy = false;
        window.__pump = setInterval(() => {
          if (!fn || window.__pumpBusy) return;
          window.__pumpBusy = true;
          try { fn(); } finally { window.__pumpBusy = false; }
        }, 250);
      });
      for (let i = 1; i <= 12; i++) {
        await page.waitForTimeout(3000);
        const m = await heap(page);
        samples.push({ t: i * 3, ...m });
        console.log('HEAP', i * 3, m.JSHeapUsedSize, 'listeners', m.JSEventListeners, 'nodes', m.Nodes);
      }
      await page.evaluate(() => clearInterval(window.__pump));
      result.memory = {
        note: '4 ticks/s for 36s. Production ticks every 1.5s, so this is about 54s of simulator time squeezed into 36s, not an 8-hour soak.',
        samples,
      };

      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      await page.screenshot({ path: path.join(SHOTS, 'part2-focus.png') });
      result.colors = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const focus = document.activeElement;
        const fs = focus ? getComputedStyle(focus) : null;
        const buttons = [...document.querySelectorAll('button')].slice(0, 30).map(b => {
          const s = getComputedStyle(b);
          return {
            name: (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').slice(0, 48),
            color: s.color,
            bg: s.backgroundColor,
            font: s.fontSize,
            outline: s.outlineStyle,
            radius: s.borderRadius,
          };
        });
        return {
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          bodyFont: body.fontFamily,
          focusTag: focus ? focus.tagName : null,
          focusName: focus ? (focus.getAttribute('aria-label') || focus.innerText || '').slice(0, 40) : null,
          focusOutline: fs ? `${fs.outlineWidth} ${fs.outlineStyle} ${fs.outlineColor}` : null,
          buttons,
        };
      });
    }
    await context.close();
  }

  // Rail: default GEX view mounts ExposureField. Record time-to-fault, then a second try that switches to Ladder immediately.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', err => faults.push({ t: Date.now(), m: String(err).slice(0, 240) }));
    const cfg = terrainCfg(1);
    cfg.panes[0].ladder = true;
    await prepare(page, cfg);
    const t0 = Date.now();
    await page.goto(BASE + '/terrain', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    result.rail = {
      defaultView: {
        waitedMs: Date.now() - t0,
        faults,
        textHasFault: (await page.locator('body').innerText()).includes('Rendered more hooks'),
      },
    };
    await page.screenshot({ path: path.join(SHOTS, 'part2-rail-fault.png') });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const faults = [];
    page.on('pageerror', err => faults.push({ t: Date.now(), m: String(err).slice(0, 240) }));
    const cfg = terrainCfg(1);
    cfg.panes[0].ladder = true;
    await prepare(page, cfg);
    const t0 = Date.now();
    await page.goto(BASE + '/terrain', { waitUntil: 'domcontentloaded', timeout: 60000 });
    let clicked = false;
    try {
      const ladder = page.getByRole('button', { name: 'Ladder', exact: true });
      await ladder.click({ timeout: 8000 });
      clicked = true;
    } catch (e) {
      result.rail.ladderClickError = String(e).slice(0, 200);
    }
    await page.waitForTimeout(2500);
    await arm(page);
    await takeFrames(page);
    if (clicked && faults.length === 0) {
      await pumpTicks(page, 10, 1600);
    }
    const raw = await takeFrames(page);
    result.rail.ladderView = {
      clicked,
      clickDelayMs: Date.now() - t0,
      faults,
      frames: frameReport(raw.d),
      longN: raw.lt.length,
      worst: raw.lt.sort((a, b) => b.dur - a.dur).slice(0, 4),
    };
    if (faults.length === 0) {
      result.profiles.railTick = await profileDuring(page, () => pumpTicks(page, 10, 1500));
      await page.screenshot({ path: path.join(SHOTS, 'part2-ladder.png') });
    }
    console.log('RAIL', JSON.stringify({ faults: faults.length, clicked, frames: result.rail.ladderView.frames }));
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(OUT, 'results.json'), JSON.stringify(result, null, 2));
console.log('WROTE', path.join(OUT, 'results.json'));
