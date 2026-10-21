/*
  THE DEVICE SWEEP (2026-10-18; Noah: "i think we might need to do a device sizing sweep on the entire website
  excluding pulse") — `npm run devices:check -- <base> [--out <dir>] [--sizes a,b] [--theme dark|light] [routes…]`,
  with the dev server up, ALONE (it is ~440 loads).

  The phone sweep (check-phone.mjs) walks three phone shapes for four faults. This one walks every route but Pulse at
  TEN SHAPES — three phones (one sideways), two tablets, the PORTRAIT MONITOR (1080×1920), two laptops, the desk and
  the partner's ultrawide — for the phone sweep's four faults and three more, and keeps a STILL of every route at every
  shape for the eye pass:
    SIDEWAYS SCROLL   the document or <main> wider than the screen, and which box pushed it (the phone sweep's)
    CUT OFF           words that reach past the screen's edge and are clipped there — a figure or a label cut mid-way
    EMPTY BAND        a page that should fill the screen (the house rule) ending well above the fold
    UNDER THE FLOOR   a chart column, a strike rail or a compare wing narrower than it can be read at
    SMALL TYPE IN A FIELD · FAILED REQUESTS · PAGE ERRORS   as the phone sweep
  Writes <out>/<size>/<route>.png, <out>/report.json and <out>/report.md. Exits 1 on sideways scroll or a page error;
  the rest is for the eye.
*/
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const OUT = flag('--out', 'sweep-out');
const THEME = flag('--theme', 'dark');
const ONLY_SIZES = flag('--sizes', '');
const BASE = args.find(a => /^https?:\/\//.test(a)) ?? 'http://localhost:5199';
const ONLY = args.filter(a => a.startsWith('/'));

const ALL_ROUTES = [
  '/', '/terrain', '/compass', '/compass/tracker', '/weigher',
  '/trace/live-tape', '/trace/dark-pool', '/trace/screener', '/trace/net-flow', '/trace/footprints', '/trace/watchers', '/trace/intervals', '/trace/odte', '/trace/multi-leg', '/trace/compare', '/trace/tracker',
  '/pinpoint/map', '/pinpoint/agenda', '/pinpoint/agenda?view=building', '/pinpoint/board', '/pinpoint/compare',
  '/dossier/news', '/dossier/earnings', '/dossier/earnings/NVDA', '/dossier/insiders', '/dossier/congress', '/dossier/stocks', '/dossier/stocks/NVDA',
  '/practice/paper', '/practice/backtest', '/practice/futures', '/practice/journal', '/practice/backtest/not-a-session',
  '/community', '/settings/account', '/settings/billing', '/settings/data', '/settings/appearance', '/settings/desk', '/settings/keyboard', '/settings/about',
  '/pinpoint/not-a-page', '/not-a-page',
];
const ROUTES = ONLY.length ? ONLY : ALL_ROUTES;
const ALL_SIZES = [
  { name: '360', width: 360, height: 740, mobile: true, kind: 'phone' },
  { name: '390', width: 390, height: 844, mobile: true, kind: 'phone' },
  { name: '844x390', width: 844, height: 390, mobile: true, kind: 'phone sideways' },
  { name: '768', width: 768, height: 1024, mobile: true, kind: 'tablet' },
  { name: '1024', width: 1024, height: 768, mobile: false, kind: 'tablet sideways / small laptop' },
  { name: '1080x1920', width: 1080, height: 1920, mobile: false, kind: 'portrait monitor' },
  { name: '1280', width: 1280, height: 720, mobile: false, kind: 'laptop' },
  { name: '1440', width: 1440, height: 900, mobile: false, kind: 'laptop' },
  { name: '1905', width: 1905, height: 960, mobile: false, kind: 'desk' },
  { name: '3440', width: 3440, height: 1440, mobile: false, kind: 'ultrawide' },
];
const SIZES = ONLY_SIZES ? ALL_SIZES.filter(s => ONLY_SIZES.split(',').includes(s.name)) : ALL_SIZES;
const slug = route => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'));

const browser = await chromium.launch({ channel: 'chrome' });
const report = { base: BASE, theme: THEME, when: new Date().toISOString(), sizes: {} };
let exitBad = 0;
const t0 = Date.now();
/* THE APP, NOT THE SPLASH: the boot screen stands until the route's chunk and its first data are in, and on a dev server
   the FIRST visit of a route is its cold compile (seconds) — a still taken then is of the splash and every measure is of
   nothing. The sweep waits the gate out (up to 30s) and then lets the page settle; a warm-up pass first loads every route
   once so no measured visit is a cold one. */
const settled = async (page, route) => {
  /* the gate plays 1.35s and leaves on a fade; a gate still up at 12s is a page that stalled — reload it once and
     wait again, and if it stands even then the row says SPLASH rather than measure the boot screen as the page */
  const gateGone = ms => page.waitForSelector('[data-launch-gate]', { state: 'detached', timeout: ms }).then(() => true).catch(() => false);
  let gone = await gateGone(12000);
  if (!gone) {
    await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {});
    gone = await gateGone(12000);
  }
  await page.waitForFunction(() => {
    const m = document.querySelector('main');
    return !!m && m.getBoundingClientRect().height > 0 && m.textContent.trim().length > 0;
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(route === '/' ? 4200 : 3200);
  return gone;
};
{
  const warm = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await warm.addInitScript(theme => {
    try {
      localStorage.setItem('slayer_theme', theme);
      localStorage.setItem('slayer_launch_gate', '1');
    } catch {}
  }, THEME);
  const page = await warm.newPage();
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('[data-launch-gate]', { state: 'detached', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await warm.close();
  console.log(`warm: ${ROUTES.length} routes compiled · ${Math.round((Date.now() - t0) / 1000)}s`);
}
await browser.close();
for (const size of SIZES) {
  const dir = join(OUT, size.name);
  mkdirSync(dir, { recursive: true });
  /* A FRESH BROWSER A SHAPE: the first baseline ran ten shapes in one browser and from the first shape on every page sat
     on the boot screen — the gate's fade never ended — while the same script on two routes rendered every page; a
     browser that has been through hundreds of pages is not the one the reader opens */
  const browser = await chromium.launch({ channel: 'chrome' });
  let where = '';
  const errors = [];
  const failed = new Map();
  const rows = [];
  for (const route of ROUTES) {
    where = route;
    const tr = Date.now();
    /* A FRESH CONTEXT A ROUTE: a route loaded after the landing in the same context never got past the boot screen (the
       landing leaves the context in a state the terminal's gate does not leave), so every route gets a reader's own
       first visit — its own storage, its own cookies, nothing carried from the page before */
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 1 });
    await ctx.addInitScript(theme => {
      try {
        localStorage.setItem('slayer_theme', theme);
        localStorage.setItem('slayer_launch_gate', '1');
      } catch {}
    }, THEME);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-10-15T18:00:00Z'));
    page.on('pageerror', e => errors.push({ route: where, error: String(e).slice(0, 160) }));
    page.on('response', r => {
      if (r.status() >= 400) failed.set(`${r.status()} ${new URL(r.url()).pathname}`, where);
    });
    page.on('requestfailed', r => {
      const u = r.url();
      if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
      if (!u.startsWith('data:') && !/\/@vite|hot-update/.test(u)) failed.set(`failed ${new URL(u).pathname}`, where);
    });
    try {
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
    } catch (e) {
      rows.push({ route, load: String(e).slice(0, 120) });
      await ctx.close();
      continue;
    }
    const gone = await settled(page, route);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const docOver = document.documentElement.scrollWidth - vw;
      const main = document.querySelector('main');
      const mainOver = main ? main.scrollWidth - main.clientWidth : 0;
      const limit = main ? main.getBoundingClientRect().right : vw;
      let pusher = null;
      const cut = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right <= limit + 1 && b.left >= -1) continue;
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body && p !== main; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o !== 'visible') {
            clipped = true;
            break;
          }
        }
        if (!clipped && (docOver > 1 || mainOver > 1) && !pusher) pusher = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} → right ${Math.round(b.right)}`;
        /* CUT OFF: a leaf with its own words, reaching past the edge, clipped by an ancestor — the words are cut mid-way.
           NOT A GRID'S COLUMNS: an AG Grid clips its header under an overflow-hidden viewport and scrolls its columns
           on its own bar, so a column past the edge is reachable, not cut (the baseline read every Trace and Dossier
           grid as cut words) */
        if (clipped && el.children.length === 0 && !el.closest('.ag-root, .ag-root-wrapper')) {
          const text = (el.textContent ?? '').trim();
          if (text && text.length < 80 && b.top < vh && b.bottom > 0) {
            /* a row that scrolls sideways on purpose (a tab strip, a grid) is not a cut, nor is a tape that MOVES (the
               news wire rides a transform) — only an ancestor that HIDES, standing still, counts */
            let hidden = false;
            /* a leaf that truncates itself (`truncate` on the span) is shortened on purpose too */
            if (getComputedStyle(el).textOverflow === 'ellipsis') continue;
            /* REACHABLE BY A SCROLL: a leaf inside a box that scrolls sideways (a phone's five-day board, a key line) is
               not cut while it lies within that box's scrollable content, whatever clips it on the way up */
            let scroller = null;
            for (let p = el.parentElement; p && p !== document.body && p !== main; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if (o === 'auto' || o === 'scroll') {
                scroller = p;
                break;
              }
            }
            if (scroller && b.right <= scroller.getBoundingClientRect().left + scroller.scrollWidth + 1) continue;
            for (let p = el.parentElement; p && p !== document.body && p !== main; p = p.parentElement) {
              const cs = getComputedStyle(p);
              if (cs.transform !== 'none' || cs.animationName !== 'none') break;
              /* a line that TRUNCATES ends in an ellipsis on purpose — a designed shortening, not a cut */
              if (cs.textOverflow === 'ellipsis') break;
              const o = cs.overflowX;
              if (o === 'hidden' || o === 'clip') {
                hidden = true;
                break;
              }
              if (o === 'auto' || o === 'scroll') break;
            }
            const key = text.slice(0, 40);
            if (hidden && !seen.has(key)) {
              seen.add(key);
              cut.push(`"${key}" right ${Math.round(b.right)} of ${Math.round(limit)}`);
            }
          }
        }
      }
      /* EMPTY BAND: how far above the fold the page's content ends. The scroller is <main> at the window's height, so
         its scrollHeight never says where the content stops; the band is the room under the lowest of main's own
         children when the page does not scroll (the baseline missed the Board ending a third of the way down a
         portrait monitor) */
      const scroller = main ?? document.documentElement;
      let band = 0;
      if (main && main.scrollHeight <= main.clientHeight + 1) {
        const kids = [...main.children].filter(k => k.getBoundingClientRect().height > 0);
        const low = kids.length ? Math.max(...kids.map(k => k.getBoundingClientRect().bottom)) : main.getBoundingClientRect().bottom;
        band = Math.max(0, Math.round(main.getBoundingClientRect().bottom - low));
      }
      /* UNDER THE FLOOR: the boxes that have one */
      const w = s => [...document.querySelectorAll(s)].map(e => Math.round(e.getBoundingClientRect().width)).filter(x => x > 0);
      const floors = [];
      for (const x of w('[data-chart-ground]')) if (x < 240) floors.push(`chart ${x}px`);
      for (const x of w('[data-profile-panel]')) if (x < 180) floors.push(`strike rail ${x}px`);
      for (const x of w('[data-compare-a], [data-compare-b]')) if (x < 120) floors.push(`compare wing ${x}px`);
      for (const x of w('[data-compare-axis]')) if (x < 320) floors.push(`ruler ${x}px`);
      const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), textarea, select')]
        .filter(e => e.getBoundingClientRect().width > 0)
        .map(e => ({ px: parseFloat(getComputedStyle(e).fontSize), what: e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.tagName.toLowerCase() }))
        .filter(f => f.px < 16);
      let touchRule = false;
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) if (rule instanceof CSSMediaRule && /hover:\s*none/.test(rule.conditionText) && /font-size:\s*16px/.test(rule.cssText)) touchRule = true;
        } catch {}
      }
      /* TINY TYPE: visible words under the house's 8px floor */
      let tiny = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const t = (el.textContent ?? '').trim();
        if (!t) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.top > vh || b.bottom < 0) continue;
        if (parseFloat(getComputedStyle(el).fontSize) < 8) tiny++;
      }
      return { docOver, mainOver, pusher, cut: cut.slice(0, 4), band, floors: [...new Set(floors)].slice(0, 4), fields: touchRule ? [] : fields.slice(0, 4), tiny, scrollH: scroller.scrollHeight, viewH: scroller.clientHeight };
    });
    const shot = join(dir, `${slug(route)}.png`);
    try {
      await page.screenshot({ path: shot, fullPage: false });
    } catch {
      /* a shape the renderer cannot capture is not a fault of the page */
    }
    rows.push({ route, ...r, shot, splash: !gone, ms: Date.now() - tr });
    await ctx.close();
  }
  report.sizes[size.name] = { ...size, rows, errors, failed: [...failed.entries()] };
  const scroll = rows.filter(x => x.docOver > 1 || x.mainOver > 1).length;
  const cutN = rows.filter(x => x.cut?.length).length;
  const bandN = rows.filter(x => x.band > 160).length;
  const floorN = rows.filter(x => x.floors?.length).length;
  const splashN = rows.filter(x => x.splash).length;
  console.log(`${size.name} (${size.kind}): ${rows.length} routes · sideways ${scroll} · cut ${cutN} · empty band ${bandN} · under floor ${floorN} · splash ${splashN} · errors ${errors.length} · failed requests ${failed.size} · ${Math.round((Date.now() - t0) / 1000)}s`);
  exitBad += scroll + errors.length;
  await browser.close();
}

/* THE REPORT, for the triage: one line a fault */
const md = [`# Device sweep — ${report.when} · ${THEME} · ${BASE}`, ''];
for (const [name, s] of Object.entries(report.sizes)) {
  md.push(`## ${name} — ${s.kind} (${s.width}×${s.height})`, '');
  for (const r of s.rows) {
    const faults = [];
    if (r.load) faults.push(`DID NOT LOAD ${r.load}`);
    if (r.splash) faults.push('SPLASH — the launch gate never left, even after a reload; the measures are of the boot screen');
    if (r.docOver > 1 || r.mainOver > 1) faults.push(`SIDEWAYS doc +${r.docOver} · main +${r.mainOver} · ${r.pusher ?? 'pusher not found'}`);
    if (r.cut?.length) faults.push(`CUT ${r.cut.join(' · ')}`);
    if (r.band > 160) faults.push(`EMPTY BAND ${r.band}px under the content (${r.scrollH} of ${r.viewH})`);
    if (r.floors?.length) faults.push(`UNDER THE FLOOR ${r.floors.join(' · ')}`);
    if (r.fields?.length) faults.push(`SMALL FIELDS ${r.fields.map(f => `${f.what} ${f.px}px`).join(' · ')}`);
    if (r.tiny) faults.push(`TINY TYPE ${r.tiny} under 8px`);
    if (faults.length) md.push(`- \`${r.route}\` — ${faults.join(' — ')}`);
  }
  for (const e of s.errors) md.push(`- \`${e.route}\` — PAGE ERROR ${e.error}`);
  for (const [f, route] of s.failed) md.push(`- \`${route}\` — REQUEST ${f}`);
  md.push('');
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
writeFileSync(join(OUT, 'report.md'), md.join('\n'));
console.log(`\nreport: ${join(OUT, 'report.md')} · stills under ${OUT}/<size>/ · ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(exitBad ? 1 : 0);
