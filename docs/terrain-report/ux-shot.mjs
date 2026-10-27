/** UI shots for the companion brief. Does not modify the app. */
import pkg from '/workspace/slayer/node_modules/playwright/index.js';
import path from 'node:path';
const { chromium } = pkg;
const OUT = '/workspace/docs/terrain-report/screenshots';
const browser = await chromium.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage({ viewport: { width: 1100, height: 420 }, deviceScaleFactor: 2 });
for (const [file, name] of [
  ['/workspace/docs/terrain-report/mocks/palette.html', 'part2-palette.png'],
  ['/workspace/docs/terrain-report/mocks/onboard.html', 'part2-onboard.png'],
  ['/workspace/docs/terrain-report/mocks/chrome.html', 'part2-chrome.png'],
]) {
  await page.goto('file://' + file);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('mock', name);
}

const live = await browser.newPage({ viewport: { width: 1440, height: 900 } });
live.on('pageerror', e => console.log('ERR', String(e).slice(0, 160)));
await live.addInitScript(() => localStorage.removeItem('slayer_terrain_v1'));
await live.goto('http://127.0.0.1:8080/terrain', { waitUntil: 'domcontentloaded' });
await live.waitForTimeout(2500);
const rest = await live.evaluate(() => {
  const bar = document.querySelector('.chrome-hover');
  if (!bar) return { missing: true, text: document.body.innerText.slice(0, 400) };
  const s = getComputedStyle(bar);
  const price = bar.querySelector('.tnum, [class*="font-semibold"]');
  const ps = price ? getComputedStyle(price) : null;
  return {
    opacity: s.opacity,
    fontSize: ps ? ps.fontSize : null,
    color: ps ? ps.color : null,
    text: bar.innerText.replace(/\s+/g, ' ').slice(0, 180),
  };
});
console.log('REST', JSON.stringify(rest));
await live.screenshot({ path: path.join(OUT, 'part2-chrome-rest.png') });
const bar = live.locator('.chrome-hover').first();
if (await bar.count()) {
  await bar.hover();
  await live.waitForTimeout(300);
  const hot = await live.evaluate(() => getComputedStyle(document.querySelector('.chrome-hover')).opacity);
  console.log('HOVER opacity', hot);
  await live.screenshot({ path: path.join(OUT, 'part2-chrome-hover.png') });
}

const mid = await browser.newPage({ viewport: { width: 768, height: 900 } });
await mid.addInitScript(() => localStorage.removeItem('slayer_terrain_v1'));
await mid.goto('http://127.0.0.1:8080/terrain', { waitUntil: 'domcontentloaded' });
await mid.waitForTimeout(2000);
const midInfo = await mid.evaluate(() => {
  const rail = [...document.querySelectorAll('[data-profile-views]')];
  const tools = [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    rails: rail.length,
    tools,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 280),
  };
});
console.log('MID', JSON.stringify(midInfo));
await mid.screenshot({ path: path.join(OUT, 'part2-768.png') });

await browser.close();
