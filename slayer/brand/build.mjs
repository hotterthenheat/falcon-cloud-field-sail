/*
  SLAYER BRAND — THE EXPORTER (brand/build.mjs)

  Renders every template family into brand/exports/<category>/ and records each asset in brand/manifest.json:
  vector masters straight from the template (SVG), rasters photographed by Chromium (PNG, and WebP from the same
  pixels), favicon.ico from its 16/32/48 frames. Same templates the studio and the brand canvas draw — one source.

    npm run brand:build                         every family
    npm run brand:build -- logos                one family
    npm run brand:build -- logos --only=symbol  entries whose id contains "symbol"

  Chromium: the app's Playwright (npm ci), launched as Chrome when Chrome is installed (as scripts/make-brand-assets.ts
  does), else Playwright's own Chromium; PW_CHROMIUM names another executable, PLAYWRIGHT_MODULE another Playwright.
*/
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { assetName, interFace } from './lib/kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const PUBLIC = resolve(APP, 'public');
const EXPORTS = resolve(HERE, 'exports');
const MANIFEST = resolve(HERE, 'manifest.json');

/* the families, in the library's order */
const FAMILIES = {
  logos: './templates/logos.mjs',
};

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const wanted = args.filter(a => !a.startsWith('--'));

/* ── Playwright ── */
const loadPlaywright = async () => {
  if (process.env.PLAYWRIGHT_MODULE) return createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
  return import('playwright');
};
const { chromium } = await loadPlaywright();
const launch = async () => {
  if (process.env.PW_CHROMIUM) return chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    return chromium.launch();
  }
};
const browser = await launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** assets referenced by templates resolve to the app's public/ folder */
const ctx = { asset: rel => pathToFileURL(resolve(PUBLIC, rel)).href };
const FONT_CSS = interFace(ctx.asset('fonts/InterVariable.woff2'));

const shoot = async (e, html, w = e.w, h = e.h) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS} html,body{margin:0;background:transparent;font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}</style></head><body>${html}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: !e.ground, clip: { x: 0, y: 0, width: w, height: h } });
};

/** WebP from the same pixels, encoded by the browser */
const toWebp = async png => {
  const b64 = await page.evaluate(async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.92).split(',')[1];
  }, `data:image/png;base64,${png.toString('base64')}`);
  return Buffer.from(b64, 'base64');
};

/** an .ico holding PNG frames (Vista+ and every browser read PNG-in-ICO) */
const toIco = frames => {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o);
    head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map(f => f.png)]);
};

const old = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { assets: [] };
const byName = new Map(old.assets.map(a => [a.name, a]));
const today = new Date().toISOString().slice(0, 10);
let made = 0;

for (const [family, path] of Object.entries(FAMILIES)) {
  if (wanted.length && !wanted.includes(family)) continue;
  const entries = (await import(path)).default.filter(e => !only || e.id.includes(only));
  for (const e of entries) {
    const name = assetName(e);
    const dir = resolve(EXPORTS, e.category.toLowerCase());
    mkdirSync(dir, { recursive: true });
    const files = {};
    if (e.types.includes('svg') && e.svg) {
      writeFileSync(resolve(dir, `${name}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${e.svg(ctx)}\n`);
      files.svg = relative(HERE, resolve(dir, `${name}.svg`)).replaceAll('\\', '/');
    }
    if (e.types.includes('png') || e.types.includes('webp')) {
      const png = await shoot(e, e.html(ctx));
      if (e.types.includes('png')) {
        writeFileSync(resolve(dir, `${name}.png`), png);
        files.png = relative(HERE, resolve(dir, `${name}.png`)).replaceAll('\\', '/');
      }
      if (e.types.includes('webp')) {
        writeFileSync(resolve(dir, `${name}.webp`), await toWebp(png));
        files.webp = relative(HERE, resolve(dir, `${name}.webp`)).replaceAll('\\', '/');
      }
    }
    if (e.id === 'logo-favicon') {
      const frames = [];
      for (const size of [16, 32, 48]) frames.push({ size, png: await shoot({ ...e, ground: null }, e.html(ctx).replaceAll('32px', `${size}px`).replace('h: 26', `h: ${size * 0.8}`), size, size) });
      writeFileSync(resolve(dir, `${name}.ico`), toIco(frames));
      files.ico = relative(HERE, resolve(dir, `${name}.ico`)).replaceAll('\\', '/');
    }
    const prev = byName.get(name);
    byName.set(name, {
      name,
      title: e.title,
      variant: e.variant,
      use: e.use,
      category: e.category,
      campaign: e.campaign,
      platform: e.platform,
      format: e.format,
      version: `V${String(e.version).padStart(2, '0')}`,
      dimensions: `${e.w}×${e.h}`,
      fileTypes: Object.keys(files),
      files,
      ground: e.ground ? (e.theme === 'paper' ? 'light' : 'dark') : 'transparent',
      source: `brand/templates/${family}.mjs#${e.id}`,
      created: prev?.created ?? today,
      updated: today,
      campaignAssociation: e.campaignAssociation ?? null,
      expires: e.expires ?? null,
      approval: prev?.approval ?? { status: 'internal-review', by: null, at: null },
    });
    made++;
  }
}

await browser.close();
const assets = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(MANIFEST, `${JSON.stringify({ generated: today, count: assets.length, assets }, null, 1)}\n`);
console.log(`brand/build: ${made} assets rendered · manifest holds ${assets.length}`);
